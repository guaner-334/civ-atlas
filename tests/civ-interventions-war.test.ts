/**
 * 干预(gen/civ/interventions.ts):数据格式,和结盟、宣战、禁止分裂(按内容从 civ-interventions 分出来,好并行跑)
 * - cleanInterventions 丢掉不合格的;推演里的"键 → 编号"和 edits.ts 的 polityKey 一致
 * - 结盟的两国之后不互相宣战,结盟时正在交战的当即议和;一方被第三国宣战时,另一方多半援盟参战
 * - 宣战那一年确有 war 史事;不接壤的打不成,编年史写明原因
 * - 禁止分裂:从那一年起没有州从它的国土里叛离
 */
import { describe, expect, it } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { InterventionModel } from '../src/gen/civ/interventions';
import { ownersAt } from '../src/gen/civ/timeline';
import { relationsAt } from '../src/gen/civ/diplomacy';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { cleanInterventions, polityKey, sameInterventions, settlementKey, type Intervention } from '../src/gen/edits';
import { world, base, bordering, rivals, warsBetween, idOf } from './lib/interventions';

describe('干预 · 数据格式', () => {
  it('cleanInterventions:丢掉不合格的、年份取整夹紧;合格的原样返回', () => {
    const good: Intervention[] = [
      { kind: 'protect', a: 'polity:r12#0', from: 1800 },
      { kind: 'ally', a: 'polity:r12#0', b: 'polity:r40#1', from: 1800, until: 2000 },
      { kind: 'declare', a: 'polity:r12#0', b: 'polity:r40#1', from: 1900 },
      { kind: 'unity', a: 'polity:r40#1', from: 1850 },
    ];
    expect(cleanInterventions(good)).toBe(good);
    const messy = [
      ...good,
      { kind: 'nuke', a: 'polity:r1#0', from: 10 },
      { kind: 'protect', a: 'settlement:r1#0', from: 10 },
      { kind: 'ally', a: 'polity:r1#0', b: 'polity:r1#0', from: 10 },
      { kind: 'declare', a: 'polity:r1#0', from: 10 },
      { kind: 'protect', a: 'polity:r1#0', from: Number.NaN },
      { kind: 'protect', a: 'polity:r1#0', from: -5.5, extra: 1 },
      { kind: 'ally', a: 'polity:r1#0', b: 'polity:r2#0', from: 99.9, until: 50 },
      null,
      'x',
    ];
    const c = cleanInterventions(messy);
    expect(c.slice(0, 4)).toEqual(good);
    expect(c.slice(4)).toEqual([
      { kind: 'protect', a: 'polity:r1#0', from: 0 },
      { kind: 'ally', a: 'polity:r1#0', b: 'polity:r2#0', from: 99 },
    ]);
    // 保护可以有截止年份(要在 from 之后)
    const timed: Intervention = { kind: 'protect', a: 'polity:r12#0', from: 1800, until: 2100 };
    expect(cleanInterventions([timed])).toEqual([timed]);
    expect(cleanInterventions([{ ...timed, until: 1800 }])).toEqual([{ kind: 'protect', a: 'polity:r12#0', from: 1800 }]);
    expect(cleanInterventions(undefined)).toEqual([]);
    expect(sameInterventions(good, good.map((v) => ({ ...v })))).toBe(true);
    expect(sameInterventions(good, good.slice(1))).toBe(false);
  });

  it('推演里的"键 → 编号"和 edits.ts 的 polityKey 一致', () => {
    for (const seed of [7, 2024]) {
      const civ = base(seed);
      const iv = new InterventionModel([], seed);
      iv.pm = { polities: civ.polities, settlements: civ.settlements, terrain: { regions: civ.regions } } as never;
      for (const p of civ.polities) {
        const k = polityKey(civ, p.id);
        expect(iv.resolve(k), `seed ${seed} 国家 ${p.id}`).toBe(p.id);
        // 旧格式(州号)也一样
        expect(iv.resolve(k.replace(/:c\d+#/, `:r${civ.settlements[p.capital].region}#`)), `seed ${seed} 国家 ${p.id}(旧键)`).toBe(p.id);
      }
      for (const s of civ.settlements) expect(iv.resolveCity(settlementKey(civ, s.id))).toBe(s.id);
      expect(iv.resolve('polity:r99999#0')).toBe(-1);
      expect(iv.resolve(`polity:c${civ.regions.of.findIndex((r) => r < 0)}#0`)).toBe(-1);
    }
  });
});

describe('干预 · 推演', () => {
  it('结盟:两国之后不互相宣战;结盟时正在交战的当即议和', () => {
    for (const seed of [7, 2024]) {
      const civ = base(seed);
      for (const nth of [0, 1, 2]) {
        const [a, b, from, y] = rivals(civ, nth);
        expect(warsBetween(civ, a, b, from).length).toBeGreaterThan(0);
        const ka = polityKey(civ, a);
        const kb = polityKey(civ, b);
        const c = generateCiv(world(seed), { interventions: [{ kind: 'ally', a: ka, b: kb, from }] });
        const A = idOf(c, ka);
        const B = idOf(c, kb);
        expect(A).toBeGreaterThanOrEqual(0);
        expect(B).toBeGreaterThanOrEqual(0);
        expect(warsBetween(c, A, B, from), `seed ${seed}:第 ${Math.floor(y)} 年那场仗不再打`).toEqual([]);
        const text = buildChronicle(c).find((e) => e.kind === 'intervene')!.text;
        expect(text).toMatch(/^【干预】.+与.+结盟$/);
      }
      // 正在交战时结盟:当即议和(议和紧跟在干预后面;中间只能夹着议和时划界割让的攻占,条数记在议和的 region 列)
      const w = civ.annals.find((e) => {
        if (e.kind !== 'war') return false;
        const end = civ.annals.find((f) => f.kind === 'peace' && f.war === e.war);
        return !!end && end.year - e.year > 6 && civ.polities[e.a].ended === undefined;
      })!;
      const mid = Math.floor(w.year) + 3;
      const c = generateCiv(world(seed), { interventions: [{ kind: 'ally', a: polityKey(civ, w.a), b: polityKey(civ, w.b), from: mid }] });
      let i = c.annals.findIndex((e) => e.kind === 'intervene');
      let ceded = 0;
      while (c.annals[i + 1]?.kind === 'conquer' && c.annals[i + 1].year === mid) (i++, ceded++);
      expect(c.annals[i + 1]?.kind).toBe('peace');
      expect(c.annals[i + 1].year).toBe(mid);
      expect(c.annals[i + 1].war).toBe(w.war);
      expect(c.annals[i + 1].region).toBe(ceded > 0 ? ceded : -1);
    }
  }, 120_000);

  it('结盟:一方被第三国宣战时,另一方多半援盟参战(史事 war 的 settlement 列记盟国,编年史写"应某国之约")', () => {
    // 找几对"会被第三国攻打"的邻国结盟,看援盟有没有发生
    let joined = 0;
    let tried = 0;
    for (const seed of [7, 2024]) {
      const civ = base(seed);
      for (const w of civ.annals) {
        if (w.kind !== 'war' || w.year < 1000) continue;
        // 宣战那一年年初结盟(之前的历史一字不差,这场仗照样会打):守方 w.b 和一个同时挨着攻方 w.a 的国家 z
        const y0 = Math.floor(w.year);
        if (w.year === y0 || civ.polities[w.b].founded >= y0 - 1) continue;
        const own = ownersAt(civ, y0 - 0.01).polity;
        const z = civ.polities.find(
          (q) => q.id !== w.a && q.id !== w.b && q.founded < y0 - 1 && (q.ended ?? Infinity) > w.year && own.includes(q.id) &&
            bordering(civ, q.id, w.b, y0 - 0.01) && bordering(civ, q.id, w.a, y0 - 0.01),
        )?.id;
        if (z === undefined) continue;
        tried++;
        const kz = polityKey(civ, z);
        const kb = polityKey(civ, w.b);
        const c = generateCiv(world(seed), {
          interventions: [{ kind: 'ally', a: kz, b: kb, from: y0 }],
        });
        // 结盟以后 z 为 w.b 出兵的仗(结盟之前历史里自然有的援盟、救藩不算)
        const Z = idOf(c, kz);
        const B = idOf(c, kb);
        const helped = c.annals.filter((e) => e.kind === 'war' && e.year >= y0 && e.a === Z && e.settlement === B);
        if (helped.length) {
          joined++;
          const e = helped[0];
          // 援盟那场仗紧跟在"第三国向盟国宣战"之后(同一刻)
          const i = c.annals.indexOf(e);
          const before = c.annals.slice(0, i).reverse().find((x) => x.kind === 'war' && x.year === e.year);
          expect(before && before.b === e.settlement && before.a === e.b).toBe(true);
          const entry = buildChronicle(c).find((x) => x.kind === 'war' && x.id === i);
          // 结盟以后 B 又向 z 称臣的,是以宗主身份去救(编年史写"救其藩属")
          expect(entry?.text).toMatch(e.cause === 'rescue' ? /救其藩属/ : /应.+之约(,遣.+)?伐/);
        }
        if (tried >= 5 * (seed === 7 ? 1 : 2)) break;
      }
    }
    // 援盟的机会是 ALLY_JOIN(八成)
    expect(tried).toBeGreaterThanOrEqual(6);
    expect(joined, `试了 ${tried} 对盟国`).toBeGreaterThanOrEqual(Math.ceil(tried * 0.4));
  }, 180_000);

  it('宣战:那一年确有 war 史事(紧跟在干预后面);不接壤的打不成,编年史写明原因', () => {
    for (const seed of [7, 2024]) {
      const civ = base(seed);
      // 种子 2024 第 2000 年前后的国家都还小、彼此不接壤(GENERATOR_VERSION 13),挑晚一点的年份
      const y = 2500;
      const own = ownersAt(civ, y - 0.01).polity;
      const alive = civ.polities.filter((p) => p.founded < y - 1 && (p.ended ?? Infinity) > y && own.includes(p.id));
      // 一对接壤、此刻没在交战、也不是盟国或宗藩的国家(那样会先断盟约 / 自立,见 civ-diplomacy);一对不接壤的
      let pair: [number, number] | null = null;
      let far: [number, number] | null = null;
      const rel = relationsAt(civ, y - 0.01);
      const tied = (p: number, q: number) =>
        rel.liege.get(p)?.liege === q || rel.liege.get(q)?.liege === p || (rel.liege.has(p) && rel.liege.get(p)?.liege === rel.liege.get(q)?.liege) || rel.pacts.some((x) => (x.a === p && x.b === q) || (x.a === q && x.b === p));
      for (const p of alive) {
        for (const q of alive) {
          if (p.id === q.id) continue;
          const touch = bordering(civ, p.id, q.id, y - 0.01);
          const fighting = civ.annals.some(
            (e) =>
              e.kind === 'war' &&
              e.year < y &&
              ((e.a === p.id && e.b === q.id) || (e.a === q.id && e.b === p.id)) &&
              !civ.annals.some((f) => f.kind === 'peace' && f.war === e.war && f.year < y),
          );
          if (touch && !fighting && !tied(p.id, q.id) && !pair) pair = [p.id, q.id];
          // 不接壤要两个方向都过不去(只有一方能渡海时,另一方宣战那一刻两国可能已在交战)
          if (!touch && !far && !bordering(civ, q.id, p.id, y - 0.01)) far = [p.id, q.id];
        }
      }
      expect(pair && far).toBeTruthy();
      const [a, b] = pair!;
      const c = generateCiv(world(seed), {
        interventions: [
          { kind: 'declare', a: polityKey(civ, a), b: polityKey(civ, b), from: y },
          { kind: 'declare', a: polityKey(civ, far![0]), b: polityKey(civ, far![1]), from: y },
        ],
      });
      const i = c.annals.findIndex((e) => e.kind === 'intervene' && e.war === 0);
      expect(i).toBeGreaterThanOrEqual(0);
      const w = c.annals[i + 1];
      expect(w.kind).toBe('war');
      expect(w.year).toBe(y);
      expect([w.a, w.b]).toEqual([c.annals[i].a, c.annals[i].b]);
      const chron = buildChronicle(c).filter((e) => e.kind === 'intervene');
      expect(chron.map((e) => e.text)).toEqual([expect.stringMatching(/^【干预】.+向.+宣战$/), expect.stringMatching(/不接壤,未能成行$/)]);
      // 不接壤的那一条后面没有 war
      const j = c.annals.findIndex((e) => e.kind === 'intervene' && e.war === 1);
      expect(c.annals[j + 1]?.kind === 'war' && c.annals[j + 1].year === y && c.annals[j + 1].a === c.annals[j].a).toBe(false);
    }
  }, 120_000);

  it('禁止分裂:从那一年起没有州从它的国土里叛离', () => {
    for (const seed of [7, 2024]) {
      const civ = base(seed);
      // 一个后来有州叛离的国家
      const s = civ.annals.find((e) => e.kind === 'split' && e.b >= 0 && e.year > 1200 && civ.polities[e.b].founded < e.year - 60);
      expect(s).toBeTruthy();
      const key = polityKey(civ, s!.b);
      const from = Math.floor(s!.year) - 30;
      const c = generateCiv(world(seed), { interventions: [{ kind: 'unity', a: key, from }] });
      const id = idOf(c, key);
      expect(c.annals.filter((e) => e.kind === 'split' && e.b === id && e.year >= from)).toEqual([]);
      expect(buildChronicle(c).find((e) => e.kind === 'intervene')!.text).toMatch(/四境无叛/);
    }
  }, 120_000);
});

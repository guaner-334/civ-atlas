/**
 * 邦交(gen/civ/diplomacy.ts):称臣纳贡、结盟、背盟。
 * - 真实世界(默认参数 seed 7 / 2024):有结盟、有称臣;关系不自相矛盾(一国只有一个宗主、藩属不收藩属、藩属不结盟,
 *   盟国之间要先背盟才打仗,宗藩之间要先自立才打仗);史事里的国家当时都在
 * - relationsAt(某一年的关系)和推演里的模型一致
 * - fromCiv 接着推:在刚称臣、刚结盟、援盟的仗打到一半时切开,和一口气推完逐字节一样
 * - 确定性:同一个种子推两次,邦交史事一样
 * - 作者下令(阶段 4 干预):盟国、宗藩、同一宗主的藩属之间下令开战,先断盟约 / 宗藩之分(攻方自立)再宣战,干预算生效;
 *   下令结了盟的不讨伐自立的藩属
 * - 纳土归附:合并记 cause = vassal,编年史写"纳土归附"
 * - 编年史:援盟的仗,盟国的名字里含着守方的名字,照样写"伐某国"
 * - polityTies(国家面板):relationsAt 那一套,盟国再加上作者下令的结盟(约期内、两国都在)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World, type WorldParams } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Annal } from '../src/gen/civ/types';
import { CivSim } from '../src/gen/civ/sim';
import { polityAlive, polityName } from '../src/gen/civ/growth';
import { diplomacyModelOf, diplomacyStats, polityTies, relationsAt } from '../src/gen/civ/diplomacy';
import { buildChronicle, interventionOutcome, type ChronicleEntry } from '../src/gen/civ/chronicle';
import { polityKey, type Intervention } from '../src/gen/edits';

const worlds = new Map<string, World>();
function world(p: WorldParams): World {
  const key = JSON.stringify(p);
  let w = worlds.get(key);
  if (!w) worlds.set(key, (w = generateWorld(p)));
  return w;
}
const civs = new Map<string, Civ>();
function civOf(p: WorldParams): Civ {
  const key = JSON.stringify(p);
  let c = civs.get(key);
  if (!c) civs.set(key, (c = generateCiv(world(p))));
  return c;
}

const DIP = new Set<string>(['alliance', 'unally', 'submit', 'defect']);
const pair = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`;

/**
 * 按史事重放关系,一条条检查不自相矛盾;返回检查过的称臣、结盟、宣战条数。
 * 关系在任一方亡国 / 被并时自动断(和推演里一样)
 */
function checkRelations(civ: Civ, tag: string) {
  const alive = (p: number, y: number) => p >= 0 && polityAlive(civ.polities[p], y);
  const liege = new Map<number, number>();
  const pacts = new Set<string>();
  const betrayed = new Set<string>();
  const defected = new Set<string>();
  const liegeOf = (p: number, y: number) => {
    const l = liege.get(p);
    return l !== undefined && alive(l, y) && alive(p, y) ? l : -1;
  };
  const allied = (a: number, b: number, y: number) => pacts.has(pair(a, b)) && alive(a, y) && alive(b, y);
  /** 还没议和的战争:战争编号 → 双方 */
  const active = new Map<number, [number, number]>();
  const fightingNow = (a: number, b: number) => [...active.values()].some(([x, y]) => (x === a && y === b) || (x === b && y === a));
  let submits = 0;
  let alliances = 0;
  let wars = 0;
  civ.annals.forEach((e: Annal, i) => {
    const at = `${tag} 第 ${i} 条 ${e.kind} 第 ${e.year} 年`;
    const y = e.year;
    if (DIP.has(e.kind)) {
      expect(alive(e.a, y), `${at}:a 在世`).toBe(true);
      expect(alive(e.b, y), `${at}:b 在世`).toBe(true);
    }
    switch (e.kind) {
      case 'submit':
        submits++;
        // 一国只有一个宗主;藩属不收藩属;有藩属的不称臣
        expect(liegeOf(e.a, y), `${at}:已经是藩属`).toBe(-1);
        expect(liegeOf(e.b, y), `${at}:宗主自己是藩属`).toBe(-1);
        expect([...liege.keys()].some((v) => liegeOf(v, y) === e.a), `${at}:称臣的国家有藩属`).toBe(false);
        // 称臣时不在和宗主、宗主的藩属交兵(称了臣就同是一国的藩属)
        expect(fightingNow(e.a, e.b), `${at}:还在和宗主交兵`).toBe(false);
        expect([...liege.keys()].some((v) => liegeOf(v, y) === e.b && fightingNow(e.a, v)), `${at}:还在和宗主的藩属交兵`).toBe(false);
        liege.set(e.a, e.b);
        break;
      case 'defect':
        expect(liegeOf(e.a, y), `${at}:自立的是那个宗主的藩属`).toBe(e.b);
        liege.delete(e.a);
        defected.add(`${e.b}>${e.a}`);
        break;
      case 'alliance':
        alliances++;
        expect(allied(e.a, e.b, y), `${at}:已经结着盟`).toBe(false);
        // 藩属不另外结盟
        expect(liegeOf(e.a, y), at).toBe(-1);
        expect(liegeOf(e.b, y), at).toBe(-1);
        expect(e.foe === undefined || e.foe < 0 || alive(e.foe, y), `${at}:共御的强邻在世`).toBe(true);
        pacts.add(pair(e.a, e.b));
        break;
      case 'unally':
        expect(e.cause, at).toBeDefined();
        expect(allied(e.a, e.b, y), `${at}:断的是结着的盟`).toBe(true);
        if (e.cause === 'vassal') expect(liegeOf(e.a, y), `${at}:称臣以后盟约作废`).toBeGreaterThanOrEqual(0);
        if (e.cause === 'betray') betrayed.add(`${e.a}>${e.b}@${y}`);
        pacts.delete(pair(e.a, e.b));
        break;
      case 'peace':
        active.delete(e.war);
        break;
      case 'war':
        wars++;
        active.set(e.war, [e.a, e.b]);
        // 盟国之间不打仗(除非刚背盟);宗主和藩属、同一宗主的藩属之间不打仗(讨伐自立的藩属除外)
        if (allied(e.a, e.b, y)) throw new Error(`${at}:盟国之间开战`);
        if (e.cause === 'betray') expect(betrayed.has(`${e.a}>${e.b}@${y}`), `${at}:背盟来攻,先记背盟`).toBe(true);
        if (e.cause === 'punish') expect(defected.has(`${e.a}>${e.b}`), `${at}:讨伐的是自立的藩属`).toBe(true);
        {
          const la = liegeOf(e.a, y);
          const lb = liegeOf(e.b, y);
          expect(la === e.b || lb === e.a || (la >= 0 && la === lb), `${at}:宗藩之间开战`).toBe(false);
        }
        break;
    }
  });
  // 这些年的关系:relationsAt 和重放的一样;盟约、宗藩都只在在世国家之间,藩属不同时是宗主,也不结盟
  for (let y = 1000; y <= civ.endYear; y += 250) {
    const r = relationsAt(civ, y);
    for (const [v, x] of r.liege) {
      expect(alive(v, y) && alive(x.liege, y), `${tag} 第 ${y} 年`).toBe(true);
      expect(r.liege.has(x.liege), `${tag} 第 ${y} 年:藩属的藩属`).toBe(false);
    }
    for (const x of r.pacts) {
      expect(alive(x.a, y) && alive(x.b, y), `${tag} 第 ${y} 年`).toBe(true);
      expect(r.liege.has(x.a) || r.liege.has(x.b), `${tag} 第 ${y} 年:藩属结着盟`).toBe(false);
    }
  }
  return { submits, alliances, wars };
}

describe('邦交:称臣纳贡、结盟、背盟', () => {
  it('默认参数 seed 7 / 2024:有结盟、有称臣;关系一条条重放都不自相矛盾', () => {
    let pacts = 0;
    for (const seed of [7, 2024]) {
      const civ = civOf({ ...DEFAULT_PARAMS, seed });
      const s = diplomacyStats(civ);
      const tag = `seed ${seed}`;
      // 20 个种子(1–19、2024)里结盟 0–14 次、称臣 1–12 次:每个世界都有称臣;国家之间常隔着部落,有两个世界一次结盟都没有
      pacts += s.pacts;
      expect(s.submits, tag).toBeGreaterThanOrEqual(1);
      expect(s.submits, tag).toBeLessThanOrEqual(15);
      expect(s.pacts, tag).toBeLessThanOrEqual(25);
      // 断了的盟不多于结过的盟;自立的不多于称过臣的
      expect(s.lapses + s.abandons + s.betrayals, tag).toBeLessThanOrEqual(s.pacts);
      expect(s.defects, tag).toBeLessThanOrEqual(s.submits);
      expect(s.punishments, tag).toBeLessThanOrEqual(s.defects);
      const n = checkRelations(civ, tag);
      expect(n.submits, tag).toBe(s.submits);
    }
    expect(pacts, '两个世界里有结盟').toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('推演结束时的模型和 relationsAt(结束那一年)一致', () => {
    const w = world({ ...DEFAULT_PARAMS, seed: 2024 });
    const civ = civOf({ ...DEFAULT_PARAMS, seed: 2024 });
    const sim = CivSim.fromCiv(w, civ);
    const dm = diplomacyModelOf(sim)!;
    expect(dm).toBeDefined();
    const r = relationsAt(civ, civ.endYear);
    const live = civ.polities.filter((p) => p.ended === undefined).map((p) => p.id);
    for (const p of live) {
      expect(dm.liegeOf(p), `${p}`).toBe(r.liege.get(p)?.liege ?? -1);
      const allies = r.pacts.filter((x) => x.a === p || x.b === p).map((x) => (x.a === p ? x.b : x.a));
      expect(dm.alliesOf(p), `${p}`).toEqual(allies.sort((a, b) => a - b));
    }
  }, 60_000);

  it('fromCiv 接着推:在刚称臣、刚结盟、援盟的仗打到一半、藩属刚自立时切开,和一口气推完逐字节一样', () => {
    for (const seed of [7, 2024]) {
      const p = { ...DEFAULT_PARAMS, cells: 12000, seed };
      const w = world(p);
      const whole = civOf(p);
      const A = whole.annals;
      const pick = (f: (e: Annal) => boolean) => A.find((e) => f(e) && e.year > 600)?.year;
      const splits = new Set<number>();
      for (const y of [
        pick((e) => e.kind === 'submit'),
        pick((e) => e.kind === 'submit' && e.war >= 0),
        pick((e) => e.kind === 'alliance'),
        pick((e) => e.kind === 'defect'),
        pick((e) => e.kind === 'unally'),
      ])
        if (y !== undefined) splits.add(y);
      // 援盟、救藩的仗打到一半
      const join = A.find((e) => e.kind === 'war' && (e.cause === 'ally' || e.cause === 'rescue'));
      if (join) {
        const end = A.find((e) => e.kind === 'peace' && e.war === join.war)?.year ?? whole.endYear;
        splits.add(Math.floor((join.year + end) / 2));
      }
      expect(splits.size, `seed ${seed} 小世界也要有邦交`).toBeGreaterThanOrEqual(3);
      for (const split of [...splits].sort((a, b) => a - b)) {
        const half = generateCiv(w, { endYear: split });
        const sim = CivSim.fromCiv(w, half);
        sim.run(whole.endYear);
        const res = sim.result();
        const tag = `seed ${seed} 从第 ${split} 年接着推`;
        expect(JSON.stringify(res.annals), tag).toBe(JSON.stringify(whole.annals));
        expect(Buffer.from(res.polity.buffer).equals(Buffer.from(whole.polity.buffer)), tag).toBe(true);
      }
    }
  }, 300_000);
});

describe('邦交和作者下令', () => {
  const small = (seed: number) => ({ ...DEFAULT_PARAMS, cells: 12000, seed });
  /** 干预那一条后面紧跟着的几条史事 */
  const after = (civ: Civ, from: number) => {
    const k = civ.annals.findIndex((e) => e.kind === 'intervene' && e.year >= from);
    return civ.annals.slice(k + 1, k + 3);
  };

  it('盟国、宗藩之间下令开战:先断盟约 / 宗藩之分,再宣战;干预算生效,关系不自相矛盾', () => {
    type Try = { w: World; civ: Civ; a: number; b: number; from: number };
    const at = (seed: number) => ({ w: world(small(seed)), civ: civOf(small(seed)) });
    // 每种情形挑几对当时还结着的,下令开战;两国不接壤的打不成,换下一对
    // (种子 2024 小世界;种子 7 小世界只结过一次盟,下令也打不成)
    const tries = (kind: 'alliance' | 'submit'): Try[] => {
      const { w, civ } = at(2024);
      return civ.annals
        .filter((e) => e.kind === kind)
        .map((e) => ({ w, civ, a: e.a, b: e.b, from: Math.ceil(e.year) + 1 }))
        .filter((x) => {
          const r = relationsAt(civ, x.from);
          return kind === 'alliance' ? r.pacts.some((q) => (q.a === x.a && q.b === x.b) || (q.a === x.b && q.b === x.a)) : r.liege.get(x.a)?.liege === x.b;
        })
        .slice(0, 4);
    };
    // 同一个宗主的两个藩属(种子 5 小世界有;称臣那一年之后,和别的藩属配对)
    const coVassals = (): Try[] => {
      const { w, civ } = at(5);
      return civ.annals
        .filter((e) => e.kind === 'submit')
        .flatMap((e) => {
          const from = Math.ceil(e.year) + 1;
          const r = relationsAt(civ, from);
          const L = r.liege.get(e.a)?.liege;
          return [...r.liege].filter(([v, x]) => v !== e.a && x.liege === L).flatMap(([v]) => [
            { w, civ, a: e.a, b: v, from },
            { w, civ, a: v, b: e.a, from },
          ]);
        })
        .slice(0, 8);
    };
    const cases = [
      { what: '打盟国', list: tries('alliance'), cut: 'unally', cause: 'betray' },
      { what: '藩属打宗主', list: tries('submit'), cut: 'defect', cause: undefined },
      { what: '宗主打藩属', list: tries('submit').map((x) => ({ ...x, a: x.b, b: x.a })), cut: 'defect', cause: 'betray' },
      { what: '同宗藩属互攻', list: coVassals(), cut: 'defect', cause: undefined },
    ] as const;
    for (const c of cases) {
      let done = false;
      for (const x of c.list) {
        const { w, civ } = x;
        const v: Intervention = { kind: 'declare', a: polityKey(civ, x.a), b: polityKey(civ, x.b), from: x.from };
        const res = generateCiv(w, { interventions: [v] });
        const [cut, war] = after(res, x.from);
        if (war?.kind !== 'war' || war.a !== x.a || war.b !== x.b) continue;
        const tag = `${c.what} ${x.a}→${x.b} 第 ${x.from} 年`;
        expect(cut.kind, tag).toBe(c.cut);
        expect(cut.cause, tag).toBe(c.cause);
        // 同宗藩属互攻:攻方先向宗主自立
        if (c.what === '同宗藩属互攻') expect([cut.a, cut.b], tag).toEqual([x.a, relationsAt(civ, x.from).liege.get(x.a)!.liege]);
        expect([war.a, war.b], tag).toEqual([x.a, x.b]);
        expect(interventionOutcome(res, 0).ok, tag).toBe(true);
        checkRelations(res, tag);
        if (c.what === '宗主打藩属') expect(buildChronicle(res).find((e) => e.id === res.annals.indexOf(cut))?.text, tag).toContain('反目');
        done = true;
        break;
      }
      expect(done, `${c.what}:要有一对打得成`).toBe(true);
    }
  }, 300_000);

  it('纳土归附:藩属并入宗主(邦交里的、内政里的合并都算)记 cause = vassal;编年史写"纳土归附"', () => {
    const civ = civOf(small(9));
    // 记 cause = vassal 的,正是并之前是宗主和藩属的那些
    for (const e of civ.annals.filter((x) => x.kind === 'merge')) {
      expect(e.cause === 'vassal', `第 ${e.year} 年 ${e.b} 并入 ${e.a}`).toBe(relationsAt(civ, e.year - 1 / 256).liege.get(e.b)?.liege === e.a);
    }
    const absorbs = civ.annals.map((e, i) => [e, i] as const).filter(([e]) => e.kind === 'merge' && e.cause === 'vassal');
    expect(absorbs.length, '种子 9 小世界有纳土归附').toBeGreaterThan(0);
    expect(diplomacyStats(civ).absorbs).toBe(absorbs.length);
    const chron = buildChronicle(civ);
    for (const [e, i] of absorbs) {
      expect(relationsAt(civ, e.year - 1 / 256).liege.get(e.b)?.liege, `第 ${i} 条`).toBe(e.a);
      expect(chron.find((x) => x.id === i)?.text, `第 ${i} 条`).toContain('纳土归附');
    }
  }, 120_000);

  it('下令结了盟的宗主不讨伐自立的藩属', () => {
    // 讨伐少见:20 个种子(1–19、2024)的小世界里只有种子 1、17 有
    const p = small(1);
    const w = world(p);
    const civ = civOf(p);
    const war = civ.annals.find((e) => e.kind === 'war' && e.cause === 'punish');
    expect(war, '要有一场讨伐').toBeDefined();
    const from = Math.floor(war!.year);
    const v: Intervention = { kind: 'ally', a: polityKey(civ, war!.a), b: polityKey(civ, war!.b), from };
    const res = generateCiv(w, { interventions: [v] });
    // 自立照旧,只是不再发兵
    expect(res.annals.some((e) => e.kind === 'defect' && e.a === war!.b && e.b === war!.a && e.year === war!.year)).toBe(true);
    expect(res.annals.some((e) => e.kind === 'war' && e.year >= from && ((e.a === war!.a && e.b === war!.b) || (e.a === war!.b && e.b === war!.a)))).toBe(false);
  }, 120_000);

  it('polityTies:盟国里有作者下令的结盟(约期内),没有共御的强邻;自然结成的照旧', () => {
    const civ = civOf(small(7));
    const y = 2000;
    const live = civ.polities.filter((q) => polityAlive(q, y - 1) && polityAlive(q, y + 60)).map((q) => q.id);
    const r = relationsAt(civ, y);
    const natural = (a: number, b: number) => r.pacts.some((q) => (q.a === a && q.b === b) || (q.a === b && q.b === a));
    const [x, z] = live.flatMap((a) => live.filter((b) => b > a && !natural(a, b)).map((b) => [a, b]))[0];
    const iv: Civ = { ...civ, interventions: [{ kind: 'ally', a: polityKey(civ, x), b: polityKey(civ, z), from: y, until: y + 50 }] };
    const at = (t: number) => polityTies(iv, x, t).allies.find((q) => q.id === z);
    expect(at(y - 1)).toBeUndefined();
    expect(at(y + 1)).toEqual({ id: z, since: y, foe: -1 });
    expect(polityTies(iv, z, y + 1).allies.some((q) => q.id === x)).toBe(true);
    expect(at(y + 50)).toBeUndefined();
    // 别的照 relationsAt
    for (const p of live) {
      const t = polityTies(civ, p, y);
      expect(t.allies.map((q) => q.id).sort((a, b) => a - b)).toEqual(r.pacts.filter((q) => q.a === p || q.b === p).map((q) => (q.a === p ? q.b : q.a)).sort((a, b) => a - b));
      expect(t.liege).toEqual(r.liege.get(p));
    }
  }, 120_000);

  it('编年史:援盟的仗,盟国的名字里含着守方的名字,照样写"伐某国"', () => {
    const civ = civOf(small(7));
    const i = civ.annals.findIndex((e) => e.kind === 'war' && (e.cause === 'ally' || e.cause === 'rescue') && e.settlement >= 0 && !civ.polities[e.settlement].eastern);
    expect(i, '要有一场援盟 / 救藩的仗').toBeGreaterThanOrEqual(0);
    const e = civ.annals[i];
    const B = polityName(civ.polities[e.b], e.year);
    const renamed: Civ = { ...civ, polities: civ.polities.map((q) => (q.id === e.settlement ? { ...q, name: `东${B}` } : q)) };
    const all: ChronicleEntry[] = buildChronicle(renamed).flatMap((x) => [x, ...(x.children ?? [])]);
    // 战争那一条和点开后宣战那一条
    const xs = all.filter((c) => c.id === i && c.kind === 'war');
    expect(xs.length).toBeGreaterThanOrEqual(2);
    for (const x of xs) {
      expect(x.text).toContain(`东${B}`);
      expect(x.text.includes(`伐${B}`) || x.text.includes(`征${B}`), x.text).toBe(true);
    }
  }, 120_000);
});

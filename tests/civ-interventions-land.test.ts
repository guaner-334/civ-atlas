/**
 * 干预(gen/civ/interventions.ts):划州、立国、迁都、不许扩张各自生效(按内容从 civ-interventions 分出来,好并行跑)
 * - "划州 + 永久"的州到第 3000 年仍属该国;立国出来的国家能改名、能被"不许灭"引用
 * - 干预年份之前和不干预时逐字节一致;办不成的(没人住的州、别国的城)编年史写明原因
 * 四种一起下的确定性在 civ-interventions-land-resume
 */
import { describe, expect, it } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { buildChronicle, interventionOutcome } from '../src/gen/civ/chronicle';
import { capitalAt } from '../src/gen/civ/growth';
import { applyNames, cleanInterventions, polityKey, regionKey, settlementKey, type Intervention } from '../src/gen/edits';
import {
  world,
  base,
  annalsBefore,
  idOf,
  sizeAt,
  ownedRegion,
  tribalRegion,
  emptyRegion,
  borderRegion,
  bigPolityCity,
  expansion,
  samePast,
  ivText,
} from './lib/interventions';

describe('干预 · 划州 / 立国 / 迁都 / 不许扩张 · 数据格式', () => {
  it('cleanInterventions 认划州、立国、迁都、不许扩张;国名按改名的规矩清理;键格式不对的丢掉', () => {
    const good: Intervention[] = [
      { kind: 'cede', a: 'polity:r12#0', region: 'region:r40', from: 1800 },
      { kind: 'cede', a: 'polity:r12#0', region: 'region:r40', from: 1800, permanent: true },
      { kind: 'found', region: 'region:r40', from: 1500 },
      { kind: 'found', region: 'region:r40', from: 1500, name: '饕餮' },
      { kind: 'move', a: 'polity:r12#0', city: 'settlement:r40#1', from: 2000 },
      { kind: 'halt', a: 'polity:r12#0', from: 1000 },
      { kind: 'halt', a: 'polity:r12#0', from: 1000, until: 1400 },
    ];
    expect(cleanInterventions(good)).toBe(good);
    const c = cleanInterventions([
      ...good,
      { kind: 'cede', a: 'polity:r12#0', region: 'polity:r40#0', from: 1 },
      { kind: 'cede', a: 'polity:r12#0', region: 'region:r40', from: 1, permanent: 'yes' },
      { kind: 'found', a: 'polity:r12#0', from: 1 },
      { kind: 'found', region: 'region:r4', from: 1, name: '  秦国 ' },
      { kind: 'found', region: 'region:r4', from: 1, name: '   ' },
      { kind: 'move', a: 'polity:r12#0', city: 'region:r4', from: 1 },
      { kind: 'halt', a: 'polity:r12#0', from: 900.7, until: 800 },
    ]);
    expect(c.slice(0, good.length)).toEqual(good);
    expect(c.slice(good.length)).toEqual([
      { kind: 'cede', a: 'polity:r12#0', region: 'region:r40', from: 1 },
      { kind: 'found', region: 'region:r4', from: 1, name: '秦' },
      { kind: 'found', region: 'region:r4', from: 1 },
      { kind: 'halt', a: 'polity:r12#0', from: 900 },
    ]);
  });
});

describe('干预 · 划州 / 立国 / 迁都 / 不许扩张 · 推演', () => {
  it('立国:那一年这州立起一个新国家(有主的州从原主分出来;部落地带也行);之前逐字节一致;编年史写"【干预】…立国"', () => {
    for (const seed of [7, 2024]) {
      const civ = base(seed);
      const y = 1500;
      const { r, o } = ownedRegion(civ, y);
      const t = tribalRegion(civ, y);
      for (const [region, parent] of [
        [r, o],
        [t, -1],
      ]) {
        const v: Intervention = { kind: 'found', region: regionKey(civ, region), from: y, name: '饕餮' };
        const c = generateCiv(world(seed), { interventions: [v] });
        samePast(seed, v, c);
        const iv = c.annals.find((e) => e.kind === 'intervene')!;
        const p = c.polities[iv.a];
        expect(p, `seed ${seed} 州 ${region}`).toBeTruthy();
        expect(p.founded).toBe(y);
        expect(p.name).toBe('饕餮');
        expect(c.settlements[p.capital].region).toBe(region);
        expect(p.culture).toBe(ownersAt(civ, y - 0.01).culture[region]);
        expect(p.parent).toBe(parent < 0 ? undefined : parent);
        expect(ownersAt(c, y).polity[region]).toBe(p.id);
        expect(polityKey(c, p.id)).toMatch(new RegExp(`^polity:c${civ.regions.seat[region]}#\\d+$`));
        // 立国那条 found 并进干预那一条
        const text = ivText(c);
        expect(text).toEqual([parent >= 0 ? expect.stringMatching(/^【干预】.+脱.+自立,号饕餮.+都/) : expect.stringMatching(/^【干预】.+立国,号饕餮/)]);
        expect(buildChronicle(c).some((e) => e.kind === 'found' && e.polities[0] === p.id)).toBe(false);
        // 开国之君写在干预那一条里
        const founder = c.people!.find((x) => x.role === 'ruler' && x.polity === p.id)!;
        const entry = buildChronicle(c).find((e) => e.kind === 'intervene')!;
        expect(entry.text).toContain(`奉${founder.name}为主`);
        expect(entry.people).toContain(founder.id);
        expect(interventionOutcome(c, 0)).toMatchObject({ ok: true });
      }
    }
  }, 180_000);

  it('立国出来的国家能改名、能被"不许灭"引用(它到第 3000 年仍在)', () => {
    for (const seed of [7, 2024]) {
      const civ = base(seed);
      const y = 1500;
      const { r } = ownedRegion(civ, y);
      const found: Intervention = { kind: 'found', region: regionKey(civ, r), from: y };
      const c1 = generateCiv(world(seed), { interventions: [found] });
      const id1 = c1.annals.find((e) => e.kind === 'intervene')!.a;
      const key = polityKey(c1, id1);
      // 改名
      const named = applyNames(c1, { [key]: '饕餮' });
      expect(named.polities[id1].name).toBe('饕餮');
      expect(ivText(named)[0]).toContain('饕餮');
      // 不许灭(引用新国家的键;同一年、排在立国后面)
      const c2 = generateCiv(world(seed), { interventions: [found, { kind: 'protect', a: key, from: y }] });
      const id2 = idOf(c2, key);
      expect(id2).toBeGreaterThanOrEqual(0);
      expect(c2.polities[id2].founded).toBe(y);
      expect(c2.polities[id2].ended, `seed ${seed}:立出来的国家加了不许灭`).toBeUndefined();
      expect(ivText(c2)[1]).toMatch(/自此不亡$/);
      // 之前的历史一样:干预年份之前的史事
      expect(annalsBefore(c2, y)).toBe(annalsBefore(civ, y));
    }
  }, 180_000);

  it('划州:那一年这州归该国(原主照常);"永久"的到第 3000 年仍属该国;没人住的州划不成,写明原因', () => {
    for (const seed of [7, 2024]) {
      const civ = base(seed);
      const y = 1800;
      const { r, o, q } = borderRegion(civ, y);
      const kq = polityKey(civ, q);
      const ko = polityKey(civ, o);
      for (const permanent of [false, true]) {
        const v: Intervention = permanent
          ? { kind: 'cede', a: kq, region: regionKey(civ, r), from: y, permanent: true }
          : { kind: 'cede', a: kq, region: regionKey(civ, r), from: y };
        const c = generateCiv(world(seed), { interventions: [v] });
        samePast(seed, v, c);
        const Q = idOf(c, kq);
        const O = idOf(c, ko);
        expect(ownersAt(c, y).polity[r], `seed ${seed}:划过去了`).toBe(Q);
        // 不算战争:原主那一刻没亡、没有战争史事
        expect(c.polities[O].ended === undefined || c.polities[O].ended! > y).toBe(true);
        expect(c.annals.some((e) => e.year === y && e.kind === 'war' && (e.a === Q || e.b === Q))).toBe(false);
        if (permanent) {
          expect(c.polity[r], `seed ${seed}:永久划给的州到第 3000 年仍属该国`).toBe(Q);
          expect(c.polities[Q].ended).toBeUndefined();
        }
        expect(ivText(c)[0]).toMatch(permanent ? /^【干预】.+划归.+永为.+之土$/ : /^【干预】.+划归.+$/);
      }
      // 没人住的州:划不成
      const e = emptyRegion(civ, y);
      const c = generateCiv(world(seed), { interventions: [{ kind: 'cede', a: kq, region: regionKey(civ, e), from: y }] });
      expect(ivText(c)[0]).toMatch(/无人居住$/);
      expect(interventionOutcome(c, 0)).toMatchObject({ ok: false, why: expect.stringMatching(/没人住/) });
      expect(ownersAt(c, y + 1).polity[e]).toBe(-1);
    }
  }, 180_000);

  it('迁都:那一年国都换到这座城;城不在本国国土里的迁不成,写明原因', () => {
    for (const seed of [7, 2024]) {
      const civ = base(seed);
      const y = 2000;
      const { p, s } = bigPolityCity(civ, y);
      const k = polityKey(civ, p);
      const v: Intervention = { kind: 'move', a: k, city: settlementKey(civ, s), from: y };
      const c = generateCiv(world(seed), { interventions: [v] });
      samePast(seed, v, c);
      const id = idOf(c, k);
      expect(capitalAt(c.polities[id], y), `seed ${seed}:迁都到 ${civ.settlements[s].name}`).toBe(s);
      const i = c.annals.findIndex((e) => e.kind === 'intervene');
      expect(c.annals[i + 1]).toMatchObject({ kind: 'capital', a: id, settlement: s, year: y });
      expect(ivText(c)[0]).toMatch(new RegExp(`^【干预】.+迁都${civ.settlements[s].name}$`));
      // 迁都那条 capital 并进干预那一条
      expect(buildChronicle(c).some((e) => e.kind === 'capital' && e.id === i + 1)).toBe(false);
      // 别国的城:迁不成
      const own = ownersAt(civ, y - 0.01).polity;
      const foreign = civ.settlements.find((x) => own[x.region] >= 0 && own[x.region] !== p && x.founded < y && (x.ended ?? Infinity) > y)!;
      const c2 = generateCiv(world(seed), { interventions: [{ kind: 'move', a: k, city: settlementKey(civ, foreign.id), from: y }] });
      expect(capitalAt(c2.polities[idOf(c2, k)], y)).toBe(capitalAt(civ.polities[p], y));
      expect(ivText(c2)[0]).toMatch(/^【干预】.+欲迁都.+,然.+属.+$/);
      expect(interventionOutcome(c2, 0)).toMatchObject({ ok: false, why: expect.stringMatching(/不在本国国土里/) });
    }
  }, 180_000);

  it('不许扩张:禁令期间国土不增、不主动宣战;到期后接着扩张', () => {
    for (const seed of [7, 2024]) {
      const civ = base(seed);
      const { a, b, p } = expansion(civ);
      const k = polityKey(civ, p);
      expect(sizeAt(civ, p, b) - sizeAt(civ, p, a), `seed ${seed}:原本扩张了`).toBeGreaterThan(5);
      for (const until of [undefined, a + 400]) {
        const v: Intervention = until ? { kind: 'halt', a: k, from: a, until } : { kind: 'halt', a: k, from: a };
        const c = generateCiv(world(seed), { interventions: [v] });
        samePast(seed, v, c);
        const id = idOf(c, k);
        const end = until ?? c.endYear;
        const n0 = sizeAt(c, id, a);
        // 禁令期间一州不多(被打时丢了的州反攻夺回不算扩张:不超过开头的州数)
        for (let y = a; y < end; y += 50) expect(sizeAt(c, id, y), `seed ${seed} 第 ${y} 年`).toBeLessThanOrEqual(n0);
        // 不主动宣战(也不援盟);讨伐据地自立的宗室、起事的饥民(平叛)不算
        expect(
          c.annals.filter((e) => e.kind === 'war' && e.a === id && e.year >= a && e.year < end && e.cause !== 'heir' && e.cause !== 'quell').map((e) => [e.year, e.cause, e.b]),
        ).toEqual([]);
        // 到期后又能扩张、主动开战(GENERATOR_VERSION 43 仗打得密以后,到期后有的国家先扩张、后来又被邻国打得只剩几州:
        // 不再只比第 b 年的州数,看到期后的两百年里有没有长过、开过战)
        if (until) {
          const grew = Array.from({ length: 20 }, (_, i) => until + 10 * (i + 1)).some((y) => y <= b && sizeAt(c, id, y) > sizeAt(c, id, until));
          const waged = c.annals.some((e) => e.kind === 'war' && e.a === id && e.year >= until && e.year < b && e.cause !== 'heir' && e.cause !== 'quell');
          expect(grew || waged, `seed ${seed}:到期后接着扩张`).toBe(true);
        }
        expect(ivText(c)[0]).toMatch(until ? new RegExp(`不再开疆拓土,至第 ${until} 年`) : /不再开疆拓土/);
      }
    }
  }, 180_000);
});

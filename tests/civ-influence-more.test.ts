/**
 * 第二批影响口(gen/civ/influence.ts 里 revolt.odds 往后的那些,先是按国的、后是按州的):各口往对的方向推;
 * 读口 wars() 的目标、年限算上插件交的倍数;存下接着推、分段推都和一口气推完一样。
 * 交不影响的数和不装一样、几个插件交的乘在一起,在 civ-influence.test.ts(NEUTRAL 里有这一批)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startCiv, startContinue, type Civ, type CivParams } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { influencesFor } from '../src/gen/civ/engine/influence';
import { OFFICIAL_INFLUENCES, oddsTimes } from '../src/gen/civ/influence';
import { resumeCiv } from '../src/gen/civ/modules';
import { simRead } from '../src/gen/civ/simRead';
import { effOf, polityModelOf } from '../src/gen/civ/polities';
import { goalOf, lengthOf, warModelOf } from '../src/gen/civ/wars';
import type { Annal } from '../src/gen/civ/types';
import { PLAGUE_IV } from '../src/gen/civ/calamity';
import { populationAt } from '../src/gen/civ/growth';
import { settlementKey } from '../src/gen/edits';
import { mulberry32, subSeed } from '../src/gen/util';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { POLITY_MORE, REGION_MORE, parity, steady, swayMore } from './lib/influencePlugins';

const PARAMS = { ...DEFAULT_PARAMS, cells: 12000 };
const worlds = new Map<number, World>();
function worldOf(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...PARAMS, seed })));
  return w;
}

const bytes = (v: unknown) => {
  const x = packValue(v);
  return Buffer.from(x.buffer, x.byteOffset, x.byteLength);
};
function sameBytes(a: Civ, b: Civ, label: string) {
  const same = bytes(a).equals(bytes(b));
  if (!same) expect(civDiff(a, b), label).toBeNull();
  expect(same, label).toBe(true);
}
function sameCiv(a: Civ, b: Civ, label: string) {
  expect(civDiff(a, b), label).toBeNull();
  expect(bytes(a.simPlugins).equals(bytes(b.simPlugins)), `${label}:插件的状态`).toBe(true);
}
const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;

const count = (c: Civ, kind: string, keep: (e: Annal, i: number) => boolean = () => true) => c.annals.filter((e, i) => e.kind === kind && keep(e, i)).length;
/** 和第 i 条史事同一刻、紧挨着的上一条 / 下一条 */
const prev = (c: Civ, i: number): Annal | undefined => (i > 0 && c.annals[i - 1].year === c.annals[i].year ? c.annals[i - 1] : undefined);
const next = (c: Civ, i: number): Annal | undefined => (c.annals[i + 1]?.year === c.annals[i].year ? c.annals[i + 1] : undefined);
const samePair = (x: Annal, y: Annal) => (x.a === y.a && x.b === y.b) || (x.a === y.b && x.b === y.a);
const warCause = (c: Civ, id: number) => c.annals.find((e) => e.kind === 'war' && e.war === id)?.cause;
const restores = (c: Civ) => c.polities.filter((p) => p.restores !== undefined).length;

/** 各口交 0 时不该再有的事:看邦交、看内政时自己起的那几种(别处起的同一种史事按紧挨着的那一条分开) */
const ZERO: [string, (c: Civ) => number][] = [
  ['revolt.odds', (c) => count(c, 'revolt')],
  // 大迁徙攻破国都当即崩的不算
  ['collapse.odds', (c) => count(c, 'collapse', (_, i) => !(prev(c, i)?.kind === 'peace' && warCause(c, prev(c, i)!.war) === 'trek'))],
  ['claim.odds', (c) => count(c, 'split', (e) => e.cause === 'heir')],
  // 议事破裂起的割据不算
  ['warlord.odds', (c) => count(c, 'warlord', (e, i) => !(prev(c, i)?.kind === 'council' && prev(c, i)!.a === e.a))],
  // 并入自己的宗主和宗主吞并藩属记的是同一种,只看不是藩属的
  ['merge.odds', (c) => count(c, 'merge', (e) => e.cause === undefined)],
  ['alliance.odds', (c) => count(c, 'alliance')],
  // 战败称臣带战争编号
  ['submit.odds', (c) => count(c, 'submit', (e) => e.war < 0)],
  // 宣战时顺带断的(紧跟着两国之间的宣战,宗主讨伐的除外)不算
  ['defect.odds', (c) => count(c, 'defect', (e, i) => !((n) => n && n.kind === 'war' && samePair(n, e) && n.cause !== 'punish')(next(c, i)))],
  // 议和、续约、作者下令的带由头
  ['treaty.odds', (c) => count(c, 'treaty', (e) => e.cause === undefined)],
  // 议和时和亲带战争编号
  ['marry.odds', (c) => count(c, 'marry', (e) => e.war < 0)],
  ['aid.odds', (c) => count(c, 'war', (e) => e.cause === 'ally')],
];
const zeroOf = (k: string) => ZERO.find(([x]) => x === k)![1];

/** 议和了结的仗(讨伐民变、争位的内战除外)平均打了几年 */
function warYears(c: Civ): number {
  const start = new Map<number, Annal>();
  for (const e of c.annals) if (e.kind === 'war') start.set(e.war, e);
  let sum = 0;
  let n = 0;
  for (const e of c.annals) {
    const s = e.kind === 'peace' ? start.get(e.war) : undefined;
    if (!s || s.cause === 'quell' || s.cause === 'heir') continue;
    sum += e.year - s.year;
    n++;
  }
  return sum / n;
}

describe('第二批按国的影响口:往对的方向推(推 3000 年)', () => {
  it('交 0:民变、大崩解、宗室争位、新起割据、合并、结盟、称臣、藩属自立、立约、结亲、援盟都不再自己发生', () => {
    const zeros = Object.fromEntries(ZERO.map(([k]) => [k, 0]));
    const seen = new Map<string, number>();
    // seed 4:小国并入大国、立约在 seed 7 上一次都没有
    for (const seed of [7, 4]) {
      const w = worldOf(seed);
      const base = generateCiv(w);
      const zero = generateCiv(w, { plugins: [steady('p', zeros, 5)] });
      for (const [k, f] of ZERO) {
        expect(f(zero), `seed ${seed} ${k}`).toBe(0);
        seen.set(k, (seen.get(k) ?? 0) + f(base));
      }
    }
    for (const [k] of ZERO) expect(seen.get(k), `官方推出来有 ${k} 管的事`).toBeGreaterThan(0);
  }, 120_000);

  it('交 4:民变、宗室争位、新起割据、结盟、结亲都多了;复国 ×4 多、×0 少', () => {
    const more = ['revolt.odds', 'claim.odds', 'warlord.odds', 'alliance.odds', 'marry.odds'];
    for (const seed of [7, 2024]) {
      const w = worldOf(seed);
      const base = generateCiv(w);
      for (const k of more) expect(zeroOf(k)(generateCiv(w, { plugins: [steady('p', { [k]: 4 }, 5)] })), `seed ${seed} ${k}`).toBeGreaterThan(zeroOf(k)(base));
      // 大崩解、议事破裂、起兵自立的新国都正好是同族亡国的故都也算复国,交 0 只是少了
      expect(restores(generateCiv(w, { plugins: [steady('p', { 'restore.odds': 4 }, 5)] })), `seed ${seed} 复国 ×4`).toBeGreaterThan(restores(base));
      expect(restores(generateCiv(w, { plugins: [steady('p', { 'restore.odds': 0 }, 5)] })), `seed ${seed} 复国 ×0`).toBeLessThan(restores(base));
    }
  }, 120_000);

  it('结亲按娶亲的那一国:双号国 ×0、单号国 ×4,看邦交时娶亲的(连互嫁的那一头)都是单号国', () => {
    for (const seed of [7, 2024]) {
      const w = worldOf(seed);
      const grooms = (c: Civ) => c.annals.filter((e) => e.kind === 'marry' && e.war < 0).map((e) => e.a);
      expect(grooms(generateCiv(w)).some((a) => a % 2 === 0), `seed ${seed} 官方有双号国娶亲`).toBe(true);
      const odd = grooms(generateCiv(w, { plugins: [parity('p', 'marry.odds', 0, 4, 5)] }));
      expect(odd.length).toBeGreaterThan(0);
      expect(odd.filter((a) => a % 2 === 0), `seed ${seed}`).toEqual([]);
    }
  }, 120_000);

  it('赔率交 0 就是 0:官方算出来是 Infinity 也一样(不得 NaN)', () => {
    const col = Float64Array.of(0, 2);
    expect(oddsTimes(Infinity, col, 0)).toBe(0);
    expect(oddsTimes(0.3, col, 0)).toBe(0);
    expect(oddsTimes(0.3, col, 1)).toBe(0.6);
    expect(oddsTimes(0.3, col, 5)).toBe(0.3);
  });

  it('一场仗打多久 ×¼ 短得多、×4 长;想拿几州换了以后历史跟着变', () => {
    for (const seed of [7, 2024]) {
      const w = worldOf(seed);
      const base = generateCiv(w);
      expect(warYears(generateCiv(w, { plugins: [steady('p', { 'war.length': 0.25 }, 5)] })), `seed ${seed} ×¼`).toBeLessThan(0.8 * warYears(base));
      expect(warYears(generateCiv(w, { plugins: [steady('p', { 'war.length': 4 }, 5)] })), `seed ${seed} ×4`).toBeGreaterThan(warYears(base));
      // 官方的仗多半是灭国之战(不看目标)、或者打到僵持、年限、攻破国都才停,目标难得管用:这里只看历史变了,数在下面读口那条对
      for (const x of [0.25, 4]) expect(bytes(generateCiv(w, { plugins: [steady('p', { 'war.goal': x }, 5)] })).equals(bytes(base)), `seed ${seed} 想拿几州 ×${x}`).toBe(false);
    }
  }, 120_000);
});

/** 自己起的瘟疫(不算全球大疫)每一场一共染了几州 */
function outbreakSizes(c: Civ): number[] {
  const by = new Map<number, number>();
  for (const e of c.annals) if (e.kind === 'plague' && e.cause !== 'pandemic') by.set(e.war, (by.get(e.war) ?? 0) + e.b);
  return [...by.values()];
}

describe('第二批按州的影响口:往对的方向推(推 3000 年)', () => {
  it('交 0:洗劫、毁城、重建、饥荒、民族分化、大迁徙都不再自己发生,自己起的瘟疫不往外传', () => {
    const rows: [string, (c: Civ) => number][] = [
      ['sack.odds', (c) => count(c, 'sack')],
      ['rebuild.odds', (c) => count(c, 'rebuild')],
      ['famine.odds', (c) => count(c, 'famine')],
      ['diverge.odds', (c) => count(c, 'diverge')],
      ['trek.odds', (c) => c.migrations?.length ?? 0],
      ['plague.spread', (c) => outbreakSizes(c).filter((n) => n > 1).length],
    ];
    for (const seed of [7, 2024]) {
      const w = worldOf(seed);
      const base = generateCiv(w);
      // 毁城单独推:城不毁就没有重建
      const zero = generateCiv(w, { plugins: [steady('p', Object.fromEntries(rows.map(([k]) => [k, 0])), 5)] });
      for (const [k, f] of rows) {
        expect(f(base), `seed ${seed} 官方推出来有 ${k} 管的事`).toBeGreaterThan(0);
        expect(f(zero), `seed ${seed} ${k}`).toBe(0);
      }
      expect(outbreakSizes(zero).length, `seed ${seed} 瘟疫照样起`).toBeGreaterThan(0);
      expect(count(base, 'ruin')).toBeGreaterThan(0);
      expect(count(generateCiv(w, { plugins: [steady('p', { 'ruin.odds': 0 }, 5)] }), 'ruin'), `seed ${seed} ruin.odds`).toBe(0);
    }
  }, 180_000);

  it('瘟疫传开只管自己起的:作者下的瘟疫照样往外传', () => {
    const w = worldOf(7);
    const plugins = [steady('p', { 'plague.spread': 0 }, 5)];
    const zero = generateCiv(w, { plugins, endYear: 1300 });
    let city = -1;
    for (const s of zero.settlements) if (s.ended === undefined && (city < 0 || populationAt(s, 1300) > populationAt(zero.settlements[city], 1300))) city = s.id;
    const c = generateCiv(w, { plugins, interventions: [{ kind: 'disaster', type: 'plague', level: 3, from: 1300, city: settlementKey(zero, city) }] });
    const hit = c.annals.filter((e) => e.kind === 'plague' && e.war === PLAGUE_IV).reduce((n, e) => n + e.b, 0);
    expect(hit).toBeGreaterThan(1);
    expect(outbreakSizes(c).filter((n) => n > 1)).toEqual([hit]);
  }, 60_000);

  it('交 4:洗劫、饥荒、民族分化、大迁徙都多了;守这一州 ×4 攻下的州少、×¼ 多', () => {
    const more: [string, (c: Civ) => number][] = [
      ['sack.odds', (c) => count(c, 'sack')],
      ['famine.odds', (c) => count(c, 'famine')],
      ['diverge.odds', (c) => count(c, 'diverge')],
      ['trek.odds', (c) => c.migrations?.length ?? 0],
    ];
    const conquer = (c: Civ) => count(c, 'conquer', (e) => e.b >= 0);
    for (const seed of [7, 2024]) {
      const w = worldOf(seed);
      const base = generateCiv(w);
      for (const [k, f] of more) expect(f(generateCiv(w, { plugins: [steady('p', { [k]: 4 }, 5)] })), `seed ${seed} ${k}`).toBeGreaterThan(f(base));
      expect(conquer(generateCiv(w, { plugins: [steady('p', { 'defense.power': 4 }, 5)] })), `seed ${seed} 守 ×4`).toBeLessThan(conquer(base));
      expect(conquer(generateCiv(w, { plugins: [steady('p', { 'defense.power': 0.25 }, 5)] })), `seed ${seed} 守 ×¼`).toBeGreaterThan(conquer(base));
    }
  }, 240_000);
});

describe('读口 wars():还在打的仗的目标、年限算上插件交给 war.goal、war.length 的倍数', () => {
  it.each([7, 2024])('第 1200、1700、2300 年,seed %i:单号国 ×4、双号国 ×¼', (seed) => {
    let checked = 0;
    for (const T of [1200, 1700, 2300]) checked += check(seed, T);
    expect(checked, '有还在打的仗').toBeGreaterThan(0);
  }, 60_000);

  function check(seed: number, T: number): number {
    const w = worldOf(seed);
    const civ = generateCiv(w, { endYear: T });
    const sim = resumeCiv(w, civ);
    const wm = warModelOf(sim)!;
    const pm = polityModelOf(sim)!;
    const before = simRead(sim)!.wars();
    const np = civ.polities.length;
    const inf = influencesFor(OFFICIAL_INFLUENCES, [{ id: 'p', influences: ['war.goal', 'war.length'] }], civ.regions.count)!;
    const col = () => Float64Array.from({ length: np }, (_, p) => (p % 2 ? 4 : 0.25));
    inf.take(0, 'p', { 'war.goal': col(), 'war.length': col() }, np);
    sim.influence = inf;
    const after = simRead(sim)!.wars();
    let checked = 0;
    after.forEach((x, i) => {
      const b = before[i];
      if (x.end !== undefined) return expect([x.goal, x.length]).toEqual([undefined, undefined]);
      const m = x.a % 2 ? 4 : 0.25;
      const war = wm.wars[x.id];
      expect(lengthOf(wm, war, inf)).toBe(lengthOf(wm, war, null) * m);
      expect(x.length, `仗 ${x.id} 的年限`).toBe(b.length! * m);
      if (b.goal !== undefined) {
        const eff = effOf(pm, x.a, T);
        expect(b.goal).toBe(Math.max(1, goalOf(wm, war, null) + eff.goal));
        expect(x.goal, `仗 ${x.id} 的目标`).toBe(Math.max(1, goalOf(wm, war, null) * m + eff.goal));
      } else expect(x.goal).toBeUndefined();
      checked++;
    });
    return checked;
  }
});

describe('第二批影响口:分段推、存下接着推都和一口气推完一样', () => {
  const stepped = (world: World, params: Partial<CivParams>, stops: readonly number[]) => {
    const run = startCiv(world, params);
    for (const t of stops) run.advance(t);
    return run.finish();
  };
  const randomStops = (seed: number, n: number) => {
    const rnd = mulberry32(subSeed(seed, 'influence-more-stops'));
    return Array.from({ length: n }, (_, i) => (i % 2 ? Math.floor(rnd() * 3000) : rnd() * 3000)).sort((a, b) => a - b);
  };

  it('随机停 10 次(seed 7、seed 2024 天灾多);推到 1500、1507.5 存下再接着推', () => {
    for (const [seed, params] of [
      [7, {}],
      [2024, { calamity: 'more' as const }],
    ] as const) {
      const w = worldOf(seed);
      const plugins = [swayMore()];
      const one = generateCiv(w, { ...params, plugins });
      expect(Object.keys(one.simPlugins![0].influences!).sort()).toEqual([...POLITY_MORE, ...REGION_MORE].sort());
      sameBytes(stepped(w, { ...params, plugins }, [...randomStops(seed, 10), 1000 - 1 / 256].sort((a, b) => a - b)), one, `seed ${seed} 分段推`);
      for (const at of [1500, 1507.5]) {
        const saved = roundTrip(generateCiv(w, { ...params, plugins, endYear: at }));
        const run = startContinue(w, saved, { ...params, plugins });
        expect(run, `seed ${seed} 推到 ${at} 接得上`).not.toBeNull();
        sameCiv(run!.finish(), one, `seed ${seed} 推到 ${at} 存下接着推`);
      }
    }
  }, 180_000);
});

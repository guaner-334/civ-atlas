/**
 * 影响口(gen/civ/engine/influence.ts、gen/civ/influence.ts):推演插件交数,官方的决策点乘上或加上。
 * 没有插件接的口照原来的算、交不影响的数和不装一样;各口往对的方向推;几个插件交到同一个口的乘在一起、压回上下限;
 * 分段推、存下接着推、地形大事前后都和一口气推完一样;存进世界文件逐项核对;写错了停下说是哪个插件
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startCiv, startContinue, type Civ, type CivParams } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import type { Upheaval } from '../src/gen/edits';
import { mulberry32, subSeed } from '../src/gen/util';
import { PluginError, type SimPlugin } from '../src/gen/civ/engine/plugin';
import type { SimRead } from '../src/gen/civ/simRead';
import { OFFICIAL_INFLUENCES } from '../src/gen/civ/influence';
import { validateSimState } from '../src/gen/worldValidate';
import { WorldFileError } from '../src/gen/worldFormat';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { NEUTRAL, steady, sway } from './lib/influencePlugins';

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

/** 接着推的:逐字段一样(重建的对象键的先后可以不同),插件的状态逐字节一样 */
function sameCiv(a: Civ, b: Civ, label: string) {
  expect(civDiff(a, b), label).toBeNull();
  expect(bytes(a.simPlugins).equals(bytes(b.simPlugins)), `${label}:插件的状态`).toBe(true);
}

function official(civ: Civ): Civ {
  const { simPlugins: _s, ...rest } = civ;
  void _s;
  return rest;
}

const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;

function stepped(world: World, params: Partial<CivParams>, stops: readonly number[]): Civ {
  const run = startCiv(world, params);
  for (const t of stops) run.advance(t);
  return run.finish();
}

function randomStops(seed: number, to: number, n: number): number[] {
  const rnd = mulberry32(subSeed(seed, 'influence-stops'));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = rnd() * to;
    out.push(i % 2 ? Math.floor(t) : t);
  }
  return out.sort((a, b) => a - b);
}

const mean = (a: ArrayLike<number>, keep: (i: number) => boolean = () => true) => {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (keep(i)) (s += a[i]), n++;
  return n ? s / n : 0;
};
const count = (c: Civ, kind: string) => c.annals.filter((e) => e.kind === kind).length;
/** 各城最后记的人口上限倍数的平均 */
const cityCap = (c: Civ) => mean(c.settlements.filter((s) => s.devCap).map((s) => s.devCap![s.devCap!.length - 1]));
/** 最后一份乡村人口快照的总数 */
const rural = (c: Civ) => mean(c.development!.rural![c.development!.rural!.length - 1]) * c.regions.count;
/** 推完时各国的动荡(还在的国家) */
const unrest = (c: Civ) => {
  const u = c.development!.state!.tables!.data['动荡'];
  return mean(u, (p) => p < c.polities.length && c.polities[p].ended === undefined);
};
/** 推完时有国家的州「管得到几成」的平均 */
const control = (c: Civ) => mean(c.development!.state!.tables!.data['管辖'], (r) => c.polity[r] >= 0);
/** 推完时各州某种能力的平均(有人住的州) */
const ability = (c: Civ, k: number) => {
  const cur = c.development!.state!.cur;
  return mean(Array.from({ length: c.regions.count }, (_, r) => cur[r * 5 + k]), (r) => c.culture[r] >= 0);
};

describe('影响口:没有插件接时照原来的算', () => {
  it('官方登记了六个口,名字、单位、上下限', () => {
    expect(OFFICIAL_INFLUENCES.map((p) => [p.id, p.unit, p.cols ?? 1, p.op, p.min, p.max])).toEqual([
      ['city.capacity', 'region', 1, 'mul', 0.25, 4],
      ['rural.capacity', 'region', 1, 'mul', 0.25, 4],
      ['unrest.add', 'region', 1, 'add', -0.5, 0.5],
      ['dev.rate', 'region', 5, 'mul', 0, 4],
      ['assim.rate', 'region', 1, 'mul', 0, 4],
      ['control.reach', 'polity', 1, 'mul', 0.25, 4],
    ]);
  });

  it('交不影响的数(乘的 1、加的 0)、只接几个口不交数:除了插件的状态,和不装插件逐字节一样', () => {
    for (const [seed, params] of [
      [7, { endYear: 1500 }],
      [2024, { endYear: 1200, calamity: 'more' as const }],
    ] as const) {
      const w = worldOf(seed);
      const base = generateCiv(w, params);
      const n = generateCiv(w, { ...params, plugins: [steady('neutral', NEUTRAL)] });
      sameBytes(official(n), base, `${seed} 不影响的数`);
      expect(Object.keys(n.simPlugins![0].outputs!).sort()).toEqual(Object.keys(NEUTRAL).sort());
      const silent: SimPlugin<SimRead> = { id: 'silent', every: 100, outputs: ['city.capacity', 'dev.rate', 'control.reach'], act: () => {} };
      const s = generateCiv(w, { ...params, plugins: [silent] });
      sameBytes(official(s), base, `${seed} 不交数`);
      expect(s.simPlugins![0].outputs).toBeUndefined();
    }
  }, 120_000);

  it('两个插件交到同一个口的乘在一起、加在一起:×2 和 ×0.5、+0.25 和 −0.25 合起来不影响', () => {
    const w = worldOf(7);
    const base = generateCiv(w, { endYear: 1200 });
    const up = steady('up', { 'city.capacity': 2, 'rural.capacity': 2, 'unrest.add': 0.25, 'dev.rate': 2, 'assim.rate': 2, 'control.reach': 2 });
    const down = steady('down', { 'city.capacity': 0.5, 'rural.capacity': 0.5, 'unrest.add': -0.25, 'dev.rate': 0.5, 'assim.rate': 0.5, 'control.reach': 0.5 });
    sameBytes(official(generateCiv(w, { endYear: 1200, plugins: [up, down] })), base, '合起来不影响');
  }, 60_000);

  it('合起来压回上下限:×3 和 ×3 = ×4;单个插件交的也压回(×9 = ×4)', () => {
    const w = worldOf(7);
    const four = official(generateCiv(w, { endYear: 1000, plugins: [steady('four', { 'city.capacity': 4 })] }));
    sameBytes(official(generateCiv(w, { endYear: 1000, plugins: [steady('a', { 'city.capacity': 3 }), steady('b', { 'city.capacity': 3 })] })), four, '3 × 3');
    const nine = generateCiv(w, { endYear: 1000, plugins: [steady('nine', { 'city.capacity': 9 })] });
    sameBytes(official(nine), four, '9');
    expect(nine.simPlugins![0].outputs!['city.capacity'].every((x) => x === 4)).toBe(true);
  }, 60_000);
});

describe('影响口:往对的方向推', () => {
  const w = () => worldOf(7);
  const END = 1500;
  let base: Civ;
  const run = (vals: Parameters<typeof steady>[1]) => generateCiv(w(), { endYear: END, plugins: [steady('p', vals)] });

  it('城的人口上限、乡村人口上限、管得到的远近、发展快慢、同化、动荡', () => {
    base = generateCiv(w(), { endYear: END });
    // 城的人口上限倍数 ×2:各城最后记的倍数差不多翻倍,仍在 1/32 的格子上
    const city = run({ 'city.capacity': 2 });
    expect(cityCap(city) / cityCap(base)).toBeGreaterThan(1.6);
    for (const s of city.settlements) for (let i = 1; i < (s.devCap?.length ?? 0); i += 2) expect(s.devCap![i] * 32).toBe(Math.round(s.devCap![i] * 32));
    // 乡村人口上限 ×2
    expect(rural(run({ 'rural.capacity': 2 })) / rural(base)).toBeGreaterThan(1.3);
    expect(rural(run({ 'rural.capacity': 0.5 })) / rural(base)).toBeLessThan(0.8);
    // 管得到的远近 ×2 / ×0.5
    expect(control(run({ 'control.reach': 2 }))).toBeGreaterThan(control(base) + 0.05);
    expect(control(run({ 'control.reach': 0.5 }))).toBeLessThan(control(base) - 0.05);
    // 发展快慢:五种能力都 ×2 快、都停下
    const fast = run({ 'dev.rate': 2 });
    const stop = run({ 'dev.rate': 0 });
    for (const k of [0, 1, 2, 3, 4]) {
      expect(ability(fast, k), `能力 ${k} 快`).toBeGreaterThan(ability(base, k));
      expect(ability(stop, k), `能力 ${k} 停`).toBeLessThan(ability(base, k));
    }
    // 同化 ×4 / ×0
    expect(count(run({ 'assim.rate': 4 }), 'assimilate')).toBeGreaterThan(1.3 * count(base, 'assimilate'));
    expect(count(run({ 'assim.rate': 0 }), 'assimilate')).toBeLessThan(0.5 * count(base, 'assimilate'));
    // 动荡 +0.5:第 600 年各国的动荡跟着涨(再往后分裂、亡国多了,剩下的国家不好比);−0.5:分裂少得多
    const at600 = (vals?: Parameters<typeof steady>[1]) => generateCiv(w(), { endYear: 600, plugins: vals ? [steady('p', vals)] : [] });
    expect(unrest(at600({ 'unrest.add': 0.5 }))).toBeGreaterThan(unrest(at600()) + 0.3);
    expect(count(run({ 'unrest.add': -0.5 }), 'split')).toBeLessThan(0.5 * count(base, 'split'));
  }, 180_000);
});

describe('影响口:分段推、存下接着推都和一口气推完一样', () => {
  it('随机停 12 次、带插件出手和约的事的那几刻(seed 7、seed 2024 天灾多)', () => {
    for (const [seed, params] of [
      [7, {}],
      [2024, { calamity: 'more' as const }],
    ] as const) {
      const w = worldOf(seed);
      const plugins = [sway()];
      const one = generateCiv(w, { ...params, plugins });
      const stops = [...randomStops(seed, 3000, 12), 0, 20, 27 + 37 / 256, 400, 1000 - 1 / 256].sort((a, b) => a - b);
      sameBytes(stepped(w, { ...params, plugins }, stops), one, `seed ${seed}`);
    }
  }, 180_000);

  it('推到 1500、1507.5 存下再接着推;推到一半(partial)再接着推', () => {
    const w = worldOf(7);
    const plugins = [sway()];
    const one = generateCiv(w, { plugins });
    expect(Object.keys(one.simPlugins![0].outputs!).length).toBe(6);
    for (const at of [1500, 1507.5]) {
      const saved = roundTrip(generateCiv(w, { plugins, endYear: at }));
      const run = startContinue(w, saved, { plugins });
      expect(run, `${at} 接得上`).not.toBeNull();
      sameCiv(run!.finish(), one, `推到 ${at} 存下接着推`);
    }
    const mid = startContinue(w, roundTrip(generateCiv(w, { plugins, endYear: 700 })), { plugins, endYear: 1900 })!.partial();
    sameCiv(startContinue(w, roundTrip(mid), { plugins })!.finish(), one, '推到一半再接着推');
  }, 120_000);

  it('地形大事前后停、一步跨过两件大事', () => {
    const w = worldOf(7);
    const FLOOD: Upheaval = { year: 1600, ops: [{ kind: 'sink', pts: [1850, 520, 1930, 530, 1903, 469], r: 40, s: 1.1 }] };
    const VOLCANO: Upheaval = { year: 1800, ops: [{ kind: 'volcano', pts: [1169, 764], r: 36, s: 1.1 }] };
    const upheavals = upheavalSteps({ ...PARAMS, seed: 7 }, [], null, [FLOOD, VOLCANO]);
    const params: Partial<CivParams> = { upheavals, plugins: [sway()] };
    const one = generateCiv(w, params);
    expect(one.upheavals?.map((u) => u.year)).toEqual([1600, 1800]);
    const around = (y: number) => [y - 1, y - 1 / 256, y, y + 1 / 256, y + 1];
    sameBytes(stepped(w, params, [...around(1600), ...around(1800)]), one, '地形大事前后');
    sameBytes(stepped(w, params, [1500, 2500]), one, '一步跨过两件大事');
  }, 180_000);
});

describe('影响口:存进世界、写错了', () => {
  it('插件的状态里交给影响口的几栏逐项核对:口名不认识、超出上下限、格数不对都算坏', () => {
    const c = generateCiv(worldOf(2024), { endYear: 300, plugins: [sway()] });
    const s = c.simPlugins![0];
    expect(() => validateSimState(roundTrip(c).simPlugins![0], 'sway')).not.toThrow();
    const o = s.outputs!;
    const bad = (outputs: unknown, hint: string) => expect(() => validateSimState({ ...s, outputs }, 'sway'), hint).toThrow(WorldFileError);
    bad({ ...o, 'magic.power': new Float64Array(3) }, '口名');
    bad({ ...o, 'city.capacity': new Float64Array(o['city.capacity'].length).fill(5) }, '超出上下限');
    bad({ ...o, 'dev.rate': new Float64Array(7).fill(1) }, '格数');
    bad({ ...o, 'unrest.add': Array.from(o['unrest.add']) }, '不是数组');
    // 存下的几栏和插件现在接的口对不上:接不上,从第 0 年重推
    const saved = roundTrip(c);
    const fewer: SimPlugin<SimRead> = { ...sway(), outputs: sway().outputs!.filter((x) => x !== 'dev.rate') };
    expect(startContinue(worldOf(2024), saved, { endYear: 400, plugins: [fewer] })).toBeNull();
    expect(startContinue(worldOf(2024), saved, { endYear: 400, plugins: [sway()] })).not.toBeNull();
  }, 60_000);

  it('写错了:没有的口、写了两次、回话里交了没登记的口、格数不对、不是有限的数、问没登记的口', () => {
    const w = worldOf(7);
    const bad = (p: SimPlugin<SimRead>) => () => generateCiv(w, { endYear: 60, plugins: [p] });
    expect(bad({ id: 'nope', outputs: ['magic.power'], act: () => {} })).toThrow(/没有影响口/);
    expect(bad({ id: 'twice', outputs: ['dev.rate', 'dev.rate'], act: () => {} })).toThrow(/两次/);
    const cases: [SimPlugin<SimRead>, RegExp][] = [
      [{ id: 'undeclared', every: 20, outputs: ['city.capacity'], act: (t) => ({ outputs: { 'rural.capacity': t.output('city.capacity') } }) }, /没有登记/],
      [{ id: 'none', every: 20, act: () => ({ outputs: { 'city.capacity': [1] } }) }, /没有登记/],
      [{ id: 'short', every: 20, outputs: ['dev.rate'], act: (t) => ({ outputs: { 'dev.rate': t.output('dev.rate').subarray(1) } }) }, /要交/],
      [{ id: 'nan', every: 20, outputs: ['unrest.add'], act: (t) => ({ outputs: { 'unrest.add': t.output('unrest.add').fill(NaN) } }) }, /有限/],
      [{ id: 'ask', every: 20, outputs: ['unrest.add'], act: (t) => void t.output('dev.rate') }, /没有登记/],
    ];
    for (const [p, msg] of cases) {
      let err: unknown;
      try {
        generateCiv(w, { endYear: 60, plugins: [p] });
      } catch (e) {
        err = e;
      }
      expect(err, p.id).toBeInstanceOf(PluginError);
      expect((err as PluginError).plugin).toBe(p.id);
      expect((err as Error).message).toMatch(msg);
    }
  }, 60_000);
});

/**
 * 推演插件写的编年史(Civ.simChronicle)和存下的图层(Civ.simLayers):
 * 写了、存了官方的历史一位不差,插件自己的表也不变;编年史照字列进全部条目,改名跟着变;
 * 分段推、存下接着推、地形大事前后停都和一口气推完一样;接不上的从第 0 年重推;写错了停下说是哪个插件
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startCiv, startContinue, type Civ, type CivParams } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { applyNames, polityKey, settlementKey, type Upheaval } from '../src/gen/edits';
import { mulberry32, subSeed } from '../src/gen/util';
import { PluginError, type PluginChronicle, type SimLayerSpec, type SimPlugin } from '../src/gen/civ/engine/plugin';
import type { SimRead } from '../src/gen/civ/simRead';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { chronicleBlock, chronicleOfBlock } from '../src/gen/civ/story/nameTokens';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { ledger, scribe } from './lib/simPlugins';

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

/** 接着推的:逐字段一样,插件推出来的逐字节一样 */
function sameCiv(a: Civ, b: Civ, label: string) {
  expect(civDiff(a, b), label).toBeNull();
  for (const k of ['simChronicle', 'simPlugins', 'simLayers'] as const) expect(bytes(a[k]).equals(bytes(b[k])), `${label}:${k}`).toBe(true);
}

/** 去掉插件推出来的 */
function official(civ: Civ): Civ {
  const { simChronicle: _c, simPlugins: _s, simLayers: _l, ...rest } = civ;
  void _c, _s, _l;
  return rest;
}

const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;

function stepped(world: World, params: Partial<CivParams>, stops: readonly number[]): Civ {
  const run = startCiv(world, params);
  for (const t of stops) run.advance(t);
  return run.finish();
}

const steps = (every: number, to: number) => Array.from({ length: Math.floor(to / every) + 1 }, (_, k) => k * every);

describe('推演插件写的编年史、存下的图层', () => {
  it('写了、存了官方的历史一位不差;只为存图层停的那几刻什么都不做,插件自己的表、事件和不标图层时一样', () => {
    const w = worldOf(7);
    const base = generateCiv(w, { endYear: 1500 });
    const civ = generateCiv(w, { endYear: 1500, plugins: [scribe()] });
    sameBytes(official(civ), base, '官方的历史');
    const plain = generateCiv(w, { endYear: 1500, plugins: [scribe('scribe', false)] });
    expect('simLayers' in plain).toBe(false);
    expect(civ.simChronicle).toEqual(plain.simChronicle);
    const [a, b] = [civ.simPlugins![0], plain.simPlugins![0]];
    for (const k of ['year', 'heard', 'seq', 'events', 'note', 'tables'] as const) expect(bytes(a[k]).equals(bytes(b[k])), k).toBe(true);
    // 标了图层就是另一种设定:存下的状态不能拿给不标图层的接着推
    expect(a.sig).not.toBe(b.sig);

    const lines = civ.simChronicle!;
    expect(lines.length).toBeGreaterThan(20);
    for (let i = 0; i < lines.length; i++) {
      expect(lines[i].by).toBe('scribe');
      expect(lines[i].year).toBeLessThanOrEqual(1500);
      if (i) expect(lines[i].year).toBeGreaterThanOrEqual(lines[i - 1].year);
    }
    for (const k of ['国', '州', '城', '族']) expect(lines.some((l) => new RegExp(`\\{${k}:\\d+\\}`).test(l.text)), k).toBe(true);

    const R = civ.regions.count;
    const [magic, mark] = civ.simLayers!;
    expect(magic).toMatchObject({ by: 'scribe', id: 'magic', title: '魔力浓度', unit: 'region', years: steps(50, 1500), ramp: { colors: ['#f4f0fa', '#5b2a86'], min: 0, max: 100 }, legend: '魔力' });
    expect(mark).toMatchObject({ by: 'scribe', id: 'mark-b', title: '标记', unit: 'region', years: steps(30, 1500) });
    expect(Object.keys(magic)).toEqual(['by', 'id', 'title', 'unit', 'years', 'values', 'ramp', 'legend']);
    expect(magic.values.length).toBe(31 * R);
    expect(mark.values.length).toBe(51 * R);
    // 1500 年正好存一份:最后一份就是插件推完时表里的值
    const tables = a.tables!.tables;
    expect([...magic.values.subarray(30 * R)]).toEqual([...Float32Array.from(tables.magic.cur)]);
    expect([...mark.values.subarray(50 * R)]).toEqual([...Float32Array.from(tables.mark.cur.filter((_, i) => i % 2 === 1))]);
    expect(magic.values.subarray(R, 2 * R).some((x, r) => x !== magic.values[r])).toBe(true);
  }, 120_000);

  it('编年史照字列进全部条目:官方的一条不差,插件的排在同一年官方的后面、名字换好;存下的块改名照样跟着变', () => {
    const w = worldOf(7);
    const base = generateCiv(w, { endYear: 1500 });
    const civ = generateCiv(w, { endYear: 1500, plugins: [scribe()] });
    const full = fullChronicle(civ);
    const mine = full.filter((e) => e.kind === 'plugin');
    expect(full.filter((e) => e.kind !== 'plugin')).toEqual(fullChronicle(base));
    expect(buildChronicle(civ)).toEqual(buildChronicle(base));
    expect(mine.length).toBe(civ.simChronicle!.length);
    expect(new Set(full.map((e) => e.id)).size).toBe(full.length);
    for (const e of mine) {
      expect(e).toMatchObject({ tag: '记', plugin: 'scribe', importance: 2 });
      expect(e.text).not.toMatch(/[{}-]/);
      const i = full.indexOf(e);
      if (i + 1 < full.length) expect(full[i + 1].year > e.year || full[i + 1].kind === 'plugin').toBe(true);
    }
    const founded = civ.simChronicle!.findIndex((l) => l.text.includes('{城:'));
    const e = mine[founded];
    const p = e.polities[0];
    expect(e.settlement).toBeGreaterThanOrEqual(0);
    expect(e.text).toContain(civ.settlements[e.settlement].name);
    expect(e.text).toContain(civ.cultures[civ.polities[p].culture].name);

    const block = chronicleBlock(civ);
    const named = applyNames(civ, { [polityKey(civ, p)]: '饕餮', [settlementKey(civ, e.settlement)]: '不夜城' });
    const shown = chronicleOfBlock(block, named)!.filter((x) => x.kind === 'plugin');
    expect(shown[founded].text).toContain('饕餮');
    expect(shown[founded].text).toContain('不夜城');
    expect(chronicleOfBlock(block, civ)!.filter((x) => x.kind === 'plugin')).toEqual(mine);
  }, 120_000);
});

describe('推演插件写的编年史、存下的图层:分段推、接着推和一口气推完一样', () => {
  const plugins = [scribe(), ledger()];

  it('从第 0 年起随机停,带存图层的那几刻和它们前后', () => {
    const w = worldOf(2024);
    const one = generateCiv(w, { plugins });
    const rnd = mulberry32(subSeed(2024, 'output-stops'));
    const near = (y: number) => [y - 1 / 256, y, y + 1 / 256];
    const stops = [...Array.from({ length: 10 }, () => rnd() * 3000), ...near(30), ...near(50), ...near(1530), ...near(2950)].sort((x, y) => x - y);
    sameBytes(stepped(w, { plugins }, stops), one, '随机停');
  }, 120_000);

  it('推到 1500、1510.5 存下再接着推到 3000;推到一半(partial)再接着推', () => {
    const w = worldOf(7);
    const one = generateCiv(w, { plugins });
    for (const at of [1500, 1510.5]) {
      const saved = roundTrip(generateCiv(w, { plugins, endYear: at }));
      const run = startContinue(w, saved, { plugins });
      expect(run, `${at} 接得上`).not.toBeNull();
      sameCiv(run!.finish(), one, `推到 ${at} 存下接着推`);
    }
    const mid = startContinue(w, roundTrip(generateCiv(w, { plugins, endYear: 700 })), { plugins, endYear: 1900 })!.partial();
    expect(mid.simLayers?.[0].years.at(-1)).toBe(1900);
    const rest = startContinue(w, roundTrip(mid), { plugins });
    expect(rest).not.toBeNull();
    sameCiv(rest!.finish(), one, '推到一半再接着推');
  }, 120_000);

  it('地形大事前后停:先存的几份图层补成新的州数,多出来的州不画', () => {
    const w = worldOf(7);
    const VOLCANO: Upheaval = { year: 1800, ops: [{ kind: 'volcano', pts: [1169, 764], r: 36, s: 1.1 }] };
    const upheavals = upheavalSteps({ ...PARAMS, seed: 7 }, [], null, [VOLCANO]);
    const params: Partial<CivParams> = { upheavals, endYear: 2200, plugins };
    const one = generateCiv(w, params);
    sameBytes(official(one), generateCiv(w, { upheavals, endYear: 2200 }), '官方的历史');
    const R = one.regions.count;
    const before = one.eras![0].regions.count;
    const magic = one.simLayers![0];
    expect(magic.values.length).toBe(magic.years.length * R);
    if (R > before) expect(Number.isNaN(magic.values[before])).toBe(true);
    sameBytes(stepped(w, params, [1700, 1800 - 1 / 256, 1800, 1800 + 1 / 256, 1850]), one, '地形大事前后');
  }, 120_000);

  it('存下的编年史、图层和给的插件对不上(设定改了、被改过):接不上,从第 0 年重推', () => {
    const w = worldOf(7);
    const saved = roundTrip(generateCiv(w, { endYear: 600, plugins: [scribe()] }));
    expect(startContinue(w, saved, { endYear: 900, plugins: [scribe()] })).not.toBeNull();
    expect(startContinue(w, saved, { endYear: 900, plugins: [scribe('scribe', false)] })).toBeNull();
    const [magic, mark] = saved.simLayers!;
    const tampered: Civ[] = [
      { ...saved, simLayers: [magic] },
      { ...saved, simLayers: [{ ...magic, years: magic.years.slice(1) }, mark] },
      { ...saved, simLayers: [{ ...magic, title: '别的' }, mark] },
      { ...saved, simLayers: [magic, { ...mark, by: 'other' }] },
      { ...saved, simChronicle: [...saved.simChronicle!, { year: 300, by: 'scribe', text: '晚到的' }] },
      { ...saved, simChronicle: [{ year: 10, by: 'other', text: '谁写的' }] },
      { ...saved, simChronicle: [{ year: 10, by: 'scribe', text: '{国:99999}' }] },
    ];
    for (const [i, c] of tampered.entries()) expect(startContinue(w, c, { endYear: 900, plugins: [scribe()] }), `第 ${i} 种`).toBeNull();
  }, 60_000);
});

describe('推演插件写的编年史、标的图层:写错了', () => {
  /** 第 40 年那一回写这几句 */
  const writer = (chronicle: unknown): SimPlugin<SimRead> => ({ id: 'writer', every: 10, act: (t) => (t.year === 40 ? { chronicle: chronicle as PluginChronicle[] } : undefined) });

  it('编年史写错了:停在那一刻,说是哪个插件', () => {
    const w = worldOf(2024);
    const cases: [unknown, RegExp][] = [
      [[{ text: '{国:a}亡', refs: { b: 0 } }], /refs 里没有/],
      [[{ text: '{国:a}亡', refs: { a: 99999 } }], /不在 0 到/],
      [[{ text: '{国:12}亡' }], /字母开头/],
      [[{ text: '{州:a}', refs: { a: 1.5 } }], /不在 0 到/],
      [[{ text: '字'.repeat(81) }], /最多 80/],
      [[{ text: '{州:r}'.repeat(9), refs: { r: 0 } }], /最多 8 个占位符/],
      [[{ text: 'p1' }], /认不出的字/],
      [[{ text: '' }], /空的/],
      [[{ text: 7 }], /要是字/],
      [[{ text: '亡', refs: [0] }], /refs 要是一个对象/],
      [['亡'], /对象/],
      [{ text: '亡' }, /chronicle 要是一个数组/],
      [Array.from({ length: 2001 }, () => ({ text: '又一年' })), /最多写 2000 句/],
    ];
    for (const [chronicle, msg] of cases) {
      const run = startCiv(w, { endYear: 100, plugins: [writer(chronicle)] });
      run.advance(30);
      let err: unknown;
      try {
        run.advance(60);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(chronicle).slice(0, 60)).toBeInstanceOf(PluginError);
      expect((err as PluginError).plugin).toBe('writer');
      expect((err as Error).message).toMatch(msg);
    }
    // 模板里不是占位符的括号原样留着
    const ok = generateCiv(w, { endYear: 100, plugins: [writer([{ text: '{国:{州:r}}、{族} 与 {天:a}', refs: { r: 3 } }])] });
    expect(ok.simChronicle).toEqual([{ year: 40, by: 'writer', text: '{国:{州:3}}、{族} 与 {天:a}' }]);
  }, 60_000);

  it('图层标错了:装的时候就说是哪个插件', () => {
    const w = worldOf(7);
    const base = scribe();
    const layer = base.layers![0];
    const bad = (layers: SimLayerSpec[]) => () => generateCiv(w, { endYear: 5, plugins: [{ ...base, layers }] });
    expect(bad([{ ...layer, table: 'none' }])).toThrow(/没有/);
    expect(bad([{ ...layer, table: 'mark' }])).toThrow(/一栏/);
    expect(bad([{ ...layer, table: 'mark', col: '丙' }])).toThrow(/一栏/);
    expect(bad([{ ...layer, keep: 0 }])).toThrow(/keep/);
    expect(bad([{ ...layer, keep: 2.5 }])).toThrow(/keep/);
    expect(bad([{ ...layer, id: 'Magic' }])).toThrow(/图层编号/);
    expect(bad([{ ...layer, id: 'a'.repeat(26) }])).toThrow(/图层编号/);
    expect(bad([{ ...layer, ramp: undefined }])).toThrow(/ramp 和 classes/);
    expect(bad([{ ...layer, ramp: { colors: ['red', 'blue'] } }])).toThrow(/#rrggbb/);
    expect(bad([layer, layer])).toThrow(/两次/);
    expect(bad(['a', 'b', 'c', 'd', 'e'].map((id) => ({ ...layer, id })))).toThrow(/最多 4 个图层/);
    // 表里的数超出单精度能存的:图层里压到最大,不变成无穷大
    const huge: SimPlugin<SimRead> = {
      id: 'huge',
      tables: [{ id: 'big', name: '大', unit: 'region', every: 5, min: -1e41, max: 1e41, init: 1e40, off: 0, rate: '0' }],
      layers: [{ id: 'big', table: 'big', keep: 5, title: '大', ramp: { colors: ['#000000', '#ffffff'] } }],
      act: () => {},
    };
    const big = generateCiv(w, { endYear: 10, plugins: [huge] }).simLayers![0];
    expect(big.values.every((x) => x === 3.4028234663852886e38)).toBe(true);
    const polity: SimPlugin<SimRead> = { ...ledger('poly'), layers: [{ id: 'zeal', table: 'zeal', keep: 10, title: '热忱', ramp: { colors: ['#000000', '#ffffff'] } }] };
    expect(() => generateCiv(w, { endYear: 5, plugins: [polity] })).toThrow(/按州记数/);
    try {
      bad([{ ...layer, keep: 0 }])();
    } catch (e) {
      expect(e).toBeInstanceOf(PluginError);
      expect((e as PluginError).plugin).toBe('scribe');
    }
  });
});

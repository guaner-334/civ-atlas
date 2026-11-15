/**
 * 推演插件的数据栏(一城、一族、一种信仰一个数)和按国的表标的图层:
 * 数据栏的格数跟着城、民族、信仰的数走,后来的补 off,交回的压回上下限,官方的历史一位不差;
 * 按国的表存图层时照此刻的归属摊到各州(不归哪国的州不画),存进世界文件、读回来照样有;
 * 存一半接着推、地形大事前后停都和一口气推完一样;设定改了接不上;写错了停下说是哪个插件
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startCiv, startContinue, type Civ, type CivParams } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import type { Upheaval } from '../src/gen/edits';
import { PluginError, type SimColumn, type SimPlugin } from '../src/gen/civ/engine/plugin';
import type { SimRead } from '../src/gen/civ/simRead';
import { civDiff } from '../scripts/lib/resumeFuzz';

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
const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;

function sameCiv(a: Civ, b: Civ, label: string) {
  expect(civDiff(a, b), label).toBeNull();
  for (const k of ['simChronicle', 'simPlugins', 'simLayers'] as const) expect(bytes(a[k]).equals(bytes(b[k])), `${label}:${k}`).toBe(true);
}

function official(civ: Civ): Civ {
  const { simChronicle: _c, simPlugins: _s, simLayers: _l, ...rest } = civ;
  void _c, _s, _l;
  return rest;
}

const COLUMNS: SimColumn[] = [
  { id: 'walls', unit: 'settlement', min: 0, max: 100, off: 10 },
  { id: '士气', unit: 'culture', min: -1, max: 1, off: 0 },
  { id: 'zeal', unit: 'faith', min: 0, max: 5, off: 1 },
];

/** 每回合看到的:几格、此刻有几城几族几种信仰、补上的格子是不是 off、留下的格子是不是上一回交的 */
interface Look {
  year: number;
  lens: number[];
  counts: number[];
  padded: boolean;
  kept: boolean;
}

/**
 * 记城防、民族士气、信仰热度的插件:每 every 年出手,每格照随机数涨落(会冲过上下限)。
 * looks 给了就记每回合看到的(只在一口气推的时候用:接着推时插件从头装,闭包里的不带过去)
 */
function keeper(id = 'keeper', every = 20, looks?: Look[], columns: SimColumn[] = COLUMNS): SimPlugin<SimRead> {
  let last: Float64Array[] | null = null;
  return {
    id,
    every,
    columns,
    act(turn) {
      const cols = columns.map((c) => turn.column(c.id));
      if (looks) {
        const r = turn.read;
        const counts = [r.settlements().length, r.cultures().length, r.faiths().length];
        const prev = last ?? cols.map(() => new Float64Array(0));
        looks.push({
          year: turn.year,
          lens: cols.map((c) => c.length),
          counts,
          padded: cols.every((c, k) => c.subarray(prev[k].length).every((x) => x === columns[k].off)),
          kept: cols.every((c, k) => prev[k].every((x, i) => x === c[i])),
        });
      }
      const out: Record<string, Float64Array> = {};
      cols.forEach((c, k) => {
        const span = columns[k].max - columns[k].min;
        for (let i = 0; i < c.length; i++) c[i] += (turn.rand(i, k, turn.year * 256) - 0.4) * span * 0.5;
        out[columns[k].id] = c;
      });
      last = cols.map((c, k) => c.map((x) => Math.min(columns[k].max, Math.max(columns[k].min, x))));
      return { columns: out };
    },
  };
}

/** 按国的表标图层:每 10 年把各国的国力写进按国的表,每 50 年存一份;seen 记下出手那一刻各州该画的数 */
function banner(seen?: Map<number, Float32Array>): SimPlugin<SimRead> {
  return {
    id: 'banner',
    every: 10,
    tables: [{ id: 'might', name: '国力', unit: 'polity', input: true, min: 0, max: 1e9, off: 0 }],
    layers: [{ id: 'might', table: 'might', keep: 50, title: '各国国力', ramp: { colors: ['#f7fbff', '#08306b'] }, legend: '国力' }],
    act(turn) {
      const might = Float64Array.from(turn.read.polities(), (p) => p.power);
      if (seen) {
        const owner = turn.read.owners('polity');
        seen.set(turn.year, Float32Array.from(owner, (p) => (p < 0 ? NaN : might[p])));
      }
      return { tables: { might } };
    },
  };
}

describe('推演插件的数据栏', () => {
  it('格数跟着城、民族、信仰的数走,后来的补 off、留下的照上一回交的;交回的压回上下限;官方的历史一位不差', () => {
    const w = worldOf(7);
    const looks: Look[] = [];
    const civ = generateCiv(w, { endYear: 1500, plugins: [keeper('keeper', 20, looks)] });
    expect(looks.length).toBe(76);
    for (const l of looks) {
      expect(l.lens, `第 ${l.year} 年`).toEqual(l.counts);
      expect(l.padded && l.kept, `第 ${l.year} 年`).toBe(true);
    }
    // 城、民族、信仰都后来变多过(补格子真走到了)
    for (let k = 0; k < 3; k++) expect(looks.at(-1)!.counts[k], COLUMNS[k].id).toBeGreaterThan(looks[0].counts[k]);
    const cols = civ.simPlugins![0].columns!;
    expect(Object.keys(cols)).toEqual(COLUMNS.map((c) => c.id));
    COLUMNS.forEach((c, k) => {
      expect(cols[c.id].length).toBe(looks.at(-1)!.counts[k]);
      expect(cols[c.id].every((x) => x >= c.min && x <= c.max)).toBe(true);
      // 冲过上下限的压回来了
      expect(cols[c.id].some((x) => x === c.max)).toBe(true);
    });
    expect(bytes(official(civ)).equals(bytes(generateCiv(w, { endYear: 1500 })))).toBe(true);
  }, 120_000);

  it('没登记数据栏的插件:状态里没有 columns', () => {
    const civ = generateCiv(worldOf(7), { endYear: 100, plugins: [banner()] });
    expect('columns' in civ.simPlugins![0]).toBe(false);
  }, 60_000);
});

describe('按国的表标的图层', () => {
  it('存的那一刻照归属摊到各州,不归哪国的州不画;格式和按州的一样', () => {
    const w = worldOf(2024);
    const seen = new Map<number, Float32Array>();
    const civ = generateCiv(w, { endYear: 1000, plugins: [banner(seen)] });
    const layer = civ.simLayers![0];
    const R = civ.regions.count;
    expect(layer).toMatchObject({ by: 'banner', id: 'might', unit: 'region', title: '各国国力' });
    expect(layer.years).toEqual(Array.from({ length: 21 }, (_, k) => k * 50));
    let blank = 0;
    let changed = false;
    layer.years.forEach((y, k) => {
      const frame = layer.values.subarray(k * R, (k + 1) * R);
      const want = seen.get(y)!;
      expect(frame.every((x, r) => Object.is(x, want[r])), `第 ${y} 年`).toBe(true);
      blank += frame.filter((x) => Number.isNaN(x)).length;
      if (k > 0 && frame.some((x, r) => !Object.is(x, layer.values[(k - 1) * R + r]))) changed = true;
    });
    expect(blank).toBeGreaterThan(0);
    expect(changed).toBe(true);
  }, 120_000);

  it('只为存图层停的一刻:新起的国还没进表的取 off', () => {
    const w = worldOf(7);
    const plugin: SimPlugin<SimRead> = {
      id: 'late',
      every: 100,
      tables: [{ id: 'might', name: '国力', unit: 'polity', input: true, min: 0, max: 1e9, off: -1 }],
      layers: [{ id: 'might', table: 'might', keep: 10, title: '各国国力', ramp: { colors: ['#f7fbff', '#08306b'] } }],
      act: (turn) => ({ tables: { might: Float64Array.from(turn.read.polities(), (p) => p.id + 1) } }),
    };
    const civ = generateCiv(w, { endYear: 400, plugins: [plugin] });
    const layer = civ.simLayers![0];
    const vals = [...layer.values].filter((x) => !Number.isNaN(x));
    // 表在第 0、100、200……年才写:中间存的几份里,新起的国是 off
    expect(vals.some((x) => x === -1)).toBe(true);
    expect(vals.every((x) => x === -1 || (x >= 1 && Number.isInteger(x)))).toBe(true);
  }, 60_000);
});

describe('数据栏、按国的图层:分段推、接着推和一口气推完一样', () => {
  const plugins = [keeper(), banner()];

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
    const rest = startContinue(w, roundTrip(mid), { plugins });
    expect(rest).not.toBeNull();
    sameCiv(rest!.finish(), one, '推到一半再接着推');
  }, 180_000);

  it('地形大事前后停', () => {
    const w = worldOf(7);
    const VOLCANO: Upheaval = { year: 1800, ops: [{ kind: 'volcano', pts: [1169, 764], r: 36, s: 1.1 }] };
    const upheavals = upheavalSteps({ ...PARAMS, seed: 7 }, [], null, [VOLCANO]);
    const params: Partial<CivParams> = { upheavals, endYear: 2200, plugins };
    const one = generateCiv(w, params);
    expect(bytes(official(one)).equals(bytes(generateCiv(w, { upheavals, endYear: 2200 })))).toBe(true);
    const run = startCiv(w, params);
    for (const t of [1700, 1800 - 1 / 256, 1800, 1800 + 1 / 256, 1850]) run.advance(t);
    sameCiv(run.finish(), one, '地形大事前后');
  }, 180_000);

  it('数据栏的设定改了、存下的被改过:接不上,从第 0 年重推', () => {
    const w = worldOf(7);
    const saved = roundTrip(generateCiv(w, { endYear: 600, plugins: [keeper()] }));
    expect(startContinue(w, saved, { endYear: 900, plugins: [keeper()] })).not.toBeNull();
    const changed = COLUMNS.map((c, k) => (k === 0 ? { ...c, max: 50 } : c));
    expect(startContinue(w, saved, { endYear: 900, plugins: [keeper('keeper', 20, undefined, changed)] })).toBeNull();
    expect(startContinue(w, saved, { endYear: 900, plugins: [keeper('keeper', 20, undefined, COLUMNS.slice(0, 2))] })).toBeNull();
    const s = saved.simPlugins![0];
    const { walls, ...others } = s.columns!;
    const tampered = [{ ...s, columns: others }, { ...s, columns: { ...s.columns!, walls: new Float64Array(walls.length + 1000) } }, { ...s, columns: undefined }];
    for (const [i, x] of tampered.entries()) expect(startContinue(w, { ...saved, simPlugins: [x] }, { endYear: 900, plugins: [keeper()] }), `第 ${i} 种`).toBeNull();
  }, 60_000);
});

describe('数据栏写错了', () => {
  it('登记错了:装的时候就说是哪个插件', () => {
    const w = worldOf(7);
    const bad = (columns: unknown[], tables?: SimPlugin<SimRead>['tables']) => () =>
      generateCiv(w, { endYear: 5, plugins: [{ id: 'cols', columns: columns as SimColumn[], ...(tables ? { tables } : {}), act: () => {} }] });
    const ok = COLUMNS[0];
    expect(bad([{ ...ok, id: '1x' }])).toThrow(/数据栏的名字/);
    expect(bad([{ ...ok, id: 'a b' }])).toThrow(/数据栏的名字/);
    expect(bad([ok, ok])).toThrow(/重名/);
    // 存进世界时当对象的键,这几个名字存不下
    for (const id of ['constructor', 'prototype', '__proto__']) expect(bad([{ ...ok, id }])).toThrow(/数据栏不能叫/);
    expect(bad([ok], [{ id: 'walls', name: '城防', unit: 'world', input: true, min: 0, max: 1, off: 0 }])).toThrow(/重名/);
    expect(bad([{ ...ok, unit: 'region' }])).toThrow(/unit 只能是 settlement、culture、faith/);
    expect(bad([{ ...ok, min: 5, max: 1 }])).toThrow(/上下限/);
    expect(bad([{ ...ok, off: undefined }])).toThrow(/上下限/);
    expect(bad([7])).toThrow(/数据栏的名字/);
    expect(bad(Array.from({ length: 17 }, (_, i) => ({ ...ok, id: `c${i}` })))).toThrow(/最多 16 栏数据/);
    try {
      bad([{ ...ok, unit: 'region' }])();
    } catch (e) {
      expect(e).toBeInstanceOf(PluginError);
      expect((e as PluginError).plugin).toBe('cols');
    }
  });

  it('交错了:停在那一刻,说是哪个插件', () => {
    const w = worldOf(2024);
    /** 第 40 年那一回交这样的回话 */
    const writer = (reply: (n: number) => unknown): SimPlugin<SimRead> => ({
      id: 'writer',
      every: 10,
      columns: [COLUMNS[0]],
      act: (t) => (t.year === 40 ? ({ columns: reply(t.column('walls').length) } as never) : undefined),
    });
    const cases: [(n: number) => unknown, RegExp][] = [
      [(n) => ({ walls: new Float64Array(n + 1) }), /数据栏 walls 要交 \d+ 个数/],
      [(n) => ({ walls: Array.from({ length: n }, () => NaN) }), /数据栏 walls 第 0 个不是有限的数/],
      [(n) => ({ walls: Array.from({ length: n }, () => '1') }), /不是有限的数/],
      [(n) => ({ other: new Float64Array(n) }), /没有数据栏 other/],
      [() => [1, 2], /没有数据栏 0/],
      [() => 7, /columns 要是一个对象/],
      [() => null, /columns 要是一个对象/],
    ];
    for (const [reply, msg] of cases) {
      const run = startCiv(w, { endYear: 100, plugins: [writer(reply)] });
      run.advance(30);
      let err: unknown;
      try {
        run.advance(60);
      } catch (e) {
        err = e;
      }
      expect(err, String(msg)).toBeInstanceOf(PluginError);
      expect((err as PluginError).plugin).toBe('writer');
      expect((err as Error).message).toMatch(msg);
    }
    const reader: SimPlugin<SimRead> = { id: 'reader', every: 10, act: (t) => void t.column('walls') };
    expect(() => generateCiv(w, { endYear: 20, plugins: [reader] })).toThrow(/没有数据栏 walls/);
  }, 60_000);
});

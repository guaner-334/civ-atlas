/**
 * 推演插件那一段(gen/civ/engine/plugin.ts),用测试里写的插件(在推演线程里同步跑):
 * 插件只读不改时官方历史一位不差;分段推、地形大事前后停和一口气推完逐字节一样,存下接着推、逐年接着推逐字段一样(插件的状态逐字节一样);
 * 同一刻官方办完才轮到插件;几个插件按先后出手、各用各的随机数;写错了停下说是哪个插件
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, startCiv, startContinue, type Civ, type CivParams } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { polityKey, type Intervention, type Upheaval } from '../src/gen/edits';
import { mulberry32, subSeed } from '../src/gen/util';
import { tuningPatch } from '../src/gen/civ/tuningPatch';
import { TUNING_CALC } from '../src/gen/civ/tuning';
import { PluginError, type SimPlugin } from '../src/gen/civ/engine/plugin';
import type { SimRead } from '../src/gen/civ/simRead';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { chain, ledger, quiet, type Ledger, type Seen } from './lib/simPlugins';

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

/** 存成原件的字节一样(键的先后、数组的类型、共用的对象都算) */
function sameBytes(a: Civ, b: Civ, label: string) {
  const same = bytes(a).equals(bytes(b));
  if (!same) expect(civDiff(a, b), label).toBeNull();
  expect(same, label).toBe(true);
}

/**
 * 接着推出来的和一口气推的:逐字段一样(接着推重建的对象键的先后可以不同,和没有插件时一样),插件的状态逐字节一样
 */
function sameCiv(a: Civ, b: Civ, label: string) {
  expect(civDiff(a, b), label).toBeNull();
  expect(bytes(a.simPlugins).equals(bytes(b.simPlugins)), `${label}:插件的状态`).toBe(true);
}

/** 去掉插件的状态 */
function official(civ: Civ): Civ {
  const { simPlugins: _s, ...rest } = civ;
  void _s;
  return rest;
}

/** 存下、读回来(和存档、世界文件一样走 packValue) */
const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;

/** 照给的时刻依次停下,再推完 */
function stepped(world: World, params: Partial<CivParams>, stops: readonly number[]): Civ {
  const run = startCiv(world, params);
  for (const t of stops) {
    run.advance(t);
    expect(run.year).toBe(Math.min(t, run.to));
  }
  return run.finish();
}

/** 在 (0, to) 里随机挑 n 个时刻,一半带小数,从小到大 */
function randomStops(seed: number, to: number, n: number): number[] {
  const rnd = mulberry32(subSeed(seed, 'plugin-stops'));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = rnd() * to;
    out.push(i % 2 ? Math.floor(t) : t);
  }
  return out.sort((a, b) => a - b);
}

/** 第 year 年活着、还要再活 200 年的两个国家 */
function twoAlive(civ: Civ, year: number): [number, number] {
  const alive = civ.polities.filter((q) => q.founded < year && (q.ended === undefined || q.ended > year + 200)).map((q) => q.id);
  return [alive[0], alive[1]];
}

describe('推演插件:只读不改时官方历史一位不差', () => {
  it('不装、装了什么都不做的、装了记账的:除了插件的状态,逐字节一样;没装插件的历史里没有插件的状态', () => {
    for (const [seed, params] of [
      [7, { endYear: 1500 }],
      [2024, { endYear: 1200, calamity: 'more' as const, knobs: tuningPatch({ 'war.odds': 4 }, TUNING_CALC) }],
    ] as const) {
      const w = worldOf(seed);
      const base = generateCiv(w, params);
      expect('simPlugins' in base).toBe(false);
      expect('simPlugins' in generateCiv(w, { ...params, plugins: [] })).toBe(false);
      const q = generateCiv(w, { ...params, plugins: [quiet()] });
      sameBytes(official(q), base, `${seed} 什么都不做`);
      expect(q.simPlugins?.map((s) => s.id)).toEqual(['quiet']);
      const l = generateCiv(w, { ...params, plugins: [ledger(), chain()] });
      sameBytes(official(l), base, `${seed} 记账`);
      const n = l.simPlugins![0].note as unknown as Ledger;
      expect(n.ticks).toBe(Math.floor(params.endYear / 20) + 1);
      expect(n.acts).toBeGreaterThan(n.ticks);
      expect(n.heard).toBeGreaterThan(10);
      expect(n.events).toBeGreaterThan(10);
      expect(n.magic).toBeGreaterThan(0);
      expect(n.zeal).toBeGreaterThan(0);
      // 按州的表一州一格、按国的表一国一格
      const tables = l.simPlugins![0].tables!.tables;
      expect(tables.magic.cur.length).toBe(l.regions.count);
      expect(tables.zeal.cur.length).toBe(l.polities.length);
    }
  }, 120_000);

  it('同一刻:官方这一刻的史事都记完了才轮到插件,读口的年份就是这一刻,听到的没有比这一刻晚的,接官方的输入表是这一刻的', () => {
    const w = worldOf(7);
    const seen: Seen[] = [];
    const civ = generateCiv(w, { endYear: 1000, plugins: [ledger('ledger', 5, seen)] });
    expect(seen.filter((s) => s.tick).length).toBe(201);
    expect(seen.some((s) => !Number.isInteger(s.year))).toBe(true);
    for (const s of seen) {
      expect(s.readYear).toBe(s.year);
      expect(s.latestHeard).toBeLessThanOrEqual(s.year);
      expect(s.annals).toBe(civ.annals.filter((e) => e.year <= s.year).length);
      expect(s.fresh).toBe(true);
    }
  }, 60_000);

  it('几个插件:同一刻按给的先后出手;各用各的随机数,多装一个不影响别的插件', () => {
    const w = worldOf(2024);
    const seen: Seen[] = [];
    const both = generateCiv(w, { endYear: 800, plugins: [ledger('a', 20, seen), ledger('b', 10, seen)] });
    for (let i = 1; i < seen.length; i++) {
      const [p, q] = [seen[i - 1], seen[i]];
      expect(q.year >= p.year).toBe(true);
      if (q.year === p.year) expect([p.id, q.id]).toEqual(['a', 'b']);
    }
    const alone = generateCiv(w, { endYear: 800, plugins: [ledger('a', 20)] });
    expect(bytes(both.simPlugins![0]).equals(bytes(alone.simPlugins![0]))).toBe(true);
    // 编号不同,随机数的底子不同:同样的写法约出来的事不一样
    expect(bytes(both.simPlugins![0].events).equals(bytes(generateCiv(w, { endYear: 800, plugins: [ledger('c', 20)] }).simPlugins![0].events))).toBe(false);
  }, 60_000);
});

describe('推演插件:分段推、存下接着推都和一口气推完一样', () => {
  const plugins = [ledger(), chain()];

  it('从第 0 年起随机停 12 次,带插件出手的那几刻和约的事的那几刻(seed 7 官方、seed 2024 天灾 + 改过的规则 + 文明种子)', () => {
    const tuned: Partial<CivParams> = { calamity: 'more', civSeed: 52817, knobs: tuningPatch({ 'war.odds': 4, 'split.odds': 2 }, TUNING_CALC) };
    for (const [seed, params] of [
      [7, {}],
      [2024, tuned],
    ] as const) {
      const w = worldOf(seed);
      const years: number[] = [];
      const one = generateCiv(w, { ...params, plugins: [ledger(), chain('chain', years)] });
      expect(years.some((y) => !Number.isInteger(y))).toBe(true);
      const stops = [...randomStops(seed, 3000, 12), 0, 20, 400, 400 + 1 / 256, 1000 - 1 / 256, ...years.filter((_, i) => i % 25 === 3)].sort((a, b) => a - b);
      sameBytes(stepped(w, { ...params, plugins }, stops), one, `seed ${seed}`);
    }
  }, 180_000);

  it('半年出手一次、表半年算一次:头 2 年每 1/256 年停一次,之后每年停一次', () => {
    const w = worldOf(7);
    const half: SimPlugin<SimRead> = { ...ledger('half', 0.5), tables: ledger().tables!.map((c) => (c.id === 'magic' ? { ...c, every: 0.5 } : c)) };
    const params = { endYear: 120, plugins: [half, chain()] };
    const stops = [...Array.from({ length: 2 * 256 }, (_, i) => i / 256), ...Array.from({ length: 118 }, (_, i) => i + 2)];
    sameBytes(stepped(w, params, stops), generateCiv(w, params), '逐刻、逐年');
  }, 60_000);

  it('推到 1500、1503.5 存下再接着推到 3000;推到一半(partial)再接着推', () => {
    const w = worldOf(7);
    const one = generateCiv(w, { plugins });
    for (const at of [1500, 1503.5]) {
      const saved = roundTrip(generateCiv(w, { plugins, endYear: at }));
      expect(saved.simPlugins?.every((s) => s.year === at)).toBe(true);
      const run = startContinue(w, saved, { plugins });
      expect(run, `${at} 接得上`).not.toBeNull();
      sameCiv(run!.finish(), one, `推到 ${at} 存下接着推`);
    }
    const mid = startContinue(w, roundTrip(generateCiv(w, { plugins, endYear: 700 })), { plugins, endYear: 1900 })!.partial();
    const rest = startContinue(w, roundTrip(mid), { plugins });
    expect(rest).not.toBeNull();
    sameCiv(rest!.finish(), one, '推到一半再接着推');
  }, 120_000);

  it('逐年接着推:每段推随机的几十年、每段都存下读回来,中途接上一条新命令,和带着它一口气推完一样', () => {
    const w = worldOf(2024);
    const base = generateCiv(w, { endYear: 1500 });
    const [a, b] = twoAlive(base, 1200);
    const order: Intervention = { kind: 'declare', a: polityKey(base, a), b: polityKey(base, b), from: 1250 };
    const one = generateCiv(w, { plugins, interventions: [order], endYear: 2000 });
    const rnd = mulberry32(subSeed(2024, 'plugin-turns'));
    let civ = roundTrip(generateCiv(w, { plugins, endYear: 13 }));
    while (civ.endYear < 2000) {
      const to = civ.endYear < 1240 ? Math.min(1240, civ.endYear + 1 + Math.floor(rnd() * 120)) : Math.min(2000, civ.endYear + 1 + Math.floor(rnd() * 120));
      const list = civ.endYear >= 1240 ? [order] : [];
      const run = startContinue(w, civ, { plugins, interventions: list, endYear: to });
      expect(run, `从 ${civ.endYear} 接得上`).not.toBeNull();
      civ = roundTrip(run!.finish());
    }
    sameCiv(civ, roundTrip(one), '逐年接着推');
    // 改过去:改的那年以前插件的状态和没改时一样
    const before = generateCiv(w, { plugins, interventions: [order], endYear: 1249 });
    expect(bytes(before.simPlugins).equals(bytes(generateCiv(w, { plugins, endYear: 1249 }).simPlugins))).toBe(true);
  }, 120_000);

  it('地形大事前后停(插件的表跟着新的州补齐);一步跨过两件大事', () => {
    const w = worldOf(7);
    const FLOOD: Upheaval = { year: 1600, ops: [{ kind: 'sink', pts: [1850, 520, 1930, 530, 1903, 469], r: 40, s: 1.1 }] };
    const VOLCANO: Upheaval = { year: 1800, ops: [{ kind: 'volcano', pts: [1169, 764], r: 36, s: 1.1 }] };
    const upheavals = upheavalSteps({ ...PARAMS, seed: 7 }, [], null, [FLOOD, VOLCANO]);
    const params: Partial<CivParams> = { upheavals, calamity: 'many', plugins };
    const one = generateCiv(w, params);
    expect(one.upheavals?.map((u) => u.year)).toEqual([1600, 1800]);
    expect(one.simPlugins![0].tables!.tables.magic.cur.length).toBe(one.regions.count);
    sameBytes(official(one), generateCiv(w, { upheavals, calamity: 'many' }), '地形大事:官方历史一样');
    const around = (y: number) => [y - 1, y - 1 / 256, y, y + 1 / 256, y + 1];
    sameBytes(stepped(w, params, [...randomStops(7, 3000, 4), ...around(1600), ...around(1800)].sort((x, y) => x - y)), one, '地形大事前后');
    sameBytes(stepped(w, params, [1500, 2500]), one, '一步跨过两件大事');
  }, 180_000);
});

describe('推演插件:接不上、写错了', () => {
  it('存下的插件和这次给的对不上:接不上,照这次给的从第 0 年重推', () => {
    const w = worldOf(7);
    const saved = roundTrip(generateCiv(w, { endYear: 600, plugins: [ledger()] }));
    expect(startContinue(w, saved, { endYear: 900 })).toBeNull();
    expect(startContinue(w, saved, { endYear: 900, plugins: [ledger('other')] })).toBeNull();
    expect(startContinue(w, saved, { endYear: 900, plugins: [ledger(), chain()] })).toBeNull();
    expect(startContinue(w, roundTrip(generateCiv(w, { endYear: 600 })), { endYear: 900, plugins: [ledger()] })).toBeNull();
    // 插件的设定改了(少一张表;表还是那几张、规则改了;频率改了):状态接不上,也从第 0 年重推
    const fewer: SimPlugin<SimRead> = { ...ledger(), tables: ledger().tables!.filter((c) => c.id !== 'zeal') };
    const rule: SimPlugin<SimRead> = { ...ledger(), tables: ledger().tables!.map((c) => (c.id === 'magic' ? { ...c, rate: '0.1 - 0.01 * magic' } : c)) };
    for (const changed of [fewer, rule, ledger('ledger', 10)]) expect(startContinue(w, saved, { endYear: 900, plugins: [changed] })).toBeNull();
    expect(startContinue(w, saved, { endYear: 900, plugins: [ledger()] })).not.toBeNull();
    sameBytes(continueCiv(w, saved, { endYear: 900 }), generateCiv(w, { endYear: 900 }), '去掉插件重推');
  }, 60_000);

  it('约的时刻不比此刻晚、小本子里放字、回话认不出:停在那一刻,说是哪个插件,之后不能再推', () => {
    const w = worldOf(2024);
    const cases: [SimPlugin<SimRead>, RegExp][] = [
      [{ id: 'late', every: 10, act: (t) => (t.year === 50 ? { at: [{ year: 50, kind: 0 }] } : undefined) }, /要比此刻/],
      [{ id: 'words', every: 10, act: (t) => (t.year === 50 ? { note: { a: 'x' as unknown as number } } : undefined) }, /小本子/],
      [{ id: 'typo', every: 10, act: (t) => (t.year === 50 ? ({ notes: [1] } as never) : undefined) }, /认不出/],
      [{ id: 'nan', every: 10, act: (t) => (t.year === 50 ? { note: [NaN] } : undefined) }, /有限/],
      [{ id: 'boom', every: 10, act: (t) => {
        if (t.year === 50) throw new Error('炸了');
      } }, /炸了/],
    ];
    for (const [p, msg] of cases) {
      const run = startCiv(w, { endYear: 300, plugins: [p] });
      run.advance(40);
      let err: unknown;
      try {
        run.advance(100);
      } catch (e) {
        err = e;
      }
      expect(err, p.id).toBeInstanceOf(PluginError);
      expect((err as PluginError).plugin).toBe(p.id);
      expect((err as Error).message).toMatch(msg);
      expect(() => run.advance(200)).toThrow(/不能接着推/);
    }
  }, 60_000);

  it('按国记的表里的随机数按各国的位置锚取:各国不一样', () => {
    const w = worldOf(7);
    const luck: SimPlugin<SimRead> = { id: 'luck', tables: [{ id: 'luck', name: '运气', unit: 'polity', every: 10, min: 0, max: 1e9, init: 0, off: 0, rate: 'rand()' }], act: () => {} };
    const civ = generateCiv(w, { endYear: 1500, plugins: [luck] });
    const cur = civ.simPlugins![0].tables!.tables.luck.cur;
    expect(cur.length).toBe(civ.polities.length);
    expect(new Set(cur).size).toBe(cur.length);
  });

  it('插件本身写错了:频率不在菜单里、按地块的表、编号不对、重复、超过 4 个', () => {
    const w = worldOf(7);
    const bad = (plugins: SimPlugin<SimRead>[]) => () => generateCiv(w, { endYear: 5, plugins });
    expect(bad([{ id: 'odd', every: 3, act: () => {} }])).toThrow(PluginError);
    expect(bad([{ id: 'tile', tables: [{ id: 't', name: 't', unit: 'tile', min: 0, max: 1, off: 0, rule: '0' }], act: () => {} }])).toThrow(/地块/);
    expect(bad([{ id: 'in', tables: [{ id: 't', name: 't', unit: 'region', input: true, min: 0, max: 1, off: 0 }], inputs: { t: 'unrest' }, act: () => {} }])).toThrow(/单位/);
    expect(bad([{ id: 'Bad_Id', act: () => {} }])).toThrow(/编号/);
    expect(bad([{ id: 'long', tables: [{ id: 'a'.repeat(65), name: 't', unit: 'world', min: 0, max: 1, off: 0, rule: '0' }], act: () => {} }])).toThrow(/表名最长/);
    expect(bad([quiet(), quiet()])).toThrow(/两次/);
    expect(bad(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, act: () => {} })))).toThrow(/最多 4 个/);
  });
});

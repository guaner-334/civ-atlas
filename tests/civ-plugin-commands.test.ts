/**
 * 推演插件下命令(PluginReply.commands):和作者下的干预同一套检查、同一套执行,干预列表、史事记着是哪个插件下的;
 * 下了命令以后分段推、地形大事前后停和一口气推完逐字节一样,存下接着推、推到一半再接着推逐字段一样;写错了停下说是哪个插件
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, startCiv, startContinue, type Civ, type CivParams } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { commandYear, polityKey, type Intervention, type Upheaval } from '../src/gen/edits';
import { mulberry32, subSeed } from '../src/gen/util';
import { PluginError, type SimPlugin } from '../src/gen/civ/engine/plugin';
import type { SimRead } from '../src/gen/civ/simRead';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { commander, ledger } from './lib/simPlugins';

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

/** 接着推的:逐字段一样(重建的对象键的先后可以不同),插件的状态、干预列表逐字节一样 */
function sameCiv(a: Civ, b: Civ, label: string) {
  expect(civDiff(a, b), label).toBeNull();
  expect(bytes(a.simPlugins).equals(bytes(b.simPlugins)), `${label}:插件的状态`).toBe(true);
  expect(bytes(a.interventions).equals(bytes(b.interventions)), `${label}:干预列表`).toBe(true);
}

const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;

function stepped(world: World, params: Partial<CivParams>, stops: readonly number[]): Civ {
  const run = startCiv(world, params);
  for (const t of stops) run.advance(t);
  return run.finish();
}

function randomStops(seed: number, to: number, n: number): number[] {
  const rnd = mulberry32(subSeed(seed, 'command-stops'));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = rnd() * to;
    out.push(i % 2 ? Math.floor(t) : t);
  }
  return out.sort((a, b) => a - b);
}

/** 插件下的命令(干预列表里带 plugin 的) */
const commandsOf = (civ: Civ) => (civ.interventions ?? []).filter((v) => v.plugin !== undefined);

/** 第 k 条命令生效的前一格、那一格、后一格(出手那一刻、生效那一刻、之后) */
const around = (civ: Civ, every: number) =>
  commandsOf(civ)
    .filter((_, i) => i % every === 1)
    .flatMap((v) => {
      const t = commandYear(v);
      return [t - 1 / 256, t, t + 1 / 256];
    });

describe('推演插件下命令:照干预办', () => {
  it('命令进干预列表(带 plugin、出手那一刻的下一格生效),生效时记史事 intervene,历史跟着变;不下命令的插件官方历史一位不差', () => {
    const w = worldOf(7);
    const base = generateCiv(w, { endYear: 2000 });
    const civ = generateCiv(w, { endYear: 2000, plugins: [commander()] });
    const cmds = commandsOf(civ);
    expect(cmds.length).toBeGreaterThan(50);
    expect(cmds.length).toBe((civ.simPlugins![0].note as number[])[0]);
    for (const v of cmds) {
      expect(v.plugin).toBe('commander');
      expect(v.fromTick).toBe(1);
      expect(v.from % 20).toBe(0);
    }
    // 史事 intervene 的 war 列就是干预列表的下标,年份是生效那一刻
    const seen = new Set<number>();
    for (const e of civ.annals) {
      if (e.kind !== 'intervene') continue;
      const v = civ.interventions![e.war];
      expect(v.plugin).toBe('commander');
      expect(e.year).toBe(commandYear(v));
      seen.add(e.war);
    }
    expect(seen.size).toBeGreaterThan(cmds.length * 0.8);
    // 下令宣战的打起来了、划州的州归了 a
    const wars = civ.annals.filter((e, i) => e.kind === 'war' && i > 0 && civ.annals[i - 1].kind === 'intervene' && civ.interventions![civ.annals[i - 1].war].kind === 'declare');
    expect(wars.length).toBeGreaterThan(0);
    expect(bytes(civ.annals).equals(bytes(base.annals))).toBe(false);
    // 听干预的插件听到了自己的命令(最后一条在推完以后才生效)
    expect((civ.simPlugins![0].note as number[])[1]).toBe(seen.size);
    // 不下命令的插件:官方历史一位不差,没有干预列表
    const { simPlugins: _s, ...plain } = generateCiv(w, { endYear: 2000, plugins: [ledger()] });
    void _s;
    expect(bytes(plain).equals(bytes(base))).toBe(true);
    expect('interventions' in plain).toBe(false);
  }, 120_000);

  it('作者的干预在前,插件下的接在后面;从第 0 年推时带着的插件命令不当输入(插件再下一遍)', () => {
    const w = worldOf(2024);
    const base = generateCiv(w, { endYear: 1500 });
    const alive = base.polities.filter((q) => q.founded < 900 && (q.ended === undefined || q.ended > 1300)).map((q) => q.id);
    const order: Intervention = { kind: 'protect', a: polityKey(base, alive[0]), from: 900 };
    const civ = generateCiv(w, { endYear: 1500, plugins: [commander()], interventions: [order] });
    expect(civ.interventions![0]).toEqual(order);
    expect(civ.interventions!.slice(1).every((v) => v.plugin === 'commander')).toBe(true);
    sameBytes(generateCiv(w, { endYear: 1500, plugins: [commander()], interventions: civ.interventions }), civ, '带着上次的命令重推');
  }, 120_000);
});

describe('推演插件下命令:分段推、存下接着推都和一口气推完一样', () => {
  it('从第 0 年起随机停,带命令出手的那一刻、生效的那一格前后(seed 7、seed 2024 天灾多)', () => {
    for (const [seed, params] of [
      [7, {}],
      [2024, { calamity: 'more' as const }],
    ] as const) {
      const w = worldOf(seed);
      const p: Partial<CivParams> = { ...params, plugins: [commander(), ledger()] };
      const one = generateCiv(w, p);
      expect(commandsOf(one).length).toBeGreaterThan(80);
      const stops = [...randomStops(seed, 3000, 10), ...around(one, 9)].sort((a, b) => a - b);
      sameBytes(stepped(w, p, stops), one, `seed ${seed}`);
    }
  }, 240_000);

  it('两个插件同一刻都下命令:按插件的先后接进列表、同一格里照这个先后办;存下接着推一样', () => {
    const w = worldOf(2024);
    const plugins = [commander('c1'), commander('c2', 20, ['famine', 'declare', 'cede', 'ally', 'quake', 'trek'])];
    const one = generateCiv(w, { plugins });
    const cmds = commandsOf(one);
    let pairs = 0;
    for (let i = 1; i < cmds.length; i++) {
      if (commandYear(cmds[i]) !== commandYear(cmds[i - 1])) continue;
      expect([cmds[i - 1].plugin, cmds[i].plugin]).toEqual(['c1', 'c2']);
      pairs++;
    }
    expect(pairs).toBeGreaterThan(50);
    sameBytes(stepped(w, { plugins }, [...randomStops(11, 3000, 20), ...around(one, 17)].sort((a, b) => a - b)), one, '分段推');
    for (const at of [1000, 2100 + 1 / 256]) {
      const run = startContinue(w, roundTrip(generateCiv(w, { plugins, endYear: at })), { plugins });
      sameCiv(run!.finish(), one, `推到 ${at} 接着推`);
    }
  }, 240_000);

  it('生效那一格正好有官方按预约先后办的事(攻占):存下接着推,同一格里的先后和一口气推一样', () => {
    const w = worldOf(7);
    const base = generateCiv(w, { endYear: 1500 });
    const hits = base.annals.filter((e) => e.kind === 'conquer' && e.year > 400 && !Number.isInteger(e.year)).slice(0, 1).map((e) => e.year);
    expect(hits.length).toBe(1);
    const t = hits[0];
    const sniper: SimPlugin<SimRead> = {
      id: 'sniper',
      act(turn) {
        if (turn.year === 0) return { at: [{ year: t - 1 / 256, kind: 1 }] };
        const p = turn.read.polities().find((q) => q.ended === undefined && q.size > 0)!;
        return { commands: [{ kind: 'disaster', type: 'famine', level: 1, a: p.id }] };
      },
    };
    const one = generateCiv(w, { endYear: 1500, plugins: [sniper] });
    const at = one.annals.filter((e) => e.year === t).map((e) => e.kind);
    expect(at).toContain('conquer');
    expect(at.indexOf('intervene')).toBeLessThan(at.indexOf('conquer'));
    for (const stop of [t - 1 / 256, t - 1]) {
      const run = startContinue(w, roundTrip(generateCiv(w, { endYear: stop, plugins: [sniper] })), { endYear: 1500, plugins: [sniper] });
      sameCiv(run!.finish(), one, `推到 ${stop} 接着推`);
    }
  }, 120_000);

  it('立国立在没人住的州:插件下的不备新民族,立不成;接着推也一样', () => {
    const w = worldOf(7);
    const empty: SimPlugin<SimRead> = {
      id: 'pioneer',
      every: 100,
      act(t) {
        if (t.year !== 500) return;
        const c = t.read.owners('culture');
        const h = t.read.regions().habitability;
        let r = 0;
        while (r < c.length && !(c[r] < 0 && h[r] > 1)) r++;
        return { commands: [{ kind: 'found', region: r }] };
      },
    };
    const one = generateCiv(w, { endYear: 1200, plugins: [empty] });
    const k = one.annals.findIndex((e) => e.kind === 'intervene');
    expect(k).toBeGreaterThan(0);
    expect(one.annals[k + 1]?.kind === 'found' && one.annals[k + 1].year === one.annals[k].year).toBe(false);
    expect(one.cultures.some((c) => c.pioneer !== undefined)).toBe(false);
    const run = startContinue(w, roundTrip(generateCiv(w, { endYear: 500, plugins: [empty] })), { endYear: 1200, plugins: [empty] });
    sameCiv(run!.finish(), one, '推到出手那一刻接着推');
  }, 120_000);

  it('推到出手那一刻(命令还没生效)、生效那一格、别的时刻存下再接着推;推到一半(partial)再接着推', () => {
    const w = worldOf(7);
    const plugins = [commander(), ledger()];
    const one = generateCiv(w, { plugins });
    for (const at of [1500, 1500 + 1 / 256, 1503.5, 2222]) {
      const saved = roundTrip(generateCiv(w, { plugins, endYear: at }));
      const pending = commandsOf(saved).filter((v) => commandYear(v) > at);
      expect(pending.length, `${at} 有没生效的命令`).toBe(at === 1500 ? 1 : 0);
      const run = startContinue(w, saved, { plugins });
      expect(run, `${at} 接得上`).not.toBeNull();
      sameCiv(run!.finish(), one, `推到 ${at} 存下接着推`);
    }
    const mid = startContinue(w, roundTrip(generateCiv(w, { plugins, endYear: 700 })), { plugins, endYear: 1900 })!.partial();
    expect(commandsOf(mid).length).toBe(commandsOf(one).filter((v) => v.from <= 1900).length);
    const rest = startContinue(w, roundTrip(mid), { plugins });
    expect(rest).not.toBeNull();
    sameCiv(rest!.finish(), one, '推到一半再接着推');
  }, 240_000);

  it('一段段接着推、每段都存下读回来;接着推时只给作者的干预也接得上,作者加了新的从第 0 年重推', () => {
    const w = worldOf(2024);
    const plugins = [commander()];
    const one = generateCiv(w, { plugins, endYear: 2000 });
    const rnd = mulberry32(subSeed(2024, 'command-turns'));
    let civ = roundTrip(generateCiv(w, { plugins, endYear: 13 }));
    while (civ.endYear < 2000) {
      const run = startContinue(w, civ, { plugins, endYear: Math.min(2000, civ.endYear + 1 + Math.floor(rnd() * 150)) });
      expect(run, `从 ${civ.endYear} 接得上`).not.toBeNull();
      civ = roundTrip(run!.finish());
    }
    sameCiv(civ, roundTrip(one), '一段段接着推');
    // 作者的干预在前、插件的命令在后:只给作者的(这里一条都没有)、带着插件下过的,都照存下的那份接着推
    const at = roundTrip(generateCiv(w, { plugins, endYear: 1600 }));
    for (const interventions of [[], at.interventions!]) {
      const run = startContinue(w, at, { plugins, endYear: 2000, interventions });
      expect(run).not.toBeNull();
      sameCiv(roundTrip(run!.finish()), roundTrip(one), `接着推,给了 ${interventions.length} 条干预`);
    }
    // 作者新加的要排在命令前面,史事里命令的下标跟着挪:接不上,从第 0 年重推,和带着它一口气推完一样
    const alive = at.polities.filter((q) => q.ended === undefined && q.founded < 1600).map((q) => q.id);
    const order: Intervention = { kind: 'protect', a: polityKey(at, alive[0]), from: 1650 };
    expect(startContinue(w, at, { plugins, endYear: 2000, interventions: [...at.interventions!, order] })).toBeNull();
    expect(startContinue(w, at, { plugins, endYear: 2000, interventions: [order] })).toBeNull();
    const out = continueCiv(w, at, { plugins, endYear: 2000, interventions: [...at.interventions!, order] });
    sameBytes(out, generateCiv(w, { plugins, endYear: 2000, interventions: [order] }), '作者加了一条');
    expect(out.interventions![0]).toEqual(order);
    expect(out.annals.some((e) => e.kind === 'intervene' && e.war === 0)).toBe(true);
  }, 240_000);

  it('地形大事前后停:两段都下了命令,推到底的那一支也下(各下各的)', () => {
    const w = worldOf(7);
    const FLOOD: Upheaval = { year: 1600, ops: [{ kind: 'sink', pts: [1850, 520, 1930, 530, 1903, 469], r: 40, s: 1.1 }] };
    const VOLCANO: Upheaval = { year: 1800, ops: [{ kind: 'volcano', pts: [1169, 764], r: 36, s: 1.1 }] };
    const upheavals = upheavalSteps({ ...PARAMS, seed: 7 }, [], null, [FLOOD, VOLCANO]);
    const params: Partial<CivParams> = { upheavals, plugins: [commander()] };
    const one = generateCiv(w, params);
    const cmds = commandsOf(one);
    expect(cmds.some((v) => v.from < 1600)).toBe(true);
    expect(cmds.some((v) => v.from > 1800)).toBe(true);
    const near = (y: number) => [y - 1, y - 1 / 256, y, y + 1 / 256, y + 1];
    sameBytes(stepped(w, params, [...randomStops(7, 3000, 4), ...near(1600), ...near(1800), ...around(one, 13)].sort((x, y) => x - y)), one, '地形大事前后');
    sameBytes(stepped(w, params, [1500, 2500]), one, '一步跨过两件大事');
  }, 240_000);
});

describe('推演插件下命令:写错了', () => {
  /** 第 500 年下 cmds 的插件 */
  const once = (id: string, cmds: unknown): SimPlugin<SimRead> => ({ id, every: 10, act: (t) => (t.year === 500 ? ({ commands: cmds } as never) : undefined) });

  it('种类不收、带了推演定的字段、编号不对、清理会改掉的、超过上限:停在那一刻,说是哪个插件、哪一条', () => {
    const w = worldOf(2024);
    const cases: [unknown, RegExp][] = [
      [{ kind: 'protect', a: 0 }, /kind 只能是/],
      [{ kind: 'declare', a: 0, b: 1, from: 50 }, /不能带 from/],
      [{ kind: 'declare', a: 0, b: 1, lead: 3 }, /不能带 lead/],
      [{ kind: 'disaster', type: 'pandemic', level: 2, city: 0 }, /pandemic|plague、famine、quake/],
      [{ kind: 'declare', a: 0, b: 99999 }, /b 没有编号 99999/],
      [{ kind: 'declare', a: 0, b: 0 }, /不是合格的 declare/],
      [{ kind: 'found', region: 3, name: '一二三四五六七八九十一二三四五六七' }, /最多 16 个字/],
      [{ kind: 'ally', a: 0, b: 1, until: 500 }, /until 要比 from 晚/],
      [{ kind: 'disaster', type: 'famine', level: 1, regions: [3, 3] }, /regions 不合规矩/],
      [{ kind: 'trek', folk: 0, reach: 'mid' }, /reach 不合规矩/],
      [{ kind: 'treaty', a: 0, ps: [1], term: 2.5 }, /term 不合规矩/],
      ['declare', /要是一个对象/],
    ];
    for (const [cmd, msg] of cases) {
      const run = startCiv(w, { endYear: 700, plugins: [once('bad', [{ kind: 'declare', a: 0, b: 1 }, cmd])] });
      run.advance(400);
      let err: unknown;
      try {
        run.advance(550);
      } catch (e) {
        err = e;
      }
      expect(err, JSON.stringify(cmd)).toBeInstanceOf(PluginError);
      expect((err as PluginError).plugin).toBe('bad');
      expect((err as Error).message).toMatch(/第 500 年下的命令:第 1 条:/);
      expect((err as Error).message).toMatch(msg);
      expect(() => run.advance(650)).toThrow(/不能接着推/);
    }
    const many = Array.from({ length: 65 }, () => ({ kind: 'declare', a: 0, b: 1 }));
    expect(() => generateCiv(w, { endYear: 600, plugins: [once('many', many)] })).toThrow(/最多下 64 条/);
    expect(() => generateCiv(w, { endYear: 600, plugins: [once('notlist', { kind: 'declare' })] })).toThrow(/commands 要是一个数组/);
  }, 60_000);

  it('合规矩的写法照收:滑条取 0、开关取 false、国名末尾的「国」去掉;稳定键也认', () => {
    const w = worldOf(2024);
    const base = generateCiv(w, { endYear: 500 });
    const alive = base.polities.filter((q) => q.ended === undefined).map((q) => q.id);
    const region = base.settlements[base.polities[alive[0]].capital].region;
    const civ = generateCiv(w, {
      endYear: 600,
      plugins: [
        once('ok', [
          { kind: 'cede', a: alive[1], region, permanent: false },
          { kind: 'treaty', a: polityKey(base, alive[0]), ps: [alive[1]], term: 0, limited: false },
          { kind: 'found', region, name: '秦国' },
        ]),
      ],
    });
    expect(commandsOf(civ).map((v) => [v.kind, 'name' in v ? v.name : undefined, 'term' in v, 'permanent' in v])).toEqual([
      ['cede', undefined, false, false],
      ['treaty', undefined, false, false],
      ['found', '秦', false, false],
    ]);
  }, 60_000);
});

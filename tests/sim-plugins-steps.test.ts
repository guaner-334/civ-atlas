/**
 * 推演插件带进逐年推演、照大纲推演、并排试推、推不下去找年份(和推演线程一样:一段推演各装一份插件):
 * 一步步推、照大纲推、两段轮流推,都和带着插件一口气推完一样;
 * 插件装不上(代码有语法错、表的公式不对)不算推演线程出错,停在它头一回出手那年、说是哪个插件;推到半路出错的,找停在哪年时带着同一套插件
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generateCiv, type Civ } from '../src/gen/civ';
import { PluginError } from '../src/gen/civ/engine/plugin';
import { extendCiv } from '../src/gen/civ/extend';
import { playCiv, playStop, playTicks, playTurn, type PlayContinue } from '../src/gen/civ/play';
import { quickjsPlugin } from '../src/gen/civ/quickjs/plugin';
import { civOrStuck, continueOrStuck } from '../src/gen/civ/stuck';
import { TUNING_CALC } from '../src/gen/civ/tuning';
import { worldPatch } from '../src/gen/civ/tuningPatch';
import { polityKey, type Intervention, type PlayState, type Plot } from '../src/gen/edits';
import { runOutline } from '../src/gen/outline';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { openPluginFile, packPluginFile } from '../src/plugin/pluginFile';
import type { SimPluginFile } from '../src/plugin/pluginWorld';
import { growMessage, type GrowReply } from '../src/growThread';
import { simPluginsOn, type SimBoxer, type SimPluginsOn } from '../src/simPluginRun';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { PLUGIN_SAMPLES } from './lib/pluginFileSample';
import { simV1File } from './lib/simV1Files';
import { faithEffect, weariness } from './lib/simV1Plugins';

const box: SimBoxer = (spec) => quickjsPlugin(quickjsWasm(), spec);
const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;
const snapPlay = { snap: (y: number) => playStop(y) };

let files: SimPluginFile[];

/** 装好、推、放掉(和推演线程一样:一段推演装一次) */
async function withPlugins<T>(seed: number, run: (on: SimPluginsOn) => T | Promise<T>, list: readonly SimPluginFile[] = files): Promise<T> {
  const on = await simPluginsOn(list, seed, box);
  try {
    return await run(on);
  } finally {
    on.dispose();
  }
}

const fileOf = async (bytes: Uint8Array): Promise<SimPluginFile> => {
  const o = await openPluginFile(bytes);
  return { id: o.manifest.id, sum: o.sum, bytes };
};

/** 每 every 年出手一次、小本子里记下年份的插件;code 换成别的写法 */
const probe = (code = 'civAtlas.sim({ act(turn) { return { note: turn.year }; } });\n', every = 10) =>
  packPluginFile({
    manifest: { id: 'probe', name: '探针', version: '1.0.0', role: 'sim', api: 1, runtime: 'quickjs', requires: ['sim.events@1', 'sim.state@1'], sim: { every }, license: 'MIT' },
    files: { 'main.js': code, 'README.md': '# 探针\n', LICENSE: 'MIT License\n' },
  });

/** 推到第 year 年那一刻出错的插件 */
const breaksAt = (year: number, every = 10) => probe(`civAtlas.sim({ act(turn) { if (turn.year >= ${year}) throw new Error("坏了"); return { note: turn.year }; } });\n`, every);

const SYNTAX = 'civAtlas.sim({ act(turn) { return { note: ; } });\n';

/** 推不下去的那份去掉 stuck,和一口气推到那年的比 */
const stuckless = (c: Civ): Civ => {
  const { stuck: _s, ...rest } = c;
  void _s;
  return rest as Civ;
};

beforeAll(async () => {
  files = [await fileOf(await simV1File('weariness')), await fileOf(await simV1File('faith'))];
}, 60_000);

describe('逐年推演、照大纲推演带着推演插件', () => {
  const seed = 2024;
  let w: World;

  beforeAll(() => {
    w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
  });

  it('每一步各装一份插件、中间下命令、走几格:一步步推到第 1200 年 = 带着同样的命令一口气推到同一刻', async () => {
    let play: PlayState = { year: 300, commands: [] };
    let civ = roundTrip(await withPlugins(seed, (on) => civOrStuck(w, { plugins: on.plugins, interventions: [], endYear: playStop(play.year) }, snapPlay)));
    const cont: PlayContinue = (ww, c, p) => continueOrStuck(ww, c, p, snapPlay);
    let declared = false;
    while (play.year < 1200) {
      const now = play;
      const from = civ;
      let commands: Intervention[] = [];
      if (now.year >= 700 && !declared) {
        const alive = from.polities.filter((p) => p.ended === undefined);
        expect(alive.length).toBeGreaterThan(1);
        commands = [{ kind: 'declare', a: polityKey(from, alive[0].id), b: polityKey(from, alive[1].id), from: now.year, ...(now.tick ? { fromTick: now.tick } : {}) } as Intervention];
        declared = true;
      }
      const step = await withPlugins(seed, (on) => (now.year === 500 ? playTicks(w, from, { plugins: on.plugins }, now, commands, 3, cont) : playTurn(w, from, { plugins: on.plugins }, now, commands, 100, cont)));
      expect(step.rejected).toEqual([]);
      expect(step.civ.stuck).toBeUndefined();
      civ = roundTrip(step.civ);
      play = step.play;
    }
    expect(play.commands.length).toBe(1);
    expect(civ.simPlugins?.map((s) => s.id)).toEqual(['weariness', 'faith']);
    const one = await withPlugins(seed, (on) => playCiv(w, { plugins: on.plugins }, play));
    expect(civDiff(civ, one)).toBeNull();
    // 插件真的起了作用:不带插件推出来的不一样
    expect(civDiff(civ, playCiv(w, {}, play))).not.toBeNull();
  }, 240_000);

  it('照大纲推演:每条情节的试推都带着插件,推到第 1400 年 = 带着硬改出来的干预一口气推完', async () => {
    const base = generateCiv(w, { plugins: [weariness(), faithEffect()], endYear: 1400 });
    const alive = base.polities.filter((p) => p.founded <= 700 && (p.ended === undefined || p.ended > 1200));
    expect(alive.length).toBeGreaterThan(2);
    const [A, B, C] = alive.slice(0, 3).map((p) => polityKey(base, p.id));
    const plots: Plot[] = [
      { id: 1, kind: 'war', year: 900, a: A, b: B },
      { id: 2, kind: 'ally', year: 1100, a: A, b: C },
    ];
    const out = (await withPlugins(seed, (on) => runOutline(w, { plugins: on.plugins, endYear: 1400 }, { plots, interventions: [] })))!;
    expect(out.review.map((r) => r.id)).toEqual([1, 2]);
    expect(out.civ.stuck).toBeUndefined();
    expect(out.civ.simPlugins?.map((s) => s.id)).toEqual(['weariness', 'faith']);
    const one = await withPlugins(seed, (on) => generateCiv(w, { plugins: on.plugins, interventions: out.interventions, endYear: 1400 }));
    expect(civDiff(out.civ, one)).toBeNull();
  }, 240_000);
});

describe('并排试推带着推演插件', () => {
  const MAP = { params: { ...DEFAULT_PARAMS, cells: 4000, seed: 7 } };
  const tuning = { values: { 'war.odds': 4 }, calc: TUNING_CALC };

  it('两段各装一份插件、轮流推:各自最后交的那份 = 带着插件、按各自的规则一口气推完', async () => {
    const got: GrowReply[] = [];
    await growMessage({ grow: 'start', map: MAP, setup: { simPlugins: files }, sides: [{ side: 0, key: 1 }, { side: 1, key: 2, tuning }] }, (r) => got.push(r), box);
    const last = (side: number) => got.find((r): r is Extract<GrowReply, { grow: 'civ' }> => r.grow === 'civ' && r.side === side && r.done)!.civ;
    expect(got.filter((r) => r.grow === 'failed')).toEqual([]);
    const w = generateWorld(MAP.params);
    const a = generateCiv(w, { plugins: [weariness(), faithEffect()] });
    const b = generateCiv(w, { plugins: [weariness(), faithEffect()], knobs: worldPatch(tuning) });
    expect(civDiff(last(0), a)).toBeNull();
    expect(civDiff(last(1), b)).toBeNull();
    expect(civDiff(a, b)).not.toBeNull();
  }, 240_000);

  it('插件装不上:那段推不下去,说是哪个插件', async () => {
    const got: GrowReply[] = [];
    await growMessage({ grow: 'start', map: MAP, setup: { simPlugins: [await fileOf(await probe(SYNTAX))] }, sides: [{ side: 0, key: 5 }] }, (r) => got.push(r), box);
    expect(got.filter((r) => r.grow !== 'progress')).toEqual([{ grow: 'failed', side: 0, key: 5, at: 0, civ: null, plugin: 'probe' }]);
  }, 60_000);
});

describe('推不下去:推演插件出的错停在那一年、说是哪个插件', () => {
  let small: World;
  beforeAll(() => {
    small = generateWorld({ ...DEFAULT_PARAMS, cells: 4000, seed: 7 });
  });

  it('插件代码有语法错:装的时候不抛错,推到第 0 年停下、说是它;出错的说法记着', async () => {
    const bad = await fileOf(await probe(SYNTAX));
    const errs: unknown[] = [];
    const civ = await withPlugins(7, (on) => civOrStuck(small, { plugins: on.plugins, endYear: 200 }, { failed: (e) => errs.push(e) }), [files[0], bad]);
    expect(civ.stuck).toEqual({ at: 0, to: 200, plugin: 'probe' });
    expect(civ.endYear).toBe(0);
    expect(civDiff(stuckless(civ), generateCiv(small, { endYear: 0 }))).toBeNull();
    expect(errs[0]).toBeInstanceOf(PluginError);
    expect((errs[0] as Error).message).toMatch(/^推演插件 probe:插件代码出错/);
    // 逐年推演从第 0 年起推也一样(停在年初)
    const play = await withPlugins(7, (on) => civOrStuck(small, { plugins: on.plugins, endYear: playStop(120) }, snapPlay), [bad]);
    expect(play.stuck).toMatchObject({ at: 0, plugin: 'probe' });
  }, 60_000);

  it('表的公式不对(网页主线程不查):同样停在第 0 年、说是它', async () => {
    const formula = await fileOf(await PLUGIN_SAMPLES.find((s) => s.name === 'sim-table-formula')!.build());
    const errs: unknown[] = [];
    const civ = await withPlugins(7, (on) => civOrStuck(small, { plugins: on.plugins, endYear: 200 }, { failed: (e) => errs.push(e) }), [formula]);
    expect(civ.stuck).toEqual({ at: 0, to: 200, plugin: formula.id });
    expect((errs[0] as Error).message).toMatch(/清单的 sim\.tables:.*mana/);
  }, 60_000);

  it('接着推、再推时才装不上:推到接着推以后它头一回出手那年停下', async () => {
    const good = await fileOf(await probe());
    const base = roundTrip(await withPlugins(7, (on) => generateCiv(small, { plugins: on.plugins, endYear: 100 }), [good]));
    const bad = await fileOf(await probe(SYNTAX));
    const go = await withPlugins(7, (on) => continueOrStuck(small, base, { plugins: on.plugins, endYear: 200 }), [bad]);
    expect(go.stuck).toEqual({ at: 110, to: 200, plugin: 'probe' });
    expect(go.endYear).toBe(109);
    const ext = (await withPlugins(7, (on) => extendCiv(small, base, { plugins: on.plugins, endYear: 200 }), [bad]))!;
    expect(ext.stuck).toEqual(go.stuck);
    expect(civDiff(ext, go)).toBeNull();
  }, 60_000);

  it('头几年里出错的(以前算推演线程出错):照样停在出错前那年', async () => {
    const list = [await fileOf(await breaksAt(3, 1))];
    const civ = await withPlugins(7, (on) => civOrStuck(small, { plugins: on.plugins, endYear: 200 }), list);
    expect(civ.stuck).toEqual({ at: 2, to: 200, plugin: 'probe' });
    expect(civ.endYear).toBe(2);
    expect(civDiff(stuckless(civ), await withPlugins(7, (on) => generateCiv(small, { plugins: on.plugins, endYear: 2 }), list))).toBeNull();
    // 第 0 年那一刻出手过、第 1 年就出错:停在第 0 年,第 0 年插件写下的照样留着
    const first = [await fileOf(await breaksAt(1, 1))];
    const zero = await withPlugins(7, (on) => civOrStuck(small, { plugins: on.plugins, endYear: 200 }), first);
    expect(zero.stuck).toEqual({ at: 0, to: 200, plugin: 'probe' });
    expect(zero.simPlugins?.[0].note).toBe(0);
    expect(civDiff(stuckless(zero), await withPlugins(7, (on) => generateCiv(small, { plugins: on.plugins, endYear: 0 }), first))).toBeNull();
  }, 60_000);

  it('推到半路出错:找停在哪年时带着同一套插件,停住的历史和带着插件一口气推到那年一样;再推、照大纲推演也一样', async () => {
    const list = [...files, await fileOf(await breaksAt(150))];
    const errs: unknown[] = [];
    const civ = await withPlugins(7, (on) => civOrStuck(small, { plugins: on.plugins, endYear: 300 }, { failed: (e) => errs.push(e) }), list);
    expect(civ.stuck).toMatchObject({ to: 300, plugin: 'probe' });
    expect((errs[0] as Error).message).toBe('推演插件 probe:坏了');
    expect(civ.stuck!.at).toBe(150);
    expect(civ.endYear).toBe(149);
    expect(civ.simPlugins?.map((s) => s.id)).toEqual(['weariness', 'faith', 'probe']);
    const one = await withPlugins(7, (on) => generateCiv(small, { plugins: on.plugins, endYear: 149 }), list);
    expect(civDiff(stuckless(civ), one)).toBeNull();

    const base = roundTrip(await withPlugins(7, (on) => generateCiv(small, { plugins: on.plugins, endYear: 60 }), list));
    const ext = (await withPlugins(7, (on) => extendCiv(small, base, { plugins: on.plugins, endYear: 300 }), list))!;
    expect(civDiff(ext, civ)).toBeNull();
    const outlined = (await withPlugins(7, (on) => runOutline(small, { plugins: on.plugins, endYear: 300 }, { plots: [], interventions: [] }), list))!;
    expect(civDiff(outlined.civ, civ)).toBeNull();
  }, 120_000);
});

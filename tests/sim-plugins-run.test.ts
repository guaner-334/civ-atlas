/**
 * 推演线程从插件文件装推演插件(src/simPluginRun.ts):打成插件文件的厌战、宗教生效经 QuickJS 推出来的历史和直接跑一样;
 * 改过去、再推都带着插件;世界清单记的插件和版本跟着存成文件;滑条照清单的上下限;下了清单没写的命令报错
 */
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateCiv, startContinue, type Civ } from '../src/gen/civ';
import { extendCiv } from '../src/gen/civ/extend';
import { civOrStuck } from '../src/gen/civ/stuck';
import { quickjsPlugin } from '../src/gen/quickjs/sim';
import { polityKey, type Intervention } from '../src/gen/edits';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { openWorldFile, packWorldFile, readWorldContent } from '../src/gen/worldFile';
import { chronicleBlock } from '../src/gen/civ/story/nameTokens';
import { flagBook } from '../src/gen/civ/story/flags';
import { makeSave, worldCheck } from '../src/gen/savefile';
import { openPluginFile, packPluginFile } from '../src/plugin/pluginFile';
import { checkSimPlugins, type SimPluginFile } from '../src/plugin/pluginWorld';
import { simPluginsOn, simRecordsOf, type SimBoxer, type SimPluginsOn } from '../src/simPluginRun';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { faithEffect, weariness } from './lib/simV1Plugins';
import { simV1File, simV1Input } from './lib/simV1Files';
import { MADE, READERS, bytesOf } from './lib/worldFileSample';

const box: SimBoxer = (spec) => quickjsPlugin(quickjsWasm(), spec);

/** 推出来的历史的指纹:史事、归属、干预、插件写的编年史和状态 */
function digest(civ: Civ): string {
  const x = packValue({ annals: civ.annals, polity: civ.polity, culture: civ.culture, interventions: civ.interventions ?? [], chronicle: civ.simChronicle ?? [], plugins: civ.simPlugins ?? [] });
  return createHash('sha256').update(x).digest('hex').slice(0, 16);
}

const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;

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

const fileOf = async (bytes: Uint8Array, params?: Record<string, number>): Promise<SimPluginFile> => {
  const o = await openPluginFile(bytes);
  return { id: o.manifest.id, sum: o.sum, bytes, ...(params ? { params } : {}) };
};

beforeAll(async () => {
  files = [await fileOf(await simV1File('weariness')), await fileOf(await simV1File('faith'))];
}, 60_000);

describe('从插件文件装推演插件,新建世界', () => {
  it.each([7, 2024])('seed %i 厌战、宗教生效打成插件文件推 3000 年:历史和直接跑一样', async (seed) => {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed });
    const native = generateCiv(w, { plugins: [weariness(), faithEffect()] });
    const civ = await withPlugins(seed, (on) => civOrStuck(w, { plugins: on.plugins }));
    expect(civ.endYear).toBe(3000);
    expect(civ.stuck).toBeUndefined();
    expect((civ.interventions ?? []).filter((v) => v.plugin).length).toBeGreaterThan(0);
    expect(digest(civ)).toBe(digest(native));
  }, 180_000);
});

describe('改过去、再推、存成文件', () => {
  const seed = 2024;
  let w: World;
  let one: Civ;

  beforeAll(async () => {
    w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
    one = roundTrip(await withPlugins(seed, (on) => generateCiv(w, { plugins: on.plugins })));
  }, 120_000);

  it('改过去(带着干预从第 0 年重推)带着插件:和直接跑带同样的干预一样', async () => {
    const victim = one.polities.find((x) => x.ended !== undefined && x.ended > 400)!;
    const interventions: Intervention[] = [{ kind: 'protect', a: polityKey(one, victim.id), from: victim.ended! - 20 }];
    const native = generateCiv(w, { plugins: [weariness(), faithEffect()], interventions });
    const civ = await withPlugins(seed, (on) => civOrStuck(w, { plugins: on.plugins, interventions }));
    expect(digest(civ)).toBe(digest(native));
    expect(digest(civ)).not.toBe(digest(one));
  }, 120_000);

  it('再推:推到 1500 年存下,换一套新装的插件从它接着推到 3000 年,和一口气推完一样;不带插件接不上', async () => {
    const half = roundTrip(await withPlugins(seed, (on) => generateCiv(w, { plugins: on.plugins, endYear: 1500 })));
    expect(half.simPlugins?.map((s) => s.id)).toEqual(['weariness', 'faith']);
    const rest = roundTrip((await withPlugins(seed, (on) => extendCiv(w, half, { plugins: on.plugins, endYear: 3000 })))!);
    expect(civDiff(rest, one)).toBeNull();
    expect(startContinue(w, half, {})).toBeNull();
  }, 120_000);

  it('存成文件:清单记着插件和版本,读回来的历史带着插件的状态,接着推和一口气推完一样', async () => {
    const half = await withPlugins(seed, (on) => ({ civ: roundTrip(generateCiv(w, { plugins: on.plugins, endYear: 1500 })), records: on.records }));
    const recipe = makeSave(w.params, { names: {}, interventions: [], terrain: [], upheavals: [] }, worldCheck(w), '插件世界', '2026-11-08T08:00:00.000Z', { projection: 'robinson', center: 120 });
    const f = await packWorldFile({ id: 'wsim', title: '插件世界', made: MADE, readers: READERS, recipe, plugins: half.records, map: w, civ: half.civ, chronicle: chronicleBlock(half.civ), flags: flagBook(w, half.civ) });
    const opened = await openWorldFile(await bytesOf(f), { readers: READERS });
    const v1 = await openPluginFile(await simV1File('weariness'));
    expect(opened.manifest.plugins).toEqual([
      { id: 'weariness', version: '1.0.0', sum: v1.sum, role: 'sim', name: '厌战' },
      { id: 'faith', version: '1.0.0', sum: files[1].sum, role: 'sim', name: '宗教生效' },
    ]);
    expect(opened.manifest.parts.filter((p) => p.name.startsWith('sim.')).map((p) => p.name)).toEqual(['sim.weariness', 'sim.faith']);
    const read = (await readWorldContent(opened)).civ as Civ;
    expect(read.simPlugins?.map((s) => s.id)).toEqual(['weariness', 'faith']);
    const rest = roundTrip((await withPlugins(seed, (on) => extendCiv(w, read, { plugins: on.plugins, endYear: 3000 })))!);
    expect(civDiff(rest, one)).toBeNull();

    // 本机装着同一版才接着推;只有新版的交回 other
    const installed = (sum: string) => [
      { id: 'weariness', current: { sum, manifest: { version: '1.1.0' } } },
      { id: 'faith', current: { sum: files[1].sum, manifest: { version: '1.0.0' } } },
    ];
    expect(checkSimPlugins(opened.manifest.plugins, installed(v1.sum)).map((c) => c.status)).toEqual(['ready', 'ready']);
    const newer = await openPluginFile(await simV1File('weariness', '1.1.0'));
    expect(checkSimPlugins(opened.manifest.plugins, installed(newer.sum)).map((c) => c.status)).toEqual(['other', 'ready']);
  }, 120_000);
});

describe('装插件', () => {
  /** 只记滑条的插件:每 1000 年出手一次,小本子里记下滑条拨到几 */
  const probe = (more: { commands?: string[]; code?: string } = {}) =>
    packPluginFile({
      manifest: {
        id: 'probe',
        name: '探针',
        version: '1.0.0',
        role: 'sim',
        api: 1,
        runtime: 'quickjs',
        requires: ['sim.events@1', 'sim.state@1', ...(more.commands ? ['sim.commands@1'] : [])],
        sim: { every: 1000, params: { k: { label: '强度', min: 0, max: 5, default: 1 } }, ...(more.commands ? { commands: more.commands } : {}) },
        license: 'MIT',
      },
      files: { 'main.js': more.code ?? 'civAtlas.sim({ act() { return { note: { k: civAtlas.params.k } }; } });\n', 'README.md': '# 探针\n', LICENSE: 'MIT License\n' },
    });
  let small: World;
  beforeAll(() => {
    small = generateWorld({ ...DEFAULT_PARAMS, cells: 4000, seed: 7 });
  });
  afterAll(() => undefined);

  it('滑条:插件里读到的是拨的值,没给的按默认、超出的压回上下限;清单里记的是压过的', async () => {
    const bytes = await probe();
    for (const [given, k] of [[undefined, 1], [{ k: 2.5 }, 2.5], [{ k: 9 }, 5]] as const) {
      const f = await fileOf(bytes, given as Record<string, number> | undefined);
      const out = await withPlugins(7, (on) => ({ civ: generateCiv(small, { plugins: on.plugins, endYear: 200 }), records: on.records }), [f]);
      expect(out.civ.simPlugins?.[0].note).toEqual({ k });
      expect(out.records[0].params).toEqual({ k });
      expect((await simRecordsOf([f]))[0].params).toEqual({ k });
    }
  }, 60_000);

  it('下了清单 sim.commands 里没写的命令:推演插件出错,说清是哪条', async () => {
    const code = 'civAtlas.sim({ act(turn) { return { commands: [{ kind: "declare", a: 0, b: 1 }] }; } });\n';
    const f = await fileOf(await probe({ commands: ['ally'], code }));
    await expect(withPlugins(7, (on) => generateCiv(small, { plugins: on.plugins, endYear: 200 }), [f])).rejects.toThrow(/清单的 sim\.commands 里没写/);
  }, 60_000);

  it('文件和指纹对不上、编号对不上、不是推演插件、同一个给了两次:装不上', async () => {
    const f = files[0];
    await expect(simPluginsOn([{ ...f, sum: 'a'.repeat(64) }], 7, box)).rejects.toThrow(/指纹/);
    await expect(simPluginsOn([{ ...f, id: 'other' }], 7, box)).rejects.toThrow(/文件里是 weariness/);
    await expect(simPluginsOn([f, f], 7, box)).rejects.toThrow(/给了两次/);
    const tool = await fileOf(await packPluginFile({ ...simV1Input('weariness'), manifest: { ...simV1Input('weariness').manifest, role: 'tool', runtime: 'worker', requires: [], sim: undefined } }));
    await expect(simPluginsOn([tool], 7, box)).rejects.toThrow(/不是推演插件/);
  }, 60_000);
});

/**
 * 生成线程从插件文件装地图插件(src/mapPluginRun.ts):打成插件文件的环形山、柯本、潮汐经 QuickJS 长出来的地图和直接跑一样;
 * 改地形一笔带着插件;世界键、存进世界的地图那一块、图层块;没带字节、文件对不上时拿不到插件
 */
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { timedMapPlugins, type MapPlugin } from '../src/gen/mapHooks';
import { quickjsMapPlugin } from '../src/gen/quickjs/map';
import { DEFAULT_PARAMS, generateWorld, type BaseCache, type World } from '../src/gen/world';
import type { TerrainOp } from '../src/gen/edits';
import { validatePluginLayer, validateWorld } from '../src/gen/worldValidate';
import { openPluginFile } from '../src/plugin/pluginFile';
import { mapPluginKey, type MapPluginFile } from '../src/plugin/pluginWorld';
import { loadError, loadMaps, loadedMap, mapPluginsOf, type MapBoxer } from '../src/mapPluginRun';
import { keyOf, mapLayerParts, mapValue } from '../src/worldRun';
import { generateCiv } from '../src/gen/civ';
import { chronicleBlock } from '../src/gen/civ/story/nameTokens';
import { flagBook } from '../src/gen/civ/story/flags';
import { makeSave, worldCheck } from '../src/gen/savefile';
import { openWorldFile, packWorldFile, readWorldContent } from '../src/gen/worldFile';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { MADE, READERS } from './lib/worldFileSample';
import { craters, koppen, tides, withParams } from './lib/mapPlugins';
import { mapTestFile } from './lib/mapPluginFiles';

const box: MapBoxer = (spec) => quickjsMapPlugin(quickjsWasm(), spec);

const bytes = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** 长出来的地图的指纹:海拔、海陆湖、群落、气温、降水、径流、插件出的图层 */
function digest(w: World): string {
  const h = createHash('sha256');
  for (const a of [w.elevation, w.water, w.biome, w.temperature, w.precipitation, w.flux]) h.update(bytes(a));
  for (const l of w.mapLayers ?? []) h.update(`${l.by}/${l.id}`).update(bytes(l.values));
  return h.digest('hex').slice(0, 16);
}

const fileOf = async (b: Uint8Array, params?: Record<string, number>): Promise<MapPluginFile> => {
  const o = await openPluginFile(b);
  return { id: o.manifest.id, sum: o.sum, bytes: b, ...(params ? { params } : {}) };
};

let files: MapPluginFile[];
let keys: string[];
const native = (): MapPlugin[] => [withParams(craters(), { count: 40 }), withParams(koppen()), withParams(tides())];

/** 装好的那一串(和生成线程一样每次生成另起计时) */
async function boxed(list: readonly MapPluginFile[] = files): Promise<MapPlugin[]> {
  await loadMaps(list, box);
  const ps = mapPluginsOf(list.map(mapPluginKey));
  if (!ps) throw new Error('没装好');
  return timedMapPlugins(ps);
}

beforeAll(async () => {
  files = [await fileOf(await mapTestFile('craters'), { count: 40 }), await fileOf(await mapTestFile('koppen')), await fileOf(await mapTestFile('tides'))];
  keys = files.map(mapPluginKey);
}, 60_000);

describe('从插件文件装地图插件,新建世界', () => {
  it.each([7, 2024])('seed %i 三个插件打成插件文件:长出的地图、图层和直接跑一样,世界记下各插件的键', async (seed) => {
    const P = { ...DEFAULT_PARAMS, seed };
    const a = generateWorld(P, undefined, undefined, undefined, undefined, native());
    const b = generateWorld(P, undefined, undefined, undefined, undefined, await boxed());
    expect(digest(b)).toBe(digest(a));
    expect(b.mapPlugins).toEqual(keys);
    expect(b.mapLayers?.map((l) => `${l.by}/${l.id}`)).toEqual(['koppen/koppen', 'tides/tide']);
    expect(digest(b)).not.toBe(digest(generateWorld(P)));
  });

  it('世界清单里记它的那一条:编号、第几版、指纹、种类「地图」、名字、补齐的滑条;登记的图层画法', async () => {
    await boxed();
    const c = loadedMap(keys[0])!;
    expect(c.record).toEqual({ id: 'craters', version: '1.0.0', sum: files[0].sum, role: 'map', name: '环形山', params: { count: 40 } });
    expect(c.looks).toEqual([]);
    expect(loadedMap(keys[1])!.record).toEqual({ id: 'koppen', version: '1.0.0', sum: files[1].sum, role: 'map', name: '柯本气候' });
    expect(loadedMap(keys[2])!.looks.map((l) => l.id)).toEqual(['tide']);
  });

  it('滑条没照清单补齐、超出上下限的请求装不上(世界键、世界记的都按补齐的认)', async () => {
    const noParams = { ...files[0], params: undefined };
    const over = { ...files[0], params: { count: 999 } };
    const extra = { ...files[0], params: { count: 40, other: 1 } };
    await loadMaps([noParams, over, extra], box);
    for (const f of [noParams, over, extra]) {
      expect(loadedMap(mapPluginKey(f))).toBeUndefined();
      expect(loadError(mapPluginKey(f))).toMatchObject({ name: 'MapPluginLoadError', plugin: 'craters', why: '滑条要照清单补齐、压回上下限' });
    }
    // 没有滑条的插件不用给
    expect(loadedMap(keys[1])).toBeDefined();
  });

  it('改地形一笔带着插件:走缓存的前一半,和从头生成、和直接跑一样', async () => {
    const P = { ...DEFAULT_PARAMS, seed: 7 };
    const ops: TerrainOp[] = [
      { kind: 'lake', pts: [1024, 300], r: 20, s: 1 },
      { kind: 'raise', pts: [700, 350, 760, 360], r: 30, s: 1 },
    ];
    const cache: BaseCache = { base: null };
    generateWorld(P, undefined, [], null, cache, await boxed());
    const edited = generateWorld(P, undefined, ops, null, cache, await boxed());
    const fresh = generateWorld(P, undefined, ops, null, undefined, native());
    expect(digest(edited)).toBe(digest(fresh));
    expect(edited.mapPlugins).toEqual(keys);
    expect(edited.terrain).toEqual(ops);
  });
});

describe('拿不到插件', () => {
  it('没带字节:认得出是哪个,拿不到插件', async () => {
    const { bytes: _b, ...id } = files[1];
    void _b;
    const lone = { ...id, sum: 'e'.repeat(64) };
    await loadMaps([lone], box);
    expect(mapPluginsOf([mapPluginKey(lone)])).toBeNull();
    expect(loadError(mapPluginKey(lone))).toBeUndefined();
  });

  it('文件和指纹对不上、不是地图插件:记下装不上的原因', async () => {
    const wrong = { ...files[1], sum: 'f'.repeat(64) };
    await loadMaps([wrong], box);
    expect(mapPluginsOf([mapPluginKey(wrong)])).toBeNull();
    expect(loadError(mapPluginKey(wrong))).toMatchObject({ name: 'MapPluginLoadError', plugin: 'koppen', why: '文件和指纹对不上' });
    const other = { ...files[2], id: 'koppen' };
    await loadMaps([other], box);
    expect(loadError(mapPluginKey(other))).toMatchObject({ why: '文件里是 tides' });
  });
});

describe('世界键、存进世界的样子', () => {
  it('没用地图插件的键和以前一样;用了的带上各插件的键', () => {
    const P = { ...DEFAULT_PARAMS, seed: 7 };
    const plain = JSON.stringify([Object.entries(P).sort(([a], [b]) => (a < b ? -1 : 1)), [], null]);
    expect(keyOf(P)).toBe(plain);
    expect(keyOf(P, undefined, undefined, [])).toBe(plain);
    expect(keyOf(P, undefined, undefined, keys)).toBe(`${plain}|map:${JSON.stringify(keys)}`);
  });

  it('地图那一块记着插件的键、不带图层,核对得过;图层按登记的画法另存成块,核对得过', async () => {
    const P = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
    const w = generateWorld(P, undefined, undefined, undefined, undefined, await boxed());
    const map = mapValue(w);
    expect(map.mapLayers).toBeUndefined();
    expect(map.mapPlugins).toEqual(keys);
    expect(() => validateWorld(map)).not.toThrow();
    expect(() => validateWorld({ ...map, mapLayers: w.mapLayers })).toThrow(/图层/);
    expect(() => validateWorld({ ...map, mapPlugins: ['koppen@1'] })).toThrow(/认不出/);

    const parts = mapLayerParts(
      files.map((f, i) => ({ id: f.id, looks: loadedMap(keys[i])!.looks })),
      w,
      [],
    );
    expect(parts.map((p) => p.name)).toEqual(['layer.koppen.koppen', 'layer.tides.tide']);
    const tide = parts[1].value;
    // 画法照网站查完的那一份(颜色换成小写)
    expect(tide).toMatchObject({ title: '潮差', unit: 'cell', ramp: { colors: ['#dbeafe', '#1e3a8a'], min: 0, max: 12 }, legend: '米', opacity: 0.8 });
    expect(tide.years).toBeUndefined();
    for (const p of parts) expect(() => validatePluginLayer(p.value, { cells: w.mesh.n, regions: 0 })).not.toThrow();

    // 打成世界文件:图层从 layers 另存成块,读回来核对得过
    const civ = generateCiv(w, { endYear: 100 });
    const file = await packWorldFile({ id: 'wm', made: MADE, readers: READERS, recipe: makeSave(P, { names: {}, interventions: [], terrain: [] }, worldCheck(w), '星', '2026-11-08T08:00:00.000Z'), map: w, civ, chronicle: chronicleBlock(civ), flags: flagBook(w, civ), layers: parts });
    const opened = await openWorldFile(file, { readers: READERS });
    expect(opened.manifest.parts.filter((p) => p.name.startsWith('layer.')).map((p) => `${p.name}:${p.by}`)).toEqual(['layer.koppen.koppen:koppen', 'layer.tides.tide:tides']);
    const content = await readWorldContent(opened);
    expect(content.skipped).toEqual([]);
    expect(content.map.mapLayers).toBeUndefined();
  });

  it('有地形大事的按年份一段一份(第 0 年是原来的地图)', async () => {
    const P = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
    const w = generateWorld(P, undefined, undefined, undefined, undefined, await boxed());
    const later = generateWorld(P, undefined, [{ kind: 'volcano', pts: [812, 403], r: 60, s: 1.5 }], undefined, undefined, await boxed());
    const [tide] = mapLayerParts([{ id: 'tides', looks: loadedMap(keys[2])!.looks }], w, [{ year: 1500, world: later }]);
    const n = w.mesh.n;
    expect(tide.value.years).toEqual([0, 1500]);
    expect(tide.value.values.length).toBe(2 * n);
    expect(bytes(tide.value.values.subarray(0, n))).toEqual(bytes(w.mapLayers!.find((l) => l.id === 'tide')!.values));
    expect(bytes(tide.value.values.subarray(n))).toEqual(bytes(later.mapLayers!.find((l) => l.id === 'tide')!.values));
    expect(() => validatePluginLayer(tide.value, { cells: n, regions: 0 })).not.toThrow();
  });
});

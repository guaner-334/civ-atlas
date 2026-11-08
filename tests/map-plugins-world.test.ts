/**
 * 世界记着用了哪些地图插件(清单 plugins 里 role 是 map 的几条:编号、第几版、文件指纹、名字、滑条),插件出的图层存成图层块;
 * 地图换了整批换掉,线程不知道的照上一份;存成文件读回来核对得过。改地形之前和本机插件仓库核对(同一版 / 没装 / 只有别的版本)。
 * IndexedDB 用 fake-indexeddb
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { chronicleBlock } from '../src/gen/civ/story/nameTokens';
import { flagBook } from '../src/gen/civ/story/flags';
import { timedMapPlugins } from '../src/gen/mapHooks';
import { quickjsMapPlugin } from '../src/gen/quickjs/map';
import { makeSave, worldCheck } from '../src/gen/savefile';
import { makePart, type SnapshotPart } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { openWorldFile, packWorldParts, readWorldContent, type PackInput } from '../src/gen/worldFile';
import type { WorldManifest, WorldPlugin } from '../src/gen/worldFormat';
import { mapPluginFiles, mapPluginsReady } from '../src/plugin/mapPlugins';
import { _resetPluginStore, installPlugin, removePlugin } from '../src/plugin/pluginStore';
import { checkMapPlugins, mapPluginIds, mapPluginKey, type MapPluginFile } from '../src/plugin/pluginWorld';
import { loadMaps, loadedMap, mapPluginsOf, type MapBoxer } from '../src/mapPluginRun';
import { mapLayerParts } from '../src/worldRun';
import { _resetVault, commitWorld, readRevision, revisionFile, type CommitRequest } from '../src/worldVault';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { mapTestFile } from './lib/mapPluginFiles';
import { MADE, READERS } from './lib/worldFileSample';

const g = globalThis as unknown as { indexedDB: IDBFactory | undefined };
const box: MapBoxer = (spec) => quickjsMapPlugin(quickjsWasm(), spec);

let files: MapPluginFile[];
let records: WorldPlugin[];
let world: World;
let input: PackInput;
let viewParts: SnapshotPart[];
let layerParts: SnapshotPart[];

const asSnap = (p: { info: { name: string; bytes: number; sum: string; zip: string }; data: Uint8Array | ArrayBuffer }): SnapshotPart => ({ name: p.info.name, bytes: p.info.bytes, sum: p.info.sum, zip: p.info.zip as 'gzip' | 'none', data: p.data as ArrayBuffer });

beforeAll(async () => {
  const raw = [await mapTestFile('craters'), await mapTestFile('koppen'), await mapTestFile('tides')];
  _resetPluginStore();
  g.indexedDB = new IDBFactory();
  // 新长一张地图带的:各用本机现在那一版,滑条照清单补齐
  for (const b of raw) await installPlugin(b);
  files = await mapPluginFiles([{ id: 'craters', params: { count: 30 } }, { id: 'koppen' }, { id: 'tides' }]);
  expect(files.map((f) => [f.id, f.params])).toEqual([
    ['craters', { count: 30 }],
    ['koppen', undefined],
    ['tides', undefined],
  ]);
  await loadMaps(files, box);
  const keys = files.map(mapPluginKey);
  records = keys.map((k) => loadedMap(k)!.record);
  const params = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
  world = generateWorld(params, undefined, undefined, undefined, undefined, timedMapPlugins(mapPluginsOf(keys)!));
  const civ = generateCiv(world, { endYear: 300 });
  input = {
    id: 'wmap',
    made: MADE,
    readers: READERS,
    recipe: makeSave(params, { names: {}, interventions: [], terrain: [] }, worldCheck(world), '环形山之星', '2026-11-08T08:00:00.000Z'),
    map: world,
    civ,
    chronicle: chronicleBlock(civ),
    flags: flagBook(world, civ),
  };
  viewParts = (await packWorldParts(input)).parts.map(asSnap);
  layerParts = [];
  for (const p of mapLayerParts(
    files.map((f, i) => ({ id: f.id, looks: loadedMap(keys[i])!.looks })),
    world,
    [],
  ))
    layerParts.push(await makePart(p.name, p.value));
}, 120_000);

beforeEach(() => {
  _resetVault();
  _resetPluginStore();
  g.indexedDB = new IDBFactory();
});
afterEach(() => {
  _resetVault();
  _resetPluginStore();
});

const copies = (list: SnapshotPart[]) => list.map((p) => ({ ...p, data: p.data.slice(0) }));
const request = (over: Partial<CommitRequest> = {}): CommitRequest => ({ id: input.id, recipe: input.recipe, recipeKey: 'k1', parts: copies(viewParts), made: MADE, readers: READERS, ...over });
const latest = async (): Promise<WorldManifest> => (await readRevision(input.id, undefined, []))!.manifest;
const layerNames = (m: WorldManifest) => m.parts.filter((p) => p.name.startsWith('layer.')).map((p) => `${p.name}:${p.by}`);

describe('世界里记地图插件和它们的图层', () => {
  it('清单记编号、第几版、指纹、种类、名字、滑条;图层块记是哪个插件放的;存成文件读回来核对得过', async () => {
    expect(records.map((r) => [r.id, r.version, r.role, r.name, r.params])).toEqual([
      ['craters', '1.0.0', 'map', '环形山', { count: 30 }],
      ['koppen', '1.0.0', 'map', '柯本气候', undefined],
      ['tides', '1.0.0', 'map', '潮汐', undefined],
    ]);
    await commitWorld(request({ parts: [...copies(viewParts), ...copies(layerParts)], mapPlugins: records }));
    const m = await latest();
    expect(m.plugins).toEqual(records);
    expect(layerNames(m)).toEqual(['layer.koppen.koppen:koppen', 'layer.tides.tide:tides']);

    const opened = await openWorldFile((await revisionFile(input.id))!, { readers: READERS });
    expect(opened.manifest.plugins).toEqual(records);
    const content = await readWorldContent(opened);
    expect(content.skipped).toEqual([]);
    expect(content.map.mapPlugins).toEqual(files.map(mapPluginKey));
    expect(content.map.mapLayers).toBeUndefined();
    // 世界清单里记的认得出是哪几个插件(带回给生成线程的就是这一串,键和长地图时一样)
    expect(mapPluginIds(opened.manifest.plugins).map(mapPluginKey)).toEqual(files.map(mapPluginKey));
  });

  it('地图换了:原来的插件记录、图层整批换掉;线程不知道的(不给)照上一份;推演插件、工具插件的记录不动', async () => {
    const tool: WorldPlugin = { id: 'ruler', version: '1.0.0', sum: 'a'.repeat(64), role: 'tool', name: '量尺' };
    await commitWorld(request({ parts: [...copies(viewParts), ...copies(layerParts)], mapPlugins: records, simPlugins: [] }));
    // 只改作者内容、没带完整内容:照旧
    const note = { key: 'n1', kind: '史书', title: '注', text: '一段', createdAt: '2026-11-08T08:00:00.000Z', provider: 'p', model: 'm' };
    await commitWorld(request({ parts: undefined, author: { notes: [note] } }));
    expect((await latest()).plugins).toEqual(records);

    // 带着完整内容、线程不知道地图插件(读进来的世界):照上一份
    await commitWorld(request({ recipeKey: 'k2' }));
    expect((await latest()).plugins).toEqual(records);
    expect(layerNames(await latest())).toHaveLength(2);

    // 只剩环形山(没有图层):潮汐、柯本的记录和图层都去掉
    await commitWorld(request({ recipeKey: 'k3', mapPlugins: [records[0]] }));
    expect((await latest()).plugins).toEqual([records[0]]);
    expect(layerNames(await latest())).toEqual([]);

    // 不带地图插件重长:记录也去掉
    await commitWorld(request({ recipeKey: 'k4', mapPlugins: [], simPlugins: [{ ...tool, id: 'magic', role: 'sim' }] }));
    expect((await latest()).plugins.map((p) => `${p.id}:${p.role}`)).toEqual(['magic:sim']);
  });
});

describe('改地形之前核对本机的地图插件', () => {
  it('都装着同一版:带上字节;没装、只有别的版本:交回核对结果,只带编号和指纹', async () => {
    const list: WorldPlugin[] = [...records, { id: 'magic', version: '1.0.0', sum: 'b'.repeat(64), role: 'sim' }];
    for (const id of ['craters', 'koppen', 'tides'] as const) await installPlugin(await mapTestFile(id));
    const ok = await mapPluginsReady(list);
    expect(ok.ok).toBe(true);
    expect(ok.files.map((f) => [f.id, !!f.bytes, f.params])).toEqual([
      ['craters', true, { count: 30 }],
      ['koppen', true, undefined],
      ['tides', true, undefined],
    ]);

    // 柯本换过两版(留着的上一版也不是世界记的)、潮汐删掉:没对上的只带编号、指纹、滑条
    await installPlugin(await mapTestFile('koppen', '1.1.0'));
    expect((await mapPluginsReady(records)).ok).toBe(true);
    await installPlugin(await mapTestFile('koppen', '1.2.0'));
    await removePlugin('tides');
    const r = await mapPluginsReady(records);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.files.every((f) => !f.bytes)).toBe(true);
    expect(r.files.map(mapPluginKey)).toEqual(files.map(mapPluginKey));
    expect(r.checks.map((c) => [c.id, c.status, 'installed' in c ? c.installed.version : null])).toEqual([
      ['craters', 'ready', null],
      ['koppen', 'other', '1.2.0'],
      ['tides', 'missing', null],
    ]);
  });

  it('核对:同一版(现在的或留着的上一版)、没装、只有别的版本', () => {
    const installed = [
      { id: 'craters', current: { sum: records[0].sum, manifest: { version: '1.0.0' } } },
      { id: 'koppen', current: { sum: 'c'.repeat(64), manifest: { version: '1.1.0' } }, previous: { sum: records[1].sum } },
      { id: 'tides', current: { sum: 'd'.repeat(64), manifest: { version: '2.0.0' } } },
    ];
    expect(checkMapPlugins(records, installed).map((c) => [c.id, c.status, 'installed' in c ? c.installed.version : null])).toEqual([
      ['craters', 'ready', null],
      ['koppen', 'ready', null],
      ['tides', 'other', '2.0.0'],
    ]);
    expect(checkMapPlugins(records, []).map((c) => c.status)).toEqual(['missing', 'missing', 'missing']);
  });
});

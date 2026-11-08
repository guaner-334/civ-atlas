/**
 * 生成线程以外重长地图的地方带上地图插件:并排试推(growThread.ts、compareMaps.ts)长的是同一张地图、推出同一段历史;
 * 后台按配方重算(worldConvert.ts 的 recompute)长出同一张地图,图层、星球参照、插件记录和生成线程存的一样。IndexedDB 用 fake-indexeddb
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateCiv, planetNames, planetTempo } from '../src/gen/civ';
import type { TerrainOp, Upheaval } from '../src/gen/edits';
import { timedMapPlugins, type MapPlugin } from '../src/gen/mapHooks';
import { quickjsMapPlugin } from '../src/gen/quickjs/map';
import { makeSave, worldCheck } from '../src/gen/savefile';
import { makePart, partBytes, unpackValue } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld, type World, type WorldParams } from '../src/gen/world';
import { growMessage, type GrowReply } from '../src/growThread';
import { loadMaps, mapPluginsOf, type MapBoxer } from '../src/mapPluginRun';
import { openPluginFile } from '../src/plugin/pluginFile';
import { mapPluginKey, type MapPluginFile } from '../src/plugin/pluginWorld';
import { mapKey, worldHere } from '../src/ui/compare/compareMaps';
import { runConvert } from '../src/worldConvert';
import { mapValue } from '../src/worldRun';
import { _resetVault, readRevision } from '../src/worldVault';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { mapTestFile } from './lib/mapPluginFiles';

const box: MapBoxer = (spec) => quickjsMapPlugin(quickjsWasm(), spec);
const g = globalThis as unknown as { indexedDB: IDBFactory | undefined };

const PARAMS: WorldParams = { ...DEFAULT_PARAMS, seed: 2024, cells: 2000 };
const TERRAIN: TerrainOp[] = [{ kind: 'volcano', pts: [700, 420], r: 30, s: 1.2 }];

let files: MapPluginFile[];
let plugins: MapPlugin[];
let world: World;

const fileOf = async (b: Uint8Array, params?: Record<string, number>): Promise<MapPluginFile> => {
  const o = await openPluginFile(b);
  return { id: o.manifest.id, sum: o.sum, bytes: b, ...(params ? { params } : {}) };
};

beforeAll(async () => {
  files = [await fileOf(await mapTestFile('craters'), { count: 30 }), await fileOf(await mapTestFile('koppen')), await fileOf(await mapTestFile('tides'))];
  await loadMaps(files, box);
  plugins = mapPluginsOf(files.map(mapPluginKey))!;
  world = generateWorld(PARAMS, undefined, TERRAIN, undefined, undefined, timedMapPlugins(plugins));
}, 120_000);

describe('并排试推', () => {
  it('正看着的世界用了地图插件:带上插件(本机没有同一版的不列);和没用插件的不是同一张地图', () => {
    const edits = { names: {}, interventions: [], terrain: TERRAIN, upheavals: [] };
    const cur = { params: PARAMS, title: '火山岛' };
    expect(worldHere(true, cur, edits, null)).toBeNull();
    const plain = worldHere(true, cur, edits)!;
    const here = worldHere(true, cur, edits, files)!;
    expect(plain.map.mapPlugins).toBeUndefined();
    expect(here.map.mapPlugins).toBe(files);
    expect(mapKey(here.map)).not.toBe(mapKey(plain.map));
  });

  it('后台线程按插件长同一张地图,推出的历史和一口气推完一样;插件装不上的那几段推不了', async () => {
    const got: GrowReply[] = [];
    await growMessage({ grow: 'start', map: { params: PARAMS, terrain: TERRAIN, mapPlugins: files }, setup: {}, sides: [{ side: 0, key: 1 }] }, (r) => got.push(r), undefined, box);
    const last = got.filter((r): r is Extract<GrowReply, { grow: 'civ' }> => r.grow === 'civ').at(-1)!;
    expect(last.done).toBe(true);
    const want = generateCiv(world, { tempo: planetTempo(PARAMS, undefined, undefined, timedMapPlugins(plugins)) ?? null, mapPlugins: timedMapPlugins(plugins) });
    expect(last.civ).toEqual(want);

    const bad: GrowReply[] = [];
    await growMessage({ grow: 'start', map: { params: PARAMS, terrain: TERRAIN, mapPlugins: [{ ...files[0], sum: 'f'.repeat(64) }] }, setup: {}, sides: [{ side: 0, key: 2 }, { side: 1, key: 3 }] }, (r) => bad.push(r), undefined, box);
    expect(bad.map((r) => [r.grow, r.side, r.grow === 'failed' ? r.at : null])).toEqual([
      ['failed', 0, 0],
      ['failed', 1, 0],
    ]);
  }, 300_000);
});

describe('后台按配方重算', () => {
  beforeAll(() => {
    g.indexedDB = new IDBFactory();
    _resetVault();
  });

  it('带着世界记的地图插件长同一张地图:图层、星球参照、插件记录都存上', async () => {
    const ups: Upheaval[] = [{ year: 200, ops: [{ kind: 'sink', pts: [1200, 600, 1260, 610], r: 40, s: 1.1 }] }];
    const save = makeSave(PARAMS, { names: {}, interventions: [], terrain: TERRAIN, upheavals: ups, endYear: 400 }, worldCheck(world), '火山岛', '2026-11-08T08:00:00.000Z');
    await runConvert({ kind: 'recompute', id: 'wc', save, app: 'x', commit: '', mapPlugins: files }, undefined, undefined, box);
    const rev = (await readRevision('wc'))!;
    expect(rev.manifest.plugins.map((p) => [p.id, p.role])).toEqual([
      ['craters', 'map'],
      ['koppen', 'map'],
      ['tides', 'map'],
    ]);
    const names = rev.manifest.parts.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['map', 'eras', 'civ', 'layer.koppen.koppen', 'layer.tides.tide', 'planet']));
    expect(rev.manifest.parts.find((p) => p.name === 'map')!.sum).toBe((await makePart('map', mapValue(world))).sum);
    const p = rev.parts.find((x) => x.info.name === 'planet')!;
    const planet = unpackValue(await partBytes(p.info as never, new Uint8Array(p.data as ArrayBuffer))) as { tempo: unknown; names: { key: string } };
    const timed = timedMapPlugins(plugins);
    expect(planet.tempo).toEqual(planetTempo(PARAMS, undefined, undefined, timed) ?? null);
    expect(planet.names).toEqual(planetNames(world, { mapPlugins: timed, endYear: 400 }, true));
  }, 300_000);
});

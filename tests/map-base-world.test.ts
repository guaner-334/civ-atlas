/**
 * 以用了地图插件的世界为底稿新建、这台没装那几个插件:生成线程照原样用底稿存着的那张地图(手上没有就先读它钉住),不重新长;
 * 存成新世界时照带过来的记地图插件,底稿的图层块、星球参照跟着带过来。
 * 生成线程(src/worker.ts)在 Node 里跑:self 换成假的,一台设备一份模块;IndexedDB 用 fake-indexeddb
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CivPartInbox } from '../src/civParts';
import { GENERATOR_VERSION, type TerrainOp, type Upheaval } from '../src/gen/edits';
import type { Civ } from '../src/gen/civ';
import { makeSave, type SaveFile } from '../src/gen/savefile';
import { recipeKey, recipeOfSave } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, type World, type WorldParams } from '../src/gen/world';
import type { WorldPlugin } from '../src/gen/worldFormat';
import { mapPluginIds, type MapPluginFile } from '../src/plugin/pluginWorld';
import { openPluginFile } from '../src/plugin/pluginFile';
import { _resetVault, commitWorld, readRevision, type WorldPartsOffer } from '../src/worldVault';
import { openStoredWorld } from '../src/worldOpen';
import type { LoadRequest, WorkerRequest, WorkerResponse } from '../src/worker';
import { mapTestFile } from './lib/mapPluginFiles';
import { MADE, READERS } from './lib/worldFileSample';

vi.mock('../src/gen/quickjs/wasm', async () => {
  const node = await import('../scripts/lib/quickjsNode');
  return { quickjsWasm: async () => node.quickjsWasm() };
});

const g = globalThis as unknown as { indexedDB: IDBFactory | undefined; self?: unknown };

interface Device {
  send(req: WorkerRequest): void;
  wait<T extends WorkerResponse['type']>(id: number, types: readonly T[]): Promise<Extract<WorkerResponse, { type: T }>>;
}

async function device(): Promise<Device> {
  const got: WorkerResponse[] = [];
  const inbox = new CivPartInbox();
  const self = {
    navigator: { hardwareConcurrency: 1 },
    onmessage: null as ((e: { data: WorkerRequest }) => void) | null,
    postMessage(m: WorkerResponse) {
      if (m.type === 'civPart') return inbox.take(m);
      if ('split' in m && m.split && 'civ' in m && m.civ) inbox.join(m.civ, m.split);
      got.push(m);
    },
  };
  g.self = self;
  vi.resetModules();
  await import('../src/worker');
  const on = self.onmessage!;
  return {
    send: (req) => on({ data: req }),
    async wait(id, types) {
      for (let t = 0; t < 6000; t++) {
        const i = got.findIndex((m) => m.id === id && (types as readonly string[]).includes(m.type));
        if (i >= 0) return got.splice(i, 1)[0] as never;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(`等不到 ${types.join('/')}`);
    },
  };
}

const PARAMS: WorldParams = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
const TERRAIN: TerrainOp[] = [{ kind: 'volcano', pts: [1024, 512], r: 30, s: 1.2 }];
const UPS: Upheaval[] = [{ year: 150, ops: [{ kind: 'sink', pts: [1856, 574, 1936, 584], r: 40, s: 1.1 }] }];
const END = 300;

const saveOf = (terrain: TerrainOp[] = TERRAIN, title = '底稿'): SaveFile => makeSave(PARAMS, { names: {}, interventions: [], terrain, upheavals: UPS, endYear: END }, '', title, '2026-11-09T08:00:00.000Z');
const ask = (maps: MapPluginFile[], terrain: TerrainOp[] = TERRAIN) => ({ params: PARAMS, terrain, upheavals: UPS, endYear: END, mapPlugins: maps });

let files: MapPluginFile[];
/** 没装插件的设备发的:只有编号、指纹、滑条 */
let ids: MapPluginFile[];
let records: WorldPlugin[];
let made: { world: World; civ: Civ };
let baseLoad: LoadRequest;
/** 底稿那一份存进仓库的地图块的指纹 */
let baseMap: string;

async function keep(id: string, offer: WorldPartsOffer, save: SaveFile, more: { mapPlugins?: WorldPlugin[]; mapsFrom?: string } = {}): Promise<void> {
  const parts = offer.parts.map((p) => ({ ...p, data: p.data.slice(0) }));
  await commitWorld({ id, recipe: save, recipeKey: await recipeKey(recipeOfSave(save)), parts, made: MADE, readers: READERS, ...more });
}

beforeAll(async () => {
  g.indexedDB = new IDBFactory();
  _resetVault();
  const o = (b: Uint8Array, params?: Record<string, number>) => openPluginFile(b).then((x): MapPluginFile => ({ id: x.manifest.id, sum: x.sum, bytes: b, ...(params ? { params } : {}) }));
  files = [await o(await mapTestFile('craters'), { count: 30 }), await o(await mapTestFile('koppen'))];
  // 装着插件的设备:建好底稿那个世界(改过地形、有地形大事),存进仓库
  const a = await device();
  a.send({ type: 'generate', id: 1, scale: 0.25, ...ask(files) });
  const done = await a.wait(1, ['done']);
  made = { world: done.world!, civ: done.civ! };
  const offer = (await a.wait(1, ['worldParts'])).offer;
  records = offer.mapPlugins!;
  baseMap = offer.parts.find((p) => p.name === 'map')!.sum;
  ids = mapPluginIds(records);
  await keep('wb', offer, saveOf(), { mapPlugins: records });
  baseLoad = { type: 'load', id: 0, scale: 0.25, ...ask(ids), vault: { id: 'wb', recipe: await recipeKey(recipeOfSave(saveOf())), generator: GENERATOR_VERSION } };
}, 300_000);

afterAll(() => {
  delete g.self;
  _resetVault();
});

describe('没装插件的设备以它为底稿新建', () => {
  let b: Device;
  let offer: WorldPartsOffer;
  beforeAll(async () => {
    b = await device();
  });

  it('线程手上没有它:读底稿钉住,地图、地形大事的几段、历史和装着插件时一模一样', async () => {
    b.send({ type: 'generate', id: 2, scale: 0.25, ...ask(ids), base: { ...baseLoad, id: 2 } });
    const done = await b.wait(2, ['done', 'mapFailed']);
    expect(done.type).toBe('done');
    const d = done as Extract<WorkerResponse, { type: 'done' }>;
    expect(Array.from(d.world!.elevation)).toEqual(Array.from(made.world.elevation));
    expect(d.eras?.map((e) => e.key)).toHaveLength(1);
    expect(d.civ).toEqual(made.civ);
    offer = (await b.wait(2, ['worldParts'])).offer;
    expect(offer.mapPlugins).toBeUndefined();
    // 存下的地图块和底稿的一字不差
    expect(offer.parts.find((p) => p.name === 'map')!.sum).toBe(baseMap);
  }, 180_000);

  it('地图先交的(新建界面):照样先交那张地图', async () => {
    b.send({ type: 'generate', id: 3, scale: 0.25, keep: true, mapFirst: true, ...ask(ids), base: { ...baseLoad, id: 3 } });
    const map = await b.wait(3, ['map', 'mapFailed']);
    expect(map.type).toBe('map');
    expect(Array.from((map as Extract<WorkerResponse, { type: 'map' }>).world.elevation)).toEqual(Array.from(made.world.elevation));
    expect((await b.wait(3, ['done'])).mapSent).toBe(true);
    await b.wait(3, ['worldParts']);
  }, 180_000);

  it('改了地形:要先装同一版', async () => {
    b.send({ type: 'generate', id: 4, scale: 0.25, ...ask(ids, [...TERRAIN, { kind: 'volcano', pts: [600, 400], r: 20, s: 1 }]), base: { ...baseLoad, id: 4 } });
    expect(await b.wait(4, ['mapFailed', 'done'])).toMatchObject({ type: 'mapFailed', plugin: 'craters' });
  }, 60_000);

  it('存成新世界:照带过来的记地图插件,底稿的图层块、星球参照带过来,打得开', async () => {
    await keep('wn', offer, saveOf(TERRAIN, '新的'), { mapPlugins: records, mapsFrom: 'wb' });
    const from = (await readRevision('wb', undefined, []))!.manifest;
    const got = (await readRevision('wn', undefined, []))!.manifest;
    expect(got.plugins.filter((p) => p.role === 'map').map((p) => [p.id, p.sum])).toEqual(records.map((p) => [p.id, p.sum]));
    const carried = (m: typeof from) => m.parts.filter((p) => p.name === 'planet' || p.name.startsWith('layer.')).map((p) => [p.name, p.sum]);
    expect(carried(from).length).toBeGreaterThan(1);
    expect(carried(got)).toEqual(carried(from));
    const open = await openStoredWorld({ id: 'wn', recipe: await recipeKey(recipeOfSave(saveOf(TERRAIN, '新的'))), generator: GENERATOR_VERSION });
    expect(open.planet).not.toBeNull();

    // 已经有修订的:再带 mapsFrom 也照上一份
    await keep('wn', offer, saveOf(TERRAIN, '新的二'), { mapPlugins: records, mapsFrom: 'nope' });
    expect(carried((await readRevision('wn', undefined, []))!.manifest)).toEqual(carried(from));
  }, 60_000);

  it('地图的配方对不上(地形不一样):不带', async () => {
    await keep('wx', offer, saveOf([], '别的'), { mapPlugins: records, mapsFrom: 'wb' });
    const got = (await readRevision('wx', undefined, []))!.manifest;
    expect(got.parts.some((p) => p.name.startsWith('layer.'))).toBe(false);
  }, 60_000);
});

describe('手上没有、也没给底稿', () => {
  it('照旧长不出来(交 mapFailed)', async () => {
    const c = await device();
    c.send({ type: 'generate', id: 5, scale: 0.25, ...ask(ids) });
    expect(await c.wait(5, ['mapFailed', 'done'])).toMatchObject({ type: 'mapFailed', plugin: 'craters', kind: 'missing' });
  }, 60_000);
});

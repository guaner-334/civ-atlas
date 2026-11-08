/**
 * 用地图插件长、改过地形的世界存下「没改地形的星球」参照(planet 那一块):生成线程存世界时带上它;
 * 另一台没装插件的设备读回来推历史(重推、再推、逐年推演)和装着插件时一样;设定变了、改地形照旧要同一版插件。
 * 生成线程(src/worker.ts)在 Node 里跑:self 换成假的,一台设备一份模块;IndexedDB 用 fake-indexeddb
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CivPartInbox } from '../src/civParts';
import { regionKey, GENERATOR_VERSION, type Intervention, type TerrainOp, type Upheaval } from '../src/gen/edits';
import type { Civ } from '../src/gen/civ';
import { makeSave } from '../src/gen/savefile';
import { makePart, recipeKey, recipeOfSave, unpackValue, partBytes } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, type WorldParams } from '../src/gen/world';
import { openWorldFile, opaqueParts, readWorldContent, rewriteWorldFile } from '../src/gen/worldFile';
import type { PlanetValue, WorldPlugin } from '../src/gen/worldFormat';
import { validatePlanet } from '../src/gen/worldValidate';
import { mapPluginIds, type MapPluginFile } from '../src/plugin/pluginWorld';
import { openPluginFile } from '../src/plugin/pluginFile';
import { _resetVault, commitWorld, readRevision, revisionFile } from '../src/worldVault';
import type { WorkerRequest, WorkerResponse } from '../src/worker';
import { openStoredWorld } from '../src/worldOpen';
import type { WorldPartsOffer } from '../src/worldVault';
import { mapTestFile } from './lib/mapPluginFiles';
import { MADE, READERS } from './lib/worldFileSample';

// 生成线程装地图插件时取 QuickJS 的 wasm:浏览器里下载,这里直接读
vi.mock('../src/gen/quickjs/wasm', async () => {
  const node = await import('../scripts/lib/quickjsNode');
  return { quickjsWasm: async () => node.quickjsWasm() };
});

const g = globalThis as unknown as { indexedDB: IDBFactory | undefined; self?: unknown };

/** 一台设备上的生成线程:发请求、等回音(编年史、切开的历史先收着,历史拼好再交) */
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
        const bad = got.findIndex((m) => m.id === id && m.type === 'mapFailed');
        if (bad >= 0 && !types.includes('mapFailed' as never)) throw new Error(`mapFailed:${JSON.stringify(got[bad])}`);
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

let files: MapPluginFile[];
/** 世界记的那一串:只有编号、指纹、滑条(没装插件的设备发的就是这些) */
let ids: MapPluginFile[];
let records: WorldPlugin[];

const fileOf = async (b: Uint8Array, params?: Record<string, number>): Promise<MapPluginFile> => {
  const o = await openPluginFile(b);
  return { id: o.manifest.id, sum: o.sum, bytes: b, ...(params ? { params } : {}) };
};

/** 推这个世界的请求共有的几项 */
const base = (maps: MapPluginFile[] | undefined, terrain: TerrainOp[] = TERRAIN) => ({ params: PARAMS, terrain, upheavals: UPS, endYear: END, ...(maps ? { mapPlugins: maps } : {}) });

/** 存进仓库(和页面收到 worldParts 时一样);返回打开它要的配方指纹 */
async function keep(id: string, offer: WorldPartsOffer, terrain: TerrainOp[] = TERRAIN, drop: string[] = []): Promise<string> {
  const save = makeSave(PARAMS, { names: {}, interventions: [], terrain, upheavals: UPS, endYear: END }, '', '星球参照', '2026-11-08T08:00:00.000Z');
  const rk = await recipeKey(recipeOfSave(save));
  const parts = offer.parts.filter((p) => !drop.includes(p.name)).map((p) => ({ ...p, data: p.data.slice(0) }));
  await commitWorld({ id, recipe: save, recipeKey: rk, parts, made: MADE, readers: READERS, ...(offer.mapPlugins ? { mapPlugins: offer.mapPlugins } : {}) });
  return rk;
}

async function planetIn(id: string): Promise<PlanetValue | null> {
  const rev = (await readRevision(id, undefined, ['planet']))!;
  const p = rev.parts.find((x) => x.info.name === 'planet');
  if (!p) return null;
  return unpackValue(await partBytes(p.info as never, new Uint8Array(p.data as ArrayBuffer))) as PlanetValue;
}

/** 推历史的几步:改过去、再推、逐年推演;交回的历史按先后 */
async function pushes(d: Device, id: number, maps: MapPluginFile[], x: Intervention[]): Promise<Civ[]> {
  const out: Civ[] = [];
  d.send({ type: 'resim', id, seq: 1, interventions: x, ...base(maps) });
  out.push((await d.wait(id, ['civ'])).civ);
  d.send({ type: 'extend', id, xid: 1, to: 380, interventions: x, params: PARAMS, terrain: TERRAIN, upheavals: UPS, mapPlugins: maps });
  out.push((await d.wait(id, ['extended'])).civ);
  d.send({ type: 'turn', id, play: { year: 200, commands: [] }, commands: [], years: 20, interventions: x, ...base(maps) });
  out.push((await d.wait(id, ['turn'])).civ);
  return out;
}

let offer: WorldPartsOffer;
let made: Civ;
let x: Intervention[];
let withPlugins: Civ[];

beforeAll(async () => {
  g.indexedDB = new IDBFactory();
  _resetVault();
  files = [await fileOf(await mapTestFile('craters'), { count: 30 }), await fileOf(await mapTestFile('koppen')), await fileOf(await mapTestFile('tides'))];
  ids = mapPluginIds(files.map((f) => ({ id: f.id, version: '1.0.0', sum: f.sum, role: 'map', ...(f.params ? { params: f.params } : {}) })));
  // 装着插件的设备:新建(带地形修改、地形大事),存进仓库
  const a = await device();
  a.send({ type: 'generate', id: 1, scale: 0.25, ...base(files) });
  made = (await a.wait(1, ['done'])).civ!;
  offer = (await a.wait(1, ['worldParts'])).offer;
  records = offer.mapPlugins!;
  await keep('wp', offer);
  const r = made.settlements[0]?.region ?? 0;
  x = [{ kind: 'found', region: regionKey(made, r), from: 120 }];
  withPlugins = await pushes(a, 1, files, x);
  // 等它把最后一份内容打完,换设备时不再往外发
  await a.wait(1, ['worldParts']);
}, 300_000);

afterAll(() => {
  delete g.self;
  _resetVault();
});

describe('存世界时带上星球参照', () => {
  it('用地图插件长、改过地形的世界:存扩张节拍和照着沿用的地名,只有数和地名', async () => {
    expect(records.map((p) => p.id)).toEqual(['craters', 'koppen', 'tides']);
    const planet = await planetIn('wp');
    expect(planet).not.toBeNull();
    expect(planet!.tempo).toMatchObject({ spread: expect.any(Number), capNorm: expect.any(Number) });
    expect(planet!.names!.key).toMatch(/^[0-9a-f]{16}$/);
    expect(planet!.names!.ref.length).toBeGreaterThan(5);
    const opened = await openWorldFile((await revisionFile('wp'))!, { readers: READERS });
    const content = await readWorldContent(opened);
    expect(content.planet).toEqual(planet);
    // 认得、逐项核对的块:带着它的世界能公开分享
    expect(opaqueParts(opened.manifest.parts)).toEqual([]);
    expect(opened.manifest.parts.find((p) => p.name === 'planet')).toMatchObject({ file: 'parts/planet.gz', need: 'extra', schema: 1 });
  });

  it('存下的地名就是这个世界照着沿用的那一份', async () => {
    const ref = new Set((await planetIn('wp'))!.names!.ref.map((r) => r.name));
    expect(made.places.filter((p) => ref.has(p.name)).length).toBeGreaterThan(made.places.length / 2);
  });
});

describe('没装插件的设备推历史', () => {
  let b: Device;
  beforeAll(async () => {
    b = await device();
    b.send({ type: 'load', id: 10, scale: 0.25, ...base(ids), vault: { id: 'wp', recipe: await recipeKey(recipeOfSave(makeSave(PARAMS, { names: {}, interventions: [], terrain: TERRAIN, upheavals: UPS, endYear: END }, '', '星球参照', '2026-11-08T08:00:00.000Z'))), generator: GENERATOR_VERSION } });
    const done = await b.wait(10, ['done', 'loadFailed']);
    expect(done.type).toBe('done');
  }, 120_000);

  it('改过去、再推、逐年推演:和装着插件时一样', async () => {
    const got = await pushes(b, 10, ids, x);
    expect(got).toHaveLength(withPlugins.length);
    got.forEach((c, i) => expect(c).toEqual(withPlugins[i]));
  }, 180_000);

  it('存回仓库的那一份照旧带着星球参照', async () => {
    const o = (await b.wait(10, ['worldParts'])).offer;
    expect(o.mapPlugins).toBeUndefined();
    const p = o.parts.find((q) => q.name === 'planet');
    expect(p && p.sum).toBe((await readRevision('wp', undefined, ['planet']))!.parts.find((q) => q.info.name === 'planet')!.info.sum);
  }, 60_000);

  it('地名风格换了:存下的地名对不上,要先装同一版', async () => {
    b.send({ type: 'resim', id: 10, seq: 2, interventions: x, ...base(ids), names: { imperial: 1 } });
    const f = await b.wait(10, ['mapFailed', 'civ']);
    expect(f).toMatchObject({ type: 'mapFailed', plugin: 'craters', stage: null });
  }, 60_000);

  it('改地形:要先装同一版', async () => {
    b.send({ type: 'generate', id: 11, scale: 0.25, ...base(ids, [...TERRAIN, { kind: 'volcano', pts: [600, 400], r: 20, s: 1 }]) });
    const f = await b.wait(11, ['mapFailed', 'done']);
    expect(f).toMatchObject({ type: 'mapFailed', plugin: 'craters' });
  }, 60_000);
});

describe('没存星球参照的世界', () => {
  it('用地图插件长的:没装插件推不了;装着插件推一次就补上', async () => {
    await keep('wq', offer, TERRAIN, ['planet']);
    expect(await planetIn('wq')).toBeNull();
    const rk = await recipeKey(recipeOfSave(makeSave(PARAMS, { names: {}, interventions: [], terrain: TERRAIN, upheavals: UPS, endYear: END }, '', '星球参照', '2026-11-08T08:00:00.000Z')));
    const load = { type: 'load' as const, scale: 0.25, ...base(ids), vault: { id: 'wq', recipe: rk, generator: GENERATOR_VERSION } };
    const c = await device();
    c.send({ ...load, id: 20 });
    expect((await c.wait(20, ['done', 'loadFailed'])).type).toBe('done');
    c.send({ type: 'resim', id: 20, seq: 1, interventions: x, ...base(ids) });
    expect(await c.wait(20, ['mapFailed', 'civ'])).toMatchObject({ type: 'mapFailed' });

    const d = await device();
    d.send({ ...load, id: 30, mapPlugins: files });
    expect((await d.wait(30, ['done', 'loadFailed'])).type).toBe('done');
    d.send({ type: 'resim', id: 30, seq: 1, interventions: x, ...base(files) });
    expect((await d.wait(30, ['civ'])).civ).toEqual(withPlugins[0]);
    const o = (await d.wait(30, ['worldParts'])).offer;
    const planet = o.parts.find((p) => p.name === 'planet');
    expect(planet?.sum).toBe((await readRevision('wp', undefined, ['planet']))!.parts.find((q) => q.info.name === 'planet')!.info.sum);
  }, 240_000);

  it('用地图插件长、只有地形大事没改地形的:用不着星球参照,没装插件也能推', async () => {
    const h = await device();
    h.send({ type: 'generate', id: 60, scale: 0.25, ...base(files, []) });
    await h.wait(60, ['done']);
    const o = (await h.wait(60, ['worldParts'])).offer;
    expect(o.parts.some((p) => p.name === 'planet')).toBe(false);
    const rk = await keep('wu', o, []);
    h.send({ type: 'resim', id: 60, seq: 1, interventions: x, ...base(files, []) });
    const want = (await h.wait(60, ['civ'])).civ;
    await h.wait(60, ['worldParts']);

    const k = await device();
    k.send({ type: 'load', id: 70, scale: 0.25, ...base(ids, []), vault: { id: 'wu', recipe: rk, generator: GENERATOR_VERSION } });
    expect((await k.wait(70, ['done', 'loadFailed'])).type).toBe('done');
    k.send({ type: 'resim', id: 70, seq: 1, interventions: x, ...base(ids, []) });
    expect((await k.wait(70, ['civ'])).civ).toEqual(want);
  }, 240_000);

  it('没用地图插件的老世界:不存星球参照,照旧能开能推', async () => {
    const e = await device();
    e.send({ type: 'generate', id: 40, scale: 0.25, ...base(undefined) });
    await e.wait(40, ['done']);
    const o = (await e.wait(40, ['worldParts'])).offer;
    expect(o.parts.some((p) => p.name === 'planet')).toBe(false);
    const rk = await keep('wo', o);
    e.send({ type: 'resim', id: 40, seq: 1, interventions: x, ...base(undefined) });
    const want = (await e.wait(40, ['civ'])).civ;
    await e.wait(40, ['worldParts']);

    const f = await device();
    f.send({ type: 'load', id: 50, scale: 0.25, ...base(undefined), vault: { id: 'wo', recipe: rk, generator: GENERATOR_VERSION } });
    expect((await f.wait(50, ['done', 'loadFailed'])).type).toBe('done');
    f.send({ type: 'resim', id: 50, seq: 1, interventions: x, ...base(undefined) });
    expect((await f.wait(50, ['civ'])).civ).toEqual(want);
  }, 240_000);
});

describe('planet 那一块的格式', () => {
  const map = { mesh: { n: 2000 } } as never;
  const good = (): PlanetValue => ({ tempo: { spread: 120, capNorm: 1.5 }, names: { key: '0123456789abcdef', ref: [{ kind: 'sea', x: 10, y: 20, size: 3, rank: 1, name: '东海', style: '', hearth: -1 }] } });

  it('只有数和地名:多一个字段、键不对、地块越界、节拍不是正数都不认', () => {
    expect(() => validatePlanet(good(), map)).not.toThrow();
    expect(() => validatePlanet({}, map)).not.toThrow();
    expect(() => validatePlanet({ tempo: null }, map)).not.toThrow();
    const bad: unknown[] = [
      { ...good(), note: 'x' },
      { tempo: { spread: -1, capNorm: 1 } },
      { tempo: { spread: 1, capNorm: 1, x: 1 } },
      { names: { key: 'XYZ', ref: [] } },
      { names: { key: '0123456789abcdef', ref: [{ ...good().names!.ref[0], hearth: 2000 }] } },
      { names: { key: '0123456789abcdef', ref: [{ ...good().names!.ref[0], kind: 'castle' }] } },
      { names: { key: '0123456789abcdef', ref: [{ ...good().names!.ref[0], text: '多的' }] } },
    ];
    for (const v of bad) expect(() => validatePlanet(v, map), JSON.stringify(v)).toThrow();
  });

  it('另存时可以换掉、去掉', async () => {
    const opened = await openWorldFile((await revisionFile('wp'))!, { readers: READERS });
    const gone = await openWorldFile(await rewriteWorldFile(opened, { values: { planet: null } }), { readers: READERS });
    expect(gone.manifest.parts.some((p) => p.name === 'planet')).toBe(false);
    expect((await readWorldContent(gone)).planet).toBeNull();
    const back = await openWorldFile(await rewriteWorldFile(gone, { values: { planet: good() } }), { readers: READERS });
    expect((await readWorldContent(back)).planet).toEqual(good());
  });

  it('打开存着的世界:星球参照过不了校验的当没有,以后再打开(已经校验过)也一样', async () => {
    const save = makeSave(PARAMS, { names: {}, interventions: [], terrain: TERRAIN, upheavals: UPS, endYear: END }, '', '星球参照', '2026-11-08T08:00:00.000Z');
    const rk = await recipeKey(recipeOfSave(save));
    const view = () => offer.parts.filter((p) => p.name !== 'planet').map((p) => ({ ...p, data: p.data.slice(0) }));
    await commitWorld({ id: 'wbad', recipe: save, recipeKey: rk, parts: [...view(), await makePart('planet', { tempo: { spread: -1, capNorm: 1 } })], made: MADE, readers: READERS });
    await commitWorld({ id: 'wgood', recipe: save, recipeKey: rk, parts: [...view(), await makePart('planet', good())], made: MADE, readers: READERS });
    const open = (id: string) => openStoredWorld({ id, recipe: rk, generator: GENERATOR_VERSION });
    for (let i = 0; i < 2; i++) {
      expect((await open('wbad')).planet).toBeNull();
      expect((await open('wgood')).planet).toEqual(good());
    }
  });

  it('仓库:说了用哪些地图插件(地图换了)就整块换掉,没说的照上一份', async () => {
    const before = (await readRevision('wp', undefined, ['planet']))!.parts.find((q) => q.info.name === 'planet')!.info.sum;
    const save = makeSave(PARAMS, { names: {}, interventions: [], terrain: TERRAIN, upheavals: UPS, endYear: END }, '', '星球参照', '2026-11-08T08:00:00.000Z');
    const view = offer.parts.filter((p) => p.name !== 'planet').map((p) => ({ ...p, data: p.data.slice(0) }));
    await commitWorld({ id: 'wp', recipe: save, recipeKey: 'k2', parts: view, made: MADE, readers: READERS });
    expect((await readRevision('wp', undefined, []))!.manifest.parts.find((p) => p.name === 'planet')?.sum).toBe(before);
    await commitWorld({ id: 'wp', recipe: save, recipeKey: 'k3', parts: view.map((p) => ({ ...p, data: p.data.slice(0) })), made: MADE, readers: READERS, mapPlugins: records });
    expect((await readRevision('wp', undefined, []))!.manifest.parts.some((p) => p.name === 'planet')).toBe(false);
  });
});

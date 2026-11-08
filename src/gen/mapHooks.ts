/**
 * 地图插件在生成流程里出手的三个口子:改海拔(height)、改气候(climate)、出图层(layers)。
 * 生成流程只认这里的接口,插件怎么跑由调用方包成 MapPlugin;交回的东西在这里核对、压范围以后才套上。
 * 纯计算,worker 和 Node 里都能跑。
 */
import type { Mesh } from './mesh';
import { BIOMES } from './biomes';
import { keyed, subSeed } from './util';
import { KM_PER_UNIT } from './civ/scale';

export type MapStage = 'height' | 'climate' | 'layers';

/** 每个插件最多交几张图层 */
export const MAP_LAYERS_MAX = 4;
/** 交回的值压到这些范围里(海拔:米;气温:°C;降水:毫米 / 年) */
export const MAP_RANGE = {
  elevation: [-11000, 9000],
  temperature: [-70, 50],
  precipitation: [0, 15000],
} as const;

/** 三个口子都递的 */
export interface MapShared {
  n: number;
  /** 纬度、经度(度) */
  lat: Float32Array;
  lon: Float32Array;
  /** 单位球面上的位置,交错存 x, y, z */
  xyz: Float32Array;
  /** 邻接表:地块 i 的邻居是 adj[adjStart[i] .. adjStart[i+1]) */
  adjStart: Int32Array;
  adj: Int32Array;
  /** xyz 里的一个单位(星球半径)合多少公里 */
  kmPerUnit: number;
  /** 地图种子 */
  seed: number;
  /** [0, 1) 的随机数,只由地图种子、插件编号和 a、b、c 定 */
  rand(a?: number, b?: number, c?: number): number;
}

export interface HeightInput extends MapShared {
  /** 海拔(米) */
  elevation: Float32Array;
  /** 1 陆地 / 0 海 */
  land: Uint8Array;
  plate: Int16Array;
}
/** 不给 land:海拔改过的地块高过 0 米是陆地、不高于是海 */
export interface HeightReply {
  elevation?: ArrayLike<number>;
  land?: ArrayLike<number>;
}

export interface ClimateInput extends MapShared {
  elevation: Float32Array;
  /** 0 陆地 / 1 海 / 2 湖 */
  water: Uint8Array;
  temperature: Float32Array;
  /** 年降水(毫米) */
  precipitation: Float32Array;
  windX: Float32Array;
  windY: Float32Array;
  /** 这个地块的夏半年、冬半年按全年算的降水(毫米 / 年;年降水是两者的平均) */
  rainSummer: Float32Array;
  rainWinter: Float32Array;
}
export interface ClimateReply {
  temperature?: ArrayLike<number>;
  precipitation?: ArrayLike<number>;
}

export interface LayersInput extends ClimateInput {
  plate: Int16Array;
  /** 湖面高度(米,只有湖有意义) */
  waterLevel: Float32Array;
  seaIce: Float32Array;
  biome: Uint8Array;
  /** 群落编号 → 名字 */
  biomeNames: readonly string[];
  flux: Float32Array;
  riverThreshold: number;
  /** 河经过的地块,一条接一条;第 k 条是 riverCells[riverStart[k] .. riverStart[k+1]) */
  riverCells: Int32Array;
  riverStart: Int32Array;
}
/** 值是 NaN 的地块不画 */
export interface LayersReply {
  layers?: Readonly<Record<string, ArrayLike<number>>>;
}

/** 包好的一个地图插件;交回 undefined = 这一口不改 */
export interface MapPlugin {
  /** 插件编号:rand、出错时报的、图层归谁都按它 */
  id: string;
  /** 同一个插件、同一版、同样的滑条 = 同一串;生成的缓存和「没改地形的星球」按它认 */
  key: string;
  stages: readonly MapStage[];
  /** 清单里登记的图层编号:出图层只收这几张 */
  layerIds?: readonly string[];
  height?(d: HeightInput): HeightReply | undefined;
  climate?(d: ClimateInput): ClimateReply | undefined;
  layers?(d: LayersInput): LayersReply | undefined;
}

/** 地图插件出的一张图层 */
export interface MapLayer {
  /** 哪个插件的 */
  by: string;
  id: string;
  /** 每个地块一个数 */
  values: Float32Array;
}

/** 地图插件出错:哪个插件、哪一口、为什么 */
export class MapPluginError extends Error {
  constructor(
    readonly plugin: string,
    readonly stage: MapStage,
    readonly why: string,
    options?: { cause?: unknown },
  ) {
    super(`地图插件「${plugin}」在${STAGE_NAME[stage]}这一步出错:${why}`, options);
    this.name = 'MapPluginError';
  }
}

const STAGE_NAME: Record<MapStage, string> = { height: '改海拔', climate: '改气候', layers: '出图层' };

/** 同一串插件:生成的缓存键、世界记的都是它 */
export const mapPluginKeys = (plugins: readonly MapPlugin[]): string[] => plugins.map((p) => p.key);

export const hasStage = (plugins: readonly MapPlugin[], stage: MapStage): boolean => plugins.some((p) => p.stages.includes(stage));

/** 去掉出图层那一口(长来对照的星球用不着图层;键不变) */
export function withoutLayers(plugins: readonly MapPlugin[]): MapPlugin[] {
  return plugins.map((pl) =>
    pl.stages.includes('layers')
      ? {
          id: pl.id,
          key: pl.key,
          stages: pl.stages.filter((s) => s !== 'layers'),
          ...(pl.height ? { height: pl.height.bind(pl) } : {}),
          ...(pl.climate ? { climate: pl.climate.bind(pl) } : {}),
        }
      : pl,
  );
}

function shared(mesh: Mesh, seed: number, pl: MapPlugin): MapShared {
  const { n } = mesh;
  const lat = new Float32Array(n);
  const lon = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lat[i] = 90 - (180 * mesh.y[i]) / mesh.height;
    lon[i] = (360 * mesh.x[i]) / mesh.width - 180;
  }
  const base = subSeed(seed, `map:${pl.id}`);
  return {
    n,
    lat,
    lon,
    xyz: mesh.xyz.slice(),
    adjStart: mesh.adjStart.slice(),
    adj: mesh.adj.slice(),
    kmPerUnit: (mesh.width * KM_PER_UNIT) / (2 * Math.PI),
    seed,
    rand: (a = 0, b = 0, c = 0) => keyed(base, a, b, c),
  };
}

function call<I, R extends object>(pl: MapPlugin, stage: MapStage, d: I): R | undefined {
  const fn = pl[stage] as ((d: I) => R | undefined) | undefined;
  if (typeof fn !== 'function') throw new MapPluginError(pl.id, stage, '代码里没有这一步');
  let r: unknown;
  try {
    r = fn.call(pl, d);
  } catch (e) {
    if (e instanceof MapPluginError) throw e;
    throw new MapPluginError(pl.id, stage, e instanceof Error ? e.message : String(e), { cause: e });
  }
  if (r === undefined || r === null) return undefined;
  if (typeof r !== 'object' || Array.isArray(r)) throw new MapPluginError(pl.id, stage, '交回的不是对象');
  return r as R;
}

const arrayLike = (v: unknown): v is ArrayLike<unknown> => typeof v === 'object' && v !== null && typeof (v as ArrayLike<unknown>).length === 'number';

/** 有限数、长度 = 地块数,压到 [lo, hi] */
function clamped(pl: MapPlugin, stage: MapStage, name: string, v: unknown, n: number, [lo, hi]: readonly [number, number]): Float32Array {
  if (!arrayLike(v) || v.length !== n) throw new MapPluginError(pl.id, stage, `${name} 的长度不是地块数 ${n}`);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = v[i];
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new MapPluginError(pl.id, stage, `${name}[${i}] 不是有限的数`);
    out[i] = x < lo ? lo : x > hi ? hi : x;
  }
  return out;
}

const copy = <T extends Float32Array | Uint8Array>(a: T): T => a.slice() as T;

/** 改海拔:按先后出手,elevation、land 原地改 */
export function heightHooks(plugins: readonly MapPlugin[], mesh: Mesh, seed: number, elevation: Float32Array, land: Uint8Array, plate: Int16Array): void {
  const { n } = mesh;
  for (const pl of plugins) {
    if (!pl.stages.includes('height')) continue;
    const r = call<HeightInput, HeightReply>(pl, 'height', { ...shared(mesh, seed, pl), elevation: copy(elevation), land: copy(land), plate: plate.slice() });
    if (!r) continue;
    const e = r.elevation === undefined ? null : clamped(pl, 'height', 'elevation', r.elevation, n, MAP_RANGE.elevation);
    let l: Uint8Array | null = null;
    if (r.land !== undefined) {
      const v = r.land;
      if (!arrayLike(v) || v.length !== n) throw new MapPluginError(pl.id, 'height', `land 的长度不是地块数 ${n}`);
      l = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        if (v[i] !== 0 && v[i] !== 1) throw new MapPluginError(pl.id, 'height', `land[${i}] 不是 0 或 1`);
        l[i] = v[i] as number;
      }
    }
    if (e) {
      for (let i = 0; i < n; i++) {
        if (e[i] === elevation[i]) continue;
        elevation[i] = e[i];
        if (l) continue;
        if (land[i] && e[i] <= 0) land[i] = 0;
        else if (!land[i] && e[i] > 0) land[i] = 1;
      }
    }
    if (l) land.set(l);
  }
}

export interface ClimateFields {
  elevation: Float32Array;
  water: Uint8Array;
  temperature: Float32Array;
  precipitation: Float32Array;
  windX: Float32Array;
  windY: Float32Array;
  rainSummer: Float32Array;
  rainWinter: Float32Array;
}

const climateCopy = (c: ClimateFields): ClimateFields => ({
  elevation: copy(c.elevation),
  water: copy(c.water),
  temperature: copy(c.temperature),
  precipitation: copy(c.precipitation),
  windX: copy(c.windX),
  windY: copy(c.windY),
  rainSummer: copy(c.rainSummer),
  rainWinter: copy(c.rainWinter),
});

/** 改气候:按先后出手,temperature、precipitation 原地改 */
export function climateHooks(plugins: readonly MapPlugin[], mesh: Mesh, seed: number, c: ClimateFields): void {
  const { n } = mesh;
  for (const pl of plugins) {
    if (!pl.stages.includes('climate')) continue;
    const r = call<ClimateInput, ClimateReply>(pl, 'climate', { ...shared(mesh, seed, pl), ...climateCopy(c) });
    if (!r) continue;
    const t = r.temperature === undefined ? null : clamped(pl, 'climate', 'temperature', r.temperature, n, MAP_RANGE.temperature);
    const p = r.precipitation === undefined ? null : clamped(pl, 'climate', 'precipitation', r.precipitation, n, MAP_RANGE.precipitation);
    if (t) c.temperature.set(t);
    if (p) c.precipitation.set(p);
  }
}

export interface LayerFields extends ClimateFields {
  plate: Int16Array;
  waterLevel: Float32Array;
  seaIce: Float32Array;
  biome: Uint8Array;
  flux: Float32Array;
  riverThreshold: number;
  rivers: readonly { cells: Int32Array }[];
}

/** 出图层:只看不改;按插件先后、各自登记的先后交回 */
export function layerHooks(plugins: readonly MapPlugin[], mesh: Mesh, seed: number, w: LayerFields): MapLayer[] {
  const { n } = mesh;
  const riverStart = new Int32Array(w.rivers.length + 1);
  for (let k = 0; k < w.rivers.length; k++) riverStart[k + 1] = riverStart[k] + w.rivers[k].cells.length;
  const riverCells = new Int32Array(riverStart[w.rivers.length]);
  for (let k = 0; k < w.rivers.length; k++) riverCells.set(w.rivers[k].cells, riverStart[k]);
  const out: MapLayer[] = [];
  for (const pl of plugins) {
    if (!pl.stages.includes('layers')) continue;
    const r = call<LayersInput, LayersReply>(pl, 'layers', {
      ...shared(mesh, seed, pl),
      ...climateCopy(w),
      plate: w.plate.slice(),
      waterLevel: copy(w.waterLevel),
      seaIce: copy(w.seaIce),
      biome: copy(w.biome),
      biomeNames: BIOMES.map((b) => b.name),
      flux: copy(w.flux),
      riverThreshold: w.riverThreshold,
      riverCells: riverCells.slice(),
      riverStart: riverStart.slice(),
    });
    if (!r || r.layers === undefined) continue;
    const got = r.layers;
    if (typeof got !== 'object' || got === null || Array.isArray(got)) throw new MapPluginError(pl.id, 'layers', 'layers 不是「图层编号 → 数组」');
    const ids = Object.keys(got);
    const known = pl.layerIds ?? [];
    for (const id of ids) if (!known.includes(id)) throw new MapPluginError(pl.id, 'layers', `图层「${id}」没在清单里登记`);
    if (ids.length > MAP_LAYERS_MAX) throw new MapPluginError(pl.id, 'layers', `交了 ${ids.length} 张图层,最多 ${MAP_LAYERS_MAX} 张`);
    for (const id of known) {
      if (!ids.includes(id)) continue;
      const v = got[id];
      if (!arrayLike(v) || v.length !== n) throw new MapPluginError(pl.id, 'layers', `图层「${id}」的长度不是地块数 ${n}`);
      const values = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = v[i];
        // 存成 32 位以后才看是不是无穷大:1e100 这样的有限数也会变成无穷大
        values[i] = typeof x === 'number' ? x : Infinity;
        if (values[i] === Infinity || values[i] === -Infinity) throw new MapPluginError(pl.id, 'layers', `图层「${id}」第 ${i} 个不是数,或是无穷大`);
      }
      out.push({ by: pl.id, id, values });
    }
  }
  return out;
}

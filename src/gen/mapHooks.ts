/**
 * 地图插件在生成流程里出手的三个口子:改海拔(height)、改气候(climate)、出图层(layers)。
 * 生成流程只认这里的接口,插件怎么跑由调用方包成 MapPlugin;交回的东西在这里核对、压范围以后才套上。
 * 纯计算,worker 和 Node 里都能跑。
 */
import type { Mesh } from './mesh';
import type { Tectonics } from './tectonics';
import type { WorldParams } from './params';
import type { Currents } from './currents';
import { BIOMES } from './biomes';
import { geometryOf } from './geometry';
import { keyed, subSeed } from './util';
import { KM_PER_UNIT } from './civ/scale';
import { mapHelpers, type MapHelpers } from './mapHelpers';
import { MAP_READS } from './mapReads';

export type MapStage = 'height' | 'climate' | 'layers';

/** 每个插件最多交几张图层 */
export const MAP_LAYERS_MAX = 4;
/** 交回的值压到这些范围里(海拔:米;气温:°C;降水:毫米 / 年) */
export const MAP_RANGE = {
  elevation: [-11000, 9000],
  temperature: [-70, 50],
  precipitation: [0, 15000],
} as const;

/** 新建世界时的参数(滑条上的那些数) */
export interface MapWorldParams {
  seed: number;
  /** 要的地块数(实际是 n) */
  cells: number;
  /** 陆地占几成 */
  landFraction: number;
  /** 板块几块 */
  plates: number;
  /** 山多高(1 = 原样) */
  mountains: number;
  /** 整体冷暖(0 = 原样) */
  temperature: number;
  /** 雨多少(1 = 原样) */
  rainfall: number;
  /** 主要大陆几块(0 = 自动) */
  continents: number;
  /** 大陆聚在一起的程度(0–1) */
  gather: number;
  /** 破碎度(1 = 原样) */
  rugged: number;
  /** 板块硬度(1 = 原样) */
  hardness: number;
  /** 陆地偏向哪个半球(−1 南 … 1 北) */
  north: number;
}

/** 三个口子都递的;帮手(噪声、平滑……)见 mapHelpers.ts;带 ? 的是清单 map.reads 写了才递的 */
export interface MapShared extends MapHelpers {
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
  /** 每个板块在自己质心处的漂移速度(东、南分量;没有单位,大小 0.3–1) */
  plateVx?: Float32Array;
  plateVy?: Float32Array;
  /** 每个板块绕转轴转动的角速度向量,交错存 x, y, z(和 xyz 同一套坐标):板块在某处的速度 = ω × 那处的位置 */
  plateOmega?: Float32Array;
  /** 每个板块:1 大陆板块 / 0 大洋板块 */
  plateContinental?: Uint8Array;
  /** 板块边界上的汇聚强度:正 = 相撞,负 = 张裂,0 = 不在边界 */
  convergence?: Float32Array;
  /** 离最近的相撞边界(汇聚强度大于 0.25)多少公里;一处都没有 = −1 */
  convergentKm?: Float32Array;
  /** 最近的那段相撞边界撞得多猛(0–1) */
  convergentStrength?: Float32Array;
  /** 离最近的张裂边界(汇聚强度小于 −0.25)多少公里;一处都没有 = −1 */
  divergentKm?: Float32Array;
  /** 最近的那段张裂边界裂得多猛(0–1) */
  divergentStrength?: Float32Array;
  /** 陆地抬升得多快(没有单位;雨水冲刷之前定的,山是从它冲出来的) */
  uplift?: Float32Array;
  /** 高原底座(米;海里是 0) */
  plateau?: Float32Array;
  /** 海底深度(米,负数;陆地是 0;雨水冲刷之前定的) */
  oceanDepth?: Float32Array;
  /** 每个地块的面积(平方公里) */
  cellArea?: Float32Array;
  /** 新建世界时的参数 */
  worldParams?: MapWorldParams;
  /** 1 = 作者在地形编辑里改过的地块 */
  edited?: Uint8Array;
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
  /** 洋流的表层流向(东、南分量,长短 = 强弱 0–1);陆地、湖是 0 */
  currentU?: Float32Array;
  currentV?: Float32Array;
  /** 洋流让海面比同纬度的平均暖多少(°C,负 = 冷);陆地、湖是 0 */
  currentTemp?: Float32Array;
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
  /** 水往哪块流(−1 = 海,或者流不到海) */
  downstream?: Int32Array;
  /** 洼地灌满以后的水面(米):比海拔高 3 米以上的积成了湖(太大的湖后来填平了) */
  fillLevel?: Float32Array;
  /** 每块自己产多少水(米 / 年,只有陆地有);flux 是它沿 downstream 一路加起来的 */
  runoff?: Float32Array;
  /** 湿地适宜度(0–1):陆地上到 0.5 的成了湿地 */
  wetland?: Float32Array;
  /** 最高海拔(米),山名、山峰符号的门槛按它定;改过地形的世界照没改时的 */
  maxElevation?: number;
}
/** 值是 NaN 的地块不画 */
export interface LayersReply {
  layers?: Readonly<Record<string, ArrayLike<number>>>;
}

/** 包好的一个地图插件;交回 undefined = 这一口不改 */
export interface MapPlugin {
  /** 插件编号:rand、出错时报的、图层归谁都按它 */
  id: string;
  /** 给人看的名字(进度里写;不给 = 编号) */
  name?: string;
  /** 同一个插件、同一版、同样的滑条 = 同一串;生成的缓存和「没改地形的星球」按它认 */
  key: string;
  stages: readonly MapStage[];
  /** 清单里登记的图层编号:出图层只收这几张 */
  layerIds?: readonly string[];
  /** 清单 map.reads:每一口多递哪些数 */
  reads?: readonly string[];
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

/** 出错的是哪一种:插件抛错、一口算太久、合计算太久、交回的数不对 */
export type MapFailKind = 'throw' | 'slow' | 'total' | 'bad';

/** 一个插件一口用了多久(毫秒) */
export interface MapSpent {
  id: string;
  stage: MapStage;
  ms: number;
}

/** 地图插件出错:哪个插件、哪一口、为什么;合计算太久的带上到那时每一口各用了多久 */
export class MapPluginError extends Error {
  readonly kind: MapFailKind;
  readonly spent?: readonly MapSpent[];
  constructor(
    readonly plugin: string,
    readonly stage: MapStage,
    readonly why: string,
    options?: { cause?: unknown; kind?: MapFailKind; spent?: readonly MapSpent[] },
  ) {
    super(`地图插件「${plugin}」在${STAGE_NAME[stage]}这一步出错:${why}`, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'MapPluginError';
    this.kind = options?.kind ?? 'bad';
    if (options?.spent) this.spent = options.spent;
  }
}

const STAGE_NAME: Record<MapStage, string> = { height: '改海拔', climate: '改气候', layers: '出图层' };

/** 进度里那一句:地图插件「柯本气候」：改气候 */
export const mapStageNote = (pl: Pick<MapPlugin, 'id' | 'name'>, stage: MapStage): string => `地图插件「${pl.name ?? pl.id}」：${STAGE_NAME[stage]}`;

/** 叫停线(毫秒):一口;一次生成里所有地图插件合计 */
export const MAP_PLUGIN_TIME = { stage: 5000, total: 15_000 } as const;

const sec = (ms: number) => (ms / 1000).toFixed(1);

/**
 * 一次生成里地图插件的用时,超了停在那一口。计时只决定停不停,不进世界;
 * 一口超了算那一口的插件,加起来超了算用得最多的那个
 */
export class MapClock {
  private readonly spent = new Map<string, number>();
  private readonly each: MapSpent[] = [];
  private sum = 0;

  /** now 不给 = performance.now(单测换成假的) */
  constructor(readonly now: () => number = () => performance.now()) {}

  spend(id: string, stage: MapStage, ms: number): void {
    this.spent.set(id, (this.spent.get(id) ?? 0) + ms);
    const at = this.each.find((x) => x.id === id && x.stage === stage);
    if (at) at.ms += ms;
    else this.each.push({ id, stage, ms });
    this.sum += ms;
    if (ms > MAP_PLUGIN_TIME.stage) throw new MapPluginError(id, stage, `用了 ${sec(ms)} 秒,超过 ${sec(MAP_PLUGIN_TIME.stage)} 秒`, { kind: 'slow' });
    if (this.sum > MAP_PLUGIN_TIME.total) {
      let top = id;
      for (const [k, v] of this.spent) if (v > this.spent.get(top)!) top = k;
      throw new MapPluginError(top, stage, `到这一步所有地图插件一共用了 ${sec(this.sum)} 秒,超过 ${sec(MAP_PLUGIN_TIME.total)} 秒(它用得最多,${sec(this.spent.get(top)!)} 秒)`, {
        kind: 'total',
        spent: this.each.map((x) => ({ ...x })),
      });
    }
  }
}

/** 一次生成用的这串插件,每一口的用时记进 clock(一次生成一个新的 clock) */
export function timedMapPlugins(plugins: readonly MapPlugin[], clock = new MapClock()): MapPlugin[] {
  return plugins.map((pl) => {
    const timed =
      <D, R>(stage: MapStage, fn: (d: D) => R) =>
      (d: D): R => {
        const t0 = clock.now();
        const r = fn.call(pl, d);
        clock.spend(pl.id, stage, clock.now() - t0);
        return r;
      };
    return {
      id: pl.id,
      key: pl.key,
      ...(pl.name ? { name: pl.name } : {}),
      stages: pl.stages,
      ...(pl.layerIds ? { layerIds: pl.layerIds } : {}),
      ...(pl.reads ? { reads: pl.reads } : {}),
      ...(pl.height && pl.stages.includes('height') ? { height: timed('height', pl.height) } : {}),
      ...(pl.climate && pl.stages.includes('climate') ? { climate: timed('climate', pl.climate) } : {}),
      ...(pl.layers && pl.stages.includes('layers') ? { layers: timed('layers', pl.layers) } : {}),
    };
  });
}

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
          ...(pl.name ? { name: pl.name } : {}),
          stages: pl.stages.filter((s) => s !== 'layers'),
          ...(pl.reads ? { reads: pl.reads } : {}),
          ...(pl.height ?{ height: pl.height.bind(pl) } : {}),
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
    ...mapHelpers(mesh, seed, pl.id),
  };
}

/** 清单 map.reads 要的数从这里取;生成到哪一口有哪几样 */
export interface MapSources {
  tect?: Pick<
    Tectonics,
    'plateVx' | 'plateVy' | 'plateOmega' | 'plateContinental' | 'convergence' | 'distConv' | 'strengthConv' | 'distDiv' | 'strengthDiv' | 'uplift' | 'plateau' | 'oceanDepth'
  >;
  params?: WorldParams;
  /** 有插件要读才算 */
  edited?: () => Uint8Array;
  currents?: Currents;
  downstream?: Int32Array;
  fillLevel?: Float32Array;
  runoff?: Float32Array;
  wetland?: Float32Array;
  maxElevation?: number;
}

const WORLD_PARAMS: readonly (keyof MapWorldParams)[] = ['seed', 'cells', 'landFraction', 'plates', 'mountains', 'temperature', 'rainfall', 'continents', 'gather', 'rugged', 'hardness', 'north'];

/** 世界单位 → 公里;Infinity(到不了)→ −1 */
function kmOf(a: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] === Infinity ? -1 : a[i] * KM_PER_UNIT;
  return out;
}

const areaMemo = new WeakMap<Mesh, Float32Array>();
function cellAreaKm2(mesh: Mesh): Float32Array {
  let a = areaMemo.get(mesh);
  if (!a) {
    a = geometryOf(mesh).cellAreas();
    for (let i = 0; i < a.length; i++) a[i] *= KM_PER_UNIT * KM_PER_UNIT;
    areaMemo.set(mesh, a);
  }
  return a;
}

/** 这个插件在这一口多要的(都是复制的一份) */
function readsFor(pl: MapPlugin, stage: MapStage, mesh: Mesh, src: MapSources | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!pl.reads?.length || !src) return out;
  const t = src.tect;
  for (const r of pl.reads) {
    if (!Object.prototype.hasOwnProperty.call(MAP_READS, r) || !MAP_READS[r].includes(stage)) continue;
    let v: unknown;
    switch (r) {
      case 'plateVx':
      case 'plateVy':
      case 'plateOmega':
      case 'plateContinental':
      case 'convergence':
      case 'uplift':
      case 'plateau':
      case 'oceanDepth':
        v = t?.[r].slice();
        break;
      case 'convergentKm':
        v = t && kmOf(t.distConv);
        break;
      case 'convergentStrength':
        v = t?.strengthConv.slice();
        break;
      case 'divergentKm':
        v = t && kmOf(t.distDiv);
        break;
      case 'divergentStrength':
        v = t?.strengthDiv.slice();
        break;
      case 'cellArea':
        v = cellAreaKm2(mesh).slice();
        break;
      case 'worldParams': {
        const p = src.params;
        v = p && Object.fromEntries(WORLD_PARAMS.map((k) => [k, p[k]]));
        break;
      }
      case 'edited':
        v = src.edited?.().slice();
        break;
      case 'currentU':
        v = src.currents?.u.slice();
        break;
      case 'currentV':
        v = src.currents?.v.slice();
        break;
      case 'currentTemp':
        v = src.currents?.sst.slice();
        break;
      case 'downstream':
      case 'fillLevel':
      case 'runoff':
      case 'wetland':
        v = src[r]?.slice();
        break;
      case 'maxElevation':
        v = src.maxElevation;
        break;
    }
    if (v !== undefined) out[r] = v;
  }
  return out;
}

function call<I, R extends object>(pl: MapPlugin, stage: MapStage, d: I): R | undefined {
  const fn = pl[stage] as ((d: I) => R | undefined) | undefined;
  if (typeof fn !== 'function') throw new MapPluginError(pl.id, stage, '代码里没有这一步', { kind: 'throw' });
  let r: unknown;
  try {
    r = fn.call(pl, d);
  } catch (e) {
    if (e instanceof MapPluginError) throw e;
    throw new MapPluginError(pl.id, stage, e instanceof Error ? e.message : String(e), { cause: e, kind: 'throw' });
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

/** 一个插件要出手了(进度里说一声) */
export type MapSay = (pl: MapPlugin, stage: MapStage) => void;

/** 改海拔:按先后出手,elevation、land 原地改 */
export function heightHooks(
  plugins: readonly MapPlugin[],
  mesh: Mesh,
  seed: number,
  elevation: Float32Array,
  land: Uint8Array,
  plate: Int16Array,
  say?: MapSay,
  src?: MapSources,
): void {
  const { n } = mesh;
  for (const pl of plugins) {
    if (!pl.stages.includes('height')) continue;
    say?.(pl, 'height');
    const r = call<HeightInput, HeightReply>(pl, 'height', {
      ...shared(mesh, seed, pl),
      ...readsFor(pl, 'height', mesh, src),
      elevation: copy(elevation),
      land: copy(land),
      plate: plate.slice(),
    });
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
export function climateHooks(plugins: readonly MapPlugin[], mesh: Mesh, seed: number, c: ClimateFields, say?: MapSay, src?: MapSources): void {
  const { n } = mesh;
  for (const pl of plugins) {
    if (!pl.stages.includes('climate')) continue;
    say?.(pl, 'climate');
    const r = call<ClimateInput, ClimateReply>(pl, 'climate', { ...shared(mesh, seed, pl), ...readsFor(pl, 'climate', mesh, src), ...climateCopy(c) });
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
export function layerHooks(plugins: readonly MapPlugin[], mesh: Mesh, seed: number, w: LayerFields, say?: MapSay, src?: MapSources): MapLayer[] {
  const { n } = mesh;
  const riverStart = new Int32Array(w.rivers.length + 1);
  for (let k = 0; k < w.rivers.length; k++) riverStart[k + 1] = riverStart[k] + w.rivers[k].cells.length;
  const riverCells = new Int32Array(riverStart[w.rivers.length]);
  for (let k = 0; k < w.rivers.length; k++) riverCells.set(w.rivers[k].cells, riverStart[k]);
  const out: MapLayer[] = [];
  for (const pl of plugins) {
    if (!pl.stages.includes('layers')) continue;
    say?.(pl, 'layers');
    const r = call<LayersInput, LayersReply>(pl, 'layers', {
      ...shared(mesh, seed, pl),
      ...readsFor(pl, 'layers', mesh, src),
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

/**
 * 网站替地图插件算的几样「帮手」:噪声、平滑、离某些地块几步、某块附近的地块、水往哪流、连成的片……,另有两块之间多少公里。
 * 只读网格、按种子定,交回新数组;插件在 QuickJS 里算这些要慢几十倍,网站这头算好递进去。
 * 参数是插件给的,一律当不可信的核对,写错了抛 Error(说是哪个帮手、哪一项)。纯计算,worker 和 Node 里都能跑。
 */
import type { Mesh } from './mesh';
import { blurField, components as meshComponents } from './mesh';
import { geometryOf } from './geometry';
import { subSeed } from './util';
import { KM_PER_UNIT } from './civ/scale';
import { accumulate, drainage } from './erosion';
import { distanceField } from './tectonics';
import { classifyBiome } from './biomes';

export interface NoiseOptions {
  /** 起伏的尺度(公里):大约多远一个起落 */
  km: number;
  /** 叠几层(1–8,默认 1);每多一层尺度减半 */
  octaves?: number;
  /** 每多一层起伏乘多少(0–1,默认 0.5) */
  persistence?: number;
  /** 同一个插件要几张不同的噪声时各给一个 */
  salt?: string | number;
}

export interface MapHelpers {
  /** 每个地块一个 −1…1 左右的数,和官方生成用的同一套噪声 */
  noise(o: NoiseOptions): Float32Array;
  /** 和邻居平均 passes 遍(0–200);给了 mask 只在标了 1 的地块上平均、只和标了 1 的邻居平均,别的地块不变 */
  blur(field: ArrayLike<number>, passes: number, mask?: ArrayLike<number>): Float32Array;
  /** 从 from 标了 1 的地块沿邻居走,每块要走几步(到不了 = −1);给了 through 只能走进标了 1 的地块 */
  steps(from: ArrayLike<number>, through?: ArrayLike<number>): Int32Array;
  /** 离地块 cell 不超过 km 公里的地块(含它自己),按编号从小到大 */
  near(cell: number, km: number): Int32Array;
  /** 两块之间多少公里(直线穿过星球的距离,近处和沿地面走差不多) */
  km(a: number, b: number): number;
  /** 山脊噪声:每个地块一个 0…1 的数,山脊处接近 1,和官方长老山脉用的同一套 */
  ridged(o: NoiseOptions): Float32Array;
  /** 水往哪流:land 标了 1 的是陆地,水从高往低流到不是陆地的地块为止,洼地先灌满;rain = 每块自己产多少水(不给 = 陆地每块 1) */
  flow(height: ArrayLike<number>, land: ArrayLike<number>, rain?: ArrayLike<number>): FlowResult;
  /** 从 from 标了 1 的地块沿邻居走,每块要走多少公里、最近的是哪个起点;给了 through 只能走进标了 1 的地块 */
  distance(from: ArrayLike<number>, through?: ArrayLike<number>): DistanceResult;
  /** mask 标了 1 的地块连成几片、每片多大 */
  components(mask: ArrayLike<number>): ComponentsResult;
  /** 每块和邻居比,最陡的那一下每公里升降多少(height 的单位 / 公里,不分上下) */
  slope(height: ArrayLike<number>): Float32Array;
  /** 纬度 lat、经度 lon(度)处是哪个地块 */
  cellAt(lat: number, lon: number): number;
  /** 从地块 a 沿最短的路(大圆)走到地块 b 经过的地块,含两头,按先后 */
  line(a: number, b: number): Int32Array;
  /** 每块沿纬线往西、往东到最近的标了 1 的地块多少公里;这一圈纬线上一块都没有 = −1 */
  westEast(mask: ArrayLike<number>): WestEastResult;
  /** 按气温(°C)、年降水(毫米)判群落编号(和 d.biomeNames 对得上);给了 water(0 陆地 / 1 海 / 2 湖)海、湖照水面判 */
  biomeOf(temperature: ArrayLike<number>, precipitation: ArrayLike<number>, water?: ArrayLike<number>): Uint8Array;
}

export interface FlowResult {
  /** 水往哪块流(−1 = 不是陆地,或者流不到不是陆地的地块) */
  downstream: Int32Array;
  /** 洼地灌满以后的水面(和 height 同一个单位;比 height 高的地方积着水) */
  fillLevel: Float32Array;
  /** 汇流量:自己的 rain 加上游流来的 */
  flux: Float32Array;
}

export interface DistanceResult {
  /** 沿邻居走过来多少公里;走不到 = −1 */
  km: Float32Array;
  /** 最近的是哪个起点(地块编号);走不到 = −1 */
  nearest: Int32Array;
}

export interface ComponentsResult {
  /** 每块属于第几片(没标 1 的 = −1);片按里面最小的地块编号排 */
  group: Int32Array;
  /** 第几片有几块 */
  size: Int32Array;
}

export interface WestEastResult {
  /** 往西多少公里 */
  west: Float32Array;
  /** 往东多少公里 */
  east: Float32Array;
}

export const NOISE_OCTAVES_MAX = 8;
export const BLUR_PASSES_MAX = 200;
const SALT_MAX = 64;

const arrayLike = (v: unknown): v is ArrayLike<unknown> => typeof v === 'object' && v !== null && typeof (v as ArrayLike<unknown>).length === 'number';

/** 地块数那么长、每格是数 */
function cellsOf(name: string, v: unknown, n: number): ArrayLike<number> {
  if (!arrayLike(v) || v.length !== n) throw new Error(`${name} 要是一个长度等于地块数 ${n} 的数组`);
  if (ArrayBuffer.isView(v)) return v as unknown as ArrayLike<number>;
  for (let i = 0; i < n; i++) if (typeof v[i] !== 'number') throw new Error(`${name}[${i}] 不是数`);
  return v as ArrayLike<number>;
}

/** 标了 1 的地块 */
function marks(name: string, v: unknown, n: number): Uint8Array {
  const a = cellsOf(name, v, n);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] === 1 ? 1 : 0;
  return out;
}

/** 地块数那么长、每格是有限的数,复制成 32 位 */
function finite(name: string, v: unknown, n: number): Float32Array {
  const a = cellsOf(name, v, n);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = a[i];
    // 存成 32 位以后才看:1e100 这样的有限数也会变成无穷大
    if (!Number.isFinite(out[i])) throw new Error(`${name}[${i}] 不是有限的数`);
  }
  return out;
}

/** noise、ridged 的参数 */
function noiseArgs(name: string, o: unknown): Required<NoiseOptions> {
  if (typeof o !== 'object' || o === null) throw new Error(`d.${name} 要给一个对象,比如 { km: 800, octaves: 4 }`);
  const { km, octaves = 1, persistence = 0.5, salt = '' } = o as NoiseOptions;
  if (typeof km !== 'number' || !(km > 0 && km < Infinity)) throw new Error(`d.${name} 的 km 要是大于 0 的数`);
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > NOISE_OCTAVES_MAX) throw new Error(`d.${name} 的 octaves 要是 1 到 ${NOISE_OCTAVES_MAX} 的整数`);
  if (typeof persistence !== 'number' || !(persistence > 0 && persistence <= 1)) throw new Error(`d.${name} 的 persistence 要是大于 0、不超过 1 的数`);
  if (!((typeof salt === 'string' && salt.length <= SALT_MAX) || (typeof salt === 'number' && Number.isFinite(salt)))) {
    throw new Error(`d.${name} 的 salt 要是不超过 ${SALT_MAX} 个字的字,或者一个数`);
  }
  return { km, octaves, persistence, salt };
}

/** 灌满的洼地里每往里一块垫高这么多,水才有去向(和官方算河时一样) */
const ROUTE_EPS = 1e-3;
/** westEast 沿纬线找时粗网格一格多宽(世界单位;和官方算洋流的一样) */
const ZONAL_GRID = 4;

const isCell = (a: unknown, n: number): a is number => typeof a === 'number' && (a | 0) === a && a >= 0 && a < n;

/** 只在 mask 上平均:自己 + 标了 1 的邻居,按邻接表的先后加起来再除以个数 */
function blurMasked(mesh: Mesh, f: Float32Array, passes: number, mask: Uint8Array): Float32Array {
  const { n, adjStart, adj } = mesh;
  let a = f.slice();
  let b = f.slice();
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      let s = a[i];
      let c = 1;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        if (!mask[j]) continue;
        s += a[j];
        c++;
      }
      b[i] = s / c;
    }
    const t = a;
    a = b;
    b = t;
  }
  return a;
}

/** 一个插件的帮手:seed = 地图种子,id = 插件编号(噪声的种子按它分开) */
export function mapHelpers(mesh: Mesh, seed: number, id: string): MapHelpers {
  const { n, xyz } = mesh;
  const kmPerUnit = (mesh.width * KM_PER_UNIT) / (2 * Math.PI);
  return {
    noise(o) {
      const { km, octaves, persistence, salt } = noiseArgs('noise', o);
      const nz = geometryOf(mesh).fbm(subSeed(seed, `map:${id}:${salt}`), octaves, persistence);
      const scale = km / KM_PER_UNIT;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = nz.atScale(i, scale);
      return out;
    },
    blur(field, passes, mask) {
      const a = cellsOf('d.blur 的 field', field, n);
      if (!Number.isInteger(passes) || passes < 0 || passes > BLUR_PASSES_MAX) throw new Error(`d.blur 的遍数要是 0 到 ${BLUR_PASSES_MAX} 的整数`);
      const f = a instanceof Float32Array ? a : Float32Array.from(a);
      return mask === undefined ? blurField(mesh, f, passes) : blurMasked(mesh, f, passes, marks('d.blur 的 mask', mask, n));
    },
    steps(from, through) {
      const src = marks('d.steps 的 from', from, n);
      const pass = through === undefined ? null : marks('d.steps 的 through', through, n);
      const { adjStart, adj } = mesh;
      const out = new Int32Array(n).fill(-1);
      const q = new Int32Array(n);
      let head = 0;
      let tail = 0;
      for (let i = 0; i < n; i++) {
        if (!src[i]) continue;
        out[i] = 0;
        q[tail++] = i;
      }
      while (head < tail) {
        const c = q[head++];
        for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
          const j = adj[k];
          if (out[j] >= 0 || (pass && !pass[j])) continue;
          out[j] = out[c] + 1;
          q[tail++] = j;
        }
      }
      return out;
    },
    near(cell, km) {
      if (!isCell(cell, n)) throw new Error('d.near 的第一项要是地块编号(0 到 n − 1 的整数)');
      if (typeof km !== 'number' || !(km >= 0 && km < Infinity)) throw new Error('d.near 的 km 要是不小于 0 的数');
      return geometryOf(mesh).cellsNear(cell, km / KM_PER_UNIT);
    },
    km(a, b) {
      if (!isCell(a, n) || !isCell(b, n)) throw new TypeError('d.km(a, b) 的 a、b 要是地块编号(0 到 n − 1 的整数)');
      const dx = xyz[3 * a] - xyz[3 * b];
      const dy = xyz[3 * a + 1] - xyz[3 * b + 1];
      const dz = xyz[3 * a + 2] - xyz[3 * b + 2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz) * kmPerUnit;
    },
    ridged(o) {
      const { km, octaves, persistence, salt } = noiseArgs('ridged', o);
      const nz = geometryOf(mesh).ridged(subSeed(seed, `map-ridged:${id}:${salt}`), octaves, persistence);
      const scale = km / KM_PER_UNIT;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = nz.atScale(i, scale);
      return out;
    },
    flow(height, land, rain) {
      const h = finite('d.flow 的 height', height, n);
      const l = marks('d.flow 的 land', land, n);
      const w = rain === undefined ? Float32Array.from(l) : finite('d.flow 的 rain', rain, n);
      const fillLevel = drainage(mesh, l, h, 0).filled;
      const route = drainage(mesh, l, h, ROUTE_EPS);
      // 整片陆地挨不着海的,水没处去,也不积
      for (let i = 0; i < n; i++) if (l[i] && route.receiver[i] < 0) fillLevel[i] = h[i];
      return { downstream: route.receiver, fillLevel, flux: accumulate(route, l, w, new Float32Array(n)) };
    },
    distance(from, through) {
      const src = marks('d.distance 的 from', from, n);
      const pass = through === undefined ? undefined : marks('d.distance 的 through', through, n);
      const sources: number[] = [];
      for (let i = 0; i < n; i++) if (src[i]) sources.push(i);
      const f = distanceField(mesh, sources, () => 0, undefined, pass);
      const km = new Float32Array(n);
      for (let i = 0; i < n; i++) km[i] = f.dist[i] === Infinity ? -1 : f.dist[i] * KM_PER_UNIT;
      return { km, nearest: f.src };
    },
    components(mask) {
      const all = meshComponents(mesh, marks('d.components 的 mask', mask, n));
      const group = new Int32Array(n).fill(-1);
      const size = new Int32Array(all.length);
      all.forEach((cells, k) => {
        size[k] = cells.length;
        for (const c of cells) group[c] = k;
      });
      return { group, size };
    },
    slope(height) {
      const h = finite('d.slope 的 height', height, n);
      const { adjStart, adj } = mesh;
      const elen = geometryOf(mesh).edgeLengths();
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
          const g = Math.abs(h[i] - h[adj[k]]) / (elen[k] * KM_PER_UNIT);
          if (g > s) s = g;
        }
        out[i] = s;
      }
      return out;
    },
    cellAt(lat, lon) {
      if (typeof lat !== 'number' || !(lat >= -90 && lat <= 90)) throw new Error('d.cellAt 的 lat 要是 −90 到 90 的数');
      if (typeof lon !== 'number' || !Number.isFinite(lon)) throw new Error('d.cellAt 的 lon 要是数');
      const turn = (((lon + 180) % 360) + 360) % 360;
      return geometryOf(mesh).nearest((turn / 360) * mesh.width, ((90 - lat) / 180) * mesh.height, 0);
    },
    line(a, b) {
      if (!isCell(a, n) || !isCell(b, n)) throw new Error('d.line(a, b) 的 a、b 要是地块编号(0 到 n − 1 的整数)');
      const out = geometryOf(mesh).lineCells(a, b);
      if (!out) throw new Error('d.line 的两块正好在星球的两头,最短的路不止一条');
      return out;
    },
    westEast(mask) {
      const { west, east } = geometryOf(mesh).zonalLand(marks('d.westEast 的 mask', mask, n), ZONAL_GRID);
      const far = 2 * mesh.width;
      for (let i = 0; i < n; i++) {
        west[i] = west[i] > far ? -1 : west[i] * KM_PER_UNIT;
        east[i] = east[i] > far ? -1 : east[i] * KM_PER_UNIT;
      }
      return { west, east };
    },
    biomeOf(temperature, precipitation, water) {
      const t = cellsOf('d.biomeOf 的 temperature', temperature, n);
      const p = cellsOf('d.biomeOf 的 precipitation', precipitation, n);
      const wa = water === undefined ? null : cellsOf('d.biomeOf 的 water', water, n);
      const out = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const w = wa ? wa[i] : 0;
        if (w !== 0 && w !== 1 && w !== 2) throw new Error(`d.biomeOf 的 water[${i}] 要是 0、1 或 2`);
        out[i] = classifyBiome(t[i], p[i], w);
      }
      return out;
    },
  };
}

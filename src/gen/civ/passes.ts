/**
 * 关隘:两片地方的交界上隔着一道山脊,山脊上有一个又低又窄的口子 —— 别处都得翻高山,只有这里走得过去。
 * 推演里据险断后(wars.ts)按它挑地方,照故事找世界(gen/finder)按它量两国之间的隘口;以后关隘起名、地图上画关口、镜头定位到关隘也照它找。
 *
 * 找法(地块一级):交界上逐对相邻地块(一块在这边、一块在那边)取"翻过去要爬多高" = 两块里高的那块的海拔(海平面以下按 0);
 *   交界的山脊 = 这些高度的中位数,山脊至少 PASS_RIDGE 米;
 *   口子 = 最低的那一对,比山脊低 PASS_GAP 米以上、而且不高于山脊的 PASS_DEPTH 倍;
 *   口子窄:和口子差不多低(不比口子高出 (山脊 − 口子) × LOW_BAND)的地块对只有 NARROW 对以内;
 *   交界太短(不到 MIN_PAIRS 对地块)的看不出山脊,不算。
 * 州一级的"翻山"(AdjKind.Mountain:两州之间最低的垭口也比两边治所高出一截)说的是整条交界都难走,看不出口子在哪;
 * 有关隘的交界在州一级多半是平地或渡河(口子低),所以要到地块一级找。
 *
 * 纯计算,不碰 DOM;只看地形(海拔、地块邻接),同一个世界、同一套州算出来一样。
 */
import type { World } from '../world';
import type { Regions } from './types';

/** 交界的山脊(各对地块翻过去要爬的高度的中位数)至少这么高(米)才算隔着山 */
export const PASS_RIDGE = 900;
/** 口子比山脊低这么多(米)以上,而且不高于山脊的这么多倍 */
export const PASS_GAP = 500;
const PASS_DEPTH = 0.6;
/** 和口子差不多低:不比口子高出 (山脊 − 口子) × LOW_BAND;这样的地块对只有 PASS_NARROW 对以内才算窄口 */
const LOW_BAND = 0.25;
export const PASS_NARROW = 2;
/** 交界至少这么多对地块 */
const MIN_PAIRS = 4;

/** 一处关隘 */
export interface Pass {
  /** 口子:最低的那一对地块里低的那一块(地块编号;关隘"在哪州"按它所在的州算) */
  cell: number;
  /** 翻过口子要爬多高(米) */
  height: number;
  /** 交界的山脊(米,中位数) */
  ridge: number;
  /** 交界上一共几对地块 */
  pairs: number;
}

/** 交界上量出来的数(还没判算不算关隘;门槛见 isPass) */
export interface PassMeasure extends Pass {
  /** 和口子差不多低(不比口子高出 (山脊 − 口子) × LOW_BAND)的地块对有几对(含口子那一对) */
  narrow: number;
}

/** 一段交界上逐对相邻地块"翻过去要爬多高":hs = 各对的高度(不排序),low / cell = 最低的那一对的高度、里面低的那一块(没有 = Infinity / −1) */
export interface Crossings {
  hs: number[];
  low: number;
  cell: number;
}

const climb = (e: Float32Array, i: number, j: number) => Math.max(0, e[i], e[j]);

/** 一段交界上的各对地块:cellsA = 这一边的地块,inB(地块)= 那一块在不在那一边 */
export function crossings(world: World, cellsA: Iterable<number>, inB: (cell: number) => boolean): Crossings {
  const { adjStart, adj } = world.mesh;
  const e = world.elevation;
  const hs: number[] = [];
  let low = Infinity;
  let cell = -1;
  for (const i of cellsA) {
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      if (!inB(j)) continue;
      const h = climb(e, i, j);
      hs.push(h);
      // 一对里低的那一块(一样高取编号小的:从哪一边数起都是同一块)
      const c = e[i] < e[j] ? i : e[j] < e[i] ? j : Math.min(i, j);
      if (h < low || (h === low && c < cell)) {
        low = h;
        cell = c;
      }
    }
  }
  return { hs, low, cell };
}

/** 几段交界并成一段(例如两国之间的交界 = 两边各州之间的那几段):和一次量整段一样(口子取最低的,一样低取编号小的) */
export function mergeCrossings(parts: readonly Crossings[]): Crossings {
  const hs: number[] = [];
  let low = Infinity;
  let cell = -1;
  for (const p of parts) {
    for (const h of p.hs) hs.push(h);
    if (p.low < low || (p.low === low && p.cell < cell)) {
      low = p.low;
      cell = p.cell;
    }
  }
  return { hs, low, cell };
}

/** 量一段交界:山脊 = 各对高度的中位数;交界太短(不到 MIN_PAIRS 对地块)看不出山脊 = null */
export function measureCrossings(c: Crossings): PassMeasure | null {
  if (c.hs.length < MIN_PAIRS) return null;
  const hs = c.hs.slice().sort((a, b) => a - b);
  const low = c.low;
  const ridge = hs[hs.length >> 1];
  const band = low + (ridge - low) * LOW_BAND;
  let narrow = 0;
  while (narrow < hs.length && hs[narrow] <= band) narrow++;
  return { cell: c.cell, height: low, ridge, pairs: hs.length, narrow };
}

/**
 * 量出来的交界算不算关隘:山脊至少 PASS_RIDGE 米,口子比山脊低 gap 米以上、不高于山脊的 PASS_DEPTH 倍,
 * 和口子差不多低的地块对不超过 narrow 对。推演(findPass)用默认的门槛;照故事找世界时作者可以改 gap、narrow
 */
export function isPass(m: PassMeasure, gap = PASS_GAP, narrow = PASS_NARROW): boolean {
  return m.ridge >= PASS_RIDGE && m.ridge - m.height >= gap && m.height <= PASS_DEPTH * m.ridge && m.narrow <= narrow;
}

/**
 * 两片地方交界上的关隘:cellsA = 这一边的地块,inB(地块)= 那一块在不在那一边。没有关隘 = null。
 * 两国之间、两州之间都照它找(两国:cellsA 是一国的地块,inB 看那一块所在的州归不归另一国)
 */
export function findPass(world: World, cellsA: Iterable<number>, inB: (cell: number) => boolean): Pass | null {
  const m = measureCrossings(crossings(world, cellsA, inB));
  return m && isPass(m) ? { cell: m.cell, height: m.height, ridge: m.ridge, pairs: m.pairs } : null;
}

const cache = new WeakMap<Regions, WeakMap<World, Int32Array>>();

/**
 * 州与州之间的关隘(按州的邻接边,下标同 Regions.adj):有关隘 = 口子那一块地块,没有 = −1(海峡、航线一律 −1)。
 * 两个方向的边是同一处关隘。按 (州, 世界) 缓存
 */
export function regionPasses(world: World, regions: Regions): Int32Array {
  let byWorld = cache.get(regions);
  const hit = byWorld?.get(world);
  if (hit) return hit;
  const { adjStart, adj, cellStart, cells, of } = regions;
  const out = new Int32Array(adj.length).fill(-1);
  for (let a = 0; a < regions.count; a++) {
    const mine = cells.subarray(cellStart[a], cellStart[a + 1]);
    for (let k = adjStart[a]; k < adjStart[a + 1]; k++) {
      const b = adj[k];
      if (b < a) continue;
      const p = findPass(world, mine, (j) => of[j] === b);
      if (!p) continue;
      out[k] = p.cell;
      // 反方向的那条边
      for (let m = adjStart[b]; m < adjStart[b + 1]; m++) if (adj[m] === a) out[m] = p.cell;
    }
  }
  if (!byWorld) cache.set(regions, (byWorld = new WeakMap()));
  byWorld.set(world, out);
  return out;
}

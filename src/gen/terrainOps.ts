/**
 * 地形修改(TerrainOp)和地形大事(Upheaval)的取值范围、各种笔的预设,存档里读出来时的整理(clean…)、比较(same…)。
 * 格式见 edits.ts 文件头"地形修改";怎么套进生成流程在 terrainEdits.ts。和它分开放:读存档(首页上也要读)只用得到这里的,
 * 不用跟着下载生成地形用的几何、噪声。纯计算,不碰 DOM。
 */
import type { TerrainKind, TerrainOp, Upheaval } from './edits';
import { clamp } from './util';

/** 世界坐标的范围(= world.ts 的 MAP_W × MAP_H;这里不引 world.ts,免得循环引用,单测核对两边一致)。x 是经度,绕一圈 = TERRAIN_W */
export const TERRAIN_W = 2048;
export const TERRAIN_H = 1024;
/** 最多多少处地形修改 */
export const TERRAIN_MAX_OPS = 200;
/** 一条折线最多多少个点 */
export const TERRAIN_MAX_PTS = 256;
/** 大小(r)、强度(s)的范围 */
export const TERRAIN_R: readonly [number, number] = [3, 160];
export const TERRAIN_S: readonly [number, number] = [0.2, 2];
/** 删河湖:点下去的地方离河多远以内算指着这条河(世界坐标) */
export const DEL_WATER_R = 10;
/** 删掉的河的上游流域,流量压到成河门槛的这么多倍以下(比地图上画小溪的门槛 creeks.ts 的 CREEK_FRAC 还低,小溪也不画) */
export const DEL_WATER_FLUX = 0.1;
/** 气候四种的三档(r 是默认的画笔半径,s 是程度) */
const CLIMATE_PRESET: [r: number, s: number][] = [
  [40, 0.5],
  [40, 1],
  [40, 1.6],
];
/** 高度五种(编辑地形的高度页,大小、力度都是滑条;这里只给 AI 改写、类型齐全用) */
const HEIGHT_PRESET: [r: number, s: number][] = [
  [20, 0.4],
  [30, 0.4],
  [50, 0.4],
];
/** 高度五种的力度范围(定高不用力度,存 1) */
export const HEIGHT_S: readonly [number, number] = [0.05, 1];
/** 定高的海拔范围(米) */
export const HEIGHT_M: readonly [number, number] = [-6000, 9000];

/** 每种工具三档(小 / 中 / 大;山脉是低 / 中 / 高)的大小 r(世界坐标)和强度 s:改地形的工具条、AI 改写共用 */
export const TERRAIN_PRESETS: Record<TerrainKind, [r: number, s: number][]> = {
  volcano: [
    [18, 0.85],
    [28, 1.05],
    [40, 1.3],
  ],
  range: [
    [18, 0.55],
    [23, 1],
    [28, 1.45],
  ],
  lake: [
    [10, 0.7],
    [16, 1],
    [26, 1.2],
  ],
  raise: [
    [14, 1],
    [24, 1],
    [40, 1],
  ],
  sink: [
    [14, 1],
    [24, 1],
    [40, 1],
  ],
  river: [
    [6, 0.7],
    [9, 1],
    [14, 1.3],
  ],
  // 气候四种:三档是程度(一点 / 明显 / 很多),大小用画笔的滑条
  wet: CLIMATE_PRESET,
  dry: CLIMATE_PRESET,
  warm: CLIMATE_PRESET,
  cold: CLIMATE_PRESET,
  lift: HEIGHT_PRESET,
  lower: HEIGHT_PRESET,
  smooth: HEIGHT_PRESET,
  flatten: HEIGHT_PRESET,
  setHeight: HEIGHT_PRESET,
  // 删河湖:r 是找河的最远距离(三档一样,只给类型齐全用)
  delWater: [
    [DEL_WATER_R, 1],
    [DEL_WATER_R, 1],
    [DEL_WATER_R, 1],
  ],
};

/**
 * 放一处的大小改成滑条以后,强度跟着大小在三档之间连续取(小于小档 = 小档的强度,大于大档 = 大档的)。
 * 编辑地形面板放火山、湖、河时用
 */
export function presetStrength(kind: TerrainKind, r: number): number {
  const p = TERRAIN_PRESETS[kind];
  if (r <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (r <= p[i][0]) {
      const t = (r - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return Math.round((p[i - 1][1] + t * (p[i][1] - p[i - 1][1])) * 100) / 100;
    }
  }
  return p[p.length - 1][1];
}

const KINDS: readonly TerrainKind[] = ['volcano', 'range', 'lake', 'raise', 'sink', 'river', 'wet', 'dry', 'warm', 'cold', 'lift', 'lower', 'smooth', 'flatten', 'setHeight', 'delWater'];
/** 放一处的点(火山、湖):画成一个圈 */
export const isPointKind = (k: TerrainKind) => k === 'volcano' || k === 'lake';
/** 改气候的四种(不动地形,算完气候后改降水 / 气温) */
export const isClimateKind = (k: TerrainKind) => k === 'wet' || k === 'dry' || k === 'warm' || k === 'cold';
/** 高度五种(改最后的海拔) */
export const isHeightKind = (k: TerrainKind) => k === 'lift' || k === 'lower' || k === 'smooth' || k === 'flatten' || k === 'setHeight';

// ---------------------------------------------------------------------------
// 清理(读档、加一处修改时用)

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
/** 经度(世界 x)取整、取模到 [0, TERRAIN_W) */
export const wrapLon = (x: number) => {
  const v = Math.round(x - TERRAIN_W * Math.floor(x / TERRAIN_W));
  return v >= TERRAIN_W ? v - TERRAIN_W : v;
};
/** 经度(世界 x)取整,挪到离 ref 最近的那一圈(差不超过半圈) */
export const nearLon = (x: number, ref: number) => Math.round(x - TERRAIN_W * Math.round((x - ref) / TERRAIN_W));

/**
 * 清理一处地形修改:种类不认识、坐标 / 大小 / 强度不是有限数、点不够的 = null;
 * 坐标取整:y 夹在两极之间 [0, TERRAIN_H];x 是经度,不夹 —— 第一个点取模到 [0, TERRAIN_W),之后每个点挪到离上一个点
 * 最近的那一圈(跨 180° 经线的一笔是连着的,x 可以超出 [0, TERRAIN_W));
 * 大小、强度夹到范围内(大小保留一位小数,强度两位;高度五种的力度夹到 HEIGHT_S,定高的力度一律 1);火山、湖只留第一个点,折线最多 TERRAIN_MAX_PTS 个点。
 * 定高要有海拔 h(取整、夹到 HEIGHT_M;没有 = null),边缘 edge 只认 0 / 1 / 2(别的当没有 = 适中)。
 * 本来就合格的原样返回(同一个对象)
 */
export function cleanTerrainOp(x: unknown): TerrainOp | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const kind = o.kind as TerrainKind;
  if (!KINDS.includes(kind) || !Array.isArray(o.pts) || o.pts.length < 2) return null;
  const raw = o.pts as unknown[];
  const take = isPointKind(kind) || kind === 'delWater' ? 2 : Math.min(raw.length, TERRAIN_MAX_PTS * 2) & ~1;
  const pts: number[] = [];
  for (let i = 0; i < take; i += 2) {
    const px = num(raw[i]);
    const py = num(raw[i + 1]);
    if (px === null || py === null) return null;
    pts.push(i ? nearLon(px, pts[i - 2]) : wrapLon(px), Math.round(clamp(py, 0, TERRAIN_H)));
  }
  const r0 = num(o.r);
  const s0 = num(o.s);
  if (r0 === null || s0 === null) return null;
  const r = Math.round(clamp(r0, TERRAIN_R[0], TERRAIN_R[1]) * 10) / 10;
  const height = isHeightKind(kind);
  const s = kind === 'setHeight' || kind === 'delWater' ? 1 : Math.round(clamp(s0, ...(height ? HEIGHT_S : TERRAIN_S)) * 100) / 100;
  // 定高的海拔、边缘
  const h0 = kind === 'setHeight' ? num(o.h) : null;
  if (kind === 'setHeight' && h0 === null) return null;
  const h = h0 === null ? undefined : Math.round(clamp(h0, HEIGHT_M[0], HEIGHT_M[1]));
  const edge = kind === 'setHeight' && (o.edge === 0 || o.edge === 1 || o.edge === 2) ? o.edge : undefined;
  // 湖岸曲折程度:只有湖带,夹到 0–1、保留两位小数;不是有限数的当没有
  const e0 = kind === 'lake' ? num(o.e) : null;
  const e = e0 === null ? undefined : Math.round(clamp(e0, 0, 1) * 100) / 100;
  // 圈起来填满:只有气候四种带,至少三个点才圈得成
  const f = isClimateKind(kind) && o.f === 1 && pts.length >= 6 ? 1 : undefined;
  const same =
    Object.keys(o).length === 4 + (o.e === undefined ? 0 : 1) + (o.f === undefined ? 0 : 1) + (o.h === undefined ? 0 : 1) + (o.edge === undefined ? 0 : 1) &&
    e === o.e &&
    f === o.f &&
    h === o.h &&
    edge === o.edge &&
    r === o.r &&
    s === o.s &&
    raw.length === pts.length &&
    pts.every((v, i) => v === raw[i]);
  if (same) return x as TerrainOp;
  const out: TerrainOp = { kind, pts, r, s };
  if (e !== undefined) out.e = e;
  if (f !== undefined) out.f = f;
  if (h !== undefined) out.h = h;
  if (edge !== undefined) out.edge = edge;
  return out;
}

/** 清理一份地形修改列表(规则同 cleanTerrainOp;不合格的丢掉,最多 max 处,默认 TERRAIN_MAX_OPS)。全都合格时返回原数组 */
export function cleanTerrainOps(list: unknown, max = TERRAIN_MAX_OPS): TerrainOp[] {
  if (!Array.isArray(list)) return [];
  const out: TerrainOp[] = [];
  let same = list.length <= max;
  for (const x of list as unknown[]) {
    if (out.length >= max) break;
    const v = cleanTerrainOp(x);
    if (v) out.push(v);
    if (v !== x) same = false;
  }
  return same ? (list as TerrainOp[]) : out;
}

// ---------------------------------------------------------------------------
// 地形大事(格式见 edits.ts 文件头"地形大事")

/** 地形大事用的三种修改:火山喷发、地震抬升、海水漫进来 */
export const UPHEAVAL_KINDS: readonly TerrainKind[] = ['volcano', 'raise', 'sink'];
/** 一个世界最多几件地形大事(每件要多生成一遍地形) */
export const UPHEAVALS_MAX = 5;
/** 一件地形大事最多几笔 */
export const UPHEAVAL_OPS_MAX = 20;
/** 地形大事的年份范围(推演到第 3000 年;第 0 年就有的,用改地形) */
export const UPHEAVAL_YEARS: readonly [number, number] = [1, 2999];

/** 清理一件地形大事:不是对象、年份不是有限数 = null;年份取整夹回 UPHEAVAL_YEARS;修改逐笔过 cleanTerrainOp,种类不在 UPHEAVAL_KINDS 里的丢掉;一笔不剩 = null。本来就合格的原样返回 */
export function cleanUpheaval(x: unknown): Upheaval | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const y0 = num(o.year);
  if (y0 === null || !Array.isArray(o.ops)) return null;
  const year = clamp(Math.floor(y0), UPHEAVAL_YEARS[0], UPHEAVAL_YEARS[1]);
  const raw = o.ops as unknown[];
  const ops: TerrainOp[] = [];
  let same = year === o.year && Object.keys(o).length === 2 && raw.length <= UPHEAVAL_OPS_MAX;
  for (const v of raw) {
    if (ops.length >= UPHEAVAL_OPS_MAX) break;
    const c = cleanTerrainOp(v);
    if (c && UPHEAVAL_KINDS.includes(c.kind)) ops.push(c);
    if (c !== v || (c && !UPHEAVAL_KINDS.includes(c.kind))) same = false;
  }
  if (!ops.length) return null;
  return same ? (x as Upheaval) : { year, ops };
}

/** 清理一份地形大事列表(规则同 cleanUpheaval;不合格的丢掉,最多 UPHEAVALS_MAX 件)。全都合格时返回原数组 */
export function cleanUpheavals(list: unknown): Upheaval[] {
  if (!Array.isArray(list)) return [];
  const out: Upheaval[] = [];
  let same = list.length <= UPHEAVALS_MAX;
  for (const x of list as unknown[]) {
    if (out.length >= UPHEAVALS_MAX) break;
    const v = cleanUpheaval(x);
    if (v) out.push(v);
    if (v !== x) same = false;
  }
  return same ? (list as Upheaval[]) : out;
}

/** 两份地形大事是不是一样(逐件比年份和修改) */
export function sameUpheavals(a: readonly Upheaval[] | undefined, b: readonly Upheaval[] | undefined): boolean {
  if (a === b) return true;
  const x = a ?? [];
  const y = b ?? [];
  return x.length === y.length && x.every((u, i) => u.year === y[i].year && sameTerrain(u.ops, y[i].ops));
}

/** 两份地形修改是不是一样(逐处逐字段比) */
export function sameTerrain(a: readonly TerrainOp[], b: readonly TerrainOp[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return (
      x.kind === y.kind &&
      x.r === y.r &&
      x.s === y.s &&
      x.e === y.e &&
      x.f === y.f &&
      x.h === y.h &&
      x.edge === y.edge &&
      x.pts.length === y.pts.length &&
      x.pts.every((v, j) => v === y.pts[j])
    );
  });
}

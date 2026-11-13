/**
 * 工具插件替用的人翻年份、移地图、圈出国家和州(view.control@1):查参数、算飞到哪、限次。纯计算,不碰 DOM。
 */
import type { Civ } from '../gen/civ/types';
import { resolveKey } from '../gen/edits';
import { ownersAt } from '../gen/readers/openQuery';
import type { World } from '../gen/world';
import { argsOf, bad, cellList, int, isRec, num, over } from './check';
import { eraCiv } from './read';

/** 每种一秒最多照办几次 */
export const STEER_PER_SECOND = { 'view.seek': 4, 'view.fly': 2, 'view.highlight': 10 } as const;
export type SteerCall = keyof typeof STEER_PER_SECOND;

/** 地图飞过去看全 box(世界坐标,x 可以超出 [0, W),跨东西接缝的照样连着);x、y 是中心,x 在 [0, W) */
export interface ViewFocus {
  box: [number, number, number, number];
  x: number;
  y: number;
  lon: number;
  lat: number;
}

/** 一直圈着:州圈得浓,国家按 year 那一年的国土圈得淡 */
export interface ViewHighlight {
  polities: number[];
  regions: number[];
  year: number;
}

/** 最近一秒照办了几次 */
export class Rate {
  private readonly at: Float64Array;
  private n = 0;
  constructor(readonly max: number) {
    this.at = new Float64Array(max).fill(-Infinity);
  }
  full(now: number): boolean {
    return now - this.at[this.n % this.max] < 1000;
  }
  hit(now: number): void {
    this.at[this.n++ % this.max] = now;
  }
}

const yearIn = (civ: Civ, v: unknown, at = 'year') => int(v, at, 0, civ.endYear);

export function seekYear(civ: Civ, raw: unknown): number {
  return yearIn(civ, argsOf(raw).year);
}

/** 国、州、城:编号或稳定键都行;重复的只留一个 */
function refs(v: unknown, at: string, kind: 'polity' | 'region' | 'settlement', civ: Civ, count: number): number[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) && !(ArrayBuffer.isView(v) && !(v instanceof DataView))) return bad(`${at} 要是数组`);
  const a = v as ArrayLike<unknown>;
  if (a.length > count) over(`${at} 最多 ${count} 项`);
  const out = new Set<number>();
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (typeof x === 'string') {
      const r = resolveKey(civ, x);
      if (r?.kind !== kind) bad(`${at}[${i}] 的键 ${x.slice(0, 40)} 在这段历史里找不到`);
      out.add(r!.id);
    } else out.add(int(x, `${at}[${i}]`, 0, count - 1));
  }
  return [...out];
}

/** 国家在 year 年的国土按哪一年看:没立国看立国那年,亡了看亡国前 */
function shownYear(p: { founded: number; ended?: number }, year: number): number {
  if (year < p.founded) return p.founded;
  if (p.ended !== undefined && year >= p.ended) return Math.max(p.founded, p.ended - 1 / 256);
  return year;
}

/**
 * 飞到哪:cells、box、polities、regions、settlements 给几样都行,看全它们。
 * 国家按 year 那一年的国土,州按那一年那段地形划的;civ() 只在给了国、州、城时才要
 */
export function flyFocus(world: World, civ: () => Civ, raw: unknown, year: () => number): ViewFocus {
  const a = argsOf(raw);
  const { x, y } = world.mesh;
  const W = world.width;
  const H = world.height;
  let ref = NaN;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  // 一段东西方向的范围整段挪到离 ref 最近的那一圈(框比半圈宽也不会被折成另一边)
  const span = (ax: number, bx: number, ay: number, by: number) => {
    const mid = (ax + bx) / 2;
    if (Number.isNaN(ref)) ref = mid;
    const s = -W * Math.round((mid - ref) / W);
    x0 = Math.min(x0, ax + s);
    x1 = Math.max(x1, bx + s);
    y0 = Math.min(y0, ay);
    y1 = Math.max(y1, by);
  };
  const add = (px: number, py: number) => span(px, px, py, py);
  const addRegion = (R: Civ['regions'], r: number) => {
    for (let k = R.cellStart[r]; k < R.cellStart[r + 1]; k++) add(x[R.cells[k]], y[R.cells[k]]);
  };
  if (a.cells !== undefined) for (const c of cellList(a.cells, 'cells', world.mesh.n, world.mesh.n)) add(x[c], y[c]);
  if (a.box !== undefined) {
    if (!isRec(a.box)) bad('box 要是 { x0, y0, x1, y1 }');
    const b = a.box as Record<string, unknown>;
    const bx0 = num(b.x0, 'box.x0');
    const bx1 = num(b.x1, 'box.x1', bx0, bx0 + W);
    const by0 = num(b.y0, 'box.y0', 0, H);
    const by1 = num(b.y1, 'box.y1', by0, H);
    span(bx0, bx1, by0, by1);
  }
  if (a.polities !== undefined || a.regions !== undefined || a.settlements !== undefined) {
    const h = civ();
    const at = a.year === undefined ? Math.min(h.endYear, Math.max(0, year())) : yearIn(h, a.year);
    const polities = refs(a.polities, 'polities', 'polity', h, h.polities.length);
    const regions = refs(a.regions, 'regions', 'region', h, h.regions.count);
    const settlements = refs(a.settlements, 'settlements', 'settlement', h, h.settlements.length);
    const byYear = new Map<number, number[]>();
    for (const id of polities) {
      const p = h.polities[id];
      if (!p) continue;
      const sy = shownYear(p, at);
      byYear.set(sy, [...(byYear.get(sy) ?? []), id]);
    }
    for (const [sy, ids] of byYear) {
      const own = ownersAt(h, sy).polity;
      const R = eraCiv(h, sy).regions;
      const want = new Set(ids);
      for (let r = 0; r < Math.min(R.count, own.length); r++) if (want.has(own[r])) addRegion(R, r);
    }
    const era = eraCiv(h, at).regions;
    for (const r of regions) addRegion(r < era.count && era.cellStart[r + 1] > era.cellStart[r] ? era : h.regions, r);
    for (const id of settlements) {
      const s = h.settlements[id];
      if (s) add(x[s.cell], y[s.cell]);
    }
  }
  if (Number.isNaN(ref)) bad(['cells', 'box', 'polities', 'regions', 'settlements'].some((k) => a[k] !== undefined) ? '给的这些在那一年的地图上都没有地方' : 'cells、box、polities、regions、settlements 至少给一样');
  // 只有一个点时框开一点:不然看不出该放多大
  if (x1 - x0 < 2) (x0 -= 1), (x1 += 1);
  if (y1 - y0 < 2) (y0 = Math.max(0, y0 - 1)), (y1 = Math.min(H, y1 + 1));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const wx = cx - W * Math.floor(cx / W);
  return { box: [x0, y0, x1, y1], x: wx, y: cy, lon: (wx / W) * 360 - 180, lat: 90 - (cy / H) * 180 };
}

export function highlightOf(civ: Civ, raw: unknown, year: () => number): ViewHighlight {
  const a = argsOf(raw);
  const polities = refs(a.polities, 'polities', 'polity', civ, civ.polities.length);
  const regions = refs(a.regions, 'regions', 'region', civ, civ.regions.count);
  if (!polities.length && !regions.length) bad('polities、regions 至少给一个;要拿掉用 view.unhighlight()');
  return { polities, regions, year: a.year === undefined ? Math.min(civ.endYear, Math.max(0, year())) : yearIn(civ, a.year) };
}

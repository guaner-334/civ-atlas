/**
 * 一片形状(作者标记圈的几个州、地图上的一个州)的名字顺着形状排:把形状的多边形铺到一张小栅格上,
 * 用国名同一套"最难到达点 + 放射线"拟合出一条路径(labels/polity.ts 的 fitShape)—— 狭长的地方顺着长的方向、略带弧度,
 * 很窄很高的地方竖排。纯计算,世界坐标(多边形给的是什么坐标,路径就是什么坐标)。
 */
import { fitShape, territoryField, type ShapeFit, type TerritoryGrid } from './polity';

/** 一张栅格最多约这么多格(形状越大格子越粗) */
const MAX_CELLS = 20000;
/** 格子边长的上下限(世界单位) */
const G_MIN = 1;
const G_MAX = 6;
/** 字号阶梯:最小试到多大(世界单位),每次缩多少 */
const MIN_SIZE = 0.8;
const LADDER = 0.92;
/** 和 polity.ts 一样:路径离界至少 = 字号 × HALF + MARGIN */
const HALF = 0.55;
const MARGIN = 2;

/** 点在不在多边形里(x,y,x,y… 一圈) */
function inside(p: ArrayLike<number>, x: number, y: number): boolean {
  let c = false;
  const n = p.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const yi = p[i + 1];
    const yj = p[j + 1];
    if (yi > y !== yj > y && x < ((p[j] - p[i]) * (y - yi)) / (yj - yi) + p[i]) c = !c;
  }
  return c;
}

/**
 * 一片形状里放 n 个字的路径。polys = 拼成这片形状的多边形(每块一圈,拼在一起不留缝);box = 外接框 [x0, y0, x1, y1]。
 * 形状是空的 = null
 */
export function shapeLabelFit(polys: readonly ArrayLike<number>[], box: readonly number[], n: number): ShapeFit | null {
  const [x0, y0, x1, y1] = box;
  const w = x1 - x0;
  const h = y1 - y0;
  if (!polys.length || !(w >= 0 && h >= 0)) return null;
  const G = Math.min(G_MAX, Math.max(G_MIN, Math.sqrt(((w + 10) * (h + 10)) / MAX_CELLS)));
  // 四周各留两格(栅格边上算"界外")
  const ox = x0 - 2 * G;
  const oy = y0 - 2 * G;
  const gw = Math.ceil(w / G) + 5;
  const gh = Math.ceil(h / G) + 5;
  const region = new Int16Array(gw * gh).fill(-1);
  for (const p of polys) {
    let a = Infinity;
    let b = Infinity;
    let c = -Infinity;
    let d = -Infinity;
    for (let i = 0; i + 1 < p.length; i += 2) {
      if (p[i] < a) a = p[i];
      if (p[i] > c) c = p[i];
      if (p[i + 1] < b) b = p[i + 1];
      if (p[i + 1] > d) d = p[i + 1];
    }
    const gx0 = Math.max(0, Math.floor((a - ox) / G));
    const gx1 = Math.min(gw - 1, Math.floor((c - ox) / G));
    const gy0 = Math.max(0, Math.floor((b - oy) / G));
    const gy1 = Math.min(gh - 1, Math.floor((d - oy) / G));
    for (let gy = gy0; gy <= gy1; gy++) {
      const cy = oy + (gy + 0.5) * G;
      for (let gx = gx0; gx <= gx1; gx++) {
        const i = gy * gw + gx;
        if (region[i] === 0) continue;
        if (inside(p, ox + (gx + 0.5) * G, cy)) region[i] = 0;
      }
    }
  }
  const grid: TerritoryGrid = { G, gw, gh, region };
  const field = territoryField(grid, Int16Array.of(0));
  let best = -1;
  let bd = 0;
  for (let i = 0; i < field.dist.length; i++) {
    if (field.owner[i] === 0 && field.dist[i] > bd) {
      bd = field.dist[i];
      best = i;
    }
  }
  if (best < 0) {
    // 形状比一格还细:取第一个在里面的格子
    best = field.owner.indexOf(0);
    if (best < 0) return null;
  }
  const sizes: number[] = [];
  for (let s = Math.max(MIN_SIZE, (bd - MARGIN) / HALF); s >= MIN_SIZE; s *= LADDER) sizes.push(s);
  if (!sizes.length) sizes.push(MIN_SIZE);
  const f = fitShape(field, 0, best, n, sizes, Math.hypot(w, h) + 4 * G);
  if (!f) return null;
  for (let i = 0; i < f.path.length; i += 2) {
    f.path[i] += ox;
    f.path[i + 1] += oy;
  }
  f.anchor = [f.anchor[0] + ox, f.anchor[1] + oy];
  return f;
}

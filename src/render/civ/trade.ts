/**
 * 文明叠加层 · 商道(数据见 gen/civ/trade.ts)。开着「道路」时画。
 *
 * 画在文字层上(和战线一样按画布像素画成矢量,放大后依然清晰):线压在国界、填色、道路上面,城镇符号和地名下面;
 * 名字顺着线写(从左往右念),最后写,在地名上面,尽量不压地名和城镇符号。
 *
 *   - 路线沿推演算出的州走,画的时候对到路网上(大路、小路、航线;那一版路线开始时已经修好的优先;只走那几州里的路,
 *     推演里没过海的不走航线),那几州里的路走不通的就把各州治所平滑地连起来。几条商道走同一段路时线叠在一起,就是一条。
 *   - 样子:比大路粗一档的紫线,外面一圈浅边(手绘纸色、写实白色);卫星图上用亮一点的紫。
 *     产地一个小空心圆,终点(买方国都)一个实心点。断着的整条画虚线,颜色不变;废了就不画。
 *   - 线宽、字号随放大长得比地图慢:线宽 2 倍以内和战线同一把尺(× k^LINE_GROW),再往上更慢;字号 × k^NAME_GROW。
 *   - 名字:缩放 1 倍时写得下的才写,2 倍起每条都写(挤不开时照写在正中)。
 *   - 选中的一条(商道卡片开着)亮一圈、别的变淡;鼠标停着的一条亮一圈。
 */
import type { Civ, Route, Year } from '../../gen/civ/types';
import { AdjKind } from '../../gen/civ/types';
import type { TradeRoute } from '../../gen/civ/trade';
import type { Mesh } from '../../gen/mesh';
import { capitalAt } from '../../gen/civ/growth';
import { ownersAt } from '../../gen/civ/timeline';
import { MinHeap } from '../../gen/util';
import { chaikin, unwrapLine } from './lines';
import type { CivDrawParams } from './overlay';
import { placedMarkBox, type LabelView, type Placement } from '../labels/draw';
import { glyphBox, type Glyph } from '../labels/layout';
import { familyFor, fontCss } from '../labels/fonts';
import { clipOutline, projectLinePts, type Projector } from '../projection';

/** 颜色:手绘、地理图上的深紫;卫星图上亮一点的紫 */
export const TRADE_INK = '#73379a';
export const TRADE_BRIGHT = '#b07ce8';
/** 尺寸(CSS 像素,缩放 1 倍时):线宽、浅边(每侧)、虚线、两头的圆点、名字的字号和字距(字号的倍数)、光晕 */
const SIZE = { line: 2.2, casing: 1.1, dashOn: 6, dashOff: 5, end: 2.8, cap: 3.4, endStroke: 1.6, name: 12, track: 0.18, halo: 3.4, glow: 6 };
/** 放大 k 倍时线宽:2 倍以内 × k^LINE_GROW(和战线同一把尺,2 倍时约 1.55 倍),再往上 × (k/2)^LINE_GROW_HI 长得更慢(4 倍时 2 倍) */
const LINE_GROW = Math.log(2) / Math.log(3);
const LINE_GROW_HI = Math.log2(4.4 / 3.4);
/** 放大 k 倍时字号 × k^NAME_GROW(2 倍时约 14、4 倍时约 16) */
const NAME_GROW = 0.22;
/** 选中时别的商道淡到几成 */
const DIM = 0.32;
/** 路网上寻路:各类路每单位路程的代价;那一版路线开始时还没修 / 已经停用的路加价 */
const KIND_COST: Record<Route['kind'], number> = { road: 1, trail: 1.25, sea: 1.6 };
const UNBUILT = 4;
const ABANDONED = 2;
/** 路接不上时直接连(治所 ↔ 路网、相邻两州的治所之间):每单位路程的代价 */
const LINK = 3;
/** 绕进挨着的州(归同一批国家的)的路:代价 × RING */
const RING = 1.5;

/** 这一年这条商道:通 / 断;还没通、已经废了 = null */
export function tradeStatus(r: TradeRoute, year: Year): 'open' | 'broken' | null {
  let st: 'open' | 'broken' | null = null;
  for (const e of r.events) {
    if (e.year > year) break;
    st = e.kind === 'break' ? 'broken' : e.kind === 'end' ? null : 'open';
  }
  return st;
}

/** 这一年用的是第几版路线 */
export function tradePathIndex(r: TradeRoute, year: Year): number {
  let k = 0;
  for (let i = 1; i < r.paths.length; i++) if (r.paths[i].year <= year) k = i;
  return k;
}

/** 开着「道路」、有商道时画 */
export function tradeShown(p: Pick<CivDrawParams, 'show' | 'civ'>): boolean {
  return !!p.show.routes && !!p.civ.trade?.routes.length;
}

// ---------------------------------------------------------------------------
// 路线 → 地图上的折线

interface RoadGraph {
  /** 地块 → 边(CSR):到哪块、路的种类、修建 / 停用年份 */
  start: Map<number, number[]>;
  stops: Set<number>;
}
interface Cache {
  graph: RoadGraph | null;
  lines: Map<string, Float32Array>;
  scene: { key: string; lines: TradeLine[] } | null;
}
const caches = new WeakMap<Civ, Cache>();

function cacheOf(civ: Civ): Cache {
  let c = caches.get(civ);
  if (!c) caches.set(civ, (c = { graph: null, lines: new Map(), scene: null }));
  return c;
}

/** 路网:地块是点,各条路的每一步是边(一条边记:到哪块、哪条路) */
function roadGraph(civ: Civ): RoadGraph {
  const c = cacheOf(civ);
  if (c.graph) return c.graph;
  const start = new Map<number, number[]>();
  const add = (a: number, b: number, ri: number) => {
    let l = start.get(a);
    if (!l) start.set(a, (l = []));
    l.push(b, ri);
  };
  civ.routes.forEach((r, ri) => {
    for (let t = 1; t < r.cells.length; t++) {
      add(r.cells[t - 1], r.cells[t], ri);
      add(r.cells[t], r.cells[t - 1], ri);
    }
  });
  const stops = new Set<number>();
  if (civ.settlements.length) for (const s of civ.settlements) stops.add(s.cell);
  else for (let r = 0; r < civ.regions.count; r++) stops.add(civ.regions.seat[r]);
  return (c.graph = { start, stops });
}

function cellDist(mesh: Mesh, a: number, b: number): number {
  let dx = mesh.x[b] - mesh.x[a];
  const W = mesh.width;
  if (W) dx -= W * Math.round(dx / W);
  return Math.hypot(dx, mesh.y[b] - mesh.y[a]);
}

/**
 * 这一版路线沿路网走的地块(产地治所 → 买方国都)。只在推演算出的那几州里走,至多绕进挨着它们、又归同一批国家(或买方、或没有国家)的州
 * (不绕进别的国家:那可能正是推演绕开的交兵的国家);推演里没过海的不走航线;
 * 路接不上的地方,相邻两州的治所之间直接连(代价是走路的 LINK 倍,能走路就走路)
 */
function routeCells(civ: Civ, mesh: Mesh, r: TradeRoute, k: number): number[] {
  const v = r.paths[k];
  const reg = civ.regions;
  const regs = v.regions.filter((x) => x >= 0 && x < reg.count);
  if (!regs.length) return [reg.seat[r.from]];
  const pol = civ.polities[r.buyer];
  const capS = pol ? civ.settlements[capitalAt(pol, v.year)] : undefined;
  const last = regs[regs.length - 1];
  const seatOf = (x: number) => reg.seat[x];
  const from = seatOf(regs[0]);
  const to = capS && reg.of[capS.cell] === last ? capS.cell : seatOf(last);
  const g = roadGraph(civ);
  const on = new Set(regs);
  // 挨着这几州、又归这几州的国家(或买方、或没有国家)的州:路稍微绕进去也行(和走那几州差不多,不会绕进交兵的国家)
  const own = ownersAt(civ, v.year).polity;
  const okOwner = new Set<number>([r.buyer, -1]);
  for (const x of regs) okOwner.add(own[x] ?? -1);
  const ring = new Set<number>();
  for (const a of regs)
    for (let e = reg.adjStart[a]; e < reg.adjStart[a + 1]; e++) {
      const n = reg.adj[e];
      if (reg.adjKind[e] < AdjKind.Strait && !on.has(n) && okOwner.has(own[n] ?? -1)) ring.add(n);
    }
  let sea = false;
  for (let i = 1; i < regs.length && !sea; i++) {
    const a = regs[i - 1];
    for (let e = reg.adjStart[a]; e < reg.adjStart[a + 1]; e++) {
      if (reg.adj[e] !== regs[i]) continue;
      if (reg.adjKind[e] === AdjKind.Strait || reg.adjKind[e] === AdjKind.SeaRoute) sea = true;
      break;
    }
  }
  // 治所(不一定在路网上)→ 这一州里路网上的地块;相邻两州的治所之间
  const roadIn = new Map<number, number[]>();
  for (const c of g.start.keys()) {
    const x = reg.of[c];
    if (x >= 0 && on.has(x)) (roadIn.get(x) ?? roadIn.set(x, []).get(x)!).push(c);
  }
  const seatIdx = new Map<number, number>();
  regs.forEach((x, i) => {
    if (!seatIdx.has(seatOf(x))) seatIdx.set(seatOf(x), i);
  });
  const heap = new MinHeap(256);
  const dist = new Map<number, number>([[from, 0]]);
  const prev = new Map<number, number>([[from, -1]]);
  heap.push(from, 0);
  const relax = (u: number, w: number, d: number) => {
    if (d < (dist.get(w) ?? Infinity)) {
      dist.set(w, d);
      prev.set(w, u);
      heap.push(w, d);
    }
  };
  let pops = 0;
  while (heap.size && pops++ < 40000) {
    const u = heap.pop();
    const du = heap.lastPri;
    if (du > (dist.get(u) ?? Infinity)) continue;
    if (u === to) break;
    // 路
    const es = g.start.get(u);
    if (es)
      for (let i = 0; i < es.length; i += 2) {
        const w = es[i];
        const rt = civ.routes[es[i + 1]];
        const ru = reg.of[w];
        if (ru >= 0 && !on.has(ru) && !ring.has(ru)) continue;
        if (rt.kind === 'sea' && !sea) continue;
        let f = KIND_COST[rt.kind] * (ru >= 0 && !on.has(ru) ? RING : 1);
        if (rt.built > v.year) f *= UNBUILT;
        if ((rt.abandoned ?? Infinity) <= v.year) f *= ABANDONED;
        relax(u, w, du + cellDist(mesh, u, w) * f);
      }
    // 治所:进出这一州的路网、连到下一州的治所
    const si = seatIdx.get(u);
    if (si !== undefined) {
      for (const c of roadIn.get(regs[si]) ?? []) relax(u, c, du + cellDist(mesh, u, c) * LINK);
      if (si + 1 < regs.length) relax(u, seatOf(regs[si + 1]), du + cellDist(mesh, u, seatOf(regs[si + 1])) * LINK);
    } else {
      // 路网上的地块回到这一州的治所(下一段路接不上时从治所接着走)
      const x = reg.of[u];
      if (x >= 0 && on.has(x) && seatOf(x) !== u) relax(u, seatOf(x), du + cellDist(mesh, u, seatOf(x)) * LINK);
    }
  }
  if (!prev.has(to)) return regs.map(seatOf).filter((c, i, a) => i === 0 || c !== a[i - 1]);
  const cells: number[] = [];
  for (let c = to; c >= 0; c = prev.get(c)!) cells.push(c);
  return cells.reverse();
}

/** 这一版路线的折线(世界坐标,x 展开成连续的;在城、岔口处分段抹平,和道路画的线重合) */
export function tradeLinePts(civ: Civ, mesh: Mesh, r: TradeRoute, k: number): Float32Array {
  const c = cacheOf(civ);
  const key = `${r.id}:${k}`;
  const hit = c.lines.get(key);
  if (hit) return hit;
  const cells = routeCells(civ, mesh, r, k);
  const stops = roadGraph(civ).stops;
  const raw = new Float32Array(cells.length * 2);
  cells.forEach((cell, i) => {
    raw[i * 2] = mesh.x[cell];
    raw[i * 2 + 1] = mesh.y[cell];
  });
  unwrapLine(raw, mesh.width);
  // 在城处分段(段的两头不动),各段 Chaikin 抹平
  const out: number[] = [];
  let a = 0;
  for (let i = 1; i < cells.length; i++) {
    if (i < cells.length - 1 && !stops.has(cells[i])) continue;
    const seg = chaikin({ pts: raw.slice(a * 2, i * 2 + 2), closed: false }, 3).pts;
    for (let j = out.length ? 2 : 0; j < seg.length; j++) out.push(seg[j]);
    a = i;
  }
  if (!out.length) out.push(raw[0], raw[1]);
  const pts = Float32Array.from(out);
  c.lines.set(key, pts);
  return pts;
}

export interface TradeLine {
  route: TradeRoute;
  broken: boolean;
  /** 世界坐标折线(x 展开成连续的) */
  pts: Float32Array;
}

/** 这一年看得见的商道(按编号;同一年、同一组通断只算一次) */
export function tradeScene(civ: Civ, mesh: Mesh, year: Year): TradeLine[] {
  const T = civ.trade;
  if (!T) return [];
  const c = cacheOf(civ);
  const st = T.routes.map((r) => {
    const s = tradeStatus(r, year);
    return s ? `${s === 'broken' ? 'b' : 'o'}${tradePathIndex(r, year)}` : '';
  });
  const key = st.join(',');
  if (c.scene && c.scene.key === key) return c.scene.lines;
  const lines: TradeLine[] = [];
  T.routes.forEach((r, i) => {
    if (!st[i] || !r.paths.length) return;
    lines.push({ route: r, broken: st[i][0] === 'b', pts: tradeLinePts(civ, mesh, r, tradePathIndex(r, year)) });
  });
  c.scene = { key, lines };
  return lines;
}

// ---------------------------------------------------------------------------
// 画

/** 线宽这些在画布上多少像素:CSS 像素 × 放大的倍数 × dpr(k = 主图的缩放倍数;地球仪上是等效的倍数) */
export function penOf(lv: Pick<LabelView, 'k' | 'dpr'>): number {
  const k = Math.max(1, lv.k);
  return (k <= 2 ? k ** LINE_GROW : 2 ** LINE_GROW * (k / 2) ** LINE_GROW_HI) * lv.dpr;
}

/** 名字的字号(画布像素) */
export function tradeNamePx(lv: Pick<LabelView, 'k' | 'dpr'>): number {
  return SIZE.name * Math.max(1, lv.k) ** NAME_GROW * lv.dpr;
}

/** 东西相连的主图:世界 x 在 [lo, hi] 的东西挪几圈落在画布里 */
function shiftsIn(lo: number, hi: number, lv: LabelView, pad: number): number[] {
  const P = lv.proj ? 0 : (lv.wrap ?? 0);
  if (!P) return [0];
  const cw = lv.canvasW;
  if (cw === undefined) return [-P, 0, P];
  const out: number[] = [];
  const n0 = Math.ceil(((-pad - lv.ox) / lv.scale - hi) / P);
  const n1 = Math.floor(((cw + pad - lv.ox) / lv.scale - lo) / P);
  for (let n = n0; n <= n1; n++) out.push(n * P);
  return out;
}

/** 一条商道在画布上的折线(画布像素 x, y 交错;东西相连时可能有好几份,弯边投影时伸出 ±180° 的另成一份) */
export function tradeCanvasLines(l: TradeLine, lv: LabelView, pj: Projector | null, pad = 0): Float64Array[] {
  const P = l.pts;
  if (pj) return projectLinePts(P, 2, pj, { s: lv.scale, ox: lv.ox, oy: lv.oy });
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < P.length; i += 2) {
    if (P[i] < lo) lo = P[i];
    if (P[i] > hi) hi = P[i];
  }
  const out: Float64Array[] = [];
  for (const sh of shiftsIn(lo, hi, lv, pad)) {
    const o = new Float64Array(P.length);
    for (let i = 0; i < P.length; i += 2) {
      o[i] = (P[i] + sh) * lv.scale + lv.ox;
      o[i + 1] = P[i + 1] * lv.scale + lv.oy;
    }
    out.push(o);
  }
  return out;
}

function addPoly(path: Path2D, pts: ArrayLike<number>) {
  if (pts.length < 4) return;
  path.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i], pts[i + 1]);
}

/** 选中、鼠标停着的商道(编号;没有 = null);names = 改过名的名字(下标 = 商道编号;不给 = 照生成的) */
export interface TradeFocus {
  sel?: number | null;
  hover?: number | null;
  names?: readonly string[];
}

/** 画在画布上的一条商道(点选、悬停用):画布像素的折线(可能好几份)、线宽的一半 */
export interface TradeHit {
  id: number;
  polys: Float64Array[];
  half: number;
}

export interface TradeLook {
  color: string;
  halo: string;
  family: string;
}
export function tradeLookOf(p: Pick<CivDrawParams, 'style' | 'bright'>): TradeLook {
  const real = p.style !== 'fantasy';
  return {
    color: p.bright ? TRADE_BRIGHT : TRADE_INK,
    halo: real ? 'rgba(255,255,255,0.92)' : 'rgba(250,244,228,0.95)',
    family: familyFor(real ? 'realistic' : 'fantasy'),
  };
}

/** 商道的线(文字层上,城镇符号和地名之前画)。返回画了的各条(点选、悬停用) */
export function drawTradeLines(ctx: CanvasRenderingContext2D, p: CivDrawParams, lv: LabelView, pj: Projector | null, focus: TradeFocus = {}): TradeHit[] {
  if (!tradeShown(p)) return [];
  const lines = tradeScene(p.civ, p.world.mesh, p.year);
  if (!lines.length) return [];
  const u = penOf(lv);
  const pad = (SIZE.line + 2 * SIZE.casing) * u;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (pj) clipOutline(ctx, pj.mp, { s: lv.scale, ox: lv.ox, oy: lv.oy });
  const drawn = lines.map((l): TradeDrawn => {
    const polys = tradeCanvasLines(l, lv, pj, pad);
    const ends: TradeEnd[] = [];
    for (const pl of polys) {
      if (pl.length < 4) continue;
      const n = pl.length;
      ends.push([pl[0], pl[1], false], [pl[n - 2], pl[n - 1], true]);
    }
    return { line: l, polys, ends };
  });
  const hits = paintTradeLines(ctx, drawn, tradeLookOf(p), u, focus);
  ctx.restore();
  return hits;
}

/** 一头的圆点:画布像素的位置;true = 终点(实心点),false = 产地(小空心圆) */
export type TradeEnd = [number, number, boolean];

/** 投影好的一条商道:画布像素的折线(可能好几份)、两头的圆点(看不见的那头不给) */
export interface TradeDrawn {
  line: TradeLine;
  polys: Float64Array[];
  ends: TradeEnd[];
}

/**
 * 按画布像素描商道(主图、地球仪共用):选中、鼠标停着的先垫一圈白光;先画所有的浅边、再画所有的紫线(走同一段路的几条叠成一条);
 * 断着的整条虚线;两头的圆点。u = 线宽这些的倍数(penOf),alpha = 整体再淡几成。返回画了的各条(点选、悬停用)
 */
export function paintTradeLines(ctx: CanvasRenderingContext2D, drawn: readonly TradeDrawn[], look: TradeLook, u: number, focus: TradeFocus = {}, alpha = 1): TradeHit[] {
  const w = SIZE.line * u;
  const cw = SIZE.casing * u;
  const dash = [SIZE.dashOn * u, SIZE.dashOff * u];
  const sel = focus.sel ?? null;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // 选中、鼠标停着的:先垫一圈白光
  for (const d of drawn) {
    const id = d.line.route.id;
    if (id !== sel && id !== focus.hover) continue;
    const pa = new Path2D();
    for (const pl of d.polys) addPoly(pa, pl);
    ctx.globalAlpha = alpha * (id === sel ? 0.55 : 0.5);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = w + 2 * SIZE.glow * u;
    ctx.stroke(pa);
  }
  // 先画所有的浅边、再画所有的紫线:走同一段路的几条叠成一条
  for (const pass of [0, 1]) {
    for (const d of drawn) {
      const l = d.line;
      const pa = new Path2D();
      for (const pl of d.polys) addPoly(pa, pl);
      const dim = sel !== null && l.route.id !== sel ? DIM : 1;
      ctx.setLineDash(l.broken ? dash : []);
      ctx.lineCap = l.broken && pass ? 'butt' : 'round';
      if (!pass) {
        ctx.globalAlpha = alpha * dim * (l.broken ? 0.8 : 0.95);
        ctx.strokeStyle = look.halo;
        ctx.lineWidth = w + 2 * cw;
      } else {
        ctx.globalAlpha = alpha * dim * (l.broken ? 0.85 : 1);
        ctx.strokeStyle = look.color;
        ctx.lineWidth = w;
      }
      ctx.stroke(pa);
    }
  }
  ctx.setLineDash([]);
  // 两头:产地小空心圆,终点实心点
  for (const d of drawn) {
    ctx.globalAlpha = alpha * (sel !== null && d.line.route.id !== sel ? DIM : 1);
    ctx.lineWidth = SIZE.endStroke * u;
    for (const [x, y, big] of d.ends) {
      ctx.beginPath();
      ctx.arc(x, y, (big ? SIZE.cap : SIZE.end) * u, 0, Math.PI * 2);
      ctx.fillStyle = big ? look.color : look.halo;
      ctx.strokeStyle = big ? look.halo : look.color;
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
  return drawn.map((d) => ({ id: d.line.route.id, polys: d.polys, half: w / 2 + cw }));
}

/** 线宽的一半(画布像素,含浅边):整块剔除时往外放宽多少 */
export function tradeHalfWidth(u: number): number {
  return (SIZE.line / 2 + SIZE.casing) * u;
}

// ---------------------------------------------------------------------------
// 名字

/** 折线上弧长 s 处的点和切线方向 */
function along(pts: number[], cum: number[], s: number): [number, number, number] {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const seg = Math.max(1e-6, cum[i] - cum[i - 1]);
  const t = Math.min(1, Math.max(0, (s - cum[i - 1]) / seg));
  const ax = pts[(i - 1) * 2];
  const ay = pts[(i - 1) * 2 + 1];
  const bx = pts[i * 2];
  const by = pts[i * 2 + 1];
  return [ax + (bx - ax) * t, ay + (by - ay) * t, Math.atan2(by - ay, bx - ax)];
}

/** 弧长累计 */
function cumOf(pts: readonly number[]): number[] {
  const cum = [0];
  for (let i = 1; i < pts.length >> 1; i++) cum.push(cum[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]));
  return cum;
}

/** 按弧长等距重采样(步长 step 画布像素) */
function resample(pts: ArrayLike<number>, step: number): number[] {
  const arr = Array.from(pts);
  const cum = cumOf(arr);
  const L = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(L / step) + 1);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y] = along(arr, cum, (L * i) / (n - 1));
    out.push(x, y);
  }
  return out;
}

/** 滑动平均(两头不动):字顺着它排,不跟着路的小弯扭 */
function smoothFor(pts: readonly number[], r: number): number[] {
  const n = pts.length >> 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) {
      out.push(pts[i * 2], pts[i * 2 + 1]);
      continue;
    }
    const w = Math.min(r, i, n - 1 - i);
    let sx = 0;
    let sy = 0;
    for (let j = i - w; j <= i + w; j++) {
      sx += pts[j * 2];
      sy += pts[j * 2 + 1];
    }
    out.push(sx / (2 * w + 1), sy / (2 * w + 1));
  }
  return out;
}

/**
 * 名字在一条线上的一种摆法(照沿路径写字的做法):截出弧长 [mid − need/2, mid + need/2] 那一段,
 * 从右往左走的倒过来(从左往右念),往读的方向的左手边(线的上方)挪开 off,再抹顺一遍,字按弧长均匀排在这条线的正中
 */
function layoutAt(pts: number[], cum: number[], text: string, px: number, mid: number, need: number, off: number, step: number): Glyph[] {
  const L = cum[cum.length - 1];
  const a = Math.max(0, mid - need / 2);
  const b = Math.min(L, mid + need / 2);
  const seg: number[] = [];
  for (let s = a; s < b; s += step) seg.push(...along(pts, cum, s).slice(0, 2));
  seg.push(...along(pts, cum, b).slice(0, 2));
  if (seg.length < 4) return [];
  // 从左往右念
  if (seg[seg.length - 2] < seg[0]) {
    for (let i = 0, j = seg.length - 2; i < j; i += 2, j -= 2) {
      [seg[i], seg[j]] = [seg[j], seg[i]];
      [seg[i + 1], seg[j + 1]] = [seg[j + 1], seg[i + 1]];
    }
  }
  const m = seg.length >> 1;
  const nrm: number[] = [];
  for (let i = 0; i < m; i++) {
    const p0 = Math.max(0, i - 1);
    const p1 = Math.min(m - 1, i + 1);
    const dx = seg[p1 * 2] - seg[p0 * 2];
    const dy = seg[p1 * 2 + 1] - seg[p0 * 2 + 1];
    const d = Math.hypot(dx, dy) || 1;
    nrm.push(seg[i * 2] + (dy / d) * off, seg[i * 2 + 1] - (dx / d) * off);
  }
  const line = smoothFor(smoothFor(nrm, 3), 3);
  const lc = cumOf(line);
  const len = lc[lc.length - 1];
  const adv = px * (1 + SIZE.track);
  const n = text.length;
  const s0 = len / 2 - (adv * n) / 2;
  const out: Glyph[] = [];
  for (let i = 0; i < n; i++) {
    const [x, y, ang] = along(line, lc, Math.min(len, Math.max(0, s0 + adv * (i + 0.5))));
    out.push({ ch: text[i], x, y, a: ang });
  }
  return out;
}

const overlaps = (a: readonly number[], b: readonly number[]) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/**
 * 商道的名字(文字层上,地名、城镇符号画完以后写):顺着线写、从左往右念,写在线的上方。
 * 缩放 1 倍时写得下、又不压地名的才写;2 倍起每条都写(挤不开时照写在正中)。返回写了几条
 */
export function drawTradeNames(ctx: CanvasRenderingContext2D, p: CivDrawParams, lv: LabelView, pj: Projector | null, placed: Placement | null, focus: TradeFocus = {}): number {
  if (!tradeShown(p)) return 0;
  const lines = tradeScene(p.civ, p.world.mesh, p.year);
  if (!lines.length) return 0;
  const W = lv.canvasW ?? Infinity;
  const H = lv.canvasH ?? Infinity;
  // 画布里那一份(中点离画布中心最近的)
  const on = lines.map((l) => {
    let best: Float64Array | null = null;
    let bd = Infinity;
    for (const pl of tradeCanvasLines(l, lv, pj)) {
      const m = (pl.length >> 2) << 1;
      const d = Math.hypot(pl[m] - W / 2, pl[m + 1] - H / 2);
      if (d < bd) {
        bd = d;
        best = pl;
      }
    }
    return { line: l, pl: best };
  });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (pj) clipOutline(ctx, pj.mp, { s: lv.scale, ox: lv.ox, oy: lv.oy });
  const n = writeTradeNames(ctx, on, tradeLookOf(p), lv, placed, focus);
  ctx.restore();
  return n;
}

/** 写名字时另外的规矩(地球仪):哪些字框算出了界(和出画布一样不要)、每个字淡几成 */
export interface TradeNameRules {
  outside?: (box: readonly number[]) => boolean;
  alpha?: (g: Glyph) => number;
}

/**
 * 按画布像素写商道的名字(主图、地球仪共用):on = 每条商道拿来写字的那一段折线(画布像素;没有 = null)。
 * 选中的先放,再按线长;缩放 1 倍时写得下、又不压地名和城镇符号的才写,2 倍起每条都写(挤不开时写在压字最少的位置)。返回写了几条
 */
export function writeTradeNames(
  ctx: CanvasRenderingContext2D,
  on: readonly { line: TradeLine; pl: ArrayLike<number> | null }[],
  look: TradeLook,
  lv: Pick<LabelView, 'k' | 'dpr' | 'canvasW' | 'canvasH'>,
  placed: Placement | null,
  focus: TradeFocus = {},
  rules: TradeNameRules = {},
): number {
  const u = penOf(lv);
  const px = tradeNamePx(lv);
  const all = lv.k >= 2;
  const W = lv.canvasW ?? Infinity;
  const H = lv.canvasH ?? Infinity;
  const taken: number[][] = [];
  if (placed) {
    for (const l of placed.labels) for (const g of l.glyphs) taken.push(glyphBox(g, l.px, 0));
    for (const m of placed.marks) taken.push(placedMarkBox(m));
  }
  const sel = focus.sel ?? null;
  const step = 2 * lv.dpr;
  const outside = rules.outside;
  // 选中的先放,再按线长
  const order = on
    .filter((x) => x.pl && x.pl.length >= 4)
    .map((x) => {
      // 等距重采样后抹顺(窗口约一个字宽):字顺着大的走向排
      const pts = smoothFor(resample(x.pl!, step), Math.max(2, Math.round(px / step)));
      const cum = cumOf(pts);
      return { l: x.line, pts, cum, L: cum[cum.length - 1] };
    })
    .sort((a, b) => (a.l.route.id === sel ? -1 : b.l.route.id === sel ? 1 : b.L - a.L || a.l.route.id - b.l.route.id));
  const off = (SIZE.line / 2 + SIZE.casing) * u + px * 0.55;
  const font = fontCss(look.family, 700, px);
  let n = 0;
  ctx.save();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const o of order) {
    const text = focus.names?.[o.l.route.id] || o.l.route.name;
    if (!text) continue;
    const need = text.length * px * (1 + SIZE.track) + px;
    if (!all && o.L < need) continue;
    let pick: Glyph[] | null = null;
    // 挤不开时(2 倍起照写):压字最少的那一种
    let least: Glyph[] | null = null;
    let leastN = Infinity;
    for (const f of [0.5, 0.38, 0.62, 0.26, 0.74, 0.16, 0.84]) {
      const mid = Math.min(Math.max(o.L * f, need / 2), o.L - need / 2);
      const gs = layoutAt(o.pts, o.cum, text, px, o.L < need ? o.L / 2 : mid, need, off, step);
      if (!gs.length) continue;
      const boxes = gs.map((g) => glyphBox(g, px, px * 0.08));
      let hit = 0;
      for (const b of boxes) for (const t of taken) if (overlaps(b, t)) hit++;
      // 出了画布(地球仪:出了球面)的不算
      const out = boxes.filter((b) => b[0] < 0 || b[1] < 0 || b[2] > W || b[3] > H || (outside && outside(b))).length;
      if (hit + 1000 * out < leastN) {
        leastN = hit + 1000 * out;
        least = gs;
      }
      if (hit || out) continue;
      pick = gs;
      break;
    }
    // 2 倍起照写;地球仪上出了球面的那种不写
    if (!pick && all && !(outside && leastN >= 1000)) pick = least;
    if (!pick) continue;
    for (const g of pick) taken.push(glyphBox(g, px, px * 0.08));
    const dim = sel !== null && o.l.route.id !== sel ? DIM : 1;
    for (const g of pick) {
      ctx.globalAlpha = dim * (rules.alpha ? rules.alpha(g) : 1);
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.a);
      ctx.strokeStyle = look.halo;
      ctx.lineWidth = SIZE.halo * lv.dpr;
      ctx.strokeText(g.ch, 0, 0);
      ctx.fillStyle = look.color;
      ctx.fillText(g.ch, 0, 0);
      ctx.restore();
    }
    n++;
  }
  ctx.restore();
  return n;
}

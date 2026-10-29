/**
 * 地球仪上的商道:和平面主图同一套画法(render/civ/trade.ts 的 paintTradeLines、writeTradeNames),只是折线按正射投影换到球上。
 *
 *   - 线:每条商道的路线(世界坐标,和主图同一条)换成三维顶点、分好块(按路线缓存,换年份只换用哪几条),
 *     每帧按投影描成画布像素的折线 —— 背面的裁掉(在球的轮廓上断开),跨 180° 经线不断
 *   - 样子、线宽、字号和主图"同样的缩放"时一样:放大倍数按等效的主图缩放(球心处一个世界单位的大小,同 globeLabels.ts),
 *     不到 1 倍的按 1 倍(和主图一样不再变细)。断着的整条虚线;产地小空心圆、终点实心点 —— 那一头在背面、贴着球边缘的不画
 *   - 名字:顺着投影后的线写、从左往右念,写在线的上方;拿来写字的是看得见的最长那一段。
 *     字的每个角都要在球面上、离球的轮廓还有一点距离(和地名一样),靠近球边缘的字淡一点
 *
 * 纯计算的部分(建线、投影)单测在 Node 里跑。
 */
import type { CivDrawParams } from './civ/overlay';
import type { Placement } from './labels/draw';
import type { Glyph } from './labels/layout';
import {
  paintTradeLines,
  penOf,
  tradeHalfWidth,
  tradeLookOf,
  tradeScene,
  tradeShown,
  writeTradeNames,
  type TradeDrawn,
  type TradeEnd,
  type TradeFocus,
  type TradeHit,
  type TradeLine,
} from './civ/trade';
import { buildLineSet, globePoint, traceLineSet, type GlobeLineSet, type GlobeProjector } from './globeLines';
import { GLYPH_MIN_D, MARK_MIN_D, globeGlyphAlpha, type GlobeLabelView } from './globeLabels';

/** 一条路线 → 线组(按路线的折线缓存:主图那边同一年、同一版路线用的是同一个数组) */
const setCache = new WeakMap<Float32Array, { W: number; set: GlobeLineSet }>();

export function globeTradeSet(pts: Float32Array, W: number, H: number): GlobeLineSet {
  const hit = setCache.get(pts);
  if (hit && hit.W === W) return hit.set;
  const set = buildLineSet([{ pts }], W, H);
  setCache.set(pts, { W, set });
  return set;
}

/** 把一组线按这一帧的投影描成画布像素的折线(背面的裁掉,从正面走到背面时断成几段) */
export function traceGlobePolys(set: GlobeLineSet, P: GlobeProjector, pad: number): Float64Array[] {
  const out: number[][] = [];
  let cur: number[] = [];
  traceLineSet(
    {
      moveTo(x, y) {
        cur = [x, y];
        out.push(cur);
      },
      lineTo(x, y) {
        cur.push(x, y);
      },
    },
    set,
    P,
    pad,
  );
  return out.filter((pl) => pl.length >= 4).map((pl) => Float64Array.from(pl));
}

/** 线宽按什么定 */
export interface GlobeTradeScale {
  /** 等效的主图缩放倍数(球心处一个世界单位的大小;不到 1 的按 1) */
  k: number;
  dpr: number;
}

/** 这一帧画了的商道:点选、悬停用的折线(画布像素),写名字时接着用 */
export interface GlobeTradeFrame {
  hits: TradeHit[];
  drawn: TradeDrawn[];
}

/**
 * 商道的线画到球面那层上(国界、战线上面,城镇符号和字底下;画完再统一把球边缘淡一点)。
 * P = 这一帧的投影(画布像素),alpha = 整体的不透明度(回放世界形成时跟着淡出)
 */
export function drawGlobeTradeLines(ctx: CanvasRenderingContext2D, p: CivDrawParams, P: GlobeProjector, sc: GlobeTradeScale, focus: TradeFocus = {}, alpha = 1): GlobeTradeFrame {
  const none = { hits: [], drawn: [] };
  if (!tradeShown(p)) return none;
  const lines = tradeScene(p.civ, p.world.mesh, p.year);
  if (!lines.length) return none;
  const W = p.world.width;
  const H = p.world.height;
  const lv = { k: Math.max(1, sc.k), dpr: sc.dpr };
  const u = penOf(lv);
  const pad = 12 + tradeHalfWidth(u);
  const drawn: TradeDrawn[] = [];
  for (const l of lines) {
    const polys = traceGlobePolys(globeTradeSet(l.pts, W, H), P, pad);
    if (!polys.length) continue;
    drawn.push({ line: l, polys, ends: globeEnds(l, P, W, H) });
  }
  if (!drawn.length) return none;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const hits = paintTradeLines(ctx, drawn, tradeLookOf(p), u, focus, alpha);
  ctx.restore();
  return { hits, drawn };
}

/** 两头的圆点:朝着这边(朝向 ≥ MARK_MIN_D,和城镇符号一样)的才画 */
function globeEnds(l: TradeLine, P: GlobeProjector, W: number, H: number): TradeEnd[] {
  const pts = l.pts;
  const n = pts.length;
  if (n < 4) return [];
  const out: TradeEnd[] = [];
  const a = globePoint(P, pts[0], pts[1], W, H);
  if (a[2] >= MARK_MIN_D) out.push([a[0], a[1], false]);
  const b = globePoint(P, pts[n - 2], pts[n - 1], W, H);
  if (b[2] >= MARK_MIN_D) out.push([b[0], b[1], true]);
  return out;
}

/** 折线的长度(画布像素) */
function polyLen(pl: ArrayLike<number>): number {
  let L = 0;
  for (let i = 2; i < pl.length; i += 2) L += Math.hypot(pl[i] - pl[i - 2], pl[i + 1] - pl[i - 1]);
  return L;
}

/** 字框的四个角都在球面上、离轮廓还有一点距离(同地名的 GLYPH_MIN_D) */
export function boxOnGlobe(b: readonly number[], g: Pick<GlobeLabelView['globe'], 'cx' | 'cy' | 'R'>): boolean {
  const r2 = 1 - GLYPH_MIN_D * GLYPH_MIN_D;
  for (const x of [b[0], b[2]])
    for (const y of [b[1], b[3]]) {
      const u = (x - g.cx) / g.R;
      const t = (y - g.cy) / g.R;
      if (u * u + t * t > r2) return false;
    }
  return true;
}

/**
 * 商道的名字(地名、城镇符号画完以后写,和主图一样):顺着投影后的线写,拿看得见的最长那一段;
 * 不压地名、城镇符号,字不出球面,靠近球边缘的淡一点。返回写了几条
 */
export function drawGlobeTradeNames(
  ctx: CanvasRenderingContext2D,
  p: CivDrawParams,
  lv: GlobeLabelView,
  frame: GlobeTradeFrame,
  placed: Placement | null,
  focus: TradeFocus = {},
  alpha = 1,
): number {
  if (!frame.drawn.length) return 0;
  const on = frame.drawn.map((d) => {
    let best: Float64Array | null = null;
    let bl = 0;
    for (const pl of d.polys) {
      const L = polyLen(pl);
      if (L > bl) {
        bl = L;
        best = pl;
      }
    }
    return { line: d.line, pl: best };
  });
  const fade = globeGlyphAlpha(lv);
  const g = lv.globe;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const n = writeTradeNames(ctx, on, tradeLookOf(p), { ...lv, k: Math.max(1, lv.globe.kEq) }, placed, focus, {
    outside: (b) => !boxOnGlobe(b, g),
    alpha: (gl: Glyph) => alpha * fade(gl),
  });
  ctx.restore();
  return n;
}

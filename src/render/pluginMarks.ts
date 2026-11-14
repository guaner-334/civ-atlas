/**
 * 插件的标注图层(点、文字、线、圈几个地块):按 MarkFrame 换到画布上画,平面主图、弯边投影、地球仪、导出共用。
 * 线和点都先描一道白边,压在什么底图上都看得清;文字写在白底小牌上:点的在右边,线的在线走到一半那一点的下面。只往给定的画布上画,不碰 DOM。
 */
import type { Mesh } from '../gen/mesh';
import type { MarkLayer, MarkLayerItem } from '../plugin/check';
import type { LayerMarkColor, MarkIcon, MarkStyle } from '../plugin/types';
import { nearX } from './common';
import { MARK_ICON_PATHS } from './markIcons';
import { MARK_FONT, MARK_HEX, cellAreaShape, type AreaShape, type MarkFrame } from './marks';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const PLUGIN_MARK_HEX: Record<LayerMarkColor, string> = {
  red: '#c4372b',
  orange: MARK_HEX.orange,
  green: MARK_HEX.green,
  blue: MARK_HEX.blue,
  purple: MARK_HEX.purple,
  teal: MARK_HEX.teal,
  black: '#2c2c2e',
  white: '#ffffff',
};

/** 线宽、白边宽、点的半径(CSS 像素),按 size 三档 */
const SIZE = {
  s: { line: 2.2, edge: 5.5, dot: 5 },
  m: { line: 3.2, edge: 7, dot: 6.5 },
  l: { line: 4.6, edge: 9, dot: 8 },
};

/** 配图标的点:圆的直径(CSS 像素),按 size 三档 */
const BADGE = { s: 20, m: 24, l: 28 };

const colorOf = (s?: MarkStyle): string => {
  const c = s?.color ?? 'red';
  return c[0] === '#' ? c : PLUGIN_MARK_HEX[c as LayerMarkColor];
};
const sizeOf = (s?: MarkStyle) => SIZE[s?.size ?? 'm'];

/** 自己给的色号够浅(亮度 > 0.8)的和 white 一样:描深色的边,图标画深色的图案 */
function isLight(s?: MarkStyle): boolean {
  const c = s?.color;
  if (!c || c[0] !== '#') return c === 'white';
  const v = parseInt(c.slice(1), 16);
  return 0.2126 * (v >> 16) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255) > 204;
}
const edgeOf = (s?: MarkStyle) => (isLight(s) ? 'rgba(44,44,46,0.85)' : 'rgba(255,255,255,0.9)');

/** 线宽、白边宽、虚线一段画多长空多长:给了 width 的照它,没给的照 size 三档 */
function lineLook(s?: MarkStyle): { line: number; edge: number; dash: [number, number] } {
  const w = s?.width;
  if (w !== undefined) return { line: w, edge: w * 1.2 + 3.6, dash: [Math.max(5, w * 3.5), Math.max(4, w * 2.25)] };
  const z = sizeOf(s);
  return { line: z.line, edge: z.edge, dash: [z.line * 2.2, z.line * 1.8] };
}

/** 时间轴在 year 这一年时画不画这一项(year 没有 = 世界还没有历史,都画) */
const shownAt = (it: MarkLayerItem, year: number | undefined) => year === undefined || ((it.from === undefined || year >= it.from) && (it.to === undefined || year <= it.to));

/** 一项的世界坐标(x 按前一个点展开成连着的,东西两头相连时不绕一大圈) */
function worldPts(it: MarkLayerItem, mesh: Mesh): Float64Array {
  const W = mesh.width;
  const n = it.cells ? it.cells.length : it.points!.length / 2;
  const out = new Float64Array(n * 2);
  let ref = NaN;
  for (let i = 0; i < n; i++) {
    let x: number;
    let y: number;
    if (it.cells) {
      const c = it.cells[i];
      x = mesh.x[c];
      y = mesh.y[c];
    } else {
      x = it.points![2 * i];
      y = it.points![2 * i + 1];
    }
    if (Number.isFinite(ref)) x = nearX(x, ref, W);
    ref = x;
    out[2 * i] = x;
    out[2 * i + 1] = y;
  }
  return out;
}

/** 平面等距圆柱左右相连:这段画布 x 范围要挪几圈才落在看得见的范围里(弯边投影、地球仪、导出只画一份) */
function shiftsFor(f: MarkFrame, x0: number, x1: number): number[] {
  if (!f.period) return [0];
  const out: number[] = [];
  const k0 = Math.floor((f.win[0] - x1) / f.period);
  const k1 = Math.ceil((f.win[1] - x0) / f.period);
  for (let k = k0; k <= k1; k++) {
    const o = k * f.period;
    if (x1 + o >= f.win[0] && x0 + o <= f.win[1]) out.push(o);
  }
  return out;
}

/** 世界坐标的一串点 → 画布上的几段(球背面、弯边投影的切口处断开) */
function project(f: MarkFrame, pts: ArrayLike<number>): number[][] {
  const runs: number[][] = [];
  let cur: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const p = f.pt(pts[i], pts[i + 1]);
    if (!p) {
      if (cur.length) runs.push(cur);
      cur = [];
      continue;
    }
    const n = cur.length;
    if (n && f.cut > 0 && Math.abs(p[0] - cur[n - 2]) > f.cut) {
      runs.push(cur);
      cur = [];
    }
    cur.push(p[0], p[1]);
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function bounds(runs: number[][]): [number, number] {
  let a = Infinity;
  let b = -Infinity;
  for (const r of runs)
    for (let i = 0; i < r.length; i += 2) {
      if (r[i] < a) a = r[i];
      if (r[i] > b) b = r[i];
    }
  return [a, b];
}

function pathOf(ctx: Ctx, runs: number[][], o: number, closed: boolean) {
  ctx.beginPath();
  for (const r of runs) {
    if (r.length < 4) continue;
    ctx.moveTo(r[0] + o, r[1]);
    for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i] + o, r[i + 1]);
    if (closed) ctx.closePath();
  }
}

const shapes = new WeakMap<MarkLayerItem, AreaShape | null>();

function drawArea(ctx: Ctx, f: MarkFrame, it: MarkLayerItem, mesh: Mesh) {
  let sh = shapes.get(it);
  if (sh === undefined) shapes.set(it, (sh = cellAreaShape(mesh, it.cells!)));
  if (!sh) return;
  const col = colorOf(it.style);
  const polys = sh.polys.map((p) => project(f, p)).flat();
  const loops = sh.loops.map((p) => project(f, p)).flat();
  const [x0, x1] = bounds([...polys, ...loops]);
  const w = it.style?.width ?? 2;
  for (const o of shiftsFor(f, x0, x1)) {
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.28;
    pathOf(ctx, polys, o, true);
    ctx.fill();
    ctx.globalAlpha = 1;
    pathOf(ctx, loops, o, false);
    ctx.setLineDash([]);
    ctx.strokeStyle = edgeOf(it.style);
    ctx.lineWidth = w + 2.5;
    ctx.stroke();
    ctx.setLineDash(it.style?.line === 'dashed' ? [w * 3, w * 2.5] : []);
    ctx.strokeStyle = col;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (it.text) drawLabel(ctx, f, sh.label[0], sh.label[1], it.text, 0);
}

/** 箭头的尖、朝向(单位向量);线在这一头要缩的:run 里哪几个点(从这一头数 k 个)、离下一个点多远 d */
interface Arrow {
  run: number[];
  end: boolean;
  tip: [number, number];
  ux: number;
  uy: number;
  k: number;
  d: number;
}

/** 线的一头的箭头(只读 run);这一头的点看得见才有(在球背面、投影切口外的不画)。end = 末端,否则是开头 */
function arrowAt(run: number[], end: boolean): Arrow | null {
  const n = run.length / 2;
  if (n < 2) return null;
  const at = (i: number): [number, number] => (end ? [run[2 * (n - 1 - i)], run[2 * (n - 1 - i) + 1]] : [run[2 * i], run[2 * i + 1]]);
  const tip = at(0);
  let k = 1;
  let d = 0;
  for (; k < n; k++) {
    const p = at(k);
    d = Math.hypot(tip[0] - p[0], tip[1] - p[1]);
    if (d > 0.5) break;
  }
  if (k >= n) return null;
  const back = at(k);
  return { run, end, tip, ux: (tip[0] - back[0]) / d, uy: (tip[1] - back[1]) / d, k, d };
}

/** 线在箭头那一头缩到箭头底边里,圆头不从箭头两边露出来。两头的箭头都先算好再缩,短线两头都还有箭头 */
function cutForArrow(a: Arrow, len: number) {
  const n = a.run.length / 2;
  const s = Math.min(a.d, len - 1);
  for (let i = 0; i < a.k; i++) {
    const j = a.end ? n - 1 - i : i;
    a.run[2 * j] = a.tip[0] - a.ux * s;
    a.run[2 * j + 1] = a.tip[1] - a.uy * s;
  }
}

function drawArrow(ctx: Ctx, a: Arrow, o: number, len: number, w: number, fill: string, edge: string) {
  const half = len / 2;
  const bx = a.tip[0] + o - a.ux * len;
  const by = a.tip[1] - a.uy * len;
  ctx.beginPath();
  ctx.moveTo(a.tip[0] + o, a.tip[1]);
  ctx.lineTo(bx - a.uy * half, by + a.ux * half);
  ctx.lineTo(bx + a.uy * half, by - a.ux * half);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = 1.1 + 0.13 * w;
  ctx.strokeStyle = edge;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawLine(ctx: Ctx, f: MarkFrame, it: MarkLayerItem, mesh: Mesh) {
  const pts = worldPts(it, mesh);
  const runs = project(f, pts);
  if (!runs.length) return;
  const [x0, x1] = bounds(runs);
  const look = lineLook(it.style);
  const col = colorOf(it.style);
  const edge = edgeOf(it.style);
  const arrow = it.style?.arrow;
  const len = 7 + 1.6 * look.line;
  const heads: Arrow[] = [];
  if (arrow) {
    const n = pts.length / 2;
    const tail = f.pt(pts[2 * n - 2], pts[2 * n - 1]) ? arrowAt(runs[runs.length - 1], true) : null;
    const head = arrow === 'both' && f.pt(pts[0], pts[1]) ? arrowAt(runs[0], false) : null;
    for (const a of [tail, head]) if (a) heads.push(a);
    for (const a of heads) cutForArrow(a, len);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const o of shiftsFor(f, x0, x1)) {
    pathOf(ctx, runs, o, false);
    ctx.setLineDash([]);
    ctx.strokeStyle = edge;
    ctx.lineWidth = look.edge;
    ctx.stroke();
    ctx.setLineDash(it.style?.line === 'dashed' ? look.dash : []);
    ctx.strokeStyle = col;
    ctx.lineWidth = look.line;
    ctx.stroke();
    ctx.setLineDash([]);
    for (const a of heads) drawArrow(ctx, a, o, len, look.line, col, edge);
  }
  if (it.text) {
    const m = midOf(runs);
    if (m) drawLabelAt(ctx, f, [m[0], m[1] + look.edge / 2 + 9 + LABEL_H / 2], it.text, 0);
  }
}

/** 看得见的几段线按长度走到一半的那一点(画布坐标);没有长度 = null */
function midOf(runs: number[][]): [number, number] | null {
  let total = 0;
  for (const r of runs) for (let i = 2; i < r.length; i += 2) total += Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
  if (!(total > 0)) return null;
  let left = total / 2;
  for (const r of runs)
    for (let i = 2; i < r.length; i += 2) {
      const d = Math.hypot(r[i] - r[i - 2], r[i + 1] - r[i - 1]);
      if (d >= left && d > 0) return [r[i - 2] + ((r[i] - r[i - 2]) * left) / d, r[i - 1] + ((r[i + 1] - r[i - 1]) * left) / d];
      left -= d;
    }
  return null;
}

const LABEL_H = 21;

/** 文字小牌:白底圆角,字在 (x, y) 右边 dx 处、竖直居中(x、y 是世界坐标) */
function drawLabel(ctx: Ctx, f: MarkFrame, wx: number, wy: number, text: string, dx: number) {
  const p = f.pt(wx, wy);
  if (p) drawLabelAt(ctx, f, p, text, dx);
}

/** 同上,p 是画布坐标;dx = 0 = 小牌以 p 为中心 */
function drawLabelAt(ctx: Ctx, f: MarkFrame, p: [number, number], text: string, dx: number) {
  ctx.font = `600 12.5px ${MARK_FONT}`;
  const w = ctx.measureText(text).width + 16;
  const h = LABEL_H;
  for (const o of shiftsFor(f, dx ? p[0] : p[0] - w / 2, p[0] + dx + w)) {
    const x = p[0] + o + dx;
    const y = p[1] - h / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 1;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.roundRect(dx ? x : x - w / 2, y, w, h, 6);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#1d1d1f';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(text, (dx ? x : x - w / 2) + 8, p[1] + 0.5);
  }
}

const iconPaths = new Map<MarkIcon, Path2D>();
function iconPath(icon: Exclude<MarkIcon, 'battle'>): Path2D {
  let p = iconPaths.get(icon);
  if (!p) iconPaths.set(icon, (p = new Path2D(MARK_ICON_PATHS[icon])));
  return p;
}

/** 交叉的双剑:和地图上战争的记号同一个画法(civ/warfare.ts 的 drawSwords),h 是半长 */
function swords(x: number, y: number, h: number): Path2D {
  const pa = new Path2D();
  for (const s of [1, -1]) {
    const x0 = x - s * h;
    const y0 = y + h;
    const x1 = x + s * h;
    const y1 = y - h;
    pa.moveTo(x0, y0);
    pa.lineTo(x1, y1);
    const gx = x0 + (x1 - x0) * 0.28;
    const gy = y0 + (y1 - y0) * 0.28;
    const g = h * 0.42 * Math.SQRT1_2;
    pa.moveTo(gx - g, gy - s * g);
    pa.lineTo(gx + g, gy + s * g);
  }
  return pa;
}

/** 配图标的点:标注色的圆、一圈白边、淡淡的影子,上面白图案(浅色的圆配深色图案)。影子不用 shadowBlur,几千个也画得动 */
function drawBadge(ctx: Ctx, x: number, y: number, d: number, icon: MarkIcon, s?: MarkStyle) {
  const r = d / 2;
  const light = isLight(s);
  ctx.beginPath();
  ctx.arc(x, y + 1, r + 3, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r + 2, 0, Math.PI * 2);
  ctx.fillStyle = light ? 'rgba(44,44,46,0.85)' : 'rgba(255,255,255,0.95)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colorOf(s);
  ctx.fill();
  const glyph = light ? '#2c2c2e' : '#ffffff';
  if (icon === 'battle') {
    const h = d * 0.24;
    ctx.lineCap = 'round';
    ctx.lineWidth = h * 0.42;
    ctx.strokeStyle = glyph;
    ctx.stroke(swords(x, y, h));
    return;
  }
  const g = d * 0.58;
  ctx.save();
  ctx.translate(x - g / 2, y - g / 2);
  ctx.scale(g / 15, g / 15);
  ctx.fillStyle = glyph;
  ctx.fill(iconPath(icon));
  ctx.restore();
}

function drawDot(ctx: Ctx, x: number, y: number, r: number, s?: MarkStyle) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = colorOf(s);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = edgeOf(s);
  ctx.stroke();
}

/** 画好的点、图标按(样子、颜色、大小、画布缩放)留一张小图(box 见方,点在正中),拖地图时几千个也只是贴图 */
const sprites = new Map<string, OffscreenCanvas>();
function sprite(ctx: Ctx, key: string, box: number, draw: (g: OffscreenCanvasRenderingContext2D) => void): OffscreenCanvas | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const t = ctx.getTransform();
  const k = Math.round(Math.hypot(t.a, t.b) * 100) / 100;
  const id = `${key}|${box}|${k}`;
  let c = sprites.get(id);
  if (!c) {
    if (sprites.size >= 256) sprites.clear();
    c = new OffscreenCanvas(Math.ceil(box * k), Math.ceil(box * k));
    const g = c.getContext('2d')!;
    g.scale(k, k);
    draw(g);
    sprites.set(id, c);
  }
  return c;
}

function drawPoint(ctx: Ctx, f: MarkFrame, it: MarkLayerItem, mesh: Mesh) {
  const pts = worldPts(it, mesh);
  const p = f.pt(pts[0], pts[1]);
  if (!p) return;
  const s = it.style;
  const icon = s?.icon;
  const d = BADGE[s?.size ?? 'm'];
  const r = icon ? d / 2 + 2 : sizeOf(s).dot;
  const box = icon ? d + 8 : 2 * r + 6;
  const sp = icon ? sprite(ctx, `${icon}|${colorOf(s)}|${d}`, box, (g) => drawBadge(g, box / 2, box / 2, d, icon, s)) : sprite(ctx, `dot|${colorOf(s)}|${r}`, box, (g) => drawDot(g, box / 2, box / 2, r, s));
  for (const o of shiftsFor(f, p[0] - r, p[0] + r)) {
    if (sp) ctx.drawImage(sp, p[0] + o - box / 2, p[1] - box / 2, box, box);
    else if (icon) drawBadge(ctx, p[0] + o, p[1], d, icon, s);
    else drawDot(ctx, p[0] + o, p[1], r, s);
  }
  if (it.text) drawLabel(ctx, f, pts[0], pts[1], it.text, icon ? r + 2 : r + 6);
}

/**
 * 画几个标注图层(先后照给的):圈的地块在最下面,然后线,最上面点和文字。
 * year = 时间轴停在哪一年(带 from、to 的项按它挑);不给 = 都画
 */
export function drawPluginMarks(ctx: Ctx, layers: readonly MarkLayer[], f: MarkFrame, mesh: Mesh, year?: number): void {
  const y = year === undefined ? undefined : Math.floor(year);
  const items = layers.flatMap((l) => l.items).filter((it) => shownAt(it, y));
  ctx.save();
  for (const it of items) if (it.kind === 'area' && it.cells) drawArea(ctx, f, it, mesh);
  for (const it of items) if (it.kind === 'line') drawLine(ctx, f, it, mesh);
  for (const it of items) if (it.kind === 'point' || it.kind === 'label') drawPoint(ctx, f, it, mesh);
  ctx.restore();
}

/** 这几个图层里有没有带年份的项(时间轴动了要不要重画) */
export function marksTimed(layers: readonly MarkLayer[]): boolean {
  return layers.some((l) => l.items.some((it) => it.from !== undefined || it.to !== undefined));
}

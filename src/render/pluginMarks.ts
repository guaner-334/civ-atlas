/**
 * 插件的标注图层(点、文字、线、圈几个地块):按 MarkFrame 换到画布上画,平面主图、弯边投影、地球仪、导出共用。
 * 线和点都先描一道白边,压在什么底图上都看得清;文字写在点旁边的白底小牌上。只往给定的画布上画,不碰 DOM。
 */
import type { Mesh } from '../gen/mesh';
import type { MarkLayer, MarkLayerItem } from '../plugin/check';
import type { LayerMarkColor, MarkStyle } from '../plugin/types';
import { nearX } from './common';
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

const colorOf = (s?: MarkStyle) => PLUGIN_MARK_HEX[s?.color ?? 'red'];
const sizeOf = (s?: MarkStyle) => SIZE[s?.size ?? 'm'];
/** 白色的点、线用深色描边 */
const edgeOf = (s?: MarkStyle) => (s?.color === 'white' ? 'rgba(44,44,46,0.85)' : 'rgba(255,255,255,0.9)');

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
  for (const o of shiftsFor(f, x0, x1)) {
    ctx.fillStyle = col;
    ctx.globalAlpha = 0.28;
    pathOf(ctx, polys, o, true);
    ctx.fill();
    ctx.globalAlpha = 1;
    pathOf(ctx, loops, o, false);
    ctx.setLineDash([]);
    ctx.strokeStyle = edgeOf(it.style);
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.setLineDash(it.style?.line === 'dashed' ? [6, 5] : []);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (it.text) drawLabel(ctx, f, sh.label[0], sh.label[1], it.text, 0);
}

function drawLine(ctx: Ctx, f: MarkFrame, it: MarkLayerItem, mesh: Mesh) {
  const runs = project(f, worldPts(it, mesh));
  const [x0, x1] = bounds(runs);
  const sz = sizeOf(it.style);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const o of shiftsFor(f, x0, x1)) {
    pathOf(ctx, runs, o, false);
    ctx.setLineDash([]);
    ctx.strokeStyle = edgeOf(it.style);
    ctx.lineWidth = sz.edge;
    ctx.stroke();
    ctx.setLineDash(it.style?.line === 'dashed' ? [sz.line * 2.2, sz.line * 1.8] : []);
    ctx.strokeStyle = colorOf(it.style);
    ctx.lineWidth = sz.line;
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

/** 文字小牌:白底圆角,字在 (x, y) 右边 dx 处、竖直居中(x、y 是世界坐标) */
function drawLabel(ctx: Ctx, f: MarkFrame, wx: number, wy: number, text: string, dx: number) {
  const p = f.pt(wx, wy);
  if (!p) return;
  ctx.font = `600 12.5px ${MARK_FONT}`;
  const w = ctx.measureText(text).width + 16;
  const h = 21;
  for (const o of shiftsFor(f, p[0], p[0] + dx + w)) {
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

function drawPoint(ctx: Ctx, f: MarkFrame, it: MarkLayerItem, mesh: Mesh) {
  const pts = worldPts(it, mesh);
  const p = f.pt(pts[0], pts[1]);
  if (!p) return;
  const sz = sizeOf(it.style);
  for (const o of shiftsFor(f, p[0] - sz.dot, p[0] + sz.dot)) {
    ctx.beginPath();
    ctx.arc(p[0] + o, p[1], sz.dot, 0, Math.PI * 2);
    ctx.fillStyle = colorOf(it.style);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = edgeOf(it.style);
    ctx.stroke();
  }
  if (it.text) drawLabel(ctx, f, pts[0], pts[1], it.text, sz.dot + 6);
}

/** 画几个标注图层(先后照给的):圈的地块在最下面,然后线,最上面点和文字 */
export function drawPluginMarks(ctx: Ctx, layers: readonly MarkLayer[], f: MarkFrame, mesh: Mesh): void {
  const items = layers.flatMap((l) => l.items);
  ctx.save();
  for (const it of items) if (it.kind === 'area' && it.cells) drawArea(ctx, f, it, mesh);
  for (const it of items) if (it.kind === 'line') drawLine(ctx, f, it, mesh);
  for (const it of items) if (it.kind === 'point' || it.kind === 'label') drawPoint(ctx, f, it, mesh);
  ctx.restore();
}

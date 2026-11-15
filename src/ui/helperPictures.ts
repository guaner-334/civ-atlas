/**
 * 试跑出的图(封面、详情图)照 plugin/trialPicture.ts 的规矩画在 1200×600 的画布上:底图裁出放大的那一片,
 * 再画标注、框、国名、图例、年份、字幕、面板。只往给定的画布上画;底图、面板图由 helperTrial.tsx 备好。
 */
import type { MarkLayer } from '../plugin/check';
import { PIC_H, PIC_W, type LegendPlan, type PicKind, type PicRect, type Subtitle } from '../plugin/trialPicture';
import type { Mesh } from '../gen/mesh';
import { MARK_FONT, NAME_ZOOM, type MarkFrame } from '../render/marks';
import { drawPluginMarks } from '../render/pluginMarks';
import { canvasOf, ctxOf } from './galleryHelper';

type Ctx = CanvasRenderingContext2D;

/** 整张地图:画在 c 上,1 世界单位 = s 像素(s = 2 时放大的一片不糊) */
export interface BigMap {
  c: HTMLCanvasElement;
  s: number;
  W: number;
  H: number;
}

/** 面板截图(和网站侧栏上的插件卡一样,cssW 宽、cssH 高) */
export interface PanelPic {
  img: CanvasImageSource;
  cssW: number;
  cssH: number;
}

export interface PicSpec {
  /** 一张底图裁 r(null = 整张);或者左右对比:两半各一张裁好的(cropCanvas),标「不装」「装上」 */
  base: { big: BigMap; r: PicRect | null } | { halves: [HTMLCanvasElement, HTMLCanvasElement] };
  marks?: { layers: readonly MarkLayer[]; mesh: Mesh; year?: number };
  /** 网站替插件框的一片(世界坐标,x1 可以出右边) */
  box?: { x0: number; y0: number; x1: number; y1: number };
  /** 带名字的红点(推演插件的都城、替工具插件点的城) */
  tags?: { x: number; y: number; name: string }[];
  tagSize?: 'l' | 'm' | 's';
  legend?: LegendPlan;
  /** 右上角的年份 */
  year?: string;
  subtitle?: Subtitle;
  panel?: PanelPic;
}

const FONT = MARK_FONT;
const INK = '#1d1d1f';
const INK_2 = '#6e6e73';

/** 世界坐标 → 这张图上的坐标(东西照接缝挪到离画面正中最近的一份) */
export function picFrame(r: PicRect | null, W: number, H: number): MarkFrame {
  const rr = r ?? { x: 0, y: 0, w: W, h: H };
  const s = PIC_W / rr.w;
  return { pt: (wx, wy) => [(wx - rr.x) * s, (wy - rr.y) * s], period: W * s, win: [0, PIC_W], w: PIC_W, h: PIC_H, k: NAME_ZOOM, textK: 1, cut: 0 };
}

function picPt(f: MarkFrame, wx: number, wy: number): [number, number] {
  const p = f.pt(wx, wy)!;
  const k = Math.round((PIC_W / 2 - p[0]) / f.period);
  return [p[0] + k * f.period, p[1]];
}

/** big 里 r 那一片画到 (dx, dy, dw, dh);东西跨过接缝的分两段画 */
function drawCrop(ctx: Ctx, big: BigMap, r: PicRect | null, dx: number, dy: number, dw: number, dh: number) {
  const { c, s, W } = big;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (!r) {
    ctx.drawImage(c, dx, dy, dw, dh);
    return;
  }
  const x0 = ((r.x % W) + W) % W;
  const first = Math.min(r.w, W - x0);
  ctx.drawImage(c, x0 * s, r.y * s, first * s, r.h * s, dx, dy, (first / r.w) * dw, dh);
  if (first < r.w) ctx.drawImage(c, 0, r.y * s, (r.w - first) * s, r.h * s, dx + (first / r.w) * dw, dy, ((r.w - first) / r.w) * dw, dh);
}

/** big 里 r 那一片裁成 w×h 的一张(左右对比时先裁好,大图马上清掉) */
export function cropCanvas(big: BigMap, r: PicRect | null, w: number, h: number): HTMLCanvasElement {
  const c = canvasOf(w, h);
  drawCrop(ctxOf(c), big, r, 0, 0, w, h);
  return c;
}

/** 画一张图:底图 → 框 → 标注 → 国名 → 图例 → 年份 → 字幕 → 面板 */
export function drawPicture(kind: PicKind, spec: PicSpec): HTMLCanvasElement {
  const c = canvasOf(PIC_W, PIC_H);
  const ctx = ctxOf(c);
  ctx.fillStyle = '#e9e4d6';
  ctx.fillRect(0, 0, PIC_W, PIC_H);
  const b = spec.base;
  let f: MarkFrame | null = null;
  if ('halves' in b) {
    const half = PIC_W / 2;
    ctx.drawImage(b.halves[0], 0, 0, half, PIC_H);
    ctx.drawImage(b.halves[1], half, 0, half, PIC_H);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(half - 1.5, 0, 3, PIC_H);
    // 封面显示得小,「不装」「装上」放大一号
    const big = kind === 'card';
    chip(ctx, '不装', 18, 18, 'dark', false, big);
    chip(ctx, '装上', half + 18, 18, 'dark', false, big);
  } else {
    drawCrop(ctx, b.big, b.r, 0, 0, PIC_W, PIC_H);
    f = picFrame(b.r, b.big.W, b.big.H);
  }
  if (f && spec.box) drawBox(ctx, f, spec.box);
  if (f && spec.marks) drawPluginMarks(ctx, spec.marks.layers, f, spec.marks.mesh, spec.marks.year);
  if (f && spec.tags?.length) drawTags(ctx, f, spec.tags, spec.tagSize ?? 'm');
  if (spec.legend) drawLegend(ctx, spec.legend);
  if (spec.year) {
    const right = spec.panel ? PIC_W - panelBox(kind).w - panelBox(kind).m - 16 : PIC_W - 24;
    chip(ctx, spec.year, right, 22, 'light', true);
  }
  if (spec.subtitle) drawSubtitle(ctx, spec.subtitle);
  if (spec.panel) drawPanel(ctx, kind, spec.panel);
  return c;
}

function roundBox(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, shadow = true) {
  ctx.save();
  if (shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.18)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

/** 小牌子:dark = 深底白字(「不装」「装上」),light = 白底黑字(年份);right = x 是右边 */
function chip(ctx: Ctx, text: string, x: number, y: number, look: 'dark' | 'light', right = false, big = false) {
  ctx.font = `600 ${look === 'dark' ? (big ? 28 : 20) : 21}px ${FONT}`;
  const w = ctx.measureText(text).width + (look === 'dark' ? (big ? 32 : 26) : 34);
  const h = look === 'dark' ? (big ? 50 : 38) : 44;
  const left = right ? x - w : x;
  roundBox(ctx, left, y, w, h, look === 'dark' ? 8 : 12, look === 'dark' ? 'rgba(28,28,30,0.78)' : 'rgba(255,255,255,0.94)', look === 'light');
  ctx.fillStyle = look === 'dark' ? '#fff' : INK;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, left + w / 2, y + h / 2 + 1);
}

/** 网站替插件框的一片:淡蓝底、白边上压蓝色虚线 */
function drawBox(ctx: Ctx, f: MarkFrame, b: NonNullable<PicSpec['box']>) {
  const s = f.pt(1, 0)![0] - f.pt(0, 0)![0];
  const w = (b.x1 - b.x0) * s;
  const h = (b.y1 - b.y0) * s;
  // 框的正中挪到离画面正中最近的一份
  const [cx, cy] = picPt(f, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  ctx.save();
  ctx.fillStyle = 'rgba(10,132,255,0.12)';
  ctx.fillRect(x0, y0, w, h);
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeRect(x0, y0, w, h);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#0a84ff';
  ctx.setLineDash([12, 7]);
  ctx.strokeRect(x0, y0, w, h);
  ctx.restore();
}

/** dot 是白圈的半径:盖得住地图上那座城的符号 */
const TAG = {
  l: { font: 34, dot: 14, padX: 18, h: 64, gap: 12, r: 10 },
  m: { font: 22, dot: 13, padX: 13, h: 44, gap: 9, r: 8 },
  s: { font: 17, dot: 9, padX: 10, h: 34, gap: 7, r: 7 },
};

/** 红点 + 白底大字的名字:名字放在点右边,出画面就放左边 */
function drawTags(ctx: Ctx, f: MarkFrame, tags: NonNullable<PicSpec['tags']>, size: 'l' | 'm' | 's') {
  const t = TAG[size];
  for (const g of tags) {
    const [x, y] = picPt(f, g.x, g.y);
    ctx.font = `700 ${t.font}px ${FONT}`;
    const w = ctx.measureText(g.name).width + 2 * t.padX;
    const right = x + t.dot + t.gap + w <= PIC_W - 8;
    const left = right ? x + t.dot + t.gap : x - t.dot - t.gap - w;
    roundBox(ctx, left, y - t.h / 2, w, t.h, t.r, 'rgba(255,255,255,0.95)');
    ctx.fillStyle = INK;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(g.name, left + t.padX, y + 1);
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 4;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, t.dot, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#e0322b';
    ctx.beginPath();
    ctx.arc(x, y, t.dot - 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 图例:左下角白底卡片;名字、说明,下面渐变条和两头的字,或者一类一行(多过 4 类分两栏) */
function drawLegend(ctx: Ctx, L: LegendPlan) {
  const pad = 18;
  const titleF = `600 20px ${FONT}`;
  const subF = `400 16px ${FONT}`;
  const rowF = `400 17px ${FONT}`;
  ctx.font = titleF;
  let w = ctx.measureText(L.title).width;
  ctx.font = subF;
  if (L.sub) w = Math.max(w, ctx.measureText(L.sub).width);
  const head = 30 + (L.sub ? 24 : 0);
  let body = 0;
  const rows = L.rows ?? [];
  const twoCols = rows.length > 4;
  const perCol = twoCols ? Math.ceil(rows.length / 2) : rows.length;
  let colW = 0;
  if (L.ramp) {
    w = Math.max(w, 300);
    body = 14 + 30 + 4;
  } else if (rows.length) {
    ctx.font = rowF;
    for (const r of rows) colW = Math.max(colW, 28 + ctx.measureText(r.label).width);
    w = Math.max(w, twoCols ? 2 * colW + 24 : colW);
    body = perCol * 32 - 4;
  }
  const h = pad + head + 10 + body + pad;
  const x = 22;
  const y = PIC_H - 22 - h;
  roundBox(ctx, x, y, w + 2 * pad, h, 16, 'rgba(255,255,255,0.94)');
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = titleF;
  ctx.fillText(L.title, x + pad, y + pad + 20);
  if (L.sub) {
    ctx.fillStyle = INK_2;
    ctx.font = subF;
    ctx.fillText(L.sub, x + pad, y + pad + 46);
  }
  const top = y + pad + head + 10;
  if (L.ramp) {
    const g = ctx.createLinearGradient(x + pad, 0, x + pad + w, 0);
    L.ramp.colors.forEach((col, i) => g.addColorStop(L.ramp!.colors.length > 1 ? i / (L.ramp!.colors.length - 1) : 0, col));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(x + pad, top, w, 14, 4);
    ctx.fill();
    ctx.fillStyle = INK;
    ctx.font = `400 16px ${FONT}`;
    ctx.fillText(L.ramp.lo, x + pad, top + 14 + 24);
    ctx.textAlign = 'right';
    ctx.fillText(L.ramp.hi, x + pad + w, top + 14 + 24);
    ctx.textAlign = 'left';
  } else {
    ctx.font = rowF;
    ctx.textBaseline = 'middle';
    rows.forEach((r, i) => {
      const col = twoCols ? Math.floor(i / perCol) : 0;
      const rx = x + pad + col * (colW + 24);
      const ry = top + (i % perCol) * 32 + 14;
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.roundRect(rx, ry - 9, 18, 18, 3);
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.fillText(r.label, rx + 28, ry + 1);
    });
  }
}

/** 一行字放不下时从后面截断加「…」 */
function fit(ctx: Ctx, s: string, max: number): string {
  if (ctx.measureText(s).width <= max) return s;
  const cs = [...s];
  let n = cs.length;
  while (n > 1 && ctx.measureText(`${cs.slice(0, n).join('')}…`).width > max) n--;
  return `${cs.slice(0, n).join('')}…`;
}

/** 编年史的字照宽度折行,最多 lines 行(多的截断) */
function wrap(ctx: Ctx, s: string, first: number, rest: number, lines: number): string[] {
  const cs = [...s];
  const out: string[] = [];
  let at = 0;
  while (at < cs.length && out.length < lines) {
    const max = out.length ? rest : first;
    let n = 1;
    while (at + n < cs.length && ctx.measureText(cs.slice(at, at + n + 1).join('')).width <= max) n++;
    if (out.length === lines - 1 && at + n < cs.length) {
      out.push(fit(ctx, cs.slice(at).join(''), max));
      return out;
    }
    out.push(cs.slice(at, at + n).join(''));
    at += n;
  }
  return out;
}

/** 底下的字幕:深色渐变上白字;第一行「第 N 年」加粗、后面接编年史,第二行和不装比 */
function drawSubtitle(ctx: Ctx, sub: Subtitle) {
  const left = 30;
  const max = PIC_W - 2 * left;
  const big = `400 22px ${FONT}`;
  const bold = `700 22px ${FONT}`;
  const small = `400 17px ${FONT}`;
  ctx.font = bold;
  const yearW = sub.year ? ctx.measureText(sub.year).width + 14 : 0;
  ctx.font = big;
  const textLines = sub.text ? wrap(ctx, sub.text, max - yearW, max, 2) : [];
  const lines = Math.max(sub.year || textLines.length ? 1 : 0, textLines.length);
  const h = lines * 34 + (sub.vs ? 30 : 0);
  if (!h) return;
  const bottom = PIC_H - 22;
  const top = bottom - h;
  const g = ctx.createLinearGradient(0, top - 70, 0, PIC_H);
  g.addColorStop(0, 'rgba(20,20,22,0)');
  g.addColorStop(0.4, 'rgba(20,20,22,0.55)');
  g.addColorStop(1, 'rgba(20,20,22,0.8)');
  ctx.fillStyle = g;
  ctx.fillRect(0, top - 70, PIC_W, PIC_H - top + 70);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  let y = top + 26;
  if (sub.year) {
    ctx.font = bold;
    ctx.fillText(sub.year, left, y);
  }
  ctx.font = big;
  textLines.forEach((l, i) => {
    ctx.fillText(l, i ? left : left + yearW, y);
    y += 34;
  });
  if (!textLines.length && sub.year) y += 34;
  if (sub.vs) {
    ctx.font = small;
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    ctx.fillText(fit(ctx, sub.vs, max), left, y - 6);
  }
}

/** 面板贴在右边的位置:封面约三分之一、详情图一半 */
export function panelBox(kind: PicKind): { w: number; m: number } {
  return kind === 'card' ? { w: 376, m: 24 } : { w: 600, m: 22 };
}

/** 面板:按网站侧栏的样子缩放贴在右上,超出底边的截掉(详情图在底下淡出);浏览器不让画(画布被当成别处来的)就不贴 */
function drawPanel(ctx: Ctx, kind: PicKind, p: PanelPic) {
  const { w, m } = panelBox(kind);
  const k = w / p.cssW;
  const full = p.cssH * k;
  const h = Math.min(full, PIC_H - m);
  const card = canvasOf(Math.ceil(w), Math.ceil(h));
  const x = ctxOf(card);
  try {
    x.save();
    x.beginPath();
    x.roundRect(0, 0, w, full <= h ? h : h + 40, 18);
    x.clip();
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, w, h);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(p.img, 0, 0, w, full);
    x.restore();
    if (full > h && kind === 'map') {
      x.globalCompositeOperation = 'destination-out';
      const fade = 110;
      const g = x.createLinearGradient(0, h - fade, 0, h);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.92)');
      x.fillStyle = g;
      x.fillRect(0, h - fade, w, fade);
      x.globalCompositeOperation = 'source-over';
    }
    x.getImageData(0, 0, 1, 1);
  } catch {
    card.width = card.height = 0;
    return;
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 4;
  ctx.drawImage(card, PIC_W - m - w, m);
  ctx.restore();
  card.width = card.height = 0;
}

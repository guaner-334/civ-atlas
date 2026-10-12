/**
 * 竖版长图的排版和画法(1080 宽,白底黑字,和界面同一套字;地图照屏幕上的画风,由调用方拍好交进来)。
 * 内容(写什么)在 ui/longPlan.ts;这里只管放在哪、多大、怎么画:
 *   layoutLong —— 算出每一样东西的位置(一串画的指令)、整张多高、哪些地方能切开(切成 3:4 时用)
 *   drawLong   —— 按指令画(整张,或者切开的一页)
 *   longPages  —— 切成 1080×1440 的几页:在两节之间或两行之间切,不切断一行字,不把节标题和它的图分开
 * 不碰 DOM:画布、量字的函数都由调用方给。
 */
import type { LongDoc, LongMap } from '../ui/longPlan';
import type { EvType } from '../ui/timelineLayout';
import { wrapText } from './film';

export const LONG_W = 1080;
/** 切成 3:4 时一页多高 */
export const PAGE_H = 1440;
/** 切开的第二页起,顶上留的白边 */
export const PAGE_PAD = 20;
/** 一整张最高多少像素(手机浏览器的画布最多一千六百多万像素;超过了去掉轻的大事) */
export const LONG_MAX_H = 15000;

const PAD_X = 60;
const PAD_T = 76;
const PAD_B = 64;
const CW = LONG_W - 2 * PAD_X;
/** 整个世界的图 2:1;一国的图 3:2 */
export const MAP_W = CW;
export const mapHeight = (m: LongMap) => (m.polity === undefined ? Math.round(MAP_W / 2) : Math.round((MAP_W * 2) / 3));

const INK = '#1d1d1f';
const INK2 = '#6e6e73';
const LINE = 'rgba(60, 60, 67, 0.16)';
const LINE_STRONG = 'rgba(60, 60, 67, 0.36)';
/** 大事前面小圆点的颜色(和时间轴上一样;浅色主题) */
const EV_COLOR: Record<EvType, string> = {
  war: '#e0443a',
  dynasty: '#3478d4',
  found: '#2e9a58',
  empire: '#c4870f',
  assim: '#8d5bcc',
  faith: '#1b97a6',
  order: '#007aff',
};

export type LongOp =
  /** 一行字;y = 这一行的中线 */
  | { t: 'text'; x: number; y: number; s: string; size: number; weight: number; color: string; spacing?: number }
  | { t: 'rule'; y: number; color: string }
  | { t: 'dot'; x: number; y: number; r: number; color: string }
  /** 第 i 张地图(LongLayout.maps[i]) */
  | { t: 'map'; i: number; x: number; y: number; w: number; h: number }
  | { t: 'flag'; x: number; y: number; w: number; h: number };

export interface LongLayout {
  w: number;
  h: number;
  ops: LongOp[];
  /** 要拍的地图(按出现的先后) */
  maps: LongMap[];
  /** 能切开的地方(y,从小到大) */
  cuts: number[];
  /** 放不下去掉了几条大事 */
  dropped: number;
}

type Measure = (s: string, size: number, weight: number) => number;

/**
 * 排版。measure(字, 字号, 粗细) = 这一行字多宽。
 * 整张高过 maxH 时,从最轻的大事开始去掉(每节末尾写一句还有几件没列)。
 */
export function layoutLong(doc: LongDoc, measure: Measure, maxH = LONG_MAX_H): LongLayout {
  let lay = layoutOnce(doc, measure);
  if (lay.h <= maxH) return lay;
  // 去掉轻的大事:按重要度从轻到重排好,一次去掉一批,直到放得下
  const all: { s: number; r: number; w: number }[] = [];
  doc.sections.forEach((sec, s) => sec.rows.forEach((row, r) => !row.note && all.push({ s, r, w: row.weight })));
  all.sort((a, b) => a.w - b.w || b.s - a.s || b.r - a.r);
  let lo = 0;
  let hi = all.length;
  // 去掉几条才放得下:二分
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (layoutOnce(trimmed(doc, all.slice(0, mid)), measure).h <= maxH) hi = mid;
    else lo = mid + 1;
  }
  lay = layoutOnce(trimmed(doc, all.slice(0, lo)), measure);
  lay.dropped = lo;
  return lay;
}

function trimmed(doc: LongDoc, drop: readonly { s: number; r: number }[]): LongDoc {
  if (!drop.length) return doc;
  const gone = new Set(drop.map((d) => `${d.s}:${d.r}`));
  return {
    ...doc,
    sections: doc.sections.map((sec, s) => {
      const rows = sec.rows.filter((_, r) => !gone.has(`${s}:${r}`));
      const n = sec.rows.length - rows.length;
      if (n) rows.push({ label: '', type: null, text: `这一节还有 ${n} 件大事没列出，导出编年史能看到全部`, note: true, weight: Infinity });
      return { ...sec, rows };
    }),
  };
}

function layoutOnce(doc: LongDoc, measure: Measure): LongLayout {
  const ops: LongOp[] = [];
  const maps: LongMap[] = [];
  const cuts: number[] = [];
  let y = PAD_T;
  // 年份一栏宽 204(圆点 + "2478—2514");设了纪年的年份长("前 2478—前 2400"),按最宽的那个放宽
  let col = 204;
  for (const sec of doc.sections) for (const row of sec.rows) if (row.label) col = Math.max(col, Math.ceil(13 + 14 + measure(row.label, 27, 400) + 8));
  /** 一段字(折行),从 top 往下排;返回排完的底 */
  const para = (text: string, x: number, top: number, width: number, size: number, lh: number, weight: number, color: string, spacing = 0) => {
    const lines = wrapText((s) => measure(s, size, weight) + spacing * Array.from(s).length, text, width, Infinity);
    lines.forEach((s, i) => ops.push({ t: 'text', x, y: top + (i + 0.5) * size * lh, s, size, weight, color, spacing }));
    return top + lines.length * size * lh;
  };
  const map = (m: LongMap, top: number) => {
    const h = mapHeight(m);
    ops.push({ t: 'map', i: maps.length, x: PAD_X, y: top, w: MAP_W, h });
    maps.push(m);
    return top + h;
  };

  // 开头:国旗 + 标题(一国)/ 标题
  if (doc.flag) {
    const fw = 132;
    const fh = 90;
    const tx = PAD_X + fw + 28;
    const lines = wrapText((s) => measure(s, 76, 700) + Array.from(s).length, doc.title, LONG_W - PAD_X - tx, Infinity);
    const th = lines.length * 76 * 1.15;
    const hh = Math.max(fh, th);
    ops.push({ t: 'flag', x: PAD_X, y: y + (hh - fh) / 2, w: fw, h: fh });
    para(doc.title, tx, y + (hh - th) / 2, LONG_W - PAD_X - tx, 76, 1.15, 700, INK, 1);
    y += hh;
  } else y = para(doc.title, PAD_X, y, CW, 76, 1.15, 700, INK, 1);
  y = para(doc.lead, PAD_X, y + 20, CW, 32, 1.55, 400, INK2);
  if (doc.lead2) y = para(doc.lead2, PAD_X, y + 6, CW, 28, 1.55, 400, INK2);
  y = map(doc.head, y + 40);
  y = para(doc.headCap, PAD_X, y + 16, CW, 28, 1.5, 400, INK2);

  for (const sec of doc.sections) {
    y += 104;
    cuts.push(y);
    y = para(sec.title, PAD_X, y, CW, 50, 1.2, 700, INK);
    if (sec.map) y = map(sec.map, y + 30);
    y = para(sec.cap, PAD_X, y + 16, CW, 28, 1.5, 400, INK2);
    if (!sec.rows.length) continue;
    y += 30;
    for (const row of sec.rows) {
      cuts.push(y);
      ops.push({ t: 'rule', y: y + 0.5, color: LINE });
      const top = y + 1 + 20;
      // 年份一栏:小圆点 + 年份(27 号字,行高 46)
      if (row.type) ops.push({ t: 'dot', x: PAD_X + 6.5, y: top + 16.5 + 6.5, r: 6.5, color: EV_COLOR[row.type] });
      if (row.label) ops.push({ t: 'text', x: PAD_X + 13 + 14, y: top + 23, s: row.label, size: 27, weight: 400, color: INK2 });
      const bottom = para(row.text, PAD_X + col + 22, top, CW - col - 22, 31, 1.48, 400, row.note ? INK2 : INK);
      y = Math.max(bottom, top + 46) + 21;
    }
  }

  // 结尾
  y += 104;
  cuts.push(y);
  ops.push({ t: 'rule', y: y + 0.5, color: LINE_STRONG });
  y += 1 + 34;
  const foot = `${doc.foot.bold}${doc.foot.rest}`;
  const lines = wrapText((s) => measure(s, 26, 400), foot, CW, Infinity);
  // 第一行开头的标题加粗(标题本身太长折了行的,只加粗第一行里那一截)
  let bold = doc.foot.bold;
  lines.forEach((s, i) => {
    const cy = y + (i + 0.5) * 26 * 1.65;
    if (i === 0 && bold && s.startsWith(bold)) {
      ops.push({ t: 'text', x: PAD_X, y: cy, s: bold, size: 26, weight: 600, color: INK });
      ops.push({ t: 'text', x: PAD_X + measure(bold, 26, 600), y: cy, s: s.slice(bold.length), size: 26, weight: 400, color: INK2 });
      bold = '';
    } else ops.push({ t: 'text', x: PAD_X, y: cy, s, size: 26, weight: 400, color: INK2 });
  });
  y += lines.length * 26 * 1.65;
  y = para(doc.foot.line2, PAD_X, y, CW, 26, 1.65, 400, INK2);
  y += PAD_B;
  return { w: LONG_W, h: Math.ceil(y), ops, maps, cuts, dropped: 0 };
}

/** 切成几页:[起, 止)(长图上的 y)。尽量切在节与节之间;一节放不下才切在两行之间;实在没有能切的地方硬切 */
export function longPages(lay: LongLayout): [number, number][] {
  const out: [number, number][] = [];
  let a = 0;
  while (a < lay.h) {
    const room = PAGE_H - (out.length ? PAGE_PAD : 0);
    if (lay.h - a <= room) {
      out.push([a, lay.h]);
      break;
    }
    let b = -1;
    for (const c of lay.cuts) if (c > a && c - a <= room) b = c;
    if (b < 0) b = a + room;
    out.push([a, b]);
    a = b;
  }
  return out;
}

/** 画布上量字 */
export function canvasMeasureFont(ctx: CanvasRenderingContext2D, font: string): Measure {
  const cache = new Map<string, number>();
  return (s, size, weight) => {
    const k = `${size}|${weight}|${s}`;
    let w = cache.get(k);
    if (w === undefined) {
      ctx.font = `${weight} ${size}px ${font}`;
      cache.set(k, (w = ctx.measureText(s).width));
    }
    return w;
  };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * 画长图上 [from, to) 这一段,画在画布的 top 处(整张:from = 0、top = 0;切开的一页:顶上留白边)。
 * maps[i] = 第 i 张地图(还没拍好 = null,先画一块浅灰);flag = 国旗(一国版)
 */
export function drawLong(
  ctx: CanvasRenderingContext2D,
  lay: LongLayout,
  font: string,
  maps: readonly (CanvasImageSource | null)[],
  flag: CanvasImageSource | null,
  from = 0,
  to = lay.h,
  top = 0,
) {
  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.beginPath();
  ctx.rect(0, top, LONG_W, to - from);
  ctx.clip();
  ctx.translate(0, top - from);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (const op of lay.ops) {
    // 不在这一段里的不画
    const y0 = op.t === 'map' || op.t === 'flag' ? op.y : op.t === 'text' ? op.y - op.size : op.y - 8;
    const y1 = op.t === 'map' || op.t === 'flag' ? op.y + op.h : op.t === 'text' ? op.y + op.size : op.y + 8;
    if (y1 < from || y0 > to) continue;
    switch (op.t) {
      case 'text':
        ctx.font = `${op.weight} ${op.size}px ${font}`;
        ctx.fillStyle = op.color;
        if (op.spacing) {
          // 字距(标题):一个字一个字排
          let x = op.x;
          for (const ch of Array.from(op.s)) {
            ctx.fillText(ch, x, op.y);
            x += ctx.measureText(ch).width + op.spacing;
          }
        } else ctx.fillText(op.s, op.x, op.y);
        break;
      case 'rule':
        ctx.fillStyle = op.color;
        ctx.fillRect(PAD_X, op.y - 0.5, CW, 1);
        break;
      case 'dot':
        ctx.fillStyle = op.color;
        ctx.beginPath();
        ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'map': {
        const img = maps[op.i];
        ctx.save();
        roundRect(ctx, op.x, op.y, op.w, op.h, 18);
        ctx.clip();
        if (img) ctx.drawImage(img, op.x, op.y, op.w, op.h);
        else {
          ctx.fillStyle = '#f2f2f4';
          ctx.fillRect(op.x, op.y, op.w, op.h);
        }
        ctx.restore();
        // 一圈细边(白底上看得出图的边)
        roundRect(ctx, op.x - 0.5, op.y - 0.5, op.w + 1, op.h + 1, 18.5);
        ctx.strokeStyle = LINE;
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
      }
      case 'flag':
        ctx.save();
        roundRect(ctx, op.x, op.y, op.w, op.h, 8);
        ctx.clip();
        if (flag) ctx.drawImage(flag, op.x, op.y, op.w, op.h);
        else {
          ctx.fillStyle = '#f2f2f4';
          ctx.fillRect(op.x, op.y, op.w, op.h);
        }
        ctx.restore();
        roundRect(ctx, op.x - 0.5, op.y - 0.5, op.w + 1, op.h + 1, 8.5);
        ctx.strokeStyle = LINE_STRONG;
        ctx.lineWidth = 1;
        ctx.stroke();
        break;
    }
  }
  ctx.restore();
}

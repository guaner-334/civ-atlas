/**
 * 故事长图的排版和画法(1080 宽,白底黑字,和界面同一套字;地图照屏幕上的画风,由调用方拍好交进来)。
 * 内容(写什么)在 ui/longPlan.ts,写成这里的 LongDoc 交进来;这里只管放在哪、多大、怎么画:
 *   layoutLong —— 算出每一样东西的位置(一串画的指令)、整张多高、哪些地方能切开(切成 3:4 时用)
 *   drawLong   —— 按指令画(整张,或者切开的一页)
 *   longPages  —— 切成 1080×1440 的几页:在两段之间或两件大事之间切,不切断一行字,不把段标题和它的图分开
 * 每段:段标题(右边"第几段 / 共几段")、地图、一句话、AI 写的段落(左边一道灰线,开头一个"AI 写"小标签,底下出处)、
 * 几件大事(一条竖线串起来,圆点颜色和时间轴上一样,年份在上、事情在下)、没列出的还有几件。
 * 结尾:一道线、标题和种子、架空声明;最底下一条浅灰的带子写网站名和网址(能关)。
 * 不碰 DOM:画布、量字的函数都由调用方给。
 */
import type { EvType } from './eventTypes';
import { OUTRO_URL, wrapText } from './film';

// 长图的内容:写什么由 ui/longPlan.ts 的 longDoc 按这几样写好交进来,这里照着排版

/** 一张地图:拍哪一年;一国版裁到这一国、描红边 */
export interface LongMap {
  year: number;
  polity?: number;
}

export interface LongRow {
  /** "第 1199 年""第 2478—2514 年";说明行 = '' */
  label: string;
  /** 小圆点的颜色(和时间轴上一样);说明行 = null(灰点) */
  type: EvType | null;
  text: string;
  /** 说明行(灰字,没有年份) */
  note?: boolean;
  /** 放不下时先去掉轻的(timelineLayout 的 entryWeight) */
  weight: number;
}

export interface LongSection {
  /** "第 500—999 年" */
  title: string;
  /** 右上角"1 / 6" */
  no: string;
  map: LongMap | null;
  cap: string;
  /** AI 写的段落和出处("摘自《九州通史》第三章") */
  ai: { text: string; src: string } | null;
  rows: LongRow[];
  /** 这一段还有几件大事没列出 */
  more: number;
}

export interface LongDoc {
  title: string;
  /** 一国版的国旗(那一国最后一年的那一面) */
  flag: { polity: number; year: number } | null;
  lead: string;
  /** 一国版:历代国号 */
  lead2: string | null;
  head: LongMap;
  headCap: string;
  /** 一段多少年 */
  span: number;
  sections: LongSection[];
  /** 结尾那句:标题、种子、架空声明 */
  foot: string;
  /** 最底下一条网站名和网址 */
  brand: boolean;
}

export const LONG_W = 1080;
/** 切成 3:4 时一页多高 */
export const PAGE_H = 1440;
/** 切开的第二页起,顶上留的白边 */
export const PAGE_PAD = 20;
/** 一整张最高多少像素(手机浏览器的画布最多一千六百多万像素;超过了去掉轻的大事) */
export const LONG_MAX_H = 15000;
/** 最底下那条带子:网站名、网址 */
export const BRAND_NAME = '文明与地图';
export const BRAND_URL = OUTRO_URL;

const PAD_X = 60;
const PAD_T = 76;
const CW = LONG_W - 2 * PAD_X;
/** 整个世界的图 2:1;一国的图 3:2 */
export const MAP_W = CW;
export const mapHeight = (m: LongMap) => (m.polity === undefined ? Math.round(MAP_W / 2) : Math.round((MAP_W * 2) / 3));

const INK = '#1d1d1f';
const INK2 = '#6e6e73';
const INK3 = '#aeaeb2';
const LINE = 'rgba(60, 60, 67, 0.16)';
const LINE_STRONG = 'rgba(60, 60, 67, 0.36)';
/** 大事串起来的竖线、说明行的灰点 */
const THREAD = '#e5e5ea';
const NOTE_DOT = '#d1d1d6';
/** AI 写的段落:左边那道线、小标签的底 */
const AI_BAR = '#d1d1d6';
const AI_TAG = '#f2f2f7';
const BRAND_BG = '#f5f5f7';
/** 大事前面小圆点的颜色(和时间轴上一样;浅色主题) */
const EV_COLOR: Record<EvType, string> = {
  war: '#e0443a',
  dynasty: '#3478d4',
  found: '#2e9a58',
  empire: '#c4870f',
  assim: '#8d5bcc',
  faith: '#1b97a6',
  era: '#a2652d',
  thought: '#b02a6a',
  calamity: '#66707c',
  order: '#007aff',
};
const AI_TAG_TEXT = 'AI 写';

export type LongOp =
  /** 一行字;y = 这一行的中线;align = right 时 x 是右边 */
  | { t: 'text'; x: number; y: number; s: string; size: number; weight: number; color: string; spacing?: number; align?: 'right' }
  | { t: 'rule'; y: number; color: string }
  | { t: 'dot'; x: number; y: number; r: number; color: string }
  /** 一块颜色(圆角 r):竖线、小标签的底、最底下的带子 */
  | { t: 'rect'; x: number; y: number; w: number; h: number; r: number; color: string }
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
 * 整张高过 maxH 时(每段大事选了"全部"),从最轻的大事开始去掉(那一段末尾写一句还有几件没列)。
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
      return { ...sec, rows, more: sec.more + sec.rows.length - rows.length };
    }),
  };
}

/** 字的中线和基线差多少(中文字体大约 0.38 个字高):两种字号的字按基线对齐时用 */
const MID_TO_BASE = 0.38;
/** 折行时代表"第一行前面空出一块"的字(AI 段落开头的小标签);measure 量它 = 空出的宽度 */
const INDENT = '';

function layoutOnce(doc: LongDoc, measure: Measure): LongLayout {
  const ops: LongOp[] = [];
  const maps: LongMap[] = [];
  const cuts: number[] = [];
  let y = PAD_T;
  /**
   * 一段字(折行),从 top 往下排;返回排完的底。indent = 第一行前面空出多少(AI 段落的小标签);
   * 返回第一行的中线(放小标签用)
   */
  const para = (text: string, x: number, top: number, width: number, size: number, lh: number, weight: number, color: string, spacing = 0, indent = 0) => {
    const m = (s: string) => {
      const plain = s.replaceAll(INDENT, '');
      return measure(plain, size, weight) + spacing * Array.from(plain).length + (s.length !== plain.length ? indent : 0);
    };
    const lines = wrapText(m, indent ? INDENT + text : text, width, Infinity);
    lines.forEach((s, i) => {
      const plain = s.replaceAll(INDENT, '');
      ops.push({ t: 'text', x: x + (plain.length !== s.length ? indent : 0), y: top + (i + 0.5) * size * lh, s: plain, size, weight, color, spacing });
    });
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
    y += 96;
    // 切成 3:4 时在段标题上面 72 像素处切:新的一页顶上留出白边,预览里每页右上角的"第几张"也不压住"1 / 6"
    cuts.push(y - 72);
    // 段标题;右边"1 / 6"和标题第一行按基线对齐
    const noW = measure(sec.no, 28, 400);
    const top = y;
    y = para(sec.title, PAD_X, y, CW - noW - 20, 52, 1.2, 700, INK);
    ops.push({ t: 'text', x: LONG_W - PAD_X, y: top + 0.6 * 52 + MID_TO_BASE * (52 - 28), s: sec.no, size: 28, weight: 400, color: INK3, align: 'right' });
    if (sec.map) y = map(sec.map, y + 28);
    y = para(sec.cap, PAD_X, y + 14, CW, 28, 1.5, 400, INK2);
    if (sec.ai) {
      // AI 写的段落:左边一道 4 像素的灰线,字从 30 像素处起;开头一个小标签
      y += 30;
      const a = y;
      const tagW = measure(AI_TAG_TEXT, 22, 600) + 24;
      const tagH = 22 * 1.5 + 4;
      const x = PAD_X + 30;
      const mid = y + 0.5 * 31 * 1.65;
      ops.push({ t: 'rect', x, y: mid + 1 - tagH / 2, w: tagW, h: tagH, r: 8, color: AI_TAG });
      ops.push({ t: 'text', x: x + 12, y: mid + 1, s: AI_TAG_TEXT, size: 22, weight: 600, color: INK2 });
      y = para(sec.ai.text, x, y, CW - 30, 31, 1.65, 400, INK, 0, tagW + 12);
      y = para(sec.ai.src, x, y + 8, CW - 30, 24, 1.5, 400, INK3);
      ops.push({ t: 'rect', x: PAD_X, y: a, w: 4, h: y - a, r: 0, color: AI_BAR });
    }
    if (sec.rows.length) {
      y += 34;
      sec.rows.forEach((row, j) => {
        cuts.push(y);
        const top = y;
        let t = top + 2;
        if (row.label) {
          ops.push({ t: 'text', x: PAD_X + 44, y: top + 20, s: row.label, size: 26, weight: 600, color: INK2 });
          t = top + 40 + 2;
        }
        const bottom = row.note ? para(row.text, PAD_X + 44, t, CW - 44, 28, 1.5, 400, INK2) : para(row.text, PAD_X + 44, t, CW - 44, 32, 1.5, 400, INK);
        if (j < sec.rows.length - 1) {
          // 串到下一件的竖线:从这个圆点穿出,到下一件的圆点上面一点
          ops.push({ t: 'rect', x: PAD_X + 7, y: top + 22, w: 2, h: bottom + 30 + 8 - (top + 22), r: 0, color: THREAD });
          y = bottom + 30;
        } else y = bottom;
        // 圆点最后画,压在竖线上面
        ops.push({ t: 'dot', x: PAD_X + 8, y: top + 20, r: 8, color: row.type ? EV_COLOR[row.type] : NOTE_DOT });
      });
    }
    if (sec.more > 0) {
      y += 22;
      y = para(`这一段还有 ${sec.more} 件大事没列出，导出编年史能看到全部`, PAD_X + 44, y, CW - 44, 26, 1.5, 400, INK3);
    }
  }

  // 结尾:一道线、标题和种子、架空声明
  y += 96;
  cuts.push(y);
  ops.push({ t: 'rule', y: y + 0.5, color: LINE_STRONG });
  y += 1 + 34;
  y = para(doc.foot, PAD_X, y, CW, 26, 1.65, 400, INK2);
  if (doc.brand) {
    // 最底下一条浅灰的带子:左边网站名、右边网址
    y += 56;
    ops.push({ t: 'rect', x: 0, y, w: LONG_W, h: 116, r: 0, color: BRAND_BG });
    ops.push({ t: 'text', x: PAD_X, y: y + 58, s: BRAND_NAME, size: 30, weight: 700, color: INK, spacing: 1 });
    ops.push({ t: 'text', x: LONG_W - PAD_X, y: y + 58, s: BRAND_URL, size: 30, weight: 400, color: INK2, align: 'right' });
    y += 116;
  } else y += 64;
  return { w: LONG_W, h: Math.ceil(y), ops, maps, cuts, dropped: 0 };
}

/** 切成几页:[起, 止)(长图上的 y)。尽量切在段与段之间;一段放不下才切在两件大事之间;实在没有能切的地方硬切 */
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

/** 一样东西占长图上的哪一截(不在要画的那一段里的不画) */
function opSpan(op: LongOp): [number, number] {
  switch (op.t) {
    case 'map':
    case 'flag':
    case 'rect':
      return [op.y, op.y + op.h];
    case 'text':
      return [op.y - op.size, op.y + op.size];
    default:
      return [op.y - 8, op.y + 8];
  }
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
  for (const op of lay.ops) {
    const [y0, y1] = opSpan(op);
    if (y1 < from || y0 > to) continue;
    switch (op.t) {
      case 'text':
        ctx.font = `${op.weight} ${op.size}px ${font}`;
        ctx.fillStyle = op.color;
        if (op.spacing) {
          // 字距(标题):一个字一个字排
          ctx.textAlign = 'left';
          let x = op.x;
          for (const ch of Array.from(op.s)) {
            ctx.fillText(ch, x, op.y);
            x += ctx.measureText(ch).width + op.spacing;
          }
        } else {
          ctx.textAlign = op.align ?? 'left';
          ctx.fillText(op.s, op.x, op.y);
        }
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
      case 'rect':
        ctx.fillStyle = op.color;
        if (op.r) {
          roundRect(ctx, op.x, op.y, op.w, op.h, op.r);
          ctx.fill();
        } else ctx.fillRect(op.x, op.y, op.w, op.h);
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

/**
 * 回放视频的一帧:地图(MapShot 画好的一张)放到画面里,再写上年份、大事字幕、片头片尾的卡片。
 * 数值按成片的像素写(横屏 1920×1080、竖屏 1080×1920);面板里的预览是把整帧缩小画。
 *
 *   横屏:地图铺满(整张地图是 2:1,上下各留一条和地图纸边同色的边);左上角一张小卡写标题和年份,
 *        下方正中一条字幕,一次一条。
 *   竖屏:浅色底,上一栏标题和年份,中间地图(整张地图:满宽一条 1080×540;一块:正方形),下一栏最近几条大事(新的在上)。
 *        上下右留出短视频平台的标签栏、按钮、标题会盖住的地方。
 *   片头:第一年的地图压暗一点,中间一张卡片写标题和年份范围,最后半秒淡出;片尾:最后一年,卡片淡入,写怎么来的和网址。
 *
 * 只用 2D 画布,不碰 DOM(字体名由调用方给)。
 */
import {
  FADE_FRAMES,
  captionAt,
  recentRows,
  frameYear,
  type CaptionSlot,
  type FilmArea,
  type FilmClock,
  type FilmEvent,
  type FilmShape,
} from '../ui/filmPlan';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const INK = '#1d1d1f';
const INK2 = '#6e6e73';
const INK3 = '#aeaeb2';
const PANEL = '#f5f5f7';
const CARD = 'rgba(248, 248, 250, 0.86)';
const CARD_V = 'rgba(248, 248, 250, 0.9)';
const SHADE = 'rgba(20, 20, 24, 0.22)';

/** 片尾卡片上的几行 */
export const OUTRO_MADE = '用「文明与地图」推演生成';
export const OUTRO_URL = 'atlas.gerdor.top';
export const OUTRO_NOTE = '模拟生成的架空世界，不是真实地图';

export interface FilmLook {
  shape: FilmShape;
  area: FilmArea;
  clock: FilmClock;
  /** 标题(空 = 只写年份) */
  title: string;
  /** 片头那一行:"第 899 年到第 3000 年" */
  range: string;
  captions: boolean;
  cards: boolean;
  /** 横屏字幕(captionSlots 排好的)、竖屏下一栏用的全部大事 */
  slots: readonly CaptionSlot[];
  events: readonly FilmEvent[];
  /** 界面字体(CSS font-family) */
  font: string;
  /** 横屏整张地图上下两条边的颜色(不给 = 取地图最上面一行的颜色) */
  band?: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 地图在画面里的位置(成片像素) */
export function filmMapRect(shape: FilmShape, area: FilmArea): Rect {
  if (shape === 'land') return area === 'whole' ? { x: 0, y: 60, w: 1920, h: 960 } : { x: 0, y: 0, w: 1920, h: 1080 };
  return area === 'whole' ? { x: 0, y: 470, w: 1080, h: 540 } : { x: 0, y: 340, w: 1080, h: 1080 };
}

/** 竖屏下一栏列几条:整张地图 5 条,一块 3 条 */
export const filmRowCount = (area: FilmArea) => (area === 'whole' ? 5 : 3);

const font = (look: FilmLook, size: number, weight = 400) => `${weight} ${size}px ${look.font}`;

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** 毛玻璃卡片的底(浅底、软阴影) */
function card(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string, shadow: { y: number; blur: number; a: number }) {
  ctx.save();
  ctx.shadowColor = `rgba(0, 0, 0, ${shadow.a})`;
  ctx.shadowBlur = shadow.blur;
  ctx.shadowOffsetY = shadow.y;
  ctx.fillStyle = fill;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  ctx.restore();
}

/** 一行字,top = 行框的上沿(行高 lh × 字号),竖直居中 */
function line(ctx: Ctx, s: string, x: number, top: number, size: number, lh: number) {
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, top + (size * lh) / 2);
}

/** 按宽度断成几行(中文按字断,数字、外文词不拆开;标点不放行首);超过 max 行,最后一行末尾写省略号 */
export function wrapText(measure: (s: string) => number, text: string, width: number, max: number): string[] {
  const toks = text.match(/[0-9A-Za-z.%]+|\s+|[^]/gu) ?? [];
  const lines: string[] = [];
  let cur: string[] = [];
  const str = (a: readonly string[]) => a.join('');
  for (const tk of toks) {
    if (cur.length && measure(str(cur) + tk) > width) {
      if (lines.length === max - 1) {
        let t = str(cur);
        while (t && measure(`${t}…`) > width) t = t.slice(0, -1);
        lines.push(`${t}…`);
        return lines;
      }
      if (/^[，。、；：）」』！？]/.test(tk) && cur.length > 1) {
        const last = cur.pop()!;
        lines.push(str(cur).trimEnd());
        cur = [last, tk];
      } else {
        lines.push(str(cur).trimEnd());
        cur = /^\s+$/.test(tk) ? [] : [tk];
      }
    } else cur.push(tk);
  }
  if (cur.length) lines.push(str(cur));
  return lines;
}

/** 太长的一句从后往前去掉几截(按中文逗号),最后还放不下的截断加省略号 */
export function fitClauses(measure: (s: string) => number, text: string, width: number): string {
  if (measure(text) <= width) return text;
  const parts = text.split('，');
  while (parts.length > 1) {
    parts.pop();
    const t = parts.join('，');
    if (measure(t) <= width) return t;
  }
  let t = parts[0];
  while (t && measure(`${t}…`) > width) t = t.slice(0, -1);
  return `${t}…`;
}

/** 片头卡片多不透明:停 1.5 秒,最后半秒淡出 */
function introAlpha(c: FilmClock, f: number): number {
  if (!c.intro || f >= c.intro) return 0;
  const fade = Math.min(15, c.intro);
  return Math.min(1, (c.intro - f) / fade);
}

/** 片尾卡片多不透明:开头 0.4 秒淡入 */
function outroAlpha(c: FilmClock, f: number): number {
  const at = c.intro + c.play;
  if (!c.outro || f < at) return 0;
  return Math.min(1, (f - at + 1) / 12);
}

/**
 * 画第 f 帧:map = 这一帧的地图(大小 = filmMapRect),画在 ctx 的 [0, W] × [0, H] 上。
 * map = null:只画地图以外的部分(字、卡片、竖屏上下两栏),地图那一块留空 —— 拍框里一块时,屏幕上的框里盖这一层,透出底下的地图
 */
export function drawFilmFrame(ctx: Ctx, look: FilmLook, f: number, map: CanvasImageSource | null): void {
  const { shape, area, clock } = look;
  const W = shape === 'land' ? 1920 : 1080;
  const H = shape === 'land' ? 1080 : 1920;
  const r = filmMapRect(shape, area);
  ctx.save();
  if (map) {
    ctx.fillStyle = shape === 'land' ? look.band ?? PANEL : PANEL;
    ctx.fillRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(map, r.x, r.y, r.w, r.h);
  } else {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = shape === 'land' ? look.band ?? PANEL : PANEL;
    ctx.fillRect(0, 0, W, r.y);
    ctx.fillRect(0, r.y + r.h, W, H - r.y - r.h);
  }
  const year = Math.floor(frameYear(clock, f));
  const intro = look.cards ? introAlpha(clock, f) : 0;
  const outro = look.cards ? outroAlpha(clock, f) : 0;
  if (shape === 'land') drawLand(ctx, look, f, year, 1 - Math.max(intro, outro));
  else drawPort(ctx, look, f, year, outro);
  const a = Math.max(intro, outro);
  if (a > 0) {
    ctx.globalAlpha = a;
    ctx.fillStyle = SHADE;
    ctx.fillRect(0, 0, W, H);
    drawTitleCard(ctx, look, intro > 0 ? 'intro' : 'outro', W, H);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** 横屏:左上角年份卡,下方字幕 */
function drawLand(ctx: Ctx, look: FilmLook, f: number, year: number, alpha: number) {
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  const yearText = `第 ${year} 年`;
  ctx.font = font(look, 64, 700);
  // 年份按最宽的那一年留宽度(数字变的时候卡片不忽宽忽窄)
  const widest = `第 ${String(look.clock.to).replace(/\d/g, '0')} 年`;
  let w = Math.max(ctx.measureText(yearText).width, ctx.measureText(widest).width);
  ctx.font = font(look, 28);
  const title = look.title ? fitLine(ctx, look.title, TITLE_MAX_LAND) : '';
  if (title) w = Math.max(w, ctx.measureText(title).width);
  const h = 18 + (look.title ? 28 * 1.3 : 0) + 64 * 1.15 + 20;
  card(ctx, 48, 40, w + 60, h, 22, CARD, { y: 4, blur: 20, a: 0.18 });
  ctx.textAlign = 'left';
  let y = 40 + 18;
  if (title) {
    ctx.fillStyle = INK2;
    ctx.font = font(look, 28);
    line(ctx, title, 78, y, 28, 1.3);
    y += 28 * 1.3;
  }
  ctx.fillStyle = INK;
  ctx.font = font(look, 64, 700);
  line(ctx, yearText, 78, y, 64, 1.15);
  if (look.captions) {
    const cap = captionAt(look.slots, f);
    if (cap) {
      ctx.globalAlpha = alpha * cap.alpha;
      drawCaption(ctx, look, cap.slot);
    }
  }
  ctx.restore();
}

function drawCaption(ctx: Ctx, look: FilmLook, s: CaptionSlot) {
  const size = 38;
  ctx.font = font(look, size, 700);
  const em = ctx.measureText(s.label).width;
  ctx.font = font(look, size);
  const room = 1500 - 68 - em - 22;
  const text = fitClauses((t) => ctx.measureText(t).width, s.text, room);
  const tw = ctx.measureText(text).width;
  const w = 68 + em + 22 + tw;
  const h = 36 + size * 1.4;
  const x = (1920 - w) / 2;
  const y = 1080 - 56 - h;
  card(ctx, x, y, w, h, 20, CARD, { y: 4, blur: 20, a: 0.18 });
  ctx.fillStyle = INK;
  ctx.textAlign = 'left';
  ctx.font = font(look, size, 700);
  line(ctx, s.label, x + 34, y + 18, size, 1.4);
  ctx.font = font(look, size);
  line(ctx, text, x + 34 + em + 22, y + 18, size, 1.4);
}

/** 竖屏:上一栏标题和年份,下一栏最近几条大事 */
function drawPort(ctx: Ctx, look: FilmLook, f: number, year: number, outro: number) {
  const whole = look.area === 'whole';
  ctx.save();
  ctx.textAlign = 'left';
  let y = whole ? 250 : 150;
  if (look.title) {
    ctx.fillStyle = INK2;
    ctx.font = font(look, 34);
    line(ctx, fitLine(ctx, look.title, TITLE_MAX_PORT), 64, y, 34, 1.3);
    y += 34 * 1.3;
  }
  ctx.fillStyle = INK;
  ctx.font = font(look, 88, 700);
  line(ctx, `第 ${year} 年`, 64, y, 88, 1.15);
  // 片头时下一栏还空着;片尾时跟着卡片淡入淡出
  const intro = look.cards && f < look.clock.intro;
  if (look.captions && !intro && outro < 1) {
    const rows = recentRows(look.events, look.clock, f, filmRowCount(look.area));
    const size = whole ? 38 : 30;
    const first = whole ? 44 : 34;
    const emW = whole ? 250 : 236;
    const gap = whole ? 26 : 16;
    const left = 64;
    const textX = left + emW + 14;
    const textW = 1080 - 170 - textX;
    let top = whole ? 1085 : 1452;
    rows.forEach((row, i) => {
      const fs = i === 0 ? first : size;
      const lh = fs * 1.38;
      ctx.save();
      // 新的一行淡入
      const fade = i === 0 && row.age < FADE_FRAMES * 2 ? Math.max(0, (row.age + 1) / (FADE_FRAMES * 2)) : 1;
      ctx.globalAlpha = fade * (1 - outro);
      ctx.fillStyle = i === 0 ? INK : INK2;
      ctx.font = font(look, fs);
      const lines = wrapText((t) => ctx.measureText(t).width, row.text, textW, i === 0 ? 2 : 1);
      ctx.font = font(look, fs, 600);
      line(ctx, row.label, left, top, fs, 1.38);
      ctx.font = font(look, fs);
      lines.forEach((t, k) => line(ctx, t, textX, top + k * lh, fs, 1.38));
      ctx.restore();
      top += lines.length * lh + gap;
    });
  }
  ctx.restore();
}

/** 左上角(横屏)、上一栏(竖屏)的标题最宽多少(竖屏右边留给平台的按钮) */
const TITLE_MAX_LAND = 1000;
const TITLE_MAX_PORT = 1080 - 64 - 170;

/** 一行放不下就截断,末尾加"…"(用 ctx 现在的字体量) */
function fitLine(ctx: Ctx, text: string, maxW: number): string {
  return wrapText((t) => ctx.measureText(t).width, text, maxW, 1)[0] ?? '';
}

/** 片头 / 片尾的卡片(正中) */
function drawTitleCard(ctx: Ctx, look: FilmLook, which: 'intro' | 'outro', W: number, H: number) {
  const land = look.shape === 'land';
  // 横屏 / 竖屏的字号和留白(竖屏卡片定宽 860)
  const S = land
    ? { b: 96, span: 40, spanTop: 10, url: 40, urlTop: 26, note: 28, noteTop: 8, padY: 44, padX: 80, r: 30, fill: CARD, shadow: { y: 4, blur: 20, a: 0.18 } }
    : { b: 104, span: 40, spanTop: 14, url: 42, urlTop: 34, note: 30, noteTop: 10, padY: 56, padX: 40, r: 36, fill: CARD_V, shadow: { y: 6, blur: 30, a: 0.2 } };
  const rows: { text: string; size: number; weight: number; color: string; top: number }[] = [];
  if (look.title) rows.push({ text: look.title, size: S.b, weight: 700, color: INK, top: 0 });
  if (which === 'intro') rows.push({ text: look.range, size: look.title ? S.span : S.b * 0.6, weight: look.title ? 400 : 700, color: look.title ? INK2 : INK, top: look.title ? S.spanTop : 0 });
  else {
    rows.push({ text: OUTRO_MADE, size: S.span, weight: 400, color: INK2, top: look.title ? S.spanTop : 0 });
    rows.push({ text: OUTRO_URL, size: S.url, weight: 600, color: INK, top: S.urlTop });
    rows.push({ text: OUTRO_NOTE, size: S.note, weight: 400, color: INK3, top: S.noteTop });
  }
  // 标题太长(最多 40 个字):字号缩小到放得下,再小就截断加"…",卡片不超出画面
  const maxW = land ? 1920 - 2 * 120 - 2 * S.padX : 1080 - 2 * 60 - 2 * S.padX;
  for (const r of rows) {
    ctx.font = font(look, r.size, r.weight);
    const tw = ctx.measureText(r.text).width;
    if (tw <= maxW) continue;
    r.size = Math.max(Math.floor((r.size * maxW) / tw), Math.round(S.b * 0.45));
    ctx.font = font(look, r.size, r.weight);
    r.text = fitLine(ctx, r.text, maxW);
  }
  const lh = (r: { size: number; weight: number }) => (r.weight === 700 && r.size >= 60 ? r.size * 1.2 : r.size * 1.3);
  let w = 0;
  let h = 0;
  for (const r of rows) {
    ctx.font = font(look, r.size, r.weight);
    w = Math.max(w, ctx.measureText(r.text).width);
    h += r.top + lh(r);
  }
  const cw = land ? w + S.padX * 2 : Math.max(860, w + S.padX * 2);
  const ch = h + S.padY * 2;
  const x = (W - cw) / 2;
  const y = (H - ch) / 2;
  card(ctx, x, y, cw, ch, S.r, S.fill, S.shadow);
  ctx.textAlign = 'center';
  let top = y + S.padY;
  for (const r of rows) {
    top += r.top;
    ctx.fillStyle = r.color;
    ctx.font = font(look, r.size, r.weight);
    line(ctx, r.text, W / 2, top, r.size, lh(r) / r.size);
    top += lh(r);
  }
}

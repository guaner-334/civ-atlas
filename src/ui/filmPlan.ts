/**
 * 回放视频的纯计算部分:放哪一段年份、每一帧是哪一年、字幕排在哪几秒、竖屏下面那一栏列哪几条、文件名。
 * 不碰 DOM,单测直接测(tests/film-plan.test.ts);画面在 render/film.ts,面板在 FilmPanel.tsx。
 *
 * - 时间:30 帧 / 秒。片头 2 秒(停在第一年,标题卡片淡出)、片尾 3 秒(停在最后一年,卡片淡入)都算在时长里;
 *   中间那一段从第一年匀速放到最后一年,速度 = 年数 / 中间的秒数。
 * - 字幕(横屏):编年史"大事",一次一条,停 2 秒,在放到那一年时出现(和前一条撞了往后挪,最多挪 0.6 秒);
 *   同时来好几条挑分量重的(和时间轴上同一处挤了几件事时一样的分量),挤不下的不放。
 *   多年的战争出字幕时还没打完,写"第 2562 年起"和开头一句(由头和出兵),不写得失。
 * - 竖屏下面那一栏:放到的那一年为止最近的几条大事,新的在上;战争打完以前写"2562 起"和开头一句,打完了写"2478—2514"和全文。
 * - 设了纪年(gen/era.ts)的世界,年份、字幕正文里的"第 N 年"都照纪年写("公元前 850 年""前 850 起")。
 * - 字幕按大纲(outlineEvents):照大纲推演推过的每条情节一条字幕,写作者写的那句,比哪件大事都先排;
 *   编年史里对上情节的那件不再另放,情节之间只放头等大事(和导播照大纲放一样稀)。
 */
import type { ChronicleEntry } from '../gen/civ/chronicle';
import type { Civ } from '../gen/civ/types';
import { eraText, yearFull, yearShort, type Era } from '../gen/era';
import { entryWeight, evType, playRate, type EvType } from './timelineLayout';

export type FilmShape = 'land' | 'port';
export type FilmArea = 'whole' | 'region';
export type FilmSeconds = 30 | 60 | 120;

export const FILM_FPS = 30;
/** 片头、片尾各几秒(开着"片头片尾"时) */
export const FILM_INTRO = 2;
export const FILM_OUTRO = 3;
/** 一条字幕停几秒;和前一条撞了最多往后挪几秒 */
export const CAPTION_HOLD = 2;
export const CAPTION_SHIFT = 0.6;
/** 字幕、新的一行淡入淡出几帧 */
export const FADE_FRAMES = 6;

/** 成片的像素:横屏 1920×1080,竖屏 1080×1920 */
export function filmSize(shape: FilmShape): { w: number; h: number } {
  return shape === 'land' ? { w: 1920, h: 1080 } : { w: 1080, h: 1920 };
}

export interface FilmRange {
  from: number;
  to: number;
}

/** 两个快捷年份:有国家以后(最早立国那年 → 最后一年)、全部历史(0 → 最后一年)。没有国家 = 都是全部历史 */
export function filmRanges(civ: Pick<Civ, 'polities' | 'endYear'>): { polities: FilmRange; all: FilmRange } {
  const to = Math.floor(civ.endYear);
  let first = Infinity;
  for (const p of civ.polities) if (p.founded < first) first = p.founded;
  const from = Number.isFinite(first) ? Math.min(to, Math.max(0, Math.floor(first))) : 0;
  return { polities: { from, to }, all: { from: 0, to } };
}

/** 年份范围收拾一下:取整、夹在 [0, end] 里、至少差 1 年 */
export function clampRange(r: FilmRange, end: number): FilmRange {
  const E = Math.max(1, Math.floor(end));
  let from = Math.max(0, Math.min(E - 1, Math.round(r.from)));
  let to = Math.max(0, Math.min(E, Math.round(r.to)));
  if (to <= from) {
    if (from + 1 <= E) to = from + 1;
    else from = to - 1;
  }
  return { from, to };
}

export interface FilmClock {
  from: number;
  to: number;
  /** 一共几帧 */
  frames: number;
  /** 片头、中间、片尾各几帧 */
  intro: number;
  play: number;
  outro: number;
  /** 中间那一段每秒走多少年 */
  rate: number;
}

export function filmClock(range: FilmRange, seconds: number, cards: boolean): FilmClock {
  const frames = Math.max(2, Math.round(seconds * FILM_FPS));
  const intro = cards ? FILM_INTRO * FILM_FPS : 0;
  const outro = cards ? FILM_OUTRO * FILM_FPS : 0;
  const play = Math.max(2, frames - intro - outro);
  const span = Math.max(0, range.to - range.from);
  return { from: range.from, to: range.to, frames: intro + play + outro, intro, play, outro, rate: span / (play / FILM_FPS) };
}

/** 第 f 帧放到哪一年(小数;片头 = 第一年,片尾 = 最后一年) */
export function frameYear(c: FilmClock, f: number): number {
  const i = f - c.intro;
  if (i <= 0) return c.from;
  if (i >= c.play - 1) return c.to;
  return c.from + ((c.to - c.from) * i) / (c.play - 1);
}

/** 放到第 year 年是第几帧(第一个年份不早于它的帧) */
export function yearFrame(c: FilmClock, year: number): number {
  const span = c.to - c.from;
  if (span <= 0) return c.intro;
  const t = Math.max(0, Math.min(1, (year - c.from) / span));
  return c.intro + Math.ceil(t * (c.play - 1) - 1e-9);
}

/** 面板上的一句速度:"每秒约 38 年(屏幕上 1× 是每秒 20 年)" */
export function rateText(rate: number, end: number): string {
  const r = rate >= 10 ? Math.round(rate) : rate >= 1 ? Math.round(rate * 10) / 10 : Math.round(rate * 100) / 100;
  return `每秒约 ${r} 年（屏幕上 1× 是每秒 ${Math.round(playRate(1, end))} 年）`;
}

/** 片长:"0:30""1:00""2:00" */
export function lengthText(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 编年史原文的半角逗号、括号、分号、冒号换成中文标点(字幕、长图里用) */
export function cnPunct(s: string): string {
  return s.replace(/,/g, '\uff0c').replace(/\(/g, '\uff08').replace(/\)/g, '\uff09').replace(/;/g, '\uff1b').replace(/:/g, '\uff1a');
}

// ---------------------------------------------------------------------------
// 大事

export interface FilmEvent {
  /** 编年史里的 id(唯一) */
  id: number;
  type: EvType;
  /** 开始、结束的年份(取整) */
  year: number;
  end: number;
  /** 打到世界最后一年还没打完 */
  ongoing: boolean;
  /** 全文、没打完时写的开头一句(都换成中文标点;不是战争的两个一样) */
  text: string;
  head: string;
  weight: number;
  /** 大纲里的一条情节(text = 作者写的那句) */
  plot?: boolean;
}

/**
 * 这一段年份里的大事(编年史"大事",开始的年份在范围里),按年份排;keep 给了只留它说留的
 * (拍框里一块时:只写框里看得到的国家的)
 */
export function filmEvents(majors: readonly ChronicleEntry[], range: FilmRange, keep?: (e: ChronicleEntry) => boolean, era?: Era | null): FilmEvent[] {
  const out: FilmEvent[] = [];
  for (const e of majors) {
    const year = Math.floor(e.year);
    if (year < range.from || year > range.to) continue;
    if (keep && !keep(e)) continue;
    const text = cnPunct(eraText(e.text, era));
    out.push({
      id: e.id,
      type: evType(e),
      year,
      end: Math.max(year, Math.floor(e.end)),
      ongoing: !!e.ongoing,
      text,
      head: e.head ? cnPunct(eraText(e.head, era)) : text,
      weight: entryWeight(e),
    });
  }
  return out.sort((a, b) => a.year - b.year || a.id - b.id);
}

/** 字幕按大纲时的一条情节:落在哪一年、作者写的那句、编年史里对上的那件(对不上 = null)、在哪个地块(说不出 = −1) */
export interface FilmPlot {
  id: number;
  year: number;
  text: string;
  entry: ChronicleEntry | null;
  cell: number;
}

/** 情节的分量:比哪件大事都重(字幕先排它) */
export const FILM_PLOT_WEIGHT = 1000;
/** 字幕按大纲时,情节之间留哪些大事:分量够得上头等大事的(和导播的头等大事一个门槛) */
export const OUTLINE_KEEP_WEIGHT = 35;

/**
 * 字幕按大纲:这一段年份里的情节(plots 按大纲的先后;编号是负的,不和编年史撞,按大纲的先后从小到大:同一年的几条照大纲的先后放)+ 情节之间的头等大事(对上情节的那件不另放),按年份排
 */
export function outlineEvents(events: readonly FilmEvent[], plots: readonly FilmPlot[], range: FilmRange): FilmEvent[] {
  const told = new Set(plots.flatMap((p) => (p.entry ? [p.entry.id] : [])));
  const out = events.filter((e) => !told.has(e.id) && e.weight >= OUTLINE_KEEP_WEIGHT);
  plots.forEach((p, i) => {
    const year = Math.floor(p.year);
    if (year < range.from || year > range.to) return;
    const text = cnPunct(p.text);
    out.push({ id: i - plots.length, type: 'order', year, end: year, ongoing: false, text, head: text, weight: FILM_PLOT_WEIGHT, plot: true });
  });
  return out.sort((a, b) => a.year - b.year || a.id - b.id);
}

/** 字幕按大纲时的年份:第一条情节前 20 年到最后一条情节后 20 年(夹在世界的年份里;没有情节 = null) */
export const OUTLINE_PAD = 20;
export function outlineRange(plots: readonly Pick<FilmPlot, 'year'>[], end: number): FilmRange | null {
  if (!plots.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of plots) {
    lo = Math.min(lo, Math.floor(p.year));
    hi = Math.max(hi, Math.floor(p.year));
  }
  return clampRange({ from: lo - OUTLINE_PAD, to: hi + OUTLINE_PAD }, end);
}

/** 到第 year 年这件事打完了没有(一年里的事 = 打完了) */
export function eventOver(e: FilmEvent, year: number): boolean {
  return !e.ongoing && Math.floor(year) >= e.end;
}

export interface CaptionSlot {
  ev: FilmEvent;
  /** 从第几帧到第几帧(不含) */
  f0: number;
  f1: number;
  /** 字幕上写的:"第 1677 年""第 2562 年起" 和正文 */
  label: string;
  text: string;
}

/** 横屏字幕:每条大事排一个 2 秒的位置,撞了往后挪,挪不下的不放。按出现的先后排 */
export function captionSlots(events: readonly FilmEvent[], c: FilmClock, era?: Era | null): CaptionSlot[] {
  const hold = CAPTION_HOLD * FILM_FPS;
  const shift = Math.round(CAPTION_SHIFT * FILM_FPS);
  const lo = c.intro;
  const hi = c.intro + c.play;
  if (hi - lo < hold) return [];
  const order = [...events].sort((a, b) => b.weight - a.weight || a.year - b.year || a.id - b.id);
  const taken: CaptionSlot[] = [];
  const free = (f0: number) => taken.every((s) => f0 + hold <= s.f0 || f0 >= s.f1);
  for (const ev of order) {
    const at = yearFrame(c, ev.year);
    // 大纲的情节一条不丢:撞了一直往后挪到放得下(放到最后才发生的往前挪多少都行)
    const reach = ev.plot ? hi : shift;
    // 放到最后才发生的:往前挪到放得下(也最多挪 0.6 秒)
    const first = Math.min(at, hi - hold);
    if (at - first > reach) continue;
    let f0 = -1;
    for (let d = 0; d <= reach; d++) {
      const f = first + d;
      if (f + hold > hi) break;
      if (free(f)) {
        f0 = f;
        break;
      }
    }
    if (f0 < 0) continue;
    // 字幕停着的 2 秒里打完了的,照样写"起":它出现那一刻还没打完
    const over = eventOver(ev, ev.year);
    taken.push({
      ev,
      f0: Math.max(lo, f0),
      f1: f0 + hold,
      label: over ? yearFull(ev.year, era) : `${yearFull(ev.year, era)}起`,
      text: over ? ev.text : ev.head,
    });
  }
  return taken.sort((a, b) => a.f0 - b.f0);
}

/** 第 f 帧显示哪一条字幕、多不透明(淡入淡出) */
export function captionAt(slots: readonly CaptionSlot[], f: number): { slot: CaptionSlot; alpha: number } | null {
  for (const s of slots) {
    if (f < s.f0 || f >= s.f1) continue;
    const a = Math.min(1, (f - s.f0 + 1) / FADE_FRAMES, (s.f1 - f) / FADE_FRAMES);
    return { slot: s, alpha: Math.max(0, a) };
  }
  return null;
}

export interface RecentRow {
  ev: FilmEvent;
  /** 竖屏一行前面的年份:"1677""2562 起""2478—2514" */
  label: string;
  text: string;
  /** 出现了几帧(新的一行淡入用) */
  age: number;
}

/** 竖屏下面那一栏:放到第 f 帧时最近的 n 条大事,新的在上 */
export function recentRows(events: readonly FilmEvent[], c: FilmClock, f: number, n: number, era?: Era | null): RecentRow[] {
  const year = frameYear(c, f);
  const rows: RecentRow[] = [];
  for (let i = events.length - 1; i >= 0 && rows.length < n; i--) {
    const ev = events[i];
    const at = yearFrame(c, ev.year);
    if (at > f) continue;
    const over = eventOver(ev, year);
    const a = yearShort(ev.year, era);
    const label = ev.end > ev.year && over ? `${a}—${yearShort(ev.end, era)}` : over ? a : `${a} 起`;
    rows.push({ ev, label, text: over ? ev.text : ev.head, age: f - at });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 文字

/** 片头那一行:"第 899 年到第 3000 年";纪年 "公元前 1601 年到公元 501 年" */
export function rangeText(r: FilmRange, era?: Era | null): string {
  return `${yearFull(r.from, era)}到${yearFull(r.to, era)}`;
}

/**
 * 文件名:"文明与地图-九州大陆-第899—3000年.mp4";纪年 "…-公元前1601年—公元501年.mp4";竖屏加"-竖屏"。
 * base = 存档文件名的前半截(savefile.ts 的 fileBaseName)
 */
export function filmFileName(base: string, r: FilmRange, shape: FilmShape, era?: Era | null): string {
  const years = era ? `${yearFull(r.from, era)}—${yearFull(r.to, era)}`.replace(/ /g, '') : `第${r.from}—${r.to}年`;
  return `${base}-${years}${shape === 'port' ? '-竖屏' : ''}.mp4`;
}

/** 编出来的平均码率约是设定的几成(地图大多数时候只有几处在变,编码器用不满;实测 30 秒 9 MB、1 分钟 15 MB) */
const FILM_FILL = 0.45;

/** 估计的文件大小(MB):码率 × 时长 × 用满的比例 */
export function filmMegabytes(bitrate: number, seconds: number): number {
  return (bitrate * seconds * FILM_FILL) / 8 / 1e6;
}

/** 成片的码率(上限):1080p 30 帧,地图细节多,给 5 Mbps */
export const FILM_BITRATE = 5_000_000;

/** 文字按逗号分成几截(太长时从后往前去掉几截) */
export function clauses(text: string): string[] {
  return text.split('\uff0c').filter(Boolean);
}

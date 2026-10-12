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
 */
import type { ChronicleEntry } from '../gen/civ/chronicle';
import type { Civ } from '../gen/civ/types';
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
}

/**
 * 这一段年份里的大事(编年史"大事",开始的年份在范围里),按年份排;keep 给了只留它说留的
 * (拍框里一块时:只写框里看得到的国家的)
 */
export function filmEvents(majors: readonly ChronicleEntry[], range: FilmRange, keep?: (e: ChronicleEntry) => boolean): FilmEvent[] {
  const out: FilmEvent[] = [];
  for (const e of majors) {
    const year = Math.floor(e.year);
    if (year < range.from || year > range.to) continue;
    if (keep && !keep(e)) continue;
    const text = cnPunct(e.text);
    out.push({
      id: e.id,
      type: evType(e),
      year,
      end: Math.max(year, Math.floor(e.end)),
      ongoing: !!e.ongoing,
      text,
      head: e.head ? cnPunct(e.head) : text,
      weight: entryWeight(e),
    });
  }
  return out.sort((a, b) => a.year - b.year || a.id - b.id);
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
export function captionSlots(events: readonly FilmEvent[], c: FilmClock): CaptionSlot[] {
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
    // 放到最后才发生的:往前挪到放得下(也最多挪 0.6 秒)
    const first = Math.min(at, hi - hold);
    if (at - first > shift) continue;
    let f0 = -1;
    for (let d = 0; d <= shift; d++) {
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
      label: over ? `第 ${ev.year} 年` : `第 ${ev.year} 年起`,
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
export function recentRows(events: readonly FilmEvent[], c: FilmClock, f: number, n: number): RecentRow[] {
  const year = frameYear(c, f);
  const rows: RecentRow[] = [];
  for (let i = events.length - 1; i >= 0 && rows.length < n; i--) {
    const ev = events[i];
    const at = yearFrame(c, ev.year);
    if (at > f) continue;
    const over = eventOver(ev, year);
    const label = ev.end > ev.year && over ? `${ev.year}—${ev.end}` : over ? `${ev.year}` : `${ev.year} 起`;
    rows.push({ ev, label, text: over ? ev.text : ev.head, age: f - at });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 文字

/** 片头那一行:"第 899 年到第 3000 年" */
export function rangeText(r: FilmRange): string {
  return `第 ${r.from} 年到第 ${r.to} 年`;
}

/** 文件名:"文明与地图-九州大陆-第899—3000年.mp4";竖屏加"-竖屏"。base = 存档文件名的前半截(savefile.ts 的 fileBaseName) */
export function filmFileName(base: string, r: FilmRange, shape: FilmShape): string {
  return `${base}-第${r.from}—${r.to}年${shape === 'port' ? '-竖屏' : ''}.mp4`;
}

/** 估计的文件大小(MB):码率 × 时长 */
export function filmMegabytes(bitrate: number, seconds: number): number {
  return (bitrate * seconds) / 8 / 1e6;
}

/** 成片的码率:1080p 30 帧,地图细节多,给 5 Mbps(1 分钟约 40 MB) */
export const FILM_BITRATE = 5_000_000;

/** 文字按逗号分成几截(太长时从后往前去掉几截) */
export function clauses(text: string): string[] {
  return text.split('\uff0c').filter(Boolean);
}

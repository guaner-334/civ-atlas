/**
 * 回放视频每一帧放什么(纯计算,不碰 DOM):第几帧放到哪一年、这一帧显示哪条字幕、多不透明,
 * 竖屏下面那一栏列哪几条。画面(film.ts)和排片(放哪一段、字幕排在哪几秒,ui/filmPlan.ts)都用。
 */
import { yearShort, type Era } from '../gen/era';
import type { EvType } from './eventTypes';

export type FilmShape = 'land' | 'port';
export type FilmArea = 'whole' | 'region';

/** 字幕、新的一行淡入淡出几帧 */
export const FADE_FRAMES = 6;

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

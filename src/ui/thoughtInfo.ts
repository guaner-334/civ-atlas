/**
 * 思潮在界面上的几样文字和数(纯计算,不碰 DOM;画法见 render/civ/thoughts.ts,组件见 Thoughts.tsx):
 *
 *   侧栏「思潮」一组(thoughtSide)  七说固定次序,一说一行:哪年始倡于哪城、到半成的州数;这一年还没人倡的灰着写"某年才有人倡";
 *                                   整个历史都没冒出来的合成一行小字;世上还没有思潮的年份换成一句话 + 头一说哪年在哪冒出来
 *   州卡片(regionThoughts)          这州到半成的几说(从多到少):几成、比百年前渐盛 / 渐衰 / 持平、哪年始倡于本州或传入本国
 *   国家卡片、朝政页(polityThoughtRows)  国中到半成的几说:几成、哪年传入、近一千年的走势、比百年前
 * 几成 = 接受度(0–1),"六成";比百年前(卡片上写的百分数)差不到 FLAT 个百分点算持平。
 */
import type { Civ, Year } from '../gen/civ/types';
import { ARRIVE, THOUGHTS, THOUGHT_COUNT, ideologyAt, polityIdeologyAt, polityThoughts, thoughtArrival, thoughtOrigin } from '../gen/civ/ideology';
import { polityName } from '../gen/civ/growth';
import { regionLabel } from '../gen/civ/display';
import { yearAt, yearFull, type Era } from '../gen/era';
import { thoughtBand, thoughtCounts, thoughtEmerged } from '../render/civ/thoughts';

/** 比百年前差不到这么多个百分点算持平(按卡片上写的百分数比) */
export const FLAT = 3;
/** 比多少年前 */
export const TREND_YEARS = 100;
/** 走势画多少年 */
export const SPARK_YEARS = 1000;

const CN = '零一二三四五六七八九十';

/** 几成:"六成";不到一成写"不到一成" */
export function cheng(v: number): string {
  return v < 0.095 ? '不到一成' : `${CN[Math.min(10, Math.round(v * 10))]}成`;
}

/** 比百年前:up 渐盛 / down 渐衰 / flat 持平 */
export type Trend = 'up' | 'down' | 'flat';
export const TREND_NAMES: Readonly<Record<Trend, string>> = { up: '渐盛', down: '渐衰', flat: '持平' };
export function trendOf(now: number, before: number): Trend {
  const d = Math.round(now * 100) - Math.round(before * 100);
  return d >= FLAT ? 'up' : d <= -FLAT ? 'down' : 'flat';
}

/** 一说的简称("律法之说" → "律法") */
export const thoughtShort = (k: number) => THOUGHTS[k].name.replace(/之说$/, '');

/** 头一处冒出来的那座城(没有城写州名) */
function originPlace(civ: Civ, k: number): string {
  const o = civ.ideology ? thoughtOrigin(civ.ideology, k) : undefined;
  if (!o) return '';
  return civ.settlements[o.settlement]?.name || (o.region >= 0 ? regionLabel(civ, o.region) : '');
}

const CN_COUNT = ['零', '一', '两', '三', '四', '五', '六', '七'];

// ---------------------------------------------------------------------------
// 侧栏

export interface ThoughtSideRow {
  k: number;
  name: string;
  /** "1036 年始倡于克尔顿" / "2348 年才有人倡" */
  sub: string;
  /** 到半成的州数(这一年还没人倡的 = null) */
  n: number | null;
  /** 这一年已经有人倡 */
  live: boolean;
}

export interface ThoughtSide {
  /** 整个历史里冒出来过的几说(七说的固定次序) */
  rows: ThoughtSideRow[];
  /** 整个历史都没冒出来的几说合成的一行(没有 = null) */
  never: string | null;
  /** 这一年世上还没有思潮:那一句、头一说哪年冒出来(可以跳过去);有思潮了 = null */
  empty: { title: string; text: string; jump: number | null } | null;
  /** 世上还没有思潮时下面那句:各说冒出来的先后 */
  order: string;
}

export function thoughtSide(civ: Civ, year: Year, era?: Era | null): ThoughtSide {
  const ideo = civ.ideology;
  const n = thoughtCounts(civ, year);
  const rows: ThoughtSideRow[] = [];
  const never: number[] = [];
  for (let k = 0; k < THOUGHT_COUNT; k++) {
    const o = ideo ? thoughtOrigin(ideo, k) : undefined;
    if (!o) {
      never.push(k);
      continue;
    }
    const live = thoughtEmerged(civ, k, year);
    rows.push({ k, name: THOUGHTS[k].name, sub: live ? `${yearAt(o.year, era)}始倡于${originPlace(civ, k)}` : `${yearAt(o.year, era)}才有人倡`, n: live ? n[k] : null, live });
  }
  const end = yearAt(civ.endYear, era);
  const needs = [...new Set(never.map((k) => THOUGHTS[k].needs[0]))];
  const neverText = never.length ? `${never.map((k) => THOUGHTS[k].name).join('、')}要到${needs.join('、')}以后才有人倡，这个世界到 ${end}还没有` : null;
  let empty: ThoughtSide['empty'] = null;
  if (!rows.some((r) => r.live)) {
    const first = rows.length ? rows.reduce((a, b) => (thoughtOrigin(ideo!, b.k)!.year < thoughtOrigin(ideo!, a.k)!.year ? b : a)) : null;
    if (first) {
      const o = thoughtOrigin(ideo!, first.k)!;
      const t = THOUGHTS[first.k];
      const pol = o.polity >= 0 && civ.polities[o.polity] ? `${polityName(civ.polities[o.polity], o.year)}的` : '';
      const state = /has\(国\)/.test(t.root) ? '有了国家的' : '';
      empty = {
        title: `${yearFull(year, era)}，世上还没有思潮`,
        text: `头一说是${t.name}：${yearAt(o.year, era)}始倡于${pol}${originPlace(civ, first.k)}。要等${t.needs.map((x) => `有了${x}`).join('、')}、${state}大城才会有人倡。`,
        jump: Math.floor(o.year),
      };
    } else empty = { title: `${yearFull(year, era)}，世上还没有思潮`, text: `这个世界到 ${end}还没有人倡任何一说。`, jump: null };
  }
  const sorted = rows.slice().sort((a, b) => thoughtOrigin(ideo!, a.k)!.year - thoughtOrigin(ideo!, b.k)!.year);
  const neverShort = never.length > 1 ? `${never.map(thoughtShort).join('、')}${CN_COUNT[never.length] ?? never.length}说` : never.length ? THOUGHTS[never[0]].name : '';
  const order = sorted.length
    ? `这个世界各说冒出来的先后：${sorted.map((r) => `${r.name} ${yearAt(thoughtOrigin(ideo!, r.k)!.year, era)}`).join('、')}${never.length ? `；${neverShort}到 ${end}还没有` : ''}。`
    : '';
  return { rows, never: neverText, empty, order };
}

// ---------------------------------------------------------------------------
// 州卡片

export interface RegionThought {
  k: number;
  name: string;
  share: number;
  trend: Trend;
  /** "1229 年始倡于本州克尔顿" / "2109 年传入埃维里亚帝国" / "1240 年始倡于星邑" */
  sub: string;
}

/** 这州到半成的几说(从多到少;一样多的按七说的次序;这一年还没有人倡的不算 —— 快照之间插值,始倡以前的几年也会有一点) */
export function regionThoughts(civ: Civ, r: number, year: Year, polity: number, era?: Era | null): RegionThought[] {
  const ideo = civ.ideology;
  if (!ideo) return [];
  const K = THOUGHT_COUNT;
  const now = ideologyAt(ideo, year);
  const before = ideologyAt(ideo, year - TREND_YEARS);
  const out: RegionThought[] = [];
  for (let k = 0; k < K; k++) {
    const share = now[r * K + k] ?? 0;
    if (thoughtBand(share) < 0 || !thoughtEmerged(civ, k, year)) continue;
    const o = thoughtOrigin(ideo, k);
    let sub = '';
    if (o && o.region === r) sub = `${yearAt(o.year, era)}始倡于本州${civ.settlements[o.settlement]?.name ?? ''}`;
    else {
      const arr = polity >= 0 ? thoughtArrival(ideo, polity, k) : NaN;
      if (Number.isFinite(arr) && arr <= year && civ.polities[polity]) sub = `${yearAt(arr, era)}传入${polityName(civ.polities[polity], year)}`;
      else if (o) sub = `${yearAt(o.year, era)}始倡于${originPlace(civ, k)}`;
    }
    out.push({ k, name: THOUGHTS[k].name, share, trend: trendOf(share, before[r * K + k] ?? 0), sub });
  }
  return out.sort((a, b) => b.share - a.share || a.k - b.k);
}

// ---------------------------------------------------------------------------
// 国家卡片、朝政页

export interface PolityThought {
  k: number;
  name: string;
  share: number;
  trend: Trend;
  /** "1620 年传入";始倡这一说的那国写"1240 年始倡" */
  sub: string;
  /** 近一千年(立国以前的不算)每 20 年一个数 */
  series: number[];
}

/** 国中到半成的几说(从多到少;这一年还没有人倡的不算) */
export function polityThoughtRows(civ: Civ, p: number, year: Year, era?: Era | null): PolityThought[] {
  const ideo = civ.ideology;
  if (!ideo || !ideo.polities[p]) return [];
  const s = ideo.polities[p]!;
  const before = polityIdeologyAt(ideo, p, year - TREND_YEARS);
  const t0 = Math.max(s.from, year - SPARK_YEARS);
  const ts: number[] = [];
  for (let t = t0; t < year; t += 20) ts.push(t);
  ts.push(year);
  const at = ts.map((t) => polityIdeologyAt(ideo, p, t));
  return polityThoughts(ideo, p, year, ARRIVE - 1e-6)
    .filter(({ thought: k }) => thoughtEmerged(civ, k, year))
    .map(({ thought: k, share, arrive }) => {
    const o = thoughtOrigin(ideo, k);
    const born = o && o.polity === p;
    return {
      k,
      name: THOUGHTS[k].name,
      share,
      trend: year - TREND_YEARS >= s.from ? trendOf(share, before[k]) : 'flat',
      sub: Number.isFinite(arrive) ? `${yearAt(arrive, era)}${born ? '始倡' : '传入'}` : '',
      series: at.map((v) => v[k]),
    };
  });
}

/** 朝政页「思潮」下面那一句:最盛的那一说最早出自哪座城 */
export function polityThoughtFoot(civ: Civ, top: PolityThought | undefined, era?: Era | null): string {
  const o = top && civ.ideology ? thoughtOrigin(civ.ideology, top.k) : undefined;
  if (!top || !o) return '';
  const pol = o.polity >= 0 && civ.polities[o.polity] ? `${polityName(civ.polities[o.polity], o.year)}，` : '';
  return `${top.name}最早出自${originPlace(civ, top.k)}（${pol}${yearAt(o.year, era)}），沿着邻州、商路传开。几成 = 国中大约几成的人信这一说；小折线是近一千年。`;
}

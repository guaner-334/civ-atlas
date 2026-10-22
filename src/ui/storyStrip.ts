/**
 * 故事长图的骨架(纯计算,不碰 DOM、不改世界):一段历史分成几段,每段从哪年到哪年、挑哪几件大事、配哪一年的地图。
 * 写成什么字在 longPlan.ts、怎么排版在 render/longImage.ts;这里只管"分段 + 挑事 + 定地图年份"。
 *
 * - 分段:和导出的编年史一样按整数年份分节(chronicleEraYears:三千年每 500 年一节),节的边界对齐到一节年数的整数倍。
 *   整个世界:从第一个国家立国那一节起(之前还没有国家,地图上是空的),到最后一年;一国:从立国那年到亡国那年(还在 = 最后一年),
 *   一节多长按这一国存续的年数算(同一套分法),享国不久的国家也能分成几段。
 *   段数超过上限:一节放长一档(STRIP_SPANS:50、100、200、250、500、1000、2000、5000……)再分,直到不超过上限。
 * - 挑大事:整个世界 = 编年史"大事"(回放视频的字幕、导出编年史的"大事"同一份);一国 = 和这一国有关、重要度 2 起、
 *   不算君主继位(polityEntries)。每段按分量(timelineLayout 的 entryWeight,回放字幕、导播挑事用的同一个)
 *   从重到轻挑;一样重的先挑牵涉的国家大的(事发那年其中最大的一国有几个州:大国改朝换代、大国之间的战争先上),再按年份先后;
 *   挑出来的照编年史里的先后排。
 * - 地图:每段最后一年年末那一刻;一国亡了 = 亡国前一刻(polityLastYear)。开头那张 = 最后一年(一国:最后一刻)。
 *   最后一段的地图就是开头那张,放不放由排版决定。
 * - 还没有国家的世界:没有段(只有开头那张图)。
 *
 * 同一个世界、同样的选项永远得到同样的结果(不用随机数,排序都有确定的先后)。
 */
import type { Civ, Polity } from '../gen/civ/types';
import { chronicleEraYears, filterChronicle, type ChronicleEntry } from '../gen/civ/chronicle';
import { ownersAt } from '../gen/civ/timeline';
import { entryWeight } from './timelineLayout';

/** 某年各州归哪国(到最后一年 = civ.polity) */
function ownersOf(civ: Civ, year: number): Int32Array | Int16Array | number[] {
  return year >= civ.endYear ? civ.polity : ownersAt(civ, year).polity;
}

/** 某年各国有几个州(没有州的不在里面) */
export function regionCounts(civ: Civ, year: number): Map<number, number> {
  const own = ownersOf(civ, year);
  const R = Math.min(civ.regions.count, own.length);
  const n = new Map<number, number>();
  for (let r = 0; r < R; r++) {
    const p = own[r];
    if (p >= 0) n.set(p, (n.get(p) ?? 0) + 1);
  }
  return n;
}

/** 一国最后的年份:亡了 = 亡国前一刻;还在 = 最后一年 */
export function polityLastYear(civ: Pick<Civ, 'endYear'>, p: Polity): number {
  return p.ended !== undefined ? Math.max(p.founded, Math.min(civ.endYear, p.ended - 1 / 512)) : civ.endYear;
}

/** 一国版列的大事:和这一国有关、不算小事(重要度 2 起),不列每一次君主继位 */
export function polityEntries(all: readonly ChronicleEntry[], polity: number): ChronicleEntry[] {
  return filterChronicle(all, { polity }).filter((e) => e.kind !== 'reign' && e.importance >= 2);
}

/** 段数超过上限时一节放长到哪几档(前几档和导出编年史一节的年数一样) */
export const STRIP_SPANS: readonly number[] = [50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];

export interface StripOptions {
  /** 只看一国(Polity.id);不给 / null = 整个世界。这一国不存在、到最后一年还没立国 = 按整个世界 */
  polity?: number | null;
  /** 最多几段(不到 1 按 1) */
  maxSegments: number;
  /** 每段最多挑几件大事(Infinity = 全部;不到 0 按 0) */
  perSegment: number;
}

export interface StripSegment {
  /** 这一段从哪年到哪年(整数,含头含尾) */
  from: number;
  to: number;
  /** 这一段的地图拍哪一刻(年份,带小数) */
  mapYear: number;
  /** 挑中的大事(照编年史里的先后) */
  events: ChronicleEntry[];
  /** 这一段一共有几件(没挑上的 = total − events.length) */
  total: number;
}

export interface StripPlan {
  /** 只看的那一国;整个世界 = null */
  polity: number | null;
  /** 一节多少年 */
  span: number;
  /** 开头那张图拍哪一刻 */
  headYear: number;
  segments: StripSegment[];
}

/** 一段的地图:这一段最后一年年末那一刻,不过 last(世界最后一年 / 一国最后一刻) */
const segmentEnd = (to: number, last: number) => Math.min(last, to + 1 - 1 / 512);

/**
 * 按 span 年一节切 [lo, hi]:第 i 节 = [i·span, (i+1)·span − 1],最后一节到世界最后一年(和编年史一样:
 * 最后一年正好是整数倍时并进前一节);从 first 所在的那一节起,每节再截到 [lo, hi] 里
 */
export function stripSections(lo: number, first: number, hi: number, span: number, endYear: number): [number, number][] {
  const end = Math.floor(endYear);
  const lastEra = Math.max(0, Math.ceil(end / span) - 1);
  const eraOf = (y: number) => Math.min(Math.floor(Math.max(0, y) / span), lastEra);
  const out: [number, number][] = [];
  if (!(first <= hi)) return out;
  for (let i = eraOf(first); i <= eraOf(hi); i++) {
    const a = Math.max(i * span, lo);
    const b = Math.min(i === lastEra ? end : (i + 1) * span - 1, hi);
    if (a <= b) out.push([a, b]);
  }
  return out;
}

/** 一节多少年:从 base 起,段数超过 max 就放长一档;最长一档还超(推得极久的世界)就整个一段 */
export function stripSpan(lo: number, first: number, hi: number, endYear: number, base: number, max: number): number {
  const cap = Math.max(1, Math.floor(max));
  for (const span of [base, ...STRIP_SPANS.filter((s) => s > base)]) {
    if (stripSections(lo, first, hi, span, endYear).length <= cap) return span;
  }
  return Math.max(STRIP_SPANS[STRIP_SPANS.length - 1], Math.floor(endYear) + 1);
}

/**
 * 一件事牵涉的国家有多大:事发那年其中最大的一国有几个州(没有牵涉国家的 = 0)。按年份记着,同一年只数一次
 */
export function eventSize(civ: Civ): (e: ChronicleEntry) => number {
  const byYear = new Map<number, Map<number, number>>();
  return (e) => {
    if (!e.polities.length) return 0;
    const y = Math.min(e.year, civ.endYear);
    let n = byYear.get(y);
    if (!n) byYear.set(y, (n = regionCounts(civ, y)));
    let m = 0;
    for (const p of e.polities) m = Math.max(m, n.get(p) ?? 0);
    return m;
  };
}

/**
 * 从一段的纪事里挑 n 件:分量重的先(entryWeight),一样重的先挑 size 大的(不给 = 不比),再按年份先后;
 * 挑出来的照传进来的先后排(编年史本来就按年份排)
 */
export function pickEvents(entries: readonly ChronicleEntry[], n: number, size?: (e: ChronicleEntry) => number): ChronicleEntry[] {
  const k = Math.max(0, Math.floor(n));
  if (entries.length <= k) return [...entries];
  const idx = new Map<ChronicleEntry, number>();
  const big = new Map<ChronicleEntry, number>();
  entries.forEach((e, i) => {
    idx.set(e, i);
    big.set(e, size ? size(e) : 0);
  });
  const order = [...entries].sort((a, b) => entryWeight(b) - entryWeight(a) || big.get(b)! - big.get(a)! || a.year - b.year || idx.get(a)! - idx.get(b)!);
  return order.slice(0, k).sort((a, b) => idx.get(a)! - idx.get(b)!);
}

/** 各段的大事:年份(取整)落在这一段里的,照先后 */
function bucket(entries: readonly ChronicleEntry[], secs: readonly [number, number][]): ChronicleEntry[][] {
  const out: ChronicleEntry[][] = secs.map(() => []);
  for (const e of entries) {
    const y = Math.floor(e.year);
    // 段按年份排好、互不重叠:二分找 y 落在哪一段
    let lo = 0;
    let hi = secs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (y < secs[mid][0]) hi = mid - 1;
      else if (y > secs[mid][1]) lo = mid + 1;
      else {
        out[mid].push(e);
        break;
      }
    }
  }
  return out;
}

/**
 * 故事长图分几段、每段挑哪几件、配哪一年的地图。
 * all = 全部纪事(编年史"全部",一国版从里面挑),majors = 编年史"大事"(整个世界挑这些)。
 */
export function storyStrip(
  civ: Civ,
  all: readonly ChronicleEntry[],
  majors: readonly ChronicleEntry[],
  opt: StripOptions,
): StripPlan {
  const end = Math.floor(civ.endYear);
  const size = eventSize(civ);
  const p = opt.polity !== null && opt.polity !== undefined ? civ.polities[opt.polity] : undefined;
  if (p && p.founded <= civ.endYear) {
    const f = Math.floor(p.founded);
    const lastY = polityLastYear(civ, p);
    // 亡国那一年:地图拍亡国前一刻,但最后一段和大事写到亡国那年
    const E = p.ended !== undefined && p.ended <= civ.endYear ? Math.max(f, Math.floor(p.ended)) : Math.floor(lastY);
    const span = stripSpan(f, f, E, civ.endYear, chronicleEraYears(E - f), opt.maxSegments);
    const secs = stripSections(f, f, E, span, civ.endYear);
    const per = bucket(polityEntries(all, p.id), secs);
    return {
      polity: p.id,
      span,
      headYear: lastY,
      segments: secs.map(([a, b], i) => ({ from: a, to: b, mapYear: segmentEnd(b, lastY), events: pickEvents(per[i], opt.perSegment, size), total: per[i].length })),
    };
  }
  let first = Infinity;
  for (const q of civ.polities) if (q.founded <= civ.endYear && q.founded < first) first = q.founded;
  const f = Math.floor(first);
  const span = Number.isFinite(first) ? stripSpan(0, f, end, civ.endYear, chronicleEraYears(civ.endYear), opt.maxSegments) : chronicleEraYears(civ.endYear);
  const secs = Number.isFinite(first) ? stripSections(0, f, end, span, civ.endYear) : [];
  const per = bucket(majors, secs);
  return {
    polity: null,
    span,
    headYear: civ.endYear,
    segments: secs.map(([a, b], i) => ({ from: a, to: b, mapYear: segmentEnd(b, civ.endYear), events: pickEvents(per[i], opt.perSegment, size), total: per[i].length })),
  };
}

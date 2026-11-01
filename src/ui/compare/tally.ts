/**
 * 并排试推下面那张表:两段历史「到第 N 年为止」各有多少,差多少。纯计算,不碰 DOM。
 *
 * 「到第 N 年为止」= 第 N 年那一刻,年份 ≤ N 的事都算上(和世界概览、世界之最一样)。各行:
 *   现存国家            第 N 年还在的国家(和世界概览顶上「现存 X 国」一样)
 *   历来立过的国家      第 N 年以前立的国家(连分裂、自立、复国出来的;和「历来 X 国」一样)
 *   打过的仗            宣战(史事 war)几场
 *   改朝换代            史事 dynasty 几次
 *   大崩解              史事 collapse 几次
 *   和亲                两国结亲(史事 marry)几次;互嫁的两门(同一刻、两国对调)算一次
 *   最大的国            到第 N 年为止,一国最多同时有过几州(和世界之最「疆域最大的国家」同一个数:按整年数,一年里的变化全生效以后才数)
 *   大国平均活了多久    到第 N 年为止到过 BIG_REGIONS 州的国家,活了多少年的平均(已亡的算到亡国那年,还在的算到第 N 年;一个都没有 = null)
 *
 * 一段历史先整理一遍(tallyOf:各种史事的年份排好、各国到过多少州),之后每拖一下时间轴只查表(tallyAt)。
 */
import type { Civ } from '../../gen/civ/types';
import { Layer } from '../../gen/civ/types';
import { polityAlive } from '../../gen/civ/growth';

/** 到过这么多州的国家算大国 */
export const BIG_REGIONS = 30;

export interface TallyAt {
  alive: number;
  founded: number;
  wars: number;
  dynasties: number;
  collapses: number;
  marriages: number;
  /** 最多同时几州(还没有国家 = 0) */
  biggest: number;
  /** 大国平均活了多少年(取整;没有大国 = null) */
  bigLife: number | null;
}

export type TallyKey = keyof TallyAt;

/** 表的各行(先后照这个) */
export const TALLY_ROWS: readonly { key: TallyKey; name: string }[] = [
  { key: 'alive', name: '现存国家' },
  { key: 'founded', name: '历来立过的国家' },
  { key: 'wars', name: '打过的仗' },
  { key: 'dynasties', name: '改朝换代' },
  { key: 'collapses', name: '大崩解' },
  { key: 'marriages', name: '和亲' },
  { key: 'biggest', name: '最大的国' },
  { key: 'bigLife', name: '大国平均活了多久' },
];

/** 数个数的几行的量词 */
const UNIT: Partial<Record<TallyKey, string>> = { alive: '个', founded: '个', wars: '场', dynasties: '次', collapses: '次', marriages: '次' };

export interface Tally {
  civ: Civ;
  /** 各种史事的年份(从小到大) */
  years: Record<'wars' | 'dynasties' | 'collapses' | 'marriages', Float64Array>;
  /** 一国到过的最多州数,按它到的那一刻排(t 从小到大;v 是到那一刻为止的最大值,只增不减) */
  big: { t: Float64Array; v: Int32Array };
  /** 到过 BIG_REGIONS 州的国家:到的那一刻、立国、亡国 */
  bigs: { at: number; founded: number; ended: number }[];
}

/** 年份 ≤ y 的有几个(a 从小到大) */
function countUpTo(a: Float64Array, y: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 整理一段历史(同一份历史只整理一次) */
const cache = new WeakMap<Civ, Tally>();
export function tallyOf(civ: Civ): Tally {
  const hit = cache.get(civ);
  if (hit) return hit;
  const wars: number[] = [];
  const dynasties: number[] = [];
  const collapses: number[] = [];
  const marriages: number[] = [];
  const A = civ.annals;
  for (let i = 0; i < A.length; i++) {
    const e = A[i];
    if (e.kind === 'war') wars.push(e.year);
    else if (e.kind === 'dynasty') dynasties.push(e.year);
    else if (e.kind === 'collapse') collapses.push(e.year);
    else if (e.kind === 'marry') {
      // 互嫁的另一门紧跟着记(同一刻、两国对调):算一次
      const p = A[i - 1];
      if (p && p.kind === 'marry' && p.year === e.year && p.a === e.b && p.b === e.a) continue;
      marriages.push(e.year);
    }
  }
  const sorted = (a: number[]) => Float64Array.from(a).sort();

  // 各国州数:从头翻一遍变化日志(国家层),按整年数(和世界之最 records.ts 的「疆域最大」同一个数法)
  const pols = civ.polities;
  const L = civ.log;
  let R = civ.regions.count;
  for (let k = 0; k < L.size; k++) R = Math.max(R, L.region[k] + 1);
  const owner = new Int16Array(R).fill(-1);
  const size = new Int32Array(pols.length);
  const peak = new Int32Array(pols.length);
  const lastT = new Float64Array(pols.length);
  const reached = new Float64Array(pols.length).fill(Infinity);
  const steps: { t: number; v: number }[] = [];
  for (let k = 0; k < L.size; ) {
    const y = Math.ceil(L.year[k]);
    const touched: number[] = [];
    for (; k < L.size && L.year[k] <= y; k++) {
      if (L.layer[k] !== Layer.Polity) continue;
      const r = L.region[k];
      const v = L.value[k];
      const o = owner[r];
      if (o === v) continue;
      if (o >= 0 && o < pols.length) {
        size[o]--;
        lastT[o] = L.year[k];
      }
      owner[r] = v;
      if (v >= 0 && v < pols.length) {
        size[v]++;
        lastT[v] = L.year[k];
        touched.push(v);
      }
    }
    for (const p of touched) {
      if (size[p] <= peak[p]) continue;
      peak[p] = size[p];
      steps.push({ t: lastT[p], v: size[p] });
      if (size[p] >= BIG_REGIONS && reached[p] === Infinity) reached[p] = lastT[p];
    }
  }
  steps.sort((a, b) => a.t - b.t);
  const bt = new Float64Array(steps.length);
  const bv = new Int32Array(steps.length);
  let best = 0;
  steps.forEach((s, i) => {
    best = Math.max(best, s.v);
    bt[i] = s.t;
    bv[i] = best;
  });
  const bigs = pols.flatMap((p, i) => (reached[i] < Infinity ? [{ at: reached[i], founded: p.founded, ended: p.ended ?? Infinity }] : []));
  const t: Tally = {
    civ,
    years: { wars: sorted(wars), dynasties: sorted(dynasties), collapses: sorted(collapses), marriages: sorted(marriages) },
    big: { t: bt, v: bv },
    bigs,
  };
  cache.set(civ, t);
  return t;
}

/** 到第 year 年为止的各行 */
export function tallyAt(t: Tally, year: number): TallyAt {
  const civ = t.civ;
  let alive = 0;
  let founded = 0;
  if (civ.viable) {
    for (const p of civ.polities) {
      if (p.founded > year) continue;
      founded++;
      if (polityAlive(p, year)) alive++;
    }
  }
  const i = countUpTo(t.big.t, year);
  let sum = 0;
  let n = 0;
  for (const b of t.bigs) {
    if (b.at > year) continue;
    sum += Math.min(b.ended, year) - b.founded;
    n++;
  }
  return {
    alive,
    founded,
    wars: countUpTo(t.years.wars, year),
    dynasties: countUpTo(t.years.dynasties, year),
    collapses: countUpTo(t.years.collapses, year),
    marriages: countUpTo(t.years.marriages, year),
    biggest: i ? t.big.v[i - 1] : 0,
    bigLife: n ? Math.round(sum / n) : null,
  };
}

/** 一格里的数怎么写("13""56 州""640 年";没有大国、还没有国家 = "—") */
export function tallyText(key: TallyKey, v: number | null): string {
  if (key === 'biggest') return v ? `${v} 州` : '—';
  if (key === 'bigLife') return v === null ? '—' : `${v} 年`;
  return String(v ?? 0);
}

/** 倍数写一位小数(整数不写 .0) */
const times = (x: number) => String(Math.round(x * 10) / 10);

/**
 * 「差多少」那一列:右边(r)比左边(l)。
 *   数个数的几行:一样 → "一样";右边一个没有 → "没有";两边都不少于 10 个、右边多到 1.5 倍以上 → "×2.1";
 *               其余写差几个 → "多 13 个""少 4 个"(右边少很多也写少几个,不写零点几倍)
 *   最大的国:"大 32 州""小 5 州";右边还没有国家 → "没有"
 *   大国平均活了多久:"长 30 年""短 230 年";右边没有大国、左边有 → "没有";左边没有 → "—"
 */
export function diffText(key: TallyKey, l: number | null, r: number | null): string {
  if (key === 'bigLife') {
    if (l === null) return '—';
    if (r === null) return '没有';
    return r === l ? '一样' : r > l ? `长 ${r - l} 年` : `短 ${l - r} 年`;
  }
  const a = l ?? 0;
  const b = r ?? 0;
  if (a === b) return '一样';
  if (b === 0) return '没有';
  if (key === 'biggest') return b > a ? `大 ${b - a} 州` : `小 ${a - b} 州`;
  const unit = UNIT[key] ?? '个';
  if (a >= 10 && b >= 10 && b / a >= 1.5) return `×${times(b / a)}`;
  return b > a ? `多 ${b - a} ${unit}` : `少 ${a - b} ${unit}`;
}

/**
 * 照故事找世界:条件、判定、排序、放宽。
 * 作者把故事里的国家(1–3 个)和地方写成几条条件,网站把一批种子各推一遍(measure.ts 量数、后台线程分批推),
 * 这里拿量出来的数和门槛比,排出最合的世界。纯数据和计算,不碰 DOM,也不带生成代码:找世界那一页(主线程)和后台线程都用。
 *
 * 一个结果 = 一个种子 + 一个开场年份 + 故事里每国对上哪一国(一种"配法")。每种配法逐条量出几个数(Fact,和门槛无关),
 * 判合不合只是拿这几个数和门槛比:改门槛("放宽一点试试")不用重推。
 * 每条要么合、要么不合:全合的排前面,其次差一条;同样全合的按"合得多好"排(每条超出门槛多少折成 0–1,加起来,每条一样重)。
 */
import { isPass } from '../civ/passes';
import type { WorldParams } from '../params';
import type { CivParams } from '../civ/types';
import type { TerrainOp } from '../edits';
import type { Sketch } from '../sketch';

// ---------------------------------------------------------------------------
// 条件

/** 国家大小:small 小国(不到另一国的 ratio 倍;故事里只有这一国时不到 SMALL_ALONE × ratio 州)、medium 中等、large 大国、top 附近最大(比每个邻国都大) */
export type SizeClass = 'small' | 'medium' | 'large' | 'top';
/** 开场后的变故:亡国、分裂(有一块分出去自立、大崩解)、改朝换代 */
export type FateKind = 'fall' | 'split' | 'dynasty';

/**
 * 每国一组的条件。other = 故事里的另一国(FinderQuery.roles 的下标);年数都从开场那年算起。
 * 门槛(会被"放宽一点"改的)是 min / max / ratio / gap / narrow / within / years;era、enter、what、dir 是"量什么",不放宽
 */
export type RoleCond =
  /** 大小(开场那年的州数):给 size 按那一档,不给按 min / max 州 */
  | { kind: 'size'; size?: SizeClass; min?: number; max?: number; ratio?: number }
  /** 陆上接壤的国家至少 / 不超过几个 */
  | { kind: 'neighbors'; min?: number; max?: number }
  /** 那年在它手里、连着航线(或海峡)的港口城至少几座 */
  | { kind: 'ports'; min: number }
  /** 开场那年已经立国多少年:以上(min)/ 以内(max) */
  | { kind: 'age'; min?: number; max?: number }
  /** 开场那年国都那州在第几个时代(development.ts 的 ERAS 下标:0 石器、1 青铜、2 铁器……) */
  | { kind: 'era'; era: number }
  /** 开场后 min–max 年里进第 era 个时代(编年史里进时代那一条) */
  | { kind: 'eraEnter'; era: number; min: number; max: number }
  /** 开场后 within 年内亡国 / 分裂 / 改朝(what 里任一种) */
  | { kind: 'fate'; within: number; what: FateKind[] }
  /** 地形:陆上边界里隔着山的那几段至少占几成(0–1) */
  | { kind: 'mountain'; min: number }
  /** 地形:平均海拔(按州面积平均)高过多少米 */
  | { kind: 'elevation'; min: number }
  /** 地形:平均海拔比另一国高 by 米以上 */
  | { kind: 'higher'; other: number; by: number }
  /** 和另一国陆上接壤 */
  | { kind: 'border'; other: number }
  /**
   * 和另一国接壤、隔山有隘口(gen/civ/passes.ts 的认法):两国交界上的口子比山脊低 gap 米以上,
   * 和口子差不多低的("能过的地方")不超过 narrow 处;山脊够高、口子够深照推演里关隘的认法
   */
  | { kind: 'pass'; other: number; gap: number; narrow: number }
  /** 开场后 within 年内和另一国打过仗(宣战或交战) */
  | { kind: 'war'; other: number; within: number }
  /** 开场后 within 年内占过另一国至少 min 州(dir = took);dir = lost:被另一国占过 */
  | { kind: 'conquer'; other: number; dir: 'took' | 'lost'; within: number; min: number }
  /** 交界:它的一州同时挨着至少 min 国(那州和它陆上相邻各州分属几家,只数故事里的国家和它们的邻国) */
  | { kind: 'junction'; min: number };

/** 「一起」一组的条件 */
export type TogetherCond =
  /**
   * 交界:有一州同时挨着至少 min 国(那州和它陆上相邻各州分属几家;只数故事里的国家和它们的邻国,故事里没有国家时数所有国家)。
   * unowned:那州要无主(能当几国之间的中立地);lasting:只数从开场起撑过这么多年的国家(故事里没有国家时用它代替「故事讲多少年」)
   */
  | { kind: 'junction'; min: number; unowned?: boolean; lasting?: number }
  /** 故事讲多少年:故事里的国家从开场起都撑过这些年 */
  | { kind: 'span'; years: number }
  /**
   * 开场年份:直接写第 from–to 年;或者跟着故事里的一国(role)走 —— 开场那年它在第 era 个时代(不给 = 不管),min–max 年后进第 enter 个时代
   */
  | { kind: 'start'; from: number; to: number }
  | { kind: 'start'; role: number; era?: number; enter: number; min: number; max: number };

export type FinderCond = RoleCond | TogetherCond;

/** 故事里的一国 */
export interface FinderRole {
  /** 作者起的叫法(帝国、山国……;只在找世界那一页和打开后的侧栏里用;从大纲页来的用大纲里的国名) */
  name: string;
  /** 从大纲页来的:这一国在原来那个世界里是哪国(Polity.id)。找到以后大纲里的它换成结果里对上的那一国 */
  ref?: number;
  conds: RoleCond[];
}

export interface FinderQuery {
  roles: FinderRole[];
  together: TogetherCond[];
}

/** 叫法最多几个字 */
export const ROLE_NAME_MAX = 6;

/** 第 i 国找的时候不管它:自己没有条件,别的条件(和它接壤、跟着它定开场……)也没指着它 */
export function roleFree(q: FinderQuery, i: number): boolean {
  if (q.roles[i]?.conds.length) return false;
  if (q.roles.some((r) => r.conds.some((c) => 'other' in c && c.other === i))) return false;
  return !q.together.some((c) => c.kind === 'start' && 'role' in c && c.role === i);
}

/**
 * 真去搜的那一套条件:从大纲页来的几国里,自己没有条件、别的条件也没指着它的(找的时候不管它)去掉。
 * 其余照旧(下标跟着往前挪;都去掉了 = 原样)
 */
export function searchQuery(q: FinderQuery): FinderQuery {
  const keep = q.roles.map((_, i) => !roleFree(q, i));
  if (keep.every(Boolean)) return q;
  const at: number[] = [];
  let n = 0;
  keep.forEach((k) => at.push(k ? n++ : -1));
  return {
    roles: q.roles.filter((_, i) => keep[i]).map((r) => ({ ...r, conds: r.conds.map((c) => ('other' in c ? { ...c, other: at[c.other] } : c)) })),
    together: q.together.map((c) => (c.kind === 'start' && 'role' in c ? { ...c, role: at[c.role] } : c)),
  };
}

/**
 * 每个种子怎么生成(新建世界里设的):世界参数、推演参数。
 * map = 'each'(默认):每个种子换一张地图(地图种子 = 文明种子 = 这个种子);'fixed':都用 world.seed 这张地图(可带作者改过的地形、草图),
 * 只换文明种子(CivParams.civSeed = 这个种子)
 */
export interface FinderSetup {
  world: WorldParams;
  civ?: Partial<Pick<CivParams, 'endYear' | 'cultures' | 'polities' | 'regionArea' | 'pace' | 'birthSpan' | 'names' | 'frontier' | 'origins' | 'calamity'>>;
  map?: 'each' | 'fixed';
  terrain?: readonly TerrainOp[];
  sketch?: Sketch | null;
}

/** 大国:州数至少这么多 */
export const LARGE = 40;
/** 中等:州数至少这么多(不到 LARGE) */
export const MEDIUM_MIN = 10;
/** 小国:不到另一国的这么多倍 */
export const SMALL_RATIO = 0.5;
/** 故事里只有这一国时,"小国"比照这么大的另一国(默认不到 10 州) */
export const SMALL_ALONE = 20;
/** 不写开场年份时,在这几年里找(每 YEAR_STEP 年一个) */
export const DEFAULT_START = { from: 500, to: 2500 } as const;
export const YEAR_STEP = 10;
/** 跟着某国进某时代定开场时,那国前后每这么多年再看一个 */
export const ERA_YEAR_STEP = 5;

/** 条件在量出来的数(facts)、逐条判定(checks)里的顺序:先各国(按国、按条),再「一起」 */
export interface CondRef {
  /** 哪一国(FinderQuery.roles 的下标);「一起」= −1 */
  role: number;
  /** 在那一组里第几条 */
  index: number;
  cond: FinderCond;
}

export function condList(q: FinderQuery): CondRef[] {
  const out: CondRef[] = [];
  q.roles.forEach((r, role) => r.conds.forEach((cond, index) => out.push({ role, index, cond })));
  q.together.forEach((cond, index) => out.push({ role: -1, index, cond }));
  return out;
}

// ---------------------------------------------------------------------------
// 量出来的数、判定

/**
 * 一条条件量出来的数(和门槛无关;measure.ts 按条件的种类量,null = 量不出:例如两国不接壤就没有隘口)。各种类的含义:
 * - size:[州数, 故事里别国最大的州数(没有 = 0), 最大的邻国州数(没有 = 0)]
 * - neighbors / ports:[个数];age:[立国几年];era:[时代];elevation:[米];mountain:[翻山的边界占几成 0–1];higher:[比另一国高几米]
 * - eraEnter / fate / war:[开场后几年(没有 = null)];border:[共同边界长(世界单位;不接壤 = 0)]
 * - pass:[口子高, 山脊高, 和口子差不多低的有几对, 交界上几对地块, 口子那一块地块];交界太短、不接壤 = null
 * - conquer:[开场后占的每一州是第几年占下的……](按先后;同一州丢了又夺回来只算第一次)
 * - junction(每国):[挨着几国, 那州];junction(一起):[挨着几国, 那州, 无主的州里最多挨着几国, 那州](没有 = −1)
 * - span:[故事里的国家从开场起最短撑了几年](故事里没有国家 = null,不用判)
 * - start:直接写年份的 [开场年份];跟着一国走的 [那国开场时的时代, 开场后几年进 enter 那个时代(没有 = null)]
 */
export type Fact = (number | null)[] | null;

/** 一条条件的判定 */
export interface Check {
  ok: boolean;
  /** 量出来的主要那个数(界面上写"实际 …":州数、个数、几成、米、开场后几年……;隘口 = 口子比山脊低几米);量不出 = null */
  value: number | null;
  /**
   * 合得多好:合的是 0–1(超出门槛多少折成的;刚够门槛 = 0,远超 = 1);
   * 不合的是 −1–0(差得多远:差一点点 ≈ 0,差得远、量不出 = −1)。差一条的世界按它排:差一点点的在前
   */
  quality: number;
  /**
   * 不合时差在哪一点(一条条件里有几样要求的才给):pass 'none' 不接壤或交界太短 / 'gap' 口子比山脊低得不够 /
   * 'shape' 不像关隘(山脊不到 PASS_RIDGE、口子不够深)/ 'wide' 能过的地方太多;start 'era' 开场时不在那个时代 / 'enter' 进时代的年份不对
   */
  why?: string;
}

export interface Verdict {
  checks: Check[];
  /** 差几条 */
  misses: number;
  /** 合得多好:各条 quality 加起来(全合的只加合得多好;差一条的还减去差得多远) */
  score: number;
}

const clamp01 = (x: number) => (x > 0 ? (x < 1 ? x : 1) : 0);
const num = (v: number | null | undefined): number | null => (v === null || v === undefined ? null : v);

const yes = (value: number | null, quality = 1): Check => ({ ok: true, value, quality });
/** 不合:off = 差得多远(0–1) */
const no = (value: number | null, off = 1, why?: string): Check => ({ ok: false, value, quality: -clamp01(off), ...(why ? { why } : {}) });

/**
 * 有下限、上限的一个数:上下都给 = 在范围里就满分;只给下限 = 超出 sMin 满分;只给上限 = 低出 sMax 满分。
 * 差得多远也按 sMin、sMax 折
 */
function bounded(v: number | null, min: number | undefined, max: number | undefined, sMin: number, sMax: number): Check {
  if (v === null) return no(null);
  if (min !== undefined && v < min) return no(v, (min - v) / sMin);
  if (max !== undefined && v > max) return no(v, (v - max) / sMax);
  const quality = min !== undefined && max !== undefined ? 1 : min !== undefined ? clamp01((v - min) / sMin) : max !== undefined ? clamp01((max - v) / sMax) : 1;
  return yes(v, quality);
}

/** 开场后 min–max 年里的一件事:差几年按范围的宽窄折(至少按 10 年折) */
function within(v: number | null, min: number, max: number, why?: string): Check {
  if (v !== null && v >= min && v <= max) return yes(v);
  const w = Math.max(10, max - min);
  return no(v, v === null ? 1 : v < min ? (min - v) / w : (v - max) / w, why);
}

/** 一条条件合不合 */
export function judgeCond(c: FinderCond, f: Fact): Check {
  switch (c.kind) {
    case 'size': {
      const v = num(f?.[0]);
      if (v === null) return no(null);
      if (c.size === 'small') {
        const other = num(f?.[1]) ?? 0;
        const limit = (c.ratio ?? SMALL_RATIO) * (other > 0 ? other : SMALL_ALONE);
        return v < limit ? yes(v, clamp01(1 - v / limit)) : no(v, (v - limit + 1) / limit);
      }
      if (c.size === 'medium') return v >= MEDIUM_MIN && v < LARGE ? yes(v) : no(v, v < MEDIUM_MIN ? (MEDIUM_MIN - v) / MEDIUM_MIN : (v - LARGE + 1) / LARGE);
      if (c.size === 'large') return v >= LARGE ? yes(v, clamp01((v - LARGE) / LARGE)) : no(v, (LARGE - v) / LARGE);
      if (c.size === 'top') {
        const nb = num(f?.[2]) ?? 0;
        return v > nb ? yes(v, clamp01((v - nb) / Math.max(1, nb))) : no(v, (nb - v + 1) / Math.max(1, nb));
      }
      return bounded(v, c.min, c.max, Math.max(1, (c.min ?? 0) / 2), Math.max(1, (c.max ?? 0) / 2));
    }
    case 'neighbors':
      return bounded(num(f?.[0]), c.min, c.max, Math.max(1, (c.min ?? 0) / 2), Math.max(1, (c.max ?? 0) / 2));
    case 'ports':
      return bounded(num(f?.[0]), c.min, undefined, Math.max(1, c.min), 1);
    case 'age':
      return bounded(num(f?.[0]), c.min, c.max, Math.max(50, (c.min ?? 0) / 2), Math.max(50, (c.max ?? 0) / 2));
    case 'era': {
      const v = num(f?.[0]);
      return v === c.era ? yes(v) : no(v);
    }
    case 'eraEnter':
      return within(num(f?.[0]), c.min, c.max);
    case 'fate':
    case 'war': {
      const v = num(f?.[0]);
      return v !== null && v <= c.within ? yes(v) : no(v, v === null ? 1 : (v - c.within) / Math.max(10, c.within));
    }
    case 'mountain':
      return bounded(num(f?.[0]), c.min, undefined, Math.max(0.1, c.min), 1);
    case 'elevation':
      return bounded(num(f?.[0]), c.min, undefined, Math.max(300, c.min / 2), 1);
    case 'higher':
      return bounded(num(f?.[0]), c.by, undefined, Math.max(200, c.by), 1);
    case 'border': {
      const v = num(f?.[0]);
      return v !== null && v > 0 ? yes(v) : no(v ?? 0);
    }
    case 'pass': {
      if (!f) return no(null, 1, 'none');
      const [height, ridge, narrow, pairs, cell] = f.map((x) => x ?? 0);
      const gap = ridge - height;
      const m = { cell, height, ridge, pairs, narrow };
      if (isPass(m, c.gap, c.narrow)) return yes(gap, clamp01((gap - c.gap) / (1.5 * Math.max(1, c.gap))));
      // 差在哪:口子不够低;不像关隘(山脊不够高、口子不够深);能过的地方太多
      if (gap < c.gap) return no(gap, (c.gap - gap) / Math.max(1, c.gap), 'gap');
      if (!isPass(m, 0, Infinity)) return no(gap, 1, 'shape');
      return no(gap, (narrow - c.narrow) / (c.narrow + 2), 'wide');
    }
    case 'conquer': {
      let n = 0;
      for (const t of f ?? []) if (t !== null && t <= c.within) n++;
      return n >= c.min ? yes(n) : no(n, (c.min - n) / Math.max(1, c.min));
    }
    case 'junction': {
      const all = num(f?.[0]) ?? 0;
      const short = (n: number) => no(n, (c.min - n) / Math.max(1, c.min));
      // 每国一组的(它自己的一州)只量了两个数
      if (!f || f.length < 4) return all >= c.min ? yes(all, clamp01(all - c.min)) : short(all);
      const free = num(f[2]) ?? 0;
      if ('unowned' in c && c.unowned) return free >= c.min ? yes(free, clamp01(free - c.min)) : short(free);
      return all >= c.min ? yes(all, 0.5 * clamp01(all - c.min) + (free >= c.min ? 0.5 : 0)) : short(all);
    }
    case 'span': {
      if (!f) return yes(null);
      return bounded(num(f[0]), c.years, undefined, Math.max(30, c.years / 2), 1);
    }
    case 'start': {
      if ('from' in c) return within(num(f?.[0]), c.from, c.to);
      const era = num(f?.[0]);
      const v = num(f?.[1]);
      if (c.era !== undefined && era !== c.era) return no(v, 1, 'era');
      return within(v, c.min, c.max, 'enter');
    }
  }
}

/** 一种配法逐条判(facts 和 condList(q) 一一对应) */
export function judge(q: FinderQuery, facts: readonly Fact[]): Verdict {
  const list = condList(q);
  const checks: Check[] = [];
  let misses = 0;
  let score = 0;
  for (let i = 0; i < list.length; i++) {
    const ch = judgeCond(list[i].cond, facts[i] ?? null);
    checks.push(ch);
    score += ch.quality;
    if (!ch.ok) misses++;
  }
  return { checks, misses, score };
}

/** 排先后:差得少的在前;一样就合得好的在前;再一样就开场早的、国家编号小的在前(同样条件谁搜都一样) */
export interface Ranked {
  misses: number;
  score: number;
  year: number;
  roles: readonly number[];
}

export function rankCompare(a: Ranked, b: Ranked): number {
  if (a.misses !== b.misses) return a.misses - b.misses;
  if (a.score !== b.score) return b.score - a.score;
  if (a.year !== b.year) return a.year - b.year;
  for (let i = 0; i < Math.min(a.roles.length, b.roles.length); i++) if (a.roles[i] !== b.roles[i]) return a.roles[i] - b.roles[i];
  return a.roles.length - b.roles.length;
}

// ---------------------------------------------------------------------------
// 放宽一点

const round = (x: number, step: number) => Math.round(x / step) * step;
/** 下限放宽:取个整,但不比原来的高(原来的数很小时取整可能反而变严) */
const lower = (orig: number, x: number, step: number) => Math.min(orig, round(x, step));
/** 上限放宽:取个整,但不比原来的低 */
const upper = (orig: number, x: number, step: number) => Math.max(orig, round(x, step));

/** 一条条件松一档(合这一条的只多不少,量什么不变);松不了(时代、接壤、只要一座港口……)= null */
export function relaxCond(c: FinderCond): FinderCond | null {
  switch (c.kind) {
    case 'size':
      if (c.size === 'small') return { ...c, ratio: upper(c.ratio ?? SMALL_RATIO, ((c.ratio ?? SMALL_RATIO) * 4) / 3, 0.01) };
      if (c.size === 'large') return { kind: 'size', min: lower(LARGE, LARGE * 0.75, 1) };
      if (c.size === 'medium') return { kind: 'size', min: lower(MEDIUM_MIN, MEDIUM_MIN * 0.75, 1), max: upper(LARGE - 1, (LARGE - 1) * 1.25, 1) };
      if (c.size === 'top') return null;
      if (c.min === undefined && c.max === undefined) return null;
      return { kind: 'size', ...(c.min !== undefined ? { min: Math.floor(c.min * 0.75) } : {}), ...(c.max !== undefined ? { max: Math.ceil(c.max * 1.25) } : {}) };
    case 'neighbors':
      if ((c.min ?? 0) <= 1 && c.max === undefined) return null;
      return { kind: 'neighbors', ...(c.min !== undefined ? { min: Math.min(c.min, Math.max(1, c.min - 1)) } : {}), ...(c.max !== undefined ? { max: c.max + 1 } : {}) };
    case 'ports':
      return c.min > 1 ? { ...c, min: c.min - 1 } : null;
    case 'age':
      if (c.min === undefined && c.max === undefined) return null;
      return { kind: 'age', ...(c.min !== undefined ? { min: lower(c.min, c.min * 0.75, 10) } : {}), ...(c.max !== undefined ? { max: upper(c.max, c.max * 1.25, 10) } : {}) };
    case 'era':
    case 'border':
      return null;
    case 'eraEnter': {
      const pad = Math.max(5, round((c.max - c.min) / 4, 5));
      return { ...c, min: Math.min(c.min, Math.max(0, c.min - pad)), max: c.max + pad };
    }
    case 'fate':
    case 'war':
      return { ...c, within: upper(c.within, c.within * 1.25, 10) };
    case 'mountain':
      return c.min > 0.05 ? { ...c, min: lower(c.min, Math.max(0.05, c.min / 2), 0.05) } : null;
    case 'elevation':
      return c.min > 0 ? { ...c, min: lower(c.min, c.min * 0.75, 50) } : null;
    case 'higher':
      return c.by > 0 ? { ...c, by: lower(c.by, c.by / 2, 50) } : null;
    case 'pass':
      return { ...c, gap: lower(c.gap, (c.gap * 2) / 3, 50), narrow: c.narrow + 1 };
    case 'conquer':
      return { ...c, within: upper(c.within, c.within * 1.25, 10), min: Math.min(c.min, Math.max(1, c.min - 1)) };
    case 'junction':
      if ('unowned' in c && c.unowned) return { ...c, unowned: false };
      return c.min > 2 ? { ...c, min: c.min - 1 } : null;
    case 'span':
      return c.years > 10 ? { ...c, years: lower(c.years, c.years * 0.75, 10) } : null;
    case 'start': {
      if ('from' in c) {
        const pad = Math.max(50, round((c.to - c.from) / 4, 10));
        return { ...c, from: Math.min(c.from, Math.max(0, c.from - pad)), to: c.to + pad };
      }
      const pad = Math.max(5, round((c.max - c.min) / 4, 5));
      return { ...c, min: Math.min(c.min, Math.max(0, c.min - pad)), max: c.max + pad };
    }
  }
}

/** 第 which 几条(condList 的下标)各松一档以后的条件;松不了的照旧 */
export function relaxQuery(q: FinderQuery, which: readonly number[]): FinderQuery {
  if (!which.length) return q;
  const set = new Set(which);
  let i = 0;
  const pick = <T extends FinderCond>(c: T): T => (set.has(i++) ? ((relaxCond(c) as T | null) ?? c) : c);
  const roles = q.roles.map((r) => ({ ...r, conds: r.conds.map(pick) }));
  const together = q.together.map(pick);
  return { roles, together };
}

/** 两两一起放宽:能放宽的条件不超过这么多条才列 */
const MAX_PAIR_CONDS = 12;

/**
 * 一次搜顺手对的几种门槛(每种 = 放宽哪几条,condList 的下标):第 0 种是作者写的;然后每条单独松一档、两条一起松、全部松。
 * 后台线程按每一种都挑出最合的配法留着,「放宽一点试试」换成哪一种都马上出,不用重推
 */
export function relaxVariants(q: FinderQuery): number[][] {
  const can: number[] = [];
  condList(q).forEach((r, i) => {
    if (relaxCond(r.cond)) can.push(i);
  });
  const out: number[][] = [[]];
  for (const i of can) out.push([i]);
  if (can.length <= MAX_PAIR_CONDS) for (let a = 0; a < can.length; a++) for (let b = a + 1; b < can.length; b++) out.push([can[a], can[b]]);
  if (can.length > 2) out.push(can.slice());
  return out;
}

// ---------------------------------------------------------------------------
// 一个种子的结果(后台线程交回来的)

/** 结果里的一处地方:隘口、交界、港口(地图上贴小牌子、点一行飞过去用) */
export interface FinderPlace {
  /** 哪条条件(condList 的下标) */
  cond: number;
  kind: 'pass' | 'junction' | 'port';
  /** 地块:隘口 = 口子那一块;交界 = 那州的治所;港口 = 港城所在的地块 */
  cell: number;
  /** 州 */
  region: number;
  /** 港口:哪座城(Settlement.id) */
  settlement?: number;
  /** 牵涉的国家:隘口两边;交界那州碰到的几家;港口所属的那国 */
  polities: number[];
  /**
   * 「一起」的交界两处都给:false = 挨着最多国的州,true = 无主的州里挨着最多国的。
   * 用哪一处看那条条件(放宽以后)要不要无主:界面用 FinderRow.places(placesFor 挑好的),别直接用 FinderCand.places
   */
  free?: boolean;
}

/** 后来怎样:从编年史里挑的一条 */
export interface FinderStoryLine {
  /** 年份(取整) */
  year: number;
  /** 一个字的标签(编年史的小印章) */
  tag: string;
  /** 纪事正文(不带年份;国名是那年的) */
  text: string;
  polities: number[];
  regions: number[];
}

/** 一种配法 */
export interface FinderCand {
  /** 开场年份 */
  year: number;
  /** 故事里每国对上哪一国(Polity.id;下标同 FinderQuery.roles) */
  roles: number[];
  /** 那年的国名(下标同 roles) */
  names: string[];
  /** 那年几州(下标同 roles) */
  sizes: number[];
  /** 逐条量出来的数(下标同 condList) */
  facts: Fact[];
  /** 那年各国的国都(Settlement.id 和所在地块;下标同 roles) */
  capitals: { settlement: number; cell: number }[];
  places: FinderPlace[];
  /** 开场以后故事里的国家发生了什么(编年史挑几条,按年份;差两条以上的不挑 = 空) */
  story: FinderStoryLine[];
  /** 列表里的小图(各种门槛下最合、差一条以内的才有;measure.ts 的 thumbOf) */
  thumb?: FinderThumb;
}

/**
 * 列表里的小图:开场那年的国家图,w × h 个像素,每个像素是调色板 pal 的下标(0 海、1 没有国家的陆地、2 起各国,pal 里是 0xRRGGBB);
 * ter = 每个像素的地形(打底用:0 海、1 平地、2 干地、3 丘陵、4 高山、5 冰雪);dots = 故事里各国国都在图上的位置(x, y 一对一对,下标同 roles);
 * win = 框的是世界上哪一块(世界坐标 x0, y0, 宽, 高;x 左右接着)。
 * 浏览器的后台线程能画图时,另外照这一块画成手绘地图的样子(img:JPEG,宽高是 w、h 的两倍,国都的圆点已经画上),这时 px、ter 是空的
 */
export interface FinderThumb {
  w: number;
  h: number;
  pal: number[];
  px: Uint8Array;
  ter: Uint8Array;
  dots: number[];
  win?: [number, number, number, number];
  img?: ArrayBuffer;
}

/** 一个种子推完、量完交回来的 */
export interface SeedReport {
  seed: number;
  /** 推这一个用了多久(毫秒) */
  ms: number;
  /** 长出文明了(长不出来的星球一种配法都没有) */
  viable: boolean;
  /** 出错了(推演报错;这个种子算没找到) */
  error?: string;
  /** 量了几种配法 */
  tried: number;
  /** 留下的配法(下面几项按下标引用) */
  cands: FinderCand[];
  /** relaxVariants(q) 每一种门槛下最合的配法(cands 的下标;一种配法都没有 = −1) */
  best: number[];
  /** 作者写的门槛下,换一种配法:别的国家组合各自最合的那个(差一条以内,排好序,最多 ALT_KEEP 个,不含 best[0] 那组) */
  alts: number[];
}

export const ALT_KEEP = 4;

// ---------------------------------------------------------------------------
// 一批结果汇总

/** 列表里的一行:一个世界最合的那种配法 */
export interface FinderRow {
  seed: number;
  cand: FinderCand;
  verdict: Verdict;
  /** 地图上标的地方(按这一种门槛挑好的,见 placesFor) */
  places: FinderPlace[];
  /** 换一种配法(只在作者写的门槛下给) */
  alts: { cand: FinderCand; verdict: Verdict; places: FinderPlace[] }[];
}

/** 一种配法在某一种门槛(q)下要标的地方:「一起」的交界,条件要无主的用无主的那州,不要的用挨着最多国的那州 */
export function placesFor(q: FinderQuery, cand: Pick<FinderCand, 'places'>): FinderPlace[] {
  const list = condList(q);
  return cand.places.filter((p) => {
    if (p.free === undefined) return true;
    const c = list[p.cond]?.cond;
    return p.free === !!(c && c.kind === 'junction' && 'unowned' in c && c.unowned);
  });
}

/** 第 variant 种门槛(relaxVariants 的下标)的条件 */
function variantQuery(q: FinderQuery, variant: number, vs?: number[][]): FinderQuery {
  return variant ? relaxQuery(q, (vs ?? relaxVariants(q))[variant] ?? []) : q;
}

function rowOf(q: FinderQuery, vq: FinderQuery, report: SeedReport, variant: number): FinderRow | null {
  const k = report.best[variant] ?? -1;
  if (k < 0 || !report.cands[k]) return null;
  const cand = report.cands[k];
  const alts = variant ? [] : report.alts.map((i) => ({ cand: report.cands[i], verdict: judge(q, report.cands[i].facts), places: placesFor(q, report.cands[i]) }));
  return { seed: report.seed, cand, verdict: judge(vq, cand.facts), places: placesFor(vq, cand), alts };
}

/** 一个种子在第 variant 种门槛(relaxVariants 的下标)下最合的配法;一种配法都没有 = null */
export function bestRow(q: FinderQuery, report: SeedReport, variant = 0): FinderRow | null {
  return rowOf(q, variantQuery(q, variant), report, variant);
}

export type FinderSort = 'fit' | 'early' | 'late' | 'pass';

/** 排序:全合的在前,其次差一条;同样的按 by:最合(默认)/ 开场早的 / 开场晚的 / 隘口最险的(第一条隘口条件的口子比山脊低得多的) */
export function sortRows(q: FinderQuery, rows: FinderRow[], by: FinderSort = 'fit'): FinderRow[] {
  const pi = condList(q).findIndex((c) => c.cond.kind === 'pass');
  const gap = (r: FinderRow) => (pi >= 0 ? r.verdict.checks[pi]?.value : null) ?? -Infinity;
  const key = (r: FinderRow): Ranked => ({ misses: r.verdict.misses, score: r.verdict.score, year: r.cand.year, roles: r.cand.roles });
  return rows.slice().sort((a, b) => {
    if (a.verdict.misses !== b.verdict.misses) return a.verdict.misses - b.verdict.misses;
    if (by === 'early' && a.cand.year !== b.cand.year) return a.cand.year - b.cand.year;
    if (by === 'late' && a.cand.year !== b.cand.year) return b.cand.year - a.cand.year;
    if (by === 'pass' && gap(a) !== gap(b)) return gap(b) - gap(a);
    return rankCompare(key(a), key(b)) || a.seed - b.seed;
  });
}

export interface FinderSummary {
  /** 推完了几个世界 */
  searched: number;
  /** 全合(排好序) */
  full: FinderRow[];
  /** 差一条(排好序) */
  near: FinderRow[];
  /** 差两条以上(含长不出文明、出错的):只计数 */
  worse: number;
  /** 每条条件(condList 的下标):几个世界最合的那种配法合这一条("卡在哪几条":最少的那条就是卡住的) */
  passCount: number[];
}

/** 一批结果在第 variant 种门槛下的汇总 */
export function summarize(q: FinderQuery, reports: readonly SeedReport[], variant = 0, by: FinderSort = 'fit'): FinderSummary {
  const full: FinderRow[] = [];
  const near: FinderRow[] = [];
  const passCount = condList(q).map(() => 0);
  const vq = variantQuery(q, variant);
  for (const rep of reports) {
    const row = rowOf(q, vq, rep, variant);
    if (!row) continue;
    row.verdict.checks.forEach((c, i) => {
      if (c.ok && i < passCount.length) passCount[i]++;
    });
    if (row.verdict.misses === 0) full.push(row);
    else if (row.verdict.misses === 1) near.push(row);
  }
  return { searched: reports.length, full: sortRows(q, full, by), near: sortRows(q, near, by), worse: reports.length - full.length - near.length, passCount };
}

/** 放宽一点试试:放宽哪几条(condList 的下标)、能有几个全合、几个差一条 */
export interface RelaxHint {
  /** relaxVariants 的下标(summarize、bestRow 的 variant) */
  variant: number;
  which: number[];
  full: number;
  near: number;
}

/** 每种放宽各能有几个全合、差一条(不含作者写的那种) */
export function relaxCounts(q: FinderQuery, reports: readonly SeedReport[]): RelaxHint[] {
  const vs = relaxVariants(q);
  const out: RelaxHint[] = [];
  for (let v = 1; v < vs.length; v++) {
    let full = 0;
    let near = 0;
    const vq = variantQuery(q, v, vs);
    for (const rep of reports) {
      const row = rowOf(q, vq, rep, v);
      if (row?.verdict.misses === 0) full++;
      else if (row?.verdict.misses === 1) near++;
    }
    out.push({ variant: v, which: vs[v], full, near });
  }
  return out;
}

/**
 * 「放宽一点试试」挑几种给作者看:单放宽一条就能多出全合的,按多出的多少挑前两种;再加上这两条一起放宽(比单放宽哪一条都多时)。
 * 单放宽哪一条都不多的,挑两两一起放宽里多出最多的一种,再不行就全部放宽
 */
export function relaxHints(q: FinderQuery, reports: readonly SeedReport[], limit = 3): RelaxHint[] {
  const base = summarize(q, reports).full.length;
  const all = relaxCounts(q, reports).filter((h) => h.full > base);
  const byGain = (a: RelaxHint, b: RelaxHint) => b.full - a.full || b.near - a.near || a.variant - b.variant;
  const singles = all.filter((h) => h.which.length === 1).sort(byGain);
  const out = singles.slice(0, Math.min(2, limit));
  if (out.length === 2 && out.length < limit) {
    const pair = all.find((h) => h.which.length === 2 && h.which.includes(out[0].which[0]) && h.which.includes(out[1].which[0]));
    if (pair && pair.full > out[0].full) out.push(pair);
  }
  if (!out.length) {
    const multi = all.filter((h) => h.which.length > 1).sort(byGain);
    if (multi.length) out.push(multi[0]);
  }
  return out.slice(0, limit);
}

/** 接着搜:从 from 起、还没推过(不在 done 里)的 count 个种子(停下时没推完的先补上;同样条件谁搜都一样) */
export function nextSeeds(done: ReadonlySet<number>, count: number, from = 1): number[] {
  const out: number[] = [];
  for (let s = Math.max(1, Math.floor(from)); out.length < count; s++) if (!done.has(s)) out.push(s);
  return out;
}

// ---------------------------------------------------------------------------
// 例子(条件页顶上一排,点了填好再改)

export interface FinderPreset {
  id: 'mountain-pass' | 'crossroads' | 'sea-power' | 'great-fall';
  name: string;
  query: FinderQuery;
}

export const FINDER_PRESETS: readonly FinderPreset[] = [
  {
    // 帝国(大国、至少 4 个邻国、有港口)+ 山国(小国、两成翻山、和帝国隔山有隘口)+ 一州挨着 3 国 + 讲 130 年 + 帝国在青铜时代、15–50 年后进铁器
    id: 'mountain-pass',
    name: '山国守隘口',
    query: {
      roles: [
        { name: '帝国', conds: [{ kind: 'size', size: 'large' }, { kind: 'neighbors', min: 4 }, { kind: 'ports', min: 1 }] },
        { name: '山国', conds: [{ kind: 'size', size: 'small' }, { kind: 'mountain', min: 0.2 }, { kind: 'pass', other: 0, gap: 800, narrow: 2 }] },
      ],
      together: [
        { kind: 'junction', min: 3 },
        { kind: 'span', years: 130 },
        { kind: 'start', role: 0, era: 1, enter: 2, min: 15, max: 50 },
      ],
    },
  },
  {
    // 一州同时挨着 4 国、无主,4 国都撑 100 年
    id: 'crossroads',
    name: '几国交界',
    query: { roles: [], together: [{ kind: 'junction', min: 4, unowned: true, lasting: 100 }] },
  },
  {
    // 一国至少 5 个通航线的港口、邻国不超过 2 个,从开场撑 200 年
    id: 'sea-power',
    name: '海上强国',
    query: {
      roles: [{ name: '海国', conds: [{ kind: 'ports', min: 5 }, { kind: 'neighbors', max: 2 }] }],
      together: [{ kind: 'span', years: 200 }],
    },
  },
  {
    // 开场时一个大国(附近最大),开场后 100 年内分裂或亡
    id: 'great-fall',
    name: '大国分崩',
    query: {
      roles: [{ name: '大国', conds: [{ kind: 'size', size: 'large' }, { kind: 'size', size: 'top' }, { kind: 'fate', within: 100, what: ['split', 'fall'] }] }],
      together: [],
    },
  },
];

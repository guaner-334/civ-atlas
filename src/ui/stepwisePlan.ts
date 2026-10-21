/**
 * 逐年推演的节奏(纯计算):一步走几年、走完停不停 —— 照推进设置(gen/edits.ts 文件头"推进设置",advanceOf 取)。
 * 不碰 DOM,单测直接测(tests/stepwise.test.ts)。从第几年开始、存回推演模式在 gen/stepwise.ts。
 *
 * - 一步走 step 年,但不跨过下一次该停的那年(正好停在那一年年初):since = 上一次停下来的那一年(开始逐年推演的那年、
 *   每停一下、读档打开时都从"现在"重新数),下一次停在 since 以后第一个 since + k·every(比现在晚的)。
 *   推进设置中途改了,下一步起照新的算(since 不变)。到能推的最后一年(END_YEAR_MAX)停下、不再往下走。
 * - 勾了"出大事也停":这一步([从, 到),和导播排期一样含头不含尾)里出了头等大事就停 ——
 *   分量照导播排期(directorPlan.ts 的 tierOf:亡国、改朝换代、大战、分裂、大崩解、民变、民族消亡)。算这一步里的:
 *   这一步里开始的头等大事;前几步就开始了、跨年的条目(打了好几年的仗),这一步里才成了头等大事的(打下的州够多了、
 *   灭了大国……;要给走这一步以前的编年史才看得出来),或者这一步里有一件头等大事的(仗里亡了国)。
 *   干预、地形大事不算:是作者自己安排的,本来就知道;刚停下来加的干预下一步就生效,算进去的话每加一次干预就又停一次。
 * - 同一步里几样都碰上了,按 到头 > 每隔几年 > 出大事 说。
 */
import type { ChronicleEntry } from '../gen/civ/chronicle';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import type { Era } from '../gen/era';
import { END_YEAR_MAX, type Advance } from '../gen/edits';
import { directorCards, tierOf, type DirectorCaption, type DirectorShot } from './directorPlan';
import { entryWeight } from './timelineLayout';

/** 下一步 */
export interface StepPlan {
  /** 走几年(整数,1–ADVANCE_STEP_MAX;0 = 已经到 END_YEAR_MAX,走不动了) */
  years: number;
  /** 走完停在第几年年初 */
  to: number;
  /** 走完要不要停一下:'every' = 到了"每隔几年";'end' = 到了能推的最后一年;null = 不用(勾了"出大事也停"的,走完用 stepPause 再看) */
  pause: 'every' | 'end' | null;
}

/** 停一下的原因:到头了 / 到了"每隔几年" / 出了大事 */
export type PauseWhy = 'end' | 'every' | 'big';

/** 从第 since 年数起,下一次按"每隔几年"停在哪年(比 now 晚的第一个 since + k·every,k ≥ 1;到 END_YEAR_MAX 为止) */
export function pauseYear(advance: Pick<Advance, 'every'>, since: number, now: number): number {
  const every = Math.max(1, Math.round(advance.every));
  const k = now < since ? 1 : Math.floor((now - since) / every) + 1;
  return Math.min(END_YEAR_MAX, since + k * every);
}

/** 现在停在第 now 年年初、上一次停在第 since 年:下一步走几年、走完停不停(出大事的走完再看) */
export function nextStep(advance: Pick<Advance, 'step' | 'every'>, since: number, now: number): StepPlan {
  const at = Math.round(now);
  if (at >= END_YEAR_MAX) return { years: 0, to: at, pause: 'end' };
  const stop = pauseYear(advance, Math.round(since), at);
  const years = Math.max(1, Math.min(Math.round(advance.step), stop - at, END_YEAR_MAX - at));
  const to = at + years;
  return { years, to, pause: to >= END_YEAR_MAX ? 'end' : to === stop ? 'every' : null };
}

/** 作者自己安排的(干预、地形大事):出大事也停不算 */
const own = (e: ChronicleEntry) => e.kind === 'intervene' || e.kind === 'upheaval';
const big = (e: ChronicleEntry) => !own(e) && tierOf(e) === 'big';

/**
 * [from, to) 这一步里的头等大事(出大事也停看的那几种;按编年史的先后):这一步里开始的头等大事,
 * 前几步就开始了、这一步里才成了头等大事的(要给 before = 走这一步以前的编年史;不给就不看这一种),
 * 前几步就开始了、这一步里有一件头等大事的(列的是整条,比如那场仗)。
 * entries、before 都是 fullChronicle 那一份(编号是第一条史事的下标,接着推不变)
 */
export function bigEntries(entries: readonly ChronicleEntry[], from: number, to: number, before?: readonly ChronicleEntry[]): ChronicleEntry[] {
  let was: Set<number> | null = null;
  if (before) {
    was = new Set();
    for (const e of before) if (big(e)) was.add(e.id);
  }
  return entries.filter((e) => {
    if (own(e) || e.year >= to) return false;
    if (e.year >= from) return tierOf(e) === 'big';
    if (was && big(e) && !was.has(e.id)) return true;
    return !!e.children?.some((c) => c.year >= from && c.year < to && big(c));
  });
}

/**
 * 这一步(从 from 年走到 step.to 年)走完停不停:why = 原因(null = 接着走);big = 这一步里的头等大事(没勾"出大事也停"也列出来)。
 * entries = 走完以后的编年史,before = 走这一步以前的(fullChronicle 那一份;不给就看不出跨年的条目这一步里才成了大事的)
 */
export function stepPause(
  advance: Pick<Advance, 'big'>,
  from: number,
  step: StepPlan,
  entries: readonly ChronicleEntry[],
  before?: readonly ChronicleEntry[],
): { why: PauseWhy | null; big: ChronicleEntry[] } {
  const list = bigEntries(entries, from, step.to, before);
  const why: PauseWhy | null = step.pause ?? (advance.big && list.length ? 'big' : null);
  return { why, big: list };
}

// ---------------------------------------------------------------------------
// 放的快慢、停一下时看哪几件(界面用,见 Stepwise.tsx)

/**
 * 逐年推演往下走的速度(每秒几年):固定速度 1× / 4×;导播"自动"节奏里没事的年份按 4× 走。
 * 比推演模式慢得多(那边每秒几十年):历史是一步一步现算的,算得比放得慢就再放慢一点等它(stepRate)
 */
export const STEP_RATE: Readonly<Record<1 | 4, number>> = { 1: 2, 4: 8 };

/** 放的速度最多是"算一步"速度的几成(留一点余量,播放头不追上还在算的那一步) */
export const STEP_RATE_SHARE = 0.85;

/** 实际用的速度:想要的 want(每秒几年);算得比它慢时按算的速度打折(computed = 最近几步每秒算几年;还不知道 = null) */
export function stepRate(want: number, computed: number | null): number {
  if (computed === null || !(computed > 0)) return want;
  return Math.max(0.25, Math.min(want, computed * STEP_RATE_SHARE));
}

/**
 * 播放头快追上还在算的那一步了:放慢一点等它,不一下子停住。gap = 离算好的最后一年还剩几年,rate = 每秒几年;
 * 离到头还有 STEP_EASE 秒以上照常走,越近越慢,最慢 STEP_EASE_MIN 倍
 */
export const STEP_EASE = 0.6;
export const STEP_EASE_MIN = 0.15;
export function stepEase(gap: number, rate: number): number {
  if (!(rate > 0)) return 1;
  const t = Math.max(0, gap) / rate;
  return Math.min(1, Math.max(STEP_EASE_MIN, t / STEP_EASE));
}

/** 停一下时卡片里的一件:字幕(类型、年份、原句、事发地)+ 镜头去哪 */
export interface StepReviewItem {
  cap: DirectorCaption;
  shot: DirectorShot | null;
}

/**
 * 只放这一段的时间轴上画哪几件:一段只有几十年,比整段历史的时间轴细一层 —— 大事(重要度 3)之外,重要度 2 的也画
 */
export const STEP_DOT_IMPORTANCE = 2;
/**
 * 停一下时卡片里列哪几件:分量(timelineLayout.ts 的 entryWeight)不小于这个的 —— 大事都列,
 * 重要度 2 的只列亡国、分裂、打仗、改朝换代、民变这类(种类分量 ≥ 5);一段里最多 REVIEW_MAX 件,多了留分量重的
 */
export const REVIEW_WEIGHT = 25;
export const REVIEW_MAX = 12;

/** 停一下时卡片里列的这一段([from, to))的大事,按先后。entries = fullChronicle 那一份 */
export function reviewItems(world: World, civ: Civ, from: number, to: number, entries: readonly ChronicleEntry[], era?: Era | null): StepReviewItem[] {
  if (!(to > from)) return [];
  let pick = entries.filter((e) => e.year >= from && e.year < to && entryWeight(e) >= REVIEW_WEIGHT);
  if (pick.length > REVIEW_MAX) pick = [...pick].sort((a, b) => entryWeight(b) - entryWeight(a) || a.year - b.year || a.id - b.id).slice(0, REVIEW_MAX);
  pick.sort((a, b) => a.year - b.year || a.id - b.id);
  return directorCards(world, civ, pick, era);
}

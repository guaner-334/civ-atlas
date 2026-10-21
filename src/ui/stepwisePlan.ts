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
import { END_YEAR_MAX, type Advance } from '../gen/edits';
import { tierOf } from './directorPlan';

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

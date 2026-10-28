/**
 * 逐年推演的节奏(纯计算):一步走多久、走完停不停 —— 照推进设置(gen/edits.ts 文件头"推进设置",advanceOf 取)。
 * 不碰 DOM,单测直接测(tests/stepwise.test.ts)。从第几年开始、存回推演模式在 gen/stepwise.ts。
 *
 * 时刻都按"格"算(一年 YEAR_TICKS 格,见 edits.ts 文件头"时刻"):界面上的年份带小数,第 y 年第 k 格 = y + k / YEAR_TICKS(正好能用小数表示)。
 * - 一步走多久(stepEnd):按年走的走到几年以后的同一格;按格走的走几格;按月走的走到第几个月的月初
 *   (一年 N 个月,第 m 月从那一年第 ⌈(m − 1)·YEAR_TICKS / N⌉ 格起,和写到月的算法 era.ts 的 monthOf 对得上;停在月中的第一步只走到下个月初)。
 *   一步最长 5 年。
 * - 不跨过下一次该停的那一刻(正好停在那一刻):since = 上一次停下来的那一刻(开始逐年推演的那年、
 *   每停一下、读档打开时都从"现在"重新数),下一次停在 since 以后第一个 since + k·every 年(比现在晚的;年中停下的,every 年后同一格停);
 *   every = 0(每一步都停):每一步走完都停。推进设置中途改了,下一步起照新的算(since 不变)。到能推的最后一年(END_YEAR_MAX)停下、不再往下走。
 * - 勾了"出大事也停":这一步([从, 到),和导播排期一样含头不含尾)里出了头等大事就停 ——
 *   分量照导播排期(directorPlan.ts 的 tierOf:亡国、改朝换代、大战、分裂、大崩解、民变、民族消亡)。算这一步里的:
 *   这一步里开始的头等大事;前几步就开始了、跨年的条目(打了好几年的仗),这一步里才成了头等大事的(打下的州够多了、
 *   灭了大国……;要给走这一步以前的编年史才看得出来),或者这一步里有一件头等大事的(仗里亡了国)。
 *   干预、地形大事不算:是作者自己安排的,本来就知道;刚停下来加的干预下一步就生效,算进去的话每加一次干预就又停一次。
 * - 同一步里几样都碰上了,按 到头 > 每隔几年 > 出大事 说。
 * - 往回翻(stepPage):时间轴只放一段,以前的按这次演绎停过的那几刻切段,再往前按"每隔几年"切到第 0 年;
 *   从某一年重新演绎时弹窗里"不要了的历史"列几件大事的短句(rewindBrief)。
 */
import type { ChronicleEntry } from '../gen/civ/chronicle';
import type { Civ } from '../gen/civ/types';
import { polityShortTitle, polityTierAt } from '../gen/civ/growth';
import type { World } from '../gen/world';
import { MONTHS_DEFAULT, type Era } from '../gen/era';
import { ADVANCE_STEP_MAX, ADVANCE_TICKS_MAX, END_YEAR_MAX, YEAR_TICKS, type Advance } from '../gen/edits';
import { directorCards, tierOf, type DirectorCaption, type DirectorShot } from './directorPlan';
import { entryWeight } from './timelineLayout';

/** 下一步 */
export interface StepPlan {
  /** 走几格(1–ADVANCE_TICKS_MAX;0 = 已经到 END_YEAR_MAX,走不动了) */
  ticks: number;
  /** 走几年(= ticks / YEAR_TICKS,带小数) */
  years: number;
  /** 走完停在哪一刻(年份带小数,见文件头) */
  to: number;
  /** 走完要不要停一下:'every' = 到了"每隔几年"(每一步都停的每一步都是);'end' = 到了能推的最后一年;null = 不用(勾了"出大事也停"的,走完用 stepPause 再看) */
  pause: 'every' | 'end' | null;
}

/** 停一下的原因:到头了 / 到了"每隔几年" / 出了大事 */
export type PauseWhy = 'end' | 'every' | 'big';

/** 能推到的最后一刻(第几格) */
const END_TICK = END_YEAR_MAX * YEAR_TICKS;

/** 年份(带小数)→ 第几格(从第 0 年年初数起,取最近的整格) */
export const tickOf = (y: number): number => Math.round(y * YEAR_TICKS);

/** 按月走时一年几个月:只写年的世界(0)照 12 个月算 */
export const stepMonths = (months: number): number => (months > 0 ? Math.round(months) : MONTHS_DEFAULT);

/** 第 j 个月(从第 0 年第 1 月数起,0 起;一年 n 个月)从第几格起 */
export function monthStart(j: number, n: number): number {
  const y = Math.floor(j / n);
  return y * YEAR_TICKS + Math.ceil(((j - y * n) * YEAR_TICKS) / n);
}

/** 第 t 格落在第几个月(0 起,同 monthStart) */
export function monthIndex(t: number, n: number): number {
  const y = Math.floor(t / YEAR_TICKS);
  return y * n + Math.floor(((t - y * YEAR_TICKS) * n) / YEAR_TICKS);
}

/** 从第 t 格走一步走到第几格(没管该不该停、到没到头;最长 5 年)。months = 这个世界一年几个月(0 = 只写年,照 12 个月) */
export function stepEnd(advance: Pick<Advance, 'step' | 'unit'>, months: number, t: number): number {
  const k = Math.max(1, Math.round(advance.step) || 1);
  let to: number;
  if (advance.unit === 'tick') to = t + k;
  else if (advance.unit === 'month') {
    const n = stepMonths(months);
    to = monthStart(monthIndex(t, n) + Math.min(k, ADVANCE_STEP_MAX * n), n);
  } else to = t + Math.min(k, ADVANCE_STEP_MAX) * YEAR_TICKS;
  return Math.min(to, t + ADVANCE_TICKS_MAX);
}

/** 一步大约几年(说后果、画刻度用;按月走的按 1/月数 年算,最长 5 年) */
export function stepYears(advance: Pick<Advance, 'step' | 'unit'>, months: number): number {
  const k = Math.max(1, Math.round(advance.step) || 1);
  const y = advance.unit === 'tick' ? k / YEAR_TICKS : advance.unit === 'month' ? k / stepMonths(months) : k;
  return Math.min(ADVANCE_STEP_MAX, y);
}

/**
 * 从 since 那一刻数起,下一次该停在哪一刻(第几格;比 now 晚的第一个;到能推的最后一刻为止):
 * 每隔 every 年的 = since + k·every 年(k ≥ 1);每一步都停的(every = 0)= 从 since 走一步走到的那一刻(已经过了就从 now 再走一步)
 */
export function pauseTick(advance: Pick<Advance, 'every'> & Partial<Pick<Advance, 'step' | 'unit'>>, months: number, since: number, now: number): number {
  const every = Math.round(advance.every);
  if (!(every > 0)) {
    const a = { step: advance.step ?? 1, unit: advance.unit ?? 'year' };
    const p = stepEnd(a, months, since);
    return Math.min(END_TICK, p > now ? p : stepEnd(a, months, now));
  }
  const e = every * YEAR_TICKS;
  const k = now < since ? 1 : Math.floor((now - since) / e) + 1;
  return Math.min(END_TICK, since + k * e);
}

/** 同 pauseTick,按年份(带小数)给、按年份返回:从 since 数起,下一次按"每隔几年"停在哪一刻 */
export function pauseYear(
  advance: Pick<Advance, 'every'> & Partial<Pick<Advance, 'step' | 'unit'>>,
  since: number,
  now: number,
  months: number = MONTHS_DEFAULT,
): number {
  return pauseTick(advance, months, tickOf(since), tickOf(now)) / YEAR_TICKS;
}

/** 现在停在 now 那一刻、上一次停在 since:下一步走多久、走完停不停(出大事的走完再看)。months = 这个世界一年几个月 */
export function nextStep(advance: Pick<Advance, 'step' | 'unit' | 'every'>, since: number, now: number, months: number = MONTHS_DEFAULT): StepPlan {
  const at = tickOf(now);
  if (at >= END_TICK) return { ticks: 0, years: 0, to: at / YEAR_TICKS, pause: 'end' };
  const stop = pauseTick(advance, months, tickOf(since), at);
  const to = Math.min(stepEnd(advance, months, at), stop, END_TICK);
  const ticks = to - at;
  return { ticks, years: ticks / YEAR_TICKS, to: to / YEAR_TICKS, pause: to >= END_TICK ? 'end' : to === stop ? 'every' : null };
}

/**
 * 往下走时地图在哪一刻重画(播放头在 y):一步一年以上的一年重画一次(整年);一步短于一年的一步重画一次 ——
 * 按月走的每个月初,按格走的每一步的那几格(从第 0 年数起对齐)
 */
export function redrawAt(advance: Pick<Advance, 'step' | 'unit'>, months: number, y: number): number {
  const t = Math.floor(y * YEAR_TICKS + 1e-6);
  if (advance.unit === 'month') {
    const n = stepMonths(months);
    return monthStart(monthIndex(t, n), n) / YEAR_TICKS;
  }
  const k = advance.unit === 'tick' ? Math.max(1, Math.round(advance.step)) : YEAR_TICKS;
  if (k >= YEAR_TICKS) return Math.floor(y + 1e-9);
  return (Math.floor(t / k) * k) / YEAR_TICKS;
}

/**
 * 时间轴上一步一格的小刻度落在哪些时刻([from, to] 这一段里,不含两头;年份带小数):从 from 起一步一步走。
 * 一步不到这一段的 minShare(放不下)= 不画,返回空
 */
export function stepMarks(advance: Pick<Advance, 'step' | 'unit'>, months: number, from: number, to: number, minShare: number): number[] {
  if (!(to > from)) return [];
  if (stepYears(advance, months) / (to - from) < minShare) return [];
  const out: number[] = [];
  const end = tickOf(to);
  for (let t = stepEnd(advance, months, tickOf(from)); t < end && out.length < 4096; t = stepEnd(advance, months, t)) out.push(t / YEAR_TICKS);
  return out;
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

/**
 * 实际用的速度:想要的 want(每秒几年);算得比它慢时按算的速度打折(computed = 最近几步每秒算几年;还不知道 = null)。
 * 最慢 low 年 / 秒(一步一年以上 0.25;一步很短时跟着算的速度再慢下去,不追上还在算的那一步一顿一顿地走)
 */
export function stepRate(want: number, computed: number | null, low = 0.25): number {
  if (computed === null || !(computed > 0)) return want;
  return Math.max(Math.min(0.25, low), Math.min(want, computed * STEP_RATE_SHARE));
}

/** 每一步都停、这一步全世界没有大事:只停几秒(不管倒计时设的多少),写一句"全世界没有大事" */
export const EMPTY_STOP_SECS = 3;

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

// ---------------------------------------------------------------------------
// 往回翻:时间轴只放一段,两头「‹ ›」一段一段翻

/** 时间轴上的一段([from, to] 年);current = "现在"这一段(停一下的那一段 / 正在往下走的那一段) */
export interface StepPage {
  from: number;
  to: number;
  current: boolean;
}

/**
 * 第 y 年落在哪一段:在"现在"这一段(cur,含两头)里 = cur;更早的按这次演绎停过的那几年(marks:起演那年、每次停下 / 接着走的那年、
 * 倒回的那年)切开,两次之间、最早那次以前再按"每隔几年"(every)切:一段最长 every 年,最早到第 0 年
 */
export function stepPage(y: number, cur: { from: number; to: number }, marks: readonly number[], every: number): StepPage {
  if (y >= cur.from) return { from: cur.from, to: cur.to, current: true };
  const e = Math.max(1, Math.round(every));
  const ms = [...new Set(marks.filter((m) => Number.isFinite(m) && m >= 0 && m < cur.from))].sort((a, b) => a - b);
  ms.push(cur.from);
  const t = Math.max(0, y);
  let i = -1;
  for (let k = 0; k < ms.length && ms[k] <= t; k++) i = k;
  // 最早那次以前:从它往回每 every 年一段
  const a = i < 0 ? ms[0] : ms[i];
  const from = a + Math.floor((t - a) / e) * e;
  const to = i < 0 ? from + e : Math.min(from + e, ms[i + 1]);
  return { from: Math.max(0, from), to, current: false };
}

/** 上一段(「‹」;已经到第 0 年 = null) */
export function prevPage(p: StepPage, cur: { from: number; to: number }, marks: readonly number[], every: number): StepPage | null {
  return p.from <= 0 ? null : stepPage(p.from - 0.5, cur, marks, every);
}

/** 下一段(「›」;已经是"现在"这一段 = null) */
export function nextPage(p: StepPage, cur: { from: number; to: number }, marks: readonly number[], every: number): StepPage | null {
  return p.current ? null : stepPage(p.to, cur, marks, every);
}

/** 一国在第 y 年的简称("大霄王朝" → "大霄";地图上放不下全称时写的那个) */
function shortAt(civ: Civ, id: number | undefined, y: number): string {
  const p = id === undefined ? undefined : civ.polities[id];
  if (!p) return '';
  return polityShortTitle(p, Math.max(0, polityTierAt(p, y)), y) || p.name;
}

/** 一件事写成几个字("纳巴斯坦自立""大霄灭大康""有鹰代有桂");说不成短句的取正文第一截 */
function briefOf(civ: Civ, e: ChronicleEntry): string {
  const [a, b] = e.polities;
  const y = e.year;
  const A = shortAt(civ, a, y);
  const B = shortAt(civ, b, y);
  if (e.tag === '分' && A) return `${A}自立`;
  if (e.tag === '复' && A) return `${A}复国`;
  if (e.tag === '亡' && A) return B ? `${B}灭${A}` : `${A}亡`;
  // 改朝换代(掌实权的人篡位开的新朝标签是"篡")
  if ((e.tag === '朝' || (e.tag === '篡' && e.kind === 'dynasty')) && a !== undefined) {
    const old = shortAt(civ, a, y - 1 / 512);
    const now = shortAt(civ, a, y + 1 / 512);
    if (old && now && old !== now) return `${now}代${old}`;
  }
  if (e.tag === '战') {
    // 仗里亡了国的:"大霄灭大康";不然 "甲伐乙"
    const fall = e.children?.find((c) => c.tag === '亡' && c.polities.length > 1);
    if (fall) return briefOf(civ, fall);
    if (A && B) return `${A}伐${B}`;
  }
  const head = e.text.split(/[,，;；。]/)[0];
  return head.length > BRIEF_MAX ? `${head.slice(0, BRIEF_MAX)}…` : head;
}

/** 说不成短句、取正文第一截的,最多几个字 */
const BRIEF_MAX = 14;

/**
 * 从某一年重新演绎时,"不要了的历史"那一行列的几件:[from, to) 这一段里分量最重的 max 件(和停一下的卡片一样挑:分量不小于 REVIEW_WEIGHT;
 * 干预、地形大事不算),按先后,一件写成几个字。entries = fullChronicle 那一份
 */
export function rewindBrief(civ: Civ, from: number, to: number, entries: readonly ChronicleEntry[], max = 3): string[] {
  const list = entries
    .filter((e) => e.year >= from && e.year < to && e.kind !== 'intervene' && e.kind !== 'upheaval' && entryWeight(e) >= REVIEW_WEIGHT)
    .sort((x, y) => entryWeight(y) - entryWeight(x) || x.year - y.year || x.id - y.id);
  // 同一件事有两条的(仗里亡了国,亡国那条又单列)只算一件
  const pick: { e: ChronicleEntry; s: string }[] = [];
  for (const e of list) {
    if (pick.length >= max) break;
    const s = briefOf(civ, e);
    if (s && !pick.some((x) => x.s === s)) pick.push({ e, s });
  }
  return pick.sort((x, y) => x.e.year - y.e.year || x.e.id - y.e.id).map((x) => x.s);
}

/** 停一下时卡片里列的这一段([from, to))的大事,按先后。entries = fullChronicle 那一份 */
export function reviewItems(world: World, civ: Civ, from: number, to: number, entries: readonly ChronicleEntry[], era?: Era | null): StepReviewItem[] {
  if (!(to > from)) return [];
  let pick = entries.filter((e) => e.year >= from && e.year < to && entryWeight(e) >= REVIEW_WEIGHT);
  if (pick.length > REVIEW_MAX) pick = [...pick].sort((a, b) => entryWeight(b) - entryWeight(a) || a.year - b.year || a.id - b.id).slice(0, REVIEW_MAX);
  pick.sort((a, b) => a.year - b.year || a.id - b.id);
  return directorCards(world, civ, pick, era);
}

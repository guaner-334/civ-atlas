/**
 * 逐年推演(地基):停在某一刻 → 下几条命令 → 接着推,停在更晚的一刻。不从第 0 年重算。
 * 进度和命令串的格式见 gen/edits.ts 文件头"逐年推演的进度"(PlayState)、"时刻"(第几年 + 那一年的第几格)。
 *
 * 停的位置:进度那一刻的前一格(playStop:停在第 T 年年初 = T − 1/256 年,停在第 T 年第 k 格 = T + (k − 1)/256 年):
 * 那一刻以前的事都推完了,那一刻的事一件还没发生。一步走几年(playTurn,停在几年以后的同一格)、走几格(playTicks),
 * 或者推到更晚的任一刻(playTo)。
 * 命令的时刻就是进度那一刻(from = T,停在年中的再带 fromTick = k),和作者在那一刻下的干预一样在那一刻生效
 * (同一刻里先于别的事件;几条命令按命令串的先后;年中的怎么排见 edits.ts 的 simInterventions)。
 * 接着推用 continueCiv(index.ts):各层从 Civ 重建"接下来该发生什么",新命令补进干预列表(interventions.ts 的 scheduleInterventions
 * 只预约比现在晚的,进度那一刻正好比停下来的那一格晚)。所以"一步步停下来下命令接着推"和"带着同样的命令从第 0 年一口气推到同一刻"
 * 结果一样(停在年中、同一格里下几条命令也一样)—— 读档(只存推到哪一刻 + 命令串)、换一台设备重新推,都推出同一个世界。
 *
 * 返回的 Civ 里是生成出来的名字:用户改过的名字(edits.ts 的 applyNames)照常在结果上再套一遍。纯计算,不碰 DOM。
 */
import type { World } from '../world';
import {
  INTERVENTION_YEAR_MAX,
  YEAR_TICKS,
  issueCommands,
  momentAt,
  playAt,
  playInterventions,
  playState,
  ticksAt,
  type Intervention,
  type Moment,
  type PlayState,
} from '../edits';
import { continueCiv, generateCiv } from './index';
import type { Civ, CivParams } from './types';

/** 一步最多推几年 */
export const PLAY_YEARS_MAX = 1000;
/** 一步最多推几格 */
export const PLAY_TICKS_MAX = PLAY_YEARS_MAX * YEAR_TICKS;
/** 逐年推演能推到的最后一刻(第 INTERVENTION_YEAR_MAX 年年初;第几格) */
const PLAY_END = ticksAt(INTERVENTION_YEAR_MAX);

/** 一步的结果:推到下一步那一刻的历史、新的进度、没收下的命令 */
export interface PlayStep {
  civ: Civ;
  play: PlayState;
  rejected: unknown[];
}

/** 逐年推演的进度停在第 year 年的第 tick 格(不给 = 年初):推到这一刻的前一格(这一刻的事一件还没发生) */
export function playStop(year: number, tick = 0): number {
  return tick ? year + (tick - 1) / YEAR_TICKS : year - 1 / YEAR_TICKS;
}

/** 从第 0 年推到逐年推演的进度的那一刻(读档、手里没有上一步的结果时)。params.interventions = 作者的干预,命令接在后面 */
export function playCiv(world: World, params: Partial<CivParams>, play: PlayState): Civ {
  return generateCiv(world, { ...params, interventions: [...playInterventions(params.interventions ?? [], play)], endYear: playStop(play.year, play.tick) });
}

/**
 * 一步,推到 at 那一刻:在进度那一刻下这几条命令(只收正是这一刻的,见 edits.ts 的 issueCommands),接着推,停在 at(年 + 第几格;
 * 第几格取整、夹回 0–YEAR_TICKS−1)。at 至少比进度晚一格、最多晚 PLAY_TICKS_MAX 格,不晚于第 INTERVENTION_YEAR_MAX 年年初;不是有限数 = 下一格。
 * civ = 推到进度那一刻的结果(playCiv 或上一步的;存档读回来的原件也行);params 和推出它时一样(作者的干预在 params.interventions)。
 * civ 不是这份进度推出来的(时刻、命令对不上),照样算对:从第 0 年整段重推(continueCiv 的退路)。
 * 已经推到能推的最后一刻:推不动了,命令一条也不收(收了也永远等不到生效)
 */
export function playTo(world: World, civ: Civ, params: Partial<CivParams>, play: PlayState, commands: readonly unknown[], at: Moment): PlayStep {
  const now = playAt(play);
  if (now >= PLAY_END) return { civ, play, rejected: [...commands] };
  const tick = Number.isFinite(at.tick) ? Math.min(YEAR_TICKS - 1, Math.max(0, Math.floor(at.tick))) : 0;
  const want = Number.isFinite(at.year) ? ticksAt(Math.floor(at.year), tick) : now + 1;
  const m = momentAt(Math.min(PLAY_END, now + PLAY_TICKS_MAX, Math.max(now + 1, want)));
  const issued = issueCommands(play, commands);
  const next: PlayState = playState(m.year, m.tick, issued.play.commands);
  const interventions: Intervention[] = [...playInterventions(params.interventions ?? [], next)];
  const out = continueCiv(world, civ, { ...params, interventions, endYear: playStop(m.year, m.tick) });
  return { civ: out, play: next, rejected: issued.rejected };
}

/** 一步走 ticks 格(取整,1–PLAY_TICKS_MAX;不是有限数 = 一格),别的同 playTo */
export function playTicks(world: World, civ: Civ, params: Partial<CivParams>, play: PlayState, commands: readonly unknown[], ticks: number): PlayStep {
  const n = Number.isFinite(ticks) ? Math.min(PLAY_TICKS_MAX, Math.max(1, Math.round(ticks))) : 1;
  return playTo(world, civ, params, play, commands, momentAt(playAt(play) + n));
}

/** 一步走 years 年(整数,1–PLAY_YEARS_MAX),停在 years 年以后的同一格;别的同 playTo */
export function playTurn(world: World, civ: Civ, params: Partial<CivParams>, play: PlayState, commands: readonly unknown[], years: number): PlayStep {
  const n = Math.min(PLAY_YEARS_MAX, Math.max(1, Math.round(years)));
  return playTicks(world, civ, params, play, commands, n * YEAR_TICKS);
}

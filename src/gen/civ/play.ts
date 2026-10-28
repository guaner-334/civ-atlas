/**
 * 逐年推演(地基):停在第 T 年年初 → 下几条命令 → 接着推 N 年,停在第 T + N 年年初。不从第 0 年重算。
 * 进度和命令串的格式见 gen/edits.ts 文件头"逐年推演的进度"(PlayState)。
 *
 * 停的位置:进度那一刻的前一格(playStop(T) = T − 1/256 年;停在第 T 年第 k 格 = T + (k − 1)/256 年,见 edits.ts 文件头"时刻"):
 * 那一刻以前的事都推完了,那一刻的事一件还没发生。
 * 命令的时刻就是进度那一刻(from = T,停在年中的再带 fromTick = k);年初下的和作者在第 T 年下的干预一样在那一年的第一刻生效
 * (同一刻里先于别的事件;几条命令按命令串的先后)。
 * 接着推用 continueCiv(index.ts):各层从 Civ 重建"接下来该发生什么",新命令补进干预列表(interventions.ts 的 scheduleInterventions
 * 只预约比现在晚的,第 T 年的第一刻正好比停下来的那一刻晚)。所以"一步步停下来下命令接着推"和"带着同样的命令从第 0 年一口气推到同一刻"
 * 结果一样 —— 读档(只存推到哪年 + 命令串)、换一台设备重新推,都推出同一个世界。
 *
 * 返回的 Civ 里是生成出来的名字:用户改过的名字(edits.ts 的 applyNames)照常在结果上再套一遍。纯计算,不碰 DOM。
 */
import type { World } from '../world';
import { INTERVENTION_YEAR_MAX, YEAR_TICKS, issueCommands, playInterventions, playState, type Intervention, type PlayState } from '../edits';
import { continueCiv, generateCiv } from './index';
import type { Civ, CivParams } from './types';

/** 一步最多推几年 */
export const PLAY_YEARS_MAX = 1000;

/** 逐年推演的进度停在第 year 年的第 tick 格(不给 = 年初):推到这一刻的前一格(这一刻的事一件还没发生) */
export function playStop(year: number, tick = 0): number {
  return tick ? year + (tick - 1) / YEAR_TICKS : year - 1 / YEAR_TICKS;
}

/** 从第 0 年推到逐年推演的进度的那一刻(读档、手里没有上一步的结果时)。params.interventions = 作者的干预,命令接在后面 */
export function playCiv(world: World, params: Partial<CivParams>, play: PlayState): Civ {
  return generateCiv(world, { ...params, interventions: [...playInterventions(params.interventions ?? [], play)], endYear: playStop(play.year, play.tick) });
}

/**
 * 一步:在进度那一刻下这几条命令(只收正是这一刻的,见 edits.ts 的 issueCommands),接着推 years 年(整数,1–PLAY_YEARS_MAX),
 * 停在 years 年以后的同一格。civ = 推到这一刻的结果(playCiv 或上一步 playTurn 的;存档读回来的原件也行);
 * params 和推出它时一样(作者的干预在 params.interventions)。
 * civ 不是这份进度推出来的(年份、命令对不上),照样算对:从第 0 年整段重推(continueCiv 的退路)。
 * 返回推到下一步那一刻的结果、新的进度、没收下的命令
 */
export function playTurn(
  world: World,
  civ: Civ,
  params: Partial<CivParams>,
  play: PlayState,
  commands: readonly unknown[],
  years: number,
): { civ: Civ; play: PlayState; rejected: unknown[] } {
  // 已经推到能推的最后一年:推不动了,命令一条也不收(收了也永远等不到生效)
  if (play.year >= INTERVENTION_YEAR_MAX) return { civ, play, rejected: [...commands] };
  const n = Math.min(PLAY_YEARS_MAX, Math.max(1, Math.round(years)));
  const issued = issueCommands(play, commands);
  const next: PlayState = playState(Math.min(INTERVENTION_YEAR_MAX, play.year + n), play.tick ?? 0, issued.play.commands);
  const interventions: Intervention[] = [...playInterventions(params.interventions ?? [], next)];
  const out = continueCiv(world, civ, { ...params, interventions, endYear: playStop(next.year, next.tick) });
  return { civ: out, play: next, rejected: issued.rejected };
}

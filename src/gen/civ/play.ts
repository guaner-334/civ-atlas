/**
 * 游戏模式的推演(地基):停在第 T 年年初 → 下几条命令 → 接着推 N 年,停在第 T + N 年年初。不从第 0 年重算。
 * 进度和命令串的格式见 gen/edits.ts 文件头"游戏模式的进度"(PlayState)。
 *
 * 停的位置:第 T 年年初的前一刻(playStop(T) = T − 1/256 年):第 T 年以前的事都推完了,第 T 年的事一件还没发生。
 * 命令的 from = T,和作者在第 T 年下的干预一样在那一年的第一刻生效(同一刻里先于别的事件;几条命令按命令串的先后)。
 * 接着推用 continueCiv(index.ts):各层从 Civ 重建"接下来该发生什么",新命令补进干预列表(interventions.ts 的 scheduleInterventions
 * 只预约比现在晚的,第 T 年的第一刻正好比停下来的那一刻晚)。所以"一回回停下来下命令接着推"和"带着同样的命令从第 0 年一口气推到同一刻"
 * 结果一样 —— 读档(只存推到哪年 + 命令串)、换一台设备重新推,都推出同一个世界。
 *
 * 返回的 Civ 里是生成出来的名字:用户改过的名字(edits.ts 的 applyNames)照常在结果上再套一遍。纯计算,不碰 DOM。
 */
import type { World } from '../world';
import { INTERVENTION_YEAR_MAX, issueCommands, playInterventions, type Intervention, type PlayState } from '../edits';
import { continueCiv, generateCiv } from './index';
import type { Civ, CivParams } from './types';

/** 一回合最多推几年 */
export const PLAY_YEARS_MAX = 1000;

/** 游戏进度停在第 year 年年初:推到这一刻(第 year 年的事一件还没发生) */
export function playStop(year: number): number {
  return year - 1 / 256;
}

/** 从第 0 年推到游戏进度的那一刻(读档、手里没有上一回合的结果时)。params.interventions = 作者的干预,命令接在后面 */
export function playCiv(world: World, params: Partial<CivParams>, play: PlayState): Civ {
  return generateCiv(world, { ...params, interventions: [...playInterventions(params.interventions ?? [], play)], endYear: playStop(play.year) });
}

/**
 * 一回合:在 play.year 年初下这几条命令(只收 from = play.year 的,见 edits.ts 的 issueCommands),接着推 years 年(整数,1–PLAY_YEARS_MAX)。
 * civ = 推到这一回合年初的结果(playCiv 或上一回合 playTurn 的;存档读回来的原件也行);params 和推出它时一样(作者的干预在 params.interventions)。
 * civ 不是这份进度推出来的(年份、命令对不上),照样算对:从第 0 年整段重推(continueCiv 的退路)。
 * 返回推到下一回合年初的结果、新的进度、没收下的命令
 */
export function playTurn(
  world: World,
  civ: Civ,
  params: Partial<CivParams>,
  play: PlayState,
  commands: readonly unknown[],
  years: number,
): { civ: Civ; play: PlayState; rejected: unknown[] } {
  const n = Math.min(PLAY_YEARS_MAX, Math.max(1, Math.round(years)));
  const issued = issueCommands(play, commands);
  const next: PlayState = { year: Math.min(INTERVENTION_YEAR_MAX, play.year + n), commands: issued.play.commands };
  const interventions: Intervention[] = [...playInterventions(params.interventions ?? [], next)];
  const out = continueCiv(world, civ, { ...params, interventions, endYear: playStop(next.year) });
  return { civ: out, play: next, rejected: issued.rejected };
}

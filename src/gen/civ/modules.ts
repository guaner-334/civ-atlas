/**
 * 官方推演的子系统清单:接着推时各子系统按什么次序重建自己的状态和待发生的事件。
 * 次序和一口气推时装各子系统的次序(index.ts 的 generateCiv)一样,同一刻的事件先后才和一口气推完一模一样。
 * 引擎(engine/sim.ts)只管事件堆、归属、日志、史事、检查点,不认识任何子系统。
 */
import type { World } from '../world';
import type { Intervention } from '../edits';
import type { Civ } from './types';
import { CivSim } from './sim';
import { cultureModelOf, resumeCultures } from './cultures';
import { polityModelOf, resumePolities } from './polities';
import { resumeWars } from './wars';
import { resumePolitics } from './politics';
import { resumeDynasty } from './dynasty';
import { resumeAssimilation } from './assimilation';
import { resumeCities } from './cities';
import { resumeDiplomacy } from './diplomacy';
import { resumeDevelopment } from './development';
import { resumeIdeology } from './ideology';
import { resumeTrade } from './trade';
import { resumeUnrest } from './unrest';
import { resumeControl } from './control';
import { resumeCouncil } from './council';
import { resumeRegency } from './regency';
import { resumeMarriage } from './marriage';
import { resumePlague } from './plague';
import { resumePandemic } from './pandemic';
import { resumeTreaties } from './treaties';
import { resumeMigration } from './migration';
import { resumeInterventions, scheduleInterventions } from './interventions';
import { resumeReligion, type FaithEra } from './religion';

/**
 * 由 Civ 数据重建推演状态:引擎的那部分(各层归属、版本号、日志、检查点)交给 CivSim.restore,再让各层重建待发生的事件,
 * 然后就能从 civ.endYear 接着推:sim.run(更晚的年份)。不需要保存事件堆,阶段 4 的存档也只存 Civ。
 * interventions = 接着推时带着的干预(阶段 4;默认 = 这份历史推出来时带着的 civ.interventions):
 * 已经过了的只影响之后的决定(规则),还没到的补上它们的事件。后面可以接上几条比 civ.endYear 晚的(逐年推演时下的新命令,civ/play.ts)。
 * first = 最先预约的事件(地形大事那一刻接着推时:大事本身)。
 * eras = 地形大事以前各段的州(信仰照历史重放时,大事以前按那时的州;默认 = civ.eras)。地形大事那一刻接着推时由 generateCiv 给
 */
export function resumeCiv(
  world: World,
  civ: Civ,
  interventions: readonly Intervention[] = civ.interventions ?? [],
  first?: (sim: CivSim) => void,
  eras: readonly FaithEra[] = civ.eras ?? [],
): CivSim {
  const sim = CivSim.restore(civ);
  // 各层重建自己的事件(和 generateCiv 里 install 的顺序一样:先民族,再城镇和国家,再战争,再分合,再王朝,再同化与迁徙,
  // 再城市兴衰 —— 它要挂在战争模型上(攻城)、要国家模型的迁都回调;再邦交 —— 要挂在战争模型上)
  if (civ.viable && civ.cultures.length) {
    // 地形大事(first)、干预的事件最先预约(和 generateCiv 一样:同一刻里地形大事最先,干预只排在新君即位、迁都后重看边地后面)
    first?.(sim);
    const iv = scheduleInterventions(sim, civ.seed, interventions, true);
    // 各层补上的"按预约先后排"的事件先攒着,补完按一口气推时预约的时刻排好再放进事件堆(见 schedule 的 booked)。
    // 干预在一口气推时最先预约(generateCiv 里装各层之前),这里也在攒之前直接放进去,同一刻里排在补上的事件前面
    sim.holdBookings();
    // 地形大事以后补备的新民族(干预立国用):国家那一层也要认得它们(民族表接在后面)
    const extra = resumeCultures(sim, world, civ, interventions);
    resumePolities(sim, world, extra.length ? { ...civ, cultures: [...civ.cultures, ...extra] } : civ, iv);
    resumeWars(sim, world, civ);
    resumePolitics(sim, world, civ);
    resumeDynasty(sim, world, civ);
    resumeAssimilation(sim, world, civ);
    resumeCities(sim, world, civ);
    resumeDiplomacy(sim, world, civ);
    resumeDevelopment(sim, world, civ);
    resumeIdeology(sim, civ);
    resumeTrade(sim, civ);
    resumeUnrest(sim, world, civ);
    resumeControl(sim, civ);
    resumeCouncil(sim, civ);
    resumeRegency(sim, civ);
    resumeMarriage(sim, civ);
    resumePlague(sim, world, civ, iv?.list);
    resumePandemic(sim, civ, iv?.list);
    resumeTreaties(sim, world, civ);
    resumeMigration(sim, world, civ);
    // 信仰:不存状态,照 civ 的历史从第 0 年重放到 civ.endYear,之后接着每 5 年算一步(不预约事件)
    const cm = cultureModelOf(sim);
    const pm = polityModelOf(sim);
    if (cm && pm) resumeReligion(sim, civ, cm, pm, eras);
    if (iv) resumeInterventions(sim, iv);
    sim.releaseHeld();
  }
  return sim;
}

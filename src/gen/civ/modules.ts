/**
 * 官方推演的子系统清单:装哪些模块、按什么次序。
 *
 * 引擎(engine/)只管事件堆、归属、日志、史事、检查点,不认识任何子系统;每个子系统在自己的文件里导出一个模块对象
 * (engine/module.ts 的样子:install / resume / finish),这里按次序排好:
 *   - 一口气推(index.ts 的 generateCiv):先定民族、国家两个模型、最先预约干预的事件,再照 CIV_MODULES 的次序逐个 install
 *   - 接着推(resumeCiv):引擎先恢复自己的状态,再照同一个次序逐个 resume
 *   - 推完(index.ts 的 finishCiv):照 CIV_FINISH 的次序逐个 finish,往结果上补各自的那一份
 * 同一刻的事件按装的先后排,所以次序是历史的一部分:改了次序,同一种子的历史就变了。
 * 加一个子系统 = 在它的文件里写一个模块对象,加进下面的清单(要往结果上补东西的,也加进 CIV_FINISH)。
 */
import type { World } from '../world';
import type { Intervention } from '../edits';
import type { Civ, Culture, Habitat, Regions, Year } from './types';
import { CivSim } from './engine/sim';
import type { SimModule } from './engine/module';
import { culturesModule, type CultureModel } from './cultures';
import { politiesModule, type PolityModel } from './polities';
import { warsModule } from './wars';
import { politicsModule } from './politics';
import { dynastyModule } from './dynasty';
import { assimilationModule } from './assimilation';
import { citiesModule } from './cities';
import { diplomacyModule } from './diplomacy';
import { developmentModule } from './development';
import { ideologyModule } from './ideology';
import { tradeModule } from './trade';
import { unrestModule } from './unrest';
import { controlModule } from './control';
import { councilModule } from './council';
import { regencyModule } from './regency';
import { marriageModule } from './marriage';
import { plagueModule } from './plague';
import { pandemicModule } from './pandemic';
import { treatiesModule } from './treaties';
import { migrationModule } from './migration';
import { religionModule, type FaithEra } from './religion';
import { interventionsModule, scheduleInterventions, type InterventionModel } from './interventions';

/** 一口气推时装模块拿到的东西 */
export interface InstallCtx {
  sim: CivSim;
  world: World;
  habitat: Habitat;
  regions: Regions;
  /** 文明种子 */
  seed: number;
  /** 民族模型、国家模型(没有能住人的地 = null:各模块照原样不装) */
  cm: CultureModel | null;
  pm: PolityModel | null;
  /** 干预(没有国家模型 = null) */
  iv: InterventionModel | null;
}

/** 接着推时重建模块拿到的东西 */
export interface ResumeCtx {
  sim: CivSim;
  world: World;
  civ: Civ;
  /** 接着推时带着的干预 */
  interventions: readonly Intervention[];
  iv: InterventionModel | null;
  /** 地形大事以前各段的州(信仰照历史重放时用) */
  eras: readonly FaithEra[];
  /** 地形大事以后补备的新民族(民族模块 resume 时填,国家模块 resume 时读) */
  extra: Culture[];
}

/** 推完往结果上补东西时拿到的东西 */
export interface FinishCtx {
  sim: CivSim;
  world: World;
  endYear: Year;
  regions: Regions;
  /** 拼好的结果(起好了名、排好了人物);模块往上补自己的那一份 */
  civ: Civ;
}

export type CivModule = SimModule<InstallCtx, ResumeCtx, FinishCtx>;

/**
 * 装、接着推的次序:先民族,再城镇和国家,再战争,再分合,再王朝,再同化与迁徙,
 * 再城市兴衰 —— 它要挂在战争模型上(攻城)、要国家模型的迁都回调;再邦交 —— 要挂在战争模型上;……;最后干预
 */
export const CIV_MODULES: readonly CivModule[] = [
  culturesModule,
  politiesModule,
  warsModule,
  politicsModule,
  dynastyModule,
  assimilationModule,
  citiesModule,
  diplomacyModule,
  developmentModule,
  ideologyModule,
  tradeModule,
  unrestModule,
  controlModule,
  councilModule,
  regencyModule,
  marriageModule,
  plagueModule,
  pandemicModule,
  treatiesModule,
  migrationModule,
  religionModule,
  interventionsModule,
];

/** 推完往结果上补东西的次序:信仰要整份 civ,排最前;再发展度、思潮、商道 */
export const CIV_FINISH: readonly CivModule[] = [religionModule, developmentModule, ideologyModule, tradeModule];

/** 一口气推:照清单的次序逐个装上 */
export function installModules(ctx: InstallCtx): void {
  for (const m of CIV_MODULES) m.install?.(ctx);
}

/** 推完:照 CIV_FINISH 的次序逐个往 ctx.civ 上补 */
export function finishModules(ctx: FinishCtx): void {
  for (const m of CIV_FINISH) m.finish?.(ctx);
}

/**
 * 由 Civ 数据重建推演状态:引擎的那部分(各层归属、版本号、日志、检查点)交给 CivSim.restore,再让各模块重建待发生的事件,
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
  if (civ.viable && civ.cultures.length) {
    // 地形大事(first)、干预的事件最先预约(和 generateCiv 一样:同一刻里地形大事最先,干预只排在新君即位、迁都后重看边地后面)
    first?.(sim);
    const iv = scheduleInterventions(sim, civ.seed, interventions, true);
    // 各模块补上的"按预约先后排"的事件先攒着,补完按一口气推时预约的时刻排好再放进事件堆(见 schedule 的 booked)。
    // 干预在一口气推时最先预约(generateCiv 里装各模块之前),这里也在攒之前直接放进去,同一刻里排在补上的事件前面
    sim.holdBookings();
    const ctx: ResumeCtx = { sim, world, civ, interventions, iv, eras, extra: [] };
    for (const m of CIV_MODULES) m.resume?.(ctx);
    sim.releaseHeld();
  }
  return sim;
}

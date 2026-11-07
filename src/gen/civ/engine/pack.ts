/**
 * 规则包里引擎认得的那几样:事件种类、史事的样子、模块清单。旋钮表、数表是给看和调的总目录,推演本身不读
 * (各模块从这次推演带的那套数里取自己的表、自己建数表)。
 * 开头几步、推完的整理、地形大事那段怎么接,由规则那一边的总流程照包里的几步走(官方的见 civ/run.ts、civ/modules.ts)。
 */
import { CivSim, type AnnalSchema, type EngineState, type EventKind } from './sim';
import type { SimModule } from './module';
import type { KnobSet, Knobs, KnobValue } from './knobs';
import type { TableCard } from './tables';

/** 一组数表(按这次推演的那套数配卡) */
export interface TableGroup {
  readonly id: string;
  cards(knobs: KnobSet): readonly TableCard[];
}

export interface RulePack<I, R, F> {
  readonly id: string;
  readonly events: readonly EventKind[];
  readonly annals: AnnalSchema;
  readonly knobs: readonly Knobs<Record<string, KnobValue>>[];
  readonly tables: readonly TableGroup[];
  /** 装、接着推的次序 */
  readonly modules: readonly SimModule<I, R, F>[];
  /** 推到一半拼结果时往上补的次序 */
  readonly partial: readonly SimModule<I, R, F>[];
  /** 推完往结果上补的次序 */
  readonly finish: readonly SimModule<I, R, F>[];
}

/** 一口气推用的引擎:登记包里的事件种类和史事的样子 */
export function packSim<I, R, F>(pack: RulePack<I, R, F>, regionCount: number, knobs: KnobSet): CivSim {
  const sim = new CivSim(regionCount, pack.events, pack.annals);
  sim.knobs = knobs;
  return sim;
}

/** 接着推用的引擎:照存下的几样恢复,模块还没接上 */
export function restorePackSim<I, R, F>(pack: RulePack<I, R, F>, state: EngineState): CivSim {
  return CivSim.restore(state, pack.events, pack.annals);
}

export function installModules<I, R, F>(pack: RulePack<I, R, F>, ctx: I): void {
  for (const m of pack.modules) m.install?.(ctx);
}

/** 各模块补上的、按预约先后排的事件先攒着,补完按一口气推时预约的时刻排好再放进事件堆(CivSim.releaseHeld) */
export function resumeModules<I, R, F>(pack: RulePack<I, R, F>, sim: CivSim, ctx: R): void {
  sim.holdBookings();
  for (const m of pack.modules) m.resume?.(ctx);
  sim.releaseHeld();
}

export function partialModules<I, R, F>(pack: RulePack<I, R, F>, ctx: F): void {
  for (const m of pack.partial) m.partial?.(ctx);
}

export function finishModules<I, R, F>(pack: RulePack<I, R, F>, ctx: F): void {
  for (const m of pack.finish) m.finish?.(ctx);
}

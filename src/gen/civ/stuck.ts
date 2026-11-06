/**
 * 推演里抛了错:不再整件作废,交回到出错前最后推好的那一年为止的历史,带上 stuck(推到哪年算不下去、本来要推到哪年)。
 * 推得完的照旧一口气推,结果一位不差;只有出错时才回头一年一年再推一遍找出停在哪年,所以同样的输入总停在同一年。
 * 纯计算,不碰 DOM;worker 和 Node 里都能跑。
 */
import type { World } from '../world';
import { DEFAULT_CIV_PARAMS, continueParams } from './index';
import { growEngine, type GrowEngine } from './grow';
import type { Civ, CivParams } from './types';

/** 从第 0 年起一口气推的那一段推到第几年(引擎从第 0 年起推不能中途停) */
const FIRST = 10;

export interface StuckOptions {
  /** 推历史用的两样(冒烟检查换成在某一年出错的);不给 = 照常推 */
  engine?: GrowEngine;
  /** 推演里抛的那个错(记进问题记录用) */
  failed?: (e: unknown) => void;
}

/**
 * 推到 params.endYear;推不下去 = 停在出错前那一年的历史(带 stuck)。from = 同一份配方推得出来的一份(找停在哪年时从它接着找;不给 = 从第 0 年起)。
 * 连头几年都推不出来照旧抛错
 */
export function civOrStuck(world: World, params: Partial<CivParams>, opt: StuckOptions = {}, from: Civ | null = null): Civ {
  const engine = opt.engine ?? growEngine;
  try {
    return engine.generate(world, params);
  } catch (e) {
    opt.failed?.(e);
    const civ = findStuck(world, params, from, engine);
    if (!civ) throw e;
    return civ;
  }
}

/** 从 base 接着推到 params.endYear(同 continueCiv);推不下去同 civOrStuck */
export function continueOrStuck(world: World, base: Civ, params: Partial<CivParams>, opt: StuckOptions = {}): Civ {
  const engine = opt.engine ?? growEngine;
  const q = continueParams(base, params);
  try {
    const run = engine.resume(world, base, q);
    return run ? run.finish() : engine.generate(world, q);
  } catch (e) {
    opt.failed?.(e);
    const civ = findStuck(world, q, base, engine);
    if (!civ) throw e;
    return civ;
  }
}

/**
 * 已知推到 params.endYear 会出错:找出最后推得出来的那一年,交到那年为止的历史(带 stuck)。
 * from = 推得出来的一份(从它接着找;不给 = 从第 0 年起)。连一份都推不出来 = null
 */
export function findStuck(world: World, params: Partial<CivParams>, from: Civ | null, engine: GrowEngine = growEngine): Civ | null {
  const end = params.endYear ?? DEFAULT_CIV_PARAMS.endYear;
  const at = (endYear: number): Partial<CivParams> => ({ ...params, endYear });
  let last = from && from.endYear < end ? from : null;
  if (!last) {
    try {
      last = engine.generate(world, at(Math.min(FIRST, end)));
    } catch {
      return null;
    }
    if (last.endYear >= end) return last;
  }
  const run = engine.resume(world, last, params);
  if (!run) return bisect(world, params, last, end, end, engine);
  let before = run.year;
  try {
    while (run.year < end) {
      before = run.year;
      run.advance(Math.floor(run.year) + 1);
    }
    return run.finish();
  } catch {
    const failed = Math.floor(run.year);
    const stop = Math.floor(before);
    if (stop <= last.endYear) return mark(last, Math.max(failed, Math.floor(last.endYear)), end);
    try {
      const civ = engine.resume(world, last, at(stop))?.finish();
      if (civ) return mark(civ, Math.max(failed, Math.floor(civ.endYear)), end);
    } catch {
      // 出错的是推完以后的整理(起名、道路……):推得过去的年份也整理不出来,按年份往前找
    }
    return bisect(world, params, last, stop, end, engine);
  }
}

/** 按年份二分,找 ok 那年和 bad 那年之间最后一个从第 0 年推得出来的年份(有地形大事接不着推的、整理时出错的) */
function bisect(world: World, params: Partial<CivParams>, ok: Civ, bad: number, end: number, engine: GrowEngine): Civ {
  let good = ok;
  let lo = Math.floor(ok.endYear);
  let hi = Math.ceil(bad);
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    try {
      good = engine.generate(world, { ...params, endYear: mid });
      lo = mid;
    } catch {
      hi = mid;
    }
  }
  return mark(good, Math.floor(good.endYear), end);
}

function mark(civ: Civ, at: number, to: number): Civ {
  return { ...civ, stuck: { at, to } };
}

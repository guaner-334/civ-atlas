/**
 * 一段历史边推边交:从第 0 年推到最后一个交历史的年份(marks 的最后一个),推到每个交历史的年份就整理成一份完整的 Civ 交出去
 * (起好名、配好色、有人物和道路,地图、编年史拿去就能用),接着往后推。并排试推用它让两段历史在地图上一点点长出来。
 *
 * - 交出去的每一份,和一口气推到那一年(generateCiv 给同样的参数、推演年数 = 那一年)逐字节一样;最后一份就是一口气推到底的那一份。
 *   前面交的那几份里已经发生的事,和后面交的、一口气推完的里面一模一样(整理只看每样东西出现以前的历史,见 index.ts 的 continueCiv),
 *   所以早先交的那份可以一直用到下一份来
 * - 怎么推:先一口气推到第 FIRST 年,之后照 continueCiv 的办法从上一份接着推(startContinue),每次往前推 STEP 年;
 *   每次 step 推满给的毫秒数就停下(下次接着推),让调用的一方处理别的事(worker 里收新消息、轮到另一段历史)
 * - 推不下去(推演里抛了错):停在出错前最后推好的那一年,把到那年为止的历史整理好交出去(failed),不再往后推。
 *   出错前最后推好的那一年到出错那一刻之间不到 STEP 年;重新整理要从上一份交出去的历史接着推一遍,只在出错时多花这点时间
 * - 接不着推的(长不出文明的世界):直接一口气推到底,交一份
 *
 * 纯计算,不碰 DOM;worker 和 Node 里都能跑。
 */
import type { World } from '../world';
import { generateCiv, startContinue, type Continuation } from './index';
import type { Civ, CivParams } from './types';

/** 交历史的年份(最后一个 = 推到哪年为止) */
export const GROW_MARKS: readonly number[] = [300, 700, 1300, 2100, 3000];

/** 从第 0 年起一口气推的那一段推到第几年(这一段里出错只知道是在头几年) */
const FIRST = 10;
/** 之后每次往前推几年(出错时停在的那年离出错那一刻不到这么多年) */
const STEP = 1;

/** 推的时候发生的事 */
export type GrowEvent =
  /** 交一份历史(推到 civ.endYear 那年);done = 这是最后一份 */
  | { kind: 'civ'; civ: Civ; done: boolean }
  /**
   * 推不下去了:at = 出错的那一年;civ = 到出错前最后推好的那一年为止的历史(整理好的,推到 civ.endYear;
   * 头几年就出错、什么都没推出来 = null)。之后不再往后推
   */
  | { kind: 'failed'; at: number; civ: Civ | null };

export interface Grower {
  /** 已经推到哪一刻(交过的那份之后还在往前推的,也算上) */
  readonly year: number;
  /** 推完了(最后一份交了,或者推不下去了) */
  readonly done: boolean;
  /**
   * 接着推:推满 budget 毫秒(至少往前推一次)、推到下一个交历史的年份、或者推不下去就停。
   * 交了一份历史 / 推不下去了 = 那件事;只是推满了时间 = null。推完了以后再调 = null
   */
  step(budget: number): GrowEvent | null;
}

/** 推历史用的两样(单测换成会在某一年出错的) */
export interface GrowEngine {
  generate: (world: World, params: Partial<CivParams>) => Civ;
  resume: (world: World, civ: Civ, params: Partial<CivParams>) => Continuation | null;
}

const ENGINE: GrowEngine = {
  generate: (world, params) => generateCiv(world, params),
  resume: (world, civ, params) => startContinue(world, civ, params),
};

export interface GrowOptions {
  /** 交历史的年份(从小到大;不给 = GROW_MARKS) */
  marks?: readonly number[];
  /** 计时(毫秒;单测换成假的);不给 = performance.now */
  now?: () => number;
  engine?: GrowEngine;
}

/**
 * 开始推一段历史。params = 推这段历史的参数(推演年数不看,按 marks 推);world 和 params 推的时候不改。
 * 返回的 Grower 一次 step 推一小段
 */
export function startGrow(world: World, params: Partial<CivParams>, opt: GrowOptions = {}): Grower {
  const marks = (opt.marks ?? GROW_MARKS).filter((y, i, a) => y > 0 && (i === 0 || y > a[i - 1]));
  const now = opt.now ?? (() => performance.now());
  const engine = opt.engine ?? ENGINE;
  const end = marks[marks.length - 1] ?? 0;
  const at = (endYear: number): Partial<CivParams> => ({ ...params, endYear });
  /** 交过的最后一份(从它接着推;出错时从它重新推到出错前那年) */
  let last: Civ | null = null;
  /** 正往下一个交历史的年份推的那一段 */
  let run: Continuation | null = null;
  /** 下一个交历史的年份是第几个 */
  let k = 0;
  let done = !marks.length;

  const deliver = (civ: Civ): GrowEvent => {
    last = civ;
    run = null;
    while (k < marks.length && marks[k] <= civ.endYear) k++;
    done = k >= marks.length;
    return { kind: 'civ', civ, done };
  };

  /** 推不下去了:到 stop 年为止的历史从交过的那份接着推一遍、整理好 */
  const fail = (failedAt: number, stop: number): GrowEvent => {
    done = true;
    run = null;
    let civ: Civ | null = last;
    if (last && stop > last.endYear) {
      try {
        const r = engine.resume(world, last, at(stop));
        if (r) {
          while (r.year < stop) r.advance(Math.floor(r.year / STEP) * STEP + STEP);
          civ = r.finish();
        }
      } catch {
        civ = last;
      }
    }
    last = civ;
    return { kind: 'failed', at: Math.max(Math.floor(failedAt), civ ? civ.endYear : 0), civ };
  };

  return {
    get year() {
      return run ? run.year : last ? last.endYear : 0;
    },
    get done() {
      return done;
    },
    step(budget: number): GrowEvent | null {
      if (done) return null;
      const t0 = now();
      if (!last) {
        // 从第 0 年起的头一段:一口气推(引擎从第 0 年起推不能中途停)
        let c: Civ;
        try {
          c = engine.generate(world, at(Math.min(FIRST, marks[0])));
        } catch {
          done = true;
          return { kind: 'failed', at: 0, civ: null };
        }
        if (c.endYear >= marks[k]) return deliver(c);
        last = c;
        if (now() - t0 >= budget) return null;
      }
      const target = marks[k];
      if (!run) {
        const from: Civ = last!;
        run = engine.resume(world, from, at(target));
        if (!run) {
          // 接不着推(长不出文明的世界):一口气推到底
          try {
            return deliver(engine.generate(world, at(end)));
          } catch {
            return fail(from.endYear, from.endYear);
          }
        }
      }
      const r: Continuation = run;
      let moved = false;
      while (r.year < target) {
        if (moved && now() - t0 >= budget) return null;
        const before = r.year;
        try {
          r.advance(Math.min(target, Math.floor(r.year / STEP) * STEP + STEP));
        } catch {
          return fail(r.year, Math.floor(before));
        }
        moved = true;
      }
      let civ: Civ;
      try {
        civ = r.finish();
      } catch {
        return fail(target, Math.floor(target - STEP));
      }
      return deliver(civ);
    },
  };
}

/**
 * 再推 N 年:在推完的世界(一份推到 civ.endYear 的历史)上接着推到 params.endYear,前面的历史一点不变,只往后长。
 * 结果和一次推到 params.endYear 逐字节一样(index.ts 的 continueCiv / startContinue),所以存档只记推到哪一年。
 *
 * 推演那一步分成几段推:每段推够 SLICE_MS 毫秒就停一下,报进度(推到第几年)、让调用的一方处理别的事(worker 里让新消息排进来),
 * 问要不要停;要停就扔掉这次推了一半的(传进来的 civ 不改,下次照样从它接着推)。推完以后的整理(起名、配色、人物、道路、信仰)
 * 一次做完,不再打断。接不上的(有地形大事的世界、改了早先的干预……)和手里没有推好的历史的,照常从第 0 年整段推(不分段,结果一样)。
 * 纯计算,不碰 DOM;在 worker 和 Node 里都能跑。
 */
import type { World } from '../world';
import { generateCiv, startContinue } from './index';
import type { Civ, CivParams } from './types';

/** 一段最多推多久(毫秒):推满就停下来报进度、看要不要停 */
export const SLICE_MS = 40;
/** 一段里每次往前推几年(推完一步看一次表) */
const STEP_YEARS = 10;

/**
 * 整体进度里推演那一步占多少,其余是推完以后的整理(起名、人物、道路、信仰都按整段历史算,推得越远越慢)。
 * 实测推演每推一年花的时间,约是整理时每一年历史花的 3 倍:3000→4000 年推演约占四成,10000→11000 年约占两成
 */
function simShare(from: number, to: number): number {
  const span = 3 * (to - from);
  return span / (span + to);
}

/** 再推时的回调(都可以不给) */
export interface ExtendHooks {
  /**
   * 开始推、每推完一段、整理完各报一次:推演已经推到哪一刻(带小数的年份:停在一年中间的世界从那一格接着推,开头和最后一段在年中)、
   * 整体进度(0–1,只增不减;推演推完到整理完之间停在一个数上)
   */
  progress?: (year: number, pct: number) => void;
  /** 每段之间等一下(worker 里等一个宏任务,好让新到的消息排进来);不给 = 不等 */
  pause?: () => Promise<void>;
  /** 每段之间(和开始推之前)问一次:true = 不推了,返回 null */
  stop?: () => boolean;
  /** 计时(毫秒;单测换成假的);不给 = performance.now */
  now?: () => number;
}

/**
 * 接着推到 params.endYear。base = 推好的历史(推到比 params.endYear 早的年份,params 除 endYear 外要和推出它时一样;没有 = null);
 * 没有或接不上就从第 0 年整段推。返回推好的 Civ;中途被叫停 = null。不改 base
 */
export async function extendCiv(world: World, base: Civ | null, params: Partial<CivParams>, hooks: ExtendHooks = {}): Promise<Civ | null> {
  const stop = hooks.stop ?? (() => false);
  const now = hooks.now ?? (() => performance.now());
  if (stop()) return null;
  const run = base ? startContinue(world, base, params) : null;
  if (!run) {
    const civ = generateCiv(world, params);
    hooks.progress?.(civ.endYear, 1);
    return civ;
  }
  const span = run.to - run.from;
  const share = simShare(run.from, run.to);
  hooks.progress?.(run.from, 0);
  while (run.year < run.to) {
    // 一段至少往前推一步(机器再慢也推得动)
    const t0 = now();
    do run.advance(Math.floor(run.year / STEP_YEARS) * STEP_YEARS + STEP_YEARS);
    while (run.year < run.to && now() - t0 < SLICE_MS);
    hooks.progress?.(run.year, (share * (run.year - run.from)) / span);
    if (hooks.pause) await hooks.pause();
    if (stop()) return null;
  }
  const civ = run.finish();
  hooks.progress?.(civ.endYear, 1);
  return civ;
}

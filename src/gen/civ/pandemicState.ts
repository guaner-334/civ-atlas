/**
 * 全球大疫的推演状态(pandemic.ts 维护;发展度、乡村人口、城市兴衰、瘟疫按它看哪些州在凋敝)。
 * 单独一个小文件,只放状态和查询:几层都要读它,又不想互相引用推演代码。纯计算,不碰 DOM。
 */
import type { CivSim } from './sim';
import type { Year } from './types';

/** 染疫那城死几成折成"轻重"时的基准(死四成 = 1,重灾) */
export const SEV_REF = 0.4;
/** 轻重最多算到几 */
export const SEV_MAX = 1.3;

/** 一场全球大疫(推演里的状态;接着推时由史事 pandemic 和城镇表里带 until 的折损重建) */
export interface Pandemic {
  /** 第几场瘟疫(史事 plague / pandemic 的 war 列) */
  k: number;
  /** 起疫的时刻 */
  t0: Year;
  /** 凋敝结束的那年(= t0 + 疫后无人收拾几年) */
  end: Year;
  /** 轻重(1–3) */
  level: number;
  /** 疫前天下人口(千人) */
  pre: number;
  /** 各州第一次染上的时刻(没染 = NaN) */
  at: Float64Array;
  /** 各州的轻重:城里死几成 ÷ SEV_REF(再染一次的取重的),最多 SEV_MAX;没染 = 0 */
  sev: Float64Array;
  /** 各州染上时的城(没染 = −1) */
  sid: Int32Array;
}

export interface PandemicModel {
  /** 起过的全球大疫(按起疫先后) */
  list: Pandemic[];
}

const models = new WeakMap<CivSim, PandemicModel>();

/** 推演引擎上挂着的全球大疫状态(没有全球大疫的世界也有一份空的;没装 = undefined) */
export function pandemicModelOf(sim: CivSim): PandemicModel | undefined {
  return models.get(sim);
}

export function setPandemicModel(sim: CivSim, m: PandemicModel): void {
  models.set(sim, m);
}

/** 一场全球大疫空的状态 */
export function newPandemic(R: number, k: number, t0: Year, end: Year, level: number, pre: number): Pandemic {
  return { k, t0, end, level, pre, at: new Float64Array(R).fill(NaN), sev: new Float64Array(R), sid: new Int32Array(R).fill(-1) };
}

/** 记下一州染上(这一场里第一次染上记时刻和城;轻重取重的) */
export function notePandemicHit(p: Pandemic, r: number, sid: number, t: Year, loss: number): void {
  if (!(r >= 0 && r < p.at.length)) return;
  if (Number.isNaN(p.at[r])) {
    p.at[r] = t;
    p.sid[r] = sid;
  }
  const s = Math.min(SEV_MAX, loss / SEV_REF);
  if (s > p.sev[r]) p.sev[r] = s;
}

/** 州 r 在 [a, b) 里凋敝了几年、那段的轻重(几场叠着的取凋敝得最久的那场);没有 = null */
export function slumpIn(m: PandemicModel | undefined, r: number, a: Year, b: Year): { years: number; sev: number } | null {
  if (!m?.list.length) return null;
  let best: { years: number; sev: number } | null = null;
  for (const p of m.list) {
    const t = p.at[r];
    if (!(t < b) || !(p.end > a)) continue;
    const y = Math.min(b, p.end) - Math.max(a, t);
    if (y > 0 && (!best || y > best.years)) best = { years: y, sev: p.sev[r] };
  }
  return best;
}

/** 州 r 此刻在不在凋敝(染了全球大疫、那场的凋敝还没结束) */
export function inSlump(m: PandemicModel | undefined, r: number, t: Year): boolean {
  if (!m?.list.length) return false;
  for (const p of m.list) if (p.at[r] <= t && t < p.end) return true;
  return false;
}

/** 此刻有没有哪一场全球大疫的凋敝还没结束(起疫以后、凋敝结束以前) */
export function anySlump(m: PandemicModel | undefined, t: Year): boolean {
  if (!m?.list.length) return false;
  for (const p of m.list) if (p.t0 <= t && t < p.end) return true;
  return false;
}

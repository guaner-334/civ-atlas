/**
 * 亡国之君出奔邻国:国家亡于战争的那一刻(接口 war.onFall,treaties.ts 挂上),末代之君的下场是"出奔"的
 * (rulers.ts 的 fallFate,和 people.ts 排人物同一个判据;有中立地可去的约国先奔中立地,见 treaties.ts),
 * 给他找一个去处,记史事 exile(cause = fled,war = −1,b = 去的国家,州和城 = 那国的国都,Annal.n = 投奔的缘由)。
 * 只记"去了哪国",推演里不因此多出别的事;人物(people.ts)照它填 Person.exile.to / tie。
 *
 *   **邻国**:亡国以前的国土 —— 近 LOOKBACK 年里(含亡国这一仗)在战争里丢的州、亡国时的国都 —— 往外 HOPS 步以内(陆上、海峡、航线都算一步)
 *     有州的在世国家。灭他的国家、它的盟国和藩属(宗藩之分)、近 LOOKBACK 年里和他打过仗的国家不去。
 *   **挑哪国**(按 EXILE_TIES 的先后):两国结着亲(姻亲)> 结着盟 > 同在一份约里 > 同族 > 和灭他的国家敌对
 *     (正交战、近 FOE_YEARS 年里打过仗、方针里当它仇国)> 别的邻国;一样时挑近的(步数少),再一样随机。
 *     一个邻国都没有(四面都是灭他的国家)= 不记,他照旧"出奔",去向不明。
 *
 * 随机数:keyed4(subSeed(seed, 'civ-exile'), 两国的位置锚, 亡国那一刻, 用途)。只看那一刻的推演状态(都由史事重建),
 * 接着推和一口气推完一样。纯计算,不碰 DOM。
 */
import type { Year } from './types';
import { keyed4, subSeed } from './engine/rand';
import { capitalAt } from './growth';
import { bookOf, hates, type PolityModel } from './polities';
import type { WarModel } from './wars';
import type { DiplomacyModel } from './diplomacy';
import { fallFate, lastReign } from './rulers';
import type { CivApi } from './api';
import { defineKnobs } from './engine/knobs';

// ---- 调参(以 20 个种子的统计为准) ----
/** 这一段的旋钮(名字、官方的值;推演照这个世界的那套数算,见 engine/knobs.ts) */
export const EXILE_KNOBS = defineKnobs('exile', {
  /**
   * 邻国:亡国以前的国土往外这么多步以内(多半是被灭他的国家四面围住才亡的,紧挨着的往往只剩它;
   * 20 个种子里 2 步以内能找到去处的出奔不到一半,4 步八成多)
   */
  HOPS: 4,
  /** 亡国以前的国土:这么多年内结束的(和亡国这一刻才议和的)仗里丢的州;这么多年内和他打过仗的国家不去 */
  LOOKBACK: 30,
  /** 和灭他的国家这么多年内打过仗,算敌对 */
  FOE_YEARS: 30,
});

// 随机数用途
const U_PICK = 1;

/** 出奔的去处:那国、缘由(EXILE_TIES 的下标)、那国国都所在州和城 */
export interface Refuge {
  host: number;
  tie: number;
  region: number;
  settlement: number;
}

/**
 * 推演里给亡国之君找去处的函数(treaties.ts 在亡国那一刻调)。owner = 推演里各州的归属;
 * inPact(y, q) = y 亡以前和 q 同在一份约里(约还没因为它亡了作废)
 */
export function refugeFinder(
  api: CivApi,
  pm: PolityModel,
  wm: WarModel,
  dm: DiplomacyModel,
  owner: ArrayLike<number>,
  inPact: (y: number, q: number) => boolean,
): (x: number, y: number, t: Year) => Refuge | null {
  const { HOPS, LOOKBACK, FOE_YEARS } = pm.knobs.get(EXILE_KNOBS);
  const reg = pm.terrain.regions;
  const R = owner.length;
  const base = subSeed(pm.seed, 'civ-exile');
  const alive = (p: number) => p >= 0 && pm.polities[p]?.ended === undefined;
  /** p、q 在 since 以后打过仗(还在打的也算) */
  const fought = (p: number, q: number, since: Year): boolean => {
    for (let i = wm.wars.length - 1; i >= 0; i--) {
      const w = wm.wars[i];
      if (!w) continue;
      if (w.start < since - 300) break;
      if (((w.a === p && w.b === q) || (w.a === q && w.b === p)) && (w.end ?? Infinity) >= since) return true;
    }
    return false;
  };

  return (x, y, t) => {
    const Y = pm.polities[y];
    // 末代之君的下场不是出奔的(殉国、出降)不找
    const r = lastReign(bookOf(pm, y, t), (Y.dynasties?.length || 1) - 1, t);
    if (!r || fallFate(pm.rbase, pm.rtag[y], r) !== 'fled') return null;
    // 亡国以前的国土:近年战争里丢的州、亡国时的国都
    const dist = new Int16Array(R).fill(-1);
    const queue: number[] = [];
    const seed = (q: number) => {
      if (q >= 0 && q < R && dist[q] < 0) {
        dist[q] = 0;
        queue.push(q);
      }
    };
    for (let i = wm.wars.length - 1; i >= 0; i--) {
      const w = wm.wars[i];
      if (!w) continue;
      if (w.start < t - LOOKBACK - 300) break;
      if ((w.a !== y && w.b !== y) || (w.end ?? t) < t - LOOKBACK) continue;
      for (const e of w.takes) if (e.by !== y) seed(e.region);
    }
    const cap = pm.settlements[capitalAt(Y, t)];
    if (cap) seed(cap.region);
    // 往外 HOPS 步:每国最近的步数
    const hops = new Map<number, number>();
    for (let h = 0; h < queue.length; h++) {
      const q = queue[h];
      const o = owner[q];
      if (o >= 0 && o !== y && !hops.has(o)) hops.set(o, dist[q]);
      if (dist[q] >= HOPS) continue;
      for (let e = reg.adjStart[q]; e < reg.adjStart[q + 1]; e++) {
        const n = reg.adj[e];
        if (dist[n] >= 0) continue;
        dist[n] = dist[q] + 1;
        queue.push(n);
      }
    }
    const at = Math.round(t * 256);
    let best: { q: number; tie: number; d: number; u: number } | null = null;
    for (const [q, d] of [...hops].sort((a, b) => a[0] - b[0])) {
      if (q === x || !alive(q) || dm.pactOf(q, x) || dm.vassalTie(q, x) || fought(q, y, t - LOOKBACK)) continue;
      const kin = (api.diplomacy.bond?.(y, q, t) ?? 0) > 0;
      const ally = dm.pacts.some((v) => (v.a === y && v.b === q) || (v.a === q && v.b === y));
      const tie = kin
        ? 0
        : ally
          ? 1
          : inPact(y, q)
            ? 2
            : pm.polities[q].culture === Y.culture
              ? 3
              : fought(q, x, t - FOE_YEARS) || hates(pm, q, x, t) || hates(pm, x, q, t)
                ? 4
                : 5;
      const u = keyed4(base, pm.ptag[y], pm.ptag[q], at, U_PICK);
      if (!best || tie < best.tie || (tie === best.tie && (d < best.d || (d === best.d && u < best.u)))) best = { q, tie, d, u };
    }
    if (!best) return null;
    const sid = capitalAt(pm.polities[best.q], t);
    return { host: best.q, tie: best.tie, region: pm.settlements[sid]?.region ?? -1, settlement: sid };
  };
}

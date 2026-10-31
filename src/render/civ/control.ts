/**
 * 管辖图层:地图按各州中央管得到几成上色(直辖、代管、自治三档紫色由深到浅,割据橙色),留国界、国名;
 * 割据的州名义上还归原国,国界照旧画在原国里。
 *
 * - 一份数值填色图层的定义(CONTROL_LAYER,见 numLayer.ts):色块、图例、悬停都从它读。
 * - 色块:把各州的档位换进"民族"那一层(controlCiv,和时代图层同一套,见 numLayer.ts 的 numCiv)再画;
 *   档位取推演里每 20 年存的一份快照(gen/civ/control.ts 的 controlAt),只有在国家里的州上色。
 * - 现在的割据(lordsAt):快照里割据的州,按离哪处割据的那座城近分给它(同一国里、相邻的割据州连着走)。
 */
import { Layer, type Civ, type Year } from '../../gen/civ/types';
import { CONTROL_TIERS, LORD_BYTE, controlAt, controlShare, controlTier } from '../../gen/civ/control';
import { cutDone } from '../../gen/civ/councilRules';
import { knobsOf } from '../../gen/civ/knobs';
import { polityName } from '../../gen/civ/growth';
import { logIndexAfter, ownersAt, type Owners } from '../../gen/civ/engine/timeline';
import { numBase, numCiv, type NumLayer } from './numLayer';

/** 四档的颜色(直辖、代管、自治、割据) */
export const CONTROL_COLORS: readonly (readonly [number, number, number])[] = [
  [66, 36, 140],
  [158, 128, 214],
  [226, 218, 242],
  [232, 112, 32],
];

/** 推演里多少年存一份快照(发展度那一步) */
const CONTROL_STEP = 20;

/** 这一年用的是哪一年的快照(没有 = null) */
export function controlSampleYear(civ: Civ, year: Year): Year | null {
  const ys = civ.development?.controlYears;
  if (!ys?.length || year < ys[0]) return null;
  let lo = 0;
  let hi = ys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ys[mid] <= year) lo = mid + 1;
    else hi = mid;
  }
  return ys[lo - 1];
}

/** 某年各州是哪一档(0 直辖、1 代管、2 自治、3 割据;不在国家里 = −1)。out 可复用 */
export function controlTiersAt(civ: Civ, year: Year, out?: Int16Array): Int16Array {
  const R = civ.regions.count;
  const res = out && out.length === R ? out : new Int16Array(R);
  const snap = controlAt(civ, year);
  const knobs = knobsOf(civ);
  for (let r = 0; r < R; r++) res[r] = !snap || !snap[r] ? -1 : controlTier(knobs, snap[r]);
  return res;
}

/** 某年某州:管得到几成(0–1;割据 = 0)、哪一档;不在国家里 / 没有快照 = null */
export function controlOf(civ: Civ, year: Year, r: number): { share: number; tier: number } | null {
  const v = controlAt(civ, year)?.[r];
  if (!v) return null;
  return { share: controlShare(v), tier: controlTier(knobsOf(civ), v) };
}

let countTiers: Int16Array | undefined;

/**
 * 管辖图层:四档 = 直辖、代管、自治、割据(名字 CONTROL_TIERS、颜色 CONTROL_COLORS),只有在国家里的州上色。
 * 图例按这一年列四档各几州(一州都没有的档不列);悬停写档名,割据的写名义上属哪国
 */
export const CONTROL_LAYER: NumLayer = {
  id: 'control',
  bands: CONTROL_COLORS.map((color, i) => ({ name: CONTROL_TIERS[i], color })),
  has: (civ) => !!civ.development?.controlYears?.length,
  focus: () => 0,
  step: CONTROL_STEP,
  sampler(civ) {
    const R = civ.regions.count;
    const knobs = knobsOf(civ);
    return (y, into) => {
      const snap = controlAt(civ, y);
      for (let r = 0; r < R; r++) into[r] = !snap || !snap[r] ? -1 : controlTier(knobs, snap[r]);
    };
  },
  counts(civ, year) {
    countTiers = controlTiersAt(civ, year, countTiers);
    const n = new Array<number>(CONTROL_TIERS.length).fill(0);
    for (let r = 0; r < countTiers.length; r++) if (countTiers[r] >= 0) n[countTiers[r]]++;
    return n;
  },
  title: () => '管辖',
  legend: { desc: false, keepEmpty: false },
  hover(civ, year, r, own) {
    const po = own.polity[r] >= 0 ? civ.polities[own.polity[r]] : undefined;
    const ctl = po ? controlOf(civ, year, r) : null;
    if (!ctl) return null;
    const lord = ctl.tier === 3 ? lordOf(civ, year, r) : null;
    const nominal = lord && civ.polities[lord.p] ? civ.polities[lord.p] : po!;
    return { band: ctl.tier, sub: ctl.tier === 3 ? `割据，名义上属${polityName(nominal, year)}` : CONTROL_TIERS[ctl.tier] };
  },
};

/** 把各州的档位换进"民族"那一层的 Civ(只给画色块用,见 numLayer.ts 的 numCiv)。按 civ 缓存 */
export function controlCiv(civ: Civ): Civ {
  return numCiv(CONTROL_LAYER, civ, 0);
}

/** controlCiv 换出来的 Civ → 原来的 Civ(不是换出来的 = null) */
export function controlBase(view: Civ): Civ | null {
  return numBase(view, CONTROL_LAYER);
}

/** 一处还在的割据 */
export interface LordNow {
  /** 名义上的国家 */
  p: number;
  /** 起事的那座城所在的州、那座城 */
  region: number;
  city: number;
  /** 割据那年 */
  start: Year;
  /** 地盘里的州(起事的州在前) */
  regions: number[];
}

let own: Owners | undefined;
const lordCache = new WeakMap<Civ, { year: Year; list: LordNow[] }>();

/**
 * 某年还在的割据(和图层同一份快照):快照里起事的州还是割据、还归那国的,算还在;
 * 快照里每个割据的州分给同一国里连着走得到的、最近的那一处(先起的先占)。按割据那年先后排
 */
export function lordsAt(civ: Civ, year: Year): LordNow[] {
  const y = controlSampleYear(civ, year);
  if (y === null) return [];
  const hit = lordCache.get(civ);
  if (hit && hit.year === y) return hit.list;
  const snap = controlAt(civ, y)!;
  own = ownersAt(civ, y, own);
  const owner = own.polity;
  // 每州最近一次割据(同一国、同一州以后又割据的,前一处早已了结);收回了的、削藩办成的去掉
  // (不去掉的话,起事的州后来落进邻近另一处割据的地盘,快照里还是割据,会被当成还在)
  const latest = new Map<number, LordNow>();
  for (const e of civ.annals) {
    if (e.year > y) break;
    if (e.kind === 'warlord') latest.set(e.region, { p: e.a, region: e.region, city: e.settlement, start: e.year, regions: [e.region] });
    else if ((e.kind === 'reclaim' || cutDone(e)) && latest.get(e.region)?.p === e.a) latest.delete(e.region);
  }
  // 起事的州割据以后换过国家(哪怕后来又打回来)的,那处割据也了结了
  if (latest.size) {
    const log = civ.log;
    let from = Infinity;
    for (const w of latest.values()) from = Math.min(from, w.start);
    const end = logIndexAfter(log, y);
    for (let i = logIndexAfter(log, from); i < end; i++) {
      if (log.layer[i] !== Layer.Polity) continue;
      const w = latest.get(log.region[i]);
      if (w && log.year[i] > Math.fround(w.start)) latest.delete(w.region);
    }
  }
  const list: LordNow[] = [];
  for (const w of latest.values()) if (snap[w.region] === LORD_BYTE && owner[w.region] === w.p) list.push(w);
  list.sort((a, b) => a.start - b.start || a.region - b.region);
  // 一圈一圈往外分:同一国、相邻的割据州
  const reg = civ.regions;
  const taken = new Int32Array(reg.count).fill(-1);
  let front: [number, number][] = [];
  list.forEach((w, i) => {
    taken[w.region] = i;
    front.push([w.region, i]);
  });
  while (front.length) {
    const next: [number, number][] = [];
    for (const [r, i] of front) {
      for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
        const j = reg.adj[e];
        if (taken[j] >= 0 || snap[j] !== LORD_BYTE || owner[j] !== list[i].p) continue;
        taken[j] = i;
        list[i].regions.push(j);
        next.push([j, i]);
      }
    }
    front = next;
  }
  lordCache.set(civ, { year: y, list });
  return list;
}

/** 某年某州属于哪一处割据(不是割据的州 = null) */
export function lordOf(civ: Civ, year: Year, r: number): LordNow | null {
  for (const w of lordsAt(civ, year)) if (w.regions.includes(r)) return w;
  return null;
}

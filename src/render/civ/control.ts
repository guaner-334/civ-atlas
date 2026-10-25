/**
 * 管辖图层:地图按各州中央管得到几成上色(直辖、代管、自治三档紫色由深到浅,割据橙色),留国界、国名;
 * 割据的州名义上还归原国,国界照旧画在原国里。
 *
 * - 色块:把各州的档位换进"民族"那一层(controlCiv,和时代图层同一套,见 era.ts 的 swapCiv)再画;
 *   档位取推演里每 20 年存的一份快照(gen/civ/control.ts 的 controlAt),只有在国家里的州上色。
 * - 现在的割据(lordsAt):快照里割据的州,按离哪处割据的那座城近分给它(同一国里、相邻的割据州连着走)。
 */
import type { Civ, Year } from '../../gen/civ/types';
import { CONTROL_TIERS, LORD_BYTE, controlAt, controlShare, controlTier } from '../../gen/civ/control';
import { ownersAt, type Owners } from '../../gen/civ/timeline';
import { swapCiv } from './era';

/** 四档的颜色(直辖、代管、自治、割据) */
export const CONTROL_COLORS: readonly (readonly [number, number, number])[] = [
  [66, 36, 140],
  [158, 128, 214],
  [226, 218, 242],
  [232, 112, 32],
];

/** 推演里多少年存一份快照(发展度那一步) */
const CONTROL_STEP = 20;

const views = new WeakMap<Civ, Civ>();
const bases = new WeakMap<Civ, Civ>();

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
  for (let r = 0; r < R; r++) res[r] = !snap || !snap[r] ? -1 : controlTier(snap[r]);
  return res;
}

/** 某年某州:管得到几成(0–1;割据 = 0)、哪一档;不在国家里 / 没有快照 = null */
export function controlOf(civ: Civ, year: Year, r: number): { share: number; tier: number } | null {
  const v = controlAt(civ, year)?.[r];
  if (!v) return null;
  return { share: controlShare(v), tier: controlTier(v) };
}

/**
 * 把各州的档位换进"民族"那一层的 Civ(只给画色块用):民族列表换成四档(颜色 = CONTROL_COLORS),
 * 日志和检查点里民族那一层换成各州的档位;国家那一层、州、城一样不变。按 civ 缓存
 */
export function controlCiv(civ: Civ): Civ {
  const hit = views.get(civ);
  if (hit) return hit;
  const R = civ.regions.count;
  const view = swapCiv(civ, CONTROL_STEP, CONTROL_COLORS.map((c, i) => [CONTROL_TIERS[i], c] as const), (y, into) => {
    const snap = controlAt(civ, y);
    for (let r = 0; r < R; r++) into[r] = !snap || !snap[r] ? -1 : controlTier(snap[r]);
  });
  views.set(civ, view);
  bases.set(view, civ);
  return view;
}

/** controlCiv 换出来的 Civ → 原来的 Civ(不是换出来的 = null) */
export function controlBase(view: Civ): Civ | null {
  return bases.get(view) ?? null;
}

/** 四档的颜色(colors[档 × 3 …]) */
export function controlColors(): Uint8Array {
  const out = new Uint8Array(CONTROL_COLORS.length * 3);
  CONTROL_COLORS.forEach((c, i) => out.set(c, i * 3));
  return out;
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
  // 每州最近一次割据(同一国、同一州以后又割据的,前一处早已了结);收回了的去掉
  // (不去掉的话,起事的州后来落进邻近另一处割据的地盘,快照里还是割据,会被当成还在)
  const latest = new Map<number, LordNow>();
  for (const e of civ.annals) {
    if (e.year > y) break;
    if (e.kind === 'warlord') latest.set(e.region, { p: e.a, region: e.region, city: e.settlement, start: e.year, regions: [e.region] });
    else if (e.kind === 'reclaim' && latest.get(e.region)?.p === e.a) latest.delete(e.region);
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

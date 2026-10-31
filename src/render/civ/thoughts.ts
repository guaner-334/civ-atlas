/**
 * 思潮图层:一次看一说,各州按信这一说的有几成分五档上一种玫红(半成、一成、三成、五成、七成以上;不到半成不上色),留国界、国名。
 *
 * - 一份数值填色图层的定义(THOUGHT_LAYER,见 numLayer.ts):色块、图例、悬停都从它读。
 * - 色块:把各州的档换进"民族"那一层(thoughtCiv,和时代、管辖图层同一套,见 numLayer.ts 的 numCiv)再画;
 *   每 THOUGHT_STEP 年取一次(gen/civ/ideology.ts 的 ideologyAt,每 20 年一份快照)。按 civ + 哪一说缓存。
 * - 看哪一说(thoughtFocus):CivShow.thought;没给、或那说这一年还没有人倡 = 这一年到半成的州最多的那说;世上还没有思潮 = −1。
 * - 和别的填色分开靠:信仰、民族是多色并排,管辖是紫色三档加橙,思潮是一种颜色的深浅。
 */
import type { Civ, Year } from '../../gen/civ/types';
import { THOUGHTS, THOUGHT_COUNT, ideologyAt, thoughtOrigin } from '../../gen/civ/ideology';
import { numBase, numCiv, type NumLayer } from './numLayer';

/** 五档的下限(接受度):半成、一成、三成、五成、七成 */
export const THOUGHT_BANDS: readonly number[] = [0.05, 0.1, 0.3, 0.5, 0.7];
/** 五档的名字(图例的刻度) */
export const THOUGHT_BAND_NAMES: readonly string[] = ['半成', '一成', '三成', '五成', '七成'];
/** 五档的颜色:一种玫红由浅到深 */
export const THOUGHT_COLORS: readonly (readonly [number, number, number])[] = [
  [248, 218, 230],
  [238, 166, 196],
  [218, 98, 148],
  [178, 36, 100],
  [118, 10, 64],
];

/** 图层多少年取一次(和思潮的快照一样) */
const THOUGHT_STEP = 20;

/** 比档的下限时让一点(快照存的是整数 / IDEO_SCALE,读回 Float32 时 175 / 250 成了 0.69999…,要算七成) */
const BAND_EPS = 1e-6;

/** 接受度 → 第几档(不到半成 = −1) */
export function thoughtBand(a: number): number {
  for (let b = THOUGHT_BANDS.length - 1; b >= 0; b--) if (a >= THOUGHT_BANDS[b] - BAND_EPS) return b;
  return -1;
}

/** 第 k 说这一年有没有人倡过(始倡的那一年就算:编年史写"1036 年 3 月始倡",时间轴拨到 1036 年就列出来) */
export function thoughtEmerged(civ: Civ, k: number, year: Year): boolean {
  const o = civ.ideology ? thoughtOrigin(civ.ideology, k) : undefined;
  return !!o && Math.floor(o.year) <= year;
}

let countKey: { civ: Civ; year: Year; n: number[] } | null = null;
let buf: Float32Array | undefined;

/** 这一年各说到半成的州数(说数个) */
export function thoughtCounts(civ: Civ, year: Year): number[] {
  if (countKey && countKey.civ === civ && countKey.year === year) return countKey.n;
  const K = THOUGHT_COUNT;
  const n = new Array<number>(K).fill(0);
  const ideo = civ.ideology;
  if (ideo) {
    buf = ideologyAt(ideo, year, buf);
    const R = buf.length / K;
    for (let r = 0; r < R; r++) for (let k = 0; k < K; k++) if (thoughtBand(buf[r * K + k]) >= 0) n[k]++;
  }
  countKey = { civ, year, n };
  return n;
}

/** 这一年默认看哪一说:到半成的州最多的那说(一样多取先冒出来的);一说都还没有 = −1 */
export function thoughtAuto(civ: Civ, year: Year): number {
  const n = thoughtCounts(civ, year);
  let best = -1;
  for (let k = 0; k < THOUGHT_COUNT; k++) {
    if (!thoughtEmerged(civ, k, year)) continue;
    if (best < 0 || n[k] > n[best] || (n[k] === n[best] && thoughtOrigin(civ.ideology!, k)!.year < thoughtOrigin(civ.ideology!, best)!.year)) best = k;
  }
  return best;
}

/** 看哪一说:选过的那说这一年已经有人倡就看它,不然看默认的(thoughtAuto);世上还没有思潮 = −1 */
export function thoughtFocus(civ: Civ, show: { thought?: number }, year: Year): number {
  const k = show.thought;
  if (k !== undefined && k >= 0 && k < THOUGHT_COUNT && thoughtEmerged(civ, k, year)) return k;
  return thoughtAuto(civ, year);
}

let countBuf: Float32Array | undefined;

/**
 * 思潮图层:一次看一说(k = thoughtFocus),五档 = 信这一说的有半成、一成、三成、五成、七成以上(颜色 THOUGHT_COLORS)。
 * 地图上信仰也开着时让给信仰。图例按这一年列五档各几州(深的在上,一州都没有的档照样列,看得出还没传到);
 * 悬停写"某说 23%"(有人住的州;世上还没有思潮时不按这一层说)
 */
export const THOUGHT_LAYER: NumLayer = {
  id: 'ideology',
  bands: THOUGHT_COLORS.map((color, i) => ({ name: THOUGHT_BAND_NAMES[i], color })),
  has: (civ) => !!civ.ideology,
  belowFaith: true,
  focus: thoughtFocus,
  step: THOUGHT_STEP,
  sampler(civ, k) {
    const K = THOUGHT_COUNT;
    const at = Math.max(0, Math.min(K - 1, k));
    const R = civ.regions.count;
    const ideo = civ.ideology;
    let v: Float32Array | undefined;
    return (y, into) => {
      if (!ideo || k < 0) {
        into.fill(-1);
        return;
      }
      v = ideologyAt(ideo, y, v);
      const n = Math.min(R, v.length / K);
      for (let r = 0; r < R; r++) into[r] = r < n ? thoughtBand(v[r * K + at]) : -1;
    };
  },
  kindName: (b, k) => `${THOUGHTS[Math.max(0, Math.min(THOUGHT_COUNT - 1, k))].name}${THOUGHT_BAND_NAMES[b]}`,
  counts(civ, year, k) {
    const n = new Array<number>(THOUGHT_BANDS.length).fill(0);
    if (civ.ideology && k >= 0) {
      const v = (countBuf = ideologyAt(civ.ideology, year, countBuf));
      for (let r = 0; r * THOUGHT_COUNT < v.length; r++) {
        const b = thoughtBand(v[r * THOUGHT_COUNT + k]);
        if (b >= 0) n[b]++;
      }
    }
    return n;
  },
  title: (k) => (k >= 0 ? `思潮:${THOUGHTS[k].name}各州有几成人信` : '思潮'),
  legend: {
    desc: true,
    keepEmpty: true,
    rowName: (b) => (b === THOUGHT_BANDS.length - 1 ? `${THOUGHT_BAND_NAMES[b]}以上` : `${THOUGHT_BAND_NAMES[b]}到${THOUGHT_BAND_NAMES[b + 1]}`),
  },
  hover(civ, year, r, own, show) {
    if (!civ.ideology || !civ.cultures[own.culture[r]]) return null;
    const th = thoughtFocus(civ, show, year);
    if (th < 0) return null;
    const a = thoughtShare(civ, year, r, th);
    return { band: thoughtBand(a), sub: `${THOUGHTS[th].name} ${Math.round(a * 100)}%` };
  },
};

/**
 * 把第 k 说各州的档换进"民族"那一层的 Civ(只给画色块用,见 numLayer.ts 的 numCiv)。
 * 按 civ + 哪一说缓存(k < 0 = 一州都不上色;k 超出说数按最后一说)
 */
export function thoughtCiv(civ: Civ, k: number): Civ {
  return numCiv(THOUGHT_LAYER, civ, k < 0 ? -1 : Math.min(THOUGHT_COUNT - 1, k));
}

/** thoughtCiv 换出来的 Civ → 原来的 Civ(不是换出来的 = null) */
export function thoughtBase(view: Civ): Civ | null {
  return numBase(view, THOUGHT_LAYER);
}

/** 某年某州第 k 说的接受度(0–1;没有思潮 = 0) */
export function thoughtShare(civ: Civ, year: Year, r: number, k: number): number {
  const ideo = civ.ideology;
  if (!ideo || k < 0) return 0;
  buf = ideologyAt(ideo, year, buf);
  return buf[r * THOUGHT_COUNT + k] ?? 0;
}

/**
 * 时代图层:地图按各州此刻所处的时代上色(色块画法和信仰图层一样,见 territory.ts),留国界、国名。
 *
 * - 一份数值填色图层的定义(ERA_LAYER,见 numLayer.ts):色块、图例、悬停都从它读。
 * - 色块:把各州的时代换进"民族"那一层(eraCiv)再画 —— 罩染、晕边、按界线判归属、刚进新时代的州慢慢洇开,都沿用民族色块那一套。
 *   时代按 ERA_STEP 年取一次(前后两份快照插值,见 development.ts 的 developmentAt),只有人住的州上色。
 * - 颜色:早的浅、暖,晚的深、冷(ERA_COLORS)。
 */
import type { Civ, Year } from '../../gen/civ/types';
import { ERAS, developmentAt, eraLevel, eraOf } from '../../gen/civ/development';
import { ownersAt, type Owners } from '../../gen/civ/timeline';
import { numCiv, type NumLayer } from './numLayer';

/** 九个时代的颜色(石器 → 未来) */
export const ERA_COLORS: readonly (readonly [number, number, number])[] = [
  [222, 214, 198],
  [226, 178, 90],
  [200, 106, 78],
  [152, 94, 152],
  [78, 112, 176],
  [46, 142, 152],
  [74, 152, 92],
  [44, 104, 74],
  [36, 64, 70],
];

/** 时代图层多少年取一次各州的时代 */
const ERA_STEP = 20;

/** 时代的全名:"中古时代" */
export function eraName(era: number): string {
  return `${ERAS[Math.max(0, Math.min(ERAS.length - 1, era))]}时代`;
}

let lv: Float32Array | undefined;
/** 某年各州的时代数值(整数部分 = 第几个时代,小数 = 走了几成;没人住 = −1)。out 可复用 */
export function eraLevelsAt(civ: Civ, year: Year, own?: Owners, out?: Float32Array): Float32Array {
  const R = civ.regions.count;
  const res = out && out.length === R ? out : new Float32Array(R);
  const dev = civ.development;
  if (!dev) return res.fill(-1);
  const o = own ?? ownersAt(civ, year);
  lv = developmentAt(dev, year, lv);
  for (let r = 0; r < R; r++) res[r] = o.culture[r] < 0 ? -1 : Math.max(0, eraLevel(lv, r));
  return res;
}

/** 时代图层在这一年用的是哪一年取的时代:每 ERA_STEP 年取一次,最后一次在结束年份(和 eraCiv 的取法一样) */
export function eraSampleYear(civ: Civ, year: Year): Year {
  if (year >= civ.endYear) return civ.endYear;
  return Math.max(0, Math.floor(year / ERA_STEP) * ERA_STEP);
}

let own: Owners | undefined;
let lvAt: Float32Array | undefined;
/** 某年各州是第几个时代(0 = 石器 … 8 = 未来;没人住 = −1),和时代图层的色块同一份(按 eraSampleYear 取)。out 可复用 */
export function erasAt(civ: Civ, year: Year, out?: Int16Array): Int16Array {
  const R = civ.regions.count;
  const res = out && out.length === R ? out : new Int16Array(R);
  const y = eraSampleYear(civ, year);
  own = ownersAt(civ, y, own);
  lvAt = eraLevelsAt(civ, y, own, lvAt);
  for (let r = 0; r < R; r++) res[r] = lvAt[r] < 0 ? -1 : Math.min(ERAS.length - 1, Math.floor(lvAt[r]));
  return res;
}

let countLv: Float32Array | undefined;
let hoverLv: Float32Array | undefined;

/**
 * 时代图层:九档 = 九个时代(名字 eraName、颜色 ERA_COLORS)。
 * 图例按这一年列有州在的时代(新的在上)和州数;悬停写"中古时代 53%"(走了几成)
 */
export const ERA_LAYER: NumLayer = {
  id: 'eras',
  bands: ERA_COLORS.map((color, i) => ({ name: eraName(i), color })),
  has: (civ) => !!civ.development,
  focus: () => 0,
  step: ERA_STEP,
  sampler(civ) {
    const R = civ.regions.count;
    let own: Owners | undefined;
    let level: Float32Array | undefined;
    return (y, into) => {
      own = ownersAt(civ, y, own);
      level = eraLevelsAt(civ, y, own, level);
      for (let r = 0; r < R; r++) into[r] = level[r] < 0 ? -1 : Math.min(ERAS.length - 1, Math.floor(level[r]));
    };
  },
  counts(civ, year) {
    countLv = eraLevelsAt(civ, year, undefined, countLv);
    const n = new Array<number>(ERA_COLORS.length).fill(0);
    for (let r = 0; r < countLv.length; r++) if (countLv[r] >= 0) n[Math.min(ERA_COLORS.length - 1, Math.floor(countLv[r]))]++;
    return n;
  },
  title: () => '时代',
  legend: { desc: true, keepEmpty: false },
  hover(civ, year, r, own) {
    if (!civ.development || !civ.cultures[own.culture[r]]) return null;
    const level = (hoverLv = eraLevelsAt(civ, year, own, hoverLv))[r];
    if (!(level >= 0)) return null;
    const { era, progress } = eraOf(level);
    return { band: era, sub: `${eraName(era)} ${Math.floor(progress * 100)}%` };
  },
};

/** 把时代换进"民族"那一层的 Civ(只给画色块用,见 numLayer.ts 的 numCiv)。按 civ 缓存 */
export function eraCiv(civ: Civ): Civ {
  return numCiv(ERA_LAYER, civ, 0);
}

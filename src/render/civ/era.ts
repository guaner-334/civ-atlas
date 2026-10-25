/**
 * 时代图层:地图按各州此刻所处的时代上色(色块画法和信仰图层一样,见 territory.ts),留国界、国名。
 *
 * - 色块:把各州的时代换进"民族"那一层(eraCiv)再画 —— 罩染、晕边、按界线判归属、刚进新时代的州慢慢洇开,都沿用民族色块那一套。
 *   时代按 ERA_STEP 年取一次(前后两份快照插值,见 development.ts 的 developmentAt),只有人住的州上色。
 * - 颜色:早的浅、暖,晚的深、冷(ERA_COLORS)。
 */
import type { Civ, Culture, Year } from '../../gen/civ/types';
import { Layer } from '../../gen/civ/types';
import { ERAS, developmentAt, eraLevel } from '../../gen/civ/development';
import { ownersAt, type Owners } from '../../gen/civ/timeline';

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

const views = new WeakMap<Civ, Civ>();
const bases = new WeakMap<Civ, Civ>();

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

/**
 * 把时代换进"民族"那一层的 Civ(只给画色块用):民族列表换成九个时代(颜色 = ERA_COLORS),
 * 日志和检查点里民族那一层换成各州的时代(每 ERA_STEP 年取一次);国家那一层、州、城一样不变。按 civ 缓存
 */
export function eraCiv(civ: Civ): Civ {
  const hit = views.get(civ);
  if (hit) return hit;
  const R = civ.regions.count;
  let own: Owners | undefined;
  let level: Float32Array | undefined;
  const view = swapCiv(civ, ERA_STEP, ERA_COLORS.map((c, id) => [eraName(id), c] as const), (y, into) => {
    own = ownersAt(civ, y, own);
    level = eraLevelsAt(civ, y, own, level);
    for (let r = 0; r < R; r++) into[r] = level[r] < 0 ? -1 : Math.min(ERAS.length - 1, Math.floor(level[r]));
  });
  views.set(civ, view);
  bases.set(view, civ);
  return view;
}

/**
 * 把每州的一个"类别"换进"民族"那一层的 Civ(时代图层、管辖图层用):民族列表换成 kinds(名字、颜色),
 * 日志和检查点里民族那一层换成各州的类别(从第 0 年起每 step 年取一次,最后一次在结束年份;at 写进 into,−1 = 不上色);
 * 国家那一层、州、城一样不变
 */
export function swapCiv(
  civ: Civ,
  step: number,
  kinds: readonly (readonly [string, readonly [number, number, number]])[],
  at: (y: Year, into: Int16Array) => void,
): Civ {
  const R = civ.regions.count;
  const L = civ.log;
  const cur = new Int16Array(R).fill(-1);
  const ys: number[] = [];
  const rs: number[] = [];
  const vs: number[] = [];
  const next = new Int16Array(R);
  for (let y = 0; ; y = Math.min(civ.endYear, y + step)) {
    at(y, next);
    for (let r = 0; r < R; r++) {
      if (next[r] === cur[r]) continue;
      ys.push(y);
      rs.push(r);
      vs.push(next[r]);
      cur[r] = next[r];
    }
    if (y >= civ.endYear) break;
  }
  // 国家那一层的条目和换进来的条目按年份并成一本(同一年国家的在前)
  let n = 0;
  for (let i = 0; i < L.size; i++) if (L.layer[i] !== Layer.Culture) n++;
  const size = n + ys.length;
  const log = {
    size,
    year: new Float32Array(size),
    region: new Int32Array(size),
    layer: new Uint8Array(size),
    value: new Int16Array(size),
    cause: new Uint8Array(size),
  };
  let i = 0;
  let j = 0;
  for (let k = 0; k < size; k++) {
    while (i < L.size && L.layer[i] === Layer.Culture) i++;
    if (i < L.size && (j >= ys.length || L.year[i] <= ys[j])) {
      log.year[k] = L.year[i];
      log.region[k] = L.region[i];
      log.layer[k] = L.layer[i];
      log.value[k] = L.value[i];
      i++;
    } else {
      log.year[k] = ys[j];
      log.region[k] = rs[j];
      log.layer[k] = Layer.Culture;
      log.value[k] = vs[j];
      j++;
    }
  }
  // 检查点:那一年(含)以前最后一次取到的类别
  const checkpoints = civ.checkpoints.map((cp) => {
    const c = new Int16Array(R).fill(-1);
    for (let q = 0; q < ys.length && ys[q] <= cp.year; q++) c[rs[q]] = vs[q];
    return { year: cp.year, culture: c, polity: cp.polity };
  });
  const base = civ.cultures[0];
  const cultures = kinds.map(([name, color], id): Culture => ({ ...base, id, name, color: [color[0], color[1], color[2]] }));
  return { ...civ, cultures, log, checkpoints, culture: cur.slice() };
}

/** eraCiv 换出来的 Civ → 原来的 Civ(不是换出来的 = null) */
export function eraBase(view: Civ): Civ | null {
  return bases.get(view) ?? null;
}

/** 九个时代的颜色(colors[时代 × 3 …]) */
export function eraColors(): Uint8Array {
  const out = new Uint8Array(ERA_COLORS.length * 3);
  ERA_COLORS.forEach((c, i) => out.set(c, i * 3));
  return out;
}

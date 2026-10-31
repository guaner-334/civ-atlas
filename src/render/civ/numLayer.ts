/**
 * 数值填色图层的定义和通用画法:每州一个数 → 几档颜色,同一份定义管地图上的色块、图例(侧栏、地图角上、导出图)和悬停的那一句。
 * 时代(era.ts)、管辖(control.ts)、思潮(thoughts.ts)各是一份定义,清单在 numLayers.ts;加一种数值图层写一份定义、放进清单就行。
 *
 * - 色块(numCiv):把各州的档换进"民族"那一层的 Civ 再画 —— 罩染、晕边、按界线判归属、刚换档的州慢慢洇开,都沿用民族色块那一套
 *   (territory.ts)。从第 0 年起每 step 年取一次各州的档,最后一次在结束年份。
 * - 图例(numLegendRows):各档的颜色、名字,这一年各几州。
 * - 悬停(NumLayer.hover):州名后面的那句小字和颜色块的颜色。
 */
import type { Civ, Culture, Year } from '../../gen/civ/types';
import { Layer } from '../../gen/civ/types';
import type { Owners } from '../../gen/civ/timeline';

export type Rgb = readonly [number, number, number];

/** 一档:名字(图例、色标的刻度)和颜色 */
export interface NumBand {
  name: string;
  color: Rgb;
}

/** 数值填色图层的编号:和文明层开关(CivShow)里那一项同名 */
export type NumLayerId = 'eras' | 'control' | 'ideology';

/** 悬停时一州的样子:第几档(颜色块用这一档的颜色;−1 = 不带颜色块)、州名后面的小字 */
export interface NumHover {
  band: number;
  sub: string;
}

/** 图例一行:颜色、名字、右边的小字("12 州") */
export interface NumLegendRow {
  color: [number, number, number];
  name: string;
  note: string;
}

/** 一种数值填色图层 */
export interface NumLayer {
  id: NumLayerId;
  /** 几档,从低到高 */
  bands: readonly NumBand[];
  /** 这个世界有没有这种数(没有 = 开着也不铺、不列图例) */
  has(civ: Civ): boolean;
  /** 地图上信仰也开着时让给信仰 */
  belowFaith?: boolean;
  /** 看哪一份:思潮 = 看哪一说(世上还没有 = −1);只有一份的 = 0 */
  focus(civ: Civ, show: { thought?: number }, year: Year): number;
  /** 色块:多少年取一次各州的档 */
  step: number;
  /** 色块:取档的函数(第 k 份;y 年各州的档写进 into,−1 = 不上色)。每个换出来的 Civ 要一个新的,里面的暂存各用各的 */
  sampler(civ: Civ, k: number): (y: Year, into: Int16Array) => void;
  /** 色块:换进民族表时每档叫什么(不给 = 档名) */
  kindName?(band: number, k: number): string;
  /** 图例:某年各档几州 */
  counts(civ: Civ, year: Year, k: number): number[];
  /** 图例:标题(导出图例里这一块的标题) */
  title(k: number): string;
  /** 图例怎么列:desc = 高的档在上;keepEmpty = 一州都没有的档也列;rowName = 每行的名字(不给 = 档名) */
  legend: { desc: boolean; keepEmpty: boolean; rowName?: (band: number) => string };
  /** 悬停:某年某州(own = 那一年的归属);这州不按这一层说 = null */
  hover(civ: Civ, year: Year, r: number, own: Owners, show: { thought?: number }): NumHover | null;
}

const views = new WeakMap<Civ, Map<string, Civ>>();
const bases = new WeakMap<Civ, { civ: Civ; layer: NumLayer }>();

/**
 * 把这种数第 k 份各州的档换进"民族"那一层的 Civ(只给画色块用):民族列表换成各档(颜色 = 档的颜色),
 * 日志和检查点里民族那一层换成各州的档;国家那一层、州、城一样不变。按 civ + 图层 + k 缓存
 */
export function numCiv(layer: NumLayer, civ: Civ, k: number): Civ {
  let list = views.get(civ);
  if (!list) views.set(civ, (list = new Map()));
  const key = `${layer.id}|${k}`;
  const hit = list.get(key);
  if (hit) return hit;
  const view = swapCiv(
    civ,
    layer.step,
    layer.bands.map((b, i) => [layer.kindName ? layer.kindName(i, k) : b.name, b.color] as const),
    layer.sampler(civ, k),
  );
  list.set(key, view);
  bases.set(view, { civ, layer });
  return view;
}

/** numCiv 换出来的 Civ → 原来的 Civ(不是换出来的,或给了 layer 而不是这一层换出来的 = null) */
export function numBase(view: Civ, layer?: NumLayer): Civ | null {
  const b = bases.get(view);
  return b && (!layer || b.layer === layer) ? b.civ : null;
}

/** numCiv 换出来的 Civ 是哪一层的(不是换出来的 = null) */
export function numLayerOf(view: Civ): NumLayer | null {
  return bases.get(view)?.layer ?? null;
}

/** 各档的颜色(colors[档 × 3 …]) */
export function numColors(layer: NumLayer): Uint8Array {
  const out = new Uint8Array(layer.bands.length * 3);
  layer.bands.forEach((b, i) => out.set(b.color, i * 3));
  return out;
}

/** 图例:各档的颜色、名字,这一年各几州(按 layer.legend 排、取舍) */
export function numLegendRows(layer: NumLayer, civ: Civ, year: Year, k: number): NumLegendRow[] {
  const n = layer.counts(civ, year, k);
  const { desc, keepEmpty, rowName } = layer.legend;
  const B = layer.bands.length;
  const out: NumLegendRow[] = [];
  for (let i = 0; i < B; i++) {
    const b = desc ? B - 1 - i : i;
    if (!n[b] && !keepEmpty) continue;
    out.push({ color: [...layer.bands[b].color] as [number, number, number], name: rowName ? rowName(b) : layer.bands[b].name, note: `${n[b]} 州` });
  }
  return out;
}

/**
 * 把每州的一个"类别"换进"民族"那一层的 Civ:民族列表换成 kinds(名字、颜色),
 * 日志和检查点里民族那一层换成各州的类别(从第 0 年起每 step 年取一次,最后一次在结束年份;at 写进 into,−1 = 不上色);
 * 国家那一层、州、城一样不变
 */
function swapCiv(civ: Civ, step: number, kinds: readonly (readonly [string, Rgb])[], at: (y: Year, into: Int16Array) => void): Civ {
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

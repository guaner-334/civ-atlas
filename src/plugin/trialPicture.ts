/**
 * 审插件时试跑出的图(作品墙上插件的封面和详情图)怎么画:画插件在试跑里留下的东西(图层、标注、面板、编年史、改过的地形),
 * 不画一张普通的整张地图;它只动了一小片,就放大那一片。这里是纯计算的那一半(放大到哪、挑哪个、写什么字),不碰 DOM;
 * 照着画在 ui/helperPictures.ts。只看试跑记下的东西,同一个插件文件出的图每次一样。
 */
import type { CellPaint } from '../render/pluginLayer';
import { rampRange } from '../render/pluginLayer';
import { wrapSpan } from './trial';

/** 图的大小(封面、详情图都是) */
export const PIC_W = 1200;
export const PIC_H = 600;

/** card = 封面(卡片上,手机上只有 112×56,不放小字);map = 详情图(每个种子一张,带图例、字幕) */
export type PicKind = 'card' | 'map';

/** 放大的一片(世界坐标,宽高 2:1;x 可以出 [0, 宽),画的时候照左右接缝接上);null = 画整张 */
export interface PicRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 要看的东西得落在画面的哪一块(按图宽高的比例):有面板时让开右边,推演详情图让开底下的字幕 */
export interface PicArea {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export const FULL_AREA: PicArea = { x0: 0, y0: 0, x1: 1, y1: 1 };

/** 一片一片的东西有值(或改了)的地块超过全图这么多,画整张 */
export const WHOLE_SHARE = 0.25;
/** 找显眼地块的窗:全图宽的这么多,2:1 */
export const WIN_SHARE = 0.25;
/** 窗的中心不放进最北、最南各这么多(两极在图上拉得最开) */
export const POLAR_SHARE = 1 / 8;
/** 有确切位置的东西:外接框四周各留这么多 */
export const MARGIN = 0.15;
/** 放大的一片宽过全图的这么多,就画整张 */
export const ZOOM_MAX_SHARE = 0.5;

/** 面板贴在右边:封面占约三分之一、详情图占一半;看的东西落在它左边 */
export const PANEL_AREA: Record<PicKind, PicArea> = {
  card: { x0: 0, y0: 0, x1: 0.64, y1: 1 },
  map: { x0: 0, y0: 0, x1: 0.47, y1: 1 },
};
/** 推演详情图底下的字幕:框几国时让开 */
export const SUBTITLE_AREA: PicArea = { x0: 0, y0: 0, x1: 1, y1: 0.8 };

/** 显眼的地块:has = 有值(或改了),hot = 显眼(数值图层落在色带上面三分之一、分类图层有值、改动超过一定量) */
export interface Spots {
  has: Uint8Array;
  hot: Uint8Array;
}

interface MeshLike {
  n: number;
  width: number;
  height: number;
  x: ArrayLike<number>;
  y: ArrayLike<number>;
}

const count = (a: ArrayLike<number>) => {
  let k = 0;
  for (let i = 0; i < a.length; i++) if (a[i]) k++;
  return k;
};

/** 一个图层画出来的地块:分类 = 值对得上某一类;渐变 = 是有限数,显眼的是落在色带上面三分之一的 */
export function layerSpots(p: CellPaint): Spots {
  const n = p.values.length;
  const has = new Uint8Array(n);
  const hot = new Uint8Array(n);
  if (p.classes) {
    const known = new Set(p.classes.map((c) => c.value));
    for (let i = 0; i < n; i++) if (known.has(p.values[i])) has[i] = hot[i] = 1;
  } else if (p.ramp) {
    const [lo, hi] = rampRange(p);
    const cut = lo + ((hi - lo) * 2) / 3;
    for (let i = 0; i < n; i++) {
      const v = p.values[i];
      if (!Number.isFinite(v)) continue;
      has[i] = 1;
      if (hi <= lo || v >= cut) hot[i] = 1;
    }
  }
  return { has, hot };
}

/** 画出来一块都没有的图层当没有 */
export const paintFilled = (p: CellPaint): boolean => count(layerSpots(p).has) > 0;

/** 改地形算改了:海陆湖变了,或者陆地上海拔差这么多米(海底深一点浅一点图上看不出来,不算) */
export const TERRAIN_DIFF_M = 100;
/** 改气候算改了:年降水差这么多毫米,而且差过原来的这么多 */
export const CLIMATE_DIFF_MM = 100;
export const CLIMATE_DIFF_SHARE = 0.2;

export function terrainSpots(a: { elevation: ArrayLike<number>; water: ArrayLike<number> }, b: typeof a): Spots {
  const n = a.elevation.length;
  const hot = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (a.water[i] !== b.water[i] || (a.water[i] === 0 && Math.abs(a.elevation[i] - b.elevation[i]) >= TERRAIN_DIFF_M)) hot[i] = 1;
  return { has: hot, hot };
}

export function climateSpots(a: { precipitation: ArrayLike<number> }, b: typeof a): Spots {
  const n = a.precipitation.length;
  const hot = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const d = Math.abs(a.precipitation[i] - b.precipitation[i]);
    if (d >= CLIMATE_DIFF_MM && d >= Math.abs(a.precipitation[i]) * CLIMATE_DIFF_SHARE) hot[i] = 1;
  }
  return { has: hot, hot };
}

type MapCells = { elevation: ArrayLike<number>; water: ArrayLike<number>; precipitation: ArrayLike<number> };

/** 地图插件不装 / 装上比哪样:清单里有改地形、地形真改了的比地形图;不然有改气候、降水真改了的比降水图;都没改 = null */
export function pickChange(stages: readonly string[], official: MapCells, plugin: MapCells): { view: 'terrain' | 'precipitation'; spots: Spots } | null {
  if (stages.includes('height')) {
    const spots = terrainSpots(official, plugin);
    if (count(spots.hot)) return { view: 'terrain', spots };
  }
  if (stages.includes('climate')) {
    const spots = climateSpots(official, plugin);
    if (count(spots.hot)) return { view: 'precipitation', spots };
  }
  return null;
}

/**
 * 一片一片的东西放大到哪:有值的地块超过全图 WHOLE_SHARE 画整张(null);不到就拿全图宽 WIN_SHARE、2:1 的窗在图上挪
 * (中心不进最北最南各 POLAR_SHARE),取窗里显眼的地块最多的位置;并列取这些地块最居中的,再并列取最左、最上的。
 * 一块显眼的都没有(数值都在色带下面)按有值的找;一块有值的都没有 = null。
 * square = 左右对比用的正方形窗(边长 = 2:1 窗的高),直接按正方形找,免得裁成正方形时把改了的地方裁掉
 */
export function patchWindow(mesh: MeshLike, s: Spots, square = false): PicRect | null {
  const { n, width: W, height: H, x, y } = mesh;
  const nHas = count(s.has);
  if (!nHas || nHas > n * WHOLE_SHARE) return null;
  const pick = count(s.hot) ? s.hot : s.has;
  // 按格子数:窗的左上角落在格子线上,窗里的地块数用前缀和数
  const BX = 128;
  const bw = W / BX;
  const BY = Math.max(1, Math.round(H / bw));
  const bh = H / BY;
  const wh = (W * WIN_SHARE) / 2;
  const ww = square ? wh : W * WIN_SHARE;
  const cols = Math.round(ww / bw);
  const rows = Math.min(BY, Math.max(1, Math.round(wh / bh)));
  const cnt = new Float64Array(BX * BY);
  const sx = new Float64Array(BX * BY);
  const sy = new Float64Array(BX * BY);
  for (let i = 0; i < n; i++) {
    if (!pick[i]) continue;
    const xi = (((x[i] % W) + W) % W) as number;
    const bx = Math.min(BX - 1, Math.max(0, Math.floor(xi / bw)));
    const by = Math.min(BY - 1, Math.max(0, Math.floor(y[i] / bh)));
    const k = by * BX + bx;
    cnt[k]++;
    sx[k] += xi - bx * bw;
    sy[k] += y[i];
  }
  // 宽度接成两圈,窗跨过接缝也能直接用前缀和
  const PW = 2 * BX + 1;
  const pc = new Float64Array((BY + 1) * PW);
  const px = new Float64Array((BY + 1) * PW);
  const py = new Float64Array((BY + 1) * PW);
  for (let by = 0; by < BY; by++) {
    for (let bx = 0; bx < 2 * BX; bx++) {
      const k = by * BX + (bx % BX);
      const at = (by + 1) * PW + bx + 1;
      const up = by * PW + bx + 1;
      const left = (by + 1) * PW + bx;
      const diag = by * PW + bx;
      pc[at] = cnt[k] + pc[up] + pc[left] - pc[diag];
      px[at] = sx[k] + cnt[k] * bx * bw + px[up] + px[left] - px[diag];
      py[at] = sy[k] + py[up] + py[left] - py[diag];
    }
  }
  const sum = (p: Float64Array, i: number, j: number) => p[(j + rows) * PW + i + cols] - p[j * PW + i + cols] - p[(j + rows) * PW + i] + p[j * PW + i];
  const lo = H * POLAR_SHARE - 1e-9;
  const hi = H * (1 - POLAR_SHARE) + 1e-9;
  let best: { i: number; j: number; c: number; d: number } | null = null;
  for (let i = 0; i < BX; i++) {
    for (let j = 0; j + rows <= BY; j++) {
      const cy = (j + rows / 2) * bh;
      if (cy < lo || cy > hi) continue;
      const c = sum(pc, i, j);
      if (best && c < best.c) continue;
      const mx = c ? sum(px, i, j) / c - i * bw - ww / 2 : 0;
      const my = c ? sum(py, i, j) / c - j * bh - wh / 2 : 0;
      const d = mx * mx + my * my;
      if (!best || c > best.c || d < best.d - 1e-6) best = { i, j, c, d };
    }
  }
  if (!best) return null;
  return { x: best.i * bw, y: best.j * bh, w: ww, h: wh };
}

/** 图层放大到哪:按州、按年份的图层(工具插件交的 kind = regions,或存下的 unit = region,都带 years)画整张 */
export function layerWindow(
  mesh: MeshLike,
  layer: { kind?: 'cells' | 'regions'; unit?: 'cell' | 'region'; years?: readonly number[]; title?: string },
  paint: CellPaint,
): PicRect | null {
  if ((layer.kind === 'regions' || layer.unit === 'region') && (layer.years?.length ?? 0) > 0) return null;
  return patchWindow(mesh, layerSpots(paint));
}

/**
 * 要看的一片(世界坐标)落在画面的 area 里:撑成 2:1、不小于全图宽 WIN_SHARE,这样宽过全图 ZOOM_MAX_SHARE 画整张;
 * 再把画面往外撑到这一片落进 area(有面板时画面可以宽过一半,最多一整圈)。上下不出图,东西照接缝接上。
 * 画整张:area 是整个画面 = null;不是(有面板、有字幕)= 整圈转到这一片的正中对着 area 的正中
 */
export function fitArea(r: PicRect, W: number, H: number, area: PicArea = FULL_AREA): PicRect | null {
  const aw = area.x1 - area.x0;
  const ah = area.y1 - area.y0;
  if (Math.max(r.w, 2 * r.h, W * WIN_SHARE) > W * ZOOM_MAX_SHARE + 1e-9) {
    const full = area.x0 === 0 && area.y0 === 0 && area.x1 === 1 && area.y1 === 1;
    return full ? null : { x: r.x + r.w / 2 - (area.x0 + aw / 2) * W, y: 0, w: W, h: H };
  }
  const fw = Math.min(W, H * 2, Math.max(r.w / aw, (2 * r.h) / ah, W * WIN_SHARE));
  const fh = fw / 2;
  const x = r.x + r.w / 2 - (area.x0 + aw / 2) * fw;
  const y = Math.min(H - fh, Math.max(0, r.y + r.h / 2 - (area.y0 + ah / 2) * fh));
  return { x, y, w: fw, h: fh };
}

/** 有确切位置的东西(标注、网站替它框的一片、都城):外接框四周各留 MARGIN,再照 fitArea 落进 area;东西照接缝取最窄的一段 */
export function pointsWindow(pts: readonly (readonly [number, number])[], W: number, H: number, area: PicArea = FULL_AREA): PicRect | null {
  if (!pts.length) return null;
  const span = wrapSpan(
    pts.map((p) => p[0]),
    W,
  );
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    y0 = Math.min(y0, p[1]);
    y1 = Math.max(y1, p[1]);
  }
  const k = 1 / (1 - 2 * MARGIN);
  const w = span.w * k;
  const h = (y1 - y0) * k;
  return fitArea({ x: span.x0 + span.w / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h }, W, H, area);
}

/** 左右对比时每边画的正方形:放大那一片正中、边长 = 它的高;画整张时取图正中、边长 = 图高 */
export function compareSquare(r: PicRect | null, W: number, H: number): PicRect {
  if (!r) return { x: W / 2 - H / 2, y: 0, w: H, h: H };
  return { x: r.x + r.w / 2 - r.h / 2, y: r.y, w: r.h, h: r.h };
}

/** 世界坐标 (x, y) 在不在这一片里(东西照接缝) */
export function inRect(r: PicRect | null, x: number, y: number, W: number): boolean {
  if (!r) return true;
  if (y < r.y || y > r.y + r.h) return false;
  const dx = (((x - r.x) % W) + W) % W;
  return dx <= r.w;
}

/** 同一类有好几个:工具插件取最后加上的那个(压在最上面),地图、推演插件取清单里最前面的;画不出东西的当没有 */
export function lastFilled<T>(list: readonly T[], filled: (t: T) => boolean): T | null {
  for (let i = list.length - 1; i >= 0; i--) if (filled(list[i])) return list[i];
  return null;
}
export function firstFilled<T>(list: readonly T[], filled: (t: T) => boolean): T | null {
  for (const t of list) if (filled(t)) return t;
  return null;
}

/** 插件写的一条编年史:那一年、原样的字、里面提到的国家 */
export interface ChronicleRef {
  year: number;
  text: string;
  polities: readonly number[];
}

/** 挑哪条编年史:提到了国家、而且这些国家那一年都还在(找得到都城)的,取最早的(同一年取先写的);一条都不行 = null */
export function pickChronicle<T extends ChronicleRef>(entries: readonly T[], here: (polity: number, year: number) => boolean): T | null {
  let best: T | null = null;
  for (const e of entries) {
    if (!e.polities.length || !e.polities.every((p) => here(p, e.year))) continue;
    if (!best || e.year < best.year) best = e;
  }
  return best;
}

/** 和不装比的五项(都是推到那一年累计的次数),按并列时的先后 */
export const VS_KEYS = ['wars', 'fallen', 'splits', 'dynasties', 'plagues'] as const;
export type VsKey = (typeof VS_KEYS)[number];

/** 清单里写了这些影响口、命令,才比这一项(写了别的,整段历史跟着变的数不算它管的) */
export const VS_TOUCH: Readonly<Record<VsKey, readonly string[]>> = {
  wars: ['war.odds', 'war.power', 'declare', 'treaty'],
  fallen: ['destroy', 'cede'],
  splits: ['split.odds', 'found'],
  dynasties: ['dynasty.odds'],
  plagues: ['plague.odds', 'plague.loss', 'disaster'],
};

export const VS_WORDS: Readonly<Record<VsKey, readonly [string, string]>> = {
  wars: ['仗', '场'],
  fallen: ['灭国', '个'],
  splits: ['分裂', '回'],
  dynasties: ['改朝换代', '回'],
  plagues: ['瘟疫', '回'],
};

/** 相差不到这么多、或者不到这么多次,不写 */
export const VS_MIN_SHARE = 0.1;
export const VS_MIN_DIFF = 3;

export interface VsPick {
  key: VsKey;
  from: number;
  to: number;
}

/**
 * 变得最多的一项:只比清单 touches(影响口 + 命令)碰得到的几项,相差 = |装上 − 不装| ÷ max(不装, 1);
 * 够得上(VS_MIN_SHARE、VS_MIN_DIFF)的里取相差最大的,并列按 VS_KEYS 的先后;一项都够不上 = null
 */
export function pickVs(official: Readonly<Record<VsKey, number>>, plugin: Readonly<Record<VsKey, number>>, touches: readonly string[]): VsPick | null {
  let best: (VsPick & { share: number }) | null = null;
  for (const key of VS_KEYS) {
    if (!VS_TOUCH[key].some((t) => touches.includes(t))) continue;
    const from = official[key];
    const to = plugin[key];
    const share = Math.abs(to - from) / Math.max(from, 1);
    if (share < VS_MIN_SHARE || Math.abs(to - from) < VS_MIN_DIFF) continue;
    if (!best || share > best.share) best = { key, from, to, share };
  }
  return best && { key: best.key, from: best.from, to: best.to };
}

export const yearText = (year: number) => `第 ${Math.floor(year)} 年`;

/** 「和不装比：3000 年里 仗 246 → 173 场」 */
export function vsText(v: VsPick, years: number): string {
  const [word, unit] = VS_WORDS[v.key];
  return `和不装比：${Math.floor(years)} 年里 ${word} ${v.from} → ${v.to} ${unit}`;
}

/** 图例 */
export interface LegendPlan {
  title: string;
  sub: string;
  /** 渐变:颜色和两头的字 */
  ramp?: { colors: readonly string[]; lo: string; hi: string };
  /** 分类:一行一类 */
  rows?: { color: string; label: string }[];
}

/** 分类图例最多列几类(多了列这一片里占地最多的) */
export const LEGEND_ROWS = 8;
const LABEL_MAX = 12;
const UNIT_MAX = 2;

const num = (v: number): string => (Math.abs(v) >= 100 ? Math.round(v) : Number(v.toFixed(2))).toLocaleString('en-US');
const clip = (s: string) => {
  const cs = [...s];
  return cs.length > LABEL_MAX ? `${cs.slice(0, LABEL_MAX - 1).join('')}…` : s;
};

/**
 * 图层的图例:名字、说明(图层给的单位或说明)、渐变两头(数据超出两头的写「以上」「以下」)或分类;
 * 分类多过 LEGEND_ROWS 类时列 shown 里(画出来的那一片的地块)占地最多的几类,说明换成「N 类，这里是占地最多的 8 类」
 */
export function legendOf(look: { title: string; legend?: string }, p: CellPaint, shown: (cell: number) => boolean = () => true): LegendPlan {
  const out: LegendPlan = { title: look.title, sub: look.legend ?? '' };
  if (p.classes) {
    let classes = [...p.classes];
    if (classes.length > LEGEND_ROWS) {
      const by = new Map<number, number>();
      for (let i = 0; i < p.values.length; i++) if (shown(i)) by.set(p.values[i], (by.get(p.values[i]) ?? 0) + 1);
      classes = classes
        .map((c, k) => ({ c, k, n: by.get(c.value) ?? 0 }))
        .sort((a, b) => b.n - a.n || a.k - b.k)
        .slice(0, LEGEND_ROWS)
        .sort((a, b) => a.k - b.k)
        .map((x) => x.c);
      out.sub = `${p.classes.length} 类，这里是占地最多的 ${LEGEND_ROWS} 类`;
    }
    out.rows = classes.map((c) => ({ color: c.color, label: clip(c.label) }));
  } else if (p.ramp) {
    const [lo, hi] = rampRange(p);
    let under = false;
    let over = false;
    for (const v of p.values) {
      if (!Number.isFinite(v)) continue;
      if (v < lo) under = true;
      if (v > hi) over = true;
    }
    // 一两个字的说明是单位(「米」):写在两头的数后面
    const unit = [...out.sub].length <= UNIT_MAX ? out.sub : '';
    if (unit) out.sub = '';
    const tail = (v: number) => `${num(v)}${unit ? ` ${unit}` : ''}`;
    out.ramp = { colors: p.ramp.colors, lo: `${tail(lo)}${under ? ' 以下' : ''}`, hi: `${tail(hi)}${over ? ' 以上' : ''}` };
  }
  return out;
}

/** 推演详情图的字幕:第一行「第 N 年」+ 编年史原样,够得上时第二行和不装比 */
export interface Subtitle {
  year?: string;
  text?: string;
  vs?: string;
}

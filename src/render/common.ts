/** 渲染共用:明暗(山体阴影)、距离变换、颜色工具。 */
import type { Raster } from '../gen/raster';
import { boxBlur } from '../gen/util';
import { noise3 } from '../gen/noise';
import { reprojectImage, type Projector } from './projection';
export { boxBlur };

export type RGB = [number, number, number];

export const hexRGB = (s: string): RGB => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
];

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** 多段色带:stops 为 [值, 颜色] 列表(值递增)。 */
export function ramp(stops: [number, RGB][], v: number): RGB {
  if (v <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [v0, c0] = stops[i - 1];
      const [v1, c1] = stops[i];
      return mix(c0, c1, (v - v0) / (v1 - v0));
    }
  }
  return stops[stops.length - 1][1];
}

// ---------------------------------------------------------------------------
// 东西相连的主图(等距圆柱主图,Raster.wrap):左右两边是同一条 180° 经线。
// 逐像素的邻域操作把列下标取模;矢量(河、界线、路、符号)的 x 展开成连续的,伸出左右边的部分在另一边再画一份。

/** 世界东西相连的周期(世界单位,= 世界宽度) */
export function wrapOf(world: { width: number }): number {
  return world.width;
}

/** 把 x 挪到离 ref 最近的那一份(差整圈 W);W = 0 不动 */
export function nearX(x: number, ref: number, W: number): number {
  return W ? x - W * Math.round((x - ref) / W) : x;
}

/**
 * 横坐标范围 [x0, x1](已展开,单位同 W)的东西在宽 W 的主图上要画在哪几份:平移量 0,
 * 伸出左边的再往右挪一整圈、伸出右边的再往左挪一整圈。W = 0(平面)只有 0。pad = 线宽等余量
 */
export function wrapShifts(x0: number, x1: number, W: number, pad = 0): number[] {
  if (!W) return NO_SHIFT;
  if (x0 - pad >= 0 && x1 + pad <= W) return NO_SHIFT;
  const out = [0];
  if (x0 - pad < 0) out.push(W);
  if (x1 + pad > W) out.push(-W);
  return out;
}
const NO_SHIFT = [0];

/** 第 py 行(共 h 行)像素中心的纬度余弦:这一行一个像素的东西向地面宽度 = 它 × 赤道处的宽度 */
export function rowCos(py: number, h: number): number {
  return Math.sin(((py + 0.5) / h) * Math.PI);
}

/** 栅格第 py 行像素中心的纬度余弦(放大后现算的一块按它在整张图上的位置,见 Raster.win) */
export function rasterRowCos(r: Pick<Raster, 'h' | 'win'>, py: number): number {
  const v = r.win;
  if (!v) return rowCos(py, r.h);
  const y = Math.min(v.H - 0.5, Math.max(0.5, v.y0 + py + 0.5));
  return Math.sin((y / v.H) * Math.PI);
}

/**
 * 东西相连时的值噪声格数:宽 w 像素、每格约 cell 像素 → 取整成整数格,左右两边的格点正好对上。
 * 取样时 x 按 px × n / w 算(见 valueNoiseP)
 */
export function wrapCells(w: number, cell: number): number {
  return Math.max(1, Math.round(w / cell));
}

/** 值噪声,x 方向 period 格一个周期(东西相连的主图上左右无缝);其余同 valueNoise */
export function valueNoiseP(x: number, y: number, s: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  let x0 = xi % period;
  if (x0 < 0) x0 += period;
  const x1 = x0 + 1 === period ? 0 : x0 + 1;
  const a = hash2(x0, yi, s);
  const b = hash2(x1, yi, s);
  const c = hash2(x0, yi + 1, s);
  const d = hash2(x1, yi + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * 东西相连的主图上的平滑噪声(约 −1..1,波长约 cell 像素):把像素列绕成一个圆柱取三维单纯形噪声 ——
 * 左右无缝,也没有值噪声那种方格感(拿来做"过门槛"的抖动时,大片缓变的区域不会露出一格一格)
 */
export function cylinderNoise(seed: number, w: number, cell: number, cols?: ArrayLike<number>): (px: number, py: number) => number {
  const n3 = noise3(seed);
  const R = w / (2 * Math.PI * cell);
  // cols:每一列像素中心在 w 宽的整张图上的 x(放大后现算的一块用;py 也按整张图的行给,可以是小数)
  const n = cols ? cols.length : w;
  const cx = new Float64Array(n);
  const sx = new Float64Array(n);
  for (let px = 0; px < n; px++) {
    const t = ((cols ? cols[px] : px + 0.5) / w) * 2 * Math.PI;
    cx[px] = R * Math.cos(t);
    sx[px] = R * Math.sin(t);
  }
  return (px, py) => n3(cx[px], sx[px], py / cell);
}

/**
 * 盒式模糊(同 boxBlur),东西向列下标取模(东西相连的主图);南北向照旧按最近一行延伸。
 * stretch:每行东西向半径的放大倍数(按地面宽度模糊时给 1 / cos 纬度;极点附近最多整行平均)
 */
export function boxBlurWrap(src: Float32Array, w: number, h: number, radius: number, stretch?: ArrayLike<number>) {
  const tmp = new Float32Array(w * h);
  const maxR = (w - 1) >> 1;
  for (let y = 0; y < h; y++) {
    const r = Math.min(maxR, stretch ? Math.round(radius * stretch[y]) : radius);
    const inv = 1 / (2 * r + 1);
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + (x < 0 ? x + w : x >= w ? x - w : x)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      const add = x + r + 1;
      const sub = x - r;
      acc += src[row + (add >= w ? add - w : add)] - src[row + (sub < 0 ? sub + w : sub)];
    }
  }
  const ry = radius;
  const iy = 1 / (2 * ry + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -ry; y <= ry; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = acc * iy;
      acc += tmp[Math.min(h - 1, y + ry + 1) * w + x] - tmp[Math.max(0, y - ry) * w + x];
    }
  }
}

/**
 * 山体阴影:按西北方向来光算每个像素的明暗,返回相对平地的亮度比(平地 = 1)。
 * exaggeration 越大起伏越明显。水面像素用 floorFactor 压弱。
 * 主图东西相连:左右邻居列下标取模;东西向坡度按纬度修正 —— 高纬度一个像素的地面宽度只有 cos(纬度),
 * 同样的坡在主图上被横向拉宽、像素差变小,除以 cos(纬度) 还原成真实的坡(极点附近封顶)
 */
export function hillshade(r: Raster, exaggeration: number, waterFactor = 0.15): Float32Array {
  const { w, h, elev, water } = r;
  const out = new Float32Array(w * h);
  let lx = -1;
  let ly = -1;
  let lz = 1.3;
  const ll = Math.hypot(lx, ly, lz);
  lx /= ll;
  ly /= ll;
  lz /= ll;
  const z = exaggeration * r.scale;
  for (let py = 0; py < h; py++) {
    const up = py > 0 ? py - 1 : py;
    const dn = py < h - 1 ? py + 1 : py;
    const zx = z / Math.max(rasterRowCos(r, py), 0.01);
    const row = py * w;
    for (let px = 0; px < w; px++) {
      const k = row + px;
      const lf = px > 0 ? k - 1 : k + w - 1;
      const rt = px < w - 1 ? k + 1 : k - w + 1;
      const f = water[k] === 2 ? 0 : water[k] === 1 ? waterFactor : 1;
      const dx = ((elev[rt] - elev[lf]) / 2) * zx * f;
      const dy = ((elev[dn * w + px] - elev[up * w + px]) / 2) * z * f;
      const nl = Math.sqrt(dx * dx + dy * dy + 1);
      const s = (-dx * lx - dy * ly + lz) / nl;
      out[k] = s / lz;
    }
  }
  return out;
}

/**
 * Felzenszwalb 精确欧氏距离变换:返回每个像素到最近 mask=1 像素的距离(像素)。
 * 东西相连(列下标取模):按行那一遍把这一行左右各接上半行(环上任意两点最多隔半圈),结果和"环形"的精确距离一样。
 * wrap = false:左右不相连(主图上切下来的一块,编辑地形后按块重画用)
 */
export function distanceTo(mask: Uint8Array, w: number, h: number, wrap = true): Float32Array {
  const INF = 1e20;
  const d = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = mask[i] ? 0 : INF;
  const n = Math.max(2 * w, h);
  const f = new Float64Array(n);
  const g = new Float64Array(n);
  const v = new Int32Array(n);
  const zz = new Float64Array(n + 1);
  const pass = (len: number) => {
    let k = 0;
    v[0] = 0;
    zz[0] = -INF;
    zz[1] = INF;
    for (let q = 1; q < len; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= zz[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      zz[k] = s;
      zz[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) {
      while (zz[k + 1] < q) k++;
      g[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = d[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) d[y * w + x] = g[y];
  }
  if (!wrap) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) f[x] = d[row + x];
      pass(w);
      for (let x = 0; x < w; x++) d[row + x] = g[x];
    }
    const out = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(d[i]);
    return out;
  }
  // 第 q 个位置 = 第 (q − H) mod w 列;第 x 列的结果在 q = x + H(左右各有半行,环上最远的点也照顾到)
  const H = w >> 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let q = 0; q < 2 * w; q++) {
      const x = q - H;
      f[q] = d[row + (x < 0 ? x + w : x >= w ? x - w : x)];
    }
    pass(2 * w);
    for (let x = 0; x < w; x++) d[row + x] = g[x + H];
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = Math.sqrt(d[i]);
  return out;
}

/** 廉价的确定性哈希噪声 [0,1)(纸张纹理 / 随机抖动)。 */
export function hash2(x: number, y: number, s = 0): number {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 平滑的值噪声(双线性插值哈希),freq = 每像素多少格。 */
export function valueNoise(x: number, y: number, s: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s);
  const b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s);
  const d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

/**
 * 矢量层(河流、手绘符号、图框)画到画布上的坐标变换:画布像素 = 世界坐标 × s + (ox, oy)。
 * k = 地图缩放倍数(1 = 整张图铺满),决定细节层级:全图时符号小而密、细河不画,放大后符号变大、细节变多。
 * 铺进地形图里的那一份是 { s: raster.scale, ox: 0, oy: 0, k: 1 };放大后的细节层(render/detail.ts)按视口给。
 */
export interface VecView {
  s: number;
  ox: number;
  oy: number;
  k: number;
  /**
   * 世界东西相连的周期(世界单位,= 世界宽度,见 wrapOf);不给 / 0 = 不相连(只画一份)。
   * 矢量的 x 展开成连续的,伸出主图左右边的部分在另一边再画一份(平移 ± wrap × s)
   */
  wrap?: number;
  /**
   * 弯边投影(按投影重画,见 render/projection.ts 的 Projector):给了就先把世界坐标投到地图平面,
   * 画布像素 = 地图平面 × s + (ox, oy);线逐点投影、符号在投影后的位置上正立着画,wrap 不再用
   */
  proj?: Projector;
}

/**
 * 放大后的细节层第一次画要用的缓存,拆成一小步一小步在后台分帧算(fantasy.ts 的 fantasyDetailPrep、realistic.ts 的 realisticDetailPrep;
 * 调度见 ui/detailJobs.ts)。一步 = 一个函数,做过的再调直接返回
 */
export type PrepStep = () => void;

/**
 * 分几段做的一步(逐行上色这类一次要算很久的):deadline = 这一段最晚做到什么时候(performance.now());
 * 返回 true = 还没做完,下一段接着做。PrepStep 也是一种 WorkStep(一次做完)
 */
export type WorkStep = (deadline: number) => boolean | void;

/**
 * 分几下画的一层里的一下:依次画在同一张画布上,一下接一下画完和一口气画完逐像素一样
 * (画法状态在哪一下设、哪一下用,都和一口气画时一样)。返回 true = 这一下只画了一部分,再调一次接着画
 */
export type DrawPart = (ctx: CanvasRenderingContext2D) => boolean | void;

/** 一串 DrawPart 当下依次画完 */
export function drawParts(ctx: CanvasRenderingContext2D, parts: readonly DrawPart[]): void {
  for (const part of parts) while (part(ctx) === true);
}

/**
 * 画布上记着还没真正画出来的笔画(浏览器攒着,第一次拿它当图贴的时候才一口气画):现在就让它画出来
 * (贴到一个 1×1 的画布上;内容不变)。后台分步备料时用,免得攒到换上那一下才画
 */
export function flushCanvas(c: OffscreenCanvas | HTMLCanvasElement | null): void {
  if (!c) return;
  const t = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: 1, height: 1 }) : null;
  (t?.getContext('2d') as CanvasRenderingContext2D | null | undefined)?.drawImage(c, 0, 0, 1, 1);
}

/** 铺进地形图(整张图、缩放 1 倍)的矢量层变换 */
export const bakedView = (scale: number): VecView => ({ s: scale, ox: 0, oy: 0, k: 1 });

export interface RiverStyle {
  color: string;
  /** 最细的河宽(世界单位) */
  minW: number;
  /** 最粗的河宽(世界单位) */
  maxW: number;
  fluxRef: number;
  /** 细节层级:只画流量 ≥ 这个值的河段(全图时小溪不画,放大才出现);不给 = 全画 */
  minFlux?: number;
  /** 细水那一份宽度(minW)再乘这个数:放大时小溪不跟着变粗,大河的宽度照样按世界单位放大 → 主干显得粗 */
  thin?: number;
}

/**
 * 作者画的河(改地形的 `river`)在地图上按多大的流量画:至少是全图细节层级门槛的好几倍(全图、各种画法都画得出来),
 * 画笔越粗画得越粗(半宽 4 最细,20 往上一样粗)。只改显示,推演用的流量不变
 */
export function drawnFlux(r: number, threshold: number): number {
  const w = Math.min(1, Math.max(0.25, 0.25 + (0.75 * (r - 4)) / 16));
  return Math.max(12 * threshold, threshold + 1200 * w * w);
}

const shownCache = new WeakMap<readonly { pts: Float32Array }[], { pts: Float32Array }[]>();
/**
 * 画在地图上的河:作者画的那几段(River.drawn)流量抬到 drawnFlux,其余原样。没有画的河 = 原数组;
 * 同一份河记住结果(河网几何按数组缓存,换了数组要重算)
 */
export function shownRivers<T extends { pts: Float32Array; drawn?: Uint8Array }>(rivers: readonly T[], threshold: number): T[] {
  if (!rivers.some((r) => r.drawn)) return rivers as T[];
  let out = shownCache.get(rivers) as T[] | undefined;
  if (!out) {
    out = rivers.map((r) => {
      const d = r.drawn;
      if (!d) return r;
      const pts = r.pts.slice();
      for (let i = 0; i < d.length; i++) if (d[i]) pts[i * 3 + 2] = Math.max(pts[i * 3 + 2], drawnFlux(d[i], threshold));
      return { ...r, pts };
    });
    shownCache.set(rivers, out);
  }
  return out;
}

/** 河流的细节层级(两种画风共用):缩放 k 倍时只画流量 ≥ 门槛 × 这个数的河段 —— 全图时小溪不画,放大到 3 倍左右全画 */
export function riverLod(k: number): number {
  return Math.max(1, 4.5 * Math.pow(Math.max(1, k), -1.3));
}

/** 河宽(世界单位):细水的底宽 + 随流量增长的部分(增长指数 power) */
function riverWidth(style: RiverStyle, threshold: number, power: number) {
  const base = style.minW * (style.thin ?? 1);
  const span = style.maxW - style.minW;
  return (f: number) => base + span * Math.min(1, Math.pow(Math.max(0, f - threshold) / style.fluxRef, power));
}

/** 细节层级:刚够门槛的河段从细线长出来(不突然冒出一截粗河) */
function lodTaper(style: RiverStyle, f: number): number {
  const m = style.minFlux;
  if (!m) return 1;
  const t = Math.min(1, Math.max(0, (f - m) / (0.8 * m)));
  return 0.35 + 0.65 * t * t * (3 - 2 * t);
}

/**
 * 河网画法的可选增强(不传则保持原来的逐段画法):
 * - 顶点按"河网"统一平滑,支流终点正好落在干流曲线上,汇合处不断开
 * - 先在离屏画布上用不透明色画,再整体半透明叠上来,重叠处不会出现深色小疙瘩
 * - 入海 / 入湖的一端延伸进水里,再按像素水陆图裁掉,保证河口正好接上岸线
 */
export interface RiverOptions {
  /** 像素水陆图(0 = 陆地),河道只保留在陆地上 */
  water: Uint8Array;
  w: number;
  h: number;
  /** 水陆图每世界单位几个像素(raster.scale;默认 1) */
  scale?: number;
  /** 水陆图左上角在哪(世界单位;放大后现算的一块用,默认整张图的左上角) */
  origin?: [number, number];
  /** 河岸暗边:颜色 + 每侧加宽(像素,按 scale=1 计) */
  bank?: { color: string; width: number };
  /** 河口喇叭口:末端放大到几倍 */
  mouthFlare?: number;
  /** 线宽随流量增长的指数(默认 0.5);越大,小溪越细、大河越突出 */
  widthPower?: number;
}

/**
 * 河流画成平滑曲线,线宽随流量变化(分段绘制)。传 opts 则走河网画法(见 RiverOptions)。
 * at:整张图的像素倍数(铺进地形图),或细节层的视口变换(VecView;只画画布里的河段)。
 */
export function drawRivers(
  ctx: CanvasRenderingContext2D,
  rivers: { pts: Float32Array }[],
  at: number | VecView,
  threshold: number,
  style: RiverStyle,
  opts?: RiverOptions,
) {
  const v = typeof at === 'number' ? bakedView(at) : at;
  rivers = shownRivers(rivers, threshold);
  if (opts) {
    drawRiverNetwork(ctx, rivers, v, threshold, style, opts);
    return;
  }
  if (v.proj) {
    drawRiversProjected(ctx, rivers, v, v.proj, threshold, style);
    return;
  }
  const { s, ox, oy } = v;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const widthOf = riverWidth(style, threshold, 0.5);
  const minFlux = style.minFlux ?? -Infinity;
  const wrap = v.wrap ?? 0;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style.color;
  for (const r of rivers) {
    // 东西相连:x 展开成连续的(相邻两点不跨半张图),跨 180° 经线的河段两边各画一份
    const p = wrap ? unwrapRiver(r.pts, wrap) : r.pts;
    const m = p.length / 3;
    // 相邻顶点中点作为曲线端点,顶点作为控制点 → 平滑
    for (let i = 0; i < m - 1; i++) {
      const f = p[i * 3 + 2];
      if (f < minFlux) continue;
      for (const sh of wrap ? wrapShifts(Math.min(p[i * 3], p[i * 3 + 3]), Math.max(p[i * 3], p[i * 3 + 3]), wrap, 4) : NO_SHIFT) {
        const dx = sh * s;
        const x0 = p[i * 3] * s + ox + dx;
        const y0 = p[i * 3 + 1] * s + oy;
        const x1 = p[(i + 1) * 3] * s + ox + dx;
        const y1 = p[(i + 1) * 3 + 1] * s + oy;
        const lw = widthOf(f) * lodTaper(style, f) * s;
        // 画布外的河段不画(细节层只画视口附近)
        const pad = lw + Math.abs(x1 - x0) + Math.abs(y1 - y0);
        if (x0 < -pad || y0 < -pad || x0 > W + pad || y0 > H + pad) continue;
        ctx.lineWidth = lw;
        ctx.beginPath();
        if (i === 0 || p[(i - 1) * 3 + 2] < minFlux) ctx.moveTo(x0, y0);
        else ctx.moveTo((p[(i - 1) * 3] * s + ox + dx + x0) / 2, (p[(i - 1) * 3 + 1] * s + oy + y0) / 2);
        if (i === m - 2) ctx.quadraticCurveTo(x0, y0, x1, y1);
        else ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        ctx.stroke();
      }
    }
  }
}

// ---- 弯边投影:河逐点投影(按投影重画) ----

/**
 * 折线(每点 stride 个数,前两个是世界 x, y)的经度差(弧度)沿线连续展开:第一点按中央经线挪到 ±π 以内,
 * 之后每点接着上一点(相邻两点按东西相连取近的那边)。返回经度差和最小、最大值
 */
export function relAlong(p: ArrayLike<number>, stride: number, pj: Projector): { rel: Float64Array; lo: number; hi: number } {
  const m = Math.floor(p.length / stride);
  const rel = new Float64Array(m);
  if (!m) return { rel, lo: 0, hi: 0 };
  const W = pj.W;
  const k2 = (2 * Math.PI) / W;
  rel[0] = pj.rel(p[0]);
  let lo = rel[0];
  let hi = rel[0];
  for (let i = 1; i < m; i++) {
    const x0 = p[(i - 1) * stride];
    rel[i] = rel[i - 1] + (nearX(p[i * stride], x0, W) - x0) * k2;
    if (rel[i] < lo) lo = rel[i];
    if (rel[i] > hi) hi = rel[i];
  }
  return { rel, lo, hi };
}

/** 一条线的经度差范围 [lo, hi] 伸出 ±π 时要在另一边再画的平移量(弧度) */
export function lineShifts(lo: number, hi: number): number[] {
  if (lo >= -Math.PI && hi <= Math.PI) return NO_SHIFT;
  const out = [0];
  if (lo < -Math.PI) out.push(2 * Math.PI);
  if (hi > Math.PI) out.push(-2 * Math.PI);
  return out;
}

/** 手绘风的河(逐段画法)在弯边投影下:顶点逐个投影(相邻两点不到 1°,不用再加密),线宽和等距圆柱同缩放时一样 */
function drawRiversProjected(ctx: CanvasRenderingContext2D, rivers: { pts: Float32Array }[], v: VecView, pj: Projector, threshold: number, style: RiverStyle) {
  const { s, ox, oy } = v;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const widthOf = riverWidth(style, threshold, 0.5);
  const minFlux = style.minFlux ?? -Infinity;
  const half = pj.W / 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = style.color;
  for (const r of rivers) {
    const p = r.pts;
    const m = p.length / 3;
    if (m < 2) continue;
    const { rel, lo, hi } = relAlong(p, 3, pj);
    const X = new Float64Array(m);
    const Y = new Float64Array(m);
    for (const sh of lineShifts(lo, hi)) {
      for (let i = 0; i < m; i++) {
        const wy = p[i * 3 + 1];
        X[i] = (half + pj.K(wy) * (rel[i] + sh)) * s + ox;
        Y[i] = pj.Y(wy) * s + oy;
      }
      for (let i = 0; i < m - 1; i++) {
        const f = p[i * 3 + 2];
        if (f < minFlux) continue;
        const x0 = X[i];
        const y0 = Y[i];
        const x1 = X[i + 1];
        const y1 = Y[i + 1];
        const lw = widthOf(f) * lodTaper(style, f) * s;
        const pad = lw + Math.abs(x1 - x0) + Math.abs(y1 - y0);
        if (x0 < -pad || y0 < -pad || x0 > W + pad || y0 > H + pad) continue;
        ctx.lineWidth = lw;
        ctx.beginPath();
        if (i === 0 || p[(i - 1) * 3 + 2] < minFlux) ctx.moveTo(x0, y0);
        else ctx.moveTo((X[i - 1] + x0) / 2, (Y[i - 1] + y0) / 2);
        if (i === m - 2) ctx.quadraticCurveTo(x0, y0, x1, y1);
        else ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        ctx.stroke();
      }
    }
  }
}

/** 河道折线(x, y, 流量交错)的 x 展开成连续的(东西相连,见 nearX) */
function unwrapRiver(pts: Float32Array, W: number): Float64Array {
  const out = Float64Array.from(pts);
  for (let i = 3; i < out.length; i += 3) out[i] = nearX(out[i], out[i - 3], W);
  return out;
}

/** 'rgba(r,g,b,a)' / 'rgb(r,g,b)' → 不透明色 + 透明度 */
function splitAlpha(css: string): [string, number] {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return [css, 1];
  const v = m[1].split(',').map((t) => Number(t.trim()));
  return [`rgb(${v[0]},${v[1]},${v[2]})`, v.length > 3 ? v[3] : 1];
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function makeLayer(w: number, h: number): { canvas: OffscreenCanvas | HTMLCanvasElement; g: Ctx2D } {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(w, h)
      : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return { canvas, g: canvas.getContext('2d') as Ctx2D };
}

/** 一条河加密后的折线:坐标和线宽都是世界单位(画的时候再乘 scale) */
interface DenseRiver {
  x: number[];
  y: number[];
  w: number[];
  /** 每点的流量、形状系数(源头收细、河口张开):细节层按缩放倍数重新算河宽用(宽 = 河宽(流量) × 形状系数) */
  f: number[];
  m: number[];
  /** 入海 / 入湖的河:岸上那一点(原来最后一个顶点)在加密后的第几个点(之后是伸进水里的一段) */
  mouth?: number;
}

/**
 * 河网几何:按干流重新串线 → 统一平滑 → Catmull-Rom 加密 → 每点线宽。
 *
 * 原始河道按"源头流量"排序追踪,汇合点下游有时归给了一条小支流、大河反倒成了"支流",
 * 平滑时下游会被小支流的方向带歪(汇合处出现 V 形折角)。这里先把折线拆成河网,
 * 在每个汇合点让流量最大的上游继续往下走,干流就是一条连续的线。
 *
 * wrap > 0(= 世界宽度):主图东西相连,每条链的 x 展开成连续的(相邻两点不跨半张图),
 * 跨 180° 经线的河在主图上可能伸出左右边,画的时候在另一边再画一份(见 wrapShifts)。
 * 链上的点就是 River.cells 地块链的位置,相邻地块在球面上挨着,所以"不跨半张图"就是正确的展开。
 */
export function riverGeometry(
  rivers: { pts: Float32Array }[],
  threshold: number,
  style: RiverStyle,
  flare: number,
  power: number,
  wrap = 0,
): DenseRiver[] {
  const widthOf = (f: number) =>
    style.minW + (style.maxW - style.minW) * Math.min(1, Math.pow(Math.max(0, f - threshold) / style.fluxRef, power));
  const key = (x: number, y: number) => `${x},${y}`;

  // ---- 1. 折线 → 河网:节点 = 顶点,next = 下游节点 ----
  const id = new Map<string, number>();
  const vx: number[] = [];
  const vy: number[] = [];
  const vf: number[] = [];
  const next: number[] = [];
  for (const r of rivers) {
    const p = r.pts;
    const m = p.length / 3;
    let prev = -1;
    for (let i = 0; i < m; i++) {
      const k = key(p[i * 3], p[i * 3 + 1]);
      let v = id.get(k);
      if (v === undefined) {
        v = vx.length;
        id.set(k, v);
        vx.push(p[i * 3]);
        vy.push(p[i * 3 + 1]);
        vf.push(p[i * 3 + 2]);
        next.push(-1);
      }
      if (prev >= 0) next[prev] = v;
      prev = v;
    }
  }
  const N = vx.length;
  // 每个节点流量最大的上游 = 干流来的方向
  const main = new Int32Array(N).fill(-1);
  for (let u = 0; u < N; u++) {
    const v = next[u];
    if (v >= 0 && (main[v] < 0 || vf[u] > vf[main[v]])) main[v] = u;
  }
  // ---- 2. 从每个源头往下走,只要自己是下游节点的干流就继续,否则在汇合点停下(成为支流) ----
  const chains: number[][] = [];
  for (let h = 0; h < N; h++) {
    if (main[h] >= 0) continue;
    const c = [h];
    let cur = h;
    while (next[cur] >= 0) {
      const v = next[cur];
      c.push(v);
      if (main[v] !== cur) break;
      cur = v;
    }
    if (c.length >= 2) chains.push(c);
  }
  // 大河先处理:支流的终点是干流上的中间点,要先知道干流平滑后的位置。
  // 支流按自己的流量排(不算汇合点),一定排在它汇入的那条链后面
  const peak = (c: number[]) => vf[next[c[c.length - 1]] >= 0 ? c[c.length - 2] : c[c.length - 1]];
  chains.sort((a, b) => peak(b) - peak(a));

  // 节点 → 平滑后的位置、弯过之后挪了多少。每个节点只在一条链里是"中间点",支流终点来这里查
  const smoothed = new Map<number, [number, number]>();
  const moved = new Map<number, [number, number]>();
  const out: DenseRiver[] = [];

  for (const c of chains) {
    const m = c.length;
    const ox = c.map((v) => vx[v]);
    const oy = c.map((v) => vy[v]);
    const f = c.map((v) => vf[v]);
    if (wrap) for (let i = 1; i < m; i++) ox[i] = nearX(ox[i], ox[i - 1], wrap);
    // 终点:汇入别的河(用干流平滑后的位置),否则是入海 / 入湖(停在两地块之间的岸线上)
    const last = c[m - 1];
    const joins = next[last] >= 0;
    let joinPos = joins ? smoothed.get(last) ?? [ox[m - 1], oy[m - 1]] : undefined;
    // 干流那一条可能展开到了另一份(差整圈):挪到这条链旁边
    if (wrap && joinPos) joinPos = [nearX(joinPos[0], ox[m - 1], wrap), joinPos[1]];
    // 起点:从湖里流出时,第一个点是湖岸中点,流量和第二个点相同(正常源头下游流量一定更大)
    const fromLake = m > 2 && f[0] === f[1];

    let xs = ox.slice();
    let ys = oy.slice();
    if (joinPos) {
      xs[m - 1] = joinPos[0];
      ys[m - 1] = joinPos[1];
    }
    // 两遍拉普拉斯平滑,首尾不动:去掉地块中心连线的折角
    for (let pass = 0; pass < 2; pass++) {
      const sx = xs.slice();
      const sy = ys.slice();
      for (let i = 1; i < m - 1; i++) {
        sx[i] = 0.25 * xs[i - 1] + 0.5 * xs[i] + 0.25 * xs[i + 1];
        sy[i] = 0.25 * ys[i - 1] + 0.5 * ys[i] + 0.25 * ys[i + 1];
      }
      xs = sx;
      ys = sy;
    }
    for (let i = 1; i < m - 1; i++) smoothed.set(c[i], [xs[i], ys[i]]);

    // 每个顶点的"流量":汇入别的河时最后一段保持自己的流量,不被干流撑宽
    const fv = f.slice();
    if (joinPos) fv[m - 1] = fv[m - 2];
    // 伸进水里:河口延伸到海 / 湖地块中心,从湖里流出的一端延伸到湖地块中心
    let first = 0;
    if (fromLake) {
      xs.unshift(2 * ox[0] - ox[1]);
      ys.unshift(2 * oy[0] - oy[1]);
      fv.unshift(fv[0]);
      first = 1;
    }
    const mouth = !joins;
    if (mouth) {
      xs.push(2 * ox[m - 1] - ox[m - 2]);
      ys.push(2 * oy[m - 1] - oy[m - 2]);
      fv.push(fv[fv.length - 1]);
    }
    const M = xs.length;

    const d: DenseRiver = { x: [], y: [], w: [], f: [], m: [] };
    // 每个顶点在加密后的第几个点(弯过之后支流来查汇合点挪到了哪)
    const at = new Int32Array(M);
    for (let i = 0; i < M - 1; i++) {
      const i0 = Math.max(0, i - 1);
      const i3 = Math.min(M - 1, i + 2);
      const p0x = i0 === i ? 2 * xs[i] - xs[i + 1] : xs[i0];
      const p0y = i0 === i ? 2 * ys[i] - ys[i + 1] : ys[i0];
      const p3x = i3 === i + 1 ? 2 * xs[i + 1] - xs[i] : xs[i3];
      const p3y = i3 === i + 1 ? 2 * ys[i + 1] - ys[i] : ys[i3];
      const p1x = xs[i];
      const p1y = ys[i];
      const p2x = xs[i + 1];
      const p2y = ys[i + 1];
      // 每段按长度加密(约 MEANDER_STEP 一个点):最细一层的弯要画得出来
      const sub = Math.max(2, Math.ceil(Math.sqrt((p2x - p1x) ** 2 + (p2y - p1y) ** 2) / MEANDER_STEP));
      for (let s = i === 0 ? 0 : 1; s <= sub; s++) {
        const t = s / sub;
        const t2 = t * t;
        const t3 = t2 * t;
        d.x.push(
          0.5 * (2 * p1x + (-p0x + p2x) * t + (2 * p0x - 5 * p1x + 4 * p2x - p3x) * t2 + (-p0x + 3 * p1x - 3 * p2x + p3x) * t3),
        );
        d.y.push(
          0.5 * (2 * p1y + (-p0y + p2y) * t + (2 * p0y - 5 * p1y + 4 * p2y - p3y) * t2 + (-p0y + 3 * p1y - 3 * p2y + p3y) * t3),
        );
        // 流量在一段的后半程才涨上去:汇合点下游立刻变宽,上游不提前"鼓包"
        const u = t < 0.5 ? 0 : (t - 0.5) * 2;
        const fl = fv[i] + (fv[i + 1] - fv[i]) * u * u * (3 - 2 * u);
        let mul = 1;
        // 源头:从细线慢慢长出来
        const pos = i - first + t;
        if (!fromLake && pos < 1.5) mul *= 0.45 + 0.55 * (pos / 1.5);
        // 河口:最后两段逐渐张开成喇叭口
        if (mouth && flare > 1) {
          const back = M - 1 - (i + t);
          if (back < 2) mul *= 1 + (flare - 1) * (1 - back / 2) ** 2;
        }
        d.w.push(widthOf(fl) * mul);
        d.f.push(fl);
        d.m.push(mul);
      }
      at[i + 1] = d.x.length - 1;
    }
    // 弯一弯:平滑的样条只有地块那么大的弯,真实的河各种尺度都有弯。
    // 汇入别的河的一段最后贴到干流弯过之后的位置;入海、出湖的一头不弯(河口、湖口不挪)
    const off = joinPos ? moved.get(last) : undefined;
    if (mouth) d.mouth = at[M - 2];
    meander(d.x, d.y, hashXY(vx[last], vy[last], vx[c[m - 2]], vy[c[m - 2]]), fromLake, off);
    for (let i = 1; i < m - 1; i++) {
      const j = at[i + first];
      moved.set(c[i], [d.x[j] - xs[i + first], d.y[j] - ys[i + first]]);
    }
    out.push(d);
  }
  return out;
}

/** 加密后相邻两点大约隔多远(世界单位;一个默认精细度的地块约 7.6) */
const MEANDER_STEP = 0.25;
/** 河道的弯:每层 [起伏的间隔(世界单位), 弯出去多远(× 间隔)],从粗到细(间隔不取整倍数,弯得不规则) */
const MEANDER_OCT: readonly [number, number][] = [
  [8, 0.2],
  [3.7, 0.17],
  [1.75, 0.13],
  [0.85, 0.09],
];
/** 河口、汇合点、湖口往回这么长(世界单位)之内弯得越来越少,到端点不弯 */
const MEANDER_END = 2.5;
/** 汇入别的河的一段:最后这么长之内渐渐挪到干流弯过之后的汇合点 */
const MEANDER_JOIN = 4;
/** 弯出去最多是这里拐弯半径的几成(急弯里侧不打结) */
const MEANDER_BEND = 0.5;

/**
 * 加密后的河道(x, y 原地改)沿法向弯一弯:几层一维噪声按"离下游端多远"取值(同一条河不管带不带小溪、
 * 在哪一级放大都弯得一样),下游端(河口 / 汇合点)和出湖的一端收到不弯;off = 汇合点在干流上挪了多少
 * (最后 MEANDER_JOIN 之内渐渐挪过去)。纯计算,同一条河同一个结果
 */
function meander(x: number[], y: number[], seed: number, fromLake: boolean, off?: [number, number]) {
  const n = x.length;
  if (n < 3) return;
  // 离下游端多远
  const S = new Float64Array(n);
  for (let i = n - 2; i >= 0; i--) {
    const ex = x[i + 1] - x[i];
    const ey = y[i + 1] - y[i];
    S[i] = S[i + 1] + Math.sqrt(ex * ex + ey * ey);
  }
  const total = S[0];
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? i - 1 : 0;
    const b = i < n - 1 ? i + 1 : n - 1;
    let tx = x[b] - x[a];
    let ty = y[b] - y[a];
    const tl = Math.sqrt(tx * tx + ty * ty);
    if (tl === 0) continue;
    tx /= tl;
    ty /= tl;
    let v = 0;
    for (let o = 0; o < MEANDER_OCT.length; o++) {
      const [L, A] = MEANDER_OCT[o];
      v += A * L * noise1(seed + o * 0x632be5ab, S[i] / L);
    }
    // 端点附近收住
    v *= smooth01(S[i] / MEANDER_END);
    if (fromLake) v *= smooth01((total - S[i]) / MEANDER_END);
    // 急弯:不超过拐弯半径的几成(拐角 = 前后两段方向差)
    if (i > 0 && i < n - 1) {
      const ux = x[i] - x[i - 1];
      const uy = y[i] - y[i - 1];
      const wx = x[i + 1] - x[i];
      const wy = y[i + 1] - y[i];
      const lu = Math.sqrt(ux * ux + uy * uy);
      const lw = Math.sqrt(wx * wx + wy * wy);
      const cross = Math.abs(ux * wy - uy * wx);
      if (lu > 0 && lw > 0 && cross > 0) {
        const R = (0.5 * (lu + lw) * lu * lw) / cross;
        const lim = MEANDER_BEND * R;
        if (v > lim) v = lim;
        else if (v < -lim) v = -lim;
      }
    }
    dx[i] = -ty * v;
    dy[i] = tx * v;
  }
  for (let i = 0; i < n; i++) {
    let ox = dx[i];
    let oy = dy[i];
    if (off) {
      const b = 1 - smooth01(S[i] / MEANDER_JOIN);
      ox += b * off[0];
      oy += b * off[1];
    }
    x[i] += ox;
    y[i] += oy;
  }
}

/** 0..1 之间平滑过渡(x ≤ 0 → 0,x ≥ 1 → 1) */
function smooth01(x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

/** 一维梯度噪声,约 −1..1(整数格上为 0,格点的斜率按 seed 和格号定) */
function noise1(seed: number, t: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const a = grad1(seed, i) * f;
  const b = grad1(seed, i + 1) * (f - 1);
  const u = f * f * f * (f * (f * 6 - 15) + 10);
  return 2 * (a + (b - a) * u);
}

function grad1(seed: number, i: number): number {
  let h = Math.imul(seed ^ Math.imul(i | 0, 0x9e3779b1), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 2147483648 - 1;
}

/** 两个点(河的下游两个顶点)→ 一个整数种子:同一条河每次一样 */
function hashXY(ax: number, ay: number, bx: number, by: number): number {
  let h = 0x811c9dc5;
  for (const v of [ax, ay, bx, by]) {
    h = Math.imul(h ^ Math.round(v * 64), 0x01000193);
    h ^= h >>> 15;
  }
  return h | 0;
}

/**
 * 按线宽分桶,每桶一个 Path2D 一次描完(几万小段只要几十次 stroke)。
 * 河宽按 widthOf(流量) × 形状系数现算(细节层级:放大后细水不跟着变粗);流量不够 style.minFlux 的河段不画,画布外的不画。
 */
function strokeRivers(g: Ctx2D, lines: DenseRiver[], v: VecView, style: RiverStyle, widthOf: (f: number) => number, extra: number) {
  const STEP = 0.25;
  const { s, ox, oy } = v;
  const W = g.canvas.width;
  const H = g.canvas.height;
  const minFlux = style.minFlux ?? -Infinity;
  const wrap = v.wrap ?? 0;
  const buckets = new Map<number, Path2D>();
  const pj = v.proj;
  if (pj) {
    // 弯边投影:加密后的点逐个投影(已经很密,不用再加密);线宽按画布像素(和等距圆柱同缩放时一样)
    const half = pj.W / 2;
    for (const d of lines) {
      const n = d.x.length;
      if (n < 2) continue;
      const xy = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        xy[i * 2] = d.x[i];
        xy[i * 2 + 1] = d.y[i];
      }
      const { rel, lo, hi } = relAlong(xy, 2, pj);
      const X = new Float64Array(n);
      const Y = new Float64Array(n);
      for (const sh of lineShifts(lo, hi)) {
        for (let i = 0; i < n; i++) {
          X[i] = (half + pj.K(d.y[i]) * (rel[i] + sh)) * s + ox;
          Y[i] = pj.Y(d.y[i]) * s + oy;
        }
        for (let i = 0, j = 1; i < n - 1; i = j, j = i + 1) {
          while (j < n - 1 && (X[j] - X[i]) ** 2 + (Y[j] - Y[i]) ** 2 < SEG_PX * SEG_PX) j++;
          const f = 0.5 * (d.f[i] + d.f[j]);
          if (f < minFlux) continue;
          const x0 = X[i];
          const y0 = Y[i];
          const x1 = X[j];
          const y1 = Y[j];
          const wv = (widthOf(f) * 0.5 * (d.m[i] + d.m[j]) * lodTaper(style, f) + extra) * s;
          if (Math.max(x0, x1) < -wv || Math.max(y0, y1) < -wv || Math.min(x0, x1) > W + wv || Math.min(y0, y1) > H + wv) continue;
          const b = Math.max(1, Math.round(wv / STEP));
          let path = buckets.get(b);
          if (!path) buckets.set(b, (path = new Path2D()));
          path.moveTo(x0, y0);
          path.lineTo(x1, y1);
        }
      }
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const [b, path] of buckets) {
      g.lineWidth = b * STEP;
      g.stroke(path);
    }
    return;
  }
  // 河道加密得很细(放大后弯要画得出来):画布上不到 SEG_PX 的几小段并成一段
  const min2 = (SEG_PX / s) ** 2;
  for (const d of lines) {
    const n = d.x.length;
    for (let i = 0, j = 1; i < n - 1; i = j, j = i + 1) {
      while (j < n - 1 && (d.x[j] - d.x[i]) ** 2 + (d.y[j] - d.y[i]) ** 2 < min2) j++;
      const f = 0.5 * (d.f[i] + d.f[j]);
      if (f < minFlux) continue;
      // 东西相连:伸出主图左右边的河段在另一边再画一份(平面只有平移 0)
      for (const sh of wrap ? wrapShifts(Math.min(d.x[i], d.x[j]), Math.max(d.x[i], d.x[j]), wrap, 4) : NO_SHIFT) {
        const x0 = (d.x[i] + sh) * s + ox;
        const y0 = d.y[i] * s + oy;
        const x1 = (d.x[j] + sh) * s + ox;
        const y1 = d.y[j] * s + oy;
        const wv = (widthOf(f) * 0.5 * (d.m[i] + d.m[j]) * lodTaper(style, f) + extra) * s;
        if (Math.max(x0, x1) < -wv || Math.max(y0, y1) < -wv || Math.min(x0, x1) > W + wv || Math.min(y0, y1) > H + wv) continue;
        const b = Math.max(1, Math.round(wv / STEP));
        let path = buckets.get(b);
        if (!path) buckets.set(b, (path = new Path2D()));
        path.moveTo(x0, y0);
        path.lineTo(x1, y1);
      }
    }
  }
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (const [b, path] of buckets) {
    g.lineWidth = b * STEP;
    g.stroke(path);
  }
}

/** 画河时一段至少多长(画布像素):更短的几段并成一段 */
const SEG_PX = 1.5;

/** 河网几何按"这组河 + 画法参数"缓存:细节层每次重画不用重新平滑、加密 */
const geomCache = new WeakMap<object, { key: string; lines: DenseRiver[] }>();
/** 陆地蒙版(每张水陆图一份) */
const maskCache = new WeakMap<Uint8Array, { canvas: OffscreenCanvas | HTMLCanvasElement }>();

/** 河网几何(按这组河 + 画法参数缓存) */
function netGeometry(rivers: { pts: Float32Array }[], v: VecView, threshold: number, style: RiverStyle, opts: RiverOptions): DenseRiver[] {
  const flare = opts.mouthFlare ?? 1;
  const power = opts.widthPower ?? 0.5;
  // 画的时候按流量现算河宽(d.f、d.m),几何本身只和门槛、河口、指数有关:换缩放倍数(河宽参数变了)也不用重算
  const wrap = v.wrap ?? 0;
  const key = `${threshold}|${flare}|${power}|${wrap}`;
  let geom = geomCache.get(rivers);
  if (!geom || geom.key !== key) geomCache.set(rivers, (geom = { key, lines: riverGeometry(rivers, threshold, style, flare, power, wrap) }));
  return geom.lines;
}

/** 陆地蒙版:河道只留在陆地像素上(细节层按视口变换把它放大贴上,边缘是平滑插值的,和放大后的地形图海岸一致) */
function landMask(opts: RiverOptions): { canvas: OffscreenCanvas | HTMLCanvasElement } {
  const { w, h, water } = opts;
  let mask = maskCache.get(water);
  if (!mask) {
    const m = makeLayer(w, h);
    const img = m.g.createImageData(w, h);
    const md = img.data;
    for (let k = 0; k < w * h; k++) if (water[k] === 0) md[k * 4 + 3] = 255;
    m.g.putImageData(img, 0, 0);
    maskCache.set(water, (mask = { canvas: m.canvas }));
  }
  return mask;
}

/**
 * 河网的一层(河岸或河道)描在 l 上,再按陆地裁掉(pm = 弯边投影铺好的陆地蒙版;不是弯边投影 = null)。
 * l 是同一张画布时接着上一层用(画法状态每层都重新设)
 */
function netLayer(
  l: ReturnType<typeof makeLayer>,
  lines: DenseRiver[],
  v: VecView,
  style: RiverStyle,
  widthOf: (f: number) => number,
  opts: RiverOptions,
  mask: { canvas: OffscreenCanvas | HTMLCanvasElement },
  pm: ReturnType<typeof makeLayer> | null,
  rgb: string,
  extra: number,
): void {
  const W = l.canvas.width;
  const H = l.canvas.height;
  // 水陆图的像素 → 画布像素(水陆图和世界坐标差一个 raster.scale 倍)
  const ms = v.s / (opts.scale ?? 1);
  l.g.globalCompositeOperation = 'source-over';
  l.g.clearRect(0, 0, W, H);
  l.g.strokeStyle = rgb;
  strokeRivers(l.g, lines, v, style, widthOf, extra);
  l.g.globalCompositeOperation = 'destination-in';
  // 放大时双线性插值就够(和地形图被放大时的海岸一样软)
  l.g.imageSmoothingEnabled = true;
  l.g.imageSmoothingQuality = 'low';
  if (pm) l.g.drawImage(pm.canvas, 0, 0);
  else l.g.drawImage(mask.canvas, v.ox + (opts.origin?.[0] ?? 0) * v.s, v.oy + (opts.origin?.[1] ?? 0) * v.s, opts.w * ms, opts.h * ms);
}

/** 河网的各层(河岸、河道):颜色(不带透明度)、透明度、描宽了多少 */
function netLayers(style: RiverStyle, opts: RiverOptions): { rgb: string; alpha: number; extra: number }[] {
  const out: { rgb: string; alpha: number; extra: number }[] = [];
  const add = (color: string, extra: number) => {
    const [rgb, alpha] = splitAlpha(color);
    out.push({ rgb, alpha, extra });
  };
  if (opts.bank) add(opts.bank.color, opts.bank.width * 2);
  add(style.color, 0);
  return out;
}

/**
 * 后台先描好的一份河网(见 riverNetworkSteps):各层已描好、按陆地裁好,还没叠上去。下一次 drawRiverNetwork 画同一份
 * (同一组河、同一张水陆图、同样的画法和画布大小、不是弯边投影)时直接按原来的透明度叠上,用过就放掉
 */
let preparedNet: { rivers: object; water: Uint8Array; key: string; layers: { canvas: OffscreenCanvas | HTMLCanvasElement; alpha: number }[] } | null = null;

/**
 * 后台描好、还没用上的那份河网放掉(各层是整张图大小的画布):water = 只放掉给这张水陆图备的(它已经画过、没用上 —— 比如换上前换了画风);
 * 不给 = 不管给谁备的都放掉(要换世界了)
 */
export function dropPreparedRivers(water?: Uint8Array): void {
  const pre = preparedNet;
  if (!pre || (water && pre.water !== water)) return;
  preparedNet = null;
  for (const x of pre.layers) x.canvas.width = x.canvas.height = 0;
}

/** 认"同一份河网"的键(画布大小、视口、画法、水陆图的大小和位置) */
function netKey(W: number, H: number, v: VecView, threshold: number, style: RiverStyle, opts: RiverOptions): string {
  return JSON.stringify([W, H, v.s, v.ox, v.oy, v.k ?? null, v.wrap ?? 0, threshold, style, opts.w, opts.h, opts.scale ?? 1, opts.origin ?? null, opts.bank ?? null, opts.mouthFlare ?? 1, opts.widthPower ?? 0.5]);
}

/**
 * drawRivers(走河网画法,传了 opts)在 W × H 的画布上要做的,拆成几步先在后台做好(几何、陆地蒙版、每层一步,
 * 每层描好、裁好就让浏览器当下画出来):之后那一次 drawRivers 直接把备好的几层按原来的透明度叠上,和当场画逐像素一样。
 * 打开世界时备整张图上的河用(写实 / 卫星画风)。弯边投影的不备(返回空)
 */
export function riverNetworkSteps(
  W: number,
  H: number,
  rivers0: { pts: Float32Array; drawn?: Uint8Array }[],
  at: number | VecView,
  threshold: number,
  style: RiverStyle,
  opts: RiverOptions,
): WorkStep[] {
  const v = typeof at === 'number' ? bakedView(at) : at;
  if (v.proj) return [];
  let rivers: { pts: Float32Array }[] = [];
  let lines: DenseRiver[] = [];
  let key = '';
  const done: { canvas: OffscreenCanvas | HTMLCanvasElement; alpha: number }[] = [];
  const kinds = netLayers(style, opts);
  const widthOf = riverWidth(style, threshold, opts.widthPower ?? 0.5);
  let skip = false;
  return [
    () => {
      rivers = shownRivers(rivers0, threshold);
      key = netKey(W, H, v, threshold, style, opts);
      skip = !!preparedNet && preparedNet.rivers === rivers && preparedNet.water === opts.water && preparedNet.key === key;
      if (!skip) lines = netGeometry(rivers, v, threshold, style, opts);
    },
    () => void (skip || landMask(opts)),
    ...kinds.map(
      ({ rgb, alpha, extra }): WorkStep =>
        () => {
          if (skip) return;
          const l = makeLayer(W, H);
          netLayer(l, lines, v, style, widthOf, opts, landMask(opts), null, rgb, extra);
          flushCanvas(l.canvas);
          done.push({ canvas: l.canvas, alpha });
        },
    ),
    () => {
      if (skip) return;
      dropPreparedRivers();
      preparedNet = { rivers, water: opts.water, key, layers: done.slice() };
    },
  ];
}

function drawRiverNetwork(
  ctx: CanvasRenderingContext2D,
  rivers: { pts: Float32Array }[],
  v: VecView,
  threshold: number,
  style: RiverStyle,
  opts: RiverOptions,
) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  // 后台备好了这一份:按原来的透明度叠上(用过就放掉)
  const pre = preparedNet;
  if (pre && !v.proj && pre.rivers === rivers && pre.water === opts.water && pre.key === netKey(W, H, v, threshold, style, opts)) {
    preparedNet = null;
    for (const x of pre.layers) {
      ctx.save();
      ctx.globalAlpha = x.alpha;
      ctx.drawImage(x.canvas, 0, 0);
      ctx.restore();
      x.canvas.width = x.canvas.height = 0;
    }
    return;
  }
  const lines = netGeometry(rivers, v, threshold, style, opts);
  const widthOf = riverWidth(style, threshold, opts.widthPower ?? 0.5);
  const mask = landMask(opts);

  const l = makeLayer(W, H);
  // 弯边投影:陆地蒙版先按投影铺到一张和画布一样大的透明画布上(一行一行铺,不能直接 destination-in:
  // 那样每铺一行都会把别的行清掉),再整张拿去裁河道
  let pm: ReturnType<typeof makeLayer> | null = null;
  if (v.proj) {
    pm = makeLayer(W, H);
    reprojectImage(pm.g, mask.canvas, opts.w, opts.h, v.proj.mp, v, 'low');
  }
  for (const { rgb, alpha, extra } of netLayers(style, opts)) {
    netLayer(l, lines, v, style, widthOf, opts, mask, pm, rgb, extra);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(l.canvas, 0, 0);
    ctx.restore();
  }
  l.canvas.width = l.canvas.height = 0;
  if (pm) pm.canvas.width = pm.canvas.height = 0;
}

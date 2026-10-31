/** 渲染共用:明暗(山体阴影)、距离变换、颜色工具。 */
import type { Raster } from '../gen/raster';
import { boxBlur, nearX } from '../gen/util';
import { hash2, noise3, valueNoise } from '../gen/noise';
import { riverGeometry, type DenseRiver, type RiverWidth } from '../gen/riverGeometry';
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

/** 把 x 挪到离 ref 最近的那一份:在 gen/util.ts(生成河网几何也用) */
export { nearX };

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

/** 哈希噪声 hash2、值噪声 valueNoise:在 gen/noise.ts(生成河口也用) */
export { hash2, valueNoise };

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

/** 画河的颜色、粗细(粗细那几项河网几何也用,见 gen/riverGeometry.ts 的 RiverWidth) */
export interface RiverStyle extends RiverWidth {
  color: string;
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

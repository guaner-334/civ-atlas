/**
 * 地图投影:等距圆柱(主图)/ 罗宾森 / 自然地球 / 摩尔威德 / 墨卡托。
 *
 * 这几种都是"伪圆柱"投影:纬线是水平直线,y 只看纬度;同一条纬线上 x 和经度成正比(x = kx(φ) · λ)。
 * 所以:
 *   - 正投影:经纬度 → (kx(φ) · λ, y(φ));反投影:y → φ,再 λ = x / kx(φ)
 *   - 整图重投影(drawProjected):新图的每一行是一条纬线,从等距圆柱主图上取对应的那一行,横向拉到这条纬线的宽度 ——
 *     一行一次 drawImage,显卡里做,不用逐像素读回主图(1024 行约几毫秒)
 *   - 外轮廓:左右两条边就是 ±180° 经线;经纬网:经线逐点投影、纬线是水平直线
 *   - 按投影重画(第二档,停着的时候用;拖动中心时用上面的整图重投影):"面"按行重投影到任意视口(reprojectImage),
 *     线逐点投影、长段加密、过 ±180° 在另一边接着画(Projector 查表投影、addProjectedLine),
 *     符号在投影后的位置上正立、按屏幕大小画,间距按投影后的距离留(glyphMetric)
 * 公式自己写(每种十几行),不加依赖;地球仪(正射)不是伪圆柱,另外做。
 *
 * 坐标:
 *   - 世界坐标:等距圆柱主图的像素坐标(宽 W、高 H;x = 0 是 180° 经线,地图正中是 0°,y = 0 是北极)
 *   - 地图平面:和世界一样大的长方形 [0, W] × [0, H],投影后的整张图按原比例、留一点边居中放在里面。
 *     等距圆柱、中央经线 0° 时地图平面就是世界坐标本身
 *   - 中央经线 lon0(度,−180 … 180):地图正中是哪条经线;左右边 = lon0 ± 180°
 *
 * 纯计算,不碰 DOM(drawProjected 只用传进来的画布上下文),主线程、后台线程、Node 里都能用。
 */
import type { LabelProjection } from './labels/draw';
import { PROJECTIONS, PROJ_PAD, type ProjectionDef, type ProjectionId } from './projectionDefs';

// 几种投影的公式、名字在 projectionDefs.ts(首页只用到那一小份);原来从这里 import 的照旧能用
export { PROJECTIONS, PROJECTION_IDS, PROJ_PAD, isProjectionId, type ProjectionDef, type ProjectionId } from './projectionDefs';

const HALF_PI = Math.PI / 2;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// 放进地图平面:投影 + 中央经线 + 世界大小

export interface MapProj {
  def: ProjectionDef;
  /** 中央经线(度,−180 … 180) */
  lon0: number;
  /** 地图平面 = 世界大小 */
  W: number;
  H: number;
  /** 投影平面 1 个单位 = 多少地图平面单位 */
  s: number;
  /** 投影平面的半宽(赤道上 ±180°)、半高(最大纬度) */
  xMax: number;
  yMax: number;
  /** 缓存键:投影 + 中央经线 + 大小 */
  key: string;
}

/** 经度挪到 [−180, 180) */
export function wrapLon(lon: number): number {
  const t = (lon + 180) / 360;
  return (t - Math.floor(t)) * 360 - 180;
}

/** 弧度的经度差挪到 [−π, π) */
function wrapPi(l: number): number {
  const t = (l + Math.PI) / (2 * Math.PI);
  return (t - Math.floor(t)) * 2 * Math.PI - Math.PI;
}

export function mapProj(id: ProjectionId, lon0: number, W: number, H: number): MapProj {
  const def = PROJECTIONS[id] ?? PROJECTIONS.equirect;
  const xMax = def.kx(0) * Math.PI;
  const yMax = def.y(def.latMax);
  let s: number;
  if (def.id === 'equirect') s = W / (2 * Math.PI);
  else {
    const pad = PROJ_PAD * H;
    s = Math.min((W - 2 * pad) / (2 * xMax), (H - 2 * pad) / (2 * yMax));
  }
  const l0 = Number.isFinite(lon0) ? wrapLon(lon0) : 0;
  return { def, lon0: l0, W, H, s, xMax, yMax, key: `${def.id}|${l0.toFixed(4)}|${W}x${H}` };
}

/** 世界 x → 经度(弧度,x = 0 是 −π) */
const lamOf = (wx: number, W: number) => (wx / W) * 2 * Math.PI - Math.PI;
/** 世界 y → 纬度(弧度) */
const phiOf = (wy: number, H: number) => HALF_PI - (wy / H) * Math.PI;

/** 经度差 λrel(弧度,可以超出 ±π)、纬度 → 地图平面 */
export function projectRel(mp: MapProj, lamRel: number, phi: number): [number, number] {
  const { def, s, W, H } = mp;
  return [W / 2 + s * def.kx(phi) * lamRel, H / 2 - s * def.y(phi)];
}

/** 世界坐标 → 地图平面(经度按中央经线挪到 ±180° 以内) */
export function projectWorld(mp: MapProj, wx: number, wy: number): [number, number] {
  const phi = phiOf(wy, mp.H);
  return projectRel(mp, wrapPi(lamOf(wx, mp.W) - mp.lon0 * DEG), phi);
}

/**
 * 世界坐标 → 地图平面,经度相对 refX 连续地展开(一条路径整条投过去,不在左右边断开;
 * 伸出外轮廓的部分落在轮廓外面,排字时按轮廓筛掉)。refX 本身按中央经线挪到 ±180° 以内
 */
export function projectWorldNear(mp: MapProj, wx: number, wy: number, refX: number): [number, number] {
  const W = mp.W;
  const ux = wx - W * Math.round((wx - refX) / W);
  const ref = wrapPi(lamOf(refX, W) - mp.lon0 * DEG);
  return projectRel(mp, ref + ((ux - refX) / W) * 2 * Math.PI, phiOf(wy, mp.H));
}

/** 地图平面 → 经度差(弧度,−π … π)、纬度;不在外轮廓里 = null */
export function unprojectRel(mp: MapProj, mx: number, my: number): [number, number] | null {
  const { def, s, W, H } = mp;
  const y = (H / 2 - my) / s;
  const phi = def.phi(y);
  if (!Number.isFinite(phi)) return null;
  const x = (mx - W / 2) / s;
  const k = def.kx(phi);
  if (k < 1e-9) return Math.abs(x) < 1e-6 ? [0, phi] : null;
  const lam = x / k;
  if (!(Math.abs(lam) <= Math.PI + 1e-9)) return null;
  return [Math.max(-Math.PI, Math.min(Math.PI, lam)), phi];
}

/** 地图平面 → 世界坐标(x 在 [0, W) 里);不在外轮廓里 = null */
export function unprojectWorld(mp: MapProj, mx: number, my: number): [number, number] | null {
  const r = unprojectRel(mp, mx, my);
  if (!r) return null;
  const lam = r[0] + mp.lon0 * DEG;
  const t = (lam + Math.PI) / (2 * Math.PI);
  const wx = (t - Math.floor(t)) * mp.W;
  return [wx >= mp.W ? 0 : wx, ((HALF_PI - r[1]) / Math.PI) * mp.H];
}

/** 地图平面上一行的反投影(unprojectRow):这一行的世界 y,和这一行上任一点的世界 x */
export interface UnprojectedRow {
  wy: number;
  /** 地图平面 x → 世界 x(在 [0, W) 里);不在外轮廓里 = NaN */
  wx(mx: number): number;
}

/**
 * 地图平面上同一行(my 相同)逐点反投影:纬度和这条纬线的横向比例整行只算一次
 * (摩尔威德、罗宾森反解纬度要迭代 / 查表,整张栅格逐点调 unprojectWorld 时这一步占了大半)。
 * 整行在外轮廓外 = null。结果和逐点调 unprojectWorld(mp, mx, my) 逐位一样(同样的算式、同样的顺序)
 */
export function unprojectRow(mp: MapProj, my: number): UnprojectedRow | null {
  const { def, s, W, H } = mp;
  const phi = def.phi((H / 2 - my) / s);
  if (!Number.isFinite(phi)) return null;
  const k = def.kx(phi);
  const l0 = mp.lon0 * DEG;
  return {
    wy: ((HALF_PI - phi) / Math.PI) * H,
    wx: (mx) => {
      const x = (mx - W / 2) / s;
      let lam = 0;
      if (k < 1e-9) {
        if (!(Math.abs(x) < 1e-6)) return NaN;
      } else {
        lam = x / k;
        if (!(Math.abs(lam) <= Math.PI + 1e-9)) return NaN;
        lam = Math.max(-Math.PI, Math.min(Math.PI, lam));
      }
      const t = (lam + l0 + Math.PI) / (2 * Math.PI);
      const wx = (t - Math.floor(t)) * W;
      return wx >= W ? 0 : wx;
    },
  };
}

/**
 * 只换中央经线(from → to,同一种投影、同样大小)时,地图平面上 my0 … my1 这几行横向挪了多少:
 * 每一行整体平移 −s · kx(φ) · Δλ,纬度不同挪得不一样多。
 * 返回中间那一行的挪动量 dx,和这几行相对它的最大偏差 err(都是地图平面单位)。
 * 放大后拖动转中心时,细节层把画好的那一块整体平移 dx(ui/TerrainDetail.tsx),偏差小就先不重画
 */
export function centerShift(from: MapProj, to: MapProj, my0: number, my1: number): { dx: number; err: number } {
  const { def, s, H } = to;
  const dLam = wrapLon(to.lon0 - from.lon0) * DEG;
  // 这一行的纬线比例(外轮廓上下以外按最上 / 最下那一行算)
  const kAt = (my: number) => {
    const y = Math.max(-to.yMax, Math.min(to.yMax, (H / 2 - my) / s));
    const phi = def.phi(y);
    return def.kx(Number.isFinite(phi) ? phi : Math.sign(y) * def.latMax);
  };
  const kc = kAt((my0 + my1) / 2);
  // kx 从赤道往两极单调变小:这几行里最大、最小的在两头,跨过赤道时最大的在赤道上
  const k0 = kAt(my0);
  const k1 = kAt(my1);
  const hi = (my0 - H / 2) * (my1 - H / 2) < 0 ? def.kx(0) : Math.max(k0, k1);
  const lo = Math.min(k0, k1);
  return { dx: -s * kc * dLam, err: s * Math.abs(dLam) * Math.max(hi - kc, kc - lo) };
}

/** 地图平面上这一点在不在外轮廓里(往里缩 pad 个地图平面单位) */
export function insideProj(mp: MapProj, mx: number, my: number, pad = 0): boolean {
  const { def, s, W, H } = mp;
  const y = (H / 2 - my) / s;
  const py = pad / s;
  if (Math.abs(y) > mp.yMax - py) return false;
  const phi = def.phi(y);
  if (!Number.isFinite(phi)) return false;
  return Math.abs(mx - W / 2) <= s * def.kx(phi) * Math.PI - pad;
}

/** 等距圆柱、中央经线 0°:地图平面就是世界坐标(不用投影) */
export function isIdentity(mp: MapProj): boolean {
  return mp.def.id === 'equirect' && Math.abs(mp.lon0) < 1e-9;
}

/** 纬线 φ(弧度)在地图平面上的 y */
export function latY(mp: MapProj, phi: number): number {
  return mp.H / 2 - mp.s * mp.def.y(phi);
}

// ---------------------------------------------------------------------------
// 外轮廓、经纬网(地图平面上的折线)

/**
 * 外轮廓(闭合多边形,x,y,x,y…):左边(−180° 经线)从南到北,右边(+180°)从北到南;
 * 极点画成一条线的(罗宾森、自然地球、墨卡托、等距圆柱)上下边是直线,摩尔威德在极点收成一点
 */
export function outlinePath(mp: MapProj, stepDeg = 1): number[] {
  const out: number[] = [];
  const lat = mp.def.latMax / DEG;
  const n = Math.max(2, Math.ceil((2 * lat) / stepDeg));
  for (let i = 0; i <= n; i++) {
    const phi = (-lat + (2 * lat * i) / n) * DEG;
    out.push(...projectRel(mp, -Math.PI, phi));
  }
  for (let i = n; i >= 0; i--) {
    const phi = (-lat + (2 * lat * i) / n) * DEG;
    out.push(...projectRel(mp, Math.PI, phi));
  }
  return out;
}

/**
 * 经纬网:每隔 step 度一条经线(按中央经线对齐到整度数:经线落在 0°、±30°…)、一条纬线。
 * 返回折线(地图平面),经线逐点投影(弯的),纬线是水平直线
 */
export function graticuleLines(mp: MapProj, step = 30): { meridians: number[][]; parallels: number[][]; equator: number[] } {
  const lat = mp.def.latMax / DEG;
  const meridians: number[][] = [];
  // 离左边最近的那条整度数经线
  const first = Math.ceil((mp.lon0 - 180) / step) * step;
  for (let lon = first; lon < mp.lon0 + 180 - 1e-6; lon += step) {
    const rel = (lon - mp.lon0) * DEG;
    if (Math.abs(Math.abs(rel) - Math.PI) < 1e-6) continue; // 就是外轮廓
    const line: number[] = [];
    for (let a = -lat; a <= lat + 1e-9; a += 1) line.push(...projectRel(mp, rel, Math.max(-lat, Math.min(lat, a)) * DEG));
    meridians.push(line);
  }
  const parallels: number[][] = [];
  for (let a = -90 + step; a < 90; a += step) {
    if (Math.abs(a) > lat) continue;
    const phi = a * DEG;
    const [x0, y] = projectRel(mp, -Math.PI, phi);
    const [x1] = projectRel(mp, Math.PI, phi);
    parallels.push([x0, y, x1, y]);
  }
  const [e0, ey] = projectRel(mp, -Math.PI, 0);
  const [e1] = projectRel(mp, Math.PI, 0);
  return { meridians, parallels, equator: [e0, ey, e1, ey] };
}

/** 经度写成 "120°E" / "60°W" / "0°" / "180°"(和悬停信息、投影面板的写法一样) */
export function lonText(lon: number): string {
  const t = (lon + 180) / 360;
  const v = (t - Math.floor(t)) * 360 - 180;
  const a = Math.round(Math.abs(v));
  if (a === 0) return '0°';
  if (a === 180) return '180°';
  return `${a}°${v > 0 ? 'E' : 'W'}`;
}

/** 纬度写成 "30°N" / "60°S" / "0°" */
export function latText(lat: number): string {
  const a = Math.round(lat);
  return a === 0 ? '0°' : `${Math.abs(a)}°${a > 0 ? 'N' : 'S'}`;
}

// ---------------------------------------------------------------------------
// 整图重投影:按行从等距圆柱主图取像素

/** 画布上下文(主线程画布 / 后台线程的 OffscreenCanvas 都行) */
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface RowPlan {
  /** 第几行(目标画布)有图:源图的第几行(0 … 1,乘源图高度)、这一行左右边(0 … 1,乘目标画布宽度) */
  rows: Int32Array;
  v: Float32Array;
  x0: Float32Array;
  x1: Float32Array;
}
const plans = new Map<string, RowPlan>();

/** 目标画布每一行对应哪条纬线、左右到哪(和中央经线无关,按投影 + 大小缓存) */
function rowPlan(mp: MapProj, dh: number): RowPlan {
  const key = `${mp.def.id}|${mp.W}x${mp.H}|${dh}`;
  let p = plans.get(key);
  if (p) return p;
  const rows: number[] = [];
  const v: number[] = [];
  const x0: number[] = [];
  const x1: number[] = [];
  for (let r = 0; r < dh; r++) {
    const my = ((r + 0.5) / dh) * mp.H;
    const phi = mp.def.phi((mp.H / 2 - my) / mp.s);
    if (!Number.isFinite(phi)) continue;
    const hw = mp.s * mp.def.kx(phi) * Math.PI;
    rows.push(r);
    v.push((HALF_PI - phi) / Math.PI);
    x0.push((mp.W / 2 - hw) / mp.W);
    x1.push((mp.W / 2 + hw) / mp.W);
  }
  p = { rows: Int32Array.from(rows), v: Float32Array.from(v), x0: Float32Array.from(x0), x1: Float32Array.from(x1) };
  if (plans.size > 24) plans.clear();
  plans.set(key, p);
  return p;
}

/**
 * 把等距圆柱主图重投影到目标画布(整张图,dw × dh 对应地图平面 [0, W] × [0, H])。
 * src2 = 主图左右接了两份的画布(宽 2 × sw、高 sh;见 doubleCanvas):每一行只要一次 drawImage,接缝处的取样也是连着的。
 * 不清空目标画布(调用方先清空或先铺底色)。
 */
export function drawProjected(ctx: Ctx2D, src2: CanvasImageSource, sw: number, sh: number, mp: MapProj, dw: number, dh: number): void {
  const plan = rowPlan(mp, dh);
  // 这一行最左边(中央经线 − 180°)在源图上的列
  const t = mp.lon0 / 360;
  const sx0 = (t - Math.floor(t)) * sw;
  const { rows, v, x0, x1 } = plan;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  (ctx as CanvasRenderingContext2D).imageSmoothingQuality = 'medium';
  for (let i = 0; i < rows.length; i++) {
    // 取源图的小数行:目标像素中心正好落在这条纬线上,上下两行按距离插值(墨卡托高纬度一行拉成好几行时不起台阶)
    const sy = Math.min(sh - 1, Math.max(0, v[i] * sh - 0.5));
    const a = x0[i] * dw;
    const b = x1[i] * dw;
    ctx.drawImage(src2, sx0, sy, sw, 1, a, rows[i], b - a, 1);
  }
  ctx.restore();
}

/** 把画布左右接成两份(宽 2 × w),给 drawProjected 当源图;dst 可以复用 */
export function doubleCanvas<T extends HTMLCanvasElement | OffscreenCanvas>(src: CanvasImageSource & { width: number; height: number }, dst: T): T {
  const w = src.width;
  const h = src.height;
  if (dst.width !== 2 * w || dst.height !== h) {
    dst.width = 2 * w;
    dst.height = h;
  }
  const c = dst.getContext('2d') as Ctx2D | null;
  if (!c) return dst;
  c.clearRect(0, 0, 2 * w, h);
  c.drawImage(src, 0, 0);
  c.drawImage(src, w, 0);
  return dst;
}

/**
 * 按外轮廓建路径(地图平面 → 画布:px = m × sc + (ox, oy))。
 * grow(地图平面单位):往外撑这么多 —— 以地图中心为原点横竖各按比例放大,赤道处左右、极点处上下正好多出 grow
 * (桶形、椭圆的"平行线"近似,画双线外框用)
 */
export function outlineOnCanvas(ctx: Ctx2D, mp: MapProj, sc: number, ox = 0, oy = 0, grow = 0): void {
  const pts = outlinePath(mp);
  const cx = mp.W / 2;
  const cy = mp.H / 2;
  const fx = 1 + grow / (mp.xMax * mp.s);
  const fy = 1 + grow / (mp.yMax * mp.s);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i += 2) {
    const X = (cx + (pts[i] - cx) * fx) * sc + ox;
    const Y = (cy + (pts[i + 1] - cy) * fy) * sc + oy;
    if (i === 0) ctx.moveTo(X, Y);
    else ctx.lineTo(X, Y);
  }
  ctx.closePath();
}

/** 经纬网、细外框的颜色(按画风) */
const GRAT_INK: Record<string, [string, string]> = {
  fantasy: ['rgba(58,45,34,0.30)', 'rgba(58,45,34,0.5)'],
  realistic: ['rgba(232,240,248,0.26)', 'rgba(232,240,248,0.45)'],
  data: ['rgba(20,24,30,0.30)', 'rgba(20,24,30,0.5)'],
};

/**
 * 经纬网:每隔 step 度(10° / 15° / 30°;0 = 按 30°)一条经线、纬线,赤道稍粗。
 * mp = null(等距圆柱):世界坐标,经线是竖线,按画布宽度把左右各圈的都画上(跟着地图平移);
 * 弯边投影:地图平面上的折线(经线弯、纬线平)。v:坐标 × s + (ox, oy) = 画布像素;lw = 1 个 CSS 像素是几个画布像素
 */
export function drawGraticule(ctx: Ctx2D, mp: MapProj | null, W: number, H: number, v: { s: number; ox: number; oy: number }, style: string, step: number, lw: number): void {
  const deg = step > 0 ? step : 30;
  const [ink, strong] = GRAT_INK[style] ?? GRAT_INK.realistic;
  const X = (x: number) => x * v.s + v.ox;
  const Y = (y: number) => y * v.s + v.oy;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const stroke = (lines: number[][], color: string, width: number) => {
    ctx.beginPath();
    for (const l of lines) {
      for (let i = 0; i + 1 < l.length; i += 2) {
        if (i === 0) ctx.moveTo(X(l[i]), Y(l[i + 1]));
        else ctx.lineTo(X(l[i]), Y(l[i + 1]));
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  if (mp) {
    const g = graticuleLines(mp, deg);
    stroke([...g.meridians, ...g.parallels], ink, 0.8 * lw);
    stroke([g.equator], strong, 1.3 * lw);
  } else {
    // 画布横向盖住哪几圈:x 从画布左边到右边
    const cw = ctx.canvas.width;
    const x0 = (0 - v.ox) / v.s;
    const x1 = (cw - v.ox) / v.s;
    const dx = (W * deg) / 360;
    const lines: number[][] = [];
    for (let i = Math.floor(x0 / dx); i * dx <= x1; i++) lines.push([i * dx, 0, i * dx, H]);
    for (let lat = -90 + deg; lat < 90; lat += deg) {
      if (Math.abs(lat) < 1e-6) continue;
      const y = ((90 - lat) / 180) * H;
      lines.push([x0, y, x1, y]);
    }
    stroke(lines, ink, 0.8 * lw);
    stroke([[x0, H / 2, x1, H / 2]], strong, 1.3 * lw);
  }
  ctx.restore();
}

/** 写实风 / 数据图层在弯边投影下沿外轮廓描一道细线(盖住轮廓边缘的锯齿);lw = 1 个 CSS 像素是几个画布像素 */
export function drawNeatOutline(ctx: Ctx2D, mp: MapProj, v: { s: number; ox: number; oy: number }, style: string, lw: number): void {
  ctx.save();
  ctx.lineJoin = 'round';
  outlineOnCanvas(ctx, mp, v.s, v.ox, v.oy, 0);
  ctx.strokeStyle = style === 'data' ? 'rgba(30,32,36,0.7)' : 'rgba(196,210,224,0.55)';
  ctx.lineWidth = 1.2 * lw;
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// 按投影重画(第二档):矢量线逐点投影、符号在投影后的位置上正立着画、"面"按行重投影到任意视口

/**
 * 快速投影(给矢量线、符号用;几十万个点也只要几毫秒):纬度方向查表 ——
 * 伪圆柱投影的 y 和横向比例只看纬度,按世界 y 每 1/4 单位存一格,线性插值(误差远小于 0.01 个地图平面单位)。
 * 墨卡托的 y 不截在 ±80°(伸出外轮廓的部分由调用方按外轮廓裁掉,不会贴着上下边画成一条线)。
 * 地图平面坐标:x = W/2 + K(y) · λrel,y = Y(y);λrel = 经度 − 中央经线(弧度)
 */
export interface Projector {
  mp: MapProj;
  W: number;
  H: number;
  /** 世界 x → 经度差(弧度,−π … π) */
  rel(wx: number): number;
  /** 世界 y 处纬线上每弧度经度在地图平面上多长(s · kx) */
  K(wy: number): number;
  /** 世界 y → 地图平面 y */
  Y(wy: number): number;
  /** 两者对世界 y 的导数(局部拉伸、山脊走向换算用) */
  dK(wy: number): number;
  dY(wy: number): number;
  /** 加密步长(世界单位,约 1.5°) */
  step: number;
}

const LUT_STEP = 0.25;
const luts = new Map<string, { K: Float64Array; Y: Float64Array }>();

/** 按投影 + 大小建表(和中央经线无关) */
function projLut(mp: MapProj): { K: Float64Array; Y: Float64Array } {
  const key = `${mp.def.id}|${mp.W}x${mp.H}`;
  let t = luts.get(key);
  if (t) return t;
  const n = Math.ceil(mp.H / LUT_STEP) + 1;
  const K = new Float64Array(n);
  const Y = new Float64Array(n);
  const merc = mp.def.id === 'mercator';
  const cap = 89.5 * DEG;
  for (let i = 0; i < n; i++) {
    const phi = Math.max(-HALF_PI, Math.min(HALF_PI, phiOf(Math.min(mp.H, i * LUT_STEP), mp.H)));
    K[i] = mp.s * mp.def.kx(merc ? Math.max(-cap, Math.min(cap, phi)) : phi);
    Y[i] = merc ? mp.H / 2 - mp.s * Math.log(Math.tan(Math.PI / 4 + Math.max(-cap, Math.min(cap, phi)) / 2)) : mp.H / 2 - mp.s * mp.def.y(phi);
  }
  t = { K, Y };
  if (luts.size > 16) luts.clear();
  luts.set(key, t);
  return t;
}

const projectors = new Map<string, Projector>();

export function projector(mp: MapProj): Projector {
  let pj = projectors.get(mp.key);
  if (pj) return pj;
  const { K, Y } = projLut(mp);
  const n = K.length;
  const W = mp.W;
  const lam0 = mp.lon0 * DEG;
  const at = (tab: Float64Array, wy: number) => {
    const u = Math.max(0, Math.min(n - 1, wy / LUT_STEP));
    const i = Math.min(n - 2, Math.floor(u));
    return tab[i] + (tab[i + 1] - tab[i]) * (u - i);
  };
  const slope = (tab: Float64Array, wy: number) => {
    const u = Math.max(0, Math.min(n - 1, wy / LUT_STEP));
    const i = Math.min(n - 2, Math.floor(u));
    return (tab[i + 1] - tab[i]) / LUT_STEP;
  };
  pj = {
    mp,
    W,
    H: mp.H,
    rel: (wx) => wrapPi(lamOf(wx, W) - lam0),
    K: (wy) => at(K, wy),
    Y: (wy) => at(Y, wy),
    dK: (wy) => slope(K, wy),
    dY: (wy) => slope(Y, wy),
    step: (W / 360) * 1.5,
  };
  if (projectors.size > 16) projectors.clear();
  projectors.set(mp.key, pj);
  return pj;
}

/** 地图平面 → 画布像素的变换:画布 = 地图平面 × s + (ox, oy) */
export interface PlaneView {
  s: number;
  ox: number;
  oy: number;
}

/**
 * 折线(世界坐标,每点 stride 个数、前两个是 x, y;x 已展开成连续的)按投影加进 Path2D(画布像素):
 * 逐点投影,长于 pj.step 的段按世界坐标加密;经度相对中央经线连续展开,
 * 伸出 ±180° 的部分在另一边再加一份(平移 ∓2π,落在外轮廓外的那截由调用方按外轮廓裁掉)。
 * 返回这条线有没有加进去(点太少 = false)
 */
export function addProjectedLine(path: Path2D, pts: ArrayLike<number>, stride: number, pj: Projector, v: PlaneView, closed = false, step = pj.step): boolean {
  const m = Math.floor(pts.length / stride);
  if (m < 2) return false;
  const W = pj.W;
  const k2 = (2 * Math.PI) / W;
  let rel = pj.rel(pts[0]);
  let lo = rel;
  let hi = rel;
  const r0 = rel;
  for (let i = 1; i < m; i++) {
    rel += (pts[i * stride] - pts[(i - 1) * stride]) * k2;
    if (rel < lo) lo = rel;
    if (rel > hi) hi = rel;
  }
  const emit = (shift: number) => {
    let rl = r0 + shift;
    let px = pts[0];
    let py = pts[1];
    path.moveTo((W / 2 + pj.K(py) * rl) * v.s + v.ox, pj.Y(py) * v.s + v.oy);
    for (let i = 1; i < m; i++) {
      const x = pts[i * stride];
      const y = pts[i * stride + 1];
      const dx = x - px;
      const dy = y - py;
      const len = Math.abs(dx) + Math.abs(dy);
      const nSub = len > step ? Math.ceil(len / step) : 1;
      for (let q = 1; q <= nSub; q++) {
        const t = q / nSub;
        const yy = py + dy * t;
        const rr = rl + dx * t * k2;
        path.lineTo((W / 2 + pj.K(yy) * rr) * v.s + v.ox, pj.Y(yy) * v.s + v.oy);
      }
      rl += dx * k2;
      px = x;
      py = y;
    }
    if (closed) path.closePath();
  };
  emit(0);
  if (lo < -Math.PI) emit(2 * Math.PI);
  if (hi > Math.PI) emit(-2 * Math.PI);
  return true;
}

/** 同 addProjectedLine,但返回投影后的折线(画布像素 x, y 交错;伸出 ±180° 时另一边那份单独一条) */
export function projectLinePts(pts: ArrayLike<number>, stride: number, pj: Projector, v: PlaneView, step = pj.step): Float64Array[] {
  const m = Math.floor(pts.length / stride);
  if (m < 2) return [];
  const W = pj.W;
  const k2 = (2 * Math.PI) / W;
  let rel = pj.rel(pts[0]);
  let lo = rel;
  let hi = rel;
  const r0 = rel;
  let total = 1;
  for (let i = 1; i < m; i++) {
    const dx = pts[i * stride] - pts[(i - 1) * stride];
    const dy = pts[i * stride + 1] - pts[(i - 1) * stride + 1];
    const len = Math.abs(dx) + Math.abs(dy);
    total += len > step ? Math.ceil(len / step) : 1;
    rel += dx * k2;
    if (rel < lo) lo = rel;
    if (rel > hi) hi = rel;
  }
  const emit = (shift: number) => {
    const out = new Float64Array(total * 2);
    let o = 0;
    let rl = r0 + shift;
    let px = pts[0];
    let py = pts[1];
    out[o++] = (W / 2 + pj.K(py) * rl) * v.s + v.ox;
    out[o++] = pj.Y(py) * v.s + v.oy;
    for (let i = 1; i < m; i++) {
      const x = pts[i * stride];
      const y = pts[i * stride + 1];
      const dx = x - px;
      const dy = y - py;
      const len = Math.abs(dx) + Math.abs(dy);
      const nSub = len > step ? Math.ceil(len / step) : 1;
      for (let q = 1; q <= nSub; q++) {
        const t = q / nSub;
        const yy = py + dy * t;
        const rr = rl + dx * t * k2;
        out[o++] = (W / 2 + pj.K(yy) * rr) * v.s + v.ox;
        out[o++] = pj.Y(yy) * v.s + v.oy;
      }
      rl += dx * k2;
      px = x;
      py = y;
    }
    return out;
  };
  const res = [emit(0)];
  if (lo < -Math.PI) res.push(emit(2 * Math.PI));
  if (hi > Math.PI) res.push(emit(-2 * Math.PI));
  return res;
}

/**
 * 一个点(世界坐标)投影后要画在哪几份:经度差 rel(弧度)离 ±180° 不到 padRel 时,另一边(平移 ∓2π)再画一份。
 * 返回平移量列表(弧度)
 */
export function relShifts(rel: number, padRel: number): number[] {
  if (rel + padRel <= Math.PI && rel - padRel >= -Math.PI) return NO_REL_SHIFT;
  const out = [0];
  if (rel + padRel > Math.PI) out.push(-2 * Math.PI);
  if (rel - padRel < -Math.PI) out.push(2 * Math.PI);
  return out;
}
const NO_REL_SHIFT = [0];

/** 按外轮廓裁剪(画布上):之后画的东西不出轮廓 */
export function clipOutline(ctx: Ctx2D, mp: MapProj, v: PlaneView): void {
  outlineOnCanvas(ctx, mp, v.s, v.ox, v.oy, 0);
  ctx.clip();
}

/**
 * 把一张等距圆柱的整图(src,宽 sw 高 sh,盖住整个世界;x = 0 是 180° 经线)按投影一行一行铺到画布上,
 * 画布 = 地图平面 × v + 偏移(可以是整张图,也可以是放大后的一块视口)。
 * 伪圆柱投影:画布的一行是一条纬线,从原图对应的那一行(小数行,上下两行按距离插值)取一段横向拉过来;
 * 跨过原图左右边(180° 经线)的那一行分两段取。只画外轮廓以内、画布以内的部分;不清空画布
 */
export function reprojectImage(
  ctx: Ctx2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  mp: MapProj,
  v: PlaneView,
  quality: ImageSmoothingQuality = 'medium',
  /** 只铺画布的第 rows[0] 到 rows[1] − 1 行(分几次铺完和一次铺完一样;不给 = 全部) */
  rows?: [number, number],
): void {
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const { W, H, def } = mp;
  const lam0 = mp.lon0 * DEG;
  // 画布上外轮廓上下边之间的行
  const r0 = Math.max(rows ? rows[0] : 0, Math.floor((H / 2 - mp.s * mp.yMax) * v.s + v.oy));
  const r1 = Math.min(rows ? rows[1] : ch, ch, Math.ceil((H / 2 + mp.s * mp.yMax) * v.s + v.oy));
  const mxL = (0 - v.ox) / v.s;
  const mxR = (cw - v.ox) / v.s;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  (ctx as CanvasRenderingContext2D).imageSmoothingQuality = quality;
  for (let r = r0; r < r1; r++) {
    const my = (r + 0.5 - v.oy) / v.s;
    const phi = def.phi((H / 2 - my) / mp.s);
    if (!Number.isFinite(phi)) continue;
    const K = mp.s * def.kx(phi);
    if (K < 1e-9) continue;
    const hw = K * Math.PI;
    const a = Math.max(mxL, W / 2 - hw);
    const b = Math.min(mxR, W / 2 + hw);
    if (b <= a) continue;
    const relA = (a - W / 2) / K;
    const relB = (b - W / 2) / K;
    let uA = (lam0 + relA + Math.PI) / (2 * Math.PI);
    const du = (relB - relA) / (2 * Math.PI);
    uA -= Math.floor(uA);
    const uB = uA + du;
    const sy = Math.min(sh - 1, Math.max(0, ((HALF_PI - phi) / Math.PI) * sh - 0.5));
    const dA = a * v.s + v.ox;
    const dB = b * v.s + v.ox;
    if (uB <= 1 + 1e-9) {
      ctx.drawImage(src, uA * sw, sy, Math.max(1e-6, du * sw), 1, dA, r, dB - dA, 1);
    } else {
      const t = (1 - uA) / du;
      const dM = dA + (dB - dA) * t;
      if (dM > dA) ctx.drawImage(src, uA * sw, sy, Math.max(1e-6, (1 - uA) * sw), 1, dA, r, dM - dA, 1);
      if (dB > dM) ctx.drawImage(src, 0, sy, Math.max(1e-6, (uB - 1) * sw), 1, dM, r, dB - dM, 1);
    }
  }
  ctx.restore();
}

/**
 * 符号规划按投影摆放用的"尺子"(render/fantasy.ts 的 planGlyphs):纬度 φ 处世界 1 单位在这种投影的地图平面上
 * 横向、纵向各多长(中央经线上量;等距圆柱时两者都是 1)。符号按屏幕大小画,间距也按投影后的距离留 ——
 * 摩尔威德、罗宾森高纬度横向压缩,等距圆柱里挨得刚好的山在那里会叠成一团;墨卡托赤道附近整图缩小。
 * 和中央经线无关(每种投影一份规划,换中心不重新摆)
 */
export interface GlyphMetric {
  /** 世界 y → 横向、纵向倍数 */
  fx(wy: number): number;
  fy(wy: number): number;
}

export function glyphMetric(id: ProjectionId, W: number, H: number): GlyphMetric {
  const mp = mapProj(id, 0, W, H);
  const pj = projector(mp);
  const k2 = (2 * Math.PI) / W;
  return {
    fx: (wy) => Math.max(0.08, Math.min(8, pj.K(wy) * k2)),
    fy: (wy) => Math.max(0.08, Math.min(8, Math.abs(pj.dY(wy)))),
  };
}

/** 给文字层用的投影(render/labels/draw.ts 的 LabelView.proj) */
export function labelProjection(mp: MapProj): LabelProjection {
  return {
    fwd: (wx, wy, refX) => (refX === undefined ? projectWorld(mp, wx, wy) : projectWorldNear(mp, wx, wy, refX)),
    inv: (mx, my) => unprojectWorld(mp, mx, my),
    inside: (mx, my, pad) => insideProj(mp, mx, my, pad),
    // 每 2° 左右插一个点
    step: mp.W / 180,
    wrap: mp.W,
  };
}

/** 弯边投影时外轮廓外面的底色(按画风):手绘 = 纸色,写实 / 数据图层 = 深色 */
export function pageColor(style: string): string {
  return style === 'fantasy' ? '#efe2c2' : '#12161c';
}

/**
 * 河口(只给放大后现算的块用,见 rasterWindow.ts;整张主图不画):放大以后海岸"知道"哪里有河 ——
 *   - 河一定通到海:放大后的海岸比河道的终点更靠外时(成河的河),补一段弯一弯通到最近的岸、接着刻河谷(太远、太高就不补,免得挖出一条渠)
 *   - 喇叭口:岸点往上游越来越窄,只切低地(山谷里的河口不硬切开山);河顺着岸走的那一段不张开
 *   - 三角洲:流量大、岸平、外面海浅、河大致正对着海的口子,往海里长出一块低地,水道分叉入海,外面一圈水下浅滩
 *   - 河口外的浑水:顺着河口方向散开,再被沿岸的洋流带着往一边漂(洋流弱的地方按地转偏向:北半球往右、南半球往左)
 * 只改这一块的像素(海拔、水陆、群落)和几份颜色系数(浑水、河水颜色,见 Raster.plume / rivTint / rivCore),不改世界。
 * 每个像素只按它的世界坐标算(和这一块从哪开始无关):相邻两块接得上,跨 180° 经线和挪一整圈一样。
 * 岸线两边的海拔是连着的(过 0 处就是岸),画风的水陆交界抗锯齿照常起作用,不出锯齿。
 */
import type { Raster } from './raster';
import type { ValleyLines } from './valleys';
import type { World } from './world';
import { Biome, classifyBiome, LAND_ICE_BELOW } from './biomes';
import { WETLAND_CUT } from './wetland';
import { sampleSpline } from './raster';
import { clamp, smoothstep, subSeed } from './util';
import { valueNoise } from './noise';

/** 喇叭口:口宽 = FUNNEL_K × √流量(世界单位) */
const FUNNEL_K = 0.15;
/** 喇叭口往上游收窄的长度 = LC_K × 口宽 */
const LC_K = 1.1;
/** 喇叭口只切这么低的地(米) */
const HMAX = 14;
/** 浑水伸出去多远 = PLUME_K × √流量;最浓处的浓度 */
const PLUME_K = 0.5;
const PLUME_A = 0.45;
/** 三角洲:流量够 DELTA_F 的口子才长;大小 = DELTA_K × √流量 */
const DELTA_K = 0.3;
const DELTA_F = 250;
/** 浑水画到离中心 PLUME_R 倍远为止(再往外淡到不足 1%) */
const PLUME_R = 1.36;
/** 三角洲外的浅滩到场 = -DELTA_FADE 处接回原来的海底 */
const DELTA_FADE = 1.3;
/** 三角洲上的地的湿地适宜度 × 255(Raster.wet;过了湿地门槛,湿地的颜色画满);到 WET_BYTE 的陆地像素群落是湿地 */
const DELTA_WET = Math.round(0.62 * 255);
const WET_BYTE = Math.ceil(WETLAND_CUT * 255);
/** 河道终点离岸超过这么远(世界单位)就不补 */
const BRIDGE_MAX = 8;

/** 一条折线 */
interface Line {
  x: number[];
  y: number[];
}

/** 三角洲上的一条水道:沿线的全程位置 t0..t1(0 = 分叉的顶点,1 = 入海处)、半宽 w0..w1 */
interface Channel extends Line {
  t0: number;
  t1: number;
  w0: number;
  w1: number;
}

interface Delta {
  /** 往海里长的方向、垂直方向 */
  gx: number;
  gy: number;
  /** 扇面的原点(岸点稍往后) */
  ox: number;
  oy: number;
  /** 往前长多远、两边多宽(世界单位) */
  len: number;
  half: number;
  chans: Channel[];
  /** 水道的框、整个三角洲(连外面的浅滩)的框 */
  cbox: Box;
  box: Box;
}

/** 框(世界单位,没挪整圈的坐标):x0, y0, x1, y1 */
type Box = [number, number, number, number];

export interface Mouth {
  /** 喇叭口的轴:河道最后一段 + 直着往海里延长;as = 离岸点多远(上游为正);al = 这一段朝不朝海(0 = 顺着岸走,不张开) */
  ax: number[];
  ay: number[];
  as: number[];
  al: number[];
  /** 河道终点(画出来的河停在这)的 s */
  sEnd: number;
  /** 河道终点还在岸上、补了一段通到海(见 bridgeOf);补的那一段刻的谷多深(米)、谷壁多宽 */
  bridge: boolean;
  vd: number;
  vw: number;
  /** 河道终点、河在终点的方向(补的那一段的河谷从这里往上游收) */
  ex: number;
  ey: number;
  edx: number;
  edy: number;
  /** 岸点(1 倍主图上碰到海的地方)、河往海里的方向、岸朝海的方向 */
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  /** 浑水往哪边漂:方向 × 程度(0–1) */
  ux: number;
  uy: number;
  f: number;
  /** 喇叭口口宽、往上游收窄的长度、管到上游多远 */
  w0: number;
  lc: number;
  lup: number;
  /** 画出来的河的半宽(喇叭口最窄处) */
  rwh: number;
  /** 浑水伸出去多远 */
  lp: number;
  delta: Delta | null;
  /** 喇叭口、浑水、整个的框 */
  fbox: Box;
  pbox: Box;
  box: Box;
  seed: number;
}

/** 画出来的河大约多宽(世界单位,放大约 8 倍时;只用来定喇叭口最窄处和三角洲水道) */
function drawnWidth(f: number, threshold: number): number {
  return 0.13 + 1.25 * Math.min(1, Math.pow(Math.max(0, f - threshold) / 1400, 0.65));
}

function fbm(x: number, y: number, seed: number): number {
  return 0.55 * valueNoise(x / 2.6, y / 2.6, seed) + 0.3 * valueNoise(x / 1.15, y / 1.15, seed + 17) + 0.15 * valueNoise(x / 0.5, y / 0.5, seed + 31);
}

/** 点到折线最近处:out = [距离, 第几段 + 段内位置] */
function nearest(a: Line, qx: number, qy: number, out: Float64Array): void {
  let best = Infinity;
  let bi = 0;
  const { x, y } = a;
  for (let j = 0; j < x.length - 1; j++) {
    const ax = x[j];
    const ay = y[j];
    const ex = x[j + 1] - ax;
    const ey = y[j + 1] - ay;
    const L2 = ex * ex + ey * ey;
    let t = L2 > 0 ? ((qx - ax) * ex + (qy - ay) * ey) / L2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * ex - qx;
    const cy = ay + t * ey - qy;
    const d2 = cx * cx + cy * cy;
    if (d2 < best) {
      best = d2;
      bi = j + t;
    }
  }
  out[0] = Math.sqrt(best);
  out[1] = bi;
}

/** 折线上第 i(带小数)点的值 */
function at(v: number[], i: number): number {
  const j = Math.min(v.length - 2, Math.floor(i));
  return v[j] + (v[j + 1] - v[j]) * (i - j);
}

function boxOf(x: number[], y: number[], pad: number): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < x.length; i++) {
    x0 = Math.min(x0, x[i]);
    x1 = Math.max(x1, x[i]);
    y0 = Math.min(y0, y[i]);
    y1 = Math.max(y1, y[i]);
  }
  return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
}

function union(a: Box, b: Box): Box {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** 每个地块中心挂进粗格子里(只要海),查一点附近的表层流向 */
function currentsNear(world: World): (x: number, y: number, R: number) => [number, number] {
  const { mesh, water, width, height } = world;
  if (!world.currents) return () => [0, 0];
  const { u, v } = world.currents;
  const B = 8;
  const cols = Math.ceil(width / B);
  const rows = Math.ceil(height / B);
  const head = new Int32Array(cols * rows).fill(-1);
  const next = new Int32Array(mesh.n).fill(-1);
  for (let c = 0; c < mesh.n; c++) {
    if (water[c] !== 1) continue;
    const gx = Math.min(cols - 1, Math.max(0, Math.floor(mesh.x[c] / B)));
    const gy = Math.min(rows - 1, Math.max(0, Math.floor(mesh.y[c] / B)));
    next[c] = head[gy * cols + gx];
    head[gy * cols + gx] = c;
  }
  return (x, y, R) => {
    let su = 0;
    let sv = 0;
    let sw = 0;
    const r = Math.ceil(R / B);
    const gx = Math.floor(x / B);
    const gy = Math.floor(y / B);
    for (let j = Math.max(0, gy - r); j <= Math.min(rows - 1, gy + r); j++)
      for (let i = gx - r; i <= gx + r; i++) {
        const ii = ((i % cols) + cols) % cols;
        for (let c = head[j * cols + ii]; c >= 0; c = next[c]) {
          let dx = Math.abs(mesh.x[c] - x) % width;
          if (dx > width / 2) dx = width - dx;
          const d = Math.hypot(dx, mesh.y[c] - y);
          if (d >= R) continue;
          const k = 1 - d / R;
          su += u[c] * k;
          sv += v[c] * k;
          sw += k;
        }
      }
    return sw > 0 ? [su / sw, sv / sw] : [0, 0];
  };
}

/**
 * 三角洲的场(以三角洲的大小为单位):> 0 是三角洲上的地,0 是岸,< 0 往外是水下浅滩(越往外越深)。
 * 等值线是半个椭圆:往前长得最远、两边贴回岸上,岸点后面很快收掉;前缘按噪声鼓出几处、边上碎一点
 * (没有直的边:框、横竖的截断都不会在画面上留下直线)
 */
function deltaField(D: Delta, qx: number, qy: number, nz: number, seed: number): number {
  const vx = qx - D.ox;
  const vy = qy - D.oy;
  const a = vx * D.gx + vy * D.gy;
  const c = vy * D.gx - vx * D.gy;
  // 前缘几处鼓出去(几股水道各自的沙嘴)
  const lobe = 0.84 + 0.32 * valueNoise(c / (0.42 * D.len) + 11.3, 0.5, seed + 5);
  const ea = a / (a > 0 ? D.len * lobe : 0.5 * D.len);
  const ec = c / D.half;
  const fine = valueNoise(qx / 0.6, qy / 0.6, seed + 41) - 0.5;
  return 1.2 * (1 - Math.sqrt(ea * ea + ec * ec)) + 0.26 * (nz - 0.5) + 0.08 * fine;
}

/** 场 > -DELTA_FADE(浅滩还没接回原来的海底)的范围:半个椭圆放大 2.3 倍 */
function deltaBox(D: Delta): Box {
  const xs: number[] = [];
  const ys: number[] = [];
  const nx = -D.gy;
  const ny = D.gx;
  const r = 1 + (DELTA_FADE + 0.2) / 1.2;
  for (const a of [-0.5 * r * D.len, 1.16 * r * D.len])
    for (const c of [-r * D.half, r * D.half]) {
      xs.push(D.ox + D.gx * a + nx * c);
      ys.push(D.oy + D.gy * a + ny * c);
    }
  return boxOf(xs, ys, 0.5);
}

/** 三角洲的形状和水道(顶点在河道终点附近,先分两股,再分;f > 500 两股都再分,不然只分一股) */
function deltaOf(m: Pick<Mouth, 'cx' | 'cy' | 'dx' | 'dy' | 'sx' | 'sy' | 'f' | 'rwh' | 'seed'>, rw: number, seaAt: (x: number, y: number) => boolean): Delta {
  const { cx, cy, dx, dy, f, rwh, seed } = m;
  let gx = dx + m.sx;
  let gy = dy + m.sy;
  const gl = Math.hypot(gx, gy);
  gx /= gl;
  gy /= gl;
  const len = DELTA_K * Math.sqrt(f);
  // 主干顺着河道的方向(和画出来的河对得上)走一小段到分叉点,三角洲以分叉点稍往后为中心
  const ax = cx - dx * 1.2 * rw;
  const ay = cy - dy * 1.2 * rw;
  const l0 = 0.12 * len + 1.2 * rw;
  const p1x = ax + dx * l0;
  const p1y = ay + dy * l0;
  const D: Delta = { gx, gy, ox: p1x - gx * 0.2 * len, oy: p1y - gy * 0.2 * len, len, half: 0.9 * len, chans: [], cbox: [0, 0, 0, 0], box: [0, 0, 0, 0] };
  const rnd = (k: number) => valueNoise(k * 3.1 + 0.37, 7.7, seed);
  const rot = (ux: number, uy: number, a: number): [number, number] => [ux * Math.cos(a) - uy * Math.sin(a), ux * Math.sin(a) + uy * Math.cos(a)];
  // 从 (px, py) 顺着方向走,走出三角洲的前缘一点为止
  const exit = (px: number, py: number, ux: number, uy: number): number => {
    let t = 0.3 * len;
    while (t < 2.2 * len && deltaField(D, px + ux * t, py + uy * t, fbm(px + ux * t, py + uy * t, seed), seed) > -0.14) t += 0.25;
    return t;
  };
  // 往 a 角度那边伸,伸出去的头要落在海里(不然是沿着老岸挖一道渠):落在岸上就往正前方收一点再试
  const aim = (px: number, py: number, ux: number, uy: number, a: number): [number, number, number] => {
    for (const k of [1, 0.75, 0.5, 0.25, 0]) {
      const [vx, vy] = rot(ux, uy, a * k);
      const L = exit(px, py, vx, vy);
      if ((seaAt(px + vx * L, py + vy * L) && seaAt(px + vx * L * 0.6, py + vy * L * 0.6)) || k === 0) return [vx, vy, L];
    }
    return [ux, uy, 0];
  };
  const chan = (ax: number, ay: number, bx: number, by: number, t0: number, t1: number, w0: number, w1: number, k: number): Channel => {
    const L = Math.hypot(bx - ax, by - ay);
    const vx = -(by - ay) / L;
    const vy = (bx - ax) / L;
    // 两道弯:sin(πt)、sin(2πt),弯得不一样
    const b1 = (rnd(k) - 0.5) * 0.36 * L;
    const b2 = (rnd(k + 0.5) - 0.5) * 0.2 * L;
    const n = Math.max(6, Math.ceil(L / 0.35));
    const c: Channel = { x: [], y: [], t0, t1, w0, w1 };
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const off = b1 * Math.sin(Math.PI * t) + b2 * Math.sin(2 * Math.PI * t);
      c.x.push(ax + (bx - ax) * t + vx * off);
      c.y.push(ay + (by - ay) * t + vy * off);
    }
    return c;
  };
  D.chans.push(chan(ax, ay, p1x, p1y, 0, 0.3, rwh * 0.8, rwh * 0.75, 1));
  // 两股:朝前缘一左一右,粗细不一样
  const bx = gx;
  const by = gy;
  const one = rnd(9) < 0.5 ? -1 : 1;
  for (const side of [-1, 1]) {
    const [ux, uy, L] = aim(p1x, p1y, bx, by, side * (0.55 + 0.24 * (rnd(side + 3) - 0.5)));
    const w = rwh * (side === one ? 0.72 : 0.58) * (0.9 + 0.2 * rnd(side + 5));
    if (f > 500 || side === one) {
      // 走到一半再分两股(一粗一细)
      const q = 0.45 + 0.15 * rnd(side + 7);
      const p2x = p1x + ux * L * q;
      const p2y = p1y + uy * L * q;
      D.chans.push(chan(p1x, p1y, p2x, p2y, 0.3, 0.3 + 0.7 * q, w, w * 0.95, side + 11));
      for (const s2 of [-1, 1]) {
        const [vx, vy, L2] = aim(p2x, p2y, ux, uy, s2 * (0.32 + 0.2 * (rnd(side * 4 + s2 + 13) - 0.5)));
        const w2 = w * (s2 === side ? 0.8 : 0.65);
        D.chans.push(chan(p2x, p2y, p2x + vx * L2, p2y + vy * L2, 0.3 + 0.7 * q, 1, w2, w2 * 1.45, side * 4 + s2 + 17));
      }
    } else D.chans.push(chan(p1x, p1y, p1x + ux * L, p1y + uy * L, 0.3, 1, w, w * 1.45, side + 21));
  }
  let cb = boxOf(D.chans[0].x, D.chans[0].y, 0);
  for (const c of D.chans) cb = union(cb, boxOf(c.x, c.y, 2.4 * Math.max(c.w0, c.w1)));
  D.cbox = cb;
  return D;
}

/** 补的那一段最高能翻过多高的地(柔化后的粗网格的海拔减掉刻的谷深,米):再高就不补(不在山里挖一道沟) */
const BRIDGE_TOP = 30;

/**
 * 河道终点 (ex, ey) 还在岸上(1 倍主图):往前方左右 60° 里找最近、最好走的岸,补一段弯过去 ——
 * 从终点顺着河的方向出发(二次贝塞尔、弯一弯),到岸上那一点;不直着穿过岬角挖一道渠。
 * 返回补的那几点(不含终点)和到岸时的方向;BRIDGE_MAX 里找不到岸、或者要翻的地太高,返回 null
 */
function bridgeOf(
  ex: number,
  ey: number,
  dx: number,
  dy: number,
  depth: number,
  seed: number,
  waterAt: (x: number, y: number) => number,
  elevAt: (x: number, y: number) => number,
): { x: number[]; y: number[]; ox: number; oy: number } | null {
  type Ray = { L: number; ux: number; uy: number; top: number };
  let best: Ray | null = null;
  let straight: Ray | null = null;
  let bestCost = Infinity;
  let minL = Infinity;
  for (let a = -6; a <= 6; a++) {
    const r = (a * Math.PI) / 18;
    const ux = dx * Math.cos(r) - dy * Math.sin(r);
    const uy = dx * Math.sin(r) + dy * Math.cos(r);
    let L = -1;
    let top = 0;
    for (let t = 0.25; t <= BRIDGE_MAX; t += 0.25) {
      const x = ex + ux * t;
      const y = ey + uy * t;
      if (waterAt(x, y) === 1) {
        L = t;
        break;
      }
      top = Math.max(top, elevAt(x, y));
    }
    if (L < 0) continue;
    if (a === 0) straight = { L, ux, uy, top };
    minL = Math.min(minL, L);
    // 近、直、低的优先
    const cost = L * (1 + 0.6 * Math.abs(r)) + Math.max(0, top - depth) / 15;
    if (cost < bestCost) {
      bestCost = cost;
      best = { L, ux, uy, top };
    }
  }
  // 顺着河的方向不远就到海(大河口外常是三角洲长的地方):照直走;太远(要穿过一道岬角)才弯到近处的岸
  if (straight && straight.L <= 6 && straight.L <= 1.6 * minL && straight.top - depth <= BRIDGE_TOP) best = straight;
  if (!best || best.top - depth > BRIDGE_TOP) return null;
  const { L, ux, uy } = best;
  const tx = ex + ux * L;
  const ty = ey + uy * L;
  const cx = ex + dx * 0.5 * L;
  const cy = ey + dy * 0.5 * L;
  const x: number[] = [];
  const y: number[] = [];
  // 弯一弯(两道弯,大小、朝哪边按这个河口定;两头不挪):画出来的河都是弯的,补的这段不成一条直渠
  const nx = -uy;
  const ny = ux;
  const b1 = (valueNoise(0.37, 1.7, seed) - 0.5) * 0.3 * L;
  const b2 = (valueNoise(3.1, 5.3, seed) - 0.5) * 0.16 * L;
  const n = Math.max(2, Math.ceil(L / 0.5));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const a = (1 - t) * (1 - t);
    const b = 2 * (1 - t) * t;
    const c = t * t;
    const off = b1 * Math.sin(Math.PI * t) + b2 * Math.sin(2 * Math.PI * t);
    x.push(a * ex + b * cx + c * tx + nx * off);
    y.push(a * ey + b * cy + c * ty + ny * off);
  }
  const ol = Math.hypot(tx - cx, ty - cy) || 1;
  return { x, y, ox: (tx - cx) / ol, oy: (ty - cy) / ol };
}

/** 入海的河口(湖不算):水陆按 1 倍主图看,海拔(平不平、海深不深)按柔化后的粗网格看 */
export function mouthsOf(world: World, lines: ValleyLines, whole: Pick<Raster, 'w' | 'h' | 'scale' | 'water'>, base: Float32Array, bw: number, bh: number): Mouth[] {
  const { width, height, riverThreshold: threshold } = world;
  const out: Mouth[] = [];
  const salt = subSeed(world.params.seed, 'estuary');
  const waterAt = (x: number, y: number) => {
    let ix = Math.floor(x * whole.scale) % whole.w;
    if (ix < 0) ix += whole.w;
    const iy = Math.min(whole.h - 1, Math.max(0, Math.floor(y * whole.scale)));
    return whole.water[iy * whole.w + ix];
  };
  const elevAt = (x: number, y: number) => sampleSpline(base, bw, bh, (((x % width) + width) % width) - 0.5, y - 0.5);
  let flow: ReturnType<typeof currentsNear> | null = null;
  for (const d of lines) {
    const i = d.mouth;
    if (i === undefined) continue;
    const n = d.x.length;
    const px = d.x[i];
    const py = d.y[i];
    let dx = d.x[n - 1] - px;
    let dy = d.y[n - 1] - py;
    const L = Math.hypot(dx, dy);
    if (!(L > 0)) continue;
    dx /= L;
    dy /= L;
    // 往海里走,先碰到海还是湖
    let kind = 0;
    for (let t = 0; t <= 12 && !kind; t += 0.5) kind = waterAt(px + dx * t, py + dy * t);
    if (kind !== 1) continue;
    const f = d.f[i];
    // 细得画不出来的小溪不管(写实风放大后也只画流量 ≥ 成河门槛约 0.3 的)
    if (f < 0.3 * threshold) continue;
    const W0 = FUNNEL_K * Math.sqrt(f);
    const Lc = LC_K * W0 + 0.5;
    const Lup = 3 * Lc + 2;
    const seed = (salt ^ Math.imul(Math.round(px * 7), 92821) ^ Math.imul(Math.round(py * 7), 68917)) & 0xffff;
    // 补的那一段刻多深的谷、谷壁多宽(和沿河刻的河谷一样,见 valleys.ts 的 carveValleys)
    const vt = clamp((d.w[i] - 0.5) / 7, 0, 1);
    const vd = 30 + 50 * vt;
    const vw = 2.5 + 1.5 * vt;
    // 轴:岸上那一点往上游 Lup + 6,往下游到河道终点;终点还在岸上(1 倍主图)的,补一段弯到最近的岸(见 bridgeOf),再直着往海里延长 BRIDGE_MAX
    const xs: number[] = [];
    const ys: number[] = [];
    let kEnd = 0;
    let bridge = false;
    const edx = dx;
    const edy = dy;
    {
      let s = 0;
      let j = i;
      const up: [number, number][] = [[d.x[j], d.y[j]]];
      while (j > 0 && s < Lup + 6) {
        s += Math.hypot(d.x[j] - d.x[j - 1], d.y[j] - d.y[j - 1]);
        j--;
        up.push([d.x[j], d.y[j]]);
      }
      up.reverse();
      // 每隔一点取一点就够(加密后约 0.25 一点)
      for (let k = 0; k < up.length; k += up.length - k > 2 ? 2 : 1) {
        xs.push(up[k][0]);
        ys.push(up[k][1]);
      }
      for (let k = i + 2; k < n; k += 2) {
        xs.push(d.x[k]);
        ys.push(d.y[k]);
      }
      if (xs[xs.length - 1] !== d.x[n - 1]) {
        xs.push(d.x[n - 1]);
        ys.push(d.y[n - 1]);
      }
      kEnd = xs.length - 1;
      if (f >= threshold && waterAt(d.x[n - 1], d.y[n - 1]) !== 1) {
        const b = bridgeOf(d.x[n - 1], d.y[n - 1], dx, dy, vd, seed, waterAt, elevAt);
        if (b) {
          bridge = true;
          xs.push(...b.x);
          ys.push(...b.y);
          dx = b.ox;
          dy = b.oy;
        }
      }
      xs.push(xs[xs.length - 1] + dx * BRIDGE_MAX);
      ys.push(ys[ys.length - 1] + dy * BRIDGE_MAX);
    }
    // 沿轴的累计长度;岸点 = 从上游往下第一次碰到海(1 倍主图的水陆)的地方
    const cum = [0];
    for (let k = 1; k < xs.length; k++) cum.push(cum[k - 1] + Math.hypot(xs[k] - xs[k - 1], ys[k] - ys[k - 1]));
    let cAt = -1;
    for (let k = 0; k < xs.length - 1 && cAt < 0; k++) {
      const seg = cum[k + 1] - cum[k];
      for (let t = 0; t < seg; t += 0.25) {
        const u = t / seg;
        if (waterAt(xs[k] + (xs[k + 1] - xs[k]) * u, ys[k] + (ys[k + 1] - ys[k]) * u) === 1) {
          cAt = cum[k] + t;
          break;
        }
      }
    }
    // 河道的终点离岸太远(岸线比河口靠外很多):不硬挖一条长渠
    const endAt = cum[kEnd];
    if (cAt < 0 || cAt > endAt + BRIDGE_MAX + (bridge ? 2 : 0)) continue;
    const as = cum.map((c) => cAt - c);
    let k0 = 0;
    while (k0 < xs.length - 1 && as[k0 + 1] >= 0) k0++;
    const u0 = as[k0] - as[k0 + 1] > 0 ? as[k0] / (as[k0] - as[k0 + 1]) : 0;
    const cx = xs[k0] + (xs[k0 + 1] - xs[k0]) * u0;
    const cy = ys[k0] + (ys[k0 + 1] - ys[k0]) * u0;
    // 岸朝海的方向:岸点周围一圈里海的那一边
    let gx = 0;
    let gy = 0;
    for (let a = 0; a < 24; a++) {
      const ca = Math.cos((a / 24) * 2 * Math.PI);
      const sa = Math.sin((a / 24) * 2 * Math.PI);
      for (const rr of [2, 4, 6])
        if (waterAt(cx + ca * rr, cy + sa * rr) === 1) {
          gx += ca;
          gy += sa;
        }
    }
    const gl = Math.hypot(gx, gy);
    const sx = gl > 0 ? gx / gl : dx;
    const sy = gl > 0 ? gy / gl : dy;
    // 轴的每一段朝不朝海:顺着岸走的一段(和岸朝海的方向差不多垂直)不张开喇叭口,免得沿岸切出一长条浅水
    const al: number[] = [];
    for (let k = 0; k < xs.length; k++) {
      const a = Math.max(0, k - 1);
      const b = Math.min(xs.length - 1, k + 1);
      const ex = xs[b] - xs[a];
      const ey = ys[b] - ys[a];
      const el = Math.hypot(ex, ey) || 1;
      al.push(smoothstep(0.1, 0.5, (ex * sx + ey * sy) / el));
    }
    const flat = elevAt(cx - 3 * sx, cy - 3 * sy) < 40 && elevAt(cx - 7 * sx, cy - 7 * sy) < 100;
    const shallow = elevAt(cx + 5 * sx, cy + 5 * sy) > -250;
    // 河顺着岸流、或者岸是个窄湾(海那一边不到四分之一):不长三角洲
    const open = gl / (24 * 3) > 0.25;
    const isDelta = f >= DELTA_F && flat && shallow && open && sx * dx + sy * dy > 0.4;
    const rw = drawnWidth(f, threshold);
    const rwh = 0.5 * rw * 1.25;
    const m: Mouth = {
      ax: xs,
      ay: ys,
      as,
      al,
      sEnd: cAt - endAt,
      bridge,
      vd,
      vw,
      ex: d.x[n - 1],
      ey: d.y[n - 1],
      edx,
      edy,
      cx,
      cy,
      dx,
      dy,
      sx,
      sy,
      ux: 0,
      uy: 0,
      f,
      w0: W0,
      lc: Lc,
      lup: Lup,
      rwh,
      lp: PLUME_K * Math.sqrt(Math.max(1, f)),
      delta: null,
      fbox: boxOf(xs, ys, Math.max(2 * (rwh + 0.6 * W0) + 1, rwh + 0.1 + vw + 0.5)),
      pbox: [0, 0, 0, 0],
      box: [0, 0, 0, 0],
      seed,
    };
    if (isDelta) m.delta = deltaOf(m, rw, (x, y) => waterAt(x, y) === 1);
    // 浑水往哪边漂:沿岸的洋流(岸外几个单位里的海平均);洋流弱的地方按地转偏向(北半球往右、南半球往左)
    if (f >= threshold) {
      flow ??= currentsNear(world);
      const [cu, cv] = flow(cx + sx * 6, cy + sy * 6, 14);
      const tx = -sy;
      const ty = sx;
      const along = clamp(1.8 * (cu * tx + cv * ty) + (cy < height / 2 ? 0.25 : -0.25), -1, 1);
      m.ux = tx * along;
      m.uy = ty * along;
    }
    // 浑水的框:往前 1.7 倍、往后 0.6 倍、两边 1 倍的椭圆(淡到看不出的地方不画,见 stampEstuaries)+ 顺着岸漂的那一条
    const Lp = m.lp + (m.delta ? 0.8 * m.delta.len : 0);
    const R = PLUME_R * 1.7 * Lp;
    let pb: Box = [cx - R + m.ux * 0.3 * Lp, cy - R + m.uy * 0.3 * Lp, cx + R + m.ux * 0.3 * Lp, cy + R + m.uy * 0.3 * Lp];
    const drift = Math.hypot(m.ux, m.uy);
    if (drift > 0.05) {
      const Lt = Lp * (0.6 + 2 * drift);
      const tx = m.ux / drift;
      const ty = m.uy / drift;
      const ex = cx + tx * Lt + sx * 1.6 * Lp;
      const ey = cy + ty * Lt + sy * 1.6 * Lp;
      pb = union(pb, [Math.min(ex, cx + tx * Lt) - Lp, Math.min(ey, cy + ty * Lt) - Lp, Math.max(ex, cx + tx * Lt) + Lp, Math.max(ey, cy + ty * Lt) + Lp]);
    }
    m.pbox = pb;
    let box = union(m.fbox, pb);
    if (m.delta) {
      m.delta.box = union(m.delta.cbox, deltaBox(m.delta));
      box = union(box, m.delta.box);
    }
    m.box = box;
    out.push(m);
  }
  return out;
}

/** 框(世界单位,已挪过整圈)→ 这一块里的像素范围;没交上返回 null */
function pixelsOf(b: Box, sh: number, S: number, x0: number, y0: number, w: number, h: number): [number, number, number, number] | null {
  const px0 = Math.max(0, Math.floor((b[0] + sh) * S - x0));
  const px1 = Math.min(w - 1, Math.ceil((b[2] + sh) * S - x0));
  const py0 = Math.max(0, Math.floor(b[1] * S - y0));
  const py1 = Math.min(h - 1, Math.ceil(b[3] * S - y0));
  return px0 > px1 || py0 > py1 ? null : [px0, px1, py0, py1];
}

/**
 * 放大现算的一块铺好海拔、水陆之后:按河口改这一块(S 像素 / 世界单位,左上角在 S 倍主图的 (x0, y0))。
 * 有河口的块多几份颜色系数:Raster.plume(浑水)、Raster.rivTint(河水颜色)、Raster.rivCore(其中河道本身的那份)
 */
export function stampEstuaries(out: Raster, mouths: readonly Mouth[], threshold: number, width: number, S: number, x0: number, y0: number): void {
  const { w, h, elev, water, temp, precip, biome, ice, iceConc, wet } = out;
  const mid = (x0 + 0.5 * w) / S;
  let pv: Float32Array | null = null;
  let tv: Float32Array | null = null;
  let cv: Float32Array | null = null;
  const res = new Float64Array(2);
  const toWater = (k: number) => {
    water[k] = 1;
    biome[k] = classifyBiome(temp[k], precip[k], 1, 0);
    wet[k] = 0;
  };
  for (const m of mouths) {
    // 东西相连:挪到离这一块最近的那一圈;像素的坐标减掉 sh 再算(和挪了几圈无关)
    const sh = Math.round((mid - m.cx) / width) * width;
    if (!pixelsOf(m.box, sh, S, x0, y0, w, h)) continue;
    pv ??= new Float32Array(w * h);
    tv ??= new Float32Array(w * h);
    cv ??= new Float32Array(w * h);
    const { f, cx: Cx, cy: Cy, seed } = m;
    const small = f < threshold;
    const D = m.delta;

    // 1. 三角洲:扇面里的浅海长成低地,外面一圈水下浅滩;水道从顶点分叉入海
    if (D) {
      const pr = pixelsOf(D.box, sh, S, x0, y0, w, h);
      const cb = D.cbox;
      if (pr)
        for (let py = pr[2]; py <= pr[3]; py++) {
          const qy = (y0 + py + 0.5) / S;
          for (let px = pr[0]; px <= pr[1]; px++) {
            const qx = (x0 + px + 0.5) / S - sh;
            const k = py * w + px;
            const nz = fbm(qx, qy, seed);
            const F = deltaField(D, qx, qy, nz, seed);
            if (F < -DELTA_FADE) continue;
            if (water[k] === 1) {
              if (F > 0) {
                // 三角洲上的地:贴着海面(过 0 处就是岸,两边的海拔连着);是湿地(见 gen/wetland.ts),按多两成的雨水上色(稍绿)
                elev[k] = Math.min(2.5, 3 * F);
                water[k] = 0;
                ice[k] = 0;
                iceConc[k] = 0;
                precip[k] *= 1.2;
                // 冷到冰原的地方不是湿地(和铺像素时一样)
                const frozen = temp[k] < LAND_ICE_BELOW;
                wet[k] = frozen ? 0 : DELTA_WET;
                biome[k] = frozen ? classifyBiome(temp[k], precip[k], 0, 0) : Biome.Wetland;
              } else {
                // 水下浅滩:越近越浅,往外慢慢接回原来的海底(浅水那几米颜色变得最快,坡要缓)
                const t = -F;
                const sh0 = -45 * Math.pow(t, 1.7);
                const e1 = sh0 + (elev[k] - sh0) * smoothstep(0.5, DELTA_FADE, t);
                if (e1 > elev[k]) elev[k] = e1;
              }
            } else if (water[k] === 0 && F > -0.2) {
              // 原来岸上挨着三角洲的低地也压平、变湿一点,和新长出来的地接上(不留一道旧岸线)
              const wv = smoothstep(-0.2, 0.5, F) * (1 - smoothstep(5, 10, elev[k]));
              if (wv > 0) {
                const e0 = Math.max(0.3, Math.min(2.5, 3 * F));
                if (elev[k] > e0) elev[k] += (e0 - elev[k]) * wv;
                precip[k] *= 1 + 0.2 * wv;
                const dw = temp[k] < LAND_ICE_BELOW ? 0 : Math.round(DELTA_WET * wv);
                if (dw > wet[k]) wet[k] = dw;
                biome[k] = wet[k] >= WET_BYTE ? Biome.Wetland : classifyBiome(temp[k], precip[k], 0, 0);
              }
            }
            if (F < -0.35 || qx < cb[0] || qx > cb[2] || qy < cb[1] || qy > cb[3]) continue;
            // 水道:只在三角洲上和岸边的低地上切;切出来的河床两边的海拔连着(半宽处过 0)
            let tt = 0;
            let pp = 0;
            // 水道宽窄只随大尺度的噪声慢慢变(细噪声会让水道一节一节的)
            const wn = 0.85 + 0.3 * valueNoise(qx / 2.6, qy / 2.6, seed);
            const land0 = water[k] === 0;
            const outK = land0 ? 1 : smoothstep(-0.2, 0, F);
            for (const c of D.chans) {
              nearest(c, qx, qy, res);
              const u = res[1] / (c.x.length - 1);
              const t = c.t0 + (c.t1 - c.t0) * u;
              const hw = (c.w0 + (c.w1 - c.w0) * smoothstep(0.6, 1, u)) * wn;
              const dd = res[0];
              if (dd > 2.2 * hw) continue;
              // 只在地上切(出了前缘交给浑水,不在浅滩里留一截圆头的深槽)
              if (land0 && dd < 1.5 * hw && elev[k] < HMAX + 6) {
                const ec = 2.5 * ((dd / hw) ** 2 - 1);
                if (ec < elev[k]) {
                  elev[k] = ec;
                  if (ec < 0 && water[k] === 0) toWater(k);
                }
              }
              // 水道里一直到边上都是河水的颜色(边上的水很浅,淡下来会描出一圈亮边);出了前缘很快淡掉
              if (dd < 1.2 * hw) tt = Math.max(tt, (1 - 0.6 * smoothstep(0.7, 1, t)) * outK);
              pp = Math.max(pp, (0.4 + 0.6 * smoothstep(0.4, 1, t)) * (1 - smoothstep(hw, 2.2 * hw, dd)));
            }
            if (tt > tv[k]) tv[k] = tt;
            if (tt > cv[k]) cv[k] = tt;
            if (pp > pv[k]) pv[k] = pp;
          }
        }
    }

    // 2. 喇叭口(岸点往上游越来越窄)+ 河道一定通到海;喇叭口里越往上游越是河水的颜色
    const pr = pixelsOf(m.fbox, sh, S, x0, y0, w, h);
    if (pr) {
      const ax: Line = { x: m.ax, y: m.ay };
      const { w0: W0, lc: Lc, lup: Lup, rwh } = m;
      const core = rwh + 0.1;
      // 河床切到哪:补了一段的切到河道终点再往上一点,别的只切岸边一小段
      const sLim = m.bridge ? Math.max(0.6 * Lc, m.sEnd + 0.8) : 0.6 * Lc;
      for (let py = pr[2]; py <= pr[3]; py++) {
        const qy = (y0 + py + 0.5) / S;
        for (let px = pr[0]; px <= pr[1]; px++) {
          const qx = (x0 + px + 0.5) / S - sh;
          const k = py * w + px;
          nearest(ax, qx, qy, res);
          const s = at(m.as, res[1]);
          // 补了一段的:河谷过了河道终点往上游 3 个单位慢慢收回原来的深浅(收得太急会横着一道陡坎)
          const vTop = m.bridge ? m.sEnd + 4 : -Infinity;
          if (s >= Math.max(Lup, vTop) || s <= -4) continue;
          const dist = res[0];
          const nz = fbm(qx, qy, seed);
          const flare = D ? 0 : 0.5 * W0 * at(m.al, res[1]);
          const hw = (rwh + flare * Math.exp(-Math.max(0, s) / Lc)) * (0.8 + 0.4 * nz);
          // 往海里那头:三角洲上由水道接着走(不再直着切一道),别的切到岸外 3–4 个单位
          const ends = D ? smoothstep(-0.8, 0, s) : smoothstep(-4, -3, s);
          // 补的那一段(河道终点到岸,见 bridgeOf):接着刻河谷、河床一定切到海
          const gap = m.bridge ? (1 - smoothstep(m.sEnd + 0.5, m.sEnd + 1.1, s)) * ends : 0;
          // (往上游多远按终点处河的方向量,不按 s:离轴远的地方,弯道内侧的 s 会跳,收的地方就成了一道折线)
          const gv = m.bridge ? (1 - smoothstep(0, 3, -((qx - m.ex) * m.edx + (qy - m.ey) * m.edy))) * ends : 0;
          if (dist > 1.6 * hw && dist > (gv > 0 ? core + m.vw : 1.2 * core)) continue;
          if (water[k] === 0) {
            let e = elev[k];
            // 河谷:和沿河刻的一样深、谷壁一样宽(谷底留几米高,不贴着海面)
            const v = gv > 0 ? (1 - smoothstep(core, core + m.vw, dist)) * gv : 0;
            if (v > 0 && e > 4) e = Math.max(4, e - m.vd * v);
            const lim = HMAX * (s > 0 ? 1 - 0.6 * (s / Lup) : 1.6);
            // 喇叭口:离轴越近、地越低切得越深,边上慢慢收(海拔连着,不出一道直坎)
            const a1 = (1 - smoothstep(0.8 * hw, 1.2 * hw, dist)) * (1 - smoothstep(0.7 * lim, lim, e)) * ends * (1 - smoothstep(0.85 * Lup, Lup, s));
            // 河床:补的那一段一定切;再往上游(画出来的河底下)只切不太高的地
            const a2 = (1 - smoothstep(0.8 * core, 1.2 * core, dist)) * (1 - smoothstep(sLim - 0.3, sLim + 0.3, s)) * Math.max(gap, 1 - smoothstep(2.5 * HMAX, 4 * HMAX, e)) * ends;
            const a = Math.max(a1, a2);
            if (a > 0) {
              const dep = 0.6 + (small ? 1.2 : 4.5) * Math.max(0, 1 - (dist / hw) ** 2);
              e += (-dep - e) * a;
              if (e < 0) toWater(k);
            }
            elev[k] = e;
          }
          if (D) {
            // 三角洲:到岸点都是河水的颜色,往后交给水道
            const tt = (1 - smoothstep(1.2 * hw, 1.8 * hw, dist)) * smoothstep(-0.8, 0, s);
            if (tt > tv[k]) tv[k] = tt;
            if (tt > cv[k]) cv[k] = tt;
          } else if (s > -1) {
            // 越往上游越是河水的颜色;岸外那一段很快淡掉(交给浑水),不留一条直杠
            const band = (1 - smoothstep(0.7 * hw, 1.6 * hw, dist)) * smoothstep(-1, 0.5, s);
            let tt = band * smoothstep(0.05 * Lup, 0.85 * Lup, s);
            // 补的那一段一直是河水的颜色,到岸边才淡开(接头处不出一个圆头,也不成一条浅色的渠)
            if (m.bridge) {
              const tc = (1 - smoothstep(0.8 * core, 1.3 * core, dist)) * smoothstep(-0.5, Math.min(1.5, m.sEnd), s);
              if (tc > cv[k]) cv[k] = tc;
              tt = Math.max(tt, tc);
            }
            if (tt > tv[k]) tv[k] = tt;
            const pp = band * (1 - smoothstep(0.3 * Lup, Lup, s));
            if (pp > pv[k]) pv[k] = pp;
          }
        }
      }
    }

    // 3. 河口外的浑水(只看水面):顺着河口方向散开,鼓起的一团被洋流推着偏一点,再顺着岸漂出一条;云絮一样不匀
    if (PLUME_A > 0) {
      const pq = pixelsOf(m.pbox, sh, S, x0, y0, w, h);
      if (pq) {
        // 小河的浑水淡、小
        const amp = Math.sqrt(smoothstep(0.3 * threshold, 8 * threshold, f));
        let ddx = m.dx;
        let ddy = m.dy;
        if (D) {
          ddx = D.gx;
          ddy = D.gy;
        }
        const Lp = m.lp + (D ? 0.8 * D.len : 0);
        const bx = Cx + m.ux * 0.3 * Lp;
        const by = Cy + m.uy * 0.3 * Lp;
        const drift = Math.hypot(m.ux, m.uy);
        const tx = drift > 0 ? m.ux / drift : 0;
        const ty = drift > 0 ? m.uy / drift : 0;
        const Lt = Lp * (0.6 + 2 * drift);
        const tailA = drift > 0.05 ? 0.75 * Math.sqrt(drift) : 0;
        for (let py = pq[2]; py <= pq[3]; py++) {
          const qy = (y0 + py + 0.5) / S;
          for (let px = pq[0]; px <= pq[1]; px++) {
            const k = py * w + px;
            if (water[k] !== 1) continue;
            const qx = (x0 + px + 0.5) / S - sh;
            // 鼓起的一团:往前拉长、往后收(前方按 1.7 倍算远近,岸后面按 0.6 倍)
            const vx = qx - bx;
            const vy = qy - by;
            const along = vx * ddx + vy * ddy;
            const across = vy * ddx - vx * ddy;
            const fa = along > 0 ? along / 1.7 : along / 0.6;
            const rr = (fa * fa + across * across) / (Lp * Lp);
            let p = rr < PLUME_R * PLUME_R ? Math.exp(-2.5 * rr) : 0;
            // 顺着岸漂出去的一条:贴着岸、越漂越宽越淡
            if (tailA > 0) {
              const wx = qx - Cx;
              const wy = qy - Cy;
              const at2 = wx * tx + wy * ty;
              if (at2 > -0.5 * Lp && at2 < Lt) {
                const an = wx * m.sx + wy * m.sy - 0.35 * Lp;
                const wt = 0.45 * Lp * (1 + (0.6 * Math.max(0, at2)) / Lt);
                const q = (an / wt) ** 2;
                if (q < 5) p = Math.max(p, tailA * smoothstep(-0.5 * Lp, 0.3 * Lp, at2) * (1 - smoothstep(0.35 * Lt, Lt, at2)) * Math.exp(-q));
              }
            }
            if (p < 0.01) continue;
            const nz = 0.6 * valueNoise(qx / 2.6, qy / 2.6, seed) + 0.4 * valueNoise(qx / 1.15, qy / 1.15, seed + 17);
            const pp = Math.min(1, p * (0.65 + 0.6 * nz) * amp);
            if (pp > pv[k]) pv[k] = pp;
          }
        }
      }
    }
  }
  if (!pv || !tv || !cv) return;
  const plume = new Uint8Array(w * h);
  const tint = new Uint8Array(w * h);
  const chan = new Uint8Array(w * h);
  for (let k = 0; k < w * h; k++) {
    plume[k] = Math.round(255 * Math.min(1, pv[k] * PLUME_A));
    tint[k] = Math.round(255 * Math.min(1, tv[k]));
    chan[k] = Math.round(255 * Math.min(1, cv[k]));
  }
  out.plume = plume;
  out.rivTint = tint;
  out.rivCore = chan;
}

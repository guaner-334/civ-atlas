/**
 * 等值线:等高线 / 等温线 / 等降水线 —— 叠在任意图层上的一层细线,粗的那几条线上写数值。
 *
 * 算:栅格(海拔、年均温、年降水)按 2×2 取平均、再抹平几遍(气温、降水抹得多,线是概括的),
 * 用"行进方格"在每个等级上找出线段、连成折线(东西相连:最右一列和最左一列也连),再按 Chaikin 磨圆一遍。
 * 坐标是世界坐标(和主图一样,x 可能略超出 [0, 宽] —— 跨过 180° 经线的线不断开)。
 * 画:先把线换成画布像素(等距圆柱按整圈平移,弯边投影逐点投影),字固定大小、正立,躲开地名和界面;字压着的那一小段线留空。
 */
import type { Raster } from '../gen/raster';
import type { ContourKind } from '../gen/savefile';
import { clipOutline, projectLinePts, projector, type MapProj } from './projection';

export type { ContourKind };
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface ContourLine {
  level: number;
  /** 粗线(写数值的那几条) */
  major: boolean;
  /** 世界坐标 x0, y0, x1, y1, … */
  pts: Float32Array;
  /** 外接框(世界坐标) */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface ContourSet {
  kind: ContourKind;
  lines: ContourLine[];
  /** 世界宽(东西相连时挪整圈用) */
  W: number;
}

/** 各种线的等级:细线隔多少、哪几条算粗线 */
export const CONTOUR_SPEC: Record<ContourKind, { name: string; levels: number[]; major: (v: number) => boolean; fmt: (v: number) => string; unit: string }> = {
  elev: {
    name: '等高线',
    levels: range(250, 9000, 250),
    major: (v) => v % 1000 === 0,
    fmt: (v) => String(v),
    unit: '米',
  },
  temp: {
    name: '等温线',
    levels: range(-45, 40, 5),
    major: (v) => v % 10 === 0,
    fmt: (v) => `${v}°`,
    unit: '°C',
  },
  precip: {
    name: '等降水线',
    levels: [100, 250, 500, 750, 1000, 1500, 2000, 3000, 4000],
    major: (v) => v === 250 || v === 500 || v === 1000 || v === 2000 || v === 3000 || v === 4000,
    fmt: (v) => String(v),
    unit: '毫米',
  },
};

function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  for (let v = a; v <= b; v += step) out.push(v);
  return out;
}

/** 2×2 平均成网格,再 3×3 抹平 passes 遍(东西相连) */
function gridField(r: Raster, kind: ContourKind): { f: Float32Array; sea: Uint8Array; gw: number; gh: number } {
  const G = 2;
  const gw = Math.floor(r.w / G);
  const gh = Math.floor(r.h / G);
  const src = kind === 'elev' ? r.elev : kind === 'temp' ? r.temp : r.precip;
  let f = new Float32Array(gw * gh);
  const sea = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let s = 0;
      let n = 0;
      for (let dy = 0; dy < G; dy++)
        for (let dx = 0; dx < G; dx++) {
          const k = (gy * G + dy) * r.w + gx * G + dx;
          if (r.water[k] === 1) n++;
          // 等高线只画陆地:海面压到 0 以下(湖面是水面高度,照常)
          s += kind === 'elev' && r.water[k] === 1 ? -200 : src[k];
        }
      f[gy * gw + gx] = s / (G * G);
      sea[gy * gw + gx] = n * 2 > G * G ? 1 : 0;
    }
  const passes = kind === 'elev' ? 1 : kind === 'temp' ? 4 : 3;
  let tmp = new Float32Array(gw * gh);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < gh; y++) {
      const ya = Math.max(0, y - 1);
      const yb = Math.min(gh - 1, y + 1);
      for (let x = 0; x < gw; x++) {
        const xa = (x + gw - 1) % gw;
        const xb = (x + 1) % gw;
        tmp[y * gw + x] =
          (f[ya * gw + xa] + 2 * f[ya * gw + x] + f[ya * gw + xb] + 2 * f[y * gw + xa] + 4 * f[y * gw + x] + 2 * f[y * gw + xb] + f[yb * gw + xa] + 2 * f[yb * gw + x] + f[yb * gw + xb]) / 16;
      }
    }
    [f, tmp] = [tmp, f];
  }
  return { f, sea, gw, gh };
}

// 方格的四条边:0 上、1 右、2 下、3 左。每种情况(角上 ≥ 等级的:8 左上、4 右上、2 右下、1 左下)连哪两条边
const CASES: number[][] = [[], [3, 2], [2, 1], [3, 1], [0, 1], [], [0, 2], [3, 0], [3, 0], [0, 2], [], [0, 1], [3, 1], [2, 1], [3, 2], []];
// 鞍点(对角两个角高):按方格中心高不高决定怎么连
const SADDLE_A = [3, 0, 2, 1];
const SADDLE_B = [0, 1, 3, 2];

/** 算一种等值线(整颗星球) */
export function computeContours(r: Raster, kind: ContourKind, worldW: number): ContourSet {
  const spec = CONTOUR_SPEC[kind];
  const { f, sea, gw, gh } = gridField(r, kind);
  const toWorld = (2 / r.scale) as number;
  const half = 1; // 2×2 一格的中心
  const nE = 2 * gw * gh;
  const e0 = new Int32Array(nE).fill(-1);
  const e1 = new Int32Array(nE).fill(-1);
  const lines: ContourLine[] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < f.length; i++) {
    if (f[i] < lo) lo = f[i];
    if (f[i] > hi) hi = f[i];
  }
  // 一遍扫完所有方格:每格只看四个角的最低、最高之间夹着哪几个等级(大多数格子一个都没有)
  const levels = spec.levels.filter((L) => L > lo && L < hi);
  const nl = levels.length;
  const segs: number[][] = levels.map(() => []);
  for (let y = 0; y + 1 < gh; y++)
    for (let x = 0; x < gw; x++) {
      const x1 = x + 1 === gw ? 0 : x + 1;
      const a = f[y * gw + x];
      const b = f[y * gw + x1];
      const c = f[(y + 1) * gw + x1];
      const d = f[(y + 1) * gw + x];
      const mn = Math.min(a, b, c, d);
      const mx = Math.max(a, b, c, d);
      // 第一个 > mn 的等级
      let li = 0;
      let hiI = nl;
      while (li < hiI) {
        const m = (li + hiI) >> 1;
        if (levels[m] > mn) hiI = m;
        else li = m + 1;
      }
      for (; li < nl && levels[li] <= mx; li++) {
        const L = levels[li];
        const idx = (a >= L ? 8 : 0) | (b >= L ? 4 : 0) | (c >= L ? 2 : 0) | (d >= L ? 1 : 0);
        let pairs: number[];
        if (idx === 5 || idx === 10) {
          const centerHigh = (a + b + c + d) / 4 >= L;
          // 5:右上、左下高;10:左上、右下高
          pairs = (idx === 5) === centerHigh ? SADDLE_A : SADDLE_B;
        } else pairs = CASES[idx];
        const out = segs[li];
        for (let p = 0; p < pairs.length; p++) {
          const k = pairs[p];
          out.push(k === 0 ? 2 * (y * gw + x) : k === 1 ? 2 * (y * gw + x1) + 1 : k === 2 ? 2 * ((y + 1) * gw + x) : 2 * (y * gw + x) + 1);
        }
      }
    }
  for (let li = 0; li < nl; li++) {
    const L = levels[li];
    const flat = segs[li];
    const ns = flat.length / 2;
    const touched: number[] = [];
    for (let sI = 0; sI < ns; sI++)
      for (let q = 0; q < 2; q++) {
        const e = flat[2 * sI + q];
        if (e0[e] < 0) {
          e0[e] = sI;
          touched.push(e);
        } else e1[e] = sI;
      }
    const segA = (i: number) => flat[2 * i];
    const segB = (i: number) => flat[2 * i + 1];
    // 边上的点(网格坐标)
    const pt = (e: number): [number, number] => {
      const cell = e >> 1;
      const x = cell % gw;
      const y = (cell - x) / gw;
      const v0 = f[cell];
      if ((e & 1) === 0) {
        const v1 = f[y * gw + ((x + 1) % gw)];
        return [x + (L - v0) / (v1 - v0), y];
      }
      const v1 = f[cell + gw];
      return [x, y + (L - v0) / (v1 - v0)];
    };
    const used = new Uint8Array(ns);
    const other = (e: number, s: number) => (e0[e] === s ? e1[e] : e0[e]);
    for (let s0 = 0; s0 < ns; s0++) {
      if (used[s0]) continue;
      used[s0] = 1;
      // 往两头接
      // 往两头接:先往 B 那头接,再往 A 那头接(倒着放,最后拼起来)
      const fwd: number[] = [segA(s0), segB(s0)];
      const back: number[] = [];
      for (const dir of [1, -1]) {
        let e = dir === 1 ? segB(s0) : segA(s0);
        let s = s0;
        const out = dir === 1 ? fwd : back;
        for (;;) {
          const n = other(e, s);
          if (n < 0 || used[n]) break;
          used[n] = 1;
          const ne = segA(n) === e ? segB(n) : segA(n);
          out.push(ne);
          e = ne;
          s = n;
        }
      }
      const chain = back.length ? back.reverse().concat(fwd) : fwd;
      if (chain.length < (kind === 'elev' ? 6 : 10)) continue;
      // 等降水线只画陆地上的那几段(两头各伸出一点到海岸)
      const ring = chain[0] === chain[chain.length - 1];
      const runs: number[][] = [];
      if (kind === 'precip') {
        const wet = chain.map((e) => {
          const cell = e >> 1;
          const nb = (e & 1) === 0 ? cell - (cell % gw) + (((cell % gw) + 1) % gw) : cell + gw;
          return sea[cell] === 1 && sea[nb] === 1;
        });
        let cur: number[] = [];
        for (let i = 0; i < chain.length; i++) {
          if (!wet[i] || (i > 0 && !wet[i - 1]) || (i + 1 < chain.length && !wet[i + 1])) cur.push(chain[i]);
          else if (cur.length) {
            runs.push(cur);
            cur = [];
          }
        }
        if (cur.length) runs.push(cur);
      } else runs.push(chain);
      for (const run of runs) {
        if (run.length < (kind === 'elev' ? 6 : 8)) continue;
        // 网格坐标 → 世界坐标,x 接着上一个点(跨过 180° 经线不跳)
        let pts: number[] = [];
        let px = 0;
        for (let i = 0; i < run.length; i++) {
          let [gx, gy] = pt(run[i]);
          if (i > 0) {
            while (gx - px > gw / 2) gx -= gw;
            while (px - gx > gw / 2) gx += gw;
          }
          px = gx;
          pts.push((gx + half / 2) * toWorld, (gy + half / 2) * toWorld);
        }
        // 绕星球一整圈的线首尾差一圈,不算闭合
        const closed = ring && run.length === chain.length && Math.abs(pts[0] - pts[pts.length - 2]) < 1e-3;
        pts = chaikin(pts, closed);
        let x0 = Infinity;
        let x1 = -Infinity;
        let y0 = Infinity;
        let y1 = -Infinity;
        for (let i = 0; i < pts.length; i += 2) {
          x0 = Math.min(x0, pts[i]);
          x1 = Math.max(x1, pts[i]);
          y0 = Math.min(y0, pts[i + 1]);
          y1 = Math.max(y1, pts[i + 1]);
        }
        lines.push({ level: L, major: spec.major(L), pts: new Float32Array(pts), x0, x1, y0, y1 });
      }
    }
    for (const e of touched) e0[e] = e1[e] = -1;
  }
  return { kind, lines, W: worldW };
}

/** 磨圆一遍(每段取 1/4、3/4 处) */
function chaikin(p: number[], closed: boolean): number[] {
  const n = p.length / 2;
  if (n < 3) return p;
  const out: number[] = closed ? [] : [p[0], p[1]];
  const m = closed ? n - 1 : n - 1;
  for (let i = 0; i < m; i++) {
    const ax = p[2 * i];
    const ay = p[2 * i + 1];
    const bx = p[2 * i + 2];
    const by = p[2 * i + 3];
    out.push(0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by, 0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by);
  }
  if (closed) out.push(out[0], out[1]);
  else out.push(p[2 * n - 2], p[2 * n - 1]);
  return out;
}

/** 线和字的颜色:按底下是哪种画风 */
const INK: Record<string, Record<ContourKind, { line: string; text: string; halo: string }>> = {
  fantasy: {
    elev: { line: 'rgba(132,84,44,0.85)', text: 'rgb(112,70,36)', halo: 'rgba(244,238,224,0.9)' },
    temp: { line: 'rgba(178,48,40,0.75)', text: 'rgb(160,40,34)', halo: 'rgba(244,238,224,0.9)' },
    precip: { line: 'rgba(34,92,170,0.75)', text: 'rgb(28,78,150)', halo: 'rgba(244,238,224,0.9)' },
  },
  data: {
    elev: { line: 'rgba(28,28,32,0.55)', text: 'rgb(24,24,28)', halo: 'rgba(255,255,255,0.85)' },
    temp: { line: 'rgba(28,28,32,0.55)', text: 'rgb(24,24,28)', halo: 'rgba(255,255,255,0.85)' },
    precip: { line: 'rgba(28,28,32,0.55)', text: 'rgb(24,24,28)', halo: 'rgba(255,255,255,0.85)' },
  },
  realistic: {
    elev: { line: 'rgba(255,236,210,0.62)', text: 'rgb(255,244,228)', halo: 'rgba(20,24,30,0.75)' },
    temp: { line: 'rgba(255,170,150,0.8)', text: 'rgb(255,214,204)', halo: 'rgba(20,24,30,0.75)' },
    precip: { line: 'rgba(160,210,255,0.8)', text: 'rgb(214,236,255)', halo: 'rgba(20,24,30,0.75)' },
  },
};

/** 线的颜色(图例上的线样用同一套) */
export function contourInk(kind: ContourKind, style: string, dark = false): { line: string; text: string; halo: string } {
  if (style === 'data' && dark) return INK.realistic[kind];
  return (INK[style] ?? INK.data)[kind];
}

/** 放大倍数 k 时画不画这一级:等高线放大到 3 倍以上才画 250 米一条,平常 500 米 */
export function contourShown(kind: ContourKind, level: number, k: number): boolean {
  if (kind === 'elev') return k >= 3 || level % 500 === 0;
  return true;
}

/** 图例上的一句说明(放大倍数 k 时的间隔) */
export function contourNote(kind: ContourKind, k: number): string {
  if (kind === 'elev') return k >= 3 ? '等高线(米):细线每 250 米,粗线每 1000 米写数字' : '等高线(米):细线每 500 米,粗线每 1000 米写数字';
  if (kind === 'temp') return '等温线(°C):每 5°C 一条,每 10°C 写数字';
  return '等降水线(毫米):100 到 3000 不等距,粗线写数字';
}

export interface ContourView {
  /** null = 等距圆柱:世界坐标 × s + (ox, oy) = 画布像素;弯边投影:地图平面坐标 × s + (ox, oy) */
  mp: MapProj | null;
  s: number;
  ox: number;
  oy: number;
}

/** 画布像素的折线 */
interface ScreenLine {
  major: boolean;
  level: number;
  pts: ArrayLike<number>;
}

/** 线换成画布像素(只留和画布挨得着的) */
function screenLines(set: ContourSet, v: ContourView, k: number, cw: number, ch: number): ScreenLine[] {
  const out: ScreenLine[] = [];
  if (!v.mp) {
    const W = set.W;
    const vx0 = -v.ox / v.s;
    const vx1 = (cw - v.ox) / v.s;
    const vy0 = -v.oy / v.s;
    const vy1 = (ch - v.oy) / v.s;
    for (const l of set.lines) {
      if (!contourShown(set.kind, l.level, k) || l.y1 < vy0 || l.y0 > vy1) continue;
      for (let n = Math.floor((vx0 - l.x1) / W); n * W + l.x0 <= vx1; n++) {
        if (n * W + l.x1 < vx0) continue;
        const dx = n * W;
        const p = l.pts;
        const q = new Float32Array(p.length);
        for (let i = 0; i < p.length; i += 2) {
          q[i] = (p[i] + dx) * v.s + v.ox;
          q[i + 1] = p[i + 1] * v.s + v.oy;
        }
        out.push({ major: l.major, level: l.level, pts: q });
      }
    }
    return out;
  }
  const pj = projector(v.mp);
  for (const l of set.lines) {
    if (!contourShown(set.kind, l.level, k)) continue;
    for (const q of projectLinePts(l.pts, 2, pj, v)) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < q.length; i += 2) {
        if (q[i] < x0) x0 = q[i];
        if (q[i] > x1) x1 = q[i];
        if (q[i + 1] < y0) y0 = q[i + 1];
        if (q[i + 1] > y1) y1 = q[i + 1];
      }
      if (x1 < 0 || x0 > cw || y1 < 0 || y0 > ch) continue;
      out.push({ major: l.major, level: l.level, pts: q });
    }
  }
  return out;
}

/** 字的位置(画布像素):中心、角度、宽 */
interface LabelSpot {
  x: number;
  y: number;
  a: number;
  w: number;
  text: string;
}

/**
 * 画在画布上:lw = 1 个 CSS 像素是几个画布像素,k = 放大倍数,dark = 底色深(数据图层里的高程、降水;线换浅色)。
 * avoid:字要躲开的框(画布像素 [左, 上, 右, 下]:地名、城镇符号、浮在地图上的界面)
 */
export function drawContours(ctx: Ctx2D, set: ContourSet, style: string, v: ContourView, lw: number, k: number, dark = false, avoid: readonly (readonly number[])[] = []): void {
  const spec = CONTOUR_SPEC[set.kind];
  const ink = contourInk(set.kind, style, dark);
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const lines = screenLines(set, v, k, cw, ch);
  const font = 10.5 * lw;
  ctx.save();
  if (v.mp) clipOutline(ctx, v.mp, v);
  ctx.font = `500 ${font}px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 先挑字的位置:粗线上每隔 GAP 像素一个,要一段够直的地方;字和字不挤在一起,不压地名和界面
  const GAP = 320 * lw;
  const MIN_APART = 90 * lw;
  const labels: LabelSpot[] = [];
  const hh = font * 0.62;
  const free = (x: number, y: number, hw: number) => {
    const r = Math.max(hw, hh) + 2 * lw;
    for (const b of avoid) if (x + r > b[0] && x - r < b[2] && y + r > b[1] && y - r < b[3]) return false;
    for (const t of labels) if (Math.hypot(t.x - x, t.y - y) < MIN_APART) return false;
    return true;
  };
  for (const l of lines) {
    if (!l.major) continue;
    const text = spec.fmt(l.level);
    const tw = ctx.measureText(text).width + 6 * lw;
    const p = l.pts;
    let acc = GAP * 0.45;
    for (let i = 2; i < p.length; i += 2) {
      const bx = p[i];
      const by = p[i + 1];
      acc += Math.hypot(bx - p[i - 2], by - p[i - 1]);
      if (acc < GAP) continue;
      if (bx < 20 * lw || bx > cw - 20 * lw || by < 20 * lw || by > ch - 20 * lw) continue;
      // 往前后各找半个字宽,看这段直不直
      const span = (dir: number): [number, number] | null => {
        let d = 0;
        let j = i;
        let qx = bx;
        let qy = by;
        while (d < tw / 2) {
          j += 2 * dir;
          if (j < 0 || j >= p.length) return null;
          d += Math.hypot(p[j] - qx, p[j + 1] - qy);
          qx = p[j];
          qy = p[j + 1];
        }
        return [qx, qy];
      };
      const s0 = span(-1);
      const s1 = span(1);
      if (!s0 || !s1) continue;
      if (Math.hypot(s1[0] - s0[0], s1[1] - s0[1]) < tw * 0.92) continue;
      const cx = (s0[0] + s1[0]) / 2;
      const cy = (s0[1] + s1[1]) / 2;
      if (!free(cx, cy, tw / 2)) continue;
      let a = Math.atan2(s1[1] - s0[1], s1[0] - s0[0]);
      if (a > Math.PI / 2) a -= Math.PI;
      if (a < -Math.PI / 2) a += Math.PI;
      labels.push({ x: cx, y: cy, a, text, w: tw });
      acc = 0;
    }
  }
  // 字压着的那段线留空:整张画布减去字框
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, cw, ch);
  for (const lb of labels) {
    const c = Math.cos(lb.a);
    const sn = Math.sin(lb.a);
    const hw = lb.w / 2;
    const corner = (u: number, w: number) => [lb.x + u * c - w * sn, lb.y + u * sn + w * c];
    const q = [corner(-hw, -hh), corner(hw, -hh), corner(hw, hh), corner(-hw, hh)];
    ctx.moveTo(q[0][0], q[0][1]);
    for (let j = 1; j < 4; j++) ctx.lineTo(q[j][0], q[j][1]);
    ctx.closePath();
  }
  ctx.clip('evenodd');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ink.line;
  for (const major of [false, true]) {
    ctx.beginPath();
    for (const l of lines) {
      if (l.major !== major) continue;
      const p = l.pts;
      ctx.moveTo(p[0], p[1]);
      for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    }
    ctx.lineWidth = (major ? 1.4 : 0.85) * lw;
    ctx.stroke();
  }
  ctx.restore();
  // 字
  ctx.lineJoin = 'round';
  for (const lb of labels) {
    ctx.save();
    ctx.translate(lb.x, lb.y);
    ctx.rotate(lb.a);
    ctx.strokeStyle = ink.halo;
    ctx.lineWidth = 2.6 * lw;
    ctx.strokeText(lb.text, 0, 0);
    ctx.fillStyle = ink.text;
    ctx.fillText(lb.text, 0, 0);
    ctx.restore();
  }
  ctx.restore();
}

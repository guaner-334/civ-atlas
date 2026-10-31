/**
 * 河网几何(riverGeometry):画河(render/common.ts)和刻河谷(valleys.ts)用同一套,谷底正好在画出来的河下面。
 * 纯计算:不碰页面,worker / Node 都能跑。
 */
import { nearX } from './util';

/** 河宽随流量怎么变(河网几何按它算每点线宽;画河另有颜色、细节层级,见 render/common.ts 的 RiverStyle) */
export interface RiverWidth {
  /** 最细的河宽(世界单位) */
  minW: number;
  /** 最粗的河宽(世界单位) */
  maxW: number;
  fluxRef: number;
}

/** 一条河加密后的折线:坐标和线宽都是世界单位(画的时候再乘 scale) */
export interface DenseRiver {
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
  style: RiverWidth,
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

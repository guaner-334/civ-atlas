/**
 * 地球仪上的云(写实风):按气象卫星云图的样子,先在后台画好一张全球云量图,地球仪着色器再叠上细碎的边缘。
 *
 * 云图是等距圆柱的单通道(0 = 晴,255 = 厚云),和地形贴图同一套经纬度(世界 x = 0 是 180° 经线)。每个点按它在单位球上的位置取噪声,
 * 所以两极、180° 经线处都没有接缝。形状由这几样叠出来:
 *   - 纬向云量:赤道一条云带、25° 附近少云(副热带高压,沙漠和晴朗的洋面)、55° 附近风暴路径云多
 *   - 气旋:南北半球各三个、都在中纬度,云绕着中心卷成螺旋(北半球逆时针、南半球顺时针),位置由种子定
 *   - 这个世界的降水:雨多的地方云多、干旱的地方云少(wet:0–1 的降水图,不给 = 只按纬度)
 *   - 大块天气系统、中等的云团、细碎的边缘,信风带零散的小积云,顺纬线拉长的薄卷云
 * 同一个种子、同一份降水画出同一片云;不用 Math.random。
 *
 * 云图的分辨率只够大形状;更细的边缘由着色器按放大倍数现加(globe.ts 的 cloudDetail),放大了也不糊。
 * 纯计算,不碰 DOM,后台线程和 Node 里都能跑。
 */
import { mulberry32, subSeed } from '../gen/util';

export const CLOUD_W = 1024;
export const CLOUD_H = 512;
/** 降水图(wet)的大小:够画出大陆级的干湿差别,再双线性放大到云图 */
export const WET_W = 256;
export const WET_H = 128;

/** 整数哈希 → [0, 1) */
function hash3(ix: number, iy: number, iz: number, s: number): number {
  let h = (Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(iz, 0x9e3779b1) ^ s) | 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise3(x: number, y: number, z: number, s: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fy = y - iy;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash3(ix, iy, iz, s);
  const b = hash3(ix + 1, iy, iz, s);
  const c = hash3(ix, iy + 1, iz, s);
  const d = hash3(ix + 1, iy + 1, iz, s);
  const e = hash3(ix, iy, iz + 1, s);
  const f = hash3(ix + 1, iy, iz + 1, s);
  const g = hash3(ix, iy + 1, iz + 1, s);
  const h = hash3(ix + 1, iy + 1, iz + 1, s);
  const x0 = a + (b - a) * fx;
  const x1 = c + (d - c) * fx;
  const x2 = e + (f - e) * fx;
  const x3 = g + (h - g) * fx;
  const y0 = x0 + (x1 - x0) * fy;
  const y1 = x2 + (x3 - x2) * fy;
  return y0 + (y1 - y0) * fz;
}

/** 分形噪声,值域约 0–1(octaves 层,每层频率 ×2.03、振幅 ×0.5) */
function fbm3(x: number, y: number, z: number, s: number, octaves: number): number {
  let a = 0.5;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * vnoise3(x, y, z, (s + i * 0x9e3779b1) | 0);
    norm += a;
    x = x * 2.03 + 1.7;
    y = y * 2.03 + 9.2;
    z = z * 2.03 + 3.1;
    a *= 0.5;
  }
  return sum / norm;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** 一个气旋:单位向量中心、转向(+1 北半球逆时针、−1 南半球顺时针)、强度、大小(弧度²,越大云盘越宽) */
export interface Cyclone {
  c: [number, number, number];
  sgn: number;
  str: number;
  r: number;
}

/** 按种子定气旋:南北半球各三个,纬度 40°–58°,经度大致均分再各抖一点 */
export function cyclonesOf(seed: number): Cyclone[] {
  const rng = mulberry32(subSeed(seed, 'cloud-cyclones'));
  const out: Cyclone[] = [];
  for (const hemi of [1, -1]) {
    const lon0 = rng() * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      const lon = lon0 + (k * Math.PI * 2) / 3 + (rng() - 0.5) * 0.9;
      const lat = hemi * ((40 + rng() * 18) * Math.PI) / 180;
      out.push({ c: [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)], sgn: hemi, str: 2.4 + rng() * 0.8, r: 0.06 + rng() * 0.05 });
    }
  }
  return out;
}

/** 绕各个气旋中心把点转一转(越靠近中心转得越多),云图上的云就卷成了螺旋 */
function twist(p: [number, number, number], cy: readonly Cyclone[]): [number, number, number] {
  let [x, y, z] = p;
  for (const k of cy) {
    const [cx, cyy, cz] = k.c;
    const dot = Math.min(1, Math.max(-1, x * cx + y * cyy + z * cz));
    const a = Math.acos(dot);
    const th = k.sgn * k.str * Math.exp(-(a * a) / k.r);
    if (Math.abs(th) < 1e-3) continue;
    const co = Math.cos(th);
    const si = Math.sin(th);
    // 罗德里格斯转动:绕单位轴 k 转 th
    const kx = cyy * z - cz * y;
    const ky = cz * x - cx * z;
    const kz = cx * y - cyy * x;
    const kd = (cx * x + cyy * y + cz * z) * (1 - co);
    x = x * co + kx * si + cx * kd;
    y = y * co + ky * si + cyy * kd;
    z = z * co + kz * si + cz * kd;
  }
  return [x, y, z];
}

/** 某一点(单位球上)的云量 0–1;wet = 这一点的干湿 0–1(0.5 = 平均) */
export function cloudDensity(p: [number, number, number], seed: number, cy: readonly Cyclone[], wet = 0.5): number {
  const s = subSeed(seed, 'cloud-noise') | 0;
  const lat = Math.asin(Math.min(1, Math.max(-1, p[2])));
  const al = Math.abs(lat);
  // 纬向云量:赤道一条带、25° 一带少云、55° 一带风暴路径
  const prof = 0.3 * Math.exp(-(((al / 0.13) ** 2))) + 0.34 * Math.exp(-((((al - 0.95) / 0.28) ** 2))) - 0.24 * Math.exp(-((((al - 0.46) / 0.14) ** 2)));
  const t = twist(p, cy);
  const wx = fbm3(t[0] * 3 + 3, t[1] * 3 + 3, t[2] * 3 + 3, s + 1, 3) - 0.5;
  const wy = fbm3(t[0] * 3 + 11, t[1] * 3 + 11, t[2] * 3 + 11, s + 2, 3) - 0.5;
  const wz = fbm3(t[0] * 3 + 23, t[1] * 3 + 23, t[2] * 3 + 23, s + 3, 3) - 0.5;
  const qx = t[0] + wx * 0.16;
  const qy = t[1] + wy * 0.16;
  const qz = t[2] + wz * 0.16;
  const big = fbm3(qx * 2.4 + 41, qy * 2.4 + 41, qz * 3.6 + 41, s + 4, 3);
  const body = fbm3(qx * 7, qy * 7, qz * 9, s + 5, 4);
  const fine = fbm3(qx * 30, qy * 30, qz * 30, s + 6, 2);
  // 这个世界的降水:雨多的地方云多、干旱的地方云少
  const cov = 0.46 * big + 0.3 * body + 0.24 * fine + 0.55 * prof + 0.45 * (wet - 0.5) - 0.04;
  // 厚度:云边缘一道窄坡,往里越来越厚(云图保留云里面的明暗,着色器据此画云的立体感)
  const main = smoothstep(0.45, 0.72, cov) * (0.78 + 0.22 * fine);
  // 信风带零散的小积云
  const sc = smoothstep(0.78, 0.92, fbm3(t[0] * 22 + 77, t[1] * 22 + 77, t[2] * 30 + 77, s + 7, 2) * 0.6 + fine * 0.4 + 0.15 * (1 - prof));
  // 卷云:顺纬线拉长的薄丝
  const ci = smoothstep(0.66, 0.82, fbm3(p[0] * 3 + 5, p[1] * 3 + 5, p[2] * 14 + 5, s + 8, 3)) * 0.3;
  return Math.min(1, Math.max(main, sc * 0.4, ci));
}

/**
 * 画云图:CLOUD_W × CLOUD_H 的单通道(行从北到南,列从 180°W 到 180°E)。
 * wet = WET_W × WET_H 的降水图 0–1(同样的行列顺序;不给 = 只按纬度和噪声)
 */
export function bakeClouds(seed: number, wet?: Float32Array | null, w = CLOUD_W, h = CLOUD_H): Uint8Array {
  const cy = cyclonesOf(seed);
  const out = new Uint8Array(w * h);
  const wetAt = (u: number, v: number): number => {
    if (!wet) return 0.5;
    const fx = u * WET_W - 0.5;
    const fy = Math.min(WET_H - 1, Math.max(0, v * WET_H - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const at = (x: number, y: number) => wet[Math.min(WET_H - 1, y) * WET_W + (((x % WET_W) + WET_W) % WET_W)];
    const a = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
    const b = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
    return a * (1 - ty) + b * ty;
  };
  for (let j = 0; j < h; j++) {
    const v = (j + 0.5) / h;
    const lat = Math.PI / 2 - v * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5) / w;
      const lon = u * Math.PI * 2 - Math.PI;
      const d = cloudDensity([cl * Math.cos(lon), cl * Math.sin(lon), sl], seed, cy, wetAt(u, v));
      out[j * w + i] = Math.round(d * 255);
    }
  }
  return out;
}

/**
 * 主图的降水(mm,任意大小)缩成 WET_W × WET_H 的干湿图 0–1:每格取这一块的平均降水,再和同一纬度一圈的平均比 ——
 * 比平均多一倍 = 0.67、少一半 = 0.33(取对数,截到 ±1.5 倍频),0.5 = 和同纬度平均一样。
 * 只看"同纬度里谁更湿",赤道本来就多雨的部分已经在纬向云量里了,不重复算;雨林上空云多、沙漠上空云少,海陆差别也出来
 */
export function wetFromPrecip(precip: Float32Array, w: number, h: number): Float32Array {
  const mean = new Float32Array(WET_W * WET_H);
  for (let j = 0; j < WET_H; j++) {
    const y0 = Math.floor((j * h) / WET_H);
    const y1 = Math.max(y0 + 1, Math.floor(((j + 1) * h) / WET_H));
    for (let i = 0; i < WET_W; i++) {
      const x0 = Math.floor((i * w) / WET_W);
      const x1 = Math.max(x0 + 1, Math.floor(((i + 1) * w) / WET_W));
      let sum = 0;
      let n = 0;
      // 每块里隔几个像素取一个就够
      const sy = Math.max(1, (y1 - y0) >> 2);
      const sx = Math.max(1, (x1 - x0) >> 2);
      for (let y = y0; y < y1; y += sy)
        for (let x = x0; x < x1; x += sx) {
          sum += precip[y * w + x];
          n++;
        }
      mean[j * WET_W + i] = sum / n;
    }
  }
  const out = new Float32Array(WET_W * WET_H);
  for (let j = 0; j < WET_H; j++) {
    let row = 0;
    for (let i = 0; i < WET_W; i++) row += mean[j * WET_W + i];
    row = Math.max(row / WET_W, 1);
    for (let i = 0; i < WET_W; i++) {
      const ratio = Math.max(mean[j * WET_W + i], 1) / row;
      out[j * WET_W + i] = 0.5 + Math.min(1.5, Math.max(-1.5, Math.log2(ratio))) / 3;
    }
  }
  return out;
}

/**
 * 生成管线用的噪声:simplex 噪声(2D / 3D)和它的分形叠加、山脊噪声,可无缝平铺的噪声贴图,
 * 廉价的哈希噪声、值噪声(画风的纸张纹理、抖动也用)。
 * 和 util.ts 分开放:首页读存档、列世界只用得到 util.ts 里的随机数、小工具,不用跟着下载噪声库。
 */
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { mulberry32 } from './util';

export type Noise2 = (x: number, y: number) => number;

export function noise2(seed: number): Noise2 {
  return createNoise2D(mulberry32(seed));
}

/** 分形布朗运动:多层噪声叠加,输出约 [-1,1]。 */
export function fbm(n: Noise2, octaves: number, persistence = 0.5, lacunarity = 2): Noise2 {
  return (x, y) => {
    let v = 0;
    let amp = 1;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      v += amp * n(x * f + o * 17.3, y * f - o * 9.1);
      norm += amp;
      amp *= persistence;
      f *= lacunarity;
    }
    return v / norm;
  };
}

/** 山脊噪声:在噪声零线处形成尖脊,输出 [0,1]。用来做古老山系。 */
export function ridged(n: Noise2, octaves: number, persistence = 0.5): Noise2 {
  return (x, y) => {
    let v = 0;
    let amp = 1;
    let f = 1;
    let norm = 0;
    let weight = 1;
    for (let o = 0; o < octaves; o++) {
      let r = 1 - Math.abs(n(x * f + o * 31.7, y * f + o * 7.7));
      r *= r;
      r *= weight;
      weight = Math.min(1, r * 2);
      v += amp * r;
      norm += amp;
      amp *= persistence;
      f *= 2;
    }
    return v / norm;
  };
}

export type Noise3 = (x: number, y: number, z: number) => number;

/** 3D simplex 噪声(球面世界在单位球面上取样:没有接缝,极点不收缩) */
export function noise3(seed: number): Noise3 {
  return createNoise3D(mulberry32(seed));
}

/** 3D 分形叠加(同 fbm,各层再错开一点 z) */
export function fbm3(n: Noise3, octaves: number, persistence = 0.5, lacunarity = 2): Noise3 {
  return (x, y, z) => {
    let v = 0;
    let amp = 1;
    let f = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      v += amp * n(x * f + o * 17.3, y * f - o * 9.1, z * f + o * 5.7);
      norm += amp;
      amp *= persistence;
      f *= lacunarity;
    }
    return v / norm;
  };
}

/** 3D 山脊噪声(同 ridged) */
export function ridged3(n: Noise3, octaves: number, persistence = 0.5): Noise3 {
  return (x, y, z) => {
    let v = 0;
    let amp = 1;
    let f = 1;
    let norm = 0;
    let weight = 1;
    for (let o = 0; o < octaves; o++) {
      let r = 1 - Math.abs(n(x * f + o * 31.7, y * f + o * 7.7, z * f - o * 3.1));
      r *= r;
      r *= weight;
      weight = Math.min(1, r * 2);
      v += amp * r;
      norm += amp;
      amp *= persistence;
      f *= 2;
    }
    return v / norm;
  };
}

/**
 * 可无缝平铺的分形噪声贴图(周期梯度噪声多层叠加),size×size,左右 / 上下边缘首尾相接。
 * 铺像素时用"查贴图 + 双线性插值"代替逐像素算多层噪声,快一个数量级。
 * cells:最底层每边多少格(整数才能无缝,波长 = size / cells 像素);之后每层格数 ×2、幅度 ×persistence。
 * 输出已归一化:均值 0、标准差 1。size 必须是 2 的幂(采样时用位运算取模)。
 */
export function tileableFbm(seed: number, size: number, cells: number, octaves: number, persistence = 0.5): Float32Array {
  const out = new Float32Array(size * size);
  const rng = mulberry32(seed);
  // 256 个均匀分布的单位方向,格点梯度从里面随机挑
  const DIRS = 256;
  const ux = new Float32Array(DIRS);
  const uy = new Float32Array(DIRS);
  for (let i = 0; i < DIRS; i++) {
    ux[i] = Math.cos((i / DIRS) * Math.PI * 2);
    uy[i] = Math.sin((i / DIRS) * Math.PI * 2);
  }
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    const c = cells * (1 << o);
    // 每个格点一个随机单位梯度;格点下标对 c 取模 → 周期正好是 size 个像素
    const gx = new Float32Array(c * c);
    const gy = new Float32Array(c * c);
    for (let i = 0; i < c * c; i++) {
      const di = (rng() * DIRS) | 0;
      gx[i] = ux[di];
      gy[i] = uy[di];
    }
    // 每层随机平移,避免各层格点重合(否则会出现规则排列的"平点")
    const ox = rng() * c;
    const oy = rng() * c;
    const f = c / size;
    // 坐标都在 [0, 2c) 内:取模用一次减法即可
    for (let py = 0; py < size; py++) {
      const v = py * f + oy;
      const vi = v | 0;
      const ty = v - vi;
      const sy = ty * ty * ty * (ty * (ty * 6 - 15) + 10);
      const y0 = vi >= c ? vi - c : vi;
      const r0 = y0 * c;
      const r1 = (y0 + 1 === c ? 0 : y0 + 1) * c;
      const row = py * size;
      for (let px = 0; px < size; px++) {
        const u = px * f + ox;
        const ui = u | 0;
        const tx = u - ui;
        const sx = tx * tx * tx * (tx * (tx * 6 - 15) + 10);
        const c0 = ui >= c ? ui - c : ui;
        const c1 = c0 + 1 === c ? 0 : c0 + 1;
        const n00 = gx[r0 + c0] * tx + gy[r0 + c0] * ty;
        const n10 = gx[r0 + c1] * (tx - 1) + gy[r0 + c1] * ty;
        const n01 = gx[r1 + c0] * tx + gy[r1 + c0] * (ty - 1);
        const n11 = gx[r1 + c1] * (tx - 1) + gy[r1 + c1] * (ty - 1);
        const a0 = n00 + (n10 - n00) * sx;
        const a1 = n01 + (n11 - n01) * sx;
        out[row + px] += amp * (a0 + (a1 - a0) * sy);
      }
    }
    amp *= persistence;
  }
  let s = 0;
  let s2 = 0;
  for (let i = 0; i < out.length; i++) {
    s += out[i];
    s2 += out[i] * out[i];
  }
  const mean = s / out.length;
  const inv = 1 / Math.sqrt(Math.max(1e-12, s2 / out.length - mean * mean));
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mean) * inv;
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

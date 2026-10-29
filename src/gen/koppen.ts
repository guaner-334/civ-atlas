/**
 * 近似气候分类(估算):按柯本 - 盖格的温度和干旱门槛,把每个像素分成 14 类。
 *
 * 世界里只有年均温和年降水,柯本分类要的是逐月气温和逐月降水。这里能估的只估温度:
 *   年较差(最热月 − 最冷月)按纬度和"离海多远、上风方向有多少陆地"(大陆度)估,月温按正弦曲线摆开;
 *   最冷月、最热月、≥10°C 的月数都从这条曲线读。
 * 降水没有逐月的,不编雨季:干旱门槛按"降水全年均匀"那一档(20 × 年均温 + 140 毫米),
 * 热带不分 f / m / w,温带、冷温带不分 f / s / w(第二个字母空着,写成 Ca、Db 这样)。
 *
 * 只读栅格(像素的年均温、年降水、水陆),不改世界;同一个世界算出来总是一样。
 * 大陆度、年较差的算法(continentalityGrid、annualRange)推演也用:年内气温估算(seasons.ts)按地块取陆地,和这里共用一份。
 */
import { latitudeAt, windAt } from './climate';
import type { Raster } from './raster';
import { round24 } from './civ/rand';

export interface ClimateClass {
  /** 代号:柯本 - 盖格写法,温带、冷温带省掉第二个字母 */
  code: string;
  name: string;
  /** 颜色:照柯本 - 盖格世界地图常用的那套(温带、冷温带取 f 那一列) */
  color: string;
}

export const CLIMATE_CLASSES: ClimateClass[] = [
  { code: 'A', name: '热带', color: '#0078ff' },
  { code: 'BWh', name: '热沙漠', color: '#ff0000' },
  { code: 'BWk', name: '冷沙漠', color: '#ff9696' },
  { code: 'BSh', name: '热草原', color: '#f5a500' },
  { code: 'BSk', name: '冷草原', color: '#ffdc64' },
  { code: 'Ca', name: '温带,夏季炎热', color: '#c8ff50' },
  { code: 'Cb', name: '温带,夏季温暖', color: '#64ff50' },
  { code: 'Cc', name: '温带,夏季凉爽', color: '#32c800' },
  { code: 'Da', name: '冷温带,夏季炎热', color: '#00ffff' },
  { code: 'Db', name: '冷温带,夏季温暖', color: '#37c8ff' },
  { code: 'Dc', name: '冷温带,夏季凉爽', color: '#007d7d' },
  { code: 'Dd', name: '冷温带,冬季极寒', color: '#00465f' },
  { code: 'ET', name: '苔原', color: '#b2b2b2' },
  { code: 'EF', name: '冰原', color: '#686868' },
];
/** 水面(海、湖)不分类 */
export const CLIMATE_WATER = 255;

/** 大陆度的粗网格:每格 1°(gy = 0 在北极那一行,gx = 0 在经度 −180° 那一列;和主图一样的等距圆柱) */
export const CONT_GW = 360;
export const CONT_GH = 180;
const GW = CONT_GW;
const GH = CONT_GH;
const KM_PER_DEG = 40000 / 360;

/** 主图像素的陆地(湖算陆地)按 1° 一格:这一格里陆地多于一半算陆地 */
function landGridOfRaster(r: Raster): Uint8Array {
  const { w, h, water } = r;
  const land = new Uint8Array(GW * GH);
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) {
      const x0 = Math.floor((gx * w) / GW);
      const x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / GW));
      const y0 = Math.floor((gy * h) / GH);
      const y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / GH));
      let n = 0;
      let l = 0;
      for (let y = y0; y < y1; y += 2)
        for (let x = x0; x < x1; x += 2) {
          n++;
          if (water[y * w + x] !== 1) l++;
        }
      land[gy * GW + gx] = l * 2 > n ? 1 : 0;
    }
  return land;
}

/**
 * 大陆度 0–1(0 = 海洋性,1 = 极端大陆性),每格 1°:一半看离海岸多远,一半看顺着盛行风往上风走多远才见到海
 * (同纬度的西岸、东岸差别就在这里)。land = 每格是不是陆地(CONT_GW × CONT_GH)。
 * 气候图层(按主图像素)和推演里的年内气温(gen/seasons.ts,按地块)共用这一份;三角函数、指数舍入到 24 位,跨 CPU 一致
 */
export function continentalityGrid(land: Uint8Array): Float32Array {
  // 离海岸(公里):两遍倒角距离,东西相连(各跑两圈)
  const dist = new Float32Array(GW * GH);
  for (let i = 0; i < GW * GH; i++) dist[i] = land[i] ? 1e9 : 0;
  const dxOf = (gy: number) => KM_PER_DEG * Math.max(0.05, round24(Math.cos((((gy + 0.5) / GH) * 180 - 90) * (Math.PI / 180))));
  for (let pass = 0; pass < 2; pass++) {
    for (let gy = 0; gy < GH; gy++) {
      const dx = dxOf(gy);
      for (let gx = 0; gx < 2 * GW; gx++) {
        const i = gy * GW + (gx % GW);
        if (!land[i]) continue;
        let d = dist[i];
        d = Math.min(d, dist[gy * GW + ((gx + GW - 1) % GW)] + dx);
        if (gy > 0) d = Math.min(d, dist[(gy - 1) * GW + (gx % GW)] + KM_PER_DEG);
        dist[i] = d;
      }
    }
    for (let gy = GH - 1; gy >= 0; gy--) {
      const dx = dxOf(gy);
      for (let gx = 2 * GW - 1; gx >= 0; gx--) {
        const i = gy * GW + (gx % GW);
        if (!land[i]) continue;
        let d = dist[i];
        d = Math.min(d, dist[gy * GW + ((gx + 1) % GW)] + dx);
        if (gy < GH - 1) d = Math.min(d, dist[(gy + 1) * GW + (gx % GW)] + KM_PER_DEG);
        dist[i] = d;
      }
    }
  }
  // 上风方向的陆地有多长(公里,最多算 4400)
  const cont = new Float32Array(GW * GH);
  const STEP = 100;
  for (let gy = 0; gy < GH; gy++) {
    const lat = 90 - ((gy + 0.5) / GH) * 180;
    const wind = windAt(lat);
    const u = round24(wind[0]);
    const v = round24(wind[1]);
    const cosl = Math.max(0.05, round24(Math.cos(lat * (Math.PI / 180))));
    for (let gx = 0; gx < GW; gx++) {
      const i = gy * GW + gx;
      if (!land[i]) continue;
      let fetch = 0;
      let x = gx + 0.5;
      let y = gy + 0.5;
      while (fetch < 4400) {
        x -= (u * STEP) / (KM_PER_DEG * cosl);
        y -= (v * STEP) / KM_PER_DEG;
        if (y < 0 || y >= GH) break;
        const j = Math.floor(y) * GW + ((Math.floor(x) % GW) + GW) % GW;
        if (!land[j]) break;
        fetch += STEP;
      }
      cont[i] = 0.5 * (1 - round24(Math.exp(-dist[i] / 600))) + 0.5 * (1 - round24(Math.exp(-fetch / 2000)));
    }
  }
  // 抹平一点(格子边上不跳)
  const out = new Float32Array(GW * GH);
  for (let gy = 0; gy < GH; gy++)
    for (let gx = 0; gx < GW; gx++) {
      let s = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = gy + dy;
        if (yy < 0 || yy >= GH) continue;
        for (let dx = -1; dx <= 1; dx++) {
          s += cont[yy * GW + ((gx + dx + GW) % GW)];
          n++;
        }
      }
      out[gy * GW + gx] = s / n;
    }
  return out;
}

/**
 * 主图上 (u, v) 处的大陆度(u、v = 横、竖的几成,0–1):格子中心之间双线性插值,东西相连
 */
export function continentalityAt(cont: Float32Array, u: number, v: number): number {
  const fy = Math.min(GH - 1, Math.max(0, v * GH - 0.5));
  const y0 = Math.min(GH - 2, Math.floor(fy));
  const ty = fy - y0;
  const fx = u * GW - 0.5;
  const xf = Math.floor(fx);
  const tx = fx - xf;
  const x0 = ((xf % GW) + GW) % GW;
  const x1 = (x0 + 1) % GW;
  return (cont[y0 * GW + x0] * (1 - tx) + cont[y0 * GW + x1] * tx) * (1 - ty) + (cont[(y0 + 1) * GW + x0] * (1 - tx) + cont[(y0 + 1) * GW + x1] * tx) * ty;
}

/** 年较差(°C):海洋性 3 + 12·sin|φ|,极端大陆性 3 + 60·sin|φ|^1.5,按大陆度在两者之间(三角函数、乘方舍入到 24 位,跨 CPU 一致) */
export function annualRange(lat: number, cont: number): number {
  const s = Math.abs(round24(Math.sin(lat * (Math.PI / 180))));
  const sea = 3 + 12 * s;
  const inland = 3 + 60 * round24(s ** 1.5);
  return sea + (inland - sea) * cont;
}

/** 由年均温、年较差、年降水定一类(月温按正弦摆开) */
export function classOf(mat: number, range: number, map: number): number {
  const hot = mat + range / 2;
  const cold = mat - range / 2;
  if (hot < 10) return hot > 0 ? 12 : 13;
  const pth = 20 * mat + 140;
  if (map < pth) {
    const desert = map < pth / 2;
    const h = mat >= 18;
    return desert ? (h ? 1 : 2) : h ? 3 : 4;
  }
  if (cold >= 18) return 0;
  let warm = 0;
  for (let m = 0; m < 12; m++) if (mat + (range / 2) * Math.cos((2 * Math.PI * (m + 0.5)) / 12) >= 10) warm++;
  const third = hot >= 22 ? 0 : warm >= 4 ? 1 : cold < -38 ? 3 : 2;
  if (cold > 0) return 5 + Math.min(2, third);
  return 8 + third;
}

/** 每个像素的分类(CLIMATE_CLASSES 的下标;水面 = CLIMATE_WATER) */
export function climateClasses(r: Raster): Uint8Array {
  const { w, h, temp, precip, water } = r;
  const cont = continentalityGrid(landGridOfRaster(r));
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const lat = latitudeAt(y + 0.5, h);
    // 大陆度双线性插值(格子中心之间;同 continentalityAt,按行提出来)
    const fy = Math.min(GH - 1, Math.max(0, ((y + 0.5) / h) * GH - 0.5));
    const y0 = Math.min(GH - 2, Math.floor(fy));
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (water[k] !== 0) {
        out[k] = CLIMATE_WATER;
        continue;
      }
      const fx = ((x + 0.5) / w) * GW - 0.5;
      const xf = Math.floor(fx);
      const tx = fx - xf;
      const x0 = (xf + GW) % GW;
      const x1 = (x0 + 1) % GW;
      const c =
        (cont[y0 * GW + x0] * (1 - tx) + cont[y0 * GW + x1] * tx) * (1 - ty) +
        (cont[(y0 + 1) * GW + x0] * (1 - tx) + cont[(y0 + 1) * GW + x1] * tx) * ty;
      out[k] = classOf(temp[k], annualRange(lat, c), precip[k]);
    }
  }
  return out;
}

/**
 * 照图原样认图(导入的图多认的两样:细图、连续高低;界面和认细图的后台线程用)。纯计算,不碰 DOM。
 */
import { clamp } from './util';
import { LAYER_W, SKETCH_LAND, SKETCH_NONE } from './sketch';
import { FINE_H, FINE_LAND, FINE_NONE, FINE_W, FINE_WATER, GREY_H, GREY_W } from './sketchFine';
import { autoSeaLevel, levelGray, placeRect, type Picture, type Placement } from './sketchImage';

/** 照图原样时海平面自动放哪:只有深浅两种颜色的图放两种颜色正中间(糊过的边缘不偏向哪一边),别的图同 autoSeaLevel */
export function traceSeaLevel(pic: Picture, dark?: boolean): number {
  return twoToneMid(levelGray(pic, dark)) ?? autoSeaLevel(pic, dark);
}

/** 只有深浅两种颜色(九成以上的格子贴着最暗或最亮)的图:两种颜色正中间;不是这种图 = null */
function twoToneMid(g: Float32Array): number | null {
  let lo = 255;
  let hi = 0;
  for (let i = 0; i < g.length; i++) {
    if (g[i] < lo) lo = g[i];
    if (g[i] > hi) hi = g[i];
  }
  if (hi - lo < 64) return null;
  const band = (hi - lo) / 6;
  let n = 0;
  for (let i = 0; i < g.length; i++) if (g[i] <= lo + band || g[i] >= hi - band) n++;
  return n >= 0.9 * g.length ? clamp(Math.round((lo + hi) / 2), 1, 254) : null;
}

/** 照图原样认细图用的宽度(和细图一样宽) */
export const FINE_PICTURE_W = FINE_W;

/**
 * 认出来的(w × h 格的草图值,一般是 FINE_PICTURE_W 宽的图认的)按放法铺到细图上:每一格取它中心落在图上那一格,
 * 陆地类 = FINE_LAND,海、浅海 = FINE_WATER,没盖到 = FINE_NONE。放法和 placeOnLayer 一样
 */
export function placeOnFine(values: Uint8Array, w: number, h: number, p: Placement): Uint8Array {
  const out = new Uint8Array(FINE_W * FINE_H);
  const k = FINE_W / LAYER_W;
  const r0 = placeRect(w, h, p);
  const r = { x: r0.x * k, y: r0.y * k, w: r0.w * k, h: r0.h * k };
  for (let fy = 0; fy < FINE_H; fy++) {
    const sy = Math.floor(((fy + 0.5 - r.y) / r.h) * h);
    if (sy < 0 || sy >= h) continue;
    for (let fx = 0; fx < FINE_W; fx++) {
      const dx = (((fx + 0.5 - r.x) % FINE_W) + FINE_W) % FINE_W;
      const sx = Math.floor((dx / r.w) * w);
      if (sx < 0 || sx >= w) continue;
      const v = values[sy * w + sx];
      out[fy * FINE_W + fx] = v === SKETCH_NONE ? FINE_NONE : v >= SKETCH_LAND ? FINE_LAND : FINE_WATER;
    }
  }
  return out;
}

/**
 * 照图原样的连续高低:亮度(dark = 暗的高)按放法铺到 GREY_W × GREY_H 上(双线性),海平面以下、没盖到 = 0,往上 1–255。
 * 一格先看认出来的那张图(levels,pic 同大小)是不是陆地,不是陆地的 = 0
 */
export function greyLayer(pic: Picture, sea: number, dark: boolean | undefined, levels: Uint8Array, p: Placement): Uint8Array {
  const g = levelGray(pic, dark);
  const t = clamp(sea, 1, 254);
  const out = new Uint8Array(GREY_W * GREY_H);
  const k = GREY_W / LAYER_W;
  const r0 = placeRect(pic.w, pic.h, p);
  const r = { x: r0.x * k, y: r0.y * k, w: r0.w * k, h: r0.h * k };
  for (let ly = 0; ly < GREY_H; ly++) {
    const sy = ((ly + 0.5 - r.y) / r.h) * pic.h - 0.5;
    if (sy < -0.5 || sy >= pic.h - 0.5) continue;
    for (let lx = 0; lx < GREY_W; lx++) {
      const dx = (((lx + 0.5 - r.x) % GREY_W) + GREY_W) % GREY_W;
      const sx = (dx / r.w) * pic.w - 0.5;
      if (sx < -0.5 || sx >= pic.w - 0.5) continue;
      const x0 = clamp(Math.floor(sx), 0, pic.w - 1);
      const y0 = clamp(Math.floor(sy), 0, pic.h - 1);
      if (levels[y0 * pic.w + x0] < SKETCH_LAND) continue;
      const x1 = Math.min(pic.w - 1, x0 + 1);
      const y1 = Math.min(pic.h - 1, y0 + 1);
      const fx = clamp(sx - x0, 0, 1);
      const fy = clamp(sy - y0, 0, 1);
      const v = (g[y0 * pic.w + x0] * (1 - fx) + g[y0 * pic.w + x1] * fx) * (1 - fy) + (g[y1 * pic.w + x0] * (1 - fx) + g[y1 * pic.w + x1] * fx) * fy;
      out[ly * GREY_W + lx] = v < t ? 1 : Math.min(255, Math.round((254 * (v - t)) / (255 - t)) + 1);
    }
  }
  return out;
}

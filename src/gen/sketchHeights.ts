/** 照图原样的连续高低在地块上的取法(生成时用,界面不用) */
import { round24 } from './civ/engine/rand';
import { GREY_H, GREY_W } from './sketchFine';
import { sketchAt, type SketchHeights } from './sketch';

/** 连续高低在世界坐标 (x, y) 处的值(双线性,0–255;后来用笔涂过的地方 = 0) */
export function heightAt(h: SketchHeights, x: number, y: number, width: number, height: number): number {
  if (h.off && sketchAt(h.off, x, y, width, height)) return 0;
  const gx = (x / width) * GREY_W - 0.5;
  const gy = Math.min(GREY_H - 1, Math.max(0, (y / height) * GREY_H - 0.5));
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const xa = ((x0 % GREY_W) + GREY_W) % GREY_W;
  const xb = (xa + 1) % GREY_W;
  const ya = y0 * GREY_W;
  const yb = Math.min(GREY_H - 1, y0 + 1) * GREY_W;
  const g = h.grey;
  return (g[ya + xa] * (1 - fx) + g[ya + xb] * fx) * (1 - fy) + (g[yb + xa] * (1 - fx) + g[yb + xb] * fx) * fy;
}

/** 连续高低 0–255 → 0–1 的起伏(亮度的 1.6 次方:暗处平缓、亮处陡);查表再线性插值,各平台逐位一致 */
let rise: Float64Array | null = null;
export function greyRise(v: number): number {
  if (!(v > 0)) return 0;
  if (v >= 255) return 1;
  if (!rise) {
    rise = new Float64Array(256);
    for (let k = 0; k < 256; k++) rise[k] = round24(Math.pow(k / 255, 1.6));
  }
  const a = Math.floor(v);
  return rise[a] + (rise[a + 1] - rise[a]) * (v - a);
}


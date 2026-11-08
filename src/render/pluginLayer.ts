/**
 * 插件的地块图层:每个地块一个数,按渐变或分类上色,半透明盖在底图上。平面主图、弯边投影、地球仪、导出共用。
 * 只算、只往给定的画布上画,不碰 DOM,后台线程里也能用。
 */
import type { Raster } from '../gen/raster';
import { hexRGB, type RGB } from './common';

/** 画一个地块图层要的(插件接口查过的一份和存进世界的一份都是这个样子) */
export interface CellPaint {
  values: Float32Array;
  ramp?: { colors: readonly string[]; min?: number; max?: number };
  classes?: readonly { value: number; color: string; label: string }[];
  opacity?: number;
}

/** 插件没给 opacity 时盖多深 */
export const PLUGIN_LAYER_OPACITY = 0.65;

/** 渐变从哪涂到哪:给了用给的,没给的一头按数据里有限数的最小、最大;一个有限数都没有 = [0, 1] */
export function rampRange(l: CellPaint): [number, number] {
  let lo = l.ramp?.min;
  let hi = l.ramp?.max;
  if (lo === undefined || hi === undefined) {
    let a = Infinity;
    let b = -Infinity;
    for (const v of l.values) {
      if (!Number.isFinite(v)) continue;
      if (v < a) a = v;
      if (v > b) b = v;
    }
    if (a > b) [a, b] = [0, 1];
    lo ??= Math.min(a, hi ?? a);
    hi ??= Math.max(b, lo);
  }
  return [lo, hi];
}

/** 渐变上 t(0–1)处的颜色:几个颜色等距排开 */
export function rampAt(colors: readonly RGB[], t: number): RGB {
  const x = Math.min(1, Math.max(0, t)) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(x));
  const f = x - i;
  const a = colors[i];
  const b = colors[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** 每个地块的颜色(RGBA 四个字节一组;不画的四个都是 0) */
export function cellColors(l: CellPaint, alpha = l.opacity ?? PLUGIN_LAYER_OPACITY): Uint8Array {
  const n = l.values.length;
  const out = new Uint8Array(n * 4);
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  if (!a) return out;
  const put = (i: number, c: RGB) => {
    out[i * 4] = Math.round(c[0]);
    out[i * 4 + 1] = Math.round(c[1]);
    out[i * 4 + 2] = Math.round(c[2]);
    out[i * 4 + 3] = a;
  };
  if (l.classes) {
    const byValue = new Map(l.classes.map((c) => [c.value, hexRGB(c.color)]));
    for (let i = 0; i < n; i++) {
      const c = byValue.get(l.values[i]);
      if (c) put(i, c);
    }
  } else if (l.ramp) {
    const colors = l.ramp.colors.map(hexRGB);
    const [lo, hi] = rampRange(l);
    const span = hi - lo;
    for (let i = 0; i < n; i++) {
      const v = l.values[i];
      if (Number.isFinite(v)) put(i, rampAt(colors, span > 0 ? (v - lo) / span : 0));
    }
  }
  return out;
}

/**
 * 整张铺到 ctx 上(和 raster 一样大、等距圆柱,左上角对齐;画布先清空):每个像素取它所在地块的颜色。
 * colors 是 cellColors 算好的(同一份图层换投影、换世界段时不用重算)
 */
export function paintPluginCells(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, raster: Pick<Raster, 'w' | 'h' | 'cell'>, colors: Uint8Array): void {
  const { w, h, cell } = raster;
  const img = ctx.createImageData(w, h);
  const px = new Uint32Array(img.data.buffer);
  const cc = new Uint32Array(colors.buffer, colors.byteOffset, colors.length >> 2);
  const n = cc.length;
  for (let k = 0; k < px.length; k++) {
    const c = cell[k];
    if (c >= 0 && c < n) px[k] = cc[c];
  }
  ctx.putImageData(img, 0, 0);
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** 盖到已经画了东西、和 raster 一样大的画布上(先铺在一张透明画布上再贴,底下的不清掉) */
export function drawPluginOver(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  raster: Pick<Raster, 'w' | 'h' | 'cell'>,
  l: CellPaint,
  makeCanvas: (w: number, h: number) => AnyCanvas = (w, h) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  },
): void {
  const cv = makeCanvas(raster.w, raster.h);
  paintPluginCells(cv.getContext('2d') as CanvasRenderingContext2D, raster, cellColors(l));
  ctx.drawImage(cv, 0, 0);
  cv.width = cv.height = 0;
}

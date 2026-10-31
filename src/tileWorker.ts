/// <reference lib="webworker" />
/**
 * 放大后按屏幕现算的一块块(写实风,见 ui/terrainTiles.ts):每个线程收到世界以后准备一次(gen/rasterWindow.ts 的 zoomSource、
 * 大尺度晕渲的粗网格),之后一次算一块 —— 铺像素(多铺一圈)→ 上色 → 裁掉多铺的那圈 → 画上河和小溪(只留在这一块自己的陆地上),
 * 交回主线程。同一块结果一样。
 */
import type { World } from './gen/world';
import type { Raster } from './gen/raster';
import { WINDOW_PAD, rasterizeWindow, zoomSource, type ZoomSource } from './gen/rasterWindow';
import { drawRealisticRivers, macroGrids, realisticWindowPixels, type MacroGrids } from './render/realistic';
import type { SurfaceLook } from './render/surface';

/** 整张主图里放大现算要用的几样(1 倍) */
export type WholeRaster = Pick<Raster, 'w' | 'h' | 'scale' | 'elev' | 'water' | 'ice' | 'iceConc' | 'iceTone' | 'bank' | 'veinLines'>;

export type TileRequest =
  /** 换了世界或画法(wid = 第几个世界;look = 写实风的画法) */
  | { type: 'world'; wid: number; world: World; whole: WholeRaster; look: SurfaceLook }
  /** S 倍主图上从 (x0, y0) 开始的 size × size 一块;k = 河按几倍缩放的样子画(这一档一个像素 = 一个屏幕像素时的缩放倍数) */
  | { type: 'tile'; wid: number; key: string; S: number; x0: number; y0: number; size: number; k: number };

export interface TileResponse {
  wid: number;
  key: string;
  /** 画好的一块((size + 1) × (size + 1):多一行一列,见下);出错 = null */
  bitmap: ImageBitmap | null;
  ms: number;
  error?: string;
  /** 这个浏览器的后台线程里不能画图:主线程不再现算 */
  fatal?: boolean;
}

const NO_CANVAS = '后台线程不能画图';

let cur: { wid: number; world: World; look: SurfaceLook; src: ZoomSource; grids: MacroGrids } | null = null;

self.onmessage = (e: MessageEvent<TileRequest>) => {
  const m = e.data;
  if (m.type === 'world') {
    // 收到就准备(细节层放大到一定倍数才送世界过来,等停下来要块时多半已经准备好了)
    cur = null;
    try {
      cur = { wid: m.wid, world: m.world, look: m.look, src: zoomSource(m.world, m.whole), grids: macroGrids(m.whole as Raster) };
    } catch {
      // 要块时报错
    }
    return;
  }
  const t0 = performance.now();
  let res: TileResponse;
  try {
    if (!cur || cur.wid !== m.wid) throw new Error('世界还没送到');
    const world = cur.world;
    if (typeof OffscreenCanvas === 'undefined') throw new Error(NO_CANVAS);
    const P = WINDOW_PAD;
    const n = m.size + 2 * P;
    const r = rasterizeWindow(cur.src, m.S, m.x0 - P, m.y0 - P, n, n);
    const all = realisticWindowPixels(r, cur.grids, cur.look);
    // 多带一行一列(和右边、下边那一块的第一列、第一行一样):拼起来叠住接缝,缩放到小数倍时接缝不漏出底下的整张图
    const m1 = m.size + 1;
    const px = new Uint8ClampedArray(m1 * m1 * 4);
    for (let y = 0; y < m1; y++) px.set(all.subarray(((y + P) * n + P) * 4, ((y + P) * n + P + m1) * 4), y * m1 * 4);
    const cv = new OffscreenCanvas(m1, m1);
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D | null;
    if (!ctx) throw new Error(NO_CANVAS);
    ctx.putImageData(new ImageData(px, m1, m1), 0, 0);
    drawRealisticRivers(ctx, world, r, { s: m.S, ox: -m.x0, oy: -m.y0, k: m.k }, true, cur.look);
    const bitmap = cv.transferToImageBitmap();
    res = { wid: m.wid, key: m.key, bitmap, ms: performance.now() - t0 };
    self.postMessage(res, { transfer: [bitmap] });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    res = { wid: m.wid, key: m.key, bitmap: null, ms: performance.now() - t0, error, fatal: error === NO_CANVAS };
    self.postMessage(res);
  }
};

/// <reference lib="webworker" />
/**
 * 立体地形(地图上框一块立起来看,见 ui/terrain3d/)的后台线程:收到世界以后准备一次(gen/rasterWindow.ts 的 zoomSource、
 * 大尺度晕渲的粗网格),之后一次算方框里的一横条(若干整行):铺像素(多铺一圈)→ 上色 → 裁掉多铺的那圈 → 画上河和小溪,
 * 另交回每个像素的海拔和往西看的地平线坡度(render/terrain3d/relief.ts)。同一条结果一样。
 * 最近铺过的两条(粗的、细的)留着:只换画风时不用重新铺像素,只重新上色。
 */
import type { World } from './gen/world';
import type { Raster } from './gen/raster';
import { WINDOW_PAD, rasterizeWindow, zoomSource, type ZoomSource } from './gen/rasterWindow';
import { drawRealisticRivers, macroGrids, realisticWindowPixels, type MacroGrids } from './render/realistic';
import type { SurfaceLook } from './render/surface';
import { horizonSlopes, stripHeights } from './render/terrain3d/relief';
import type { WholeRaster } from './tileWorker';

export type ReliefRequest =
  /** 换了世界(wid = 第几个世界) */
  | { type: 'world'; wid: number; world: World; whole: WholeRaster }
  /**
   * S 倍主图上从 (x0, y0) 开始的 w × h 像素(方框里第 y 行起的一条);k = 河按几倍缩放的样子画;
   * heights = 要不要交回海拔和地平线(只换画风时不要);kmPerPx、maxPx = 算地平线用(东西方向每像素多少公里、往西最远看几个像素)
   */
  | {
      type: 'strip';
      wid: number;
      job: number;
      y: number;
      S: number;
      x0: number;
      y0: number;
      w: number;
      h: number;
      k: number;
      look: SurfaceLook;
      heights: boolean;
      kmPerPx: number;
      maxPx: number;
    };

export interface ReliefResponse {
  wid: number;
  job: number;
  y: number;
  /** 上好色的一条(w × h);出错 = null */
  bitmap: ImageBitmap | null;
  elev?: Float32Array;
  horizon?: Float32Array;
  ms: number;
  error?: string;
}

let cur: { wid: number; world: World; src: ZoomSource; grids: MacroGrids } | null = null;
/** 最近铺过的几条(编号 → 铺好的像素) */
const recent = new Map<string, Raster>();

self.onmessage = (e: MessageEvent<ReliefRequest>) => {
  const m = e.data;
  if (m.type === 'world') {
    cur = null;
    recent.clear();
    try {
      cur = { wid: m.wid, world: m.world, src: zoomSource(m.world, m.whole), grids: macroGrids(m.whole as Raster) };
      // 先在一小块上走一遍(铺像素、上色、画河):小溪的线、各段代码在框的工夫里备好,立起来时粗的那一档快一些
      const r = rasterizeWindow(cur.src, 4, 0, 400, 16, 16);
      realisticWindowPixels(r, cur.grids, 'detail');
      const ctx = typeof OffscreenCanvas === 'undefined' ? null : (new OffscreenCanvas(8, 8).getContext('2d') as unknown as CanvasRenderingContext2D | null);
      if (ctx) drawRealisticRivers(ctx, cur.world, r, { s: 4, ox: 0, oy: -400, k: 4 * 1.46 }, false, 'detail');
    } catch {
      // 要算的时候报错
    }
    return;
  }
  const t0 = performance.now();
  try {
    if (!cur || cur.wid !== m.wid) throw new Error('世界还没送到');
    if (typeof OffscreenCanvas === 'undefined') throw new Error('后台线程不能画图');
    const P = WINDOW_PAD;
    const n = m.w + 2 * P;
    const key = `${m.S}/${m.x0}/${m.y0}/${m.w}/${m.h}`;
    let r = recent.get(key);
    if (!r) {
      r = rasterizeWindow(cur.src, m.S, m.x0 - P, m.y0 - P, n, m.h + 2 * P);
      recent.set(key, r);
      while (recent.size > 2) recent.delete(recent.keys().next().value!);
    }
    const all = realisticWindowPixels(r, cur.grids, m.look);
    const px = new Uint8ClampedArray(m.w * m.h * 4);
    for (let y = 0; y < m.h; y++) px.set(all.subarray(((y + P) * n + P) * 4, ((y + P) * n + P + m.w) * 4), y * m.w * 4);
    const cv = new OffscreenCanvas(m.w, m.h);
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('后台线程不能画图');
    ctx.putImageData(new ImageData(px, m.w, m.h), 0, 0);
    // 粗的一档(每单位不到 8 像素)小溪细得看不见,不画,省下时间
    drawRealisticRivers(ctx, cur.world, r, { s: m.S, ox: -m.x0, oy: -m.y0, k: m.k }, m.S >= 8, m.look);
    const bitmap = cv.transferToImageBitmap();
    const res: ReliefResponse = { wid: m.wid, job: m.job, y: m.y, bitmap, ms: 0 };
    const transfer: Transferable[] = [bitmap];
    if (m.heights) {
      res.elev = stripHeights(r, P, m.w, m.h);
      res.horizon = horizonSlopes(res.elev, m.w, m.h, m.kmPerPx, m.maxPx);
      transfer.push(res.elev.buffer, res.horizon.buffer);
    }
    res.ms = performance.now() - t0;
    self.postMessage(res, { transfer });
  } catch (err) {
    const res: ReliefResponse = { wid: m.wid, job: m.job, y: m.y, bitmap: null, ms: performance.now() - t0, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(res);
  }
};

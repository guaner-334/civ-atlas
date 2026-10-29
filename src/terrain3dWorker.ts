/// <reference lib="webworker" />
/**
 * 立体地形(地图上框一块立起来看,见 ui/terrain3d/)的后台线程:收到世界以后准备一次(gen/rasterWindow.ts 的 zoomSource、
 * 大尺度晕渲的粗网格),之后一次算方框里的一横条(若干整行):铺像素(多铺一圈)→ 上色 → 裁掉多铺的那圈 → 画上河和小溪,
 * 另交回每个像素的海拔和往西看的地平线坡度(render/terrain3d/relief.ts)。同一条结果一样。
 * 手绘:一条只交回铺好的像素(海拔、年均温、水陆、群落,连多铺的那圈),几条拼成一整块以后交给其中一个线程整块画
 * (render/terrain3d/fantasyBox.ts;纸纹、林块、波纹不在横条接缝处断开)。
 * 最近铺过的几条(粗的、细的)留着:只换画风时不用重新铺像素,只重新上色。
 */
import type { World } from './gen/world';
import type { Raster } from './gen/raster';
import { WINDOW_PAD, rasterizeWindow, zoomSource, type ZoomSource } from './gen/rasterWindow';
import { drawRealisticRivers, macroGrids, realisticWindowPixels, type MacroGrids } from './render/realistic';
import { horizonSlopes, stripHeights, type ReliefLook } from './render/terrain3d/relief';
import { paintFantasyBox, type BoxFields } from './render/terrain3d/fantasyBox';
import type { WholeRaster } from './tileWorker';

export type ReliefRequest =
  /** 换了世界(wid = 第几个世界) */
  | { type: 'world'; wid: number; world: World; whole: WholeRaster }
  /**
   * S 倍主图上从 (x0, y0) 开始的 w × h 像素(方框里第 y 行起的一条);k = 河按几倍缩放的样子画;
   * heights = 要不要交回海拔和地平线(只换画风时不要;'elev' = 只要海拔,地区图找山峰用);
   * kmPerPx、maxPx = 算地平线用(东西方向每像素多少公里、往西最远看几个像素)
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
      look: ReliefLook;
      heights: boolean | 'elev';
      kmPerPx: number;
      maxPx: number;
    }
  /**
   * 手绘:几条拼好的一整块(f 四周多铺了 pad 像素)画成贴图。S 倍主图上方框左上角在 (x0, y0)、w × h;
   * u = 一格几个像素,ax = 东西向拉宽几倍(见 fantasyBox.ts 的 boxStyle)
   */
  | { type: 'fantasy'; wid: number; job: number; S: number; x0: number; y0: number; w: number; h: number; pad: number; u: number; ax: number; f: BoxFields };

export interface ReliefResponse {
  wid: number;
  job: number;
  y: number;
  /** 上好色的一条(w × h;手绘的整块画好了是 0 起的一整块);出错 = null */
  bitmap: ImageBitmap | null;
  /** 手绘的一条:铺好的像素(连多铺的那圈,(w + 2·pad) × (h + 2·pad)),还没上色 */
  raw?: BoxFields;
  elev?: Float32Array;
  horizon?: Float32Array;
  ms: number;
  error?: string;
}

/** plain = 不带河口的那份(手绘照旧,不凹喇叭口、不长三角洲,见 gen/estuary.ts) */
let cur: { wid: number; world: World; src: ZoomSource; plain: ZoomSource; grids: MacroGrids } | null = null;
/** 最近铺过的几条留几条(粗的、细的;地区图那么大的块一个线程轮到几条) */
const KEEP = 4;
/** 最近铺过的几条(编号 → 铺好的像素) */
const recent = new Map<string, Raster>();

self.onmessage = (e: MessageEvent<ReliefRequest>) => {
  const m = e.data;
  if (m.type === 'world') {
    cur = null;
    recent.clear();
    try {
      const src = zoomSource(m.world, m.whole);
      cur = { wid: m.wid, world: m.world, src, plain: { ...src, mouths: [] }, grids: macroGrids(m.whole as Raster) };
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
  const y = m.type === 'strip' ? m.y : 0;
  try {
    if (!cur || cur.wid !== m.wid) throw new Error('世界还没送到');
    if (typeof OffscreenCanvas === 'undefined') throw new Error('后台线程不能画图');
    if (m.type === 'fantasy') {
      // 手绘:拼好的一整块画成贴图
      const cv = new OffscreenCanvas(m.w, m.h);
      const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D | null;
      if (!ctx) throw new Error('后台线程不能画图');
      paintFantasyBox(ctx, cur.world, m.f, m.pad, m.S, m.x0, m.y0, m.u, m.ax);
      const bitmap = cv.transferToImageBitmap();
      const res: ReliefResponse = { wid: m.wid, job: m.job, y: 0, bitmap, ms: performance.now() - t0 };
      self.postMessage(res, { transfer: [bitmap] });
      return;
    }
    const P = WINDOW_PAD;
    const n = m.w + 2 * P;
    // 方框可以在左右相连的哪一圈上、也可以跨过接缝:左边挪到主图那一圈里(铺出来的一样),河按跨过的那一截再画一份
    const Wpx = Math.round(cur.world.width * m.S);
    const x0 = ((m.x0 % Wpx) + Wpx) % Wpx;
    const hand = m.look === 'fantasy';
    const key = `${m.S}/${x0}/${m.y0}/${m.w}/${m.h}/${hand ? 'f' : ''}`;
    let r = recent.get(key);
    if (!r) {
      r = rasterizeWindow(hand ? cur.plain : cur.src, m.S, x0 - P, m.y0 - P, n, m.h + 2 * P);
      recent.set(key, r);
      while (recent.size > KEEP) recent.delete(recent.keys().next().value!);
    }
    if (m.look === 'fantasy') {
      // 手绘:只交回铺好的像素(连多铺的那圈;留着的那份不动,拷一份交出去),拼好了整块画
      const raw: BoxFields = { w: n, h: m.h + 2 * P, elev: r.elev.slice(), temp: r.temp.slice(), water: r.water.slice(), biome: r.biome.slice() };
      const res: ReliefResponse = { wid: m.wid, job: m.job, y, bitmap: null, raw, ms: 0 };
      const transfer: Transferable[] = [raw.elev.buffer, raw.temp.buffer, raw.water.buffer, raw.biome.buffer];
      if (m.heights) {
        res.elev = stripHeights(r, P, m.w, m.h);
        transfer.push(res.elev.buffer);
        if (m.heights === true) {
          res.horizon = horizonSlopes(res.elev, m.w, m.h, m.kmPerPx, m.maxPx);
          transfer.push(res.horizon.buffer);
        }
      }
      res.ms = performance.now() - t0;
      self.postMessage(res, { transfer });
      return;
    }
    const all = realisticWindowPixels(r, cur.grids, m.look);
    const px = new Uint8ClampedArray(m.w * m.h * 4);
    for (let y = 0; y < m.h; y++) px.set(all.subarray(((y + P) * n + P) * 4, ((y + P) * n + P + m.w) * 4), y * m.w * 4);
    const cv = new OffscreenCanvas(m.w, m.h);
    const ctx = cv.getContext('2d') as unknown as CanvasRenderingContext2D | null;
    if (!ctx) throw new Error('后台线程不能画图');
    ctx.putImageData(new ImageData(px, m.w, m.h), 0, 0);
    // 粗的一档(每单位不到 8 像素)小溪细得看不见,不画,省下时间
    const creeks = m.S >= 8;
    drawRealisticRivers(ctx, cur.world, r, { s: m.S, ox: -x0, oy: -m.y0, k: m.k }, creeks, m.look);
    if (x0 + m.w > Wpx && r.win) {
      // 跨过接缝的那一截:主图左边那一圈的河挪一整圈画过来(这一块的水陆跟着挪,河照样只留在陆地上)
      const shifted = { ...r, win: { ...r.win, x0: r.win.x0 - Wpx } };
      drawRealisticRivers(ctx, cur.world, shifted, { s: m.S, ox: Wpx - x0, oy: -m.y0, k: m.k }, creeks, m.look);
    }
    const bitmap = cv.transferToImageBitmap();
    const res: ReliefResponse = { wid: m.wid, job: m.job, y, bitmap, ms: 0 };
    const transfer: Transferable[] = [bitmap];
    if (m.heights) {
      res.elev = stripHeights(r, P, m.w, m.h);
      transfer.push(res.elev.buffer);
      if (m.heights === true) {
        res.horizon = horizonSlopes(res.elev, m.w, m.h, m.kmPerPx, m.maxPx);
        transfer.push(res.horizon.buffer);
      }
    }
    res.ms = performance.now() - t0;
    self.postMessage(res, { transfer });
  } catch (err) {
    const res: ReliefResponse = { wid: m.wid, job: m.job, y, bitmap: null, ms: performance.now() - t0, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(res);
  }
};

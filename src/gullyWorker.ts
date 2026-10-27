/// <reference lib="webworker" />
/**
 * 帮手线程:整张主图山坡上的沟和山脊(gen/gully.ts 的 gullyHeights)是铺像素里最慢的一步,
 * 生成世界、导出大图、地球仪贴图的后台线程把要算的像素分成几段,各交给一个帮手线程(gullyPool.ts)。
 * 细沟(gen/pixelDrain.ts 的 veinsOf,逐像素汇流)整件交给其中一个。
 * 新建世界时写实画风的整张像素层也按整行分带子交过来上色(render/realistic.ts 的 realisticWindowPaint)。
 * 纯计算,结果和一次算完一样。
 */
import { gullyHeights, type GullyInput } from './gen/gully';
import { streamBeds, veinsOf, type DrainLines, type StreamBeds, type Streams, type VeinJob } from './gen/pixelDrain';
import type { Raster } from './gen/raster';
import { realisticWindowPaint, windowTransferables, type MacroGrids } from './render/realistic';
import type { SurfaceLook } from './render/surface';

/**
 * job = 一段沟壑;beds = 先把细沟要的河、溪浅谷算着(不回话,记下来);
 * veins = 细沟(bedsKey = 用先算好的那份浅谷);
 * paint = 写实像素层的一条带子(win = 连同余量切出来的一块;grids = 整张图的粗网格,同一张图只在第一条带子里带,之后按 gridsKey 认);
 * paintEnd = 这张图画完了(不回话):粗网格放掉
 */
export type GullyRequest =
  | { id: number; job: GullyInput }
  | { id: number; beds: { streams: Streams; w: number; h: number; scale: number } }
  | { id: number; veins: VeinJob; bedsKey?: number }
  | { id: number; paint: { win: Raster; look: SurfaceLook; gridsKey: number; grids?: MacroGrids } }
  | { id: number; paintEnd: true };

/**
 * paint 的回话:px / raw 见 realisticWindowPaint;null = 没画(没认出粗网格,发的那边自己画)。
 * win = 发来的那一块原样交回去(切下一块时拷进它的数组里,两边都不用每块另分配)
 */
export type GullyResponse =
  | { id: number; out: Float32Array }
  | { id: number; veins: { lines: DrainLines; vein: Uint8Array } }
  | { id: number; painted: { px: Uint8ClampedArray; raw: Uint8ClampedArray } | null; win: Raster };

// 加载好了:告诉开它的线程(开始重活之前在等)
self.postMessage({ ready: true });

/** 先算好的河、溪浅谷(按发来时的编号认) */
let prepared: { key: number; beds: StreamBeds } | null = null;
/** 正在画的那张图的粗网格 */
let grids: { key: number; grids: MacroGrids } | null = null;

self.onmessage = (e: MessageEvent<GullyRequest>) => {
  const m = e.data;
  if ('paint' in m) {
    const p = m.paint;
    if (p.grids) grids = { key: p.gridsKey, grids: p.grids };
    const g = grids?.key === p.gridsKey ? grids.grids : null;
    const got = g && realisticWindowPaint(p.win, g, p.look, true);
    const res: GullyResponse = { id: m.id, painted: got && { px: got.px, raw: got.raw! }, win: p.win };
    self.postMessage(res, { transfer: [...(got ? [got.px.buffer, got.raw!.buffer] : []), ...windowTransferables(p.win)] });
    return;
  }
  // 画完了、来了别的活(下一个世界的沟壑……):那张图的粗网格不用留着了
  grids = null;
  if ('paintEnd' in m) return;
  if ('beds' in m) {
    const { streams, w, h, scale } = m.beds;
    prepared = { key: m.id, beds: streamBeds(streams, w, h, scale) };
    return;
  }
  if ('veins' in m) {
    const beds = m.bedsKey !== undefined && prepared?.key === m.bedsKey ? prepared.beds : undefined;
    prepared = null;
    const v = veinsOf(m.veins, beds);
    const res: GullyResponse = { id: m.id, veins: v };
    self.postMessage(res, { transfer: [v.vein.buffer, v.lines.off.buffer, v.lines.x.buffer, v.lines.y.buffer, v.lines.a.buffer] });
    return;
  }
  const out = gullyHeights(m.job, 0, m.job.idx.length);
  const res: GullyResponse = { id: m.id, out };
  self.postMessage(res, { transfer: [out.buffer] });
};

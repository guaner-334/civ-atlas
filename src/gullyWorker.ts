/// <reference lib="webworker" />
/**
 * 帮手线程:整张主图山坡上的沟和山脊(gen/gully.ts 的 gullyHeights)是铺像素里最慢的一步,
 * 生成世界、导出大图、地球仪贴图的后台线程把要算的像素分成几段,各交给一个帮手线程(gullyPool.ts)。
 * 细沟(gen/pixelDrain.ts 的 veinsOf,逐像素汇流)整件交给其中一个。纯计算,结果和一次算完一样。
 */
import { gullyHeights, type GullyInput } from './gen/gully';
import { streamBeds, veinsOf, type DrainLines, type StreamBeds, type Streams, type VeinJob } from './gen/pixelDrain';

/**
 * job = 一段沟壑;beds = 先把细沟要的河、溪浅谷算着(不回话,记下来);
 * veins = 细沟(bedsKey = 用先算好的那份浅谷)
 */
export type GullyRequest =
  | { id: number; job: GullyInput }
  | { id: number; beds: { streams: Streams; w: number; h: number; scale: number } }
  | { id: number; veins: VeinJob; bedsKey?: number };

export type GullyResponse = { id: number; out: Float32Array } | { id: number; veins: { lines: DrainLines; vein: Uint8Array } };

// 加载好了:告诉开它的线程(开始重活之前在等)
self.postMessage({ ready: true });

/** 先算好的河、溪浅谷(按发来时的编号认) */
let prepared: { key: number; beds: StreamBeds } | null = null;

self.onmessage = (e: MessageEvent<GullyRequest>) => {
  const m = e.data;
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

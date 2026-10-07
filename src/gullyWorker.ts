/// <reference lib="webworker" />
/**
 * 生成线程(worker.ts)的帮手:整张主图山坡上的沟和山脊(gen/gully.ts 的 gullyHeights)是铺像素里最慢的一步,
 * 生成线程把要算的像素分成几段,各交给一个帮手线程,自己同时推文明。纯计算,结果和一次算完一样。
 */
import { gullyHeights, type GullyInput } from './gen/gully';

export interface GullyRequest {
  id: number;
  job: GullyInput;
}

export interface GullyResponse {
  id: number;
  out: Float32Array;
}

self.onmessage = (e: MessageEvent<GullyRequest>) => {
  const { id, job } = e.data;
  const out = gullyHeights(job, 0, job.idx.length);
  const res: GullyResponse = { id, out };
  self.postMessage(res, { transfer: [out.buffer] });
};

/// <reference lib="webworker" />
/**
 * 地球仪的云图(后台线程):按种子和降水图画一张 1024×512 的全球云量图(render/clouds.ts),交回主线程当贴图。
 * 画一张约一秒;每次临时开一个,画完就关,界面不卡。
 */
import { bakeClouds } from './render/clouds';

export interface CloudRequest {
  seed: number;
  /** 降水干湿图 0–1(render/clouds.ts 的 WET_W × WET_H);不给 = 只按纬度和噪声 */
  wet?: Float32Array | null;
}

export type CloudResponse = { ok: true; data: Uint8Array; ms: number } | { ok: false; error: string };

self.onmessage = (e: MessageEvent<CloudRequest>) => {
  try {
    const t0 = performance.now();
    const data = bakeClouds(e.data.seed, e.data.wet);
    const res: CloudResponse = { ok: true, data, ms: performance.now() - t0 };
    self.postMessage(res, { transfer: [data.buffer] });
  } catch (err) {
    const res: CloudResponse = { ok: false, error: err instanceof Error ? err.message : String(err) };
    self.postMessage(res);
  }
};

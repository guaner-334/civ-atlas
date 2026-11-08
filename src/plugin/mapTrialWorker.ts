/// <reference lib="webworker" />
/**
 * 帮手试跑地图插件的后台线程(ui/helperTrial.tsx 开,一个种子一个,跑完就关):照 mapTrial.ts 在示例世界(默认参数)上跑一遍。
 * 每做完一步交一次 step(到时被停掉时帮手用最后一次的)。
 */
import { DEFAULT_PARAMS } from '../gen/params';
import { quickjsMapBox } from '../mapPluginRun';
import { trialMap, type MapTrialSeed } from './mapTrial';
import type { MapPluginFile } from './pluginWorld';

export interface MapTrialJob {
  seed: number;
  /** 带字节、滑条照清单补齐 */
  file: MapPluginFile & { bytes: Uint8Array };
}

export type MapTrialReply = { type: 'step'; result: MapTrialSeed } | { type: 'done'; result: MapTrialSeed } | { type: 'failed'; error: string };

const post = (r: MapTrialReply) => self.postMessage(r);

self.onmessage = async (e: MessageEvent<MapTrialJob>) => {
  try {
    const result = await trialMap({ ...DEFAULT_PARAMS, seed: e.data.seed }, e.data.file, quickjsMapBox, { report: (r) => post({ type: 'step', result: r }) });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
};

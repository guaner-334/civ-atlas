/// <reference lib="webworker" />
/**
 * 帮手试跑推演插件的后台线程(ui/helperTrial.tsx 开,一个种子一个,跑完就关):生成示例世界(默认参数),照 simTrial.ts 跑一遍。
 * 每做完一步交一次 step(到时被停掉时帮手用最后一次的);带插件推出来就交 civ(截图用:那段历史和它第一个图层在最后一年的样子)。
 */
import type { Civ } from '../gen/civ/types';
import { DEFAULT_PARAMS, generateWorld } from '../gen/world';
import type { CellPaint } from '../render/pluginLayer';
import { quickjsBox } from '../simPluginRun';
import type { SimPluginFile } from './pluginWorld';
import { simLayerPaint, trialSim, type SimTrialSeed } from './simTrial';

export interface SimTrialJob {
  seed: number;
  files: SimPluginFile[];
}

export type SimTrialReply =
  | { type: 'step'; result: SimTrialSeed }
  | { type: 'civ'; civ: Civ; paint: CellPaint | null }
  | { type: 'done'; result: SimTrialSeed }
  | { type: 'failed'; error: string };

const post = (r: SimTrialReply) => self.postMessage(r);

self.onmessage = async (e: MessageEvent<SimTrialJob>) => {
  try {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: e.data.seed });
    const { civ: _civ, ...result } = await trialSim(world, e.data.files, quickjsBox, {
      report: (r) => post({ type: 'step', result: r }),
      ran: (civ) => post({ type: 'civ', civ, paint: simLayerPaint(civ, Math.floor(civ.endYear)) }),
    });
    void _civ;
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
};

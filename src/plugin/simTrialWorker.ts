/// <reference lib="webworker" />
/**
 * 帮手试跑推演插件的后台线程(ui/helperTrial.tsx 开,一个种子一个,跑完就关):生成示例世界(默认参数),照 simTrial.ts 跑一遍。
 * 每做完一步交一次 step(到时被停掉时帮手用最后一次的);带插件推出来就交 civ(出图用:带插件和官方推的两段历史)。
 */
import type { Civ } from '../gen/civ/types';
import { DEFAULT_PARAMS, generateWorld } from '../gen/world';
import { quickjsBox } from '../simPluginRun';
import type { SimPluginFile } from './pluginWorld';
import { trialSim, type SimTrialSeed } from './simTrial';

export interface SimTrialJob {
  seed: number;
  files: SimPluginFile[];
}

export type SimTrialReply =
  | { type: 'step'; result: SimTrialSeed }
  | { type: 'civ'; civ: Civ; official: Civ }
  | { type: 'done'; result: SimTrialSeed }
  | { type: 'failed'; error: string };

const post = (r: SimTrialReply) => self.postMessage(r);

self.onmessage = async (e: MessageEvent<SimTrialJob>) => {
  try {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: e.data.seed });
    const { civ: _civ, ...result } = await trialSim(world, e.data.files, quickjsBox, {
      report: (r) => post({ type: 'step', result: r }),
      ran: (civ, official) => post({ type: 'civ', civ, official }),
    });
    void _civ;
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'failed', error: err instanceof Error ? err.message : String(err) });
  }
};

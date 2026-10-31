/**
 * 数值填色图层的清单(每份定义见 numLayer.ts):时代、管辖、思潮。地图色块、导出图例按这个先后挑开着的那一种。
 */
import type { Civ } from '../../gen/civ/types';
import type { CivShow } from './show';
import type { NumLayer } from './numLayer';
import { ERA_LAYER } from './era';
import { CONTROL_LAYER } from './control';
import { THOUGHT_LAYER } from './thoughts';

export const NUM_LAYERS: readonly NumLayer[] = [ERA_LAYER, CONTROL_LAYER, THOUGHT_LAYER];

type NumShow = Pick<CivShow, NumLayer['id'] | 'faiths'>;

/** 开着的那种数值填色(这个世界没有那种数的不算;都没开 = null) */
export function numLayerShown(civ: Civ, show: NumShow): NumLayer | null {
  for (const l of NUM_LAYERS) if (show[l.id] && l.has(civ)) return l;
  return null;
}

/** 地图上铺的是哪种数值填色:同 numLayerShown,只是信仰也开着时让给信仰的那种不算 */
export function numLayerDrawn(civ: Civ, show: NumShow): NumLayer | null {
  for (const l of NUM_LAYERS) if (show[l.id] && l.has(civ) && !(l.belowFaith && show.faiths)) return l;
  return null;
}

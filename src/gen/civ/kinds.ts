/**
 * 民族类型和住人门槛里推演要用的两样数(cultures.ts、polities.ts 读;界面上的中文名、说明在 story/display.ts)。
 * 单独一个小文件,只引类型:界面也要读住人门槛,不用跟着带上推演代码。
 */
import type { CultureKind } from './types';

/** 治所宜居分 ≥ 这个值的州才算可居(民族只在这样的州定居;和"城址"显示的门槛一致) */
export const HABITABLE_SUIT = 1;

/** 七种民族类型的扩张性基数(Azgaar) */
export const KIND_EXPANSIONISM: Record<CultureKind, number> = {
  farm: 1,
  nomad: 1.5,
  sea: 1.5,
  highland: 1.2,
  river: 0.9,
  lake: 0.8,
  forest: 0.7,
};

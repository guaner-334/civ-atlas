/**
 * 地理图(分层设色,像地图册)的层色:地图上铺的(realistic.ts)和左上角的海拔色标(dataLegend.ts)共用这一份,
 * 色标上的颜色和地图上一档一档对得上。
 */
import type { RGB } from './common';

const hexRGB = (s: string): RGB => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** 陆地分层:每层的上界(米),最后一层(5000 米以上)没有上界 */
export const HYPSO_EDGES = [200, 500, 1000, 2000, 3000, 4000, 5000];
/** 陆地各层的颜色:绿 → 黄绿 → 浅黄 → 橙黄 → 橙 → 褐 → 深褐 → 近白 */
export const HYPSO = ['#86b874', '#acce86', '#dcdd9c', '#ecd08d', '#dfaa6d', '#c48a5c', '#a7745a', '#ece8e4'].map(hexRGB);
/** 积雪、冰盖 */
export const HYPSO_SNOW = hexRGB('#f4f7fa');
/** 干旱低地混进去的沙黄 */
export const HYPSO_ARID = hexRGB('#e8dbab');
/** 荒漠的点状符号 */
export const STIPPLE = hexRGB('#9a6a3a');
/** 海按深度分层:每层的下界(米;由深到浅),最深一层没有下界 */
export const ATLAS_SEA_EDGES = [-6000, -5000, -4000, -3000, -2000, -1000, -200];
/** 海各层的颜色(由深到浅) */
export const ATLAS_SEA = ['#3a74aa', '#4683b8', '#5493c5', '#65a3d0', '#78b3da', '#8ec3e3', '#aad4ec', '#cbe6f4'].map(hexRGB);
/** 河 */
export const ATLAS_RIVER = 'rgb(48, 118, 190)';

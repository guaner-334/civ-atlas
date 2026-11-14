/**
 * 地图插件清单 map.reads 能写的名字:写了才递,和这个数从哪一口起才有。
 * 读清单的代码和生成线程都用,所以单放一个不带别的代码的文件
 */
type Stage = 'height' | 'climate' | 'layers';

const ALL: readonly Stage[] = ['height', 'climate', 'layers'];
const FROM_CLIMATE: readonly Stage[] = ['climate', 'layers'];
const LAYERS: readonly Stage[] = ['layers'];

export const MAP_READS: Readonly<Record<string, readonly Stage[]>> = {
  plateVx: ALL,
  plateVy: ALL,
  plateOmega: ALL,
  plateContinental: ALL,
  convergence: ALL,
  convergentKm: ALL,
  convergentStrength: ALL,
  divergentKm: ALL,
  divergentStrength: ALL,
  uplift: ALL,
  plateau: ALL,
  oceanDepth: ALL,
  cellArea: ALL,
  worldParams: ALL,
  edited: ALL,
  currentU: FROM_CLIMATE,
  currentV: FROM_CLIMATE,
  currentTemp: FROM_CLIMATE,
  downstream: LAYERS,
  fillLevel: LAYERS,
  runoff: LAYERS,
  wetland: LAYERS,
  maxElevation: LAYERS,
};

/** 清单最多写几样 */
export const MAP_READS_MAX = 64;

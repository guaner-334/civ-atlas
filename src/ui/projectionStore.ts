/**
 * 主图的投影、经纬网、等值线这些界面状态(小 store,不画东西;画图的部分和这些一起从 projection.ts 导出,说明见那边的文件头)。
 * 单独一个文件:存档(saveStore.ts)、首页只用到这些状态,不用带上按投影画地图的代码。
 */
import { GRATICULE_STEPS, type ContourKind } from '../gen/savefile';
import { isProjectionId, type ProjectionId } from '../render/projectionDefs';
import { createStore } from './createStore';

/** 主图的投影;'globe' = 3D 地球仪(单独的视图) */
export type MapProjection = ProjectionId | 'globe';

/** 地球仪视图可用("图层与投影"弹层的投影里列"地球仪";网址、存档里的 globe 照样打开) */
export const GLOBE_READY = true;

export function isMapProjection(x: unknown): x is MapProjection {
  return x === 'globe' || isProjectionId(x);
}

/** 平面地图用哪种投影画:地球仪时底下的平面地图按等距圆柱画 */
export function flatProjection(p: MapProjection): ProjectionId {
  return p === 'globe' ? 'equirect' : p;
}

/** 弯边(非等距圆柱)的平面投影:整图重投影、左右拖动改中心 */
export function isCurved(p: MapProjection): p is Exclude<ProjectionId, 'equirect'> {
  return p !== 'equirect' && p !== 'globe';
}

// ---------------------------------------------------------------------------
// 小 store

const projection = createStore<MapProjection>('equirect');
export const getProjection = projection.get;
export const useProjection = projection.use;
/** 切到地球仪之前用的平面投影(从地球仪切回平面时回到它) */
let lastFlat: ProjectionId = 'equirect';
/** flat:连"上一个平面投影"一起指定(换回原来的地球仪时,把它原来的平面投影也还原) */
export function setProjection(p: MapProjection, flat?: ProjectionId): void {
  const cur = projection.get();
  if (cur !== 'globe') lastFlat = cur;
  if (flat) lastFlat = flat;
  projection.set(isMapProjection(p) ? p : 'equirect');
}
/** 上一个平面投影(现在就是平面的 = 它自己) */
export function lastFlatProjection(): ProjectionId {
  const cur = projection.get();
  return cur === 'globe' ? lastFlat : cur;
}

/** 经纬网:平面投影和地球仪共用一个开关("图层与投影"弹层、新建世界的"投影"里的"经纬网"改它;网址 grat=1) */
const graticule = createStore(false);
export const getGraticule = graticule.get;
export const useGraticule = graticule.use;
export const setGraticule = graticule.set;

/** 经纬网每隔几度一条(开关旁边选;网址 grat=10 / 15,30 = grat=1) */
export { GRATICULE_STEPS };
export type GraticuleStep = (typeof GRATICULE_STEPS)[number];
export function isGraticuleStep(x: unknown): x is GraticuleStep {
  return GRATICULE_STEPS.includes(x as GraticuleStep);
}
const gratStep = createStore<GraticuleStep>(30);
export const getGraticuleStep = gratStep.get;
export const useGraticuleStep = gratStep.use;
export const setGraticuleStep = gratStep.set;

/** 要画的经纬网:开着 = 每隔几度,关着 = 0(画地图、导出、回放都按它) */
export function getGraticuleLines(): number {
  return graticule.get() ? gratStep.get() : 0;
}
export function useGraticuleLines(): number {
  const on = graticule.use();
  const step = gratStep.use();
  return on ? step : 0;
}

/** 等值线:叠哪一种(null = 不画;"图层与投影"弹层里的"等值线"改它;网址 iso=elev / temp / precip) */
const contours = createStore<ContourKind | null>(null);
export const getContourKind = contours.get;
export const useContourKind = contours.use;
export const setContourKind = contours.set;

const moving = createStore(false);
export const getMapMoving = moving.get;
export const useMapMoving = moving.use;
export const setMapMoving = moving.set;

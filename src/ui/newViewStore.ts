/**
 * 「设为新建时的默认」(新建页右边经纬网下面;手机上样式、投影列表底下):把现在的样式、投影、经纬网(开关和间隔)
 * 记成以后新建世界一进来的样子。只管新建页一进来的样子(和创建以后地图用的投影);打开存档、分享链接都照它们自己的。
 * 没设过 = 原来的样子(实景、地球仪、经纬网照旧)。存在这个浏览器里。
 */
import { createListeners } from './createStore';
import type { MapLayer } from './mapLayers';
import type { PlanetProjection } from '../render/planet';
import { isGraticuleStep, type GraticuleStep } from './projection';

export interface NewView {
  style: MapLayer;
  proj: PlanetProjection;
  grat: boolean;
  step: GraticuleStep;
}

const KEY = 'wenming-ditu:new-view';
const STYLES: string[] = ['realistic', 'terrain', 'biomes', 'elevation', 'plates', 'temperature', 'precipitation'];
const PROJS: string[] = ['globe', 'equirect', 'robinson', 'naturalEarth', 'mollweide', 'mercator'];

function load(): NewView | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<NewView>;
    if (!STYLES.includes(o.style as string) || !PROJS.includes(o.proj as string)) return null;
    return {
      style: o.style as MapLayer,
      proj: o.proj as PlanetProjection,
      grat: !!o.grat,
      step: isGraticuleStep(o.step) ? o.step : 30,
    };
  } catch {
    return null;
  }
}

let state: NewView | null | undefined;
const subs = createListeners();
const get = () => (state === undefined ? (state = load()) : state);

export function getNewView(): NewView | null {
  return get();
}

export function useNewView(): NewView | null {
  return subs.use(get);
}

/** 记下(null = 回到没设过) */
export function setNewView(v: NewView | null) {
  state = v;
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式:只管这一次 */
  }
  subs.emit();
}

export const sameView = (a: NewView | null, b: NewView) =>
  !!a && a.style === b.style && a.proj === b.proj && a.grat === b.grat && (!b.grat || a.step === b.step);

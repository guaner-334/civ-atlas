/**
 * 回放导出(视频、竖版长图)要的世界:App 把"第 year 年那一段的世界、主图、历史"交到这里,导出面板按年份取。
 *
 * 有地形大事的世界分几段(eras.ts):放到大事那一年,地形、州、地名、道路跟着换,和屏幕上拖时间轴一样;
 * 那一段的主图还在后台铺时,先用前面铺好了的那一段(三样对得上)。
 * 不碰 DOM。
 */
import { useSyncExternalStore } from 'react';
import type { Civ } from '../gen/civ/types';
import type { Raster } from '../gen/raster';
import type { World } from '../gen/world';
import type { MapProj } from '../render/projection';

export interface FilmScene {
  /** 第几段(同一段 = 同一份世界和主图,地形不用重画) */
  k: number;
  world: World;
  raster: Raster;
  /** 那一段的历史,套过改名、挂着整段历史(地图文字、编年史用) */
  civ: Civ;
  /** 同一段,没套改名(文明底图用;和屏幕上的地图一样) */
  geo: Civ;
}

export interface FilmSource {
  /** 整段历史(套过改名):编年史、字幕、长图的大事按它 */
  full: Civ;
  /** 第 year 年那一段 */
  at(year: number): FilmScene;
  /**
   * 各段的主图都铺好了(没有地形大事的世界一直是 true)。还没铺好时 at() 先用前面那一段,
   * 预览可以这样凑合,导出的视频、长图要等它变成 true(铺好时 App 会换一份新的 FilmSource)
   */
  ready: boolean;
}

let source: FilmSource | null = null;
const subs = new Set<() => void>();

export function setFilmSource(s: FilmSource | null) {
  if (s === source) return;
  source = s;
  for (const f of subs) f();
}

export const getFilmSource = () => source;

/** 等到各段的主图都铺好,交回那时的 FilmSource(没有世界了 = null) */
export function whenFilmReady(): Promise<FilmSource | null> {
  if (!source || source.ready) return Promise.resolve(source);
  return new Promise((resolve) => {
    const f = () => {
      if (source && !source.ready) return;
      subs.delete(f);
      resolve(source);
    };
    subs.add(f);
  });
}

export function useFilmSource(): FilmSource | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => source,
  );
}

/** 屏幕上的地图现在怎么摆(拍框里一块时按它把框换成地图上的范围) */
export interface FilmViewport {
  /** 缩放倍数 */
  k: number;
  /** 缩放 1 倍时地图显示多宽(CSS 像素) */
  mapCss: number;
  /** 弯边投影(等距圆柱 = null) */
  mp: MapProj | null;
  /** 页面坐标 → 地图平面坐标(等距圆柱 = 展开的世界坐标,x 可以超出世界左右) */
  plane(cx: number, cy: number): [number, number];
  /** 世界多宽(世界单位;等距圆柱时框伸出世界左边,挪一整圈) */
  worldW: number;
  /** 视图的指纹(平移、缩放、换投影就变) */
  key: string;
}

let viewport: (() => FilmViewport | null) | null = null;

/** App 交一个"现在的视图"的取值函数(读它自己的 ref,随时取都是最新的) */
export function setFilmViewport(f: (() => FilmViewport | null) | null) {
  viewport = f;
}

export const getFilmViewport = (): FilmViewport | null => viewport?.() ?? null;

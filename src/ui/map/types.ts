import type { Pt } from '../gestures';

/** 地图现在的几何(App 每次渲染时更新;事件、动画的回调里读最新的这一份) */
export interface MapGeo {
  /** 一整圈的世界宽度(东西相连;还没有世界时 0) */
  wrap: number;
  /** 地图框(缩放 1 倍时)的宽、高,CSS 像素 */
  bw: number;
  bh: number;
  /** 世界的宽、高(世界坐标) */
  W: number;
  H: number;
  /** 窄屏底部被卡片和时间轴胶囊盖住、地图可以往上推进的那一截(见 mapWrap.ts 的 StageBox.padB) */
  padB: number;
}

/** 按下时的位置(屏幕坐标)、视图的平移量 vx / vy、中央经线 lon;touch = 手指按的 */
export interface MapDrag {
  x: number;
  y: number;
  vx: number;
  vy: number;
  lon: number;
  touch?: boolean;
}

/** 双指捏合:上一次用到的两指位置、排着的那一帧 */
export interface MapPinch {
  a: Pt;
  b: Pt;
  raf: number;
}

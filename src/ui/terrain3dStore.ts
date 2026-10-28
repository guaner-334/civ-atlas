/**
 * 立体地形的开关(框一块地方立起来看;画面和计算都在 ui/terrain3d/ 里,点「立体」时才下载):
 *   off  → 平常的地图
 *   pick → 在地图上框一块(电脑:框在地图上,能挪、能拖边角改大小、能重新拖一个;手机:框固定在屏幕正中,挪地图对准)
 *   view → 立体模式:和地球仪一样占住地图那一块(手机占满整屏),时间轴的位置换成立体的控件
 * 地球仪、弯边投影时点「立体」先换回平面地图(框按平面地图那一块算)。
 */
import { useSyncExternalStore } from 'react';
import type { ReliefBox } from '../render/terrain3d/box';
import { getProjection, setProjection } from './projection';
import { stopPlacing } from './markStore';

export type ReliefPhase = 'off' | 'pick' | 'view';

export interface ReliefUi {
  phase: ReliefPhase;
  /** 立起来的那一块(view 时有) */
  box: ReliefBox | null;
  /** 点「立起来看」的时刻(performance.now();测"点了到能转"用) */
  at: number;
}

let state: ReliefUi = { phase: 'off', box: null, at: 0 };
const subs = new Set<() => void>();
function set(next: ReliefUi) {
  state = next;
  for (const f of subs) f();
}

export function getRelief(): ReliefUi {
  return state;
}

export function useRelief(): ReliefUi {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getRelief,
    getRelief,
  );
}

/** 开始框(地球仪、弯边投影先换回平面地图;正在放标记的收起) */
export function openReliefPick(): void {
  if (getProjection() !== 'equirect') setProjection('equirect');
  stopPlacing();
  set({ phase: 'pick', box: state.box, at: 0 });
}

/** 立起来看这一块 */
export function openReliefView(box: ReliefBox): void {
  set({ phase: 'view', box, at: performance.now() });
}

/** 不用框,直接立起来看这一块(山脉卡片的「看立体」;地球仪、弯边投影先换回平面地图,正在放标记的收起) */
export function openReliefAt(box: ReliefBox): void {
  if (getProjection() !== 'equirect') setProjection('equirect');
  stopPlacing();
  openReliefView(box);
}

/** 回到平常的地图 */
export function closeRelief(): void {
  if (state.phase !== 'off') set({ phase: 'off', box: state.box, at: 0 });
}

/** 右下(手机右上)的「立体」:没开 = 开始框;框着 / 立着 = 回到地图 */
export function toggleRelief(): void {
  if (state.phase === 'off') openReliefPick();
  else closeRelief();
}

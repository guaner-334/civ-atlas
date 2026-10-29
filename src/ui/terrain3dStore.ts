/**
 * 「地区」:框一块地方单独看(画面和计算都在 ui/terrain3d/ 里,点「地区」时才下载):
 *   off  → 平常的地图
 *   pick → 在地图上框一块(电脑:框在地图上,能挪、能拖边角改大小、能重新拖一个;手机:框固定在屏幕正中,挪地图对准)
 *   view → 地区模式:和地球仪一样占住地图那一块(手机占满整屏),时间轴的位置换成地区模式的控件;
 *          同一个框两种看法(face):平面图(地区图,一页图摆在地图的位置上)/ 立体(框好的一块立起来转着看),底条上来回切
 * 地球仪、弯边投影时点「地区」先换回平面地图(框按平面地图那一块算)。
 * 回到地图时刚才的框在地图上淡淡留 2 秒(ghost)。
 */
import { useSyncExternalStore } from 'react';
import type { ReliefBox } from '../render/terrain3d/box';
import { getProjection, setProjection } from './projection';
import { stopPlacing } from './markStore';
import { getCivTime } from './civView';

export type ReliefPhase = 'off' | 'pick' | 'view';
/** 地区模式看的哪一面:平面图(地区图)/ 立体 */
export type AreaFace = 'flat' | 'relief';

export interface ReliefUi {
  phase: ReliefPhase;
  /** 框的那一块(view 时有;回到地图以后留着,再点「地区」框还在刚才的位置) */
  box: ReliefBox | null;
  /** 点「看这一块」的时刻(performance.now();测"点了到能看"用) */
  at: number;
  face: AreaFace;
  /** 地区图的标题:改过的;null = 按框里最显眼的地名起(换了框就回到 null) */
  title: string | null;
  /** 进地区模式时时间轴停在哪一年(地区图画这一年;null = 最后一年) */
  year: number | null;
  /** 刚回到地图:刚才的框淡淡留一会儿(回到地图的时刻) */
  ghost: { box: ReliefBox; at: number } | null;
}

let state: ReliefUi = { phase: 'off', box: null, at: 0, face: 'flat', title: null, year: null, ghost: null };
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

const sameBox = (a: ReliefBox | null, b: ReliefBox | null) => !!a && !!b && a.cx === b.cx && a.cy === b.cy && a.w === b.w && a.h === b.h;

/** 开始框(地球仪、弯边投影先换回平面地图;正在放标记的收起) */
export function openReliefPick(): void {
  if (getProjection() !== 'equirect') setProjection('equirect');
  stopPlacing();
  set({ ...state, phase: 'pick', at: 0, ghost: null });
}

/** 看这一块:face = 先看哪一面(「看这一块」= 平面图;山脉卡片的「看立体」= 立体) */
export function openReliefView(box: ReliefBox, face: AreaFace = 'flat'): void {
  const t = getCivTime().year;
  set({ ...state, phase: 'view', box, at: performance.now(), face, title: sameBox(box, state.box) ? state.title : null, year: t ?? null, ghost: null });
}

/** 不用框,直接立起来看这一块(山脉卡片的「看立体」;地球仪、弯边投影先换回平面地图,正在放标记的收起) */
export function openReliefAt(box: ReliefBox): void {
  if (getProjection() !== 'equirect') setProjection('equirect');
  stopPlacing();
  openReliefView(box, 'relief');
}

/** 底条上的「平面图 | 立体」 */
export function setReliefFace(face: AreaFace): void {
  if (state.phase === 'view' && state.face !== face) set({ ...state, face, at: performance.now() });
}

/** 改地区图的标题(空的 = 回到按地名起的) */
export function setRegionTitle(title: string): void {
  const t = title.trim();
  set({ ...state, title: t ? t : null });
}

/** 回到平常的地图(从地区模式回来时刚才的框淡淡留一会儿) */
export function closeRelief(): void {
  if (state.phase === 'off') return;
  set({ ...state, phase: 'off', at: 0, ghost: state.phase === 'view' && state.box ? { box: state.box, at: performance.now() } : null });
}

/** 框淡完了 */
export function clearReliefGhost(): void {
  if (state.ghost) set({ ...state, ghost: null });
}

/** 右下(手机右上)的「地区」:没开 = 开始框;框着 / 看着 = 回到地图 */
export function toggleRelief(): void {
  if (state.phase === 'off') openReliefPick();
  else closeRelief();
}

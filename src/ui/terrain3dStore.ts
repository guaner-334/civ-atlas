/**
 * 「地区」:框一块地方单独看(画面和计算都在 ui/terrain3d/ 里,点「地区」时才下载):
 *   off  → 平常的地图
 *   pick → 在地图上框一块(电脑:框在地图上,能挪、能拖边角改大小、能重新拖一个;手机:框固定在屏幕正中,挪地图对准)
 *   view → 地区模式:和地球仪一样占住地图那一块(手机占满整屏),时间轴的位置换成地区模式的控件;
 *          同一个框两种看法(face):平面图(地区图,一页图摆在地图的位置上)/ 立体(框好的一块立起来转着看),底条上来回切
 * 地球仪、弯边投影时点「地区」先换回平面地图(框按平面地图那一块算)。
 * 回到地图时刚才的框在地图上淡淡留 2 秒(ghost)。
 * 地区模式写进网址(框、哪一面、立体的角度和起伏,见 areaLink.ts):刷新、复制网址、分享链接打开还是这一块的这一面(App 打开世界后调 openAreaLink)。
 * 导出立体这一面:立体那一面开着时登记怎么导出(setReliefExporter),导出菜单(电脑)和立体上的「导出」(手机)调 exportReliefView。
 */
import { useSyncExternalStore } from 'react';
import { clampBox, type ReliefBox } from '../render/terrain3d/box';
import type { ReliefAngle } from '../render/terrain3d/camera';
import { getProjection, setProjection } from './projection';
import { stopPlacing } from './markStore';
import { getCivTime } from './civView';
import { navUrl } from './nav';
import { readAreaLink, writeAreaLink, type AreaLink } from './areaLink';

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
  const prev = state;
  state = next;
  if (prev.phase !== next.phase || prev.box !== next.box || prev.face !== next.face) syncUrl();
  for (const f of subs) f();
}

/** 网址带来的立体角度、起伏:立体那一面打开时用一次(takeLinkAngle) */
let linkAngle: { angle: ReliefAngle | null; ex: number | null } | null = null;

/** 框、哪一面换了:写进网址(换了框、换了一面,立体的角度等立体那一面画出来再写;网址带来的还没用掉就照留) */
function syncUrl(): void {
  if (typeof location === 'undefined') return;
  const s = state;
  const keep = s.face === 'relief' ? linkAngle : null;
  const link: AreaLink | null = s.phase === 'view' && s.box ? { box: s.box, face: s.face, angle: keep?.angle ?? null, ex: keep?.ex ?? null } : null;
  writeUrl(link);
}

/** 网址里的地区模式换成 link(逗号照写,不转成 %2C;# 后面的照留) */
function writeUrl(link: AreaLink | null): void {
  const q = new URLSearchParams(location.search);
  const next = writeAreaLink(q, link).toString().replace(/%2C/gi, ',');
  if (next !== q.toString().replace(/%2C/gi, ',')) navUrl(location.pathname + (next ? `?${next}` : '') + location.hash);
}

/** 立体转过、拉过滑条(停下来约半秒,View 调):角度和起伏写进网址 */
export function writeReliefAngle(angle: ReliefAngle, ex: number): void {
  const s = state;
  if (typeof location === 'undefined' || s.phase !== 'view' || s.face !== 'relief' || !s.box) return;
  writeUrl({ box: s.box, face: 'relief', angle, ex });
}

/** 立体那一面打开时:网址带来的角度、起伏(只给一次;没有 = null,按刚打开时的) */
export function takeLinkAngle(): { angle: ReliefAngle | null; ex: number | null } | null {
  const a = linkAngle;
  linkAngle = null;
  return a;
}

/** 网址里有没有地区模式(App 打开网页时先把地区模式那包代码下载起来) */
export function urlHasArea(): boolean {
  return typeof location !== 'undefined' && readAreaLink(new URLSearchParams(location.search)) !== null;
}

/**
 * 照网址进地区模式(打开网页后第一次显示世界、历史推完以后 App 调一次;H = 世界的高):
 * 地球仪、弯边投影先换回平面地图;网址里没有(或不像样)= false
 */
export function openAreaLink(H: number): boolean {
  const link = typeof location === 'undefined' ? null : readAreaLink(new URLSearchParams(location.search));
  if (!link) return false;
  if (getProjection() !== 'equirect') setProjection('equirect');
  stopPlacing();
  openReliefView(clampBox(link.box, H), link.face);
  // 网址带来的角度、起伏:立体那一面画出来时用(这之前网址里照留)
  if (link.face === 'relief' && (link.angle || link.ex !== null)) {
    linkAngle = { angle: link.angle, ex: link.ex };
    syncUrl();
  }
  return true;
}

/** 导出立体这一面得到的图 */
export interface ReliefShot {
  blob: Blob;
  name: string;
  w: number;
  h: number;
}
let shooter: (() => Promise<ReliefShot>) | null = null;

/** 立体那一面开着时登记怎么导出(关掉时传 null) */
export function setReliefExporter(f: (() => Promise<ReliefShot>) | null): void {
  shooter = f;
}

/** 导出立体这一面(现在看到的样子,PNG);立体没开着 = null */
export function exportReliefView(): Promise<ReliefShot> | null {
  return shooter ? shooter() : null;
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
  linkAngle = null;
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
  if (state.phase === 'view' && state.face !== face) {
    linkAngle = null;
    set({ ...state, face, at: performance.now() });
  }
}

/** 改地区图的标题(空的 = 回到按地名起的) */
export function setRegionTitle(title: string): void {
  const t = title.trim();
  set({ ...state, title: t ? t : null });
}

/** 回到平常的地图(从地区模式回来时刚才的框淡淡留一会儿) */
export function closeRelief(): void {
  linkAngle = null;
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

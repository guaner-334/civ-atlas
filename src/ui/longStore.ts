/**
 * 竖版长图的面板状态:选项(范围、哪一国、疆域图、大事、存成、标题)、正在画第几张、要不要问一句再下载。
 * 画好的图(整张、切开的几页、压好的 JPEG)在 longRun.ts;面板(LongPanel.tsx)和预览(LongStage.tsx)都读这里。
 * 导出菜单里点「竖版长图」时由 filmStore 的 openFilm 打开(和回放视频同一个"导出模式")。
 */
import { useSyncExternalStore } from 'react';
import type { LongScope } from './longPlan';

export interface LongUi {
  scope: LongScope;
  /** 一国版:哪一国(null = 还没定,按 defaultPolity 给) */
  polity: number | null;
  maps: 'each' | 'first';
  events: boolean;
  /** 切成 3:4 的几张 */
  split: boolean;
  /** 标题:null = 默认(世界名 / 国名) */
  title: string | null;
  /** 选哪一国的菜单(宽屏)/ 列表(手机)开着 */
  picker: boolean;
  /** 下载几张图片之前问一句 */
  ask: boolean;
  /** 正在画疆域图:第几张、一共几张 */
  busy: { done: number; total: number } | null;
  /** 画好的图换了一次就加一(预览跟着重画) */
  ver: number;
}

const INIT: LongUi = {
  scope: 'world',
  polity: null,
  maps: 'each',
  events: true,
  split: false,
  title: null,
  picker: false,
  ask: false,
  busy: null,
  ver: 0,
};

let state: LongUi = INIT;
const subs = new Set<() => void>();

export const getLong = () => state;

export function setLong(patch: Partial<LongUi>) {
  state = { ...state, ...patch };
  for (const f of subs) f();
}

export function useLong(): LongUi {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

/** 打开长图面板:地图上选中了一个国家时,范围默认是"一国"、就是它 */
export function openLong(selected: number | null) {
  setLong({
    scope: selected !== null ? 'one' : 'world',
    polity: selected,
    title: null,
    picker: false,
    ask: false,
    busy: null,
  });
}

/** 换范围、换国家:标题回到默认(世界名 / 国名) */
export function setLongScope(scope: LongScope, polity?: number) {
  setLong({ scope, ...(polity !== undefined ? { polity } : {}), title: null, picker: false, ask: false });
}

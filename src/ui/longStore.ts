/**
 * 故事长图的面板状态:选项(范围、哪一国、分几段、每段大事、地图、AI 段落、存成、标题、底部网址)、正在画第几张、
 * 要不要问一句再下载。
 * 画好的图(整张、切开的几页、压好的 JPEG)在 longRun.ts;面板(LongPanel.tsx)和预览(LongStage.tsx)都读这里。
 * 导出菜单里点「故事长图」时由 filmStore 的 openFilm 打开(和回放视频同一个"导出模式")。
 */
import { createStore } from './createStore';
import type { LongScope } from './longPlan';

/** 分几段:最多 4 / 6 / 8 段 */
export type LongSegs = 4 | 6 | 8;
/** 每段大事:3 件 / 5 件 / 全部 */
export type LongPer = 3 | 5 | 'all';

export interface LongUi {
  scope: LongScope;
  /** 一国版:哪一国(null = 还没定,按 defaultPolity 给) */
  polity: number | null;
  segs: LongSegs;
  per: LongPer;
  maps: 'each' | 'first';
  /** 写过 AI 史书的世界:每段带上那一章开头的一段 */
  ai: boolean;
  /** 切成 3:4 的几张 */
  split: boolean;
  /** 标题:null = 默认(世界名 / 国名) */
  title: string | null;
  /** 最底下一条网站名和网址 */
  brand: boolean;
  /** 选哪一国的菜单(宽屏)/ 列表(手机)开着 */
  picker: boolean;
  /** 下载几张图片之前问一句 */
  ask: boolean;
  /** 正在画地图:第几张、一共几张 */
  busy: { done: number; total: number } | null;
  /** 画好的图换了一次就加一(预览跟着重画) */
  ver: number;
}

const INIT: LongUi = {
  scope: 'world',
  polity: null,
  segs: 6,
  per: 3,
  maps: 'each',
  ai: true,
  split: false,
  title: null,
  brand: true,
  picker: false,
  ask: false,
  busy: null,
  ver: 0,
};

const store = createStore<LongUi>(INIT);

export const getLong = () => store.get();

export function setLong(patch: Partial<LongUi>) {
  store.update((state) => ({ ...state, ...patch }));
}

export function useLong(): LongUi {
  return store.use();
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

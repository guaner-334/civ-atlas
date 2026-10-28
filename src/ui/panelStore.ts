/**
 * 国家面板的界面状态(和 civView.ts 一样的小 store):
 *
 *   tab     面板在信息页还是干预页(换了选中的东西回到信息页;选目标取消后回到干预页)
 *   page    干预页换上的填写页(卡片换页,不弹窗):方针页(PolicyPage.tsx)、灭国页(DestroyPage.tsx)、天灾页(DisasterPage.tsx)。
 *           back = 「返回」回到哪一页(从信息页「方针」一行进来的回信息页,从干预页进来的回干预页)
 *   sub     信息页换上的看的页:钱粮页(FiscalPage.tsx,概况「钱粮」一行点进来)、朝政页(CourtPage.tsx,「朝政」一行点进来);只看不改,演一国时别国也能看
 *   run     从面板下的令正在推演:面板先藏起,地图压暗、只留本国和对象的名牌,不接受点击;推演完面板回到信息页,App 从生效年份接着放
 *   fly     让 App 把地图飞到选中的东西('sel')或缩回整张图('home');stamp 每次都不同
 *   sheet   窄屏(手机)上面板是底部卡片:半高('half',默认)还是展开('full');换了选中的东西回到半高
 *   world   窄屏上没选东西时底部的世界卡片:收起('peek',默认,只露搜索框和世界名一行)还是拉到顶('full')
 *   drag    窄屏上正在用手指拖底部卡片(这时时间轴胶囊先藏起来,停稳了再出现在卡片上面)
 *
 * 纯状态,不碰 DOM。
 */
import { useSyncExternalStore } from 'react';
import type { SheetSnap, WorldSnap } from './gestures';

export type PanelTab = 'info' | 'cmd';

/** 干预页换上的填写页;year = 打开时的生效年份(没有 = 时间轴那一年) */
export type CmdPage = { kind: 'policy' | 'destroy' | 'disaster' | 'treaty' | 'neutral' | 'boost' | 'trek'; back: PanelTab; year?: number };

/** 信息页换上的看的页 */
export type InfoPage = 'fiscal' | 'court';

export interface IvRun {
  /** 下令的国家(这份历史里的编号) */
  self: number;
  /** 命令的对象(结盟 / 宣战的国家、迁都的城);立即生效的命令没有 */
  target: { kind: 'polity' | 'settlement'; id: number } | null;
  /** 生效年份 */
  from: number;
  /** 下令时面板标题上的国名(推完的提示用它,和用户点的那个对得上;没有 = 用生效那年的名字) */
  shown?: string;
  /** 下令的时刻(performance.now) */
  t0: number;
}

export interface FlyRequest {
  to: 'sel' | 'home';
  stamp: number;
}

interface PanelState {
  tab: PanelTab;
  page: CmdPage | null;
  sub: InfoPage | null;
  run: IvRun | null;
  fly: FlyRequest | null;
  sheet: SheetSnap;
  world: WorldSnap;
  drag: boolean;
}

let state: PanelState = { tab: 'info', page: null, sub: null, run: null, fly: null, sheet: 'half', world: 'peek', drag: false };
let stamp = 0;
const subs = new Set<() => void>();
const set = (patch: Partial<PanelState>) => {
  state = { ...state, ...patch };
  for (const f of subs) f();
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function getPanel(): PanelState {
  return state;
}

export function usePanel(): PanelState {
  return useSyncExternalStore(subscribe, getPanel, getPanel);
}

export function setPanelTab(tab: PanelTab) {
  if (state.tab !== tab || state.page || state.sub) set({ tab, page: null, sub: null });
}

/** 信息页换上一页看的(钱粮页);null = 回到信息页 */
export function openInfoPage(sub: InfoPage | null) {
  if (state.tab !== 'info' || state.page || state.sub !== sub) set({ tab: 'info', page: null, sub });
}

/** 换上一张填写页(在干预页里) */
export function openCmdPage(page: CmdPage) {
  set({ tab: 'cmd', page, sub: null });
}

/** 填写页的「返回」:回到进来的那一页 */
export function closeCmdPage() {
  set({ tab: state.page?.back ?? 'cmd', page: null });
}

/** 选中一个别的东西、同时要打开它的填写页:换选中以后面板会回到信息页(Inspector.tsx 的 useSelectionReset),先记下,到时候换上 */
let queued: { key: string; page: CmdPage } | null = null;
export function queueCmdPage(key: string, page: CmdPage) {
  queued = { key, page };
}

/** 换了选中的东西(稳定键 key):有记下的填写页就交出来(取一次就没了) */
export function takeCmdPage(key: string): CmdPage | null {
  const q = queued;
  queued = null;
  return q && q.key === key ? q.page : null;
}

/** 从面板下了一条令(之后 App 在后台重推) */
export function startRun(run: Omit<IvRun, 't0'>) {
  set({ run: { ...run, t0: performance.now() } });
}

export function endRun() {
  if (state.run) set({ run: null });
}

/** 让 App 把地图飞过去:'sel' = 选中的东西,'home' = 缩回整张图 */
export function requestFly(to: FlyRequest['to']) {
  set({ fly: { to, stamp: ++stamp } });
}

/** 窄屏的底部抽屉:半高 / 展开(宽屏上没有用) */
export function setSheet(sheet: SheetSnap) {
  if (state.sheet !== sheet) set({ sheet });
}

/** 窄屏没选东西时的世界卡片:收起 / 拉到顶 */
export function setWorldSheet(world: WorldSnap) {
  if (state.world !== world) set({ world });
}

/** 窄屏:手指正在拖底部卡片 */
export function setSheetDrag(drag: boolean) {
  if (state.drag !== drag) set({ drag });
}

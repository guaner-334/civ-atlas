/**
 * 宽屏左边侧栏卡片的收起 / 展开(Sidebar.tsx:卡片右上角的收起按钮、收起后左上角的小按钮;手机不用)。
 *
 *   collapsed  点了收起:记在浏览器里,刷新、换世界后照旧
 *   peek       收起时选中了东西(地图上点的、搜索、编年史里跳过去):卡片弹出来显示它;取消选中(✕、Esc)又收回去
 *   hold       新建世界这一步:左边是新建世界的卡片,不算收起(App 设)
 *
 * 卡片看得见 = 没收起,或者 peek、hold。flyTo.ts 的 sideRoom 按 sideShown() 算卡片占掉的宽度
 * (和 desktop.css 的 --side-room 一致:收起时只剩左边距)。
 */
import { getSelection, subscribeSelection } from './civView';
import { createStore } from './createStore';

const KEY = 'wenming-ditu:side-collapsed';

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
function save(collapsed: boolean) {
  try {
    if (collapsed) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    /* 隐私模式:只管这一次 */
  }
}

export interface SideState {
  collapsed: boolean;
  peek: boolean;
}

const store = createStore<SideState>({ collapsed: load(), peek: false });
let hold = false;

function set(next: SideState) {
  const state = store.get();
  if (next.collapsed === state.collapsed && next.peek === state.peek) return;
  store.set(next);
}

// 收起时选中了东西 → 卡片弹出来(卡片收回去以后再点一下同一个也弹出来);取消选中 → 收回去
subscribeSelection(() => {
  const { sel } = getSelection();
  const state = store.get();
  if (!sel) set({ ...state, peek: false });
  else if (state.collapsed) set({ ...state, peek: true });
});

/** 收起卡片(卡片里的收起按钮;弹出来显示详情时点它也是收回去,选中的东西留着) */
export function collapseSide() {
  save(true);
  set({ collapsed: true, peek: false });
}

/** 展开卡片(收起后左上角的小按钮) */
export function expandSide() {
  save(false);
  set({ collapsed: false, peek: false });
}

export function getSide(): SideState {
  return store.get();
}

export function useSide(): SideState {
  return store.use();
}

/** 新建世界这一步:左边是新建世界的卡片,照常让出它的宽度 */
export function setSideHold(on: boolean) {
  hold = on;
}

/** 宽屏左边的卡片此刻看得见(没收起,或者弹出来显示选中的东西,或者是新建世界的卡片) */
export function sideShown(): boolean {
  const state = store.get();
  return !state.collapsed || state.peek || hold;
}

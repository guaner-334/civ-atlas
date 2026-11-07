/**
 * 举报别人的分享短链接:地图下那条说明的「举报」、世界「···」菜单里的「举报这个分享…」都开同一个窗(App 里挂 ShareReportHost)。
 * 只在看别人的短链接、还没另存时有;服务器没开作品墙(没人处理举报)时不露。
 * 同一台设备对同一个链接只能举报一次,记在这个浏览器里(读写不了就只在这一页里记着)。
 */
import { useEffect } from 'react';
import { reportShareCode } from '../account/cloud';
import { accountServer } from '../account/server';
import { fetchAuthOptions, knownAuthOptions, onAuthOptionsChange } from '../account/session';
import { createListeners } from './createStore';
import { currentWorld, isStored } from './saveStore';

/** 正在看的别人的短链接:打开时的世界编号、码、署名、世界名 */
export interface SharedView {
  worldId: string;
  code: string;
  by: string;
  title: string;
}

const KEY = 'civ-atlas:share-reported';
const listeners = createListeners();
const here = new Set<string>();
let view: SharedView | null = null;
let open = false;

onAuthOptionsChange(() => listeners.emit());

export function setSharedView(v: SharedView | null): void {
  view = v;
  open = false;
  listeners.emit();
}

/** 还在看这个短链接(没换世界、没另存);不是 = null */
export function sharedView(): SharedView | null {
  const w = currentWorld();
  return view && w?.id === view.worldId && w.kind === 'visit' && !isStored(view.worldId) ? view : null;
}

function readReported(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function wasShareReported(code: string): boolean {
  return here.has(code) || readReported().includes(code);
}

export async function reportShare(code: string, reason: string): Promise<void> {
  if (wasShareReported(code)) return;
  await reportShareCode(code, reason);
  here.add(code);
  try {
    localStorage.setItem(KEY, JSON.stringify([...readReported().filter((x) => x !== code), code].slice(-500)));
  } catch {
    /* 存不下:这一页里记着 */
  }
  listeners.emit();
}

/** 这台设备举报过这个链接(举报完跟着变) */
export const useShareReported = (code: string | null): boolean => listeners.use(() => !!code && wasShareReported(code));

/** 服务器开着作品墙(features.submit 跟着作品墙),举报才有人处理 */
export function useShareReportOn(): boolean {
  const on = listeners.use(() => !!accountServer() && !!knownAuthOptions()?.features.submit);
  useEffect(() => {
    if (accountServer() && !knownAuthOptions()) void fetchAuthOptions().catch(() => {});
  }, []);
  return on;
}

export function openShareReport(): void {
  if (!sharedView()) return;
  open = true;
  listeners.emit();
}
export function closeShareReport(): void {
  open = false;
  listeners.emit();
}
export const useShareReportOpen = (): boolean => listeners.use(() => open);

/** 说明条、菜单里那个「举报」:能举报时给是不是举报过和点了做什么;不能 = null */
export function useShareReportEntry(): { done: boolean; onClick: () => void } | null {
  const on = useShareReportOn();
  const v = listeners.use(sharedView);
  const done = useShareReported(v?.code ?? null);
  return on && v ? { done, onClick: openShareReport } : null;
}

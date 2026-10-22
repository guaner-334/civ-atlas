/**
 * 和页面里的加载画面打交道(第一次打开时先出的网站图标、名字和进度条;构建时写进 index.html,见 scripts/lib/loadScreen.ts):
 *   首页或主程序挂上了:让它淡出(Boot.tsx)
 *   主程序下载不下来、也没法刷新页面重来:让它换成「重新加载」
 *   首页上在后台下载主程序:数着下了多少(首页上点了要用主程序的事、它还没下完时,在点的地方显示,见 HomeShell.tsx)
 * 开发时(pnpm dev)页面里没有加载画面:这几样什么都不做,下了多少不知道(null)。
 */
import { useSyncExternalStore } from 'react';

/** 加载画面给页面代码留的口子(window.__ld) */
interface LoadScreen {
  done(): void;
  fail(): void;
  /** 下载主程序那个文件,cb 收到下了多少(0–1);只下一次,几处要的拿同一个。浏览器太旧、数不了的没有这一样 */
  app?(cb: (x: number) => void): Promise<unknown>;
}

const screen = (): LoadScreen | undefined => (globalThis as { __ld?: LoadScreen }).__ld;

/** 首页或主程序挂上了:加载画面淡出(已经没了的什么都不做) */
export function loadScreenDone() {
  screen()?.done();
}

/** 主程序下载不下来:加载画面(还在的话)换成蓝色「重新加载」 */
export function loadScreenFail() {
  screen()?.fail();
}

/** 主程序下了百分之几(0–100);null = 不知道(开发时、浏览器数不了) */
let pct: number | null = null;
const subs = new Set<() => void>();
function setPct(p: number) {
  if (p === pct) return;
  pct = p;
  for (const f of [...subs]) f();
}

/**
 * 下载主程序那个文件、数着下了多少;下好以后 import() 从浏览器缓存里拿,不会下第二遍。
 * 页面里没有加载画面(开发时)、浏览器数不了:什么都不做,由 import() 自己下
 */
export function downloadApp(): Promise<void> {
  const app = screen()?.app;
  if (!app) return Promise.resolve();
  if (pct === null) setPct(0);
  return app((x) => setPct(Math.floor(Math.min(1, Math.max(0, x)) * 100))).then(() => setPct(100));
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
const idle = () => () => {};

/**
 * 主程序下了百分之几(0–100;null = 不知道)。on = false 时不跟着变(还没点什么的时候,后台下载不让首页一遍遍重画)
 */
export function useAppPercent(on = true): number | null {
  return useSyncExternalStore(
    on ? subscribe : idle,
    () => (on ? pct : null),
    () => (on ? pct : null),
  );
}

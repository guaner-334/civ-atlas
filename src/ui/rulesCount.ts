/**
 * 本机「我的规则」里有几套:首页的「我的世界」一个世界都没有时,看它决定露不露出「地图 / 文明 / 规则」那一排。
 * 只数浏览器里存着的条数,不读、不清理每一套(那些在 rulesStore.ts,首页不下载);
 * rulesStore.ts 每次存的时候把新的条数报过来(noteMyRulesCount),页面跟着变。
 */
import { createListeners } from './createStore';

/** 「我的规则」存在浏览器里的键(rulesStore.ts 用同一个) */
export const MY_RULES_KEY = 'wenming-ditu:rules';

const subs = createListeners();
let count: number | null = null;

function read(): number {
  try {
    const o = JSON.parse(localStorage.getItem(MY_RULES_KEY) ?? 'null') as { list?: unknown } | null;
    return Array.isArray(o?.list) ? o.list.length : 0;
  } catch {
    return 0;
  }
}

/** 组件里取「我的规则」有几套 */
export function useMyRulesCount(): number {
  return subs.use(() => (count ??= read()));
}

/** rulesStore.ts 存了以后报一下现在几套 */
export function noteMyRulesCount(n: number): void {
  if (n === count) return;
  count = n;
  subs.emit();
}

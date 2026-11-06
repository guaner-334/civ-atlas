/**
 * 本机「我的规则」里有几套、各叫什么:首页的「我的世界」一个世界都没有时,看条数决定露不露出「地图 / 文明 / 规则」那一排;
 * 新建弹窗、预设菜单写「带着规则「某某」」时看名字(预设里存的那一套后来在「我的规则」里改了名,写现在的名字)。
 * 只读浏览器里存着的条数和名字,不清理每一套(那些在 rulesStore.ts,首页不下载);
 * rulesStore.ts 每次存的时候把新的报过来(noteMyRules),页面跟着变。
 */
import { createListeners } from './createStore';

/** 「我的规则」存在浏览器里的键(rulesStore.ts 用同一个) */
export const MY_RULES_KEY = 'wenming-ditu:rules';

const subs = createListeners();
let state: { count: number; names: ReadonlyMap<string, string> } | null = null;

function read(): { count: number; names: ReadonlyMap<string, string> } {
  const names = new Map<string, string>();
  try {
    const o = JSON.parse(localStorage.getItem(MY_RULES_KEY) ?? 'null') as { list?: unknown } | null;
    if (!Array.isArray(o?.list)) return { count: 0, names };
    for (const x of o.list as { rules?: { id?: unknown; name?: unknown } }[]) {
      const r = x?.rules;
      if (typeof r?.id === 'string' && typeof r.name === 'string') names.set(r.id, r.name);
    }
    return { count: o.list.length, names };
  } catch {
    return { count: 0, names };
  }
}

const get = () => (state ??= read());

/** 组件里取「我的规则」有几套 */
export function useMyRulesCount(): number {
  return subs.use(get).count;
}

/** 组件里取「我的规则」各套现在叫什么(本机编号 → 名字) */
export function useMyRulesNames(): ReadonlyMap<string, string> {
  return subs.use(get).names;
}

/** rulesStore.ts 存了以后报一下现在的几套(本机编号、名字) */
export function noteMyRules(list: readonly { id: string; name: string }[]): void {
  const was = get();
  if (was.count === list.length && list.every((x) => was.names.get(x.id) === x.name)) return;
  state = { count: list.length, names: new Map(list.map((x) => [x.id, x.name])) };
  subs.emit();
}

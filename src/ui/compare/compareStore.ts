/**
 * 并排试推开着哪一套规则(页面的代码和样式在 ComparePage.tsx 那一包里,点了「并排试推」才下载,见 rules/RulesHost.tsx)。
 * 这里只放首页也要用的一小块,不 import 别的代码(首页用到的文件静态 import 了哪个文件,那个文件就整个进首页那一份)。
 *
 *   openCompare({ rules, kind, mineId })   从调规则的大卡点开:kind = 我的规则里的(能改回)/ 别人分享的 / 一个世界用的那一版(都只能看)
 *   closeCompare()                         回到大卡
 */
import { createStore } from '../createStore';
import type { RuleSet } from '../../gen/civ/ruleSet';

export interface CompareOpen {
  rules: RuleSet;
  /** mine = 本机「我的规则」里的(mineId;推不下去时能把那两项改回官方);shared = 别人分享的、还没加进来的;world = 一个世界用的那一版 */
  kind: 'mine' | 'shared' | 'world';
  mineId?: string;
}

const store = createStore<CompareOpen | null>(null);

export const useCompare = () => store.use();
export const getCompare = () => store.get();
export const openCompare = (o: CompareOpen) => store.set(o);
export const closeCompare = () => store.set(null);

/**
 * 调规则的大卡(RulesSheet.tsx)开着哪一套。大卡的代码和样式点了才下载(RulesHost.tsx),这里只放首页也要用的一小块:
 *
 *   openRulesSheet({ kind: 'mine', id })     本机「我的规则」里的一套(能改;name = true 时一打开就在改名)
 *   openRulesSheet({ kind: 'official' })     官方规则(只能看,能复制一份改)
 *   openRulesHash(location.hash)             网址里是别人分享的规则链接(#rules=…)就打开它(只能看),返回打开了没有
 *   openRulesText(text, 文件名)               是规则文件就打开它(只能看),返回打开了没有;不是的照旧当世界的存档打开
 *   closeRulesSheet()
 *
 * 链接、文件交给大卡去解(gen/civ/ruleShare.ts):解开以后换成 { kind: 'shared', rules, from }(读不了的说一声、不打开)。
 * 入口开关见 flag.ts:关着的时候链接、文件都不认(照旧走原来的路)。
 */
import { createStore } from '../createStore';
import { isRulesFileLike, type RuleSet } from '../../gen/civ/ruleSet';
import { rulesUiOn } from './flag';

export type RulesSheetState =
  | null
  | { kind: 'mine'; id: string; name?: boolean }
  | { kind: 'official' }
  /** 还没解开的分享链接(# 那段) */
  | { kind: 'link'; hash: string }
  /** 还没解开的规则文件 */
  | { kind: 'file'; text: string; fileName?: string }
  /** 别人分享的一套(解开了的;from = 从链接还是从文件来的) */
  | { kind: 'shared'; rules: RuleSet; from: 'link' | 'file'; fileName?: string };

const store = createStore<RulesSheetState>(null);

export const useRulesSheet = () => store.use();
export const getRulesSheet = () => store.get();
export const openRulesSheet = (s: Exclude<RulesSheetState, null>) => store.set(s);
export const closeRulesSheet = () => store.set(null);

/** 网址的 # 那段是不是规则链接(和 gen/civ/ruleShare.ts 的 isRulesHash 一样;那个文件首页不下载) */
const RULES_HASH = /^#?\s*rules=/;

/** 网址里是规则链接(入口开着时):打开大卡,返回 true(叫的地方把 # 那段从地址栏去掉) */
export function openRulesHash(hash: string): boolean {
  if (!rulesUiOn() || typeof hash !== 'string' || !RULES_HASH.test(hash.trim())) return false;
  openRulesSheet({ kind: 'link', hash });
  return true;
}

/** 规则文件最大多少字(和 ruleShare.ts 的 RULES_FILE_MAX 一样;再大的不是规则文件,不解) */
const FILE_MAX = 1024 * 1024;

/** 打开的文件是一套规则(入口开着时):打开大卡,返回 true;不是的(世界的存档、全部存成的文件)返回 false */
export function openRulesText(text: string, fileName?: string): boolean {
  if (!rulesUiOn() || typeof text !== 'string' || text.length > FILE_MAX) return false;
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return false;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !isRulesFileLike(raw as Record<string, unknown>)) return false;
  openRulesSheet({ kind: 'file', text, ...(fileName ? { fileName } : {}) });
  return true;
}

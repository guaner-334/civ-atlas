/**
 * 本机的「我的规则」:自己调的、复制来的、别人分享了加进来的几套规则(gen/civ/ruleSet.ts)。
 * 存在这个浏览器里(和新建世界的预设一样,换电脑带不走;浏览器不让存(隐私模式)就只在这次打开的页面里有效)。
 *
 *   新建       从官方规则开始的一套(createRules)
 *   复制一份   基于一套(本机的,或者官方规则)另起一套,出处记在「基于谁」里(copyRules)
 *   加进来     别人分享的(链接、文件读回来的):另起一个本机编号,分享的那一套记在「基于谁」里(addSharedRules)
 *   改         规则项、地貌的叫法、名字、署名、介绍(editRules;setRuleValue、setBiomeName、renameRules 是它的简写);删(deleteRules)
 *
 * - **本机编号**:每套一个,随用它建的世界存进存档(WorldEdits.rules.id),世界里的和这里的对得上(myRulesFor)
 * - **第几版**:一套被世界用过以后再改(任何一样),版本加一;用过的世界存的是当时那一版,不跟着变。
 *   「用过」= 用它创建了一个世界:创建的那一刻 noteRulesUsed 记一笔(这一版用过了,用它建过的世界数加一)
 * - **用它建过几个世界**:同上记的数(删了世界不减:是"建过")
 * - **最多 MAX_MY_RULES 套**:满了新建、复制、加进来都不成(返回 null,界面说一声),不为它删别的
 */
import { createListeners } from './createStore';
import { MY_RULES_KEY, noteMyRulesCount } from './rulesCount';
import { RULES_VERSION_MAX, cleanRuleSet, type BiomeNames, type RuleSet } from '../gen/civ/ruleSet';
import { deriveRuleSet, newRuleSet, sameRuleContent } from '../gen/civ/ruleSetEdit';
import type { TuningValue, TuningValues } from '../gen/civ/tuning';

/** 「我的规则」里的一套 */
export interface MyRules {
  /** 这一套现在的样子(带本机编号) */
  rules: RuleSet & { id: string };
  /** 现在这一版有没有世界用过(用过以后再改 = 新的一版) */
  used: boolean;
  /** 用它建过几个世界 */
  worlds: number;
  /** 别人分享了加进来的 */
  shared?: boolean;
  /** 最后一次新建、复制、加进来、改动的时间(毫秒) */
  at: number;
}

/** 最多几套 */
export const MAX_MY_RULES = 50;
const KEY = MY_RULES_KEY;

/** 能改的几样 */
export type RulesChange = Partial<{ name: string; by: string; about: string; values: TuningValues; biomes: BiomeNames }>;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** 浏览器里存着的一套(坏了的 = null) */
function cleanEntry(x: unknown): MyRules | null {
  if (!isObj(x)) return null;
  const r = cleanRuleSet(x.rules).rules;
  if (!r?.id) return null;
  const worlds = typeof x.worlds === 'number' && Number.isInteger(x.worlds) && x.worlds > 0 ? x.worlds : 0;
  const at = typeof x.at === 'number' && Number.isFinite(x.at) ? x.at : 0;
  return { rules: r as MyRules['rules'], used: x.used === true, worlds, ...(x.shared === true ? { shared: true } : {}), at };
}

function load(): MyRules[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const o = JSON.parse(raw) as { list?: unknown };
    const out: MyRules[] = [];
    const ids = new Set<string>();
    for (const x of Array.isArray(o.list) ? o.list : []) {
      const e = cleanEntry(x);
      if (!e || ids.has(e.rules.id)) continue;
      ids.add(e.rules.id);
      out.push(e);
      if (out.length >= MAX_MY_RULES) break;
    }
    return out;
  } catch {
    return [];
  }
}

let list: readonly MyRules[] | null = null;
const subs = createListeners();
const get = () => (list ??= load());

function set(next: readonly MyRules[]) {
  list = next;
  try {
    localStorage.setItem(KEY, JSON.stringify({ list: next }));
  } catch {
    /* 隐私模式、存满了:只管这一次 */
  }
  subs.emit();
  noteMyRulesCount(next.length);
}

/** 组件里取「我的规则」(新建、复制、加进来的排在前面) */
export function useMyRules(): readonly MyRules[] {
  return subs.use(get);
}

export function getMyRules(): readonly MyRules[] {
  return get();
}

/** 按本机编号取一套;没有 = undefined */
export function findMyRules(id: string): MyRules | undefined {
  return get().find((e) => e.rules.id === id);
}

/** 一个新的本机编号(小写字母和数字;和现有的不重) */
function newId(): string {
  const used = new Set(get().map((e) => e.rules.id));
  for (;;) {
    let r = '';
    try {
      const a = new Uint32Array(2);
      crypto.getRandomValues(a);
      r = a[0].toString(36) + a[1].toString(36);
    } catch {
      r = Math.floor(Math.random() * 2 ** 52).toString(36);
    }
    const id = `r${Date.now().toString(36)}${r.slice(0, 6)}`;
    if (!used.has(id)) return id;
  }
}

/** 放进一套新的(排在最前面);满了 = null */
function add(rules: RuleSet, shared = false): string | null {
  const now = get();
  if (now.length >= MAX_MY_RULES) return null;
  const id = newId();
  const c = cleanRuleSet({ ...rules, id }).rules!;
  set([{ rules: c as MyRules['rules'], used: false, worlds: 0, ...(shared ? { shared: true } : {}), at: Date.now() }, ...now]);
  return id;
}

/** 新建一套(从官方规则开始);返回本机编号,满了 = null */
export function createRules(name: string): string | null {
  return add(newRuleSet(name));
}

/**
 * 复制一份:基于本机的 fromId 那一套另起一套,规则项、地貌的叫法照搬,出处记在「基于谁」里,从第 1 版起;name 不给 = 同名。
 * fromId = null:复制官方规则(和新建一样从官方开始,基于官方规则;name 不给叫「未命名规则」)。返回本机编号;没有那一套、满了 = null
 */
export function copyRules(fromId: string | null, name?: string): string | null {
  if (fromId === null) return add(newRuleSet(name ?? ''));
  const src = findMyRules(fromId);
  return src ? add(deriveRuleSet(src.rules, name)) : null;
}

/**
 * 别人分享来的一套(分享链接、规则文件读回来的,ruleShare.ts)加进「我的规则」:另起一个本机编号,
 * 分享的那一套(名字、署名、第几版)记在「基于谁」的最前面,规则项、地貌的叫法、介绍照搬。返回本机编号;满了 = null
 */
export function addSharedRules(r: RuleSet): string | null {
  return add(deriveRuleSet(r), true);
}

/**
 * 改一套:改了的那几样换掉(清理过);和原来一样 = 不改(false)。
 * 这一版被世界用过的,改了就是新的一版(版本加一,没被用过);没用过的照旧是这一版
 */
export function editRules(id: string, change: RulesChange): boolean {
  const now = get();
  const i = now.findIndex((e) => e.rules.id === id);
  if (i < 0) return false;
  const e = now[i];
  const pick: Record<string, unknown> = {};
  for (const k of ['name', 'by', 'about', 'values', 'biomes'] as const) if (k in change) pick[k] = change[k];
  const c = cleanRuleSet({ ...e.rules, ...pick, id, version: e.rules.version, basedOn: e.rules.basedOn }).rules!;
  if (sameRuleContent(c, e.rules)) return false;
  const version = e.used ? Math.min(RULES_VERSION_MAX, e.rules.version + 1) : e.rules.version;
  const next = now.slice();
  next[i] = { ...e, rules: { ...c, id, version } as MyRules['rules'], used: false, at: Date.now() };
  set(next);
  return true;
}

/** 改一项规则项(undefined = 改回官方) */
export function setRuleValue(id: string, item: string, v: TuningValue | undefined): boolean {
  const e = findMyRules(id);
  if (!e) return false;
  const { [item]: _old, ...rest } = e.rules.values;
  return editRules(id, { values: v === undefined ? rest : { ...rest, [item]: v } });
}

/** 改一种地貌的叫法(空 = 改回官方的叫法);key 见 ruleSet.ts 的 BIOME_KEYS */
export function setBiomeName(id: string, key: string, name: string): boolean {
  const e = findMyRules(id);
  if (!e) return false;
  const { [key]: _old, ...rest } = e.rules.biomes ?? {};
  return editRules(id, { biomes: name.trim() ? { ...rest, [key]: name } : rest });
}

/** 改名 */
export function renameRules(id: string, name: string): boolean {
  return editRules(id, { name });
}

/** 删掉一套(用它建的世界不受影响:世界里存着整套) */
export function deleteRules(id: string) {
  const now = get();
  if (now.some((e) => e.rules.id === id)) set(now.filter((e) => e.rules.id !== id));
}

/**
 * 用一套规则创建了一个世界(r = 世界里存的那一套):是本机「我的规则」里的(编号对得上)就记一笔 —— 用它建过的世界数加一,
 * 世界用的正是现在这一版的,这一版算用过了(之后再改就是新的一版)。
 * 世界里存的这一版和本机的同一版不一样(选了规则以后、建世界之前又改过本机的那一套):本机的另起一版,世界里的还是原来的那一版
 */
export function noteRulesUsed(r: RuleSet | null | undefined) {
  if (!r?.id) return;
  const now = get();
  const i = now.findIndex((e) => e.rules.id === r.id);
  if (i < 0) return;
  const e = now[i];
  let { rules, used } = e;
  if (rules.version === r.version) {
    if (sameRuleContent(rules, r)) used = true;
    else {
      rules = { ...rules, version: Math.min(RULES_VERSION_MAX, rules.version + 1) };
      used = false;
    }
  }
  const next = now.slice();
  next[i] = { ...e, rules, used, worlds: e.worlds + 1 };
  set(next);
}

/**
 * 世界里存的一套和本机「我的规则」里的对上(本机编号一样):本机的那一套、本机的是不是已经是更新的一版
 * (世界信息上写「战乱年代 第 2 版(我的规则里已是第 3 版)」);对不上(不是本机的、本机已经删了)= null
 */
export function myRulesFor(r: RuleSet | null | undefined): { mine: MyRules; newer: boolean } | null {
  const mine = r?.id ? findMyRules(r.id) : undefined;
  return mine && r ? { mine, newer: mine.rules.version > r.version } : null;
}

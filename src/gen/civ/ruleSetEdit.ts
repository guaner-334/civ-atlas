/**
 * 一套规则(ruleSet.ts)的新建、复制、比较、写成字:本机的「我的规则」(ui/rulesStore.ts)和界面用。
 * 和读、清理分开放:存档、首页的「我的世界」读存档时只引用 ruleSet.ts,用不着这些。
 * 纯计算,不碰 DOM。
 */
import { BIOMES, type Biome } from '../biomes';
import { RULES_NAME_MAX, UNNAMED_RULES, biomeKey, cleanRuleSet, cleanText, trimLineage, type RuleSet, type RuleSource } from './ruleSet';

/** 官方规则的名字 */
export const OFFICIAL_RULES_NAME = '官方规则';

/** 名字清理过(最多 RULES_NAME_MAX 字);空 = '' */
const cleanName = (name: string) => cleanText(name, RULES_NAME_MAX).text;

/** 从官方规则开始的一套(没改任何项;基于官方规则) */
export function newRuleSet(name: string): RuleSet {
  return { name: cleanName(name) || UNNAMED_RULES, version: 1, values: {} };
}

/**
 * 基于 src 的一套(复制一份、加进别人分享来的):规则项、地貌的叫法、介绍照搬;src 记在基于谁的最前面(连同它基于谁一路传下来);
 * 第几版从 1 起;署名空着(是自己的了);没有本机编号(存进「我的规则」时另起)。name 不给 = 和 src 同名
 */
export function deriveRuleSet(src: RuleSet, name?: string): RuleSet {
  const c = cleanRuleSet(src).rules ?? newRuleSet(src.name);
  const from: RuleSource = { name: c.name, ...(c.by ? { by: c.by } : {}), version: c.version };
  return {
    name: (name !== undefined && cleanName(name)) || c.name,
    version: 1,
    ...(c.about ? { about: c.about } : {}),
    basedOn: trimLineage([from, ...(c.basedOn ?? [])]),
    values: { ...c.values },
    ...(c.biomes ? { biomes: { ...c.biomes } } : {}),
  };
}

/** 两套规则的内容一样(名字、第几版、署名、介绍、基于谁、规则项、地貌的叫法;本机编号不算) */
export function sameRuleContent(a: RuleSet, b: RuleSet): boolean {
  const strip = (r: RuleSet) => {
    const { id: _id, ...rest } = cleanRuleSet(r).rules ?? r;
    return JSON.stringify(rest);
  };
  return strip(a) === strip(b);
}

/** 一种地貌在这套规则里叫什么(没另起名字 = 官方的叫法) */
export function biomeName(r: Pick<RuleSet, 'biomes'> | null | undefined, b: Biome): string {
  return r?.biomes?.[biomeKey(b)] || BIOMES[b].name;
}

/** 「战乱年代(第 2 版)」 */
export function ruleSetLabel(r: Pick<RuleSet, 'name' | 'version'>): string {
  return `${r.name}（第 ${r.version} 版）`;
}

/** 基于谁:「基于 砚山 的《群雄并起》」(没署名的「基于《群雄并起》」);没有 = 「基于官方规则」 */
export function basedOnText(r: Pick<RuleSet, 'basedOn'>): string {
  const s = r.basedOn?.[0];
  if (!s) return `基于${OFFICIAL_RULES_NAME}`;
  return s.by ? `基于 ${s.by} 的《${s.name}》` : `基于《${s.name}》`;
}


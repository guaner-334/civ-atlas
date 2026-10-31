/**
 * 调规则的页要的几样现算的:改过的项按组列、搜规则、改了几项、「我的规则」一行的小字。纯计算,不碰 DOM。
 */
import { BIOMES, type Biome } from '../../gen/biomes';
import { BIOME_KEYS, biomeKey, biomeOfKey, type RuleSet } from '../../gen/civ/ruleSet';
import { basedOnText } from '../../gen/civ/ruleSetEdit';
import { TUNING_ITEMS, type TuningGroup, type TuningItem, type TuningValues } from '../../gen/civ/tuning';
import { TUNING_GROUPS, tuningSummary, tuningText } from '../../gen/civ/tuningText';

/** 右边一页:一组 / 只看改过的 / 地貌的名字 */
export type RulesPage = TuningGroup | 'modified' | 'biomes';

/** 一组里的项(常用的、其余的,照项表的先后) */
export function groupItems(g: TuningGroup): { common: TuningItem[]; more: TuningItem[] } {
  const all = TUNING_ITEMS.filter((x) => x.group === g);
  return { common: all.filter((x) => x.common), more: all.filter((x) => !x.common) };
}

/** 一段按组分好的项 */
export interface ItemSection {
  group: TuningGroup;
  name: string;
  items: TuningItem[];
}

/** 把一串项按组分开(照七组的先后,组里照项表的先后;没有项的组不要) */
function sections(items: readonly TuningItem[]): ItemSection[] {
  return TUNING_GROUPS.map((g) => ({ group: g.id, name: g.name, items: TUNING_ITEMS.filter((x) => x.group === g.id && items.includes(x)) })).filter((s) => s.items.length);
}

/** 改过的项,按组列(只看改过的) */
export function modifiedSections(values: TuningValues): ItemSection[] {
  return sections(TUNING_ITEMS.filter((x) => x.id in values));
}

/** 改过叫法的地貌(照地貌总表的先后) */
export function renamedBiomes(r: Pick<RuleSet, 'biomes'>): Biome[] {
  return BIOME_KEYS.filter((k) => r.biomes?.[k]).map((k) => biomeOfKey(k)!);
}

/** 改了几项:规则项 + 地貌的叫法 */
export function modifiedCount(r: Pick<RuleSet, 'values' | 'biomes'>): { items: number; biomes: number; total: number } {
  const items = Object.keys(r.values).length;
  const biomes = Object.keys(r.biomes ?? {}).length;
  return { items, biomes, total: items + biomes };
}

/** 搜的字:去掉首尾空白、并掉中间的空白,英文不分大小写 */
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/** 搜规则:名字、一句说明、摘要里的叫法里有这几个字的项,按组列;再加上名字(官方的、这套里起的)里有这几个字的地貌 */
export function searchRules(q: string, r: Pick<RuleSet, 'biomes'>): { sections: ItemSection[]; biomes: Biome[] } {
  const k = norm(q);
  if (!k) return { sections: [], biomes: [] };
  const hit = (s: string | undefined) => !!s && norm(s).includes(k);
  const items = TUNING_ITEMS.filter((x) => {
    const t = tuningText(x);
    return hit(x.name) || hit(t.desc) || hit(t.short) || hit(t.offText);
  });
  const biomes = BIOMES.filter((b) => hit(b.name) || hit(r.biomes?.[biomeKey(b.id)])).map((b) => b.id);
  return { sections: sections(items), biomes };
}

const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十'];
/** 几组写成汉字(「分在三组」) */
export const cnCount = (n: number) => CN[n] ?? String(n);

/**
 * 「我的规则」里一行的小字:出处(别人分享来的写「砚山 分享」,基于别的规则的写「基于《战乱年代》」;基于官方的不写)+ 改了什么。
 * 一项都没改的写「还没改，和官方规则一样」
 */
export function rulesLine(r: RuleSet, shared: boolean): string {
  const src = r.basedOn?.[0];
  const from = shared ? `${src?.by ?? '别人'} 分享。` : src ? `${basedOnText(r)}。` : '';
  const n = modifiedCount(r);
  let what: string;
  if (n.items) what = tuningSummary(r.values, 4);
  else if (n.biomes) what = `改了地貌的名字 ${n.biomes} 项`;
  else what = '还没改，和官方规则一样';
  return from + what;
}

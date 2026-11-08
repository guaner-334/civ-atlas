/**
 * 推演插件写的编年史(Civ.simChronicle)→ 编年史条目(kind = 'plugin'):照存下的字列出,占位符换成当年的国号、州名、城名、族名。
 * 换名字用的是传进来的历史里的名字,所以存世界时(名字都是占位符的历史)存下的也是占位符,改名照样跟着变。纯计算。
 */
import type { Civ } from '../types';
import { polityName } from '../growth';
import { chronicleRefs, chronicleText } from '../engine/pluginChronicle';
import type { ChronicleEntry } from './chronicle';
import { regionLabel } from './display';

/** 一字标签 */
export const PLUGIN_TAG = '记';

/** 插件写的条目(按写的先后,也就是年份的先后);id 接在 before(别的条目)里最大的后面:不和史事、人物撞,同一年排在官方的后面 */
export function pluginEntries(civ: Civ, before: readonly ChronicleEntry[]): ChronicleEntry[] {
  const lines = civ.simChronicle ?? [];
  if (!lines.length) return [];
  let id = (civ.annals?.length ?? 0) + (civ.people?.length ?? 0) + (civ.religion?.events.length ?? 0) + (civ.development?.events.length ?? 0);
  for (const e of before) {
    id = Math.max(id, e.id + 1);
    for (const c of e.children ?? []) id = Math.max(id, c.id + 1);
  }
  return lines.map((l): ChronicleEntry => {
    const name = (kind: string, n: number): string => {
      if (kind === 'polity') {
        const p = civ.polities[n];
        return p ? polityName(p, l.year) || p.name : '';
      }
      if (kind === 'region') return n < civ.regions.count ? regionLabel(civ, n) : '';
      if (kind === 'settlement') {
        const s = civ.settlements[n];
        return s ? s.name || regionLabel(civ, s.region) : '';
      }
      return civ.cultures[n]?.name ?? '';
    };
    const refs = chronicleRefs(l.text);
    const pick = (kind: string) => [...new Set(refs.filter(([k]) => k === kind).map(([, n]) => n))];
    return {
      id: id++,
      kind: 'plugin',
      year: l.year,
      end: l.year,
      text: chronicleText(l.text, name),
      tag: PLUGIN_TAG,
      importance: 2,
      polities: pick('polity'),
      regions: pick('region'),
      settlement: pick('settlement')[0] ?? -1,
      plugin: l.by,
    };
  });
}

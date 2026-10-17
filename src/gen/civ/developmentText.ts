/**
 * 发展度的大事写进编年史(kind = 'era',标签"代",界面上叫"时代"):
 * - 世上第一次有州进入某时代:大事(重要度 3),"米里多尔共和国伊洛里恩始入火药时代,为天下之先"。
 * - 各国国都进入新时代(重要度 2)、储量多的州发现大矿、物产采空 / 吃空(重要度 1):只在"全部"里;
 *   发现、采空一国(没有国家的按民族)每样只记头一回;同一国同一年的几件并成一句:"内里尼亚王国始入中古时代,特罗纳发现大铁矿"。
 * 国名用事发当年的国号,地方先写城名、没有城写州名;没有国家的写"某某人"。
 */
import type { Civ, DevEvent, Year } from './types';
import { polityName } from './growth';
import { regionLabel } from './display';
import { ERAS } from './development';
import type { ChronicleEntry, Importance } from './chronicle';

/** 一字标签(界面上的类型名见 timelineLayout.ts 的 TAG_LABEL) */
export const ERA_TAG = '代';

/** 发现大矿:"发现大铁矿"(只有矿会记发现) */
const FIND: Readonly<Record<number, string>> = { 2: '大铜锡矿', 3: '大铁矿', 4: '大煤田', 8: '大油田', 9: '稀有矿富矿', 10: '大金银矿' };
/** 采空 / 吃空:"林木伐尽" */
const GONE: Readonly<Record<number, string>> = {
  0: '地力耗尽',
  1: '草场啃光',
  2: '铜锡矿采空',
  3: '铁矿采空',
  4: '煤田采空',
  5: '林木伐尽',
  7: '渔获捕尽',
  8: '油田采干',
  9: '稀有矿采空',
  10: '金银矿采空',
};

const polName = (civ: Civ, p: number, y: Year) => (p >= 0 && civ.polities[p] ? polityName(civ.polities[p], y) || civ.polities[p].name : '');
const folk = (civ: Civ, c: number) => (c >= 0 && civ.cultures[c]?.name ? `${civ.cultures[c].name}人` : '');
/** 事发的地方:城名,没有城写州名 */
const place = (civ: Civ, e: DevEvent) => (e.settlement >= 0 && civ.settlements[e.settlement]?.name) || (e.region >= 0 ? regionLabel(civ, e.region) : '');
/** 谁:国名,没有国家写"某某人" */
const who = (civ: Civ, e: DevEvent) => polName(civ, e.polity, e.year) || folk(civ, e.culture);

/** 一件事去掉"谁"的那半句 */
function rest(civ: Civ, e: DevEvent): string {
  if (e.kind === 'enter') return `始入${ERAS[e.era]}时代`;
  const k = e.resource ?? -1;
  if (e.kind === 'discover') return `${place(civ, e)}发现${FIND[k] ?? '大矿'}`;
  return `${place(civ, e)}${GONE[k] ?? '物产耗尽'}`;
}

const cache = new WeakMap<Civ, ChronicleEntry[]>();

/**
 * 发展度的大事 → 编年史条目(按年份排好)。id 接在史事、人物、宗教大事后面(不和它们撞);没有发展度 = 空数组。按 civ 缓存
 */
export function developmentEntries(civ: Civ): ChronicleEntry[] {
  const hit = cache.get(civ);
  if (hit) return hit;
  const out: ChronicleEntry[] = [];
  const dev = civ.development;
  if (dev) {
    const n0 = (civ.annals?.length ?? 0) + (civ.people?.length ?? 0) + (civ.religion?.events.length ?? 0);
    const base = (e: DevEvent, i: number, text: string, importance: Importance): ChronicleEntry => ({
      id: n0 + i,
      kind: 'era',
      year: e.year,
      end: e.year,
      text,
      tag: ERA_TAG,
      importance,
      polities: e.polity >= 0 ? [e.polity] : [],
      regions: e.region >= 0 ? [e.region] : [],
      settlement: e.settlement,
    });
    // 世上第一次:那一国同一年国都也进了这个时代的,不再另记
    const firsts = new Set<string>();
    dev.events.forEach((e, i) => {
      if (e.kind !== 'first') return;
      firsts.add(`${e.polity}:${Math.floor(e.year)}:${e.era}`);
      out.push(base(e, i, `${who(civ, e)}${place(civ, e)}始入${ERAS[e.era]}时代,为天下之先`, 3));
    });
    // 各国的:同一国同一年的并成一条(先进时代,再发现,再采空;一步跨几个时代的写"始入青铜、铁器时代")
    const groups = new Map<string, { i: number; list: DevEvent[] }>();
    const order: { i: number; list: DevEvent[] }[] = [];
    // 发现、采空:一国(没有国家的按民族)每样只记头一回,免得金银矿一年年刷屏
    const seen = new Set<string>();
    dev.events.forEach((e, i) => {
      if (e.kind === 'first') return;
      if (e.kind === 'enter' && firsts.has(`${e.polity}:${Math.floor(e.year)}:${e.era}`)) return;
      if (e.kind !== 'enter') {
        const once = `${e.kind}:${e.polity >= 0 ? e.polity : `c${e.culture}`}:${e.resource}`;
        if (seen.has(once)) return;
        seen.add(once);
      }
      const key = e.polity >= 0 ? `${e.polity}:${Math.floor(e.year)}` : `r${e.region}:${i}`;
      let g = groups.get(key);
      if (!g) {
        g = { i, list: [] };
        groups.set(key, g);
        order.push(g);
      }
      g.list.push(e);
    });
    const rank = { enter: 0, discover: 1, deplete: 2, first: 0 } as const;
    for (const g of order) {
      const list = g.list.slice().sort((a, b) => rank[a.kind] - rank[b.kind]);
      const head = list[0];
      const enters = list.filter((e) => e.kind === 'enter');
      const parts: string[] = [];
      if (enters.length) parts.push(`始入${enters.map((e) => ERAS[e.era]).join('、')}时代`);
      for (const e of list) if (e.kind !== 'enter') parts.push(rest(civ, e));
      const e0 = { ...head, year: Math.min(...list.map((e) => e.year)) };
      const entry = base(e0, g.i, `${who(civ, head)}${parts.join(',')}`, enters.length ? 2 : 1);
      entry.regions = [...new Set(list.map((e) => e.region).filter((r) => r >= 0))];
      out.push(entry);
    }
    out.sort((a, b) => a.year - b.year || a.id - b.id);
  }
  cache.set(civ, out);
  return out;
}

/**
 * 发展度的大事写进编年史(kind = 'era',标签"代",界面上叫"时代"):
 * - 世上第一次有州进入某时代:大事(重要度 3),"米里多尔共和国执政官某某时,伊洛里恩始入火药时代,为天下之先"(有国家、当时有君主的写上君主)。
 * - 世上第一次有发明(文字、马镫、印刷术……,见 development.ts 的 INVENTIONS):写法同上,"始创印刷术";要紧的几样是大事,别的重要度 2;
 *   同一处同一年的几样并成一句("始创文字、车轮")。
 * - 全球大疫的凋敝里国都退回上一个时代(regress):大事,"埃维里亚帝国退入铁器时代(疫后凋敝,中古之业渐废)"。
 * - 各国国都进入新时代(重要度 2)、储量多的州发现大矿、物产采空 / 吃空(重要度 1):只在"全部"里;
 *   发现、采空一国(没有国家的按民族)每样只记头一回;同一国同一年的几件并成一句:"内里尼亚王国始入中古时代,特罗纳发现大铁矿"。
 * - 时代做法(practices.ts)里的铁路、电报不另加条目,接在这国有了以后头一条"始入某时代"(各国的,或世上第一次)后面(只写一回):
 *   "大渭始入工业时代,铁路成,自京师至瑞州旬日可达" / "……,电报通,瑞州有变,朝廷当日即知"(瑞州 = 离国都最远的州)。
 * 国名用事发当年的国号,地方先写城名、没有城写州名;没有国家的写"某某人"。
 */
import type { Civ, DevEvent, Year } from '../types';
import { polityName } from '../growth';
import { regionLabel } from './display';
import { ERAS, INVENTIONS } from '../development';
import { rulerAt } from './peopleInfo';
import { farName, farRegion, practicesAt } from './practiceInfo';
import { Practice, hasPractice } from '../practices';
import { rulerBare } from './peopleText';
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

/**
 * 国家 p 在 year 这一年(进新时代那条)已经有了铁路、电报,而且还没写过:"铁路成,自京师至瑞州旬日可达" / "电报通,瑞州有变,朝廷当日即知"
 * (西幻写得平实些);写了的记进 rail / wire
 */
function practiceParts(civ: Civ, p: number, year: Year, rail: Set<number>, wire: Set<number>): string[] {
  if (rail.has(p) && wire.has(p)) return [];
  const m = practicesAt(civ, p, year) ?? 0;
  const doRail = !rail.has(p) && hasPractice(m, Practice.Rail);
  const doWire = !wire.has(p) && hasPractice(m, Practice.Wire);
  if (!doRail && !doWire) return [];
  const far = farName(civ, farRegion(civ, p, year));
  if (!far) return [];
  const east = !!civ.polities[p]?.eastern;
  const out: string[] = [];
  if (doRail) {
    rail.add(p);
    out.push(east ? `铁路成,自京师至${far}旬日可达` : `铁路建成,从都城到${far}只要十来天`);
  }
  if (doWire) {
    wire.add(p);
    out.push(east ? `电报通,${far}有变,朝廷当日即知` : `电报接通,${far}一有变故,朝廷当天就知道`);
  }
  return out;
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
    /** 进新时代的条目(各国的、世上第一次的):铁路、电报接在后面 */
    const eraEntries: { entry: ChronicleEntry; polity: number }[] = [];
    /** 世上第一次:"某国某君时,某城……,为天下之先"(没有国家、当时没有君主的:"某国某城……") */
    const first = (e: DevEvent, i: number, what: string, importance: Importance) => {
      const ruler = e.polity >= 0 && civ.people?.length ? rulerAt(civ, e.polity, e.year) : null;
      const head = ruler ? `${who(civ, e)}${rulerBare(civ, ruler, e.year)}时,${place(civ, e)}` : `${who(civ, e)}${place(civ, e)}`;
      const entry = base(e, i, `${head}${what},为天下之先`, importance);
      if (ruler) entry.people = [ruler.id];
      out.push(entry);
      return entry;
    };
    // 世上第一次:那一国同一年国都也进了这个时代的,不再另记
    const firsts = new Set<string>();
    dev.events.forEach((e, i) => {
      if (e.kind !== 'first') return;
      firsts.add(`${e.polity}:${Math.floor(e.year)}:${e.era}`);
      const entry = first(e, i, `始入${ERAS[e.era]}时代`, 3);
      if (e.polity >= 0) eraEntries.push({ entry, polity: e.polity });
    });
    // 发明:同一处同一年的并成一句
    const inventions = new Map<string, { i: number; e: DevEvent; list: number[] }>();
    dev.events.forEach((e, i) => {
      if (e.kind !== 'invent' || e.invention === undefined || !INVENTIONS[e.invention]) return;
      const key = `${e.region}:${Math.floor(e.year)}`;
      const g = inventions.get(key);
      if (g) g.list.push(e.invention);
      else inventions.set(key, { i, e, list: [e.invention] });
    });
    for (const g of inventions.values()) {
      const major = g.list.some((k) => INVENTIONS[k].major);
      first(g.e, g.i, `始创${g.list.map((k) => INVENTIONS[k].name).join('、')}`, major ? 3 : 2);
    }
    // 各国的:同一国同一年的并成一条(先进时代,再发现,再采空;一步跨几个时代的写"始入青铜、铁器时代")
    const groups = new Map<string, { i: number; list: DevEvent[] }>();
    const order: { i: number; list: DevEvent[] }[] = [];
    // 发现、采空:一国(没有国家的按民族)每样只记头一回,免得金银矿一年年刷屏
    const seen = new Set<string>();
    dev.events.forEach((e, i) => {
      if (e.kind === 'first' || e.kind === 'invent') return;
      // 全球大疫的凋敝里国都退回上一个时代:"埃维里亚帝国退入铁器时代(疫后凋敝,中古之业渐废)"(大事)
      if (e.kind === 'regress') {
        const lost = ERAS[e.era + 1];
        out.push(base(e, i, `${who(civ, e)}退入${ERAS[e.era]}时代${lost ? `(疫后凋敝,${lost}之业渐废)` : ''}`, 3));
        return;
      }
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
    const rank = { enter: 0, discover: 1, deplete: 2, first: 0, invent: 0, regress: 0 } as const;
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
      if (enters.length && head.polity >= 0) eraEntries.push({ entry, polity: head.polity });
    }
    // 铁路、电报:按年份先后,一国接在有了以后的头一条进新时代的后面
    const rail = new Set<number>();
    const wire = new Set<number>();
    eraEntries.sort((a, b) => a.entry.year - b.entry.year || a.entry.id - b.entry.id);
    for (const { entry, polity } of eraEntries) {
      const more = practiceParts(civ, polity, entry.year, rail, wire);
      if (more.length) entry.text += `,${more.join(',')}`;
    }
    out.sort((a, b) => a.year - b.year || a.id - b.id);
  }
  cache.set(civ, out);
  return out;
}

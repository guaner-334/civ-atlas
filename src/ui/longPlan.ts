/**
 * 竖版长图的内容(纯计算,不碰 DOM):这个世界(或一国)的疆域变迁和大事年表,按时代分节。
 *
 *   开头 —— 标题、一句话(一国:国旗、立国那一句、到最后有多少州、历代国号)、最后一年的地图
 *   每节 —— 和导出的编年史一样分(chronicleEraYears;三千年每 500 年一节),没有国家的那几节不出:
 *           节标题、这一节最后一年的疆域图、一句"几国并立,谁最大"(一国:这一国当时多少州)、这一节的大事
 *           (最后一节的疆域就是开头那张,不再放图)
 *   结尾 —— 标题、种子、网址、"模拟生成的架空世界"
 *
 * 一国版:地图裁到这一国、描红边;大事只列和这一国有关的(不列每一次君主继位)。
 * 排版、画法在 render/longImage.ts,地图由 longRun.ts 按这里给的年份拍。同一个世界、同样的选项永远得到同样的内容。
 */
import type { Civ, Polity } from '../gen/civ/types';
import { chronicleEraYears, filterChronicle, type ChronicleEntry } from '../gen/civ/chronicle';
import { ownersAt } from '../gen/civ/timeline';
import { cnPunct } from './filmPlan';
import { polityNameAt, polityUsedNames } from './searchIndex';
import { entryWeight, evType, type EvType } from './timelineLayout';

export type LongScope = 'world' | 'one';

export interface LongOptions {
  scope: LongScope;
  /** 一国版:哪一国 */
  polity: number;
  /** 疆域图:每节一张 / 只要开头一张 */
  maps: 'each' | 'first';
  /** 列出大事 */
  events: boolean;
  /** 标题(大字) */
  title: string;
  /** 世界名(一国版结尾写;没起名 = '') */
  worldTitle: string;
  seed: number;
}

/** 一张地图:拍哪一年;一国版裁到这一国、描红边 */
export interface LongMap {
  year: number;
  polity?: number;
}

export interface LongRow {
  /** "1199""2478—2514";说明行 = '' */
  label: string;
  /** 小圆点的颜色(和时间轴上一样);说明行 = null */
  type: EvType | null;
  text: string;
  /** 说明行(灰字,没有年份) */
  note?: boolean;
  /** 放不下时先去掉轻的(timelineLayout 的 entryWeight) */
  weight: number;
}

export interface LongSection {
  title: string;
  map: LongMap | null;
  cap: string;
  rows: LongRow[];
}

export interface LongDoc {
  title: string;
  /** 一国版的国旗(那一国最后一年的那一面) */
  flag: { polity: number; year: number } | null;
  lead: string;
  /** 一国版:历代国号 */
  lead2: string | null;
  head: LongMap;
  headCap: string;
  sections: LongSection[];
  foot: { bold: string; rest: string; line2: string };
}

/** 某年各州归哪国(到最后一年 = civ.polity) */
function ownersOf(civ: Civ, year: number): Int32Array | Int16Array | number[] {
  return year >= civ.endYear ? civ.polity : ownersAt(civ, year).polity;
}

/** 某年各国有几个州(没有州的不在里面) */
export function regionCounts(civ: Civ, year: number): Map<number, number> {
  const own = ownersOf(civ, year);
  const R = Math.min(civ.regions.count, own.length);
  const n = new Map<number, number>();
  for (let r = 0; r < R; r++) {
    const p = own[r];
    if (p >= 0) n.set(p, (n.get(p) ?? 0) + 1);
  }
  return n;
}

/** 州数从多到少(一样多按编号) */
function ranked(n: Map<number, number>): [number, number][] {
  return [...n].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
}

/** 一国最后的年份:亡了 = 亡国前一刻;还在 = 最后一年 */
export function polityLastYear(civ: Civ, p: Polity): number {
  return p.ended !== undefined ? Math.max(p.founded, Math.min(civ.endYear, p.ended - 1 / 512)) : civ.endYear;
}

export interface LongPolityItem {
  id: number;
  name: string;
  /** 现存:州数;已亡:起止年份 */
  regions: number;
  from: number;
  to: number;
}

/** 选哪一国的菜单:现存的按州数排,已亡的按立国先后排 */
export function longPolities(civ: Civ): { alive: LongPolityItem[]; fallen: LongPolityItem[] } {
  const end = civ.endYear;
  const n = regionCounts(civ, end);
  const alive: LongPolityItem[] = [];
  const fallen: LongPolityItem[] = [];
  for (const p of civ.polities) {
    if (!(p.founded <= end)) continue;
    const r = n.get(p.id) ?? 0;
    const item = { id: p.id, name: polityNameAt(p, polityLastYear(civ, p)), regions: r, from: Math.floor(p.founded), to: Math.floor(p.ended ?? end) };
    (r > 0 ? alive : fallen).push(item);
  }
  alive.sort((a, b) => b.regions - a.regions || a.id - b.id);
  fallen.sort((a, b) => a.from - b.from || a.id - b.id);
  return { alive, fallen };
}

/** 一国版默认哪一国:地图上选中的;没选 = 最后一年最大的 */
export function defaultPolity(civ: Civ, selected: number | null): number | null {
  if (selected !== null && selected >= 0 && selected < civ.polities.length) return selected;
  const { alive, fallen } = longPolities(civ);
  return alive[0]?.id ?? fallen[0]?.id ?? null;
}

/** 大事的年份:"1199";打了几年的 "2478—2514" */
function rowLabel(e: ChronicleEntry): string {
  const a = Math.floor(e.year);
  const b = Math.floor(e.end);
  return b > a ? `${a}—${b}` : `${a}`;
}

function rowOf(e: ChronicleEntry): LongRow {
  return { label: rowLabel(e), type: evType(e), text: cnPunct(e.text), weight: entryWeight(e) };
}

/** 一国版列的大事:和这一国有关、不算小事(重要度 2 起),不列每一次君主继位 */
export function polityEntries(all: readonly ChronicleEntry[], polity: number): ChronicleEntry[] {
  return filterChronicle(all, { polity }).filter((e) => e.kind !== 'reign' && e.importance >= 2);
}

const FOOT_REST = '用「文明与地图」推演生成，atlas.gerdor.top';
const FOOT_LINE2 = '模拟生成的架空世界，不是真实地图。';

/** 某节最后一年的地图拍哪一刻:那一年末(最后一节 = 最后一年) */
const yearEnd = (y: number, end: number) => Math.min(end, y + 1 - 1 / 512);

/**
 * 长图的内容。all = 全部纪事(编年史"全部",一国版从里面挑),majors = 编年史"大事"(整个世界列这些)。
 * 一国版的 polity 不存在(换了世界)时按整个世界出。
 */
export function longDoc(civ: Civ, all: readonly ChronicleEntry[], majors: readonly ChronicleEntry[], opt: LongOptions): LongDoc {
  const p = opt.scope === 'one' ? civ.polities[opt.polity] : undefined;
  return p ? polityDoc(civ, all, p, opt) : worldDoc(civ, majors, opt);
}

function worldDoc(civ: Civ, majors: readonly ChronicleEntry[], opt: LongOptions): LongDoc {
  const end = Math.floor(civ.endYear);
  const span = Math.max(1, chronicleEraYears(civ.endYear));
  const lastEra = Math.max(0, Math.ceil(end / span) - 1);
  const eraOf = (y: number) => Math.min(Math.floor(Math.max(0, y) / span), lastEra);
  const founded = civ.polities.map((p) => p.founded).filter((y) => y <= civ.endYear);
  const first = founded.length ? Math.floor(Math.min(...founded)) : Infinity;
  const aliveEnd = regionCounts(civ, civ.endYear).size;
  const lead = founded.length
    ? `从第 0 年人类登场，到第 ${end} 年。先后立国 ${founded.length} 个，到第 ${end} 年还有 ${aliveEnd} 国。`
    : `从第 0 年人类登场，到第 ${end} 年。这期间还没有国家兴起。`;
  const cap = (y: number) => {
    const top = ranked(regionCounts(civ, yearEnd(y, civ.endYear)));
    const name = (id: number) => polityNameAt(civ.polities[id], yearEnd(y, civ.endYear));
    if (!top.length) return `第 ${y} 年：没有国家`;
    if (top.length === 1) return `第 ${y} 年：只有${name(top[0][0])}（${top[0][1]} 州）`;
    return `第 ${y} 年：${top.length} 国并立，${name(top[0][0])}最大（${top[0][1]} 州）`;
  };
  const sections: LongSection[] = [];
  for (let i = 0; i <= lastEra && Number.isFinite(first); i++) {
    const a = i * span;
    const b = i === lastEra ? end : (i + 1) * span - 1;
    if (b < first) continue;
    const last = i === lastEra;
    const rows = opt.events ? majors.filter((e) => eraOf(e.year) === i).map(rowOf) : [];
    if (opt.events && !sections.length && first > 0) rows.unshift({ label: '', type: null, text: '此前各民族从发源地向外扩散，还没有国家', note: true, weight: Infinity });
    sections.push({
      title: `第 ${a}—${b} 年`,
      map: !last && opt.maps === 'each' ? { year: yearEnd(b, civ.endYear) } : null,
      cap: last ? `这一节末的疆域，就是最上面那张第 ${end} 年的地图` : cap(b),
      rows,
    });
  }
  return {
    title: opt.title,
    flag: null,
    lead,
    lead2: null,
    head: { year: civ.endYear },
    headCap: `第 ${end} 年`,
    sections,
    foot: { bold: opt.title, rest: `，种子 ${opt.seed}。${FOOT_REST}`, line2: FOOT_LINE2 },
  };
}

function polityDoc(civ: Civ, all: readonly ChronicleEntry[], p: Polity, opt: LongOptions): LongDoc {
  const end = Math.floor(civ.endYear);
  const span = Math.max(1, chronicleEraYears(civ.endYear));
  const lastEra = Math.max(0, Math.ceil(end / span) - 1);
  const eraOf = (y: number) => Math.min(Math.floor(Math.max(0, y) / span), lastEra);
  const f = Math.floor(p.founded);
  const lastY = polityLastYear(civ, p);
  const L = Math.floor(lastY);
  // 亡国那一年:地图拍亡国前一刻(lastY),但最后一节和大事写到亡国那年(正好整年亡的,lastY 取整会早一年)
  const E = p.ended !== undefined && p.ended <= civ.endYear ? Math.max(f, Math.floor(p.ended)) : L;
  const name = polityNameAt(p, lastY);
  const entries = polityEntries(all, p.id).filter((e) => Math.floor(e.year) <= E);
  // 开头一句:立国那一条 + 到最后有多少州(已亡:哪年亡、享国几年)
  const found = entries.find((e) => e.kind === 'found' && e.polities[0] === p.id);
  let lead = `第 ${f} 年${found ? cnPunct(found.text) : '立国'}。`;
  if (p.ended === undefined || p.ended > civ.endYear) {
    const top = ranked(regionCounts(civ, civ.endYear));
    const k = top.findIndex(([id]) => id === p.id);
    const n = k >= 0 ? top[k][1] : 0;
    const rank =
      k === 0 && top.length > 1
        ? '，是世界第一大国'
        : k === 1
          ? `，仅次于${polityNameAt(civ.polities[top[0][0]], civ.endYear)}`
          : k > 1
            ? `，在 ${top.length} 国里排第 ${k + 1}`
            : '';
    lead += `到第 ${end} 年有 ${n} 州${rank}。`;
  } else {
    const e = Math.floor(p.ended);
    lead += `第 ${e} 年亡，享国 ${Math.max(1, e - f)} 年。`;
  }
  const used = polityUsedNames(p);
  const cap = (y: number) => {
    const top = ranked(regionCounts(civ, yearEnd(y, civ.endYear)));
    const k = top.findIndex(([id]) => id === p.id);
    const n = k >= 0 ? top[k][1] : 0;
    return `第 ${y} 年：${n} 州${k === 0 && top.length > 1 ? '，世界第一大国' : ''}`;
  };
  const sections: LongSection[] = [];
  for (let i = eraOf(f); i <= eraOf(E); i++) {
    const a = Math.max(i * span, f);
    const b = Math.min(i === lastEra ? end : (i + 1) * span - 1, E);
    const last = i === eraOf(E);
    sections.push({
      title: a < b ? `第 ${a}—${b} 年` : `第 ${a} 年`,
      map: !last && b < L && opt.maps === 'each' ? { year: yearEnd(b, lastY), polity: p.id } : null,
      cap: last ? `这一节末的疆域，就是最上面那张第 ${L} 年的地图` : cap(b),
      rows: opt.events ? entries.filter((e) => eraOf(e.year) === i).map(rowOf) : [],
    });
  }
  const world = opt.worldTitle.trim();
  return {
    title: opt.title,
    flag: { polity: p.id, year: lastY },
    lead,
    lead2: used.length > 1 ? `国号：${used.join(' → ')}` : null,
    head: { year: lastY, polity: p.id },
    headCap: `第 ${L} 年，红线以内是${name}`,
    sections,
    foot: { bold: opt.title, rest: `，${world ? `${world}，` : ''}种子 ${opt.seed}。${FOOT_REST}`, line2: FOOT_LINE2 },
  };
}

/** 文件名:文明与地图-九州大陆-长图.jpg;切开的 -长图-1.jpg …… */
export function longFileName(base: string, page?: number): string {
  return `${base}-长图${page ? `-${page}` : ''}.jpg`;
}

/**
 * 政体名:由推演里已有的制度推出来(国号档位、征法、分封、军制、官制、割据),只读,不改历史。
 * 国家卡片「政体」一行、朝政页用。纯计算,不碰 DOM,能在 worker 和 Node 里跑。
 *
 * 名字和条件是一张表(FORMS),一行一个名字,从上往下先对上的算数:
 *
 *   | 名字                       | 条件                                                                   |
 *   |----------------------------|------------------------------------------------------------------------|
 *   | 诸侯割据                   | 至少 WARLORDS_MIN 州,一半以上的州割据                                  |
 *   | 城邦 / 商人共和国 / 海上帝国 | 海洋共和一系:国号第 0 档 / 第 1–2 档 / 第 3 档                          |
 *   | 部落 / 部落联盟            | 还没称国(国号第 0 档):不到 LEAGUE_MIN 州 / 以上                        |
 *   | 集权王国 / 官僚帝国        | 征税、兵制、官制收归朝廷的够两样(直征、禁军、铨选各算一样;分成、监军、参半各算半样) |
 *   | 封建王国 / 封建帝国        | 分封了边地、设了边镇、许了自辟,或一成半以上的州割据                    |
 *   | 汗国 / 游牧帝国            | 游牧一系                                                               |
 *   | 王国 / 帝国                | 其余                                                                   |
 *
 * 王国还是帝国(汗国还是游牧帝国、集权王国还是官僚帝国……)看国号档位:第 3 档(帝国、大汗国、王朝)算帝国那一头。
 *
 * **历次改制**:只在这一国议事、国号升格、管辖快照(每 20 年一份,割据从它来)的那几年看一次,名字变了就记一条
 * (哪年、从什么变成什么、因为什么)。两次之间州数变了不另看,下一次看时才算进去;
 * 所以某一年的政体名 = 不晚于这一年最近那次看的结果,和历次改制的最后一条对得上。
 * 一国一生只算一次(按那一份历史的史事缓存),拖时间轴时只在里面二分查找。
 */
import { Layer, type Civ, type Polity, type PolityLineage, type Year } from './types';
import { courtRulesAt } from './council';
import { Outcome, applyRule, newRules } from './councilRules';
import { LORD_BYTE, controlAt } from './control';
import { logIndexAfter, ownersAt } from './timeline';
import { polityTierAt } from './growth';

/** 国号到这一档算帝国那一头 */
export const EMPIRE_TIER = 3;
/** 诸侯割据:至少几州、几成的州割据 */
export const WARLORDS_MIN = 6;
export const WARLORDS_SHARE = 0.5;
/** 部落联盟:至少几州 */
export const LEAGUE_MIN = 4;
/** 收归朝廷够几样算集权 */
export const CENTRAL_MIN = 2;
/** 几成的州割据算封建 */
export const FEUDAL_SHARE = 0.15;

/** 推政体名要看的那几样(某一年) */
export interface FormFacts {
  lineage: PolityLineage;
  /** 国号档位(0–3) */
  tier: number;
  /** 征法(0 代收、1 分成、2 直征)、军制(−1 边镇、0 征发、0.5 监军、1 禁军)、官制(−1 自辟、0 荐举、0.5 参半、1 铨选) */
  tax: number;
  army: number;
  office: number;
  /** 分封着边地 */
  fief: boolean;
  /** 州数、其中割据的州数(管辖快照) */
  regions: number;
  lords: number;
}

/** 收归朝廷几样:直征、禁军、铨选各算一样;分成、监军、参半各算半样 */
export function centralScore(f: Pick<FormFacts, 'tax' | 'army' | 'office'>): number {
  return (f.tax >= 2 ? 1 : f.tax === 1 ? 0.5 : 0) + Math.max(0, f.army) + Math.max(0, f.office);
}

/** 割据的州占几成(没有州 = 0) */
export function lordShare(f: Pick<FormFacts, 'regions' | 'lords'>): number {
  return f.regions > 0 ? f.lords / f.regions : 0;
}

/** 地方各自为政:分封了边地、设了边镇、许了自辟,或一成半以上的州割据 */
export function isFeudal(f: FormFacts): boolean {
  return f.fief || f.army < 0 || f.office < 0 || lordShare(f) >= FEUDAL_SHARE;
}

const republic = (f: FormFacts) => f.lineage === 'republic';
const empire = (f: FormFacts) => f.tier >= EMPIRE_TIER;

/** 政体名的表:一行一个名字,从上往下先对上的算数 */
export const FORMS = [
  { name: '诸侯割据', test: (f: FormFacts) => f.regions >= WARLORDS_MIN && lordShare(f) >= WARLORDS_SHARE },
  { name: '城邦', test: (f: FormFacts) => republic(f) && f.tier <= 0 },
  { name: '商人共和国', test: (f: FormFacts) => republic(f) && !empire(f) },
  { name: '海上帝国', test: (f: FormFacts) => republic(f) },
  { name: '部落', test: (f: FormFacts) => f.tier <= 0 && f.regions < LEAGUE_MIN },
  { name: '部落联盟', test: (f: FormFacts) => f.tier <= 0 },
  { name: '集权王国', test: (f: FormFacts) => centralScore(f) >= CENTRAL_MIN && !empire(f) },
  { name: '官僚帝国', test: (f: FormFacts) => centralScore(f) >= CENTRAL_MIN },
  { name: '封建王国', test: (f: FormFacts) => isFeudal(f) && !empire(f) },
  { name: '封建帝国', test: (f: FormFacts) => isFeudal(f) },
  { name: '汗国', test: (f: FormFacts) => f.lineage === 'khanate' && !empire(f) },
  { name: '游牧帝国', test: (f: FormFacts) => f.lineage === 'khanate' },
  { name: '王国', test: (f: FormFacts) => !empire(f) },
  { name: '帝国', test: (_f: FormFacts) => true },
] as const;

export type FormName = (typeof FORMS)[number]['name'];

/** 照表推出名字(表里第几行) */
export function formIndex(f: FormFacts): number {
  for (let i = 0; i < FORMS.length; i++) if (FORMS[i].test(f)) return i;
  return FORMS.length - 1;
}

/** 照表推出名字 */
export function formName(f: FormFacts): FormName {
  return FORMS[formIndex(f)].name;
}

/** 政体名变了是因为什么:立国、议事、国号升格、割据(管辖快照里割据的州多了 / 少了)、州数 */
export type FormCause = 'found' | 'council' | 'title' | 'lords' | 'size';

/** 看过的一次(议事、升格、管辖快照那几年) */
export interface FormLook {
  year: Year;
  facts: FormFacts;
  name: FormName;
  /** 这个名字从哪年起 */
  since: Year;
}

/** 历次改制的一条 */
export interface FormChange {
  year: Year;
  /** 立国那一条 = null */
  from: FormName | null;
  to: FormName;
  cause: FormCause;
  /** 因为议事:那条史事的下标;否则 −1 */
  event: number;
  /** 变之前、之后的样子 */
  before: FormFacts | null;
  after: FormFacts;
}

interface FormBook {
  looks: FormLook[];
  changes: FormChange[];
}

const cache = new WeakMap<object, Map<number, FormBook>>();

/** 史事、国号、管辖快照、归属都按整段历史那一份(地图上画的是更早一段时也一样) */
const fullOf = (civ: Civ): Civ => civ.history ?? civ;

/**
 * 州数、割据的州数:割据的州 = 现在归这一国、管辖快照里是割据、拍快照那年也归这一国的州
 * (快照拍在立国以前、或者那州是后来才打下来的,快照里的割据是别国的,不算)。own 是这一年的归属,snapOwn 是拍快照那年的
 */
function countRegions(own: Int16Array, snapOwn: Int16Array | null, snap: Uint8Array | null, p: number): { regions: number; lords: number } {
  let regions = 0;
  let lords = 0;
  for (let r = 0; r < own.length; r++) {
    if (own[r] !== p) continue;
    regions++;
    if (snap && snapOwn && snap[r] === LORD_BYTE && snapOwn[r] === p) lords++;
  }
  return { regions, lords };
}

/** 不晚于 year 的最近一份管辖快照是哪年拍的(没有 = null) */
function snapYearAt(full: Civ, year: Year): Year | null {
  const ys = full.development?.controlYears;
  if (!ys?.length) return null;
  const i = lastAtOrBefore(ys, year);
  return i >= 0 ? ys[i] : null;
}

/** 某一年的那几样(现算,不用缓存;单测核对用) */
export function formFactsAt(civ: Civ, p: number, year: Year): FormFacts | null {
  const full = fullOf(civ);
  const P = full.polities[p];
  if (!P || !(year >= P.founded)) return null;
  const own = ownersAt(full, year).polity;
  const sy = snapYearAt(full, year);
  const snapOwn = sy === null ? null : ownersAt(full, sy).polity;
  const { regions, lords } = countRegions(own, snapOwn, controlAt(full, year), p);
  const rules = courtRulesAt(full, p, year);
  return {
    lineage: P.lineage ?? 'realm',
    tier: Math.max(0, polityTierAt(P, year)),
    tax: rules.tax,
    army: rules.army,
    office: rules.office,
    fief: rules.fiefBy >= 0,
    regions,
    lords,
  };
}

/** 一国一生看的那几年:立国、议事、升格、管辖快照(按先后,去重);议事那几年带上史事下标 */
function lookYears(full: Civ, P: Polity, end: Year): { year: Year; events: number[] }[] {
  const m = new Map<Year, number[]>();
  const add = (y: Year) => {
    if (y >= P.founded && y <= end && !m.has(y)) m.set(y, []);
  };
  add(P.founded);
  for (const t of P.titles ?? []) add(t.year);
  for (const y of full.development?.controlYears ?? []) add(y);
  const A = full.annals;
  for (let i = 0; i < A.length; i++) {
    const e = A[i];
    if (e.year > end) break;
    if (e.kind !== 'council' || e.a !== P.id || e.year < P.founded) continue;
    add(e.year);
    m.get(e.year)!.push(i);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([year, events]) => ({ year, events }));
}

function sameRules(a: FormFacts, b: FormFacts): boolean {
  return a.tax === b.tax && a.army === b.army && a.office === b.office && a.fief === b.fief;
}

/** 一国一生的政体名:看过的每一次、历次改制(按那一份历史缓存) */
function formBook(civ: Civ, p: number): FormBook {
  const full = fullOf(civ);
  let byP = cache.get(full.annals);
  if (!byP) cache.set(full.annals, (byP = new Map()));
  const hit = byP.get(p);
  if (hit) return hit;
  const P = full.polities[p];
  const book: FormBook = { looks: [], changes: [] };
  byP.set(p, book);
  if (!P) return book;
  const end = Math.min(P.ended ?? Infinity, full.endYear);
  const years = lookYears(full, P, end);
  if (!years.length) return book;
  // 归属从立国那年往后顺着日志补(不逐年重算);规矩只在议事那几年变,照史事一条条重建(和 courtRulesAt 同一个算法)
  const own = ownersAt(full, years[0].year).polity;
  const log = full.log;
  let li = logIndexAfter(log, years[0].year);
  const rules = newRules();
  // 拍快照那年的归属(快照那几年都在要看的年份里,看到时记下)
  const snapYears = new Set(full.development?.controlYears ?? []);
  let snapOwn: Int16Array | null = null;
  let prev: FormFacts | null = null;
  let since = years[0].year;
  for (const { year, events } of years) {
    for (; li < log.size && log.year[li] <= year; li++) if (log.layer[li] === Layer.Polity) own[log.region[li]] = log.value[li];
    for (const id of events) {
      const e = full.annals[id];
      applyRule(rules, e.war, e.n ?? Outcome.Shelve, e.year);
    }
    if (snapYears.has(year)) snapOwn = own.slice();
    const { regions, lords } = countRegions(own, snapOwn, controlAt(full, year), p);
    const facts: FormFacts = {
      lineage: P.lineage ?? 'realm',
      tier: Math.max(0, polityTierAt(P, year)),
      tax: rules.tax,
      army: rules.army,
      office: rules.office,
      fief: rules.fief !== undefined,
      regions,
      lords,
    };
    const name = formName(facts);
    const last = book.looks[book.looks.length - 1];
    if (!last || last.name !== name) {
      since = year;
      let cause: FormCause = 'found';
      let event = -1;
      if (prev) {
        if (events.length && !sameRules(prev, facts)) {
          cause = 'council';
          event = events[events.length - 1];
        } else if (facts.tier !== prev.tier) cause = 'title';
        else if (facts.lords !== prev.lords) cause = 'lords';
        else cause = 'size';
      }
      book.changes.push({ year, from: last ? last.name : null, to: name, cause, event, before: prev, after: facts });
    }
    book.looks.push({ year, facts, name, since });
    prev = facts;
  }
  return book;
}

/** 不晚于 year 的最后一个下标(year 比第一个还早 = −1) */
function lastAtOrBefore<T extends { year: Year } | Year>(list: readonly T[], year: Year): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const v = list[mid];
    if ((typeof v === 'number' ? v : (v as { year: Year }).year) <= year) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** 国家 p 第 year 年的政体(名字、从哪年起、推名字用的那几样);还没立国 = null */
export function polityFormAt(civ: Civ, p: number, year: Year): FormLook | null {
  const { looks } = formBook(civ, p);
  const i = lastAtOrBefore(looks, year);
  return i >= 0 ? looks[i] : null;
}

/** 国家 p 到 year 这一年为止的历次改制(按先后;第一条是立国) */
export function formChangesAt(civ: Civ, p: number, year: Year): FormChange[] {
  const { changes } = formBook(civ, p);
  return changes.slice(0, lastAtOrBefore(changes, year) + 1);
}

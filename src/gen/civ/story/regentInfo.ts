/**
 * 掌实权、联姻在卡片、世系图、编年史上的整理(纯计算,不碰 DOM;推演那一半在 regents.ts、marriages.ts):
 *
 * - holdersOf / holderAt   某国掌过实权的几段(人物上 Person.regencies,按掌权先后)/ 某一年谁掌着实权(from–until 之间)
 * - heldOver               一位君主在位时被谁架空过:名义君主是他的那几段;大臣、大将专权跨了几位君主的,在位年份重叠的也算
 * - kinAt / inLawsAt       两国到某一年结着亲(最近一门亲 KIN_FADE 年内、那以后两国没开过战,和推演里 bondOf 同一个算法)/ 某国那一年的姻亲
 * - brideName / polityShort  宗室女的名字(她是人物的写名字;不然 "风氏",没有姓的语感写"大澜公主")、国名的简称("大澜""南漓")
 * - brideMatchOf           嫁来的宗室女嫁过来的那一门亲
 * - REGENCY_VERB / REGENCY_END  几种掌权、几种结局的说法
 */
import type { Annal, Civ, Person, PersonRegency, PersonSpouse, Year } from '../types';
import { polityName, polityShortTitle, polityTierAt } from '../growth';
import { MARRIAGES_KNOBS, kinKey } from '../marriages';
import { knobsOf } from '../knobs';
import { actsFrom, reignBook, rulerBase, rulerTags, type RulerAct } from '../rulers';
import { broodOf } from '../royals';

/** 掌权的一段连同掌权的人 */
export interface Held {
  x: Person;
  g: PersonRegency;
}

/** 几种掌权的说法(卡片「实权」「掌权」一行的小字):引兵入朝不另写(「争储」一行写了) */
export const REGENCY_VERB: Readonly<Record<PersonRegency['kind'], string>> = {
  march: '',
  heir: '监国',
  uncle: '摄政',
  minister: '辅政',
  dowager: '临朝',
  chancellor: '专权',
  general: '专权',
};

/** 几种结局的说法:即位(引兵入朝、太子监国)、名义君主先没了、改朝换代 / 亡国不另写 */
export const REGENCY_END: Readonly<Partial<Record<NonNullable<PersonRegency['end']>, string>>> = {
  return: '还政',
  purged: '伏诛',
  usurp: '篡位',
  died: '卒于位',
};

/** 大臣、大将专权:跨几位君主也照旧 */
export const strongHeld = (g: PersonRegency) => g.kind === 'chancellor' || g.kind === 'general';

const holdCache = new WeakMap<object, Held[][]>();

/** 某国掌过实权的几段(按掌权先后) */
export function holdersOf(civ: Civ, pid: number): readonly Held[] {
  const key = civ.people ?? civ.annals;
  let all = holdCache.get(key);
  if (!all || all.length !== civ.polities.length) {
    all = civ.polities.map(() => []);
    // 嫁来的宗室女做了太后:记在临朝的那一国(幼主那一国),不是她娘家
    for (const x of civ.people ?? []) for (const g of x.regencies ?? []) all[g.kind === 'dowager' ? (civ.people?.[g.ruler]?.polity ?? x.polity) : x.polity]?.push({ x, g });
    for (const list of all) list.sort((a, b) => a.g.from - b.g.from || a.x.id - b.x.id);
    holdCache.set(key, all);
  }
  return all[pid] ?? [];
}

/** 某国 t 这一年谁掌着实权(掌权那一刻起、到结束那一刻为止;没有 = null) */
export function holderAt(civ: Civ, pid: number, t: Year): Held | null {
  const list = holdersOf(civ, pid);
  for (let i = list.length - 1; i >= 0; i--) {
    const h = list[i];
    if (h.g.from <= t && t < (h.g.until ?? Infinity)) return h;
  }
  return null;
}

/** 掌权的一段和君主 r 在位的年份重叠的那一截:[from, until)(还在掌权 / 还在位 = undefined) */
export function overlapOf(g: PersonRegency, r: Person): { from: Year; until: Year | undefined } {
  const from = Math.max(g.from, r.from ?? -Infinity);
  const ends = [g.until, r.until].filter((v): v is Year => v !== undefined);
  return { from, until: ends.length ? Math.min(...ends) : undefined };
}

/** 君主 r 在位时被谁架空过(按先后) */
export function heldOver(civ: Civ, r: Person): Held[] {
  if (r.role !== 'ruler') return [];
  const from = r.from ?? Infinity;
  const until = r.until ?? Infinity;
  return holdersOf(civ, r.polity).filter(
    (h) => h.x !== r && (h.g.ruler === r.id || (strongHeld(h.g) && h.g.from < until && (h.g.until ?? Infinity) > from)),
  );
}

// ---------------------------------------------------------------------------
// 预定的继承人

interface BookCtx {
  base: number;
  tag: number[];
  acts: Map<number, RulerAct[]>;
}
const bookCache = new WeakMap<readonly Annal[], BookCtx>();

/**
 * 君主 N 预定的继承人的生年(royals.ts 的 heir:在位表里下一位不被打断时即位、年纪合得上他的儿子;和推演里认人的一样;没有 = undefined)。
 * 推演还没推到 N 下台(逐年推演、推到最后还在位)时,继承人在人物里还是宗室,这样才认得出
 */
export function heirBornOf(civ: Civ, N: Person): Year | undefined {
  const P = civ.polities[N.polity];
  if (!P || N.role !== 'ruler' || N.author !== undefined || N.from === undefined) return undefined;
  let cx = bookCache.get(civ.annals);
  if (!cx) {
    cx = { base: rulerBase(civ.seed), tag: rulerTags(civ.polities, (sid) => civ.settlements[sid]?.cell ?? -1), acts: actsFrom(civ.annals, civ.interventions) };
    bookCache.set(civ.annals, cx);
  }
  const at = N.from + 1 / 512;
  const knobs = knobsOf(civ);
  const book = reignBook(knobs, cx.base, cx.tag[N.polity], P, at, cx.acts.get(N.polity));
  const r = book.find((x) => Math.abs(x.from - N.from!) < 1e-6 && !x.crown);
  return r ? broodOf(knobs, cx.base, cx.tag[N.polity], r, P).heir : undefined;
}

// ---------------------------------------------------------------------------
// 姻亲

interface PairEv {
  t: Year;
  marry: boolean;
  annal: number;
}
interface KinIndex {
  /** 两国(无序)→ 结亲、开战,按先后 */
  pairs: Map<number, PairEv[]>;
  /** 国家 → 结过亲的国家 */
  partners: Map<number, Set<number>>;
}
const kinCache = new WeakMap<readonly Annal[], KinIndex>();

function kinIndex(civ: Civ): KinIndex {
  const hit = kinCache.get(civ.annals);
  if (hit) return hit;
  const ix: KinIndex = { pairs: new Map(), partners: new Map() };
  civ.annals.forEach((e, annal) => {
    if ((e.kind !== 'marry' && e.kind !== 'war') || e.a < 0 || e.b < 0 || e.a === e.b) return;
    const k = kinKey(e.a, e.b);
    const list = ix.pairs.get(k);
    const ev = { t: e.year, marry: e.kind === 'marry', annal };
    if (list) list.push(ev);
    else ix.pairs.set(k, [ev]);
    if (e.kind !== 'marry') return;
    for (const [p, q] of [
      [e.a, e.b],
      [e.b, e.a],
    ]) {
      const s = ix.partners.get(p);
      if (s) s.add(q);
      else ix.partners.set(p, new Set([q]));
    }
  });
  kinCache.set(civ.annals, ix);
  return ix;
}

/**
 * a、b 两国 t 那一年结着的那门亲:最近一门(谁娶谁都算)在 KIN_FADE 年内、那以后两国没开过战 —— 那条史事 marry 的下标;没有 = −1。
 * before = 只算 t 以前结的(编年史里结盟那一条:"两国本为姻亲");不给 = 连 t 那一刻结的也算
 */
export function kinAt(civ: Civ, a: number, b: number, t: Year, before = false): number {
  const list = kinIndex(civ).pairs.get(kinKey(a, b));
  if (!list) return -1;
  const { KIN_FADE } = knobsOf(civ).get(MARRIAGES_KNOBS);
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (before ? !(e.t < t) : e.t > t) continue;
    if (!e.marry) return -1;
    return t - e.t < KIN_FADE ? e.annal : -1;
  }
  return -1;
}

/** 某国 t 那一年的姻亲:哪国、结的那门亲(史事下标、年份),按结亲先后 */
export function inLawsAt(civ: Civ, pid: number, t: Year): { polity: number; annal: number; year: Year }[] {
  const out: { polity: number; annal: number; year: Year }[] = [];
  for (const q of kinIndex(civ).partners.get(pid) ?? []) {
    if (!civ.polities[q] || !(civ.polities[q].founded <= t) || (civ.polities[q].ended ?? Infinity) <= t) continue;
    const annal = kinAt(civ, pid, q, t);
    if (annal >= 0) out.push({ polity: q, annal, year: civ.annals[annal].year });
  }
  return out.sort((a, b) => a.year - b.year || a.polity - b.polity);
}

// ---------------------------------------------------------------------------
// 说法

/** 国名的简称(地图上的那个:"大澜""南漓";西幻 = 词根);t 那一年的 */
export function polityShort(civ: Civ, pid: number, t: Year): string {
  const p = civ.polities[pid];
  if (!p) return '';
  const tier = polityTierAt(p, t);
  return (tier >= 0 ? polityShortTitle(p, tier, t) : '') || polityName(p, t) || p.name;
}

/** 宗室女那一行:东方带姓 = "风氏";别的语感没有名字 = "大澜公主" */
export function brideName(civ: Civ, s: PersonSpouse): string {
  const b = s.person !== undefined ? civ.people?.[s.person] : undefined;
  return b?.name || s.name || `${polityShort(civ, s.polity, s.year)}公主`;
}

/** 嫁来的宗室女(后妃)嫁过来的那一门亲(记在她丈夫的 spouses 里);不是 = undefined */
export function brideMatchOf(civ: Civ, x: Person): PersonSpouse | undefined {
  if (x.role !== 'consort' || x.husband === undefined) return undefined;
  return civ.people?.[x.husband]?.spouses?.find((s) => s.person === x.id);
}

/**
 * 国家卡片「朝政」一行和朝政页(CourtPage.tsx)要的数和句子。纯计算,不碰 DOM。
 *
 * - 议定的规矩(征税的法子、分封着没有、议过哪些事)由史事 council 重建(gen/civ/council.ts 的 courtRulesAt),只读,不改历史。
 * - 封地:分封着的国家里,管得到三成半以下、没有割据的州(管辖快照,和管辖图层同一份);人口多的在前,分封那次点了名的那州排第一。
 * - 割据:和管辖图层同一份(render/civ/control.ts 的 lordsAt)。
 * - 钱数从钱粮账本来(fiscalBook.ts;千石,页面上写万石):直征 / 分成多派官吏的开销 = 征费 × 应缴;
 *   封地的岁贡 = 自治那一档的截留 ÷ 截留的几成 × 交的几成(分封着时自治那一档正好就是封地);割据一文不交 = 割据那一档的截留。
 */
import type { Annal, Civ, Year } from '../gen/civ/types';
import { COUNCIL_CONSTS, COUNCIL_GATE, councilAble, courtRulesAt, type CourtRules } from '../gen/civ/council';
import { councilBefore } from '../gen/civ/councilRules';
import { LORD_BYTE, controlAt, controlShare } from '../gen/civ/control';
import { ownersAt, type Owners } from '../gen/civ/timeline';
import { regionLabel } from '../gen/civ/display';
import { polityName, regionPopulationAt } from '../gen/civ/growth';
import { fiscalAt } from '../gen/civ/fiscalBook';
import { rulerAt } from '../gen/civ/peopleInfo';
import { rulerBare, rulerRef } from '../gen/civ/peopleText';
import { cnNumber } from '../gen/civ/chronicle';
import { yearAt, yearShort, yearShortAt, type Era } from '../gen/era';
import { lordsAt, type LordNow } from '../render/civ/control';
import { wan } from './fiscalInfo';

/** 征税的三种法子(征法 0、1、2) */
export const LEVY_NAMES = ['地方代收', '与地方分成', '朝廷直征'] as const;
/** 议题(史事的 war 列;5–8 按议之前的军制、官制分两种叫法,见 issueName) */
export const ISSUE_NAMES = ['罢直征', '削藩', '直征', '改土归流', '分封边地', '收兵权', '设边镇', '行铨选', '许自辟', '分镇', '脱离'] as const;

/** 一条议事的议题名:收兵权 / 罢边镇、设边镇 / 罢禁军、行铨选 / 收回辟署、许自辟 / 罢铨选(b = 议之前那国的军制、官制) */
function issueName(e: Annal, b: { army: number; office: number } | undefined): string {
  const army = b?.army ?? 0;
  const office = b?.office ?? 0;
  if (e.war === 5 && army < 0) return '罢边镇';
  if (e.war === 6 && army > 0) return '罢禁军';
  if (e.war === 7 && office < 0) return '收回辟署';
  if (e.war === 8 && office > 0) return '罢铨选';
  return ISSUE_NAMES[e.war] ?? '议事';
}
/** 结果(史事的 n 列)和标签的样子 */
export const OUTCOME_NAMES = ['办成', '妥协', '搁置', '谈崩'] as const;
export const OUTCOME_KEYS = ['done', 'half', 'shelve', 'break'] as const;

export interface CourtView {
  rules: CourtRules;
  /** 议事用的那一份史事(地图上画的是更早一段时用整段历史那一份) */
  annals: readonly Annal[];
  /** 够格议事(州数、立国年数;不看打不打仗) */
  able: boolean;
  /** 概况里有「朝政」一行:够格议事,或者议过事 */
  shown: boolean;
  /** 封地(没分封 = 空) */
  fiefs: number[];
  /** 现在的割据(先起的在上) */
  lords: LordNow[];
  /** 割据的州一共几个 */
  lordRegions: number;
  /** 钱(千石;没有账本 = 0):多派官吏一年多花、封地一年交的岁贡、割据一年截留 */
  levyCost: number;
  tribute: number;
  lordKept: number;
}

let owners: Owners | undefined;

/** 国家 p 第 year 年的朝政 */
export function courtView(civ: Civ, p: number, year: Year): CourtView {
  const src = civ.history ?? civ;
  const rules = courtRulesAt(src, p, year);
  owners = ownersAt(civ, year, owners);
  const own = owners.polity;
  let n = 0;
  for (let r = 0; r < own.length; r++) if (own[r] === p) n++;
  const able = councilAble(civ.polities[p], n, year);
  const fiefs: number[] = [];
  const snap = rules.fiefBy >= 0 ? controlAt(civ, year) : null;
  if (snap) {
    for (let r = 0; r < own.length; r++) if (own[r] === p && isFief(snap[r])) fiefs.push(r);
    const named = src.annals[rules.fiefBy].region;
    const pop = new Map(fiefs.map((r) => [r, regionPopulationAt(civ, r, year)]));
    fiefs.sort((a, b) => Number(b === named) - Number(a === named) || pop.get(b)! - pop.get(a)! || a - b);
  }
  const lords = lordsAt(civ, year).filter((w) => w.p === p);
  const row = fiscalAt(civ, p, year)?.values;
  const { FIEF_REMIT } = COUNCIL_CONSTS;
  return {
    rules,
    annals: src.annals,
    able,
    shown: able || rules.events.length > 0,
    fiefs,
    lords,
    lordRegions: lords.reduce((s, w) => s + w.regions.length, 0),
    levyCost: row ? row.征费 * row.应缴 : 0,
    tribute: row && fiefs.length ? (row.截留自治 * FIEF_REMIT) / (1 - FIEF_REMIT) : 0,
    lordKept: row ? row.截留割据 : 0,
  };
}

/** 快照里的一个数是不是封地的样子(在国家里、不是割据、管得到三成半以下);国家分封着没有另看 */
function isFief(v: number): boolean {
  return v > 0 && v !== LORD_BYTE && controlShare(v) < COUNCIL_CONSTS.FIEF_C;
}

/** 州卡片:r 州第 year 年是不是封地(归 p 国、p 国分封着、管得到三成半以下) */
export function isFiefRegion(civ: Civ, p: number, r: number, year: Year): boolean {
  const v = controlAt(civ, year)?.[r];
  if (p < 0 || !v || !isFief(v)) return false;
  return courtRulesAt(civ.history ?? civ, p, year).fiefBy >= 0;
}

/** 当时在位的君主怎么称呼:带国号("有梧仁宗")/ 不带("孝宗");没有人物 = 国名 / 空 */
function who(civ: Civ, p: number, y: Year, bare: boolean): string {
  const x = rulerAt(civ, p, y);
  if (x) return bare ? rulerBare(civ, x, y) : rulerRef(civ, x, y);
  const P = civ.polities[p];
  return bare || !P ? '' : polityName(P, y);
}

const OFFICE = '(算在钱粮的「养官」里)';
const LOCAL = '各州自己收税,按中央管得到几成往上交。';

/** 征税那一块的一句话:哪年谁定的、各州多交多少、朝廷多花多少 */
export function levySay(civ: Civ, p: number, v: CourtView, era?: Era | null): string {
  const { tax, taxBy, taxFrom } = v.rules;
  if (taxBy < 0) return `立国以来一直由地方代收:${LOCAL}`;
  const e = v.annals[taxBy];
  const Y = yearAt(e.year, era);
  const east = !!civ.polities[p]?.eastern;
  const cost = wan(v.levyCost);
  const spend = `朝廷多派官吏${cost > 0 ? `,每年多花约 ${cost} 万石${OFFICE}` : OFFICE}。`;
  if (tax === 0) return `${Y}${taxFrom === 1 ? '分成之法' : '直征'}所得不抵所费,复由地方代收:${LOCAL}`;
  if (tax === 1) return `${Y}${who(civ, p, e.year, false)}议行直征,地方${east ? '豪族' : '贵族'}力阻,改成和地方分成:各州比代收多交上来一截,${spend}`;
  return `${Y}${who(civ, p, e.year, false)}行直征之法,遣官到各州自收赋税:各州比代收多交上来一大截,${spend}`;
}

/** 分封那一行的小字:"孝宗,2908 年起" */
export function fiefSince(civ: Civ, p: number, v: CourtView, era?: Era | null): string {
  const e = v.annals[v.rules.fiefBy];
  const w = who(civ, p, e.year, true);
  return `${w ? `${w},` : ''}${yearAt(e.year, era)}起`;
}

/** 分封底下一句 */
export function fiefFoot(v: CourtView): string {
  const t = wan(v.tribute);
  return `封地一年只交岁贡${t > 0 ? `(约 ${t} 万石)` : ''},那里不容易生乱,起割据的机会少一半。管得到三成半以下的边州都算封地。`;
}

/** 一处割据的名字:"崇门之野等七州" */
export function lordName(civ: Civ, w: LordNow): string {
  const k = w.regions.length;
  const place = regionLabel(civ, w.region);
  return k > 1 ? `${place}等${k === 2 ? '两' : cnNumber(k)}州` : place;
}

/** 割据底下一句:名义上还归本国、一文不交;议没议过削藩 */
export function lordFoot(civ: Civ, p: number, v: CourtView, year: Year, era?: Era | null): string {
  const age = COUNCIL_GATE.cutAge;
  if (!v.lords.length) return `割据满 ${age} 年,朝廷才会议削藩。`;
  const P = civ.polities[p];
  const k = wan(v.lordKept);
  const head = `名义上还归${P ? polityName(P, year) : '本国'},国界照旧画在国内;赋税一文不交${k > 0 ? `(一年约 ${k} 万石)` : ''}。`;
  // 议过的削藩:这几处割据起了以后、议的是它们
  const cuts = v.rules.events.map((i) => v.annals[i]).filter((e) => e.war === 1 && v.lords.some((w) => w.region === e.region && e.year >= w.start));
  if (!cuts.length) {
    const old = v.lords.some((w) => year - w.start >= age);
    return head + (old ? `割据满 ${age} 年就能议削藩,还没议过。` : `割据满 ${age} 年,朝廷才会议削藩。`);
  }
  const ys = cuts.map((e) => e.year);
  const when = [...ys.slice(0, -1).map((y) => yearShort(y, era)), yearShortAt(ys[ys.length - 1], era)].join('、');
  if (cuts.length === 1) return `${head}割据满 ${age} 年就能议削藩:${when}议过一次,怕它起兵,作罢。`;
  return `${head}割据满 ${age} 年就能议削藩:${when}议过${cuts.length === 2 ? '两' : cnNumber(cuts.length)}次,都怕它起兵,作罢。`;
}

/** 概况那一行的小字(分封、割据另写):议过事写现在的法子哪年起;议过但没改过法子写议过几次;没议过写"没议过事" */
export function courtRowNote(v: CourtView, era?: Era | null): string {
  const { taxBy, events } = v.rules;
  if (!events.length) return '没议过事';
  if (taxBy >= 0) return `${yearAt(v.annals[taxBy].year, era)}起`;
  return `议过 ${events.length} 次`;
}

/** 历次议事的一条 */
export interface CourtEvent {
  /** 史事下标 */
  id: number;
  year: Year;
  issue: string;
  /** 0 办成、1 妥协、2 搁置、3 谈崩 */
  out: number;
  /** 规矩因此变了:"从此和地方分成";没变 = null */
  then: string | null;
}

/** 历次议事(新的在上) */
export function courtEvents(civ: Civ, v: CourtView): CourtEvent[] {
  // 改军制、改官制的叫法和结果看议之前是哪一档(只有议过这几种时才翻一遍史事)
  const before = v.rules.events.some((id) => v.annals[id].war >= 5 && v.annals[id].war <= 8) ? councilBefore(v.annals) : [];
  return v.rules.events
    .map((id) => {
      const e = v.annals[id];
      const out = e.n ?? 2;
      const name = issueName(e, before[id]);
      return { id, year: e.year, issue: name, out, then: thenText(civ, e, out, name) };
    })
    .reverse();
}

function thenText(civ: Civ, e: Annal, out: number, name: string): string | null {
  const r = regionLabel(civ, e.region);
  switch (e.war) {
    case 0:
      return out === 0 ? '从此复由地方代收' : null;
    case 1:
      return out === 0 ? `${r}收回` : out === 3 ? `${r}起兵自立` : null;
    case 2:
      return out === 0 ? '从此朝廷直征' : out === 1 ? '从此和地方分成' : out === 3 ? `从此${r}割据` : null;
    case 3:
      return out === 0 ? '从此边州收归朝廷' : out === 3 ? `从此${r}割据` : null;
    case 4:
      return out === 0 ? '从此管不到的边州成了封地' : null;
    case 5:
      if (out === 3) return `从此${r}割据`;
      if (name === '罢边镇') return out === 0 ? '从此兵马复归朝廷' : null;
      return out === 0 ? '从此兵权归朝廷' : out === 1 ? '从此派监军' : null;
    case 6:
      if (name === '罢禁军') return out === 0 ? '从此复由州郡征兵' : null;
      return out === 0 ? '从此边将专兵' : null;
    case 7:
      if (out === 3) return `从此${r}割据`;
      if (name === '收回辟署') return out === 0 ? '从此长吏复由朝廷选派' : null;
      return out === 0 ? '从此长吏由朝廷选派' : out === 1 ? '从此铨选、荐举各半' : null;
    case 8:
      if (name === '罢铨选') return out === 0 ? '从此复由地方荐举' : null;
      return out === 0 ? '从此豪族世守其地' : null;
    case 9:
      return out === 0 ? `${r}割据只留一州` : out === 1 ? `${r}割据的地盘收回一半` : out === 3 ? `${r}起兵自立` : null;
    case 10:
      return out === 0 ? `${r}等地归${civ.polities[e.b] ? polityName(civ.polities[e.b], e.year) : '邻国'}` : out === 3 ? `${r}起兵自立` : null;
    default:
      return null;
  }
}

/** 没议过事时那一块写什么 */
export function courtEmpty(): string {
  return `还没议过事。国家到 ${COUNCIL_GATE.size} 个州、立国满 ${COUNCIL_GATE.age} 年,不打仗的年份里朝廷隔些年会议一件事:改征税的法子、分封或收回边地、削藩。`;
}

/** 地图上圈亮时的小牌子:"关右等 31 州封地"、"崇门之野等 7 州割据" */
export function mapTagText(civ: Civ, regions: readonly number[], what: string): string {
  if (!regions.length) return '';
  return `${regionLabel(civ, regions[0])}${regions.length > 1 ? `等 ${regions.length} 州` : ''}${what}`;
}


/**
 * 国家卡片「朝政」一行和朝政页(CourtPage.tsx)要的数和句子。纯计算,不碰 DOM。
 *
 * - 议定的规矩(征税的法子、分封着没有、议过哪些事)由史事 council 重建(gen/civ/council.ts 的 courtRulesAt),只读,不改历史。
 * - 封地:分封着的国家里,管得到三成半以下、没有割据的州(管辖快照,和管辖图层同一份);人口多的在前,分封那次点了名的那州排第一。
 * - 割据:和管辖图层同一份(render/civ/control.ts 的 lordsAt)。
 * - 钱数从钱粮账本来(fiscalBook.ts;千石,页面上写万石):直征 / 分成多派官吏的开销 = 征费 × 应缴;
 *   封地的岁贡 = 自治那一档的截留 ÷ 截留的几成 × 交的几成(分封着时自治那一档正好就是封地);割据一文不交 = 割据那一档的截留。
 * - 政体名、历次改制由 gen/civ/polityForm.ts 推;这里只写成句子(为什么叫这个、每次改制因为什么)。
 * - 还议不了的几档(courtLocks):国中还没有户籍 / 常备军 / 文官考选(做法表,gen/civ/practices.ts;按国都那州那一年的能力)时,
 *   直征 / 监军和禁军 / 参半和铨选比现在那档高的画斜纹,下面一句写要等什么。
 */
import type { Annal, Civ, Year } from '../gen/civ/types';
import { COUNCIL_CONSTS, COUNCIL_GATE, councilAble, courtRulesAt, type CourtRules } from '../gen/civ/council';
import { councilBefore } from '../gen/civ/councilRules';
import { LORD_BYTE, controlAt, controlShare } from '../gen/civ/control';
import { ownersAt, type Owners } from '../gen/civ/timeline';
import { regionLabel } from '../gen/civ/story/display';
import { polityName, regionPopulationAt } from '../gen/civ/growth';
import { fiscalAt } from '../gen/civ/fiscalBook';
import { rulerAt } from '../gen/civ/story/peopleInfo';
import { rulerBare, rulerRef } from '../gen/civ/story/peopleText';
import { cnNumber, reformText } from '../gen/civ/story/chronicle';
import { dynastyIndexAt } from '../gen/civ/polityRoot';
import { Issue, REFORM_REVOLUTION } from '../gen/civ/councilRules';
import { yearAt, yearShort, yearShortAt, type Era } from '../gen/era';
import { lordsAt, type LordNow } from '../render/civ/control';
import { Outcome, applyRule, newRules } from '../gen/civ/councilRules';
import { FEUDAL_SHARE, formDims, lordShare, type FormChange, type FormFacts, type FormLook, type FormName } from '../gen/civ/story/polityForm';
import { wan } from './fiscalInfo';
import { practicesAt } from '../gen/civ/story/practiceInfo';
import { PRACTICES, Practice, hasPractice } from '../gen/civ/practices';

/** 征税的三种法子(征法 0、1、2) */
export const LEVY_NAMES = ['地方代收', '与地方分成', '朝廷直征'] as const;
/** 朝政页三条分段条上的字(从地方说了算到朝廷说了算):征税(征法 0–2)、兵制(军制 −1、0、0.5、1)、官制(官制 −1、0、0.5、1) */
export const TAX_SEGS = ['代收', '分成', '直征'] as const;
export const ARMY_SEGS = ['边镇', '征发', '监军', '禁军'] as const;
export const OFFICE_SEGS = ['自辟', '荐举', '参半', '铨选'] as const;
/** 继任、议政、参与三条分段条上的字(从少数人说了算到众人说了算;polityForm.ts 的 formDims) */
export const SUCC_SEGS = ['拥立', '世袭', '推举', '任期'] as const;
export const DELIB_SEGS = ['军人', '独断', '议事会', '议会'] as const;
export const VOICE_SEGS = ['贵族', '有产者', '男子', '成年人'] as const;
/** 军制、官制(−1、0、0.5、1)→ 分段条第几格 */
export const ruleSeg = (v: number): number => (v < 0 ? 0 : v === 0 ? 1 : v < 1 ? 2 : 3);

/** 还议不了的几档:三条分段条各自画斜纹的格子(比现在那档高的),下面那一句(都没有 = 空串) */
export interface CourtLocks {
  tax: number[];
  army: number[];
  office: number[];
  note: string;
}

/**
 * 国家 p 第 year 年还议不了的几档(rules = 那一年的规矩):没有户籍议不到直征、没有常备军议不到监军和禁军、
 * 没有文官考选议不到参半和铨选(推演里的前提,gen/civ/council.ts)
 */
export function courtLocks(civ: Civ, p: number, year: Year, rules: Pick<CourtRules, 'tax' | 'army' | 'office'>): CourtLocks {
  // 查不到(没有发展度……)的不画
  const m = practicesAt(civ, p, year) ?? -1;
  const need = (x: Practice) => `要等国中有了${PRACTICES[x].name}`;
  const above = (cells: number[], on: number) => cells.filter((i) => i > on);
  const tax = hasPractice(m, Practice.Register) ? [] : above([2], rules.tax);
  const army = hasPractice(m, Practice.Army) ? [] : above([2, 3], ruleSeg(rules.army));
  const office = hasPractice(m, Practice.Exam) ? [] : above([2, 3], ruleSeg(rules.office));
  const says: string[] = [];
  if (tax.length) says.push(`直征${need(Practice.Register)}`);
  if (army.length) says.push(`${army.length > 1 ? '禁军、监军' : '禁军'}${need(Practice.Army)}`);
  if (office.length) says.push(`铨选${need(Practice.Exam)}`);
  return { tax, army, office, note: says.length ? `${says.join('；')}（斜纹的那几档现在还议不了）` : '' };
}
/** 议题(史事的 war 列;5–8 按议之前的军制、官制分两种叫法,见 issueName) */
export const ISSUE_NAMES = ['罢直征', '削藩', '直征', '改土归流', '分封边地', '收兵权', '设边镇', '行铨选', '许自辟', '分镇', '脱离', '立宪', '扩大参与', '废王立共和', '还政'] as const;

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

const LOCAL = '各州自己收税，按朝廷管得到几成往上交。';

/** 征税那条下面一句:哪年起、各州多交多少、朝廷多花多少 */
export function levySay(v: CourtView, era?: Era | null): string {
  const { tax, taxBy } = v.rules;
  if (taxBy < 0) return LOCAL;
  const Y = yearAt(v.annals[taxBy].year, era);
  if (tax === 0) return `${Y}起复由地方代收：${LOCAL}`;
  const cost = wan(v.levyCost);
  const spend = cost > 0 ? `朝廷每年多花约 ${cost} 万石` : '朝廷多派官吏到各州';
  if (tax === 1) return `${Y}起和地方分成：各州多交一截，${spend}。`;
  return `${Y}起朝廷直征：各州多交一大截，${spend}。`;
}

/** 军制、官制现在这一档是哪次议事定的(史事下标;立国以来没变过 = −1)、那次以前是哪一档 */
export function ruleSince(v: CourtView): { armyBy: number; armyFrom: number; officeBy: number; officeFrom: number } {
  const r = newRules();
  const out = { armyBy: -1, armyFrom: 0, officeBy: -1, officeFrom: 0 };
  for (const id of v.rules.events) {
    const e = v.annals[id];
    const { army, office } = r;
    applyRule(r, e.war, e.n ?? Outcome.Shelve, e.year);
    if (r.army !== army) {
      out.armyBy = id;
      out.armyFrom = army;
    }
    if (r.office !== office) {
      out.officeBy = id;
      out.officeFrom = office;
    }
  }
  return out;
}

/** 王室还是朝廷;贵族还是豪族 */
const courtWord = (civ: Civ, p: number) => (civ.polities[p]?.eastern || civ.polities[p]?.lineage === 'republic' ? '朝廷' : '王室');
const gentry = (civ: Civ, p: number) => (civ.polities[p]?.eastern ? '豪族' : '贵族');

/** 兵制那条下面一句:哪年谁定的、出兵和花钱怎样 */
export function armySay(civ: Civ, p: number, v: CourtView, era?: Era | null): string {
  const { armyBy, armyFrom } = ruleSince(v);
  const a = v.rules.army;
  if (armyBy < 0) return '立国以来由各州征发兵马，打完仗各回各州。';
  const e = v.annals[armyBy];
  const head = `${yearAt(e.year, era)}${who(civ, p, e.year, false)}`;
  if (a >= 1) return `${head}收兵权，各州兵马归${courtWord(civ, p)}禁军：出兵多一截，朝廷每年多花养兵的钱。`;
  if (a > 0) return `${head}议收兵权，地方力阻，改派监军到各州。`;
  if (a < 0) return `${head}设边镇：管不到的边州由守将自领兵马，打仗出兵多，守将容易拥兵割据。`;
  return armyFrom < 0 ? `${head}罢边镇，兵马复由各州征发，打完仗各回各州。` : `${head}罢禁军，兵马复由各州征发，打完仗各回各州。`;
}

/** 官制那条下面一句:哪年谁定的、地方官由谁任命 */
export function officeSay(civ: Civ, p: number, v: CourtView, era?: Era | null): string {
  const { officeBy, officeFrom } = ruleSince(v);
  const o = v.rules.office;
  if (officeBy < 0) return '立国以来地方官由当地荐举，朝廷只是点头。';
  const e = v.annals[officeBy];
  const head = `${yearAt(e.year, era)}${who(civ, p, e.year, false)}`;
  const g = gentry(civ, p);
  if (o >= 1) return `${head}改由${courtWord(civ, p)}任命各地官员，${g}不再把持州县。`;
  if (o > 0) return `${head}议行铨选，地方力阻，改成一半由朝廷选授、一半由地方荐举。`;
  if (o < 0) return `${head}许边州自辟官吏：朝廷省了俸禄，州县却由${g}世代把持。`;
  return officeFrom < 0 ? `${head}收回辟署之权，地方官复由当地荐举、朝廷点头。` : `${head}罢铨选，地方官复由当地荐举。`;
}

/** 收归朝廷的那几样(直征 / 和地方分成、禁军 / 派监军、铨选 / 铨选参半);short = 写成"有了……"时的短名(分成、监军) */
function centralParts(f: FormFacts, short = false): string[] {
  const out: string[] = [];
  if (f.tax >= 2) out.push('直征');
  else if (f.tax === 1) out.push(short ? '分成' : '和地方分成');
  if (f.army >= 1) out.push('禁军');
  else if (f.army > 0) out.push(short ? '监军' : '派监军');
  if (f.office >= 1) out.push('铨选');
  else if (f.office > 0) out.push('铨选参半');
  return out;
}

const CN_TENTHS = ['不到一成', '一成', '两成', '三成', '四成', '五成', '六成', '七成', '八成', '九成', '十成'];

/** 地方各自为政的那几样(分封了边地、设了边镇、许了自辟、几成的州割据) */
function feudalParts(f: FormFacts): string[] {
  const out: string[] = [];
  if (f.fief) out.push('分封了边地');
  if (f.army < 0) out.push('设了边镇');
  if (f.office < 0) out.push('许了自辟');
  const s = lordShare(f);
  if (s >= FEUDAL_SHARE) out.push(`${CN_TENTHS[Math.min(10, Math.round(s * 10))]}的州割据`);
  return out;
}

const isCentral = (n: FormName | null) => n === '集权王国' || n === '官僚帝国';
const isFeudalName = (n: FormName | null) => n === '封建王国' || n === '封建帝国';

/** 朝政页政体名下面一句:为什么叫这个 */
export function formWhy(f: FormLook): string {
  const x = f.facts;
  switch (f.name) {
    case '集权王国':
    case '官僚帝国':
      return `${centralParts(x).join('、')}：下面三样大权里，收归朝廷的够两样`;
    case '封建王国':
    case '封建帝国':
      return `${feudalParts(x).join('、')}：地方各自为政，朝廷管不太到`;
    case '王国':
    case '帝国': {
      const got = centralParts(x);
      return got.length ? `只收了${got.join('、')}，下面三样大权收归朝廷的还不够两样` : '下面三样大权都还照旧由地方办';
    }
    case '部落':
      return '还没称国，各部各有头人';
    case '部落联盟':
      return `还没称国，${x.regions} 个州各有头人，结成联盟`;
    case '城邦':
      return '一城自治，没有君主，执政任满继任';
    case '商人共和国':
      return '没有君主，执政任满继任';
    case '海上帝国':
      return '共和一系，国号升到帝国一档；没有君主，执政任满继任';
    case '汗国':
      return '游牧一系，各部听命于汗';
    case '游牧帝国':
      return '游牧一系，国号升到大汗国';
    case '诸侯割据':
      return '过半的州割据，朝廷名存实亡';
    case '军政府':
      return '将军执政，议事会散了，国事决于军中';
    case '贵族共和国':
      return '没有君主，国事由议事会议定、推举执政；只有王族贵族能进议事会';
    case '共和国': {
      const d = formDims(x);
      return `没有君主，国事由${d.council >= 3 ? '议会' : '议事会'}议定、推举执政；${FRANCHISE_SAY[d.franchise]}能进${d.council >= 3 ? '议会' : '议事会'}`;
    }
    case '立宪王国':
    case '立宪帝国':
      return `君主还在，国事经议会议定，不再独断；${FRANCHISE_SAY[formDims(x).franchise]}能进议会`;
  }
}

/** 参与那条的说法:谁能进议事会 / 议会 */
const FRANCHISE_SAY = ['只有王族贵族', '家有田产、商号的才', '男子都', '成年人都'];

/** 编年史的半角标点换成卡片上的全角 */
const fullWidth = (t: string) => t.replace(/,/g, '，').replace(/:/g, '：').replace(/;/g, '；');

/**
 * 继任、议政、参与三条下面各一句(第 year 年;form = 那一年的政体):
 * "2794 年起执政由议事会推举，任满改选，不再父子相传。""2794 年起国事由议事会议定，执政照办。""家有田产、商号的才能进议事会、推执政。"
 */
export function regimeSays(civ: Civ, p: number, year: Year, form: FormLook, era?: Era): [string, string, string] {
  const P = civ.polities[p];
  const f = form.facts;
  const d = formDims(f);
  const seg = P ? dynastyIndexAt(P, year) : 0;
  const segFrom = seg > 0 && P?.dynasties?.[seg] ? P.dynasties[seg].year : (P?.founded ?? year);
  const since = (y: Year) => (P && y > P.founded ? `${yearAt(y, era)}起` : '立国以来');
  const body = d.council >= 3 ? '议会' : '议事会';
  let succ: string;
  if (f.regime === 'junta') succ = `${yearAt(segFrom, era)}起将军拥兵执政，由军中拥立。`;
  else if (f.regime === 'republic') succ = `${f.reformed ? since(segFrom) : '立国以来'}执政由${body}推举，任满改选${f.reformed ? '，不再父子相传' : ''}。`;
  else succ = P?.dynasties?.[seg]?.house !== undefined ? `${yearAt(segFrom, era)}复辟，迎回旧王室，君位父子相传。` : '君位父子相传。';
  // 议政:设议事会、议会是哪一年(最近一次改了议政的议事、革命)
  const A = (civ.history ?? civ).annals;
  let set = -Infinity;
  for (const e of A) {
    if (e.year > year) break;
    if (e.a !== p) continue;
    if ((e.kind === 'council' && (e.war === Issue.Charter || e.war === Issue.Abolish) && (e.n === 0 || e.n === 1)) || (e.kind === 'reform' && e.n === REFORM_REVOLUTION)) set = e.year;
  }
  let delib: string;
  if (f.regime === 'junta') delib = '议事会散了，国事决于军中。';
  else if (f.regime === 'republic') delib = `${f.reformed ? since(Math.max(segFrom, set > -Infinity ? set : segFrom)) : '立国以来'}国事由${body}议定，执政照办。`;
  else if (d.council >= 3) delib = `${yearAt(set, era)}立宪，国事经议会议定，君主不复独断。`;
  else if (d.council === 2) delib = `${yearAt(set, era)}起大事先咨议事会，君权照旧。`;
  else delib = '国事由君主独断。';
  const elect = f.regime === 'crown' ? '' : '、推执政';
  const voice =
    f.regime === 'junta' ? '议事会散了，议政的只剩军中将领。' : f.regime === 'crown' && f.charter === 0 ? '议政的只有王族贵族。' : `${FRANCHISE_SAY[d.franchise]}能进${body}${elect}。`;
  return [succ, delib, voice];
}

/**
 * 历次改制一条:因为改制(立宪、废君、还政、扩大参与、革命、政变、复辟)的那一句 —— 编年史那一条,国名前文已经写了的去掉;
 * 革命、政变、复辟开头写是哪一种("革命：……"),复辟用回旧旗的写上
 */
function reformChangeSay(civ: Civ, p: number, ch: FormChange, era?: Era): string {
  const src = civ.history ?? civ;
  const e = src.annals[ch.event];
  const P = civ.polities[p];
  let t = reformText(src, ch.event);
  for (const n of P ? [polityName(P, e.year - 1 / 512), polityName(P, e.year)] : []) if (t.startsWith(n)) t = t.slice(n.length);
  const head = e.kind === 'reform' ? (['革命：', '政变：', '复辟：'][e.n ?? 0] ?? '') : e.kind === 'split' ? '革命：' : '';
  // 复辟迎回旧王室:旗用回改制那一年(这一段前面那一串共和、军政府的头一段)以前那面
  let back = '';
  const d = P?.dynasties;
  if (e.kind === 'reform' && e.n === 2 && e.b >= 0 && d) {
    let k = dynastyIndexAt(P!, e.year) - 1;
    while (k > 0 && d[k - 1].regime) k--;
    if (d[k]?.regime) back = `，旗用回${yearAt(d[k].year, era)}以前那面`;
  }
  return head + fullWidth(t.replace(/^[,;:]/, '')) + back;
}

/** 历次改制一条下面那一句:因为哪次议事、升格、割据(later = 这一条以后还改过) */
export function formChangeSay(civ: Civ, p: number, ch: FormChange, later: boolean, era?: Era): string {
  const P = civ.polities[p];
  const { from, to } = ch;
  if (ch.cause === 'found') return `${P ? polityName(P, ch.year) : ''}立国${later ? `，那时还是${to}` : ''}`;
  if (ch.cause === 'title') return `国号升格，称${P ? polityName(P, ch.year) : to}`;
  if (ch.cause === 'reform' && ch.event >= 0) return reformChangeSay(civ, p, ch, era);
  if (ch.cause === 'council' && ch.event >= 0) {
    const src = civ.history ?? civ;
    const e = src.annals[ch.event];
    const out = e.n ?? Outcome.Shelve;
    const name = issueName(e, ch.before ?? undefined);
    const head = `${who(civ, p, e.year, false)}议${name}${OUTCOME_NAMES[out] ?? ''}`;
    if (isCentral(to)) return `${head}：有了${centralParts(ch.after, true).join('、')}，三样大权收归朝廷的够了两样`;
    if (isFeudalName(to)) return `${head}：边地从此由守将、${gentry(civ, p)}自己管`;
    if (isCentral(from)) return `${head}：收归朝廷的不够两样了`;
    if (isFeudalName(from)) return `${head}：地方不再各自为政`;
    const then = thenText(civ, e, out, name);
    return then ? `${head}，${then}` : head;
  }
  // 割据、州数
  if (to === '诸侯割据') return '过半的州割据，朝廷名存实亡';
  if (from === '诸侯割据') return '割据的州不到一半了';
  if (isFeudalName(to)) return '割据的州多了，地方各自为政';
  if (isFeudalName(from)) return '割据的州不到一成半了';
  if (to === '部落联盟') return '州多了，各州头人结成联盟';
  if (to === '部落') return '州少了，不成联盟';
  return ch.cause === 'lords' ? '割据的州有增有减' : '州数有增有减';
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
    case Issue.Charter:
      return out === 0 ? '从此设议会，君主不复独断' : out === 1 ? '从此设议事会' : out === 3 ? revoltThen(civ, e) : null;
    case Issue.Abolish:
      return out === 0 ? `从此国号${civ.polities[e.a] ? polityName(civ.polities[e.a], e.year) : '某共和国'}` : out === 1 ? '从此设议事会' : out === 3 ? revoltThen(civ, e) : null;
    case Issue.Widen:
      return out === 0 ? '从此能议政的人多了一档' : null;
    case Issue.Return:
      return out === 0 ? '从此复行共和' : null;
    default:
      return null;
  }
}

/** 议立宪、废君谈崩以后起兵:打进国都 = 革命,打不进 = 据地自立 */
function revoltThen(civ: Civ, e: Annal): string | null {
  const A = (civ.history ?? civ).annals;
  const n = A[A.indexOf(e) + 1];
  if (n?.kind === 'reform' && n.n === REFORM_REVOLUTION) return `${regionLabel(civ, n.region)}起兵，革命立共和`;
  if (n?.kind === 'split' && n.cause === 'revolution') return `${regionLabel(civ, n.region)}起兵自立，号${civ.polities[n.a] ? polityName(civ.polities[n.a], n.year) : '某共和国'}`;
  return null;
}

/** 没议过事时那一块写什么(列的是会议的几类事,和 ISSUE_NAMES 对得上:征税、分封 / 改土归流、削藩、兵权、任免、分镇、脱离) */
export function courtEmpty(): string {
  return `还没议过事。国家到 ${COUNCIL_GATE.size} 个州、立国满 ${COUNCIL_GATE.age} 年,不打仗的年份里朝廷隔些年会议一件事:改征税的法子、分封或收回边地、削藩、收放兵权、收放任免、分镇、脱离。`;
}

/** 地图上圈亮时的小牌子:"关右等 31 州封地"、"崇门之野等 7 州割据" */
export function mapTagText(civ: Civ, regions: readonly number[], what: string): string {
  if (!regions.length) return '';
  return `${regionLabel(civ, regions[0])}${regions.length > 1 ? `等 ${regions.length} 州` : ''}${what}`;
}


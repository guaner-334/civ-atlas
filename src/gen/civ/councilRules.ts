/**
 * 议事定下的规矩(council.ts 议,这里记):一国的征法、分封、军制、官制怎么随一条条议事史事改,
 * 以及数表(stateTables.ts)、割据(control.ts)要用的几个常数。
 * 只依赖类型,不挂推演引擎:编年史(chronicle.ts)、割据(control.ts)读它,不会绕回推演那一圈模块(先后加载不出岔子)。
 * 纯计算,不碰 DOM。
 */
import type { Annal, Year } from './types';
import type { CouncilRuleConsts } from './stateTables';

// ---- 调参(以 20 个种子的统计为准,见 scripts/control-stats.ts) ----
/** 分封:管得到几成不到 FIEF_C 的州只交 FIEF_REMIT;"离国都远"那一项动荡乘 FIEF_FAR */
export const FIEF_C = 0.35;
export const FIEF_REMIT = 0.2;
const FIEF_FAR = 0.4;
/** 边镇(军制 −1):管得到几成不到 BORDER_C 的州全数出兵,打仗的军费乘 BORDER_ARMY(边将自筹军饷) */
export const BORDER_C = 0.35;
const BORDER_ARMY = 0.6;
/** 改组(分镇)妥协时,那处割据的地盘留几州(办成只留起事那一州) */
export const REORG_HALF = 2;
/** 变法办成:学的那样能力几年里、向邻居学快几倍(妥协年数减半;以 20 个种子的统计为准,见 scripts/reform-stats.ts) */
export const LEARN_YEARS = 60;
export const LEARN_MUL = 3;

/** 议题(Annal.war) */
export const enum Issue {
  Untax = 0,
  Cut = 1,
  Tax = 2,
  Unfief = 3,
  Fief = 4,
  /** 收兵权(改军制,集权) */
  ArmyIn = 5,
  /** 放兵权(改军制,让权):罢禁军、设边镇 */
  ArmyOut = 6,
  /** 收任免(改官制,集权) */
  OfficeIn = 7,
  /** 放任免(改官制,让权):罢铨选、许自辟 */
  OfficeOut = 8,
  /** 改组(分镇) */
  Reorg = 9,
  /** 脱离(地方提的:转投邻国,或起兵自立) */
  Leave = 10,
  /** 立宪(设议会,君主还在;妥协 = 只设议事会,不限君权。reform.ts) */
  Charter = 11,
  /** 扩大参与(能进议事会 / 议会的人多一档) */
  Widen = 12,
  /** 废君立共和(办成 = 改共和;妥协 = 只设议事会) */
  Abolish = 13,
  /** 还政(军政府交还议事会,复行共和) */
  Return = 14,
  /**
   * 变法(学邻国之长;reform.ts):b = 学的那一国,opt = 学哪一样能力(0 生产、1 运输、2 信息、3 行政)。
   * 办成 = 那样能力 LEARN_YEARS 年里向邻居学快 LEARN_MUL 倍;妥协 = 年数减半;谈崩 = 守旧的一方反扑,动荡跳一截(同集权改制的余波)
   */
  Reform = 15,
}
/** 结果(Annal.n) */
export const enum Outcome {
  Done = 0,
  Half = 1,
  Shelve = 2,
  Break = 3,
}
/** 议题有几种 */
export const ISSUES = 16;
/** 改制的几种议题(立宪、扩大参与、废君立共和、还政;reform.ts) */
export const isReformIssue = (i: number) => i >= Issue.Charter && i <= Issue.Return;

/** 政局数表里归议事管的常数(stateTables.ts) */
export const COUNCIL_CONSTS: CouncilRuleConsts = { FIEF_C, FIEF_REMIT, FIEF_FAR, BORDER_C, BORDER_ARMY };

/** 史事 council 是不是"削藩办成"(那一处割据了结;control.ts 重建割据时用) */
export function cutDone(e: Annal): boolean {
  return e.kind === 'council' && e.war === Issue.Cut && e.n === Outcome.Done;
}

/** 史事 council 是"改组办成 / 妥协"时,那一处割据的地盘从此最多几州(control.ts 重建割据时用);不是 = undefined */
export function reorgCap(e: Annal): number | undefined {
  if (e.kind !== 'council' || e.war !== Issue.Reorg) return undefined;
  return e.n === Outcome.Done ? 1 : e.n === Outcome.Half ? REORG_HALF : undefined;
}

/** 一国议定的规矩 */
export interface Rules {
  /** 征法:0 代收、1 分成、2 直征 */
  tax: number;
  /** 分封了边地(那年;没有 = undefined) */
  fief?: Year;
  /** 军制:−1 边镇、0 原样(州郡征发)、0.5 监军、1 禁军 */
  army: number;
  /** 官制:−1 自辟(豪族世守)、0 原样(荐举)、0.5 参半、1 铨选 */
  office: number;
  /** 最近一次集权的改制办成(余波从这年算) */
  shock: Year;
  /**
   * 议政(改制,reform.ts):0 君主独断、1 设了议事会(立宪妥协、废君妥协)、2 设了议会(立宪办成、革命);复辟回到 0。
   * 共和那几段至少算议事会(见 polityForm.ts 的 dims)
   */
  charter: number;
  /** 能议政的人多了几档(扩大参与、废君、革命;0 = 只有王族贵族,1 有产者、2 全体男子、3 全体成年人) */
  franchise: number;
  /** 上回改制(废君、还政办成,革命、政变、复辟)的年份;没改过 = −Infinity */
  reformed: Year;
  /** 变法办成 / 妥协:学的那样能力(没有 = −1)、学的那一国、从哪年到哪年(不含)向邻居学快 LEARN_MUL 倍 */
  learnCol: number;
  learnOf: number;
  learnFrom: Year;
  learnUntil: Year;
  /** 各议题上次议的年份、上次搁置了没有 */
  last: Year[];
  shelved: boolean[];
}

/** 没议过事的国家:原样 */
export function newRules(): Rules {
  return { tax: 0, army: 0, office: 0, shock: -Infinity, charter: 0, franchise: 0, reformed: -Infinity, learnCol: -1, learnOf: -1, learnFrom: -Infinity, learnUntil: -Infinity, last: new Array<Year>(ISSUES).fill(-Infinity), shelved: new Array<boolean>(ISSUES).fill(false) };
}

/**
 * 议了一件事以后规矩怎么变(收兵权、收任免:从让了权的 −1 收回到 0,不然办成到 1、妥协到 0.5;
 * 放兵权、放任免:收着权的(> 0)放回 0,不然办成到 −1)。
 * 改制:立宪办成设议会、妥协设议事会;扩大参与办成多一档;废君办成至少设议事会、参与照 opt(那条史事的 Annal.opt),妥协设议事会。
 * 变法:办成 / 妥协学 opt 那一样(LEARN_YEARS 年 / 一半),谈崩有余波(和集权改制一样)
 */
export function applyRule(r: Rules, issue: number, out: number, t: Year, opt?: number, b = -1): void {
  r.last[issue] = t;
  r.shelved[issue] = out === Outcome.Shelve;
  const done = out === Outcome.Done;
  const half = out === Outcome.Half;
  if (issue === Issue.Untax && done) r.tax = 0;
  else if (issue === Issue.Tax && (done || half)) {
    r.tax = done ? 2 : 1;
    r.shock = t;
  } else if (issue === Issue.Unfief && done) {
    r.fief = undefined;
    r.shock = t;
  } else if (issue === Issue.Fief && done) r.fief = t;
  else if (issue === Issue.ArmyIn && (done || half)) {
    r.army = r.army < 0 ? 0 : done ? 1 : 0.5;
    r.shock = t;
  } else if (issue === Issue.ArmyOut && done) r.army = r.army > 0 ? 0 : -1;
  else if (issue === Issue.OfficeIn && (done || half)) {
    r.office = r.office < 0 ? 0 : done ? 1 : 0.5;
    r.shock = t;
  } else if (issue === Issue.OfficeOut && done) r.office = r.office > 0 ? 0 : -1;
  else if (issue === Issue.Charter && (done || half)) r.charter = Math.max(r.charter, done ? 2 : 1);
  else if (issue === Issue.Widen && done) r.franchise = Math.min(3, r.franchise + 1);
  else if (issue === Issue.Abolish && (done || half)) {
    r.charter = Math.max(r.charter, 1);
    if (done && opt !== undefined) r.franchise = Math.max(r.franchise, opt);
    if (done) r.reformed = t;
  } else if (issue === Issue.Return && done) r.reformed = t;
  else if (issue === Issue.Reform) {
    if ((done || half) && opt !== undefined) {
      r.learnCol = opt;
      r.learnOf = b;
      r.learnFrom = t;
      r.learnUntil = t + (done ? LEARN_YEARS : LEARN_YEARS / 2);
    } else if (out === Outcome.Break) r.shock = t;
  }
}

/** 改制(史事 reform)以后规矩怎么变:革命设议会、参与照 Annal.opt;复辟回到君主独断;政变不改(议会散了看政体) */
export function applyReform(r: Rules, e: Pick<Annal, 'year' | 'n' | 'opt'>): void {
  r.reformed = e.year;
  if (e.n === REFORM_REVOLUTION) {
    r.charter = 2;
    if (e.opt !== undefined) r.franchise = Math.max(r.franchise, e.opt);
  } else if (e.n === REFORM_RESTORE) r.charter = 0;
}

/** 史事 reform 的 n:革命、政变、复辟 */
export const REFORM_REVOLUTION = 0;
export const REFORM_COUP = 1;
export const REFORM_RESTORE = 2;

/** 革命据地自立的共和国立国时:设了议会,有产者能议政 */
export const REVOLT_CHARTER = 2;
export const REVOLT_FRANCHISE = 1;

/** 这条史事改不改规矩(a 那一国的):议事、改制、革命据地自立(新国家 a 的立国) */
export function rulesAnnal(e: Annal): boolean {
  return e.kind === 'council' || e.kind === 'reform' || (e.kind === 'split' && e.cause === 'revolution');
}

/** 一条史事要不要照着改规矩(议事、改制):议事 → applyRule,改制 → applyReform,革命据地自立 → 新国家设议会;别的不管。返回改没改 */
export function replayRule(r: Rules, e: Annal): boolean {
  if (e.kind === 'council') applyRule(r, e.war, e.n ?? Outcome.Shelve, e.year, e.opt, e.b);
  else if (e.kind === 'reform') applyReform(r, e);
  else if (e.kind === 'split' && e.cause === 'revolution') {
    r.charter = REVOLT_CHARTER;
    r.franchise = Math.max(r.franchise, REVOLT_FRANCHISE);
    r.reformed = e.year;
  } else return false;
  return true;
}

/**
 * 各条议事史事议之前,那国的征法、军制、官制(编年史用:同一种议题从哪一档改起,写法不同)。
 * 返回和 annals 一样长的数组,不是议事的那几格是 undefined
 */
export function councilBefore(annals: readonly Annal[]): ({ army: number; office: number; tax: number } | undefined)[] {
  const book = new Map<number, Rules>();
  const out: ({ army: number; office: number; tax: number } | undefined)[] = new Array(annals.length);
  annals.forEach((e, i) => {
    if (!rulesAnnal(e)) return;
    let r = book.get(e.a);
    if (!r) book.set(e.a, (r = newRules()));
    if (e.kind === 'council') out[i] = { army: r.army, office: r.office, tax: r.tax };
    replayRule(r, e);
  });
  return out;
}

/** 国家 p 到 year 这一年为止的规矩(议事、改制的史事重放;史事按年份排好,year 以后的不看)。编年史读议政、参与用 */
export function rulesAt(annals: readonly Annal[], p: number, year: Year): Rules {
  const r = newRules();
  for (const e of annals) {
    if (e.year > year) break;
    if (e.a === p) replayRule(r, e);
  }
  return r;
}

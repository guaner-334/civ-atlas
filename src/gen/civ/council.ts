/**
 * 议事:朝廷想改一改规矩(怎么收税、边地归谁管、割据的地方怎么办),地方算自己要丢多少钱和权,两边讨价还价,
 * 结果有办成、妥协、搁置、谈崩四种。挂在同一个推演引擎(sim.ts)上,发生了什么记进史事 council(编年史写谁推、谁拦、为什么)。
 *
 * 流程(index.ts 在 installControl 之后调用 installCouncil):
 *
 *   **什么时候议**:看内政时(politics.ts,约 POL_EVERY 年一回)分裂、割据、合并、迁都都没出事,就议一件(councilCheck)。
 *     国家至少 MIN_SIZE 州、立国满 MIN_AGE 年、不在打仗;同一种议题 REST 年内不再议。
 *     依次看下面五种议题,第一种议得起来的就议它(一次只议一件)。
 *
 *   **掂量**:朝廷的底气 = 国都行政能力(af = min(1, 行政 ÷ ADMIN_FULL))、君主的倾向(发展、好战;rulers.ts)、国用不足(窘迫)、
 *     国库攒到几成;地方的阻力 = 要丢的钱占应缴几成(各州的税 × 多交的几成)、割据几处、动荡。
 *     一件议题的分 x = 底气 − 阻力 + 一点随机(± JITTER / 2);x 越过各档门槛就是办成 / 妥协 / 搁置,再低就谈崩。
 *     **有好处不等于能办成,办成了不等于能落实**:朝廷估直征多收多少时按行政能力高估一档(行政 + 1),
 *     实际多收的按真的行政能力算,所以行政弱的国家也会去直征,多收的抵不上开销,过些年再罢掉。
 *
 *   **五种议题**(Annal.war;结果在 Annal.n:0 办成、1 妥协、2 搁置、3 谈崩):
 *     ① UNTAX 罢直征:直征(或分成)着、多收的抵不上开销(按实际的行政能力算)、国用不足或国库不到 PURSE_LOW → 办成(复由地方代收)或搁置。
 *     ② CUT 削藩:有割据了 CUT_AGE 年以上的、国库攒到 PURSE_CUT 以上、动荡不到 CUT_U → 办成(收回那一处)、搁置、
 *        谈崩(那处割据当场起兵自立:地盘连同被它切断的碎块立新国,至少 REBEL_MIN 州,记 split,cause = warlord;不够就算搁置)。
 *     ③ TAX 直征(集权,试点议题):还没直征、按高估的行政能力算多收的扣掉开销占应缴 GAIN_MIN 以上、
 *        而且国用不足、国库不到 PURSE_TAX 或君主发展倾向到 DEV_TAX → 办成(直征)、妥协(和地方分成,征法 1)、搁置、
 *        谈崩(要丢钱最多的那州守将拒不奉诏,当场割据,control.ts 的 raise)。
 *     ④ UNFIEF 改土归流(集权):分封了 UNFIEF_AGE 年以上、af 到 AF_UNFIEF、动荡不到 UNFIEF_U、国库攒到 PURSE_UNFIEF → 办成、搁置、谈崩(那片边地割据)。
 *     ⑤ FIEF 分封边地(让权):动荡到 FIEF_U、管得到几成不到 FIEF_C 的州占 FIEF_SHARE 以上、至少 FIEF_SIZE 州 → 办成或搁置。
 *
 *   **定下来以后怎么样**(每年填进政局数表的输入,公式见 stateTables.ts):
 *     征法 0 代收(原样)、1 分成、2 直征:实收里各州管得到几成先加 LIFT[征法] × af(征升,最多到 1),岁出多 COST[征法] × 应缴(征费)。
 *     分封:管得到几成不到 FIEF_C 的州只交 FIEF_REMIT 的岁贡,"离国都远"那一项动荡乘 FIEF_FAR,新起割据的赔率减半(control.ts)。
 *     直征、分成、改土归流办成以后 SHOCK_YEARS 年里有余波:动荡多 SHOCK,随年数淡去(改制).
 *
 * **不存内存状态**:各国的征法、分封、各议题上次议的年份都由史事 council 重建(resumeCouncil)。
 * 随机数:keyed4(subSeed(seed, 'civ-council'), 国家锚, 第几次看内政, 议题),和处理顺序无关。纯计算,不碰 DOM。
 */
import type { Annal, Civ, Polity, Year } from './types';
import { keyed4, subSeed } from './rand';
import type { CivSim } from './sim';
import { polityModelOf, rulerOf, type PolityModel } from './polities';
import { politicsModelOf, type PoliticsModel } from './politics';
import { warModelOf, type WarModel } from './wars';
import { leaningsAt } from './rulers';
import { capitalAt } from './growth';
import { Cap, CAP_COUNT, devModelOf, type DevModel } from './development';
import type { ControlModel, Warlord } from './control';
import type { CouncilRuleConsts } from './stateTables';

// ---- 调参(以 20 个种子的统计为准,见 scripts/control-stats.ts) ----
/** 议得起来的国家:至少几州、立国满几年;同一种议题几年内不再议 */
const MIN_SIZE = 8;
const MIN_AGE = 60;
const REST = 100;
/** 行政能力到 ADMIN_FULL 算管得满(af = 1) */
const ADMIN_FULL = 4;
/** 征法 0 代收、1 分成、2 直征:管得到几成加 LIFT × af,岁出多 COST × 应缴 */
const LIFT = [0, 0.15, 0.35];
const COST = [0, 0.03, 0.07];
/** 交上来几成的底(和 control.ts 的 REMIT_0 一样) */
const REMIT_0 = 0.3;
/** 分封:管得到几成不到 FIEF_C 的州只交 FIEF_REMIT;"离国都远"那一项动荡乘 FIEF_FAR */
const FIEF_C = 0.35;
const FIEF_REMIT = 0.2;
const FIEF_FAR = 0.4;
/** 改制的余波:动荡多 SHOCK,SHOCK_YEARS 年淡去 */
const SHOCK = 0.15;
const SHOCK_YEARS = 30;
/** 削藩谈崩起兵自立:连同碎块至少几州(和分裂一样,不够就算搁置) */
const REBEL_MIN = 5;
/** 谈崩时起事的州要这么多年没换过国家(和分裂、割据一样) */
const SETTLE = 30;
/** 随机的那一截(x 加上 JITTER × (u − 0.5)) */
const JITTER = 0.8;

/** 罢直征:国库不到几成(或国用不足)才议;x = UNTAX_0 + UNTAX_BROKE × 窘迫 − UNTAX_DEV × (发展 − 50) / 50 */
const PURSE_LOW = 0.5;
const UNTAX_0 = 0.3;
const UNTAX_BROKE = 0.6;
const UNTAX_DEV = 0.3;
/** 削藩:割据满几年、国库攒到几成、动荡不到多少;x = CUT_0 + CUT_ADMIN × af + CUT_WAR × (好战 − 50) / 50 − CUT_U_W × 动荡 − CUT_SHARE × 地盘的税占应缴几成 */
const CUT_AGE = 30;
const PURSE_CUT = 0.4;
const CUT_U = 1;
const CUT_0 = 0.2;
const CUT_ADMIN = 0.5;
const CUT_WAR = 0.3;
const CUT_U_W = 0.5;
const CUT_SHARE = 2;
/** 削藩的门槛:办成、搁置(再低谈崩) */
const CUT_DONE = 0.2;
const CUT_SHELVE = -0.35;
/** 直征:多收的扣掉开销至少占应缴几成;国库不到几成或君主发展倾向到多少才议 */
const GAIN_MIN = 0.03;
const PURSE_TAX = 0.6;
const DEV_TAX = 75;
/** 直征的分:x = TAX_0 + TAX_ADMIN × af + TAX_DEV × (发展 − 50) / 50 + TAX_BROKE × 窘迫 − TAX_U × 动荡 − TAX_STAKE × 地方要丢的占应缴几成 − TAX_LORD × 割据几处 */
const TAX_0 = 0.2;
const TAX_ADMIN = 0.5;
const TAX_DEV = 0.3;
const TAX_BROKE = 0.3;
const TAX_U = 0.35;
const TAX_STAKE = 2;
const TAX_LORD = 0.2;
/** 直征的门槛:办成、妥协、搁置(再低谈崩) */
const TAX_DONE = 0.35;
const TAX_HALF = 0;
const TAX_SHELVE = -0.5;
/** 改土归流:分封满几年、af、动荡、国库;x = UNFIEF_0 + UNFIEF_ADMIN × af − UNFIEF_U_W × 动荡 + UNFIEF_DEV × (发展 − 50) / 50 */
const UNFIEF_AGE = 80;
const AF_UNFIEF = 0.6;
const UNFIEF_U = 0.8;
const PURSE_UNFIEF = 0.4;
const UNFIEF_0 = -0.2;
const UNFIEF_ADMIN = 0.5;
const UNFIEF_U_W = 0.4;
const UNFIEF_DEV = 0.3;
const UNFIEF_DONE = 0;
const UNFIEF_SHELVE = -0.5;
/** 分封:动荡到多少、管不到的州占几成、至少几州;x = FIEF_0 + FIEF_UW × (动荡 − FIEF_U) − FIEF_WAR × (好战 − 50) / 50 − FIEF_LOSS × 少收的占应缴几成 */
const FIEF_U = 1.1;
const FIEF_SHARE = 0.3;
const FIEF_SIZE = 12;
const FIEF_0 = 0.1;
const FIEF_UW = 0.5;
const FIEF_WAR = 0.4;
const FIEF_LOSS = 2;

/** 议题(Annal.war) */
export const enum Issue {
  Untax = 0,
  Cut = 1,
  Tax = 2,
  Unfief = 3,
  Fief = 4,
}
/** 结果(Annal.n) */
export const enum Outcome {
  Done = 0,
  Half = 1,
  Shelve = 2,
  Break = 3,
}
const ISSUES = 5;

/** 政局数表里归议事管的常数(stateTables.ts) */
export const COUNCIL_CONSTS: CouncilRuleConsts = { FIEF_C, FIEF_REMIT, FIEF_FAR };

/** 史事 council 是不是"削藩办成"(那一处割据了结;control.ts 重建割据时用) */
export function cutDone(e: Annal): boolean {
  return e.kind === 'council' && e.war === Issue.Cut && e.n === Outcome.Done;
}

/** 一国议定的规矩 */
interface Rules {
  /** 征法:0 代收、1 分成、2 直征 */
  tax: number;
  /** 分封了边地(那年;没有 = undefined) */
  fief?: Year;
  /** 最近一次集权的改制办成(余波从这年算) */
  shock: Year;
  /** 各议题上次议的年份 */
  last: Year[];
}

export interface CouncilModel {
  /** 国家 p 此刻的规矩(没议过 = 原样) */
  rules: (p: number) => { tax: number; fief: boolean };
}

const models = new WeakMap<CivSim, CouncilModel>();

/** 推演引擎上挂着的模型(测试、统计用) */
export function councilModelOf(sim: CivSim): CouncilModel | undefined {
  return models.get(sim);
}

/** 登记(installControl 之后调用) */
export function installCouncil(sim: CivSim, seed: number): CouncilModel | undefined {
  return hook(sim, seed, new Map());
}

/** 接着推(CivSim.fromCiv,在 resumeControl 之后):各国的规矩由史事重建 */
export function resumeCouncil(sim: CivSim, civ: Civ): void {
  const book = new Map<number, Rules>();
  for (const e of civ.annals) if (e.kind === 'council') apply(rulesOf(book, e.a), e.war, e.n ?? Outcome.Shelve, e.year);
  hook(sim, civ.seed, book);
}

function rulesOf(book: Map<number, Rules>, p: number): Rules {
  let r = book.get(p);
  if (!r) book.set(p, (r = { tax: 0, shock: -Infinity, last: new Array<Year>(ISSUES).fill(-Infinity) }));
  return r;
}

/** 议了一件事以后规矩怎么变 */
function apply(r: Rules, issue: number, out: number, t: Year): void {
  r.last[issue] = t;
  if (issue === Issue.Untax && out === Outcome.Done) r.tax = 0;
  else if (issue === Issue.Tax && (out === Outcome.Done || out === Outcome.Half)) {
    r.tax = out === Outcome.Done ? 2 : 1;
    r.shock = t;
  } else if (issue === Issue.Unfief && out === Outcome.Done) {
    r.fief = undefined;
    r.shock = t;
  } else if (issue === Issue.Fief && out === Outcome.Done) r.fief = t;
}

function hook(sim: CivSim, seed: number, book: Map<number, Rules>): CouncilModel | undefined {
  const pm = polityModelOf(sim);
  const pol = politicsModelOf(sim);
  const wm = warModelOf(sim);
  const cm = pol?.control;
  const dev = devModelOf(sim);
  if (!pm || !pol || !wm || !cm || !dev) return undefined;
  const base = subSeed(seed, 'civ-council');
  const { eng } = cm;

  const model: CouncilModel = {
    rules: (p) => {
      const r = book.get(p);
      return { tax: r?.tax ?? 0, fief: r?.fief !== undefined };
    },
  };
  models.set(sim, model);

  // ---- 每年填数表的输入:征升、征费、分封、改制 ----
  cm.councilFill = (t) => {
    const NP = pm.polities.length;
    const [lift, cost, fief, shock] = ['征升', '征费', '分封', '改制'].map((id) => eng.input(id).fill(0));
    if (!book.size) return;
    const admin = eng.input('国都行政');
    for (const [p, r] of book) {
      if (p >= NP || !(pm.size[p] > 0)) continue;
      lift[p] = LIFT[r.tax] * af(admin[p]);
      cost[p] = COST[r.tax];
      fief[p] = r.fief !== undefined ? 1 : 0;
      const age = t - r.shock;
      shock[p] = age < SHOCK_YEARS ? SHOCK * (1 - age / SHOCK_YEARS) : 0;
    }
  };
  cm.fiefOf = (p) => book.get(p)?.fief !== undefined;

  pol.councilCheck = (P, k, t) => check(sim, pm, pol, wm, cm, dev, base, book, P, k, t);
  return model;
}

/** 行政能力 → 管得满几成 */
function af(admin: number): number {
  return Math.min(1, Math.max(0, admin) / ADMIN_FULL);
}

function check(sim: CivSim, pm: PolityModel, pol: PoliticsModel, wm: WarModel, cm: ControlModel, dev: DevModel, base: number, book: Map<number, Rules>, P: Polity, k: number, t: number): void {
  const p = P.id;
  if (pm.size[p] < MIN_SIZE || t - P.founded < MIN_AGE) return;
  for (const w of wm.active) if (w.a === p || w.b === p) return;
  const { eng } = cm;
  const owed = eng.value('应缴', p);
  if (!(owed > 0)) return;
  const r = rulesOf(book, p);
  const ready = (i: Issue) => t - r.last[i] >= REST;
  const u = pol.unrest ? pol.unrest(P, t) : 0;
  const broke = wm.broke ? wm.broke(p, t) : 0;
  const purse = wm.purse ? wm.purse(p, t) : 1;
  const capR = pm.settlements[capitalAt(P, t)].region;
  // 国都所在州的行政能力(发展度;不读数表的输入表:接着推时它要到下一年年初才填)
  const admin = dev.cur[capR * CAP_COUNT + Cap.Administration] || 0;
  const a = af(admin);
  const ruler = leaningsAt(rulerOf(pm, p, t), t).leanings;
  const keen = (ruler.develop - 50) / 50;
  const war = (ruler.war - 50) / 50;
  const tax = eng.get('税');
  const lordsN = cm.mark(p, t);
  const fief = r.fief !== undefined;
  /** 随机的一截(每种议题各取一个) */
  const jit = (i: Issue) => JITTER * (keyed4(base, pm.ptag[p], k, i, 0) - 0.5);
  /** broke:直征是因为国用不足才议的(记 cause = broke;不然是君主锐意兴革) */
  const record = (i: Issue, out: Outcome, region: number, broke = false) => {
    apply(r, i, out, t);
    sim.record('council', { a: p, region, settlement: pm.cityOf[region], war: i, n: out, ...(broke ? { cause: 'broke' as const } : {}) });
  };

  /**
   * 征法从 from 换成 to:各州多交的(地方要丢的)之和;割据的地盘、分封了的边地不算。
   * best = 最吃亏的那一州(有城、不是国都)
   */
  let best = -1;
  const shift = (from: number, to: number, f: number): number => {
    best = -1;
    let sum = 0;
    let top = 0;
    for (const q of pm.lands[p]) {
      if (lordsN && cm.inLord(q)) continue;
      const c = cm.raw(p, q, t);
      if (fief && c < FIEF_C) continue;
      const d = tax[q] * (1 - REMIT_0) * (Math.min(1, c + LIFT[to] * f) - Math.min(1, c + LIFT[from] * f));
      sum += d;
      if (q !== capR && pm.cityOf[q] >= 0 && Math.abs(d) > top) {
        top = Math.abs(d);
        best = q;
      }
    }
    return sum;
  };

  // ① 罢直征:多收的抵不上开销
  if (r.tax > 0 && ready(Issue.Untax) && (broke > 0 || purse < PURSE_LOW)) {
    const net = shift(0, r.tax, a) - COST[r.tax] * owed;
    if (net < 0) {
      const x = UNTAX_0 + UNTAX_BROKE * broke - UNTAX_DEV * keen + jit(Issue.Untax);
      record(Issue.Untax, x > 0 ? Outcome.Done : Outcome.Shelve, capR);
      return;
    }
  }

  // ② 削藩:最老的那一处割据
  if (lordsN && ready(Issue.Cut) && purse >= PURSE_CUT && u < CUT_U) {
    let w: Warlord | undefined;
    for (const l of cm.lordsOf(p, t)) if (t - l.start >= CUT_AGE && (!w || l.start < w.start)) w = l;
    if (w) {
      const dom = cm.domainOf(w, t);
      let share = 0;
      for (const q of dom) share += tax[q];
      share /= owed;
      const x = CUT_0 + CUT_ADMIN * a + CUT_WAR * war - CUT_U_W * u - CUT_SHARE * share + jit(Issue.Cut);
      let out = x > CUT_DONE ? Outcome.Done : x > CUT_SHELVE ? Outcome.Shelve : Outcome.Break;
      // 谈崩:先记议事,再记自立;起不了兵(干预禁止分裂、地盘被切断不成片……)就算搁置
      const plan = out === Outcome.Break ? rebelPlan(pol, wm, w, dom, t) : null;
      if (out === Outcome.Break && !plan) out = Outcome.Shelve;
      if (out === Outcome.Done) w.end = t;
      record(Issue.Cut, out, w.region);
      if (plan) pol.secede!(w.p, plan.group, plan.sid, w.region, t, 'split', 'warlord');
      return;
    }
  }

  // ③ 直征
  if (r.tax < 2 && ready(Issue.Tax) && (broke > 0 || purse < PURSE_TAX || ruler.develop >= DEV_TAX)) {
    // 朝廷按行政能力高估一档来算
    const guess = shift(r.tax, 2, af(admin + 1)) - (COST[2] - COST[r.tax]) * owed;
    if (guess >= GAIN_MIN * owed) {
      const stake = shift(r.tax, 2, a) / owed;
      const foe = best;
      const x = TAX_0 + TAX_ADMIN * a + TAX_DEV * keen + TAX_BROKE * broke - TAX_U * u - TAX_STAKE * stake - TAX_LORD * lordsN + jit(Issue.Tax);
      let out = x > TAX_DONE ? Outcome.Done : x > TAX_HALF ? Outcome.Half : x > TAX_SHELVE ? Outcome.Shelve : Outcome.Break;
      // 已经分成了的,妥协就是维持现状
      if (out === Outcome.Half && r.tax >= 1) out = Outcome.Shelve;
      if (out === Outcome.Break && !canRise(wm, cm, p, foe, t)) out = Outcome.Shelve;
      record(Issue.Tax, out, foe >= 0 ? foe : capR, broke > 0 || purse < PURSE_TAX);
      if (out === Outcome.Break) cm.raise(p, foe, t);
      return;
    }
  }

  // ④ 改土归流
  if (fief && ready(Issue.Unfief) && t - r.fief! >= UNFIEF_AGE && a >= AF_UNFIEF && u < UNFIEF_U && purse >= PURSE_UNFIEF) {
    // 最大的那片边地(有城、管得最松)
    let foe = -1;
    let c0 = Infinity;
    for (const q of pm.lands[p]) {
      if (q === capR || pm.cityOf[q] < 0 || (lordsN && cm.inLord(q))) continue;
      const c = cm.raw(p, q, t);
      if (c < FIEF_C && c < c0) {
        c0 = c;
        foe = q;
      }
    }
    const x = UNFIEF_0 + UNFIEF_ADMIN * a - UNFIEF_U_W * u + UNFIEF_DEV * keen + jit(Issue.Unfief);
    let out = x > UNFIEF_DONE ? Outcome.Done : x > UNFIEF_SHELVE ? Outcome.Shelve : Outcome.Break;
    if (out === Outcome.Break && !canRise(wm, cm, p, foe, t)) out = Outcome.Shelve;
    record(Issue.Unfief, out, foe >= 0 ? foe : capR);
    if (out === Outcome.Break) cm.raise(p, foe, t);
    return;
  }

  // ⑤ 分封边地
  if (!fief && ready(Issue.Fief) && u >= FIEF_U && pm.size[p] >= FIEF_SIZE) {
    let far = 0;
    let loss = 0;
    let foe = -1;
    let d0 = -1;
    for (const q of pm.lands[p]) {
      if (lordsN && cm.inLord(q)) continue;
      const c = cm.raw(p, q, t);
      if (c >= FIEF_C) continue;
      far++;
      loss += tax[q] * (REMIT_0 + (1 - REMIT_0) * Math.min(1, c + LIFT[r.tax] * a) - FIEF_REMIT);
      const d = cm.remote(p, q, t);
      if (pm.cityOf[q] >= 0 && d > d0) {
        d0 = d;
        foe = q;
      }
    }
    if (foe >= 0 && far >= FIEF_SHARE * pm.size[p]) {
      const x = FIEF_0 + FIEF_UW * (u - FIEF_U) - FIEF_WAR * war - (FIEF_LOSS * loss) / owed + jit(Issue.Fief);
      record(Issue.Fief, x > 0 ? Outcome.Done : Outcome.Shelve, foe);
    }
  }
}

/** 谈崩时地方能不能在 r 州割据:有这州、这些年没换过国家(和分裂、割据一样要 SETTLE 年)、不是干预永久划给这国的、国家没被禁止分裂 */
function canRise(wm: WarModel, cm: ControlModel, p: number, r: number, t: number): boolean {
  return r >= 0 && t - wm.since[r] >= SETTLE && !wm.iv?.locked(r, t) && !wm.iv?.unites(p, t) && cm.canRaise(p, r, t);
}

/** 削藩谈崩:割据 w 带着地盘(连同被切断的碎块)起兵自立的州组(升序)和国都;起不了兵(起事的州或碎块里有刚换过国家的州……)= null */
function rebelPlan(pol: PoliticsModel, wm: WarModel, w: Warlord, dom: number[], t: number): { group: number[]; sid: number } | null {
  if (!pol.secede || !pol.cutOff || !pol.biggestCity || wm.iv?.unites(w.p, t)) return null;
  // 和分裂一样:SETTLE 年内换过国家的州、干预永久划给这国的州不跟着起兵
  const group = dom.filter((q) => t - wm.since[q] >= SETTLE && !wm.iv?.locked(q, t)).sort((x, y) => x - y);
  if (!group.includes(w.region)) return null;
  const sid = pol.biggestCity(group, t);
  if (sid < 0) return null;
  const full = pol.cutOff(w.p, group, t, group.length * 2 + 4);
  return full && full.length >= REBEL_MIN ? { group: full, sid } : null;
}

/** 统计(scripts、测试用):各议题、各结果的次数 */
export function councilStats(civ: Civ): { issues: number[]; outcomes: number[]; total: number } {
  const issues = new Array<number>(ISSUES).fill(0);
  const outcomes = [0, 0, 0, 0];
  let total = 0;
  for (const e of civ.annals) {
    if (e.kind !== 'council') continue;
    total++;
    issues[e.war]++;
    outcomes[e.n ?? Outcome.Shelve]++;
  }
  return { issues, outcomes, total };
}

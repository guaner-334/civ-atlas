/**
 * 议事:朝廷想改一改规矩(怎么收税、边地归谁管、兵权和官员任免归谁、割据的地方怎么办),地方算自己要丢多少钱和权,两边讨价还价,
 * 结果有办成、妥协、搁置、谈崩四种;割据久了的地方也会自己提出脱离(转投邻国)。
 * 挂在同一个推演引擎(sim.ts)上,发生了什么记进史事 council(编年史写谁推、谁拦、为什么)。
 *
 * 流程(index.ts 在 installControl 之后调用 installCouncil):
 *
 *   **什么时候议**:看内政时(politics.ts,约 POL_EVERY 年一回)分裂、割据、合并、迁都都没出事,就议一件(councilCheck)。
 *     国家至少 MIN_SIZE 州、立国满 MIN_AGE 年、不在打仗;同一种议题 REST 年内不再议(上一回搁置了的,REST_SHELVED 年内不再议)。
 *     依次看下面十一种议题(先看要省钱的、地方逼上门的,再看朝廷想收的权,最后看让权),第一种议得起来的就议它(一次只议一件)。
 *
 *   **掂量**:朝廷的底气 = 国都行政能力(af = min(1, 行政 ÷ ADMIN_FULL))、君主的倾向(发展、好战、开拓;rulers.ts;有人掌着实权 = 掌权的人的,regents.ts)、
 *     国用不足(窘迫)、国库攒到几成;地方的阻力 = 要丢的钱、兵、官位占全国几成、割据几处、动荡。
 *     一件议题的分 x = 底气 − 阻力 + 一点随机(± JITTER / 2);x 越过各档门槛就是办成 / 妥协 / 搁置,再低就谈崩。
 *     **有好处不等于能办成,办成了不等于能落实**:朝廷估直征多收多少时按行政能力高估一档(行政 + 1),
 *     实际多收的按真的行政能力算,所以行政弱的国家也会去直征,多收的抵不上开销,过些年再罢掉。
 *
 *   **时代做法**(做法表,practices.ts;国都那州此刻的能力到了发明表那一档就有,和底气同一处取,ControlModel.practices):
 *     户籍 → 直征办得成(没有时议了最多和地方分成;已经分成了的不议)、文官考选 → 才议铨选(豪族的阻力减半)、
 *     常备军 → 才议收兵权;人口普查 → 直征、分成多收一截、开销打折;国都进了火药时代 → 分封、设边镇少议(FIEF_LESS_ODDS 的机会),
 *     改土归流、罢边镇更容易;工业时代 → 分封、设边镇不议。铁路、电报改割据(control.ts)。
 *
 *   **十一种议题**(Annal.war;结果在 Annal.n:0 办成、1 妥协、2 搁置、3 谈崩):
 *     ① UNTAX 罢直征:直征(或分成)着、多收的抵不上开销(按实际的行政能力算)、国用不足或国库不到 PURSE_LOW → 办成(复由地方代收)或搁置。
 *     ② ARMY_OUT 放兵权(改军制,让权)之一,罢禁军:禁军(或监军)着、国用不足或国库不到 PURSE_LOW → 办成(复由州郡征发,军制 0)或搁置。
 *     ③ OFFICE_OUT 放任免(改官制,让权)之一,罢铨选:铨选(或参半)着、国用不足或国库不到 PURSE_LOW → 办成(复由地方荐举,官制 0)或搁置。
 *     ④ LEAVE 脱离(地方提的):割据满 LEAVE_AGE 年、地盘挨着一个肯收它的邻国(和那州同族而本国不是,或国力比本国强),
 *        不在和本国打仗、和本国没有盟约宗藩 → 朝廷留得住 = 搁置;留不住 = 办成(那处割据连同被切断的碎块转投邻国,改归属走合并,
 *        记 council 的 b = 邻国);地方强到能自立的 = 谈崩(起兵自立,和削藩谈崩一样记 split,cause = warlord)。
 *     ⑤ REORG 改组(分镇):地盘有 REORG_MIN 州以上、割据满 REORG_AGE 年的那一处,动荡不到 REORG_U →
 *        办成(地盘只留起事那一州)、妥协(只留 REORG_HALF 州)、搁置、谈崩(起兵自立,同削藩)。
 *     ⑥ CUT 削藩:有割据了 CUT_AGE 年以上的、国库攒到 PURSE_CUT 以上、动荡不到 CUT_U → 办成(收回那一处)、搁置、
 *        谈崩(那处割据当场起兵自立:地盘连同被它切断的碎块立新国,至少 REBEL_MIN 州,记 split,cause = warlord;不够就算搁置)。
 *     ⑦ ARMY_IN 收兵权(改军制,集权):军制还没到禁军、国中有了常备军(设了边镇的罢边镇不要)、国库攒到 PURSE_ARMY 以上、不缺钱,
 *        而且割据有 LORDS_ARMY 处以上(设了边镇的有一处就议)或君主好战到 WAR_ARMY →
 *        办成(禁军,军制 1;设了边镇的先罢边镇,回到 0)、妥协(监军,军制 0.5)、搁置、谈崩(边地兵最多的那州守将拥兵抗命,当场割据)。
 *     ⑧ TAX 直征(集权,试点议题):还没直征(国中没有户籍的:还没分成)、按高估的行政能力算多收的扣掉开销占应缴 GAIN_MIN 以上、
 *        而且国用不足、国库不到 PURSE_TAX 或君主发展倾向到 DEV_TAX → 办成(直征;没有户籍的只能分成)、妥协(和地方分成,征法 1)、搁置、
 *        谈崩(要丢钱最多的那州守将拒不奉诏,当场割据,control.ts 的 raise)。
 *     ⑨ OFFICE_IN 收任免(改官制,集权):官制还没到铨选、国中有了文官考选(许了自辟的收回辟署不要)、af 到 AF_OFFICE、国库攒到 PURSE_OFFICE、不缺钱,
 *        而且君主发展倾向到 DEV_OFFICE、许了自辟,或豪族把持的州(管得到几成不到 OFFICE_C)的税占应缴 OFFICE_SHARE 以上 →
 *        办成(铨选,官制 1;许了自辟的先收回,回到 0)、妥协(铨选、荐举参半,官制 0.5)、搁置、谈崩(豪族最强的那州据城抗命,当场割据)。
 *     ⑩ UNFIEF 改土归流(集权):分封了 UNFIEF_AGE 年以上、af 到 AF_UNFIEF、动荡不到 UNFIEF_U、国库攒到 PURSE_UNFIEF → 办成、搁置、谈崩(那片边地割据)。
 *     ⑪ 让权的几种(谁先议得起来议谁):
 *        ARMY_OUT 放兵权之二,设边镇:军制 0、至少 BORDER_SIZE 州、管得到几成不到 BORDER_C 的州占 BORDER_SHARE 以上、缺钱(国用不足或国库不到 PURSE_BORDER)→ 办成(军制 −1)或搁置;
 *        OFFICE_OUT 放任免之二,许自辟:官制 0、国用不足、动荡到 HERED_U、af 不到 AF_HERED → 办成(官制 −1)或搁置;
 *        FIEF 分封边地:动荡到 FIEF_U、管得到几成不到 FIEF_C 的州占 FIEF_SHARE 以上、至少 FIEF_SIZE 州 → 办成或搁置。
 *
 *   **改制**(reform.ts):③ 罢铨选之后、④ 脱离之前先看改制 —— 立宪、扩大参与、废君立共和、还政(议题 11–14,结果照上面四种),
 *     谈崩、动荡大的起兵革命;共和国的政变、新制不到五十年的复辟。出了一件就不再议别的。
 *
 *   **定下来以后怎么样**(每年填进政局数表的输入,公式见 stateTables.ts):
 *     征法 0 代收(原样)、1 分成、2 直征:实收里各州管得到几成先加 LIFT[征法] × af(征升,最多到 1),岁出多 COST[征法] × 应缴(征费);
 *       有了人口普查的,征升乘 CENSUS_LIFT、征费乘 CENSUS_COST。
 *     分封:管得到几成不到 FIEF_C 的州只交 FIEF_REMIT 的岁贡,"离国都远"那一项动荡乘 FIEF_FAR,新起割据的赔率减半(control.ts)。
 *     军制 −1 边镇、0 原样(州郡征发)、0.5 监军、1 禁军:禁军、监军各州出兵的几成多 ARMY_LIFT × 军制(兵升)、岁出多 ARMY_COST × 军制 × 应缴(兵费),
 *       新起割据的赔率乘 1 − ARMY_LORD × 军制;边镇:管得到几成不到 BORDER_C 的州全数出兵、打仗的军费乘 BORDER_ARMY,新起割据的赔率乘 BORDER_LORD。
 *     官制 −1 自辟、0 原样(荐举)、0.5 参半、1 铨选:算管得到几成时国都行政能力多 OFFICE_ADMIN × 官制(官升,只算管得到几成,不算离国都远近),
 *       岁出多 OFFICE_COST × 官制 × 应缴(官费;自辟省下这一截)。
 *     改组:那处割据的地盘最多几州(control.ts 的 Warlord.cap,由史事重建)。脱离:改归属,不改规矩。
 *     直征、分成、改土归流、收兵权、收任免办成或妥协以后 SHOCK_YEARS 年里有余波:动荡多 SHOCK,随年数淡去(改制).
 *
 * **不存内存状态**:各国的征法、分封、军制、官制、议政、参与、各议题上次议的年份都由史事 council、reform 重建(resumeCouncil)。
 * 随机数:keyed4(subSeed(seed, 'civ-council'), 国家锚, 第几次看内政, 议题),和处理顺序无关。纯计算,不碰 DOM。
 */
import { AdjKind, Layer, type Civ, type Polity, type Year } from './types';
import { flog, keyed4, subSeed } from './engine/rand';
import { type CivSim } from './engine/sim';
import { polityModelOf, rulingLeanings, type PolityModel } from './polities';
import { politicsModelOf, type PoliticsModel } from './politics';
import { warModelOf, type WarModel } from './wars';
import { capitalAt, populationAt } from './growth';
import { Cap, CAP_COUNT, devModelOf, type DevModel } from './development';
import type { ControlModel, Warlord } from './control';
import { BORDER_C, FIEF_C, FIEF_REMIT, ISSUES, Issue, Outcome, REORG_HALF, applyRule, newRules, replayRule, rulesAnnal, type Rules } from './councilRules';
import { reformCheck } from './reform';
import { CENSUS_COST, CENSUS_LIFT, EXAM_STAKE, FIEF_LESS_EASE, FIEF_LESS_ODDS, Practice, hasPractice } from './practices';
import type { CivModule } from './modules';
import { Ev } from './events';
import { warApi } from './api';

// ---- 调参(以 20 个种子的统计为准,见 scripts/control-stats.ts) ----
/** 议得起来的国家:至少几州、立国满几年;同一种议题几年内不再议(上一回搁置了的隔 REST_SHELVED 年) */
const MIN_SIZE = 8;
const MIN_AGE = 60;
const REST = 100;
const REST_SHELVED = 200;
/** 行政能力到 ADMIN_FULL 算管得满(af = 1) */
const ADMIN_FULL = 4;
/** 征法 0 代收、1 分成、2 直征:管得到几成加 LIFT × af,岁出多 COST × 应缴 */
const LIFT = [0, 0.15, 0.35];
const COST = [0, 0.03, 0.07];
/** 交上来几成的底(和 control.ts 的 REMIT_0 一样) */
const REMIT_0 = 0.3;
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

// ---- 改军制 ----
/** 禁军、监军:各州出兵的几成多 ARMY_LIFT × 军制,岁出多 ARMY_COST × 军制 × 应缴;新起割据的赔率乘 1 − ARMY_LORD × 军制 */
const ARMY_LIFT = 0.2;
const ARMY_COST = 0.05;
const ARMY_LORD = 0.3;
/** 边镇:新起割据的赔率乘 BORDER_LORD(管得到几成不到 BORDER_C 的州全数出兵、军费打折,见 councilRules.ts) */
const BORDER_LORD = 1.6;
/** 收兵权:国库攒到几成才议;割据有 LORDS_ARMY 处以上(设了边镇的有一处就议),或君主好战到 WAR_ARMY */
const PURSE_ARMY = 0.4;
const WAR_ARMY = 85;
const LORDS_ARMY = 2;
/** 收兵权的分:x = ARMYIN_0 + ARMYIN_ADMIN × af + ARMYIN_WAR × (好战 − 50) / 50 − ARMYIN_U × 动荡 − ARMYIN_STAKE × 边地(管得到几成不到 BORDER_C)的城民占几成 − ARMYIN_LORD × 割据几处 − ARMYIN_BORDER × 设了边镇 */
const ARMYIN_0 = 0.1;
const ARMYIN_ADMIN = 0.5;
const ARMYIN_WAR = 0.3;
const ARMYIN_U = 0.3;
const ARMYIN_STAKE = 0.8;
const ARMYIN_LORD = 0.1;
const ARMYIN_BORDER = 0.2;
/** 收兵权的门槛:办成、妥协、搁置(再低谈崩) */
const ARMYIN_DONE = 0.3;
const ARMYIN_HALF = -0.1;
const ARMYIN_SHELVE = -0.7;
/** 罢禁军、罢铨选:国用不足或国库不到 PURSE_SPARE 才议 */
const PURSE_SPARE = 0.25;
/** 罢禁军:x = DISBAND_0 + DISBAND_BROKE × 窘迫 − DISBAND_WAR × (好战 − 50) / 50 */
const DISBAND_0 = 0.3;
const DISBAND_BROKE = 0.6;
const DISBAND_WAR = 0.3;
/** 设边镇:至少几州、边地占几成、国库不到几成(或国用不足)才议;x = BORDER_0 + BORDER_BROKE × 窘迫 + BORDER_KEEN × (开拓、好战取大的 − 50) / 50 − BORDER_ADMIN × af */
const BORDER_SIZE = 12;
const BORDER_SHARE = 0.3;
const PURSE_BORDER = 0.5;
const BORDER_0 = 0.1;
const BORDER_BROKE = 0.4;
const BORDER_KEEN = 0.4;
const BORDER_ADMIN = 0.4;

// ---- 改官制 ----
/** 铨选、参半:算管得到几成时国都行政能力多 OFFICE_ADMIN × 官制,岁出多 OFFICE_COST × 官制 × 应缴(自辟 = −1:少管一档、省一截) */
const OFFICE_ADMIN = 1;
const OFFICE_COST = 0.04;
/** 收任免:af、国库攒到几成才议;君主发展倾向到 DEV_OFFICE,或豪族把持的州(管得到几成不到 OFFICE_C)的税占应缴 OFFICE_SHARE 以上 */
const AF_OFFICE = 0.4;
const PURSE_OFFICE = 0.3;
const DEV_OFFICE = 75;
const OFFICE_C = 0.6;
const OFFICE_SHARE = 0.5;
/** 收任免的分:x = OFFICEIN_0 + OFFICEIN_ADMIN × af + OFFICEIN_DEV × (发展 − 50) / 50 − OFFICEIN_U × 动荡 − OFFICEIN_STAKE × 豪族把持的州的税占几成 − OFFICEIN_LORD × 割据几处 − OFFICEIN_HERED × 许了自辟 */
const OFFICEIN_0 = 0.3;
const OFFICEIN_ADMIN = 0.5;
const OFFICEIN_DEV = 0.3;
const OFFICEIN_U = 0.3;
const OFFICEIN_STAKE = 0.8;
const OFFICEIN_LORD = 0.1;
const OFFICEIN_HERED = 0.3;
/** 收任免的门槛:办成、妥协、搁置(再低谈崩) */
const OFFICEIN_DONE = 0.25;
const OFFICEIN_HALF = -0.15;
const OFFICEIN_SHELVE = -0.8;
/** 罢铨选:x = UNOFFICE_0 + UNOFFICE_BROKE × 窘迫 − UNOFFICE_DEV × (发展 − 50) / 50 */
const UNOFFICE_0 = 0.3;
const UNOFFICE_BROKE = 0.6;
const UNOFFICE_DEV = 0.3;
/** 许自辟:动荡到多少、af 不到多少才议;x = HERED_0 + HERED_UW × (动荡 − HERED_U) + HERED_BROKE × 窘迫 − HERED_DEV × (发展 − 50) / 50 */
const HERED_U = 1;
const AF_HERED = 0.5;
const HERED_0 = -0.1;
const HERED_UW = 0.5;
const HERED_BROKE = 0.4;
const HERED_DEV = 0.3;

// ---- 改组(分镇)----
/** 地盘至少几州、割据满几年、动荡不到多少才议(妥协时地盘留几州见 councilRules.ts 的 REORG_HALF) */
const REORG_MIN = 3;
const REORG_AGE = 20;
const REORG_U = 1.2;
/** x = REORG_0 + REORG_ADMIN × af + REORG_WAR × (好战 − 50) / 50 − REORG_U_W × 动荡 − REORG_SHARE × 地盘的税占应缴几成 */
const REORG_0 = 0.2;
const REORG_ADMIN = 0.5;
const REORG_WAR = 0.2;
const REORG_U_W = 0.4;
const REORG_SHARE = 1.5;
/** 门槛:办成、妥协、搁置(再低谈崩) */
const REORG_DONE = 0.2;
const REORG_HALF_X = -0.1;
const REORG_SHELVE = -0.8;

// ---- 脱离 ----
/** 割据满几年才提;肯收它的邻国至少几州 */
const LEAVE_AGE = 30;
const LEAVE_Q_MIN = 5;
/** 朝廷留不留得住:x = LEAVE_0 + LEAVE_ADMIN × af + LEAVE_PURSE × 国库几成 − LEAVE_U × 动荡 − LEAVE_SHARE × 地盘的税占应缴几成 − LEAVE_KIN × 同族 − LEAVE_POW × ln(邻国国力 ÷ 本国国力)(不到 0 按 0) */
const LEAVE_0 = 0.3;
const LEAVE_ADMIN = 0.4;
const LEAVE_PURSE = 0.3;
const LEAVE_U = 0.4;
const LEAVE_SHARE = 2;
const LEAVE_KIN = 0.3;
const LEAVE_POW = 0.2;
/** 门槛:留得住(搁置);留不住转投(办成);再低起兵自立(谈崩) */
const LEAVE_KEEP = 0;
const LEAVE_BREAK = -0.9;

// 议题、结果的编号,定下的规矩怎么随史事改(Rules、applyRule),分封、边镇、分镇的几个常数在 councilRules.ts
export { COUNCIL_CONSTS, cutDone, reorgCap, councilBefore } from './councilRules';

export interface CouncilModel {
  /** 国家 p 此刻的规矩(没议过 = 原样) */
  rules: (p: number) => { tax: number; fief: boolean; army: number; office: number };
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

/** 接着推(resumeCiv,在 resumeControl 之后):各国的规矩由史事重建 */
export function resumeCouncil(sim: CivSim, civ: Civ): void {
  const book = new Map<number, Rules>();
  for (const e of civ.annals) if (rulesAnnal(e)) replayRule(rulesOf(book, e.a), e);
  hook(sim, civ.seed, book);
}

function rulesOf(book: Map<number, Rules>, p: number): Rules {
  let r = book.get(p);
  if (!r) book.set(p, (r = newRules()));
  return r;
}

/** 议得起来的国家:至少几州、立国满几年;割据满几年才议削藩(界面上说明用) */
export const COUNCIL_GATE = { size: MIN_SIZE, age: MIN_AGE, cutAge: CUT_AGE } as const;

/** 国家 p 在 year 这一年够不够格议事(州数 n;不看打不打仗) */
export function councilAble(P: Pick<Polity, 'founded'>, n: number, year: Year): boolean {
  return n >= MIN_SIZE && year - P.founded >= MIN_AGE;
}

/** 一国到某一年为止议定的规矩(界面用,只读) */
export interface CourtRules {
  /** 征法:0 代收、1 分成、2 直征 */
  tax: number;
  /** 定下现在这个征法的那次议事(史事下标;立国以来一直代收 = −1)、那次以前的征法 */
  taxBy: number;
  taxFrom: number;
  /** 现在分封着边地:分封的那次议事(史事下标;没分封 = −1) */
  fiefBy: number;
  /** 军制(−1 边镇、0 原样、0.5 监军、1 禁军)、官制(−1 自辟、0 原样、0.5 参半、1 铨选) */
  army: number;
  office: number;
  /** 这一国到那一年为止议过的事(史事下标,按先后) */
  events: number[];
  /** 议政:0 君主独断、1 设了议事会、2 设了议会;能议政的人多了几档(见 councilRules.ts 的 Rules) */
  charter: number;
  franchise: number;
}

/**
 * 国家 p 到 year 这一年为止的规矩:由史事 council 重建(和接着推时 resumeCouncil 同一个算法),不改历史。
 * 史事按年份排好,year 以后的不看
 */
export function courtRulesAt(civ: Pick<Civ, 'annals'>, p: number, year: Year): CourtRules {
  const r = newRules();
  const out: CourtRules = { tax: 0, taxBy: -1, taxFrom: 0, fiefBy: -1, army: 0, office: 0, events: [], charter: 0, franchise: 0 };
  const A = civ.annals;
  for (let i = 0; i < A.length; i++) {
    const e = A[i];
    if (e.year > year) break;
    if (!rulesAnnal(e) || e.a !== p) continue;
    if (e.kind !== 'council') {
      replayRule(r, e);
      continue;
    }
    const tax = r.tax;
    const fief = r.fief;
    applyRule(r, e.war, e.n ?? Outcome.Shelve, e.year, e.opt);
    out.events.push(i);
    if (r.tax !== tax) {
      out.taxBy = i;
      out.taxFrom = tax;
    }
    if (r.fief !== fief) out.fiefBy = r.fief === undefined ? -1 : i;
  }
  out.tax = r.tax;
  out.army = r.army;
  out.office = r.office;
  out.charter = r.charter;
  out.franchise = r.franchise;
  return out;
}

function hook(sim: CivSim, seed: number, book: Map<number, Rules>): CouncilModel | undefined {
  const pm = polityModelOf(sim);
  const pol = politicsModelOf(sim);
  const wm = warModelOf(sim);
  const cm = pol?.control;
  const dev = devModelOf(sim);
  if (!pm || !pol || !wm || !cm || !dev) return undefined;
  const base = subSeed(seed, 'civ-council');
  const rbase = subSeed(seed, 'civ-reform');
  const { eng } = cm;

  const model: CouncilModel = {
    rules: (p) => {
      const r = book.get(p);
      return { tax: r?.tax ?? 0, fief: r?.fief !== undefined, army: r?.army ?? 0, office: r?.office ?? 0 };
    },
  };
  models.set(sim, model);

  // ---- 每年填数表的输入:征升、征费、分封、改制;兵升、兵费、边镇;官升、官费 ----
  cm.councilFill = (t) => {
    const NP = pm.polities.length;
    const [lift, cost, fief, shock, armyLift, armyCost, border, officeLift, officeCost] = ['征升', '征费', '分封', '改制', '兵升', '兵费', '边镇', '官升', '官费'].map((id) =>
      eng.input(id).fill(0),
    );
    if (!book.size) return;
    const admin = eng.input('国都行政');
    for (const [p, r] of book) {
      if (p >= NP || !(pm.size[p] > 0)) continue;
      // 有了人口普查(做法表):多收一截、开销打折
      const census = r.tax > 0 && hasPractice(cm.practices(p, t), Practice.Census);
      lift[p] = LIFT[r.tax] * af(admin[p]) * (census ? CENSUS_LIFT : 1);
      cost[p] = COST[r.tax] * (census ? CENSUS_COST : 1);
      fief[p] = r.fief !== undefined ? 1 : 0;
      const age = t - r.shock;
      shock[p] = age < SHOCK_YEARS ? SHOCK * (1 - age / SHOCK_YEARS) : 0;
      armyLift[p] = ARMY_LIFT * Math.max(0, r.army);
      armyCost[p] = ARMY_COST * Math.max(0, r.army);
      border[p] = r.army < 0 ? 1 : 0;
      officeLift[p] = OFFICE_ADMIN * r.office;
      officeCost[p] = OFFICE_COST * r.office;
    }
  };
  cm.fiefOf = (p) => book.get(p)?.fief !== undefined;
  // 新起割据的赔率:边镇多、禁军少(分封的那一半 control.ts 自己乘)
  cm.lordOdds = (p) => {
    const a = book.get(p)?.army ?? 0;
    return a < 0 ? BORDER_LORD : 1 - ARMY_LORD * a;
  };

  pol.councilCheck = (P, k, t) => check(sim, pm, pol, wm, cm, dev, base, rbase, book, P, k, t);
  return model;
}

/** 行政能力 → 管得满几成 */
function af(admin: number): number {
  return Math.min(1, Math.max(0, admin) / ADMIN_FULL);
}

function check(sim: CivSim, pm: PolityModel, pol: PoliticsModel, wm: WarModel, cm: ControlModel, dev: DevModel, base: number, rbase: number, book: Map<number, Rules>, P: Polity, k: number, t: number): void {
  const api = warApi(sim);
  const p = P.id;
  if (pm.size[p] < MIN_SIZE || t - P.founded < MIN_AGE) return;
  for (const w of wm.active) if (w.a === p || w.b === p) return;
  const { eng } = cm;
  const owed = eng.value('应缴', p);
  if (!(owed > 0)) return;
  const r = rulesOf(book, p);
  const ready = (i: Issue) => t - r.last[i] >= (r.shelved[i] ? REST_SHELVED : REST);
  const u = pol.unrest ? pol.unrest(P, t) : 0;
  const broke = api.broke ? api.broke(p, t) : 0;
  const purse = api.purse ? api.purse(p, t) : 1;
  const capR = pm.settlements[capitalAt(P, t)].region;
  // 国都所在州的行政能力(发展度;不读数表的输入表:接着推时它要到下一年年初才填)
  const admin = dev.cur[capR * CAP_COUNT + Cap.Administration] || 0;
  const a = af(admin);
  // 说了算的人的倾向:在位的君主,有人掌着实权就是掌权的人(regents.ts)
  const ruler = rulingLeanings(pm, p, t);
  const keen = (ruler.develop - 50) / 50;
  const war = (ruler.war - 50) / 50;
  const tax = eng.get('税');
  const owner = sim.owners[Layer.Polity];
  const culture = sim.owners[Layer.Culture];
  const reg = pm.terrain.regions;
  let lordsN = cm.mark(p, t);
  /** domainOf 换了地盘的标记:往下看 inLord 之前重新标一遍 */
  const remark = () => {
    if (lordsN) lordsN = cm.mark(p, t);
  };
  const fief = r.fief !== undefined;
  // 这国有了哪几样做法(做法表,practices.ts;国都那州此刻的能力)
  const pr = cm.practices(p, t);
  const has = (x: Practice) => hasPractice(pr, x);
  const liftK = has(Practice.Census) ? CENSUS_LIFT : 1;
  const costK = has(Practice.Census) ? CENSUS_COST : 1;
  /** 随机的一截(每种议题各取一个) */
  const jit = (i: Issue) => JITTER * (keyed4(base, pm.ptag[p], k, i, 0) - 0.5);
  /** broke:直征是因为国用不足才议的(记 cause = broke;不然是君主锐意兴革);b:脱离时想转投的邻国;opt:废君办成以后能议政的有几档 */
  const record = (i: Issue, out: Outcome, region: number, broke = false, b = -1, opt?: number) => {
    applyRule(r, i, out, t, opt);
    sim.record('council', { a: p, ...(b >= 0 ? { b } : {}), region, settlement: pm.cityOf[region], war: i, n: out, ...(broke ? { cause: 'broke' as const } : {}), ...(opt !== undefined ? { opt } : {}) });
  };
  /** 边地(管得到几成不到 BORDER_C;国都、割据的地盘不算):几州、城民占全国几成、城民最多的那州(有城;没有 = −1) */
  const borderland = () => {
    let n = 0;
    let pop = 0;
    let all = 0;
    let top = -1;
    let best = 0;
    for (const q of pm.lands[p]) {
      const s = pm.cityOf[q];
      const h = s >= 0 ? populationAt(pm.settlements[s], t) : 0;
      all += h;
      if (q === capR || (lordsN && cm.inLord(q)) || cm.raw(p, q, t) >= BORDER_C) continue;
      n++;
      pop += h;
      if (s >= 0 && h > best) {
        best = h;
        top = q;
      }
    }
    return { n, share: all > 0 ? pop / all : 0, top };
  };
  /** 豪族把持的州(管得到几成不到 OFFICE_C;国都、割据的地盘、分封了的边地不算):税占应缴几成、税最多的那州(有城;没有 = −1) */
  const gentry = () => {
    let sum = 0;
    let top = -1;
    let best = 0;
    for (const q of pm.lands[p]) {
      if (q === capR || (lordsN && cm.inLord(q))) continue;
      const c = cm.raw(p, q, t);
      if (c >= OFFICE_C || (fief && c < FIEF_C)) continue;
      sum += tax[q];
      if (pm.cityOf[q] >= 0 && tax[q] > best) {
        best = tax[q];
        top = q;
      }
    }
    return { share: sum / owed, top };
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
      const d = tax[q] * (1 - REMIT_0) * (Math.min(1, c + LIFT[to] * f * liftK) - Math.min(1, c + LIFT[from] * f * liftK));
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
    const net = shift(0, r.tax, a) - COST[r.tax] * costK * owed;
    if (net < 0) {
      const x = UNTAX_0 + UNTAX_BROKE * broke - UNTAX_DEV * keen + jit(Issue.Untax);
      record(Issue.Untax, x > 0 ? Outcome.Done : Outcome.Shelve, capR);
      return;
    }
  }

  // ② 罢禁军、③ 罢铨选:缺钱时先省下收权的开销
  if (r.army > 0 && ready(Issue.ArmyOut) && (broke > 0 || purse < PURSE_SPARE)) {
    const x = DISBAND_0 + DISBAND_BROKE * broke - DISBAND_WAR * war + jit(Issue.ArmyOut);
    record(Issue.ArmyOut, x > 0 ? Outcome.Done : Outcome.Shelve, capR);
    return;
  }
  if (r.office > 0 && ready(Issue.OfficeOut) && (broke > 0 || purse < PURSE_SPARE)) {
    const x = UNOFFICE_0 + UNOFFICE_BROKE * broke - UNOFFICE_DEV * keen + jit(Issue.OfficeOut);
    record(Issue.OfficeOut, x > 0 ? Outcome.Done : Outcome.Shelve, capR);
    return;
  }

  // 改制(reform.ts):立宪、扩大参与、废君立共和(谈崩起兵革命)、政变、复辟、还政;出了一件就不再议别的
  if (reformCheck({ sim, pm, pol, wm, cm, base: rbase, P, k, t, rules: r, rulesOf: (q) => rulesOf(book, q), u, broke, capR, ready, record: (i, out, region, opt) => record(i, out, region, false, -1, opt) })) return;

  // ④ 脱离:割据久了的地方要转投邻国(肯收它的:和那州同族而本国不是,或国力比本国强)
  if (lordsN && ready(Issue.Leave) && !wm.iv?.unites(p, t)) {
    const powP = api.power ? api.power(p) : -1;
    let pick: { w: Warlord; dom: number[]; q: number; pull: number } | null = null;
    for (const w of cm.lordsOf(p, t)) {
      if (t - w.start < LEAVE_AGE) continue;
      const dom = cm.domainOf(w, t);
      const cu = culture[w.region];
      for (const x of dom) {
        for (let e = reg.adjStart[x]; e < reg.adjStart[x + 1]; e++) {
          const kind = reg.adjKind[e];
          if (kind === AdjKind.Strait || kind === AdjKind.SeaRoute) continue;
          const o = owner[reg.adj[e]];
          if (o < 0 || o === p || pm.size[o] < LEAVE_Q_MIN || pm.polities[o].ended !== undefined) continue;
          const kin = pm.polities[o].culture === cu && P.culture !== cu ? 1 : 0;
          const powQ = api.power ? api.power(o) : -1;
          const ratio = powP > 0 && powQ > 0 ? powQ / powP : 0;
          if (!kin && !(ratio > 1)) continue;
          if (wm.dm?.friendly(p, o) || wm.iv?.allied(p, o, t) || wm.iv?.halted(o, t)) continue;
          const pull = LEAVE_KIN * kin + (ratio > 1 ? LEAVE_POW * flog(ratio) : 0);
          if (!pick || pull > pick.pull) pick = { w, dom, q: o, pull };
        }
      }
    }
    if (pick) {
      const { w, dom, q } = pick;
      let share = 0;
      for (const x of dom) share += tax[x];
      share /= owed;
      const x = LEAVE_0 + LEAVE_ADMIN * a + LEAVE_PURSE * purse - LEAVE_U * u - LEAVE_SHARE * share - pick.pull + jit(Issue.Leave);
      let out = x > LEAVE_KEEP ? Outcome.Shelve : x > LEAVE_BREAK ? Outcome.Done : Outcome.Break;
      // 强到能自立的起兵自立;自立不成(地盘不够 REBEL_MIN 州……)就转投;转投也不成(地盘里刚换过国家……)就算搁置
      const plan = out === Outcome.Break ? rebelPlan(pol, wm, w, dom, t) : null;
      if (out === Outcome.Break && !plan) out = Outcome.Done;
      const move = out === Outcome.Done ? leaveGroup(pol, wm, reg, owner, w, dom, q, t) : null;
      if (out === Outcome.Done && !move) out = Outcome.Shelve;
      record(Issue.Leave, out, w.region, false, q);
      if (plan) pol.secede!(w.p, plan.group, plan.sid, w.region, t, 'split', 'warlord');
      if (move) for (const x of move) sim.setOwner(Layer.Polity, x, q, Ev.Merge);
      return;
    }
    remark();
  }

  // ⑤ 改组(分镇):地盘最大的那一处割据
  if (lordsN && ready(Issue.Reorg) && u < REORG_U) {
    let w: Warlord | undefined;
    let dom: number[] = [];
    for (const l of cm.lordsOf(p, t)) {
      if (t - l.start < REORG_AGE) continue;
      const d = cm.domainOf(l, t);
      if (d.length >= REORG_MIN && d.length > dom.length) {
        w = l;
        dom = d;
      }
    }
    if (w) {
      let share = 0;
      for (const x of dom) share += tax[x];
      share /= owed;
      const x = REORG_0 + REORG_ADMIN * a + REORG_WAR * war - REORG_U_W * u - REORG_SHARE * share + jit(Issue.Reorg);
      let out = x > REORG_DONE ? Outcome.Done : x > REORG_HALF_X ? Outcome.Half : x > REORG_SHELVE ? Outcome.Shelve : Outcome.Break;
      const plan = out === Outcome.Break ? rebelPlan(pol, wm, w, dom, t) : null;
      if (out === Outcome.Break && !plan) out = Outcome.Shelve;
      if (out === Outcome.Done) w.cap = 1;
      else if (out === Outcome.Half) w.cap = REORG_HALF;
      record(Issue.Reorg, out, w.region);
      if (plan) pol.secede!(w.p, plan.group, plan.sid, w.region, t, 'split', 'warlord');
      return;
    }
    remark();
  }

  // ⑥ 削藩:最老的那一处割据
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

  // ⑦ 收兵权:割据多了(设了边镇的有一处就议),或君主好战。国中有了常备军才议(设了边镇的罢边镇不要它;火药以后罢边镇更容易)
  if (r.army < 1 && (r.army < 0 || has(Practice.Army)) && ready(Issue.ArmyIn) && purse >= PURSE_ARMY && !(broke > 0) && (lordsN >= (r.army < 0 ? 1 : LORDS_ARMY) || ruler.war >= WAR_ARMY)) {
    const b = borderland();
    const border = r.army < 0 ? (has(Practice.FiefLess) ? -FIEF_LESS_EASE : ARMYIN_BORDER) : 0;
    const x = ARMYIN_0 + ARMYIN_ADMIN * a + ARMYIN_WAR * war - ARMYIN_U * u - ARMYIN_STAKE * b.share - ARMYIN_LORD * lordsN - border + jit(Issue.ArmyIn);
    let out = x > ARMYIN_DONE ? Outcome.Done : x > ARMYIN_HALF ? Outcome.Half : x > ARMYIN_SHELVE ? Outcome.Shelve : Outcome.Break;
    // 已经监军了的、设了边镇的,妥协就是维持现状
    if (out === Outcome.Half && r.army !== 0) out = Outcome.Shelve;
    if (out === Outcome.Break && !canRise(wm, cm, p, b.top, t)) out = Outcome.Shelve;
    record(Issue.ArmyIn, out, b.top >= 0 ? b.top : capR);
    if (out === Outcome.Break) cm.raise(p, b.top, t);
    return;
  }

  // ⑧ 直征(国中还没有户籍的:议了最多和地方分成;已经分成了的就不议)
  const register = has(Practice.Register);
  if (r.tax < (register ? 2 : 1) && ready(Issue.Tax) && (broke > 0 || purse < PURSE_TAX || ruler.develop >= DEV_TAX)) {
    // 朝廷按行政能力高估一档来算
    const guess = shift(r.tax, 2, af(admin + 1)) - (COST[2] - COST[r.tax]) * costK * owed;
    if (guess >= GAIN_MIN * owed) {
      const stake = shift(r.tax, 2, a) / owed;
      const foe = best;
      const x = TAX_0 + TAX_ADMIN * a + TAX_DEV * keen + TAX_BROKE * broke - TAX_U * u - TAX_STAKE * stake - TAX_LORD * lordsN + jit(Issue.Tax);
      let out = x > TAX_DONE ? Outcome.Done : x > TAX_HALF ? Outcome.Half : x > TAX_SHELVE ? Outcome.Shelve : Outcome.Break;
      // 没有户籍:办成了也只能分成;已经分成了的,妥协就是维持现状
      if (out === Outcome.Done && !register) out = Outcome.Half;
      if (out === Outcome.Half && r.tax >= 1) out = Outcome.Shelve;
      if (out === Outcome.Break && !canRise(wm, cm, p, foe, t)) out = Outcome.Shelve;
      record(Issue.Tax, out, foe >= 0 ? foe : capR, broke > 0 || purse < PURSE_TAX);
      if (out === Outcome.Break) cm.raise(p, foe, t);
      return;
    }
  }

  // ⑨ 收任免:君主重发展、许了自辟,或豪族把持的州多。国中有了文官考选才议铨选(许了自辟的收回辟署不要它),有了以后豪族的阻力减半
  if (r.office < 1 && (r.office < 0 || has(Practice.Exam)) && ready(Issue.OfficeIn) && a >= AF_OFFICE && purse >= PURSE_OFFICE && !(broke > 0)) {
    const g = gentry();
    if (ruler.develop >= DEV_OFFICE || r.office < 0 || g.share >= OFFICE_SHARE) {
      const stake = OFFICEIN_STAKE * (has(Practice.Exam) ? EXAM_STAKE : 1);
      const x = OFFICEIN_0 + OFFICEIN_ADMIN * a + OFFICEIN_DEV * keen - OFFICEIN_U * u - stake * g.share - OFFICEIN_LORD * lordsN - (r.office < 0 ? OFFICEIN_HERED : 0) + jit(Issue.OfficeIn);
      let out = x > OFFICEIN_DONE ? Outcome.Done : x > OFFICEIN_HALF ? Outcome.Half : x > OFFICEIN_SHELVE ? Outcome.Shelve : Outcome.Break;
      if (out === Outcome.Half && r.office !== 0) out = Outcome.Shelve;
      if (out === Outcome.Break && !canRise(wm, cm, p, g.top, t)) out = Outcome.Shelve;
      record(Issue.OfficeIn, out, g.top >= 0 ? g.top : capR);
      if (out === Outcome.Break) cm.raise(p, g.top, t);
      return;
    }
  }

  // ⑩ 改土归流
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
    // 火药以后(分封渐废)改土归流更容易
    const x = UNFIEF_0 + UNFIEF_ADMIN * a - UNFIEF_U_W * u + UNFIEF_DEV * keen + (has(Practice.FiefLess) ? FIEF_LESS_EASE : 0) + jit(Issue.Unfief);
    let out = x > UNFIEF_DONE ? Outcome.Done : x > UNFIEF_SHELVE ? Outcome.Shelve : Outcome.Break;
    if (out === Outcome.Break && !canRise(wm, cm, p, foe, t)) out = Outcome.Shelve;
    record(Issue.Unfief, out, foe >= 0 ? foe : capR);
    if (out === Outcome.Break) cm.raise(p, foe, t);
    return;
  }

  // ⑪ 让权:设边镇(缺钱、边地多,君主想开拓或好战时更肯)。分封、设边镇火药以后少议(FIEF_LESS_ODDS 的机会),工业以后不议
  const lateOk = (i: Issue) => !has(Practice.FiefNone) && (!has(Practice.FiefLess) || keyed4(base, pm.ptag[p], k, i, 1) < FIEF_LESS_ODDS);
  if (r.army === 0 && ready(Issue.ArmyOut) && pm.size[p] >= BORDER_SIZE && (broke > 0 || purse < PURSE_BORDER) && lateOk(Issue.ArmyOut)) {
    const b = borderland();
    if (b.top >= 0 && b.n >= BORDER_SHARE * pm.size[p]) {
      const keenB = (Math.max(ruler.expand, ruler.war) - 50) / 50;
      const x = BORDER_0 + BORDER_BROKE * broke + BORDER_KEEN * keenB - BORDER_ADMIN * a + jit(Issue.ArmyOut);
      record(Issue.ArmyOut, x > 0 ? Outcome.Done : Outcome.Shelve, b.top);
      return;
    }
  }
  // 许自辟(国用不足、动荡大、朝廷行政弱)
  if (r.office === 0 && ready(Issue.OfficeOut) && broke > 0 && u >= HERED_U && a < AF_HERED) {
    const g = gentry();
    const x = HERED_0 + HERED_UW * (u - HERED_U) + HERED_BROKE * broke - HERED_DEV * keen + jit(Issue.OfficeOut);
    record(Issue.OfficeOut, x > 0 ? Outcome.Done : Outcome.Shelve, g.top >= 0 ? g.top : capR);
    return;
  }
  // 分封边地
  if (!fief && ready(Issue.Fief) && u >= FIEF_U && pm.size[p] >= FIEF_SIZE && lateOk(Issue.Fief)) {
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

/**
 * 脱离转投:割据 w 的地盘(SETTLE 年内换过国家的、干预永久划给这国的州不跟着走)连同被切断的碎块(升序);
 * 走不成(起事的州不在里面、碎块里有刚换过国家的州、剩下的州已经不挨着邻国 q)= null
 */
function leaveGroup(pol: PoliticsModel, wm: WarModel, reg: PolityModel['terrain']['regions'], owner: ArrayLike<number>, w: Warlord, dom: number[], q: number, t: number): number[] | null {
  if (!pol.cutOff) return null;
  const group = dom.filter((x) => t - wm.since[x] >= SETTLE && !wm.iv?.locked(x, t)).sort((x, y) => x - y);
  if (!group.includes(w.region)) return null;
  let touches = false;
  for (const x of group) {
    for (let e = reg.adjStart[x]; e < reg.adjStart[x + 1] && !touches; e++) {
      const kind = reg.adjKind[e];
      if (kind !== AdjKind.Strait && kind !== AdjKind.SeaRoute && owner[reg.adj[e]] === q) touches = true;
    }
  }
  return touches ? pol.cutOff(w.p, group, t, group.length * 2 + 4) : null;
}

/** 统计(scripts、测试用):各议题、各结果的次数 */
export function councilStats(civ: Civ): { issues: number[]; outcomes: number[]; total: number; byIssue: number[][] } {
  const issues = new Array<number>(ISSUES).fill(0);
  const outcomes = [0, 0, 0, 0];
  /** 议题 × 结果 */
  const byIssue = issues.map(() => [0, 0, 0, 0]);
  let total = 0;
  for (const e of civ.annals) {
    if (e.kind !== 'council') continue;
    total++;
    issues[e.war]++;
    outcomes[e.n ?? Outcome.Shelve]++;
    byIssue[e.war][e.n ?? Outcome.Shelve]++;
  }
  return { issues, outcomes, total, byIssue };
}

/** 模块:议事:直征、分封、削藩(清单和次序见 modules.ts) */
export const councilModule: CivModule = {
  id: 'council',
  install: (c) => {
    if (c.pm) installCouncil(c.sim, c.seed);
  },
  resume: (c) => resumeCouncil(c.sim, c.civ),
};

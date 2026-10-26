/**
 * 君主的在位表和倾向:推演(polities.ts 的扩张算账、wars.ts 的议和、diplomacy.ts 的称臣)和人物(people.ts)用同一份,
 * 推演里"哪一位在位、他的倾向是多少"和人物页上写的一字不差。
 *
 * **在位表**:每个国家从立国起一朝接一朝(Polity.dynasties;没改朝换代过 = 立国那一朝),每一朝里一位接一位:
 *   即位的年纪、在位多少年按"国家的位置锚 + 第几位"随机取(keyed4),一生不超过 MAX_AGE 岁;共和国的执政官任期短。
 *   宗室争位、据地自立的国家(Polity.prince),开国之君就是起兵的那位宗室:即位的年纪按他的生年算。
 *   一位在位到"不被打断时的年份"(natural),这一朝先结束(改朝换代)就在那一刻让位给新朝的第一位。
 *   第几位(k)按全国从 0 编起、跨朝连续 —— 和 people.ts 排人物的编号一样,随机数也就一样。
 *   全是由"立国年份 + 改朝换代的年份"算出来的,不存进 Civ,接着推(CivSim.fromCiv)时照样算得出。
 * **推演里的"此刻在位"**(reignAt):改朝换代那一刻(同一个时刻)还算旧君在位,下一刻起才是新朝的第一位 ——
 *   这样同一时刻里改朝换代和别的事谁先谁后,算出来的都一样(fromCiv 按日志重放时也能算出同样的结果)。
 *   同一朝里的交接没有这个问题(交接的年份是算出来的,不是事件)。
 * **倾向**(RulerLeanings;每位君主都有,各 0–100,50 是寻常,越高越容易做对应的事):
 *   - expand 开拓:越高越不计较划不划算,偏远、贫瘠的地方也去开垦;越低越只要富庶、离国都近的地方
 *   - war 好战:越高越容易开战,仗打得越久、想多拿几州,打输了越不肯称臣,越常亲征(50 以下不亲征);越低越早想议和
 *   - develop 发展:越高越重视领地内的建设(推演里还没有建设,先留着,不影响推演)
 *   - trade 重商:越高越看重沿海、大河、港口,内陆的地方越不想要(重视贸易的一面等有了商路再加)
 *   开拓、好战都低就是守成之君。每项按"国家的位置锚 + 第几位"随机取(两个均匀数取平均,多数在 30–70),
 *   游牧国家的君主好战、开拓偏高,海洋国家、城邦共和的执政官重商偏高(LEANING_BIAS)。
 *   以后加一项倾向:LEANINGS 里加一个名字、LEANING_USE 里给一对新的随机数编号、LEANING_BIAS 里加偏移、leaningEffect 里写它管什么。
 *   倾向只是一个人的事:同一家里父子可以完全不同。
 *
 * **作者立的君主**(干预"即位",gen/edits.ts 的 crown;Crown):第 T 年年初作者的人物成为这国君主 ——
 *   - 此刻在位的那一位到 T 为止(让位,Reign.cut = T),作者的君主占在位表的下一个位次(不取年纪、倾向的随机数;
 *     倾向照干预里写的,在位到干预的 until,不给就按这个位次的在位年数随机数算、到 MAX_AGE 岁为止,至少一年),
 *     他下台以后照常一位接一位往下排(所以他之后的人换了一批,T 以前一个不变)。
 *   - 推演里他从 T 的下一刻(1/256 年后)起才算"在位"(reignStart),和新朝的第一位一样:同一刻里先发生的事
 *     (同一年先下的立国、划州干预,刚交接的新君……)照原来那一位的倾向算,接着推(fromCiv)按日志重放时也一样。
 *     所以 T 那一刻在位的那一位留在在位表里 —— 他要是正好在 T 这一刻才即位(刚立国的开国之君、刚交接的新君),
 *     就是"在位 0 天"(cut = from),人物里不列(people.ts)。
 *   - 那一刻在位的还没真正在位(同一刻改朝换代的新朝第一位、同一刻先立的作者君主):作者的君主直接顶替他(同一个位次)。
 *   - 他在位时改朝换代、亡国,他就在那一刻下台,和寻常君主一样。
 *   - 带 after 的(等此刻在位的那位下台再即位):他到期下台、被作者让他去世时由作者的人物继位,从那一刻起(到期下台的不另隔一刻)。
 * **作者让君主去世、改君主倾向**(干预 death / temper,只对推演里生成的君主):去世 —— 此刻在位的那位到 T 为止,下一位从 T 起照常排
 *   (reignStep 取年纪、在位年数、倾向,从 T 的下一刻起才算在位),他之后的君主全换一批,T 以前一个不变;
 *   改倾向 —— 此刻在位的那位从 T 的下一刻起照新的倾向(Reign.moods,leaningsAt 按时刻取),到他下台为止,位次、在位年数都不变。
 *   生效了的即位、去世、改倾向推演里登记在 PolityModel.acts(polities.ts 的 rulerAct);不存进 Civ:接着推、排人物时由史事 intervene
 *   和干预列表推出来(actsFrom)。在位表按"有哪几条"缓存(登记了新的就重排)。
 *
 * 随机数:keyed4(subSeed(seed, 'civ-people'), 国家的位置锚, 第几位, 用途, 0),和 people.ts 同一套(位置锚 = 立国时国都的地块
 * + 这块地上第几个立国,见 rulerTags)。纯计算,不碰 DOM。
 */
import type { Annal, CultureKind, Polity, PolityLineage, RulerLeanings, Year } from './types';
import type { Intervention } from '../edits';

export type { RulerLeanings };
import { anchorTag, fexp, fpow, keyed4, subSeed } from './rand';

// ---- 调参 ----
/** 开国之君、新朝之君即位的年纪(随机) */
export const FOUNDER_AGE: [number, number] = [28, 50];
/** 继位的年纪:HEIR_AGE[0] + 跨度 × u^HEIR_EXP(偏年轻,偶有幼主) */
export const HEIR_AGE: [number, number] = [10, 40];
const HEIR_EXP = 1.3;
/** 在位年数:1 + REIGN_MAX × u^REIGN_EXP(中位数十几年,偶有四五十年) */
const REIGN_MAX = 50;
const REIGN_EXP = 1.3;
/** 共和国执政官:就任的年纪、任期 */
export const CONSUL_AGE: [number, number] = [40, 62];
const TERM: [number, number] = [4, 20];
/** 一生最多这么多岁 */
export const MAX_AGE = 88;

/** 倾向的名字(RulerLeanings 的键;人物卡片上的名字和说明在 peopleText.ts 的 LEANING_TEXT) */
export const LEANINGS = ['expand', 'war', 'develop', 'trade'] as const;
export type LeaningKey = (typeof LEANINGS)[number];

/** 各类国家的君主倾向偏移(加在 0–100 的随机数上,再夹到 0–100) */
const LEANING_BIAS: Record<'default' | 'nomad' | 'sea' | 'republic', RulerLeanings> = {
  default: { expand: 0, war: 0, develop: 0, trade: 0 },
  nomad: { expand: 10, war: 15, develop: -10, trade: -10 },
  sea: { expand: 0, war: -5, develop: 0, trade: 20 },
  republic: { expand: -5, war: -15, develop: 5, trade: 15 },
};

/**
 * 倾向怎么折算成推演里的倍数(x = (倾向 - 50) / 50,-1 到 1;50 = 寻常,倍数 1):
 * - 扩张算账的门槛 × e^(-EXPAND_WORTH·x开拓):开拓 100 → × 0.55,0 → × 1.8
 * - 重商:沿海、大河、港口的州门槛再 × e^(-TRADE_COAST·x重商),内陆的 × e^(TRADE_INLAND·x重商)
 * - 好战:宣战的赔率 × e^(WAR_DECLARE·x好战);一场仗最多打多少年 × e^(WAR_LENGTH·x好战);想拿的州数 + round(WAR_GOAL·x好战);
 *   打得很惨时奉表称臣的机会 × e^(-WAR_SUE·x好战);亲征的机会 × (好战 - 50) / LEAD_SPAN(夹到 0–1)
 * - 发展:还不影响推演
 * settle = 算"打多久、想拿几州、肯不肯称臣"用的好战(不给 = 好战本身;国家方针的和谈底线加在这上面,见 policy.ts)
 */
const EXPAND_WORTH = 0.6;
const TRADE_COAST = 0.5;
const TRADE_INLAND = 0.3;
const WAR_DECLARE = 0.5;
const WAR_LENGTH = 0.35;
const WAR_GOAL = 1.5;
const WAR_SUE = 0.5;
const LEAD_SPAN = 40;

/**
 * 倾向对推演的影响:
 * - worth / coast:扩张算账的门槛倍数(内陆 / 沿海、大河、港口的州),越小越不计较划不划算(polities.ts 的 wants)
 * - declare:宣战赔率的倍数(wars.ts 的看邻国)
 * - war:一场仗最多打多少年(厌战)的倍数;goal:这场仗想拿下几州多几州(wars.ts 的议和)
 * - sue:打得很惨时奉表称臣的机会倍数(diplomacy.ts)
 * - lead:亲征的机会倍数(people.ts;0 = 不亲征)
 */
export interface LeaningEffect {
  worth: number;
  coast: number;
  declare: number;
  war: number;
  goal: number;
  sue: number;
  lead: number;
}

export function leaningEffect(l: RulerLeanings, settle = l.war): LeaningEffect {
  const e = (l.expand - 50) / 50;
  const w = (l.war - 50) / 50;
  const c = (l.trade - 50) / 50;
  // 打多久、想拿几州、肯不肯称臣:寻常君主就是好战;方针的和谈底线另加在这一份上(policy.ts)
  const s = (settle - 50) / 50;
  return {
    worth: fexp(-EXPAND_WORTH * e + TRADE_INLAND * c),
    coast: fexp(-EXPAND_WORTH * e - TRADE_COAST * c),
    declare: fexp(WAR_DECLARE * w),
    war: fexp(WAR_LENGTH * s),
    goal: Math.round(WAR_GOAL * s),
    sue: fexp(-WAR_SUE * s),
    lead: Math.min(1, Math.max(0, (l.war - 50) / LEAD_SPAN)),
  };
}

// 随机数用途(和 people.ts 共用一套编号:1、2 是年纪、在位年数)
export const U_AGE = 1;
export const U_REIGN = 2;
/** 倾向:每项两个均匀数,从这个编号起(14、15 开拓,16、17 好战,18、19 重商,20、21 发展;后加的往后排,已有的不变) */
const LEANING_USE: Record<LeaningKey, number> = { expand: 14, war: 16, trade: 18, develop: 20 };
/** keyed4 最后一位:君主 */
export const K_RULER = 0;

const TICK = 256;
const q = (x: number) => Math.round(x * TICK) / TICK;
const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

/** 君主随机数的根(people.ts 同一个) */
export function rulerBase(seed: number): number {
  return subSeed(seed, 'civ-people');
}

/** 各国的位置锚(按编号先后数"这块地上第几个立国";地块 = 立国时国都的城所在的地块),和 people.ts 一样 */
export function rulerTags(polities: readonly Pick<Polity, 'capital'>[], cellOf: (sid: number) => number): number[] {
  const per = new Map<number, number>();
  return polities.map((p) => {
    const cell = cellOf(p.capital);
    const n = per.get(cell) ?? 0;
    per.set(cell, n + 1);
    return anchorTag(Math.max(0, cell), n);
  });
}

/** 一国的君主要用到的国家字段 */
export type ReignPolity = Pick<Polity, 'founded' | 'dynasties' | 'lineage' | 'kind' | 'prince' | 'seizes'>;

/**
 * 第 k 位君主(这一朝第 j 位)从 from 年即位:即位的年纪、不被打断时在位到哪年、倾向。
 * born = 生年已经定了的开国之君(宗室争位、据地自立的那位,Polity.prince):即位的年纪照它算
 */
export function reignStep(
  base: number,
  tag: number,
  k: number,
  j: number,
  from: Year,
  lineage: PolityLineage | undefined,
  kind: CultureKind,
  born?: Year,
): { age: number; natural: Year; leanings: RulerLeanings } {
  const R = (use: number) => keyed4(base, tag, k, use, K_RULER);
  const republic = lineage === 'republic';
  let A: number;
  let L: number;
  if (republic) {
    A = lerp(CONSUL_AGE, R(U_AGE));
    L = lerp(TERM, R(U_REIGN));
  } else {
    A = born !== undefined ? from - born : j === 0 ? lerp(FOUNDER_AGE, R(U_AGE)) : HEIR_AGE[0] + (HEIR_AGE[1] - HEIR_AGE[0]) * fpow(R(U_AGE), HEIR_EXP);
    L = 1 + REIGN_MAX * fpow(R(U_REIGN), REIGN_EXP);
  }
  if (A + L > MAX_AGE) L = Math.max(1, MAX_AGE - A);
  return { age: A, natural: q(from + L), leanings: drawLeanings(R, lineage, kind) };
}

/**
 * 按随机数 R(用途)取一份倾向(君主、掌实权的叔伯、名臣、大将同一种取法,见 regency.ts):每项两个均匀数取平均,
 * 加上这类国家的偏移(LEANING_BIAS),再加 shift(大将好战偏高),夹到 0–100
 */
export function drawLeanings(R: (use: number) => number, lineage: PolityLineage | undefined, kind: CultureKind, shift?: Partial<RulerLeanings>): RulerLeanings {
  const bias = LEANING_BIAS[lineage === 'republic' ? 'republic' : kind === 'nomad' ? 'nomad' : kind === 'sea' ? 'sea' : 'default'];
  const leanings = {} as RulerLeanings;
  LEANINGS.forEach((key) => {
    const u = (R(LEANING_USE[key]) + R(LEANING_USE[key] + 1)) / 2;
    leanings[key] = Math.min(100, Math.max(0, Math.round(100 * u + bias[key] + (shift?.[key] ?? 0))));
  });
  return leanings;
}

/** 作者立的君主(干预"即位"生效了的一条;推演里登记在 PolityModel.acts,接着推、排人物时由 actsFrom 推出来) */
export interface Crown {
  kind: 'crown';
  /** 即位的那一刻(第 from 年年初);after 的 = 登记的那一刻(真正即位在 t 那一刻在位的那位下台时) */
  t: Year;
  /** 在位到哪一年年初(干预的 until);不给 = 按寻常君主的在位年数 */
  until?: Year;
  /** 生年(干预里抄下来的) */
  born: Year;
  leanings: RulerLeanings;
  /** 作者人物的编号(AuthorCharacter.id) */
  char: number;
  /** 第几条干预(Civ.interventions 的下标) */
  iv: number;
  /** 等 t 那一刻在位的那位下台再即位(干预"即位"的 after) */
  after?: true;
}

/** 作者让君主去世(干预"让人物去世"生效了的一条):t 那一刻在位的那位到 t 为止,下一位从下一刻起照常继位 */
export interface RulerDeath {
  kind: 'death';
  t: Year;
  iv: number;
}

/** 作者改君主的倾向(干预"改君主倾向"生效了的一条):t 那一刻在位的那位从下一刻起照 leanings,到他下台为止 */
export interface RulerTemper {
  kind: 'temper';
  t: Year;
  iv: number;
  leanings: RulerLeanings;
}

/**
 * 宗室摄政篡位(regency.ts;不是干预,存在 Polity.seizes,在位表排的时候并进来):t 那一刻在位表第 k 位(幼主)下台,
 * 摄政的叔父接着在位(第 k + 1 位,同一朝),生年、倾向照摄政时的,在位到 until。那一刻在位的不是第 k 位就不起作用
 */
export interface RulerSeize {
  kind: 'seize';
  t: Year;
  k: number;
  born: Year;
  until: Year;
  leanings: RulerLeanings;
}

/** 改在位表的干预(生效了的,按生效先后):即位、让君主去世、改君主倾向 */
export type RulerAct = Crown | RulerDeath | RulerTemper;

/**
 * 史事 intervene 的 b 列(即位、让人物去世、改君主倾向;interventions.ts 记,编年史、actsFrom 读):
 * −1 生效了 / −2 他还没出生(即位)/ −3 那一年这国已亡 / −4 此刻在位的不是他(让人物去世、改倾向)/
 * −5 将领、名臣去世(推演里不管,人物那边按卒年、去职年份定)/ −6 等此刻在位的那位下台再即位(登记了;真即位时另记一条 −1)/
 * −7 灭国:那一刻有排在它后面(后下)的"不许灭"护着这国,没灭(interventions.ts 的 destroy)
 */
export const IV_NOT_HIM = -4;
export const IV_PEOPLE = -5;
export const IV_WAIT = -6;
export const IV_PROTECTED = -7;

type CrownIntervention = Extract<Intervention, { kind: 'crown' }>;

/** 一条生效了的即位干预(第 iv 条,t 那一刻生效 / 登记)→ Crown */
export function crownOf(v: CrownIntervention, t: Year, iv: number): Crown {
  const c: Crown = { kind: 'crown', t, born: v.born, leanings: v.leanings, char: v.char, iv };
  if (v.until !== undefined) c.until = v.until;
  if (v.after) c.after = true;
  return c;
}

/**
 * 史事里生效了的即位、让君主去世、改君主倾向(intervene;等下台再即位的认登记那一条 b = −6,别的认 b = −1)→ 国家编号 → 按生效先后。
 * list = 推出这份历史时带着的干预(史事 intervene 的 war 列是它的下标)
 */
export function actsFrom(annals: readonly Annal[], list: readonly Intervention[] | null | undefined): Map<number, RulerAct[]> {
  const out = new Map<number, RulerAct[]>();
  if (!list?.length) return out;
  for (const e of annals) {
    if (e.kind !== 'intervene' || e.a < 0) continue;
    const v = list[e.war];
    let c: RulerAct | null = null;
    if (v?.kind === 'crown') {
      if (e.b === (v.after ? IV_WAIT : -1)) c = crownOf(v, e.year, e.war);
    } else if (v?.kind === 'death') {
      if (e.b === -1) c = { kind: 'death', t: e.year, iv: e.war };
    } else if (v?.kind === 'temper') {
      if (e.b === -1) c = { kind: 'temper', t: e.year, iv: e.war, leanings: v.leanings };
    }
    if (!c) continue;
    const at = out.get(e.a);
    if (at) at.push(c);
    else out.set(e.a, [c]);
  }
  return out;
}

/**
 * 作者立的君主在位到哪一刻(不被打断时):干预的 until;不给 = 第 k 位的在位年数随机数(同 reignStep),到 MAX_AGE 岁为止 ——
 * 即位时已年近(或过了)MAX_AGE 岁的至少在位一年(和寻常君主的规矩一样;要别的年份就在干预里写 until)。
 * 等前一位下台再即位的,到即位时 until 已经过了的当作没给
 */
function crownNatural(base: number, tag: number, k: number, from: Year, c: Crown, lineage: PolityLineage | undefined): Year {
  if (c.until !== undefined && q(c.until) > from) return q(c.until);
  const u = keyed4(base, tag, k, U_REIGN, K_RULER);
  let L = lineage === 'republic' ? lerp(TERM, u) : 1 + REIGN_MAX * fpow(u, REIGN_EXP);
  const age = from - c.born;
  if (age + L > MAX_AGE) L = Math.max(1, MAX_AGE - age);
  return q(from + L);
}

/** 在位表的一项 */
export interface Reign {
  /** 全国第几位(0 起,跨朝连续) */
  k: number;
  /** 第几朝(Polity.dynasties 的下标) */
  dynasty: number;
  /** 这一朝第几位 */
  j: number;
  /** 即位的年份 */
  from: Year;
  /** 即位的年纪 */
  age: number;
  /** 不被打断时在位到哪年(这一朝先结束就到改朝换代那一刻) */
  natural: Year;
  leanings: RulerLeanings;
  /** 倾向折算成推演里的倍数(leaningEffect) */
  eff: LeaningEffect;
  /** 作者立的君主(干预"即位";age 是即位时的岁数,倾向照干预里写的);寻常君主不给 */
  crown?: Crown;
  /** 被作者立的君主取代(让位)、被作者让他去世的那一刻;= from 是在位 0 天(同一刻刚即位就让位,人物里不列);没被取代 = 不给 */
  cut?: Year;
  /** 作者让他去世(干预"让人物去世"):那一刻、第几条干预 */
  death?: { t: Year; iv: number };
  /** 作者改过他的倾向(干预"改君主倾向",按先后):t 那一刻改的,下一刻起照新的 leanings、eff;他原来的照旧在 leanings、eff */
  moods?: Mood[];
  /** 等他下台再即位的作者人物(干预"即位"带 after;他到期下台、被作者让他去世时由这位继位) */
  heir?: Crown;
  /** 从即位的下一刻起才算在位(前一位被作者让他去世、被摄政的叔父废了:同一刻里先发生的事照前一位算) */
  late?: true;
  /** 摄政的叔父废了幼主自立(Polity.seizes 的那一条;regency.ts);别的不给 */
  seize?: RulerSeize;
}

/** 改过的倾向 */
export interface Mood {
  t: Year;
  iv: number;
  leanings: RulerLeanings;
  eff: LeaningEffect;
}

/** 君主 r 在 t 这一刻的倾向(作者改过的:t 以前最后一次改的;没改过 = 他原来的) */
export function leaningsAt(r: Reign, t: Year): Pick<Reign, 'leanings' | 'eff'> {
  const ms = r.moods;
  if (ms) for (let i = ms.length - 1; i >= 0; i--) if (ms[i].t < t) return ms[i];
  return r;
}

/**
 * 推演里按"此刻"排好的在位表(按国家对象缓存;改朝换代了(Polity.dynasties 变长)、多了作者立的君主,就重排)。
 * 一位接一位往后排,最后一朝只排到够用为止(在位到 t 以后的那一位),要更晚的再往后排
 */
interface Book {
  tag: number;
  dyn: number;
  /** 排的时候有哪几条改在位表的干预(按先后;和传进来的逐个比,不一样就重排) */
  acts: readonly RulerAct[];
  /** 排的时候 Polity.seizes 有几条(多了就重排) */
  sz: number;
  /** 干预和宗室篡位并在一起(按时刻;同一刻宗室篡位在前:它在那一刻最先的几类事件里办,干预在后) */
  all: readonly (RulerAct | RulerSeize)[];
  reigns: Reign[];
  /** 下一位:第几朝、这一朝第几位、即位年份;等前一位下台再即位的作者人物 */
  i: number;
  j: number;
  from: Year;
  heir: Crown | null;
  /** 下一条还没排进去的干预(acts 的下标) */
  ci: number;
}
const books = new WeakMap<ReignPolity, Book>();
const NO_ACTS: readonly RulerAct[] = [];

const sameActs = (a: readonly RulerAct[], b: readonly RulerAct[]) => a.length === b.length && a.every((c, i) => c === b[i]);

/**
 * 国家 p(位置锚 tag)的在位表,保证排到 t 时在位的那一位(和他之后不被打断时的下一位的即位年份)。
 * acts = 这国改在位表的干预(按生效先后;推演里是 PolityModel.acts,排人物时由 actsFrom 推出来);没有 = 和以前一样。
 * 每一条都落在它那一刻在位的那位身上(那一刻的下一位还没真正在位的 —— 同一刻改朝换代的新朝第一位、同一刻先立的作者君主、
 * 前一位同一刻刚去世的继位者 —— 落在前一位身上):
 *   即位:在位的到那一刻让位,作者的人物占下一个位次;下一位还没真正在位的由作者的人物直接顶替(同一个位次)
 *   等下台再即位:记在他身上(heir),他到期下台、被作者让他去世时由作者的人物继位;改朝换代、亡国、被另立的作者君主取代 = 落空
 *   让他去世:他到那一刻为止(cut、death),下一位(或等着的作者人物)从那一刻即位、下一刻起才算在位(late);
 *     落在前一位身上的(他那一刻本来就下台了)只记 death
 *   改倾向:记在他身上(moods),下一刻起照新的;落在前一位身上的不起作用
 */
export function reignBook(base: number, tag: number, p: ReignPolity, t: Year, acts: readonly RulerAct[] = NO_ACTS): readonly Reign[] {
  const segs = p.dynasties?.length ? p.dynasties : null;
  const dyn = segs ? segs.length : 1;
  const sz = p.seizes?.length ?? 0;
  let b = books.get(p);
  if (!b || b.dyn !== dyn || b.tag !== tag || b.sz !== sz || !sameActs(b.acts, acts)) {
    const own = acts.length ? acts.slice() : NO_ACTS;
    let all: (RulerAct | RulerSeize)[] = own as RulerAct[];
    if (sz) {
      // 并在一起:按时刻,同一刻宗室篡位在前(稳定排序,各自原来的先后不变)
      const seizes: RulerSeize[] = p.seizes!.map((x) => ({ kind: 'seize', t: x.year, k: x.k, born: x.born, until: x.until, leanings: x.leanings }));
      all = [...seizes, ...own].map((c, i) => ({ c, i })).sort((u, v) => u.c.t - v.c.t || (u.c.kind === 'seize' ? 0 : 1) - (v.c.kind === 'seize' ? 0 : 1) || u.i - v.i).map((x) => x.c);
    }
    b = { tag, dyn, acts: own, sz, all, reigns: [], i: 0, j: 0, from: p.founded, heir: null, ci: 0 };
    books.set(p, b);
  }
  /** 第 i 朝到哪一刻为止(最后一朝 = 不断) */
  const segEnd = (i: number) => (i + 1 < dyn ? segs![i + 1].year : Infinity);
  /** 寻常的第 k 位(这一朝第 j 位)从 from 即位;掌实权的名臣、大臣篡位开的朝(Polity.dynasties 的 usurper),第一位照他的生年、倾向 */
  const regular = (k: number, dynasty: number, j: number, from: Year): Reign => {
    const u = j === 0 && dynasty > 0 ? segs?.[dynasty]?.usurper : undefined;
    const s = reignStep(base, tag, k, j, from, p.lineage, p.kind, u ? u.born : k === 0 ? p.prince : undefined);
    const leanings = u ? { ...u.leanings } : s.leanings;
    return { k, dynasty, j, from, age: s.age, natural: s.natural, leanings, eff: leaningEffect(leanings) };
  };
  /** 摄政的叔父(c)废了幼主,做第 k 位(这一朝第 j 位),从 from 即位 */
  const seizer = (c: RulerSeize, k: number, dynasty: number, j: number, from: Year): Reign => ({
    k,
    dynasty,
    j,
    from,
    age: from - c.born,
    natural: Math.max(c.until, q(from + 1 / TICK)),
    leanings: { ...c.leanings },
    eff: leaningEffect(c.leanings),
    seize: c,
  });
  /** 作者的人物(c)做第 k 位(这一朝第 j 位),从 from 即位 */
  const author = (c: Crown, k: number, dynasty: number, j: number, from: Year): Reign => ({
    k,
    dynasty,
    j,
    from,
    age: from - c.born,
    natural: crownNatural(base, tag, k, from, c, p.lineage),
    leanings: c.leanings,
    eff: leaningEffect(c.leanings),
    crown: c,
  });
  const L = b.reigns;
  // 一位接一位排(前面几朝整朝排完),最后一朝排到 natural > t
  while (true) {
    const last = L[L.length - 1];
    if (last && last.dynasty === dyn - 1 && last.natural > t) break;
    const k = L.length;
    L.push(b.heir ? author(b.heir, k, b.i, b.j, b.from) : regular(k, b.i, b.j, b.from));
    b.heir = null;
    // 改在位表的干预(见上)
    for (let c = b.all[b.ci]; c; c = b.all[b.ci]) {
      const cur = L[L.length - 1];
      if (c.t < cur.from) {
        b.ci++; // 不该发生(立国以前、排过了头):不管它
        continue;
      }
      const early = c.t === cur.from && reignStart(cur) > cur.from;
      if (!early && c.t >= Math.min(cur.natural, segEnd(cur.dynasty))) break;
      if (c.kind === 'seize') {
        // 宗室摄政篡位:那一刻在位的是那位幼主才算(他先去世、被废、改朝换代了 = 落空)
        if (!early && cur.k === c.k) {
          cur.cut = c.t;
          const next = seizer(c, cur.k + 1, cur.dynasty, cur.j + 1, c.t);
          next.late = true;
          L.push(next);
        }
      } else if (c.kind === 'crown' && !c.after) {
        if (early) L[L.length - 1] = author(c, cur.k, cur.dynasty, cur.j, c.t);
        else {
          cur.cut = c.t;
          L.push(author(c, cur.k + 1, cur.dynasty, cur.j + 1, c.t));
        }
      } else if (c.kind === 'death') {
        const prev = L[L.length - 2];
        if (early) {
          if (prev && !prev.death) prev.death = { t: c.t, iv: c.iv };
        } else {
          cur.cut = c.t;
          cur.death = { t: c.t, iv: c.iv };
          const next = cur.heir ? author(cur.heir, cur.k + 1, cur.dynasty, cur.j + 1, c.t) : regular(cur.k + 1, cur.dynasty, cur.j + 1, c.t);
          next.late = true;
          L.push(next);
        }
      } else if (c.kind === 'temper') {
        if (!early) (cur.moods ??= []).push({ t: c.t, iv: c.iv, leanings: c.leanings, eff: leaningEffect(c.leanings) });
      } else if (!early) cur.heir = c;
      b.ci++;
    }
    // 下一位:这一朝里接着排(等着他下台的作者人物先上),或者这一朝到头了,下一朝的第一位
    const cur = L[L.length - 1];
    const end = segEnd(cur.dynasty);
    if (cur.natural < end) {
      b.i = cur.dynasty;
      b.j = cur.j + 1;
      b.from = cur.natural;
      b.heir = cur.heir ?? null;
    } else {
      b.i = cur.dynasty + 1;
      b.j = 0;
      b.from = end;
    }
  }
  return L;
}

/**
 * 这一位从哪一刻起算"在位"(推演里):新朝的第一位从改朝换代的下一刻起、作者立的君主从即位的下一刻起(见文件头)、
 * 前一位被作者让他去世的从即位的下一刻起;其余从即位那一刻(等前一位到期下台再即位的作者人物也是)
 */
export function reignStart(r: Reign): Year {
  return (r.j === 0 && r.dynasty > 0) || (r.crown && !r.crown.after) || r.late ? r.from + 1 / TICK : r.from;
}

/** 这一位的生年(和 people.ts 排出来的 Person.born 一样;人物键里取整的就是它) */
export function reignBorn(r: Reign): Year {
  return r.crown ? r.crown.born : q(r.from - r.age);
}

/** 推演里 t 这一刻在位的君主(下标 = Reign.k);t 早于立国 = 第一位 */
export function reignAt(base: number, tag: number, p: ReignPolity, t: Year, crowns: readonly RulerAct[] = NO_ACTS): Reign {
  const list = reignBook(base, tag, p, t, crowns);
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (reignStart(list[mid]) <= t) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

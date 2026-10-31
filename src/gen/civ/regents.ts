/**
 * 掌实权的人:某国某几年里,名义上的君主照旧在位,开战、议和、扩张算账、议事听另一个人的(推演里照他的倾向)。
 * 这里是纯计算的那一半:几种"掌权的一段"怎么定(候选、结局、掌权的人的生年和倾向)、怎么由史事推出来、某一刻谁在掌权;
 * 推演里什么时候办(掌权、还政、伏诛、篡位)在 regency.ts,人物在 people.ts 按这里推出来的段落挂上人。
 *
 * 六种(REGENCY_KINDS;史事 regent 的 b 列是下标):
 *   march 引兵入朝:君主年过 MARCH_AGE、预定的继承人是他的成年儿子、还有别的成年兄弟、本国正在打仗(或 MARCH_WAR 年内打过)——
 *     原定去世前 MARCH_LEAD 年里的某一刻有 MARCH_P 的机会:那个儿子引兵还朝(杀兄长和战功比他多的兄弟,人物里排,royals.ts 的 march),
 *     不即位,掌权到先君去世,接着即位;那一刻本国正在打的仗,国力 × MARCH_SUPPLY,MARCH_FADE 年里淡回
 *   heir 太子监国:君主原定在位的最后 HEIR_LEAD 年里的某一刻年过 HEIR_AGE、预定的继承人是他的成年儿子:HEIR_P 的机会
 *     (也有引兵入朝的候选、又排在它前头的不算)
 *   uncle 宗室摄政 / minister 名臣辅政:幼主(继位时不满 YOUNG 岁)即位那一刻 —— 先君有成年在世的兄弟(先君是他父亲的预定继承人、
 *     那兄弟没据地自立、先君即位前没有引兵入朝那回事)UNCLE_P 的机会叔父摄政,不然有大臣的国家(国号到"国"以上)名臣辅政;
 *     到幼主 ADULT 岁办结局(叔父先去世 = 到那时为止,卒):还政 / 伏诛 / 篡位(CHILD_END)。
 *     叔父篡位 = 幼主那一刻下台,叔父接着在位(同一朝,Polity.seizes);名臣篡位 = 改朝换代(新朝起于国都,Polity.dynasties 的 usurper)
 *   chancellor 大臣专权 / general 大将专权:王国、帝国看王朝时(dynasty.ts)没改朝换代,这些年战败失地、丢了国都(大臣),
 *     或接连开疆(大将),有 STRONG_P 的机会出一位权臣,掌权 STRONG_LEN 年,到期办结局:篡位(只有大臣;改朝换代)/ 伏诛 / 卒于位
 * 同一国同一时刻只有一位掌权的人,先到先得;作者立的君主、共和国执政官不会被架空。
 * 掌权的人的倾向:引兵入朝、太子监国 = 他日后即位时在位表里那一位的倾向(前后一个人一样);叔父、名臣、大臣、大将另取一份
 *   (和君主同样的取法,rulers.ts 的 drawLeanings;大将好战偏高 GENERAL_WAR)。
 * **某一刻谁在掌权**(regentAt):掌权那一刻的下一刻起,到结局那一刻为止(不含),而且 ——
 *   还是那一朝(改朝换代就了结;和在位表一样,同一刻改朝换代还算旧朝)、
 *   名义君主还在位(引兵入朝、太子监国、宗室摄政、名臣辅政:先君去世、被废、被作者立的君主取代就了结)/
 *   掌权以来没有作者立的君主即过位(大臣、大将专权跨几位君主也照旧;作者的君主一即位就此了结,他下台以后也不再回来)。
 * 随机数:keyed4(subSeed(seed, 'civ-regency'), 国家的位置锚(rulers.ts 的 rulerTags), 键, 用途, 种类),
 *   键 = 名义君主的位次 × 16(+ 1 幼主)/ 掌权那一刻 × 256(大臣、大将);诸子的生年、寿数、日后即位的倾向用 royals.ts、rulers.ts 那一份。纯计算。
 */
import type { Annal, Polity, RulerLeanings, Year } from './types';
import { AUTHOR_REGENT_AGE_END, parsePersonKey, type Intervention } from '../edits';
import { fpow, keyed4, subSeed } from './engine/rand';
import { MAX_AGE, drawLeanings, leaningEffect, reignBorn, reignStart, reignStep, type LeaningEffect, type Reign } from './rulers';
import { POSTHUMOUS, broodOf } from './royals';
import { polityTierAt } from './growth';
import { royalSeg, segLineage } from './regime';

// ---- 调参(推荐值,按 20 个种子的统计调,见 scripts/gen-stats.ts) ----
/**
 * 引兵入朝:君主年过这么多岁;机会;原定去世前几年里的某一刻。
 * (起初定的 55 岁、15%:统计下来晚年还有成年太子、成年兄弟、又在打仗的君主很少,种子 7 一次也没有;调到 50 岁、50%)
 */
export const MARCH_AGE = 50;
export const MARCH_P = 0.5;
const MARCH_LEAD: [number, number] = [1, 6];
/**
 * "本国正在打仗":正在打,或这么多年内打过(太子还在军中)。
 * (起初只算"正在打仗";推演里一国在打仗的年份不多,够条件的十几回里一回也没赶上,放宽到 20 年内打过)
 */
export const MARCH_WAR = 20;
/**
 * 太子监国:君主年过这么多岁;机会;原定在位的最后几年里的某一刻(和引兵入朝都有候选、又在它之前的,让给引兵入朝)。
 * (起初定的 68 岁、30%:老君主的下一位多半是孙辈,年过 68 还有成年太子的很少,种子 7 只有三次;调到 55 岁、50%)
 */
export const HEIR_AGE = 55;
export const HEIR_P = 0.5;
const HEIR_LEAD: [number, number] = [1, 5];
/** 继承人、叔父算"成年"的岁数;引兵入朝要有别的兄弟到了这么多岁 */
const GROWN = 18;
const BROTHER = 16;
/** 幼主:即位不满这么多岁;到这么多岁还政(和 officials.ts 的辅政一样) */
export const YOUNG = 12;
export const ADULT = 18;
/** 先君有成年在世的兄弟时,叔父摄政的机会(其余名臣辅政) */
export const UNCLE_P = 0.4;
/** 幼主成年时:还政、伏诛的机会(其余篡位) */
const CHILD_END: [number, number] = [0.75, 0.15];
/** 名臣受命辅政时的年纪 */
const MINISTER_AGE: [number, number] = [32, 55];
/** 大臣、大将专权:国号到这一档(王国)以上;这么多年内战败失地 STRONG_LOSS 州以上、丢过国都(大臣),或开疆 STRONG_GAIN 州以上(大将) */
export const STRONG_TIER = 2;
export const STRONG_YEARS = 30;
export const STRONG_LOSS = 4;
export const STRONG_GAIN = 8;
/** 看王朝时出一位权臣的机会;掌权几年;掌权时的年纪 */
export const STRONG_P = 0.3;
const STRONG_LEN: [number, number] = [5, 25];
const STRONG_AGE: [number, number] = [35, 55];
/** 大臣专权到期:篡位、伏诛的机会(其余卒于位);大将专权到期:伏诛的机会(其余卒于位) */
const CHANCELLOR_END: [number, number] = [0.35, 0.3];
/** 篡位的人即位时最多这么大(和别的君主一样即位不过 62 岁):幼主成年时摄政的人已过这个年纪的还政,大臣专权要篡位的到这个年纪就动手 */
const USURP_AGE = 62;
const GENERAL_PURGE = 0.3;
/** 大将的好战比照常取法高这么多 */
const GENERAL_WAR = 15;
/** 叔父篡位以后在位多少年:1 + SEIZE_REIGN × u^1.3(同 rulers.ts 的在位年数),到 MAX_AGE 岁为止 */
const SEIZE_REIGN = 50;
/** 引兵入朝那一刻本国正在打的仗:本国国力 × MARCH_SUPPLY,MARCH_FADE 年里淡回(wars.ts 的胜率) */
export const MARCH_SUPPLY = 0.85;
export const MARCH_FADE = 3;

// 随机数用途
const U_MARCH = 1;
const U_MARCH_T = 2;
const U_HEIR = 3;
const U_HEIR_T = 4;
const U_UNCLE = 5;
const U_END = 6;
const U_AGE = 7;
const U_STRONG = 8;
const U_KIND = 9;
const U_LEN = 10;
const U_REIGN = 11;
/** keyed4 最后一位:君主的位次 / 叔伯名臣的倾向 / 大臣大将 / 大臣大将的倾向 */
const K_REIGN = 0;
const K_LEAN = 1;
const K_STRONG = 2;
const K_STRONG_LEAN = 3;

const TICK = 256;
const q = (x: number) => Math.round(x * TICK) / TICK;
const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

/** 六种掌权(史事 regent 的 b 列是下标) */
export const REGENCY_KINDS = ['march', 'heir', 'uncle', 'minister', 'chancellor', 'general'] as const;
export type RegencyKind = (typeof REGENCY_KINDS)[number];
/** 史事 regent 的 n 列:掌权、还政、伏诛、篡位、卒于位 */
export const RG_START = 0;
export const RG_RETURN = 1;
export const RG_PURGE = 2;
export const RG_USURP = 3;
export const RG_DIED = 4;
export type RegencyOutcome = 'return' | 'purge' | 'usurp' | 'died';

/** 大臣、大将专权:跨几位君主也照旧掌权(不跟着名义君主了结) */
export const strongKind = (k: RegencyKind) => k === 'chancellor' || k === 'general';

/** 掌权的一段 */
export interface Regency {
  pid: number;
  kind: RegencyKind;
  /** 名义君主(掌权那一刻在位的那位)在在位表里第几位 */
  k: number;
  /** 掌权那一刻(下一刻起推演照他) */
  start: Year;
  /** 那时是第几朝(Polity.dynasties 的下标;改朝换代就了结) */
  dyn: number;
  /** 不被打断时到哪一刻了结、办结局:引兵入朝、太子监国 = Infinity(跟着名义君主去世了结,没有结局) */
  stop: Year;
  /** 到 stop 那一刻办的结局;引兵入朝、太子监国不给 */
  outcome?: RegencyOutcome;
  /** 掌权的人的生年(引兵入朝、太子监国 = 继承人的) */
  born: Year;
  leanings: RulerLeanings;
  /** 倾向折算成推演里的倍数(方针的缓存按这个对象记,见 policy.ts 的 segEffect) */
  eff: LeaningEffect;
  /** 叔父摄政:先君的父亲在在位表里第几位、叔父是他的第几个儿子(royals.ts 的 Brood.extra 的 s) */
  uncle?: { k: number; s: number };
  /** 办完结局了(还政、伏诛、篡位、卒那一条记了) */
  closed: boolean;
  /** 掌权那一条史事的下标 */
  annal: number;
  /** 作者下令"让他掌权"(干预)来的:第几条干预(史事 regent 的 foe 列记着);推演里自己出的不给 */
  iv?: number;
}

/** 推算要用的那几样:君主随机数的根(rulers.ts 的 rulerBase)、掌实权自己的根、各国的位置锚、国家表、在位表 */
export interface RegencyCtx {
  rbase: number;
  base: number;
  tag: readonly number[];
  polities: readonly Polity[];
  /** 国家 pid 的在位表(带干预、宗室篡位),保证排到 t */
  book: (pid: number, t: Year) => readonly Reign[];
  /** 干预列表(作者下令"让他掌权"的那几段按它推出来;没有 = 不给) */
  ivs?: readonly Intervention[];
}

export function regencyBase(seed: number): number {
  return subSeed(seed, 'civ-regency');
}

const rnd = (cx: RegencyCtx, pid: number, key: number, use: number, kind: number) => keyed4(cx.base, cx.tag[pid] ?? 0, key, use, kind);

/** t 这一刻算第几朝(同一刻改朝换代还算旧朝,和在位表一样) */
export function dynastyBefore(P: Polity, t: Year): number {
  const d = P.dynasties;
  if (!d || d.length < 2) return 0;
  let i = d.length - 1;
  while (i > 0 && d[i].year >= t) i--;
  return i;
}

/** t 那一刻(含那一刻改的)是第几朝 */
function dynastyAtTick(P: Polity, t: Year): number {
  const d = P.dynasties;
  if (!d || d.length < 2) return 0;
  let i = d.length - 1;
  while (i > 0 && d[i].year > t) i--;
  return i;
}

/**
 * g 在 t 这一刻还掌着权(不看结局那一刻):还是那一朝;名义君主还在位 / 掌权以来没有作者立的君主即过位(大臣、大将专权;
 * 作者的君主一即位,专权就此了结,他下台以后也不再回来)。r = t 那一刻在位的;book = 这国的在位表(排到 r)
 */
export function holds(P: Polity, g: Regency, t: Year, r: Reign, book: readonly Reign[]): boolean {
  if (dynastyBefore(P, t) !== g.dyn) return false;
  if (!strongKind(g.kind)) return r.k === g.k;
  for (let k = r.k; k > g.k; k--) if (book[k]?.crown) return false;
  return !r.crown;
}

/** 国家 P 在 t 这一刻谁在掌权(list = 这国的几段,按掌权先后;r = 此刻在位的,book = 在位表);没有 = null */
export function regentAt(P: Polity, list: readonly Regency[] | undefined, t: Year, r: Reign, book: readonly Reign[]): Regency | null {
  if (!list || !list.length) return null;
  // 同一国的几段不重叠(后一段掌权时前一段已经了结):看掌权那一刻早于此刻的最后一段
  let i = list.length - 1;
  while (i >= 0 && !(list[i].start < t)) i--;
  if (i < 0) return null;
  const g = list[i];
  return t < g.stop && holds(P, g, t, r, book) ? g : null;
}

/** 引兵入朝、太子监国的候选(还没看有没有人掌着权、在不在打仗) */
export interface LatePlan {
  kind: 'march' | 'heir';
  /** 掌权的那一刻 */
  t: Year;
  /** 继承人的生年 */
  born: Year;
  /** 继承人日后即位时的倾向(在位表里下一位的,rulers.ts 的 reignStep) */
  leanings: RulerLeanings;
}

/** 君主 r(国家 pid)晚年的候选,按时刻(同一刻引兵入朝在前);没有 = 空 */
export function latePlans(cx: RegencyCtx, pid: number, r: Reign): LatePlan[] {
  const P = cx.polities[pid];
  if (!P || !royalSeg(P, r.dynasty) || r.crown || !(r.natural < Infinity)) return [];
  const R = (use: number) => rnd(cx, pid, r.k * 16, use, K_REIGN);
  const march = R(U_MARCH) < MARCH_P;
  const heir = R(U_HEIR) < HEIR_P;
  if (!march && !heir) return [];
  const br = broodOf(cx.rbase, cx.tag[pid], r, P);
  const hb = br.heir;
  if (hb === undefined) return [];
  const fb = reignBorn(r);
  const from = reignStart(r);
  let lean: RulerLeanings | null = null;
  const heirLean = () => (lean ??= reignStep(cx.rbase, cx.tag[pid], r.k + 1, r.j + 1, r.natural, segLineage(P, r.dynasty), P.kind).leanings);
  const out: LatePlan[] = [];
  if (march) {
    const t = q(r.natural - lerp(MARCH_LEAD, R(U_MARCH_T)));
    if (t > from && t - fb > MARCH_AGE && t - hb >= GROWN && br.extra.some((x) => x.born + BROTHER <= t && x.life > t)) out.push({ kind: 'march', t, born: hb, leanings: heirLean() });
  }
  if (heir) {
    const t = q(r.natural - lerp(HEIR_LEAD, R(U_HEIR_T)));
    // 也有引兵入朝的候选:太子监国在它之后才看(引兵入朝那一刻没赶上打仗,才轮得到)
    if (t > from && t - fb > HEIR_AGE && t - hb >= GROWN && !(out.length && t <= out[0].t)) out.push({ kind: 'heir', t, born: hb, leanings: heirLean() });
  }
  return out;
}

/** 幼主即位那一刻定下的:谁摄政 / 辅政、到哪一刻、结局 */
export interface ChildPlan {
  kind: 'uncle' | 'minister';
  born: Year;
  stop: Year;
  outcome: RegencyOutcome;
  leanings: RulerLeanings;
  uncle?: { k: number; s: number };
}

/** 幼主成年时的结局;到那时摄政的人已过 USURP_AGE 岁的不篡位(还政) */
const childEnd = (u: number, born: Year, stop: Year): RegencyOutcome =>
  u < CHILD_END[0] ? 'return' : u < CHILD_END[0] + CHILD_END[1] ? 'purge' : stop - born > USURP_AGE ? 'return' : 'usurp';

/**
 * 第 k 位君主 r(国家 pid)是继位的幼主:谁摄政 / 辅政(见文件头);不是幼主、没人可用 = null。
 * marched(k) = 在位表第 k 位在位时有过引兵入朝(他的儿子们那时被杀过一轮,不再找叔父)
 */
export function childPlan(cx: RegencyCtx, pid: number, r: Reign, marched: (k: number) => boolean): ChildPlan | null {
  const P = cx.polities[pid];
  if (!P || !royalSeg(P, r.dynasty) || r.crown || r.seize || r.j === 0 || !(r.age < YOUNG)) return null;
  const t = reignStart(r);
  const key = r.k * 16 + 1;
  const R = (use: number) => rnd(cx, pid, key, use, K_REIGN);
  const adult = q(reignBorn(r) + ADULT);
  const leanings = () => drawLeanings((use) => rnd(cx, pid, key, use, K_LEAN), segLineage(P, r.dynasty), P.kind);
  // 叔父:先君的兄弟(先君是他父亲的预定继承人、接着即位的),成年、在世、没据地自立,挑最年长的
  const list = cx.book(pid, t);
  const prev = list[r.k - 1];
  const f = list[r.k - 2];
  let uncle: { s: number; born: Year; life: Year } | null = null;
  if (
    prev &&
    f &&
    prev.dynasty === r.dynasty &&
    f.dynasty === r.dynasty &&
    !prev.crown &&
    !prev.seize &&
    !f.crown &&
    f.cut === undefined &&
    prev.from === f.natural &&
    !marched(f.k)
  ) {
    const br = broodOf(cx.rbase, cx.tag[pid], f, P);
    if (br.heir === reignBorn(prev)) {
      for (const x of br.extra) {
        // 父亲去世以后(遗腹子除外)才生的不算(和 royals.ts 的 buildSons 一样:人物里没有这个儿子)
        if (x.born > f.natural + POSTHUMOUS || x.born + GROWN > t || x.life <= t || (uncle && uncle.born <= x.born)) continue;
        if (cx.polities.some((Q) => Q.parent === pid && Q.prince === x.born)) continue;
        uncle = x;
      }
    }
  }
  if (uncle && R(U_UNCLE) < UNCLE_P) {
    const died = uncle.life < adult;
    return { kind: 'uncle', born: uncle.born, stop: died ? uncle.life : adult, outcome: died ? 'died' : childEnd(R(U_END), uncle.born, adult), leanings: leanings(), uncle: { k: f!.k, s: uncle.s } };
  }
  // 部落没有大臣(按这一刻以前的国号:同一刻稍后才升格的不算,接着推时看到的也一样)
  if (polityTierAt(P, t - 1 / (2 * TICK)) < 1) return null;
  const born = q(t - lerp(MINISTER_AGE, R(U_AGE)));
  return { kind: 'minister', born, stop: adult, outcome: childEnd(R(U_END), born, adult), leanings: leanings() };
}

/** 看王朝那一刻(t)出不出权臣:机会、大臣还是大将(都是 0–1 的随机数) */
export function strongRolls(cx: RegencyCtx, pid: number, t: Year): { u: number; kind: number } {
  const key = Math.round(t * TICK);
  return { u: rnd(cx, pid, key, U_STRONG, K_STRONG), kind: rnd(cx, pid, key, U_KIND, K_STRONG) };
}

/** 大臣、大将 t 那一刻掌权:到哪一刻、结局、生年、倾向 */
export function strongPlan(cx: RegencyCtx, pid: number, kind: 'chancellor' | 'general', t: Year): Omit<ChildPlan, 'kind' | 'uncle'> {
  const P = cx.polities[pid];
  const key = Math.round(t * TICK);
  const R = (use: number) => rnd(cx, pid, key, use, K_STRONG);
  const u = R(U_END);
  const outcome: RegencyOutcome =
    kind === 'general' ? (u < GENERAL_PURGE ? 'purge' : 'died') : u < CHANCELLOR_END[0] ? 'usurp' : u < CHANCELLOR_END[0] + CHANCELLOR_END[1] ? 'purge' : 'died';
  const born = q(t - lerp(STRONG_AGE, R(U_AGE)));
  const stop = q(t + lerp(STRONG_LEN, R(U_LEN)));
  return {
    // 篡位的不等过 USURP_AGE 岁(掌权时最多 STRONG_AGE[1] 岁,到那时至少还有几年)
    stop: outcome === 'usurp' ? Math.min(stop, born + USURP_AGE) : stop,
    outcome,
    born,
    leanings: drawLeanings((use) => rnd(cx, pid, key, use, K_STRONG_LEAN), P.lineage, P.kind, kind === 'general' ? { war: GENERAL_WAR } : undefined),
  };
}

/** 摄政的叔父 t 那一刻篡位:不被打断时在位到哪年(至少一年,到 MAX_AGE 岁为止) */
export function seizeUntil(cx: RegencyCtx, g: Regency, t: Year): Year {
  const u = rnd(cx, g.pid, g.k * 16 + 1, U_REIGN, K_REIGN);
  const L = 1 + SEIZE_REIGN * fpow(u, 1.3);
  return q(Math.max(t + 1, Math.min(t + L, g.born + MAX_AGE)));
}

/**
 * kind 这一种、名义君主在位表第 k 位、t 那一刻掌权的一段(和推演里那一刻定的一样;对不上 = null)。
 * marched 见 childPlan;annal = 掌权那一条史事的下标
 */
export function makeRegency(cx: RegencyCtx, pid: number, kind: RegencyKind, k: number, t: Year, marched: (k: number) => boolean, annal: number): Regency | null {
  const P = cx.polities[pid];
  if (!P) return null;
  const base = { pid, kind, k, start: t, dyn: dynastyAtTick(P, t), closed: false, annal };
  if (kind === 'march' || kind === 'heir') {
    const r = cx.book(pid, t)[k];
    const c = r && latePlans(cx, pid, r).find((x) => x.kind === kind && x.t === t);
    if (!c) return null;
    return { ...base, stop: Infinity, born: c.born, leanings: c.leanings, eff: leaningEffect(c.leanings) };
  }
  if (kind === 'uncle' || kind === 'minister') {
    const r = cx.book(pid, t)[k];
    const c = r && childPlan(cx, pid, r, marched);
    if (!c || c.kind !== kind) return null;
    const g: Regency = { ...base, stop: c.stop, outcome: c.outcome, born: c.born, leanings: c.leanings, eff: leaningEffect(c.leanings) };
    if (c.uncle) g.uncle = c.uncle;
    return g;
  }
  const c = strongPlan(cx, pid, kind, t);
  return { ...base, stop: c.stop, outcome: c.outcome, born: c.born, leanings: c.leanings, eff: leaningEffect(c.leanings) };
}

/** 作者下令"让他掌权"的一条 */
export type RegentIv = Extract<Intervention, { kind: 'regent' }>;
/**
 * 让他掌权没生效时史事 intervene 的 b 列(别的同 rulers.ts:−2 他还没出生(作者的人物)、−3 那一年这国已亡、−4 他不是那样的人):
 * −11 那一刻已有人掌着权;−12 共和国、在位的是作者立的君主(不会被架空);−19 他那时已去世(作者的人物,照干预里抄的卒年)
 */
export const IV_HELD = -11;
export const IV_NO_THRONE = -12;
export const IV_GONE = -19;
/** 让他掌权:宗室要到这么多岁 */
export const IV_REGENT_AGE = 16;

/**
 * 让作者的人物掌权(干预带 char)t 那一刻起到哪一刻、怎么了结:给了还政年数 = t + years 还政;没给 = 到卒年(died 那一年年初,卒于位);
 * 卒年也没有 = 到他 AUTHOR_REGENT_AGE_END 岁还政(至少一年);卒年早于还政的,到卒年为止
 */
export function authorRegentEnd(v: AuthorRegentIv, t: Year): { stop: Year; outcome: RegencyOutcome } {
  const back = v.years !== undefined ? q(t + v.years) : v.died === undefined ? q(Math.max(t + 1, v.born + AUTHOR_REGENT_AGE_END)) : Infinity;
  return v.died !== undefined && v.died <= back ? { stop: v.died, outcome: 'died' } : { stop: back, outcome: 'return' };
}

/** 作者下令"让作者的人物掌权"的一条 */
export type AuthorRegentIv = Extract<RegentIv, { char: number }>;

/**
 * 作者下令"让他掌权"(干预第 iv 条)t 那一刻、名义君主 r(此刻在位的)的这一段;他对不上 = null:
 *   引兵入朝、太子监国:他得是 r 的预定继承人(royals.ts 的 heir,按人物键里的生年认),倾向照他日后即位时的(和推演里自己出的一样);
 *   摄政:他得是同一朝先前几位君主的儿子(不是预定继承人的那几个,royals.ts 的 extra),在世;
 *   专权:名臣、将领的生年照人物键。摄政、专权的倾向照干预里写的。都要年过 IV_REGENT_AGE 岁。
 *   作者的人物(干预带 char):照名臣、将领的专权,生年、性格照干预里抄的;那一刻还没出生、已去世(卒年照干预)= null。
 * 到期(还政、篡位)= t + years;到君主去世即位 = 不到期(跟着名义君主了结);作者的人物见 authorRegentEnd
 */
export function ivRegency(cx: RegencyCtx, pid: number, v: RegentIv, iv: number, r: Reign, t: Year, annal: number): Regency | null {
  const P = cx.polities[pid];
  if (!P) return null;
  if (v.char !== undefined) {
    if (v.born > t || (v.died !== undefined && v.died <= t) || t - v.born < IV_REGENT_AGE) return null;
    return { pid, kind: v.how, k: r.k, start: t, dyn: dynastyAtTick(P, t), closed: false, annal, iv, ...authorRegentEnd(v, t), born: v.born, leanings: v.leanings, eff: leaningEffect(v.leanings) };
  }
  const who = parsePersonKey(v.person);
  if (!who) return null;
  const base = { pid, kind: v.how, k: r.k, start: t, dyn: dynastyAtTick(P, t), closed: false, annal, iv };
  const stop = v.end === 'succeed' ? Infinity : q(t + (v.years ?? 1));
  const outcome: RegencyOutcome | undefined = v.end === 'succeed' ? undefined : v.end === 'return' ? 'return' : 'usurp';
  const tail = (born: Year, leanings: RulerLeanings) => (t - born < IV_REGENT_AGE ? null : { stop, ...(outcome ? { outcome } : {}), born, leanings, eff: leaningEffect(leanings) });
  if (v.how === 'march' || v.how === 'heir') {
    const hb = broodOf(cx.rbase, cx.tag[pid], r, P).heir;
    if (hb === undefined || Math.round(hb) !== who.born) return null;
    const rest = tail(hb, reignStep(cx.rbase, cx.tag[pid], r.k + 1, r.j + 1, r.natural, segLineage(P, r.dynasty), P.kind).leanings);
    return rest && { ...base, ...rest };
  }
  const lean = v.leanings ?? { expand: 50, war: 50, develop: 50, trade: 50 };
  if (v.how === 'uncle') {
    // 君主的兄弟叔伯:同一朝先前几位君主没即位的儿子
    const book = cx.book(pid, t);
    for (let k = r.k - 1; k >= 0 && book[k] && book[k].dynasty === r.dynasty; k--) {
      if (book[k].crown) continue;
      const x = broodOf(cx.rbase, cx.tag[pid], book[k], P).extra.find((e) => Math.round(e.born) === who.born);
      if (!x) continue;
      const rest = x.life > t ? tail(x.born, lean) : null;
      return rest && { ...base, ...rest, uncle: { k, s: x.s } };
    }
    return null;
  }
  const rest = tail(who.born, lean);
  return rest && { ...base, ...rest };
}

/** 史事里掌实权的几段(regent)→ 国家 → 按掌权先后(接着推、排人物时用;和推演时登记的一样) */
export function regentsFrom(cx: RegencyCtx, annals: readonly Annal[]): Map<number, Regency[]> {
  const out = new Map<number, Regency[]>();
  annals.forEach((e, idx) => {
    if (e.kind !== 'regent') return;
    const list = out.get(e.a);
    if ((e.n ?? RG_START) !== RG_START) {
      const g = list?.[list.length - 1];
      if (g) g.closed = true;
      return;
    }
    const kind = REGENCY_KINDS[e.b];
    if (!kind) return;
    // 作者下令"让他掌权"的(foe 列记着第几条干预)
    const v = e.foe !== undefined ? cx.ivs?.[e.foe] : undefined;
    const r = v?.kind === 'regent' ? cx.book(e.a, e.year)[e.war] : undefined;
    const g =
      v?.kind === 'regent'
        ? r
          ? ivRegency(cx, e.a, v, e.foe!, r, e.year, idx)
          : null
        : makeRegency(cx, e.a, kind, e.war, e.year, (k) => !!list?.some((x) => x.kind === 'march' && x.k === k), idx);
    if (!g) return;
    if (list) list.push(g);
    else out.set(e.a, [g]);
  });
  return out;
}

/**
 * 两国宗室联姻 —— 纯计算的那一半:调参、娶亲的是谁、由史事推出结过的亲、两国结着亲的分量、君主的母亲出自哪国。
 * 推演里什么时候结亲在 marriage.ts;人物里的"配偶""母亲"在 people.ts 按这里挂(宗室女不成完整人物,只记一行)。
 *
 * **谁娶谁**:娶亲的一方挑未成婚的成年太子(预定的继承人,GROOM_AGE 岁之间),没有就挑年轻(不过 YOUNG_RULER 岁)的在位君主,
 *   再没有就挑别的成年宗室(royals.ts 的诸子;先君晚年引兵入朝过的不挑,他们那时被杀过一轮);嫁过来的是对方在位君主的女儿
 *   (那位君主至少 BRIDE_FATHER 岁)。史事 marry 的 n 列记娶亲的是谁:那时在位的君主在在位表里第几位 × 16 + 第几个儿子(groomBorn)。
 * **对邦交的加成**(分量 bond:刚结亲 = 1,KIN_FADE 年里淡到 0;那以后两国开过战 = 0,姻亲就此断了):
 *   宣战赔率 × (1 − (1 − KIN_DECLARE) × 分量);挑盟友时分数 × (1 + (KIN_PACT − 1) × 分量);援盟的机会 × (1 + (KIN_JOIN − 1) × 分量);
 *   背盟去打的赔率 × (1 − (1 − KIN_BETRAY) × 分量)。方针里把对方定为仇国的照旧(方针的倍数另乘)。
 * **母亲**:娶亲以后生的儿子,母亲就是这位宗室女;他即位以后在位期间对舅家宣战的赔率再 × UNCLE_DECLARE。纯计算。
 */
import type { Annal, Polity, Year } from './types';
import { reignBorn, type Reign } from './rulers';
import { broodOf } from './royals';

// ---- 调参(推荐值,按 20 个种子的统计调) ----
/**
 * 看邦交时结亲的机会:每个合格的亲家 MARRY_PER,最多 MARRY_MAX;挑中的是盟国再加 MARRY_ALLY。
 * (起初定的 10%、最多 30%:各国接壤的邻国不多,一次看邦交平均不到两个合格的亲家,种子 7 只结了二十来门;调到 30%、最多 60%)
 */
export const MARRY_PER = 0.3;
export const MARRY_MAX = 0.6;
export const MARRY_ALLY = 0.15;
/** 互嫁的机会(对方的太子同时娶这边的宗室女) */
export const MUTUAL = 0.25;
/** 议和时以和亲作结的机会 */
export const PEACE_MATCH = 0.2;
/** 结亲的加成(见文件头)和淡回的年数 */
export const KIN_DECLARE = 0.4;
export const KIN_FADE = 40;
export const KIN_PACT = 3;
export const KIN_JOIN = 1.3;
export const KIN_BETRAY = 0.5;
/** 君主对舅家宣战的赔率倍数 */
export const UNCLE_DECLARE = 0.6;
/** 娶亲的宗室、太子的年纪;年轻的在位君主不过这么多岁;嫁女的君主至少这么多岁 */
export const GROOM_AGE: [number, number] = [16, 40];
export const YOUNG_RULER = 30;
export const BRIDE_FATHER = 30;
/** n 列里"君主本人" */
export const GROOM_SELF = 15;

/**
 * 为他联姻(干预)没生效时史事 intervene 的 b 列(别的同 rulers.ts:−3 那一年这国已亡、−4 他不是能娶亲的宗室;
 * regents.ts:−12 有一国是共和国):−13 对方那一年没有 / 已亡;−14 两国正在交战;−15 嫁女的那国在位的君主不到 BRIDE_FATHER 岁(没有成年的女儿);
 * −16 本国宗室女嫁过去、对方没有能娶亲的人
 */
export const IV_NO_PARTNER = -13;
export const IV_AT_WAR = -14;
export const IV_NO_BRIDE = -15;
export const IV_NO_GROOM = -16;

/** 一门亲 */
export interface Match {
  t: Year;
  /** 娶亲的国家、嫁女的国家 */
  a: number;
  b: number;
  /** 娶亲的人:生年、史事 n 列的写法(在位表第几位 × 16 + 第几个儿子) */
  born: Year;
  code: number;
  /** 议和时以和亲作结:那场战争;别的 = −1 */
  war: number;
  /** 那条史事 marry 的下标 */
  annal: number;
}

/** 推算要用的那几样(和 regents.ts 的 RegencyCtx 同一份) */
export interface MatchCtx {
  rbase: number;
  tag: readonly number[];
  polities: readonly Polity[];
  book: (pid: number, t: Year) => readonly Reign[];
}

/** 君主 r 的第 s 个儿子(0 = 预定的继承人,GROOM_SELF = 他本人;别的是 royals.ts 的 Brood.extra 的 s)的生年;对不上 = undefined */
export function groomBorn(cx: MatchCtx, pid: number, r: Reign, s: number): Year | undefined {
  if (s === GROOM_SELF) return reignBorn(r);
  const br = broodOf(cx.rbase, cx.tag[pid], r, cx.polities[pid]);
  if (s === 0) return br.heir;
  return br.extra.find((x) => x.s === s)?.born;
}

/** 史事里结的亲(marry)→ 按先后(接着推、排人物时用;和推演时登记的一样) */
export function matchesFrom(cx: MatchCtx, annals: readonly Annal[]): Match[] {
  const out: Match[] = [];
  annals.forEach((e, annal) => {
    if (e.kind !== 'marry' || e.n === undefined) return;
    const r = cx.book(e.a, e.year)[e.n >> 4];
    const born = r && groomBorn(cx, e.a, r, e.n & 15);
    if (born === undefined) return;
    out.push({ t: e.year, a: e.a, b: e.b, born, code: e.n, war: e.war, annal });
  });
  return out;
}

/** 两国(无序)的键 */
export const kinKey = (a: number, b: number) => Math.min(a, b) * 32768 + Math.max(a, b);

/**
 * 两国结着亲的分量(见文件头):list = 这两国之间的几门亲(按先后),fought(t0) = 两国 t0 以后(到此刻)开过战。没有 = 0
 */
export function bondOf(list: readonly Match[] | undefined, t: Year, fought: (t0: Year) => boolean): number {
  if (!list) return 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (!(m.t < t)) continue;
    const age = t - m.t;
    if (age >= KIN_FADE || fought(m.t)) return 0;
    return 1 - age / KIN_FADE;
  }
  return 0;
}

/** 娶亲的人(国家 pid、生年 born)在 before 以前结的最后一门亲(没有 = undefined):他那以后生的儿子,母亲就是她 */
export function lastMatch(list: readonly Match[] | undefined, pid: number, born: Year, before: Year): Match | undefined {
  if (!list) return undefined;
  let hit: Match | undefined;
  for (const m of list) if (m.a === pid && m.born === born && m.t < before) hit = m;
  return hit;
}

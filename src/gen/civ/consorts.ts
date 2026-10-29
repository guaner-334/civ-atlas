/**
 * 后妃(Person.role = 'consort'):联姻嫁来的宗室女、临朝的太后。都只是给推演里已经有的事配上人,历史一点不变:
 *
 * **嫁来的宗室女**:每一门亲(marriages.ts)嫁过来的那位都成一位人物(娶亲的是女的、是作者立的君主的不算:她那边只记一行)。
 *   出自哪国、父亲(那一刻那国在位的君主,世系连在他名下)、丈夫照那门亲;生年照结亲那年和她父亲的年纪排(结亲时 BRIDE_AGE 岁,
 *   她出生时父亲 PARENT_AGE 岁之间),寿数 LIFE(至少活到结亲的下一年);都只看结亲那一刻定得下来的事,和推到哪一年无关。
 *   丈夫娶她以后、下一门亲以前生的儿子(royals.ts 的诸子),生在她 FERTILE 岁之间、她在世时的,母亲记成她(Person.mom)。
 * **临朝的太后**:推演里名臣辅政的那一段(regents.ts,幼主即位那一刻起),按语感有 DOWAGER 的机会换成幼主的母亲临朝 ——
 *   什么时候开始、照谁的倾向办事、怎么了结(还政、伏诛、篡位)都不变,只是掌权的人换成了她;名臣那边不再为这一段起人。
 *   生年就是推演里掌权的人的生年(篡位开国的新君也是这个生年),所以幼主要生在她 FERTILE 岁之间才换。
 *   幼主的母亲本来就是嫁来的宗室女的,太后就是她本人:生年、寿数照她自己的,幼主要生在她 FERTILE 岁之间、她要活过原定还政的那一年才换
 *   (篡位开国的不换:新朝的生年、姓对不上她)。
 *   丈夫 = 幼主的父亲:出道时就定了是女的(women.ts 的 debutSex)不安排太后;出道时定不下来的(继位的君主要按世系认),
 *   people.ts 让他保持是男的。伏诛的那一刻卒;别的寿数 LIFE,至少活到原定还政的下一年。
 *   篡位的:她就是新朝的第一位(和名臣篡位一样并成一人),女君。
 * 随机数:keyed4(subSeed(seed, 'civ-consort'), 国家的位置锚, 那一刻, 身份, 用途) —— 只看结亲 / 掌权那一刻定得下来的事,
 * 接着往后推、后面的年份干预以后重推,先前的后妃不变。名字在 women.ts 和别的女性一起起。纯计算,不碰 DOM。
 */
import { keyed4, subSeed } from './rand';
import type { Year } from './types';

// ---- 调参 ----
/** 当母亲的岁数(同 women.ts 的 FERTILE) */
export const FERTILE: [number, number] = [16, 45];
/** 嫁过来时的岁数 */
const BRIDE_AGE: [number, number] = [15, 22];
/** 嫁过来时至少这么大;她出生时父亲这么大(同世系里连父子的年纪,lineage.ts) */
const BRIDE_MIN = 14;
const PARENT_AGE: [number, number] = [16, 55];
/** 寿数 */
const LIFE: [number, number] = [42, 82];
/** 名臣辅政换成太后临朝的机会(按语感:中原像史书,太后临朝常见) */
const DOWAGER: Record<string, number> = { central: 0.6, frontier: 0.5, western: 0.5, xianxia: 0.4, mythic: 0.4 };

// ---- 随机数的身份、用途 ----
/** 身份(keyed4 的第四位):嫁来的宗室女、太后(起名也用这两个数,接在 women.ts 的身份后面) */
export const K_BRIDE = 5;
export const K_DOWAGER = 6;
const U_PICK = 0;
const U_AGE = 1;
const U_LIFE = 2;
const U_HOME = 3;
/** 太后的姓(和夫家不同姓):第几次试 */
export const U_SURNAME = 8;

const TICK = 256;
const q = (x: number) => Math.round(x * TICK) / TICK;
const qi = (x: number) => Math.round(x * TICK);
const lerp = (r: [number, number], u: number) => r[0] + (r[1] - r[0]) * u;

const groupOf = (style: string) => (style === 'central' || style === 'xianxia' || style === 'frontier' || style === 'mythic' ? style : 'western');

export interface ConsortRand {
  /** 一门亲 / 一段临朝的随机数:国家的位置锚、那一刻、身份、用途 */
  (tag: number, t: Year, kind: number, use: number): number;
}

export function consortRand(seed: number): ConsortRand {
  const base = subSeed(seed, 'civ-consort');
  return (tag, t, kind, use) => keyed4(base, tag, qi(t), kind * 16 + use, 0);
}

/**
 * 嫁来的宗室女的生年:结亲那年 t 时 BRIDE_AGE 岁,夹在父亲 PARENT_AGE 岁之间、t − BRIDE_MIN 以前
 * (丈夫娶她以后生的儿子,生在她 FERTILE 岁之间、她在世时的才记她是母亲)
 */
export function brideBorn(R: ConsortRand, tag: number, t: Year, fatherBorn: Year | undefined): Year {
  const lo = fatherBorn !== undefined ? fatherBorn + PARENT_AGE[0] : -Infinity;
  const hi = Math.min(t - BRIDE_MIN, fatherBorn !== undefined ? fatherBorn + PARENT_AGE[1] : Infinity);
  const born = t - lerp(BRIDE_AGE, R(tag, t, K_BRIDE, U_AGE));
  return q(Math.min(hi, Math.max(lo, born)));
}

/** 她能不能是这个孩子的母亲(孩子生在她 FERTILE 岁之间、她在世时) */
export function bears(born: Year, died: Year | undefined, kid: Year): boolean {
  return kid - born >= FERTILE[0] && kid - born <= FERTILE[1] && (died === undefined || kid <= died);
}

/**
 * 卒年(不管推到哪一年;people.ts 再按结束年份截掉):生年 + LIFE,至少到 floor(结亲 / 掌权的下一年、原定还政的下一年)。
 * key = 结亲 / 掌权那一刻,kind = 身份
 */
export function consortDeath(R: ConsortRand, tag: number, key: Year, kind: number, born: Year, floor: Year): Year {
  return q(Math.max(born + lerp(LIFE, R(tag, key, kind, U_LIFE)), floor));
}

/** 名臣辅政(幼主即位那一刻 t 起)换不换成太后:按语感的机会(幼主要生在她 FERTILE 岁之间另看,见 bears) */
export function isDowager(R: ConsortRand, tag: number, t: Year, style: string): boolean {
  return R(tag, t, K_DOWAGER, U_PICK) < (DOWAGER[groupOf(style)] ?? 0.5);
}

/** 太后籍贯的随机数(officials.ts 的 resolveHomes 用) */
export function dowagerHomeU(R: ConsortRand, tag: number, t: Year): number {
  return R(tag, t, K_DOWAGER, U_HOME);
}


/** 东方的姓:换一个和 avoid 不同的(第 0–19 次试) */
export function otherSurname(surname: (t: number) => string, avoid: string): string {
  let sur = '';
  for (let t = 0; !sur || (sur === avoid && t < 20); t++) sur = surname(t);
  return sur;
}

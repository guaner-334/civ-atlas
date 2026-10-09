/**
 * 君主的在位表和性格:推演(polities.ts 的扩张算账、wars.ts 的议和)和人物(people.ts)用同一份,
 * 推演里"哪一位在位、他是什么性格"和人物页上写的一字不差。
 *
 * **在位表**:每个国家从立国起一朝接一朝(Polity.dynasties;没改朝换代过 = 立国那一朝),每一朝里一位接一位:
 *   即位的年纪、在位多少年按"国家的位置锚 + 第几位"随机取(keyed4),一生不超过 MAX_AGE 岁;共和国的执政官任期短。
 *   一位在位到"不被打断时的年份"(natural),这一朝先结束(改朝换代)就在那一刻让位给新朝的第一位。
 *   第几位(k)按全国从 0 编起、跨朝连续 —— 和 people.ts 排人物的编号一样,随机数也就一样。
 *   全是由"立国年份 + 改朝换代的年份"算出来的,不存进 Civ,接着推(CivSim.fromCiv)时照样算得出。
 * **推演里的"此刻在位"**(reignAt):改朝换代那一刻(同一个时刻)还算旧君在位,下一刻起才是新朝的第一位 ——
 *   这样同一时刻里改朝换代和别的事谁先谁后,算出来的都一样(fromCiv 按日志重放时也能算出同样的结果)。
 *   同一朝里的交接没有这个问题(交接的年份是算出来的,不是事件)。
 * **性格**(RulerTrait;不是每位都有,寻常的君主不给):
 *   - martial 好战:不太计较划不划算,荒僻之地也去占;打起仗来不轻易罢兵;有时亲征
 *   - steady 守成:只要富庶、离国都近的地方;仗打不了多久就想议和
 *   - mercantile 重商:看重沿海、大河、港口,内陆的荒地不大想要
 *   每位的性格按"国家的位置锚 + 第几位"随机取;游牧国家的君主更多好战,海洋国家、城邦共和的执政官更多重商。
 *   性格只是一个人的事:同一家里父子可以完全不同。
 *
 * 随机数:keyed4(subSeed(seed, 'civ-people'), 国家的位置锚, 第几位, 用途, 0),和 people.ts 同一套(位置锚 = 立国时国都的地块
 * + 这块地上第几个立国,见 rulerTags)。纯计算,不碰 DOM。
 */
import type { CultureKind, Polity, PolityLineage, RulerTrait, Year } from './types';

export type { RulerTrait };
import { anchorTag, fpow, keyed4, subSeed } from './rand';

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

/** 性格的比例(其余是寻常的君主):[好战, 守成, 重商] */
const TRAIT_SHARE: Record<'default' | 'nomad' | 'sea' | 'republic', [number, number, number]> = {
  default: [0.25, 0.3, 0.12],
  nomad: [0.42, 0.2, 0.05],
  sea: [0.2, 0.25, 0.3],
  republic: [0.08, 0.3, 0.45],
};

/**
 * 性格对推演的影响(寻常的君主全是 1 / 0):
 * - worth / coast:扩张算账的门槛倍数(内陆 / 沿海、大河、港口的州),越小越不计较划不划算(polities.ts 的 wants)
 * - war:一场仗最多打多少年(厌战)的倍数;goal:这场仗想拿下几州多几州(wars.ts 的议和)
 * - sue:打得很惨时奉表称臣的机会倍数(diplomacy.ts)
 */
export interface TraitEffect {
  worth: number;
  coast: number;
  war: number;
  goal: number;
  sue: number;
}
const PLAIN: TraitEffect = { worth: 1, coast: 1, war: 1, goal: 0, sue: 1 };
export const TRAIT_EFFECT: Record<RulerTrait, TraitEffect> = {
  martial: { worth: 0.55, coast: 0.55, war: 1.35, goal: 2, sue: 0.6 },
  steady: { worth: 1.7, coast: 1.7, war: 0.7, goal: -1, sue: 1.5 },
  mercantile: { worth: 1.35, coast: 0.7, war: 0.85, goal: 0, sue: 1.2 },
};

export function traitEffect(trait: RulerTrait | undefined): TraitEffect {
  return trait ? TRAIT_EFFECT[trait] : PLAIN;
}

// 随机数用途(和 people.ts 共用一套编号:1、2 是年纪、在位年数)
export const U_AGE = 1;
export const U_REIGN = 2;
const U_TRAIT = 14;
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
export type ReignPolity = Pick<Polity, 'founded' | 'dynasties' | 'lineage' | 'kind'>;

/** 第 k 位君主(这一朝第 j 位)从 from 年即位:即位的年纪、不被打断时在位到哪年、性格 */
export function reignStep(
  base: number,
  tag: number,
  k: number,
  j: number,
  from: Year,
  lineage: PolityLineage | undefined,
  kind: CultureKind,
): { age: number; natural: Year; trait: RulerTrait | undefined } {
  const R = (use: number) => keyed4(base, tag, k, use, K_RULER);
  const republic = lineage === 'republic';
  let A: number;
  let L: number;
  if (republic) {
    A = lerp(CONSUL_AGE, R(U_AGE));
    L = lerp(TERM, R(U_REIGN));
  } else {
    A = j === 0 ? lerp(FOUNDER_AGE, R(U_AGE)) : HEIR_AGE[0] + (HEIR_AGE[1] - HEIR_AGE[0]) * fpow(R(U_AGE), HEIR_EXP);
    L = 1 + REIGN_MAX * fpow(R(U_REIGN), REIGN_EXP);
  }
  if (A + L > MAX_AGE) L = Math.max(1, MAX_AGE - A);
  const share = TRAIT_SHARE[republic ? 'republic' : kind === 'nomad' ? 'nomad' : kind === 'sea' ? 'sea' : 'default'];
  const u = R(U_TRAIT);
  const trait: RulerTrait | undefined = u < share[0] ? 'martial' : u < share[0] + share[1] ? 'steady' : u < share[0] + share[1] + share[2] ? 'mercantile' : undefined;
  return { age: A, natural: q(from + L), trait };
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
  trait: RulerTrait | undefined;
}

/**
 * 推演里按"此刻"排好的在位表(按国家对象缓存;改朝换代了,Polity.dynasties 变长,就重排)。
 * 最后一朝只排到够用为止(在位到 upTo 以后的那一位),要更晚的再往后排
 */
interface Book {
  tag: number;
  dyn: number;
  reigns: Reign[];
  /** 最后一朝排到哪了:下一位的 j、即位年份 */
  j: number;
  from: Year;
}
const books = new WeakMap<ReignPolity, Book>();

/** 国家 p(位置锚 tag)的在位表,保证排到 t 时在位的那一位(和他之后不被打断时的下一位的即位年份) */
export function reignBook(base: number, tag: number, p: ReignPolity, t: Year): readonly Reign[] {
  const segs = p.dynasties?.length ? p.dynasties : null;
  const dyn = segs ? segs.length : 1;
  let b = books.get(p);
  if (!b || b.dyn !== dyn || b.tag !== tag) {
    b = { tag, dyn, reigns: [], j: 0, from: p.founded };
    books.set(p, b);
    // 前面几朝整朝排完
    for (let i = 0; i + 1 < dyn; i++) {
      const end = segs![i + 1].year;
      let from = i === 0 ? p.founded : segs![i].year;
      for (let j = 0; ; j++) {
        const s = reignStep(base, tag, b.reigns.length, j, from, p.lineage, p.kind);
        b.reigns.push({ k: b.reigns.length, dynasty: i, j, from, age: s.age, natural: s.natural, trait: s.trait });
        if (!(s.natural < end)) break;
        from = s.natural;
      }
    }
    b.j = 0;
    b.from = dyn > 1 ? segs![dyn - 1].year : p.founded;
  }
  // 最后一朝:排到 natural > t
  while (true) {
    const last = b.reigns[b.reigns.length - 1];
    if (last && last.dynasty === dyn - 1 && last.natural > t) break;
    const s = reignStep(base, tag, b.reigns.length, b.j, b.from, p.lineage, p.kind);
    b.reigns.push({ k: b.reigns.length, dynasty: dyn - 1, j: b.j, from: b.from, age: s.age, natural: s.natural, trait: s.trait });
    b.j++;
    b.from = s.natural;
  }
  return b.reigns;
}

/** 这一位从哪一刻起算"在位"(推演里):新朝的第一位从改朝换代的下一刻起(见文件头),其余从即位那一刻 */
export function reignStart(r: Reign): Year {
  return r.j === 0 && r.dynasty > 0 ? r.from + 1 / TICK : r.from;
}

/** 推演里 t 这一刻在位的君主(下标 = Reign.k);t 早于立国 = 第一位 */
export function reignAt(base: number, tag: number, p: ReignPolity, t: Year): Reign {
  const list = reignBook(base, tag, p, t);
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (reignStart(list[mid]) <= t) lo = mid;
    else hi = mid - 1;
  }
  return list[lo];
}

/**
 * 将门、世家:将领、名臣父子相承。people.ts(将领)、officials.ts(名臣)排好人以后、起名以前调用,只定"谁是谁的孩子",
 * 生卒、领的兵、经手的事一样不改(推演里本来就没有这层关系,和 lineage.ts 一样是事后按年纪认的)。
 *
 * 起一位新将领(名臣)时,有 HEIR 的机会是本国先前一位将领(名臣)的孩子:比他早出道、生他时 PARENT_AGE 岁之间、
 * 他出生时还在世、名下当了将领(名臣)的孩子还不到 MAX_KIDS 个;几位都合适的,出道以前领兵(经手大事)多的机会大些 ——
 * 名将之后更常见。将领只接将领、名臣只接名臣(掌实权专门起的名臣不算,见 officials.ts)。一代代接下去,就有三代为将、
 * 父子相继为相。孩子随父姓(东方带姓的语感;别的语感名字不带姓,照旧)、籍贯同父亲(people.ts、officials.ts 照这里的结果改)。
 * PARENT_AGE 落在女性能生育的岁数里:父亲后来换成女的(women.ts)也说得通,就写"其母"。
 *
 * 只看他出道那一刻以前的人(先出道的才能做父亲),随机数只看他自己:接着往后推、在后面的年份干预以后重推,
 * 先出道的人父子关系不变。纯计算,不碰 DOM。
 */
import type { Person, Year } from './types';
import { subSeed } from './engine/rand';
import { defineKnobs, type KnobSet } from './engine/knobs';

// ---- 调参 ----
/** 这一段的旋钮(名字、官方的值;推演照这个世界的那套数算,见 engine/knobs.ts) */
export const KIN_KNOBS = defineKnobs('kin', {
  /** 父辈生他时的岁数 */
  PARENT_AGE: [20, 42] as [number, number],
  /** 一位父辈名下最多几个孩子当了将领(名臣) */
  MAX_KIDS: 2,
  K_HOUSE_GENERAL: 0,
  K_HOUSE_MINISTER: 1,
});
/** 有合适的父辈时,新出道的将领、名臣是他孩子的机会 */
export const HEIR = { general: 0.32, minister: 0.36 } as const;

// 随机数:keyed4(houseBase(seed), 国家的位置锚, 键, 用途, 种类)。将领的键 = 本国第几位将领;名臣照 officials.ts 的键(第几朝、起他的那一年和缘由)
export const houseBase = (seed: number) => subSeed(seed, 'civ-kin');
// 用途(u 的参数)
const U_HEIR = 0;
const U_PICK = 1;

/** 一位候选的人:出道那一刻、卒年(还在世 = Infinity)、出道以前的功劳(领过几仗、经手几件事)、他自己的随机数 */
export interface HouseCand {
  x: Person;
  debut: Year;
  died: Year;
  /** t 这一刻以前他的功劳(挑父辈时按 1 + 它加权) */
  merit: (t: Year) => number;
  u: (use: number) => number;
}

/**
 * 按出道先后一位位看(同一国里,先出道的才能做父亲):孩子 → 父辈。
 * list 里各国混在一起也行,会按出道先后(一样早的照原来的次序)排。knobs = 这个世界的那套数
 */
export function pickHouses(knobs: KnobSet, list: readonly HouseCand[], rate: number): Map<Person, Person> {
  const { PARENT_AGE, MAX_KIDS } = knobs.get(KIN_KNOBS);
  const out = new Map<Person, Person>();
  const kids = new Map<Person, number>();
  const seen = new Map<number, HouseCand[]>();
  const order = list.map((c, k) => ({ c, k })).sort((a, b) => a.c.debut - b.c.debut || a.k - b.k);
  for (const { c } of order) {
    const pid = c.x.polity;
    let prev = seen.get(pid);
    if (!prev) seen.set(pid, (prev = []));
    if (c.u(U_HEIR) < rate) {
      const fits = prev.filter((f) => {
        const age = c.x.born - f.x.born;
        return f.debut < c.debut && age >= PARENT_AGE[0] && age <= PARENT_AGE[1] && c.x.born <= f.died && (kids.get(f.x) ?? 0) < MAX_KIDS;
      });
      if (fits.length) {
        const w = fits.map((f) => 1 + f.merit(c.debut));
        let t = c.u(U_PICK) * w.reduce((a, b) => a + b, 0);
        let pick = fits[fits.length - 1];
        for (let i = 0; i < fits.length; i++) {
          t -= w[i];
          if (t < 0) {
            pick = fits[i];
            break;
          }
        }
        out.set(c.x, pick.x);
        kids.set(pick.x, (kids.get(pick.x) ?? 0) + 1);
      }
    }
    prev.push(c);
  }
  return out;
}

/**
 * 孩子随父姓:起名函数 at(第 a 次试的名字)换成父辈的姓 + 原来那一次的名(父辈的名字在他之前起好,调用时现读);
 * surnameOf = 名字里的姓(peopleText.ts 的 splitSurname)
 */
export function withParentSurname(at: (a: number) => string, parent: Person, surnameOf: (name: string) => string): (a: number) => string {
  return (a) => {
    const own = at(a);
    return surnameOf(parent.name) + own.slice(surnameOf(own).length);
  };
}

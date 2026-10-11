/**
 * 文明叠加层 · 藩属:地图上看得出谁是谁的藩属(邦交本身见 gen/civ/diplomacy.ts)。
 *
 * - 色块:藩属的颜色往宗主的颜色靠 VASSAL_TINT(territory.ts 铺国土时换用 vassalColors),
 *   一眼看出是宗主的势力范围,又还认得出是另一个国家。隔海称臣、不接壤的藩属也一样。
 * - 国界:宗主和藩属之间不画国界的粗线,换成一道细点线(borders.ts 的 drawBorders、地球仪的 globeLines.ts)。
 * 只管"国家"这一层;民族、信仰图层不变。盟约不上地图(国家面板里写)。
 */
import type { Civ, Year } from '../../gen/civ/types';
import { relationsAt } from '../../gen/civ/diplomacy';

/** 藩属的颜色往宗主那边靠多少(0 = 本色,1 = 和宗主一样) */
export const VASSAL_TINT = 0.6;

export interface VassalTies {
  /** 藩属 → 宗主 */
  liege: Map<number, number>;
  /** 这一刻有哪几对宗藩(缓存的键;没有 = 空串) */
  key: string;
}

const memo = new WeakMap<Civ, { year: Year; ties: VassalTies }>();

/** year 那一刻的宗藩(同一个 civ、同一年只推一次:国界、色块、地球仪共用) */
export function vassalTies(civ: Civ, year: Year): VassalTies {
  const hit = memo.get(civ);
  if (hit && hit.year === year) return hit.ties;
  const liege = new Map<number, number>();
  for (const [v, x] of relationsAt(civ, year).liege) liege.set(v, x.liege);
  const ties = { liege, key: [...liege].map(([v, l]) => `${v}>${l}`).join(',') };
  memo.set(civ, { year, ties });
  return ties;
}

/** a、b 是不是一对宗藩(哪边是宗主都算) */
export function tiedPair(t: VassalTies, a: number, b: number): boolean {
  return t.liege.get(a) === b || t.liege.get(b) === a;
}

/** 国家的颜色(colors[i×3..i×3+2])换成藩属往宗主靠过的一套(拷贝);没有藩属就原样返回 */
export function vassalColors(colors: Uint8Array, t: VassalTies): Uint8Array {
  if (!t.liege.size) return colors;
  const out = colors.slice();
  for (const [v, l] of t.liege) {
    for (let k = 0; k < 3; k++) out[v * 3 + k] = Math.round(colors[v * 3 + k] * (1 - VASSAL_TINT) + colors[l * 3 + k] * VASSAL_TINT);
  }
  return out;
}

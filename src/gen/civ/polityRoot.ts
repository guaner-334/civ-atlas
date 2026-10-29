/**
 * 某一年是第几朝、那年的那一朝、那年的国名词根(东方语感改朝换代换国号,西幻国名不变;见 growth.ts 文件头"王朝更替")。
 * 单独放:存档里的改名(edits.ts)只用得到这几样,不用跟着带上人口、国号那一整套。纯函数。
 */
import type { Polity, Year } from './types';

/**
 * 某一年是第几朝(Polity.dynasties 的下标,改朝换代那一刻起算新朝;没改朝换代过 = 0)。
 * 年份早于立国 = 第一朝
 */
export function dynastyIndexAt(p: Polity, year: Year): number {
  const d = p.dynasties;
  if (!d || d.length < 2) return 0;
  let i = 0;
  while (i + 1 < d.length && d[i + 1].year <= year) i++;
  return i;
}

/** 某一年的那一朝(没改朝换代过 = undefined) */
export function dynastyAt(p: Polity, year: Year): { year: Year; name: string; seat: number } | undefined {
  const d = p.dynasties;
  return d && d.length ? d[dynastyIndexAt(p, year)] : undefined;
}

/**
 * 某一年的国名词根:东方语感按当朝(改朝换代后换国号:"昌" → "景");西幻语感国名不变(王室换了,国名照旧)。
 * 新朝还没起名(推演中途)= 原词根
 */
export function polityRootAt(p: Polity, year: Year): string {
  if (!p.eastern || !p.dynasties || p.dynasties.length < 2) return p.name;
  return p.dynasties[dynastyIndexAt(p, year)].name || p.name;
}

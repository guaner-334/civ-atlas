/**
 * 那一年的政体:国家在位表的每一段(Polity.dynasties)是王室的一朝,还是改制(reform.ts)开的共和 / 军政府。
 * 好几处原来直接看 Polity.lineage(国号一系)判断有没有王室、执政有没有任期、能不能结亲、配什么旗;
 * 改了制以后一系随年份变,这些都改成经由这里查"那一年 / 那一段"的。纯函数,不碰 DOM。
 *
 * - 王室的一段:立国那一朝、改朝换代、复辟;一系 = Polity.lineage(海洋城邦共和一系也算这一类:它本来就没有王室)
 * - 共和(regime = republic):议事会推举执政,有任期;一系当成共和一系
 * - 军政府(regime = junta):将军执政,也有任期(拥立);一系当成共和一系
 *
 * "改出来的"共和国 / 军政府 = 本国原来有君主(Polity.lineage 不是共和一系)的那几段:国号写"某共和国"(不分档,见 growth.ts),
 * 旗按改制换(flags.ts)。海洋城邦共和一系的国家政变、还政,国号照旧。
 */
import type { Annal, Polity, PolityLineage, Year } from './types';
import { dynastyIndexAt } from './polityRoot';
import { Issue, Outcome, REFORM_RESTORE } from './councilRules';

/** 一段的政体:王室(含海洋城邦共和一系本来的样子)/ 共和 / 军政府 */
export type Regime = 'crown' | 'republic' | 'junta';

type RegimePolity = Pick<Polity, 'lineage' | 'dynasties'>;

/** 第 i 段(Polity.dynasties 的下标;没改朝换代过 = 0)是什么政体 */
export function segRegime(p: RegimePolity, i: number): Regime {
  const r = p.dynasties?.[i]?.regime;
  return r ?? (p.lineage === 'republic' ? 'republic' : 'crown');
}

/** 第 i 段的一系:改制开的共和、军政府那几段算共和一系(执政有任期、没有王室);王室的那几段 = 国家本来的一系 */
export function segLineage(p: RegimePolity, i: number): PolityLineage {
  return p.dynasties?.[i]?.regime ? 'republic' : (p.lineage ?? 'realm');
}

/** 第 i 段有没有王室(王室的一段,而且国家不是海洋城邦共和一系) */
export function royalSeg(p: RegimePolity, i: number): boolean {
  return segLineage(p, i) !== 'republic';
}

/** 第 i 段是改出来的共和 / 军政府(本国原来有君主) */
export function reformedSeg(p: RegimePolity, i: number): boolean {
  return !!p.dynasties?.[i]?.regime && p.lineage !== 'republic';
}

/** 那一年的政体(改制那一刻起算新的;年份早于立国 = 第一段) */
export function regimeAt(p: RegimePolity, year: Year): Regime {
  return segRegime(p, dynastyIndexAt(p as Polity, year));
}

/** 那一年的一系(改制以后的共和、军政府算共和一系) */
export function lineageAt(p: RegimePolity, year: Year): PolityLineage {
  return segLineage(p, dynastyIndexAt(p as Polity, year));
}

/** 那一年有没有王室 */
export function royalAt(p: RegimePolity, year: Year): boolean {
  return lineageAt(p, year) !== 'republic';
}

/** 这一国改过制没有(有一段是共和 / 军政府) */
export function hasReform(p: RegimePolity): boolean {
  return !!p.dynasties?.some((d) => d.regime);
}

/**
 * 第 i 段的国号按哪一段写:军政府照它前面那一段(政变不改国号),别的就是自己。
 * 返回那一段的下标
 */
export function titleSeg(p: RegimePolity, i: number): number {
  const d = p.dynasties;
  while (i > 0 && d?.[i]?.regime === 'junta') i--;
  return i;
}

/**
 * 这条史事往在位表开了一段(Polity.dynasties 加了一条):改朝换代(dynasty)以外的 —— 议废君立共和办成、议还政办成、
 * 革命、政变、复辟(史事 reform)。改朝换代的不算(要的话自己再看 kind === 'dynasty')
 */
export function opensSeg(e: Annal): boolean {
  if (e.kind === 'reform') return e.n !== undefined && e.n >= 0 && e.n <= REFORM_RESTORE;
  return e.kind === 'council' && (e.war === Issue.Abolish || e.war === Issue.Return) && e.n === Outcome.Done;
}

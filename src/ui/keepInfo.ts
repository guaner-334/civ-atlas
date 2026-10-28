/**
 * 「保住王室」在界面上的几处说法(推演规则见 gen/civ/interventions.ts 的 keeps;干预页一条开关 keep,即位页一个勾 = 即位带 keep):
 *   - 「我的干预」后面补的结果:"；挡下 1529、1558 年两回改朝换代" / "；期间没有要改朝的时候"(即位带的接在"在位期间保住王室"后面,用逗号)
 *   - 国家卡片概况「王室」一行(君主下面,只在管着的那些年有):"保住  到 1560 年" / "保住  一直有效" / 即位带的 "保住  到燕昭下台";
 *     单子里的 "保住  待推演"(逐年推演 "下一步生效")
 *   - 人物卡君位「王室」一行下面一段:"在位期间保住王室：1529、1558 年两回有人要起兵代大澜，都没成。到卒年下台以后照常继位，也照常会改朝换代。"
 *   - 即位页勾下面一句:"大澜王朝这一朝已立 400 年，照常推演 1529 年就会改朝换代。保住以后，他下台后几十年里多半还是会换。"
 * 西幻的国家"改朝换代"写"王室更迭"。挡下的那几回是史事 keep(b 列:豪强起兵 / 国都权臣篡位 / 掌实权的人篡位)。
 */
import type { Annal, Civ, Person, Polity } from '../gen/civ/types';
import { cnNumber } from '../gen/civ/chronicle';
import { KEEP_RISE } from '../gen/civ/rulers';
import { rulerAt } from '../gen/civ/peopleInfo';
import { heOrShe } from '../gen/civ/gender';
import { polityName, polityShortTitle, polityTierAt } from '../gen/civ/growth';
import { interventionFate } from '../gen/stepwise';
import { polityKey, resolveKey, type Intervention } from '../gen/edits';
import { spaced, yearAt, type Era } from '../gen/era';
import type { Pending } from './pendingStore';

/** 即位带的那一句 */
export const KEEP_CROWN = '在位期间保住王室';

/** 第 i 条干预(Civ.interventions 的下标)挡下的那几回(史事 keep,按先后) */
export function keepBlocks(civ: Civ, i: number): Annal[] {
  return i < 0 ? [] : civ.annals.filter((e) => e.kind === 'keep' && e.war === i);
}

/** 改朝换代 / 西幻的王室更迭 */
const changeWord = (p: Polity | undefined) => (p && !p.eastern ? '王室更迭' : '改朝换代');

/** "一回""两回""三回" */
const times = (n: number) => `${n === 2 ? '两' : cnNumber(n)}回`;

/** 挡下的那几年:"1529、1558 年"(多于三回的写前三个加"等";纪年 "公元 1529 年、公元 1558 年") */
function blockYears(blocks: readonly Annal[], era: Era | undefined): string {
  const ys = blocks.slice(0, 3).map((e) => Math.floor(e.year));
  const more = blocks.length > 3 ? '等' : '';
  return (era ? ys.map((y) => yearAt(y, era)).join('、') : `${ys.join('、')} 年`) + more;
}

/**
 * 「我的干预」一条保住王室(开关,或即位带的勾)后面补的结果:生效了才补(没生效的那边另写原因);
 * 开关接 "；"、即位带的接 "，"(前面已是"；在位期间保住王室")。别的干预 = 空串
 */
export function keepResult(civ: Civ, v: Intervention, i: number, era: Era | undefined): string {
  if (i < 0 || !(v.kind === 'keep' || (v.kind === 'crown' && v.keep))) return '';
  if (interventionFate(civ, i).state !== 'done') return '';
  const blocks = keepBlocks(civ, i);
  const sep = v.kind === 'crown' ? '，' : '；';
  if (!blocks.length) return `${sep}期间没有要改朝的时候`;
  return `${sep}挡下${spaced(blockYears(blocks, era))}${times(blocks.length)}${changeWord(civ.polities[blocks[0].a])}`;
}

/** 国家的稳定键 → 这份历史里的编号(没有 = −1) */
function polityOfKey(civ: Civ, key: string): number {
  const k = resolveKey(civ, key);
  return k?.kind === 'polity' ? k.id : -1;
}

/**
 * 国家卡片「王室」一行:那一年这国有保住王室管着才有(null = 不写这一行)。
 * 单子里有这国的(开关、即位带的勾)写 tag "待推演"(逐年推演 "下一步生效");开关写到哪年,即位带的写"到某某下台"
 */
export function keepRow(civ: Civ, id: number, year: number, pending: readonly Pending[], step: boolean, era: Era | undefined): { tag?: string; note?: string } | null {
  const key = polityKey(civ, id);
  const queued = pending.some((x) => {
    if (x.kind !== 'iv') return false;
    const v = x.v;
    return (v.kind === 'keep' || (v.kind === 'crown' && !!v.keep)) && v.a === key;
  });
  if (queued) return { tag: step ? '下一步生效' : '待推演' };
  const list = civ.interventions ?? [];
  for (let i = 0; i < list.length; i++) {
    const v = list[i];
    if (v.kind !== 'keep' || year < v.from || (v.until !== undefined && year >= v.until)) continue;
    if (polityOfKey(civ, v.a) !== id || interventionFate(civ, i).state !== 'done') continue;
    return { note: v.until !== undefined ? `到${spaced(yearAt(v.until, era))}` : '一直有效' };
  }
  // 即位带的:那一年在位的是带着勾即位的作者人物
  const r = rulerAt(civ, id, year);
  if (r?.author !== undefined && list.some((v) => v.kind === 'crown' && v.keep && v.char === r.author && polityOfKey(civ, v.a) === id)) return { note: `到${r.name}下台` };
  return null;
}

/**
 * 人物卡君位「王室」一行下面那一段(i = 他那条即位在 Civ.interventions 里第几条;toDeath = 到卒年下台):
 * "在位期间保住王室：1529、1558 年两回有人要起兵代大澜，都没成。到卒年下台以后照常继位，也照常会改朝换代。"
 */
export function keepReignNote(civ: Civ, x: Person, i: number, toDeath: boolean, era: Era | undefined): string {
  const p = civ.polities[x.polity];
  const word = changeWord(p);
  const blocks = keepBlocks(civ, i);
  let head: string;
  if (!blocks.length) head = `${heOrShe(x)}在位时没有人要${word}。`;
  else {
    const y = blocks[0].year;
    const short = p ? (p.eastern ? polityShortTitle(p, Math.max(0, polityTierAt(p, y)), y) : polityName(p, y)) : '';
    const what = blocks.every((e) => e.b === KEEP_RISE) ? `起兵代${short || '之'}` : blocks.every((e) => e.b !== KEEP_RISE) ? '篡位' : word;
    head = `${blockYears(blocks, era)}${times(blocks.length)}有人要${what}，都没成。`;
  }
  const tail = x.until === undefined ? '' : `${toDeath ? '到卒年下台' : '下台'}以后照常继位，也照常会${word}。`;
  return `${KEEP_CROWN}：${head}${tail}`;
}

/**
 * 即位页勾下面那一句(这份历史里这国从 start 那一刻起的样子;end = 他原定哪年下台,不知道 = undefined):
 * "大澜王朝这一朝已立 400 年，照常推演 1529 年就会改朝换代。保住以后，他下台后几十年里多半还是会换。"
 * 他在位那些年里照常推演不改朝换代的:"……这一朝已立 400 年，照常推演他在位时不会改朝换代。保住以后，有人篡位也会挡下。"
 */
export function crownKeepHint(civ: Civ, pid: number, start: number, end: number | undefined, era: Era | undefined): string {
  const p = civ.polities[pid];
  if (!p) return '';
  const d = p.dynasties ?? [];
  let from = p.founded;
  let next: number | undefined;
  for (const x of d) {
    if (x.year <= start) from = Math.max(from, x.year);
    else if (next === undefined) next = x.year;
  }
  const name = polityName(p, start) || p.name;
  const word = changeWord(p);
  const age = Math.max(0, Math.floor(start) - Math.floor(from));
  if (next !== undefined && (end === undefined || next < end))
    return `${name}这一朝已立 ${age} 年，照常推演${spaced(yearAt(next, era))}就会${word}。保住以后，他下台后几十年里多半还是会换。`;
  return `${name}这一朝已立 ${age} 年，照常推演他在位时不会${word}。保住以后，有人篡位也会挡下。`;
}

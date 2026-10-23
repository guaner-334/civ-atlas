/**
 * 灭国、让人物去世、改君主倾向、等在位的那位下台再即位在界面上的说法和小工具(纯计算,不碰 DOM;
 * 灭国页 DestroyPage.tsx、人物卡的去世 / 改倾向页 PersonIvPage.tsx、即位页 CrownPage.tsx、推完的提示条、「我的干预」用):
 *
 * - 灭国:默认并入谁(接壤的邻国里州最多的)、单子上的一行
 * - 让人物去世:哪几年能下(君主:在位的那几年;将领:领兵以后、卒年以前;名臣:入仕以后、去职以前)、不能下的原因、下面那一句
 * - 改倾向:那一年照的倾向(改过的照改后的)、"原定某年驾崩"
 * - 推完的提示条:"东定国亡，13 州并入大定""燕溟 1500 年去世，下一位照常继位""燕鸾澈改成 1500 年去世；历史不变"……
 */
import type { Civ, Person, RulerLeanings } from '../gen/civ/types';
import { interventionFate } from '../gen/stepwise';
import { rulerAt } from '../gen/civ/peopleInfo';
import { personName, rulerFateWord } from '../gen/civ/peopleText';
import { parsePersonKey, resolvePersonKey, type Intervention } from '../gen/edits';
import { eraText, spaced, yearAt, type Era } from '../gen/era';
import { nameAt, neighborsAt, polityIdOf } from './Interventions';

// ---------------------------------------------------------------------------
// 灭国

/** y 年 id 的国土默认并入谁:接壤的邻国里州最多的(一样多取编号小的;没有接壤的 = −1)。n = id 那年几州 */
export function destroyDefault(civ: Civ, id: number, y: number): { b: number; n: number; size: Map<number, number>; near: Set<number> } {
  const { size, near } = neighborsAt(civ, id, y);
  let b = -1;
  for (const q of near) if (b < 0 || (size.get(q) ?? 0) > (size.get(b) ?? 0) || ((size.get(q) ?? 0) === (size.get(b) ?? 0) && q < b)) b = q;
  return { b, n: size.get(id) ?? 0, size, near };
}

/** 单子上的一行:"东定国:灭国，13 州并入大定" / "东定国:灭国，散成无主"(同 interventionText) */
export function destroyQueueText(A: string, n: number, B: string | null): string {
  return B ? `${A}:灭国，${n ? `${n} 州` : ''}并入${B}` : `${A}:灭国，散成无主`;
}

// ---------------------------------------------------------------------------
// 让人物去世、改君主倾向

/** 能让他去世 / 改倾向的整数年份 lo…hi(lo > hi = 一年都不行);历史推到哪年为止也算上 */
export function personIvRange(civ: Civ, x: Person): { lo: number; hi: number } {
  const last = Math.ceil(civ.endYear) - 1;
  const before = (t: number | undefined) => (t === undefined ? last : Math.min(last, Math.ceil(t) - 1));
  if (x.role === 'ruler') {
    if (x.from === undefined) return { lo: 1, hi: 0 };
    return { lo: Math.ceil(x.from), hi: Math.min(before(x.until), before(x.died)) };
  }
  // 将领:第一次领兵以后、卒年以前;名臣:入仕以后、去职 / 卒年以前(那一年他得在台上,不然推演里不认)
  const from = x.role === 'general' ? x.commands?.[0]?.from : x.from;
  if (from === undefined) return { lo: 1, hi: 0 };
  const hi = x.role === 'minister' ? Math.min(before(x.until), before(x.died)) : before(x.died);
  return { lo: Math.max(Math.floor(from) + 1, Math.ceil(x.born)), hi };
}

/** y 年让他去世 / 改倾向为什么不行(行 = null;说法同推演里没生效的原因) */
export function personIvWhy(civ: Civ, x: Person, y: number): string | null {
  const { lo, hi } = personIvRange(civ, x);
  if (y >= lo && y <= hi) return null;
  if (x.died !== undefined && x.died <= y) return `第 ${Math.floor(x.died)} 年他已卒`;
  if (x.role === 'ruler') {
    if (y < lo) return x.from !== undefined ? `他第 ${Math.floor(x.from)} 年才即位` : '他没有即位';
    return x.until !== undefined && x.until <= y ? `第 ${Math.floor(x.until)} 年他已不在位` : '那一年历史还没推到';
  }
  if (y < lo) {
    const from = x.role === 'general' ? x.commands?.[0]?.from : x.from;
    const step = x.role === 'general' ? '领兵' : '入仕';
    return from !== undefined ? `他第 ${Math.floor(from)} 年才${step}` : `他那时还没${step}`;
  }
  if (x.role === 'minister' && x.until !== undefined && x.until <= y) return `第 ${Math.floor(x.until)} 年他已去职`;
  return '那一年历史还没推到';
}

/** 推演里的君主在 year 那年在不在位(人物卡上「让他去世」「改他的倾向」只在那年在位的君主卡上有;作者立的君主去人物卡改) */
export function rulerOnThrone(x: Person, year: number): boolean {
  return x.role === 'ruler' && x.author === undefined && x.from !== undefined && x.from <= year && (x.until === undefined || year < x.until);
}

/** 他原定怎么下台:"原定 1529 年被废" / "原定 1540 年驾崩";在位到推演最后 = "在位至今" */
export function rulerEndText(civ: Civ, x: Person, era: Era | undefined): string {
  if (x.until === undefined) return '在位至今';
  return `原定${spaced(yearAt(x.until, era))}${rulerFateWord(civ, x) || '下台'}`;
}

/** 让他去世那一页年份下面那一句 */
export function deathNote(civ: Civ, x: Person, era: Era | undefined): string {
  if (x.role === 'ruler') return `他${spaced(yearAt(x.from ?? x.born, era))}即位，${rulerEndText(civ, x, era)}。之前的历史不变。`;
  const end = x.died === undefined ? '' : `，原定${spaced(yearAt(x.died, era))}${x.fate === 'battle' ? '战死' : '卒'}`;
  return `他${spaced(yearAt(x.born, era))}生${end}。`;
}

/** 他 y 年照的倾向(改过的照改后的;不是君主 = null) */
export function leaningsThen(x: Person, y: number): RulerLeanings | null {
  if (!x.leanings) return null;
  let l = x.leanings;
  for (const m of x.moods ?? []) if (m.year <= y) l = m.leanings;
  return l;
}

/** 他最早从哪年起改过倾向(在 year 那年已经改了的;没改过 = null) */
export function moodSince(x: Person, year: number): number | null {
  const m = (x.moods ?? []).filter((v) => v.year <= year);
  return m.length ? m[m.length - 1].year : null;
}

// ---------------------------------------------------------------------------
// 等在位的那位下台再即位

/** y 年 polity 在位的那位和他原定哪年下台(没有在位的 = null) */
export function waitFor(civ: Civ, polity: number, y: number): { x: Person; name: string; until: number | null } | null {
  const x = rulerAt(civ, polity, y);
  if (!x) return null;
  return { x, name: personName(civ, x), until: x.until ?? null };
}

// ---------------------------------------------------------------------------
// 推完的提示条、「我的干预」

/** 一次性的干预(「我的干预」页的年份不写"起"):灭国、让人物去世、改倾向、等下台再即位、天灾 */
export function onceOnly(v: Intervention): boolean {
  return v.kind === 'destroy' || v.kind === 'death' || v.kind === 'temper' || v.kind === 'disaster' || (v.kind === 'crown' && !!v.after);
}

/** 人物键在这份历史里的名字(没有这个人 = 键里记的名字) */
function keyPerson(civ: Civ, key: string): { x: Person | null; name: string } {
  const id = resolvePersonKey(civ, key);
  const x = id >= 0 ? (civ.people?.[id] ?? null) : null;
  return { x, name: x ? personName(civ, x) : parsePersonKey(key)?.name || '那个人' };
}

/**
 * 推完的提示条(后面由调用方接"；已从……起重新推演";same = 历史不变,不接):
 *   灭国   "东定国亡，13 州并入大定" / "东定国亡，13 州散为无主之地" / 并入的那国那年已亡 "……散为无主之地（大定那年已亡）"
 *   去世   君主 "燕溟 1500 年去世，下一位照常继位";将领、名臣 "燕鸾澈改成 1500 年去世；历史不变"
 *   改倾向 "燕溟的倾向改了，到他下台为止"
 *   即位(等下台)"顾长安等高宗鸿喾下台再即位"
 * 没生效:黄色,写原因("灭东定国没生效：第 1500 年东定国已亡")。别的干预 = null(照原来的写法)。
 * i = 在 civ.interventions 里的下标;A = 下令的国家怎么称呼;who = 作者人物的名字(即位用)
 */
export function newIvDoneText(civ: Civ, v: Intervention, i: number, A: string, era: Era | undefined, who = ''): { ok: boolean; text: string; same?: boolean } | null {
  if (v.kind !== 'destroy' && v.kind !== 'death' && v.kind !== 'temper' && !(v.kind === 'crown' && v.after)) return null;
  const f = i >= 0 ? interventionFate(civ, i) : null;
  const e = f && f.state !== 'later' && f.annal >= 0 ? civ.annals[f.annal] : null;
  const fail = (what: string) => {
    const why = f?.state === 'void' ? (f.why.startsWith('那一年') ? `第 ${v.from} 年${f.why.slice(3)}` : f.why) : '没有生效';
    return { ok: false, text: `${what}没生效：${eraText(why, era)}` };
  };
  const at = yearAt(v.from, era);
  switch (v.kind) {
    case 'destroy': {
      if (f?.state === 'void') return fail(`灭${A}`);
      const n = e?.n ? `${e.n} 州` : '国土';
      const B = e && e.b >= 0 && civ.polities[e.b] ? nameAt(civ.polities[e.b], v.from) : null;
      if (B) return { ok: true, text: `${A}亡，${n}并入${B}` };
      const lost = v.b ? polityIdOf(civ, v.b) : -1;
      return { ok: true, text: `${A}亡，${n}散为无主之地${v.b ? `（${lost >= 0 ? nameAt(civ.polities[lost], v.from) : '并入的那国'}那年已亡）` : ''}` };
    }
    case 'death': {
      const { name } = keyPerson(civ, v.person);
      if (f?.state === 'void') return fail(`让${name}去世`);
      if (parsePersonKey(v.person)?.role === 'ruler') return { ok: true, text: `${name}${spaced(at)}去世，下一位照常继位` };
      return { ok: true, text: `${name}改成${spaced(at)}去世；历史不变`, same: true };
    }
    case 'temper': {
      const { name } = keyPerson(civ, v.person);
      if (f?.state === 'void') return fail(`改${name}的倾向`);
      return { ok: true, text: `${name}的倾向改了，到他下台为止` };
    }
    case 'crown': {
      if (f?.state === 'void') return { ok: false, text: `${who}没能即位：${eraText(f.why.startsWith('那一年') ? `第 ${v.from} 年${f.why.slice(3)}` : f.why, era)}` };
      const pid = polityIdOf(civ, v.a);
      const cur = pid >= 0 ? rulerAt(civ, pid, v.from) : null;
      // 推完以后那一年在位的可能已经是他自己(真即位了):照下令时等的那位写不出来,就只写"等在位的那位"
      const wait = cur && cur.author === undefined ? personName(civ, cur) : '在位的那位';
      return { ok: true, text: `${who}等${wait}下台再即位` };
    }
  }
  return null;
}

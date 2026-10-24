/**
 * 灭国、让人物去世、改君主倾向、等在位的那位下台再即位在界面上的说法和小工具(纯计算,不碰 DOM;
 * 灭国页 DestroyPage.tsx、人物卡的去世 / 改倾向页 PersonIvPage.tsx、即位页 CrownPage.tsx、推完的提示条、「我的干预」用):
 *
 * - 灭国:默认并入谁(接壤的邻国里州最多的)、单子上的一行
 * - 让人物去世:哪几年能下(君主:在位的那几年;将领:领兵以后、卒年以前;名臣:入仕以后、去职以前)、不能下的原因、下面那一句
 * - 改倾向:那一年照的倾向(改过的照改后的)、"原定某年驾崩"
 * - 天灾(天灾页 DisasterPage.tsx、州卡片的人口):受灾的州(地图上涂出来的预览)、轻重下面那一句、单子上的一行、
 *   推完州卡片上"现在的数、划掉的原数、哪年什么灾"
 * - 推完的提示条:"东定国亡，13 州并入大定""燕溟 1500 年去世，下一位照常继位""燕鸾澈改成 1500 年去世；历史不变"
 *   "星邑大疫（重）""翼门之野一带地震，8 州受灾"……
 */
import type { Annal, Civ, Person, RulerLeanings, Year } from '../gen/civ/types';
import { interventionFate } from '../gen/stepwise';
import { rulerAt } from '../gen/civ/peopleInfo';
import { personName, rulerFateWord } from '../gen/civ/peopleText';
import {
  DISASTER_LEVEL_NAMES,
  DISASTER_NAMES,
  keyCells,
  parsePersonKey,
  regionOfKey,
  resolveKey,
  resolvePersonKey,
  type DisasterLevel,
  type Intervention,
} from '../gen/edits';
import { eraText, spaced, yearAt, type Era } from '../gen/era';
import { RURAL_PLAGUE, RURAL_WAR, SACK_RECOVER, populationAt, regionCityAt, regionPopulationAt, ruralPopulationAt } from '../gen/civ/growth';
import { PLAGUE_IV, quakeRing, quakeWord } from '../gen/civ/calamity';
import { plagueSpans } from '../gen/civ/plagueSpans';
import { regionLabel } from '../gen/civ/display';
import { ownersAt, type Owners } from '../gen/civ/timeline';
import { interventionText, nameAt, neighborsAt, polityIdOf } from './Interventions';

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

/**
 * 能让他去世 / 改倾向的整数年份 lo…hi(lo > hi = 一年都不行);历史推到哪年为止也算上。
 * open = 逐年推演:下在"现在"(下一步开头,在已经推过的历史后面),不按历史推到哪年卡,只看他那时还在不在、在不在台上
 */
export function personIvRange(civ: Civ, x: Person, open = false): { lo: number; hi: number } {
  const last = open ? Infinity : Math.ceil(civ.endYear) - 1;
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

/** y 年让他去世 / 改倾向为什么不行(行 = null;说法同推演里没生效的原因;open 同 personIvRange) */
export function personIvWhy(civ: Civ, x: Person, y: number, open = false): string | null {
  const { lo, hi } = personIvRange(civ, x, open);
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
// 天灾

type DisasterIv = Extract<Intervention, { kind: 'disaster' }>;

let owners: Owners | undefined;

/** 城里约死几成(下标 = 轻重;同推演的 IV_LOSS 一成半 / 三成 / 五成) */
const LOSS_WORD = ['', '一成半', '三成', '五成'] as const;

/**
 * 轻重下面那一句:电脑 "中：城里约死三成（轻一成半、重五成），几十年长回来，其间国内更易动荡。不改地形。";
 * 手机只写 "重：城里约死五成。"
 */
export function disasterLevelNote(level: DisasterLevel, phone: boolean): string {
  const at = `${DISASTER_LEVEL_NAMES[level]}：城里约死${LOSS_WORD[level]}`;
  if (phone) return `${at}。`;
  const others = ([1, 2, 3] as const)
    .filter((l) => l !== level)
    .map((l) => `${DISASTER_LEVEL_NAMES[l]}${LOSS_WORD[l]}`)
    .join('、');
  return `${at}（${others}），几十年长回来，其间国内更易动荡。不改地形。`;
}

/** y 年州 r 有人烟的城(天灾只落在这样的城上,同推演;没有 = −1) */
export function livingCity(civ: Civ, r: number, y: number): number {
  if (!(r >= 0 && r < civ.regions.count)) return -1;
  const s = regionCityAt(civ, r, y);
  if (!s) return -1;
  owners = ownersAt(civ, y, owners);
  return owners.culture[r] >= 0 ? s.id : -1;
}

/** 天灾页上选好的范围(这份历史里的编号) */
export type DisasterSpot =
  | { type: 'plague'; city: number }
  | { type: 'famine'; polity: number }
  | { type: 'famine'; regions: readonly number[] }
  | { type: 'quake'; region: number };

/**
 * 受灾的州(天灾页地图上涂出来的预览;州号升序):瘟疫 = 起疫那城的州(传到哪推演了才知道);饥荒 = 那国 y 年的国土 / 选的几州;
 * 地震水旱 = 那一处连同陆上接壤的一圈(quakeRing)
 */
export function disasterArea(civ: Civ, s: DisasterSpot, y: number): number[] {
  if (s.type === 'plague') {
    const r = civ.settlements[s.city]?.region ?? -1;
    return r >= 0 ? [r] : [];
  }
  if (s.type === 'quake') return quakeRing(civ.regions, s.region);
  if ('regions' in s) return [...new Set(s.regions)].filter((r) => r >= 0 && r < civ.regions.count).sort((a, b) => a - b);
  owners = ownersAt(civ, y, owners);
  const out: number[] = [];
  for (let r = 0; r < civ.regions.count; r++) if (owners.polity[r] === s.polity) out.push(r);
  return out;
}

/** 这几州 y 年一共多少人(千人)、其中几州有人烟的城(真受灾的州数) */
export function disasterToll(civ: Civ, regions: readonly number[], y: number): { pop: number; hit: number } {
  let pop = 0;
  let hit = 0;
  for (const r of regions) {
    pop += regionPopulationAt(civ, r, y);
    if (livingCity(civ, r, y) >= 0) hit++;
  }
  return { pop, hit };
}

/** 单子上的一行(同「我的干预」):"星邑:瘟疫（重）""有桑皇朝:饥荒（轻）""翼门之野一带:地震（中），8 州受灾"(hit = 有人烟的州数) */
export function disasterQueueText(civ: Civ, v: DisasterIv, A: string | undefined, hit: number): string {
  const t = interventionText(civ, v, -1, A);
  return v.type === 'quake' && hit > 0 ? `${t}，${hit} 州受灾` : t;
}

/** 州的稳定键 → 编号(没有 = −1) */
const regionOf = (civ: Civ, key: string | undefined): number => {
  const r = key ? regionOfKey(key, keyCells(civ.regions)) : -1;
  return r >= 0 && r < civ.regions.count ? r : -1;
};

/** 推完的天灾落在哪几州(提示条开着时地图上淡淡涂着):照下令时的范围在生效那年算(同 disasterArea;对象这份历史里没有 = 空) */
export function disasterDoneArea(civ: Civ, v: DisasterIv): number[] {
  if (v.type === 'plague') {
    const k = v.city ? resolveKey(civ, v.city) : null;
    return k?.kind === 'settlement' ? disasterArea(civ, { type: 'plague', city: k.id }, v.from) : [];
  }
  if (v.type === 'quake') {
    const r = regionOf(civ, v.region);
    return r >= 0 ? disasterArea(civ, { type: 'quake', region: r }, v.from) : [];
  }
  if (v.a) {
    const id = polityIdOf(civ, v.a);
    return id >= 0 ? disasterArea(civ, { type: 'famine', polity: id }, v.from) : [];
  }
  return disasterArea(civ, { type: 'famine', regions: (v.regions ?? []).map((k) => regionOf(civ, k)) }, v.from);
}

/** 天灾落在哪:"星邑""有桑皇朝""翼门之野等 4 州""翼门之野一带"(A = 饥荒那国怎么称呼;e = 它那条史事) */
function disasterPlace(civ: Civ, v: DisasterIv, A: string, e: Annal | null): string {
  if (v.type === 'plague') {
    const k = v.city ? resolveKey(civ, v.city) : null;
    const sid = e && e.settlement >= 0 ? e.settlement : k?.kind === 'settlement' ? k.id : -1;
    return civ.settlements[sid]?.name || '那座城';
  }
  if (v.type === 'quake') {
    const r = regionOf(civ, v.region);
    return `${r >= 0 ? regionLabel(civ, r) : '那一处'}一带`;
  }
  if (v.a) {
    if (A) return A;
    const id = polityIdOf(civ, v.a);
    return id >= 0 ? nameAt(civ.polities[id], v.from) : '那国';
  }
  const rs = v.regions ?? [];
  const r = regionOf(civ, rs[0]);
  return `${r >= 0 ? regionLabel(civ, r) : '那几州'}${rs.length > 1 ? `等 ${rs.length} 州` : ''}`;
}

/**
 * 天灾推完的提示条:"星邑大疫（重）"(并进了正在传的那一场:"……，并进了 1498 年起的那场大疫")"有桑皇朝大饥（轻）"
 * "翼门之野等 4 州大饥（轻）""翼门之野一带地震，8 州受灾"(大水 / 大旱看地形);没生效:"星邑的瘟疫没生效：第 1500 年星邑已毁"
 */
function disasterDoneText(civ: Civ, v: DisasterIv, i: number, A: string, era: Era | undefined): { ok: boolean; text: string } {
  const f = i >= 0 ? interventionFate(civ, i) : null;
  const e = f && f.state !== 'later' && f.annal >= 0 ? civ.annals[f.annal] : null;
  const place = disasterPlace(civ, v, A, e);
  if (f?.state === 'void') {
    const why = f.why.startsWith('那一年') ? `第 ${v.from} 年${f.why.slice(3)}` : f.why;
    return { ok: false, text: `${place}的${DISASTER_NAMES[v.type]}没生效：${eraText(why, era)}` };
  }
  const lv = `（${DISASTER_LEVEL_NAMES[v.level]}）`;
  if (v.type === 'plague') {
    // 那年已经在闹瘟疫:并进那一场(那一刻以前最后起的一场)
    let merged = '';
    if (e && e.b === 2) {
      const was = plagueSpans(civ).filter((x) => x.id !== PLAGUE_IV + i && x.start <= v.from);
      merged = was.length ? `，并进了${spaced(yearAt(was[was.length - 1].start, era))}起的那场大疫` : '，并进了正在传的那场大疫';
    }
    return { ok: true, text: `${place}大疫${lv}${merged}` };
  }
  if (v.type === 'famine') return { ok: true, text: `${place}大饥${lv}` };
  const r = regionOf(civ, v.region);
  const word = r >= 0 ? quakeWord(civ.regions, r) : '地震';
  return { ok: true, text: `${place}${word}${e && e.b > 0 ? `，${e.b} 州受灾` : ''}` };
}

/** 生效了的天灾和它那条史事(按先后;每份历史算一次) */
const ivDisasterCache = new WeakMap<Civ, { v: DisasterIv; e: Annal }[]>();
function ivDisasters(civ: Civ): { v: DisasterIv; e: Annal }[] {
  let out = ivDisasterCache.get(civ);
  if (out) return out;
  out = [];
  const ivs = civ.interventions;
  if (ivs?.some((v) => v.kind === 'disaster'))
    for (const e of civ.annals) {
      if (e.kind !== 'intervene' || !(e.b > 0)) continue;
      const v = ivs[e.war];
      if (v?.kind === 'disaster') out.push({ v, e });
    }
  ivDisasterCache.set(civ, out);
  return out;
}

/** 城里这一次折损是不是作者下的天灾落在州 r 上的(是 = 叫什么灾:瘟疫 / 饥荒 / 地震 / 大水 / 大旱;不是 = null) */
function sackWord(civ: Civ, r: number, x: { year: Year; cause?: string }): string | null {
  for (const { v, e } of ivDisasters(civ)) {
    if (v.type === 'plague') {
      if (x.cause !== 'plague') continue;
      if (v.from === x.year && e.region === r) return DISASTER_NAMES.plague;
      // 起了新的一场(b = 1):后来传到别的州的也算这次天灾
      if (e.b === 1 && plagueSpans(civ).find((s) => s.id === PLAGUE_IV + e.war)?.hits.some((h) => h.region === r && h.year === x.year)) return DISASTER_NAMES.plague;
      continue;
    }
    if (v.from !== x.year) continue;
    if (v.type === 'quake') {
      if (x.cause === 'quake' && quakeRing(civ.regions, e.region).includes(r)) return quakeWord(civ.regions, e.region);
    } else if (x.cause === 'famine') {
      const mine = v.a ? ownersAt(civ, x.year).polity[r] === e.a : (v.regions ?? []).some((k) => regionOf(civ, k) === r);
      if (mine) return DISASTER_NAMES.famine;
    }
  }
  return null;
}

/**
 * 州卡片的人口(第 32 张):year 年这州还没从作者下的天灾里长回来时,给出现在的数、原数(没遭这次灾该有多少人;都是千人)、哪年、什么灾,
 * 卡片上写"约 45 万人 ~~64 万人~~ 1500 年地震";几十年里长回来(少的不到原数的二十分之一)以后不再写 = null。几次天灾看最近的一次
 */
export function regionDisasterMark(civ: Civ, r: number, year: number): { now: number; was: number; when: number; word: string } | null {
  if (!ivDisasters(civ).length) return null;
  const s = regionCityAt(civ, r, year);
  const sacks = s?.sacks;
  if (!s || !sacks) return null;
  for (let k = sacks.length - 1; k >= 0; k--) {
    const x = sacks[k];
    if (x.year > year) continue;
    const word = sackWord(civ, r, x);
    if (!word) continue;
    // 这一次折损还没长回来的那部分:城里 loss × e^(−年数 ÷ SACK_RECOVER),乡下照 growth.ts 再打个折
    const f = x.loss * Math.exp(-(year - x.year) / SACK_RECOVER);
    const city = populationAt(s, year);
    const rural = ruralPopulationAt(civ, r, year);
    const now = city + rural;
    const was = city / (1 - f) + rural / (1 - (x.cause === 'plague' ? RURAL_PLAGUE : RURAL_WAR) * f);
    return was - now >= was / 20 ? { now, was, when: x.year, word } : null;
  }
  return null;
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
 *   天灾   "星邑大疫（重）""有桑皇朝大饥（轻）""翼门之野一带地震，8 州受灾"(disasterDoneText)
 * 没生效:黄色,写原因("灭东定国没生效：第 1500 年东定国已亡")。别的干预 = null(照原来的写法)。
 * i = 在 civ.interventions 里的下标;A = 下令的国家怎么称呼;who = 作者人物的名字(即位用)
 */
export function newIvDoneText(civ: Civ, v: Intervention, i: number, A: string, era: Era | undefined, who = ''): { ok: boolean; text: string; same?: boolean } | null {
  if (v.kind === 'disaster') return disasterDoneText(civ, v, i, A, era);
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

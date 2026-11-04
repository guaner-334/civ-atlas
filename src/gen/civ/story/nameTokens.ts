/**
 * 编年史里的名字写成占位符(civ/nameToken.ts),显示时换成当前的名字。
 *
 * 存进世界的编年史要的是:以后改了编年史的写法,老世界的文字不变;可世界里的名字还能改,改了以前的史事要跟着变。
 * 所以把历史里每个能改名的名字换成占位符(tokenCiv),用同一套写编年史的代码算一遍,存下带占位符的文字;
 * 显示时把占位符换成套了改名的历史里的名字(restoreEntries)。名字整个替换,一个名字是另一个名字的一部分也不会误伤。
 *
 * 占位符"指谁"的头一个字母:
 *   p 国家的国名词根、d 国家.第几朝的朝名、s 城、l 地理实体(l下标 = 现在这一段,l下标.第几段 = 地形大事以前那一段)、c 民族、
 *   r 有名字的州、u 没名字的州("第 N 州",改名以后才有名字)、f 信仰、h 人物、a 作者的人物(人物卡编号)、
 *   t 约(用的人起的名字,没起过 = "丹枫关之约")、o 约(只算用的人起的名字)、b 商道
 *
 * 纯计算,不碰 DOM。
 */
import { applyCharacters, type AuthorCharacter } from '../../characters';
import { applyNames } from '../../edits';
import type { Civ, Polity } from '../types';
import { polityNameForm, rootShape } from '../growth';
import { NAME_FORM_MARK, NAME_IF_ARG, NAME_IF_RE, NAME_TOKEN_CHARS, NAME_TOKEN_RE, hasNameIf, hasNameToken, markRootShape, nameToken, testName, type NameTest } from '../nameToken';
import { splitSurname } from '../surname';
import { authorName, type ChronicleEntry } from './chronicle';
import { regionLabel } from './display';
import { coreRoot } from './peopleText';
import { fullChronicle } from './religionText';
import { treatyName } from './treatyInfo';

/** 选择最多嵌几层 */
const NAME_IF_DEPTH = 4;

/** 东方国名词根的占位符(记上生成时的样子,见 markRootShape);西幻的词根就是简称,不用记 */
function rootToken(p: Polity, ref: string, name: string): string {
  return markRootShape(nameToken(ref), p.eastern ? rootShape(name) : null);
}

/** 国家的名字换成占位符:东方第一朝和国名词根一样的算同一个(改国名时第一朝跟着变,gen/edits.ts 的 withRoot) */
function tokenPolity(p: Polity): Polity {
  const root = rootToken(p, `p${p.id}`, p.name);
  const q: Polity = { ...p, name: root };
  if (p.dynasties)
    q.dynasties = p.dynasties.map((d, i) => {
      if (!d.name) return d;
      return { ...d, name: i === 0 && p.eastern && d.name === p.name ? root : rootToken(p, `d${p.id}.${i}`, d.name) };
    });
  return q;
}

/**
 * 一份名字全换成占位符的历史(原来的不动,只复制带名字的对象)。
 * 作者的人物:先套上人物卡(gen/characters.ts 的 applyCharacters)再传进来,性别按人物卡写;名字一样写成占位符。
 * 人物的稳定键按名字算,defaultName 留着生成时的名字,键不变
 */
export function tokenCiv(civ: Civ): Civ {
  const base = civ.history ?? civ;
  const polities = base.polities.map(tokenPolity);

  const count = base.regions.count;
  const named = base.regionNames ?? base.regions.name ?? [];
  const regionNames = Array.from({ length: count }, (_, r) => nameToken(`${named[r] ? 'r' : 'u'}${r}`));

  const out: Civ = {
    ...base,
    polities,
    settlements: base.settlements.map((s) => (s.name ? { ...s, name: nameToken(`s${s.id}`) } : s)),
    regionNames,
    cultures: base.cultures.map((c) => ({ ...c, name: nameToken(`c${c.id}`) })),
    places: base.places.map((x, i) => (x.name ? { ...x, name: nameToken(`l${i}`) } : x)),
  };
  if (base.eras) out.eras = base.eras.map((e, k) => ({ ...e, places: e.places.map((x, i) => (x.name ? { ...x, name: nameToken(`l${i}.${k}`) } : x)) }));
  if (base.religion) out.religion = { ...base.religion, faiths: base.religion.faiths.map((f) => (f.name ? { ...f, name: nameToken(`f${f.id}`) } : f)) };
  if (base.trade) out.trade = { ...base.trade, routes: base.trade.routes.map((r) => (r.name ? { ...r, name: nameToken(`b${r.id}`) } : r)) };
  if (base.people) out.people = base.people.map((x) => (x.name || x.author !== undefined ? { ...x, name: nameToken(`h${x.id}`), defaultName: x.defaultName ?? x.name } : x));
  if (base.authorNames) out.authorNames = Object.fromEntries(Object.keys(base.authorNames).map((k) => [k, nameToken(`a${k}`)]));
  return out;
}

/** 占位符指的那个现在叫什么(named = 套了改名、人物卡的历史);指的东西不在了 = 空串 */
function currentName(named: Civ, ref: string): string {
  const kind = ref[0];
  const dot = ref.indexOf('.');
  const id = Number(dot < 0 ? ref.slice(1) : ref.slice(1, dot));
  const sub = dot < 0 ? -1 : Number(ref.slice(dot + 1));
  switch (kind) {
    case 'p':
      return named.polities[id]?.name ?? '';
    case 'd':
      return named.polities[id]?.dynasties?.[sub]?.name ?? '';
    case 's':
      return named.settlements[id]?.name ?? '';
    case 'l':
      return (sub < 0 ? named.places : named.eras?.[sub]?.places)?.[id]?.name ?? '';
    case 'c':
      return named.cultures[id]?.name ?? '';
    case 'r':
    case 'u':
      return id < named.regions.count ? regionLabel(named, id) : '';
    case 'f':
      return named.religion?.faiths[id]?.name ?? '';
    case 'h':
      return named.people?.[id]?.name ?? '';
    case 'a':
      return authorName(named, id);
    case 't':
      return treatyName(named, id);
    case 'o':
      return named.treatyNames?.[id] ?? '';
    case 'b':
      return named.trade?.routes[id]?.name ?? '';
    default:
      return '';
  }
}

/** 名字套进写法 */
function applyForm(form: string, name: string): string {
  if (form === 'c') return coreRoot(name);
  if (form === 'n') return splitSurname(name);
  return polityNameForm(form, name);
}

/** 一个换占位符的函数:先按当前的名字选写法,再把名字换上;同一个占位符只算一次 */
export function nameRestorer(named: Civ): (text: string) => string {
  const memo = new Map<string, string>();
  const one = (token: string, ref: string, forms: string): string => {
    let hit = memo.get(token);
    if (hit !== undefined) return hit;
    hit = currentName(named, ref);
    if (forms) for (const f of forms.split(NAME_FORM_MARK)) if (f) hit = applyForm(f, hit);
    memo.set(token, hit);
    return hit;
  };
  const names = (text: string) => text.replace(NAME_TOKEN_RE, one);
  const choose = (_: string, cond: string, yes: string, no: string): string => {
    const [test, name, arg] = cond.split(NAME_IF_ARG);
    return testName(test as NameTest, names(name), names(arg)) ? yes : no;
  };
  return (text) => {
    if (!hasNameToken(text)) return text;
    let t = text;
    // 嵌套的选择:一趟换掉最里层的。真实的文字最多嵌一层,这里限趟数防文件里的坏文字
    for (let pass = 0; pass < NAME_IF_DEPTH && hasNameIf(t); pass++) t = t.replace(NAME_IF_RE, choose);
    return names(t).replace(NAME_TOKEN_CHARS, '');
  };
}

/** 带占位符的条目换回名字:一条里没有占位符的原样用(存的原文) */
export function restoreEntries(entries: readonly ChronicleEntry[], named: Civ, restore: (text: string) => string = nameRestorer(named)): ChronicleEntry[] {
  return entries.map((e) => {
    const out: ChronicleEntry = { ...e, text: restore(e.text) };
    if (e.head !== undefined) out.head = restore(e.head);
    if (e.children) out.children = restoreEntries(e.children, named, restore);
    return out;
  });
}

// ---------------------------------------------------------------------------
// 世界里存的那一块

/** 编年史那一块(第 2 版结构) */
export interface ChronicleBlock {
  /** 全部条目(fullChronicle),文字里的名字是占位符。第 1 版转来的、和当时的文字对不上的条目留着原文(没有占位符,改名不跟着变) */
  entries: ChronicleEntry[];
  /**
   * 算的时候作者的人物里哪些是女的(Civ.authorFemale;一个都没有 = 不给)。君号、代词分男女,不是名字,换不了:
   * 人物卡的性别后来改了,这份文字就不能用了(见 chronicleOfBlock)
   */
  authorFemale?: number[];
}

/** 全部条目里这一条也在 buildChronicle 里:只有史事写的那些(信仰、时代和商道、思潮的大事是后来并进去的) */
export const inBuildChronicle = (e: Pick<ChronicleEntry, 'kind'>): boolean => e.kind !== 'faith' && e.kind !== 'era' && e.kind !== 'thought';

/** 算一块编年史:civ = 没套改名的历史,characters = 作者的人物(名字写成占位符,性别照它写) */
export function chronicleBlock(civ: Civ, characters?: readonly AuthorCharacter[]): ChronicleBlock {
  const full = applyCharacters(civ.history ?? civ, characters);
  const entries = fullChronicle(tokenCiv(full));
  return full.authorFemale?.length ? { entries, authorFemale: [...full.authorFemale] } : { entries };
}

/**
 * 存的编年史换回名字。named = 套了改名、人物卡的历史(gen/edits.ts 的 applyNames、gen/characters.ts 的 applyCharacters)。
 * 人物卡的性别和算的时候不一样了,存的文字不能用 = null(调用方现算)
 */
export function chronicleOfBlock(block: ChronicleBlock, named: Civ): ChronicleEntry[] | null {
  return blockFits(block, named) ? restoreEntries(block.entries, named) : null;
}

/** 这块编年史写的性别和 named 的人物卡一样 */
export function blockFits(block: ChronicleBlock, named: Civ): boolean {
  const want = named.authorFemale ?? [];
  const had = block.authorFemale ?? [];
  return want.length === had.length && want.every((id, i) => id === had[i]);
}

/** 除了写到的人物(people),两条一样:没套人物卡的文字里,作者的人物名字是空的,「写到谁」的判断不作数 */
function sameEntry(a: ChronicleEntry, b: ChronicleEntry): boolean {
  if (a.id !== b.id || a.kind !== b.kind || a.year !== b.year || a.end !== b.end || a.text !== b.text || a.tag !== b.tag || a.importance !== b.importance || a.settlement !== b.settlement) return false;
  if (a.head !== b.head || a.ongoing !== b.ongoing || a.faith !== b.faith || a.thought !== b.thought) return false;
  if (String(a.polities) !== String(b.polities) || String(a.regions) !== String(b.regions) || String(a.trade) !== String(b.trade)) return false;
  const ca = a.children ?? [];
  const cb = b.children ?? [];
  return ca.length === cb.length && ca.every((x, i) => sameEntry(x, cb[i]));
}

/**
 * 第 1 版的编年史(ChronicleEntry[],存的是算好的文字)转成第 2 版。第 1 版存的时候还没套人物卡,这里也不套。
 * 用现在的代码算一份占位符的,按存这份文字时的改名换回名字,逐条比:一字不差才换成占位符;对不上的留原文(这一条以后改名不跟着变)。
 * 算不了(历史读不懂)就全留原文。世界的事实一个不动,看到的文字也不变
 */
export function chronicleFromV1(stored: readonly ChronicleEntry[], civ: Civ, names: Readonly<Record<string, string>>): ChronicleBlock {
  let fresh: readonly ChronicleEntry[] = [];
  let back: readonly ChronicleEntry[] = [];
  try {
    fresh = chronicleBlock(civ).entries;
    back = restoreEntries(fresh, applyNames(civ, names as Record<string, string>));
  } catch {
    return { entries: [...stored] };
  }
  const at = new Map<number, number>();
  back.forEach((e, i) => at.set(e.id, i));
  return {
    entries: stored.map((e) => {
      const i = at.get(e.id);
      return i !== undefined && sameEntry(e, back[i]) ? fresh[i] : e;
    }),
  };
}

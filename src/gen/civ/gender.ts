/**
 * 按性别取的字。人物的性别记在 Person.female(女 = true;没写 = 男:旧存档、旧链接里的人物都没有这一项,一律当男的)。
 * 编年史、人物卡、AI 材料里凡是分男女的字都从这里取,不在各处写死:
 *
 * - 代词:他 / 她(heOrShe)
 * - 子女、排行:子 / 女,长子 / 长女(childWord;排行在同性别的兄弟姐妹里数)
 * - 君号(在位时):东方 皇帝 / 女帝、王 / 女王、公 / 女君、可汗 / 女可汗(首领不分);
 *   西幻 皇帝 / 女皇、国王 / 女王、汗 / 女汗、大汗 / 女大汗(酋长、首领、执政官不分)
 * - 身后称号:帝国的庙号("太宗")、亡国之君的"哀帝"照旧;王国"谥号 + 女王"("庄女王")、国"谥号 + 君"("穆君");西幻的序数、"大帝"照旧
 * - 身份词:皇子、王子 / 公主,公子 / 公女;预定的继承人 太子 / 皇太女、世子 / 王太女(西幻的王储不分)
 * - 亲属词:按世系说"b 是 a 的什么人"的整套在 peopleText.ts 的 kinOf;这里是单个词的男女对照(kinWord),
 *   给"找不到亲属时的默认称呼"和把短称呼说全(父 → 父亲)用
 * - 联姻:这个人那一边 —— 男的娶对方的宗室女,女的嫁对方的宗室子;配偶是"妻" / "夫"
 *
 * 纯函数,只引 types.ts
 */
import type { Person } from './types';

/** 带性别的人物(没有这个人 / 没写性别 = 男) */
export type Sexed = Pick<Person, 'female'> | null | undefined;

/** 是不是女的 */
export function isFemale(x: Sexed): boolean {
  return x?.female === true;
}

/** 男的取 m、女的取 f */
export function bySex<T>(x: Sexed, m: T, f: T): T {
  return isFemale(x) ? f : m;
}

/** 他 / 她 */
export function heOrShe(x: Sexed): '他' | '她' {
  return bySex(x, '他', '她');
}

/** 子 / 女("其子""长子""先君之子") */
export function childWord(x: Sexed): '子' | '女' {
  return bySex(x, '子', '女');
}

/** 东方还在位的君号,按国号档位 0–3:首领、公、王、皇帝 / 首领、女君、女王、女帝 */
export function eastRank(x: Sexed, tier: number): string {
  return (isFemale(x) ? EAST_F : EAST_M)[Math.min(3, Math.max(0, tier))];
}
const EAST_M = ['首领', '公', '王', '皇帝'] as const;
const EAST_F = ['首领', '女君', '女王', '女帝'] as const;

/** 东方汗国的可汗 / 女可汗 */
export function khanWord(x: Sexed): '可汗' | '女可汗' {
  return bySex(x, '可汗', '女可汗');
}

/** 西幻的君号,按国号一系(realm / khanate / republic;没有 = realm)、档位 0–3 */
export function westRank(x: Sexed, lineage: string | undefined, tier: number): string {
  const t = isFemale(x) ? WEST_F : WEST_M;
  return (t[lineage ?? 'realm'] ?? t.realm)[Math.min(3, Math.max(0, tier))];
}
const WEST_M: Record<string, readonly [string, string, string, string]> = {
  realm: ['酋长', '国王', '国王', '皇帝'],
  khanate: ['首领', '汗', '汗', '大汗'],
  republic: ['执政官', '执政官', '执政官', '皇帝'],
};
const WEST_F: Record<string, readonly [string, string, string, string]> = {
  realm: ['酋长', '女王', '女王', '女皇'],
  khanate: ['首领', '女汗', '女汗', '女大汗'],
  republic: ['执政官', '执政官', '执政官', '女皇'],
};

/**
 * 身后称号(Person.title 记的是男的那一种写法,显示时按性别换):东方女君 王国"庄王" → "庄女王"、国"穆公" → "穆君";
 * 帝国的庙号、"哀帝""末帝"照旧;西幻("三世""大帝")照旧
 */
export function postTitle(x: Sexed, eastern: boolean, title: string): string {
  if (!title || !eastern || !isFemale(x)) return title;
  if (title.endsWith('王')) return `${title.slice(0, -1)}女王`;
  if (title.endsWith('公')) return `${title.slice(0, -1)}君`;
  return title;
}

/** 宗室(父母正在位)的身份词:皇子、王子 → 公主;公子 → 公女 */
export function princeWord(x: Sexed, male: '皇子' | '王子' | '公子'): string {
  return isFemale(x) ? (male === '公子' ? '公女' : '公主') : male;
}

/**
 * 预定的继承人:不给档位 = 泛称(太子 / 太女);东方按国号档位 —— 帝国太子 / 皇太女、王国世子 / 王太女、国公子 / 公女
 */
export function heirWord(x: Sexed, tier?: number): string {
  if (tier === undefined) return bySex(x, '太子', '太女');
  if (tier >= 3) return bySex(x, '太子', '皇太女');
  if (tier === 2) return bySex(x, '世子', '王太女');
  return bySex(x, '公子', '公女');
}

/** 单个亲属词的男女对照(男的写法 → 女的写法):给默认称呼("其兄某某"找不到亲属时)、把短称呼说全用 */
const KIN_F: Readonly<Record<string, string>> = {
  子: '女',
  儿子: '女儿',
  养子: '养女',
  孙: '孙女',
  曾孙: '曾孙女',
  父: '母',
  父亲: '母亲',
  养父: '养母',
  祖父: '祖母',
  曾祖父: '曾祖母',
  兄: '姐',
  兄长: '姐姐',
  弟: '妹',
  侄: '侄女',
  侄孙: '侄孙女',
  伯父: '姑母',
  叔父: '姑母',
  从兄: '从姐',
  从弟: '从妹',
  从侄: '从侄女',
  伯祖: '姑祖母',
  叔祖: '姑祖母',
  从伯父: '从姑母',
  从叔父: '从姑母',
  族兄: '族姐',
  族弟: '族妹',
};

/** 亲属词按 x 的性别:kinWord(她, '兄') = '姐';没有对照的词照原样 */
export function kinWord(x: Sexed, male: string): string {
  return isFemale(x) ? (KIN_F[male] ?? male) : male;
}

/** 联姻里这个人那一边的动词:男的娶、女的嫁 */
export function wedVerb(x: Sexed): '娶' | '嫁' {
  return bySex(x, '娶', '嫁');
}

/** 联姻里对方嫁娶过来的那位怎么叫:男的娶宗室女,女的嫁宗室子 */
export function mateWord(x: Sexed): '宗室女' | '宗室子' {
  return bySex(x, '宗室女', '宗室子');
}

/** 配偶是这个人的什么人:妻 / 夫(世系图"妻大澜") */
export function spouseWord(x: Sexed): '妻' | '夫' {
  return bySex(x, '妻', '夫');
}

/**
 * 诸子争储那一截的主语(争的人里有女的就换说法):东方"诸子争立" / "兄妹争立" / "诸女争立";
 * 西幻"诸子争位" / "王子公主争位" / "诸公主争位"
 */
export function rivalsWord(group: readonly Sexed[], east: boolean): string {
  const f = group.filter(isFemale).length;
  if (!f) return east ? '诸子争立' : '诸子争位';
  if (f === group.length) return east ? '诸女争立' : '诸公主争位';
  return east ? '兄妹争立' : '王子公主争位';
}

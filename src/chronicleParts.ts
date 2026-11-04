/**
 * 编年史在后台线程里算好,分块交给主线程(src/worker.ts 交,src/ui/chronicleHandoff.ts 收)。
 *
 * 很长的历史(推到几万年)编年史有上万条,在主线程上整段算一遍要好几秒,界面那几秒拖不动、点不动;
 * 算好了一次交过去,主线程拆包也要一百来毫秒。所以在线程里算,按份量切成小块一块一块交:每块拆包只占主线程几毫秒,
 * 块与块之间界面照样响应。交过去的是存进世界的那一块(gen/civ/story/nameTokens.ts)换回名字的样子:第一次看到的和以后打开读到的同一份文字。
 */
import { applyCharacters, type AuthorCharacter } from './gen/characters';
import type { ChronicleEntry } from './gen/civ/story/chronicle';
import { chronicleBlock, chronicleOfBlock, inBuildChronicle, type ChronicleBlock } from './gen/civ/story/nameTokens';
import { applyNames } from './gen/edits';
import type { Civ } from './gen/civ';

/** 一块的份量:一条算 1,折叠进来的每一件事再各算 1(六万年的历史约 8 万份,切成二十几块,每块拆包几毫秒) */
export const PART_WEIGHT = 3000;

export interface ChroniclePart {
  /** 这一份编年史的编号(线程里递增;随后交历史的那条消息带着同一个编号) */
  key: number;
  /** 第几块、一共几块 */
  part: number;
  of: number;
  /** 按哪份改名算的(gen/edits.ts 的 WorldEdits.names) */
  names: Record<string, string>;
  /** 套了哪些作者人物的名字和性别(authorsKey) */
  authors: string;
  /** fullChronicle 里按顺序的这一段 */
  entries: ChronicleEntry[];
  /** 和 entries 一一对应:1 = 这一条也在 buildChronicle 里(按顺序) */
  build: Uint8Array;
}

/** 套了哪些作者人物的名字和性别(编年史里写到的作者立的君主、没即位成的人物):一样的两份,编年史逐字一样;一个女的都没有时只看名字 */
export const authorsKey = (civ: Civ) => (civ.authorFemale?.length ? JSON.stringify([civ.authorNames ?? null, civ.authorFemale]) : JSON.stringify(civ.authorNames ?? null));

/**
 * 这份历史套上改名、人物卡以后的编年史切成块,连同算它的那一块(存进世界用)。
 * stored = 世界里存的那一块:能用就用它,以后改了编年史的写法老世界的文字不变;人物卡的性别改过、读不懂就现算一块
 */
export function chronicleOf(civ: Civ, names: Record<string, string>, key: number, characters?: readonly AuthorCharacter[], stored?: ChronicleBlock | null, weight = PART_WEIGHT): { block: ChronicleBlock; parts: ChroniclePart[] } {
  // 浅拷一层再算:线程里的缓存按这个对象记,交完就放掉,不跟着线程里记着的历史一直占着内存
  const named = applyCharacters(applyNames({ ...civ }, names), characters);
  const authors = authorsKey(named);
  if (stored) {
    let entries: ChronicleEntry[] | null = null;
    try {
      entries = chronicleOfBlock(stored, named);
    } catch {
      entries = null;
    }
    if (entries) return { block: stored, parts: cutParts(entries, names, authors, key, weight) };
  }
  const block = chronicleBlock(civ, characters);
  return { block, parts: cutParts(chronicleOfBlock(block, named)!, names, authors, key, weight) };
}

/** 这份历史套上改名以后的编年史,切成块(没有作者人物、不用存时) */
export function chronicleParts(civ: Civ, names: Record<string, string>, key: number, weight = PART_WEIGHT): ChroniclePart[] {
  return chronicleOf(civ, names, key, undefined, null, weight).parts;
}

function cutParts(full: readonly ChronicleEntry[], names: Record<string, string>, authors: string, key: number, weight: number): ChroniclePart[] {
  const cuts: number[] = [0];
  let w = 0;
  for (let i = 0; i < full.length; i++) {
    w += 1 + (full[i].children?.length ?? 0);
    if (w >= weight && i + 1 < full.length) {
      cuts.push(i + 1);
      w = 0;
    }
  }
  cuts.push(full.length);
  const of = cuts.length - 1;
  return Array.from({ length: of }, (_, k) => {
    const entries = full.slice(cuts[k], cuts[k + 1]);
    return { key, part: k, of, names, authors, entries, build: Uint8Array.from(entries, (e) => (inBuildChronicle(e) ? 1 : 0)) };
  });
}

/** 收齐了的一份(同一个编号、块数对得上、按顺序)拼回去;不齐 = null */
export function joinChronicleParts(parts: readonly ChroniclePart[], key: number): { names: Record<string, string>; authors: string; build: ChronicleEntry[]; full: ChronicleEntry[] } | null {
  if (!parts.length || parts.length !== parts[0].of || parts.some((p, i) => p.key !== key || p.part !== i)) return null;
  const full: ChronicleEntry[] = [];
  const build: ChronicleEntry[] = [];
  for (const p of parts) {
    for (let i = 0; i < p.entries.length; i++) {
      const e = p.entries[i];
      full.push(e);
      if (p.build[i]) build.push(e);
    }
  }
  return { names: parts[0].names, authors: parts[0].authors, build, full };
}

/**
 * 编年史在后台线程里算好,分块交给主线程(src/worker.ts 交,src/ui/chronicleHandoff.ts 收)。
 *
 * 很长的历史(推到几万年)编年史有上万条,在主线程上整段算一遍要好几秒,界面那几秒拖不动、点不动;
 * 算好了一次交过去,主线程拆包也要一百来毫秒。所以在线程里算,按份量切成小块一块一块交:每块拆包只占主线程几毫秒,
 * 块与块之间界面照样响应。交过去的就是 buildChronicle / fullChronicle 的结果本身,主线程记进缓存,和在主线程上算的逐条一样。
 */
import { buildChronicle, type ChronicleEntry } from './gen/civ/chronicle';
import { fullChronicle } from './gen/civ/religionText';
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
  /** fullChronicle 里按顺序的这一段 */
  entries: ChronicleEntry[];
  /** 和 entries 一一对应:1 = 这一条也在 buildChronicle 里(按顺序) */
  build: Uint8Array;
}

/** 这份历史套上改名以后的编年史(fullChronicle 和其中 buildChronicle 的那些条),切成块 */
export function chronicleParts(civ: Civ, names: Record<string, string>, key: number, weight = PART_WEIGHT): ChroniclePart[] {
  // 浅拷一层再算:线程里的缓存按这个对象记,交完就放掉,不跟着线程里记着的历史一直占着内存
  const named = applyNames({ ...civ }, names);
  const build = new Set(buildChronicle(named));
  const full = fullChronicle(named);
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
    return { key, part: k, of, names, entries, build: Uint8Array.from(entries, (e) => (build.has(e) ? 1 : 0)) };
  });
}

/** 收齐了的一份(同一个编号、块数对得上、按顺序)拼回去;不齐 = null */
export function joinChronicleParts(parts: readonly ChroniclePart[], key: number): { names: Record<string, string>; build: ChronicleEntry[]; full: ChronicleEntry[] } | null {
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
  return { names: parts[0].names, build, full };
}

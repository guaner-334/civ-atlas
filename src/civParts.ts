/**
 * 一份历史从后台线程交给主线程时(src/worker.ts 交,src/ui/App.tsx、galleryHelper.ts 收),条数多的几个列表
 * (人物、纪事、城镇)先切成几段,一段一条消息先交;随后交历史的那一条带着同一个编号(split),那几个列表在它里面是空的。
 *
 * 为什么:消息到了主线程要拆包(把线程那边的对象一个一个重建出来),整份历史一次拆完,六万年的历史电脑上约 0.1 秒、
 * 手机上半秒左右,这期间界面拖不动、点不动。切成几段,每段单独拆包只占主线程几毫秒,段与段之间界面照样响应。
 *
 * 收的那边先把各段收着(CivPartInbox),交历史的那一条到了,把各段按顺序拼回那几个列表,再交给别处用 ——
 * 别处拿到的总是拼好的整份,拿不到半份。同一个线程发的消息按发出的顺序到,各段都在交历史的那一条之前发出。
 * 拼回来的和整份一次交过来的逐项一样(各段里的人物、纪事、城镇只在这几个列表里出现,不和历史别处共用同一个对象)。
 */
import type { Civ } from './gen/civ/types';

/** 切哪几个列表 */
export type CivPartField = 'people' | 'annals' | 'settlements';

/** 每段多少条:按拆包的份量定,一段在电脑上拆包约 3–6 毫秒(人物带着领兵记录,最重;纪事最轻) */
export const CIV_PART_SIZE: Record<CivPartField, number> = { people: 4000, annals: 10000, settlements: 400 };

const FIELDS: CivPartField[] = ['people', 'annals', 'settlements'];

export interface CivPart {
  /** 这份历史的编号(线程里递增;随后交历史的那条消息带着同一个编号) */
  split: number;
  field: CivPartField;
  /** 这个列表一共几条(拼好以后核对) */
  total: number;
  /** 这一段(按顺序) */
  items: unknown[];
}

/** 交历史的那一条带的:编号、先交了几段 */
export interface CivSplit {
  key: number;
  parts: number;
}

/**
 * 切:返回先发的几段、随后交历史那一条要带的历史(切了的列表换成空的;传进来的 civ 不改)。
 * 哪个列表都不超过一段的长度 = 不切(parts 是空的,civ 原样)
 */
export function splitCiv(civ: Civ, split: number, size: Record<CivPartField, number> = CIV_PART_SIZE): { parts: CivPart[]; civ: Civ } {
  const parts: CivPart[] = [];
  let rest: Civ | null = null;
  for (const field of FIELDS) {
    const list = civ[field] as unknown[] | undefined;
    const n = size[field];
    if (!list || list.length <= n) continue;
    for (let i = 0; i < list.length; i += n) parts.push({ split, field, total: list.length, items: list.slice(i, i + n) });
    rest ??= { ...civ };
    (rest as unknown as Record<CivPartField, unknown[]>)[field] = [];
  }
  return { parts, civ: rest ?? civ };
}

/** 收的那边:先到的各段收着,交历史的那一条到了拼回去 */
export class CivPartInbox {
  private got = new Map<number, CivPart[]>();

  /** 收下一段 */
  take(p: CivPart): void {
    let list = this.got.get(p.split);
    if (!list) this.got.set(p.split, (list = []));
    list.push(p);
  }

  /**
   * 交历史的那一条(带着 split:编号、一共几段)到了:各段按顺序拼回 civ 的那几个列表(就地改,别处还没拿到它)。
   * 这一份和更早的各段都放掉(更早的是过时的消息带的,不会再有人要)。没收齐 = 出错(不该发生):抛出去,不交半份
   */
  join(civ: Civ, split: CivSplit): void {
    const parts = this.got.get(split.key) ?? [];
    for (const k of [...this.got.keys()]) if (k <= split.key) this.got.delete(k);
    if (parts.length !== split.parts) throw new Error(`历史没收齐(${parts.length} / ${split.parts} 段)`);
    const out = civ as unknown as Record<CivPartField, unknown[]>;
    for (const field of FIELDS) {
      const mine = parts.filter((p) => p.field === field);
      if (!mine.length) continue;
      const list: unknown[] = [];
      for (const p of mine) for (const x of p.items) list.push(x);
      if (list.length !== mine[0].total) throw new Error(`历史的 ${field} 没收齐(${list.length} / ${mine[0].total})`);
      out[field] = list;
    }
  }

  /** 线程换了一个(旧线程交了一半的不要了) */
  drop(): void {
    this.got.clear();
  }
}

/**
 * 照人物卡上一段经历开的国家的事那一页(lifeIv.ts 文件头):开着的是哪一页、照哪一段经历(一个小 store,不碰 DOM)。
 * 这时候下的令记在他名下(stampLife,pendingStore.ts 下令时调用)。放在单独的小文件里:单子(首页就有)只用到这一点,
 * 不把人物卡那一套带进首页。
 */
import { useSyncExternalStore } from 'react';
import { AUTHOR_IV_KINDS, type Intervention } from '../gen/edits';

/** 国家的事十种(记在他名下) */
export type LifeNationKind = 'ally' | 'treaty' | 'neutral' | 'move' | 'cede' | 'destroy' | 'found' | 'policy' | 'disaster' | 'trek';

/** 照哪一段经历填的:人物、名字、他 / 她、那段经历的年份和那句话;kind = 国家的事开的是哪一种,polity / region = 开到哪一国 / 哪一州 */
export interface LifeTag {
  char: number;
  name: string;
  he: string;
  year: number;
  text: string;
  kind?: LifeNationKind;
  polity?: number;
  region?: number;
  /** 什么时候点的(Date.now();点了以后那一页没开起来,过一会儿就不算了) */
  at?: number;
}

/** 点了以后多久之内开起来的那一页才算照经历开的(毫秒) */
const OPEN_WITHIN = 5000;

let tag: LifeTag | null = null;
/** 那一页开着(页顶写着「照这段经历填好了」):这时候下的令才记在他名下 */
let held: LifeTag | null = null;
const subs = new Set<() => void>();

export function getLifeTag(): LifeTag | null {
  return tag;
}

export function setLifeTag(t: LifeTag | null) {
  if (t === tag) return;
  tag = t;
  for (const f of subs) f();
}

export function useLifeTag(): LifeTag | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getLifeTag,
    getLifeTag,
  );
}

/** 这一页是不是照经历开的那一页(国家的事:种类、国家 / 州对得上) */
export function lifeTagFor(t: LifeTag | null, kinds: readonly LifeNationKind[], at: { polity?: number; region?: number }): LifeTag | null {
  if (!t || !t.kind || !kinds.includes(t.kind)) return null;
  if (t !== held && t.at !== undefined && Date.now() - t.at > OPEN_WITHIN) return null;
  if (at.polity !== undefined && t.polity !== at.polity) return null;
  if (at.region !== undefined && t.region !== at.region) return null;
  return t;
}

/** 那一页开着(LifeHead.tsx 挂上时调用;返回关掉时调用的,收起这一份) */
export function holdLifeTag(t: LifeTag): () => void {
  held = t;
  setLifeTag(t);
  return () => {
    if (held === t) held = null;
    if (tag === t) setLifeTag(null);
  };
}

/**
 * 下令时(pendingStore.ts 的 queueIntervention):照经历开着国家的事那一页,这一条记在他名下 —— 带 author、单子上的话后面加"（林小满之议）"。
 * 不是 = null
 */
export function stampLife(v: Intervention, text: string): { v: Intervention; text: string } | null {
  const t = held;
  if (!t?.kind || !AUTHOR_IV_KINDS.includes(v.kind) || v.author !== undefined) return null;
  return { v: { ...v, author: t.char }, text: `${text}（${t.name}之议）` };
}

/** 记在他名下的那一条加进单子了:这一份用掉(页顶那一块收起,这一页之后再下的令照普通的) */
export function lifeTagUsed() {
  if (!held) return;
  held = null;
  setLifeTag(null);
}

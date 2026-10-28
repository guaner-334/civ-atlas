/**
 * 人物关系图(RelationGraph.tsx)开没开、以谁为中心、走过的路径。
 *
 *   openRelationOf(civ, ref)  人物卡「更多 → 关系图」:以他为中心打开(刚才那张图的中心就是他 = 接着刚才那张,路径还在)
 *   goRelation(step)       点图上的人:换他居中(路径里前面有他 = 退回到那一步,后面的留着能再进)
 *   backRelation / fwdRelation / jumpRelation(i)   ‹ ›、点路径里前面的名字
 *   closeRelation          × / 在地图上看 / 手机上看人物卡:收起(中心、路径留着,地图左上「回到关系图」再打开)
 *   peekRelation(ref)      「只看他的人物卡」:左边卡片换成他,中心不换
 *   setRelationDeep(on)    多看一层(null = 照自动;换中心时回到自动)
 *
 * 推演人物记下稳定键(重推以后编号变了按它找回);左边卡片跟着中心换人由 RelationGraph.tsx 照 stamp 做。
 */
import { useSyncExternalStore } from 'react';
import type { Civ } from '../gen/civ/types';
import { personKey } from '../gen/characters';
import type { RelRef } from './relationInfo';

/** 路径上的一步:人,和推演人物的稳定键(作者的人物、算不出键的 = '') */
export interface RelStep {
  ref: RelRef;
  key: string;
}

export interface RelState {
  open: boolean;
  path: RelStep[];
  /** 现在的中心是路径上第几步 */
  at: number;
  deep: boolean | null;
  /** 「只看他的人物卡」那位(左边卡片是他,不算换了中心) */
  peek: RelRef | null;
  /** 中心每换一次加一 */
  stamp: number;
}

let state: RelState = { open: false, path: [], at: 0, deep: null, peek: null, stamp: 0 };
const subs = new Set<() => void>();

function set(patch: Partial<RelState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}

export function getRelation(): RelState {
  return state;
}

export function useRelation(): RelState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
    () => state,
  );
}

/** 两步是不是同一个人(推演人物有键的按键认) */
export function sameStep(a: RelStep, b: RelStep): boolean {
  if (a.ref.kind !== b.ref.kind) return false;
  if (a.ref.kind === 'person' && a.key && b.key) return a.key === b.key;
  return a.ref.id === b.ref.id;
}

/** 现在的中心(没有 = null) */
export function relationCenter(s: RelState = state): RelStep | null {
  return s.path[s.at] ?? null;
}

/** 一个人在路径上的一步(推演人物带稳定键) */
export function relStep(civ: Civ, ref: RelRef): RelStep {
  return { ref, key: ref.kind === 'person' ? personKey(civ, ref.id) : '' };
}

/** 人物卡「更多 → 关系图」 */
export function openRelationOf(civ: Civ, ref: RelRef) {
  openRelation(relStep(civ, ref));
}

export function openRelation(step: RelStep) {
  const cur = relationCenter();
  if (cur && sameStep(cur, step)) return set({ open: true, peek: null, path: state.path.map((p, i) => (i === state.at ? step : p)) });
  set({ open: true, path: [step], at: 0, deep: null, peek: null, stamp: state.stamp + 1 });
}

export function goRelation(step: RelStep) {
  const i = state.path.slice(0, state.at + 1).findIndex((p) => sameStep(p, step));
  if (i === state.at) return set({ peek: null });
  if (i >= 0) return set({ at: i, deep: null, peek: null, stamp: state.stamp + 1 });
  set({ path: [...state.path.slice(0, state.at + 1), step], at: state.at + 1, deep: null, peek: null, stamp: state.stamp + 1 });
}

export function jumpRelation(i: number) {
  if (i < 0 || i >= state.path.length || i === state.at) return;
  set({ at: i, deep: null, peek: null, stamp: state.stamp + 1 });
}

export function backRelation() {
  jumpRelation(state.at - 1);
}

export function fwdRelation() {
  jumpRelation(state.at + 1);
}

export function closeRelation() {
  if (state.open || state.peek) set({ open: false, peek: null });
}

export function reopenRelation() {
  if (state.path.length) set({ open: true, peek: null, stamp: state.stamp + 1 });
}

export function peekRelation(ref: RelRef | null) {
  set({ peek: ref });
}

export function setRelationDeep(deep: boolean | null) {
  if (state.deep !== deep) set({ deep });
}

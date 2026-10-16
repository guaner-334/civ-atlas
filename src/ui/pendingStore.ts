/**
 * 待推演的单子:国家、州、城的命令和地形大事都先排在这里,点「全部推演」才一起加进修改、只重推一次
 * (从单子里最早的那一年起;单子见 PendingTray.tsx,国家干预页底部也有「全部推演」)。
 *
 * - 每一条记下生效年份和当时的说法("大鳞王朝:保护""火山喷发"),单子上照着写,不随历史变。
 * - 只在这次打开网页时有效:换世界、读档(editsStore.setEdits)就清空;不存进存档。
 * - 推演:editsStore.addEditsBatch 一次加进去(⌘Z 一次撤掉整批)。只有一条、从国家 / 城下的令,照原来那样
 *   推演时面板先藏起、地图上浮出两国名牌(panelStore.startRun);几条一起时不浮名牌。推完的提示在 App.tsx。
 */
import { useSyncExternalStore } from 'react';
import { cleanIntervention, type Intervention, type Upheaval } from '../gen/edits';
import { cleanUpheaval, UPHEAVALS_MAX } from '../gen/terrainEdits';
import { addEditsBatch, editBlock, getEdits, interventionKeys, onEditsReset } from './editsStore';
import { startRun, type IvRun } from './panelStore';
import { showToast } from './toastStore';

/** 只推这一条时,推演中地图上浮出的名牌(下令的国家、对象;同 panelStore.IvRun) */
export type PendingRun = Omit<IvRun, 't0' | 'from'>;

export type Pending = {
  id: number;
  /** 生效年份 / 发生在哪一年 */
  from: number;
  /** 单子上的说法(年份写成"第 N 年",显示时按纪年换写法) */
  text: string;
} & ({ kind: 'iv'; v: Intervention; run?: PendingRun } | { kind: 'up'; u: Upheaval });

let items: readonly Pending[] = [];
let nextId = 1;
const subs = new Set<() => void>();
const set = (next: readonly Pending[]) => {
  items = next;
  for (const f of subs) f();
};

onEditsReset(() => {
  if (items.length) set([]);
});

export function getPending(): readonly Pending[] {
  return items;
}

export function usePending(): readonly Pending[] {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    getPending,
    getPending,
  );
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 这条干预已经在单子里了 */
export function pendingHas(v: Intervention): boolean {
  const c = cleanIntervention(v);
  return !!c && items.some((x) => x.kind === 'iv' && same(x.v, c));
}

/** 单子里的干预(下令的面板据此判断"已在待推演里") */
export function pendingInterventions(list: readonly Pending[] = items): Intervention[] {
  return list.flatMap((x) => (x.kind === 'iv' ? [x.v] : []));
}

/** 单子里的地形大事有几件 */
export function pendingUpheavals(list: readonly Pending[] = items): number {
  return list.filter((x) => x.kind === 'up').length;
}

/** 加一条干预进单子:加上了 = null,加不了 = 原因(现在不能改、已经下过、已经在单子里) */
export function queueIntervention(v: Intervention, text: string, run?: PendingRun): string | null {
  const c = cleanIntervention(v);
  if (!c) return '这条命令下不了';
  const blocked = editBlock(interventionKeys(c));
  if (blocked) return blocked;
  if (getEdits().interventions.some((x) => same(x, c))) return '这条命令已经下过了';
  if (pendingHas(c)) return '这条命令已经在待推演里了';
  set([...items, { id: nextId++, from: c.from, text, kind: 'iv', v: c, run }]);
  return null;
}

/** 加一件地形大事进单子:加上了 = null,加不了 = 原因 */
export function queueUpheaval(u: Upheaval, text: string): string | null {
  const c = cleanUpheaval(u);
  if (!c) return '这件地形大事放不了';
  if ((getEdits().upheavals?.length ?? 0) + pendingUpheavals() >= UPHEAVALS_MAX) return `地形大事最多 ${UPHEAVALS_MAX} 件`;
  set([...items, { id: nextId++, from: c.year, text, kind: 'up', u: c }]);
  return null;
}

export function removePending(id: number) {
  if (items.some((x) => x.id === id)) set(items.filter((x) => x.id !== id));
}

export function clearPending() {
  if (items.length) set([]);
}

/** 全部推演:一次加进修改、清空单子。现在不能改(助手"先在地图上看看"时)= 提示条说原因,单子留着 */
export function pushPending() {
  const list = items;
  if (!list.length) return;
  const ivs = pendingInterventions(list);
  const blocked = ivs.map((v) => editBlock(interventionKeys(v))).find(Boolean);
  if (blocked) {
    showToast({ id: 'edit-block', kind: 'warn', text: blocked });
    return;
  }
  const ups = list.flatMap((x) => (x.kind === 'up' ? [x.u] : []));
  const from = Math.min(...list.map((x) => x.from));
  const one = list.length === 1 && list[0].kind === 'iv' ? list[0] : null;
  // 推演时面板先藏起(推完回到信息页);只有一条、知道下令的国家:地图上浮出两国名牌
  startRun(one?.kind === 'iv' && one.run ? { ...one.run, from } : { self: -1, target: null, from });
  set([]);
  addEditsBatch(ivs, ups);
}

/**
 * 待推演的单子:国家、州、城的命令和地形大事都先排在这里,点「全部推演」才一起加进修改、只重推一次
 * (从单子里最早的那一年起;单子见 PendingTray.tsx,国家干预页底部也有「全部推演」)。
 *
 * - 每一条记下生效年份和当时的说法("大鳞王朝:保护""火山喷发"),单子上照着写,不随历史变。
 * - 只在这次打开网页时有效:换世界、读档(editsStore.setEdits)就清空;不存进存档。
 * - 推演:editsStore.addEditsBatch 一次加进去(⌘Z 一次撤掉整批)。只有一条、从国家 / 城下的令,照原来那样
 *   推演时面板先藏起、地图上浮出两国名牌(panelStore.startRun);几条一起时不浮名牌。推完的提示在 App.tsx。
 */
import { createListeners } from './createStore';
import { cleanIntervention, type Intervention, type Upheaval, type WorldEdits } from '../gen/edits';
import { cleanUpheaval, UPHEAVALS_MAX } from '../gen/terrainEdits';
import { addEditsBatch, editBlock, getEdits, interventionKeys, onEditsReset } from './editsStore';
import { startRun, type IvRun } from './panelStore';
import { showToast } from './toastStore';
import { lifeTagUsed, stampLife } from './lifeTag';

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
const subs = createListeners();
const set = (next: readonly Pending[]) => {
  items = next;
  subs.emit();
};

onEditsReset(() => {
  if (items.length) set([]);
});

export function getPending(): readonly Pending[] {
  return items;
}

export function usePending(): readonly Pending[] {
  return subs.use(getPending);
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
  // 照人物卡上一段经历开的国家的事那一页:记在他名下(lifeTag.ts)
  const st = stampLife(v, text);
  if (st) ({ v, text } = st);
  const c = cleanIntervention(v);
  if (!c) return '这条命令下不了';
  const blocked = editBlock(interventionKeys(c));
  if (blocked) return blocked;
  if (getEdits().interventions.some((x) => same(x, c))) return '这条命令已经下过了';
  if (pendingHas(c)) return '这条命令已经在待推演里了';
  set([...items, { id: nextId++, from: c.from, text, kind: 'iv', v: c, run }]);
  if (st) lifeTagUsed();
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

/** 交出去的那几条没推成(逐年推演的一步没算成):放回单子最前面,照原来的先后(还在单子里的不重复放) */
export function restorePending(list: readonly Pending[]) {
  const back = list.filter((x) => !items.some((y) => y.id === x.id));
  if (back.length) set([...back, ...items]);
}

export function clearPending() {
  if (items.length) set([]);
}

/**
 * 逐年推演:下一步开始时,单子里的干预一起交出去(生效年份都换成这一步开头的那一年 year,下在"现在"),从单子里拿掉。
 * 地形大事不在逐年推演里下(不动)
 */
export function takeStepCommands(year: number): Intervention[] {
  const ivs = items.filter((x): x is Pending & { kind: 'iv' } => x.kind === 'iv');
  if (!ivs.length) return [];
  set(items.filter((x) => x.kind !== 'iv'));
  return ivs.map((x) => ({ ...x.v, from: year }) as Intervention);
}

/** 最近一次全部推演真加上了的几条(App 推完据此给整批的提示和撤销;edits = 加上以后的修改) */
let batch: { edits: WorldEdits; ivs: Intervention[]; ups: Upheaval[] } | null = null;

/** 修改是 e 时:这是不是刚才全部推演加上的那一批(取一次就没了) */
export function takePendingBatch(e: WorldEdits): { ivs: Intervention[]; ups: Upheaval[] } | null {
  if (!batch || batch.edits !== e) return null;
  const b = batch;
  batch = null;
  return { ivs: b.ivs, ups: b.ups };
}

/**
 * 全部推演:一次加进修改,加上了的从单子里拿掉。现在不能改(助手"先在地图上看看"时)= 提示条说原因,单子留着。
 * 排进来以后修改又变了(撤销 / 重做):已经下过的干预直接拿掉;地形大事满了加不上的留在单子里,提示说原因
 */
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
  const added = addEditsBatch(ivs, ups);
  // 照原样打开的旧世界:App 在问要不要另存一份再推演,单子留着(取消了还在)
  if (!added) return;
  // 地形大事从前往后加,满了就停:加上了几件,后面的留在单子里
  const left = list.filter((x) => x.kind === 'up').slice(added.ups.length);
  set(left);
  if (left.length) showToast({ id: 'edit-block', kind: 'warn', text: `${left.length} 件地形大事没加上:每个世界最多 ${UPHEAVALS_MAX} 件` });
  const n = added.ivs.length + added.ups.length;
  if (!n) return;
  batch = { edits: getEdits(), ivs: added.ivs, ups: added.ups };
  const from = Math.min(...added.ivs.map((v) => v.from), ...added.ups.map((u) => u.year));
  const one = n === 1 && added.ivs.length === 1 ? list.find((x) => x.kind === 'iv' && same(x.v, added.ivs[0])) : undefined;
  // 推演时面板先藏起(推完回到信息页);只有一条、知道下令的国家:地图上浮出两国名牌
  startRun(one?.kind === 'iv' && one.run ? { ...one.run, from } : { self: -1, target: null, from });
}

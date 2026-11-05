/**
 * AI 写的东西(史书、释名……)按世界存(阶段 5)。登录了网站账号的,跟着世界同步进账号(account/sync.ts)。
 * 世界 = saveStore 的世界编号(每个世界一个);浏览器存储不可用(隐私模式)时只在内存里。
 * 内存里有一份,每次用之前和浏览器里的原文对一下(同一个网站开了几个标签页,别的标签页可能改过)。
 * 只是看看的世界(打开的种子、分享链接)存进一条:这个世界跟着存进"我的世界",刷新以后还找得到。
 *
 * 各功能用自己的 kind 区分("史书""释名"……),key 由功能自己定(比如 "史书:polity:c4567#0" 或 "释名:settlement:c123#0")。
 *
 * 存在哪:正文存在世界仓库里,实现在 ./libraryVault.ts。它不在首页那一份里,用到才下,下好了接到这里(connectNotes);进了世界里它一开始就接上了。
 * 这里只留对外的函数和只用 localStorage 的老办法。老办法在三种时候用:浏览器存不了仓库(隐私模式、没有 IndexedDB),
 * 仓库这次打开用不了,首页上代码还没下好。还没下好时读 localStorage 里有的,写也先写 localStorage,下好了再照做一遍;
 * 这时候 notesKnown 是 false,要整份往外交的先 await notesReady。
 */
import { useSyncExternalStore } from 'react';
import { allWorldIds, keepWorld, persistent } from '../ui/saveStore';

export interface AiNote {
  /** 功能内唯一的键 */
  key: string;
  /** 哪个功能写的:"史书""释名"…… */
  kind: string;
  /** 显示用的标题 */
  title: string;
  text: string;
  /** ISO 时间 */
  createdAt: string;
  provider: string;
  model: string;
}

/** ./libraryVault.ts 接上来的那一边 */
export interface VaultSide {
  /** 这次打开用得上仓库 */
  live(): boolean;
  list(world: string): AiNote[];
  put(world: string, note: AiNote): boolean;
  copy(from: string, to: string): boolean;
  del(world: string, key: string): void;
  saved(world: string): boolean;
  lagging(world: string): AiNote[] | null;
  replace(world: string, list: AiNote[]): boolean;
  forget(world?: string): void;
  ready(worlds: Iterable<string>): Promise<void>;
  known(world: string): boolean;
  flush(world: string): Promise<boolean>;
  withDrafts(world: string, list: AiNote[]): AiNote[];
  localSaved(world: string): void;
}

const PREFIX = 'civ-atlas:ai-notes:';
const mem = new Map<string, AiNote[]>();
/** 内存里那份对应的浏览器原文(别的标签页改了,原文就对不上了,重读) */
const seen = new Map<string, string | null>();
/** 存储满了、页面里有没写进浏览器的笔记的世界(写成功一次、或换成浏览器里的原文就去掉) */
const behind = new Set<string>();
const subs = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const f of subs) f();
};

let side: VaultSide | null = null;
let fetching: Promise<unknown> | null = null;
let fails = 0;
/** 代码还没下好时的改动:下好了照做一遍 */
const waiting: ((v: VaultSide) => void)[] = [];

const canVault = () => typeof indexedDB !== 'undefined' && typeof Worker !== 'undefined' && persistent();

/** 把仓库那边的代码下下来;下不来(断网)的试几次就算了,这次打开走老办法 */
function fetchSide(): Promise<unknown> {
  if (side || fails >= 3 || !canVault()) return Promise.resolve();
  return (fetching ??= import('./libraryVault').then(
    () => (fetching = null),
    () => {
      fetching = null;
      fails++;
    },
  ));
}

const live = () => (side?.live() ? side : null);

function whenConnected(f: (v: VaultSide) => void): void {
  if (side || !canVault()) return;
  waiting.push(f);
  void fetchSide();
}

/** ./libraryVault.ts 一载入就调 */
export function connectNotes(v: VaultSide): void {
  side = v;
  if (v.live()) {
    mem.clear();
    seen.clear();
    behind.clear();
  }
  for (const f of waiting.splice(0)) f(v);
  emit();
}

/** 浏览器里存着的原文;undefined = 浏览器存储用不了(隐私模式) */
function stored(world: string): string | null | undefined {
  try {
    return localStorage.getItem(PREFIX + world);
  } catch {
    return undefined;
  }
}

function parseList(raw: string | null | undefined): AiNote[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => x && typeof x.key === 'string' && typeof x.text === 'string') : [];
  } catch {
    /* 坏数据:当作没有 */
    return [];
  }
}

function readLocal(world: string): AiNote[] {
  const raw = stored(world);
  const m = mem.get(world);
  if (m && (raw === undefined || seen.get(world) === raw)) return m;
  const parsed = parseList(raw);
  const list = side ? side.withDrafts(world, parsed) : parsed;
  mem.set(world, list);
  seen.set(world, raw ?? null);
  behind.delete(world);
  return list;
}

/** 返回写进浏览器没有(浏览器本来就不让存、整个只在内存里的,算写进去了) */
function writeLocal(world: string, list: AiNote[]): boolean {
  mem.set(world, list);
  let ok = true;
  try {
    const raw = list.length ? JSON.stringify(list) : null;
    if (raw) localStorage.setItem(PREFIX + world, raw);
    else localStorage.removeItem(PREFIX + world);
    seen.set(world, raw);
    behind.delete(world);
    side?.localSaved(world);
  } catch {
    /* 存不下 / 隐私模式:只留在内存里(浏览器里还是原来那份,别的标签页没改它就一直用内存里的) */
    ok = !persistent();
    seen.set(world, stored(world) ?? null);
    if (!ok) behind.add(world);
  }
  emit();
  return ok;
}

/** ./libraryVault.ts 用的老办法那几样 */
export const notesLocal = {
  emit,
  stored,
  parseList,
  write: writeLocal,
  /** 手上读到的留在页面里 */
  hold(world: string, list: AiNote[]) {
    mem.set(world, list);
    seen.set(world, stored(world) ?? null);
  },
  isBehind: (world: string) => behind.has(world),
  clear() {
    mem.clear();
    seen.clear();
    behind.clear();
  },
};

function read(world: string): AiNote[] {
  const v = live();
  if (v) return v.list(world);
  void fetchSide();
  return readLocal(world);
}

// 别的标签页写了、删了笔记:这里跟着重画(重读时按原文对上没有)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === null || e.key.startsWith(PREFIX)) emit();
  });
}

export function listNotes(world: string, kind?: string): AiNote[] {
  const list = read(world);
  return kind ? list.filter((n) => n.kind === kind) : list.slice();
}

export function getNote(world: string, key: string): AiNote | undefined {
  return read(world).find((n) => n.key === key);
}

/** 存一条(同 key 覆盖);返回写进浏览器没有(存储满了 = false,这一条只在页面里) */
export function putNote(world: string, note: AiNote): boolean {
  const v = live();
  let ok: boolean;
  if (v) ok = v.put(world, note);
  else {
    whenConnected((s) => s.put(world, note));
    ok = writeLocal(world, [...readLocal(world).filter((n) => n.key !== note.key), note]);
  }
  keepWorld(world);
  return ok;
}

/**
 * 把一个世界的 AI 笔记复制给另一个世界(我的世界里"复制一份"时用)。内存里的一定带上;
 * 原来那份存在浏览器里、复制的这份存不下(存储满了)= false,原来那份本来就只在内存里的不算
 */
export function copyNotes(from: string, to: string): boolean {
  const v = live();
  if (v) return v.copy(from, to);
  // 代码还没下好:下好了在仓库里复制,这里只是先带上手上有的,写不下也不算没存下
  const early = !side && canVault();
  whenConnected((s) => s.copy(from, to));
  const list = readLocal(from);
  if (!list.length) return true;
  mem.set(to, list.slice());
  seen.set(to, stored(to) ?? null);
  emit();
  // 原来那份在浏览器里没有(隐私模式、存不下只在内存里):复制的这份也只放内存里
  if (!stored(from)) return true;
  try {
    const raw = JSON.stringify(list);
    localStorage.setItem(PREFIX + to, raw);
    seen.set(to, raw);
    behind.delete(to);
    return true;
  } catch {
    if (early) return true;
    if (persistent()) behind.add(to);
    return false;
  }
}

export function deleteNote(world: string, key: string): void {
  const v = live();
  if (v) return v.del(world, key);
  whenConnected((s) => s.del(world, key));
  const list = readLocal(world);
  if (!list.some((n) => n.key === key)) return;
  writeLocal(
    world,
    list.filter((n) => n.key !== key),
  );
}

/** 一个世界的笔记原样(同步用)。整份往外交之前先 await notesReady,不然可能只有手上那一部分 */
export function exportNotes(world: string): AiNote[] {
  return read(world).slice();
}

/** 这个世界的笔记都写进浏览器了没有(存储满了、只留在页面里的 = false;浏览器本来就不让存的算写进去了) */
export function notesSaved(world: string): boolean {
  const v = live();
  if (v) return v.saved(world);
  const list = readLocal(world);
  const raw = stored(world);
  if (raw === undefined || !persistent()) return true;
  return (list.length ? JSON.stringify(list) : null) === raw;
}

/**
 * 存储满了、这个世界有没写进浏览器的笔记:返回浏览器里存着的那份(界面拿它对出哪些只在页面里);
 * 都写进去了、浏览器本来就不让存 = null
 */
export function notesBehind(world: string): AiNote[] | null {
  const v = live();
  if (v) return v.lagging(world);
  readLocal(world);
  if (!behind.has(world)) return null;
  const raw = stored(world);
  if (raw === undefined || !persistent()) return null;
  return parseList(raw);
}

/**
 * 同步下来的笔记换上(null / 空 = 没有);不存这个世界(它已经在"我的世界"里了)。返回写进浏览器没有(存储满了 = false)。
 * 还没读到这个世界存着的那份:只并进去,不去掉东西(没读到的不算不要了)
 */
export function replaceNotes(world: string, list: AiNote[] | null): boolean {
  const clean = (list ?? []).filter((x) => x && typeof x.key === 'string' && typeof x.text === 'string');
  const v = live();
  if (v) return v.replace(world, clean);
  if (side || !canVault()) return writeLocal(world, clean);
  whenConnected((s) => s.replace(world, clean));
  const keys = new Set(clean.map((n) => n.key));
  return writeLocal(world, [...readLocal(world).filter((n) => !keys.has(n.key)), ...clean]);
}

/** 世界删掉了:内存里的也忘掉(浏览器里的由 saveStore 删;仓库里的 worldStore 过些时候清,撤销了还在) */
export function forgetNotes(world?: string): void {
  side?.forget(world);
  if (world === undefined) {
    waiting.length = 0;
    notesLocal.clear();
  } else {
    mem.delete(world);
    seen.delete(world);
    behind.delete(world);
  }
  emit();
}

/** 这几个世界(不给 = 全部)读过仓库了才往下走;读得太久也往下走,这时候 notesKnown 是 false */
export async function notesReady(worlds: Iterable<string> = allWorldIds()): Promise<void> {
  const ids = [...worlds];
  if (!ids.length) return;
  await fetchSide();
  await live()?.ready(ids);
}

/** 手上这份是不是这个世界的全部;false = 仓库没读到,不许拿它去掉东西、盖掉账号里的那份 */
export function notesKnown(world: string): boolean {
  if (side) return side.known(world);
  if (!canVault()) return true;
  void fetchSide();
  return false;
}

/** 等这个世界排着的都写进仓库;写进去了(或者不用仓库)= true。写得太久(后台线程卡住了)= false,接着在后台写 */
export async function flushNotes(world: string): Promise<boolean> {
  await fetchSide();
  const v = live();
  return v ? v.flush(world) : !behind.has(world);
}

/** 笔记变了就调 f(返回取消函数) */
export function subscribeNotes(f: () => void): () => void {
  subs.add(f);
  return () => void subs.delete(f);
}

/** React:某个世界的笔记变了就重渲染(返回一个递增的版本号) */
export function useNotesVersion(): number {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => version,
    () => version,
  );
}

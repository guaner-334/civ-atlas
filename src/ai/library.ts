/**
 * AI 写的东西(史书、释名……)按世界存(阶段 5)。登录了网站账号的,跟着世界同步进账号(account/sync.ts)。
 * 世界 = saveStore 的世界编号(每个世界一个);浏览器存储不可用(隐私模式)时只在内存里。
 * 只是看看的世界(打开的种子、分享链接)存进一条:这个世界跟着存进"我的世界",刷新以后还找得到。
 *
 * 各功能用自己的 kind 区分("史书""释名"……),key 由功能自己定(比如 "史书:polity:c4567#0" 或 "释名:settlement:c123#0")。
 *
 * 存在哪:正文以世界仓库的 author 块为准(worldVault.ts 的 readAuthor、changeAuthor),不受 localStorage 总共 5 MB 的限制。
 * 这里的函数都是同步的,仓库在后台线程里:页面里留一份,改动先改这一份,再排队写进仓库。
 *
 * 写:改动按操作(authorNotes.ts 的 NoteOp)发给仓库,写一次一批。写之前先把排着的操作存一份草稿进 localStorage(DRAFT,每个标签页一份):
 * 关页面关得快、仓库没写完,下次打开接着写。存不下草稿(太长、localStorage 满了)不算丢,等仓库写好。
 * 仓库也写不进去:整份退回写进 localStorage(和以前一样),再写不进才算只在页面里(notesBehind),过一会儿再试。
 *
 * 读:第一次用到一个世界时在后台读仓库,读到了换上,通知界面重画。读到之前手上是 localStorage 里那份加上排着的操作,
 * 所以「页面里没有」不等于「用的人删了」:读到之前、没读到时(notesKnown = false)都不许按它去掉东西。
 * 要整份往外交的(同步进账号、存成文件)先 await notesReady。
 *
 * 老数据(localStorage 里以前存的整份,PREFIX + 世界编号):读到仓库以后并进去(什么都不去掉,同一条留新的),写完读回来逐条核对,
 * 对上了记进 MOVED(那份原文的指纹),之后不再当正文读:用的人删了的不会因为旧的那份还在就回来。
 * 旧的那份不马上清,放 KEEP_MS:测试网站和正式网站共用一个 localStorage,旧版本的网站只认这份,清了它就看不到正文,账号同步还会把账号里的冲掉。
 * localStorage 写不下时(存档、草稿)随时清掉核对过的,腾出地方(freeRoom)。没核对过的绝不清。
 * 旧版网站又写过那份(指纹对不上)就再并一遍。
 *
 * 仓库用不了(浏览器不给 IndexedDB、后台线程起不来)退回只用 localStorage(goLocal,之后走 readLocal、writeLocal),和以前一样。
 *
 * 几个标签页:操作是在仓库里最新的那份上改的,谁也盖不掉谁;写完用 BroadcastChannel 告诉别的标签页重读。
 */
import { useSyncExternalStore } from 'react';
import { applyNoteOps, cleanNoteList, fullNote, mergeNotes, notNewer, sameNote, sameNotes, type NoteOp } from '../authorNotes';
import type { VaultErrorKind } from '../worldVault';
import { allWorldIds, keepWorld, persistent, setNotesHooks } from '../ui/saveStore';

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

/** 仓库这边要的两样;读不了、写不了抛错,错上带 kind(VaultErrorKind) */
export interface NotesVault {
  read(id: string): Promise<{ notes: AiNote[]; unread?: true }>;
  change(id: string, ops: readonly NoteOp[]): Promise<{ count: number }>;
}

const PREFIX = 'civ-atlas:ai-notes:';
/** 排着、还没写进仓库的操作(后面跟世界编号、~、哪个标签页)。世界编号不会以 ~ 开头 */
const DRAFT = `${PREFIX}~`;
/** 这个标签页这次打开的记号:几个标签页的草稿不互相盖、不互相删 */
const TAB = `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 4).toString(36)}`;
/** 哪些世界的正文已经在仓库里(世界编号 → Moved) */
const MOVED = `${PREFIX}~~moved`;
/** 核对过的旧的那份留多久(毫秒):比正式网站跟上测试网站的间隔(一周)长,回退版本也来得及 */
const KEEP_MS = 14 * 24 * 3600_000;
/** 写不进仓库、读不了的,过多久再试(毫秒);单测调短 */
const timing = { retry: 30_000, readyWait: 8_000, flushWait: 60_000 };
/** 再试几次;再不行等下一次改动 */
const RETRIES = 5;
/** 连着这么多次说不清原因的失败(后台线程起不来、代码下不来):这次打开退回只用 localStorage */
const STREAK_MAX = 3;

interface Moved {
  /** 核对过的那份旧原文的指纹;旧的那份不在了、一开始就没有 = null */
  s: string | null;
  /** 什么时候核对的 */
  t: number;
  /** 仓库里最后一次写完有几条:读出来比这少又不是用的人删的 = 仓库丢过东西 */
  n: number;
}

// ---------------------------------------------------------------------------
// localStorage 那几样

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

/** 原文的指纹(同步算,看一份旧的有没有被动过) */
function hashOf(s: string): string {
  let a = 0xdeadbeef;
  let b = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 2654435761);
    b = Math.imul(b ^ c, 1597334677);
  }
  return `${s.length}.${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

function movedAll(): Record<string, Moved> {
  try {
    const v = JSON.parse(localStorage.getItem(MOVED) ?? '{}') as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, Moved>) : {};
  } catch {
    return {};
  }
}

/** 记下来;写不下 = false */
function setMoved(world: string, m: Moved | null): boolean {
  const all = movedAll();
  if (m) all[world] = m;
  else delete all[world];
  try {
    if (Object.keys(all).length) localStorage.setItem(MOVED, JSON.stringify(all));
    else localStorage.removeItem(MOVED);
    return true;
  } catch {
    return false;
  }
}

/** 清掉核对过的旧的那份;force = 不等 KEEP_MS(localStorage 写不下了)。返回清了几份 */
function releaseOld(force: boolean, now = Date.now()): number {
  let gone = 0;
  for (const [id, m] of Object.entries(movedAll())) {
    if (!force && now - m.t < KEEP_MS) continue;
    const raw = stored(id);
    if (!raw || hashOf(raw) !== m.s) continue;
    try {
      localStorage.removeItem(PREFIX + id);
      gone++;
    } catch {
      /* 删不掉就算了 */
    }
  }
  return gone;
}

/** 这个世界各个标签页留下的草稿 */
function draftKeys(world: string): string[] {
  const head = `${DRAFT}${world}~`;
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(head)) out.push(k);
    }
  } catch {
    /* 看不了就当没有 */
  }
  return out;
}

function draftsOf(keys: readonly string[]): NoteOp[] {
  const out: NoteOp[] = [];
  for (const k of keys) {
    try {
      const v = JSON.parse(localStorage.getItem(k) ?? '[]') as unknown;
      if (Array.isArray(v)) out.push(...(v as NoteOp[]));
    } catch {
      /* 坏数据:当作没有 */
    }
  }
  return out;
}

function dropDrafts(keys: readonly string[]): void {
  for (const k of keys) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* 删不掉就算了,再写一遍也一样 */
    }
  }
}

/** 这个标签页排着的操作存一份;存不下 = false(上一份草稿还在:都是还没写进去的,下次打开照样有用) */
function writeDraft(world: string, ops: readonly NoteOp[]): boolean {
  const key = `${DRAFT}${world}~${TAB}`;
  try {
    if (!ops.length) {
      localStorage.removeItem(key);
      return true;
    }
    const text = JSON.stringify(ops);
    try {
      localStorage.setItem(key, text);
    } catch {
      if (!releaseOld(true)) return false;
      localStorage.setItem(key, text);
    }
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 这次打开的状态

const subs = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  for (const f of subs) f();
};

/** 存储满了、页面里有没写进浏览器的笔记的世界(写成功一次、或换成浏览器里的原文就去掉) */
const behind = new Set<string>();

/** 一个世界在页面里的样子(用仓库时) */
interface Slot {
  /** 页面里这份:仓库里的 + 排着的操作 */
  list: AiNote[];
  /** 写稳了的那份(notesBehind 用) */
  disk: AiNote[];
  /** 读过仓库了(不管读没读到) */
  loaded: boolean;
  /** 最近一次读到了 */
  read: boolean;
  /** 读到了仓库里的全部 */
  known: boolean;
  ops: NoteOp[];
  flying: boolean;
  /** 这次打开用的人去掉的条(核对旧的那份时不算少了) */
  removed: Set<string>;
  /** 打开时读到的上次留下的草稿(已经在 ops 里了,写进仓库以后去掉) */
  oldDrafts: string[];
  ready: Promise<void>;
  markReady: () => void;
  /** 等排着的都写完的 */
  waiters: ((ok: boolean) => void)[];
  timer?: ReturnType<typeof setTimeout>;
  tries: number;
  /** 读的时候又有了新消息:读完再读一遍 */
  again: boolean;
  reading: boolean;
  /** 正在核对旧的那份 */
  settling: Promise<void>;
}

const slots = new Map<string, Slot>();

/** undefined = 还没看浏览器行不行 */
let vault: NotesVault | null | undefined;
/** 这次打开仓库用不了了 */
let down = false;
let streak = 0;

/** 仓库的代码不在首页那一份里,用到才下 */
const lazyVault: NotesVault = {
  read: (id) => import('../ui/worldStore').then((m) => m.notesVault.read(id)),
  change: (id, ops) => import('../ui/worldStore').then((m) => m.notesVault.change(id, ops)),
};

function vaultOf(): NotesVault | null {
  if (vault === undefined) vault = typeof indexedDB !== 'undefined' && typeof Worker !== 'undefined' && persistent() ? lazyVault : null;
  return vault;
}

const live = () => !down && !!vaultOf();

let channel: BroadcastChannel | null | undefined;
function channelOf(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = new BroadcastChannel('civ-atlas:ai-notes');
    channel.onmessage = (e: MessageEvent<{ world?: unknown }>) => {
      if (typeof e.data?.world === 'string') reload(e.data.world);
    };
    (channel as unknown as { unref?: () => void }).unref?.();
  } catch {
    channel = null;
  }
  return channel;
}

// ---------------------------------------------------------------------------
// 用仓库时:读

function slotOf(world: string): Slot {
  const had = slots.get(world);
  if (had) return had;
  const oldDrafts = draftKeys(world);
  const ops = draftsOf(oldDrafts);
  const first = cleanNoteList(parseList(stored(world)));
  let markReady = () => {};
  const ready = new Promise<void>((r) => (markReady = r));
  const s: Slot = { list: applyNoteOps(first, ops), disk: first, loaded: false, read: false, known: false, ops, flying: false, removed: new Set(), oldDrafts, ready, markReady, waiters: [], tries: 0, again: false, reading: false, settling: Promise.resolve() };
  slots.set(world, s);
  channelOf();
  void load(world, s);
  return s;
}

/** 读一遍仓库,换上 */
async function load(world: string, s: Slot): Promise<void> {
  if (s.reading) {
    s.again = true;
    return;
  }
  s.reading = true;
  try {
    let got: Awaited<ReturnType<NotesVault['read']>>;
    try {
      got = await vaultOf()!.read(world);
    } catch (e) {
      if (slots.get(world) === s) readFailed(world, s, e);
      return;
    }
    streak = 0;
    if (slots.get(world) !== s) return;
    const raw = stored(world);
    const m = movedAll()[world];
    // 旧的那份:没核对过的并进来。核对过的不再读,除非仓库比记的少(丢过东西),拿它补
    const fromOld = raw && (hashOf(raw) !== m?.s || got.notes.length < (m?.n ?? 0)) ? cleanNoteList(parseList(raw)).filter((n) => !s.removed.has(n.key)) : [];
    const merged = fromOld.length ? mergeNotes(got.notes, fromOld) : got.notes;
    const next = applyNoteOps(merged, s.ops);
    const changed = !sameNotes(next, s.list);
    s.list = next;
    s.disk = merged;
    s.known = !got.unread && merged.length >= (m?.n ?? 0);
    s.loaded = true;
    s.read = true;
    s.tries = 0;
    s.markReady();
    if (!sameNotes(merged, got.notes)) s.ops.unshift({ op: 'merge', notes: fromOld });
    if (changed) emit();
    if (s.ops.length) kick(world, s);
    else void settle(world, s);
  } finally {
    s.reading = false;
    if (s.again && slots.get(world) === s) {
      s.again = false;
      void load(world, s);
    }
  }
}

function readFailed(world: string, s: Slot, e: unknown): void {
  if (giveUp(e)) return goLocal();
  // 没读到:手上这份不算数。localStorage 里没有记录也说明不了仓库里没有(满的时候记不下)
  s.known = false;
  s.loaded = true;
  s.read = false;
  s.markReady();
  later(world, s);
}

/** 这个错说明这次打开仓库用不了 */
function giveUp(e: unknown): boolean {
  const kind = (e as { kind?: VaultErrorKind } | null)?.kind;
  if (kind === 'unavailable') return true;
  if (kind) return false;
  return ++streak >= STREAK_MAX;
}

/** 过一会儿再读、再写 */
function later(world: string, s: Slot): void {
  if (s.timer !== undefined || s.tries >= RETRIES) return;
  s.tries++;
  s.timer = setTimeout(() => {
    s.timer = undefined;
    if (slots.get(world) !== s) return;
    if (!s.read) void load(world, s);
    else kick(world, s);
  }, timing.retry);
}

function reload(world: string): void {
  const s = slots.get(world);
  if (s) void load(world, s);
}

// ---------------------------------------------------------------------------
// 用仓库时:写

/** 改页面里这份、排队写进仓库;返回这回的改动至少有一处能留到下次打开 */
function change(world: string, op: NoteOp): boolean {
  const s = slotOf(world);
  const next = applyNoteOps(s.list, [op]);
  if (op.op === 'del') s.removed.add(op.key);
  if (op.op === 'set') for (const n of s.list) if (!next.some((x) => x.key === n.key)) s.removed.add(n.key);
  if (sameNotes(next, s.list) && !s.ops.length && s.loaded && s.known) return true;
  s.list = next;
  s.ops.push(op);
  const drafted = writeDraft(world, s.ops);
  s.tries = 0;
  kick(world, s);
  emit();
  return drafted || !behind.has(world);
}

function kick(world: string, s: Slot): void {
  if (s.flying || !s.ops.length || down) return;
  s.flying = true;
  const batch = s.ops.slice();
  vaultOf()!.change(world, batch).then(
    (r) => {
      s.flying = false;
      streak = 0;
      if (slots.get(world) !== s) return;
      // 写的这一会儿前面可能又插进来操作(读到了要并的旧正文):按这一批是哪几个去掉,不按位置
      s.ops = s.ops.filter((o) => !batch.includes(o));
      writeDraft(world, s.ops);
      dropDrafts(s.oldDrafts.splice(0));
      s.disk = applyNoteOps(s.disk, batch);
      const was = behind.delete(world);
      channelOf()?.postMessage({ world });
      const m = movedAll()[world];
      const mark: Moved = { s: m?.s ?? null, t: m?.t ?? Date.now(), n: s.known ? r.count : (m?.n ?? 0) };
      if (!setMoved(world, mark) && releaseOld(true)) setMoved(world, mark);
      if (was) emit();
      if (s.ops.length) return kick(world, s);
      for (const f of s.waiters.splice(0)) f(true);
      void settle(world, s);
    },
    (e: unknown) => {
      s.flying = false;
      if (slots.get(world) !== s) return;
      if (giveUp(e)) return goLocal();
      // 写不进仓库:整份退回写进 localStorage,写不进才算只在页面里
      let ok = false;
      try {
        localStorage.setItem(PREFIX + world, JSON.stringify(s.list));
        s.disk = s.list;
        ok = true;
      } catch {
        ok = false;
      }
      if (ok) behind.delete(world);
      else behind.add(world);
      for (const f of s.waiters.splice(0)) f(false);
      emit();
      later(world, s);
    },
  );
}

/**
 * 回读核对旧的那份:都在仓库里了就记下来,之后不再读它。
 * 对不上、读不了:什么都不记,旧的那份留着,下次打开再来一遍
 */
function settle(world: string, s: Slot): Promise<void> {
  s.settling = s.settling.then(() => settleOld(world, s)).catch(() => {});
  return s.settling;
}

async function settleOld(world: string, s: Slot): Promise<void> {
  if (!s.known || s.ops.length || slots.get(world) !== s) return;
  const raw = stored(world);
  if (!raw) return;
  const m = movedAll()[world];
  const sum = hashOf(raw);
  if (m?.s === sum) return;
  const back = await vaultOf()!.read(world);
  // 读的工夫又改了:下次再说
  if (back.unread || s.ops.length || slots.get(world) !== s || stored(world) !== raw) return;
  const have = new Map(back.notes.map((n) => [n.key, n]));
  const ok = cleanNoteList(parseList(raw)).every((n) => {
    if (s.removed.has(n.key)) return true;
    const v = have.get(n.key);
    return !!v && (sameNote(v, n) || notNewer(n, v));
  });
  if (!ok) return;
  if (setMoved(world, { s: sum, t: Date.now(), n: back.notes.length })) return;
  // 连这一小条都记不下(localStorage 满得厉害):不记下来下次还会当新的并进去(删了的会回来),核对过了,清掉
  try {
    localStorage.removeItem(PREFIX + world);
  } catch {
    /* 删不掉就算了 */
  }
}

/** 仓库用不了:手上的整份写回 localStorage,接下来都只用它 */
function goLocal(): void {
  if (down) return;
  down = true;
  for (const [world, s] of slots) {
    clearTimeout(s.timer);
    // 写不回去的:草稿留着,下次打开接着用。手上读到的都留在页面里,这次打开照样看得到
    if (s.ops.length) writeLocal(world, s.list);
    else if (s.loaded) {
      mem.set(world, s.list);
      seen.set(world, stored(world) ?? null);
    }
    s.markReady();
    for (const f of s.waiters.splice(0)) f(!behind.has(world));
  }
  slots.clear();
  emit();
}

// ---------------------------------------------------------------------------
// 只用 localStorage:仓库用不了、隐私模式

const mem = new Map<string, AiNote[]>();
/** 内存里那份对应的浏览器原文(别的标签页改了,原文就对不上了,重读) */
const seen = new Map<string, string | null>();

function readLocal(world: string): AiNote[] {
  const raw = stored(world);
  const m = mem.get(world);
  if (m && (raw === undefined || seen.get(world) === raw)) return m;
  const parsed = parseList(raw);
  // 仓库用不了的时候留下的草稿(整份写不回 localStorage 的那几条)
  const list = down ? applyNoteOps(parsed, draftsOf(draftKeys(world))) : parsed;
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
    if (down) dropDrafts(draftKeys(world));
  } catch {
    /* 存不下 / 隐私模式:只留在内存里(浏览器里还是原来那份,别的标签页没改它就一直用内存里的) */
    ok = !persistent();
    seen.set(world, stored(world) ?? null);
    if (!ok) behind.add(world);
  }
  emit();
  return ok;
}

const read = (world: string): AiNote[] => (live() ? slotOf(world).list : readLocal(world));

// 别的标签页写了、删了笔记:这里跟着重画(重读时按原文对上没有)。用仓库时旧版网站写了那份旧的也要重读,别的走 BroadcastChannel
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== null && !e.key.startsWith(PREFIX)) return;
    if (live() && e.key && !e.key.startsWith(DRAFT)) reload(e.key.slice(PREFIX.length));
    emit();
  });
}

// localStorage 写不下存档时先清掉核对过的旧正文;撤销删除时核对过的旧正文写不回去也不挡着(仓库里有)
setNotesHooks({
  freeRoom: () => live() && releaseOld(true) > 0,
  safeElsewhere: (world, raw) => live() && movedAll()[world]?.s === hashOf(raw),
});

// ---------------------------------------------------------------------------
// 对外

export function listNotes(world: string, kind?: string): AiNote[] {
  const list = read(world);
  return kind ? list.filter((n) => n.kind === kind) : list.slice();
}

export function getNote(world: string, key: string): AiNote | undefined {
  return read(world).find((n) => n.key === key);
}

/** 存一条(同 key 覆盖);返回写进浏览器没有(存储满了 = false,这一条只在页面里) */
export function putNote(world: string, note: AiNote): boolean {
  const ok = live() ? change(world, { op: 'put', note: fullNote(note) }) : writeLocal(world, [...readLocal(world).filter((n) => n.key !== note.key), note]);
  keepWorld(world);
  return ok;
}

/**
 * 把一个世界的 AI 笔记复制给另一个世界(我的世界里"复制一份"时用)。内存里的一定带上;
 * 原来那份存在浏览器里、复制的这份存不下(存储满了)= false,原来那份本来就只在内存里的不算
 */
export function copyNotes(from: string, to: string): boolean {
  if (live()) {
    const f = slotOf(from);
    // 原来那份还没读到:读到了再复制,读到之前手上的先带上
    const copy = () => {
      if (f.list.length) change(to, { op: 'merge', notes: f.list.slice() });
    };
    const ok = !f.list.length || change(to, { op: 'merge', notes: f.list.slice() });
    if (!f.loaded) void f.ready.then(copy);
    return ok;
  }
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
    if (persistent()) behind.add(to);
    return false;
  }
}

export function deleteNote(world: string, key: string): void {
  const list = read(world);
  if (live()) {
    // 还没读到的那份里可能有:照发,仓库里有就删
    const s = slotOf(world);
    if (s.loaded && s.known && !list.some((n) => n.key === key)) return;
    change(world, { op: 'del', key });
    return;
  }
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
  if (live()) {
    slotOf(world);
    return !behind.has(world);
  }
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
  if (live()) {
    const s = slotOf(world);
    return behind.has(world) ? s.disk.slice() : null;
  }
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
  if (!live()) return writeLocal(world, clean);
  const s = slotOf(world);
  const notes = clean.map((n) => fullNote(n));
  if (s.loaded && s.known) return change(world, { op: 'set', notes });
  return !notes.length || change(world, { op: 'merge', notes });
}

/** 世界删掉了:内存里的也忘掉(浏览器里的由 saveStore 删;仓库里的 worldStore 过些时候清,撤销了还在) */
export function forgetNotes(world?: string): void {
  if (world === undefined) {
    for (const s of slots.values()) clearTimeout(s.timer);
    for (const id of slots.keys()) dropDrafts(draftKeys(id));
    slots.clear();
    mem.clear();
    seen.clear();
    behind.clear();
  } else {
    const s = slots.get(world);
    if (s) {
      clearTimeout(s.timer);
      dropDrafts(draftKeys(world));
      slots.delete(world);
    }
    mem.delete(world);
    seen.delete(world);
    behind.delete(world);
  }
  emit();
}

/** 先读好这个世界的正文(打开世界时调:等用的人点开面板,已经读好了) */
export function warmNotes(world: string): void {
  if (live()) slotOf(world);
}

/** 这几个世界(不给 = 全部)读过仓库了才往下走;读得太久也往下走,这时候 notesKnown 是 false */
export async function notesReady(worlds: Iterable<string> = allWorldIds()): Promise<void> {
  if (!live()) return;
  const ready = [...worlds].map((id) => slotOf(id).ready);
  if (!ready.length) return;
  let t: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(ready), new Promise((r) => (t = setTimeout(r, timing.readyWait)))]);
  clearTimeout(t);
}

/** 手上这份是不是这个世界的全部;false = 仓库没读到,不许拿它去掉东西、盖掉账号里的那份 */
export function notesKnown(world: string): boolean {
  if (!vaultOf()) return true;
  if (down) return !(world in movedAll());
  const s = slotOf(world);
  return s.loaded && s.known;
}

/** 等这个世界排着的都写进仓库;写进去了(或者不用仓库)= true。写得太久(后台线程卡住了)= false,接着在后台写 */
export function flushNotes(world: string): Promise<boolean> {
  if (!live()) return Promise.resolve(!behind.has(world));
  const s = slotOf(world);
  if (!s.ops.length) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), timing.flushWait);
    s.waiters.push((ok) => {
      clearTimeout(t);
      resolve(ok);
    });
    kick(world, s);
  });
}

/** 老数据转进仓库这一步走完:读过、写了、核对过(后台一个一个世界调) */
export async function moveNotes(world: string): Promise<void> {
  if (!live()) return;
  await notesReady([world]);
  await flushNotes(world);
  // 读到了、写好了才核对(核对时自己也会看)
  const s = slots.get(world);
  if (s) await settle(world, s);
}

/** 过了 KEEP_MS 的旧的那份清掉;世界清掉了的记录去掉(worldStore 定时调) */
export function tidyNotes(gone?: string): void {
  if (!vaultOf()) return;
  if (gone !== undefined) {
    forgetNotes(gone);
    setMoved(gone, null);
  }
  if (live()) releaseOld(false);
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

/** 单测用:等手上排着的、正在核对的都做完 */
export async function _notesSettled(): Promise<void> {
  for (const [world, s] of slots) {
    await s.ready;
    await flushNotes(world);
    await s.settling;
  }
}

/** 单测用:换掉仓库(null = 只用 localStorage,undefined = 看浏览器)、时间;清掉这次打开的状态,就像刷新了页面 */
export function _resetNotes(o: { vault?: NotesVault | null; timing?: Partial<typeof timing> } = {}): void {
  for (const s of slots.values()) clearTimeout(s.timer);
  slots.clear();
  mem.clear();
  seen.clear();
  behind.clear();
  vault = o.vault;
  down = false;
  streak = 0;
  Object.assign(timing, o.timing);
}

/**
 * AI 正文存进世界仓库的那一大块(ai/library.ts 是对外的函数,这里是它接上的实现)。不在首页那一份里,用到才下;下好了接到 library.ts。
 *
 * 存在哪:正文以世界仓库的 author 块为准(worldVault.ts 的 readAuthor、changeAuthor),不受 localStorage 总共 5 MB 的限制。
 * 对外的函数都是同步的,仓库在后台线程里:页面里留一份,改动先改这一份,再排队写进仓库。
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
 * 仓库用不了(浏览器不给 IndexedDB、后台线程起不来)退回只用 localStorage(goLocal,之后走 library.ts 里的老办法),和以前一样。
 *
 * 几个标签页:操作是在仓库里最新的那份上改的,谁也盖不掉谁;写完用 BroadcastChannel 告诉别的标签页重读。
 */
import { applyNoteOps, cleanNoteList, fullNote, mergeNotes, notNewer, sameNote, sameNotes, type NoteOp } from '../authorNotes';
import type { VaultErrorKind } from '../worldVault';
import { persistent, setNotesHooks } from '../ui/saveStore';
import { connectNotes, forgetNotes, notesLocal, type AiNote, type VaultSide } from './library';

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

const { emit, stored, parseList } = notesLocal;

// ---------------------------------------------------------------------------
// localStorage 那几样

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

/** 仓库和 localStorage 都写不进、只在页面里的世界 */
const behind = new Set<string>();

/** 一个世界在页面里的样子 */
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
  /** 还没读到就要复制的世界:读到了再带一遍 */
  copyTo: string[];
  ready: Promise<void>;
  markReady: () => void;
  /** 等排着的都写完的 */
  waiters: ((ok: boolean) => void)[];
  timer?: ReturnType<typeof setTimeout>;
  tries: number;
  /** 读的时候又有了新消息:读完再读一遍 */
  again: boolean;
  reading: boolean;
  /** 正在读的这一会儿写进仓库的操作:读到的可能是写之前的样子,要补上 */
  sinceRead: NoteOp[];
  /** 正在核对旧的那份 */
  settling: Promise<void>;
}

const slots = new Map<string, Slot>();

/** undefined = 还没看浏览器行不行 */
let vault: NotesVault | null | undefined;
/** 这次打开仓库用不了了 */
let down = false;
let streak = 0;

/** 仓库的调用在 ui/worldStore.ts(它也用这个文件),用到才取 */
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
// 读

function slotOf(world: string): Slot {
  const had = slots.get(world);
  if (had) return had;
  const oldDrafts = draftKeys(world);
  const ops = draftsOf(oldDrafts);
  const first = cleanNoteList(parseList(stored(world)));
  // 上次留下的草稿里删掉的也算这次删的:核对旧的那份时不算少了,不会并回来
  const removed = new Set<string>();
  let before = first;
  for (const o of ops) before = trackRemoved(removed, before, o);
  let markReady = () => {};
  const ready = new Promise<void>((r) => (markReady = r));
  const s: Slot = { list: applyNoteOps(first, ops), disk: first, loaded: false, read: false, known: false, ops, flying: false, removed, oldDrafts, copyTo: [], ready, markReady, waiters: [], tries: 0, again: false, reading: false, sinceRead: [], settling: Promise.resolve() };
  slots.set(world, s);
  channelOf();
  void load(world, s);
  return s;
}

/** 改完是什么样;这一步去掉的条记下来 */
function trackRemoved(removed: Set<string>, list: AiNote[], op: NoteOp): AiNote[] {
  const next = applyNoteOps(list, [op]);
  if (op.op === 'del') removed.add(op.key);
  if (op.op === 'set') for (const n of list) if (!next.some((x) => x.key === n.key)) removed.add(n.key);
  return next;
}

/** 读一遍仓库,换上 */
async function load(world: string, s: Slot): Promise<void> {
  if (s.reading) {
    s.again = true;
    return;
  }
  s.reading = true;
  s.sinceRead = [];
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
    const written = applyNoteOps(merged, s.sinceRead);
    const next = applyNoteOps(written, s.ops);
    const known = !got.unread && merged.length >= (m?.n ?? 0);
    const changed = !sameNotes(next, s.list) || known !== s.known;
    s.list = next;
    s.disk = written;
    s.known = known;
    s.loaded = true;
    s.read = true;
    s.tries = 0;
    s.markReady();
    if (!sameNotes(merged, got.notes)) s.ops.unshift({ op: 'merge', notes: fromOld });
    if (changed) emit();
    for (const to of s.copyTo.splice(0)) if (s.list.length) change(to, { op: 'merge', notes: s.list.slice() });
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
// 写

/** 改页面里这份、排队写进仓库;返回这回的改动至少有一处能留到下次打开 */
function change(world: string, op: NoteOp): boolean {
  const s = slotOf(world);
  const next = trackRemoved(s.removed, s.list, op);
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
      if (s.reading) s.sinceRead.push(...batch);
      writeDraft(world, s.ops);
      dropDrafts(s.oldDrafts.splice(0));
      s.disk = applyNoteOps(s.disk, batch);
      const was = behind.delete(world);
      channelOf()?.postMessage({ world });
      const m = movedAll()[world];
      // 没读到时不知道一共几条,记的数只减用的人删掉的:不然下次读出来比记的少,会当成仓库丢了东西
      const dels = batch.filter((o) => o.op === 'del').length;
      const mark: Moved = { s: m?.s ?? null, t: m?.t ?? Date.now(), n: s.known ? r.count : Math.max(0, (m?.n ?? 0) - dels) };
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
      const was = behind.has(world);
      if (ok) behind.delete(world);
      else behind.add(world);
      for (const f of s.waiters.splice(0)) f(false);
      // 只有状态变了才通知:每次失败都通知的话,账号同步每一轮都会再排一轮
      if (was === ok) emit();
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
    if (s.ops.length) notesLocal.write(world, s.list);
    else if (s.loaded) notesLocal.hold(world, s.list);
    s.markReady();
    for (const f of s.waiters.splice(0)) f(!notesLocal.isBehind(world));
  }
  slots.clear();
  emit();
}

// 别的标签页:旧版网站写了那份旧的要重读(自己的走 BroadcastChannel);选了从这台设备上删掉,手上排着的不再写回去
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === 'civ-atlas:vault-cleared') return forgetNotes();
    if (live() && e.key?.startsWith(PREFIX) && !e.key.startsWith(DRAFT)) reload(e.key.slice(PREFIX.length));
  });
}

// localStorage 写不下存档时先清掉核对过的旧正文;撤销删除时核对过的旧正文写不回去也不挡着(仓库里有)
setNotesHooks({
  freeRoom: () => live() && releaseOld(true) > 0,
  safeElsewhere: (world, raw) => live() && movedAll()[world]?.s === hashOf(raw),
});

// ---------------------------------------------------------------------------
// 接到 library.ts

const side: VaultSide = {
  live,
  list: (world) => slotOf(world).list,
  put(world, note) {
    const s = slotOf(world);
    // 没读到时这一条是照手上不全的那份改的(一部书少了几版):只并进去,不换掉
    return change(world, s.read && s.known ? { op: 'put', note: fullNote(note) } : { op: 'merge', notes: [fullNote(note)] });
  },
  copy(from, to) {
    const f = slotOf(from);
    // 原来那份还没读到(读不了的过一会儿再试):读到了再复制一遍,读到之前手上的先带上
    if (!f.read) f.copyTo.push(to);
    return !f.list.length || change(to, { op: 'merge', notes: f.list.slice() });
  },
  del(world, key) {
    // 还没读到的那份里可能有:照发,仓库里有就删
    const s = slotOf(world);
    if (s.loaded && s.known && !s.list.some((n) => n.key === key)) return;
    change(world, { op: 'del', key });
  },
  saved(world) {
    slotOf(world);
    return !behind.has(world);
  },
  lagging(world) {
    const s = slotOf(world);
    return behind.has(world) ? s.disk.slice() : null;
  },
  replace(world, list) {
    const s = slotOf(world);
    const notes = list.map((n) => fullNote(n));
    // 还没读到这个世界存着的那份:只并进去,不去掉东西(没读到的不算不要了)
    if (s.loaded && s.known) return change(world, { op: 'set', notes });
    return !notes.length || change(world, { op: 'merge', notes });
  },
  forget(world) {
    if (world === undefined) {
      for (const s of slots.values()) clearTimeout(s.timer);
      for (const id of slots.keys()) dropDrafts(draftKeys(id));
      slots.clear();
      behind.clear();
      return;
    }
    const s = slots.get(world);
    if (s) {
      clearTimeout(s.timer);
      dropDrafts(draftKeys(world));
      slots.delete(world);
    }
    behind.delete(world);
  },
  async ready(worlds) {
    const ready = [...worlds].map((id) => slotOf(id).ready);
    if (!ready.length) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(ready), new Promise((r) => (t = setTimeout(r, timing.readyWait)))]);
    clearTimeout(t);
  },
  known(world) {
    if (!vaultOf()) return true;
    if (down) return !(world in movedAll());
    const s = slotOf(world);
    return s.loaded && s.known;
  },
  flush(world) {
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
  },
  // 仓库用不了的时候留下的草稿(整份写不回 localStorage 的那几条)
  withDrafts: (world, list) => (down ? applyNoteOps(list, draftsOf(draftKeys(world))) : list),
  localSaved(world) {
    if (down) dropDrafts(draftKeys(world));
  },
};

connectNotes(side);

// ---------------------------------------------------------------------------
// ui/worldStore.ts 用的几样

/** 先读好这个世界的正文(打开世界时调:等用的人点开面板,已经读好了) */
export function warmNotes(world: string): void {
  if (live()) slotOf(world);
}

/** 老数据转进仓库这一步走完:读过、写了、核对过(后台一个一个世界调) */
export async function moveNotes(world: string): Promise<void> {
  if (!live()) return;
  await side.ready([world]);
  await side.flush(world);
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

/** 单测用:等手上排着的、正在核对的都做完 */
export async function _notesSettled(): Promise<void> {
  for (const [world, s] of slots) {
    await s.ready;
    await side.flush(world);
    await s.settling;
  }
}

/** 单测用:换掉仓库(null = 只用 localStorage,undefined = 看浏览器)、时间;清掉这次打开的状态,就像刷新了页面 */
export function _resetNotes(o: { vault?: NotesVault | null; timing?: Partial<typeof timing> } = {}): void {
  for (const s of slots.values()) clearTimeout(s.timer);
  slots.clear();
  behind.clear();
  notesLocal.clear();
  vault = o.vault;
  down = false;
  streak = 0;
  Object.assign(timing, o.timing);
}

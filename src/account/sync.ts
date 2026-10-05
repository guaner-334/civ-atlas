/**
 * 云同步:登录了网站账号,"我的世界"里的世界(存档、几项本地信息、缩略图、AI 写的东西)自动存进账号,
 * 换电脑、换手机登录同一个账号就能接着改。服务器只管"版本号对上才存"(cloud.ts),怎么合并在这里定:
 *
 * - 记着每个世界上次同步到的版本号(rev)和那时内容的指纹(sum);指纹变了 = 这台设备上改过
 *   (存在 localStorage 'civ-atlas:sync',跟着账号:换了账号从头来,这台设备上的世界都存进新账号)
 * - 什么时候同步:登录后、打开网页时、回到这个页面 / 联网时、每分钟一次(都是"全看一遍");
 *   改了以后 2 秒(只把改过的存上去,不看服务器那边)
 * - 全看一遍时逐个对:
 *     只有服务器变了   → 取回来覆盖本地
 *     只有本地变了     → 带上次的版本号存上去
 *     两边都变了       → 两份都留:本地这份照旧用原来的编号存上去,服务器那份另存成一个新世界,名字后面加"(另一台设备)"
 *     服务器上删了     → 本地没改过就跟着删;改过就存回去(改过的那份赢)
 *     服务器上有、本地没有 → 取回来("我的世界"满了就先不取);本地有、服务器上没有 → 存上去
 * - 用户删掉一个世界(saveStore 的 deleteWorld):带上次的版本号去删;断网、没登录时先记着,下次同步时删
 *   (为了腾地方删掉的旧世界不算,账号里的还在)
 * - 正在看的那个世界不被别的设备的改动覆盖、删掉:提示一句,点"载入"再换(回到"我的世界"以后照常同步)
 * - 没同步上(断网、服务器出错)的,"我的世界"卡片上写"还没同步上",下次再试
 */
import { useSyncExternalStore } from 'react';
import { exportNotes, forgetNotes, replaceNotes, subscribeNotes, type AiNote } from '../ai/library';
import { TITLE_MAX, cleanTitle } from '../gen/savefile';
import {
  MAX_WORLDS,
  cleanSyncMeta,
  currentWorld,
  listWorlds,
  newWorldId,
  putSyncedWorld,
  rawWorld,
  removeAllWorlds,
  removeSyncedWorld,
  setDeleteHook,
  storedIds,
  subscribe as subscribeSaves,
  type RawWorld,
} from '../ui/saveStore';
import { getStage } from '../ui/stageStore';
import { clearToast, getToast, showToast } from '../ui/toastStore';
import { deleteCloud, getCloud, listCloud, putCloud, type CloudEntry, type CloudWorld, type PutBody } from './cloud';
import { authed, getSession, logout, onLogin, onSessionChange, updateUser } from './session';
import { ServerError, serverBase } from './server';

// ---------------------------------------------------------------------------
// 记着的同步状态

interface Known {
  /** 上次同步到的版本号 */
  rev: number;
  /** 那时内容的指纹 */
  sum: string;
  /** 那是什么时候(ISO) */
  at: string;
}

interface SyncState {
  /** 哪个账号的 */
  user: string;
  worlds: Record<string, Known>;
  /** 删掉了、还没告诉服务器的:编号 → 删的时候的版本号 */
  deletes: Record<string, number>;
}

const KEY = 'civ-atlas:sync';
let memState: SyncState | null = null;

function readState(): SyncState | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as SyncState;
      if (v && typeof v.user === 'string' && v.worlds && typeof v.worlds === 'object' && v.deletes && typeof v.deletes === 'object') return v;
    }
  } catch {
    /* 隐私模式 / 坏数据 */
  }
  return memState;
}

function writeState(st: SyncState | null) {
  memState = st;
  try {
    if (typeof localStorage === 'undefined') return;
    if (st) localStorage.setItem(KEY, JSON.stringify(st));
    else localStorage.removeItem(KEY);
  } catch {
    /* 存不下:只在内存里 */
  }
}

// ---------------------------------------------------------------------------
// 内容指纹

function cyrb53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${str.length.toString(36)}-${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

const notesText = (n: AiNote[] | null | undefined) => (n && n.length ? JSON.stringify(n) : '');

function sumOf(w: RawWorld, notes: AiNote[] | null | undefined): string {
  return cyrb53([w.save, JSON.stringify(w.meta), w.thumb ?? '', notesText(notes)].join('\u0000'));
}

interface Local {
  raw: RawWorld;
  notes: AiNote[];
  sum: string;
}

function localWorld(id: string): Local | null {
  const raw = rawWorld(id);
  if (!raw) return null;
  const notes = exportNotes(id);
  return { raw, notes, sum: sumOf(raw, notes) };
}

/** 存着的世界按什么顺序同步:最近打开或改过的在前(换台设备最可能接着用的先传上去) */
function syncOrder(): string[] {
  const ids = new Set(storedIds());
  const recent = listWorlds()
    .map((w) => w.id)
    .filter((id) => ids.has(id));
  return [...new Set([...recent, ...ids])];
}

/** 服务器上那份 → 写进浏览器的样子(和本地的指纹一样算法) */
function remoteRaw(w: CloudWorld, save: unknown = w.save): RawWorld {
  return { save: JSON.stringify(save), meta: cleanSyncMeta(w.meta), thumb: typeof w.thumb === 'string' && w.thumb ? w.thumb : null };
}

// ---------------------------------------------------------------------------
// 状态(界面显示)

export type SyncPhase = 'off' | 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncView {
  phase: SyncPhase;
  /** 正在同步的世界 */
  busy: ReadonlySet<string>;
  /** 没同步上的世界 → 原因 */
  failed: ReadonlyMap<string, string>;
  /** 上次全部同步好的时间(ISO) */
  lastOk: string | null;
  /** 连不上、出错时的原因 */
  message?: string;
}

let view: SyncView = { phase: 'off', busy: new Set(), failed: new Map(), lastOk: null };
let viewVersion = 0;
const viewSubs = new Set<() => void>();
function setView(patch: Partial<SyncView>) {
  view = { ...view, ...patch };
  viewVersion++;
  for (const f of viewSubs) f();
}

export function getSyncView(): SyncView {
  return view;
}

/** React:同步状态变了就重渲染 */
export function useSyncView(): SyncView {
  useSyncExternalStore(
    (f) => (viewSubs.add(f), () => void viewSubs.delete(f)),
    () => viewVersion,
    () => viewVersion,
  );
  return view;
}

export interface WorldSync {
  state: 'synced' | 'busy' | 'failed';
  /** 同步好的时间(ISO) */
  at?: string;
  message?: string;
}

/** 一个世界同步得怎么样(没登录 = null) */
export function worldSync(id: string): WorldSync | null {
  if (view.phase === 'off') return null;
  const why = view.failed.get(id);
  if (why !== undefined) return { state: 'failed', message: why };
  if (view.busy.has(id)) return { state: 'busy' };
  const k = readState()?.worlds[id];
  const l = k ? localWorld(id) : null;
  if (k && l && k.sum === l.sum) return { state: 'synced', at: k.at };
  return { state: view.phase === 'offline' || view.phase === 'error' ? 'failed' : 'busy', message: view.message };
}

// ---------------------------------------------------------------------------
// 一次同步

const nowIso = () => new Date().toISOString();
/** 写进浏览器的是同步带来的(不为它再排一次同步) */
let applying = false;
/** 存不上去的(太大、太多):内容没再变就不重试 */
const rejected = new Map<string, { sum: string; why: string }>();
/** 正在看的世界在别的设备上改过,已经提示过的版本 */
const offered = new Map<string, number>();
/** 两边都改过、两份都留的世界名字(这一次同步里) */
let forks: { name: string; other: string }[] = [];
/** 这一次同步里没同步上的 */
let failedNow = new Map<string, string>();
let busyNow = new Set<string>();

/** 正在看的这个世界(不在"我的世界"那一页):别的设备的改动先不覆盖它 */
function pinned(id: string): boolean {
  const c = currentWorld();
  return !!c && c.id === id && getStage().stage !== 'home';
}

function done(id: string) {
  if (!busyNow.delete(id)) return;
  setView({ busy: new Set(busyNow) });
}

const FORK_SUFFIX = '（另一台设备）';
function otherTitle(t: unknown): string {
  const root = cleanTitle(typeof t === 'string' ? t : '') || '未命名世界';
  return [...root].slice(0, TITLE_MAX - FORK_SUFFIX.length).join('') + FORK_SUFFIX;
}

/** 写进浏览器(同步带来的);写不下 = false */
function store(id: string, raw: RawWorld, notes: AiNote[] | null): boolean {
  applying = true;
  try {
    if (!putSyncedWorld(id, raw)) return false;
    replaceNotes(id, notes);
    return true;
  } finally {
    applying = false;
  }
}

const thumbOf = (t: string | null) => (t && t.length <= 200_000 ? t : null);
const notesOf = (n: AiNote[]) => (!n.length ? null : JSON.stringify(n).length <= 1_000_000 ? n : undefined);

async function upload(st: SyncState, id: string, l: Local, baseRev: number, revive = false) {
  const body: PutBody = { baseRev, save: JSON.parse(l.raw.save), meta: { ...l.raw.meta }, thumb: thumbOf(l.raw.thumb) };
  const notes = notesOf(l.notes);
  if (notes !== undefined) body.notes = notes;
  if (revive) body.revive = true;
  const r = await putCloud(id, body);
  st.worlds[id] = { rev: r.rev, sum: l.sum, at: nowIso() };
}

/** 存上去;版本号对不上就按"全看一遍"的规矩合并 */
async function push(st: SyncState, id: string, l: Local, baseRev: number, revive = false, depth = 0): Promise<void> {
  const no = rejected.get(id);
  if (no && no.sum === l.sum) {
    failedNow.set(id, no.why);
    return;
  }
  try {
    await upload(st, id, l, baseRev, revive);
  } catch (e) {
    if (e instanceof ServerError && e.code === 'conflict' && depth < 2) {
      const entry: CloudEntry = { id, rev: Number(e.data.rev) || 0, deleted: e.data.deleted === true };
      return reconcile(st, id, l, entry, depth + 1);
    }
    if (e instanceof ServerError && e.status === 400) {
      rejected.set(id, { sum: l.sum, why: e.message });
      failedNow.set(id, e.message);
      return;
    }
    throw e;
  }
}

/** 取回来覆盖本地(本地没有就新存一个;"我的世界"满了、写不下就先不取) */
async function pull(st: SyncState, id: string): Promise<boolean> {
  let w: CloudWorld;
  try {
    w = await getCloud(id);
  } catch (e) {
    if (e instanceof ServerError && e.code === 'not-found') return false;
    throw e;
  }
  const raw = remoteRaw(w);
  const notes = Array.isArray(w.notes) ? w.notes : null;
  if (!store(id, raw, notes)) return false;
  const l = localWorld(id);
  if (l) st.worlds[id] = { rev: w.rev, sum: l.sum, at: nowIso() };
  forgetOffer(id);
  return true;
}

function forgetOffer(id: string) {
  if (!offered.delete(id)) return;
  const t = getToast();
  if (t?.id === 'sync-reload') clearToast('sync-reload');
}

/** 正在看的世界在别的设备上改过:提示一句,点"载入"再换 */
let reloadHandler: ((id: string) => void) | null = null;
export function setReloadHandler(f: ((id: string) => void) | null) {
  reloadHandler = f;
}
function offerReload(id: string, rev: number) {
  if (offered.get(id) === rev) return;
  offered.set(id, rev);
  showToast({
    id: 'sync-reload',
    kind: 'info',
    text: '这个世界在另一台设备上改过',
    more: ['载入那边改过的样子'],
    action: { label: '载入', act: 'sync-reload', onClick: () => void pullWorld(id).then((ok) => ok && reloadHandler?.(id)) },
    ttl: 0,
  });
}

/** "载入":把正在看的这个世界换成账号里的那份(之后 App 重新打开它) */
export async function pullWorld(id: string): Promise<boolean> {
  const st = readState();
  const s = getSession();
  if (!st || !s || st.user !== s.user.id) return false;
  clearToast('sync-reload');
  try {
    const ok = await pull(st, id);
    writeState(st);
    return ok;
  } catch (e) {
    showToast({ id: 'sync', kind: 'error', text: '没能载入', more: [e instanceof Error ? e.message : String(e)] });
    return false;
  }
}

/** 两边都改过:服务器那份另存成新世界(名字加"(另一台设备)"),本地这份存上去 */
async function fork(st: SyncState, id: string, l: Local, remote: CloudWorld) {
  const save = remote.save && typeof remote.save === 'object' ? { ...(remote.save as Record<string, unknown>) } : remote.save;
  const other = otherTitle((save as { title?: unknown })?.title);
  if (save && typeof save === 'object') (save as Record<string, unknown>).title = other;
  const nid = newWorldId();
  if (!store(nid, remoteRaw(remote, save), Array.isArray(remote.notes) ? remote.notes : null)) {
    // 存不下另一份:先不覆盖服务器上的(两份都还在),等腾出地方
    failedNow.set(id, '浏览器存储满了，两台设备上改的没法都留下');
    return;
  }
  await upload(st, id, l, remote.rev);
  const n = localWorld(nid);
  if (n) await push(st, nid, n, 0);
  const name = cleanTitle((JSON.parse(l.raw.save) as { title?: string }).title) || '未命名世界';
  forks.push({ name, other });
}

/** 一个世界:本地(l)、上次同步(st.worlds)、服务器上(s)三方对一遍 */
async function reconcile(st: SyncState, id: string, l: Local | null, s: CloudEntry | null, depth = 0): Promise<void> {
  const k = st.worlds[id];
  if (!s) {
    if (l) await push(st, id, l, 0, false, depth);
    else delete st.worlds[id];
    return;
  }
  if (s.deleted) {
    if (!l) {
      delete st.worlds[id];
      return;
    }
    if (k && k.sum === l.sum) {
      // 这里没改过:跟着删(正在看的先不删)
      if (pinned(id)) return;
      applying = true;
      try {
        removeSyncedWorld(id);
        forgetNotes(id);
      } finally {
        applying = false;
      }
      delete st.worlds[id];
      return;
    }
    // 改过的那份赢:存回去
    await push(st, id, l, s.rev, true, depth);
    return;
  }
  if (!l) {
    if (storedIds().length < MAX_WORLDS) await pull(st, id);
    return;
  }
  if (k && k.rev === s.rev) {
    if (k.sum !== l.sum) await push(st, id, l, s.rev, false, depth);
    return;
  }
  if (k && k.sum === l.sum) {
    // 只有服务器变了
    if (pinned(id)) return offerReload(id, s.rev);
    await pull(st, id);
    return;
  }
  // 两边都变了(或者这台设备不知道上次同步到哪):先取回来看看是不是一样
  let remote: CloudWorld;
  try {
    remote = await getCloud(id);
  } catch (e) {
    if (e instanceof ServerError && e.code === 'not-found') return push(st, id, l, s.rev, true, depth);
    throw e;
  }
  if (sumOf(remoteRaw(remote), Array.isArray(remote.notes) ? remote.notes : null) === l.sum) {
    st.worlds[id] = { rev: remote.rev, sum: l.sum, at: nowIso() };
    return;
  }
  await fork(st, id, l, remote);
}

function stateFor(user: string): SyncState {
  const st = readState();
  if (st && st.user === user) return st;
  const fresh: SyncState = { user, worlds: {}, deletes: {} };
  writeState(fresh);
  return fresh;
}

/** 同步一次:full = 全看一遍;否则只把改过的存上去 */
async function cycle(full: boolean): Promise<void> {
  let s = getSession();
  if (!s || !serverBase()) {
    setView({ phase: 'off', busy: new Set(), failed: new Map() });
    return;
  }
  if (!s.user.id) {
    // 以前只为 AI 登录的(没记账号编号):问一次服务器
    const me = await authed<{ user?: { id?: unknown; account?: unknown; name?: unknown } }>('/v1/me');
    updateUser(me.user);
    s = getSession();
    if (!s?.user.id) return;
  }
  const st = stateFor(s.user.id);
  const local = new Map<string, Local>();
  for (const id of syncOrder()) {
    const l = localWorld(id);
    if (l) local.set(id, l);
  }
  failedNow = new Map();
  forks = [];
  busyNow = new Set([...local].filter(([id, l]) => st.worlds[id]?.sum !== l.sum).map(([id]) => id));
  setView({ phase: 'syncing', busy: new Set(busyNow) });

  // 删掉的先告诉服务器(之后别的设备又改过的,改过的那份赢:不删,下面取回来)
  for (const [id, baseRev] of Object.entries(st.deletes)) {
    if (!local.has(id)) {
      try {
        await deleteCloud(id, baseRev || undefined);
      } catch (e) {
        if (!(e instanceof ServerError && e.code === 'conflict')) throw e;
        full = true;
      }
    }
    delete st.deletes[id];
    delete st.worlds[id];
    writeState(st);
  }

  if (full) {
    const list = await listCloud();
    const server = new Map(list.map((e) => [e.id, e]));
    for (const e of list) if (!e.deleted && st.worlds[e.id]?.rev !== e.rev && !pinned(e.id)) busyNow.add(e.id);
    setView({ busy: new Set(busyNow) });
    for (const id of new Set([...local.keys(), ...server.keys()])) {
      await reconcile(st, id, local.get(id) ?? null, server.get(id) ?? null);
      writeState(st);
      done(id);
    }
  } else {
    for (const [id, l] of local) {
      const k = st.worlds[id];
      if (k && k.sum === l.sum) continue;
      await push(st, id, l, k?.rev ?? 0);
      writeState(st);
      done(id);
    }
  }

  if (forks.length) {
    const f = forks[0];
    showToast({
      id: 'sync',
      kind: 'warn',
      text: forks.length > 1 ? `${forks.length} 个世界在两台设备上都改过` : `「${f.name}」在两台设备上都改过`,
      more: [forks.length > 1 ? '两份都留着了，另一台设备上的那份名字后面加了"（另一台设备）"' : `两份都留着了，另一台设备上的那份叫「${f.other}」`],
    });
  }
  setView({ phase: 'idle', busy: new Set(), failed: failedNow, lastOk: failedNow.size ? view.lastOk : nowIso(), message: undefined });
}

// ---------------------------------------------------------------------------
// 排队:同一时间只跑一次;跑的时候又要同步,跑完再来一次

let running: Promise<void> | null = null;
let again: 'full' | 'push' | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let timerMode: 'full' | 'push' | null = null;
/** 每次同步完成(成功或失败)后调(登录后的提示、退出前的同步等它) */
const afterRun = new Set<() => void>();

function failAll(e: unknown) {
  const msg =
    e instanceof ServerError
      ? e.code === 'network' || e.status === 0
        ? '连不上服务器，联网后会自动同步'
        : e.message
      : e instanceof Error
        ? e.message
        : String(e);
  const offline = e instanceof ServerError && (e.code === 'network' || e.status === 0 || e.status === 429 || e.status >= 500);
  const failed = new Map(failedNow);
  for (const id of busyNow) failed.set(id, msg);
  busyNow = new Set();
  setView({ phase: getSession() ? (offline ? 'offline' : 'error') : 'off', busy: new Set(), failed, message: msg });
}

async function runOnce(mode: 'full' | 'push') {
  try {
    await cycle(mode === 'full');
  } catch (e) {
    failAll(e);
  }
}

/** 排一次同步(delay 毫秒以后;已经排了更早的就不动) */
export function requestSync(mode: 'full' | 'push' = 'full', delay = 0): void {
  if (!getSession() || !serverBase()) return;
  if (running) {
    again = again === 'full' || mode === 'full' ? 'full' : 'push';
    return;
  }
  if (timer !== undefined) {
    if (mode === 'full') timerMode = 'full';
    if (delay > 0) return;
    clearTimeout(timer);
  }
  timerMode = timerMode === 'full' || mode === 'full' ? 'full' : 'push';
  timer = setTimeout(() => {
    timer = undefined;
    const m = timerMode ?? mode;
    timerMode = null;
    void kick(m);
  }, delay);
}

async function kick(mode: 'full' | 'push') {
  if (running) {
    again = again === 'full' || mode === 'full' ? 'full' : 'push';
    return running;
  }
  running = (async () => {
    let m: 'full' | 'push' | null = mode;
    while (m) {
      again = null;
      await runOnce(m);
      m = again;
    }
  })();
  try {
    await running;
  } finally {
    running = null;
    for (const f of [...afterRun]) f();
  }
}

/** 马上全看一遍,等它做完 */
export async function syncNow(): Promise<SyncView> {
  if (timer !== undefined) {
    clearTimeout(timer);
    timer = undefined;
    timerMode = null;
  }
  if (running) {
    again = 'full';
    await new Promise<void>((r) => {
      const f = () => {
        if (running) return;
        afterRun.delete(f);
        r();
      };
      afterRun.add(f);
    });
    return view;
  }
  await kick('full');
  return view;
}

/** 马上把改过的存上去(不看服务器那边),等它做完(分享前用:世界要先在账号里) */
export async function pushNow(): Promise<SyncView> {
  if (timer !== undefined && timerMode !== 'full') {
    clearTimeout(timer);
    timer = undefined;
    timerMode = null;
  }
  if (running) return syncNow();
  await kick('push');
  return view;
}

// ---------------------------------------------------------------------------
// 登录、退出、删除

/** 用户删掉一个世界:记下来,告诉服务器(断网、没登录时等下次) */
function onLocalDelete(id: string) {
  rejected.delete(id);
  const st = readState();
  if (!st) return;
  const k = st.worlds[id];
  if (k) {
    st.deletes[id] = k.rev;
    delete st.worlds[id];
    writeState(st);
  }
  if (view.failed.has(id)) {
    const failed = new Map(view.failed);
    failed.delete(id);
    setView({ failed });
  }
  requestSync('push', 300);
}

/** 刚登录:顶上说一句"正在存进账号",同步完收起 */
function onLoggedIn() {
  const n = storedIds().length;
  if (n) {
    showToast({ id: 'sync-login', kind: 'info', text: `已登录，正在把这个浏览器里的 ${n} 个世界存进账号`, more: ['传完以后在别的设备上登录就能看到'], ttl: 0 });
    const f = () => {
      afterRun.delete(f);
      clearToast('sync-login');
    };
    afterRun.add(f);
  }
  requestSync('full', 0);
}

/** 退出登录。keep = 这台设备上的世界留着(下次登录再同步);否则先全部同步好,再从这台设备上删掉 */
export async function signOut(keep: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!keep && getSession()) {
    const v = await syncNow();
    if (v.phase !== 'idle' || v.failed.size) {
      return { ok: false, message: v.failed.size ? `还有 ${v.failed.size} 个世界没同步上，现在删掉会丢：${v.message ?? [...v.failed.values()][0]}` : (v.message ?? '没能同步，稍后再试') };
    }
  }
  await logout();
  if (!keep) {
    removeAllWorlds();
    forgetNotes();
    writeState(null);
    rejected.clear();
  }
  setView({ phase: 'off', busy: new Set(), failed: new Map(), message: undefined });
  return { ok: true };
}

/** 账号注销了:同步记录作废(这台设备上的世界不动) */
export function accountDeleted(): void {
  writeState(null);
  rejected.clear();
  setView({ phase: 'off', busy: new Set(), failed: new Map(), message: undefined, lastOk: null });
}

let started = false;

/** 开始同步(App 挂载时调一次;返回取消函数) */
export function startSync(): () => void {
  if (started) return () => {};
  started = true;
  setDeleteHook(onLocalDelete);
  const offSaves = subscribeSaves(() => {
    if (!applying) requestSync('push', 2000);
  });
  const offNotes = subscribeNotes(() => {
    if (!applying) requestSync('push', 2000);
  });
  const offLogin = onLogin(onLoggedIn);
  const offSession = onSessionChange(() => {
    if (!getSession() && view.phase !== 'off') setView({ phase: 'off', busy: new Set(), failed: new Map(), message: undefined });
  });
  let lastFocus = 0;
  const onFocus = () => {
    if (Date.now() - lastFocus < 10_000) return;
    lastFocus = Date.now();
    requestSync('full', 0);
  };
  const onVisible = () => document.visibilityState === 'visible' && onFocus();
  const every = setInterval(() => {
    if (typeof document === 'undefined' || document.visibilityState !== 'hidden') requestSync('full', 0);
  }, 60_000);
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onFocus);
    document.addEventListener('visibilitychange', onVisible);
  }
  if (getSession()) {
    setView({ phase: 'idle' });
    requestSync('full', 1500);
  }
  return () => {
    started = false;
    setDeleteHook(null);
    offSaves();
    offNotes();
    offLogin();
    offSession();
    clearInterval(every);
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    }
  };
}

/** 单测用:清掉内存里的状态 */
export function _resetSyncForTest(): void {
  memState = null;
  rejected.clear();
  offered.clear();
  running = null;
  again = null;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  timerMode = null;
  afterRun.clear();
  view = { phase: 'off', busy: new Set(), failed: new Map(), lastOk: null };
}

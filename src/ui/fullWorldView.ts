/**
 * 传到账号的世界(用的人点了才传)的状态:账号里有哪些、用了多少、正在传和正在取的是哪个。
 * 首页也要看(卡片上的小云),所以这里只放状态和几个短字;请求、传、取都在用到才下载的文件里。
 * 只读:登录时读一次、打开账号窗和菜单时读一次,这不算同步。
 * overview = null:没登录,或者服务器没开这个功能(接口 404),所有入口都不露出来。
 */
import { getSession, onLogin, onSessionChange } from '../account/session';
import { serverBase } from '../account/server';
import { openAccount } from './AccountDialogs';
import { createListeners } from './createStore';
import { isStored } from './saveStore';
import { showToast } from './toastStore';
import { saveMark } from './spaceFacts';

export interface FullLimits {
  worlds: number;
  bytes: number;
  perDay: number;
  worldBytes: number;
  blockBytes: number;
  blocksPerFile: number;
}

export interface FullEntry {
  id: string;
  rev: number;
  sum: string;
  bytes: number;
  uploadedAt: string;
  /** 传的时候这个世界的内容记号(saveMark) */
  mark?: string | null;
  public?: boolean;
  /** 不能公开分享的原因:opaque 带着插件的附加数据,stale 还在重查,text 查到了不能公开的字词 */
  reason?: string;
}

/** 账号里的一个世界(只有编号和时间;有没有整个世界看 worlds) */
export interface AccountEntry {
  id: string;
  rev: number;
  updatedAt?: string;
}

export interface FullOverview {
  limits: FullLimits;
  used: { worlds: number; bytes: number; today: number };
  storeFull: boolean;
  /** 传了整个世界的 */
  worlds: FullEntry[];
  /** 账号里所有的世界,包括只传了配方的 */
  account: AccountEntry[];
}

/** 正在传的那个世界。phase:pack 打包,send 传块,check 服务器在核对 */
export interface FullJob {
  id: string;
  title: string;
  phase: 'pack' | 'send' | 'check';
  done: number;
  total: number;
}

export interface FullPull {
  id: string;
  done: number;
  total: number;
}

/** 窗口里那一行要说的话(提示条盖不到账号窗、分享窗) */
export interface FullNote {
  kind: 'ok' | 'warn' | 'error';
  text: string;
  more: string;
  action?: { label: string; act: string; onClick: () => void };
}

const CACHE = 'civ-atlas:full-view';
const listeners = createListeners();

let overview: FullOverview | null = null;
let job: FullJob | null = null;
let pull: FullPull | null = null;
let notes: Readonly<Record<string, FullNote>> = {};
let who: string | null = null;

function cacheRead(user: string): FullOverview | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE) ?? 'null') as { user?: string; overview?: FullOverview } | null;
    return v?.user === user && v.overview ? v.overview : null;
  } catch {
    return null;
  }
}

function cacheWrite(o: FullOverview | null) {
  try {
    if (o && who) localStorage.setItem(CACHE, JSON.stringify({ user: who, overview: o }));
    else localStorage.removeItem(CACHE);
  } catch {
    /* 写不下只是下次打开先不显示,等服务器回话 */
  }
}

export const fullOverview = (): FullOverview | null => overview;
export const useFullOverview = (): FullOverview | null => listeners.use(() => overview);
export const fullJob = (): FullJob | null => job;
export const useFullJob = (): FullJob | null => listeners.use(() => job);
export const useFullPull = (): FullPull | null => listeners.use(() => pull);
export const useFullNotes = (): Readonly<Record<string, FullNote>> => listeners.use(() => notes);

export function setFullOverview(o: FullOverview | null) {
  overview = o;
  cacheWrite(o);
  listeners.emit();
}
export function setFullJob(j: FullJob | null) {
  job = j;
  listeners.emit();
}
export function setFullPull(p: FullPull | null) {
  pull = p;
  listeners.emit();
}
export function setFullNote(id: string, note: FullNote | null) {
  const { [id]: _drop, ...rest } = notes;
  notes = note ? { ...rest, [id]: note } : rest;
  listeners.emit();
}

/** 问一次服务器;问不到(断网)留着现在的,点了再听服务器的 */
let asking: Promise<void> | null = null;
export function askFull(): Promise<void> {
  if (!who || !serverBase()) return Promise.resolve();
  if (asking) return asking;
  const user = who;
  asking = import('../account/fullWorlds')
    .then((m) => m.fetchOverview())
    .then(
      (o) => {
        if (user === who) setFullOverview(o);
      },
      () => {},
    )
    .finally(() => {
      asking = null;
    });
  return asking;
}

let started = false;
/** 跟着登录走:没登录一个请求都不发 */
export function startFullView(): void {
  if (started) return;
  started = true;
  const follow = () => {
    const s = getSession();
    const next = s ? String(s.user.id ?? s.user.account) : null;
    if (next === who) return;
    who = next;
    overview = next ? cacheRead(next) : null;
    if (!next) cacheWrite(null);
    listeners.emit();
    void askFull();
  };
  onSessionChange(follow);
  onLogin(() => {
    void askFull().then(sayMissing);
  });
  follow();
}

/** 刚登录:账号里有这台设备上没有的世界,说一声。不自动取 */
function sayMissing() {
  const n = overview?.account.filter((w) => !isStored(w.id)).length ?? 0;
  if (n) showToast({ id: 'account-list', kind: 'info', text: `账号里有 ${n} 个世界不在这台设备上`, more: ['想接着用，到账号窗里取回'], action: { label: '看账号里的', act: 'account-look', onClick: openAccount } });
}

// ---------------------------------------------------------------------------
// 窗口开着时不出提示条(盖不到窗口),话说在窗口那一行里

const holds = new Map<string, number>();
let painter: (() => void) | null = null;
/** 正在传的那边登记:谁开了、关了窗口时重画提示条 */
export function setFullPainter(f: (() => void) | null) {
  painter = f;
}
/** id:这个世界;不给 = 所有世界 */
export function holdFullToasts(id = '*'): () => void {
  holds.set(id, (holds.get(id) ?? 0) + 1);
  painter?.();
  return () => {
    holds.set(id, (holds.get(id) ?? 1) - 1);
    if (id === '*') notes = {};
    else setFullNote(id, null);
    listeners.emit();
    painter?.();
  };
}
export const fullToastHeld = (id: string): boolean => (holds.get('*') ?? 0) > 0 || (holds.get(id) ?? 0) > 0;

// ---------------------------------------------------------------------------
// 算

/** never 账号里没有;recipe 账号里只有配方(at = 哪天传的);same、changed 传过整个世界,和现在一样、之后又改过 */
export type FullStatus = { kind: 'never' } | { kind: 'recipe'; at: string } | { kind: 'same'; entry: FullEntry } | { kind: 'changed'; entry: FullEntry };

type Markable = Parameters<typeof saveMark>[0];

/** 账号里那份和这个世界现在的样子一样吗 */
export function fullStatusOf(o: FullOverview, id: string, save: Markable | null | undefined): FullStatus {
  const entry = o.worlds.find((w) => w.id === id);
  if (!entry) {
    const a = o.account.find((w) => w.id === id);
    return a ? { kind: 'recipe', at: a.updatedAt ?? '' } : { kind: 'never' };
  }
  return { kind: save && entry.mark === saveMark(save) ? 'same' : 'changed', entry };
}

export type FullRefusal = 'big' | 'count' | 'bytes' | 'today' | 'store';

/** 知道传不了的(bytes = 这个世界多大,不知道 = null)。再传不多占个数,大小按新的减旧的算 */
export function refusalOf(o: FullOverview, id: string, bytes: number | null): FullRefusal | null {
  const had = o.worlds.find((w) => w.id === id);
  if (bytes !== null && bytes > o.limits.worldBytes) return 'big';
  if (!had && o.used.worlds >= o.limits.worlds) return 'count';
  if (bytes !== null && bytes - (had?.bytes ?? 0) > o.limits.bytes - o.used.bytes) return 'bytes';
  if (o.used.today >= o.limits.perDay) return 'today';
  return o.storeFull ? 'store' : null;
}

/** 卡片菜单右边的灰字 */
export const REFUSAL_NOTE: Record<FullRefusal, string> = { big: '太大了', count: '放满了', bytes: '放不下', today: '明天再传', store: '放满了' };

/** 2.1 / 4.9 MB、50 / 133 MB */
export function pairText(done: number, total: number): string {
  const digits = total < 10e6 ? 1 : 0;
  return `${(Math.min(done, total) / 1e6).toFixed(digits)} / ${(total / 1e6).toFixed(digits)} MB`;
}

/** 11 月 3 日(不是今年的带上年) */
export function fullDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()} 年 `;
  return `${year}${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

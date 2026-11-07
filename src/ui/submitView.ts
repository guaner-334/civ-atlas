/**
 * 投到作品墙:存档菜单要先知道的几样(服务器开没开投稿、账号是不是停了投稿、正在投的那一件)和菜单那一项的字;窗口本身点开才下载。
 * 停没停投稿只在投稿窗问服务器、投稿被挡回时记下(按账号记在这个浏览器里),存档菜单打开时不去问。
 */
import { useEffect } from 'react';
import { currentAccount, fetchAuthOptions, knownAuthOptions, onAuthOptionsChange, onSessionChange, type AuthOptions } from '../account/session';
import { accountServer } from '../account/server';
import { createListeners } from './createStore';
import { aboutSize } from './sizeWords';

/** 服务器说的封禁(/v1/submissions、403 submit-banned 带的 ban) */
export interface SubmitBan {
  level: 'submit' | 'all';
  reason?: string;
  /** 给用的人看的原因 */
  reasonText: string;
}

/** 正在投的那一件。phase:pack 打包,send 传块,check 服务器在核对 */
export interface SubmitJob {
  id: string;
  title: string;
  phase: 'pack' | 'send' | 'check';
  done: number;
  total: number;
}

const BAN_KEY = 'civ-atlas:submit-ban';
const listeners = createListeners();

let job: SubmitJob | null = null;
let ban: { user: string; ban: SubmitBan | null } | null = null;

const userKey = (): string | null => {
  const s = currentAccount();
  return s ? String(s.user.id || s.user.account) : null;
};

/** 服务器给的 ban 里认得出来的那几样;不像 = null */
export function readBan(v: unknown): SubmitBan | null {
  const b = v as { level?: unknown; reason?: unknown; reasonText?: unknown } | null;
  if (!b || typeof b !== 'object' || (b.level !== 'submit' && b.level !== 'all')) return null;
  return { level: b.level, ...(typeof b.reason === 'string' ? { reason: b.reason } : {}), reasonText: typeof b.reasonText === 'string' ? b.reasonText : '' };
}

function banOf(user: string | null): SubmitBan | null {
  if (!user) return null;
  if (ban?.user === user) return ban.ban;
  let got: SubmitBan | null = null;
  try {
    const v = JSON.parse(localStorage.getItem(BAN_KEY) ?? 'null') as { user?: string; ban?: unknown } | null;
    if (v?.user === user) got = readBan(v.ban);
  } catch {
    /* 读不出就当没被停,点了听服务器的 */
  }
  ban = { user, ban: got };
  return got;
}

/** 这个账号被停了投稿(记下的);没登录、没记过 = null */
export const submitBan = (): SubmitBan | null => banOf(userKey());
export const useSubmitBan = (): SubmitBan | null => listeners.use(submitBan);

/** 服务器说了停没停(null = 没停) */
export function setSubmitBan(b: SubmitBan | null): void {
  const user = userKey();
  if (!user) return;
  ban = { user, ban: b };
  try {
    if (b) localStorage.setItem(BAN_KEY, JSON.stringify({ user, ban: b }));
    else if (localStorage.getItem(BAN_KEY)) localStorage.removeItem(BAN_KEY);
  } catch {
    /* 记不下只是下次打开菜单时不灰,点了照样说 */
  }
  listeners.emit();
}

export const submitJob = (): SubmitJob | null => job;
export const useSubmitJob = (): SubmitJob | null => listeners.use(() => job);
export function setSubmitJob(j: SubmitJob | null): void {
  job = j;
  listeners.emit();
}

onSessionChange(() => listeners.emit());
onAuthOptionsChange(() => listeners.emit());

/** 服务器开着的功能(登录了、问到了才有);没登录、还没问到 = null */
function features(): AuthOptions['features'] | null {
  return currentAccount() ? (knownAuthOptions()?.features ?? null) : null;
}

/** 能不能投世界:登录了、服务器开着投稿和投世界。还没问到服务器的,菜单打开时再问 */
export const useSubmitWorldOn = (open: boolean): boolean => {
  const on = listeners.use(() => {
    const f = features();
    return !!f?.submit && !!f.submitWorld;
  });
  const signed = listeners.use(() => !!currentAccount() && !!accountServer());
  useEffect(() => {
    if (signed && !knownAuthOptions()) void fetchAuthOptions();
  }, [signed, open]);
  return on;
};

/** 服务器要先绑手机号 */
export const phoneRequired = (): boolean => !!features()?.phoneRequired;

/**
 * 服务器要求先绑手机号时走这里(点「投到作品墙…」时、服务器回 need-phone 时)。
 * 绑手机号的窗还没有:先直接接着做。
 */
export function askPhone(o: { for: 'submit' | 'share'; then: () => void }): void {
  o.then();
}

// ---------------------------------------------------------------------------
// 存档菜单那一项

export interface SubmitMenuFacts {
  ban: SubmitBan | null;
  /** 还在推演 */
  pending: boolean;
  /** 带着插件的附加数据(块名) */
  extras: readonly string[];
  /** 世界文件多大;还没算出来 = null */
  bytes: number | null;
  /** 作品墙一个世界最多多大 */
  maxBytes: number;
}

export interface SubmitMenuItem {
  small: string;
  off: boolean;
  /** 点了做什么:open 打开投稿窗,ban 说为什么停了,none 什么都不做 */
  act: 'open' | 'ban' | 'none';
}

/** 作品墙一个世界最多多大(服务器没说时) */
export const SUBMIT_WORLD_MAX = 150e6;

export function submitMenuItem(f: SubmitMenuFacts): SubmitMenuItem {
  if (f.ban) return { small: '你的账号已停止投稿，点这里看原因', off: true, act: 'ban' };
  if (f.pending) return { small: '还在推演，推完再投', off: true, act: 'none' };
  if (f.extras.length) return { small: '带着插件的附加数据，我们看不到里面，不能投。可以存成文件发给别人', off: true, act: 'none' };
  if (f.bytes !== null && f.bytes > f.maxBytes) return { small: `它${aboutSize(f.bytes)}，作品墙一个世界最多 ${Math.round(f.maxBytes / 1e6)} MB`, off: true, act: 'none' };
  return { small: `交上整个世界${f.bytes !== null ? `（${aboutSize(f.bytes)}）` : ''}，我们看过才放上作品墙`, off: false, act: 'open' };
}

// ---------------------------------------------------------------------------
// 上次填的署名:投稿窗和分享窗共用

const LAST_BY = 'civ-atlas:last-by';
export function lastBy(): string {
  try {
    return localStorage.getItem(LAST_BY) ?? '';
  } catch {
    return '';
  }
}
export function keepLastBy(by: string): void {
  try {
    if (by) localStorage.setItem(LAST_BY, by);
  } catch {
    /* 记不下只是下次要重填 */
  }
}

/** 账号停了投稿时「分享…」那一项的小字 */
export const SHARE_BANNED = '你的账号已停止开分享，点这里看原因';

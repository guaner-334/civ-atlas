/**
 * 网站账号:登录(邮箱收验证码,邀请制)、退出、注销。世界的云同步(sync.ts)、分享短链接(cloud.ts)、我们的 AI(ai/providers/official.ts)
 * 都用这一个账号。
 *
 * - 登录令牌存在 localStorage 'civ-atlas:account'(浏览器不让存就只在内存里);退出登录才删。
 *   以前"我们的 AI"的令牌存在 AI 密钥里(ai/settings.ts),第一次读的时候挪过来
 * - 服务器回 401(令牌过期 / 作废):清掉令牌,算退出
 * - 邀请链接(网址里的 invite=):记下邀请码,登录窗里自动填上
 *
 *   GET  /v1/auth/options           → { accountKinds: ['email', 'phone'?], inviteOnly, codeTtlSec }(没有这个接口 = 都开放、不要邀请)
 *   POST /v1/auth/code   { account, invite? }        → { ok, resendAfter?, expiresIn? }   新邮箱没带邀请码:403 need-invite
 *   POST /v1/auth/login  { account, code, invite? }  → { token, user: { id, account, name? }, credits }
 *   POST /v1/auth/logout                              → 204
 *   POST /v1/account/delete { code }                  → 204(先给自己的邮箱发验证码)
 */
import { useSyncExternalStore } from 'react';
import { getSecrets, setSecret } from '../ai/settings';
import { ServerError, call, serverBase, setAuthLostHandler } from './server';

export interface AccountUser {
  id: string;
  /** 邮箱(或手机号) */
  account: string;
  name?: string;
}

export interface Session {
  token: string;
  user: AccountUser;
}

const KEY = 'civ-atlas:account';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function sanitize(v: unknown): Session | null {
  const o = v as { token?: unknown; user?: { id?: unknown; account?: unknown; name?: unknown } } | null;
  if (!o || typeof o.token !== 'string' || !o.token || !o.user || typeof o.user.account !== 'string') return null;
  return {
    token: o.token,
    user: {
      id: typeof o.user.id === 'string' || typeof o.user.id === 'number' ? String(o.user.id) : '',
      account: o.user.account,
      name: typeof o.user.name === 'string' && o.user.name ? o.user.name : undefined,
    },
  };
}

let session: Session | null | undefined;
let version = 0;
const subs = new Set<() => void>();
function emit() {
  version++;
  for (const f of subs) f();
}

function persist(s: Session | null) {
  try {
    const st = storage();
    if (s) st?.setItem(KEY, JSON.stringify(s));
    else st?.removeItem(KEY);
  } catch {
    /* 存不下 / 隐私模式:只留在内存里 */
  }
}

function write(s: Session | null) {
  session = s;
  persist(s);
  emit();
}

function load(): Session | null {
  if (session !== undefined) return session;
  let s: Session | null = null;
  try {
    const raw = storage()?.getItem(KEY);
    s = raw ? sanitize(JSON.parse(raw)) : null;
  } catch {
    s = null;
  }
  // 以前"我们的 AI"的令牌存在 AI 密钥里:挪过来(网站账号和 AI 用同一个令牌)。
  // 可能正在渲染,AI 设置那边的清除放到之后做(不在渲染中途通知别的组件)
  const old = getSecrets().official;
  if (old) {
    if (!s) s = { token: old.token, user: { id: '', account: old.account ?? '' } };
    persist(s);
    queueMicrotask(() => setSecret('official', undefined));
  }
  session = s;
  return s;
}

/** 现在登录的账号;没登录 = null */
export function getSession(): Session | null {
  return load();
}

/** 登录令牌(给请求带上) */
export function authToken(): string | undefined {
  return load()?.token;
}

/** 账号显示的名字:邮箱 @ 前面那段(服务器给了 name 用 name) */
export function displayName(u: AccountUser): string {
  const n = u.name || u.account.split('@')[0] || u.account;
  return n;
}

export function onSessionChange(f: () => void): () => void {
  subs.add(f);
  return () => void subs.delete(f);
}

/** React:登录状态变了就重渲染 */
export function useSession(): Session | null {
  useSyncExternalStore(onSessionChange, () => version, () => version);
  return load();
}

/** 服务器说令牌不认了(401):清掉,算退出。只认这次请求用的那个令牌(退出后换了账号,旧账号的请求晚回来的 401 不算) */
export function sessionExpired(token?: string): void {
  const s = load();
  if (s && (token === undefined || s.token === token)) write(null);
}
setAuthLostHandler(sessionExpired);

// ---------------------------------------------------------------------------
// 登录窗选项

export interface AuthOptions {
  /** 能用哪种账号登录 */
  accountKinds: ('email' | 'phone')[];
  /** 邀请制:新邮箱第一次登录要填邀请码 */
  inviteOnly: boolean;
  /** 验证码几秒内有效 */
  codeTtlSec: number;
}

const OPEN: AuthOptions = { accountKinds: ['email', 'phone'], inviteOnly: false, codeTtlSec: 600 };
let options: { base: string; v: AuthOptions } | null = null;

/** 登录窗选项(问一次服务器就记住;没有这个接口 = 都开放、不要邀请) */
export async function fetchAuthOptions(): Promise<AuthOptions> {
  const base = serverBase();
  if (!base) return OPEN;
  if (options?.base === base) return options.v;
  let v = OPEN;
  try {
    const r = await call<Partial<AuthOptions>>('/v1/auth/options');
    const kinds = Array.isArray(r.accountKinds) ? r.accountKinds.filter((k): k is 'email' | 'phone' => k === 'email' || k === 'phone') : OPEN.accountKinds;
    v = {
      accountKinds: kinds.length ? kinds : ['email'],
      inviteOnly: r.inviteOnly === true,
      codeTtlSec: typeof r.codeTtlSec === 'number' && r.codeTtlSec > 0 ? r.codeTtlSec : OPEN.codeTtlSec,
    };
  } catch (e) {
    // 连不上:先按都开放算,这次不记住(下次再问)
    if (!(e instanceof ServerError) || e.status !== 404) return OPEN;
  }
  options = { base, v };
  return v;
}

// ---------------------------------------------------------------------------
// 邀请链接带来的邀请码

let invite: string | null = null;

/** 网址里的 invite=:记下来,从网址里去掉(App 打开时调);有 = 返回它 */
export function takeInviteFromUrl(): string | null {
  if (typeof location === 'undefined') return null;
  const q = new URLSearchParams(location.search);
  const v = q.get('invite');
  if (v === null) return null;
  q.delete('invite');
  const rest = q.toString();
  history.replaceState(null, '', (rest ? `?${rest}` : location.pathname) + location.hash);
  const code = v.trim().slice(0, 40);
  if (code) invite = code;
  return code || null;
}

/** 邀请链接带来的邀请码(登录窗用);没有 = null */
export function pendingInvite(): string | null {
  return invite;
}

// ---------------------------------------------------------------------------
// 发验证码、登录、退出、注销

export interface CodeSent {
  /** 多少秒后才能重发 */
  resendAfter: number;
  /** 验证码几秒内有效 */
  expiresIn?: number;
  /** 开发用假服务器把验证码直接给回来 */
  devCode?: string;
}

/** 发验证码;邀请制下新邮箱没带邀请码:抛 ServerError need-invite */
export async function sendCode(account: string, inviteCode?: string): Promise<CodeSent> {
  const r = await call<{ resendAfter?: number; expiresIn?: number; devCode?: string }>('/v1/auth/code', {
    method: 'POST',
    body: { account: account.trim(), invite: inviteCode?.trim() || undefined },
  });
  return {
    resendAfter: typeof r.resendAfter === 'number' ? r.resendAfter : 60,
    expiresIn: typeof r.expiresIn === 'number' ? r.expiresIn : undefined,
    devCode: typeof r.devCode === 'string' ? r.devCode : undefined,
  };
}

export interface LoginResult {
  session: Session;
  credits?: number;
}

const loginSubs = new Set<(s: Session) => void>();
/** 刚登录上(同步从这里开始) */
export function onLogin(f: (s: Session) => void): () => void {
  loginSubs.add(f);
  return () => void loginSubs.delete(f);
}

export async function login(account: string, code: string, inviteCode?: string): Promise<LoginResult> {
  const r = await call<{ token?: string; user?: { id?: unknown; account?: unknown; name?: unknown }; credits?: number }>('/v1/auth/login', {
    method: 'POST',
    body: { account: account.trim(), code: code.trim(), invite: inviteCode?.trim() || undefined },
  });
  const s = sanitize({ token: r.token, user: { account: account.trim(), ...r.user } });
  if (!s) throw new ServerError(200, 'bad-response', '登录失败：服务器没给令牌');
  invite = null;
  write(s);
  for (const f of loginSubs) f(s);
  return { session: s, credits: typeof r.credits === 'number' ? r.credits : undefined };
}

/** 退出登录:先在本地忘掉(断网也能退出),再告诉服务器作废令牌 */
export async function logout(): Promise<void> {
  const had = load();
  if (!had) return;
  write(null);
  if (serverBase()) await call('/v1/auth/logout', { method: 'POST', token: had.token }).catch(() => {});
}

/** 注销账号(先用 sendCode 给自己的邮箱发验证码);成功后本地也算退出 */
export async function deleteAccount(code: string): Promise<void> {
  const s = load();
  if (!s) throw new ServerError(401, 'auth', '还没登录');
  await call('/v1/account/delete', { method: 'POST', body: { code: code.trim() }, token: s.token });
  write(null);
}

/** 带令牌调一个接口(没登录:抛 auth) */
export function authed<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const t = authToken();
  if (!t) return Promise.reject(new ServerError(401, 'auth', '还没登录'));
  return call<T>(path, { ...init, token: t });
}

/** 服务器返回的用户信息补进本地(/v1/me 用) */
export function updateUser(u: { id?: unknown; account?: unknown; name?: unknown } | undefined, token?: string): void {
  const s = load();
  // token = 查这份资料时用的令牌:已经退出、换了账号就不用(不然新登录的令牌配上了旧账号的资料)
  if (!s || !u || (token !== undefined && s.token !== token)) return;
  const next = sanitize({ token: s.token, user: { ...s.user, ...u } });
  if (next && JSON.stringify(next) !== JSON.stringify(s)) write(next);
}

/** 单测用:忘掉内存里的,下次从存储重读 */
export function _resetSessionForTest(): void {
  session = undefined;
  options = null;
  invite = null;
  emit();
}

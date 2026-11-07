/**
 * 账号里的世界、最近删除、分享短链接:服务器接口(要登录的带令牌)。怎么同步见 sync.ts。
 *
 *   GET    /v1/worlds                    → { worlds: [{ id, rev, updatedAt, deleted? }] }(只有编号和版本号)
 *   GET    /v1/worlds/:id                → { id, rev, updatedAt, save, meta, thumb, notes }
 *   PUT    /v1/worlds/:id  { baseRev, save, meta?, thumb?, notes?, revive? } → { rev, updatedAt }
 *            baseRev 和服务器上的不一样(别的设备先改过 / 删掉了):409 conflict,带 rev、deleted
 *            meta / thumb / notes 不带 = 不动,null = 清掉;删掉的世界要存回来带 revive
 *   DELETE /v1/worlds/:id?baseRev=      → { rev, deleted: true }(进最近删除,30 天);之后别的设备又改过:409
 *   GET    /v1/trash                     → { worlds: [{ id, title, seed, meta, thumb, deletedAt, purgeAt }] }
 *   POST   /v1/trash/:id/restore         → { rev, updatedAt }
 *   POST   /v1/worlds/:id/share { by? }  → { code, worldId, createdAt, opens, by?, paused? }(开着就给原来那个;带了 by 改署名,空 = 不署名)
 *            暂停中的链接被开的人停掉了、我们还没看过:403 share-held,带 paused
 *   DELETE /v1/worlds/:id/share          → 204(停了再开是新的码)
 *   GET    /v1/shares                    → { shares: [{ code, worldId, title, createdAt, opens, by?, paused? }], stopped: [{ code, worldId, title, stoppedAt, reason }] }
 *            paused.by:auto 被举报够数、admin 我们暂停的、ban 账号停了投稿;stopped 是我们彻底停了、开的人还没点「知道了」的
 *   POST   /v1/shares/:code/seen         → 204(彻底停了的那条点了「知道了」)
 *   GET    /v1/s/:code(不用登录)        → { save, updatedAt, by?, full? };停了 / 删了:404 share-gone(我们彻底停的带 stoppedBy: 'site');暂停:403 share-paused
 *   POST   /v1/s/:code/report { reason } → 204(不用登录)
 *
 * 短链接:网站地址/s/<码>,网站把它转到 /?s=<码>,页面再来取(App.tsx)。
 */
import type { AiNote } from '../ai/library';
import { authed } from './session';
import { call } from './server';

export interface CloudEntry {
  id: string;
  rev: number;
  updatedAt?: string;
  deleted?: boolean;
}

export interface CloudWorld {
  id: string;
  rev: number;
  updatedAt?: string;
  save: unknown;
  meta: Record<string, unknown> | null;
  thumb: string | null;
  notes: AiNote[] | null;
}

export interface PutBody {
  baseRev: number;
  save: unknown;
  meta?: Record<string, unknown> | null;
  thumb?: string | null;
  notes?: AiNote[] | null;
  revive?: boolean;
}

export interface TrashEntry {
  id: string;
  title: string;
  seed?: number;
  meta?: Record<string, unknown> | null;
  thumb: string | null;
  deletedAt: string;
  purgeAt: string;
}

export interface ShareInfo {
  code: string;
  worldId: string;
  title?: string;
  createdAt: string;
  opens: number;
  /** 署名(别人另存时写进底稿出处);没填 = 没有 */
  by?: string;
  /** 暂停中:为什么(auto 被举报够数、admin 我们暂停的、ban 账号停了投稿) */
  paused?: { by: string; at?: string };
}

/** 我们彻底停了的分享(开的人点「知道了」以前一直列着);reason 是给开的人看的那句 */
export interface StoppedShare {
  code: string;
  worldId: string;
  title?: string;
  stoppedAt?: string;
  reason: string;
}

const path = (id: string) => `/v1/worlds/${encodeURIComponent(id)}`;

export async function listCloud(): Promise<CloudEntry[]> {
  const r = await authed<{ worlds?: CloudEntry[] }>('/v1/worlds');
  return Array.isArray(r.worlds) ? r.worlds.filter((w) => w && typeof w.id === 'string' && typeof w.rev === 'number') : [];
}

export function getCloud(id: string): Promise<CloudWorld> {
  return authed<CloudWorld>(path(id));
}

export function putCloud(id: string, body: PutBody): Promise<{ rev: number; updatedAt?: string }> {
  return authed(path(id), { method: 'PUT', body });
}

export function deleteCloud(id: string, baseRev?: number): Promise<{ rev: number; deleted: true }> {
  return authed(path(id) + (baseRev !== undefined ? `?baseRev=${baseRev}` : ''), { method: 'DELETE' });
}

export async function listTrash(): Promise<TrashEntry[]> {
  const r = await authed<{ worlds?: TrashEntry[] }>('/v1/trash');
  return Array.isArray(r.worlds) ? r.worlds : [];
}

/** full:传过整个世界的才有。kept 一起回来;no-room 账号里放不下,只回来配方;gone 之前已经清掉了 */
export function restoreTrash(id: string): Promise<{ rev: number; full?: 'kept' | 'no-room' | 'gone' }> {
  return authed(`/v1/trash/${encodeURIComponent(id)}/restore`, { method: 'POST' });
}

/** 开分享(开着就给原来那个);by = 改署名(空字符串 = 不署名,不带 = 不动) */
export function createShare(id: string, by?: string): Promise<ShareInfo> {
  return authed(path(id) + '/share', { method: 'POST', ...(by !== undefined ? { body: { by } } : {}) });
}

export async function stopShare(id: string): Promise<void> {
  await authed(path(id) + '/share', { method: 'DELETE' });
}

export async function listShares(): Promise<ShareInfo[]> {
  return (await listAllShares()).shares;
}

export async function listAllShares(): Promise<{ shares: ShareInfo[]; stopped: StoppedShare[] }> {
  const r = await authed<{ shares?: ShareInfo[]; stopped?: StoppedShare[] }>('/v1/shares');
  return { shares: Array.isArray(r.shares) ? r.shares : [], stopped: Array.isArray(r.stopped) ? r.stopped.filter((x) => x && typeof x.code === 'string') : [] };
}

export async function seenStoppedShare(code: string): Promise<void> {
  await authed(`/v1/shares/${encodeURIComponent(code)}/seen`, { method: 'POST' });
}

export async function reportShareCode(code: string, reason: string): Promise<void> {
  await call(`/v1/s/${encodeURIComponent(code)}/report`, { method: 'POST', body: { reason } });
}

/** 打开别人的分享短链接(不用登录);by = 分享的人填的署名;full = 传过整个世界的,要再下载那一份 */
export function openShareCode(code: string): Promise<{ save: unknown; updatedAt?: string; by?: string; full?: { sum: string; bytes: number; uploadedAt?: string } }> {
  return call(`/v1/s/${encodeURIComponent(code)}`);
}

/** 短链接的码:大小写字母和数字 */
export const SHARE_CODE_RE = /^[A-Za-z0-9]{4,32}$/;

/** 短链接:网站地址/s/<码>(网站放在子目录里也照样) */
export function shortLink(code: string): string {
  const dir = location.pathname.replace(/[^/]*$/, '');
  return `${location.origin}${dir}s/${code}`;
}

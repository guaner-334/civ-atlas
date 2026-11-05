/**
 * 「传到账号」写给人看的字。手机世界页的提示条窄:第一行超了被截断,第二行有按钮时约 13 字一行、最多两行,这里的字都量过,别往后加字。
 * 纯文字,不碰网络;按钮怎么做由调用方给。
 */
import type { FullHit } from '../account/fullWorlds';
import { ServerError } from '../account/server';
import { fullDay, pairText, type FullEntry, type FullJob, type FullLimits, type FullNote, type FullOverview, type FullRefusal, type FullStatus } from './fullWorldView';
import { aboutSize, sizeText } from './sizeWords';

export const NOT_SENT = '没传成，世界在本机没事';

export type NoteAct = 'retry' | 'reload' | 'look' | 'file' | 'share';
export type NoteActs = (act: NoteAct) => FullNote['action'];

const ACT_LABEL: Record<NoteAct, string> = { retry: '再试一次', reload: '刷新页面', look: '看账号里的', file: '存成文件', share: '分享…' };
export const actLabel = (a: NoteAct) => ACT_LABEL[a];

// ---------------------------------------------------------------------------
// 存档菜单

export interface MenuFacts {
  id: string;
  status: FullStatus;
  refusal: FullRefusal | null;
  job: FullJob | null;
  /** 算好的大小 */
  bytes: number | null;
  overview: FullOverview;
  /** 只有配方的世界(旧世界、没建完的):传的也是配方 */
  recipeOnly: boolean;
  /** 转存失败的世界 */
  failed: boolean;
  /** 还在推演 */
  pending: boolean;
  /** 地图留着的世界(另存的) */
  kept: boolean;
}

export interface MenuItem {
  icon: 'cloudup' | 'cloudok';
  title: string;
  small: string;
  off: boolean;
  /** 点了做什么:upload 传,account 打开账号窗,reveal 露出正在传的那一条,refuse 说为什么传不了,none 什么都不做 */
  act: 'upload' | 'account' | 'reveal' | 'refuse' | 'none';
}

const menuRefusal = (r: FullRefusal, o: FullLimits, used: FullOverview['used'], bytes: number | null): string => {
  switch (r) {
    case 'big':
      return `它${aboutSize(bytes ?? 0)}，账号里一个世界最多 ${Math.round(o.worldBytes / 1e6)} MB`;
    case 'count':
      return `账号里已经放满 ${o.worlds} 个。删掉一个不要的再传`;
    case 'bytes':
      return `它${aboutSize(bytes ?? 0)}，账号里只剩 ${sizeText(Math.max(0, o.bytes - used.bytes))}。删掉几个不要的再传`;
    case 'today':
      return `今天传够 ${o.perDay} 次了，明天再传`;
    case 'store':
      return '账号服务器放满了，不是你的账号满了';
  }
};

export function menuItem(f: MenuFacts): MenuItem {
  const size = f.bytes !== null ? aboutSize(f.bytes) : null;
  const { limits, used } = f.overview;
  if (f.job?.id === f.id) return { icon: 'cloudup', title: '正在传到账号', small: f.job.phase === 'check' ? '已经传完，服务器在检查里面的内容' : f.job.total ? pairText(f.job.done, f.job.total) : '别关页面', off: true, act: 'reveal' };
  if (f.job) return { icon: 'cloudup', title: '传到账号', small: `「${f.job.title}」正在传，传完再点这个`, off: true, act: 'reveal' };
  if (f.status.kind === 'same') return { icon: 'cloudok', title: '已传到账号', small: `${fullDay(f.status.entry.uploadedAt)}传的，和现在一样。换设备、分享都看到这一份`, off: false, act: 'account' };
  if (f.failed) return { icon: 'cloudup', title: '传到账号', small: '内容没存下来。「再存一次」以后能传', off: true, act: 'none' };
  if (f.pending) return { icon: 'cloudup', title: '传到账号', small: '还在推演，推完再传', off: true, act: 'none' };
  if (f.recipeOnly) {
    if (f.status.kind === 'recipe') return { icon: 'cloudup', title: '再传一次', small: `账号里是 ${fullDay(f.status.at)}传的配方。再传就换成现在的`, off: false, act: 'upload' };
    return { icon: 'cloudup', title: '传到账号', small: '只有配方，传上去只有几 KB。换设备打开时重新长一遍', off: false, act: 'upload' };
  }
  if (f.refusal) return { icon: 'cloudup', title: '传到账号', small: menuRefusal(f.refusal, limits, used, f.bytes), off: true, act: 'refuse' };
  if (f.status.kind === 'changed') return { icon: 'cloudup', title: '再传一次', small: `账号里是 ${fullDay(f.status.entry.uploadedAt)}那份，之后又改过。再传就换成现在的${size ? `，${size}` : ''}`, off: false, act: 'upload' };
  const whole = `传上整个世界${size ? `（${size}）` : ''}`;
  return { icon: 'cloudup', title: '传到账号', small: f.kept ? `这张地图只在这台设备上。${whole}，别的设备、别人才打得开` : `${whole}，换设备、分享都一模一样`, off: false, act: 'upload' };
}

/** 分享那一项的小字;off = 灰着。这个世界的整个世界不能公开时也灰着,说清为什么 */
export function shareItem(status: FullStatus, kept: boolean): { small: string; off: boolean } {
  const entry: FullEntry | null = status.kind === 'same' || status.kind === 'changed' ? status.entry : null;
  if (entry && entry.public === false && entry.reason === 'opaque') return { small: '带着插件的附加数据，不能公开分享。可以存成文件发给对方', off: true };
  if (entry && entry.public === false && entry.reason === 'text') return { small: '里面有不能公开的字词。改掉再传一次，才能分享', off: true };
  if (!entry) return kept ? { small: '地图带不进配方，对方打不开。传到账号以后就能分享', off: true } : { small: '生成链接，随时能停。对方打开时重新长一遍，可能和你看到的不一样', off: false };
  if (status.kind === 'same') return { small: '生成链接，随时能停。对方看到的和你这里一模一样', off: false };
  return { small: `生成链接，随时能停。对方看到的是 ${fullDay(entry.uploadedAt)}传的那份`, off: false };
}

// ---------------------------------------------------------------------------
// 用了多少

/** 账号窗组头、「占了多少」那一行:2 / 20 个，9.8 / 200 MB */
export function usedLine(o: FullOverview): string {
  const mb = o.used.bytes / 1e6;
  return `${o.used.worlds} / ${o.limits.worlds} 个，${mb < 100 ? mb.toFixed(1) : Math.round(mb)} / ${Math.round(o.limits.bytes / 1e6)} MB`;
}

// ---------------------------------------------------------------------------
// 传了之后说什么

export function doneNote(o: FullOverview | null, acts: NoteActs): FullNote {
  return { kind: 'ok', text: '已传到账号', more: `${o ? `账号里 ${o.used.worlds} / ${o.limits.worlds} 个。` : ''}之后改了不会自动传，要再点一次`, action: acts('share') };
}

/** 只有配方的世界传好了 */
export const recipeDoneNote: FullNote = { kind: 'ok', text: '已传到账号', more: '只传了配方。之后改了不会自动传，要再点一次' };

export const cancelNote = (had: boolean): FullNote => ({ kind: 'ok', text: '已取消', more: had ? '账号里还是上次那份' : '' });

/** 知道传不了(灰着的点了、服务器说的) */
export function refusalNote(r: FullRefusal, limits: FullLimits, o: { bytes?: number | null; left?: number | null; max?: number }, acts: NoteActs): FullNote {
  switch (r) {
    case 'count':
      return { kind: 'warn', text: `账号里已经放满 ${o.max ?? limits.worlds} 个`, more: '删掉一个，就能传这个', action: acts('look') };
    case 'bytes':
      return { kind: 'warn', text: '账号里放不下这个世界', more: `它${aboutSize(o.bytes ?? 0)}，账号里只剩 ${sizeText(o.left ?? 0)}。删掉几个就能传`, action: acts('look') };
    case 'big':
      return { kind: 'warn', text: '这个世界太大，传不了', more: `它${aboutSize(o.bytes ?? 0)}，一个世界最多 ${Math.round((o.max ?? limits.worldBytes) / 1e6)} MB。可以存成文件`, action: acts('file') };
    case 'today':
      return { kind: 'warn', text: `今天传够 ${o.max ?? limits.perDay} 次了`, more: '明天再传。世界在本机没事' };
    case 'store':
      return { kind: 'warn', text: '账号服务器放满了', more: '不是你的账号满了。世界在本机没事，可以先存成文件', action: acts('file') };
  }
}

const busyNote = (acts: NoteActs): FullNote => ({ kind: 'error', text: NOT_SENT, more: '服务器这会儿太忙，没核对完。等一会儿再试', action: acts('retry') });
const checkNote = (acts: NoteActs): FullNote => ({ kind: 'error', text: NOT_SENT, more: '服务器核对没通过，可能是网站刚更新。刷新页面再传一次', action: acts('reload') });

/** 文字审核没过:说是哪个名字。作者写的排在前面;网页自己写的用的人改不了,给存成文件 */
export function textNote(hits: readonly FullHit[], count: number, acts: NoteActs): FullNote {
  const first = hits.find((h) => h.by === 'author') ?? hits.find((h) => h.by === 'ai') ?? hits[0];
  const n = Math.max(count, hits.length);
  if (first?.by === 'author') return { kind: 'error', text: NOT_SENT, more: n > 1 ? `${first.kind}「${first.text}」等 ${n} 处没通过文字审核，改掉再传` : `${first.kind}「${first.text}」没通过文字审核，改个名再传` };
  if (first?.by === 'ai') return { kind: 'error', text: NOT_SENT, more: n > 1 ? `AI 写的「${first.text}」等 ${n} 处没通过文字审核。删掉或重写再传` : `AI 写的「${first.text}」没通过文字审核。删掉或重写再传` };
  return { kind: 'error', text: NOT_SENT, more: `网页自己写的${first?.kind ?? '内容'}没过文字审核，改不了。可以存成文件`, action: acts('file') };
}

/** 服务器说的错。sending:已经开始传块了 */
export function errorNote(e: unknown, limits: FullLimits | null, sending: boolean, acts: NoteActs): FullNote {
  const err = e instanceof ServerError ? e : null;
  const lim = limits ?? { worlds: 20, bytes: 200e6, perDay: 30, worldBytes: 150e6, blockBytes: 16777216, blocksPerFile: 512 };
  const data = (err?.data ?? {}) as { max?: number; maxBytes?: number; worldBytes?: number; leftBytes?: number };
  switch (err?.code) {
    case 'full-count':
      return refusalNote('count', lim, { max: data.max }, acts);
    case 'full-bytes':
      return refusalNote('bytes', lim, { bytes: data.worldBytes, left: data.leftBytes }, acts);
    case 'world-too-big':
      return refusalNote('big', lim, { bytes: data.worldBytes, max: data.maxBytes }, acts);
    case 'full-daily':
      return data.max ? refusalNote('today', lim, { max: data.max }, acts) : { kind: 'warn', text: '今天传的内容太多了', more: '明天再传。世界在本机没事' };
    case 'storage-full':
      return refusalNote('store', lim, {}, acts);
    case 'world-invalid':
    case 'world-newer':
      return checkNote(acts);
    case 'check-limit':
    case 'busy':
    case 'pending-full':
    case 'rate-limit':
    case 'unavailable':
      return busyNote(acts);
    case 'auth':
      return { kind: 'error', text: '登录过期了，请重新登录', more: '' };
    case 'network':
      return sending ? { kind: 'warn', text: '传到一半断线了', more: '世界在本机没事，传上去的不用重传', action: acts('retry') } : { kind: 'error', text: NOT_SENT, more: '连不上服务器，联网后再试', action: acts('retry') };
    default:
      return { kind: 'error', text: NOT_SENT, more: err?.message ?? '出错了，再试一次', action: acts('retry') };
  }
}

// ---------------------------------------------------------------------------
// 从账号里删

/** 确认时那一行小字。here:这台设备上有这个世界;shared:开着分享 */
export function removeWords(o: { here: boolean; shared: boolean }): string {
  if (!o.here) return '这台设备上没有它。删掉以后 30 天内能在「最近删除」里找回';
  return `删掉账号里这一份？这台设备上的世界不动。${o.shared ? '分享的链接会打不开' : ''}`;
}

/** 投到作品墙写给人看的字:服务器说的错、核对没过的原因换成投稿窗、提示条上的说法。纯文字,不碰网络。 */
import type { FullHit } from '../account/fullWorlds';
import { ServerError } from '../account/server';
import type { SubmitCheckError, SubmitLimits } from '../account/submissions';
import { pairText } from './fullWorldView';
import { readBan, type SubmitBan, type SubmitJob } from './submitView';
import { aboutSize } from './sizeWords';

export const NOT_SUBMITTED = '没投成，世界在本机没事';

export type SubmitField = 'title' | 'by' | 'blurb';

export interface HitLine {
  label: string;
  text: string;
}

/** 表单下面那块红底按钮换成什么:再投一次、刷新页面、存成文件 */
export type FailAct = 'retry' | 'reload' | 'file';

export type SubmitFail =
  /** 传到一半断线了(窗里那一行,「接着传」) */
  | { kind: 'net' }
  /** 按钮上面一行红字 */
  | { kind: 'line'; text: string }
  /** 碰到敏感词:one = 只有一处时那一句,不然列 lines;fields = 作者填的哪几栏标红 */
  | { kind: 'hits'; count: number; lines: HitLine[]; one: string | null; fields: SubmitField[] }
  /** 表单下面一块红底 */
  | { kind: 'block'; head: string | null; text: string; act: FailAct }
  /** 须知换了版本 */
  | { kind: 'terms' }
  /** 窗口换成说明:今天投满、等审满、账号停了投稿 */
  | { kind: 'notice'; which: 'per-day' | 'pending' | 'ban'; ban?: SubmitBan; limits?: Partial<SubmitLimits> }
  /** 服务器要先绑手机号 */
  | { kind: 'phone' };

const OFFLINE = '连不上服务器，没投成。联网后再点一次「投稿」';
const BUSY: SubmitFail = { kind: 'block', head: `${NOT_SUBMITTED}。`, text: '服务器这会儿太忙，没核对完。等一会儿再投', act: 'retry' };
const CHECK: SubmitFail = { kind: 'block', head: `${NOT_SUBMITTED}。`, text: '服务器核对没通过，可能是网站刚更新。刷新页面再投一次', act: 'reload' };
const OPAQUE: SubmitFail = { kind: 'block', head: `${NOT_SUBMITTED}。`, text: '带着插件的附加数据，我们看不到里面，不能投。可以存成文件发给别人', act: 'file' };

export const bigLine = (bytes: number, max: number) => `它${aboutSize(bytes)}，作品墙一个世界最多 ${Math.round(max / 1e6)} MB`;
export const STALE_LINE = '还在推演，推完再投';

const FIELD_OF: Readonly<Record<string, SubmitField>> = { 作品名: 'title', 署名: 'by', 一句话介绍: 'blurb' };
const FIELD_LABEL: Readonly<Record<SubmitField, string>> = { title: '作品名', by: '署名', blurb: '介绍' };

/** 文字审核没过:作者填的那几栏说「上面标红的那一句」;网页自己写的改不了,这个世界投不了 */
export function hitsFail(hits: readonly FullHit[], hitCount: number): SubmitFail {
  const count = Math.max(hitCount, hits.length);
  const site = hits.filter((h) => h.by === 'site');
  if (site.length) return { kind: 'block', head: null, text: `网页自己写的${site[0].kind}有 ${site.length} 处没通过文字审核，改不了，这个世界投不了。可以存成文件发给别人`, act: 'file' };
  const fields: SubmitField[] = [];
  const lines = hits.map((h): HitLine => {
    const f = h.part === 'info' ? FIELD_OF[h.kind] : undefined;
    if (f) {
      if (!fields.includes(f)) fields.push(f);
      return { label: FIELD_LABEL[f], text: '上面标红的那一句' };
    }
    if (h.by === 'ai') return { label: 'AI 写的', text: `「${h.text}」那一段` };
    return { label: h.kind, text: `「${h.text}」` };
  });
  const only = count === 1 && hits.length === 1 && hits[0].by === 'author' && !fields.length ? hits[0] : null;
  return { kind: 'hits', count, lines, one: only ? `${only.kind}「${only.text}」没通过文字审核，改个名再投` : null, fields };
}

const limitNum = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d);

/** 服务器说的错。sending:已经开始传块了 */
export function submitFail(e: unknown, sending = false): SubmitFail {
  if (!(e instanceof ServerError)) return { kind: 'line', text: e instanceof Error && e.message ? e.message : String(e) };
  const d = e.data as { limit?: unknown; perDay?: unknown; pendingMax?: unknown; hits?: unknown; hitCount?: unknown; ban?: unknown; worldBytes?: unknown; maxBytes?: unknown };
  switch (e.code) {
    case 'network':
      return sending ? { kind: 'net' } : { kind: 'line', text: OFFLINE };
    case 'terms-changed':
      return { kind: 'terms' };
    case 'content-filter':
      return hitsFail(Array.isArray(d.hits) ? (d.hits as FullHit[]) : [], typeof d.hitCount === 'number' ? d.hitCount : 0);
    case 'submit-limit':
      if (d.limit === 'per-day') return { kind: 'line', text: `今天已经投满 ${limitNum(d.perDay, 3)} 次了，明天再投` };
      if (d.limit === 'pending') return { kind: 'line', text: `等审的已经有 ${limitNum(d.pendingMax, 5)} 件了，审完或撤回一件再投` };
      return { kind: 'line', text: e.message };
    case 'submit-banned': {
      const ban = readBan(d.ban);
      return ban ? { kind: 'notice', which: 'ban', ban } : { kind: 'line', text: e.message };
    }
    case 'need-phone':
      return { kind: 'phone' };
    case 'auth':
      return { kind: 'line', text: '登录过期了，请重新登录' };
    case 'world-too-big':
      return typeof d.worldBytes === 'number' ? { kind: 'line', text: bigLine(d.worldBytes, limitNum(d.maxBytes, 150e6)) } : { kind: 'line', text: e.message };
    case 'world-invalid':
    case 'world-newer':
    case 'bad-hash':
      return CHECK;
    case 'busy':
    case 'rate-limit':
    case 'pending-full':
    case 'storage-full':
    case 'check-limit':
    case 'blocks-missing':
    case 'unavailable':
    case 'server':
      return BUSY;
    default:
      return { kind: 'line', text: e.message };
  }
}

/** 投世界核对没过(GET /v1/submissions/:id 的 error) */
export function checkFail(err: SubmitCheckError | undefined, reason?: string): SubmitFail {
  if (!err?.code) return { kind: 'line', text: reason || NOT_SUBMITTED };
  if (err.code === 'world-opaque') return OPAQUE;
  if (err.code === 'content-filter') return hitsFail(err.hits ?? [], err.hitCount ?? 0);
  return submitFail(new ServerError(0, err.code, err.message || reason || NOT_SUBMITTED, err as unknown as Record<string, unknown>));
}

/** 打开投稿窗时就知道投不了的:账号停了投稿、今天投满、等审满 */
export function openNotice(o: { limits: SubmitLimits | null; ban: SubmitBan | null }): Extract<SubmitFail, { kind: 'notice' }> | null {
  if (o.ban) return { kind: 'notice', which: 'ban', ban: o.ban };
  const l = o.limits;
  if (l && l.usedToday >= l.perDay) return { kind: 'notice', which: 'per-day', limits: l };
  if (l && l.pending >= l.pendingMax) return { kind: 'notice', which: 'pending', limits: l };
  return null;
}

// ---------------------------------------------------------------------------
// 提示条(投稿窗关着的时候)

export interface ToastWords {
  kind: 'progress' | 'ok' | 'warn' | 'error';
  text: string;
  more: string;
  progress?: number;
  /** 按钮:cancel 取消、look 看我的投稿、resume 接着传,或者红底那块的按钮 */
  act?: 'cancel' | 'look' | 'resume' | FailAct;
}

export function jobWords(j: SubmitJob): ToastWords {
  if (j.phase === 'check') return { kind: 'progress', text: `正在核对「${j.title}」`, more: '已经传完，服务器在检查里面的内容' };
  const sending = j.phase === 'send' && j.total > 0;
  return { kind: 'progress', text: `正在投「${j.title}」`, more: sending ? `${pairText(j.done, j.total)}，别关页面` : '别关页面', ...(sending ? { progress: j.done / j.total } : {}), act: 'cancel' };
}

export const DONE_WORDS: ToastWords = { kind: 'ok', text: '投好了，等我们看', more: '结果会发邮件，也能在「我的投稿」里看', act: 'look' };

/** 没投成:提示条只有两行,碰到词的说第一处 */
export function failWords(f: SubmitFail): ToastWords {
  switch (f.kind) {
    case 'net':
      return { kind: 'warn', text: '传到一半断线了', more: '世界在本机没事，传上去的不用重传', act: 'resume' };
    case 'line':
      return { kind: 'error', text: NOT_SUBMITTED, more: f.text };
    case 'block':
      return { kind: 'error', text: NOT_SUBMITTED, more: f.text, act: f.act };
    case 'hits': {
      if (f.one) return { kind: 'error', text: NOT_SUBMITTED, more: f.one };
      const first = f.lines[0];
      return { kind: 'error', text: NOT_SUBMITTED, more: first ? `${first.label}${first.text === '上面标红的那一句' ? '' : first.text}等 ${f.count} 处没通过文字审核，改掉再投` : '' };
    }
    case 'terms':
      return { kind: 'error', text: NOT_SUBMITTED, more: '投稿须知改过了，看过再勾上' };
    case 'notice':
      if (f.which === 'ban') return { kind: 'error', text: '你的账号已停止投稿', more: f.ban?.reasonText ? `原因：${f.ban.reasonText}` : '' };
      if (f.which === 'per-day') return { kind: 'warn', text: `今天投满 ${limitNum(f.limits?.perDay, 3)} 次了`, more: '明天再来。世界在本机没事' };
      return { kind: 'warn', text: `等审的已经有 ${limitNum(f.limits?.pendingMax, 5)} 件了`, more: '审完或撤回一件再投' };
    case 'phone':
      return { kind: 'error', text: NOT_SUBMITTED, more: '' };
  }
}

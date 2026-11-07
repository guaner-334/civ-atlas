/**
 * 投到作品墙:服务器接口。块的切法、传块和传到账号同一套(fullWorlds.ts)。
 *
 *   GET    /v1/submissions               → { submissions, limits, terms, ban? }
 *   GET    /v1/submissions/:id           → 一份
 *   POST   /v1/submissions               → 201 { id, status: 'pending' }(地图交存档,新建参数、规则交链接 # 后面那段)
 *   POST   /v1/submissions/world/begin   → { need }(要传哪些块;这个账号传过的块不用再传)
 *   POST   /v1/submissions/world         → 202 { id, status: 'checking' }(服务器在后台核对,这一步取消不了)
 *   DELETE /v1/submissions/:id           → 204 撤回核对中、等审、审核中的(当天的次数不退)
 *   POST   /v1/submissions/:id/withdraw  → 撤下已上墙的,回这一份
 */
import type { BlockPlan, FullHit } from './fullWorlds';
import { ServerError } from './server';
import { authed } from './session';

export type SubmitKind = 'world' | 'map' | 'preset' | 'rules';

export interface SubmitLimits {
  perDay: number;
  usedToday: number;
  pendingMax: number;
  pending: number;
}

/** 投世界核对没过的原因(同传到账号的核对结果) */
export interface SubmitCheckError {
  code: string;
  message?: string;
  hits?: FullHit[];
  hitCount?: number;
  parts?: string[];
  retryAfter?: number;
}

export interface Submission {
  id: number;
  kind: SubmitKind;
  title: string;
  status: string;
  reason?: string;
  error?: SubmitCheckError;
  /** 上墙以后作品墙上的作品编号 */
  workId?: string;
  createdAt?: string;
  updatedAt?: string;
  /** 上墙、退回的时间 */
  decidedAt?: string;
}

/** 地图、新建参数、规则交的东西:地图交存档,另外两种交链接 # 后面那段 */
export type SmallWork = { kind: 'map'; save: unknown } | { kind: 'preset' | 'rules'; link: string };

export interface SubmissionList {
  submissions: Submission[];
  limits: SubmitLimits | null;
  /** 服务器现在的投稿须知第几版 */
  terms: number | null;
  ban?: unknown;
}

/** 作者填的几栏(作品名、署名、一句话)和看过的须知版本 */
export interface SubmitForm {
  title: string;
  by: string;
  blurb: string;
  terms: number;
}

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export async function fetchSubmissions(): Promise<SubmissionList> {
  const r = await authed<{ submissions?: unknown; limits?: Partial<SubmitLimits>; terms?: unknown; ban?: unknown }>('/v1/submissions');
  const l = r.limits;
  return {
    submissions: Array.isArray(r.submissions) ? (r.submissions as Submission[]) : [],
    limits: l ? { perDay: num(l.perDay, 3), usedToday: num(l.usedToday), pendingMax: num(l.pendingMax, 5), pending: num(l.pending) } : null,
    terms: typeof r.terms === 'number' ? r.terms : null,
    ...(r.ban ? { ban: r.ban } : {}),
  };
}

export function fetchSubmission(id: number): Promise<Submission> {
  return authed(`/v1/submissions/${id}`);
}

const wirePlan = (p: BlockPlan) => ({ sum: p.sum, blocks: p.blocks.map((b) => ({ sum: b.sum, bytes: b.bytes })) });

export function beginWorldSubmit(plan: BlockPlan): Promise<{ need: string[] }> {
  return authed('/v1/submissions/world/begin', { method: 'POST', body: { plan: wirePlan(plan) } });
}

export function commitWorldSubmit(plan: BlockPlan, form: SubmitForm, moment: number | null): Promise<{ id: number; status: string }> {
  return authed('/v1/submissions/world', { method: 'POST', body: { plan: wirePlan(plan), ...form, ...(moment !== null ? { moment } : {}) } });
}

export function postSubmission(work: SmallWork, form: SubmitForm): Promise<{ id: number; status: string }> {
  return authed('/v1/submissions', { method: 'POST', body: { ...work, ...form } });
}

export async function cancelSubmission(id: number): Promise<void> {
  await authed(`/v1/submissions/${id}`, { method: 'DELETE' });
}

export function takedownSubmission(id: number): Promise<Submission> {
  return authed(`/v1/submissions/${id}/withdraw`, { method: 'POST' });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('取消了', 'AbortError'));
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('取消了', 'AbortError'));
    });
  });

/** 等服务器核对完。断线了接着问(核对不受影响),问不到太久才抛 */
export async function waitSubmission(id: number, o: { signal: AbortSignal; everyMs?: number }): Promise<Submission> {
  let misses = 0;
  for (;;) {
    await sleep(o.everyMs ?? 1500, o.signal);
    try {
      const r = await fetchSubmission(id);
      misses = 0;
      if (r.status !== 'checking') return r;
    } catch (e) {
      if (!(e instanceof ServerError) || (e.code !== 'network' && e.code !== 'unavailable' && e.status < 500) || ++misses >= 20) throw e;
    }
  }
}

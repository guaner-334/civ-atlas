/**
 * 传到账号的世界:服务器接口。用的人点了才传,和 sync.ts 的自动同步是两回事。
 *
 *   GET    /v1/world-full                → 限额、用量、传过的清单;服务器没开这个功能:404
 *   POST   /v1/worlds/:id/full/begin     → { need, current? }(先问:放不放得下、哪些块要传;断线再问就是接着传)
 *   PUT    /v1/world-blocks/:sum         → 传一块
 *   POST   /v1/worlds/:id/full           → 202 checking / 200 done(提交;服务器在后台核对,这一步取消不了)
 *   GET    /v1/worlds/:id/full/status    → checking / done / failed / none
 *   GET    /v1/worlds/:id/full           → 下载
 *   GET    /v1/s/:code/full              → 下载分享的(不用登录)
 */
import type { FullEntry, FullOverview } from '../ui/fullWorldView';
import { listCloud } from './cloud';
import { serverBase, ServerError } from './server';
import { authToken, authed, sessionExpired } from './session';

/** 块的切法和指纹(fullBlocks.ts) */
export interface BlockPlan {
  sum: string;
  bytes: number;
  blocks: { sum: string; bytes: number; start: number }[];
}

const wirePlan = (p: BlockPlan) => ({ sum: p.sum, blocks: p.blocks.map((b) => ({ sum: b.sum, bytes: b.bytes })) });
const fullPath = (id: string) => `/v1/worlds/${encodeURIComponent(id)}/full`;

/** 限额、用量、清单和账号里所有的世界(只读);服务器没开这个功能 = null */
export async function fetchOverview(): Promise<FullOverview | null> {
  let r: Partial<FullOverview>;
  try {
    r = await authed<Partial<FullOverview>>('/v1/world-full');
  } catch (e) {
    if (e instanceof ServerError && e.status === 404) return null;
    throw e;
  }
  if (!r.limits || !r.used || !Array.isArray(r.worlds)) return null;
  const list = await listCloud();
  return {
    limits: r.limits,
    used: r.used,
    storeFull: !!r.storeFull,
    worlds: r.worlds.filter((w) => w && typeof w.id === 'string'),
    account: list.filter((w) => !w.deleted).map((w) => ({ id: w.id, rev: w.rev, ...(w.updatedAt ? { updatedAt: w.updatedAt } : {}) })),
  };
}

export function beginFull(id: string, plan: BlockPlan, baseRev: number): Promise<{ need: string[]; current?: FullEntry }> {
  return authed(`${fullPath(id)}/begin`, { method: 'POST', body: { baseRev, ...wirePlan(plan) } });
}

export type FullCheck = { state: 'checking'; sum?: string } | { state: 'done'; sum?: string; world: FullEntry } | { state: 'failed'; sum?: string; error: { code: string; message?: string; hits?: FullHit[]; hitCount?: number; retryAfter?: number } } | { state: 'none' };

export interface FullHit {
  by: 'author' | 'ai' | 'site';
  part?: string;
  kind: string;
  text: string;
}

export function commitFull(id: string, plan: BlockPlan, baseRev: number, mark: string): Promise<FullCheck> {
  return authed(fullPath(id), { method: 'POST', body: { baseRev, mark, ...wirePlan(plan) } });
}

export function fullCheck(id: string): Promise<FullCheck> {
  return authed(`${fullPath(id)}/status`);
}

// ---------------------------------------------------------------------------
// 传块

/** 一块传不动多久算断了(毫秒) */
const STALL_MS = 60_000;
/** 一块最多试几次 */
const TRIES = 4;
const WAITS_MS = [1000, 3000, 8000];
/** 服务器说太忙时最多等多久再试(毫秒) */
const MAX_WAIT_MS = 15_000;
/** 同时传几块:服务器每个账号最多 4 个 */
const AT_ONCE = 4;

type BlockSender = (sum: string, data: Blob, o: { signal: AbortSignal; onBytes: (loaded: number) => void; token?: string }) => Promise<void>;

const networkError = () => new ServerError(0, 'network', '连不上服务器，请检查网络后再试');

function errorOf(status: number, raw: string, token: string | undefined): ServerError {
  let e: Record<string, unknown> = {};
  try {
    const j = JSON.parse(raw) as { error?: Record<string, unknown> } | null;
    if (j?.error && typeof j.error === 'object') e = j.error;
  } catch {
    /* 不是 JSON */
  }
  const code = typeof e.code === 'string' && e.code ? e.code : status === 401 ? 'auth' : status === 503 ? 'busy' : 'server';
  if ((status === 401 || code === 'auth') && token) sessionExpired(token);
  const { code: _c, message, ...data } = e;
  return new ServerError(status, code, typeof message === 'string' ? message : `服务器出错了(HTTP ${status})`, data);
}

/** 要看传了多少字节,只能用 XMLHttpRequest */
const xhrSender: BlockSender = (sum, data, { signal, onBytes, token }) =>
  new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', `${serverBase()}/v1/world-blocks/${sum}`);
    if (token) x.setRequestHeader('Authorization', `Bearer ${token}`);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    let timer: ReturnType<typeof setTimeout>;
    const stalled = () => {
      clearTimeout(timer);
      timer = setTimeout(() => x.abort(), STALL_MS);
    };
    const end = (f: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      f();
    };
    const stop = () => x.abort();
    if (signal.aborted) return reject(new DOMException('取消了', 'AbortError'));
    x.upload.onprogress = (e) => {
      stalled();
      onBytes(e.loaded);
    };
    x.onload = () => end(() => (x.status >= 200 && x.status < 300 ? resolve() : reject(errorOf(x.status, x.responseText, token))));
    x.onerror = () => end(() => reject(networkError()));
    x.onabort = () => end(() => reject(signal.aborted ? new DOMException('取消了', 'AbortError') : networkError()));
    signal.addEventListener('abort', stop);
    stalled();
    x.send(data);
  });

let sender: BlockSender = xhrSender;
let sleepFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new DOMException('取消了', 'AbortError'));
    });
  });

/** 单测用:换掉传块的办法和等待 */
export function _setFullNet(o: { sender?: BlockSender; sleep?: typeof sleepFor }) {
  sender = o.sender ?? xhrSender;
  if (o.sleep) sleepFor = o.sleep;
}

/** 重试也救不了的,直接报 */
const retryable = (e: unknown) => e instanceof ServerError && (e.code === 'network' || e.code === 'bad-hash' || e.code === 'busy' || e.code === 'server' || e.code === 'unavailable' || e.code === 'bad-request');

/** 传 need 里的块(不在 plan 里的不管)。断了先自己重试,还不行才抛 network。onSent:一共传了多少字节 */
export async function sendBlocks(file: Blob, plan: BlockPlan, need: readonly string[], o: { signal: AbortSignal; onSent?: (bytes: number) => void; token?: string }): Promise<void> {
  const wanted = new Set(need);
  const seen = new Set<string>();
  const todo = plan.blocks.filter((b) => wanted.has(b.sum) && !seen.has(b.sum) && seen.add(b.sum));
  const sent = new Map<string, number>();
  const tell = () => o.onSent?.([...sent.values()].reduce((n, b) => n + b, 0));
  // 一处报错就让别的也停下,不然断线时还在传
  const stop = new AbortController();
  const outer = () => stop.abort();
  o.signal.addEventListener('abort', outer);
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !stop.signal.aborted) {
      const b = todo[next++];
      for (let tries = 1; ; tries++) {
        try {
          await sender(b.sum, file.slice(b.start, b.start + b.bytes), {
            signal: stop.signal,
            token: o.token ?? authToken(),
            onBytes: (n) => {
              sent.set(b.sum, Math.min(n, b.bytes));
              tell();
            },
          });
          sent.set(b.sum, b.bytes);
          tell();
          break;
        } catch (e) {
          if (!retryable(e) || tries >= TRIES) throw e;
          sent.set(b.sum, 0);
          tell();
          const after = Number((e as ServerError).data?.retryAfter);
          await sleepFor(after > 0 ? Math.min(after * 1000, MAX_WAIT_MS) : WAITS_MS[tries - 1], stop.signal);
        }
      }
    }
  };
  const failed: { e?: unknown } = {};
  try {
    await Promise.all(
      Array.from({ length: Math.min(AT_ONCE, todo.length) }, () =>
        worker().catch((e: unknown) => {
          // 第一个是真的原因,后面几个是被它停下的
          if (!('e' in failed)) failed.e = e;
          stop.abort();
        }),
      ),
    );
    if ('e' in failed) throw failed.e;
  } finally {
    o.signal.removeEventListener('abort', outer);
  }
}

/** 等服务器核对完。断线了接着问(核对不受影响),问不到太久才抛 */
export async function waitChecked(id: string, o: { signal?: AbortSignal; everyMs?: number } = {}): Promise<FullCheck> {
  const signal = o.signal ?? new AbortController().signal;
  let misses = 0;
  for (;;) {
    await sleepFor(o.everyMs ?? 1500, signal);
    try {
      const r = await fullCheck(id);
      misses = 0;
      if (r.state !== 'checking') return r;
    } catch (e) {
      if (!(e instanceof ServerError) || (e.code !== 'network' && e.code !== 'unavailable' && e.status < 500) || ++misses >= 20) throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// 取

/** 取的时候多久没收到字节算断了(毫秒) */
const READ_STALL_MS = 60_000;

/** 下载整个世界文件,一边收一边报进度。出错抛 ServerError */
export async function fetchFile(path: string, o: { token?: string; total?: number; signal?: AbortSignal; onBytes?: (done: number, total: number) => void } = {}): Promise<Blob> {
  const base = serverBase();
  if (!base) throw new ServerError(0, 'not-configured', '还没有开放');
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  o.signal?.addEventListener('abort', stop);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(stop, READ_STALL_MS);
  };
  kick();
  try {
    let res: Response;
    try {
      res = await fetch(base + path, { credentials: 'omit', signal: ctl.signal, headers: o.token ? { Authorization: `Bearer ${o.token}` } : {} });
    } catch {
      throw networkError();
    }
    if (!res.ok) throw errorOf(res.status, await res.text().catch(() => ''), o.token);
    const total = Number(res.headers.get('Content-Length')) || o.total || 0;
    if (!res.body) return await res.blob();
    const reader = res.body.getReader();
    // 不把大世界攒成一个大数组:隔一段拼成 Blob,浏览器会放到硬盘上
    const parts: Blob[] = [];
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let done = 0;
    const roll = () => {
      if (!pendingBytes) return;
      parts.push(new Blob(pending as BlobPart[]));
      pending = [];
      pendingBytes = 0;
    };
    try {
      for (;;) {
        const r = await reader.read();
        if (r.done) break;
        kick();
        pending.push(r.value);
        pendingBytes += r.value.length;
        done += r.value.length;
        if (pendingBytes >= 8e6) roll();
        o.onBytes?.(done, total);
      }
    } catch {
      throw networkError();
    }
    roll();
    if (total && done !== total) throw networkError();
    return new Blob(parts, { type: 'application/octet-stream' });
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', stop);
  }
}

/** 取账号里这个世界的文件 */
export function fetchOwnFile(id: string, o: { total?: number; signal?: AbortSignal; onBytes?: (done: number, total: number) => void } = {}): Promise<Blob> {
  return fetchFile(fullPath(id), { ...o, token: authToken() });
}

/** 取分享的世界文件(不用登录) */
export function fetchSharedFile(code: string, o: { total?: number; signal?: AbortSignal; onBytes?: (done: number, total: number) => void } = {}): Promise<Blob> {
  return fetchFile(`/v1/s/${encodeURIComponent(code)}/full`, o);
}

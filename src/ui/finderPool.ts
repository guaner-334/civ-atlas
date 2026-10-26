/**
 * 照故事找世界的后台线程池:开几个 finderWorker.ts,一个线程一次推一个种子,推完只交回量出来的数(gen/finder)。
 * - 一边搜一边交出结果(onReport,先推完的先交;排序交给 gen/finder/query.ts 的 summarize)
 * - 能停(stop:关掉线程,推了一半的那几个作废,已经交回的留着)、能暂停(pause:不再派新的,在推的推完;手机锁屏、切到后台时用)
 * - 种子从小到大派;接着搜用 query.ts 的 nextSeeds(停下时没推完的先补上)。同样的条件、同一批种子,谁搜结果都一样
 * 主线程只派活、收结果(每个种子几 KB),不做重活:搜的时候地图照样能拖能点。
 */
import type { FinderDone, FinderJob } from '../finderWorker';
import { bestRow, type FinderQuery, type FinderSetup, type SeedReport } from '../gen/finder/query';

/** 一个后台线程(浏览器里是 Worker;测试里换成假的) */
export interface FinderThread {
  postMessage(job: FinderJob): void;
  terminate(): void;
  onmessage: ((e: { data: FinderDone }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export function spawnFinderThread(): FinderThread {
  return new Worker(new URL('../finderWorker.ts', import.meta.url), { type: 'module' }) as unknown as FinderThread;
}

/** 默认一次搜几个:电脑 200、手机 100 */
export const FINDER_COUNT = { desktop: 200, phone: 100 } as const;

/** 开几个线程:电脑按核数取一半、最多 6 个;手机 2 个 */
export function finderThreads(cores: number, phone: boolean): number {
  if (phone) return 2;
  return Math.max(1, Math.min(6, Math.floor((cores || 2) / 2)));
}

/**
 * 一个线程推一个种子大约多久(毫秒):电脑实测(Chrome,4 个线程同时推,别的程序也在跑)一个约 3–3.5 秒;
 * 手机按慢 4 倍算。开搜前估"约几分钟"用,推完几个以后按实测改(FinderProgress.etaMs)
 */
export const PER_SEED_MS = { desktop: 3500, phone: 14000 } as const;

/** 开搜前估要多久(毫秒) */
export function estimateMs(count: number, threads: number, phone: boolean): number {
  return Math.ceil(count / Math.max(1, threads)) * (phone ? PER_SEED_MS.phone : PER_SEED_MS.desktop);
}

export type FinderState = 'running' | 'paused' | 'stopped' | 'done';

export interface FinderProgress {
  /** 推完几个 / 一共几个 */
  done: number;
  total: number;
  /** 作者写的条件下:全合几个、差一条几个 */
  full: number;
  near: number;
  /** 还要多久(毫秒):推完几个以后按已推完的平均算(暂停的时间不算),一个都没推完时按 PER_SEED_MS 估 */
  etaMs: number;
  state: FinderState;
  /** 线程起不来、接连出错:停下了,写原因 */
  error?: string;
}

export interface FinderRunOptions {
  query: FinderQuery;
  setup: FinderSetup;
  /** 要推的种子(从小到大派) */
  seeds: readonly number[];
  threads: number;
  /** 推完一个就交一个(先推完的先交) */
  onReport?: (r: SeedReport) => void;
  /** 进度变了(推完一个、暂停、接着、停下、全推完) */
  onProgress?: (p: FinderProgress) => void;
  /** 开线程(不给 = 浏览器的 Worker) */
  spawn?: () => FinderThread;
  /** 一个都没推完时,估一个线程推一个种子多久(毫秒) */
  perSeedMs?: number;
}

/** 线程接连出错这么多次就不再重开 */
const MAX_RESPAWN = 3;

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

interface Slot {
  t: FinderThread;
  job: FinderJob | null;
}

/** 一次搜:new 了就开始,stop 停下;finished 在全推完或停下时给最后的进度 */
export class FinderSearch {
  /** 交回来的(按交回的先后) */
  readonly reports: SeedReport[] = [];
  readonly finished: Promise<FinderProgress>;
  private readonly opt: FinderRunOptions;
  private readonly queue: number[];
  private slots: Slot[] = [];
  private state: FinderState = 'running';
  private error?: string;
  private seq = 0;
  private respawned = 0;
  private full = 0;
  private near = 0;
  /** 在跑的时间(毫秒;暂停的不算):算还要多久用 */
  private active = 0;
  private since = clock();
  private resolve!: (p: FinderProgress) => void;

  constructor(opt: FinderRunOptions) {
    this.opt = opt;
    this.queue = opt.seeds.slice();
    this.finished = new Promise((r) => (this.resolve = r));
    const n = Math.max(1, Math.min(opt.threads, this.queue.length || 1));
    try {
      for (let i = 0; i < n && this.queue.length; i++) this.slots.push(this.open());
    } catch (e) {
      this.fail(`后台线程起不来:${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (!this.queue.length) {
      this.end('done');
      return;
    }
    for (const s of this.slots) this.feed(s);
    this.emit();
  }

  /** 推完的种子 */
  get doneSeeds(): Set<number> {
    return new Set(this.reports.map((r) => r.seed));
  }

  progress(): FinderProgress {
    const done = this.reports.length;
    const total = this.opt.seeds.length;
    const left = total - done;
    const active = this.active + (this.state === 'running' ? clock() - this.since : 0);
    const per = this.opt.perSeedMs ?? PER_SEED_MS.desktop;
    const etaMs = left <= 0 || this.state === 'stopped' ? 0 : done ? (active / done) * left : Math.ceil(left / Math.max(1, this.slots.length)) * per;
    return { done, total, full: this.full, near: this.near, etaMs: Math.round(etaMs), state: this.state, ...(this.error ? { error: this.error } : {}) };
  }

  /** 暂停:不再派新的,在推的推完交回(手机锁屏、浏览器切到后台时) */
  pause(): void {
    if (this.state !== 'running') return;
    this.active += clock() - this.since;
    this.state = 'paused';
    this.emit();
  }

  /** 接着推 */
  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.since = clock();
    for (const s of this.slots) if (!s.job) this.feed(s);
    this.emit();
    this.check();
  }

  /** 停下:关掉线程,推了一半的作废;已经交回的留着(reports) */
  stop(): void {
    if (this.state === 'stopped' || this.state === 'done') return;
    this.end('stopped');
  }

  private open(): Slot {
    const t = (this.opt.spawn ?? spawnFinderThread)();
    const slot: Slot = { t, job: null };
    t.onmessage = (e) => this.receive(slot, e.data);
    t.onerror = (e) => this.crash(slot, e);
    return slot;
  }

  private feed(s: Slot): void {
    if (this.state !== 'running' || s.job || !this.queue.length) return;
    const seed = this.queue.shift()!;
    s.job = { id: ++this.seq, query: this.opt.query, setup: this.opt.setup, seed };
    s.t.postMessage(s.job);
  }

  private receive(s: Slot, d: FinderDone): void {
    if (!s.job || d.id !== s.job.id || this.state === 'stopped' || this.state === 'done') return;
    s.job = null;
    this.take(d.report);
    this.feed(s);
    this.emit();
    this.check();
  }

  /** 线程出错:这个种子记一份出错的,换一个线程接着推;接连出错就停 */
  private crash(s: Slot, e: unknown): void {
    if (this.state === 'stopped' || this.state === 'done') return;
    const job = s.job;
    s.t.terminate();
    if (job) {
      const msg = (e as { message?: string } | null)?.message || '后台线程出错';
      this.take({ seed: job.seed, ms: 0, viable: false, error: msg, tried: 0, cands: [], best: [-1], alts: [] });
    }
    if (++this.respawned > MAX_RESPAWN) {
      this.fail('后台线程接连出错');
      return;
    }
    const i = this.slots.indexOf(s);
    try {
      const fresh = this.open();
      if (i >= 0) this.slots[i] = fresh;
      this.feed(fresh);
    } catch {
      if (i >= 0) this.slots.splice(i, 1);
    }
    this.emit();
    this.check();
  }

  private take(r: SeedReport): void {
    this.reports.push(r);
    const row = r.cands.length ? bestRow(this.opt.query, r) : null;
    if (row?.verdict.misses === 0) this.full++;
    else if (row?.verdict.misses === 1) this.near++;
    this.opt.onReport?.(r);
  }

  /** 都推完了(或者线程全没了)就收尾 */
  private check(): void {
    if (this.state !== 'running' && this.state !== 'paused') return;
    const busy = this.slots.some((s) => s.job);
    if (!busy && (!this.queue.length || !this.slots.length)) this.end(this.queue.length ? 'stopped' : 'done');
  }

  private fail(msg: string): void {
    this.error = msg;
    this.end('stopped');
  }

  private end(state: FinderState): void {
    if (this.state === 'running') this.active += clock() - this.since;
    this.state = state;
    for (const s of this.slots) s.t.terminate();
    this.slots = [];
    const p = this.progress();
    this.opt.onProgress?.(p);
    this.resolve(p);
  }

  private emit(): void {
    this.opt.onProgress?.(this.progress());
  }
}

/** 页面切到后台(手机锁屏、换标签页)时暂停,回来接着推。返回取消监听 */
export function pauseWhenHidden(s: FinderSearch, doc: Document = document): () => void {
  const on = () => (doc.visibilityState === 'hidden' ? s.pause() : s.resume());
  doc.addEventListener('visibilitychange', on);
  return () => doc.removeEventListener('visibilitychange', on);
}

/**
 * 地球仪 CPU 兼容画法(没有 WebGL2 时)的分段画:几个后台线程(globeCpuWorker.ts)分着画一帧的不同几行,
 * 主线程只发视角、收结果、整张换上 —— 拖动、缩放时主线程不再被逐像素计算一占几百毫秒。
 *
 * - 一帧切成很多段(每段约 BAND_PX 个像素),每个线程手上压几段,画完一段补一段(线程快慢不一也不用等分得多的那个)
 * - 每帧有编号;所有行都回来了才交给 onFrame 整张换上,不会半张新半张旧;比它早的、还没画完的帧直接作废
 * - 最多同时两帧在画(前一帧最后几段还在画时,空下来的线程先画下一帧);再来的请求只留最新的一个
 * - 停下以后画的全分辨率那帧,又动起来时作废(没发出去的段不再发,回来的结果扔掉),先画动着的那帧
 * - 贴图换了(时间轴、回放):线程里留着各版贴图,每帧按它请求时那一版画完,不会半张新半张旧
 * - 线程起不来 / 出错:failed = true,调用方改回主线程上当场画(和以前一样)
 */
import type { CpuSources, GlobeFrame, GlobeLook, GlobeView } from '../render/globe';
import type { GlobeCpuRows, GlobeCpuRowsMsg, GlobeCpuSrcMsg } from '../globeCpuWorker';

/** 一段大约多少像素(电脑上一段十来毫秒) */
const BAND_PX = 128 * 1024;
/**
 * 每个线程手上最多压几段:主线程忙(时间轴放着、重画文明贴图)时回信要等一会儿才处理,
 * 手上多压几段,线程不用干等主线程派下一段;又动起来时最多等这几段画完就换成新的那帧
 */
const IN_FLIGHT = 3;

/** 要画的一帧 */
export interface CpuJobSpec<T> {
  view: GlobeView;
  f: GlobeFrame;
  /** 画布像素 / CSS 像素 */
  dpr: number;
  look: GlobeLook;
  w: number;
  h: number;
  /** 停下以后的全分辨率帧:又动起来时可以作废 */
  idle: boolean;
  /** 调用方自己的东西,画好后原样交回(这帧按什么视角、球心挪了多少……) */
  tag: T;
}

/** 画好的一帧:几段 RGBA(宽 w,从第 y0 行起 rows 行),合起来正好 h 行 */
export interface CpuFrame<T> {
  id: number;
  w: number;
  h: number;
  bands: { y0: number; rows: number; buf: ArrayBuffer }[];
  tag: T;
  /** 从发出请求到画好用了多少毫秒 */
  ms: number;
}

interface Job<T> {
  id: number;
  spec: CpuJobSpec<T>;
  /** 按第几版贴图画 */
  ver: number;
  /** 下一段从第几行起(= h:都发出去了) */
  next: number;
  /** 回来了几行 */
  done: number;
  bands: CpuFrame<T>['bands'];
  t0: number;
}

interface Slot {
  w: Worker;
  /** 手上压着几段没画完 */
  inflight: number;
}

/** 开几个后台线程:留一个核给主线程,最多 3 个(每个线程各存一份贴图,内存小的机器少开) */
export function cpuWorkerCount(): number {
  const nav = typeof navigator === 'undefined' ? null : (navigator as Navigator & { deviceMemory?: number });
  const cores = nav?.hardwareConcurrency || 2;
  let n = Math.max(1, Math.min(3, cores - 1));
  if (nav?.deviceMemory && nav.deviceMemory <= 2) n = Math.min(n, 2);
  return n;
}

export class GlobeCpuPool<T> {
  failed = false;
  private slots: Slot[] = [];
  /** 正在画的帧(先发的在前) */
  private jobs: Job<T>[] = [];
  /** 排着的下一帧(只留最新的)、它按第几版贴图画 */
  private queued: CpuJobSpec<T> | null = null;
  private queuedVer = 0;
  /** 贴图换到第几版了 */
  private ver = 0;
  private nextId = 1;
  /** 还回来的缓冲(大小对得上的下一帧接着用,不用每帧重新分配几 MB):最多留一整帧那么多字节 */
  private spare: ArrayBuffer[] = [];
  private spareBytes = 0;
  private frameBytes = 0;

  constructor(
    n: number,
    private onFrame: (f: CpuFrame<T>) => void,
    private onFail: () => void,
  ) {
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(new URL('../globeCpuWorker.ts', import.meta.url), { type: 'module' });
        const slot: Slot = { w, inflight: 0 };
        w.onmessage = (e: MessageEvent<GlobeCpuRows>) => this.back(slot, e.data);
        w.onerror = (e) => {
          e.preventDefault();
          this.fail();
        };
        w.onmessageerror = () => this.fail();
        this.slots.push(slot);
      }
    } catch {
      this.fail();
    }
  }

  get size(): number {
    return this.slots.length;
  }

  /** 还有没画完、没开始画的帧 */
  get busy(): boolean {
    return this.jobs.length > 0 || this.queued !== null;
  }

  /** 换贴图(只带变了的槽位):之后请求的帧按新的画,已经在画的照旧按原来那版画完 */
  setSources(part: Partial<CpuSources>): void {
    if (this.failed) return;
    this.ver++;
    // 还在画的帧用着的旧版本留着
    const keep = [...new Set(this.jobs.map((j) => j.ver))];
    if (this.queued) keep.push(this.queuedVer);
    const msg: GlobeCpuSrcMsg = { type: 'src', ver: this.ver, keep, ...part };
    try {
      for (const s of this.slots) s.w.postMessage(msg);
    } catch {
      this.fail();
    }
  }

  /** 画一帧(画好了交给 onFrame);前面还有没画完的就排着,只留最新的 */
  request(spec: CpuJobSpec<T>): void {
    if (this.failed) return;
    // 又动起来了:停下以后那张全分辨率的不画了,先画动着的
    if (!spec.idle && this.jobs.some((j) => j.spec.idle)) this.jobs = this.jobs.filter((j) => !j.spec.idle);
    this.queued = spec;
    this.queuedVer = this.ver;
    this.pump();
  }

  /** 换上以后把缓冲还回来(下一帧接着用) */
  recycle(f: CpuFrame<T>): void {
    for (const b of f.bands) this.keep(b.buf);
    f.bands = [];
  }

  dispose(): void {
    for (const s of this.slots) s.w.terminate();
    this.slots = [];
    this.jobs = [];
    this.queued = null;
    this.spare = [];
    this.spareBytes = 0;
  }

  private keep(buf: ArrayBuffer) {
    if (!buf.byteLength) return;
    this.spare.push(buf);
    this.spareBytes += buf.byteLength;
    while (this.spareBytes > this.frameBytes && this.spare.length) this.spareBytes -= this.spare.shift()!.byteLength;
  }

  private take(bytes: number): ArrayBuffer | undefined {
    const i = this.spare.findIndex((b) => b.byteLength === bytes);
    if (i < 0) return undefined;
    this.spareBytes -= bytes;
    return this.spare.splice(i, 1)[0];
  }

  /** 线程手上不满 IN_FLIGHT 段就补:先补正在画的帧;都发完了、正在画的不到两帧,就开始排着的那帧 */
  private pump() {
    for (let round = 0; round < IN_FLIGHT; round++)
      for (const slot of this.slots) {
        if (slot.inflight > round) continue;
        if (!this.dispatch(slot)) return;
      }
  }

  /** 给这个线程发一段;没有要画的 = false */
  private dispatch(slot: Slot): boolean {
    let job = this.jobs.find((j) => j.next < j.spec.h);
    if (!job && this.queued && this.jobs.length < 2) {
      job = { id: this.nextId++, spec: this.queued, ver: this.queuedVer, next: 0, done: 0, bands: [], t0: performance.now() };
      this.frameBytes = Math.max(this.frameBytes, job.spec.w * job.spec.h * 4);
      this.queued = null;
      this.jobs.push(job);
    }
    if (!job) return false;
    const { spec } = job;
    const rows = Math.min(spec.h - job.next, Math.max(1, Math.ceil(BAND_PX / spec.w)));
    const buf = this.take(spec.w * rows * 4);
    const msg: GlobeCpuRowsMsg = { type: 'rows', job: job.id, ver: job.ver, view: spec.view, f: spec.f, dpr: spec.dpr, look: spec.look, w: spec.w, y0: job.next, rows, buf };
    try {
      slot.w.postMessage(msg, buf ? { transfer: [buf] } : undefined);
    } catch {
      this.fail();
      return false;
    }
    slot.inflight++;
    job.next += rows;
    return true;
  }

  private back(slot: Slot, r: GlobeCpuRows) {
    slot.inflight = Math.max(0, slot.inflight - 1);
    const i = this.jobs.findIndex((j) => j.id === r.job);
    if (i < 0) this.keep(r.buf);
    else {
      const job = this.jobs[i];
      job.bands.push({ y0: r.y0, rows: r.rows, buf: r.buf });
      job.done += r.rows;
      if (job.done >= job.spec.h) {
        // 画好了:比它早发的帧(还没画完)作废
        for (const old of this.jobs.splice(0, i + 1)) if (old !== job) for (const b of old.bands) this.keep(b.buf);
        this.onFrame({ id: job.id, w: job.spec.w, h: job.spec.h, bands: job.bands, tag: job.spec.tag, ms: performance.now() - job.t0 });
      }
    }
    if (!this.failed) this.pump();
  }

  private fail() {
    if (this.failed) return;
    this.failed = true;
    this.dispose();
    this.onFail();
  }
}

/**
 * 并排试推那几段历史在后台怎么推(主线程这一头;线程那一头是 src/growThread.ts,挂在照故事找世界的线程上)。
 * 不碰 React、不碰 DOM;线程由 spawn 开(测试换成假的)。
 *
 * - 同一张地图、同一套设定,几段历史各按一套规则推(sides[i] = 第 i 段的规则,不给 = 官方规则)
 * - 开几个线程(threads):1 = 几段在一个线程里轮流推(手机上省内存);和段数一样多 = 一段一个线程,同时推(电脑)。
 *   第 i 段归第 i % threads 个线程
 * - 每段推的时候报推到哪年(progress)、推到交历史的年份交一份整理好的历史(civ;最后一份 done)、推不下去交 failed
 * - 换一段的规则(restart):只有这一段从头推,别的照旧(同一个线程里的接着推,不重来)
 * - 线程坏了(出错、内存不够被关掉):它手上没推完的几段当推不下去,停在最后报过的那一年(failed 的 crashed = true,
 *   civ = null:照用最后交来的那一份)
 * - 一个线程手上的几段都推完了(或者推不下去了)就关掉它,放掉地图和历史;再换规则时另开一个
 * - dispose:全部关掉,之后什么也不交
 */
import type { Civ } from '../../gen/civ/types';
import type { WorldTuning } from '../../gen/civ/tuning';
import type { GrowMap, GrowReply, GrowRequest, GrowSetup } from '../../growThread';

/** 后台线程(浏览器里是 Worker;测试里换成假的) */
export interface GrowThread {
  postMessage(m: GrowRequest): void;
  terminate(): void;
  onmessage: ((e: { data: GrowReply }) => void) | null;
  onerror: ((e: unknown) => void) | null;
}

export function spawnGrowThread(): GrowThread {
  return new Worker(new URL('../../finderWorker.ts', import.meta.url), { type: 'module' }) as unknown as GrowThread;
}

export interface CompareHandlers {
  /** 第 side 段推到第 year 年了(还没交到这一年的历史) */
  progress(side: number, year: number): void;
  /** 第 side 段交来一份推到 civ.endYear 的历史;done = 最后一份 */
  civ(side: number, civ: Civ, done: boolean): void;
  /**
   * 第 side 段推不下去了:at = 那一年;civ = 到停住那年为止的历史(null = 没有新的一份,照用最后交来的那份);
   * crashed = 线程坏了(不是推演里出的错)
   */
  failed(side: number, at: number, civ: Civ | null, crashed: boolean): void;
}

export interface CompareOptions {
  map: GrowMap;
  setup: GrowSetup;
  /** 每段的规则(下标 = 第几段;不给 = 官方规则) */
  sides: readonly (WorldTuning | undefined)[];
  /** 开几个线程(1 到段数) */
  threads: number;
  /** 第几段推到哪年以后故意出错(冒烟检查、截图用;平常不给) */
  failAt?: readonly (number | undefined)[];
  spawn?: () => GrowThread;
  on: CompareHandlers;
}

type Status = 'run' | 'done' | 'failed';

/** 每次开始推一段换一个编号(线程里按它认是不是同一次) */
let keySeq = 0;

export class CompareRun {
  private readonly map: GrowMap;
  private readonly setup: GrowSetup;
  private readonly tunings: (WorldTuning | undefined)[];
  private readonly keys: number[];
  private readonly status: Status[];
  /** 每段最后报过的年份(线程坏了时停在这里) */
  private readonly year: number[];
  private readonly threads: (GrowThread | null)[];
  private readonly spawn: () => GrowThread;
  private readonly on: CompareHandlers;
  private readonly failAt: readonly (number | undefined)[];
  private disposed = false;

  constructor(o: CompareOptions) {
    this.map = o.map;
    this.setup = o.setup;
    this.tunings = [...o.sides];
    this.keys = this.tunings.map(() => ++keySeq);
    this.status = this.tunings.map(() => 'run');
    this.year = this.tunings.map(() => 0);
    this.threads = Array.from({ length: Math.max(1, Math.min(o.threads, this.tunings.length)) }, () => null);
    this.spawn = o.spawn ?? spawnGrowThread;
    this.on = o.on;
    this.failAt = o.failAt ?? [];
    for (let t = 0; t < this.threads.length; t++) this.send(t);
  }

  /** 第 side 段在哪个线程 */
  private slot(side: number): number {
    return side % this.threads.length;
  }

  /** 告诉第 t 个线程它现在要推哪几段(没有要推的就关掉它) */
  private send(t: number) {
    const sides = this.tunings.flatMap((tuning, side) => (this.slot(side) === t && this.status[side] === 'run' ? [{ side, key: this.keys[side], ...(tuning ? { tuning } : {}), ...(this.failAt[side] !== undefined ? { failAt: this.failAt[side] } : {}) }] : []));
    if (!sides.length) {
      this.close(t);
      return;
    }
    let th = this.threads[t];
    if (!th) {
      th = this.spawn();
      this.threads[t] = th;
      const me = th;
      th.onmessage = (e) => {
        if (this.threads[t] === me) this.receive(e.data);
      };
      th.onerror = () => {
        if (this.threads[t] === me) this.crashed(t);
      };
    }
    th.postMessage({ grow: 'start', map: this.map, setup: this.setup, sides });
  }

  private close(t: number) {
    const th = this.threads[t];
    if (!th) return;
    this.threads[t] = null;
    th.onmessage = null;
    th.onerror = null;
    th.terminate();
  }

  private receive(m: GrowReply) {
    if (this.disposed) return;
    const s = m.side;
    if (this.keys[s] !== m.key || this.status[s] !== 'run') return;
    if (m.grow === 'progress') {
      this.year[s] = Math.max(this.year[s], m.year);
      this.on.progress(s, m.year);
      return;
    }
    if (m.grow === 'civ') {
      this.year[s] = Math.max(this.year[s], m.civ.endYear);
      if (m.done) this.status[s] = 'done';
      this.on.civ(s, m.civ, m.done);
    } else {
      this.status[s] = 'failed';
      this.on.failed(s, m.at, m.civ, false);
    }
    if (this.status[s] !== 'run') this.idle(this.slot(s));
  }

  /** 第 t 个线程手上没有要推的了:关掉 */
  private idle(t: number) {
    if (this.tunings.every((_, side) => this.slot(side) !== t || this.status[side] !== 'run')) this.close(t);
  }

  private crashed(t: number) {
    this.close(t);
    if (this.disposed) return;
    this.tunings.forEach((_, side) => {
      if (this.slot(side) !== t || this.status[side] !== 'run') return;
      this.status[side] = 'failed';
      this.on.failed(side, this.year[side], null, true);
    });
  }

  /** 换第 side 段的规则,这一段从头推(别的段照旧) */
  restart(side: number, tuning: WorldTuning | undefined): void {
    if (this.disposed || side < 0 || side >= this.tunings.length) return;
    this.tunings[side] = tuning;
    this.keys[side] = ++keySeq;
    this.status[side] = 'run';
    this.year[side] = 0;
    this.send(this.slot(side));
  }

  /** 全部关掉,之后什么也不交 */
  dispose(): void {
    this.disposed = true;
    for (let t = 0; t < this.threads.length; t++) this.close(t);
  }
}

/**
 * 细节层分帧备料(地形细节层 TerrainDetail.tsx、文明细节层 CivDetail.tsx 共用):
 * 放大、拖动、停下来补画时,要重画的那一层不在当下一口气画完 —— 备料(整张图的缓存、这一块逐格上色……)
 * 切成一小步一小步,每做 SLICE 毫秒左右就把主线程让出来(浏览器照常响应拖动、画下一帧);
 * 备料的最后一步把这一层先画到藏着的那张画布上(DetailBuffer);都备好了,在同一个任务里几层一起和显示着的那张对调(整张换上),
 * 换上那一下不用再画。备料期间屏幕上还是原来那张(挪到新位置、按比例放大),或者底下的整张图(第一次放大时)。
 *
 * 每一层同一时间最多一份活,新的顶掉旧的;几层的活都备好了才一起画 —— 地形和文明的细节层同时换上,
 * 手绘风文明色块给符号"让位"的遮罩和地形的符号对得上。
 *
 * 开关:地址里带 detail=sync 就不分帧(和以前一样,当下画完);默认分帧
 */
import type { WorkStep } from '../render/common';

export type { WorkStep };

/** 分帧开着没有(页面打开时读一次地址) */
export const detailAsync: boolean = (() => {
  try {
    return new URLSearchParams(location.search).get('detail') !== 'sync';
  } catch {
    return true;
  }
})();

/** 一段做多少毫秒就让出主线程(一帧 16.7 毫秒,留一半给浏览器画画面、处理输入) */
const SLICE = 8;

/** 这份活备了多久、分了几段做(调试字段用) */
export interface JobStats {
  prep: number;
  slices: number;
}

interface Job {
  steps: WorkStep[];
  i: number;
  commit: (st: JobStats) => void;
  stats: JobStats;
  /** 自己备好就交(不等别的层,见 submitDetailJob) */
  alone: boolean;
}

const jobs = new Map<string, Job>();
let posted = false;

/** 让出主线程,等下一个任务再接着做(MessageChannel:不像 setTimeout 那样连着几次以后最少隔 4 毫秒) */
const post: (f: () => void) => void = (() => {
  if (typeof MessageChannel === 'undefined') return (f) => void setTimeout(f, 0);
  const ch = new MessageChannel();
  let cb: (() => void) | null = null;
  ch.port1.onmessage = () => {
    const f = cb;
    cb = null;
    f?.();
  };
  // Node(单测)里不让这个端口拖住进程
  (ch.port1 as unknown as { unref?: () => void }).unref?.();
  return (f) => {
    cb = f;
    ch.port2.postMessage(null);
  };
})();

function kick() {
  if (posted) return;
  posted = true;
  post(run);
}

/**
 * 交一份活:owner 是哪一层(同一层的旧活作废);steps 依次做,做完一步才做下一步;
 * 所有在等的活都备好了,依次调各自的 commit(在同一个任务里)。
 * alone = 和细节层换上的时机无关的活(换上新的历史时文明层的备料):和别的活一起分段做,自己备好就交,不等别的层
 * (拖动、飞过去的时候细节层的活一直在换新的,一起等就要等到停下来)
 */
export function submitDetailJob(owner: string, steps: WorkStep[], commit: (st: JobStats) => void, o: { alone?: boolean } = {}): void {
  jobs.set(owner, { steps, i: 0, commit, stats: { prep: 0, slices: 0 }, alone: !!o.alone });
  kick();
}

/** 地图框 CSS 坐标里的一块(缩放前) */
interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * 拖动中要不要提前备下一块、往哪边挪:看得见的那一块(vis,四周各留 margin)离画好的那一块(d)哪条边不到半个余量,
 * 就往那边挪半个余量(返回 [dx, dy],加到新一块的位置上;离边都还远 = null,不用备)。
 * 新的一块往拖的方向多留、背后少留,一直往一个方向拖时还是隔一整个余量才画一次,不会因为提前备而多画。
 * xMax、yMax = 一块最多伸到哪儿(地图边)
 */
export function aheadOf(d: Box, vis: Box, margin: number, xMax: number, yMax: number): [number, number] | null {
  const mw = ((vis.x1 - vis.x0) * margin) / 2;
  const mh = ((vis.y1 - vis.y0) * margin) / 2;
  const l = d.x0 > Math.max(0, vis.x0 - mw) + 0.5;
  const r = d.x1 < Math.min(xMax, vis.x1 + mw) - 0.5;
  const t = d.y0 > Math.max(0, vis.y0 - mh) + 0.5;
  const b = d.y1 < Math.min(yMax, vis.y1 + mh) - 0.5;
  if (!l && !r && !t && !b) return null;
  return [(r ? mw : 0) - (l ? mw : 0), (b ? mh : 0) - (t ? mh : 0)];
}

/** 这一层的活不要了(没备好的不画) */
export function cancelDetailJob(owner: string): void {
  jobs.delete(owner);
}

/** 这一层有没有活在等 */
export function detailJobPending(owner: string): boolean {
  return jobs.has(owner);
}

/** 剩下的备料当下做完,马上画(等不及了:比如拖出了画好的那一块) */
export function flushDetailJobs(): void {
  step(Infinity);
}

function run() {
  posted = false;
  step(performance.now() + SLICE);
}

/** 做到 deadline;都备好了就一起画,没备好就等下一段 */
function step(deadline: number) {
  try {
    for (const job of jobs.values()) {
      if (job.i >= job.steps.length) continue;
      const t0 = performance.now();
      job.stats.slices++;
      while (job.i < job.steps.length) {
        if (job.steps[job.i](deadline) !== true) job.i++;
        if (performance.now() >= deadline) break;
      }
      job.stats.prep += performance.now() - t0;
      if (performance.now() >= deadline) break;
    }
  } catch (e) {
    // 备料出错:这一批都不画了(各层下次重画时重新交活),错误照常报出去
    jobs.clear();
    throw e;
  }
  // 自己备好就交的
  for (const [owner, job] of [...jobs]) {
    if (!job.alone || job.i < job.steps.length) continue;
    jobs.delete(owner);
    job.commit(job.stats);
  }
  for (const job of jobs.values()) {
    if (job.i < job.steps.length) {
      kick();
      return;
    }
  }
  const all = [...jobs.values()];
  jobs.clear();
  for (const job of all) job.commit(job.stats);
}

/**
 * 一层细节层的两张画布:显示着的那张(front)和藏着的那张(备料的最后一步画在藏着的那张上,画的活也分在备料里,
 * 不挤在换上那一刻)。换上 = 两张对调显示(swap),不用再画、也不用贴图。两张是同一种画布、同样大小,
 * 画在藏着的那张上和直接画在显示的那张上逐像素一样。
 * 藏着的那张紧挨着显示的那张(上下层次不变);类名跟着对调,显示着的那张总是原来的类名(藏着的加 "-back")。
 * 换下来的那张先留着内存,接着拖动、点选时下一次直接画在上面(重新开一张大画布要几十到上百毫秒);
 * 闲了一会儿(IDLE_MS)没再用才还回去,平时只多占一张画布的内存,和备料时一样。
 * 原来那张(React 建的)之外的另一张由这里建、这里删(dispose)
 */
const IDLE_MS = 2000;

export class DetailBuffer {
  front: HTMLCanvasElement;
  private spare: HTMLCanvasElement | null = null;
  private readonly own: HTMLCanvasElement;
  private idle = 0;
  constructor(front: HTMLCanvasElement) {
    this.front = this.own = front;
  }

  /** 藏着的那张调成 w × h、清空,返回画笔(画不出来,比如手机上画布内存超了 = null) */
  back(w: number, h: number): CanvasRenderingContext2D | null {
    window.clearTimeout(this.idle);
    let b = this.spare;
    if (!b) {
      b = document.createElement('canvas');
      b.className = `${this.front.className}-back`;
      b.style.pointerEvents = 'none';
      b.style.display = 'none';
      this.front.after(b);
      this.spare = b;
    }
    if (b.width !== w || b.height !== h) {
      b.width = w;
      b.height = h;
    }
    const ctx = b.getContext('2d');
    if (!ctx) {
      this.drop();
      return null;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  /** 藏着的那张换上来(显示交给调用的人摆);原来显示的那张藏起来,闲一会儿再还显存 */
  swap(): void {
    const b = this.spare;
    if (!b) return;
    const f = this.front;
    [f.className, b.className] = [b.className, f.className];
    f.style.display = 'none';
    this.front = b;
    this.spare = f;
    this.rest();
  }

  /** 这回备的不用了:藏着的那张闲一会儿再还显存(马上又要备就接着用) */
  rest(): void {
    window.clearTimeout(this.idle);
    this.idle = window.setTimeout(() => this.drop(), IDLE_MS);
  }

  /** 藏着的那张不要了:马上还回显存 */
  drop(): void {
    window.clearTimeout(this.idle);
    if (this.spare?.width) this.spare.width = this.spare.height = 0;
  }

  /** 卸下时:这里建的那张从页面上拿掉 */
  dispose(): void {
    window.clearTimeout(this.idle);
    for (const c of [this.front, this.spare]) if (c && c !== this.own) c.remove();
  }
}

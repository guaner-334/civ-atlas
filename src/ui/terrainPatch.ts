/**
 * 编辑地形后,主线程这边按块换上新地图(worker.ts 的 PatchInput):线程只交回主图变了的那一块(gen/rasterPatch.ts 的 exactPatch),
 * 这里贴到地图上那张整图的复制品上(原来那张不动),现在这种底图(写实、手绘)的像素层只重画受影响的那块、符号层重画,
 * 弯边投影把按投影重画的整张图也画好 —— 都分小步在后台做(同 ui/detailJobs.ts 的分帧),每步几毫秒到几十毫秒;地图上先留着原来那张,
 * 备好了一次换上(done)。和整张交回来、整张重画逐像素相同;按块做不了的(缓存里没有原来那张的像素层、数据底图……)
 * 换上以后照旧整张画。
 */
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import { composeRaster, type RasterPatch } from '../gen/rasterPatch';
import type { PixelBox } from '../gen/pixelBox';
import { realisticPatchSteps } from '../render/realistic';
import { fantasyPatchSteps } from '../render/fantasy';
import { pageColor, type MapProj } from '../render/projection';
import { terrainProjWholeSteps } from '../render/detail';
import type { SurfaceLook } from '../render/surface';
import { detailAsync, type WorkStep } from './detailJobs';

/** 地图现在怎么画:画风('realistic' / 'fantasy' / 数据底图)、写实的画法、弯边投影(等距圆柱 = null) */
export interface PatchView {
  style: string;
  look: SurfaceLook;
  mp: MapProj | null;
}

/**
 * 弯边投影下按投影重画好的整张地形图(和 presentTerrain 按投影重画的那一版逐像素一样):
 * 地图换上时投影、中心还是 key 那一版就直接贴上,不用当下再画
 */
export interface PreProjected {
  raster: Raster;
  key: string;
  /** 按哪种画风、写实的哪种画法画的(换上时地图已经换了画风 / 画法就不能用) */
  style: 'realistic' | 'fantasy';
  look: SurfaceLook;
  canvas: HTMLCanvasElement;
}

/** 备料用了多久(调试字段用):prep = 后台各步加起来的毫秒,wall = 从开始到换上 */
export interface PatchStats {
  prep: number;
  wall: number;
  /** 重画的是哪种像素层(没有按块重画 = 'none') */
  kind: 'realistic' | 'fantasy' | 'none';
  /** 最长的一步(毫秒):主线程一口气被占住最久的那一下 */
  maxStep: number;
}

/** 一组要等前面做完才排得出来的步骤:第一次调的时候才排,之后每调一次做一步(还有没做完的返回 true) */
function later(make: () => WorkStep[] | null): WorkStep {
  let list: WorkStep[] | null = null;
  let i = 0;
  return (deadline) => {
    list ??= make() ?? [];
    if (i < list.length && list[i](deadline) !== true) i++;
    return i < list.length;
  };
}

/**
 * 开始按块换上:w0、r0 = 地图上现在那张(整图,地形大事以前的),w1 = 新世界,patch = 主图变了的那块(null = 一个像素也没变)。
 * 备好了调 done(新的整张主图);又来了新的一次(或 cancelTerrainPatch)时这次作废,done 不调
 */
export function startTerrainPatch(o: { w0: World; r0: Raster; w1: World; patch: RasterPatch | null; view: PatchView }, done: (r1: Raster, st: PatchStats, pre: PreProjected | null) => void): void {
  const { w0, r0, w1, patch, view } = o;
  const t0 = performance.now();
  let r1: Raster | null = null;
  let kind: PatchStats['kind'] = 'none';
  const box: PixelBox | null = patch && patch.w > 0 ? { x0: patch.x0, y0: patch.y0, w: patch.w, h: patch.h } : null;
  let failed = false;
  const steps: WorkStep[] = [
    // 贴补丁:原来那张复制一份再贴(各段地形大事的主图、缓存都还认着原来那张)
    () => void (r1 = patch ? composeRaster(r0, [patch]) : { ...r0 }),
    later(() => {
      if (view.style === 'realistic') {
        const s = realisticPatchSteps(r1!, r0, view.look, box);
        if (s) kind = 'realistic';
        return s;
      }
      if (view.style === 'fantasy') {
        const s = fantasyPatchSteps(w1, r1!, w0, r0, box);
        if (s) kind = 'fantasy';
        return s;
      }
      return null;
    }),
    // 弯边投影:像素层按块重画好了,就把按投影重画的整张图也在后台画好(同 presentTerrain 停着时的那一版),换上时直接贴
    later(() => {
      const mp = view.mp;
      if (!mp || kind === 'none') return null;
      const W = r1!.w;
      const H = r1!.h;
      const cv = document.createElement('canvas');
      let ctx: CanvasRenderingContext2D | null = null;
      const get = () => {
        if (ctx) return ctx;
        cv.width = W;
        cv.height = H;
        ctx = cv.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = pageColor(kind);
        ctx.fillRect(0, 0, W, H);
        return ctx;
      };
      return [...terrainProjWholeSteps(get, w1, r1!, kind, mp, view.look), () => void (ctx && (pre = { raster: r1!, key: mp.key, style: kind as PreProjected['style'], look: view.look, canvas: cv }))];
    }),
  ];
  let pre: PreProjected | null = null;
  // 哪一步出了错:剩下的不做了,照样换上(到时候按原来的办法整张画)
  let maxStep = 0;
  const guarded = steps.map<WorkStep>((s) => (deadline) => {
    if (failed) return;
    const t = performance.now();
    try {
      return s(deadline);
    } catch (e) {
      failed = true;
      console.error('按块重画地图出错,改成整张画', e);
    } finally {
      maxStep = Math.max(maxStep, performance.now() - t);
    }
  });
  const commit = (prep: number) => {
    if (!r1) r1 = patch ? composeRaster(r0, [patch]) : { ...r0 };
    links.set(r1, { w0, r0: new WeakRef(r0), box });
    done(r1, { prep, wall: performance.now() - t0, kind: failed ? 'none' : kind, maxStep }, failed ? null : pre);
  };
  if (!detailAsync) {
    for (const s of guarded) while (s(Infinity) === true);
    commit(performance.now() - t0);
    return;
  }
  const job = (current = { steps: guarded, i: 0, prep: 0, commit });
  post(() => run(job));
}

/**
 * 按块换上的主图是从哪一张、改了哪一块来的(键 = 换上的那张主图):别的画风(图层缩略图)也能照原来那张只重画变了的那块。
 * 原来那张只弱引用(各画风的缓存还留着它时才用得上;不然整张画),不让一笔一笔的主图连成串留在内存里
 */
const links = new WeakMap<Raster, { w0: World; r0: WeakRef<Raster>; box: PixelBox | null }>();

/** r 是按块换上的:原来那张世界、主图(还在内存里的话)和变了的那块;不是 = null */
export function patchSourceOf(r: Raster): { w0: World; r0: Raster; box: PixelBox | null } | null {
  const l = links.get(r);
  const r0 = l?.r0.deref();
  return l && r0 ? { w0: l.w0, r0, box: l.box } : null;
}

/** 一段做多少毫秒就让出主线程(同 ui/detailJobs.ts:一帧的一半) */
const SLICE = 8;

interface Job {
  steps: WorkStep[];
  i: number;
  prep: number;
  commit: (prep: number) => void;
}
/** 正在备的那一次(新的一次顶掉旧的) */
let current: Job | null = null;

/**
 * 自己排着做,不和细节层的活(ui/detailJobs.ts)一起等:那边的几层要一起换上,这边备好了就换,
 * 不用等别的层(弯边投影下文明层按投影重画的活可能很长)
 */
function run(job: Job): void {
  if (current !== job) return;
  const t = performance.now();
  const deadline = t + SLICE;
  while (job.i < job.steps.length) {
    if (job.steps[job.i](deadline) !== true) job.i++;
    if (performance.now() >= deadline) break;
  }
  job.prep += performance.now() - t;
  if (job.i < job.steps.length) return post(() => run(job));
  current = null;
  job.commit(job.prep);
}

/** 让出主线程,下一个任务接着做(MessageChannel:不像 setTimeout 那样连着几次以后最少隔 4 毫秒) */
const post: (f: () => void) => void = (() => {
  if (typeof MessageChannel === 'undefined') return (f) => void setTimeout(f, 0);
  const ch = new MessageChannel();
  const queue: (() => void)[] = [];
  ch.port1.onmessage = () => queue.shift()?.();
  (ch.port1 as unknown as { unref?: () => void }).unref?.();
  return (f) => {
    queue.push(f);
    ch.port2.postMessage(null);
  };
})();

/** 正在备的那一次不要了(整张交回来的、换了世界) */
export function cancelTerrainPatch(): void {
  current = null;
}

/** 有没有一次正在备着(别的不急的重活先等它换上) */
export function terrainPatchPending(): boolean {
  return current !== null;
}

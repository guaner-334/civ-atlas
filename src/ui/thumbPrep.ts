/**
 * 缩略图要的整张底图,先在后台分小步备好(画进各画风自己的缓存):之后 App 的 baseCanvas 当场取整张时只是贴一下,
 * 不在主线程上一口气画一两百毫秒到半秒多。涂一笔地形以后,右边的样式缩略图要把好几张底图都重画一遍,
 * 存档的缩略图、地图缩略图也各要一张(手绘、经典卫星)。
 *   写实、手绘   编辑地形按块换上的那一张、原来那张的像素层还在缓存里:只重画变了的那块(和地图本身按块重画同一套,
 *               见 ui/terrainPatch.ts);不然整张分步画。都和一口气整张画逐像素相同
 *   数据图层     整张分步画(render/layers.ts 的 prepareLayer),画完下一次 renderLayer 直接贴上
 * 纯粹是把活拆小:缩略图看起来和原来一样。所有要备的排成一队,一张一张做,每段十毫秒左右就让出主线程。
 */
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import type { WorkStep } from '../render/common';
import { realisticFullSteps, realisticPatchSteps } from '../render/realistic';
import { fantasyBaseCached, fantasyFullSteps, fantasyPatchSteps } from '../render/fantasy';
import { dropPreparedLayer, hasPreparedLayer, prepareLayer, type LayerId } from '../render/layers';
import type { SurfaceLook } from '../render/surface';
import { patchSourceOf } from './terrainPatch';

/**
 * 画风键(App 的底图缓存同一套:fantasy / realistic / realistic:画法 / data:图层)那张整张图要先做的几步;不用做 = []。
 * 真正的几步等轮到它、开始做的那一刻才排(按块重画要先复制原来那张,排着等的时候原来那张可能已经被挤出缓存)
 */
export function thumbPrepSteps(key: string, world: World, raster: Raster): WorkStep[] {
  if (raster.win) return [];
  if (key === 'fantasy') {
    if (!fantasyFullSteps(world, raster)) return [];
    return [
      later(() => {
        // 像素层在了就只差符号层(或者都在了)
        if (fantasyBaseCached(raster)) return fantasyFullSteps(world, raster);
        const src = patchSourceOf(raster);
        return (src && fantasyPatchSteps(world, raster, src.w0, src.r0, src.box)) ?? fantasyFullSteps(world, raster);
      }),
    ];
  }
  if (key === 'realistic' || key.startsWith('realistic:')) {
    const look = (key === 'realistic' ? 'classic' : key.slice(10)) as SurfaceLook;
    if (!realisticFullSteps(raster, look)) return [];
    return [
      later(() => {
        const src = patchSourceOf(raster);
        return (src && realisticPatchSteps(raster, src.r0, look, src.box)) ?? realisticFullSteps(raster, look);
      }),
    ];
  }
  if (key.startsWith('data:')) {
    const layer = key.slice(5) as LayerId;
    if (typeof document === 'undefined' || hasPreparedLayer(raster, layer)) return [];
    return [later(() => prepareLayer(Object.assign(document.createElement('canvas'), { width: raster.w, height: raster.h }), world, raster, layer))];
  }
  return [];
}

/** 一组到第一次调的时候才排的步骤(排的那一下接着做第一步):之后每调一次做一步,还有没做完的返回 true */
function later(make: () => WorkStep[] | null): WorkStep {
  let list: WorkStep[] | null = null;
  let i = 0;
  return (deadline) => {
    list ??= make() ?? [];
    if (i < list.length && list[i](deadline) !== true) i++;
    return i < list.length;
  };
}

interface Job {
  key: string;
  raster: Raster;
  steps: WorkStep[];
  i: number;
  /** 还要不要(都不要了就不做了;没给的 = 一直要,直到同一种底图换了一张要备的) */
  alive: (() => boolean)[];
  done: (() => void)[];
}
let queue: Job[] = [];
/** 已经排了下一段 */
let posted = false;
/** 备的时候出过错的(这一张就照原来的办法当场整张画) */
const failed = new WeakMap<Raster, Set<string>>();

/** 一段做多少毫秒就让出主线程(一帧的一部分:拖地图、点按钮照样跟手) */
const SLICE = 12;

/**
 * 画风键 key、这张主图的整张底图能不能当场取(缓存里已经有了、备好了,或者备的时候出了错只能当场画):能 = true;
 * 不能就排进后台去备(同一张排着的不再排),备好了调 done,返回 false。alive:还要不要(不要了就不做了,done 也不调)
 */
export function baseReady(key: string, world: World, raster: Raster, o: { done?: () => void; alive?: () => boolean } = {}): boolean {
  if (failed.get(raster)?.has(key)) return true;
  let job = queue.find((j) => j.key === key && j.raster === raster);
  if (!job) {
    const steps = thumbPrepSteps(key, world, raster);
    if (!steps.length) return true;
    // 同一种底图换了一张要备的(又涂了一笔):前一张没人等着要的就不做了
    queue = queue.filter((j) => j.key !== key || j.alive.some((f) => f()));
    job = { key, raster, steps, i: 0, alive: [], done: [] };
    queue.push(job);
  }
  if (o.alive) job.alive.push(o.alive);
  if (o.done) job.done.push(o.done);
  schedule();
  return false;
}

/** 备好的整张数据图层没被用上(缓存里本来就有这一张)就丢掉,不占着显存 */
export function dropThumbPrep(): void {
  dropPreparedLayer();
}

/** 有没有排着要备的(检查脚本、调试用) */
export function thumbPrepPending(): boolean {
  return queue.length > 0;
}

function schedule(): void {
  if (!posted && queue.length) {
    posted = true;
    post(run);
  }
}

/** 让出主线程,下一个任务接着做(MessageChannel:不像 setTimeout 那样连着几次以后最少隔 4 毫秒;同 ui/terrainPatch.ts) */
const post: (f: () => void) => void = (() => {
  if (typeof MessageChannel === 'undefined') return (f) => void setTimeout(f, 0);
  const ch = new MessageChannel();
  let next: (() => void) | null = null;
  ch.port1.onmessage = () => {
    const f = next;
    next = null;
    f?.();
  };
  (ch.port1 as unknown as { unref?: () => void }).unref?.();
  return (f) => {
    next = f;
    ch.port2.postMessage(null);
  };
})();

function run(): void {
  posted = false;
  const deadline = performance.now() + SLICE;
  while (queue.length && performance.now() < deadline) {
    const job = queue[0];
    // 等着要的都不要了(换了世界):不做了
    if (job.alive.length && !job.alive.some((f) => f())) {
      queue.shift();
      continue;
    }
    try {
      if (job.steps[job.i](deadline) !== true) job.i++;
    } catch (e) {
      console.error('缩略图的底图没备好,改成当场整张画', e);
      let s = failed.get(job.raster);
      if (!s) failed.set(job.raster, (s = new Set()));
      s.add(job.key);
      job.i = job.steps.length;
    }
    if (job.i < job.steps.length) continue;
    queue.shift();
    for (const f of job.done) f();
  }
  schedule();
}

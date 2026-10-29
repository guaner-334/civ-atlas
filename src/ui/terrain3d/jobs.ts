/**
 * 立体地形的后台线程池(terrain3dWorker.ts):点「立体」开始框的时候就开好、把世界送过去准备(框的工夫里准备完),
 * 立起来时把方框按行切成几条,一个线程一条(地区图那么大的块切得更碎,几个线程轮流算),各算各的,全回来了拼成一整块。
 * 离开地区模式就全部关掉(放掉内存)。同一条总是交给同一个线程(它留着铺好的像素,只换画风时不用重铺)。
 * 手绘多一步:几条铺好的像素拼成一整块,交给第一个线程整块画(纸纹、林块、波纹不在接缝处断开)。
 */
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { ReliefRequest, ReliefResponse } from '../../terrain3dWorker';
import type { WholeRaster } from '../../tileWorker';
import type { ReliefLook } from '../../render/terrain3d/relief';
import { boxKm, boxPixels, kmPerUnitX, type ReliefBox } from '../../render/terrain3d/box';
import type { BoxFields, BoxStyle } from '../../render/terrain3d/fantasyBox';
import { WINDOW_PAD } from '../../gen/rasterWindow';

/** 一条最多约多少像素(再大就多切几条,几个线程轮流算) */
const STRIP_PX = 400_000;

/** 拼好的一整块 */
export interface ReliefImage {
  S: number;
  w: number;
  h: number;
  /** 上好色的几条(按 y 拼) */
  parts: { y: number; img: ImageBitmap }[];
  /** 每像素海拔、地平线坡度(只换画风时没有) */
  elev?: Float32Array;
  horizon?: Float32Array;
  /** 从发出去到全回来多少毫秒 */
  ms: number;
}

interface Slot {
  w: Worker;
}

let slots: Slot[] | null = null;
let wid = 0;
let curWorld: World | null = null;
let curRaster: Raster | null = null;
let jobSeq = 0;
/** 正在等的那一批(job → 收齐了调一次) */
const waiting = new Map<number, { got: ReliefResponse[]; n: number; done: (r: ReliefResponse[] | null) => void; part?: (n: number, of: number) => void }>();

/** 开几个线程:电脑上最多 5 个(核多的机器上细的一档 1 秒上下);手机 2 个(每个线程要拷一份世界,内存吃紧) */
function poolSize(phone: boolean): number {
  const hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  return phone ? Math.min(2, Math.max(1, hc - 1)) : Math.min(5, Math.max(2, hc - 2));
}

/** 开好线程、把这个世界送过去(同一个世界不重复送) */
export function reliefPrepare(world: World, raster: Raster, phone: boolean): boolean {
  if (typeof Worker === 'undefined') return false;
  if (!slots) {
    try {
      slots = Array.from({ length: poolSize(phone) }, () => {
        const w = new Worker(new URL('../../terrain3dWorker.ts', import.meta.url), { type: 'module' });
        w.onmessage = (e: MessageEvent<ReliefResponse>) => got(e.data);
        // 线程没加载上、出了没接住的错:整组关掉(等着的作废);下次要算时重新开
        w.onerror = () => reliefRelease();
        return { w };
      });
    } catch {
      slots = null;
      return false;
    }
    curWorld = null;
  }
  if (world === curWorld && raster === curRaster) return true;
  curWorld = world;
  curRaster = raster;
  wid++;
  failAll();
  // 回放用的历史快照用不着,不拷过去;细沟的线随主图带过去
  const lite = { ...world, history: [] } as World;
  const whole: WholeRaster = { w: raster.w, h: raster.h, scale: raster.scale, elev: raster.elev, water: raster.water, ice: raster.ice, iceConc: raster.iceConc, iceTone: raster.iceTone, bank: raster.bank, veinLines: raster.veinLines };
  for (const s of slots) {
    const m: ReliefRequest = { type: 'world', wid, world: lite, whole };
    s.w.postMessage(m);
  }
  return true;
}

/** 关掉所有线程(关掉立体时) */
export function reliefRelease(): void {
  failAll();
  for (const s of slots ?? []) s.w.terminate();
  slots = null;
  curWorld = null;
  curRaster = null;
}

/** 线程数(冒烟检查、测速用) */
export function reliefWorkers(): number {
  return slots?.length ?? 0;
}

/**
 * 算方框里的一整块(S 倍像素、这种画法)。heights = 要不要海拔和地平线('elev' = 只要海拔);style = 手绘的一格多大(fantasyBox.ts 的 boxStyle)。
 * 出错(线程没起来、不能画图、中途换了世界)= null。part:每回来一条调一次(回来了几条、一共几步;手绘最后整块画算一步)
 */
export function reliefImage(box: ReliefBox, S: number, look: ReliefLook, heights: boolean | 'elev', H: number, style: BoxStyle, part?: (n: number, of: number) => void): Promise<ReliefImage | null> {
  const pool = slots;
  if (!pool) return Promise.resolve(null);
  const t0 = performance.now();
  const px = boxPixels(box, S);
  // 一个线程一条;大块(地区图)切得更碎,几个线程轮流算,进度一格一格往上走
  const n = Math.min(px.h, Math.max(pool.length, Math.min(pool.length * 4, Math.ceil((px.w * px.h) / STRIP_PX))));
  const job = ++jobSeq;
  const kmPerPx = kmPerUnitX(box.cy, H) / S;
  // 往西最远看方框短边的 35%(倍数拉到 30 倍时最高的山的影子也就这么长)
  const km = boxKm(box, H);
  const maxPx = Math.max(4, Math.round((0.35 * Math.min(km.w, km.h)) / kmPerPx));
  const k = S * 1.46;
  const fantasy = look === 'fantasy';
  return new Promise((resolve) => {
    waiting.set(job, {
      got: [],
      n,
      part: part && fantasy ? (a, of) => part(a, of + 1) : part,
      done: (list) => {
        if (!list) return resolve(null);
        list.sort((a, b) => a.y - b.y);
        const finish = (parts: { y: number; img: ImageBitmap }[]) => {
          const img: ReliefImage = { S, w: px.w, h: px.h, parts, ms: performance.now() - t0 };
          if (heights) {
            img.elev = new Float32Array(px.w * px.h);
            for (const r of list) img.elev.set(r.elev!, r.y * px.w);
          }
          if (heights === true) {
            img.horizon = new Float32Array(px.w * px.h);
            for (const r of list) img.horizon.set(r.horizon!, r.y * px.w);
          }
          resolve(img);
        };
        if (!fantasy) return finish(list.map((r) => ({ y: r.y, img: r.bitmap! })));
        // 手绘:拼成一整块,交给第一个线程整块画
        if (slots !== pool) return resolve(null);
        const f = joinStrips(list, px.w, px.h);
        const job2 = ++jobSeq;
        waiting.set(job2, { got: [], n: 1, done: (one) => (one ? finish([{ y: 0, img: one[0].bitmap! }]) : resolve(null)) });
        const m: ReliefRequest = { type: 'fantasy', wid, job: job2, S, x0: px.x0, y0: px.y0, w: px.w, h: px.h, pad: WINDOW_PAD, u: style.unit * S, ax: style.ax, f };
        pool[0].w.postMessage(m, [f.elev.buffer, f.temp.buffer, f.water.buffer, f.biome.buffer]);
      },
    });
    for (let i = 0; i < n; i++) {
      const y = Math.round((i * px.h) / n);
      const h = Math.round(((i + 1) * px.h) / n) - y;
      const m: ReliefRequest = { type: 'strip', wid, job, y, S, x0: px.x0, y0: px.y0 + y, w: px.w, h, k, look, heights, kmPerPx, maxPx };
      pool[i % pool.length].w.postMessage(m);
    }
  });
}

/** 手绘的几条(各自连多铺的一圈)拼成方框那一整块(w × h)四周多铺 WINDOW_PAD 像素的一块:接缝处取各条自己的行 */
function joinStrips(list: ReliefResponse[], w: number, h: number): BoxFields {
  const P = WINDOW_PAD;
  const n = w + 2 * P;
  const hh = h + 2 * P;
  const f: BoxFields = { w: n, h: hh, elev: new Float32Array(n * hh), temp: new Float32Array(n * hh), water: new Uint8Array(n * hh), biome: new Uint8Array(n * hh) };
  list.forEach((r, i) => {
    const raw = r.raw!;
    // 这一条多铺的第 t 行 = 拼好的第 r.y + t 行;上下多铺的那圈只取最上、最下那一条的
    const a = i === 0 ? 0 : P;
    const b = i === list.length - 1 ? raw.h : raw.h - P;
    const at = (r.y + a) * n;
    f.elev.set(raw.elev.subarray(a * n, b * n), at);
    f.temp.set(raw.temp.subarray(a * n, b * n), at);
    f.water.set(raw.water.subarray(a * n, b * n), at);
    f.biome.set(raw.biome.subarray(a * n, b * n), at);
  });
  return f;
}

function got(r: ReliefResponse) {
  const w = waiting.get(r.job);
  if (!w) return r.bitmap?.close();
  if (r.wid !== wid || (!r.bitmap && !r.raw)) {
    waiting.delete(r.job);
    for (const g of w.got) g.bitmap?.close();
    r.bitmap?.close();
    return w.done(null);
  }
  w.got.push(r);
  w.part?.(w.got.length, w.n);
  if (w.got.length === w.n) {
    waiting.delete(r.job);
    w.done(w.got);
  }
}

/** 正在等的全部作废(换了世界、线程出错、关掉) */
function failAll() {
  const list = [...waiting.values()];
  waiting.clear();
  for (const w of list) {
    for (const g of w.got) g.bitmap?.close();
    w.done(null);
  }
}

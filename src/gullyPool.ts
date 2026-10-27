/// <reference lib="webworker" />
/**
 * 整张主图山坡上的沟和山脊(gen/gully.ts 的 gullyHeights)分给几个帮手线程(gullyWorker.ts)同时算,
 * 细沟(gen/pixelDrain.ts 的 veinsOf)整件交给第一个帮手:
 * 生成世界、导出大图、地球仪贴图的后台线程里用(核多的电脑最多 3 个帮手)。
 * 线程里再开的线程,加载脚本、收消息都要本线程空下来才走得动:开始重活之前先等它们说"好了"(最多等 HELPER_WAIT 毫秒),
 * 发完活先让一下;不然本线程一口气算几秒,帮手要等本线程算完才开始。
 * 起不来(浏览器不支持线程里再开线程)、出了错 = 那一段本线程自己算(结果一样)。
 */
import { gullyHeights } from './gen/gully';
import { finishGully, finishVeins, rasterizeDeferred, streamsOf, type GullyJob, type Raster } from './gen/raster';
import { veinsOf, type DrainLines, type Streams, type VeinJob } from './gen/pixelDrain';
import type { World } from './gen/world';
import type { GullyRequest, GullyResponse } from './gullyWorker';
import { macroGrids, putRealisticRows, realisticRowBands, realisticRowsWindow, realisticWindowPaint, windowTransferables, type MacroGrids, type RealisticPainted } from './render/realistic';
import type { SurfaceLook } from './render/surface';

/** 开始重活之前最多等帮手加载多久(毫秒) */
const HELPER_WAIT = 400;
/** 细沟大约顶多少沟壑(整张图的沟壑算 1):分活时第一个帮手的沟壑按这个少分 */
const VEIN_COST = 0.4;
/** 帮手几个:留出主线程和本线程 */
const HELPERS = Math.max(0, Math.min(3, (self.navigator?.hardwareConcurrency || 2) - 2));

export class GullyPool {
  private helpers: Worker[] = [];
  private seq = 0;
  private readonly wait = new Map<number, (out: GullyResponse | null) => void>();
  /** 帮手都加载好了(或者等够了) */
  readonly up: Promise<void>;
  /** 交给第一个帮手先算着的河、溪浅谷(细沟用) */
  private beds: { key: number; streams: Streams; hw: Worker } | null = null;

  constructor() {
    const ups: Promise<void>[] = [];
    try {
      for (let i = 0; i < HELPERS; i++) {
        const hw = new Worker(new URL('./gullyWorker.ts', import.meta.url), { type: 'module' });
        let up = () => {};
        ups.push(new Promise<void>((r) => (up = r)));
        hw.onmessage = (e: MessageEvent<GullyResponse | { ready: true }>) => {
          if ('ready' in e.data) return up();
          this.wait.get(e.data.id)?.(e.data);
          this.wait.delete(e.data.id);
        };
        hw.onerror = () => {
          // 这个帮手坏了:以后不用它,等着的那几段作废(本线程自己算)
          this.helpers = this.helpers.filter((x) => x !== hw);
          for (const f of this.wait.values()) f(null);
          this.wait.clear();
          up();
        };
        this.helpers.push(hw);
      }
    } catch {
      this.helpers = [];
    }
    this.up = Promise.race([Promise.all(ups).then(() => {}), new Promise<void>((r) => setTimeout(r, HELPER_WAIT))]);
  }

  /**
   * 细沟要的河、溪浅谷只和世界有关:铺主图之前先交给第一个帮手算着(本线程铺像素的时候帮手正闲着),
   * 之后 finish 发细沟时就用它
   */
  prepare(world: World, scale = 1): void {
    const hw = this.helpers[0];
    this.beds = null;
    // 细沟按 1 倍算(整数倍的大图缩回 1 倍),别的倍数现算
    if (!hw || !(scale === 1 || (scale >= 2 && Number.isInteger(scale)))) return;
    const streams = streamsOf(world);
    const id = ++this.seq;
    const req: GullyRequest = { id, beds: { streams, w: Math.round(world.width), h: Math.round(world.height), scale: 1 } };
    hw.postMessage(req);
    this.beds = { key: id, streams, hw };
  }

  /**
   * 铺好的主图(rasterizeDeferred 的结果)把沟壑、细沟算完叠回去:沟壑分段交给帮手,细沟交给第一个帮手;
   * 本线程同时做 during(推文明;没有 = 本线程也领一段沟壑)。返回 during 的结果。结果和 rasterize 一样。
   * idle:本线程自己那段做完、等帮手的时候顺手做的(不影响结果;没有帮手时最后做)
   */
  finish<T>(d: Deferred, during: () => T, idle?: () => void): Promise<T>;
  finish(d: Deferred, during?: undefined, idle?: () => void): Promise<undefined>;
  async finish<T>(d: Deferred, during?: () => T, idle?: () => void): Promise<T | undefined> {
    const { job, veins: vj, raster } = d;
    const hs = this.helpers.slice();
    const n = job.n;
    if (!hs.length || n < 1000) {
      const result = during?.();
      finishGully(raster, job, gullyHeights(job, 0, n));
      finishVeins(raster, veinsOf(vj));
      idle?.();
      return result;
    }
    // 细沟先发(第一个帮手先算它,再算它那段沟壑;它那段少分一些,各线程差不多同时算完)
    const vp = this.sendVeins(hs[0], vj);
    const k = hs.length + (during ? 0 : 1);
    const first = Math.max(0, (1 + VEIN_COST) / k - VEIN_COST);
    const cut = (i: number) => (i <= 0 ? 0 : i >= k ? n : Math.floor(n * (first + ((1 - first) * (i - 1)) / (k - 1))));
    const parts = hs.map((hw, i) => this.send(hw, job, cut(i), cut(i + 1)));
    // 让一下,发给帮手的消息才送得出去
    await new Promise((r) => setTimeout(r, 0));
    const result = during?.();
    const mine = during ? null : gullyHeights(job, cut(k - 1), n);
    idle?.();
    const outs = await Promise.all(parts);
    const heights = new Float32Array(n);
    outs.forEach((o, i) => heights.set(o ?? gullyHeights(job, cut(i), cut(i + 1)), cut(i)));
    if (mine) heights.set(mine, cut(k - 1));
    finishGully(raster, job, heights);
    finishVeins(raster, (await vp) ?? veinsOf(vj));
    return result;
  }

  /**
   * 写实画风的整张像素层,looks 每种画法一张(和主线程 render/realistic.ts 的 realisticBase 一口气整张画逐像素相同):
   * 按整行切成带子(realisticRowBands),帮手和本线程一起画(每个帮手手上排两条,画完一条再给一条),拼回整张。
   * 切带子的数组交来交去、一直接着用(帮手画完把那一块交回来,下一条拷进它里面):不每条另分配,帮手那边不留一堆等着回收的。
   * 新建世界时用:主线程换上地图之前不用自己再分小步画几百毫秒。
   * stop() = 不要了(后面排上了新的世界):还没发出去的带子不画了,返回 null
   */
  async paintRealistic(r: Raster, looks: SurfaceLook[], stop: () => boolean): Promise<RealisticPainted | null> {
    const grids = macroGrids(r);
    const N = r.w * r.h * 4;
    const out = looks.map((look) => ({ look, px: new Uint8ClampedArray(N), raw: new Uint8ClampedArray(N) }));
    const bands = realisticRowBands(r);
    const tasks = out.flatMap((o) => bands.map(([y0, y1]) => ({ o, y0, y1 })));
    let next = 0;
    let stopped = false;
    const take = () => {
      if (next < tasks.length && stop()) stopped = true;
      return stopped || next >= tasks.length ? null : tasks[next++];
    };
    /** 本线程自己画的那几条接着用的一块 */
    let spare: Raster | null = null;
    const mine = (t: (typeof tasks)[number]) => {
      const win = (spare = realisticRowsWindow(r, t.y0, t.y1, spare));
      putRealisticRows(t.o, r, t.y0, t.y1, realisticWindowPaint(win, grids, t.o.look, true));
    };
    const gridsKey = ++this.seq;
    const helper = (hw: Worker) => {
      let sent = false;
      // 一条线:发一条带子、等它画完、拼上,再发下一条(帮手出了错的那条本线程自己画)
      const line = async () => {
        let back: Raster | null = null;
        // 帮手坏了(onerror 里拿掉了)就不再给它
        for (let t = this.helpers.includes(hw) ? take() : null; t; t = this.helpers.includes(hw) ? take() : null) {
          const p = this.sendPaint(hw, realisticRowsWindow(r, t.y0, t.y1, back), t.o.look, gridsKey, sent ? undefined : grids);
          sent = true;
          const got = await p;
          back = got?.win ?? null;
          if (got?.painted) putRealisticRows(t.o, r, t.y0, t.y1, got.painted);
          else mine(t);
        }
      };
      // 两条线:帮手画完一条,下一条已经在它那儿排着了(本线程正在画自己那条也不耽误它)
      return Promise.all([line(), line()]);
    };
    const own = async () => {
      for (let t = take(); t; t = take()) {
        mine(t);
        // 让一下:帮手画好的先拼上、再发下一条
        await yieldTask();
      }
    };
    const hs = this.helpers.slice();
    await Promise.all([...hs.map(helper), own()]);
    // 画完了:帮手手上的粗网格放掉
    for (const hw of hs) if (this.helpers.includes(hw)) hw.postMessage({ id: ++this.seq, paintEnd: true } satisfies GullyRequest);
    return stopped ? null : { grids, looks: out };
  }

  /** 不用了:关掉帮手 */
  close(): void {
    for (const hw of this.helpers) hw.terminate();
    this.helpers = [];
  }

  private send(hw: Worker, job: GullyJob, a: number, b: number): Promise<Float32Array | null> {
    const id = ++this.seq;
    const part = { seed: job.seed, w: job.w, h: job.h, R: job.R, scale: job.scale, idx: job.idx.slice(a, b), ge: job.ge.slice(a, b), gn: job.gn.slice(a, b), amp: job.amp.slice(a, b) };
    return new Promise<Float32Array | null>((resolve) => {
      this.wait.set(id, (r) => resolve(r && 'out' in r ? r.out : null));
      const req: GullyRequest = { id, job: part };
      hw.postMessage(req, [part.idx.buffer, part.ge.buffer, part.gn.buffer, part.amp.buffer]);
    });
  }

  /** 写实像素层的一条带子交给 hw(win 是切出来的一块,transfer 过去,画完原样交回来);帮手坏了 = null */
  private sendPaint(hw: Worker, win: Raster, look: SurfaceLook, gridsKey: number, grids?: MacroGrids): Promise<Extract<GullyResponse, { painted: unknown }> | null> {
    const id = ++this.seq;
    return new Promise((resolve) => {
      this.wait.set(id, (r) => resolve(r && 'painted' in r ? r : null));
      const req: GullyRequest = { id, paint: { win, look, gridsKey, ...(grids ? { grids } : {}) } };
      hw.postMessage(req, windowTransferables(win));
    });
  }

  /** 细沟交给 hw(海拔、水陆、河岸拷一份过去,主图自己的不动;它先算着这个世界的河、溪浅谷时只带编号) */
  private sendVeins(hw: Worker, vj: VeinJob): Promise<{ lines: DrainLines; vein: Uint8Array } | null> {
    const id = ++this.seq;
    const pre = this.beds && this.beds.hw === hw && this.beds.streams === vj.streams ? this.beds.key : undefined;
    this.beds = null;
    const copy: VeinJob = { ...vj, elev: vj.elev.slice(), water: vj.water.slice(), bank: vj.bank.slice(), streams: pre === undefined ? vj.streams : undefined };
    return new Promise((resolve) => {
      this.wait.set(id, (r) => resolve(r && 'veins' in r ? r.veins : null));
      const req: GullyRequest = { id, veins: copy, bedsKey: pre };
      hw.postMessage(req, [copy.elev.buffer, copy.water.buffer, copy.bank.buffer]);
    });
  }
}

/** 让一下(排到下一个任务再接着做,这期间到了的消息先处理;MessageChannel:没有 setTimeout(0) 连着用时的 4 毫秒下限) */
let yieldCh: MessageChannel | null = null;
const yielded: (() => void)[] = [];
function yieldTask(): Promise<void> {
  if (!yieldCh) {
    yieldCh = new MessageChannel();
    yieldCh.port1.onmessage = () => yielded.shift()?.();
  }
  const ch = yieldCh;
  return new Promise((r) => {
    yielded.push(r);
    ch.port2.postMessage(0);
  });
}

/** rasterizeDeferred 的结果:铺好的主图、还没算的沟壑和细沟 */
type Deferred = ReturnType<typeof rasterizeDeferred>;

/**
 * 铺像素(和 gen/raster.ts 的 rasterize 结果一样),沟和山脊、细沟分给临时开的几个帮手算:导出大图、地球仪贴图用。
 * lines:屏幕上那张主图的细沟(给了就照它画,和屏幕上一样)
 */
export async function rasterizeWithHelpers(world: World, scale: number, lines?: DrainLines): Promise<Raster> {
  const pool = new GullyPool();
  try {
    await pool.up;
    if (!lines) pool.prepare(world, scale);
    const d = rasterizeDeferred(world, scale, lines);
    await pool.finish(d);
    return d.raster;
  } finally {
    pool.close();
  }
}

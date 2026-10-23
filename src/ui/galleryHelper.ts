/**
 * 帮手模式(?gallery-helper=1):作品墙的后台上架作品时,在看不见的框里打开网站,把作品交过来;
 * 这里照作品生成世界、画封面、列名字,交回去(怎么传话见 helperProtocol.ts)。不出界面、不存东西。
 *
 *   世界     照存档生成、推演(地形修改、干预、地形大事……都带上,和打开分享链接看到的一样),
 *            封面 = 停在作者分享时那一年(save.moment.year;没有 = 结束那年)的政区图(手绘地形 + 国家色块和国界,不写字),
 *            中央经线照存档里的
 *   地图     照存档生成,封面 = 实景(经典卫星)整张图,中央经线 0°(作品页把它贴在地球仪上)
 *   新建参数 照这套参数生成(没带种子的用默认种子),封面 = 黑底上的一颗星球(写实,转到陆地最多的那一面)
 * 封面都是 1200×600 的 JPEG(600 KB 以内);名字、几样数按封面那一年(地图、新建参数 = 结束那年)算(helperWork.ts)。
 *
 * 生成用和地图同一个后台线程(worker.ts),一次开一个,画完就关;后台每画一个作品另开一个框,框关了线程也就没了。
 * 跟着主程序一起下载(App.tsx 转出来):用到的地图、推演代码和主程序是同一份,首页不多下载。
 */
import type { EraWorld, WorkerRequest, WorkerResponse } from '../worker';
import { WORKER_URL } from './workerUrl';
import { serverBase } from '../account/server';
import { resolveMoment } from '../gen/savefile';
import { GENERATOR_VERSION } from '../gen/edits';
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import type { Civ } from '../gen/civ/types';
import type { RasterPatch } from '../gen/rasterPatch';
import { civAtEra, eraData, eraIndex, eraMapsOf, eraReady, eraShown, patchKey, type EraMaps } from './eras';
import { xOfLon } from './mapWrap';
import { drawMapCiv, drawMapTerrain, type ExportMapParams } from '../render/export';
import { CIV_SHOW_OFF, type CivShow } from '../render/civ/overlay';
import { renderRealistic } from '../render/realistic';
import { GLOBE_DEFAULT_LAT, globeFrame, renderGlobeCpu, worldToLonLat } from '../render/globe';
import { helperCounts, helperJob, helperTexts, type HelperJob } from './helperWork';
import { helperOrigin, listenHelper, type HelperHost, type Rendered, type RenderRequest } from './helperProtocol';
import { CivPartInbox } from '../civParts';

/** 封面的大小、上限 */
const COVER_W = 1200;
const COVER_H = 600;
const COVER_BYTES = 600 * 1024;
/** 地形大事以后那一段的主图最多等多久(等不到就画前面铺好了的那一段) */
const ERA_WAIT = 20_000;

/** 世界封面上画的:只有国家色块和国界(不写字、不画战事) */
const POLITY_SHOW: CivShow = { ...CIV_SHOW_OFF, polities: true };

interface Generated {
  world: World;
  raster: Raster;
  civ: Civ | null;
  maps: EraMaps | null;
  patches: Map<string, RasterPatch | null>;
  /** 等第 k 段的主图补丁到齐(最多等 ms) */
  waitEra(k: number, ms: number): Promise<void>;
  stop(): void;
}

/** 开一个后台线程照 job 生成世界、推演;生成好(done)就交回来,地形大事以后各段的主图补丁接着收 */
function generate(job: HelperJob): Promise<Generated> {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_URL, { type: 'module' });
    const patches = new Map<string, RasterPatch | null>();
    const parts = new CivPartInbox();
    let out: Generated | null = null;
    const waiters = new Set<() => void>();
    const fail = (why: string) => {
      w.terminate();
      reject(new Error(why));
    };
    w.onerror = (e) => (out ? undefined : fail(`生成世界时出错：${e.message || '后台线程出错'}`));
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      if (m.id !== 1) return;
      // 交历史之前先交的几段(src/civParts.ts):收着,交历史的那条到了拼回去
      if (m.type === 'civPart') return void parts.take(m);
      if ('split' in m && m.split) parts.join(m.civ!, m.split);
      if (m.type === 'eraPatch') {
        patches.set(patchKey(m.prev, m.key), m.patch);
        for (const f of [...waiters]) f();
        return;
      }
      if (m.type !== 'done' || out) return;
      if (!m.raster) return fail('生成世界时出错：没交回整张地图');
      const maps = m.eras?.length ? eraMapsOf(m.world, m.baseKey, m.eras as EraWorld[]) : null;
      out = {
        world: m.world,
        raster: m.raster,
        civ: m.civ,
        maps,
        patches,
        waitEra: (k, ms) =>
          new Promise<void>((ok) => {
            const check = () => {
              if (!eraReady(maps, patches, k)) return;
              waiters.delete(check);
              clearTimeout(t);
              ok();
            };
            const t = setTimeout(() => {
              waiters.delete(check);
              ok();
            }, ms);
            waiters.add(check);
            check();
          }),
        stop: () => w.terminate(),
      };
      resolve(out);
    };
    w.postMessage({ type: 'generate', id: 1, ...job.input } satisfies WorkerRequest);
  });
}

const canvasOf = (w: number, h: number): HTMLCanvasElement => Object.assign(document.createElement('canvas'), { width: w, height: h });
const ctxOf = (c: HTMLCanvasElement) => c.getContext('2d') as CanvasRenderingContext2D;

/** 世界的封面:手绘地形 + 那一年的国家色块和国界(和主图一样大) */
function worldCover(world: World, raster: Raster, civ: Civ | null, year: number, lon: number | undefined): HTMLCanvasElement {
  const c = canvasOf(raster.w, raster.h);
  const p: ExportMapParams = { world, raster, civ, style: 'fantasy', layer: 'biomes', year, show: POLITY_SHOW, ...(lon !== undefined ? { center: xOfLon(lon, world.width) } : {}) };
  drawMapTerrain(ctxOf(c), p, canvasOf);
  drawMapCiv(ctxOf(c), p, canvasOf);
  return c;
}

/** 地图的封面:实景(经典卫星)整张图 */
function mapCover(world: World, raster: Raster): HTMLCanvasElement {
  const c = canvasOf(raster.w, raster.h);
  renderRealistic(ctxOf(c), world, raster, 'classic');
  return c;
}

/** 星球转到哪个经度(弧度):朝着观察者的那一面陆地最多 */
function landiestLon(raster: Pick<Raster, 'w' | 'h' | 'water' | 'scale'>, worldW: number, worldH: number): number {
  const { w, h, water } = raster;
  const col = new Float64Array(w);
  for (let y = 0; y < h; y++) {
    const k = Math.cos(((y + 0.5) / h - 0.5) * Math.PI);
    for (let x = 0; x < w; x++) if (water[y * w + x] === 0) col[x] += k;
  }
  let best = 0;
  let bestScore = -1;
  for (let c = 0; c < w; c += Math.max(1, Math.round(w / 72))) {
    let s = 0;
    for (let x = 0; x < w; x++) {
      const d = Math.cos(((x - c) / w) * 2 * Math.PI);
      if (d > 0) s += col[x] * d;
    }
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return worldToLonLat((best + 0.5) / raster.scale, 0, worldW, worldH)[0];
}

/** 新建参数的封面:黑底上的一颗星球(写实,地形贴图里烤好了明暗;和地球仪没有显卡加速时的画法一样) */
function planetCover(world: World, raster: Raster): HTMLCanvasElement {
  const tex = canvasOf(raster.w, raster.h);
  renderRealistic(ctxOf(tex), world, raster, 'classic');
  const src = ctxOf(tex).getImageData(0, 0, raster.w, raster.h);
  tex.width = tex.height = 0;
  const out = canvasOf(COVER_W, COVER_H);
  const o = ctxOf(out);
  const img = o.createImageData(COVER_W, COVER_H);
  const view = { lon: landiestLon(raster, world.width, world.height), lat: GLOBE_DEFAULT_LAT, k: 1 };
  renderGlobeCpu({ w: COVER_W, h: COVER_H, data: img.data }, view, globeFrame(view, COVER_W, COVER_H), { style: 'realistic', graticule: 0, hl: 0, replay: 0 }, { terrain: { w: src.width, h: src.height, data: src.data } });
  o.putImageData(img, 0, 0);
  return out;
}

/** 缩到 1200×600 的 JPEG(data: 网址),超过 600 KB 就降质量再来 */
function coverJpeg(src: HTMLCanvasElement): string {
  let c = src;
  if (src.width !== COVER_W || src.height !== COVER_H) {
    c = canvasOf(COVER_W, COVER_H);
    const x = ctxOf(c);
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, COVER_W, COVER_H);
  }
  for (const q of [0.88, 0.8, 0.7, 0.6, 0.5, 0.4]) {
    const url = c.toDataURL('image/jpeg', q);
    if (!url.startsWith('data:image/jpeg')) throw new Error('这个浏览器画不出 JPEG 封面');
    const bytes = Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4);
    if (bytes <= COVER_BYTES) return url;
  }
  throw new Error('封面压不到 600 KB 以内');
}

/** 画一个作品:生成、推演、画封面、列名字 */
async function renderWork(req: RenderRequest): Promise<Rendered> {
  const job = helperJob(req);
  const g = await generate(job);
  try {
    const { civ } = g;
    // 封面那一年:世界 = 作者分享时那一年(没有 = 结束那年);地图、新建参数 = 结束那年
    const end = civ?.endYear ?? 0;
    const year = civ && job.moment ? (resolveMoment(civ, job.moment).year ?? end) : end;
    let cover: HTMLCanvasElement;
    if (job.kind === 'world') {
      // 地形大事以后:那一段的世界、主图、州和地名(主图补丁后台慢慢铺,等一会儿;等不到画前面铺好了的那一段)
      const k = civ ? eraIndex(civ, year) : 0;
      if (k > 0) await g.waitEra(k, ERA_WAIT);
      const shown = eraShown(g.maps, g.patches, k);
      const d = eraData({ world: g.world, raster: g.raster }, g.maps, g.patches, shown);
      cover = worldCover(d.world, d.raster, civ ? civAtEra(civ, shown) : null, year, job.lon);
    } else cover = job.kind === 'map' ? mapCover(g.world, g.raster) : planetCover(g.world, g.raster);
    const url = coverJpeg(cover);
    cover.width = cover.height = 0;
    const texts = civ ? helperTexts(civ, year, civAtEra(civ, eraIndex(civ, year))) : [];
    return { cover: url, info: { seed: job.params.seed, year: Math.floor(year), ...helperCounts(civ, year), generator: GENERATOR_VERSION }, texts };
  } finally {
    g.stop();
  }
}

/** 帮手模式开始:在框里、配了服务器才帮(只认那台服务器的后台);主程序下好以后由 Boot.tsx 叫 */
export function startGalleryHelper(): void {
  if (window.parent === window) return;
  const origin = helperOrigin(serverBase(), location.href);
  if (!origin) return;
  const host: HelperHost = {
    parent: window.parent,
    addEventListener: (t, f) => window.addEventListener(t, f),
    removeEventListener: (t, f) => window.removeEventListener(t, f),
  };
  listenHelper(host, origin, renderWork);
}

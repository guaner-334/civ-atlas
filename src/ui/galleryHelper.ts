/**
 * 帮手模式(?gallery-helper=1):作品墙的后台上架作品时,在看不见的框里打开网站,把作品交过来;
 * 这里照作品生成世界、画封面、列名字,交回去(怎么传话见 helperProtocol.ts)。不出界面;只有第 2 版的世界文件临时放进本机仓库。
 *
 *   世界     照存档生成、推演(地形修改、干预、地形大事……都带上,和打开分享链接看到的一样),
 *            封面 = 停在作者分享时那一年(save.moment.year;没有 = 结束那年)的政区图(手绘地形 + 国家色块和国界,不写字),
 *            中央经线照存档里的
 *   地图     照存档生成,封面 = 实景(经典卫星)整张图,中央经线 0°(作品页把它贴在地球仪上)
 *   新建参数 照这套参数生成(没带种子的用默认种子),封面 = 黑底上的一颗星球(写实,转到陆地最多的那一面)
 * 封面都是 1200×600 的 JPEG(600 KB 以内);名字、几样数按封面那一年(地图、新建参数 = 结束那年)算(helperWork.ts)。
 * 第 2 版(世界文件、规则)见 helperProtocol.ts 文件头:封面也是政区图,不列名字。
 *
 * 生成用和地图同一个后台线程(worker.ts),一次开一个,画完就关;后台每画一个作品另开一个框,框关了线程也就没了。
 * 跟着主程序一起下载(App.tsx 转出来):用到的地图、推演代码和主程序是同一份,首页不多下载。
 */
import type { EraWorld, LoadRequest, WorkerRequest, WorkerResponse } from '../worker';
import type { OpenRefusal } from '../worldOpen';
import { WORKER_URL } from './workerUrl';
import { serverBase } from '../account/server';
import { resolveMoment, type SaveFile } from '../gen/savefile';
import { recipeKey, recipeOfSave } from '../gen/recipe';
import { GENERATOR_VERSION, keptMapOf } from '../gen/edits';
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
import { fileYear, helperCounts, helperJob, helperLoad, helperTexts, saveLon } from './helperWork';
import { helperOrigin, listenHelper, type HelperHost, type HelperRequest, type Rendered, type RenderRequest, type RenderRequestV2 } from './helperProtocol';
import { CivPartInbox } from '../civParts';
import { markTrash, newWorldId } from './saveStore';
import { holdWorld } from './worldHolds';
import { TRASH_KEEP_MS, maintain } from './worldStore';

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

/** 线程读不了存下的内容 */
class LoadRefused extends Error {
  constructor(readonly why: OpenRefusal) {
    super(`读不了存下的内容（${why}）`);
  }
}

type GenerateInput = Omit<Extract<WorkerRequest, { type: 'generate' }>, 'type' | 'id'>;
type RunRequest = ({ type: 'generate' } & GenerateInput) | ({ type: 'load' } & Omit<LoadRequest, 'type' | 'id'>);

/** 开一个后台线程生成(或读存下的内容打开)世界、推演;好了(done)就交回来,地形大事以后各段的主图补丁接着收 */
function run(req: RunRequest): Promise<Generated> {
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER_URL, { type: 'module' });
    const patches = new Map<string, RasterPatch | null>();
    const parts = new CivPartInbox();
    let out: Generated | null = null;
    const waiters = new Set<() => void>();
    const fail = (e: Error) => {
      w.terminate();
      reject(e);
    };
    w.onerror = (e) => (out ? undefined : fail(new Error(`生成世界时出错：${e.message || '后台线程出错'}`)));
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      if (m.id !== 1) return;
      if (m.type === 'loadFailed') return void (out ? undefined : fail(new LoadRefused(m.why)));
      // 交历史之前先交的几段(src/civParts.ts):收着,交历史的那条到了拼回去
      if (m.type === 'civPart') return void parts.take(m);
      if ('split' in m && m.split) parts.join(m.civ!, m.split);
      if (m.type === 'eraPatch') {
        patches.set(patchKey(m.prev, m.key), m.patch);
        for (const f of [...waiters]) f();
        return;
      }
      if (m.type !== 'done' || out) return;
      if (!m.raster) return fail(new Error('生成世界时出错：没交回整张地图'));
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
    w.postMessage({ ...req, id: 1 } satisfies WorkerRequest);
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
  renderGlobeCpu({ w: COVER_W, h: COVER_H, data: img.data }, view, globeFrame(view, COVER_W, COVER_H), 1, { style: 'realistic', graticule: 0, hl: 0, replay: 0 }, { terrain: { w: src.width, h: src.height, data: src.data } });
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

/** 停在 year 那年的政区图;地形大事以后画那一段的世界、主图(主图补丁后台慢慢铺,等一会儿;等不到画前面铺好了的那一段) */
async function politicalCover(g: Generated, year: number, lon: number | undefined): Promise<string> {
  const { civ } = g;
  const k = civ ? eraIndex(civ, year) : 0;
  if (k > 0) await g.waitEra(k, ERA_WAIT);
  const shown = eraShown(g.maps, g.patches, k);
  const d = eraData({ world: g.world, raster: g.raster }, g.maps, g.patches, shown);
  return jpegOf(worldCover(d.world, d.raster, civ ? civAtEra(civ, shown) : null, year, lon));
}

function jpegOf(cover: HTMLCanvasElement): string {
  const url = coverJpeg(cover);
  cover.width = cover.height = 0;
  return url;
}

/** 第 1 版:照存档、新建参数生成、推演、画封面、列名字 */
async function renderSaved(req: RenderRequest): Promise<Rendered> {
  const job = helperJob(req);
  const g = await run({ type: 'generate', ...job.input });
  try {
    const { civ } = g;
    // 封面那一年:世界 = 作者分享时那一年(没有 = 结束那年);地图、新建参数 = 结束那年
    const end = civ?.endYear ?? 0;
    const year = civ && job.moment ? (resolveMoment(civ, job.moment).year ?? end) : end;
    const cover = job.kind === 'world' ? await politicalCover(g, year, job.lon) : jpegOf(job.kind === 'map' ? mapCover(g.world, g.raster) : planetCover(g.world, g.raster));
    const texts = civ ? helperTexts(civ, year, civAtEra(civ, eraIndex(civ, year))) : [];
    return { cover, info: { seed: job.params.seed, year: Math.floor(year), ...helperCounts(civ, year), generator: GENERATOR_VERSION }, texts };
  } finally {
    g.stop();
  }
}

/** 第 2 版的规则作品:示例地图上照这套规则推 3000 年,画那年的政区图,交回摘要 */
async function renderRules(req: Extract<RenderRequestV2, { kind: 'rules' }>): Promise<Rendered> {
  const job = (await import('./helperRules')).rulesJob(req.rules);
  const g = await run({ type: 'generate', ...job.input });
  try {
    const year = g.civ?.endYear ?? 0;
    const cover = await politicalCover(g, year, undefined);
    return { cover, info: { seed: job.params.seed, year: Math.floor(year), ...helperCounts(g.civ, year), generator: GENERATOR_VERSION }, rules: job.rules };
  } finally {
    g.stop();
  }
}

/** 线程读不了存下的内容时给管理员看的话 */
function refusalText(why: OpenRefusal): string {
  if (why === 'newer') return '这个世界要更新版本的网站才打得开，网站更新以后再画';
  if (why === 'recompute' || why === 'readonly') return '世界文件里存的内容没跟上最后的修改，没法照存的内容画：请作者打开这个世界，等历史推完再存一次';
  return '世界文件里存的内容读不出来';
}

/**
 * 读存下的内容打开;存的内容没跟上最后的修改(这一版算的)就和别人打开短链接一样按配方现推。
 * 交回打开的世界、历史是哪一版生成器算的
 */
async function openFile(id: string, save: SaveFile): Promise<{ g: Generated; generator: number }> {
  try {
    return { g: await run({ type: 'load', ...helperLoad(id, save, await recipeKey(recipeOfSave(save))) }), generator: save.generator };
  } catch (e) {
    if (!(e instanceof LoadRefused)) throw e;
    if (e.why !== 'recompute' || keptMapOf(save.edits)) throw new Error(refusalText(e.why));
    return { g: await run({ type: 'generate', ...helperJob({ id, kind: 'world', save }).input }), generator: GENERATOR_VERSION };
  }
}

/** 第 2 版的世界作品:文件放进本机仓库一个临时编号(和别人打开短链接一样,下次清理时清掉),照存的内容停在分享的那一年画政区图 */
async function renderFile(req: Extract<RenderRequestV2, { kind: 'world' }>): Promise<Rendered> {
  const { adoptWorldFile } = await import('./worldFiles');
  const id = newWorldId();
  markTrash(id, Date.now() - TRASH_KEEP_MS);
  const free = holdWorld(id);
  try {
    const r = await adoptWorldFile(id, req.file);
    if (!r.ok) throw new Error(`世界文件读不出来：${r.message}`);
    const { g, generator } = await openFile(id, r.save);
    try {
      const year = g.civ ? fileYear(g.civ, r.save, req.at) : 0;
      const cover = await politicalCover(g, year, saveLon(r.save));
      return { cover, info: { seed: r.save.params.seed, year: Math.floor(year), ...helperCounts(g.civ, year), generator } };
    } finally {
      g.stop();
    }
  } finally {
    free();
    void maintain().catch(() => {});
  }
}

/** 画一个作品 */
function renderWork(req: HelperRequest): Promise<Rendered> {
  if (!('v' in req)) return renderSaved(req);
  return req.kind === 'rules' ? renderRules(req) : renderFile(req);
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

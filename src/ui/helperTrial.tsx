/**
 * 帮手第 3 版:后台审插件时的试跑(传话见 helperProtocol.ts)。每个种子生成一个示例世界(默认参数),
 * 用和用的人从文件装上时同一套沙箱临时开这个插件(不进插件仓库,存的数据只在内存里),照 plugin/trial.ts 的固定办法替它点、
 * 拦下改你写的东西;跑完(或到了限时)照它留下了什么出详情图和封面(规矩见 plugin/trialPicture.ts,画法见 helperPictures.ts),
 * 另截面板,交回它做了什么。用到时才下载。
 * 推演插件另走一条(simTrial):推 3000 年和官方比,见 plugin/simTrial.ts。
 * 地图插件也另走一条(mapTrial):不带 / 带插件各长一张比,见 plugin/mapTrial.ts;并排的图在这边另长一遍截。
 * 放大的那一片按 2 倍像素另长一遍画(4096×2048 的画布,画完马上清掉)。
 */
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { capitalAt, polityAlive, polityName } from '../gen/civ/growth';
import { pluginEntries } from '../gen/civ/story/pluginText';
import type { Civ } from '../gen/civ/types';
import { DEFAULT_PARAMS, type WorldParams } from '../gen/params';
import type { World } from '../gen/world';
import type { CellLayer, RegionLayer } from '../plugin/check';
import { simParamsOf, type MapPluginFile, type SimPluginFile } from '../plugin/pluginWorld';
import type { MapTrialSeed } from '../plugin/mapTrial';
import type { MapTrialJob, MapTrialReply } from '../plugin/mapTrialWorker';
import type { MapLayerSpec, MapManifest } from '../plugin/pluginMap';
import { simLayerPaint, type SimTrial, type SimTrialSeed } from '../plugin/simTrial';
import type { SimTrialJob, SimTrialReply } from '../plugin/simTrialWorker';
import {
  FULL_AREA,
  PANEL_AREA,
  PIC_H,
  PIC_W,
  SUBTITLE_AREA,
  compareSquare,
  firstFilled,
  fitArea,
  inRect,
  lastFilled,
  layerWindow,
  legendOf,
  paintFilled,
  patchWindow,
  pickChange,
  pickChronicle,
  pickVs,
  pointsWindow,
  vsText,
  yearText,
  type PicKind,
  type PicRect,
} from '../plugin/trialPicture';
import { framePaint, regionsToCells, type CellPaint } from '../render/pluginLayer';
import { drawMapLabels, drawMapPlugin, drawMapTerrain, type ExportMapParams } from '../render/export';
import { CIV_SHOW_OFF, type CivShow } from '../render/civ/show';
import { PluginRefused, startPluginHost, type PluginHost } from '../plugin/host';
import { SandboxStopped } from '../plugin/sandbox';
import { PLUGIN_ICON, PluginFileError, openPluginFile, type OpenedPlugin } from '../plugin/pluginFile';
import { memoryStore } from '../plugin/store';
import { TRIAL_MS, TRIAL_QUIET_MS, TrialRecorder } from '../plugin/trial';
import type { PanelNode } from '../plugin/types';
import { shownAt } from '../render/pluginMarks';
import { eraIndex } from './eras';
import { canvasOf, coverJpeg, ctxOf, politicalCanvas, run, type Generated } from './galleryHelper';
import { cropCanvas, drawPicture, type BigMap, type PanelPic } from './helperPictures';
import { MAP_VIEWS, type MapView, type TrialRequest, type TrialRun } from './helperProtocol';
import { PluginIcon } from './plugins/pluginIcons';
import { versionLabel } from './plugins/pluginText';
import { PanelView } from './plugins/tools/PanelView';
import './countryPanel.css';
import './plugins/tools/tools.css';

/** 面板截图:和电脑上的侧栏一样宽;太长的截到这么高 */
const PANEL_W = 340;
const PANEL_MAX_H = 1400;
const PANEL_BYTES = 300 * 1024;

const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
/** ping 回得比这慢 = 插件线程刚才在算 */
const PING_SLOW_MS = 50;

/** 试跑一个插件:每个种子一份;插件文件打不开也是每个种子一份 ok = false。生成不了示例世界才抛出 */
export async function runTrial(req: TrialRequest): Promise<TrialRun[]> {
  let opened: OpenedPlugin | null = null;
  let refusal = '';
  try {
    opened = await openPluginFile(req.file);
  } catch (e) {
    refusal = e instanceof PluginFileError && e.kind === 'newer' ? e.message : `插件文件打不开：${e instanceof Error ? e.message : String(e)}`;
  }
  if (opened?.manifest.role === 'sim') return simTrial(req, opened);
  if (opened?.manifest.role === 'map') return mapTrial(req, opened);
  const runs: TrialRun[] = [];
  for (const seed of req.seeds) {
    runs.push(
      opened
        ? await trialSeed(opened, seed)
        : { seed, ok: false, ms: 0, error: refusal.slice(0, 300), log: [], did: { got: '没拿', picked: '没请点', drew: '没画', wrote: '没有', said: '没发话' }, shots: {} },
    );
  }
  return runs;
}

async function trialSeed(p: OpenedPlugin, seed: number): Promise<TrialRun> {
  const params = { ...DEFAULT_PARAMS, seed };
  const g = await run({ type: 'generate', params, scale: 1 });
  try {
    const year = Math.floor(g.civ?.endYear ?? 0);
    const rec = new TrialRecorder({ world: g.world, civ: g.civ, year });
    const t0 = performance.now();
    let host: PluginHost | null = null;
    let done = false;
    try {
      host = await startPluginHost({
        plugin: p.manifest,
        code: p.code,
        source: rec.source(),
        sink: rec.sink(),
        stores: { local: memoryStore(), world: memoryStore() },
        onMessage: () => rec.posted(),
        onStop: (reason, detail) => rec.stopped(reason, detail),
      });
      done = await settle(host, rec, t0 + TRIAL_MS);
    } catch (e) {
      // 开到一半停下的(没反应、出错)停的时候已经记了
      if (e instanceof PluginRefused) rec.fault(e.kind === 'newer' ? e.message : `清单要的能力写得不对：${e.message}`);
      else if (!(e instanceof SandboxStopped)) rec.fault(`没开成：${e instanceof Error ? e.message : String(e)}`);
      done = true;
    }
    if (!done) rec.fault(`${TRIAL_MS / 1000} 秒内没跑完，到时停掉了`);
    const ms = Math.round(Math.min(TRIAL_MS, Math.max(0, (done ? rec.last : performance.now()) - t0)));
    rec.freeze();
    host?.stop();
    const did = rec.did();
    const shots: TrialRun['shots'] = {};
    let panel: PanelPic | null = null;
    if (rec.panel?.length) {
      try {
        panel = await panelPicture(p, rec.panel);
        shots.panel = panelJpeg(panel);
      } catch {
        // 截不到就不带(后台写「没截到面板」)
      }
    }
    try {
      Object.assign(shots, await toolPictures(g, params, year, rec, panel));
    } catch {
      // 画不出就不带(后台写「没截到地图」)
    }
    return { seed, ok: !rec.error, ms, ...(rec.error ? { error: rec.error } : {}), log: rec.logLines(), did, shots };
  } finally {
    g.stop();
  }
}

/** 推演插件两个种子一共最多跑多久(推得慢,不按工具插件的 TRIAL_MS;出图另算) */
const SIM_TRIAL_MS = 180_000;

/** 推演插件:每个种子在一个后台线程里推(plugin/simTrial.ts),照它写的编年史、图层出图(不重推,用线程交回的历史) */
async function simTrial(req: TrialRequest, p: OpenedPlugin): Promise<TrialRun[]> {
  const files: SimPluginFile[] = [{ id: p.manifest.id, sum: p.sum, bytes: new Uint8Array(await req.file.arrayBuffer()) }];
  let until = performance.now() + SIM_TRIAL_MS;
  const runs: TrialRun[] = [];
  for (const seed of req.seeds) {
    const t0 = performance.now();
    if (t0 >= until) {
      runs.push({ seed, ok: false, ms: 0, error: `${SIM_TRIAL_MS / 60_000} 分钟限时到了，没轮到这个种子`, log: [], shots: {} });
      continue;
    }
    const got = await simInWorker({ seed, files }, until);
    const shots: TrialRun['shots'] = {};
    if (got.civ) {
      const t1 = performance.now();
      try {
        Object.assign(shots, await simPictures(seed, got.civ, got.official, got.result?.sim, p.manifest.sim));
      } catch {
        // 画不出就不带(后台写「没截到地图」)
      }
      // 出图的工夫不算进限时
      until += performance.now() - t1;
    }
    const r = got.result;
    const error = got.error ?? r?.error;
    runs.push({ seed, ok: !error, ms: Math.round(performance.now() - t0), ...(error ? { error: error.slice(0, 300) } : {}), log: r?.log ?? [], shots, ...(r ? { sim: r.sim } : {}) });
  }
  return runs;
}

/** 在后台线程里试跑一个种子;到了 until 停掉线程,交回到那时为止的结果(error 写停在哪一步) */
function simInWorker(job: SimTrialJob, until: number): Promise<{ result: SimTrialSeed | null; error?: string; civ: Civ | null; official: Civ | null }> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('../plugin/simTrialWorker.ts', import.meta.url), { type: 'module' });
    let result: SimTrialSeed | null = null;
    let civ: Civ | null = null;
    let official: Civ | null = null;
    const finish = (error?: string) => {
      clearTimeout(timer);
      w.terminate();
      resolve({ result, ...(error ? { error } : {}), civ, official });
    };
    const timer = setTimeout(() => {
      const stage = !result ? '官方推的时候' : !result.sim.stats.plugin ? '带插件推的时候' : '查分段推的时候';
      finish(`${SIM_TRIAL_MS / 60_000} 分钟限时到了，停在${stage}`);
    }, until - performance.now());
    w.onmessage = (e: MessageEvent<SimTrialReply>) => {
      const m = e.data;
      if (m.type === 'step') result = m.result;
      else if (m.type === 'civ') ({ civ, official } = m);
      else if (m.type === 'done') {
        result = m.result;
        finish();
      } else finish(`没跑成：${m.error}`);
    };
    w.onerror = (e) => finish(`后台线程出错：${e.message || '不知道为什么'}`);
    w.postMessage(job satisfies SimTrialJob);
  });
}

/** 推演插件出图时地图上写的字:国名、城名、地理名(不画战事、瘟疫) */
const LABEL_SHOW: CivShow = { ...CIV_SHOW_OFF, polities: true, labels: true };

/**
 * 推演插件的详情图和封面(示例世界按 2 倍像素另长一遍,历史用线程交回的):
 * 挑得出编年史的,画那一年、放大到提到的几国、标出都城和国名,详情图底下字幕;没有就画最后一年它的图层;
 * 再没有就最后一年不装 / 装上两张政区图左右比
 */
async function simPictures(seed: number, civ: Civ, official: Civ | null, sim: SimTrial | undefined, m: OpenedPlugin['manifest']['sim']): Promise<Pics> {
  const g = await run({ type: 'generate', params: { ...DEFAULT_PARAMS, seed }, scale: 2, skipCiv: true });
  const bigs: BigMap[] = [];
  try {
    const { world } = g;
    const { mesh } = world;
    const W = world.width;
    const H = world.height;
    const end = Math.floor(civ.endYear);
    const big = async (c: Civ, year: number, paint?: CellPaint, labels = false): Promise<BigMap> => {
      const cv = await politicalCanvas({ ...g, civ: c }, year, undefined, paint);
      const out = { c: cv, s: cv.width / W, W, H };
      bigs.push(out);
      if (labels) {
        const S = g.raster.scale === 2 ? 2 : 1;
        await drawMapLabels(ctxOf(cv), { world, raster: g.raster, civ: c, style: 'fantasy', layer: 'biomes', year, show: LABEL_SHOW }, S).catch(() => undefined);
      }
      return out;
    };
    const capital = (id: number, year: number): number => {
      const p = civ.polities[id];
      if (!p || !polityAlive(p, year)) return -1;
      return civ.settlements[capitalAt(p, year)]?.cell ?? -1;
    };
    const st = sim?.stats;
    const vs = st?.official && st.plugin ? pickVs(st.official, st.plugin, [...(m?.influences ?? []), ...(m?.commands ?? [])]) : null;
    const vsLine = vs && sim ? vsText(vs, sim.years) : undefined;

    const entry = pickChronicle(pluginEntries(civ, []), (id, y) => capital(id, y) >= 0);
    if (entry) {
      const tags = entry.polities.map((id) => {
        const cell = capital(id, entry.year);
        const p = civ.polities[id];
        return { x: mesh.x[cell], y: mesh.y[cell], name: polityName(p, entry.year) || p.name };
      });
      const pts = tags.map((t) => [t.x, t.y] as const);
      const zoom: Record<PicKind, PicRect | null> = { card: pointsWindow(pts, W, H), map: pointsWindow(pts, W, H, SUBTITLE_AREA) };
      const b = await big(civ, entry.year, undefined, true);
      const subtitle = { year: yearText(entry.year), text: entry.text, ...(vsLine ? { vs: vsLine } : {}) };
      return picsOf((kind) => drawPicture(kind, { base: { big: b, r: zoom[kind] }, tags, tagSize: kind === 'card' ? 'l' : 'm', ...(kind === 'map' ? { subtitle } : {}) }));
    }

    const layer = firstFilled(civ.simLayers ?? [], (l) => {
      const p = simLayerPaint(civ, end, l);
      return !!p && paintFilled(p);
    });
    if (layer) {
      const paint = simLayerPaint(civ, end, layer)!;
      const r = layerWindow(mesh, layer, paint);
      const b = await big(civ, end, paint);
      const legend = legendOf(layer, paint, (c) => inRect(r, mesh.x[c], mesh.y[c], W));
      return picsOf((kind) => drawPicture(kind, { base: { big: b, r }, ...(kind === 'map' ? { legend } : {}) }));
    }

    if (official) {
      const square = compareSquare(null, W, H);
      const halves = [] as HTMLCanvasElement[];
      for (const c of [official, civ]) {
        const b = await big(c, end);
        halves.push(cropCanvas(b, square, PIC_W / 2, PIC_H));
        b.c.width = b.c.height = 0;
      }
      try {
        return picsOf((kind) => drawPicture(kind, { base: { halves: [halves[0], halves[1]] }, ...(kind === 'map' && vsLine ? { subtitle: { vs: vsLine } } : {}) }));
      } finally {
        for (const h of halves) h.width = h.height = 0;
      }
    }
    const b = await big(civ, end);
    return picsOf((kind) => drawPicture(kind, { base: { big: b, r: null } }));
  } finally {
    for (const b of bigs) b.c.width = b.c.height = 0;
    g.stop();
  }
}

/** 地图插件两个种子一共最多跑多久(截图另算) */
const MAP_TRIAL_MS = 180_000;
/** 并排比的小图 */
const VIEW_W = 600;
const VIEW_H = 300;
const VIEW_BYTES = 200 * 1024;

/** 地图插件:每个种子在一个后台线程里比(plugin/mapTrial.ts);带插件那张长出来了,再在这边不带 / 带插件各长一遍截图 */
async function mapTrial(req: TrialRequest, p: OpenedPlugin): Promise<TrialRun[]> {
  const params = simParamsOf(p.manifest.map?.params);
  const file: MapTrialJob['file'] = { id: p.manifest.id, sum: p.sum, bytes: new Uint8Array(await req.file.arrayBuffer()), ...(Object.keys(params).length ? { params } : {}) };
  let until = performance.now() + MAP_TRIAL_MS;
  const runs: TrialRun[] = [];
  for (const seed of req.seeds) {
    const t0 = performance.now();
    if (t0 >= until) {
      runs.push({ seed, ok: false, ms: 0, error: `${MAP_TRIAL_MS / 60_000} 分钟限时到了，没轮到这个种子`, log: [], shots: {} });
      continue;
    }
    const got = await mapInWorker({ seed, file }, until);
    const r = got.result;
    const error = got.error ?? r?.error;
    const t1 = performance.now();
    const shots = r?.map.stats.plugin ? await mapShots(seed, file, p.manifest.map) : {};
    until += performance.now() - t1;
    runs.push({ seed, ok: !error, ms: Math.round(performance.now() - t0), ...(error ? { error: error.slice(0, 300) } : {}), log: r?.log ?? [], shots, ...(r ? { map: r.map } : {}) });
  }
  return runs;
}

/** 在后台线程里试跑一个种子;到了 until 停掉线程,交回到那时为止的结果(error 写停在哪一步) */
function mapInWorker(job: MapTrialJob, until: number): Promise<{ result: MapTrialSeed | null; error?: string }> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('../plugin/mapTrialWorker.ts', import.meta.url), { type: 'module' });
    let result: MapTrialSeed | null = null;
    const finish = (error?: string) => {
      clearTimeout(timer);
      w.terminate();
      resolve({ result, ...(error ? { error } : {}) });
    };
    const timer = setTimeout(() => {
      const m = result?.map;
      const stage = !m?.stats.plugin ? '长图的时候' : !m.civ.plugin ? '推历史的时候' : !m.edit ? '查两遍一样、改一笔的时候' : '量 20 万地块的时候';
      finish(`${MAP_TRIAL_MS / 60_000} 分钟限时到了，停在${stage}`);
    }, until - performance.now());
    w.onmessage = (e: MessageEvent<MapTrialReply>) => {
      const m = e.data;
      if (m.type === 'step') result = m.result;
      else if (m.type === 'done') {
        result = m.result;
        finish();
      } else finish(`没跑成：${m.error}`);
    };
    w.onerror = (e) => finish(`后台线程出错：${e.message || '不知道为什么'}`);
    w.postMessage(job satisfies MapTrialJob);
  });
}

/** 缩到 w×h 的 JPEG,超过 max 字节就降质量再来 */
function smallJpeg(src: HTMLCanvasElement, w: number, h: number, max: number): string {
  const c = canvasOf(w, h);
  const x = ctxOf(c);
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, w, h);
  try {
    for (const q of [0.85, 0.75, 0.6, 0.45]) {
      const url = c.toDataURL('image/jpeg', q);
      if (!url.startsWith('data:image/jpeg')) break;
      if (Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4) <= max) return url;
    }
    throw new Error('截图压不下来');
  } finally {
    c.width = c.height = 0;
  }
}

/** 整张图:地形(手绘风)或一张数据图;plugin = 盖上插件的一张图层 */
function viewCanvas(g: Generated, view: MapView, plugin?: CellPaint): HTMLCanvasElement {
  const { world, raster } = g;
  const c = canvasOf(raster.w, raster.h);
  const p: ExportMapParams = {
    world,
    raster,
    civ: null,
    style: view === 'terrain' ? 'fantasy' : 'data',
    layer: view === 'terrain' ? 'biomes' : view,
    year: 0,
    show: CIV_SHOW_OFF,
    ...(plugin ? { plugin } : {}),
  };
  drawMapTerrain(ctxOf(c), p, canvasOf);
  if (plugin) drawMapPlugin(ctxOf(c), p, canvasOf);
  return c;
}

/** 截一张(big = 1200×600 的整张,别的 600×300);截不到 = 不带(后台写「没截到」) */
function shotOf(g: Generated, view: MapView, plugin?: CellPaint, big = false): string | undefined {
  let c: HTMLCanvasElement | null = null;
  try {
    c = viewCanvas(g, view, plugin);
    return big ? coverJpeg(c) : smallJpeg(c, VIEW_W, VIEW_H, VIEW_BYTES);
  } catch {
    return undefined;
  } finally {
    if (c) c.width = c.height = 0;
  }
}

/** 地图插件的一张图层:插件长出来的数配上清单里写的样子;没长出来 = null */
function mapPaint(world: World, by: string, l: MapLayerSpec): CellPaint | null {
  const values = world.mapLayers?.find((x) => x.by === by && x.id === l.id)?.values;
  return values ? { values, ...(l.ramp ? { ramp: l.ramp } : {}), ...(l.classes ? { classes: l.classes } : {}), ...(l.opacity !== undefined ? { opacity: l.opacity } : {}) } : null;
}

/** 不带 / 带插件各长一遍(不推历史),截四样图各一对、它的每张图层,再出详情图和封面 */
async function mapShots(seed: number, file: MapPluginFile, m: MapManifest | undefined): Promise<TrialRun['shots']> {
  const shots: TrialRun['shots'] = {};
  const views: NonNullable<TrialRun['shots']['views']> = {};
  const params = { ...DEFAULT_PARAMS, seed };
  let official: World | null = null;
  try {
    const g = await run({ type: 'generate', params, scale: 1, skipCiv: true });
    try {
      official = g.world;
      for (const v of MAP_VIEWS) {
        const s = shotOf(g, v);
        if (s) views[v] = { official: s };
      }
    } finally {
      g.stop();
    }
  } catch {
    // 长不出来就不带
  }
  try {
    const g = await run({ type: 'generate', params, scale: 1, skipCiv: true, mapPlugins: [file] });
    try {
      for (const v of MAP_VIEWS) {
        const s = shotOf(g, v);
        if (s) views[v] = { ...views[v], plugin: s };
      }
      const layers: Record<string, string> = {};
      for (const l of m?.layers ?? []) {
        const paint = mapPaint(g.world, file.id, l);
        const s = paint && shotOf(g, 'terrain', paint);
        if (s) layers[l.id] = s;
      }
      if (Object.keys(layers).length) shots.layers = layers;
      try {
        Object.assign(shots, await mapPictures(params, file, m, official, g));
      } catch {
        // 画不出就交带插件的整张地形图
        const plain = shotOf(g, 'terrain', undefined, true);
        if (plain) shots.map = shots.card = plain;
      }
    } finally {
      g.stop();
    }
  } catch {
    // 同上
  }
  if (Object.keys(views).length) shots.views = views;
  return shots;
}

const bigOf = (world: World, c: HTMLCanvasElement): BigMap => ({ c, s: c.width / world.width, W: world.width, H: world.height });

/** 另长一遍(scale 倍像素,不推历史;file = 带上这个地图插件)画一样图 */
async function mapBig(params: WorldParams, file: MapPluginFile | null, view: MapView, paint: CellPaint | undefined, scale: 1 | 2): Promise<BigMap> {
  const g = await run({ type: 'generate', params, scale, skipCiv: true, ...(file ? { mapPlugins: [file] } : {}) });
  try {
    return bigOf(g.world, viewCanvas(g, view, paint));
  } finally {
    g.stop();
  }
}

/**
 * 地图插件的详情图和封面:有图层的画它清单里最前面那张(盖在带插件的地形图上,只在一小片就放大那一片);
 * 没有图层、改了地形(比地形图)或气候(比降水图)的,放大改得最多的那一片左右比;都没有就画带插件的整张地形图
 */
async function mapPictures(params: WorldParams, file: MapPluginFile, m: MapManifest | undefined, official: World | null, g: Generated): Promise<Pics> {
  const { world } = g;
  const { mesh } = world;
  const W = world.width;
  const H = world.height;
  const layer = firstFilled(m?.layers ?? [], (l) => {
    const p = mapPaint(world, file.id, l);
    return !!p && paintFilled(p);
  });
  if (layer) {
    const paint = mapPaint(world, file.id, layer)!;
    const r = layerWindow(mesh, layer, paint);
    const b = r ? await mapBig(params, file, 'terrain', paint, 2).catch(() => bigOf(world, viewCanvas(g, 'terrain', paint))) : bigOf(world, viewCanvas(g, 'terrain', paint));
    try {
      const legend = legendOf(layer, paint, (c) => inRect(r, mesh.x[c], mesh.y[c], W));
      return picsOf((kind) => drawPicture(kind, { base: { big: b, r }, ...(kind === 'map' ? { legend } : {}) }));
    } finally {
      b.c.width = b.c.height = 0;
    }
  }
  const change = official ? pickChange(m?.stages ?? [], official, world) : null;
  if (change) {
    const { view } = change;
    const r = patchWindow(mesh, change.spots, true);
    const square = compareSquare(r, W, H);
    const halves: HTMLCanvasElement[] = [];
    try {
      for (const f of [null, file]) {
        const b = await mapBig(params, f, view, undefined, r ? 2 : 1);
        halves.push(cropCanvas(b, square, PIC_W / 2, PIC_H));
        b.c.width = b.c.height = 0;
      }
      return picsOf((kind) => drawPicture(kind, { base: { halves: [halves[0], halves[1]] } }));
    } finally {
      for (const h of halves) h.width = h.height = 0;
    }
  }
  const b = bigOf(world, viewCanvas(g, 'terrain'));
  try {
    return picsOf((kind) => drawPicture(kind, { base: { big: b, r: null } }));
  } finally {
    b.c.width = b.c.height = 0;
  }
}

/** 跑完了 = 安静了 TRIAL_QUIET_MS、线程也空着(在算的插件 ping 要等它算完);到了 until 还没完 = false */
async function settle(h: PluginHost, rec: TrialRecorder, until: number): Promise<boolean> {
  while (performance.now() < until) {
    if (h.sandbox.stopped) return true;
    if (performance.now() - rec.last < TRIAL_QUIET_MS) {
      await sleep(50);
      continue;
    }
    const sent = performance.now();
    try {
      await h.sandbox.ping(Math.max(200, until - performance.now()));
    } catch {
      return true;
    }
    const back = performance.now();
    if (back - sent > PING_SLOW_MS) {
      rec.busyUntil(back);
      continue;
    }
    if (back - rec.last >= TRIAL_QUIET_MS) return true;
  }
  return !!h.sandbox.stopped;
}

type Pics = Pick<TrialRun['shots'], 'map' | 'card'>;

/** 详情图、封面各画一张压成 JPEG;画不出的那张拿另一张顶上,两张都画不出 = 都不交 */
function picsOf(draw: (kind: PicKind) => HTMLCanvasElement): Pics {
  const one = (kind: PicKind): string | undefined => {
    let c: HTMLCanvasElement | null = null;
    try {
      c = draw(kind);
      return coverJpeg(c);
    } catch {
      return undefined;
    } finally {
      if (c) c.width = c.height = 0;
    }
  };
  const map = one('map');
  const card = one('card');
  return map || card ? { map: map ?? card, card: card ?? map } : {};
}

/** 按州按年份的图层 year 那年的一份铺到地块上 */
function regionPaint(l: RegionLayer, civ: Civ | null, year: number): CellPaint | null {
  const f = civ ? framePaint(l, year) : null;
  return f && regionsToCells(f, civ!.regions.of);
}

/** year 那年的政区图(盖着 paint);zoomed = 要放大,示例世界按 2 倍像素另长一遍(不推历史,历史用 g 的) */
async function politicalBig(g: Generated, params: WorldParams, year: number, paint: CellPaint | null, zoomed: boolean): Promise<BigMap> {
  if (zoomed && (!g.civ || eraIndex(g.civ, year) === 0)) {
    try {
      const g2 = await run({ type: 'generate', params, scale: 2, skipCiv: true });
      try {
        return bigOf(g.world, await politicalCanvas({ ...g2, civ: g.civ }, year, undefined, paint ?? undefined));
      } finally {
        g2.stop();
      }
    } catch {
      // 2 倍的长不出来就用 1 倍的
    }
  }
  return bigOf(g.world, await politicalCanvas(g, year, undefined, paint ?? undefined));
}

/**
 * 工具插件的详情图和封面:政区图盖上它最后加上的图层;有标注、替它框了一片、(有面板时)替它点了城,放大到这些地方,
 * 没有就照图层放大;有面板贴在右边、看的东西让到它左边。详情图多图例(按州的图层右上角写哪一年)
 */
async function toolPictures(g: Generated, params: WorldParams, year: number, rec: TrialRecorder, panel: PanelPic | null): Promise<Pics> {
  const { world, civ } = g;
  const { mesh } = world;
  const W = world.width;
  const H = world.height;
  const paintOf = (l: CellLayer | RegionLayer): CellPaint | null => (l.kind === 'cells' ? l : regionPaint(l, civ, year));
  const looks = [...rec.layers.values()].filter((l): l is CellLayer | RegionLayer => l.kind !== 'marks');
  const layer = lastFilled(looks, (l) => {
    const p = paintOf(l);
    return !!p && paintFilled(p);
  });
  const paint = layer && paintOf(layer);
  const shown = civ ? year : undefined;
  const marks = rec
    .markLayers()
    .map((l) => ({ ...l, items: l.items.filter((it) => shownAt(it, shown)) }))
    .filter((l) => l.items.length);
  const wx = (x: number) => ((x % W) + W) % W;
  const pts: [number, number][] = [];
  for (const l of marks) {
    for (const it of l.items) {
      if (it.cells) for (const c of it.cells) pts.push([mesh.x[c], mesh.y[c]]);
      else if (it.points) for (let i = 0; i + 1 < it.points.length; i += 2) pts.push([wx(it.points[i]), it.points[i + 1]]);
    }
  }
  const { cities, box } = rec.handed();
  if (box) for (let k = 0; k <= 8; k++) pts.push([wx(box.x0 + ((box.x1 - box.x0) * k) / 8), box.y0], [wx(box.x0 + ((box.x1 - box.x0) * k) / 8), box.y1]);
  const towns = panel ? cities.map((c) => ({ x: mesh.x[c.cell], y: mesh.y[c.cell], name: c.name })) : [];
  for (const t of towns) pts.push([t.x, t.y]);
  const layerRect = !pts.length && layer && paint ? layerWindow(mesh, layer, paint) : null;
  const zoomOf = (kind: PicKind): PicRect | null => {
    const area = panel ? PANEL_AREA[kind] : FULL_AREA;
    if (pts.length) return pointsWindow(pts, W, H, area);
    return layerRect && fitArea(layerRect, W, H, area);
  };
  const zoom: Record<PicKind, PicRect | null> = { map: zoomOf('map'), card: zoomOf('card') };
  const big = await politicalBig(g, params, year, paint, [zoom.map, zoom.card].some((r) => r && r.w < W));
  try {
    const legend = layer && paint ? legendOf(layer, paint, (c) => inRect(zoom.map, mesh.x[c], mesh.y[c], W)) : undefined;
    return picsOf((kind) =>
      drawPicture(kind, {
        base: { big, r: zoom[kind] },
        ...(marks.length ? { marks: { layers: marks, mesh, year: shown } } : {}),
        ...(box ? { box } : {}),
        ...(towns.length && !marks.length ? { tags: towns, tagSize: 's' as const } : {}),
        ...(panel ? { panel } : {}),
        ...(kind === 'map' && legend ? { legend } : {}),
        ...(kind === 'map' && layer?.kind === 'regions' ? { year: yearText(year) } : {}),
      }),
    );
  } finally {
    big.c.width = big.c.height = 0;
  }
}

function iconData(p: OpenedPlugin): string | null {
  const b = p.files.get(PLUGIN_ICON);
  if (!b) return null;
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(s)}`;
}

/** 面板截图里的卡片:和网站上开着的插件卡一样(浅色),只有名字、作者、第几版和它的面板 */
function TrialCard({ p, nodes }: { p: OpenedPlugin; nodes: readonly PanelNode[] }) {
  const m = p.manifest;
  return (
    <section
      className="inspector cpanel"
      data-theme="light"
      style={{ position: 'static', width: PANEL_W, maxWidth: 'none', height: 'auto', maxHeight: 'none', animation: 'none', boxShadow: 'none', backdropFilter: 'none', WebkitBackdropFilter: 'none', background: 'var(--panel-solid)' }}
    >
      <div className="cp plg-card">
        <div className="cp-head">
          <PluginIcon src={iconData(p)} size="md" className="plg-ci" />
          <div className="cp-title">
            <div className="plg-cn">
              <span>{m.name}</span>
              <span className="plg-tag">插件</span>
            </div>
            <span className="cp-sub">
              {m.author?.name ? `${m.author.name} 写的，` : ''}
              {versionLabel(m.version)}
            </span>
          </div>
        </div>
        <div className="cp-body plg-cb" style={{ overflow: 'visible' }}>
          <PanelView nodes={nodes} act={() => {}} />
        </div>
      </div>
    </section>
  );
}

/** 页面上管得着这张卡的样式(去掉悬停这类状态再比;深色、窄屏的不要) */
function cssFor(root: Element): string {
  const els = [root, ...root.querySelectorAll('*')];
  const used = (sel: string) =>
    sel.split(',').some((part) => {
      const s = part
        .replace(/::?(before|after|placeholder|marker|selection|-webkit-[\w-]+)\b/g, '')
        .replace(/:(hover|active|focus|focus-visible|focus-within|visited)\b/g, '')
        .trim();
      try {
        return !s || els.some((e) => e.matches(s));
      } catch {
        return true;
      }
    });
  const out: string[] = [];
  const walk = (rules: CSSRuleList) => {
    for (const r of Array.from(rules)) {
      if (r instanceof CSSStyleRule) {
        if (/:root|data-theme/.test(r.selectorText) || used(r.selectorText)) out.push(r.cssText);
      } else if (r instanceof CSSMediaRule) {
        if (!/prefers-color-scheme:\s*dark/.test(r.conditionText) && matchMedia(r.conditionText).matches) walk(r.cssRules);
      } else if (r instanceof CSSSupportsRule) {
        if (CSS.supports(r.conditionText)) walk(r.cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules);
    } catch {
      // 别的来源的样式表读不了
    }
  }
  return out.join('\n');
}

/** 拷一份卡片:下拉选中哪项、滑块的值这些只在属性(property)上,序列化前写成 HTML 属性 */
function formsAsAttrs(card: HTMLElement): HTMLElement {
  const copy = card.cloneNode(true) as HTMLElement;
  const from = card.querySelectorAll('select, input, textarea');
  const to = copy.querySelectorAll('select, input, textarea');
  from.forEach((el, i) => {
    const c = to[i];
    if (el instanceof HTMLSelectElement) {
      Array.from(el.options).forEach((o, k) => (o.selected ? (c as HTMLSelectElement).options[k].setAttribute('selected', '') : (c as HTMLSelectElement).options[k].removeAttribute('selected')));
    } else if (el instanceof HTMLInputElement) {
      c.setAttribute('value', el.value);
      if (el.checked) c.setAttribute('checked', '');
      else c.removeAttribute('checked');
    } else if (el instanceof HTMLTextAreaElement) {
      c.textContent = el.value;
    }
  });
  return copy;
}

/**
 * 面板截图:照网站自己的插件卡画出来,连同管得着它的样式放进一张 SVG(foreignObject),交回这张图(出图时贴在右边、另压一张给后台)
 */
async function panelPicture(p: OpenedPlugin, nodes: readonly PanelNode[]): Promise<PanelPic> {
  const box = document.createElement('div');
  box.style.cssText = `position:fixed;left:-${PANEL_W * 4}px;top:0;width:${PANEL_W}px;pointer-events:none`;
  document.body.append(box);
  const root = createRoot(box);
  try {
    flushSync(() => root.render(<TrialCard p={p} nodes={nodes} />));
    await document.fonts?.ready;
    const card = box.firstElementChild as HTMLElement;
    const h = Math.min(PANEL_MAX_H, Math.ceil(card.getBoundingClientRect().height));
    const wrap = document.createElement('div');
    wrap.style.cssText = `width:${PANEL_W}px;height:${h}px;overflow:hidden;background:#fff`;
    wrap.append(Object.assign(document.createElement('style'), { textContent: cssFor(card) }), formsAsAttrs(card));
    const xml = new XMLSerializer().serializeToString(wrap);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_W}" height="${h}"><foreignObject x="0" y="0" width="${PANEL_W}" height="${h}">${xml}</foreignObject></svg>`;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    return { img, cssW: PANEL_W, cssH: h };
  } finally {
    root.unmount();
    box.remove();
  }
}

/** 给后台看的面板截图:2 倍像素的 JPEG;浏览器不让这样画(画布被当成别处来的)就抛出,后台写「没截到面板」 */
function panelJpeg(pp: PanelPic): string {
  const c = canvasOf(pp.cssW * 2, pp.cssH * 2);
  const x = ctxOf(c);
  x.fillStyle = '#ffffff';
  x.fillRect(0, 0, c.width, c.height);
  x.scale(2, 2);
  x.drawImage(pp.img, 0, 0, pp.cssW, pp.cssH);
  try {
    for (const q of [0.9, 0.8, 0.7, 0.55]) {
      const url = c.toDataURL('image/jpeg', q);
      if (!url.startsWith('data:image/jpeg')) break;
      if (Math.floor(((url.length - url.indexOf(',') - 1) * 3) / 4) <= PANEL_BYTES) return url;
    }
    throw new Error('面板截图压不到 300 KB 以内');
  } finally {
    c.width = c.height = 0;
  }
}

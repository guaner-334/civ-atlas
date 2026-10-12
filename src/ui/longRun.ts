/**
 * 竖版长图画出来:按选项写内容(longPlan.ts)、排版(render/longImage.ts),每一张疆域图交给 MapShot 按长图里的大小拍
 * (整个世界:字比屏幕上大一点,国名放得下;一国:裁到那一国、描红边,像在手机上放大看那一国),
 * 拼成一整张(或切成 3:4 的几页),压成 JPEG。
 *
 * 拍好的地图按"画法 + 年份 + 哪一国"记住:改标题、大事列不列这类不用重画地图的,预览马上变;
 * 换范围、换画风这类要重拍的,预览上写"正在画疆域图,第几张,共几张"。
 */
import type { ChronicleEntry } from '../gen/civ/chronicle';
import type { Civ } from '../gen/civ/types';
import { fullChronicle } from '../gen/civ/religionText';
import { ownersAt } from '../gen/civ/timeline';
import { fileBaseName } from '../gen/savefile';
import { flagSvg } from '../render/flag/flagSvg';
import { highlightBox } from '../render/civ/highlight';
import { MapShot, type ShotArea, type ShotScene } from '../render/shot';
import { canvasMeasureFont, drawLong, layoutLong, longPages, LONG_W, MAP_W, mapHeight, PAGE_H, PAGE_PAD, type LongLayout } from '../render/longImage';
import type { FilmSource } from './filmSource';
import type { FilmSetup } from './filmRun';
import { filmMajors } from './filmStore';
import { flagOf, getFlags } from './flagStore';
import { currentWorld } from './saveStore';
import { getEdits } from './editsStore';
import { getLong, setLong } from './longStore';
import { defaultPolity, longDoc, longFileName, polityLastYear, type LongDoc, type LongMap } from './longPlan';
import { polityNameAt } from './searchIndex';
import { showToast } from './toastStore';

/** 地图上的样子(和屏幕上一样;filmSetup 给的那几样) */
export type LongLook = Pick<FilmSetup, 'style' | 'layer' | 'show' | 'projection' | 'center' | 'graticule' | 'marks' | 'font'>;

/** 整个世界的图:字放大几倍(960 像素宽的图,字按 740 个 CSS 像素宽的地图排;再放大国名就放不进国土、被挤掉了) */
const WHOLE_DPR = 1.3;
/** 一国的图:字放大几倍、当作缩放 1 倍时地图多宽(手机屏幕 390 CSS 像素),放大到这一国 —— 像在手机上放大看那一国 */
const REGION_DPR = 2.5;
const PHONE_MAP_CSS = 390;

const entriesCache = new WeakMap<Civ, ChronicleEntry[]>();
/** 全部纪事(编年史"全部",含宗教大事;一国版从里面挑) */
function longEntries(full: Civ): ChronicleEntry[] {
  let e = entriesCache.get(full);
  if (!e) entriesCache.set(full, (e = fullChronicle(full)));
  return e;
}

/** 标题默认:整个世界 = 世界名(没起名 = 种子几);一国 = 国名 */
export function longDefaultTitle(full: Civ, seed: number): string {
  const s = getLong();
  const p = s.scope === 'one' ? longPolity(full) : null;
  if (p !== null) return polityNameAt(full.polities[p], polityLastYear(full, full.polities[p]));
  return currentWorld()?.title?.trim() || `种子 ${seed}`;
}

/** 一国版现在是哪一国 */
export function longPolity(full: Civ): number | null {
  const s = getLong();
  return defaultPolity(full, s.polity !== null && s.polity < full.polities.length ? s.polity : null);
}

export function longTitleOf(full: Civ, seed: number): string {
  const t = getLong().title;
  return t ?? longDefaultTitle(full, seed);
}

/** 按现在的选项写长图的内容 */
export function longDocOf(src: FilmSource): LongDoc {
  const full = src.full;
  const s = getLong();
  const seed = src.at(full.endYear).world.params.seed;
  const p = s.scope === 'one' ? longPolity(full) : null;
  return longDoc(full, longEntries(full), filmMajors(full), {
    scope: p !== null ? 'one' : 'world',
    polity: p ?? -1,
    maps: s.maps,
    events: s.events,
    title: longTitleOf(full, seed).trim() || longDefaultTitle(full, seed),
    worldTitle: currentWorld()?.title?.trim() ?? '',
    seed,
    era: getEdits().era,
  });
}

// ---------------------------------------------------------------------------
// 拍地图

/** 一国的图拍哪一块:那一年的国土外框,四周留一点,按 3:2 撑开(太小的城邦至少拍世界的十分之一宽) */
function polityArea(src: FilmSource, m: LongMap): ShotArea {
  const { world, geo } = src.at(m.year);
  const W = world.width;
  const H = world.height;
  const own = m.year >= geo.endYear ? geo.polity : ownersAt(geo, m.year).polity;
  const marks = new Uint8Array(geo.regions.count);
  for (let r = 0; r < marks.length; r++) if (own[r] === m.polity) marks[r] = 1;
  const b = highlightBox(world, geo, marks) ?? [0, 0, W, H];
  const bw0 = (b[2] - b[0]) * 1.24;
  const bh0 = (b[3] - b[1]) * 1.24;
  let bw = Math.max(bw0, bh0 * 1.5, W / 10);
  let bh = bw / 1.5;
  if (bh > H) {
    bh = H;
    bw = bh * 1.5;
  }
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  let x0 = cx - bw / 2;
  const y0 = Math.min(Math.max(0, cy - bh / 2), H - bh);
  while (x0 < 0) x0 += W;
  while (x0 >= W) x0 -= W;
  const k = Math.max(1, MAP_W / REGION_DPR / ((bw / W) * PHONE_MAP_CSS));
  return { kind: 'region', x0, y0, x1: x0 + bw, y1: y0 + bh, k, mapCss: PHONE_MAP_CSS, mp: null };
}

const mapCache = new Map<string, HTMLCanvasElement>();
let mapCacheLook = '';

const mapKey = (m: LongMap) => `${m.year}|${m.polity ?? ''}`;

function sceneOf(src: FilmSource, look: LongLook, year: number): ShotScene {
  const sc = src.at(year);
  return {
    world: sc.world,
    raster: sc.raster,
    civ: sc.civ,
    geo: sc.geo,
    style: look.style,
    layer: look.layer,
    show: look.show,
    projection: look.projection,
    center: look.center,
    graticule: look.graticule,
    marks: look.marks ? (y) => look.marks!(sc.civ, sc.world, y) : undefined,
  };
}

/** 拍一张(整个世界 / 一国) */
async function shoot(src: FilmSource, look: LongLook, m: LongMap): Promise<HTMLCanvasElement> {
  const w = MAP_W;
  const h = mapHeight(m);
  const area: ShotArea = m.polity === undefined ? { kind: 'whole', dpr: WHOLE_DPR } : polityArea(src, m);
  const shot = new MapShot(sceneOf(src, look, m.year), area, w, h);
  try {
    await shot.prepare();
    const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
    await shot.draw(cv.getContext('2d')!, m.year, { sel: m.polity });
    return cv;
  } finally {
    shot.dispose();
  }
}

/** 一国版的国旗(那一国最后一年的那一面) */
async function flagImg(doc: LongDoc): Promise<HTMLImageElement | null> {
  if (!doc.flag) return null;
  const e = flagOf(getFlags(), doc.flag.polity, doc.flag.year);
  if (!e) return null;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(flagSvg(e.spec, { display: 132, px: 264 }))}`;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 画好的长图

export interface LongResult {
  lay: LongLayout;
  /** 一整张(切成几张时不画,省一大块内存 = null) */
  canvas: HTMLCanvasElement | null;
  /** 切成 3:4 时每一页在长图上的 [起, 止);一整张 = null */
  pages: [number, number][] | null;
  /** 切开的每一页 */
  pageCanvases: HTMLCanvasElement[];
  /** 压好的 JPEG(还在压 = null) */
  blobs: Blob[] | null;
  /** 文件名(不带 .jpg 的前半截) */
  base: string;
}

let result: LongResult | null = null;
export const longResult = () => result;

let gen = 0;
let encodeTimer = 0;

const measureCtx = () => Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d')!;

/** 等浏览器把画面画出来一次(拍地图很费时,不等的话"正在画第几张"可能一直显示不出来) */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      setTimeout(resolve, 0);
    };
    requestAnimationFrame(go);
    setTimeout(go, 100);
  });
}

/**
 * 按现在的选项画长图:先拍没拍过的地图(预览上写画到第几张),再拼起来、压成 JPEG。
 * 选项又变了,前一次没画完的不画了(拍好了的地图留着下次用)。lookKey = 地图画法的指纹(换了就全部重拍;
 * 里面有 FilmSource 是哪一份,各段的主图铺好时换了一份,也全部重拍)
 */
export async function renderLong(src: FilmSource, look: LongLook, lookKey: string): Promise<void> {
  const my = ++gen;
  // 选项变了:上一次的图先不能存(新的画好、压好以前,存下来的会是旧选项的那一张)
  window.clearTimeout(encodeTimer);
  if (result?.blobs) {
    result.blobs = null;
    setLong({ ver: getLong().ver + 1 });
  }
  try {
    await renderLongRun(my, src, look, lookKey);
  } catch (e) {
    // 画不出来(图太大、内存不够):去掉"正在画"的蒙层和旧的图(选项已经不是那一份了),说一声
    if (my !== gen) return;
    freeResult();
    setLong({ busy: null, ver: getLong().ver + 1 });
    showToast({ id: 'long', kind: 'error', text: '长图没画出来', more: ['可以换个选项再试一次'] });
    throw e;
  }
}

function freeResult() {
  if (result) {
    if (result.canvas) result.canvas.width = result.canvas.height = 0;
    for (const c of result.pageCanvases) c.width = c.height = 0;
  }
  result = null;
}

async function renderLongRun(my: number, src: FilmSource, look: LongLook, lookKey: string): Promise<void> {
  if (lookKey !== mapCacheLook) {
    for (const c of mapCache.values()) c.width = c.height = 0;
    mapCache.clear();
    mapCacheLook = lookKey;
  }
  const doc = longDocOf(src);
  const lay = layoutLong(doc, canvasMeasureFont(measureCtx(), look.font));
  const todo = lay.maps.filter((m, i) => !mapCache.has(mapKey(m)) && lay.maps.findIndex((x) => mapKey(x) === mapKey(m)) === i);
  if (todo.length) setLong({ busy: { done: 0, total: todo.length } });
  // 有地形大事的世界:各段的主图还在后台铺,先不拍(铺好时换一份新的 FilmSource,预览那边会再叫一次)
  if (!src.ready) return;
  for (let i = 0; i < todo.length; i++) {
    if (my !== gen) return;
    setLong({ busy: { done: i, total: todo.length } });
    // 让出一下,等屏幕画过一帧(预览上的字先换过来);页面在后台时不等画面,最多等 0.1 秒
    await nextPaint();
    if (my !== gen) return;
    const cv = await shoot(src, look, todo[i]);
    if (lookKey === mapCacheLook) mapCache.set(mapKey(todo[i]), cv);
  }
  const flag = await flagImg(doc);
  if (my !== gen) return;
  const maps = lay.maps.map((m) => mapCache.get(mapKey(m)) ?? null);
  const split = getLong().split;
  const pages = split ? longPages(lay) : null;
  let canvas: HTMLCanvasElement | null = null;
  if (!pages) {
    canvas = Object.assign(document.createElement('canvas'), { width: LONG_W, height: lay.h });
    drawLong(canvas.getContext('2d')!, lay, look.font, maps, flag);
  }
  const pageCanvases = (pages ?? []).map(([a, b], i) => {
    const c = Object.assign(document.createElement('canvas'), { width: LONG_W, height: PAGE_H });
    drawLong(c.getContext('2d')!, lay, look.font, maps, flag, a, b, i ? PAGE_PAD : 0);
    return c;
  });
  freeResult();
  const base = fileBaseName({ title: doc.title, seed: src.at(src.full.endYear).world.params.seed });
  result = { lay, canvas, pages, pageCanvases, blobs: null, base };
  setLong({ busy: null, ver: getLong().ver + 1 });
  // 压成 JPEG(打字改标题时等停下来再压)
  window.clearTimeout(encodeTimer);
  const r = result;
  encodeTimer = window.setTimeout(() => {
    void encode(r).then((blobs) => {
      if (result !== r || my !== gen) return;
      // 浏览器压不出来(图太大、内存不够):和画不出来一样提示,不然「保存」一直灰着
      if (!blobs) {
        showToast({ id: 'long', kind: 'error', text: '长图没画出来', more: ['可以换个选项再试一次'] });
        return;
      }
      r.blobs = blobs;
      setLong({ ver: getLong().ver + 1 });
    });
  }, 300);
}

const toJpeg = (c: HTMLCanvasElement) => new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.9));

async function encode(r: LongResult): Promise<Blob[] | null> {
  const list = r.canvas ? [r.canvas] : r.pageCanvases;
  const out: Blob[] = [];
  for (const c of list) {
    const b = await toJpeg(c);
    if (!b || result !== r) return null;
    out.push(b);
  }
  return out;
}

/** 换世界、关掉面板:画好的图放掉 */
export function disposeLong() {
  gen++;
  window.clearTimeout(encodeTimer);
  freeResult();
  for (const c of mapCache.values()) c.width = c.height = 0;
  mapCache.clear();
  mapCacheLook = '';
}

// ---------------------------------------------------------------------------
// 保存

export interface LongFile {
  file: File;
  name: string;
}

/** 要保存的文件(还没压好 = null) */
export function longFiles(): LongFile[] | null {
  const r = result;
  if (!r?.blobs) return null;
  const many = r.blobs.length > 1;
  return r.blobs.map((b, i) => {
    const name = longFileName(r.base, many ? i + 1 : undefined);
    return { file: new File([b], name, { type: 'image/jpeg' }), name };
  });
}

/** 文件大小:"约 2.5 MB"(还没压好 = '') */
export function longSizeText(): string {
  const r = result;
  if (!r?.blobs) return '';
  const mb = r.blobs.reduce((s, b) => s + b.size, 0) / 1e6;
  return `约 ${mb >= 10 ? Math.round(mb) : Math.max(0.1, Math.round(mb * 10) / 10)} MB`;
}

/** 手机上能走分享菜单(存进相册)吗 */
export function canShareLong(files: readonly LongFile[]): boolean {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  return typeof nav.share === 'function' && !!nav.canShare?.({ files: files.map((f) => f.file) });
}

/** 手机:分享菜单(要在点按钮的那一下里调) */
export function shareLong(files: readonly LongFile[]) {
  void navigator.share({ files: files.map((f) => f.file) }).catch(() => {});
}

/** 下载(切开的一张一张下,隔一会儿,浏览器才不会只下第一张) */
export async function downloadLong(files: readonly LongFile[]) {
  for (let i = 0; i < files.length; i++) {
    if (i) await new Promise((r) => setTimeout(r, 250));
    const url = URL.createObjectURL(files[i].file);
    const a = Object.assign(document.createElement('a'), { href: url, download: files[i].name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
  const r = result;
  if (files.length > 1) {
    const last = files.length;
    showToast({ id: 'long', kind: 'ok', text: `已导出 ${last} 张图片`, more: [`${files[0].name} 到 -${last}.jpg`] });
  } else if (r) {
    showToast({ id: 'long', kind: 'ok', text: `已导出 ${files[0].name}`, more: [`${LONG_W}×${r.lay.h}，${longSizeText().replace('约 ', '')}`] });
  }
}

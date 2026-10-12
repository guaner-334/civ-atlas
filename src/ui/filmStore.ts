/**
 * 回放导出(视频、竖版长图)的面板状态:开着哪一个、选项、正在导出到哪一帧。
 * 导出菜单里点「回放视频」「竖版长图」打开,左边面板(手机:底部卡片)换成导出的选项,地图上压暗、出预览或框。
 * 视频导出本身(一帧一帧画、编码、下载)也在这里跑:面板、地图上的预览、时间轴都读同一份状态。
 */
import { useSyncExternalStore } from 'react';
import type { Civ } from '../gen/civ/types';
import { filterChronicle, type ChronicleEntry } from '../gen/civ/chronicle';
import { fullChronicle } from '../gen/civ/religionText';
import { fileBaseName } from '../gen/savefile';
import type { CivStyle } from '../render/civ/overlay';
import type { LayerId } from '../render/layers';
import { clearSelection, getCivShow, getCivTime, getSelection, setCivTime } from './civView';
import { getEdits } from './editsStore';
import { markItemsAt } from './markInfo';
import { getMapCenter, xOfLon } from './mapWrap';
import { flatProjection, getGraticule, getProjection } from './projection';
import { wrapOf } from '../render/common';
import { currentWorld } from './saveStore';
import { getGlobeOn, setGlobeOn } from './Globe';
import { showToast } from './toastStore';
import { openLong } from './longStore';
import { getFilmSource, getFilmViewport, whenFilmReady, type FilmSource } from './filmSource';
import { FilmRenderer, type FilmRegion, type FilmSetup } from './filmRun';
import { FilmCancelled, encodeFilm } from './filmEncode';
import { clampRange, filmClock, filmFileName, filmRanges, filmSize, frameYear, type FilmArea, type FilmRange, type FilmSeconds, type FilmShape } from './filmPlan';

export type FilmMode = 'video' | 'long';

export interface FilmRun {
  /** 画到第几帧、一共几帧、正在画哪一年 */
  f: number;
  frames: number;
  year: number;
  /** 开始的时间(performance.now) */
  t0: number;
}

export interface FilmUi {
  mode: FilmMode | null;
  /** 手机上打开的(默认竖屏) */
  phone: boolean;
  shape: FilmShape;
  area: FilmArea;
  /** 年份:两个快捷之一,或者拖时间轴把手选的 */
  rangeKind: 'polities' | 'all' | 'custom';
  range: FilmRange | null;
  seconds: FilmSeconds;
  captions: boolean;
  cards: boolean;
  /** 标题:null = 用世界名 */
  title: string | null;
  run: FilmRun | null;
  /** 手机:底部卡片多高(像素;地图上的预览按它让位置) */
  sheetH: number;
}

const INIT: FilmUi = {
  mode: null,
  phone: false,
  shape: 'land',
  area: 'whole',
  rangeKind: 'polities',
  range: null,
  seconds: 60,
  captions: true,
  cards: true,
  title: null,
  run: null,
  sheetH: 0,
};

let state: FilmUi = INIT;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const getFilm = () => state;

export function setFilm(patch: Partial<FilmUi>) {
  state = { ...state, ...patch };
  emit();
}

export function useFilm(): FilmUi {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

/** 打开视频 / 长图面板:停下播放;地球仪开着时先切回平面地图(视频按平面地图拍)。长图:地图上选中了一国,范围默认是那一国 */
export function openFilm(mode: FilmMode, phone: boolean) {
  // 正在导出视频:不换面板(要换先取消)
  if (state.run) return;
  setCivTime({ playing: false, story: false });
  const sel = getSelection().sel;
  if (mode === 'long') openLong(sel?.kind === 'polity' ? sel.id : null);
  clearSelection();
  if (mode === 'video' && getGlobeOn()) setGlobeOn(false);
  state = { ...state, mode, phone, shape: phone ? 'port' : 'land', run: null };
  emit();
  // 时间轴移到选的那一段里
  const src = getFilmSource();
  if (src && mode === 'video') {
    const r = filmRangeOf(src.full);
    const y = getCivTime().year ?? src.full.endYear;
    if (y < r.from || y > r.to) setCivTime({ year: r.to });
  }
}

/** 关掉面板;正在导出就取消(run 留到那一次真停下来才清,在这之前不能再开一次) */
export function closeFilm() {
  if (state.run) cancelFilm();
  state = { ...state, mode: null };
  emit();
}

/** 现在选的年份(快捷 / 拖出来的) */
export function filmRangeOf(civ: Pick<Civ, 'polities' | 'endYear'>): FilmRange {
  const r = filmRanges(civ);
  if (state.rangeKind === 'all') return r.all;
  if (state.rangeKind === 'custom' && state.range) return clampRange(state.range, civ.endYear);
  return r.polities;
}

/** 拖时间轴把手:选一段年份 */
export function setFilmRange(r: FilmRange, end: number) {
  setFilm({ rangeKind: 'custom', range: clampRange(r, end) });
}

/** 标题:没改过 = 世界名 */
export function filmTitleOf(): string {
  return state.title ?? currentWorld()?.title?.trim() ?? '';
}

/** 字幕用的大事(编年史"大事",和导出编年史一样) */
const majorsCache = new WeakMap<Civ, ChronicleEntry[]>();
export function filmMajors(full: Civ): ChronicleEntry[] {
  let m = majorsCache.get(full);
  if (!m) majorsCache.set(full, (m = filterChronicle(fullChronicle(full), { major: true })));
  return m;
}

/** 界面字体(CSS 变量 --font-sans) */
export function uiFont(): string {
  const f = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() : '';
  return f || "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif";
}

/** 按现在的选项和屏幕上的样子(画风、图层、地名开关、投影)组一份 FilmSetup */
export function filmSetup(src: FilmSource, look: { style: CivStyle; layer: LayerId }, region?: FilmRegion): FilmSetup {
  const s = state;
  const sc = src.at(src.full.endYear);
  const world = sc.world;
  const marks = getEdits().marks;
  return {
    shape: s.shape,
    area: s.area,
    range: filmRangeOf(src.full),
    seconds: s.seconds,
    captions: s.captions,
    cards: s.cards,
    title: filmTitleOf(),
    style: look.style,
    layer: look.layer,
    show: { ...getCivShow() },
    projection: flatProjection(getProjection()),
    center: wrapOf(world) ? xOfLon(getMapCenter(), world.width) : undefined,
    graticule: getGraticule(),
    marks: marks?.length ? (civ, w, y) => markItemsAt(civ, w, marks, y) : undefined,
    region: s.area === 'region' ? region : undefined,
    font: uiFont(),
  };
}

// ---------------------------------------------------------------------------
// 拍框里一块:框(地图那一块)在页面上的位置 → 地图上的范围

let hole: { left: number; top: number; right: number; bottom: number } | null = null;

/** 地图上的框(FilmStage.tsx)报告它框住地图的那一块在页面上的位置 */
export function setFilmHole(r: typeof hole) {
  hole = r;
}

/** 框住的那一块在地图上是哪儿(地图还没摆好 = undefined) */
export function holeRegion(): FilmRegion | undefined {
  const v = getFilmViewport();
  if (!v || !hole || hole.right - hole.left < 2) return undefined;
  let [x0, y0] = v.plane(hole.left, hole.top);
  let [x1, y1] = v.plane(hole.right, hole.bottom);
  if (![x0, y0, x1, y1].every(Number.isFinite)) return undefined;
  // 等距圆柱:框伸出世界左边时挪一整圈(世界东西相连)
  if (!v.mp && x0 < 0) {
    const n = Math.ceil(-x0 / v.worldW);
    x0 += n * v.worldW;
    x1 += n * v.worldW;
  }
  return { x0, y0, x1, y1, k: v.k, mapCss: v.mapCss, mp: v.mp };
}

// ---------------------------------------------------------------------------
// 导出

let cancelled = false;
/** 导出时画好的那一帧(地图上的预览照着它画) */
let liveCanvas: HTMLCanvasElement | null = null;
export const filmLiveCanvas = () => liveCanvas;

export function cancelFilm() {
  cancelled = true;
}

/** 等各段的主图铺好;中途点了取消就不等了(交回 null) */
function readyOrCancelled(): Promise<FilmSource | null> {
  return new Promise((resolve) => {
    const t = window.setInterval(() => {
      if (!cancelled) return;
      window.clearInterval(t);
      resolve(null);
    }, 100);
    void whenFilmReady().then((s) => {
      window.clearInterval(t);
      resolve(s);
    });
  });
}

/** "还要约 20 秒""还要约 3 分钟" */
export function etaText(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `还要约 ${s < 10 ? s : Math.round(s / 5) * 5} 秒`;
  return `还要约 ${Math.round(s / 60)} 分钟`;
}

/** "用时 4 分 10 秒" */
export function tookText(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `用时 ${s} 秒` : `用时 ${Math.floor(s / 60)} 分${s % 60 ? ` ${s % 60} 秒` : '钟'}`;
}

export interface FilmDone {
  blob: Blob;
  name: string;
  w: number;
  h: number;
  ms: number;
}

/** 导出视频:一帧一帧画、编码;做好了给文件(下载 / 分享由调用方做)。取消了给 null */
export async function runFilm(src0: FilmSource, setup: FilmSetup): Promise<FilmDone | null> {
  if (state.run) return null;
  cancelled = false;
  const t0 = performance.now();
  const frames = filmClock(setup.range, setup.seconds, setup.cards).frames;
  // 取消了:时间轴回到开始导出前停的那一年(已经换到别的世界了就不动)
  const before = getCivTime().year;
  const restore = () => {
    if (getFilmSource()?.full === src0.full) setCivTime({ year: before, playing: false, story: false });
  };
  setFilm({ run: { f: 0, frames, year: setup.range.from, t0 } });
  // 有地形大事的世界:各段的主图还在后台铺的话先等它铺好(不然前面几秒会用旧的地形)
  const src = src0.ready ? src0 : await readyOrCancelled();
  if (!src || cancelled) {
    setFilm({ run: null });
    if (cancelled) restore();
    return null;
  }
  const r = new FilmRenderer(src, setup, filmMajors(src.full));
  const { w, h } = filmSize(setup.shape);
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = cv.getContext('2d', { willReadFrequently: false })!;
  liveCanvas = cv;
  let last = 0;
  let lock: { release(): Promise<void> } | null = null;
  try {
    lock = (await (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen').catch(() => null)) ?? null;
  } catch {
    lock = null;
  }
  try {
    const blob = await encodeFilm({
      canvas: cv,
      frames,
      draw: async (f) => {
        const y = frameYear(r.clock, f);
        await r.draw(ctx, f, y);
        // 面板、时间轴、框里的地图跟着走(太勤了屏幕上的地图重画不过来:约 0.3 秒一次)
        const now = performance.now();
        if (!cancelled && (now - last > 300 || f === frames - 1)) {
          last = now;
          setFilm({ run: { f, frames, year: Math.floor(y), t0 } });
          setCivTime({ year: Math.floor(y), playing: false, story: false });
        }
      },
      cancelled: () => cancelled,
    });
    const base = fileBaseName({ title: setup.title || currentWorld()?.title, seed: src.at(setup.range.to).world.params.seed });
    return { blob, name: filmFileName(base, setup.range, setup.shape), w, h, ms: performance.now() - t0 };
  } catch (e) {
    if (e instanceof FilmCancelled) {
      restore();
      return null;
    }
    throw e;
  } finally {
    r.dispose();
    liveCanvas = null;
    void lock?.release().catch(() => {});
    setFilm({ run: null });
  }
}

/** 做好的文件:手机上能分享的走分享菜单("存到相册"),别的直接下载 */
export function deliverFilm(d: FilmDone, phone: boolean, kind: 'video' | 'image') {
  const mb = d.blob.size / 1e6;
  const size = `${d.w}×${d.h}，${mb >= 5 ? Math.round(mb) : mb.toFixed(1)} MB，${tookText(d.ms)}`;
  const file = typeof File !== 'undefined' ? new File([d.blob], d.name, { type: d.blob.type }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const share = phone && !!file && !!nav.canShare?.({ files: [file] });
  if (share) {
    showToast({
      id: 'film',
      kind: 'ok',
      text: kind === 'video' ? '视频做好了' : '长图画好了',
      more: [size],
      ttl: 0,
      dismissible: true,
      action: { label: '存到相册', primary: true, onClick: () => void navigator.share({ files: [file!] }).catch(() => {}) },
    });
    return;
  }
  downloadBlob(d.blob, d.name);
  showToast({ id: 'film', kind: 'ok', text: `已导出 ${d.name}`, more: [size] });
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

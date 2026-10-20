/**
 * 主图的投影设置(界面状态)+ 把一层画布按投影铺到屏幕上。
 *
 * - getProjection / useProjection / setProjection:主图用哪种投影('equirect' 等距圆柱、'robinson' 罗宾森……,
 *   见 render/projection.ts);'globe' = 3D 地球仪视图(ui/Globe.tsx;平面地图藏在下面、按等距圆柱画,地球仪借它的画布当贴图)。
 *   地图右下角"地球仪 / 平面地图"按钮 = 切到 globe / 切回上一个平面投影(lastFlatProjection)。
 * - 中央经线用 mapWrap.ts 的 getMapCenter / useMapCenter / requestMapCenter(所有投影共用同一个中心):
 *   等距圆柱里拖到哪哪是中心;弯边投影里左右拖动、滑条、"设为中心"改它,整图按新中心重投影。
 * - getGraticule / useGraticule / setGraticule:经纬网图层开没开;getGraticuleStep……:每隔几度;getGraticuleLines:要画的间隔(关着 = 0)。
 * - useMapMoving:弯边投影里正在拖动中心(拖动时国名先按世界坐标拟合的摆法投过去,停下来再按投影后的国土重新拟合)。
 * - ProjLayer:一层"和世界一样大"的画布(地形、文明底图、选中、高亮、回放帧)在弯边投影下的做法 ——
 *   先画在离屏的等距圆柱原图上,再按投影铺到显示的画布上;只改中心时不重画原图,只重铺(几毫秒)。
 *   拖动中心时用它(快);停下来以后地形、文明层按投影重画(presentTerrain、CivLayer:线逐点投影,符号正立),
 *   数据图层、回放帧这样的"面"一直用它。停下来时屏幕上已经是这个中心的整图重投影,按投影重画就在后台分小步备(refine),
 *   备好了一次贴上,不在松手那一下卡住。
 */
import { useSyncExternalStore } from 'react';
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import { GRATICULE_STEPS, type ContourKind } from '../gen/savefile';
import { doubleCanvas, drawProjected, isProjectionId, mapProj, pageColor, type MapProj, type ProjectionId } from '../render/projection';
import { drawTerrainProjected, terrainProjWholeSteps, type DetailStyle } from '../render/detail';
import type { SurfaceLook } from '../render/surface';
import { releaseFantasyProjCaches } from '../render/fantasy';
import { releaseWashScratch } from '../render/civ/territory';
import { cancelDetailJob, detailAsync, detailJobPending, submitDetailJob, type JobStats, type WorkStep } from './detailJobs';

export { pageColor };

/** 主图的投影;'globe' = 3D 地球仪(单独的视图) */
export type MapProjection = ProjectionId | 'globe';

/** 地球仪视图可用("图层与投影"弹层的投影里列"地球仪";网址、存档里的 globe 照样打开) */
export const GLOBE_READY = true;

export function isMapProjection(x: unknown): x is MapProjection {
  return x === 'globe' || isProjectionId(x);
}

/** 平面地图用哪种投影画:地球仪时底下的平面地图按等距圆柱画 */
export function flatProjection(p: MapProjection): ProjectionId {
  return p === 'globe' ? 'equirect' : p;
}

/** 弯边(非等距圆柱)的平面投影:整图重投影、左右拖动改中心 */
export function isCurved(p: MapProjection): p is Exclude<ProjectionId, 'equirect'> {
  return p !== 'equirect' && p !== 'globe';
}

/** 当前投影 + 中心 → 地图平面(弯边投影才有;等距圆柱 = null,照原来的办法画) */
export function curvedProj(p: MapProjection, lon0: number, W: number, H: number): MapProj | null {
  return isCurved(p) ? mapProj(p, lon0, W, H) : null;
}

// ---------------------------------------------------------------------------
// 小 store

function store<T>(init: T) {
  let v = init;
  const subs = new Set<() => void>();
  return {
    get: () => v,
    set: (x: T) => {
      if (Object.is(x, v)) return;
      v = x;
      for (const f of subs) f();
    },
    use: () =>
      useSyncExternalStore(
        (f) => (subs.add(f), () => subs.delete(f)),
        () => v,
        () => v,
      ),
  };
}

const projection = store<MapProjection>('equirect');
export const getProjection = projection.get;
export const useProjection = projection.use;
/** 切到地球仪之前用的平面投影(从地球仪切回平面时回到它) */
let lastFlat: ProjectionId = 'equirect';
/** flat:连"上一个平面投影"一起指定(换回原来的地球仪时,把它原来的平面投影也还原) */
export function setProjection(p: MapProjection, flat?: ProjectionId): void {
  const cur = projection.get();
  if (cur !== 'globe') lastFlat = cur;
  if (flat) lastFlat = flat;
  projection.set(isMapProjection(p) ? p : 'equirect');
}
/** 上一个平面投影(现在就是平面的 = 它自己) */
export function lastFlatProjection(): ProjectionId {
  const cur = projection.get();
  return cur === 'globe' ? lastFlat : cur;
}

/** 经纬网:平面投影和地球仪共用一个开关("图层与投影"弹层、新建世界的"投影"里的"经纬网"改它;网址 grat=1) */
const graticule = store(false);
export const getGraticule = graticule.get;
export const useGraticule = graticule.use;
export const setGraticule = graticule.set;

/** 经纬网每隔几度一条(开关旁边选;网址 grat=10 / 15,30 = grat=1) */
export { GRATICULE_STEPS };
export type GraticuleStep = (typeof GRATICULE_STEPS)[number];
export function isGraticuleStep(x: unknown): x is GraticuleStep {
  return GRATICULE_STEPS.includes(x as GraticuleStep);
}
const gratStep = store<GraticuleStep>(30);
export const getGraticuleStep = gratStep.get;
export const useGraticuleStep = gratStep.use;
export const setGraticuleStep = gratStep.set;

/** 要画的经纬网:开着 = 每隔几度,关着 = 0(画地图、导出、回放都按它) */
export function getGraticuleLines(): number {
  return graticule.get() ? gratStep.get() : 0;
}
export function useGraticuleLines(): number {
  const on = graticule.use();
  const step = gratStep.use();
  return on ? step : 0;
}

/** 等值线:叠哪一种(null = 不画;"图层与投影"弹层里的"等值线"改它;网址 iso=elev / temp / precip) */
const contours = store<ContourKind | null>(null);
export const getContourKind = contours.get;
export const useContourKind = contours.use;
export const setContourKind = contours.set;

const moving = store(false);
export const getMapMoving = moving.get;
export const useMapMoving = moving.use;
export const setMapMoving = moving.set;

// ---------------------------------------------------------------------------
// 一层画布按投影铺到屏幕上

/** 弯边投影时外轮廓外面铺什么颜色(null = 透明) */
export type PageFill = string | null;

export class ProjLayer {
  private src: HTMLCanvasElement | null = null;
  /** 原图是别人的(地形图的缓存):release 时不释放它 */
  private borrowed = false;
  private dbl: HTMLCanvasElement | null = null;
  private dirty = true;
  /** 最近一次铺到显示画布上的投影(同一个投影、原图没变就不重铺) */
  private shown = '';
  /** 在后台按投影重画的那一份(refine):活名、要画成哪一版;画在 back 上 */
  private pend: { owner: string; k: string } | null = null;
  private back: HTMLCanvasElement | null = null;

  /**
   * 离屏的等距圆柱原图(w × h;按需创建,大小变了就换)。
   * keepShown:只是预先备好原图(拖动时再用),显示的画布上按投影重画的那一版照样有效
   */
  source(w: number, h: number, keepShown = false): HTMLCanvasElement {
    let c = this.borrowed ? null : this.src;
    if (!c) {
      c = this.src = document.createElement('canvas');
      this.borrowed = false;
    }
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    if (keepShown) this.dirty = true;
    else this.touch();
    return c;
  }

  /** 用现成的画布当原图(地形图的缓存;换了一张才重新接两份) */
  use(src: HTMLCanvasElement): void {
    if (this.src === src) return;
    if (this.src && !this.borrowed) this.src.width = this.src.height = 0;
    this.src = src;
    this.borrowed = true;
    this.touch();
  }

  /** 原图有了新内容(下次铺时重新接两份) */
  touch(): void {
    this.dirty = true;
    this.shown = '';
  }

  /** 原图在不在(画过没有) */
  has(): boolean {
    return !!this.src && this.src.width > 0;
  }

  /**
   * 按投影铺到显示画布(和原图一样大)上;返回用了多少毫秒。
   * force = false 时,同一个投影、原图没变就不重铺
   */
  present(dst: HTMLCanvasElement, mp: MapProj, fill: PageFill = null, force = false): number {
    // 在备的精画先作废(哪怕这一版不用重铺:拖动、放大时它会占着分帧调度,拖慢别的细节层)
    this.drop();
    const src = this.src;
    if (!src || !src.width) return 0;
    const key = `${mp.key}|${fill}`;
    if (!force && !this.dirty && key === this.shown && dst.width === src.width) return 0;
    const t0 = performance.now();
    if (this.dirty || !this.dbl) {
      this.dbl = doubleCanvas(src, this.dbl ?? document.createElement('canvas'));
      this.dirty = false;
    }
    if (dst.width !== src.width || dst.height !== src.height) {
      dst.width = src.width;
      dst.height = src.height;
    }
    const ctx = dst.getContext('2d');
    if (!ctx) return 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, dst.width, dst.height);
    } else ctx.clearRect(0, 0, dst.width, dst.height);
    drawProjected(ctx, this.dbl, src.width, src.height, mp, dst.width, dst.height);
    this.shown = key;
    return performance.now() - t0;
  }

  /**
   * 按投影重画(不是整图重投影):画布设成 w × h、铺底色,调 draw 画。
   * key 相同、原图没变(没 touch 过)就不重画;之后再 present(整图重投影)会重铺
   */
  redraw(dst: HTMLCanvasElement, w: number, h: number, key: string, fill: PageFill, draw: (ctx: CanvasRenderingContext2D) => void, force = false): number {
    this.drop();
    const k = `redraw|${key}|${fill}`;
    if (!force && k === this.shown && dst.width === w && dst.height === h) return 0;
    const t0 = performance.now();
    if (dst.width !== w || dst.height !== h) {
      dst.width = w;
      dst.height = h;
    }
    const ctx = dst.getContext('2d');
    if (!ctx) return 0;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(0, 0, w, h);
    } else ctx.clearRect(0, 0, w, h);
    draw(ctx);
    this.shown = k;
    return performance.now() - t0;
  }

  /** 显示画布上现在是不是这个投影的整图重投影(拖动时铺的那一版,原图没变过) */
  presenting(mp: MapProj, fill: PageFill = null): boolean {
    return !this.dirty && this.shown === `${mp.key}|${fill}`;
  }

  /**
   * 同 redraw,只是分小步在后台画(ui/detailJobs.ts,owner = 活名):显示画布上先留着现在那一版,
   * steps(ctx) 依次画在藏着的那张上(ctx() 第一次调时把它设成 w × h、铺好底色;这份作废了 = null),
   * 都做完了一次贴到 dst 上 —— 和 redraw 当下画完逐像素一样。同一版已经在备、已经画好了就不再交;
   * 藏着的那张拿不到画笔(手机上画布内存超了)就当下用 draw 画。done = 贴上去以后(贴用了多少毫秒、备料统计)
   */
  refine(
    owner: string,
    dst: HTMLCanvasElement,
    w: number,
    h: number,
    key: string,
    fill: PageFill,
    steps: (ctx: () => CanvasRenderingContext2D | null) => WorkStep[],
    draw: (ctx: CanvasRenderingContext2D) => void,
    done?: (ms: number, st: JobStats) => void,
  ): void {
    const k = `redraw|${key}|${fill}`;
    if (k === this.shown && dst.width === w && dst.height === h) return;
    if (this.pend?.k === k && this.pend.owner === owner && detailJobPending(owner)) return;
    this.drop();
    const pend = (this.pend = { owner, k });
    let ctx: CanvasRenderingContext2D | null = null;
    let failed = false;
    const get = () => {
      if (this.pend !== pend || failed) return null;
      if (ctx) return ctx;
      const b = (this.back ??= document.createElement('canvas'));
      b.width = w;
      b.height = h;
      ctx = b.getContext('2d');
      if (!ctx) {
        failed = true;
        return null;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      if (fill) {
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, w, h);
      } else ctx.clearRect(0, 0, w, h);
      return ctx;
    };
    submitDetailJob(owner, [...steps(get), () => void get()], (st) => {
      if (this.pend !== pend) return;
      this.pend = null;
      const t0 = performance.now();
      const b = this.back;
      if (!ctx || !b) {
        this.redraw(dst, w, h, key, fill, draw, true);
        done?.(performance.now() - t0, st);
        return;
      }
      if (dst.width !== w || dst.height !== h) {
        dst.width = w;
        dst.height = h;
      }
      const d = dst.getContext('2d');
      if (!d) return;
      d.setTransform(1, 0, 0, 1, 0, 0);
      d.globalAlpha = 1;
      d.globalCompositeOperation = 'source-over';
      d.clearRect(0, 0, w, h);
      d.drawImage(b, 0, 0);
      b.width = b.height = 0;
      this.shown = k;
      done?.(performance.now() - t0, st);
    });
  }

  /** 后台在备的那一份(refine)不要了 */
  private drop(): void {
    if (!this.pend) return;
    cancelDetailJob(this.pend.owner);
    this.pend = null;
    if (this.back) this.back.width = this.back.height = 0;
  }

  /** release 时顺带要做的事(地形图那一层:释放按投影重画的缓存,见 presentTerrain) */
  onRelease: (() => void) | null = null;

  /** 释放离屏画布的显存(回到等距圆柱时) */
  release(): void {
    this.drop();
    this.onRelease?.();
    if (this.src && !this.borrowed) this.src.width = this.src.height = 0;
    if (this.dbl) this.dbl.width = this.dbl.height = 0;
    this.src = this.dbl = null;
    this.dirty = true;
    this.shown = '';
  }
}

// ---------------------------------------------------------------------------
// 地形图在弯边投影下怎么画

/**
 * 弯边投影下的地形图(canvas,和世界一样大 = 地图平面):
 * - 手绘 / 写实、没在拖动中心:按投影重画(render/detail.ts 的 drawTerrainProjected)—— 面按行重投影,
 *   海岸墨线、河逐点投影(线宽处处一致),山、树林符号在投影后的位置上正立、按屏幕大小画;
 * - 数据图层,或者正在左右拖动中心:把等距圆柱的整张地形图(src,符号、河都在里面)整图重投影 ——
 *   拖动时每帧只要几毫秒,停下来再按投影重画。
 * layer = 地形图的 ProjLayer(记着原图和画布上现在是哪一版)。返回用了多少毫秒。
 * pre = 已经按投影重画好的这一版(编辑地形后在后台画好的,见 ui/terrainPatch.ts):直接贴上,不用当下再画
 */
export function presentTerrain(
  cv: HTMLCanvasElement,
  mp: MapProj,
  o: { world: World; raster: Raster; style: string; look?: SurfaceLook; src: HTMLCanvasElement; layer: ProjLayer; moving: boolean; pre?: HTMLCanvasElement | null },
): number {
  const { world, raster, style, layer } = o;
  layer.use(o.src);
  layer.onRelease = releaseCurvedCaches;
  if ((style !== 'fantasy' && style !== 'realistic') || o.moving) return layer.present(cv, mp, pageColor(style));
  const fill = pageColor(style);
  const pre = o.pre;
  if (pre && pre.width === raster.w && pre.height === raster.h) return layer.redraw(cv, raster.w, raster.h, mp.key, fill, (ctx) => ctx.drawImage(pre, 0, 0), true);
  const draw = (ctx: CanvasRenderingContext2D) => drawTerrainProjected(ctx, world, raster, style as DetailStyle, mp, { s: raster.scale, ox: 0, oy: 0, k: 1 }, o.look);
  // 刚停下来(屏幕上是这个中心的整图重投影):按投影重画在后台分小步备,备好了贴上
  if (detailAsync && layer.presenting(mp, fill)) {
    const t0 = performance.now();
    layer.refine(PROJ_JOB, cv, raster.w, raster.h, mp.key, fill, (ctx) => terrainProjWholeSteps(ctx, world, raster, style as DetailStyle, mp, o.look), draw, (ms, st) => {
      (window as unknown as { __wfProj?: unknown }).__wfProj = { proj: mp.def.id, lon: mp.lon0, ms, prep: st.prep, slices: st.slices };
    });
    return performance.now() - t0;
  }
  return layer.redraw(cv, raster.w, raster.h, mp.key, fill, draw);
}

/** 地形图停下来以后按投影重画(后台分小步)的活名 */
const PROJ_JOB = 'proj-terrain';

/** 地形图按投影重画还在后台备着(调试字段用) */
export function terrainRefining(): boolean {
  return detailJobPending(PROJ_JOB);
}

/** 回到等距圆柱:按投影重画用的缓存(投影后的符号层、文明层让位遮罩、合成用的草稿画布……)都扔掉 */
function releaseCurvedCaches(): void {
  releaseFantasyProjCaches();
  releaseWashScratch();
}

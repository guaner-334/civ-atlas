/**
 * 拍一张地图:回放导出的视频每一帧、竖版长图里的疆域图都用它。按给定的范围、按输出的像素重新画 —— 不是把屏幕放大。
 *
 *   整张地图(whole):和"地图图片"导出同一套画法(render/export.ts):主图大小的地形、文明底图、经纬网 / 纸边 / 外框罗盘
 *        三层叠好再缩放到输出大小;地名、国名、城镇符号、战线、作者标记按输出大小重新排(地图按 输出宽 / dpr 个 CSS 像素宽显示)。
 *   一块(region):和地图放大以后同一套画法 —— 地形按这一块、这个缩放倍数重画(render/detail.ts),文明底图逐格重新上色
 *        (render/civ/detail.ts),文字按屏幕上的规矩排;范围、缩放倍数取自屏幕上的框,框里看到的就是拍出来的样子,
 *        只是像素多(字、符号、线按 输出宽 / 框的宽 放大)。经纬网开着时也画(和整张地图一样盖在文明底图上)。
 *
 * 地形只画一次(new 的时候),每一帧(draw)只重画文明底图和文字:回放导出一千多帧,地形不变。
 * 地形大事以后世界换了(另一段的 world / raster),另开一个。
 * 只在主线程用:文字要用页面里加载好的字体(画之前 await prepare())。
 */
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import type { Civ, Year } from '../gen/civ/types';
import type { LayerId } from './layers';
import { renderLayer } from './layers';
import type { CivDrawParams, CivShow, CivStyle } from './civ/overlay';
import { drawMapCiv, drawMapDecor, drawMapLabels, drawMapTerrain, drawExportMarks, inkStyle, type ExportMapParams } from './export';
import { DETAIL_K, drawTerrainDetail, drawTerrainProjected } from './detail';
import { detailCache, drawCivDetail, drawSelectionDetail, releaseDetailCache, type DetailCache } from './civ/detail';
import { civLabelChars, civLabelItems, civMapLayer, labelViewExtras } from './civ/labels';
import { drawSettlementMarks } from './civ/settlements';
import { drawWarfare, warsShown } from './civ/warfare';
import { drawHolyDot, holyCities } from './civ/faith';
import { drawPlacedLabels, placeMap, toCanvas, type LabelItem, type LabelView, type Placement } from './labels/draw';
import { ensureFonts } from './labels/fonts';
import { canvasMeasure, drawMarks, layoutMarks, markStyle, placedTextBoxes, type MarkFrame, type MarkItem } from './marks';
import { drawGraticule, labelProjection, projector, reprojectImage, type MapProj, type ProjectionId } from './projection';
import { nearX, wrapOf } from './common';
import type { SurfaceLook } from './surface';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

const makeCanvas = (w: number, h: number): AnyCanvas =>
  typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });

const ctx2d = (c: AnyCanvas) => c.getContext('2d') as CanvasRenderingContext2D;

export interface ShotScene {
  world: World;
  raster: Raster;
  /** 地图文字用的(套过改名) */
  civ: Civ;
  /** 文明底图用的(原始的,只看地理和归属);不给 = civ */
  geo?: Civ;
  style: CivStyle;
  layer: LayerId;
  /** 写实风的画法(不给 = 经典卫星) */
  look?: SurfaceLook;
  show: CivShow;
  /** 整张地图:投影、图片正中的世界 x、经纬网(和屏幕上一样;见 render/export.ts 的 ExportMapParams) */
  projection?: ProjectionId;
  center?: number;
  /** 经纬网每隔几度一条(0 / 不给 = 不画) */
  graticule?: number;
  /** 那一年有的作者标记(几个州的形状算好);不给 = 不画 */
  marks?: (year: number) => readonly MarkItem[];
  /** 无色标记名字里的字(用地图的字体写,和地图文字一起先加载) */
  markChars?: string;
}

/**
 * 拍哪里:
 *   whole —— 整张地图;dpr = 字和符号放大几倍(地图按 输出宽 / dpr 个 CSS 像素宽显示)
 *   region —— 一块:[x0, x1] × [y0, y1] 是世界坐标(等距圆柱;x 可以伸出世界右边,世界东西相连),
 *             弯边投影(mp)时是地图平面坐标;k = 屏幕上的缩放倍数,mapCss = 缩放 1 倍时地图显示多宽(CSS 像素)
 */
export type ShotArea =
  | { kind: 'whole'; dpr: number }
  | { kind: 'region'; x0: number; y0: number; x1: number; y1: number; k: number; mapCss: number; mp?: MapProj | null };

export interface ShotTiming {
  civ: number;
  labels: number;
}

export class MapShot {
  readonly w: number;
  readonly h: number;
  private readonly scene: ShotScene;
  private readonly area: ShotArea;
  /** 地形(整张地图:主图大小;一块:输出大小) */
  private terrain: AnyCanvas | null = null;
  /** 整张地图:经纬网、纸边、外框罗盘(主图大小,透明底) */
  private decor: AnyCanvas | null = null;
  /** 文明底图的草稿(整张地图:主图大小;一块:输出大小) */
  private civC: AnyCanvas | null = null;
  private cache: DetailCache | null = null;
  /** 一块:选中一国的描边(竖版长图的一国版) */
  private selC: AnyCanvas | null = null;
  private selCache: DetailCache | null = null;
  /** 地理名(不随年份变,只算一次) */
  private geoItems: LabelItem[] | null = null;
  private fontsOk = false;

  constructor(scene: ShotScene, area: ShotArea, w: number, h: number) {
    this.scene = scene;
    this.area = area;
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
  }

  /** 世界和文明是同一次生成的(地块数对得上)才画文明层 */
  private get ok(): boolean {
    const g = this.scene.geo ?? this.scene.civ;
    return g.habitat.suitability.length === this.scene.world.mesh.n && this.scene.civ.habitat.suitability.length === this.scene.world.mesh.n;
  }

  /** 先等地图字体加载好(画字前调一次) */
  async prepare(): Promise<void> {
    if (this.fontsOk) return;
    await ensureFonts(this.scene.style, civLabelChars(this.scene.civ) + (this.scene.markChars ?? ''), 15000);
    this.fontsOk = true;
  }

  private params(year: Year, civ: Civ): ExportMapParams {
    const s = this.scene;
    return { world: s.world, raster: s.raster, civ, style: s.style, layer: s.layer, look: s.look, year, show: s.show, center: s.center, projection: s.projection, graticule: s.graticule };
  }

  /** 画布像素 / 世界单位、字放大几倍、画布左上角的世界坐标(一块) */
  private regionView() {
    const a = this.area as Extract<ShotArea, { kind: 'region' }>;
    const s = this.w / (a.x1 - a.x0);
    const dpr = (s * this.scene.world.width) / (a.mapCss * a.k);
    return { s, dpr, ox: -a.x0 * s, oy: -a.y0 * s, k: a.k, mp: a.mp ?? null };
  }

  /** 字放大几倍(画布像素 / CSS 像素) */
  get dpr(): number {
    return this.area.kind === 'whole' ? this.area.dpr : this.regionView().dpr;
  }

  /** 地形(只画一次) */
  private terrainCanvas(): AnyCanvas {
    if (this.terrain) return this.terrain;
    const { world, raster, style, layer, look } = this.scene;
    if (this.area.kind === 'whole') {
      const t = makeCanvas(raster.w, raster.h);
      drawMapTerrain(ctx2d(t), this.params(0, this.scene.civ), makeCanvas);
      const d = makeCanvas(raster.w, raster.h);
      drawMapDecor(ctx2d(d), this.params(0, this.scene.civ));
      this.decor = d;
      return (this.terrain = t);
    }
    const t = makeCanvas(this.w, this.h);
    const ctx = ctx2d(t);
    const v = this.regionView();
    const view = { s: v.s, ox: v.ox, oy: v.oy, k: Math.max(1, v.k) };
    if (this.scene.graticule) {
      const d = makeCanvas(this.w, this.h);
      drawGraticule(ctx2d(d), v.mp, world.width, world.height, view, inkStyle({ style, look }), this.scene.graticule, v.dpr);
      this.decor = d;
    }
    if (v.mp) {
      ctx.fillStyle = style === 'fantasy' ? '#efe2c2' : '#12161c';
      ctx.fillRect(0, 0, this.w, this.h);
      if (style === 'fantasy' || style === 'realistic') drawTerrainProjected(ctx, world, raster, style, v.mp, view, look);
      else {
        const src = makeCanvas(raster.w, raster.h);
        renderLayer(ctx2d(src), world, raster, layer);
        reprojectImage(ctx, src, raster.w, raster.h, v.mp, view, 'medium');
        src.width = src.height = 0;
      }
      return (this.terrain = t);
    }
    // 等距圆柱:这一块可能跨过世界右边(180° 经线),左右两段各画一遍(右段 = 挪一整圈),各自裁在自己那一段里
    const W = world.width;
    const wrap = wrapOf(world);
    const a = this.area as Extract<ShotArea, { kind: 'region' }>;
    const parts: [number, number, number][] = [];
    if (!wrap || a.x1 <= W) parts.push([0, this.w, a.x0 >= W ? W * v.s : 0]);
    else if (a.x0 >= W) parts.push([0, this.w, W * v.s]);
    else {
      const seam = (W - a.x0) * v.s;
      parts.push([0, seam, 0], [seam, this.w, W * v.s]);
    }
    let layerImg: AnyCanvas | null = null;
    for (const [c0, c1, shift] of parts) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(c0, 0, c1 - c0, this.h);
      ctx.clip();
      if (style === 'fantasy' || style === 'realistic') drawTerrainDetail(ctx, world, raster, style, { ...view, ox: view.ox + shift }, true, look);
      else {
        if (!layerImg) {
          layerImg = makeCanvas(raster.w, raster.h);
          renderLayer(ctx2d(layerImg), world, raster, layer);
        }
        const ps = v.s / raster.scale;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(layerImg, view.ox + shift, view.oy, raster.w * ps, raster.h * ps);
      }
      ctx.restore();
    }
    if (layerImg) layerImg.width = layerImg.height = 0;
    return (this.terrain = t);
  }

  /**
   * 画 year 那一年(先清空画布 ctx 的 [0, w] × [0, h])。
   * fast:国名每隔几年才重新拟合、小城不写名字(和屏幕上回放时一样;视频每一帧都换年份,国名不会一直抖)
   */
  async draw(ctx: CanvasRenderingContext2D, year: Year, opt: { fast?: boolean; sel?: number } = {}): Promise<ShotTiming> {
    const timing: ShotTiming = { civ: 0, labels: 0 };
    const terrain = this.terrainCanvas();
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(terrain, 0, 0, this.w, this.h);
    ctx.restore();
    const ok = this.ok;
    const t0 = performance.now();
    if (ok) this.drawCiv(ctx, year, opt.sel);
    if (this.decor) {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(this.decor, 0, 0, this.w, this.h);
      ctx.restore();
    }
    const t1 = performance.now();
    timing.civ = t1 - t0;
    if (ok) {
      await this.prepare();
      if (this.area.kind === 'whole') await this.wholeLabels(ctx, year, !!opt.fast);
      else this.regionLabels(ctx, year, !!opt.fast);
    }
    timing.labels = performance.now() - t1;
    return timing;
  }

  /** 文明底图(国土、国界、道路) */
  private drawCiv(ctx: CanvasRenderingContext2D, year: Year, sel?: number) {
    const { world, raster, style, show } = this.scene;
    const geo = this.scene.geo ?? this.scene.civ;
    if (this.area.kind === 'whole') {
      const c = (this.civC ??= makeCanvas(raster.w, raster.h));
      const cctx = ctx2d(c);
      cctx.clearRect(0, 0, c.width, c.height);
      drawMapCiv(cctx, this.params(year, geo), makeCanvas);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(c, 0, 0, this.w, this.h);
      ctx.restore();
      return;
    }
    const v = this.regionView();
    const c = (this.civC ??= makeCanvas(this.w, this.h));
    this.cache ??= detailCache();
    const params: CivDrawParams = { world, raster, civ: geo, style, year, show };
    // 一个工作格 ≈ 一个 CSS 像素(和屏幕上停着时一样细)
    const step = Math.max(1, Math.round(v.dpr));
    const view = { cw: this.w, ch: this.h, s: v.s, ox: v.ox, oy: v.oy, k: Math.max(1, v.k), mp: v.mp, dpr: v.dpr };
    drawCivDetail(ctx2d(c), params, view, step, this.cache);
    ctx.drawImage(c, 0, 0);
    if (sel === undefined) return;
    // 选中一国:罩染 + 描边,和地图上选中一国一样;线总用红色(手绘画风选中时的颜色),长图里写"红线以内"
    const sc = (this.selC ??= makeCanvas(this.w, this.h));
    this.selCache ??= detailCache();
    drawSelectionDetail(ctx2d(sc), world, raster, geo, { kind: 'polity', id: sel }, year, 'fantasy', view, step, this.selCache);
    ctx.drawImage(sc, 0, 0);
  }

  /** 整张地图的文字、作者标记(和"地图图片"导出同一套,只是按输出大小排) */
  private async wholeLabels(ctx: CanvasRenderingContext2D, year: Year, fast: boolean) {
    const W = this.scene.world.width;
    const px = { s: this.w / W, dpr: this.dpr };
    const p = this.params(year, this.scene.civ);
    const n = await drawMapLabels(ctx, p, 1, { px, fast });
    const items = this.scene.marks?.(Math.floor(year)) ?? [];
    if (items.length) drawExportMarks(ctx, p, 1, items, n.placed, px);
  }

  /** 一块的文字:地理名、国名、城名、城镇符号、战线双剑、圣城圆点、作者标记(和屏幕上的文字层同一套排法) */
  private regionLabels(ctx: CanvasRenderingContext2D, year: Year, fast: boolean) {
    const { world, raster, style, show } = this.scene;
    const civ = this.scene.civ;
    const geo = this.scene.geo ?? civ;
    const v = this.regionView();
    const a = this.area as Extract<ShotArea, { kind: 'region' }>;
    const params: CivDrawParams = { world, raster, civ, style, year, show };
    this.geoItems ??= civLabelItems({ ...params, year: civ.endYear });
    const layer = civMapLayer(params, { fast, proj: v.mp });
    const items = this.geoItems.concat(layer.items);
    const extras = labelViewExtras({ ...params, year: civ.endYear });
    const lv: LabelView = { ...extras, scale: v.s, ox: v.ox, oy: v.oy, dpr: v.dpr, k: Math.max(1, v.k), mapCss: a.mapCss, canvasW: this.w, canvasH: this.h, reserved: [] };
    if (v.mp) {
      lv.proj = labelProjection(v.mp);
      lv.wrap = 0;
      lv.frameLeft = 0;
    } else {
      // 外框(文字不出去)放在这一块的正中,这一块的边上不当作地图的边
      lv.frameLeft = (a.x0 + a.x1) / 2 - world.width / 2;
    }
    const placed: Placement = placeMap(items, layer.marks, lv);
    if (warsShown(params)) drawWarfare(ctx, params, lv, v.mp ? projector(v.mp) : null);
    drawSettlementMarks(ctx, placed.marks, style);
    drawPlacedLabels(ctx, placed.labels, lv);
    if (show.faiths) {
      const cx = (this.w / 2 - lv.ox) / lv.scale;
      for (const hc of holyCities(geo, year, null)) {
        const pm = placed.marks.find((m) => m.mark.id === hc.settlement);
        let x: number;
        let y: number;
        if (pm) [x, y] = [pm.x, pm.y];
        else {
          const c = geo.settlements[hc.settlement].cell;
          [x, y] = v.mp ? toCanvas(lv, world.mesh.x[c], world.mesh.y[c]) : [nearX(world.mesh.x[c], cx, lv.wrap ?? 0) * lv.scale + lv.ox, world.mesh.y[c] * lv.scale + lv.oy];
          if (!Number.isFinite(x) || x < 0 || y < 0 || x > this.w || y > this.h) continue;
        }
        drawHolyDot(ctx, x, y, hc.color, v.dpr);
      }
    }
    const marks = this.scene.marks?.(Math.floor(year)) ?? [];
    if (!marks.length) return;
    // 作者标记:按 CSS 像素排(和屏幕上一样),画的时候放大 dpr 倍
    const d = v.dpr;
    const wrap = wrapOf(world);
    const mp = v.mp;
    const frame: MarkFrame = {
      pt: mp
        ? (wx, wy) => {
            const q = labelProjection(mp).fwd(wx, wy);
            return [(q[0] * v.s + v.ox) / d, (q[1] * v.s + v.oy) / d];
          }
        : (wx, wy) => [(wx * v.s + v.ox) / d, (wy * v.s + v.oy) / d],
      period: mp || !wrap ? 0 : (wrap * v.s) / d,
      win: [0, this.w / d],
      w: this.w / d,
      h: this.h / d,
      k: a.k,
      mapCss: a.mapCss,
      textK: lv.k,
      cut: mp ? (0.4 * world.width * v.s) / d : 0,
    };
    ctx.save();
    ctx.scale(d, d);
    const avoid = placedTextBoxes(placed).map((b) => b.map((x) => x / d));
    const ms = markStyle(style);
    const layout = layoutMarks(marks, frame, { measure: canvasMeasure(ctx), avoid, style: ms });
    drawMarks(ctx, layout, d, ms);
    ctx.restore();
  }

  /** 放掉画布(显存) */
  dispose() {
    for (const c of [this.terrain, this.decor, this.civC, this.selC]) if (c) c.width = c.height = 0;
    for (const k of [this.cache, this.selCache]) if (k) releaseDetailCache(k);
    this.terrain = this.decor = this.civC = this.selC = null;
    this.cache = this.selCache = null;
  }
}

/** 放大到细节层以下时(屏幕上看的是铺进地形图的那一份),一块也按细节层的画法重画:输出像素多,不重画就糊 */
export const SHOT_DETAIL_K = DETAIL_K;

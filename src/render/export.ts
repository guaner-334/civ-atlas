/**
 * 导出(阶段 4):整张地图合成一张图片(不是当前视口),另有图例图片。
 *
 * 分两步,重活放后台线程(src/exportWorker.ts),界面不卡:
 *   1. drawMapBase(后台线程,OffscreenCanvas):地形(当前画风;2× 时用重新铺的两倍像素)+ 文明底图(国土 / 民族色块、国界、道路,
 *      当前时间轴年份、和屏幕上开着的一样)+ 写实风 / 数据图层的外框和罗盘(手绘风的外框、罗盘本来就画在地形里)。
 *   2. drawMapLabels(主线程,要用页面里加载好的字体):地名、国名、城名和城镇符号(还有战事的战线、双剑),按"整图、缩放 1 倍"排版 ——
 *      地图按世界宽(2048 CSS 像素)显示、2× 时像素密度 × 2:2× 和 1× 排出来一模一样,只是更清楚。
 *      排版、避让和屏幕上是同一套(render/labels/draw.ts 的 placeMap),文字之间不重叠、国名落在国土上。
 *      等值线开着时,后台线程把地形和上面两层分成两张交回来;排好字、还没画之前,先在地形上画线(drawExportContours,
 *      数字躲开地名),再叠上文明底图和外框。
 *
 * 图例(drawLegend):数据图层的色阶 / 色块(和屏幕上同一份内容),或国家 / 民族列表 + 颜色(和世界概览的国家页一样按当年的州数排;信仰图层再列信仰)、道路和城镇符号,和地图用同一套字体与配色。
 * 数据图层的地图图片左上角还压一条连续色阶(drawMapLegend)。
 *
 * 投影(和屏幕上一样):等距圆柱按当前中心左右转;弯边投影(罗宾森、摩尔威德……)按投影重画(和屏幕上停着时一样:
 * 面按行重投影,海岸、河、国界、道路逐点投影,符号正立,见 drawMapTerrain),外框换成投影轮廓、罗盘在轮廓外的左下角,
 * 文字按投影排。经纬网开着时也画上。
 */
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import type { Civ, Year } from '../gen/civ/types';
import { renderRealistic } from './realistic';
import type { SurfaceLook } from './surface';
import { drawFrame, drawPaperVignette, renderFantasy } from './fantasy';
import { bakedView, wrapOf } from './common';
import { renderLayer, type LayerId } from './layers';
import { dataLegend, dataLegendText, isGradientLegend, type DataLegend, type GradientLegend } from './dataLegend';
import { drawCivOverlay, type CivShow, type CivStyle } from './civ/overlay';
import { RESOURCE_COLORS, drawResourceLayer, resourceTier, type ResourceLook } from './civ/resources';
import { ERA_COLORS, eraLevelsAt, eraName } from './civ/era';
import { CONTROL_COLORS, controlTiersAt } from './civ/control';
import { CONTROL_TIERS } from '../gen/civ/control';
import { RESOURCES, RESOURCE_COUNT, resourcesAt } from '../gen/civ/development';
import { civLabelChars, civLabelItems, civMapLayer, labelViewExtras } from './civ/labels';
import { drawSettlementMarks, SYMBOL_BOX, SYMBOL_GROW, type SettlementKind } from './civ/settlements';
import { drawWarfare, warsShown } from './civ/warfare';
import { REF_MAP_CSS, drawPlacedLabels, placeMap, type LabelMark, type LabelView, type PlacedMark, type Placement } from './labels/draw';
import { ensureFonts, familyFor, fontCss } from './labels/fonts';
import { capitalAt, polityAlive, polityName } from '../gen/civ/growth';
import { ownersAt } from '../gen/civ/timeline';
import { KIND_INFO, cultureLabel } from '../gen/civ/display';
import { faithRows } from '../gen/civ/religionText';
import { yearFull, type Era } from '../gen/era';
import { drawGraticule, labelProjection, mapProj, outlineOnCanvas, pageColor, projectWorld, projector, reprojectImage, type MapProj, type ProjectionId } from './projection';
import { NAME_ZOOM, canvasMeasure, drawMarks, layoutMarks, markStyle, placedTextBoxes, type MarkFrame, type MarkItem } from './marks';
import { drawTerrainProjected } from './detail';
import { drawTrail, layoutTrail, type TrailInput } from './trail';
import { compassSpot, drawProjFrame } from './fantasy';
import { drawContours, type ContourSet } from './contours';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export type ExportScale = 1 | 2;

/** 地图图片的格式:PNG 无损;JPEG 有损、没有透明,文件小好几倍(2× 手绘 PNG 约 16 MB → JPEG 约 1.9 MB),方便贴帖子 */
export type ImageFormat = 'png' | 'jpeg';

/** JPEG 质量:0.9 时墨线、文字边缘看不出块状杂色 */
export const JPEG_QUALITY = 0.9;

export const IMAGE_FORMATS: Record<ImageFormat, { mime: string; ext: string; quality?: number }> = {
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', quality: JPEG_QUALITY },
};

export interface ExportMapParams {
  world: World;
  /** 铺好的像素;drawMapBase 按它的大小画(2× 时是两倍像素的那张) */
  raster: Raster;
  civ: Civ | null;
  style: CivStyle;
  layer: LayerId;
  /** 写实风的画法(不给 = 经典卫星) */
  look?: SurfaceLook;
  /** 画哪一年(时间轴当前的年份) */
  year: Year;
  show: CivShow;
  /**
   * 图片正中是哪条经线(世界 x,和屏幕上当前视图的中心一样);左右边 = 它 ± 180°。
   * 不给 = 主图原样(正中是 0° 经线)
   */
  center?: number;
  /** 投影(和屏幕上一样);不给 / 'equirect' = 等距圆柱 */
  projection?: ProjectionId;
  /** 经纬网每隔几度一条(0 / 不给 = 不画) */
  graticule?: number;
  /** 物产图层:只看哪一样、画不画还没发现的(和屏幕上一样;不给 = 全部显示) */
  res?: ResourceLook;
  /** 数据图层在地图角上带不带色阶;不给 = 带(回放、长图用的整图不带) */
  legend?: boolean;
}

/** 弯边投影:图片按哪种投影、哪条中央经线画(等距圆柱 = null) */
export function exportProj(p: Pick<ExportMapParams, 'world' | 'center' | 'projection'>): MapProj | null {
  if (!p.projection || p.projection === 'equirect') return null;
  const W = p.world.width;
  const lon0 = p.center === undefined ? 0 : (p.center / W) * 360 - 180;
  return mapProj(p.projection, lon0, W, p.world.height);
}

/** 导出时图片左边的世界 x(= 中心 − 半圈);没给中心 = 0 */
export function exportLeft(p: Pick<ExportMapParams, 'world' | 'center'>): number {
  const W = wrapOf(p.world);
  if (p.center === undefined) return 0;
  const l = p.center - W / 2;
  return l - W * Math.floor(l / W);
}

/** 世界和文明是同一次生成的(地块数对得上)才画文明层 */
function civOk(p: ExportMapParams): p is ExportMapParams & { civ: Civ } {
  return !!p.civ && p.civ.habitat.suitability.length === p.world.mesh.n;
}

// ---------------------------------------------------------------------------
// 1. 底图(后台线程)

/** 写实风 / 数据图层导出时加的罗盘:中心、半径(世界单位,和手绘风的罗盘同一个位置,见 fantasy.ts 的 drawFrame) */
const COMPASS = { x: 95, dy: 95, r: 40 };

/** 导出时文字要让开的区域(世界坐标):手绘风的罗盘 labelViewExtras 已经算了,这里补写实风 / 数据图层加的罗盘。left = 图片左边的世界 x */
export function exportReserved(style: CivStyle, worldH: number, left = 0): [number, number, number, number][] {
  if (style === 'fantasy') return [];
  const { x, dy, r } = COMPASS;
  return [[left + x - r - 12, worldH - dy - r - 22, left + x + r + 12, worldH - dy + r + 12]];
}

/** 地形 + 文明底图 + 外框罗盘,画在和 raster 一样大的画布上(后台线程和主线程都能用) */
export function drawMapBase(ctx: Ctx2D, p: ExportMapParams, makeCanvas: (w: number, h: number) => OffscreenCanvas | HTMLCanvasElement): void {
  drawMapTerrain(ctx, p, makeCanvas);
  drawMapOverlay(ctx, p, makeCanvas);
}

/**
 * 地形上面的两层(文明底图、经纬网和外框罗盘),也能画在一张透明画布上:
 * 导出带等值线时地形和它们分开交回主线程,线夹在中间(和屏幕上一样压在国界、道路底下)
 */
export function drawMapOverlay(ctx: Ctx2D, p: ExportMapParams, makeCanvas: (w: number, h: number) => OffscreenCanvas | HTMLCanvasElement): void {
  drawMapCiv(ctx, p, makeCanvas);
  drawMapDecor(ctx, p);
}

/**
 * 底图的第一层:地形(当前画风;等距圆柱按中心左右转好;弯边投影:轮廓外铺底色,面按行重投影,海岸、河逐点投影,符号正立)。
 * 和下面两层分开画,回放导出时地形只画一次、每一帧只重画文明底图
 */
export function drawMapTerrain(ctx: Ctx2D, p: ExportMapParams, makeCanvas: (w: number, h: number) => OffscreenCanvas | HTMLCanvasElement): void {
  const { world, raster, style } = p;
  const c2d = ctx as CanvasRenderingContext2D;
  const mp = exportProj(p);
  if (mp) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = pageColor(style);
    ctx.fillRect(0, 0, raster.w, raster.h);
    if (style === 'fantasy' || style === 'realistic') drawTerrainProjected(c2d, world, raster, style, mp, { s: raster.scale, ox: 0, oy: 0, k: 1 }, p.look);
    else {
      const src = makeCanvas(raster.w, raster.h);
      renderLayer(src.getContext('2d') as CanvasRenderingContext2D, world, raster, p.layer);
      reprojectImage(c2d, src, raster.w, raster.h, mp, { s: raster.scale, ox: 0, oy: 0 });
      src.width = src.height = 0;
    }
    ctx.restore();
    return;
  }
  if (style === 'realistic') renderRealistic(c2d, world, raster, p.look);
  else if (style === 'fantasy') renderFantasy(c2d, world, raster);
  else renderLayer(c2d, world, raster, p.layer);
  rotateToCenter(ctx, p, makeCanvas);
}

/**
 * 底图的第二层:文明底图(国土 / 民族色块、国界、道路;p.year 那一年),叠在地形上。
 * 先画在单独一张透明画布上(drawCivOverlay 会清空整张画布),再贴上去 —— 和屏幕上两张画布叠起来一样;
 * 等距圆柱按中心左右转(和地形转得一样),弯边投影按投影画。世界和文明对不上时不画
 */
export function drawMapCiv(ctx: Ctx2D, p: ExportMapParams, makeCanvas: (w: number, h: number) => OffscreenCanvas | HTMLCanvasElement): void {
  if (!civOk(p)) return;
  const { world, raster, style } = p;
  const mp = exportProj(p);
  const cv = makeCanvas(raster.w, raster.h);
  const octx = cv.getContext('2d') as CanvasRenderingContext2D;
  drawCivOverlay(octx, { world, raster, civ: p.civ, style, year: p.year, show: p.show, proj: mp ? projector(mp) : undefined });
  if (!mp) rotateToCenter(octx, p, makeCanvas);
  ctx.drawImage(cv, 0, 0);
  cv.width = cv.height = 0;
}

/** 经纬网、等值线按哪种底色挑墨色:白模是浅底,和数据底图一样用深色线 */
export function inkStyle(p: Pick<ExportMapParams, 'style' | 'look'>): string {
  return p.style === 'realistic' && p.look === 'blank' ? 'data' : p.style;
}

/**
 * 底图的第三层:经纬网(开着时)、纸边做旧、外框和罗盘,画在最上面。都是普通的叠加(不读底下的像素),
 * 也能单独画在一张透明画布上再叠上去,结果一样
 */
export function drawMapDecor(ctx: Ctx2D, p: ExportMapParams): void {
  const { world, raster, style } = p;
  const ink = inkStyle(p);
  const mp = exportProj(p);
  const v = bakedView(raster.scale);
  if (mp) {
    if (p.graticule) drawGraticule(ctx, mp, world.width, world.height, v, ink, p.graticule, raster.scale);
    if (style === 'fantasy') {
      drawPaperVignette(ctx, world.width, world.height, v);
      drawProjFrame(ctx, mp, v);
    } else drawNeatProjFrame(ctx, mp, raster.scale, style);
    return;
  }
  const left = exportLeft(p);
  if (p.graticule) drawGraticule(ctx, null, world.width, world.height, { s: raster.scale, ox: -left * raster.scale, oy: 0 }, ink, p.graticule, raster.scale);
  if (style === 'fantasy') {
    drawPaperVignette(ctx, world.width, world.height, v);
    drawFrame(ctx, world.width, world.height, v);
  }
  if (style !== 'fantasy') drawNeatFrame(ctx, raster.w, raster.h, raster.scale, style);
}

/**
 * 等值线(开着时;主线程画在底图上、地名底下):线照屏幕上一样画,放大倍数按 1 算(等高线 500 米一条);
 * 线上的数字躲开 avoid(画布像素的框:地名、城镇符号)。等距圆柱时线不压外框和左下角的罗盘
 */
export function drawExportContours(ctx: Ctx2D, p: ExportMapParams, S: number, set: ContourSet, dark: boolean, avoid: readonly (readonly number[])[] = []): void {
  const mp = exportProj(p);
  if (mp) {
    drawContours(ctx, set, inkStyle(p), { mp, s: S, ox: 0, oy: 0 }, S, 1, dark, avoid);
    return;
  }
  const w = p.world.width * S;
  const h = p.world.height * S;
  const c = COMPASS;
  const keep: number[] = [(c.x - c.r - 12) * S, h - (c.dy + c.r + 12) * S, (c.x + c.r + 12) * S, h - (c.dy - c.r - 12) * S];
  ctx.save();
  const c2d = ctx as CanvasRenderingContext2D;
  c2d.beginPath();
  c2d.rect(14 * S, 14 * S, w - 28 * S, h - 28 * S);
  c2d.rect(keep[0], keep[1], keep[2] - keep[0], keep[3] - keep[1]);
  c2d.clip('evenodd');
  drawContours(ctx, set, inkStyle(p), { mp: null, s: S, ox: -exportLeft(p) * S, oy: 0 }, S, 1, dark, [...avoid, keep]);
  ctx.restore();
}

/** 按当前视图的中心把整张图左右转一下(左右边 = 中心 ± 180°);没给中心不动 */
function rotateToCenter(ctx: Ctx2D, p: ExportMapParams, makeCanvas: (w: number, h: number) => OffscreenCanvas | HTMLCanvasElement): void {
  const { world, raster } = p;
  const left = exportLeft(p);
  if (!left) return;
  const sp = Math.round(left * (raster.w / world.width));
  const tmp = makeCanvas(raster.w, raster.h);
  const tctx = tmp.getContext('2d') as CanvasRenderingContext2D;
  tctx.drawImage(ctx.canvas, 0, 0);
  ctx.clearRect(0, 0, raster.w, raster.h);
  ctx.drawImage(tmp, -sp, 0);
  ctx.drawImage(tmp, raster.w - sp, 0);
  tmp.width = tmp.height = 0;
}

/** 写实风 / 数据图层在弯边投影下的外框:沿外轮廓一道深色粗线 + 一道浅色细线,罗盘在轮廓外的左下角 */
function drawNeatProjFrame(ctx: Ctx2D, mp: MapProj, S: number, style: CivStyle) {
  const ink = style === 'data' ? 'rgba(30, 32, 36, 0.92)' : 'rgba(14, 24, 34, 0.94)';
  ctx.save();
  ctx.lineJoin = 'round';
  outlineOnCanvas(ctx, mp, S, 0, 0, 2.5);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5 * S;
  ctx.stroke();
  outlineOnCanvas(ctx, mp, S, 0, 0, 0);
  ctx.strokeStyle = 'rgba(236, 232, 220, 0.75)';
  ctx.lineWidth = 1.2 * S;
  ctx.stroke();
  ctx.restore();
  const [cx, cy] = compassSpot(mp);
  drawNeatCompass(ctx, cx * S, cy * S, S, ink);
}

/**
 * 写实风 / 数据图层的外框和罗盘:地图集那样的细边框(深色外框 + 一道浅色细线),左下角一个带底盘的罗盘
 * (底盘是半透明的浅色圆,压在深海、冰原上都看得清)。
 */
function drawNeatFrame(ctx: Ctx2D, w: number, h: number, S: number, style: CivStyle) {
  ctx.save();
  const ink = style === 'data' ? 'rgba(30, 32, 36, 0.92)' : 'rgba(14, 24, 34, 0.94)';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 8 * S;
  ctx.strokeRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(236, 232, 220, 0.75)';
  ctx.lineWidth = 1.2 * S;
  ctx.strokeRect(6.5 * S, 6.5 * S, w - 13 * S, h - 13 * S);
  ctx.restore();
  drawNeatCompass(ctx, COMPASS.x * S, h - COMPASS.dy * S, S, ink);
}

/** 写实风 / 数据图层的罗盘(带半透明浅色底盘):中心 (cx, cy) 画布像素 */
function drawNeatCompass(ctx: Ctx2D, cx: number, cy: number, S: number, ink: string) {
  ctx.save();
  const R = COMPASS.r * S;
  ctx.translate(cx, cy);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.86, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(244, 241, 232, 0.72)';
  ctx.fill();
  ctx.lineWidth = 1 * S;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.62, 0, Math.PI * 2);
  ctx.lineWidth = 0.6 * S;
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const long = i % 2 === 0;
    const L = long ? R * 0.8 : R * 0.48;
    const wv = long ? R * 0.13 : R * 0.1;
    const tx = Math.cos(a) * L;
    const ty = Math.sin(a) * L;
    const nx = -Math.sin(a) * wv;
    const ny = Math.cos(a) * wv;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(tx, ty);
    ctx.lineTo(nx, ny);
    ctx.closePath();
    ctx.fillStyle = i === 0 ? 'rgba(150, 40, 34, 0.95)' : ink;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(tx, ty);
    ctx.lineTo(-nx, -ny);
    ctx.closePath();
    ctx.fillStyle = 'rgb(248, 246, 240)';
    ctx.fill();
    ctx.lineWidth = 0.6 * S;
    ctx.strokeStyle = ink;
    ctx.stroke();
  }
  ctx.font = `700 ${13 * S}px "Noto Serif SC", "Songti SC", "STSong", serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3 * S;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(244, 241, 232, 0.85)';
  ctx.strokeText('北', 0, -R * 0.86 - 2 * S);
  ctx.fillStyle = ink;
  ctx.fillText('北', 0, -R * 0.86 - 2 * S);
  ctx.restore();
}

/** 地图角上的色阶图例:只在有连续色阶的数据图层上画,位置 / 大小固定(世界单位,2× 时按倍数放大) */
const MAP_LEGEND = { x: 26, y: 26, w: 400, h: 84, pad: 13 };
export function mapLegendBox(layer: LayerId): { x: number; y: number; w: number; h: number } | null {
  if (!isGradientLegend(layer)) return null;
  return { x: MAP_LEGEND.x, y: MAP_LEGEND.y, w: MAP_LEGEND.w, h: MAP_LEGEND.h };
}

/** 画地图文字时要让开的图例区域(世界坐标 / 投影后的图片坐标) */
export function mapLegendReserved(p: Pick<ExportMapParams, 'style' | 'layer' | 'legend'>): [number, number, number, number][] {
  if (p.style !== 'data' || p.legend === false) return [];
  const b = mapLegendBox(p.layer);
  return b ? [[b.x, b.y, b.x + b.w, b.y + b.h]] : [];
}

/** 色阶在画布上占的地方(画布像素),给标记 / 足迹排名字、年份时让开 */
export function mapLegendCanvasBoxes(p: Pick<ExportMapParams, 'style' | 'layer' | 'legend'>, S: ExportScale): number[][] {
  return mapLegendReserved(p).map((b) => b.map((v) => v * S));
}

/**
 * 地图图片左上角的色阶:一块半透明纸底 + 标题 + 单位 + 色带 + 刻度。
 * 只画连续色阶(海拔、气温、降水、洋流);分类图层(板块、生态、气候)的色块图例走单独导出的图例图片。
 * 压在地名上面、作者标记和人物足迹下面;排地名、标记名字、足迹年份时都让开这块(mapLegendCanvasBoxes),标记和足迹的点本身仍画在最上面,不会被色阶盖住。
 */
export async function drawMapLegend(ctx: CanvasRenderingContext2D, p: Pick<ExportMapParams, 'style' | 'layer' | 'legend'>, S: ExportScale): Promise<boolean> {
  if (p.style !== 'data' || p.legend === false) return false;
  const box = mapLegendBox(p.layer);
  if (!box) return false;
  const spec = dataLegend(p.layer) as GradientLegend;
  await ensureFonts('data', dataLegendText(p.layer), 15000);
  const family = familyFor('data');
  const ink = 'rgb(28,30,34)';
  const muted = 'rgba(28,30,34,0.62)';
  const x = box.x * S;
  const y = box.y * S;
  const w = box.w * S;
  const h = box.h * S;
  const pad = MAP_LEGEND.pad * S;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4 * S);
  ctx.fillStyle = 'rgba(246,244,238,0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(30,32,36,0.55)';
  ctx.lineWidth = Math.max(1, S);
  ctx.stroke();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.font = fontCss(family, 700, 16 * S);
  ctx.fillStyle = ink;
  ctx.fillText(spec.title, x + pad, y + 21 * S);
  ctx.textAlign = 'right';
  ctx.font = fontCss(family, 500, 11.5 * S);
  ctx.fillStyle = muted;
  ctx.fillText(spec.unit, x + w - pad, y + 21 * S);
  const barX = x + pad;
  const barY = y + 34 * S;
  const barW = w - pad * 2;
  const barH = 11 * S;
  const lo = spec.stops[0][0];
  const hi = spec.stops[spec.stops.length - 1][0];
  const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  for (const [v, c] of spec.stops) grad.addColorStop((v - lo) / (hi - lo), `rgb(${c.join(',')})`);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, 2 * S);
  ctx.clip();
  ctx.fillStyle = grad;
  ctx.fillRect(barX, barY, barW, barH);
  ctx.restore();
  ctx.font = fontCss(family, 500, 11.5 * S);
  ctx.fillStyle = muted;
  spec.labels.forEach((v, i) => {
    ctx.textAlign = i === 0 ? 'left' : i === spec.labels.length - 1 ? 'right' : 'center';
    ctx.fillText(v.toLocaleString(), barX + ((v - lo) / (hi - lo)) * barW, y + 61 * S);
  });
  ctx.restore();
  return true;
}

// ---------------------------------------------------------------------------
// 2. 地图文字(主线程)

/**
 * 文字按多大的画布排:s = 画布像素 / 世界单位,dpr = 画布像素 / CSS 像素(字和符号放大几倍)。
 * 地图按 世界宽 × s / dpr 个 CSS 像素宽显示(字号跟着它按平方根变大,见 labels/draw.ts 的 labelPx)。
 * 导出地图图片:s = dpr = 导出倍数(地图按世界宽显示);回放导出的视频、长图按输出的大小另给
 */
export interface MapTextScale {
  s: number;
  dpr: number;
}

/** 导出时文字层的视口:整张图、缩放 1 倍;不给 px = 地图按世界宽显示,像素密度 = 导出倍数 */
export function exportLabelView(p: ExportMapParams, S: ExportScale, px: MapTextScale = { s: S, dpr: S }): LabelView {
  const W = p.world.width;
  const H = p.world.height;
  const mp = exportProj(p);
  const { s, dpr } = px;
  const mapCss = (W * s) / dpr;
  if (mp) {
    // 弯边投影:文字按投影排,不出外轮廓(罗盘在轮廓外面)
    const extras = labelViewExtras({ world: p.world, raster: p.raster, civ: p.civ!, style: p.style, year: p.year, show: p.show }, 0);
    return { ...extras, reserved: mapLegendReserved(p), wrap: 0, frameLeft: 0, proj: labelProjection(mp), scale: s, ox: 0, oy: 0, dpr, k: 1, mapCss, canvasW: W * s, canvasH: H * s };
  }
  // 球面世界:图片左边是 left(展开的世界坐标),外框 = 图片边
  const left = exportLeft(p);
  const extras = labelViewExtras({ world: p.world, raster: p.raster, civ: p.civ!, style: p.style, year: p.year, show: p.show }, left);
  return {
    ...extras,
    reserved: [...(extras.reserved ?? []), ...exportReserved(p.style, H, left), ...mapLegendReserved(p).map(([x0, y0, x1, y1]) => [left + x0, y0, left + x1, y1] as [number, number, number, number])],
    frameLeft: left,
    scale: s,
    ox: -left * s,
    oy: 0,
    dpr,
    k: 1,
    mapCss,
    canvasW: W * s,
    canvasH: H * s,
  };
}

/**
 * 画地图文字(地名、国名、城名、城镇符号)。p.raster 用 1× 的那张就行(只查地面、拟合国名,和导出倍数无关)。
 * 先等字体加载好。返回画了几条文字、几个符号。
 */
export async function drawMapLabels(
  ctx: CanvasRenderingContext2D,
  p: ExportMapParams,
  S: ExportScale,
  opt: { px?: MapTextScale; fast?: boolean; beforeDraw?: (placed: Placement | null) => void } = {},
): Promise<{ labels: number; marks: number; placed?: Placement }> {
  if (!civOk(p)) {
    opt.beforeDraw?.(null);
    return { labels: 0, marks: 0 };
  }
  const params = { world: p.world, raster: p.raster, civ: p.civ, style: p.style, year: p.year, show: p.show };
  // 地理名不随年份变(和屏幕上一样按结束年份取);国名、城名、城镇符号按当年
  const geo = civLabelItems({ ...params, year: p.civ.endYear });
  // 弯边投影:国名按投影后的国土拟合
  const layer = civMapLayer(params, { proj: exportProj(p), fast: opt.fast });
  const items = geo.concat(layer.items);
  const wars = warsShown(params);
  if (!items.length && !layer.marks.length && !wars && !p.show.resources) {
    opt.beforeDraw?.(null);
    return { labels: 0, marks: 0 };
  }
  await ensureFonts(p.style, civLabelChars(p.civ), 15000);
  const lv = exportLabelView(p, S, opt.px);
  const placed = placeMap(items, layer.marks, lv);
  // 排好还没画:叠在地名底下的东西(等值线)先画,好躲开地名
  opt.beforeDraw?.(placed);
  // 战事的战线、双剑:压在国界上、城镇符号和字底下(和屏幕上一样)
  if (wars) {
    const mp = exportProj(p);
    drawWarfare(ctx, params, lv, mp ? projector(mp) : null);
  }
  drawSettlementMarks(ctx, placed.marks, p.style);
  drawPlacedLabels(ctx, placed.labels, lv);
  if (p.show.resources) drawResourceLayer(ctx, p.civ!, p.world, p.year, lv, placed.labels, p.res);
  return { labels: placed.labels.length, marks: placed.marks.length, placed };
}

/**
 * 作者标记、人物足迹在导出图上摆放用的坐标:世界坐标 × s / m(s = 画布像素 / 世界单位),画的时候整体放大 m 倍
 * (m = √(地图显示宽 / REF_MAP_CSS) × dpr):图钉、头像和字跟着地名一样按地图宽放大(地图按 REF_MAP_CSS 宽显示时就是屏幕上的大小)
 */
function exportMarkFrame(p: Pick<ExportMapParams, 'world' | 'center' | 'projection'>, px: MapTextScale): { frame: MarkFrame; m: number } {
  const W = p.world.width;
  const H = p.world.height;
  const m = Math.sqrt((W * px.s) / px.dpr / REF_MAP_CSS) * px.dpr;
  const f = m / px.s;
  const mp = exportProj(p);
  const left = mp ? 0 : exportLeft(p);
  const frame: MarkFrame = mp
    ? {
        pt: (wx, wy) => {
          const [x, y] = projectWorld(mp, wx, wy);
          return [x / f, y / f];
        },
        period: 0,
        win: [0, W / f],
        w: W / f,
        h: H / f,
        k: NAME_ZOOM,
        textK: 1,
        cut: (0.4 * W) / f,
      }
    : { pt: (wx, wy) => [(wx - left) / f, wy / f], period: wrapOf(p.world) ? W / f : 0, win: [0, W / f], w: W / f, h: H / f, k: NAME_ZOOM, textK: 1, cut: 0 };
  return { frame, m };
}

/**
 * 作者标记(导出菜单里选了"带上"):和屏幕上同样的图钉、铺色、名字,都写名字、不合并;items = 这一年有的(几个州的形状算好)。
 * placed = drawMapLabels 排好的地图文字:名字尽量不压城名、地名。px 同 exportLabelView。返回画了几个
 */
export function drawExportMarks(
  ctx: CanvasRenderingContext2D,
  p: Pick<ExportMapParams, 'world' | 'center' | 'projection' | 'style'>,
  S: ExportScale,
  items: readonly MarkItem[],
  placed?: Placement,
  px: MapTextScale = { s: S, dpr: S },
  /** 别的要让开的地方(画布像素),比如色阶 */
  extraAvoid: readonly number[][] = [],
): number {
  if (!items.length) return 0;
  const { frame, m } = exportMarkFrame(p, px);
  ctx.save();
  ctx.scale(m, m);
  // 文字层的画布像素 = 摆放坐标 × m
  const avoid = [...(placed ? placedTextBoxes(placed) : []), ...extraAvoid].map((b) => b.map((v) => v / m));
  const style = markStyle(p.style);
  const layout = layoutMarks(items, frame, { names: true, measure: canvasMeasure(ctx), avoid, style });
  drawMarks(ctx, layout, m, style);
  ctx.restore();
  return layout.pins.length + layout.areas.length;
}

/** 正选着的作者人物的足迹(和屏幕上一样的线、圆点、年份、头像);年份尽量不压地图上的字。返回画了几个点 */
export function drawExportTrail(ctx: CanvasRenderingContext2D, p: Pick<ExportMapParams, 'world' | 'center' | 'projection'>, S: ExportScale, trail: TrailInput, placed?: Placement, extraAvoid: readonly number[][] = []): number {
  const { frame, m } = exportMarkFrame(p, { s: S, dpr: S });
  ctx.save();
  ctx.scale(m, m);
  const avoid = [...(placed ? placedTextBoxes(placed) : []), ...extraAvoid].map((b) => b.map((v) => v / m));
  const layout = layoutTrail(trail, frame, { measure: canvasMeasure(ctx), avoid });
  drawTrail(ctx, layout);
  ctx.restore();
  return layout.dots.length;
}

// ---------------------------------------------------------------------------
// 3. 图例

export interface LegendRow {
  color: [number, number, number];
  name: string;
  /** 右边的小字:"12 州 · 都 汾城" */
  note: string;
}

/** 这一年的国家(按州数排,和世界概览的国家页一样)、民族(按地盘排;已消亡的不列) */
export function legendRows(civ: Civ, year: Year): { polities: LegendRow[]; cultures: LegendRow[]; tribal: number } {
  const y = Math.floor(year);
  const own = ownersAt(civ, y);
  const pc = new Array<number>(civ.polities.length).fill(0);
  const cc = new Array<number>(civ.cultures.length).fill(0);
  let tribal = 0;
  for (let r = 0; r < civ.regions.count; r++) {
    const p = own.polity[r];
    const c = own.culture[r];
    if (p >= 0) pc[p]++;
    else if (c >= 0) tribal++;
    if (c >= 0) cc[c]++;
  }
  const polities = civ.polities
    .filter((p) => polityAlive(p, y) && pc[p.id] > 0)
    .sort((a, b) => pc[b.id] - pc[a.id] || a.id - b.id)
    .map((p) => {
      const cap = civ.settlements[capitalAt(p, y)]?.name;
      return { color: p.color, name: polityName(p, y), note: `${pc[p.id]} 州${cap ? ` · 都${cap}` : ''}` };
    });
  const cultures = civ.cultures
    .filter((c) => cc[c.id] > 0)
    .sort((a, b) => cc[b.id] - cc[a.id] || a.id - b.id)
    .map((c) => ({ color: c.color, name: cultureLabel(c), note: `${KIND_INFO[c.kind].name} · ${cc[c.id]} 州` }));
  return { polities, cultures, tribal };
}

/** 信仰图层的图例:和侧栏信仰列表同样的几行(大教按信众排,教派跟在本教后面,各族民间信仰合成一行) */
export function faithLegendRows(civ: Civ, year: Year): LegendRow[] {
  const F = civ.religion?.faiths ?? [];
  return faithRows(civ, Math.floor(year)).map((r) => {
    const form = r.id >= 0 && !r.sect ? F[r.id]?.form : undefined;
    return { color: [r.color[0], r.color[1], r.color[2]], name: r.name, note: `${r.sect ? '教派 · ' : form ? `${form} · ` : ''}${r.n} 州` };
  });
}

/** 时代图层的图例:这一年有州在的时代(新的在上)和州数 */
export function eraLegendRows(civ: Civ, year: Year): LegendRow[] {
  const lv = eraLevelsAt(civ, Math.floor(year));
  const n = new Array<number>(ERA_COLORS.length).fill(0);
  for (let r = 0; r < lv.length; r++) if (lv[r] >= 0) n[Math.min(ERA_COLORS.length - 1, Math.floor(lv[r]))]++;
  const out: LegendRow[] = [];
  for (let k = n.length - 1; k >= 0; k--) if (n[k]) out.push({ color: [...ERA_COLORS[k]] as [number, number, number], name: eraName(k), note: `${n[k]} 州` });
  return out;
}

/** 管辖图层的图例:四档的颜色,这一年各几州(一州都没有的档不列) */
export function controlLegendRows(civ: Civ, year: Year): LegendRow[] {
  const t = controlTiersAt(civ, Math.floor(year));
  const n = new Array<number>(CONTROL_TIERS.length).fill(0);
  for (let r = 0; r < t.length; r++) if (t[r] >= 0) n[t[r]]++;
  const out: LegendRow[] = [];
  CONTROL_TIERS.forEach((name, k) => {
    if (n[k]) out.push({ color: [...CONTROL_COLORS[k]] as [number, number, number], name, note: `${n[k]} 州` });
  });
  return out;
}

/** 物产图层的图例:十一样物产的颜色,这一年几州能用(哪州都还没发现的不列) */
export function resourceLegendRows(civ: Civ, year: Year): LegendRow[] {
  const dev = civ.development;
  if (!dev) return [];
  const at = resourcesAt(dev, Math.floor(year));
  const out: LegendRow[] = [];
  RESOURCES.forEach((name, k) => {
    let n = 0;
    for (let r = 0; r < civ.regions.count; r++) if (resourceTier(at[r * RESOURCE_COUNT + k])) n++;
    if (!n) return;
    const hex = RESOURCE_COLORS[k];
    const color: [number, number, number] = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    out.push({ color, name, note: `${n} 州` });
  });
  return out;
}

interface LegendLook {
  paper: string;
  edge: string;
  ink: string;
  muted: string;
  rule: string;
}

const LEGEND_LOOK: Record<CivStyle, LegendLook> = {
  fantasy: { paper: '#efe2c2', edge: 'rgba(58,45,34,0.9)', ink: 'rgb(58,45,34)', muted: 'rgba(58,45,34,0.62)', rule: 'rgba(58,45,34,0.35)' },
  realistic: { paper: '#f6f4ee', edge: 'rgba(14,24,34,0.9)', ink: 'rgb(24,30,38)', muted: 'rgba(24,30,38,0.58)', rule: 'rgba(24,30,38,0.25)' },
  data: { paper: '#f6f4ee', edge: 'rgba(30,32,36,0.9)', ink: 'rgb(28,30,34)', muted: 'rgba(28,30,34,0.58)', rule: 'rgba(28,30,34,0.25)' },
};

export interface LegendParams {
  civ: Civ;
  style: CivStyle;
  year: Year;
  show: CivShow;
  seed: number;
  /** 数据图层:图例里画哪张图层的色阶 / 色块(style = 'data' 时用) */
  layer?: LayerId;
  /** 年份照这个纪年写(不给 = "第 N 年") */
  era?: Era;
}

/** 图例里的城镇符号:国都 → 村,再加故城遗址 */
const SYMBOL_ROWS: { kind: SettlementKind; name: string }[] = [
  { kind: 4, name: '国都' },
  { kind: 3, name: '大城' },
  { kind: 2, name: '城' },
  { kind: 1, name: '镇' },
  { kind: 0, name: '村' },
  { kind: 5, name: '故城遗址' },
];

/** 数据图层的色阶块在导出的图例图片里占多宽:色阶留够一条长带,分类留够三栏色块 */
function dataBlockWidth(d: DataLegend): number {
  if (d.kind === 'gradient') return 460;
  if (d.kind === 'climate') return 560;
  return 420;
}

/** 数据图层色阶块的高度(和 drawDataLegendBlock 画出来的一致;气候分类的说明按最多两行留地方) */
function dataBlockHeight(d: DataLegend): number {
  if (d.kind === 'gradient') return 78;
  if (d.kind === 'climate') return 6 + d.groups.length * 28 + 6 + 2 * 16 + 8;
  const cols = d.keys.length > 8 ? 3 : 2;
  return 8 + Math.ceil(d.keys.length / cols) * 26 + 8;
}

/** 一行字最多多宽,按字切开(中文按字符,英文数字也够用) */
function wrapLegendText(ctx: CanvasRenderingContext2D, s: string, maxW: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const ch of s) {
    if (line && ctx.measureText(line + ch).width > maxW) {
      out.push(line);
      line = ch;
    } else line += ch;
  }
  if (line) out.push(line);
  return out;
}

/**
 * 图例图片里的数据图层部分:连续色阶画一条长色带 + 刻度 + 单位;分类图层画色块 + 名字;
 * 气候分类按 A–E 五组排,最后一句说明是估算。返回画了多高(CSS 像素)。
 */
function drawDataLegendBlock(
  ctx: CanvasRenderingContext2D,
  d: DataLegend,
  x: number,
  y: number,
  w: number,
  look: LegendLook,
  family: string,
): number {
  const text = (s: string, xx: number, yy: number, px: number, color: string, weight = 500, align: CanvasTextAlign = 'left') => {
    ctx.font = fontCss(family, weight, px);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, xx, yy);
  };
  const fit = (s: string, px: number, max: number) => {
    ctx.font = fontCss(family, 500, px);
    if (ctx.measureText(s).width <= max) return s;
    let t = s;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  };

  if (d.kind === 'gradient') {
    const barY = y + 10;
    const barH = 14;
    const lo = d.stops[0][0];
    const hi = d.stops[d.stops.length - 1][0];
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    for (const [v, c] of d.stops) grad.addColorStop((v - lo) / (hi - lo), `rgb(${c.join(',')})`);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, barY, w, barH, 3);
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fillRect(x, barY, w, barH);
    ctx.restore();
    ctx.font = fontCss(family, 500, 12);
    ctx.fillStyle = look.muted;
    d.labels.forEach((v, i) => {
      ctx.textAlign = i === 0 ? 'left' : i === d.labels.length - 1 ? 'right' : 'center';
      ctx.fillText(v.toLocaleString(), x + ((v - lo) / (hi - lo)) * w, y + 44);
    });
    text(d.unit, x, y + 66, 12.5, look.muted);
    return 78;
  }

  if (d.kind === 'keys') {
    const cols = d.keys.length > 8 ? 3 : 2;
    const per = Math.ceil(d.keys.length / cols);
    const cw = w / cols;
    d.keys.forEach((k, i) => {
      const col = Math.floor(i / per);
      const row = i % per;
      const xx = x + col * cw;
      const yy = y + 8 + row * 26 + 7;
      ctx.fillStyle = `rgb(${k.color.join(',')})`;
      ctx.strokeStyle = look.rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(xx, yy - 7, 14, 14, 2);
      ctx.fill();
      ctx.stroke();
      text(fit(k.name, 14, cw - 26), xx + 22, yy + 1, 14, look.ink);
    });
    return 8 + per * 26 + 8;
  }

  let yy = y + 6;
  for (const g of d.groups) {
    text(g.name, x, yy + 14, 13, look.muted);
    let cx = x + 78;
    for (const c of g.classes) {
      ctx.fillStyle = `rgb(${c.color.join(',')})`;
      ctx.strokeStyle = look.rule;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(cx, yy + 8, 12, 12, 2);
      ctx.fill();
      ctx.stroke();
      text(c.code, cx + 18, yy + 15, 12.5, look.ink, 700);
      ctx.font = fontCss(family, 700, 12.5);
      const codeW = ctx.measureText(c.code).width;
      if (c.short) text(c.short, cx + 22 + codeW, yy + 15, 12.5, look.ink);
      ctx.font = fontCss(family, 500, 12.5);
      cx += 26 + codeW + (c.short ? ctx.measureText(c.short).width + 6 : 0) + 10;
    }
    yy += 28;
  }
  const noteY = yy + 6;
  ctx.font = fontCss(family, 500, 12);
  const lines = wrapLegendText(ctx, d.note, w);
  lines.forEach((line, i) => text(line, x, noteY + i * 16, 12, look.muted));
  return noteY - y + lines.length * 16 + 8;
}

/**
 * 图例图片:数据图层先画色阶 / 色块,再按需列国家、民族、信仰、时代、物产、城镇符号、道路;非数据图层照旧是标题(第 N 年)+ 国家 / 民族等。
 * 地图上开着"民族"或"信仰"时色块是民族 / 信仰的,国家只画国界 —— 国家的色块就画成空心框。
 * 两个表都没开时两个都列。行多了分两栏。
 */
export async function drawLegend(p: LegendParams, scale: ExportScale): Promise<HTMLCanvasElement> {
  // 图例按 1.5 倍画:1× 时约 530 像素宽,高度和 1× 地图差不多,放在地图旁边正合适
  const S = scale * 1.5;
  const { civ, style, show } = p;
  const y = Math.floor(p.year);
  const look = LEGEND_LOOK[style];
  const family = familyFor(style);
  const rows = legendRows(civ, y);
  // 数据图层:图例先画这张图层的色阶 / 色块,不再把国家、民族列在头里(除非地图上确实叠了它们)
  const data = style === 'data' ? dataLegend(p.layer ?? 'biomes') : null;
  // 信仰图层:地图铺的是信仰(国家只画国界),图例列国家(空心框)和信仰
  const faithOn = show.faiths && !!civ.religion?.faiths.length;
  const faiths = faithOn ? faithLegendRows(civ, y) : [];
  // 时代图层:地图铺的是时代(国家只画国界),图例列国家(空心框)和时代;物产图层:列物产(不列国家、民族)
  const eraOn = !faithOn && show.eras && !!civ.development;
  const eras = eraOn ? eraLegendRows(civ, y) : [];
  // 管辖图层:地图铺的是四档(国家只画国界),图例列国家(空心框)和四档
  const ctlOn = !faithOn && !eraOn && show.control && !!civ.development?.controlYears?.length;
  const ctls = ctlOn ? controlLegendRows(civ, y) : [];
  const resOn = show.resources && !!civ.development;
  const res = resOn ? resourceLegendRows(civ, y) : [];
  const wantPol = !resOn && (show.polities || (!data && !show.cultures && !faithOn && !eraOn && !ctlOn));
  const wantCul = !resOn && !faithOn && !eraOn && !ctlOn && (show.cultures || (!data && !show.polities));
  const outline = show.cultures || faithOn || eraOn || ctlOn;
  const withMarks = show.polities || show.routes;
  const withRoutes = show.routes;

  const allText =
    [...rows.polities, ...rows.cultures, ...faiths, ...eras, ...ctls, ...res].map((r) => r.name + r.note).join('') +
    '图例第年国家民族信仰教派时代管辖物产城镇道路大路小路航线部落地带种子州都' +
    yearFull(y, p.era) +
    (data ? dataLegendText(p.layer ?? 'biomes') : '');
  await ensureFonts(style, allText, 15000);

  // ---- 版式(CSS 像素,最后 × S)----
  const PAD = 28;
  const COL = 300;
  const ROW = 26;
  const HEAD = 34;
  type Block = { title: string; rows: LegendRow[]; kind: 'pol' | 'cul' | 'faith' | 'era' | 'ctl' | 'res' };
  const blocks: Block[] = [];
  if (wantPol) blocks.push({ title: '国家', rows: rows.polities, kind: 'pol' });
  if (wantCul) blocks.push({ title: '民族', rows: rows.cultures, kind: 'cul' });
  if (faithOn) blocks.push({ title: '信仰', rows: faiths, kind: 'faith' });
  if (eraOn) blocks.push({ title: '时代', rows: eras, kind: 'era' });
  if (ctlOn) blocks.push({ title: '管辖', rows: ctls, kind: 'ctl' });
  if (resOn) blocks.push({ title: '物产', rows: res, kind: 'res' });
  const most = Math.max(1, ...blocks.map((b) => b.rows.length));
  const cols = most > 14 ? 2 : 1;
  const dataW = data ? dataBlockWidth(data) : 0;
  const W = Math.max(PAD * 2 + COL * cols + (cols - 1) * 24, dataW + PAD * 2);
  let h = PAD + 58; // 标题
  if (data) h += dataBlockHeight(data) + 18;
  for (const b of blocks) h += HEAD + Math.max(1, Math.ceil(b.rows.length / cols)) * ROW + 14;
  if (wantPol && rows.tribal) h += 20;
  if (withMarks) h += HEAD + 2 * ROW + 14;
  if (withRoutes) h += HEAD + ROW + 14;
  h += PAD - 8;

  const cv = document.createElement('canvas');
  cv.width = Math.round(W * S);
  cv.height = Math.round(h * S);
  const ctx = cv.getContext('2d')!;
  ctx.scale(S, S);
  ctx.fillStyle = look.paper;
  ctx.fillRect(0, 0, W, h);
  ctx.strokeStyle = look.edge;
  ctx.lineWidth = 3;
  ctx.strokeRect(4, 4, W - 8, h - 8);
  ctx.lineWidth = 1;
  ctx.strokeRect(10, 10, W - 20, h - 20);
  ctx.textBaseline = 'middle';

  const text = (s: string, x: number, yy: number, px: number, color: string, weight = 500, align: CanvasTextAlign = 'left') => {
    ctx.font = fontCss(family, weight, px);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, yy);
  };
  const fit = (s: string, px: number, max: number) => {
    ctx.font = fontCss(family, 500, px);
    if (ctx.measureText(s).width <= max) return s;
    let t = s;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  };

  let cy = PAD + 18;
  text(data ? data.title : yearFull(y, p.era), PAD, cy, 26, look.ink, style === 'realistic' || style === 'data' ? 700 : 500);
  if (data && data.kind === 'climate') {
    ctx.font = fontCss(family, 700, 26);
    const titleW = ctx.measureText(data.title).width;
    text(data.subtitle, PAD + titleW + 10, cy + 3, 13, look.muted);
  }
  const right = data && !blocks.length && !withMarks && !withRoutes ? `图例 · 种子 ${p.seed}` : data ? `${yearFull(y, p.era)} · 图例 · 种子 ${p.seed}` : `图例 · 种子 ${p.seed}`;
  text(right, W - PAD, cy + 3, 14, look.muted, 500, 'right');
  cy += 40;

  const rule = (yy: number) => {
    ctx.beginPath();
    ctx.moveTo(PAD, yy);
    ctx.lineTo(W - PAD, yy);
    ctx.strokeStyle = look.rule;
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  if (data) {
    rule(cy - 6);
    cy += 6;
    cy += drawDataLegendBlock(ctx, data, PAD, cy, W - PAD * 2, look, family);
    cy += 18;
  }

  for (const b of blocks) {
    rule(cy - 6);
    text(b.title, PAD, cy + HEAD / 2 - 2, 17, look.ink, style === 'fantasy' ? 500 : 700);
    cy += HEAD;
    if (!b.rows.length) {
      text(`这一年还没有${b.title}`, PAD, cy + ROW / 2, 14, look.muted);
      cy += ROW;
    }
    const per = Math.ceil(b.rows.length / cols);
    b.rows.forEach((r, i) => {
      const col = Math.floor(i / Math.max(1, per));
      const x = PAD + col * (COL + 24);
      const yy = cy + (i % Math.max(1, per)) * ROW + ROW / 2;
      const rgb = `rgb(${r.color.join(',')})`;
      if (b.kind === 'pol' && outline) {
        ctx.strokeStyle = rgb;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, yy - 7, 14, 14);
      } else {
        ctx.fillStyle = rgb;
        ctx.fillRect(x, yy - 8, 16, 16);
        ctx.strokeStyle = look.rule;
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, yy - 7.5, 15, 15);
      }
      ctx.font = fontCss(family, 500, 12.5);
      const noteW = ctx.measureText(r.note).width;
      text(fit(r.name, 15, COL - 30 - noteW - 10), x + 24, yy + 1, 15, look.ink);
      text(r.note, x + COL, yy + 1, 12.5, look.muted, 500, 'right');
    });
    cy += Math.ceil(b.rows.length / cols) * ROW;
    if (b.kind === 'pol' && rows.tribal) {
      text(`另有 ${rows.tribal} 州是部落地带(有人居住、还没有国家)`, PAD, cy + 10, 12.5, look.muted);
      cy += 20;
    }
    cy += 14;
  }

  if (withMarks) {
    rule(cy - 6);
    text('城镇', PAD, cy + HEAD / 2 - 2, 17, look.ink, style === 'fantasy' ? 500 : 700);
    cy += HEAD;
    const boxes = SYMBOL_BOX[style === 'fantasy' ? 'fantasy' : 'realistic'];
    const per = 3;
    const cw = (W - PAD * 2) / per;
    const placed: PlacedMark[] = [];
    const cap = rows.polities.length ? rows.polities[0].color : ([150, 60, 50] as [number, number, number]);
    SYMBOL_ROWS.forEach((r, i) => {
      const x = PAD + (i % per) * cw + 12;
      const yy = cy + Math.floor(i / per) * ROW + ROW / 2;
      const mark = { id: -1 - i, x, y: yy, box: boxes[r.kind], grow: SYMBOL_GROW, minZoom: 1, priority: 0, kind: r.kind, color: cap };
      placed.push({ mark: mark as unknown as LabelMark, x: x * S, y: yy * S, s: 1.6 * S });
      text(r.name, x + 16, yy + 1, 14, look.ink);
    });
    // 符号按画布像素画(drawSettlementMarks 里会先重置变换,画完 save / restore 还原)
    drawSettlementMarks(ctx, placed, style);
    cy += 2 * ROW + 14;
  }

  if (withRoutes) {
    rule(cy - 6);
    text('道路', PAD, cy + HEAD / 2 - 2, 17, look.ink, style === 'fantasy' ? 500 : 700);
    cy += HEAD;
    const names = { road: '大路', trail: '小路', sea: '航线' } as const;
    const cw = (W - PAD * 2) / 3;
    (['road', 'trail', 'sea'] as const).forEach((kind, i) => {
      const x = PAD + i * cw;
      const yy = cy + ROW / 2;
      routeSample(ctx, kind, style, x, yy, 46);
      text(names[kind], x + 56, yy + 1, 14, look.ink);
    });
  }
  return cv;
}

/**
 * 图例里的一小段路:和地图上同样的笔法(render/civ/routes.ts),放大 1.6 倍;
 * 垫一小块地面 / 海面的底色(写实风的路是浅色的,直接画在浅色纸上看不见)
 */
function routeSample(ctx: CanvasRenderingContext2D, kind: 'road' | 'trail' | 'sea', style: CivStyle, x: number, y: number, len: number) {
  const S = 1.6;
  const fantasy = style === 'fantasy';
  ctx.save();
  ctx.fillStyle = kind === 'sea' ? (fantasy ? '#8fabb0' : '#1f4a70') : fantasy ? '#e6d6ae' : '#7d8a57';
  ctx.beginPath();
  ctx.roundRect(x - 4, y - 8, len + 8, 16, 4);
  ctx.fill();
  const seg = (color: string, width: number, dash: number[]) => {
    ctx.beginPath();
    ctx.moveTo(x + 3, y);
    ctx.lineTo(x + len - 3, y);
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  ctx.lineCap = 'round';
  if (fantasy) {
    if (kind === 'sea') seg('rgba(52,58,66,0.62)', 1.25 * S, [0.01, 3.4 * S]);
    else if (kind === 'trail') {
      seg('rgba(246,236,210,0.3)', 2 * S, []);
      seg('rgba(74,46,28,0.7)', 0.8 * S, [2.2 * S, 2.4 * S]);
    } else {
      seg('rgba(246,236,210,0.45)', 2.8 * S, []);
      seg('rgba(74,42,24,0.9)', 1.2 * S, [4.6 * S, 2.6 * S]);
    }
  } else if (kind === 'sea') seg('rgba(226,238,246,0.7)', 1.2 * S, [0.01, 3.2 * S]);
  else if (kind === 'trail') {
    seg('rgba(38,28,14,0.24)', 2 * S, []);
    seg('rgba(246,230,186,0.85)', 0.9 * S, [2.4 * S, 2 * S]);
  } else {
    seg('rgba(38,28,14,0.36)', 2.5 * S, []);
    seg('rgba(248,228,174,0.97)', 1.2 * S, []);
  }
  ctx.restore();
}

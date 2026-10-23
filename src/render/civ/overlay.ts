/**
 * 文明叠加层:画在地形图上面单独的一层 canvas 上(和地形图的画法 render/fantasy.ts、realistic.ts、layers.ts 分开)。
 * 切换年份 / 开关时只重画这一层,地形不动。
 *
 * 按固定顺序调用各画法;每个画法在自己的文件里:
 *   宜居度热力图(debug.ts)
 *   → 国土 / 民族 / 信仰 / 时代色块(territory.ts;两层都开时铺民族;开着信仰就铺信仰,见 faith.ts;开着时代就铺时代,见 era.ts)
 *   → 战事:正在打的仗里易手的州画斜线(warfare.ts)
 *   → 瘟疫:正在闹、疫过不久的州铺墨点(plague.ts)
 *   → 州界细线(debug.ts)
 *   → 国界(borders.ts)
 *   → 道路(routes.ts;按修建年份出现)
 *   → 城址圆点(debug.ts)
 *
 * 文字、城镇符号、战线和双剑(warfare.ts 的 drawWarfare)不画在这一层:它们在 CivLayer 里单独一张和视口一样大的画布上,随缩放、平移重画(放大后依然清晰)。
 * 数据来源是 labels.ts:civLabelItems()(地理名)、civMapLayer()(国名、城名、城镇符号,随年份变);
 * 排版、避让在 render/labels/draw.ts 的 placeMap(),城镇符号的画法在 settlements.ts。
 */
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { Civ, Year } from '../../gen/civ/types';
import { Layer } from '../../gen/civ/types';
import { drawHabitat, drawRegionLines, drawSites } from './debug';
import { drawTerritory, territorySteps } from './territory';
import { borderLines, drawBorders } from './borders';
import { drawRoutes, routeLines } from './routes';
import { drawWarHatch, warHatchCanvas, warScene, warsShown, warSpans, warStripesPrep } from './warfare';
import { drawPlague, plagueCanvas, plagueShown, plagueZone } from './plague';
import { clipOutline, type Projector } from '../projection';
import { flushCanvas, type WorkStep } from '../common';
import type { CivShow } from './show';

export type CivStyle = 'realistic' | 'fantasy' | 'data';

// 文明层的开关和默认值在 show.ts(界面状态只用到它们,不用带上画法),这里照旧一起导出
export { CIV_SHOW_DEFAULT, CIV_SHOW_OFF, type CivShow } from './show';

/** 视口:缩放倍数 k、平移 x/y(CSS 像素)。文字层随缩放重画时用 */
export interface CivViewport {
  k: number;
  x: number;
  y: number;
}

export interface CivDrawParams {
  world: World;
  raster: Raster;
  civ: Civ;
  style: CivStyle;
  /** 画哪一年(时间轴拖到哪一年就画哪一年) */
  year: Year;
  show: CivShow;
  view?: CivViewport;
  /** 正在回放 / 拖时间轴:色块用半分辨率,保证每帧够快 */
  fast?: boolean;
  /**
   * 弯边投影(按投影重画):画布是地图平面(和 raster 一样大,画布像素 = 地图平面 × raster.scale)。
   * 色块、热力图这样的"面"先按等距圆柱算好再按行重投影;州界、国界、道路逐点投影,线宽、虚线按画布像素,处处一致;
   * 城址圆点在投影后的位置上画。不给 = 等距圆柱主图
   */
  proj?: Projector | null;
  /**
   * 地球仪的文明贴图(手绘):水彩按地球仪贴图的符号层让位(林块按纬度拉宽过,山丘等符号不在贴图里,
   * 见 fantasy.ts 的 fantasyGlobeInkMask)。主图不给
   */
  globeInk?: boolean;
  /**
   * 放大后的细节层(render/civ/detail.ts)按屏幕重画:线宽、虚线长短 × pen(世界单位里的倍数,< 1 = 比地图放大得慢,
   * 见 detailPen)。画布另有变换(地图平面 × S → 画布像素)。不给 = 1(整张图)
   */
  pen?: number;
  /** 细节层:只画和这块(世界坐标,x 展开的 [x0, y0, x1, y1])沾边的线;不给 = 全画 */
  cull?: readonly [number, number, number, number];
  /** 信仰图层:选中的信仰(宗教卡片开着),别的信仰变淡;不给 = 都是原色 */
  faithFocus?: number | null;
  /**
   * 存档缩略图(App 的 thumbMaker,画结束那一年):色块、国界另存一份,不挤掉主图那一年正在用的;
   * 色块那张画完就放掉(缩略图一个世界截一次)
   */
  thumb?: boolean;
}

export function drawCivOverlay(ctx: CanvasRenderingContext2D, p: CivDrawParams) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (p.show.habitat) drawHabitat(ctx, p);
  drawTerritory(ctx, p);
  drawWarHatch(ctx, p);
  drawPlague(ctx, p);
  // 弯边投影:线和点不出外轮廓(伸出 ±180° 的那截在另一边接着画)
  ctx.save();
  if (p.proj) clipOutline(ctx, p.proj.mp, { s: p.raster.scale, ox: 0, oy: 0 });
  if (p.show.regions) drawRegionLines(ctx, p);
  drawBorders(ctx, p);
  drawRoutes(ctx, p);
  if (p.show.sites) drawSites(ctx, p);
  ctx.restore();
}

/**
 * drawCivOverlay 头一回画一份历史(换上再推、重推、试推演、打开存档推出来的历史)时要现算的东西,拆成一小步一小步:
 * 色块(territory.ts 的 territorySteps,按行分段)、国界、道路、战事的斜线、瘟疫的墨点各一步(斜线、墨点画好就让浏览器当下画出来)。
 * 都做完以后 drawCivOverlay 只是把备好的贴上、描线,和当场一口气画逐像素一样;已经备好的步骤什么也不做
 */
export function civOverlaySteps(p: CivDrawParams): WorkStep[] {
  return [
    ...territorySteps(p),
    () => void (p.show.polities && p.civ.polities.length && borderLines(p, Layer.Polity)),
    () => void (p.show.routes && p.civ.routes.length && routeLines(p.world.mesh, p.civ, p.year)),
    () => void (warsShown(p) && warSpans(p.civ)),
    () => void (warsShown(p) && warScene(p.civ, p.year)),
    // 整张斜线底图(每张栅格一张;刚打开的世界还没有)单独一步
    () => warStripesPrep(p),
    // 斜线、墨点画好以后当下就让浏览器画出来(不然攒到换上那一下贴的时候才画)
    () => void flushCanvas(warHatchCanvas(p)),
    () => void (plagueShown(p) && plagueZone(p.civ, p.year)),
    () => void flushCanvas(plagueCanvas(p)),
  ];
}

/**
 * 地球仪的文明贴图:和 drawCivOverlay 一样,只是不画国界和道路 ——
 * 地球仪上这两样(还有战线、双剑)每帧按正射投影画成矢量线(render/globeLines.ts),放大后不发软
 */
export function drawCivFill(ctx: CanvasRenderingContext2D, p: CivDrawParams) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  if (p.show.habitat) drawHabitat(ctx, p);
  drawTerritory(ctx, p);
  drawWarHatch(ctx, p);
  drawPlague(ctx, p);
  if (p.show.regions) drawRegionLines(ctx, p);
  if (p.show.sites) drawSites(ctx, p);
}

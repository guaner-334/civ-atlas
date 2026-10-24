/**
 * 放大后的"细节层":地图放大到 DETAIL_K 倍以上时,按视口(和屏幕像素一样细)重画地形图的矢量部分,
 * 底下垫上放大的像素层 —— 盖住视口里的地形图。
 *
 *   手绘:岸线外的波纹、近岸排线(drawFantasySeaLines)、海岸墨线、湖岸描边(drawFantasyCoasts)——
 *         像素层换成不带这几样的那一份(fantasyBaseClean),不然放大后是一格一格的方块、台阶;
 *         林块、河流、山 / 丘陵 / 沙丘 / 草丛 / 火山(drawFantasyVectors)。
 *         符号、墨线按缩放倍数逐级变大、细节变多(fantasy.ts 的 glyphScale、GLYPH_TIERS),不跟着地图等比放大,也不糊
 *   写实:像素层换成"水那一份 + 按岸线裁出来的陆地那一份"(drawRealisticShores)—— 不然放大后水陆之间是一条
 *         好几个屏幕像素宽的模糊带;河流(drawRealisticRivers):小溪逐级出现,主干放大后才显出粗
 *
 * 缩放 1 倍附近直接用铺进地形图的那一份(同一套画法、k = 1),细节层不画。
 * 弯边投影按投影重画(drawTerrainProjected):地形图本身(缩放 1 倍)和放大后的细节层都用它。
 * 纯画图(不碰 React);什么时候重画由 ui/TerrainDetail.tsx 决定。
 */
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import { drawParts, type DrawPart, type PrepStep, type VecView, type WorkStep } from './common';
import {
  drawFantasyCoasts,
  fantasyBaseClean,
  fantasyBaseNoInk,
  fantasyDetailPrep,
  fantasyCoastParts,
  fantasyIceParts,
  fantasyProjPrep,
  fantasySeaLineParts,
  fantasySymbolLayerProj,
  fantasyVectorParts,
  fantasyWholeProjPrep,
} from './fantasy';
import { drawRealisticRivers, realisticBase, realisticDetailPrep, realisticShoreParts } from './realistic';
import { clipOutline, projector, reprojectImage, type MapProj } from './projection';
import type { SurfaceLook } from './surface';

/** 细节层分几下画时,手绘风的像素层一下贴多少画布像素(一条横带) */
const BASE_BAND_PX = 4e6;

/** 放大到几倍以上才启用细节层(以下直接看铺进地形图的那一份;两者在这附近画出来一样大) */
export const DETAIL_K = 1.2;

export type DetailStyle = 'realistic' | 'fantasy';

/**
 * 在画布上画细节层:v = 世界坐标 → 画布像素的变换,v.k = 缩放倍数。
 * creeks = false:写实风不画小溪(上面盖着现算的块,块里有);look = 写实风的画法(surface.ts)
 */
export function drawTerrainDetail(ctx: CanvasRenderingContext2D, world: World, raster: Raster, style: DetailStyle, v: VecView, creeks = true, look: SurfaceLook = 'classic') {
  drawParts(ctx, terrainDetailParts(world, raster, style, v, creeks, look));
}

/**
 * drawTerrainDetail 分几下画(见 common.ts 的 DrawPart;依次画完和 drawTerrainDetail 逐像素一样):
 * 手绘 —— 像素层一下,排线、每圈波纹各一下,冰面、背光边、冰缘各一下,湖岸、海岸各一下,林块几格一下,河一下,符号一下;
 * 写实 —— 水、陆两份各一下,河一下。
 * split = 要分在几个任务里画(没有显卡加速时):手绘的像素层再按横带分几下贴(在 CPU 上画逐像素一样;
 * 显卡上按横带裁着贴,插值会差一点,所以只在分开画时才切)。
 * 都要在第一次画用的缓存备好以后再画(terrainDetailPrep)
 */
export function terrainDetailParts(world: World, raster: Raster, style: DetailStyle, v: VecView, creeks = true, look: SurfaceLook = 'classic', split = false): DrawPart[] {
  if (style === 'realistic') return [...realisticShoreParts(raster, v, look), (ctx) => drawRealisticRivers(ctx, world, raster, v, creeks, look)];
  // 像素层按视口变换放大贴上(和地形图被 CSS 放大时一样是双线性插值;放大用不着更贵的高质量缩放)。
  // 分开画时分几下贴:每一下裁在一条横带里(带的边在像素边上)
  const ps = v.s / raster.scale;
  let row = 0;
  return [
    (ctx) => {
      const cw = ctx.canvas.width;
      const ch = ctx.canvas.height;
      const r1 = split ? Math.min(ch, row + Math.max(64, Math.ceil(BASE_BAND_PX / cw))) : ch;
      ctx.save();
      if (split) {
        const band = new Path2D();
        band.rect(0, row, cw, r1 - row);
        ctx.clip(band);
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'low';
      ctx.drawImage(fantasyBaseClean(world, raster), v.ox, v.oy, raster.w * ps, raster.h * ps);
      ctx.restore();
      row = r1;
      return row < ch;
    },
    ...fantasySeaLineParts(world, raster, v),
    ...fantasyIceParts(world, raster, v),
    ...fantasyCoastParts(raster, v),
    ...fantasyVectorParts(world, v),
  ];
}

/**
 * drawTerrainDetail 第一次画时要现算的整张图缓存(手绘风的不带墨线像素层、波纹、冰缘、海岸线……,写实风的小溪、岸线两侧的像素层),
 * 拆成一小步一小步(见 common.ts 的 PrepStep)。都做过了再画,只剩按视口画线、贴图。
 * s = 要画的那一块每世界单位几个画布像素(同 drawTerrainDetail 的 v.s;有的缓存按放大多少分档),creeks 同 drawTerrainDetail
 */
export function terrainDetailPrep(world: World, raster: Raster, style: DetailStyle, s: number, creeks = true, look: SurfaceLook = 'classic'): PrepStep[] {
  return style === 'realistic' ? realisticDetailPrep(world, raster, creeks, look) : fantasyDetailPrep(world, raster, s);
}

/**
 * 弯边投影里 drawTerrainProjected 画放大后的一块视口(画布 cw × ch,v 同它)第一次要现算的缓存,拆成一小步一小步:
 * 整张图的那几样(同 terrainDetailPrep)+ 按这个投影 + 中心逐点投影、重铺的那几样(手绘风,见 fantasyProjPrep)
 */
export function terrainProjPrep(world: World, raster: Raster, style: DetailStyle, mp: MapProj, v: { s: number; ox: number; oy: number; k: number }, cw: number, ch: number, look: SurfaceLook = 'classic'): WorkStep[] {
  if (style === 'realistic') return realisticDetailPrep(world, raster, true, look);
  return [...fantasyDetailPrep(world, raster), ...fantasyProjPrep(world, raster, mp, v, cw, ch)];
}

/** 整张地形图按投影重画分步时,面每一步铺多少行 */
const WHOLE_ROWS = 64;

/**
 * drawTerrainProjected 画整张地形图(缩放 1 倍、画布和地图平面一样大:弯边投影停着时的地形图)拆成一小步一小步:
 * 备料(这种投影的符号规划、海岸线逐点投影、投影后的符号层……)、面按行重投影(每步 WHOLE_ROWS 行)、
 * 最后裁外轮廓画海岸墨线 / 河、贴符号层。ctx() = 要画的那张画布(画布上已铺好底色;拿不到 = 不画了)。
 * 依次做完和 drawTerrainProjected 整图那一档一口气画逐像素一样(两边改一处要一起改)
 */
export function terrainProjWholeSteps(ctx: () => CanvasRenderingContext2D | null, world: World, raster: Raster, style: DetailStyle, mp: MapProj, look: SurfaceLook = 'classic'): WorkStep[] {
  const fantasy = style === 'fantasy';
  const v = { s: raster.scale, ox: 0, oy: 0, k: 1 };
  const pv = { ...v, proj: projector(mp) };
  const base = () => (fantasy ? fantasyBaseNoInk(world, raster) : realisticBase(raster, look));
  const steps: WorkStep[] = [() => void base()];
  if (fantasy) steps.push(...fantasyWholeProjPrep(world, raster, mp));
  for (let r = 0; r < raster.h; r += WHOLE_ROWS) {
    const rows: [number, number] = [r, Math.min(raster.h, r + WHOLE_ROWS)];
    steps.push(() => {
      const c = ctx();
      if (c) reprojectImage(c, base(), raster.w, raster.h, mp, v, 'medium', rows);
    });
  }
  steps.push(() => {
    const c = ctx();
    if (!c) return;
    c.save();
    clipOutline(c, mp, v);
    if (fantasy) {
      drawFantasyCoasts(c, raster, pv);
      c.drawImage(fantasySymbolLayerProj(world, raster, mp), 0, 0);
    } else drawRealisticRivers(c, world, raster, pv, true, look);
    c.restore();
  });
  return steps;
}

/**
 * 弯边投影(罗宾森、摩尔威德……)按投影重画地形:画布 = 地图平面 × v.s + (v.ox, v.oy)(整张图或放大后的一块视口)。
 *   1. "面"(纸、水彩、海、晕渲)按行重投影铺上(render/projection.ts 的 reprojectImage)。手绘风:整张图用不带海岸墨线的那一份
 *      (波纹、近岸排线还在像素层里),放大后的一块视口用连波纹、排线也不带的那一份;写实:放大后的一块视口
 *      水、陆两份按岸线拼(drawRealisticShores,陆地范围逐点投影);
 *   2. 按外轮廓裁剪,再把"线和符号"直接画在画布上:手绘 —— (放大后)波纹、近岸排线,海岸墨线、湖岸(逐点投影的矢量线)、林块、河、山 / 丘陵……
 *      (在投影后的位置上正立、按屏幕大小画,大小和等距圆柱同缩放时一样);写实 —— 河(逐点投影)。
 * v.k = 缩放倍数(细节层级,同 drawTerrainDetail)。整张图、缩放 1 倍(铺进地形图)时符号层用缓存的那一张(文明层"让位"也用它)。
 * 不清空画布,外轮廓外面不画
 */
export function drawTerrainProjected(ctx: CanvasRenderingContext2D, world: World, raster: Raster, style: DetailStyle, mp: MapProj, v: { s: number; ox: number; oy: number; k: number }, look: SurfaceLook = 'classic'): void {
  const whole = v.k <= 1 && v.ox === 0 && v.oy === 0 && Math.abs(v.s - raster.scale) < 1e-9 && ctx.canvas.width === raster.w && ctx.canvas.height === raster.h;
  drawParts(ctx, terrainProjectedParts(world, raster, style, mp, v, look, whole));
}

/** 弯边投影里面按行重投影时,分几下画的每一下铺多少行画布 */
const PROJ_ROWS = 256;

/**
 * drawTerrainProjected 分几下画(见 common.ts 的 DrawPart;依次画完和 drawTerrainProjected 逐像素一样):
 * 面一下(split = 要分在几个任务里画时按画布行每 PROJ_ROWS 行一下;写实风放大后的一块视口:水、陆两份各一下),
 * 裁外轮廓一下,线和符号同 terrainDetailParts 各一下,最后撤掉裁剪。
 * whole = 整张地形图、缩放 1 倍(同 drawTerrainProjected 里的判断)
 */
export function terrainProjectedParts(world: World, raster: Raster, style: DetailStyle, mp: MapProj, v: { s: number; ox: number; oy: number; k: number }, look: SurfaceLook = 'classic', whole = false, split = false): DrawPart[] {
  const fantasy = style === 'fantasy';
  const pv = { ...v, proj: projector(mp) };
  const parts: DrawPart[] = [];
  if (fantasy || whole) {
    const base = () => (!fantasy ? realisticBase(raster, look) : whole ? fantasyBaseNoInk(world, raster) : fantasyBaseClean(world, raster));
    let row = 0;
    parts.push((ctx) => {
      if (!split) return void reprojectImage(ctx, base(), raster.w, raster.h, mp, v, whole ? 'medium' : 'low');
      const r1 = row + PROJ_ROWS;
      reprojectImage(ctx, base(), raster.w, raster.h, mp, v, whole ? 'medium' : 'low', [row, r1]);
      row = r1;
      return row < ctx.canvas.height;
    });
  } else parts.push(...realisticShoreParts(raster, pv, look));
  parts.push((ctx) => {
    ctx.save();
    clipOutline(ctx, mp, v);
  });
  if (fantasy) {
    if (!whole) parts.push(...fantasySeaLineParts(world, raster, pv), ...fantasyIceParts(world, raster, pv));
    parts.push(...fantasyCoastParts(raster, pv));
    if (whole) parts.push((ctx) => ctx.drawImage(fantasySymbolLayerProj(world, raster, mp), 0, 0));
    else parts.push(...fantasyVectorParts(world, pv));
  } else parts.push((ctx) => drawRealisticRivers(ctx, world, raster, pv, true, look));
  parts.push((ctx) => ctx.restore());
  return parts;
}

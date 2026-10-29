/**
 * 立体地形的手绘贴图:框的那一块当成一张小地图来画(后台线程里画;几条横条各自铺好像素以后拼成一整块再画,
 * 纸纹、林块、波纹不会在横条接缝处断开)。
 *
 * 平面地图上的手绘是按整颗星球的尺度画的:林块一个地块一团、海岸墨线和波纹按主图的像素宽,框一块放大来看又粗又大。
 * 这里按方框的大小重新定一"格"多大(boxStyle:方框长边约 BOX_STYLE_SPAN 格,和平面地图上一格的观感差不多),
 * 纸、水彩、海、海岸墨线、湖岸(render/fantasy.ts 的 fantasyBoxPixels)、林块(fantasyBoxForest)、河都按这一格画;
 * 不画山 / 丘陵 / 沙丘符号,起伏本身就是山。同一块每次画得一样。
 */
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import { drawRivers } from '../common';
import { fantasyBoxForest, fantasyBoxPixels, fantasyBoxRiverStyle } from '../fantasy';
import { KM_PER_UNIT } from '../../gen/civ/geo';
import { boxKm, kmPerUnitX, type ReliefBox } from './box';

/** 方框长边约多少格:电脑上立起来的那一块在屏幕上约一千像素宽,手机约四百 */
export const BOX_STYLE_SPAN = { desktop: 1000, phone: 420 };

/** 细的那一档上一格最少几个贴图像素(很小的框贴图本来就粗,线再细就看不见了) */
const MIN_UNIT_PX = 0.85;

/** 这一块的一格:unit = 一格几个世界单位(南北向),ax = 东西向拉宽几倍 */
export interface BoxStyle {
  unit: number;
  ax: number;
}

/**
 * 这一块的一格。fineS = 细的那一档每世界单位几个像素:细的一档上一格至少 MIN_UNIT_PX 个像素;粗的一档按同样的世界大小画
 * (林块、波纹和细的一档在同一处,换上细的只是变清楚)。
 * ax:贴图按经纬度铺,立起来以后东西向按 cos 纬度压回去,画上去的圆要先横着拉宽才是圆的
 */
export function boxStyle(box: ReliefBox, H: number, phone: boolean, fineS: number): BoxStyle {
  const km = boxKm(box, H);
  const span = phone ? BOX_STYLE_SPAN.phone : BOX_STYLE_SPAN.desktop;
  const unit = Math.max(Math.max(km.w, km.h) / span / KM_PER_UNIT, MIN_UNIT_PX / fineS);
  return { unit, ax: KM_PER_UNIT / kmPerUnitX(box.cy, H) };
}

/** 几条横条拼好的一整块(四周多铺 pad 像素):海拔、年均温、水陆、群落 */
export interface BoxFields {
  w: number;
  h: number;
  elev: Float32Array;
  temp: Float32Array;
  water: Uint8Array;
  biome: Uint8Array;
}

/**
 * 在 ctx(方框那一块,w × h)上画手绘贴图。f = 四周多铺了 pad 像素的那一块;S 倍主图(宽 Wpx)上方框左上角在 (x0, y0);
 * u = 一格几个像素;ax 同 boxStyle
 */
export function paintFantasyBox(ctx: CanvasRenderingContext2D, world: World, f: BoxFields, pad: number, S: number, bx0: number, y0: number, u: number, ax: number): void {
  const Wpx = Math.round(world.width * S);
  const Hpx = Math.round(world.height * S);
  // 方框可以在左右相连的哪一圈上:挪到主图那一圈里(河两边都画,噪声东西相连)
  const x0 = ((bx0 % Wpx) + Wpx) % Wpx;
  const r = {
    w: f.w,
    h: f.h,
    scale: S,
    elev: f.elev,
    temp: f.temp,
    water: f.water,
    biome: f.biome,
    precip: new Float32Array(0),
    cell: new Int32Array(0),
    ice: new Float32Array(0),
    iceConc: new Uint8Array(0),
    iceTone: new Uint8Array(0),
    wrap: true,
    win: { x0: x0 - pad, y0: y0 - pad, W: Wpx, H: Hpx },
  } as Raster;
  const px = fantasyBoxPixels(r, u);
  ctx.putImageData(new ImageData(px, f.w, f.h), -pad, -pad);
  fantasyBoxForest(ctx, r, pad, u, ax, world.params.seed, world.width);
  // 河:按世界坐标画,粗细按这一格。跨过接缝的框:接缝左边按主图那一圈画,右边按往东挪一整圈画(各裁在自己那半边,不重画)
  const style = fantasyBoxRiverStyle(world.riverThreshold, u / S);
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const seam = Wpx - x0;
  const rivers = (ox: number, a: number, b: number) => {
    ctx.save();
    ctx.beginPath();
    ctx.rect(a, 0, b - a, ch);
    ctx.clip();
    drawRivers(ctx, world.rivers, { s: S, ox, oy: -y0, k: 1, wrap: world.width }, world.riverThreshold, style);
    ctx.restore();
  };
  if (seam >= cw) rivers(-x0, 0, cw);
  else {
    rivers(-x0, 0, seam);
    rivers(seam, seam, cw);
  }
}

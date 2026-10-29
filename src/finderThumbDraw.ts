/// <reference lib="webworker" />
/**
 * 照故事找世界列表里的小图,在后台线程里画成和地图一样的样子(finderWorker.ts 推完一个世界、量完以后叫):
 * 手绘画风、国家色块和国界(开场那年),框住故事里的几国(gen/finder/measure.ts 的 thumbOf 挑好的那一块),
 * 国都点上角色色的圆点,存成一张小 JPEG。只画列表上会出现的那几种配法(各种门槛下最合、差一条以内的)。
 * 线程里不能画图(没有 OffscreenCanvas)的浏览器不画,界面上照旧按色块画(ui/finderThumb.ts)。
 */
import type { World } from './gen/world';
import type { Civ } from './gen/civ/types';
import { rasterize } from './gen/raster';
import { drawMapCiv, drawMapTerrain, type ExportMapParams } from './render/export';
import type { CivShow } from './render/civ/show';
import type { SeedReport } from './gen/finder/query';

/** 铺像素的倍数(整张 1024 × 512 左右;框住的那一块再缩成小图) */
const SCALE = 0.5;
/** 小图画多大(列表里约 92 × 69,两倍像素) */
const OUT = 2;
/** 只铺国家色块、国界(不写字、不画城点和路:小图上看不清,也省时间) */
const SHOW: CivShow = {
  habitat: false,
  regions: false,
  sites: false,
  routes: false,
  labels: false,
  cultures: false,
  polities: true,
  faiths: false,
  eras: false,
  control: false,
  ideology: false,
  resources: false,
  wars: false,
  plague: false,
};
/** 角色的颜色(和界面上一样:蓝、橙、紫) */
const ROLE = ['#2f6fd6', '#d9822b', '#8a5cc2'];
const JPEG_Q = 0.82;

/** 画好的小图写进 report 里各种配法的 thumb.img;返回要随消息交出去的那几块内存 */
export async function drawThumbs(world: World, civ: Civ, report: SeedReport): Promise<ArrayBuffer[]> {
  const want = report.cands.filter((c) => c.thumb?.win);
  if (!want.length || typeof OffscreenCanvas === 'undefined') return [];
  const raster = rasterize(world, SCALE, false);
  const make = (w: number, h: number) => new OffscreenCanvas(w, h);
  const terrain = new OffscreenCanvas(raster.w, raster.h);
  const tctx = terrain.getContext('2d');
  const full = new OffscreenCanvas(raster.w, raster.h);
  const fctx = full.getContext('2d');
  if (!tctx || !fctx) return [];
  const base: ExportMapParams = { world, raster, civ, style: 'fantasy', layer: 'elevation', year: 0, show: SHOW };
  drawMapTerrain(tctx, base, make);
  const out: ArrayBuffer[] = [];
  let drawn = -1;
  // 同一年的几种配法共用一张(按年份排好,换年才重画文明层)
  for (const c of want.slice().sort((a, b) => a.year - b.year)) {
    const t = c.thumb!;
    if (drawn !== c.year) {
      fctx.clearRect(0, 0, full.width, full.height);
      fctx.drawImage(terrain, 0, 0);
      drawMapCiv(fctx, { ...base, year: c.year }, make);
      drawn = c.year;
    }
    const W = t.w * OUT;
    const H = t.h * OUT;
    const o = new OffscreenCanvas(W, H);
    const octx = o.getContext('2d');
    if (!octx) continue;
    const [x0, y0, ww, wh] = t.win!;
    const sx = x0 * raster.scale;
    const sy = y0 * raster.scale;
    const sw = ww * raster.scale;
    const sh = wh * raster.scale;
    octx.imageSmoothingQuality = 'high';
    // 左右接着的世界:框跨过边上的,两边各取一截(超出画布的部分浏览器按比例裁掉)
    for (const shift of [-raster.w, 0, raster.w]) octx.drawImage(full, sx + shift, sy, sw, sh, 0, 0, W, H);
    for (let i = 0; i * 2 + 1 < t.dots.length; i++) {
      const x = t.dots[i * 2] * OUT;
      const y = t.dots[i * 2 + 1] * OUT;
      if (!(x >= 0 && x <= W && y >= 0 && y <= H)) continue;
      octx.beginPath();
      octx.arc(x, y, 3.4, 0, Math.PI * 2);
      octx.fillStyle = '#fff';
      octx.fill();
      octx.beginPath();
      octx.arc(x, y, 2.3, 0, Math.PI * 2);
      octx.fillStyle = ROLE[i % ROLE.length];
      octx.fill();
    }
    const blob = await o.convertToBlob({ type: 'image/jpeg', quality: JPEG_Q });
    const buf = await blob.arrayBuffer();
    t.img = buf;
    t.px = new Uint8Array(0);
    t.ter = new Uint8Array(0);
    t.pal = [];
    out.push(buf);
  }
  terrain.width = terrain.height = full.width = full.height = 0;
  return out;
}

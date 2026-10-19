/**
 * 文明叠加层 · 瘟疫:地图上闹瘟疫的州铺一层墨点(历史地图集、流行病地图常用的点状符号:越密越重)。
 * 数据全是推演记下的(gen/civ/plagueSpans.ts:每一场瘟疫染了哪些城、哪一年染上、死几成),不改推演。
 *
 *   - 哪些州:这一年正在闹、或疫过不久的州(染上后 HOLD 年里照画,再过 FADE 年淡完)
 *   - 多密:死得越多、离起疫那年越近(疫源附近)越密(plagueZone)
 *   - 点按世界坐标排成错开的网格再抖一抖(同一个地方每次画出来一样);国界、地名照常压在上面,不挡颜色
 *
 * 和战事的斜线一样是"面":整张图画在文明底图上(drawPlague;弯边投影按行重投影,地球仪画进文明贴图),
 * 放大后的细节层按屏幕重画(drawPlagueDetail:点距、点大小 × pen,和线一样比地图放大得慢)。
 * 只在开着"国家"和"瘟疫"时画;不加悬停、点击。
 */
import type { Civ, Year } from '../../gen/civ/types';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import { plagueSpans } from '../../gen/civ/plagueSpans';
import { pixOf } from './highlight';
import type { CivDrawParams, CivStyle } from './overlay';
import { reprojectImage } from '../projection';

/** 染上以后照画几年,再过几年淡完 */
const HOLD = 2;
const FADE = 4;
/** 点距、点半径(世界单位;细节层再 × pen) */
const STEP = 5.2;
const DOT = 1.4;

export function plagueShown(p: Pick<CivDrawParams, 'show' | 'civ'>): boolean {
  return !!p.show.polities && !!p.show.plague && p.civ.polities.length > 0;
}

/** 墨点的颜色:手绘偏暖的墨色,别的画风近黑 */
function dotColor(style: CivStyle): string {
  return style === 'fantasy' ? 'rgba(48,44,40,0.78)' : 'rgba(40,40,46,0.8)';
}

/**
 * 第 year 年各州疫区的浓淡(0 = 不画,最浓 1):死几成(按 0.3 算满)和离起疫隔几年定浓淡,疫过 HOLD 年后在 FADE 年里淡完。
 * 没有疫区 = null
 */
export function plagueZone(civ: Civ, year: Year): Float32Array | null {
  let z: Float32Array | null = null;
  for (const s of plagueSpans(civ)) {
    if (s.start > year || s.end + HOLD + FADE <= year) continue;
    const G = Math.max(1, s.end - s.start);
    for (const h of s.hits) {
      const age = year - h.year;
      if (age < 0 || age >= HOLD + FADE) continue;
      const fade = age < HOLD ? 1 : 1 - (age - HOLD) / FADE;
      const sev = 0.5 + 0.5 * Math.min(1, h.loss / 0.3);
      const near = 1 - (0.45 * (h.year - s.start)) / (G + 1);
      const v = sev * near * fade;
      if (!(v > 0)) continue;
      z ??= new Float32Array(civ.regions.count);
      z[h.region] = Math.max(z[h.region], v);
    }
  }
  return z;
}

/** 0–1 的整数哈希(点的抖动、取舍;同一格每次一样) */
function rnd(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 各州在世界坐标里的外框 [x0, y0, x1, y1](按像素归属表;跨 ±180° 的州框很宽,只是多扫几格) */
const boxCache = new WeakMap<Int16Array, Float32Array>();
function regionBoxes(pix: Int16Array, raster: Raster, R: number): Float32Array {
  let b = boxCache.get(pix);
  if (b) return b;
  const { w, h, scale: S } = raster;
  b = new Float32Array(R * 4);
  for (let r = 0; r < R; r++) {
    b[r * 4] = b[r * 4 + 1] = Infinity;
    b[r * 4 + 2] = b[r * 4 + 3] = -Infinity;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = pix[y * w + x];
      if (r < 0 || r >= R) continue;
      const o = r * 4;
      if (x < b[o]) b[o] = x;
      if (y < b[o + 1]) b[o + 1] = y;
      if (x + 1 > b[o + 2]) b[o + 2] = x + 1;
      if (y + 1 > b[o + 3]) b[o + 3] = y + 1;
    }
  }
  for (let i = 0; i < b.length; i++) b[i] /= S;
  boxCache.set(pix, b);
  return b;
}

/**
 * 逐个疫区州扫它外框里的点(世界坐标,点距 step):落在这一州、按浓淡取舍留下的点交给 put(x, y, 浓淡)。
 * cull = 只要这一块(世界坐标,x 可以伸进右边接的那一份);x 展开的部分按一整圈取模找州
 */
function eachDot(
  world: World,
  raster: Raster,
  civ: Civ,
  z: Float32Array,
  step: number,
  cull: readonly [number, number, number, number] | undefined,
  put: (x: number, y: number, v: number) => void,
): void {
  const pix = pixOf(world, raster, civ);
  const { w, h, scale: S } = raster;
  const W = world.width;
  const box = regionBoxes(pix, raster, civ.regions.count);
  const shifts = cull && Number.isFinite(cull[0]) ? (cull[2] > W ? [0, W] : cull[0] < 0 ? [-W, 0] : [0]) : [0];
  for (let r = 0; r < z.length; r++) {
    const v = z[r];
    if (!(v > 0) || !(box[r * 4 + 2] > box[r * 4])) continue;
    for (const sh of shifts) {
      let x0 = box[r * 4] + sh;
      let x1 = box[r * 4 + 2] + sh;
      let y0 = box[r * 4 + 1];
      let y1 = box[r * 4 + 3];
      if (cull && Number.isFinite(cull[0])) {
        x0 = Math.max(x0, cull[0] - step);
        x1 = Math.min(x1, cull[2] + step);
        y0 = Math.max(y0, cull[1] - step);
        y1 = Math.min(y1, cull[3] + step);
      }
      if (!(x1 > x0) || !(y1 > y0)) continue;
      const j0 = Math.floor(y0 / step) - 1;
      const j1 = Math.ceil(y1 / step) + 1;
      for (let j = j0; j <= j1; j++) {
        const off = (j & 1) * 0.5;
        const i0 = Math.floor(x0 / step - off) - 1;
        const i1 = Math.ceil(x1 / step - off) + 1;
        for (let i = i0; i <= i1; i++) {
          const x = (i + off + (rnd(i, j) - 0.5) * 0.6) * step;
          const y = (j + (rnd(j + 7, i + 3) - 0.5) * 0.6) * step;
          if (x < x0 || x >= x1 || y < y0 || y >= y1) continue;
          const xi = Math.floor((((x % W) + W) % W) * S);
          const yi = Math.floor(y * S);
          if (yi < 0 || yi >= h || pix[yi * w + Math.min(w - 1, xi)] !== r) continue;
          if (rnd(i * 3 + 1, j * 5 + 2) > 0.25 + 0.75 * v) continue;
          put(x, y, v);
        }
      }
    }
  }
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
const canvasCache = new WeakMap<Civ, { raster: unknown; key: string; canvas: AnyCanvas }>();

function makeCanvas(w: number, h: number): AnyCanvas {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

/** 浓淡表的指纹:疫区一样(浓淡按 1/8 一档)就用上次画好的 */
function zoneKey(z: Float32Array): string {
  let k = '';
  for (let r = 0; r < z.length; r++) if (z[r] > 0) k += `${r}:${Math.round(z[r] * 8)},`;
  return k;
}

/** 整张图的疫区墨点(画布 = raster.w × raster.h;弯边投影按行重投影) */
export function drawPlague(ctx: CanvasRenderingContext2D, p: CivDrawParams): void {
  if (!plagueShown(p)) return;
  const z = plagueZone(p.civ, p.year);
  if (!z) return;
  const { raster, civ, world } = p;
  const { w, h, scale: S } = raster;
  const key = `${p.style}|${zoneKey(z)}`;
  let hit = canvasCache.get(civ);
  if (!hit || hit.raster !== raster || hit.key !== key) {
    const canvas = hit && hit.raster === raster ? hit.canvas : makeCanvas(w, h);
    const c = canvas.getContext('2d') as CanvasRenderingContext2D;
    c.clearRect(0, 0, w, h);
    c.fillStyle = dotColor(p.style);
    c.beginPath();
    const W = world.width;
    eachDot(world, raster, civ, z, STEP, undefined, (x, y, v) => {
      const rr = DOT * S * (0.7 + 0.5 * v);
      // 挨着左右边的点在另一边再画一份(东西相连)
      for (const sx of x < 2 * DOT ? [x, x + W] : x > W - 2 * DOT ? [x, x - W] : [x]) {
        c.moveTo(sx * S + rr, y * S);
        c.arc(sx * S, y * S, rr, 0, Math.PI * 2);
      }
    });
    c.fill();
    hit = { raster, key, canvas };
    canvasCache.set(civ, hit);
  }
  if (p.proj) reprojectImage(ctx, hit.canvas, w, h, p.proj.mp, { s: S, ox: 0, oy: 0 });
  else ctx.drawImage(hit.canvas, 0, 0);
}

/** 放大后的细节层:按 cull 那一块画点(点距、点大小 × pen);弯边投影逐点投影。坐标是"地图平面 × S" */
export function drawPlagueDetail(ctx: CanvasRenderingContext2D, p: CivDrawParams): void {
  if (!plagueShown(p)) return;
  const z = plagueZone(p.civ, p.year);
  if (!z) return;
  const S = p.raster.scale;
  const pen = p.pen ?? 1;
  const pj = p.proj;
  ctx.save();
  ctx.fillStyle = dotColor(p.style);
  ctx.beginPath();
  eachDot(p.world, p.raster, p.civ, z, STEP * pen, p.cull, (x, y, v) => {
    const rr = DOT * S * pen * (0.7 + 0.5 * v);
    const px = pj ? (pj.W / 2 + pj.K(y) * pj.rel(x)) * S : x * S;
    const py = pj ? pj.Y(y) * S : y * S;
    ctx.moveTo(px + rr, py);
    ctx.arc(px, py, rr, 0, Math.PI * 2);
  });
  ctx.fill();
  ctx.restore();
}

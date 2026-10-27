/**
 * 照故事找世界结果列表里的小图:后台线程一般已经画成了手绘地图的样子(finderThumbDraw.ts,JPEG),直接用;
 * 线程里画不了图的浏览器交来的是调色板下标(gen/finder/measure.ts 的 thumbOf),这里按地形打底、各国颜色铺在上面、
 * 国界海岸描深一点、故事里各国的国都一个小圆点,画成图片地址。同一张只做一次。
 */
import type { FinderThumb } from '../gen/finder/query';

/** 地形打底(和手绘地图的海色、纸色、林地、山地相近;下标同 FinderThumb.ter) */
const TER: readonly [number, number, number][] = [
  [172, 190, 182], // 海、湖
  [176, 186, 136], // 平地
  [221, 205, 160], // 干地
  [190, 172, 132], // 丘陵
  [160, 148, 128], // 高山
  [234, 234, 228], // 冰雪
];
/** 各国颜色铺多浓 */
const TINT = 0.5;
/** 国界、海岸的像素暗多少 */
const BORDER = 0.72;
const COAST = 0.82;
/** 角色的颜色(和条件页、地图上的小牌子一样:蓝、橙、紫) */
export const ROLE_RGB: readonly string[] = ['#2f6fd6', '#d9822b', '#8a5cc2'];
/** 画大几倍(图片在列表里约 92 × 69,高清屏上清楚) */
const SCALE = 2;

const cache = new WeakMap<FinderThumb, string>();
/** 给后台画好的小图开的图片地址(浏览器替它留着那块内存,不用了要放掉) */
const blobs = new Set<string>();

/** 这一批结果不要了(换了条件重新搜、离开新建):小图占的内存放掉 */
export function dropThumbUrls(): void {
  for (const u of blobs) URL.revokeObjectURL(u);
  blobs.clear();
}

export function thumbUrl(t: FinderThumb): string | null {
  const hit = cache.get(t);
  if (hit) return hit;
  // 后台线程已经画成了手绘地图的样子:直接用那张
  if (t.img && t.img.byteLength && typeof URL !== 'undefined' && typeof Blob !== 'undefined') {
    const url = URL.createObjectURL(new Blob([t.img], { type: 'image/jpeg' }));
    cache.set(t, url);
    blobs.add(url);
    return url;
  }
  if (typeof document === 'undefined' || !t.px.length) return null;
  const c = document.createElement('canvas');
  c.width = t.w;
  c.height = t.h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(t.w, t.h);
  const sea = (k: number) => (t.ter?.[k] ?? 0) === 0;
  for (let k = 0; k < t.px.length; k++) {
    const base = TER[t.ter?.[k] ?? 0] ?? TER[0];
    const p = t.px[k];
    let col = base;
    if (p >= 2) {
      const v = t.pal[p] ?? 0;
      const rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
      col = [base[0] + (rgb[0] - base[0]) * TINT, base[1] + (rgb[1] - base[1]) * TINT, base[2] + (rgb[2] - base[2]) * TINT];
    }
    // 国界、海岸描深一点(像地图上的线)
    const x = k % t.w;
    let dark = 1;
    if (!sea(k)) {
      const right = x + 1 < t.w ? k + 1 : -1;
      const down = k + t.w < t.px.length ? k + t.w : -1;
      for (const o of [right, down]) {
        if (o < 0) continue;
        if (sea(o)) dark = Math.min(dark, COAST);
        else if (t.px[o] !== p) dark = Math.min(dark, BORDER);
      }
    }
    img.data[k * 4] = col[0] * dark;
    img.data[k * 4 + 1] = col[1] * dark;
    img.data[k * 4 + 2] = col[2] * dark;
    img.data[k * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // 放大一点再点国都(点是圆的,不跟着像素变方)
  const out = document.createElement('canvas');
  out.width = t.w * SCALE;
  out.height = t.h * SCALE;
  const o = out.getContext('2d');
  if (!o) return null;
  o.imageSmoothingEnabled = true;
  o.drawImage(c, 0, 0, out.width, out.height);
  for (let i = 0; i * 2 + 1 < t.dots.length; i++) {
    const x = t.dots[i * 2] * SCALE;
    const y = t.dots[i * 2 + 1] * SCALE;
    if (x < 0 || x > out.width) continue;
    o.beginPath();
    o.arc(x, y, 3.2, 0, Math.PI * 2);
    o.fillStyle = '#fff';
    o.fill();
    o.beginPath();
    o.arc(x, y, 2.2, 0, Math.PI * 2);
    o.fillStyle = ROLE_RGB[i % ROLE_RGB.length];
    o.fill();
  }
  const url = out.toDataURL('image/png');
  c.width = c.height = out.width = out.height = 0;
  cache.set(t, url);
  return url;
}

/**
 * 河谷:沿河(和放大后的小溪)刻出谷底、谷壁,写入下切深度和"离河多近"。
 * 河道几何用画河的同一套(riverGeometry.ts:平滑、样条、弯一弯、支流接到干流上),谷底正好在画出来的河下面。
 * 纯计算:不碰页面,worker / Node 都能跑(细沟的帮手线程也用:只带这一小块,不带整个铺像素)。
 */
import { riverGeometry } from './riverGeometry';
import { smoothstep } from './util';

/** 写实风画河的参数(src/render/realistic.ts):河谷宽度跟着画出来的河宽走 */
const RIVER_STYLE = { color: '', minW: 0.5, maxW: 7.5, fluxRef: 1000 };
const RIVER_FLARE = 1.7;
const RIVER_POWER = 0.65;

/** 刻河谷用的河道几何(世界单位;河道的 x 已展开成连续的,可能出左右边) */
export type ValleyLines = ReturnType<typeof riverGeometry>;

/**
 * 河道中心线和河宽:用画河的同一套几何(riverGeometry:平滑 + 样条、支流接到干流上),这样谷底正好在画出来的河下面。
 * rivers 可以带上比成河门槛更小的溪流(threshold 仍是成河门槛:溪流的谷浅一些)
 */
export function valleyLines(rivers: { pts: Float32Array }[], threshold: number, width: number): ValleyLines {
  return riverGeometry(rivers, threshold, RIVER_STYLE, RIVER_FLARE, RIVER_POWER, width);
}

/**
 * 沿每条河刻出河谷:写入下切深度 carve(米)和噪声抑制系数 calm(0..1),都取各河段的最大值。
 * 画布是 w × h 像素(scale 像素 / 世界单位),左上角在 scale 倍主图的 (ox, oy) 像素;period = scale 倍主图的宽
 * (东西相连:出边的那段在另一边再刻一份)。整张主图 ox = oy = 0、period = w;放大现算的一块见 gen/rasterWindow.ts。
 * 流量不到成河门槛的溪流(threshold)谷更浅、更窄
 */
export function carveValleys(
  lines: ValleyLines,
  threshold: number,
  scale: number,
  w: number,
  h: number,
  carve: Float32Array,
  calm: Float32Array,
  ox = 0,
  oy = 0,
  period = w,
) {
  const span = RIVER_STYLE.maxW - RIVER_STYLE.minW;
  // 河道加密得很细(弯要画得出来);刻谷按这张图的像素,太短的几段并成一段
  const min2 = (CARVE_STEP / scale) ** 2;
  for (const d of lines) {
    const n = d.x.length;
    for (let i = 0, j = 1; i < n - 1; i = j, j = i + 1) {
      while (j < n - 1 && (d.x[j] - d.x[i]) ** 2 + (d.y[j] - d.y[i]) ** 2 < min2) j++;
      const rw = 0.5 * (d.w[i] + d.w[j]); // 河宽(世界单位)
      const t = Math.min(1, Math.max(0, (rw - RIVER_STYLE.minW) / span)); // 河的大小 0..1
      const fl = 0.5 * (d.f[i] + d.f[j]);
      // 溪流:按流量收(成河门槛的 1/5 时约一半)
      const cf = fl < threshold ? Math.sqrt(Math.max(0, fl) / threshold) : 1;
      const flat = 0.5 * rw * scale; // 谷底 ≈ 河面半宽
      const wall = flat + (2.5 + 1.5 * t) * scale * (cf < 1 ? 0.5 + 0.5 * cf : 1); // 谷壁在河岸外 2.5–4 像素内收住
      const reach = wall + 2 * scale; // 噪声抑制再往外延一点
      const depth = cf < 1 ? (30 + 50 * t) * cf : 30 + 50 * t;
      const ax = d.x[i] * scale - ox;
      const bx = d.x[j] * scale - ox;
      const ay = d.y[i] * scale - oy;
      const by = d.y[j] * scale - oy;
      if (Math.min(ay, by) - reach > h || Math.max(ay, by) + reach < 0) continue;
      for (const s of WRAP_SHIFTS) {
        const sh = s * period;
        if (Math.min(ax, bx) + sh - reach > w || Math.max(ax, bx) + sh + reach < 0) continue;
        valleySegment(carve, calm, w, h, ax + sh, ay, bx + sh, by, depth, flat, wall, reach);
      }
    }
  }
}

/** 刻河谷的 calm(0..1)存成一个字节(Raster.bank) */
export function bankBytes(calm: Float32Array): Uint8Array {
  const out = new Uint8Array(calm.length);
  for (let k = 0; k < calm.length; k++) out[k] = calm[k] * 255 + 0.5;
  return out;
}

/** 刻谷时相邻两点至少隔几个像素(更近的并成一段;弯离直线不到 ¼ 像素) */
const CARVE_STEP = 2;

/** 东西相连的主图上,一样东西画在哪几份:本身、往左挪一整圈、往右挪一整圈(× 图宽) */
const WRAP_SHIFTS = [0, -1, 1];

/** 一小段直线河道:在它周围 reach 像素内写入河谷剖面(谷底平、谷壁平滑收起)。 */
function valleySegment(
  carve: Float32Array,
  calm: Float32Array,
  w: number,
  h: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  depth: number,
  flat: number,
  wall: number,
  reach: number,
) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach - 0.5));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + reach));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - reach - 0.5));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + reach));
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  const R2 = reach * reach;
  for (let py = y0; py <= y1; py++) {
    const qy = py + 0.5 - ay;
    for (let px = x0; px <= x1; px++) {
      const qx = px + 0.5 - ax;
      let s = L2 > 0 ? (qx * dx + qy * dy) / L2 : 0;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      const ex = qx - s * dx;
      const ey = qy - s * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 >= R2) continue;
      const dist = Math.sqrt(d2);
      const k = py * w + px;
      const cv = depth * (1 - smoothstep(flat, wall, dist));
      if (cv > carve[k]) carve[k] = cv;
      const q = 1 - smoothstep(flat, reach, dist);
      if (q > calm[k]) calm[k] = q;
    }
  }
}

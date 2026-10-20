/**
 * 主图(东西相连的等距圆柱图,gen/raster.ts 的 Raster)上的一块:编辑地形以后只重铺、重画变了的那块,用它记范围。
 * 行从 y0 起往下 h 行;列从 x0 起往右 w 列,出了右边的接回左边(0 ≤ x0 < 主图宽,w ≤ 主图宽;w = 主图宽 = 整圈)。
 * 纯计算,不碰 DOM。
 */
export interface PixelBox {
  x0: number;
  y0: number;
  w: number;
  h: number;
}

/** 框里的列分成不出右边的一两段 [起, 止)(跨右边的:右边一段 + 从第 0 列起的一段) */
export function boxSpans(b: PixelBox, W: number): [number, number][] {
  const end = b.x0 + b.w;
  return end <= W ? [[b.x0, end]] : [
    [b.x0, W],
    [0, end - W],
  ];
}

/**
 * 有变化的列(col[x] ≠ 0)和行 y0..y1(含)→ 框。列:绕一圈找最长的一段没变的,框 = 剩下的那一段(东西相连)。
 * 没有一列有变化 = null
 */
export function boxOfCols(col: Uint8Array, y0: number, y1: number): PixelBox | null {
  const W = col.length;
  if (y1 < y0) return null;
  let best = 0;
  let bestEnd = 0;
  let run = 0;
  for (let k = 0; k < 2 * W; k++) {
    if (col[k % W]) run = 0;
    else if (++run > best && run <= W) {
      best = run;
      bestEnd = k;
    }
  }
  if (best >= W) return null;
  return { x0: best ? (bestEnd + 1) % W : 0, y0, w: W - best, h: y1 - y0 + 1 };
}

/**
 * 框往四周扩:上下各 dy 行(到图的上下边为止);左右各 dx(py) 列(dx 按扩完以后各行里最大的那个算,
 * 高纬度同样的地面距离占的列多);左右合起来够一整圈就是整圈
 */
export function growBox(b: PixelBox, dx: number | ((py: number) => number), dy: number, W: number, H: number): PixelBox {
  const y0 = Math.max(0, b.y0 - dy);
  const y1 = Math.min(H - 1, b.y0 + b.h - 1 + dy);
  let mx = 0;
  if (typeof dx === 'number') mx = dx;
  else for (let y = y0; y <= y1; y++) mx = Math.max(mx, dx(y));
  mx = Math.max(0, Math.ceil(mx));
  const w = b.w + 2 * mx;
  if (w >= W) return { x0: 0, y0, w: W, h: y1 - y0 + 1 };
  return { x0: (((b.x0 - mx) % W) + W) % W, y0, w, h: y1 - y0 + 1 };
}

/** 两个框合起来(都在同一张 W × H 的图上):行取并,列取包住两段的最短一段(东西相连) */
export function unionBox(a: PixelBox | null, b: PixelBox | null, W: number): PixelBox | null {
  if (!a) return b;
  if (!b) return a;
  const col = new Uint8Array(W);
  for (const x of [a, b]) for (const [s, e] of boxSpans(x, W)) col.fill(1, s, e);
  const y0 = Math.min(a.y0, b.y0);
  const y1 = Math.max(a.y0 + a.h, b.y0 + b.h) - 1;
  return boxOfCols(col, y0, y1);
}

/** (x, y) 在不在框里 */
export function inBox(b: PixelBox, x: number, y: number, W: number): boolean {
  if (y < b.y0 || y >= b.y0 + b.h) return false;
  const d = x - b.x0;
  return (d < 0 ? d + W : d) < b.w;
}

/** 框里有几个像素 */
export function boxArea(b: PixelBox): number {
  return b.w * b.h;
}

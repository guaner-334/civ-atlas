/**
 * 立体地形的高低和网格(纯计算,后台线程、主线程、Node 都能跑;同一块每次算得一样):
 *   - stripHeights:放大现算的一块(gen/rasterWindow.ts)裁掉多铺的一圈,取每个像素的海拔(海面按 0,湖按湖面,陆地不低于 0)
 *   - horizonSlopes:每个像素往西看的"地平线"有多陡(米 / 公里)—— 太阳从西边来,坡度乘上起伏倍数比太阳高度还陡就落在影子里。
 *     和起伏倍数无关:滑条一拉,着色器里直接按新倍数判断,不用重算
 *   - buildMesh:方框里的海拔铺成网格(每隔 step 个像素一个点,取周围一小块的平均,免得细沟锯齿),带每个点的坡度(算光照);
 *     四边各一圈切面(像从地上切下来的一块沙盘)
 * 坐标:x 朝东、z 朝南(公里,方框中心为原点),高度单独存(米),着色器里乘起伏倍数。
 */
import type { Raster } from '../../gen/raster';
import type { SurfaceLook } from '../surface';

/** 立体用哪种上色:写实底图的几种画法(render/surface.ts),或者手绘(render/terrain3d/fantasyBox.ts) */
export type ReliefLook = SurfaceLook | 'fantasy';

/** 太阳高度(度)和它的正切:光从正西边来(和贴图自带的西北光差不多,转到北面看时阴面不会太重) */
export const SUN_ALT = 30;
export const SUN_TAN = Math.tan((SUN_ALT * Math.PI) / 180);

/** 放大现算的一块(四周多铺了 pad 像素)裁出中间 w × h 的海拔 */
export function stripHeights(r: Pick<Raster, 'w' | 'elev' | 'water'>, pad: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  const n = r.w;
  for (let y = 0; y < h; y++) {
    const row = (y + pad) * n + pad;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      out[y * w + x] = r.water[i] === 1 ? 0 : Math.max(0, r.elev[i]);
    }
  }
  return out;
}

/**
 * 每个像素往西(x 变小的方向)看出去,地面最陡的仰角正切(米 / 公里;看不到比自己高的 = 0)。
 * 只看同一行,所以按行分给几个线程各算各的也一样。往西最远看 maxPx 个像素;越远步子越大(远处的山要高很多才挡得住)
 */
export function horizonSlopes(elev: Float32Array, w: number, h: number, kmPerPx: number, maxPx: number): Float32Array {
  const out = new Float32Array(w * h);
  const grow = 1 / Math.max(1, maxPx * 0.25);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 1; x < w; x++) {
      const h0 = elev[row + x];
      let best = 0;
      for (let d = 1; d <= maxPx && d <= x; d += Math.max(1, Math.floor(d * grow))) {
        const s = (elev[row + x - d] - h0) / d;
        if (s > best) best = s;
      }
      out[row + x] = best / kmPerPx;
    }
  }
  return out;
}

/** 铺好的网格(给显卡) */
export interface ReliefMesh {
  /** 网格点数(东西、南北) */
  nx: number;
  ny: number;
  /** 每个点 5 个数:x、z(公里)、海拔(米)、往东、往南的坡度(米 / 公里) */
  verts: Float32Array;
  index: Uint32Array;
  /** 切面:每个点 5 个数:x、z、海拔(上沿的)、0 = 上沿 / 1 = 底、这一面的明暗 */
  skirt: Float32Array;
  /** 方框里最高处(米) */
  maxElev: number;
}

/**
 * 网格每隔几个像素一个点:点数不超过 maxVerts(电脑约 22 万、手机约 13 万,转起来都不卡)
 */
export function meshStep(w: number, h: number, maxVerts: number): number {
  let step = 1;
  while (Math.ceil(w / step) * Math.ceil(h / step) > maxVerts) step++;
  return step;
}

/**
 * w × h 像素的海拔铺成网格。kmX、kmZ = 方框东西、南北多少公里。
 * 每个点取周围 (2r+1)² 个像素的平均(r = step 的一半,至少 1);坡度按相邻两个点的差算
 */
export function buildMesh(elev: Float32Array, w: number, h: number, step: number, kmX: number, kmZ: number): ReliefMesh {
  const nx = Math.floor((w - 1) / step) + 1;
  const ny = Math.floor((h - 1) / step) + 1;
  const r = Math.max(1, Math.floor(step / 2));
  // 先横着、再竖着求滑动平均(和直接取方块平均一样,快很多)
  const rowAvg = new Float32Array(nx * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let i = 0; i < nx; i++) {
      const cx = i * step;
      let s = 0;
      let c = 0;
      for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
        s += elev[row + x];
        c++;
      }
      rowAvg[y * nx + i] = s / c;
    }
  }
  const hv = new Float32Array(nx * ny);
  let maxElev = 0;
  for (let j = 0; j < ny; j++) {
    const cy = j * step;
    for (let i = 0; i < nx; i++) {
      let s = 0;
      let c = 0;
      for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
        s += rowAvg[y * nx + i];
        c++;
      }
      const v = s / c;
      hv[j * nx + i] = v;
      if (v > maxElev) maxElev = v;
    }
  }
  const px = kmX / w;
  const pz = kmZ / h;
  const verts = new Float32Array(nx * ny * 5);
  for (let j = 0; j < ny; j++) {
    const z = ((j * step + 0.5) / h - 0.5) * kmZ;
    const j0 = Math.max(0, j - 1);
    const j1 = Math.min(ny - 1, j + 1);
    for (let i = 0; i < nx; i++) {
      const i0 = Math.max(0, i - 1);
      const i1 = Math.min(nx - 1, i + 1);
      const o = (j * nx + i) * 5;
      verts[o] = ((i * step + 0.5) / w - 0.5) * kmX;
      verts[o + 1] = z;
      verts[o + 2] = hv[j * nx + i];
      verts[o + 3] = (hv[j * nx + i1] - hv[j * nx + i0]) / Math.max(1e-6, (i1 - i0) * step * px);
      verts[o + 4] = (hv[j1 * nx + i] - hv[j0 * nx + i]) / Math.max(1e-6, (j1 - j0) * step * pz);
    }
  }
  const index = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let o = 0;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      index[o++] = a;
      index[o++] = c;
      index[o++] = b;
      index[o++] = b;
      index[o++] = c;
      index[o++] = d;
    }
  }
  return { nx, ny, verts, index, skirt: buildSkirt(verts, nx, ny), maxElev };
}

/** 四边的切面:沿边每两个相邻点一段,上沿跟着地面、下沿是平的底(底多深由着色器按起伏倍数定) */
function buildSkirt(verts: Float32Array, nx: number, ny: number): Float32Array {
  const edges: [number[], number][] = [
    // 南边(刚打开时朝着人)最亮,北边、东边暗一些
    [Array.from({ length: nx }, (_, i) => (ny - 1) * nx + i), 1],
    [Array.from({ length: nx }, (_, i) => nx - 1 - i), 0.8],
    [Array.from({ length: ny }, (_, j) => (ny - 1 - j) * nx), 0.88],
    [Array.from({ length: ny }, (_, j) => j * nx + nx - 1), 0.72],
  ];
  let n = 0;
  for (const [pts] of edges) n += (pts.length - 1) * 6;
  const out = new Float32Array(n * 5);
  let o = 0;
  const put = (v: number, t: number, tone: number) => {
    out[o++] = verts[v * 5];
    out[o++] = verts[v * 5 + 1];
    out[o++] = verts[v * 5 + 2];
    out[o++] = t;
    out[o++] = tone;
  };
  for (const [pts, tone] of edges) {
    for (let e = 0; e + 1 < pts.length; e++) {
      const a = pts[e];
      const b = pts[e + 1];
      put(a, 0, tone);
      put(a, 1, tone);
      put(b, 0, tone);
      put(b, 0, tone);
      put(a, 1, tone);
      put(b, 1, tone);
    }
  }
  return out;
}

/**
 * 钉山名的那一点:贴图上 (px, py) 附近 R 像素以内最高的那个像素(山顶;w × h 的海拔,超出的部分不看)。
 * 返回它在沙盘上的位置(公里,方框中心为原点;kmX、kmZ = 方框东西、南北多少公里)和海拔(米);(px, py) 不在贴图里 = null
 */
export function peakPin(elev: Float32Array, w: number, h: number, px: number, py: number, R: number, kmX: number, kmZ: number): { x: number; z: number; h: number } | null {
  const cx = Math.floor(px);
  const cy = Math.floor(py);
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return null;
  let best = cy * w + cx;
  for (let y = Math.max(0, cy - R); y <= Math.min(h - 1, cy + R); y++)
    for (let x = Math.max(0, cx - R); x <= Math.min(w - 1, cx + R); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > R * R) continue;
      if (elev[y * w + x] > elev[best]) best = y * w + x;
    }
  const bx = best % w;
  const by = (best - bx) / w;
  return { x: ((bx + 0.5) / w - 0.5) * kmX, z: ((by + 0.5) / h - 0.5) * kmZ, h: elev[best] };
}

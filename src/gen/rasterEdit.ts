/**
 * 编辑地形以后按块重铺主图(1 倍,gen/raster.ts):涂一笔,新旧两个世界只差一块,不用整张重铺。
 *
 *   1. 新世界铺像素的输入(柔化后的海拔、河谷下切、离河多近、三角形上的插值源,见 RasterInputs)整张算一遍(便宜),
 *      和上一张逐位比,得出输入变了的框;
 *   2. 逐像素那一步(shadeSphere)一个像素只看自己和上下左右的输入,外加海岸挪动时到"挪过去的地方"取海拔 ——
 *      挪多远有上限(细节噪声贴图的最大值 × 系数,东西向按 1 / cos 纬度放大):输入变了的框往外扩这么多(S1),
 *      框外的逐像素结果和原来逐位相同;
 *   3. 去陆地碎点(连通块最多几个像素)再往外扩一圈(W2):海冰、河岸、沟壑在 W2 里重做,W2 外和原来一样。
 *      为了 W2 里去碎点和整张一起做的一样,逐像素这一步按更大一圈(W3)做,多出的那圈换回原来的;
 *   4. 细沟(逐像素汇流)整张重算:汇流按海拔从低往高"灌水",一处变了,下游、远处的流向和先后都可能跟着变,
 *      局部算不出逐位相同的结果;它本来就在帮手线程里和推文明同时算,不占等的时间。
 * 结果和整张重铺逐位相同(tests/raster-edit.test.ts 核对)。纯计算,不碰 DOM。
 */
import type { World } from './world';
import {
  coastShiftMax,
  coverFits,
  dropSpecksIn,
  newGullyJob,
  noiseTiles,
  PLANE,
  rasterInputs,
  shadeSphere,
  speckMax,
  streamsOf,
  trimJobIn,
  type GullyJob,
  type Precomputed,
  type Raster,
  type RasterInputs,
} from './raster';
import type { VeinJob } from './pixelDrain';
import { seaIcePixels } from './seaice';
import { boxOfCols, boxSpans, growBox, inBox, type PixelBox } from './pixelBox';
import { subSeed } from './util';

/** 上一张整图连同它的输入(下一笔按块重铺要拿它比) */
export interface RasterKeep {
  /** 铺好的整张主图(1 倍,沟壑、细沟都在) */
  raster: Raster;
  inputs: RasterInputs;
}

/** 按块重铺的结果:沟壑(只有 W2 里的像素)、细沟(整张)还没算,交给帮手线程(同 rasterizeDeferred) */
export interface PatchJob {
  /** 新的整张主图(和原来那张不共用数组;gully、vein、veinLines 等算完再填) */
  raster: Raster;
  job: GullyJob;
  veins: VeinJob;
  inputs: RasterInputs;
  /** 重铺的那块(W2;null = 铺像素的输入一点没变):框外除细沟以外都和原来逐位相同 */
  win: PixelBox | null;
}

/** 去碎点往外扩几圈(碎点最多 speckMax(1) = 4 个像素:一块碎点离它里面任何一个像素最多 3 格,邻居 4 格) */
const SPECK_PAD = 6;

/**
 * 按块重铺:世界 world 和 prev 是同一张网格(编辑地形不换网格)才做,不是 = null(调用方整张铺)。
 * 要重铺的那块超过整张图的 maxFrac 就不划算,返回 { whole }:已经算好的输入,调用方整张铺时接着用
 * (rasterizeDeferred 的 pre),不用再算一遍
 */
export function rasterizePatch(world: World, prev: RasterKeep, maxFrac = 0.5): PatchJob | { whole: Precomputed } | null {
  const r0 = prev.raster;
  const { w: W, h: H } = r0;
  const N = W * H;
  if (r0.scale !== 1 || Math.round(world.width) !== W || Math.round(world.height) !== H) return null;
  const cover0 = prev.inputs.cover;
  if (!coverFits(cover0, world.mesh, W, H)) return null;
  const inputs = rasterInputs(world, cover0, prev.inputs);
  const changed = inputChange(prev.inputs, inputs, W, H);
  const seed = world.params.seed;
  const { g } = cover0;
  // 要重铺的几块:逐像素结果可能变的(S1)、去碎点以后的(W2)、逐像素多铺的一圈(W3)
  let w2: PixelBox | null = null;
  let w3: PixelBox | null = null;
  if (changed) {
    const dmax = coastShiftMax(seed, world.mesh.spacing, 1);
    const s1 = growBox(changed, (py) => dmax / Math.max(g.cosLat[py], 0.05) + 2, Math.ceil(dmax) + 2, W, H);
    w2 = growBox(s1, SPECK_PAD, SPECK_PAD, W, H);
    w3 = growBox(w2, SPECK_PAD, SPECK_PAD, W, H);
    if (w3.w * w3.h > maxFrac * N) return { whole: { inputs, cell: r0.cell } };
  }
  const raster: Raster = {
    w: W,
    h: H,
    scale: 1,
    elev: r0.elev.slice(),
    temp: r0.temp.slice(),
    precip: r0.precip.slice(),
    water: r0.water.slice(),
    biome: r0.biome.slice(),
    cell: r0.cell,
    ice: r0.ice.slice(),
    iceConc: r0.iceConc.slice(),
    iceTone: r0.iceTone.slice(),
    bank: r0.bank ? r0.bank.slice() : new Uint8Array(N),
    wrap: true,
  };
  const R = world.width / (2 * Math.PI);
  const job0 = newGullyJob(subSeed(seed, 'gully'), W, H, R, 1);
  const win = w2;
  if (w2 && w3) {
    // 海冰几样只有海冰像素才写:先清零(整张铺的时候是新开的全 0 数组)
    forRows(w3, W, (a, b) => {
      raster.ice.fill(0, a, b);
      raster.iceConc.fill(0, a, b);
      raster.iceTone.fill(0, a, b);
    });
    const { dTile, jTile } = noiseTiles(seed);
    shadeSphere(raster, cover0.tri, cover0.wa, cover0.wb, inputs.planes, inputs.base, inputs.carve, inputs.calm, dTile, jTile, g, R, world.mesh.spacing, job0, null, w3);
    dropSpecksIn(raster, speckMax(1), w3);
    // W3 比 W2 多出的那圈:换回原来的(那里本来就没变,去碎点只在 W2 里算得准)
    forRows(w3, W, (a, b) => {
      const y = (a / W) | 0;
      for (let k = a; k < b; k++) {
        if (inBox(w2, k - y * W, y, W)) continue;
        raster.elev[k] = r0.elev[k];
        raster.temp[k] = r0.temp[k];
        raster.precip[k] = r0.precip[k];
        raster.water[k] = r0.water[k];
        raster.biome[k] = r0.biome[k];
        raster.ice[k] = r0.ice[k];
        raster.iceConc[k] = r0.iceConc[k];
        raster.iceTone[k] = r0.iceTone[k];
      }
    });
    // 河岸(同 bankBytes)
    const bank = raster.bank!;
    const calm = inputs.calm;
    forRows(w2, W, (a, b) => {
      for (let k = a; k < b; k++) bank[k] = calm[k] * 255 + 0.5;
    });
    seaIcePixels(world, raster, w2);
  }
  // 沟壑:只算 W2 里的像素,叠在原来那张的沟壑上(W2 先清零)
  const into = r0.gully ? r0.gully.slice() : new Float32Array(N);
  if (win) forRows(win, W, (a, b) => into.fill(0, a, b));
  const job = trimJobIn(job0, win ?? { x0: 0, y0: 0, w: 0, h: 0 }, into);
  const veins: VeinJob = { w: W, h: H, scale: 1, elev: raster.elev, water: raster.water, bank: raster.bank!, streams: streamsOf(world) };
  return { raster, job, veins, inputs, win };
}

/** 框里每一行的一两段像素下标 [a, b)(全图下标) */
function forRows(b: PixelBox, W: number, f: (a: number, b: number) => void): void {
  const spans = boxSpans(b, W);
  for (let y = b.y0; y < b.y0 + b.h; y++) for (const [s, e] of spans) f(y * W + s, y * W + e);
}

/** 两份铺像素的输入逐位比:变了的像素的框(柔化后的海拔、河谷、离河多近、所在三角形的插值源;一点没变 = null) */
function inputChange(a: RasterInputs, b: RasterInputs, W: number, H: number): PixelBox | null {
  const nt = a.planes.length / PLANE;
  const pa = new Int32Array(a.planes.buffer, a.planes.byteOffset, a.planes.length);
  const pb = new Int32Array(b.planes.buffer, b.planes.byteOffset, b.planes.length);
  const triChanged = new Uint8Array(nt + 1);
  for (let t = 0; t < nt; t++) {
    const o = t * PLANE;
    for (let q = 0; q < PLANE; q++) {
      if (pa[o + q] !== pb[o + q]) {
        triChanged[t + 1] = 1;
        break;
      }
    }
  }
  const bits = (x: Float32Array) => new Int32Array(x.buffer, x.byteOffset, x.length);
  const col = new Uint8Array(W);
  let y0 = H;
  let y1 = -1;
  const mark = (y: number, x: number) => {
    col[x] = 1;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  // 接着用的(同一个数组)不用比
  const pairs: [Int32Array, Int32Array][] = [];
  if (a.base !== b.base) pairs.push([bits(a.base), bits(b.base)]);
  if (a.carve !== b.carve) pairs.push([bits(a.carve), bits(b.carve)]);
  if (a.calm !== b.calm) pairs.push([bits(a.calm), bits(b.calm)]);
  for (const [p, q] of pairs) {
    for (let k = 0; k < p.length; k++) {
      if (p[k] === q[k]) continue;
      const y = (k / W) | 0;
      mark(y, k - y * W);
    }
  }
  const tri = b.cover.tri;
  for (let k = 0; k < tri.length; k++) {
    if (!triChanged[tri[k]]) continue;
    const y = (k / W) | 0;
    mark(y, k - y * W);
  }
  return boxOfCols(col, y0, y1);
}

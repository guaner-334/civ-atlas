/**
 * 细沟(gen/pixelDrain.ts):逐像素汇流、串线、画进图里,和它怎么跟着主图走。
 *   - 汇流:每个陆地像素都流得到水里(洼地也流得出去),面积一点不丢;流进水里的记得是哪个水像素
 *   - 串线:太短的沟不要,不要的那段让出来(后面的沟照样能从那里过、接上);跨东西接缝的线是连着的
 *   - 画:沟头由淡变浓
 *   - 跟着主图:放大现算的块用整张图那一份;两倍的图缩回 1 倍算,和屏幕上的一样;地形大事的补丁带着这一段的沟
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { rasterize, streamsOf, type Raster } from '../src/gen/raster';
import { drainLines, pixelDrain, stampVeins, streamBeds, veinLinesOf, type DrainLines } from '../src/gen/pixelDrain';
import { valleyLines } from '../src/gen/valleys';
import { zoomSource } from '../src/gen/rasterWindow';
import { composeRaster, diffRaster } from '../src/gen/rasterPatch';

/** 顺着下游走到底(最多 n 步):返回最后的下游值(≤ −2 = 流进水里) */
function walk(recv: Int32Array, k: number, n: number): number {
  let i = k;
  for (let s = 0; s < n; s++) {
    const r = recv[i];
    if (r < 0) return r;
    i = r;
  }
  return Infinity;
}

/** 像素 (x, y) 的面积(和 pixelDrain 一样按纬度缩) */
function cellArea(y: number, h: number): number {
  return Math.fround(Math.cos(((y + 0.5) / h - 0.5) * Math.PI));
}

describe('逐像素汇流', () => {
  it('斜面和洼地:每个陆地像素都流到水里,集水面积一点不丢', () => {
    const w = 40;
    const h = 20;
    const elev = new Float32Array(w * h);
    const sink = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (x < 2) sink[k] = 255;
        // 往西低的斜面上挖一个坑(坑底比出口还低)
        const d = Math.hypot(x - 25, y - 10);
        elev[k] = x * 10 + (d < 6 ? -120 * (1 - d / 6) : 0) + ((x * 7 + y * 13) % 5);
      }
    const { recv, area } = pixelDrain(elev, sink, w, h, 1);
    let land = 0;
    let out = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (sink[k]) {
          expect(recv[k]).toBe(-1);
          continue;
        }
        land += cellArea(y, h);
        // 流得出去,最后流进的是一个水像素
        const end = walk(recv, k, w * h);
        expect(end).toBeLessThanOrEqual(-2);
        expect(sink[-2 - end]).toBeGreaterThan(0);
        if (recv[k] <= -2) out += area[k];
      }
    expect(out).toBeCloseTo(land, 3);
    // 坑里最低那点的水也流出去了(经过坑沿)
    expect(walk(recv, 10 * w + 25, w * h)).toBeLessThanOrEqual(-2);
  });

  it('东西相连:最右一列挨着最左一列的水', () => {
    const w = 16;
    const h = 6;
    const elev = new Float32Array(w * h).fill(100);
    const sink = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) sink[y * w] = 255;
    // 往东越来越低:水跨过接缝流进第 0 列
    for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) elev[y * w + x] = 200 - x * 10;
    const { recv } = pixelDrain(elev, sink, w, h, 1);
    for (let y = 0; y < h; y++) {
      const r = recv[y * w + w - 1];
      expect(r).toBeLessThanOrEqual(-2);
      expect((-2 - r) % w).toBe(0);
    }
  });
});

describe('串线', () => {
  /** w × h 的格子,按 [下游, 面积] 手搭一张水系 */
  function net(w: number, h: number, links: [number, number, number, number, number][]) {
    const recv = new Int32Array(w * h).fill(-1);
    const area = new Float32Array(w * h);
    for (const [x, y, rx, ry, a] of links) {
      recv[y * w + x] = rx < 0 ? -2 - (ry * w + -rx - 1) : ry * w + rx;
      area[y * w + x] = a;
    }
    return { recv, area };
  }

  it('太短的沟不要;不要的那段让出来,后面的沟照样从那里过、接到主沟上', () => {
    const w = 24;
    const h = 12;
    const links: [number, number, number, number, number][] = [];
    // 主沟:第 0 行往下到第 8 行,再沿第 8 行往西流进 (0, 8) 那个水像素
    for (let y = 0; y < 8; y++) links.push([20, y, 20, y + 1, 50 + y]);
    for (let x = 20; x >= 1; x--) links.push([x, 8, x > 1 ? x - 1 : -1, 8, 100 + (20 - x)]);
    // 短沟:(10, 6) → (10, 7) → 主沟上的 (10, 8)(长 2,不要;它先串)
    links.push([10, 6, 10, 7, 40]);
    links.push([10, 7, 10, 8, 90]);
    // 长沟:(16, 6) 往西,经过短沟上的 (10, 7) 接到主沟
    for (let x = 16; x > 12; x--) links.push([x, 6, x - 1, 6, 20 + (16 - x)]);
    links.push([12, 6, 11, 7, 25]);
    links.push([11, 7, 10, 7, 26]);
    const { recv, area } = net(w, h, links);
    const L = drainLines(recv, area, w, h, 1, 10, 3);
    const n = L.off.length - 1;
    expect(n).toBe(2);
    // 第二条(长沟)最后一点是主沟上的 (10, 8):中间没断
    const last = L.off[2] - 1;
    expect(L.x[last]).toBeCloseTo(10.5, 5);
    expect(L.y[last]).toBeCloseTo(8.5, 5);
    // 主沟画到水边那个像素
    const end = L.off[1] - 1;
    expect(L.x[end]).toBeCloseTo(0.5, 5);
    expect(L.y[end]).toBeCloseTo(8.5, 5);
  });

  it('跨东西接缝的沟,坐标接着展开(不在中间跳一整圈)', () => {
    const w = 20;
    const h = 4;
    const links: [number, number, number, number, number][] = [];
    // 第 1 行从 x = 15 往东流,过接缝到 x = 4,再流进 (5, 1) 的水
    const xs = [15, 16, 17, 18, 19, 0, 1, 2, 3, 4];
    xs.forEach((x, i) => links.push([x, 1, i + 1 < xs.length ? xs[i + 1] : -6, 1, 30 + i]));
    const { recv, area } = net(w, h, links);
    const L = drainLines(recv, area, w, h, 1, 10, 0);
    expect(L.off.length - 1).toBe(1);
    for (let i = 1; i < L.off[1]; i++) expect(Math.abs(L.x[i] - L.x[i - 1])).toBeLessThan(2);
  });

  it('沟头由淡变浓', () => {
    const lines: DrainLines = {
      off: Int32Array.of(0, 9),
      x: Float32Array.from({ length: 9 }, (_, i) => 4 + i * 2),
      y: new Float32Array(9).fill(10.5),
      a: new Float32Array(9).fill(400),
    };
    const out = new Uint8Array(40 * 20);
    stampVeins(lines, 1, 40, 20, out);
    const v = (x: number) => out[10 * 40 + x];
    expect(v(4)).toBeGreaterThan(0);
    expect(v(4)).toBeLessThan(v(12));
  });
});

describe('细沟跟着主图走', () => {
  let world: World;
  let whole: Raster;
  beforeAll(() => {
    world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 12000 });
    whole = rasterize(world, 1);
  });

  it('整张图带着沟;同一张图再算一遍一样;放大现算的块用整张图那一份(没带来就现算,也一样)', () => {
    const L = whole.veinLines!;
    expect(L.off.length).toBeGreaterThan(100);
    expect(whole.vein!.some((v) => v > 0)).toBe(true);
    const again = veinLinesOf(whole, streamsOf(world));
    expect(Array.from(again.off)).toEqual(Array.from(L.off));
    expect(Array.from(again.x)).toEqual(Array.from(L.x));
    expect(zoomSource(world, whole).veins).toBe(L);
    const fresh = zoomSource(world, { ...whole, veinLines: undefined }).veins;
    expect(Array.from(fresh.y)).toEqual(Array.from(L.y));
    expect(Array.from(fresh.a)).toEqual(Array.from(L.a));
  });

  it('两倍的图(没带沟)缩回 1 倍算:和屏幕上那张一样', () => {
    const W = whole.w * 2;
    const H = whole.h * 2;
    const elev = new Float32Array(W * H);
    const water = new Uint8Array(W * H);
    const bank = new Uint8Array(W * H);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = (y >> 1) * whole.w + (x >> 1);
        elev[y * W + x] = whole.elev[k];
        water[y * W + x] = whole.water[k];
        bank[y * W + x] = whole.bank![k];
      }
    const L = veinLinesOf({ w: W, h: H, scale: 2, elev, water, bank }, streamsOf(world));
    expect(Array.from(L.off)).toEqual(Array.from(whole.veinLines!.off));
    expect(Array.from(L.x)).toEqual(Array.from(whole.veinLines!.x));
  });

  it('河、溪本身也当作沟画在最后;先算好的浅谷和现算的一样', () => {
    const streams = streamsOf(world);
    const L = whole.veinLines!;
    const geom = valleyLines(streams.rivers, streams.threshold, streams.width);
    const n = L.off.length - 1;
    expect(n).toBeGreaterThan(geom.length);
    // 最后几条就是河、溪:起点、终点和河道一样
    for (let c = 0; c < geom.length; c++) {
      const d = geom[geom.length - 1 - c];
      const a = L.off[n - 1 - c];
      const b = L.off[n - c] - 1;
      expect(L.x[a]).toBe(Math.fround(d.x[0]));
      expect(L.y[b]).toBe(Math.fround(d.y[d.y.length - 1]));
    }
    const ready = streamBeds(streams, whole.w, whole.h, 1);
    const pre = veinLinesOf(whole, undefined, ready);
    expect(Array.from(pre.off)).toEqual(Array.from(L.off));
    expect(Array.from(pre.a)).toEqual(Array.from(L.a));
  });

  it('地形大事的补丁带着那一段的沟(拷一份);拼出来的主图用最后一段的', () => {
    const b: Raster = { ...whole, elev: whole.elev.slice() };
    for (let k = 1000; k < 1100; k++) b.elev[k] += 50;
    const lines = whole.veinLines!;
    b.veinLines = { off: lines.off.slice(0, 3), x: lines.x.slice(), y: lines.y.slice(), a: lines.a.slice() };
    const p = diffRaster(whole, b)!;
    expect(p.veins).toBeDefined();
    expect(p.veins!.off).not.toBe(b.veinLines.off);
    expect(Array.from(p.veins!.off)).toEqual(Array.from(b.veinLines.off));
    const c = composeRaster(whole, [p]);
    expect(Array.from(c.veinLines!.off)).toEqual(Array.from(b.veinLines.off));
    expect(whole.veinLines).toBe(lines);
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type BaseCache, type World } from '../src/gen/world';
import { rasterize, type Raster } from '../src/gen/raster';
import { exactPatch } from '../src/gen/rasterPatch';
import { boxSpans, inBox, type PixelBox } from '../src/gen/pixelBox';
import { macroGrids, realisticBandPixels, realisticPatchRegion, realisticPixels } from '../src/render/realistic';
import { fantasyPatchPixels, fantasyPixels } from '../src/render/fantasy';
import type { SurfaceLook } from '../src/render/surface';
import type { TerrainOp } from '../src/gen/edits';

/** 编辑地形前后的两张主图(整张铺),和补丁的框 */
const before = new Map<number, { w0: World; r0: Raster; cache: BaseCache }>();
function pair(seed: number, ops: (w: World) => TerrainOp[]): { w0: World; w1: World; r0: Raster; r1: Raster; box: PixelBox | null } {
  const params = { ...DEFAULT_PARAMS, seed };
  let b = before.get(seed);
  if (!b) {
    const cache: BaseCache = { base: null };
    const w0 = generateWorld(params, undefined, [], null, cache);
    before.set(seed, (b = { w0, r0: rasterize(w0, 1), cache }));
  }
  const { w0, r0, cache } = b;
  const w1 = generateWorld(params, undefined, ops(w0), null, cache);
  const r1 = rasterize(w1, 1);
  const p = exactPatch(r0, r1);
  return { w0, w1, r0, r1, box: p && p.w ? { x0: p.x0, y0: p.y0, w: p.w, h: p.h } : null };
}

/** 一块平地陆地的地块中心 */
function landAt(w: World, lo: number, hi: number, yMin = 0, yMax = Infinity): [number, number] {
  for (let i = 0; i < w.mesh.n; i++) {
    const y = w.mesh.y[i];
    if (w.water[i] === 0 && w.elevation[i] > lo && w.elevation[i] < hi && y >= yMin && y <= yMax) return [Math.round(w.mesh.x[i]), Math.round(y)];
  }
  throw new Error('没找到');
}

/** 两份 RGBA 第一个不一样的像素(都一样 = '') */
function firstDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, W: number, skip?: (x: number, y: number) => boolean): string {
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
    const k = i / 4;
    const x = k % W;
    const y = (k - x) / W;
    if (skip?.(x, y)) continue;
    return `(${x}, ${y})`;
  }
  return '';
}

/**
 * 写实:要重画的那块(realisticPatchRegion)以外,前后两张整张重画逐像素相同;那块按带子重画的结果和整张重画逐像素相同
 * (抗锯齿以前的那一份也一样)
 */
function checkRealistic(r0: Raster, r1: Raster, box: PixelBox | null, look: SurfaceLook): string {
  const W = r1.w;
  const H = r1.h;
  const g0 = macroGrids(r0);
  const g1 = macroGrids(r1);
  const region = realisticPatchRegion(box, g0, g1, W, H);
  const a = realisticPixels(r0, look);
  const b = realisticPixels(r1, look);
  const out = firstDiff(a.px, b.px, W, (x, y) => !!region && inBox(region, x, y, W));
  if (out) return `框外不一样 ${out}`;
  if (!region) return '';
  // 按带子画(带子高度故意取得不整齐,跨带子边也要接得上)
  const got = a.px.slice();
  const raw = a.raw.slice();
  for (let y = region.y0; y < region.y0 + region.h; y += 37) {
    const y1 = Math.min(region.y0 + region.h, y + 37);
    for (const p of realisticBandPixels(r1, g1, look, region, y, y1, true)) {
      for (let yy = 0; yy < y1 - y; yy++) {
        got.set(p.px.subarray(yy * p.n * 4, (yy + 1) * p.n * 4), ((y + yy) * W + p.x) * 4);
        raw.set(p.raw!.subarray(yy * p.n * 4, (yy + 1) * p.n * 4), ((y + yy) * W + p.x) * 4);
      }
    }
  }
  const d = firstDiff(got, b.px, W);
  if (d) return `按块重画不一样 ${d}`;
  const dr = firstDiff(raw, b.raw, W);
  return dr ? `抗锯齿之前不一样 ${dr}` : '';
}

/** 记下来的一批像素原色 → 像素下标 → 颜色 */
function patchMap(p: { k: Int32Array; c: Uint8ClampedArray; n: number }): Map<number, string> {
  const m = new Map<number, string>();
  for (let i = 0; i < p.n; i++) m.set(p.k[i], `${p.c[i * 3]},${p.c[i * 3 + 1]},${p.c[i * 3 + 2]}`);
  return m;
}

/** 手绘:按块重画(fantasyPatchPixels)和整张重画逐像素相同,墨线原色、波纹的场也一样 */
function checkFantasy(w0: World, r0: Raster, w1: World, r1: Raster, box: PixelBox | null): string {
  const W = r1.w;
  const prev = fantasyPixels(w0, r0);
  const full = fantasyPixels(w1, r1);
  const got = fantasyPatchPixels(w1, r1, w0, r0, box, prev);
  const d = firstDiff(got.px, full.px, W);
  if (d) return `像素不一样 ${d}(重画的那块 ${JSON.stringify(got.region)})`;
  for (const k of ['dist', 'fade'] as const) {
    const a = got.sea[k];
    const b = full.sea[k];
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return `sea.${k} 不一样 (${i % W}, ${Math.floor(i / W)})`;
  }
  for (const k of ['coast', 'lake', 'sea', 'iceW', 'iceI'] as const) {
    const a = patchMap(got.patch[k]);
    const b = patchMap(full.patch[k]);
    if (a.size !== b.size) return `patch.${k} 个数 ${a.size} / ${b.size}`;
    for (const [i, c] of b) if (a.get(i) !== c) return `patch.${k} 像素 ${i % W},${Math.floor(i / W)}`;
  }
  return '';
}

describe('编辑地形 · 按块重画地图', () => {
  it('写实(种子 7):一笔高度、跨 180° 经线、南极附近,按块重画和整张重画逐像素相同', { timeout: 300000 }, () => {
    const cases: [string, (w: World) => TerrainOp[], SurfaceLook][] = [
      [
        '高度',
        (w) => {
          const [x, y] = landAt(w, 200, 900);
          return [{ kind: 'lift', pts: [x, y, x + 10, y], r: 30, s: 0.6 }];
        },
        'detail',
      ],
      ['跨 180°', () => [{ kind: 'lower', pts: [2030, 500, 2070, 505], r: 25, s: 1 }], 'classic'],
      ['南极', () => [{ kind: 'lift', pts: [1000, 1012, 1040, 1015], r: 20, s: 1 }], 'geo'],
    ];
    for (const [name, ops, look] of cases) {
      const { r0, r1, box } = pair(7, ops);
      expect(box, name).not.toBeNull();
      if (name === '跨 180°') expect(boxSpans(box!, r1.w).length, '框跨过右边').toBe(2);
      expect(checkRealistic(r0, r1, box, look), `${name} ${look}`).toBe('');
    }
  });

  it('手绘(种子 7、2024):一笔高度、跨 180° 经线、两极附近、湖、压成海,按块重画和整张重画逐像素相同', { timeout: 600000 }, () => {
    const cases: [number, string, (w: World) => TerrainOp[]][] = [
      [
        7,
        '高度',
        (w) => {
          const [x, y] = landAt(w, 200, 900);
          return [{ kind: 'lift', pts: [x, y, x + 10, y], r: 30, s: 0.6 }];
        },
      ],
      [7, '跨 180°', () => [{ kind: 'lower', pts: [2030, 500, 2070, 505], r: 25, s: 1 }]],
      [7, '北极', () => [{ kind: 'lift', pts: [700, 10, 760, 14], r: 25, s: 1 }]],
      [
        2024,
        '压成海',
        (w) => {
          const [x, y] = landAt(w, 50, 400);
          return [{ kind: 'setHeight', pts: [x, y], r: 22, s: 1, h: -400 }];
        },
      ],
      [
        2024,
        '南极 + 湖',
        (w) => {
          const [x, y] = landAt(w, 100, 600);
          return [
            { kind: 'lake', pts: [x, y], r: 14, s: 1 },
            { kind: 'cold', pts: [300, 1000, 380, 1005], r: 40, s: 1 },
          ];
        },
      ],
    ];
    for (const [seed, name, ops] of cases) {
      const { w0, w1, r0, r1, box } = pair(seed, ops);
      expect(checkFantasy(w0, r0, w1, r1, box), `${seed} ${name}`).toBe('');
    }
  });

  it('写实(种子 2024):湖、白模、简化卫星', { timeout: 300000 }, () => {
    const { r0, r1, box } = pair(2024, (w) => {
      const [x, y] = landAt(w, 100, 600);
      return [{ kind: 'lake', pts: [x, y], r: 14, s: 1 }];
    });
    for (const look of ['blank', 'simple'] as const) expect(checkRealistic(r0, r1, box, look), look).toBe('');
  });
});

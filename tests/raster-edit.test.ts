import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type BaseCache, type World } from '../src/gen/world';
import { finishGully, finishVeins, gullyHeights, rasterizeDeferred, veinsOf, type Raster } from '../src/gen/raster';
import { rasterizePatch, type RasterKeep } from '../src/gen/rasterEdit';
import { composeRaster, exactPatch } from '../src/gen/rasterPatch';
import { boxOfCols, growBox, inBox, unionBox, type PixelBox } from '../src/gen/pixelBox';
import type { TerrainOp } from '../src/gen/edits';

/** 沟壑、细沟当场算完(和帮手线程分着算的结果一样) */
function finish(d: { raster: Raster; job: Parameters<typeof gullyHeights>[0] & Parameters<typeof finishGully>[1]; veins: Parameters<typeof veinsOf>[0] }): Raster {
  finishGully(d.raster, d.job, gullyHeights(d.job, 0, d.job.n));
  finishVeins(d.raster, veinsOf(d.veins));
  return d.raster;
}

const FIELDS = ['elev', 'temp', 'precip', 'water', 'biome', 'cell', 'ice', 'iceConc', 'iceTone', 'gully', 'bank', 'vein'] as const;

/** 两张主图逐位比:第一个不一样的字段、像素(一样 = '') */
function rasterDiff(a: Raster, b: Raster): string {
  if (a.w !== b.w || a.h !== b.h) return 'size';
  for (const k of FIELDS) {
    const p = a[k];
    const q = b[k];
    if (!p || !q) {
      if (p || q) return `${k} missing`;
      continue;
    }
    const u = new Uint8Array(p.buffer, p.byteOffset, p.byteLength);
    const v = new Uint8Array(q.buffer, q.byteOffset, q.byteLength);
    if (u.length !== v.length) return `${k} length`;
    for (let i = 0; i < u.length; i++) {
      if (u[i] !== v[i]) {
        const px = Math.floor(i / p.BYTES_PER_ELEMENT);
        return `${k} @ (${px % a.w}, ${Math.floor(px / a.w)}): ${p[px]} vs ${q[px]}`;
      }
    }
  }
  const la = a.veinLines;
  const lb = b.veinLines;
  if (!la || !lb) return la || lb ? 'veinLines missing' : '';
  for (const k of ['off', 'x', 'y', 'a'] as const) {
    const p = la[k];
    const q = lb[k];
    if (p.length !== q.length) return `veinLines.${k} length`;
    for (let i = 0; i < p.length; i++) if (!Object.is(p[i], q[i])) return `veinLines.${k}[${i}]`;
  }
  return '';
}

/** 一块平地陆地(海拔在 lo..hi 之间)的地块中心 */
function landAt(w: World, lo: number, hi: number, yMin = 0, yMax = Infinity): [number, number] {
  for (let i = 0; i < w.mesh.n; i++) {
    const y = w.mesh.y[i];
    if (w.water[i] === 0 && w.elevation[i] > lo && w.elevation[i] < hi && y >= yMin && y <= yMax) return [Math.round(w.mesh.x[i]), Math.round(y)];
  }
  throw new Error('没找到');
}

/**
 * 一串笔一笔一笔加上去:每一笔都按块重铺(接着上一笔留下的整张图),和整张重铺逐位比;
 * 交给主线程的补丁(exactPatch)贴到上一张上也要逐位相同
 */
function chain(seed: number, strokes: (w: World) => TerrainOp[]) {
  const params = { ...DEFAULT_PARAMS, seed };
  const cache: BaseCache = { base: null };
  const w0 = generateWorld(params, undefined, [], null, cache);
  const d0 = rasterizeDeferred(w0, 1);
  let keep: RasterKeep = { raster: finish(d0), inputs: d0.inputs };
  const ops: TerrainOp[] = [];
  const log: string[] = [];
  const wins: (PixelBox | null)[] = [];
  for (const op of strokes(w0)) {
    ops.push(op);
    const w = generateWorld(params, undefined, ops, null, cache);
    const pj = rasterizePatch(w, keep);
    const full = finish(rasterizeDeferred(w, 1));
    if (!pj) {
      log.push(`${op.kind}: 整张`);
      const d = rasterizeDeferred(w, 1, undefined, keep.inputs.cover);
      keep = { raster: finish(d), inputs: d.inputs };
      expect(rasterDiff(keep.raster, full), `${op.kind} 整张(接着用三角形覆盖)`).toBe('');
      continue;
    }
    const got = finish(pj);
    expect(rasterDiff(got, full), `${op.kind} 按块重铺`).toBe('');
    const patch = exactPatch(keep.raster, got, pj.win);
    const composed = composeRaster(keep.raster, patch ? [patch] : []);
    expect(rasterDiff(composed, full), `${op.kind} 补丁贴上`).toBe('');
    log.push(`${op.kind}: 重铺 ${pj.win ? `${pj.win.x0},${pj.win.y0} ${pj.win.w}×${pj.win.h}` : '无'},补丁 ${patch ? `${patch.w}×${patch.h}` : '无'}`);
    wins.push(pj.win);
    keep = { raster: got, inputs: pj.inputs };
  }
  return { log, wins };
}

describe('编辑地形 · 按块重铺主图', () => {
  it('框:有变化的列绕一圈取最短的一段,跨右边接回左边;往外扩、合并', () => {
    const col = new Uint8Array(100);
    col[98] = col[99] = col[0] = col[3] = 1;
    const b = boxOfCols(col, 5, 9)!;
    expect(b).toEqual({ x0: 98, y0: 5, w: 6, h: 5 });
    expect(inBox(b, 1, 6, 100)).toBe(true);
    expect(inBox(b, 50, 6, 100)).toBe(false);
    expect(growBox(b, 3, 10, 100, 12)).toEqual({ x0: 95, y0: 0, w: 12, h: 12 });
    expect(growBox(b, 60, 0, 100, 12).w).toBe(100);
    expect(boxOfCols(new Uint8Array(10), 0, 3)).toBeNull();
    expect(unionBox({ x0: 90, y0: 0, w: 5, h: 2 }, { x0: 2, y0: 4, w: 3, h: 1 }, 100)).toEqual({ x0: 90, y0: 0, w: 15, h: 5 });
  });

  it('种子 7:高度、气候、湖、河、跨 180° 经线、两极附近,一笔笔按块重铺和整张重铺逐位相同', { timeout: 300000 }, () => {
    const { log, wins } = chain(7, (w) => {
      const [x, y] = landAt(w, 200, 900);
      const [px, py] = landAt(w, -Infinity, Infinity, 0, 60);
      return [
        { kind: 'lift', pts: [x, y, x + 10, y], r: 30, s: 0.6 },
        { kind: 'wet', pts: [x - 20, y], r: 30, s: 1 },
        { kind: 'setHeight', pts: [x + 40, y], r: 20, s: 1, h: -300 },
        { kind: 'lake', pts: [x - 50, y + 10], r: 14, s: 1 },
        // 跨 180° 经线的一笔(点按上一个点展开,x 出右边)
        { kind: 'lower', pts: [2030, 500, 2070, 505], r: 25, s: 1 },
        { kind: 'cold', pts: [px, py], r: 40, s: 1 },
        { kind: 'lift', pts: [1000, 1012, 1040, 1015], r: 20, s: 1 },
      ];
    });
    expect(log.length, log.join(';')).toBe(7);
    // 跨 180° 经线的那一笔:重铺的那块跨过右边接回左边;两极附近的整圈都铺
    expect(wins[4]!.x0 + wins[4]!.w, log[4]).toBeGreaterThan(2048);
    expect(wins[4]!.w, log[4]).toBeLessThan(2048);
    expect(wins[6]!.w, log[6]).toBe(2048);
  });

  it('种子 2024:抬起陆地(侵蚀以前的修改,网格重新生成)以后照样按块重铺', { timeout: 300000 }, () => {
    const { log } = chain(2024, (w) => {
      const [x, y] = landAt(w, 300, 1500);
      return [
        { kind: 'flatten', pts: [x, y, x + 15, y + 5], r: 25, s: 1 },
        { kind: 'volcano', pts: [x + 60, y], r: 20, s: 1 },
        { kind: 'warm', pts: [x, y], r: 35, s: 1 },
        { kind: 'river', pts: [x - 30, y - 20, x + 10, y + 30], r: 6, s: 1 },
      ];
    });
    expect(log.length, log.join(';')).toBe(4);
  });
});

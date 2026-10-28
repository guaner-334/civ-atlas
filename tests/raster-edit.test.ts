import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type BaseCache, type World } from '../src/gen/world';
import { finishGully, finishVeins, gullyHeights, newGullyJob, noiseTiles, rasterizeDeferred, rasterizeDeferredSteps, SHADE_STEP, shadeSphere, veinsOf, type Raster } from '../src/gen/raster';
import { rasterizePatch, rasterizePatchSteps, type PatchProgress, type RasterKeep } from '../src/gen/rasterEdit';
import { subSeed } from '../src/gen/util';
import { applyPatch, composeRaster, cutExact, exactDiff, exactDiffBefore, exactPatch } from '../src/gen/rasterPatch';
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
 * 交给主线程的补丁(exactPatch)贴到上一张上也要逐位相同。
 * reuse = 按块重铺就地改上一张的数组(后台线程的做法):补丁照改之前记下的那块比(exactDiffBefore),
 * 和拿改之前的整张(主线程手里那张,这里先拷一份)比出来的逐位相同
 */
function chain(seed: number, strokes: (w: World) => TerrainOp[], reuse = false) {
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
    const shown = reuse ? structuredClone(keep.raster) : keep.raster;
    const tried = rasterizePatch(w, keep, undefined, reuse);
    const full = finish(rasterizeDeferred(w, 1));
    if (!tried || !('job' in tried)) {
      log.push(`${op.kind}: 整张`);
      wins.push(null);
      // 整张铺的一个数也没改
      if (reuse) expect(rasterDiff(keep.raster, shown), `${op.kind} 整张铺之前没动上一张`).toBe('');
      // 按块不划算:整张铺,三角形覆盖、已经算好的输入接着用,和从头整张铺逐位相同
      const d = rasterizeDeferred(w, 1, undefined, keep.inputs.cover, tried?.whole);
      keep = { raster: finish(d), inputs: d.inputs };
      expect(rasterDiff(keep.raster, full), `${op.kind} 整张(接着用三角形覆盖、算好的输入)`).toBe('');
      continue;
    }
    const pj = tried;
    const got = finish(pj);
    expect(rasterDiff(got, full), `${op.kind} 按块重铺`).toBe('');
    const patch = exactPatch(shown, got, pj.win);
    if (reuse) {
      const d = exactDiffBefore(pj.before!, got, pj.win);
      expect(d && cutExact(got, d), `${op.kind} 照改之前记下的那块比出的补丁`).toEqual(patch);
    }
    const composed = composeRaster(shown, patch ? [patch] : []);
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

  it('种子 7:高度、气候、湖、河、跨 180° 经线、两极附近,一笔笔按块重铺和整张重铺逐位相同;变得太多的改成整张铺', { timeout: 300000 }, () => {
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
        // 海里放火山:侵蚀整个重算,变的地方超过半张,改成整张铺(接着用算好的输入)
        { kind: 'volcano', pts: [1205, 577], r: 28, s: 1 },
      ];
    });
    expect(log.length, log.join(';')).toBe(8);
    expect(log[7], log.join(';')).toBe('volcano: 整张');
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

  it('种子 2024:按块重铺就地改上一张的数组,结果和补丁跟拷一份再改的逐位相同', { timeout: 300000 }, () => {
    const { log } = chain(
      2024,
      (w) => {
        const [x, y] = landAt(w, 300, 1500);
        return [
          { kind: 'lift', pts: [x, y, x + 10, y], r: 30, s: 0.6 },
          { kind: 'wet', pts: [x - 20, y], r: 30, s: 1 },
          // 跨 180° 经线的一笔(改的那块跨过右边接回左边)
          { kind: 'lower', pts: [2030, 500, 2070, 505], r: 25, s: 1 },
          { kind: 'volcano', pts: [x + 60, y], r: 20, s: 1 },
          { kind: 'cold', pts: [x, y], r: 35, s: 1 },
        ];
      },
      true,
    );
    expect(log.length, log.join(';')).toBe(5);
    // 大多数笔按块重铺(就地改),跨 180° 经线的那一笔也是
    expect(log.filter((l) => l.includes('重铺')).length, log.join(';')).toBeGreaterThanOrEqual(3);
    expect(log[2], log.join(';')).toMatch(/^lower: 重铺/);
  });
});

/**
 * 后台线程按块重铺了一笔(就地改上一张),还没交出去就来了新的一笔:改的那块改回原样(applyPatch 改之前记下的那块),
 * 留着的输入换成这一笔的、改回去的那块记进 dirty(at = 'before' 沟壑还没算就改回去,'after' 算完了才改回去;
 * whole = 这一笔是整张铺的,上一张没动,整张记进 dirty)。下一笔接着按块重铺:和整张重铺逐位相同,
 * 补丁贴到主线程手里那张(改之前的)上也逐位相同
 */
function giveUpThenNext(seed: number, strokes: (w: World) => [TerrainOp, TerrainOp], at: 'before' | 'after' | 'whole') {
  const params = { ...DEFAULT_PARAMS, seed };
  const cache: BaseCache = { base: null };
  const w0 = generateWorld(params, undefined, [], null, cache);
  const d0 = rasterizeDeferred(w0, 1);
  const r0 = finish(d0);
  const shown = structuredClone(r0);
  const [a, b] = strokes(w0);
  const w1 = generateWorld(params, undefined, [a], null, cache);
  let keep: RasterKeep;
  if (at === 'whole') {
    const d1 = rasterizeDeferred(w1, 1, undefined, d0.inputs.cover);
    finish(d1);
    keep = { raster: r0, inputs: d1.inputs, dirty: { x0: 0, y0: 0, w: r0.w, h: r0.h } };
  } else {
    const t1 = rasterizePatch(w1, { raster: r0, inputs: d0.inputs }, undefined, true);
    if (!t1 || !('job' in t1)) throw new Error('第一笔没按块重铺');
    if (at === 'after') finish(t1);
    if (t1.before?.box) applyPatch(r0, t1.before.box);
    expect(rasterDiff(r0, shown), '改回原样').toBe('');
    keep = { raster: r0, inputs: t1.inputs, dirty: t1.changed };
  }
  const w2 = generateWorld(params, undefined, [a, b], null, cache);
  const full = finish(rasterizeDeferred(w2, 1));
  const t2 = rasterizePatch(w2, keep, undefined, true);
  if (at === 'whole') {
    expect(t2 && 'whole' in t2, '整张记进 dirty:下一笔整张铺').toBe(true);
    const d2 = rasterizeDeferred(w2, 1, undefined, keep.inputs.cover, t2 && 'whole' in t2 ? t2.whole : undefined);
    const got = finish(d2);
    expect(rasterDiff(got, full), '整张铺').toBe('');
    const d = exactDiff(r0, got);
    expect(rasterDiff(composeRaster(shown, d ? [cutExact(got, d)] : []), full), '补丁贴上').toBe('');
    return;
  }
  if (!t2 || !('job' in t2)) throw new Error('第二笔没按块重铺');
  const got = finish(t2);
  expect(rasterDiff(got, full), '按块重铺').toBe('');
  const d = exactDiffBefore(t2.before!, got, t2.win);
  expect(rasterDiff(composeRaster(shown, d ? [cutExact(got, d)] : []), full), '补丁贴上').toBe('');
}

describe('编辑地形 · 上一笔改回原样以后接着按块重铺', () => {
  const near = (w: World): [TerrainOp, TerrainOp] => {
    const [x, y] = landAt(w, 200, 900);
    return [
      { kind: 'lift', pts: [x, y, x + 10, y], r: 30, s: 0.6 },
      { kind: 'lift', pts: [x + 6, y, x + 16, y], r: 30, s: 0.6 },
    ];
  };
  const far = (w: World): [TerrainOp, TerrainOp] => {
    const [x, y] = landAt(w, 200, 900);
    return [
      { kind: 'wet', pts: [x, y], r: 30, s: 1 },
      // 跨 180° 经线、离第一笔很远
      { kind: 'lower', pts: [2030, 500, 2070, 505], r: 25, s: 1 },
    ];
  };
  it('种子 7:沟壑算完才改回去 / 还没算就改回去;第二笔挨着第一笔', { timeout: 300000 }, () => {
    giveUpThenNext(7, near, 'after');
    giveUpThenNext(7, near, 'before');
  });
  it('种子 2024:第二笔离得很远(跨 180° 经线);第一笔是整张铺的', { timeout: 300000 }, () => {
    giveUpThenNext(2024, far, 'after');
    giveUpThenNext(2024, near, 'whole');
  });
});

/**
 * 连涂:前 k 笔都按块重铺完就被下一笔顶掉、改回原样(dirty 记输入变了的框,同 worker.ts 的 giveUp),最后一笔按块重铺到底:
 * 和整张重铺逐位相同,补丁贴到主线程手里那张(连涂之前的)上也逐位相同;中间每一笔、最后一笔都还是按块重铺
 * (dirty 记往外扩过的重铺范围的话,一圈圈扩大,两三笔以后就超过半张图、改成整张铺了)
 */
function giveUpRun(seed: number, ops: (w: World) => TerrainOp[], at: 'before' | 'after') {
  const params = { ...DEFAULT_PARAMS, seed };
  const cache: BaseCache = { base: null };
  const w0 = generateWorld(params, undefined, [], null, cache);
  const d0 = rasterizeDeferred(w0, 1);
  const r0 = finish(d0);
  const shown = structuredClone(r0);
  const all = ops(w0);
  let keep: RasterKeep = { raster: r0, inputs: d0.inputs };
  for (let i = 0; i < all.length; i++) {
    const w = generateWorld(params, undefined, all.slice(0, i + 1), null, cache);
    const t = rasterizePatch(w, keep, undefined, true);
    if (!t || !('job' in t)) throw new Error(`第 ${i + 1} 笔没按块重铺`);
    if (i < all.length - 1) {
      if (at === 'after') finish(t);
      if (t.before?.box) applyPatch(r0, t.before.box);
      expect(rasterDiff(r0, shown), `第 ${i + 1} 笔改回原样`).toBe('');
      keep = { raster: r0, inputs: t.inputs, dirty: t.changed };
      continue;
    }
    const got = finish(t);
    const full = finish(rasterizeDeferred(w, 1));
    expect(rasterDiff(got, full), '按块重铺').toBe('');
    const d = exactDiffBefore(t.before!, got, t.win);
    expect(rasterDiff(composeRaster(shown, d ? [cutExact(got, d)] : []), full), '补丁贴上').toBe('');
  }
}

describe('编辑地形 · 连涂几笔都被顶掉以后接着按块重铺', () => {
  const run = (w: World): TerrainOp[] => {
    const [x, y] = landAt(w, 200, 900);
    return [0, 1, 2, 3, 4].map((i) => ({ kind: 'lift', pts: [x + 6 * i, y, x + 6 * i + 10, y], r: 30, s: 0.6 }));
  };
  it('种子 7:连 5 笔,前 4 笔沟壑算完才改回去', { timeout: 300000 }, () => giveUpRun(7, run, 'after'));
  it('种子 2024:连 5 笔,前 4 笔沟壑还没算就改回去', { timeout: 300000 }, () => giveUpRun(2024, run, 'before'));
});

/**
 * 连涂:前几笔按块重铺到一半(一段一段铺,rasterizePatchSteps)就被下一笔顶掉:贴回记下的那块(at.before.box)就是原样,
 * 留着的整图、输入照旧(同 worker.ts 铺到一半放下);在各种地方放下(还没记下原样、刚开始逐像素、逐像素到一半、去碎点以后)。
 * 最后一笔按块重铺到底:和整张重铺逐位相同,补丁贴到主线程手里那张上也逐位相同
 */
function stopMidRun(seed: number, ops: (w: World) => TerrainOp[]) {
  const params = { ...DEFAULT_PARAMS, seed };
  const cache: BaseCache = { base: null };
  const w0 = generateWorld(params, undefined, [], null, cache);
  const d0 = rasterizeDeferred(w0, 1);
  const r0 = finish(d0);
  const shown = structuredClone(r0);
  const all = ops(w0);
  const keep: RasterKeep = { raster: r0, inputs: d0.inputs };
  // 一笔一共分几段:拿第一笔在一份拷贝上走一遍
  const w1 = generateWorld(params, undefined, all.slice(0, 1), null, cache);
  let steps = 0;
  const probe = rasterizePatchSteps(w1, { raster: structuredClone(r0), inputs: d0.inputs }, undefined, true);
  while (!probe.next().done) steps++;
  expect(steps, '分了好几段').toBeGreaterThan(5);
  const stopAt = [1, 2, 3, Math.floor(steps / 2), steps];
  for (let i = 0; i < all.length - 1; i++) {
    const w = i === 0 ? w1 : generateWorld(params, undefined, all.slice(0, i + 1), null, cache);
    const at: PatchProgress = {};
    const it = rasterizePatchSteps(w, keep, undefined, true, at);
    for (let k = 0; k < stopAt[i % stopAt.length]; k++) expect(it.next().done, `第 ${i + 1} 笔第 ${k + 1} 段`).toBe(false);
    if (at.before?.box) applyPatch(r0, at.before.box);
    expect(rasterDiff(r0, shown), `第 ${i + 1} 笔铺到第 ${stopAt[i % stopAt.length]} 段放下,改回原样`).toBe('');
  }
  const w = generateWorld(params, undefined, all, null, cache);
  const t = rasterizePatch(w, keep, undefined, true);
  if (!t || !('job' in t)) throw new Error('最后一笔没按块重铺');
  const got = finish(t);
  const full = finish(rasterizeDeferred(w, 1));
  expect(rasterDiff(got, full), '按块重铺').toBe('');
  const d = exactDiffBefore(t.before!, got, t.win);
  expect(rasterDiff(composeRaster(shown, d ? [cutExact(got, d)] : []), full), '补丁贴上').toBe('');
}

describe('编辑地形 · 连涂时铺到一半就被顶掉', () => {
  const run = (w: World): TerrainOp[] => {
    const [x, y] = landAt(w, 200, 900);
    return [0, 1, 2, 3, 4, 5].map((i) => ({ kind: i % 2 ? 'wet' : 'lift', pts: [x + 6 * i, y, x + 6 * i + 10, y], r: 30, s: 0.6 }));
  };
  it('种子 7:前 5 笔在不同的地方放下,最后一笔照样按块重铺', { timeout: 300000 }, () => stopMidRun(7, run));
  it('种子 2024', { timeout: 300000 }, () => stopMidRun(2024, run));
});

describe('编辑地形 · 一段一段铺', () => {
  it('逐像素那一步按整行分段铺,和一口气铺整张逐位相同(沟壑要算的像素按同样的先后记下)', { timeout: 300000 }, () => {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed: 7 }, undefined, [], null, undefined);
    const d = rasterizeDeferred(w, 1);
    const { base, carve, calm, planes, cover } = d.inputs;
    const { w: W, h: H } = cover.g;
    const R = w.width / (2 * Math.PI);
    const { dTile, jTile } = noiseTiles(7);
    const blank = (): Raster => ({ w: W, h: H, scale: 1, elev: new Float32Array(W * H), temp: new Float32Array(W * H), precip: new Float32Array(W * H), water: new Uint8Array(W * H), biome: new Uint8Array(W * H), cell: d.raster.cell, ice: new Float32Array(W * H), iceConc: new Uint8Array(W * H), iceTone: new Uint8Array(W * H), wrap: true });
    const shade = (rects: (PixelBox | null)[]) => {
      const out = blank();
      const job = newGullyJob(subSeed(7, 'gully'), W, H, R, 1);
      for (const rect of rects) shadeSphere(out, cover.tri, cover.wa, cover.wb, planes, base, carve, calm, dTile, jTile, cover.g, R, w.mesh.spacing, job, null, rect);
      const n = job.n;
      return { out, job: [job.idx, job.ge, job.gn, job.amp, job.base, job.cut, job.floor].map((a) => Array.from(a.subarray(0, n)).join()).join('|') };
    };
    const one = shade([null]);
    const rows = Math.floor(SHADE_STEP / W);
    const bands: PixelBox[] = [];
    for (let y = 0; y < H; y += rows) bands.push({ x0: 0, y0: y, w: W, h: Math.min(rows, H - y) });
    expect(bands.length, '分了好几段').toBeGreaterThan(5);
    const split = shade(bands);
    expect(rasterDiff(split.out, one.out), '铺出来的').toBe('');
    expect(split.job === one.job, '沟壑要算的像素').toBe(true);
    // 整张一段一段铺的(rasterizeDeferredSteps)走完和 rasterizeDeferred 一样
    const it = rasterizeDeferredSteps(w, 1);
    let r = it.next();
    while (!r.done) r = it.next();
    expect(rasterDiff(finish(r.value), finish(d)), '一段一段整张铺').toBe('');
  });
});

describe('编辑地形 · 先比出框、再决定拷不拷补丁', () => {
  /** 一张小主图(各字段随便填,细沟的线一条) */
  function tiny(seed: number): Raster {
    const w = 16;
    const h = 8;
    const n = w * h;
    const f = (k: number) => Float32Array.from({ length: n }, (_, i) => ((i * 7 + k * 13 + seed) % 29) - 3);
    const u = (k: number) => Uint8Array.from({ length: n }, (_, i) => (i * 3 + k) % 5);
    return {
      w,
      h,
      scale: 1,
      elev: f(1),
      temp: f(2),
      precip: f(3),
      water: u(1),
      biome: u(2),
      cell: Int32Array.from({ length: n }, (_, i) => i >> 2),
      ice: f(4),
      iceConc: u(3),
      iceTone: u(4),
      gully: f(5),
      bank: u(5),
      vein: u(6),
      veinLines: { off: Int32Array.of(0, 2), x: Float32Array.of(1, 2), y: Float32Array.of(3, 4), a: Float32Array.of(5, 6) },
      wrap: true,
    };
  }
  const copy = (r: Raster): Raster => structuredClone(r);

  it('exactDiff 的框和 exactPatch 一样;cutExact 拷出来的补丁和 exactPatch 逐位相同', () => {
    const a = tiny(0);
    const b = copy(a);
    b.elev[2 * 16 + 15] += 1;
    b.biome[5 * 16 + 0] ^= 1;
    b.vein![7 * 16 + 3] ^= 2;
    const d = exactDiff(a, b);
    const p = exactPatch(a, b)!;
    expect(d && d.box && { x0: d.box.x0, y0: d.box.y0, w: d.box.w, h: d.box.h }).toEqual({ x0: p.x0, y0: p.y0, w: p.w, h: p.h });
    // 东西相连:第 15 列和第 0 列挨着,框跨过右边接回左边
    expect(p.x0 + p.w).toBeGreaterThan(16);
    expect(cutExact(b, d!)).toEqual(p);
    expect(composeRaster(a, [cutExact(b, d!)]).elev).toEqual(b.elev);
  });

  it('一个像素也没变:null;只有细沟的线变了:没有框、只带线', () => {
    const a = tiny(1);
    expect(exactDiff(a, copy(a))).toBeNull();
    expect(exactPatch(a, copy(a))).toBeNull();
    const b = copy(a);
    b.veinLines!.x[1] += 0.5;
    const d = exactDiff(a, b)!;
    expect(d).toEqual({ box: null, lines: true });
    expect(cutExact(b, d)).toEqual(exactPatch(a, b));
    expect(cutExact(b, d).w).toBe(0);
  });
});

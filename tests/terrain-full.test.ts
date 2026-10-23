import { describe, expect, it } from 'vitest';
import type { World } from '../src/gen/world';
import type { Raster } from '../src/gen/raster';
import type { WorkStep } from '../src/render/common';
import { cancelTerrainPatch, startTerrainFull, terrainPatchPending, type PatchStats, type PatchView } from '../src/ui/terrainPatch';

/**
 * 整张交回来的新主图换上之前先分小步备地图(startTerrainFull):只测怎么排、怎么交 ——
 * 备的几步本身(各画风整张分步画和一口气画逐像素相同)见 thumb-prep.test.ts
 */
const world = {} as World;
const raster = { w: 4, h: 2 } as Raster;
const flat: PatchView = { style: 'fantasy', look: 'classic', mp: null };

/** 开始备,等 done(给了 within 毫秒还没 done = null) */
function run(prep: WorkStep[], view = flat, within = 2000): Promise<{ st: PatchStats; pre: unknown } | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), within);
    startTerrainFull({ world, raster, view, prep }, (st, pre) => {
      clearTimeout(t);
      resolve({ st, pre });
    });
  });
}

/** 一步要做 n 次才做完(每次占 ms 毫秒),做的时候记进 log */
function slow(log: string[], name: string, n: number, ms = 0): WorkStep {
  let i = 0;
  return () => {
    const t = performance.now();
    while (performance.now() - t < ms);
    log.push(`${name}${i}`);
    return ++i < n;
  };
}

describe('打开世界:换上之前先分小步备地图', () => {
  it('几步按顺序做完才交(不在开始的那一下当场做);交的时候带上各步用时、最长的一步、画风', async () => {
    const log: string[] = [];
    const p = run([slow(log, 'a', 3, 5), slow(log, 'b', 4, 5)]);
    expect(log).toEqual([]);
    const got = await p;
    expect(log).toEqual(['a0', 'a1', 'a2', 'b0', 'b1', 'b2', 'b3']);
    expect(got).not.toBeNull();
    expect(got!.st.kind).toBe('fantasy');
    expect(got!.st.maxStep).toBeGreaterThanOrEqual(4);
    expect(got!.st.prep).toBeGreaterThanOrEqual(30);
    // 等距圆柱:没有按投影重画的那一张
    expect(got!.pre).toBeNull();
    expect(terrainPatchPending()).toBe(false);
  });

  it('数据底图:画风记成 none', async () => {
    const got = await run([() => {}], { style: 'data', look: 'classic', mp: null });
    expect(got!.st.kind).toBe('none');
  });

  it('哪一步出了错:剩下的不做了,照样交(画风记成 none,换上时按原来的办法整张画)', async () => {
    const log: string[] = [];
    const err = console.error;
    console.error = () => {};
    const got = await run([
      slow(log, 'a', 2),
      () => {
        throw new Error('坏了');
      },
      slow(log, 'c', 2),
    ]);
    console.error = err;
    expect(log).toEqual(['a0', 'a1']);
    expect(got!.st.kind).toBe('none');
    expect(got!.pre).toBeNull();
  });

  it('又来了一次(换了世界):前一次不做了,也不交;cancelTerrainPatch 同样', async () => {
    const log: string[] = [];
    let second: ReturnType<typeof run> | null = null;
    // 前一次做到第 3 步时来了新的一次
    const kick: WorkStep = () => {
      log.push('kick');
      second = run([slow(log, 'new', 2)]);
    };
    const first = run([slow(log, 'old', 3, 3), kick, slow(log, 'after', 20, 3)], flat, 500);
    expect(await first).toBeNull();
    expect(await second!).not.toBeNull();
    expect(log).toEqual(['old0', 'old1', 'old2', 'kick', 'new0', 'new1']);
    // 备到一半 cancelTerrainPatch(换了世界、读档):不交
    const log2: string[] = [];
    const third = run([slow(log2, 'x', 3, 3), () => cancelTerrainPatch(), slow(log2, 'y', 20, 3)], flat, 500);
    expect(await third).toBeNull();
    expect(log2).toEqual(['x0', 'x1', 'x2']);
    expect(terrainPatchPending()).toBe(false);
  });
});

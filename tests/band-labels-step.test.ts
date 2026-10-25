import { describe, expect, it } from 'vitest';
import { bandLabels, bandLabelsStep, type SidedLine } from '../src/render/civ/borders';

/**
 * 色块按界线重新判归属的分段版(render/civ/borders.ts 的 bandLabelsStep):
 * 草稿数组按大小共用,两份分段的活交替着判(比如存档缩略图和换上新的历史同时在备)也都判得完,结果和一口气判完逐位一样
 */
const W = 64;
const H = 32;

function grid(): Int16Array {
  const label = new Int16Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) label[y * W + x] = x < 20 ? 0 : x < 40 ? 1 : 2;
  // 几格水
  for (let x = 0; x < W; x += 9) label[x] = -2;
  return label;
}

function line(pts: number[], left: number, right: number): SidedLine {
  return { pts: new Float32Array(pts), closed: false, left, right, end0: false, end1: false };
}

const LINES: SidedLine[] = [
  line([18, 0, 21, 10, 19, 20, 22, 32], 0, 1),
  line([41, 0, 38, 12, 42, 24, 39, 32], 1, 2),
  line([0, 15, 10, 17, 20, 14], 0, 0),
  line([44, 6, 54, 9, 63, 5], 2, 2),
];

function sync(): Int16Array {
  const l = grid();
  bandLabels(l, W, H, 1, 1, LINES);
  return l;
}

/** deadline = 0:每段只判一条线 */
const stepOf = (l: Int16Array) => bandLabelsStep(l, W, H, 1, 1, () => LINES, 0, () => null);

describe('色块按界线判归属 · 分段', () => {
  it('两份分段的活交替着判:都判得完,和一口气判完的一样', () => {
    const want = sync();
    const a = grid();
    const b = grid();
    const sa = stepOf(a);
    const sb = stepOf(b);
    let doneA = false;
    let doneB = false;
    let n = 0;
    while ((!doneA || !doneB) && n++ < 100) {
      if (!doneA) doneA = sa(0) !== true;
      if (!doneB) doneB = sb(0) !== true;
    }
    expect(doneA && doneB).toBe(true);
    expect(n).toBeLessThan(3 * LINES.length);
    expect([...a]).toEqual([...want]);
    expect([...b]).toEqual([...want]);
  });

  it('判到一半别处同步判了一次:接着判完也和一口气判完的一样', () => {
    const want = sync();
    const a = grid();
    const sa = stepOf(a);
    expect(sa(0)).toBe(true);
    expect([...sync()]).toEqual([...want]);
    let n = 0;
    while (sa(0) === true && n++ < 100);
    expect(n).toBeLessThan(2 * LINES.length);
    expect([...a]).toEqual([...want]);
  });
});

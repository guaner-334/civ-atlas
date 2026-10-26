/**
 * 关隘(gen/civ/passes.ts):交界的山脊上又低又窄的口子。
 * 拼一条假的交界(两排地块一一相邻)看认法;再在真实世界里看认出来的关隘都在两州交界上、比山脊低一大截。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { PASS_RIDGE, findPass, regionPasses } from '../src/gen/civ/passes';

/** 两排地块:这一边 0..n−1,那一边 n..2n−1,第 i 块和第 n+i 块相邻(同一排里也左右相邻);海拔照 hs(这一边、那一边同高) */
function strip(hs: number[]): { world: World; a: number[]; inB: (c: number) => boolean } {
  const n = hs.length;
  const nb: number[][] = [];
  for (let i = 0; i < 2 * n; i++) {
    const row = i < n ? 0 : 1;
    const x = i - row * n;
    const list = [row === 0 ? n + x : x];
    if (x > 0) list.push(i - 1);
    if (x < n - 1) list.push(i + 1);
    nb.push(list);
  }
  const adjStart = new Int32Array(2 * n + 1);
  nb.forEach((l, i) => (adjStart[i + 1] = adjStart[i] + l.length));
  const adj = new Int32Array(nb.flat());
  const elevation = new Float32Array([...hs, ...hs]);
  const world = { mesh: { n: 2 * n, adjStart, adj }, elevation } as unknown as World;
  return { world, a: [...Array(n).keys()], inB: (c) => c >= n };
}

describe('关隘', () => {
  it('山脊上一个又低又窄的口子是关隘(口子在最低的那一对地块上);口子宽了、山脊不高、口子不够低、交界太短都不算', () => {
    const ridge = [2000, 2100, 1900, 2200, 2000, 420, 2050, 1950, 2100, 2000];
    const { world, a, inB } = strip(ridge);
    const p = findPass(world, a, inB)!;
    expect(p).not.toBeNull();
    expect(p.cell).toBe(5);
    expect(p.height).toBeCloseTo(420);
    expect(p.ridge).toBeGreaterThanOrEqual(PASS_RIDGE);
    expect(p.pairs).toBe(10);
    // 口子宽:三对一样低
    const wide = strip([2000, 2100, 1900, 450, 430, 440, 2050, 1950, 2100, 2000]);
    expect(findPass(wide.world, wide.a, wide.inB)).toBeNull();
    // 两对一样低的照样算窄口
    const two = strip([2000, 2100, 1900, 2200, 450, 430, 2050, 1950, 2100, 2000]);
    expect(findPass(two.world, two.a, two.inB)?.cell).toBe(5);
    // 山脊不高:丘陵
    const low = strip([700, 800, 750, 700, 650, 120, 700, 800, 750, 700]);
    expect(findPass(low.world, low.a, low.inB)).toBeNull();
    // 口子不够低
    const shallow = strip([2000, 2100, 1900, 2200, 2000, 1700, 2050, 1950, 2100, 2000]);
    expect(findPass(shallow.world, shallow.a, shallow.inB)).toBeNull();
    // 交界太短
    const short = strip([2000, 300, 2100]);
    expect(findPass(short.world, short.a, short.inB)).toBeNull();
    // 海平面以下按 0 算
    const sea = strip([2000, 2100, 1900, 2200, 2000, -50, 2050, 1950, 2100, 2000]);
    expect(findPass(sea.world, sea.a, sea.inB)?.height).toBe(0);
  });

  it('真实世界(seed 7):州与州之间认出一批关隘,口子都在两州交界上、比交界的山脊低一大截;两个方向的边是同一处', () => {
    const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 });
    const reg = generateCiv(w, { endYear: 1 }).regions;
    const gate = regionPasses(w, reg);
    expect(regionPasses(w, reg)).toBe(gate);
    const { adjStart, adj } = w.mesh;
    let n = 0;
    for (let a = 0; a < reg.count; a++) {
      for (let k = reg.adjStart[a]; k < reg.adjStart[a + 1]; k++) {
        const b = reg.adj[k];
        const c = gate[k];
        if (c < 0) continue;
        n++;
        // 口子那块地在这两州里,挨着另一州的地块
        const ra = reg.of[c];
        expect([a, b]).toContain(ra);
        const other = ra === a ? b : a;
        let touch = false;
        for (let m = adjStart[c]; m < adjStart[c + 1]; m++) if (reg.of[adj[m]] === other) touch = true;
        expect(touch).toBe(true);
        const p = findPass(w, reg.cells.subarray(reg.cellStart[a], reg.cellStart[a + 1]), (j) => reg.of[j] === b)!;
        expect(p.cell).toBe(c);
        expect(p.ridge - p.height).toBeGreaterThanOrEqual(500);
        // 反方向的边是同一处
        let back = -2;
        for (let m = reg.adjStart[b]; m < reg.adjStart[b + 1]; m++) if (reg.adj[m] === a) back = gate[m];
        expect(back).toBe(c);
      }
    }
    expect(n).toBeGreaterThan(10);
  }, 60_000);
});

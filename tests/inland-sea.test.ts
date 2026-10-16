/**
 * 地形上不自然的水:封闭内海、紧挨着海的"湖"、湖心的小块地(gen/inlandSea.ts、gen/world.ts)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { buildMesh } from '../src/gen/mesh';
import { connectInlandSeas } from '../src/gen/inlandSea';
import { mulberry32 } from '../src/gen/util';

/** 满足 pred 的地块按邻接连成的片 */
function components(w: Pick<World, 'mesh'>, pred: (i: number) => boolean): number[][] {
  const { n, adjStart, adj } = w.mesh;
  const seen = new Uint8Array(n);
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    if (!pred(i) || seen[i]) continue;
    const c = [i];
    seen[i] = 1;
    for (let q = 0; q < c.length; q++) {
      const a = c[q];
      for (let k = adjStart[a]; k < adjStart[a + 1]; k++) {
        const j = adj[k];
        if (pred(j) && !seen[j]) {
          seen[j] = 1;
          c.push(j);
        }
      }
    }
    out.push(c);
  }
  return out;
}

describe('地形上不自然的水', () => {
  // 7 号种子 36000 块有一片 135 块的封闭内海、一片 77 块的;42 号有 19 个紧挨着海的湖
  for (const seed of [7, 42]) {
    it(`种子 ${seed}:没有封闭内海、没有紧挨着海的湖、湖心没有小块地`, () => {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed, cells: 36000 });
      const { n, adjStart, adj } = w.mesh;
      // 外洋只有一片
      expect(components(w, (i) => w.water[i] === 1).length).toBe(1);
      // 湖不挨着海
      for (let i = 0; i < n; i++) {
        if (w.water[i] !== 2) continue;
        for (let k = adjStart[i]; k < adjStart[i + 1]; k++) expect(w.water[adj[k]]).not.toBe(1);
      }
      // 陆地上周围全是湖水的小块地
      for (const c of components(w, (i) => w.water[i] === 0)) {
        if (c.length > 6) continue;
        const around = new Set<number>();
        for (const i of c) for (let k = adjStart[i]; k < adjStart[i + 1]; k++) around.add(w.water[adj[k]]);
        expect(around.has(2) && !around.has(1) && !around.has(0)).toBe(false);
      }
    });
  }

  it('同一个种子得到同一个世界', () => {
    const a = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 12000 });
    const b = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 12000 });
    expect(Buffer.from(a.water).equals(Buffer.from(b.water))).toBe(true);
    expect(Buffer.from(a.elevation.buffer).equals(Buffer.from(b.elevation.buffer))).toBe(true);
  });
});

describe('connectInlandSeas', () => {
  const W = 2048;
  const mesh = buildMesh(W, 1024, 6, mulberry32(11));
  const { n, x, y } = mesh;
  /** 全是陆地,在 (cx, cy) 周围 r 以内挖成海 */
  const pond = (land: Uint8Array, cx: number, cy: number, r: number) => {
    for (let i = 0; i < n; i++) if ((x[i] - cx) ** 2 + (y[i] - cy) ** 2 < r * r) land[i] = 0;
  };
  const oceanBlocks = (land: Uint8Array) => components({ mesh }, (i) => !land[i]).length;

  it('远处的内海填成陆地,碎屑也填掉', () => {
    const land = new Uint8Array(n).fill(1);
    pond(land, 1000, 512, 400); // 外洋
    pond(land, 200, 300, 45); // 离外洋很远的内海
    pond(land, 1700, 512, 12); // 碎屑
    expect(oceanBlocks(land)).toBe(3);
    connectInlandSeas(mesh, land);
    expect(oceanBlocks(land)).toBe(1);
  });

  it('离外洋只隔一道窄陆的内海凿海峡接通,不填', () => {
    const land = new Uint8Array(n).fill(1);
    pond(land, 1000, 512, 400); // 外洋
    pond(land, 1462, 512, 45); // 内海,和外洋之间隔着一两块地
    const before = land.reduce((a, v) => a + v, 0);
    expect(oceanBlocks(land)).toBe(2);
    connectInlandSeas(mesh, land);
    expect(oceanBlocks(land)).toBe(1);
    // 海没有被填掉:陆地最多少了几块(海峡),没有多出几十块
    expect(land.reduce((a, v) => a + v, 0)).toBeLessThanOrEqual(before);
  });

  it('草图涂过的地块不动', () => {
    const land = new Uint8Array(n).fill(1);
    pond(land, 1000, 512, 400);
    pond(land, 200, 300, 45);
    const protect = new Uint8Array(n);
    for (let i = 0; i < n; i++) if ((x[i] - 200) ** 2 + (y[i] - 300) ** 2 < 45 * 45) protect[i] = 1;
    connectInlandSeas(mesh, land, protect);
    expect(oceanBlocks(land)).toBe(2);
  });
});

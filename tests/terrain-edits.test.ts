/**
 * 改地形(阶段 4):TerrainOp 的清理、生成流程里套上以后的效果(火山成岛、山脉抬高且有河流下、湖、抬起 / 沉下)、
 * 确定性(同样的地形修改两次生成逐字节相同;没有修改 = 和不改一模一样)、存档往返、
 * 手绘风的符号(山、丘陵、沙丘、草丛、林块)改地形后远处一个都不挪。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, MAP_H, MAP_W, generateWorld, type BaseCache, type World } from '../src/gen/world';
import { EMPTY_EDITS, type TerrainOp, type WorldEdits } from '../src/gen/edits';
import {
  DEL_WATER_FLUX,
  DEL_WATER_R,
  HEIGHT_M,
  TERRAIN_H,
  TERRAIN_MAX_OPS,
  TERRAIN_MAX_PTS,
  TERRAIN_PRESETS,
  TERRAIN_W,
  applyClimatePens,
  cleanTerrainOp,
  cleanTerrainOps,
  lakeAt,
  ownLakeCells,
  liftAt,
  presetStrength,
  riversAt,
  sameTerrain,
} from '../src/gen/terrainEdits';
import { CREEK_FRAC } from '../src/gen/creeks';
import { drawnFlux, shownRivers } from '../src/render/common';
import { geometryOf } from '../src/gen/geometry';
import { editCount, makeSave, parseSave, saveText, worldCheck } from '../src/gen/savefile';
import { G_VOLCANO, planGlyphs, type Glyph } from '../src/render/fantasy';

const SMALL = { ...DEFAULT_PARAMS, cells: 12000, seed: 7 };
let base: World | undefined;
const base7 = () => (base ??= generateWorld(SMALL));

/** 离某类地块(陆地 / 海)最远的一格(按邻接步数;只在地图中间一带找,不挨着冰原和边框) */
function farthestFrom(w: World, wantLand: boolean): number {
  const { n, adjStart, adj, x, y } = w.mesh;
  const dist = new Int32Array(n).fill(-1);
  const q: number[] = [];
  for (let i = 0; i < n; i++) if ((w.water[i] === 0) !== wantLand) (dist[i] = 0), q.push(i);
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      if (dist[j] < 0) (dist[j] = dist[i] + 1), q.push(j);
    }
  }
  let best = -1;
  for (let i = 0; i < n; i++) {
    if ((w.water[i] === 0) !== wantLand || Math.abs(y[i] - MAP_H / 2) > 260 || x[i] < 200 || x[i] > MAP_W - 200) continue;
    if (best < 0 || dist[i] > dist[best]) best = i;
  }
  return best;
}

const near = (w: World, px: number, py: number, R: number) => {
  const out: number[] = [];
  for (let i = 0; i < w.mesh.n; i++) if ((w.mesh.x[i] - px) ** 2 + (w.mesh.y[i] - py) ** 2 < R * R) out.push(i);
  return out;
};
const mean = (w: World, cells: number[]) => cells.reduce((s, i) => s + w.elevation[i], 0) / cells.length;
const same = (a: World, b: World) => {
  expect(Buffer.from(a.elevation.buffer).equals(Buffer.from(b.elevation.buffer))).toBe(true);
  expect(Array.from(a.water)).toEqual(Array.from(b.water));
  expect(Array.from(a.biome)).toEqual(Array.from(b.biome));
  expect(Buffer.from(a.flux.buffer).equals(Buffer.from(b.flux.buffer))).toBe(true);
  expect(a.rivers.length).toBe(b.rivers.length);
  expect(a.history.length).toBe(b.history.length);
  for (let f = 0; f < a.history.length; f++) expect(Buffer.from(a.history[f].buffer).equals(Buffer.from(b.history[f].buffer))).toBe(true);
};

describe('改地形 · 格式', () => {
  it('世界坐标的范围和地图原图一致', () => {
    expect([TERRAIN_W, TERRAIN_H]).toEqual([MAP_W, MAP_H]);
  });

  it('湖岸 e 只有湖留(夹到 0–1),圈起来填满 f 只有改气候的留(至少三个点);放一处的强度随大小在三档之间连续取', () => {
    expect(cleanTerrainOp({ kind: 'lake', pts: [10, 10], r: 16, s: 1, e: 1.7 })).toEqual({ kind: 'lake', pts: [10, 10], r: 16, s: 1, e: 1 });
    const ok = { kind: 'lake', pts: [10, 10], r: 16, s: 1, e: 0.5 };
    expect(cleanTerrainOp(ok)).toBe(ok);
    expect(cleanTerrainOp({ kind: 'volcano', pts: [10, 10], r: 16, s: 1, e: 0.5 })).toEqual({ kind: 'volcano', pts: [10, 10], r: 16, s: 1 });
    const ring = { kind: 'wet', pts: [10, 10, 40, 10, 40, 40], r: 30, s: 1, f: 1 };
    expect(cleanTerrainOp(ring)).toBe(ring);
    expect(cleanTerrainOp({ ...ring, pts: [10, 10, 40, 10] })).toEqual({ kind: 'wet', pts: [10, 10, 40, 10], r: 30, s: 1 });
    expect(cleanTerrainOp({ kind: 'raise', pts: [10, 10, 40, 10, 40, 40], r: 30, s: 1, f: 1 })).toEqual({ kind: 'raise', pts: [10, 10, 40, 10, 40, 40], r: 30, s: 1 });
    expect(sameTerrain([{ kind: 'lake', pts: [1, 1], r: 9, s: 1, e: 0 }], [{ kind: 'lake', pts: [1, 1], r: 9, s: 1 }])).toBe(false);
    for (const k of ['volcano', 'lake', 'river'] as const) {
      const p = TERRAIN_PRESETS[k];
      for (const [r, st] of p) expect(presetStrength(k, r)).toBe(st);
      expect(presetStrength(k, 1)).toBe(p[0][1]);
      expect(presetStrength(k, 999)).toBe(p[2][1]);
      const mid = presetStrength(k, (p[0][0] + p[1][0]) / 2);
      expect(mid).toBeGreaterThan(p[0][1]);
      expect(mid).toBeLessThan(p[1][1]);
    }
  });

  it('清理:认不出的丢掉,超出范围的夹回来(x 是经度:取模、按上一个点展开),本来就合格的原样返回', () => {
    const ok: TerrainOp = { kind: 'volcano', pts: [800, 500], r: 22, s: 1 };
    expect(cleanTerrainOp(ok)).toBe(ok);
    for (const bad of [null, 3, 'x', {}, { kind: 'meteor', pts: [1, 2], r: 5, s: 1 }, { kind: 'lake', pts: [1], r: 5, s: 1 }, { kind: 'lake', pts: [1, 'a'], r: 5, s: 1 }, { kind: 'lake', pts: [1, 2], r: NaN, s: 1 }, { kind: 'range', pts: [1, 2, 3, 4], r: 5 }])
      expect(cleanTerrainOp(bad)).toBeNull();
    // 取整;y 夹在两极之间,x(经度)取模回 [0, 宽);火山只留第一个点;多余字段去掉
    expect(cleanTerrainOp({ kind: 'volcano', pts: [-50.4, 99999, 7, 8], r: 1000, s: -1, extra: 1 })).toEqual({ kind: 'volcano', pts: [TERRAIN_W - 50, TERRAIN_H], r: 160, s: 0.2 });
    expect(cleanTerrainOp({ kind: 'lake', pts: [TERRAIN_W, 3], r: 16, s: 1 })?.pts).toEqual([0, 3]);
    expect(cleanTerrainOp({ kind: 'lake', pts: [3 * TERRAIN_W + 7.4, 3], r: 16, s: 1 })?.pts).toEqual([7, 3]);
    // 跨 180° 经线的一笔:第一个点在图里,之后每个点挪到离上一个点最近的那一圈(x 可以超出地图),连着的一笔
    const seam = { kind: 'range', pts: [2040, 500, 10, 510, 30, 520, 2047, 530], r: 20, s: 1 } as TerrainOp;
    const cs = cleanTerrainOp(seam)!;
    expect(cs.pts).toEqual([2040, 500, 2058, 510, 2078, 520, 2047, 530]);
    // 已经展开的原样返回(同一个对象);清理两遍和一遍一样
    expect(cleanTerrainOp(cs)).toBe(cs);
    expect(cleanTerrainOp({ kind: 'raise', pts: [-100, 200, -60, 200], r: 20, s: 1 })?.pts).toEqual([TERRAIN_W - 100, 200, TERRAIN_W - 60, 200]);
    // 平面时代的存档(x 都在 [0, 2048] 里,每个点单独取模)照读,按经纬度解释:横穿半张图以内的线不变
    const old: TerrainOp = { kind: 'range', pts: [0, 512, 700, 300, 1400, 700, 2048, 512], r: 20, s: 1 };
    expect(cleanTerrainOp(old)).toBe(old);
    // 折线最多 TERRAIN_MAX_PTS 个点,奇数个坐标去掉最后一个
    const long = cleanTerrainOp({ kind: 'range', pts: Array.from({ length: TERRAIN_MAX_PTS * 2 + 41 }, (_, i) => i % 1000), r: 20, s: 1 });
    expect(long?.pts.length).toBe(TERRAIN_MAX_PTS * 2);
    // 列表:全合格 = 同一个数组;有坏的 = 新数组;最多 TERRAIN_MAX_OPS 处
    const list = [ok, { kind: 'lake', pts: [300, 400], r: 16, s: 1 }] as TerrainOp[];
    expect(cleanTerrainOps(list)).toBe(list);
    expect(cleanTerrainOps([ok, 'bad', null])).toEqual([ok]);
    expect(cleanTerrainOps('nope')).toEqual([]);
    expect(cleanTerrainOps(Array.from({ length: TERRAIN_MAX_OPS + 5 }, () => ok)).length).toBe(TERRAIN_MAX_OPS);
    expect(sameTerrain(list, [{ ...ok }, { kind: 'lake', pts: [300, 400], r: 16, s: 1 }])).toBe(true);
    expect(sameTerrain(list, [ok])).toBe(false);
  });
});

describe('改地形 · 生成', () => {
  it('没有地形修改:和不改一模一样(逐字节)', () => {
    const a = base7();
    same(a, generateWorld(SMALL, undefined, []));
    expect(a.volcanoes).toEqual([]);
  });

  it('同样的地形修改,两次生成逐字节相同', () => {
    const w = base7();
    const c = farthestFrom(w, true);
    const ops: TerrainOp[] = [
      { kind: 'volcano', pts: [Math.round(w.mesh.x[c]) + 60, Math.round(w.mesh.y[c])], r: 28, s: 1 },
      { kind: 'range', pts: [Math.round(w.mesh.x[c]) - 90, Math.round(w.mesh.y[c]) - 40, Math.round(w.mesh.x[c]) + 30, Math.round(w.mesh.y[c]) + 50], r: 20, s: 1 },
      { kind: 'lake', pts: [Math.round(w.mesh.x[c]) - 40, Math.round(w.mesh.y[c]) + 70], r: 16, s: 1 },
      { kind: 'sink', pts: [400, 300, 440, 320], r: 24, s: 1 },
      { kind: 'raise', pts: [1000, 520, 1040, 530], r: 24, s: 1 },
    ];
    const a = generateWorld(SMALL, undefined, ops);
    const b = generateWorld(SMALL, undefined, ops.map((o) => ({ ...o, pts: [...o.pts] })));
    same(a, b);
    expect(a.volcanoes).toEqual(b.volcanoes);
    expect(worldCheck(a)).toBe(worldCheck(b));
    expect(worldCheck(a)).not.toBe(worldCheck(w));
  });

  it('跨 180° 经线的笔画:一笔抬起的陆地在接缝两边连成一片;取模写和展开写是同一个世界', () => {
    const w0 = base7();
    // 赤道附近、接缝两边都是海的一段
    let y = -1;
    for (let yy = 380; yy <= 640 && y < 0; yy += 20) {
      const sea = near(w0, 2030, yy, 40).concat(near(w0, 18, yy, 40));
      if (sea.length > 4 && sea.every((i) => w0.water[i] === 1)) y = yy;
    }
    expect(y).toBeGreaterThan(0);
    const open: TerrainOp = { kind: 'raise', pts: [2010, y, 2086, y], r: 24, s: 1 };
    const wrapped: TerrainOp = { kind: 'raise', pts: [2010, y, 38, y], r: 24, s: 1 };
    expect(cleanTerrainOp(wrapped)).toEqual(open);
    const a = generateWorld(SMALL, undefined, [open]);
    same(a, generateWorld(SMALL, undefined, [wrapped]));
    // 接缝两边(西边 x ≈ 2030、东边 x ≈ 18)都抬成了陆地,中间不断
    for (const x of [2025, 2040, 8, 25]) expect(near(a, x, y, 8).every((i) => a.water[i] === 0), `x = ${x}`).toBe(true);
    // 横穿整张图的那一半没被抬起来(走的是短边)
    expect(near(a, 1024, y, 60).every((i) => a.water[i] === w0.water[i])).toBe(true);
  });

  it('海里的火山成岛:中心一带变成陆地、高高隆起,峰顶记在 volcanoes 里', () => {
    const w0 = base7();
    const c = farthestFrom(w0, false);
    const [px, py] = [Math.round(w0.mesh.x[c]), Math.round(w0.mesh.y[c])];
    expect(w0.water[c]).toBe(1);
    const w = generateWorld(SMALL, undefined, [{ kind: 'volcano', pts: [px, py], r: 28, s: 1 }]);
    const core = near(w, px, py, 12);
    expect(core.length).toBeGreaterThan(0);
    expect(core.every((i) => w.water[i] === 0)).toBe(true);
    expect(w.volcanoes.length).toBe(1);
    const peak = w.volcanoes[0];
    expect(w.elevation[peak]).toBeGreaterThan(1500);
    expect((w.mesh.x[peak] - px) ** 2 + (w.mesh.y[peak] - py) ** 2).toBeLessThan(28 ** 2);
    // 离得远的海不受影响
    const far = near(w0, px + 300, py, 30).filter((i) => w0.water[i] === 1);
    for (const i of far) expect(w.water[i]).toBe(1);
  });

  it('山脉:沿线海拔明显升高,有河从山上流下来', () => {
    const w0 = base7();
    const c = farthestFrom(w0, true);
    const [cx, cy] = [Math.round(w0.mesh.x[c]), Math.round(w0.mesh.y[c])];
    const pts = [cx - 80, cy - 30, cx, cy, cx + 80, cy + 30];
    const w = generateWorld(SMALL, undefined, [{ kind: 'range', pts, r: 20, s: 1 }]);
    const ridge = near(w, cx, cy, 20);
    expect(mean(w, ridge)).toBeGreaterThan(mean(w0, ridge) + 800);
    // 河的源头在山脉两侧不远处(离山脊线 50 以内)
    const toRidge = (sx: number, sy: number) => {
      let d = Infinity;
      for (let k = 0; k + 3 < pts.length; k += 2) {
        const [ax, ay, bx, by] = [pts[k], pts[k + 1], pts[k + 2], pts[k + 3]];
        const t = Math.max(0, Math.min(1, ((sx - ax) * (bx - ax) + (sy - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
        d = Math.min(d, Math.hypot(sx - ax - t * (bx - ax), sy - ay - t * (by - ay)));
      }
      return d;
    };
    const sources = (x: World) => x.rivers.filter((r) => toRidge(r.pts[0], r.pts[1]) < 50).length;
    expect(sources(w)).toBeGreaterThan(0);
    expect(sources(w)).toBeGreaterThanOrEqual(sources(w0));
  });

  it('湖:点的位置出现湖,而且不会因为"太大"被填平', () => {
    const w0 = base7();
    const c = farthestFrom(w0, true);
    const [px, py] = [Math.round(w0.mesh.x[c]), Math.round(w0.mesh.y[c])];
    expect(w0.water[c]).toBe(0);
    const w = generateWorld(SMALL, undefined, [{ kind: 'lake', pts: [px, py], r: 16, s: 1 }]);
    expect(w.water[c]).toBe(2);
    const big = generateWorld(SMALL, undefined, [{ kind: 'lake', pts: [px, py], r: 40, s: 1 }]);
    const lake = near(big, px, py, 20).filter((i) => big.water[i] === 2);
    expect(lake.length).toBeGreaterThan(5);
    // 紧挨着海挖的湖(碗沿就是海平面,湖底在海平面以下)照样留着,不当成贴海的洼地垫平
    const coast = [...Array(w0.mesh.n).keys()].filter((i) => {
      if (w0.water[i] !== 0 || Math.abs(w0.mesh.y[i] - MAP_H / 2) > MAP_H / 4) return false;
      for (let k = w0.mesh.adjStart[i]; k < w0.mesh.adjStart[i + 1]; k++) if (w0.water[w0.mesh.adj[k]] === 1) return true;
      return false;
    });
    for (const c of [coast[0], coast[coast.length >> 1], coast[coast.length - 1]]) {
      const w1 = generateWorld(SMALL, undefined, [{ kind: 'lake', pts: [Math.round(w0.mesh.x[c]), Math.round(w0.mesh.y[c])], r: 16, s: 1 }]);
      expect(w1.water[c]).toBe(2);
    }
    // 点在海里的湖不生效
    const o = farthestFrom(w0, false);
    same(w0, generateWorld(SMALL, undefined, [{ kind: 'lake', pts: [Math.round(w0.mesh.x[o]), Math.round(w0.mesh.y[o])], r: 16, s: 1 }]));
  });

  it('抬起陆地 / 沉成海:画笔走过的地方海陆互换', () => {
    const w0 = base7();
    const o = farthestFrom(w0, false);
    const l = farthestFrom(w0, true);
    const [ox, oy] = [Math.round(w0.mesh.x[o]), Math.round(w0.mesh.y[o])];
    const [lx, ly] = [Math.round(w0.mesh.x[l]), Math.round(w0.mesh.y[l])];
    const w = generateWorld(SMALL, undefined, [
      { kind: 'raise', pts: [ox - 30, oy, ox + 30, oy], r: 24, s: 1 },
      { kind: 'sink', pts: [lx - 30, ly, lx + 30, ly], r: 24, s: 1 },
    ]);
    expect(near(w, ox, oy, 10).every((i) => w.water[i] === 0)).toBe(true);
    expect(near(w, lx, ly, 10).every((i) => w.water[i] === 1 && w.elevation[i] < 0)).toBe(true);
    for (let i = 0; i < w.mesh.n; i++) expect(Number.isFinite(w.elevation[i])).toBe(true);
  });

  it('河:沿画的线流到海,线上的陆地都成了河道;画在海里的河不生效', () => {
    const w0 = base7();
    const l = farthestFrom(w0, true);
    const [lx, ly] = [w0.mesh.x[l], w0.mesh.y[l]];
    // 离它最近的海
    let o = -1;
    for (let i = 0; i < w0.mesh.n; i++) if (w0.water[i] === 1 && (o < 0 || (w0.mesh.x[i] - lx) ** 2 + (w0.mesh.y[i] - ly) ** 2 < (w0.mesh.x[o] - lx) ** 2 + (w0.mesh.y[o] - ly) ** 2)) o = i;
    const [ox, oy] = [w0.mesh.x[o], w0.mesh.y[o]];
    const pts = [lx, ly, (lx + ox) / 2 + 15, (ly + oy) / 2, ox, oy].map(Math.round);
    const w = generateWorld(SMALL, undefined, [{ kind: 'river', pts, r: 9, s: 1 }]);
    const onRiver = new Set<number>();
    for (const r of w.rivers) for (const c of r.cells) onRiver.add(c);
    // 沿线每隔几步看最近的地块
    let land = 0;
    let hit = 0;
    for (let k = 0; k + 3 < pts.length; k += 2)
      for (let t = 0; t < 1; t += 0.05) {
        const [x, y] = [pts[k] + (pts[k + 2] - pts[k]) * t, pts[k + 1] + (pts[k + 3] - pts[k + 1]) * t];
        const c = near(w, x, y, 14).sort((a, b) => (w.mesh.x[a] - x) ** 2 + (w.mesh.y[a] - y) ** 2 - ((w.mesh.x[b] - x) ** 2 + (w.mesh.y[b] - y) ** 2))[0];
        if (c === undefined || w.water[c] !== 0) continue;
        land++;
        if ([c, ...Array.from(w.mesh.adj.subarray(w.mesh.adjStart[c], w.mesh.adjStart[c + 1]))].some((j) => onRiver.has(j))) hit++;
      }
    expect(land).toBeGreaterThan(10);
    expect(hit / land).toBeGreaterThan(0.85);
    const sea = farthestFrom(w0, false);
    const [sx, sy] = [Math.round(w0.mesh.x[sea]), Math.round(w0.mesh.y[sea])];
    same(w0, generateWorld(SMALL, undefined, [{ kind: 'river', pts: [sx - 20, sy, sx + 20, sy], r: 9, s: 1 }]));
  });

  it('画的河:经过的点记下画笔半宽,地图上按 drawnFlux 画(推演用的流量不变)', () => {
    const w0 = base7();
    const l = farthestFrom(w0, true);
    const [lx, ly] = [Math.round(w0.mesh.x[l]), Math.round(w0.mesh.y[l])];
    const w = generateWorld(SMALL, undefined, [{ kind: 'river', pts: [lx, ly, lx + 40, ly + 30], r: 12, s: 1 }]);
    const drawn = w.rivers.filter((r) => r.drawn);
    expect(drawn.length).toBeGreaterThan(0);
    expect(drawn.some((r) => Array.from(r.drawn!).includes(12))).toBe(true);
    for (const r of drawn) expect(r.drawn!.length).toBe(r.cells.length);
    const shown = shownRivers(w.rivers, w.riverThreshold);
    expect(shownRivers(w.rivers, w.riverThreshold)).toBe(shown);
    w.rivers.forEach((r, k) => {
      const d = r.drawn;
      for (let i = 0; i < r.cells.length; i++) {
        const f = shown[k].pts[i * 3 + 2];
        if (d?.[i]) expect(f).toBeGreaterThanOrEqual(drawnFlux(d[i], w.riverThreshold));
        else expect(f).toBe(r.pts[i * 3 + 2]);
      }
    });
    // 没有画的河:原数组
    expect(shownRivers(w0.rivers, w0.riverThreshold)).toBe(w0.rivers);
    // 笔越粗画得越粗;最细的也过全图的细节层级门槛
    expect(drawnFlux(20, 14)).toBeGreaterThan(drawnFlux(4, 14));
    expect(drawnFlux(4, 14)).toBeGreaterThan(4.5 * 2.5 * 14);
  });

  it('湖岸:带 e 的湖照新画法长(形状和旧画法不同,同一个 e 两次一样),湖心照样是湖', () => {
    const w0 = base7();
    const c = farthestFrom(w0, true);
    const [px, py] = [Math.round(w0.mesh.x[c]), Math.round(w0.mesh.y[c])];
    const lakeOf = (w: World) => near(w, px, py, 80).filter((i) => w.water[i] === 2);
    const old = generateWorld(SMALL, undefined, [{ kind: 'lake', pts: [px, py], r: 24, s: 1 }]);
    const curvy = generateWorld(SMALL, undefined, [{ kind: 'lake', pts: [px, py], r: 24, s: 1, e: 1 }]);
    expect(curvy.water[c]).toBe(2);
    expect(lakeOf(curvy).length).toBeGreaterThan(5);
    expect(lakeOf(curvy)).not.toEqual(lakeOf(old));
    same(curvy, generateWorld(SMALL, undefined, [{ kind: 'lake', pts: [px, py], r: 24, s: 1, e: 1 }]));
    // 最小的圆湖(比地块还小):点在离哪块地块中心都远的地方(比湖的找法看得远),也落得下
    const geo = geometryOf(w0.mesh);
    const nearest = (x: number, y: number) => {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < w0.mesh.n; i++) {
        const d = geo.nearTo(i, x, y, 20);
        if (d >= 0 && d < bd) [best, bd] = [i, d];
      }
      return [best, bd] as const;
    };
    let spot: [number, number, number] | undefined;
    for (let dy = -40; dy <= 40 && !spot; dy++) {
      for (let dx = -40; dx <= 40 && !spot; dx++) {
        const [i, d] = nearest(px + dx, py + dy);
        if (d > 1.95 * 4 && w0.water[i] === 0) spot = [px + dx, py + dy, i];
      }
    }
    expect(spot).toBeDefined();
    const tiny = generateWorld(SMALL, undefined, [{ kind: 'lake', pts: [spot![0], spot![1]], r: 4, s: 1, e: 0 }]);
    expect(tiny.water[spot![2]]).toBe(2);
  });

  it('改气候:涂过的地方降水 / 气温变了,地形、远处一点不动;圈起来填满的圈里整片都改', () => {
    const w0 = base7();
    const l = farthestFrom(w0, true);
    const [lx, ly] = [Math.round(w0.mesh.x[l]), Math.round(w0.mesh.y[l])];
    const w = generateWorld(SMALL, undefined, [{ kind: 'wet', pts: [lx - 20, ly, lx + 20, ly], r: 30, s: 1 }]);
    expect(Buffer.from(w.elevation.buffer).equals(Buffer.from(w0.elevation.buffer))).toBe(true);
    expect(Array.from(w.water)).toEqual(Array.from(w0.water));
    for (const i of near(w, lx, ly, 12)) expect(w.precipitation[i]).toBeGreaterThan(w0.precipitation[i] + 200);
    const far = [...Array(w.mesh.n).keys()].filter((i) => Math.hypot(w.mesh.x[i] - lx, w.mesh.y[i] - ly) > 100 && Math.abs(w.mesh.x[i] - lx) < 1000);
    expect(far.every((i) => w.precipitation[i] === w0.precipitation[i] && w.temperature[i] === w0.temperature[i])).toBe(true);
    // 更冷 + 圈起来:圈里(离边远)每一处冷了约 6 × 程度 度
    const ring = [lx - 50, ly - 50, lx + 50, ly - 50, lx + 50, ly + 50, lx - 50, ly + 50];
    const c = generateWorld(SMALL, undefined, [{ kind: 'cold', pts: ring, r: 10, s: 1.6, f: 1 }]);
    for (const i of near(c, lx, ly, 35)) expect(c.temperature[i]).toBeCloseTo(w0.temperature[i] - 9.6, 3);
    // 更干、更暖
    const dw = generateWorld(SMALL, undefined, [
      { kind: 'dry', pts: [lx, ly], r: 30, s: 1 },
      { kind: 'warm', pts: [lx, ly], r: 30, s: 0.5 },
    ]);
    for (const i of near(dw, lx, ly, 12)) {
      expect(dw.precipitation[i]).toBeCloseTo(w0.precipitation[i] * 0.5, 2);
      expect(dw.temperature[i]).toBeCloseTo(w0.temperature[i] + 3, 3);
    }
  });

  it('改气候:同一处叠满笔,降水、气温停在上限,不会溢出', () => {
    const w0 = base7();
    const l = farthestFrom(w0, true);
    const pts = [Math.round(w0.mesh.x[l]), Math.round(w0.mesh.y[l])];
    for (const kind of ['wet', 'warm', 'cold'] as const) {
      const t = Float32Array.from(w0.temperature);
      const p = Float32Array.from(w0.precipitation);
      applyClimatePens(w0.mesh, t, p, Array.from({ length: TERRAIN_MAX_OPS }, () => ({ kind, pts, r: 60, s: 1.6 })));
      for (let i = 0; i < w0.mesh.n; i++) {
        expect(Number.isFinite(p[i]) && Number.isFinite(t[i])).toBe(true);
        expect(p[i]).toBeLessThanOrEqual(Math.max(6000, w0.precipitation[i]));
        expect(t[i]).toBeLessThanOrEqual(Math.max(40, w0.temperature[i]));
        expect(t[i]).toBeGreaterThanOrEqual(Math.min(-50, w0.temperature[i]));
      }
    }
  });

  it('一座大火山不会把全世界别的山压矮', () => {
    const w0 = base7();
    const o = farthestFrom(w0, false);
    const w = generateWorld(SMALL, undefined, [{ kind: 'volcano', pts: [Math.round(w0.mesh.x[o]), Math.round(w0.mesh.y[o])], r: 40, s: 2 }]);
    // 原来最高的那座山,海拔几乎不变
    let top = 0;
    for (let i = 0; i < w0.mesh.n; i++) if (w0.elevation[i] > w0.elevation[top]) top = i;
    expect(Math.abs(w.elevation[top] - w0.elevation[top])).toBeLessThan(w0.elevation[top] * 0.08);
  });
});

describe('改地形 · 高度笔', () => {
  it('清理:定高要有海拔(取整、夹到范围),边缘只认 0 / 1 / 2;力度夹到 0.05–1,定高的力度一律 1', () => {
    const ok: TerrainOp = { kind: 'setHeight', pts: [10, 10, 30, 10], r: 30, s: 1, h: 2000, edge: 0 };
    expect(cleanTerrainOp(ok)).toBe(ok);
    expect(cleanTerrainOp({ kind: 'setHeight', pts: [10, 10], r: 30, s: 1 })).toBeNull();
    expect(cleanTerrainOp({ kind: 'setHeight', pts: [10, 10], r: 30, s: 0.3, h: 99999.6, edge: 5 })).toEqual({ kind: 'setHeight', pts: [10, 10], r: 30, s: 1, h: HEIGHT_M[1] });
    expect(cleanTerrainOp({ kind: 'setHeight', pts: [10, 10], r: 30, s: 1, h: -120.4, edge: 2 })).toEqual({ kind: 'setHeight', pts: [10, 10], r: 30, s: 1, h: -120, edge: 2 });
    expect(cleanTerrainOp({ kind: 'lift', pts: [10, 10, 10, 10], r: 30, s: 1.7, h: 5, edge: 1 })).toEqual({ kind: 'lift', pts: [10, 10, 10, 10], r: 30, s: 1 });
    expect(cleanTerrainOp({ kind: 'smooth', pts: [10, 10], r: 30, s: 0 })?.s).toBe(0.05);
    // 按住不动时同一个点记好几次:原样留着
    const dabs: TerrainOp = { kind: 'lower', pts: [10, 10, 10, 10, 10, 10], r: 30, s: 0.4 };
    expect(cleanTerrainOp(dabs)).toBe(dabs);
    expect(sameTerrain([ok], [{ ...ok, h: 2001 }])).toBe(false);
    expect(sameTerrain([ok], [{ ...ok, edge: 1 }])).toBe(false);
  });

  /** 一片不挨海、不太高的陆地的中心(世界坐标) */
  const plain = (w: World): [number, number] => {
    const c = farthestFrom(w, true);
    return [Math.round(w.mesh.x[c]), Math.round(w.mesh.y[c])];
  };
  const geo = () => geometryOf(base7().mesh);

  it('定高:涂过的地方正好是写的海拔,边上渐渐接回去;离得远的海拔一点不动', () => {
    const w0 = base7();
    const [x, y] = plain(w0);
    const w = generateWorld(SMALL, undefined, [{ kind: 'setHeight', pts: [x - 20, y, x + 20, y], r: 30, s: 1, h: 2000, edge: 0 }]);
    const core = near(w, x, y, 18);
    expect(core.length).toBeGreaterThan(5);
    for (const i of core) expect(w.elevation[i]).toBe(2000);
    // 远处(三个笔宽以外)的海拔逐位不变
    const g = geo();
    let far = 0;
    for (let i = 0; i < w.mesh.n; i++) {
      if (g.distTo(i, x, y) < 200) continue;
      far++;
      expect(w.elevation[i]).toBe(w0.elevation[i]);
    }
    expect(far).toBeGreaterThan(w.mesh.n * 0.9);
    // 软边:笔心照足,往外越来越接近原来的高度
    const soft = generateWorld(SMALL, undefined, [{ kind: 'setHeight', pts: [x, y], r: 40, s: 1, h: 2000, edge: 2 }]);
    const mid = near(soft, x, y, 30).filter((i) => g.distTo(i, x, y) > 22);
    expect(mid.every((i) => soft.elevation[i] < 2000 && soft.elevation[i] > w0.elevation[i])).toBe(true);
  });

  it('定高到海里:冒出一座岛;定高到海平面以下:陆地沉成海', () => {
    const w0 = base7();
    const o = farthestFrom(w0, false);
    const [ox, oy] = [Math.round(w0.mesh.x[o]), Math.round(w0.mesh.y[o])];
    const isle = generateWorld(SMALL, undefined, [{ kind: 'setHeight', pts: [ox, oy], r: 30, s: 1, h: 300, edge: 0 }]);
    for (const i of near(isle, ox, oy, 15)) expect(isle.water[i]).toBe(0);
    // 形成过程的回放:最后一帧(今天)这里也是陆地的高度,不是原来的海底
    const last = isle.history[isle.history.length - 1];
    for (const i of near(isle, ox, oy, 15)) expect(last[i]).toBeGreaterThan(0);
    const [x, y] = plain(w0);
    const sea = generateWorld(SMALL, undefined, [{ kind: 'setHeight', pts: [x, y], r: 30, s: 1, h: -200, edge: 0 }]);
    for (const i of near(sea, x, y, 15)) expect(sea.water[i]).toBe(1);
  });

  it('压低出一大片盆地:积成的大湖留着,不当成"太大的湖"填平;湖里涂高的小岛也不淹', () => {
    const w0 = base7();
    const [x, y] = plain(w0);
    const big = generateWorld(SMALL, undefined, [{ kind: 'setHeight', pts: [x, y], r: 60, s: 1, h: 1, edge: 0 }]);
    const core = near(big, x, y, 50);
    const lake = core.filter((i) => big.water[i] === 2).length;
    expect(lake).toBeGreaterThan(0.8 * core.length);
    expect(lake).toBeGreaterThan(40);
    const isle = generateWorld(SMALL, undefined, [
      { kind: 'setHeight', pts: [x, y], r: 60, s: 1, h: 1, edge: 0 },
      { kind: 'setHeight', pts: [x, y], r: 4, s: 1, h: 400, edge: 0 },
    ]);
    const top = near(isle, x, y, 2);
    expect(top.length).toBeGreaterThan(0);
    for (const i of top) expect(isle.water[i]).toBe(0);
  });

  it('抬高 / 压低:涂得越多变得越多,笔心抬的米数和读数(liftAt)对得上', () => {
    const w0 = base7();
    const [x, y] = plain(w0);
    const g = geo();
    const one: TerrainOp = { kind: 'lift', pts: [x, y], r: 30, s: 0.5 };
    const three: TerrainOp = { ...one, pts: [x, y, x, y, x, y] };
    const a = generateWorld(SMALL, undefined, [one]);
    const b = generateWorld(SMALL, undefined, [three]);
    const c = near(w0, x, y, 6);
    for (const i of c) {
      const want = liftAt(one, w0.mesh.x[i], w0.mesh.y[i], (ax, ay, bx, by) => g.pointDist(ax, ay, bx, by));
      expect(want).toBeGreaterThan(20);
      expect(a.elevation[i] - w0.elevation[i]).toBeCloseTo(want, 0);
      expect(b.elevation[i] - w0.elevation[i]).toBeCloseTo(3 * want, 0);
    }
    const down = generateWorld(SMALL, undefined, [{ ...three, kind: 'lower' }]);
    for (const i of c) expect(down.elevation[i]).toBeLessThan(w0.elevation[i] - 40);
  });

  it('压低出一个盆地:比四周都低,积水成湖;水系跟着变', () => {
    const w0 = base7();
    const [x, y] = plain(w0);
    const g = geo();
    // 盆底比盆沿外一圈最低处还低 150 米
    let rim = Infinity;
    for (let i = 0; i < w0.mesh.n; i++) {
      const d = g.distTo(i, x, y);
      if (d > 24 && d < 40) rim = Math.min(rim, w0.elevation[i]);
    }
    const pit = generateWorld(SMALL, undefined, [{ kind: 'setHeight', pts: [x, y], r: 22, s: 1, h: Math.round(rim - 150), edge: 0 }]);
    expect(near(pit, x, y, 8).every((i) => pit.water[i] === 2)).toBe(true);
    expect(Buffer.from(pit.flux.buffer).equals(Buffer.from(w0.flux.buffer))).toBe(false);
  });

  it('平滑、抹平:涂过的一片更平,不冒出比原来更高、更低的尖', () => {
    const w0 = base7();
    // 找一片起伏大的陆地(海拔差最大的陆地块附近)
    let best = -1;
    let bestD = 0;
    const { adjStart, adj } = w0.mesh;
    for (let i = 0; i < w0.mesh.n; i++) {
      if (w0.water[i] !== 0) continue;
      let d = 0;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) if (w0.water[adj[k]] === 0) d = Math.max(d, Math.abs(w0.elevation[i] - w0.elevation[adj[k]]));
      if (d > bestD) (bestD = d), (best = i);
    }
    const [x, y] = [Math.round(w0.mesh.x[best]), Math.round(w0.mesh.y[best])];
    const area = near(w0, x, y, 14).filter((i) => w0.water[i] === 0);
    const rough = (w: World) => {
      let s = 0;
      for (const i of area) {
        let sum = 0;
        for (let k = adjStart[i]; k < adjStart[i + 1]; k++) sum += w.elevation[adj[k]];
        s += Math.abs(w.elevation[i] - sum / (adjStart[i + 1] - adjStart[i]));
      }
      return s / area.length;
    };
    const dabs = Array.from({ length: 12 }, () => [x, y]).flat();
    const sm = generateWorld(SMALL, undefined, [{ kind: 'smooth', pts: dabs, r: 30, s: 1 }]);
    expect(rough(sm)).toBeLessThan(rough(w0) * 0.6);
    const fl = generateWorld(SMALL, undefined, [{ kind: 'flatten', pts: dabs, r: 30, s: 1 }]);
    expect(rough(fl)).toBeLessThan(rough(w0) * 0.6);
    const lo = Math.min(...area.map((i) => w0.elevation[i]));
    const hi = Math.max(...area.map((i) => w0.elevation[i]));
    for (const i of area) {
      expect(fl.elevation[i]).toBeGreaterThanOrEqual(lo - 1);
      expect(fl.elevation[i]).toBeLessThanOrEqual(hi + 1);
    }
  });

  it('接着上一次的前一半算(只加了湖、河、气候、高度):和从头生成逐位相同,记着的前一半不被改', () => {
    const cache: BaseCache = { base: null };
    const w0 = generateWorld(SMALL, undefined, [], null, cache);
    same(w0, base7());
    const first = cache.base;
    const [x, y] = plain(w0);
    const steps: TerrainOp[][] = [
      [{ kind: 'lake', pts: [x + 60, y], r: 16, s: 1 }],
      [{ kind: 'lake', pts: [x + 60, y], r: 16, s: 1 }, { kind: 'lift', pts: [x, y, x + 10, y], r: 30, s: 0.6 }],
      [{ kind: 'lake', pts: [x + 60, y], r: 16, s: 1 }, { kind: 'lift', pts: [x, y, x + 10, y], r: 30, s: 0.6 }, { kind: 'setHeight', pts: [x - 40, y], r: 20, s: 1, h: 1500 }, { kind: 'wet', pts: [x, y], r: 30, s: 1 }],
    ];
    for (const ops of steps) {
      const a = generateWorld(SMALL, undefined, ops, null, cache);
      expect(cache.base).toBe(first);
      same(a, generateWorld(SMALL, undefined, ops));
    }
    // 回到没改:和原来一样(前一半没被高度笔改坏)
    same(generateWorld(SMALL, undefined, [], null, cache), w0);
    // 加了火山(侵蚀之前套的):前一半重算,结果照样和从头生成一样
    const v: TerrainOp[] = [{ kind: 'volcano', pts: [x, y], r: 28, s: 1 }];
    same(generateWorld(SMALL, undefined, v, null, cache), generateWorld(SMALL, undefined, v));
    expect(cache.base).not.toBe(first);
  });
});

describe('改地形 · 删河湖', () => {
  const del = (x: number, y: number): TerrainOp => ({ kind: 'delWater', pts: [x, y], r: DEL_WATER_R, s: 1 });
  /** 最大的湖里的一块,和流量排第几的河中段的一点 */
  const lakeSpot = (w: World) => {
    let best: number[] = [];
    for (let i = 0; i < w.mesh.n; i++) {
      if (w.water[i] !== 2 || best.includes(i)) continue;
      const c = lakeAt(w.mesh, w.water, w.mesh.x[i], w.mesh.y[i])!;
      if (c.length > best.length) best = c;
    }
    return best;
  };
  const riverSpot = (w: World, rank: number): [number, number] => {
    const k = w.rivers.map((r, i) => [r.pts[r.pts.length - 1], i]).sort((a, b) => b[0] - a[0])[rank][1];
    const p = w.rivers[k].pts;
    const m = Math.floor(p.length / 6) * 3;
    return [Math.round(p[m]), Math.round(p[m + 1])];
  };

  it('清理:只留一个点,强度一律 1;压流量的门槛比画小溪的还低', () => {
    expect(cleanTerrainOp({ kind: 'delWater', pts: [10.4, 20, 30, 40], r: DEL_WATER_R, s: 0.5 })).toEqual({ kind: 'delWater', pts: [10, 20], r: DEL_WATER_R, s: 1 });
    expect(DEL_WATER_FLUX).toBeLessThan(CREEK_FRAC);
  });

  it('点在湖里:整片湖填成地,不再积出湖;没指着河湖的不生效', () => {
    const w = base7();
    const lake = lakeSpot(w);
    expect(lake.length).toBeGreaterThan(0);
    const c = lake[0];
    const out = generateWorld(SMALL, undefined, [del(Math.round(w.mesh.x[c]), Math.round(w.mesh.y[c]))]);
    for (const i of lake) expect(out.water[i]).toBe(0);
    expect(out.water.filter((v) => v === 2).length).toBe(w.water.filter((v) => v === 2).length - lake.length);
    // 海中间点一下:找不到河湖,世界不变
    const sea = farthestFrom(w, false);
    const none = generateWorld(SMALL, undefined, [del(Math.round(w.mesh.x[sea]), Math.round(w.mesh.y[sea]))]);
    expect(none.water).toEqual(w.water);
    expect(none.rivers.length).toBe(w.rivers.length);
  });

  it('点在河上:这条河连同支流不再出现,不留断头河;描红的和删掉的是同一批', () => {
    const w = base7();
    // 挑一条有支流的大河
    let [x, y] = riverSpot(w, 0);
    let hit = riversAt(w.rivers, w.water, x, y, DEL_WATER_R);
    for (let k = 1; k < 20 && hit.length < 2; k++) {
      [x, y] = riverSpot(w, k);
      hit = riversAt(w.rivers, w.water, x, y, DEL_WATER_R);
    }
    expect(hit.length).toBeGreaterThan(1);
    const out = generateWorld(SMALL, undefined, [del(x, y)]);
    expect(riversAt(out.rivers, out.water, x, y, DEL_WATER_R)).toEqual([]);
    // 删掉的河的地块上不再有河
    const gone = new Set<number>();
    for (const k of hit) w.rivers[k].cells.forEach((c, j, a) => j < a.length - 1 && w.water[c] === 0 && gone.add(c));
    for (const r of out.rivers) for (let j = 0; j < r.cells.length - 1; j++) expect(gone.has(r.cells[j])).toBe(false);
    // 不留断头河:每条河都流到海、湖、别的河或冰盖
    const on = new Set<number>();
    for (const r of out.rivers) r.cells.forEach((c, j, a) => j < a.length - 1 && on.add(c));
    for (const r of out.rivers) {
      const last = r.cells[r.cells.length - 1];
      expect(out.water[last] !== 0 || on.has(last) || out.temperature[last] < -9 || out.temperature[r.cells[r.cells.length - 2] ?? last] < -9).toBe(true);
    }
    // 别的河照旧:删的那批以外,原来的河口流量大的几条还在
    expect(out.rivers.length).toBeGreaterThan(w.rivers.length - hit.length - 5);
  });

  it('作者放的湖删不掉:点在上面不生效,描红也不认', () => {
    const w = base7();
    const c = farthestFrom(w, true);
    const lake: TerrainOp = { kind: 'lake', pts: [Math.round(w.mesh.x[c]), Math.round(w.mesh.y[c])], r: 16, s: 1 };
    const withLake = generateWorld(SMALL, undefined, [lake]);
    const [x, y] = lake.pts;
    expect(lakeAt(withLake.mesh, withLake.water, x, y)).not.toBeNull();
    expect(lakeAt(withLake.mesh, withLake.water, x, y, ownLakeCells(withLake.mesh, [lake]))).toBeNull();
    const both = generateWorld(SMALL, undefined, [del(x, y), lake]);
    expect(both.water).toEqual(withLake.water);
  });

  it('同样的删河湖两次生成逐字节相同', () => {
    const w = base7();
    const ops = [del(...riverSpot(w, 5))];
    expect(worldCheck(generateWorld(SMALL, undefined, ops))).toBe(worldCheck(generateWorld(SMALL, undefined, ops)));
  });
});

describe('改地形 · 存档', () => {
  const TERRAIN: TerrainOp[] = [
    { kind: 'volcano', pts: [812, 403], r: 28, s: 1.05 },
    { kind: 'range', pts: [1156, 380, 1215, 430, 1273, 483], r: 20, s: 1 },
    { kind: 'lake', pts: [336, 410], r: 16, s: 1 },
    { kind: 'raise', pts: [900, 600], r: 24, s: 1 },
    { kind: 'sink', pts: [100, 200, 120, 220], r: 14, s: 1 },
  ];
  const EDITS: WorldEdits = { names: { 'region:r7': '九嶷州' }, interventions: [], terrain: TERRAIN };

  it('存读往返不变;改了几处把地形修改算进去', () => {
    const save = makeSave(SMALL, EDITS, 'abc', '火山岛', '2026-09-27T08:00:00.000Z');
    const r = parseSave(saveText(save));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.save).toEqual(save);
    expect(r.save.edits.terrain).toEqual(TERRAIN);
    expect(editCount(r.save.edits)).toBe(1 + TERRAIN.length);
    // 存档是复制出来的
    const t = TERRAIN.map((o) => ({ ...o, pts: [...o.pts] }));
    const s2 = makeSave(SMALL, { ...EDITS, terrain: t }, 'x');
    t[0].pts[0] = 1;
    expect(s2.edits.terrain[0].pts[0]).toBe(812);
  });

  it('旧存档没有 terrain = 没改地形,不提示', () => {
    const old = JSON.parse(saveText(makeSave(SMALL, EMPTY_EDITS, 'c'))) as { edits: Record<string, unknown> };
    delete old.edits.terrain;
    const r = parseSave(JSON.stringify(old));
    expect(r.ok && r.save.edits.terrain).toEqual([]);
    expect(r.ok && r.warnings).toEqual([]);
  });

  it('格式不对的地形修改跳过,其余照读(y 夹回两极之间,x 按经度取模)', () => {
    const a = JSON.parse(saveText(makeSave(SMALL, EDITS, 'c'))) as { edits: Record<string, unknown> };
    a.edits.terrain = [TERRAIN[0], { kind: 'meteor', pts: [1, 2], r: 5, s: 1 }, 'bad', { kind: 'lake', pts: [5000, -3], r: 16, s: 1 }];
    const r = parseSave(JSON.stringify(a));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.edits.terrain).toEqual([TERRAIN[0], { kind: 'lake', pts: [5000 - 2 * TERRAIN_W, 0], r: 16, s: 1 }]);
    expect(r.warnings).toEqual(['有 2 处地形修改格式不对,已跳过']);
    const b = JSON.parse(saveText(makeSave(SMALL, EDITS, 'c'))) as { edits: Record<string, unknown> };
    b.edits.terrain = 'nope';
    const rb = parseSave(JSON.stringify(b));
    expect(rb.ok && rb.save.edits.terrain).toEqual([]);
    expect(rb.ok && rb.warnings).toEqual(['有 1 处地形修改格式不对,已跳过']);
  });
});

describe('改地形 · 手绘符号', () => {
  it('海里放一座小火山:离得远(> 200)的符号一个都不挪,林块不变', () => {
    const w0 = base7();
    const o = farthestFrom(w0, false);
    const [px, py] = [Math.round(w0.mesh.x[o]), Math.round(w0.mesh.y[o])];
    const w1 = generateWorld(SMALL, undefined, [{ kind: 'volcano', pts: [px, py], r: 28, s: 1 }]);
    const R = 200;
    const far = (x: number, y: number) => (x - px) ** 2 + (y - py) ** 2 > R * R;
    const a = planGlyphs(w0);
    const b = planGlyphs(w1);
    // 火山那里确实变了:多了一座火山符号
    expect(b.glyphs.filter((g) => g.kind === G_VOLCANO).length).toBe(1);
    // 远处的符号:位置、种类、地块、抖动、走向逐个相同;大小只许差一点点
    // (火山让远处个别地块的海拔差 1e-5 量级的浮点零头,符号大小跟着差 1e-6 量级,画出来看不出)
    const key = (g: Glyph) => `${g.kind}@${g.cell}:${g.x},${g.y}`;
    const ga = a.glyphs.filter((g) => far(g.x, g.y));
    const gb = new Map(b.glyphs.filter((g) => far(g.x, g.y)).map((g) => [key(g), g]));
    expect(ga.length).toBeGreaterThan(300);
    const moved = ga.filter((g) => !gb.has(key(g))).map(key);
    expect(moved).toEqual([]);
    expect(gb.size).toBe(ga.length);
    for (const g of ga) {
      const h = gb.get(key(g))!;
      expect([h.v, h.a, h.c]).toEqual([g.v, g.a, g.c]);
      expect(Math.abs(h.s - g.s)).toBeLessThan(1e-3);
    }
    // 画出来的先后(从上到下,互相遮挡)也一样
    expect(b.glyphs.filter((g) => far(g.x, g.y)).map(key)).toEqual(ga.map(key));
    // 林块:远处的地块逐个相同
    const { n, x, y } = w0.mesh;
    let diff = 0;
    let forested = 0;
    for (let i = 0; i < n; i++) {
      if (!far(x[i], y[i])) continue;
      if (a.forest[i]) forested++;
      if (a.forest[i] !== b.forest[i]) diff++;
    }
    expect(forested).toBeGreaterThan(300);
    expect(diff).toBe(0);
  });
});

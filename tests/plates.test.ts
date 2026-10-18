/**
 * 编辑地形「板块」页(gen/plateEdits.ts,草图里的 plates;生成在 tectonics.ts):改动的清理、漂移的说法、
 * 改方向快慢 / 陆壳洋壳 / 切开 / 合并 / 造山开关各自照新的板块重新长,存档往返;界面上选中、拖箭头、切开、合并和撤销。
 * 没改板块的世界逐字节不变。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { cleanSketch, sketchGrid, type SketchEdit } from '../src/gen/sketch';
import { PLATE_MAX_OPS, cleanPlateOp, cleanPlates, driftOf, driftText, type PlateEdit, type PlateOp } from '../src/gen/plateEdits';
import { makeSave, parseSave, saveText, worldCheck } from '../src/gen/savefile';
import { EMPTY_EDITS } from '../src/gen/edits';
import { rasterize } from '../src/gen/raster';
import { PLATE_ARROW_L, plateArrows } from '../src/render/layers';
import { clearEdits, getEdits } from '../src/ui/editsStore';
import {
  clearAllTerrain,
  redoTerrain,
  setTerrainProbe,
  setTerrainTool,
  setTerrainWrap,
  terrainClick,
  terrainCount,
  terrainDown,
  terrainMove,
  terrainUp,
  undoTerrain,
} from '../src/ui/TerrainTools';

const SMALL = { ...DEFAULT_PARAMS, cells: 12000, seed: 7 };
const gen = (plates: PlateEdit) => generateWorld(SMALL, undefined, undefined, sketchGrid(cleanSketch({ rest: 'auto', strokes: [], plates })!));

/** 板块 a、b 挨着的那段边界:a 一侧的地块和它在 b 那边的邻居 */
function border(w: World, a: number, b: number): [number, number][] {
  const { mesh, tect } = w;
  const out: [number, number][] = [];
  for (let i = 0; i < mesh.n; i++) {
    if (tect.plate[i] !== a) continue;
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if (tect.plate[mesh.adj[k]] === b) out.push([i, mesh.adj[k]]);
  }
  return out;
}
/** 相撞最狠的一对板块(边界上 convergence 加起来最大,至少 20 个地块长) */
function hardestPair(w: World): [number, number] {
  const { mesh, tect } = w;
  const sum = new Map<number, number>();
  const len = new Map<number, number>();
  for (let i = 0; i < mesh.n; i++) {
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
      const j = mesh.adj[k];
      const a = tect.plate[i];
      const b = tect.plate[j];
      if (a >= b) continue;
      const key = a * 1000 + b;
      sum.set(key, (sum.get(key) ?? 0) + tect.convergence[i]);
      len.set(key, (len.get(key) ?? 0) + 1);
    }
  }
  let best = -1;
  let bestV = -Infinity;
  for (const [key, v] of sum) if ((len.get(key) ?? 0) >= 20 && v / len.get(key)! > bestV) [best, bestV] = [key, v / len.get(key)!];
  return [Math.floor(best / 1000), best % 1000];
}
const mean = (w: World, cells: number[], f: Float32Array) => cells.reduce((s, i) => s + f[i], 0) / cells.length;
/** 东西方向绕圈:x 挪到离 ref 最近的那一圈 */
const near = (w: World, x: number, ref: number) => x - w.width * Math.round((x - ref) / w.width);

describe('改动的清理', () => {
  it('合格的原样返回;方向取整绕圈、速度夹住取半厘米、地壳只认两种;什么也没改的 set 丢掉', () => {
    const ok: PlateOp = { kind: 'set', pts: [300, 400], dir: 45, speed: 4 };
    expect(cleanPlateOp(ok)).toBe(ok);
    expect(cleanPlateOp({ kind: 'set', pts: [2050, 2000], dir: -90.4, speed: 99 })).toEqual({ kind: 'set', pts: [2, 1024], dir: 270, speed: 16 });
    expect(cleanPlateOp({ kind: 'set', pts: [1, 1], crust: 'lava' })).toBeNull();
    expect(cleanPlateOp({ kind: 'set', pts: [1, 1], crust: 'oceanic', speed: 3.3 })).toEqual({ kind: 'set', pts: [1, 1], speed: 3.5, crust: 'oceanic' });
    expect(cleanPlateOp({ kind: 'merge', pts: [1, 1] })).toBeNull();
    expect(cleanPlateOp({ kind: 'cut', pts: [10, 10] })).toBeNull();
    expect(cleanPlateOp({ kind: 'cut', pts: [2040, 10, 2060, 20] })).toEqual({ kind: 'cut', pts: [2040, 10, 2060, 20] });
    expect(cleanPlateOp({ kind: 'drift', pts: [1, 1] })).toBeNull();
  });

  it('一处没有又造山 = 没改;关了造山就算一处没有也留着;最多 PLATE_MAX_OPS 处', () => {
    expect(cleanPlates({ ops: [] })).toBeNull();
    expect(cleanPlates({ ops: [], orogeny: true })).toBeNull();
    expect(cleanPlates({ ops: [], orogeny: false })).toEqual({ ops: [], orogeny: false });
    const ok: PlateEdit = { ops: [{ kind: 'merge', pts: [1, 2, 3, 4] }] };
    expect(cleanPlates(ok)).toBe(ok);
    const many = { ops: Array.from({ length: PLATE_MAX_OPS + 5 }, () => ({ kind: 'set', pts: [5, 5], dir: 0 })) };
    expect(cleanPlates(many)!.ops).toHaveLength(PLATE_MAX_OPS);
    // 草图:只改了板块也算画了
    expect(cleanSketch({ rest: 'auto', strokes: [], plates: { ops: [], orogeny: false } })).toEqual({ rest: 'auto', strokes: [], plates: { ops: [], orogeny: false } });
    expect(cleanSketch({ rest: 'auto', strokes: [], plates: { ops: [] } })).toBeNull();
  });

  it('漂移的说法', () => {
    expect(driftText(45, 4)).toBe('每年 4 厘米，往东北');
    expect(driftText(180, 2.5)).toBe('每年 2.5 厘米，往南');
    expect(driftText(0, 0.2)).toBe('几乎不动');
    // 往东 0.5 = 每年 4 厘米往东
    expect(driftOf(0.5, 0).speed).toBe(4);
    expect(driftOf(0.5, 0).dir).toBeCloseTo(90, 4);
  });
});

describe('照改过的板块生成', () => {
  const base = generateWorld(SMALL);
  const [a, b] = hardestPair(base);
  const edge = border(base, a, b);
  const pt = (i: number): number[] => [Math.round(base.mesh.x[i]), Math.round(base.mesh.y[i])];
  // a 离开 b 的方向:边界上从 b 指向 a 的平均方向(0 = 北、90 = 东)
  let nx = 0;
  let ny = 0;
  for (const [i, j] of edge) {
    nx += base.mesh.x[i] - near(base, base.mesh.x[j], base.mesh.x[i]);
    ny += base.mesh.y[i] - base.mesh.y[j];
  }
  const away = Math.round((Math.atan2(nx, -ny) * 180) / Math.PI);
  const pa = pt(edge[0][0]);
  const pb = pt(edge[0][1]);

  it('没改板块的世界逐字节不变', () => {
    expect(worldCheck(generateWorld(SMALL, undefined, undefined, sketchGrid(cleanSketch({ rest: 'auto', strokes: [], plates: { ops: [] } }))))).toBe(worldCheck(base));
    expect(base.tect.noOrogeny).toBeUndefined();
  });

  it('相撞的两块改成背着走:边界从相撞变成分开,板块抬起的山没了', () => {
    const w = gen({
      ops: [
        { kind: 'set', pts: pa, dir: away, speed: 8 },
        { kind: 'set', pts: pb, dir: (away + 180) % 360, speed: 8 },
      ],
    });
    // 两块的编号、范围不变
    expect(w.tect.plateCount).toBe(base.tect.plateCount);
    const cells = edge.map(([i]) => i);
    expect(mean(base, cells, base.tect.convergence)).toBeGreaterThan(0);
    expect(mean(w, cells, w.tect.convergence)).toBeLessThan(0);
    expect(mean(w, cells, w.tect.uplift)).toBeLessThan(mean(base, cells, base.tect.uplift));
    // 同样的改动生成同样的世界
    expect(worldCheck(gen({ ops: [{ kind: 'set', pts: pa, dir: away, speed: 8 }, { kind: 'set', pts: pb, dir: (away + 180) % 360, speed: 8 }] }))).toBe(worldCheck(w));
  });

  it('改快慢:漂移照改的走(每年 8 厘米 = 速度 1)', () => {
    const w = gen({ ops: [{ kind: 'set', pts: pa, dir: 90, speed: 8 }] });
    const d = driftOf(w.tect.plateVx[a], w.tect.plateVy[a]);
    expect(d.dir).toBeCloseTo(90, 3);
    expect(d.speed).toBeCloseTo(8, 3);
    // 别的板块不变
    expect(w.tect.plateVx[b]).toBe(base.tect.plateVx[b]);
  });

  it('陆壳改洋壳:整块换成洋壳', () => {
    const k = base.tect.plateContinental.findIndex((c) => c === 1);
    const i = base.tect.plate.findIndex((p) => p === k);
    const w = gen({ ops: [{ kind: 'set', pts: pt(i), crust: 'oceanic' }] });
    expect(w.tect.plateContinental[k]).toBe(0);
    const cells = [...base.tect.plate.keys()].filter((c) => base.tect.plate[c] === k);
    const land = (x: World) => cells.filter((c) => x.elevation[c] > 0).length;
    expect(land(w)).toBeLessThan(land(base) * 0.6);
  });

  it('切开:线把一块分成两块,多一个编号,新边界两边起初一起走;合并:并回一块', () => {
    // 从 a 的边界一端横穿 a 中心画到另一边
    const cells = [...base.tect.plate.keys()].filter((c) => base.tect.plate[c] === a);
    const cx = cells.reduce((s, c) => s + near(base, base.mesh.x[c], base.mesh.x[cells[0]]), 0) / cells.length;
    const cy = cells.reduce((s, c) => s + base.mesh.y[c], 0) / cells.length;
    const pts: number[] = [];
    // 线只比 a 在这条纬线上的东西两头各长出一点,不切到别的板块
    const row = cells.filter((c) => Math.abs(base.mesh.y[c] - cy) < 15).map((c) => near(base, base.mesh.x[c], cx));
    const x0 = Math.min(...row) - 30;
    const x1 = Math.max(...row) + 30;
    for (let t = x0; t < x1; t += 20) pts.push(Math.round(t), Math.round(cy));
    pts.push(Math.round(x1), Math.round(cy));
    const w = gen({ ops: [{ kind: 'cut', pts }] });
    expect(w.tect.plateCount).toBe(base.tect.plateCount + 1);
    const n = base.tect.plateCount;
    const keep = cells.filter((c) => w.tect.plate[c] === a).length;
    const split = cells.filter((c) => w.tect.plate[c] === n).length;
    expect(keep + split).toBe(cells.length);
    expect(Math.min(keep, split)).toBeGreaterThan(cells.length * 0.1);
    // 新边界:两块转法一样,不碰不离
    const seam = border(w, a, n).map(([i]) => i);
    expect(seam.length).toBeGreaterThan(5);
    expect(Math.abs(mean(w, seam, w.tect.convergence))).toBeLessThan(0.05);
    // 切开后把新的那块改成背着原来那块走:新边界裂开
    const s = cells.find((c) => w.tect.plate[c] === n)!;
    const yOf = (k: number) => mean(w, cells.filter((c) => w.tect.plate[c] === k), w.mesh.y);
    const w2 = gen({ ops: [{ kind: 'cut', pts }, { kind: 'set', pts: pt(s), dir: yOf(n) > yOf(a) ? 180 : 0, speed: 8 }] });
    expect(mean(w2, seam, w2.tect.convergence)).toBeLessThan(-0.1);
    // 合并:点原来那块再点新的那块,并回 a,新的编号空着
    const north0 = cells.find((c) => w.tect.plate[c] === a)!;
    const w3 = gen({ ops: [{ kind: 'cut', pts }, { kind: 'merge', pts: [...pt(north0), ...pt(s)] }] });
    expect(cells.every((c) => w3.tect.plate[c] === a)).toBe(true);
    expect(w3.tect.plate.includes(n)).toBe(false);
    // 不挨着的两块合并不了
    const far = base.tect.plate.findIndex((p, c) => p !== a && !border(base, a, p).length && base.mesh.y[c] > 100 && base.mesh.y[c] < 900);
    const w4 = gen({ ops: [{ kind: 'merge', pts: [...pa, ...pt(far)] }] });
    expect(w4.tect.plate.includes(base.tect.plate[far])).toBe(true);
  });

  it('关掉「板块相撞时造山」:相撞的地方没有板块抬起的山,也不被拉成高山', () => {
    const w = gen({ ops: [], orogeny: false });
    expect(w.tect.noOrogeny).toBe(true);
    const cells = edge.map(([i]) => i);
    expect(mean(w, cells, w.tect.uplift)).toBeLessThan(mean(base, cells, base.tect.uplift) * 0.5);
    const top = (x: World) => [...x.elevation].sort((p, q) => q - p)[50];
    expect(top(w)).toBeLessThan(top(base));
  });
});

describe('存档', () => {
  it('板块改动存进去、读回来一样', () => {
    const edit: SketchEdit = { rest: 'auto', strokes: [], plates: { ops: [{ kind: 'set', pts: [300, 400], dir: 45, speed: 4 }, { kind: 'cut', pts: [1, 2, 30, 40] }], orogeny: false } };
    const back = parseSave(saveText(makeSave(SMALL, { ...EMPTY_EDITS, sketch: edit }, 'x')));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.save.edits.sketch).toEqual(edit);
  });
});

describe('界面:板块页', () => {
  const world = generateWorld(SMALL);
  const raster = rasterize(world, 0.25, false);
  const [a, b] = hardestPair(world);
  const [i, j] = border(world, a, b)[Math.floor(border(world, a, b).length / 2)];
  // 离边界远一点的两个点(各在 a、b 里)
  const inside = (k: number, c: number): [number, number] => {
    let best = c;
    let d = 0;
    for (let q = 0; q < world.mesh.n; q++) {
      if (world.tect.plate[q] !== k) continue;
      const dd = Math.hypot(near(world, world.mesh.x[q], world.mesh.x[c]) - world.mesh.x[c], world.mesh.y[q] - world.mesh.y[c]);
      if (dd < 60 && world.tect.distConv[q] > d) [best, d] = [q, world.tect.distConv[q]];
    }
    return [world.mesh.x[best], world.mesh.y[best]];
  };
  const pa = inside(a, i);
  const pb = inside(b, j);

  beforeEach(() => {
    clearEdits();
    clearAllTerrain();
    setTerrainWrap(2048);
    setTerrainProbe({ world, raster });
    setTerrainTool({ on: true, tool: 'plateSelect', r: 40, method: 'paint', h: 1, place: { volcano: 28, lake: 16, river: 9 }, shore: 0.5, level: 1, show: true, coast: 0.6 });
  });
  afterEach(() => {
    setTerrainProbe(null);
    setTerrainTool({ on: false });
  });

  it('选中:点一块选中它(不算一笔);拖它的箭头头改方向快慢,存成一处 set;没按在箭头头上的按下不归板块页', () => {
    terrainClick(pa);
    expect(terrainCount(getEdits())).toBe(0);
    // 没按在箭头头上:按下不归它管(地图照常拖动)
    expect(terrainDown([pa[0] + 300, pa[1] + 200], 0)).toBe(false);
    const arrow = plateArrows(world)[a]!;
    const tip: [number, number] = [arrow.x + arrow.dx * 5.5, arrow.y + arrow.dy * 5.5];
    expect(terrainDown(tip, 0)).toBe(true);
    // 拖到箭头起点正北 PLATE_ARROW_L × 5.5 × 0.5:每年 4 厘米往北
    terrainMove([arrow.x, arrow.y - PLATE_ARROW_L * 5.5 * 0.25]);
    terrainMove([arrow.x, arrow.y - PLATE_ARROW_L * 5.5 * 0.5]);
    terrainUp();
    const ops = getEdits().sketch!.plates!.ops;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'set', dir: 0, speed: 4 });
    expect(terrainCount(getEdits())).toBe(1);
  });

  it('切开:画一条线横穿一块,存成一处 cut;没切开任何一块的线不存', () => {
    setTerrainTool({ tool: 'plateCut' });
    expect(terrainDown([pa[0] - 2, pa[1] - 2], 0)).toBe(true);
    terrainMove([pa[0] + 2, pa[1] + 2]);
    terrainUp();
    expect(getEdits().sketch?.plates).toBeUndefined();
    const cells = [...world.tect.plate.keys()].filter((c) => world.tect.plate[c] === a);
    const cy = cells.reduce((s, c) => s + world.mesh.y[c], 0) / cells.length;
    const cx = cells.reduce((s, c) => s + near(world, world.mesh.x[c], world.mesh.x[cells[0]]), 0) / cells.length;
    const row = cells.filter((c) => Math.abs(world.mesh.y[c] - cy) < 15).map((c) => near(world, world.mesh.x[c], cx));
    const x0 = Math.min(...row) - 30;
    const x1 = Math.max(...row) + 30;
    expect(terrainDown([x0, cy], 0)).toBe(true);
    for (let t = x0 + 20; t < x1; t += 20) terrainMove([t, cy]);
    terrainMove([x1, cy]);
    terrainUp();
    expect(getEdits().sketch!.plates!.ops.map((o) => o.kind)).toEqual(['cut']);
    expect(terrainCount(getEdits())).toBe(1);
  });

  it('合并:依次点两块挨着的,存成一处 merge;再点同一块取消;撤销、重做', () => {
    setTerrainTool({ tool: 'plateMerge' });
    terrainClick(pa);
    terrainClick(pa);
    terrainClick(pb);
    expect(getEdits().sketch?.plates).toBeUndefined();
    terrainClick(pa);
    terrainClick(pb);
    const ops = getEdits().sketch!.plates!.ops;
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe('merge');
    undoTerrain();
    expect(getEdits().sketch?.plates).toBeUndefined();
    redoTerrain();
    expect(getEdits().sketch!.plates!.ops).toHaveLength(1);
  });
});

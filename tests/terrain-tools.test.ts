/**
 * 编辑地形的工具(ui/TerrainTools.tsx):在地图上按下、拖动、松开画成草图的一笔或一条河,点一下放火山湖;
 * 撤销 / 重做按先后把草图的笔和放的一处混在一起算;全部清除;海岸线的选择在画第一笔前也记着;画了几笔的说法
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearEdits, getEdits, putSketch, addTerrainOp, setEdits } from '../src/ui/editsStore';
import { EMPTY_EDITS, type TerrainOp } from '../src/gen/edits';
import {
  clearAllTerrain,
  erasedOps,
  getTerrainTool,
  redoTerrain,
  setTerrainCoast,
  setTerrainPage,
  setTerrainTool,
  setTerrainWrap,
  terrainCancel,
  terrainClick,
  terrainCount,
  terrainDown,
  terrainMove,
  terrainSide,
  terrainUp,
  undoTerrain,
} from '../src/ui/TerrainTools';

/** 按下 → 依次移过这些点 → 松开 */
function drag(pts: [number, number][]) {
  expect(terrainDown(pts[0], 0)).toBe(true);
  for (const p of pts.slice(1)) terrainMove(p);
  terrainUp();
}

beforeEach(() => {
  clearEdits();
  clearAllTerrain();
  setTerrainWrap(2048);
  setTerrainTool({ on: true, tool: 'land', r: 40, method: 'paint', h: 1, place: { volcano: 28, lake: 16, river: 9 }, shore: 0.5, level: 1, show: true, coast: 0.6 });
});
afterEach(() => setTerrainTool({ on: false }));

describe('编辑地形:画', () => {
  it('涂一笔 = 草图加一笔(半径、高低照工具);圈起来填满 = fill 1;没开编辑地形时不归它管', () => {
    drag([
      [400, 400],
      [460, 400],
      [520, 410],
    ]);
    setTerrainTool({ tool: 'mountain', r: 12, h: 2 });
    drag([
      [600, 300],
      [700, 320],
    ]);
    setTerrainTool({ tool: 'sea', method: 'lasso' });
    drag([
      [800, 500],
      [860, 500],
      [860, 560],
      [800, 560],
    ]);
    const s = getEdits().sketch!;
    expect(s.strokes.map((x) => x.kind)).toEqual(['land', 'mountain', 'sea']);
    expect(s.strokes[0]).toMatchObject({ r: 40, pts: [400, 400, 460, 400, 520, 410] });
    expect(s.strokes[0].h).toBeUndefined();
    expect(s.strokes[1]).toMatchObject({ r: 12, h: 2 });
    expect(s.strokes[2].fill).toBe(1);
    expect(s.strokes[2].pts.length).toBeGreaterThanOrEqual(8);
    setTerrainTool({ on: false });
    expect(terrainDown([100, 100], 0)).toBe(false);
    expect(terrainClick([100, 100])).toBe(false);
  });

  it('跨 180° 经线涂的一笔是连着的(点按上一个点展开)', () => {
    drag([
      [2030, 400],
      [10, 402],
      [40, 404],
    ]);
    const xs = getEdits().sketch!.strokes[0].pts.filter((_, i) => i % 2 === 0);
    expect(xs[0]).toBe(2030);
    expect(Math.max(...xs)).toBeGreaterThan(2048);
  });

  it('火山、湖点一下放一处(拖动不画);河要画成线,点一下不算', () => {
    setTerrainTool({ tool: 'volcano' });
    expect(terrainDown([500, 500], 0)).toBe(false);
    expect(terrainClick([500, 500])).toBe(true);
    setTerrainTool({ tool: 'river' });
    drag([[600, 600]]);
    drag([
      [600, 600],
      [640, 660],
      [650, 720],
    ]);
    const t = getEdits().terrain;
    expect(t.map((o) => o.kind)).toEqual(['volcano', 'river']);
    expect(t[1].pts.length).toBe(6);
    expect(getEdits().sketch).toBeUndefined();
  });

  it('放一处的大小是滑条:火山、湖、河照工具的半径,强度跟着大小取;湖带上湖岸', () => {
    setTerrainTool({ tool: 'volcano', place: { volcano: 50, lake: 7, river: 18 }, shore: 1 });
    terrainClick([500, 500]);
    setTerrainTool({ tool: 'lake' });
    terrainClick([520, 500]);
    setTerrainTool({ tool: 'river' });
    drag([
      [600, 600],
      [640, 660],
    ]);
    const t = getEdits().terrain;
    expect(t[0]).toMatchObject({ kind: 'volcano', r: 50, s: 1.3 });
    expect(t[0].e).toBeUndefined();
    expect(t[1]).toMatchObject({ kind: 'lake', r: 7, s: 0.7, e: 1 });
    expect(t[2]).toMatchObject({ kind: 'river', r: 18, s: 1.3 });
  });

  it('改气候:涂一笔 = 一处地形修改(半径、程度照工具),圈起来填满带 f;两页各记着上次的笔', () => {
    setTerrainTool({ tool: 'hills' });
    setTerrainPage('climate');
    expect(getTerrainTool().tool).toBe('wet');
    setTerrainTool({ tool: 'warm', level: 2, r: 30 });
    drag([
      [400, 400],
      [460, 400],
    ]);
    setTerrainTool({ method: 'lasso', level: 0 });
    drag([
      [800, 500],
      [860, 500],
      [860, 560],
      [800, 560],
    ]);
    const t = getEdits().terrain;
    expect(t[0]).toMatchObject({ kind: 'warm', r: 30, s: 1.6, pts: [400, 400, 460, 400] });
    expect(t[0].f).toBeUndefined();
    expect(t[1]).toMatchObject({ kind: 'warm', s: 0.5, f: 1 });
    expect(getEdits().sketch).toBeUndefined();
    setTerrainPage('shape');
    expect(getTerrainTool().tool).toBe('hills');
    setTerrainPage('climate');
    expect(getTerrainTool().tool).toBe('warm');
  });

  it('第二根手指紧跟着按下:刚开始的那一笔不算', () => {
    expect(terrainDown([300, 300], 0)).toBe(true);
    expect(terrainCancel()).toBe(true);
    terrainUp();
    expect(getEdits().sketch).toBeUndefined();
  });
});

describe('编辑地形:撤销 / 重做 / 全部清除', () => {
  it('草图的笔和放的一处按先后撤销,撤掉的能重做;撤完又画了别的就不能重做', () => {
    drag([
      [400, 400],
      [460, 400],
    ]);
    setTerrainTool({ tool: 'volcano' });
    terrainClick([500, 500]);
    setTerrainTool({ tool: 'hills' });
    drag([
      [700, 400],
      [760, 400],
    ]);
    expect(terrainCount(getEdits())).toBe(3);
    undoTerrain();
    expect(getEdits().sketch!.strokes.map((s) => s.kind)).toEqual(['land']);
    expect(getEdits().terrain).toHaveLength(1);
    undoTerrain();
    expect(getEdits().terrain).toHaveLength(0);
    expect(terrainCount(getEdits())).toBe(1);
    redoTerrain();
    expect(getEdits().terrain.map((o) => o.kind)).toEqual(['volcano']);
    redoTerrain();
    expect(getEdits().sketch!.strokes.map((s) => s.kind)).toEqual(['land', 'hills']);
    // 都重做回来了,再重做没东西
    redoTerrain();
    expect(terrainCount(getEdits())).toBe(3);
    undoTerrain();
    drag([
      [900, 400],
      [960, 400],
    ]);
    redoTerrain();
    expect(getEdits().sketch!.strokes).toHaveLength(2);
  });

  it('擦掉碰到的火山、湖、河整个去掉,和擦的这一笔算同一步:撤销一起回来,重做一起去掉', () => {
    setTerrainTool({ tool: 'volcano' });
    terrainClick([300, 300]);
    setTerrainTool({ tool: 'lake' });
    terrainClick([600, 400]);
    setTerrainTool({ tool: 'river' });
    drag([
      [900, 300],
      [900, 360],
      [905, 420],
    ]);
    setTerrainTool({ tool: 'land' });
    drag([
      [1200, 300],
      [1260, 300],
    ]);
    const before = getEdits().terrain;
    // 擦过湖和河,没碰火山
    const pts = [580, 400, 640, 400, 700, 390, 800, 380, 880, 370, 920, 360];
    expect(erasedOps(before, { kind: 'erase', r: 20, pts })).toEqual([1, 2]);
    // 两点隔得很远的河,擦过中间那一段也算碰到
    const longRiver: TerrainOp = { kind: 'river', pts: [100, 300, 700, 300], r: 8, s: 1 };
    expect(erasedOps([longRiver], { kind: 'erase', r: 10, pts: [400, 280, 400, 320] })).toEqual([0]);
    expect(erasedOps([longRiver], { kind: 'erase', r: 10, pts: [400, 340, 400, 380] })).toEqual([]);
    setTerrainTool({ tool: 'erase', r: 20 });
    drag(Array.from({ length: pts.length / 2 }, (_, i) => [pts[2 * i], pts[2 * i + 1]] as [number, number]));
    expect(getEdits().terrain.map((o) => o.kind)).toEqual(['volcano']);
    expect(getEdits().sketch!.strokes.map((s) => s.kind)).toEqual(['land', 'erase']);
    expect(terrainCount(getEdits())).toBe(3);
    undoTerrain();
    expect(getEdits().terrain).toEqual(before);
    expect(getEdits().sketch!.strokes.map((s) => s.kind)).toEqual(['land']);
    redoTerrain();
    expect(getEdits().terrain.map((o) => o.kind)).toEqual(['volcano']);
    expect(getEdits().sketch!.strokes).toHaveLength(2);
    // 一路撤:擦掉 → 涂陆地 → 河,按先后
    undoTerrain();
    undoTerrain();
    expect(getEdits().sketch).toBeUndefined();
    expect(getEdits().terrain.map((o) => o.kind)).toEqual(['volcano', 'lake', 'river']);
    undoTerrain();
    expect(getEdits().terrain.map((o) => o.kind)).toEqual(['volcano', 'lake']);
    // 圈起来擦:圈住火山
    setTerrainTool({ tool: 'erase', method: 'lasso' });
    drag([
      [250, 250],
      [350, 250],
      [350, 350],
      [250, 350],
    ]);
    expect(getEdits().terrain.map((o) => o.kind)).toEqual(['lake']);
  });

  it('别处加的(读档、助手)也撤得掉:先撤草图,再撤放的', () => {
    putSketch({ rest: 'auto', strokes: [{ kind: 'land', r: 20, pts: [100, 100] }] });
    addTerrainOp({ kind: 'range', pts: [200, 200, 260, 220], r: 20, s: 1 });
    undoTerrain();
    expect(getEdits().sketch).toBeUndefined();
    expect(getEdits().terrain).toHaveLength(1);
    undoTerrain();
    expect(getEdits().terrain).toHaveLength(0);
  });

  it('换了世界(整个换掉修改):上一个世界记的先后作废,撤销按"先撤草图,再撤放的"', () => {
    drag([
      [400, 400],
      [460, 400],
    ]);
    setTerrainTool({ tool: 'volcano' });
    terrainClick([500, 500]);
    setTerrainTool({ tool: 'land' });
    // 读档:新世界先放了一处、后画了一笔(记录里没有它们的先后)
    setEdits({ ...EMPTY_EDITS, sketch: { rest: 'auto', strokes: [{ kind: 'land', r: 20, pts: [100, 100] }] }, terrain: [{ kind: 'lake', pts: [200, 200], r: 16, s: 1 }] });
    undoTerrain();
    expect(getEdits().sketch).toBeUndefined();
    expect(getEdits().terrain).toHaveLength(1);
    // 上一个世界撤掉的也不能重做到这里
    setEdits({ ...EMPTY_EDITS });
    drag([
      [400, 400],
      [460, 400],
    ]);
    undoTerrain();
    setEdits({ ...EMPTY_EDITS });
    redoTerrain();
    expect(getEdits().sketch).toBeUndefined();
  });

  it('全部清除:草图、放的、"都是海"一起清掉', () => {
    putSketch({ rest: 'sea', coast: 1, strokes: [{ kind: 'land', r: 20, pts: [100, 100] }] });
    addTerrainOp({ kind: 'lake', pts: [200, 200], r: 16, s: 1 });
    clearAllTerrain();
    expect(getEdits().sketch).toBeUndefined();
    expect(getEdits().terrain).toHaveLength(0);
  });
});

describe('编辑地形:海岸线', () => {
  it('还没画就选了曲折:画第一笔时带上;撤掉最后一笔再重做,海岸线不变', () => {
    setTerrainCoast(1);
    expect(getEdits().sketch).toBeUndefined();
    drag([
      [400, 400],
      [460, 400],
    ]);
    expect(getEdits().sketch!.coast).toBe(1);
    setTerrainCoast(0);
    expect(getEdits().sketch!.coast).toBe(0);
    undoTerrain();
    expect(getEdits().sketch).toBeUndefined();
    redoTerrain();
    expect(getEdits().sketch!.coast).toBe(0);
    // 默认的适中不存
    setTerrainCoast(0.6);
    expect(getEdits().sketch!.coast).toBeUndefined();
  });
});

describe('编辑地形:说法', () => {
  it('画了几笔 = 草图的笔 + 放的一处;一笔没画但没涂的都是海 = "都是海"', () => {
    expect(terrainSide(getEdits(), '还没改')).toBe('还没改');
    putSketch({ rest: 'sea', strokes: [] });
    expect(terrainSide(getEdits(), '还没改')).toBe('都是海');
    addTerrainOp({ kind: 'volcano', pts: [200, 200], r: 28, s: 1 });
    putSketch({ rest: 'sea', strokes: [{ kind: 'land', r: 20, pts: [100, 100] }] });
    expect(terrainSide(getEdits(), '没改过')).toBe('画了 2 笔');
  });
});

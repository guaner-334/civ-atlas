import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { EMPTY_EDITS, civSeedOf, cleanCivSeed, cleanMapRef, newHistoryEdits, type TerrainOp, type WorldEdits } from '../src/gen/edits';
import { editCount, makeSave, parseSave, worldCheck } from '../src/gen/savefile';
import { makePart, recipeOfSave, recipeText } from '../src/gen/snapshot';

const small = { ...DEFAULT_PARAMS, seed: 7, cells: 12000 };
const VOLCANO: TerrainOp = { kind: 'volcano', pts: [1024, 512], r: 20, s: 1 };

const worlds = new Map<string, World>();
function world(terrain: TerrainOp[] = []): World {
  const key = JSON.stringify(terrain);
  let w = worlds.get(key);
  if (!w) worlds.set(key, (w = generateWorld(small, undefined, terrain)));
  return w;
}

/** 历史里能比的部分(数组、民族、国家、城、人物) */
function printOf(c: Civ) {
  return {
    seed: c.seed,
    regions: Array.from(c.regions.of),
    culture: Array.from(c.culture),
    polity: Array.from(c.polity),
    cultures: c.cultures.map((x) => [x.name, x.hearth, x.born]),
    polities: c.polities.map((x) => [x.name, x.founded]),
    settlements: c.settlements.map((x) => x.name),
    places: c.places.map((x) => x.name),
    people: c.people?.map((x) => x.name) ?? [],
  };
}

describe('文明种子', () => {
  it('不给 = 地图种子:没改地形的世界,写明等于地图种子的和不写的逐字节一样', () => {
    const w = world();
    const a = generateCiv(w);
    const b = generateCiv(w, { civSeed: small.seed });
    expect(a.seed).toBe(small.seed);
    expect(isDeepStrictEqual(printOf(a), printOf(b))).toBe(true);
  });

  it('同一张地图、同一个文明种子,两次推出来一样;换一个文明种子,州、民族、国家都不一样,地图一点不变', () => {
    const w = world();
    const check = worldCheck(w);
    const elev = w.elevation.slice();
    const a = generateCiv(w, { civSeed: 52817 });
    const again = generateCiv(w, { civSeed: 52817 });
    const b = generateCiv(w, { civSeed: 90311 });
    expect(isDeepStrictEqual(printOf(a), printOf(again))).toBe(true);
    expect(a.seed).toBe(52817);
    expect(b.seed).toBe(90311);
    // 不只是换名字:州的划分、民族的发源地、国家都换了
    expect(Array.from(a.regions.of)).not.toEqual(Array.from(b.regions.of));
    expect(a.cultures.map((x) => x.hearth)).not.toEqual(b.cultures.map((x) => x.hearth));
    expect(a.polities.map((x) => x.name)).not.toEqual(b.polities.map((x) => x.name));
    expect(a.polities.length).toBeGreaterThan(0);
    expect(b.polities.length).toBeGreaterThan(0);
    // 推演只读地图
    expect(worldCheck(w)).toBe(check);
    expect(Array.from(w.elevation)).toEqual(Array.from(elev));
    expect(w.params.seed).toBe(small.seed);
  });

  it('改过地形的地图上新开:按这张地图本身标定,不看(也不现算)没改地形那颗星球的节拍', () => {
    const w = world([VOLCANO]);
    const a = generateCiv(w, { civSeed: 52817 });
    // 给一个离谱的节拍:新开的历史不看它(看的话民族扩张、城的大小全变)
    const b = generateCiv(w, { civSeed: 52817, tempo: { spread: 9999, capNorm: 9999 } });
    expect(isDeepStrictEqual(printOf(a), printOf(b))).toBe(true);
    // 没写文明种子的老路照旧看节拍
    const c = generateCiv(w, { tempo: { spread: 9999, capNorm: 9999 } });
    const d = generateCiv(w, { tempo: { spread: 30, capNorm: 1 } });
    expect(isDeepStrictEqual(printOf(c), printOf(d))).toBe(false);
  });

  it('文明种子清理:整数才认', () => {
    expect(cleanCivSeed(52817)).toBe(52817);
    expect(cleanCivSeed(-3)).toBe(-3);
    expect(cleanCivSeed(1.5)).toBeUndefined();
    expect(cleanCivSeed('7')).toBeUndefined();
    expect(cleanCivSeed(NaN)).toBeUndefined();
    expect(civSeedOf({}, 7)).toBe(7);
    expect(civSeedOf({ civSeed: 9 }, 7)).toBe(9);
  });
});

describe('在一张地图上新开一段历史', () => {
  const base: WorldEdits = {
    names: { 'polity:c4567#0': '青渊' },
    aiNames: { 'polity:c4567#0': { name: '青渊' } },
    interventions: [{ kind: 'protect', target: 'polity:c4567#0', from: 100 } as unknown as WorldEdits['interventions'][number]],
    terrain: [VOLCANO],
    sketch: { rest: 'auto', strokes: [{ kind: 'land', r: 32, pts: [700, 300, 760, 310] }] } as unknown as WorldEdits['sketch'],
    upheavals: [{ year: 1600, ops: [{ kind: 'sink', pts: [1856, 574, 1936, 584], r: 40, s: 1.1 }] }],
    marks: [{ id: 1, title: '故乡', color: 'red', from: 10, at: [10, 10] }],
    flags: { 'polity:c4567#0': 'b/plain/W' },
    nameMix: { xianxia: 6 },
    endYear: 6000,
    frontier: { spread: 1.5 } as unknown as WorldEdits['frontier'],
    origins: { pts: [976, 342] } as unknown as WorldEdits['origins'],
    era: { name: '公元', epoch: 2500 },
    months: 24,
  };

  it('只带初始地图(地形修改、草图)和另选的几样,原来的历史、作者内容一样不带', () => {
    const e = newHistoryEdits(base, { civSeed: 52817, from: 'w1', endYear: 4000 });
    expect(e).toEqual({ names: {}, interventions: [], terrain: [VOLCANO], sketch: base.sketch, endYear: 4000, civSeed: 52817, map: { from: 'w1' } });
    // 复制出来的,改它不动原来的
    e.terrain[0].pts[0] = 1;
    expect(base.terrain[0].pts[0]).toBe(1024);
    // 地名风格要明说才带
    expect(newHistoryEdits(base, { civSeed: 1, from: 'w1', nameMix: { central: 2 } }).nameMix).toEqual({ central: 2 });
  });

  it('从新开的那段再新开:记最早那个世界;知道地图校验就记上', () => {
    const sum = 'a'.repeat(64);
    const b = newHistoryEdits(EMPTY_EDITS, { civSeed: 5, from: 'wA', sum });
    expect(b.map).toEqual({ sum, from: 'wA' });
    const c = newHistoryEdits(b, { civSeed: 6, from: 'wB' });
    expect(c.map).toEqual({ from: 'wA' });
  });

  it('地图记录清理:认不出的项去掉', () => {
    expect(cleanMapRef({ sum: 'A'.repeat(64), from: 'w1' })).toEqual({ from: 'w1' });
    expect(cleanMapRef({ sum: 'f'.repeat(64) })).toEqual({ sum: 'f'.repeat(64) });
    expect(cleanMapRef({ from: '' })).toBeUndefined();
    expect(cleanMapRef('w1')).toBeUndefined();
    expect(cleanMapRef(null)).toBeUndefined();
  });

  it('存档:文明种子、地图记录存进去读回来;没有这两项的旧存档读回来也没有,配方和以前一样', () => {
    const sum = 'b'.repeat(64);
    const e = newHistoryEdits(EMPTY_EDITS, { civSeed: 52817, from: 'w1', sum });
    const save = makeSave(small, e, 'x', '苍澜界 另一段历史');
    expect(save.edits.civSeed).toBe(52817);
    expect(save.edits.map).toEqual({ sum, from: 'w1' });
    const r = parseSave(JSON.stringify(save));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.edits.civSeed).toBe(52817);
    expect(r.save.edits.map).toEqual({ sum, from: 'w1' });
    expect(r.warnings).toEqual([]);
    expect(recipeOfSave(r.save).civSeed).toBe(52817);
    // 文明种子算一处修改
    expect(editCount(r.save.edits)).toBe(editCount({ ...r.save.edits, civSeed: undefined }) + 1);

    const old = makeSave(small, EMPTY_EDITS, 'x');
    expect('civSeed' in old.edits).toBe(false);
    expect('map' in old.edits).toBe(false);
    expect(recipeText(recipeOfSave(old))).not.toContain('civSeed');
    // 配方:写了文明种子的和没写的不是同一份结果
    expect(recipeText(recipeOfSave(save))).not.toBe(recipeText(recipeOfSave({ ...save, edits: { ...save.edits, civSeed: undefined } })));
  });

  it('存档里的文明种子不是整数:去掉,按地图种子推,提示一句', () => {
    const save = makeSave(small, EMPTY_EDITS, 'x');
    const raw = JSON.parse(JSON.stringify(save)) as { edits: Record<string, unknown> };
    raw.edits.civSeed = 'abc';
    raw.edits.map = { sum: 'nope', from: 'w1' };
    const r = parseSave(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.edits.civSeed).toBeUndefined();
    expect(r.save.edits.map).toEqual({ from: 'w1' });
    expect(r.warnings).toContain('文明种子认不出来,按地图种子推演');
  });

  it('同一张地图上的两段历史,地图那块原件逐字节一样(校验相同)', async () => {
    const w = world([VOLCANO]);
    const { history: _h, ...rest } = w;
    void _h;
    const a = await makePart('map', { ...rest, history: [] });
    generateCiv(w, { civSeed: 52817 });
    const again = generateWorld(small, undefined, [VOLCANO]);
    const { history: _h2, ...rest2 } = again;
    void _h2;
    const b = await makePart('map', { ...rest2, history: [] });
    expect(b.sum).toBe(a.sum);
  });
});

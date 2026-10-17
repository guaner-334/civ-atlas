/**
 * 照原样打开的旧世界:浏览器里有建它那一版的原件就读原件(resultStore.frozenResult),存档照旧记那一版;
 * 改历史先问要不要另存一份(editsStore 的 historyGate),另存的那份叫「…（新版）」、按现在的版本推演,原来那份不动。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as saveStore from '../src/ui/saveStore';
import { addEditsBatch, addIntervention, addUpheaval, clearEdits, clearTerrainAndSketch, commitEdits, getEdits, setEdits, setEndYear, setHistoryGate, setName } from '../src/ui/editsStore';
import { clearPending, getPending, pushPending, queueIntervention } from '../src/ui/pendingStore';
import { clearToast } from '../src/ui/toastStore';
import { endRun } from '../src/ui/panelStore';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { EMPTY_EDITS, GENERATOR_VERSION, type Intervention, type Upheaval, type WorldEdits } from '../src/gen/edits';
import { makeSave, type SaveFile } from '../src/gen/savefile';
import { SNAPSHOT_FORMAT, makePart, recipeKey, recipeOfSave, type Snapshot } from '../src/gen/snapshot';
import { _setResultBackend, copyResults, frozenResult, memoryResults, toldFrozen } from '../src/ui/resultStore';

class FakeStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const g = globalThis as { localStorage?: unknown };
const OLD = GENERATOR_VERSION - 1;
const PARAMS = { ...DEFAULT_PARAMS, seed: 7 };
const protect = (n: number, from = 100): Intervention => ({ kind: 'protect', a: `polity:r${n}#0`, from });
const VOLCANO: Upheaval = { year: 80, ops: [{ kind: 'volcano', pts: [1278, 768], r: 36, s: 1.1 }] };
let mem = memoryResults();
let stopAuto: (() => void) | null = null;

/** 旧版本建的、存在"我的世界"里的世界 */
function oldWorld(edits: WorldEdits = EMPTY_EDITS, title = '青岚纪'): string {
  const save: SaveFile = { ...makeSave(PARAMS, edits, 'c7', title), generator: OLD };
  const id = saveStore.importSave(save);
  if (!id) throw new Error('存不进去');
  return id;
}

/** 那一版的原件(内容随便,配方是真的) */
async function snapshotOf(save: SaveFile, generator = save.generator): Promise<Snapshot> {
  return { format: SNAPSHOT_FORMAT, generator, recipe: await recipeKey(recipeOfSave(save)), formation: false, parts: [await makePart('map', { tag: 'x' })] };
}
async function putSnapshot(id: string, s: Snapshot) {
  await mem.put({ id, generator: s.generator, app: 'test', at: '', snapshot: s }, { id, generator: s.generator, recipe: s.recipe, sums: '', size: 0, at: '' });
}

/** 模拟 App 照原样打开(读原件成功以后):套上存着的修改,当前世界记着建它的版本 */
function openFrozen(id: string) {
  const w = saveStore.loadWorld(id)!;
  saveStore.detachWorld();
  clearEdits();
  setEdits(w.save.edits);
  saveStore.attachWorld({ id, params: w.save.params, check: 'c7', kind: 'created', title: w.save.title, saved: w.save.edits, frozen: w.save.generator });
}

/** App 挂的拦法:照原样打开的世界改历史 = 拦下(记下问过几次) */
let asked: WorldEdits[] = [];
function gateLikeApp() {
  setHistoryGate((next) => {
    if (saveStore.currentWorld()?.frozen === undefined) return false;
    asked.push(next);
    return true;
  });
}

beforeEach(() => {
  g.localStorage = new FakeStorage();
  saveStore._resetForTest();
  clearEdits();
  stopAuto = saveStore.startAutoSave();
  mem = memoryResults();
  _setResultBackend(mem);
  asked = [];
});
afterEach(() => {
  stopAuto?.();
  setHistoryGate(null);
  clearPending();
  clearToast();
  endRun();
  saveStore._resetForTest();
  clearEdits();
  _setResultBackend(undefined);
  delete g.localStorage;
});

describe('照原样打开旧世界:找原件', () => {
  it('旧版本的存档、有那一版的原件、配方对得上 = 用它;对不上 = 坏了;没有、存档是现在的版本 = 没有', async () => {
    const id = oldWorld({ ...EMPTY_EDITS, interventions: [protect(1)] });
    const save = saveStore.loadWorld(id)!.save;
    expect(await frozenResult(id, save)).toBeNull();
    const s = await snapshotOf(save);
    await putSnapshot(id, s);
    expect(await frozenResult(id, save)).toEqual(s);
    // 存档后来又改了历史(配方变了):这份原件不是它的
    const changed: SaveFile = { ...save, edits: { ...save.edits, interventions: [protect(2)] } };
    expect(await frozenResult(id, changed)).toBe('broken');
    // 改名不算改配方
    const renamed: SaveFile = { ...save, edits: { ...save.edits, names: { 'region:c1': '甲' } } };
    expect(await frozenResult(id, renamed)).toEqual(s);
    // 格式认不得
    await putSnapshot(id, { ...s, format: 99 as typeof SNAPSHOT_FORMAT });
    expect(await frozenResult(id, save)).toBe('broken');
    // 现在这一版建的:照常生成
    expect(await frozenResult(id, { ...save, generator: GENERATOR_VERSION })).toBeNull();
  });

  it('浏览器里读原件出错:算坏了(不当成没有)', async () => {
    const id = oldWorld();
    const save = saveStore.loadWorld(id)!.save;
    await putSnapshot(id, await snapshotOf(save));
    let calls = 0;
    _setResultBackend({
      ...mem,
      get: async () => {
        calls++;
        throw new Error('读不出来');
      },
    });
    expect(await frozenResult(id, save)).toBe('broken');
    expect(calls).toBe(2);
  });

  it('刚复制的世界马上打开:原件复制完再找', async () => {
    const id = oldWorld();
    const save = saveStore.loadWorld(id)!.save;
    const s = await snapshotOf(save);
    await putSnapshot(id, s);
    const nid = saveStore.duplicateWorld(id)!;
    void copyResults(id, nid);
    expect(await frozenResult(nid, saveStore.loadWorld(nid)!.save)).toEqual(s);
  });

  it('打开时的提示:同一个世界在这一版里只说一次', () => {
    expect(toldFrozen('w1')).toBe(false);
    expect(toldFrozen('w1')).toBe(true);
    expect(toldFrozen('w2')).toBe(false);
    // 换了一版网站再说一次
    const told = JSON.parse((g.localStorage as FakeStorage).getItem('civ-atlas:frozen-told')!) as Record<string, number>;
    told.w1 = OLD;
    (g.localStorage as FakeStorage).setItem('civ-atlas:frozen-told', JSON.stringify(told));
    expect(toldFrozen('w1')).toBe(false);
  });
});

describe('照原样打开旧世界:从文件打开', () => {
  it('和存着的旧世界一样、版本更新的文件:存着的跟着记文件的版本(以后不再照原样打开),旧的那份留作原样', () => {
    const id = oldWorld();
    const old = saveStore.loadWorld(id)!.save;
    expect(saveStore.importSave({ ...old })).toBe(id);
    expect(saveStore.loadWorld(id)!.save.generator).toBe(OLD);
    expect(saveStore.importSave({ ...old, generator: GENERATOR_VERSION, check: 'c8' })).toBe(id);
    expect(saveStore.loadWorld(id)!.save).toMatchObject({ generator: GENERATOR_VERSION, check: 'c8' });
    expect(saveStore.originalOf(id)?.generator).toBe(OLD);
  });
});

describe('照原样打开旧世界:存档和修改', () => {
  it('改名照常存,存档还记建它的那一版', () => {
    const id = oldWorld();
    openFrozen(id);
    expect(saveStore.currentWorld()?.frozen).toBe(OLD);
    setName('region:c1', '甲');
    expect(saveStore.loadWorld(id)?.save.edits.names).toEqual({ 'region:c1': '甲' });
    expect(saveStore.loadWorld(id)?.save.generator).toBe(OLD);
    expect(saveStore.currentSave()?.generator).toBe(OLD);
  });

  it('现在这一版建的世界不算照原样打开', () => {
    const save = makeSave(PARAMS, EMPTY_EDITS, 'c7', '新世界');
    const id = saveStore.importSave(save)!;
    saveStore.attachWorld({ id, params: PARAMS, check: 'c7', kind: 'created', saved: EMPTY_EDITS, frozen: GENERATOR_VERSION });
    expect(saveStore.currentWorld()?.frozen).toBeUndefined();
  });

  it('改历史先问:干预、地形大事、推演年数都拦下,修改不变;改名、旗帜照常', () => {
    const id = oldWorld({ ...EMPTY_EDITS, interventions: [protect(1)] });
    openFrozen(id);
    gateLikeApp();
    const before = getEdits();
    expect(addIntervention(protect(2))).toBe(false);
    expect(addUpheaval(VOLCANO)).toBeNull();
    setEndYear(4000);
    expect(addEditsBatch([protect(3)], [])).toBeNull();
    // 撤销一条干预也要重推
    expect(commitEdits({ ...getEdits(), interventions: [] })).toBe(false);
    expect(getEdits()).toBe(before);
    expect(asked.length).toBe(5);
    expect(asked[0].interventions).toEqual([protect(1), protect(2)]);
    setName('region:c1', '甲');
    expect(getEdits().names).toEqual({ 'region:c1': '甲' });
    expect(asked.length).toBe(5);
    // 普通世界不拦
    saveStore.detachWorld();
    clearEdits();
    expect(addIntervention(protect(2))).toBe(true);
  });

  it('全部清除地形:地形和草图算一次修改,只问一次;拦下了两样都不动', () => {
    const sketch = { rest: 'auto' as const, strokes: [{ kind: 'land' as const, r: 20, pts: [100, 100, 140, 120] }] };
    const id = oldWorld({ ...EMPTY_EDITS, terrain: [{ kind: 'volcano', pts: [1278, 768], r: 36, s: 1.1 }], sketch });
    openFrozen(id);
    gateLikeApp();
    const before = getEdits();
    expect(clearTerrainAndSketch(true)).toBe(false);
    expect(getEdits()).toBe(before);
    expect(asked.length).toBe(1);
    expect(asked[0].terrain).toEqual([]);
    expect(asked[0].sketch).toBeUndefined();
  });

  it('撤销地形被拦下:撤销、重做的记录不动', async () => {
    const { undoTerrain, redoTerrain } = await import('../src/ui/TerrainTools');
    const op = { kind: 'volcano' as const, pts: [1278, 768], r: 36, s: 1.1 };
    const id = oldWorld({ ...EMPTY_EDITS, terrain: [op] });
    openFrozen(id);
    gateLikeApp();
    const before = getEdits();
    undoTerrain();
    expect(getEdits()).toBe(before);
    expect(asked.length).toBe(1);
    // 没撤成就没有可重做的
    redoTerrain();
    expect(getEdits()).toBe(before);
    expect(asked.length).toBe(1);
  });

  it('全部推演被拦下:待推演的单子留着(取消了还在)', () => {
    const id = oldWorld();
    openFrozen(id);
    gateLikeApp();
    queueIntervention(protect(1), '甲国:保护');
    queueIntervention(protect(2, 50), '乙国:保护');
    pushPending();
    expect(getPending().length).toBe(2);
    expect(getEdits().interventions).toEqual([]);
    expect(asked[0].interventions).toEqual([protect(1), protect(2, 50)]);
  });

  it('按新版另存一份:叫「…（新版）」、记现在的版本、带着要推演的修改;原来那份不动', () => {
    const id = oldWorld({ ...EMPTY_EDITS, interventions: [protect(1)], names: { 'region:c1': '甲' } });
    const orig = saveStore.loadWorld(id)!.save;
    openFrozen(id);
    const next: WorldEdits = { ...getEdits(), interventions: [protect(1), protect(2)] };
    const nid = saveStore.saveAsNewVersion(id, next)!;
    expect(nid).not.toBe(id);
    const copy = saveStore.loadWorld(nid)!.save;
    expect(copy.title).toBe('青岚纪（新版）');
    expect(copy.generator).toBe(GENERATOR_VERSION);
    expect(copy.edits).toEqual(next);
    expect(copy.params).toEqual(orig.params);
    // 地形校验留空:新版生成出来的地形可能不一样,不提示对不上
    expect(copy.check).toBe('');
    expect(saveStore.loadWorld(id)!.save).toEqual(orig);
    // 再另存一次:重名就编号
    const again = saveStore.saveAsNewVersion(id, next)!;
    expect(saveStore.loadWorld(again)!.save.title).not.toBe('青岚纪（新版）');
    expect(saveStore.loadWorld(again)!.save.title).toContain('青岚纪（新版）');
  });
});

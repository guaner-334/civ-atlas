import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as saveStore from '../src/ui/saveStore';
import { clearEdits, getEdits, setEdits } from '../src/ui/editsStore';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { EMPTY_EDITS, GENERATOR_VERSION, type WorldEdits } from '../src/gen/edits';
import { makeSave } from '../src/gen/savefile';
import { SNAPSHOT_FORMAT, makePart, recipeKey, recipeOfSave, type Snapshot } from '../src/gen/snapshot';
import { KEEP_PER_WORLD, _setResultBackend, clearResults, copyResults, dropOrphans, keepPending, loadResult, memoryResults, offerSnapshot, resultHeads } from '../src/ui/resultStore';

/** 假的 localStorage */
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
let stopAuto: (() => void) | null = null;
let mem = memoryResults();

/** 模拟 App 打开一个建好的世界(存着的就套存着的修改) */
function openWorld(id: string, edits: WorldEdits = EMPTY_EDITS, kind: saveStore.WorldKind = 'created') {
  saveStore.detachWorld();
  clearEdits();
  const stored = saveStore.loadWorld(id);
  const e = stored?.save.edits ?? edits;
  setEdits(e);
  saveStore.attachWorld({ id, params: { ...DEFAULT_PARAMS, seed: 7 }, check: 'c7', kind, saved: stored?.save.edits ?? e });
}

/** 这个世界现在这样的原件(内容随便,配方是真的) */
async function snapshotOf(edits: WorldEdits, generator = GENERATOR_VERSION, tag = 'a'): Promise<Snapshot> {
  const recipe = await recipeKey(recipeOfSave(makeSave({ ...DEFAULT_PARAMS, seed: 7 }, edits, 'c7')));
  return { format: SNAPSHOT_FORMAT, generator, recipe, formation: false, parts: [await makePart('map', { tag }), await makePart('civ', { tag, n: new Int32Array([1, 2, 3]) })] };
}

describe('原件存进浏览器(resultStore)', () => {
  beforeEach(() => {
    g.localStorage = new FakeStorage();
    saveStore._resetForTest();
    clearEdits();
    stopAuto = saveStore.startAutoSave();
    mem = memoryResults();
    _setResultBackend(mem);
  });
  afterEach(() => {
    stopAuto?.();
    delete g.localStorage;
    saveStore._resetForTest();
    clearEdits();
    _setResultBackend(undefined);
  });

  it('存档存着、配方对得上才存;同一份不重写;改名不影响', async () => {
    const id = saveStore.newWorldId();
    // 打开的链接(还没存进浏览器):先放着
    openWorld(id, EMPTY_EDITS, 'visit');
    const s = await snapshotOf(EMPTY_EDITS);
    expect(await offerSnapshot(s)).toBe(false);
    expect(mem.records.size).toBe(0);
    // 改了名字:存进"我的世界",这份原件也跟着存下(改名不改配方)
    setEdits({ ...getEdits(), names: { 'region:c1': '甲' } });
    expect(saveStore.loadWorld(id)).not.toBeNull();
    await keepPending();
    expect(mem.records.size).toBe(1);
    const r = await loadResult(id, GENERATOR_VERSION);
    expect(r?.snapshot.recipe).toBe(s.recipe);
    // 同一份再交一次:不重写
    expect(await offerSnapshot(s)).toBe(false);
    expect((await resultHeads(id)).length).toBe(1);
  });

  it('改了干预还没推完(配方对不上)不存;推完的那份来了才存', async () => {
    const id = saveStore.newWorldId();
    openWorld(id);
    saveStore.markCreated();
    const old = await snapshotOf(EMPTY_EDITS);
    await offerSnapshot(old);
    const edits: WorldEdits = { ...getEdits(), interventions: [{ kind: 'halt', a: 'polity:c1#0', from: 100 }] };
    setEdits(edits);
    // 存档已经是新的干预,手上还是旧的原件:不存
    expect(await offerSnapshot(old)).toBe(false);
    const fresh = await snapshotOf(edits, GENERATOR_VERSION, 'b');
    expect(await offerSnapshot(fresh)).toBe(true);
    expect((await loadResult(id, GENERATOR_VERSION))?.snapshot.recipe).toBe(fresh.recipe);
  });

  it('新建中的世界、旧版本存的存档不存', async () => {
    const id = saveStore.newWorldId();
    openWorld(id, { ...EMPTY_EDITS, names: { 'region:c1': '甲' } }, 'draft');
    expect(await offerSnapshot(await snapshotOf(getEdits()))).toBe(false);
    // 旧版本存的世界(还没在新版里重存过)
    expect(saveStore.importSave({ ...makeSave({ ...DEFAULT_PARAMS, seed: 7 }, EMPTY_EDITS, 'c7'), generator: GENERATOR_VERSION - 1 })).not.toBeNull();
    const imported = saveStore.listWorlds().find((w) => w.save.generator === GENERATOR_VERSION - 1)!;
    openWorld(imported.id);
    expect(await offerSnapshot(await snapshotOf(EMPTY_EDITS))).toBe(false);
    expect(mem.records.size).toBe(0);
  });

  it('不同版本的各留各的,多了丢中间的;复制跟着复制;没有的世界、退出登录时删掉', async () => {
    const id = saveStore.newWorldId();
    openWorld(id);
    saveStore.markCreated();
    const r = (await snapshotOf(EMPTY_EDITS)) as Snapshot;
    // 假装以前几个版本也存过
    for (const gen of [GENERATOR_VERSION - 3, GENERATOR_VERSION - 2, GENERATOR_VERSION - 1]) {
      await mem.put({ id, generator: gen, app: 'x', at: '', snapshot: { ...r, generator: gen } }, { id, generator: gen, recipe: r.recipe, sums: String(gen), size: 1, at: '' });
    }
    expect(await offerSnapshot(r)).toBe(true);
    const gens = (await resultHeads(id)).map((h) => h.generator);
    expect(gens.length).toBe(KEEP_PER_WORLD);
    expect(gens[0]).toBe(GENERATOR_VERSION - 3);
    expect(gens.at(-1)).toBe(GENERATOR_VERSION);

    const copy = saveStore.duplicateWorld(id)!;
    await copyResults(id, copy);
    expect((await resultHeads(copy)).map((h) => h.generator)).toEqual(gens);

    // 删掉的世界:看一遍时删
    saveStore.deleteWorld(copy);
    await dropOrphans();
    expect(await resultHeads(copy)).toEqual([]);
    expect((await resultHeads(id)).length).toBe(KEEP_PER_WORLD);

    await clearResults();
    expect(mem.records.size).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as saveStore from '../src/ui/saveStore';
import { clearEdits, getEdits, setEdits } from '../src/ui/editsStore';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { EMPTY_EDITS, GENERATOR_VERSION, type WorldEdits } from '../src/gen/edits';
import { makeSave } from '../src/gen/savefile';
import { SNAPSHOT_FORMAT, makePart, recipeKey, recipeOfSave, type Snapshot } from '../src/gen/snapshot';
import { _setResultBackend, clearResults, copyResults, dropOrphans, keepPending, loadResult, memoryResults, offerSnapshot, resultHeads } from '../src/ui/resultStore';
import { setMapNow, usesMaps } from '../src/ui/world/mapNow';
import { setSimNow, simsOf } from '../src/ui/world/simNow';

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
    setSimNow(null);
    setMapNow(null);
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

  it('等着写的工夫存档又改了:这份不写', async () => {
    const id = saveStore.newWorldId();
    openWorld(id);
    saveStore.markCreated();
    const s = await snapshotOf(getEdits());
    // 查存过哪些的时候,存档改了(推演年数)
    _setResultBackend({
      ...mem,
      heads: async () => {
        setEdits({ ...getEdits(), endYear: 5000 });
        return mem.heads();
      },
    });
    expect(await offerSnapshot(s)).toBe(false);
    expect(mem.records.size).toBe(0);
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

  it('交来时说不算这个世界的(用了推演插件、本机对不上时不带插件推的):不存,也不留着等存档变了再存', async () => {
    const id = saveStore.newWorldId();
    openWorld(id, { ...EMPTY_EDITS, names: { 'region:c1': '甲' } });
    expect(saveStore.loadWorld(id)).not.toBeNull();
    const s = await snapshotOf(getEdits());
    let usable = false;
    expect(await offerSnapshot(s, (w) => w === id && usable)).toBe(false);
    usable = true;
    expect(await keepPending()).toBe(false);
    expect(mem.records.size).toBe(0);
    expect(await offerSnapshot(s, (w) => w === id && usable)).toBe(true);
    expect(mem.records.size).toBe(1);
  });

  it('用了推演、地图插件的世界不存:新建时选插件之前不带插件长的那份、带着推演插件推的那份都不存;没用插件的照存', async () => {
    // 和页面交原件时说的一样(带着推演插件推的、存的时候世界用着推演或地图插件的不算)
    const pageOk = (plugged: boolean) => (w: string) => !plugged && simsOf(w) === undefined && !usesMaps(w);
    const weary = { id: 'weariness', version: '1.0.0', sum: 'e'.repeat(64), role: 'sim', name: '厌战' };
    const craters = { id: 'craters', version: '1.0.0', sum: 'c'.repeat(64), role: 'map', name: '环形山' };
    for (const use of ['sim', 'map'] as const) {
      const id = saveStore.newWorldId();
      openWorld(id, EMPTY_EDITS, 'draft');
      // 选插件之前不带插件长的那份:新建中先放着
      expect(await offerSnapshot(await snapshotOf(getEdits()), pageOk(false))).toBe(false);
      if (use === 'sim') setSimNow({ id, list: [weary], files: [], checks: [] });
      else setMapNow({ id, list: [craters], files: [{ id: craters.id, sum: craters.sum }], ready: true, checks: [] });
      // 建好:配方不记插件,和手上那份对得上,也不存
      expect(saveStore.markCreated()).toBe(true);
      expect(await keepPending()).toBe(false);
      expect(await offerSnapshot(await snapshotOf(getEdits(), GENERATOR_VERSION, 'b'), pageOk(use === 'sim'))).toBe(false);
      expect(await resultHeads(id)).toEqual([]);
      setSimNow(null);
      setMapNow(null);
    }
    const id = saveStore.newWorldId();
    openWorld(id, EMPTY_EDITS, 'draft');
    // 带着推演插件推的:建好以后插件又去掉了也不存
    expect(await offerSnapshot(await snapshotOf(getEdits()), pageOk(true))).toBe(false);
    expect(saveStore.markCreated()).toBe(true);
    expect(await keepPending()).toBe(false);
    expect(mem.records.size).toBe(0);
    expect(await offerSnapshot(await snapshotOf(getEdits(), GENERATOR_VERSION, 'c'), pageOk(false))).toBe(true);
    expect(mem.records.size).toBe(1);
  });

  it('不同版本的各留各的,不淘汰;复制跟着复制;删掉的世界、退出登录时删掉', async () => {
    const id = saveStore.newWorldId();
    openWorld(id);
    saveStore.markCreated();
    const r = (await snapshotOf(EMPTY_EDITS)) as Snapshot;
    // 假装以前几个版本也存过
    const old = [GENERATOR_VERSION - 5, GENERATOR_VERSION - 4, GENERATOR_VERSION - 3, GENERATOR_VERSION - 2, GENERATOR_VERSION - 1];
    for (const gen of old) {
      await mem.put({ id, generator: gen, app: 'x', at: '', snapshot: { ...r, generator: gen } }, { id, generator: gen, recipe: r.recipe, sums: String(gen), size: 1, at: '' });
    }
    expect(await offerSnapshot(r)).toBe(true);
    const gens = (await resultHeads(id)).map((h) => h.generator);
    expect(gens).toEqual([...old, GENERATOR_VERSION]);

    const copy = saveStore.duplicateWorld(id)!;
    await copyResults(id, copy);
    expect((await resultHeads(copy)).map((h) => h.generator)).toEqual(gens);

    // 删掉的世界:看一遍时删
    saveStore.deleteWorld(copy);
    await dropOrphans();
    expect(await resultHeads(copy)).toEqual([]);
    expect((await resultHeads(id)).length).toBe(gens.length);

    await clearResults();
    expect(mem.records.size).toBe(0);
  });

  it('撤销了删除的世界,原件不删', async () => {
    const id = saveStore.newWorldId();
    openWorld(id);
    saveStore.markCreated();
    expect(await offerSnapshot(await snapshotOf(EMPTY_EDITS))).toBe(true);
    const gone = saveStore.deleteWorld(id)!;
    saveStore.restoreWorld(gone);
    await dropOrphans();
    expect((await resultHeads(id)).length).toBe(1);
  });

  it('不是用的人删的不清:列表没了(浏览器清了 localStorage)、老编号的世界,原件都留着', async () => {
    const id = saveStore.newWorldId();
    openWorld(id);
    saveStore.markCreated();
    expect(await offerSnapshot(await snapshotOf(EMPTY_EDITS))).toBe(true);
    saveStore.detachWorld();
    g.localStorage = new FakeStorage();
    saveStore._resetForTest();
    expect(saveStore.persistent()).toBe(true);
    expect(saveStore.storedIds()).toEqual([]);
    await dropOrphans();
    expect((await resultHeads(id)).length).toBe(1);
  });
});

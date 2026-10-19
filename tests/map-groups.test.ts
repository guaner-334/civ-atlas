/**
 * 「我的世界」的「地图」页签:按地图分组、只存了地图的那一份(新建中「保存地图」)、它跟着同步的标记。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { EMPTY_EDITS, newHistoryEdits, type TerrainOp, type WorldEdits } from '../src/gen/edits';
import { makeSave } from '../src/gen/savefile';
import * as saveStore from '../src/ui/saveStore';
import { clearEdits, seedTag, setCivSeed, setEdits } from '../src/ui/editsStore';
import { mapBriefOf, mapGroups, mapKeyOf, mapLine, mapMates, mapName } from '../src/ui/mapGroups';
import { bundleText, importBundle, parseBundle } from '../src/ui/bundle';
import type { StoredWorld } from '../src/ui/saveStore';

const range: TerrainOp = { kind: 'range', pts: [1156, 380, 1215, 430, 1273, 483], r: 23, s: 1 };

function world(id: string, at: string, o: { edits?: WorldEdits; map?: boolean; draft?: boolean; title?: string; seed?: number } = {}): StoredWorld {
  const save = makeSave({ ...DEFAULT_PARAMS, seed: o.seed ?? 7 }, o.edits ?? EMPTY_EDITS, 'c', o.title);
  return { id, save, count: 0, thumb: `t-${id}`, draft: !!o.draft, at, map: !!o.map, mapThumb: o.map ? `m-${id}` : null };
}

describe('按地图分组', () => {
  const root = world('a', '2026-10-18T01:00:00Z', { title: '苍澜界' });
  const civ2 = world('b', '2026-10-18T03:00:00Z', { title: '苍澜界（二）', edits: newHistoryEdits(EMPTY_EDITS, { civSeed: 52817, from: 'a' }) });
  const onlyMap = world('m', '2026-10-18T02:00:00Z', { map: true, seed: 512 });
  const drafting = world('d', '2026-10-18T04:00:00Z', { draft: true, seed: 99 });
  const other = world('c', '2026-10-17T00:00:00Z', { title: '赤原', seed: 2024 });
  const list = [root, civ2, onlyMap, drafting, other];

  it('在哪张地图上:打造出来的记着最早那个世界;只存了地图的、建好的世界自己是一张;新建中还没定下的不算', () => {
    expect(mapKeyOf(root)).toBe('a');
    expect(mapKeyOf(civ2)).toBe('a');
    expect(mapKeyOf(onlyMap)).toBe('m');
    expect(mapKeyOf(drafting)).toBeNull();
    // 在一张地图上打造、还没推演完(新建中)的,照样在那张地图上
    expect(mapKeyOf(world('e', '2026-10-18T05:00:00Z', { draft: true, edits: newHistoryEdits(EMPTY_EDITS, { civSeed: 3, from: 'a' }) }))).toBe('a');
  });

  it('一组一张卡,最近动过的在前;组里的文明最近的在前;卡片上的两行字', () => {
    const gs = mapGroups(list);
    expect(gs.map((g) => g.key)).toEqual(['a', 'm', 'c']);
    const [cang, m512] = gs;
    expect(cang.civs.map((w) => w.id)).toEqual(['b', 'a']);
    expect(cang.head.id).toBe('a');
    expect(cang.at).toBe(civ2.at);
    expect(mapName(cang.head)).toBe('种子 7');
    expect(mapLine(cang)).toBe('2 个文明：苍澜界（二）、苍澜界');
    expect(mapLine(cang, true)).toBe('2 个文明');
    expect(m512.map?.id).toBe('m');
    expect(m512.civs).toEqual([]);
    expect(m512.thumb).toBe('m-m');
    expect(mapLine(m512)).toBe('还没有文明');
  });

  it('最早那个世界删掉了,打造出来的照旧在一组', () => {
    const gs = mapGroups([civ2, other]);
    expect(gs[0].key).toBe('a');
    expect(gs[0].head.id).toBe('b');
  });

  it('同一张地图上的文明(世界设定「地图」页、左栏「已有 N 个」)', () => {
    expect(mapMates(list, 'a', root.save.edits).map((w) => w.id)).toEqual(['b', 'a']);
    expect(mapMates(list, 'b', civ2.save.edits).map((w) => w.id)).toEqual(['b', 'a']);
    expect(mapMates(list, 'c', other.save.edits).map((w) => w.id)).toEqual(['c']);
  });

  it('地图的名字和简介', () => {
    expect(mapName(world('x', '', { edits: { ...EMPTY_EDITS, terrain: [range] } }))).toBe('种子 7（改过地形）');
    const side = `陆地 ${Math.round(DEFAULT_PARAMS.landFraction * 100)}%，${DEFAULT_PARAMS.plates} 个板块`;
    expect(mapBriefOf(DEFAULT_PARAMS, EMPTY_EDITS)).toBe(`${side}，地形没改过`);
    expect(mapBriefOf(DEFAULT_PARAMS, { terrain: [range, range] })).toBe(`${side}，地形改过 2 处`);
  });
});

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

describe('保存地图', () => {
  beforeEach(() => {
    g.localStorage = new FakeStorage();
    saveStore._resetForTest();
    clearEdits();
  });
  afterEach(() => {
    delete g.localStorage;
    saveStore._resetForTest();
    clearEdits();
  });

  it('新建中点「保存地图」:只留参数和地形,标成只有地图的一份,不再自动存;同步时带着这个标记', () => {
    const params = { ...DEFAULT_PARAMS, seed: 512 };
    const edits: WorldEdits = { names: { 'polity:1': '甲' }, interventions: [], terrain: [range], endYear: 6000, civSeed: 9 };
    setEdits(edits);
    saveStore.attachWorld({ id: 'wmtest0001', params, check: 'c512', kind: 'draft', saved: edits });
    expect(saveStore.listWorlds()[0]?.draft).toBe(true);

    expect(saveStore.saveCurrentAsMap()).toBe(true);
    expect(saveStore.currentWorld()).toBeNull();
    const [w] = saveStore.listWorlds();
    expect(w.map).toBe(true);
    expect(w.draft).toBe(false);
    expect(w.save.params.seed).toBe(512);
    expect(w.save.edits.terrain).toHaveLength(1);
    expect(w.save.edits.names).toEqual({});
    expect(w.save.edits.endYear).toBeUndefined();
    expect(w.save.edits.civSeed).toBeUndefined();
    expect(saveStore.rawWorld(w.id)?.meta).toEqual({ map: true });
    expect(mapGroups([w])[0].map?.id).toBe(w.id);

    // 之后的修改不算它的
    setEdits({ ...EMPTY_EDITS, names: { x: 'y' } });
    expect(saveStore.loadWorld(w.id)?.save.edits.names).toEqual({});
    // 建好的世界不能这样存
    expect(saveStore.saveCurrentAsMap()).toBe(false);
  });

  it('「保存地图」写到一半存不下:放回原来那份,还是没建完的', () => {
    const params = { ...DEFAULT_PARAMS, seed: 512 };
    const edits: WorldEdits = { ...EMPTY_EDITS, terrain: [range], endYear: 6000, civSeed: 9 };
    setEdits(edits);
    saveStore.attachWorld({ id: 'wmtest0005', params, check: 'c512', kind: 'draft', saved: edits, title: '雾海' });
    const fs = g.localStorage as FakeStorage;
    const set = fs.setItem.bind(fs);
    fs.setItem = (k: string, v: string) => {
      if (k.startsWith('wenming-ditu:meta:')) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      set(k, v);
    };
    expect(saveStore.saveCurrentAsMap()).toBe(false);
    fs.setItem = set;
    const w = saveStore.loadWorld('wmtest0005');
    expect(w?.draft).toBe(true);
    expect(w?.map).toBe(false);
    expect(w?.save.title).toBe('雾海');
    expect(w?.save.edits.civSeed).toBe(9);
  });

  it('打开一个存档文件:和只存了地图的那份一样也不当成同一个', () => {
    const params = { ...DEFAULT_PARAMS, seed: 512 };
    setEdits(EMPTY_EDITS);
    saveStore.attachWorld({ id: 'wmtest0006', params, check: 'c512', kind: 'draft', saved: EMPTY_EDITS });
    expect(saveStore.saveCurrentAsMap()).toBe(true);
    const id = saveStore.importSave(makeSave(params, EMPTY_EDITS, 'c512'));
    expect(id).not.toBe('wmtest0006');
    expect(saveStore.loadWorld('wmtest0006')?.map).toBe(true);
  });

  it('全部存成文件再放回来:只存了地图的那份还是只有地图', () => {
    const params = { ...DEFAULT_PARAMS, seed: 512 };
    setEdits(EMPTY_EDITS);
    saveStore.attachWorld({ id: 'wmtest0002', params, check: 'c512', kind: 'draft', saved: EMPTY_EDITS });
    // 再放一个同样参数、没改过的建好的世界:放回来时不能和地图那份当成同一个
    saveStore.importSave(makeSave(params, EMPTY_EDITS, 'c512'));
    expect(saveStore.saveCurrentAsMap()).toBe(true);
    const text = bundleText()!.text;
    g.localStorage = new FakeStorage();
    saveStore._resetForTest();
    const r = parseBundle(text);
    if (!r?.ok) throw new Error('读不出');
    expect(importBundle(r.bundle).added).toHaveLength(2);
    const back = saveStore.listWorlds();
    expect(back.filter((w) => w.map)).toHaveLength(1);
    expect(back.filter((w) => !w.map)).toHaveLength(1);
  });

  it('在别的世界的地图上打造:新建中就带着那个世界的底稿出处', () => {
    const origin = { by: '明月', title: '苍澜界', url: 'https://atlas.example.com/s/k7Qm2xPa' };
    const edits = newHistoryEdits(EMPTY_EDITS, { civSeed: 5, from: 'wmsrc00001' });
    setEdits(edits);
    saveStore.attachWorld({ id: 'wmtest0003', params: DEFAULT_PARAMS, check: 'c', kind: 'draft', saved: edits, origin });
    expect(saveStore.loadWorld('wmtest0003')?.save.origin).toEqual(origin);
    // 平常的新建不带
    clearEdits();
    saveStore.attachWorld({ id: 'wmtest0004', params: DEFAULT_PARAMS, check: 'c', kind: 'draft', saved: EMPTY_EDITS, origin });
    expect(saveStore.currentWorld()?.origin).toBeUndefined();
  });

  it('同步来的标记:只存了地图的、新建中的不会同时是两样', () => {
    expect(saveStore.cleanSyncMeta({ map: true })).toEqual({ map: true });
    expect(saveStore.cleanSyncMeta({ map: true, draft: true })).toEqual({ draft: true });
    expect(saveStore.cleanSyncMeta({ map: 'yes' })).toEqual({});
  });

  it('复制出去的文字抬头:有自己的文明种子写「文明种子」', () => {
    expect(seedTag(7)).toBe('种子 7');
    setCivSeed(52817);
    expect(seedTag(52817)).toBe('文明种子 52817');
  });
});

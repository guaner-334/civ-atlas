/**
 * 新建世界的预设(ui/presetStore.ts):存、同名替换、改名删除、上次用的、和预设比哪几样改过、简写;存的东西坏了也能读
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/world';

const KEY = 'wenming-ditu:presets';
let store: Record<string, string>;

async function fresh() {
  vi.resetModules();
  return import('../src/ui/presetStore');
}

beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  });
});

describe('预设', () => {
  it('存、同名替换、改名、删除;选中的跟着走', async () => {
    const m = await fresh();
    const p = { ...DEFAULT_PARAMS, seed: 5730, landFraction: 0.4, continents: 2 };
    const a = m.savePreset('两块完整大陆', p, false);
    expect(m.getPresets().chosen).toBe(a);
    expect(m.getPresets().list[0].seed).toBeUndefined();
    const b = m.savePreset('北半球大陆', { ...p, north: 0.8 }, true, 6000);
    expect(m.getPresets().list[1]).toMatchObject({ seed: 5730, endYear: 6000 });
    expect(m.savePreset('两块完整大陆', { ...p, continents: 3 }, false)).toBe(a);
    expect(m.getPresets().list.map((x) => x.params.continents)).toEqual([3, 2]);
    m.renamePreset(b, '北边');
    expect(m.choiceName(m.getPresets(), b)).toBe('北边');
    m.choosePreset(b);
    m.deletePreset(b);
    expect(m.getPresets().chosen).toBe('default');
    expect(JSON.parse(store[KEY]).list).toHaveLength(1);
  });

  it('上次用的;和预设比哪几样改过(存了种子的连种子比)', async () => {
    const m = await fresh();
    expect(m.choiceParams(m.getPresets(), 'last').params).toEqual(m.strip(DEFAULT_PARAMS));
    m.rememberLast({ ...DEFAULT_PARAMS, temperature: -8 }, undefined, '阿斯特拉');
    const s = m.getPresets();
    expect(s.last?.title).toBe('阿斯特拉');
    expect([...m.changedKeys(s, 'last', { ...DEFAULT_PARAMS, seed: 9 })]).toEqual(['temperature']);
    expect(m.sameAsChoice(s, 'last', { ...DEFAULT_PARAMS, seed: 9, temperature: -8 }, undefined)).toBe(true);
    const id = m.savePreset('带种子', { ...DEFAULT_PARAMS, seed: 42 }, true);
    expect(m.sameAsChoice(m.getPresets(), id, { ...DEFAULT_PARAMS, seed: 43 }, undefined)).toBe(false);
  });

  it('简写:种子、陆地、大陆块数、气候,再是大陆的其余几样', async () => {
    const m = await fresh();
    const q = m.strip({ ...DEFAULT_PARAMS, landFraction: 0.4, continents: 2, rugged: 0.6, temperature: -8 });
    expect(m.presetSummary({ params: q, seed: 48213 }, 9)).toBe('种子 48213，陆地 40%，2 块大陆，-8°C，破碎 0.60×');
    expect(m.presetSummary({ params: q }, 2)).toBe('陆地 40%，2 块大陆');
    expect(m.presetSummary({ params: m.strip(DEFAULT_PARAMS) }, 3)).toBe('');
  });

  it('存的东西坏了:跳过坏的条目、缺的参数按默认、超出范围的调回来、选中的不在了回到默认', async () => {
    store[KEY] = JSON.stringify({
      list: [{ id: 'a', name: '好的', params: { plates: 40, cells: 'x' } }, { name: '没有 id' }, null],
      last: null,
      chosen: 'gone',
    });
    const m = await fresh();
    const s = m.getPresets();
    expect(s.list).toHaveLength(1);
    expect(s.list[0].params).toEqual({ ...m.strip(DEFAULT_PARAMS), plates: 40 });
    expect(s.chosen).toBe('default');
    store[KEY] = JSON.stringify({ list: [{ id: 'x', name: '改坏的', params: { cells: 1e9, hardness: 0, plates: -5 } }] });
    expect((await fresh()).getPresets().list[0].params).toMatchObject({ cells: 200000, hardness: 0.3, plates: 2 });
    store[KEY] = '{坏了';
    expect((await fresh()).getPresets()).toEqual({ list: [], last: null, chosen: 'default' });
  });
});

describe('大陆块数的上限', () => {
  it('板块、陆地够多时 1–6 都能选;板块太少时少几块', async () => {
    const { continentCap } = await import('../src/gen/tectonics');
    expect(continentCap(30, 0.33)).toBeGreaterThanOrEqual(6);
    expect(continentCap(8, 0.33)).toBe(2);
    expect(continentCap(15, 0.12)).toBe(3);
  });
});

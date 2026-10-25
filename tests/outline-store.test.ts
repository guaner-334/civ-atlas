/**
 * 大纲的修改(src/ui/editsStore.ts 的 setOutlinePlots、OutlineEditor.tsx 的复制一条):满了不收,原来的一条不丢。
 * 照大纲推演前问的多认真地试(outlineStore.ts):几档各几版、自己填夹好、记住上次选的;推着的时候不问。
 * 进度的提示条(OutlineSide.tsx 的 outlineRunToast):在试第几版引法、已定下几条。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { OUTLINE_PLOTS_MAX, OUTLINE_TRIES_MAX, type Plot } from '../src/gen/edits';
import type { Civ } from '../src/gen/civ/types';
import { clearEdits, getEdits, setOutlinePlots } from '../src/ui/editsStore';
import { copyPlot } from '../src/ui/OutlineEditor';
import { askOutline, clampOwn, closeOutlineAsk, getOutlineUi, loadOutlineTries, saveOutlineTries, setOutlineRun, triesOf, type OutlineRun } from '../src/ui/outlineStore';
import { outlineRunToast } from '../src/ui/OutlineSide';

const story = (id: number): Plot => ({ id, kind: 'story', year: 1000 + id, text: `第 ${id} 条` });

afterEach(() => clearEdits());

describe('大纲最多几条', () => {
  it('满了再加、复制:不收,原来的一条不少', () => {
    const full = Array.from({ length: OUTLINE_PLOTS_MAX }, (_, i) => story(i + 1));
    expect(setOutlinePlots(full)).toBe(true);
    expect(getEdits().outline?.plots).toHaveLength(OUTLINE_PLOTS_MAX);
    // 插在最后一条前面
    const more = full.slice();
    more.splice(OUTLINE_PLOTS_MAX - 1, 0, story(OUTLINE_PLOTS_MAX + 1));
    expect(setOutlinePlots(more)).toBe(false);
    copyPlot(getEdits().outline!.plots, 0);
    const now = getEdits().outline!.plots;
    expect(now).toHaveLength(OUTLINE_PLOTS_MAX);
    expect(now[OUTLINE_PLOTS_MAX - 1].id).toBe(OUTLINE_PLOTS_MAX);
  });
  it('没满照常收', () => {
    expect(setOutlinePlots([story(1)])).toBe(true);
    copyPlot(getEdits().outline!.plots, 0);
    expect(getEdits().outline!.plots.map((p) => p.text)).toEqual(['第 1 条', '第 1 条']);
  });
});

describe('多认真地试', () => {
  const g = globalThis as { localStorage?: unknown };
  afterEach(() => {
    delete g.localStorage;
    setOutlineRun(null);
    closeOutlineAsk();
  });
  const fake = () => {
    const m = new Map<string, string>();
    g.localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    return m;
  };
  it('几档各几版;自己填取整、夹在 1…最多', () => {
    expect(triesOf({ tier: 'fast', own: 20 })).toBe(4);
    expect(triesOf({ tier: 'std', own: 20 })).toBe(12);
    expect(triesOf({ tier: 'fine', own: 20 })).toBe(30);
    expect(triesOf({ tier: 'own', own: 7.4 })).toBe(7);
    expect(clampOwn(0.2)).toBe(1);
    expect(clampOwn(1e6)).toBe(OUTLINE_TRIES_MAX);
    expect(clampOwn(Number(''))).toBe(20);
  });
  it('没记过 / 存不了:默认「标准」;记住上次选的;坏了的不认', () => {
    expect(loadOutlineTries()).toEqual({ tier: 'std', own: 20 });
    const m = fake();
    expect(loadOutlineTries()).toEqual({ tier: 'std', own: 20 });
    saveOutlineTries({ tier: 'own', own: 9 });
    expect(loadOutlineTries()).toEqual({ tier: 'own', own: 9 });
    m.set('wenming-ditu:outline-tries', JSON.stringify({ tier: 'huge', own: 500 }));
    expect(loadOutlineTries()).toEqual({ tier: 'std', own: OUTLINE_TRIES_MAX });
    m.set('wenming-ditu:outline-tries', '{');
    expect(loadOutlineTries()).toEqual({ tier: 'std', own: 20 });
  });
  it('点「照大纲推演」先问;推着的时候不问', () => {
    askOutline();
    expect(getOutlineUi().ask).toBe(true);
    closeOutlineAsk();
    setOutlineRun({ oid: 1, done: 0, total: 3, review: [], at: null, fix: null, trial: null });
    askOutline();
    expect(getOutlineUi().ask).toBe(false);
  });
  it('进度:在试第几版、已定下几条(手机上短些)', () => {
    const plots: Plot[] = [story(1), story(2), { id: 3, kind: 'war', year: 1200, a: 'polity:1', b: 'polity:2' }];
    const run: OutlineRun = { oid: 1, done: 2, total: 3, review: [], at: 3, fix: null, trial: { n: 7, of: 12 } };
    const o = { civ: {} as Civ, plots };
    const pc = outlineRunToast(run, o, undefined, () => {});
    expect(pc.text).toBe('照大纲推演：第 3 / 3 条，在试第 7 / 12 版');
    expect(pc.more).toEqual(['已定下 2 条；第 3 条没自然发生，试几种引法，挑最轻又成了的']);
    expect(pc.progress).toBeGreaterThan(2 / 3);
    expect(pc.progress).toBeLessThan(1);
    const ph = outlineRunToast(run, o, undefined, () => {}, true);
    expect(ph.text).toBe('照大纲推演：第 3 / 3 条，第 7 / 12 版');
    expect(ph.more).toEqual(['已定下 2 条']);
    // 一条还没定下:不写"已定下 0 条"
    expect(outlineRunToast({ ...run, done: 0, at: 1 }, o, undefined, () => {}).more).toEqual(['第 1 条没自然发生，试几种引法，挑最轻又成了的']);
    expect(outlineRunToast({ ...run, done: 0, at: 1 }, o, undefined, () => {}, true).more).toEqual([]);
    // 还没在试:和以前一样
    expect(outlineRunToast({ ...run, trial: null }, o, undefined, () => {}).text).toBe('照大纲推演：第 3 / 3 条');
  });
});

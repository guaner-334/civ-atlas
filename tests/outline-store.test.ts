/**
 * 大纲的修改(src/ui/editsStore.ts 的 setOutlinePlots、OutlineEditor.tsx 的复制一条):满了不收,原来的一条不丢。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { OUTLINE_PLOTS_MAX, type Plot } from '../src/gen/edits';
import { clearEdits, getEdits, setOutlinePlots } from '../src/ui/editsStore';
import { copyPlot } from '../src/ui/OutlineEditor';

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

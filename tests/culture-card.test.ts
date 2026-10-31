/**
 * 民族卡片(src/ui/CulturePanel.tsx)用的数和选中:大事只列和这一族有关的、自然兴起的补一条"出现";人口小柱图;
 * 选中民族时稳定键、地图上不圈不飞(侧栏、概览里点了另飞到人最多的州)、民族填色上别的族变淡;卡片里点大事时留在民族填色。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { cultureLabel, regionLabel } from '../src/gen/civ/story/display';
import { ownersAt } from '../src/gen/civ/timeline';
import { cultureKey } from '../src/gen/edits';
import { shade } from '../src/gen/civ/religion';
import { cultureEntries, cultureNow, cultureSpark } from '../src/ui/cultureInfo';
import { cultureFocus, mapTarget, selectionFocus, selectionKey } from '../src/ui/flyTo';
import { cultureFocusOf, faithFocusOf } from '../src/ui/faithSelection';
import { cultureRegion } from '../src/ui/searchIndex';
import { cultureFocusColors } from '../src/render/civ/faith';
import { civFillOf } from '../src/render/civ/show';
import { getCivHighlight, getCivShow, getCivTime, jumpYearOf, pickChronicleEntry, setCivShow } from '../src/ui/civView';

const world: World = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 });
const civ: Civ = generateCiv(world);

describe('卡片的数(cultureInfo.ts)', () => {
  const y = Math.floor(civ.endYear);

  it('大事:自然兴起的补一条"出现";迁徙只列这一族的;都按年份排好', () => {
    for (const cu of civ.cultures) {
      if (cu.unborn) continue;
      const list = cultureEntries(civ, cu.id);
      for (let i = 1; i < list.length; i++) expect(list[i].year).toBeGreaterThanOrEqual(list[i - 1].year);
      if (cu.parent === undefined) expect(list[0]).toMatchObject({ kind: 'found', year: cu.born, text: `${cultureLabel(cu)}兴起于${regionLabel(civ, cu.hearth)}` });
      else expect(list.some((e) => e.kind === 'diverge')).toBe(true);
      for (const e of list) if (e.kind === 'migrate') expect(e.text).toContain(cultureLabel(cu));
    }
  });

  it('小柱图:出现以后每一百年一根(最多 30 根,多了隔一根取一根),最后一根是这一年的人口', () => {
    const cu = civ.cultures.find((c) => !c.unborn && c.ended === undefined && c.born < 500)!;
    for (const at of [1500, y]) {
      const now = cultureNow(civ, cu.id, at);
      const bars = cultureSpark(civ, cu.id, at, now.pop);
      expect(bars[bars.length - 1]).toEqual({ year: at, pop: now.pop });
      expect(bars[0].year).toBeGreaterThanOrEqual(cu.born);
      expect(bars.length).toBeLessThanOrEqual(30);
      const step = at === 1500 ? 100 : bars[1].year - bars[0].year;
      expect(step % 100).toBe(0);
      for (let i = 1; i < bars.length - 1; i++) expect(bars[i].year - bars[i - 1].year).toBe(step);
    }
    expect(cultureSpark(civ, cu.id, cu.born - 1, 0)).toEqual([]);
  });
});

describe('选中一个民族', () => {
  const y = Math.floor(civ.endYear);
  const cu = civ.cultures.find((c) => !c.unborn && c.ended === undefined)!;

  it('稳定键是民族的;地图上不圈、选中时不飞;侧栏点了飞到这一年人最多的州', () => {
    const sel = { kind: 'culture', id: cu.id } as const;
    expect(selectionKey(civ, sel)).toBe(cultureKey(civ, cu.id));
    expect(mapTarget(civ, sel)).toBeNull();
    expect(selectionFocus(world, civ, sel, y)).toBeNull();
    const r = cultureRegion(civ, cu.id, y, ownersAt(civ, y));
    expect(ownersAt(civ, y).culture[r]).toBe(cu.id);
    expect(cultureFocus(world, civ, cu.id, y)).toEqual(selectionFocus(world, civ, { kind: 'region', id: r }, y));
  });

  it('民族填色上选中的族原色、别的往白里调;没选民族照旧', () => {
    expect(cultureFocusOf({ kind: 'culture', id: 3 })).toBe(3);
    expect(cultureFocusOf({ kind: 'faith', id: 3 })).toBeNull();
    expect(faithFocusOf({ kind: 'culture', id: 3 })).toBeNull();
    const colors = Uint8Array.from([200, 40, 40, 40, 200, 40, 40, 40, 200]);
    expect(cultureFocusColors(colors, null)).toBe(colors);
    const out = cultureFocusColors(colors, 1);
    expect([...out.subarray(3, 6)]).toEqual([40, 200, 40]);
    expect([...out.subarray(0, 3)]).toEqual(shade([200, 40, 40], 0.62));
    expect([...out.subarray(6, 9)]).toEqual(shade([40, 40, 200], 0.62));
    expect(cultureFocusColors(colors, 1)).toBe(out); // 缓存
    expect(cultureFocusColors(colors, 9)).toBe(colors); // 编号不在表里
  });
});

describe('卡片里点大事', () => {
  const cu = civ.cultures.find((c) => !c.unborn && cultureEntries(civ, c.id).some((e) => e.regions?.length))!;
  const ev = cultureEntries(civ, cu.id).find((e) => e.regions?.length)!;

  it('正在民族填色上:留在民族填色,时间轴照样跳到那年、事发地照样亮', () => {
    setCivShow({ polities: false, cultures: true, faiths: false, eras: false, control: false });
    pickChronicleEntry(ev, 'cultures');
    expect(civFillOf(getCivShow())).toBe('cultures');
    expect(getCivTime()).toMatchObject({ year: jumpYearOf(ev), playing: false });
    expect(getCivHighlight()?.regions).toEqual(ev.regions);
  });

  it('不在民族填色上、或从别的卡片点:照旧换成国家', () => {
    setCivShow({ polities: false, cultures: false, faiths: false, eras: false, control: false });
    pickChronicleEntry(ev, 'cultures');
    expect(civFillOf(getCivShow())).toBe('polities');
    setCivShow({ polities: false, cultures: true, faiths: false, eras: false, control: false });
    pickChronicleEntry(ev);
    expect(civFillOf(getCivShow())).toBe('polities');
    expect(getCivShow().cultures).toBe(false);
  });
});

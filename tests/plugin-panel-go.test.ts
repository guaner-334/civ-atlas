/** 插件面板上的链接、能点的行:点了网站带用的人过去(飞到国、城、州,翻到那一年);和插件有没有 view.control 无关 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import type { Civ } from '../src/gen/civ/types';
import { polityKey, regionKey, settlementKey } from '../src/gen/edits';
import { getCivHighlight, getCivTime, setCivHighlight, setCivTime } from '../src/ui/civView';
import { getDirectorFly } from '../src/ui/directorStore';
import { panelGo } from '../src/ui/plugins/tools/toolSteer';

let world: World;
let civ: Civ;
beforeAll(() => {
  world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 3000 });
  civ = generateCiv(world, { endYear: 800 });
});
beforeEach(() => {
  setCivHighlight(null);
  setCivTime({ year: 100, playing: false, scrubbing: false, story: false });
});

describe('面板链接点了带人过去', () => {
  it('指向国:飞过去并圈出', () => {
    const flown = getDirectorFly()?.stamp ?? 0;
    panelGo({ key: polityKey(civ, 0) }, world, civ);
    expect(getDirectorFly()?.stamp ?? 0).toBeGreaterThan(flown);
    expect(getCivHighlight()?.polities).toEqual([0]);
  });
  it('指向州:飞过去并圈出;指向城:只飞过去', () => {
    panelGo({ key: regionKey(civ, 5) }, world, civ);
    expect(getCivHighlight()?.regions).toEqual([5]);
    setCivHighlight(null);
    const flown = getDirectorFly()?.stamp ?? 0;
    panelGo({ key: settlementKey(civ, civ.settlements[0].id) }, world, civ);
    expect(getDirectorFly()?.stamp ?? 0).toBeGreaterThan(flown);
    expect(getCivHighlight()).toBeNull();
  });
  it('指向年份:翻过去,超出的收在最后一年;找不到的键不动', () => {
    panelGo({ year: 300 }, world, civ);
    expect(getCivTime().year).toBe(300);
    panelGo({ year: 99999 }, world, civ);
    expect(getCivTime().year).toBe(civ.endYear);
    const flown = getDirectorFly()?.stamp ?? 0;
    panelGo({ key: 'polity:nope' }, world, civ);
    expect(getDirectorFly()?.stamp ?? 0).toBe(flown);
  });
});

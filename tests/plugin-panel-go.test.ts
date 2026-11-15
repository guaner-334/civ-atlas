/** 插件面板上的链接、能点的行:点了网站带用的人过去(飞到国、城、州,翻到那一年);和插件有没有 view.control 无关 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import type { Civ } from '../src/gen/civ/types';
import { polityKey, regionKey, settlementKey } from '../src/gen/edits';
import { ownersAt } from '../src/gen/readers/openQuery';
import { highlightMarks } from '../src/render/civ/highlight';
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

function regionsOf(id: number, year: number): number[] {
  const own = ownersAt(civ, year).polity;
  const out: number[] = [];
  for (let r = 0; r < civ.regions.count; r++) if (own[r] === id) out.push(r);
  return out;
}

function litRegions(): number[] {
  const hl = getCivHighlight();
  if (!hl) return [];
  const marks = highlightMarks(civ, hl);
  const out: number[] = [];
  for (let r = 0; r < marks.length; r++) if (marks[r]) out.push(r);
  return out;
}

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
  it('时间轴停在最新一年(year 为 null)时点国链接:圈最后一年的国土,飞的落点和明确选最后一年一样', () => {
    const candidates = civ.polities.filter((x) => x.founded > 0 && regionsOf(x.id, civ.endYear).length > 0);
    const p = candidates.find((x) => regionsOf(x.id, x.founded).join(',') !== regionsOf(x.id, civ.endYear).join(',')) ?? candidates[0]!;
    expect(p).toBeDefined();
    const key = polityKey(civ, p.id);

    setCivTime({ year: civ.endYear, playing: false, scrubbing: false, story: false });
    panelGo({ key }, world, civ);
    const focusAtEnd = getDirectorFly()!.focus;
    const endTerritory = regionsOf(p.id, civ.endYear);
    expect(endTerritory).not.toEqual(regionsOf(p.id, p.founded));
    expect(litRegions()).toEqual(endTerritory);

    panelGo({ key: settlementKey(civ, civ.settlements[0].id) }, world, civ);
    setCivHighlight(null);
    setCivTime({ year: null, playing: false, scrubbing: false, story: false });
    const flown = getDirectorFly()?.stamp ?? 0;
    panelGo({ key }, world, civ);
    expect(getCivTime().year).toBeNull();
    expect(getDirectorFly()?.stamp ?? 0).toBeGreaterThan(flown);
    expect(getDirectorFly()!.focus).toEqual(focusAtEnd);
    expect(getCivHighlight()).toMatchObject({ polities: [p.id], regions: [], year: civ.endYear });
    expect(litRegions()).toEqual(endTerritory);
  });
  it('停在某一年、点那年还没立的国:飞过去、不圈国土,不报错', () => {
    const p = civ.polities.find((x) => x.founded >= 20 && regionsOf(x.id, x.founded).length > 0)!;
    expect(p).toBeDefined();
    const before = Math.floor(p.founded / 2);
    setCivTime({ year: before, playing: false, scrubbing: false, story: false });
    const flown = getDirectorFly()?.stamp ?? 0;
    expect(() => panelGo({ key: polityKey(civ, p.id) }, world, civ)).not.toThrow();
    expect(getDirectorFly()?.stamp ?? 0).toBeGreaterThan(flown);
    expect(getCivHighlight()?.year).toBe(before);
    expect(litRegions()).toEqual([]);
  });
});

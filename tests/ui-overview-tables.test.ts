/**
 * 世界概览的"国家"表、"民族"表(src/ui/WorldOverviewCountries.tsx、WorldOverviewCultures.tsx):
 * 国家的人口、国教、时代、外交和国家卡片同一个算法;已亡的取亡国前一年;
 * 民族表现存 / 已消亡分得对,消亡前一年那一族还在;人口的写法。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { capitalAt, regionPopulationAt } from '../src/gen/civ/growth';
import { ownersAt } from '../src/gen/civ/timeline';
import { polityTies } from '../src/gen/civ/diplomacy';
import { stateFaithAt } from '../src/gen/civ/religion';
import { countryRows, lastAliveYear, popCell } from '../src/ui/WorldOverviewCountries';
import { cultureAlive, cultureLastYear, cultureRows } from '../src/ui/WorldOverviewCultures';
import { neighborsAt } from '../src/ui/Interventions';

const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }))));
  return c;
}

/** 一国 y 年境内各州的总人口(国家卡片的算法) */
function polityPop(civ: Civ, id: number, y: number): number {
  const own = ownersAt(civ, y);
  let pop = 0;
  for (let r = 0; r < civ.regions.count; r++) if (own.polity[r] === id) pop += regionPopulationAt(civ, r, y);
  return pop;
}

describe.each([7, 2024])('国家表 · seed=%i', (seed) => {
  it('现存的:人口、国教、外交、邻国和国家卡片一样;按州数排', () => {
    const civ = civOf(seed);
    const y = Math.floor(civ.endYear);
    const { alive } = countryRows(civ, y);
    expect(alive.length).toBeGreaterThan(3);
    for (let i = 1; i < alive.length; i++) expect(alive[i - 1].regions).toBeGreaterThanOrEqual(alive[i].regions);
    for (const r of alive) {
      expect(r.at).toBe(y);
      expect(r.pop).toBeCloseTo(polityPop(civ, r.p.id, y), 6);
      expect(r.faith).toEqual(stateFaithAt(civ.religion, r.p.id, y));
      expect(r.ties).toEqual(polityTies(civ, r.p.id, y));
      expect(new Set(r.near)).toEqual(neighborsAt(civ, r.p.id, y).near);
      expect(popCell(r.pop)).toMatch(/^\d+(\.\d)? 万$|^\d+ 人$/);
    }
    // 至少有一国写得出时代(有发明数据)
    expect(alive.some((r) => r.era && r.era.era >= 0 && r.era.progress >= 0 && r.era.progress <= 1)).toBe(true);
  });

  it('已亡的:取亡国前一年的国都、人口、国教;先给前几个,一共几个照数;亡于谁和史事对得上', () => {
    const civ = civOf(seed);
    const y = Math.floor(civ.endYear);
    const few = countryRows(civ, y, 5);
    const all = countryRows(civ, y);
    const ended = civ.polities.filter((p) => p.ended !== undefined && p.ended <= y && p.founded <= y).length;
    expect(few.dead.length).toBe(Math.min(5, ended));
    expect(few.deadTotal).toBe(ended);
    expect(all.dead.length).toBe(ended);
    expect(all.dead.slice(0, 5).map((r) => r.p.id)).toEqual(few.dead.map((r) => r.p.id));
    for (const r of all.dead) {
      const at = lastAliveYear(r.p, y);
      expect(r.at).toBe(at);
      expect(r.regions).toBe(0);
      expect(r.ties).toBe(null);
      expect(r.capital).toBe(civ.settlements[capitalAt(r.p, at)]?.name || '—');
      expect(r.pop).toBeCloseTo(polityPop(civ, r.p.id, at), 6);
      expect(r.faith).toEqual(stateFaithAt(civ.religion, r.p.id, at));
      if (r.end) {
        const hit = civ.annals.find((a) => (a.kind === 'fall' && a.a === r.p.id) || (a.kind === 'merge' && a.b === r.p.id));
        expect(hit?.kind).toBe(r.end.how);
      }
    }
    // 亡国前一年它还占着州
    expect(all.dead.filter((r) => r.pop > 0).length).toBeGreaterThan(all.dead.length / 2);
  });
});

describe.each([7, 2024])('民族表 · seed=%i', (seed) => {
  it('现存的和概览头部"N 个民族"一样多,州数加起来是有人住的州;已消亡的消亡前一年还在', () => {
    const civ = civOf(seed);
    for (const y of [Math.floor(civ.endYear), Math.floor(civ.endYear / 2)]) {
      const { alive, dead } = cultureRows(civ, y);
      const n = civ.cultures.filter((cu) => cu.born <= y && (cu.ended === undefined || cu.ended > y)).length;
      expect(alive.length).toBe(n);
      expect(alive.every((r) => cultureAlive(r.cu, y))).toBe(true);
      for (let i = 1; i < alive.length; i++) expect(alive[i - 1].regions).toBeGreaterThanOrEqual(alive[i].regions);
      const own = ownersAt(civ, y);
      let settled = 0;
      for (let r = 0; r < civ.regions.count; r++) if (own.culture[r] >= 0) settled++;
      expect(alive.reduce((s, r) => s + r.regions, 0)).toBe(settled);
      for (const r of alive) {
        const inStates = r.polities.reduce((s, [, k]) => s + k, 0);
        expect(inStates).toBeLessThanOrEqual(r.regions);
        for (let i = 1; i < r.polities.length; i++) expect(r.polities[i - 1][1]).toBeGreaterThanOrEqual(r.polities[i][1]);
      }
      for (const r of dead) {
        expect(r.cu.unborn).toBeUndefined();
        expect(r.cu.ended).toBeLessThanOrEqual(y);
        expect(r.at).toBe(cultureLastYear(r.cu, y));
        const last = ownersAt(civ, r.at);
        let k = 0;
        for (let q = 0; q < civ.regions.count; q++) if (last.culture[q] === r.cu.id) k++;
        expect(k).toBeGreaterThan(0);
      }
      // 没出现的不列
      expect([...alive, ...dead].every((r) => r.cu.born <= y)).toBe(true);
    }
  });
});

describe('人口的写法', () => {
  it('表格里不带"约",万以下写人', () => {
    expect(popCell(56420)).toBe('5642 万');
    expect(popCell(94)).toBe('9.4 万');
    expect(popCell(9)).toBe('9000 人');
    expect(popCell(0)).toBe('—');
  });
});

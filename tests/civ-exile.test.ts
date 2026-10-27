/**
 * 亡国之君出奔邻国(gen/civ/exile.ts):亡于战争、末代之君的下场是出奔的,记下他去了哪国 ——
 * 去的国家那时还在、不是灭他的国家;人物的下场照旧是出奔,Person.exile 记着去的国家和缘由;编年史写"某国亡,某王某某出奔某国";
 * 去处够常见;亡国之前停下、接着推,和一口气推完一样。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { buildChronicle } from '../src/gen/civ/chronicle';
import { polityAlive, polityName } from '../src/gen/civ/growth';
import { EXILE_TIES } from '../src/gen/civ/types';
import { packValue, unpackValue } from '../src/gen/snapshot';

const SEEDS = [1, 2, 3];
const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};
const civs = new Map<number, Civ>();
const civOf = (seed: number) => {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(world(seed))));
  return c;
};
/** 出奔邻国的史事(下标) */
const abroadOf = (civ: Civ) => civ.annals.flatMap((e, i) => (e.kind === 'exile' && e.cause === 'fled' && e.war < 0 ? [i] : []));

describe('亡国之君出奔邻国', () => {
  it.each(SEEDS)('seed %i:去的国家那时还在、不是灭他的国家;人物的下场是出奔,记着去的国家和缘由', (seed) => {
    const civ = civOf(seed);
    const people = civ.people ?? [];
    for (const i of abroadOf(civ)) {
      const e = civ.annals[i];
      const fall = civ.annals.find((a) => a.kind === 'fall' && a.a === e.a)!;
      expect(fall.year).toBe(e.year);
      expect(fall.b).toBeGreaterThanOrEqual(0);
      expect(e.b, `第 ${e.year} 年`).toBeGreaterThanOrEqual(0);
      expect(e.b).not.toBe(fall.b);
      expect(e.b).not.toBe(e.a);
      expect(polityAlive(civ.polities[e.b], e.year)).toBe(true);
      expect(EXILE_TIES[e.n ?? -1]).toBeDefined();
      const x = people.find((p) => p.exile?.annal === i);
      expect(x, `第 ${e.year} 年 ${polityName(civ.polities[e.a], e.year - 1)}`).toBeTruthy();
      expect(x!.role).toBe('ruler');
      expect(x!.polity).toBe(e.a);
      expect(x!.fate).toBe('fled');
      expect(x!.until).toBe(e.year);
      expect(x!.exile).toMatchObject({ how: 'fled', zone: -1, to: e.b, tie: EXILE_TIES[e.n!], year: e.year, region: e.region });
      expect(x!.exile!.until).toBeUndefined();
    }
    // 人物里记着去的国家的,都有那一条史事
    for (const x of people) if (x.exile?.to !== undefined) expect(abroadOf(civ)).toContain(x.exile.annal);
  }, 120_000);

  it('够常见:每个种子都有好几回,亡于战争、出奔的末代之君多半有了去处;缘由不止一种', () => {
    // GENERATOR_VERSION 44 的 20 个种子:每个世界 5–27 回(平均 17),出奔的末代之君 45%–96% 有了去处(合计 78%)
    const ties = new Set<string>();
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      const list = abroadOf(civ);
      const fallen = new Set(civ.annals.filter((a) => a.kind === 'fall' && a.b >= 0 && a.war >= 0).map((a) => a.a));
      const fled = (civ.people ?? []).filter((x) => x.role === 'ruler' && x.fate === 'fled' && fallen.has(x.polity) && x.until === civ.polities[x.polity].ended);
      expect(list.length, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      expect(list.length / fled.length, `seed ${seed}`).toBeGreaterThanOrEqual(0.4);
      for (const i of list) ties.add(EXILE_TIES[civ.annals[i].n!]);
    }
    expect(ties.size).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it.each(SEEDS)('seed %i:编年史写"某国亡,某王某某出奔某国",那国也算这一条有关的国家', (seed) => {
    const civ = civOf(seed);
    const list = abroadOf(civ);
    const entries = buildChronicle(civ).filter((c) => c.kind === 'exile' && list.includes(c.id));
    expect(entries.length).toBe(list.length);
    for (const c of entries) {
      const e = civ.annals[c.id];
      expect(c.text, c.text).not.toMatch(/undefined|NaN|某国|null/);
      expect(c.text).toMatch(/亡,.+出奔/);
      expect(c.text.endsWith(polityName(civ.polities[e.b], e.year))).toBe(true);
      expect(c.tag).toBe('奔');
      expect(c.polities).toEqual([e.a, e.b]);
    }
  }, 120_000);

  it('亡国那一仗打到一半停下、存档读回、接着推到第 3000 年:和一口气推完逐项一样', () => {
    const seed = 1;
    const w = world(seed);
    const whole = civOf(seed);
    // 挑一回出奔邻国:亡国的那场仗打了一年以上,在仗的中间停下
    const i = abroadOf(whole).find((k) => {
      const fall = whole.annals.find((a) => a.kind === 'fall' && a.a === whole.annals[k].a)!;
      const war = whole.annals.find((a) => a.kind === 'war' && a.war === fall.war);
      return !!war && fall.year - war.year >= 2;
    })!;
    expect(i).toBeDefined();
    const e = whole.annals[i];
    const fall = whole.annals.find((a) => a.kind === 'fall' && a.a === e.a)!;
    const start = whole.annals.find((a) => a.kind === 'war' && a.war === fall.war)!.year;
    const cut = Math.floor((start + e.year) / 2);
    expect(cut).toBeGreaterThan(start);
    expect(cut).toBeLessThan(e.year);
    const mid = generateCiv(w, { endYear: cut });
    const saved = unpackValue(packValue(mid)) as Civ;
    const cont = continueCiv(w, saved, { endYear: 3000 });
    for (const k of ['annals', 'log', 'polity', 'people'] as const) expect(cont[k], k).toEqual(whole[k]);
  }, 240_000);
});

/**
 * 民族的文化特质(src/gen/civ/cultureTraits.ts):读哪一段历史(时间轴那一年往前三百年)、每个特质的门槛(用造出来的数逐条试)、
 * 最多三条按显著程度排;在真世界里读出来的说得通、只描述不改历史(读几遍一样,历史不动)。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { TRAIT_MAX, TRAIT_RULES, TRAIT_SPAN, cultureFacts, cultureTraits, readTraits, tenths, traitWindow, type CultureFacts, type TraitKey } from '../src/gen/civ/cultureTraits';

/** 什么都够不上的一族:20 州,别的数都是 0 */
function facts(over: Partial<CultureFacts> = {}): CultureFacts {
  return {
    kind: 'farm',
    regions: 20,
    conquests: 0,
    conquestsAvg: 4,
    wars: 0,
    ports: 0,
    market: 0.1,
    marketAvg: 0.1,
    infoRank: 10,
    infoOf: 14,
    great: 0,
    holy: '',
    sect: null,
    steppe: 0,
    falls: 0,
    migrations: 0,
    flights: 0,
    foreign: 0,
    ...over,
  };
}
const keys = (f: CultureFacts) => readTraits(f).map((t) => t.key);
const has = (f: CultureFacts, k: TraitKey) => keys(f).includes(k);

describe('读哪一段历史', () => {
  it('往前三百年;出现得晚的从出现那年起;已消亡的读到消亡前一年;还没出现、没能兴起的不读', () => {
    expect(TRAIT_SPAN).toBe(300);
    expect(traitWindow({ born: 271.4 }, 2252)).toEqual({ from: 1952, to: 2252 });
    expect(traitWindow({ born: 271.4 }, 2252.7)).toEqual({ from: 1952, to: 2252 });
    expect(traitWindow({ born: 2066.3 }, 2252)).toEqual({ from: 2066, to: 2252 });
    expect(traitWindow({ born: 80 }, 200)).toEqual({ from: 80, to: 200 });
    expect(traitWindow({ born: 271, ended: 2899.5 }, 2950)).toEqual({ from: 2599, to: 2899 });
    // 消亡那一年以前照常往前三百年
    expect(traitWindow({ born: 271, ended: 2899.5 }, 2800)).toEqual({ from: 2500, to: 2800 });
    expect(traitWindow({ born: 300 }, 299)).toBeNull();
    expect(traitWindow({ born: 300, unborn: true }, 2000)).toBeNull();
  });
});

describe('门槛(造出来的数)', () => {
  it('什么都够不上:一条也没有;一州也没有了:一条也没有', () => {
    expect(readTraits(facts())).toEqual([]);
    expect(readTraits(facts({ regions: 0, kind: 'nomad', conquests: 99 }))).toEqual([]);
  });

  it('尚武:打下的州 ≥ 各族平均 × 1.5,而且至少 5 州', () => {
    const { ratio, min } = TRAIT_RULES.martial;
    expect(has(facts({ conquests: 6, conquestsAvg: 4 }), 'martial')).toBe(true); // 4 × 1.5 = 6
    expect(has(facts({ conquests: 5, conquestsAvg: 4 }), 'martial')).toBe(false);
    expect(has(facts({ conquests: min, conquestsAvg: 1 }), 'martial')).toBe(true); // 平均很少时看 min
    expect(has(facts({ conquests: min - 1, conquestsAvg: 1 }), 'martial')).toBe(false);
    expect(has(facts({ conquests: 19, conquestsAvg: 20 / ratio }), 'martial')).toBe(false);
    const t = readTraits(facts({ conquests: 12, conquestsAvg: 4, wars: 3 }))[0];
    expect(t.why).toBe('本族之国打下 12 州、宣战 3 回，是各族平均的三倍');
  });

  it('重商:港口州至少 3 个、占两成五以上,市税份额 ≥ 各国平均 × 1.1', () => {
    const ok = facts({ ports: 5, regions: 20, market: 0.12, marketAvg: 0.1 });
    expect(has(ok, 'mercantile')).toBe(true);
    expect(has({ ...ok, ports: 4 }, 'mercantile')).toBe(false); // 4 / 20 = 两成
    expect(has({ ...ok, market: 0.109 }, 'mercantile')).toBe(false);
    expect(has({ ...ok, regions: 8, ports: 2 }, 'mercantile')).toBe(false); // 占比够了,港口太少
    expect(has({ ...ok, market: -1 }, 'mercantile')).toBe(false); // 没有本族之国
    expect(readTraits(ok).find((t) => t.key === 'mercantile')!.why).toBe('市税占本族之国进项 12%，各国平均 10%；5 州有港口');
  });

  it('崇文:信息能力排前四(也不超过排了名的三成)', () => {
    expect(has(facts({ infoRank: 4, infoOf: 14 }), 'learned')).toBe(true);
    expect(has(facts({ infoRank: 5, infoOf: 14 }), 'learned')).toBe(false);
    expect(has(facts({ infoRank: 2, infoOf: 6 }), 'learned')).toBe(false); // 六族里只取第一
    expect(has(facts({ infoRank: 1, infoOf: 3 }), 'learned')).toBe(true);
    expect(has(facts({ infoRank: 0, infoOf: 14 }), 'learned')).toBe(false); // 没排上(州太少)
    expect(readTraits(facts({ infoRank: 1 }))[0].why).toBe('信息能力在世上数第一');
    expect(readTraits(facts({ infoRank: 3 }))[0].why).toBe('信息能力在世上排第 3');
  });

  it('敬神:九成以上的州信大教,而且圣城在本族、或这段时间有教派在本族之国分出', () => {
    const sect = { name: '埃德瓦东派', year: 2150, polity: '奥利亚王国' };
    expect(has(facts({ great: 0.95, sect }), 'pious')).toBe(true);
    expect(has(facts({ great: 0.9, holy: '埃德瓦教' }), 'pious')).toBe(true);
    expect(has(facts({ great: 0.89, holy: '埃德瓦教' }), 'pious')).toBe(false);
    expect(has(facts({ great: 1 }), 'pious')).toBe(false); // 只是全信,没有渊源
    expect(readTraits(facts({ great: 0.95, sect }))[0].why).toBe('住的州九成五信大教；埃德瓦东派 2150 年在奥利亚王国分出');
    expect(readTraits(facts({ great: 1, holy: '埃德瓦教' }))[0].why).toBe('住的州都信大教；埃德瓦教的圣城在本族的城里');
  });

  it('善骑:游牧民族,或四成五以上的州是草原、荒漠', () => {
    expect(has(facts({ kind: 'nomad' }), 'horse')).toBe(true);
    expect(has(facts({ steppe: TRAIT_RULES.horse.steppe }), 'horse')).toBe(true);
    expect(has(facts({ steppe: 0.44 }), 'horse')).toBe(false);
    expect(readTraits(facts({ steppe: 0.61 }))[0].why).toBe('住的州六成是草原、荒漠');
    expect(readTraits(facts({ kind: 'nomad', steppe: 0.58 }))[0].why).toBe('游牧；住的州近六成是草原、荒漠');
    expect(readTraits(facts({ kind: 'nomad', steppe: 0.1 }))[0].why).toBe('游牧民族');
  });

  it('善航:海洋民族,或港口州至少 3 个、占四成五以上', () => {
    expect(has(facts({ kind: 'sea' }), 'sea')).toBe(true);
    expect(has(facts({ ports: 9, regions: 20 }), 'sea')).toBe(true);
    expect(has(facts({ ports: 8, regions: 20 }), 'sea')).toBe(false);
    expect(has(facts({ ports: 2, regions: 4 }), 'sea')).toBe(false);
    expect(readTraits(facts({ kind: 'sea', ports: 12, regions: 20 }))[0].why).toBe('海洋民族；住的州六成有港口');
  });

  it('坚忍:本族之国亡国 + 避兵迁徙 ≥ 2 回(四成以上的州归异族之国再算一回),族还在', () => {
    expect(has(facts({ falls: 2 }), 'enduring')).toBe(true);
    expect(has(facts({ falls: 1, flights: 1 }), 'enduring')).toBe(true);
    expect(has(facts({ falls: 1 }), 'enduring')).toBe(false);
    expect(has(facts({ flights: 1, foreign: 0.4 }), 'enduring')).toBe(true);
    expect(has(facts({ flights: 1, foreign: 0.39 }), 'enduring')).toBe(false);
    expect(has(facts({ migrations: 5 }), 'enduring')).toBe(false); // 随征服迁走的不算
    expect(readTraits(facts({ falls: 1, flights: 1, foreign: 0.45, regions: 62 }))[0].why).toBe('本族之国亡过 1 回、避兵迁徙 1 回、住的州近五成归异族之国，族还在 62 州');
  });

  it('最多三条,按显著程度排;善骑、善航都够上只留更显著的', () => {
    const all = facts({ kind: 'nomad', conquests: 40, falls: 6, infoRank: 1, great: 1, holy: '某教', ports: 15, regions: 20, market: 0.2 });
    const t = readTraits(all);
    expect(t.length).toBe(TRAIT_MAX);
    for (let i = 1; i < t.length; i++) expect(t[i - 1].strength).toBeGreaterThanOrEqual(t[i].strength);
    expect(t[0].key).toBe('martial'); // 打下 40 州,是门槛的六倍多
    const both = keys(facts({ kind: 'sea', steppe: 0.9, ports: 10, regions: 20 }));
    expect(both.filter((k) => k === 'horse' || k === 'sea')).toEqual(['horse']);
  });

  it('几成的说法', () => {
    expect(tenths(1)).toBe('都');
    expect(tenths(0.95)).toBe('九成五');
    expect(tenths(0.6)).toBe('六成');
    expect(tenths(0.54)).toBe('五成多');
    expect(tenths(0.58)).toBe('近六成');
    expect(tenths(0.03)).toBe('极少数');
  });
});

describe.each([7, 2024])('真世界 · seed=%i', (seed) => {
  const civ: Civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed }));

  it('现存各族读出来的:最多三条、来由不空、节头的年份对;读几遍一样、历史不变', () => {
    const y = Math.floor(civ.endYear);
    const log = civ.log.size;
    const annals = civ.annals.length;
    const own = ownersAt(civ, y);
    let any = 0;
    for (const cu of civ.cultures) {
      const r = cultureTraits(civ, cu.id, y);
      if (cu.unborn) {
        expect(r).toBeNull();
        continue;
      }
      expect(r).not.toBeNull();
      expect(r!.window).toEqual(traitWindow(cu, y));
      expect(r!.traits.length).toBeLessThanOrEqual(TRAIT_MAX);
      for (const t of r!.traits) expect(t.why.length).toBeGreaterThan(3);
      // 段末住几州和归属对得上
      if (cu.ended === undefined) {
        let n = 0;
        for (let q = 0; q < civ.regions.count; q++) if (own.culture[q] === cu.id) n++;
        expect(r!.facts.regions).toBe(n);
      }
      expect(cultureTraits(civ, cu.id, y)).toEqual(r);
      any += r!.traits.length;
    }
    expect(any).toBeGreaterThan(0);
    expect(civ.log.size).toBe(log);
    expect(civ.annals.length).toBe(annals);
  });

  it('随时代变:按时间轴那一年往前三百年读,各段的数各算各的,总有族前后读出来不一样', () => {
    const cu = civ.cultures.find((c) => !c.unborn && c.born < 500 && c.ended === undefined)!;
    expect(cultureTraits(civ, cu.id, 1000)!.window).toEqual({ from: 700, to: 1000 });
    // 打下的州、亡国只数这一段里的:一段里的不会比把它包进去的长段多
    const short = cultureFacts(civ, cu.id, { from: 1800, to: 2000 });
    const long = cultureFacts(civ, cu.id, { from: 1700, to: 2000 });
    expect(short.conquests).toBeLessThanOrEqual(long.conquests);
    expect(short.falls).toBeLessThanOrEqual(long.falls);
    expect(short.migrations).toBeLessThanOrEqual(long.migrations);
    let changed = 0;
    for (const c of civ.cultures) {
      if (c.unborn) continue;
      const sets = [800, 1600, 2400, Math.floor(civ.endYear)].map((y) => (cultureTraits(civ, c.id, y)?.traits ?? []).map((t) => t.key).join(','));
      if (new Set(sets).size > 1) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });
});

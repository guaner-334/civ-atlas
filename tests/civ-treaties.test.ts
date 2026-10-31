/**
 * 立约与中立地(gen/civ/treaties.ts、treatyInfo.ts):
 * 几个种子里都长出了约、三国以上的有限竞争之约、中立地、放逐;约期内约国之间不开战(要开战先记背约);
 * 中立地那一州在中立的年份里不归任何一国;放逐的人物对得上中立地;编年史的几种说法读得通;
 * 两国之约的一国亡国时,亡国之君先出奔中立地、约再作废;约和中立地还在的时候停下、接着推,和一口气推完一样。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { treatyModelOf, treatyStats } from '../src/gen/civ/treaties';
import { treatyBook, treatyMembersAt, treatyName, zonesAt, type ZoneInfo } from '../src/gen/civ/story/treatyInfo';
import { endPolity, polityModelOf } from '../src/gen/civ/polities';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { resumeCiv } from '../src/gen/civ/modules';
import { civApi } from '../src/gen/civ/api';

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

describe('立约与中立地', () => {
  it('几个种子里都长出了约,有三国以上的有限竞争之约、中立地、放逐;约不至于多到满世界都是', () => {
    let treaties = 0;
    let multi = 0;
    let zones = 0;
    let exiles = 0;
    // 放逐少见:GENERATOR_VERSION 41(开战看内政)20 个种子里 8 个世界有、合计 8 回(40 是 11 回),种子 1–3 一回都没有,多看一个种子 4;
    // 三国以上的约也少见:GENERATOR_VERSION 48(时代做法)以后种子 1–8 一份都没有,多看一个种子 13(种子 1–13 里头一个有的);
    // 56(滚雪球,同时在世的国家少了)以后种子 1–60 里只有 36、49 有,换成 36
    for (const s of [...SEEDS, 4, 36]) {
      const st = treatyStats(civOf(s));
      expect(st.treaties, `seed ${s}`).toBeGreaterThan(0);
      expect(st.treaties, `seed ${s}`).toBeLessThan(40);
      treaties += st.treaties;
      multi += st.multi;
      zones += st.zones;
      exiles += st.exiles + st.fled;
    }
    expect(treaties).toBeGreaterThanOrEqual(15);
    expect(multi).toBeGreaterThan(0);
    expect(zones).toBeGreaterThan(0);
    expect(exiles).toBeGreaterThan(0);
  }, 120_000);

  it.each(SEEDS)('seed %i:约期内约国之间不开战;背约开战的,同一刻先记了背约', (seed) => {
    const civ = civOf(seed);
    const book = treatyBook(civ);
    civ.annals.forEach((e) => {
      if (e.kind !== 'war') return;
      for (const x of book.treaties) {
        if (!x || x.breaches.some((b) => b.war === e.war)) continue;
        const ms = treatyMembersAt(civ, x, e.year);
        expect(ms.includes(e.a) && ms.includes(e.b), `第 ${e.year} 年第 ${e.war} 场战争,约 ${x.id}`).toBe(false);
      }
      if (e.cause === 'breach') expect(book.treaties.some((x) => x?.breaches.some((b) => b.war === e.war && b.by === e.a && b.against === e.b))).toBe(true);
    });
  }, 120_000);

  it.each(SEEDS)('seed %i:中立地那一州在中立的年份里不归任何一国;放逐的人物对得上中立地', (seed) => {
    const civ = civOf(seed);
    const book = treatyBook(civ);
    for (const z of book.zones) {
      if (!z) continue;
      const end = z.ended ?? civ.endYear;
      for (const y of [z.from + 1 / 256, (z.from + end) / 2, end - 1 / 256]) {
        if (y <= z.from || y >= end) continue;
        expect(ownersAt(civ, y).polity[z.region], `中立地 ${z.id} 第 ${y} 年`).toBe(-1);
      }
      expect(zonesAt(civ, (z.from + end) / 2).some((v) => v.id === z.id)).toBe(true);
      // 依的约:中立地设的时候约里至少两国
      expect(treatyMembersAt(civ, book.treaties[z.treaty], z.from).length).toBeGreaterThanOrEqual(2);
    }
    for (const x of civ.people ?? []) {
      const ex = x.exile;
      // 出奔邻国的(没有中立地)见 civ-exile.test.ts
      if (!ex || ex.to !== undefined) continue;
      const z = book.zones[ex.zone];
      expect(z.region).toBe(ex.region);
      expect(ex.year).toBeGreaterThanOrEqual(z.from);
      // 亡国之君出奔可以在中立地撤销的同一刻(两国之约:他先出奔,约再作废、中立地再撤)
      if (ex.how === 'fled') expect(ex.year <= (z.ended ?? Infinity)).toBe(true);
      else expect(ex.year < (z.ended ?? Infinity)).toBe(true);
      expect(x.died === undefined || x.died >= ex.year).toBe(true);
      if (ex.how === 'heir') expect(x.role).toBe('prince');
      else expect(x.fate).toBe(ex.how);
      expect(z.residents).toContain(x.id);
    }
  }, 120_000);

  it.each(SEEDS)('seed %i:编年史里立约、续约、背约、约满、中立、放逐、出奔的说法读得通', (seed) => {
    const civ = civOf(seed);
    const KINDS = new Set(['treaty', 'breach', 'expire', 'neutral', 'exile']);
    const list = buildChronicle(civ).filter((e) => KINDS.has(e.kind));
    expect(list.length).toBeGreaterThan(0);
    for (const e of list) {
      expect(e.text, e.text).not.toMatch(/undefined|NaN|某国|null/);
      expect('约续满违中逐奔').toContain(e.tag);
    }
    const signed = list.filter((e) => e.tag === '约');
    for (const e of signed) expect(e.text).toMatch(/互不侵犯/);
    // 约名照会盟的城起
    for (const x of treatyBook(civ).treaties) if (x && x.settlement >= 0) expect(treatyName(civ, x.id)).toBe(`${civ.settlements[x.settlement].name}之约`);
  }, 120_000);

  it('两国之约的一国亡于战争:亡国之君先出奔约里的中立地,约再作废、中立地再撤', () => {
    // 推演里约国很少亡(多半势均力敌,中立地也只撑二三十年):在两国之约的中立地还在的年份停下,直接让约里一国亡国,看亡国那一刻怎么处理
    let tried = 0;
    for (const seed of SEEDS) {
      const w = world(seed);
      const whole = civOf(seed);
      const book = treatyBook(whole);
      const cutOf = (z: ZoneInfo) => Math.floor((z.from + (z.ended ?? whole.endYear)) / 2);
      const z = book.zones.find((v) => v && cutOf(v) > v.from && treatyMembersAt(whole, book.treaties[v.treaty], cutOf(v)).length === 2);
      if (!z) continue;
      tried++;
      const cut = cutOf(z);
      const sim = resumeCiv(w, generateCiv(w, { endYear: cut }));
      const pm = polityModelOf(sim)!;
      const tm = treatyModelOf(sim)!;
      const [x, y] = treatyMembersAt(whole, book.treaties[z.treaty], cut);
      expect(tm.zones[z.id].ended, `seed ${seed} 第 ${cut} 年中立地 ${z.id} 还在`).toBeUndefined();
      const n = sim.annalCount;
      endPolity(pm, y, sim.now);
      civApi(sim).war.onFall!({ id: -1, a: x, b: y, start: sim.now, takes: [] }, x, y, sim.now);
      const got = Array.from({ length: sim.annalCount - n }, (_, i) => sim.annal(n + i));
      expect(got.map((e) => `${e.kind}:${e.cause ?? ''}`), `seed ${seed}`).toEqual(['exile:fled', 'expire:lapse', 'neutral:lapse']);
      expect(got[0]).toMatchObject({ a: y, war: z.id, region: z.region, year: cut });
      expect(got[2]).toMatchObject({ war: z.id, year: cut });
      expect(tm.zones[z.id].ended).toBe(cut);
    }
    expect(tried).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('约和中立地还在的时候停下、存档读回、接着推到第 3000 年:和一口气推完逐项一样', () => {
    // 每个种子挑一处撑得最久的中立地,在它中间那年停下(约、中立地都还在,中立地上可能已经住了人)
    let tried = 0;
    for (const seed of SEEDS) {
      const w = world(seed);
      const whole = civOf(seed);
      const zs = treatyBook(whole).zones.filter((z) => z && (z.ended ?? whole.endYear) - z.from >= 4);
      if (!zs.length) continue;
      const z = zs.reduce((a, b) => ((b.ended ?? whole.endYear) - b.from > (a.ended ?? whole.endYear) - a.from ? b : a));
      const cut = Math.floor((z.from + (z.ended ?? whole.endYear)) / 2);
      tried++;
      const mid = generateCiv(w, { endYear: cut });
      expect(zonesAt(mid, cut).length, `seed ${seed} 第 ${cut} 年还有中立地`).toBeGreaterThan(0);
      const saved = unpackValue(packValue(mid)) as Civ;
      const cont = continueCiv(w, saved, { endYear: 3000 });
      for (const k of ['annals', 'log', 'polity', 'people'] as const) expect(cont[k], `seed ${seed} ${k}`).toEqual(whole[k]);
    }
    expect(tried).toBeGreaterThanOrEqual(2);
  }, 240_000);
});

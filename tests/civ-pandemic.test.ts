/**
 * 全球大疫(civ/pandemic.ts)、疫后凋敝和「天灾」设定:
 * - 没下全球大疫、「天灾」平常的世界和没有这一层一样(指纹见 determinism.test.ts;这里查没有新的史事、折损、事件)
 * - 作者下的全球大疫:传遍各洲、人口掉二到三成、凋敝里接着掉、村镇荒废、时代往回退、路断,之后长回来
 * - 接着推(存档读回)和一口气推完逐项一样:传到一半、凋敝里、凋敝刚结束切开;「天灾 很多」自己发生的全球大疫、地震水旱也一样
 * - 编年史的说法;干预、大纲、存档里的字段
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { cleanIntervention, cleanPlot, settlementKey, EMPTY_EDITS, type Intervention } from '../src/gen/edits';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { populationAt, regionPopulationAt, ruinSites } from '../src/gen/civ/growth';
import { developmentAt, eraLevel } from '../src/gen/civ/development';
import { ownersAt } from '../src/gen/civ/timeline';
import { pandemicsOf, peakEraAt, slumpAt, wasteAt } from '../src/gen/civ/pandemicInfo';
import { plagueSpans } from '../src/gen/civ/plagueSpans';
import { buildChronicle } from '../src/gen/civ/chronicle';
import { developmentEntries } from '../src/gen/civ/developmentText';
import { cleanCalamity } from '../src/gen/civ/calamity';

const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
}
const plain = new Map<number, Civ>();
function plainCiv(seed: number): Civ {
  let c = plain.get(seed);
  if (!c) plain.set(seed, (c = generateCiv(world(seed))));
  return c;
}

/** 第 Y 年那时人口最多的港口起一场全球大疫(中) */
function pandemicIv(seed: number, Y: number, slump?: number): Intervention {
  const base = plainCiv(seed);
  const s = base.settlements.filter((x) => x.port && x.founded <= Y && !(x.ended !== undefined && x.ended <= Y)).sort((a, b) => populationAt(b, Y) - populationAt(a, Y))[0];
  return { kind: 'disaster', type: 'pandemic', level: 2, from: Y, city: settlementKey(base, s.id), ...(slump !== undefined ? { slump } : {}) };
}

const Y = 2476;
const struck = new Map<number, Civ>();
function struckCiv(seed: number): Civ {
  let c = struck.get(seed);
  if (!c) struck.set(seed, (c = generateCiv(world(seed), { interventions: [pandemicIv(seed, Y)] })));
  return c;
}

function worldPop(civ: Civ, y: number): number {
  let s = 0;
  for (let r = 0; r < civ.regions.count; r++) s += regionPopulationAt(civ, r, y);
  return s;
}
function eraMean(civ: Civ, y: number): number {
  const own = ownersAt(civ, y).culture;
  const lv = developmentAt(civ.development!, y);
  let s = 0;
  let n = 0;
  for (let r = 0; r < civ.regions.count; r++) {
    if (own[r] < 0) continue;
    s += eraLevel(lv, r);
    n++;
  }
  return s / n;
}

/** 两份历史逐项一样(接着推的 vs 一口气推完的) */
function sameCiv(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

describe('全球大疫', () => {
  it('平常、没下全球大疫:没有全球大疫的史事、带 until 的折损、凋敝里的折损', () => {
    for (const seed of [7, 2024]) {
      const civ = plainCiv(seed);
      expect(civ.calamity).toBeUndefined();
      expect(civ.annals.some((e) => e.kind === 'pandemic' || e.kind === 'desolate' || e.cause === 'pandemic')).toBe(false);
      expect(civ.settlements.some((s) => s.sacks?.some((k) => k.until !== undefined || k.cause === 'slump'))).toBe(false);
      expect(civ.development!.events.some((e) => e.kind === 'regress')).toBe(false);
      expect(pandemicsOf(civ)).toEqual([]);
      expect(slumpAt(civ, Y)).toBeNull();
      expect(wasteAt(civ, Y + 20)).toBeNull();
    }
  }, 120_000);

  it('作者下的全球大疫(第 2476 年,中,无人收拾 30 年):传遍各洲,人口掉二到三成,凋敝里接着掉、村镇荒废、时代往回退、路断,之后长回来', () => {
    for (const seed of [7, 2024]) {
      const civ = struckCiv(seed);
      const base = plainCiv(seed);
      const tag = `seed ${seed}`;
      const [p] = pandemicsOf(civ);
      expect(p, tag).toBeDefined();
      expect(p.year, tag).toBe(Y);
      expect(p.end, tag).toBe(Y + 30);
      expect(p.pre, tag).toBeGreaterThan(0);
      // 传得开:有人住的州染了六成以上,九年以内传完
      const own = ownersAt(civ, Y).culture;
      let lived = 0;
      for (let r = 0; r < civ.regions.count; r++) if (own[r] >= 0) lived++;
      expect(p.hits.length / lived, tag).toBeGreaterThan(0.6);
      expect(p.hits.length / lived, tag).toBeLessThan(0.97);
      expect(Math.max(...p.hits.map((h) => h.year)) - Y, tag).toBeLessThan(9);
      for (const h of p.hits) {
        expect(h.loss, tag).toBeGreaterThan(0.1);
        expect(h.loss, tag).toBeLessThanOrEqual(0.6);
      }
      // 人口:传完时比不下少二到三成,凋敝结束时更少,百年后长回去一大半
      const pre = worldPop(civ, Y - 10);
      const r10 = worldPop(civ, Y + 10) / worldPop(base, Y + 10);
      const r30 = worldPop(civ, Y + 30) / worldPop(base, Y + 30);
      const r110 = worldPop(civ, Y + 110) / pre;
      expect(r10, tag).toBeLessThan(0.85);
      expect(r10, tag).toBeGreaterThan(0.6);
      expect(r30, tag).toBeLessThan(r10 + 0.01);
      expect(r110, tag).toBeGreaterThan(0.9);
      // 时代往回退:凋敝结束时比不下低半个时代以上,之后回升
      const e30 = eraMean(civ, Y + 30);
      expect(eraMean(base, Y + 30) - e30, tag).toBeGreaterThan(0.4);
      expect(eraMean(civ, Y + 110), tag).toBeGreaterThan(e30 + 0.3);
      // 村镇荒废(没有国都、没有城以上的),凋敝里不重建
      expect(p.desolated.length, tag).toBeGreaterThan(10);
      for (const d of p.desolated) {
        const s = civ.settlements[d.settlement];
        expect(s.ended, tag).toBe(d.year);
        expect(d.year > Y && d.year < Y + 30, tag).toBe(true);
        expect(populationAt(s, d.year - 1 / 256), tag).toBeLessThan(25);
        expect(civ.polities.some((q) => q.capitals?.some((c, i, all) => c.settlement === s.id && c.year <= d.year && (all[i + 1]?.year ?? Infinity) > d.year && (q.ended ?? Infinity) > d.year)), tag).toBe(false);
      }
      for (const e of civ.annals) if (e.kind === 'rebuild' && e.year > Y && e.year < Y + 30) expect(p.hits.every((h) => h.region !== e.region || h.year > e.year), `${tag} 凋敝里重建`).toBe(true);
      expect(ruinSites(civ, Y + 30).length, tag).toBeGreaterThan(ruinSites(base, Y + 30).length + 10);
      // 路断:凋敝结束时陆路少了一成以上
      const roads = (c: Civ, y: number) => c.routes.filter((r) => r.kind !== 'sea' && r.built <= y && !(r.abandoned !== undefined && r.abandoned <= y)).length;
      expect(roads(civ, Y + 30), tag).toBeLessThan(roads(base, Y + 30) * 0.9);
      // 国都退回上一个时代的记大事
      expect(civ.development!.events.some((e) => e.kind === 'regress' && e.year > Y && e.year < Y + 31), tag).toBe(true);
      // 给界面、地图的数:凋敝程度、荒地、到过的最高时代
      const sl = slumpAt(civ, Y + 20)!;
      expect(sl.filter((v) => v > 0).length, tag).toBeGreaterThan(p.hits.length * 0.9);
      expect(slumpAt(civ, Y + 31), tag).toBeNull();
      const waste = wasteAt(civ, Y + 25)!;
      expect(waste.filter((v) => v > 0).length, tag).toBeGreaterThan(50);
      for (const v of waste) expect(v >= 0 && v <= 1, tag).toBe(true);
      const hr = p.hits[0].region;
      expect(peakEraAt(civ, hr, Y + 30), tag).toBeGreaterThanOrEqual(eraLevel(developmentAt(civ.development!, Y + 30), hr));
      // 起疫以前的历史一字不差
      expect(civ.annals.filter((e) => e.year < Y), tag).toEqual(base.annals.filter((e) => e.year < Y));
    }
  }, 300_000);

  it('瘟疫那一层认得出全球大疫:一场,史事 plague 的 cause = pandemic,疫区照常', () => {
    const civ = struckCiv(7);
    const sp = plagueSpans(civ).filter((s) => s.pandemic);
    expect(sp.length).toBe(1);
    expect(sp[0].start).toBe(Y);
    expect(new Set(sp[0].hits.map((h) => h.region)).size).toBe(sp[0].hits.length);
    expect(civ.annals.filter((e) => e.kind === 'plague' && e.war === sp[0].id).every((e) => e.cause === 'pandemic')).toBe(true);
    // 凋敝里不自己起疫
    expect(plagueSpans(civ).some((s) => !s.pandemic && s.start > Y && s.start < Y + 30)).toBe(false);
  }, 120_000);

  it('接着推:传到一半、凋敝里、凋敝刚结束切开,存档读回接着推到底,和一口气推完逐项一样', () => {
    for (const seed of [7, 2024]) {
      const w = world(seed);
      const iv = [pandemicIv(seed, Y)];
      const whole = generateCiv(w, { interventions: iv, endYear: 2700 });
      for (const cut of [Y, Y + 3.5, Y + 12, Y + 30]) {
        const half = unpackValue(packValue(generateCiv(w, { interventions: iv, endYear: cut }))) as Civ;
        sameCiv(continueCiv(w, half, { interventions: iv, endYear: 2700 }), whole, `seed ${seed} 第 ${cut} 年切开`);
      }
    }
  }, 600_000);

  it('同一年下两场全球大疫(凋敝一样长):各场的州认得清,凋敝里切开接着推和一口气推完一样', () => {
    const seed = 7;
    const w = world(seed);
    const base = plainCiv(seed);
    const ports = base.settlements.filter((x) => x.port && x.founded <= Y && !(x.ended !== undefined && x.ended <= Y)).sort((a, b) => populationAt(b, Y) - populationAt(a, Y));
    const iv: Intervention[] = [0, 5].map((i) => ({ kind: 'disaster', type: 'pandemic', level: 2, from: Y, city: settlementKey(base, ports[i].id) }));
    const whole = generateCiv(w, { interventions: iv, endYear: 2560 });
    const ps = pandemicsOf(whole);
    expect(ps.length).toBe(2);
    expect(ps[0].hits.length).toBeGreaterThanOrEqual(1);
    expect(ps[1].hits.length).toBeGreaterThan(ps[0].hits.length);
    const half = unpackValue(packValue(generateCiv(w, { interventions: iv, endYear: Y + 15 }))) as Civ;
    sameCiv(continueCiv(w, half, { interventions: iv, endYear: 2560 }), whole, '同一年两场');
  }, 300_000);

  it('疫后无人收拾 10 / 60 年:凋敝长短跟着变,60 年的荒废、退得更多', () => {
    const w = world(7);
    const a = generateCiv(w, { interventions: [pandemicIv(7, Y, 10)], endYear: 2650 });
    const b = generateCiv(w, { interventions: [pandemicIv(7, Y, 60)], endYear: 2650 });
    const [pa] = pandemicsOf(a);
    const [pb] = pandemicsOf(b);
    expect(pa.end).toBe(Y + 10);
    expect(pb.end).toBe(Y + 60);
    expect(pb.desolated.length).toBeGreaterThan(pa.desolated.length);
    expect(eraMean(b, Y + 60)).toBeLessThan(eraMean(a, Y + 60));
    // 保底:一城一次最多死六成,天下人口不低于疫前一半
    for (const p of [pa, pb]) for (const h of p.hits) expect(h.loss).toBeLessThanOrEqual(0.6);
    expect(worldPop(b, Y + 60)).toBeGreaterThan(0.5 * pb.pre);
  }, 300_000);

  it('编年史:全球大疫一条("某某大疫:起于…天下人口十去其几")、一国一条城邑荒废、凋敝结束一条、国都退入某时代', () => {
    const civ = struckCiv(7);
    const list = buildChronicle(civ);
    const [p] = pandemicsOf(civ);
    const main = list.find((e) => e.kind === 'plague' && e.year === Y && e.text.includes('大疫:起于'))!;
    expect(main).toBeDefined();
    expect(main.text).toMatch(/^.+大疫:起于.+,至.+州,\d+ 年乃息。城中死者十之.+,天下人口十去其.$/);
    expect(main.importance).toBe(3);
    expect(main.children!.length).toBeGreaterThan(3);
    const des = list.filter((e) => e.text.includes('疫后城邑荒废'));
    expect(des.reduce((s, e) => s + (e.children?.length ?? 1), 0)).toBe(p.desolated.length);
    for (const e of des) expect(e.tag).toBe('疫');
    const end = list.find((e) => e.year === Y + 30 && e.text.startsWith('疫后凋敝三十年,至是始复'));
    expect(end).toBeDefined();
    const iv = list.find((e) => e.kind === 'intervene' && e.year === Y)!;
    expect(iv.text).toMatch(/起大疫,疫后无人收拾三十年$/);
    const back = developmentEntries(civ).filter((e) => e.text.includes('退入'));
    expect(back.length).toBeGreaterThan(0);
    for (const e of back) expect(e.text).toMatch(/退入.+时代\(疫后凋敝,.+之业渐废\)$/);
    for (const e of [...list, ...back]) expect(e.text).not.toMatch(/undefined|NaN|-1/);
  }, 120_000);
});

describe('「天灾」多 / 很多', () => {
  const many = new Map<number, Civ>();
  const manyCiv = (seed: number) => {
    let c = many.get(seed);
    if (!c) many.set(seed, (c = generateCiv(world(seed), { calamity: 'many' })));
    return c;
  };

  it('很多:瘟疫、饥荒更多,自己闹地震水旱、全球大疫;保底文明不断绝', () => {
    for (const seed of [7, 2024]) {
      const civ = manyCiv(seed);
      const base = plainCiv(seed);
      const tag = `seed ${seed}`;
      expect(civ.calamity).toBe('many');
      const count = (c: Civ, k: string) => c.annals.filter((e) => e.kind === k).length;
      expect(plagueSpans(civ).length, tag).toBeGreaterThan(plagueSpans(base).length);
      expect(count(civ, 'famine'), tag).toBeGreaterThan(count(base, 'famine'));
      expect(civ.annals.some((e) => e.kind === 'famine' && e.cause === 'quake'), tag).toBe(true);
      const ps = pandemicsOf(civ);
      expect(ps.length, tag).toBeGreaterThanOrEqual(1);
      for (const p of ps) {
        expect(p.iv, tag).toBeUndefined();
        expect(p.end - p.year, tag).toBeGreaterThanOrEqual(30);
        expect(p.end - p.year, tag).toBeLessThanOrEqual(50);
        for (const h of p.hits) expect(h.loss, tag).toBeLessThanOrEqual(0.6);
        for (let y = Math.ceil(p.year); y <= Math.min(civ.endYear, p.end); y += 5) expect(worldPop(civ, y), `${tag} 第 ${y} 年`).toBeGreaterThan(0.5 * p.pre);
      }
      expect(civ.polities.some((q) => q.ended === undefined), tag).toBe(true);
    }
  }, 300_000);

  it('接着推:自己发生的全球大疫凋敝里、地震水旱前后切开,和一口气推完逐项一样', () => {
    const seed = 7;
    const w = world(seed);
    const whole = manyCiv(seed);
    const p = pandemicsOf(whole)[0];
    const quake = whole.annals.find((e) => e.kind === 'famine' && e.cause === 'quake')!;
    for (const cut of [p.year + 2.5, p.year + 20, quake.year]) {
      const half = unpackValue(packValue(generateCiv(w, { calamity: 'many', endYear: cut }))) as Civ;
      expect(half.calamity).toBe('many');
      sameCiv(continueCiv(w, half, { calamity: 'many' }), whole, `第 ${cut} 年切开`);
    }
  }, 600_000);
});

describe('字段', () => {
  it('干预:全球大疫要 city,slump 吸到 10 / 30 / 60(30 不写);大纲同样', () => {
    expect(cleanIntervention({ kind: 'disaster', type: 'pandemic', level: 3, from: 100, city: 'settlement:c12#0', slump: 55 })).toEqual({ kind: 'disaster', type: 'pandemic', level: 3, from: 100, city: 'settlement:c12#0', slump: 60 });
    expect(cleanIntervention({ kind: 'disaster', type: 'pandemic', level: 2, from: 100, city: 'settlement:c12#0', slump: 30 })).toEqual({ kind: 'disaster', type: 'pandemic', level: 2, from: 100, city: 'settlement:c12#0' });
    expect(cleanIntervention({ kind: 'disaster', type: 'pandemic', level: 2, from: 100 })).toBeNull();
    expect(cleanIntervention({ kind: 'disaster', type: 'plague', level: 2, from: 100, city: 'settlement:c12#0', slump: 10 })).toEqual({ kind: 'disaster', type: 'plague', level: 2, from: 100, city: 'settlement:c12#0' });
    expect(cleanPlot({ id: 1, kind: 'disaster', year: 2476, type: 'pandemic', city: 'settlement:c12#0', slump: 10, region: 'region:c3' })).toEqual({ id: 1, kind: 'disaster', year: 2476, type: 'pandemic', city: 'settlement:c12#0', slump: 10 });
    expect(cleanPlot({ id: 1, kind: 'disaster', year: 2476, type: 'pandemic' })).toBeNull();
  });

  it('「天灾」:多 / 很多认得,别的当平常;存档往返', () => {
    expect(cleanCalamity('many')).toBe('many');
    expect(cleanCalamity('more')).toBe('more');
    expect(cleanCalamity('normal')).toBeUndefined();
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, { ...EMPTY_EDITS, calamity: 'many' }, 'c');
    expect(save.edits.calamity).toBe('many');
    const r = parseSave(saveText(save));
    expect(r.ok && r.save.edits.calamity).toBe('many');
    const bad = parseSave(saveText({ ...save, edits: { ...save.edits, calamity: 'lots' as never } }));
    expect(bad.ok && bad.save.edits.calamity).toBeUndefined();
    expect(bad.ok && bad.warnings.some((w) => w.includes('天灾'))).toBe(true);
  });
});

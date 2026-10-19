/**
 * 接着推不改过去:
 * - 推到 T1、存档(打包再读回)、接着推到 T2,和一口气推到 T2 逐项一样(归属、日志、史事、检查点、城名、颜色、人物、道路、信仰……)
 * - 推到不同的年份,早先已经有的东西(民族、城、国家、人物、地名、道路、信仰)一样:往后推不改过去
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ, type CivParams } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { regionKey, type Intervention } from '../src/gen/edits';

const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};
const SEEDS = [7, 2024];
const CUSTOM: Partial<CivParams> = { polities: 12, cultures: 8, pace: 1.3 };

/** 某年回放时画出来的道路:每一步(两端地块、类别、修建年份、那年以前荒废的年份) */
function routeSteps(civ: Civ, T: number): string[] {
  const out: string[] = [];
  for (const r of civ.routes) {
    if (!(r.built <= T)) continue;
    const gone = r.abandoned !== undefined && r.abandoned <= T ? r.abandoned : 'open';
    for (let t = 1; t < r.cells.length; t++) {
      const a = Math.min(r.cells[t - 1], r.cells[t]);
      const b = Math.max(r.cells[t - 1], r.cells[t]);
      out.push(`${a},${b},${r.kind},${r.built},${gone}`);
    }
  }
  return out.sort();
}

/** a(推到 T)里已经有的东西,b(推得更远)里一样 */
function samePast(a: Civ, b: Civ, T: number, label: string) {
  const by = <X>(xs: readonly X[], ok: (x: X) => boolean, f: (x: X) => unknown) => xs.filter(ok).map(f);
  expect(by(b.cultures, (c) => c.born <= T, (c) => [c.id, c.name, c.style, c.color]), `${label} 民族`).toEqual(
    by(a.cultures, (c) => c.born <= T, (c) => [c.id, c.name, c.style, c.color]),
  );
  expect(by(b.settlements, (s) => s.founded <= T, (s) => [s.id, s.cell, s.name, s.culture]), `${label} 城镇`).toEqual(
    by(a.settlements, (s) => s.founded <= T, (s) => [s.id, s.cell, s.name, s.culture]),
  );
  expect(by(b.polities, (p) => p.founded <= T, (p) => [p.id, p.name, p.color, p.capital]), `${label} 国家`).toEqual(
    by(a.polities, (p) => p.founded <= T, (p) => [p.id, p.name, p.color, p.capital]),
  );
  // 朝代:推到 T 时已经改朝换代过的,每一朝的年份、名号、都城一样
  for (const p of a.polities) if (p.dynasties) expect(b.polities[p.id].dynasties!.slice(0, p.dynasties.length), `${label} ${p.name} 朝代`).toEqual(p.dynasties);
  // 人物:编号按出道先后排,推到 T 时已经有的人编号、名字、身世一样(谥号、"一世"这类后来才定的称呼,T 以后才领的兵、还在打的仗打到哪年不比)
  const who = (x: NonNullable<Civ['people']>[number]) => [x.id, x.role, x.polity, x.name, x.born, x.from, x.dynasty, x.parent, x.courtesy, (x.commands ?? []).filter((c) => c.from <= T).map((c) => [c.war, c.side, c.from])];
  const pa = a.people ?? [];
  expect((b.people ?? []).slice(0, pa.length).map(who), `${label} 人物`).toEqual(pa.map(who));
  // 州名:推到 T 时已经起了名的州
  const named = [...(a.regions.name ?? [])].map((n, r) => [r, n]).filter(([, n]) => n);
  expect(named.map(([r]) => [r, b.regions.name![r as number]]), `${label} 州名`).toEqual(named);
  expect(b.places.map((p) => [p.kind, p.name, p.culture]), `${label} 地名`).toEqual(a.places.map((p) => [p.kind, p.name, p.culture]));
  expect(routeSteps(b, T), `${label} 道路`).toEqual(routeSteps(a, T));
  const ra = a.religion!;
  const rb = b.religion!;
  const faith = (f: (typeof ra.faiths)[number]) => [f.id, f.kind, f.name, f.color, f.founded, f.founder?.name];
  expect(ra.faiths.map((f) => faith(rb.faiths[f.id])), `${label} 信仰`).toEqual(ra.faiths.map(faith));
  expect(rb.events.filter((e) => e.year <= T), `${label} 信仰史事`).toEqual(ra.events.filter((e) => e.year <= T));
  // 国教:T 以后才结束的,推到 T 时还没结束
  const state = (s: (typeof ra.states)[number]) => ({ ...s, until: s.until !== undefined && s.until <= T ? s.until : undefined });
  expect(rb.states.filter((s) => s.from <= T).map(state), `${label} 国教`).toEqual(ra.states.filter((s) => s.from <= T).map(state));
  expect(b.annals.filter((e) => e.year <= T), `${label} 史事`).toEqual(a.annals.filter((e) => e.year <= T));
}

describe('接着推不改过去', () => {
  it('推到第 1200 年、存档读回、接着推到第 3000 年:和一口气推完逐项一样(默认参数和自定义参数,seed 7 / 2024)', () => {
    for (const seed of SEEDS) {
      for (const params of [{}, CUSTOM]) {
        const w = world(seed);
        const whole = generateCiv(w, { ...params, endYear: 3000 });
        const saved = unpackValue(packValue(generateCiv(w, { ...params, endYear: 1200 }))) as Civ;
        const cont = continueCiv(w, saved, { ...params, endYear: 3000 });
        const label = `seed ${seed} ${JSON.stringify(params)}`;
        for (const k of Object.keys(whole) as (keyof Civ)[]) expect(cont[k], `${label} ${k}`).toEqual(whole[k]);
        expect(Object.keys(cont).sort(), label).toEqual(Object.keys(whole).sort());
      }
    }
  }, 240_000);

  it('推到第 800、1600、2400 年和推到第 3000 年:早先已经有的民族、城、国家、人物、地名、道路、信仰都一样', () => {
    for (const seed of SEEDS) {
      for (const params of [{}, CUSTOM]) {
        const w = world(seed);
        const full = generateCiv(w, { ...params, endYear: 3000 });
        for (const T of [800, 1600, 2400]) samePast(generateCiv(w, { ...params, endYear: T }), full, T, `seed ${seed} ${JSON.stringify(params)} T ${T}`);
      }
    }
  }, 400_000);

  it('作者在第 2000 年立国时起的国名和早先某国的国名撞了:推到第 1200 年和推到第 3000 年,早先那国的国名一样', () => {
    for (const seed of SEEDS) {
      const w = world(seed);
      const civ = generateCiv(w, { endYear: 1200 });
      const roots = new Set(civ.cultures.map((c) => c.name));
      const early = civ.polities.find((p) => !roots.has(p.name))!;
      const town = civ.settlements.find((s) => s.founded < 1200 && !civ.polities.some((p) => p.capital === s.id))!;
      const v: Intervention = { kind: 'found', region: regionKey(civ, town.region), from: 2000, name: early.name };
      const a = generateCiv(w, { endYear: 1200, interventions: [v] });
      const b = generateCiv(w, { endYear: 3000, interventions: [v] });
      expect(b.annals.some((e) => e.kind === 'intervene' && e.a >= 0), `seed ${seed} 立国`).toBe(true);
      samePast(a, b, 1200, `seed ${seed} 立国起名`);
      expect(continueCiv(w, unpackValue(packValue(a)) as Civ, { endYear: 3000, interventions: [v] }).polities).toEqual(b.polities);
    }
  }, 240_000);
});

/**
 * 两条干预:让他掌权(regent)、为他联姻(marry)—— 推演里生效、人物和编年史挂得上、下令以前的历史不变、
 * 从哪一刻接着推都和一口气推完一样;对不上的人不生效(写原因)。没下这两种干预的世界不受影响由 determinism.test.ts 的指纹管着
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import type { Person } from '../src/gen/civ/types';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { heirBornOf, holderAt } from '../src/gen/civ/story/regentInfo';
import { IV_NOT_HIM } from '../src/gen/civ/rulers';
import { cleanIntervention, personKey, polityKey, resolvePersonKey, type Intervention } from '../src/gen/edits';

const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
}
const bases = new Map<number, Civ>();
function baseOf(seed: number): Civ {
  let c = bases.get(seed);
  if (!c) bases.set(seed, (c = generateCiv(world(seed))));
  return c;
}

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}
/** 下令那一年以前的史事一样 */
const before = (civ: Civ, T: number) => civ.annals.filter((e) => e.year < T);

const rulersOf = (civ: Civ) => (civ.people ?? []).filter((x) => x.role === 'ruler' && x.author === undefined && civ.polities[x.polity]?.lineage !== 'republic');
const free = (civ: Civ, pid: number, T: number, n: number) => {
  for (let t = T; t <= T + n; t++) if (holderAt(civ, pid, t)) return false;
  return true;
};

/** 君主 N 和接着即位的太子 H(他的儿子),T = H 满 17 岁、N 在位、那几年没人掌权的一年 */
function heirCase(civ: Civ): { N: Person; H: Person; T: number } | null {
  const rs = rulersOf(civ);
  for (const N of rs) {
    if ((N.from ?? 0) < 700 || N.until === undefined) continue;
    const H = rs.find((x) => x.polity === N.polity && x.parent === N.id && x.rise === 'heir' && x.from === N.until);
    if (!H) continue;
    const T = Math.ceil(Math.max(N.from!, H.born + 17)) + 1;
    if (T + 6 < N.until && free(civ, N.polity, T, 6)) return { N, H, T };
  }
  return null;
}

/** 君主 N 和他在世、成年的兄弟 U(同一朝,没即位),T = N 即位后一两年 */
function uncleCase(civ: Civ): { N: Person; U: Person; T: number } | null {
  const ps = civ.people ?? [];
  for (const N of rulersOf(civ)) {
    if ((N.from ?? 0) < 700 || N.until === undefined || N.parent === undefined) continue;
    const T = Math.ceil(N.from!) + 1;
    const U = ps.find((x) => x.role === 'prince' && x.parent === N.parent && x !== N && (x.dynasty ?? 0) === (N.dynasty ?? 0) && x.born + 18 <= T && (x.died ?? Infinity) > T + 6);
    if (U && T + 6 < N.until && free(civ, N.polity, T, 6)) return { N, U, T };
  }
  return null;
}

/** 在朝的名臣 M,T = 他入仕后一年、君主不是作者立的、那几年没人掌权 */
function ministerCase(civ: Civ): { M: Person; T: number } | null {
  for (const M of civ.people ?? []) {
    if (M.role !== 'minister' || (M.from ?? 0) < 700 || civ.polities[M.polity]?.lineage === 'republic') continue;
    const T = Math.ceil(M.from!) + 1;
    const R = rulersOf(civ).find((r) => r.polity === M.polity && (r.from ?? Infinity) < T && (r.until ?? Infinity) > T + 6);
    if (R && (M.until ?? Infinity) > T + 6 && (M.died ?? Infinity) > T + 6 && free(civ, M.polity, T, 6)) return { M, T };
  }
  return null;
}

const regent = (civ: Civ, x: Person, T: number, how: 'march' | 'heir' | 'uncle' | 'chancellor', end: 'succeed' | 'return' | 'usurp', years?: number): Intervention =>
  cleanIntervention({ kind: 'regent', a: polityKey(civ, x.polity), person: personKey(civ, x.id), from: T, how, end, ...(years ? { years } : {}), ...(how === 'uncle' || how === 'chancellor' ? { leanings: { expand: 60, war: 85, develop: 40, trade: 30 } } : {}) })!;

/** 干预那一条史事(intervene,war = 第几条干预) */
const ivAnnal = (civ: Civ, i = 0) => civ.annals.find((e) => e.kind === 'intervene' && e.war === i)!;
/** 按人物键找回这个人 */
const again = (civ: Civ, base: Civ, x: Person) => civ.people![resolvePersonKey(civ, personKey(base, x.id))];

for (const seed of [7, 2024]) {
  describe(`让他掌权 · seed=${seed}`, () => {
    it('太子引兵入朝、到父亲去世即位:那一刻起他掌权,下令以前的历史不变;编年史先写【干预】再写掌权', () => {
      const base = baseOf(seed);
      const c = heirCase(base)!;
      expect(c).not.toBeNull();
      const v = regent(base, c.H, c.T, 'march', 'succeed');
      const civ = generateCiv(world(seed), { interventions: [v], endYear: c.T + 20 });
      expect(before(civ, c.T)).toEqual(before(generateCiv(world(seed), { endYear: c.T + 20 }), c.T));
      expect(ivAnnal(civ).b).toBe(-1);
      const H = again(civ, base, c.H);
      expect(H.regencies?.some((g) => g.kind === 'march' && g.from === c.T)).toBe(true);
      expect(holderAt(civ, H.polity, c.T + 0.5)?.x).toBe(H);
      const lines = buildChronicle(civ).filter((e) => e.year === c.T && e.polities.includes(H.polity));
      expect(lines.some((e) => e.text.startsWith('【干预】令'))).toBe(true);
      expect(lines.some((e) => e.kind === 'regent' && /还朝|回到都城/.test(e.text))).toBe(true);
    }, 120_000);

    it('太子监国、几年后篡位:父亲那一刻被废,他接着在位(和做太子时是同一人);从哪一刻接着推都和一口气推完一样', () => {
      const w = world(seed);
      const base = baseOf(seed);
      const c = heirCase(base)!;
      const v = regent(base, c.H, c.T, 'heir', 'usurp', 3);
      const full = generateCiv(w, { interventions: [v], endYear: c.T + 15 });
      const H = again(full, base, c.H);
      const N = full.people!.find((x) => x.role === 'ruler' && x.polity === c.N.polity && x.from === c.N.from)!;
      expect(N.until).toBe(c.T + 3);
      expect(N.fate).toBe('deposed');
      expect(H.from).toBe(c.T + 3);
      expect(H.claim?.how).toBe('seize');
      expect(H.regencies?.find((g) => g.from === c.T)?.end).toBe('usurp');
      expect(buildChronicle(full).some((e) => e.kind === 'regent' && e.tag === '篡' && /逼.+退位/.test(e.text))).toBe(true);
      for (const from of [c.T, c.T + 1, c.T + 3, c.T + 4]) {
        const head = generateCiv(w, { interventions: [v], endYear: from });
        same(continueCiv(w, head, { interventions: [v], endYear: c.T + 15 }), full, `从 ${from} 接着推`);
      }
    }, 240_000);

    it('叔伯摄政几年后还政;名臣专权几年后还政:掌权的就是他本人', () => {
      const w = world(seed);
      const base = baseOf(seed);
      const u = uncleCase(base);
      if (u) {
        const civ = generateCiv(w, { interventions: [regent(base, u.U, u.T, 'uncle', 'return', 4)], endYear: u.T + 10 });
        expect(ivAnnal(civ).b).toBe(-1);
        const g = again(civ, base, u.U).regencies?.find((x) => x.from === u.T);
        expect(g?.kind).toBe('uncle');
        expect(g?.end).toBe('return');
        expect(g?.until).toBe(u.T + 4);
        expect(buildChronicle(civ).some((e) => e.kind === 'regent' && e.year === u.T && /摄政/.test(e.text))).toBe(true);
      }
      const m = ministerCase(base);
      if (m) {
        const civ = generateCiv(w, { interventions: [regent(base, m.M, m.T, 'chancellor', 'return', 5)], endYear: m.T + 10 });
        expect(ivAnnal(civ).b).toBe(-1);
        const g = again(civ, base, m.M)?.regencies?.find((x) => x.from === m.T);
        expect(g?.kind).toBe('chancellor');
        expect(g?.end).toBe('return');
      }
      expect(u || m).toBeTruthy();
    }, 120_000);

    it('还没推到君主下台(太子在人物里还是宗室)也认得出预定的继承人', () => {
      const base = baseOf(seed);
      const c = heirCase(base)!;
      expect(Math.round(heirBornOf(base, c.N)!)).toBe(Math.round(c.H.born));
      const short = generateCiv(world(seed), { endYear: c.T + 1 });
      const N = short.people!.find((x) => x.role === 'ruler' && x.polity === c.N.polity && x.from === c.N.from)!;
      const H = short.people!.find((x) => x.parent === N.id && Math.round(x.born) === Math.round(c.H.born))!;
      expect(H.role).toBe('prince');
      expect(Math.round(heirBornOf(short, N)!)).toBe(Math.round(H.born));
    }, 120_000);

    it('将领专权:那一刻起交出兵权,不再挂帅', () => {
      const w = world(seed);
      const base = baseOf(seed);
      let hit = false;
      for (const G of (base.people ?? []).filter((x) => x.role === 'general' && (x.commands?.length ?? 0) > 1 && x.commands![0].from > 700)) {
        const T = Math.ceil(G.commands![0].until) + 1;
        if (!(G.commands!.some((c) => c.from > T)) || (G.died ?? Infinity) < T + 6 || !free(base, G.polity, T, 6)) continue;
        const R = rulersOf(base).find((r) => r.polity === G.polity && (r.from ?? Infinity) < T && (r.until ?? Infinity) > T + 6);
        if (!R) continue;
        const v = cleanIntervention({ kind: 'regent', a: polityKey(base, G.polity), person: personKey(base, G.id), from: T, how: 'general', end: 'return', years: 4, leanings: { expand: 50, war: 70, develop: 50, trade: 50 } })!;
        const civ = generateCiv(w, { interventions: [v], endYear: T + 20 });
        if (ivAnnal(civ).b !== -1) continue;
        const H = again(civ, base, G);
        expect(H.regencies?.find((g) => g.from === T)?.kind).toBe('general');
        expect(H.commands!.every((c) => c.from < T)).toBe(true);
        hit = true;
        break;
      }
      expect(hit).toBe(true);
    }, 180_000);

    it('不是太子的人引兵入朝:不生效(写原因),历史和不下一样', () => {
      const w = world(seed);
      const base = baseOf(seed);
      const c = heirCase(base)!;
      // 君主本人不是他自己的预定继承人
      const v = regent(base, c.N, c.T, 'march', 'succeed');
      const civ = generateCiv(w, { interventions: [v], endYear: c.T + 20 });
      expect(ivAnnal(civ).b).toBe(IV_NOT_HIM);
      const plain = generateCiv(w, { endYear: c.T + 20 });
      expect(civ.annals.filter((e) => e.kind !== 'intervene')).toEqual(plain.annals);
      expect(buildChronicle(civ).find((e) => e.kind === 'intervene')?.text).toMatch(/^【干预】欲令.+未成$/);
    }, 120_000);
  });

  describe(`为他联姻 · seed=${seed}`, () => {
    it('太子娶别国宗室女(互嫁):两国各记一门亲,人物卡上有配偶;从哪一刻接着推都一样', () => {
      const w = world(seed);
      const base = baseOf(seed);
      const c = heirCase(base)!;
      // 和这一年还在、不是共和国的别国试几回(正在交战、对方君主没有成年女儿的不生效)
      const others = base.polities.filter((p) => p.id !== c.H.polity && p.lineage !== 'republic' && p.founded < c.T - 50 && (p.ended ?? Infinity) > c.T + 20);
      let done: { civ: Civ; v: Intervention; q: number } | null = null;
      for (const Q of others.slice(0, 12)) {
        const v = cleanIntervention({ kind: 'marry', a: polityKey(base, c.H.polity), person: personKey(base, c.H.id), b: polityKey(base, Q.id), from: c.T, how: 'mutual' })!;
        const civ = generateCiv(w, { interventions: [v], endYear: c.T + 12 });
        if (ivAnnal(civ).b >= 0) {
          done = { civ, v, q: Q.id };
          break;
        }
        expect(ivAnnal(civ).b).toBeLessThan(-1);
      }
      expect(done).not.toBeNull();
      const { civ, v, q } = done!;
      const H = again(civ, base, c.H);
      expect(H.spouses?.some((s) => s.polity === q && s.year === c.T)).toBe(true);
      expect(civ.people!.some((x) => x.polity === q && x.spouses?.some((s) => s.polity === H.polity && s.year === c.T))).toBe(true);
      expect(civ.annals.filter((e) => e.kind === 'marry' && e.year === c.T).length).toBe(2);
      for (const from of [c.T, c.T + 1]) {
        const head = generateCiv(w, { interventions: [v], endYear: from });
        same(continueCiv(w, head, { interventions: [v], endYear: c.T + 12 }), civ, `从 ${from} 接着推`);
      }
    }, 240_000);
  });
}

describe('清理', () => {
  const a = 'polity:c1#0';
  const p = (role: string) => `person:${a}|${role}|某某|1200`;
  it('怎么掌、到什么时候、他是谁对不上的不收;还政、篡位要年数;摄政、专权带倾向', () => {
    expect(cleanIntervention({ kind: 'regent', a, person: p('prince'), from: 1230, how: 'march', end: 'succeed' })).toEqual({ kind: 'regent', a, person: p('prince'), from: 1230, how: 'march', end: 'succeed' });
    expect(cleanIntervention({ kind: 'regent', a, person: p('minister'), from: 1230, how: 'march', end: 'succeed' })).toBeNull();
    expect(cleanIntervention({ kind: 'regent', a, person: p('prince'), from: 1230, how: 'uncle', end: 'succeed', leanings: {} })).toBeNull();
    expect(cleanIntervention({ kind: 'regent', a, person: p('general'), from: 1230, how: 'general', end: 'usurp', years: 3, leanings: {} })).toBeNull();
    expect(cleanIntervention({ kind: 'regent', a, person: p('prince'), from: 1230, how: 'heir', end: 'return' })).toBeNull();
    expect(cleanIntervention({ kind: 'regent', a, person: p('prince'), from: 1230, how: 'heir', end: 'return', years: 99 })).toMatchObject({ years: 40 });
    expect(cleanIntervention({ kind: 'regent', a, person: p('prince'), from: 1230, how: 'uncle', end: 'usurp', years: 2.4 })).toMatchObject({ years: 2, leanings: { expand: 50, war: 50, develop: 50, trade: 50 } });
    expect(cleanIntervention({ kind: 'marry', a, person: p('prince'), b: 'polity:c2#0', from: 1230, how: 'mutual' })).toEqual({ kind: 'marry', a, person: p('prince'), b: 'polity:c2#0', from: 1230, how: 'mutual' });
    expect(cleanIntervention({ kind: 'marry', a, person: p('prince'), b: a, from: 1230 })).toBeNull();
    expect(cleanIntervention({ kind: 'marry', a, person: p('minister'), b: 'polity:c2#0', from: 1230 })).toBeNull();
    expect(cleanIntervention({ kind: 'marry', a, person: p('ruler'), b: 'polity:c2#0', from: 1230, how: 'take' })).toEqual({ kind: 'marry', a, person: p('ruler'), b: 'polity:c2#0', from: 1230 });
  });
});

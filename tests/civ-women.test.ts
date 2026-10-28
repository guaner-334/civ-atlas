/**
 * 推演里的女性(gen/civ/women.ts):一部分君主、宗室、将领、名臣是女的,用女名;只换性别和名字,别的一样不改;
 * 接着往后推,先出道的人不变(日后娶了亲的除外)。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Person } from '../src/gen/civ/types';
import { splitSurname } from '../src/gen/civ/peopleText';
import { createPersonNamer } from '../src/gen/names/persons';

const worlds = new Map<number, ReturnType<typeof generateWorld>>();
const worldOf = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
};
const civs = new Map<number, Civ>();
const civOf = (seed: number) => {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(worldOf(seed))));
  return c;
};
const styleOf = (c: Civ, x: Person) => c.cultures[c.polities[x.polity].culture]?.style || 'kingdom';

describe('女名', () => {
  it('各语感的女名:东方用另一套字、带姓的不含姓;西幻三到六个字;同一个键同一个名字,和男名是两套', () => {
    for (const st of ['central', 'xianxia', 'frontier', 'mythic', 'imperial', 'kingdom', 'nordic', 'slavic', 'hellenic', 'desert', 'steppe', 'elven']) {
      const n = createPersonNamer(7, st);
      const names = Array.from({ length: 40 }, (_, i) => n.femaleGiven(3, i, 0));
      expect(names.map((_, i) => n.femaleGiven(3, i, 0))).toEqual(names);
      expect(new Set(names).size, st).toBeGreaterThan(20);
      for (const x of names) {
        const len = [...x].length;
        if (n.family === 'western') expect(len, `${st} ${x}`).toBeGreaterThanOrEqual(3);
        expect(len, `${st} ${x}`).toBeLessThanOrEqual(6);
        expect(x.startsWith('尔')).toBe(false);
      }
      const male = new Set(Array.from({ length: 40 }, (_, i) => n.given(3, i, 0)));
      expect(names.filter((x) => male.has(x)).length, st).toBeLessThan(5);
    }
    // 西幻女名的译字:娅、娜、莉、丽……
    const k = createPersonNamer(7, 'imperial');
    const all = Array.from({ length: 60 }, (_, i) => k.femaleGiven(1, i, 0)).join('');
    expect(all).toMatch(/[娅娜莉丽]/);
  });
});

describe.each([7, 2024])('推演里的女性 · seed=%i', (seed) => {
  it('君主、宗室、将领、名臣里都有女的;女的记着原来的男名,东方带姓的姓不变', () => {
    const c = civOf(seed);
    const P = c.people!;
    for (const role of ['ruler', 'prince', 'general', 'minister'] as const) {
      const all = P.filter((x) => x.role === role);
      const f = all.filter((x) => x.female);
      expect(f.length, role).toBeGreaterThan(0);
      // 每类都是少数(1–4 成)
      expect(f.length / all.length, role).toBeLessThan(0.45);
    }
    for (const x of P.filter((y) => y.female)) {
      expect(x.female).toBe(true);
      expect(x.maleName, x.name).toBeTruthy();
      expect(x.name).not.toBe(x.maleName);
      if (createPersonNamer(seed, styleOf(c, x)).surnamed && c.polities[x.polity].eastern) expect(splitSurname(x.name)).toBe(splitSurname(x.maleName!));
    }
    // 男的没有这两项
    for (const x of P.filter((y) => !y.female)) {
      expect('female' in x).toBe(false);
      expect(x.maleName).toBeUndefined();
    }
  });

  it('女君没有娶过宗室女;作者立的君主、摄政篡位的叔父不换', () => {
    const c = civOf(seed);
    for (const x of c.people!) {
      if (!x.female) continue;
      expect(x.spouses).toBeUndefined();
      expect(x.author).toBeUndefined();
      if (x.role === 'ruler') expect(x.claim?.how).not.toBe('seize');
      // 没即位的宗室:下面有后人、掌过权的照旧是男的(预定的继承人照君主的规矩,可以掌过权)
      if (x.role === 'prince' && !x.regencies?.some((g) => g.kind === 'march' || g.kind === 'heir')) {
        expect(c.people!.some((k) => k.parent === x.id), x.name).toBe(false);
        expect(x.regencies).toBeUndefined();
      }
    }
  });

  it('西幻同名的女王另编序数:"二世"前面有一位同名的女王', () => {
    const c = civOf(seed);
    const P = c.people!;
    for (const x of P) {
      if (x.role !== 'ruler' || !x.female || !x.title?.endsWith('世') || x.title === '一世') continue;
      const same = P.filter((y) => y.role === 'ruler' && y.polity === x.polity && y.name === x.name);
      expect(same.length, x.name).toBeGreaterThan(1);
      expect(same.every((y) => y.female)).toBe(true);
    }
  });

  it('接着往后推:先出道的人性别、名字不变(日后娶了亲的那几位除外)', () => {
    const w = worldOf(seed);
    const full = civOf(seed);
    let n = 0;
    for (const cut of [900, 1600]) {
      const part = generateCiv(w, { endYear: cut });
      for (const x of part.people!) {
        const y = full.people![x.id];
        expect(y.born).toBe(x.born);
        // 日后娶了亲的(女方出嫁还没做,她换回男的);据地自立、摄政篡位并成一人时本来就换了名字的
        if (y.spouses?.some((s) => s.year > cut) || (x.maleName ?? x.name) !== (y.maleName ?? y.name)) continue;
        expect(!!y.female, `${cut} ${x.name} → ${y.name}`).toBe(!!x.female);
        expect(y.name).toBe(x.name);
        n++;
      }
    }
    expect(n).toBeGreaterThan(500);
  }, 60_000);
});

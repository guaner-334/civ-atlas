/**
 * 名臣(gen/civ/officials.ts)和名臣、将领的字号、籍贯、官职、生平(officialText.ts):
 * 有大臣的国家都排得出名臣;年纪、在朝的年份说得通;官职一级级往上;经手的事在他在朝那几年;籍贯是那时本国的城;
 * 号不重;生平写得干净;作者干预某一年,之前已经去职的名臣、将领不变。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Person } from '../src/gen/civ/types';
import { polityTierAt } from '../src/gen/civ/growth';
import { deedLine, deedsShort, ministerRole, personArt, personBio } from '../src/gen/civ/officialText';
import { polityKey } from '../src/gen/edits';

const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
}
const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(world(seed))));
  return c;
}
const ministersOf = (civ: Civ) => (civ.people ?? []).filter((x) => x.role === 'minister');
const EPS = 1e-6;

describe.each([7, 2024])('名臣 · seed=%i', (seed) => {
  it('王国、帝国(和共和国)都排得出名臣;部落时期没有', () => {
    const civ = civOf(seed);
    const ms = ministersOf(civ);
    expect(ms.length).toBeGreaterThan(30);
    for (const p of civ.polities) {
      const mine = ms.filter((x) => x.polity === p.id);
      const end = p.ended ?? civ.endYear;
      // 当过 100 年以上的王国 / 帝国(或者是共和国)的,至少一位(没人在朝的空当最长 90 年才补人,立国晚的可能还没轮到)
      let staffed = 0;
      for (let y = p.founded; y < end; y += 1) if (p.lineage === 'republic' || polityTierAt(p, y) >= 1) staffed++;
      if (staffed >= 100) expect(mine.length, p.name).toBeGreaterThan(0);
      for (const x of mine) expect(p.lineage === 'republic' || polityTierAt(p, x.from!) >= 1, `${x.name}:入仕时${p.name}还是部落`).toBe(true);
    }
  });

  it('年纪、在朝的年份说得通;去职、卒年和结局对得上', () => {
    const civ = civOf(seed);
    for (const x of ministersOf(civ)) {
      const p = civ.polities[x.polity];
      const until = x.until ?? civ.endYear;
      expect(x.name.length, `${x.id}`).toBeGreaterThanOrEqual(2);
      expect(x.from! - x.born, `${x.name} 入仕的年纪`).toBeGreaterThanOrEqual(18);
      expect(x.from!, x.name).toBeGreaterThanOrEqual(p.founded - EPS);
      expect(until, x.name).toBeGreaterThan(x.from!);
      expect(until, x.name).toBeLessThanOrEqual((p.ended ?? civ.endYear) + EPS);
      if (x.died !== undefined) {
        expect(x.died, x.name).toBeGreaterThanOrEqual(until - EPS);
        expect(x.died - x.born, `${x.name} 寿数`).toBeLessThanOrEqual(90);
      }
      if (x.until === undefined) expect(x.fate, x.name).toBeUndefined();
      else expect(x.fate, x.name).toBeDefined();
      if (x.fate === 'died') expect(x.died, x.name).toBe(x.until);
      if (x.fate === 'fell') expect(x.died, x.name).toBe(x.until);
    }
  });

  it('官职:入仕那年授第一个官,往后一级级换,没有接连两个一样的', () => {
    const civ = civOf(seed);
    for (const x of ministersOf(civ)) {
      const ps = x.posts ?? [];
      expect(ps.length, x.name).toBeGreaterThan(0);
      expect(ps[0].from, x.name).toBe(x.from);
      for (let i = 1; i < ps.length; i++) {
        expect(ps[i].from, x.name).toBeGreaterThan(ps[i - 1].from);
        expect(ps[i].title, x.name).not.toBe(ps[i - 1].title);
      }
      expect(ps[ps.length - 1].from, x.name).toBeLessThanOrEqual((x.until ?? civ.endYear) + EPS);
      for (const post of ps) expect(post.title, x.name).toMatch(/^\S+$/);
      expect(ministerRole(civ, x), x.name).toMatch(/^\S+$/);
    }
  });

  it('经手的事:在他在朝那几年,一位最多三件;拥立、辅政、佐命、劝进的是本国的君主;辅政到他去职为止', () => {
    const civ = civOf(seed);
    const P = civ.people!;
    let n = 0;
    for (const x of ministersOf(civ)) {
      const ds = x.deeds ?? [];
      expect(ds.length, x.name).toBeLessThanOrEqual(3);
      for (const d of ds) {
        n++;
        expect(d.year, `${x.name} ${d.kind}`).toBeGreaterThanOrEqual(x.from! - EPS);
        expect(d.year, `${x.name} ${d.kind}`).toBeLessThanOrEqual((x.until ?? civ.endYear) + EPS);
        if (d.kind === 'found' || d.kind === 'regent' || d.kind === 'enthrone') {
          const r = P[d.person!];
          expect(r?.role, `${x.name} ${d.kind}`).toBe('ruler');
          expect(r.polity, `${x.name} ${d.kind}`).toBe(x.polity);
        }
        if (d.kind === 'regent') expect(d.until!, x.name).toBeLessThanOrEqual((x.until ?? civ.endYear) + EPS);
        if (d.annal !== undefined) expect(civ.annals[d.annal], x.name).toBeDefined();
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it('籍贯是入仕(第一次领兵)那年已经有的城;号不和别人重;字不用名里的字', () => {
    const civ = civOf(seed);
    const people = (civ.people ?? []).filter((x) => x.role === 'minister' || (x.role === 'general' && x.commands?.length));
    const arts = new Set<string>();
    for (const x of people) {
      const t = x.role === 'minister' ? x.from! : x.commands![0].from;
      const s = civ.settlements[x.home!];
      expect(s, `${x.name} 籍贯`).toBeDefined();
      expect(s.founded, `${x.name} 籍贯`).toBeLessThanOrEqual(t + EPS);
      const art = personArt(civ, x);
      if (art) {
        expect(arts.has(art), `${x.name} 号 ${art}`).toBe(false);
        arts.add(art);
      }
      if (x.courtesy) {
        expect(x.courtesy, x.name).toMatch(/^\S{2}$/);
        for (const ch of x.courtesy) expect(x.name.includes(ch), `${x.name} 字${x.courtesy}`).toBe(false);
      }
    }
    expect(arts.size).toBeGreaterThan(5);
  });

  it('将领的官职:第一次领兵那年授第一个官,打赢了往上升', () => {
    const civ = civOf(seed);
    const gens = (civ.people ?? []).filter((x) => x.role === 'general' && x.commands?.length);
    let promoted = 0;
    for (const g of gens) {
      const ps = g.posts ?? [];
      expect(ps.length, g.name).toBeGreaterThan(0);
      expect(ps[0].from, g.name).toBe(g.commands![0].from);
      for (let i = 1; i < ps.length; i++) expect(ps[i].from, g.name).toBeGreaterThanOrEqual(ps[i - 1].from);
      if (ps.length > 1) promoted++;
    }
    expect(promoted).toBeGreaterThan(0);
  });

  it('生平:名臣、将领都有,开头是名字,句号收尾,没有缺字', () => {
    const civ = civOf(seed);
    const people = (civ.people ?? []).filter((x) => x.role === 'minister' || (x.role === 'general' && x.commands?.length));
    for (const x of people) {
      const bio = personBio(civ, x);
      expect(bio.startsWith(x.name), x.name).toBe(true);
      expect(bio.endsWith('。'), bio).toBe(true);
      expect(bio, x.name).not.toMatch(/undefined|NaN|null|\s{2}|。。|，。|^，/);
      if (x.role === 'minister') {
        expect(deedLine(civ, x), x.name).not.toMatch(/undefined|NaN/);
        if (x.deeds?.length) expect(deedsShort(civ, x).length, x.name).toBeGreaterThan(2);
      }
    }
    // 君主、宗室没有生平这一段
    const r = civ.people!.find((x) => x.role === 'ruler')!;
    expect(personBio(civ, r)).toBe('');
  });
});

describe('名臣 · 稳定', () => {
  it('同一个种子两次生成,名臣一模一样', () => {
    const a = ministersOf(civOf(7));
    const b = ministersOf(generateCiv(world(7)));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('干预某一年:那年以前入仕、领兵的名臣、将领还是那几位,名字不变;那年以前已经去职的,字号、籍贯、官职、经手的事、结局也和不干预时一样', () => {
    const civ = civOf(7);
    const y0 = 1900;
    const alive = civ.polities.filter((p) => p.founded < y0 && (p.ended ?? Infinity) > y0);
    expect(alive.length).toBeGreaterThan(1);
    const c = generateCiv(world(7), { interventions: [{ kind: 'declare', a: polityKey(civ, alive[0].id), b: polityKey(civ, alive[1].id), from: y0 }] });
    // 编号会变(干预以后的君主多了少了),经手的事里的人按名字比
    const who = (x: Civ, id: number | undefined) => (id !== undefined ? x.people![id]?.name : undefined);
    const shot = (x: Civ) =>
      (x.people ?? [])
        .filter((p) => (p.role === 'minister' ? p.until !== undefined && p.until < y0 : p.role === 'general' && p.commands!.length > 0 && p.commands![p.commands!.length - 1].until < y0 && (p.died ?? Infinity) < y0))
        .map((p) => [p.role, p.polity, p.name, p.born, p.from, p.until, p.died, p.fate, p.courtesy, p.art, p.home, p.posts, (p.deeds ?? []).map((d) => ({ ...d, person: who(x, d.person) }))])
        .sort((a, b) => (a[3] as number) - (b[3] as number) || String(a[2]).localeCompare(String(b[2])));
    const before = shot(civ);
    expect(before.length).toBeGreaterThan(20);
    expect(JSON.stringify(shot(c))).toBe(JSON.stringify(before));
    // 那年以前入仕(第一次领兵)的,一个不多、一个不少,名字、生年不变
    const entered = (x: Civ) =>
      JSON.stringify(
        (x.people ?? [])
          .filter((p) => (p.role === 'minister' ? p.from! < y0 : p.role === 'general' && p.commands!.length > 0 && p.commands![0].from < y0))
          .map((p) => [p.role, p.polity, p.name, p.born, p.role === 'minister' ? p.from : p.commands![0].from])
          .sort(),
      );
    expect(entered(c)).toBe(entered(civ));
  });
});

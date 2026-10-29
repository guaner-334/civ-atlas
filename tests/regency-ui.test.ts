/**
 * 掌实权、联姻在卡片、世系图、编年史上的整理(gen/civ/regentInfo.ts、lineageInfo.ts 的小灰字、编年史的类型名)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { buildChronicle, reignEntries } from '../src/gen/civ/chronicle';
import { brideName, heldOver, holderAt, inLawsAt, kinAt, polityShort } from '../src/gen/civ/regentInfo';
import { lineageKin, lineageTag } from '../src/gen/civ/lineageInfo';
import { evLabel } from '../src/ui/timelineLayout';

const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed }))));
  return c;
}
const SEEDS = [7, 2024];

describe('谁掌着实权、谁被架空', () => {
  it('掌权的那几年 holderAt 找得到他;名义君主被架空过;世系图写「掌权」「虚位」', () => {
    let n = 0;
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      for (const x of civ.people ?? []) {
        for (const g of x.regencies ?? []) {
          n++;
          const mid = g.until !== undefined ? (g.from + g.until) / 2 : g.from + 0.01;
          expect(holderAt(civ, x.polity, mid)?.x, `${x.name} ${g.kind} ${g.from}`).toBe(x);
          if (g.until !== undefined) expect(holderAt(civ, x.polity, g.until)?.x).not.toBe(x);
          expect(lineageTag(civ, x, x.polity)).toContain('掌权');
          const N = civ.people![g.ruler];
          if (!N) continue;
          expect(heldOver(civ, N).some((h) => h.x === x)).toBe(true);
          // 幼主有人辅政、太子监国不算虚位
          if (['march', 'chancellor', 'general'].includes(g.kind)) expect(lineageTag(civ, N, N.polity)).toContain('虚位');
        }
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it('没掌过权、没被架空过的不写', () => {
    const civ = civOf(7);
    const plain = (civ.people ?? []).filter((x) => x.role === 'ruler' && !x.regencies && !heldOver(civ, x).length).slice(0, 50);
    for (const x of plain) expect(lineageTag(civ, x, x.polity)).not.toMatch(/掌权|虚位/);
  });
});

describe('联姻', () => {
  it('结亲那一年两国就是姻亲;KIN_FADE 年以后、或开过战就不是了', () => {
    let n = 0;
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      civ.annals.forEach((e, i) => {
        if (e.kind !== 'marry') return;
        n++;
        // 同一刻互嫁的另一门:两条都算
        const k = kinAt(civ, e.a, e.b, e.year);
        expect(civ.annals[k]?.kind).toBe('marry');
        expect(Math.abs(civ.annals[k].year - e.year)).toBeLessThan(1e-9);
        expect(inLawsAt(civ, e.a, e.year).some((v) => v.polity === e.b)).toBe(civ.polities[e.b].ended === undefined || civ.polities[e.b].ended! > e.year);
        expect(kinAt(civ, e.a, e.b, e.year + 40)).not.toBe(i);
        // 那以后开过战:姻亲就断了
        const war = civ.annals.find((w, j) => j > i && w.kind === 'war' && ((w.a === e.a && w.b === e.b) || (w.a === e.b && w.b === e.a)));
        if (war && war.year - e.year < 40) expect(kinAt(civ, e.a, e.b, war.year)).toBe(-1);
      });
    }
    expect(n).toBeGreaterThan(10);
  });

  it('配偶、母亲那一行、世系图小标:有名字、有国名', () => {
    let n = 0;
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      for (const x of civ.people ?? []) {
        for (const s of [...(x.spouses ?? []), ...(x.mother ? [x.mother] : [])]) {
          n++;
          expect(brideName(civ, s)).toMatch(/^.+(氏|公主)$/);
          expect(polityShort(civ, s.polity, s.year)).not.toBe('');
        }
        const k = lineageKin(civ, x);
        // 女的结了亲:配偶是对方的宗室子,写"夫某国"
        if (x.spouses?.length) expect(k?.text).toMatch(x.female ? /^夫./ : /^妻./);
        else if (x.mother) expect(k?.text).toMatch(/^母./);
        else expect(k).toBeNull();
      }
    }
    expect(n).toBeGreaterThan(10);
  });

  it('编年史:结盟时两国还结着亲的写"(两国本为姻亲)"', () => {
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      for (const e of buildChronicle(civ)) {
        if (e.kind !== 'alliance') continue;
        const a = civ.annals[e.id];
        expect(e.text.endsWith('(两国本为姻亲)'), e.text).toBe(kinAt(civ, a.a, a.b, a.year, true) >= 0);
      }
    }
  });
});

describe('编年史的类型名', () => {
  it('掌权、还政、伏诛、篡位、亲政、结亲都有自己的名字(不是"纪事")', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      for (const e of [...buildChronicle(civ), ...reignEntries(civ)]) {
        if (e.kind === 'regent' || e.kind === 'marry') {
          const l = evLabel(e);
          expect(['掌权', '还政', '伏诛', '篡位', '亲政', '结亲']).toContain(l);
          seen.add(l);
        }
        if (e.kind === 'dynasty' && e.tag === '篡') seen.add('篡位(改朝)');
      }
    }
    for (const l of ['掌权', '还政', '结亲']) expect(seen.has(l), l).toBe(true);
  });
});

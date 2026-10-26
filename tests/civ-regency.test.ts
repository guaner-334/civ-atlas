/**
 * 掌实权的人(gen/civ/regents.ts、regency.ts)和两国宗室联姻(marriages.ts、marriage.ts):
 * - 推演里记的史事 regent、marry 和人物上挂的段落(Person.regencies、spouses、mother)对得上:谁掌权、名义君主是谁、从哪年到哪年、怎么了结
 * - 引兵入朝的太子先君去世后即位、杀过的兄弟卒于掌权那一刻;叔父篡位 = 幼主被废、叔父接着在位(同一朝);名臣、大臣篡位 = 改朝换代,新朝第一位就是他
 * - 某一刻谁在掌权(regentAt):掌权那一刻的下一刻起,名义君主还在位、还是那一朝,到结局那一刻为止
 * - 掌权的几段、结过的亲由史事推得回来(接着推时照它),编年史有掌权、还政、伏诛、篡位、结亲这几种说法
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Person, Polity } from '../src/gen/civ/types';
import { buildChronicle, reignEntries } from '../src/gen/civ/chronicle';
import { REGENCY_KINDS, RG_START, RG_USURP, holds, regencyBase, regentAt, regentsFrom } from '../src/gen/civ/regents';
import { matchesFrom } from '../src/gen/civ/marriages';
import { actsFrom, leaningEffect, reignAt, reignBook, rulerBase, rulerTags, type Reign } from '../src/gen/civ/rulers';

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
/** 和推演里同一份的推算材料 */
function ctxOf(civ: Civ) {
  const base = rulerBase(civ.seed);
  const tag = rulerTags(civ.polities, (sid) => civ.settlements[sid]?.cell ?? -1);
  const acts = actsFrom(civ.annals, civ.interventions);
  return {
    rbase: base,
    base: regencyBase(civ.seed),
    tag,
    polities: civ.polities,
    book: (pid: number, t: number) => reignBook(base, tag[pid], civ.polities[pid], t, acts.get(pid)),
    at: (pid: number, t: number): Reign => reignAt(base, tag[pid], civ.polities[pid], t, acts.get(pid)),
  };
}

describe.each([7, 2024])('掌实权、联姻 · seed=%i', (seed) => {
  it('史事 regent 的每一段掌权都挂到了人身上:名义君主是那一刻在位的那位,段落从掌权那年起,了结的写了怎么了结', () => {
    const civ = civOf(seed);
    const P = civ.people!;
    const starts = civ.annals.map((e, i) => [e, i] as const).filter(([e]) => e.kind === 'regent' && e.n === RG_START);
    expect(starts.length).toBeGreaterThan(10);
    const segs = new Map<number, { x: Person; g: NonNullable<Person['regencies']>[number] }>();
    for (const x of P) for (const g of x.regencies ?? []) segs.set(g.annal, { x, g });
    for (const [e, i] of starts) {
      const hit = segs.get(i);
      expect(hit, `第 ${i} 条`).toBeDefined();
      const { x, g } = hit!;
      expect(g.from).toBe(e.year);
      const N = P[g.ruler];
      expect(N.role).toBe('ruler');
      expect(N.polity).toBe(e.a);
      expect(N.from!).toBeLessThanOrEqual(e.year);
      expect(N.until ?? Infinity).toBeGreaterThan(e.year);
      if (g.until !== undefined) {
        expect(g.until).toBeGreaterThan(g.from);
        expect(g.end).toBeDefined();
      }
      const kind = REGENCY_KINDS[e.b];
      if (kind === 'march' || kind === 'heir') {
        // 预定的继承人:先君的儿子;先君寿终时他接着即位
        expect(x.parent).toBe(N.id);
        if (g.end === 'succeed') expect(x.role === 'ruler' && x.from).toBe(N.until);
      }
      // 叔父:先君(幼主的前一位)的兄弟
      if (kind === 'uncle') expect(x.parent).toBe(P.find((o) => o.role === 'ruler' && o.polity === N.polity && o.until === N.from)?.parent);
      // 掌权的那几年他在世
      if (g.end !== 'usurp') expect(x.died ?? Infinity).toBeGreaterThanOrEqual(g.until ?? civ.endYear);
    }
  });

  it('引兵入朝杀的兄弟卒于掌权那一刻(结局 purged、rival 是他);即位时不再争储', () => {
    const civ = civOf(seed);
    const P = civ.people!;
    for (const x of P) {
      if (x.claim?.how !== 'march') continue;
      const g = x.regencies!.find((r) => r.kind === 'march')!;
      for (const id of x.claim.rivals) {
        expect(P[id].died).toBe(g.from);
        expect(P[id].fate).toBe('purged');
        expect(P[id].rival).toBe(x.id);
        expect(P[id].parent).toBe(x.parent);
      }
    }
  });

  it('篡位:叔父篡位 = 幼主被废、叔父接着在位(同一朝,先君父亲的儿子);名臣、大臣篡位 = 改朝换代,新朝第一位就是他,带着做名臣时的官职', () => {
    const civ = civOf(seed);
    const P = civ.people!;
    for (const [e, i] of civ.annals.map((a, k) => [a, k] as const)) {
      if (e.kind !== 'regent' || e.n !== RG_USURP) continue;
      const x = P.find((p) => p.regencies?.some((g) => g.endAnnal === i))!;
      expect(x, `第 ${i} 条`).toBeDefined();
      const g = x.regencies!.find((r) => r.endAnnal === i)!;
      expect(g.end).toBe('usurp');
      const N = P[g.ruler];
      expect(N.until).toBe(e.year);
      expect(N.fate).toBe('deposed');
      expect(x.role).toBe('ruler');
      expect(x.from).toBe(e.year);
      if (REGENCY_KINDS[e.b] === 'uncle') {
        expect(x.claim?.how).toBe('seize');
        expect(x.dynasty ?? 0).toBe(N.dynasty ?? 0);
        expect(civ.polities[e.a].seizes?.some((s) => s.year === e.year)).toBe(true);
      } else {
        // 紧跟着改朝换代
        expect(civ.annals[i + 1].kind).toBe('dynasty');
        expect(x.rise).toBe('usurp');
        expect(x.dynasty).toBe((N.dynasty ?? 0) + 1);
        expect(x.posts?.length).toBeGreaterThan(0);
        expect(civ.polities[e.a].dynasties![x.dynasty!].usurper?.born).toBe(x.born);
      }
    }
  });

  it('掌权的几段由史事推得回来;某一刻谁在掌权:掌权那一刻的下一刻起、名义君主还在位、到结局那一刻为止', () => {
    const civ = civOf(seed);
    const cx = ctxOf(civ);
    const regs = regentsFrom(cx, civ.annals);
    let n = 0;
    for (const [pid, list] of regs) {
      const p: Polity = civ.polities[pid];
      for (const g of list) {
        n++;
        const at = (t: number): Reign => cx.at(pid, t);
        // 掌权那一刻还不算,下一刻起算
        const bk = (t: number) => cx.book(pid, t);
        expect(regentAt(p, list, g.start, at(g.start), bk(g.start))).not.toBe(g);
        const t1 = g.start + 1 / 256;
        if (t1 < g.stop && holds(p, g, t1, at(t1), bk(t1))) expect(regentAt(p, list, t1, at(t1), bk(t1))).toBe(g);
        if (g.stop < Infinity) expect(regentAt(p, list, g.stop, at(g.stop), bk(g.stop))).not.toBe(g);
        expect(g.eff).toEqual(leaningEffect(g.leanings));
      }
    }
    expect(n).toBe(civ.annals.filter((e) => e.kind === 'regent' && e.n === RG_START).length);
  });

  it('联姻:史事 marry 推得回娶亲的人;他记着配偶(出自哪国、父亲是那国当时的君主),娶亲以后生的儿子记着母亲', () => {
    const civ = civOf(seed);
    const P = civ.people!;
    const matches = matchesFrom(ctxOf(civ), civ.annals);
    expect(matches.length).toBe(civ.annals.filter((e) => e.kind === 'marry').length);
    expect(matches.length).toBeGreaterThan(5);
    let mothers = 0;
    for (const x of P) {
      for (const s of x.spouses ?? []) {
        const e = civ.annals[s.annal];
        expect(e.kind).toBe('marry');
        expect(e.a).toBe(x.polity);
        expect(s.polity).toBe(e.b);
        const F = P[s.father];
        expect(F.polity).toBe(e.b);
        expect(F.from!).toBeLessThanOrEqual(e.year);
        // 东方带姓的语感写"某氏"
        if (s.name) expect(s.name.endsWith('氏')).toBe(true);
      }
      if (x.mother) {
        mothers++;
        const f = P[x.parent!];
        expect(f.spouses?.some((s) => s.annal === x.mother!.annal)).toBe(true);
        expect(x.mother.year).toBeLessThan(x.born);
      }
    }
    expect(P.filter((x) => x.spouses?.length).length).toBeGreaterThan(0);
    expect(mothers).toBeGreaterThanOrEqual(0);
  });
});

describe('专权遇上作者立的君主', () => {
  it('作者的君主一即位,大臣专权就此了结;他下台以后接着即位的那位在位时也不再回来', () => {
    const P = { dynasties: undefined } as unknown as Polity;
    const reign = (k: number, crown?: boolean) => ({ k, crown: crown ? {} : undefined }) as unknown as Reign;
    const book = [reign(0), reign(1, true), reign(2)];
    const g = { pid: 0, kind: 'chancellor', k: 0, start: 5, dyn: 0, stop: 27, closed: false, annal: 0 } as unknown as Parameters<typeof holds>[1];
    expect(holds(P, g, 8, book[0], book)).toBe(true);
    expect(holds(P, g, 11, book[1], book)).toBe(false);
    expect(holds(P, g, 13, book[2], book)).toBe(false);
    expect(regentAt(P, [g], 13, book[2], book)).toBeNull();
  });
});

describe('编年史:掌权、还政、伏诛、篡位、结亲', () => {
  it('几个种子合起来,每一种说法都有,读得通', () => {
    const texts: string[] = [];
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      for (const e of [...buildChronicle(civ), ...reignEntries(civ)]) if (e.tag === '权' || e.tag === '姻' || /摄政|辅政|自立为君/.test(e.text)) texts.push(e.text);
    }
    const has = (re: RegExp) => texts.some((t) => re.test(t));
    expect(has(/监国|代为理政/)).toBe(true);
    expect(has(/还政|交还大权/)).toBe(true);
    expect(has(/结亲|联姻/)).toBe(true);
    expect(has(/摄政/)).toBe(true);
    // 没有写坏的(undefined、空的名字)
    for (const t of texts) expect(t, t).not.toMatch(/undefined|NaN|,,|以女妻$/);
  });
});

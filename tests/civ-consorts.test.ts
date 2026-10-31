/**
 * 后妃(gen/civ/consorts.ts):联姻嫁来的宗室女成了人物、名臣辅政的一部分换成太后临朝。
 * - 嫁来的宗室女:娶亲的是男的,每一门亲都有她;父亲、丈夫、生年对得上;她生的儿子记着母亲(生在她 16–45 岁之间)
 * - 太后:幼主的母亲(幼主生在她 16–45 岁之间),推演里那一段名臣辅政原样只是换了人;篡位的就是新朝第一位(女君)
 * - 编年史、人物卡写她的名字、"临朝称制";接着往后推,先出道的后妃不变
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { REGENCY_KINDS, RG_START } from '../src/gen/civ/regents';
import { buildChronicle, reignEntries } from '../src/gen/civ/story/chronicle';
import { dowagerSpans, dowagerWordOf, kinOf } from '../src/gen/civ/story/peopleText';
import { personCard } from '../src/ui/PersonPanel';
import { parsePersonKey, personKey, resolvePersonKey } from '../src/gen/edits';

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
const dowagers = (c: Civ) => c.people!.filter((x) => dowagerSpans(x).length);

describe.each([7, 2024])('后妃 · seed=%i', (seed) => {
  it('嫁来的宗室女:娶亲的是男的每一门亲都有她(女的、后妃);出自那国、父亲是那国当时的君主、丈夫是娶她的人;生年对得上', () => {
    const c = civOf(seed);
    const P = c.people!;
    let n = 0;
    for (const x of P) {
      for (const s of x.spouses ?? []) {
        if (x.female || x.author !== undefined) {
          expect(s.person).toBeUndefined();
          continue;
        }
        n++;
        const b = P[s.person!];
        expect(b, `${x.name} ${s.year}`).toBeDefined();
        expect(b.role).toBe('consort');
        expect(b.female).toBe(true);
        expect(b.husband).toBe(x.id);
        expect(b.polity).toBe(s.polity);
        if (s.father >= 0) {
          expect(b.parent).toBe(s.father);
          const F = P[s.father];
          expect(b.born - F.born).toBeGreaterThanOrEqual(16 - 1e-6);
          expect(b.born - F.born).toBeLessThanOrEqual(55 + 1e-6);
          expect(b.dynasty ?? 0).toBe(F.dynasty ?? 0);
        }
        expect(s.year - b.born).toBeGreaterThanOrEqual(14 - 1e-6);
        if (b.died !== undefined) {
          expect(b.died).toBeGreaterThan(s.year);
          expect(b.died).toBeLessThanOrEqual(c.endYear);
        }
        expect(b.name.length).toBeGreaterThanOrEqual(2);
      }
    }
    expect(n).toBeGreaterThan(5);
    // 后妃都是有丈夫的女的;不是嫁来的就是临朝的太后
    for (const x of P.filter((y) => y.role === 'consort')) {
      expect(x.female).toBe(true);
      const H = x.husband !== undefined ? P[x.husband] : undefined;
      const wed = !!H?.spouses?.some((s) => s.person === x.id);
      expect(wed || dowagerSpans(x).length > 0, x.name).toBe(true);
    }
  });

  it('母亲:生他时 16–45 岁、在世;嫁来的宗室女是父亲娶的、娶她以后出生', () => {
    const P = civOf(seed).people!;
    let n = 0;
    for (const x of P) {
      if (x.mom === undefined) continue;
      n++;
      const M = P[x.mom];
      expect(M.female).toBe(true);
      expect(x.born - M.born).toBeGreaterThanOrEqual(16 - 1e-6);
      expect(x.born - M.born).toBeLessThanOrEqual(45 + 1e-6);
      if (M.died !== undefined) expect(x.born).toBeLessThanOrEqual(M.died + 1e-6);
      expect(kinOf({ people: P } as Civ, x, M)).toBe('母');
      if (M.husband !== undefined && x.parent !== undefined) expect(M.husband).toBe(x.parent);
    }
    expect(n).toBeGreaterThan(5);
  });

  it('太后:幼主的母亲;推演里名臣辅政的每一段都有人掌着(名臣或太后,只一位);篡位的是新朝第一位(女君)', () => {
    const c = civOf(seed);
    const P = c.people!;
    const ds = dowagers(c);
    expect(ds.length).toBeGreaterThan(10);
    for (const x of ds) {
      expect(x.female).toBe(true);
      expect(x.role === 'consort' || (x.role === 'ruler' && x.rise === 'usurp')).toBe(true);
      for (const g of dowagerSpans(x)) {
        const N = P[g.ruler];
        expect(N.mom).toBe(x.id);
        expect(c.annals[g.annal].kind).toBe('regent');
        expect(REGENCY_KINDS[c.annals[g.annal].b]).toBe('minister');
        if (g.end === 'usurp') expect(x.role).toBe('ruler');
        if (g.end === 'purged') expect(x.died).toBe(g.until);
        else if (g.until !== undefined && x.died !== undefined) expect(x.died).toBeGreaterThanOrEqual(g.until);
      }
    }
    // 名臣辅政的每一段掌权(史事 regent,n = 0)都挂在一位人物身上
    const held = new Map<number, number>();
    for (const x of P) for (const g of x.regencies ?? []) held.set(g.annal, (held.get(g.annal) ?? 0) + 1);
    c.annals.forEach((e, i) => {
      if (e.kind !== 'regent' || (e.n ?? RG_START) !== RG_START || REGENCY_KINDS[e.b] !== 'minister') return;
      expect(held.get(i) ?? 0, `第 ${i} 条`).toBeLessThanOrEqual(1);
    });
  });

  it('编年史:幼主即位那一条写"太后某某临朝称制"(西幻"摄政");结亲写宗室女的名字、名字能点', () => {
    const c = civOf(seed);
    const P = c.people!;
    const reigns = reignEntries(c);
    let n = 0;
    for (const x of dowagers(c)) {
      const g = dowagerSpans(x)[0];
      const e = reigns.find((r) => r.people?.includes(g.ruler) && r.people.includes(x.id) && Math.abs(r.year - g.from) < 1e-6);
      if (!e) continue;
      n++;
      expect(e.text, e.text).toContain(`${dowagerWordOf(c, x, g.from)}${x.name}`);
      expect(e.text).toMatch(/临朝称制|摄政/);
    }
    expect(n).toBeGreaterThan(5);
    const chron = buildChronicle(c);
    let m = 0;
    for (const x of P) {
      for (const s of x.spouses ?? []) {
        if (s.person === undefined) continue;
        const e = chron.find((y) => y.kind === 'marry' && (y.id === s.annal || y.id === s.annal - 1) && y.people?.includes(s.person!));
        if (!e) continue;
        m++;
        expect(e.text, e.text).toContain(P[s.person].name);
      }
    }
    expect(m).toBeGreaterThan(3);
  });

  it('人物卡:太后有事迹、国家、出身、临朝、子嗣;嫁来的宗室女有国家(嫁入)、父亲、出嫁', () => {
    const c = civOf(seed);
    const P = c.people!;
    const d = dowagers(c).find((x) => x.role === 'consort' && x.husband !== undefined)!;
    const keys = personCard(c, d).lines.map((l) => l.k);
    for (const k of ['事迹', '国家', '生卒', '临朝', '配偶', '子嗣']) expect(keys, d.name).toContain(k);
    const b = P.find((x) => x.role === 'consort' && !dowagerSpans(x).length && x.parent !== undefined && P[x.husband!].polity !== x.polity)!;
    const lines = personCard(c, b).lines;
    for (const k of ['国家', '生卒', '父亲', '出嫁']) expect(lines.map((l) => l.k), b.name).toContain(k);
    expect(lines.find((l) => l.k === '国家')!.text).toContain('嫁入');
  });

  it('人物键认得后妃(改名、关注、作者人物的亲友都按它找人)', () => {
    const c = civOf(seed);
    const xs = c.people!.filter((x) => x.role === 'consort').slice(0, 20);
    expect(xs.length).toBeGreaterThan(5);
    for (const x of xs) {
      const k = personKey(c, x.id);
      expect(parsePersonKey(k)?.role, k).toBe('consort');
      expect(resolvePersonKey(c, k)).toBe(x.id);
    }
  });

  it('接着往后推:先出道的后妃名字、生年、丈夫不变', () => {
    const full = civOf(seed);
    // 以前停在第 1600 年;GENERATOR_VERSION 57(湿地)以后 seed 2024 到那年只出道 4 位后妃(种子 1–20 是 8–33 位),
    // 改停在第 2000 年(种子 1–20 是 11–47 位,2024 号 11 位)
    const part = generateCiv(worldOf(seed), { endYear: 2000 });
    let n = 0;
    for (const x of part.people!.filter((y) => y.role === 'consort')) {
      const y = full.people![x.id];
      expect(y.born).toBe(x.born);
      expect(y.name, `${x.name} → ${y.name}`).toBe(x.name);
      expect(y.husband).toBe(x.husband);
      n++;
    }
    expect(n).toBeGreaterThan(5);
  }, 60_000);
});


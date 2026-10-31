/**
 * 人物卡「治绩」(gen/civ/reignRecord.ts):君主每人都有疆域、人口、战事、钱粮四行,数照推演的结果取;
 * 国号、迁都、城、时代、首创、物产、天灾只列在位时真有的,一件一行、写上年份;在位不满 3 年的缩成一句;
 * 将领、名臣、宗室没有。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { Person } from '../src/gen/civ/types';
import { ownersAt } from '../src/gen/civ/timeline';
import { populationLabel, regionPopulationAt } from '../src/gen/civ/growth';
import { fillOf, fiscalAt, fiscalMood, warSpans } from '../src/gen/civ/fiscalBook';
import { SHORT_REIGN, reignFacts, reignRecord, reignRecordOf, reignText, type ReignFacts } from '../src/gen/civ/reignRecord';
import { yearShortAt, type Era } from '../src/gen/era';

const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed }))));
  return c;
}
const SEEDS = [7, 2024];
const rulersOf = (civ: Civ) => (civ.people ?? []).filter((x) => x.role === 'ruler' && x.from !== undefined);
const lenOf = (civ: Civ, x: Person) => (x.until ?? civ.endYear) - x.from!;
const EXTRA = ['国号', '迁都', '城', '时代', '首创', '物产', '天灾'];

/** 照推演的结果另算一遍:那一刻这国有哪几州 */
function regionsAt(civ: Civ, pid: number, y: number): number[] {
  const o = ownersAt(civ, Math.round(y * 4) / 4).polity;
  const out: number[] = [];
  for (let r = 0; r < o.length; r++) if (o[r] === pid) out.push(r);
  return out;
}

describe('治绩的四行', () => {
  it('每位君主都有疆域、人口、战事、钱粮,排在最前;数照州的归属、各州人口、打仗的起止、账本取', () => {
    let n = 0;
    let fiscal = 0;
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      const spans = warSpans(civ);
      for (const x of rulersOf(civ)) {
        const r = reignRecord(civ, x)!;
        expect(r, `${x.name}`).not.toBeNull();
        const f = r.facts;
        const from = x.from!;
        const until = x.until ?? civ.endYear;
        const edge = Math.min(0.3, (until - from) / 2);
        const a = from + edge;
        const b = Math.max(a, until - edge);
        n++;
        const ks = r.rows.map((row) => row.k);
        const base = f.fiscal ? ['疆域', '人口', '战事', '钱粮'] : ['疆域', '人口', '战事'];
        expect(ks.slice(0, base.length)).toEqual(base);
        for (const k of ks.slice(base.length)) expect(EXTRA).toContain(k);
        expect(new Set(ks).size).toBe(ks.length);

        // 疆域:即位时、末年几州;没变写"始终 N 州"
        const rs0 = regionsAt(civ, x.polity, a);
        const rs1 = regionsAt(civ, x.polity, b);
        expect(f.regions).toEqual([rs0.length, rs1.length]);
        expect(f.gained).toBe(rs1.filter((q) => !rs0.includes(q)).length);
        expect(f.lost).toBe(rs0.filter((q) => !rs1.includes(q)).length);
        expect(f.peak).toBeGreaterThanOrEqual(Math.max(...f.regions));
        expect(f.low).toBeLessThanOrEqual(Math.min(...f.regions));
        const terr = r.rows[0].lines.join('');
        if (f.gained || f.lost || rs0.length !== rs1.length) expect(terr).toBe(`${rs0.length} 州 → ${rs1.length} 州`);
        else expect(terr).toBe(`始终 ${rs0.length} 州`);

        // 人口:各州相加;差不到 1% 写"没大变化"
        const p0 = rs0.reduce((s, q) => s + regionPopulationAt(civ, q, a), 0);
        const p1 = rs1.reduce((s, q) => s + regionPopulationAt(civ, q, b), 0);
        expect(f.pop[0]).toBeCloseTo(p0, 6);
        expect(f.pop[1]).toBeCloseTo(p1, 6);
        const pop = r.rows[1];
        const w = (v: number) => populationLabel(v).replace(/^约 /, '').replace(/万人$/, '万');
        if (p0 > 0 && Math.round((Math.abs(p1 - p0) / p0) * 100) >= 1) {
          if (w(p0) === w(p1)) expect(pop).toEqual({ k: '人口', lines: [`约 ${w(p0)}`], note: '大致没变' });
          else {
            expect(pop.lines[0]).toBe(`约 ${w(p0)} → 约 ${w(p1)}`);
            expect(pop.note).toMatch(p1 >= p0 ? /^多了 \d+%$/ : /^少了 \d+%$/);
          }
        } else if (p0 > 0) expect(pop).toEqual({ k: '人口', lines: [`约 ${w(p0)}`], note: '没大变化' });

        // 战事:在位时一仗没打 = "没打过仗";打了的年数不超过在位的年数
        const fought = (spans.get(x.polity) ?? []).some((s) => Math.min(until, s.to) > Math.max(from, s.from));
        const war = r.rows[2];
        if (!fought) expect(f.warYears).toBe(0);
        if (f.warYears < 0.05) expect(war.lines[0]).toBe('没打过仗');
        else expect(war.lines[0]).toMatch(/^(不到 1|\d+) 年里打了(约 \d+ 年|不到 1 年)$/);
        expect(f.warYears).toBeLessThanOrEqual(f.len + 0.05);
        expect(f.longestPeace).toBeLessThanOrEqual(f.len + 0.05);
        expect(f.warYears + f.longestPeace).toBeLessThanOrEqual(f.len + 0.1);

        // 钱粮:账本里即位、末年都查得到才写;档位照那一刻最近的一行账;国用不足的那几年在他在位时
        const b0 = fiscalAt(civ, x.polity, a);
        const b1 = fiscalAt(civ, x.polity, b);
        expect(!!f.fiscal).toBe(!!(b0 && b1));
        if (f.fiscal && b0 && b1) {
          fiscal++;
          const mood = (v: typeof b0) => fiscalMood(fillOf(v.values.国库, v.values.应缴), v.values.窘迫);
          expect([f.fiscal.mood0, f.fiscal.mood1]).toEqual([mood(b0), mood(b1)]);
          const money = r.rows[3];
          expect(money.lines[0]).toMatch(/^(国库一直(充裕|尚可|拮据)|一直国用不足|国库从\S+到\S+|\d+ 年国用不足，末年\S+|\d+ 回国用不足（\d+ 年起），末年\S+)$/);
          expect(money.note).toMatch(/^岁入(约 \d+| \d+ → \d+) 万石$/);
          for (const y of f.fiscal.short) expect(y >= Math.floor(from) && y <= until).toBe(true);
        }
      }
    }
    expect(n).toBeGreaterThan(500);
    expect(fiscal).toBeGreaterThan(n * 0.8);
  });

  it('有才列的几行:都是他在位时的事,一件一行、写上年份,同一类按年份排;首创小字"世上第一"', () => {
    let rows = 0;
    const seenKinds = new Set<string>();
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      for (const x of rulersOf(civ)) {
        const r = reignRecord(civ, x)!;
        const from = x.from!;
        const until = x.until ?? civ.endYear;
        for (const e of r.facts.events) expect(e.year >= from - 1e-6 && e.year <= until + 1e-6, `${x.name} ${e.text}`).toBe(true);
        for (let i = 1; i < r.facts.events.length; i++) expect(r.facts.events[i].year).toBeGreaterThanOrEqual(r.facts.events[i - 1].year);
        for (const row of r.rows.filter((q) => EXTRA.includes(q.k))) {
          rows++;
          seenKinds.add(row.k);
          const evs = r.facts.events.filter((e) => e.kind === row.k);
          expect(row.lines.length).toBe(evs.length);
          row.lines.forEach((l, i) => {
            expect(l.startsWith(yearShortAt(evs[i].year))).toBe(true);
            expect(l).toContain(evs[i].text);
          });
          expect(row.note).toBe(row.k === '首创' ? '世上第一' : '');
          // 天灾:饥荒、瘟疫、疫后凋敝,地震水旱照震中分;并成一条的至少两座城
          if (row.k === '天灾')
            for (const l of row.lines) {
              expect(l).toMatch(/(饥荒|瘟疫|地震|大水|大旱|疫后凋敝)/);
              const m = /(\d+) 座城受灾/.exec(l);
              if (m) expect(Number(m[1])).toBeGreaterThanOrEqual(2);
            }
        }
        // 同一类的几行:按这一类头一件的先后
        const firsts = r.rows.filter((q) => EXTRA.includes(q.k)).map((q) => r.facts.events.find((e) => e.kind === q.k)!.year);
        for (let i = 1; i < firsts.length; i++) expect(firsts[i]).toBeGreaterThanOrEqual(firsts[i - 1]);
      }
    }
    expect(rows).toBeGreaterThan(100);
    for (const k of ['城', '时代', '物产', '天灾']) expect(seenKinds.has(k), k).toBe(true);
  });

  it('设了纪年:年份照纪年写', () => {
    const civ = civOf(7);
    const era: Era = { name: '利希历', epoch: 500 };
    const x = rulersOf(civ).find((q) => (reignFacts(civ, q)?.events.length ?? 0) > 0 && q.from! > 600)!;
    expect(x).toBeTruthy();
    const r = reignRecord(civ, x, era)!;
    const row = r.rows.find((q) => EXTRA.includes(q.k))!;
    const e = r.facts.events.find((q) => q.kind === row.k)!;
    expect(row.lines[0].startsWith(yearShortAt(e.year, era))).toBe(true);
    expect(row.lines[0].startsWith(yearShortAt(e.year))).toBe(false);
  });
});

describe('在位不满 3 年', () => {
  it('缩成一句:在位几年、几州、多少人、国库、打没打仗;够 3 年的没有这一句', () => {
    let short = 0;
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      for (const x of rulersOf(civ)) {
        const r = reignRecord(civ, x)!;
        if (lenOf(civ, x) >= SHORT_REIGN) {
          expect(r.short).toBeNull();
          continue;
        }
        short++;
        const f = r.facts;
        expect(r.short).toMatch(/^在位(不到一年| \d 年)，/);
        expect(r.short!.endsWith('。')).toBe(true);
        if (f.regions[0] === f.regions[1]) expect(r.short).toMatch(/，(国中没有变化：|疆域没变)/);
        else expect(r.short).toContain(`疆域从 ${f.regions[0]} 州到 ${f.regions[1]} 州`);
        expect(r.short).toMatch(f.warYears < 0.05 ? /，没打仗。$/ : /，打了(约 \d+ 年|不到 1 年)仗。$/);
        if (f.fiscal) expect(r.short).toMatch(/，(国库|国用不足|\d+ 年国用不足|\d+ 回国用不足)/);
        expect(r.short).not.toMatch(/undefined|null|NaN/);
      }
    }
    expect(short).toBeGreaterThan(20);
  });
});

describe('只给君主', () => {
  it('将领、名臣、宗室、后妃没有治绩', () => {
    const kinds = new Set<string>();
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      for (const x of civ.people ?? []) {
        if (x.role === 'ruler') continue;
        kinds.add(x.role);
        expect(reignRecord(civ, x)).toBeNull();
      }
    }
    expect([...kinds].sort()).toEqual(['consort', 'general', 'minister', 'prince']);
  });

  it('字里没有漏填的空值', () => {
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      for (const x of rulersOf(civ)) {
        const r = reignRecord(civ, x)!;
        for (const row of r.rows) for (const t of [...row.lines, row.note]) expect(t, `${x.name} ${row.k}`).not.toMatch(/undefined|null|NaN|Infinity/);
      }
    }
  });
});

/** 造出来的数:疆域没变、人口没变、国库充裕一直没换档、没打仗 */
const made = (o: Partial<ReignFacts> = {}): ReignFacts => ({
  from: 100, until: 102, len: 2, regions: [128, 128], gained: 0, lost: 0, peak: 128, low: 128,
  pop: [140, 140], warYears: 0, longestPeace: 2,
  fiscal: { mood0: 0, mood1: 0, income0: 50, income1: 50, short: [] }, events: [], ...o,
});
const fis = (mood0: number, mood1: number, short: number[] = []) => ({ mood0, mood1, income0: 50, income1: 50, short });

describe('在位不满 3 年:年数和副标题同一个取法', () => {
  // 副标题(人物卡「在位」一行):起止各取整年再相减,不满 1 年写"不足一年"
  const sub = (from: number, until: number) => Math.floor(until) - Math.floor(from);
  const cases: [number, number][] = [[100, 102.5], [100.2, 102.7], [100.9, 103.89], [100.1, 100.5], [100.7, 101.1], [100, 102.99]];
  for (const [from, until] of cases) {
    it(`${from}→${until}`, () => {
      const t = reignRecordOf(made({ from, until, len: until - from })).short!;
      const n = sub(from, until);
      expect(t.startsWith(n < 1 ? '在位不到一年，' : `在位 ${n} 年，`)).toBe(true);
    });
  }
});

describe('治绩的措辞', () => {
  it('在位不满 3 年:疆域、人口、国库都没变才写"国中没有变化"', () => {
    expect(reignRecordOf(made()).short).toBe('在位 2 年，国中没有变化：128 州，约 14 万人，国库充裕，没打仗。');
  });
  it('在位不满 3 年:疆域没变、国库换了档,照实写国库,不写"国中没有变化"', () => {
    const s = reignRecordOf(made({ fiscal: fis(2, 3) })).short!;
    expect(s).toBe('在位 2 年，疆域没变，国库从拮据到国用不足，没打仗。');
    expect(s).not.toContain('国中没有变化');
  });
  it('在位不满 3 年:疆域和人口都变了,两样都写;期间出过国用不足也算变了', () => {
    expect(reignRecordOf(made({ regions: [128, 130], gained: 2, pop: [140, 168], warYears: 1.5 })).short).toBe(
      '在位 2 年，疆域从 128 州到 130 州，人口增到约 17 万人，国库充裕，打了约 2 年仗。',
    );
    const s = reignRecordOf(made({ fiscal: fis(2, 2, [101]) })).short!;
    expect(s).toContain('疆域没变，');
    expect(s).not.toContain('国中没有变化');
  });
  it('人口四舍五入后前后约数一样:只写一个数,写"大致没变"', () => {
    const row = reignRecordOf(made({ len: 20, pop: [140, 143] })).rows.find((r) => r.k === '人口')!;
    expect(row.lines).toEqual(['约 14 万']);
    expect(row.note).toBe('大致没变');
    const diff = reignRecordOf(made({ len: 20, pop: [140, 168] })).rows.find((r) => r.k === '人口')!;
    expect(diff.lines).toEqual(['约 14 万 → 约 17 万']);
  });
  it('复制生平带上治绩:够年数的一行一项,不满 3 年的一句', () => {
    const long = reignText(reignRecordOf(made({ len: 20, until: 120, regions: [128, 130], gained: 2 })));
    expect(long[0]).toBe('治绩：');
    expect(long[1]).toBe('疆域：128 州 → 130 州（得 2 州）');
    expect(long.some((l) => l.startsWith('钱粮：'))).toBe(true);
    expect(reignText(reignRecordOf(made()))).toEqual(['治绩：在位 2 年，国中没有变化：128 州，约 14 万人，国库充裕，没打仗。']);
  });
});

/**
 * 各国的账本(fiscalBook.ts):推演里每年的钱粮抄下来给界面看。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/sim';
import { ownersAt } from '../src/gen/civ/timeline';
import { finishDevelopment } from '../src/gen/civ/development';
import { FISCAL_CONSTS } from '../src/gen/civ/control';
import { BOOK_EVERY, BOOK_RESERVE, BOOK_WIDTH, fillOf, fiscalAt, fiscalMood, fiscalSeries } from '../src/gen/civ/fiscalBook';

const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
}
const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(world(seed))));
  return c;
}

function bytes(a: ArrayBufferView) {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength);
}

describe('各国的账本', () => {
  it('国库最多攒几年和推演里一样', () => {
    expect(BOOK_RESERVE).toBe(FISCAL_CONSTS.RESERVE);
  });

  it('每 20 年在世的国家各一行;行按年份排;收入、截留加起来对得上', () => {
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const b = civ.development!.fiscal!;
      expect(b.size, `seed ${seed}`).toBeGreaterThan(100);
      expect(b.data.length).toBe(b.size * BOOK_WIDTH);
      for (let i = 1; i < b.size; i++) expect(b.year[i]).toBeGreaterThanOrEqual(b.year[i - 1]);
      for (const y of [1000, 2000, 3000]) {
        const own = ownersAt(civ, y).polity;
        const alive = new Set<number>();
        for (const p of own) if (p >= 0) alive.add(p);
        for (const p of alive) {
          const row = fiscalAt(civ, p, y);
          expect(row, `seed ${seed} 第 ${y} 年国家 ${p}`).not.toBeNull();
          expect(y - row!.year).toBeLessThan(BOOK_EVERY);
          const v = row!.values;
          // 应缴 = 三样之和;实收 + 截留 = 应缴
          expect(v.田赋 + v.工商 + v.市税).toBeCloseTo(v.应缴, -1);
          expect(v.实收 + v.截留直辖 + v.截留代管 + v.截留自治 + v.截留割据).toBeCloseTo(v.应缴, -1);
        }
      }
    }
  }, 200_000);

  it('记了国用不足的那一年,账上是国用不足', () => {
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const fiscal = civ.annals.filter((e) => e.kind === 'fiscal');
      expect(fiscal.length, `seed ${seed}`).toBeGreaterThan(5);
      for (const e of fiscal) {
        const v = fiscalAt(civ, e.a, e.year)!.values;
        expect(fiscalMood(fillOf(v.国库, v.应缴), v.窘迫), `seed ${seed} 第 ${e.year} 年`).toBe(3);
      }
      const s = fiscalSeries(civ, fiscal[0].a);
      expect(s.length).toBeGreaterThan(3);
      s.forEach((x) => expect(x.year % BOOK_EVERY).toBe(0));
    }
  }, 200_000);

  it('fromCiv 接着推:在国用不足那一刻和之后切开,账本和一口气推完逐字节一致', () => {
    for (const seed of [7, 2024]) {
      const w = world(seed);
      const whole = civOf(seed);
      const book = whole.development!.fiscal!;
      const ys = whole.annals.filter((e) => e.kind === 'fiscal' && e.year > 800).map((e) => e.year);
      const cuts = new Set([ys[0], ys[0] + 7, ys[ys.length >> 1]]);
      for (const cut of cuts) {
        const half = generateCiv(w, { endYear: cut });
        const sim = CivSim.fromCiv(w, half);
        sim.run(whole.endYear);
        const dev = finishDevelopment(sim, whole.endYear)!;
        const tag = `seed ${seed} 从第 ${cut} 年接着推`;
        const b = dev.fiscal!;
        expect(b.size, tag).toBe(book.size);
        for (const k of ['year', 'polity', 'data'] as const) expect(bytes(b[k]).equals(bytes(book[k])), `${tag}:${k}`).toBe(true);
      }
    }
  }, 400_000);
});

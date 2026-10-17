/**
 * 发展度(gen/civ/development.ts,推演结束后照历史算的):物产分档、能力和时代的节奏、"第一次进入某时代"的大事、
 * 按年份查(快照插值),以及它不改历史(加它时 determinism.test.ts 里别的字段一个没变)。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { polityAlive } from '../src/gen/civ/growth';
import { CAP_COUNT, ERAS, LEVEL_SCALE, RESOURCES, RESOURCE_COUNT, buildDevelopment, developmentAt, eraLevel, eraOf } from '../src/gen/civ/development';

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

/** 某年有人住的州的时代数值 */
function erasAt(civ: Civ, year: number): number[] {
  const lv = developmentAt(civ.development!, year);
  const own = ownersAt(civ, year);
  const out: number[] = [];
  for (let r = 0; r < civ.regions.count; r++) if (own.culture[r] >= 0) out.push(eraLevel(lv, r));
  return out;
}

describe.each([7, 2024])('发展度 · seed=%i', (seed) => {
  it('同一个种子算两遍逐字节一样', () => {
    const civ = civOf(seed);
    const again = buildDevelopment(world(seed), civ);
    expect(again.resources).toEqual(civ.development!.resources);
    expect(again.snaps).toEqual(civ.development!.snaps);
    expect(again.events).toEqual(civ.development!.events);
  });

  it('物产:每样都有、0–3 档,多的少于少的;铜锡、煤比粮、木材稀', () => {
    const dev = civOf(seed).development!;
    const R = civOf(seed).regions.count;
    const count = RESOURCES.map((_, k) => {
      const c = [0, 0, 0, 0];
      for (let r = 0; r < R; r++) c[dev.resources[r * RESOURCE_COUNT + k]]++;
      return c;
    });
    for (const c of count) {
      expect(c[1] + c[2] + c[3]).toBeGreaterThan(0);
      expect(c[3]).toBeLessThan(c[1]);
    }
    const has = (k: number) => R - count[k][0];
    expect(has(2)).toBeLessThan(has(0));
    expect(has(4)).toBeLessThan(has(5));
  });

  it('节奏:第 3000 年最先进的在中古或火药,还有不少地方在青铜、石器;越往后越高', () => {
    const civ = civOf(seed);
    const at = (y: number) => erasAt(civ, y);
    const top = (y: number) => Math.max(...at(y));
    expect(top(500)).toBeLessThan(1);
    expect(top(3000)).toBeGreaterThanOrEqual(3);
    expect(top(3000)).toBeLessThan(5);
    const end = at(3000);
    expect(end.filter((e) => e < 2).length / end.length).toBeGreaterThan(0.05);
    for (const y of [1000, 2000, 3000]) expect(top(y)).toBeGreaterThan(top(y - 500));
  });

  it('按年份查:快照那年就是快照,中间线性插值;值都在 0 到上限之间', () => {
    const dev = civOf(seed).development!;
    const i = 10;
    const a = developmentAt(dev, dev.snapYears[i]);
    for (let k = 0; k < a.length; k += 97) expect(a[k]).toBeCloseTo(dev.snaps[i][k] / LEVEL_SCALE, 6);
    const mid = developmentAt(dev, (dev.snapYears[i] + dev.snapYears[i + 1]) / 2);
    for (let k = 0; k < mid.length; k += 97) expect(mid[k]).toBeCloseTo((dev.snaps[i][k] + dev.snaps[i + 1][k]) / 2 / LEVEL_SCALE, 6);
    expect(dev.snapYears[dev.snapYears.length - 1]).toBe(civOf(seed).endYear);
    for (const s of dev.snaps) expect(s.length).toBe(civOf(seed).regions.count * CAP_COUNT);
  });

  it('大事:世界第一次进入各时代按时代先后、年份不倒退;各国进入新时代时国家还在、那州是它的', () => {
    const civ = civOf(seed);
    const ev = civ.development!.events;
    const firsts = ev.filter((e) => e.kind === 'first');
    expect(firsts.map((e) => e.era)).toEqual(firsts.map((_, i) => i + 1));
    expect(firsts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < ev.length; i++) expect(ev[i].year).toBeGreaterThanOrEqual(ev[i - 1].year);
    const enters = ev.filter((e) => e.kind === 'enter');
    expect(enters.length).toBeGreaterThan(5);
    for (const e of enters) {
      expect(polityAlive(civ.polities[e.polity], e.year)).toBe(true);
      expect(ownersAt(civ, e.year).polity[e.region]).toBe(e.polity);
    }
    // 同一国同一时代只记一次
    const keys = enters.map((e) => `${e.polity}:${e.era}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('时代数值', () => {
  it('四样能力一样高时就是那个数;短板拉低时代', () => {
    expect(eraLevel([2, 2, 2, 2, 9], 0)).toBeCloseTo(2, 9);
    expect(eraLevel([3, 3, 3, 0, 0], 0)).toBeLessThan(2.5);
  });
  it('整数部分是时代,小数部分是走了几成;最后一个时代不越界', () => {
    expect(eraOf(2.7)).toEqual({ era: 2, progress: expect.closeTo(0.7, 9) });
    expect(eraOf(9).era).toBe(ERAS.length - 1);
    expect(eraOf(-0.1)).toEqual({ era: 0, progress: 0 });
  });
});

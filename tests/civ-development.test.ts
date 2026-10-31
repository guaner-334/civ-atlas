/**
 * 发展度(gen/civ/development.ts,推演里每 20 年算一步):物产分档、能力和时代的节奏、"第一次进入某时代"和发明的大事、
 * 按年份查(快照插值)、接着推和一口气推完一样;反过来影响推演(城的人口上限、远洋);
 * 编年史里的时代大事、时代图层的色块、物产图层的圆章。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { devFactorAt, polityAlive } from '../src/gen/civ/growth';
import { CivSim } from '../src/gen/civ/sim';
import { polityModelOf } from '../src/gen/civ/polities';
import { developmentEntries } from '../src/gen/civ/story/developmentText';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { eraCiv, eraLevelsAt } from '../src/render/civ/era';
import { resourceBadges } from '../src/render/civ/resources';
import { AVAIL_SCALE, CAP_COUNT, ERAS, LEVEL_SCALE, RESOURCES, RESOURCE_COUNT, INVENTIONS, developmentAt, finishDevelopment, popFactor, eraLevel, eraOf, resourcesAt } from '../src/gen/civ/development';

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
  it('同一个种子推两遍逐字节一样;从半路接着推(整百年、不在整步上),发展度、城的人口上限倍数、远洋的年份都和一口气推完一样', () => {
    const civ = civOf(seed);
    const again = generateCiv(world(seed));
    expect(again.development!.snaps).toEqual(civ.development!.snaps);
    expect(again.development!.events).toEqual(civ.development!.events);
    for (const cut of [1200, 1655.5]) {
      const half = generateCiv(world(seed), { endYear: cut });
      const sim = CivSim.fromCiv(world(seed), half);
      sim.run(civ.endYear);
      const dev = finishDevelopment(sim, civ.endYear)!;
      const tag = `从第 ${cut} 年接着推`;
      expect(dev.snapYears, tag).toEqual(civ.development!.snapYears);
      expect(dev.snaps, tag).toEqual(civ.development!.snaps);
      expect(dev.avail, tag).toEqual(civ.development!.avail);
      expect(dev.events, tag).toEqual(civ.development!.events);
      expect(dev.found, tag).toEqual(civ.development!.found);
      const pm = polityModelOf(sim)!;
      expect(pm.settlements.map((s) => s.devCap ?? null), tag).toEqual(civ.settlements.map((s) => s.devCap ?? null));
      expect(pm.polities.map((p) => p.sail ?? null), tag).toEqual(civ.polities.map((p) => p.sail ?? null));
    }
  }, 120_000);

  it('城的人口上限随生产能力变:倍数在石器时代的和封顶之间,每对隔够 20 年;第 3000 年先进的州的城比落后的倍数高', () => {
    const civ = civOf(seed);
    const lv = developmentAt(civ.development!, 3000);
    const lo: number[] = [];
    const hi: number[] = [];
    for (const s of civ.settlements) {
      const dc = s.devCap!;
      expect(dc.length % 2).toBe(0);
      expect(dc[0]).toBe(s.founded);
      for (let i = 2; i < dc.length; i += 2) expect(dc[i] - dc[i - 2]).toBeGreaterThanOrEqual(i === 2 ? 0 : 20);
      for (let i = 1; i < dc.length; i += 2) {
        expect(dc[i]).toBeGreaterThanOrEqual(popFactor(0));
        expect(dc[i]).toBeLessThanOrEqual(2);
      }
      if (s.ended !== undefined || s.founded > 2500) continue;
      const P = lv[s.region * CAP_COUNT];
      if (P < 1.5) lo.push(devFactorAt(dc, 3000));
      else if (P > 3) hi.push(devFactorAt(dc, 3000));
    }
    expect(lo.length).toBeGreaterThan(5);
    expect(hi.length).toBeGreaterThan(5);
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(hi)).toBeGreaterThan(mean(lo) + 0.1);
  });

  it('远洋:普通国家各在自己国都的运输能力够了那年起才能远洋,年份有先有后(从能远洋的国家分出去的立国就能);海洋国家不记', () => {
    const civ = civOf(seed);
    const sail = civ.polities.filter((p) => p.sail !== undefined);
    expect(sail.length).toBeGreaterThan(3);
    for (const p of sail) {
      expect(p.kind).not.toBe('sea');
      if (p.sail === p.founded && p.parent !== undefined) {
        const P = civ.polities[p.parent];
        expect(P.kind === 'sea' || P.sail! <= p.founded).toBe(true);
      } else expect(p.sail! % 20).toBe(0);
      expect(polityAlive(p, p.sail!)).toBe(true);
    }
    expect(new Set(sail.map((p) => p.sail)).size).toBeGreaterThan(2);
    // 自己进航海时代的最早也在第 1000 年以后(从海洋国家分出去的,立国那年就能远洋,不算)
    expect(Math.min(...sail.filter((p) => !(p.sail === p.founded && p.parent !== undefined)).map((p) => p.sail!))).toBeGreaterThan(1000);
  });

  it('发明:按出现先后、各样只记一次,那一刻那州的那样能力到了那一档', () => {
    const civ = civOf(seed);
    const inv = civ.development!.events.filter((e) => e.kind === 'invent');
    expect(inv.length).toBeGreaterThan(12);
    expect(new Set(inv.map((e) => e.invention)).size).toBe(inv.length);
    for (const e of inv) {
      const x = INVENTIONS[e.invention!];
      // 快照之间线性插值,只看下一份快照时到了没有;这中间本州打过仗、被攻占洗劫的,战乱折损会扣下去一点
      const next = civ.development!.snapYears.find((y) => y >= e.year)!;
      const hit = civ.annals.some((a) => a.region === e.region && a.year >= e.year && a.year <= next && (a.kind === 'battle' || a.kind === 'conquer' || a.kind === 'sack' || a.kind === 'ruin'));
      expect(developmentAt(civ.development!, next)[e.region * CAP_COUNT + x.cap] + 1 / LEVEL_SCALE + (hit ? 0.25 : 0)).toBeGreaterThanOrEqual(x.level);
    }
    // 文字比印刷术早
    const at = (name: string) => inv.find((e) => INVENTIONS[e.invention!].name === name)?.year ?? Infinity;
    expect(at('文字')).toBeLessThan(at('印刷术'));
  });

  it('物产随年份:矿要发现了才有,发现在要它的那个时代之前;眼下能用的不超过底子;第 3000 年还没有煤、石油、稀有矿', () => {
    const civ = civOf(seed);
    const dev = civ.development!;
    const R = civ.regions.count;
    for (const a of dev.avail) for (let i = 0; i < a.length; i++) expect(a[i]).toBeLessThanOrEqual(dev.resources[i] * AVAIL_SCALE);
    const at = resourcesAt(dev, 2500);
    let known = 0;
    for (let r = 0; r < R; r++) {
      for (let k = 0; k < RESOURCE_COUNT; k++) {
        const i = r * RESOURCE_COUNT + k;
        if (dev.found[i] > 2500) expect(at[i]).toBe(0);
        else if (dev.resources[i]) known++;
      }
    }
    expect(known).toBeGreaterThan(0);
    // 铜锡比青铜时代早发现;煤、石油、稀有矿要到工业时代前后
    let copper = Infinity;
    for (let r = 0; r < R; r++) copper = Math.min(copper, dev.found[r * RESOURCE_COUNT + 2]);
    const bronze = dev.events.find((e) => e.kind === 'first' && e.era === 1)!.year;
    expect(copper).toBeLessThan(bronze);
    // 金银不卡时代,比铜锡还早认得
    let gold = Infinity;
    for (let r = 0; r < R; r++) gold = Math.min(gold, dev.found[r * RESOURCE_COUNT + 10]);
    expect(gold).toBeLessThan(copper);
    for (const k of [4, 8, 9]) for (let r = 0; r < R; r++) expect(dev.found[r * RESOURCE_COUNT + k]).toBe(Infinity);
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

describe.each([7, 2024])('时代、物产写进编年史和图层 · seed=%i', (seed) => {
  it('世上第一次进入某时代、要紧的发明是大事;各国的、发现、采空只在"全部";id 不和别的纪事撞', () => {
    const civ = civOf(seed);
    const dev = developmentEntries(civ);
    const firsts = civ.development!.events.filter((e) => e.kind === 'first');
    const major = dev.filter((e) => e.importance >= 3);
    expect(major.filter((e) => e.text.includes('时代')).length).toBe(firsts.length);
    for (const e of major) expect(e.text).toMatch(/(始入.+时代|始创.+),为天下之先$/);
    // 发明:每样都写进去了;有国家、当时有君主的写上君主(人物能点开)
    const inv = dev.filter((e) => e.text.includes('始创'));
    const names = inv.map((e) => e.text).join('');
    for (const e of civ.development!.events) if (e.kind === 'invent') expect(names).toContain(INVENTIONS[e.invention!].name);
    expect(inv.some((e) => e.people?.length)).toBe(true);
    expect(dev.some((e) => e.importance < 3 && e.text.includes('始入'))).toBe(true);
    for (const e of dev) expect(e.kind).toBe('era');
    const all = fullChronicle(civ);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    for (let i = 1; i < all.length; i++) expect(all[i].year).toBeGreaterThanOrEqual(all[i - 1].year);
    // 同一国同一年只有一条
    const keys = dev.filter((e) => e.importance < 3 && e.polities.length).map((e) => `${e.polities[0]}:${Math.floor(e.year)}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('时代图层:换进民族那一层的九个时代;第 0 年有人住的州都是石器,结束那年和按年份查的一致', () => {
    const civ = civOf(seed);
    const view = eraCiv(civ);
    expect(view.cultures.length).toBe(ERAS.length);
    expect(eraCiv(civ)).toBe(view);
    const at0 = ownersAt(view, 0);
    const lv0 = eraLevelsAt(civ, 0);
    for (let r = 0; r < civ.regions.count; r++) if (lv0[r] >= 0) expect(at0.culture[r]).toBe(0);
    const end = ownersAt(view, civ.endYear);
    const lv = eraLevelsAt(civ, civ.endYear);
    for (let r = 0; r < civ.regions.count; r++) expect(end.culture[r]).toBe(lv[r] < 0 ? -1 : Math.min(ERAS.length - 1, Math.floor(lv[r])));
  });

  it('物产圆章:全部显示时每州至多一个(最稀有的多),只看一样时只有那一样;没发现的只在开着"显示未发现的"时出现', () => {
    const civ = civOf(seed);
    const dev = civ.development!;
    const all = resourceBadges(dev, civ.endYear, civ.regions.count, null, false);
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((b) => b.region)).size).toBe(all.length);
    for (const b of all) expect(b.hidden).toBe(false);
    const iron = resourceBadges(dev, civ.endYear, civ.regions.count, 3, false);
    for (const b of iron) expect(b.resource).toBe(3);
    expect(iron.length).toBeGreaterThan(all.filter((b) => b.resource === 3).length);
    const ghost = resourceBadges(dev, 1000, civ.regions.count, 4, true);
    expect(ghost.length).toBeGreaterThan(0);
    for (const b of ghost) expect(b.hidden).toBe(true);
  });
});

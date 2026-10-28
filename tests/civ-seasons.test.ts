/**
 * 季节进推演:年内气温估算(gen/seasons.ts)、出兵避冬(civ/wars.ts)、春荒(civ/unrest.ts)。
 * 门槛按种子 1–20 推到第 3000 年的统计放宽(GENERATOR_VERSION 46):
 * - 冷地(那州一年里 5%–90% 的日子月温低于 3°C)的仗落在冷季的几成:各种子 5%–15%(改前 13%–38%,按日子平摊约 29%);
 * - 冬夏分明处(年较差 8°C 以上)的饥荒落在春荒(最冷那一刻往后 0.2–0.4 年)的几成:各种子 86%–99%(改前 17%–30%);
 * - 顿兵过冬:各种子 17–182 次。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { buildChronicle, type ChronicleEntry } from '../src/gen/civ/chronicle';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { COLDEST_NORTH, coldShare, coldSpellEnd, monthTemp, yearClimate } from '../src/gen/seasons';

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
const flat = (list: readonly ChronicleEntry[]): ChronicleEntry[] => list.flatMap((e) => [e, ...(e.children ?? [])]);
/** 一年里的几成(0–1) */
const frac = (t: number) => t - Math.floor(t);
const SEEDS = [1, 2];
const CIVIL = new Set(['quell', 'heir']);

describe('年内气温(估算)', () => {
  it('北半球一月最冷、七月最热,南半球反过来;高纬、内陆冬夏差得多;同一个世界算出来一样', () => {
    const w = world(7);
    const yc = yearClimate(w);
    const lat = (c: number) => 90 - (180 * w.mesh.y[c]) / w.mesh.height;
    let north = 0;
    let south = 0;
    const hi: number[] = [];
    const lo: number[] = [];
    for (let c = 0; c < w.mesh.n; c++) {
      if (w.water[c] !== 0) continue;
      const a = lat(c);
      expect(yc.half[c]).toBeGreaterThanOrEqual(1.5 - 1e-6); // 年较差至少 3°C
      const jan = monthTemp(yc, c, 1000 + COLDEST_NORTH);
      const jul = monthTemp(yc, c, 1000 + COLDEST_NORTH + 0.5);
      if (a > 10) {
        expect(jan).toBeLessThan(jul);
        north++;
      } else if (a < -10) {
        expect(jan).toBeGreaterThan(jul);
        south++;
      }
      if (Math.abs(a) > 50) hi.push(yc.half[c]);
      else if (Math.abs(a) < 20) lo.push(yc.half[c]);
      // 一年里低于年均温的正好一半
      expect(coldShare(yc, c, yc.mean[c])).toBeCloseTo(0.5, 6);
    }
    expect(north).toBeGreaterThan(100);
    expect(south).toBeGreaterThan(100);
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    expect(mean(hi)).toBeGreaterThan(2 * mean(lo));
    const again = yearClimate(generateWorld({ ...DEFAULT_PARAMS, seed: 7 }));
    expect(again.half).toEqual(yc.half);
    expect(again.coldest).toEqual(yc.coldest);
  });

  it('冷季结束的时刻:最冷那一刻往后半个冷季;不在冷季里原样返回;常年都冷 = 没有开春', () => {
    const w = world(7);
    const yc = yearClimate(w);
    let seen = 0;
    for (let c = 0; c < w.mesh.n && seen < 200; c++) {
      if (w.water[c] !== 0) continue;
      const share = coldShare(yc, c, 3);
      const t = 500 + yc.coldest[c];
      if (share <= 0) expect(coldSpellEnd(yc, c, t, 3)).toBe(t);
      else if (share >= 1) expect(coldSpellEnd(yc, c, t, 3)).toBe(Infinity);
      else {
        seen++;
        expect(coldSpellEnd(yc, c, t, 3)).toBeCloseTo(t + share / 2, 9);
        // 冷季刚结束那一刻月温回到 3°C
        expect(monthTemp(yc, c, t + share / 2)).toBeCloseTo(3, 3);
        // 最热那一刻不在冷季里
        if (share < 0.9) expect(coldSpellEnd(yc, c, t + 0.5, 3)).toBe(t + 0.5);
      }
    }
    expect(seen).toBeGreaterThan(50);
  });
});

describe('季节进推演', () => {
  it('出兵避冬:要打的那州正在冬天里就顿兵到开春;冷地的仗少落在冷季;编年史写"顿兵过冬"', () => {
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      const yc = yearClimate(world(seed));
      const seat = civ.regions.seat;
      const winters = civ.annals.filter((e) => e.kind === 'winter');
      expect(winters.length, `seed ${seed} 顿兵过冬`).toBeGreaterThanOrEqual(15);
      for (const e of winters) {
        const c = seat[e.region];
        expect(e.war, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        // 顿兵那一刻那州在冷季里;开春(冷季结束后 0–3 周)再打
        expect(monthTemp(yc, c, e.year), `seed ${seed} 第 ${e.year} 年`).toBeLessThan(3.01);
        expect(e.until!).toBeGreaterThan(e.year);
        expect(e.until!).toBeLessThan(e.year + 1);
        expect(monthTemp(yc, c, e.until!)).toBeGreaterThan(2.5); // 开春的时刻取整到 1/256 年,可能早半格
      }
      // 冷地的仗(打下来的、没打下来的;不算内战)落在冷季的几成
      const civil = new Set(civ.annals.filter((e) => e.kind === 'war' && CIVIL.has(e.cause ?? '')).map((e) => e.war));
      let cold = 0;
      let inWinter = 0;
      for (const e of civ.annals) {
        if ((e.kind !== 'battle' && e.kind !== 'conquer') || !(e.war >= 0) || civil.has(e.war) || !(e.region >= 0)) continue;
        const c = seat[e.region];
        const share = coldShare(yc, c, 3);
        if (share <= 0.05 || share >= 0.9) continue;
        cold++;
        if (monthTemp(yc, c, e.year) < 3) inWinter++;
      }
      expect(cold, `seed ${seed}`).toBeGreaterThan(50);
      expect(inWinter / cold, `seed ${seed} 冷地的仗落在冷季`).toBeLessThan(0.16);
      // 编年史:折进那场战争,标签"冬"
      const kids = flat(buildChronicle(civ)).filter((x) => x.kind === 'winter');
      expect(kids.length, `seed ${seed}`).toBe(winters.length);
      for (const x of kids) {
        expect(x.tag).toBe('冬');
        expect(x.text).toMatch(/顿兵.+待春复攻|扎营过冬,待开春再攻|驻冬,待开春再战/);
      }
    }
  }, 120_000);

  it('春荒:冬夏分明的地方饥荒落在当地青黄不接的时候(最冷那一刻往后 0.2–0.4 年),编年史写"春,"', () => {
    for (const seed of SEEDS) {
      const civ = civOf(seed);
      const yc = yearClimate(world(seed));
      const seat = civ.regions.seat;
      const famines = civ.annals.filter((e) => e.kind === 'famine' && e.cause !== 'quake');
      const spring = famines.filter((e) => e.cause === 'spring');
      expect(spring.length, `seed ${seed} 春荒`).toBeGreaterThan(20);
      // 春荒那一刻:北半球或南半球的春荒时节(取整到 1/256 年)
      for (const e of spring) {
        const q = frac(e.year - COLDEST_NORTH) % 0.5;
        expect(q, `seed ${seed} 第 ${e.year} 年`).toBeGreaterThanOrEqual(0.2 - 1 / 256);
        expect(q, `seed ${seed} 第 ${e.year} 年`).toBeLessThanOrEqual(0.4 + 1 / 256);
      }
      let n = 0;
      let inSpring = 0;
      for (const e of famines) {
        if (!(e.region >= 0)) continue;
        const c = seat[e.region];
        if (yc.half[c] < 4) continue;
        n++;
        const ph = frac(e.year - yc.coldest[c]);
        if (ph >= 0.19 && ph < 0.41) inSpring++;
      }
      expect(n, `seed ${seed}`).toBeGreaterThan(30);
      expect(inSpring / n, `seed ${seed} 冬夏分明处的饥荒落在春荒`).toBeGreaterThan(0.8);
      const text = flat(buildChronicle(civ)).filter((x) => x.kind === 'famine');
      const springText = text.filter((x) => civ.annals[x.id]?.cause === 'spring');
      expect(springText.length).toBeGreaterThan(0);
      for (const x of springText) expect(x.text.startsWith('春,'), x.text).toBe(true);
    }
  }, 120_000);

  it('接着推:停在顿兵过冬和开春之间、看年景和春荒之间,接着推和一口气推完一样', () => {
    const seed = SEEDS[0];
    const w = world(seed);
    const full = civOf(seed);
    const halt = full.annals.find((e) => e.kind === 'winter' && e.year > 600 && e.until! - e.year > 0.1)!;
    const famine = full.annals.find((e) => e.kind === 'famine' && e.cause === 'spring' && e.year > 600)!;
    expect(halt && famine).toBeTruthy();
    // 停在顿兵那一刻(那一仗挪到开春,还没到);停在春荒的前一刻(那一次看年景已经过了)
    for (const stop of [halt.year, famine.year - 1 / 256]) {
      const to = Math.floor(stop) + 30;
      const saved = unpackValue(packValue(generateCiv(w, { endYear: stop }))) as Civ;
      const cont = continueCiv(w, saved, { endYear: to });
      const whole = generateCiv(w, { endYear: to });
      for (const k of Object.keys(whole) as (keyof Civ)[]) expect(cont[k], `停在第 ${stop} 年 ${k}`).toEqual(whole[k]);
    }
  }, 240_000);
});

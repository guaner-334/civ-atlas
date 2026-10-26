/**
 * 中央管到什么程度(control.ts):管得到几成、割据、收回、抗命不出兵。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/sim';
import { ownersAt } from '../src/gen/civ/timeline';
import { finishDevelopment } from '../src/gen/civ/development';
import { CONTROL_TIERS, LORD_BYTE, controlAt, controlShare, controlStats, controlTier } from '../src/gen/civ/control';
import { buildChronicle, type ChronicleEntry } from '../src/gen/civ/chronicle';

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

function flat(list: readonly ChronicleEntry[]): ChronicleEntry[] {
  return list.flatMap((e) => [e, ...(e.children ?? [])]);
}

describe('中央管到什么程度', () => {
  it('每 20 年一份快照:有国家的州 1–101 或割据,没国家的州 0;四档都有人', () => {
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const dev = civ.development!;
      expect(dev.control?.length, `seed ${seed}`).toBe(dev.controlYears?.length);
      expect(dev.controlYears![0]).toBe(0);
      dev.controlYears!.forEach((y, i) => i && expect(y - dev.controlYears![i - 1]).toBe(20));
      const R = civ.regions.count;
      const seen = [0, 0, 0, 0];
      for (const y of [1000, 1500, 2000, 2500, 3000]) {
        const snap = controlAt(civ, y)!;
        expect(snap.length).toBe(R);
        const own = ownersAt(civ, y);
        for (let r = 0; r < R; r++) {
          const v = snap[r];
          if (own.polity[r] < 0) expect(v, `seed ${seed} 第 ${y} 年 州 ${r}`).toBe(0);
          else {
            expect(v === LORD_BYTE || (v >= 1 && v <= 101), `seed ${seed} 第 ${y} 年 州 ${r}:${v}`).toBe(true);
            seen[controlTier(v)]++;
          }
        }
      }
      for (let k = 0; k < 4; k++) expect(seen[k], `seed ${seed} ${CONTROL_TIERS[k]}`).toBeGreaterThan(0);
      // 国都所在州是 1(管得到十成)
      const p = civ.polities.find((x) => x.ended === undefined)!;
      const capR = civ.settlements[p.capitals![p.capitals!.length - 1].settlement].region;
      expect(controlShare(controlAt(civ, civ.endYear)![capR])).toBe(1);
    }
  }, 120_000);

  it('割据:名义上照旧归这国(那一刻那州还是它的),地盘里有那州;收回、抗命都接在一处割据后面', () => {
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const st = controlStats(civ);
      expect(st.warlords, `seed ${seed}`).toBeGreaterThan(3);
      expect(st.defies).toBeGreaterThan(0);
      const open = new Map<string, number>();
      for (const e of civ.annals) {
        const key = `${e.a}|${e.region}`;
        if (e.kind === 'warlord') {
          expect(e.a).toBeGreaterThanOrEqual(0);
          expect(civ.settlements[e.settlement].region).toBe(e.region);
          expect(e.war).toBeGreaterThanOrEqual(1);
          expect(ownersAt(civ, e.year).polity[e.region]).toBe(e.a);
          open.set(key, e.year);
        } else if (e.kind === 'reclaim' || e.kind === 'defy') {
          const y0 = open.get(key);
          expect(y0, `seed ${seed} ${e.kind} 第 ${e.year} 年`).toBeDefined();
          if (e.kind === 'reclaim') {
            expect(e.b).toBe(-1);
            expect(e.war).toBe(Math.round(e.year - y0!));
            open.delete(key);
          } else {
            expect(e.b).toBeGreaterThanOrEqual(0);
            expect(e.war).toBeGreaterThanOrEqual(0);
          }
        }
      }
      // 割据的州在快照里是割据(割据以后的那一份;那州还是它的、没收回)
      const e = civ.annals.find((x) => x.kind === 'warlord' && x.year < civ.endYear - 40)!;
      const y = Math.ceil(e.year / 20) * 20;
      if (ownersAt(civ, y).polity[e.region] === e.a) expect(controlAt(civ, y)![e.region]).toBe(LORD_BYTE);
    }
  }, 120_000);

  it('编年史:割据写"拥兵自重……名义上仍奉",收回写"收回",抗命写"拥兵不出"', () => {
    const civ = civOf(7);
    const all = flat(buildChronicle(civ));
    const lord = all.filter((x) => x.kind === 'warlord');
    expect(lord.length).toBe(controlStats(civ).warlords);
    for (const x of lord) expect(x.text).toMatch(/拥兵自重,割据.+,名义上仍奉/);
    for (const x of all.filter((y) => y.kind === 'defy')) expect(x.text).toMatch(/交兵,.+拥兵不出$/);
    for (const x of all.filter((y) => y.kind === 'reclaim')) expect(x.text).toMatch(/收回/);
    expect(all.some((x) => x.tag === '据')).toBe(true);
  }, 120_000);

  it('fromCiv 接着推:在割据、收回、抗命那一刻和之后切开,和一口气推完逐字节一致(连同快照)', () => {
    for (const seed of [7, 2024]) {
      const w = world(seed);
      const whole = civOf(seed);
      const A = whole.annals;
      const at = (k: string) => A.find((e) => e.kind === k && e.year > 800)?.year;
      const cuts = new Set<number>();
      for (const k of ['warlord', 'reclaim', 'defy']) {
        const y = at(k);
        if (y === undefined) continue;
        cuts.add(y);
        cuts.add(Math.floor(y) + 7);
      }
      expect(cuts.size, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      for (const cut of cuts) {
        const half = generateCiv(w, { endYear: cut });
        const sim = CivSim.fromCiv(w, half);
        sim.run(whole.endYear);
        const res = sim.result();
        const tag = `seed ${seed} 从第 ${cut} 年接着推`;
        expect(res.log.size, tag).toBe(whole.log.size);
        for (const k of ['year', 'region', 'value'] as const) {
          expect(bytes(res.log[k]).equals(bytes(whole.log[k].subarray(0, whole.log.size))), `${tag}:日志 ${k}`).toBe(true);
        }
        expect(JSON.stringify(res.annals), `${tag}:史事`).toBe(JSON.stringify(whole.annals));
        const dev = finishDevelopment(sim, whole.endYear)!;
        expect(dev.controlYears, tag).toEqual(whole.development!.controlYears);
        dev.control!.forEach((s, i) => expect(bytes(s).equals(bytes(whole.development!.control![i])), `${tag}:第 ${i} 份快照`).toBe(true));
      }
    }
  }, 400_000);
});

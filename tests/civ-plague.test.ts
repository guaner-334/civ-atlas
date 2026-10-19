/**
 * 瘟疫(plague.ts、plagueSpans.ts)和地图上的疫区(render/civ/plague.ts 的 plagueZone)。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/sim';
import { ownersAt } from '../src/gen/civ/timeline';
import { polityModelOf } from '../src/gen/civ/polities';
import { polityAlive } from '../src/gen/civ/growth';
import { plagueSpans, plagueStats } from '../src/gen/civ/plagueSpans';
import { buildChronicle } from '../src/gen/civ/chronicle';
import { plagueZone } from '../src/render/civ/plague';

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

const strip = <T extends { name: string; color?: unknown; dynasties?: { name: string }[] }>(a: T[]) =>
  a.map((x) => ({ ...x, name: '', color: 0, eastern: undefined, dynasties: x.dynasties?.map((d) => ({ ...d, name: '' })) }));

describe('瘟疫', () => {
  it('fromCiv 接着推:在起疫那一刻、传到一半时切开,和一口气推完逐字节一致', () => {
    for (const seed of [7, 2024]) {
      const w = world(seed);
      const whole = civOf(seed);
      // 传得最久的那一场:起疫那刻、第 1 年、传到一半
      const sp = plagueSpans(whole)
        .filter((s) => s.start > 600)
        .sort((a, b) => b.end - b.start - (a.end - a.start))[0];
      expect(sp, `seed ${seed}`).toBeDefined();
      const cuts = new Set([sp.start, sp.start + 1, Math.floor((sp.start + sp.end) / 2) + 0.5]);
      for (const cut of cuts) {
        const half = generateCiv(w, { endYear: cut });
        const sim = CivSim.fromCiv(w, half);
        sim.run(whole.endYear);
        const res = sim.result();
        const tag = `seed ${seed} 从第 ${cut} 年接着推`;
        expect(res.log.size, tag).toBe(whole.log.size);
        for (const k of ['year', 'region', 'layer', 'value', 'cause'] as const) {
          expect(bytes(res.log[k]).equals(bytes(whole.log[k].subarray(0, whole.log.size))), `${tag}:日志 ${k}`).toBe(true);
        }
        expect(JSON.stringify(res.annals), `${tag}:史事`).toBe(JSON.stringify(whole.annals));
        const m = polityModelOf(sim)!;
        expect(JSON.stringify(strip(m.settlements)), `${tag}:城镇表`).toBe(JSON.stringify(strip(whole.settlements)));
      }
    }
  }, 240_000);

  it('史事按约定的字段记:一年一国一条(染疫的州数、死得最多的城),同一场的第一条是起疫的那一城', () => {
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const A = civ.annals;
      const S = civ.settlements;
      const first = new Map<number, number>();
      A.forEach((e, i) => {
        if (e.kind !== 'plague') return;
        const tag = `seed ${seed} 第 ${i} 条`;
        expect(e.a, tag).toBeGreaterThanOrEqual(0);
        expect(polityAlive(civ.polities[e.a], e.year), tag).toBe(true);
        const own = ownersAt(civ, e.year).polity;
        const hit = S.filter((s) => own[s.region] === e.a && s.sacks?.some((k) => k.cause === 'plague' && k.year === e.year));
        expect(hit.length, tag).toBe(e.b);
        expect(S[e.settlement].region, tag).toBe(e.region);
        expect(hit.map((s) => s.id), tag).toContain(e.settlement);
        if (!first.has(e.war)) {
          first.set(e.war, i);
          expect(e.b, `${tag}:起疫`).toBe(1);
        } else {
          const f = A[first.get(e.war)!];
          expect(e.cause, tag).toBe(f.cause);
          expect(e.year, tag).toBeGreaterThanOrEqual(f.year);
          // 一年一次:和起疫那刻隔整年
          expect((e.year - f.year) % 1, tag).toBe(0);
        }
      });
      // 每场的染疫城都在起疫之后、下一场起疫之前;同一场一州只染一次
      const sp = plagueSpans(civ);
      expect(sp.length).toBe(first.size);
      for (const s of sp) {
        const rs = s.hits.map((h) => h.region);
        expect(new Set(rs).size, `seed ${seed} 第 ${s.id} 场`).toBe(rs.length);
        for (const h of s.hits) expect(h.loss).toBeGreaterThan(0);
      }
    }
  }, 60_000);

  it('默认参数 seed 7 / 2024:几场到二十几场,两个世界合计有传了几十州的', () => {
    let big = 0;
    for (const seed of [7, 2024]) {
      const st = plagueStats(civOf(seed));
      // 20 个种子(1–19、2024)每个世界 9–23 场
      expect(st.plagues, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      expect(st.plagues, `seed ${seed}`).toBeLessThanOrEqual(35);
      big += st.sizes.filter((n) => n >= 30).length;
    }
    expect(big).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('编年史:同一场折成一条(标签"疫"),子条目是逐年传到哪;措辞干净', () => {
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const list = buildChronicle(civ);
      const pl = list.filter((e) => e.kind === 'plague');
      expect(pl.length).toBe(plagueSpans(civ).length);
      for (const e of pl) {
        expect(e.tag).toBe('疫');
        expect(e.text).toMatch(/大疫/);
        expect(e.text).not.toMatch(/undefined|NaN|某国|-1/);
        if (e.children) {
          expect(e.children[0].text).toMatch(/起疫$/);
          for (const c of e.children.slice(1)) expect(c.text).toMatch(/^疫传至/);
        }
        expect(e.end).toBeGreaterThanOrEqual(e.year);
      }
    }
  }, 60_000);

  it('疫区:起疫那年画起疫的州,疫过以后淡完', () => {
    const civ = civOf(7);
    const sp = plagueSpans(civ);
    sp.forEach((s, i) => {
      const z = plagueZone(civ, s.start)!;
      expect(z).not.toBeNull();
      expect(z[s.hits[0].region]).toBeGreaterThan(0);
      // 下一场还没起疫时看得到淡完
      if (i + 1 < sp.length && sp[i + 1].start <= s.end + 6.5) return;
      const later = plagueZone(civ, s.end + 6.5);
      if (later) for (const h of s.hits) expect(later[h.region]).toBe(0);
    });
  }, 60_000);
});

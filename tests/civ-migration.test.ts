/**
 * 大迁徙(migration.ts):草原、寒地的民族分出一支举族远走,到了立国、开战,打进国都。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { AdjKind } from '../src/gen/civ/types';
import { CivSim } from '../src/gen/civ/sim';
import { ownersAt } from '../src/gen/civ/timeline';
import { polityModelOf } from '../src/gen/civ/polities';
import { trekDir, trekFolk, trekModelOf, trekStats } from '../src/gen/civ/migration';
import { geometryOf } from '../src/gen/geometry';
import { cultureLabel } from '../src/gen/civ/display';
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

const strip = <T extends { name: string; color?: unknown; dynasties?: { name: string }[] }>(a: T[]) =>
  a.map((x) => ({ ...x, name: '', color: 0, eastern: undefined, dynasties: x.dynasties?.map((d) => ({ ...d, name: '' })) }));

function flat(list: readonly ChronicleEntry[]): ChronicleEntry[] {
  return list.flatMap((e) => [e, ...(e.children ?? [])]);
}

describe('大迁徙', () => {
  it('fromCiv 接着推:在动身、路上、落脚、打进国都那一刻和之后切开,和一口气推完逐字节一致(连同 Civ.migrations)', () => {
    for (const seed of [7, 2024]) {
      const w = world(seed);
      const whole = civOf(seed);
      const L = whole.migrations ?? [];
      expect(L.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      const cuts = new Set<number>();
      const first = L[0];
      const big = L.find((M) => M.big);
      cuts.add(first.year);
      cuts.add(Math.floor((first.year + first.years[first.years.length - 1]) / 2));
      if (first.settled !== undefined) cuts.add(first.settled);
      if (big?.outcomeYear !== undefined) {
        cuts.add(big.outcomeYear);
        cuts.add(Math.floor(big.outcomeYear) + 2);
      }
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
        expect(JSON.stringify(trekModelOf(sim)!.list), `${tag}:大迁徙`).toBe(JSON.stringify(L));
        const m = polityModelOf(sim)!;
        expect(JSON.stringify(strip(m.polities)), `${tag}:国家表`).toBe(JSON.stringify(strip(whole.polities)));
        expect(JSON.stringify(strip(m.settlements)), `${tag}:城镇表`).toBe(JSON.stringify(strip(whole.settlements)));
      }
    }
  }, 300_000);

  it('Civ.migrations 按约定记:陆路一州挨一州、年份严格递增;落脚、立的国、开的仗、结局和史事对得上', () => {
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const A = civ.annals;
      const reg = civ.regions;
      const L = civ.migrations ?? [];
      L.forEach((M, m) => {
        const tag = `seed ${seed} 第 ${m} 次`;
        const C = civ.cultures[M.culture];
        expect(trekFolk(C, reg.biome), tag).toBe(true);
        expect(M.route.length, tag).toBe(M.years.length);
        expect(M.years[0], tag).toBe(M.year);
        expect(M.route.length - 1, tag).toBeGreaterThanOrEqual(5);
        expect(M.route.length - 1, tag).toBeLessThanOrEqual(20);
        expect(M.size, tag).toBeGreaterThanOrEqual(3);
        expect(M.size, tag).toBeLessThanOrEqual(8);
        // 出发的州是本族的;一州挨一州(陆路:平地、跨河、翻山)
        expect(ownersAt(civ, M.year - 1 / 512).culture[M.route[0]], tag).toBe(M.culture);
        for (let j = 1; j < M.route.length; j++) {
          expect(M.years[j], tag).toBeGreaterThan(M.years[j - 1]);
          let kind = -1;
          for (let e = reg.adjStart[M.route[j - 1]]; e < reg.adjStart[M.route[j - 1] + 1]; e++) if (reg.adj[e] === M.route[j]) kind = reg.adjKind[e];
          expect([AdjKind.Flat, AdjKind.River, AdjKind.Mountain], `${tag} 第 ${j} 段`).toContain(kind);
        }
        const mine = A.filter((e) => e.kind === 'trek' && e.war === m);
        expect(mine[0], tag).toMatchObject({ year: M.year, a: M.culture, region: M.route[0], n: 0 });
        if (M.settled === undefined) {
          expect(M.outcome, tag).toBeUndefined();
          expect(M.years[M.years.length - 1], tag).toBeGreaterThan(civ.endYear);
          return;
        }
        expect(M.settled, tag).toBe(M.years[M.years.length - 1]);
        expect(['found', 'conquer', 'rout'], tag).toContain(M.outcome);
        expect(M.outcomeYear!, tag).toBeGreaterThanOrEqual(M.settled);
        // 落脚的几州改换成迁来的民族
        const after = ownersAt(civ, M.settled);
        for (const r of M.lands ?? []) expect(after.culture[r], tag).toBe(M.culture);
        if (M.polity === undefined) {
          expect(M.outcome, tag).toBe('rout');
          expect(mine.some((e) => e.n === 4), tag).toBe(true);
          return;
        }
        const P = civ.polities[M.polity];
        expect([P.trek, P.culture, P.founded], tag).toEqual([m, M.culture, M.settled]);
        const i2 = A.findIndex((e) => e.kind === 'trek' && e.war === m && e.n === 2);
        expect(A[i2], tag).toMatchObject({ year: M.settled, a: M.culture, b: M.polity });
        expect(A[i2 + 1], tag).toMatchObject({ kind: 'found', a: M.polity, cause: 'trek', year: M.settled });
        for (const r of M.lands ?? []) expect(after.polity[r], tag).toBe(M.polity);
        if (M.war !== undefined) {
          const decl = A.find((e) => e.kind === 'war' && e.war === M.war)!;
          expect([decl.year, decl.a, decl.cause], tag).toEqual([M.settled, M.polity, 'trek']);
          const fallR = A.find((e) => e.kind === 'fall' && e.war === M.war && e.a === M.polity);
          if (M.outcome === 'rout') expect(fallR?.year, tag).toBe(M.outcomeYear);
          if (M.outcome === 'conquer') {
            expect(M.stormed, tag).toBe(decl.b);
            // 打进国都:那国迁都(trek n = 3),或者整个归它(亡国)
            const stormed = A.some((e) => e.kind === 'trek' && e.war === m && e.n === 3 && e.year === M.outcomeYear && e.b === decl.b);
            const fell = A.some((e) => e.kind === 'fall' && e.war === M.war && e.a === decl.b && e.b === M.polity && e.year === M.outcomeYear);
            expect(stormed || fell, tag).toBe(true);
            expect(!!M.big, tag).toBe((M.foeSize ?? 0) >= 25);
          } else expect(M.big, tag).toBeUndefined();
        } else expect(M.outcome, tag).toBe('found');
      });
      // 路上洗劫:那座城同一年有一条折损
      for (const e of A) {
        if (e.kind !== 'trek' || e.n !== 1) continue;
        expect(civ.settlements[e.settlement].sacks?.some((k) => k.year === e.year && !k.cause), `seed ${seed}`).toBe(true);
      }
    }
  }, 60_000);

  it('默认参数 seed 7 / 2024:每个世界 3–6 次、同时在路上不超过两支;两个世界合计打进过大国国都', () => {
    let big = 0;
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const st = trekStats(civ);
      // GENERATOR_VERSION 46:20 个种子(1–20)每个世界 3–5 次,每个世界都至少一次打进大国国都(1–2 次);seed 2024 有 4 次、一次也没打进大国
      expect(st.treks, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      expect(st.treks, `seed ${seed}`).toBeLessThanOrEqual(6);
      expect(st.maxLive, `seed ${seed}`).toBeLessThanOrEqual(2);
      expect(st.meanYears, `seed ${seed}`).toBeGreaterThanOrEqual(5);
      expect(st.meanYears, `seed ${seed}`).toBeLessThanOrEqual(30);
      big += st.stormedBig;
    }
    expect(big).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it('编年史:一次大迁徙折成一条大事(时间轴上归同化一类),展开看动身、洗劫、攻进去、立国、打进国都 / 被打败;那一仗、大崩解照旧单列;措辞干净', () => {
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const list = buildChronicle(civ);
      const firstTrek = new Map<number, number>();
      civ.annals.forEach((e, i) => {
        if (e.kind === 'trek' && !firstTrek.has(e.war)) firstTrek.set(e.war, i);
      });
      const entries = list.filter((e) => [...firstTrek.values()].includes(e.id));
      expect(entries.length, `seed ${seed}`).toBe(civ.migrations!.length);
      for (const e of entries) {
        expect(e.kind).toBe('migrate');
        expect(e.tag).toBe('徙');
        expect(e.importance).toBe(3);
        expect(e.text).toMatch(/^.+族(.+,)?一支举族[东南西北远]徙/);
        // 经过:动身在最前,落脚立国的那条记成立国
        expect(e.children![0].text).toMatch(/分出一支约三成,自.+[东南西北远]去$/);
        expect(e.children![0].tag).toBe('徙');
        const M = civ.migrations![civ.annals[e.id].war];
        if (M.polity !== undefined) {
          const f = e.children!.find((c) => c.kind === 'found')!;
          expect(f.polities[0]).toBe(M.polity);
          expect(f.text).toMatch(/^据.+,立.+/);
          // 年份写起止两头:落脚那年(败散的到亡国那年)
          expect(e.end).toBe(M.outcome === 'rout' ? M.outcomeYear : M.settled);
        }
        if (M.outcome === 'rout' && M.polity !== undefined) expect(e.text).toMatch(/;为.+所败,部众散亡$/);
      }
      // 迁来立的国:立国那条并进大迁徙,不再单列;到了以后那一仗照旧单列一条战争
      for (const M of civ.migrations!) {
        if (M.polity === undefined) continue;
        expect(list.some((e) => e.kind === 'found' && e.polities[0] === M.polity)).toBe(false);
        if (M.war !== undefined) expect(list.some((e) => e.kind === 'war' && civ.annals[e.id]?.war === M.war)).toBe(true);
      }
      // 打进大国国都引起的大崩解另有一条大事:"某某破某城,某国大崩解,……"
      for (const e of list) {
        if (e.kind !== 'collapse') continue;
        const i = civ.annals.findIndex((x, k) => k < e.id && x.kind === 'trek' && x.n === 3 && x.b === civ.annals[e.id].a && x.year === e.year);
        if (i >= 0) expect(e.text).toMatch(/^.+破.+,.+(大崩解|土崩瓦解)/);
      }
      for (const e of flat(entries)) expect(e.text).not.toMatch(/undefined|NaN|某国|某族|-1/);
    }
  }, 60_000);

  it('方位按整条路线实际怎么走定:造出来的路线往西走的是西、往南走的是南;高纬度一路往西走得远的不写成南', () => {
    const geo = geometryOf(world(7).mesh);
    const { width: W, height: H } = world(7).mesh;
    /** 从 (纬度, 经度) 到 (纬度, 经度) 一段一段走过去(n 段),经过的地块 */
    const walk = (lat0: number, lon0: number, lat1: number, lon1: number, n = 12): number[] => {
      const out: number[] = [];
      let hint = 0;
      for (let i = 0; i <= n; i++) {
        const lat = lat0 + ((lat1 - lat0) * i) / n;
        const lon = (((lon0 + ((lon1 - lon0) * i) / n) % 360) + 360) % 360;
        hint = geo.nearest((lon / 360) * W, ((90 - lat) / 180) * H, hint);
        out.push(hint);
      }
      return out;
    };
    expect(trekDir(geo, walk(10, 100, 10, 60))).toBe('西');
    expect(trekDir(geo, walk(20, 40, -25, 42))).toBe('南');
    expect(trekDir(geo, walk(-30, 40, 15, 35))).toBe('北');
    expect(trekDir(geo, walk(45, 300, 50, 340))).toBe('东');
    // 过 180° 经线(世界坐标 x 从右边接到左边)照样是往东 / 往西
    expect(trekDir(geo, walk(30, 160, 32, 200))).toBe('东');
    expect(trekDir(geo, walk(30, 200, 32, 160))).toBe('西');
    // 南纬近 50° 往西走 120 个经度、略往北:出发地到落脚地的大圆初始朝向偏向南极(南比西大),地图上却一路往西
    const far = walk(-49, 325, -44, 205);
    const d = [0, 0];
    const a = far[0];
    const b = far[far.length - 1];
    geo.pointOffset(geo.mesh.x[a], geo.mesh.y[a], geo.mesh.x[b], geo.mesh.y[b], d);
    expect(d[1]).toBeGreaterThan(Math.abs(d[0]));
    expect(trekDir(geo, far)).toBe('西');
  });

  it('seed 7 的克拉尔族一路往西走:记成西,编年史、动身那件都写西徙 / 西去', () => {
    const civ = civOf(7);
    const list = buildChronicle(civ);
    const treks = (civ.migrations ?? []).map((M, m) => ({ M, m })).filter(({ M }) => cultureLabel(civ.cultures[M.culture]) === '克拉尔族');
    expect(treks.length).toBeGreaterThanOrEqual(1);
    for (const { M, m } of treks) {
      expect(M.dir, `第 ${m} 次`).toBe('西');
      const i = civ.annals.findIndex((e) => e.kind === 'trek' && e.war === m);
      const e = list.find((x) => x.id === i)!;
      expect(e.text).toMatch(/一支举族西徙/);
      expect(e.children![0].text).toMatch(/西去$/);
    }
  }, 60_000);

  it('打进国都、那国没整个归它:迁来的一方占着国都一带,那国迁都、议和(大国紧跟着大崩解,崩得成的话)', () => {
    let seen = 0;
    for (const seed of [7, 2024]) {
      const civ = civOf(seed);
      const A = civ.annals;
      A.forEach((e, i) => {
        if (e.kind !== 'trek' || e.n !== 3) return;
        seen++;
        const M = civ.migrations![e.war];
        const before = ownersAt(civ, e.year - 1 / 512).polity;
        const after = ownersAt(civ, e.year).polity;
        expect(before[e.region]).toBe(e.b);
        expect(after[e.region]).toBe(M.polity);
        // 那国还在,迁了都
        const Y = civ.polities[e.b];
        expect(Y.ended === undefined || Y.ended > e.year).toBe(true);
        expect(Y.capitals!.some((c) => c.year === e.year)).toBe(true);
        // 同一刻议和(那一仗到此为止)
        expect(A.slice(i + 1).some((x) => x.year === e.year && x.kind === 'peace' && x.war === M.war)).toBe(true);
      });
      // 落脚的州没有被记成民族层"无人"
      for (const M of civ.migrations ?? []) for (const r of M.lands ?? []) expect(ownersAt(civ, M.settled!).culture[r]).not.toBe(-1);
    }
    expect(seen).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

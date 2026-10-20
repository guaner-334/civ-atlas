/**
 * 航线与航海时代:州图上的航线只连各州的出海口;推演里走过的海峡、航线都画了出来(routes.ts 的 usedLanes);
 * 海洋国家从来就能渡海;普通国家从自己国都的运输能力够了那一刻(Polity.sail,发展度定)起,有港口的也沿航线往海外扩张
 * (polities.ts 的 sailsOcean);接着推跨过那一刻照样一致。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type WorldParams, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { AdjKind, Layer } from '../src/gen/civ/types';
import { CivSim, Ev } from '../src/gen/civ/sim';
import { polityModelOf } from '../src/gen/civ/polities';
import { seaPassable, usedLanes } from '../src/gen/civ/routes';
import { ruinSites } from '../src/gen/civ/growth';

const small = { ...DEFAULT_PARAMS, cells: 12000 };

const worlds = new Map<string, World>();
function world(p: WorldParams): World {
  const key = JSON.stringify(p);
  let w = worlds.get(key);
  if (!w) worlds.set(key, (w = generateWorld(p)));
  return w;
}
const civs = new Map<string, Civ>();
function civOf(p: WorldParams): Civ {
  const key = JSON.stringify(p);
  let c = civs.get(key);
  if (!c) civs.set(key, (c = generateCiv(world(p))));
  return c;
}

function bytes(a: ArrayBufferView) {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength);
}

describe('航线与航海时代', () => {
  it('州图上的海峡、航线:两头各有一块挨着能通航的海的海岸地块;航线不连陆上相邻的两州', () => {
    for (const seed of [7, 2024]) {
      const w = world({ ...DEFAULT_PARAMS, seed });
      const reg = civOf({ ...DEFAULT_PARAMS, seed }).regions;
      const { adjStart, adj } = w.mesh;
      let lanes = 0;
      for (let r = 0; r < reg.count; r++) {
        const land = new Set<number>();
        for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) if (reg.adjKind[k] <= AdjKind.Mountain) land.add(reg.adj[k]);
        for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
          const kind = reg.adjKind[k];
          const c = reg.adjCoast[k];
          if (kind <= AdjKind.Mountain) {
            expect(c).toBe(-1);
            continue;
          }
          expect(reg.of[c], `seed ${seed} 州 ${r}`).toBe(r);
          let coast = false;
          for (let q = adjStart[c]; q < adjStart[c + 1]; q++) if (seaPassable(w, adj[q])) coast = true;
          expect(coast).toBe(true);
          if (kind === AdjKind.SeaRoute) {
            lanes++;
            expect(land.has(reg.adj[k])).toBe(false);
          }
        }
      }
      expect(lanes, `seed ${seed}`).toBeGreaterThan(50);
    }
  }, 60_000);

  it('推演里走过的海峡、航线都画出来了:两头的海岸在走过的那一年已经由画出来的航线连着(登岸处那年是遗址的不画)', () => {
    for (const seed of [7, 2024]) {
      const civ = civOf({ ...DEFAULT_PARAMS, seed });
      const used = usedLanes(civ.regions, civ.log, civ.cultures);
      expect(used.length).toBeGreaterThan(20);
      const sea = civ.routes.filter((r) => r.kind === 'sea');
      const n = civ.regions.of.length;
      for (const L of used) {
        const ruins = new Set(ruinSites(civ, L.built).map((s) => s.cell));
        if (ruins.has(L.a) || ruins.has(L.b)) continue;
        const par = new Int32Array(n).map((_, i) => i);
        const find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
        for (const r of sea) {
          if (r.built > L.built || (r.abandoned !== undefined && r.abandoned <= L.built)) continue;
          for (let t = 1; t < r.cells.length; t++) par[find(r.cells[t])] = find(r.cells[t - 1]);
        }
        expect(find(L.a) === find(L.b), `seed ${seed} 第 ${L.built} 年 ${L.a}–${L.b}`).toBe(true);
      }
    }
  }, 60_000);

  it('普通国家能远洋以前不渡海;以后有港口的沿航线拿下海外的州(从港口出发)', () => {
    let after = 0;
    for (const seed of [7, 2024, 3]) {
      const civ = civOf({ ...small, seed });
      expect(civ.sailFrom).toBe(Infinity);
      const reg = civ.regions;
      const own = new Int16Array(reg.count).fill(-1);
      const L = civ.log;
      for (let i = 0; i < L.size; i++) {
        if (L.layer[i] !== Layer.Polity) continue;
        const r = L.region[i];
        const v = L.value[i];
        if (L.cause[i] === Ev.PolityArrive && civ.polities[v].kind !== 'sea') {
          // 普通国家扩张进来的州:挨着本国的边里有陆上的,或者是航海时代以后的海峡、港口出发的航线
          let land = false;
          let bySea = false;
          for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
            if (own[reg.adj[k]] !== v) continue;
            if (reg.adjKind[k] <= AdjKind.Mountain) land = true;
            else bySea = true;
          }
          expect(land || (bySea && L.year[i] >= (civ.polities[v].sail ?? Infinity)), `seed ${seed} 第 ${L.year[i]} 年州 ${r}`).toBe(true);
          if (!land) after++;
        }
        own[r] = v;
      }
    }
    expect(after).toBeGreaterThan(0);
  }, 60_000);

  it('fromCiv 接着推:在最早有普通国家能远洋的那一刻前后切开,和一口气推完逐字节一致', () => {
    for (const seed of [7, 2024]) {
      const w = world({ ...small, seed });
      const whole = civOf({ ...small, seed });
      const S = Math.min(...whole.polities.map((p) => p.sail ?? Infinity));
      expect(S).toBeLessThan(whole.endYear);
      for (const cut of [S - 1 / 256, S, S + 200]) {
        const half = generateCiv(w, { endYear: cut });
        const sim = CivSim.fromCiv(w, half);
        sim.run(whole.endYear);
        const res = sim.result();
        const tag = `seed ${seed} 从第 ${cut} 年接着推`;
        expect(res.log.size, tag).toBe(whole.log.size);
        for (const k of ['year', 'region', 'layer', 'value', 'cause'] as const) {
          expect(bytes(res.log[k]).equals(bytes(whole.log[k].subarray(0, whole.log.size))), `${tag}:日志 ${k}`).toBe(true);
        }
        expect(JSON.stringify(res.annals), tag).toBe(JSON.stringify(whole.annals));
        const strip = <T extends { name: string; color?: unknown; dynasties?: { name: string }[] }>(a: T[]) =>
          a.map((x) => ({ ...x, name: '', color: 0, eastern: undefined, dynasties: x.dynasties?.map((d) => ({ ...d, name: '' })) }));
        expect(JSON.stringify(strip(polityModelOf(sim)!.polities)), tag).toBe(JSON.stringify(strip(whole.polities)));
      }
    }
  }, 120_000);
});

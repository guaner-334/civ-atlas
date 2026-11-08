/**
 * 地图插件的三个口子(gen/mapHooks.ts):没插件时和原来一样、同一种子两遍一样、改了的结果对、压范围、陆海翻转、
 * 出图层收得到、交回坏数报哪个插件哪一口、改地形走缓存和从头生成一样、没改地形的星球带上插件。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, generateWorldSteps, type BaseCache, type World } from '../src/gen/world';
import { MAP_LAYERS_MAX, MapPluginError, climateHooks, heightHooks, layerHooks, type MapPlugin, type MapStage } from '../src/gen/mapHooks';
import { worldCheck } from '../src/gen/savefile';
import { generateCiv, planetTempo, type Civ } from '../src/gen/civ';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import type { TerrainOp } from '../src/gen/edits';
import { MAP_LAYERS_MAX as MANIFEST_LAYERS_MAX } from '../src/plugin/pluginMap';

const P = { ...DEFAULT_PARAMS, cells: 6000, seed: 7 };
let plain: World | undefined;
const plain7 = () => (plain ??= generateWorld(P));

/** 赤道两边的海抬成陆地、北纬 55–60° 的陆地沉成海,剩下的最高峰再高 700 米 */
function ridge(calls?: { n: number }, key = 'ridge@1'): MapPlugin {
  return {
    id: 'ridge',
    key,
    stages: ['height'],
    height(d) {
      if (calls) calls.n++;
      const e = d.elevation.slice();
      for (let i = 0; i < d.n; i++) {
        if (Math.abs(d.lat[i]) < 6 && !d.land[i]) e[i] = 400 + 200 * d.rand(i);
        else if (d.lat[i] > 55 && d.lat[i] < 60 && d.land[i]) e[i] = -30;
      }
      let top = -1;
      for (let i = 0; i < d.n; i++) if (e[i] > 0 && (top < 0 || e[i] > e[top])) top = i;
      e[top] += 700;
      return { elevation: e };
    },
  };
}

function errOf(f: () => unknown): MapPluginError {
  try {
    f();
  } catch (e) {
    if (e instanceof MapPluginError) return e;
    throw e;
  }
  throw new Error('没有出错');
}

const one = (stage: MapStage, fn: (d: never) => unknown, extra: Partial<MapPlugin> = {}): MapPlugin => ({ id: 'bad', key: 'bad@1', stages: [stage], [stage]: fn, ...extra });

describe('没装地图插件', () => {
  it('给空的一串和不给一样,世界上不多字段', () => {
    const w = generateWorld(P, undefined, undefined, undefined, undefined, []);
    expect(worldCheck(w)).toBe(worldCheck(plain7()));
    expect(Object.keys(w).sort()).toEqual(Object.keys(plain7()).sort());
    expect(w.mapPlugins).toBeUndefined();
    expect(w.mapLayers).toBeUndefined();
  });
});

describe('改海拔', () => {
  it('同一种子两遍一样;海抬成陆地、陆地沉成海;世界记下插件', () => {
    const w0 = plain7();
    const a = generateWorld(P, undefined, undefined, undefined, undefined, [ridge()]);
    const b = generateWorld(P, undefined, undefined, undefined, undefined, [ridge()]);
    expect(worldCheck(a)).toBe(worldCheck(b));
    expect(worldCheck(a)).not.toBe(worldCheck(w0));
    expect(a.mapPlugins).toEqual(['ridge@1']);
    let raised = 0;
    let sunk = 0;
    for (let i = 0; i < w0.mesh.n; i++) {
      const lat = 90 - (180 * w0.mesh.y[i]) / w0.mesh.height;
      if (Math.abs(lat) < 6 && !w0.tect.land[i]) {
        raised++;
        expect(a.tect.land[i]).toBe(1);
        expect(a.water[i]).not.toBe(1);
      } else if (lat > 55 && lat < 60 && w0.tect.land[i]) {
        sunk++;
        expect(a.tect.land[i]).toBe(0);
        expect(a.water[i]).toBe(1);
      }
    }
    expect(raised).toBeGreaterThan(50);
    expect(sunk).toBeGreaterThan(5);
    expect(a.maxElevation).toBeGreaterThan(w0.maxElevation + 600);
  });

  it('回放帧加上同样的差值', () => {
    const w0 = plain7();
    const a = generateWorld(P, undefined, undefined, undefined, undefined, [ridge()]);
    expect(a.history.length).toBe(w0.history.length);
    const last = a.history.length - 1;
    let moved = 0;
    for (let i = 0; i < w0.mesh.n; i++) {
      const d = a.history[last][i] - w0.history[last][i];
      if (d !== 0) moved++;
      for (let f = 0; f < last; f++) expect(Math.abs(a.history[f][i] - w0.history[f][i] - d)).toBeLessThan(0.01);
    }
    expect(moved).toBeGreaterThan(50);
  });

  it('插件改了递进去的数组(连同网格)也不影响世界', () => {
    const w0 = plain7();
    const mesh0 = { xyz: w0.mesh.xyz.slice(), adj: w0.mesh.adj.slice(), adjStart: w0.mesh.adjStart.slice() };
    const vandal: MapPlugin = {
      id: 'vandal',
      key: 'vandal@1',
      stages: ['height', 'climate', 'layers'],
      height: (d) => void (d.elevation.fill(0), d.land.fill(0), d.plate.fill(0), d.xyz.fill(0), d.adj.fill(0), d.adjStart.fill(0)),
      climate: (d) => void (d.temperature.fill(0), d.precipitation.fill(0), d.water.fill(1)),
      layers: (d) => void (d.biome.fill(0), d.flux.fill(0), d.riverCells.fill(0)),
    };
    const w = generateWorld(P, undefined, undefined, undefined, undefined, [vandal]);
    expect(worldCheck(w)).toBe(worldCheck(w0));
    expect(w.flux).toEqual(w0.flux);
    expect({ xyz: w.mesh.xyz, adj: w.mesh.adj, adjStart: w.mesh.adjStart }).toEqual(mesh0);
  });

  it('压到 −11000…9000 米;没给 land 时只翻改过的地块', () => {
    const { mesh } = plain7();
    const n = mesh.n;
    const elevation = new Float32Array(n).fill(100);
    const land = new Uint8Array(n).fill(1);
    elevation[1] = -100;
    land[1] = 0;
    elevation[4] = -5; // 没改的地块哪怕海陆和海拔对不上也不动
    heightHooks(
      [
        one('height', () => {
          const e = elevation.slice();
          e[0] = 20000;
          e[1] = 50;
          e[2] = 0;
          e[3] = -20000;
          return { elevation: e };
        }),
      ],
      mesh,
      7,
      elevation,
      land,
      new Int16Array(n),
    );
    expect([elevation[0], elevation[1], elevation[2], elevation[3], elevation[4]]).toEqual([9000, 50, 0, -11000, -5]);
    expect([land[0], land[1], land[2], land[3], land[4], land[5]]).toEqual([1, 1, 0, 0, 1, 1]);
    // 给了 land 就照它
    heightHooks([one('height', () => ({ land: new Uint8Array(n) }))], mesh, 7, elevation, land, new Int16Array(n));
    expect(land.every((x) => x === 0)).toBe(true);
    expect(elevation[0]).toBe(9000);
  });

  it('交回坏数、出错:说哪个插件、哪一口', () => {
    const { mesh } = plain7();
    const n = mesh.n;
    const run = (pl: MapPlugin) => () => heightHooks([pl], mesh, 7, new Float32Array(n), new Uint8Array(n), new Int16Array(n));
    const cases: [MapPlugin, RegExp][] = [
      [one('height', () => ({ elevation: new Float32Array(n).fill(NaN) })), /有限/],
      [one('height', () => ({ elevation: new Float32Array(n - 1) })), /长度/],
      [one('height', () => ({ elevation: [Infinity] })), /长度/],
      [one('height', () => ({ land: new Uint8Array(n).fill(2) })), /0 或 1/],
      [one('height', () => 3), /不是对象/],
      [
        one('height', () => {
          throw new Error('坏了');
        }),
        /坏了/,
      ],
      [{ id: 'bad', key: 'bad@1', stages: ['height'] }, /没有这一步/],
    ];
    for (const [pl, why] of cases) {
      const e = errOf(run(pl));
      expect(e.plugin).toBe('bad');
      expect(e.stage).toBe('height');
      expect(e.message).toMatch(why);
      expect(e.message).toContain('bad');
      // 插件自己抛的、没写这一步算「插件报的错」,别的是网站查出来的「交回的数不对」
      expect(e.kind).toBe(/坏了|没有这一步/.test(e.why) ? 'throw' : 'bad');
    }
    // 整个生成里出错也一样
    const e = errOf(() => generateWorld(P, undefined, undefined, undefined, undefined, [one('height', () => ({ elevation: new Float32Array(3) }))]));
    expect([e.plugin, e.stage]).toEqual(['bad', 'height']);
  });

  it('改地形涂一笔走缓存的前一半,和从头生成一样;换了插件不用别的缓存', () => {
    const calls = { n: 0 };
    const pl = ridge(calls);
    const cache: BaseCache = { base: null };
    generateWorld(P, undefined, [], null, cache, [pl]);
    expect(calls.n).toBe(1);
    const ops: TerrainOp[] = [
      { kind: 'lake', pts: [1024, 300], r: 20, s: 1 },
      { kind: 'wet', pts: [900, 400, 1000, 400], r: 30, s: 1 },
      { kind: 'lift', pts: [700, 350, 760, 360], r: 30, s: 1 },
    ];
    const a = generateWorld(P, undefined, ops, null, cache, [pl]);
    expect(calls.n).toBe(1);
    const b = generateWorld(P, undefined, ops, null, undefined, [pl]);
    expect(calls.n).toBe(2);
    expect(worldCheck(a)).toBe(worldCheck(b));
    expect(a.history).toEqual(b.history);
    // 没插件时记的前一半不给带插件的用
    const c0: BaseCache = { base: null };
    generateWorld(P, undefined, [], null, c0);
    const c = generateWorld(P, undefined, ops, null, c0, [pl]);
    expect(calls.n).toBe(3);
    expect(worldCheck(c)).toBe(worldCheck(b));
  });

  it('放火山的世界最高海拔照带插件的同一颗星球', () => {
    const volcano: TerrainOp = { kind: 'volcano', pts: [1100, 380], r: 22, s: 1 };
    const pl = ridge(undefined, 'ridge@peak');
    const planet = generateWorld(P, undefined, undefined, undefined, undefined, [pl]);
    const edited = generateWorld(P, undefined, [volcano], null, undefined, [pl]);
    expect(edited.maxElevation).toBe(planet.maxElevation);
    expect(edited.maxElevation).not.toBe(generateWorld(P, undefined, [volcano]).maxElevation);
  });
});

describe('改气候', () => {
  it('改的气温、降水套上(压范围),海拔水系不变;夏冬两半平均是年降水', () => {
    const w0 = plain7();
    let halfErr = 0;
    let differ = 0;
    const cool: MapPlugin = {
      id: 'cool',
      key: 'cool@1',
      stages: ['climate'],
      climate(d) {
        for (let i = 0; i < d.n; i++) {
          const avg = 0.5 * d.rainSummer[i] + 0.5 * d.rainWinter[i];
          halfErr = Math.max(halfErr, Math.abs(avg - d.precipitation[i]) / Math.max(1, d.precipitation[i]));
          if (Math.abs(d.rainSummer[i] - d.rainWinter[i]) > 50) differ++;
        }
        const p = d.precipitation.slice();
        for (let i = 0; i < d.n; i++) if (d.lat[i] > 0 && d.water[i] === 0) p[i] = 99999;
        return { temperature: Array.from(d.temperature, (t) => t - 80), precipitation: p };
      },
    };
    const a = generateWorld(P, undefined, undefined, undefined, undefined, [cool]);
    expect(halfErr).toBeLessThan(1e-5);
    expect(differ).toBeGreaterThan(100);
    expect(a.elevation).toEqual(w0.elevation);
    expect(a.water).toEqual(w0.water);
    let north = 0;
    for (let i = 0; i < w0.mesh.n; i++) {
      expect(a.temperature[i]).toBe(Math.fround(Math.max(-70, w0.temperature[i] - 80)));
      const lat = 90 - (180 * w0.mesh.y[i]) / w0.mesh.height;
      if (lat > 0 && w0.water[i] === 0) {
        north++;
        expect(a.precipitation[i]).toBe(15000);
      } else expect(a.precipitation[i]).toBe(w0.precipitation[i]);
    }
    expect(north).toBeGreaterThan(100);
    expect(a.biome).not.toEqual(w0.biome);
    expect(worldCheck(generateWorld(P, undefined, undefined, undefined, undefined, [cool]))).toBe(worldCheck(a));
  });

  it('同一口按先后:后一个看到前一个改过的', () => {
    const w0 = plain7();
    let seen: Float32Array | null = null;
    const first: MapPlugin = { id: 'a', key: 'a@1', stages: ['climate'], climate: (d) => ({ temperature: d.temperature.map((t) => t + 1) }) };
    const second: MapPlugin = {
      id: 'b',
      key: 'b@1',
      stages: ['climate'],
      climate: (d) => {
        seen = d.temperature.slice();
        return undefined;
      },
    };
    const w = generateWorld(P, undefined, undefined, undefined, undefined, [first, second]);
    expect(seen).toEqual(w.temperature);
    expect(w.temperature[0]).toBe(Math.fround(w0.temperature[0] + 1));
    expect(w.mapPlugins).toEqual(['a@1', 'b@1']);
  });

  it('交回坏数报插件和口子', () => {
    const w = plain7();
    const n = w.mesh.n;
    const c = () => ({
      elevation: w.elevation,
      water: w.water,
      temperature: w.temperature.slice(),
      precipitation: w.precipitation.slice(),
      windX: new Float32Array(n),
      windY: new Float32Array(n),
      rainSummer: new Float32Array(n),
      rainWinter: new Float32Array(n),
    });
    const e1 = errOf(() => climateHooks([one('climate', () => ({ precipitation: new Float32Array(n).fill(-Infinity) }))], w.mesh, 7, c()));
    expect([e1.plugin, e1.stage]).toEqual(['bad', 'climate']);
    const e2 = errOf(() => climateHooks([one('climate', () => ({ temperature: new Float32Array(2) }))], w.mesh, 7, c()));
    expect(e2.message).toMatch(/长度/);
  });
});

describe('出图层', () => {
  const look: MapPlugin = {
    id: 'look',
    key: 'look@1',
    stages: ['layers'],
    layerIds: ['warm', 'river-count'],
    layers(d) {
      const warm = new Float32Array(d.n).fill(NaN);
      for (let i = 0; i < d.n; i++) if (d.water[i] === 0) warm[i] = d.temperature[i];
      const rc = new Float32Array(d.n);
      for (let k = 0; k + 1 < d.riverStart.length; k++) for (let j = d.riverStart[k]; j < d.riverStart[k + 1]; j++) rc[d.riverCells[j]]++;
      expect(d.biomeNames.length).toBeGreaterThan(10);
      return { layers: { 'river-count': rc, warm } };
    },
  };

  it('收得到,按登记的先后;地图一位不变', () => {
    const w0 = plain7();
    const a = generateWorld(P, undefined, undefined, undefined, undefined, [look]);
    expect(worldCheck(a)).toBe(worldCheck(w0));
    expect(a.temperature).toEqual(w0.temperature);
    expect(a.mapLayers?.map((l) => [l.by, l.id])).toEqual([
      ['look', 'warm'],
      ['look', 'river-count'],
    ]);
    const [warm, rc] = a.mapLayers!;
    for (let i = 0; i < w0.mesh.n; i++) {
      if (w0.water[i] === 0) expect(warm.values[i]).toBe(w0.temperature[i]);
      else expect(warm.values[i]).toBeNaN();
    }
    const total = w0.rivers.reduce((s, r) => s + r.cells.length, 0);
    expect(rc.values.reduce((s, x) => s + x, 0)).toBe(total);
  });

  it('图层在最后一段才算(地图可以先交)', () => {
    let ran = false;
    const pl: MapPlugin = { ...look, layers: (d) => ((ran = true), look.layers!(d)) };
    const it = generateWorldSteps(P, undefined, undefined, undefined, undefined, [pl]);
    let r = it.next();
    let ranBeforeLast = true;
    while (!r.done) {
      ranBeforeLast = ran;
      r = it.next();
    }
    expect(ranBeforeLast).toBe(false);
    expect(ran).toBe(true);
    expect(r.value.mapLayers).toHaveLength(2);
  });

  it('每个插件最多几张图层和清单的规矩一样', () => {
    expect(MAP_LAYERS_MAX).toBe(MANIFEST_LAYERS_MAX);
  });

  it('没登记的、太多张、无穷大、长度不对:报插件和口子', () => {
    const w = plain7();
    const n = w.mesh.n;
    const fields = {
      elevation: w.elevation,
      water: w.water,
      temperature: w.temperature,
      precipitation: w.precipitation,
      windX: new Float32Array(n),
      windY: new Float32Array(n),
      rainSummer: new Float32Array(n),
      rainWinter: new Float32Array(n),
      plate: w.tect.plate,
      waterLevel: w.waterLevel,
      seaIce: w.seaIce,
      biome: w.biome,
      flux: w.flux,
      riverThreshold: w.riverThreshold,
      rivers: w.rivers,
    };
    const ids = Array.from({ length: MAP_LAYERS_MAX + 1 }, (_, k) => `l${k}`);
    const cases: [MapPlugin, RegExp][] = [
      [one('layers', () => ({ layers: { nope: new Float32Array(n) } }), { layerIds: ['x'] }), /没在清单里登记/],
      [one('layers', () => ({ layers: Object.fromEntries(ids.map((id) => [id, new Float32Array(n)])) }), { layerIds: ids }), /最多/],
      [one('layers', () => ({ layers: { x: new Float32Array(n).fill(Infinity) } }), { layerIds: ['x'] }), /无穷大/],
      [one('layers', () => ({ layers: { x: new Float64Array(n).fill(1e100) } }), { layerIds: ['x'] }), /无穷大/],
      [one('layers', () => ({ layers: { x: new Float32Array(1) } }), { layerIds: ['x'] }), /长度/],
      [one('layers', () => ({ layers: [] }), { layerIds: ['x'] }), /图层编号/],
    ];
    for (const [pl, why] of cases) {
      const e = errOf(() => layerHooks([pl], w.mesh, 7, fields));
      expect([e.plugin, e.stage]).toEqual(['bad', 'layers']);
      expect(e.message).toMatch(why);
    }
  });
});

describe('没改地形的星球带上地图插件', () => {
  const sink: TerrainOp = { kind: 'sink', pts: [1100, 380], r: 20, s: 0.4 };
  const short = { endYear: 60 };
  const sum = (c: Civ) => JSON.stringify([c.places.map((p) => p.name), c.settlements.map((s) => s.name), c.polities.map((p) => p.name), c.cultures.map((x) => x.name)]);

  it('没带上世界用的地图插件就推不了改过地形的历史', () => {
    const w = generateWorld(P, undefined, [sink], null, undefined, [ridge(undefined, 'ridge@civ0')]);
    expect(() => generateCiv(w, short)).toThrow(/地图插件/);
    expect(() => generateCiv(w, { ...short, mapPlugins: [ridge(undefined, 'ridge@other')] })).toThrow(/地图插件/);
  });

  it('扩张节拍照带插件的星球(和先算好传进去一样),地名参照也重长带插件的星球', () => {
    const calls = { n: 0 };
    const pl = ridge(calls, 'ridge@civ');
    const w = generateWorld(P, undefined, [sink], null, undefined, [pl]);
    const tempo = planetTempo(P, {}, null, [pl]);
    expect(tempo).toBeDefined();
    const before = calls.n;
    const a = generateCiv(w, { ...short, mapPlugins: [pl] });
    // 扩张节拍、地名参照各重长一遍星球
    expect(calls.n).toBeGreaterThan(before);
    const b = generateCiv(w, { ...short, mapPlugins: [pl], tempo: tempo ?? null });
    expect(sum(b)).toBe(sum(a));
    expect(generateCiv(w, { ...short, mapPlugins: [pl] }).seed).toBe(a.seed);
  });

  it('长来对照的星球不出图层', () => {
    const calls = { n: 0 };
    let layered = 0;
    const pl: MapPlugin = {
      ...ridge(calls, 'ridge@layers'),
      stages: ['height', 'layers'],
      layerIds: ['x'],
      layers: (d) => {
        layered++;
        return { layers: { x: d.temperature } };
      },
    };
    planetTempo(P, {}, null, [pl]);
    expect([calls.n, layered]).toEqual([1, 0]);
    const w = generateWorld(P, undefined, undefined, undefined, undefined, [pl]);
    expect([calls.n, layered]).toEqual([2, 1]);
    expect(w.mapLayers).toHaveLength(1);
  });

  it('地形大事的各步也带插件', () => {
    const pl = ridge(undefined, 'ridge@up');
    const steps = upheavalSteps(P, [], null, [{ year: 100, ops: [sink] }], { mapPlugins: [pl] });
    expect(steps).toHaveLength(1);
    expect(steps[0].world.mapPlugins).toEqual(['ridge@up']);
    expect(worldCheck(steps[0].world)).toBe(worldCheck(generateWorld(P, undefined, [sink], null, undefined, [pl])));
  });
});

/**
 * 地图插件清单 map.reads 写了才递的那批数(src/gen/mapReads.ts):没写的一样不递、默认递的不变;
 * 写了的在该有的那几口递、和世界里的数对得上;只读,不改长出来的地图;经 QuickJS 一样递得进去,第二批帮手在 QuickJS 里也和直接算一样
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import type { MapPlugin, MapStage } from '../src/gen/mapHooks';
import { MAP_READS } from '../src/gen/mapReads';
import { mapHelpers } from '../src/gen/mapHelpers';
import { quickjsMapPlugin } from '../src/gen/quickjs/map';
import { Biome } from '../src/gen/biomes';
import { KM_PER_UNIT } from '../src/gen/civ/scale';
import type { TerrainOp } from '../src/gen/edits';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { mapDigest } from './lib/mapPins';

const P = { ...DEFAULT_PARAMS, cells: 6000, seed: 7 };
const ALL_READS = Object.keys(MAP_READS);
const STAGES: MapStage[] = ['height', 'climate', 'layers'];

const HELPERS = ['noise', 'blur', 'steps', 'near', 'km', 'ridged', 'flow', 'distance', 'components', 'slope', 'cellAt', 'line', 'westEast', 'biomeOf'];
const SHARED = ['n', 'lat', 'lon', 'xyz', 'adjStart', 'adj', 'kmPerUnit', 'seed', 'rand', ...HELPERS];
const CLIMATE = [...SHARED, 'elevation', 'water', 'temperature', 'precipitation', 'windX', 'windY', 'rainSummer', 'rainWinter'];
const DEFAULT_KEYS: Record<MapStage, string[]> = {
  height: [...SHARED, 'elevation', 'land', 'plate'],
  climate: CLIMATE,
  layers: [...CLIMATE, 'plate', 'waterLevel', 'seaIce', 'biome', 'biomeNames', 'flux', 'riverThreshold', 'riverCells', 'riverStart'],
};

type Seen = Partial<Record<MapStage, Record<string, unknown>>>;

/** 三口都出手、什么都不改,记下每一口递进来的 */
function watcher(reads?: string[], key = 'w@1'): { pl: MapPlugin; seen: Seen } {
  const seen: Seen = {};
  const keep = (st: MapStage) => (d: object) => {
    seen[st] = { ...(d as Record<string, unknown>) };
    return undefined;
  };
  const pl: MapPlugin = { id: 'w', key, stages: STAGES, layerIds: [], ...(reads ? { reads } : {}), height: keep('height'), climate: keep('climate'), layers: keep('layers') };
  return { pl, seen };
}

function grow(reads?: string[], terrain?: TerrainOp[]): { w: World; seen: Seen } {
  const { pl, seen } = watcher(reads);
  const w = generateWorld(P, undefined, terrain, undefined, undefined, [pl]);
  return { w, seen };
}

const sorted = (a: string[]) => [...a].sort();

describe('没写 map.reads', () => {
  it('每一口递的和以前一样,一样不多', () => {
    const { seen } = grow();
    for (const st of STAGES) expect(sorted(Object.keys(seen[st]!)), st).toEqual(sorted(DEFAULT_KEYS[st]));
  });
});

describe('写了 map.reads', () => {
  it('每一口只多递写了的、这一口有的', () => {
    const { seen } = grow(ALL_READS);
    for (const st of STAGES) {
      const extra = ALL_READS.filter((r) => MAP_READS[r].includes(st));
      expect(sorted(Object.keys(seen[st]!)), st).toEqual(sorted([...DEFAULT_KEYS[st], ...extra]));
    }
    expect(Object.keys(grow(['cellArea', 'downstream']).seen.climate!)).not.toContain('downstream');
  });

  it('板块、面积、世界参数和世界里的一样(距离换成公里,没有那种边界是 −1)', () => {
    const { w, seen } = grow(ALL_READS);
    const t = w.tect;
    for (const st of STAGES) {
      const d = seen[st]!;
      expect(d.plateVx).toEqual(t.plateVx);
      expect(d.plateVy).toEqual(t.plateVy);
      expect(d.plateOmega).toEqual(t.plateOmega);
      expect(d.plateContinental).toEqual(t.plateContinental);
      expect(d.convergence).toEqual(t.convergence);
      expect(d.uplift).toEqual(t.uplift);
      expect(d.plateau).toEqual(t.plateau);
      expect(d.oceanDepth).toEqual(t.oceanDepth);
      expect(d.convergentStrength).toEqual(t.strengthConv);
      expect(d.divergentStrength).toEqual(t.strengthDiv);
      expect(d.convergentKm).toEqual(Float32Array.from(t.distConv, (x) => (x === Infinity ? -1 : x * KM_PER_UNIT)));
      expect(d.divergentKm).toEqual(Float32Array.from(t.distDiv, (x) => (x === Infinity ? -1 : x * KM_PER_UNIT)));
      expect(d.worldParams).toEqual(P);
      expect((d.edited as Uint8Array).every((x) => x === 0)).toBe(true);
    }
    const area = seen.height!.cellArea as Float32Array;
    const R = (w.mesh.width / (2 * Math.PI)) * KM_PER_UNIT;
    expect(area.reduce((s, x) => s + x, 0) / (4 * Math.PI * R * R)).toBeCloseTo(1, 3);
    expect((seen.height!.plateVx as Float32Array).length).toBe(t.plateCount);
    expect((seen.height!.convergentKm as Float32Array).some((x) => x > 1000)).toBe(true);
  });

  it('洋流从改气候那一口起;流向、灌满的水面、产水、湿地、最高海拔在出图层那一口,和世界对得上', () => {
    const { w, seen } = grow(ALL_READS);
    for (const st of ['climate', 'layers'] as const) {
      expect(seen[st]!.currentU).toEqual(w.currents.u);
      expect(seen[st]!.currentV).toEqual(w.currents.v);
      expect(seen[st]!.currentTemp).toEqual(w.currents.sst);
    }
    const d = seen.layers!;
    expect(d.maxElevation).toBe(w.maxElevation);
    // 拿递进来的流向、产水,和帮手照官方的海陆重算的一样;汇流量就是世界的径流
    const n = w.mesh.n;
    const land = Uint8Array.from(w.water, (x) => (x === 1 ? 0 : 1));
    const f = mapHelpers(w.mesh, P.seed, 'w').flow(w.elevation, land, d.runoff as Float32Array);
    expect(d.downstream).toEqual(f.downstream);
    expect(f.flux).toEqual(w.flux);
    const runoff = d.runoff as Float32Array;
    for (let i = 0; i < n; i++) if (w.water[i] === 1) expect(runoff[i]).toBe(0);
    const wet = d.wetland as Float32Array;
    for (let i = 0; i < n; i++) expect(w.biome[i] === Biome.Wetland).toBe(w.water[i] === 0 && wet[i] >= 0.5);
    const fill = d.fillLevel as Float32Array;
    let lakes = 0;
    let same = 0;
    for (let i = 0; i < n; i++) {
      if (w.water[i] !== 2) continue;
      lakes++;
      if (fill[i] === w.waterLevel[i]) same++;
    }
    expect(lakes).toBeGreaterThan(0);
    expect(same / lakes).toBeGreaterThan(0.8);
  });

  it('作者改过的地块:改海拔那一口有火山、抬起;后两口再加挖的湖、高度笔', () => {
    const terrain: TerrainOp[] = [
      { kind: 'volcano', pts: [600, 300], r: 20, s: 1 },
      { kind: 'lake', pts: [1400, 400], r: 14, s: 1 },
      { kind: 'lift', pts: [300, 700, 340, 700], r: 20, s: 0.6 },
    ];
    const { w, seen } = grow(['edited'], terrain);
    const h = seen.height!.edited as Uint8Array;
    const l = seen.layers!.edited as Uint8Array;
    expect(seen.climate!.edited).toEqual(l);
    const count = (a: Uint8Array) => a.reduce((s, x) => s + x, 0);
    expect(count(h)).toBeGreaterThan(0);
    expect(count(l)).toBeGreaterThan(count(h));
    for (let i = 0; i < w.mesh.n; i++) if (h[i]) expect(l[i]).toBe(1);
    // 离三笔都远的地方没标
    const geo = mapHelpers(w.mesh, P.seed, 'w');
    const marks = [geo.cellAt(90 - (180 * 300) / w.mesh.height, (360 * 600) / w.mesh.width - 180)];
    expect(h[marks[0]]).toBe(1);
    const far = geo.cellAt(-60, 170);
    expect(l[far]).toBe(0);
  });

  it('只读:带不带 reads 长出的地图一模一样', () => {
    const plain = generateWorld(P, undefined, undefined, undefined, undefined, [watcher().pl]);
    const read = generateWorld(P, undefined, undefined, undefined, undefined, [watcher(ALL_READS).pl]);
    expect(mapDigest(read)).toBe(mapDigest(plain));
    expect(mapDigest({ ...plain, mapPlugins: undefined })).toBe(mapDigest(generateWorld(P)));
  });
});

describe('经 QuickJS', () => {
  it('写了的读数递得进去;第二批帮手交回的对象、数组和网站这头直接算的一样', async () => {
    const code = `civAtlas.map({ layers(d) {
      const land = d.water.map((x) => (x === 1 ? 0 : 1));
      const f = d.flow(d.elevation, land, d.runoff);
      const dist = d.distance(d.water.map((x) => (x === 2 ? 1 : 0)));
      const comp = d.components(land);
      const we = d.westEast(land);
      const line = d.line(0, d.cellAt(-30, 120));
      const mark = new Float32Array(d.n).fill(NaN);
      for (let k = 0; k < line.length; k++) mark[line[k]] = k;
      const all = {
        down: new Float32Array(f.downstream), sum: f.flux, fill: f.fillLevel,
        dist: dist.km, group: new Float32Array(comp.group), west: we.west, path: mark,
        reads: Float32Array.from(d.convergentKm).map((x, i) => x + d.cellArea[i] + d.currentU[i] + d.wetland[i] + d.maxElevation + d.worldParams.plates),
      };
      const out = {};
      const ids = Object.keys(all).slice(4 * d.params.part, 4 * d.params.part + 4);
      for (let k = 0; k < ids.length; k++) out[ids[k]] = all[ids[k]];
      return { layers: out };
    } });`;
    const ids = ['down', 'sum', 'fill', 'dist', 'group', 'west', 'path', 'reads'];
    const reads = ['convergentKm', 'cellArea', 'currentU', 'wetland', 'maxElevation', 'worldParams', 'runoff'];
    const pls = await Promise.all(
      [0, 1].map((part) =>
        quickjsMapPlugin(quickjsWasm(), { id: `w${part}`, key: `w${part}@1`, code, params: { part }, setup: { stages: ['layers'], layerIds: ids.slice(4 * part, 4 * part + 4), reads } }),
      ),
    );
    try {
      const got = new Map<string, unknown>();
      const spy: MapPlugin = {
        ...pls[0],
        layers: (d) => {
          for (const [k, v] of Object.entries(d)) got.set(k, v);
          return pls[0].layers!(d);
        },
      };
      const w = generateWorld(P, undefined, undefined, undefined, undefined, [spy, pls[1]]);
      for (const l of w.mapLayers!) got.set(l.id, l.values);
      const h = mapHelpers(w.mesh, P.seed, 'w');
      const land = Uint8Array.from(w.water, (x) => (x === 1 ? 0 : 1));
      const f = h.flow(w.elevation, land, got.get('runoff') as Float32Array);
      expect(got.get('down')).toEqual(new Float32Array(f.downstream));
      expect(got.get('sum')).toEqual(f.flux);
      expect(got.get('fill')).toEqual(f.fillLevel);
      expect(got.get('dist')).toEqual(h.distance(w.water.map((x) => (x === 2 ? 1 : 0))).km);
      expect(got.get('group')).toEqual(new Float32Array(h.components(land).group));
      expect(got.get('west')).toEqual(h.westEast(land).west);
      const line = h.line(0, h.cellAt(-30, 120));
      const marked = got.get('path') as Float32Array;
      expect(Float32Array.from(line, (c) => marked[c])).toEqual(Float32Array.from(line, (_, k) => k));
      expect([...marked].filter((x) => !Number.isNaN(x)).length).toBe(line.length);
      const conv = got.get('convergentKm') as Float32Array;
      const area = got.get('cellArea') as Float32Array;
      const cu = got.get('currentU') as Float32Array;
      const wet = got.get('wetland') as Float32Array;
      expect(got.get('reads')).toEqual(Float32Array.from(conv, (x, i) => x + area[i] + cu[i] + wet[i] + w.maxElevation + P.plates));
    } finally {
      pls.forEach((p) => p.dispose());
    }
  }, 60_000);
});

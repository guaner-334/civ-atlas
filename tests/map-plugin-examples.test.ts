/**
 * 地图插件的示例(examples/plugins/ 里 role 是 map 的):从插件文件关进 QuickJS 长图。
 * 三个一起开、滑条默认,种子 7、2024 长出的地图和照接口直接写的那三个(tests/lib/mapPlugins.ts)钉的指纹一样;
 * 各自的效果和滑条;清单要的能力都用得到;编辑器用的类型(examples/plugins/civ-atlas-map.d.ts)和接口一样
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { windAt } from '../src/gen/climate';
import { geometryOf } from '../src/gen/geometry';
import type { ClimateInput, ClimateReply, HeightInput, HeightReply, LayersInput, LayersReply, MapShared, MapWorldParams } from '../src/gen/mapHooks';
import { mapHelpers, type ComponentsResult, type DistanceResult, type FlowResult, type MapHelpers, type NoiseOptions, type WestEastResult } from '../src/gen/mapHelpers';
import { quickjsMapPlugin } from '../src/gen/quickjs/map';
import type { MapBoxer } from '../src/mapPluginRun';
import { openPluginFile, PLUGIN_FILE_EXT } from '../src/plugin/pluginFile';
import { mapCapsUnused } from '../src/plugin/pluginMap';
import { trialMap } from '../src/plugin/mapTrial';
import { mapPluginInNode, openMapPlugin, type MapFile } from '../scripts/lib/mapPluginFile';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { MAP_PINS, MAP_SEEDS, mapDigest, type MapSeed } from './lib/mapPins';
import type * as Dts from '../examples/plugins/civ-atlas-map';

const ROOT = fileURLToPath(new URL('../examples/plugins/', import.meta.url));
const MAP_EXAMPLES = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && JSON.parse(readFileSync(join(ROOT, d.name, 'plugin.json'), 'utf8')).role === 'map')
  .map((d) => d.name)
  .sort();

const open = (name: string, params?: Record<string, number>) => openMapPlugin(join(ROOT, name, `${name}${PLUGIN_FILE_EXT}`), params);

/** 按先后关进 QuickJS 长一张图 */
async function grow(seed: number, files: MapFile[], cells = DEFAULT_PARAMS.cells): Promise<World> {
  const ps = await Promise.all(files.map((f) => mapPluginInNode(f)));
  try {
    return generateWorld({ ...DEFAULT_PARAMS, seed, cells }, undefined, undefined, undefined, undefined, ps);
  } finally {
    ps.forEach((p) => p.dispose());
  }
}

/** 地图本身的指纹(不算插件的图层) */
const terrainDigest = (w: World) => mapDigest({ ...w, mapLayers: undefined });

const SMALL = 12000;
const plainSmall = new Map<number, World>();
const plainOf = (seed: number) => {
  let w = plainSmall.get(seed);
  if (!w) plainSmall.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed, cells: SMALL })));
  return w;
};

const landSum = (w: World, f: Float32Array) => {
  let s = 0;
  for (let i = 0; i < w.mesh.n; i++) if (w.water[i] === 0) s += f[i];
  return s;
};
const count = (a: ArrayLike<number>, v: number) => {
  let k = 0;
  for (let i = 0; i < a.length; i++) if (a[i] === v) k++;
  return k;
};

describe('地图插件的示例', () => {
  it('四个都在:环形山、柯本气候、雨影与极地、潮汐', () => {
    expect(MAP_EXAMPLES).toEqual(['craters', 'koppen', 'rain-polar', 'tides']);
  });

  it.each(MAP_EXAMPLES)('%s:清单是地图插件、跑法 quickjs;要的能力都用得到;代码里登记的就是清单写的那几步', async (name) => {
    const { opened } = await open(name);
    const m = opened.manifest;
    expect(m).toMatchObject({ role: 'map', runtime: 'quickjs', api: 1 });
    expect(mapCapsUnused(m)).toEqual([]);
    for (const s of ['height', 'climate', 'layers']) expect(new RegExp(`^  ${s}\\(d\\) \\{`, 'm').test(opened.code), s).toBe(m.map!.stages.includes(s));
  });
});

describe('三个一起开、滑条默认:打成插件包经 QuickJS', () => {
  it.each(MAP_SEEDS)('seed %i:长出的地图和照接口直接写的钉的一样;再推 3000 年长得出文明', async (seed) => {
    const files = await Promise.all(['craters', 'koppen', 'tides'].map((n) => open(n)));
    expect(files.map((f) => f.params)).toEqual([{ count: 40, size: 1 }, { monsoon: 1 }, {}]);
    const w = await grow(seed, files);
    if (process.env.PRINT_FINGERPRINT) console.log(`map-plugin-examples seed ${seed}: ${mapDigest(w)}`);
    expect(mapDigest(w)).toBe(MAP_PINS[seed as MapSeed]);
    expect(w.mapLayers?.map((l) => `${l.by}/${l.id}`)).toEqual(['koppen/koppen', 'tides/tide']);
    const civ = generateCiv(w);
    expect(civ.stuck).toBeUndefined();
    expect(civ.endYear).toBe(3000);
    expect(civ.polities.filter((p) => p.ended === undefined).length).toBeGreaterThan(0);
  }, 120_000);
});

describe('各自的效果和滑条(种子 7,1.2 万块)', () => {
  it('环形山:砸出坑、多出湖;坑数拨到 0 地图和没装一样;坑拨大了改到的地块多', async () => {
    const plain = plainOf(7);
    const changed = (w: World) => count(w.elevation.map((e, i) => (e === plain.elevation[i] ? 0 : 1)), 1);
    const w = await grow(7, [await open('craters')], SMALL);
    expect(w.mapLayers).toBeUndefined();
    expect(changed(w)).toBeGreaterThan(SMALL / 10);
    expect(count(w.water, 2)).toBeGreaterThan(count(plain.water, 2));
    expect(terrainDigest(await grow(7, [await open('craters', { count: 0 })], SMALL))).toBe(terrainDigest(plain));
    expect(changed(await grow(7, [await open('craters', { size: 2 })], SMALL))).toBeGreaterThan(changed(w));
  }, 60_000);

  it('柯本:每块陆地分到登记过的一类,海和湖不画;季风越强陆地雨越多,拨到 0 地图和没装一样', async () => {
    const plain = plainOf(7);
    const f = await open('koppen');
    const values = new Set(f.opened.manifest.map!.layers![0].classes!.map((c) => c.value));
    expect(values.size).toBe(30);
    const w = await grow(7, [f], SMALL);
    const [kp] = w.mapLayers!;
    expect(kp).toMatchObject({ by: 'koppen', id: 'koppen' });
    const seen = new Set<number>();
    for (let i = 0; i < w.mesh.n; i++) {
      if (w.water[i] !== 0) expect(Number.isNaN(kp.values[i])).toBe(true);
      else {
        expect(values.has(kp.values[i])).toBe(true);
        seen.add(kp.values[i]);
      }
    }
    expect(seen.size).toBeGreaterThan(8);
    const off = await grow(7, [await open('koppen', { monsoon: 0 })], SMALL);
    expect(terrainDigest(off)).toBe(terrainDigest(plain));
    const strong = await grow(7, [await open('koppen', { monsoon: 2 })], SMALL);
    expect(landSum(w, w.precipitation)).toBeGreaterThan(landSum(plain, plain.precipitation));
    expect(landSum(strong, strong.precipitation)).toBeGreaterThan(landSum(w, w.precipitation));
  }, 60_000);

  it('潮汐:只出图层,地图和没装一样;只画挨着陆地的海,潮差 0.5 米起,三面是陆地的比开阔海岸大', async () => {
    const plain = plainOf(7);
    const w = await grow(7, [await open('tides')], SMALL);
    expect(terrainDigest(w)).toBe(terrainDigest(plain));
    const [tide] = w.mapLayers!;
    expect(tide).toMatchObject({ by: 'tides', id: 'tide' });
    const { adjStart, adj } = w.mesh;
    let drawn = 0;
    const bay = [0, 0];
    const wide = [0, 0];
    for (let i = 0; i < w.mesh.n; i++) {
      let land = 0;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) if (w.water[adj[k]] === 0) land++;
      const v = tide.values[i];
      expect(Number.isNaN(v)).toBe(!(w.water[i] === 1 && land > 0));
      if (Number.isNaN(v)) continue;
      drawn++;
      expect(v).toBeGreaterThanOrEqual(0.5);
      const frac = land / (adjStart[i + 1] - adjStart[i]);
      const g = frac >= 0.5 ? bay : frac < 0.34 ? wide : null;
      if (g) (g[0] += v), g[1]++;
    }
    expect(drawn).toBeGreaterThan(500);
    expect(bay[1]).toBeGreaterThan(20);
    expect(bay[0] / bay[1]).toBeGreaterThan(wide[0] / wide[1]);
  }, 60_000);

  it('雨影与极地:三个滑条都拨到 0 地图和没装一样;雨影只改降水,少了雨的地块上风有更高的山,拨大了更干', async () => {
    const plain = plainOf(7);
    expect(terrainDigest(await grow(7, [await open('rain-polar', { shadow: 0 })], SMALL))).toBe(terrainDigest(plain));
    const f = await open('rain-polar');
    expect(f.params).toEqual({ shadow: 1, north: 0, south: 0, polar: 70 });
    const w = await grow(7, [f], SMALL);
    expect(w.mapLayers).toBeUndefined();
    expect(w.elevation).toEqual(plain.elevation);
    expect(w.water).toEqual(plain.water);
    const all = landSum(plain, plain.precipitation);
    const one = landSum(w, w.precipitation);
    expect(one).toBeLessThan(all);
    expect(one).toBeGreaterThan(0.8 * all);
    const strong = await grow(7, [await open('rain-polar', { shadow: 3 })], SMALL);
    expect(landSum(strong, strong.precipitation)).toBeLessThan(one);

    // 少了一成半以上的地块:500 公里内上风那边(按全年的盛行风)最高的山比下风那边高
    const geo = geometryOf(w.mesh);
    const near = mapHelpers(w.mesh, 7, 'test').near;
    const h = (i: number) => Math.max(0, w.elevation[i]);
    let dry = 0;
    let upHigher = 0;
    let wetter = 0;
    for (let i = 0; i < w.mesh.n; i++) {
      if (w.water[i] !== 0) continue;
      const r = w.precipitation[i] / plain.precipitation[i];
      if (r > 1) wetter++;
      if (r >= 0.85) continue;
      dry++;
      const [wx, wy] = windAt(geo.latitude(i));
      let up = 0;
      let down = 0;
      for (const j of near(i, 500)) {
        const dot = geo.edgeDot(i, j, -wx, -wy);
        if (dot > 0.5) up = Math.max(up, h(j));
        else if (dot < -0.5) down = Math.max(down, h(j));
      }
      if (up > down) upHigher++;
    }
    expect(dry).toBeGreaterThan(SMALL / 50);
    expect(upHigher / dry).toBeGreaterThan(0.7);
    expect(wetter).toBeGreaterThan(SMALL / 100);
  }, 60_000);

  it('雨影与极地:北极拨到 1 极区全是陆地、−1 全是海,拨到一半只改离极点近的那一半;南极同样', async () => {
    const plain = plainOf(7);
    /** 纬度在 [a, b) 里的地块,海有几块、不是海的几块 */
    const band = (w: World, a: number, b: number) => {
      const geo = geometryOf(w.mesh);
      const n = [0, 0];
      for (let i = 0; i < w.mesh.n; i++) {
        const l = geo.latitude(i);
        if (l >= a && l < b) n[w.water[i] === 1 ? 0 : 1]++;
      }
      return n;
    };
    // 不装时北边极区海多、南边极区陆地多
    const [plainNorthSea] = band(plain, 70.5, 90);
    const [, plainSouthLand] = band(plain, -90, -70.5);
    expect(plainNorthSea).toBeGreaterThan(100);
    expect(plainSouthLand).toBeGreaterThan(100);

    const flip = await grow(7, [await open('rain-polar', { shadow: 0, north: 1, south: -1 })], SMALL);
    expect(band(flip, 70.5, 90)[0]).toBe(0);
    expect(band(flip, -90, -70.5)[1]).toBe(0);
    expect(band(flip, -69.5, 69.5)).toEqual(band(plain, -69.5, 69.5));

    const half = await grow(7, [await open('rain-polar', { shadow: 0, north: 0.5, south: -0.5 })], SMALL);
    expect(band(half, 80.5, 90)[0]).toBe(0);
    expect(band(half, -90, -80.5)[1]).toBe(0);
    expect(band(half, 70.5, 79.5)).toEqual(band(plain, 70.5, 79.5));
    expect(band(half, -79.5, -70.5)).toEqual(band(plain, -79.5, -70.5));

    // 极区从 60° 起:拨到 1 管到 60°
    const wide = await grow(7, [await open('rain-polar', { shadow: 0, north: 1, polar: 60 })], SMALL);
    expect(band(wide, 60.5, 90)[0]).toBe(0);
    expect(band(plain, 60.5, 70)[0]).toBeGreaterThan(0);
  }, 60_000);

  it('雨影与极地:长两遍一样;改一笔地形接着长和从头长一样(两口都出手)', async () => {
    const bytes = new Uint8Array(readFileSync(join(ROOT, 'rain-polar', `rain-polar${PLUGIN_FILE_EXT}`)));
    const o = await openPluginFile(bytes);
    const file = { id: o.manifest.id, sum: o.sum, bytes, params: { shadow: 2, north: 1, south: -1, polar: 70 } };
    const box: MapBoxer = (spec) => quickjsMapPlugin(quickjsWasm(), spec);
    const r = await trialMap({ ...DEFAULT_PARAMS, seed: 2024, cells: SMALL }, file, box, { bigCells: 0, years: 100 });
    expect(r.error).toBeUndefined();
    expect(Object.keys(r.map.stageMs).sort()).toEqual(['climate', 'height']);
    expect(r.map.changed!.elevation).toBeGreaterThan(0);
    expect(r.map.changed!.climate).toBeGreaterThan(0);
    expect(r.map.sameTwice).toBe(true);
    expect(r.map.cachedSame).toBe(true);
  }, 120_000);
});

/** 两个类型一模一样(不只是能互相赋值) */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('编辑器用的类型', () => {
  it('examples/plugins/civ-atlas-map.d.ts 里三个口子递进来的、交回去的、帮手和接口第 1 版一样(typecheck 时查)', () => {
    const same: [
      Same<Dts.MapShared, MapShared>,
      Same<Dts.HeightInput, HeightInput>,
      Same<Dts.HeightReply, HeightReply>,
      Same<Dts.ClimateInput, ClimateInput>,
      Same<Dts.ClimateReply, ClimateReply>,
      Same<Dts.LayersInput, LayersInput>,
      Same<Dts.LayersReply, LayersReply>,
      Same<Dts.MapHelpers, MapHelpers>,
      Same<Dts.NoiseOptions, NoiseOptions>,
      Same<Dts.FlowResult, FlowResult>,
      Same<Dts.DistanceResult, DistanceResult>,
      Same<Dts.ComponentsResult, ComponentsResult>,
      Same<Dts.WestEastResult, WestEastResult>,
      Same<Dts.MapWorldParams, MapWorldParams>,
    ] = [true, true, true, true, true, true, true, true, true, true, true, true, true, true];
    expect(same.every(Boolean)).toBe(true);
  });
});

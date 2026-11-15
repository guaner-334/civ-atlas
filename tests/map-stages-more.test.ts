/**
 * 地图插件的改海冰(seaice)、改水系(runoff)两口,和改海拔交回的 keepLakes(积成的湖再大也不填平):
 * 套上了、后面的群落和河跟着变;同一个种子两遍一样,改一笔地形接着长和从头长一样;经 QuickJS 和直接写的一样;
 * 清单、权限框、插件页的说法,试跑、试生成认得这两口
 */
import { describe, expect, it } from 'vitest';
import { Biome } from '../src/gen/biomes';
import type { TerrainOp } from '../src/gen/edits';
import {
  MapClock,
  MapPluginError,
  heightHooks,
  runoffHooks,
  seaIceHooks,
  timedMapPlugins,
  withoutLayers,
  type HeightInput,
  type HeightReply,
  type MapPlugin,
  type MapStage,
  type RunoffFields,
  type SeaIceFields,
} from '../src/gen/mapHooks';
import { quickjsMapPlugin } from '../src/gen/quickjs/map';
import { worldCheck } from '../src/gen/savefile';
import { DEFAULT_PARAMS, generateWorld, type BaseCache, type World } from '../src/gen/world';
import type { MapBoxer } from '../src/mapPluginRun';
import { devGen } from '../src/plugin/devGen';
import { trialMap } from '../src/plugin/mapTrial';
import { permissionLines } from '../src/plugin/pluginCaps';
import { openPluginFile, packPluginFile } from '../src/plugin/pluginFile';
import { checkMapManifest, type MapManifest } from '../src/plugin/pluginMap';
import { simParamsOf, type MapPluginFile } from '../src/plugin/pluginWorld';
import { MAP_STAGE_TEXT, mapBrief, mapRows } from '../src/ui/plugins/mapText';
import { devGenRows, type GenView } from '../src/ui/plugins/pluginText';
import { quickjsWasm } from '../scripts/lib/quickjsNode';

const P = { ...DEFAULT_PARAMS, cells: 6000, seed: 7 };
let plain: World | undefined;
const plain7 = () => (plain ??= generateWorld(P));
const grow = (pls: MapPlugin[], ops?: TerrainOp[], cache?: BaseCache) => generateWorld(P, undefined, ops, null, cache, pls);

const BOWL_KM = 1500;
const RIM_KM = 2100;

/** 碗心:上一次挖碗挖在哪 */
let center = -1;

/** 离海最远的那块陆地挖一个大碗:碗底 100 米、碗沿 3000 米,积成的湖比「太大要填平」的大;keep = 标上 keepLakes */
function bowlReply(d: HeightInput, keep: boolean): HeightReply {
  const far = d.steps(Uint8Array.from(d.land, (x) => (x ? 0 : 1)));
  let c = 0;
  for (let i = 1; i < d.n; i++) if (far[i] > far[c]) c = i;
  center = c;
  const e = d.elevation.slice();
  for (const i of d.near(c, RIM_KM)) e[i] = d.km(c, i) < BOWL_KM ? 100 : 3000;
  const keepLakes = new Uint8Array(d.n);
  keepLakes[c] = 1;
  return keep ? { elevation: e, keepLakes } : { elevation: e };
}

function bowl(keep: boolean, calls?: Record<string, number>, key = `bowl@${keep}`): MapPlugin {
  return {
    id: 'bowl',
    key,
    stages: ['height'],
    height: (d) => {
      if (calls) calls.height = (calls.height ?? 0) + 1;
      return bowlReply(d, keep);
    },
  };
}

/** 和 bowlReply 一样的 QuickJS 代码 */
const BOWL_JS = `
    const sea = new Uint8Array(d.n);
    for (let i = 0; i < d.n; i++) sea[i] = d.land[i] ? 0 : 1;
    const far = d.steps(sea);
    let c = 0;
    for (let i = 1; i < d.n; i++) if (far[i] > far[c]) c = i;
    const e = d.elevation.slice();
    const near = d.near(c, ${RIM_KM});
    for (let k = 0; k < near.length; k++) e[near[k]] = d.km(c, near[k]) < ${BOWL_KM} ? 100 : 3000;
    const keepLakes = new Uint8Array(d.n);
    keepLakes[c] = 1;`;

const lakeCells = (w: World) => w.water.reduce((s, x) => s + (x === 2 ? 1 : 0), 0);

/** 北半球的海整片封冻;陆地上交的、超范围的不算 */
const freeze = (calls?: Record<string, number>): MapPlugin => ({
  id: 'freeze',
  key: 'freeze@1',
  stages: ['seaice'],
  seaice: (d) => {
    if (calls) calls.seaice = (calls.seaice ?? 0) + 1;
    const ice = d.seaIce.slice();
    for (let i = 0; i < d.n; i++) {
      if (d.water[i] !== 1) ice[i] = 0.7;
      else if (d.lat[i] > 0) ice[i] = i % 2 ? 1 : 5;
    }
    return { seaIce: ice };
  },
});

/** 每块产的水乘 k;海上交 9 */
const scaleRunoff = (k: number, calls?: Record<string, number>): MapPlugin => ({
  id: `runoff${k}`,
  key: `runoff${k}@1`,
  stages: ['runoff'],
  runoff: (d) => {
    if (calls) calls.runoff = (calls.runoff ?? 0) + 1;
    return { runoff: Array.from(d.runoff, (x, i) => (d.water[i] === 1 ? 9 : x * k)) };
  },
});

function errOf(f: () => unknown): MapPluginError {
  try {
    f();
  } catch (e) {
    if (e instanceof MapPluginError) return e;
    throw e;
  }
  throw new Error('没有出错');
}

describe('改海拔交回 keepLakes', () => {
  it('不标:太大的湖填平;标了湖里一块:整个湖留着', () => {
    const off = grow([bowl(false)]);
    const on = grow([bowl(true)]);
    expect(off.water[center]).toBe(0);
    expect(on.water[center]).toBe(2);
    let kept = 0;
    for (let i = 0; i < on.mesh.n; i++) if (on.water[i] === 2 && off.water[i] !== 2) kept++;
    expect(kept).toBeGreaterThan(40);
    expect(lakeCells(on)).toBe(lakeCells(off) + kept);
    expect(on.waterLevel[center]).toBeGreaterThan(on.elevation[center] + 3);
    expect(worldCheck(grow([bowl(true)]))).toBe(worldCheck(on));
  });

  it('掩码挂在前一半:改一笔地形接着长和从头长一样,湖照样留着;作者删湖照删', () => {
    const calls: Record<string, number> = {};
    const pl = bowl(true, calls);
    const cache: BaseCache = { base: null };
    grow([pl], [], cache);
    const ops: TerrainOp[] = [
      { kind: 'wet', pts: [900, 400, 1000, 400], r: 30, s: 1 },
      { kind: 'lake', pts: [1024, 300], r: 20, s: 1 },
    ];
    const a = grow([pl], ops, cache);
    expect(calls.height).toBe(1);
    const b = grow([pl], ops);
    expect(calls.height).toBe(2);
    expect(worldCheck(a)).toBe(worldCheck(b));
    expect(a.water[center]).toBe(2);
    const gone = grow([pl], [{ kind: 'delWater', pts: [a.mesh.x[center], a.mesh.y[center]], r: 10, s: 1 }], cache);
    expect(gone.water[center]).toBe(0);
  });

  it('不是 0 / 1、长度不对:报插件和口子', () => {
    const { mesh } = plain7();
    const n = mesh.n;
    const run = (keepLakes: unknown) => () =>
      heightHooks([{ id: 'bad', key: 'bad@1', stages: ['height'], height: () => ({ keepLakes }) as never }], mesh, 7, new Float32Array(n), new Uint8Array(n), new Int16Array(n));
    const e1 = errOf(run(new Uint8Array(n).fill(2)));
    expect([e1.plugin, e1.stage, e1.kind]).toEqual(['bad', 'height', 'bad']);
    expect(e1.why).toBe('keepLakes[0] 不是 0 或 1');
    expect(errOf(run(new Uint8Array(n - 1))).why).toBe(`keepLakes 的长度不是地块数 ${n}`);
    // 几个插件标的并起来
    const mark = (k: number): MapPlugin => ({ id: `m${k}`, key: `m${k}@1`, stages: ['height'], height: () => ({ keepLakes: Uint8Array.from({ length: n }, (_, i) => (i === k ? 1 : 0)) }) });
    const keep = heightHooks([mark(3), mark(5)], mesh, 7, new Float32Array(n), new Uint8Array(n), new Int16Array(n));
    expect([...keep!.keys()].filter((i) => keep![i])).toEqual([3, 5]);
    expect(heightHooks([], mesh, 7, new Float32Array(n), new Uint8Array(n), new Int16Array(n))).toBeNull();
  });
});

describe('改海冰', () => {
  it('海上的套上(压到 0–1),陆地、湖不变;海冰群落跟着变;海拔、气候、河不变', () => {
    const w0 = plain7();
    const w = grow([freeze()]);
    let north = 0;
    for (let i = 0; i < w.mesh.n; i++) {
      const lat = 90 - (180 * w.mesh.y[i]) / w.mesh.height;
      if (w.water[i] === 1 && lat > 0) {
        north++;
        expect(w.seaIce[i]).toBe(1);
        expect(w.biome[i]).toBe(Biome.SeaIce);
      } else expect(w.seaIce[i]).toBe(w0.seaIce[i]);
    }
    expect(north).toBeGreaterThan(500);
    expect(w.elevation).toEqual(w0.elevation);
    expect(w.temperature).toEqual(w0.temperature);
    expect(w.flux).toEqual(w0.flux);
    expect(w.biome).not.toEqual(w0.biome);
    expect(worldCheck(grow([freeze()]))).toBe(worldCheck(w));
    // 全化开:哪里都没有海冰群落
    const thaw: MapPlugin = { id: 'thaw', key: 'thaw@1', stages: ['seaice'], seaice: (d) => ({ seaIce: new Float32Array(d.n) }) };
    const t = grow([thaw]);
    expect(t.seaIce.every((x) => x === 0)).toBe(true);
    expect(t.biome.includes(Biome.SeaIce)).toBe(false);
    expect(w0.biome.includes(Biome.SeaIce)).toBe(true);
  });

  it('拿到的气温已经套上了改气候和作者涂的冷暖;海冰是官方算的那份', () => {
    const w0 = plain7();
    let got: { t: Float32Array; ice: Float32Array } | null = null;
    const cool: MapPlugin = { id: 'cool', key: 'cool@1', stages: ['climate'], climate: (d) => ({ temperature: d.temperature.map((x) => x - 3) }) };
    const look: MapPlugin = {
      id: 'look',
      key: 'look@1',
      stages: ['seaice'],
      seaice: (d) => {
        got = { t: d.temperature.slice(), ice: d.seaIce.slice() };
        return undefined;
      },
    };
    const ops: TerrainOp[] = [{ kind: 'cold', pts: [900, 200, 1000, 200], r: 40, s: 1 }];
    const w = grow([cool, look], ops);
    expect(got!.t).toEqual(w.temperature);
    expect(got!.ice).toEqual(w.seaIce);
    expect(w.temperature).not.toEqual(w0.temperature);
  });

  it('交回坏数报插件和口子', () => {
    const w = plain7();
    const n = w.mesh.n;
    const c = (): SeaIceFields => ({
      elevation: w.elevation,
      water: w.water,
      temperature: w.temperature.slice(),
      precipitation: w.precipitation.slice(),
      windX: new Float32Array(n),
      windY: new Float32Array(n),
      rainSummer: new Float32Array(n),
      rainWinter: new Float32Array(n),
      seaIce: w.seaIce.slice(),
    });
    const e1 = errOf(() => seaIceHooks([{ id: 'bad', key: 'bad@1', stages: ['seaice'], seaice: () => ({ seaIce: new Float32Array(2) }) }], w.mesh, 7, c()));
    expect([e1.plugin, e1.stage, e1.why]).toEqual(['bad', 'seaice', `seaIce 的长度不是地块数 ${n}`]);
    expect(e1.message).toContain('改海冰');
    const e2 = errOf(() => grow([{ id: 'bad', key: 'bad@1', stages: ['seaice'], seaice: () => 1 as never }]));
    expect([e2.stage, e2.why]).toEqual(['seaice', '交回的不是对象']);
  });
});

describe('改水系', () => {
  it('每块产的水全是 0:一条河都没有;乘 4:河多了;海上交的不算', () => {
    const w0 = plain7();
    const dry = grow([scaleRunoff(0)]);
    expect(w0.rivers.length).toBeGreaterThan(10);
    expect(dry.rivers.length).toBe(0);
    expect(dry.flux.every((x) => x === 0)).toBe(true);
    expect(dry.elevation).toEqual(w0.elevation);
    expect(dry.precipitation).toEqual(w0.precipitation);
    expect(dry.seaIce).toEqual(w0.seaIce);
    const wet = grow([scaleRunoff(4)]);
    expect(wet.rivers.length).toBeGreaterThan(w0.rivers.length);
    for (let i = 0; i < wet.mesh.n; i++) if (wet.water[i] === 1) expect(wet.flux[i]).toBe(0);
    expect(worldCheck(grow([scaleRunoff(4)]))).toBe(worldCheck(wet));
  });

  it('拿到的产水、门槛、流向和出图层那一口读到的一样;压到 0–20 米 / 年', () => {
    let seen: Record<string, unknown> | null = null;
    const look: MapPlugin = {
      id: 'look',
      key: 'look@1',
      stages: ['runoff', 'layers'],
      reads: ['downstream', 'runoff'],
      layerIds: [],
      runoff: (d) => {
        seen = { runoff: d.runoff.slice(), downstream: d.downstream, riverThreshold: d.riverThreshold };
        return undefined;
      },
      layers: (d) => {
        expect(seen!.runoff).toEqual(d.runoff);
        expect(seen!.downstream).toEqual(d.downstream);
        expect(seen!.riverThreshold).toBe(d.riverThreshold);
        return undefined;
      },
    };
    const w = grow([look]);
    expect(seen!.riverThreshold).toBe(w.riverThreshold);
    expect(w.flux).toEqual(plain7().flux);
    const big: MapPlugin = { id: 'big', key: 'big@1', stages: ['runoff'], runoff: (d) => ({ runoff: new Float32Array(d.n).fill(100) }) };
    const peek: MapPlugin = { id: 'peek', key: 'peek@1', stages: ['layers'], layerIds: [], reads: ['runoff'], layers: (d) => void (seen = { runoff: d.runoff }) };
    const b = grow([big, peek]);
    const r = seen!.runoff as Float32Array;
    for (let i = 0; i < b.mesh.n; i++) expect(r[i]).toBe(b.water[i] === 1 ? 0 : 20);
  });

  it('交回坏数报插件和口子', () => {
    const w = plain7();
    const n = w.mesh.n;
    const c = (): RunoffFields => ({
      elevation: w.elevation,
      water: w.water,
      temperature: w.temperature.slice(),
      precipitation: w.precipitation.slice(),
      windX: new Float32Array(n),
      windY: new Float32Array(n),
      rainSummer: new Float32Array(n),
      rainWinter: new Float32Array(n),
      seaIce: w.seaIce.slice(),
      runoff: new Float32Array(n),
      riverThreshold: w.riverThreshold,
    });
    const e = errOf(() => runoffHooks([{ id: 'bad', key: 'bad@1', stages: ['runoff'], runoff: () => ({ runoff: new Float32Array(n).fill(NaN) }) }], w.mesh, 7, c()));
    expect([e.plugin, e.stage, e.why]).toEqual(['bad', 'runoff', 'runoff[0] 不是有限的数']);
    expect(e.message).toContain('改水系');
  });
});

describe('几口一起', () => {
  it('按先后出手:改海拔、改气候、改海冰、改水系、出图层;计时、长来对照的星球都带上新的两口', () => {
    const order: MapStage[] = [];
    const log = (st: MapStage) => () => void order.push(st);
    const all: MapPlugin = { id: 'all', key: 'all@1', stages: ['layers', 'runoff', 'seaice', 'climate', 'height'], layerIds: [], height: log('height'), climate: log('climate'), seaice: log('seaice'), runoff: log('runoff'), layers: log('layers') };
    grow([all]);
    expect(order).toEqual(['height', 'climate', 'seaice', 'runoff', 'layers']);
    const spent: string[] = [];
    class Spy extends MapClock {
      spend(id: string, stage: MapStage, ms: number): void {
        spent.push(stage);
        super.spend(id, stage, ms);
      }
    }
    grow(timedMapPlugins([all], new Spy()));
    expect(spent).toEqual(['height', 'climate', 'seaice', 'runoff', 'layers']);
    const off = withoutLayers([all])[0];
    expect(off.stages).toEqual(['runoff', 'seaice', 'climate', 'height']);
    expect(typeof off.seaice).toBe('function');
    expect(typeof off.runoff).toBe('function');
    expect(off.layers).toBeUndefined();
  });

  it('改一笔地形:改海拔不重跑,改海冰、改水系重跑;接着长和从头长一样', () => {
    const calls: Record<string, number> = {};
    const pls = [bowl(true, calls, 'bowl@x'), freeze(calls), scaleRunoff(2, calls)];
    const cache: BaseCache = { base: null };
    grow(pls, [], cache);
    expect(calls).toEqual({ height: 1, seaice: 1, runoff: 1 });
    const ops: TerrainOp[] = [{ kind: 'lake', pts: [1024, 300], r: 20, s: 1 }];
    const a = grow(pls, ops, cache);
    expect(calls).toEqual({ height: 1, seaice: 2, runoff: 2 });
    const b = grow(pls, ops);
    expect(calls).toEqual({ height: 2, seaice: 3, runoff: 3 });
    expect(worldCheck(a)).toBe(worldCheck(b));
  });

  it('没装插件、装了只用旧几口的,地图一位不变', () => {
    expect(worldCheck(grow([]))).toBe(worldCheck(plain7()));
    const idle: MapPlugin = { id: 'idle', key: 'idle@1', stages: ['height', 'climate', 'seaice', 'runoff'], height: () => undefined, climate: () => undefined, seaice: () => ({}), runoff: () => ({}) };
    expect(worldCheck({ ...grow([idle]), mapPlugins: undefined })).toBe(worldCheck(plain7()));
  });
});

const box: MapBoxer = (spec) => quickjsMapPlugin(quickjsWasm(), spec);
const LICENSE = 'MIT License\n\nCopyright (c) 2026\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n';

const QJS_CODE = `civAtlas.map({
  height(d) {${BOWL_JS}
    return { elevation: e, keepLakes };
  },
  seaice(d) {
    const ice = d.seaIce.slice();
    for (let i = 0; i < d.n; i++) if (d.water[i] === 1 && d.lat[i] > 0) ice[i] = 1;
    return { seaIce: ice };
  },
  runoff(d) {
    const r = d.runoff.slice();
    for (let i = 0; i < d.n; i++) r[i] *= 2;
    return { runoff: r };
  },
});
`;

async function qjsFile(): Promise<MapPluginFile & { bytes: Uint8Array }> {
  const map: MapManifest = { stages: ['height', 'seaice', 'runoff'] };
  const manifest = { id: 'three', name: '三口', version: '1.0.0', role: 'map', api: 1, runtime: 'quickjs', requires: ['gen.height@1', 'gen.seaice@1', 'gen.runoff@1'], map, license: 'MIT' } as const;
  const bytes = await packPluginFile({ manifest: manifest as never, files: { 'main.js': QJS_CODE, 'README.md': '# 三口\n', LICENSE } });
  const o = await openPluginFile(bytes);
  const params = simParamsOf(o.manifest.map?.params);
  return { id: o.manifest.id, sum: o.sum, bytes, ...(Object.keys(params).length ? { params } : {}) };
}

describe('经 QuickJS', () => {
  it('三样都递得进去、交得回来,和直接写的一样', async () => {
    const pl = await quickjsMapPlugin(quickjsWasm(), { id: 'three', key: 'three@1', code: QJS_CODE, setup: { stages: ['height', 'seaice', 'runoff'] } });
    try {
      const native: MapPlugin = {
        id: 'three',
        key: 'three@1',
        stages: ['height', 'seaice', 'runoff'],
        height: (d) => bowlReply(d, true),
        seaice: (d) => ({ seaIce: d.seaIce.map((x, i) => (d.water[i] === 1 && d.lat[i] > 0 ? 1 : x)) }),
        runoff: (d) => ({ runoff: d.runoff.map((x) => x * 2) }),
      };
      const a = grow([pl]);
      expect(worldCheck(a)).toBe(worldCheck(grow([native])));
      expect(lakeCells(a)).toBeGreaterThan(lakeCells(plain7()) + 40);
    } finally {
      pl.dispose();
    }
  }, 60_000);

  it('试跑、试生成认得新的两口', async () => {
    const f = await qjsFile();
    const r = await trialMap(P, f, box, { bigCells: 0, years: 100 });
    expect(r.error).toBeUndefined();
    expect(Object.keys(r.map.stageMs)).toEqual(['height', 'seaice', 'runoff']);
    expect(r.map.sameTwice).toBe(true);
    expect(r.map.cachedSame).toBe(true);
    expect(r.map.stats.plugin!.lakes).toBeGreaterThan(r.map.stats.official!.lakes + 40);
    expect(r.log.join('\n')).toMatch(/改海冰 [\d.]+ 毫秒、改水系 [\d.]+ 毫秒/);

    const run = await devGen({ params: P, files: [f] }, box);
    expect(run.result.error).toBeNull();
    expect(run.result.steps.map((s) => s.stage)).toEqual(['height', 'seaice', 'runoff']);
    expect(run.result.steps[1].changed).toBeGreaterThan(100);
    expect(run.result.steps[2].changed).toBeGreaterThan(100);
    expect(run.result.sameTwice && run.result.cachedSame).toBe(true);
    const t: GenView = { at: 0, file: 'three.civplugin', plugins: [{ id: 'three', name: '三口', dev: true }], alone: false, result: run.result };
    expect(devGenRows(t).map((x) => x.stage)).toEqual(['改海拔', '改海冰', '改水系']);
  }, 120_000);
});

describe('清单、权限框、插件页', () => {
  it('stages 写了 seaice、runoff 要对应的能力;流向从改水系起能读', () => {
    expect(checkMapManifest({ map: { stages: ['seaice', 'runoff'], reads: ['downstream', 'currentU'] }, requires: ['gen.seaice@1', 'gen.runoff@1'] })).toBeNull();
    expect(() => checkMapManifest({ map: { stages: ['seaice', 'runoff'] }, requires: ['gen.seaice@1'] })).toThrow('map.stages 写了 runoff,要在 requires 里写上 gen.runoff@1');
    expect(() => checkMapManifest({ map: { stages: ['seaice'], reads: ['downstream'] }, requires: ['gen.seaice@1'] })).toThrow('map.reads 写了 downstream,它只递给改水系、出图层,map.stages 里一口都没写');
  });

  it('权限框并进「会改地图」那一行;插件页说它在哪一步、改什么', () => {
    expect(permissionLines({ requires: ['gen.seaice@1', 'gen.runoff@1'] }).map((l) => l.key)).toEqual(['mapSteer']);
    expect(permissionLines({ requires: ['gen.height@1', 'gen.runoff@1', 'gen.layers@1'] }).map((l) => l.key)).toEqual(['mapSteer', 'layer']);
    expect([MAP_STAGE_TEXT.seaice, MAP_STAGE_TEXT.runoff]).toEqual(['改海冰', '改水系']);
    expect(mapBrief({ stages: ['runoff', 'layers', 'seaice'], layers: [{ id: 'a', title: 'A', ramp: { colors: ['#000', '#fff'] } }] })).toBe('改海冰、改水系、出 1 张图层');
    const rows = (stages: string[], phone = false) => mapRows({ stages }, phone);
    expect(rows(['seaice', 'runoff'])[0].v).toBe('改海冰（海冰算好以后）、改水系（汇成河之前）');
    expect(rows(['runoff'])[1]).toEqual({ k: '会改什么', v: '每块产多少水', small: '后面的河、湿地、文明跟着变' });
    expect(rows(['seaice'])[1]).toEqual({ k: '会改什么', v: '海冰', small: '后面的海上航路、文明跟着变' });
    expect(rows(['climate', 'seaice'])[1]).toEqual({ k: '会改什么', v: '气温、降水；海冰', small: '后面的海冰、河、森林草原沙漠、文明跟着变' });
  });
});

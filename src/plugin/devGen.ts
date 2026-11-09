/** 开发者模式的「试生成」:不带 / 带地图插件各长一张比,不改世界。纯计算,不碰 DOM */
import { MAP_RANGE, MapClock, MapPluginError, timedMapPlugins, type MapPlugin, type MapStage } from '../gen/mapHooks';
import type { TerrainOp } from '../gen/edits';
import { TERRAIN_PRESETS } from '../gen/terrainOps';
import type { Sketch } from '../gen/sketch';
import { MAP_H, MAP_W, generateWorld, type BaseCache, type World, type WorldParams } from '../gen/world';
import { loadMapFile, type LoadedMap, type MapBoxer } from '../mapPluginRun';
import { worldDiff } from './mapTrial';
import { mapPluginKey, type MapPluginFile } from './pluginWorld';

export interface DevGenInput {
  params: WorldParams;
  /** 初始地图的地形修改(不带地形大事) */
  terrain?: readonly TerrainOp[];
  sketch?: Sketch | null;
  /** 带的地图插件(按出手的先后;带字节、滑条照清单补齐) */
  files: readonly (MapPluginFile & { bytes: Uint8Array })[];
}

/** 一个插件的一口:用了多久(毫秒,一位小数)、改了几块(出图层 = 交了几张);出错停在这一口 = failed */
export interface DevGenStep {
  id: string;
  stage: MapStage;
  ms: number;
  changed: number;
  failed?: true;
}

/** 记的一条:插件 console 打的、网站压回范围的(site)、出错的那句;stage = 哪一口(装插件时 = null) */
export interface DevGenLog {
  stage: MapStage | null;
  level: 'info' | 'warn' | 'error' | 'site';
  plugin: string;
  text: string;
}

/** 几样数:陆地占全图的百分数(取整)、湖几块、河几条 */
export interface DevGenTally {
  land: number;
  lakes: number;
  rivers: number;
}

export interface DevGenResult {
  /** 整个试生成用了多久(毫秒) */
  ms: number;
  steps: DevGenStep[];
  stats: { official: DevGenTally | null; plugin: DevGenTally | null };
  /** 同一个种子长两遍一样;没查(出错停下)= null;不一样时 sameNote 写哪一样 */
  sameTwice: boolean | null;
  sameNote?: string;
  /** 改一笔地形接着长和从头长一样;没查 = null */
  cachedSame: boolean | null;
  cachedNote?: string;
  logs: DevGenLog[];
  /** 装不上、出错停下:哪个插件、哪一口(装不上 = null)、那句话 */
  error: { plugin: string; stage: MapStage | null; why: string } | null;
}

/** 日志最多留几条 */
export const DEV_GEN_LOGS = 300;
/** 改一笔地形:图正中挖一个湖(不是火山、山脉这类:那几种连前一半一起重长,查不到记着的那一份) */
export const DEV_GEN_EDIT: TerrainOp = { kind: 'lake', pts: [MAP_W / 2, MAP_H / 2], r: TERRAIN_PRESETS.lake[1][0], s: TERRAIN_PRESETS.lake[1][1] };

const METHOD_LEVEL: Record<string, DevGenLog['level']> = { warn: 'warn', error: 'error' };
const round1 = (x: number) => Math.round(x * 10) / 10;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function tallyOf(w: World): DevGenTally {
  let land = 0;
  let lakes = 0;
  for (let i = 0; i < w.mesh.n; i++) {
    if (w.water[i] === 0) land++;
    else if (w.water[i] === 2) lakes++;
  }
  return { land: Math.round((100 * land) / w.mesh.n), lakes, rivers: w.rivers.length };
}

const RANGE_TEXT: Record<'elevation' | 'temperature' | 'precipitation', [string, string]> = {
  elevation: ['海拔', '米'],
  temperature: ['气温', '°C'],
  precipitation: ['降水', '毫米'],
};

/** 交回的数里超出范围的(网站会压回去):高过、低过各几块 */
function outOfRange(v: unknown, [lo, hi]: readonly [number, number]): { over: number; under: number } {
  const out = { over: 0, under: 0 };
  if (typeof v !== 'object' || v === null || typeof (v as ArrayLike<unknown>).length !== 'number') return out;
  const a = v as ArrayLike<unknown>;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (typeof x !== 'number' || !Number.isFinite(x)) continue;
    if (x > hi) out.over++;
    else if (x < lo) out.under++;
  }
  return out;
}

/** 交回的和递进去的不一样的地块数(按压回范围、存成 32 位以后的比) */
function changedCells(n: number, pairs: readonly [unknown, ArrayLike<number>, readonly [number, number] | null][]): number {
  let count = 0;
  const arr = (v: unknown) => (typeof v === 'object' && v !== null && (v as ArrayLike<unknown>).length === n ? (v as ArrayLike<unknown>) : null);
  for (let i = 0; i < n; i++) {
    for (const [got, was, range] of pairs) {
      const a = arr(got);
      if (!a) continue;
      const x = a[i];
      if (typeof x !== 'number') continue;
      const v = Math.fround(range ? Math.min(range[1], Math.max(range[0], x)) : x);
      if (!Object.is(v, was[i])) {
        count++;
        break;
      }
    }
  }
  return count;
}

/** 出错(抛错、叫停)的那一口也记一行:表格列到出错那一口 */
function metered(plugins: readonly MapPlugin[], steps: DevGenStep[], say: (l: DevGenLog) => void, now: () => number): MapPlugin[] {
  const clamp = (pl: MapPlugin, stage: MapStage, field: keyof typeof RANGE_TEXT, v: unknown) => {
    const r = outOfRange(v, MAP_RANGE[field]);
    const [name, unit] = RANGE_TEXT[field];
    const [lo, hi] = MAP_RANGE[field];
    if (r.over) say({ stage, level: 'site', plugin: pl.id, text: `交回的${name}有 ${r.over} 块高过 ${hi} ${unit}，压回 ${hi} ${unit}` });
    if (r.under) say({ stage, level: 'site', plugin: pl.id, text: `交回的${name}有 ${r.under} 块低过 ${lo} ${unit}，压回 ${lo} ${unit}` });
  };
  const wrap =
    <D extends { n: number }, R>(pl: MapPlugin, stage: MapStage, fn: (d: D) => R, count: (d: D, r: NonNullable<R>) => number) =>
    (d: D): R => {
      const t0 = now();
      let r: R;
      try {
        r = fn.call(pl, d);
      } catch (e) {
        steps.push({ id: pl.id, stage, ms: round1(now() - t0), changed: 0, failed: true });
        throw e;
      }
      const ms = round1(now() - t0);
      let changed = 0;
      try {
        changed = r && typeof r === 'object' ? count(d, r as NonNullable<R>) : 0;
      } catch {
        // 交回的样子不对:生成那边会报错,这里不数
      }
      steps.push({ id: pl.id, stage, ms, changed });
      return r;
    };
  return plugins.map((pl) => ({
    ...pl,
    ...(pl.height
      ? {
          height: wrap(pl, 'height', pl.height, (d, r) => {
            clamp(pl, 'height', 'elevation', r.elevation);
            return changedCells(d.n, [
              [r.elevation, d.elevation, MAP_RANGE.elevation],
              [r.land, d.land, null],
            ]);
          }),
        }
      : {}),
    ...(pl.climate
      ? {
          climate: wrap(pl, 'climate', pl.climate, (d, r) => {
            clamp(pl, 'climate', 'temperature', r.temperature);
            clamp(pl, 'climate', 'precipitation', r.precipitation);
            return changedCells(d.n, [
              [r.temperature, d.temperature, MAP_RANGE.temperature],
              [r.precipitation, d.precipitation, MAP_RANGE.precipitation],
            ]);
          }),
        }
      : {}),
    ...(pl.layers ? { layers: wrap(pl, 'layers', pl.layers, (_d, r) => (r.layers && typeof r.layers === 'object' ? Object.keys(r.layers).length : 0)) } : {}),
  }));
}

export interface DevGenOptions {
  /** 进度(0–1) */
  progress?: (pct: number) => void;
  now?: () => number;
}

/** 试生成交回的:结果,连同不带 / 带插件长的那两张(画小图用;带插件的没长出来 = null) */
export interface DevGenRun {
  result: DevGenResult;
  official: World | null;
  plugin: World | null;
}

/** 试生成:装不上、出错停下照实写进 error,网站这头的错照旧抛 */
export async function devGen(input: DevGenInput, box: MapBoxer, o: DevGenOptions = {}): Promise<DevGenRun> {
  const now = o.now ?? (() => performance.now());
  const t0 = now();
  const logs: DevGenLog[] = [];
  let capture = true;
  const say = (l: DevGenLog) => {
    if (capture && logs.length < DEV_GEN_LOGS) logs.push(l);
  };
  const result: DevGenResult = { ms: 0, steps: [], stats: { official: null, plugin: null }, sameTwice: null, cachedSame: null, logs, error: null };
  const run: DevGenRun = { result, official: null, plugin: null };
  const done = () => {
    capture = false;
    result.ms = Math.round(now() - t0);
    return run;
  };
  const fail = (e: unknown) => {
    const x = e as { name?: unknown; plugin?: unknown; why?: unknown } | null;
    const err = e instanceof MapPluginError ? { plugin: e.plugin, stage: e.stage, why: e.why } : x && x.name === 'MapPluginLoadError' && typeof x.plugin === 'string' ? { plugin: x.plugin, stage: null, why: String(x.why ?? '') } : null;
    if (!err) throw e;
    result.error = err;
    say({ stage: err.stage, level: 'error', plugin: err.plugin, text: err.why });
    return done();
  };
  const loadAll = async (suffix: string, log: boolean): Promise<LoadedMap[]> => {
    const out: LoadedMap[] = [];
    try {
      for (const f of input.files) {
        const key = mapPluginKey(f);
        const b: MapBoxer = log ? (spec) => box({ ...spec, log: (method, text, stage) => say({ stage, level: METHOD_LEVEL[method] ?? 'info', plugin: f.id, text }) }) : box;
        const l = await loadMapFile(f, key, b);
        out.push(suffix ? { ...l, plugin: { ...l.plugin, key: `${l.plugin.key}${suffix}`, dispose: () => l.plugin.dispose() } } : l);
      }
    } catch (e) {
      for (const l of out) l.plugin.dispose();
      throw e;
    }
    return out;
  };
  const { params, terrain, sketch } = input;
  const ops = terrain?.length ? terrain : undefined;

  let first: LoadedMap[];
  try {
    first = await loadAll('', true);
  } catch (e) {
    return fail(e);
  }
  o.progress?.(0.1);
  try {
    const official = generateWorld(params, undefined, ops, sketch ?? null);
    run.official = official;
    result.stats.official = tallyOf(official);
    o.progress?.(0.3);

    const plugins = first.map((l) => (l.record.name ? { ...l.plugin, name: l.record.name } : l.plugin));
    const cache: BaseCache = { base: null };
    let world: World;
    try {
      world = generateWorld(params, undefined, ops, sketch ?? null, cache, metered(timedMapPlugins(plugins, new MapClock(now)), result.steps, say, now));
    } catch (e) {
      return fail(e);
    }
    capture = false;
    run.plugin = world;
    result.stats.plugin = tallyOf(world);
    o.progress?.(0.55);

    try {
      const again = generateWorld(params, undefined, ops, sketch ?? null, undefined, plugins);
      const d = worldDiff(world, again);
      result.sameTwice = d === null;
      if (d) result.sameNote = d;
      o.progress?.(0.75);
      // 从头长的另装一份插件、换一个键:不沾上面记着的前一半
      const edit = [...(ops ?? []), DEV_GEN_EDIT];
      const edited = generateWorld(params, undefined, edit, sketch ?? null, cache, plugins);
      const fresh = await loadAll('#dev', false);
      let scratch: World;
      try {
        scratch = generateWorld(params, undefined, edit, sketch ?? null, undefined, fresh.map((l) => l.plugin));
      } finally {
        for (const l of fresh) l.plugin.dispose();
      }
      const c = worldDiff(edited, scratch);
      result.cachedSame = c === null;
      if (c) result.cachedNote = c;
    } catch (e) {
      const why = e instanceof MapPluginError ? e.why : msg(e);
      if (result.sameTwice === null) {
        result.sameTwice = false;
        result.sameNote = `出错：${why}`;
      } else {
        result.cachedSame = false;
        result.cachedNote = `出错：${why}`;
      }
    }
    o.progress?.(0.95);
    return done();
  } finally {
    for (const l of first) l.plugin.dispose();
  }
}

/**
 * 审地图插件时的试跑(帮手第 3 版,见 ui/helperProtocol.ts):同一个种子不带插件、带插件各长一张图,比几样数和改了几块;
 * 带插件再长一遍看两遍一样不一样;改一笔地形(固定放一座火山)接着记着的长,和另装一份插件从头长的比;
 * 两张图各推几千年看长不长得出文明;另在 20 万地块上带插件长一遍,只量每一口多久。
 * 纯计算,不碰 DOM;后台线程(mapTrialWorker.ts)和单测里跑。截图在帮手那边另长(ui/helperTrial.tsx)。
 */
import { BIOMES } from '../gen/biomes';
import { polityAlive } from '../gen/civ/growth';
import { civOrStuck } from '../gen/civ/stuck';
import type { Civ } from '../gen/civ/types';
import type { TerrainOp } from '../gen/edits';
import { MapClock, MapPluginError, timedMapPlugins, type MapStage } from '../gen/mapHooks';
import type { WorldParams } from '../gen/params';
import { TERRAIN_PRESETS } from '../gen/terrainOps';
import { MAP_H, MAP_W, generateWorld, type BaseCache, type World } from '../gen/world';
import { loadMapFile, type LoadedMap, type MapBoxer } from '../mapPluginRun';
import { mapPluginKey, type MapPluginFile } from './pluginWorld';

/** 推几年 */
export const MAP_TRIAL_YEARS = 3000;
/** 另在多少地块上量用时 */
export const MAP_TRIAL_BIG_CELLS = 200_000;
/** 一口超过这么久(毫秒)后台标黄 */
export const MAP_TRIAL_SLOW_MS = 1000;
/** 改一笔地形:图正中放一座中等的火山(落在海里是火山岛) */
export const MAP_TRIAL_EDIT: TerrainOp = { kind: 'volcano', pts: [MAP_W / 2, MAP_H / 2], r: TERRAIN_PRESETS.volcano[1][0], s: TERRAIN_PRESETS.volcano[1][1] };

/** 一张图的几样数 */
export interface MapStats {
  /** 陆地占全图的百分数(一位小数) */
  land: number;
  /** 湖占几块地块 */
  lakes: number;
  rivers: number;
  /** 最高的山(米) */
  peak: number;
  /** 陆地平均气温(°C,一位小数)、平均年降水(毫米) */
  temperature: number;
  precipitation: number;
  /** 各群落占陆地的百分数(一位小数,按群落名;两张图都是 0 的不列) */
  biomes: Record<string, number>;
}

/** 推了几千年:长没长出文明、停在第几年(推不下去时)、几个州、出现过几国、最后还在几国 */
export interface MapCiv {
  viable: boolean;
  stuck?: number;
  regions: number;
  states: number;
  alive: number;
}

/** 一个种子上地图插件的试跑结果(后台存试跑结果的接口收的 runs[].map) */
export interface MapTrial {
  /** 示例世界有几块地块(改了几块、改一笔变了几块都按它算) */
  cells: number;
  /** 插件出错停在哪一口 */
  stage?: MapStage;
  /** 每一口用了多久(毫秒,一位小数) */
  stageMs: Partial<Record<MapStage, number>>;
  /** 20 万地块上每一口用了多久;没量到 = null */
  bigStageMs: Partial<Record<MapStage, number>> | null;
  /** 20 万地块上出错、被叫停 */
  bigError?: string;
  /** 带插件那张没长出来 = plugin 是 null */
  stats: { official: MapStats | null; plugin: MapStats | null };
  /** 和官方比变了几块:海拔、气温或降水、海陆湖 */
  changed: { elevation: number; climate: number; water: number } | null;
  /** 插件出的图层:编号、标题、几块有值 */
  layers: { id: string; title: string; cells: number }[];
  /** 带插件长两遍一样不一样;没查 = null */
  sameTwice: boolean | null;
  /** 改一笔地形接着记着的长,和另装一份插件从头长的一样不一样;没查 = null */
  cachedSame: boolean | null;
  /** 不一样在哪 */
  sameNote?: string;
  /** 改一笔地形:官方变了几块、带插件变了几块、其中官方没变而带插件变了的几块;没查 = null */
  edit: { official: number; plugin: number; far: number } | null;
  /** 各推 MAP_TRIAL_YEARS 年;没推 = null */
  civ: { official: MapCiv | null; plugin: MapCiv | null };
}

export interface MapTrialSeed {
  map: MapTrial;
  /** 每一步做了什么、多久 */
  log: string[];
  /** 插件装不上、出错停下 */
  error?: string;
}

export const emptyMapTrial = (): MapTrial => ({
  cells: 0,
  stageMs: {},
  bigStageMs: null,
  stats: { official: null, plugin: null },
  changed: null,
  layers: [],
  sameTwice: null,
  cachedSame: null,
  edit: null,
  civ: { official: null, plugin: null },
});

const round1 = (x: number) => Math.round(x * 10) / 10;

/** 一张图的几样数(群落按 BIOMES 的先后,先全列上,两张都比完再去掉都是 0 的) */
export function mapStats(w: World): MapStats {
  const n = w.mesh.n;
  let land = 0;
  let lakes = 0;
  let t = 0;
  let p = 0;
  const biome = new Float64Array(BIOMES.length);
  for (let i = 0; i < n; i++) {
    if (w.water[i] === 2) lakes++;
    if (w.water[i] !== 0) continue;
    land++;
    t += w.temperature[i];
    p += w.precipitation[i];
    biome[w.biome[i]]++;
  }
  const biomes: Record<string, number> = {};
  BIOMES.forEach((b, k) => (biomes[b.name] = land ? round1((100 * biome[k]) / land) : 0));
  return {
    land: round1((100 * land) / n),
    lakes,
    rivers: w.rivers.length,
    peak: Math.round(w.maxElevation),
    temperature: land ? round1(t / land) : 0,
    precipitation: land ? Math.round(p / land) : 0,
    biomes,
  };
}

/** 两张图都是 0 的群落不列 */
function dropEmptyBiomes(a: MapStats, b: MapStats | null): void {
  for (const k of Object.keys(a.biomes)) {
    if (a.biomes[k] || b?.biomes[k]) continue;
    delete a.biomes[k];
    if (b) delete b.biomes[k];
  }
}

/** 每个地块变没变:海拔、气温或降水、海陆湖、群落,哪样变了都算 */
function changedCells(a: World, b: World): Uint8Array {
  const n = a.mesh.n;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!Object.is(a.elevation[i], b.elevation[i])) out[i] |= 1;
    if (!Object.is(a.temperature[i], b.temperature[i]) || !Object.is(a.precipitation[i], b.precipitation[i])) out[i] |= 2;
    if (a.water[i] !== b.water[i]) out[i] |= 4;
    if (a.biome[i] !== b.biome[i]) out[i] |= 8;
  }
  return out;
}

const countBits = (m: Uint8Array, bit: number) => m.reduce((s, v) => s + (v & bit ? 1 : 0), 0);

const sameArray = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
};

const FIELDS: readonly [keyof World, string][] = [
  ['elevation', '海拔'],
  ['water', '海陆湖'],
  ['waterLevel', '湖面高度'],
  ['temperature', '气温'],
  ['precipitation', '降水'],
  ['seaIce', '海冰'],
  ['biome', '群落'],
  ['flux', '径流'],
];

/** 两张图哪里不一样(一样 = null):海拔、气候、群落、河、最高的山、插件的图层 */
export function worldDiff(a: World, b: World): string | null {
  for (const [k, name] of FIELDS) if (!sameArray(a[k] as ArrayLike<number>, b[k] as ArrayLike<number>)) return name;
  if (!Object.is(a.maxElevation, b.maxElevation)) return '最高的山';
  if (a.rivers.length !== b.rivers.length || a.rivers.some((r, i) => !sameArray(r.cells, b.rivers[i].cells) || !sameArray(r.pts, b.rivers[i].pts))) return '河';
  const la = a.mapLayers ?? [];
  const lb = b.mapLayers ?? [];
  if (la.length !== lb.length || la.some((l, i) => l.by !== lb[i].by || l.id !== lb[i].id || !sameArray(l.values, lb[i].values))) return '图层';
  return null;
}

/** 推几千年的几样数 */
export function mapCiv(civ: Civ): MapCiv {
  const year = Math.floor(civ.endYear);
  return {
    viable: civ.viable && !civ.stuck,
    ...(civ.stuck ? { stuck: Math.floor(civ.stuck.at) } : {}),
    regions: civ.viable ? civ.regions.count : 0,
    states: civ.viable ? civ.polities.length : 0,
    alive: civ.viable ? civ.polities.filter((p) => polityAlive(p, year)).length : 0,
  };
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sec = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;
const STAGE_NAME: Record<MapStage, string> = { height: '改海拔', climate: '改气候', layers: '出图层' };
const stagesText = (s: Partial<Record<MapStage, number>>) =>
  (Object.entries(s) as [MapStage, number][]).map(([k, v]) => `${STAGE_NAME[k]} ${v} 毫秒`).join('、') || '没出手';

/** 一次生成里每一口用了多久(只记,叫停照 MapClock) */
class StageClock extends MapClock {
  readonly byStage: Partial<Record<MapStage, number>> = {};
  spend(id: string, stage: MapStage, ms: number): void {
    this.byStage[stage] = round1((this.byStage[stage] ?? 0) + ms);
    super.spend(id, stage, ms);
  }
}

export interface MapTrialOptions {
  /** 另在多少地块上量用时(0 = 不量;不给 = MAP_TRIAL_BIG_CELLS) */
  bigCells?: number;
  /** 推几年(不给 = MAP_TRIAL_YEARS) */
  years?: number;
  /** 每做完一步交一次到这一步为止的结果(帮手到时停掉线程时用最后一次的) */
  report?: (r: MapTrialSeed) => void;
  now?: () => number;
}

/**
 * 在 params 这个示例世界上试跑这个地图插件(带字节;滑条要照清单补齐,见 plugin/mapPlugins.ts 的 mapPluginFiles):装不上、出错照实写进 error 和 stage。
 * 先做要紧的(用时、几样数、推历史),再查两遍一样、改一笔,最后量 20 万地块
 */
export async function trialMap(params: WorldParams, file: MapPluginFile & { bytes: Uint8Array }, box: MapBoxer, opt: MapTrialOptions = {}): Promise<MapTrialSeed> {
  const now = opt.now ?? (() => performance.now());
  const years = opt.years ?? MAP_TRIAL_YEARS;
  const map = emptyMapTrial();
  const log: string[] = [];
  const out: MapTrialSeed = { map, log };
  const report = () => opt.report?.({ map: structuredClone(map), log: [...log], ...(out.error ? { error: out.error } : {}) });
  const fail = (e: unknown) => {
    if (e instanceof MapPluginError) {
      map.stage = e.stage;
      out.error = `${STAGE_NAME[e.stage]}这一口出错：${e.why}`;
    } else out.error = `出错了：${msg(e)}`;
    log.push(out.error);
    report();
    return out;
  };

  let first: LoadedMap;
  let t0 = now();
  try {
    first = await loadMapFile(file, mapPluginKey(file), box);
  } catch (e) {
    out.error = `插件装不上：${msg(e)}`;
    log.push(out.error);
    report();
    return out;
  }
  const plugins = [first.plugin];
  const looks = first.looks;
  try {
    const official = generateWorld(params);
    log.push(`不带插件长一张：${sec(now() - t0)}`);
    map.cells = official.mesh.n;
    map.stats.official = mapStats(official);

    t0 = now();
    const clock = new StageClock(now);
    const cache: BaseCache = { base: null };
    let world: World;
    try {
      world = generateWorld(params, undefined, undefined, undefined, cache, timedMapPlugins(plugins, clock));
    } catch (e) {
      map.stageMs = clock.byStage;
      dropEmptyBiomes(map.stats.official, null);
      return fail(e);
    }
    map.stageMs = clock.byStage;
    map.stats.plugin = mapStats(world);
    dropEmptyBiomes(map.stats.official, map.stats.plugin);
    const diff = changedCells(official, world);
    map.changed = { elevation: countBits(diff, 1), climate: countBits(diff, 2), water: countBits(diff, 4) };
    map.layers = looks.map((l) => {
      const v = world.mapLayers?.find((x) => x.by === first.record.id && x.id === l.id)?.values;
      return { id: l.id, title: l.title, cells: v ? v.reduce((s, x) => s + (Number.isNaN(x) ? 0 : 1), 0) : 0 };
    });
    log.push(`带插件长一张：${sec(now() - t0)}，${stagesText(map.stageMs)}`);
    report();

    t0 = now();
    const civOff = civOrStuck(official, { endYear: years });
    map.civ.official = mapCiv(civOff);
    const civOn = civOrStuck(world, { endYear: years });
    map.civ.plugin = mapCiv(civOn);
    log.push(`两张各推 ${years} 年：${sec(now() - t0)}，带插件的${map.civ.plugin.viable ? '长出了文明' : map.civ.plugin.stuck !== undefined ? `推到第 ${map.civ.plugin.stuck} 年推不下去` : '没长出文明'}`);
    report();

    t0 = now();
    const again = generateWorld(params, undefined, undefined, undefined, undefined, plugins);
    const twice = worldDiff(world, again);
    map.sameTwice = twice === null;
    if (twice) map.sameNote = `长两遍${twice}不一样`;
    // 改一笔:接着长的那张用着上面记下的没改地形的星球;从头长的另装一份插件、换一个键,什么都没记着
    const edited = generateWorld(params, undefined, [MAP_TRIAL_EDIT], undefined, cache, plugins);
    const fresh = await loadMapFile(file, mapPluginKey(file), box);
    let scratch: World;
    try {
      scratch = generateWorld(params, undefined, [MAP_TRIAL_EDIT], undefined, undefined, [{ ...fresh.plugin, key: `${fresh.plugin.key}#trial` }]);
    } finally {
      fresh.plugin.dispose();
    }
    const cached = worldDiff(edited, scratch);
    map.cachedSame = cached === null;
    if (cached && !twice) map.sameNote = `改一笔以后接着长和从头长${cached}不一样`;
    const officialEdited = generateWorld(params, undefined, [MAP_TRIAL_EDIT]);
    const a = changedCells(official, officialEdited);
    const b = changedCells(world, edited);
    let far = 0;
    for (let i = 0; i < a.length; i++) if (b[i] && !a[i]) far++;
    map.edit = { official: countBits(a, 15), plugin: countBits(b, 15), far };
    log.push(
      `查两遍一样、改一笔：${sec(now() - t0)}，长两遍${twice ? '不一样' : '一样'}，改一笔接着长和从头长${cached ? '不一样' : '一样'}，官方变了 ${map.edit.official} 块、带插件变了 ${map.edit.plugin} 块（官方没变的 ${far} 块）`,
    );
    if (map.sameNote) {
      out.error = map.sameNote;
      log.push(out.error);
    }
    report();

    const bigCells = opt.bigCells ?? MAP_TRIAL_BIG_CELLS;
    if (bigCells > 0) {
      t0 = now();
      const big = new StageClock(now);
      try {
        generateWorld({ ...params, cells: bigCells }, undefined, undefined, undefined, undefined, timedMapPlugins(plugins, big));
      } catch (e) {
        map.bigError = e instanceof MapPluginError ? `${STAGE_NAME[e.stage]}这一口出错：${e.why}` : msg(e);
      }
      map.bigStageMs = big.byStage;
      log.push(`${bigCells / 10_000} 万地块带插件长一张：${sec(now() - t0)}，${map.bigError ?? stagesText(big.byStage)}`);
      report();
    }
    return out;
  } catch (e) {
    return fail(e);
  } finally {
    first.plugin.dispose();
  }
}


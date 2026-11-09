/**
 * 把现有的世界转进世界仓库(worldVault.ts),在单独的后台线程里做(worldConvertWorker.ts;怎么排、什么时候让路见 ui/worldStore.ts)。三种:
 *
 * - original:浏览器里有它的原件(ui/resultStore.ts)。地图、各段世界、历史的字节直接拿来,不重算生成和推演;
 *   编年史、国旗用现在的代码算(用的人今天打开看到的就是这样)。原件只读,一个字不动。原件不记插件,用了推演、地图插件的世界不走这条
 * - recompute:没有原件,但世界就是当前版本建的:当前版本算一遍就是它原来的样子。和生成世界的线程走同一段推演代码(worldRun.ts)。
 *   用了推演插件、地图插件的带着世界记的那一版插件推、长地图(本机没有就不转,见 ui/worldStore.ts 的 jobFor);
 *   地图插件的图层、星球参照和生成世界的线程存的一样
 * - keptMap:地图留着的世界(gen/edits.ts 文件头"地图留着的世界"):地图、各段世界的块照原样从仓库里拿,历史按现在的规则从第 0 年推一遍。
 *   哪个世界存着那张地图(和要的各段世界)就从哪拿,原来那个世界删了也行。读不到、对不上、推出来校验不过的报错,不算出一个怪东西
 *
 * 没有原件的更旧版本不到这里:按现在的代码算出来不是它原来的样子,不能当它存下来。
 *
 * 用的人等着存成文件时(fileIfFull)写不进仓库也不白算:算好的内容直接装成文件,跟着 full 的错交回去(FullWithFile)。
 */
import { generateCiv, planetNames, planetTempo, type Civ } from './gen/civ';
import { timedMapPlugins, type MapPlugin } from './gen/mapHooks';
import type { SimPlugin } from './gen/civ/engine/plugin';
import { playStop } from './gen/civ/play';
import type { SimRead } from './gen/civ/simRead';
import { civOrStuck } from './gen/civ/stuck';
import { mergeUpheavals } from './gen/civ/upheaval';
import { worldTuning } from './gen/civ/ruleSet';
import { GENERATOR_VERSION, type TerrainOp } from './gen/edits';
import { FIRST_READERS, READER_VERSIONS } from './gen/readers/versions';
import { worldCheck, type SaveFile } from './gen/savefile';
import { sketchGrid } from './gen/sketch';
import { SNAPSHOT_FORMAT, makePart, partOf, readLocalPart, recipeKey, recipeOfSave, type Recipe, type SnapshotPart } from './gen/snapshot';
import { generateWorld, type World } from './gen/world';
import { openStoredParts, readTrustedParts, type PackedPart, type WorldEras } from './gen/worldFile';
import { mapPluginKey, type AuthorContent, type PlanetValue, type WorldMade, type WorldPlugin } from './gen/worldFormat';
import { validateCiv, validateEras, validateWorld } from './gen/worldValidate';
import { indexedDbResults, type ResultBackend } from './resultDb';
import type { MapPluginFile, SimPluginFile } from './plugin/pluginWorld';
import type { SimBoxer, SimPluginsOn } from './simPluginRun';
import type { MapBoxer } from './mapPluginRun';
import { eraWorlds, keyOf, mapLayerParts, mapValue, namesOpt, playOpt, setupOpt, upOpt, worldChronicle, worldFlags, yearsOpt } from './worldRun';
import { VaultError, asVaultError, commitWorld, draftFile, readRevision, type CommitRequest, type CommitResult, type DraftedFile, type RevisionSource, type StoredRevision } from './worldVault';

interface JobBase {
  id: string;
  /** 世界的存档 */
  save: SaveFile;
  /** 作者内容、封面(和存档一样由主线程给;不给 = 没有) */
  thumb?: Uint8Array;
  /** 用的人等着存成文件:写不进仓库就直接装成文件。author = 页面里有、还没写进仓库的 AI 正文 */
  fileIfFull?: { author?: AuthorContent };
  /** 按配方推的(recompute、keptMap):世界记的推演插件,本机装着的同一版(按出手的先后);不给 = 没用 */
  simPlugins?: SimPluginFile[];
  /** 按配方算的(recompute):世界记的地图插件,本机装着的同一版(按出手的先后);不给 = 没用 */
  mapPlugins?: MapPluginFile[];
}

/** 写不进仓库,但内容已经装成文件了 */
export interface FullWithFile extends VaultError {
  drafted?: DraftedFile;
}

/** 存进仓库;写不下时见 JobBase.fileIfFull */
async function keep(req: CommitRequest, job: JobBase): Promise<CommitResult> {
  try {
    return await commitWorld(req);
  } catch (e) {
    const v = asVaultError(e) as FullWithFile;
    if (v.kind === 'full' && job.fileIfFull) v.drafted = (await draftFile({ ...req, ...job.fileIfFull })) ?? undefined;
    throw v;
  }
}

/** 转一个世界 */
export type ConvertJob =
  | (JobBase & { kind: 'original'; generator: number; source: Extract<RevisionSource, 'migrated' | 'archive'> })
  | (JobBase & { kind: 'recompute'; app: string; commit: string })
  /** from = 去哪几个世界找那张地图(按先后) */
  | (JobBase & { kind: 'keptMap'; from: readonly string[]; app: string; commit: string });

/** 编年史、国旗打成两块 */
async function storyParts(world: World, civ: Civ, save: SaveFile): Promise<SnapshotPart[]> {
  return [await makePart('chronicle', worldChronicle(civ, save.edits.characters)), await makePart('flags', worldFlags(world, civ))];
}

/** 原件里的块是世界文件有版本以前打的,都是第 1 版结构(编年史、国旗是这里新算的,不算) */
const ORIGINAL_SCHEMAS = { map: 1, eras: 1, civ: 1 };

/** 从原件转 */
async function fromOriginal(job: Extract<ConvertJob, { kind: 'original' }>, results: ResultBackend): Promise<CommitResult> {
  const rec = await results.get(job.id, job.generator);
  if (!rec) throw new VaultError('failed', '原件不在了');
  const s = rec.snapshot;
  if (s.format !== SNAPSHOT_FORMAT || s.generator !== job.generator) throw new VaultError('failed', '原件的格式不对');
  if ((await recipeKey(recipeOfSave(job.save))) !== s.recipe) throw new VaultError('failed', '原件和存档对不上');
  const mapPart = partOf(s, 'map');
  const civPart = partOf(s, 'civ');
  if (!mapPart || !civPart) throw new VaultError('failed', '原件缺块');
  const erasPart = partOf(s, 'eras');
  const eras = erasPart ? ((await readLocalPart(erasPart)) as { eras: unknown[] }) : null;
  const world = (await readLocalPart(mapPart)) as World;
  const civ = (await readLocalPart(civPart)) as Civ;
  const parts = [mapPart, ...(erasPart && eras?.eras.length ? [erasPart] : []), civPart, ...(await storyParts(world, civ, job.save))];
  // 真实的版本:存的时候记下的那一版;提交号当时没记,不编
  const made: WorldMade = { app: rec.app, generator: rec.generator, commit: '', at: Number.isNaN(Date.parse(rec.at)) ? job.save.savedAt : rec.at };
  return keep({ id: job.id, recipe: job.save, recipeKey: s.recipe, parts, schemas: ORIGINAL_SCHEMAS, made, readers: { ...FIRST_READERS }, thumb: job.thumb, source: job.source }, job);
}

/** 地图留着的世界用的地图、各段世界(存下来的,不重新长) */
export interface KeptWorlds {
  map: World;
  eras: WorldEras | null;
}

/**
 * 按存档算一遍:地图、各段世界、整段历史。结果和生成世界的线程按这份存档推出来的一样。kept = 地图留着的世界存下的地图、各段世界,只推历史。
 * plugins = 推演插件(带着的推不下去时和生成世界的线程一样停在那一年);maps = 长地图的地图插件(按先后)。
 * planet = 存进世界的星球参照(用地图插件长、改过地形的才有)
 */
export function recomputeWorld(save: SaveFile, kept?: KeptWorlds, plugins?: readonly SimPlugin<SimRead>[], maps?: readonly MapPlugin[]): { world: World; civ: Civ; steps: { key: string; year: number; world: World }[]; planet: PlanetValue | null } {
  const r = recipeOfSave(save);
  if (r.keptMap && !kept) throw new VaultError('failed', '地图留着的世界不按种子重新长');
  const params = r.params;
  const terrain = (r.terrain ?? []) as TerrainOp[];
  const sketch = sketchGrid(r.sketch);
  const keys = maps?.map((m) => m.key);
  const grow = () => (maps?.length ? timedMapPlugins(maps) : undefined);
  const world = kept ? kept.map : generateWorld(params, undefined, terrain, sketch, undefined, grow());
  if (!kept && save.check && save.check !== worldCheck(world)) throw new VaultError('failed', '算出来的地形和存档对不上');
  let all: TerrainOp[] = [...terrain];
  const steps = mergeUpheavals(r.upheavals ?? []).map((m) => {
    all = [...all, ...m.ops];
    const key = keyOf(params, all, r.sketch, keys);
    if (kept) {
      const era = kept.eras?.eras.find((x) => x.key === key);
      if (!era) throw new VaultError('failed', '存下的内容里少一段地形大事');
      return { ...m, key, all, world: { ...era.world, mesh: world.mesh } as World };
    }
    const w = generateWorld(params, undefined, all, sketch, undefined, grow());
    w.history = [];
    return { ...m, key, all, world: w };
  });
  // 改过地形的:扩张节拍按没改地形时的同一颗星球(和生成世界的线程一样);另起文明种子的、地图留着的按地图本身
  const tempo = kept || !terrain.length || r.civSeed !== undefined ? undefined : (planetTempo(params, undefined, sketch, grow()) ?? null);
  const civParams = {
    interventions: r.interventions?.length ? [...r.interventions] : undefined,
    tempo,
    ...upOpt(steps),
    ...namesOpt(r.names),
    ...yearsOpt(r.endYear),
    ...setupOpt({ frontier: r.frontier, origins: r.origins, civSeed: r.civSeed, calamity: r.calamity, tuning: worldTuning(save.edits.rules) }),
    ...playOpt({ play: r.play, interventions: r.interventions }),
    // 地名不照"没改过地形的星球"起:按现在的版本长的那一颗不是它
    ...(kept ? { placeRef: false as const } : {}),
    ...(maps?.length ? { mapPlugins: grow() } : {}),
  };
  const civ = plugins?.length ? civOrStuck(world, { ...civParams, plugins: [...plugins] }, r.play ? { snap: (y) => playStop(y) } : {}) : generateCiv(world, civParams);
  const names = maps?.length && (terrain.length || sketch) ? planetNames(world, civParams, true) : undefined;
  const planet = tempo !== undefined || names ? { ...(tempo !== undefined ? { tempo } : {}), ...(names ? { names } : {}) } : null;
  return { world, civ, steps, planet };
}

/** 装好任务带的地图插件(没带 = null);装不上抛错(不转) */
async function mapsOf(job: JobBase, box: MapBoxer | undefined): Promise<{ plugins: MapPlugin[]; run: typeof import('./mapPluginRun') } | null> {
  if (!job.mapPlugins?.length) return null;
  const run = await import('./mapPluginRun');
  await run.loadMaps(job.mapPlugins, box ?? run.quickjsMapBox);
  const keys = job.mapPlugins.map(mapPluginKey);
  const plugins = run.mapPluginsOf(keys);
  if (!plugins) throw new VaultError('failed', `地图插件装不上:${run.loadError(keys.find((k) => !run.loadedMap(k)) ?? keys[0])?.message ?? ''}`);
  return { plugins, run };
}

/** 装好任务带的推演插件(没带 = null);seed = 文明种子 */
async function simsOf(job: JobBase, box: SimBoxer | undefined): Promise<SimPluginsOn | null> {
  if (!job.simPlugins?.length) return null;
  const r = recipeOfSave(job.save);
  const run = await import('./simPluginRun');
  return run.simPluginsOn(job.simPlugins, r.civSeed ?? r.params.seed, box ?? run.quickjsBox);
}

/** 带着推演插件、地图插件按存档算一遍,算完放掉推演插件 */
async function recomputeWith(job: JobBase, kept: KeptWorlds | undefined, box: SimBoxer | undefined, mapBox?: MapBoxer): Promise<ReturnType<typeof recomputeWorld> & { sims: WorldPlugin[] | null; maps: Awaited<ReturnType<typeof mapsOf>> }> {
  const maps = kept ? null : await mapsOf(job, mapBox);
  const sims = await simsOf(job, box);
  try {
    return { ...recomputeWorld(job.save, kept, sims?.plugins, maps?.plugins), sims: sims ? sims.records : null, maps };
  } finally {
    sims?.dispose();
  }
}

/** 按当前版本算一遍 */
async function fromRecipe(job: Extract<ConvertJob, { kind: 'recompute' }>, box?: SimBoxer, mapBox?: MapBoxer): Promise<CommitResult> {
  if (job.save.generator !== GENERATOR_VERSION) throw new VaultError('failed', '存档不是当前版本');
  const r = recipeOfSave(job.save);
  const { world, civ, steps, planet, sims, maps } = await recomputeWith(job, undefined, box, mapBox);
  const keys = maps?.plugins.map((p) => p.key);
  const looks = maps ? maps.plugins.map((p) => ({ id: p.id, looks: maps.run.loadedMap(p.key)!.looks })) : [];
  const layers = [];
  for (const l of mapLayerParts(looks, world, steps)) layers.push(await makePart(l.name, l.value));
  const parts = [
    await makePart('map', mapValue(world)),
    ...(steps.length ? [await makePart('eras', { baseKey: keyOf(r.params, r.terrain, r.sketch, keys), eras: eraWorlds(steps) ?? [] })] : []),
    await makePart('civ', civ),
    ...(await storyParts(world, civ, job.save)),
    ...layers,
    ...(planet ? [await makePart('planet', planet)] : []),
  ];
  const made: WorldMade = { app: job.app, generator: GENERATOR_VERSION, commit: job.commit, at: new Date().toISOString() };
  const mapRecords = maps ? { mapPlugins: maps.plugins.map((p) => maps.run.loadedMap(p.key)!.record) } : {};
  return keep({ id: job.id, recipe: job.save, recipeKey: await recipeKey(r), parts, made, readers: { ...READER_VERSIONS }, thumb: job.thumb, source: 'migrated', ...(sims ? { simPlugins: sims } : {}), ...mapRecords }, job);
}

const asSnapshotPart = (p: PackedPart): SnapshotPart => ({ name: p.info.name, bytes: p.info.bytes, sum: p.info.sum, zip: p.info.zip as SnapshotPart['zip'], data: p.data instanceof Uint8Array ? (p.data.slice().buffer as ArrayBuffer) : p.data });

/** 这份配方的各段世界的键(按先后) */
function eraKeysOf(r: Recipe): string[] {
  let all: TerrainOp[] = [...((r.terrain ?? []) as TerrainOp[])];
  return mergeUpheavals(r.upheavals ?? []).map((m) => {
    all = [...all, ...m.ops];
    return keyOf(r.params, all, r.sketch);
  });
}

/** 读出一份修订里的地图、各段世界,看是不是这份配方要的。读不懂、少一段抛错 */
async function keptWorldsIn(src: StoredRevision, r: Recipe): Promise<KeptWorlds> {
  const opened = openStoredParts(src.text, src.parts, { readers: { ...READER_VERSIONS } });
  const values = await readTrustedParts(opened, ['map', 'eras']);
  validateWorld(values.map);
  const eras = (values.eras as WorldEras | null) ?? null;
  if (eras) validateEras(eras, values.map);
  const need = eraKeysOf(r);
  if (need.length && eras?.baseKey !== keyOf(r.params, r.terrain, r.sketch)) throw new VaultError('failed', '存下的内容里少一段地形大事');
  if (need.some((k) => !eras?.eras.some((x) => x.key === k))) throw new VaultError('failed', '存下的内容里少一段地形大事');
  return { map: values.map, eras };
}

/**
 * 找存着这张地图、这份配方要的各段世界的那一份修订。同一张地图可能有好几个世界存着(地形大事不一样),不合适的接着找;
 * 有地图但都用不了的报最后那个原因
 */
async function keptSource(from: readonly string[], r: Recipe): Promise<{ src: StoredRevision; kept: KeptWorlds }> {
  let why: unknown = new VaultError('failed', '这个世界的地图不在仓库里');
  for (const id of new Set(from)) {
    const head = await readRevision(id, undefined, []);
    if (!head || head.manifest.parts.find((p) => p.name === 'map')?.sum !== r.keptMap) continue;
    const src = await readRevision(id, head.head.n, ['map', 'eras']).catch((e: unknown) => {
      why = e;
      return null;
    });
    if (!src) continue;
    try {
      return { src, kept: await keptWorldsIn(src, r) };
    } catch (e) {
      why = e;
    }
  }
  throw why;
}

/** 地图留着的世界:存下的地图上按现在的规则推一遍 */
async function fromKeptMap(job: Extract<ConvertJob, { kind: 'keptMap' }>, box?: SimBoxer): Promise<CommitResult> {
  if (job.save.generator !== GENERATOR_VERSION) throw new VaultError('failed', '存档不是当前版本');
  const r = recipeOfSave(job.save);
  if (!r.keptMap) throw new VaultError('failed', '不是地图留着的世界');
  let src: StoredRevision;
  let civ: Civ;
  let world: World;
  let sims: WorldPlugin[] | null;
  try {
    const found = await keptSource(job.from, r);
    src = found.src;
    ({ civ, world, sims } = await recomputeWith(job, found.kept, box));
    validateCiv(civ, world);
  } catch (e) {
    throw e instanceof VaultError ? e : new VaultError('failed', `这张地图上推不出历史:${e instanceof Error ? e.message : String(e)}`);
  }
  const map = src.parts.find((p) => p.info.name === 'map')!;
  const eras = src.parts.find((p) => p.info.name === 'eras');
  // 大事都去掉了(按另一版规则另存的)就不带各段世界,没去掉的照原样留着
  const useEras = !!eras && !!r.upheavals?.length;
  const parts = [asSnapshotPart(map), ...(useEras ? [asSnapshotPart(eras)] : []), await makePart('civ', civ), ...(await storyParts(world, civ, job.save))];
  const made: WorldMade = { app: job.app, generator: GENERATOR_VERSION, commit: job.commit, at: new Date().toISOString() };
  return keep(
    {
      id: job.id,
      recipe: job.save,
      recipeKey: await recipeKey(r),
      parts,
      schemas: { map: map.info.schema, ...(useEras ? { eras: eras.info.schema } : {}) },
      made,
      // 地形按地图长出来时那一版读,放大的细部才不变;历史是现在算的,查询用现在的
      readers: { terrain: src.manifest.readers.terrain, query: READER_VERSIONS.query },
      thumb: job.thumb,
      ...(sims ? { simPlugins: sims } : {}),
    },
    job,
  );
}

/** 转一个世界;转不了抛错。box、mapBox = 怎么装推演插件、地图插件(单测用;不给 = 浏览器里的 QuickJS) */
export function runConvert(job: ConvertJob, results?: ResultBackend, box?: SimBoxer, mapBox?: MapBoxer): Promise<CommitResult> {
  if (job.kind === 'recompute') return fromRecipe(job, box, mapBox);
  if (job.kind === 'keptMap') return fromKeptMap(job, box);
  const db = results ?? indexedDbResults();
  if (!db) return Promise.reject(new VaultError('unavailable', '没有 IndexedDB'));
  return fromOriginal(job, db);
}

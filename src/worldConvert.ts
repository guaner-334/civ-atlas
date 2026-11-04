/**
 * 把现有的世界转进世界仓库(worldVault.ts),在单独的后台线程里做(worldConvertWorker.ts;怎么排、什么时候让路见 ui/worldStore.ts)。两种:
 *
 * - original:浏览器里有它的原件(ui/resultStore.ts)。地图、各段世界、历史的字节直接拿来,不重算生成和推演;
 *   编年史、国旗用现在的代码算(用的人今天打开看到的就是这样)。原件只读,一个字不动
 * - recompute:没有原件,但世界就是当前版本建的:当前版本算一遍就是它原来的样子。和生成世界的线程走同一段推演代码(worldRun.ts)
 *
 * 没有原件的更旧版本不到这里:按现在的代码算出来不是它原来的样子,不能当它存下来。
 */
import { generateCiv, planetTempo, type Civ } from './gen/civ';
import { mergeUpheavals } from './gen/civ/upheaval';
import { worldTuning } from './gen/civ/ruleSet';
import { GENERATOR_VERSION, type TerrainOp } from './gen/edits';
import { FIRST_READERS, READER_VERSIONS } from './gen/readers/versions';
import { worldCheck, type SaveFile } from './gen/savefile';
import { sketchGrid } from './gen/sketch';
import { SNAPSHOT_FORMAT, makePart, partOf, readLocalPart, recipeKey, recipeOfSave, type SnapshotPart } from './gen/snapshot';
import { generateWorld, type World } from './gen/world';
import type { AuthorContent, WorldMade } from './gen/worldFormat';
import { indexedDbResults, type ResultBackend } from './resultDb';
import { eraWorlds, keyOf, mapValue, namesOpt, playOpt, setupOpt, upOpt, worldChronicle, worldFlags, yearsOpt } from './worldRun';
import { VaultError, commitWorld, type CommitResult, type RevisionSource } from './worldVault';

interface JobBase {
  id: string;
  /** 世界的存档 */
  save: SaveFile;
  /** 作者内容、封面(和存档一样由主线程给;不给 = 没有) */
  author?: AuthorContent | null;
  thumb?: Uint8Array;
}

/** 转一个世界 */
export type ConvertJob =
  | (JobBase & { kind: 'original'; generator: number; source: Extract<RevisionSource, 'migrated' | 'archive'> })
  | (JobBase & { kind: 'recompute'; app: string; commit: string });

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
  return commitWorld({ id: job.id, recipe: job.save, recipeKey: s.recipe, parts, schemas: ORIGINAL_SCHEMAS, made, readers: { ...FIRST_READERS }, author: job.author, thumb: job.thumb, source: job.source });
}

/** 按存档算一遍:地图、各段世界、整段历史。结果和生成世界的线程按这份存档推出来的一样 */
export function recomputeWorld(save: SaveFile): { world: World; civ: Civ; steps: { key: string; world: World }[] } {
  const r = recipeOfSave(save);
  const params = r.params;
  const terrain = (r.terrain ?? []) as TerrainOp[];
  const sketch = sketchGrid(r.sketch);
  const world = generateWorld(params, undefined, terrain, sketch);
  if (save.check && save.check !== worldCheck(world)) throw new VaultError('failed', '算出来的地形和存档对不上');
  let all: TerrainOp[] = [...terrain];
  const steps = mergeUpheavals(r.upheavals ?? []).map((m) => {
    all = [...all, ...m.ops];
    const w = generateWorld(params, undefined, all, sketch);
    w.history = [];
    return { ...m, key: keyOf(params, all, r.sketch), all, world: w };
  });
  // 改过地形的:扩张节拍按没改地形时的同一颗星球(和生成世界的线程一样);另起文明种子的按地图本身
  const tempo = !terrain.length || r.civSeed !== undefined ? undefined : (planetTempo(params, undefined, sketch) ?? null);
  const civ = generateCiv(world, {
    interventions: r.interventions?.length ? [...r.interventions] : undefined,
    tempo,
    ...upOpt(steps),
    ...namesOpt(r.names),
    ...yearsOpt(r.endYear),
    ...setupOpt({ frontier: r.frontier, origins: r.origins, civSeed: r.civSeed, calamity: r.calamity, tuning: worldTuning(save.edits.rules) }),
    ...playOpt({ play: r.play, interventions: r.interventions }),
  });
  return { world, civ, steps };
}

/** 按当前版本算一遍 */
async function fromRecipe(job: Extract<ConvertJob, { kind: 'recompute' }>): Promise<CommitResult> {
  if (job.save.generator !== GENERATOR_VERSION) throw new VaultError('failed', '存档不是当前版本');
  const r = recipeOfSave(job.save);
  const { world, civ, steps } = recomputeWorld(job.save);
  const parts = [
    await makePart('map', mapValue(world)),
    ...(steps.length ? [await makePart('eras', { baseKey: keyOf(r.params, r.terrain, r.sketch), eras: eraWorlds(steps) ?? [] })] : []),
    await makePart('civ', civ),
    ...(await storyParts(world, civ, job.save)),
  ];
  const made: WorldMade = { app: job.app, generator: GENERATOR_VERSION, commit: job.commit, at: new Date().toISOString() };
  return commitWorld({ id: job.id, recipe: job.save, recipeKey: await recipeKey(r), parts, made, readers: { ...READER_VERSIONS }, author: job.author, thumb: job.thumb, source: 'migrated' });
}

/** 转一个世界;转不了抛错 */
export function runConvert(job: ConvertJob, results?: ResultBackend): Promise<CommitResult> {
  if (job.kind === 'recompute') return fromRecipe(job);
  const db = results ?? indexedDbResults();
  if (!db) return Promise.reject(new VaultError('unavailable', '没有 IndexedDB'));
  return fromOriginal(job, db);
}

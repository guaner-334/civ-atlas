/**
 * 打开「我的世界」里存过内容的世界:从世界仓库(worldVault.ts)读一份修订,在生成世界的后台线程里做(worker.ts 的 load),主线程不经手字节。
 * 线程读得慢、卡住了,主线程等不到就关掉它(ui/openGuard.ts),页面照样能点。
 *
 * 能读的时候:仓库里最新的修订就是存档这份配方、这一版生成器算的。第一次打开逐项校验,过了记下来(WorldState.checked),内容没变再打开只核指纹。
 * 读不了就拒绝(OpenRefused),主线程退回旧的路(原件,再不行按存档生成),拒绝的说法见 OpenRefusal。
 * 块坏了的,小状态里记一笔(corrupt),下一次存完整的内容时块重写一遍(worldVault.ts)。
 * 编年史、国旗能按历史重新算出来:这两块读不出来不算世界读不了,世界照样打开,这两样现算(worker.ts 的 load)。
 *
 * 不碰 DOM。
 */
import { olderTerrainOf } from './gen/readers/older';
import type { TerrainReader } from './gen/readers/terrainReader';
import { READER_VERSIONS, UnknownReaderError, type ReaderVersions } from './gen/readers/versions';
import { GENERATOR_VERSION } from './gen/edits';
import type { Civ } from './gen/civ';
import type { FlagBook } from './gen/civ/story/flags';
import type { ChronicleBlock } from './gen/civ/story/nameTokens';
import { parseSave } from './gen/savefile';
import { recipeKey, recipeOfSave, type SnapshotPart } from './gen/snapshot';
import type { World } from './gen/world';
import { openStoredParts, readStoredContent, readTrustedParts, type OpenedWorldFile, type PackedPart, type WorldEras } from './gen/worldFile';
import { WorldFileError, asWorldFileError, broken } from './gen/worldFormat';
import { currentSchema, migratePart } from './gen/worldMigrate';
import { VaultError, latestOf, patchState, pendingEdit, readRevision, stateOf, type RevisionHead } from './worldVault';

/** 要打开哪个世界 */
export interface StoredOpen {
  id: string;
  /** 配方指纹(gen/snapshot.ts 的 recipeKey) */
  recipe: string;
  /** 存档记的生成器版本 */
  generator: number;
}

/**
 * 为什么不能从仓库打开:
 * - none:仓库里没有这个世界
 * - generator:修订和存档不是同一版生成器算的(比如按新版重存过),或者比软件新
 * - recompute:有待完成的修改,修订是当前版本算的:按存档重算就补上了
 * - readonly:有待完成的修改,修订是更旧的版本算的:只能只读打开修订自己的样子(recipe = 修订的配方)
 * - newer:读这个世界要新版软件
 * - broken:读不出来、校验不过、读取代码下载不下来
 */
export type OpenRefusal = 'none' | 'generator' | 'recompute' | 'readonly' | 'newer' | 'broken';

export class OpenRefused extends Error {
  readonly why: OpenRefusal;
  /** why = readonly:修订的配方(存档的样子,没清理过,用之前过一遍 parseSave) */
  readonly recipe?: unknown;
  constructor(why: OpenRefusal, message: string, recipe?: unknown) {
    super(message);
    this.name = 'OpenRefused';
    this.why = why;
    this.recipe = recipe;
  }
}

/** 读出来的世界 */
export interface StoredWorld {
  head: RevisionHead;
  readers: ReaderVersions;
  /** 世界要老版本的地貌读取代码:下载好的那一版;当前版本 = null */
  older: TerrainReader | null;
  world: World;
  eras: WorldEras | null;
  /** 没要历史时(见 openStoredWorld)可能是 null */
  civ: Civ | null;
  /** 存的编年史、国旗;没要历史、读不出来 = null(调用方现算) */
  chronicle: ChronicleBlock | null;
  flags: FlagBook | null;
  /** 编年史那一块存的就是现在的结构(parts 里的字节可以直接用,不用重新打包) */
  chronicleIsCurrent: boolean;
  /** 读到的几块的字节(块名 → 块;清单里没有的不在);历史接着推时才解开,解开后用 fromCiv 转到现在的结构 */
  parts: ReadonlyMap<string, SnapshotPart>;
  fromCiv: (value: unknown) => Civ;
}

/** 看世界要读的几块。历史排在编年史前面:第 1 版的编年史转结构时要看历史 */
const VIEW = ['map', 'eras', 'civ', 'chronicle', 'flags'];
/** 其中读不了也能打开世界的(能按历史重新算出来) */
const SPARE = ['chronicle', 'flags'];

const asPart = (p: PackedPart): SnapshotPart => ({ name: p.info.name, bytes: p.info.bytes, sum: p.info.sum, zip: p.info.zip as SnapshotPart['zip'], data: p.data instanceof Uint8Array ? (p.data.slice().buffer as ArrayBuffer) : p.data });

/**
 * 读一个世界。读不了抛 OpenRefused,不抛别的。
 * wantCiv = false:只要地图、各段世界(线程被重开过,重新钉住世界时用;校验过的不解开历史)
 */
export async function openStoredWorld(req: StoredOpen, wantCiv = true): Promise<StoredWorld> {
  let head: RevisionHead | null = null;
  try {
    head = await latestOf(req.id);
    if (!head) throw new OpenRefused('none', '仓库里没有这个世界');
    if (head.generator !== req.generator || head.generator > GENERATOR_VERSION) throw new OpenRefused('generator', `修订是第 ${head.generator} 版算的,存档是第 ${req.generator} 版`);
    const pending = pendingEdit(head, req.recipe);
    if (pending === 'recompute') throw new OpenRefused('recompute', '有待完成的修改');
    if (pending === 'readonly') {
      const rev = await readRevision(req.id, head.n, []);
      throw new OpenRefused('readonly', '有待完成的修改', rev?.manifest.recipe);
    }
    const n = head.n;
    const checked = (await stateOf(req.id).catch(() => null))?.checked === head.content;
    const rev = await readRevision(req.id, n, checked ? VIEW : undefined, SPARE);
    if (!rev) throw new OpenRefused('none', '仓库里没有这个世界');
    const opened = openStoredParts(rev.text, rev.parts, { readers: { ...READER_VERSIONS } });
    const { manifest } = opened;
    let values: { map: unknown; eras: unknown; civ: unknown; chronicle?: unknown; flags?: unknown };
    if (checked) {
      values = (await readTrustedParts(opened, wantCiv ? VIEW.filter((p) => !SPARE.includes(p)) : ['map', 'eras'])) as typeof values;
      if (wantCiv) for (const name of SPARE) values[name as 'chronicle' | 'flags'] = await spareOf(opened, name, values.civ as Civ);
    } else {
      values = await readStoredContent(opened);
      // 这份清单真是这份配方的(表里记的指纹和清单里的配方对得上)
      const r = parseSave(JSON.stringify(manifest.recipe));
      if (!r.ok || (await recipeKey(recipeOfSave(r.save))) !== rev.head.recipeKey) broken('清单的配方和修订记的对不上');
      // 记不下就下次再校验一遍
      await patchState(req.id, { checked: rev.head.content }).catch(() => undefined);
    }
    const chronicle = (values.chronicle as ChronicleBlock | null | undefined) ?? null;
    const flags = (values.flags as FlagBook | null | undefined) ?? null;
    // 这两块坏了世界照样开(现算),下一次存完整的内容时块重写一遍。记不下也不碍事
    if (wantCiv && (!chronicle || !flags)) await patchState(req.id, { corrupt: head.n }).catch(() => undefined);
    const readers: ReaderVersions = { terrain: manifest.readers.terrain, query: manifest.readers.query };
    const older = await olderTerrainOf({ readers });
    const civInfo = manifest.parts.find((p) => p.name === 'civ');
    if (!civInfo) broken('缺 civ 这一块');
    return {
      head: rev.head,
      readers,
      older,
      world: values.map as World,
      eras: (values.eras as WorldEras | null) ?? null,
      civ: (values.civ as Civ | null) ?? null,
      chronicle,
      flags,
      chronicleIsCurrent: manifest.parts.find((p) => p.name === 'chronicle')?.schema === currentSchema('chronicle'),
      parts: new Map(rev.parts.map((p) => [p.info.name, asPart(p)])),
      fromCiv: (v) => migratePart('civ', civInfo.schema, v, manifest) as Civ,
    };
  } catch (e) {
    throw await refusal(e, req.id, head);
  }
}

/** 读一块能重新算出来的:读不了 = null */
async function spareOf(opened: OpenedWorldFile, name: string, civ: Civ): Promise<unknown> {
  try {
    return (await readTrustedParts(opened, [name], { civ }))[name];
  } catch {
    return null;
  }
}

/** 抛出来的折成拒绝。块真的坏了就记一笔;读取代码下载不下来、内存不够、转不了结构的,字节都还是好的 */
async function refusal(e: unknown, id: string, head: RevisionHead | null): Promise<OpenRefused> {
  if (e instanceof OpenRefused) return e;
  if (e instanceof UnknownReaderError) return new OpenRefused(e.needsUpdate ? 'newer' : 'broken', e.message);
  const bad = (e instanceof VaultError && e.kind === 'corrupt') || (e instanceof WorldFileError && e.kind === 'broken');
  // 记不下也不碍事
  if (bad && head) await patchState(id, { corrupt: head.n, checked: undefined }).catch(() => undefined);
  if (e instanceof VaultError) return new OpenRefused('broken', e.message);
  const f = asWorldFileError(e);
  return new OpenRefused(f.kind === 'newer' ? 'newer' : 'broken', f.message);
}

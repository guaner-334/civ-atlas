/**
 * 打包、读世界文件(格式见 worldFormat.ts)。
 *
 * 用法:
 * - 存:packWorldFile(内容) → Blob。清单的 made、readers 由调用方传进来。
 *   按块存的(浏览器里的仓库,worldVault.ts)用同一层:packWorldParts 打成清单 + 各块,zipWorld 把清单和块拼成文件,所以两边打出来的字节一样
 * - 读:openWorldFile(文件) 只看外壳和清单,很快;readWorldContent(打开的文件) 再解开各块、迁移到现在的结构、逐项核对
 * - 另存、改名:rewriteWorldFile(打开的文件, 改了什么):没改的块连字节都不动,认不出的、结构比软件新的块原样带着
 *
 * 读的时候出错一律抛 WorldFileError,kind 分三种(worldFormat.ts):broken 坏了、newer 要更新软件、readonly 只读。
 *
 * 大小:本机存取的文件按 ZIP_LOCAL_MAX_BYTES,传上服务器的调用方传 maxBytes = ZIP_UPLOAD_MAX_BYTES;单块解压的上限跟着它走(worldPartLimit)。
 *
 * 纯计算,不碰 DOM:网页、worker、Node(服务器)共用。
 */
import type { ChronicleEntry } from './civ/story/chronicle';
import type { FlagBook } from './civ/story/flags';
import type { Civ } from './civ/types';
import { parseSave, type SaveFile } from './savefile';
import { makePart, partBytes, sha256, unpackValue, type SnapshotPart } from './snapshot';
import type { World } from './world';
import { MIGRATIONS, currentSchema, migratePart, type MigrationTable } from './worldMigrate';
import { parseManifest, validateAuthor, validateChronicle, validateCiv, validateEras, validateFlags, validateThumb, validateWorld, worldHeadLimit, worldPartLimit } from './worldValidate';
import { ZIP_LOCAL_MAX_BYTES, parseZip, writeZip } from './zipStore';
import {
  KNOWN_PARTS,
  MANIFEST_FILE,
  WORLD_APP,
  WORLD_FORMAT,
  WORLD_KIND,
  asWorldFileError,
  broken,
  type AuthorContent,
  type WorldMade,
  type WorldManifest,
  type WorldPartInfo,
  type WorldPlugin,
  type WorldReaders,
  type WorldRevision,
} from './worldFormat';

/** 地形大事以后的一段世界:不带网格(和地图同一套)、不带回放快照 */
export interface WorldEra {
  /** 这一段的键(网站按它对上主图的补丁) */
  key: string;
  world: Omit<World, 'mesh'>;
}

/** eras 那一块 */
export interface WorldEras {
  /** 原来那段世界的键 */
  baseKey: string;
  eras: WorldEra[];
}

/** 一个世界的内容 */
export interface WorldValues {
  /** 地图:打包时去掉形成过程的回放快照(不存) */
  map: World;
  /** 地形大事以后的各段;没有地形大事 = 不给,或者给空的(都不写这一块) */
  eras?: WorldEras | null;
  civ: Civ;
  chronicle: ChronicleEntry[];
  flags: FlagBook;
  /** 作者内容(AI 写的正文);没有 = 不给 */
  author?: AuthorContent | null;
  /** 封面(JPEG 的字节);没有 = 不给 */
  thumb?: Uint8Array | null;
}

/** 插件放的附加数据:只当字节留着,看世界用不着 */
export interface WorldExtra {
  /** 块名(不能和认得的几块重名);习惯上写 ext.插件名 */
  name: string;
  /** 这一块的结构版本(插件自己的) */
  schema: number;
  by?: string;
  value: unknown;
}

/** 打包要的东西 */
export interface PackInput extends WorldValues {
  id: string;
  title?: string;
  made: WorldMade;
  readers: WorldReaders;
  /** 存档的全部内容 */
  recipe: SaveFile;
  plugins?: WorldPlugin[];
  /** 第几次修订(不给 = 第 1 次) */
  revision?: WorldRevision;
  extras?: WorldExtra[];
  /** 文件最大多少字节(不给 = 本机存取的上限;传上服务器的传 ZIP_UPLOAD_MAX_BYTES) */
  maxBytes?: number;
}

/** 一块:清单那一项 + 压缩后的字节 */
export interface PackedPart {
  info: WorldPartInfo;
  data: Uint8Array | ArrayBuffer;
}

/** 块的路径:认得的块照表写,别的压缩了写 .gz、没压缩写 .bin */
function fileOf(name: string, zip: string): string {
  const known = KNOWN_PARTS.get(name);
  // 没有 CompressionStream 的环境 makePart 不压缩,认得的块也不能叫 .gz
  if (known && (zip === 'gzip' || !known.file.endsWith('.gz'))) return known.file;
  return `parts/${name}.${zip === 'gzip' ? 'gz' : 'bin'}`;
}

function packedFrom(p: SnapshotPart, schema: number, need: WorldPartInfo['need'], by?: string): PackedPart {
  return { info: { name: p.name, file: fileOf(p.name, p.zip), schema, sum: p.sum, bytes: p.bytes, zip: p.zip, need, ...(by !== undefined ? { by } : {}) }, data: p.data };
}

/**
 * 已经压缩好的一块(后台线程打的、原件里的)变成清单那一项 + 字节,不再压缩一遍。
 * schema = 这些字节是第几版结构;不给 = 现在的版本(刚打好的)。原件里的块是世界文件有版本以前打的,调用方传 1
 */
export function knownPart(p: SnapshotPart, schema?: number, migrations?: MigrationTable): PackedPart {
  const known = KNOWN_PARTS.get(p.name);
  if (!known) throw new Error(`认不出这一块:${p.name}`);
  return packedFrom(p, schema ?? currentSchema(p.name, migrations), known.need);
}

/** 认得的一块打包;结构版本 = 现在的版本 */
export async function packKnown(name: string, value: unknown, migrations?: MigrationTable): Promise<PackedPart> {
  return knownPart(await makePart(name, value), undefined, migrations);
}

/** 封面:JPEG 本身压缩过,不再压缩 */
export async function packThumb(bytes: Uint8Array, migrations?: MigrationTable): Promise<PackedPart> {
  const sum = await sha256(bytes);
  return { info: { name: 'thumb', file: fileOf('thumb', 'none'), schema: currentSchema('thumb', migrations), sum, bytes: bytes.length, zip: 'none', need: 'extra' }, data: bytes };
}

/** 去掉回放快照(不存)、各段世界的网格(和地图同一套) */
function mapValue(map: World): World {
  return { ...map, history: [] };
}

function erasValue(e: WorldEras): WorldEras {
  return {
    baseKey: e.baseKey,
    eras: e.eras.map(({ key, world }) => {
      const { mesh: _mesh, ...rest } = world as Omit<World, 'mesh'> & { mesh?: unknown };
      void _mesh;
      return { key, world: { ...rest, history: [] } };
    }),
  };
}

/** 配方进清单:origin.url 只认 https,开发环境里存的 http 出处去掉(出处只是一行署名),别的原样 */
function recipeValue(recipe: SaveFile): SaveFile {
  if (!recipe.origin || recipe.origin.url.startsWith('https://')) return recipe;
  const { origin: _origin, ...rest } = recipe;
  void _origin;
  return rest;
}

/** 清单写成 manifest.json 的字节 */
export function manifestBytes(manifest: WorldManifest): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

/** 清单的字节和各块装成 ZIP */
export function zipWorld(text: Uint8Array, parts: readonly PackedPart[], maxBytes: number = ZIP_LOCAL_MAX_BYTES): Promise<Blob> {
  return writeZip([{ name: MANIFEST_FILE, data: text }, ...parts.map((p) => ({ name: p.info.file, data: p.data }))], maxBytes);
}

/** 把清单和各块装成 ZIP。写出来之前按读的规矩核对一遍清单:写得出来的就读得回来 */
async function assemble(manifest: WorldManifest, parts: readonly PackedPart[], readers: Readonly<Record<string, number>>, maxBytes: number, migrations?: MigrationTable): Promise<Blob> {
  const text = manifestBytes(manifest);
  parseManifest(text, { readers, migrations, maxBytes });
  return zipWorld(text, parts, maxBytes);
}

/** 清单里除了各块以外的字段 */
export type ManifestFields = Pick<PackInput, 'id' | 'title' | 'made' | 'readers' | 'recipe' | 'plugins' | 'revision'>;

/** 写清单:parts = 各块那几项,按文件里的先后 */
export function buildManifest(input: ManifestFields, parts: readonly WorldPartInfo[]): WorldManifest {
  return {
    app: WORLD_APP,
    kind: WORLD_KIND,
    format: WORLD_FORMAT,
    id: input.id,
    ...(input.title ? { title: input.title } : {}),
    made: input.made,
    readers: input.readers,
    parts: [...parts],
    recipe: recipeValue(input.recipe),
    plugins: input.plugins ?? [],
    revision: input.revision ?? { n: 1 },
  };
}

/** 清单 + 各块,还没装成文件 */
export interface PackedWorld {
  manifest: WorldManifest;
  parts: PackedPart[];
}

/** 打成清单 + 各块(见 packWorldFile);整个文件和按块存的都从这里出 */
export async function packWorldParts(input: PackInput): Promise<PackedWorld> {
  const parts: PackedPart[] = [await packKnown('map', mapValue(input.map))];
  if (input.eras?.eras.length) parts.push(await packKnown('eras', erasValue(input.eras)));
  parts.push(await packKnown('civ', input.civ), await packKnown('chronicle', input.chronicle), await packKnown('flags', input.flags));
  if (input.author) parts.push(await packKnown('author', input.author));
  if (input.thumb) parts.push(await packThumb(input.thumb));
  for (const x of input.extras ?? []) {
    if (KNOWN_PARTS.has(x.name)) throw new Error(`附加数据不能叫 ${x.name}`);
    parts.push(packedFrom(await makePart(x.name, x.value), x.schema, 'extra', x.by));
  }
  return { manifest: buildManifest(input, parts.map((p) => p.info)), parts };
}

/**
 * 打成世界文件。这里不跑 validateWorld、validateCiv:存是自己的数据,万一校验器误伤,东西也得先存下来;
 * 读的时候才核对(清单除外,写坏的清单谁都读不了)
 */
export async function packWorldFile(input: PackInput): Promise<Blob> {
  const { manifest, parts } = await packWorldParts(input);
  return assemble(manifest, parts, { ...input.readers }, input.maxBytes ?? ZIP_LOCAL_MAX_BYTES);
}

// ---------------------------------------------------------------------------
// 读

/** 读文件要知道的 */
export interface OpenOptions {
  /** 这一版软件有的读取规则版本(terrain、query) */
  readers: WorldReaders;
  /** 文件最大多少字节(不给 = 本机存取的上限;服务器传 ZIP_UPLOAD_MAX_BYTES) */
  maxBytes?: number;
  /** 迁移表(不给 = 现在的;单测用假的) */
  migrations?: MigrationTable;
}

/** 打开的文件:清单 + 各块压缩后的字节(还没解开) */
export interface OpenedWorldFile {
  manifest: WorldManifest;
  /** manifest.json 的原字节(算修订的指纹) */
  manifestBytes: Uint8Array;
  /** 块名 → 压缩后的字节 */
  bytes: ReadonlyMap<string, Uint8Array>;
  /** 这一版软件只当字节留着的块:need 是 extra,而且认不出,或者结构比软件新 */
  kept: readonly WorldPartInfo[];
  options: OpenOptions;
}

/**
 * 打开文件:核对外壳和清单,不解开各块。
 * ZIP 里的东西要和清单一一对上(多一个没列的也不行:那些字节没有清单担保,校验、审核都看不到)。
 * 文件可以是 Blob 或者内存里的字节;坏的报 broken,比软件新的报 newer
 */
export async function openWorldFile(file: Blob | Uint8Array, options: OpenOptions): Promise<OpenedWorldFile> {
  try {
    const maxBytes = options.maxBytes ?? ZIP_LOCAL_MAX_BYTES;
    const size = file instanceof Blob ? file.size : file.length;
    if (size > maxBytes) broken('文件太大');
    const entries = parseZip(file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file, maxBytes);
    const files = new Map(entries.map((e) => [e.name, e.data]));
    const manifestBytes = files.get(MANIFEST_FILE);
    if (!manifestBytes) broken('文件里没有清单');
    const manifest = parseManifest(manifestBytes, { readers: options.readers, migrations: options.migrations, maxBytes });
    if (files.size !== manifest.parts.length + 1) broken('文件里的东西和清单对不上');
    const bytes = new Map<string, Uint8Array>();
    const kept: WorldPartInfo[] = [];
    for (const p of manifest.parts) {
      const data = files.get(p.file);
      if (!data) broken(`文件里缺 ${p.file}`);
      bytes.set(p.name, data);
      if (!KNOWN_PARTS.has(p.name) || p.schema > currentSchema(p.name, options.migrations) || (p.zip !== 'gzip' && p.zip !== 'none')) kept.push(p);
    }
    return { manifest, manifestBytes, bytes, kept, options };
  } catch (err) {
    throw asWorldFileError(err);
  }
}

/** 解开的世界 */
export interface WorldContent extends WorldValues {
  eras: WorldEras | null;
  author: AuthorContent | null;
  thumb: Uint8Array | null;
  /** 配方照存档的办法读出来的那份(清理过);界面用这一份,不用清单里的原样 */
  save: SaveFile;
  /** 读配方时的提示(和打开存档时一样) */
  warnings: string[];
  /** 转不了结构的可选块(need 是 extra):读不出来,字节还留着 */
  skipped: string[];
}

/**
 * 解开各块、迁移到现在的结构、逐项核对。原件的字节不动,出错了 opened 还能照样另存。
 * 只当字节留着的块(opened.kept)不解开。需要的块坏了报 broken;转不了结构报 readonly
 */
export async function readWorldContent(opened: OpenedWorldFile): Promise<WorldContent> {
  const { manifest } = opened;
  const migrations = opened.options.migrations ?? MIGRATIONS;
  const skipped: string[] = [];
  const raw = async (name: string): Promise<Uint8Array | null> => {
    const info = manifest.parts.find((p) => p.name === name);
    if (!info || opened.kept.includes(info)) return null;
    return partBytes(info as Pick<SnapshotPart, 'name' | 'bytes' | 'sum' | 'zip'>, opened.bytes.get(name)!, worldPartLimit(name, opened.options.maxBytes));
  };
  /** 解开、迁移;decode = 字节怎么变成值(封面就是字节本身) */
  const read = async (name: string, decode: (b: Uint8Array) => unknown = (b) => unpackValue(b, worldHeadLimit(opened.options.maxBytes))): Promise<unknown> => {
    const b = await raw(name);
    if (!b) return null;
    const info = manifest.parts.find((p) => p.name === name)!;
    try {
      return migratePart(name, info.schema, decode(b), manifest, migrations);
    } catch (err) {
      // 可选的块转不了结构不碍看世界
      if (info.need === 'extra' && asWorldFileError(err).kind === 'readonly') {
        skipped.push(name);
        return null;
      }
      throw err;
    }
  };
  try {
    const map = await read('map');
    validateWorld(map);
    const eras = (await read('eras')) as WorldEras | null;
    if (eras) validateEras(eras, map);
    const civ = await read('civ');
    validateCiv(civ, map);
    // 各段历史按下标对各段世界(有的大事还没推到,世界可以比历史多,不能少)
    if ((civ.eras?.length ?? 0) > (eras?.eras.length ?? 0)) broken('历史的各段比世界的各段多');
    const chronicle = await read('chronicle');
    validateChronicle(chronicle, civ);
    const flags = await read('flags');
    validateFlags(flags, civ);
    const author = (await read('author')) as AuthorContent | null;
    if (author) validateAuthor(author);
    const thumb = (await read('thumb', (b) => b)) as Uint8Array | null;
    if (thumb) validateThumb(thumb);
    const r = parseSave(JSON.stringify(manifest.recipe));
    if (!r.ok) broken(r.error);
    return { map, eras, civ, chronicle, flags, author, thumb, save: r.save, warnings: r.warnings, skipped };
  } catch (err) {
    throw asWorldFileError(err);
  }
}

// ---------------------------------------------------------------------------
// 另存

/** 另存时改什么;没写的照原样 */
export interface RewriteChange {
  title?: string;
  made?: WorldMade;
  readers?: WorldReaders;
  recipe?: SaveFile;
  plugins?: WorldPlugin[];
  /** 换掉的块;eras、author、thumb 给 null = 去掉这一块 */
  values?: Partial<WorldValues>;
  /** 文件最大多少字节(不给 = 本机存取的上限) */
  maxBytes?: number;
}

/**
 * 另存一份:改清单、换几块,修订号加一、记上一份清单的指纹。没换的块(包括认不出的附加数据)字节不动;清单里认不出的字段也原样带着。
 * 换掉的块按现在的结构写
 */
export async function rewriteWorldFile(opened: OpenedWorldFile, change: RewriteChange = {}): Promise<Blob> {
  const { manifest } = opened;
  const v = change.values ?? {};
  const table = opened.options.migrations;
  const replaced = new Map<string, PackedPart | null>();
  if (v.map) replaced.set('map', await packKnown('map', mapValue(v.map), table));
  if (v.eras !== undefined) replaced.set('eras', v.eras?.eras.length ? await packKnown('eras', erasValue(v.eras), table) : null);
  if (v.civ) replaced.set('civ', await packKnown('civ', v.civ, table));
  if (v.chronicle) replaced.set('chronicle', await packKnown('chronicle', v.chronicle, table));
  if (v.flags) replaced.set('flags', await packKnown('flags', v.flags, table));
  if (v.author !== undefined) replaced.set('author', v.author ? await packKnown('author', v.author, table) : null);
  if (v.thumb !== undefined) replaced.set('thumb', v.thumb ? await packThumb(v.thumb, table) : null);

  const parts: PackedPart[] = [];
  for (const p of manifest.parts) {
    if (!replaced.has(p.name)) parts.push({ info: p, data: opened.bytes.get(p.name)! });
    else {
      const next = replaced.get(p.name);
      if (next) parts.push(next);
      replaced.delete(p.name);
    }
  }
  // 原来没有、这次才有的块
  for (const next of replaced.values()) if (next) parts.push(next);

  const readers = change.readers ?? manifest.readers;
  const next: WorldManifest = {
    ...manifest,
    ...(change.title !== undefined ? { title: change.title } : {}),
    ...(change.made ? { made: change.made } : {}),
    readers,
    parts: parts.map((p) => p.info),
    recipe: recipeValue(change.recipe ?? manifest.recipe),
    plugins: change.plugins ?? manifest.plugins,
    revision: { n: manifest.revision.n + 1, parent: await sha256(opened.manifestBytes) },
  };
  return assemble(next, parts, { ...opened.options.readers, ...readers }, change.maxBytes ?? ZIP_LOCAL_MAX_BYTES, opened.options.migrations);
}

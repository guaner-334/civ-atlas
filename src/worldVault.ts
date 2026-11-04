/**
 * 世界仓库:每个世界完整的内容(地图、各段世界、历史、编年史、国旗、作者内容、封面)存在浏览器的 IndexedDB 里('civ-atlas:worlds' 库),
 * 格式是世界文件(gen/worldFormat.ts)拆开的样子:块和清单能原样拼回一个 .civworld(revisionFile)。
 *
 * 三张表:
 * - parts:块。键 = 解压后字节的指纹 + 压缩方式,相同内容只存一份。值 = 压缩后的字节,带写入时间 at(有索引:清理时不用把字节读出来)
 * - manifests:清单。键 = 世界编号 + 修订号。值 = 清单原文和几项简要信息(RevisionRow)
 * - states:每个世界一行小状态(WorldState):转存到哪了、最近一次是不是写不下。不是世界内容,丢了只是多做一遍
 *
 * 一次写完不留半截(commitWorld):
 *   1. 新块先写,一块一个事务;写完读回来,解压、核对指纹。对不上就删掉这一块(不然以后都当它存好了),这次算没存成
 *   2. 最后写清单。写清单的事务同时查一遍:修订号有没有被别的标签页抢先、清单要的块是不是都在。不对就从头再来一次
 *   清单写成功才算存好。任何一步断掉(关页面、写满、线程被关)都只多出几个没有清单引用的块,读不到半截,上一份修订还在。
 *
 * 清理(sweepParts)和写清单靠事务互相挡着:清理的事务先读全部清单、再删块,写清单的事务先查块、再写清单,两张表都在事务里,浏览器让它们一个一个来。
 * 所以被清单引用的块绝不会被清;刚写的、还没写清单的块放够 PART_GRACE_MS 才清,别的标签页、这个线程正在写的不受影响;
 * 万一时钟跳了提前清了,写清单时查得出来,补写一遍。
 *
 * 这里自己只删两样东西:没有清单引用的块;同一个世界保留规则以外的旧修订(keepRows)。不按时间淘汰。
 * 删整个世界(purgeWorld、clearVault)只听调用方的(ui/worldStore.ts),这里不看「我的世界」的列表。
 *
 * 不碰 DOM:在后台线程里跑(worldVaultWorker.ts、worldConvertWorker.ts),多个线程、多个标签页同时用也不会写坏。
 * 出错一律抛 VaultError;调用方接住以后世界照常用,这里出什么事都不影响旧的存档和原件。
 *
 * 读:打开世界时生成世界的线程直接从这里读(worldOpen.ts),不经主线程。发现哪份修订的块坏了,小状态里记一笔(corrupt):
 * 按内容存的块不会再写第二遍,所以下一次存完整的内容时不管一样不一样,块全部重写、写新清单,坏的块就补好了。
 */
import { LOCAL_PART_MAX_BYTES, partBytes, sha256, type SnapshotPart } from './gen/snapshot';
import { GENERATOR_VERSION } from './gen/edits';
import type { SaveFile } from './gen/savefile';
import { buildManifest, knownPart, manifestBytes, packKnown, packThumb, zipWorld, type PackedPart } from './gen/worldFile';
import { KNOWN_PARTS, type AuthorContent, type WorldMade, type WorldManifest, type WorldPartInfo, type WorldPlugin, type WorldReaders } from './gen/worldFormat';
import { parseManifest, validateThumb } from './gen/worldValidate';

/** 库名 */
export const VAULT_DB = 'civ-atlas:worlds';

/** 没有清单引用的块放多久才清(毫秒):比写一个最大的世界用的时间长得多 */
export const PART_GRACE_MS = 3_600_000;

/** 看世界用的几块:这几块都一样,才算内容没变(作者内容、封面、配方变了不算) */
const VIEW_PARTS = ['map', 'eras', 'civ', 'chronicle', 'flags'];

/** 写清单时发现别的标签页抢先了、块被清了:从头再来几次 */
const COMMIT_TRIES = 5;

/** 仓库出错 */
export type VaultErrorKind =
  /** 写不下(浏览器存储满了) */
  | 'full'
  /** 浏览器不让用 IndexedDB */
  | 'unavailable'
  /** 写进去读回来对不上、清单要的块没了 */
  | 'corrupt'
  | 'failed';

export class VaultError extends Error {
  readonly kind: VaultErrorKind;
  constructor(kind: VaultErrorKind, message: string) {
    super(message);
    this.name = 'VaultError';
    this.kind = kind;
  }
}

function isQuota(e: unknown): boolean {
  const x = e as { name?: string } | null;
  return !!x && (x.name === 'QuotaExceededError' || x.name === 'NS_ERROR_DOM_QUOTA_REACHED');
}

/** 不管抛出来的是什么,都折成 VaultError */
export function asVaultError(e: unknown): VaultError {
  if (e instanceof VaultError) return e;
  const message = e instanceof Error ? e.message : String(e);
  return new VaultError(isQuota(e) ? 'full' : 'failed', message);
}

/** 这一份修订怎么来的 */
export type RevisionSource =
  /** 推完、改完存的 */
  | 'made'
  /** 把旧的原件、存档转进来的那一份(迁移前的原样,不淘汰) */
  | 'migrated'
  /** 比现在的存档更旧的版本留下的原件,转进来留底:不是这个世界现在的样子,不算最新的修订 */
  | 'archive';

interface PartRow {
  key: string;
  at: number;
  data: ArrayBuffer;
}

/** 清单那张表的一行 */
export interface RevisionRow {
  id: string;
  n: number;
  /** manifest.json 的原文 */
  text: string;
  /** 清单引用的块(parts 表的键) */
  keys: string[];
  /** 看世界用的几块的指纹连起来:一样 = 看世界的内容没变 */
  content: string;
  /** 配方指纹(gen/snapshot.ts 的 recipeKey) */
  recipeKey: string;
  /** 这份内容是哪一版生成器算的 */
  generator: number;
  source: RevisionSource;
  at: number;
}

/** 一行清单的简要信息 */
export type RevisionHead = Omit<RevisionRow, 'text' | 'keys'>;

/** 一个世界的小状态 */
export interface WorldState {
  id: string;
  /** old:没有原件的更旧版本,转不了;failed:转的时候失败了 */
  status?: 'old' | 'failed';
  /** 记 old 时存档的生成器版本 */
  generator?: number;
  /** 记 failed 时的软件版本(换了版本才再试) */
  app?: string;
  error?: string;
  /** 已经转过的旧版原件(生成器版本) */
  archived?: number[];
  /** 最近一次写不下的时间(写成功一次就清掉) */
  full?: number;
  /** 校验器过了的内容(RevisionRow.content):内容没变,再打开只核指纹,不再逐项校验 */
  checked?: string;
  /** 打开时发现这一份修订的块坏了(修订号):下一次存完整的内容时块全部重写 */
  corrupt?: number;
}

/** 存一份修订要的东西 */
export interface CommitRequest {
  id: string;
  /** 存档的全部内容 */
  recipe: SaveFile;
  /** 配方指纹 */
  recipeKey: string;
  /**
   * 这次打好的、看世界用的几块(map、eras、civ、chronicle、flags),已经压缩好。相同内容不会再写一遍。
   * 不给 = 只改了配方、作者内容、封面:这几块沿用最新的修订;配方指纹对不上(历史改了还没推完)就不存,等推完
   */
  parts?: SnapshotPart[];
  /** parts 里这几块的结构版本(块名 → 版本);没写的 = 现在的。原件里的块写 1 */
  schemas?: Readonly<Record<string, number>>;
  /** 什么时候用哪一版做的(给了 parts 必须给) */
  made?: WorldMade;
  readers?: WorldReaders;
  /** 作者内容:不给 = 沿用最新的修订;null = 去掉 */
  author?: AuthorContent | null;
  /** 封面(JPEG 字节):不给 = 沿用最新的修订;null = 去掉。不是 JPEG 的不要(封面是可选的,不为它存坏世界) */
  thumb?: Uint8Array | null;
  /** 不给 = made */
  source?: RevisionSource;
}

export type CommitResult =
  /** 存好了,第 n 份 */
  | { status: 'saved'; n: number }
  /** 和最新的一份一样,没写 */
  | { status: 'same'; n: number }
  /** 只改配方、作者内容,但这个世界还没有修订 */
  | { status: 'nobase' }
  /** 只改配方、作者内容,但配方变了:有待完成的修改,等推完 */
  | { status: 'draft' };

/**
 * 崩了以后拿存着的修订和配方草稿比:
 * - none:没有待完成的修改(还没有修订的也算:没有东西可比)
 * - recompute:修订是当前版本算的,按草稿重算就补上了
 * - readonly:修订是别的版本算的,重算出来不是它原来的样子,只能只读打开、提示有没推完的修改
 */
export type PendingEdit = 'none' | 'recompute' | 'readonly';

export function pendingEdit(stored: Pick<RevisionHead, 'recipeKey' | 'generator'> | null, draftKey: string, generator: number = GENERATOR_VERSION): PendingEdit {
  if (!stored || stored.recipeKey === draftKey) return 'none';
  return stored.generator === generator ? 'recompute' : 'readonly';
}

/** 主线程交给仓库的、后台线程打好的一份内容 */
export interface WorldPartsOffer {
  generator: number;
  recipe: string;
  parts: SnapshotPart[];
}

// ---------------------------------------------------------------------------
// 库

let dbp: Promise<IDBDatabase> | null = null;

const VAULT_STORES = ['parts', 'manifests', 'states'];

/**
 * 打开库;version 不给 = 现在是第几版就开第几版:以后的版本加了表,这一版的代码照样用(测试网站和正式网站共用一个库)。
 * 表不全(比如别处先空开过这个库)就升一版建上
 */
function openDb(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined') throw new Error('没有 IndexedDB');
      r = version === undefined ? indexedDB.open(VAULT_DB) : indexedDB.open(VAULT_DB, version);
    } catch (e) {
      reject(new VaultError('unavailable', e instanceof Error ? e.message : String(e)));
      return;
    }
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('parts')) d.createObjectStore('parts', { keyPath: 'key' }).createIndex('at', 'at');
      if (!d.objectStoreNames.contains('manifests')) d.createObjectStore('manifests', { keyPath: ['id', 'n'] });
      if (!d.objectStoreNames.contains('states')) d.createObjectStore('states', { keyPath: 'id' });
    };
    r.onsuccess = () => {
      const d = r.result;
      if (!VAULT_STORES.every((n) => d.objectStoreNames.contains(n))) {
        const next = d.version + 1;
        d.close();
        openDb(next).then(resolve, reject);
        return;
      }
      const drop = () => {
        dbp = null;
      };
      // 别的标签页要升版本:让开。连接断了(浏览器回收、页面从后台回来):下次重开
      d.onversionchange = () => {
        d.close();
        drop();
      };
      d.onclose = drop;
      resolve(d);
    };
    r.onerror = () => reject(new VaultError(isQuota(r.error) ? 'full' : 'unavailable', r.error?.message ?? 'IndexedDB 打不开'));
  });
}

const db = () =>
  (dbp ??= openDb().catch((e: unknown) => {
    // 打不开的下次再试
    dbp = null;
    throw e;
  }));

/** 单测用:换了一个库以后放掉连接 */
export function _resetVault(): void {
  void dbp?.then((d) => d.close()).catch(() => undefined);
  dbp = null;
}

/** 开一个事务:body 里发请求,done 记下结果;事务完成才算数,中止、出错 reject */
async function run<T>(stores: string[], mode: IDBTransactionMode, body: (t: IDBTransaction, done: (v: T) => void) => void, strict = false): Promise<T> {
  for (let tries = 0; ; tries++) {
    const d = await db();
    let t: IDBTransaction;
    try {
      t = strict ? d.transaction(stores, mode, { durability: 'strict' }) : d.transaction(stores, mode);
    } catch (e) {
      // 连接已经断了:重开一次
      dbp = null;
      if (tries) throw asVaultError(e);
      continue;
    }
    return new Promise<T>((resolve, reject) => {
      let value: T;
      t.oncomplete = () => resolve(value);
      t.onerror = () => reject(asVaultError(t.error ?? new Error('IndexedDB 写入失败')));
      t.onabort = () => reject(asVaultError(t.error ?? new Error('IndexedDB 写入中止')));
      try {
        body(t, (v) => (value = v));
      } catch (e) {
        try {
          t.abort();
        } catch {
          /* 已经结束了 */
        }
        reject(asVaultError(e));
      }
    });
  }
}

const rangeOf = (id: string) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
const headOf = ({ text: _text, keys: _keys, ...head }: RevisionRow): RevisionHead => {
  void _text;
  void _keys;
  return head;
};
const chainOf = (rows: readonly RevisionRow[]) => rows.filter((r) => r.source !== 'archive');

/** 一个世界的全部修订(按修订号从小到大) */
function rowsOf(id: string): Promise<RevisionRow[]> {
  return run<RevisionRow[]>(['manifests'], 'readonly', (t, done) => {
    const q = t.objectStore('manifests').getAll(rangeOf(id));
    q.onsuccess = () => done(q.result as RevisionRow[]);
  });
}

// ---------------------------------------------------------------------------
// 写

/** 块在 parts 表里的键 */
export const partKey = (p: Pick<WorldPartInfo, 'sum' | 'zip'>) => `${p.sum}.${p.zip}`;

/** 这些键里哪些已经有了 */
function existing(keys: readonly string[]): Promise<Set<string>> {
  return run<Set<string>>(['parts'], 'readonly', (t, done) => {
    const have = new Set<string>();
    const s = t.objectStore('parts');
    for (const k of keys) {
      const c = s.count(k);
      c.onsuccess = () => {
        if (c.result) have.add(k);
      };
    }
    done(have);
  });
}

function toBuffer(d: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (!(d instanceof Uint8Array)) return d;
  return d.byteOffset === 0 && d.byteLength === d.buffer.byteLength ? (d.buffer as ArrayBuffer) : (d.slice().buffer as ArrayBuffer);
}

/** 写一块,读回来核对指纹。对不上就删掉、抛错 */
async function storePart(p: PackedPart): Promise<void> {
  const key = partKey(p.info);
  await run<void>(['parts'], 'readwrite', (t) => {
    t.objectStore('parts').put({ key, at: Date.now(), data: toBuffer(p.data) } satisfies PartRow);
  });
  const row = await run<PartRow | undefined>(['parts'], 'readonly', (t, done) => {
    const q = t.objectStore('parts').get(key);
    q.onsuccess = () => done(q.result as PartRow | undefined);
  });
  try {
    if (!row) throw new Error('读不回来');
    const back = new Uint8Array(row.data);
    if (p.info.zip === 'gzip' || p.info.zip === 'none') await partBytes(p.info as Pick<SnapshotPart, 'name' | 'bytes' | 'sum' | 'zip'>, back, LOCAL_PART_MAX_BYTES);
    // 认不出的压缩方式解不开,比压缩后的字节
    else if ((await sha256(back)) !== (await sha256(new Uint8Array(toBuffer(p.data))))) throw new Error('字节不一样');
  } catch (e) {
    // 坏的这一块不留:留着的话以后都当它存好了
    await run<void>(['parts'], 'readwrite', (t) => {
      t.objectStore('parts').delete(key);
    }).catch(() => undefined);
    throw new VaultError('corrupt', `${p.info.name} 写进去读回来对不上:${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 一个世界留哪几份修订:当前的、上一份内容不一样的(只改名、只换封面的不算,改十次名也还留着改名以前那段历史)、转进来的原样 */
export function keepRows(rows: readonly Pick<RevisionRow, 'n' | 'source' | 'content'>[]): Set<number> {
  const keep = new Set<number>();
  for (const r of rows) if (r.source !== 'made') keep.add(r.n);
  const chain = rows.filter((r) => r.source !== 'archive').sort((a, b) => a.n - b.n);
  const cur = chain.at(-1);
  if (!cur) return keep;
  keep.add(cur.n);
  const earlier = chain.slice(0, -1).reverse();
  const prev = earlier.find((r) => r.content !== cur.content) ?? earlier[0];
  if (prev) keep.add(prev.n);
  return keep;
}

/**
 * 写清单。一个事务里:最大的修订号还是 maxN(不然别的标签页抢先了)、要的块都在(不然被清了);都对才写,顺手去掉保留规则以外的旧修订
 */
function publish(row: RevisionRow, maxN: number): Promise<'ok' | 'conflict' | 'missing'> {
  return run<'ok' | 'conflict' | 'missing'>(
    ['parts', 'manifests'],
    'readwrite',
    (t, done) => {
      const m = t.objectStore('manifests');
      const p = t.objectStore('parts');
      done('ok');
      const q = m.getAll(rangeOf(row.id));
      q.onsuccess = () => {
        const rows = q.result as RevisionRow[];
        if ((rows.at(-1)?.n ?? 0) !== maxN) return done('conflict');
        let left = row.keys.length;
        let missing = false;
        const write = () => {
          if (missing) return done('missing');
          m.put(row);
          const keep = keepRows([...rows, row]);
          for (const r of rows) if (!keep.has(r.n)) m.delete([r.id, r.n]);
        };
        if (!left) return write();
        for (const k of row.keys) {
          const c = p.count(k);
          c.onsuccess = () => {
            if (!c.result) missing = true;
            if (--left === 0) write();
          };
        }
      };
    },
    true,
  );
}

/** 认得的块按文件里的先后排,认不出的跟在后面(和 packWorldParts 打出来的一样) */
function sortParts(list: Iterable<WorldPartInfo>): WorldPartInfo[] {
  const order = [...KNOWN_PARTS.keys()];
  const rank = (p: WorldPartInfo) => {
    const i = order.indexOf(p.name);
    return i < 0 ? order.length : i;
  };
  return [...list].sort((a, b) => rank(a) - rank(b));
}

const contentOf = (parts: readonly WorldPartInfo[]) =>
  parts
    .filter((p) => VIEW_PARTS.includes(p.name))
    .map((p) => `${p.name}:${p.sum}`)
    .join('|');

/** 除了修订号、存的时间,两份清单一样 */
function sameManifest(a: WorldManifest, b: WorldManifest): boolean {
  const norm = (m: WorldManifest) => JSON.stringify({ ...m, revision: 0, made: 0, recipe: { ...m.recipe, savedAt: '' } });
  return norm(a) === norm(b);
}

/**
 * 存一份修订。不改传进来的请求之外的任何东西;存不下抛 VaultError,上一份修订、别的世界都不受影响。
 * 这里只查清单能不能读(写坏的清单谁都读不了),不跑世界的校验器:万一校验器误伤,东西也得先存下来
 */
export async function commitWorld(req: CommitRequest): Promise<CommitResult> {
  try {
    const incoming = (req.parts ?? []).map((p) => knownPart(p, req.schemas?.[p.name]));
    const author = req.author === undefined ? undefined : req.author?.notes.length ? await packKnown('author', req.author) : null;
    let thumb: PackedPart | null | undefined;
    if (req.thumb) {
      try {
        validateThumb(req.thumb);
        thumb = await packThumb(req.thumb);
      } catch {
        thumb = undefined;
      }
    } else thumb = req.thumb;
    const fresh = [...incoming, ...(author ? [author] : []), ...(thumb ? [thumb] : [])];
    const source = req.source ?? 'made';
    // 上次打开时发现块坏了:这次带着完整的内容来,不管一样不一样都重写一遍(只改配方、作者内容的不算,等完整的内容)
    const rewrite = !!req.parts && source !== 'archive' && (await stateOf(req.id).catch(() => null))?.corrupt !== undefined;

    for (let tries = 0; tries < COMMIT_TRIES; tries++) {
      const rows = await rowsOf(req.id);
      const maxN = rows.at(-1)?.n ?? 0;
      // 留底的旧版原件自成一份,不接在最新的修订后面
      const base = source === 'archive' ? undefined : chainOf(rows).at(-1);
      if (!req.parts) {
        if (!base) return { status: 'nobase' };
        if (base.recipeKey !== req.recipeKey || base.generator !== req.recipe.generator) return { status: 'draft' };
      }
      if (source === 'archive') {
        const had = rows.find((r) => r.source === 'archive' && r.generator === req.recipe.generator);
        if (had) return { status: 'same', n: had.n };
      }
      // 清单读不懂的(坏了):当没有上一份,带着完整内容来的照样写得进去
      const prev = base ? manifestOf(base) : null;
      const infos = new Map<string, WorldPartInfo>((prev?.parts ?? []).map((p) => [p.name, p]));
      if (req.parts) {
        // 一次完整的结果:看世界的几块整个换掉(这次没有地形大事,上一次的 eras 就不算了)
        for (const n of VIEW_PARTS) infos.delete(n);
        for (const p of incoming) infos.set(p.info.name, p.info);
      }
      if (author !== undefined) {
        if (author) infos.set('author', author.info);
        else infos.delete('author');
      }
      if (thumb !== undefined) {
        if (thumb) infos.set('thumb', thumb.info);
        else infos.delete('thumb');
      }
      const parts = sortParts(infos.values());
      const made = (req.parts ? req.made : prev?.made) ?? null;
      const readers = (req.parts ? req.readers : prev?.readers) ?? null;
      if (!made || !readers) throw new VaultError('failed', '存世界没给版本');
      const plugins: WorldPlugin[] = prev?.plugins ?? [];
      const n = maxN + 1;
      const parent = base ? await sha256(new TextEncoder().encode(base.text)) : undefined;
      // 清单里认不出的字段(以后的版本写的)原样带着
      const manifest: WorldManifest = { ...(prev ?? {}), ...buildManifest({ id: req.id, title: req.recipe.title, made, readers, recipe: req.recipe, plugins, revision: { n, ...(parent ? { parent } : {}) } }, parts) };
      if (!req.recipe.title) delete manifest.title;
      if (!rewrite && prev && sameManifest(prev, manifest)) return { status: 'same', n: base!.n };
      const text = manifestBytes(manifest);
      parseManifest(text, { readers: { ...readers } });

      const have = rewrite ? new Set<string>() : await existing(fresh.map((p) => partKey(p.info)));
      const seen = new Set<string>();
      for (const p of fresh) {
        const key = partKey(p.info);
        if (have.has(key) || seen.has(key)) continue;
        seen.add(key);
        await storePart(p);
      }
      const row: RevisionRow = {
        id: req.id,
        n,
        text: new TextDecoder().decode(text),
        keys: [...new Set(parts.map(partKey))],
        content: contentOf(parts),
        recipeKey: req.recipeKey,
        generator: req.recipe.generator,
        source,
        at: Date.now(),
      };
      const out = await publish(row, maxN);
      if (out === 'ok') {
        if (rewrite) await patchState(req.id, { corrupt: undefined, checked: undefined }).catch(() => undefined);
        return { status: 'saved', n };
      }
    }
    throw new VaultError('corrupt', '写清单时块总是不全');
  } catch (e) {
    throw asVaultError(e);
  }
}

// ---------------------------------------------------------------------------
// 读

/** 一个世界最新的修订(简要信息;留底的旧版原件不算);没有 = null */
export async function latestOf(id: string): Promise<RevisionHead | null> {
  const last = chainOf(await rowsOf(id)).at(-1);
  return last ? headOf(last) : null;
}

/** 一个世界存着的修订(简要信息,按修订号从小到大) */
export async function revisionsOf(id: string): Promise<RevisionHead[]> {
  return (await rowsOf(id)).map(headOf);
}

/** 读出来的一份修订 */
export interface StoredRevision {
  head: RevisionHead;
  /** manifest.json 的字节 */
  text: Uint8Array;
  manifest: WorldManifest;
  parts: PackedPart[];
}

/** 一行清单解开;读不懂 = null */
function manifestOf(row: RevisionRow): WorldManifest | null {
  try {
    const m = JSON.parse(row.text) as WorldManifest | null;
    return m && Array.isArray(m.parts) ? m : null;
  } catch {
    return null;
  }
}

/**
 * 读一份修订(n 不给 = 最新的);没有 = null。清单和块在同一个事务里读,读到的是完整的一份。缺块抛 corrupt。
 * only = 只读这几块(打开核对过的世界时看世界用不着的不读);StoredRevision.parts 只有这几块,清单照样是全的
 */
export async function readRevision(id: string, n?: number, only?: readonly string[]): Promise<StoredRevision | null> {
  const got = await run<{ row: RevisionRow; datas: Map<string, ArrayBuffer> } | null>(['parts', 'manifests'], 'readonly', (t, done) => {
    done(null);
    const q = t.objectStore('manifests').getAll(rangeOf(id));
    q.onsuccess = () => {
      const rows = q.result as RevisionRow[];
      const row = n === undefined ? chainOf(rows).at(-1) : rows.find((r) => r.n === n);
      if (!row) return;
      const datas = new Map<string, ArrayBuffer>();
      done({ row, datas });
      const keys = only ? (manifestOf(row)?.parts ?? []).filter((p) => only.includes(p.name)).map(partKey) : row.keys;
      for (const k of keys) {
        const g = t.objectStore('parts').get(k);
        g.onsuccess = () => {
          const v = g.result as PartRow | undefined;
          if (v) datas.set(k, v.data);
        };
      }
    };
  }).catch((e: unknown) => {
    throw asVaultError(e);
  });
  if (!got) return null;
  const manifest = manifestOf(got.row);
  if (!manifest) throw new VaultError('corrupt', '清单读不懂');
  const parts = manifest.parts.filter((info) => !only || only.includes(info.name)).map((info): PackedPart => {
    const data = got.datas.get(partKey(info));
    if (!data) throw new VaultError('corrupt', `${info.name} 这一块没有了`);
    return { info, data };
  });
  return { head: headOf(got.row), text: new TextEncoder().encode(got.row.text), manifest, parts };
}

/** 一份修订拼回 .civworld(n 不给 = 最新的);没有 = null */
export async function revisionFile(id: string, n?: number): Promise<Blob | null> {
  const r = await readRevision(id, n);
  return r && zipWorld(r.text, r.parts);
}

// ---------------------------------------------------------------------------
// 清理、删

/**
 * 清掉没有清单引用、放了超过 grace 毫秒的块;返回清了几块。
 * 读清单和删块在同一个事务里:写清单的事务排在它前面或者后面,不会夹在中间。清单有一行读不懂就一块也不清
 */
export function sweepParts(grace: number = PART_GRACE_MS, now: number = Date.now()): Promise<number> {
  return run<number>(['parts', 'manifests'], 'readwrite', (t, done) => {
    done(0);
    const p = t.objectStore('parts');
    const q = t.objectStore('manifests').getAll();
    q.onsuccess = () => {
      const used = new Set<string>();
      for (const r of q.result as RevisionRow[]) {
        if (!Array.isArray(r.keys)) return;
        for (const k of r.keys) used.add(k);
      }
      let gone = 0;
      const c = p.index('at').openKeyCursor(IDBKeyRange.upperBound(now - grace));
      c.onsuccess = () => {
        const cur = c.result;
        if (!cur) return done(gone);
        const key = cur.primaryKey as string;
        if (!used.has(key)) {
          p.delete(key);
          gone++;
        }
        cur.continue();
      };
    };
  });
}

/** 删掉一个世界的全部修订和小状态(块下次清理时清)。只有用的人删了这个世界才调 */
export function purgeWorld(id: string): Promise<void> {
  return run<void>(['manifests', 'states'], 'readwrite', (t) => {
    t.objectStore('manifests').delete(rangeOf(id));
    t.objectStore('states').delete(id);
  });
}

/** 全删(退出登录时选了「从这台设备上删掉」) */
export function clearVault(): Promise<void> {
  return run<void>(VAULT_STORES, 'readwrite', (t) => {
    for (const s of VAULT_STORES) t.objectStore(s).clear();
  });
}

// ---------------------------------------------------------------------------
// 小状态

export function stateOf(id: string): Promise<WorldState | null> {
  return run<WorldState | null>(['states'], 'readonly', (t, done) => {
    done(null);
    const q = t.objectStore('states').get(id);
    q.onsuccess = () => done((q.result as WorldState | undefined) ?? null);
  });
}

/** 改一个世界的小状态:写 patch 里的几项,值是 undefined 的去掉 */
export function patchState(id: string, patch: Partial<Omit<WorldState, 'id'>>): Promise<void> {
  return run<void>(['states'], 'readwrite', (t) => {
    const s = t.objectStore('states');
    const q = s.get(id);
    q.onsuccess = () => {
      const next: WorldState = { ...((q.result as WorldState | undefined) ?? { id }), ...patch };
      for (const k of Object.keys(patch) as (keyof typeof patch)[]) if (patch[k] === undefined) delete next[k];
      s.put(next);
    };
  });
}

/** 主线程通过后台线程调的几样(worldVaultWorker.ts、ui/worldStore.ts) */
export const vaultOps = { commitWorld, latestOf, revisionsOf, revisionFile, sweepParts, purgeWorld, clearVault, stateOf, patchState };
export type VaultOps = typeof vaultOps;

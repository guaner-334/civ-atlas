/**
 * 本机的插件仓库:浏览器 IndexedDB 的 'civ-atlas:plugins' 库,和世界仓库分开。只在用到插件时 import(),首页不带它。
 *
 * 三张表:
 * - files:插件文件,键 = 指纹(整个文件字节的 SHA-256),值 = 原字节。不拆开重新打包,世界里记的指纹才对得上
 * - plugins:装了的插件一个一行(InstalledPlugin),键 = 插件编号。每个插件只留现在用的和上一版两份文件,不自动更新
 * - local:插件自己的设置(store.local),键 = 插件编号,值 = packValue 打的字节。只给装着的插件存,卸载时一起删
 *
 * 出错抛 PluginStoreError;文件本身坏了、要新版网站,照 openPluginFile 抛 PluginFileError
 */
import { packValue, unpackValue } from '../gen/snapshot';
import { PLUGIN_MAX_BYTES, PluginFileError, openPluginFile, type OpenedPlugin, type PluginManifest } from './pluginFile';

export const PLUGIN_DB = 'civ-atlas:plugins';
/** 一个插件自己的设置最多多少字节(打包后) */
export const PLUGIN_LOCAL_MAX_BYTES = 64 * 1024;

/** 装着的一版 */
export interface PluginVersion {
  /** 文件的指纹 */
  sum: string;
  bytes: number;
  manifest: PluginManifest;
  /** 装上这一版的时间 */
  at: number;
  /** 装的时候的文件名(给的是 File 才有) */
  file?: string;
  /** 从作品墙装的:作品编号 */
  work?: string;
}

/** 装了的一个插件 */
export interface InstalledPlugin {
  id: string;
  current: PluginVersion;
  /** 上一版:换回去用 */
  previous?: PluginVersion;
  /** 关着的不出现在工具里 */
  on: boolean;
  /** 第一次是从哪装的 */
  from: 'file' | 'gallery';
  /** 第一次装的时间 */
  at: number;
}

/**
 * - unavailable:浏览器不让用 IndexedDB
 * - full:写不下
 * - missing:没装这个插件(或者没有上一版)
 * - corrupt:存着的文件读出来和装的时候不一样
 * - big:设置太大
 * - failed:别的(设置里有存不了的东西之类)
 */
export type PluginStoreErrorKind = 'unavailable' | 'full' | 'missing' | 'corrupt' | 'big' | 'failed';

export class PluginStoreError extends Error {
  readonly kind: PluginStoreErrorKind;
  constructor(kind: PluginStoreErrorKind, message: string) {
    super(message);
    this.name = 'PluginStoreError';
    this.kind = kind;
  }
}

function asStoreError(e: unknown): PluginStoreError | PluginFileError {
  if (e instanceof PluginStoreError || e instanceof PluginFileError) return e;
  const x = e as { name?: string; message?: string } | null;
  const message = x?.message ?? String(e);
  if (x?.name === 'QuotaExceededError' || x?.name === 'NS_ERROR_DOM_QUOTA_REACHED') return new PluginStoreError('full', message);
  return new PluginStoreError('failed', message);
}

interface FileRow {
  sum: string;
  data: ArrayBuffer;
}

interface LocalRow {
  id: string;
  data: ArrayBuffer;
}

const STORES = ['files', 'plugins', 'local'];

let dbp: Promise<IDBDatabase> | null = null;

/** version 不给 = 现在是第几版就开第几版(以后的版本加了表,这一版照样用);表不全就升一版建上 */
function openDb(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try {
      if (typeof indexedDB === 'undefined') throw new Error('没有 IndexedDB');
      r = version === undefined ? indexedDB.open(PLUGIN_DB) : indexedDB.open(PLUGIN_DB, version);
    } catch (e) {
      reject(new PluginStoreError('unavailable', e instanceof Error ? e.message : String(e)));
      return;
    }
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'sum' });
      if (!d.objectStoreNames.contains('plugins')) d.createObjectStore('plugins', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('local')) d.createObjectStore('local', { keyPath: 'id' });
    };
    r.onsuccess = () => {
      const d = r.result;
      if (!STORES.every((n) => d.objectStoreNames.contains(n))) {
        const next = d.version + 1;
        d.close();
        openDb(next).then(resolve, reject);
        return;
      }
      const drop = () => {
        dbp = null;
      };
      // 别的标签页要升版本:让开;连接断了下次重开
      d.onversionchange = () => {
        d.close();
        drop();
      };
      d.onclose = drop;
      resolve(d);
    };
    r.onerror = () => reject(new PluginStoreError('unavailable', r.error?.message ?? 'IndexedDB 打不开'));
  });
}

const db = () =>
  (dbp ??= openDb().catch((e: unknown) => {
    dbp = null;
    throw e;
  }));

/** 单测用:换了一个库以后放掉连接 */
export function _resetPluginStore(): void {
  void dbp?.then((d) => d.close()).catch(() => undefined);
  dbp = null;
}

/** 开一个事务:body 里发请求,done 记下结果;事务完成才算数 */
async function run<T>(stores: string[], mode: IDBTransactionMode, body: (t: IDBTransaction, done: (v: T) => void) => void): Promise<T> {
  for (let tries = 0; ; tries++) {
    const d = await db();
    let t: IDBTransaction;
    try {
      t = d.transaction(stores, mode);
    } catch (e) {
      // 连接已经断了:重开一次
      dbp = null;
      if (tries) throw asStoreError(e);
      continue;
    }
    return new Promise<T>((resolve, reject) => {
      let value: T;
      let failed: unknown = null;
      t.oncomplete = () => resolve(value);
      t.onerror = (e) => {
        // 请求报的错这时候可能还没记到事务上
        const err = t.error ?? (e.target as IDBRequest | null)?.error;
        if (err?.name !== 'AbortError') failed ??= err;
      };
      t.onabort = () => reject(asStoreError(failed ?? t.error ?? new PluginStoreError(mode === 'readwrite' ? 'full' : 'failed', '浏览器中止了')));
      try {
        body(t, (v) => (value = v));
      } catch (e) {
        failed = e;
        try {
          t.abort();
        } catch {
          /* 已经结束了 */
        }
      }
    });
  }
}

function get<T>(t: IDBTransaction, store: string, key: string, then: (v: T | undefined) => void): void {
  const q = t.objectStore(store).get(key);
  q.onsuccess = () => then(q.result as T | undefined);
}

const copy = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

// ---------------------------------------------------------------------------
// 装、卸、开关

/** 装好的结果:added 新装,updated 换了一版(replaced = 换下来的,成了上一版),same 装的就是现在这一版,什么都没动 */
export type InstallResult = { status: 'added' | 'same'; plugin: InstalledPlugin } | { status: 'updated'; plugin: InstalledPlugin; replaced: PluginVersion };

/**
 * 从文件装:先照插件文件的规矩核对(坏的、要新版网站的抛 PluginFileError),再存。
 * 已经装了这个编号的别的版本:新的成了现在用的,原来的成了上一版,更早的那一版删掉。装上的都是开着的
 */
export async function installPlugin(file: Blob | Uint8Array, opts: { work?: string } = {}): Promise<InstallResult> {
  try {
    // 只读一次:存下的必须是核对过的那份字节
    if (file instanceof Blob && file.size > PLUGIN_MAX_BYTES) throw new PluginFileError('broken', '插件文件太大');
    const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : file;
    const opened = await openPluginFile(bytes);
    const name = typeof File !== 'undefined' && file instanceof File && file.name ? file.name.slice(0, 200) : undefined;
    const ver: PluginVersion = { sum: opened.sum, bytes: opened.bytes, manifest: opened.manifest, at: Date.now(), ...(name ? { file: name } : {}), ...(opts.work ? { work: opts.work } : {}) };
    const data = copy(bytes);
    return await run<InstallResult>(['files', 'plugins'], 'readwrite', (t, done) => {
      get<InstalledPlugin>(t, 'plugins', ver.manifest.id, (had) => {
        if (had?.current.sum === ver.sum) return done({ status: 'same', plugin: had });
        const files = t.objectStore('files');
        files.put({ sum: ver.sum, data } satisfies FileRow);
        if (had?.previous && had.previous.sum !== ver.sum) files.delete(had.previous.sum);
        const plugin: InstalledPlugin = had
          ? { ...had, current: ver, previous: had.current, on: true }
          : { id: ver.manifest.id, current: ver, on: true, from: opts.work ? 'gallery' : 'file', at: ver.at };
        t.objectStore('plugins').put(plugin);
        done(had ? { status: 'updated', plugin, replaced: had.current } : { status: 'added', plugin });
      });
    });
  } catch (e) {
    throw asStoreError(e);
  }
}

/** 卸载:两版文件、自己的设置一起删;没装 = false */
export async function removePlugin(id: string): Promise<boolean> {
  try {
    return await run<boolean>(['files', 'plugins', 'local'], 'readwrite', (t, done) => {
      done(false);
      get<InstalledPlugin>(t, 'plugins', id, (had) => {
        if (!had) return;
        for (const v of [had.current, had.previous]) if (v) t.objectStore('files').delete(v.sum);
        t.objectStore('plugins').delete(id);
        t.objectStore('local').delete(id);
        done(true);
      });
    });
  } catch (e) {
    throw asStoreError(e);
  }
}

/** 改一个插件那一行;没装(或者 change 返回 null)抛 missing */
async function patchPlugin(id: string, change: (p: InstalledPlugin) => InstalledPlugin | null, why: string): Promise<InstalledPlugin> {
  try {
    const out = await run<InstalledPlugin | null>(['plugins'], 'readwrite', (t, done) => {
      done(null);
      get<InstalledPlugin>(t, 'plugins', id, (had) => {
        const next = had ? change(had) : null;
        if (!next) return;
        t.objectStore('plugins').put(next);
        done(next);
      });
    });
    if (!out) throw new PluginStoreError('missing', why);
    return out;
  } catch (e) {
    throw asStoreError(e);
  }
}

export const setPluginOn = (id: string, on: boolean): Promise<InstalledPlugin> => patchPlugin(id, (p) => ({ ...p, on }), `没装 ${id}`);

/** 换回上一版(再调一次又换回来) */
export const usePreviousPlugin = (id: string): Promise<InstalledPlugin> =>
  patchPlugin(id, (p) => (p.previous ? { ...p, current: p.previous, previous: p.current } : null), `${id} 没有上一版`);

// ---------------------------------------------------------------------------
// 读

/** 装了的插件,按第一次装的先后 */
export async function listPlugins(): Promise<InstalledPlugin[]> {
  try {
    const all = await run<InstalledPlugin[]>(['plugins'], 'readonly', (t, done) => {
      const q = t.objectStore('plugins').getAll();
      q.onsuccess = () => done(q.result as InstalledPlugin[]);
    });
    return all.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  } catch (e) {
    throw asStoreError(e);
  }
}

export async function getPlugin(id: string): Promise<InstalledPlugin | null> {
  try {
    return await run<InstalledPlugin | null>(['plugins'], 'readonly', (t, done) => {
      done(null);
      get<InstalledPlugin>(t, 'plugins', id, (p) => done(p ?? null));
    });
  } catch (e) {
    throw asStoreError(e);
  }
}

/** 插件文件的原字节(按指纹);没有 = null */
export async function pluginFileBytes(sum: string): Promise<Uint8Array | null> {
  try {
    const row = await run<FileRow | undefined>(['files'], 'readonly', (t, done) => get<FileRow>(t, 'files', sum, done));
    return row ? new Uint8Array(row.data) : null;
  } catch (e) {
    throw asStoreError(e);
  }
}

/**
 * 取出插件来跑:读存着的文件,重新核对一遍、指纹要和装的时候一样。which 不给 = 现在用的那一版。
 * 没装抛 missing;文件没了、对不上抛 corrupt;网站换成了旧版、跑不了它抛 PluginFileError(newer)
 */
export async function loadPlugin(id: string, which: 'current' | 'previous' = 'current'): Promise<OpenedPlugin> {
  try {
    const got = await run<{ ver: PluginVersion | undefined; row?: FileRow } | null>(['files', 'plugins'], 'readonly', (t, done) => {
      done(null);
      get<InstalledPlugin>(t, 'plugins', id, (p) => {
        const ver = p?.[which];
        done({ ver });
        if (ver) get<FileRow>(t, 'files', ver.sum, (row) => done({ ver, row }));
      });
    });
    if (!got?.ver) throw new PluginStoreError('missing', which === 'current' ? `没装 ${id}` : `${id} 没有上一版`);
    if (!got.row) throw new PluginStoreError('corrupt', `${id} 的文件没有了`);
    let opened: OpenedPlugin;
    try {
      opened = await openPluginFile(new Uint8Array(got.row.data));
    } catch (e) {
      if (e instanceof PluginFileError && e.kind === 'newer') throw e;
      throw new PluginStoreError('corrupt', `${id} 的文件读不出来:${e instanceof Error ? e.message : String(e)}`);
    }
    if (opened.sum !== got.ver.sum) throw new PluginStoreError('corrupt', `${id} 的文件和装的时候不一样`);
    return opened;
  } catch (e) {
    throw asStoreError(e);
  }
}

// ---------------------------------------------------------------------------
// 插件自己的设置

/** 插件存的设置;没存过 = undefined */
export async function readPluginLocal(id: string): Promise<unknown> {
  try {
    const row = await run<LocalRow | undefined>(['local'], 'readonly', (t, done) => get<LocalRow>(t, 'local', id, done));
    return row ? unpackValue(new Uint8Array(row.data), PLUGIN_LOCAL_MAX_BYTES) : undefined;
  } catch (e) {
    throw asStoreError(e);
  }
}

/** 存插件的设置(value 是 undefined = 删掉)。打包后超过上限抛 big,插件没装抛 missing */
export async function writePluginLocal(id: string, value: unknown): Promise<void> {
  try {
    let data: ArrayBuffer | null = null;
    if (value !== undefined) {
      let packed: Uint8Array;
      try {
        packed = packValue(value);
      } catch (e) {
        throw new PluginStoreError('failed', `设置里有存不了的东西:${e instanceof Error ? e.message : String(e)}`);
      }
      if (packed.length > PLUGIN_LOCAL_MAX_BYTES) throw new PluginStoreError('big', `设置最多 ${PLUGIN_LOCAL_MAX_BYTES} 字节`);
      // 打得出来、读不回来的(绕回自己、层数太多)不存,原来的不动
      try {
        unpackValue(packed, PLUGIN_LOCAL_MAX_BYTES);
      } catch (e) {
        throw new PluginStoreError('failed', `设置读不回来:${e instanceof Error ? e.message : String(e)}`);
      }
      data = copy(packed);
    }
    const ok = await run<boolean>(['plugins', 'local'], 'readwrite', (t, done) => {
      done(false);
      get<InstalledPlugin>(t, 'plugins', id, (p) => {
        if (!p) return;
        if (data) t.objectStore('local').put({ id, data } satisfies LocalRow);
        else t.objectStore('local').delete(id);
        done(true);
      });
    });
    if (!ok) throw new PluginStoreError('missing', `没装 ${id}`);
  } catch (e) {
    throw asStoreError(e);
  }
}

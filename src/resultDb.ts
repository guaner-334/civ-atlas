/**
 * 世界的原件存在哪:浏览器 IndexedDB 的 'civ-atlas:results' 库。怎么存、什么时候存见 ui/resultStore.ts;
 * 这里只有库本身,不碰存档,后台线程(转存旧世界,worldConvert.ts)也能读。
 */
import type { Snapshot } from './gen/snapshot';

/** 存着的一份原件 */
export interface ResultRecord {
  /** 世界的编号(saveStore) */
  id: string;
  /** 原件的生成器版本 */
  generator: number;
  /** 存的时候网站的版本号 */
  app: string;
  /** 存的时间(ISO) */
  at: string;
  snapshot: Snapshot;
}

/** 一份原件的简要信息(heads 表) */
export interface ResultHead {
  id: string;
  generator: number;
  recipe: string;
  /** 各块的名字和校验("map:…|eras:…|civ:…") */
  sums: string;
  /** 压缩后一共多少字节 */
  size: number;
  at: string;
}

export interface ResultBackend {
  heads(): Promise<ResultHead[]>;
  put(rec: ResultRecord, head: ResultHead): Promise<void>;
  get(id: string, generator: number): Promise<ResultRecord | undefined>;
  remove(keys: [string, number][]): Promise<void>;
  clear(): Promise<void>;
}

/** IndexedDB 后端;浏览器没有 IndexedDB 时返回 null */
export function indexedDbResults(name = 'civ-atlas:results'): ResultBackend | null {
  let idb: IDBFactory;
  try {
    if (typeof indexedDB === 'undefined') return null;
    idb = indexedDB;
  } catch {
    return null;
  }
  const STORES = ['results', 'heads'];
  /** 打开库;version 不给 = 现在是第几版就开第几版。表不全(比如别处先空开过这个库)就升一版建上 */
  const open = (version?: number): Promise<IDBDatabase> =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const r = version === undefined ? idb.open(name) : idb.open(name, version);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: ['id', 'generator'] });
      };
      r.onsuccess = () => {
        const d = r.result;
        if (STORES.every((s) => d.objectStoreNames.contains(s))) return resolve(d);
        const next = d.version + 1;
        d.close();
        open(next).then(resolve, reject);
      };
      r.onerror = () => reject(r.error ?? new Error('IndexedDB 打不开'));
      r.onblocked = () => reject(new Error('IndexedDB 被占用'));
    });
  let dbp: Promise<IDBDatabase> | null = null;
  const db = () =>
    (dbp ??= open().catch((e: unknown) => {
      // 打不开的下次再试
      dbp = null;
      throw e;
    }));
  function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => IDBRequest<T> | void): Promise<T | undefined> {
    return db().then(
      (d) =>
        new Promise<T | undefined>((resolve, reject) => {
          const t = d.transaction(stores, mode);
          const req = fn(t);
          t.oncomplete = () => resolve(req ? req.result : undefined);
          t.onerror = () => reject(t.error ?? new Error('IndexedDB 写入失败'));
          t.onabort = () => reject(t.error ?? new Error('IndexedDB 写入中止'));
        }),
    );
  }
  return {
    heads: async () => ((await tx<ResultHead[]>(['heads'], 'readonly', (t) => t.objectStore('heads').getAll())) ?? []) as ResultHead[],
    put: async (rec, head) => {
      await tx(['results', 'heads'], 'readwrite', (t) => {
        t.objectStore('results').put(rec);
        t.objectStore('heads').put(head);
      });
    },
    get: async (id, generator) => (await tx<ResultRecord>(['results'], 'readonly', (t) => t.objectStore('results').get([id, generator]))) as ResultRecord | undefined,
    remove: async (keys) => {
      if (!keys.length) return;
      await tx(['results', 'heads'], 'readwrite', (t) => {
        for (const k of keys) {
          t.objectStore('results').delete(k);
          t.objectStore('heads').delete(k);
        }
      });
    },
    clear: async () => {
      await tx(['results', 'heads'], 'readwrite', (t) => {
        t.objectStore('results').clear();
        t.objectStore('heads').clear();
      });
    },
  };
}

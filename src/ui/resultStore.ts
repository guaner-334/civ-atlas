/**
 * 世界的原件(gen/snapshot.ts)存在浏览器的 IndexedDB 里('civ-atlas:results' 库):一个世界每个生成器版本留一份。
 *
 * - 存的时机:worker 推完建好的世界,交回这次的原件(offerSnapshot)。浏览器里存着的这个世界,存档的生成器版本就是原件的版本、
 *   存档里的配方和原件的配方指纹一样(gen/snapshot.ts 的 recipeOfSave),这份原件才算它的结果,存下来;对不上(刚改了干预还没推完、
 *   旧版本的世界在新版里打开还没重存、新建中的世界)就先不存,等存档或下一份原件来了再看一次。
 * - 同一个世界、同一个生成器版本只留最新的一份(配方和各块校验都一样就不重写);不同版本的各留各的:
 *   旧版本时存下的原件不因为在新版里打开、重存而被盖掉。一个世界最多留 KEEP_PER_WORLD 份,多了丢中间的版本(最早的和最新的留着)。
 * - 库里两张表:results 放整份原件(几 MB),heads 只放编号、版本、配方指纹和校验(查有没有、要不要重写不用读整份)。两张表一起写。
 * - 删掉的世界:打开页面过一会儿看一遍,"我的世界"里已经没有的世界的原件删掉(删世界时不马上删:还能撤销);
 *   退出登录选了"从这台设备上删掉"时全删(clearResults)。复制世界时原件跟着复制(copyResults)。
 * - 写不下(浏览器存储满了)、浏览器不让用 IndexedDB:这次不存,不提示(原件是额外的一份,存档本身照常)。
 *
 * - 读:浏览器里存着的世界是旧版本建的(存档的生成器版本比现在旧),有那一版的原件、配方对得上存档,就照原样打开(frozenResult;
 *   worker 读原件,不重新生成)。读不出来的照旧按存档重新生成。
 */
import { GENERATOR_VERSION } from '../gen/edits';
import { SNAPSHOT_FORMAT, recipeKey, recipeOfSave, recipeText, type Snapshot } from '../gen/snapshot';
import type { SaveFile } from '../gen/savefile';
import { currentWorld, loadWorld, persistent, storedIds, subscribe } from './saveStore';
import { APP_VERSION } from './version';

/** 一个世界最多留几份原件(各是一个生成器版本的) */
export const KEEP_PER_WORLD = 3;

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

const sumsOf = (s: Snapshot) => s.parts.map((p) => `${p.name}:${p.sum}`).join('|');
const sizeOf = (s: Snapshot) => s.parts.reduce((n, p) => n + p.data.byteLength, 0);

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

/** 只在内存里的后端(单测用) */
export function memoryResults(): ResultBackend & { records: Map<string, ResultRecord> } {
  const records = new Map<string, ResultRecord>();
  const heads = new Map<string, ResultHead>();
  const k = (id: string, g: number) => `${id}#${g}`;
  return {
    records,
    heads: async () => [...heads.values()],
    put: async (rec, head) => {
      records.set(k(rec.id, rec.generator), rec);
      heads.set(k(head.id, head.generator), head);
    },
    get: async (id, g) => records.get(k(id, g)),
    remove: async (keys) => {
      for (const [id, g] of keys) {
        records.delete(k(id, g));
        heads.delete(k(id, g));
      }
    },
    clear: async () => {
      records.clear();
      heads.clear();
    },
  };
}

// ---------------------------------------------------------------------------

let backend: ResultBackend | null | undefined;
const be = () => (backend === undefined ? (backend = indexedDbResults()) : backend);

/** 换后端(单测用;null = 不存) */
export function _setResultBackend(b: ResultBackend | null | undefined) {
  backend = b;
  pending = null;
  chain = Promise.resolve();
}

/** worker 交回来的最新一份原件(还没对上存档的先放着) */
let pending: Snapshot | null = null;
/** 写入一个接一个做(同一份不重复写) */
let chain: Promise<unknown> = Promise.resolve();
const queue = <T>(f: () => Promise<T>): Promise<T> => {
  const p = chain.then(f);
  chain = p.catch(() => {});
  return p;
};

/** worker 交回来一份原件:对得上当前世界存着的存档就存下来 */
export function offerSnapshot(s: Snapshot): Promise<boolean> {
  pending = s;
  return keepPending();
}

/** 当前世界存着的存档和手上的原件对得上就存下来;存了 = true */
export function keepPending(): Promise<boolean> {
  return queue(async () => {
    const s = pending;
    const b = be();
    const c = currentWorld();
    if (!s || !b || !c || c.kind !== 'created' || c.unsaved || c.gone || s.generator !== GENERATOR_VERSION) return false;
    const w = loadWorld(c.id);
    if (!w || w.draft || w.save.generator !== s.generator) return false;
    try {
      const recipe = recipeOfSave(w.save);
      const text = recipeText(recipe);
      if ((await recipeKey(recipe)) !== s.recipe) return false;
      const heads = await b.heads();
      const sums = sumsOf(s);
      // 存过了 / 存下了:这份不用再看了(之后再改了历史,worker 会交新的一份)
      if (heads.some((h) => h.id === c.id && h.generator === s.generator && h.recipe === s.recipe && h.sums === sums)) {
        if (pending === s) pending = null;
        return false;
      }
      // 等的这一会儿换了世界、存档又改了(这一页或别的页)、世界删了:这份不算它的结果,不写(存档变了会再看一次)
      if (!sameWorld(c.id, text)) return false;
      const at = new Date().toISOString();
      await b.put({ id: c.id, generator: s.generator, app: APP_VERSION, at, snapshot: s }, { id: c.id, generator: s.generator, recipe: s.recipe, sums, size: sizeOf(s), at });
      if (pending === s) pending = null;
      // 这个世界存的版本多了:丢中间的
      const mine = heads
        .filter((h) => h.id === c.id && h.generator !== s.generator)
        .map((h) => h.generator)
        .concat(s.generator)
        .sort((x, y) => x - y);
      if (mine.length > KEEP_PER_WORLD) await b.remove(mine.slice(1, mine.length - (KEEP_PER_WORLD - 1)).map((g): [string, number] => [c.id, g]));
      return true;
    } catch {
      return false;
    }
  });
}

/** 当前打开的还是这个世界,存着的存档还是这个配方、这一版 */
function sameWorld(id: string, text: string): boolean {
  const c = currentWorld();
  if (!c || c.id !== id || c.kind !== 'created' || c.unsaved || c.gone) return false;
  const w = loadWorld(id);
  return !!w && !w.draft && w.save.generator === GENERATOR_VERSION && recipeText(recipeOfSave(w.save)) === text;
}

/** 一个世界存着的原件(按生成器版本从旧到新) */
export async function resultHeads(id: string): Promise<ResultHead[]> {
  const b = be();
  if (!b) return [];
  try {
    return (await b.heads()).filter((h) => h.id === id).sort((x, y) => x.generator - y.generator);
  } catch {
    return [];
  }
}

/** 一个世界第 generator 版的原件;没有、读不出 = null */
export async function loadResult(id: string, generator: number): Promise<ResultRecord | null> {
  const b = be();
  if (!b) return null;
  try {
    return (await b.get(id, generator)) ?? null;
  } catch {
    return null;
  }
}

/**
 * 照原样打开这个旧世界用的原件:存档是比现在旧的版本建的、浏览器里有那一版的原件、格式认得、配方和存档对得上。
 * 没有 = null;有那一版的原件、可是用不了(配方对不上、读不出来)= 'broken'。
 * 排在前面的写(刚复制世界时原件跟着复制)写完再读
 */
export async function frozenResult(id: string, save: SaveFile): Promise<Snapshot | 'broken' | null> {
  if (!(save.generator < GENERATOR_VERSION)) return null;
  const r = await queue(() => loadResult(id, save.generator));
  if (!r) return null;
  const s = r.snapshot;
  if (s.format !== SNAPSHOT_FORMAT || s.generator !== save.generator) return 'broken';
  try {
    return (await recipeKey(recipeOfSave(save))) === s.recipe ? s : 'broken';
  } catch {
    return 'broken';
  }
}

/** 照原样打开时的提示条:同一个世界在同一版网站里只说一次(记在 localStorage:世界编号 → 说过时的生成器版本) */
const TOLD_KEY = 'civ-atlas:frozen-told';
const TOLD_MAX = 200;
function readTold(): Record<string, number> {
  try {
    const v = JSON.parse(localStorage.getItem(TOLD_KEY) ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}
/** 这个世界在这一版里说过了没有;没说过就记下(返回 false) */
export function toldFrozen(id: string): boolean {
  const told = readTold();
  if (told[id] === GENERATOR_VERSION) return true;
  delete told[id];
  told[id] = GENERATOR_VERSION;
  const keys = Object.keys(told);
  for (const k of keys.slice(0, Math.max(0, keys.length - TOLD_MAX))) delete told[k];
  try {
    localStorage.setItem(TOLD_KEY, JSON.stringify(told));
  } catch {
    /* 记不下就下次再说一次 */
  }
  return false;
}

/** 复制世界:原件跟着复制一份(写不下就算了) */
export function copyResults(from: string, to: string): Promise<void> {
  return queue(async () => {
    const b = be();
    if (!b) return;
    try {
      for (const h of await b.heads()) {
        if (h.id !== from) continue;
        const r = await b.get(from, h.generator);
        if (r) await b.put({ ...r, id: to }, { ...h, id: to });
      }
    } catch {
      /* 写不下就不带 */
    }
  });
}

/** "我的世界"里已经没有的世界的原件删掉(浏览器存储用不了、只在内存里的时候不删:看不到存着哪些世界) */
export function dropOrphans(): Promise<void> {
  return queue(async () => {
    const b = be();
    if (!b || !persistent()) return;
    const live = new Set(storedIds());
    const c = currentWorld();
    if (c) live.add(c.id);
    try {
      const gone = (await b.heads()).filter((h) => !live.has(h.id)).map((h): [string, number] => [h.id, h.generator]);
      await b.remove(gone);
    } catch {
      /* 下次打开再删 */
    }
  });
}

/** 浏览器里的原件全删(退出登录时选了"从这台设备上删掉") */
export function clearResults(): Promise<void> {
  pending = null;
  return queue(async () => {
    try {
      await be()?.clear();
    } catch {
      /* 删不掉就算了:下次打开时按"我的世界"里没有的删 */
    }
  });
}

/** 开始存原件(App 挂载时调一次;返回取消函数):存档一变就看看手上的原件对不对得上;过一会儿清掉没用的 */
export function startResults(): () => void {
  const off = subscribe(() => {
    if (pending) void keepPending();
  });
  const t = setTimeout(() => void dropOrphans(), 15_000);
  return () => {
    off();
    clearTimeout(t);
  };
}

/**
 * 世界仓库(src/worldVault.ts):写入读回和内存里一样、相同内容只存一份、写到一半断掉读不到半截、清理不碰被引用的块、几个标签页同时写。
 * IndexedDB 用 fake-indexeddb(和浏览器一样的事务规矩),出错的情况在它的方法上注入。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { restoreEntries } from '../src/gen/civ/story/nameTokens';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { applyNames, polityKey } from '../src/gen/edits';
import { makePart, partLimit, readLocalPart, readPart, sha256, type SnapshotPart } from '../src/gen/snapshot';
import { openWorldFile, packWorldFile, packWorldParts, readWorldContent, type PackInput, type WorldEras } from '../src/gen/worldFile';
import type { WorldManifest } from '../src/gen/worldFormat';
import { VAULT_DB, VaultError, _resetVault, clearVault, commitWorld, keepRows, latestOf, patchState, purgeWorld, readRevision, revisionFile, revisionsOf, stateOf, sweepParts, watchParts, type CommitRequest } from '../src/worldVault';
import { MADE, READERS, bytesOf, makeSample, tinyJpeg } from './lib/worldFileSample';

const g = globalThis as unknown as { indexedDB: IDBFactory | undefined };
const OPEN = { readers: READERS };

let sample: PackInput & { eras: WorldEras };
/** 样本打好的、看世界用的几块 */
let viewParts: SnapshotPart[];

beforeAll(async () => {
  sample = makeSample();
  const { parts } = await packWorldParts(sample);
  viewParts = parts
    .filter((p) => !['author', 'thumb'].includes(p.info.name))
    .map((p) => ({ name: p.info.name, bytes: p.info.bytes, sum: p.info.sum, zip: p.info.zip as 'gzip' | 'none', data: p.data as ArrayBuffer }));
}, 60_000);

beforeEach(() => {
  _resetVault();
  g.indexedDB = new IDBFactory();
});
afterEach(() => {
  vi.restoreAllMocks();
  _resetVault();
});

/** 块都复制一份(写库不会动它,但 transfer 的路上会;测试里分开最稳) */
const copies = (list: SnapshotPart[]) => list.map((p) => ({ ...p, data: p.data.slice(0) }));

const fullRequest = (over: Partial<CommitRequest> = {}): CommitRequest => ({
  id: sample.id,
  recipe: sample.recipe,
  recipeKey: 'k1',
  parts: copies(viewParts),
  made: MADE,
  readers: READERS,
  author: sample.author,
  thumb: sample.thumb,
  ...over,
});

/** 换掉其中一块的内容(模拟重推) */
async function withCiv(tag: string): Promise<SnapshotPart[]> {
  const civ = await makePart('civ', { ...sample.civ, tag });
  return copies(viewParts.map((p) => (p.name === 'civ' ? civ : p)));
}

/** 直接看库里有几行 */
function countRows(store: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const open = g.indexedDB!.open(VAULT_DB);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const d = open.result;
      const q = d.transaction(store).objectStore(store).count();
      q.onsuccess = () => {
        d.close();
        resolve(q.result);
      };
    };
  });
}

/** 记下往 parts 表写了哪些块 */
function spyPuts(): { names: string[] } {
  const seen = { names: [] as string[] };
  const P = g.indexedDB && (globalThis as unknown as { IDBObjectStore: { prototype: IDBObjectStore } }).IDBObjectStore.prototype;
  const real = P!.put;
  vi.spyOn(P!, 'put').mockImplementation(function (this: IDBObjectStore, v: unknown, k?: IDBValidKey) {
    if (this.name === 'parts') seen.names.push((v as { key: string }).key);
    return real.call(this, v, k);
  });
  return seen;
}

const storeProto = () => (globalThis as unknown as { IDBObjectStore: { prototype: IDBObjectStore } }).IDBObjectStore.prototype;

describe('写入读回', () => {
  it('仓库里的块和清单原样拼回文件,和直接打包逐字节一样;读回校验全过,内容和内存里一样', async () => {
    expect(await commitWorld(fullRequest())).toEqual({ status: 'saved', n: 1 });
    const file = await revisionFile(sample.id);
    expect(file).not.toBeNull();
    const bytes = await bytesOf(file!);
    expect(isDeepStrictEqual(bytes, await bytesOf(await packWorldFile(sample)))).toBe(true);

    const back = await readWorldContent(await openWorldFile(bytes, OPEN));
    const direct = await readWorldContent(await openWorldFile(await bytesOf(await packWorldFile(sample)), OPEN));
    for (const k of ['map', 'eras', 'civ', 'chronicle', 'flags', 'author', 'thumb'] as const) expect(isDeepStrictEqual(back[k], direct[k]), k).toBe(true);
  }, 60_000);

  it('拼文件时报进度:一块一块往上走,最后留给装 ZIP', async () => {
    await commitWorld(fullRequest());
    const seen: number[] = [];
    watchParts((share) => seen.push(share));
    await revisionFile(sample.id);
    watchParts(null);
    expect(seen.length).toBeGreaterThan(2);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    expect(seen.at(-1)).toBeCloseTo(0.9);
    const before = seen.length;
    await revisionFile(sample.id);
    expect(seen).toHaveLength(before);
  }, 60_000);

  it('清单写成功才算存好;latestOf 给的是最新的那份', async () => {
    expect(await latestOf(sample.id)).toBeNull();
    await commitWorld(fullRequest());
    const latest = await latestOf(sample.id);
    expect(latest).toMatchObject({ n: 1, recipeKey: 'k1', generator: sample.recipe.generator, source: 'made' });
  });

  it('第二份记上一份清单的指纹', async () => {
    await commitWorld(fullRequest());
    const first = await readRevision(sample.id);
    await commitWorld(fullRequest({ recipeKey: 'k2', parts: await withCiv('b') }));
    const second = await readRevision(sample.id);
    expect(second!.manifest.revision).toEqual({ n: 2, parent: await sha256(first!.text) });
  });
});

describe('相同内容只存一份', () => {
  it('两个世界一样的块只有一行;同一份再存一次什么都不写', async () => {
    await commitWorld(fullRequest());
    const rows = await countRows('parts');
    const puts = spyPuts();
    expect(await commitWorld(fullRequest())).toEqual({ status: 'same', n: 1 });
    await commitWorld(fullRequest({ id: 'wother' }));
    expect(puts.names).toEqual([]);
    expect(await countRows('parts')).toBe(rows);
    expect(await countRows('manifests')).toBe(2);
  });

  it('只改名:只写清单,一块都不写;配方变了的不存', async () => {
    await commitWorld(fullRequest());
    const puts = spyPuts();
    const renamed = { ...sample.recipe, title: '新名字', savedAt: '2026-11-05T00:00:00.000Z' };
    expect(await commitWorld({ id: sample.id, recipe: renamed, recipeKey: 'k1' })).toEqual({ status: 'saved', n: 2 });
    expect(puts.names).toEqual([]);
    const r = await readRevision(sample.id);
    expect(r!.manifest.title).toBe('新名字');
    // 版本还是原来的:这份内容是那时候做的
    expect(r!.manifest.made).toEqual(MADE);
    expect(await commitWorld({ id: sample.id, recipe: renamed, recipeKey: 'k-draft' })).toEqual({ status: 'draft' });
    expect(await commitWorld({ id: 'wnone', recipe: renamed, recipeKey: 'k1' })).toEqual({ status: 'nobase' });
  });

  it('只改名:编年史那一块一个字节不动,按新的改名换回来,以前的史事跟着变', async () => {
    await commitWorld(fullRequest());
    const was = (await readRevision(sample.id))!.manifest.parts.find((p) => p.name === 'chronicle')!;
    const key = polityKey(sample.civ, 0);
    const edits = { ...sample.recipe.edits, names: { ...sample.recipe.edits.names, [key]: '测试新名字' } };
    const puts = spyPuts();
    expect(await commitWorld({ id: sample.id, recipe: { ...sample.recipe, edits }, recipeKey: 'k1' })).toEqual({ status: 'saved', n: 2 });
    expect(puts.names).toEqual([]);
    const c = await readWorldContent(await openWorldFile(await bytesOf((await revisionFile(sample.id))!), OPEN));
    expect((await readRevision(sample.id))!.manifest.parts.find((p) => p.name === 'chronicle')).toEqual(was);
    const named = applyNames(c.civ, c.save.edits.names);
    const entries = restoreEntries(c.chronicle.entries, named);
    expect(entries.some((e) => e.text.includes('测试新名字'))).toBe(true);
    expect(entries.map((e) => e.text)).toEqual(fullChronicle(named).map((e) => e.text));
  });

  it('只差存档时间不算变了', async () => {
    await commitWorld(fullRequest());
    expect(await commitWorld({ id: sample.id, recipe: { ...sample.recipe, savedAt: '2030-01-01T00:00:00.000Z' }, recipeKey: 'k1' })).toEqual({ status: 'same', n: 1 });
  });

  it('改了 AI 正文只写 author 那一块;去掉封面不写块', async () => {
    await commitWorld(fullRequest());
    const puts = spyPuts();
    await commitWorld({ id: sample.id, recipe: sample.recipe, recipeKey: 'k1', author: { notes: [{ ...sample.author!.notes[0], text: '改过的正文' }] } });
    expect(puts.names.length).toBe(1);
    const r = await readRevision(sample.id);
    expect(puts.names[0]).toBe(`${r!.manifest.parts.find((p) => p.name === 'author')!.sum}.gzip`);
    await commitWorld({ id: sample.id, recipe: sample.recipe, recipeKey: 'k1', thumb: null });
    expect(puts.names.length).toBe(1);
    expect((await readRevision(sample.id))!.manifest.parts.some((p) => p.name === 'thumb')).toBe(false);
  });

  it('重推:只写变了的块,地图不再写一遍', async () => {
    await commitWorld(fullRequest());
    const puts = spyPuts();
    await commitWorld(fullRequest({ recipeKey: 'k2', parts: await withCiv('b') }));
    expect(puts.names.length).toBe(1);
  });

  it('这次没有地形大事了:eras 那一块不再算', async () => {
    await commitWorld(fullRequest());
    await commitWorld(fullRequest({ recipeKey: 'k2', parts: copies(viewParts.filter((p) => p.name !== 'eras')) }));
    expect((await readRevision(sample.id))!.manifest.parts.some((p) => p.name === 'eras')).toBe(false);
  });

  it('不是 JPEG 的封面不存,世界照存', async () => {
    expect(await commitWorld(fullRequest({ thumb: new Uint8Array([1, 2, 3, 4]) }))).toEqual({ status: 'saved', n: 1 });
    expect((await readRevision(sample.id))!.manifest.parts.some((p) => p.name === 'thumb')).toBe(false);
  });
});

describe('写到一半断掉', () => {
  it('写块时断:没有清单、读不到半截;上一份、别的世界都还在;再存一次接着把缺的写上', async () => {
    await commitWorld(fullRequest({ id: 'wother' }));
    await commitWorld(fullRequest());
    const newer = await withCiv('断');
    const real = storeProto().put;
    let calls = 0;
    vi.spyOn(storeProto(), 'put').mockImplementation(function (this: IDBObjectStore, v: unknown, k?: IDBValidKey) {
      if (this.name === 'parts' && ++calls === 1) throw new DOMException('断了', 'AbortError');
      return real.call(this, v, k);
    });
    await expect(commitWorld(fullRequest({ recipeKey: 'k2', parts: copies(newer) }))).rejects.toBeInstanceOf(VaultError);
    expect((await latestOf(sample.id))!.n).toBe(1);
    expect((await latestOf('wother'))!.n).toBe(1);
    expect(await readWorldContent(await openWorldFile(await bytesOf((await revisionFile(sample.id))!), OPEN))).toBeTruthy();
    vi.restoreAllMocks();
    expect(await commitWorld(fullRequest({ recipeKey: 'k2', parts: copies(newer) }))).toEqual({ status: 'saved', n: 2 });
  }, 60_000);

  it('第一次存就断:这个世界什么都读不到', async () => {
    const real = storeProto().put;
    let calls = 0;
    vi.spyOn(storeProto(), 'put').mockImplementation(function (this: IDBObjectStore, v: unknown, k?: IDBValidKey) {
      if (this.name === 'parts' && ++calls === 3) throw new DOMException('断了', 'AbortError');
      return real.call(this, v, k);
    });
    await expect(commitWorld(fullRequest())).rejects.toBeInstanceOf(VaultError);
    expect(await latestOf(sample.id)).toBeNull();
    expect(await readRevision(sample.id)).toBeNull();
    expect(await revisionFile(sample.id)).toBeNull();
    expect(await countRows('manifests')).toBe(0);
  });

  it('写清单时断:还是上一份', async () => {
    await commitWorld(fullRequest());
    const real = storeProto().put;
    vi.spyOn(storeProto(), 'put').mockImplementation(function (this: IDBObjectStore, v: unknown, k?: IDBValidKey) {
      if (this.name === 'manifests') throw new DOMException('断了', 'AbortError');
      return real.call(this, v, k);
    });
    await expect(commitWorld(fullRequest({ recipeKey: 'k2', parts: await withCiv('b') }))).rejects.toBeInstanceOf(VaultError);
    expect((await latestOf(sample.id))!.recipeKey).toBe('k1');
  });

  it('读回来对不上:这一块删掉、不写清单(不然以后都当它存好了);下次写得好就好了', async () => {
    const realGet = storeProto().get;
    vi.spyOn(storeProto(), 'get').mockImplementation(function (this: IDBObjectStore, k: IDBValidKey | IDBKeyRange) {
      const q = realGet.call(this, k);
      if (this.name !== 'parts') return q;
      // 改掉读回来的字节
      return new Proxy(q, {
        get(target, prop) {
          if (prop === 'result') {
            const row = target.result as { data: ArrayBuffer } | undefined;
            if (!row) return row;
            const bad = new Uint8Array(row.data.slice(0));
            bad[bad.length >> 1] ^= 0xff;
            return { ...row, data: bad.buffer };
          }
          if (prop === 'onsuccess') return target.onsuccess;
          const v = Reflect.get(target, prop) as unknown;
          return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
        },
        set(target, prop, value: unknown) {
          if (prop === 'onsuccess') {
            target.onsuccess = value as typeof target.onsuccess;
            return true;
          }
          return Reflect.set(target, prop, value);
        },
      });
    });
    await expect(commitWorld(fullRequest())).rejects.toMatchObject({ kind: 'corrupt' });
    expect(await latestOf(sample.id)).toBeNull();
    expect(await countRows('parts')).toBe(0);
    vi.restoreAllMocks();
    expect(await commitWorld(fullRequest())).toEqual({ status: 'saved', n: 1 });
  });

  it('写满了:报 full,上一份还在', async () => {
    await commitWorld(fullRequest());
    vi.spyOn(storeProto(), 'put').mockImplementation(() => {
      throw new DOMException('满了', 'QuotaExceededError');
    });
    await expect(commitWorld(fullRequest({ recipeKey: 'k2', parts: await withCiv('b') }))).rejects.toMatchObject({ kind: 'full' });
    expect((await latestOf(sample.id))!.n).toBe(1);
  });

  it('浏览器不给 IndexedDB:报 unavailable,不是别的错', async () => {
    _resetVault();
    g.indexedDB = undefined;
    await expect(latestOf('x')).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(commitWorld(fullRequest())).rejects.toMatchObject({ kind: 'unavailable' });
    await expect(sweepParts()).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('别处先空开过这个库(没有表):升一版建上,照常存', async () => {
    await new Promise<void>((resolve) => {
      const r = g.indexedDB!.open(VAULT_DB);
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
    });
    expect(await commitWorld(fullRequest())).toEqual({ status: 'saved', n: 1 });
  });

  it('库的版本比软件新、表都在:照常用(测试网站和正式网站共用一个库)', async () => {
    await commitWorld(fullRequest());
    _resetVault();
    await new Promise<void>((resolve) => {
      const r = g.indexedDB!.open(VAULT_DB, 9);
      r.onupgradeneeded = () => r.result.createObjectStore('later');
      r.onsuccess = () => {
        r.result.close();
        resolve();
      };
    });
    expect((await latestOf(sample.id))?.n).toBe(1);
  });

  it('打开库被拒绝:报 unavailable,下次还会再试', async () => {
    const f = g.indexedDB!;
    vi.spyOn(f, 'open').mockImplementationOnce(() => {
      throw new DOMException('不让', 'SecurityError');
    });
    await expect(latestOf('x')).rejects.toMatchObject({ kind: 'unavailable' });
    expect(await latestOf('x')).toBeNull();
  });
});

describe('几个标签页同时写', () => {
  it('同一个世界同时存两份:都存上,一前一后接成一串', async () => {
    const [a, b] = await Promise.all([commitWorld(fullRequest({ recipeKey: 'k1', parts: await withCiv('a') })), commitWorld(fullRequest({ recipeKey: 'k2', parts: await withCiv('b') }))]);
    expect([a, b].map((r) => (r as { n: number }).n).sort()).toEqual([1, 2]);
    const heads = await revisionsOf(sample.id);
    expect(heads.map((h) => h.n)).toEqual([1, 2]);
    const first = await readRevision(sample.id, 1);
    const second = await readRevision(sample.id, 2);
    expect(second!.manifest.revision.parent).toBe(await sha256(first!.text));
  });

  it('决定用已有的块以后,块被别的标签页清了:写清单时查得出来,补写一遍', async () => {
    await commitWorld(fullRequest({ id: 'wa' }));
    await purgeWorld('wa');
    // 第一次查"有哪些块"的时候,别的标签页把没人引用的块全清了
    const real = storeProto().count;
    let swept: Promise<number> | null = null;
    vi.spyOn(storeProto(), 'count').mockImplementation(function (this: IDBObjectStore, k?: IDBValidKey | IDBKeyRange) {
      if (this.name === 'parts' && !swept) swept = sweepParts(0, Date.now() + 1000);
      return real.call(this, k);
    });
    expect(await commitWorld(fullRequest({ id: 'wb' }))).toEqual({ status: 'saved', n: 1 });
    expect(await swept).toBeGreaterThan(0);
    vi.restoreAllMocks();
    expect(await readWorldContent(await openWorldFile(await bytesOf((await revisionFile('wb'))!), OPEN))).toBeTruthy();
  }, 60_000);

  it('写块和清理同时进行:写完的世界读回校验全过', async () => {
    await commitWorld(fullRequest({ id: 'wa' }));
    await purgeWorld('wa');
    const later = Date.now() + 10 * 3600_000;
    const [r] = await Promise.all([commitWorld(fullRequest({ id: 'wb' })), sweepParts(0, later), sweepParts(0, later)]);
    expect(r.status).toBe('saved');
    expect(await readWorldContent(await openWorldFile(await bytesOf((await revisionFile('wb'))!), OPEN))).toBeTruthy();
  }, 60_000);
});

describe('清理', () => {
  it('被清单引用的块多旧都不清;没人引用的放够了才清', async () => {
    await commitWorld(fullRequest());
    const rows = await countRows('parts');
    const later = Date.now() + 100 * 24 * 3600_000;
    expect(await sweepParts(0, later)).toBe(0);
    expect(await countRows('parts')).toBe(rows);

    await purgeWorld(sample.id);
    // 刚写的、还没到时候:不清(别的标签页、这个页面可能正要写清单)
    expect(await sweepParts(3_600_000)).toBe(0);
    expect(await countRows('parts')).toBe(rows);
    expect(await sweepParts(0, later)).toBe(rows);
    expect(await countRows('parts')).toBe(0);
  });

  it('清单有一行读不懂:一块也不清', async () => {
    await commitWorld(fullRequest());
    const rows = await countRows('parts');
    await new Promise<void>((resolve) => {
      const open = g.indexedDB!.open(VAULT_DB);
      open.onsuccess = () => {
        const d = open.result;
        const t = d.transaction('manifests', 'readwrite');
        t.objectStore('manifests').put({ id: 'weird', n: 1, text: '{}' });
        t.oncomplete = () => {
          d.close();
          resolve();
        };
      };
    });
    await purgeWorld(sample.id);
    expect(await sweepParts(0, Date.now() + 1000)).toBe(0);
    expect(await countRows('parts')).toBe(rows);
  });
});

describe('保留几份', () => {
  const row = (n: number, content: string, source: 'made' | 'migrated' | 'archive' = 'made') => ({ n, content, source });

  it('当前的、上一份内容不一样的、转进来的原样;不按时间淘汰', () => {
    expect([...keepRows([row(1, 'a')])]).toEqual([1]);
    expect([...keepRows([row(1, 'a'), row(2, 'b')])].sort()).toEqual([1, 2]);
    expect([...keepRows([row(1, 'a'), row(2, 'b'), row(3, 'c')])].sort()).toEqual([2, 3]);
    // 改十次名也还留着改名以前那段历史
    expect([...keepRows([row(1, 'a'), row(2, 'b'), row(3, 'b'), row(4, 'b')])].sort()).toEqual([1, 4]);
    // 只改过名:留上一份
    expect([...keepRows([row(1, 'a'), row(2, 'a'), row(3, 'a')])].sort()).toEqual([2, 3]);
    // 迁移前的原样、留底的旧版一直在
    expect([...keepRows([row(1, 'old', 'archive'), row(2, 'm', 'migrated'), row(3, 'x'), row(4, 'y'), row(5, 'z')])].sort()).toEqual([1, 2, 4, 5]);
  });

  it('实际存的时候照这个留,没人引用的块随后清掉,留着的读回校验全过', async () => {
    await commitWorld(fullRequest({ source: 'migrated' }));
    await commitWorld(fullRequest({ recipeKey: 'k2', parts: await withCiv('b') }));
    await commitWorld(fullRequest({ recipeKey: 'k3', parts: await withCiv('c') }));
    await commitWorld(fullRequest({ recipeKey: 'k4', parts: await withCiv('d') }));
    expect((await revisionsOf(sample.id)).map((h) => h.n)).toEqual([1, 3, 4]);
    expect(await sweepParts(0, Date.now() + 1000)).toBe(1);
    await readRevision(sample.id, 1);
    await readRevision(sample.id, 3);
    const opened = await openWorldFile(await bytesOf((await revisionFile(sample.id, 1))!), OPEN);
    expect(await readWorldContent(opened)).toBeTruthy();
  }, 60_000);

  it('留底的旧版原件不算最新的,不接在最新的后面', async () => {
    await commitWorld(fullRequest());
    const older = { ...sample.recipe, generator: sample.recipe.generator - 3 };
    expect(await commitWorld(fullRequest({ recipe: older, recipeKey: 'kold', source: 'archive', author: undefined, thumb: undefined }))).toEqual({ status: 'saved', n: 2 });
    expect((await latestOf(sample.id))!.n).toBe(1);
    const r = await readRevision(sample.id, 2);
    expect((r!.manifest.revision as WorldManifest['revision']).parent).toBeUndefined();
    // 再转一次不多存
    expect(await commitWorld(fullRequest({ recipe: older, recipeKey: 'kold', source: 'archive' }))).toEqual({ status: 'same', n: 2 });
    // 之后的修订接在最新的后面
    await commitWorld(fullRequest({ recipeKey: 'k2', parts: await withCiv('b') }));
    expect((await latestOf(sample.id))!.n).toBe(3);
    expect((await readRevision(sample.id))!.manifest.revision.parent).toBe(await sha256((await readRevision(sample.id, 1))!.text));
  });
});

describe('删、小状态', () => {
  it('purgeWorld 只删这一个世界', async () => {
    await commitWorld(fullRequest());
    await commitWorld(fullRequest({ id: 'wother' }));
    await patchState(sample.id, { status: 'failed' });
    await purgeWorld(sample.id);
    expect(await latestOf(sample.id)).toBeNull();
    expect(await stateOf(sample.id)).toBeNull();
    expect((await latestOf('wother'))!.n).toBe(1);
    expect(await readWorldContent(await openWorldFile(await bytesOf((await revisionFile('wother'))!), OPEN))).toBeTruthy();
  }, 60_000);

  it('clearVault 全删', async () => {
    await commitWorld(fullRequest());
    await clearVault();
    expect(await countRows('parts')).toBe(0);
    expect(await countRows('manifests')).toBe(0);
  });

  it('小状态改几项留几项,undefined 的去掉', async () => {
    await patchState('w', { status: 'old', generator: 50 });
    await patchState('w', { archived: [50] });
    expect(await stateOf('w')).toEqual({ id: 'w', status: 'old', generator: 50, archived: [50] });
    await patchState('w', { status: undefined, generator: undefined });
    expect(await stateOf('w')).toEqual({ id: 'w', archived: [50] });
  });
});

describe('本机存的原件按本机的上限读', () => {
  it('超过传上服务器那张表的一块:readPart 拒绝,readLocalPart 读得出来', async () => {
    const part = await makePart('flags', { a: new Uint8Array(17e6) });
    expect(part.bytes).toBeGreaterThan(partLimit('flags'));
    await expect(readPart(part)).rejects.toThrow('上限');
    const back = (await readLocalPart(part)) as { a: Uint8Array };
    expect(back.a.length).toBe(17e6);
  }, 60_000);

  it('封面不是别的东西:样本的封面还是读得回来', async () => {
    await commitWorld(fullRequest({ thumb: tinyJpeg() }));
    const c = await readWorldContent(await openWorldFile(await bytesOf((await revisionFile(sample.id))!), OPEN));
    expect(isDeepStrictEqual(c.thumb, tinyJpeg())).toBe(true);
  });
});

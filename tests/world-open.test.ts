/**
 * 打开世界读存下的内容(src/worldOpen.ts):读到的和存进去的一样;配方、版本对不上的不读;坏了的不读、记下来,下次存完整的内容时补好;
 * 校验过的再打开只核指纹。IndexedDB 用 fake-indexeddb。
 * 读取代码的查询换版本(gen/readers/openQuery.ts)、打开时的几道保险(ui/openGuard.ts)也在这里。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GENERATOR_VERSION } from '../src/gen/edits';
import { READER_VERSIONS } from '../src/gen/readers/versions';
import { currentQuery, type QueryReader } from '../src/gen/readers/queryReader';
import { ownersAt, polityName, setQueryReader } from '../src/gen/readers/openQuery';
import { recipeKey, recipeOfSave, type SnapshotPart } from '../src/gen/snapshot';
import { packWorldParts, type PackInput, type WorldEras } from '../src/gen/worldFile';
import { VAULT_DB, _resetVault, commitWorld, latestOf, partKey, patchState, readRevision, revisionsOf, stateOf, type CommitRequest } from '../src/worldVault';
import { OpenRefused, openStoredWorld, type OpenRefusal } from '../src/worldOpen';
import { _setOpenGuard, endLoadWatch, kickLoadWatch, markOpenBad, noteOpenTrouble, openGuardReady, openingClear, openingShown, openingStart, reportOpenCrash, vaultAllowed, watchLoad } from '../src/ui/openGuard';
import { MADE, READERS, makeSample } from './lib/worldFileSample';

const g = globalThis as unknown as { indexedDB: IDBFactory | undefined };

let sample: PackInput & { eras: WorldEras };
let viewParts: SnapshotPart[];
let key: string;

beforeAll(async () => {
  sample = makeSample();
  const { parts } = await packWorldParts(sample);
  viewParts = parts.filter((p) => !['author', 'thumb'].includes(p.info.name)).map((p) => ({ name: p.info.name, bytes: p.info.bytes, sum: p.info.sum, zip: p.info.zip as 'gzip' | 'none', data: p.data as ArrayBuffer }));
  key = await recipeKey(recipeOfSave(sample.recipe));
}, 60_000);

beforeEach(() => {
  _resetVault();
  g.indexedDB = new IDBFactory();
});
afterEach(() => {
  vi.restoreAllMocks();
  _resetVault();
});

const copies = (list: SnapshotPart[]) => list.map((p) => ({ ...p, data: p.data.slice(0) }));
const request = (over: Partial<CommitRequest> = {}): CommitRequest => ({ id: sample.id, recipe: sample.recipe, recipeKey: key, parts: copies(viewParts), made: MADE, readers: READERS, author: sample.author, thumb: sample.thumb, ...over });
const ask = () => ({ id: sample.id, recipe: key, generator: sample.recipe.generator });

async function refusal(p: Promise<unknown>): Promise<OpenRefused> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(OpenRefused);
  return e as OpenRefused;
}
const whyOf = async (p: Promise<unknown>): Promise<OpenRefusal> => (await refusal(p)).why;

/** 直接改库里的东西 */
function edit(store: string, f: (s: IDBObjectStore) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = g.indexedDB!.open(VAULT_DB);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const d = open.result;
      const t = d.transaction(store, 'readwrite');
      f(t.objectStore(store));
      t.oncomplete = () => {
        d.close();
        resolve();
      };
      t.onerror = () => reject(t.error);
    };
  });
}
const infoOf = async (name: string) => (await readRevision(sample.id, undefined, []))!.manifest.parts.find((p) => p.name === name)!;
async function flipPart(name: string) {
  const k = partKey(await infoOf(name));
  await edit('parts', (s) => {
    const q = s.get(k);
    q.onsuccess = () => {
      const b = new Uint8Array((q.result as { data: ArrayBuffer }).data.slice(0));
      b[b.length >> 1] ^= 0x55;
      s.put({ ...q.result, data: b.buffer });
    };
  });
}
const dropPart = async (name: string) => {
  const k = partKey(await infoOf(name));
  await edit('parts', (s) => void s.delete(k));
};
async function editManifest(f: (text: string) => string) {
  const h = (await latestOf(sample.id))!;
  await edit('manifests', (s) => {
    const q = s.get([sample.id, h.n]);
    q.onsuccess = () => s.put({ ...q.result, text: f((q.result as { text: string }).text) });
  });
}

describe('读存下的内容', () => {
  it('读到的和存进去的一样,读取版本照清单', async () => {
    await commitWorld(request());
    const got = await openStoredWorld(ask());
    expect(got.readers).toEqual(READERS);
    expect(got.head.recipeKey).toBe(key);
    expect(isDeepStrictEqual(got.world.elevation, sample.map.elevation)).toBe(true);
    expect(got.world.history).toEqual([]);
    expect(got.civ?.polities.length).toBe(sample.civ.polities.length);
    expect(got.eras?.eras.map((e) => e.key)).toEqual(sample.eras.eras.map((e) => e.key));
    expect([...got.parts.keys()]).toEqual(expect.arrayContaining(['map', 'eras', 'civ']));
    expect(got.fromCiv(got.civ)).toBe(got.civ);
  });

  it('第一次校验,过了记下来;内容没变再打开只读看世界的几块(编年史坏了也打得开),换了内容再校验一次', async () => {
    await commitWorld(request());
    const h = (await latestOf(sample.id))!;
    expect((await stateOf(sample.id))?.checked).toBeUndefined();
    await openStoredWorld(ask());
    expect((await stateOf(sample.id))?.checked).toBe(h.content);
    await flipPart('chronicle');
    await dropPart('flags');
    const again = await openStoredWorld(ask());
    expect(again.civ).not.toBeNull();
    expect([...again.parts.keys()].sort()).toEqual(['civ', 'eras', 'map']);
    // 校验过的也核指纹:看世界那几块坏了照样读不了
    await flipPart('civ');
    expect(await whyOf(openStoredWorld(ask()))).toBe('broken');
    expect((await stateOf(sample.id))?.checked).toBeUndefined();
  });

  it('不要历史时(重新钉住世界),校验过的不解开历史,字节留着', async () => {
    await commitWorld(request());
    await openStoredWorld(ask());
    const got = await openStoredWorld(ask(), false);
    expect(got.civ).toBeNull();
    expect(got.parts.get('civ')).toBeDefined();
  });

  it('没有这个世界 = none', async () => {
    expect(await whyOf(openStoredWorld(ask()))).toBe('none');
  });

  it('修订和存档不是同一版生成器算的、修订比软件新 = generator', async () => {
    await commitWorld(request());
    expect(await whyOf(openStoredWorld({ ...ask(), generator: GENERATOR_VERSION + 1 }))).toBe('generator');
    expect(await whyOf(openStoredWorld({ ...ask(), generator: GENERATOR_VERSION - 1 }))).toBe('generator');
    g.indexedDB = new IDBFactory();
    _resetVault();
    await commitWorld(request({ recipe: { ...sample.recipe, generator: GENERATOR_VERSION + 1 } }));
    expect(await whyOf(openStoredWorld({ ...ask(), generator: GENERATOR_VERSION + 1 }))).toBe('generator');
  });

  it('待完成的修改:修订是当前版本算的 = recompute', async () => {
    await commitWorld(request());
    expect(await whyOf(openStoredWorld({ ...ask(), recipe: 'draft' }))).toBe('recompute');
  });

  it('待完成的修改:修订是旧版本算的 = readonly,带上修订的配方;按修订的配方再要就读得到', async () => {
    const old = GENERATOR_VERSION - 1;
    await commitWorld(request({ recipe: { ...sample.recipe, generator: old }, made: { ...MADE, generator: old } }));
    const e = await refusal(openStoredWorld({ id: sample.id, recipe: 'draft', generator: old }));
    expect(e.why).toBe('readonly');
    expect((e.recipe as { generator: number }).generator).toBe(old);
    const got = await openStoredWorld({ id: sample.id, recipe: key, generator: old });
    expect(got.head.generator).toBe(old);
    expect(got.civ).not.toBeNull();
  });

  it.each(['map', 'eras', 'civ', 'chronicle', 'flags'])('%s 这一块的字节坏了 = broken,记下来', async (name) => {
    await commitWorld(request());
    await flipPart(name);
    expect(await whyOf(openStoredWorld(ask()))).toBe('broken');
    expect((await stateOf(sample.id))?.corrupt).toBe(1);
  });

  it.each(['map', 'civ', 'flags'])('缺 %s 这一块 = broken,记下来', async (name) => {
    await commitWorld(request());
    await dropPart(name);
    expect(await whyOf(openStoredWorld(ask()))).toBe('broken');
    expect((await stateOf(sample.id))?.corrupt).toBe(1);
  });

  it('清单读不懂、少块、配方和表里记的对不上 = broken', async () => {
    await commitWorld(request());
    await editManifest((t) => t.slice(0, t.length >> 1));
    expect(await whyOf(openStoredWorld(ask()))).toBe('broken');

    g.indexedDB = new IDBFactory();
    _resetVault();
    await commitWorld(request());
    await editManifest((t) => {
      const m = JSON.parse(t) as { parts: { name: string }[] };
      return JSON.stringify({ ...m, parts: m.parts.filter((p) => p.name !== 'map') });
    });
    expect(await whyOf(openStoredWorld(ask()))).toBe('broken');

    g.indexedDB = new IDBFactory();
    _resetVault();
    await commitWorld(request());
    await editManifest((t) => {
      const m = JSON.parse(t) as { recipe: { edits: object } };
      return JSON.stringify({ ...m, recipe: { ...m.recipe, edits: { ...m.recipe.edits, endYear: 1234 } } });
    });
    expect(await whyOf(openStoredWorld(ask()))).toBe('broken');
  });

  it('读这个世界要新版软件 = newer,不算坏了', async () => {
    await commitWorld(request());
    await editManifest((t) => JSON.stringify({ ...(JSON.parse(t) as object), readers: { ...READER_VERSIONS, terrain: READER_VERSIONS.terrain + 1 } }));
    expect(await whyOf(openStoredWorld(ask()))).toBe('newer');
    expect((await stateOf(sample.id))?.corrupt).toBeUndefined();
  });

  it('坏了的下一次存完整的内容时补好:新清单、块重写,又读得出来;没坏的一样的内容不多写', async () => {
    await commitWorld(request());
    expect((await commitWorld(request())).status).toBe('same');
    await flipPart('civ');
    expect(await whyOf(openStoredWorld(ask()))).toBe('broken');
    // 只改名、改封面的不算完整的内容,不算补好
    await commitWorld(request({ parts: undefined, recipe: { ...sample.recipe, title: '新名字' } }));
    expect((await stateOf(sample.id))?.corrupt).toBe(1);
    const r = await commitWorld(request());
    expect(r.status).toBe('saved');
    expect((await stateOf(sample.id))?.corrupt).toBeUndefined();
    const got = await openStoredWorld(ask());
    expect(got.civ?.polities.length).toBe(sample.civ.polities.length);
  });

  it('只读几块:别的块没读,清单照样是全的;没有的块照样报', async () => {
    await commitWorld(request());
    const r = await readRevision(sample.id, undefined, ['map']);
    expect(r?.parts.map((p) => p.info.name)).toEqual(['map']);
    expect(r?.manifest.parts.length).toBeGreaterThan(3);
    await dropPart('map');
    await expect(readRevision(sample.id, undefined, ['map'])).rejects.toMatchObject({ kind: 'corrupt' });
    expect((await revisionsOf(sample.id)).length).toBe(1);
  });

  it('记状态写不进去也不碍读', async () => {
    await commitWorld(request());
    await patchState(sample.id, { full: 1 });
    expect((await openStoredWorld(ask())).civ).not.toBeNull();
    expect((await stateOf(sample.id))?.full).toBe(1);
  });
});

describe('查询按世界记的版本换', () => {
  afterEach(() => setQueryReader(currentQuery));

  it('import 进来的名字跟着换,换回当前版本就回来', () => {
    expect(ownersAt).toBe(currentQuery.ownersAt);
    const fake: QueryReader = { ...currentQuery, polityName: (() => '老版本的名字') as unknown as QueryReader['polityName'] };
    setQueryReader(fake);
    expect((polityName as unknown as () => string)()).toBe('老版本的名字');
    setQueryReader(currentQuery);
    expect(polityName).toBe(currentQuery.polityName);
  });
});

describe('打开时的几道保险', () => {
  /** 简单的 localStorage */
  function fakeStorage() {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  }
  const nav = () => (globalThis as unknown as { navigator?: { locks?: unknown } }).navigator;
  beforeEach(() => {
    vi.stubGlobal('localStorage', fakeStorage());
    _setOpenGuard({ reset: true, timing: { stall: 1000, settle: 1000 } });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('一个世界记了出过事,这一版不再走新路,别的世界不受影响', () => {
    expect(vaultAllowed('a')).toBe(true);
    markOpenBad('a');
    expect(vaultAllowed('a')).toBe(false);
    expect(vaultAllowed('b')).toBe(true);
  });

  it('出事连着两次才不再走新路;打开成了清零', async () => {
    vi.useFakeTimers();
    noteOpenTrouble('a');
    expect(vaultAllowed('a')).toBe(true);
    openingStart('a');
    openingShown();
    await vi.advanceTimersByTimeAsync(1100);
    noteOpenTrouble('a');
    expect(vaultAllowed('a')).toBe(true);
    noteOpenTrouble('a');
    expect(vaultAllowed('a')).toBe(false);
    // 不走新路了,打开成了也不清
    openingStart('a');
    openingShown();
    await vi.advanceTimersByTimeAsync(1100);
    expect(vaultAllowed('a')).toBe(false);
  });

  it('打开成了划掉记录;没划掉、记录它的页面又不在了 = 下次打开时算出了一次事,连着两次不再走新路', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { ...nav(), locks: { query: async () => ({ held: [] }), request: () => Promise.resolve() } });
    openingStart('a');
    openingShown();
    await vi.advanceTimersByTimeAsync(1100);
    expect(localStorage.getItem('civ-atlas:opening')).toBeNull();
    // 别的页面留下的记录:它的锁不在了
    localStorage.setItem('civ-atlas:opening', JSON.stringify({ b: { page: 'gone', at: Date.now() } }));
    await openGuardReady();
    expect(vaultAllowed('b')).toBe(true);
    expect(localStorage.getItem('civ-atlas:opening')).toBeNull();
    localStorage.setItem('civ-atlas:opening', JSON.stringify({ b: { page: 'gone2', at: Date.now() } }));
    _setOpenGuard({ reset: true });
    await openGuardReady();
    expect(vaultAllowed('b')).toBe(false);
  });

  it('记录它的页面还开着不算崩;自己这一页的不算', async () => {
    vi.stubGlobal('navigator', { ...nav(), locks: { query: async () => ({ held: [{ name: 'civ-atlas:page:alive' }] }), request: () => Promise.resolve() } });
    openingStart('mine');
    const rows = JSON.parse(localStorage.getItem('civ-atlas:opening')!) as Record<string, unknown>;
    localStorage.setItem('civ-atlas:opening', JSON.stringify({ ...rows, c: { page: 'alive', at: Date.now() } }));
    await openGuardReady();
    expect(vaultAllowed('c')).toBe(true);
    expect(vaultAllowed('mine')).toBe(true);
    openingClear();
  });

  it('打开的这一会儿一直拿着页面的锁,打开成了才放掉', async () => {
    vi.useFakeTimers();
    const held: string[] = [];
    const locks = {
      query: async () => ({ held: held.map((name) => ({ name })) }),
      request: (name: string, f: () => Promise<void>) => {
        held.push(name);
        return f().then(() => void held.splice(held.indexOf(name), 1));
      },
    };
    vi.stubGlobal('navigator', { ...nav(), locks });
    openingStart('a');
    await vi.advanceTimersByTimeAsync(10);
    expect(held.length).toBe(1);
    openingShown();
    await vi.advanceTimersByTimeAsync(500);
    expect(held.length).toBe(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(held.length).toBe(0);
    expect(localStorage.getItem('civ-atlas:opening')).toBeNull();
  });

  it('没有 navigator.locks 的浏览器按时间算', async () => {
    vi.stubGlobal('navigator', { ...nav(), locks: undefined });
    localStorage.setItem('civ-atlas:opening', JSON.stringify({ fresh: { page: 'x', at: Date.now() }, stale: { page: 'y', at: Date.now() - 120_000 } }));
    await openGuardReady();
    expect(vaultAllowed('fresh')).toBe(true);
    expect(JSON.parse(localStorage.getItem('civ-atlas:open-bad')!)).toEqual({ stale: expect.objectContaining({ n: 1 }) });
    expect(Object.keys(JSON.parse(localStorage.getItem('civ-atlas:opening')!) as object)).toEqual(['fresh']);
  });

  it('界面抛错:开着的是新路读的世界 = 记下来、只报一次;不是 = 不管', () => {
    expect(reportOpenCrash()).toBe(false);
    openingStart('a');
    expect(reportOpenCrash()).toBe(true);
    expect(vaultAllowed('a')).toBe(false);
    expect(reportOpenCrash()).toBe(false);
    openingStart('b');
    openingClear();
    expect(reportOpenCrash()).toBe(false);
    expect(vaultAllowed('b')).toBe(true);
  });

  it('线程一段时间没动静叫 stalled,有动静重新算;读完了不叫', async () => {
    vi.useFakeTimers();
    let n = 0;
    watchLoad(() => n++);
    await vi.advanceTimersByTimeAsync(700);
    kickLoadWatch();
    await vi.advanceTimersByTimeAsync(700);
    expect(n).toBe(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(n).toBe(1);
    // 只叫一次
    kickLoadWatch();
    await vi.advanceTimersByTimeAsync(2000);
    expect(n).toBe(1);
    watchLoad(() => n++);
    endLoadWatch();
    await vi.advanceTimersByTimeAsync(2000);
    expect(n).toBe(1);
  });
});

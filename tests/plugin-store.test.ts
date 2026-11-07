/**
 * 本机插件仓库(src/plugin/pluginStore.ts):装、换版本只留上一版、换回去、开关、卸载、取出来跑时重新核对、插件自己的设置。
 * IndexedDB 用 fake-indexeddb。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createHash } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PluginApiError } from '../src/plugin/check';
import { localDataStore } from '../src/plugin/pluginData';
import { PLUGIN_MAX_BYTES, PluginFileError, packPluginFile } from '../src/plugin/pluginFile';
import {
  PLUGIN_DB,
  PLUGIN_LOCAL_MAX_BYTES,
  PluginStoreError,
  _resetPluginStore,
  getPlugin,
  installPlugin,
  listPlugins,
  loadPlugin,
  pluginFileBytes,
  readPluginLocal,
  removePlugin,
  setPluginOn,
  usePreviousPlugin,
  writePluginLocal,
  type PluginStoreErrorKind,
} from '../src/plugin/pluginStore';
import { PLUGIN_SAMPLES, goodInput } from './lib/pluginFileSample';

const g = globalThis as unknown as { indexedDB: IDBFactory | undefined };
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** 同一个插件的几版,和另一个插件 */
let v1: Uint8Array;
let v2: Uint8Array;
let v3: Uint8Array;
let other: Uint8Array;

const version = (v: string, id = 'route-measure') => {
  const input = goodInput();
  return packPluginFile({ ...input, manifest: { ...input.manifest, id, version: v } });
};

beforeAll(async () => {
  [v1, v2, v3, other] = await Promise.all([version('1.0.0'), version('1.1.0'), version('2.0.0'), version('1.0.0', 'area-stats')]);
});

beforeEach(() => {
  _resetPluginStore();
  g.indexedDB = new IDBFactory();
});
afterEach(() => _resetPluginStore());

async function expectKind(run: () => Promise<unknown>, kind: PluginStoreErrorKind): Promise<void> {
  let err: unknown;
  try {
    await run();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(PluginStoreError);
  expect((err as PluginStoreError).kind, (err as Error).message).toBe(kind);
}

/** 直接改库里一张表的一行 */
function poke(store: string, key: string, change: (row: any) => any): Promise<void> {
  return new Promise((resolve, reject) => {
    const open = g.indexedDB!.open(PLUGIN_DB);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const d = open.result;
      const t = d.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      const q = s.get(key);
      q.onsuccess = () => {
        const next = change(q.result);
        if (next === undefined) s.delete(key);
        else s.put(next);
      };
      t.oncomplete = () => {
        d.close();
        resolve();
      };
      t.onerror = () => reject(t.error);
    };
  });
}

/* eslint-disable @typescript-eslint/no-explicit-any */

describe('插件仓库:装和换版本', () => {
  it('从文件装:原字节按指纹存着,取出来核对过、和装的是同一份;装上就开着', async () => {
    const r = await installPlugin(new Blob([v1]));
    expect(r.status).toBe('added');
    expect(r.plugin).toMatchObject({ id: 'route-measure', on: true, from: 'file', current: { sum: sha(v1), bytes: v1.length, manifest: { version: '1.0.0' } } });
    expect(r.plugin.previous).toBeUndefined();
    expect(await pluginFileBytes(sha(v1))).toEqual(v1);
    const opened = await loadPlugin('route-measure');
    expect(opened.sum).toBe(sha(v1));
    expect(opened.code).toBe(goodInput().files['main.js']);
    expect(await getPlugin('route-measure')).toEqual(r.plugin);
  });

  it('同一份再装:什么都不动', async () => {
    const first = await installPlugin(v1);
    await setPluginOn('route-measure', false);
    const again = await installPlugin(v1);
    expect(again.status).toBe('same');
    expect(again.plugin).toEqual({ ...first.plugin, on: false });
  });

  it('装新版:旧的成了上一版,更早的删掉;不同插件互不影响', async () => {
    await installPlugin(other);
    await installPlugin(v1);
    const r2 = await installPlugin(v2);
    expect(r2.status).toBe('updated');
    expect(r2.status === 'updated' && r2.replaced.sum).toBe(sha(v1));
    expect(r2.plugin.current.sum).toBe(sha(v2));
    expect(r2.plugin.previous?.sum).toBe(sha(v1));
    const r3 = await installPlugin(v3);
    expect(r3.plugin.current.manifest.version).toBe('2.0.0');
    expect(r3.plugin.previous?.manifest.version).toBe('1.1.0');
    expect(await pluginFileBytes(sha(v1))).toBeNull();
    expect(await pluginFileBytes(sha(v2))).toEqual(v2);
    expect(await pluginFileBytes(sha(other))).toEqual(other);
    expect((await listPlugins()).map((p) => p.id)).toEqual(['area-stats', 'route-measure']);
  });

  it('换回上一版、再换回来;拿上一版的文件再装也是换回去,两份文件都在', async () => {
    await installPlugin(v1);
    await installPlugin(v2);
    const back = await usePreviousPlugin('route-measure');
    expect([back.current.sum, back.previous?.sum]).toEqual([sha(v1), sha(v2)]);
    expect((await loadPlugin('route-measure')).sum).toBe(sha(v1));
    expect((await loadPlugin('route-measure', 'previous')).sum).toBe(sha(v2));
    const forth = await usePreviousPlugin('route-measure');
    expect(forth.current.sum).toBe(sha(v2));
    const again = await installPlugin(v1);
    expect([again.plugin.current.sum, again.plugin.previous?.sum]).toEqual([sha(v1), sha(v2)]);
    expect(await pluginFileBytes(sha(v1))).toEqual(v1);
    expect(await pluginFileBytes(sha(v2))).toEqual(v2);
  });

  it('坏文件、要新版网站的文件装不上,什么都不存', async () => {
    for (const kind of ['broken', 'newer'] as const) {
      const sample = PLUGIN_SAMPLES.find((x) => x.kind === kind && !x.big)!;
      const err = await installPlugin(await sample.build()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PluginFileError);
      expect((err as PluginFileError).kind).toBe(kind);
    }
    // 选错了一个大文件:不读进来就拒绝
    const huge = new Blob([new Uint8Array(PLUGIN_MAX_BYTES + 1)]);
    const err = await installPlugin(huge).catch((e: unknown) => e);
    expect(err instanceof PluginFileError && err.kind).toBe('broken');
    expect(await listPlugins()).toEqual([]);
  });
});

describe('插件仓库:开关、卸载、取出来跑', () => {
  it('开关;没装的、没有上一版的报 missing', async () => {
    await installPlugin(v1);
    expect((await setPluginOn('route-measure', false)).on).toBe(false);
    expect((await getPlugin('route-measure'))?.on).toBe(false);
    expect((await setPluginOn('route-measure', true)).on).toBe(true);
    await expectKind(() => setPluginOn('nope', true), 'missing');
    await expectKind(() => usePreviousPlugin('route-measure'), 'missing');
    await expectKind(() => loadPlugin('nope'), 'missing');
    await expectKind(() => loadPlugin('route-measure', 'previous'), 'missing');
  });

  it('卸载:两版文件、设置一起删;再卸一次 = false', async () => {
    await installPlugin(v1);
    await installPlugin(v2);
    await writePluginLocal('route-measure', { unit: '里' });
    expect(await removePlugin('route-measure')).toBe(true);
    expect(await getPlugin('route-measure')).toBeNull();
    expect(await pluginFileBytes(sha(v1))).toBeNull();
    expect(await pluginFileBytes(sha(v2))).toBeNull();
    expect(await readPluginLocal('route-measure')).toBeUndefined();
    expect(await removePlugin('route-measure')).toBe(false);
  });

  it('存着的文件被改了、没了:取出来时报 corrupt,不拿去跑', async () => {
    await installPlugin(v1);
    await poke('files', sha(v1), (row) => ({ ...row, data: v2.slice().buffer }));
    await expectKind(() => loadPlugin('route-measure'), 'corrupt');
    const bad = v1.slice();
    bad[bad.length - 30] ^= 0xff;
    await poke('files', sha(v1), (row) => ({ ...row, data: bad.buffer }));
    await expectKind(() => loadPlugin('route-measure'), 'corrupt');
    await poke('files', sha(v1), () => undefined);
    await expectKind(() => loadPlugin('route-measure'), 'corrupt');
  });

  it('浏览器不让用 IndexedDB:报 unavailable', async () => {
    g.indexedDB = undefined;
    await expectKind(() => listPlugins(), 'unavailable');
    await expectKind(() => installPlugin(v1), 'unavailable');
  });
});

describe('插件仓库:插件自己的设置', () => {
  it('存什么读回什么(数字数组、Map 也行);换版本还在;undefined = 删掉', async () => {
    await installPlugin(v1);
    expect(await readPluginLocal('route-measure')).toBeUndefined();
    const value = { unit: '里', speeds: new Float32Array([1.5, 2]), seen: new Map([[1, 'a']]), none: null };
    await writePluginLocal('route-measure', value);
    expect(await readPluginLocal('route-measure')).toEqual(value);
    await installPlugin(v2);
    expect(await readPluginLocal('route-measure')).toEqual(value);
    await writePluginLocal('route-measure', undefined);
    expect(await readPluginLocal('route-measure')).toBeUndefined();
  });

  it('插件接口的 store.local 落在这里:存、取、删;太大回 limit', async () => {
    await installPlugin(v1);
    expect(await localDataStore.get('route-measure')).toBeNull();
    await localDataStore.set('route-measure', { schema: 2, value: { unit: '里' } });
    expect(await localDataStore.get('route-measure')).toEqual({ schema: 2, value: { unit: '里' } });
    const err = await Promise.resolve(localDataStore.set('route-measure', { schema: 1, value: new Uint8Array(PLUGIN_LOCAL_MAX_BYTES) })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PluginApiError);
    expect((err as PluginApiError).code).toBe('limit');
    await localDataStore.set('route-measure', null);
    expect(await localDataStore.get('route-measure')).toBeNull();
  });

  it('太大、存不了的东西、没装的插件:报错,原来的不动', async () => {
    await installPlugin(v1);
    await writePluginLocal('route-measure', 1);
    await expectKind(() => writePluginLocal('route-measure', new Uint8Array(PLUGIN_LOCAL_MAX_BYTES)), 'big');
    await expectKind(() => writePluginLocal('route-measure', { f: () => 1 }), 'failed');
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    await expectKind(() => writePluginLocal('route-measure', loop), 'failed');
    let deep: unknown = 1;
    for (let i = 0; i < 100; i++) deep = [deep];
    await expectKind(() => writePluginLocal('route-measure', deep), 'failed');
    await expectKind(() => writePluginLocal('nope', 1), 'missing');
    expect(await readPluginLocal('route-measure')).toBe(1);
    expect(await readPluginLocal('nope')).toBeUndefined();
  });
});

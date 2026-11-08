/**
 * 世界记着用了哪些推演插件(清单 plugins 里 role 是 sim 的几条:编号、第几版、文件指纹、名字、滑条),
 * 接着推之前和本机插件仓库核对(同一版才接着推;没装、只有别的版本交回核对结果)。IndexedDB 用 fake-indexeddb
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SnapshotPart } from '../src/gen/snapshot';
import { openWorldFile, packWorldParts, type PackInput, type WorldEras } from '../src/gen/worldFile';
import type { WorldManifest, WorldPlugin } from '../src/gen/worldFormat';
import { openPluginFile, packPluginFile } from '../src/plugin/pluginFile';
import { _resetPluginStore, installPlugin } from '../src/plugin/pluginStore';
import { checkSimPlugins, simParamsOf, simPluginOf, worldPluginOf } from '../src/plugin/pluginWorld';
import { simPluginFiles, simPluginsReady } from '../src/plugin/simPlugins';
import { _resetVault, changePluginData, commitWorld, draftFile, readRevision, revisionFile, type CommitRequest } from '../src/worldVault';
import { goodPlugin, goodSimInput, goodSimPlugin } from './lib/pluginFileSample';
import { MADE, READERS, bytesOf, makeSample } from './lib/worldFileSample';

const g = globalThis as unknown as { indexedDB: IDBFactory | undefined };

let sample: PackInput & { eras: WorldEras };
let viewParts: SnapshotPart[];
let tool: WorldPlugin;
let magic: WorldPlugin;
/** 魔力 1.1.0(别的都一样) */
let newer: Uint8Array;

const magicNewer = () => packPluginFile({ ...goodSimInput(), manifest: { ...goodSimInput().manifest, version: '1.1.0' } });

beforeAll(async () => {
  sample = makeSample();
  const { parts } = await packWorldParts(sample);
  viewParts = parts
    .filter((p) => !['author', 'thumb'].includes(p.info.name))
    .map((p) => ({ name: p.info.name, bytes: p.info.bytes, sum: p.info.sum, zip: p.info.zip as 'gzip' | 'none', data: p.data as ArrayBuffer }));
  tool = worldPluginOf(await openPluginFile(await goodPlugin()));
  magic = simPluginOf(await openPluginFile(await goodSimPlugin()), { strength: 2 });
  newer = await magicNewer();
}, 60_000);

beforeEach(() => {
  _resetVault();
  _resetPluginStore();
  g.indexedDB = new IDBFactory();
});
afterEach(() => {
  _resetVault();
  _resetPluginStore();
});

const copies = (list: SnapshotPart[]) => list.map((p) => ({ ...p, data: p.data.slice(0) }));
const request = (over: Partial<CommitRequest> = {}): CommitRequest => ({ id: sample.id, recipe: sample.recipe, recipeKey: 'k1', parts: copies(viewParts), made: MADE, readers: READERS, ...over });
const latest = async (): Promise<WorldManifest> => (await readRevision(sample.id, undefined, []))!.manifest;

describe('清单里记推演插件', () => {
  it('记编号、第几版、文件指纹、种类、名字和滑条;没有滑条的不写', async () => {
    const opened = await openPluginFile(await goodSimPlugin());
    expect(magic).toEqual({ id: 'magic', version: '1.0.0', sum: opened.sum, role: 'sim', name: '魔力', params: { strength: 2 } });
    expect(simPluginOf(opened, {})).toEqual({ id: 'magic', version: '1.0.0', sum: opened.sum, role: 'sim', name: '魔力' });
  });

  it('滑条:没给、不是数的按默认,超出的压回上下限,清单里没写的不要', () => {
    const spec = { strength: { min: 0, max: 3, default: 1 }, speed: { min: -1, max: 1, default: 0 } };
    expect(simParamsOf(spec)).toEqual({ strength: 1, speed: 0 });
    expect(simParamsOf(spec, { strength: 2.5, speed: 9, other: 4 })).toEqual({ strength: 2.5, speed: 1 });
    expect(simParamsOf(spec, { strength: Number.NaN, speed: '1' })).toEqual({ strength: 1, speed: 0 });
    expect(simParamsOf(undefined, { strength: 2 })).toEqual({});
  });

  it('带着历史存的一份记上这份历史用的推演插件;只改配方、作者内容的照上一份;换了不用插件的历史就去掉,工具插件的记录留着', async () => {
    await commitWorld(request({ simPlugins: [magic] }));
    expect((await latest()).plugins).toEqual([magic]);

    // 只改作者内容:历史没换,记的插件照旧
    const note = { key: 'n1', kind: '史书', title: '注', text: '一段', createdAt: '2026-11-08T08:00:00.000Z', provider: 'p', model: 'm' };
    expect(await commitWorld(request({ parts: undefined, author: { notes: [note] } }))).toEqual({ status: 'saved', n: 2 });
    expect((await latest()).plugins).toEqual([magic]);

    // 换了版本、滑条:跟着换
    const other: WorldPlugin = { ...magic, version: '1.1.0', sum: 'f'.repeat(64), params: { strength: 1 } };
    await commitWorld(request({ recipeKey: 'k2', simPlugins: [other] }));
    expect((await latest()).plugins).toEqual([other]);

    // 工具插件存过数据的:推演插件跟着历史换,工具插件的记录留着
    expect((await changePluginData(sample.id, tool, { schema: 1, value: 1 })).status).toBe('saved');
    expect((await latest()).plugins).toEqual([other, tool]);
    await commitWorld(request({ recipeKey: 'k3', simPlugins: [magic] }));
    expect((await latest()).plugins).toEqual([tool, magic]);
    // 没说用了哪些(历史是读存着的,线程不知道):照上一份;说了没用:去掉
    await commitWorld(request({ recipeKey: 'k4' }));
    expect((await latest()).plugins).toEqual([tool, magic]);
    await commitWorld(request({ recipeKey: 'k5', simPlugins: [] }));
    expect((await latest()).plugins).toEqual([tool]);
  });

  it('存成文件(拼一份、存着的那份)清单里都记着推演插件和版本', async () => {
    const drafted = await draftFile(request({ simPlugins: [magic] }));
    expect((await openWorldFile(await bytesOf(drafted!.file), { readers: READERS })).manifest.plugins).toEqual([magic]);
    await commitWorld(request({ simPlugins: [magic] }));
    expect((await openWorldFile((await revisionFile(sample.id))!, { readers: READERS })).manifest.plugins).toEqual([magic]);
  });
});

describe('接着推之前核对推演插件', () => {
  const installed = (sum: string, previous?: string) => ({ id: 'magic', current: { sum, manifest: { version: '1.1.0' } }, ...(previous ? { previous: { sum: previous } } : {}) });

  it('同一版(现在用的、上一版)= ready;没装 = missing;只有别的版本 = other,带上装的那一版;工具插件不核对', () => {
    const world = [tool, magic];
    expect(checkSimPlugins(world, [installed(magic.sum)])).toEqual([{ id: 'magic', plugin: magic, status: 'ready', which: 'current' }]);
    expect(checkSimPlugins(world, [installed('a'.repeat(64), magic.sum)])).toEqual([{ id: 'magic', plugin: magic, status: 'ready', which: 'previous' }]);
    expect(checkSimPlugins(world, [])).toEqual([{ id: 'magic', plugin: magic, status: 'missing' }]);
    expect(checkSimPlugins(world, [installed('a'.repeat(64))])).toEqual([{ id: 'magic', plugin: magic, status: 'other', installed: { version: '1.1.0', sum: 'a'.repeat(64) } }]);
    expect(checkSimPlugins([tool], [])).toEqual([]);
  });

  it('本机插件仓库:同一版取出文件和世界记的滑条;更新以后用留着的上一版;没装、只有新版的交回核对结果', async () => {
    const file = await goodSimPlugin();
    expect(await simPluginsReady([tool])).toEqual({ ok: true, files: [] });
    expect(await simPluginsReady([magic])).toEqual({ ok: false, checks: [{ id: 'magic', plugin: magic, status: 'missing' }] });

    await installPlugin(file);
    const ready = await simPluginsReady([tool, magic]);
    expect(ready).toEqual({ ok: true, files: [{ id: 'magic', sum: magic.sum, bytes: file, params: { strength: 2 } }] });

    // 装了新版:上一版还留着,老世界照样接着推
    await installPlugin(newer);
    const kept = await simPluginsReady([magic]);
    expect(kept.ok && kept.files.map((f) => f.sum)).toEqual([magic.sum]);

    // 世界记的是更早的一版:只有别的版本
    const old: WorldPlugin = { ...magic, version: '0.9.0', sum: 'e'.repeat(64) };
    const got = await simPluginsReady([old]);
    expect(got.ok).toBe(false);
    expect(!got.ok && got.checks[0]).toMatchObject({ status: 'other', installed: { version: '1.1.0' } });
  });

  it('新推一个世界:各用现在的那一版;没装的抛 missing', async () => {
    await installPlugin(newer);
    const sum = (await openPluginFile(newer)).sum;
    expect(await simPluginFiles([{ id: 'magic', params: { strength: 3 } }])).toEqual([{ id: 'magic', sum, bytes: newer, params: { strength: 3 } }]);
    await expect(simPluginFiles([{ id: 'weariness' }])).rejects.toMatchObject({ kind: 'missing' });
  });
});

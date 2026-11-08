/**
 * 插件往打开着的世界里存数据(ui/plugins/worldPlugins.ts 的 askingWorldStore):每个世界第一次存时先问;
 * 「这次不存」回 cancelled、这次不再问;世界里已经有它的数据就不问;去掉、读不问。去掉插件存的数据也先问。IndexedDB 用 fake-indexeddb。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SnapshotPart } from '../src/gen/snapshot';
import { packWorldParts, type PackInput, type WorldEras } from '../src/gen/worldFile';
import type { WorldPlugin } from '../src/gen/worldFormat';
import { _resetVault, changePluginData, commitWorld, readPluginData, vaultOps, type CommitRequest } from '../src/worldVault';
import { MADE, READERS, makeSample } from './lib/worldFileSample';

const world = { id: '' };
vi.mock('../src/ui/worldStore', () => ({
  vaultCall: (op: keyof typeof vaultOps, args: unknown[]) => (vaultOps[op] as (...a: unknown[]) => Promise<unknown>)(...args),
  settleWorld: async () => null,
}));
vi.mock('../src/ui/saveStore', () => ({ currentWorld: () => (world.id ? { id: world.id } : null), keepWorld: () => {} }));
vi.mock('../src/plugin/pluginStore', () => ({ listPlugins: async () => [] }));

const { askingWorldStore, removePluginData, usedPlugins } = await import('../src/ui/plugins/worldPlugins');
const { dataAsk } = await import('../src/ui/plugins/askState');

const g = globalThis as unknown as { indexedDB: IDBFactory | undefined };
let sample: PackInput & { eras: WorldEras };
let viewParts: SnapshotPart[];
const tax: WorldPlugin = { id: 'city-tax', version: '2.0.0', sum: 'b'.repeat(64), role: 'tool', name: '城邦税赋' };

beforeAll(async () => {
  sample = makeSample();
  const { parts } = await packWorldParts(sample);
  viewParts = parts
    .filter((p) => !['author', 'thumb'].includes(p.info.name))
    .map((p) => ({ name: p.info.name, bytes: p.info.bytes, sum: p.info.sum, zip: p.info.zip as 'gzip' | 'none', data: p.data as ArrayBuffer }));
}, 60_000);

let n = 0;
beforeEach(async () => {
  _resetVault();
  g.indexedDB = new IDBFactory();
  // 每个用例一个新世界(问过、不让存的记在这次打开里,按世界编号分开)
  world.id = `${sample.id}-${n++}`;
  const req: CommitRequest = { id: world.id, recipe: sample.recipe, recipeKey: 'k1', parts: viewParts.map((p) => ({ ...p, data: p.data.slice(0) })), made: MADE, readers: READERS };
  await commitWorld(req);
});
afterEach(() => {
  dataAsk.set(null);
  _resetVault();
});

/** 等框出来,答一句 */
async function answer(ok: boolean) {
  for (let i = 0; i < 100 && !dataAsk.get(); i++) await new Promise((r) => setTimeout(r, 5));
  const a = dataAsk.get();
  expect(a).not.toBeNull();
  a!.answer(ok);
  return a!;
}

describe('插件存进世界的数据先问', () => {
  it('第一次存先问,框上写插件名和大约多大;点了存进去以后不再问', async () => {
    const st = askingWorldStore(tax, '城邦税赋');
    const p = Promise.resolve(st.set('city-tax', { schema: 1, value: { rate: 12 } }));
    const a = await answer(true);
    expect(a).toMatchObject({ kind: 'store', plugin: '城邦税赋', pluginId: 'city-tax' });
    await p;
    expect(await readPluginData(world.id, 'city-tax')).toMatchObject({ schema: 1, value: { rate: 12 } });
    await st.set('city-tax', { schema: 1, value: { rate: 13 } });
    expect(dataAsk.get()).toBeNull();
    expect((await st.get('city-tax'))?.value).toEqual({ rate: 13 });
  });

  it('这次不存:回 cancelled,这次打开里再存也不问、照样 cancelled;世界不变', async () => {
    const st = askingWorldStore(tax, '城邦税赋');
    const p = Promise.resolve(st.set('city-tax', { schema: 1, value: 1 })).catch((e: unknown) => e);
    await answer(false);
    expect(await p).toMatchObject({ code: 'cancelled' });
    await expect(Promise.resolve(st.set('city-tax', { schema: 1, value: 1 }))).rejects.toMatchObject({ code: 'cancelled' });
    expect(dataAsk.get()).toBeNull();
    expect(await readPluginData(world.id, 'city-tax')).toBeNull();
  });

  it('世界里已经有它的数据:不问;去掉、读都不问', async () => {
    await changePluginData(world.id, tax, { schema: 1, value: 'old' });
    const st = askingWorldStore(tax, '城邦税赋');
    await st.set('city-tax', { schema: 1, value: 'new' });
    expect(dataAsk.get()).toBeNull();
    await st.set('city-tax', null);
    expect(await st.get('city-tax')).toBeNull();
  });

  it('同时存好几次只问一回', async () => {
    const st = askingWorldStore(tax, '城邦税赋');
    const ps = [1, 2, 3].map((v) => Promise.resolve(st.set('city-tax', { schema: 1, value: v })));
    await answer(true);
    await Promise.all(ps);
    expect(dataAsk.get()).toBeNull();
  });

  it('去掉插件存的数据:先问,点了才去掉;用到的插件里照样列着名字', async () => {
    await changePluginData(world.id, tax, { schema: 1, value: 'x' });
    const used = await usedPlugins(world.id);
    expect(used.map((u) => [u.id, u.name, u.here, !!u.data])).toEqual([['city-tax', '城邦税赋', 'none', true]]);
    const no = removePluginData(world.id, used);
    expect(await answer(false)).toMatchObject({ kind: 'remove', plugins: ['城邦税赋'] });
    expect(await no).toBe(false);
    const yes = removePluginData(world.id, used);
    await answer(true);
    expect(await yes).toBe(true);
    expect(await readPluginData(world.id, 'city-tax')).toBeNull();
  });
});

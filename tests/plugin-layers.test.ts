/**
 * 插件图层:存进世界的块(layer.<插件编号>.<图层>:块名、内容的核对、存、读回、拿掉、不算只当字节留着的块、文件里逐块核对),
 * 地块图层上色(分类、渐变、两头、不画的),图层面板的按钮和正显示的那一个。IndexedDB 用 fake-indexeddb。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SnapshotPart } from '../src/gen/snapshot';
import { opaqueParts, openWorldFile, packWorldParts, readWorldContent, rewriteWorldFile, type PackInput, type WorldEras } from '../src/gen/worldFile';
import { PLUGIN_LAYER_PREFIX, pluginLayerPart, type PluginLayerData, type WorldManifest, type WorldPlugin } from '../src/gen/worldFormat';
import { validatePluginLayer } from '../src/gen/worldValidate';
import { ZIP_UPLOAD_MAX_BYTES } from '../src/gen/zipStore';
import { cellColors, rampRange } from '../src/render/pluginLayer';
import type { CellLayer } from '../src/plugin/check';
import { chipOn, layerChips, pluginLayers, setLiveLayer, setSavedLayers, shownLayer } from '../src/ui/plugins/layerState';
import { _resetVault, changePluginLayer, commitWorld, opaquePartsOf, readPluginLayers, readRevision, revisionFile, vaultOps, type CommitRequest } from '../src/worldVault';
import { MADE, READERS, makeSample } from './lib/worldFileSample';

const g = globalThis as unknown as { indexedDB: IDBFactory | undefined };

let sample: PackInput & { eras: WorldEras };
let viewParts: SnapshotPart[];
let n: number;
const tool: WorldPlugin = { id: 'coast-distance', version: '1.0.0', sum: 'a'.repeat(64), role: 'tool' };

const layer = (over: Partial<PluginLayerData> = {}): PluginLayerData => {
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) values[i] = i % 5 === 4 ? NaN : i % 4;
  return {
    id: 'coast',
    title: '离海多远',
    plugin: { name: '离海多远', version: '1.0.0' },
    values,
    classes: [0, 1, 2, 3].map((v) => ({ value: v, color: ['#2b83ba', '#abdda4', '#fdae61', '#d7191c'][v], label: `第 ${v + 1} 段` })),
    legend: '走陆路到海边',
    opacity: 0.7,
    ...over,
  };
};

beforeAll(async () => {
  sample = makeSample();
  n = sample.map.mesh.n;
  const { parts } = await packWorldParts(sample);
  viewParts = parts
    .filter((p) => !['author', 'thumb'].includes(p.info.name))
    .map((p) => ({ name: p.info.name, bytes: p.info.bytes, sum: p.info.sum, zip: p.info.zip as 'gzip' | 'none', data: p.data as ArrayBuffer }));
}, 60_000);

beforeEach(() => {
  _resetVault();
  g.indexedDB = new IDBFactory();
});
afterEach(() => _resetVault());

const copies = (list: SnapshotPart[]) => list.map((p) => ({ ...p, data: p.data.slice(0) }));
const request = (over: Partial<CommitRequest> = {}): CommitRequest => ({ id: sample.id, recipe: sample.recipe, recipeKey: 'k1', parts: copies(viewParts), made: MADE, readers: READERS, ...over });
const latest = async (): Promise<WorldManifest> => (await readRevision(sample.id, undefined, []))!.manifest;
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('块名和内容', () => {
  it('图层编号合块名规矩的原样用,别的换成散列;都不超过 64 个字', () => {
    expect(pluginLayerPart('coast-distance', 'coast')).toBe('layer.coast-distance.coast');
    expect(pluginLayerPart('coast-distance', 'Coast_1')).toMatch(/^layer\.coast-distance\.h[0-9a-f]{8}$/);
    expect(pluginLayerPart('coast-distance', 'Coast_1')).not.toBe(pluginLayerPart('coast-distance', 'coast_1'));
    expect(pluginLayerPart('a'.repeat(32), 'x'.repeat(24)).length).toBeLessThanOrEqual(64);
    expect(pluginLayerPart('a'.repeat(32), 'x'.repeat(25))).toMatch(/\.h[0-9a-f]{8}$/);
  });

  it('核对:合格的过;块名对不上、颜色不是 #rrggbb、渐变和分类都给、个数不对、多出来的键都不过', () => {
    const name = pluginLayerPart('coast-distance', 'coast');
    expect(() => validatePluginLayer(layer(), name, n)).not.toThrow();
    expect(() => validatePluginLayer({ ...layer(), classes: undefined, ramp: { colors: ['#000000', '#ffffff'], min: 0, max: 3 } }, name, n)).not.toThrow();
    const bad: unknown[] = [
      layer({ id: 'other' }),
      layer({ classes: [{ value: 0, color: 'red', label: 'x' }] }),
      { ...layer(), ramp: { colors: ['#000000', '#ffffff'] } },
      layer({ values: new Float32Array(3) }),
      { ...layer(), script: 'x' },
      layer({ title: '' }),
      layer({ opacity: 2 }),
      { ...layer(), classes: undefined, ramp: { colors: ['#000000'] } },
    ];
    for (const v of bad) expect(() => validatePluginLayer(v, name, n)).toThrow();
  });
});

describe('存进世界', () => {
  const name = () => pluginLayerPart(tool.id, 'coast');

  it('还没存过的世界存不了;存、读回:块可选、写着谁放的,清单记上插件,别的块不动;不算不能公开分享', async () => {
    expect(await changePluginLayer(sample.id, tool, name(), layer())).toEqual({ status: 'nobase' });
    await commitWorld(request());
    const before = await latest();
    expect(await changePluginLayer(sample.id, tool, name(), layer())).toEqual({ status: 'saved', n: 2 });
    const m = await latest();
    expect(m.parts.find((p) => p.name === name())).toMatchObject({ file: `parts/${name()}.gz`, schema: 1, need: 'extra', by: tool.id });
    expect(m.parts.filter((p) => p.name !== name())).toEqual(before.parts);
    expect(m.plugins).toEqual([tool]);
    const got = await readPluginLayers(sample.id);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ name: name(), by: tool.id, plugin: tool });
    expect(got[0].data.values).toEqual(layer().values);
    expect(await opaquePartsOf(sample.id)).toEqual([]);
    // 一样的不写新修订
    expect(await changePluginLayer(sample.id, tool, name(), layer())).toEqual({ status: 'same', n: 2 });
  });

  it('拿掉:块和工具插件的记录一起去掉;没给指纹的不动清单的记录', async () => {
    await commitWorld(request());
    await changePluginLayer(sample.id, tool, name(), layer());
    expect((await changePluginLayer(sample.id, { ...tool, sum: '' }, name(), null)).status).toBe('saved');
    expect((await latest()).plugins).toEqual([tool]);
    await changePluginLayer(sample.id, tool, name(), layer());
    expect((await changePluginLayer(sample.id, tool, name(), null)).status).toBe('saved');
    const m = await latest();
    expect(m.parts.some((p) => p.name.startsWith(PLUGIN_LAYER_PREFIX))).toBe(false);
    expect(m.plugins).toEqual([]);
    expect(await readPluginLayers(sample.id)).toEqual([]);
  });

  it('内容不合格的不写', async () => {
    await commitWorld(request());
    await expect(changePluginLayer(sample.id, tool, name(), layer({ classes: [] }))).rejects.toBeTruthy();
    await expect(changePluginLayer(sample.id, tool, 'layer.other-plugin.coast', layer())).rejects.toBeTruthy();
    expect((await latest()).revision.n).toBe(1);
  });

  it('存成文件:读得开、逐块核对过,不算只当字节留着;传上服务器的文件图层不对就整个不收,本机的只跳过那一块', async () => {
    await commitWorld(request());
    await changePluginLayer(sample.id, tool, name(), layer());
    const file = await bytesOf((await revisionFile(sample.id))!);
    const opened = await openWorldFile(file, { readers: READERS });
    expect(opened.kept).toEqual([]);
    expect(opaqueParts(opened.manifest.parts)).toEqual([]);
    expect((await readWorldContent(opened)).skipped).toEqual([]);
    expect((await readWorldContent(await openWorldFile(file, { readers: READERS, maxBytes: ZIP_UPLOAD_MAX_BYTES }))).skipped).toEqual([]);

    // 个数对不上的图层(别的世界的):本机跳过,传上服务器的不收
    await changePluginLayer(sample.id, tool, name(), layer({ values: new Float32Array(5) }));
    const wrong = await bytesOf((await revisionFile(sample.id))!);
    expect((await readWorldContent(await openWorldFile(wrong, { readers: READERS }))).skipped).toEqual([name()]);
    await expect(readWorldContent(await openWorldFile(wrong, { readers: READERS, maxBytes: ZIP_UPLOAD_MAX_BYTES }))).rejects.toMatchObject({ kind: 'broken' });
  });

  it('另存、重推:图层跟着走', async () => {
    await commitWorld(request());
    await changePluginLayer(sample.id, tool, name(), layer());
    const opened = await openWorldFile(await bytesOf((await revisionFile(sample.id))!), { readers: READERS });
    const again = await openWorldFile(await bytesOf(await rewriteWorldFile(opened, { title: '新名字' })), { readers: READERS });
    expect(again.manifest.parts.some((p) => p.name === name())).toBe(true);
    expect((await commitWorld(request({ recipeKey: 'k2' }))).status).toBe('same');
    expect(await readPluginLayers(sample.id)).toHaveLength(1);
  });

  it('走后台线程的那张表里有这两个', () => {
    expect(vaultOps.readPluginLayers).toBe(readPluginLayers);
    expect(vaultOps.changePluginLayer).toBe(changePluginLayer);
  });
});

describe('上色', () => {
  it('分类:值等于哪一类涂哪一类的颜色,不透明度照给的;别的值、NaN 不画', () => {
    const c = cellColors({ values: Float32Array.of(0, 1, 2, NaN), classes: [{ value: 0, color: '#ff0000', label: 'a' }, { value: 1, color: '#00ff00', label: 'b' }], opacity: 0.5 });
    expect([...c]).toEqual([255, 0, 0, 128, 0, 255, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('渐变:没给两头按数据的最小最大,给了照给的、超出的夹在两头;没给不透明度用网站的', () => {
    const l = { values: Float32Array.of(10, 20, 30, NaN), ramp: { colors: ['#000000', '#ffffff'] } };
    expect(rampRange(l)).toEqual([10, 30]);
    const c = cellColors(l);
    expect([c[0], c[4], c[8], c[12], c[15]]).toEqual([0, 128, 255, 0, 0]);
    expect(c[3]).toBe(166);
    const fixed = cellColors({ values: Float32Array.of(-5, 0, 100), ramp: { colors: ['#000000', '#ffffff'], min: 0, max: 50 } });
    expect([fixed[0], fixed[4], fixed[8]]).toEqual([0, 0, 255]);
    expect(rampRange({ values: Float32Array.of(NaN), ramp: { colors: ['#000000', '#ffffff'] } })).toEqual([0, 1]);
  });
});

describe('图层面板的按钮', () => {
  const cells = (id: string, title: string): CellLayer => ({ kind: 'cells', id, title, values: new Float32Array(3), classes: [{ value: 0, color: '#ff0000', label: 'a' }] });
  const who = (id: string, name: string) => ({ pluginId: id, plugin: name, record: { ...tool, id }, dev: false });

  beforeEach(() => pluginLayers.set({ live: new Map(), saved: new Map(), savedFor: null, runnable: [], shown: null }));

  it('存着的、交来的地块图层一个一个按钮,没交过图层的只交图层的插件也列上;标注图层不进', () => {
    setSavedLayers('w', new Map([['coast-distance/coast', { pluginId: 'coast-distance', name: 'layer.coast-distance.coast', data: layer(), record: tool }]]));
    pluginLayers.set({ ...pluginLayers.get(), runnable: [{ id: 'coast-distance', name: '离海多远' }, { id: 'heights', name: '海拔图层' }] });
    setLiveLayer(who('city-tax', '城邦税赋'), 'tax', cells('tax', '城邦税赋'));
    setLiveLayer(who('route-days', '量路程'), 'route', { kind: 'marks', id: 'route', title: '路线', items: [] });
    expect(layerChips(pluginLayers.get())).toEqual([
      { key: 'coast-distance/coast', label: '离海多远' },
      { key: 'city-tax/tax', label: '城邦税赋' },
      { key: 'run:heights', label: '海拔图层' },
    ]);
  });

  it('第一次交来的地块图层没有选中的就显示;开着的盖过存着的,停了回到存着的;再点收起', () => {
    setSavedLayers('w', new Map([['city-tax/tax', { pluginId: 'city-tax', name: 'layer.city-tax.tax', data: layer({ id: 'tax', title: '存着的' }), record: null }]]));
    setLiveLayer(who('city-tax', '城邦税赋'), 'tax', cells('tax', '城邦税赋'));
    let s = pluginLayers.get();
    expect(s.shown).toBe('city-tax/tax');
    expect(shownLayer(s)?.live?.layer.title).toBe('城邦税赋');
    setLiveLayer(who('city-tax', '城邦税赋'), 'tax', null);
    s = pluginLayers.get();
    expect(shownLayer(s)?.cells.title).toBe('存着的');
    expect(chipOn(s, 'city-tax/tax')).toBe(true);
  });

  it('点了只交图层的插件:交来以后按钮亮的是它交的图层;交来以前什么都不画', () => {
    pluginLayers.set({ ...pluginLayers.get(), runnable: [{ id: 'heights', name: '海拔图层' }], shown: 'run:heights' });
    expect(shownLayer(pluginLayers.get())).toBeNull();
    setLiveLayer(who('heights', '海拔图层'), 'h', cells('h', '海拔'));
    const s = pluginLayers.get();
    expect(s.shown).toBe('heights/h');
    expect(chipOn(s, 'heights/h')).toBe(true);
    expect(layerChips(s).map((c) => c.key)).toEqual(['heights/h']);
  });
});

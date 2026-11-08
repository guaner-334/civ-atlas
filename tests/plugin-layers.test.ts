/**
 * 插件图层:工具插件的图层存进世界(块名里的图层编号、存、读回、拿掉、上限、清单的插件记录、不算只当字节留着的块),
 * 地块图层上色(分类、渐变、两头、不画的),图层面板的按钮和正显示的那一个。块的格式本身的核对在 world-file-layers.test.ts。IndexedDB 用 fake-indexeddb。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SnapshotPart } from '../src/gen/snapshot';
import { opaqueParts, openWorldFile, packWorldParts, readWorldContent, rewriteWorldFile, type PackInput, type WorldEras } from '../src/gen/worldFile';
import { PLUGIN_LAYERS_MAX, PLUGIN_LAYER_ID, PLUGIN_LAYER_PREFIX, pluginLayerPart, savedLayerId, type PluginLayerValue, type WorldManifest, type WorldPlugin } from '../src/gen/worldFormat';
import { ZIP_UPLOAD_MAX_BYTES } from '../src/gen/zipStore';
import { cellColors, rampRange } from '../src/render/pluginLayer';
import type { CellLayer } from '../src/plugin/check';
import { chipOn, layerChips, pluginExport, pluginLayers, setLiveLayer, setSavedLayers, setSimLayers, shownLayer, shownPaint } from '../src/ui/plugins/layerState';
import type { SimLayer } from '../src/gen/civ/engine/pluginLayers';
import { _resetVault, changePluginLayer, commitWorld, opaquePartsOf, readPluginLayers, readRevision, revisionFile, vaultOps, type CommitRequest } from '../src/worldVault';
import { MADE, READERS, makeSample } from './lib/worldFileSample';

const g = globalThis as unknown as { indexedDB: IDBFactory | undefined };

let sample: PackInput & { eras: WorldEras };
let viewParts: SnapshotPart[];
let n: number;
const tool: WorldPlugin = { id: 'coast-distance', version: '1.0.0', sum: 'a'.repeat(64), role: 'tool', name: '离海多远' };

const layer = (over: Partial<PluginLayerValue> = {}): PluginLayerValue => {
  const values = new Float32Array(n);
  for (let i = 0; i < n; i++) values[i] = i % 5 === 4 ? NaN : i % 4;
  return {
    title: '离海多远',
    unit: 'cell',
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

describe('图层编号', () => {
  it('合块名规矩的原样用,有大写、下划线、太长的换成散列;换出来的也合规矩', () => {
    expect(savedLayerId('coast')).toBe('coast');
    for (const id of ['Coast_1', 'coast_1', 'x'.repeat(26), 'A'.repeat(32)]) expect(savedLayerId(id)).toMatch(/^h[0-9a-f]{8}$/);
    expect(savedLayerId('Coast_1')).not.toBe(savedLayerId('coast_1'));
    expect(PLUGIN_LAYER_ID.test(savedLayerId('Coast_1'))).toBe(true);
    expect(pluginLayerPart('a'.repeat(32), savedLayerId('x'.repeat(40))).length).toBeLessThanOrEqual(64);
  });
});

describe('存进世界', () => {
  const name = () => pluginLayerPart(tool.id, 'coast');

  it('还没存过的世界存不了;存、读回:块可选、写着谁放的,清单记上插件(连名字),别的块不动;不算不能公开分享', async () => {
    expect(await changePluginLayer(sample.id, tool, 'coast', layer())).toEqual({ status: 'nobase' });
    await commitWorld(request());
    const before = await latest();
    expect(await changePluginLayer(sample.id, tool, 'coast', layer())).toEqual({ status: 'saved', n: 2 });
    const m = await latest();
    expect(m.parts.find((p) => p.name === name())).toMatchObject({ file: `parts/${name()}.gz`, schema: 1, need: 'extra', by: tool.id });
    expect(m.parts.filter((p) => p.name !== name())).toEqual(before.parts);
    expect(m.plugins).toEqual([tool]);
    const got = await readPluginLayers(sample.id, n);
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ name: name(), by: tool.id, layer: 'coast', plugin: tool });
    expect(got[0].data.values).toEqual(layer().values);
    expect(await opaquePartsOf(sample.id)).toEqual([]);
    // 一样的不写新修订;地块数对不上的(别的世界的)读的时候跳过
    expect(await changePluginLayer(sample.id, tool, 'coast', layer())).toEqual({ status: 'same', n: 2 });
    expect(await readPluginLayers(sample.id, n + 1)).toEqual([]);
  });

  it('一个世界最多存 PLUGIN_LAYERS_MAX 个,满了不写;换掉已有的照常', async () => {
    await commitWorld(request());
    for (let i = 0; i < PLUGIN_LAYERS_MAX; i++) expect((await changePluginLayer(sample.id, tool, `l${i}`, layer())).status).toBe('saved');
    expect(await changePluginLayer(sample.id, tool, 'one-more', layer())).toEqual({ status: 'many' });
    expect((await changePluginLayer(sample.id, tool, 'l0', layer({ title: '换了' }))).status).toBe('saved');
  });

  it('拿掉:块和工具插件的记录一起去掉;没给指纹的不动清单的记录', async () => {
    await commitWorld(request());
    await changePluginLayer(sample.id, tool, 'coast', layer());
    expect((await changePluginLayer(sample.id, { ...tool, sum: '' }, 'coast', null)).status).toBe('saved');
    expect((await latest()).plugins).toEqual([tool]);
    await changePluginLayer(sample.id, tool, 'coast', layer());
    expect((await changePluginLayer(sample.id, tool, 'coast', null)).status).toBe('saved');
    const m = await latest();
    expect(m.parts.some((p) => p.name.startsWith(PLUGIN_LAYER_PREFIX))).toBe(false);
    expect(m.plugins).toEqual([]);
    expect(await readPluginLayers(sample.id, n)).toEqual([]);
  });

  it('内容不合格、编号不合块名规矩、不是按地块一份的不写', async () => {
    await commitWorld(request());
    await expect(changePluginLayer(sample.id, tool, 'coast', layer({ classes: [] }))).rejects.toBeTruthy();
    await expect(changePluginLayer(sample.id, tool, 'Coast_1', layer())).rejects.toBeTruthy();
    await expect(changePluginLayer(sample.id, tool, 'coast', layer({ unit: 'region' }))).rejects.toBeTruthy();
    await expect(changePluginLayer(sample.id, tool, 'coast', layer({ years: [0] }))).rejects.toBeTruthy();
    expect((await latest()).revision.n).toBe(1);
  });

  it('存成文件:读得开、逐块核对过,不算只当字节留着;传上服务器的文件图层不对就整个不收,本机的只跳过那一块', async () => {
    await commitWorld(request());
    await changePluginLayer(sample.id, tool, 'coast', layer());
    const file = await bytesOf((await revisionFile(sample.id))!);
    const opened = await openWorldFile(file, { readers: READERS });
    expect(opened.kept).toEqual([]);
    expect(opaqueParts(opened.manifest.parts)).toEqual([]);
    expect((await readWorldContent(opened)).skipped).toEqual([]);
    expect((await readWorldContent(await openWorldFile(file, { readers: READERS, maxBytes: ZIP_UPLOAD_MAX_BYTES }))).skipped).toEqual([]);

    // 个数对不上的图层(别的世界的):本机跳过,传上服务器的不收
    await changePluginLayer(sample.id, tool, 'coast', layer({ values: new Float32Array(5) }));
    const wrong = await bytesOf((await revisionFile(sample.id))!);
    expect((await readWorldContent(await openWorldFile(wrong, { readers: READERS }))).skipped).toEqual([name()]);
    await expect(readWorldContent(await openWorldFile(wrong, { readers: READERS, maxBytes: ZIP_UPLOAD_MAX_BYTES }))).rejects.toMatchObject({ kind: 'broken' });
  });

  it('另存、重推:图层跟着走', async () => {
    await commitWorld(request());
    await changePluginLayer(sample.id, tool, 'coast', layer());
    const opened = await openWorldFile(await bytesOf((await revisionFile(sample.id))!), { readers: READERS });
    const again = await openWorldFile(await bytesOf(await rewriteWorldFile(opened, { title: '新名字' })), { readers: READERS });
    expect(again.manifest.parts.some((p) => p.name === name())).toBe(true);
    expect((await commitWorld(request({ recipeKey: 'k2' }))).status).toBe('same');
    expect(await readPluginLayers(sample.id, n)).toHaveLength(1);
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

  beforeEach(() => pluginLayers.set({ live: new Map(), saved: new Map(), savedFor: null, sim: null, runnable: [], shown: null }));

  it('存着的、交来的地块图层一个一个按钮,没交过图层的只交图层的插件也列上;标注图层不进', () => {
    setSavedLayers('w', new Map([['coast-distance/coast', { pluginId: 'coast-distance', layer: 'coast', data: layer(), record: tool }]]));
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
    setSavedLayers('w', new Map([['city-tax/tax', { pluginId: 'city-tax', layer: 'tax', data: layer({ title: '存着的' }), record: null }]]));
    setLiveLayer(who('city-tax', '城邦税赋'), 'tax', cells('tax', '城邦税赋'));
    let s = pluginLayers.get();
    expect(s.shown).toBe('city-tax/tax');
    expect(shownLayer(s)?.live?.layer.title).toBe('城邦税赋');
    setLiveLayer(who('city-tax', '城邦税赋'), 'tax', null);
    s = pluginLayers.get();
    expect(shownLayer(s)?.cells.title).toBe('存着的');
    expect(chipOn(s, 'city-tax/tax')).toBe(true);
  });

  it('存着的图层让插件重新算:交来以前照旧画存着的、按钮亮着;交来以后画新算的', () => {
    setSavedLayers('w', new Map([['heights/h', { pluginId: 'heights', layer: 'h', data: layer({ title: '存着的' }), record: null }]]));
    pluginLayers.set({ ...pluginLayers.get(), shown: 'run:heights' });
    let s = pluginLayers.get();
    expect(shownLayer(s)?.saved?.data.title).toBe('存着的');
    expect(chipOn(s, 'heights/h')).toBe(true);
    setLiveLayer(who('heights', '海拔图层'), 'h', cells('h', '新算的'));
    s = pluginLayers.get();
    expect(s.shown).toBe('heights/h');
    expect(shownLayer(s)?.live?.layer.title).toBe('新算的');
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

describe('推演插件存进历史的图层', () => {
  // 3 个州、4 个地块(最后一个在海里);第 0、50、100 年各存一份,第 100 年那份多出来的州不画
  const of = Int32Array.of(0, 1, 2, -1);
  const magic = (over: Partial<SimLayer> = {}): SimLayer => ({
    by: 'magic',
    id: 'magic',
    title: '魔力浓度',
    unit: 'region',
    years: [0, 50, 100],
    values: Float32Array.of(0, 0, 0, 10, 20, 30, 40, NaN, 60),
    ramp: { colors: ['#000000', '#ffffff'] },
    legend: '魔力',
    ...over,
  });
  const civ = (layers: SimLayer[] | undefined, endYear = 100) => ({ simLayers: layers, regions: { of }, endYear });

  beforeEach(() => pluginLayers.set({ live: new Map(), saved: new Map(), savedFor: null, sim: null, runnable: [], shown: null }));

  it('按钮排在最前、带推演;选上以后画时间轴那一年以前最近的一份,颜色按所有份定', () => {
    setSavedLayers('w', new Map([['coast-distance/coast', { pluginId: 'coast-distance', layer: 'coast', data: layer(), record: tool }]]));
    setSimLayers(civ([magic()]));
    expect(layerChips(pluginLayers.get())).toEqual([
      { key: 'sim:magic/magic', label: '魔力浓度', sim: true },
      { key: 'coast-distance/coast', label: '离海多远' },
    ]);
    pluginLayers.set({ ...pluginLayers.get(), shown: 'sim:magic/magic' });
    const s = pluginLayers.get();
    expect(chipOn(s, 'sim:magic/magic')).toBe(true);
    expect(shownLayer(s)?.sim?.pluginId).toBe('magic');
    const at = (y: number | null) => {
      const p = shownPaint(y)!;
      return { year: p.year, values: [...p.values], ramp: p.ramp };
    };
    expect(at(49)).toEqual({ year: 0, values: [0, 0, 0, NaN], ramp: { colors: ['#000000', '#ffffff'], min: 0, max: 60 } });
    expect(at(50).values).toEqual([10, 20, 30, NaN]);
    expect(at(null)).toMatchObject({ year: 100, values: [40, NaN, 60, NaN] });
    expect(shownPaint(60)).toBe(shownPaint(99));
    expect(shownPaint(60)?.title).toBe('魔力浓度');
    expect(pluginExport(0).plugin?.values).toEqual(Float32Array.of(0, 0, 0, NaN));
  });

  it('历史换了:还有这个图层就接着显示新的;没了就收起;存着的、交来的不受影响', () => {
    setSimLayers(civ([magic()]));
    pluginLayers.set({ ...pluginLayers.get(), shown: 'sim:magic/magic' });
    const next = magic({ values: Float32Array.of(1, 1, 1, 2, 2, 2, 3, 3, 3) });
    setSimLayers(civ([next]));
    expect(pluginLayers.get().shown).toBe('sim:magic/magic');
    expect([...shownPaint(100)!.values]).toEqual([3, 3, 3, NaN]);
    setSimLayers(civ(undefined));
    expect(pluginLayers.get().shown).toBeNull();
    expect(pluginLayers.get().sim).toBeNull();
    expect(layerChips(pluginLayers.get())).toEqual([]);
  });
});

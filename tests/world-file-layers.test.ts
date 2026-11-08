/**
 * 世界文件里的插件图层(layer.<插件编号>.<图层编号> 那几块,gen/worldFormat.ts 的 PLUGIN_LAYER_PREFIX)和推演插件写的编年史:
 * 推演插件的图层存的时候从历史里拆出来、读的时候接回去;编年史留在历史里、照字进编年史那一块;不装插件打开看到的一样,接着推和一口气推完一样;
 * 每一块都逐项核对、不算只当字节留着的块;另存换了历史时跟着历史的整批换掉,别的插件存的留着;坏了的本机读时不要,传上服务器的算坏
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { isDeepStrictEqual } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateCiv, startContinue, type Civ } from '../src/gen/civ';
import { chronicleBlock, chronicleOfBlock } from '../src/gen/civ/story/nameTokens';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { flagBook } from '../src/gen/civ/story/flags';
import { makeSave, worldCheck } from '../src/gen/savefile';
import { makePart, packValue, recipeKey, recipeOfSave, sha256 } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import {
  buildManifest,
  manifestBytes,
  opaqueParts,
  openStoredParts,
  openWorldFile,
  packPluginLayer,
  packWorldFile,
  packWorldParts,
  readTrustedParts,
  readWorldContent,
  rewriteWorldFile,
  splitSimLayers,
  zipWorld,
  type OpenedWorldFile,
  type PackInput,
  type PackedPart,
} from '../src/gen/worldFile';
import { _resetVault, adoptFile, stateOf } from '../src/worldVault';
import { openStoredWorld } from '../src/worldOpen';
import { PLUGIN_LAYER_ID, PLUGIN_LAYER_MAX_BYTES, WorldFileError, type PluginLayerValue } from '../src/gen/worldFormat';
import { LAYER_ID } from '../src/gen/civ/engine/pluginLayers';
import { parseManifest, validateCiv, validatePluginLayer } from '../src/gen/worldValidate';
import { ZIP_UPLOAD_MAX_BYTES } from '../src/gen/zipStore';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { MADE, READERS, bytesOf } from './lib/worldFileSample';
import { ledger, scribe } from './lib/simPlugins';

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPEN = { readers: READERS };
const params = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
const plugins = [scribe(), ledger()];
let world: World;
let civ: Civ;

const bytes = (v: unknown) => Buffer.from(packValue(v));

function input(c: Civ): PackInput {
  return {
    id: 'wlayer',
    title: '图层世界',
    made: MADE,
    readers: READERS,
    recipe: makeSave(params, { names: {}, interventions: [], terrain: [], upheavals: [] }, worldCheck(world), '图层世界', '2026-11-08T08:00:00.000Z', { projection: 'robinson', center: 120 }),
    map: world,
    civ: c,
    chronicle: chronicleBlock(c),
    flags: flagBook(world, c),
  };
}

/** 工具插件存进世界的一个地块图层 */
const toolLayer = (): PluginLayerValue => ({ title: '离海多远', unit: 'cell', values: new Float32Array(world.mesh.n).map((_, i) => i % 7), ramp: { colors: ['#ffffff', '#08306b'] }, legend: '格' });

/** 打成文件,再接上几块 */
async function fileWith(c: Civ, more: PackedPart[]): Promise<Uint8Array> {
  const inp = input(c);
  const packed = await packWorldParts(inp);
  const parts = [...packed.parts, ...more];
  return bytesOf(await zipWorld(manifestBytes(buildManifest(inp, parts.map((p) => p.info))), parts));
}

const read = async (f: Blob | Uint8Array, maxBytes?: number) => readWorldContent(await openWorldFile(f instanceof Blob ? await bytesOf(f) : f, { ...OPEN, ...(maxBytes ? { maxBytes } : {}) }));

async function expectBroken(run: () => Promise<unknown>, hint: string) {
  let err: unknown;
  try {
    await run();
  } catch (e) {
    err = e;
  }
  expect(err, hint).toBeInstanceOf(WorldFileError);
  expect((err as WorldFileError).kind, `${hint} ${(err as Error).message}`).toBe('broken');
}

beforeAll(() => {
  world = generateWorld(params);
  civ = generateCiv(world, { endYear: 1200, plugins });
}, 60_000);

describe('世界文件里的插件图层、推演插件写的编年史', () => {
  it('图层一个一块,排在推演插件的状态后面;历史那一块不带图层、带着编年史;读回来逐字节一样,不算只当字节留着的块', async () => {
    expect(civ.simChronicle?.length).toBeGreaterThan(3);
    const opened = await openWorldFile(await bytesOf(await packWorldFile(input(civ))), OPEN);
    expect(opened.manifest.parts.map((p) => p.name)).toEqual(['map', 'civ', 'chronicle', 'flags', 'sim.scribe', 'sim.ledger', 'layer.scribe.magic', 'layer.scribe.mark-b']);
    expect(opened.manifest.parts[6]).toMatchObject({ file: 'parts/layer.scribe.magic.gz', schema: 1, need: 'extra', by: 'scribe' });
    expect(opened.kept).toEqual([]);
    expect(opaqueParts(opened.manifest.parts)).toEqual([]);
    const partsOf = (o: OpenedWorldFile, keep: (name: string) => boolean): PackedPart[] => o.manifest.parts.filter((p) => keep(p.name)).map((info) => ({ info, data: o.bytes.get(info.name)! }));
    const viewOnly = (await readTrustedParts(openStoredParts(opened.manifestBytes, partsOf(opened, (n) => !n.startsWith('layer.')), OPEN), ['map', 'civ'])).civ as Civ;
    expect('simLayers' in viewOnly).toBe(false);
    expect(viewOnly.simChronicle).toEqual(civ.simChronicle);
    const all = (await readTrustedParts(openStoredParts(opened.manifestBytes, partsOf(opened, () => true), OPEN), ['map', 'civ'])).civ as Civ;
    expect(bytes(all.simLayers).equals(bytes(civ.simLayers))).toBe(true);
    const c = await readWorldContent(opened);
    expect(c.skipped).toEqual([]);
    expect(bytes(c.civ.simLayers).equals(bytes(civ.simLayers))).toBe(true);
    expect(bytes(c.civ.simChronicle).equals(bytes(civ.simChronicle))).toBe(true);
    expect(civDiff(c.civ, civ)).toBeNull();
  }, 60_000);

  it('不装插件打开:编年史(插件写的那几句也在)、图层和存之前看到的一样;接着推和一口气推完一样', async () => {
    const c = await read(await packWorldFile(input(civ)));
    const shown = chronicleOfBlock(c.chronicle, c.civ)!;
    expect(shown).toEqual(chronicleOfBlock(chronicleBlock(civ), civ));
    expect(shown).toEqual(fullChronicle(civ));
    expect(shown.filter((e) => e.kind === 'plugin').map((e) => e.year)).toEqual(civ.simChronicle!.map((l) => l.year));
    expect(fullChronicle(c.civ)).toEqual(shown);
    const run = startContinue(world, c.civ, { plugins, endYear: 2000 });
    expect(run).not.toBeNull();
    const got = run!.finish();
    const one = generateCiv(world, { plugins, endYear: 2000 });
    expect(civDiff(got, one)).toBeNull();
    expect(bytes(got.simLayers).equals(bytes(one.simLayers))).toBe(true);
  }, 60_000);

  it('没用推演插件的世界:没有图层块,历史那一块和直接打包的一样', async () => {
    const plain = generateCiv(world, { endYear: 1200 });
    expect((await splitSimLayers(plain)).civ).toBe(plain);
    const opened = await openWorldFile(await bytesOf(await packWorldFile(input(plain))), OPEN);
    expect(opened.manifest.parts.map((p) => p.name)).toEqual(['map', 'civ', 'chronicle', 'flags']);
    expect(opened.manifest.parts[1].sum).toBe((await makePart('civ', plain)).sum);
    const c = await readWorldContent(opened);
    expect('simLayers' in c.civ || 'simChronicle' in c.civ).toBe(false);
  }, 60_000);

  it('另存:换了历史,跟着历史的图层块整批换掉,工具插件存的图层留着;只改名的连字节都不动', async () => {
    const tool = await packPluginLayer('ruler', 'sea-dist', toolLayer());
    expect(tool.info).toMatchObject({ name: 'layer.ruler.sea-dist', file: 'parts/layer.ruler.sea-dist.gz', schema: 1, need: 'extra', by: 'ruler' });
    const opened = await openWorldFile(await fileWith(civ, [tool]), OPEN);
    expect(opaqueParts(opened.manifest.parts)).toEqual([]);
    const c = await readWorldContent(opened);
    expect(c.civ.simLayers?.map((l) => l.id)).toEqual(['magic', 'mark-b']);

    const later = generateCiv(world, { endYear: 1500, plugins: [ledger()] });
    const swapped = await openWorldFile(await bytesOf(await rewriteWorldFile(opened, { values: { civ: later, chronicle: chronicleBlock(later), flags: flagBook(world, later) } })), OPEN);
    expect(swapped.manifest.parts.map((p) => p.name)).toEqual(['map', 'civ', 'chronicle', 'flags', 'layer.ruler.sea-dist', 'sim.ledger']);
    expect(isDeepStrictEqual(swapped.bytes.get('layer.ruler.sea-dist'), opened.bytes.get('layer.ruler.sea-dist'))).toBe(true);
    expect('simLayers' in (await readWorldContent(swapped)).civ).toBe(false);

    const again = generateCiv(world, { endYear: 1300, plugins: [scribe()] });
    const back = await openWorldFile(await bytesOf(await rewriteWorldFile(swapped, { values: { civ: again, chronicle: chronicleBlock(again), flags: flagBook(world, again) } })), OPEN);
    expect(back.manifest.parts.map((p) => p.name)).toEqual(['map', 'civ', 'chronicle', 'flags', 'layer.ruler.sea-dist', 'sim.scribe', 'layer.scribe.magic', 'layer.scribe.mark-b']);
    expect(bytes((await readWorldContent(back)).civ.simLayers).equals(bytes(again.simLayers))).toBe(true);

    // 工具插件存的带年份的图层和历史无关:换成推得更短的历史也照样认得
    const dated = await packPluginLayer('ruler', 'dated', { ...toolLayer(), years: [0, 1200], values: new Float32Array(2 * world.mesh.n) });
    const withDated = await openWorldFile(await fileWith(civ, [dated]), OPEN);
    const short = generateCiv(world, { endYear: 600 });
    const shorter = await openWorldFile(await bytesOf(await rewriteWorldFile(withDated, { values: { civ: short, chronicle: chronicleBlock(short), flags: flagBook(world, short) } })), OPEN);
    expect(shorter.manifest.parts.map((p) => p.name)).toContain('layer.ruler.dated');
    expect((await readWorldContent(shorter)).skipped).toEqual([]);

    const renamed = await openWorldFile(await bytesOf(await rewriteWorldFile(opened, { title: '改个名' })), OPEN);
    for (const p of opened.manifest.parts.filter((x) => x.name.startsWith('layer.'))) {
      expect(renamed.manifest.parts.find((x) => x.name === p.name)).toEqual(p);
      expect(isDeepStrictEqual(renamed.bytes.get(p.name), opened.bytes.get(p.name))).toBe(true);
    }
  }, 60_000);

  it('坏了的图层:本机读时跟着历史的几块都不要、工具插件的只跳过那一块,记进 skipped;传上服务器的文件算坏', async () => {
    const [magic, mark] = civ.simLayers!;
    const bad = await fileWith({ ...civ, simLayers: [magic, { ...mark, values: new Float32Array(3) }] }, []);
    const c = await read(bad);
    expect(c.skipped).toEqual(['layer.scribe.mark-b', 'layer.scribe.magic']);
    expect('simLayers' in c.civ).toBe(false);
    await expectBroken(() => read(bad, ZIP_UPLOAD_MAX_BYTES), '传上服务器');

    const tool = await fileWith(civ, [await packPluginLayer('ruler', 'sea-dist', { ...toolLayer(), values: new Float32Array(5) }), await packPluginLayer('ruler', 'by-region', { ...toolLayer(), unit: 'region', values: new Float32Array(civ.regions.count) })]);
    const t = await read(tool);
    expect(t.skipped).toEqual(['layer.ruler.sea-dist', 'layer.ruler.by-region']);
    expect(bytes(t.civ.simLayers).equals(bytes(civ.simLayers))).toBe(true);
    await expectBroken(() => read(tool, ZIP_UPLOAD_MAX_BYTES), '工具插件的图层传上服务器');
  }, 60_000);

  it('清单里的规矩:块名是 layer.<插件编号>.<图层编号>、只能是可选的、by 写同一个插件、不超过上限、一个世界最多 16 个;结构比软件新的只当字节留着', async () => {
    // 推演插件标图层时查的编号和块名的规矩是同一个
    expect(LAYER_ID.source).toBe(PLUGIN_LAYER_ID.source);
    const opened = await openWorldFile(await bytesOf(await packWorldFile(input(civ))), OPEN);
    const m = opened.manifest;
    const at = m.parts.findIndex((p) => p.name === 'layer.scribe.magic');
    const changed = (over: Record<string, unknown>) => {
      const x = structuredClone(m) as any;
      Object.assign(x.parts[at], over);
      return new TextEncoder().encode(JSON.stringify(x));
    };
    for (const over of [{ need: 'view' }, { by: 'ledger' }, { by: undefined }, { name: 'layer.scribe', file: 'parts/layer.scribe.gz' }, { name: 'layer.scribe.a.b', file: 'parts/lab.gz' }, { name: `layer.scribe.${'a'.repeat(26)}`, file: 'parts/long.gz' }, { bytes: PLUGIN_LAYER_MAX_BYTES + 1 }]) {
      expect(() => parseManifest(changed(over), OPEN), JSON.stringify(over)).toThrow(WorldFileError);
    }
    expect(opaqueParts(parseManifest(changed({ schema: 2 }), OPEN).parts)).toEqual(['layer.scribe.magic']);
    const many = structuredClone(m) as any;
    for (let i = 0; i < 15; i++) many.parts.push({ ...m.parts[at], name: `layer.scribe.x${i}`, file: `parts/layer.scribe.x${i}.gz` });
    expect(() => parseManifest(new TextEncoder().encode(JSON.stringify(many)), OPEN)).toThrow(/最多 16 个/);
    many.parts.pop();
    expect(() => parseManifest(new TextEncoder().encode(JSON.stringify(many)), OPEN)).not.toThrow();
  }, 60_000);

  it('历史那一块里带着图层的(没拆开存的)也逐项核对;两处都有算坏', async () => {
    const opened = await openWorldFile(await bytesOf(await packWorldFile(input(civ))), OPEN);
    const inCiv = async (c: Civ, keepLayers: boolean) => {
      const part = await makePart('civ', c);
      const parts = opened.manifest.parts.filter((p) => keepLayers || !p.name.startsWith('layer.')).map((p) => (p.name === 'civ' ? { ...p, sum: part.sum, bytes: part.bytes, zip: part.zip } : p));
      const bytesMap = new Map(opened.bytes);
      bytesMap.set('civ', part.data instanceof Uint8Array ? part.data : new Uint8Array(part.data));
      return readWorldContent({ ...opened, manifest: { ...opened.manifest, parts }, bytes: bytesMap });
    };
    const { simPlugins: _s, ...withLayers } = civ;
    void _s;
    const ok = await inCiv(withLayers, false);
    expect(bytes(ok.civ.simLayers).equals(bytes(civ.simLayers))).toBe(true);
    await expectBroken(() => inCiv({ ...withLayers, simLayers: [{ ...civ.simLayers![0], years: [5, 1] }] }, false), '历史里的图层坏了');
    await expectBroken(() => inCiv(withLayers, true), '两处都有');
  }, 60_000);

  it('本机仓库:收下带图层块的文件,第一次打开(逐项校验)和以后再打开(只核指纹)都接回图层', async () => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    _resetVault();
    const inp = input(civ);
    const file = await packWorldFile(inp);
    const opened = await openWorldFile(await bytesOf(file), OPEN);
    const key = await recipeKey(recipeOfSave(inp.recipe));
    await adoptFile({ id: 'wlayer', file, sum: await sha256(opened.manifestBytes), recipeKey: key, generator: inp.recipe.generator, readers: READERS });
    const ask = { id: 'wlayer', recipe: key, generator: inp.recipe.generator };
    const first = await openStoredWorld(ask);
    expect(bytes(first.civ!.simLayers).equals(bytes(civ.simLayers))).toBe(true);
    expect((await stateOf('wlayer'))?.checked).toBeTruthy();
    const again = await openStoredWorld(ask);
    expect(bytes(again.civ!.simLayers).equals(bytes(civ.simLayers))).toBe(true);
    expect(again.civ!.simChronicle).toEqual(civ.simChronicle);
    _resetVault();
  }, 60_000);

  it('核对图层、插件写的编年史:格数、年份、无穷大、认不出的键、颜色、标题、渐变和分类都给,编年史的指代、字都算', () => {
    const sizes = { cells: world.mesh.n, regions: civ.regions.count, endYear: civ.endYear };
    const { by: _b, id: _i, ...magic } = civ.simLayers![0];
    void _b, _i;
    expect(() => validatePluginLayer(magic, sizes)).not.toThrow();
    expect(() => validatePluginLayer(toolLayer(), sizes)).not.toThrow();
    const bad = (x: unknown, hint: string) => expect(() => validatePluginLayer(x, sizes), hint).toThrow(WorldFileError);
    bad({ ...magic, values: magic.values.subarray(1) }, '格数');
    bad({ ...magic, values: Array.from(magic.values) }, '不是 Float32Array');
    bad({ ...magic, values: magic.values.map((x, i) => (i === 3 ? Infinity : x)) }, '无穷大');
    bad({ ...magic, years: [...magic.years.slice(0, -1), magic.years[0]] }, '年份没排好');
    bad({ ...magic, years: magic.years.map((y) => y + 1) }, '年份晚于推到的那年');
    bad({ ...magic, years: [] }, '年份是空的');
    bad({ ...magic, extra: 1 }, '认不出的键');
    bad({ ...magic, unit: 'polity' }, '单位');
    bad({ ...magic, ramp: { colors: ['#F4F0FA', '#5b2a86'] } }, '颜色大写');
    bad({ ...magic, title: '魔力\u0007' }, '标题带控制字符');
    bad({ ...magic, title: '长'.repeat(41) }, '标题太长');
    bad({ ...magic, classes: [{ value: 0, color: '#000000', label: '零' }] }, '渐变和分类都给');
    bad({ ...magic, ramp: { ...magic.ramp!, extra: 1 } }, '渐变里有认不出的键');
    // 键的先后不算
    expect(() => validatePluginLayer({ ...magic, ramp: { max: 100, min: 0, colors: magic.ramp!.colors } }, sizes)).not.toThrow();
    const classes = { ...toolLayer(), ramp: undefined, classes: [{ label: '零', color: '#000000', value: 0 }] };
    expect(() => validatePluginLayer(classes, sizes)).not.toThrow();
    bad({ ...classes, classes: [{ label: '零', color: '#000000', value: 0, why: 'x' }] }, '分类里有认不出的键');
    expect(() => validatePluginLayer({ ...toolLayer(), years: [10] }, sizes)).not.toThrow();
    bad({ ...toolLayer(), years: [0, 10] }, '两份年份、一份的数');

    const check = (c: Civ) => () => validateCiv(c, world);
    expect(check(civ)).not.toThrow();
    const line = civ.simChronicle![0];
    for (const [l, hint] of [
      [{ ...line, text: '{国:99999}亡' }, '指不到'],
      [{ ...line, text: '{国:abc}亡' }, '认不出的占位符'],
      [{ ...line, text: 'p1' }, '私用区的字'],
      [{ ...line, by: 'Bad' }, '插件编号'],
      [{ ...line, year: civ.endYear + 1 }, '年份'],
      [{ ...line, more: 1 }, '认不出的键'],
    ] as const) {
      expect(check({ ...civ, simChronicle: [l as any] }), hint).toThrow(WorldFileError);
    }
    expect(check({ ...civ, simLayers: [civ.simLayers![0], civ.simLayers![0]] }), '图层重了').toThrow(WorldFileError);
    expect(check({ ...civ, simLayers: [{ ...civ.simLayers![0], years: undefined as any }] }), '没年份').toThrow(WorldFileError);
  });
});

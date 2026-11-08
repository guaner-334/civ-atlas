/**
 * 世界文件里推演插件的状态(sim.<插件编号> 那几块,gen/worldFormat.ts 的 SIM_STATE_PREFIX):
 * 存的时候从历史里拆出来、读的时候接回去,读回来接着推和一口气推完一样;逐项核对,不算只当字节留着的块;
 * 另存换了历史时跟着换;坏了的本机读时不要(接着推时从第 0 年重推),传上服务器的文件照旧算坏
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { isDeepStrictEqual } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { generateCiv, startContinue, type Civ } from '../src/gen/civ';
import { chronicleBlock } from '../src/gen/civ/story/nameTokens';
import { flagBook } from '../src/gen/civ/story/flags';
import { makeSave, worldCheck } from '../src/gen/savefile';
import { makePart, packValue, recipeKey, recipeOfSave, sha256 } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { opaqueParts, openStoredParts, openWorldFile, packWorldFile, readTrustedParts, readWorldContent, rewriteWorldFile, type OpenedWorldFile, type PackInput, type PackedPart } from '../src/gen/worldFile';
import { _resetVault, adoptFile, stateOf } from '../src/worldVault';
import { openStoredWorld } from '../src/worldOpen';
import { SIM_STATE_MAX_BYTES, WorldFileError } from '../src/gen/worldFormat';
import { parseManifest, validateSimState } from '../src/gen/worldValidate';
import { ZIP_UPLOAD_MAX_BYTES } from '../src/gen/zipStore';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { MADE, READERS, bytesOf } from './lib/worldFileSample';
import { chain, ledger } from './lib/simPlugins';

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPEN = { readers: READERS };
const params = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
const plugins = [ledger(), chain()];
let world: World;
let civ: Civ;

const bytes = (v: unknown) => Buffer.from(packValue(v));

function input(c: Civ): PackInput {
  return {
    id: 'wsim',
    title: '插件世界',
    made: MADE,
    readers: READERS,
    recipe: makeSave(params, { names: {}, interventions: [], terrain: [], upheavals: [] }, worldCheck(world), '插件世界', '2026-11-08T08:00:00.000Z', { projection: 'robinson', center: 120 }),
    map: world,
    civ: c,
    chronicle: chronicleBlock(c),
    flags: flagBook(world, c),
  };
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

describe('世界文件里推演插件的状态', () => {
  it('一个插件一块,按插件的先后排在作者内容、封面之后;历史那一块不带它;读回来接上,不算只当字节留着的块', async () => {
    const f = await packWorldFile({ ...input(civ), thumb: undefined });
    const opened = await openWorldFile(await bytesOf(f), OPEN);
    const names = opened.manifest.parts.map((p) => p.name);
    expect(names).toEqual(['map', 'civ', 'chronicle', 'flags', 'sim.ledger', 'sim.chain']);
    expect(opened.manifest.parts[4]).toMatchObject({ file: 'parts/sim.ledger.gz', schema: 1, need: 'extra', by: 'ledger' });
    expect(opened.kept).toEqual([]);
    expect(opaqueParts(opened.manifest.parts)).toEqual([]);
    const partsOf = (o: OpenedWorldFile, keep: (name: string) => boolean): PackedPart[] => o.manifest.parts.filter((p) => keep(p.name)).map((info) => ({ info, data: o.bytes.get(info.name)! }));
    // 历史那一块本身不带状态;状态块也在手边时才接回去
    const viewOnly = openStoredParts(opened.manifestBytes, partsOf(opened, (n) => !n.startsWith('sim.')), OPEN);
    expect('simPlugins' in ((await readTrustedParts(viewOnly, ['civ'])).civ as Civ)).toBe(false);
    const all = openStoredParts(opened.manifestBytes, partsOf(opened, () => true), OPEN);
    expect(bytes(((await readTrustedParts(all, ['civ'])).civ as Civ).simPlugins).equals(bytes(civ.simPlugins))).toBe(true);
    const c = await readWorldContent(opened);
    expect(c.skipped).toEqual([]);
    expect(bytes(c.civ.simPlugins).equals(bytes(civ.simPlugins))).toBe(true);
    expect(civDiff(c.civ, civ)).toBeNull();
  }, 60_000);

  it('读回来接着推,和一口气推完一样', async () => {
    const c = await read(await packWorldFile(input(civ)));
    const run = startContinue(world, c.civ, { plugins, endYear: 2500 });
    expect(run).not.toBeNull();
    const one = generateCiv(world, { plugins, endYear: 2500 });
    const got = run!.finish();
    expect(civDiff(got, one)).toBeNull();
    expect(bytes(got.simPlugins).equals(bytes(one.simPlugins))).toBe(true);
  }, 60_000);

  it('没用推演插件的世界:没有这种块,文件和以前一样', async () => {
    const plain = generateCiv(world, { endYear: 1200 });
    const f = await bytesOf(await packWorldFile(input(plain)));
    const opened = await openWorldFile(f, OPEN);
    expect(opened.manifest.parts.map((p) => p.name)).toEqual(['map', 'civ', 'chronicle', 'flags']);
    expect('simPlugins' in (await readWorldContent(opened)).civ).toBe(false);
  }, 60_000);

  it('另存:换了历史,状态块跟着换(去掉插件就去掉);只改名的,状态块连字节都不动', async () => {
    const opened = await openWorldFile(await bytesOf(await packWorldFile(input(civ))), OPEN);
    const later = generateCiv(world, { endYear: 1500, plugins: [chain()] });
    const swapped = await openWorldFile(await bytesOf(await rewriteWorldFile(opened, { values: { civ: later, chronicle: chronicleBlock(later), flags: flagBook(world, later) } })), OPEN);
    expect(swapped.manifest.parts.filter((p) => p.name.startsWith('sim.')).map((p) => p.name)).toEqual(['sim.chain']);
    expect(bytes((await readWorldContent(swapped)).civ.simPlugins).equals(bytes(later.simPlugins))).toBe(true);
    const plain = generateCiv(world, { endYear: 1500 });
    const dropped = await openWorldFile(await bytesOf(await rewriteWorldFile(opened, { values: { civ: plain, chronicle: chronicleBlock(plain), flags: flagBook(world, plain) } })), OPEN);
    expect(dropped.manifest.parts.some((p) => p.name.startsWith('sim.'))).toBe(false);
    const renamed = await openWorldFile(await bytesOf(await rewriteWorldFile(opened, { title: '改个名' })), OPEN);
    for (const n of ['sim.ledger', 'sim.chain']) {
      expect(renamed.manifest.parts.find((p) => p.name === n)).toEqual(opened.manifest.parts.find((p) => p.name === n));
      expect(isDeepStrictEqual(renamed.bytes.get(n), opened.bytes.get(n))).toBe(true);
    }
  }, 60_000);

  it('状态坏了:本机读时这几块都不要,记进 skipped;传上服务器的文件算坏', async () => {
    const bad: Civ = { ...civ, simPlugins: [civ.simPlugins![0], { ...civ.simPlugins![1], note: { a: 'x' } as any }] };
    const f = await bytesOf(await packWorldFile(input(bad)));
    const c = await read(f);
    expect(c.skipped).toEqual(['sim.ledger', 'sim.chain']);
    expect('simPlugins' in c.civ).toBe(false);
    await expectBroken(() => read(f, ZIP_UPLOAD_MAX_BYTES), '传上服务器');
  }, 60_000);

  it('清单里的规矩:块名是插件编号、只能是可选的、by 写同一个插件、不超过上限;结构比软件新的只当字节留着', async () => {
    const opened = await openWorldFile(await bytesOf(await packWorldFile(input(civ))), OPEN);
    const m = opened.manifest;
    const at = m.parts.findIndex((p) => p.name === 'sim.ledger');
    const changed = (over: Record<string, unknown>) => {
      const x = structuredClone(m) as any;
      Object.assign(x.parts[at], over);
      return new TextEncoder().encode(JSON.stringify(x));
    };
    for (const over of [{ need: 'view' }, { by: 'chain' }, { by: undefined }, { name: 'sim.Bad', file: 'parts/simbad.gz' }, { bytes: SIM_STATE_MAX_BYTES + 1 }]) {
      expect(() => parseManifest(changed(over), OPEN), JSON.stringify(over)).toThrow(WorldFileError);
    }
    const newer = parseManifest(changed({ schema: 2 }), OPEN);
    expect(opaqueParts(newer.parts)).toEqual(['sim.ledger']);
  }, 60_000);

  it('历史那一块里带着状态的(没拆开存的)也逐项核对;两处都有算坏', async () => {
    const opened = await openWorldFile(await bytesOf(await packWorldFile(input(civ))), OPEN);
    const inCiv = async (c: Civ, keepSims: boolean) => {
      const part = await makePart('civ', c);
      const parts = opened.manifest.parts.filter((p) => keepSims || !p.name.startsWith('sim.')).map((p) => (p.name === 'civ' ? { ...p, sum: part.sum, bytes: part.bytes, zip: part.zip } : p));
      const bytesMap = new Map(opened.bytes);
      bytesMap.set('civ', part.data instanceof Uint8Array ? part.data : new Uint8Array(part.data));
      return readWorldContent({ ...opened, manifest: { ...opened.manifest, parts }, bytes: bytesMap });
    };
    const ok = await inCiv(civ, false);
    expect(bytes(ok.civ.simPlugins).equals(bytes(civ.simPlugins))).toBe(true);
    await expectBroken(() => inCiv({ ...civ, simPlugins: [{ ...civ.simPlugins![0], year: 'x' as any }] }, false), '历史里的状态坏了');
    await expectBroken(() => inCiv(civ, true), '两处都有');
  }, 60_000);

  it('本机仓库:收下带状态块的文件,第一次打开(逐项校验)和以后再打开(只核指纹)都接回状态', async () => {
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    _resetVault();
    const inp = input(civ);
    const file = await packWorldFile(inp);
    const opened = await openWorldFile(await bytesOf(file), OPEN);
    const key = await recipeKey(recipeOfSave(inp.recipe));
    await adoptFile({ id: 'wsim', file, sum: await sha256(opened.manifestBytes), recipeKey: key, generator: inp.recipe.generator, readers: READERS });
    const ask = { id: 'wsim', recipe: key, generator: inp.recipe.generator };
    const first = await openStoredWorld(ask);
    expect(bytes(first.civ!.simPlugins).equals(bytes(civ.simPlugins))).toBe(true);
    expect((await stateOf('wsim'))?.checked).toBeTruthy();
    const again = await openStoredWorld(ask);
    expect(bytes(again.civ!.simPlugins).equals(bytes(civ.simPlugins))).toBe(true);
    _resetVault();
  }, 60_000);

  it('核对状态:认不出的键、字、不是数、事件写坏、表的名字不合规矩都算坏', () => {
    const s = civ.simPlugins![0];
    expect(() => validateSimState(s, 'ledger')).not.toThrow();
    const bad = (x: unknown, hint: string) => expect(() => validateSimState(x, 'ledger'), hint).toThrow(WorldFileError);
    bad({ ...s, id: 'other' }, 'id');
    bad({ ...s, sig: -1 }, '指纹');
    bad({ ...s, extra: 1 }, '认不出的键');
    bad({ ...s, note: { a: 'x' } }, '字');
    bad({ ...s, note: [Infinity] }, '不是有限的数');
    bad({ ...s, events: new Float64Array([1, 0, 0, 5]) }, '事件少了数');
    bad({ ...s, events: [1, 0, 0, 0] }, '事件不是数组');
    const t = s.tables!;
    bad({ ...s, tables: { ...t, tables: { ...t.tables, 'bad name': t.tables.magic } } }, '表名');
    bad({ ...s, tables: { ...t, tables: { ...t.tables, magic: { ...t.tables.magic, disabled: 1 } } } }, '真假');
    bad({ ...s, tables: { ...t, polityAnchor: new Int32Array(t.polityCount + 1) } }, '国的个数');
  });
});

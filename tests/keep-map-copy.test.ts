/**
 * 另存一份,地图不变(src/ui/worldStore.ts 的 keepMapCopy,gen/edits.ts 文件头"地图留着的世界"):用存下的地图按现在的规则从第 0 年推,
 * 新世界以后重推、改名、复制、存成文件再打开,地图都不按种子重新长;原来那份一个字不动;普通世界不受影响。
 *
 * 样本的地图动过几个地块:现在的生成器长不出它,按种子重新长的话一比就露馅(这个版本的代码不能真的长出旧地图;升版本的试验见 scripts/keep-map-check.ts)。
 * IndexedDB 用 fake-indexeddb,后台线程换成直接调。真的走线程、打开世界的几条路在浏览器里查,见 scripts/keep-map-check.ts。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { putNote } from '../src/ai/library';
import { _notesSettled, _resetNotes } from '../src/ai/libraryVault';
import { generateCiv, type Civ } from '../src/gen/civ';
import { mergeUpheavals } from '../src/gen/civ/upheaval';
import { EMPTY_EDITS, GENERATOR_VERSION, cleanMapRef, keptMapOf, sameMapRef, type Upheaval, type WorldEdits } from '../src/gen/edits';
import { FIRST_READERS, READER_VERSIONS } from '../src/gen/readers/versions';
import { SAVE_FORMAT, makeSave, parseSave, saveFormatOf, saveText, type SaveFile } from '../src/gen/savefile';
import { makePart, partOf, readLocalPart, recipeKey, recipeOfSave, recipeText, type Snapshot, type SnapshotPart } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, type World } from '../src/gen/world';
import type { WorldEras } from '../src/gen/worldFile';
import { validateCiv } from '../src/gen/worldValidate';
import { mapChoices, worldHere } from '../src/ui/compare/compareMaps';
import { clearEdits, setEdits } from '../src/ui/editsStore';
import { helperJob } from '../src/ui/helperWork';
import { _setResultBackend, memoryResults } from '../src/ui/resultStore';
import * as saveStore from '../src/ui/saveStore';
import { openWorldFromFile, saveWorldFile, _setWorldFiles } from '../src/ui/worldFiles';
import { _setWorldStore, _settled, keepMapCopy, offerWorldParts, settleKeptWorld, type KeptMapCopy } from '../src/ui/worldStore';
import { recomputeWorld, runConvert, type ConvertJob } from '../src/worldConvert';
import { lookFile } from '../src/worldFileLook';
import { openStoredWorld } from '../src/worldOpen';
import { keyOf, worldChronicle, worldFlags } from '../src/worldRun';
import { _resetVault, changeAuthor, commitWorld, latestOf, purgeWorld, readAuthor, readRevision, revisionsOf, stateOf, vaultOps, type VaultOps } from '../src/worldVault';
import { FIXTURE_DIR, readSamples, type SampleInfo } from './lib/savedWorlds';

class FakeStorage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

const g = globalThis as unknown as { localStorage?: unknown; indexedDB: IDBFactory };
const direct = ((op: keyof VaultOps, args: unknown[]) => (vaultOps[op] as (...a: unknown[]) => Promise<unknown>)(...args)) as Parameters<typeof _setWorldStore>[0]['caller'];
const OLD_GENERATOR = GENERATOR_VERSION - 1;
const SAMPLES = readSamples();
const PLAIN = SAMPLES.find((s) => !s.upheavals.length)!;
const UPS = SAMPLES.find((s) => s.upheavals.length)!;

function resetAll() {
  g.localStorage = new FakeStorage();
  g.indexedDB = new IDBFactory();
  _resetVault();
  saveStore._resetForTest();
  clearEdits();
  _setResultBackend(memoryResults());
  _setWorldStore({ caller: direct, runner: (job: ConvertJob) => ({ done: runConvert(job).then((result) => ({ ok: true as const, result }), (e: Error & { kind?: string }) => ({ ok: false as const, kind: (e.kind ?? 'failed') as 'failed', message: e.message })), stop: () => {} }), timing: { quiet: 0, poll: 1, pause: 0 } });
  _setWorldFiles({ once: direct!, look: (file: Blob) => lookFile(file, { readers: READER_VERSIONS }) });
}

beforeEach(resetAll);
afterEach(async () => {
  saveStore.detachWorld();
  await _settled();
  _resetVault();
});

/** 读样本文件 */
function samplePart(s: SampleInfo, name: string): SnapshotPart {
  const p = s.parts.find((x) => x.name === name)!;
  const b = readFileSync(join(FIXTURE_DIR, p.file));
  return { name: p.name, bytes: p.bytes, sum: p.sum, zip: p.zip, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer } as SnapshotPart;
}

const paramsOf = (s: SampleInfo) => ({ ...DEFAULT_PARAMS, seed: s.seed, cells: s.cells });

/** 把一张地图的陆地气温动一下:现在的生成器长不出它 */
function oldMap(map: World): World {
  const temp = (map.temperature as Float32Array).slice();
  for (let i = 0; i < temp.length; i += 7) temp[i] += 3;
  return { ...map, temperature: temp };
}

interface OldWorld {
  id: string;
  save: SaveFile;
  map: World;
  mapSum: string;
  eras: WorldEras | null;
  civ: Civ;
}

/**
 * 仓库里放一个旧版本的世界(存档、修订都记着上一版生成器、第 1 版读取代码)。地图动过,历史用样本里的(是别的规则算的);带地形大事的各段世界也动过
 */
async function putOldWorld(s: SampleInfo, edits: Partial<WorldEdits> = {}): Promise<OldWorld> {
  const params = paramsOf(s);
  const map = oldMap((await readLocalPart(samplePart(s, 'map'))) as World);
  const civ = (await readLocalPart(samplePart(s, 'civ'))) as Civ;
  const stored = (await readLocalPart(samplePart(s, 'eras'))) as WorldEras;
  const ups = s.upheavals as Upheaval[];
  const save: SaveFile = { ...makeSave(params, { ...EMPTY_EDITS, endYear: s.endYear, ...(ups.length ? { upheavals: ups } : {}), ...edits }, '', '老世界', '2026-11-01T00:00:00.000Z'), generator: OLD_GENERATOR };
  const id = saveStore.importSave(save)!;
  const kept = saveStore.loadWorld(id)!.save;
  const baseKey = keyOf(params, [], undefined);
  let all = [] as Upheaval['ops'];
  const eras: WorldEras | null = ups.length
    ? {
        baseKey,
        eras: mergeUpheavals(ups).map((m, i) => {
          all = [...all, ...m.ops];
          return { ...stored.eras[i], key: keyOf(params, all, undefined), world: oldMap(stored.eras[i].world as World) };
        }),
      }
    : null;
  const mapPart = await makePart('map', map);
  const parts = [mapPart, ...(eras ? [await makePart('eras', eras)] : []), await makePart('civ', civ), await makePart('chronicle', worldChronicle(civ, undefined)), await makePart('flags', worldFlags(map, civ))];
  await commitWorld({ id, recipe: kept, recipeKey: await recipeKey(recipeOfSave(kept)), parts, made: { app: '1.4.0', generator: OLD_GENERATOR, commit: '', at: '2026-11-01T08:00:00.000Z' }, readers: { ...FIRST_READERS }, source: 'migrated' });
  return { id, save: kept, map, mapSum: mapPart.sum, eras, civ };
}

const okCopy = (r: KeptMapCopy) => {
  if (!r.ok) throw new Error(`另存没成:${r.kind} ${r.message}`);
  return r;
};

const openOf = async (id: string) => {
  const save = saveStore.loadWorld(id)!.save;
  return openStoredWorld({ id, recipe: await recipeKey(recipeOfSave(save)), generator: save.generator });
};

/** 这张地图上按现在的规则推:和新世界存下的历史比 */
const civOn = (w: World, seed: number, endYear: number, more: object = {}) => generateCiv(w, { civSeed: seed, placeRef: false, endYear, ...more });
const sumOfCiv = async (civ: Civ) => (await makePart('civ', civ)).sum;
const partSum = async (id: string, name: string) => (await readRevision(id))!.manifest.parts.find((p) => p.name === name)?.sum;

describe('另存一份,地图不变', () => {
  it('地图的块原样拿来,历史按现在的规则从第 0 年推,读取版本记对;原来那份的存档、修订一个字不动', async () => {
    const old = await putOldWorld(PLAIN);
    const before = { save: JSON.stringify(saveStore.loadWorld(old.id)!.save), heads: JSON.stringify(await revisionsOf(old.id)), text: new TextDecoder().decode((await readRevision(old.id))!.text) };

    const { id } = okCopy(await keepMapCopy(old.id));

    // 新世界的配方
    const save = saveStore.loadWorld(id)!.save;
    expect(id).not.toBe(old.id);
    expect(save.title).toBe('老世界（新版）');
    expect(save.generator).toBe(GENERATOR_VERSION);
    expect(save.format).toBe(5);
    expect(save.edits.map).toEqual({ sum: old.mapSum, from: old.id, grown: OLD_GENERATOR });
    expect(save.edits.civSeed).toBe(PLAIN.seed);
    expect(keptMapOf(save.edits)).toBe(old.mapSum);

    // 新世界的内容:地图还是那一块,读取版本对,历史是现在的规则在这张地图上推的
    const rev = (await readRevision(id))!;
    expect(rev.manifest.parts.find((p) => p.name === 'map')!.sum).toBe(old.mapSum);
    expect(rev.manifest.readers).toEqual({ terrain: FIRST_READERS.terrain, query: READER_VERSIONS.query });
    expect(rev.head.generator).toBe(GENERATOR_VERSION);
    const opened = await openOf(id);
    expect(isDeepStrictEqual(opened.world, old.map)).toBe(true);
    const expected = civOn(old.map, PLAIN.seed, PLAIN.endYear);
    expect(await sumOfCiv(opened.civ!)).toBe(await sumOfCiv(expected));
    expect(await sumOfCiv(opened.civ!)).not.toBe(await sumOfCiv(old.civ));
    validateCiv(opened.civ!, opened.world);

    // 原来那份
    expect(JSON.stringify(saveStore.loadWorld(old.id)!.save)).toBe(before.save);
    expect(JSON.stringify(await revisionsOf(old.id))).toBe(before.heads);
    expect(new TextDecoder().decode((await readRevision(old.id))!.text)).toBe(before.text);
    const still = await openOf(old.id);
    expect(isDeepStrictEqual(still.world, old.map)).toBe(true);
    expect(await sumOfCiv(still.civ!)).toBe(await sumOfCiv(old.civ));
  }, 120_000);

  it('带地形大事的:大事照旧,大事以后的各段世界也是存下的那几段', async () => {
    const old = await putOldWorld(UPS);
    const { id } = okCopy(await keepMapCopy(old.id));
    expect(await partSum(id, 'eras')).toBe(await partSum(old.id, 'eras'));
    expect(await partSum(id, 'map')).toBe(old.mapSum);
    const save = saveStore.loadWorld(id)!.save;
    expect(save.edits.upheavals).toEqual(UPS.upheavals);
    const opened = await openOf(id);
    expect(isDeepStrictEqual(opened.eras, old.eras)).toBe(true);
    const steps = mergeUpheavals(UPS.upheavals as Upheaval[]).map((m, i) => ({ ...m, world: { ...old.eras!.eras[i].world, mesh: old.map.mesh } as World }));
    expect(await sumOfCiv(opened.civ!)).toBe(await sumOfCiv(civOn(old.map, UPS.seed, UPS.endYear, { upheavals: steps })));
  }, 120_000);

  it('存下的内容里少一段地形大事:报错,不长,也不留一个打不开的世界', async () => {
    const old = await putOldWorld(UPS);
    const count = saveStore.listWorlds().length;
    const r = await keepMapCopy(old.id, { edits: { ...old.save.edits, upheavals: [...(old.save.edits.upheavals ?? []), { year: 900, ops: [{ kind: 'volcano', pts: [812, 403], r: 60, s: 1.5 }] }] } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('少一段');
    expect(saveStore.listWorlds().length).toBe(count);
  }, 120_000);

  it('作者的干预、改名放不进新历史的:和重推一样跳过,修改照留,推得出来', async () => {
    const edits: Partial<WorldEdits> = {
      names: { 'polity:c999999#0': '不存在的国' },
      interventions: [{ kind: 'protect', a: 'c999999#0', from: 100, until: 600 }],
      marks: [{ id: 1, title: '记号', color: 'red', from: 10, at: [10, 10] }] as WorldEdits['marks'],
    };
    const old = await putOldWorld(PLAIN, edits);
    const { id } = okCopy(await keepMapCopy(old.id));
    const save = saveStore.loadWorld(id)!.save;
    expect(save.edits.names).toEqual(edits.names);
    expect(save.edits.interventions).toEqual(edits.interventions);
    expect(save.edits.marks?.length).toBe(1);
    expect((await openOf(id)).world.params.seed).toBe(PLAIN.seed);
  }, 120_000);

  it('读不懂的旧地图:报错,不算出一个怪东西;没有存下地图的、没建完的、没有的世界不另存', async () => {
    const old = await putOldWorld(PLAIN);
    // 少了地图上的一样东西
    const { temperature: _t, ...broken } = old.map as World & { temperature: unknown };
    void _t;
    const save = saveStore.loadWorld(old.id)!.save;
    await commitWorld({ id: old.id, recipe: save, recipeKey: await recipeKey(recipeOfSave(save)), parts: [await makePart('map', broken), await makePart('civ', old.civ), await makePart('chronicle', { entries: [] }), await makePart('flags', { eras: [] })], made: { app: '1.4.0', generator: OLD_GENERATOR, commit: '', at: '2026-11-01T08:00:00.000Z' }, readers: { ...FIRST_READERS } });
    const count = saveStore.listWorlds().length;
    const r = await keepMapCopy(old.id);
    expect(r).toMatchObject({ ok: false, kind: 'failed' });
    expect(saveStore.listWorlds().length).toBe(count);

    // 旧版本、仓库里没有内容
    const bare = saveStore.importSave({ ...makeSave(paramsOf(PLAIN), EMPTY_EDITS, '', '只有配方'), generator: OLD_GENERATOR })!;
    expect(await keepMapCopy(bare)).toMatchObject({ ok: false, kind: 'nomap' });
    expect(await keepMapCopy('没有这个')).toMatchObject({ ok: false, kind: 'missing' });
    expect(saveStore.listWorlds().length).toBe(count + 1);
  }, 120_000);

  it('AI 写的东西跟着复制', async () => {
    const old = await putOldWorld(PLAIN);
    _resetNotes({ vault: { read: readAuthor, change: changeAuthor } });
    putNote(old.id, { key: '史书:world', kind: '史书', title: '一本史书', text: '正文', createdAt: '2026-11-04T08:00:00.000Z', provider: 'test', model: 'test-1' });
    const r = okCopy(await keepMapCopy(old.id));
    expect(r.notes).toBe(true);
    expect((await readRevision(r.id))!.manifest.parts.some((p) => p.name === 'author')).toBe(true);
    await _notesSettled();
    _resetNotes({ vault: null });
  }, 120_000);
});

describe('新世界以后再改,地图都不按种子重新长', () => {
  it('配方变了(加了干预、重推没推完就关了):打开前按存下的地图算一遍,地图还是那一块', async () => {
    const old = await putOldWorld(PLAIN);
    const { id } = okCopy(await keepMapCopy(old.id));
    const first = (await latestOf(id))!;
    const save = saveStore.loadWorld(id)!.save;
    const opened = await openOf(id);
    const a = opened.civ!.polities[0].id;
    const next: WorldEdits = { ...save.edits, interventions: [{ kind: 'protect', a: `c${a}#0`, from: 100, until: 600 }] };
    expect(saveStore.overwriteWorld(id, next)).toBe(true);
    expect(await settleKeptWorld(id)).toBe(true);
    const now = (await latestOf(id))!;
    expect(now.n).toBeGreaterThan(first.n);
    expect(await partSum(id, 'map')).toBe(old.mapSum);
    expect((await readRevision(id))!.manifest.readers).toEqual({ terrain: FIRST_READERS.terrain, query: READER_VERSIONS.query });
    expect(isDeepStrictEqual((await openOf(id)).world, old.map)).toBe(true);

    // 线程重开过要重新钉住:配方已经不是打开时那一份了,地图照样读得到
    const ask = { id, recipe: await recipeKey(recipeOfSave(save)), generator: GENERATOR_VERSION };
    await expect(openStoredWorld(ask)).rejects.toMatchObject({ why: 'recompute' });
    expect(isDeepStrictEqual((await openStoredWorld(ask, false, true)).world, old.map)).toBe(true);
  }, 120_000);

  it('改名:只写新清单,地图、读取版本不变', async () => {
    const old = await putOldWorld(PLAIN);
    const { id } = okCopy(await keepMapCopy(old.id));
    saveStore.renameWorld(id, '换个名字');
    expect(await settleKeptWorld(id)).toBe(true);
    const rev = (await readRevision(id))!;
    expect(rev.manifest.title).toBe('换个名字');
    expect(rev.manifest.parts.find((p) => p.name === 'map')!.sum).toBe(old.mapSum);
    expect(rev.manifest.readers).toEqual({ terrain: FIRST_READERS.terrain, query: READER_VERSIONS.query });
  }, 120_000);

  it('换一版规则另存(打造文明那条路):存档记着地图,打开前按存下的地图推,大事不带就不带各段世界', async () => {
    const old = await putOldWorld(UPS);
    const { id } = okCopy(await keepMapCopy(old.id));
    const save = saveStore.loadWorld(id)!.save;
    const { upheavals: _u, ...rest } = save.edits;
    void _u;
    const rules = { id: 'r1', name: '乱世', values: { 'war.odds': 2 } } as unknown as WorldEdits['rules'];
    const nid = saveStore.saveAsNewVersion(id, { ...rest, rules }, '换了规则')!;
    expect(await settleKeptWorld(nid)).toBe(true);
    const rev = (await readRevision(nid))!;
    expect(rev.manifest.parts.find((p) => p.name === 'map')!.sum).toBe(old.mapSum);
    expect(rev.manifest.parts.some((p) => p.name === 'eras')).toBe(false);
    expect(saveStore.loadWorld(nid)!.save.title).toBe('换了规则');
    expect(isDeepStrictEqual((await openOf(nid)).world, old.map)).toBe(true);
    expect((await readRevision(id))!.manifest.parts.some((p) => p.name === 'eras')).toBe(true);
  }, 120_000);

  it('线程交回来的内容:按世界记的读取版本、地图的结构版本存', async () => {
    const old = await putOldWorld(PLAIN);
    const { id } = okCopy(await keepMapCopy(old.id));
    const stored = saveStore.loadWorld(id)!;
    setEdits(stored.save.edits);
    saveStore.attachWorld({ id, params: stored.save.params, check: 'x', kind: 'created', saved: stored.save.edits });
    const recipe = await recipeKey(recipeOfSave(saveStore.loadWorld(id)!.save));
    const parts = [await makePart('map', old.map), await makePart('civ', old.civ), await makePart('chronicle', worldChronicle(old.civ, undefined)), await makePart('flags', worldFlags(old.map, old.civ))];
    expect(await offerWorldParts({ generator: GENERATOR_VERSION, recipe, parts, readers: { terrain: FIRST_READERS.terrain, query: READER_VERSIONS.query }, schemas: { map: 1 } })).toBe(true);
    const rev = (await readRevision(id))!;
    expect(rev.manifest.readers).toEqual({ terrain: FIRST_READERS.terrain, query: READER_VERSIONS.query });
    expect(rev.manifest.parts.find((p) => p.name === 'map')).toMatchObject({ sum: old.mapSum, schema: 1 });
  }, 120_000);

  it('复制出来的:第一次打开前从存着那张地图的世界拿,原来那个世界删了也行', async () => {
    const old = await putOldWorld(PLAIN);
    const { id } = okCopy(await keepMapCopy(old.id));
    saveStore.deleteWorld(old.id);
    await purgeWorld(old.id);
    const dup = saveStore.duplicateWorld(id)!;
    expect(await latestOf(dup)).toBeNull();
    expect(await settleKeptWorld(dup)).toBe(true);
    expect(await partSum(dup, 'map')).toBe(old.mapSum);
    expect(isDeepStrictEqual((await openOf(dup)).world, old.map)).toBe(true);
  }, 120_000);

  it('同一张地图有好几个世界存着:找得到要的各段世界才用,不合适的接着找', async () => {
    const old = await putOldWorld(UPS);
    const { id } = okCopy(await keepMapCopy(old.id));
    const save = saveStore.loadWorld(id)!.save;
    // 同一张地图、大事去掉的一份:没有各段世界
    const { upheavals: _u, ...rest } = save.edits;
    void _u;
    const bare = okCopy(await keepMapCopy(id, { edits: rest, title: '没有大事' }));
    expect((await readRevision(bare.id))!.manifest.parts.some((p) => p.name === 'eras')).toBe(false);
    saveStore.deleteWorld(old.id);
    await purgeWorld(old.id);
    const dup = saveStore.duplicateWorld(id)!;
    const dupSave = saveStore.loadWorld(dup)!.save;
    // 先碰到没有各段世界的那一份
    await runConvert({ kind: 'keptMap', id: dup, save: dupSave, from: [dup, old.id, bare.id, id], app: 'x', commit: '' });
    expect(await partSum(dup, 'eras')).toBe(await partSum(id, 'eras'));
    expect(await partSum(dup, 'map')).toBe(old.mapSum);
    // 哪一份都没有:报少一段
    const out = await runConvert({ kind: 'keptMap', id: dup, save: dupSave, from: [bare.id], app: 'x', commit: '' }).then(
      () => 'saved',
      (e: Error) => e.message,
    );
    expect(out).toContain('少一段');
  }, 120_000);

  it('存成文件,换一个什么都没有的浏览器打开:没有原世界也能开,地图不变;再按存下的地图重推也行', async () => {
    const old = await putOldWorld(PLAIN);
    const { id } = okCopy(await keepMapCopy(old.id));
    const civSum = await sumOfCiv((await openOf(id)).civ!);
    const out = await saveWorldFile(id);
    if (!out.ok) throw new Error(out.message);

    resetAll();
    const placed = await openWorldFromFile(out.file);
    if (!placed.ok) throw new Error(placed.message);
    const again = (placed as unknown as { id: string }).id;
    const save = saveStore.loadWorld(again)!.save;
    expect(keptMapOf(save.edits)).toBe(old.mapSum);
    const opened = await openOf(again);
    expect(isDeepStrictEqual(opened.world, old.map)).toBe(true);
    expect(await sumOfCiv(opened.civ!)).toBe(civSum);
    expect(opened.readers).toEqual({ terrain: FIRST_READERS.terrain, query: READER_VERSIONS.query });

    // 改配方:自己存着地图
    expect(saveStore.overwriteWorld(again, { ...save.edits, endYear: 800 })).toBe(true);
    expect(await settleKeptWorld(again)).toBe(true);
    expect(await partSum(again, 'map')).toBe(old.mapSum);
  }, 120_000);

  it('只有配方(分享链接、存档文件、别的设备同步来的):找不到地图就算不出来,不按种子长', async () => {
    const old = await putOldWorld(PLAIN);
    const { id } = okCopy(await keepMapCopy(old.id));
    const text = saveText(saveStore.loadWorld(id)!.save);

    resetAll();
    const r = parseSave(text);
    if (!r.ok) throw new Error(r.error);
    expect(keptMapOf(r.save.edits)).toBe(old.mapSum);
    const nid = saveStore.importSave(r.save)!;
    expect(await settleKeptWorld(nid)).toBe(false);
    expect(await latestOf(nid)).toBeNull();
    expect((await stateOf(nid))?.status).toBe('failed');
    expect(() => recomputeWorld(r.save)).toThrow('不按种子');
    // 别的线程上按存档长地图的几条路
    expect(() => helperJob({ kind: 'world', save: r.save } as Parameters<typeof helperJob>[0])).toThrow('存下来的');
    const world = { params: r.save.params, title: 'x' };
    expect(worldHere(true, world, r.save.edits)).toBeNull();
    const stored = saveStore.listWorlds().filter((w) => w.id === nid);
    expect(stored.length).toBe(1);
    // 只剩默认那张(种子 7 的地图),这个世界的不列
    expect(mapChoices(null, stored).length).toBe(1);
  }, 120_000);

  it('存着的地图和配方记的对不上:打开时不认', async () => {
    const old = await putOldWorld(PLAIN);
    const { id } = okCopy(await keepMapCopy(old.id));
    const save = saveStore.loadWorld(id)!.save;
    const bad: SaveFile = { ...save, edits: { ...save.edits, map: { ...save.edits.map!, sum: 'a'.repeat(64) } } };
    const out = await runConvert({ kind: 'keptMap', id, save: bad, from: [id], app: 'x', commit: '' }).then(
      () => 'saved',
      (e: Error) => e.message,
    );
    expect(out).toContain('地图不在仓库里');
  }, 120_000);
});

describe('记录和配方', () => {
  it('普通世界的配方、格式和以前一样;记了地图才是格式 5,读回来还在', async () => {
    const plain = makeSave(paramsOf(PLAIN), EMPTY_EDITS, 'c', 't', '2026-11-01T00:00:00.000Z');
    expect(plain.format).toBe(1);
    const r = recipeOfSave(plain);
    expect(r.keptMap).toBeUndefined();
    expect(recipeText(r)).not.toContain('keptMap');
    // 新开的历史只记地图的校验、出处,也是普通世界
    const sum = 'b'.repeat(64);
    const fresh = makeSave(paramsOf(PLAIN), { ...EMPTY_EDITS, civSeed: 3, map: { sum, from: 'w1' } }, 'c');
    expect(fresh.format).toBe(1);
    expect(keptMapOf(fresh.edits)).toBeUndefined();
    expect(recipeText(recipeOfSave(fresh))).not.toContain(sum);

    const kept = makeSave(paramsOf(PLAIN), { ...EMPTY_EDITS, civSeed: 7, map: { sum, from: 'w1', grown: 19 } }, 'c');
    expect(kept.format).toBe(5);
    expect(SAVE_FORMAT).toBe(5);
    expect(saveFormatOf(kept.edits)).toBe(5);
    expect(recipeOfSave(kept).keptMap).toBe(sum);
    expect(await recipeKey(recipeOfSave(kept))).not.toBe(await recipeKey(recipeOfSave({ ...kept, edits: { ...kept.edits, map: { sum, from: 'w1' } } })));
    const back = parseSave(saveText(kept));
    if (!back.ok) throw new Error(back.error);
    expect(back.save.edits.map).toEqual({ sum, from: 'w1', grown: 19 });
    expect(back.save.format).toBe(5);
  });

  it('记录清理:版本号不对、没有校验的不算地图留着的', () => {
    const sum = 'c'.repeat(64);
    expect(cleanMapRef({ sum, grown: 19 })).toEqual({ sum, grown: 19 });
    expect(cleanMapRef({ sum, grown: 0 })).toEqual({ sum });
    expect(cleanMapRef({ sum, grown: 1.5 })).toEqual({ sum });
    expect(cleanMapRef({ sum, grown: '19' })).toEqual({ sum });
    expect(cleanMapRef({ from: 'w', grown: 19 })).toEqual({ from: 'w' });
    expect(keptMapOf({ map: { from: 'w', grown: 19 } })).toBeUndefined();
    expect(keptMapOf({ map: { sum, grown: 19 } })).toBe(sum);
    expect(sameMapRef({ sum, grown: 19 }, { sum })).toBe(false);
    expect(sameMapRef({ sum, grown: 19 }, { sum, grown: 19 })).toBe(true);
  });

  it('样本的旧地图真的和种子长出来的不一样(这个测试文件的前提)', async () => {
    const map = (await readLocalPart(samplePart(PLAIN, 'map'))) as World;
    expect(isDeepStrictEqual(oldMap(map), map)).toBe(false);
    const snap: Snapshot = { format: 1, generator: PLAIN.generator, recipe: '', formation: false, parts: [samplePart(PLAIN, 'map')] };
    expect(partOf(snap, 'map')?.sum).toBe(PLAIN.parts.find((p) => p.name === 'map')!.sum);
  });
});

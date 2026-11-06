/**
 * 世界存成文件、打开文件(src/ui/worldFiles.ts、src/worldFileLook.ts)、把文件收进仓库(worldVault.ts 的 adoptFile)、全部世界的包。
 * 别人给的文件当不可信;任何情况都不盖掉、不弄丢本机已有的世界。
 * IndexedDB 用 fake-indexeddb;后台线程换成直接调。浏览器里真的走线程、放大细部逐项比,见 scripts/world-files-check.ts。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteNote, exportNotes, forgetNotes, putNote } from '../src/ai/library';
import { _notesSettled, _resetNotes } from '../src/ai/libraryVault';
import { polityAlive } from '../src/gen/civ/growth';
import { mergeUpheavals } from '../src/gen/civ/upheaval';
import { GENERATOR_VERSION } from '../src/gen/edits';
import { READER_VERSIONS } from '../src/gen/readers/versions';
import { makeSave, parseSave, type SaveFile } from '../src/gen/savefile';
import { recipeKey, recipeOfSave, sha256 } from '../src/gen/snapshot';
import { openWorldFile, packWorldFile, readWorldContent, type PackInput, type WorldEras } from '../src/gen/worldFile';
import { WORLD_FILE_EXT, WorldFileError, asWorldFileError } from '../src/gen/worldFormat';
import { ZIP_LOCAL_MAX_BYTES, parseZip, walkZip, writeZip, type ZipInput } from '../src/gen/zipStore';
import { bundleText, openBundleText } from '../src/ui/bundle';
import { clearEdits, setEdits } from '../src/ui/editsStore';
import { _setWorldFiles, adoptWorldFile, checkTimeout, keepWorldFile, knownWorldFileBytes, lookWorldFile, lookWorldFiles, openWorldFiles, openWorldFromFile, placeWorldFile, saveAllWorldFiles, saveWorldFile, sidesOf, sniffWorldFile, worldFileBytes, worldFileName, type KeptWorldFile, type LookedWorldFile, type OpenedWorldFiles, type WorldFileProgress } from '../src/ui/worldFiles';
import * as saveStore from '../src/ui/saveStore';
import { _setResultBackend, memoryResults } from '../src/ui/resultStore';
import { _setWorldStore, _settled, maintain } from '../src/ui/worldStore';
import { runConvert } from '../src/worldConvert';
import { lookFile } from '../src/worldFileLook';
import { openStoredWorld } from '../src/worldOpen';
import { keyOf } from '../src/worldRun';
import { VAULT_DB, _resetVault, changeAuthor, latestOf, partKey, purgeWorld, readAuthor, readRevision, revisionsOf, stateOf, vaultOps, type VaultOps } from '../src/worldVault';
import { bytesOf, makeSample, tinyJpeg } from './lib/worldFileSample';

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

const g = globalThis as unknown as { localStorage?: FakeStorage; indexedDB: IDBFactory };
type Caller = NonNullable<Parameters<typeof _setWorldStore>[0]['caller']>;
const direct = ((op: keyof VaultOps, args: unknown[]) => (vaultOps[op] as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as Caller;
const OPEN = { readers: READER_VERSIONS };

/** 样本:各段世界的键换成真的(打开世界时按它对上配方) */
let sample: PackInput & { eras: WorldEras };
let file: Blob;

beforeAll(async () => {
  const s = makeSample();
  const r = parseSave(JSON.stringify(s.recipe));
  if (!r.ok) throw new Error(r.error);
  const p = r.save.params;
  const e = r.save.edits;
  let all = [...e.terrain];
  const keys = mergeUpheavals(e.upheavals ?? []).map((u) => {
    all = [...all, ...u.ops];
    return keyOf(p, all, e.sketch);
  });
  sample = { ...s, eras: { baseKey: keyOf(p, e.terrain, e.sketch), eras: s.eras.eras.map((x, i) => ({ ...x, key: keys[i] })) } };
  file = await packWorldFile(sample);
}, 60_000);

beforeEach(() => {
  g.localStorage = new FakeStorage();
  g.indexedDB = new IDBFactory();
  _resetVault();
  saveStore._resetForTest();
  _resetNotes({ vault: { read: readAuthor, change: changeAuthor } });
  const results = memoryResults();
  _setResultBackend(results);
  _setWorldStore({ caller: direct, runner: (job) => ({ done: runConvert(job, results).then((result) => ({ ok: true as const, result })), stop: () => {} }), timing: { quiet: 0, poll: 1, pause: 0 } });
  _setWorldFiles({ once: direct, look: (f) => lookFile(f, OPEN) });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await _notesSettled();
  await _settled();
  _setResultBackend(undefined);
  _setWorldStore({ caller: null });
  _setWorldFiles({});
  _resetVault();
});

/** 换一个干净的浏览器 */
function freshBrowser() {
  g.localStorage = new FakeStorage();
  g.indexedDB = new IDBFactory();
  _resetVault();
  saveStore._resetForTest();
  _resetNotes({ vault: { read: readAuthor, change: changeAuthor } });
}

function asLooked(x: unknown): LookedWorldFile {
  const r = x as LookedWorldFile | { ok: false; kind: string; message: string };
  if (!r.ok) throw new Error(`没过:${r.kind} ${r.message}`);
  return r;
}
function asKept(x: unknown): KeptWorldFile {
  const r = x as KeptWorldFile | { ok: false; kind: string; message: string };
  if (!r.ok) throw new Error(`没存成:${r.kind} ${r.message}`);
  return r;
}

/** 文件收进来,返回本机的编号 */
async function keepFile(f: Blob): Promise<string> {
  return asKept(await keepWorldFile(asLooked(await lookWorldFile(f)))).id;
}

/** 这个世界打开时读到的 */
async function openIt(id: string) {
  const save = saveStore.loadWorld(id)!.save;
  return openStoredWorld({ id, recipe: await recipeKey(recipeOfSave(save)), generator: save.generator });
}

/** 文件里的条目改一改,重新装成 ZIP */
async function retouch(from: Blob, change: (entries: ZipInput[]) => void | Promise<void>): Promise<Blob> {
  const entries: ZipInput[] = parseZip(await bytesOf(from), ZIP_LOCAL_MAX_BYTES).map((e) => ({ name: e.name, data: e.data.slice() }));
  await change(entries);
  return writeZip(entries, ZIP_LOCAL_MAX_BYTES);
}
/** 改清单 */
const retouchManifest = (from: Blob, change: (m: any) => void | Promise<void>) =>
  retouch(from, async (entries) => {
    const e = entries.find((x) => x.name === 'manifest.json')!;
    const m = JSON.parse(new TextDecoder().decode(e.data as Uint8Array));
    await change(m);
    e.data = new TextEncoder().encode(JSON.stringify(m));
  });

const NOTE = { key: '释名:a', kind: '释名', title: '本机写的', text: '本机的 AI 正文', createdAt: '2026-11-04T09:00:00.000Z', provider: 'p', model: 'm' };

describe('打开一个文件', () => {
  it('本机没有的:存成新世界,编号是新的,地图、历史、AI 正文、封面都在,打开走存下的内容', async () => {
    const looked = asLooked(await lookWorldFile(file));
    expect(looked.match).toEqual({ kind: 'new' });
    expect(looked.title).toBe('九州大陆');
    // 核对不写东西
    expect(saveStore.listWorlds()).toHaveLength(0);
    expect(await latestOf(sample.id)).toBeNull();

    const { id, notesLost, memOnly } = asKept(await keepWorldFile(looked));
    expect(id).not.toBe(sample.id);
    expect(notesLost).toBe(false);
    expect(memOnly).toBe(false);
    const w = saveStore.loadWorld(id)!;
    expect(w.draft).toBe(false);
    expect(w.save.title).toBe('九州大陆');
    expect(w.thumb).toMatch(/^data:image\/jpeg;base64,/);
    expect(exportNotes(id).map((n) => n.text)).toEqual(sample.author!.notes.map((n) => n.text));
    expect(saveStore.trashMarks()).toEqual({});

    // 只核指纹就能打开(校验过了);世界记的读取版本跟着世界走
    expect((await stateOf(id))?.checked).toBe((await latestOf(id))!.content);
    const opened = await openIt(id);
    expect(opened.readers).toEqual({ terrain: sample.readers.terrain, query: sample.readers.query });
    const direct = await readWorldContent(await openWorldFile(file, OPEN));
    expect(isDeepStrictEqual(opened.civ, direct.civ)).toBe(true);
    expect(isDeepStrictEqual(opened.world, direct.map)).toBe(true);
    expect(opened.head.generator).toBe(sample.recipe.generator);

    // 存回文件:块的字节一点没动,清单只换了编号
    const again = await saveWorldFile(id);
    if (!again.ok) throw new Error(again.message);
    expect(again.name).toBe(`文明与地图-九州大陆${WORLD_FILE_EXT}`);
    const a = await openWorldFile(file, OPEN);
    const b = await openWorldFile(again.file, OPEN);
    expect(b.manifest.id).toBe(id);
    for (const p of a.manifest.parts.filter((x) => x.name !== 'author')) expect(await sha256(b.bytes.get(p.name)!)).toBe(await sha256(a.bytes.get(p.name)!));
  });

  it('从账号取回的文件放进同一个编号:AI 正文以文件里的为准,本机另有的留着', async () => {
    const id = 'wadopt00001';
    const key = sample.author!.notes[0].key;
    const old = { ...sample.author!.notes[0], text: '账号里存档带的旧一份' };
    putNote(id, old);
    putNote(id, { ...old, key: 'only-here', title: '本机写的', text: '只在这台设备上' });
    const r = await adoptWorldFile(id, file);
    expect(r.ok).toBe(true);
    const notes = new Map(exportNotes(id).map((n) => [n.key, n.text]));
    expect(notes.get(key)).toBe(sample.author!.notes[0].text);
    expect(notes.get('only-here')).toBe('只在这台设备上');
    expect(notes.size).toBe(2);
  });

  it('从账号取回的文件,放的工夫这台设备上的世界被清了(退出登录选了删掉):写进去的也删掉,AI 正文不写', async () => {
    const id = 'wadopt00002';
    let asked = 0;
    const r = await adoptWorldFile(id, file, () => (++asked > 1 ? 'wiped' : 'go'));
    expect(r.ok).toBe(false);
    expect(await latestOf(id)).toBeNull();
    expect(exportNotes(id)).toEqual([]);
  });

  it('打开同一个文件两次:第二次认出内容相同,不重复放', async () => {
    const id = await keepFile(file);
    const again = asLooked(await lookWorldFile(file));
    expect(again.match).toEqual({ kind: 'same', id });
    const r = await openWorldFromFile(file);
    expect(r.ok && r.status).toBe('same');
    expect(r.ok && r.id).toBe(id);
    expect(saveStore.listWorlds()).toHaveLength(1);
  });

  it('文件的编号本机没有,种子和名字都一样、内容不一样:算同一个世界,另存一份不是多一张同名卡片', async () => {
    const id = await keepFile(file);
    const changed = { ...sample.recipe, edits: { ...sample.recipe.edits, names: { 'polity:c1#0': '另一个名字' } } };
    const looked = asLooked(await lookWorldFile(await packWorldFile({ ...sample, id: 'wother000000', recipe: changed })));
    expect(looked.match).toEqual({ kind: 'different', id });
    const other = asLooked(await lookWorldFile(await packWorldFile({ ...sample, id: 'wother000000', recipe: { ...changed, title: '别的名字' } })));
    expect(other.match.kind).toBe('new');
  });

  it('文件里有本机没有的 AI 正文:不算相同', async () => {
    const id = await keepFile(file);
    await _notesSettled();
    for (const n of exportNotes(id)) deleteNote(id, n.key);
    await _notesSettled();
    expect(asLooked(await lookWorldFile(file)).match).toEqual({ kind: 'different', id });
  });

  it('超长正文的文件:能打开,只少这一块,有提示;另存字节不丢;接着写的正文也带上', async () => {
    const big = await packWorldFile({ ...sample, author: { notes: [{ ...sample.author!.notes[0], text: 'x'.repeat(4e6 + 1) }] } });
    const looked = asLooked(await lookWorldFile(big));
    expect(looked.warnings.join('')).toContain('AI 写的东西');
    const kept = asKept(await keepWorldFile(looked));
    expect(kept.notesLost).toBe(false);
    await _notesSettled();
    expect(exportNotes(kept.id)).toEqual([]);
    const was = await openWorldFile(big, OPEN);
    const raw = was.bytes.get('author')!;
    const saved1 = await saveWorldFile(kept.id);
    if (!saved1.ok) throw new Error(saved1.message);
    const again = await openWorldFile(saved1.file, OPEN);
    expect(again.bytes.get('author')).toEqual(raw);

    putNote(kept.id, NOTE);
    const saved2 = await saveWorldFile(kept.id);
    if (!saved2.ok) throw new Error(saved2.message);
    const after = await openWorldFile(saved2.file, OPEN);
    const old = after.manifest.parts.find((p) => p.name.startsWith('author.kept.'))!;
    expect(after.bytes.get(old.name)).toEqual(raw);
    const c = await readWorldContent(after);
    expect(c.author!.notes.map((n) => n.key)).toEqual([NOTE.key]);
  }, 60_000);

  it('author 块字节坏了的文件:能打开,这一块不收', async () => {
    const parts = (await walkZip(file)).entries;
    const entries: ZipInput[] = [];
    for (const e of parts) entries.push({ name: e.name, data: e.name === 'parts/author.gz' ? new Uint8Array([1, 2, 3, 4]) : new Uint8Array(await e.data.arrayBuffer()) });
    const bad = await writeZip(entries, ZIP_LOCAL_MAX_BYTES);
    const looked = asLooked(await lookWorldFile(bad));
    expect(looked.warnings.join('')).toContain('没读出来');
    const kept = asKept(await keepWorldFile(looked));
    await _notesSettled();
    expect(exportNotes(kept.id)).toEqual([]);
    expect((await readRevision(kept.id))!.manifest.parts.some((p) => p.name === 'author')).toBe(false);
    freshBrowser();
    const r = await openWorldFiles([bad]);
    expect(r.added).toHaveLength(1);
    expect(r.notesUnread).toEqual([r.added[0].id]);
  }, 60_000);

  it('编号相同、内容不同:报不同、不盖掉本机的;另存成新编号以后两个都在', async () => {
    const id = await keepFile(file);
    const before = await readRevision(id);
    // 别人拿本机这个世界的编号做了一个不一样的文件
    const other = await packWorldFile({ ...sample, id, title: '别的世界', recipe: { ...sample.recipe, title: '别的世界' } });
    const looked = asLooked(await lookWorldFile(other));
    expect(looked.match).toEqual({ kind: 'different', id });
    // 本机的没动
    expect(saveStore.loadWorld(id)!.save.title).toBe('九州大陆');
    expect((await latestOf(id))!.n).toBe(before!.head.n);

    // 交给界面问:什么都不写
    const asked = await placeWorldFile(looked, { different: 'ask' });
    expect(asked.ok && asked.status).toBe('different');
    expect(saveStore.listWorlds()).toHaveLength(1);

    // 默认另存一份:新编号,名字加「(二)」,本机的不动
    const placed = await placeWorldFile(looked);
    if (!placed.ok || placed.status !== 'copied') throw new Error('该另存一份');
    expect(placed.of).toBe(id);
    expect(placed.id).not.toBe(id);
    expect(placed.title).toBe('别的世界（二）');
    expect(saveStore.loadWorld(id)!.save.title).toBe('九州大陆');
    expect(saveStore.loadWorld(placed.id)!.save.title).toBe('别的世界（二）');
    expect((await latestOf(id))!.n).toBe(before!.head.n);
    expect((await readRevision(id))!.text).toEqual(before!.text);
    expect(saveStore.listWorlds()).toHaveLength(2);
    // 打得开,配方指纹对得上(名字不算配方)
    await openIt(placed.id);

    // 同一个文件再打开一次:认出刚才另存的那份,不再多一份
    const again = asLooked(await lookWorldFile(other));
    expect(again.match).toEqual({ kind: 'same', id: placed.id });
  });

  it('内容不一样时问一下:本机存好的那份和文件里的各自几样;现存几国文件里没记,核对时数出来', async () => {
    const id = await keepFile(file);
    await _notesSettled();
    const other = await packWorldFile({ ...sample, id, title: '别的世界', recipe: { ...sample.recipe, title: '别的世界' }, author: { notes: [] } });
    const looked = asLooked(await lookWorldFile(other));
    const { civ } = sample;
    const alive = civ.polities.filter((p) => polityAlive(p, civ.endYear)).length;
    expect(civ.viable && alive > 0).toBe(true);
    expect(looked.facts.alive).toBe(alive);
    const sides = (await sidesOf(looked, id))!;
    expect(sides.mine).toMatchObject({ notes: 1 });
    expect(sides.mine.save.title).toBe('九州大陆');
    expect(sides.theirs).toMatchObject({ alive, notes: 0 });
    expect(sides.theirs.save.title).toBe('别的世界');
    expect(sides.theirs.thumb).toMatch(/^data:image\/jpeg;base64,/);
    expect(await sidesOf(looked, 'wgone')).toBe(null);
  });

  it('文件的编号是乱填的:不进任何键,照样存成新编号', async () => {
    for (const bad of ['__proto__', 'constructor', '../../etc', 'seed=7&x', 'w'.repeat(1000)]) {
      const f = await retouchManifest(file, (m) => {
        m.id = bad;
      });
      const looked = asLooked(await lookWorldFile(f));
      const { id } = asKept(await keepWorldFile(looked));
      expect(id).toMatch(/^w[0-9a-z]+$/);
      expect((await readRevision(id))!.manifest.id).toBe(id);
      await purgeWorld(id);
      saveStore.deleteWorld(id);
      forgetNotes();
    }
    expect(Object.getPrototypeOf({}).polluted).toBeUndefined();
  });

  it('放满了:不放,不删别的世界', async () => {
    const id = await keepFile(file);
    for (let i = saveStore.storedCount(); i < saveStore.MAX_WORLDS; i++) {
      const w = saveStore.newWorldId();
      saveStore.putSyncedWorld(w, { save: JSON.stringify(makeSave({ ...sample.map.params, seed: 1000 + i }, { names: {}, interventions: [], terrain: [] }, '')), meta: {}, thumb: null });
    }
    expect(saveStore.storedCount()).toBe(saveStore.MAX_WORLDS);
    const other = await packWorldFile({ ...sample, recipe: { ...sample.recipe, title: '再来一个' } });
    const r = await keepWorldFile(asLooked(await lookWorldFile(other)));
    expect(r.ok === false && r.kind).toBe('count');
    expect(saveStore.loadWorld(id)).not.toBeNull();
    expect(saveStore.storedCount()).toBe(saveStore.MAX_WORLDS);
  });

  it('写不进「我的世界」:仓库里不留东西;写仓库写满了:报 full', async () => {
    const looked = asLooked(await lookWorldFile(file));
    const seen: string[] = [];
    const spy = vi.spyOn(g.localStorage!, 'setItem').mockImplementation((k: string) => {
      seen.push(k);
      if (k.startsWith('wenming-ditu:world:')) throw Object.assign(new Error('满了'), { name: 'QuotaExceededError' });
    });
    const r = await keepWorldFile(looked);
    expect(r.ok === false && r.kind).toBe('full');
    spy.mockRestore();
    expect(saveStore.listWorlds()).toHaveLength(0);
    const ids = seen.filter((k) => k.startsWith('wenming-ditu:world:')).map((k) => k.slice('wenming-ditu:world:'.length));
    expect(await latestOf(ids[0])).toBeNull();

    _setWorldFiles({ once: (() => Promise.reject(Object.assign(new Error('满了'), { kind: 'full' }))) as unknown as Caller, look: (f) => lookFile(f, OPEN) });
    const full = await keepWorldFile(looked);
    expect(full.ok === false && full.kind).toBe('full');
    expect(saveStore.listWorlds()).toHaveLength(0);
  });

  it('关页面断在写完仓库之后:留下的那份会被清掉,不留在仓库里', async () => {
    const looked = asLooked(await lookWorldFile(file));
    // keepWorldFile 写仓库之前记下、写进「我的世界」以后才划掉:断在中间就是这个样子
    const ghost = saveStore.newWorldId();
    await vaultOps.adoptFile({ id: ghost, file, sum: looked.facts.sum, recipeKey: looked.facts.recipeKey, generator: looked.facts.save.generator, readers: READER_VERSIONS });
    saveStore.markTrash(ghost);
    await maintain(0, 0);
    expect(await latestOf(ghost)).toBeNull();
    expect(saveStore.trashMarks()).toEqual({});
  });
});

describe('别人的文件不可信', () => {
  /** 这份文件该报哪种错;核对过程不写本机任何东西 */
  async function expectKind(f: Blob, kind: string) {
    const before = g.localStorage!.map.size;
    const r = await lookWorldFile(f);
    expect(r.ok ? 'ok' : r.kind).toBe(kind);
    expect(g.localStorage!.map.size).toBe(before);
  }

  it('改字节、截断、加没列的条目、假 JPEG、__proto__:都报 broken', async () => {
    const bytes = await bytesOf(file);
    const flip = bytes.slice();
    flip[Math.floor(bytes.length / 2)] ^= 0xff;
    await expectKind(new Blob([flip]), 'broken');
    await expectKind(new Blob([bytes.slice(0, bytes.length - 100)]), 'broken');
    await expectKind(new Blob([bytes.slice(0, 40)]), 'broken');
    await expectKind(new Blob([]), 'broken');
    await expectKind(new Blob(['{"app":"文明与地图"}']), 'broken');

    await expectKind(
      await retouch(file, (e) => {
        e.push({ name: 'parts/evil.gz', data: new Uint8Array([1, 2, 3]) });
      }),
      'broken',
    );
    // 假 JPEG:清单、指纹都对得上,只有字节不是 JPEG
    const fake = new TextEncoder().encode('<script>alert(1)</script>');
    const sum = await sha256(fake);
    await expectKind(
      await retouch(file, async (e) => {
        e.find((x) => x.name === 'parts/thumb.jpg')!.data = fake;
        const m = e.find((x) => x.name === 'manifest.json')!;
        const j = JSON.parse(new TextDecoder().decode(m.data as Uint8Array));
        const t = j.parts.find((p: { name: string }) => p.name === 'thumb');
        t.sum = sum;
        t.bytes = fake.length;
        m.data = new TextEncoder().encode(JSON.stringify(j));
      }),
      'broken',
    );
    // 清单里的 __proto__
    const proto = await retouch(file, (e) => {
      const m = e.find((x) => x.name === 'manifest.json')!;
      m.data = new TextEncoder().encode(new TextDecoder().decode(m.data as Uint8Array).replace('{', '{"__proto__":{"polluted":1},'));
    });
    await expectKind(proto, 'broken');
    expect(({} as { polluted?: number }).polluted).toBeUndefined();
    // 块里的 __proto__:打包函数写不出来,手工拼一块
    const head = new TextEncoder().encode('{"__proto__":{"polluted":1}}');
    const raw = new Uint8Array(16 + ((head.length + 7) & ~7));
    raw.set(new TextEncoder().encode('CIVSNAP1'));
    new DataView(raw.buffer).setUint32(8, head.length, true);
    raw.set(head, 12);
    const rawSum = await sha256(raw);
    await expectKind(
      await retouch(file, (e) => {
        const old = e.findIndex((x) => x.name === 'parts/civ.gz');
        e[old] = { name: 'parts/civ.bin', data: raw };
        const m = e.find((x) => x.name === 'manifest.json')!;
        const j = JSON.parse(new TextDecoder().decode(m.data as Uint8Array));
        const c = j.parts.find((p: { name: string }) => p.name === 'civ');
        Object.assign(c, { file: 'parts/civ.bin', zip: 'none', sum: rawSum, bytes: raw.length });
        m.data = new TextEncoder().encode(JSON.stringify(j));
      }),
      'broken',
    );
    expect(({} as { polluted?: number }).polluted).toBeUndefined();
  });

  it('超大块:声称解开有好几 GB,读之前就拒绝', async () => {
    await expectKind(
      await retouchManifest(file, (m) => {
        m.parts.find((p: { name: string }) => p.name === 'civ').bytes = 9e9;
      }),
      'broken',
    );
  });

  it('版本太新(外壳、读取规则、块的结构、生成器):报 newer,不说坏了', async () => {
    await expectKind(
      await retouchManifest(file, (m) => {
        m.format = 99;
      }),
      'newer',
    );
    await expectKind(
      await retouchManifest(file, (m) => {
        m.readers.terrain = 99;
      }),
      'newer',
    );
    await expectKind(
      await retouchManifest(file, (m) => {
        m.parts.find((p: { name: string }) => p.name === 'civ').schema = 99;
      }),
      'newer',
    );
    await expectKind(await packWorldFile({ ...sample, recipe: { ...sample.recipe, generator: GENERATOR_VERSION + 1 }, made: { ...sample.made, generator: GENERATOR_VERSION + 1 } }), 'newer');
  });

  it('配方和内容对不上(另一个世界的地图、各段世界对不上、版本对不上):报 broken,不留到打开时退回重新生成', async () => {
    const r = parseSave(JSON.stringify(sample.recipe));
    if (!r.ok) throw new Error(r.error);
    const otherSeed: SaveFile = { ...r.save, seed: 8, params: { ...r.save.params, seed: 8 } };
    await expectKind(await packWorldFile({ ...sample, recipe: otherSeed }), 'broken');
    await expectKind(await packWorldFile({ ...sample, eras: { ...sample.eras, baseKey: '别的' } }), 'broken');
    await expectKind(await packWorldFile({ ...sample, eras: { baseKey: sample.eras.baseKey, eras: [] } }), 'broken');
    await expectKind(await packWorldFile({ ...sample, made: { ...sample.made, generator: Math.max(0, GENERATOR_VERSION - 1) } }), 'broken');
  });

  it('http 的出处:写文件时自动去掉;手改进文件的报 broken;名字清理过', async () => {
    const http = await packWorldFile({ ...sample, recipe: { ...sample.recipe, origin: { title: 't', url: 'http://evil.example/x' } } });
    const looked = asLooked(await lookWorldFile(http));
    expect(looked.facts.save.origin).toBeUndefined();
    expect(checkTimeout(0)).toBe(20_000);
    expect(checkTimeout(140e6)).toBeGreaterThan(60_000);
    await expectKind(
      await retouchManifest(file, (m) => {
        m.recipe.origin = { title: 't', url: 'javascript:alert(1)' };
      }),
      'broken',
    );
    const f = asLooked(
      await lookWorldFile(
        await retouchManifest(file, (m) => {
          m.title = '清单里写的名字,不用它';
          m.recipe.title = `<img src=x onerror=alert(1)>${'长'.repeat(500)}`;
        }),
      ),
    );
    // 名字只取配方清理过的那份,长度有上限;当文字显示
    expect(f.title!.length).toBeLessThanOrEqual(120);
    expect(f.title).not.toContain('清单');
    expect(worldFileName({ title: 'a/b\\c:d*e', seed: 1 })).toBe(`文明与地图-abcde${WORLD_FILE_EXT}`);
  });

  it('附加数据:不解开内容,字节跟着世界走;指纹写的是本机别的世界那一块的,收不进来,本机那块不动', async () => {
    const id = await keepFile(file);
    const victim = (await readRevision(id))!;
    const civInfo = victim.manifest.parts.find((p) => p.name === 'civ')!;
    const before = await sha256(new Uint8Array(victim.parts.find((p) => p.info.name === 'civ')!.data as ArrayBuffer));
    const hostile = new TextEncoder().encode('这不是那一块');
    const poisoned = await retouch(file, (e) => {
      e.push({ name: 'parts/ext.evil.bin', data: hostile });
      const m = e.find((x) => x.name === 'manifest.json')!;
      const j = JSON.parse(new TextDecoder().decode(m.data as Uint8Array));
      j.title = '想顶掉别人的块';
      j.recipe.title = '想顶掉别人的块';
      j.parts.push({ name: 'ext.evil', file: 'parts/ext.evil.bin', schema: 1, sum: civInfo.sum, bytes: civInfo.bytes, zip: civInfo.zip, need: 'extra' });
      m.data = new TextEncoder().encode(JSON.stringify(j));
    });
    // 校验器不解开附加数据,核对是过的;收进仓库时核指纹,不让进
    const looked = asLooked(await lookWorldFile(poisoned));
    const r = await keepWorldFile(looked);
    expect(r.ok === false && r.kind).toBe('broken');
    expect(saveStore.listWorlds()).toHaveLength(1);
    const after = (await readRevision(id))!;
    expect(await sha256(new Uint8Array(after.parts.find((p) => p.info.name === 'civ')!.data as ArrayBuffer))).toBe(before);
    expect(isDeepStrictEqual((await openIt(id)).civ, (await readWorldContent(await openWorldFile(file, OPEN))).civ)).toBe(true);

    // 结构比软件新的认得的块(AI 正文)同样只当字节,一样要核指纹
    const newerAuthor = await retouch(file, (e) => {
      const m = e.find((x) => x.name === 'manifest.json')!;
      const j = JSON.parse(new TextDecoder().decode(m.data as Uint8Array));
      j.recipe.title = '另一个想顶掉别人的块';
      const a = j.parts.find((p: { name: string }) => p.name === 'author');
      Object.assign(a, { schema: 99, sum: civInfo.sum, bytes: civInfo.bytes });
      m.data = new TextEncoder().encode(JSON.stringify(j));
    });
    const r2 = await keepWorldFile(asLooked(await lookWorldFile(newerAuthor)));
    expect(r2.ok === false && r2.kind).toBe('broken');
    expect(saveStore.listWorlds()).toHaveLength(1);

    // 正常的附加数据(认不出的压缩方式也算)带着走
    const raw = new Uint8Array([1, 2, 3, 4, 5]);
    const kept = await retouch(file, async (e) => {
      e.push({ name: 'parts/ext.magic.bin', data: raw });
      const m = e.find((x) => x.name === 'manifest.json')!;
      const j = JSON.parse(new TextDecoder().decode(m.data as Uint8Array));
      j.future = { 认不出的字段: 1 };
      j.parts.push({ name: 'ext.magic', file: 'parts/ext.magic.bin', schema: 3, sum: await sha256(raw), bytes: raw.length, zip: 'future-zip', need: 'extra', by: 'magic-sim' });
      m.data = new TextEncoder().encode(JSON.stringify(j));
    });
    const kid = await keepFile(kept);
    const out = await saveWorldFile(kid);
    if (!out.ok) throw new Error(out.message);
    const back = await openWorldFile(out.file, OPEN);
    expect([...back.bytes.get('ext.magic')!]).toEqual([...raw]);
    expect((back.manifest as unknown as { future: unknown }).future).toEqual({ 认不出的字段: 1 });
  });

  it('核对之后文件变了:收不进来', async () => {
    const looked = asLooked(await lookWorldFile(file));
    const other = await packWorldFile({ ...sample, title: '换了' });
    const r = await keepWorldFile({ ...looked, file: other });
    expect(r.ok === false && r.kind).toBe('broken');
    expect(saveStore.listWorlds()).toHaveLength(0);
  });

  it('开不出内存、读不了文件:报 memory;超时、线程崩了分开报,都不说文件坏了', async () => {
    expect(asWorldFileError(new RangeError('Array buffer allocation failed')).kind).toBe('memory');
    expect(asWorldFileError(Object.assign(new Error('could not be read'), { name: 'NotReadableError' })).kind).toBe('memory');
    expect(asWorldFileError(new Error('别的')).kind).toBe('broken');

    const tooBig = { size: 100, arrayBuffer: () => Promise.reject(new RangeError('Array buffer allocation failed')) };
    Object.setPrototypeOf(tooBig, Blob.prototype);
    const m = await lookFile(tooBig as unknown as Blob, OPEN);
    expect(m.ok === false && m.kind).toBe('memory');

    for (const kind of ['timeout', 'crash'] as const) {
      _setWorldFiles({ once: direct, look: () => Promise.resolve({ ok: false, kind, message: 'x' }) });
      const r = await lookWorldFile(file);
      expect(r.ok === false && r.kind).toBe(kind);
    }
    _setWorldFiles({ once: direct, look: (f) => lookFile(f, OPEN) });
    const looked = asLooked(await lookWorldFile(file));
    _setWorldFiles({ once: (() => Promise.reject(Object.assign(new Error('x'), { kind: 'memory' }))) as unknown as Caller, look: (f) => lookFile(f, OPEN) });
    const r = await keepWorldFile(looked);
    expect(r.ok === false && r.kind).toBe('memory');
    expect(saveStore.trashMarks()).toEqual({});
  });
});

describe('一个世界存成文件', () => {
  it('算文件多大:和存出来的一样;还没有内容的 = null;只读不写', async () => {
    const id = await keepFile(file);
    expect(knownWorldFileBytes(id)).toBe(null);
    const before = await revisionsOf(id);
    const bytes = await worldFileBytes(id);
    expect(bytes).toBeGreaterThan(1000);
    expect(knownWorldFileBytes(id)).toBe(bytes);
    expect(await revisionsOf(id)).toEqual(before);
    const out = await saveWorldFile(id);
    if (!out.ok) throw new Error(out.message);
    expect(out.file.size).toBe(bytes);
    expect(await worldFileBytes('wnothing000')).toBe(null);
  });

  it('还没转进来的先打包;AI 正文、封面带上;别人(干净的浏览器)打得开', async () => {
    const r = parseSave(JSON.stringify(sample.recipe));
    if (!r.ok) throw new Error(r.error);
    const save: SaveFile = { ...r.save, edits: { names: { 'polity:c1#0': '饕餮王朝' }, interventions: [], terrain: [], upheavals: [] } };
    const id = saveStore.newWorldId();
    saveStore.putSyncedWorld(id, { save: JSON.stringify(save), meta: {}, thumb: 'data:image/jpeg;base64,/9j/wAALCAAYADABAREA/9k=' });
    putNote(id, NOTE);
    expect(await latestOf(id)).toBeNull();
    const out = await saveWorldFile(id);
    if (!out.ok) throw new Error(out.message);
    expect(out.stale).toBe(false);
    expect(await latestOf(id)).not.toBeNull();

    freshBrowser();
    const looked = asLooked(await lookWorldFile(out.file));
    expect(looked.match.kind).toBe('new');
    const kept = asKept(await keepWorldFile(looked));
    expect(exportNotes(kept.id).map((n) => n.text)).toEqual([NOTE.text]);
    expect(saveStore.loadWorld(kept.id)!.thumb).toMatch(/^data:image\/jpeg/);
    expect(saveStore.loadWorld(kept.id)!.save.edits.names).toEqual({ 'polity:c1#0': '饕餮王朝' });
  }, 60_000);

  it('改名、AI 正文这些配方以外的改动先写进去', async () => {
    const id = await keepFile(file);
    putNote(id, NOTE);
    saveStore.renameWorld(id, '改了名');
    const out = await saveWorldFile(id);
    if (!out.ok) throw new Error(out.message);
    const c = await readWorldContent(await openWorldFile(out.file, OPEN));
    expect(c.author!.notes.map((n) => n.key)).toContain(NOTE.key);
    expect(c.save.title).toBe('改了名');
  });

  it('一条缺字段的 AI 正文不让整个文件打不开', async () => {
    const id = await keepFile(file);
    putNote(id, { key: 'old', kind: '史书', text: '老版本写的' } as never);
    const out = await saveWorldFile(id);
    if (!out.ok) throw new Error(out.message);
    expect((await lookFile(out.file, OPEN)).ok).toBe(true);
  });

  it('刚改的东西写不进仓库(存储满了):文件是现在的样子,不落后;全部存成文件也一样,不用另带配方', async () => {
    const id = await keepFile(file);
    putNote(id, NOTE);
    saveStore.renameWorld(id, '写不进仓库的名字');
    const full = ((op: keyof VaultOps, args: unknown[]) => (op === 'commitWorld' ? Promise.reject(Object.assign(new Error('满了'), { kind: 'full' })) : (vaultOps[op] as (...a: unknown[]) => Promise<unknown>)(...args))) as unknown as Caller;
    _setWorldStore({ caller: full });
    const out = await saveWorldFile(id);
    if (!out.ok) throw new Error(out.message);
    expect(out.stale).toBe(false);
    const f = await lookFile(out.file, OPEN);
    if (!f.ok) throw new Error(f.message);
    expect(f.save.title).toBe('写不进仓库的名字');
    expect(f.author?.notes.some((n) => n.key === NOTE.key)).toBe(true);
    const all = await saveAllWorldFiles();
    if (!all.ok) throw new Error(all.message);
    expect(all.whole).toBe(1);
    expect(all.behind).toEqual([]);
    const names = (await walkZip(all.files[0].file)).entries.map((e) => e.name);
    expect(names).not.toContain('recipes.json');
  });

  it('正开着的世界最新的改动没能写进浏览器(存储满了):页面里的改动在文件里,不落后', async () => {
    const id = await keepFile(file);
    const w = saveStore.loadWorld(id)!;
    const stop = saveStore.startAutoSave();
    setEdits(w.save.edits);
    saveStore.attachWorld({ id, params: w.save.params, check: w.save.check, kind: 'created', saved: w.save.edits });
    const clean = await saveWorldFile(id);
    expect(clean.ok && clean.stale).toBe(false);
    vi.spyOn(g.localStorage!, 'setItem').mockImplementation(() => {
      throw Object.assign(new Error('满了'), { name: 'QuotaExceededError' });
    });
    setEdits({ ...w.save.edits, names: { ...w.save.edits.names, 'polity:c2#0': '只在页面里' } });
    expect(saveStore.currentUnsaved()).toBe(true);
    const out = await saveWorldFile(id);
    expect(out.ok && out.stale).toBe(false);
    if (!out.ok) throw new Error(out.message);
    const f = await lookFile(out.file, OPEN);
    expect(f.ok && f.save.edits.names['polity:c2#0']).toBe('只在页面里');
    vi.restoreAllMocks();
    stop();
    saveStore.detachWorld();
    clearEdits();
  });

  it('封面太大放不进卡片:仓库里那份留着,再存成文件还在', async () => {
    // 带几段注释的合格 JPEG,比卡片的上限大
    const tiny = tinyJpeg();
    const seg = new Uint8Array(65535 + 2).fill(0x20);
    seg[0] = 0xff;
    seg[1] = 0xfe;
    seg[2] = 0xff;
    seg[3] = 0xff;
    const n = 12;
    const big = new Uint8Array(2 + n * seg.length + tiny.length - 2);
    big.set(tiny.subarray(0, 2));
    for (let i = 0; i < n; i++) big.set(seg, 2 + i * seg.length);
    big.set(tiny.subarray(2), 2 + n * seg.length);
    expect(big.length).toBeGreaterThan(750_000);
    const f = await packWorldFile({ ...sample, thumb: big });
    const id = await keepFile(f);
    expect(saveStore.loadWorld(id)!.thumb).toBeNull();
    const out = await saveWorldFile(id);
    if (!out.ok) throw new Error(out.message);
    const back = await openWorldFile(out.file, OPEN);
    expect(await sha256(back.bytes.get('thumb')!)).toBe(await sha256(big));
  });

  it('本机只有配方、没存内容:不算相同,文件里的内容要放进来', async () => {
    const r = parseSave(JSON.stringify(sample.recipe));
    if (!r.ok) throw new Error(r.error);
    saveStore.importSave(r.save);
    forgetNotes();
    expect(saveStore.listWorlds()).toHaveLength(1);
    const placed = await openWorldFromFile(await packWorldFile({ ...sample, author: null }));
    expect(placed.ok && placed.status).toBe('copied');
    expect(saveStore.listWorlds()).toHaveLength(2);
  });

  it('没建完的、没有这个世界、更旧的版本又没有内容:分开报,界面照旧存 .json', async () => {
    expect((await saveWorldFile('wnothing000')) as object).toMatchObject({ ok: false, kind: 'missing' });
    const r = parseSave(JSON.stringify(sample.recipe));
    if (!r.ok) throw new Error(r.error);
    const draft = saveStore.newWorldId();
    saveStore.putSyncedWorld(draft, { save: JSON.stringify(r.save), meta: { draft: true }, thumb: null });
    expect((await saveWorldFile(draft)) as object).toMatchObject({ ok: false, kind: 'draft' });
    const old = saveStore.newWorldId();
    saveStore.putSyncedWorld(old, { save: JSON.stringify({ ...r.save, generator: GENERATOR_VERSION - 1 }), meta: {}, thumb: null });
    expect((await saveWorldFile(old)) as object).toMatchObject({ ok: false, kind: 'old' });
  });

  /** 把存着的 civ 那一块改坏 */
  async function hurtCiv(id: string) {
    const rev = (await readRevision(id))!;
    const info = rev.manifest.parts.find((p) => p.name === 'civ')!;
    await new Promise<void>((resolve, reject) => {
      const q = indexedDB.open(VAULT_DB);
      q.onsuccess = () => {
        const t = q.result.transaction('parts', 'readwrite');
        const data = new Uint8Array((rev.parts.find((p) => p.info.name === 'civ')!.data as ArrayBuffer).slice(0));
        data[Math.floor(data.length / 2)] ^= 0xff;
        t.objectStore('parts').put({ key: partKey(info), at: 0, data: data.buffer });
        t.oncomplete = () => {
          q.result.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
    });
  }

  it('存的内容坏了:当前版本的重新转一遍补好再存,存出来的是好的', async () => {
    const id = await keepFile(file);
    await hurtCiv(id);
    const out = await saveWorldFile(id);
    if (!out.ok) throw new Error(out.message);
    expect((await lookFile(out.file, OPEN)).ok).toBe(true);
    expect((await stateOf(id))?.corrupt).toBeUndefined();
  }, 60_000);

  it('存的内容坏了又没法重新转:不当备份交出去,全部存成文件时只带配方', async () => {
    const older = GENERATOR_VERSION - 1;
    const id = await keepFile(await packWorldFile({ ...sample, recipe: { ...sample.recipe, generator: older }, made: { ...sample.made, generator: older } }));
    await hurtCiv(id);
    const out = await saveWorldFile(id);
    expect(out.ok === false && out.kind).toBe('corrupt');
    expect((await stateOf(id))?.corrupt).toBeDefined();
    const all = await saveAllWorldFiles();
    if (!all.ok) throw new Error(all.message);
    expect(all.recipeOnly).toEqual([id]);
    expect(all.whole).toBe(0);
  }, 60_000);
});

describe('全部世界存成文件', () => {
  /** 三个带内容的世界(第二个有上一份内容不同的修订)、一个没建完的 */
  async function makeSome() {
    const a = await keepFile(file);
    const b0 = await packWorldFile({ ...sample, title: '第二', recipe: { ...sample.recipe, title: '第二' }, thumb: tinyJpeg(32, 16) });
    const b = await keepFile(b0);
    const c = await keepFile(await packWorldFile({ ...sample, title: '第三', recipe: { ...sample.recipe, title: '第三' }, author: null, thumb: null }));
    // 第二个再存一份内容不同的
    const r = parseSave(JSON.stringify(sample.recipe));
    if (!r.ok) throw new Error(r.error);
    const look0 = asLooked(await lookWorldFile(b0));
    const other = await packWorldFile({ ...sample, title: '第二', recipe: { ...sample.recipe, title: '第二' }, civ: { ...sample.civ, polities: sample.civ.polities.map((p, i) => (i ? p : { ...p, name: `${p.name}甲` })) } as typeof sample.civ });
    const lookOther = asLooked(await lookWorldFile(other));
    expect(lookOther.facts.content).not.toBe(look0.facts.content);
    await vaultOps.adoptFile({ id: b, file: other, sum: lookOther.facts.sum, recipeKey: lookOther.facts.recipeKey, generator: lookOther.facts.save.generator, readers: READER_VERSIONS });
    const draft = saveStore.newWorldId();
    saveStore.putSyncedWorld(draft, { save: JSON.stringify({ ...r.save, title: '没建完' }), meta: { draft: true }, thumb: null });
    return { a, b, c, draft };
  }

  async function saved() {
    const out = await saveAllWorldFiles();
    if (!out.ok) throw new Error(out.message);
    return out;
  }

  const ids = (r: OpenedWorldFiles) => r.added.map((x) => x.id);
  /** 这个世界最新的一份存成文件 */
  async function revisionFileOf(id: string): Promise<Blob> {
    const out = await saveWorldFile(id);
    if (!out.ok) throw new Error(out.message);
    return out.file;
  }

  it('往返:世界、AI 正文、封面、旧修订、没建完的都回来;认得出这种文件;进度报个数和字节', async () => {
    const { a, b } = await makeSome();
    const progress: WorldFileProgress[] = [];
    const out = await saveAllWorldFiles({ onProgress: (p) => progress.push(p) });
    if (!out.ok) throw new Error(out.message);
    expect(progress.at(-1)).toEqual({ done: 4, total: 4, bytes: out.bytes, totalBytes: out.bytes });
    expect(progress[0].totalBytes).toBeNull();
    expect(out.files).toHaveLength(1);
    expect(out.files[0].name).toMatch(/^文明与地图-全部世界-\d{4}-\d{2}-\d{2}\.civworld$/);
    expect(out.files[0]).toMatchObject({ part: 1, parts: 1, worlds: 3 });
    expect(out).toMatchObject({ count: 4, whole: 3 });
    expect(out.recipeOnly).toHaveLength(1);
    const pack = out.files[0].file;
    expect(await sniffWorldFile(pack)).toBe('backup');
    expect(await sniffWorldFile(file)).toBe('world');
    expect(await sniffWorldFile(new Blob(['{"app":"文明与地图"}']))).toBe('other');

    const contentB = (await latestOf(b))!.content;
    const revs = (await revisionsOf(b)).length;
    const notesA = exportNotes(a);
    freshBrowser();
    const back: WorldFileProgress[] = [];
    const r = await openWorldFiles([pack], { onProgress: (p) => back.push(p) });
    expect(r.skipped).toEqual([]);
    expect(r.cut).toBe(false);
    expect(r.cancelled).toBe(false);
    expect(r.added).toHaveLength(3);
    expect(r.recipes?.added).toHaveLength(1);
    expect(back[0]).toMatchObject({ done: 0, total: 3, bytes: 0 });
    expect(back.at(-1)).toEqual({ done: 3, total: 3, bytes: back[0].totalBytes, totalBytes: back[0].totalBytes });
    const list = saveStore.listWorlds();
    expect(list.map((w) => w.save.title ?? '').sort()).toEqual(['九州大陆', '没建完', '第三', '第二'].sort());
    expect(list.find((w) => w.save.title === '没建完')!.draft).toBe(true);
    const nb = list.find((w) => w.save.title === '第二')!;
    expect((await latestOf(nb.id))!.content).toBe(contentB);
    expect((await revisionsOf(nb.id)).length).toBe(revs);
    expect(nb.thumb).toMatch(/^data:image\/jpeg/);
    const na = list.find((w) => w.save.title === '九州大陆')!;
    expect(exportNotes(na.id).map((n) => n.text)).toEqual(notesA.map((n) => n.text));
    expect(saveStore.trashMarks()).toEqual({});
    await openIt(na.id);
  }, 120_000);

  it('本机已有的不被盖掉:一样的不重复放,不一样的另存一份、结果分得开;选 ask 的先不放', async () => {
    const { a, b } = await makeSome();
    const out = await saved();
    // 本机再改一个:改了名
    saveStore.renameWorld(a, '本机改过');
    const before = (await revisionsOf(b)).length;
    const asked = await openWorldFiles([out.files[0].file], { different: 'ask' });
    expect(asked.added).toEqual([]);
    expect(asked.same).toHaveLength(2);
    expect(asked.same.map((x) => x.id)).toContain(b);
    expect(asked.different.map((d) => d.id)).toEqual([a]);
    expect(saveStore.listWorlds()).toHaveLength(4);
    expect(saveStore.loadWorld(a)!.save.title).toBe('本机改过');
    expect((await revisionsOf(b)).length).toBe(before);
    expect(asked.recipes?.added ?? []).toEqual([]);

    const r = await openWorldFiles([out.files[0].file]);
    expect(r.added).toEqual([]);
    expect(r.same).toHaveLength(2);
    expect(r.different).toEqual([]);
    expect(r.copied).toHaveLength(1);
    expect(r.copied[0].of).toBe(a);
    expect(r.copied[0].title).toBe('九州大陆（二）');
    expect(saveStore.loadWorld(r.copied[0].id)!.save.title).toBe('九州大陆（二）');
    expect(saveStore.loadWorld(a)!.save.title).toBe('本机改过');
  }, 120_000);

  it('坏一个不影响其余;小清单坏了、下载断了也一样', async () => {
    await makeSome();
    const out = await saved();
    const pack = out.files[0].file;
    const { entries } = await walkZip(pack);
    const names = entries.map((e) => e.name);
    const worlds = names.filter((n) => n.endsWith(WORLD_FILE_EXT));
    expect(names[0]).toBe('worlds.json');

    // 改掉其中一个世界的一个字节
    const target = worlds[0];
    const rebuilt = async (change: (name: string, b: Uint8Array) => Uint8Array | null) => {
      const list: ZipInput[] = [];
      for (const e of entries) {
        const data = change(e.name, new Uint8Array(await e.data.arrayBuffer()));
        if (data) list.push({ name: e.name, data });
      }
      return writeZip(list, ZIP_LOCAL_MAX_BYTES);
    };
    freshBrowser();
    const flip = await rebuilt((n, b) => {
      if (n === target) b[Math.floor(b.length / 2)] ^= 0xff;
      return b;
    });
    const r1 = await openWorldFiles([flip]);
    expect(r1.skipped.map((p) => p.kind)).toEqual(['broken']);
    expect(r1.skipped[0].name).toBe(target.slice(0, target.lastIndexOf('/')));
    expect(r1.added).toHaveLength(2);

    // 小清单坏了:世界都回来,只是少了卡片上的几样
    freshBrowser();
    const noIndex = await rebuilt((n, b) => (n === 'worlds.json' ? new TextEncoder().encode('{坏了') : b));
    expect(await sniffWorldFile(noIndex)).toBe('backup');
    const r2 = await openWorldFiles([noIndex]);
    expect(r2.added).toHaveLength(3);
    expect(r2.sets).toEqual([]);

    // 下载断了:断之前完整的都回来(后面的放不回来,说一声)
    freshBrowser();
    const bytes = await bytesOf(pack);
    const lastStart = bytes.length - Math.floor(entries.find((e) => e.name === worlds.at(-1))!.data.size / 2) - 2000;
    const r3 = await openWorldFiles([new Blob([bytes.slice(0, lastStart)])]);
    expect(r3.cut).toBe(true);
    expect(r3.added.length).toBeGreaterThanOrEqual(2);

    // 不是这种文件
    for (const bad of [new Blob([]), new Blob(['随便什么']), await writeZip([{ name: 'a.txt', data: new Uint8Array([1]) }], 1000)]) {
      const r = await openWorldFiles([bad]);
      expect(r.skipped.map((x) => x.kind)).toEqual(['broken']);
      expect(r.added).toEqual([]);
    }
  }, 180_000);

  it('版本太新的:报 newer;世界多得离谱、文件名乱填的:不挡着别的,也不到本机别处', async () => {
    const newerPack = await writeZip([{ name: 'worlds.json', data: new TextEncoder().encode(JSON.stringify({ kind: 'backup', format: 99 })) }], 1000);
    const n = await openWorldFiles([newerPack]);
    expect(n.skipped.map((x) => x.kind)).toEqual(['newer']);

    const data = await bytesOf(file);
    const entries: ZipInput[] = [
      // 小清单想把世界锁成「还在新建」、时间乱填:不认
      { name: 'worlds.json', data: new TextEncoder().encode(JSON.stringify({ kind: 'backup', format: 1, worlds: [{ dir: 'wgood', meta: { draft: true, map: true, alive: 3 }, opened: 'x', title: 7 }] })) },
      { name: 'worlds/wgood/1-made.civworld', data },
      { name: 'worlds/x/999999999999999999999-made.civworld', data: new Uint8Array(1) },
      { name: 'worlds/bad/1-made.civworld', data: new Uint8Array(10) },
    ];
    const r = await openWorldFiles([await writeZip(entries, ZIP_LOCAL_MAX_BYTES)]);
    expect(r.added).toHaveLength(1);
    expect(r.skipped.map((p) => p.kind)).toEqual(['broken']);
    const w = saveStore.loadWorld(r.added[0].id)!;
    expect(w.draft).toBe(false);
    expect(w.map).toBe(false);
    expect(w.alive).toBe(3);
  });

  it('超过上限分成几个文件:说得出第几个、一共几个、还差哪个;每个都能单独打开,一起选也行', async () => {
    const { b } = await makeSome();
    const size = (await saved()).files[0].file.size;
    // 上限里留了 16 MB 给小清单和配方(样本世界小):把留的地方算进去,卡到一个文件放不下全部
    const tiny = await saveAllWorldFiles({ maxBytes: Math.ceil(size * 0.6) + 16e6 });
    if (!tiny.ok) throw new Error(tiny.message);
    expect(tiny.files.length).toBeGreaterThan(1);
    expect(tiny.olderLeft).toEqual([]);
    // 卡得再小:一个世界的几份修订放不下一个文件,留最新的,说一声
    const smaller = await saveAllWorldFiles({ maxBytes: Math.ceil(size * 0.3) + 16e6 });
    if (!smaller.ok) throw new Error(smaller.message);
    expect(smaller.olderLeft).toEqual([b]);
    expect(smaller.whole).toBe(3);
    const k = tiny.files.length;
    expect(tiny.files.map((f) => f.name).every((n, i) => n.endsWith(`-${i + 1}of${k}${WORLD_FILE_EXT}`))).toBe(true);
    expect(tiny.files.map((f) => f.part)).toEqual(tiny.files.map((_, i) => i + 1));
    const revs = (await revisionsOf(b)).length;

    // 只选了最后一个:还差前面的
    const look = await lookWorldFiles([tiny.files[k - 1].file]);
    expect(look.files[0]).toMatchObject({ kind: 'backup', part: k, parts: k });
    expect(look.sets).toHaveLength(1);
    expect(look.sets[0].have).toEqual([k]);
    expect(look.sets[0].missing).toEqual(Array.from({ length: k - 1 }, (_, i) => i + 1));

    freshBrowser();
    let added = 0;
    for (const f of [...tiny.files].reverse()) {
      expect(await sniffWorldFile(f.file)).toBe('backup');
      const r = await openWorldFiles([f.file]);
      expect(r.skipped).toEqual([]);
      added += r.added.length;
    }
    expect(added).toBe(3);
    const nb = saveStore.listWorlds().find((w) => w.save.title === '第二')!;
    expect((await revisionsOf(nb.id)).length).toBe(revs);

    // 一起选:一次放回来,不缺;同一个选两次不算两份
    freshBrowser();
    const all = await openWorldFiles([...tiny.files.map((f) => f.file), tiny.files[0].file]);
    expect(all.added).toHaveLength(3);
    expect(all.sets[0].missing).toEqual([]);
    expect(all.skipped).toEqual([]);
  }, 120_000);

  it('取消:存的时候没有文件;放回的时候已经放回的留着,不留半截', async () => {
    await makeSome();
    const stop = new AbortController();
    const out = await saveAllWorldFiles({
      signal: stop.signal,
      onProgress: (p) => {
        if (p.done === 1) stop.abort();
      },
    });
    expect(out.ok === false && out.kind).toBe('cancelled');
    const pack = (await saved()).files[0].file;

    freshBrowser();
    const stop2 = new AbortController();
    const r = await openWorldFiles([pack], {
      signal: stop2.signal,
      onProgress: (p) => {
        if (p.done === 1) stop2.abort();
      },
    });
    expect(r.cancelled).toBe(true);
    expect(r.added).toHaveLength(2);
    expect(saveStore.listWorlds()).toHaveLength(2);
    // 配方那部分还没放;再开一次把剩下的补上,放过的不重复
    expect(r.recipes).toBeNull();
    for (const x of ids(r)) expect(await latestOf(x)).not.toBeNull();
    const rest = await openWorldFiles([pack]);
    expect(rest.same).toHaveLength(2);
    expect(rest.added).toHaveLength(1);
    expect(rest.recipes?.added).toHaveLength(1);
    expect(saveStore.listWorlds()).toHaveLength(4);
  }, 120_000);

  it('内容一样的旧修订不带(只改了名、AI 正文);迁移前的原件放回来还是不会被淘汰的那种', async () => {
    const id = await keepFile(file);
    saveStore.renameWorld(id, '改了名');
    putNote(id, NOTE);
    expect((await saveWorldFile(id)).ok).toBe(true);
    const revs = await revisionsOf(id);
    expect(revs.length).toBeGreaterThan(1);
    const pack = (await saved()).files[0].file;
    const names = (await walkZip(pack)).entries.map((e) => e.name).filter((n) => n.endsWith(WORLD_FILE_EXT));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/\/\d+-made\.civworld$/);

    const old = await keepFile(await packWorldFile({ ...sample, title: '转进来的', recipe: { ...sample.recipe, title: '转进来的' } }));
    const looked = asLooked(await lookWorldFile(await packWorldFile({ ...sample, title: '转进来的', recipe: { ...sample.recipe, title: '转进来的' } })));
    const moved = saveStore.newWorldId();
    await vaultOps.adoptFile({ id: moved, file: looked.file, sum: looked.facts.sum, recipeKey: looked.facts.recipeKey, generator: looked.facts.save.generator, readers: READER_VERSIONS, source: 'migrated' });
    saveStore.putSyncedWorld(moved, { save: JSON.stringify({ ...looked.facts.save, title: '转进来的二' }), meta: {}, thumb: null });
    expect((await saveWorldFile(moved)).ok).toBe(true);
    expect((await revisionsOf(moved)).map((h) => h.source)).toEqual(['migrated', 'made']);
    void old;
    const both = (await walkZip((await saved()).files[0].file)).entries.map((e) => e.name);
    expect(both.filter((n) => n.includes(moved))).toEqual([expect.stringMatching(/\/2-migrated\.civworld$/)]);
  }, 60_000);

  it('世界之间记着的编号换成本机的:地图出自的世界、没建完的底稿,不管谁先放回来', async () => {
    const a = await keepFile(file);
    const r = parseSave(JSON.stringify(sample.recipe));
    if (!r.ok) throw new Error(r.error);
    const onMap = await packWorldFile({ ...sample, title: '新开的', recipe: { ...r.save, title: '新开的', edits: { ...r.save.edits, map: { from: a } } } });
    await keepFile(onMap);
    const draft = saveStore.newWorldId();
    saveStore.putSyncedWorld(draft, { save: JSON.stringify({ ...r.save, title: '没建完' }), meta: { draft: true, base: { id: a, title: '九州大陆' } as never }, thumb: null });
    const pack = (await saved()).files[0].file;
    freshBrowser();
    const back = await openWorldFiles([pack]);
    expect(back.skipped).toEqual([]);
    const list = saveStore.listWorlds();
    const na = list.find((w) => w.save.title === '九州大陆')!;
    expect(na.id).not.toBe(a);
    expect(list.find((w) => w.save.title === '新开的')!.save.edits.map?.from).toBe(na.id);
    expect(list.find((w) => w.save.title === '没建完')!.base?.id).toBe(na.id);
    // 再放一次:都认得出,不多出世界
    const again = await openWorldFiles([pack]);
    expect(again.added).toEqual([]);
    expect(again.copied).toEqual([]);
    expect(saveStore.listWorlds()).toHaveLength(3);
  }, 60_000);

  it('配方那部分占的地方算在第一个文件里:加起来超过上限也存得出来', async () => {
    const { b } = await makeSome();
    void b;
    const size = (await saved()).files[0].file.size;
    const r = parseSave(JSON.stringify(sample.recipe));
    if (!r.ok) throw new Error(r.error);
    // 只带配方的世界撑大(没建完的世界名字不算大,用封面占地方)
    const big = saveStore.newWorldId();
    saveStore.putSyncedWorld(big, { save: JSON.stringify({ ...r.save, title: '占地方' }), meta: { draft: true }, thumb: `data:image/jpeg;base64,${'A'.repeat(Math.ceil(size * 0.5))}` });
    const out = await saveAllWorldFiles({ maxBytes: Math.ceil(size * 1.1) + 16e6 });
    if (!out.ok) throw new Error(`存不出来:${out.message}`);
    expect(out.files.length).toBeGreaterThan(1);
  }, 60_000);

  it('只存了配方的那部分大得离谱:不读,世界照样放回来', async () => {
    const data = await bytesOf(file);
    const pack = await writeZip(
      [
        { name: 'worlds.json', data: new TextEncoder().encode('{"kind":"backup","format":1}') },
        { name: 'worlds/a/1-made.civworld', data },
        { name: 'recipes.json', data: new Blob([new Uint8Array(193e6)]) },
      ],
      4e9,
    );
    const back = await openWorldFiles([pack]);
    expect(back.added).toHaveLength(1);
    expect(back.recipes).toBeNull();
    expect(back.skipped.map((x) => [x.name, x.kind])).toEqual([['recipes.json', 'broken']]);
  }, 60_000);

  it('本机有一模一样的、但没有文件里带的旧修订:说得出来,不改本机的', async () => {
    const { b } = await makeSome();
    const pack = (await saved()).files[0].file;
    const cur = await revisionFileOf(b);
    freshBrowser();
    const one = await keepFile(cur);
    const before = (await revisionsOf(one)).length;
    const r = await openWorldFiles([pack]);
    const hit = r.same.find((x) => x.id === one);
    expect(hit?.olderMissing).toBe(1);
    expect((await revisionsOf(one)).length).toBe(before);
    expect(r.added).toHaveLength(2);
  }, 60_000);

  it('存了地图的世界在配方那部分里:在它上面新开的世界,编号换成放回来的那个', async () => {
    const r = parseSave(JSON.stringify(sample.recipe));
    if (!r.ok) throw new Error(r.error);
    const mapId = saveStore.newWorldId();
    saveStore.putSyncedWorld(mapId, { save: JSON.stringify({ ...r.save, title: '只存了地图' }), meta: { map: true }, thumb: null });
    await keepFile(await packWorldFile({ ...sample, title: '新开的', recipe: { ...r.save, title: '新开的', edits: { ...r.save.edits, map: { from: mapId } } } }));
    const pack = (await saved()).files[0].file;
    freshBrowser();
    const back = await openWorldFiles([pack]);
    expect(back.recipes?.added).toHaveLength(1);
    const list = saveStore.listWorlds();
    const map = list.find((w) => w.save.title === '只存了地图')!;
    expect(map.id).not.toBe(mapId);
    expect(list.find((w) => w.save.title === '新开的')!.save.edits.map?.from).toBe(map.id);
  }, 60_000);

  it('文件比世界落后时另带的 AI 正文比世界文件里的新:放回来用新的;本机原来就有的世界不动', async () => {
    const id = await keepFile(file);
    const key = sample.author!.notes[0].key;
    putNote(id, { ...sample.author!.notes[0], text: '新写的正文' });
    const full = ((op: keyof VaultOps, args: unknown[]) => (op === 'commitWorld' ? Promise.reject(Object.assign(new Error('满了'), { kind: 'full' })) : (vaultOps[op] as (...a: unknown[]) => Promise<unknown>)(...args))) as unknown as Caller;
    _setWorldStore({ caller: full });
    const pack = await saveAllWorldFiles();
    _setWorldStore({ caller: direct });
    if (!pack.ok) throw new Error(pack.message);
    freshBrowser();
    const back = await openWorldFiles([pack.files[0].file]);
    expect(back.added).toHaveLength(1);
    expect(exportNotes(back.added[0].id).find((n) => n.key === key)?.text).toBe('新写的正文');
    expect(saveStore.listWorlds()).toHaveLength(1);
  }, 60_000);

  it('单个世界和全部世界一起选也认得出', async () => {
    const r = await lookWorldFiles([file, new Blob(['{}'])]);
    expect(r.files.map((f) => f.kind)).toEqual(['world', 'other']);
    const o = await openWorldFiles([file, new Blob(['{}'])]);
    expect(o.added).toHaveLength(1);
    expect(o.skipped.map((x) => x.kind)).toEqual(['broken']);
  });

  it('一个世界都没有:说没有,不出空文件', async () => {
    const r = await saveAllWorldFiles();
    expect(r.ok === false && r.kind).toBe('missing');
  });
});

describe('旧的 .json', () => {
  it('照旧能打开,不走这条路', async () => {
    const r = parseSave(JSON.stringify(sample.recipe));
    if (!r.ok) throw new Error(r.error);
    const text = `${JSON.stringify(r.save)}\n`;
    expect(await sniffWorldFile(new Blob([text]))).toBe('other');
    const id = saveStore.importSave(r.save)!;
    expect(saveStore.loadWorld(id)!.save.title).toBe('九州大陆');
    expect(await latestOf(id)).toBeNull();
    // 老的「全部存成文件」也一样
    const b = bundleText()!;
    expect(await sniffWorldFile(new Blob([b.text]))).toBe('other');
    freshBrowser();
    expect(openBundleText(b.text)).toBe(true);
    expect(saveStore.listWorlds()).toHaveLength(1);
  });
});

describe('按条目走 ZIP(walkZip)', () => {
  it('规矩的文件走到目录;断了、尾巴坏了停在那儿,前面的还在;条目的字节用到才读', async () => {
    const data = new Uint8Array(1000).fill(7);
    const zip = await writeZip(
      [
        { name: 'a.bin', data },
        { name: 'b.bin', data },
        { name: 'c.bin', data },
      ],
      1e6,
    );
    const ok = await walkZip(zip);
    expect(ok.clean).toBe(true);
    expect(ok.entries.map((e) => e.name)).toEqual(['a.bin', 'b.bin', 'c.bin']);
    expect([...new Uint8Array(await ok.entries[1].data.arrayBuffer())]).toEqual([...data]);

    const cut = await walkZip(zip.slice(0, 1500));
    expect(cut.clean).toBe(false);
    expect(cut.entries.map((e) => e.name)).toEqual(['a.bin']);

    const junk = await walkZip(new Blob(['不是 ZIP,但是够长够长够长够长够长够长够长够长够长够长够长']));
    expect(junk).toEqual({ entries: [], clean: false });
    expect(await walkZip(new Blob([]))).toEqual({ entries: [], clean: false });
    expect((await walkZip(zip, 2)).entries).toHaveLength(2);
  });

  it('读不了文件名、大小乱填的条目不把进程带走', async () => {
    const zip = await writeZip([{ name: 'a.bin', data: new Uint8Array(10) }], 1e6);
    const b = await bytesOf(zip);
    const huge = b.slice();
    new DataView(huge.buffer).setUint32(18, 0xfffffff0, true);
    new DataView(huge.buffer).setUint32(22, 0xfffffff0, true);
    expect((await walkZip(new Blob([huge]))).entries).toEqual([]);
  });
});

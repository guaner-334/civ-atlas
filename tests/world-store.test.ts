/**
 * 主线程这边的世界仓库(src/ui/worldStore.ts)和转存(src/worldConvert.ts):什么时候存、删世界再撤销、把现有的世界转进来、
 * 仓库坏了旧的存档和原件照常用。仓库本身见 tests/world-vault.test.ts。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { EMPTY_EDITS, GENERATOR_VERSION, type WorldEdits } from '../src/gen/edits';
import { FIRST_READERS, READER_VERSIONS } from '../src/gen/readers/versions';
import { makeSave, worldCheck, type SaveFile } from '../src/gen/savefile';
import { SNAPSHOT_FORMAT, makePart, partBytes, readLocalPart, recipeKey, recipeOfSave, type Snapshot, type SnapshotPart } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { openWorldFile, readWorldContent } from '../src/gen/worldFile';
import { deleteNote, exportNotes, putNote } from '../src/ai/library';
import { _notesSettled, _resetNotes } from '../src/ai/libraryVault';
import { clearEdits, getEdits, setEdits } from '../src/ui/editsStore';
import { _setResultBackend, memoryResults, offerSnapshot, resultHeads } from '../src/ui/resultStore';
import * as saveStore from '../src/ui/saveStore';
import { APP_COMMIT } from '../src/ui/version';
import { TRASH_KEEP_MS, notesVault, _setWorldStore, _settled, _syncLight, clearWorldStore, maintain, offerWorldParts, pendingEdit, pendingOf, sameHistory, setWorldStoreSim, startConversions, startWorldStore, thumbBytes, worldMark, type ConvertRunner } from '../src/ui/worldStore';
import { recomputeWorld, runConvert, type ConvertJob } from '../src/worldConvert';
import { eraWorlds, keyOf, mapValue, worldChronicle, worldFlags } from '../src/worldRun';
import { _resetVault, changeAuthor, latestOf, patchState, purgeWorld, readAuthor, readRevision, revisionFile, revisionsOf, stateOf, vaultOps, type VaultOps, type WorldPartsOffer } from '../src/worldVault';
import { FIXTURE_DIR, readSamples } from './lib/savedWorlds';
import { bytesOf } from './lib/worldFileSample';

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
const OPEN = { readers: READER_VERSIONS };
const PARAMS = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };

let results = memoryResults();
let stopAuto: (() => void) | null = null;
let world: World;
let check: string;

/** 模拟 App 打开一个建好的世界 */
function openWorld(id: string, edits: WorldEdits = EMPTY_EDITS, kind: saveStore.WorldKind = 'created') {
  saveStore.detachWorld();
  clearEdits();
  const stored = saveStore.loadWorld(id);
  const e = stored?.save.edits ?? edits;
  setEdits(e);
  saveStore.attachWorld({ id, params: PARAMS, check, kind, saved: stored?.save.edits ?? e });
}

/** 这个世界现在这样的内容(线程交回来的那一份) */
async function offerOf(edits: WorldEdits = getEdits(), tag = 'a'): Promise<WorldPartsOffer> {
  const recipe = await recipeKey(recipeOfSave(makeSave(PARAMS, edits, check)));
  const parts = [await makePart('map', { ...mapValue(world) }), await makePart('civ', { ...civ(), tag }), await makePart('chronicle', { entries: [] }), await makePart('flags', { eras: [] })];
  return { generator: GENERATOR_VERSION, recipe, parts };
}

let civCache: ReturnType<typeof generateCiv> | null = null;
const civ = () => (civCache ??= generateCiv(world, { endYear: 300 }));

/** 存好一个建好的世界 */
function makeWorld(edits: WorldEdits = EMPTY_EDITS): string {
  const id = saveStore.newWorldId();
  openWorld(id, edits);
  saveStore.markCreated();
  return id;
}

const JPEG = 'data:image/jpeg;base64,/9j/wAALCAAYADABAREA/9k=';

beforeAll(() => {
  world = generateWorld(PARAMS);
  check = worldCheck(world);
}, 60_000);

beforeEach(() => {
  g.localStorage = new FakeStorage();
  g.indexedDB = new IDBFactory();
  _resetVault();
  saveStore._resetForTest();
  _resetNotes({ vault: { read: readAuthor, change: changeAuthor } });
  clearEdits();
  stopAuto = saveStore.startAutoSave();
  results = memoryResults();
  _setResultBackend(results);
  _setWorldStore({ caller: direct, runner: (job) => ({ done: runConvert(job, results).then((result) => ({ ok: true as const, result })), stop: () => {} }), timing: { quiet: 0, poll: 1, pause: 0 } });
});

afterEach(async () => {
  stopAuto?.();
  stopAuto = null;
  saveStore.detachWorld();
  await _notesSettled();
  await _settled();
  _setResultBackend(undefined);
  _setWorldStore({ caller: null });
  _resetVault();
});

describe('世界内容的记号', () => {
  it('编年史、国旗变了(改名)记号不变;历史变了(重推过)记号变;仓库里没有、读不了 = null', async () => {
    const id = makeWorld();
    expect(await worldMark(id)).toBeNull();
    const o = await offerOf();
    expect(await offerWorldParts(o)).toBe(true);
    const a = (await worldMark(id))!;
    const sumOf = (name: string) => o.parts.find((p) => p.name === name)!.sum;
    expect(a).toEqual({ print: `map:${sumOf('map')}|civ:${sumOf('civ')}`, recipe: o.recipe, generator: GENERATOR_VERSION });

    const renamed = await offerOf();
    renamed.parts = [...renamed.parts.filter((p) => p.name !== 'chronicle'), await makePart('chronicle', [{ year: 1, text: '改了名' }])];
    expect(await offerWorldParts(renamed)).toBe(true);
    expect((await readRevision(id))!.manifest.revision.n).toBe(2);
    expect((await worldMark(id))!.print).toBe(a.print);

    const again = await offerOf(getEdits(), 'b');
    expect(await offerWorldParts(again)).toBe(true);
    const b = (await worldMark(id))!;
    expect(b.print).not.toBe(a.print);
    // 同一个配方、同一版:算同一段历史;换了配方、换了版本又不一样:不算
    expect(sameHistory(a, b)).toBe(true);
    expect(sameHistory(a, { ...b, recipe: 'r2' })).toBe(false);
    expect(sameHistory(a, { ...b, generator: GENERATOR_VERSION + 1 })).toBe(false);
    expect(sameHistory(a, { ...a, recipe: 'r2', generator: GENERATOR_VERSION + 1 })).toBe(true);

    _setWorldStore({
      caller: (() => Promise.reject(new Error('仓库坏了'))) as unknown as Parameters<typeof _setWorldStore>[0]['caller'],
    });
    expect(await worldMark(id)).toBeNull();
  });
});

describe('推完存进仓库', () => {
  it('建好的世界对得上存档就存;内容能读回来', async () => {
    const id = makeWorld();
    expect(await offerWorldParts(await offerOf())).toBe(true);
    const head = await latestOf(id);
    expect(head).toMatchObject({ n: 1, generator: GENERATOR_VERSION, source: 'made' });
    const m = (await readRevision(id))!.manifest;
    expect(m.made.generator).toBe(GENERATOR_VERSION);
    expect(m.made.commit).toBe(APP_COMMIT);
    expect(m.readers).toEqual(READER_VERSIONS);
    expect(m.recipe.savedAt).toBe(saveStore.loadWorld(id)!.save.savedAt);
  });

  it('没建完的先放着,点了创建再存;配方对不上的不存;打开别人的链接不存', async () => {
    const id = saveStore.newWorldId();
    openWorld(id, EMPTY_EDITS, 'draft');
    const o = await offerOf();
    expect(await offerWorldParts(o)).toBe(false);
    expect(await latestOf(id)).toBeNull();

    // 配方对不上
    const other = saveStore.newWorldId();
    openWorld(other);
    saveStore.markCreated();
    expect(await offerWorldParts({ ...(await offerOf()), recipe: 'not-this' })).toBe(false);
    expect(await latestOf(other)).toBeNull();

    const visit = 'wvisit';
    openWorld(visit, EMPTY_EDITS, 'visit');
    expect(await offerWorldParts(await offerOf())).toBe(false);
    expect(await latestOf(visit)).toBeNull();
  });

  it('还没有修订时写的 AI 正文,第一次存的时候并进 author 块', async () => {
    const id = makeWorld();
    putNote(id, { key: 'k', kind: '史书', title: '本纪', text: '正文', createdAt: '2026-11-04T00:00:00.000Z', provider: 'p', model: 'm' });
    await _notesSettled();
    expect(await offerWorldParts(await offerOf())).toBe(true);
    const r = (await readRevision(id))!;
    expect(r.manifest.parts.some((p) => p.name === 'author')).toBe(true);
    const author = r.parts.find((p) => p.info.name === 'author')!;
    expect(new TextDecoder().decode(await partBytes(author.info as unknown as SnapshotPart, new Uint8Array(author.data as ArrayBuffer)))).toContain('正文');
    expect(saveStore.rawWorld(id)).toBeTruthy();
    expect(saveStore.loadWorld(id)).toBeTruthy();
    expect(exportNotes(id).map((n) => n.text)).toEqual(['正文']);
    deleteNote(id, 'k');
  });

  it('只改名:新修订只改清单,配方跟着变,看世界的块还是那几块', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    const before = (await readRevision(id))!;
    saveStore.renameWorld(id, '新名字');
    await _syncLight(id);
    const after = (await readRevision(id))!;
    expect(after.head.n).toBe(2);
    expect(after.manifest.title).toBe('新名字');
    expect(after.head.content).toBe(before.head.content);
    // 再同步一次,什么都没变
    await _syncLight(id);
    expect((await latestOf(id))!.n).toBe(2);
  });

  it('配方变了还没推完:只记着旧的修订,判断得出来有待完成的修改', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    expect(await pendingOf(id)).toBe('none');
    setEdits({ ...getEdits(), interventions: [{ year: 10, kind: 'plague', region: 1 } as never] });
    saveStore.detachWorld();
    await _syncLight(id);
    expect((await latestOf(id))!.n).toBe(1);
    expect(await pendingOf(id)).toBe('recompute');
  });

  it('判断函数:版本相同能重算,版本不同只读', () => {
    const draft = 'k2';
    expect(pendingEdit(null, draft)).toBe('none');
    expect(pendingEdit({ recipeKey: 'k2', generator: 50 }, draft, 57)).toBe('none');
    expect(pendingEdit({ recipeKey: 'k1', generator: 57 }, draft, 57)).toBe('recompute');
    expect(pendingEdit({ recipeKey: 'k1', generator: 50 }, draft, 57)).toBe('readonly');
  });

  it('封面:dataURL 转成 JPEG 字节,不是 JPEG 的不要', () => {
    expect(thumbBytes(JPEG)![0]).toBe(0xff);
    expect(thumbBytes('data:image/png;base64,AAAA')).toBeUndefined();
    expect(thumbBytes('data:image/jpeg;base64,!!!')).toBeUndefined();
    expect(thumbBytes(null)).toBeUndefined();
  });
});

describe('改名这种小改动', () => {
  it('改完马上换世界:上一个世界等着的先写,不被顶掉', async () => {
    const off = startWorldStore();
    try {
      const a = makeWorld();
      await offerWorldParts(await offerOf());
      const b = makeWorld();
      await offerWorldParts(await offerOf());
      openWorld(a);
      saveStore.renameWorld(a, '甲的新名字');
      openWorld(b);
      await _settled();
      expect((await readRevision(a))!.manifest.title).toBe('甲的新名字');
    } finally {
      off();
    }
  });

  it('没来得及写的(在我的世界里改别的世界的名字、关得太快),下次打开补上', async () => {
    const a = makeWorld();
    await offerWorldParts(await offerOf());
    const recipe = (await readRevision(a))!.head.recipeKey;
    openWorld(makeWorld());
    saveStore.renameWorld(a, '关之前改的');
    expect((await readRevision(a))!.manifest.title).toBeUndefined();
    await startConversions();
    await _settled();
    const r = (await readRevision(a))!;
    expect(r.manifest.title).toBe('关之前改的');
    expect(r.head.recipeKey).toBe(recipe);
    // 再转一遍不多存
    const n = r.head.n;
    await startConversions();
    await _settled();
    expect((await latestOf(a))!.n).toBe(n);
  });
});

describe('别的标签页把仓库全清了', () => {
  const clearFromOtherTab = () => (g.localStorage as FakeStorage).setItem('civ-atlas:vault-cleared', String(Date.now()));

  it('正在写的这一份写完了也不留', async () => {
    const id = makeWorld();
    const real = direct!;
    _setWorldStore({
      caller: ((op: keyof VaultOps, args: never) => {
        const p = (real as never as (o: string, a: never) => Promise<unknown>)(op, args);
        return op === 'commitWorld' ? p.then((r) => (clearFromOtherTab(), r)) : p;
      }) as never,
    });
    expect(await offerWorldParts(await offerOf())).toBe(false);
    await _settled();
    expect(await latestOf(id)).toBeNull();
  });

  it('正在转的停下来,写完了也不留,这次不再转别的', async () => {
    const o = sampleOriginal();
    const ids = [storeSave(o.save), storeSave({ ...o.save, title: '第二个' })];
    for (const id of ids) await putOriginal(id, o.parts, saveStore.loadWorld(id)!.save, o.generator);
    const seen: string[] = [];
    _setWorldStore({
      runner: (job) => {
        seen.push(job.id);
        return {
          done: runConvert(job, results).then((result) => {
            clearFromOtherTab();
            return { ok: true as const, result };
          }),
          stop: () => {},
        };
      },
    });
    await startConversions();
    expect(seen).toEqual([ids[0]]);
    expect(await latestOf(ids[0])).toBeNull();
    expect(await latestOf(ids[1])).toBeNull();
  }, 120_000);

  it('转到一半看到清了:关掉线程', async () => {
    const o = sampleOriginal();
    const id = storeSave(o.save);
    await putOriginal(id, o.parts, saveStore.loadWorld(id)!.save, o.generator);
    let stops = 0;
    _setWorldStore({
      runner: () => {
        let end: (v: 'stopped') => void = () => {};
        const done = new Promise<'stopped'>((r) => (end = r));
        setTimeout(clearFromOtherTab, 5);
        return {
          done,
          stop: () => {
            stops++;
            end('stopped');
          },
        };
      },
    });
    await startConversions();
    expect(stops).toBeGreaterThan(0);
    expect(await latestOf(id)).toBeNull();
  });
});

describe('仓库坏了,旧的存档和原件照常', () => {
  /** 一个永远失败的仓库 */
  const broken = (kind: string) => ((() => Promise.reject(Object.assign(new Error('坏了'), { kind }))) as unknown) as Parameters<typeof _setWorldStore>[0]['caller'];

  it.each(['failed', 'full', 'unavailable'])('仓库报 %s:存档、原件都存上,打开的世界不受影响,不抛错', async (kind) => {
    _setWorldStore({ caller: broken(kind) });
    const id = makeWorld();
    expect(await offerWorldParts(await offerOf())).toBe(false);
    const recipe = await recipeKey(recipeOfSave(saveStore.loadWorld(id)!.save));
    const snap: Snapshot = { format: SNAPSHOT_FORMAT, generator: GENERATOR_VERSION, recipe, formation: false, parts: [await makePart('map', { a: 1 }), await makePart('civ', { b: 2 })] };
    expect(await offerSnapshot(snap)).toBe(true);
    expect((await resultHeads(id)).length).toBe(1);
    expect(saveStore.loadWorld(id)).toBeTruthy();
    await expect(_syncLight(id)).resolves.toBeUndefined();
    await expect(pendingOf(id)).resolves.toBe('none');
    await expect(startConversions()).resolves.toBeUndefined();
    await expect(clearWorldStore()).resolves.toBeUndefined();
  });

  it('开不了线程(浏览器不给 Worker):照样不抛错', async () => {
    const worker = (globalThis as { Worker?: unknown }).Worker;
    (globalThis as { Worker?: unknown }).Worker = class {
      constructor() {
        throw new Error('不让开线程');
      }
    };
    try {
      _setWorldStore({ caller: null });
      const id = makeWorld();
      expect(await offerWorldParts(await offerOf())).toBe(false);
      expect(saveStore.loadWorld(id)).toBeTruthy();
    } finally {
      (globalThis as { Worker?: unknown }).Worker = worker;
    }
  });

  it('写满了:不删任何还在的世界,清掉的只有用的人删掉超过一小时的', async () => {
    const keep = makeWorld();
    await offerWorldParts(await offerOf());
    const gone = makeWorld();
    await offerWorldParts(await offerOf());
    openWorld(keep);
    saveStore.deleteWorld(gone);
    // 记成删了两小时
    const marks = saveStore.trashMarks();
    marks[gone] = Date.now() - 2 * 3600_000;
    (g.localStorage as FakeStorage).setItem('civ-atlas:trash', JSON.stringify(marks));
    const just = makeWorld();
    await offerWorldParts(await offerOf());
    openWorld(keep);
    saveStore.deleteWorld(just);

    const third = makeWorld();
    const real = direct!;
    _setWorldStore({
      caller: ((op: keyof VaultOps, args: never) => (op === 'commitWorld' ? Promise.reject(Object.assign(new Error('满了'), { kind: 'full' })) : (real as never as (o: string, a: never) => Promise<unknown>)(op, args))) as never,
    });
    openWorld(third);
    expect(await offerWorldParts(await offerOf())).toBe(false);
    await _settled();
    expect((await stateOf(third))?.full).toBeGreaterThan(0);
    expect((await latestOf(keep))?.n).toBe(1);
    expect(await latestOf(gone)).toBeNull();
    expect((await latestOf(just))?.n).toBe(1);
    expect(saveStore.loadWorld(keep)).toBeTruthy();
  });
});

describe('删世界', () => {
  it('删了再撤销:仓库里的内容还在,读回校验过', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    const d = saveStore.deleteWorld(id)!;
    await maintain();
    expect((await latestOf(id))?.n).toBe(1);
    expect(id in saveStore.trashMarks()).toBe(true);
    saveStore.restoreWorld(d);
    expect(id in saveStore.trashMarks()).toBe(false);
    // 过了 30 天也不清:已经撤销了
    await maintain(0, 0);
    expect((await latestOf(id))?.n).toBe(1);
    expect(await readRevision(id)).toBeTruthy();
  });

  it('撤销没成功(浏览器存储满了):世界还算删了,记录不划掉', async () => {
    const id = makeWorld();
    const d = saveStore.deleteWorld(id)!;
    const fake = g.localStorage as FakeStorage;
    const real = fake.setItem.bind(fake);
    fake.setItem = (k, v) => {
      if (k.startsWith('wenming-ditu:world:')) throw new DOMException('满了', 'QuotaExceededError');
      real(k, v);
    };
    expect(saveStore.restoreWorld(d)).toBe(false);
    fake.setItem = real;
    expect(id in saveStore.trashMarks()).toBe(true);
  });

  it('删了没撤销:留够日子才清,清了以后没人引用的块也清掉', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    openWorld(makeWorld());
    saveStore.deleteWorld(id);
    await maintain(TRASH_KEEP_MS, 0);
    expect((await latestOf(id))?.n).toBe(1);
    // 原件也存着:这个页面开了很久,没等到下次打开时清
    const save = makeSave(PARAMS, EMPTY_EDITS, check);
    await putOriginal(id, [await makePart('map', { a: 1 })], save, GENERATOR_VERSION);
    await maintain(0, 0);
    expect(await latestOf(id)).toBeNull();
    expect(id in saveStore.trashMarks()).toBe(false);
    expect(await resultHeads(id)).toEqual([]);
  });

  it('删了以后账号里又取回来了(列表里又有了):不清,记录划掉', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    const raw = saveStore.rawWorld(id)!;
    openWorld(makeWorld());
    saveStore.deleteWorld(id);
    saveStore.putSyncedWorld(id, raw);
    await maintain(0, 0);
    expect((await latestOf(id))?.n).toBe(1);
    expect(id in saveStore.trashMarks()).toBe(false);
  });

  it('另一台设备删的(同步来的):也记下,一样留够日子', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    openWorld(makeWorld());
    saveStore.removeSyncedWorld(id);
    expect(id in saveStore.trashMarks()).toBe(true);
    await maintain();
    expect((await latestOf(id))?.n).toBe(1);
  });

  it('不是用的人删的不清:浏览器清了 localStorage,列表空了,仓库里的一个都不动', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    saveStore.detachWorld();
    g.localStorage = new FakeStorage();
    saveStore._resetForTest();
    expect(saveStore.allWorldIds()).toEqual([]);
    await maintain(0, 0);
    expect((await latestOf(id))?.n).toBe(1);
    expect(await readRevision(id)).toBeTruthy();
  });

  it('浏览器存储用不了(只在内存里):不清', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    saveStore.deleteWorld(id);
    saveStore.detachWorld();
    g.localStorage = undefined;
    saveStore._resetForTest();
    expect(saveStore.persistent()).toBe(false);
    await maintain(0, 0);
    expect((await latestOf(id))?.n).toBe(1);
  });

  it('没建完的世界新建中又变回没动过:拿掉存档不算删世界', async () => {
    const id = saveStore.newWorldId();
    openWorld(id, { ...EMPTY_EDITS, names: { 'polity:c1#0': '甲' } }, 'draft');
    saveStore.attachWorld({ id, params: PARAMS, check, kind: 'draft', pristine: true, saved: getEdits() });
    expect(id in saveStore.trashMarks()).toBe(false);
  });

  it('退出登录选了从这台设备上删掉:全清', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    await clearWorldStore();
    expect(await latestOf(id)).toBeNull();
    expect(await revisionFile(id)).toBeNull();
    expect(saveStore.trashMarks()).toEqual({});
  });
});

// ---------------------------------------------------------------------------

/** 仓库里的样本(1.5.0 的第 57 版生成的)当成浏览器里的原件 */
function sampleOriginal(): { parts: SnapshotPart[]; save: SaveFile; generator: number } {
  const s = readSamples()[0];
  const parts = s.parts.map((p) => {
    const b = readFileSync(join(FIXTURE_DIR, p.file));
    return { name: p.name, bytes: p.bytes, sum: p.sum, zip: p.zip, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer } as SnapshotPart;
  });
  const save = makeSave({ ...DEFAULT_PARAMS, seed: s.seed, cells: s.cells }, { ...EMPTY_EDITS, endYear: s.endYear }, '', 'x', '2026-11-01T00:00:00.000Z');
  return { parts, save, generator: s.generator };
}

/** 把一份存档放进"我的世界"(不打开) */
function storeSave(save: SaveFile): string {
  const id = saveStore.importSave(save)!;
  expect(id).toBeTruthy();
  return id;
}

async function putOriginal(id: string, parts: SnapshotPart[], save: SaveFile, generator: number, app = '1.5.0', at = '2026-11-01T08:00:00.000Z') {
  const recipe = await recipeKey(recipeOfSave(save));
  await results.put({ id, generator, app, at, snapshot: { format: SNAPSHOT_FORMAT, generator, recipe, formation: false, parts } }, { id, generator, recipe, sums: '', size: 1, at });
}

describe('AI 正文', () => {
  const note = (key: string) => ({ key, kind: '史书', title: key, text: `${key} 的正文`, createdAt: '2026-11-04T00:00:00.000Z', provider: 'p', model: 'm' });

  it('老正文跟着转存那一遍转进来;写不进 localStorage 的、刷新以后再改名存一次,都还在', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    (g.localStorage as FakeStorage).setItem(`civ-atlas:ai-notes:${id}`, JSON.stringify([note('old')]));
    saveStore.detachWorld();
    await startConversions();
    await _settled();
    expect(await readAuthor(id)).toEqual({ notes: [note('old')] });

    // 刷新以后还没读到,就有一次存(改名)
    _resetNotes({ vault: { read: readAuthor, change: changeAuthor } });
    (g.localStorage as FakeStorage).removeItem(`civ-atlas:ai-notes:${id}`);
    saveStore.renameWorld(id, '新名字');
    await _syncLight(id);
    await _settled();
    expect((await readAuthor(id)).notes.map((n) => n.key)).toEqual(['old']);
    expect((await readRevision(id))!.manifest.title).toBe('新名字');
  });

  it('打开着的世界写了正文,马上进 author 块,不用等停下来、不写多余的块', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    const n0 = (await latestOf(id))!.n;
    putNote(id, note('a'));
    await _notesSettled();
    expect((await readAuthor(id)).notes.map((n) => n.key)).toEqual(['a']);
    expect((await latestOf(id))!.n).toBe(n0 + 1);
    expect((await latestOf(id))!.content).toBe((await revisionsOf(id))[0].content);
  });

  it('写正文的这一会儿别的标签页把仓库清了:这份不留', async () => {
    const id = makeWorld();
    await offerWorldParts(await offerOf());
    const write = notesVault.change(id, [{ op: 'put', note: note('a') }]);
    (g.localStorage as FakeStorage).setItem('civ-atlas:vault-cleared', String(Date.now()));
    await write;
    expect(await latestOf(id)).toBeNull();
    expect((await readAuthor(id)).notes).toEqual([]);
  });

  it('删世界真清掉的时候,等着的正文和记录一起清', async () => {
    const id = makeWorld();
    putNote(id, note('a'));
    await _notesSettled();
    saveStore.detachWorld();
    saveStore.deleteWorld(id);
    await maintain(0, 0);
    expect((await readAuthor(id)).notes).toEqual([]);
    expect((g.localStorage as FakeStorage).getItem('civ-atlas:ai-notes:~~moved')).toBeNull();
  });
});

describe('把现有的世界转进来', () => {
  it('有原件的:不重算,字节直接拿来;读出的地图和历史和原件一样;编年史、国旗是现在的代码算的;版本写真实的,提交号不编', async () => {
    const o = sampleOriginal();
    const id = storeSave(o.save);
    const save = saveStore.loadWorld(id)!.save;
    await putOriginal(id, o.parts, save, o.generator);
    await startConversions();

    const r = (await readRevision(id))!;
    expect(r.head.source).toBe('migrated');
    expect(r.manifest.made).toEqual({ app: '1.5.0', generator: o.generator, commit: '', at: '2026-11-01T08:00:00.000Z' });
    expect(r.manifest.readers).toEqual(FIRST_READERS);
    for (const name of ['map', 'civ']) expect(r.manifest.parts.find((p) => p.name === name)!.sum).toBe(o.parts.find((p) => p.name === name)!.sum);
    // 这个样本没有地形大事:空的 eras 不写
    expect(r.manifest.parts.some((p) => p.name === 'eras')).toBe(false);

    const content = await readWorldContent(await openWorldFile(await bytesOf((await revisionFile(id))!), { readers: READER_VERSIONS }));
    const map = (await readLocalPart(o.parts.find((p) => p.name === 'map')!)) as World;
    const history = (await readLocalPart(o.parts.find((p) => p.name === 'civ')!)) as ReturnType<typeof generateCiv>;
    expect(isDeepStrictEqual(content.map, map)).toBe(true);
    expect(isDeepStrictEqual(content.civ, history)).toBe(true);
    expect(isDeepStrictEqual(content.chronicle, worldChronicle(history))).toBe(true);
    expect(isDeepStrictEqual(content.flags, worldFlags(map, history))).toBe(true);
    // 原件一个字不动
    expect((await results.get(id, o.generator))!.snapshot.parts.map((p) => p.sum)).toEqual(o.parts.map((p) => p.sum));
  }, 120_000);

  it('转过的不再转;转的结果和再转一次一样', async () => {
    const o = sampleOriginal();
    const id = storeSave(o.save);
    await putOriginal(id, o.parts, saveStore.loadWorld(id)!.save, o.generator);
    await startConversions();
    await startConversions();
    expect((await revisionsOf(id)).length).toBe(1);
  }, 120_000);

  it('打开时发现块坏了(记了 corrupt):有原件的再转一遍,块重写,又读得出来', async () => {
    const o = sampleOriginal();
    const id = storeSave(o.save);
    const save = saveStore.loadWorld(id)!.save;
    await putOriginal(id, o.parts, save, o.generator);
    await startConversions();
    const before = (await revisionsOf(id)).length;
    await patchState(id, { corrupt: before });
    await startConversions();
    const heads = await revisionsOf(id);
    expect(heads.length).toBeGreaterThan(before);
    expect((await stateOf(id))?.corrupt).toBeUndefined();
    await readWorldContent(await openWorldFile(await bytesOf((await revisionFile(id))!), { readers: READER_VERSIONS }));
  }, 120_000);

  it('存档被新版重存过、更旧的原件还在:旧的留底,不当最新的', async () => {
    const o = sampleOriginal();
    // 存档是旧版本存的
    const old = { ...o.save, generator: GENERATOR_VERSION - 2 };
    const id = storeSave(old);
    const stored = saveStore.loadWorld(id)!.save;
    expect(stored.generator).toBe(GENERATOR_VERSION - 2);
    await putOriginal(id, o.parts, stored, GENERATOR_VERSION - 2, '1.3.0');
    // 打开、存成新版:旧的存档原文留底(originalOf)
    openWorld(id);
    saveStore.renameWorld(id, '新版存的');
    saveStore.detachWorld();
    const now = saveStore.loadWorld(id)!.save;
    expect(now.generator).toBe(GENERATOR_VERSION);
    await putOriginal(id, o.parts, now, GENERATOR_VERSION, '1.5.0');
    await startConversions();
    const heads = await revisionsOf(id);
    expect(heads.map((h) => [h.source, h.generator])).toEqual([
      ['archive', GENERATOR_VERSION - 2],
      ['migrated', GENERATOR_VERSION],
    ]);
    expect((await latestOf(id))!.generator).toBe(GENERATOR_VERSION);
    // 已经有新的修订以后才转到旧的,也不会顶掉新的
    await purgeWorld(id);
    expect((await latestOf(id))).toBeNull();
    await startConversions();
    expect((await latestOf(id))!.generator).toBe(GENERATOR_VERSION);
  }, 120_000);

  it('没原件的当前版本:按存档算一遍存下', async () => {
    const save = makeSave(PARAMS, { ...EMPTY_EDITS, endYear: 300 }, check, 'x', '2026-11-01T00:00:00.000Z');
    const id = storeSave(save);
    const jobs: ConvertJob[] = [];
    _setWorldStore({ runner: (job) => (jobs.push(job), { done: runConvert(job, results).then((result) => ({ ok: true as const, result })), stop: () => {} }) });
    await startConversions();
    expect(jobs.map((j) => j.kind)).toEqual(['recompute']);
    const h = await latestOf(id);
    expect(h).toMatchObject({ source: 'migrated', generator: GENERATOR_VERSION });
    const c = await readWorldContent(await openWorldFile(await bytesOf((await revisionFile(id))!), OPEN));
    expect(isDeepStrictEqual(c.civ, generateCiv(generateWorld(PARAMS), { endYear: 300 }))).toBe(true);
  }, 120_000);

  it('按存档算一遍:和生成世界的线程走同一段代码,带干预、地形大事、地形修改、逐年推演都对得上配方', async () => {
    const terrain = [{ kind: 'volcano', pts: [812, 403], r: 60, s: 1.5 }] as WorldEdits['terrain'];
    const params = PARAMS;
    const edits: WorldEdits = { ...EMPTY_EDITS, terrain, upheavals: [{ year: 200, ops: [{ kind: 'volcano', pts: [300, 200], r: 60, s: 1.5 }] }], endYear: 400 } as WorldEdits;
    const w0 = generateWorld(params, undefined, terrain);
    const save = makeSave(params, edits, worldCheck(w0), 'x', '2026-11-01T00:00:00.000Z');
    const out = recomputeWorld(save);
    expect(out.steps.length).toBe(1);
    expect(out.civ.eras?.length).toBe(1);
    expect(out.steps[0].key).toBe(keyOf(params, [...(terrain ?? []), ...edits.upheavals![0].ops], undefined));
    expect(eraWorlds(out.steps)![0].world.mesh).toBeUndefined();
    // 存档对不上算出来的地形:不当成它存
    expect(() => recomputeWorld({ ...save, check: 'not-this' })).toThrow();
  }, 120_000);

  it('没原件的更旧版本:不转、不做副本,只记下状态', async () => {
    const save = { ...makeSave(PARAMS, EMPTY_EDITS, check, 'x', '2026-11-01T00:00:00.000Z'), generator: GENERATOR_VERSION - 5 };
    const id = storeSave(save);
    const jobs: ConvertJob[] = [];
    _setWorldStore({ runner: (job) => (jobs.push(job), { done: Promise.resolve({ ok: true as const, result: { status: 'same' as const, n: 1 } }), stop: () => {} }) });
    await startConversions();
    expect(jobs).toEqual([]);
    expect(await latestOf(id)).toBeNull();
    expect(await stateOf(id)).toMatchObject({ status: 'old', generator: GENERATOR_VERSION - 5 });
  });

  it('只存了地图的、没建完的不转', async () => {
    const jobs: ConvertJob[] = [];
    _setWorldStore({ runner: (job) => (jobs.push(job), { done: Promise.resolve({ ok: true as const, result: { status: 'same' as const, n: 1 } }), stop: () => {} }) });
    const id = saveStore.newWorldId();
    openWorld(id, { ...EMPTY_EDITS, names: { 'polity:c1#0': '甲' } }, 'draft');
    saveStore.detachWorld();
    await startConversions();
    expect(jobs).toEqual([]);
  });

  it('转失败了记下,不反复试;原来的存档、原件不动', async () => {
    const o = sampleOriginal();
    const id = storeSave(o.save);
    await putOriginal(id, o.parts, saveStore.loadWorld(id)!.save, o.generator);
    let tries = 0;
    _setWorldStore({ runner: () => (tries++, { done: Promise.resolve({ ok: false as const, kind: 'failed' as const, message: '算错了' }), stop: () => {} }) });
    await startConversions();
    await startConversions();
    expect(tries).toBe(1);
    expect(await stateOf(id)).toMatchObject({ status: 'failed', error: '算错了' });
    expect(saveStore.loadWorld(id)).toBeTruthy();
    expect((await resultHeads(id)).length).toBe(1);
  });

  it('留底的旧版原件转失败:记下不再试,现在的样子照转', async () => {
    const o = sampleOriginal();
    const id = storeSave({ ...o.save, generator: GENERATOR_VERSION - 2 });
    const stored = saveStore.loadWorld(id)!.save;
    await putOriginal(id, o.parts, stored, GENERATOR_VERSION - 2, '1.3.0');
    openWorld(id);
    saveStore.renameWorld(id, '新版存的');
    saveStore.detachWorld();
    const now = saveStore.loadWorld(id)!.save;
    await putOriginal(id, o.parts, now, GENERATOR_VERSION, '1.5.0');
    const seen: string[] = [];
    _setWorldStore({
      runner: (job) => {
        seen.push(job.kind === 'original' ? job.source : job.kind);
        if (job.kind === 'original' && job.source === 'archive') return { done: Promise.resolve({ ok: false as const, kind: 'failed' as const, message: '旧的算不了' }), stop: () => {} };
        return { done: runConvert(job, results).then((result) => ({ ok: true as const, result })), stop: () => {} };
      },
    });
    await startConversions();
    await startConversions();
    expect(seen).toEqual(['archive', 'migrated']);
    expect((await latestOf(id))?.generator).toBe(GENERATOR_VERSION);
    expect((await stateOf(id))?.status).toBeUndefined();
    expect((await stateOf(id))?.archived).toEqual([GENERATOR_VERSION - 2]);
  }, 120_000);

  it('上次转的时候页面崩了:算失败,不再转,不然每次打开都崩', async () => {
    const o = sampleOriginal();
    const id = storeSave(o.save);
    await putOriginal(id, o.parts, saveStore.loadWorld(id)!.save, o.generator);
    (g.localStorage as FakeStorage).setItem('civ-atlas:converting', id);
    let tries = 0;
    _setWorldStore({ runner: () => (tries++, { done: Promise.resolve({ ok: true as const, result: { status: 'same' as const, n: 1 } }), stop: () => {} }) });
    await startConversions();
    expect(tries).toBe(0);
    expect((await stateOf(id))?.status).toBe('failed');
    expect((g.localStorage as FakeStorage).getItem('civ-atlas:converting')).toBeNull();
  });

  it('用的人在推演时让路:关掉线程,闲下来这个世界重来;关了页面下次接着转', async () => {
    const o = sampleOriginal();
    const ids = [storeSave(o.save), storeSave({ ...o.save, title: '第二个' })];
    for (const id of ids) await putOriginal(id, o.parts, saveStore.loadWorld(id)!.save, o.generator);
    let busy = false;
    setWorldStoreSim({ busy: () => busy, packNow: () => {} });
    const seen: string[] = [];
    let stops = 0;
    const real: ConvertRunner = (job) => ({ done: runConvert(job, results).then((result) => ({ ok: true as const, result })), stop: () => {} });
    let first = true;
    _setWorldStore({
      runner: (job) => {
        seen.push(job.id);
        if (!first) return real(job);
        first = false;
        // 第一个:用的人开始推演了
        let stop: (v: 'stopped') => void = () => {};
        const done = new Promise<'stopped'>((r) => (stop = r));
        busy = true;
        return {
          done,
          stop: () => {
            stops++;
            busy = false;
            stop('stopped');
          },
        };
      },
    });
    setWorldStoreSim({ busy: () => busy, packNow: () => {} });
    await startConversions();
    expect(stops).toBe(1);
    expect(seen[0]).toBe(seen[1]);
    for (const id of ids) expect((await latestOf(id))?.source).toBe('migrated');
    expect((await revisionsOf(ids[0])).length).toBe(1);
  }, 120_000);

  it('接着转:上次转完的不再转,只转剩下的', async () => {
    const o = sampleOriginal();
    const a = storeSave(o.save);
    const b = storeSave({ ...o.save, title: '第二个' });
    for (const id of [a, b]) await putOriginal(id, o.parts, saveStore.loadWorld(id)!.save, o.generator);
    await runConvert({ kind: 'original', id: a, generator: o.generator, save: saveStore.loadWorld(a)!.save, source: 'migrated' }, results);
    const seen: string[] = [];
    _setWorldStore({ runner: (job) => (seen.push(job.id), { done: runConvert(job, results).then((result) => ({ ok: true as const, result })), stop: () => {} }) });
    await startConversions();
    expect(seen).toEqual([b]);
  }, 120_000);

  it('写满了:这次不再转', async () => {
    const o = sampleOriginal();
    const ids = [storeSave(o.save), storeSave({ ...o.save, title: '第二个' })];
    for (const id of ids) await putOriginal(id, o.parts, saveStore.loadWorld(id)!.save, o.generator);
    let tries = 0;
    _setWorldStore({ runner: () => (tries++, { done: Promise.resolve({ ok: false as const, kind: 'full' as const, message: '满了' }), stop: () => {} }) });
    await startConversions();
    expect(tries).toBe(1);
    expect((await stateOf(ids[0]))?.status).toBeUndefined();
  });
});

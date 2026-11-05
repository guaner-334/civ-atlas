/**
 * 名单丢了,从世界仓库里认回来(src/worldRoster.ts、src/ui/worldStore.ts 的 rescueLostWorlds、src/ui/lostWorlds.ts)。
 * 最要紧的是反过来那一面:删掉的世界不能变回来,别的标签页手上的世界不能当成丢了的,撤销过的内容不能清。
 * 真的浏览器、真的写满硬盘见 scripts/world-files-check.ts 的 --only=roster。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetSessionForTest } from '../src/account/session';
import { setServerForTest } from '../src/account/server';
import { _notesSettled, _resetNotes } from '../src/ai/libraryVault';
import { generateCiv } from '../src/gen/civ';
import { EMPTY_EDITS, GENERATOR_VERSION, type WorldEdits } from '../src/gen/edits';
import { READER_VERSIONS } from '../src/gen/readers/versions';
import { makeSave, worldCheck } from '../src/gen/savefile';
import { makePart, recipeKey, recipeOfSave } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { clearEdits, getEdits, setEdits } from '../src/ui/editsStore';
import { lostWorldsHere } from '../src/ui/lostWorlds';
import { _setResultBackend, dropOrphans, memoryResults, resultHeads } from '../src/ui/resultStore';
import * as saveStore from '../src/ui/saveStore';
import { _resetToasts, peekToast } from '../src/ui/toastStore';
import { _setWorldFiles, keepWorldFile, lookWorldFile } from '../src/ui/worldFiles';
import { _setHolds, holdWorld } from '../src/ui/worldHolds';
import { TRASH_KEEP_MS, _setWorldStore, _settled, clearTrashNow, clearWorldStore, holdTrashed, maintain, noteListed, offerWorldParts, rescueLostWorlds, trashFreed, trashInfo } from '../src/ui/worldStore';
import { lookFile } from '../src/worldFileLook';
import { rosterStep } from '../src/worldRoster';
import { mapValue, worldChronicle, worldFlags } from '../src/worldRun';
import { _resetVault, latestOf, patchState, readRevision, revisionFile, stateOf, vaultOps, type VaultOps } from '../src/worldVault';

vi.setConfig({ testTimeout: 30_000 });

class FakeStorage {
  map = new Map<string, string>();
  full = false;
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
    if (this.full && k !== 'wenming-ditu:probe') throw Object.assign(new Error('满了'), { name: 'QuotaExceededError' });
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

class FakeLocks {
  held = new Map<string, { mode: string }[]>();
  async request(name: string, a: LockOptions | ((l: unknown) => unknown), b?: (l: unknown) => unknown): Promise<unknown> {
    const o = typeof a === 'function' ? {} : a;
    const f = (typeof a === 'function' ? a : b)!;
    const list = this.held.get(name) ?? [];
    const free = !list.length || (o.mode === 'shared' && list.every((x) => x.mode === 'shared'));
    if (!free && o.ifAvailable) return f(null);
    const me = { mode: o.mode ?? 'exclusive' };
    this.held.set(name, [...list, me]);
    try {
      return await f(me);
    } finally {
      this.held.set(name, (this.held.get(name) ?? []).filter((x) => x !== me));
    }
  }
  async query() {
    return { held: [...this.held].flatMap(([name, l]) => l.map((x) => ({ name, mode: x.mode }))), pending: [] };
  }
}

const g = globalThis as unknown as { localStorage: FakeStorage; indexedDB: IDBFactory };
type Caller = NonNullable<Parameters<typeof _setWorldStore>[0]['caller']>;
const direct = ((op: keyof VaultOps, args: unknown[]) => (vaultOps[op] as (...a: unknown[]) => Promise<unknown>)(...args)) as unknown as Caller;
const PARAMS = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
const JPEG = 'data:image/jpeg;base64,/9j/wAALCAAYADABAREA/9k=';

let world: World;
let check: string;
let civ: ReturnType<typeof generateCiv>;
let locks: FakeLocks;
let stopAuto: (() => void) | null = null;

beforeAll(() => {
  world = generateWorld(PARAMS);
  check = worldCheck(world);
  civ = generateCiv(world, { endYear: 300 });
}, 120_000);

function openWorld(id: string, edits: WorldEdits = EMPTY_EDITS) {
  saveStore.detachWorld();
  clearEdits();
  const stored = saveStore.loadWorld(id);
  const e = stored?.save.edits ?? edits;
  setEdits(e);
  saveStore.attachWorld({ id, params: PARAMS, check, kind: 'created', saved: stored?.save.edits ?? e });
}

/** 建好一个世界,内容存进仓库 */
async function makeWorld(title: string): Promise<string> {
  const id = saveStore.newWorldId();
  openWorld(id, { ...EMPTY_EDITS, endYear: 300 });
  saveStore.markCreated();
  saveStore.renameWorld(id, title);
  const edits = getEdits();
  const recipe = await recipeKey(recipeOfSave(makeSave(PARAMS, edits, check)));
  const parts = [await makePart('map', mapValue(world)), await makePart('civ', civ), await makePart('chronicle', worldChronicle(civ, edits.characters)), await makePart('flags', worldFlags(world, civ))];
  expect(await offerWorldParts({ generator: GENERATOR_VERSION, recipe, parts })).toBe(true);
  await later();
  return id;
}

/** 让后台排着的做完(删除、撤销记进仓库那一笔是异步的) */
const later = async (ms = 20) => {
  await new Promise((r) => setTimeout(r, ms));
  await _settled();
  await new Promise((r) => setTimeout(r, ms));
};

/** 像刷新了页面:正开着的世界没了,这个标签页记的东西也没了 */
function reload() {
  saveStore.detachWorld();
  saveStore._resetForTest();
  _setWorldStore({});
  _setHolds({ locks: locks as unknown as LockManager });
}

const WORLD_KEYS = ['wenming-ditu:world:', 'wenming-ditu:thumb:', 'wenming-ditu:meta:', 'wenming-ditu:mapthumb:', 'wenming-ditu:orig:', 'civ-atlas:ai-notes:'];

/** 名单上少了这个世界(localStorage 被回退、被清掉一部分) */
function lose(...ids: string[]) {
  for (const id of ids) for (const p of WORLD_KEYS) g.localStorage.removeItem(p + id);
}

const loseTrash = () => g.localStorage.removeItem(saveStore.TRASH);
/** localStorage 现在的样子;回退时原样放回去 */
const snapshot = () => new Map(g.localStorage.map);
const rollback = (to: Map<string, string>) => {
  g.localStorage.map = new Map(to);
};

beforeEach(() => {
  g.localStorage = new FakeStorage();
  g.indexedDB = new IDBFactory();
  _resetVault();
  saveStore._resetForTest();
  _resetNotes({ vault: { read: vaultOps.readAuthor, change: vaultOps.changeAuthor } });
  _resetToasts();
  clearEdits();
  stopAuto = saveStore.startAutoSave();
  _setResultBackend(memoryResults());
  locks = new FakeLocks();
  _setHolds({ locks: locks as unknown as LockManager });
  vi.stubGlobal('navigator', { locks });
  _setWorldStore({ caller: direct, timing: { quiet: 0, poll: 1, pause: 0, holdGap: 0 } });
  _setWorldFiles({ once: direct, look: (f) => lookFile(f, { readers: READER_VERSIONS }) });
});

afterEach(async () => {
  stopAuto?.();
  stopAuto = null;
  saveStore.detachWorld();
  await _notesSettled();
  await later(5);
  setServerForTest(undefined);
  _resetSessionForTest();
  _setResultBackend(undefined);
  _setWorldFiles({});
  _setHolds();
  _setWorldStore({ caller: null });
  _resetVault();
  vi.unstubAllGlobals();
});

describe('判断规则', () => {
  it('五种情况', () => {
    // 有删除记录:撤销的就是这一次才算撤销过
    expect(rosterStep({ deleted: 5, undid: 5, listed: 1 }, 5, false)).toBe('rescue');
    expect(rosterStep({ deleted: 5, listed: 1 }, 5, false)).toBe('deleted');
    expect(rosterStep({ deleted: 9, undid: 5, listed: 1 }, 9, false)).toBe('deleted');
    expect(rosterStep(null, 5, false)).toBe('deleted');
    // 删、撤销、再删,回退到第一次的删除记录:后来那次删除还算数
    expect(rosterStep({ deleted: 9, undid: 5, listed: 1 }, 5, false)).toBe('deleted');
    // 记录丢了,仓库记着删了
    expect(rosterStep({ deleted: 5, listed: 1 }, undefined, false)).toBe('remark');
    expect(rosterStep({ deleted: 9, undid: 5, listed: 1 }, undefined, false)).toBe('remark');
    // 名单丢了
    expect(rosterStep({ listed: 1 }, undefined, false)).toBe('rescue');
    expect(rosterStep({ deleted: 5, undid: 5, listed: 1 }, undefined, false)).toBe('rescue');
    expect(rosterStep({ listed: 1 }, undefined, true)).toBe('account');
    // 说不清
    expect(rosterStep(null, undefined, false)).toBe('unsure');
    expect(rosterStep({ status: 'old' } as never, undefined, false)).toBe('unsure');
  });
});

describe('名单丢了,认回来', () => {
  it('少了几个:回到列表,内容、名字、封面、现存几国都在,别的世界不动;再对一遍不重复', async () => {
    const a = await makeWorld('甲');
    saveStore.setWorldStats(12);
    g.localStorage.setItem(`wenming-ditu:thumb:${a}`, JPEG);
    // 封面、现存几国写进新的一份
    saveStore.renameWorld(a, '甲改名');
    await vaultOps.commitWorld({ id: a, recipe: saveStore.loadWorld(a)!.save, recipeKey: (await latestOf(a))!.recipeKey, thumb: Uint8Array.from(atob(JPEG.split(',')[1]), (c) => c.charCodeAt(0)) });
    await rescueLostWorlds();
    const b = await makeWorld('乙');
    const c = await makeWorld('丙');
    const before = await readRevision(a);
    const keptC = g.localStorage.getItem(`wenming-ditu:world:${c}`);
    reload();
    lose(a, b);
    expect(saveStore.storedIds()).toEqual([c]);
    expect(await lostWorldsHere()).toBe(true);

    const r = await rescueLostWorlds();
    expect(new Set(r.rescued)).toEqual(new Set([a, b]));
    expect(new Set(saveStore.storedIds())).toEqual(new Set([a, b, c]));
    const back = saveStore.loadWorld(a)!;
    expect(back.save.title).toBe('甲改名');
    expect(back.alive).toBe(12);
    expect(back.thumb).toBe(JPEG);
    expect(back.draft).toBe(false);
    const after = await readRevision(a);
    expect(after!.head).toEqual(before!.head);
    expect(after!.parts.map((p) => p.info.sum)).toEqual(before!.parts.map((p) => p.info.sum));
    expect(g.localStorage.getItem(`wenming-ditu:world:${c}`)).toBe(keptC);

    expect(await lostWorldsHere()).toBe(false);
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.storedIds().length).toBe(3);
  });

  it('localStorage 整个清了:全部回来', async () => {
    const a = await makeWorld('甲');
    const b = await makeWorld('乙');
    reload();
    g.localStorage = new FakeStorage();
    saveStore._resetForTest();
    expect(new Set((await rescueLostWorlds()).rescued)).toEqual(new Set([a, b]));
    expect(saveStore.loadWorld(a)!.save.title).toBe('甲');
  });

  it('什么记号都没有的内容:说不清,不认也不清', async () => {
    const a = await makeWorld('甲');
    await patchState(a, { listed: undefined, alive: undefined });
    reload();
    lose(a);
    expect(await lostWorldsHere()).toBe(false);
    const r = await rescueLostWorlds();
    expect(r.unsure).toEqual([a]);
    expect(saveStore.loadWorld(a)).toBeNull();
    await maintain(0);
    await clearTrashNow();
    expect(await latestOf(a)).not.toBeNull();
  });

  it('首页:仓库没有、库还不存在,看一眼不把库建出来', async () => {
    expect(await lostWorldsHere()).toBe(false);
    expect(await g.indexedDB.databases()).toEqual([]);
  });

  it('列表满了:不认,内容留着,腾出地方下次认', async () => {
    const a = await makeWorld('甲');
    reload();
    lose(a);
    for (let i = 0; i < saveStore.MAX_WORLDS; i++) saveStore.importSave(makeSave({ ...PARAMS, seed: 1000 + i }, EMPTY_EDITS, `c${i}`, `占位${i}`));
    expect(saveStore.storedCount()).toBe(saveStore.MAX_WORLDS);
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.storedCount()).toBe(saveStore.MAX_WORLDS);
    expect(await latestOf(a)).not.toBeNull();
    saveStore.removeSyncedWorld(saveStore.storedIds()[0]);
    expect((await rescueLostWorlds()).rescued).toEqual([a]);
  });

  it('名单写不进去:不报错、不提示,这一遍不再试别的;下次打开有地方了就认', async () => {
    const a = await makeWorld('甲');
    const b = await makeWorld('乙');
    reload();
    lose(a, b);
    g.localStorage.full = true;
    const r = await rescueLostWorlds();
    expect(r.rescued).toEqual([]);
    expect(peekToast('storage')).toBeNull();
    expect(await latestOf(a)).not.toBeNull();
    g.localStorage.full = false;
    expect(new Set((await rescueLostWorlds()).rescued)).toEqual(new Set([a, b]));
  });

  it('打不开库:什么也不做,不抛错', async () => {
    const a = await makeWorld('甲');
    reload();
    lose(a);
    _setWorldStore({ caller: (() => Promise.reject(Object.assign(new Error('满了'), { kind: 'full' }))) as never });
    expect(await rescueLostWorlds()).toEqual({ rescued: [], deleted: [], unsure: [] });
    expect(saveStore.loadWorld(a)).toBeNull();
    _setWorldStore({ caller: direct });
  });

  it('打开文件放进来的世界:放好就算在名单上过', async () => {
    const a = await makeWorld('甲');
    const looked = await lookWorldFile((await revisionFile(a))!);
    if (!looked.ok) throw new Error(looked.message);
    const kept = await keepWorldFile(looked);
    if (!kept.ok) throw new Error(kept.message);
    await later();
    reload();
    lose(kept.id);
    expect((await rescueLostWorlds()).rescued).toEqual([kept.id]);
  });
});

describe('删了的不回来', () => {
  it('提示收起了:不认;记录也丢了也不认,记录补回来,时间还是原来的,到期照清', async () => {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    const gone = saveStore.deleteWorld(a)!;
    trashFreed(a);
    await later();
    reload();
    expect(await lostWorldsHere()).toBe(false);
    expect((await rescueLostWorlds()).deleted).toEqual([a]);
    expect(saveStore.loadWorld(a)).toBeNull();

    loseTrash();
    expect(await lostWorldsHere()).toBe(true);
    const r = await rescueLostWorlds();
    expect(r.rescued).toEqual([]);
    expect(r.deleted).toEqual([a]);
    expect(saveStore.loadWorld(a)).toBeNull();
    expect(saveStore.trashMarks()[a]).toBe(gone.at);
    await maintain(TRASH_KEEP_MS);
    expect(await latestOf(a)).not.toBeNull();
    await maintain(0);
    expect(await latestOf(a)).toBeNull();
  });

  it('提示还开着:不认,内容不清;没等提示收起就关了页面:还是删了;记录也丢了也不认', async () => {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    saveStore.deleteWorld(a);
    const free = holdWorld(a);
    await later();
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.loadWorld(a)).toBeNull();
    expect(await latestOf(a)).not.toBeNull();
    free();
    reload();
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.loadWorld(a)).toBeNull();
    loseTrash();
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.loadWorld(a)).toBeNull();
  });

  it('别的设备上删的:不认;可以马上腾地方', async () => {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    saveStore.removeSyncedWorld(a);
    await later();
    reload();
    loseTrash();
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.loadWorld(a)).toBeNull();
    expect((await stateOf(a))?.settled).toBe(saveStore.trashMarks()[a]);
  });

  it('删、撤销、再删:只认最后这次', async () => {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    const one = saveStore.deleteWorld(a)!;
    await later(3);
    saveStore.restoreWorld(one);
    await later(3);
    await new Promise((r) => setTimeout(r, 2));
    saveStore.deleteWorld(a);
    await later();
    reload();
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    loseTrash();
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.loadWorld(a)).toBeNull();
  });

  it('删、撤销、再删,回退到第一次的删除记录:不认,到期能清', async () => {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    const one = saveStore.deleteWorld(a)!;
    await later();
    const first = snapshot();
    saveStore.restoreWorld(one);
    await later();
    await new Promise((r) => setTimeout(r, 2));
    const two = saveStore.deleteWorld(a)!;
    expect(two.at).not.toBe(one.at);
    await later();
    reload();
    rollback(first);
    expect(saveStore.trashMarks()[a]).toBe(one.at);
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.loadWorld(a)).toBeNull();
    await maintain(0);
    expect(await latestOf(a)).toBeNull();
  });

  it('删了以后又回到名单上(账号里取回来的):现在算在名单上,之后名单丢了能认回来', async () => {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    const raw = saveStore.rawWorld(a)!;
    saveStore.deleteWorld(a);
    trashFreed(a);
    await later();
    saveStore.putSyncedWorld(a, raw);
    saveStore.unmarkTrash(a);
    await rescueLostWorlds();
    expect((await stateOf(a))?.undid).toBe((await stateOf(a))?.deleted);
    reload();
    lose(a);
    expect((await rescueLostWorlds()).rescued).toEqual([a]);
  });

  it('删除那一笔没记下、记录也丢了(浏览器写不进去又回退):这一种认不出来,算名单丢了', async () => {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    _setWorldStore({ caller: ((op: keyof VaultOps, args: never) => (op === 'patchState' ? Promise.reject(new Error('写不进')) : (direct as never as (o: string, x: never) => Promise<unknown>)(op, args))) as never });
    saveStore.deleteWorld(a);
    await later();
    _setWorldStore({ caller: direct });
    reload();
    loseTrash();
    expect(rosterStep(await stateOf(a), undefined, false)).toBe('rescue');
  });
});

describe('撤销过,记录被回退了', () => {
  async function undoneThenRolledBack() {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    const gone = saveStore.deleteWorld(a)!;
    await later();
    const deletedState = snapshot();
    expect(saveStore.restoreWorld(gone)).toBe(true);
    await later();
    reload();
    rollback(deletedState);
    expect(saveStore.loadWorld(a)).toBeNull();
    expect(a in saveStore.trashMarks()).toBe(true);
    return a;
  }

  it('认回来,删除记录划掉,内容都在', async () => {
    const a = await undoneThenRolledBack();
    const before = await readRevision(a);
    expect(await lostWorldsHere()).toBe(true);
    expect((await rescueLostWorlds()).rescued).toEqual([a]);
    expect(saveStore.loadWorld(a)!.save.title).toBe('甲');
    expect(a in saveStore.trashMarks()).toBe(false);
    expect((await readRevision(a))!.head).toEqual(before!.head);
  });

  it('认回来之前,清理的哪条路都不清:到期的、存储紧张的、「现在清掉」、原件', async () => {
    const a = await undoneThenRolledBack();
    const results = memoryResults();
    _setResultBackend(results);
    await results.put({ id: a, generator: GENERATOR_VERSION, app: 'x', at: '2026-11-04T00:00:00.000Z', snapshot: { format: 1, generator: GENERATOR_VERSION, recipe: 'r', formation: false, parts: [] } }, { id: a, generator: GENERATOR_VERSION, recipe: 'r', sums: '', size: 1000, at: '2026-11-04T00:00:00.000Z' });
    await maintain(0);
    expect(await latestOf(a)).not.toBeNull();
    const cl = await clearTrashNow();
    expect(cl.cleared).toEqual([]);
    expect(cl.kept).toEqual([a]);
    expect(await latestOf(a)).not.toBeNull();
    await dropOrphans();
    expect((await resultHeads(a)).length).toBe(1);
    expect(await trashInfo()).toMatchObject({ count: 0, bytes: 0, held: 0 });
    expect((await rescueLostWorlds()).rescued).toEqual([a]);
  });

  it('删掉的世界的个数:等着认回来的不算,「现在清掉」也不清它', async () => {
    const a = await undoneThenRolledBack();
    const b = await makeWorld('乙');
    openWorld(await makeWorld('丙'));
    const gone = saveStore.deleteWorld(b)!;
    expect(gone.id).toBe(b);
    const info = await trashInfo();
    expect(info.count).toBe(1);
    expect(info.ids).toEqual([b]);
    const cl = await clearTrashNow();
    expect(cl.cleared).toEqual([b]);
    expect(cl.kept).toEqual([a]);
    expect(await latestOf(a)).not.toBeNull();
    expect(await trashInfo()).toMatchObject({ count: 0, ids: [] });
    expect((await rescueLostWorlds()).rescued).toEqual([a]);
  });

  it('撤销那一笔也没记下(写不进仓库):分不出来,不认;没人点就留够 30 天,用的人自己点「现在清掉」才清', async () => {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    const gone = saveStore.deleteWorld(a)!;
    await later();
    const deletedState = snapshot();
    _setWorldStore({ caller: ((op: keyof VaultOps, args: never) => (op === 'patchState' ? Promise.reject(new Error('写不进')) : (direct as never as (o: string, x: never) => Promise<unknown>)(op, args))) as never });
    saveStore.restoreWorld(gone);
    await later();
    _setWorldStore({ caller: direct });
    reload();
    rollback(deletedState);
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(await lostWorldsHere()).toBe(false);
    await maintain(TRASH_KEEP_MS);
    expect(await latestOf(a)).not.toBeNull();
    // 存储紧张,自动腾地方也不清它
    vi.stubGlobal('navigator', { locks, storage: { estimate: () => Promise.resolve({ usage: 1e9, quota: 1e9 + 1 }) } });
    holdTrashed(a)();
    await later(30);
    expect(await latestOf(a)).not.toBeNull();
    expect((await clearTrashNow()).cleared).toEqual([a]);
    expect(await latestOf(a)).toBeNull();
  });

  it('撤销那一笔写不进仓库,这次打开里腾出了地方:补上,回退了也认得出来', async () => {
    let broken = false;
    _setWorldStore({ caller: ((op: keyof VaultOps, args: never) => (broken && op === 'patchState' ? Promise.reject(new Error('写不进')) : (direct as never as (o: string, x: never) => Promise<unknown>)(op, args))) as never });
    const a = await makeWorld('甲');
    const other = await makeWorld('乙');
    openWorld(await makeWorld('丙'));
    const gone = saveStore.deleteWorld(a)!;
    saveStore.deleteWorld(other);
    await later();
    const deletedState = snapshot();
    broken = true;
    saveStore.restoreWorld(gone);
    await later();
    expect((await stateOf(a))?.undid).toBeUndefined();
    broken = false;
    // 清掉删掉的世界腾出了地方
    expect((await clearTrashNow()).cleared).toEqual([other]);
    await later();
    expect((await stateOf(a))?.undid).toBe(gone.at);
    reload();
    rollback(deletedState);
    expect((await rescueLostWorlds()).rescued).toContain(a);
  });

  it('上一次撤销没写成,这一次写成了:补写不能拿旧的盖掉新的', async () => {
    let broken = false;
    _setWorldStore({ caller: ((op: keyof VaultOps, args: never) => (broken && op === 'patchState' ? Promise.reject(new Error('写不进')) : (direct as never as (o: string, x: never) => Promise<unknown>)(op, args))) as never });
    const a = await makeWorld('甲');
    const other = await makeWorld('乙');
    openWorld(await makeWorld('丙'));
    saveStore.deleteWorld(other);
    const one = saveStore.deleteWorld(a)!;
    await later();
    broken = true;
    saveStore.restoreWorld(one);
    await later();
    broken = false;
    await new Promise((r) => setTimeout(r, 2));
    const two = saveStore.deleteWorld(a)!;
    await later();
    const second = snapshot();
    saveStore.restoreWorld(two);
    await later();
    // 腾出了地方:排着的补写一遍
    expect((await clearTrashNow()).cleared).toEqual([other]);
    await later();
    expect((await stateOf(a))?.undid).toBe(two.at);
    expect((await stateOf(a))?.deleted).toBe(two.at);
    reload();
    rollback(second);
    expect((await rescueLostWorlds()).rescued).toContain(a);
  });
});

describe('存储紧张时自动清', () => {
  const tight = () => vi.stubGlobal('navigator', { locks, storage: { estimate: () => Promise.resolve({ usage: 1e9, quota: 1e9 + 1 }) } });

  it('提示收起了就清;那一笔写不进仓库也清(这个标签页亲眼看着收起的)', async () => {
    tight();
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    saveStore.deleteWorld(a);
    await later();
    const real = direct as never as (o: string, x: never) => Promise<unknown>;
    _setWorldStore({ caller: ((op: keyof VaultOps, args: never) => (op === 'patchState' ? Promise.reject(new Error('写不进')) : real(op, args))) as never });
    trashFreed(a);
    for (let i = 0; i < 40 && (await latestOf(a)); i++) await later(5);
    expect(await latestOf(a)).toBeNull();
    _setWorldStore({ caller: direct });
  });

  it('别的标签页收起的:记在仓库里,这边也认', async () => {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    const at = saveStore.deleteWorld(a)!.at!;
    await patchState(a, { settled: at });
    reload();
    tight();
    holdTrashed(a)();
    for (let i = 0; i < 40 && (await latestOf(a)); i++) await later(5);
    expect(await latestOf(a)).toBeNull();
  });

  it('从没在名单上过的(打开文件半路崩了):不用等提示收起', async () => {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    saveStore.markTrash(a);
    lose(a);
    await patchState(a, { listed: undefined });
    reload();
    tight();
    holdTrashed(a)();
    for (let i = 0; i < 40 && (await latestOf(a)); i++) await later(5);
    expect(await latestOf(a)).toBeNull();
  });
});

describe('退出登录全清', () => {
  it('全清以后不回来', async () => {
    const a = await makeWorld('甲');
    saveStore.detachWorld();
    expect(saveStore.removeAllWorlds()).toBe(true);
    await clearWorldStore();
    reload();
    expect(await lostWorldsHere()).toBe(false);
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.loadWorld(a)).toBeNull();
  });

  it('仓库没能清掉、还没来得及清:不回来;之后新存的世界照常', async () => {
    const a = await makeWorld('甲');
    saveStore.detachWorld();
    await new Promise((r) => setTimeout(r, 2));
    expect(saveStore.removeAllWorlds()).toBe(true);
    reload();
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.loadWorld(a)).toBeNull();
    await new Promise((r) => setTimeout(r, 2));
    const b = await makeWorld('乙');
    reload();
    lose(b);
    expect((await rescueLostWorlds()).rescued).toEqual([b]);
    expect(saveStore.loadWorld(a)).toBeNull();
  });

  it('正在认的这一会儿别的标签页全清了:不写进名单', async () => {
    const a = await makeWorld('甲');
    reload();
    lose(a);
    const real = direct as never as (o: string, x: never) => Promise<unknown>;
    _setWorldStore({
      caller: (async (op: keyof VaultOps, args: never) => {
        const v = await real(op, args);
        if (op === 'rosterCopy') {
          saveStore.removeAllWorlds();
        }
        return v;
      }) as never,
    });
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.loadWorld(a)).toBeNull();
    _setWorldStore({ caller: direct });
  });
});

describe('别的标签页手上的不当成丢了的', () => {
  it('别的标签页开着它、正在写它:这次不认,放开了下次认', async () => {
    const a = await makeWorld('甲');
    reload();
    lose(a);
    let release = () => {};
    void locks.request(`civ-atlas:world-hold:${a}`, { mode: 'shared' }, () => new Promise<void>((r) => (release = r)));
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.loadWorld(a)).toBeNull();
    release();
    await later(5);
    expect((await rescueLostWorlds()).rescued).toEqual([a]);
  });

  it('这个标签页正开着它:不认,不打断正开着的世界', async () => {
    const a = await makeWorld('甲');
    lose(a);
    await rescueLostWorlds();
    expect(saveStore.currentWorld()?.id).toBe(a);
  });

  it('别的标签页正在对:这边这次不对;同一个标签页同时叫两次只对一遍', async () => {
    const a = await makeWorld('甲');
    reload();
    lose(a);
    let release = () => {};
    void locks.request('civ-atlas:roster', {}, () => new Promise<void>((r) => (release = r)));
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    release();
    await later(5);
    const [x, y] = await Promise.all([rescueLostWorlds(), rescueLostWorlds()]);
    expect(x.rescued).toEqual([a]);
    expect(y).toBe(x);
    expect(saveStore.storedIds()).toEqual([a]);
  });

  it('打开文件放进来的半路(仓库写了、名单还没写):不当成丢了的', async () => {
    const a = await makeWorld('甲');
    const looked = await lookWorldFile((await revisionFile(a))!);
    if (!looked.ok) throw new Error(looked.message);
    const seen: { rescued: string[]; deleted: string[] }[] = [];
    _setWorldFiles({
      once: ((op: keyof VaultOps, args: unknown[]) => {
        if (op !== 'adoptFile') return (vaultOps[op] as (...x: unknown[]) => Promise<unknown>)(...args);
        return (vaultOps.adoptFile as (...x: unknown[]) => Promise<unknown>)(...args).then(async (r) => {
          seen.push(await rescueLostWorlds());
          return r;
        });
      }) as never,
      look: (f) => lookFile(f, { readers: READER_VERSIONS }),
    });
    const before = saveStore.storedCount();
    const kept = await keepWorldFile(looked);
    if (!kept.ok) throw new Error(kept.message);
    expect(seen[0].rescued).toEqual([]);
    expect(saveStore.storedCount()).toBe(before + 1);
    expect(saveStore.storedIds().filter((x) => x === kept.id).length).toBe(1);
  });

  it('删的同一刻转存刚写完:不会被记成在名单上', async () => {
    const a = await makeWorld('甲');
    await patchState(a, { listed: undefined });
    openWorld(await makeWorld('乙'));
    saveStore.deleteWorld(a);
    noteListed(a);
    await later();
    await rescueLostWorlds();
    expect((await stateOf(a))?.listed).toBeUndefined();
    expect(saveStore.loadWorld(a)).toBeNull();
  });
});

describe('登录了', () => {
  function signIn() {
    setServerForTest('http://fake-server.test');
    g.localStorage.setItem('civ-atlas:account', JSON.stringify({ token: 't', user: { id: 'u1', account: 'a@example.com' } }));
    _resetSessionForTest();
  }

  it('名单丢了:账号里有,等同步取回来,这里不认', async () => {
    const a = await makeWorld('甲');
    reload();
    lose(a);
    signIn();
    expect(await lostWorldsHere()).toBe(false);
    expect((await rescueLostWorlds()).rescued).toEqual([]);
    expect(saveStore.loadWorld(a)).toBeNull();
    expect(await latestOf(a)).not.toBeNull();
  });

  it('撤销过、记录被回退了:照样认(和撤销一样)', async () => {
    const a = await makeWorld('甲');
    openWorld(await makeWorld('乙'));
    const gone = saveStore.deleteWorld(a)!;
    await later();
    const deletedState = snapshot();
    saveStore.restoreWorld(gone);
    await later();
    reload();
    rollback(deletedState);
    signIn();
    expect((await rescueLostWorlds()).rescued).toEqual([a]);
  });
});

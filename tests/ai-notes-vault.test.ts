/**
 * AI 正文搬进世界仓库(src/ai/library.ts 用 src/worldVault.ts 的 author 块):
 * localStorage 满了也存得下、老数据转进去、仓库坏了不丢、「没读到」和「用的人删了」分得清、超长的正文不连累整个世界。
 * 刷新页面 = _resetNotes(内存里的都不要了,localStorage 和仓库还在)。IndexedDB 用 fake-indexeddb。
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { copyNotes, deleteNote, exportNotes, flushNotes, getNote, notesBehind, notesKnown, notesReady, notesSaved, putNote, replaceNotes, type AiNote } from '../src/ai/library';
import { _notesSettled, _resetNotes, moveNotes, tidyNotes, type NotesVault } from '../src/ai/libraryVault';
import { mergeNotes, type NoteOp } from '../src/authorNotes';
import { makeSave } from '../src/gen/savefile';
import { partBytes, sha256, unpackValue, type SnapshotPart } from '../src/gen/snapshot';
import { openWorldFile, packWorldFile, packWorldParts, readWorldContent, rewriteWorldFile, type PackInput, type WorldEras } from '../src/gen/worldFile';
import { DEFAULT_PARAMS } from '../src/gen/world';
import * as saveStore from '../src/ui/saveStore';
import { VAULT_DB, VaultError, _resetVault, adoptFile, changeAuthor, commitWorld, patchState, purgeWorld, readAuthor, readRevision, revisionFile, revisionsOf, sweepParts, vaultOps } from '../src/worldVault';
import { MADE, READERS, bytesOf, makeSample } from './lib/worldFileSample';

const PREFIX = 'civ-atlas:ai-notes:';
const MOVED = `${PREFIX}~~moved`;
const DAY = 24 * 3600_000;
const OPEN = { readers: READERS };

/** 和浏览器一样有总量上限的 localStorage(按字符数算,写不下抛 QuotaExceededError) */
class FakeStorage {
  map = new Map<string, string>();
  constructor(public quota = Infinity) {}
  get used() {
    let n = 0;
    for (const [k, v] of this.map) n += k.length + v.length;
    return n;
  }
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
    if (this.used - (this.map.get(k)?.length ?? 0) - (this.map.has(k) ? k.length : 0) + k.length + v.length > this.quota) throw Object.assign(new Error('满了'), { name: 'QuotaExceededError' });
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  /** 塞满,只留 room 个字符 */
  fill(room = 0) {
    const left = this.quota - this.used - 'x'.length - room;
    this.map.set('x', 'x'.repeat(left));
  }
}

const g = globalThis as unknown as { localStorage: FakeStorage; indexedDB: IDBFactory };

const direct: NotesVault = { read: readAuthor, change: changeAuthor };

/** 仓库可以坏掉的版本 */
function flaky(o: { read?: (id: string) => Error | null; change?: (id: string, ops: readonly NoteOp[]) => Error | null; lie?: (n: AiNote[]) => AiNote[] }): NotesVault {
  return {
    read: async (id) => {
      const e = o.read?.(id);
      if (e) throw e;
      const r = await readAuthor(id);
      return o.lie ? { ...r, notes: o.lie(r.notes) } : r;
    },
    change: async (id, ops) => {
      const e = o.change?.(id, ops);
      if (e) throw e;
      return changeAuthor(id, ops);
    },
  };
}

const note = (key: string, text = `${key} 的正文`, createdAt = '2026-11-04T08:00:00.000Z'): AiNote => ({ key, kind: '史书', title: key, text, createdAt, provider: 'p', model: 'm' });

/** 刷新页面 */
function refresh(vault: NotesVault | null = direct) {
  _resetNotes({ vault });
  saveStore._resetForTest();
}

const KEYS = (id: string) => exportNotes(id).map((n) => n.key);

let sample: PackInput & { eras: WorldEras };
let viewParts: SnapshotPart[];
const cp = (l: SnapshotPart[]) => l.map((p) => ({ ...p, data: p.data.slice(0) }));

/** 存一份没有 AI 正文的修订 */
const revision = (id: string, recipeKey = 'k1') => commitWorld({ id, recipe: sample.recipe, recipeKey, parts: cp(viewParts), made: MADE, readers: READERS });

async function authorInBlock(id: string): Promise<AiNote[] | null> {
  const r = await readRevision(id);
  const part = r?.parts.find((p) => p.info.name === 'author');
  if (!part) return null;
  return (unpackValue(await partBytes(part.info as never, new Uint8Array(part.data as ArrayBuffer), 1e9), 1e9) as { notes: AiNote[] }).notes;
}

function looseCount(): Promise<number> {
  return new Promise((resolve, reject) => {
    const open = g.indexedDB.open(VAULT_DB);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const q = open.result.transaction('notes').objectStore('notes').count();
      q.onsuccess = () => {
        open.result.close();
        resolve(q.result);
      };
    };
  });
}

const moved = () => JSON.parse(g.localStorage.getItem(MOVED) ?? '{}') as Record<string, { s: string | null; t: number; n: number }>;

beforeAll(async () => {
  sample = makeSample();
  const { parts } = await packWorldParts(sample);
  viewParts = parts.filter((p) => !['author', 'thumb'].includes(p.info.name)).map((p) => ({ name: p.info.name, bytes: p.info.bytes, sum: p.info.sum, zip: p.info.zip as 'gzip' | 'none', data: p.data as ArrayBuffer }));
}, 60_000);

beforeEach(() => {
  g.localStorage = new FakeStorage();
  g.indexedDB = new IDBFactory();
  _resetVault();
  refresh();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await _notesSettled();
  _resetVault();
  _resetNotes({ vault: null, timing: { retry: 30_000, readyWait: 8_000, flushWait: 60_000 } });
});

describe('localStorage 满了', () => {
  const MB = 1024 * 1024;

  it('有修订的世界:塞满 localStorage 再存 6 MB 的正文,都存下、刷新还在、别的世界的存档不受影响', async () => {
    g.localStorage = new FakeStorage(5 * MB);
    refresh();
    await revision('w1');
    g.localStorage.setItem(`wenming-ditu:world:other`, '别的世界的存档');
    g.localStorage.fill();
    const before = g.localStorage.getItem('wenming-ditu:world:other');
    for (let i = 0; i < 6; i++) expect(putNote('w1', note(`k${i}`, `${i}`.repeat(MB)))).toBe(true);
    expect(notesSaved('w1')).toBe(true);
    await _notesSettled();
    expect(notesBehind('w1')).toBeNull();

    refresh();
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5']);
    expect(getNote('w1', 'k3')!.text).toHaveLength(MB);
    expect(notesKnown('w1')).toBe(true);
    expect(g.localStorage.getItem('wenming-ditu:world:other')).toBe(before);
    // 满得连探测的那一点都写不下:还是认得 localStorage,不当成不能用
    expect(saveStore.persistent()).toBe(true);
    // 存成文件也带着
    const c = await readWorldContent(await openWorldFile((await revisionFile('w1'))!, OPEN));
    expect(c.author!.notes.map((n) => n.key)).toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5']);
    expect(c.warnings).toEqual([]);
  }, 60_000);

  it('还没有修订的世界也一样,第一次存的时候并进 author 块,等着的那一行清掉', async () => {
    g.localStorage = new FakeStorage(MB);
    refresh();
    g.localStorage.fill();
    expect(putNote('w1', note('k', 'x'.repeat(6 * MB)))).toBe(true);
    await _notesSettled();
    expect(await revisionsOf('w1')).toEqual([]);
    expect(await looseCount()).toBe(1);
    refresh();
    await notesReady(['w1']);
    expect(getNote('w1', 'k')!.text).toHaveLength(6 * MB);

    await revision('w1');
    expect((await authorInBlock('w1'))!.map((n) => n.key)).toEqual(['k']);
    expect(await looseCount()).toBe(0);
    expect((await readAuthor('w1')).notes.map((n) => n.key)).toEqual(['k']);
  }, 60_000);

  it('写不进草稿、也写不进仓库:才算只在页面里;仓库好了补上', async () => {
    g.localStorage = new FakeStorage(1000);
    let broken = true;
    refresh(flaky({ change: () => (broken ? new VaultError('failed', '写不进去') : null) }));
    _resetNotes({ vault: flaky({ change: () => (broken ? new VaultError('failed', '写不进去') : null) }), timing: { retry: 5 } });
    g.localStorage.fill();
    await notesReady(['w1']);
    expect(putNote('w1', note('old', 'x'.repeat(5000)))).toBe(true);
    await flushNotes('w1');
    expect(notesSaved('w1')).toBe(false);
    expect(notesBehind('w1')).toEqual([]);
    expect(putNote('w1', note('new', 'y'.repeat(5000)))).toBe(false);
    broken = false;
    await vi.waitFor(() => expect(notesSaved('w1')).toBe(true));
    await _notesSettled();
    expect(notesBehind('w1')).toBeNull();
    expect((await readAuthor('w1')).notes.map((n) => n.key)).toEqual(['old', 'new']);
  });

  it('写不下存档时清掉核对过的旧正文腾地方,没核对过的不清', async () => {
    const save = JSON.stringify(makeSave({ ...DEFAULT_PARAMS, seed: 1 }, sample.recipe.edits, 'c'));
    const moved1 = JSON.stringify([note('a', 'a'.repeat(save.length + 500))]);
    const fresh1 = JSON.stringify([note('b', 'b'.repeat(500))]);
    g.localStorage = new FakeStorage(moved1.length + fresh1.length + 1000);
    refresh();
    g.localStorage.setItem(`${PREFIX}w1`, moved1);
    await moveNotes('w1');
    expect(moved().w1.s).toBeTruthy();
    g.localStorage.setItem(`${PREFIX}w2`, fresh1);
    g.localStorage.fill();
    expect(g.localStorage.getItem(`${PREFIX}w1`)).toBe(moved1);
    // 能存下:核对过的那份让了地方
    expect(saveStore.putSyncedWorld('wtest0003', { save, meta: {}, thumb: null })).toBe(true);
    expect(g.localStorage.getItem(`${PREFIX}w1`)).toBeNull();
    expect(g.localStorage.getItem(`${PREFIX}w2`)).toBe(fresh1);
    refresh();
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual(['a']);
  });
});

describe('老数据转进仓库', () => {
  const OLD = [note('a'), note('b')];
  const seed = (id: string, list: AiNote[] = OLD) => g.localStorage.setItem(PREFIX + id, JSON.stringify(list));

  it('转进去、读回来对上了才记下来;旧的那份留 14 天再清', async () => {
    await revision('w1');
    seed('w1');
    await moveNotes('w1');
    expect((await authorInBlock('w1'))!.map((n) => n.key)).toEqual(['a', 'b']);
    expect(moved().w1.n).toBe(2);
    expect(g.localStorage.getItem(`${PREFIX}w1`)).not.toBeNull();
    tidyNotes();
    expect(g.localStorage.getItem(`${PREFIX}w1`)).not.toBeNull();
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 15 * DAY);
    tidyNotes();
    expect(g.localStorage.getItem(`${PREFIX}w1`)).toBeNull();
    refresh();
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual(['a', 'b']);
  });

  it('没有修订的世界也转(放在 notes 表),localStorage 同样等核对过', async () => {
    seed('w1');
    await moveNotes('w1');
    expect(await looseCount()).toBe(1);
    expect(moved().w1.s).toBeTruthy();
  });

  it('写到一半关页面(写进仓库之前、写完没来得及记):下次打开接着转,一条不少', async () => {
    await revision('w1');
    seed('w1');
    // 第一次:还没写进去就关了
    refresh(flaky({ change: () => new VaultError('failed', '页面关了') }));
    await notesReady(['w1']);
    await flushNotes('w1');
    expect(moved().w1).toBeUndefined();
    expect(JSON.parse(g.localStorage.getItem(`${PREFIX}w1`)!).map((n: AiNote) => n.key)).toEqual(['a', 'b']);
    // 第二次:写进去了,没来得及核对
    refresh(flaky({ read: (() => { let n = 0; return () => (n++ ? new VaultError('failed', '页面关了') : null); })() }));
    await notesReady(['w1']);
    await _notesSettled();
    expect(moved().w1?.s ?? null).toBeNull();
    expect(g.localStorage.getItem(`${PREFIX}w1`)).not.toBeNull();
    expect((await authorInBlock('w1'))!.map((n) => n.key)).toEqual(['a', 'b']);
    // 第三次:走完
    refresh();
    await moveNotes('w1');
    expect(moved().w1.s).toBeTruthy();
    expect(KEYS('w1')).toEqual(['a', 'b']);
    expect((await revisionsOf('w1')).length).toBeLessThanOrEqual(3);
  });

  it('回读对不上:不记下来,旧的那份留着,下次打开再来', async () => {
    await revision('w1');
    seed('w1');
    refresh(flaky({ lie: (l) => l.filter((n) => n.key !== 'b') }));
    await moveNotes('w1');
    expect(moved().w1?.s ?? null).toBeNull();
    expect(g.localStorage.getItem(`${PREFIX}w1`)).not.toBeNull();
    refresh();
    await moveNotes('w1');
    expect(KEYS('w1')).toEqual(['a', 'b']);
    expect(moved().w1.s).toBeTruthy();
  });

  it('块写进去读回来对不上:这次没存成,旧的那份还在', async () => {
    await revision('w1');
    seed('w1');
    const real = crypto.subtle.digest.bind(crypto.subtle);
    let bad = true;
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (a, d) => {
      const out = await real(a, d);
      if (bad) new Uint8Array(out)[0] ^= 1;
      return out;
    });
    refresh();
    await notesReady(['w1']);
    await flushNotes('w1');
    bad = false;
    vi.restoreAllMocks();
    expect(moved().w1?.s ?? null).toBeNull();
    expect(g.localStorage.getItem(`${PREFIX}w1`)).not.toBeNull();
    refresh();
    await moveNotes('w1');
    expect(KEYS('w1')).toEqual(['a', 'b']);
  });

  it('以前多存的一份比 localStorage 新:同一条留新的,只在一边的都留下', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'set', notes: [note('a', '新写的', '2026-11-04T09:00:00.000Z'), note('only-block')] }]);
    seed('w1', [note('a', '旧的'), note('only-ls')]);
    await moveNotes('w1');
    expect(getNote('w1', 'a')!.text).toBe('新写的');
    expect(KEYS('w1').sort()).toEqual(['a', 'only-block', 'only-ls']);
    expect((await authorInBlock('w1'))!.map((n) => n.key).sort()).toEqual(['a', 'only-block', 'only-ls']);
    expect(moved().w1.s).toBeTruthy();
  });

  it('旧版网站又写过那份:再并一遍;旧的那份没动过就不再读', async () => {
    await revision('w1');
    seed('w1');
    await moveNotes('w1');
    deleteNote('w1', 'a');
    await _notesSettled();
    refresh();
    await moveNotes('w1');
    expect(KEYS('w1')).toEqual(['b']);
    seed('w1', [...OLD, note('from-old-site')]);
    refresh();
    await moveNotes('w1');
    expect(KEYS('w1')).toContain('from-old-site');
    expect(moved().w1.s).toBeTruthy();
  });

  it('仓库丢过东西(浏览器清了、库坏了):拿核对过的旧的那份补回来', async () => {
    await revision('w1');
    seed('w1');
    await moveNotes('w1');
    await purgeWorld('w1');
    refresh();
    await moveNotes('w1');
    expect(KEYS('w1')).toEqual(['a', 'b']);
    expect((await readAuthor('w1')).notes.map((n) => n.key)).toEqual(['a', 'b']);
  });
});

describe('仓库坏了', () => {
  it('浏览器不给 IndexedDB:退回只用 localStorage,和以前一样', async () => {
    g.localStorage.setItem(`${PREFIX}w1`, JSON.stringify([note('a')]));
    refresh(flaky({ read: () => new VaultError('unavailable', '不让用'), change: () => new VaultError('unavailable', '不让用') }));
    expect(KEYS('w1')).toEqual(['a']);
    await notesReady(['w1']);
    expect(notesKnown('w1')).toBe(true);
    expect(putNote('w1', note('b'))).toBe(true);
    expect(JSON.parse(g.localStorage.getItem(`${PREFIX}w1`)!).map((n: AiNote) => n.key)).toEqual(['a', 'b']);
    deleteNote('w1', 'a');
    expect(JSON.parse(g.localStorage.getItem(`${PREFIX}w1`)!).map((n: AiNote) => n.key)).toEqual(['b']);
    refresh(flaky({ read: () => new VaultError('unavailable', '不让用') }));
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual(['b']);
  });

  it('后台线程起不来(说不清的错,连着几次):也退回 localStorage,写在中途的不丢', async () => {
    const boom = () => new Error('线程起不来');
    refresh(flaky({ read: boom, change: boom }));
    expect(putNote('w1', note('a'))).toBe(true);
    expect(putNote('w2', note('b'))).toBe(true);
    await notesReady(['w1', 'w2', 'w3']);
    await vi.waitFor(() => expect(JSON.parse(g.localStorage.getItem(`${PREFIX}w1`) ?? '[]').map((n: AiNote) => n.key)).toEqual(['a']));
    expect(JSON.parse(g.localStorage.getItem(`${PREFIX}w2`)!).map((n: AiNote) => n.key)).toEqual(['b']);
  });

  it('用着用着仓库不行了:读到过的正文这次打开还看得到', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'put', note: note('a', 'x'.repeat(100)) }]);
    let bad = false;
    refresh(flaky({ read: () => (bad ? new VaultError('unavailable', '不让用了') : null) }));
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual(['a']);
    bad = true;
    await notesReady(['w2']);
    expect(KEYS('w1')).toEqual(['a']);
  });

  it('正文已经在仓库里、这次读不到:手上不全,不算知道;好了以后一条不少,这期间写的也在', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'put', note: note('a') }]);
    g.localStorage.setItem(MOVED, JSON.stringify({ w1: { s: null, t: 1, n: 1 } }));
    let bad = true;
    _resetNotes({ vault: flaky({ read: () => (bad ? new VaultError('failed', '这次读不了') : null) }), timing: { retry: 5 } });
    saveStore._resetForTest();
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual([]);
    expect(notesKnown('w1')).toBe(false);
    // localStorage 里没有记录也一样不算知道(满的时候记不下)
    g.localStorage.removeItem(MOVED);
    expect(notesKnown('w1')).toBe(false);
    // 这期间同步下来的「没有」只是并进去,不去掉
    replaceNotes('w1', null);
    putNote('w1', note('b'));
    await flushNotes('w1');
    expect((await authorInBlock('w1'))!.map((n) => n.key)).toEqual(['a', 'b']);
    bad = false;
    await vi.waitFor(() => expect(notesKnown('w1')).toBe(true));
    expect(KEYS('w1')).toEqual(['a', 'b']);
  });

  it('author 块的字节坏了:不当「没有」,新写的放 notes 表,块不动', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'put', note: note('a') }]);
    const rev = (await readRevision('w1'))!;
    const info = rev.manifest.parts.find((p) => p.name === 'author')!;
    await new Promise<void>((resolve, reject) => {
      const open = g.indexedDB.open(VAULT_DB);
      open.onsuccess = () => {
        const t = open.result.transaction('parts', 'readwrite');
        t.objectStore('parts').delete(`${info.sum}.${info.zip}`);
        t.oncomplete = () => {
          open.result.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
    });
    refresh();
    await notesReady(['w1']);
    expect(notesKnown('w1')).toBe(false);
    putNote('w1', note('b'));
    await flushNotes('w1');
    expect((await readRevision('w1', rev.head.n, []))!.manifest.parts.some((p) => p.name === 'author')).toBe(true);
    expect((await readAuthor('w1')).unread).toBe(true);
    expect((await readAuthor('w1')).notes.map((n) => n.key)).toEqual(['b']);
    expect(await looseCount()).toBe(1);
  });
});

describe('用的人删了 / 没读到', () => {
  it('写不进 localStorage 后刷新,再写清单(配方、封面改了),仓库里的正文还在', async () => {
    g.localStorage = new FakeStorage(1000);
    refresh();
    await revision('w1');
    g.localStorage.fill();
    putNote('w1', note('k', 'x'.repeat(5000)));
    await _notesSettled();
    refresh();
    // 还没读到就存了一次世界:不带作者内容 = 沿用
    expect(KEYS('w1')).toEqual([]);
    await commitWorld({ id: 'w1', recipe: { ...sample.recipe, title: '改了名' }, recipeKey: 'k1' });
    expect((await authorInBlock('w1'))!.map((n) => n.key)).toEqual(['k']);
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual(['k']);
  });

  it('真删了一条:删了就是删了,刷新不会回来;旧的那份还在 localStorage 里也不回来', async () => {
    await revision('w1');
    g.localStorage.setItem(`${PREFIX}w1`, JSON.stringify([note('a'), note('b')]));
    await moveNotes('w1');
    deleteNote('w1', 'a');
    await _notesSettled();
    expect(g.localStorage.getItem(`${PREFIX}w1`)).toContain('"a"');
    refresh();
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual(['b']);
    expect(moved().w1.n).toBe(1);
    // 全删了:块也没了,不算丢东西
    deleteNote('w1', 'b');
    await _notesSettled();
    expect(await authorInBlock('w1')).toBeNull();
    refresh();
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual([]);
    expect(notesKnown('w1')).toBe(true);
  });

  it('localStorage 满得连记号都记不下:删了的也不回来(核对过的旧的那份直接清掉)', async () => {
    await revision('w1');
    g.localStorage = new FakeStorage(3000);
    refresh();
    g.localStorage.setItem(`${PREFIX}w1`, JSON.stringify([note('a'), note('b')]));
    g.localStorage.fill();
    await moveNotes('w1');
    expect(moved().w1).toBeUndefined();
    expect(g.localStorage.getItem(`${PREFIX}w1`)).toBeNull();
    deleteNote('w1', 'a');
    await _notesSettled();
    refresh();
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual(['b']);
  });

  it('关得太快、删和存还在排队:下次打开接着做(草稿)', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'set', notes: [note('a'), note('b')] }]);
    refresh(flaky({ change: () => new VaultError('failed', '页面关了') }));
    await notesReady(['w1']);
    deleteNote('w1', 'a');
    putNote('w1', note('c'));
    await flushNotes('w1');
    refresh();
    await notesReady(['w1']);
    await _notesSettled();
    expect(KEYS('w1')).toEqual(['b', 'c']);
    expect((await authorInBlock('w1'))!.map((n) => n.key)).toEqual(['b', 'c']);
    expect([...g.localStorage.map.keys()].filter((k) => k.startsWith(`${PREFIX}~w1`))).toEqual([]);
  });

  it('读到之前删、读到之前存:都算数,读到的不会盖掉', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'set', notes: [note('a'), note('b')] }]);
    refresh();
    deleteNote('w1', 'a');
    putNote('w1', note('c'));
    await notesReady(['w1']);
    await _notesSettled();
    expect(KEYS('w1')).toEqual(['b', 'c']);
  });

  it('同步下来的「没有」:读到之前只并进去,读到以后才是真去掉', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'set', notes: [note('a')] }]);
    refresh();
    replaceNotes('w1', null);
    await _notesSettled();
    expect(KEYS('w1')).toEqual(['a']);
    replaceNotes('w1', null);
    await _notesSettled();
    expect(KEYS('w1')).toEqual([]);
    expect(await authorInBlock('w1')).toBeNull();
  });
});

describe('首页:仓库的代码还没下好', () => {
  /** 和 worldVaultWorker 说一样的话,在这里直接做 */
  class InlineVaultWorker {
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror = null;
    postMessage(m: { rid: number; op: keyof typeof vaultOps; args: unknown[] }) {
      (vaultOps[m.op] as (...a: unknown[]) => Promise<unknown>)(...m.args).then(
        (value) => this.onmessage?.({ data: { rid: m.rid, ok: true, value } }),
        (e: { message: string; kind?: string }) => this.onmessage?.({ data: { rid: m.rid, ok: false, message: e.message, kind: e.kind } }),
      );
    }
    terminate() {}
  }
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('还没接上之前写的、删的、同步下来的,都按老办法存着,接上以后照做一遍;还没接上时不算知道', async () => {
    await revision('wtest0002');
    await changeAuthor('wtest0002', [{ op: 'set', notes: [note('in-vault'), note('to-delete')] }]);
    g.localStorage.setItem(`${PREFIX}wtest0002`, JSON.stringify([note('in-ls')]));
    // 全新的一份代码,像刚打开首页:真的走动态载入、真的走 worldStore 调后台线程,只是线程换成在这里直接做
    vi.resetModules();
    vi.stubGlobal('Worker', InlineVaultWorker);
    const lib = await import('../src/ai/library');
    expect(lib.notesKnown('wtest0002')).toBe(false);
    expect(lib.exportNotes('wtest0002').map((n) => n.key)).toEqual(['in-ls']);
    expect(lib.putNote('wtest0002', note('early'))).toBe(true);
    lib.deleteNote('wtest0002', 'to-delete');
    // 同步下来的「没有」:不去掉 localStorage 里的
    expect(lib.replaceNotes('wtest0002', null)).toBe(true);
    expect(lib.exportNotes('wtest0002').map((n) => n.key)).toEqual(['in-ls', 'early']);
    expect(lib.copyNotes('wtest0002', 'wtest0003')).toBe(true);

    await lib.notesReady(['wtest0002']);
    const later = await import('../src/ai/libraryVault');
    await later._notesSettled();
    expect(lib.notesKnown('wtest0002')).toBe(true);
    expect(lib.exportNotes('wtest0002').map((n) => n.key).sort()).toEqual(['early', 'in-ls', 'in-vault']);
    expect((await readAuthor('wtest0002')).notes.map((n) => n.key).sort()).toEqual(['early', 'in-ls', 'in-vault']);
    // 复制也是在仓库里那份上做的:只在仓库里的也带上了
    await lib.notesReady(['wtest0003']);
    await later._notesSettled();
    expect(lib.exportNotes('wtest0003').map((n) => n.key)).toContain('in-vault');
  });

  it('浏览器存不了仓库:不下代码,老办法算知道', async () => {
    vi.resetModules();
    const lib = await import('../src/ai/library');
    expect(lib.notesKnown('wtest0002')).toBe(true);
    expect(lib.putNote('wtest0002', note('a'))).toBe(true);
    await lib.notesReady(['wtest0002']);
    expect(lib.exportNotes('wtest0002').map((n) => n.key)).toEqual(['a']);
    expect(lib.replaceNotes('wtest0002', null)).toBe(true);
    expect(lib.exportNotes('wtest0002')).toEqual([]);
  });
});

describe('写和读、几个线程撞在一起', () => {
  const book = (text: string, createdAt: string, extra: object = {}) => ({ ...note('书', text, createdAt), book: { title: '书' }, ...extra }) as AiNote;

  it('读得慢、写得快:写好了读才回来(读到的是写之前的样子),写的那条不会不见', async () => {
    await revision('w1');
    let go = () => {};
    const gate = new Promise<void>((r) => (go = r));
    refresh({
      read: async (id) => {
        const r = await readAuthor(id);
        await gate;
        return r;
      },
      change: changeAuthor,
    });
    putNote('w1', note('fast'));
    await flushNotes('w1');
    go();
    await notesReady(['w1']);
    await vi.waitFor(() => expect(notesKnown('w1')).toBe(true));
    expect(KEYS('w1')).toEqual(['fast']);
  });

  it('上次留下的草稿里删了一条,旧的那份还没核对过:这次写完核对过,下次打开也不回来', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'set', notes: [note('a'), note('b')] }]);
    g.localStorage.setItem(`${PREFIX}w1`, JSON.stringify([note('a'), note('b')]));
    g.localStorage.setItem(`${PREFIX}~w1~old`, JSON.stringify([{ op: 'del', key: 'a' }]));
    refresh();
    await moveNotes('w1');
    expect(KEYS('w1')).toEqual(['b']);
    expect(moved().w1.s).toBeTruthy();
    refresh();
    await moveNotes('w1');
    expect(KEYS('w1')).toEqual(['b']);
  });

  it('没读到时翻版本、写新版本:只并进去,仓库里手上没有的几版都留着', async () => {
    await revision('w1');
    const v1 = { text: '第一版', createdAt: '2026-01-01T00:00:00.000Z', provider: 'p', model: 'm', book: { title: '书' } };
    const v2 = { text: '第二版!', createdAt: '2026-01-02T00:00:00.000Z', provider: 'p', model: 'm', book: { title: '书' } };
    await changeAuthor('w1', [{ op: 'put', note: book('第三版!!', '2026-01-03T00:00:00.000Z', { others: [v1, v2], ver: 3 }) }]);
    // 这次读不了:手上一条都没有,写了第四版
    let bad = true;
    _resetNotes({ vault: flaky({ read: () => (bad ? new VaultError('failed', '这次读不了') : null) }), timing: { retry: 5 } });
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual([]);
    putNote('w1', book('第四版!!!', '2026-01-04T00:00:00.000Z'));
    await flushNotes('w1');
    bad = false;
    await vi.waitFor(() => expect(notesKnown('w1')).toBe(true));
    await _notesSettled();
    const n = (await readAuthor('w1')).notes[0] as AiNote & { others: { text: string }[]; ver: number };
    expect(n.text).toBe('第四版!!!');
    expect(n.others.map((v) => v.text).sort()).toEqual(['第一版', '第三版!!', '第二版!'].sort());
    // 正在用的还是新写的这一版:它排在别的几版后面
    expect(n.ver).toBe(4);
  });

  it('合并两份同一部书:按写的先后排,正在用的还是赢的那版', () => {
    const v = (i: number) => ({ text: `第${i}版${'!'.repeat(i)}`, createdAt: `2026-01-0${i}T00:00:00.000Z`, provider: 'p', model: 'm', book: { title: '书' } });
    // 三版,翻回去在看第 2 版
    const a = book(v(2).text, v(2).createdAt, { others: [v(1), v(3)], ver: 2 });
    const [m] = mergeNotes([a], [book(v(4).text, v(4).createdAt)]) as (AiNote & { others: { text: string }[]; ver: number })[];
    expect(m.text).toBe(v(4).text);
    expect(m.others.map((x) => x.text)).toEqual([v(1).text, v(2).text, v(3).text]);
    expect(m.ver).toBe(4);
    // 反过来:仓库里的新,手上这份旧
    const [n] = mergeNotes([a], [book(v(0 + 1).text, v(1).createdAt)]) as (AiNote & { others: { text: string }[]; ver: number })[];
    expect(n.text).toBe(v(2).text);
    expect(n.ver).toBe(2);
  });

  it('没读到时删了一条:记的条数跟着减,下次打开不当成仓库丢了东西,删的也不回来', async () => {
    await revision('w1');
    g.localStorage.setItem(`${PREFIX}w1`, JSON.stringify([note('a'), note('b')]));
    await moveNotes('w1');
    expect(moved().w1.n).toBe(2);
    let bad = true;
    _resetNotes({ vault: flaky({ read: () => (bad ? new VaultError('failed', '这次读不了') : null) }), timing: { retry: 100_000 } });
    await notesReady(['w1']);
    expect(notesKnown('w1')).toBe(false);
    deleteNote('w1', 'a');
    await flushNotes('w1');
    expect(moved().w1.n).toBe(1);
    bad = false;
    refresh();
    await notesReady(['w1']);
    expect(notesKnown('w1')).toBe(true);
    expect(KEYS('w1')).toEqual(['b']);
  });

  it('老数据和仓库里同一部书各有几版:都留下', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'put', note: book('只在仓库里', '2026-01-03T00:00:00.000Z') }]);
    g.localStorage.setItem(`${PREFIX}w1`, JSON.stringify([book('只在老数据里', '2026-01-01T00:00:00.000Z')]));
    await moveNotes('w1');
    const n = (await readAuthor('w1')).notes[0] as AiNote & { others: { text: string }[] };
    expect(n.text).toBe('只在仓库里');
    expect(n.others.map((v) => v.text)).toEqual(['只在老数据里']);
    expect(moved().w1.s).toBeTruthy();
  });

  it('复制世界时原来那份读不了:好了以后补上', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'set', notes: [note('a')] }]);
    let bad = true;
    _resetNotes({ vault: flaky({ read: (id) => (bad && id === 'w1' ? new VaultError('failed', '这次读不了') : null) }), timing: { retry: 5 } });
    await notesReady(['w1']);
    expect(copyNotes('w1', 'w2')).toBe(true);
    bad = false;
    await vi.waitFor(() => expect(KEYS('w2')).toEqual(['a']));
    await _notesSettled();
    expect((await readAuthor('w2')).notes.map((n) => n.key)).toEqual(['a']);
  });

  it('读到之前就写了一条,读到的时候还要并老数据:两样都进仓库', async () => {
    await revision('w1');
    g.localStorage.setItem(`${PREFIX}w1`, JSON.stringify([note('old')]));
    refresh();
    putNote('w1', note('new'));
    await _notesSettled();
    expect((await readAuthor('w1')).notes.map((n) => n.key).sort()).toEqual(['new', 'old']);
    expect(KEYS('w1').sort()).toEqual(['new', 'old']);
    expect(moved().w1.s).toBeTruthy();
  });

  it('第一次存世界的同时另一个线程在写 notes 表:新写的不会跟着被清掉', async () => {
    for (const wait of [0, 1, 2, 3, 5, 8, 13, 21]) {
      const id = `race${wait}`;
      await changeAuthor(id, [{ op: 'put', note: note('a') }]);
      const commit = revision(id);
      await new Promise((r) => setTimeout(r, wait));
      await changeAuthor(id, [{ op: 'put', note: note('b') }]);
      await commit;
      expect((await readAuthor(id)).notes.map((n) => n.key).sort(), `等 ${wait} 毫秒`).toEqual(['a', 'b']);
    }
  }, 60_000);

  it('整份写不回 localStorage 时(仓库突然用不了):写进草稿的那一条留着,下次打开还在', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'put', note: note('big', 'x'.repeat(5000)) }]);
    g.localStorage = new FakeStorage(2000);
    refresh(flaky({ change: () => new VaultError('unavailable', '不让用了') }));
    await notesReady(['w1']);
    expect(putNote('w1', note('small'))).toBe(true);
    await vi.waitFor(() => expect([...g.localStorage.map.keys()].some((k) => k === `${PREFIX}w1`)).toBe(false));
    await new Promise((r) => setTimeout(r, 0));
    expect([...g.localStorage.map.keys()].filter((k) => k.startsWith(`${PREFIX}~w1`))).toHaveLength(1);
    // 这次打开、下次打开仓库还是用不了:从草稿读得出来
    refresh(flaky({ read: () => new VaultError('unavailable', '不让用了') }));
    await notesReady(['w1']);
    expect(KEYS('w1')).toEqual(['small']);
    // 仓库好了:写进去
    refresh();
    await notesReady(['w1']);
    await _notesSettled();
    expect((await readAuthor('w1')).notes.map((n) => n.key).sort()).toEqual(['big', 'small']);
  });

  it('两个标签页的草稿互不相干:A 写完不删 B 还没写完的;B 关了,下次打开接着写', async () => {
    await revision('w1');
    await notesReady(['w1']);
    // 第二个标签页:同一个 localStorage、同一个仓库,自己一份代码
    vi.resetModules();
    const b = await import('../src/ai/library');
    const bVault = await import('../src/ai/libraryVault');
    const never = new Promise<never>(() => {});
    bVault._resetNotes({ vault: { read: readAuthor, change: () => never } });
    await b.notesReady(['w1']);
    b.putNote('w1', note('from-b'));

    putNote('w1', note('from-a'));
    await _notesSettled();
    expect([...g.localStorage.map.keys()].filter((k) => k.startsWith(`${PREFIX}~w1`))).toHaveLength(1);

    // B 没写完就关了
    refresh();
    await notesReady(['w1']);
    await _notesSettled();
    expect((await readAuthor('w1')).notes.map((n) => n.key).sort()).toEqual(['from-a', 'from-b']);
    expect([...g.localStorage.map.keys()].filter((k) => k.startsWith(`${PREFIX}~w1`))).toEqual([]);
  });
});

describe('别的路', () => {
  it('两个标签页同时写:谁也盖不掉谁', async () => {
    await revision('w1');
    await Promise.all(['a', 'b', 'c'].map((k) => changeAuthor('w1', [{ op: 'put', note: note(k) }])));
    expect((await readAuthor('w1')).notes.map((n) => n.key).sort()).toEqual(['a', 'b', 'c']);
  });

  it('历史正在重推(配方变了还没推完):正文照样写进去,修订还记着上一份的配方', async () => {
    await revision('w1', 'k1');
    expect((await commitWorld({ id: 'w1', recipe: { ...sample.recipe, title: '草稿' }, recipeKey: 'k2' })).status).toBe('draft');
    putNote('w1', note('a'));
    await _notesSettled();
    const r = (await readRevision('w1'))!;
    expect(r.head.recipeKey).toBe('k1');
    expect(r.manifest.recipe.title).toBe(sample.recipe.title);
    expect(await authorInBlock('w1')).toHaveLength(1);
  });

  it('清理没人引用的块不碰现在的 author 块;改了几次只留该留的', async () => {
    await revision('w1');
    for (const k of ['a', 'b', 'c', 'd']) await changeAuthor('w1', [{ op: 'put', note: note(k) }]);
    await sweepParts(0, Date.now() + 1000);
    expect((await readAuthor('w1')).notes.map((n) => n.key)).toEqual(['a', 'b', 'c', 'd']);
    expect((await revisionsOf('w1')).length).toBeLessThanOrEqual(3);
  });

  it('复制世界:原来那份还没读到也带得上,刷新还在', async () => {
    await revision('w1');
    await changeAuthor('w1', [{ op: 'set', notes: [note('a'), note('b')] }]);
    refresh();
    expect(copyNotes('w1', 'w2')).toBe(true);
    await notesReady(['w1', 'w2']);
    await _notesSettled();
    expect(KEYS('w2')).toEqual(['a', 'b']);
    refresh();
    await notesReady(['w1', 'w2']);
    expect(KEYS('w2')).toEqual(['a', 'b']);
    expect(KEYS('w1')).toEqual(['a', 'b']);
  });

  it('删世界再撤销:正文都在;localStorage 满了也撤销得了', async () => {
    const W = 'wtest0001';
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 3 }, sample.recipe.edits, 'c');
    expect(saveStore.putSyncedWorld(W, { save: JSON.stringify(save), meta: {}, thumb: null })).toBe(true);
    await revision(W);
    g.localStorage.setItem(PREFIX + W, JSON.stringify([note('a')]));
    await moveNotes(W);
    putNote(W, note('b'));
    await _notesSettled();
    const d = saveStore.deleteWorld(W)!;
    expect(d).toBeTruthy();
    // 被别的东西占满了:旧副本写不回去,世界照样放回来
    const ls = g.localStorage;
    const set = ls.setItem.bind(ls);
    vi.spyOn(ls, 'setItem').mockImplementation((k: string, v: string) => {
      if (k === PREFIX + W) throw Object.assign(new Error('满了'), { name: 'QuotaExceededError' });
      set(k, v);
    });
    expect(saveStore.restoreWorld(d)).toBe(true);
    expect(saveStore.loadWorld(W)).toBeTruthy();
    vi.restoreAllMocks();
    refresh();
    await notesReady([W]);
    expect(KEYS(W)).toEqual(['a', 'b']);
  });

  it('世界真清掉以后(过了 30 天):notes 表、记录、草稿都不留', async () => {
    putNote('w1', note('a'));
    await _notesSettled();
    expect(await looseCount()).toBe(1);
    expect(moved().w1).toBeTruthy();
    await purgeWorld('w1');
    tidyNotes('w1');
    expect(await looseCount()).toBe(0);
    expect(moved().w1).toBeUndefined();
  });

  it('关掉再读回来的正文和写进去的一字不差(账号同步靠这个认「没改过」)', async () => {
    await revision('w1');
    const n = { ...note('a', '正文\n\n"引号" <b> 😀'), book: { title: 't', scope: { kind: 'world' } }, others: [{ text: '第一版', createdAt: '2026-01-01T00:00:00.000Z' }], ver: 2 } as AiNote;
    putNote('w1', n);
    await _notesSettled();
    const before = JSON.stringify(exportNotes('w1'));
    refresh();
    await notesReady(['w1']);
    expect(JSON.stringify(exportNotes('w1'))).toBe(before);
  });
});

describe('超长的正文不连累整个世界', () => {
  const long = (over: Partial<AiNote>) => ({ ...sample, author: { notes: [{ ...note('k'), ...over }] } });

  it.each([
    ['单条超过 400 万字', { text: 'x'.repeat(4e6 + 1) }],
    ['别的字段超过 4096 字', { title: 't'.repeat(4097) }],
  ])('%s:能打开,只少这一块,有提示,另存字节不丢', async (_name, over) => {
    const file = await bytesOf(await packWorldFile(long(over)));
    const opened = await openWorldFile(file, OPEN);
    const c = await readWorldContent(opened);
    expect(c.author).toBeNull();
    expect(c.authorTrouble).toBe('skipped');
    expect(c.skipped).toContain('author');
    expect(c.warnings.join('')).toContain('AI 写的东西');
    expect(c.civ).toBeTruthy();
    const again = await openWorldFile(await rewriteWorldFile(opened, { title: '另存' }), OPEN);
    expect(again.bytes.get('author')).toEqual(opened.bytes.get('author'));
  }, 60_000);

  it('author 块的字节坏了:能打开,只少这一块', async () => {
    const opened = await openWorldFile(await bytesOf(await packWorldFile(sample)), OPEN);
    (opened.bytes as Map<string, Uint8Array>).set('author', new Uint8Array([1, 2, 3]));
    const c = await readWorldContent(opened);
    expect(c.author).toBeNull();
    expect(c.authorTrouble).toBe('damaged');
    expect(c.warnings.join('')).toContain('没读出来');
  });

  it('放进仓库:字节留着不当正文读;写了新的正文,旧的另起名字留着,存成文件两个都在', async () => {
    const file = new Blob([await bytesOf(await packWorldFile(long({ text: 'x'.repeat(4e6 + 1) })))]);
    const look = await openWorldFile(file, OPEN);
    await adoptFile({ id: 'w9', file, sum: await sha256(look.manifestBytes), recipeKey: 'k', generator: sample.recipe.generator, readers: READERS });
    await patchState('w9', { authorSkip: look.manifest.parts.find((p) => p.name === 'author')!.sum });
    await notesReady(['w9']);
    expect(KEYS('w9')).toEqual([]);
    expect(notesKnown('w9')).toBe(true);
    const was = look.manifest.parts.find((p) => p.name === 'author')!;

    // 还没写新的:另存还是原来那块
    const same = await openWorldFile((await revisionFile('w9'))!, OPEN);
    expect(same.manifest.parts.find((p) => p.name === 'author')!.sum).toBe(was.sum);

    putNote('w9', note('new'));
    await _notesSettled();
    const out = await openWorldFile((await revisionFile('w9'))!, OPEN);
    const kept = out.manifest.parts.find((p) => p.name.startsWith('author.kept.'))!;
    expect(kept.sum).toBe(was.sum);
    expect(out.kept.map((p) => p.name)).toContain(kept.name);
    const c = await readWorldContent(out);
    expect(c.author!.notes.map((n) => n.key)).toEqual(['new']);
    expect(c.warnings).toEqual([]);
  }, 60_000);

  it('上限合理:最长的一部史书(8 万多字)、再多存几版都过得去', async () => {
    const book = { ...note('史书:world', '字'.repeat(90_000)), others: Array.from({ length: 20 }, (_, i) => ({ text: '字'.repeat(90_000), createdAt: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })) };
    const c = await readWorldContent(await openWorldFile(await bytesOf(await packWorldFile({ ...sample, author: { notes: [book] } })), OPEN));
    expect(c.author!.notes[0].text).toHaveLength(90_000);
  }, 60_000);
});

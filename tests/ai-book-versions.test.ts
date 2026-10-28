/**
 * AI 写的书留旧版(src/ai/history.ts):重写不覆盖、最多留 3 版、满了写完去掉最早的那版、翻到哪版记下来、
 * 删除只删正在看的那版(只剩一版时删整部)、以前只有一版的照读、浏览器存储满了不悄悄丢(点了「删掉第 1 版再存」才删);
 * 列传、家传同样留旧版,名字由来照旧重写就换。用假 AI,不联网。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { battleLines } from '../src/ai/prompts/history';
import { LIFE_LENGTH, bookNoteKey, bookStoreScope, type BookOptions } from '../src/ai/prompts/lives';
import { setActiveProvider, setMockResponder } from '../src/ai/client';
import { forgetNotes, getNote, listNotes, putNote, type AiNote } from '../src/ai/library';
import {
  BOOK_VERSIONS_MAX,
  HISTORY_KIND,
  asHistoryNote,
  bookVersions,
  deleteBookVersion,
  dropOldestVersion,
  listHistoryNotes,
  pickBookVersion,
  unsavedVersions,
  versionsStale,
  writeHistory,
  type HistoryNote,
} from '../src/ai/history';
import { applyNames, polityKey } from '../src/gen/edits';
import * as saveStore from '../src/ui/saveStore';
import { lifeSource } from '../src/ui/lifeSource';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
const civ = generateCiv(world);

/** 一次写完的短书(一段时代,纪传体短篇):假 AI 回一句就是一版 */
const ONE: BookOptions = { scope: { kind: 'era', from: 1200, to: 1500 }, style: 'biography', length: 'k3' };
const KEY = bookNoteKey(bookStoreScope(civ, ONE.scope), ONE.style, ONE.length);

let clock = Date.parse('2026-10-20T01:00:00Z');
/** 写一版(每次晚一小时) */
async function write(w: string, text: string, o: BookOptions = ONE, src = null as ReturnType<typeof lifeSource> | null) {
  setMockResponder(() => text);
  const t = (clock += 3_600_000);
  return writeHistory(civ, o, { world: w, src, now: () => new Date(t) });
}
const noteOf = (w: string, key = KEY) => asHistoryNote(getNote(w, key));
/** 这一部的几版正文(第 1 版在前) */
const texts = (w: string, key = KEY) => {
  const n = noteOf(w, key);
  return n ? bookVersions(n).list.map((v) => v.text) : [];
};

beforeEach(() => setActiveProvider('mock'));
afterEach(() => {
  setMockResponder(null);
  setActiveProvider(null);
});

describe('AI 写的书留旧版', () => {
  it('重写不覆盖:新写的算第 2 版、第 3 版,正在用的是新写的;满 3 版再写,写完去掉最早的那版', async () => {
    const w = 'w-ver-1';
    await write(w, '第一版。');
    // 只有一版:存的样子和以前一样(没有别的版、没有第几版)
    const first = noteOf(w)!;
    expect(first.others).toBeUndefined();
    expect(first.ver).toBeUndefined();
    await write(w, '第二版。');
    const n = await write(w, '第三版。');
    expect(texts(w)).toEqual(['第一版。', '第二版。', '第三版。']);
    expect(n.text).toBe('第三版。');
    expect(bookVersions(noteOf(w)!).at).toBe(2);
    expect(noteOf(w)!.ver).toBe(3);
    // 还是一部书
    expect(listHistoryNotes(w)).toHaveLength(1);
    expect(BOOK_VERSIONS_MAX).toBe(3);
    await write(w, '第四版。');
    expect(texts(w)).toEqual(['第二版。', '第三版。', '第四版。']);
    expect(noteOf(w)!.text).toBe('第四版。');
  });

  it('翻到旧版记下来(下次打开、故事长图用外层那版);新写完的自动停在新版;已写列表按最近写的排,翻看旧版不挪位置', async () => {
    const w = 'w-ver-2';
    await write(w, 'A');
    await write(w, 'B');
    const ANNALS: BookOptions = { ...ONE, style: 'annals' };
    const annals = await write(w, '编年', ANNALS);
    expect(listHistoryNotes(w).map((n) => n.key)).toEqual([annals.key, KEY]);
    expect(pickBookVersion(w, KEY, 0)).toBe(true);
    const n = noteOf(w)!;
    expect(n.text).toBe('A');
    expect(n.ver).toBe(1);
    expect(bookVersions(n)).toMatchObject({ at: 0 });
    expect(texts(w)).toEqual(['A', 'B']);
    expect(listHistoryNotes(w).map((x) => x.key)).toEqual([annals.key, KEY]);
    // 再写一版:停在新写的
    await write(w, 'C');
    expect(texts(w)).toEqual(['A', 'B', 'C']);
    expect(noteOf(w)!.text).toBe('C');
    expect(listHistoryNotes(w)[0].key).toBe(KEY);
  });

  it('删除只删正在看的这一版,接着用剩下最新的那版;只剩一版时整部删掉', async () => {
    const w = 'w-ver-3';
    for (const t of ['A', 'B', 'C']) await write(w, t);
    pickBookVersion(w, KEY, 1);
    expect(deleteBookVersion(w, KEY, 1)).toBe('version');
    expect(texts(w)).toEqual(['A', 'C']);
    expect(noteOf(w)!.text).toBe('C');
    pickBookVersion(w, KEY, 0);
    expect(deleteBookVersion(w, KEY, 0)).toBe('version');
    expect(texts(w)).toEqual(['C']);
    expect(noteOf(w)!.others).toBeUndefined();
    expect(noteOf(w)!.ver).toBeUndefined();
    expect(deleteBookVersion(w, KEY, 0)).toBe('book');
    expect(getNote(w, KEY)).toBeUndefined();
    expect(listHistoryNotes(w)).toHaveLength(0);
    expect(deleteBookVersion(w, KEY, 0)).toBeNull();
  });

  it('写到一半停下、出错:原来的几版都在,正在用的那版不变', async () => {
    const w = 'w-ver-4';
    await write(w, 'A');
    await write(w, 'B');
    pickBookVersion(w, KEY, 0);
    const ac = new AbortController();
    setMockResponder(() => '新的'.repeat(200));
    await expect(writeHistory(civ, ONE, { world: w, signal: ac.signal, onProgress: (x) => x.text && ac.abort() })).rejects.toMatchObject({ code: 'aborted' });
    expect(texts(w)).toEqual(['A', 'B']);
    expect(noteOf(w)!.text).toBe('A');
    setMockResponder(() => {
      throw new Error('网络断了');
    });
    await expect(writeHistory(civ, ONE, { world: w })).rejects.toBeTruthy();
    expect(texts(w)).toEqual(['A', 'B']);
  });

  it('以前存的(只有一版)照读;再写一版,旧的算第 1 版;别的几版里坏了的跳过', async () => {
    const tmp = await write('w-ver-tmp', '借个书目');
    const legacy: HistoryNote = {
      key: KEY,
      kind: HISTORY_KIND,
      title: tmp.title,
      text: '旧的正文',
      createdAt: '2026-10-01T00:00:00.000Z',
      provider: 'bailian',
      model: 'qwen-plus',
      book: tmp.book,
    };
    const w = 'w-ver-5';
    putNote(w, legacy);
    expect(bookVersions(noteOf(w)!)).toEqual({ list: [{ text: '旧的正文', createdAt: legacy.createdAt, provider: 'bailian', model: 'qwen-plus', book: tmp.book }], at: 0 });
    await write(w, '新的正文');
    expect(texts(w)).toEqual(['旧的正文', '新的正文']);
    expect(bookVersions(noteOf(w)!).list[0]).toMatchObject({ provider: 'bailian', model: 'qwen-plus' });
    // 文件、同步带来的坏数据:坏的那几版跳过,第几版超出范围按最后一版算
    const bad = { ...legacy, others: [null, { text: 1 }, { text: '好的', createdAt: '2026-09-01T00:00:00.000Z', book: '坏了' }], ver: 99 } as unknown as AiNote;
    putNote('w-ver-6', bad);
    const vs = bookVersions(noteOf('w-ver-6')!);
    expect(vs.list.map((v) => v.text)).toEqual(['好的', '旧的正文']);
    expect(vs.list[0].book).toEqual(tmp.book);
    expect(vs.at).toBe(1);
  });

  it('每版各自对历史:改名以后写的那版对得上,之前写的那版标"历史已变"', async () => {
    const w = 'w-ver-7';
    const P: BookOptions = { scope: { kind: 'polity', polity: [...civ.polities].sort((a, b) => (b.dynasties?.length ?? 0) - (a.dynasties?.length ?? 0))[0].id }, style: 'biography', length: 'k3' };
    const key = bookNoteKey(bookStoreScope(civ, P.scope), P.style, P.length);
    await write(w, '改名前', P);
    const renamed = applyNames(civ, { [polityKey(civ, (P.scope as { polity: number }).polity)]: '饕' });
    setMockResponder(() => '改名后');
    await writeHistory(renamed, P, { world: w });
    expect(versionsStale(renamed, noteOf(w, key)!)).toEqual([true, false]);
    expect(versionsStale(civ, noteOf(w, key)!)).toEqual([false, true]);
  });

  it('列传、家传同样留旧版', async () => {
    const src = lifeSource(civ, world, null);
    const hero = (civ.people ?? [])
      .filter((x) => x.role === 'ruler' && x.name && civ.polities[x.polity] && (x.commands?.length ?? 0) > 0 && x.died !== undefined)
      .sort((a, b) => battleLines(civ, b).length - battleLines(civ, a).length || a.id - b.id)[0];
    const O: BookOptions = { scope: { kind: 'person', person: hero.id }, style: 'classic', length: LIFE_LENGTH };
    const key = bookNoteKey(bookStoreScope(civ, O.scope, src), O.style, O.length);
    const w = 'w-ver-8';
    await write(w, '列传第一版', O, src);
    await write(w, '列传第二版', O, src);
    expect(texts(w, key)).toEqual(['列传第一版', '列传第二版']);
    expect(listHistoryNotes(w)).toHaveLength(1);
  });

  it('名字由来不留旧版:照旧重写就换', () => {
    const w = 'w-ver-9';
    const name = (text: string): AiNote => ({ key: '释名:settlement:c1#0', kind: '释名', title: '某城 · 城', text, createdAt: new Date().toISOString(), provider: 'mock', model: 'mock' });
    putNote(w, name('第一次'));
    putNote(w, name('第二次'));
    const list = listNotes(w, '释名');
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('第二次');
    expect(list[0]).not.toHaveProperty('others');
  });
});

/** 假的浏览器存储:deny 返回 true 的写不进去(模拟存储满了) */
class FakeStorage {
  map = new Map<string, string>();
  deny: ((k: string, v: string) => boolean) | null = null;
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
    if (this.deny?.(k, v)) throw Object.assign(new Error('存储满了'), { name: 'QuotaExceededError' });
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}

describe('浏览器存储满了', () => {
  const g = globalThis as { localStorage?: unknown };
  const NOTES = 'civ-atlas:ai-notes:';
  let s: FakeStorage;
  beforeEach(() => {
    s = new FakeStorage();
    g.localStorage = s;
    saveStore._resetForTest();
    forgetNotes();
  });
  afterEach(() => {
    delete g.localStorage;
    saveStore._resetForTest();
    forgetNotes();
  });
  /** 浏览器里存着的这一部的几版 */
  const onDisk = (w: string) => {
    const raw = s.getItem(NOTES + w);
    const n = raw ? asHistoryNote((JSON.parse(raw) as AiNote[]).find((x) => x.key === KEY)) : null;
    return n ? bookVersions(n).list.map((v) => v.text) : [];
  };

  it('新写的那版只在页面里:说得出是第几版,浏览器里的几版一版不少;点了「删掉第 1 版再存」才删,腾出地方就写进去', async () => {
    const w = 'w-full-1';
    await write(w, 'A'.repeat(400));
    await write(w, 'B'.repeat(400));
    expect(onDisk(w)).toEqual(['A'.repeat(400), 'B'.repeat(400)]);
    expect(unsavedVersions(w, noteOf(w)!)).toEqual([]);
    s.deny = (k) => k.startsWith(NOTES);
    const n = await write(w, 'C'.repeat(400));
    // 写好的照样能看,浏览器里原来的两版没被替用户删掉
    expect(n.text).toBe('C'.repeat(400));
    expect(texts(w)).toEqual(['A'.repeat(400), 'B'.repeat(400), 'C'.repeat(400)]);
    expect(onDisk(w)).toEqual(['A'.repeat(400), 'B'.repeat(400)]);
    expect(unsavedVersions(w, noteOf(w)!)).toEqual([3]);
    // 翻看旧版也存不进去:页面里照样记着,还是第 3 版没存上
    pickBookVersion(w, KEY, 0);
    expect(noteOf(w)!.text).toBe('A'.repeat(400));
    expect(unsavedVersions(w, noteOf(w)!)).toEqual([3]);
    pickBookVersion(w, KEY, 2);
    // 浏览器只放得下两版的量:点「删掉第 1 版再存」,这回写进去了
    const three = JSON.stringify(listNotes(w)).length;
    s.deny = (k, v) => k.startsWith(NOTES) && v.length >= three;
    expect(dropOldestVersion(w, KEY)).toBe(true);
    expect(texts(w)).toEqual(['B'.repeat(400), 'C'.repeat(400)]);
    expect(onDisk(w)).toEqual(['B'.repeat(400), 'C'.repeat(400)]);
    expect(noteOf(w)!.text).toBe('C'.repeat(400));
    expect(unsavedVersions(w, noteOf(w)!)).toEqual([]);
  });

  it('只有一版、存不下:说清只在页面里,没有能删的旧版(不删)', async () => {
    const w = 'w-full-2';
    s.deny = (k) => k.startsWith(NOTES);
    await write(w, '唯一的一版');
    expect(texts(w)).toEqual(['唯一的一版']);
    expect(onDisk(w)).toEqual([]);
    expect(unsavedVersions(w, noteOf(w)!)).toEqual([1]);
    expect(dropOldestVersion(w, KEY)).toBe(false);
    expect(texts(w)).toEqual(['唯一的一版']);
    // 腾出地方以后再写一次(比如又写了一版),就都写进去了
    s.deny = null;
    await write(w, '第二版');
    expect(onDisk(w)).toEqual(['唯一的一版', '第二版']);
    expect(unsavedVersions(w, noteOf(w)!)).toEqual([]);
  });
});

/**
 * 网站账号和账号里的世界:登录(邀请制)、点了才传、取回、分享、退出登录、注销。没有自动同步。
 * 用开发假服务器(不开端口)当服务器,两台"设备"= 两份假的浏览器存储,来回切换。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAiServer, FAKE_CODE, FAKE_INVITE } from '../scripts/lib/fakeAiServer';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { EMPTY_EDITS } from '../src/gen/edits';
import { makeSave, type SaveFile } from '../src/gen/savefile';
import * as saveStore from '../src/ui/saveStore';
import { clearEdits } from '../src/ui/editsStore';
import { _resetToasts, getToast } from '../src/ui/toastStore';
import { forgetNotes, listNotes, notesKnown, putNote } from '../src/ai/library';
import { setServerForTest } from '../src/account/server';
import { _resetSessionForTest, deleteAccount, fetchAuthOptions, getSession, login, sendCode } from '../src/account/session';
import { SESSION_CHANGED, pushWorld, signOut, takeWorld } from '../src/account/sync';
import { createShare, deleteCloud, listCloud, listShares, openShareCode, restoreTrash, stopShare } from '../src/account/cloud';
import { fetchOverview } from '../src/account/fullWorlds';
import { fullStatusOf } from '../src/ui/fullWorldView';
import { pushForShare } from '../src/ui/sharePush';

// 「AI 写的东西没读全」在 Node 里造不出来(没有世界仓库),换成这样
vi.mock('../src/ai/library', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/ai/library')>();
  return { ...m, notesKnown: vi.fn(m.notesKnown) };
});

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

const g = globalThis as { localStorage?: unknown };
const BASE = 'http://fake-server.test';
const EMAIL = 'writer@example.com';
let fake: ReturnType<typeof createFakeAiServer>;
let online = true;

function device(s: FakeStorage) {
  g.localStorage = s;
  saveStore._resetForTest();
  _resetSessionForTest();
  forgetNotes();
  clearEdits();
}

function addWorld(seed: number, title: string): string {
  const id = saveStore.importSave(makeSave({ ...DEFAULT_PARAMS, seed }, EMPTY_EDITS, `check${seed}`, title));
  if (!id) throw new Error('存不下');
  return id;
}

const inCloud = () => [...fake.users.get(EMAIL)!.worlds.values()].filter((w) => w.deletedAt === null);
const titles = () =>
  saveStore
    .listWorlds()
    .map((w) => w.save.title)
    .sort();
const signIn = () => login(EMAIL, FAKE_CODE, FAKE_INVITE);
const worldRequests = () => vi.mocked(fetch).mock.calls.filter(([u, i]) => /\/v1\/worlds/.test(String(u)) && (i?.method ?? 'GET') !== 'GET');

beforeEach(() => {
  online = true;
  fake = createFakeAiServer({ chunkDelayMs: 0, inviteOnly: true, fullCheckMs: 0 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: RequestInit) => {
      if (!online) throw new TypeError('Failed to fetch');
      return fake.handle(new Request(String(u), init));
    }),
  );
  setServerForTest(BASE);
  device(new FakeStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
  setServerForTest(undefined);
  delete g.localStorage;
  saveStore._resetForTest();
  _resetSessionForTest();
  forgetNotes();
  _resetToasts();
});

describe('登录', () => {
  it('邀请制:新邮箱要邀请码,登录窗知道', async () => {
    expect((await fetchAuthOptions()).inviteOnly).toBe(true);
    await expect(sendCode('new@example.com')).rejects.toMatchObject({ code: 'need-invite' });
    await expect(login(EMAIL, FAKE_CODE, 'WRONG')).rejects.toMatchObject({ code: 'bad-invite' });
    await signIn();
    expect(getSession()?.user.account).toBe(EMAIL);
  });

  it('登录不传世界;改世界、删世界也不传', async () => {
    const id = addWorld(7, '苍澜界');
    const other = addWorld(99, '北境编年');
    await signIn();
    saveStore.renameWorld(id, '改过的');
    saveStore.deleteWorld(other);
    expect(worldRequests()).toEqual([]);
    expect(fake.users.get(EMAIL)!.worlds.size).toBe(0);
  });
});

describe('点了才传', () => {
  it('存档、封面、AI 写的东西一起存进账号;再点一次换成现在的', async () => {
    const id = addWorld(7, '苍澜界');
    putNote(id, { key: 'k', kind: '史书', title: '大昌', text: '第一版', createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' });
    await signIn();
    await pushWorld(id);
    expect(inCloud()).toHaveLength(1);
    expect((inCloud()[0].save as SaveFile).title).toBe('苍澜界');
    expect((inCloud()[0].notes as { text: string }[])[0].text).toBe('第一版');
    saveStore.renameWorld(id, '苍澜界二');
    await pushWorld(id);
    expect(inCloud()).toHaveLength(1);
    expect((inCloud()[0].save as SaveFile).title).toBe('苍澜界二');
  });

  it('别的设备传过的,这里再传就换成这里的:谁最后传就是谁那份', async () => {
    const a = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    await signIn();
    await pushWorld(id);
    const b = new FakeStorage();
    device(b);
    await signIn();
    await takeWorld(id);
    saveStore.renameWorld(id, 'B 改的');
    await pushWorld(id);
    device(a);
    await signIn();
    saveStore.renameWorld(id, 'A 改的');
    await pushWorld(id);
    expect((inCloud()[0].save as SaveFile).title).toBe('A 改的');
  });

  it('账号里删掉的世界,再传一次回到账号', async () => {
    const id = addWorld(7, '苍澜界');
    await signIn();
    await pushWorld(id);
    await deleteCloud(id);
    expect(inCloud()).toHaveLength(0);
    await pushWorld(id);
    expect(inCloud()).toHaveLength(1);
  });

  it('替哪一次登录传就只传到哪个账号:等的工夫换了账号就停', async () => {
    const id = addWorld(7, '苍澜界');
    await signIn();
    await expect(pushWorld(id, { token: 'old-token' })).rejects.toMatchObject({ code: SESSION_CHANGED });
    expect(fake.users.get(EMAIL)!.worlds.size).toBe(0);
  });

  it('存的是打包那一刻的样子,不是后来又改过的', async () => {
    const id = addWorld(7, '苍澜界');
    await signIn();
    const raw = saveStore.rawWorld(id)!;
    saveStore.renameWorld(id, '后来改的');
    await pushWorld(id, { raw });
    expect((inCloud()[0].save as SaveFile).title).toBe('苍澜界');
  });

  it('AI 写的东西也存打包那一刻的那份,不是后来又改过的', async () => {
    const id = addWorld(7, '苍澜界');
    const note = { key: 'k', kind: '史书', title: '大昌', text: '第一版', createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' };
    putNote(id, note);
    await signIn();
    const raw = saveStore.rawWorld(id)!;
    const notes = listNotes(id).map((n) => ({ ...n }));
    putNote(id, { ...note, text: '第二版' });
    await pushWorld(id, { raw, notes });
    expect((inCloud()[0].notes as { text: string }[])[0].text).toBe('第一版');
  });

  it('断网时报连不上,世界不动', async () => {
    const id = addWorld(7, '苍澜界');
    await signIn();
    online = false;
    await expect(pushWorld(id)).rejects.toMatchObject({ code: 'network' });
    expect(titles()).toEqual(['苍澜界']);
  });

  it('只有存档的世界 AI 写的东西太多,说清楚;有文件带着的不算错', async () => {
    const id = addWorld(7, '苍澜界');
    putNote(id, { key: 'k', kind: '史书', title: '大昌', text: '字'.repeat(1_000_100), createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' });
    await signIn();
    await expect(pushWorld(id)).rejects.toMatchObject({ code: 'bad-request' });
    await pushWorld(id, { alsoFile: true });
    expect((inCloud()[0].save as SaveFile).title).toBe('苍澜界');
    expect(inCloud()[0].notes).toBeNull();
  });

  it('AI 写的东西这次没读全:不拿手上这份去换账号里的', async () => {
    const id = addWorld(7, '苍澜界');
    putNote(id, { key: 'k', kind: '史书', title: '大昌', text: '第一版', createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' });
    await signIn();
    await pushWorld(id);
    const before = worldRequests().length;
    vi.mocked(notesKnown).mockImplementationOnce(() => false);
    await expect(pushWorld(id)).rejects.toMatchObject({ code: 'notes-unread' });
    expect(worldRequests().length).toBe(before);
    expect((inCloud()[0].notes as { text: string }[])[0].text).toBe('第一版');
  });
});

describe('只传了配方的世界,账号里那份和这里一样吗', () => {
  it('这台传上去、取回来的才算一样;之后改过、别的设备又传过都不算', async () => {
    const a = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    await signIn();
    const status = async () => fullStatusOf((await fetchOverview())!, id, saveStore.loadWorld(id)?.save);
    expect(await status()).toEqual({ kind: 'never' });
    await pushWorld(id);
    expect(await status()).toMatchObject({ kind: 'recipe', same: true });
    saveStore.renameWorld(id, '改过的');
    expect(await status()).toMatchObject({ kind: 'recipe', same: false });
    await pushWorld(id);
    expect(await status()).toMatchObject({ same: true });
    putNote(id, { key: 'k', kind: '史书', title: '大昌', text: '后来写的', createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' });
    expect(await status()).toMatchObject({ same: false });
    await pushWorld(id);
    device(new FakeStorage());
    await signIn();
    await takeWorld(id);
    expect(await status()).toMatchObject({ kind: 'recipe', same: true });
    saveStore.renameWorld(id, 'B 改的');
    await pushWorld(id);
    device(a);
    await signIn();
    expect(await status()).toMatchObject({ kind: 'recipe', same: false });
  });
});

describe('账号里的世界', () => {
  it('列表只读:换台设备看得到,不自动取;点了取回才有', async () => {
    const id = addWorld(7, '苍澜界');
    putNote(id, { key: 'k', kind: '史书', title: '大昌', text: '第一版', createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' });
    await signIn();
    await pushWorld(id);
    device(new FakeStorage());
    await signIn();
    const o = await fetchOverview();
    expect(o?.account.map((w) => w.id)).toEqual([id]);
    expect(o?.worlds).toEqual([]);
    expect(titles()).toEqual([]);
    await takeWorld(id);
    expect(titles()).toEqual(['苍澜界']);
    expect(listNotes(id).map((n) => n.text)).toEqual(['第一版']);
  });

  it('本机删掉的账号里还在;账号里删掉的本机不动,30 天内能找回', async () => {
    const id = addWorld(7, '苍澜界');
    const keep = addWorld(99, '北境编年');
    await signIn();
    await pushWorld(id);
    await pushWorld(keep);
    saveStore.deleteWorld(id);
    expect(inCloud()).toHaveLength(2);
    await deleteCloud(keep);
    expect(inCloud()).toHaveLength(1);
    expect(titles()).toEqual(['北境编年']);
    await restoreTrash(keep);
    expect(inCloud()).toHaveLength(2);
  });

  it('取回的工夫退出登录(选了从这台设备上删掉):取到的不往这台设备上写', async () => {
    const id = addWorld(7, '苍澜界');
    putNote(id, { key: 'k', kind: '史书', title: '大昌', text: '第一版', createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' });
    await signIn();
    await pushWorld(id);
    device(new FakeStorage());
    await signIn();
    const taking = takeWorld(id).then(
      () => 'taken',
      (e: unknown) => e,
    );
    expect(await signOut(false)).toEqual({ ok: true });
    expect(await taking).toMatchObject({ code: SESSION_CHANGED });
    expect(titles()).toEqual([]);
    expect(listNotes(id)).toEqual([]);
  });

  it('服务器没开传到账号:列表当没有', async () => {
    await signIn();
    const u = await fetch(`${BASE}/v1/auth/login`, { method: 'POST', body: JSON.stringify({ account: EMAIL, code: FAKE_CODE }) });
    const { token } = (await u.json()) as { token: string };
    await fetch(`${BASE}/v1/dev/full`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ off: true }) });
    expect(await fetchOverview()).toBeNull();
  });
});

describe('分享', () => {
  it('点了分享才把存档存上去;已经在账号里的不动', async () => {
    const id = addWorld(7, '苍澜界');
    const session = () => getSession()?.token;
    await signIn();
    await pushForShare(id, session());
    expect(inCloud()).toHaveLength(1);
    const share = await createShare(id, '明月');
    expect((await listShares()).map((s) => s.code)).toEqual([share.code]);
    const opened = await openShareCode(share.code);
    expect(opened.by).toBe('明月');
    expect((opened.save as SaveFile).title).toBe('苍澜界');
    await stopShare(id);
    await expect(openShareCode(share.code)).rejects.toMatchObject({ code: 'share-gone' });
  });

  it('等的工夫换了账号:不往下走', async () => {
    const id = addWorld(7, '苍澜界');
    await signIn();
    await expect(pushForShare(id, 'old-token')).rejects.toThrow('账号变了');
    expect((await listCloud()).length).toBe(0);
  });
});

describe('退出、注销', () => {
  it('退出留着 = 世界还在;退出删掉 = 不传,只删这台设备上的', async () => {
    const id = addWorld(7, '苍澜界');
    await signIn();
    await pushWorld(id);
    expect(await signOut(true)).toEqual({ ok: true });
    expect(titles()).toEqual(['苍澜界']);
    expect(getSession()).toBeNull();
    await signIn();
    addWorld(99, '没传的');
    const before = worldRequests().length;
    expect(await signOut(false)).toEqual({ ok: true });
    expect(worldRequests().length).toBe(before);
    expect(titles()).toEqual([]);
    expect(fake.users.get(EMAIL)!.worlds.size).toBe(1);
  });

  it('注销:这台设备上的世界不动', async () => {
    const id = addWorld(7, '苍澜界');
    await signIn();
    await pushWorld(id);
    expect(await deleteAccount(FAKE_CODE)).toBe(true);
    expect(titles()).toEqual(['苍澜界']);
    expect(fake.users.has(EMAIL)).toBe(false);
    expect(getToast()).toBeNull();
  });
});

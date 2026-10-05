/**
 * 网站账号和云同步:登录(邀请制)、两台设备之间同步、两边都改过两份都留、删除跟着走、退出登录。
 * 用开发假服务器(不开端口)当服务器,两台"设备"= 两份假的浏览器存储,来回切换。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAiServer, FAKE_CODE, FAKE_INVITE } from '../scripts/lib/fakeAiServer';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { EMPTY_EDITS } from '../src/gen/edits';
import { makeSave, type SaveFile } from '../src/gen/savefile';
import * as saveStore from '../src/ui/saveStore';
import { clearEdits, setEdits } from '../src/ui/editsStore';
import { setStage } from '../src/ui/stageStore';
import { _resetToasts, getToast } from '../src/ui/toastStore';
import { forgetNotes, listNotes, putNote } from '../src/ai/library';
import { setServerForTest } from '../src/account/server';
import { _resetSessionForTest, fetchAuthOptions, getSession, login, sendCode } from '../src/account/session';
import { _resetSyncForTest, getSyncView, signOut, startSync, syncNow } from '../src/account/sync';
import { createShare, listShares, openShareCode, stopShare } from '../src/account/cloud';

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
let fake: ReturnType<typeof createFakeAiServer>;
let online = true;
let stop: (() => void) | null = null;

/** 换到另一台设备(另一份浏览器存储);内存里的状态都清掉,像刚打开网页 */
function device(s: FakeStorage) {
  stop?.();
  g.localStorage = s;
  saveStore._resetForTest();
  _resetSessionForTest();
  _resetSyncForTest();
  forgetNotes();
  clearEdits();
  setStage('home');
  stop = startSync();
}

function addWorld(seed: number, title: string): string {
  const id = saveStore.importSave(makeSave({ ...DEFAULT_PARAMS, seed }, EMPTY_EDITS, `check${seed}`, title));
  if (!id) throw new Error('存不下');
  return id;
}

const titles = () =>
  saveStore
    .listWorlds()
    .map((w) => w.save.title)
    .sort();

async function signIn(email = 'writer@example.com') {
  await login(email, FAKE_CODE, FAKE_INVITE);
  return syncNow();
}

let clock = Date.parse('2026-10-05T08:00:00.000Z');
function tick() {
  clock += 1000;
  vi.setSystemTime(clock);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  tick();
  online = true;
  fake = createFakeAiServer({ chunkDelayMs: 0, inviteOnly: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: RequestInit) => {
      if (!online) throw new TypeError('Failed to fetch');
      return fake.handle(new Request(String(u), init));
    }),
  );
  setServerForTest(BASE);
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setServerForTest(undefined);
  delete g.localStorage;
  saveStore._resetForTest();
  _resetSessionForTest();
  _resetSyncForTest();
  forgetNotes();
  _resetToasts();
});

describe('网站账号', () => {
  it('邀请制:新邮箱没邀请码不发验证码(need-invite),邀请码不对 bad-invite;老账号不用邀请码', async () => {
    device(new FakeStorage());
    expect(await fetchAuthOptions()).toEqual({ accountKinds: ['email'], inviteOnly: true, codeTtlSec: 600 });
    await expect(sendCode('new@example.com')).rejects.toMatchObject({ code: 'need-invite', status: 403 });
    await expect(sendCode('new@example.com', 'NOPE-0000')).rejects.toMatchObject({ code: 'bad-invite' });
    expect((await sendCode('new@example.com', 'k7qm 2xpa')).devCode).toBe(FAKE_CODE);
    await expect(login('new@example.com', '000000', FAKE_INVITE)).rejects.toMatchObject({ code: 'bad-code' });
    await login('new@example.com', FAKE_CODE, FAKE_INVITE);
    expect(getSession()?.user).toMatchObject({ account: 'new@example.com', name: 'new' });
    // 令牌存在浏览器里:刷新还登着
    _resetSessionForTest();
    expect(getSession()?.user.account).toBe('new@example.com');
    await signOut(true);
    expect(getSession()).toBeNull();
    // 老账号再登录不用邀请码
    expect((await sendCode('new@example.com')).devCode).toBe(FAKE_CODE);
    await login('new@example.com', FAKE_CODE);
    expect(getSession()).not.toBeNull();
  });

  it('以前为"我们的 AI"登录的令牌挪进网站账号', async () => {
    const s = new FakeStorage();
    s.setItem('civ-atlas:ai-settings', JSON.stringify({ remember: true }));
    s.setItem('civ-atlas:ai-secrets', JSON.stringify({ deepseek: 'sk-keep-0123456789', official: { token: 'old-token', account: 'a@example.com' } }));
    const { resetAiSettingsForTest, getSecrets } = await import('../src/ai/settings');
    resetAiSettingsForTest();
    device(s);
    expect(getSession()).toMatchObject({ token: 'old-token', user: { account: 'a@example.com' } });
    await Promise.resolve();
    expect(getSecrets().official).toBeUndefined();
    expect(getSecrets().deepseek).toBe('sk-keep-0123456789');
    expect(JSON.parse(s.getItem('civ-atlas:account')!).token).toBe('old-token');
    resetAiSettingsForTest();
  });
});

describe('云同步', () => {
  it('登录后这台设备上的世界存进账号;另一台设备登录同一个账号就能看到(连同 AI 写的东西)', async () => {
    const a = new FakeStorage();
    device(a);
    const id1 = addWorld(7, '苍澜界');
    addWorld(2024, '赤水纪');
    putNote(id1, { key: 'k', kind: '史书', title: '大昌', text: '大昌兴于碧溪谷。', createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' });
    const v = await signIn();
    expect(v.phase).toBe('idle');
    expect(v.failed.size).toBe(0);
    expect(fake.users.get('writer@example.com')!.worlds.size).toBe(2);

    const b = new FakeStorage();
    device(b);
    expect(titles()).toEqual([]);
    await signIn();
    expect(titles()).toEqual(['苍澜界', '赤水纪']);
    expect(listNotes(id1).map((n) => n.text)).toEqual(['大昌兴于碧溪谷。']);
    expect(saveStore.loadWorld(id1)?.thumb).toBeNull();
  });

  it('最近打开或改过的先存上去(换台设备最可能接着用的先到)', async () => {
    device(new FakeStorage());
    const old = addWorld(99, '北境编年');
    tick();
    const mid = addWorld(2024, '赤水纪');
    tick();
    const recent = addWorld(7, '苍澜界');
    await signIn();
    expect([...fake.users.get('writer@example.com')!.worlds.keys()]).toEqual([recent, mid, old]);
  });

  it('一边改了,另一边同步时取回来;两边都改过:两份都留,另一台的那份名字加"(另一台设备)"', async () => {
    const a = new FakeStorage();
    const b = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    await signIn();
    device(b);
    await signIn();

    // A 改名 → B 取回来
    device(a);
    tick();
    saveStore.renameWorld(id, '苍澜界二');
    await syncNow();
    device(b);
    await syncNow();
    expect(titles()).toEqual(['苍澜界二']);

    // 两边都改(B 断着网改)
    online = false;
    tick();
    saveStore.renameWorld(id, 'B 改的');
    expect((await syncNow()).phase).toBe('offline');
    expect(getSyncView().failed.has(id)).toBe(true);
    online = true;
    device(a);
    tick();
    saveStore.renameWorld(id, 'A 改的');
    await syncNow();
    device(b);
    await syncNow();
    expect(titles()).toEqual(['A 改的（另一台设备）', 'B 改的']);
    expect(getToast()).toMatchObject({ id: 'sync', kind: 'warn', text: '「B 改的」在两台设备上都改过' });
    // 服务器上两份都有;A 再同步也是两份
    device(a);
    await syncNow();
    expect(titles()).toEqual(['A 改的（另一台设备）', 'B 改的']);
  });

  it('删除:另一台设备没改过就跟着删、进最近删除;改过的那份赢(存回来)', async () => {
    const a = new FakeStorage();
    const b = new FakeStorage();
    device(a);
    const id1 = addWorld(7, '苍澜界');
    const id2 = addWorld(99, '北境编年');
    await signIn();
    device(b);
    await signIn();

    // B 改了北境编年(还没同步),A 删掉两个
    tick();
    saveStore.renameWorld(id2, '北境编年二');
    device(a);
    saveStore.deleteWorld(id1);
    saveStore.deleteWorld(id2);
    await syncNow();
    const server = fake.users.get('writer@example.com')!.worlds;
    expect(server.get(id1)!.deletedAt).not.toBeNull();

    device(b);
    await syncNow();
    expect(titles()).toEqual(['北境编年二']);
    expect(server.get(id2)!.deletedAt).toBeNull();
    expect(server.get(id1)!.deletedAt).not.toBeNull();
  });

  it('正在看的世界不被别的设备的改动覆盖:提示"载入";回到我的世界以后照常取回', async () => {
    const a = new FakeStorage();
    const b = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    await signIn();
    device(b);
    await signIn();

    device(a);
    tick();
    saveStore.renameWorld(id, '新名字');
    await syncNow();

    device(b);
    // B 正在看这个世界
    const w = saveStore.loadWorld(id)!;
    setEdits(w.save.edits);
    saveStore.attachWorld({ id, params: w.save.params, check: w.save.check, kind: 'created', title: w.save.title, saved: w.save.edits });
    setStage('world');
    await syncNow();
    expect(saveStore.loadWorld(id)!.save.title).toBe('苍澜界');
    expect(getToast()).toMatchObject({ id: 'sync-reload', text: '这个世界在另一台设备上改过' });
    setStage('home');
    await syncNow();
    expect(saveStore.loadWorld(id)!.save.title).toBe('新名字');
    expect(saveStore.currentWorld()).toBeNull();
  });

  it('退出登录:留着 = 世界还在,没登录时删的下次登录跟着删;删掉 = 先同步好再从这台设备上删', async () => {
    const a = new FakeStorage();
    device(a);
    const id1 = addWorld(7, '苍澜界');
    addWorld(99, '北境编年');
    await signIn();
    expect(await signOut(true)).toEqual({ ok: true });
    expect(titles()).toEqual(['北境编年', '苍澜界']);
    saveStore.deleteWorld(id1);
    tick();
    addWorld(42, '新的');
    await signIn();
    const server = fake.users.get('writer@example.com')!.worlds;
    expect(server.get(id1)!.deletedAt).not.toBeNull();
    expect([...server.values()].filter((w) => w.deletedAt === null).length).toBe(2);

    // 断网时选"删掉":不删(还有没同步上的)
    tick();
    addWorld(314, '九州大陆');
    online = false;
    const r = await signOut(false);
    expect(r.ok).toBe(false);
    expect(getSession()).not.toBeNull();
    expect(titles().length).toBe(3);
    online = true;
    expect(await signOut(false)).toEqual({ ok: true });
    expect(titles()).toEqual([]);
    expect(a.getItem('civ-atlas:sync')).toBeNull();
    expect(getSession()).toBeNull();

    // 再登录:都回来了
    await signIn();
    expect(titles()).toEqual(['九州大陆', '北境编年', '新的']);
  });
});

describe('分享短链接', () => {
  it('开分享 → 不用登录就能打开 → 停了打不开;再开是新的码;删掉世界分享一起停', async () => {
    device(new FakeStorage());
    const id = addWorld(7, '苍澜界');
    await signIn();
    const s1 = await createShare(id);
    expect(s1.code).toMatch(/^[A-Za-z0-9]{8}$/);
    expect((await createShare(id)).code).toBe(s1.code);
    const opened = await openShareCode(s1.code);
    expect((opened.save as SaveFile).title).toBe('苍澜界');
    expect((await listShares()).map((s) => [s.title, s.opens])).toEqual([['苍澜界', 1]]);
    await stopShare(id);
    await expect(openShareCode(s1.code)).rejects.toMatchObject({ code: 'share-gone', status: 404 });
    const s2 = await createShare(id);
    expect(s2.code).not.toBe(s1.code);
    saveStore.deleteWorld(id);
    await syncNow();
    await expect(openShareCode(s2.code)).rejects.toMatchObject({ code: 'share-gone' });
    expect(await listShares()).toEqual([]);
  });
});

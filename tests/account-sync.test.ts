/**
 * 网站账号和云同步:登录(邀请制)、两台设备之间同步、两边都改过两份都留、删除跟着走、退出登录。
 * 用开发假服务器(不开端口)当服务器,两台"设备"= 两份假的浏览器存储,来回切换。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAiServer, FAKE_CODE, FAKE_INVITE } from '../scripts/lib/fakeAiServer';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { EMPTY_EDITS } from '../src/gen/edits';
import { makeSave, worldKey, type SaveFile } from '../src/gen/savefile';
import * as saveStore from '../src/ui/saveStore';
import { clearEdits, setEdits } from '../src/ui/editsStore';
import { setStage } from '../src/ui/stageStore';
import { _resetToasts, getToast } from '../src/ui/toastStore';
import { forgetNotes, listNotes, putNote } from '../src/ai/library';
import { setServerForTest } from '../src/account/server';
import { _resetSessionForTest, fetchAuthOptions, getSession, login, refreshSession, sendCode } from '../src/account/session';
import { _resetSyncForTest, getSyncView, inAccount, pullWorld, signOut, startSync, syncNow, worldSync } from '../src/account/sync';
import { createShare, listShares, openShareCode, stopShare } from '../src/account/cloud';

class FakeStorage {
  map = new Map<string, string>();
  /** 这些键写不进去(模拟浏览器存储满了) */
  deny: ((k: string) => boolean) | null = null;
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
    if (this.deny?.(k)) throw Object.assign(new Error('存储满了'), { name: 'QuotaExceededError' });
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
/** 请求到服务器之前调:模拟服务器回话前的工夫用户又做了什么;抛错 = 这一个请求断网;给回一个 Response = 服务器这样回 */
let gate: ((req: Request) => void | Response | Promise<void | Response>) | null = null;
/** 服务器处理完、回话到网页之前调(模拟回话在路上的工夫用户又做了什么) */
let late: ((req: Request) => void | Promise<void>) | null = null;
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
  gate = null;
  late = null;
  fake = createFakeAiServer({ chunkDelayMs: 0, inviteOnly: true });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: RequestInit) => {
      if (!online) throw new TypeError('Failed to fetch');
      const req = new Request(String(u), init);
      const r = gate ? await gate(req) : undefined;
      if (r instanceof Response) return r;
      const res = await fake.handle(req);
      if (late) await late(req);
      return res;
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

describe('云同步:边改边同步、出错、换账号', () => {
  const note = (text: string) => ({ key: 'k', kind: '史书', title: '大昌', text, createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' });
  const isWorld = (req: Request, id: string, method: string) => req.method === method && new URL(req.url).pathname === `/v1/worlds/${id}`;

  it('取回另一台设备改的那份时,用户在这边又改了:不覆盖,按两边都改过两份都留', async () => {
    const a = new FakeStorage();
    const b = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    await signIn();
    device(b);
    await signIn();
    device(a);
    tick();
    saveStore.renameWorld(id, 'A 改的');
    await syncNow();

    device(b);
    gate = (req) => {
      if (!isWorld(req, id, 'GET')) return;
      gate = null;
      tick();
      saveStore.renameWorld(id, 'B 改的');
    };
    await syncNow();
    await syncNow();
    expect(titles()).toEqual(['A 改的（另一台设备）', 'B 改的']);
  });

  it('存上去的工夫把这个世界删了:下一轮照样告诉服务器删掉,不会再取回来', async () => {
    const a = new FakeStorage();
    device(a);
    addWorld(99, '北境编年');
    await signIn();
    tick();
    const id = addWorld(7, '苍澜界');
    gate = (req) => {
      if (!isWorld(req, id, 'PUT')) return;
      gate = null;
      saveStore.deleteWorld(id);
    };
    await syncNow();
    await syncNow();
    expect(fake.users.get('writer@example.com')!.worlds.get(id)!.deletedAt).not.toBeNull();
    expect(titles()).toEqual(['北境编年']);
    device(a);
    await syncNow();
    expect(titles()).toEqual(['北境编年']);
  });

  it('两边都改过、另存好另一份后自己这份没存上(断网):另存的撤掉,不会每试一次多一份', async () => {
    const a = new FakeStorage();
    const b = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    await signIn();
    device(b);
    await signIn();
    device(a);
    tick();
    saveStore.renameWorld(id, 'A 改的');
    await syncNow();
    device(b);
    tick();
    saveStore.renameWorld(id, 'B 改的');

    gate = (req) => {
      if (req.method === 'PUT') throw new TypeError('Failed to fetch');
    };
    expect((await syncNow()).phase).toBe('offline');
    expect(titles()).toEqual(['B 改的']);
    expect((await syncNow()).phase).toBe('offline');
    expect(titles()).toEqual(['B 改的']);
    gate = null;
    await syncNow();
    expect(titles()).toEqual(['A 改的（另一台设备）', 'B 改的']);
  });

  it('AI 写的东西太多、存不进账号:算没同步上,退出登录不让选"删掉";两边都改过时也不会每次多出一份', async () => {
    const a = new FakeStorage();
    const b = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    await signIn();
    device(b);
    await signIn();
    device(a);
    tick();
    saveStore.renameWorld(id, 'A 改的');
    await syncNow();

    device(b);
    tick();
    saveStore.renameWorld(id, 'B 改的');
    putNote(id, note('长'.repeat(1_000_001)));
    tick();
    const big = addWorld(99, '北境编年');
    putNote(big, note('长'.repeat(1_000_001)));
    let v = await syncNow();
    expect([...v.failed.keys()].sort()).toEqual([big, id].sort());
    expect(v.failed.get(big)).toContain('太多');
    expect(titles()).toEqual(['B 改的', '北境编年']);
    v = await syncNow();
    expect(v.failed.size).toBe(2);
    expect(titles()).toEqual(['B 改的', '北境编年']);
    expect(fake.users.get('writer@example.com')!.worlds.has(big)).toBe(false);

    const r = await signOut(false);
    expect(r.ok).toBe(false);
    expect(getSession()).not.toBeNull();
    expect(titles()).toEqual(['B 改的', '北境编年']);
  });

  it('两台设备改得一模一样,只是服务器存取时键的先后变了:不算两边都改过', async () => {
    const a = new FakeStorage();
    const b = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    await signIn();
    device(b);
    await signIn();

    // 同一时刻改成同一个名字
    tick();
    device(a);
    saveStore.renameWorld(id, '同一个名字');
    await syncNow();
    const flip = (v: unknown): unknown =>
      v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse().map(([k, x]) => [k, flip(x)])) : v;
    const w = fake.users.get('writer@example.com')!.worlds.get(id)!;
    w.save = flip(w.save);
    device(b);
    saveStore.renameWorld(id, '同一个名字');
    await syncNow();
    expect(titles()).toEqual(['同一个名字']);
  });

  it('换个账号登录再换回来:没登录时删掉的世界,换回原来的账号照样跟着删', async () => {
    device(new FakeStorage());
    const id1 = addWorld(7, '苍澜界');
    addWorld(99, '北境编年');
    await signIn();
    await signOut(true);
    saveStore.deleteWorld(id1);
    await signIn('other@example.com');
    expect(fake.users.get('other@example.com')!.worlds.size).toBe(1);
    await signOut(true);
    await signIn();
    expect(fake.users.get('writer@example.com')!.worlds.get(id1)!.deletedAt).not.toBeNull();
    expect(titles()).toEqual(['北境编年']);
  });

  it('退出后换了账号:旧账号晚回来的"登录过期"不把新登录踢掉', async () => {
    device(new FakeStorage());
    await signIn();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    gate = async (req) => {
      if (new URL(req.url).pathname !== '/v1/shares') return;
      gate = null;
      await held;
    };
    const late = listShares().catch((e: unknown) => e);
    await signOut(true);
    await signIn('other@example.com');
    release();
    expect(await late).toMatchObject({ code: 'auth', status: 401 });
    expect(getSession()?.user.account).toBe('other@example.com');
  });
});

describe('云同步:换账号、存储满了', () => {
  const note = (text: string) => ({ key: 'k', kind: '史书', title: '大昌', text, createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' });

  it('同步途中退出、换了账号:原来那个账号没做完的删除不会删到新账号里', async () => {
    device(new FakeStorage());
    const x = addWorld(7, '苍澜界');
    const w = addWorld(99, '北境编年');
    // 两个账号里都有这两个世界(同一台设备先后登录过)
    await signIn('other@example.com');
    await signOut(true);
    await signIn();
    const other = fake.users.get('other@example.com')!.worlds;
    expect(other.size).toBe(2);

    // 登录着 writer 时删掉两个;告诉服务器的半路上退出、换成 other
    let hit!: () => void;
    const reached = new Promise<void>((r) => (hit = r));
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    late = async (req) => {
      if (req.method !== 'DELETE') return;
      late = null;
      hit();
      await held;
    };
    saveStore.deleteWorld(x);
    saveStore.deleteWorld(w);
    const run = syncNow();
    await reached;
    await signOut(true);
    await login('other@example.com', FAKE_CODE);
    release();
    await run;
    await syncNow();
    expect(other.get(x)!.deletedAt).toBeNull();
    expect(other.get(w)!.deletedAt).toBeNull();
    expect(getSession()?.user.account).toBe('other@example.com');
  });

  it('取回来的 AI 写的东西存不进浏览器:这次不算取回,刷新以后也不会拿旧的冲掉服务器上的', async () => {
    const a = new FakeStorage();
    const b = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    putNote(id, note('旧的'));
    await signIn();
    device(b);
    await signIn();
    expect(listNotes(id).map((n) => n.text)).toEqual(['旧的']);

    device(a);
    tick();
    putNote(id, note('新的'));
    await syncNow();

    device(b);
    b.deny = (k) => k.startsWith('civ-atlas:ai-notes:');
    await syncNow();
    b.deny = null;
    // 刷新(内存里的都清掉,从浏览器存储重读)
    device(b);
    await syncNow();
    expect(listNotes(id).map((n) => n.text)).toEqual(['新的']);
    expect((fake.users.get('writer@example.com')!.worlds.get(id)!.notes as { text: string }[]).map((n) => n.text)).toEqual(['新的']);
  });

  it('正在看的世界最新的改动没存进浏览器(存储满了):退出登录不让选"删掉"', async () => {
    const a = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    await signIn();
    const w = saveStore.loadWorld(id)!;
    setEdits(w.save.edits);
    saveStore.attachWorld({ id, params: w.save.params, check: w.save.check, kind: 'created', title: w.save.title, saved: w.save.edits });
    setStage('world');
    a.deny = (k) => k.startsWith('wenming-ditu:');
    tick();
    saveStore.renameWorld(id, '新名字');
    expect(saveStore.currentUnsaved()).toBe(true);
    const r = await signOut(false);
    expect(r).toMatchObject({ ok: false });
    expect(getSession()).not.toBeNull();
    expect(titles()).toEqual(['苍澜界']);
  });

  it('删掉时能不能在「最近删除」里找回:只有已经存进账号的才能', async () => {
    device(new FakeStorage());
    const id = addWorld(7, '苍澜界');
    expect(inAccount(id)).toBe(false);
    await signIn();
    expect(inAccount(id)).toBe(true);
    tick();
    const fresh = addWorld(99, '北境编年');
    expect(inAccount(fresh)).toBe(false);
    await signOut(true);
    expect(inAccount(id)).toBe(false);
  });
});

describe('云同步:载入、挤掉、放满了、老编号', () => {
  const isWorld = (req: Request, id: string, method: string) => req.method === method && new URL(req.url).pathname === `/v1/worlds/${id}`;
  const macrotask = () => new Promise<void>((r) => setTimeout(r, 0));

  it('点「载入」后取的工夫退出、换了账号:不载入原来那个账号的,也不报错', async () => {
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
    const w = saveStore.loadWorld(id)!;
    setEdits(w.save.edits);
    saveStore.attachWorld({ id, params: w.save.params, check: w.save.check, kind: 'created', title: w.save.title, saved: w.save.edits });
    setStage('world');
    await syncNow();
    expect(getToast()).toMatchObject({ id: 'sync-reload' });
    late = async (req) => {
      if (!isWorld(req, id, 'GET')) return;
      late = null;
      await signOut(true);
      await login('other@example.com', FAKE_CODE, FAKE_INVITE);
      // 新账号登录排上的同步有机会先跑
      await macrotask();
      await macrotask();
    };
    expect(await pullWorld(id)).toBe(false);
    await syncNow();
    expect(getSession()?.user.account).toBe('other@example.com');
    expect(saveStore.loadWorld(id)!.save.title).toBe('苍澜界');
    expect(getToast()?.kind).not.toBe('error');
    // 原来那个账号还是另一台设备改的样子
    expect((fake.users.get('writer@example.com')!.worlds.get(id)!.save as SaveFile).title).toBe('新名字');
  });

  it('「载入」照常:换成账号里的那份', async () => {
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
    const w = saveStore.loadWorld(id)!;
    setEdits(w.save.edits);
    saveStore.attachWorld({ id, params: w.save.params, check: w.save.check, kind: 'created', title: w.save.title, saved: w.save.edits });
    setStage('world');
    await syncNow();
    expect(await pullWorld(id)).toBe(true);
    expect(saveStore.loadWorld(id)!.save.title).toBe('新名字');
    expect(worldSync(id)).toMatchObject({ state: 'synced' });
  });

  it('存上去的工夫这个世界为了腾地方被挤出浏览器:不当成删掉,账号里那份留着、有地方了取回来', async () => {
    const a = new FakeStorage();
    device(a);
    addWorld(99, '北境编年');
    await signIn();
    tick();
    const id = addWorld(7, '苍澜界');
    gate = (req) => {
      if (!isWorld(req, id, 'PUT')) return;
      gate = null;
      // 腾地方挤掉的(saveStore 自己删,不经过 deleteWorld)
      for (const k of [...a.map.keys()]) if (k.endsWith(`:${id}`)) a.map.delete(k);
    };
    await syncNow();
    expect(titles()).toEqual(['北境编年']);
    await syncNow();
    expect(fake.users.get('writer@example.com')!.worlds.get(id)!.deletedAt).toBeNull();
    expect(titles()).toEqual(['北境编年', '苍澜界']);
  });

  it('两边都改过,「我的世界」满了:先不另存(不超过上限),写没同步上;腾出地方再两份都留', async () => {
    const a = new FakeStorage();
    const b = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    await signIn();
    device(b);
    await signIn();
    const extra: string[] = [];
    for (let i = 1; i < saveStore.MAX_WORLDS; i++) extra.push(addWorld(1000 + i, `世界${i}`));
    await syncNow();

    device(a);
    tick();
    saveStore.renameWorld(id, '那边的名字');
    await syncNow();

    device(b);
    tick();
    saveStore.renameWorld(id, '这边的名字');
    const v = await syncNow();
    expect(saveStore.listWorlds()).toHaveLength(saveStore.MAX_WORLDS);
    expect(titles().filter((t) => t?.includes('另一台设备'))).toEqual([]);
    expect(v.failed.get(id)).toContain('满了');
    expect((fake.users.get('writer@example.com')!.worlds.get(id)!.save as SaveFile).title).toBe('那边的名字');

    saveStore.deleteWorld(extra[0]);
    await syncNow();
    expect(saveStore.listWorlds()).toHaveLength(saveStore.MAX_WORLDS);
    expect(titles()).toContain('这边的名字');
    expect(titles()).toContain('那边的名字（另一台设备）');
    expect(getSyncView().failed.size).toBe(0);
  });

  it('还用老编号存着的世界(浏览器存储满了没换成新编号):写没同步上,退出登录不让选"删掉"', async () => {
    const a = new FakeStorage();
    // 改版前按"种子 + 参数"存的世界;打开网页换新编号时浏览器写不下
    const old = makeSave({ ...DEFAULT_PARAMS, seed: 5 }, EMPTY_EDITS, 'check5', '旧世界');
    const oldId = worldKey(old.params);
    a.map.set(`wenming-ditu:world:${oldId}`, JSON.stringify(old));
    a.deny = (k) => k.startsWith('wenming-ditu:world:w');
    device(a);
    expect(titles()).toEqual(['旧世界']);
    a.deny = null;
    addWorld(7, '苍澜界');
    await signIn();
    expect(worldSync(oldId)).toMatchObject({ state: 'failed' });
    const r = await signOut(false);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? '' : r.message).toContain('以前存的世界');
    expect(getSession()).not.toBeNull();
    expect(titles()).toEqual(['旧世界', '苍澜界']);
    // 留着可以
    expect(await signOut(true)).toEqual({ ok: true });
  });
});

describe('云同步:退出、换账号、别的标签页', () => {
  const isWorld = (req: Request, id: string, method: string) => req.method === method && new URL(req.url).pathname === `/v1/worlds/${id}`;

  it('退出选"删掉":等服务器回话的工夫新建的世界不会被后删掉', async () => {
    const a = new FakeStorage();
    device(a);
    addWorld(7, '苍澜界');
    await signIn();
    gate = (req) => {
      if (new URL(req.url).pathname !== '/v1/auth/logout') return;
      gate = null;
      // 退出窗已经关了(本地先忘了令牌),用户接着新建了一个
      expect(getSession()).toBeNull();
      addWorld(99, '北境编年');
    };
    expect(await signOut(false)).toEqual({ ok: true });
    expect(titles()).toEqual(['北境编年']);
  });

  /** 两台设备都登录同一个账号;B 上新建一个(A 同步时最后才取它),回到 A */
  async function twoDevices() {
    const a = new FakeStorage();
    const b = new FakeStorage();
    device(a);
    const id = addWorld(7, '苍澜界');
    await signIn();
    device(b);
    await signIn();
    const c = addWorld(99, '北境编年');
    await syncNow();
    device(a);
    return { a, id, c };
  }

  it('退出选"删掉":同步途中已经看过的世界又改了(AI 刚写完一段):接着同步上再删,不丢', async () => {
    const { id, c } = await twoDevices();
    gate = (req) => {
      if (!isWorld(req, c, 'GET')) return;
      gate = null;
      putNote(id, { key: 'k', kind: '史书', title: '大昌', text: '刚写完', createdAt: '2026-10-05T00:00:00Z', provider: 'mock', model: 'm' });
    };
    expect(await signOut(false)).toEqual({ ok: true });
    expect(titles()).toEqual([]);
    expect((fake.users.get('writer@example.com')!.worlds.get(id)!.notes as { text: string }[]).map((n) => n.text)).toEqual(['刚写完']);
  });

  it('退出选"删掉":同步途中已经看过的世界被别的标签页改了(这里没收到通知):没同步上,不删', async () => {
    const { a, id, c } = await twoDevices();
    gate = (req) => {
      if (!isWorld(req, c, 'GET')) return;
      gate = null;
      const key = `wenming-ditu:world:${id}`;
      a.map.set(key, JSON.stringify({ ...JSON.parse(a.map.get(key)!), title: '别的标签页改的' }));
    };
    const r = await signOut(false);
    expect(r).toMatchObject({ ok: false });
    expect(r.ok ? '' : r.message).toContain('还没同步上');
    expect(titles()).toEqual(['别的标签页改的', '北境编年']);
    expect(getSession()).not.toBeNull();
    expect(await signOut(false)).toEqual({ ok: true });
    expect((fake.users.get('writer@example.com')!.worlds.get(id)!.save as SaveFile).title).toBe('别的标签页改的');
  });

  it('一个账号存不上去的(那个账号自己的上限),换个账号照样存', async () => {
    device(new FakeStorage());
    const id = addWorld(7, '苍澜界');
    gate = (req) => {
      if (!isWorld(req, id, 'PUT')) return;
      return new Response(JSON.stringify({ error: { code: 'bad-request', message: '账号里的世界太多了' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    };
    const v = await signIn();
    expect(v.failed.get(id)).toContain('太多');
    await signOut(true);
    gate = null;
    const w = await signIn('other@example.com');
    expect(w.failed.size).toBe(0);
    expect(fake.users.get('other@example.com')!.worlds.get(id)).toBeDefined();
  });

  it('取回来的工夫用户新建了世界、放满了:新的那个先不放,不超过上限', async () => {
    const a = new FakeStorage();
    const b = new FakeStorage();
    device(a);
    const x = addWorld(7, '苍澜界');
    await signIn();
    device(b);
    for (let i = 1; i < saveStore.MAX_WORLDS; i++) addWorld(1000 + i, `世界${i}`);
    gate = (req) => {
      if (!isWorld(req, x, 'GET')) return;
      gate = null;
      addWorld(99, '北境编年');
    };
    await signIn();
    expect(saveStore.listWorlds()).toHaveLength(saveStore.MAX_WORLDS);
    expect(titles()).not.toContain('苍澜界');
    expect(titles()).toContain('北境编年');
  });

  it('别的标签页退出、换了账号:这里跟着变,同步也跟着停下或换过去', async () => {
    const a = new FakeStorage();
    device(a);
    addWorld(7, '苍澜界');
    await signIn();
    const writer = a.map.get('civ-atlas:account')!;
    // 拿一个 other 的令牌(不退出,两个令牌都有效)
    await login('other@example.com', FAKE_CODE, FAKE_INVITE);
    const other = a.map.get('civ-atlas:account')!;
    a.map.set('civ-atlas:account', writer);
    refreshSession();
    expect(getSession()?.user.account).toBe('writer@example.com');
    await syncNow();
    // 另一个标签页退出了
    a.map.delete('civ-atlas:account');
    refreshSession();
    expect(getSession()).toBeNull();
    expect(getSyncView().phase).toBe('off');
    // 另一个标签页登录了 other
    a.map.set('civ-atlas:account', other);
    refreshSession();
    expect(getSession()?.user.account).toBe('other@example.com');
    const v = await syncNow();
    expect(v.phase).toBe('idle');
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

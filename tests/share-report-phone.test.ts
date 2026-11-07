/**
 * 绑手机号、举报分享短链接、短链接暂停 / 停掉、封禁时网页拿到的东西。
 * 用开发假服务器(不开端口)当服务器,顺带看它和服务器的接口约定对得上。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAiServer, FAKE_CODE } from '../scripts/lib/fakeAiServer';
import { ServerError, setServerForTest } from '../src/account/server';
import { _resetSessionForTest, deleteAccount, fetchAuthOptions, getSession, login, onAccountDisabled } from '../src/account/session';
import { createShare, listAllShares, openShareCode, putCloud, seenStoppedShare, stopShare } from '../src/account/cloud';
import { bindPhone, cleanPhone, fetchMe, sendPhoneCode } from '../src/account/phone';
import { askPhone, knownPhone, refreshMe, submitBan } from '../src/ui/submitView';
import { fetchOwnFile } from '../src/account/fullWorlds';
import { clearToast, getToast } from '../src/ui/toastStore';
import { reportShare, wasShareReported } from '../src/ui/shareReport';

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
const EMAIL = 'lin@example.com';
const WORLD = 'wsharereport1';
let fake: ReturnType<typeof createFakeAiServer>;

const dev = (path: string, body: unknown, token?: string) =>
  fake.handle(new Request(`${BASE}${path}`, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) }));
const tokenOf = () => (JSON.parse(String((g.localStorage as FakeStorage).getItem('civ-atlas:account'))) as { token: string }).token;
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ServerError ? e.code : String(e);
  }
};

async function signInWithWorld(): Promise<string> {
  await login(EMAIL, FAKE_CODE);
  await putCloud(WORLD, { baseRev: 0, save: { title: '塞雷尼亚' } });
  return (await createShare(WORLD)).code;
}

beforeEach(() => {
  fake = createFakeAiServer({ chunkDelayMs: 0, fullCheckMs: 0 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: RequestInit) => fake.handle(new Request(String(u), init))),
  );
  g.localStorage = new FakeStorage();
  _resetSessionForTest();
  setServerForTest(BASE);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setServerForTest(undefined);
  _resetSessionForTest();
  delete g.localStorage;
});

describe('绑手机号', () => {
  it('号码写法:空格、横杠、+86 都认', () => {
    expect(cleanPhone('138 0013 8866')).toBe('13800138866');
    expect(cleanPhone('+86 138-0013-8866')).toBe('13800138866');
    expect(cleanPhone('1380013886')).toBeNull();
    expect(cleanPhone('23800138866')).toBeNull();
  });

  it('发码、绑上、换一个;/v1/me 跟着变', async () => {
    await login(EMAIL, FAKE_CODE);
    expect((await fetchMe()).phone).toBeNull();
    const sent = await sendPhoneCode('13800138866');
    expect(sent).toMatchObject({ to: '138****8866', resendAfter: 60, expiresIn: 600, devCode: FAKE_CODE });
    expect(await code(bindPhone('13800138866', '000000'))).toBe('bad-code');
    expect(await bindPhone('13800138866', FAKE_CODE)).toEqual({ tail: '8866', masked: '138****8866' });
    await refreshMe();
    expect(knownPhone()).toEqual({ tail: '8866', masked: '138****8866' });
    // 换一个:新号收码核对过才换
    expect(await code(sendPhoneCode('13800138866'))).toBe('phone-same');
    await sendPhoneCode('13700135520');
    expect(await bindPhone('13700135520', FAKE_CODE)).toEqual({ tail: '5520', masked: '137****5520' });
    expect((await fetchMe()).phone?.tail).toBe('5520');
  });

  it('换绑出错的几种都分得开', async () => {
    await login(EMAIL, FAKE_CODE);
    expect(await code(sendPhoneCode('1380013'))).toBe('bad-phone');
    expect(await code(sendPhoneCode('13900132277'))).toBe('phone-taken');
    expect(await code(sendPhoneCode('13500137701'))).toBe('phone-blocked');
    await sendPhoneCode('13800138866');
    expect(await code(sendPhoneCode('13800138866'))).toBe('rate-limit');
    await dev('/v1/dev/phone', { fail: 'unavailable' }, tokenOf());
    expect(await code(sendPhoneCode('13600136600'))).toBe('unavailable');
    await dev('/v1/dev/ban', { account: EMAIL, ban: { level: 'submit', reason: 'spam', reasonText: '乱投、刷投稿' } });
    expect(await code(sendPhoneCode('13600136600'))).toBe('submit-banned');
  });

  it('服务器要求绑手机号:没绑开不了分享,绑好就能开', async () => {
    await login(EMAIL, FAKE_CODE);
    await putCloud(WORLD, { baseRev: 0, save: { title: '塞雷尼亚' } });
    await dev('/v1/dev/submit', { phoneRequired: true }, tokenOf());
    expect((await fetchAuthOptions()).features.phoneRequired).toBe(true);
    expect(await code(createShare(WORLD))).toBe('need-phone');
    await sendPhoneCode('13800138866');
    await bindPhone('13800138866', FAKE_CODE);
    expect(await code(createShare(WORLD))).toBe('ok');
  });
});

describe('举报分享短链接', () => {
  it('同一台设备只举报一次;3 次自动暂停,打开的人看到暂停,开的人看到被举报', async () => {
    const c = await signInWithWorld();
    expect(wasShareReported(c)).toBe(false);
    await reportShare(c, 'privacy');
    expect(wasShareReported(c)).toBe(true);
    expect(fake.shares.get(c)!.reports).toBe(1);
    await reportShare(c, 'privacy');
    expect(fake.shares.get(c)!.reports).toBe(1);
    await fake.handle(new Request(`${BASE}/v1/s/${c}/report`, { method: 'POST', body: JSON.stringify({ reason: 'illegal' }) }));
    await fake.handle(new Request(`${BASE}/v1/s/${c}/report`, { method: 'POST', body: JSON.stringify({ reason: 'abuse' }) }));
    expect(await code(openShareCode(c))).toBe('share-paused');
    expect((await listAllShares()).shares[0].paused?.by).toBe('auto');
  });

  it('一小时太多次:太频繁;理由不对、停了的不收', async () => {
    const c = await signInWithWorld();
    const send = (reason: string, k = c) => code(fake.handle(new Request(`${BASE}/v1/s/${k}/report`, { method: 'POST', body: JSON.stringify({ reason }) })).then((r) => (r.ok ? r : r.json().then((j) => Promise.reject(new ServerError(r.status, j.error.code, j.error.message))))));
    expect(await send('nope')).toBe('bad-request');
    expect(await send('other', 'zzzzzzzz')).toBe('share-gone');
    for (let i = 0; i < 5; i++) expect(await send('other')).toBe('ok');
    expect(await code(reportShare(c, 'other'))).toBe('rate-limit');
    expect(wasShareReported(c)).toBe(false);
  });

  it('作品墙没开(没人处理举报):404', async () => {
    const c = await signInWithWorld();
    await dev('/v1/dev/gallery', { off: true });
    expect(await reportShare(c, 'other').catch((e: ServerError) => e.status)).toBe(404);
  });
});

describe('暂停、停掉', () => {
  it('暂停中停掉了:这个世界开不了新链接,我们看过以后能开新的', async () => {
    const c = await signInWithWorld();
    await dev('/v1/dev/share', { pause: 'admin' }, tokenOf());
    expect((await createShare(WORLD)).paused?.by).toBe('admin');
    await stopShare(WORLD);
    expect((await listAllShares()).shares).toEqual([]);
    const held = await createShare(WORLD).catch((e: ServerError) => e);
    expect(held).toMatchObject({ code: 'share-held', data: { paused: { by: 'admin' } } });
    await dev('/v1/dev/share', { resolve: true }, tokenOf());
    const again = await createShare(WORLD);
    expect(again.code).not.toBe(c);
    expect(again.paused).toBeUndefined();
  });

  it('我们彻底停的:打开的人看到 stoppedBy site;开的人那里列着,点了知道了就不列', async () => {
    const c = await signInWithWorld();
    await dev('/v1/dev/share', { stop: '举报核实:写了真人的隐私' }, tokenOf());
    expect(await openShareCode(c).catch((e: ServerError) => [e.code, e.data.stoppedBy])).toEqual(['share-gone', 'site']);
    const r = await listAllShares();
    expect(r.shares).toEqual([]);
    expect(r.stopped).toMatchObject([{ code: c, worldId: WORLD, title: '塞雷尼亚', reason: '举报核实:写了真人的隐私' }]);
    await seenStoppedShare(c);
    expect((await listAllShares()).stopped).toEqual([]);
  });
});

describe('封禁', () => {
  const PRIVACY = { level: 'submit', reason: 'privacy', reasonText: '投来的作品多次写了真人的隐私', at: '2026-11-07T00:00:00Z' };

  it('停了投稿:分享暂停(ban),开不了新的,/v1/me 带 ban', async () => {
    const c = await signInWithWorld();
    await dev('/v1/dev/ban', { account: EMAIL, ban: PRIVACY });
    expect((await listAllShares()).shares[0].paused?.by).toBe('ban');
    expect(await code(openShareCode(c))).toBe('share-paused');
    const e = await createShare(WORLD, '林间').catch((x: ServerError) => x);
    expect(e).toMatchObject({ code: 'submit-banned', data: { ban: { reason: 'privacy' } } });
    await refreshMe();
    expect(submitBan()).toMatchObject({ level: 'submit', reasonText: '投来的作品多次写了真人的隐私' });
  });

  it('撤下时顺手停的:服务器的话就是那一整句', async () => {
    await signInWithWorld();
    const whole = '你投的作品因为写了真人的隐私被撤下了，账号同时停止投稿';
    await dev('/v1/dev/ban', { account: EMAIL, ban: { level: 'submit', reason: 'withdraw', reasonText: whole } });
    const e = await createShare(WORLD).catch((x: ServerError) => x);
    expect(e).toMatchObject({ code: 'submit-banned', message: whole });
  });

  it('停用账号:登录被拒,带 ban;注销前停用的邮箱再注册也被拒(carried)', async () => {
    await login(EMAIL, FAKE_CODE);
    _resetSessionForTest();
    await dev('/v1/dev/ban', { account: EMAIL, ban: { level: 'all', reason: 'illegal-share', reasonText: '分享出去的世界有违法违规的内容' } });
    const e = await login(EMAIL, FAKE_CODE).catch((x: ServerError) => x);
    expect(e).toMatchObject({ status: 401, code: 'auth', data: { ban: { level: 'all', reasonText: '分享出去的世界有违法违规的内容' } } });

    // 停着投稿注销:同一个邮箱再注册带上同一档
    await login('mo@example.com', FAKE_CODE);
    await dev('/v1/dev/ban', { account: 'mo@example.com', ban: PRIVACY });
    expect(await deleteAccount(FAKE_CODE)).toBe(true);
    await login('mo@example.com', FAKE_CODE);
    await refreshMe();
    expect(submitBan()).toMatchObject({ level: 'submit', reason: 'privacy' });
    expect((await fetchMe()).ban).toMatchObject({ carried: true });

    // 停用着注销:不让注册
    await dev('/v1/dev/ban', { account: 'mo@example.com', ban: { level: 'all', reason: 'spam', reasonText: '乱投、刷投稿' }, gone: true });
    const again = await login('mo@example.com', FAKE_CODE).catch((x: ServerError) => x);
    expect(again).toMatchObject({ code: 'auth', message: '这个邮箱注销前的账号已停用,不能再注册。原因:乱投、刷投稿', data: { ban: { carried: true, at: null } } });
  });
});

describe('已经登着的账号被停用', () => {
  const ILLEGAL = { level: 'all', reason: 'illegal-share', reasonText: '分享出去的世界有违法违规的内容' };
  let told = 0;
  let off: () => void = () => {};
  beforeEach(() => {
    told = 0;
    off = onAccountDisabled(() => told++);
  });
  afterEach(() => off());

  it('下一次请求:401 带 ban,退出登录、通知一次;再请求不再通知', async () => {
    await signInWithWorld();
    await dev('/v1/dev/ban', { account: EMAIL, ban: ILLEGAL });
    const e = await fetchMe().catch((x: ServerError) => x);
    expect(e).toMatchObject({ status: 401, code: 'auth', message: '这个账号已停用,已经退出登录。原因:分享出去的世界有违法违规的内容', data: { ban: { level: 'all' } } });
    expect(getSession()).toBeNull();
    expect(told).toBe(1);
    expect(await code(listAllShares())).toBe('auth');
    expect(told).toBe(1);
  });

  it('传到账号那边的请求(取整个世界)走同一条路', async () => {
    await signInWithWorld();
    await dev('/v1/dev/ban', { account: EMAIL, ban: ILLEGAL });
    expect(await code(fetchOwnFile(WORLD))).toBe('auth');
    expect(getSession()).toBeNull();
    expect(told).toBe(1);
  });

  it('普通的登录过期:照旧退出登录,不通知', async () => {
    await signInWithWorld();
    await fake.handle(new Request(`${BASE}/v1/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${tokenOf()}` } }));
    const e = (await fetchMe().catch((x: ServerError) => x)) as ServerError;
    expect(e).toMatchObject({ status: 401, code: 'auth', message: '登录过期了,请重新登录' });
    expect(e.data.ban).toBeUndefined();
    expect(getSession()).toBeNull();
    expect(told).toBe(0);
  });

  it('解封以后原来的令牌作废,重新登录能用', async () => {
    await signInWithWorld();
    const old = tokenOf();
    await dev('/v1/dev/ban', { account: EMAIL, ban: ILLEGAL });
    await dev('/v1/dev/ban', { account: EMAIL, ban: null });
    const r = await fake.handle(new Request(`${BASE}/v1/me`, { headers: { Authorization: `Bearer ${old}` } }));
    expect((await r.json()).error).toEqual({ code: 'auth', message: '登录过期了,请重新登录' });
    await login(EMAIL, FAKE_CODE);
    expect((await fetchMe()).ban).toBeNull();
  });

  it('提示条:这个账号已停用,已经退出登录 / 世界还在这个浏览器里', async () => {
    await import('../src/ui/AccountDialogs');
    clearToast('account-disabled');
    await signInWithWorld();
    await dev('/v1/dev/ban', { account: EMAIL, ban: ILLEGAL });
    await fetchMe().catch(() => {});
    expect(getToast()).toMatchObject({ id: 'account-disabled', kind: 'warn', text: '这个账号已停用，已经退出登录', more: ['世界还在这个浏览器里'] });
    clearToast('account-disabled');
  });
});

describe('点「分享…」先问手机号', () => {
  /** 拦住 /v1/me:放行前一直等着;fail = 放行时当连不上 */
  function holdMe(fail: boolean) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string, init?: RequestInit) => {
        if (String(u).endsWith('/v1/me')) {
          await gate;
          if (fail) throw new TypeError('network');
        }
        return fake.handle(new Request(String(u), init));
      }),
    );
    return release;
  }
  const wait = () => new Promise((r) => setTimeout(r, 0));

  it.each([
    ['问不成', true],
    ['问成', false],
  ])('问的工夫换了账号(%s):不接着做', async (_what, fail) => {
    await login(EMAIL, FAKE_CODE);
    const release = holdMe(fail);
    const then = vi.fn();
    askPhone({ for: 'share', then });
    await login('mo@example.com', FAKE_CODE);
    release();
    for (let i = 0; i < 5; i++) await wait();
    expect(then).not.toHaveBeenCalled();
  });

  it('没换账号:问不成照样接着做(真没绑服务器会挡回来),问到绑了也接着做', async () => {
    await login(EMAIL, FAKE_CODE);
    let release = holdMe(true);
    const then = vi.fn();
    askPhone({ for: 'share', then });
    release();
    for (let i = 0; i < 5; i++) await wait();
    expect(then).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn(async (u: string, init?: RequestInit) => fake.handle(new Request(String(u), init))));
    await sendPhoneCode('13800138866');
    await bindPhone('13800138866', FAKE_CODE);
    release = holdMe(false);
    askPhone({ for: 'share', then });
    release();
    for (let i = 0; i < 5; i++) await wait();
    expect(then).toHaveBeenCalledTimes(2);
  });
});

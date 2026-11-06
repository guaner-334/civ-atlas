/**
 * 只开作品墙(VITE_ACCOUNTS=off):配了服务器也不发账号那些请求、界面按没登录算;作品墙照服务器说的出。
 * 账号开着时,我们的 AI 照服务器登录窗选项里的 features.ai 出。
 * 服务器用开发假服务器(不开端口),顺带看它的作品墙接口和网页对得上。
 */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAiServer } from '../scripts/lib/fakeAiServer';
import { accountServer, call, serverBase, setAccountsForTest, setServerForTest } from '../src/account/server';
import { _resetSessionForTest, currentAccount, fetchAuthOptions, getSession, logout, onAuthOptionsChange } from '../src/account/session';
import { fetchFile, fetchWorkFile } from '../src/account/fullWorlds';
import { coverUrl, fetchWork, getGallery, isWorkGone, loadGallery, reportWork, resetGalleryForTest } from '../src/account/gallery';
import { checkOfficialAi, officialProvider, officialServer, refreshOfficialAccount } from '../src/ai/providers/official';
import { decodePresetHash } from '../src/ui/presetLink';
import { decodeRulesHash } from '../src/gen/civ/ruleShare';
import { openWorldFile, readWorldContent } from '../src/gen/worldFile';
import { READER_VERSIONS } from '../src/gen/readers/versions';

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
let paths: string[];

/** 假服务器第一次列作品墙时要现做那份世界文件(一两秒) */
const settle = async () => {
  for (let i = 0; i < 3000 && getGallery().status === 'loading'; i++) await new Promise((r) => setTimeout(r, 10));
};
const dev = (body: unknown) => fake.handle(new Request(`${BASE}/v1/dev/gallery`, { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  fake = createFakeAiServer({ chunkDelayMs: 0, fullCheckMs: 0 });
  paths = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: RequestInit) => {
      const req = new Request(String(u), init);
      paths.push(new URL(req.url).pathname);
      return fake.handle(req);
    }),
  );
  const st = new FakeStorage();
  // 以前登录过留下的令牌
  st.setItem('civ-atlas:account', JSON.stringify({ token: 'fake-old', user: { id: 'u1', account: 'a@b.c' } }));
  g.localStorage = st;
  _resetSessionForTest();
  setServerForTest(BASE);
  resetGalleryForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAccountsForTest(undefined);
  setServerForTest(undefined);
  resetGalleryForTest();
  _resetSessionForTest();
  delete g.localStorage;
});

describe('账号关着', () => {
  beforeEach(() => setAccountsForTest(false));

  it('账号那些和没配服务器一样:不算登录着、没有我们的 AI,一个账号请求都不发', async () => {
    expect(serverBase()).toBe(BASE);
    expect(accountServer()).toBeNull();
    expect(getSession()?.token).toBe('fake-old');
    expect(currentAccount()).toBeNull();
    expect(officialServer()).toBeNull();
    expect(officialProvider.offered?.()).toBe(false);
    expect((await fetchAuthOptions()).inviteOnly).toBe(false);
    await expect(call('/v1/me', { token: 'fake-old' })).rejects.toMatchObject({ code: 'not-configured' });
    await expect(fetchFile('/v1/s/Abcd1234/full')).rejects.toMatchObject({ code: 'not-configured' });
    await logout();
    expect(paths).toEqual([]);
  });

  it('作品墙照常:列表、作品、封面、世界文件、举报', async () => {
    loadGallery();
    await settle();
    const s = getGallery();
    expect(s.status).toBe('ok');
    expect(s.list?.works.map((w) => [w.id, w.kind])).toEqual([
      ['k7qm2xpa', 'world'],
      ['m3np8rta', 'map'],
      ['p4tz6hwe', 'preset'],
      ['r6zh9qkw', 'rules'],
    ]);
    expect(s.list?.works[0].rules).toMatchObject({ name: '长治久安', changed: 5 });
    expect(s.list?.works[3].rules).toEqual({ name: '战国千年', changed: 6, brief: '战争 ×2、议和后 2 年不再开战、分裂 ×1.5' });
    expect(s.list?.featured.map((f) => f.id)).toEqual(['k7qm2xpa']);
    expect(s.list?.challenges[0].works).toEqual(['m3np8rta']);
    expect(s.list!.challenges[0].deadline >= new Date().toISOString().slice(0, 10)).toBe(true);

    const map = await fetchWork('m3np8rta');
    expect((map.save as { seed: number }).seed).toBe(2024);
    const preset = await fetchWork('p4tz6hwe');
    expect(decodePresetHash(preset.preset!)).toMatchObject({ ok: true });
    const rules = await fetchWork('r6zh9qkw');
    expect(decodeRulesHash(rules.ruleLink!)).toMatchObject({ ok: true, rules: { name: '战国千年', by: '鲸落' } });

    const world = await fetchWork('k7qm2xpa');
    expect(world.save).toBeUndefined();
    const raw = await (await fetch(`${BASE}/v1/gallery`)).json();
    expect(raw.works[0].full).toEqual({ bytes: world.full!.bytes });
    expect(raw.works[1].full).toBeUndefined();
    const seen: number[] = [];
    const file = await fetchWorkFile('k7qm2xpa', { total: world.full!.bytes, onBytes: (done) => seen.push(done) });
    const bytes = new Uint8Array(await file.arrayBuffer());
    expect(bytes.length).toBe(world.full!.bytes);
    expect(seen.at(-1)).toBe(world.full!.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(world.full!.sum);
    expect((await fetch(`${BASE}/v1/gallery/k7qm2xpa/full`)).headers.get('etag')).toBe(`"${world.full!.sum}"`);
    // 网页能照存的内容打开:用的是「长治久安」那套规则
    const opened = await openWorldFile(bytes, { readers: { ...READER_VERSIONS } });
    expect(opened.manifest.recipe.edits.rules).toMatchObject({ name: '长治久安' });
    expect((await readWorldContent(opened)).civ.polities.length).toBeGreaterThan(0);

    const cover = await fetch(coverUrl('m3np8rta'));
    expect(cover.status).toBe(200);
    expect(cover.headers.get('content-type')).toMatch(/^image\//);

    await reportWork('m3np8rta', 'other');
    expect(fake.gallery.reports).toEqual([{ id: 'm3np8rta', reason: 'other' }]);
    expect((await fetch(`${BASE}/v1/gallery/m3np8rta/report`, { method: 'POST', body: JSON.stringify({ reason: 'x' }) })).status).toBe(400);
    expect(paths.every((p) => p.startsWith('/v1/gallery'))).toBe(true);
  }, 60_000);

  it('撤下的作品 410;服务器关了作品墙(404)= 不出', async () => {
    await dev({ withdrawn: ['m3np8rta'] });
    const e = await fetchWork('m3np8rta').catch((x: unknown) => x);
    expect(isWorkGone(e)).toBe(true);
    loadGallery();
    await settle();
    expect(getGallery().list?.works.map((w) => w.id)).toEqual(['k7qm2xpa', 'p4tz6hwe', 'r6zh9qkw']);
    // 打开作品以后、取世界文件之前撤下的
    await dev({ withdrawn: ['k7qm2xpa'] });
    expect(isWorkGone(await fetchWorkFile('k7qm2xpa').catch((x: unknown) => x))).toBe(true);
    expect(getGallery().list?.challenges[0].works).toEqual([]);

    await dev({ off: true });
    loadGallery(true);
    await settle();
    expect(getGallery()).toMatchObject({ status: 'off', list: null });
  }, 60_000);
});

describe('账号开着(默认)', () => {
  it('配了服务器:留着的登录照旧算数;服务器说开着我们的 AI 才有', async () => {
    expect(accountServer()).toBe(BASE);
    expect(currentAccount()?.token).toBe('fake-old');
    expect(officialServer()).toBeNull();
    expect((await fetchAuthOptions()).features).toEqual({ ai: true });
    expect(officialServer()).toBe(BASE);
    expect(officialProvider.offered?.()).toBe(true);
  });

  it('服务器说我们的 AI 关着:不露,也不去查积分', async () => {
    await fake.handle(new Request(`${BASE}/v1/dev/ai`, { method: 'POST', body: JSON.stringify({ off: true }) }));
    expect((await fetchAuthOptions()).features).toEqual({ ai: false });
    expect(officialServer()).toBeNull();
    expect(officialProvider.offered?.()).toBe(false);
    expect(officialProvider.status().reason).toContain('内测');
    await refreshOfficialAccount();
    expect(paths).not.toContain('/v1/me');
  });

  it('服务器没说(没有 features、没有这个接口):当关', async () => {
    const answer = (body: unknown, status = 200) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })));
    answer({ accountKinds: ['email'], inviteOnly: true, codeTtlSec: 600 });
    expect((await fetchAuthOptions()).inviteOnly).toBe(true);
    expect(officialServer()).toBeNull();

    _resetSessionForTest();
    answer({ accountKinds: ['email'], inviteOnly: true, codeTtlSec: 600, features: { ai: 'yes' } });
    await fetchAuthOptions();
    expect(officialServer()).toBeNull();

    _resetSessionForTest();
    answer({ error: { code: 'bad-request', message: '没有这个接口' } }, 404);
    expect((await fetchAuthOptions()).features).toEqual({ ai: false });
    expect(officialServer()).toBeNull();
  });

  it('问不到(连不上):当关;打开账号窗、AI 设置时再问,问到开着就露出来,问到了就不再问', async () => {
    const real = globalThis.fetch;
    const down = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', down);
    await refreshOfficialAccount();
    expect(down).toHaveBeenCalledTimes(1);
    expect(officialServer()).toBeNull();
    const seen: boolean[] = [];
    const off = onAuthOptionsChange(() => seen.push(officialServer() !== null));
    vi.stubGlobal('fetch', real);
    await checkOfficialAi();
    off();
    expect(officialServer()).toBe(BASE);
    expect(seen).toEqual([true]);
    paths.length = 0;
    await checkOfficialAi();
    expect(paths).toEqual([]);
  });
});

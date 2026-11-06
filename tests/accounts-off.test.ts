/**
 * 只开作品墙(VITE_ACCOUNTS=off):配了服务器也不发账号那些请求、界面按没登录算;作品墙照服务器说的出。
 * 服务器用开发假服务器(不开端口),顺带看它的作品墙接口和网页对得上。
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAiServer } from '../scripts/lib/fakeAiServer';
import { accountServer, call, serverBase, setAccountsForTest, setServerForTest } from '../src/account/server';
import { _resetSessionForTest, currentAccount, fetchAuthOptions, getSession, logout } from '../src/account/session';
import { fetchFile, fetchWorkFile } from '../src/account/fullWorlds';
import { coverUrl, fetchWork, getGallery, isWorkGone, loadGallery, reportWork, resetGalleryForTest } from '../src/account/gallery';
import { officialProvider, officialServer } from '../src/ai/providers/official';
import { decodePresetHash } from '../src/ui/presetLink';

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
const FILE = JSON.parse(readFileSync(new URL('./fixtures/world-file/v1.json', import.meta.url), 'utf8')).file as { sha256: string; bytes: number };
let fake: ReturnType<typeof createFakeAiServer>;
let paths: string[];

const settle = async () => {
  for (let i = 0; i < 20 && getGallery().status === 'loading'; i++) await new Promise((r) => setTimeout(r, 5));
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
    ]);
    expect(s.list?.featured.map((f) => f.id)).toEqual(['k7qm2xpa']);
    expect(s.list?.challenges[0].works).toEqual(['m3np8rta']);
    expect(s.list!.challenges[0].deadline >= new Date().toISOString().slice(0, 10)).toBe(true);

    const map = await fetchWork('m3np8rta');
    expect((map.save as { seed: number }).seed).toBe(2024);
    const preset = await fetchWork('p4tz6hwe');
    expect(decodePresetHash(preset.preset!)).toMatchObject({ ok: true });

    const raw = await (await fetch(`${BASE}/v1/gallery`)).json();
    expect(raw.works[0].full).toEqual({ bytes: FILE.bytes });
    expect(raw.works[1].full).toBeUndefined();
    const world = await fetchWork('k7qm2xpa');
    expect(world.full).toEqual({ sum: FILE.sha256, bytes: FILE.bytes });
    expect(world.save).toBeUndefined();
    const seen: number[] = [];
    const file = await fetchWorkFile('k7qm2xpa', { total: world.full!.bytes, onBytes: (done) => seen.push(done) });
    expect(file.size).toBe(FILE.bytes);
    expect(seen.at(-1)).toBe(FILE.bytes);
    expect((await fetch(`${BASE}/v1/gallery/k7qm2xpa/full`)).headers.get('etag')).toBe(`"${FILE.sha256}"`);

    const cover = await fetch(coverUrl('m3np8rta'));
    expect(cover.status).toBe(200);
    expect(cover.headers.get('content-type')).toMatch(/^image\//);

    await reportWork('m3np8rta', 'other');
    expect(fake.gallery.reports).toEqual([{ id: 'm3np8rta', reason: 'other' }]);
    expect((await fetch(`${BASE}/v1/gallery/m3np8rta/report`, { method: 'POST', body: JSON.stringify({ reason: 'x' }) })).status).toBe(400);
    expect(paths.every((p) => p.startsWith('/v1/gallery'))).toBe(true);
  });

  it('撤下的作品 410;服务器关了作品墙(404)= 不出', async () => {
    await dev({ withdrawn: ['m3np8rta'] });
    const e = await fetchWork('m3np8rta').catch((x: unknown) => x);
    expect(isWorkGone(e)).toBe(true);
    loadGallery();
    await settle();
    expect(getGallery().list?.works.map((w) => w.id)).toEqual(['k7qm2xpa', 'p4tz6hwe']);
    // 打开作品以后、取世界文件之前撤下的
    await dev({ withdrawn: ['k7qm2xpa'] });
    expect(isWorkGone(await fetchWorkFile('k7qm2xpa').catch((x: unknown) => x))).toBe(true);
    expect(getGallery().list?.challenges[0].works).toEqual([]);

    await dev({ off: true });
    loadGallery(true);
    await settle();
    expect(getGallery()).toMatchObject({ status: 'off', list: null });
  });
});

describe('账号开着(默认)', () => {
  it('配了服务器:留着的登录照旧算数、有我们的 AI', () => {
    expect(accountServer()).toBe(BASE);
    expect(currentAccount()?.token).toBe('fake-old');
    expect(officialServer()).toBe(BASE);
    expect(officialProvider.offered?.()).toBe(true);
  });
});

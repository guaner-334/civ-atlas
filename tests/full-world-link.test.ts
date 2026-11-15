/** 取世界文件:服务器可能回一个限时链接,文件去链接拿;拿不到改由服务器转 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchFile } from '../src/account/fullWorlds';
import { ServerError, setAccountsForTest, setServerForTest } from '../src/account/server';

const BASE = 'http://api.test';
const LINK = 'https://files.test/files/abc?x-oss-signature=s';
const FILE = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

type Call = { url: string; auth: string | null };

function stub(answer: (url: string, calls: Call[]) => Response | Promise<Response>) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: RequestInit) => {
      const url = String(u);
      calls.push({ url, auth: new Headers(init?.headers).get('Authorization') });
      return answer(url, calls);
    }),
  );
  return calls;
}

const file = () => new Response(FILE, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(FILE.length) } });
const link = (body: unknown = { url: LINK, bytes: FILE.length, sum: 'abc' }) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('取世界文件', () => {
  beforeEach(() => {
    setServerForTest(BASE);
    setAccountsForTest(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setServerForTest(undefined);
    setAccountsForTest(undefined);
  });

  it('服务器回链接:去链接拿,不带登录令牌;进度按链接说的大小', async () => {
    const calls = stub((url) => (url.startsWith(BASE) ? link() : file()));
    const seen: [number, number][] = [];
    const got = await fetchFile('/v1/worlds/wabc1234/full', { token: 'tok', onBytes: (d, t) => seen.push([d, t]) });
    expect(await bytesOf(got)).toEqual(FILE);
    expect(calls).toEqual([
      { url: `${BASE}/v1/worlds/wabc1234/full?via=link`, auth: 'Bearer tok' },
      { url: LINK, auth: null },
    ]);
    expect(seen.at(-1)).toEqual([FILE.length, FILE.length]);
  });

  it('服务器直接回文件(没配链接、旧服务器):照旧收', async () => {
    const calls = stub(() => file());
    expect(await bytesOf(await fetchFile('/v1/s/Abcd1234/full'))).toEqual(FILE);
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/v1/s/Abcd1234/full?via=link`]);
  });

  it('链接拿不到(连不上、过期、跨域):去掉 via=link 再问服务器一次,由服务器转', async () => {
    for (const broken of [() => Promise.reject(new TypeError('Failed to fetch')), () => new Response('expired', { status: 403 })]) {
      const calls = stub((url) => (url === LINK ? broken() : url.includes('via=link') ? link() : file()));
      expect(await bytesOf(await fetchFile('/v1/gallery/k7qm2xpa/full'))).toEqual(FILE);
      expect(calls.map((c) => c.url)).toEqual([`${BASE}/v1/gallery/k7qm2xpa/full?via=link`, LINK, `${BASE}/v1/gallery/k7qm2xpa/full`]);
    }
  });

  it('服务器回的错照旧抛;链接的回复不像样算网络出错', async () => {
    stub(() => new Response(JSON.stringify({ error: { code: 'busy', message: '忙', retryAfter: 30 } }), { status: 503, headers: { 'Content-Type': 'application/json' } }));
    await expect(fetchFile('/v1/s/Abcd1234/full')).rejects.toMatchObject({ code: 'busy', status: 503 });
    stub(() => link({ url: 'javascript:alert(1)', bytes: 1 }));
    const e = await fetchFile('/v1/s/Abcd1234/full').catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ServerError);
    expect((e as ServerError).code).toBe('network');
  });

  it('从链接拿到的比说的少:算没下完(存储那边自己说的大小不算)', async () => {
    stub((url) => (url.startsWith(BASE) ? link({ url: LINK, bytes: FILE.length + 1, sum: 'abc' }) : file()));
    await expect(fetchFile('/v1/s/Abcd1234/full')).rejects.toMatchObject({ code: 'network' });
  });

  it('链接那头一直不回:过了等待时间改问服务器,不当成取消', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const calls = stub((url) =>
        url === LINK
          ? new Promise<Response>((_, reject) => {
              const signal = (vi.mocked(fetch).mock.calls.at(-1)?.[1] as RequestInit | undefined)?.signal;
              signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            })
          : url.includes('via=link')
            ? link()
            : file(),
      );
      const got = fetchFile('/v1/s/Abcd1234/full');
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await bytesOf(await got)).toEqual(FILE);
      expect(calls.map((c) => c.url)).toEqual([`${BASE}/v1/s/Abcd1234/full?via=link`, LINK, `${BASE}/v1/s/Abcd1234/full`]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('用的人取消了:不再改问服务器', async () => {
    const stopIt = new AbortController();
    const calls = stub((url) => {
      if (url === LINK) {
        stopIt.abort();
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      }
      return link();
    });
    await expect(fetchFile('/v1/s/Abcd1234/full', { signal: stopIt.signal })).rejects.toMatchObject({ code: 'network' });
    expect(calls.map((c) => c.url)).toEqual([`${BASE}/v1/s/Abcd1234/full?via=link`, LINK]);
  });
});

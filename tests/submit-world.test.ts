/**
 * 投到作品墙:投世界的接口(先问、传块、提交、等核对)和开发假服务器对得上;服务器说的错换成投稿窗里的说法;存档菜单那一项;须知版本。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAiServer, FAKE_CODE } from '../scripts/lib/fakeAiServer';
import { ServerError, setServerForTest } from '../src/account/server';
import { _resetSessionForTest, fetchAuthOptions, login } from '../src/account/session';
import { _setFullNet, sendBlocks, type BlockPlan, type FullHit } from '../src/account/fullWorlds';
import { beginWorldSubmit, commitWorldSubmit, fetchSubmissions, waitSubmission } from '../src/account/submissions';
import { blockRanges, hashBlocks } from '../src/ui/fullBlocks';
import { TERMS, TERMS_VERSION, changedSince } from '../src/ui/submitTerms';
import { readBan, submitMenuItem, type SubmitMenuFacts } from '../src/ui/submitView';
import { checkFail, failWords, hitsFail, jobWords, openNotice, submitFail } from '../src/ui/submitWords';

class FakeStorage {
  map = new Map<string, string>();
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
let token = '';
let sent: string[] = [];

const dev = (b: unknown) => fake.handle(new Request(`${BASE}/v1/dev/submit`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(b) }));

/** 一个不压缩的 ZIP:几个条目 + 末尾一段目录(开头是 PK,假服务器当它是世界文件) */
function zipOf(sizes: number[], fill = 1): Blob {
  const parts: Uint8Array[] = [];
  sizes.forEach((size, i) => {
    const name = new TextEncoder().encode(`p${i}`);
    const head = new Uint8Array(30 + name.length + size);
    const dv = new DataView(head.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint32(18, size, true);
    dv.setUint32(22, size, true);
    dv.setUint16(26, name.length, true);
    head.set(name, 30);
    head.fill(fill + i, 30 + name.length);
    parts.push(head);
  });
  parts.push(new Uint8Array(40).fill(7));
  return new Blob(parts as BlobPart[]);
}

async function planOf(file: Blob): Promise<BlockPlan> {
  return hashBlocks(file, await blockRanges(file, 1000, 512));
}

const form = (extra: Partial<{ title: string; by: string; blurb: string; terms: number }> = {}) => ({ title: '塞雷尼亚', by: '林间', blurb: '有鹰、大定隔着金阳洋对峙两千年', terms: TERMS_VERSION, ...extra });

async function submitOnce(file: Blob, f = form()) {
  const plan = await planOf(file);
  const { need } = await beginWorldSubmit(plan);
  await sendBlocks(file, plan, need, { signal: new AbortController().signal, token });
  const made = await commitWorldSubmit(plan, f, 3000);
  return { need, made, plan };
}

beforeEach(async () => {
  fake = createFakeAiServer({ chunkDelayMs: 0, fullCheckMs: 0 });
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: RequestInit) => fake.handle(new Request(String(u), init))),
  );
  _setFullNet({
    sender: async (sum, data, o) => {
      sent.push(sum);
      const r = await fake.handle(new Request(`${BASE}/v1/world-blocks/${sum}`, { method: 'PUT', headers: { Authorization: `Bearer ${o.token}` }, body: await data.arrayBuffer() }));
      if (!r.ok) throw new ServerError(r.status, 'server', '传块出错');
      o.onBytes(data.size);
    },
  });
  g.localStorage = new FakeStorage();
  _resetSessionForTest();
  setServerForTest(BASE);
  token = (await login('lin@example.com', FAKE_CODE)).session.token;
});

afterEach(() => {
  vi.unstubAllGlobals();
  _setFullNet({});
  setServerForTest(undefined);
  _resetSessionForTest();
  delete g.localStorage;
});

describe('投世界的接口和假服务器', () => {
  it('登录窗选项说开着投稿、投世界;须知版本和服务器的一样', async () => {
    expect((await fetchAuthOptions()).features).toMatchObject({ submit: true, submitWorld: true, phoneRequired: false });
    const list = await fetchSubmissions();
    expect(list.terms).toBe(TERMS_VERSION);
    expect(list.limits).toEqual({ perDay: 3, usedToday: 0, pendingMax: 5, pending: 0 });
    expect(list.submissions).toEqual([]);
  });

  it('先问、传块、提交、等核对 → 等审;同一份再投一块都不用传', async () => {
    const file = zipOf([300, 200]);
    const one = await submitOnce(file);
    expect(one.need.length).toBe(3);
    expect(sent.length).toBe(3);
    expect(one.made.status).toBe('checking');
    const done = await waitSubmission(one.made.id, { signal: new AbortController().signal, everyMs: 0 });
    expect(done.status).toBe('pending');

    sent = [];
    const two = await submitOnce(file, form({ title: '塞雷尼亚第二版' }));
    expect(two.need).toEqual([]);
    expect(sent).toEqual([]);
    await waitSubmission(two.made.id, { signal: new AbortController().signal, everyMs: 0 });
    const list = await fetchSubmissions();
    expect(list.limits).toMatchObject({ usedToday: 2, pending: 2 });
    expect(list.submissions.map((s) => s.title)).toEqual(['塞雷尼亚第二版', '塞雷尼亚']);
  });

  it('核对中再交同一份:还是那一件,不算第二次', async () => {
    fake = createFakeAiServer({ chunkDelayMs: 0, fullCheckMs: 60_000 });
    token = (await login('lin@example.com', FAKE_CODE)).session.token;
    const file = zipOf([100]);
    const a = await submitOnce(file);
    const again = await commitWorldSubmit(a.plan, form(), 3000);
    expect(again.id).toBe(a.made.id);
    expect((await fetchSubmissions()).limits?.usedToday).toBe(1);
  });

  it('须知版本不对:409,投稿窗换成「投稿须知改过了」', async () => {
    const file = zipOf([100]);
    const plan = await planOf(file);
    const { need } = await beginWorldSubmit(plan);
    await sendBlocks(file, plan, need, { signal: new AbortController().signal, token });
    const e = await commitWorldSubmit(plan, form({ terms: TERMS_VERSION - 1 }), 3000).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ServerError);
    expect((e as ServerError).code).toBe('terms-changed');
    expect(submitFail(e)).toEqual({ kind: 'terms' });
  });

  it('今天投满:先问就挡回,按钮上面一行红字;打开投稿窗时就换成说明', async () => {
    await dev({ used: 3 });
    const e = await beginWorldSubmit(await planOf(zipOf([100]))).catch((x: unknown) => x);
    expect(submitFail(e)).toEqual({ kind: 'line', text: '今天已经投满 3 次了，明天再投' });
    const list = await fetchSubmissions();
    expect(openNotice({ limits: list.limits, ban: null })).toMatchObject({ kind: 'notice', which: 'per-day' });
  });

  it('账号停了投稿:列表和挡回的错都带原因', async () => {
    await dev({ ban: { level: 'submit', reason: 'unfit', reasonText: '投来的作品多次有不适合公开的内容', at: null } });
    const list = await fetchSubmissions();
    expect(readBan(list.ban)).toEqual({ level: 'submit', reason: 'unfit', reasonText: '投来的作品多次有不适合公开的内容' });
    const e = await beginWorldSubmit(await planOf(zipOf([100]))).catch((x: unknown) => x);
    expect(submitFail(e)).toMatchObject({ kind: 'notice', which: 'ban', ban: { reasonText: '投来的作品多次有不适合公开的内容' } });
  });

  it('作者填的字碰到词:当场挡回,标出是哪一栏', async () => {
    const e = await submitOnce(zipOf([100]), form({ blurb: '这里有敏感词' })).catch((x: unknown) => x);
    expect(submitFail(e)).toMatchObject({ kind: 'hits', count: 1, fields: ['blurb'], lines: [{ label: '介绍', text: '上面标红的那一句' }], one: null });
  });

  it('核对没过:碰到词、带插件数据、文件不对各有说法', async () => {
    const hits = [
      { by: 'author', part: 'author', kind: '国名', text: '奥利亚王国' },
      { by: 'ai', part: 'author', kind: 'AI 写的', text: '北伐' },
    ];
    await dev({ fail: { code: 'content-filter', message: '这个世界里有 3 处字词不能公开', hits, hitCount: 3 } });
    const a = await submitOnce(zipOf([100]));
    const done = await waitSubmission(a.made.id, { signal: new AbortController().signal, everyMs: 0 });
    expect(done.status).toBe('failed');
    expect(checkFail(done.error, done.reason)).toEqual({
      kind: 'hits',
      count: 3,
      fields: [],
      one: null,
      lines: [
        { label: '国名', text: '「奥利亚王国」' },
        { label: 'AI 写的', text: '「北伐」那一段' },
      ],
    });
    expect(checkFail({ code: 'world-opaque', parts: ['ext.x'] })).toMatchObject({ kind: 'block', act: 'file' });
    expect(checkFail({ code: 'world-invalid' })).toMatchObject({ kind: 'block', act: 'reload', text: '服务器核对没通过，可能是网站刚更新。刷新页面再投一次' });
    expect(checkFail({ code: 'check-limit' })).toMatchObject({ kind: 'block', act: 'retry', text: '服务器这会儿太忙，没核对完。等一会儿再投' });
    // 没收下的不算今天的次数
    expect((await fetchSubmissions()).limits?.usedToday).toBe(0);
  });
});

describe('字', () => {
  it('碰到词:只有一处说名字;网页自己写的改不了,给存成文件', () => {
    const one: FullHit[] = [{ by: 'author', part: 'author', kind: '国名', text: '奥利亚王国' }];
    expect(hitsFail(one, 1)).toMatchObject({ kind: 'hits', one: '国名「奥利亚王国」没通过文字审核，改个名再投' });
    const site: FullHit[] = [...one, { by: 'site', part: 'civ', kind: '历史', text: '……' }];
    expect(hitsFail(site, 2)).toEqual({ kind: 'block', head: null, text: '网页自己写的历史有 1 处没通过文字审核，改不了，这个世界投不了。可以存成文件发给别人', act: 'file' });
  });

  it('服务器说的错:断线分传没传、太大、太忙、核对没过、要绑手机、登录过期', () => {
    const err = (code: string, data: Record<string, unknown> = {}) => new ServerError(400, code, '服务器的话', data);
    expect(submitFail(err('network'), true)).toEqual({ kind: 'net' });
    expect(submitFail(err('network'), false)).toEqual({ kind: 'line', text: '连不上服务器，没投成。联网后再点一次「投稿」' });
    expect(submitFail(err('world-too-big', { worldBytes: 170e6, maxBytes: 150e6 }))).toEqual({ kind: 'line', text: '它约 170 MB，作品墙一个世界最多 150 MB' });
    expect(submitFail(err('busy'))).toMatchObject({ kind: 'block', act: 'retry' });
    expect(submitFail(err('world-newer'))).toMatchObject({ kind: 'block', act: 'reload' });
    expect(submitFail(err('need-phone'))).toEqual({ kind: 'phone' });
    expect(submitFail(err('auth'))).toEqual({ kind: 'line', text: '登录过期了，请重新登录' });
    expect(submitFail(err('submit-limit', { limit: 'pending', pendingMax: 5 }))).toEqual({ kind: 'line', text: '等审的已经有 5 件了，审完或撤回一件再投' });
    expect(submitFail(err('submit-limit', { limit: 'world-tries' }))).toEqual({ kind: 'line', text: '服务器的话' });
    expect(submitFail(err('submit-banned'))).toEqual({ kind: 'line', text: '服务器的话' });
  });

  it('存档菜单那一项:平常写多大;停了投稿、在推演、带插件数据、太大灰着', () => {
    const f: SubmitMenuFacts = { ban: null, pending: false, extras: [], bytes: 4.9e6, maxBytes: 150e6 };
    expect(submitMenuItem(f)).toEqual({ small: '交上整个世界（约 5 MB），我们看过才放上作品墙', off: false, act: 'open' });
    expect(submitMenuItem({ ...f, bytes: null }).small).toBe('交上整个世界，我们看过才放上作品墙');
    expect(submitMenuItem({ ...f, ban: { level: 'submit', reasonText: 'x' } })).toEqual({ small: '你的账号已停止投稿，点这里看原因', off: true, act: 'ban' });
    expect(submitMenuItem({ ...f, pending: true })).toEqual({ small: '还在推演，推完再投', off: true, act: 'none' });
    expect(submitMenuItem({ ...f, extras: ['ext.x'] })).toEqual({ small: '带着插件的附加数据，我们看不到里面，不能投。可以存成文件发给别人', off: true, act: 'none' });
    expect(submitMenuItem({ ...f, bytes: 170e6 })).toEqual({ small: '它约 170 MB，作品墙一个世界最多 150 MB', off: true, act: 'none' });
  });

  it('打开投稿窗就知道投不了的:停了投稿先说,再看今天的次数、等审的件数', () => {
    const l = { perDay: 3, usedToday: 1, pendingMax: 5, pending: 2 };
    expect(openNotice({ limits: l, ban: null })).toBeNull();
    expect(openNotice({ limits: { ...l, pending: 5 }, ban: null })).toMatchObject({ which: 'pending' });
    expect(openNotice({ limits: { ...l, usedToday: 3, pending: 5 }, ban: null })).toMatchObject({ which: 'per-day' });
    expect(openNotice({ limits: l, ban: { level: 'submit', reasonText: 'x' } })).toMatchObject({ which: 'ban' });
  });

  it('提示条:传、核对、断线、投好了', () => {
    expect(jobWords({ id: 'w', title: '塞雷尼亚', phase: 'send', done: 2.1e6, total: 4.9e6 })).toMatchObject({ text: '正在投「塞雷尼亚」', more: '2.1 / 4.9 MB，别关页面', act: 'cancel' });
    expect(jobWords({ id: 'w', title: '塞雷尼亚', phase: 'check', done: 1, total: 1 })).toEqual({ kind: 'progress', text: '正在核对「塞雷尼亚」', more: '已经传完，服务器在检查里面的内容' });
    expect(failWords({ kind: 'net' })).toMatchObject({ text: '传到一半断线了', more: '世界在本机没事，传上去的不用重传', act: 'resume' });
  });

  it('须知第 3 版五条,只改了第 4 条', () => {
    expect(TERMS_VERSION).toBe(3);
    expect(TERMS).toHaveLength(5);
    expect(changedSince(2)).toEqual([3]);
    expect(changedSince(3)).toEqual([]);
    expect(TERMS[3]).toContain('在「我的投稿」里随时撤下');
  });
});

/**
 * 投到作品墙:地图、新建参数、规则一次交上去;我的投稿(列哪几件、每一行的字、撤回、撤下)和开发假服务器对得上。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAiServer, FAKE_CODE } from '../scripts/lib/fakeAiServer';
import { ServerError, setServerForTest } from '../src/account/server';
import { _resetSessionForTest, login } from '../src/account/session';
import { cancelSubmission, fetchSubmissions, postSubmission, takedownSubmission, type Submission } from '../src/account/submissions';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { makeSave } from '../src/gen/savefile';
import { EMPTY_EDITS } from '../src/gen/edits';
import { presetHash } from '../src/ui/presetLink';
import { rulesHash } from '../src/gen/civ/ruleShare';
import { TERMS_VERSION } from '../src/ui/submitTerms';
import { workKey } from '../src/ui/submitView';
import { failWords, notSubmitted, submitFail } from '../src/ui/submitWords';
import { rowWords, shownSubmissions } from '../src/ui/MySubmissions';

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
const dev = (b: unknown) => fake.handle(new Request(`${BASE}/v1/dev/submit`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(b) }));
const form = (extra: Partial<{ title: string; by: string; blurb: string; terms: number }> = {}) => ({ title: '碎月群岛', by: '林间', blurb: '三座岛，一条海峡', terms: TERMS_VERSION, ...extra });
const RULES = { name: '战国千年', values: { 'war.odds': 2 } } as unknown as Parameters<typeof rulesHash>[0];

beforeEach(async () => {
  fake = createFakeAiServer({ chunkDelayMs: 0, fullCheckMs: 0 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: RequestInit) => fake.handle(new Request(String(u), init))),
  );
  g.localStorage = new FakeStorage();
  _resetSessionForTest();
  setServerForTest(BASE);
  token = (await login('lin@example.com', FAKE_CODE)).session.token;
});

afterEach(() => {
  vi.unstubAllGlobals();
  setServerForTest(undefined);
  _resetSessionForTest();
  delete g.localStorage;
});

describe('投地图、新建参数、规则', () => {
  it('三种都一次交上去,进等审,算今天的次数', async () => {
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, EMPTY_EDITS, '');
    expect((await postSubmission({ kind: 'map', save }, form())).status).toBe('pending');
    const preset = presetHash({ name: '乱世大陆', params: DEFAULT_PARAMS, seed: 7, rules: RULES }).replace(/^#/, '');
    expect((await postSubmission({ kind: 'preset', link: preset }, form({ title: '乱世大陆' }))).status).toBe('pending');
    expect((await postSubmission({ kind: 'rules', link: rulesHash(RULES).replace(/^#/, '') }, form({ title: '战国千年' }))).status).toBe('pending');
    const list = await fetchSubmissions();
    expect(list.submissions.map((s) => [s.kind, s.title, s.status])).toEqual([
      ['rules', '战国千年', 'pending'],
      ['preset', '乱世大陆', 'pending'],
      ['map', '碎月群岛', 'pending'],
    ]);
    expect(list.limits).toMatchObject({ usedToday: 3, pending: 3 });
  });

  it('碰到词、须知换了、投满了:和投世界一样的错', async () => {
    const link = rulesHash(RULES).replace(/^#/, '');
    const err = (p: Promise<unknown>) => p.then(() => null, (e: ServerError) => e);
    expect((await err(postSubmission({ kind: 'rules', link }, form({ blurb: '有敏感词' }))))?.code).toBe('content-filter');
    expect((await err(postSubmission({ kind: 'rules', link }, form({ terms: 2 }))))?.code).toBe('terms-changed');
    await dev({ used: 3 });
    const full = await err(postSubmission({ kind: 'rules', link }, form()));
    expect(submitFail(full, false, 'rules')).toEqual({ kind: 'line', text: '今天已经投满 3 次了，明天再投' });
  });

  it('连不上服务器、太忙:第一句按种类说', () => {
    expect(submitFail(new ServerError(0, 'network', ''), false, 'preset')).toEqual({ kind: 'line', text: '连不上服务器，没投成。联网后再点一次「投稿」' });
    expect(submitFail(new ServerError(429, 'rate-limit', ''), false, 'rules')).toMatchObject({ kind: 'block', head: '没投成。' });
    expect(submitFail(new ServerError(503, 'busy', ''), false, 'map')).toMatchObject({ kind: 'block', head: '没投成，地图在本机没事。' });
    expect(notSubmitted('world')).toBe('没投成，世界在本机没事');
    expect(failWords({ kind: 'line', text: 'x' }, 'preset')).toMatchObject({ text: '没投成', more: 'x' });
  });

  it('停了投稿:站长封的说「原因：」;撤下作品时顺手停的是一整句,不加', () => {
    expect(failWords({ kind: 'notice', which: 'ban', ban: { level: 'submit', reason: 'privacy', reasonText: '投来的作品多次写了真人的隐私' } })).toMatchObject({ more: '原因：投来的作品多次写了真人的隐私' });
    const whole = '你投的作品因为写了真人的隐私被撤下了，账号同时停止投稿';
    expect(failWords({ kind: 'notice', which: 'ban', ban: { level: 'submit', reason: 'withdraw', reasonText: whole } })).toMatchObject({ more: whole });
  });

  it('一件作品的记号:同一套参数、同一套规则是同一件', () => {
    const a = workKey({ kind: 'preset', name: 'a', params: { ...DEFAULT_PARAMS, seed: 7 } });
    expect(workKey({ kind: 'preset', name: 'b', params: { ...DEFAULT_PARAMS, seed: 7 } })).toBe(a);
    expect(workKey({ kind: 'preset', name: 'a', params: { ...DEFAULT_PARAMS, seed: 8 } })).not.toBe(a);
    expect(workKey({ kind: 'map', worldId: 'w1', title: '' })).toBe('w1');
  });
});

describe('我的投稿', () => {
  const now = new Date(2026, 10, 7, 15, 0);
  const at = (m: number, d: number) => new Date(2026, m - 1, d, 10, 0).toISOString();
  const sub = (o: Partial<Submission>): Submission => ({ id: 1, kind: 'world', title: '塞雷尼亚', status: 'pending', createdAt: at(11, 7), ...o });

  it('五种状态的圆点、字、按钮;手机上不写种类', () => {
    expect(rowWords(sub({}), false, now)).toEqual({ st: 'wait', label: '等审', text: '世界，今天投的', acts: ['cancel'] });
    expect(rowWords(sub({ status: 'reviewing', createdAt: at(11, 5) }), false, now)).toEqual({ st: 'ing', label: '审核中', text: '世界，11 月 5 日投的', acts: ['cancel'] });
    expect(rowWords(sub({ kind: 'map', status: 'live', workId: 'm3np8rta', decidedAt: at(11, 3) }), false, now)).toEqual({ st: 'up', label: '已上墙', text: '地图，11 月 3 日上墙', acts: ['look', 'take'] });
    expect(rowWords(sub({ kind: 'preset', status: 'returned', reason: '写了真人的隐私：介绍里有 QQ 号，删掉就可以再投', decidedAt: at(11, 2) }), false, now)).toMatchObject({
      st: 'back',
      text: '11 月 2 日。写了真人的隐私：介绍里有 QQ 号，删掉就可以再投',
      acts: [],
    });
    expect(rowWords(sub({ kind: 'rules', status: 'withdrawn', reason: '作者自己撤下', updatedAt: at(10, 28) }), false, now)).toEqual({ st: 'off', label: '已撤下', text: '规则，10 月 28 日你自己撤下的', acts: [] });
    expect(rowWords(sub({ status: 'withdrawn', reason: '举报核实：侵权', updatedAt: at(11, 9) }), false, now).text).toBe('11 月 9 日撤下：被举报，核实是侵权');
    expect(rowWords(sub({ status: 'withdrawn', reason: '账号已停止投稿', updatedAt: at(11, 9) }), false, now).text).toBe('11 月 9 日撤下：账号已停止投稿');
    expect(rowWords(sub({ status: 'reviewing', createdAt: at(11, 5) }), true, now).text).toBe('11 月 5 日投的');
    expect(rowWords(sub({ status: 'disabled' }), false, now)).toMatchObject({ label: '处理中', acts: [] });
  });

  it('最多 20 件,等审、审核中的再早也列着;没收下的不列', () => {
    const list = [
      ...Array.from({ length: 25 }, (_, i) => sub({ id: 100 - i, status: 'returned' })),
      sub({ id: 3, status: 'pending' }),
      sub({ id: 2, status: 'failed' }),
      sub({ id: 1, status: 'reviewing' }),
    ];
    const shown = shownSubmissions(list);
    expect(shown).toHaveLength(20);
    expect(shown.map((s) => s.id).slice(-2)).toEqual([3, 1]);
    expect(shown.some((s) => s.status === 'failed')).toBe(false);
  });

  it('撤回:等审的去掉,次数不退;撤下:上墙的变成已撤下,作者自己撤下的', async () => {
    const link = rulesHash(RULES).replace(/^#/, '');
    const a = await postSubmission({ kind: 'rules', link }, form());
    await cancelSubmission(a.id);
    let list = await fetchSubmissions();
    expect(list.submissions).toEqual([]);
    expect(list.limits).toMatchObject({ usedToday: 1, pending: 0 });

    const b = await postSubmission({ kind: 'rules', link }, form());
    await dev({ decide: { id: b.id, status: 'live', workId: 'r6zh9qkw' } });
    expect((await cancelSubmission(b.id).then(() => null, (e: ServerError) => e))?.code).toBe('conflict');
    const got = await takedownSubmission(b.id);
    expect(got).toMatchObject({ status: 'withdrawn', reason: '作者自己撤下', workId: 'r6zh9qkw' });
    list = await fetchSubmissions();
    expect(rowWords(list.submissions[0], false).text).toBe('规则，今天你自己撤下的');
  });
});

/**
 * 投插件:开发假服务器收插件文件(新插件、新的一版要写改了什么、四种投不成、须知版本),投不成换成窗里的说法,我的投稿里插件一版一行。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeAiServer, FAKE_CODE } from '../scripts/lib/fakeAiServer';
import { PLUGIN_CAPS } from '../src/plugin/pluginCaps';
import { packPluginFile } from '../src/plugin/pluginFile';
import { ServerError, setServerForTest } from '../src/account/server';
import { _resetSessionForTest, fetchAuthOptions, login } from '../src/account/session';
import { fetchSubmissions, postSubmission, type Submission, type SubmitForm } from '../src/account/submissions';
import { TERMS_VERSION } from '../src/ui/submitTerms';
import { PLUGIN_TERMS, PLUGIN_TERMS_VERSION, addedLines, nextVersion, pluginWall } from '../src/ui/submitPlugin';
import { workKey } from '../src/ui/submitView';
import { failWords, submitFail } from '../src/ui/submitWords';
import { rowWords } from '../src/ui/MySubmissions';
import { goodInput } from './lib/pluginFileSample';

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
const form = (extra: Partial<SubmitForm> = {}): SubmitForm => ({ title: '量路程', by: '青石', blurb: '点两个点，按地形算要走几天', terms: TERMS_VERSION, ...extra });

async function pluginFile(o: { version?: string; license?: string; requires?: string[] } = {}): Promise<Uint8Array> {
  const input = goodInput();
  return packPluginFile({ ...input, manifest: { ...input.manifest, version: o.version ?? '1.0.0', license: o.license ?? 'MIT', ...(o.requires ? { requires: o.requires } : {}) } });
}
const send = async (o: { version?: string; license?: string; note?: string; pluginTerms?: number; by?: string } = {}) =>
  postSubmission({ kind: 'plugin', file: await pluginFile(o), ...(o.note ? { note: o.note } : {}), pluginTerms: o.pluginTerms ?? PLUGIN_TERMS_VERSION }, form(o.by ? { by: o.by } : {}));
const err = (p: Promise<unknown>) => p.then(() => null, (e: ServerError) => e);

beforeEach(async () => {
  fake = createFakeAiServer({ chunkDelayMs: 0, fullCheckMs: 0 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: RequestInit) => fake.handle(new Request(String(u), init))),
  );
  g.localStorage = new FakeStorage();
  _resetSessionForTest();
  setServerForTest(BASE);
  token = (await login('qingshi@example.com', FAKE_CODE)).session.token;
});

afterEach(() => {
  vi.unstubAllGlobals();
  setServerForTest(undefined);
  _resetSessionForTest();
  delete g.localStorage;
});

describe('投插件:假服务器', () => {
  it('服务器说收插件、插件须知第几版', async () => {
    expect((await fetchAuthOptions()).features).toMatchObject({ submitPlugin: true, pluginTerms: PLUGIN_TERMS_VERSION });
  });

  it('新插件进等审,名字照清单,我的投稿里带插件的编号、版本;和作品共用一天 3 次', async () => {
    expect(await send()).toMatchObject({ status: 'pending', plugin: { id: 'route-measure', version: '1.0.0' } });
    const list = await fetchSubmissions();
    expect(list.submissions[0]).toMatchObject({ kind: 'plugin', title: '量路程', by: '青石', status: 'pending', plugin: { id: 'route-measure', version: '1.0.0', name: '量路程' } });
    expect(list.limits).toMatchObject({ usedToday: 1, pending: 1 });
  });

  it('上一版还在等审:说是哪一份', async () => {
    const first = await send();
    const e = await err(send({ version: '1.1.0' }));
    expect(submitFail(e, false, 'plugin')).toEqual({ kind: 'plugin', which: 'waiting', waitingId: first.id });
  });

  it('上过墙的:版本号要更大、要写改了什么;新版署名跟第一次的,上墙后旧版换下、作品编号不变', async () => {
    const first = await send();
    await dev({ decide: { id: first.id, status: 'live', workId: 'k7qm2xpa' } });
    expect(submitFail(await err(send({ version: '1.0.0', note: '改了点字' })), false, 'plugin')).toMatchObject({ kind: 'line', text: '这一版已经审过了' });
    expect(submitFail(await err(send({ version: '0.9.0', note: '改了点字' })), false, 'plugin')).toEqual({ kind: 'plugin', which: 'version', version: '1.0.0' });
    expect(submitFail(await err(send({ version: '1.1.0' })), false, 'plugin')).toEqual({ kind: 'note' });
    const next = await send({ version: '1.1.0', note: '可以选步行还是骑马', by: '别的名字' });
    await dev({ decide: { id: next.id, status: 'live' } });
    const list = (await fetchSubmissions()).submissions;
    expect(list.find((s) => s.id === next.id)).toMatchObject({ by: '青石', status: 'live', workId: 'k7qm2xpa', plugin: { version: '1.1.0', note: '可以选步行还是骑马' } });
    expect(list.find((s) => s.id === first.id)).toMatchObject({ status: 'replaced' });
    expect(pluginWall(list, 'route-measure')).toMatchObject({ up: { id: next.id }, by: '青石', waiting: null });
  });

  it('编号是别的账号的、不是开源许可证、插件须知对不上', async () => {
    await dev({ pluginTaken: ['route-measure'] });
    expect(submitFail(await err(send()), false, 'plugin')).toEqual({ kind: 'plugin', which: 'taken' });
    await dev({ pluginTaken: [] });
    expect(submitFail(await err(send({ license: 'Proprietary' })), false, 'plugin')).toEqual({ kind: 'plugin', which: 'license' });
    expect(submitFail(await err(send({ pluginTerms: PLUGIN_TERMS_VERSION + 1 })), false, 'plugin')).toMatchObject({ kind: 'block', act: 'reload' });
  });

  it('碰到词:这一版改了什么那一栏标红', async () => {
    const first = await send();
    await dev({ decide: { id: first.id, status: 'live', workId: 'k7qm2xpa' } });
    expect(submitFail(await err(send({ version: '1.1.0', note: '有敏感词' })), false, 'plugin')).toMatchObject({ kind: 'hits', fields: ['note'] });
  });
});

describe('投插件:网页这头的字', () => {
  const now = new Date(2026, 10, 8, 15, 0);
  const at = (m: number, d: number) => new Date(2026, m - 1, d, 10, 0).toISOString();
  const sub = (o: Partial<Submission>): Submission => ({ id: 1, kind: 'plugin', title: '量路程', status: 'pending', createdAt: at(11, 8), plugin: { id: 'route-days', version: '1.3.0', name: '量路程' }, ...o });

  it('插件投稿须知第 1 版六条;四种投不成的提示条', () => {
    expect(PLUGIN_TERMS_VERSION).toBe(1);
    expect(PLUGIN_TERMS).toHaveLength(6);
    expect(failWords({ kind: 'plugin', which: 'taken' }, 'plugin')).toMatchObject({ text: '没投成', more: '这个编号是别的账号的' });
    expect(failWords({ kind: 'note' }, 'plugin')).toMatchObject({ more: '投新版要写「这一版改了什么」' });
  });

  it('我的投稿:一版一行,写第几版;换下、停用、退回', () => {
    expect(rowWords(sub({}), false, now)).toEqual({ st: 'wait', label: '等审', text: '插件第 1.3 版，今天投的', acts: ['cancel'] });
    expect(rowWords(sub({}), true, now).text).toBe('第 1.3 版，今天投的');
    expect(rowWords(sub({ status: 'live', workId: 'k7qm2xpa', decidedAt: at(11, 2), plugin: { id: 'route-days', version: '1.2.0', name: '量路程' } }), false, now)).toEqual({
      st: 'up',
      label: '已上墙',
      text: '插件第 1.2 版，11 月 2 日上墙',
      acts: ['look', 'take'],
    });
    expect(rowWords(sub({ status: 'returned', decidedAt: at(11, 7), reason: '要的权限比用到的多', plugin: { id: 'dynasty', version: '1.0.0', name: '朝代年表' } }), false, now).text).toBe('插件第 1.0 版，11 月 7 日。要的权限比用到的多');
    expect(rowWords(sub({ status: 'replaced', updatedAt: at(11, 8) }), false, now)).toEqual({ st: 'off', label: '已换下', text: '插件第 1.3 版，今天换成新版', acts: [] });
    expect(rowWords(sub({ status: 'disabled', updatedAt: at(11, 6), reason: '有违法违规、色情低俗的内容' }), false, now)).toEqual({ st: 'off', label: '停用了', text: '插件第 1.3 版，11 月 6 日停用：有违法违规、色情低俗的内容', acts: [] });
  });

  it('认出上过墙的那一版、署名跟第一次;新版多要了哪几行;该改成多少', () => {
    const list = [
      sub({ id: 3, status: 'pending', createdAt: at(11, 8), by: '青石' }),
      sub({ id: 2, status: 'live', createdAt: at(11, 1), by: '青石', plugin: { id: 'route-days', version: '1.2.0', name: '量路程' } }),
      sub({ id: 1, status: 'replaced', createdAt: at(10, 25), by: '石头', plugin: { id: 'route-days', version: '1.1.0', name: '量路程' } }),
      sub({ id: 4, status: 'live', by: '别人', plugin: { id: 'other', version: '9.0.0', name: '别的' } }),
    ];
    expect(pluginWall(list, 'route-days')).toMatchObject({ up: { id: 2 }, by: '石头', waiting: { id: 3 } });
    expect(pluginWall(list, 'nothing')).toEqual({ up: null, by: null, waiting: null });
    const capLines = Object.fromEntries(PLUGIN_CAPS);
    expect(addedLines({ lines: ['map', 'history', 'view', 'layer'], capLines }, ['world.read@1', 'input.pick@1', 'layer.marks@1'])).toEqual(['history']);
    expect(nextVersion('1.3.0')).toBe('1.4');
    expect(workKey({ kind: 'plugin', plugin: { id: 'route-days', sum: 'abc' } as never })).toBe('plugin:route-days:abc');
  });
});

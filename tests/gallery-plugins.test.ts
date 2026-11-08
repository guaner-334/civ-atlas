/**
 * 作品墙上的插件:服务器给的 plugin 怎么整理、卡片上的小标签、有没有新版、停用名单(取、存、按编号或指纹停)、
 * 开发用假服务器上的插件(列表、下载、新版上墙、停用以后撤下、举报理由)。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanGallery } from '../src/account/gallery';
import { setServerForTest } from '../src/account/server';
import { openPluginFile } from '../src/plugin/pluginFile';
import { capChips, compareVersions, latestOf, newerOnWall, wallPlugin, wallPlugins } from '../src/ui/plugins/galleryPlugin';
import { noteText, wallInstalledText } from '../src/ui/plugins/pluginText';
import { _resetVerdicts, blockKey, markReviewed, refreshVerdicts, verdictOf } from '../src/ui/plugins/verdict';
import { createFakeAiServer } from '../scripts/lib/fakeAiServer';

const SUM = (c: string) => c.repeat(64);
const g = globalThis as { localStorage?: unknown };

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

const plugin = (o: Record<string, unknown> = {}) => ({
  id: 'route-days',
  name: '量路程',
  version: '1.2.0',
  sum: SUM('a'),
  bytes: 14000,
  role: 'tool',
  api: 1,
  requires: ['world.read@1', 'input.pick@1', 'ui.panel@1', 'layer.marks@1'],
  license: 'MIT',
  icon: false,
  updatedAt: '2026-11-02T03:00:00.000Z',
  note: '量完一条接着点下一条',
  versions: [
    { version: '1.2.0', sum: SUM('a'), at: '2026-11-02T03:00:00.000Z', note: '量完一条接着点下一条' },
    { version: '1.1.0', sum: SUM('b'), at: '2026-10-28T03:00:00.000Z', note: '可以选步行还是骑马' },
  ],
  shots: [7, 2024],
  ...o,
});
const work = (id: string, p: unknown, addedAt = '2026-10-25T03:00:00.000Z') => ({ id, kind: 'plugin', title: '量路程', by: '青石', blurb: '一句话', version: null, addedAt, plugin: p });

describe('作品墙列表里的插件', () => {
  it('插件单独放着,不混进全部作品、精选和挑战', () => {
    const list = cleanGallery({
      month: '2026-11',
      featured: [{ id: 'q8xr3mvd', note: '插件不进精选' }],
      challenges: [{ id: 1, title: '挑战', blurb: '', deadline: '2026-12-08', works: ['q8xr3mvd', 'k7qm2xpa'] }],
      works: [{ id: 'k7qm2xpa', kind: 'world', title: '世界', by: '砚山', blurb: '', version: 30, addedAt: '2026-10-20T11:05:00.000Z' }, work('q8xr3mvd', plugin())],
    });
    expect(list.works.map((w) => w.id)).toEqual(['k7qm2xpa']);
    expect(list.plugins.map((w) => w.id)).toEqual(['q8xr3mvd']);
    expect(list.featured).toEqual([]);
    expect(list.challenges[0].works).toEqual(['k7qm2xpa']);
  });

  it('整理 plugin:不像样的(没编号、版本、指纹)不要,版本记录里不像样的那一版去掉', () => {
    const p = wallPlugin(plugin({ versions: [{ version: '1.2.0', sum: SUM('a'), at: 'x', note: 'n' }, { version: 'abc', sum: SUM('c') }], why: { 'world.read@1': '找路', bad: 3 }, author: { name: '青石' } }))!;
    expect(p.versions.map((v) => v.version)).toEqual(['1.2.0']);
    expect(p.shots).toEqual([7, 2024]);
    expect(p.why).toEqual({ 'world.read@1': '找路' });
    expect(p.author).toBe('青石');
    expect(wallPlugin(plugin({ version: '1.2' }))).toBeNull();
    expect(wallPlugin(plugin({ sum: 'abc' }))).toBeNull();
    expect(wallPlugin(null)).toBeNull();
  });

  it('按最近一次上墙排:新版审过的排到前面', () => {
    const old = { ...work('h5ct7nbe', plugin({ id: 'coast', updatedAt: '2026-10-30T00:00:00.000Z' }), '2026-10-30T00:00:00.000Z') };
    const updated = work('q8xr3mvd', plugin({ updatedAt: '2026-11-08T00:00:00.000Z' }), '2026-10-01T00:00:00.000Z');
    const list = cleanGallery({ works: [old, updated] });
    expect(wallPlugins(list.plugins).map((x) => x.w.id)).toEqual(['q8xr3mvd', 'h5ct7nbe']);
  });

  it('卡片上的小标签:同一行的能力合成一个,看 / 改你写的东西标黄', () => {
    expect(capChips({ requires: ['world.read@1', 'input.pick@1', 'view.read@1', 'ui.panel@1', 'layer.marks@1'], optional: [] })).toEqual([
      { key: 'map', text: '看地图', loud: false },
      { key: 'view', text: '看你点了哪', loud: false },
      { key: 'layer', text: '加图层', loud: false },
    ]);
    expect(capChips({ requires: ['history.read@1', 'author.read@1', 'author.write@1'], optional: [] }).map((c) => [c.text, c.loud])).toEqual([
      ['看历史', false],
      ['看你写的', true],
      ['改你写的', true],
    ]);
  });
});

describe('有没有新版', () => {
  const latest = latestOf(cleanGallery({ works: [work('q8xr3mvd', plugin({ version: '1.3.0', sum: SUM('d'), note: '新', versions: [{ version: '1.3.0', sum: SUM('d'), at: '', note: '新' }, { version: '1.2.0', sum: SUM('a'), at: '', note: '' }] }))] }).plugins)['route-days'];
  const mine = (o: { sum?: string; version?: string; work?: string }) => ({ id: 'route-days', current: { sum: o.sum ?? SUM('a'), manifest: { version: o.version ?? '1.2.0' }, ...(o.work ? { work: o.work } : {}) } });
  const never = () => false;

  it('版本号比大小', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
    expect(compareVersions('1.2.0', '1.2.0')).toBe(0);
    expect(compareVersions('0.9.1', '1.0.0')).toBe(-1);
  });

  it('从作品墙装的、和作品墙上某一版一个字不差的、审过的才查', () => {
    expect(latest).toMatchObject({ work: 'q8xr3mvd', version: '1.3.0', note: '新' });
    expect(newerOnWall(mine({ work: 'q8xr3mvd', sum: SUM('e') }), latest, never)?.version).toBe('1.3.0');
    expect(newerOnWall(mine({}), latest, never)?.version).toBe('1.3.0');
    expect(newerOnWall(mine({ sum: SUM('f') }), latest, (s) => s === SUM('f'))?.version).toBe('1.3.0');
    // 自己从文件装的、作品墙上没有的不问
    expect(newerOnWall(mine({ sum: SUM('f') }), latest, never)).toBeNull();
  });

  it('装的就是这一版、比作品墙上的还新:没有新版', () => {
    expect(newerOnWall(mine({ sum: SUM('d'), version: '1.3.0' }), latest, never)).toBeNull();
    expect(newerOnWall(mine({ work: 'q8xr3mvd', sum: SUM('e'), version: '1.4.0' }), latest, never)).toBeNull();
    expect(newerOnWall(mine({}), undefined, never)).toBeNull();
  });

  it('提示条、更新框的几句话', () => {
    const tool = { name: '量路程', requires: ['world.read@1', 'ui.panel@1'] } as never;
    const layer = { name: '离海多远', requires: ['world.read@1', 'layer.cells@1'] } as never;
    expect(wallInstalledText(tool, false)).toBe('打开一个世界，地图右下的「工具」里就有它。装在这个浏览器里，所有世界都能用。');
    expect(wallInstalledText(layer, false)).toBe('打开一个世界，图层面板的「插件图层」里就有它。装在这个浏览器里，所有世界都能用。');
    expect(noteText('沿途经过哪几国也列出来')).toBe('沿途经过哪几国也列出来。');
    expect(noteText('改好了！')).toBe('改好了！');
  });
});

describe('停用名单', () => {
  let served: unknown;
  let calls: number;
  beforeEach(() => {
    calls = 0;
    served = { reviewed: [{ sum: SUM('a'), id: 'route-days', version: '1.2.0' }], blocked: [{ id: 'bad', why: '会偷看或者乱改你的东西', at: '2026-11-06T03:00:00.000Z' }, { sum: SUM('c'), why: '不适合再用', at: '2026-11-07T03:00:00.000Z' }], maxAge: 86400 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        calls++;
        return new Response(JSON.stringify(served), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }),
    );
    g.localStorage = new FakeStorage();
    setServerForTest('http://fake-server.test');
    _resetVerdicts();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setServerForTest(undefined);
    _resetVerdicts();
    delete g.localStorage;
  });

  it('没取到之前:都是没审核、没停用', () => {
    expect(verdictOf(SUM('a'), 'route-days')).toEqual({ reviewed: false, blocked: null });
  });

  it('按编号停这个插件所有版本,按指纹只停那一份;审过的按指纹认', async () => {
    expect(await refreshVerdicts()).toBe(true);
    expect(verdictOf(SUM('a'), 'route-days')).toEqual({ reviewed: true, blocked: null });
    expect(verdictOf(SUM('e'), 'bad').blocked?.why).toBe('会偷看或者乱改你的东西');
    expect(verdictOf(SUM('c'), 'other').blocked?.why).toBe('不适合再用');
    expect(verdictOf(SUM('e'), 'other').blocked).toBeNull();
    expect(blockKey(SUM('e'), 'bad')).toBe('bad@2026-11-06T03:00:00.000Z');
    expect(blockKey(SUM('a'), 'route-days')).toBeNull();
  });

  it('存在这个浏览器里,一天之内不再取', async () => {
    await refreshVerdicts();
    expect(await refreshVerdicts()).toBe(false);
    expect(calls).toBe(1);
    expect(JSON.parse((g.localStorage as FakeStorage).getItem('civ-atlas:plugin-verdicts')!)).toMatchObject({ maxAge: 86400 });
    expect(await refreshVerdicts(true)).toBe(true);
    expect(calls).toBe(2);
  });

  it('从作品墙装的先记成审过,名单取到以后照名单', async () => {
    markReviewed(SUM('d'), 'route-days');
    expect(verdictOf(SUM('d'), 'route-days').reviewed).toBe(true);
    expect(await refreshVerdicts()).toBe(true);
    expect(verdictOf(SUM('d'), 'route-days').reviewed).toBe(false);
    expect(verdictOf(SUM('a'), 'route-days').reviewed).toBe(true);
  });

  it('取到了照 maxAge 再取,取不到才隔十分钟再试', async () => {
    served = { ...(served as object), maxAge: 60 };
    const t0 = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(t0);
    await refreshVerdicts();
    now.mockReturnValue(t0 + 61_000);
    expect(await refreshVerdicts()).toBe(true);
    expect(calls).toBe(2);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    now.mockReturnValue(t0 + 122_000);
    expect(await refreshVerdicts()).toBe(false);
    now.mockReturnValue(t0 + 183_000);
    expect(await refreshVerdicts()).toBe(false);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it('取不到照用上次的', async () => {
    await refreshVerdicts();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    expect(await refreshVerdicts(true)).toBe(false);
    expect(verdictOf(SUM('e'), 'bad').blocked).not.toBeNull();
  });
});

describe('开发用假服务器上的插件', () => {
  const fake = createFakeAiServer({ chunkDelayMs: 0, fullCheckMs: 0 });
  const call = (path: string, init?: RequestInit) => fake.handle(new Request(`http://fake${path}`, init));
  const post = (path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });

  it('列表里的插件带版本记录、试跑的种子,下载的文件就是那一份', async () => {
    const list = cleanGallery(await (await call('/v1/gallery')).json());
    const ps = wallPlugins(list.plugins);
    expect(ps.map((x) => x.p.id).sort()).toEqual(['box-summary', 'coast-distance', 'route-days']);
    const route = ps.find((x) => x.p.id === 'route-days')!;
    expect(route.p).toMatchObject({ version: '1.2.0', shots: [7, 2024], note: '量完一条接着点下一条，不用再点「开始量」' });
    expect(route.p.versions.map((v) => v.version)).toEqual(['1.2.0', '1.1.0', '1.0.0']);
    const file = await call(`/v1/gallery/${route.w.id}/plugin`);
    const opened = await openPluginFile(new Uint8Array(await file.arrayBuffer()));
    expect(opened.sum).toBe(route.p.sum);
    expect(opened.manifest.version).toBe('1.2.0');
    expect((await call(`/v1/gallery/${route.w.id}/cover?seed=2024`)).status).toBe(200);
    const detail = wallPlugin((await (await call(`/v1/gallery/${route.w.id}`)).json()).plugin)!;
    expect(detail.why?.['world.read@1']).toBeTruthy();
  });

  it('新版审过上墙、停用名单、停用以后旧链接说是插件停用了', async () => {
    await post('/v1/dev/plugins', { publish: 'route-days' });
    const route = wallPlugins(cleanGallery(await (await call('/v1/gallery')).json()).plugins).find((x) => x.p.id === 'route-days')!;
    expect(route.p).toMatchObject({ version: '1.3.0', optional: ['history.read@1'] });
    const verdicts = await (await call('/v1/plugins/verdicts')).json();
    expect(verdicts.reviewed.some((r: { sum: string }) => r.sum === route.p.sum)).toBe(true);
    await post('/v1/dev/plugins', { block: { id: 'coast-distance', why: '有违法违规、色情低俗的内容' } });
    expect((await (await call('/v1/plugins/verdicts')).json()).blocked).toEqual([expect.objectContaining({ id: 'coast-distance', why: '有违法违规、色情低俗的内容' })]);
    const gone = await call('/v1/gallery/h5ct7nbe');
    expect(gone.status).toBe(410);
    expect((await gone.json()).error).toMatchObject({ kind: 'plugin', blocked: '有违法违规、色情低俗的内容' });
    await post('/v1/dev/plugins', { unblock: true });
    expect((await call('/v1/gallery/h5ct7nbe')).status).toBe(200);
  });

  it('举报插件认插件那一组理由', async () => {
    const report = (reason: string) => post('/v1/gallery/q8xr3mvd/report', { reason });
    expect((await report('mismatch')).status).toBe(204);
    expect((await report('privacy')).status).toBe(400);
  });
});

/**
 * 作品墙(account/gallery.ts、存档里的出处):没开作品墙什么都不出现、撤下的作品、同一台设备只举报一次、
 * 拿来用的世界和作品的存档一样、出处写的是作品。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setServerForTest } from '../src/account/server';
import { fetchWork, getGallery, isWorkGone, loadGallery, reportWork, resetGalleryForTest, wasReported, workLink, type GalleryItem } from '../src/account/gallery';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { EMPTY_EDITS, type WorldEdits } from '../src/gen/edits';
import { cleanOrigin, makeSave, parseSave, saveText, worldKey, type SaveOrigin } from '../src/gen/savefile';
import * as saveStore from '../src/ui/saveStore';
import { clearEdits, setEdits, setName } from '../src/ui/editsStore';

const BASE = 'http://fake-server.test';
const g = globalThis as { localStorage?: unknown; location?: unknown };

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

/** 浏览器不让存(隐私模式):一读写就出错 */
const BLOCKED = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('SecurityError');
  },
  removeItem() {
    throw new Error('SecurityError');
  },
};

type Route = (req: Request) => Response | Promise<Response>;
let route: Route;
let calls: Request[];

const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const err = (status: number, code: string, extra: Record<string, unknown> = {}) => json(status, { ...extra, error: { code, message: 'x' } });

const LIST = {
  month: '2026-10',
  featured: [{ id: 'k7qm2xpa', note: '推荐语' }, { id: 'zzzzzzzz', note: '不在列表里的不要' }],
  challenges: [{ id: 3, title: '一个王朝三百年', blurb: '说明', deadline: '2026-11-30', works: ['k7qm2xpa', 'bad'] }],
  works: [
    { id: 'k7qm2xpa', kind: 'world', title: '金阳洋两岸', by: '砚山', blurb: '一句话', version: 30, addedAt: '2026-10-20T11:05:00.000Z' },
    { id: 'm3np8rta', kind: 'preset', title: '两块完整大陆', by: '砚山', blurb: '', version: null, addedAt: '2026-10-19T11:05:00.000Z' },
    { id: 'NOT-AN-ID', kind: 'world', title: '编号不对的不要' },
    { id: 'q2w3e4r5', kind: 'game', title: '种类不认识的不要' },
  ],
};

/** 等 loadGallery 发出去的请求回来 */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  calls = [];
  route = () => json(200, LIST);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (u: string, init?: RequestInit) => {
      const req = new Request(String(u), init);
      calls.push(req);
      return route(req);
    }),
  );
  g.localStorage = new FakeStorage();
  setServerForTest(BASE);
  resetGalleryForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setServerForTest(undefined);
  resetGalleryForTest();
  delete g.localStorage;
});

describe('作品墙的列表', () => {
  it('取到了:整理过的列表(认不出的作品去掉;精选、挑战里只留列表里有的)', async () => {
    loadGallery();
    expect(getGallery().status).toBe('loading');
    await settle();
    const s = getGallery();
    expect(s.status).toBe('ok');
    expect(s.list?.works.map((w) => w.id)).toEqual(['k7qm2xpa', 'm3np8rta']);
    expect(s.list?.featured).toEqual([{ id: 'k7qm2xpa', note: '推荐语' }]);
    expect(s.list?.challenges[0].works).toEqual(['k7qm2xpa']);
    expect(s.list?.month).toBe('2026-10');
    expect(new URL(calls[0].url).pathname).toBe('/v1/gallery');
  });

  it('服务器没开作品墙(404)、网站没配服务器:off,没有列表 —— 入口、空页面的精选、作品墙那一页都不出现', async () => {
    route = () => err(404, 'not-found');
    loadGallery();
    await settle();
    expect(getGallery()).toMatchObject({ status: 'off', list: null });
    // 刚问过:不再问
    loadGallery();
    expect(calls.length).toBe(1);

    resetGalleryForTest();
    setServerForTest(null);
    loadGallery(true);
    expect(getGallery()).toMatchObject({ status: 'off', list: null });
    expect(calls.length).toBe(1);
  });

  it('取不到(服务器出错、断网):error;取到过的列表留着', async () => {
    loadGallery();
    await settle();
    route = () => err(500, 'server');
    loadGallery(true);
    await settle();
    expect(getGallery().status).toBe('error');
    expect(getGallery().list?.works.length).toBe(2);
    resetGalleryForTest();
    route = () => {
      throw new TypeError('Failed to fetch');
    };
    loadGallery(true);
    await settle();
    expect(getGallery()).toMatchObject({ status: 'error', list: null });
  });
});

describe('打开一个作品', () => {
  const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, EMPTY_EDITS, 'c7', '金阳洋两岸');

  it('世界作品带着存档;新建参数作品带着预设串', async () => {
    route = (req) =>
      new URL(req.url).pathname.endsWith('/m3np8rta') ? json(200, { ...LIST.works[1], preset: 'preset=1&name=x' }) : json(200, { ...LIST.works[0], save });
    const w = await fetchWork('k7qm2xpa');
    expect(w.kind).toBe('world');
    expect(w.save).toEqual(save);
    expect((await fetchWork('m3np8rta')).preset).toBe('preset=1&name=x');
  });

  it('撤下了(410)、没有这个编号(404):都算"已经撤下";别的错不算', async () => {
    route = () => err(410, 'gallery-gone', { withdrawn: true });
    const gone = await fetchWork('k7qm2xpa').catch((e: unknown) => e);
    expect(isWorkGone(gone)).toBe(true);
    route = () => err(404, 'not-found');
    expect(isWorkGone(await fetchWork('k7qm2xpa').catch((e: unknown) => e))).toBe(true);
    route = () => err(500, 'server');
    expect(isWorkGone(await fetchWork('k7qm2xpa').catch((e: unknown) => e))).toBe(false);
    // 回来的不是这个作品、世界作品没带存档:看不懂
    route = () => json(200, { ...LIST.works[0] });
    expect(isWorkGone(await fetchWork('k7qm2xpa').catch((e: unknown) => e))).toBe(false);
    await expect(fetchWork('k7qm2xpa')).rejects.toThrow('看不懂');
  });
});

describe('举报', () => {
  const reports = () => calls.filter((r) => r.method === 'POST');

  it('同一台设备对同一个作品只发一次;刷新以后还记得;别的作品照常能举报', async () => {
    route = () => new Response(null, { status: 204 });
    expect(wasReported('k7qm2xpa')).toBe(false);
    await reportWork('k7qm2xpa', 'privacy');
    expect(wasReported('k7qm2xpa')).toBe(true);
    expect(reports().length).toBe(1);
    expect(new URL(reports()[0].url).pathname).toBe('/v1/gallery/k7qm2xpa/report');
    expect(await reports()[0].json()).toEqual({ reason: 'privacy' });
    await reportWork('k7qm2xpa', 'other');
    expect(reports().length).toBe(1);
    // 刷新(这一页里记的清掉,浏览器里的还在)
    resetGalleryForTest();
    expect(wasReported('k7qm2xpa')).toBe(true);
    await reportWork('m3np8rta', 'abuse');
    expect(reports().length).toBe(2);
  });

  it('太频繁(429)、作品撤下了:不算举报过,能再点', async () => {
    route = () => err(429, 'rate-limit');
    await expect(reportWork('k7qm2xpa', 'porn')).rejects.toMatchObject({ code: 'rate-limit' });
    expect(wasReported('k7qm2xpa')).toBe(false);
    route = () => err(410, 'gallery-gone');
    expect(isWorkGone(await reportWork('k7qm2xpa', 'porn').catch((e: unknown) => e))).toBe(true);
    expect(wasReported('k7qm2xpa')).toBe(false);
  });

  it('浏览器不让存:这一页里照样记着,不再发', async () => {
    g.localStorage = BLOCKED;
    route = () => new Response(null, { status: 204 });
    await reportWork('k7qm2xpa', 'illegal');
    expect(wasReported('k7qm2xpa')).toBe(true);
    await reportWork('k7qm2xpa', 'illegal');
    expect(reports().length).toBe(1);
  });
});

describe('拿来用:出处、存档', () => {
  const EDITS: WorldEdits = { ...EMPTY_EDITS, names: { 'polity:c1#0': '有龙皇朝' }, interventions: [], endYear: 3500 };
  let stopAuto: (() => void) | null = null;

  beforeEach(() => {
    g.location = { origin: 'https://atlas.example.com', pathname: '/' };
    saveStore._resetForTest();
    clearEdits();
    stopAuto = saveStore.startAutoSave();
  });
  afterEach(() => {
    stopAuto?.();
    stopAuto = null;
    saveStore._resetForTest();
    clearEdits();
    delete g.location;
  });

  it('作品的地址、出处:往返不变;地址和作品编号对不上的不要', () => {
    expect(workLink('k7qm2xpa')).toBe('https://atlas.example.com/?gallery=k7qm2xpa');
    const origin: SaveOrigin = { by: '砚山', title: '金阳洋两岸', url: workLink('k7qm2xpa'), gallery: 'k7qm2xpa' };
    expect(cleanOrigin(origin)).toEqual(origin);
    const save = makeSave({ ...DEFAULT_PARAMS, seed: 7 }, EDITS, 'c7', '金阳洋两岸', undefined, null, origin);
    const r = parseSave(saveText(save));
    expect(r.ok && r.save.origin).toEqual(origin);
    expect(cleanOrigin({ ...origin, url: 'https://atlas.example.com/?gallery=m3np8rta' })).toBeNull();
    expect(cleanOrigin({ ...origin, url: 'javascript:alert(1)//?gallery=k7qm2xpa' })).toBeNull();
    expect(cleanOrigin({ ...origin, gallery: 'NOT-AN-ID' })).toBeNull();
    // 分享短链接来的照旧
    expect(cleanOrigin({ title: 't', url: 'https://atlas.example.com/s/k7Qm2xPa' })).toEqual({ title: 't', url: 'https://atlas.example.com/s/k7Qm2xPa' });
  });

  it('世界作品另存一份 / 改了自动另存:参数、修改和作品的存档一模一样,出处写作品', async () => {
    g.localStorage = new FakeStorage();
    saveStore._resetForTest();
    const orig = makeSave({ ...DEFAULT_PARAMS, seed: 7, landFraction: 0.4 }, EDITS, 'c7', '金阳洋两岸');
    route = () => json(200, { ...LIST.works[0], save: JSON.parse(saveText(orig)) });
    const it: GalleryItem = await fetchWork('k7qm2xpa');
    // App 打开世界作品:和打开分享链接一样读档,只是看看(visit)
    const p = parseSave(JSON.stringify(it.save));
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const origin: SaveOrigin = { by: it.by, title: it.title, url: workLink(it.id), gallery: it.id };
    const id = saveStore.newWorldId();
    setEdits(p.save.edits);
    saveStore.attachWorld({ id, params: p.save.params, check: p.save.check, kind: 'visit', title: it.title, saved: p.save.edits, origin });
    expect(saveStore.loadWorld(id)).toBeNull();
    // 「另存一份接着改」
    saveStore.keepWorld(id);
    const kept = saveStore.loadWorld(id)!.save;
    expect(worldKey(kept.params)).toBe(worldKey(orig.params));
    expect(JSON.stringify(kept.edits)).toBe(JSON.stringify(orig.edits));
    expect(kept.title).toBe(orig.title);
    expect(kept.check).toBe(orig.check);
    expect(kept.origin).toEqual(origin);
    // 存档除了出处、存的时间、看法(投影、经纬网这些),和作品的那份逐字一样
    const strip = (s: typeof orig) => saveText({ ...s, origin: undefined, savedAt: undefined, view: undefined } as unknown as typeof orig);
    expect(strip(kept)).toBe(strip(orig));
    // 接着改:出处还在
    setName('polity:c1#0', '大定');
    expect(saveStore.loadWorld(id)?.save.origin).toEqual(origin);
  });

  it('新建参数作品「用这套参数新建」:新建中的世界带着作品的出处,「保存地图」存下的那份也带着;别的新建照旧没有出处', () => {
    g.localStorage = new FakeStorage();
    saveStore._resetForTest();
    const origin: SaveOrigin = { by: '砚山', title: '两块完整大陆', url: workLink('pkd2k3m4'), gallery: 'pkd2k3m4' };
    const params = { ...DEFAULT_PARAMS, seed: 5730, landFraction: 0.4, continents: 2 };
    setEdits(EMPTY_EDITS);
    saveStore.attachWorld({ id: 'wgallery001', params, check: 'c5730', kind: 'draft', saved: EMPTY_EDITS, origin });
    expect(saveStore.currentWorld()?.origin).toEqual(origin);
    expect(saveStore.saveCurrentAsMap()).toBe(true);
    expect(saveStore.loadWorld('wgallery001')?.save.origin).toEqual(origin);
    // 分享链接的出处不跟着新建(只有在那个世界的地图上打造文明时才跟着)
    const share: SaveOrigin = { title: '苍澜界', url: 'https://example.com/s/k7Qm2xPa' };
    setEdits(EMPTY_EDITS);
    saveStore.attachWorld({ id: 'wgallery002', params, check: 'c5730', kind: 'draft', saved: EMPTY_EDITS, origin: share });
    expect(saveStore.currentWorld()?.origin).toBeUndefined();
  });
});

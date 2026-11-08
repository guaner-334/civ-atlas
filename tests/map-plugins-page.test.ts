/**
 * 页面里这个世界用的地图插件(world/mapNow.ts):打开的世界和本机核对(同一版带字节;没装、只有别的版本、被网站停用的只带编号和指纹),
 * 新建中选上的取现在那一版(停用的、不是地图插件的选不上);长地图的请求哪一步都带着;用了地图插件的世界不给配方链接
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldPlugin } from '../src/gen/worldFormat';
import type { InstalledPlugin } from '../src/plugin/pluginStore';

const blocked = new Set<string>();
let installed: InstalledPlugin[] = [];
let manifest: { plugins: WorldPlugin[]; parts: [] } | null = null;
vi.mock('../src/plugin/pluginStore', () => ({
  listPlugins: async () => installed,
  pluginFileBytes: async (sum: string) => (installed.some((p) => p.current.sum === sum || p.previous?.sum === sum) ? new Uint8Array([1, 2, 3]) : null),
  PluginStoreError: class extends Error {},
}));
vi.mock('../src/ui/plugins/verdict', () => ({
  verdictOf: (sum: string, id?: string) => ({ reviewed: false, blocked: blocked.has(sum) || (id !== undefined && blocked.has(id)) ? { why: '会把整片大陆沉进海里', day: '11 月 8 日' } : null }),
  subscribeVerdicts: () => () => {},
}));
vi.mock('../src/ui/worldStore', () => ({ vaultCall: async () => manifest, settleWorld: async () => null }));
const cur = { id: '', kind: 'created' };
vi.mock('../src/ui/saveStore', () => ({ currentWorld: () => (cur.id ? { ...cur } : null), keepWorld: () => {}, notify: () => {}, saveAsNewVersion: () => null, storageFullWhy: () => '' }));

const { chooseMaps, chosenMaps, loadMapNow, refreshMapNow } = await import('../src/ui/plugins/mapWorld');
const { getMapNow, mapFilesOf, mapNowFor, setMapNow, usesMaps } = await import('../src/ui/world/mapNow');
const { sameSetup, setupFor, setupOpt } = await import('../src/ui/world/worldTarget');

const record = (id: string, name: string, sum: string, params?: Record<string, number>): WorldPlugin => ({ id, version: '1.0.0', sum, role: 'map', name, ...(params ? { params } : {}) });
const have = (id: string, name: string, sum: string, role = 'map'): InstalledPlugin =>
  ({
    id,
    on: true,
    from: 'file',
    at: 0,
    current: { sum, bytes: 3, at: 0, manifest: { id, name, version: '1.0.0', role, map: { stages: ['height'], params: { count: { label: '坑数', min: 0, max: 200, default: 40 } } } } },
  }) as unknown as InstalledPlugin;

const craters = record('craters', '环形山', 'a'.repeat(64), { count: 30 });
const tides = record('tides', '潮汐', 'b'.repeat(64));
const magic: WorldPlugin = { id: 'magic', version: '1.0.0', sum: 'c'.repeat(64), role: 'sim' };

beforeEach(() => {
  blocked.clear();
  installed = [];
  manifest = null;
  cur.id = 'w1';
  setMapNow(null);
});

describe('打开的世界:和本机核对', () => {
  it('都装着同一版:带字节,长地图的请求哪一步都带着(新建中的也带)', async () => {
    installed = [have('craters', '环形山', craters.sum), have('tides', '潮汐', tides.sum)];
    manifest = { plugins: [craters, magic, tides], parts: [] };
    await loadMapNow('w1');
    const s = getMapNow()!;
    expect(s).toMatchObject({ id: 'w1', ready: true, stored: true, checks: [] });
    expect(s.list).toEqual([craters, tides]);
    expect(s.files.map((f) => [f.id, f.sum, f.params, !!f.bytes])).toEqual([
      ['craters', craters.sum, { count: 30 }, true],
      ['tides', tides.sum, undefined, true],
    ]);
    expect(mapFilesOf('w1')).toBe(s.files);
    expect(setupOpt(setupFor(false, {})).mapPlugins).toBe(s.files);
    expect(setupOpt(setupFor(true, {})).mapPlugins).toBe(s.files);
    // 带没带字节不算不一样(只换带的字节,地图不重长)
    expect(sameSetup({ mapPlugins: s.files }, { mapPlugins: s.files.map(({ bytes: _b, ...x }) => x) })).toBe(true);
    expect(sameSetup({ mapPlugins: s.files }, undefined)).toBe(false);
  });

  it('没装、只有别的版本:请求只带编号和指纹,核对结果交出去;打包、转存不替它算', async () => {
    installed = [have('craters', '环形山', 'd'.repeat(64))];
    manifest = { plugins: [craters, tides], parts: [] };
    await loadMapNow('w1');
    const s = getMapNow()!;
    expect(s.ready).toBe(false);
    expect(s.files.every((f) => !f.bytes)).toBe(true);
    expect(s.files.map((f) => [f.id, f.sum, f.params])).toEqual([
      ['craters', craters.sum, { count: 30 }],
      ['tides', tides.sum, undefined],
    ]);
    expect(s.checks.map((c) => [c.id, c.status])).toEqual([
      ['craters', 'other'],
      ['tides', 'missing'],
    ]);
    expect(mapFilesOf('w1')).toBeNull();
    expect(setupOpt(setupFor(false, {})).mapPlugins).toBe(s.files);
  });

  it('被网站停用了:不跑(只带编号和指纹),核对结果说停用了;又不停用了,重新核对就带上', async () => {
    installed = [have('craters', '环形山', craters.sum), have('tides', '潮汐', tides.sum)];
    manifest = { plugins: [craters, tides], parts: [] };
    blocked.add('tides');
    await loadMapNow('w1');
    let s = getMapNow()!;
    expect(s.ready).toBe(false);
    expect(s.files.every((f) => !f.bytes)).toBe(true);
    expect(s.checks.map((c) => [c.id, c.status, c.status === 'blocked' ? c.why : null])).toEqual([
      ['craters', 'ready', null],
      ['tides', 'blocked', '会把整片大陆沉进海里'],
    ]);
    blocked.clear();
    await refreshMapNow();
    s = getMapNow()!;
    expect(s.ready).toBe(true);
    expect(s.files.every((f) => !!f.bytes)).toBe(true);
  });

  it('核对完时已经换了世界、又核对了一次的:不记', async () => {
    installed = [have('tides', '潮汐', tides.sum)];
    await loadMapNow('w1', [tides], () => false);
    expect(getMapNow()).toBeNull();
    const first = loadMapNow('w1', [craters, tides]);
    const second = loadMapNow('w2', [tides]);
    await Promise.all([first, second]);
    expect(getMapNow()?.id).toBe('w2');
  });

  it('没用地图插件的世界:不记;换了世界,记着的不要了', async () => {
    manifest = { plugins: [magic], parts: [] };
    await loadMapNow('w1');
    expect(getMapNow()).toBeNull();
    expect(setupFor(false, {})).toBeUndefined();
    manifest = { plugins: [tides], parts: [] };
    await loadMapNow('w1');
    expect(getMapNow()?.id).toBe('w1');
    mapNowFor('w2');
    expect(getMapNow()).toBeNull();
  });
});

describe('新建中选地图插件', () => {
  it('用本机现在那一版,滑条照清单补齐、压回上下限;停用的、没装的、不是地图插件的选不上', async () => {
    installed = [have('craters', '环形山', craters.sum), have('tides', '潮汐', tides.sum), have('magic', '魔力', magic.sum, 'sim')];
    blocked.add(tides.sum);
    await chooseMaps('d1', [{ id: 'craters', params: { count: 999 } }, { id: 'tides' }, { id: 'magic' }, { id: 'nope' }]);
    const s = getMapNow()!;
    expect(s).toMatchObject({ id: 'd1', ready: true, checks: [] });
    expect(s.stored).toBeUndefined();
    expect(s.list).toEqual([{ id: 'craters', version: '1.0.0', sum: craters.sum, role: 'map', name: '环形山', params: { count: 200 } }]);
    expect(s.files.map((f) => [f.id, f.params, !!f.bytes])).toEqual([['craters', { count: 200 }, true]]);
    expect(chosenMaps('d1')).toEqual([{ id: 'craters', params: { count: 200 } }]);
    expect(chosenMaps('d2')).toEqual([]);
    // 选的那个后来被停用了:去掉
    blocked.add('craters');
    await refreshMapNow();
    expect(getMapNow()).toBeNull();
  });
});

describe('配方链接', () => {
  it('这个世界用了地图插件就不给', async () => {
    expect(usesMaps('w1')).toBe(false);
    manifest = { plugins: [tides], parts: [] };
    await loadMapNow('w1');
    expect(usesMaps('w1')).toBe(true);
    expect(usesMaps('w2')).toBe(false);
  });
});

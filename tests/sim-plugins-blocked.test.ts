/**
 * 推演插件被网站停用了不再跑:打开的世界核对时换成 blocked(推演不带文件),新建里选不上、以它为底稿带不过去;
 * 以它为底稿新建时带上原来的推演插件和滑条,本机没装的照旧列着、推演不带文件(装上或移出以前不能开始推演)。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldPlugin } from '../src/gen/worldFormat';
import type { InstalledPlugin } from '../src/plugin/pluginStore';
import type { SimPluginCheck } from '../src/plugin/pluginWorld';
import { blockedLabel, blockedText } from '../src/ui/plugins/simWorldText';

const blocked = new Set<string>();
let installed: InstalledPlugin[] = [];
vi.mock('../src/ui/plugins/flag', () => ({ pluginsUiOn: () => true }));
vi.mock('../src/plugin/pluginStore', () => ({ listPlugins: async () => installed, pluginFileBytes: async () => new Uint8Array([1, 2, 3]) }));
vi.mock('../src/ui/plugins/verdict', () => ({
  verdictOf: (sum: string, id?: string) => ({ reviewed: false, blocked: blocked.has(sum) || (id !== undefined && blocked.has(id)) ? { why: '会偷偷改别国的国土', day: '11 月 8 日' } : null }),
  subscribeVerdicts: () => () => {},
}));
vi.mock('../src/ui/worldStore', () => ({ vaultCall: async () => null, settleWorld: async () => null }));
const cur = { id: '', kind: 'draft' };
vi.mock('../src/ui/saveStore', () => ({ currentWorld: () => (cur.id ? { ...cur } : null), keepWorld: () => {}, notify: () => {}, saveAsNewVersion: () => null, storageFullWhy: () => '' }));

const { blockedChecks, carrySims, chooseSims, chosenSims, refreshSimNow } = await import('../src/ui/plugins/worldPlugins');
const { getSimNow, setSimNow } = await import('../src/ui/world/simNow');

const record = (id: string, name: string, sum: string, params?: Record<string, number>): WorldPlugin => ({ id, version: '1.0.0', sum, role: 'sim', name, ...(params ? { params } : {}) });
const have = (id: string, name: string, sum: string): InstalledPlugin =>
  ({
    id,
    on: true,
    from: 'file',
    at: 0,
    current: { sum, bytes: 3, at: 0, manifest: { id, name, version: '1.0.0', role: 'sim', sim: { every: 1, params: { k: { label: '强度', min: 0, max: 3, default: 1 } } } } },
  }) as unknown as InstalledPlugin;

const magic = record('magic', '魔力', 'a'.repeat(64), { k: 2 });
const faith = record('faith', '宗教生效', 'b'.repeat(64));

beforeEach(() => {
  blocked.clear();
  installed = [];
  setSimNow(null);
  Object.assign(cur, { id: 'draft', kind: 'draft' });
});

describe('停用名单', () => {
  it('世界记的那一版(按指纹)或整个插件(按编号)被停用:换成 blocked,写原因;别的照原来的核对;都没停用 = null', () => {
    const checks: SimPluginCheck[] = [
      { id: 'magic', plugin: magic, status: 'ready', which: 'current' },
      { id: 'faith', plugin: faith, status: 'missing' },
    ];
    expect(blockedChecks([magic, faith], checks)).toBeNull();
    blocked.add(magic.sum);
    expect(blockedChecks([magic, faith], checks)).toEqual([
      { id: 'magic', plugin: magic, status: 'blocked', why: '会偷偷改别国的国土', day: '11 月 8 日' },
      { id: 'faith', plugin: faith, status: 'missing' },
    ]);
    blocked.clear();
    blocked.add('faith');
    expect(blockedChecks([magic, faith], null)?.map((c) => c.status)).toEqual(['ready', 'blocked']);
  });

  it('新建里选上的:停用的不算,推演不带它', async () => {
    installed = [have('magic', '魔力', 'c'.repeat(64)), have('faith', '宗教生效', 'd'.repeat(64))];
    blocked.add('faith');
    await chooseSims('w', [{ id: 'faith' }, { id: 'magic', params: { k: 3 } }]);
    const s = getSimNow()!;
    expect(s.list.map((p) => [p.id, p.params])).toEqual([['magic', { k: 3 }]]);
    expect(s.files?.map((f) => f.id)).toEqual(['magic']);
  });

  it('框上的话:一个写名字、多个写几个;说这个世界照样能看,另存一份不带它的', () => {
    const one = [{ id: 'magic', plugin: magic }];
    expect(blockedLabel(one)).toBe('「魔力」被网站停用了');
    expect(blockedLabel([...one, { id: 'faith', plugin: faith }])).toBe('2 个推演插件被网站停用了');
    expect(blockedText('群岛', one)).toEqual([
      '「群岛」用了推演插件「魔力」第 1.0 版，它被网站停用了，不再跑。这个世界照样能看；要接着推，只能另存一份不带它的。',
      '原来的「群岛」不动；另存一份「群岛（新版）」，地图和你写的东西留下，历史不带它、从第 0 年重推，整段都会不一样。',
    ]);
  });
});

describe('以它为底稿新建', () => {
  it('带上原来的推演插件、先后和滑条;本机装着的用现在那一版', async () => {
    installed = [have('faith', '宗教生效', 'e'.repeat(64)), have('magic', '魔力', 'f'.repeat(64))];
    await carrySims('draft', [magic, faith]);
    const s = getSimNow()!;
    expect(s.id).toBe('draft');
    expect(s.list.map((p) => [p.id, p.sum, p.params])).toEqual([
      ['magic', 'f'.repeat(64), { k: 2 }],
      ['faith', 'e'.repeat(64), { k: 1 }],
    ]);
    expect(s.files?.map((f) => f.id)).toEqual(['magic', 'faith']);
    expect(chosenSims('draft')).toEqual([
      { id: 'magic', params: { k: 2 } },
      { id: 'faith', params: { k: 1 } },
    ]);
  });

  it('本机没装的照旧列着、标没装,推演不带文件;装上以后再选就齐了;移出就不带', async () => {
    installed = [have('faith', '宗教生效', 'e'.repeat(64))];
    await carrySims('draft', [magic, faith]);
    let s = getSimNow()!;
    expect(s.list.map((p) => p.id)).toEqual(['magic', 'faith']);
    expect(s.files).toBeNull();
    expect(s.checks).toEqual([{ id: 'magic', plugin: magic, status: 'missing' }]);
    // 移出没装的那个
    await chooseSims('draft', [{ id: 'faith' }]);
    s = getSimNow()!;
    expect(s.list.map((p) => p.id)).toEqual(['faith']);
    expect(s.files?.map((f) => f.id)).toEqual(['faith']);
    // 重新带一次,再装上
    await carrySims('draft', [magic, faith]);
    installed = [...installed, have('magic', '魔力', 'f'.repeat(64))];
    await chooseSims('draft', chosenSims('draft'));
    s = getSimNow()!;
    expect(s.files?.map((f) => f.id)).toEqual(['magic', 'faith']);
    expect(s.checks).toEqual([]);
  });

  it('读插件仓库的时候已经离开了那个新建的世界:不带', async () => {
    installed = [have('faith', '宗教生效', 'e'.repeat(64))];
    const p = carrySims('draft', [faith]);
    cur.id = 'other';
    await p;
    expect(getSimNow()).toBeNull();
  });

  it('停用的不带;删掉的插件(不是带过来的)照旧不算', async () => {
    installed = [have('faith', '宗教生效', 'e'.repeat(64))];
    blocked.add(magic.sum);
    await carrySims('draft', [magic, faith]);
    expect(getSimNow()?.list.map((p) => p.id)).toEqual(['faith']);
    await chooseSims('w2', [{ id: 'gone' }, { id: 'faith' }]);
    expect(getSimNow()?.list.map((p) => p.id)).toEqual(['faith']);
    expect(getSimNow()?.files).not.toBeNull();
  });
});

describe('刚建好的世界', () => {
  it('停用了推演不带它的文件;又不停用了换回原来的', async () => {
    Object.assign(cur, { id: 'w', kind: 'created' });
    installed = [have('magic', '魔力', 'f'.repeat(64))];
    await chooseSims('w', [{ id: 'magic' }]);
    const files = getSimNow()!.files;
    blocked.add('magic');
    await refreshSimNow();
    expect(getSimNow()?.files).toBeNull();
    expect(getSimNow()?.checks.map((c) => c.status)).toEqual(['blocked']);
    blocked.clear();
    await refreshSimNow();
    expect(getSimNow()?.files).toBe(files);
    expect(getSimNow()?.checks).toEqual([]);
  });
});

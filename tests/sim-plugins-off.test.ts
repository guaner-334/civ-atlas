/**
 * 网站关了插件(插件界面关着)时,用了推演插件的世界:照样读出它记的推演插件(接着推之前要问),本机装着的也不跑;
 * 另存一份不带插件重推的,新的那份不带推演插件,原来的不动。开着时照旧和本机核对。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorldEdits } from '../src/gen/edits';
import { EMPTY_EDITS } from '../src/gen/edits';
import type { WorldPlugin } from '../src/gen/worldFormat';

const flag = { on: false };
vi.mock('../src/ui/plugins/flag', () => ({ pluginsUiOn: () => flag.on }));
let plugins: WorldPlugin[] = [];
vi.mock('../src/ui/worldStore', () => ({ vaultCall: async (name: string) => (name === 'worldPluginsOf' ? { plugins, parts: [] } : null), settleWorld: async () => null }));
const ready = vi.fn(async (list: readonly WorldPlugin[]) => ({ ok: true as const, files: list.filter((p) => p.role === 'sim').map((p) => ({ id: p.id, sum: p.sum, bytes: new Uint8Array([1]) })) }));
vi.mock('../src/plugin/simPlugins', () => ({ simPluginsReady: (list: readonly WorldPlugin[]) => ready(list) }));
let installed: unknown[] = [];
const fileBytes = vi.fn(async () => new Uint8Array([1]));
vi.mock('../src/plugin/pluginStore', () => ({ listPlugins: async () => installed, pluginFileBytes: () => fileBytes() }));
vi.mock('../src/ui/plugins/verdict', () => ({ verdictOf: () => ({ reviewed: false, blocked: null }), subscribeVerdicts: () => () => {} }));
const notes: { text: string }[] = [];
const copies: [string, WorldEdits][] = [];
vi.mock('../src/ui/saveStore', () => ({
  currentWorld: () => ({ id: 'w', kind: 'stored' }),
  keepWorld: () => {},
  notify: (n: { text: string }) => notes.push(n),
  saveAsNewVersion: (from: string, next: WorldEdits) => (copies.push([from, next]), 'w2'),
  storageFullWhy: () => '',
}));
vi.mock('../src/ai/library', () => ({ copyNotes: () => true }));

const { chooseSims, copyWithSims, loadSimNow } = await import('../src/ui/plugins/worldPlugins');
const { getSimNow, setSimNow, simFilesNow, simsOf } = await import('../src/ui/world/simNow');
const { OFF_LABEL, offText } = await import('../src/ui/plugins/simWorldText');

const sim = (id: string, name: string): WorldPlugin => ({ id, version: '1.0.0', sum: id[0].repeat(64), role: 'sim', name });
const map: WorldPlugin = { id: 'craters', version: '1.0.0', sum: 'c'.repeat(64), role: 'map', name: '环形山' };
const weariness = sim('weariness', '厌战');
const faith = sim('faith', '宗教生效');

beforeEach(() => {
  flag.on = false;
  plugins = [map, weariness, faith];
  ready.mockClear();
  fileBytes.mockClear();
  installed = [];
  notes.length = 0;
  copies.length = 0;
  setSimNow(null);
});

describe('网站关了插件', () => {
  it('打开的世界照样记下它用的推演插件,本机装着的也不跑:推演不带文件,接着推之前要问', async () => {
    await loadSimNow('w');
    expect(ready).not.toHaveBeenCalled();
    const s = getSimNow()!;
    expect(s.id).toBe('w');
    expect(s.stored).toBe(true);
    expect(s.list).toEqual([weariness, faith]);
    expect(s.files).toBeNull();
    expect(s.checks.map((c) => [c.id, c.status])).toEqual([
      ['weariness', 'missing'],
      ['faith', 'missing'],
    ]);
    expect(simFilesNow()).toBeUndefined();
    // 世界小状态拿它判断「这一份算不出来,别打包存回去」
    expect(simsOf('w')).toBeNull();
  });

  it('没用推演插件的世界:什么都不记', async () => {
    plugins = [map];
    await loadSimNow('w');
    expect(getSimNow()).toBeNull();
  });

  it('开着时照旧和本机核对,装着同一版的带上文件', async () => {
    flag.on = true;
    await loadSimNow('w');
    expect(ready).toHaveBeenCalledTimes(1);
    expect(getSimNow()?.files?.map((f) => f.id)).toEqual(['weariness', 'faith']);
  });

  it('另存一份不带插件重推:新的那份不带推演插件,原来的不动', async () => {
    await loadSimNow('w');
    const next = { ...EMPTY_EDITS, endYear: 3100 };
    const opened: string[] = [];
    await copyWithSims('w', next, (id) => opened.push(id), ['weariness', 'faith']);
    expect(copies).toEqual([['w', next]]);
    expect(opened).toEqual(['w2']);
    expect(getSimNow()).toBeNull();
  });

  it('地图留着的世界另存不了:说不带插件,不说停用', async () => {
    await loadSimNow('w');
    await copyWithSims('w', { ...EMPTY_EDITS, map: { from: 'x', sum: 'd'.repeat(64), grown: 50 } } as WorldEdits, () => {}, ['weariness']);
    expect(copies).toEqual([]);
    expect(notes.map((n) => n.text)).toEqual(['这个世界另存不了不带插件重推的一份']);
  });

  it('问的框上的话:一个写「它」、多个写「它们」;说等插件开回来,另存的叫「…（新版）」', () => {
    expect(OFF_LABEL).toBe('网站暂时关了插件');
    expect(offText('群岛', [{ id: 'weariness', plugin: weariness }])).toEqual([
      '「群岛」用了推演插件「厌战」第 1.0 版。看不受影响；要接着推，得等插件开回来，推出来的历史才对得上。',
      '不想等的话，可以另存一份「群岛（新版）」：地图和你写的东西留下，历史不带它、从第 0 年重推，整段都会不一样。原来的「群岛」不动。',
    ]);
    const [a, b] = offText('群岛', [
      { id: 'weariness', plugin: weariness },
      { id: 'faith', plugin: faith },
    ]);
    expect(a).toBe('「群岛」用了推演插件「厌战」第 1.0 版、「宗教生效」第 1.0 版。看不受影响；要接着推，得等插件开回来，推出来的历史才对得上。');
    expect(b).toContain('历史不带它们');
  });
});

describe('网站关了插件:新建里选推演插件', () => {
  const have = (p: WorldPlugin) => ({ id: p.id, on: true, from: 'file', at: 0, current: { sum: p.sum, bytes: 1, at: 0, manifest: { id: p.id, name: p.name, version: '1.0.0', role: 'sim', sim: { every: 1 } } } });

  it('装着也不读插件文件,一个都选不上;开着时照旧带上文件', async () => {
    installed = [have(weariness)];
    await chooseSims('d1', [{ id: 'weariness' }]);
    expect(fileBytes).not.toHaveBeenCalled();
    expect(getSimNow()).toBeNull();
    flag.on = true;
    await chooseSims('d1', [{ id: 'weariness' }]);
    expect(fileBytes).toHaveBeenCalledTimes(1);
    expect(getSimNow()?.files?.map((f) => f.id)).toEqual(['weariness']);
  });
});

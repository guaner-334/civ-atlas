import { describe, expect, it } from 'vitest';
import type { InstalledPlugin } from '../src/plugin/pluginStore';
import { missingText, otherText, simHere, simLines } from '../src/ui/plugins/simWorldText';

const plugin = (version: string, sum: string, params?: Record<string, number>) => ({ id: 'weariness', version, sum, role: 'sim', name: '厌战', ...(params ? { params } : {}) });
const installed = (version: string, sum: string, previous?: string): InstalledPlugin =>
  ({
    id: 'weariness',
    on: true,
    from: 'file',
    at: 0,
    current: { sum, bytes: 1, at: 0, manifest: { version, sim: { params: { stall: { label: '几年没打下就罢兵', min: 1, max: 20, default: 4 }, long: { label: '一场仗最多打几年', min: 2, max: 40, default: 8 } } } } },
    ...(previous ? { previous: { sum: previous, bytes: 1, at: 0, manifest: { version: '1.0.0' } } } : {}),
  }) as unknown as InstalledPlugin;

describe('世界用的推演插件', () => {
  it('本机有没有世界记的那一版:现在用的、留着的上一版都算', () => {
    expect(simHere({ plugin: plugin('1.0.0', 'a'), installed: null })).toBe('none');
    expect(simHere({ plugin: plugin('1.0.0', 'a'), installed: installed('1.0.0', 'a') })).toBe('same');
    expect(simHere({ plugin: plugin('1.0.0', 'a'), installed: installed('1.1.0', 'b', 'a') })).toBe('same');
    expect(simHere({ plugin: plugin('1.0.0', 'a'), installed: installed('1.1.0', 'b') })).toBe('other');
  });

  it('世界设定那一行的小字:第几个出手、改过的滑条、只装了别的版本时要装回哪一版', () => {
    expect(simLines({ plugin: plugin('1.0.0', 'a', { stall: 6, long: 8 }), installed: installed('1.1.0', 'b') }, 1)).toEqual([
      '第 1 个出手。滑条：几年没打下就罢兵 6（默认 4），别的是默认',
      '要接着推，得装回第 1.0 版；不装也照常能看',
    ]);
    expect(simLines({ plugin: plugin('1.0.0', 'a', { stall: 4, long: 8 }), installed: installed('1.0.0', 'a') }, 2)).toEqual(['第 2 个出手。滑条都是默认']);
    expect(simLines({ plugin: plugin('1.0.0', 'a'), installed: null }, 3)).toEqual(['第 3 个出手']);
    expect(simLines({ plugin: plugin('1.0.0', 'a', { k: 1.5 }), installed: null }, 1)).toEqual(['第 1 个出手。滑条：k 1.5']);
  });

  it('要先装、另存一份再推演的话', () => {
    const p = plugin('1.0.0', 'a');
    expect(missingText('未命名世界', [{ id: 'magic', plugin: { ...p, id: 'magic', name: '魔力' } }])).toBe('「未命名世界」用了推演插件「魔力」第 1.0 版。看不用装；要接着推，得先装上同一版，推出来的历史才对得上。');
    const [a, b] = otherText('未命名世界', [{ id: 'weariness', plugin: p, installed: { version: '1.1.0', sum: 'b' } }], '再推 500 年');
    expect(a).toBe('「未命名世界」是用推演插件「厌战」第 1.0 版推的，你装的是第 1.1 版。推演的话，地图和你写的东西留下，历史按第 1.1 版从第 0 年重推，整段都会不一样。');
    expect(b).toBe('原来的「未命名世界」不动；另存一份「未命名世界（新版）」，在那一份上再推 500 年。要照原样接着推，得装回第 1.0 版。');
    const two = otherText('甲', [{ id: 'weariness', plugin: p, installed: { version: '1.1.0', sum: 'b' } }, { id: 'faith', plugin: { ...p, id: 'faith', name: '宗教生效' }, installed: { version: '1.2.0', sum: 'c' } }], '推演');
    expect(two[0]).toContain('「厌战」第 1.0 版（你装的是第 1.1 版）、「宗教生效」第 1.0 版（你装的是第 1.2 版）');
    expect(two[1]).toContain('得装回原来那几版');
  });
});

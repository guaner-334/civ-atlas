import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '../src/plugin/pluginFile';
import {
  addedLines,
  addsRows,
  askByLine,
  clockText,
  dayText,
  devLoadLine,
  devLogCopy,
  devLogOrder,
  devStopText,
  moreText,
  pageByLine,
  sizeText,
  versionLabel,
  versionText,
  type DevLog,
} from '../src/ui/plugins/pluginText';

function manifest(over: Partial<PluginManifest> = {}): PluginManifest {
  return {
    app: '文明与地图',
    kind: 'plugin',
    format: 1,
    id: 'qi-ming',
    name: '起名助手',
    version: '1.0.0',
    role: 'tool',
    api: 1,
    runtime: 'worker',
    requires: ['history.read@1', 'author.read@1', 'author.write@1', 'ui.panel@1'],
    entry: 'main.js',
    files: [],
    license: 'MIT',
    author: { name: '松间' },
    ...over,
  };
}

describe('插件页的字', () => {
  it('版本号:补丁号是 0 的省掉', () => {
    expect(versionText('1.0.0')).toBe('1.0');
    expect(versionText('1.2.3')).toBe('1.2.3');
    expect(versionText('10.20.0')).toBe('10.20');
    expect(versionLabel('2.0.0')).toBe('第 2.0 版');
  });

  it('大小', () => {
    expect(sizeText(22531)).toBe('22 KB');
    expect(sizeText(151556)).toBe('148 KB');
    expect(sizeText(300)).toBe('1 KB');
    expect(sizeText(2 * 1024 * 1024)).toBe('2.0 MB');
  });

  it('日子:不是今年的带上年', () => {
    const now = new Date(2026, 10, 8, 12).getTime();
    expect(dayText(new Date(2026, 10, 8, 9).getTime(), now)).toBe('11 月 8 日');
    expect(dayText(new Date(2025, 0, 3).getTime(), now)).toBe('2025 年 1 月 3 日');
  });

  it('标题下面那行:电脑带许可证,手机不带;插件页先写许可证', () => {
    const m = manifest();
    expect(askByLine(m, 22531, false)).toBe('松间 写的，第 1.0 版，22 KB，开源许可证 MIT');
    expect(askByLine(m, 22531, true)).toBe('松间 写的，第 1.0 版，22 KB');
    expect(pageByLine(m, 22531)).toBe('松间 写的，开源许可证 MIT，22 KB');
    expect(pageByLine(manifest({ author: undefined }), 2048)).toBe('开源许可证 MIT，2 KB');
  });

  it('更新时只列新多出来的行;同一行里多要一样能力不算', () => {
    const old = manifest({ requires: ['world.read@1', 'layer.marks@1', 'ui.panel@1'] });
    const next = manifest({ requires: ['world.read@1', 'history.read@1', 'layer.marks@1', 'layer.cells@1', 'ui.panel@1'] });
    expect(addedLines(old, next).map((l) => l.key)).toEqual(['history']);
    expect(addedLines(next, next)).toEqual([]);
    expect(moreText(1)).toBe('新版多要一样：');
    expect(moreText(2)).toBe('新版多要两样：');
  });

  it('它加了什么:工具、图层、存不存东西', () => {
    expect(addsRows(manifest(), false)).toEqual([
      { k: '工具「起名助手」', v: '在地图右下的「工具」里' },
      { k: '往世界里存东西', v: '不存它自己的数据', small: '改的东西记进你的修改，和你自己改的一样：能分享、能撤销' },
    ]);
    expect(addsRows(manifest(), true)[0].v).toBe('在右上竖排的拼图里');
    const layer = addsRows(manifest({ requires: ['world.read@1', 'layer.cells@1', 'store.world@1'] }), false);
    expect(layer.map((r) => r.k)).toEqual(['图层', '往世界里存东西']);
    expect(layer[1].v).toBe('存它自己的数据');
    expect(addsRows(manifest({ requires: ['world.read@1'] }), false)).toEqual([{ k: '往世界里存东西', v: '不存', small: '它算的关掉就没了，世界不变' }]);
  });
});

describe('开发者模式的小卡', () => {
  const at = (h: number, m: number, sec: number) => new Date(2026, 10, 8, h, m, sec).getTime();

  it('时刻写成 14:32:05', () => {
    expect(clockText(at(14, 32, 5))).toBe('14:32:05');
    expect(clockText(at(9, 3, 0))).toBe('09:03:00');
  });

  it('最近一次载入的排最上面,同一次里照先后;复制的和看到的一个顺序', () => {
    const logs: DevLog[] = [
      { at: at(14, 31, 40), level: 'error', text: '出错了', run: 1 },
      { at: at(14, 31, 40), level: 'site', text: '插件出错，已经停下', run: 1 },
      { at: at(14, 32, 5), level: 'info', text: '读到 36,214 个地块', run: 2 },
      { at: at(14, 32, 5), level: 'warn', text: 'layer.cells 没成：x', run: 2 },
    ];
    expect(devLogOrder(logs).map((l) => l.text)).toEqual(['读到 36,214 个地块', 'layer.cells 没成：x', '出错了', '插件出错，已经停下']);
    expect(devLogCopy(logs).split('\n')).toEqual([
      '14:32:05 信息 读到 36,214 个地块',
      '14:32:05 警告 layer.cells 没成：x',
      '14:31:40 出错 出错了',
      '14:31:40 网站 插件出错，已经停下',
    ]);
  });

  it('第二行:载入还是重新载入、用了多久、没开起来', () => {
    expect(devLoadLine(at(14, 32, 5), true, 18.4, 'sea-distance.civplugin')).toBe('14:32:05 重新载入，算了 18 毫秒（sea-distance.civplugin）');
    expect(devLoadLine(at(14, 32, 5), false, 0.2, 'a.civplugin')).toBe('14:32:05 载入，算了 1 毫秒（a.civplugin）');
    expect(devLoadLine(at(14, 32, 5), true, null, 'a.civplugin')).toBe('14:32:05 重新载入，没开起来（a.civplugin）');
  });

  it('插件停下时网站的一句:网站自己停的不记;出错的那句另记', () => {
    expect(devStopText('stopped', '')).toBeNull();
    expect(devStopText('crashed', 'Uncaught Error: x')).toBe('插件出错，已经停下');
    expect(devStopText('flood', 'over 200 messages a second')).toBe('插件一秒发话太多，已经停下（over 200 messages a second）');
    expect(devStopText('start-timeout', '')).toBe('插件代码顶层 10 秒没跑完，已经停下');
  });
});

import { describe, expect, it } from 'vitest';
import type { PluginManifest } from '../src/plugin/pluginFile';
import {
  otherPluginText,
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
  simRows,
  simWhenText,
  sizeText,
  versionLabel,
  versionText,
  wallInstalledText,
  type DevLog,
} from '../src/ui/plugins/pluginText';
import { CAP_LABEL } from '../src/ui/plugins/pluginWords';
import { mapBrief, mapRows } from '../src/ui/plugins/mapText';
import { mapLines } from '../src/ui/plugins/simWorldText';
import { PERMISSIONS } from '../src/plugin/pluginCaps';

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

describe('推演插件的字', () => {
  const caps = ['sim.read@1', 'sim.tables@1', 'sim.influence@1', 'sim.chronicle@1'];

  it('什么时候出手:频率;听的史事只在出手时看,不多出手', () => {
    expect(simWhenText({ every: 5 })).toBe('每 5 年一次');
    expect(simWhenText({ every: 1, listen: ['war', 'conquer', 'peace'] })).toBe('每年一次（出手时看打仗、攻下、议和）');
    expect(simWhenText({ listen: ['war', 'reform', 'winter'] })).toBe('只在开头和自己约好的年份（出手时看打仗、别的史事）');
    expect(simWhenText({})).toBe('只在开头和自己约好的年份');
  });

  it('它在推演里做什么:影响口、命令照网站的说法,没有的写不下、不加', () => {
    const sim = {
      every: 5,
      influences: ['city.capacity'],
      tables: [{ id: 'mana', name: '魔力浓度', unit: 'region' as const, min: 0, max: 100, off: 0 }],
      layers: [{ id: 'mana', table: 'mana', keep: 50, title: '魔力浓度' }],
      params: { k: { label: '魔力的影响', min: 0, max: 3, default: 1 } },
    };
    expect(simRows(sim, caps, true)).toEqual([
      { k: '出手', v: '每 5 年一次' },
      { k: '会影响', v: '城的人口上限（按州）' },
      { k: '命令', v: '不下' },
      { k: '自己的数', v: '魔力浓度（每州一个，0–100）' },
      { k: '图层', v: '「魔力浓度」，跟着年份变', small: '在图层面板「插件图层」里' },
      { k: '编年史', v: '会写' },
      { k: '滑条', v: '1 个：魔力的影响（0–3，默认 1）' },
    ]);
    const rows = simRows({ every: 5, commands: ['declare', 'ally'], params: { a: { label: '甲', min: 0, max: 1, default: 0 }, b: { label: '乙', min: 0, max: 1, default: 0 } } }, ['sim.commands@1'], false);
    expect(rows.map((r) => r.k)).toEqual(['什么时候出手', '会影响', '会下的命令', '编年史', '图层', '滑条']);
    expect(rows.map((r) => r.v)).toEqual(['每 5 年一次', '不影响', '宣战、结盟', '不写', '不加', '2 个：甲、乙']);
    expect(rows[5].small).toBe('新建世界选它时拨');
  });

  it('权限的短说法每行都有;从作品墙装好以后说去哪选', () => {
    for (const k of Object.keys(PERMISSIONS)) expect(CAP_LABEL[k]).toBeTruthy();
    expect(wallInstalledText(manifest({ role: 'sim', runtime: 'quickjs', requires: caps }), false)).toBe('新建世界时，在「文明」那一步的「推演插件」里选上它。装在这个浏览器里，所有世界都能用。');
  });
});

describe('地图插件的字', () => {
  const koppen = {
    stages: ['climate', 'layers'],
    layers: [{ id: 'k', title: '柯本气候', classes: Array.from({ length: 30 }, (_, i) => ({ value: i, color: '#000000', label: String(i) })) }],
    params: { monsoon: { label: '季风强弱', min: 0, max: 2, default: 1 } },
  };

  it('它在长地图时做什么:哪一步、会改什么、图层、滑条,网站自己的说法', () => {
    expect(mapRows(koppen, false)).toEqual([
      { k: '在哪一步出手', v: '改气候（气温降水算好以后）、出图层（地图长好以后）' },
      { k: '会改什么', v: '气温、降水', small: '后面的海冰、河、森林草原沙漠、文明跟着变' },
      { k: '图层', v: '1 张：「柯本气候」（30 类）', small: '存进世界，在图层面板「插件图层」里' },
      { k: '滑条', v: '1 个：季风强弱（0–2，默认 1）', small: '新建世界选它时拨' },
      { k: '多花多久', v: '没量过' },
    ]);
    const phone = mapRows(koppen, true);
    expect(phone.slice(0, 3)).toEqual([
      { k: '哪一步', v: '改气候、出图层' },
      { k: '会改什么', v: '气温、降水', small: '后面的河、森林草原沙漠、文明跟着变' },
      { k: '图层', v: '「柯本气候」（30 类）', small: '存进世界，在图层面板「插件图层」里' },
    ]);
    const craters = mapRows({ stages: ['height'], params: { a: { label: '坑有几个', min: 0, max: 200, default: 40 }, b: { label: '坑多大', min: 0.5, max: 2, default: 1 } } }, false);
    expect(craters[1]).toEqual({ k: '会改什么', v: '海拔（跨过海平面的地方海陆跟着变）', small: '后面的湖、气候、河、森林草原沙漠、文明跟着变' });
    expect(craters[2]).toEqual({ k: '图层', v: '不加' });
    expect(craters[3].v).toBe('2 个：坑有几个、坑多大');
    expect(mapRows({ stages: ['layers'], layers: [{ id: 't', title: '潮差', ramp: { colors: ['#000000', '#ffffff'] } }] }, false)[1]).toEqual({ k: '会改什么', v: '不改地图' });
  });

  it('世界设定「用到的插件」里地图插件那一行:哪一步、第几个出手、滑条、出的图层,对不上的说改地形要装回哪一版', () => {
    const installed = (sum: string, version = '1.0.0') =>
      ({ id: 'craters', current: { sum, manifest: { version, map: { stages: ['height'], params: { count: { label: '坑有几个', min: 0, max: 200, default: 24 }, size: { label: '坑多大', min: 0.5, max: 2, default: 1 } } } } } }) as never;
    const plugin = { id: 'craters', version: '1.0.0', sum: 'a', role: 'map', name: '环形山', params: { count: 40, size: 1 } };
    expect(mapLines({ plugin, installed: installed('a') }, 1, [])).toEqual(['改海拔，第 1 个出手。滑条：坑有几个 40（默认 24），别的是默认']);
    expect(mapLines({ plugin: { ...plugin, params: { count: 24, size: 1 } }, installed: installed('b', '1.1.0') }, 2, ['柯本气候'])).toEqual([
      '改海拔，第 2 个出手。滑条都是默认',
      '出了一张图层「柯本气候」，存在世界里，没装也照常能看（图层面板「插件图层」）',
      '要改地形，得装回第 1.0 版',
    ]);
    expect(mapLines({ plugin, installed: null }, 1, [])).toEqual(['第 1 个出手。滑条：count 40、size 1', '要改地形，得装回第 1.0 版']);
  });

  it('选插件那一页名字下面那行按出手的先后;装好以后说去哪选', () => {
    expect(mapBrief({ stages: ['layers', 'climate'], layers: koppen.layers })).toBe('改气候、出 1 张图层');
    expect(mapBrief({ stages: ['height'] })).toBe('改海拔');
    expect(wallInstalledText(manifest({ role: 'map', runtime: 'quickjs', requires: ['gen.height@1'] }), true)).toBe('新建世界时，在「地图」那一步的「地图插件」里选上它。装在这个浏览器里，所有世界都能用。');
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

  it('从地图说明块选的是别的插件:说文件是哪个、地图要哪个、去哪装', () => {
    expect(otherPluginText('潮汐', '环形山')).toBe('这个文件是「潮汐」，不是这张地图用的「环形山」。要装它，去插件页从文件装。');
  });
});

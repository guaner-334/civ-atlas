/**
 * 推演插件的清单(sim 段):和推演插件的设定一一对上(好样本的 sim 段直接交给推演跑得起来),推演拦下的写法清单检查也拦下;
 * 权限框的两行、底下那句;会下的命令、影响口的说法和推演认的对得上;没写的命令查得出来
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { COMMAND_KINDS, INFLUENCE_NAMES, OFFICIAL_INFLUENCES, SIM_CAPS, type SimPlugin, type SimRead } from '../src/gen/civ/simApi';
import {
  PERMISSIONS,
  PERMISSION_FOOTER_SIM,
  SIM_COMMAND_TEXT,
  SIM_INFLUENCE_TEXT,
  permissionFooter,
  permissionLines,
  simCommandsText,
  simInfluencesText,
} from '../src/plugin/pluginCaps';
import { openPluginFile, packPluginFile } from '../src/plugin/pluginFile';
import { SIM_SECTION_CAPS, checkSimManifest, simCapsUnused, undeclaredCommand, type SimManifest } from '../src/plugin/pluginSim';
import { goodSimInput, goodSimPlugin } from './lib/pluginFileSample';

/* eslint-disable @typescript-eslint/no-explicit-any */

let world: World | undefined;
const worldOf = () => (world ??= generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 }));

const goodSim = (): SimManifest => structuredClone(goodSimInput().manifest.sim!);
const requires = () => [...goodSimInput().manifest.requires];

/** 清单的 sim 段照原样交给推演(滑条、会下的命令推演不管) */
function pluginOf(sim: SimManifest): SimPlugin<SimRead> {
  const { params: _p, commands: _c, ...rest } = sim;
  return { id: 'magic', ...rest, act: () => {} } as SimPlugin<SimRead>;
}

describe('推演插件的清单', () => {
  it('好样本打开后 sim 段原样在清单里;再打一遍字节一样', async () => {
    const p = await openPluginFile(await goodSimPlugin());
    expect(p.manifest).toMatchObject({ role: 'sim', runtime: 'quickjs', sim: goodSimInput().manifest.sim });
    expect(await packPluginFile(goodSimInput())).toEqual(await goodSimPlugin());
  });

  it('sim 段可以是空的(一样能力都不要)', async () => {
    const input = goodSimInput();
    const { why: _w, ...m } = input.manifest;
    const p = await openPluginFile(await packPluginFile({ ...input, manifest: { ...m, requires: [], sim: {} } }));
    expect(p.manifest.sim).toEqual({});
  });

  it('好样本的 sim 段直接交给推演跑得起来:表、输入表、图层、影响口都接得上', () => {
    const civ = generateCiv(worldOf(), { endYear: 60, plugins: [pluginOf(goodSim())] });
    expect(civ.stuck).toBeUndefined();
    expect(civ.simLayers?.map((l) => [l.by, l.id, l.years])).toEqual([['magic', 'magic', [0, 50]]]);
    expect(Object.keys(civ.simPlugins![0].tables!.tables).sort()).toEqual(['awe', 'magic', 'unrest_in', '国']);
  });

  const bad: [string, (s: any) => void, RegExp][] = [
    ['频率不在菜单里', (s) => (s.every = 3), /频率|只能从/],
    ['表按地块记', (s) => (s.tables[0].unit = 'tile'), /地块/],
    ['表叫「国」', (s) => ((s.tables[1].id = '国'), (s.inputs = { 国: 'unrest' })), /国/],
    ['公式读了没有的表', (s) => (s.tables[0].rate = '0.1 * (nbmean(nb.mana) - magic)'), /mana/],
    ['输入表写了规则', (s) => (s.tables[1].rate = '0'), /输入表/],
    ['输入表和官方表的单位不一样', (s) => (s.inputs.unrest_in = 'rural'), /单位/],
    ['接官方表的不是输入表', (s) => (s.inputs = { magic: 'rural' }), /输入表/],
    ['图层的 keep 不对', (s) => (s.layers[0].keep = 0), /keep/],
    ['图层标按国记的表', (s) => (s.layers[0].table = 'awe'), /按州/],
    ['图层的颜色没给', (s) => delete s.layers[0].ramp, /ramp/],
    ['表超过 16 张', (s) => s.tables.push(...Array.from({ length: 14 }, (_, i) => ({ id: `t${i}`, name: `t${i}`, unit: 'world', min: 0, max: 1, off: 0, rule: '0' }))), /16/],
  ];
  it.each(bad)('推演拦下的写法,清单检查也拦下:%s', (_, change, says) => {
    const s = goodSim();
    change(s);
    expect(() => checkSimManifest({ sim: s, requires: requires() })).toThrow(says);
    expect(() => generateCiv(worldOf(), { endYear: 5, plugins: [pluginOf(s)] })).toThrow();
  });

  it('不认得的影响口、命令、史事、官方表:报这一版网站还没有的头一样', () => {
    const s = goodSim();
    expect(checkSimManifest({ sim: s, requires: requires() })).toBeNull();
    s.commands!.push('tax');
    s.influences!.push('war.pair');
    expect(checkSimManifest({ sim: s, requires: requires() })).toEqual({ what: '影响口', name: 'war.pair' });
  });

  it('sim 段的每一项要的能力和推演接口登记的对得上', () => {
    const parts = (cap: string) => (SIM_CAPS as Record<string, { parts: readonly string[] }>)[`${cap}@1`].parts;
    for (const [key, cap] of SIM_SECTION_CAPS) expect(parts(cap), `${key} → ${cap}`).toContain(key === 'commands' ? 'reply.commands' : key);
    for (const [cap, v] of Object.entries(SIM_CAPS)) for (const part of v.parts) if (!part.includes('.')) expect(SIM_SECTION_CAPS.some(([k, c]) => k === part && `${c}@1` === cap), part).toBe(true);
  });

  it('要了用不上的能力标出来(看得出来的只有表和影响口)', () => {
    expect(simCapsUnused({ sim: goodSim(), requires: requires() })).toEqual([]);
    expect(simCapsUnused({ sim: {}, requires: ['sim.read@1', 'sim.tables@1', 'sim.influence@1', 'sim.state@1'] })).toEqual(['sim.tables@1', 'sim.influence@1']);
    expect(simCapsUnused({ sim: { layers: goodSim().layers }, requires: ['sim.tables@1'] })).toEqual([]);
  });
});

describe('会下的命令', () => {
  it('下了清单里没写的种类查得出来,说清第几条;种类本身写错的不管(收命令的那一口会说)', () => {
    expect(undeclaredCommand(['declare', 'ally'], [{ kind: 'declare', a: 0, b: 1 }, { kind: 'ally', a: 0, b: 1 }])).toBeNull();
    expect(undeclaredCommand(['declare', 'ally'], [{ kind: 'declare', a: 0, b: 1 }, { kind: 'cede', a: 0, region: 3 }])).toBe('第 1 条命令是「割地」(cede),清单的 sim.commands 里没写');
    expect(undeclaredCommand(undefined, [{ kind: 'treaty', a: 0, ps: [1] }])).toContain('立约');
    expect(undeclaredCommand(['declare'], [{ kind: 'war' }, null, 3])).toBeNull();
  });

  it('网站的说法:种类和推演收的一样;影响口和推演登记的一样,按州按国照登记的单位', () => {
    expect(Object.keys(SIM_COMMAND_TEXT).sort()).toEqual([...COMMAND_KINDS].sort());
    expect(Object.keys(SIM_INFLUENCE_TEXT).sort()).toEqual([...INFLUENCE_NAMES].sort());
    for (const p of OFFICIAL_INFLUENCES) expect(SIM_INFLUENCE_TEXT[p.id], p.id).toMatch(p.unit === 'region' ? /（按州）$/ : /（按国）$/);
    expect(simCommandsText(['declare', 'ally'])).toBe('宣战、结盟');
    expect(simInfluencesText(['unrest.add', 'assim.rate', 'war.odds'])).toBe('动荡（按州）、同化快慢（按州）、宣战的几率（按国）');
  });
});

describe('权限框', () => {
  it('推演插件两行:加自己的数和事件(普通)、会改推演怎么走(显眼);作者的理由跟着那一行', () => {
    const lines = permissionLines(goodSimInput().manifest);
    expect(lines.map((l) => [l.key, l.text, l.loud])).toEqual([
      ['sim', '在推演里加自己的数和事件、写编年史', false],
      ['simSteer', '会改推演怎么走（只影响用它新推的世界，已经推好的世界不变）', true],
    ]);
    expect(lines[1].why).toEqual(['魔力浓的州,城的人口上限高']);
    expect(PERMISSIONS.sim.loud).toBe(false);
  });

  it('底下那句:推演插件说「改不了地形」,一样能力都不要也一样', () => {
    expect(permissionFooter(permissionLines(goodSimInput().manifest))).toBe(PERMISSION_FOOTER_SIM);
    expect(permissionFooter(permissionLines({ requires: ['sim.read@1'] }))).toBe(PERMISSION_FOOTER_SIM);
    expect(permissionFooter([], 'sim')).toBe(PERMISSION_FOOTER_SIM);
    expect(PERMISSION_FOOTER_SIM).toContain('改不了地形');
    expect(PERMISSION_FOOTER_SIM).not.toContain('改不了历史');
  });
});

import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { EMPTY_EDITS, polityKey, type WorldEdits } from '../src/gen/edits';
import type { PluginManifest } from '../src/plugin/pluginFile';
import type { PanelNode } from '../src/plugin/types';
import { isTool, toolWhere } from '../src/ui/plugins/pluginText';
import { batchParts, changeText, keyName, refusalOf, sayBatch, sayBusy, sayDone, type BatchParts } from '../src/ui/plugins/tools/toolSay';
import { numText, sectionsOf } from '../src/ui/plugins/tools/PanelView';
import { boxSize, cellsInBox } from '../src/ui/plugins/tools/BoxPick';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 3000 });
const civ = generateCiv(world, { endYear: 300 });

const parts = (p: Partial<BatchParts>): BatchParts => ({ names: [], marks: [], commands: 0, ...p });
const name = (before: string, after: string) => ({ kind: 'polity' as const, before, after });

describe('插件改了以后提示条怎么说', () => {
  it('改一处:一句话说完', () => {
    expect(sayBatch('起名助手', parts({ names: [name('塞雷尼亚帝国', '瑟兰帝国')] }))).toEqual({ text: '插件「起名助手」把塞雷尼亚帝国改名为瑟兰帝国' });
  });

  it('好几处同一种:第一行说几个,第二行列头两个、说还有几个', () => {
    const names = [name('塞雷尼亚帝国', '瑟兰帝国'), name('兹拉季纳帝国', '兹拉帝国'), name('a', 'b'), name('c', 'd'), name('e', 'f')];
    expect(sayBatch('起名助手', parts({ names }))).toEqual({ text: '插件「起名助手」改了 5 个国名', more: ['塞雷尼亚帝国改叫瑟兰帝国，兹拉季纳帝国改叫兹拉帝国，还有 3 个'] });
    expect(sayBatch('X', parts({ names: [name('a', 'b'), { kind: 'settlement', before: 'c', after: 'd' }] })).text).toBe('插件「X」改了 2 个名字');
  });

  it('加标记;几种一起改按种类数', () => {
    expect(sayBatch('城邦税赋', parts({ marks: ['奥里卡', '维雷拉', '特罗纳'] }))).toEqual({ text: '插件「城邦税赋」加了 3 个标记', more: ['奥里卡、维雷拉、特罗纳'] });
    expect(sayBatch('城邦税赋', parts({ marks: ['奥里卡'] }))).toEqual({ text: '插件「城邦税赋」加了标记「奥里卡」' });
    expect(sayBatch('X', parts({ names: [name('a', 'b')], marks: ['m', 'n'] }))).toEqual({ text: '插件「X」改了 3 处', more: ['改了 1 个国名、加了 2 个标记'] });
  });

  it('下了命令:推的时候、推完、有没生效的', () => {
    const b = parts({ marks: ['1', '2', '3'], commands: 2 });
    expect(sayBusy('城邦税赋', b)).toBe('插件「城邦税赋」下了 2 条命令，');
    expect(sayDone('城邦税赋', b, ' 1650 年', 0)).toEqual({ text: '插件「城邦税赋」改了 5 处，已从 1650 年起重新推演', more: ['加了 3 个标记、下了 2 条命令'] });
    expect(sayDone('城邦税赋', b, ' 1650 年', 1).more).toEqual(['加了 3 个标记、下了 2 条命令；1 条命令没生效，原因见概览"我的干预"']);
    expect(sayDone('X', parts({ commands: 2 }), ' 1650 年', 0)).toEqual({ text: '插件「X」下了 2 条命令，已从 1650 年起重新推演' });
  });

  it('从两份修改里认出改了什么', () => {
    const key = polityKey(civ, 0);
    const before: WorldEdits = EMPTY_EDITS;
    const after: WorldEdits = { ...EMPTY_EDITS, names: { [key]: '瑟兰' }, marks: [{ id: 1, title: '奥里卡', color: 'red', from: 0, at: [1, 2] }], interventions: [{ kind: 'protect', a: key, from: 10 }] };
    const b = batchParts(before, after, (k, when) => ({ kind: 'polity', name: when === 'before' ? keyName(civ, k, 100) : '瑟兰国' }));
    expect(b.names).toEqual([{ kind: 'polity', before: keyName(civ, key, 100), after: '瑟兰国' }]);
    expect(b.marks).toEqual(['奥里卡']);
    expect(b.commands).toBe(1);
    expect(keyName(civ, key, 100)).toBeTruthy();
    expect(keyName(civ, 'polity:nope', 100)).toBe('');
  });
});

describe('插件交来的修改不合格式', () => {
  it('网站查出来的那一句换成给人看的', () => {
    expect(changeText({ kind: 'name', name: '一二三四五六七八九十一二三四五六七八九十一' }, 'changes[0].name 最多 16 个字')).toBe('名字有 21 个字，最多 16 个字');
    expect(changeText({ kind: 'name' }, 'changes[0].key 在这个世界里找不到')).toBe('改的东西在这个世界里找不到');
    expect(changeText({ kind: 'mark' }, 'changes[0].mark.regions[3] 不是州键')).toBe('标记圈的州不是州键');
    expect(changeText(1, 'changes[0] 要是对象')).toBe('这一处要是对象');
    expect(changeText({}, '标记最多 2000 个')).toBe('标记最多 2000 个');
  });

  it('一处一处查:列出哪几处不对;都单独查得过就是整批的问题', () => {
    const changes = ['ok', 'bad', 'ok', 'bad'];
    const r = refusalOf({ changes }, '整批', (c) => (c === 'bad' ? 'changes[0].key 在这个世界里找不到' : null));
    expect(r).toEqual({ total: 4, bad: 2, lines: ['第 2 处：改的东西在这个世界里找不到', '第 4 处：改的东西在这个世界里找不到'] });
    expect(refusalOf({ changes }, '改完以后存档太大,存不下', () => null)).toEqual({ total: 4, bad: 0, lines: ['改完以后存档太大,存不下'] });
    const many = refusalOf({ changes: Array(8).fill('bad') }, '', () => 'changes[0] 要是对象');
    expect(many.lines).toHaveLength(6);
    expect(many.lines[5]).toBe('还有 3 处');
  });
});

describe('插件面板用网站的样子画', () => {
  it('小标题、group 起一节;连着的数、下拉并成一组;挨着的按钮排一排', () => {
    const nodes: PanelNode[] = [
      { type: 'heading', text: '这条路' },
      { type: 'number', label: '路程', value: 9100, unit: '公里' },
      { type: 'select', id: 'm', label: '走法', options: [{ value: 'a', label: '步行' }] },
      { type: 'text', text: '说明' },
      { type: 'group', title: '一路上', children: [{ type: 'table', columns: ['a'], rows: [['平原']] }] },
      { type: 'button', id: 'x', label: '换个起点' },
      { type: 'button', id: 'y', label: '清掉路线' },
    ];
    const s = sectionsOf(nodes);
    expect(s.map((x) => x.title)).toEqual(['这条路', '一路上', undefined]);
    expect(s[0].blocks.map((b) => b.kind)).toEqual(['rows', 'node']);
    expect(s[0].blocks[0].kind === 'rows' && s[0].blocks[0].rows).toHaveLength(2);
    expect(s[2].blocks).toEqual([{ kind: 'buttons', buttons: [nodes[5], nodes[6]] }]);
    expect(sectionsOf([])).toEqual([]);
    expect(numText(9100)).toBe('9,100');
    expect(numText(1.234)).toBe('1.23');
  });
});

describe('框选', () => {
  it('框住的地块:东西两头连着;框上写多少公里', () => {
    const all = cellsInBox(world, { cx: world.width / 2, cy: world.height / 2, w: world.width, h: world.height });
    expect(all.length).toBe(world.mesh.n);
    const seam = cellsInBox(world, { cx: 0, cy: world.height / 2, w: 200, h: 200 });
    const xs = [...seam].map((i) => world.mesh.x[i]);
    expect(xs.some((x) => x < 100) && xs.some((x) => x > world.width - 100)).toBe(true);
    expect(boxSize({ cx: 0, cy: world.height / 2, w: 100, h: 50 }, world.height)).toMatch(/^约 [\d,]+ × [\d,]+ 公里$/);
  });
});

describe('哪些插件算工具', () => {
  const m = (requires: string[]) => ({ name: '量路程', requires }) as unknown as PluginManifest;
  it('要了面板或点选的才在「工具」里;装好以后说在哪', () => {
    expect(isTool(m(['world.read@1', 'layer.cells@1']))).toBe(false);
    expect(isTool(m(['input.pick@1']))).toBe(true);
    expect(toolWhere(m(['ui.panel@1']), false)).toBe('地图右下的「工具」里多了「量路程」');
    expect(toolWhere(m(['ui.panel@1']), true)).toBe('右上竖排的拼图里多了「量路程」');
    expect(toolWhere(m(['layer.cells@1']), false)).toBeUndefined();
  });
});

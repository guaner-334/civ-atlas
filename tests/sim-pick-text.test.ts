import { describe, expect, it } from 'vitest';
import { PLUGIN_LIMITS } from '../src/gen/civ/engine/plugin';
import { chosenText, paramDigits, paramStep, paramsBrief, sharedNotes, simBrief } from '../src/ui/plugins/simPickText';
import { sameSims } from '../src/ui/world/simNow';

describe('新建世界选推演插件那一页的字', () => {
  it('名字下面那一行:出手频率,再说会下的命令、加的图层或影响什么', () => {
    expect(simBrief({ every: 1, listen: ['war'], commands: ['treaty'] })).toBe('每年出手，会下令立约');
    expect(simBrief({ every: 5, commands: ['declare', 'ally'], influences: ['war.odds'] })).toBe('每 5 年出手，会下令宣战、结盟');
    expect(simBrief({ every: 5, layers: [{ id: 'm', table: 'm', keep: 50, title: '魔力' }], influences: ['city.capacity'] })).toBe('每 5 年出手，加一个图层');
    expect(simBrief({ every: 10, influences: ['control.reach', 'war.power'] })).toBe('每 10 年出手；影响中央管得到多远、国力');
    expect(simBrief({ listen: ['war'] })).toBe('只在约好的年份出手');
  });

  it('滑条几个、改过几个', () => {
    const spec = { a: { default: 4 }, b: { default: 0.5 } };
    expect(paramsBrief(spec, undefined)).toBe('滑条 2 个，都是默认');
    expect(paramsBrief(spec, { a: 4, b: 0.5 })).toBe('滑条 2 个，都是默认');
    expect(paramsBrief(spec, { a: 6 })).toBe('滑条 2 个，改过 1 个');
    expect(paramsBrief({}, undefined)).toBe('没有滑条');
  });

  it('交到同一个影响口的说一句:乘的口乘在一起,加的口加在一起', () => {
    expect(
      sharedNotes([
        { name: '厌战', influences: ['war.odds'] },
        { name: '宗教生效', influences: ['unrest.add', 'assim.rate', 'war.odds'] },
        { name: '魔力', influences: ['city.capacity'] },
      ]),
    ).toEqual(['厌战和宗教生效都会影响宣战的几率，两边的数乘在一起。']);
    expect(sharedNotes([{ name: '甲', influences: ['unrest.add'] }, { name: '乙', influences: ['unrest.add'] }, { name: '丙', influences: ['unrest.add'] }])).toEqual(['甲、乙和丙都会影响动荡，几边的数加在一起。']);
    expect(sharedNotes([{ name: '甲' }])).toEqual([]);
  });

  it('那一行右边;滑条一格多大、写几位小数', () => {
    expect(chosenText([])).toBe('不用');
    expect(chosenText(['厌战', '宗教生效'])).toBe('厌战、宗教生效');
    expect(paramStep({ min: 0, max: 3, step: 0.5 })).toBe(0.5);
    expect(paramStep({ min: 0, max: 1 })).toBe(0.01);
    expect(paramStep({ min: 1, max: 20 })).toBe(0.2);
    expect(paramDigits(0.05)).toBe(2);
    expect(paramDigits(1)).toBe(0);
    expect(paramDigits(1e-7)).toBe(7);
  });

  it('最多几个和推演引擎一样', async () => {
    const { SIM_PICK_MAX } = await import('../src/ui/plugins/SimPick');
    expect(SIM_PICK_MAX).toBe(PLUGIN_LIMITS.plugins);
  });

  it('两份推演插件是不是同一套:编号、指纹、滑条(滑条不看先后)', () => {
    const f = (params?: Record<string, number>) => ({ id: 'a', sum: 's', bytes: new Uint8Array(), ...(params ? { params } : {}) });
    expect(sameSims(undefined, [])).toBe(true);
    expect(sameSims([f({ x: 1, y: 2 })], [f({ y: 2, x: 1 })])).toBe(true);
    expect(sameSims([f({ x: 1 })], [f({ x: 2 })])).toBe(false);
    expect(sameSims([f()], undefined)).toBe(false);
  });
});

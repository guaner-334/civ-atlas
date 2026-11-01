/**
 * 调规则的页里现算的(src/ui/rules/sliderMath.ts、rulesView.ts):滑条分几格、每格的值和读进来时清理吸到的一样、官方在哪一格、
 * 拖 / 点 / 键盘挪到哪一格、涂色的那一段、两头的字;改过的项按组列、搜规则、改了几项、「我的规则」一行的小字;
 * 读规则链接、规则文件的那一小块(入口开关、认不认得出)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TUNING_ITEMS, cleanTuning, officialValue, tuningItem, type TuningItem } from '../src/gen/civ/tuning';
import { TUNING_GROUPS, retiredText, tuningValueText } from '../src/gen/civ/tuningText';
import { rulesFileText, rulesHash } from '../src/gen/civ/ruleShare';
import { Biome } from '../src/gen/biomes';
import {
  edgeLabels,
  fillSpan,
  nearestSlot,
  officialLabelAt,
  officialSlots,
  pickThumb,
  slotFrac,
  slotIndex,
  slotsOf,
  stepThumb,
  thumbsOf,
  ticksOf,
  valueAt,
} from '../src/ui/rules/sliderMath';
import { cnCount, groupItems, keepModified, modifiedCount, modifiedSections, renamedBiomes, resetToOfficial, retiredModified, rulesLine, searchRules } from '../src/ui/rules/rulesView';

const item = (id: string) => tuningItem(id)!;

describe('滑条的格', () => {
  it('倍数档:八格,能关的九格(最左 0);官方在 ×1', () => {
    const odds = item('war.odds');
    expect(slotsOf(odds)).toEqual([0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]);
    expect(officialSlots(odds)).toEqual([3]);
    const split = item('split.odds');
    expect(slotsOf(split)).toEqual([0, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]);
    expect(officialSlots(split)).toEqual([4]);
    expect(edgeLabels(split)).toEqual(['不发生', '×4']);
    expect(edgeLabels(odds)).toEqual(['×¼', '×4']);
  });

  it('数值:最小到最大按步长,能关的最左多「关」、有永不的最右多「永不」;两头的字', () => {
    const truce = item('war.truce');
    const s = slotsOf(truce);
    expect(s.length).toBe(61);
    expect(s[0]).toBe(0);
    expect(s[60]).toBe(60);
    expect(officialSlots(truce)).toEqual([5]);
    expect(edgeLabels(truce)).toEqual(['0', '60']);
    const crush = item('war.crush');
    const c = slotsOf(crush);
    expect(c[0]).toBe(1.5);
    expect(c[c.length - 2]).toBe(10);
    expect(c[c.length - 1]).toBe('never');
    expect(edgeLabels(crush)).toEqual(['1.5', '永不']);
    const winter = item('war.winter');
    const w = slotsOf(winter);
    expect(w[0]).toBe('off');
    expect(w[1]).toBe(-10);
    expect(edgeLabels(winter)).toEqual(['关', '15°']);
    expect(w[officialSlots(winter)[0]]).toBe(3);
    // 几成写成 0–10,百分比带 %
    expect(edgeLabels(item('realm.republic'))).toEqual(['0', '10']);
    expect(edgeLabels(item('disaster.plagueLoss'))).toEqual(['1%', '50%']);
  });

  it('每一格的值读进来清理时原样留着(和 tuning.ts 吸到的档一模一样);官方那一格就是官方值', () => {
    for (const x of TUNING_ITEMS) {
      const slots = slotsOf(x);
      expect(new Set(slots).size, x.id).toBe(slots.length);
      for (let i = 0; i < slots.length; i++) {
        const v = valueAt(x, x.kind === 'range' ? [i, i] : [i], slots);
        const c = cleanTuning({ [x.id]: v });
        expect(c.notes, `${x.id} 第 ${i} 格`).toEqual([]);
        // 和官方一样的不写;别的原样
        if (JSON.stringify(v) === JSON.stringify(officialValue(x))) expect(c.values[x.id]).toBeUndefined();
        else expect(c.values[x.id], `${x.id} 第 ${i} 格`).toEqual(v);
        expect(tuningValueText(x, v).length).toBeGreaterThan(0);
      }
      // 没改 = 把手在官方那一格
      expect(thumbsOf(x, officialValue(x), slots), x.id).toEqual(officialSlots(x, slots));
      expect(valueAt(x, officialSlots(x, slots), slots), x.id).toEqual(officialValue(x));
    }
  });

  it('值落在哪一格:对不上的取最近的;永不 / 关在两头', () => {
    const truce = item('war.truce');
    const s = slotsOf(truce);
    expect(slotIndex(s, 2)).toBe(2);
    expect(slotIndex(s, 2.4)).toBe(2);
    expect(slotIndex(s, 99)).toBe(60);
    expect(slotIndex(slotsOf(item('war.crush')), 'never')).toBe(slotsOf(item('war.crush')).length - 1);
    expect(slotIndex(slotsOf(item('war.winter')), 'off')).toBe(0);
    expect(thumbsOf(item('war.length'), [3, 20])).toEqual([2, 19]);
  });

  it('位置和格互换;点在哪离哪格近', () => {
    const s = slotsOf(item('war.odds'));
    expect(slotFrac(s, 0)).toBe(0);
    expect(slotFrac(s, 7)).toBe(1);
    expect(nearestSlot(s, 0.5)).toBe(4);
    expect(nearestSlot(s, -1)).toBe(0);
    expect(nearestSlot(s, 2)).toBe(7);
    expect(nearestSlot(s, slotFrac(s, 5) + 0.02)).toBe(5);
  });

  it('区间:挪离点的近的那个把手,叠在一起时看往哪边;键盘挪一格不交叉;值的先后对调好', () => {
    expect(pickThumb([4, 17], 3)).toBe(0);
    expect(pickThumb([4, 17], 15)).toBe(1);
    expect(pickThumb([6, 6], 2)).toBe(0);
    expect(pickThumb([6, 6], 9)).toBe(1);
    expect(pickThumb([3], 9)).toBe(0);
    expect(stepThumb([4, 5], 0, 1, 60)).toEqual([5, 5]);
    expect(stepThumb([5, 5], 0, 1, 60)).toEqual([5, 5]);
    expect(stepThumb([5, 5], 1, -1, 60)).toEqual([5, 5]);
    expect(stepThumb([0, 5], 0, -1, 60)).toEqual([0, 5]);
    expect(stepThumb([3], 0, 100, 8)).toEqual([7]);
    expect(valueAt(item('war.length'), [10, 3])).toEqual([4, 11]);
  });

  it('涂色:倍数、数值从官方涂到现在(没改不涂);区间涂两个把手中间', () => {
    const odds = item('war.odds');
    const s = slotsOf(odds);
    expect(fillSpan(odds, [3])).toBeNull();
    expect(fillSpan(odds, [5])).toEqual([slotFrac(s, 3), slotFrac(s, 5)]);
    expect(fillSpan(odds, [0])).toEqual([0, slotFrac(s, 3)]);
    const len = item('war.length');
    const ls = slotsOf(len);
    expect(fillSpan(len, [4, 17])).toEqual([slotFrac(ls, 4), slotFrac(ls, 17)]);
    // 「官方」写在官方那一格;区间写在两格中间
    expect(officialLabelAt(odds)).toBe(slotFrac(s, 3));
    expect(officialLabelAt(len)).toBeCloseTo((slotFrac(ls, 4) + slotFrac(ls, 17)) / 2, 9);
  });

  it('刻度:格少的每格一个,多的七个平均摆开', () => {
    expect(ticksOf(slotsOf(item('war.odds'))).length).toBe(8);
    expect(ticksOf(slotsOf(item('war.fronts')))).toEqual([0, 1 / 3, 2 / 3, 1]);
    const t = ticksOf(slotsOf(item('war.truce')));
    expect(t.length).toBe(7);
    expect(t[0]).toBe(0);
    expect(t[6]).toBe(1);
  });
});

describe('改过的、搜规则、改了几项', () => {
  const values = cleanTuning({ 'war.odds': 2, 'war.truce': 2, 'war.sack': 2, 'split.collapse': 2, 'split.dynasty': 1.5, 'diplo.marry': 0 }).values;

  it('一组分常用的和其余的(战争:常用 5 项,更多 6 项;页面上拿掉的不列)', () => {
    const g = groupItems('war');
    expect(g.common.map((x) => x.id)).toEqual(['war.odds', 'war.truce', 'war.length', 'war.crush', 'war.project']);
    expect(g.more.map((x) => x.id)).toEqual(['war.capital', 'war.prey', 'war.winter', 'war.sack', 'war.ruin', 'war.rebuild']);
    // 页面上一共 56 项:常用 28,「更多」28
    const all = TUNING_GROUPS.map((x) => groupItems(x.id));
    expect(all.reduce((a, x) => a + x.common.length, 0)).toBe(28);
    expect(all.reduce((a, x) => a + x.more.length, 0)).toBe(28);
  });

  it('页面上拿掉的项:不进分组、搜不到;调过的在「只看改过的」另列(列过的改回了也接着列),算在改了几项里', () => {
    const v = cleanTuning({ ...values, 'war.rest': 0, 'war.grudge': 200, 'war.fronts': 3 }).values;
    expect(modifiedSections(v).flatMap((s) => s.items.map((x) => x.id))).not.toContain('war.rest');
    expect(retiredModified(v).map((x) => x.id)).toEqual(['war.rest', 'war.fronts', 'war.grudge']);
    expect(modifiedCount({ values: v })).toEqual({ items: 9, biomes: 0, total: 9, retired: 3 });
    expect(searchRules('记仇', {}).sections).toEqual([]);
    expect(searchRules('歇几年', {}).sections.flatMap((s) => s.items.map((x) => x.id))).toEqual([]);
    // 改回了官方:列过的接着列
    const kept = keepModified(new Set<string>(), { values: v });
    const after = cleanTuning({ ...v, 'war.grudge': 80 }).values;
    expect(retiredModified(after, keepModified(kept, { values: after })).map((x) => x.id)).toEqual(['war.rest', 'war.fronts', 'war.grudge']);
    expect(retiredModified(after).map((x) => x.id)).toEqual(['war.rest', 'war.fronts']);
    // 说明:并掉的写并进了哪一项,拿掉的写原来的说明加一句
    expect(retiredText(tuningItem('war.rest')!)).toBe('并进了「议和后几年不再开战」。这里记的数照旧起作用，盖过那一项带着改的这一处。');
    expect(retiredText(tuningItem('war.grudge')!)).toBe('议和时丢了州的一方，这么多年内更想打回来。效果太小，页面上拿掉了。');
    // 摘要:页面上拿掉的排在最后
    expect(rulesLine({ name: 'x', version: 1, values: cleanTuning({ 'war.grudge': 200, 'war.capital': 3 }).values }, false)).toBe('改了 2 项：守国都 3 倍、记仇 200 年');
    // 全部改回官方:连它们
    expect(resetToOfficial({ values: v }).change).toEqual({ values: {} });
  });

  it('只看改过的:按七组的先后,组里常用的在前;没改的组不列', () => {
    const sec = modifiedSections(values);
    expect(sec.map((s) => s.name)).toEqual(['战争', '分与合', '邦交']);
    expect(sec[0].items.map((x) => x.id)).toEqual(['war.odds', 'war.truce', 'war.sack']);
    expect(sec[2].items.map((x) => x.id)).toEqual(['diplo.marry']);
    expect(modifiedSections({})).toEqual([]);
    expect(cnCount(3)).toBe('三');
    expect(cnCount(2)).toBe('两');
  });

  it('只看改过的:列过的改回了官方也接着列(拖滑条路过官方那一格不丢那一行),离开这一页清掉', () => {
    const kept = new Set<string>();
    keepModified(kept, { values, biomes: { steppe: '马场' } });
    // 战争多少拖回了 ×1、草原的叫法清空了:还在
    const after = cleanTuning({ ...values, 'war.odds': 1 }).values;
    const keep = keepModified(kept, { values: after, biomes: {} });
    expect(modifiedSections(after, keep)[0].items.map((x) => x.id)).toEqual(['war.odds', 'war.truce', 'war.sack']);
    expect(renamedBiomes({ biomes: {} }, keep)).toEqual([Biome.Steppe]);
    expect(modifiedSections(after)[0].items.map((x) => x.id)).toEqual(['war.truce', 'war.sack']);
    kept.clear();
    expect(modifiedSections(after, keepModified(kept, { values: after }))[0].items.map((x) => x.id)).toEqual(['war.truce', 'war.sack']);
  });

  it('改了几项:规则项 + 地貌的叫法;改过叫法的地貌照总表的先后', () => {
    const r = { values, biomes: { rainforest: '瘴林', temperateDesert: '灰烬荒原' } };
    expect(modifiedCount(r)).toEqual({ items: 6, biomes: 2, total: 8, retired: 0 });
    expect(renamedBiomes(r)).toEqual([Biome.TemperateDesert, Biome.Rainforest]);
    expect(modifiedCount({ values: {} })).toEqual({ items: 0, biomes: 0, total: 0, retired: 0 });
  });

  it('搜规则:名字、说明、摘要里的叫法都算,按组列;地貌按官方的和起的名字;搜不到是空的', () => {
    const r = searchRules('瘟疫', {});
    const ids = r.sections.flatMap((s) => s.items.map((x) => x.id));
    expect(ids).toEqual(expect.arrayContaining(['disaster.plague', 'disaster.plagueLoss', 'disaster.spread', 'disaster.great']));
    // 说明里提到瘟疫的(民变:饥荒、瘟疫、苛政之下……)也算,排在自己的组里
    expect(r.sections.map((s) => s.group)).toContain('split');
    expect(r.biomes).toEqual([]);
    // 不分空格
    expect(searchRules(' 王朝 寿命 ', {}).sections.flatMap((s) => s.items.map((x) => x.id))).toEqual(['split.dynastyAge']);
    expect(searchRules('雨林', {}).biomes).toEqual([Biome.TemperateRainforest, Biome.TropicalDryForest, Biome.Rainforest]);
    expect(searchRules('瘴林', { biomes: { rainforest: '瘴林' } }).biomes).toEqual([Biome.Rainforest]);
    // 正在改搜到的那个叫法、改得不再含搜的字:列过的接着列
    expect(searchRules('瘴林', { biomes: { rainforest: '瘴' } }).biomes).toEqual([]);
    expect(searchRules('瘴林', { biomes: { rainforest: '瘴' } }, new Set([Biome.Rainforest])).biomes).toEqual([Biome.Rainforest]);
    expect(searchRules('没有这种规则', {})).toEqual({ sections: [], biomes: [] });
    expect(searchRules('   ', {})).toEqual({ sections: [], biomes: [] });
  });

  it('「我的规则」一行的小字:出处 + 改了什么(最多列四项)', () => {
    expect(rulesLine({ name: '战乱年代', version: 1, values }, false)).toBe('改了 6 项：战争 ×2、议和后 2 年不再开战、大崩解 ×2、改朝换代 ×1.5……');
    const shared = { name: '群雄并起', version: 1, basedOn: [{ name: '群雄并起', by: '砚山', version: 1 }], values: cleanTuning({ 'split.odds': 3 }).values };
    expect(rulesLine(shared, true)).toBe('砚山 分享。改了 1 项：分裂 ×3');
    expect(rulesLine({ ...shared, basedOn: [{ name: '战乱年代', version: 2 }] }, false)).toBe('基于《战乱年代》。改了 1 项：分裂 ×3');
    expect(rulesLine({ name: '新的', version: 1, values: {} }, false)).toBe('还没改，和官方规则一样');
    expect(rulesLine({ name: '新的', version: 1, values: {}, biomes: { steppe: '马场' } }, false)).toBe('改了地貌的名字 1 项');
  });

  it('每一项都有能用的滑条(格数 ≥ 2)', () => {
    const bad = TUNING_ITEMS.filter((x: TuningItem) => slotsOf(x).length < 2);
    expect(bad).toEqual([]);
  });
});

describe('全部改回官方', () => {
  it('只改回规则项,地貌的名字不动;撤销放回原来的规则项', async () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) });
    vi.resetModules();
    const m = await import('../src/ui/rulesStore');
    const id = m.createRules('战乱年代')!;
    m.setRuleValue(id, 'war.odds', 2);
    m.setRuleValue(id, 'diplo.marry', 0);
    m.setBiomeName(id, 'rainforest', '瘴林');
    const before = m.findMyRules(id)!.rules;
    const { change, undo } = resetToOfficial(before);
    expect(change).toEqual({ values: {} });
    expect(m.editRules(id, change)).toBe(true);
    expect(m.findMyRules(id)!.rules.values).toEqual({});
    expect(m.findMyRules(id)!.rules.biomes).toEqual({ rainforest: '瘴林' });
    expect(m.editRules(id, undo)).toBe(true);
    expect(m.findMyRules(id)!.rules.values).toEqual({ 'war.odds': 2, 'diplo.marry': 0 });
    expect(m.findMyRules(id)!.rules.biomes).toEqual({ rainforest: '瘴林' });
    // 只改了地貌的名字:没有可改回的(按钮不出,改了也不变)
    const only = m.createRules('只起了名字')!;
    m.setBiomeName(only, 'steppe', '马场');
    expect(m.editRules(only, resetToOfficial(m.findMyRules(only)!.rules).change)).toBe(false);
  });
});

describe('入口开关和认链接、认文件', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  });
  const fresh = async () => {
    vi.resetModules();
    vi.stubGlobal('location', { search: '', hash: '' });
    return import('../src/ui/rules/sheetStore');
  };
  const R = { name: '群雄并起', version: 1, by: '砚山', values: { 'split.odds': 3 } };

  it('入口开着:认规则链接、规则文件,打开大卡;世界的存档、别的链接不认', async () => {
    const { RULES_UI, rulesUiOn } = await import('../src/ui/rules/flag');
    expect(RULES_UI).toBe(true);
    expect(rulesUiOn()).toBe(true);
    const m = await fresh();
    expect(m.openRulesHash('#preset=1&name=x')).toBe(false);
    expect(m.openRulesHash(rulesHash(R))).toBe(true);
    expect(m.getRulesSheet()).toMatchObject({ kind: 'link' });
    expect(m.openRulesText(JSON.stringify({ app: '文明与地图', seed: 7, params: {}, rules: { name: 'x' } }))).toBe(false);
    expect(m.openRulesText('不是 JSON')).toBe(false);
    expect(m.openRulesText(`﻿${rulesFileText(R)}`, '群雄并起.json')).toBe(true);
    expect(m.getRulesSheet()).toMatchObject({ kind: 'file', fileName: '群雄并起.json' });
    m.closeRulesSheet();
    expect(m.getRulesSheet()).toBeNull();
  });

  it('「用它新建世界」:首页、主程序挂上做事的那一步才进得去;拿掉以后不做', async () => {
    const m = await fresh();
    expect(m.newWorldWithRules(R)).toBe(false);
    const got: unknown[] = [];
    m.setNewWorldHandler((r) => got.push(r));
    expect(m.newWorldWithRules(R)).toBe(true);
    expect(got).toEqual([R]);
    m.setNewWorldHandler(null);
    expect(m.newWorldWithRules(R)).toBe(false);
  });
});

/**
 * 本机的「我的规则」(ui/rulesStore.ts):新建、复制一份(出处跟着走)、改值改名、删、加进别人分享来的(另起本机编号、出处记下);
 * 第几版(被世界用过以后再改才加一)、用它建过几个世界、世界里的和本机的对上;最多几套;存的东西坏了也能读、浏览器不让存时只在这一页
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleSet } from '../src/gen/civ/ruleSet';
import { decodeRulesHash, rulesHash } from '../src/gen/civ/ruleShare';

const KEY = 'wenming-ditu:rules';
let store: Record<string, string>;

async function fresh() {
  vi.resetModules();
  return import('../src/ui/rulesStore');
}

beforeEach(() => {
  store = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  });
});

const SHARED: RuleSet = { name: '群雄并起', version: 3, by: '砚山', about: '分裂多、复国多', values: { 'split.odds': 3, 'split.restore': 2 }, biomes: { steppe: '马场' } };

describe('我的规则', () => {
  it('新建(从官方开始)、改值、改名、删;存进浏览器', async () => {
    const m = await fresh();
    const id = m.createRules('战乱年代')!;
    expect(id).toMatch(/^[a-z0-9]{4,24}$/);
    const e = m.findMyRules(id)!;
    expect(e.rules).toEqual({ id, name: '战乱年代', version: 1, values: {} });
    expect(e).toMatchObject({ used: false, worlds: 0 });
    expect(m.setRuleValue(id, 'war.odds', 2)).toBe(true);
    expect(m.setRuleValue(id, 'war.truce', 2)).toBe(true);
    // 和现在一样:不改
    expect(m.setRuleValue(id, 'war.odds', 2)).toBe(false);
    // 改回官方 = 去掉这一项
    expect(m.setRuleValue(id, 'war.truce', 5)).toBe(true);
    expect(m.findMyRules(id)!.rules.values).toEqual({ 'war.odds': 2 });
    expect(m.setRuleValue(id, 'war.odds', undefined)).toBe(true);
    expect(m.findMyRules(id)!.rules.values).toEqual({});
    // 不在档上的值清理过才存
    m.setRuleValue(id, 'war.odds', 5);
    expect(m.findMyRules(id)!.rules.values).toEqual({ 'war.odds': 4 });
    expect(m.setBiomeName(id, 'temperateDesert', '灰烬荒原')).toBe(true);
    expect(m.findMyRules(id)!.rules.biomes).toEqual({ temperateDesert: '灰烬荒原' });
    expect(m.setBiomeName(id, 'temperateDesert', '')).toBe(true);
    expect(m.findMyRules(id)!.rules.biomes).toBeUndefined();
    expect(m.renameRules(id, '  乱世  ')).toBe(true);
    expect(m.findMyRules(id)!.rules.name).toBe('乱世');
    expect(m.editRules(id, { by: '明月', about: '仗多' })).toBe(true);
    expect(m.findMyRules(id)!.rules).toMatchObject({ by: '明月', about: '仗多' });
    // 没被世界用过:改来改去都还是第 1 版
    expect(m.findMyRules(id)!.rules.version).toBe(1);
    expect(JSON.parse(store[KEY]).list[0].rules).toEqual(m.findMyRules(id)!.rules);
    // 刷新以后读回来一样
    const m2 = await fresh();
    expect(m2.getMyRules()).toEqual(m.getMyRules());
    m2.deleteRules(id);
    expect(m2.getMyRules()).toEqual([]);
    expect(JSON.parse(store[KEY]).list).toEqual([]);
    expect(m2.editRules('nope', { name: 'x' })).toBe(false);
  });

  it('改不了的:本机编号、第几版、基于谁', async () => {
    const m = await fresh();
    const id = m.addSharedRules(SHARED)!;
    const before = m.findMyRules(id)!.rules;
    expect(m.editRules(id, { name: '新名', id: 'rhack', version: 99, basedOn: [] } as never)).toBe(true);
    const after = m.findMyRules(id)!.rules;
    expect(after).toEqual({ ...before, name: '新名' });
  });

  it('复制一份:基于它(出处记在最前面),从第 1 版起;复制官方规则的基于官方', async () => {
    const m = await fresh();
    const a = m.createRules('战乱年代')!;
    m.setRuleValue(a, 'war.odds', 2);
    m.editRules(a, { by: '明月' });
    const b = m.copyRules(a, '战乱年代 二')!;
    expect(b).not.toBe(a);
    expect(m.findMyRules(b)!.rules).toEqual({ id: b, name: '战乱年代 二', version: 1, basedOn: [{ name: '战乱年代', by: '明月', version: 1 }], values: { 'war.odds': 2 } });
    const o = m.copyRules(null, '我的官方')!;
    expect(m.findMyRules(o)!.rules).toEqual({ id: o, name: '我的官方', version: 1, values: {} });
    expect(m.copyRules('nope')).toBeNull();
    // 新的排在前面
    expect(m.getMyRules().map((e) => e.rules.id)).toEqual([o, b, a]);
  });

  it('加进别人分享来的:另起本机编号,分享的那一套记在基于谁里;署名空着(是自己的了)', async () => {
    const m = await fresh();
    const link = decodeRulesHash(rulesHash({ ...SHARED, id: 'rsharerid' }));
    expect(link.ok).toBe(true);
    if (!link.ok) return;
    const id = m.addSharedRules(link.rules)!;
    expect(id).not.toBe('rsharerid');
    const e = m.findMyRules(id)!;
    expect(e.shared).toBe(true);
    expect(e.rules).toEqual({
      id,
      name: '群雄并起',
      version: 1,
      about: '分裂多、复国多',
      basedOn: [{ name: '群雄并起', by: '砚山', version: 3 }],
      values: { 'split.odds': 3, 'split.restore': 2 },
      biomes: { steppe: '马场' },
    });
    // 同一套加两次是两套
    expect(m.addSharedRules(link.rules)).not.toBe(id);
    expect(m.getMyRules()).toHaveLength(2);
  });

  it('第几版:用它建了世界以后再改,版本加一;用过的世界存的还是那一版。用它建过几个世界数得出来;世界里的和本机的对得上', async () => {
    const m = await fresh();
    const id = m.createRules('战乱年代')!;
    m.setRuleValue(id, 'war.odds', 2);
    const v1 = m.findMyRules(id)!.rules;
    // 建了一个世界:世界里存的是这一套(带本机编号)
    const world1: RuleSet = JSON.parse(JSON.stringify(v1));
    m.noteRulesUsed(world1);
    expect(m.findMyRules(id)).toMatchObject({ used: true, worlds: 1 });
    expect(m.myRulesFor(world1)).toMatchObject({ newer: false });
    // 又建了一个:还是第 1 版
    m.noteRulesUsed(world1);
    expect(m.findMyRules(id)).toMatchObject({ used: true, worlds: 2 });
    expect(m.findMyRules(id)!.rules.version).toBe(1);
    // 用过以后改:第 2 版(还没用过),再改还是第 2 版
    m.setRuleValue(id, 'war.truce', 2);
    expect(m.findMyRules(id)).toMatchObject({ used: false, worlds: 2 });
    expect(m.findMyRules(id)!.rules.version).toBe(2);
    m.setRuleValue(id, 'war.truce', 3);
    expect(m.findMyRules(id)!.rules.version).toBe(2);
    // 世界里的还是第 1 版:「战乱年代 第 1 版(我的规则里已是第 2 版)」
    expect(world1.version).toBe(1);
    const mine = m.myRulesFor(world1)!;
    expect(mine.newer).toBe(true);
    expect(mine.mine.rules.version).toBe(2);
    // 改名也算改
    m.noteRulesUsed(JSON.parse(JSON.stringify(m.findMyRules(id)!.rules)));
    m.renameRules(id, '乱世');
    expect(m.findMyRules(id)!.rules).toMatchObject({ name: '乱世', version: 3 });
    expect(m.findMyRules(id)!.worlds).toBe(3);
    // 不是本机的(别的浏览器的编号、没有编号)、删掉了的:对不上,不记
    m.noteRulesUsed({ ...world1, id: 'rotherbrowser' });
    m.noteRulesUsed({ ...world1, id: undefined });
    expect(m.findMyRules(id)!.worlds).toBe(3);
    expect(m.myRulesFor({ ...world1, id: 'rotherbrowser' })).toBeNull();
    m.deleteRules(id);
    expect(m.myRulesFor(world1)).toBeNull();
  });

  it('选好规则以后、建世界之前又改了本机的那一套(没被用过、还是同一版):建好的世界存的是改之前的,本机的另起一版', async () => {
    const m = await fresh();
    const id = m.createRules('战乱年代')!;
    m.setRuleValue(id, 'war.odds', 2);
    const picked: RuleSet = JSON.parse(JSON.stringify(m.findMyRules(id)!.rules));
    m.setRuleValue(id, 'war.odds', 3);
    expect(m.findMyRules(id)!.rules.version).toBe(1);
    m.noteRulesUsed(picked);
    expect(m.findMyRules(id)).toMatchObject({ used: false, worlds: 1 });
    expect(m.findMyRules(id)!.rules).toMatchObject({ version: 2, values: { 'war.odds': 3 } });
    expect(m.myRulesFor(picked)!.newer).toBe(true);
  });

  it('最多 MAX_MY_RULES 套:满了新建、复制、加进来都不成,不删别的', async () => {
    const m = await fresh();
    for (let i = 0; i < m.MAX_MY_RULES; i++) expect(m.createRules(`第${i}套`)).not.toBeNull();
    const first = m.getMyRules()[0].rules.id;
    expect(m.createRules('多一套')).toBeNull();
    expect(m.copyRules(first)).toBeNull();
    expect(m.addSharedRules(SHARED)).toBeNull();
    expect(m.getMyRules()).toHaveLength(m.MAX_MY_RULES);
  });

  it('存的东西坏了也能读:坏的那套跳过、编号重复的只留一个、规则项照样清理', async () => {
    store[KEY] = JSON.stringify({
      list: [
        { rules: { id: 'raaaa', name: '好的', version: 2, values: { 'war.odds': 9 } }, used: true, worlds: 3, at: 5 },
        { rules: { id: 'raaaa', name: '重复的', version: 1, values: {} } },
        { rules: { name: '没编号', version: 1, values: {} } },
        { rules: 'x' },
        null,
        { rules: { id: 'rbbbb', name: '计数坏了', version: 1, values: {} }, used: 'yes', worlds: -2, at: 'x', shared: true },
      ],
    });
    const m = await fresh();
    expect(m.getMyRules()).toEqual([
      { rules: { id: 'raaaa', name: '好的', version: 2, values: { 'war.odds': 4 } }, used: true, worlds: 3, at: 5 },
      { rules: { id: 'rbbbb', name: '计数坏了', version: 1, values: {} }, used: false, worlds: 0, shared: true, at: 0 },
    ]);
    store[KEY] = '{oops';
    expect((await fresh()).getMyRules()).toEqual([]);
  });

  it('浏览器不让存(隐私模式):只在这一页里有效,不出错', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    });
    const m = await fresh();
    const id = m.createRules('临时的')!;
    expect(m.findMyRules(id)!.rules.name).toBe('临时的');
  });
});

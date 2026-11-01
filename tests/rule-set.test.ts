/**
 * 一套规则(gen/civ/ruleSet.ts)和它的分享链接、文件(gen/civ/ruleShare.ts):
 * 字段、清理(认不出的丢、超长的截、坏的按默认,每处一句提示)、「和官方一样」、复制时出处一路往下传、地貌的键;
 * 链接、文件往返逐字段相等;折了行、转义过的照样读;坏的、来自更新版本的给中文错误;70 项全改 + 16 种地貌都改名时链接多长
 */
import { describe, expect, it } from 'vitest';
import { BIOMES, Biome } from '../src/gen/biomes';
import {
  BIOME_KEYS,
  BIOME_NAME_MAX,
  RULES_ABOUT_MAX,
  RULES_LINEAGE_MAX,
  RULES_NAME_MAX,
  UNNAMED_RULES,
  biomeKey,
  biomeOfKey,
  cleanRuleSet,
  isOfficialRules,
  ruleNotesLine,
  trimLineage,
  worldRules,
  worldTuning,
  type RuleSet,
} from '../src/gen/civ/ruleSet';
import { basedOnText, biomeName, deriveRuleSet, newRuleSet, ruleSetLabel, sameRuleContent } from '../src/gen/civ/ruleSetEdit';
import { RULES_LINK_BROKEN, decodeRulesHash, isRulesHash, parseRulesFile, rulesFileName, rulesFileText, rulesHash } from '../src/gen/civ/ruleShare';
import { TUNING_ITEMS, tuningEnds, type TuningValues } from '../src/gen/civ/tuning';
import { PRESET_NAME_MAX } from '../src/ui/presetLink';
import { SIGNATURE_MAX, parseSave } from '../src/gen/savefile';

const WAR: RuleSet = {
  name: '战乱年代',
  version: 2,
  by: '明月',
  about: '仗多，易代快',
  basedOn: [{ name: '群雄并起', by: '砚山', version: 1 }],
  values: { 'war.odds': 2, 'war.truce': 2, 'war.length': [3, 20], 'war.crush': 'never', 'split.collapse': 0, 'war.winter': 'off' },
  biomes: { temperateDesert: '灰烬荒原', ocean: '无尽之海' },
};

/** 每一项都改到最右(倍数 ×4、数值最大或永不、区间都取最大) */
const ALL_RIGHT: TuningValues = Object.fromEntries(TUNING_ITEMS.map((x) => [x.id, tuningEnds(x)[1]]));
/** 每一项都改到最左 */
const ALL_LEFT: TuningValues = Object.fromEntries(TUNING_ITEMS.map((x) => [x.id, tuningEnds(x)[0]]));
const han = (n: number, c = '漢') => c.repeat(n);

describe('一套规则的数据', () => {
  it('清理过的一套原样留着:字段照固定的先后,本机编号像样的留着', () => {
    const r = cleanRuleSet({ ...WAR, id: 'rmh3k2x9a4f' });
    expect(r.notes).toEqual([]);
    expect(r.rules).toEqual({ id: 'rmh3k2x9a4f', ...WAR, biomes: { ocean: '无尽之海', temperateDesert: '灰烬荒原' } });
    expect(Object.keys(r.rules!)).toEqual(['id', 'name', 'version', 'by', 'about', 'basedOn', 'values', 'biomes']);
    // 地貌照地貌总表的先后排
    expect(Object.keys(r.rules!.biomes!)).toEqual(['ocean', 'temperateDesert']);
  });

  it('没有 = null、不提示;不是一套规则的样子 = null、提示一句', () => {
    expect(cleanRuleSet(undefined)).toEqual({ rules: null, notes: [] });
    expect(cleanRuleSet(null)).toEqual({ rules: null, notes: [] });
    for (const bad of [1, 'x', [], true]) {
      const r = cleanRuleSet(bad);
      expect(r.rules).toBeNull();
      expect(r.notes).toEqual(['规则认不出，按官方规则算']);
    }
  });

  it('坏的按默认、超长的截、认不出的丢,每处一句中文提示', () => {
    const r = cleanRuleSet({
      id: 'BAD ID!',
      name: han(30),
      version: 'x',
      by: han(25, '署'),
      about: han(70, '介'),
      basedOn: [{ name: '甲', version: 0 }, 'x', { name: '', by: '乙' }],
      values: { 'war.odds': 5, 'war.truce': 999, 'no.such': 1, 'war.length': [30, 3] },
      biomes: { temperateDesert: han(20, '灰'), mars: '火星', taiga: 3, steppe: '草原', lake: '' },
      extra: 1,
    });
    const x = r.rules!;
    expect(x.id).toBeUndefined();
    expect([...x.name].length).toBe(RULES_NAME_MAX);
    expect(x.version).toBe(1);
    expect([...x.by!].length).toBe(SIGNATURE_MAX);
    expect([...x.about!].length).toBe(RULES_ABOUT_MAX);
    expect(x.basedOn).toEqual([{ name: '甲', version: 1 }]);
    expect(x.values).toEqual({ 'war.odds': 4, 'war.truce': 60, 'war.length': [3, 30] });
    // 和官方叫法一样的、空的不写
    expect(x.biomes).toEqual({ temperateDesert: han(BIOME_NAME_MAX, '灰') });
    expect(r.notes).toEqual([
      `规则的名字太长，只留前 ${RULES_NAME_MAX} 个字`,
      '规则是第几版认不出，按第 1 版算',
      `规则的署名太长，只留前 ${SIGNATURE_MAX} 个字`,
      `规则的介绍太长，只留前 ${RULES_ABOUT_MAX} 个字`,
      '规则的出处里有一层认不出，略过',
      '规则的出处里有一层没有名字，略过',
      '「no.such」不是能调的项，略过',
      '「战争多少」×5 不在档位上，按 ×4 算',
      '「议和后几年不再开战」999 年超出范围（0–60 年），按 60 年算',
      '「一场仗最多打几年」前一个数比后一个大，已对调',
      `「温带荒漠」的叫法太长，只留前 ${BIOME_NAME_MAX} 个字`,
      '「mars」不是认得的地貌，略过',
      '「针叶林」的叫法认不出，照旧叫「针叶林」',
    ]);
    // 读档提示条上并成一句
    expect(ruleNotesLine(r.notes)).toBe(`规则里有 ${r.notes.length} 处读不懂或超出了现在的范围，已按能读的读（${r.notes[0]}……）`);
    expect(ruleNotesLine(['「战争多少」×5 不在档位上，按 ×4 算'])).toBe('规则：「战争多少」×5 不在档位上，按 ×4 算');
    expect(ruleNotesLine([])).toBeNull();
  });

  it('名字去掉看不见的字符、并掉空白;没有名字叫「未命名规则」;第几版带小数的取整、太大的拉回来', () => {
    expect(cleanRuleSet({ name: '  战乱​\n年代‮ ', values: {} }).rules!.name).toBe('战乱 年代');
    expect(cleanRuleSet({ values: {} }).rules!.name).toBe(UNNAMED_RULES);
    expect(cleanRuleSet({ name: '   ', values: {} }).rules!.name).toBe(UNNAMED_RULES);
    const v = cleanRuleSet({ name: 'a', version: 2.6, values: {} });
    expect(v.rules!.version).toBe(3);
    expect(v.notes).toEqual(['规则是第几版不对，按第 3 版算']);
    expect(cleanRuleSet({ name: 'a', version: 1e9, values: {} }).rules!.version).toBe(99999);
  });

  it('名字和新建世界的预设名一样长,署名和分享世界的署名一样长', () => {
    expect(RULES_NAME_MAX).toBe(PRESET_NAME_MAX);
    // 组合表情算一个字
    expect(cleanRuleSet({ name: '👩‍💻'.repeat(30), values: {} }).rules!.name).toBe('👩‍💻'.repeat(RULES_NAME_MAX));
  });

  it('和官方一样 = 没改规则项、也没改地貌的叫法(名字、署名、介绍、出处不算)', () => {
    expect(isOfficialRules(undefined)).toBe(true);
    expect(isOfficialRules(newRuleSet('空的'))).toBe(true);
    expect(isOfficialRules({ ...newRuleSet('x'), by: '明月', about: '什么也没改', basedOn: [{ name: 'y', version: 3 }] })).toBe(true);
    expect(isOfficialRules({ ...newRuleSet('x'), values: { 'war.odds': 2 } })).toBe(false);
    expect(isOfficialRules({ ...newRuleSet('x'), biomes: { ocean: '无尽之海' } })).toBe(false);
    // 改回官方值的项清理时去掉,也算官方
    expect(worldRules({ name: 'x', version: 1, values: { 'war.odds': 1 } })).toBeUndefined();
    expect(worldRules({ name: 'x', version: 1, values: {}, biomes: { ocean: '海洋' } })).toBeUndefined();
    expect(worldRules(WAR)).toEqual(cleanRuleSet(WAR).rules);
    // 推演只看规则项:只改了地貌叫法的,推演照官方
    expect(worldTuning({ ...newRuleSet('x'), biomes: { ocean: '无尽之海' } })).toBeUndefined();
    expect(worldTuning(WAR)).toEqual({ values: cleanRuleSet(WAR).rules!.values, calc: 1 });
    expect(worldTuning(undefined)).toBeUndefined();
  });

  it('复制一份:出处记在最前面、一路往下传;从第 1 版起,署名空着,规则项、地貌叫法、介绍照搬;太长的留最近几层和最早的那层', () => {
    const d = deriveRuleSet({ ...WAR, id: 'rabcd' }, '战乱年代 二');
    expect(d).toEqual({
      name: '战乱年代 二',
      version: 1,
      about: WAR.about,
      basedOn: [{ name: '战乱年代', by: '明月', version: 2 }, ...WAR.basedOn!],
      values: cleanRuleSet(WAR).rules!.values,
      biomes: cleanRuleSet(WAR).rules!.biomes,
    });
    expect(basedOnText(d)).toBe('基于 明月 的《战乱年代》');
    expect(basedOnText(WAR)).toBe('基于 砚山 的《群雄并起》');
    expect(basedOnText(newRuleSet('x'))).toBe('基于官方规则');
    expect(basedOnText({ basedOn: [{ name: '无名氏的', version: 1 }] })).toBe('基于《无名氏的》');
    expect(ruleSetLabel(WAR)).toBe('战乱年代（第 2 版）');
    // 一代代复制下去:最早的那层一直在
    let r: RuleSet = { name: '始', version: 7, by: '祖', values: { 'war.odds': 2 } };
    for (let i = 1; i <= 8; i++) r = { ...deriveRuleSet(r, `第${i}代`), by: `作者${i}` };
    expect(r.basedOn!.length).toBe(RULES_LINEAGE_MAX);
    expect(r.basedOn!.map((s) => s.name)).toEqual(['第7代', '第6代', '第5代', '始']);
    expect(r.basedOn![3]).toEqual({ name: '始', by: '祖', version: 7 });
    expect(r.values).toEqual({ 'war.odds': 2 });
    expect(trimLineage([1, 2, 3, 4, 5, 6].map((n) => ({ name: `${n}`, version: 1 }))).map((s) => s.name)).toEqual(['1', '2', '3', '6']);
  });

  it('内容一样(本机编号不算)', () => {
    expect(sameRuleContent({ ...WAR, id: 'raaaa' }, { ...WAR, id: 'rbbbb' })).toBe(true);
    expect(sameRuleContent(WAR, { ...WAR, version: 3 })).toBe(false);
    expect(sameRuleContent(WAR, { ...WAR, name: '乱世' })).toBe(false);
  });
});

describe('地貌的键', () => {
  it('十六种地貌各有一个键:不重复、照英文名起、和编号无关', () => {
    expect(BIOMES.length).toBe(16);
    expect(BIOME_KEYS.length).toBe(BIOMES.length);
    expect(new Set(BIOME_KEYS).size).toBe(BIOMES.length);
    for (const b of BIOMES) {
      const k = biomeKey(b.id);
      expect(k, b.name).toMatch(/^[a-z][a-zA-Z]+$/);
      expect(biomeOfKey(k)).toBe(b.id);
    }
    // 定了不改:存档、链接、文件里存的就是这几个字
    expect(biomeKey(Biome.TemperateDesert)).toBe('temperateDesert');
    expect(biomeKey(Biome.Wetland)).toBe('wetland');
    expect(biomeOfKey('nope')).toBeUndefined();
  });

  it('一种地貌叫什么:另起了名字的叫新名字,没起的叫官方的', () => {
    expect(biomeName(WAR, Biome.TemperateDesert)).toBe('灰烬荒原');
    expect(biomeName(WAR, Biome.Steppe)).toBe('草原');
    expect(biomeName(null, Biome.Ocean)).toBe('海洋');
  });
});

describe('分享链接', () => {
  const samples: RuleSet[] = [
    WAR,
    newRuleSet('只起了个名字'),
    { name: 'A & B = 50% #1 + 北境', version: 12, values: ALL_LEFT },
    { name: '全拉满', version: 1, by: 'Moon 月', values: ALL_RIGHT, biomes: Object.fromEntries(BIOME_KEYS.map((k, i) => [k, `地貌${i}`])) },
  ];
  for (const r of samples) {
    it(`「${r.name}」读回来逐字段相等(本机编号不带)`, () => {
      const hash = rulesHash({ ...r, id: 'rmh3k2x9a4f' });
      expect(hash.startsWith('#rules=1&name=')).toBe(true);
      expect(hash).not.toContain('rmh3k2x9a4f');
      expect(isRulesHash(hash)).toBe(true);
      const back = decodeRulesHash(hash);
      expect(back).toEqual({ ok: true, rules: cleanRuleSet(r).rules, warnings: [] });
    });
  }

  it('写法:规则项的键就是编号,区间写成「前-后」,永不、关原样,地貌写 biome.<键>,出处 base1、base1.by、base1.v', () => {
    const q = new URLSearchParams(rulesHash(WAR).slice(1));
    expect(q.get('rules')).toBe('1');
    expect(q.get('name')).toBe('战乱年代');
    expect(q.get('v')).toBe('2');
    expect(q.get('by')).toBe('明月');
    expect(q.get('war.odds')).toBe('2');
    expect(q.get('war.length')).toBe('3-20');
    expect(q.get('war.crush')).toBe('never');
    expect(q.get('war.winter')).toBe('off');
    expect(q.get('split.collapse')).toBe('0');
    expect(q.get('biome.temperateDesert')).toBe('灰烬荒原');
    expect([q.get('base1'), q.get('base1.by'), q.get('base1.v')]).toEqual(['群雄并起', '砚山', '1']);
    // 冬天不出兵最左是 −10°C 的数(不是区间)
    const neg = decodeRulesHash(rulesHash({ name: 'x', version: 1, values: { 'war.winter': -10 } }));
    expect(neg.ok && neg.rules.values).toEqual({ 'war.winter': -10 });
  });

  it('折了行、转义过的照样读;不带 # 的也认', () => {
    const hash = rulesHash(WAR);
    const folded = hash.replace(/(.{40})/g, '$1\n  ');
    expect(decodeRulesHash(folded)).toEqual(decodeRulesHash(hash));
    expect(decodeRulesHash(hash.slice(1))).toEqual(decodeRulesHash(hash));
  });

  it('个别项不对照样读,附提示;认不出的键(以后加的写法)不管', () => {
    const r = decodeRulesHash('#rules=1&name=乱&war.odds=5&war.truce=abc&war.length=9-2&no.such=1&biome.mars=火星&future=1&base2=远祖&base2.v=3');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rules.values).toEqual({ 'war.odds': 4, 'war.length': [2, 9] });
    expect(r.rules.basedOn).toEqual([{ name: '远祖', version: 3 }]);
    expect(r.rules.biomes).toBeUndefined();
    expect(r.warnings).toEqual([
      '「no.such」不是能调的项，略过',
      '「战争多少」×5 不在档位上，按 ×4 算',
      '「议和后几年不再开战」的值认不出，按官方算',
      '「一场仗最多打几年」前一个数比后一个大，已对调',
      '「mars」不是认得的地貌，略过',
    ]);
  });

  it('不是规则链接、少了一截、来自更新的版本:给中文错误', () => {
    expect(decodeRulesHash('#preset=1&name=x')).toEqual({ ok: false, error: '链接里没有规则' });
    expect(decodeRulesHash('#rules=&name=x')).toEqual({ ok: false, error: RULES_LINK_BROKEN });
    expect(decodeRulesHash('#rules=1&name=%E6%88%98%E')).toEqual({ ok: false, error: RULES_LINK_BROKEN });
    const newer = decodeRulesHash('#rules=2&name=x');
    expect(newer.ok).toBe(false);
    expect(!newer.ok && newer.error).toContain('刷新页面');
    expect(decodeRulesHash(`#rules=1&name=${'x'.repeat(20000)}`).ok).toBe(false);
  });

  it('70 项全改、16 种地貌都改名:链接多长', () => {
    const site = 'https://atlas.gerdor.top/';
    // 平常的样子:名字四个字,地貌各起四个字的名字
    const usual: RuleSet = { name: '战乱年代', version: 3, by: '明月', values: ALL_RIGHT, biomes: Object.fromEntries(BIOME_KEYS.map((k) => [k, '灰烬荒原'])) };
    // 都写满:名字、署名、介绍、四层出处、十六种地貌的叫法都到上限(都是汉字,每个转义成 9 个字)
    const full: RuleSet = {
      name: han(RULES_NAME_MAX),
      version: 99999,
      by: han(SIGNATURE_MAX),
      about: han(RULES_ABOUT_MAX),
      basedOn: Array.from({ length: RULES_LINEAGE_MAX }, () => ({ name: han(RULES_NAME_MAX), by: han(SIGNATURE_MAX), version: 99999 })),
      values: ALL_RIGHT,
      biomes: Object.fromEntries(BIOME_KEYS.map((k) => [k, han(BIOME_NAME_MAX)])),
    };
    const a = (site + rulesHash(usual)).length;
    const b = (site + rulesHash(full)).length;
    expect(a).toBeLessThan(3000);
    expect(b).toBeLessThan(16384);
    expect(decodeRulesHash(rulesHash(full))).toEqual({ ok: true, rules: cleanRuleSet(full).rules, warnings: [] });
  });
});

describe('文件', () => {
  it('存成 .json:写明是什么、写法版本;读回来逐字段相等(本机编号不带)', () => {
    const text = rulesFileText({ ...WAR, id: 'rmh3k2x9a4f' }, '2026-10-31T08:00:00.000Z');
    const raw = JSON.parse(text) as Record<string, unknown>;
    expect(raw.app).toBe('文明与地图');
    expect(raw.rules).toBe(1);
    expect(raw.savedAt).toBe('2026-10-31T08:00:00.000Z');
    expect(raw.id).toBeUndefined();
    expect(Object.keys(raw)).toEqual(['app', 'rules', 'savedAt', 'name', 'version', 'by', 'about', 'basedOn', 'values', 'biomes']);
    expect(parseRulesFile(text)).toEqual({ ok: true, rules: cleanRuleSet(WAR).rules, warnings: [] });
    // 开头带 BOM 的也认
    expect(parseRulesFile('﻿' + text).ok).toBe(true);
    expect(rulesFileName(WAR)).toBe('文明与地图-规则-战乱年代.json');
    expect(rulesFileName({ name: 'a/b:c*?' })).toBe('文明与地图-规则-abc.json');
  });

  it('个别项不对照样读,附提示;手改进去的本机编号不要', () => {
    const r = parseRulesFile(JSON.stringify({ app: '文明与地图', rules: 1, id: 'rzzzz', name: '乱', version: 1, values: { 'war.odds': 9 } }));
    expect(r).toEqual({ ok: true, rules: { name: '乱', version: 1, values: { 'war.odds': 4 } }, warnings: ['「战争多少」×9 不在档位上，按 ×4 算'] });
  });

  it('读不了的给中文错误:空的、不是 JSON、别的应用、世界存档、缺格式版本、来自更新版本', () => {
    expect(parseRulesFile('')).toEqual({ ok: false, error: '文件是空的' });
    expect(parseRulesFile('{oops')).toMatchObject({ ok: false });
    expect(parseRulesFile(JSON.stringify({ app: 'x', rules: 1 }))).toEqual({ ok: false, error: '这不是「文明与地图」的规则文件' });
    expect(parseRulesFile(JSON.stringify({ app: '文明与地图', format: 1, seed: 7, params: {}, edits: {} }))).toEqual({ ok: false, error: '这个文件是世界的存档,不是一套规则' });
    expect(parseRulesFile(JSON.stringify({ app: '文明与地图', rules: 'x' }))).toEqual({ ok: false, error: '规则文件坏了:缺少格式版本' });
    const newer = parseRulesFile(JSON.stringify({ app: '文明与地图', rules: 2, name: 'x', values: {} }));
    expect(!newer.ok && newer.error).toContain('刷新页面');
  });

  it('当成世界存档打开规则文件:说清是一套规则(不说"存档坏了")', () => {
    expect(parseSave(rulesFileText(WAR))).toEqual({ ok: false, error: '这个文件是一套规则，不是世界的存档' });
  });
});

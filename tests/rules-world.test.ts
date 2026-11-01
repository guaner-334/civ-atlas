/**
 * 世界里存整套规则(gen/savefile.ts 的 edits.rules,格式 3)、一路传到推演:
 * - 官方规则的世界:存档逐字一样、格式号一样(1 / 2),原件的配方指纹一样
 * - 带规则的世界:写格式 3;存了再读、分享链接打开、云存档取回(存档的 JSON 原样往返)、接着推,
 *   推出来的历史和直接用这套规则推的一位不差(同一张地图、同一个文明种子)
 * - 读档过清理、提示并成一句;改了几处、换成别处的存档丢了几处,规则整套算一处
 * - 新建、换种子、打造新文明、撤销,规则都跟着走;新建界面里先按官方推,创建以后按世界自己的
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv } from '../src/gen/civ';
import { EMPTY_EDITS, newHistoryEdits, playState, type WorldEdits } from '../src/gen/edits';
import { SAVE_FORMAT, decodeShare, editCount, editsLost, encodeShare, makeSave, parseSave, saveText } from '../src/gen/savefile';
import { recipeOfSave, recipeText } from '../src/gen/snapshot';
import { cleanRuleSet, type RuleSet } from '../src/gen/civ/ruleSet';
import { newRuleSet } from '../src/gen/civ/ruleSetEdit';
import { tuningPatch, worldPatch } from '../src/gen/civ/tuningPatch';
import { WARS_KNOBS } from '../src/gen/civ/wars';
import { sameSetup, setupFor, setupOpt, yearsEdits } from '../src/ui/world/worldTarget';
import { revertEdits } from '../src/ui/editsStore';

const f64 = new Float64Array(1);
const f64b = new Uint8Array(f64.buffer);
/** 一个值的指纹(同 determinism.test.ts):类型化数组逐字节,数按 64 位原样,对象按键名排序 */
function print(v: unknown): string {
  const h = createHash('sha1');
  const feed = (x: unknown): void => {
    if (x === null || x === undefined) return void h.update(`~${x}`);
    if (ArrayBuffer.isView(x)) {
      h.update(`<${x.constructor.name}:${x.byteLength}>`);
      return void h.update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
    }
    if (Array.isArray(x)) {
      h.update(`[${x.length}`);
      x.forEach(feed);
      return void h.update(']');
    }
    if (typeof x === 'object') {
      for (const k of Object.keys(x as object).sort()) {
        h.update(`.${k}`);
        feed((x as Record<string, unknown>)[k]);
      }
      return;
    }
    if (typeof x === 'number') {
      f64[0] = x;
      h.update('n');
      return void h.update(f64b);
    }
    h.update(`${typeof x}:${String(x)}`);
  };
  feed(v);
  return h.digest('hex').slice(0, 16);
}

const PARAMS = { ...DEFAULT_PARAMS, cells: 12000, seed: 7 };
let world: World | undefined;
const W = () => (world ??= generateWorld(PARAMS));

/** 改了几项的一套规则(带本机编号,和本机「我的规则」里的一样) */
const RULES: RuleSet = {
  id: 'rmh3k2x9a4f',
  name: '战乱年代',
  version: 2,
  by: '明月',
  basedOn: [{ name: '群雄并起', by: '砚山', version: 1 }],
  values: { 'war.odds': 2, 'war.length': [3, 20], 'war.crush': 'never', 'split.dynasty': 1.5, 'court.reign': 30 },
  biomes: { temperateDesert: '灰烬荒原' },
};
const CIV_SEED = 52817;
const END = 1500;

/** 一个用了规则的世界的修改:文明种子、推演年数、几处改名 */
const EDITS: WorldEdits = { ...EMPTY_EDITS, names: { 'region:c812': '九嶷州' }, civSeed: CIV_SEED, endYear: END, rules: RULES };

/**
 * 照这份修改推这个世界(和网页里一样:建好的世界 setupFor → 推文明的请求里带的那几项(setupOpt)→ 后台线程把规则项换成旋钮)
 */
function push(edits: WorldEdits, endYear = END) {
  const s = setupOpt(setupFor(false, edits));
  const knobs = worldPatch(s.tuning);
  return generateCiv(W(), { endYear, ...(s.civSeed !== undefined ? { civSeed: s.civSeed } : {}), ...(knobs ? { knobs } : {}) });
}

describe('官方规则的世界:存档和以前一字不差', () => {
  const base: WorldEdits = { ...EMPTY_EDITS, names: { 'region:c812': '九嶷州' }, calamity: 'more', civSeed: 12 };
  const SAVED_AT = '2026-10-31T08:00:00.000Z';
  it('没有规则、和官方一样的规则(空的、只起了名字、改回官方值的):写出来一模一样,格式 1', () => {
    const plain = saveText(makeSave(PARAMS, base, 'abc', '九州', SAVED_AT));
    for (const rules of [newRuleSet('空的'), { ...newRuleSet('x'), by: '明月', about: '没改' }, { name: 'x', version: 4, values: { 'war.odds': 1 } }, { name: 'x', version: 1, values: {}, biomes: { ocean: '海洋' } }]) {
      const s = makeSave(PARAMS, { ...base, rules: rules as RuleSet }, 'abc', '九州', SAVED_AT);
      expect(saveText(s)).toBe(plain);
      expect(s.format).toBe(1);
    }
    expect(plain).not.toContain('"rules"');
    // 年中的时刻照旧写 2
    const tick = { ...base, endTick: 64, rules: newRuleSet('空的') };
    expect(makeSave(PARAMS, tick, 'abc').format).toBe(2);
    expect(saveText(makeSave(PARAMS, tick, 'abc', undefined, SAVED_AT))).toBe(saveText(makeSave(PARAMS, { ...base, endTick: 64 }, 'abc', undefined, SAVED_AT)));
  });

  it('原件的配方指纹不变(只改了地貌叫法的也一样:推演照官方)', () => {
    const plain = recipeText(recipeOfSave(makeSave(PARAMS, base, 'abc')));
    expect(plain).not.toContain('tuning');
    const biomeOnly = makeSave(PARAMS, { ...base, rules: { ...newRuleSet('只改叫法'), biomes: { ocean: '无尽之海' } } }, 'abc');
    expect(biomeOnly.format).toBe(3);
    expect(recipeText(recipeOfSave(biomeOnly))).toBe(plain);
    expect(recipeText(recipeOfSave(makeSave(PARAMS, { ...base, rules: RULES }, 'abc')))).not.toBe(plain);
  });

  it('推文明的请求里不带规则(和以前一样)', () => {
    expect(setupOpt(setupFor(false, base))).toEqual({ civSeed: 12, calamity: 'more' });
    expect(setupOpt(setupFor(false, { ...base, rules: newRuleSet('空的') }))).toEqual({ civSeed: 12, calamity: 'more' });
  });
});

describe('带规则的世界', () => {
  it('存档写格式 3,整套规则原样存下(带本机编号);读回来一模一样、没有提示', () => {
    const save = makeSave(PARAMS, EDITS, 'abc', '乱世', '2026-10-31T08:00:00.000Z');
    expect(save.format).toBe(3);
    expect(SAVE_FORMAT).toBe(4);
    expect(save.edits.rules).toEqual(cleanRuleSet(RULES).rules);
    // 存的是一份复制,之后改原来的不影响存档
    expect(save.edits.rules).not.toBe(RULES);
    const text = saveText(save);
    const r = parseSave(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toEqual([]);
    expect(r.save).toEqual(save);
    expect(saveText(r.save)).toBe(text);
    // 年中的时刻也有:还是 3
    expect(makeSave(PARAMS, { ...EDITS, endTick: 64 }, 'abc').format).toBe(3);
  });

  it('读档过清理:超出范围的拉回来、认不出的丢掉,提示并成一句;清理完和官方一样的不留', () => {
    const save = makeSave(PARAMS, EDITS, 'abc');
    const raw = JSON.parse(saveText(save)) as { edits: { rules: Record<string, unknown> } };
    raw.edits.rules.values = { 'war.odds': 9, 'war.truce': 500, 'no.such': 2 };
    const r = parseSave(JSON.stringify(raw));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.edits.rules!.values).toEqual({ 'war.odds': 4, 'war.truce': 60 });
    expect(r.warnings).toEqual(['规则里有 3 处读不懂或超出了现在的范围，已按能读的读（「no.such」不是能调的项，略过……）']);
    // 只剩官方值:不留、格式回到 1
    raw.edits.rules = { name: 'x', version: 1, values: { 'war.odds': 1 } };
    const o = parseSave(JSON.stringify(raw));
    expect(o.ok && o.save.edits.rules).toBeUndefined();
    expect(o.ok && o.save.format).toBe(1);
    // 不是一套规则的样子
    raw.edits.rules = 'x' as never;
    const b = parseSave(JSON.stringify(raw));
    expect(b.ok && b.warnings).toEqual(['规则：规则认不出，按官方规则算']);
  });

  it('改了几处:规则算一处;换成别处的存档丢了几处:规则整套算一处', () => {
    expect(editCount(EDITS)).toBe(editCount({ ...EDITS, rules: undefined }) + 1);
    const a = makeSave(PARAMS, EDITS, 'abc');
    const b = makeSave(PARAMS, { ...EDITS, rules: { ...RULES, values: { 'war.odds': 3 } } }, 'abc');
    const c = makeSave(PARAMS, { ...EDITS, rules: undefined }, 'abc');
    expect(editsLost(a, a)).toBe(0);
    expect(editsLost(a, b)).toBe(1);
    expect(editsLost(a, c)).toBe(1);
    expect(editsLost(c, a)).toBe(0);
  });

  /** 直接用这套规则推的(同一张地图、同一个文明种子) */
  let direct: string | undefined;
  const directPrint = () => (direct ??= print(generateCiv(W(), { endYear: END, civSeed: CIV_SEED, knobs: tuningPatch(cleanRuleSet(RULES).rules!.values, 1) })));
  const saved = () => makeSave(PARAMS, EDITS, 'abc', '乱世');

  it('按世界的修改推(新建、改了以后重推)、存了再读(文件、浏览器里的自动存档):和直接用这套规则推的一位不差', () => {
    const values = cleanRuleSet(RULES).rules!.values;
    // 规则真的改了历史(同一张地图、同一个文明种子按官方推的不一样);战争多少 ×2 换成的旋钮
    expect(print(generateCiv(W(), { endYear: END, civSeed: CIV_SEED }))).not.toBe(directPrint());
    expect(tuningPatch(values, 1)!.wars.WAR_ODDS).toBe(WARS_KNOBS.values.WAR_ODDS * 2);
    expect(print(push(EDITS))).toBe(directPrint());
    const read = parseSave(saveText(saved()));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(print(push(read.save.edits))).toBe(directPrint());
    // 原件的配方:带着规则项(和推的时候请求里带的一样)
    expect(recipeOfSave(read.save).tuning).toEqual(setupFor(false, read.save.edits)!.tuning!.values);
  });

  it('分享链接(#share=)打开、云存档取回(服务器原样存 JSON,取回来照样过 parseSave):一位不差', async () => {
    const save = saved();
    const shared = await decodeShare(await encodeShare(save));
    const cloud = parseSave(JSON.stringify(JSON.parse(JSON.stringify(save))));
    expect(shared.ok && cloud.ok).toBe(true);
    if (!shared.ok || !cloud.ok) return;
    expect(shared.save.edits.rules).toEqual(save.edits.rules);
    expect(cloud.save.edits.rules).toEqual(save.edits.rules);
    expect(print(push(shared.save.edits))).toBe(directPrint());
    expect(print(push(cloud.save.edits))).toBe(directPrint());
  }, 120_000);

  it('接着推(先推到第 800 年,再接着推到 1500 年):一位不差;不带旋钮的照历史带着的那套', () => {
    const w = W();
    const s = setupOpt(setupFor(false, EDITS));
    const half = generateCiv(w, { endYear: 800, civSeed: s.civSeed, knobs: worldPatch(s.tuning) });
    expect(print(continueCiv(w, half, { endYear: END, civSeed: s.civSeed, knobs: worldPatch(s.tuning) }))).toBe(directPrint());
    expect(print(continueCiv(w, half, { endYear: END, civSeed: s.civSeed }))).toBe(directPrint());
  });

  it('同一套规则 + 同一张地图、同一个文明种子 = 同一段历史(名字、署名、地貌叫法、本机编号不改历史)', () => {
    const a = directPrint();
    const renamed: RuleSet = { ...RULES, id: undefined, name: '乱世', by: undefined, biomes: undefined, version: 9 };
    expect(print(push({ ...EDITS, rules: renamed }))).toBe(a);
  });
});

describe('规则跟着世界走', () => {
  it('新建界面里先按官方推(只看星球),创建以后按世界自己的;规则变了 = 要重推', () => {
    expect(setupFor(true, EDITS)).toEqual({ civSeed: CIV_SEED });
    const made = setupFor(false, EDITS)!;
    expect(made.tuning).toEqual({ values: cleanRuleSet(RULES).rules!.values, calc: 1 });
    expect(sameSetup(made, setupFor(false, { ...EDITS, rules: undefined }))).toBe(false);
    expect(sameSetup(made, setupFor(false, { ...EDITS, rules: { ...RULES, name: '改个名' } }))).toBe(true);
    expect(sameSetup(made, setupFor(false, { ...EDITS, rules: { ...RULES, values: { ...RULES.values, 'war.odds': 3 } } }))).toBe(false);
  });

  it('新建世界的参数里带一套规则:进了新世界的修改(官方的不带)', () => {
    expect(yearsEdits(undefined, undefined, RULES)).toEqual({ ...EMPTY_EDITS, rules: cleanRuleSet(RULES).rules });
    expect(yearsEdits(6000, undefined, RULES).endYear).toBe(6000);
    expect(yearsEdits(undefined, undefined, newRuleSet('空的'))).toBe(EMPTY_EDITS);
  });

  it('在这张地图上打造新文明:规则跟着走(原来的国家、人物、干预不带)', () => {
    const e = newHistoryEdits({ ...EDITS, interventions: [] }, { civSeed: 99, from: 'wabc', rules: EDITS.rules });
    expect(e.rules).toEqual(EDITS.rules);
    expect(e.rules).not.toBe(EDITS.rules);
    expect(e.names).toEqual({});
    expect(newHistoryEdits(EDITS, { civSeed: 99, from: 'wabc' }).rules).toBeUndefined();
  });

  it('撤销别的修改时规则照现在的留着(不会悄悄变回官方)', () => {
    const iv = { kind: 'unity', a: 'polity:c1#0', from: 100 } as unknown as WorldEdits['interventions'][number];
    const before: WorldEdits = { ...EDITS, interventions: [] };
    const after: WorldEdits = { ...EDITS, interventions: [iv] };
    const undone = revertEdits(after, after, before);
    expect(undone.interventions).toEqual([]);
    expect(undone.rules).toBe(EDITS.rules);
  });

  it('逐年推演的世界带着规则:存档格式 3,进度原样存', () => {
    const e: WorldEdits = { ...EDITS, play: playState(900, 0, []) };
    const s = makeSave(PARAMS, e, 'abc');
    expect(s.format).toBe(3);
    const r = parseSave(saveText(s));
    expect(r.ok && r.save.edits.play).toEqual(playState(900, 0, []));
    expect(r.ok && r.save.edits.rules).toEqual(s.edits.rules);
  });
});

describe('换算版本(现在只有第 1 版;假装有第 2 版的见 rules-calc.test.ts)', () => {
  it('新建的世界盖上第 1 版 = 不写:存档、配方指纹和加换算版本以前一字不差', () => {
    const made = yearsEdits(undefined, undefined, RULES);
    expect(made.rules!.calc).toBeUndefined();
    expect(newHistoryEdits(EDITS, { civSeed: 99, from: 'wabc', rules: RULES }).rules!.calc).toBeUndefined();
    const s = makeSave(PARAMS, EDITS, 'abc');
    expect(s.format).toBe(3);
    expect(saveText(s)).not.toContain('"calc"');
    expect(recipeText(recipeOfSave(s))).not.toContain('calc');
  });

  it('别的版本存的、规则按第 2 版换算的世界:这一版推不出它的历史,不读(提示刷新)', () => {
    const raw = JSON.parse(saveText(makeSave(PARAMS, EDITS, 'abc'))) as { format: number; edits: { rules: Record<string, unknown> } };
    raw.format = 4;
    raw.edits.rules.calc = 2;
    const r = parseSave(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toBe('这个存档来自更新版本的「文明与地图」(规则换算第 2 版),请刷新页面换到最新版再打开');
  });
});

/**
 * 规则的换算版本(civ/tuning.ts 的 TUNING_CALC、civ/ruleSet.ts 的 RuleSet.calc):
 * 这里假装换算已经到了第 2 版(把 TUNING_CALC 换成 2,第 2 版的换算换成「第 1 版 + 看邻国勤一倍」),看:
 * - 没记换算版本的世界(加换算版本以前建的,第 1 版)走每一条推历史的路 —— 按世界的修改重推、存成文件 / 浏览器里的自动存档再读、
 *   分享链接、接着推、作品墙后台画封面、找世界、并排试推这个世界用的那一版 —— 都和直接按第 1 版推的逐字节一样;原件的配方指纹不变
 * - 新建的世界(新建弹窗、打造文明里选规则、在这张地图上打造新文明、用新版另存一份重推)盖上第 2 版,照第 2 版推;
 *   存档写格式 4,存了再读、分享链接打开照样是第 2 版;原件的配方带着版本
 * - 「我的规则」、分享规则的链接、规则文件里的一套不带换算版本;比较两套规则(改了几处、是不是同一套)时世界里的那一套连版本一起比
 * - 比现在新的换算版本不读(提示刷新);认不出的按第 1 版
 */
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/gen/civ/tuning', async (importOriginal) => ({ ...(await importOriginal<typeof import('../src/gen/civ/tuning')>()), TUNING_CALC: 2 }));
vi.mock('../src/gen/civ/tuningPatch', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/gen/civ/tuningPatch')>();
  /** 假的第 2 版:第 1 版换出来的旋钮,外加看邻国勤一倍 */
  const tuningPatch: typeof m.tuningPatch = (values, calc) => {
    if (calc !== 2) return m.tuningPatch(values, calc);
    const p = m.tuningPatch(values, 1);
    return p && { ...p, wars: { ...(p.wars ?? {}), CHECK_EVERY: 7.5 } };
  };
  const worldPatch: typeof m.worldPatch = (t) => (t ? tuningPatch(t.values, t.calc) : undefined);
  return { ...m, tuningPatch, worldPatch };
});

import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { EMPTY_EDITS, newHistoryEdits, type WorldEdits } from '../src/gen/edits';
import { SAVE_FORMAT, decodeShare, editCount, editsLost, encodeShare, makeSave, parseSave, saveText, type SaveFile } from '../src/gen/savefile';
import { recipeOfSave, recipeText } from '../src/gen/snapshot';
import { cleanRuleSet, latestTuning, newWorldRules, rulesTuning, sameRuleSet, stampCalc, worldCalc, worldRules, worldTuning, type RuleSet } from '../src/gen/civ/ruleSet';
import { TUNING_CALC } from '../src/gen/civ/tuning';
import { tuningPatch, worldPatch } from '../src/gen/civ/tuningPatch';
import { decodeRulesHash, rulesFileText, rulesHash } from '../src/gen/civ/ruleShare';
import { deriveRuleSet } from '../src/gen/civ/ruleSetEdit';
import { setupFor, setupOpt, yearsEdits } from '../src/ui/world/worldTarget';
import { getEdits, setEdits, setRules } from '../src/ui/editsStore';
import { helperJob } from '../src/ui/helperWork';
import { searchSeedWith } from '../src/gen/finder/measure';
import { growMessage, type GrowReply } from '../src/growThread';

/** 一个值的指纹(同 rules-world.test.ts):类型化数组逐字节,数按 64 位原样,对象按键名排序 */
function print(v: unknown): string {
  const h = createHash('sha1');
  const f64 = new Float64Array(1);
  const f64b = new Uint8Array(f64.buffer);
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

const RULES: RuleSet = { id: 'rmh3k2x9a4f', name: '战乱年代', version: 2, values: { 'war.odds': 2, 'war.truce': 2, 'split.dynasty': 1.5 } };
const VALUES = cleanRuleSet(RULES).rules!.values;
const CIV_SEED = 52817;
const END = 900;

/** 加换算版本以前建的世界:规则上没记版本(第 1 版) */
const OLD: WorldEdits = { ...EMPTY_EDITS, civSeed: CIV_SEED, endYear: END, rules: RULES };
/** 现在(第 2 版)新建的世界 */
const NEW: WorldEdits = { ...OLD, rules: newWorldRules(RULES) };

/** 直接照第几版推的(同一张地图、同一个文明种子) */
const direct = new Map<number, string>();
const directPrint = (calc: number) => {
  let p = direct.get(calc);
  if (!p) direct.set(calc, (p = print(generateCiv(W(), { endYear: END, civSeed: CIV_SEED, knobs: tuningPatch(VALUES, calc) }))));
  return p;
};

/** 照世界的修改推(建好的世界:setupFor → 推文明的请求里带的那几项 → 后台线程照记的那一版换成旋钮,同 worker.ts 的 setupOpt) */
function push(edits: WorldEdits, endYear = END): Civ {
  const s = setupOpt(setupFor(false, edits));
  const knobs = worldPatch(s.tuning);
  return generateCiv(W(), { endYear, ...(s.civSeed !== undefined ? { civSeed: s.civSeed } : {}), ...(knobs ? { knobs } : {}) });
}

const save = (e: WorldEdits): SaveFile => makeSave(PARAMS, e, 'abc', '乱世', '2026-11-01T08:00:00.000Z');

describe('假装换算到了第 2 版', () => {
  it('第 2 版和第 1 版换出来的旋钮不一样,推出来的历史也不一样(下面的比较才有意义)', () => {
    expect(TUNING_CALC).toBe(2);
    expect(tuningPatch(VALUES, 2)).not.toEqual(tuningPatch(VALUES, 1));
    expect(directPrint(2)).not.toBe(directPrint(1));
  }, 120_000);
});

describe('没记换算版本的世界(第 1 版):每一条推历史的路都和以前逐字节一样', () => {
  it('规则上没有换算版本 = 第 1 版;推演要的那部分带着第 1 版', () => {
    expect(worldCalc(OLD.rules)).toBe(1);
    expect(worldTuning(OLD.rules)).toEqual({ values: VALUES, calc: 1 });
    expect(setupFor(false, OLD)!.tuning).toEqual({ values: VALUES, calc: 1 });
  });

  it('按世界的修改推(打开、改了以后重推)', () => {
    expect(print(push(OLD))).toBe(directPrint(1));
  }, 120_000);

  it('存成文件 / 浏览器里的自动存档再读、分享链接打开:还是第 1 版、格式 3,一位不差', async () => {
    const s = save(OLD);
    expect(s.format).toBe(3);
    expect(s.edits.rules!.calc).toBeUndefined();
    expect(saveText(s)).not.toContain('"calc"');
    const read = parseSave(saveText(s));
    const shared = await decodeShare(await encodeShare(s));
    for (const r of [read, shared]) {
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.warnings).toEqual([]);
      expect(r.save.edits.rules!.calc).toBeUndefined();
      expect(print(push(r.save.edits))).toBe(directPrint(1));
    }
  }, 120_000);

  it('原件的配方指纹不变(不带换算版本)', () => {
    const r = recipeOfSave(save(OLD));
    expect(r.calc).toBeUndefined();
    expect(recipeText(r)).not.toContain('calc');
    expect(r.tuning).toEqual(VALUES);
  });

  it('接着推(推到第 400 年,再接着推到底;不带旋钮的照历史带着的那套)', () => {
    const s = setupOpt(setupFor(false, OLD));
    const half = generateCiv(W(), { endYear: 400, civSeed: CIV_SEED, knobs: worldPatch(s.tuning) });
    expect(print(continueCiv(W(), half, { endYear: END, civSeed: CIV_SEED, knobs: worldPatch(s.tuning) }))).toBe(directPrint(1));
    expect(print(continueCiv(W(), half, { endYear: END, civSeed: CIV_SEED }))).toBe(directPrint(1));
  }, 120_000);

  it('作品墙后台画封面:照世界记的第 1 版', () => {
    const job = helperJob({ id: 'x', kind: 'world', save: JSON.parse(saveText(save(OLD))) });
    expect(job.input.tuning).toEqual({ values: VALUES, calc: 1 });
    const c = generateCiv(W(), { endYear: job.input.endYear, civSeed: job.input.civSeed, knobs: worldPatch(job.input.tuning) });
    expect(print(c)).toBe(directPrint(1));
  }, 120_000);

  it('找世界:搜的时候照世界记的那一版换(第 1 版和第 2 版搜出来的历史不一样,各自和直接推的一样)', () => {
    const q = { roles: [], together: [] };
    const run = (calc: number) => searchSeedWith(q, { world: { ...DEFAULT_PARAMS, cells: 12000 }, civ: { endYear: 600 }, tuning: { values: VALUES, calc } }, 7);
    const a = run(1);
    const b = run(2);
    expect(a.report.error).toBeUndefined();
    expect(print(a.civ)).toBe(print(generateCiv(a.world!, { endYear: a.civ!.endYear, knobs: tuningPatch(VALUES, 1) })));
    expect(print(b.civ)).toBe(print(generateCiv(b.world!, { endYear: b.civ!.endYear, knobs: tuningPatch(VALUES, 2) })));
    expect(print(a.civ)).not.toBe(print(b.civ));
  }, 120_000);

  it('并排试推这个世界用的那一版:照世界记的第 1 版;本机的、别人分享的照最新的第 2 版', async () => {
    expect(rulesTuning(OLD.rules, true)).toEqual({ values: VALUES, calc: 1 });
    expect(rulesTuning(NEW.rules, true)).toEqual({ values: VALUES, calc: 2 });
    expect(rulesTuning(RULES, false)).toEqual({ values: VALUES, calc: 2 });
    expect(latestTuning(OLD.rules)).toEqual({ values: VALUES, calc: 2 });
    // 后台线程那一头照交来的版本推:推完的那份和直接照第 1 版推到 3000 年的一样
    const got: GrowReply[] = [];
    await growMessage({ grow: 'start', map: { params: PARAMS }, setup: {}, sides: [{ side: 0, key: 1, tuning: rulesTuning(OLD.rules, true) }] }, (r) => got.push(r));
    const last = got.filter((r): r is Extract<GrowReply, { grow: 'civ' }> => r.grow === 'civ').at(-1)!;
    expect(last.done).toBe(true);
    expect(print(last.civ)).toBe(print(generateCiv(W(), { knobs: tuningPatch(VALUES, 1) })));
  }, 300_000);
});

describe('新建的世界盖上现在的换算版本(第 2 版)', () => {
  it('新建弹窗带一套规则、打造文明里选规则、在这张地图上打造新文明、用新版另存一份重推:都是第 2 版', () => {
    expect(yearsEdits(undefined, undefined, RULES).rules!.calc).toBe(2);
    // 别的世界(第 1 版)的那一套拿来建新世界:也按现在的
    expect(yearsEdits(undefined, undefined, OLD.rules).rules!.calc).toBe(2);
    expect(newHistoryEdits(OLD, { civSeed: 99, from: 'wabc', rules: OLD.rules }).rules!.calc).toBe(2);
    expect(newHistoryEdits(OLD, { civSeed: 99, from: 'wabc', rules: RULES }).rules!.calc).toBe(2);
    setEdits(EMPTY_EDITS);
    setRules(RULES);
    expect(getEdits().rules!.calc).toBe(2);
    // 同一套再选一次:不变
    const before = getEdits();
    setRules(RULES);
    expect(getEdits()).toBe(before);
    setRules(undefined);
    expect(getEdits().rules).toBeUndefined();
  });

  it('照第 2 版推;存档写格式 4,存了再读、分享链接打开照样是第 2 版;原件的配方带着版本', async () => {
    expect(print(push(NEW))).toBe(directPrint(2));
    const s = save(NEW);
    expect(s.format).toBe(4);
    expect(SAVE_FORMAT).toBe(4);
    expect(s.edits.rules!.calc).toBe(2);
    const read = parseSave(saveText(s));
    const shared = await decodeShare(await encodeShare(s));
    for (const r of [read, shared]) {
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(r.warnings).toEqual([]);
      expect(r.save).toEqual(s);
      expect(print(push(r.save.edits))).toBe(directPrint(2));
    }
    const recipe = recipeOfSave(s);
    expect(recipe.calc).toBe(2);
    expect(recipeText(recipe)).not.toBe(recipeText(recipeOfSave(save(OLD))));
  }, 120_000);

  it('只改了地貌叫法的(推演照官方):换算版本不起作用,照旧写格式 3', () => {
    const biomeOnly = newWorldRules({ name: 'x', version: 1, values: {}, biomes: { ocean: '无尽之海' } })!;
    expect(biomeOnly.calc).toBe(2);
    expect(save({ ...EMPTY_EDITS, rules: biomeOnly }).format).toBe(3);
    expect(recipeOfSave(save({ ...EMPTY_EDITS, rules: biomeOnly })).calc).toBeUndefined();
  });
});

describe('换算版本只跟着世界走', () => {
  const stamped = stampCalc(cleanRuleSet(RULES).rules!);

  it('「我的规则」、分享规则的链接、规则文件、复制一份:不带换算版本', () => {
    expect(stamped.calc).toBe(2);
    expect(cleanRuleSet(stamped).rules!.calc).toBeUndefined();
    expect(worldRules(stamped)!.calc).toBe(2);
    const link = decodeRulesHash(rulesHash(stamped));
    expect(link.ok && link.rules.calc).toBeUndefined();
    expect(rulesFileText(stamped)).not.toContain('calc');
    expect(deriveRuleSet(stamped, '复制').calc).toBeUndefined();
  });

  it('比较:当成一套规则比不看换算版本;世界里的那一套连版本一起比;改了几处、换成别处丢了几处也算', () => {
    expect(sameRuleSet(stamped, RULES)).toBe(true);
    expect(sameRuleSet(stamped, RULES, true)).toBe(false);
    expect(editCount(NEW)).toBe(editCount(OLD));
    expect(editsLost(save(OLD), save(NEW))).toBe(1);
    expect(editsLost(save(NEW), save(NEW))).toBe(0);
  });

  it('读档:比现在新的换算版本不读(提示刷新);认不出的按第 1 版(提示一句)', () => {
    const raw = JSON.parse(saveText(save(NEW))) as { edits: { rules: Record<string, unknown> } };
    raw.edits.rules.calc = 3;
    const newer = parseSave(JSON.stringify(raw));
    expect(newer.ok).toBe(false);
    expect(!newer.ok && newer.error).toBe('这个存档来自更新版本的「文明与地图」(规则换算第 3 版),请刷新页面换到最新版再打开');
    raw.edits.rules.calc = 'x';
    const bad = parseSave(JSON.stringify(raw));
    expect(bad.ok).toBe(true);
    if (!bad.ok) return;
    expect(bad.save.edits.rules!.calc).toBeUndefined();
    expect(bad.warnings).toEqual(['规则：规则的换算版本认不出，按第 1 版算']);
    expect(bad.save.format).toBe(3);
  });
});

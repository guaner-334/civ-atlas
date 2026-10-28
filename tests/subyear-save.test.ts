/**
 * 停在年中的世界:存档、存回推演模式、再推 N 年(gen/savefile.ts、gen/stepwise.ts 的 stepwiseToNormal、
 * gen/edits.ts 文件头"推演年数"的 endTick、gen/civ/extend.ts),都按"年 + 第几格"接着走,不跳到下一年年初:
 * - 故事模式停在年中存档:读回来(格式 2,没有提示)按存档推出同一刻;接着一步步走,和接着原来那份走、和一口气推完都逐字段一样
 * - 存回推演模式:推到那一年的那一格(endYear + endTick);打开(从第 0 年推到那一格)和逐年推演到"现在"接着推一格一样;
 *   存档写格式 2、往返一样、配方指纹对得上;再推 N 年停在 N 年以后的同一格,和一口气推完逐字段一样
 * - 停在年初的和以前一字不差(存回的修改、存档文本、配方);旧存档照读
 * - 带小数的推演年数怎么清理、拆开、再推 N 年推到哪;读档时不合格的第几格
 * - 侧栏「最近大事」停在年中、看的是"现在"时列到停下的那一格
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { extendCiv } from '../src/gen/civ/extend';
import { playCiv, playStop, playTicks } from '../src/gen/civ/play';
import { filterChronicle } from '../src/gen/civ/chronicle';
import { fullChronicle } from '../src/gen/civ/religionText';
import {
  END_YEAR_MAX,
  YEAR_TICKS,
  cleanEndAt,
  cleanEndTick,
  cleanEndYear,
  commandsNow,
  endAtOf,
  endFields,
  endParamOf,
  extendedEndYear,
  playAt,
  playInterventions,
  writtenEndAt,
  type PlayState,
  type WorldEdits,
} from '../src/gen/edits';
import { editCount, makeSave, momentYearMax, parseSave, saveFormatOf, saveText, withMoment } from '../src/gen/savefile';
import { recipeOfSave, recipeText } from '../src/gen/snapshot';
import { stepwiseToNormal } from '../src/gen/stepwise';
import { countUpTo, recentUpTo } from '../src/ui/timelineLayout';
import { RUN_CELLS, orders, same, samePast, worldOf } from './lib/stepwiseRun';

const base: WorldEdits = { names: {}, interventions: [], terrain: [] };
const at = (y: number, k = 0) => y + k / YEAR_TICKS;

/** 存档往返(没有提示):读回来的修改、写下的格式、文本 */
function roundTrip(params: Parameters<typeof makeSave>[0], e: WorldEdits) {
  const text = saveText(makeSave(params, e, 'x'));
  const r = parseSave(text);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error('读不回来');
  expect(r.warnings).toEqual([]);
  return { save: r.save, edits: r.save.edits, format: (JSON.parse(text) as { format: number }).format, text };
}

describe('带小数的推演年数', () => {
  it('cleanEndAt:按格取整、夹回 1–60000,3000 年整不写;整数年和 cleanEndYear 一样', () => {
    for (const y of [1, 60, 1000, 2675, 3500, 12345, END_YEAR_MAX]) expect(cleanEndAt(y)).toBe(cleanEndYear(y));
    expect(cleanEndAt(3000)).toBeUndefined();
    expect(cleanEndAt(at(1638, 192))).toBe(1638.75);
    expect(cleanEndAt(at(3000, 1))).toBe(at(3000, 1));
    expect(cleanEndAt(1638.7)).toBe(at(1638, 179));
    expect(cleanEndAt(0)).toBe(1);
    expect(cleanEndAt(at(0, 40))).toBe(1);
    expect(cleanEndAt(99999.5)).toBe(END_YEAR_MAX);
    expect(cleanEndAt('1638')).toBeUndefined();
    expect(cleanEndAt(Number.NaN)).toBeUndefined();
  });

  it('第几格:1–255 的整数才记;推到 60000 年的不带;拆开、合起来对得上', () => {
    expect(cleanEndTick(128, 1638)).toBe(128);
    for (const v of [0, 256, -1, 1.5, '5', null, undefined]) expect(cleanEndTick(v, 1638), String(v)).toBeUndefined();
    expect(cleanEndTick(5, END_YEAR_MAX)).toBeUndefined();
    expect(endFields(at(1638, 192))).toEqual({ endYear: 1638, endTick: 192 });
    expect(endFields(1638)).toEqual({ endYear: 1638 });
    expect(endFields(3000)).toEqual({ endYear: 3000 });
    expect(endFields(Number.NaN)).toEqual({ endYear: 3000 });
    expect(endFields(at(END_YEAR_MAX, 9))).toEqual({ endYear: END_YEAR_MAX });
    expect(endAtOf({ endYear: 1638, endTick: 192 })).toBe(1638.75);
    expect(endAtOf({ endTick: 64 })).toBe(3000.25);
    expect(endAtOf({ endYear: END_YEAR_MAX, endTick: 5 })).toBe(END_YEAR_MAX);
    expect(endAtOf({ endYear: 1638, endTick: 999 })).toBe(1638);
    expect(endParamOf({})).toBeUndefined();
    expect(endParamOf({ endYear: 3000 })).toBeUndefined();
    expect(endParamOf({ endTick: 64 })).toBe(3000.25);
    expect(endParamOf({ endYear: 1638 })).toBe(1638);
    expect(writtenEndAt({})).toBeUndefined();
    expect(writtenEndAt({ endYear: 3000 })).toBe(3000);
    expect(writtenEndAt({ endYear: 1638, endTick: 192 })).toBe(1638.75);
    expect(writtenEndAt({ endTick: 64 })).toBe(3000.25);
    // 合起来再拆开,一格不差
    for (let k = 1; k < YEAR_TICKS; k += 17) expect(endFields(endAtOf({ endYear: 2675, endTick: k }))).toEqual({ endYear: 2675, endTick: k });
  });

  it('再推 N 年:停在 N 年以后的同一格;到 60000 年为止(差不到一整年就到头的也推到那一年);整数年和以前一样', () => {
    expect(extendedEndYear(at(1638, 192), 50)).toBe(at(1688, 192));
    expect(extendedEndYear(at(1638, 192), 0)).toBe(at(1639, 192));
    expect(extendedEndYear(at(1638, 192), Number.NaN)).toBe(at(1638, 192));
    expect(extendedEndYear(at(59999, 192), 1)).toBe(END_YEAR_MAX);
    expect(extendedEndYear(at(59000, 64), END_YEAR_MAX - at(59000, 64))).toBe(END_YEAR_MAX);
    expect(extendedEndYear(at(59000, 64), 999)).toBe(at(59999, 64));
    expect(extendedEndYear(3000, 500)).toBe(3500);
    expect(extendedEndYear(2675, 100)).toBe(2775);
    expect(extendedEndYear(59900, 1000)).toBe(END_YEAR_MAX);
  });
});

describe('存档里的推到哪一刻', () => {
  it('带第几格的写格式 2,往返一样;3000 年的只写第几格;不合格的第几格提示一句、按年初', () => {
    const P = { ...DEFAULT_PARAMS, seed: 7 };
    const r = roundTrip(P, { ...base, endYear: 1638, endTick: 192 });
    expect(r.format).toBe(2);
    expect(r.edits.endYear).toBe(1638);
    expect(r.edits.endTick).toBe(192);
    expect(saveFormatOf({ ...base, endTick: 3 })).toBe(2);
    const d = roundTrip(P, { ...base, endTick: 64 });
    expect(d.format).toBe(2);
    expect('endYear' in d.edits).toBe(false);
    expect(endAtOf(d.edits)).toBe(3000.25);
    expect(editCount({ ...base, endTick: 64 })).toBe(1);
    expect(editCount({ ...base, endYear: 3000 })).toBe(0);
    // 配方:推演时交给后台的推演年数(带小数)
    expect(recipeOfSave(r.save).endYear).toBe(1638.75);
    // 打开时看哪:能看到推到的那一刻
    expect(momentYearMax(r.edits)).toBe(1638.75);
    expect(withMoment(r.save, { year: 1638.5 }).moment).toEqual({ year: 1638.5 });
    // 不合格的第几格:提示,按那一年年初
    for (const bad of [256, 1.5, 'x', -3]) {
      const raw = JSON.parse(r.text) as { edits: Record<string, unknown> };
      raw.edits.endTick = bad;
      const p = parseSave(JSON.stringify(raw));
      expect(p.ok, String(bad)).toBe(true);
      if (!p.ok) continue;
      expect(p.save.edits.endTick).toBeUndefined();
      expect(p.save.edits.endYear).toBe(1638);
      expect(p.save.format).toBe(1);
      expect(p.warnings).toEqual(['推演到第 1638 年的哪一刻认不出来,按那一年年初推演']);
    }
  });

  it('推到年初的和以前一字不差:不写第几格、写格式 1、配方和以前一样;旧存档照读', () => {
    const P = { ...DEFAULT_PARAMS, seed: 7 };
    const r = roundTrip(P, { ...base, endYear: 2675 });
    expect(r.format).toBe(1);
    expect(r.text).not.toMatch(/endTick/);
    expect(JSON.parse(r.text).edits).toEqual({ names: {}, interventions: [], terrain: [], endYear: 2675 });
    expect(recipeText(recipeOfSave(r.save))).toBe(recipeText({ params: r.save.params, terrain: [], interventions: [], endYear: 2675 }));
    expect(momentYearMax(r.edits)).toBe(2675);
    // 旧存档(没有第几格)
    const old = JSON.parse(r.text) as Record<string, unknown>;
    const p = parseSave(JSON.stringify({ ...old, format: 1 }));
    expect(p.ok && p.save.edits).toEqual({ names: {}, interventions: [], terrain: [], endYear: 2675 });
    expect(p.ok && p.warnings).toEqual([]);
  });
});

describe('停在年中的世界存档、存回推演模式、再推 N 年', () => {
  const w = worldOf(7, RUN_CELLS);
  const P = w.params;
  // 从第 500 年年初起逐年推演,一步几个月,停在年中下令
  const start: PlayState = { year: 500, commands: [] };
  let cache: { s3: { civ: Civ; play: PlayState } } | null = null;
  const walk = () => {
    if (cache) return cache;
    const c0 = playCiv(w, {}, start);
    const s1 = playTicks(w, c0, {}, start, [], 86);
    expect(s1.play).toEqual({ year: 500, tick: 86, commands: [] });
    const s2 = playTicks(w, s1.civ, {}, s1.play, commandsNow(s1.play, orders(s1.civ, 500)), 300);
    expect(s2.rejected).toEqual([]);
    const s3 = playTicks(w, s2.civ, {}, s2.play, commandsNow(s2.play, orders(s2.civ, 501)), 200);
    expect(s3.rejected).toEqual([]);
    expect(s3.play.year).toBe(502);
    expect(s3.play.tick).toBe(74);
    expect(s3.play.commands.length).toBeGreaterThan(1);
    return (cache = { s3 });
  };

  it('故事模式停在年中存档:读回来推出同一刻;接着一步步走,和接着原来那份走、和一口气推完逐字段一样', () => {
    const { s3 } = walk();
    const e: WorldEdits = { ...base, play: s3.play, playFrom: 500, advance: { step: 1, unit: 'month' } };
    const r = roundTrip(P, e);
    expect(r.format).toBe(2);
    expect(r.edits.play).toEqual(s3.play);
    expect(r.edits.playFrom).toBe(500);
    // 打开:照存档从第 0 年推到那一刻(界面读档时就是这样推的)
    const loaded = playCiv(w, {}, r.edits.play!);
    same(loaded, s3.civ, '读回来推出的那一刻');
    // 接着走:在"现在"那一格下令,再走一季、再走到下一年的同一格
    const cmds = commandsNow(r.edits.play!, orders(loaded, 502));
    const a1 = playTicks(w, loaded, {}, r.edits.play!, cmds, 64);
    const b1 = playTicks(w, s3.civ, {}, s3.play, cmds, 64);
    expect(a1.rejected).toEqual([]);
    expect(a1.play).toEqual(b1.play);
    same(a1.civ, b1.civ, '读档后走一季');
    const a2 = playTicks(w, a1.civ, {}, a1.play, [], YEAR_TICKS);
    same(a2.civ, playTicks(w, b1.civ, {}, b1.play, [], YEAR_TICKS).civ, '再走一年');
    expect(a2.play.year).toBe(503);
    expect(a2.play.tick).toBe(138);
    // 一口气推完:带着同样的命令从第 0 年推到同一刻
    same(a2.civ, generateCiv(w, { interventions: [...playInterventions([], a2.play)], endYear: playStop(a2.play.year, a2.play.tick) }), '一口气推完');
  }, 300_000);

  it('存回推演模式:推到那一年的那一格;打开和逐年推演到"现在"再推一格一样;存档格式 2;再推 N 年停在同一格、和一口气推完一样', async () => {
    const { s3 } = walk();
    const e: WorldEdits = { ...base, play: s3.play, playFrom: 500 };
    const normal = stepwiseToNormal(e)!;
    expect(normal.endYear).toBe(502);
    expect(normal.endTick).toBe(74);
    expect(normal.play).toBeUndefined();
    expect(normal.interventions).toEqual(s3.play.commands);
    const end = endParamOf(normal)!;
    expect(end).toBe(at(502, 74));
    expect(end).toBe(playAt(s3.play) / YEAR_TICKS);
    // 打开:从第 0 年推到那一格;停下以前的事和逐年推演一模一样,多的只是那一格的事
    const opened = generateCiv(w, { interventions: normal.interventions, endYear: end });
    expect(opened.endYear).toBe(end);
    samePast(opened, s3.civ, end, '存回以后打开');
    same(continueCiv(w, s3.civ, { interventions: normal.interventions, endYear: end }), opened, '逐年推演接着推一格');
    // 存档:格式 2,往返一样;配方里的推演年数和推这个世界时交给后台的一样
    const r = roundTrip(P, normal);
    expect(r.format).toBe(2);
    expect(r.edits.endYear).toBe(502);
    expect(r.edits.endTick).toBe(74);
    expect(r.edits.interventions).toEqual(normal.interventions);
    expect(recipeOfSave(r.save).endYear).toBe(end);
    same(generateCiv(w, { interventions: r.edits.interventions, endYear: endParamOf(r.edits) }), opened, '读档以后推出来的');
    // 再推 30 年:停在第 532 年的同一格,和一口气推到那一格一样
    const to = extendedEndYear(opened.endYear, 30);
    expect(to).toBe(at(532, 74));
    expect(endFields(to)).toEqual({ endYear: 532, endTick: 74 });
    const more = await extendCiv(w, opened, { interventions: normal.interventions, endYear: to });
    same(more!, generateCiv(w, { interventions: normal.interventions, endYear: to }), '再推 30 年');
    // 再推以后存档、读回,还是那一格
    const r2 = roundTrip(P, { ...normal, ...endFields(to) });
    expect(endParamOf(r2.edits)).toBe(to);
  }, 300_000);

  it('停在年初的存回和以前一字不差:推到那一年、不带第几格、存档格式 1', () => {
    const play: PlayState = { year: 520, commands: [{ kind: 'protect', a: 'polity:c1#0', from: 510 }] };
    const e: WorldEdits = { ...base, interventions: [{ kind: 'protect', a: 'polity:c9#0', from: 300 }], play, playFrom: 500 };
    const normal = stepwiseToNormal(e)!;
    const { play: _p, playFrom: _f, ...rest } = e;
    expect(JSON.stringify(normal)).toBe(JSON.stringify({ ...rest, interventions: [...e.interventions, ...play.commands], endYear: 520 }));
    expect(roundTrip(P, normal).format).toBe(1);
    // 停在第 0 年(年初、年中)存回的推到第 1 年;停在最后一年年中的存不回
    expect(stepwiseToNormal({ ...base, play: { year: 0, commands: [] } })!.endYear).toBe(1);
    expect(stepwiseToNormal({ ...base, play: { year: 0, tick: 30, commands: [] } })).toEqual({ ...base, endYear: 1 });
    expect(stepwiseToNormal({ ...base, play: { year: END_YEAR_MAX, commands: [] } })).toEqual({ ...base, endYear: END_YEAR_MAX });
    expect(stepwiseToNormal({ ...base, play: { year: END_YEAR_MAX, tick: 1, commands: [] } })).toBeNull();
    // 停在第 3000 年年中的:推演年数不写(3000),只写第几格
    expect(stepwiseToNormal({ ...base, play: { year: 3000, tick: 9, commands: [] } })).toEqual({ ...base, endTick: 9 });
    // 普通世界原样返回(第几格照带)
    const plain: WorldEdits = { ...base, endYear: 1200, endTick: 40 };
    expect(stepwiseToNormal(plain)).toBe(plain);
    expect(stepwiseToNormal({ ...plain, playFrom: 20 })).toEqual(plain);
  });

  it('侧栏「最近大事」:停在年中、看的是"现在",列到停下的那一格;别的照旧列到那一年', () => {
    const { s3 } = walk();
    const civ = s3.civ;
    const entries = filterChronicle(fullChronicle(civ), { major: true });
    const year = Math.floor(civ.endYear);
    // 推到的那一格以前的事都列上(全都发生了)
    expect(countUpTo(entries, recentUpTo(year, civ.endYear, true, true))).toBe(entries.length);
    expect(recentUpTo(year, civ.endYear, true, true)).toBe(at(502, 74));
    // 普通世界推到第 502 年第 74 格:那一格的事也推完了
    expect(recentUpTo(502, at(502, 74), true, true)).toBe(at(502, 75));
    // 停在年初、拖到了别处:照旧
    expect(recentUpTo(year, civ.endYear, false, true)).toBe(year);
    expect(recentUpTo(480, civ.endYear, true, false)).toBe(480);
  }, 300_000);
});

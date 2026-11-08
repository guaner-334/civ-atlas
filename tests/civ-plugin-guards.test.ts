/**
 * 推演插件的护栏(gen/civ/engine/plugin.ts 的 PluginClock、插件自己的表):太慢、算出不是数、越界、抛错都停在出错前那一年,
 * 推不下去记上是哪个插件(gen/civ/stuck.ts),前面的历史和一口气推到那一年一样;计时用假的,停在哪年是定的
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startCiv, type Civ, type CivParams } from '../src/gen/civ';
import { civOrStuck, continueOrStuck } from '../src/gen/civ/stuck';
import { PLUGIN_TIME, PluginError, type SimPlugin } from '../src/gen/civ/engine/plugin';
import type { TableCard } from '../src/gen/civ/engine/tables';
import type { SimRead } from '../src/gen/civ/simRead';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { civDiff } from '../scripts/lib/resumeFuzz';

const PARAMS = { ...DEFAULT_PARAMS, cells: 12000, seed: 2024 };
let world: World | null = null;
const worldOf = () => (world ??= generateWorld(PARAMS));

type Plugin = SimPlugin<SimRead>;

/** 假的钟:插件出手时往前拨,拨多少就算用了多少毫秒 */
function fakeClock() {
  const c = { t: 0, now: () => c.t };
  return c;
}

/** 去掉推不下去的记号 */
function unstuck(civ: Civ): Civ {
  const { stuck: _s, ...rest } = civ;
  void _s;
  return rest;
}

/** 去掉插件的状态 */
function official(civ: Civ): Civ {
  const { simPlugins: _s, ...rest } = civ;
  void _s;
  return rest;
}

/** 推到 to 会在 at 那一刻停下:一步步推时抛出说是这个插件的错,之后不能再推 */
function throwsAt(w: World, params: Partial<CivParams>, at: number, id: string, msg: RegExp) {
  const run = startCiv(w, params);
  run.advance(at - 1);
  let err: unknown;
  try {
    run.advance(at + 5);
  } catch (e) {
    err = e;
  }
  expect(err, id).toBeInstanceOf(PluginError);
  expect((err as PluginError).plugin).toBe(id);
  expect((err as Error).message).toMatch(msg);
  expect(run.year).toBe(at);
  expect(() => run.advance(at + 10)).toThrow(/不能接着推/);
}

/** 推不下去的那份:停在 at 的前一年;前面的历史和带着插件一口气推到那一年逐字段一样(插件的状态也一样),官方的部分和没装插件的一样 */
function stoppedBefore(w: World, civ: Civ, params: Partial<CivParams>, at: number, id: string) {
  expect(civ.stuck).toEqual({ at, to: params.endYear, plugin: id });
  expect(civ.endYear).toBe(at - 1);
  expect(civDiff(unstuck(civ), generateCiv(w, { ...params, endYear: at - 1 })), `${id} 带着插件`).toBeNull();
  expect(civDiff(official(unstuck(civ)), generateCiv(w, { endYear: at - 1 })), `${id} 官方`).toBeNull();
}

const region = (id: string, extra: Partial<TableCard>): TableCard => ({ id, name: id, unit: 'region', min: -1e9, max: 1e9, off: 0, ...extra }) as TableCard;

describe('推演插件的护栏:停在出错前那一年,记上是哪个插件', () => {
  it('太慢、算出不是数、越界、抛错:各停在第 49 年', () => {
    const w = worldOf();
    const clock = fakeClock();
    const cases: [Plugin, RegExp][] = [
      [{ id: 'slow', every: 10, act: (t) => void (t.year === 50 && (clock.t += PLUGIN_TIME.moment + 500)) }, /第 50 年这一刻用了 2\.5 秒,超过 2\.0 秒/],
      [{ id: 'nan', every: 10, tables: [region('根', { every: 10, init: 0, rule: 'sqrt(40 - year)' })], act: () => {} }, /第 50 年表「根」算出了不是数的值/],
      [{ id: 'wide', every: 10, tables: [region('宽', { input: true, min: 0, max: 1 })], act: (t) => (t.year === 50 ? { tables: { 宽: new Array(t.table('宽').length + 1).fill(0) } } : undefined) }, /表 宽 要交/],
      [{ id: 'boom', every: 10, act: (t) => {
        if (t.year === 50) throw new Error('炸了');
      } }, /炸了/],
    ];
    for (const [p, msg] of cases) {
      const params = { endYear: 300, plugins: [p], pluginClock: clock.now };
      throwsAt(w, params, 50, p.id, msg);
      const errs: unknown[] = [];
      const civ = civOrStuck(w, params, { failed: (e) => errs.push(e) });
      expect((errs[0] as PluginError).plugin).toBe(p.id);
      stoppedBefore(w, civ, params, 50, p.id);
      // 同样的输入停在同一年
      expect(civDiff(civOrStuck(w, params), civ)).toBeNull();
    }
  }, 180_000);

  it('从推好的一份接着推(再推、逐年推演)也停在同一年', () => {
    const w = worldOf();
    const boom: Plugin = { id: 'boom', every: 10, act: (t) => {
      if (t.year === 50) throw new Error('炸了');
    } };
    const params = { endYear: 300, plugins: [boom] };
    const civ = continueOrStuck(w, generateCiv(w, { ...params, endYear: 30 }), params);
    stoppedBefore(w, civ, params, 50, 'boom');
  }, 60_000);

  it('接不着推的(有地形大事)按年份找:正好在最后那年出错也记上是哪个插件', () => {
    const w = worldOf();
    const upheavals = upheavalSteps(PARAMS, [], null, [{ year: 200, ops: [{ kind: 'volcano', pts: [1169, 764], r: 36, s: 1.1 }] }]);
    const late: Plugin = { id: 'late', every: 10, act: (t) => {
      if (t.year === 300) throw new Error('炸了');
    } };
    const civ = civOrStuck(w, { endYear: 300, upheavals, plugins: [late] });
    expect(civ.stuck).toMatchObject({ to: 300, plugin: 'late' });
    expect(civ.endYear).toBe(299);
    expect(civ.upheavals?.map((u) => u.year)).toEqual([200]);
  }, 120_000);

  it('来回震荡也停下;写了备份规则的换成备份接着推', () => {
    const w = worldOf();
    const flip = region('x', { every: 10, init: 1, rule: 'if(year >= 50, -x, x)' });
    const osc: Plugin = { id: 'osc', every: 10, tables: [flip], act: () => {} };
    const civ = civOrStuck(w, { endYear: 300, plugins: [osc] });
    expect(civ.stuck?.plugin).toBe('osc');
    expect(civ.endYear).toBe(civ.stuck!.at - 1);
    expect(() => generateCiv(w, { endYear: 300, plugins: [osc] })).toThrow(/表「x」来回震荡/);
    const card = region('根', { every: 10, init: 0, rule: 'sqrt(40 - year)' });
    const backed: Plugin = { id: 'backed', every: 10, tables: [{ ...card, fallback: { ...card, rule: '1' } }], act: () => {} };
    const ok = civOrStuck(w, { endYear: 300, plugins: [backed] });
    expect(ok.stuck).toBeUndefined();
    expect(ok.simPlugins![0].tables!.tables['根'].fallback).toBe(true);
  }, 60_000);

  it('一段推演里所有插件加起来太久:停下,算用得最多的那个', () => {
    const w = worldOf();
    const clock = fakeClock();
    // 每年 heavy 用 0.2 秒;第 140 年 light 用 1.9 秒,正好越过 30 秒:越过的是 light,用得最多的是 heavy
    const heavy: Plugin = { id: 'heavy', every: 1, act: () => void (clock.t += 200) };
    const light: Plugin = { id: 'light', every: 1, act: (t) => void (t.year === 140 && (clock.t += 1900)) };
    const params = { endYear: 300, plugins: [heavy, light], pluginClock: clock.now };
    throwsAt(w, params, 140, 'heavy', /推到第 140 年,所有推演插件一共用了 30\.1 秒,超过 30\.0 秒\(它用得最多,28\.2 秒\)/);
    expect(PLUGIN_TIME.total).toBe(30_000);
    // 找停在哪年时从第 10 年接着推,那一段另记一份用时:第 151 年越过
    const civ = civOrStuck(w, params);
    expect(civ.stuck).toEqual({ at: 151, to: 300, plugin: 'heavy' });
    expect(civ.endYear).toBe(150);
    // 不拨钟的同一组插件:推到第 150 年和停下的那份一样
    const still = { ...params, pluginClock: () => 0 };
    expect(civDiff(unstuck(civ), generateCiv(w, { ...still, endYear: 150 }))).toBeNull();
    expect(civDiff(official(unstuck(civ)), generateCiv(w, { endYear: 150 }))).toBeNull();
  }, 120_000);

  it('真的钟:平常的插件用不到上限,推得完', () => {
    const w = worldOf();
    const civ = civOrStuck(w, { endYear: 600, plugins: [{ id: 'calm', every: 1, act: () => {} }] });
    expect(civ.stuck).toBeUndefined();
    expect(civ.simPlugins?.map((s) => s.id)).toEqual(['calm']);
  }, 60_000);
});

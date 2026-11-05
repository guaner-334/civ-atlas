/**
 * 世界打不开、读不出时提示条上的话(src/ui/openTrouble.ts),上次没推完的改动差几处(src/gen/recipe.ts 的 recipeChanges)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_EDITS, type Intervention, type WorldEdits } from '../src/gen/edits';
import { SAVE_APP, makeSave, parseSave, saveText } from '../src/gen/savefile';
import { recipeChanges, recipeOfSave } from '../src/gen/snapshot';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { parseBundle } from '../src/ui/bundle';
import { FILE_TROUBLE, fileTrouble, newerNotice } from '../src/ui/openTrouble';

const g = globalThis as unknown as { sessionStorage?: unknown; location?: unknown };
const win = globalThis as unknown as { window?: unknown };

/** 只够用的 sessionStorage */
function fakeSession() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const errorOf = (text: string) => {
  const r = parseSave(text);
  if (r.ok) throw new Error('应该读不出来');
  return r.error;
};

beforeEach(() => {
  g.sessionStorage = fakeSession();
});
afterEach(() => {
  delete g.sessionStorage;
  delete g.location;
  delete win.window;
  vi.useRealTimers();
});

describe('打开的文件读不出', () => {
  const good = saveText(makeSave(DEFAULT_PARAMS, EMPTY_EDITS, 'c'));

  it('坏了的文件:不说坏了,说可能的原因和先别删', () => {
    for (const e of [{ app: SAVE_APP }, { app: SAVE_APP, format: 1 }]) expect(fileTrouble(errorOf(JSON.stringify(e)))).toEqual({ more: [FILE_TROUBLE] });
    expect(FILE_TROUBLE).toBe('这个文件可能没存完整，或者被改过。网站没有动它，先别删');
  });

  it('下载断了的存档(开头对、后面没了)算没存完整,不算选错了文件', () => {
    for (const cut of [20, good.length >> 1, good.length - 3]) expect(fileTrouble(errorOf(good.slice(0, cut)))).toEqual({ more: [FILE_TROUBLE] });
    expect(fileTrouble(errorOf(`﻿${good.slice(0, 40)}`))).toEqual({ more: [FILE_TROUBLE] });
  });

  it('选错文件、空文件:原来的说法', () => {
    expect(fileTrouble(errorOf('不是 JSON')).more).toEqual(['不是「文明与地图」的存档']);
    expect(fileTrouble(errorOf('{"hello":1')).more).toEqual(['不是「文明与地图」的存档']);
    expect(fileTrouble(errorOf(JSON.stringify({ hello: 1 }))).more).toEqual(['不是「文明与地图」的存档']);
    expect(fileTrouble(errorOf('')).more).toEqual(['文件是空的']);
  });

  it('「全部存成文件」的文件坏了、来自更新版本:同一套字', () => {
    const broken = parseBundle(JSON.stringify({ app: SAVE_APP, bundle: 'x' }));
    const noWorlds = parseBundle(JSON.stringify({ app: SAVE_APP, bundle: 1 }));
    const future = parseBundle(JSON.stringify({ app: SAVE_APP, bundle: 99, worlds: [] }));
    expect(broken?.ok === false && fileTrouble(broken.error)).toEqual({ more: [FILE_TROUBLE] });
    expect(noWorlds?.ok === false && fileTrouble(noWorlds.error)).toEqual({ more: [FILE_TROUBLE] });
    expect(future?.ok === false && fileTrouble(future.error).more).toEqual(newerNotice('file').more);
  });
});

describe('世界比这个页面还新', () => {
  const future = JSON.stringify({ app: SAVE_APP, format: 99, seed: 7 });

  it('我的世界里的:刷新一下;文件:刷新后再打开一次这个文件;都给「刷新页面」', () => {
    const world = newerNotice('world');
    expect(world.more).toEqual(['它是新版存的，这个页面还是旧的。刷新一下，世界没有丢']);
    expect(world.action?.label).toBe('刷新页面');
    const file = fileTrouble(errorOf(future));
    expect(file.more).toEqual(['它是新版存的，这个页面还是旧的。刷新后再打开一次这个文件，世界没有丢']);
    expect(file.action?.label).toBe('刷新页面');
  });

  it('刷新过还是比它新:网站更新后就能打开,没有按钮;过一阵网站可能更新了,再劝刷新', () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    g.location = { reload };
    newerNotice('world').action?.onClick();
    expect(reload).toHaveBeenCalledOnce();
    for (const after of [newerNotice('world'), newerNotice('file'), fileTrouble(errorOf(future))]) {
      expect(after.more).toEqual(['它比这个网站的版本还新，网站更新后就能打开。世界没有丢']);
      expect(after.action).toBeUndefined();
    }
    vi.advanceTimersByTime(31 * 60_000);
    expect(newerNotice('world').action?.label).toBe('刷新页面');
  });

  it('记不下(浏览器不让用 sessionStorage)也照样刷新', () => {
    const reload = vi.fn();
    g.location = { reload };
    delete g.sessionStorage;
    newerNotice('file').action?.onClick();
    expect(reload).toHaveBeenCalledOnce();
    expect(newerNotice('file').action?.label).toBe('刷新页面');
  });

  it('旧版网站上:到最新版打开,带着存着的世界;读不出来的文件只开最新版的网站;刷新过也一样', async () => {
    const save = makeSave(DEFAULT_PARAMS, EMPTY_EDITS, 'c');
    const opened: unknown[][] = [];
    const page = { opener: {}, location: { href: '' }, close() {} };
    win.window = {
      open: (...a: unknown[]) => {
        opened.push(a);
        return page;
      },
    };
    g.location = { href: 'https://example.test/v50/' };
    const world = newerNotice('world', save, 50);
    expect(world.more).toEqual(['它是新版存的，这里是旧版网站。到最新版打开，世界没有丢']);
    expect(world.action?.label).toBe('到最新版打开');
    world.action?.onClick();
    await vi.waitFor(() => expect(page.location.href).toContain('own=1#share='));
    const file = newerNotice('file', null, 50);
    expect(file.action?.label).toBe('到最新版打开');
    file.action?.onClick();
    expect(opened.at(-1)?.[1]).toBe('_blank');
    expect(opened.at(-1)?.[0]).not.toBe('');
    sessionStorage.setItem('civ-atlas:newer-refreshed', String(Date.now()));
    expect(newerNotice('world', save, 50).action?.label).toBe('到最新版打开');
  });
});

describe('上次没推完的改动差几处', () => {
  const iv = (year: number): Intervention => ({ kind: 'protect', keys: ['c1'], from: year, to: year + 10 }) as unknown as Intervention;
  const recipe = (e: Partial<WorldEdits>) => recipeOfSave(makeSave(DEFAULT_PARAMS, { ...EMPTY_EDITS, ...e }, 'c'));

  it('一样 = 0;改名、标记不在配方里,不算', () => {
    expect(recipeChanges(recipe({}), recipe({}))).toBe(0);
    expect(recipeChanges(recipe({ names: { 'region:c1': '甲' } }), recipe({}))).toBe(0);
    expect(recipeChanges(recipe({ interventions: [iv(1)] }), recipe({ interventions: [iv(1)] }))).toBe(0);
  });

  it('多了 3 条命令 = 3;少了一条 = 1;改了一条 = 1', () => {
    expect(recipeChanges(recipe({ interventions: [iv(1), iv(2), iv(3)] }), recipe({}))).toBe(3);
    expect(recipeChanges(recipe({}), recipe({ interventions: [iv(1)] }))).toBe(1);
    expect(recipeChanges(recipe({ interventions: [iv(1), iv(2)] }), recipe({ interventions: [iv(1), iv(3)] }))).toBe(1);
  });

  it('不同的列表加起来;别的设定变了各算一处;默认值和没给一样', () => {
    const up = { year: 80, ops: [{ kind: 'volcano', pts: [1278, 768], r: 36, s: 1.1 }] } as NonNullable<WorldEdits['upheavals']>[number];
    expect(recipeChanges(recipe({ interventions: [iv(1)], upheavals: [up], endYear: 5000 }), recipe({}))).toBe(3);
    expect(recipeChanges(recipe({ endYear: 3000 }), recipe({}))).toBe(0);
    expect(recipeChanges(recipe({ endYear: 5000 }), recipe({ endYear: 4000 }))).toBe(1);
  });
});

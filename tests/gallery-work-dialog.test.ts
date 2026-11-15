/**
 * 作品墙上世界、地图作品的介绍窗(src/ui/GalleryWorkDialogs.tsx):世界那几行、地图的参数从存档里读、下载失败说什么。
 */
import { describe, expect, it } from 'vitest';
import { aiText, mapRows, pullTrouble, waitText, worldRows } from '../src/ui/GalleryWorkDialogs';
import { ServerError } from '../src/account/server';
import type { GalleryItem } from '../src/account/gallery';
import { makeSave } from '../src/gen/savefile';
import { DEFAULT_PARAMS } from '../src/gen/world';
import { EMPTY_EDITS } from '../src/gen/edits';

const WORLD: GalleryItem = { id: 'k7qm2xpa', kind: 'world', title: '金阳洋两岸', by: '砚山', blurb: '', version: 57, addedAt: '2026-11-14T00:00:00.000Z' };
const FULL = { sum: 'a'.repeat(64), bytes: 46_000_000 };

describe('世界作品的几行', () => {
  it('都有时:打开时停在、历史推到、那年的国家、民族、AI 写的、打开要下载', () => {
    const facts = {
      year: 6420,
      endYear: 8000,
      states: 14,
      peoples: 16,
      ai: [
        { kind: 'history' as const, n: 2 },
        { kind: 'names' as const, n: 14 },
      ],
    };
    expect(worldRows({ ...WORLD, full: FULL, facts })).toEqual([
      ['打开时停在', '第 6420 年'],
      ['历史推到', '第 8000 年'],
      ['那年的国家', '14 个'],
      ['民族', '16 个'],
      ['AI 写的', '史书 2 版、释名 14 条'],
      ['打开要下载', '46 MB'],
    ]);
  });

  it('缺哪项不列哪项,0 写「0 个」;没有 facts(老服务器、开发用的假服务器)只剩打开要下载;只存了存档的旧作品不用下载', () => {
    expect(worldRows({ ...WORLD, full: FULL, facts: { year: 0, states: 0 } })).toEqual([
      ['打开时停在', '第 0 年'],
      ['那年的国家', '0 个'],
      ['打开要下载', '46 MB'],
    ]);
    expect(worldRows({ ...WORLD, full: { ...FULL, bytes: 5_529_005 } })).toEqual([['打开要下载', '5.5 MB']]);
    expect(worldRows({ ...WORLD, save: {}, facts: { endYear: 3000 } })).toEqual([['历史推到', '第 3000 年']]);
    // 没有 year 时那年的国家、民族不列(就算给了)
    expect(worldRows({ ...WORLD, facts: { endYear: 3000, states: 9, peoples: 17 } })).toEqual([['历史推到', '第 3000 年']]);
  });

  it('AI 写的:量词写死,只写给了的', () => {
    expect(
      aiText([
        { kind: 'history', n: 1 },
        { kind: 'names', n: 3 },
        { kind: 'doctrine', n: 2 },
        { kind: 'customs', n: 5 },
      ]),
    ).toBe('史书 1 版、释名 3 条、教义 2 篇、风俗 5 篇');
    expect(aiText([{ kind: 'customs', n: 1 }])).toBe('风俗 1 篇');
  });
});

describe('地图作品的参数(从取到的存档里读)', () => {
  const params = { ...DEFAULT_PARAMS, seed: 2024, landFraction: 0.33, continents: 0, plates: 30, mountains: 1, temperature: 0, rainfall: 1, cells: 36000 };
  const save = (edits = EMPTY_EDITS) => JSON.parse(JSON.stringify(makeSave(params, edits, 'c', '九州大陆'))) as Record<string, unknown>;

  it('和新建参数窗同一套,没有「推演到」;作者用笔改过地形的多一行', () => {
    expect(mapRows(save())).toEqual({
      rows: [
        ['种子', '2024'],
        ['陆地比例', '33%'],
        ['大陆数量', '不指定'],
        ['板块数量', '30'],
        ['造山强度', '1.00'],
        ['气温、降水', '0°C、1.00'],
        ['精细度', '36k 地块'],
      ],
    });
    const drawn = mapRows(save({ ...EMPTY_EDITS, terrain: [{ kind: 'volcano', pts: [1024, 512], r: 20, s: 1 }] }));
    expect('rows' in drawn && drawn.rows.at(-1)).toEqual(['改过地形', '作者用笔改过']);
  });

  it('存档参数里本来没有的那项不列(老地图缺后来才加的参数,不拿现在的默认值顶上);气温、降水两样都有才列', () => {
    const old = save();
    const p = old.params as Record<string, unknown>;
    delete p.continents;
    delete p.temperature;
    const r = mapRows(old);
    expect('rows' in r && r.rows.map(([k]) => k)).toEqual(['种子', '陆地比例', '板块数量', '造山强度', '精细度']);
  });

  it('存档读不了:照打开地图失败时的说法', () => {
    expect(mapRows({ app: '别的', params: {} })).toMatchObject({ error: expect.stringContaining('打不开这张地图') });
    expect(mapRows(undefined)).toMatchObject({ error: expect.stringContaining('打不开这张地图') });
  });
});

describe('下载世界文件失败说什么', () => {
  it('限次数、服务器忙:约 N 分钟后再试(不到 1 分钟写约 1 分钟;没带写请稍后再试),都能再试', () => {
    expect(pullTrouble(new ServerError(429, 'rate-limit', 'x', { retryAfter: 1500 }))).toEqual({ error: '下载得太频繁了，约 25 分钟后再试。', again: true });
    expect(pullTrouble(new ServerError(429, 'rate-limit', 'x', { retryAfter: 20 }))).toEqual({ error: '下载得太频繁了，约 1 分钟后再试。', again: true });
    expect(pullTrouble(new ServerError(503, 'busy', 'x', { retryAfter: 150 }))).toEqual({ error: '服务器这会儿太忙，约 3 分钟后再试。', again: true });
    expect(pullTrouble(new ServerError(503, 'busy', 'x'))).toEqual({ error: '服务器这会儿太忙，请稍后再试。', again: true });
    expect(waitText('abc')).toBe('请稍后再试。');
    expect(waitText(-5)).toBe('请稍后再试。');
  });

  it('断网、别的服务器错能再试;撤下了、取到了读不了(照打开失败的说法)只能关窗', () => {
    expect(pullTrouble(new ServerError(0, 'network', '连不上服务器'))).toEqual({ error: '连不上服务器，请检查网络后再试。', again: true });
    expect(pullTrouble(new ServerError(500, 'server', '服务器出错了(HTTP 500)'))).toEqual({ error: '服务器出错了(HTTP 500)', again: true });
    expect(pullTrouble(new ServerError(410, 'gallery-gone', 'x'))).toEqual({ error: '这个作品已经撤下了', again: false });
    expect(pullTrouble(new ServerError(0, 'newer', '这个世界来自更新的版本，刷新页面后再打开'))).toEqual({ error: '这个世界来自更新的版本，刷新页面后再打开', again: false });
  });
});

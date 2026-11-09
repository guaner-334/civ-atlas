/**
 * 并排试推能换的地图(src/ui/compare/compareMaps.ts):正看着的世界排第一(地图、文明种子、拓荒、起源、天灾、地名风格照它,干预等不带),
 * 再是种子 7,再是「我的世界」里的各张地图;同一张地图只列一次;不在世界里 = 没有第一项
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { EMPTY_EDITS, type WorldEdits } from '../src/gen/edits';
import { makeSave } from '../src/gen/savefile';
import { mapChoices, worldHere } from '../src/ui/compare/compareMaps';
import type { StoredWorld } from '../src/ui/saveStore';

const stored = (id: string, seed: number, edits: Partial<WorldEdits> = {}, at = '2026-10-01'): StoredWorld => ({
  id,
  save: makeSave({ ...DEFAULT_PARAMS, seed }, { ...EMPTY_EDITS, ...edits }, 'x', `种子 ${seed}`),
  count: 0,
  thumb: null,
  draft: false,
  at,
  map: false,
  mapThumb: null,
});

describe('并排试推的地图', () => {
  it('正看着的世界排第一,带它的设定;种子 7;我的世界里的地图;同一张只列一次', () => {
    const edits: WorldEdits = { ...EMPTY_EDITS, civSeed: 52817, calamity: 'more', frontier: { expand: 1.5 } as WorldEdits['frontier'], interventions: [{ kind: 'war' } as never] };
    const here = worldHere(true, { params: { ...DEFAULT_PARAMS, seed: 2024 }, title: '北境' }, edits)!;
    expect(here.title).toBe('北境');
    expect(here.setup).toEqual({ civSeed: 52817, calamity: 'more', frontier: { expand: 1.5 } });
    expect(here.map).toEqual({ params: { ...DEFAULT_PARAMS, seed: 2024 } });
    const list = mapChoices(here, [stored('a', 2024, {}, '2026-10-03'), stored('b', 7, {}, '2026-10-02'), stored('c', 99, {}, '2026-10-01')]);
    expect(list.map((c) => c.label)).toEqual(['「北境」的地图', '种子 7 的地图', '种子 99 的地图']);
    expect(list[1].setup).toEqual({});
    expect(list[2].map.params.seed).toBe(99);
  });

  it('照原样打开的旧世界:这里是按参数现长的,叫新版地图', () => {
    const here = worldHere(true, { params: { ...DEFAULT_PARAMS, seed: 2024 }, title: '北境', frozen: 22 }, EMPTY_EDITS);
    expect(mapChoices(here, [])[0].label).toBe('「北境」的新版地图');
  });

  it('用了地图插件的世界:本机有同一版就带着插件;对不上的灰着写哪里对不上,不当成没用插件的', () => {
    const file = { id: 'crater', sum: 'ab12', bytes: new Uint8Array([1]) } as never;
    const worlds = [stored('a', 11, {}, '2026-10-03'), stored('b', 12, {}, '2026-10-02'), stored('c', 13, {}, '2026-10-01')];
    const list = mapChoices(
      null,
      worlds,
      new Map([
        ['a', { files: [file], off: null }],
        ['b', { files: null, off: '你没装「环形山」' }],
      ]),
    );
    expect(list.map((c) => c.label)).toEqual(['种子 7 的地图', '种子 11 的地图', '种子 12 的地图（你没装「环形山」）', '种子 13 的地图']);
    expect(list[1].map.mapPlugins).toEqual([file]);
    expect(list[1].off).toBeUndefined();
    expect(list[2].off).toBe('你没装「环形山」');
    expect(list[3].map.mapPlugins).toBeUndefined();
    // 同样的参数,带插件和不带是两张地图
    expect(list[1].key).not.toBe(mapChoices(null, [worlds[0]])[1].key);
  });

  it('不在世界里:从种子 7 起;改过地形的地图名字上写着', () => {
    expect(worldHere(false, { params: DEFAULT_PARAMS }, EMPTY_EDITS)).toBeNull();
    expect(worldHere(true, null, EMPTY_EDITS)).toBeNull();
    const op = { kind: 'raise', pts: [1, 2], r: 3 } as unknown as WorldEdits['terrain'][number];
    const list = mapChoices(null, [stored('a', 5, { terrain: [op] })]);
    expect(list.map((c) => c.label)).toEqual(['种子 7 的地图', '种子 5（改过地形）的地图']);
    expect(list[1].map.terrain).toEqual([op]);
  });
});

/**
 * 大纲搬家(大纲页「找更合的世界」,ui/outlineMove.ts)和"要重新指"(gen/edits.ts 的 Plot.redo):
 * 要重新指的几项缺着也收下、照大纲推演时缺着要填的标做不到;大纲里写到最多的几国当故事里的国家;
 * 搬到找到的世界时国家换成对上的那一国,别的对不上的记下原来的名字;找世界那一页上从大纲来的几国(没条件的不搜、例子套上去、去掉条件时留着)。
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { polityAlive } from '../src/gen/civ/growth';
import { ownersAt } from '../src/gen/civ/timeline';
import { runOutline } from '../src/gen/outline';
import { capitalAt } from '../src/gen/civ/growth';
import { cleanOutline, cleanPlot, plotNeedsRedo, polityKey, regionKey, settlementKey, type Plot } from '../src/gen/edits';
import { FINDER_PRESETS, roleFree, searchQuery, type FinderQuery } from '../src/gen/finder/query';
import { moveOutline, outlineFrom, outlineRoles } from '../src/ui/outlineMove';
import { whatCell, whoCell, type OutlineCtx } from '../src/ui/outlineInfo';
import { dropRole } from '../src/ui/FinderConds';
import { presetFor } from '../src/ui/finderStore';
import { spanWho } from '../src/ui/finderText';

const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed, cells: 8000 })));
  return w;
};
const civs = new Map<string, Civ>();
const civOf = (seed: number, civSeed?: number) => {
  const k = `${seed}/${civSeed ?? ''}`;
  let c = civs.get(k);
  if (!c) civs.set(k, (c = generateCiv(world(seed), civSeed === undefined ? {} : { civSeed })));
  return c;
};

/** 第 year 年州最多的几国(活着的) */
function biggest(civ: Civ, year: number): number[] {
  const own = ownersAt(civ, year).polity;
  const n = new Map<number, number>();
  for (let r = 0; r < civ.regions.count; r++) if (own[r] >= 0) n.set(own[r], (n.get(own[r]) ?? 0) + 1);
  return [...n.keys()].filter((p) => polityAlive(civ.polities[p], year)).sort((x, y) => n.get(y)! - n.get(x)! || x - y);
}

describe('要重新指', () => {
  it('要填的缺着也收下;重新指了的不再记;照大纲推演时只有缺着要填的才算缺', () => {
    const war = cleanPlot({ id: 1, kind: 'war', year: 100, a: 'polity:c5#0', redo: { b: '奥利亚王国' } });
    expect(war).toEqual({ id: 1, kind: 'war', year: 100, a: 'polity:c5#0', redo: { b: '奥利亚王国' } });
    expect(plotNeedsRedo(war!)).toBe(true);
    // 本来就合格的原样返回(同一个对象)
    expect(cleanPlot(war)).toBe(war);
    // 重新指了:不再记
    expect(cleanPlot({ ...war, b: 'polity:c9#0' })).toEqual({ id: 1, kind: 'war', year: 100, a: 'polity:c5#0', b: 'polity:c9#0' });
    // 没记在 redo 里的要填的缺着:不收
    expect(cleanPlot({ id: 1, kind: 'war', year: 100, a: 'polity:c5#0', redo: { city: '东定' } })).toBeNull();
    // 只缺可有可无的(亡于哪国):照常查
    const fall = cleanPlot({ id: 2, kind: 'fall', year: 100, a: 'polity:c5#0', redo: { b: '' } })!;
    expect(fall.redo).toEqual({ b: '' });
    expect(plotNeedsRedo(fall)).toBe(false);
    // 占据一片地方:圈的州、作者标记都缺着
    const hold = cleanPlot({ id: 3, kind: 'hold', year: 100, a: 'polity:c5#0', redo: { regions: '鹿南等 3 州' } })!;
    expect(plotNeedsRedo(hold)).toBe(true);
    expect(cleanPlot({ ...hold, mark: 2 })).toEqual({ id: 3, kind: 'hold', year: 100, a: 'polity:c5#0', mark: 2 });
    // 饥荒:那国缺着(不当成圈州的那种)
    expect(cleanPlot({ id: 4, kind: 'disaster', year: 100, type: 'famine', redo: { a: '大定' } })).toEqual({ id: 4, kind: 'disaster', year: 100, type: 'famine', redo: { a: '大定' } });
    // 这种情节用不上的一项、不是字串的:去掉
    expect(cleanPlot({ id: 5, kind: 'story', year: 100, redo: { b: '大定', city: 3, region: '鹿南' } })).toEqual({ id: 5, kind: 'story', year: 100, redo: { region: '鹿南' } });
    // 存档读进来照样留着
    expect(cleanOutline({ plots: [war, fall] })!.plots[0].redo).toEqual({ b: '奥利亚王国' });
  });

  it('照大纲推演:缺着要填的那条标做不到(还没重新指),只缺镜头的只讲故事照旧', async () => {
    const plots: Plot[] = [
      { id: 1, kind: 'war', year: 1200, a: 'polity:c5#0', redo: { b: '奥利亚王国' } },
      { id: 2, kind: 'story', year: 1300, text: '雨夜', redo: { city: '东定' } },
    ];
    const r = await runOutline(world(7), { endYear: 1400 }, { plots, interventions: [] });
    expect(r!.review).toEqual([
      { id: 1, status: 'failed', year: 1200, reason: 'redo' },
      { id: 2, status: 'story', year: 1300 },
    ]);
  }, 120_000);
});

describe('大纲搬家', () => {
  it('写到最多的几国当故事里的国家;国家换成找到的那一国,别的对不上的记下原来的名字', () => {
    const src = civOf(7);
    const Y = 1500;
    const [a, b, c] = biggest(src, Y);
    const cap = capitalAt(src.polities[a], Y);
    const own = ownersAt(src, Y).polity;
    const city = src.settlements.findIndex((s, i) => i !== cap && own[s.region] === a);
    const region = own.findIndex((p) => p === a);
    const K = (p: number) => polityKey(src, p);
    const plots: Plot[] = [
      { id: 1, kind: 'war', year: Y, a: K(a), b: K(b), text: '开战' },
      { id: 2, kind: 'capital', year: Y + 20, a: K(a), city: settlementKey(src, city) },
      { id: 3, kind: 'found', year: Y + 40, region: regionKey(src, region), name: '新国' },
      { id: 4, kind: 'fall', year: Y + 60, a: K(c), b: 'plot:3' },
      { id: 5, kind: 'story', year: Y + 80, text: '雨夜' },
    ];
    const o: OutlineCtx = { civ: src, plots };
    const from = outlineFrom(o, 'w1', 'map7');
    expect(from.polities).toEqual({ [K(a)]: a, [K(b)]: b, [K(c)]: c });
    // 写到最多的在前(a 两条),一样多的先写到的在前
    const roles = outlineRoles(from);
    expect(roles.map((r) => r.ref)).toEqual([a, b, c]);
    expect(roles[0].conds).toEqual([]);
    expect(roles[0].name.length).toBeLessThanOrEqual(6);
    expect(from.names[2].city).toBe(src.settlements[city].name);

    // 只给第一国加了条件:另外两国找的时候不管它
    const q: FinderQuery = { roles: [{ ...roles[0], conds: [{ kind: 'size', size: 'large' }] }, roles[1], roles[2]], together: [] };
    expect([0, 1, 2].map((i) => roleFree(q, i))).toEqual([false, true, true]);
    const sq = searchQuery(q);
    expect(sq.roles.map((r) => r.ref)).toEqual([a]);
    expect(spanWho(q)).toBe(roles[0].name);

    // 搬到另一个世界(另一张地图):a 换成找到的那一国,b、c、城、州对不上
    const dst = civOf(4);
    const got = biggest(dst, 800)[0];
    const moved = moveOutline(from, sq, [got], dst, false);
    expect(moved.plots.map((p) => p.id)).toEqual([1, 2, 3, 4, 5]);
    const [war, capital, found, fall, story] = moved.plots;
    expect(war).toEqual({ id: 1, kind: 'war', year: Y, a: polityKey(dst, got), text: '开战', redo: { b: from.names[1].b } });
    expect(capital.a).toBe(polityKey(dst, got));
    expect(capital.redo).toEqual({ city: src.settlements[city].name });
    expect(found.region).toBeUndefined();
    expect(found.redo?.region).toBeTruthy();
    expect(found.name).toBe(cleanPlot(plots[2])!.name);
    // 立起来的国家(plot:编号)照旧
    expect(fall.b).toBe('plot:3');
    expect(fall.redo).toEqual({ a: from.names[4].a });
    expect(story).toEqual(plots[4]);
    expect(moved.redo).toBe(4);
    expect(plotNeedsRedo(war)).toBe(true);

    // 大纲页上:对不上的写原来的名字、标出来
    const ov: OutlineCtx = { civ: dst, plots: moved.plots };
    const w = whoCell(ov, war);
    expect(w.parts[1]).toEqual({ text: from.names[1].b, redo: true });
    expect(w.parts[0].redo).toBeUndefined();
    expect(whatCell(ov, capital)).toEqual(['迁都', `迁到${src.settlements[city].name}`, true]);

    // 都用这张地图找的(只换文明种子):州还是那块地方,州键照旧
    const same = civOf(7, 99);
    const kept = moveOutline(from, sq, [biggest(same, 800)[0]], same, true);
    expect(kept.plots[2].region).toBe(plots[2].region);
    expect(kept.plots[2].redo).toBeUndefined();
  }, 120_000);

  it('找世界那一页:例子套到大纲里的几国上;从大纲来的去掉条件也留着', () => {
    const cur: FinderQuery = {
      roles: [
        { name: '大定', ref: 4, conds: [] },
        { name: '奥利亚王国', ref: 9, conds: [] },
        { name: '有桑', ref: 2, conds: [] },
      ],
      together: [],
    };
    const mountain = FINDER_PRESETS.find((p) => p.id === 'mountain-pass')!.query;
    const q = presetFor(mountain, cur);
    expect(q.roles.map((r) => [r.name, r.ref, r.conds.length])).toEqual([
      ['大定', 4, 3],
      ['奥利亚王国', 9, 3],
      ['有桑', 2, 0],
    ]);
    expect(q.together).toEqual(mountain.together);
    // 没有从大纲来的:就是例子
    expect(presetFor(mountain, { roles: [], together: [] })).toEqual(mountain);
    // 去掉大定:奥利亚王国指着它的隘口跟着去掉,条件还剩两条;有桑本来就没条件,留着
    const d = dropRole(q, 0);
    expect(d.roles.map((r) => r.name)).toEqual(['奥利亚王国', '有桑']);
    expect(d.roles[0].conds.map((c) => c.kind)).toEqual(['size', 'mountain']);
  });
});

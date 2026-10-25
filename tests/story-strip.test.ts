/**
 * 故事长图的骨架(src/ui/storyStrip.ts):分几段、每段挑哪几件大事、配哪一年的地图。
 * 用真实世界(seed 7、seed 2024,各一个整个世界 + 一国)核对:段数不超上限、段首尾相接、每段的大事都在那段年份里、
 * 挑的是分量最重的、同一种子结果相同;推了六千年的世界(和推到六万年的假世界)段数照样受控。
 */
import { describe, expect, it } from 'vitest';
import { chronicleEraYears, entryInvolves, filterChronicle, type ChronicleEntry } from '../src/gen/civ/chronicle';
import { fullChronicle } from '../src/gen/civ/religionText';
import { generateCiv, type Civ, type Polity } from '../src/gen/civ';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { defaultPolity, longPolities, polityLastYear } from '../src/ui/longPlan';
import { STRIP_SPANS, eventSize, pickEvents, storyStrip, stripSections, stripSpan, type StripPlan } from '../src/ui/storyStrip';
import { entryWeight } from '../src/ui/timelineLayout';

interface Case {
  seed: number;
  civ: Civ;
  all: ChronicleEntry[];
  majors: ChronicleEntry[];
}

function make(seed: number, endYear?: number): Case {
  const civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, seed }), endYear ? { endYear } : {});
  const all = fullChronicle(civ);
  return { seed, civ, all, majors: filterChronicle(all, { major: true }) };
}

const CASES = [make(7), make(2024)];
const first = (civ: Civ) => Math.floor(Math.min(...civ.polities.filter((p) => p.founded <= civ.endYear).map((p) => p.founded)));
/** 段和段首尾相接、不重叠;地图年份是这一段最后一年年末那一刻,不过 last(整年亡的国家,最后一段拍亡国前一刻,比那一年早一点) */
function checkShape(plan: StripPlan, last: number) {
  plan.segments.forEach((s, i) => {
    expect(s.from).toBeLessThanOrEqual(s.to);
    if (i) expect(s.from).toBe(plan.segments[i - 1].to + 1);
    expect(s.mapYear).toBeGreaterThanOrEqual(Math.min(s.to, last));
    expect(s.mapYear).toBeLessThan(s.to + 1);
    expect(s.mapYear).toBeLessThanOrEqual(last);
    expect(s.events.length).toBeLessThanOrEqual(s.total);
    for (const e of s.events) {
      expect(Math.floor(e.year)).toBeGreaterThanOrEqual(s.from);
      expect(Math.floor(e.year)).toBeLessThanOrEqual(s.to);
    }
  });
}
/** 挑的是分量最重的:没挑上的不比挑上的任何一件重;和挑上的最轻那件一样重的,牵涉的国家不比它们大(给了 size 时) */
function checkHeaviest(pool: readonly ChronicleEntry[], picked: readonly ChronicleEntry[], size?: (e: ChronicleEntry) => number) {
  if (!picked.length) return;
  const min = Math.min(...picked.map(entryWeight));
  const set = new Set(picked);
  const edge = size ? Math.min(...picked.filter((e) => entryWeight(e) === min).map(size)) : 0;
  for (const e of pool) {
    if (set.has(e)) continue;
    expect(entryWeight(e)).toBeLessThanOrEqual(min);
    if (size && entryWeight(e) === min) expect(size(e)).toBeLessThanOrEqual(edge);
  }
}

describe.each(CASES)('整个世界(seed $seed)', ({ civ, all, majors }) => {
  const end = Math.floor(civ.endYear);
  const size = eventSize(civ);
  const f = first(civ);

  it('段数不到上限时和导出的编年史一样分:从第一个国家立国那一节起,到最后一年', () => {
    const plan = storyStrip(civ, all, majors, { maxSegments: 99, perSegment: Infinity });
    const span = chronicleEraYears(civ.endYear);
    expect(plan.polity).toBeNull();
    expect(plan.span).toBe(span);
    expect(plan.headYear).toBe(civ.endYear);
    expect(plan.segments[0].from).toBe(Math.floor(f / span) * span);
    expect(plan.segments.at(-1)!.to).toBe(end);
    checkShape(plan, civ.endYear);
    // 不限件数:这几段里的大事一条不少
    const n = plan.segments.reduce((s, x) => s + x.events.length, 0);
    expect(n).toBe(majors.filter((e) => Math.floor(e.year) >= plan.segments[0].from).length);
  });

  it.each([1, 2, 3, 4, 6, 8])('最多 %i 段:段数不超,每段的大事都在那段年份里、不超过件数、挑分量最重的', (max) => {
    for (const per of [0, 3, 5]) {
      const plan = storyStrip(civ, all, majors, { maxSegments: max, perSegment: per });
      expect(plan.segments.length).toBeGreaterThan(0);
      expect(plan.segments.length).toBeLessThanOrEqual(max);
      expect(STRIP_SPANS).toContain(plan.span);
      expect(plan.segments.at(-1)!.to).toBe(end);
      checkShape(plan, civ.endYear);
      for (const s of plan.segments) {
        expect(s.events.length).toBe(Math.min(per, s.total));
        const pool = majors.filter((e) => Math.floor(e.year) >= s.from && Math.floor(e.year) <= s.to);
        expect(s.total).toBe(pool.length);
        checkHeaviest(pool, s.events, size);
        // 照编年史里的先后
        expect(s.events).toEqual(pool.filter((e) => s.events.includes(e)));
      }
    }
  });

  it('段数上限越小,一节越长(不会比编年史的一节短)', () => {
    let prev = Infinity;
    for (const max of [8, 6, 4, 3, 2, 1]) {
      const span = storyStrip(civ, all, majors, { maxSegments: max, perSegment: 3 }).span;
      expect(span).toBeGreaterThanOrEqual(chronicleEraYears(civ.endYear));
      expect(span).toBeGreaterThanOrEqual(prev === Infinity ? 0 : prev);
      prev = span;
    }
    // 只要一段:整段历史一段
    const one = storyStrip(civ, all, majors, { maxSegments: 1, perSegment: 3 });
    expect(one.segments).toHaveLength(1);
    expect(one.segments[0].to).toBe(end);
    expect(one.segments[0].mapYear).toBe(civ.endYear);
  });
});

describe.each(CASES)('一国(seed $seed)', ({ civ, all, majors }) => {
  const { fallen } = longPolities(civ);
  // 现存最大的一国 + 已亡的里面享国最久的一国
  const big = defaultPolity(civ, null)!;
  const gone = [...fallen].sort((a, b) => b.to - b.from - (a.to - a.from) || a.id - b.id)[0].id;

  it.each<[string, number]>([
    ['现存最大的', big],
    ['已亡、享国最久的', gone],
  ])('%s:从立国到亡国(还在 = 最后一年),只挑和这一国有关的事,地图不过最后一刻', (_, id) => {
    const p: Polity = civ.polities[id];
    const lastY = polityLastYear(civ, p);
    const E = p.ended !== undefined && p.ended <= civ.endYear ? Math.floor(p.ended) : Math.floor(lastY);
    for (const max of [2, 4, 6]) {
      const plan = storyStrip(civ, all, majors, { polity: id, maxSegments: max, perSegment: 4 });
      expect(plan.polity).toBe(id);
      expect(plan.headYear).toBe(lastY);
      expect(plan.segments.length).toBeGreaterThan(0);
      expect(plan.segments.length).toBeLessThanOrEqual(max);
      expect(plan.segments[0].from).toBe(Math.floor(p.founded));
      expect(plan.segments.at(-1)!.to).toBe(E);
      checkShape(plan, lastY);
      for (const s of plan.segments) {
        expect(s.events.length).toBeLessThanOrEqual(4);
        for (const e of s.events) {
          expect(entryInvolves(e, id)).toBe(true);
          expect(e.kind).not.toBe('reign');
          expect(e.importance).toBeGreaterThanOrEqual(2);
        }
      }
    }
  });

  it('这一国不存在:按整个世界', () => {
    const plan = storyStrip(civ, all, majors, { polity: civ.polities.length + 5, maxSegments: 6, perSegment: 3 });
    expect(plan.polity).toBeNull();
    expect(plan).toEqual(storyStrip(civ, all, majors, { maxSegments: 6, perSegment: 3 }));
  });
});

describe('同一种子结果相同', () => {
  it('seed 7 重新生成一遍:整个世界、一国分的段和挑的事一模一样', () => {
    const again = make(7);
    const a = CASES[0];
    const brief = (plan: StripPlan) => plan.segments.map((s) => [s.from, s.to, s.mapYear, s.total, s.events.map((e) => `${e.id}:${e.year}:${e.text}`)]);
    for (const polity of [null, defaultPolity(a.civ, null)]) {
      const opt = { polity, maxSegments: 6, perSegment: 5 };
      expect(brief(storyStrip(again.civ, again.all, again.majors, opt))).toEqual(brief(storyStrip(a.civ, a.all, a.majors, opt)));
    }
  });
});

describe('三千年以上的世界段数受控', () => {
  const long = make(7, 6000);

  it('seed 7 推到 6000 年:每段更长,段数不超上限,每段的件数不超', () => {
    expect(Math.floor(long.civ.endYear)).toBe(6000);
    for (const max of [4, 6, 8]) {
      const plan = storyStrip(long.civ, long.all, long.majors, { maxSegments: max, perSegment: 5 });
      expect(plan.segments.length).toBeLessThanOrEqual(max);
      expect(plan.span).toBeGreaterThanOrEqual(1000);
      expect(plan.segments.at(-1)!.to).toBe(6000);
      checkShape(plan, long.civ.endYear);
      for (const s of plan.segments) expect(s.events.length).toBeLessThanOrEqual(5);
    }
  });

  it('推到六万年(最多能推这么久)的假世界:照样不超上限', () => {
    const fake = { endYear: 60000, polities: [{ founded: 120 }, { founded: 400, ended: 31000.5 }] } as unknown as Civ;
    for (const max of [1, 4, 6, 8, 12]) {
      const plan = storyStrip(fake, [], [], { maxSegments: max, perSegment: 5 });
      expect(plan.segments.length).toBeGreaterThan(0);
      expect(plan.segments.length).toBeLessThanOrEqual(max);
      expect(plan.segments[0].from).toBe(0);
      expect(plan.segments.at(-1)!.to).toBe(60000);
      checkShape(plan, 60000);
    }
    // 一国:400 年立国、31000 年亡
    const one = storyStrip(fake, [], [], { polity: 1, maxSegments: 6, perSegment: 5 });
    expect(one.segments.length).toBeLessThanOrEqual(6);
    expect(one.segments[0].from).toBe(400);
    expect(one.segments.at(-1)!.to).toBe(31000);
    checkShape(one, 31000.5);
  });

  it('还没有国家的世界:没有段', () => {
    const plan = storyStrip({ endYear: 3000, polities: [] } as unknown as Civ, [], [], { maxSegments: 6, perSegment: 5 });
    expect(plan.segments).toEqual([]);
    expect(plan.headYear).toBe(3000);
  });
});

describe('分节和挑事的小工具', () => {
  it('stripSections:和编年史一样对齐到整数倍,最后一节到最后一年', () => {
    expect(stripSections(0, 478, 3000, 500, 3000)).toEqual([
      [0, 499],
      [500, 999],
      [1000, 1499],
      [1500, 1999],
      [2000, 2499],
      [2500, 3000],
    ]);
    // 一国:截到立国、亡国那年
    expect(stripSections(588, 588, 1377, 250, 3000)).toEqual([
      [588, 749],
      [750, 999],
      [1000, 1249],
      [1250, 1377],
    ]);
    // 推到 3125 年:最后一节是零头
    expect(stripSections(0, 900, 3125, 500, 3125).at(-1)).toEqual([3000, 3125]);
  });

  it('stripSpan:超过上限放长一档', () => {
    expect(stripSpan(0, 478, 3000, 3000, 500, 6)).toBe(500);
    expect(stripSpan(0, 478, 3000, 3000, 500, 4)).toBe(1000);
    expect(stripSections(0, 478, 3000, 1000, 3000)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 3000],
    ]);
    expect(stripSpan(0, 478, 3000, 3000, 500, 1)).toBe(5000);
  });

  it('pickEvents:够数就全留;挑出来的照原来的先后;0 件 = 空', () => {
    const { majors } = CASES[0];
    const some = majors.slice(10, 30);
    expect(pickEvents(some, 99)).toEqual(some);
    expect(pickEvents(some, 0)).toEqual([]);
    const three = pickEvents(some, 3);
    expect(three).toHaveLength(3);
    expect(three).toEqual(some.filter((e) => three.includes(e)));
    checkHeaviest(some, three);
    expect(pickEvents(some, Infinity)).toEqual(some);
  });
});

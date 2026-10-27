/**
 * 照故事找世界那一页(ui/finderText.ts、finderStore.ts、FinderConds.tsx 的改条件、foundStore.ts):
 * 条件写成的话、差在哪、放宽一点怎么说;去掉一国时别的条件跟着改;搜(假线程)、再搜接着往后、停下留着、
 * 换了新建中的世界结果作废;「用这个世界」记下的谁是谁、小字。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { FINDER_PRESETS, condList, judge, type Fact, type FinderCand, type FinderQuery, type SeedReport } from '../src/gen/finder/query';
import { checkLines, checksTally, condLine, eraName, hintText, missText, nearSummary, querySummary, relaxText, tenths, yearsText } from '../src/ui/finderText';
import { addRole, dropRole } from '../src/ui/FinderConds';
import {
  closeFinder,
  getFinder,
  moreFinder,
  openFinder,
  pickPreset,
  resetFinder,
  setFinderCount,
  setFinderSpawn,
  setQuery,
  startFinder,
  stopFinder,
} from '../src/ui/finderStore';
import type { FinderThread } from '../src/ui/finderPool';
import type { FinderJob } from '../src/finderWorker';
import { foundPickOf } from '../src/ui/foundStore';
import { searchSeed } from '../src/gen/finder/measure';

const MOUNTAIN = FINDER_PRESETS.find((p) => p.id === 'mountain-pass')!.query;

/** 山国守隘口那套 9 条量出来的数(各条的意思见 query.ts 的 Fact) */
const FACTS = [
  [107, 29, 60], // 帝国大小
  [4], // 邻国
  [5], // 港口
  [29, 107, 40], // 山国大小
  [0.21], // 翻山
  [173, 1553, 2, 12, 900], // 隘口
  [3, 77, 3, 77], // 交界
  [130], // 讲多久
  [1, 47], // 开场
];
const cand = (facts = FACTS): FinderCand => ({
  year: 1755,
  roles: [3, 8],
  names: ['大月王朝', '东萨富斯坦汗国'],
  sizes: [107, 29],
  facts,
  capitals: [],
  places: [],
  story: [],
});

describe('照故事找世界:条件写成的话', () => {
  it('每条一句话;搜的时候顶上的概括', () => {
    const lines = condList(MOUNTAIN).map((r) => condLine(MOUNTAIN, r.role, r.cond));
    expect(lines).toEqual([
      '帝国是大国（40 州以上）',
      '帝国至少 4 个邻国',
      '帝国有通航线的港口',
      '山国是小国（不到帝国的一半）',
      '山国边界至少两成是翻山',
      '隘口比山脊低 800 米以上',
      '有一州同时挨着 3 国',
      '两国都撑过 130 年',
      '帝国在青铜时代，15–50 年后进铁器',
    ]);
    const s = querySummary(MOUNTAIN);
    expect(s.roles).toEqual(['大国，至少 4 个邻国，有港口', '小国，两成翻山，和帝国隔山有隘口']);
    expect(s.together).toBe('三国交界，讲 130 年，帝国进铁器前 15–50 年开场');
    expect(tenths(0.4)).toBe('四成');
  });

  it('条件逐条:隘口拆成两行,写实际数', () => {
    const v = judge(MOUNTAIN, FACTS);
    expect(v.misses).toBe(0);
    const lines = checkLines(MOUNTAIN, v.checks, FACTS, 1755, new Map([[6, '金霞域']]));
    expect(lines).toHaveLength(10);
    expect(lines.every((l) => l.ok)).toBe(true);
    const at = (t: string) => lines.find((l) => l.text === t)?.value;
    expect(at('帝国是大国（40 州以上）')).toBe('107 州');
    expect(at('隘口比山脊低 800 米以上')).toBe('低 1380 米');
    expect(at('能过的地方不超过 2 处')).toBe('2 处');
    expect(at('有一州同时挨着 3 国')).toBe('金霞域');
    expect(at('两国都撑过 130 年')).toBe('到 1885 年都在');
    expect(at('帝国在青铜时代，15–50 年后进铁器')).toBe('47 年后');
  });

  it('条件逐条写差几条:按条件数,隘口两行都不合也只差一条,和标题(misses)一致', () => {
    const tally = (facts: readonly Fact[]) => {
      const v = judge(MOUNTAIN, facts);
      const lines = checkLines(MOUNTAIN, v.checks, facts, 1755);
      return { misses: v.misses, bad: lines.filter((l) => !l.ok).length, text: checksTally(lines) };
    };
    const withPass = (pass: Fact): Fact[] => FACTS.map((f, i) => (i === 5 ? pass : f));
    expect(tally(FACTS)).toEqual({ misses: 0, bad: 0, text: '10 条都合' });
    // 口子不够低,能过的地方也太多(种子 11 那种):两行都打叉,标题"差一条",这里也写差 1 条
    expect(tally(withPass([2389, 2829, 5, 31, 900]))).toEqual({ misses: 1, bad: 2, text: '差 1 条' });
    // 不接壤、山不像关隘:两行都打叉
    expect(tally(withPass(null))).toEqual({ misses: 1, bad: 2, text: '差 1 条' });
    expect(judge(MOUNTAIN, withPass([2000, 3000, 2, 12, 900])).checks[5].why).toBe('shape');
    expect(tally(withPass([2000, 3000, 2, 12, 900]))).toEqual({ misses: 1, bad: 2, text: '差 1 条' });
    // 只是能过的地方太多:一行打叉
    expect(tally(withPass([173, 1553, 6, 12, 900]))).toEqual({ misses: 1, bad: 1, text: '差 1 条' });
    // 隘口之外再差一条:差 2 条
    const two = withPass([2389, 2829, 5, 31, 900]).map((f, i) => (i === 4 ? [0.06] : f));
    expect(tally(two)).toEqual({ misses: 2, bad: 3, text: '差 2 条' });
  });

  it('差一条差在哪;差一条的归类数个数', () => {
    const lowGap = FACTS.map((f, i) => (i === 5 ? [916, 1553, 2, 12, 900] : f));
    const row = { cand: cand(lowGap), verdict: judge(MOUNTAIN, lowGap) };
    expect(row.verdict.misses).toBe(1);
    expect(missText(MOUNTAIN, row)).toBe('隘口只比山脊低 637 米');
    expect(missText(MOUNTAIN, row, true)).toBe('隘口只比山脊低 637 米，要 800 米');
    const late = FACTS.map((f, i) => (i === 8 ? [1, 105] : f));
    const r2 = { cand: cand(late), verdict: judge(MOUNTAIN, late) };
    expect(missText(MOUNTAIN, r2)).toBe('帝国 105 年后才进铁器');
    const flat = FACTS.map((f, i) => (i === 4 ? [0.06] : f));
    const r3 = { cand: cand(flat), verdict: judge(MOUNTAIN, flat) };
    expect(missText(MOUNTAIN, r3)).toBe('山国边界只有 6% 是翻山');
    const near = [row, r2, r3, { ...row }].map((r, k) => ({ seed: k + 1, places: [], alts: [], ...r }));
    expect(nearSummary(MOUNTAIN, near)).toBe('隘口不够险 2 个、进铁器太早或太晚 1 个、山国翻山不够 1 个');
  });

  it('离开场多少年:正、零、负都说得通(进时代可能早在开场以前,量出来是负数)', () => {
    expect(yearsText(47)).toBe('47 年后');
    expect(yearsText(0)).toBe('开场那年');
    expect(yearsText(-0.4)).toBe('开场那年');
    expect(yearsText(-207)).toBe('开场前 207 年');
    // 山国守隘口的开场那条:差一条那一行、条件逐条右边
    const start = (enter: number) => {
      const facts = FACTS.map((f, i) => (i === 8 ? [1, enter] : f));
      const verdict = judge(MOUNTAIN, facts);
      const value = checkLines(MOUNTAIN, verdict.checks, facts, 1755).find((l) => l.text === '帝国在青铜时代，15–50 年后进铁器')?.value;
      return { miss: missText(MOUNTAIN, { cand: cand(facts), verdict }), value };
    };
    expect(start(-207)).toEqual({ miss: '帝国开场前 207 年就进了铁器', value: '开场前 207 年' });
    expect(start(0)).toEqual({ miss: '帝国开场那年就进了铁器', value: '开场那年' });
    expect(start(5)).toEqual({ miss: '帝国 5 年后就进了铁器', value: '5 年后' });
    expect(start(105)).toEqual({ miss: '帝国 105 年后才进铁器', value: '105 年后' });
    // 一国进时代、亡国、两国开战:同样的说法
    const q: FinderQuery = {
      roles: [
        { name: '甲', conds: [{ kind: 'eraEnter', era: 2, min: 10, max: 40 }, { kind: 'fate', within: 50, what: ['fall'] }] },
        { name: '乙', conds: [{ kind: 'war', other: 0, within: 30 }] },
      ],
      together: [],
    };
    const one = (facts: number[][]) => {
      const verdict = judge(q, facts);
      const c: FinderCand = { ...cand(facts), roles: [3, 8] };
      return { miss: missText(q, { cand: c, verdict }), values: checkLines(q, verdict.checks, facts, 1755).map((l) => l.value) };
    };
    const era = eraName(2);
    expect(one([[-30], [20], [10]])).toEqual({ miss: `甲开场前 30 年就进了${era}`, values: ['开场前 30 年', '20 年后', '10 年后开战'] });
    expect(one([[0], [20], [10]]).miss).toBe(`甲开场那年就进了${era}`);
    expect(one([[60], [20], [10]]).miss).toBe(`甲 60 年后才进${era}`);
    expect(one([[20], [80], [0]])).toEqual({ miss: '甲 80 年后才亡', values: ['20 年后', '80 年后', '开场那年开战'] });
    expect(one([[20], [20], [45]]).miss).toBe('乙和甲 45 年后才打仗');
  });

  it('放宽一点怎么说', () => {
    const strict: FinderQuery = JSON.parse(JSON.stringify(MOUNTAIN));
    for (const c of strict.roles[1].conds) {
      if (c.kind === 'mountain') c.min = 0.4;
      if (c.kind === 'pass') c.gap = 1200;
    }
    const list = condList(strict);
    const mi = list.findIndex((r) => r.cond.kind === 'mountain');
    const pi = list.findIndex((r) => r.cond.kind === 'pass');
    expect(relaxText(strict, 1, list[mi].cond)).toBe('翻山降到两成');
    expect(relaxText(strict, 1, list[pi].cond)).toBe('隘口降到比山脊低 800 米');
    expect(hintText(strict, { variant: 1, which: [mi], full: 2, near: 0 })).toBe('翻山降到两成');
    expect(hintText(strict, { variant: 9, which: [mi, pi], full: 6, near: 0 })).toBe('两条都放宽');
  });
});

describe('照故事找世界:改条件', () => {
  it('去掉一国:指着它的条件去掉,后面的下标往前挪;没条件的国家跟着去掉', () => {
    const q = addRole(MOUNTAIN);
    expect(q.roles).toHaveLength(3);
    expect(q.roles[2]).toEqual({ name: '甲国', conds: [{ kind: 'border', other: 0 }] });
    // 去掉帝国:山国的隘口、丙国的接壤、开场跟着帝国走的都去掉;丙国没条件了也去掉
    const d = dropRole(q, 0);
    expect(d.roles.map((r) => r.name)).toEqual(['山国']);
    expect(d.roles[0].conds.map((c) => c.kind)).toEqual(['size', 'mountain']);
    expect(d.together.map((c) => c.kind)).toEqual(['junction', 'span']);
    // 去掉山国:别的不动
    const e = dropRole(MOUNTAIN, 1);
    expect(e.roles.map((r) => r.name)).toEqual(['帝国']);
    expect(e.together).toHaveLength(3);
    expect(addRole(addRole(addRole(MOUNTAIN))).roles).toHaveLength(3);
  });
});

class FakeThread implements FinderThread {
  onmessage: ((e: { data: { id: number; report: SeedReport } }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(private readonly log: number[]) {}
  postMessage(job: FinderJob): void {
    this.log.push(job.seed);
    setTimeout(() => this.onmessage?.({ data: { id: job.id, report: { seed: job.seed, ms: 1, viable: false, tried: 0, cands: [], best: [-1], alts: [] } } }), 1);
  }
  terminate(): void {}
}

const until = async (f: () => boolean) => {
  for (let i = 0; i < 400 && !f(); i++) await new Promise((r) => setTimeout(r, 5));
};

describe('照故事找世界:搜', () => {
  it('从 1 起搜;再搜接着往后;停下留着;同一个新建中的世界回来接着看,换了作废', async () => {
    const log: number[] = [];
    setFinderSpawn(() => new FakeThread(log));
    const base = { key: 'a', setup: { world: { ...DEFAULT_PARAMS } } };
    openFinder(base, false);
    pickPreset('sea-power');
    setFinderCount(6);
    startFinder();
    expect(getFinder().page).toBe('results');
    await until(() => getFinder().run?.progress?.state === 'done');
    expect(getFinder().run!.reports.map((r) => r.seed).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    moreFinder();
    await until(() => getFinder().run?.reports.length === 12);
    expect(log.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // 同样的条件再点「开始找」:推过的不再推
    startFinder();
    expect(getFinder().run!.reports).toHaveLength(12);
    // 停下:结果留着;关掉再打开同一个世界,还在
    moreFinder();
    stopFinder();
    closeFinder();
    openFinder(base, false);
    expect(getFinder().run!.reports.length).toBeGreaterThanOrEqual(12);
    // 改了条件再搜:从头来
    setQuery({ ...getFinder().query, together: [{ kind: 'span', years: 50 }] });
    startFinder();
    expect(getFinder().run!.reports).toHaveLength(0);
    stopFinder();
    // 换了新建中的世界:结果作废
    openFinder({ key: 'b', setup: base.setup }, false);
    expect(getFinder().run).toBeNull();
    expect(getFinder().page).toBe('conds');
    resetFinder();
    setFinderSpawn(undefined);
  });
});

describe('照故事找世界:列表里的小图', () => {
  it('最合的那种配法带小图:4:3、每个像素都有国家和地形、国都在图里', () => {
    const q = FINDER_PRESETS.find((p) => p.id === 'sea-power')!.query;
    const r = searchSeed(q, { world: { ...DEFAULT_PARAMS } }, 4);
    const c = r.cands[r.best[0]];
    expect(c?.thumb).toBeTruthy();
    const t = c.thumb!;
    expect([t.w, t.h]).toEqual([96, 72]);
    expect(t.px.length).toBe(96 * 72);
    expect(t.ter.length).toBe(96 * 72);
    expect(Math.max(...t.px)).toBeLessThan(t.pal.length);
    expect(Math.max(...t.ter)).toBeLessThanOrEqual(5);
    // 故事里那一国铺在图上,国都在图里
    expect(t.px.some((v) => v >= 2)).toBe(true);
    expect(t.dots).toHaveLength(2);
    expect(t.dots[0]).toBeGreaterThanOrEqual(0);
    expect(t.dots[0]).toBeLessThanOrEqual(96);
    expect(t.dots[1]).toBeGreaterThanOrEqual(0);
    expect(t.dots[1]).toBeLessThanOrEqual(72);
    // 差两条以上的配法不带小图(省得一批结果占太多内存)
    for (const k of r.cands.keys()) if (!r.best.includes(k)) expect(r.cands[k].thumb).toBeUndefined();
  });
});

describe('照故事找世界:用这个世界', () => {
  it('记下谁是谁、隘口交界的小字;撑过了才写讲多久', () => {
    const c = cand();
    c.places = [
      { cond: 5, kind: 'pass', cell: 900, region: 40, polities: [3, 8] },
      { cond: 6, kind: 'junction', cell: 77, region: 77, polities: [3, 8, 11], free: false },
    ];
    const detail = {
      roles: [
        { name: '大月王朝', capital: '霞都', neighbors: ['甲', '乙', '丙', '丁'], size: 107 },
        { name: '东萨富斯坦汗国', capital: '卡杜沙赫尔', neighbors: ['大月王朝'], size: 29 },
      ],
      places: [
        { ...c.places[0], name: '米里亚', owner: '东萨富斯坦汗国', others: [], x: 0, y: 0 },
        { ...c.places[1], name: '金霞域', owner: null, others: ['后九衍王朝'], x: 0, y: 0 },
      ],
    };
    const p = foundPickOf(MOUNTAIN, c, c.places, detail, { map: 'each', params: { ...DEFAULT_PARAMS } });
    expect(p.roles.map((r) => r.note)).toEqual(['都霞都，和 4 国接壤', '都卡杜沙赫尔，边界两成是翻山']);
    expect(p.places.map((x) => [x.title, x.note])).toEqual([
      ['隘口', '米里亚一带，口子 173 米，山脊约 1550 米'],
      ['三国交界', '金霞域，无主'],
    ]);
    expect(p.span).toBe(130);
    const short = cand(FACTS.map((f, i) => (i === 7 ? [80] : f)));
    expect(foundPickOf(MOUNTAIN, short, [], null, { map: 'each', params: { ...DEFAULT_PARAMS } }).span).toBeNull();
  });
});

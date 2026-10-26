/**
 * 照故事找世界(gen/finder、ui/finderPool.ts):
 * 条件逐条判、差一条、放宽一点能多几个(拿造出来的数);后台线程池能停、接着搜从没推过的种子往后、同一批种子谁搜都一样(假线程);
 * 真实世界里量出来的数:每种门槛留下的最合配法和逐种配法硬比出来的一样、隘口和 passes.ts 一次量整段一样、同一个种子推两遍结果一样。
 * 历史会跟着推演改,所以不写死某个种子一定合。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { crossings, measureCrossings, mergeCrossings } from '../src/gen/civ/passes';
import { finderPlan, searchCiv, searchSeed } from '../src/gen/finder/measure';
import {
  FINDER_PRESETS,
  condList,
  judge,
  judgeCond,
  nextSeeds,
  rankCompare,
  relaxCond,
  relaxCounts,
  relaxHints,
  relaxQuery,
  relaxVariants,
  summarize,
  sortRows,
  type Fact,
  type FinderCand,
  type FinderCond,
  type FinderQuery,
  type SeedReport,
} from '../src/gen/finder/query';
import { FinderSearch, finderThreads, estimateMs, type FinderThread } from '../src/ui/finderPool';
import type { FinderJob } from '../src/finderWorker';

const MOUNTAIN = FINDER_PRESETS.find((p) => p.id === 'mountain-pass')!.query;

/** 照后台线程的挑法(每种门槛各挑最合的;换一种配法 = 别的国家组合各自最合的),硬比出一份结果 */
function reportOf(q: FinderQuery, seed: number, recs: { year: number; roles: number[]; facts: Fact[] }[]): SeedReport {
  const cands: FinderCand[] = recs.map((r) => ({ ...r, names: r.roles.map((p) => `国${p}`), sizes: r.roles.map(() => 1), capitals: [], places: [], story: [] }));
  const rank = (vq: FinderQuery, i: number) => {
    const j = judge(vq, cands[i].facts);
    return { misses: j.misses, score: j.score, year: cands[i].year, roles: cands[i].roles };
  };
  const best = relaxVariants(q).map((which) => {
    const vq = relaxQuery(q, which);
    let b = -1;
    cands.forEach((_, i) => {
      if (b < 0 || rankCompare(rank(vq, i), rank(vq, b)) < 0) b = i;
    });
    return b;
  });
  return { seed, ms: 1, viable: true, tried: recs.length, cands, best, alts: [] };
}

describe('照故事找世界:条件', () => {
  it('隘口:口子比山脊低得够、能过的地方够少才合;差在哪写清楚;低得越多越好', () => {
    const c = { kind: 'pass', other: 0, gap: 800, narrow: 2 } as const;
    // [口子, 山脊, 差不多低的几对, 几对, 口子那块]
    const ok = judgeCond(c, [400, 2000, 1, 10, 5]);
    expect(ok).toMatchObject({ ok: true, value: 1600 });
    expect(ok.quality).toBeCloseTo(800 / 1200);
    expect(judgeCond(c, [400, 3000, 1, 10, 5]).quality).toBe(1);
    expect(judgeCond({ ...c, gap: 1800 }, [400, 2000, 1, 10, 5])).toMatchObject({ ok: false, why: 'gap' });
    expect(judgeCond(c, [400, 2000, 3, 10, 5])).toMatchObject({ ok: false, why: 'wide' });
    // 山脊不到推演里关隘的门槛:不像关隘
    expect(judgeCond(c, [0, 850, 1, 10, 5])).toMatchObject({ ok: false, why: 'shape' });
    expect(judgeCond(c, null)).toMatchObject({ ok: false, value: null, why: 'none' });
    // 放宽一档:低 550 米、能过 3 处
    expect(relaxCond(c)).toEqual({ ...c, gap: 550, narrow: 3 });
    expect(judgeCond(relaxCond(c)!, [400, 1000, 3, 10, 5]).ok).toBe(true);
  });

  it('大小:小国比另一国的一半小,大国 40 州以上,附近最大比每个邻国都大;放宽以后合的只多不少', () => {
    expect(judgeCond({ kind: 'size', size: 'small' }, [7, 40, 3]).ok).toBe(true);
    expect(judgeCond({ kind: 'size', size: 'small' }, [25, 40, 3]).ok).toBe(false);
    // 故事里只有它一国:不到 10 州
    expect(judgeCond({ kind: 'size', size: 'small' }, [9, 0, 3]).ok).toBe(true);
    expect(judgeCond({ kind: 'size', size: 'large' }, [39, 0, 0]).ok).toBe(false);
    expect(judgeCond({ kind: 'size', size: 'large' }, [80, 0, 0])).toMatchObject({ ok: true, quality: 1 });
    expect(judgeCond({ kind: 'size', size: 'top' }, [10, 0, 12]).ok).toBe(false);
    expect(judgeCond({ kind: 'size', min: 5, max: 9 }, [7, 0, 0])).toMatchObject({ ok: true, quality: 1 });
    // 合的条件放宽以后照样合(拿一串数挨个看)
    const conds: FinderCond[] = [
      { kind: 'size', size: 'small' },
      { kind: 'size', size: 'large' },
      { kind: 'size', size: 'medium' },
      { kind: 'neighbors', min: 4 },
      { kind: 'neighbors', max: 2 },
      { kind: 'mountain', min: 0.4 },
      { kind: 'span', years: 130 },
      { kind: 'eraEnter', era: 2, min: 15, max: 50 },
      { kind: 'start', from: 1000, to: 1200 },
      { kind: 'age', min: 7 },
      { kind: 'age', max: 3 },
      { kind: 'fate', within: 11, what: ['fall'] },
      { kind: 'war', other: 1, within: 11 },
      { kind: 'span', years: 13 },
      { kind: 'pass', other: 0, gap: 70, narrow: 2 },
    ];
    for (const c of conds) {
      const r = relaxCond(c)!;
      expect(r).not.toBeNull();
      for (let v = 0; v <= 200; v += 0.5) {
        const f: Fact = c.kind === 'size' ? [v, 40, 10] : c.kind === 'mountain' ? [v / 200] : c.kind === 'start' ? [v * 10] : c.kind === 'pass' ? [1000 - v, 1000, 1, 10, 0] : [v];
        if (judgeCond(c, f).ok) expect(judgeCond(r, f).ok).toBe(true);
      }
    }
  });

  it('交界、开场、讲多久:无主的州数另算;跟着一国进时代的,时代不对和年份不对分开说', () => {
    const j = { kind: 'junction', min: 3, unowned: true } as const;
    // [挨着最多几国, 那州, 无主的州里最多几国, 那州]
    expect(judgeCond(j, [3, 10, 2, 11]).ok).toBe(false);
    expect(judgeCond(relaxCond(j)!, [3, 10, 2, 11]).ok).toBe(true);
    expect(judgeCond({ kind: 'junction', min: 3 }, [3, 10, 3, 11]).quality).toBeGreaterThan(judgeCond({ kind: 'junction', min: 3 }, [3, 10, 0, -1]).quality);
    const s = { kind: 'start', role: 0, era: 1, enter: 2, min: 15, max: 50 } as const;
    expect(judgeCond(s, [1, 20]).ok).toBe(true);
    expect(judgeCond(s, [0, 20])).toMatchObject({ ok: false, why: 'era' });
    expect(judgeCond(s, [1, 60])).toMatchObject({ ok: false, why: 'enter' });
    expect(judgeCond(relaxCond(s)!, [1, 60]).ok).toBe(true);
    // 故事里没有国家时讲多久不用判
    expect(judgeCond({ kind: 'span', years: 100 }, null).ok).toBe(true);
    expect(judgeCond({ kind: 'span', years: 100 }, [99]).ok).toBe(false);
  });

  it('推到够用就停:开场最晚那年加上条件要看的年数(放宽以后也够看),不超过推演年数', () => {
    expect(finderPlan(MOUNTAIN)).toEqual({ from: 500, to: 2500, needEnd: 2500 + 130 });
    // 推演年数不够时,开场最晚按放宽以后的条件算(讲 130 年放宽成 100 年:开场最晚第 1900 年;原来的门槛照样判它们不合)
    const short = finderPlan(MOUNTAIN, 2000);
    expect(short.to).toBe(2000 - 100);
    expect(short.needEnd).toBe(2000);
    expect(finderPlan({ roles: [{ name: '甲', conds: [] }], together: [{ kind: 'span', years: 200 }] }, 2000).to).toBe(1850);
    const late: FinderQuery = { roles: [{ name: '甲', conds: [{ kind: 'eraEnter', era: 2, min: 0, max: 200 }] }], together: [{ kind: 'start', from: 1000, to: 1400 }] };
    const p = finderPlan(late);
    // 放宽以后开场能到 1500、进时代看到开场后 250 年
    expect(p).toEqual({ from: 900, to: 1500, needEnd: 1750 });
  });
});

describe('照故事找世界:汇总', () => {
  // 一国三条:邻国至少 4 个、至少 1 个港口、边界至少 4 成翻山
  const q: FinderQuery = { roles: [{ name: '甲', conds: [{ kind: 'neighbors', min: 4 }, { kind: 'ports', min: 1 }, { kind: 'mountain', min: 0.4 }] }], together: [] };
  const rec = (year: number, nb: number, ports: number, mtn: number, p = 0) => ({ year, roles: [p], facts: [[nb], [ports], [mtn]] as Fact[] });
  const reports = [
    reportOf(q, 1, [rec(1000, 5, 1, 0.5)]), // 全合
    reportOf(q, 2, [rec(1000, 6, 2, 0.8), rec(1100, 4, 1, 0.41)]), // 全合(第一种配法),比 1 合得好
    reportOf(q, 3, [rec(1100, 4, 1, 0.25)]), // 差一条:翻山(放宽到两成就合)
    reportOf(q, 4, [rec(1000, 3, 1, 0.3)]), // 差两条:邻国、翻山;两条都放宽才全合
    reportOf(q, 5, [rec(1000, 1, 0, 0.1)]), // 差三条
    reportOf(q, 6, [rec(1000, 4, 2, 0.3), rec(1200, 2, 0, 0.9)]), // 差一条:翻山(第二种配法差两条)
    reportOf(q, 7, [rec(1050, 3, 1, 0.6)]), // 差一条:邻国
  ];

  it('全合的排前面(合得好的在前),其次差一条(差一点点的在前);差两条以上只计数;卡在哪条数得出来', () => {
    const s = summarize(q, reports);
    expect(s.full.map((r) => r.seed)).toEqual([2, 1]);
    expect(s.full[0].cand.year).toBe(1000);
    expect(s.near.map((r) => r.seed)).toEqual([6, 7, 3]);
    expect(s.worse).toBe(2);
    // 各个世界最合的那种配法合这一条的有几个:翻山最少,卡在它
    expect(s.passCount).toEqual([4, 6, 3]);
    // 差在哪一条、差得多远
    const three = s.near.find((r) => r.seed === 3)!.verdict.checks;
    expect(three.map((c) => c.ok)).toEqual([true, true, false]);
    expect(three[2].quality).toBeCloseTo(-0.375);
    // 换排序:开场晚的在前、早的在前(全合、差一条各自排)
    expect(sortRows(q, s.near, 'late').map((r) => r.seed)).toEqual([3, 7, 6]);
    expect(sortRows(q, s.near, 'early').map((r) => r.seed)).toEqual([6, 7, 3]);
  });

  it('放宽一点:每种放宽各能有几个全合;挑给作者看的是多出最多的两条,和两条一起放宽', () => {
    const counts = relaxCounts(q, reports);
    // 港口只要一座,松不了:只有邻国、翻山两条能放宽
    expect(counts.map((h) => h.which.join())).toEqual(['0', '2', '0,2']);
    const one = (i: number) => counts.find((h) => h.which.length === 1 && h.which[0] === i)!;
    expect(one(2).full).toBe(4); // 翻山 4 成 → 2 成:种子 3、6 也合了
    expect(one(0).full).toBe(3); // 邻国 4 → 3:种子 7 也合了
    const both = counts.find((h) => h.which.join() === '0,2')!;
    expect(both.full).toBe(6);
    const hints = relaxHints(q, reports);
    expect(hints.map((h) => h.which.join())).toEqual(['2', '0', '0,2']);
    // 放宽以后的结果直接从留着的数里出
    expect(summarize(q, reports, both.variant).full.map((r) => r.seed).sort()).toEqual([1, 2, 3, 4, 6, 7]);
  });

  it('交界标哪一州跟着门槛走:要无主的标无主的那州,放宽成不要无主的标挨着最多国的那州', () => {
    const q2: FinderQuery = { roles: [], together: [{ kind: 'junction', min: 3, unowned: true }] };
    // [挨着最多几国, 那州, 无主的州里最多几国, 那州]
    const rep = reportOf(q2, 1, [{ year: 1000, roles: [], facts: [[3, 0, 1, 3]] }]);
    rep.cands[0].places = [
      { cond: 0, kind: 'junction', cell: 10, region: 0, polities: [1, 2, 3], free: false },
      { cond: 0, kind: 'junction', cell: 13, region: 3, polities: [1], free: true },
    ];
    expect(summarize(q2, [rep]).near[0].places.map((p) => p.region)).toEqual([3]);
    const relaxed = summarize(q2, [rep], relaxCounts(q2, [rep])[0].variant);
    expect(relaxed.full[0].places.map((p) => p.region)).toEqual([0]);
  });

  it('接着搜:停下时没推完的先补上,再往后;线程数、估时', () => {
    expect(nextSeeds(new Set([1, 2, 3, 5, 6]), 4)).toEqual([4, 7, 8, 9]);
    expect(nextSeeds(new Set(), 3, 201)).toEqual([201, 202, 203]);
    expect(finderThreads(8, false)).toBe(4);
    expect(finderThreads(32, false)).toBe(6);
    expect(finderThreads(8, true)).toBe(2);
    expect(estimateMs(200, 4, false)).toBeLessThan(estimateMs(100, 2, true));
  });
});

/** 假的后台线程:过一会儿交回造出来的结果;fail 里的种子报错 */
class FakeThread implements FinderThread {
  onmessage: FinderThread['onmessage'] = null;
  onerror: FinderThread['onerror'] = null;
  dead = false;
  constructor(
    private readonly make: (seed: number) => SeedReport,
    private readonly fail: Set<number>,
    readonly log: number[],
  ) {}
  postMessage(job: FinderJob): void {
    this.log.push(job.seed);
    setTimeout(() => {
      if (this.dead) return;
      if (this.fail.has(job.seed)) this.onerror?.(new Error('出错了'));
      else this.onmessage?.({ data: { id: job.id, report: this.make(job.seed) } });
    }, 2);
  }
  terminate(): void {
    this.dead = true;
  }
}

describe('照故事找世界:后台线程池', () => {
  const q: FinderQuery = { roles: [{ name: '甲', conds: [{ kind: 'neighbors', min: 4 }, { kind: 'ports', min: 1 }] }], together: [] };
  // 种子是 3 的倍数的全合、除 3 余 1 的差一条、余 2 的差两条
  const make = (seed: number) => {
    const k = seed % 3;
    return reportOf(q, seed, [{ year: 1000 + seed, roles: [0], facts: [[k === 0 ? 5 : 2], [k === 2 ? 0 : 1]] }]);
  };
  const run = (seeds: number[], threads: number, opt: { fail?: number[]; stopAfter?: number } = {}) => {
    const log: number[] = [];
    const spawned: FakeThread[] = [];
    const got: number[] = [];
    const s: FinderSearch = new FinderSearch({
      query: q,
      setup: { world: { ...DEFAULT_PARAMS } },
      seeds,
      threads,
      spawn: () => {
        const t = new FakeThread(make, new Set(opt.fail ?? []), log);
        spawned.push(t);
        return t;
      },
      onReport: (r) => {
        got.push(r.seed);
        if (opt.stopAfter && got.length >= opt.stopAfter) s.stop();
      },
    });
    return { s, log, spawned, got };
  };

  it('推完交回,一边搜一边数全合、差一条;推完关掉线程', async () => {
    const { s, spawned, got } = run([1, 2, 3, 4, 5, 6, 7, 8, 9], 3);
    const p = await s.finished;
    expect(p).toMatchObject({ state: 'done', done: 9, total: 9, full: 3, near: 3, etaMs: 0 });
    expect(got.slice().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(spawned.every((t) => t.dead)).toBe(true);
  });

  it('停下:已经交回的留着,推了一半的作废;接着搜从没推过的往后,和一口气推完一样', async () => {
    const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
    const a = run(seeds, 3, { stopAfter: 4 });
    const p = await a.s.finished;
    expect(p.state).toBe('stopped');
    expect(a.s.reports.length).toBe(4);
    expect(a.spawned.every((t) => t.dead)).toBe(true);
    // 停下以后线程交回的不再收
    await new Promise((r) => setTimeout(r, 20));
    expect(a.s.reports.length).toBe(4);
    const rest = nextSeeds(a.s.doneSeeds, 12 - 4);
    expect(rest.every((x) => !a.s.doneSeeds.has(x))).toBe(true);
    const b = run(rest, 2);
    await b.s.finished;
    const joined = [...a.s.reports, ...b.s.reports];
    const once = run(seeds, 1);
    await once.s.finished;
    // 同样的种子、同样的条件:分两次搜、开几个线程,汇总都一样
    const key = (rs: SeedReport[]) => JSON.stringify(summarize(q, rs).full.map((r) => [r.seed, r.cand.year]));
    expect(key(joined)).toBe(key(once.s.reports));
    expect(joined.map((r) => r.seed).sort((x, y) => x - y)).toEqual(seeds);
    // 种子从小到大派
    expect(once.log).toEqual(seeds);
  });

  it('出错之间推完了别的不算接连出错,照样推完;接连出错才停', async () => {
    const a = run([1, 2, 3, 4, 5, 6, 7, 8, 9], 1, { fail: [1, 3, 5, 7] });
    expect(await a.s.finished).toMatchObject({ state: 'done', done: 9 });
    expect(a.s.reports.filter((r) => r.error).map((r) => r.seed)).toEqual([1, 3, 5, 7]);
    const b = run([1, 2, 3, 4, 5, 6], 1, { fail: [1, 2, 3, 4, 5] });
    const p = await b.s.finished;
    expect(p.state).toBe('stopped');
    expect(p.error).toBeTruthy();
  });

  it('暂停时不派新的,接着以后推完;线程出错的种子记一份出错的、换一个线程接着推', async () => {
    const { s, log } = run([1, 2, 3, 4, 5, 6], 2, { fail: [3] });
    s.pause();
    await new Promise((r) => setTimeout(r, 30));
    expect(log.length).toBe(2);
    expect(s.progress().state).toBe('paused');
    s.resume();
    const p = await s.finished;
    expect(p.state).toBe('done');
    expect(p.done).toBe(6);
    expect(s.reports.find((r) => r.seed === 3)?.error).toBeTruthy();
  });
});

describe('照故事找世界:真实世界', () => {
  it('每种门槛留下的最合配法和逐种配法硬比出来的一样;隘口和一次量两国整段交界一样;国名、国都、地方、后来怎样都给', { timeout: 120_000 }, () => {
    const q = MOUNTAIN;
    const plan = finderPlan(q);
    const w = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
    const civ = generateCiv(w, { endYear: plan.needEnd });
    const all: { year: number; roles: number[]; facts: Fact[] }[] = [];
    const rep = searchCiv(q, w, civ, plan, (year, roles, facts) => all.push({ year, roles: roles.slice(), facts: facts.slice() }));
    expect(rep.viable).toBe(true);
    expect(rep.tried).toBe(all.length);
    expect(all.length).toBeGreaterThan(100);
    const list = condList(q);
    // 每种门槛:后台线程挑的 = 逐种配法硬比出来的
    relaxVariants(q).forEach((which, v) => {
      const vq = relaxQuery(q, which);
      let best: { misses: number; score: number; year: number; roles: number[] } | null = null;
      for (const c of all) {
        const j = judge(vq, c.facts);
        const r = { misses: j.misses, score: j.score, year: c.year, roles: c.roles };
        if (!best || rankCompare(r, best) < 0) best = r;
      }
      const got = rep.cands[rep.best[v]];
      expect([got.year, got.roles]).toEqual([best!.year, best!.roles]);
      // 放宽只会差得更少
      if (v) expect(judge(vq, got.facts).misses).toBeLessThanOrEqual(judge(q, rep.cands[rep.best[0]].facts).misses);
    });
    const pi = list.findIndex((r) => r.cond.kind === 'pass');
    const ji = list.findIndex((r) => r.cond.kind === 'junction');
    const reg = civ.regions;
    /** 陆上相邻的州(不算海峡 3、航线 4) */
    const land = (r: number) => {
      const out: number[] = [];
      for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) if (reg.adjKind[k] !== 3 && reg.adjKind[k] !== 4) out.push(reg.adj[k]);
      return out;
    };
    for (const cd of rep.cands) {
      const own = ownersAt(civ, cd.year).polity;
      // 交界:逐州硬数一遍(那州和陆上邻州分属几家,只数故事里的国家和它们的邻国)
      const cluster = new Set(cd.roles);
      for (let r = 0; r < reg.count; r++) if (cd.roles.includes(own[r])) for (const x of land(r)) if (own[x] >= 0) cluster.add(own[x]);
      let all = 0;
      let free = 0;
      for (let r = 0; r < reg.count; r++) {
        const n = new Set([own[r], ...land(r).map((x) => own[x])].filter((x) => cluster.has(x))).size;
        all = Math.max(all, n);
        if (own[r] < 0) free = Math.max(free, n);
      }
      expect([cd.facts[ji]![0], cd.facts[ji]![2]]).toEqual([all, free]);
      // 故事里的国家各不相同、那年都有地,州数对得上
      expect(new Set(cd.roles).size).toBe(cd.roles.length);
      cd.roles.forEach((p, i) => expect(own.filter((o) => o === p).length).toBe(cd.sizes[i]));
      expect(cd.names.every((n) => n.length > 0)).toBe(true);
      expect(cd.capitals.length).toBe(cd.roles.length);
      expect(cd.facts.length).toBe(list.length);
      // 隘口:和 passes.ts 一次量两国整段交界一样
      const [e, s] = cd.roles;
      const cells: number[] = [];
      for (let r = 0; r < civ.regions.count; r++) if (own[r] === s) for (let k = civ.regions.cellStart[r]; k < civ.regions.cellStart[r + 1]; k++) cells.push(civ.regions.cells[k]);
      const m = measureCrossings(crossings(w, cells, (j) => civ.regions.of[j] >= 0 && own[civ.regions.of[j]] === e));
      expect(cd.facts[pi]).toEqual(m ? [m.height, m.ridge, m.narrow, m.pairs, m.cell] : null);
      // 隘口那块在两国交界上
      const pass = cd.places.find((x) => x.kind === 'pass');
      if (pass) expect([e, s]).toContain(own[civ.regions.of[pass.cell]]);
      // 后来怎样:开场以后、按年份
      for (let i = 0; i < cd.story.length; i++) {
        expect(cd.story[i].year).toBeGreaterThanOrEqual(cd.year);
        if (i) expect(cd.story[i].year).toBeGreaterThanOrEqual(cd.story[i - 1].year);
      }
    }
    // 换一种配法:别的国家组合、差一条以内
    const top = rep.cands[rep.best[0]];
    for (const i of rep.alts) {
      expect(rep.cands[i].roles.join()).not.toBe(top.roles.join());
      expect(judge(q, rep.cands[i].facts).misses).toBeLessThanOrEqual(1);
    }
    // 占地:同一州丢了又夺回来只算一次(和编年史逐条数的一样)
    const q2: FinderQuery = {
      roles: [{ name: '甲', conds: [{ kind: 'size', size: 'large' }] }, { name: '乙', conds: [{ kind: 'conquer', other: 0, dir: 'lost', within: 300, min: 2 }] }],
      together: [],
    };
    const rep2 = searchCiv(q2, w, civ, finderPlan(q2));
    expect(rep2.cands.length).toBeGreaterThan(0);
    for (const cd of rep2.cands) {
      const [a, b] = cd.roles;
      const caps = civ.annals.filter((e) => e.kind === 'conquer' && e.a === a && e.b === b && e.year >= cd.year).sort((x, y) => x.year - y.year);
      const seen = new Set<number>();
      const want: number[] = [];
      for (const e of caps) if (!seen.has(e.region)) seen.add(e.region), want.push(e.year - cd.year);
      expect(cd.facts[1]).toEqual(want);
    }
    // 同一个推完的世界再量一遍,一模一样
    expect(JSON.stringify(searchCiv(q, w, civ, plan))).toBe(JSON.stringify(rep));
  });

  it('并一并几段交界和一次量整段一样(两国交界 = 两边各州之间的几段)', () => {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
    const civ = generateCiv(w, { endYear: 0 });
    const reg = civ.regions;
    let checked = 0;
    for (let a = 0; a < reg.count && checked < 20; a++) {
      const nbs: number[] = [];
      for (let k = reg.adjStart[a]; k < reg.adjStart[a + 1]; k++) if (reg.adj[k] !== a) nbs.push(reg.adj[k]);
      if (nbs.length < 2) continue;
      const mine = reg.cells.subarray(reg.cellStart[a], reg.cellStart[a + 1]);
      const parts = nbs.map((b) => crossings(w, mine, (j) => reg.of[j] === b));
      const whole = crossings(w, mine, (j) => nbs.includes(reg.of[j]));
      const merged = mergeCrossings(parts);
      expect([merged.low, merged.cell, merged.hs.slice().sort((x, y) => x - y)]).toEqual([whole.low, whole.cell, whole.hs.slice().sort((x, y) => x - y)]);
      expect(measureCrossings(merged)).toEqual(measureCrossings(whole));
      checked++;
    }
    expect(checked).toBe(20);
  });

  it('同一个种子推两遍,结果一样(用时除外)', { timeout: 120_000 }, () => {
    const q: FinderQuery = { ...MOUNTAIN, together: [...MOUNTAIN.together.filter((c) => c.kind !== 'start'), { kind: 'start', from: 1500, to: 1800 }] };
    const a = searchSeed(q, { world: { ...DEFAULT_PARAMS } }, 3);
    const b = searchSeed(q, { world: { ...DEFAULT_PARAMS } }, 3);
    expect(a.error).toBeUndefined();
    expect(JSON.stringify({ ...a, ms: 0 })).toBe(JSON.stringify({ ...b, ms: 0 }));
    // 开场年份都在要找的那几年里(含放宽以后的)
    const plan = finderPlan(q);
    expect(a.cands.length).toBeGreaterThan(0);
    expect(a.cands.every((c) => c.year >= plan.from && c.year <= plan.to)).toBe(true);
  });
});

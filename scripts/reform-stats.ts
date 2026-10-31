/**
 * 改制(reform.ts)的多种子统计:npx tsx scripts/reform-stats.ts [个数=20] [from=1] [years=…]
 * 每个种子一行:推演耗时(毫秒)、改制几次(立宪办成、立宪妥协、废君办成、革命打进国都、革命据地自立、政变、复辟迎回旧王室、
 * 复辟自立为君、还政、扩大参与办成)、改制议题议了几回、每百年同时在世的国家数(平均)、大国(到过 30 州以上的)寿命中位、
 * 分裂 / 复国 / 同化 / 战争 / 大崩解的次数、非战争的大事占几成;
 * 变法议了几回(办成 / 妥协 / 搁置 / 谈崩)、办成的国家 100 年后国都那样能力和学的那国国都的差距收了几成(中位;搁置的作对照)、
 * 君主国的政变几回、议事总数。最后几行是最小 / 中位 / 最大。
 * 没有改制的版本也能跑(那几列是 0),拿来和改之前比。
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { politicsStats } from '../src/gen/civ/politics';
import { capitalAt } from '../src/gen/civ/growth';
import { CAP_COUNT, developmentAt } from '../src/gen/civ/development';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const N = Number(args.find((a) => !a.includes('=')) ?? 20);
const from = Number(opt('from') ?? 1);
const BIG = 30;
const WAR_KINDS = new Set(['war', 'battle', 'conquer', 'peace', 'sack', 'ruin', 'stand', 'winter', 'breach', 'defy']);
const rows: Record<string, number>[] = [];
/** 变法 100 年后差距收了几成:办成 / 搁置(所有种子合起来) */
const closed: Record<'成' | '搁', number[]> = { 成: [], 搁: [] };
const median = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[v.length >> 1] : NaN);
for (let seed = from; seed < from + N; seed++) {
  const params = { seed } as WorldParams;
  const w = generateWorld(params);
  const t0 = performance.now();
  const civ = generateCiv(w, opt('years') ? { endYear: Number(opt('years')) } : undefined);
  const ms = performance.now() - t0;
  const A = civ.annals;
  const count = (f: (a: (typeof A)[number]) => boolean) => A.filter(f).length;
  const council = (issue: number, n: number) => count((a) => a.kind === 'council' && a.war === issue && a.n === n);
  const reform = (n: number, f: (a: (typeof A)[number]) => boolean = () => true) => count((a) => (a.kind as string) === 'reform' && a.n === n && f(a));
  const ps = politicsStats(civ);
  const R = civ.regions.count;
  let aliveSum = 0;
  let samples = 0;
  const peak = new Map<number, number>();
  for (let y = 100; y <= civ.endYear; y += 100) {
    const own = ownersAt(civ, y);
    const size = new Map<number, number>();
    for (let r = 0; r < R; r++) if (own.polity[r] >= 0) size.set(own.polity[r], (size.get(own.polity[r]) ?? 0) + 1);
    aliveSum += size.size;
    samples++;
    for (const [p, n] of size) peak.set(p, Math.max(peak.get(p) ?? 0, n));
  }
  const lives = civ.polities
    .filter((p) => (peak.get(p.id) ?? 0) >= BIG)
    .map((p) => (p.ended ?? civ.endYear) - p.founded)
    .sort((a, b) => a - b);
  const wars = count((a) => a.kind === 'war');
  // 变法:学的那一样,本国国都和那国国都的差距(议的那年 → 100 年后;两国都还在才算)
  const capOf = (p: number, y: number) => {
    const P = civ.polities[p];
    return P && P.founded <= y && (P.ended ?? Infinity) > y ? civ.settlements[capitalAt(P, y)].region : -1;
  };
  for (const e of A) {
    if (e.kind !== 'council' || e.war !== 15 || (e.n !== 0 && e.n !== 2) || e.year + 100 > civ.endYear || e.opt === undefined) continue;
    const gapAt = (y: number) => {
      const a = capOf(e.a, y);
      const b = capOf(e.b, y);
      if (a < 0 || b < 0) return NaN;
      const lv = developmentAt(civ.development!, y);
      return lv[b * CAP_COUNT + e.opt!] - lv[a * CAP_COUNT + e.opt!];
    };
    const g0 = gapAt(e.year);
    const g1 = gapAt(e.year + 100);
    if (g0 > 0 && Number.isFinite(g1)) closed[e.n === 0 ? '成' : '搁'].push(1 - g1 / g0);
  }
  // 君主国的政变:政变开的那一段前面是王室的一段
  const crownCoup = count((a) => {
    if ((a.kind as string) !== 'reform' || a.n !== 1) return false;
    const d = civ.polities[a.a].dynasties ?? [];
    const i = d.findIndex((x) => x.year === a.year && x.regime === 'junta');
    return i > 0 && !d[i - 1].regime && civ.polities[a.a].lineage !== 'republic';
  });
  const nonWar = A.filter((a) => !WAR_KINDS.has(a.kind)).length / Math.max(1, A.length);
  const row: Record<string, number> = {
    seed,
    ms: Math.round(ms),
    宪成: council(11, 0),
    宪半: council(11, 1),
    废君: council(13, 0),
    革命: reform(0),
    自立: count((a) => a.kind === 'split' && (a.cause as string) === 'revolution'),
    政变: reform(1),
    复辟旧: reform(2, (a) => a.b >= 0),
    复辟新: reform(2, (a) => a.b < 0),
    还政: council(14, 0),
    扩参: council(12, 0),
    议改: count((a) => a.kind === 'council' && a.war >= 11),
    在世: Math.round((aliveSum / Math.max(1, samples)) * 10) / 10,
    大国寿: lives.length ? lives[lives.length >> 1] : 0,
    分裂: ps.splits,
    复国: ps.restorations,
    同化: count((a) => a.kind === 'assimilate'),
    战争: wars,
    非战: Math.round(nonWar * 1000) / 1000,
    崩解: count((a) => a.kind === 'collapse'),
    法成: council(15, 0),
    法半: council(15, 1),
    法搁: council(15, 2),
    法崩: council(15, 3),
    君政变: crownCoup,
    议事: count((a) => a.kind === 'council'),
  };
  rows.push(row);
  console.log(Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' '));
}
const keys = Object.keys(rows[0]).filter((k) => k !== 'seed');
const stat = (k: string) => {
  const v = rows.map((r) => r[k]).sort((a, b) => a - b);
  return [v[0], v[v.length >> 1], v[v.length - 1], v.reduce((a, b) => a + b, 0)];
};
for (const [i, name] of ['最小', '中位', '最大', '合计'].entries()) console.log(`${name}: ` + keys.map((k) => `${k}=${Math.round(stat(k)[i] * 1000) / 1000}`).join(' '));
console.log(`变法 100 年后差距收了几成(中位):办成 ${median(closed.成).toFixed(2)}(${closed.成.length} 回)、搁置 ${median(closed.搁).toFixed(2)}(${closed.搁.length} 回)`);

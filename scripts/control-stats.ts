/**
 * 中央管到什么程度(control.ts)前后的多种子统计:npx tsx scripts/control-stats.ts [个数=20] [from=1] [cells=…]
 * 每个种子一行:推演耗时、分裂 / 复国 / 大崩解 / 同化 / 割据 / 收回 / 抗命 / 国用不足(因为打仗、因为拖欠)的次数、
 * 议事(council.ts)的次数:合计、各议题(罢直征 / 削藩 / 直征 / 改土归流 / 分封 / 收兵权 / 放兵权 / 收任免 / 放任免 / 改组 / 脱离)、
 * 各结果(办成 / 妥协 / 搁置 / 谈崩)、削藩谈崩起兵自立的次数、每百年同时在世的国家数(平均、最多)、
 * 大国(到过 30 州以上的)寿命的中位数、第 1500 年和结束那年中央管得到几成的四档各几州。最后一行是最小 / 中位 / 最大
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { politicsStats } from '../src/gen/civ/politics';
import { controlAt, controlTier } from '../src/gen/civ/control';
import { councilStats } from '../src/gen/civ/council';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const N = Number(args.find((a) => !a.includes('=')) ?? 20);
const from = Number(opt('from') ?? 1);
const BIG = 30;
const rows: Record<string, number>[] = [];
/** 各议题 × 各结果,全部种子加起来 */
const byIssue: number[][] = [];
for (let seed = from; seed < from + N; seed++) {
  const params = { seed } as WorldParams;
  if (opt('cells')) params.cells = Number(opt('cells'));
  const w = generateWorld(params);
  const t0 = performance.now();
  const civ = generateCiv(w);
  const ms = performance.now() - t0;
  const count = (k: string) => civ.annals.filter((a) => a.kind === k).length;
  const ps = politicsStats(civ);
  const R = civ.regions.count;
  // 每百年:同时在世的国家数、各国州数(大国 = 到过 BIG 州以上)
  let aliveSum = 0;
  let aliveMax = 0;
  let samples = 0;
  const peak = new Map<number, number>();
  for (let y = 100; y <= civ.endYear; y += 100) {
    const own = ownersAt(civ, y);
    const size = new Map<number, number>();
    for (let r = 0; r < R; r++) if (own.polity[r] >= 0) size.set(own.polity[r], (size.get(own.polity[r]) ?? 0) + 1);
    aliveSum += size.size;
    aliveMax = Math.max(aliveMax, size.size);
    samples++;
    for (const [p, n] of size) peak.set(p, Math.max(peak.get(p) ?? 0, n));
  }
  const lives = civ.polities
    .filter((p) => (peak.get(p.id) ?? 0) >= BIG)
    .map((p) => (p.ended ?? civ.endYear) - p.founded)
    .sort((a, b) => a - b);
  // 第 1500 年、结束那年四档各几州
  const tiersAt = (y: number) => {
    const t = [0, 0, 0, 0];
    const c = controlAt(civ, y);
    if (c) for (let r = 0; r < R; r++) if (c[r] > 0) t[controlTier(c[r])]++;
    return t;
  };
  const mid = tiersAt(1500);
  const cs = councilStats(civ);
  cs.byIssue.forEach((o, i) => o.forEach((n, j) => ((byIssue[i] ??= [0, 0, 0, 0])[j] += n)));
  const tiers = tiersAt(civ.endYear);
  rows.push({
    seed,
    ms: Math.round(ms),
    split: ps.splits,
    restore: ps.restorations,
    collapse: count('collapse'),
    assim: count('assimilate'),
    revolt: count('revolt'),
    war: count('war'),
    warlord: count('warlord'),
    reclaim: count('reclaim'),
    defy: count('defy'),
    fiscalWar: civ.annals.filter((a) => a.kind === 'fiscal' && a.war === 0).length,
    fiscalOwe: civ.annals.filter((a) => a.kind === 'fiscal' && a.war === 1).length,
    council: cs.total,
    untax: cs.issues[0],
    cut: cs.issues[1],
    tax: cs.issues[2],
    unfief: cs.issues[3],
    fief: cs.issues[4],
    armyIn: cs.issues[5],
    armyOut: cs.issues[6],
    officeIn: cs.issues[7],
    officeOut: cs.issues[8],
    reorg: cs.issues[9],
    leave: cs.issues[10],
    done: cs.outcomes[0],
    half: cs.outcomes[1],
    shelve: cs.outcomes[2],
    broken: cs.outcomes[3],
    alive: Math.round((10 * aliveSum) / Math.max(1, samples)) / 10,
    aliveMax,
    big: lives.length,
    bigLife: lives.length ? lives[lives.length >> 1] : NaN,
    d1500: mid[0],
    p1500: mid[1],
    a1500: mid[2],
    l1500: mid[3],
    direct: tiers[0],
    proxy: tiers[1],
    auto: tiers[2],
    lord: tiers[3],
  });
  console.log(Object.entries(rows[rows.length - 1]).map(([k, v]) => `${k} ${v}`).join('  '));
}
const keys = Object.keys(rows[0]).filter((k) => k !== 'seed');
const q = (k: string) => {
  const a = rows.map((r) => r[k]).filter((x) => x === x).sort((x, y) => x - y);
  const sum = a.reduce((s, x) => s + x, 0);
  return `${k} ${a[0]}/${a[a.length >> 1]}/${a[a.length - 1]} (合 ${Math.round(sum * 10) / 10})`;
};
console.log('min/med/max  ' + keys.map(q).join('  '));
const ISSUE_NAMES = ['罢直征', '削藩', '直征', '改土归流', '分封', '收兵权', '放兵权', '收任免', '放任免', '改组', '脱离'];
console.log('议题(办成/妥协/搁置/谈崩)  ' + byIssue.map((o, i) => `${ISSUE_NAMES[i]} ${o.join('/')}`).join('  '));

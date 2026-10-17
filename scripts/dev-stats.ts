/**
 * 发展度影响推演的多种子统计:npx tsx scripts/dev-stats.ts [个数=20] [from=1] [cells=…]
 * 每个种子一行:推演耗时、立国(含分裂)/ 亡国 / 战争 / 攻占 / 分裂数、第 3000 年最大国占有人州的比例、
 * 有海外领土(和国都不在同一块陆地)的普通国家数(第 2000、2500、3000 年)、最早能远洋的普通国家的年份、
 * 第 3000 年大城(≥ 8 万)数和最大的城、世上首入青铜 / 铁器 / 中古 / 火药的年份。最后一行是最小 / 中位 / 最大
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { capitalAt, populationAt } from '../src/gen/civ/growth';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const N = Number(args.find((a) => !a.includes('=')) ?? 20);
const from = Number(opt('from') ?? 1);
const rows: Record<string, number>[] = [];
for (let seed = from; seed < from + N; seed++) {
  const params = { seed } as WorldParams;
  if (opt('cells')) params.cells = Number(opt('cells'));
  const w = generateWorld(params);
  const t0 = performance.now();
  const civ = generateCiv(w);
  const ms = performance.now() - t0;
  const reg = civ.regions;
  const count = (k: string) => civ.annals.filter((a) => a.kind === k).length;
  const overseas = (y: number) => {
    const own = ownersAt(civ, y);
    let n = 0;
    for (const p of civ.polities) {
      if (p.kind === 'sea' || !(p.founded <= y) || (p.ended ?? Infinity) <= y) continue;
      const home = reg.landmass[civ.settlements[capitalAt(p, y)].region];
      for (let r = 0; r < reg.count; r++) {
        if (own.polity[r] === p.id && reg.landmass[r] !== home) {
          n++;
          break;
        }
      }
    }
    return n;
  };
  const own = ownersAt(civ, 3000);
  const size = new Map<number, number>();
  let occ = 0;
  for (let r = 0; r < reg.count; r++) {
    if (own.culture[r] >= 0) occ++;
    if (own.polity[r] >= 0) size.set(own.polity[r], (size.get(own.polity[r]) ?? 0) + 1);
  }
  const pops = civ.settlements.map((s) => populationAt(s, 3000));
  const firstEra = (k: number) => civ.development?.events.find((e) => e.kind === 'first' && e.era === k)?.year ?? NaN;
  const sail = civ.polities.filter((p) => p.sail !== undefined).map((p) => p.sail!);
  rows.push({
    seed,
    ms: Math.round(ms),
    found: count('found') + count('split'),
    fall: civ.polities.filter((p) => p.ended !== undefined).length,
    war: count('war'),
    conquer: count('conquer'),
    split: count('split'),
    top: Math.round((100 * Math.max(0, ...size.values())) / Math.max(1, occ)),
    sea20: overseas(2000),
    sea25: overseas(2500),
    sea30: overseas(3000),
    sail: Math.round(sail.length ? Math.min(...sail) : civ.sailFrom ?? NaN),
    sails: sail.length,
    big: pops.filter((x) => x >= 80).length,
    maxPop: Math.round(Math.max(0, ...pops)),
    bronze: Math.round(firstEra(1)),
    iron: Math.round(firstEra(2)),
    medi: Math.round(firstEra(3)),
    gun: Math.round(firstEra(4)),
  });
  console.log(Object.entries(rows[rows.length - 1]).map(([k, v]) => `${k} ${v}`).join('  '));
}
const keys = Object.keys(rows[0]).filter((k) => k !== 'seed');
const q = (k: string) => {
  const a = rows.map((r) => r[k]).filter((x) => x === x).sort((x, y) => x - y);
  return `${k} ${a[0]}/${a[a.length >> 1]}/${a[a.length - 1]}`;
};
console.log('min/med/max  ' + keys.map(q).join('  '));

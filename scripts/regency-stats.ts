/**
 * 掌实权、联姻(regents.ts、marriages.ts)前后的多种子统计:npx tsx scripts/regency-stats.ts [个数=20] [from=1] [cells=…] [json=输出文件]
 * 每个种子一行:推演耗时;掌权各种几段(引兵入朝 / 太子监国 / 宗室摄政 / 名臣辅政 / 大臣专权 / 大将专权)、平均几年、
 * 怎么结束的(即位 / 还政 / 伏诛 / 篡位 / 卒 / 名义君主先没了 / 改朝换代亡国 / 推到最后还在);结亲几门(互嫁、和亲);
 * 战争、大崩解、分裂、复国、改朝换代的次数,大国(到过 30 州以上的)寿命的中位数,每百年同时在世的国家数(平均),
 * 割据、收回、抗命、议事、立约、背约、放逐的次数。
 * 最后几行是合计 / 最小 / 中位 / 最大,再各种掌权怎么了结的各占几成;没有掌权、联姻的版本(旧版)那几列是 0
 */
import { writeFileSync } from 'node:fs';
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { politicsStats } from '../src/gen/civ/politics';
import { controlStats } from '../src/gen/civ/control';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const N = Number(args.find((a) => !a.includes('=')) ?? 20);
const from = Number(opt('from') ?? 1);
const BIG = 30;
const KINDS = ['march', 'heir', 'uncle', 'minister', 'chancellor', 'general'];
const ENDS = ['succeed', 'return', 'purged', 'usurp', 'died', 'ruler', 'fallen', 'open'];
const rows: Record<string, number>[] = [];
/** 掌权的种类 | 怎么了结 → 段数(全部种子合计) */
const matrix = new Map<string, number>();
for (let seed = from; seed < from + N; seed++) {
  const params = { seed } as WorldParams;
  if (opt('cells')) params.cells = Number(opt('cells'));
  const w = generateWorld(params);
  const t0 = performance.now();
  const civ = generateCiv(w);
  const ms = performance.now() - t0;
  const count = (k: string) => civ.annals.filter((a) => (a.kind as string) === k).length;
  const ps = politicsStats(civ);
  const cs = controlStats(civ);
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
  const row: Record<string, number> = {
    seed,
    ms: Math.round(ms),
    war: count('war'),
    collapse: count('collapse'),
    split: ps.splits,
    claim: ps.claims,
    splitLord: civ.annals.filter((a) => a.kind === 'split' && a.cause === 'warlord').length,
    restore: ps.restorations,
    dynasty: count('dynasty'),
    bigLife: lives.length ? lives[lives.length >> 1] : 0,
    alive: samples ? Math.round((10 * aliveSum) / samples) / 10 : 0,
    warlord: cs.warlords,
    reclaim: cs.reclaims,
    defy: cs.defies,
    council: count('council'),
    treaty: count('treaty'),
    breach: count('breach'),
    exile: count('exile'),
  };
  // 掌权:按人物上记的段(people.ts)
  type Seg = { kind: string; from: number; until?: number; end?: string };
  const segs: Seg[] = [];
  for (const x of civ.people ?? []) for (const g of ((x as { regencies?: Seg[] }).regencies ?? [])) segs.push(g);
  for (const k of KINDS) {
    const mine = segs.filter((g) => g.kind === k);
    row[k] = mine.length;
    const done = mine.filter((g) => g.until !== undefined);
    row[`${k}Y`] = done.length ? Math.round((10 * done.reduce((s, g) => s + (g.until! - g.from), 0)) / done.length) / 10 : 0;
  }
  for (const e of ENDS) row[`end_${e}`] = segs.filter((g) => (g.end ?? 'open') === e).length;
  for (const g of segs) {
    const key = `${g.kind}|${g.end ?? 'open'}`;
    matrix.set(key, (matrix.get(key) ?? 0) + 1);
  }
  const marry = civ.annals.filter((a) => (a.kind as string) === 'marry');
  row.marry = marry.length;
  row.peaceMatch = marry.filter((a) => a.war >= 0).length;
  row.mutual = marry.filter((a, i) => i > 0 && marry[i - 1].year === a.year && marry[i - 1].a === a.b && marry[i - 1].b === a.a).length;
  rows.push(row);
  console.log(Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' '));
}
const keys = Object.keys(rows[0]).filter((k) => k !== 'seed');
const col = (k: string) => rows.map((r) => r[k]).sort((a, b) => a - b);
console.log('合计 ' + keys.map((k) => `${k}=${Math.round(10 * col(k).reduce((s, v) => s + v, 0)) / 10}`).join(' '));
console.log('最小 ' + keys.map((k) => `${k}=${col(k)[0]}`).join(' '));
console.log('中位 ' + keys.map((k) => `${k}=${col(k)[col(k).length >> 1]}`).join(' '));
console.log('最大 ' + keys.map((k) => `${k}=${col(k)[col(k).length - 1]}`).join(' '));
// 各种掌权怎么了结的(各占几成)
for (const k of KINDS) {
  const n = ENDS.reduce((s, e) => s + (matrix.get(`${k}|${e}`) ?? 0), 0);
  if (!n) continue;
  console.log(`${k} ${n} 段:` + ENDS.filter((e) => matrix.get(`${k}|${e}`)).map((e) => `${e} ${Math.round((100 * matrix.get(`${k}|${e}`)!) / n)}%`).join(' '));
}
if (opt('json')) writeFileSync(opt('json')!, JSON.stringify({ rows, matrix: [...matrix] }));

/**
 * 国家方针的多种子统计:npx tsx scripts/policy-stats.ts [个数=20] [from=1] [T=1200] [W=300] [top=3]
 * 每个种子取第 T 年州最多的 top 个国家,各自从第 T 年起定方针、推到 T + W 年,和不定方针的同一个世界比(配对):
 * - 四种一键选(扩张 / 守成 / 商贸 / 和平发展):T + W 年的州数(亡了算 0)、这段时间它挑起的战争数、它挑起的仗平均打几年、
 *   发展重点那一样能力(第 T 年它的国土上的平均,T + W 年)
 * - 仇:第 T 年接壤、编号最小的邻国当仇国,它对这国开战几次
 * - 亲:不定方针时这段时间它打得最多的邻国当亲国,它对这国开战几次;两国结盟几次
 * 最后打印汇总(合计、比不定方针多 / 少的有几个)。只用于调参和写 PR,不进测试
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { CAP_COUNT, developmentAt } from '../src/gen/civ/development';
import { POLICY_PRESETS } from '../src/gen/civ/policy';
import { POLICY_FOCI, POLICY_PRESETS_KEYS, polityKey, type Intervention, type PolicyPreset } from '../src/gen/edits';

const args = process.argv.slice(2);
const opt = (k: string, d: number) => Number(args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1) ?? d);
const N = Number(args.find((a) => !a.includes('=')) ?? 20);
const FROM = opt('from', 1);
const T = opt('T', 1200);
const W = opt('W', 300);
const TOP = opt('top', 3);
const END = T + W;

type Policy = Extract<Intervention, { kind: 'policy' }>;

const landsAt = (civ: Civ, pid: number, y: number) => {
  let n = 0;
  for (const o of ownersAt(civ, y).polity) if (o === pid) n++;
  return n;
};
/** pid 在 [T, END) 挑起的战争(不算援盟、救藩) */
const warsBy = (civ: Civ, pid: number, b = -1) =>
  civ.annals.filter((e) => e.kind === 'war' && e.a === pid && (b < 0 || e.b === b) && e.year >= T && e.year < END && e.cause !== 'ally' && e.cause !== 'rescue');
/** 战争打了几年(到议和;没打完的算到 END) */
const warYears = (civ: Civ, war: number, start: number) => {
  const p = civ.annals.find((e) => e.kind === 'peace' && e.war === war);
  return Math.min(p ? p.year : END, END) - start;
};
const neighborsAt = (civ: Civ, pid: number, y: number) => {
  const own = ownersAt(civ, y).polity;
  const reg = civ.regions;
  const out = new Set<number>();
  for (let r = 0; r < reg.count; r++) {
    if (own[r] !== pid) continue;
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
      const q = own[reg.adj[k]];
      if (q >= 0 && q !== pid) out.add(q);
    }
  }
  return [...out].sort((a, b) => a - b);
};
/** regions 上第 c 样能力在 END 年的平均 */
const capMean = (civ: Civ, regions: number[], c: number) => {
  if (!civ.development || !regions.length) return NaN;
  const d = developmentAt(civ.development, END);
  return regions.reduce((s, r) => s + d[r * CAP_COUNT + c], 0) / regions.length;
};

interface Row {
  [k: string]: number;
}
const rows: Row[] = [];
const t0 = performance.now();
for (let seed = FROM; seed < FROM + N; seed++) {
  const w = generateWorld({ seed } as WorldParams);
  const base = generateCiv(w, { endYear: END });
  const own = ownersAt(base, T).polity;
  const size = new Map<number, number>();
  for (const o of own) if (o >= 0) size.set(o, (size.get(o) ?? 0) + 1);
  const top = [...size.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, TOP).map((x) => x[0]);
  for (const pid of top) {
    const a = polityKey(base, pid);
    const mine: number[] = [];
    own.forEach((o, r) => o === pid && mine.push(r));
    const row: Row = { seed, pid, lands0: size.get(pid)! };
    const run = (v: Omit<Policy, 'kind' | 'a' | 'from'>) => generateCiv(w, { endYear: END, interventions: [{ kind: 'policy', a, from: T, ...v }] });
    const fill = (tag: string, civ: Civ, preset?: PolicyPreset) => {
      const ws = warsBy(civ, pid);
      row[`${tag}.lands`] = landsAt(civ, pid, END - 1 / 256);
      row[`${tag}.wars`] = ws.length;
      row[`${tag}.len`] = ws.length ? ws.reduce((s, e) => s + warYears(civ, e.war, e.year), 0) / ws.length : NaN;
      const f = preset ? POLICY_PRESETS[preset].focus : undefined;
      if (f) row[`${tag}.cap`] = capMean(civ, mine, POLICY_FOCI.indexOf(f));
    };
    fill('none', base);
    for (const k of ['trade', 'peace'] as const) row[`none.cap.${k}`] = capMean(base, mine, POLICY_FOCI.indexOf(POLICY_PRESETS[k].focus!));
    for (const k of POLICY_PRESETS_KEYS) fill(k, run({ preset: k, ...POLICY_PRESETS[k] }), k);
    // 仇:接壤、编号最小的邻国
    const near = neighborsAt(base, pid, T);
    if (near.length) {
      const foe = near[0];
      row['foe.none'] = warsBy(base, pid, foe).length;
      row['foe.set'] = warsBy(run({ foes: [polityKey(base, foe)] }), pid, foe).length;
      // 亲:不定方针时打得最多的邻国(都没打就是编号最小的)
      const hits = near.map((q) => [q, warsBy(base, pid, q).length] as const).sort((x, y) => y[1] - x[1] || x[0] - y[0]);
      const friend = hits[0][0];
      const pacts = (civ: Civ) => civ.annals.filter((e) => e.kind === 'alliance' && e.year >= T && e.year < END && ((e.a === pid && e.b === friend) || (e.a === friend && e.b === pid))).length;
      const fc = run({ friends: [polityKey(base, friend)] });
      row['friend.none'] = hits[0][1];
      row['friend.set'] = warsBy(fc, pid, friend).length;
      row['friend.pact.none'] = pacts(base);
      row['friend.pact.set'] = pacts(fc);
    }
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}

const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !['seed', 'pid'].includes(k));
const sum = (k: string) => rows.reduce((s, r) => s + (Number.isFinite(r[k]) ? r[k] : 0), 0);
const mean = (k: string) => {
  const v = rows.map((r) => r[k]).filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
};
console.log(`\n${rows.length} 个国家(${N} 个种子 × 前 ${TOP} 大),第 ${T} 年定方针,看到第 ${END} 年;用时 ${((performance.now() - t0) / 1000).toFixed(0)} 秒`);
for (const k of keys) console.log(`${k.padEnd(18)} 合计 ${sum(k).toFixed(1).padStart(8)}  平均 ${mean(k).toFixed(2)}`);
/** 比不定方针多 / 少 / 一样的几个 */
const cmp = (a: string, b: string) => {
  let more = 0;
  let less = 0;
  for (const r of rows) {
    if (!(Number.isFinite(r[a]) && Number.isFinite(r[b]))) continue;
    if (r[a] > r[b]) more++;
    else if (r[a] < r[b]) less++;
  }
  return `多 ${more} 少 ${less}`;
};
console.log('\n和不定方针比(多 / 少几个):');
for (const k of POLICY_PRESETS_KEYS) console.log(`${k.padEnd(7)} 州数 ${cmp(`${k}.lands`, 'none.lands')}  开战 ${cmp(`${k}.wars`, 'none.wars')}  仗长 ${cmp(`${k}.len`, 'none.len')}`);
console.log(`trade   运输 ${cmp('trade.cap', 'none.cap.trade')}   peace 生产 ${cmp('peace.cap', 'none.cap.peace')}`);
console.log(`仇      开战 ${cmp('foe.set', 'foe.none')}   亲 开战 ${cmp('friend.set', 'friend.none')}  结盟 ${cmp('friend.pact.set', 'friend.pact.none')}`);

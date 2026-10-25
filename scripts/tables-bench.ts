/**
 * 数表引擎的速度:npx tsx scripts/tables-bench.ts [seed=7] [years=3000] [closure=1]
 * 在真实世界的地块(默认 3.6 万块)上按地块算人口(按宜居度的 S 形增长 + 往人少的邻格搬),
 * 比较手写的循环、引擎拼函数、引擎闭包,不同频率,和十栏的扩散表(思潮这类)。每行一个方案:
 * 总耗时、每秒能推多少年、折成"每栏每地块每步"多少纳秒。最后打印一份快照多大。
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { computeHabitat } from '../src/gen/civ/habitat';
import { TableEngine, type TableCard, type Backend } from '../src/gen/civ/tables';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const seed = Number(opt('seed') ?? 7);
const YEARS = Number(opt('years') ?? 3000);
const withClosure = opt('closure') !== '0';

const t0 = performance.now();
const world = generateWorld({ seed } as WorldParams);
const hab = computeHabitat(world);
const mesh = world.mesh;
const N = mesh.n;
console.log(`世界 seed=${seed}:${N} 个地块,生成 ${Math.round(performance.now() - t0)} ms`);

const units = { tile: { count: N, adjStart: mesh.adjStart, adj: mesh.adj } };
const capCard: TableCard = { id: 'cap', name: '人口上限', unit: 'tile', input: true, min: 0, max: 1e9, off: 0 };
const popRate = 'if(cap > 0, 0.01 * pop * (1 - pop / cap), -0.05 * pop)';
const popMove = 'if(cap > 0 and nb.cap > 0, max(0, pop / cap - nb.pop / nb.cap) * 0.002 * pop, 0)';
const popInit = 'if(cap > 30, 1, 0)';

interface Row {
  name: string;
  ms: number;
  steps: number;
  cols: number;
}
const rows: Row[] = [];

function engineRun(name: string, cards: TableCard[], backend: Backend, years: number) {
  const e = new TableEngine({ seed, cards: [capCard, ...cards], units, backend });
  e.input('cap').set(hab.capacity);
  e.start(0);
  const base = Math.min(...cards.map((c) => c.every ?? 1));
  const t = performance.now();
  for (let y = 0; y <= years; y += base) e.step(y);
  const ms = performance.now() - t;
  const steps = cards.reduce((s, c) => s + Math.floor(years / (c.every ?? 1)) + 1, 0);
  const cols = cards.reduce((s, c) => s + (c.cols?.length ?? 1) * (Math.floor(years / (c.every ?? 1)) + 1), 0) / Math.max(1, steps);
  rows.push({ name, ms, steps, cols });
  if (e.incidents.length) console.log('  护栏:', e.incidents.map((i) => i.message).join(';'));
  return e;
}

// 手写的同一套算法(下限:引擎能有多快)
{
  const cap = Float64Array.from(hab.capacity);
  let cur = new Float64Array(N);
  let next = new Float64Array(N);
  for (let i = 0; i < N; i++) cur[i] = cap[i] > 30 ? 1 : 0;
  const { adjStart, adj } = mesh;
  const e = new Float64Array(adj.length);
  const t = performance.now();
  for (let y = 1; y <= YEARS; y++) {
    for (let i = 0; i < N; i++) {
      const p = cur[i];
      const c = cap[i];
      next[i] = p + (c > 0 ? 0.01 * p * (1 - p / c) : -0.05 * p);
    }
    for (let i = 0; i < N; i++) {
      const p = cur[i];
      const c = cap[i];
      let out = 0;
      for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
        const j = adj[q];
        const v = c > 0 && cap[j] > 0 ? Math.max(0, p / c - cur[j] / cap[j]) * 0.002 * p : 0;
        e[q] = v > 0 ? v : 0;
        out += e[q];
      }
      const have = Math.max(0, Math.min(p, next[i]));
      if (out > have) for (let q = adjStart[i]; q < adjStart[i + 1]; q++) e[q] *= have / out;
    }
    for (let i = 0; i < N; i++) {
      let d = 0;
      for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
        const j = adj[q];
        for (let w = adjStart[j]; w < adjStart[j + 1]; w++) if (adj[w] === i) d += e[w];
        d -= e[q];
      }
      next[i] += d;
    }
    const x = cur;
    cur = next;
    next = x;
  }
  rows.push({ name: '手写循环:人口 每年(增长 + 搬家)', ms: performance.now() - t, steps: YEARS, cols: 1 });
}

const pop = (every: number, extra: Partial<TableCard> = {}): TableCard => ({ id: 'pop', name: '人口', unit: 'tile', every, min: 0, max: 1e7, off: 0, init: popInit, rate: popRate, move: popMove, ...extra });
const e1 = engineRun('引擎拼函数:人口 每年(增长 + 搬家)', [pop(1)], 'js', YEARS);
engineRun('引擎拼函数:人口 每年(增长 + 搬家,全 0 跳过)', [pop(1, { zeroStays: true })], 'js', YEARS);
engineRun('引擎拼函数:人口 每年(只增长,不搬家)', [pop(1, { move: undefined })], 'js', YEARS);
engineRun('引擎拼函数:人口 每 5 年', [pop(5)], 'js', YEARS);
engineRun('引擎拼函数:人口 每 10 年', [pop(10)], 'js', YEARS);
engineRun('引擎拼函数:人口 每 20 年', [pop(20)], 'js', YEARS);
if (withClosure) engineRun('引擎闭包:人口 每年(增长 + 搬家)', [pop(1)], 'closure', Math.min(YEARS, 500));

// 十栏扩散(思潮这类:每栏往邻格渗,原地慢慢涨落)
const ideas: TableCard = {
  id: 'idea',
  name: '思潮',
  unit: 'tile',
  cols: Array.from({ length: 10 }, (_, i) => `c${i}`),
  min: 0,
  max: 1,
  off: 0,
  init: 'if(rand() < 0.01, 0.5, 0)',
  rate: '0.05 * (nbmean(nb.idea) - idea) - 0.001 * idea',
};
engineRun('引擎拼函数:十栏扩散 每年', [ideas], 'js', Math.min(YEARS, 1000));
engineRun('引擎拼函数:十栏扩散 每 10 年', [{ ...ideas, every: 10 }], 'js', YEARS);

console.log('');
console.log('方案 | 推了几年 | 耗时 | 每秒推几年 | 每栏每地块每步');
for (const r of rows) {
  const years = r.name.includes('闭包') ? Math.min(YEARS, 500) : r.name.includes('十栏扩散 每年') ? Math.min(YEARS, 1000) : YEARS;
  const ns = (r.ms * 1e6) / (r.steps * r.cols * N);
  console.log(`${r.name} | ${years} | ${(r.ms / 1000).toFixed(2)} 秒 | ${Math.round((years / r.ms) * 1000)} | ${ns.toFixed(1)} 纳秒`);
}
const snap = e1.snapshot();
let bytes = 0;
for (const t of Object.values(snap.tables)) bytes += t.cur.byteLength + (t.delta?.byteLength ?? 0);
console.log(`\n一份快照(人口一栏 + 输入表):${(bytes / 1024 / 1024).toFixed(2)} MB;每栏按地块的表约 ${((N * 8) / 1024).toFixed(0)} KB(加查震荡的上一步变化量再翻一倍)`);
const total = Array.from(e1.get('pop')).reduce((s, x) => s + x, 0);
const capSum = Array.from(hab.capacity).reduce((s, x) => s + x, 0);
console.log(`第 ${YEARS} 年人口总量 / 上限总量 = ${(total / capSum).toFixed(3)}`);

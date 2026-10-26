/**
 * 照故事找世界(gen/finder)在一批种子上的统计:npx tsx scripts/finder-stats.ts [例子=mountain-pass] [from=1] [to=200] [jobs=4] [out=snaps/finder.jsonl]
 * 用默认的世界参数把种子 from–to 各推一遍(jobs 个进程同时推,和网页上的后台线程一样一个进程一次推一个),
 * 每个种子的结果一行写进 out;最后打印:全合几个、差一条几个(差在哪条)、差两条以上几个、每条有几个世界合、放宽一点能多几个、
 * 全合的前几个(种子、开场年份、谁是谁)、一个种子平均推多久。
 * 只重算汇总(不重推):npx tsx scripts/finder-stats.ts [例子] file=snaps/finder.jsonl
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PARAMS } from '../src/gen/params';
import { searchSeed } from '../src/gen/finder/measure';
import { FINDER_PRESETS, condList, relaxCounts, relaxHints, summarize, type SeedReport } from '../src/gen/finder/query';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const presetId = args.find((a) => !a.includes('=')) ?? 'mountain-pass';
const preset = FINDER_PRESETS.find((p) => p.id === presetId);
if (!preset) throw new Error(`没有这个例子:${presetId}(有 ${FINDER_PRESETS.map((p) => p.id).join('、')})`);
const q = preset.query;
const from = Number(opt('from') ?? 1);
const to = Number(opt('to') ?? 200);
const part = opt('part');

if (part) {
  // 子进程:推第 i 份(种子 − from 除以 jobs 余 i 的那些),一行一个结果
  const [i, jobs] = part.split('/').map(Number);
  for (let seed = from; seed <= to; seed++) {
    if ((seed - from) % jobs !== i) continue;
    process.stdout.write(JSON.stringify(searchSeed(q, { world: { ...DEFAULT_PARAMS } }, seed)) + '\n');
  }
  process.exit(0);
}

let reports: SeedReport[];
const file = opt('file');
if (file) {
  reports = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as SeedReport);
} else {
  const jobs = Math.max(1, Number(opt('jobs') ?? 4));
  const out = opt('out') ?? 'snaps/finder.jsonl';
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, '');
  const t0 = performance.now();
  const self = fileURLToPath(import.meta.url);
  reports = [];
  await Promise.all(
    Array.from({ length: jobs }, (_, i) => {
      const child = spawn(process.execPath, [...process.execArgv, self, presetId, `from=${from}`, `to=${to}`, `part=${i}/${jobs}`], { stdio: ['ignore', 'pipe', 'inherit'] });
      let buf = '';
      child.stdout.on('data', (d: Buffer) => {
        buf += d.toString();
        let k: number;
        while ((k = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, k);
          buf = buf.slice(k + 1);
          if (!line.trim()) continue;
          fs.appendFileSync(out, line + '\n');
          const r = JSON.parse(line) as SeedReport;
          reports.push(r);
          if (reports.length % 20 === 0) console.log(`  推完 ${reports.length} / ${to - from + 1}(${Math.round((performance.now() - t0) / 1000)} 秒)`);
        }
      });
      return new Promise<void>((res, rej) => child.on('close', (code, sig) => (code === 0 ? res() : rej(new Error(`第 ${i} 个进程出错退出(${sig ?? code})`)))));
    }),
  );
  const want = to - from + 1;
  if (reports.length !== want) throw new Error(`只交回 ${reports.length} 个,应该 ${want} 个`);
  console.log(`${jobs} 个进程推完 ${reports.length} 个,用了 ${Math.round((performance.now() - t0) / 1000)} 秒;结果在 ${out}`);
}
reports.sort((a, b) => a.seed - b.seed);

const list = condList(q);
const label = (i: number) => {
  const r = list[i];
  return `${r.role >= 0 ? q.roles[r.role].name : '一起'}·${r.cond.kind}`;
};
const s = summarize(q, reports);
console.log(`例子「${preset.name}」种子 ${reports[0]?.seed}–${reports[reports.length - 1]?.seed}:推了 ${s.searched} 个,全合 ${s.full.length}、差一条 ${s.near.length}、差两条以上 ${s.worse}`);
const why = new Map<string, number>();
for (const r of s.near) {
  const i = r.verdict.checks.findIndex((c) => !c.ok);
  const k = label(i) + (r.verdict.checks[i].why ? `(${r.verdict.checks[i].why})` : '');
  why.set(k, (why.get(k) ?? 0) + 1);
}
console.log('  差一条差在:', [...why].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join('、') || '—');
console.log('  每条有几个世界合:', s.passCount.map((n, i) => `${label(i)} ${n}`).join('、'));
const counts = relaxCounts(q, reports);
console.log('  放宽一条:', counts.filter((h) => h.which.length === 1).map((h) => `${label(h.which[0])} → 全合 ${h.full}、差一条 ${h.near}`).join(';'));
const all = counts[counts.length - 1];
if (all && all.which.length > 2) console.log(`  全部放宽:全合 ${all.full}、差一条 ${all.near}`);
console.log('  放宽一点试试(挑给作者看的):', relaxHints(q, reports).map((h) => `${h.which.map(label).join(' + ')} → 全合 ${h.full}`).join(';') || '—');
for (const r of s.full.slice(0, 10))
  console.log(`  全合 种子 ${r.seed} 第 ${r.cand.year} 年:${r.cand.names.map((n, i) => `${q.roles[i]?.name ?? ''}=${n}(${r.cand.sizes[i]} 州)`).join(' ')} 合得多好 ${r.verdict.score.toFixed(2)}`);
const ok = reports.filter((r) => !r.error);
const ms = ok.map((r) => r.ms).sort((a, b) => a - b);
if (ms.length) console.log(`  一个种子:平均 ${Math.round(ms.reduce((a, b) => a + b, 0) / ms.length)} 毫秒、中位 ${ms[ms.length >> 1]}、最慢 ${ms[ms.length - 1]};出错 ${reports.length - ok.length} 个;长不出文明 ${reports.filter((r) => !r.viable && !r.error).length} 个`);

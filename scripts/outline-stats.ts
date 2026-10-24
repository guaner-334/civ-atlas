/**
 * 照大纲推演的统计:几个种子各拼一份随机大纲(scripts/lib/outlineSample.ts),照大纲推演,数照着发生了 / 硬改的 / 做不到各几成、
 * 做不到的原因、花了多久;最后核对结果和带着同样的干预从第 0 年一口气推完一样。
 *   npx tsx scripts/outline-stats.ts [条数=20] [种子=7,2024,11]
 */
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { runOutline } from '../src/gen/outline';
import type { PlotReview } from '../src/gen/edits';
import { samplePlots } from './lib/outlineSample';

const n = Number(process.argv[2] ?? 20);
const seeds = (process.argv[3] ?? '7,2024,11').split(',').map(Number);
const all: PlotReview[] = [];
const kinds = new Map<string, Record<string, number>>();
for (const seed of seeds) {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed });
  const base = generateCiv(world, {});
  const plots = samplePlots(base, seed, n);
  const t0 = performance.now();
  const out = (await runOutline(world, {}, { plots, interventions: [] }))!;
  const ms = performance.now() - t0;
  const again = generateCiv(world, { interventions: out.interventions });
  const same = JSON.stringify(again.annals) === JSON.stringify(out.civ.annals) && again.log.size === out.civ.log.size;
  const c = (s: string) => out.review.filter((r) => r.status === s).length;
  console.log(`seed ${seed}:${plots.length} 条,照着发生了 ${c('natural')}、硬改的 ${c('forced')}(${out.interventions.length} 条干预)、做不到 ${c('failed')}、只讲故事 ${c('story')};${(ms / 1000).toFixed(1)} 秒;和从第 0 年推${same ? '一样' : '不一样!'}`);
  if (process.env.SHOW) out.review.forEach((r, i) => r.status === 'failed' && console.log('   ', JSON.stringify(plots[i]), JSON.stringify(r)));
  out.review.forEach((r, i) => {
    const k = plots[i].kind;
    const m = kinds.get(k) ?? {};
    m[r.status] = (m[r.status] ?? 0) + 1;
    kinds.set(k, m);
  });
  all.push(...out.review);
}
const pct = (k: number) => `${Math.round((100 * k) / all.length)}%`;
const by = (s: string) => all.filter((r) => r.status === s).length;
console.log(`合计 ${all.length} 条:照着发生了 ${pct(by('natural'))}、硬改的 ${pct(by('forced'))}、做不到 ${pct(by('failed'))}、只讲故事 ${pct(by('story'))}`);
const why = new Map<string, number>();
for (const r of all) if (r.reason) why.set(r.reason, (why.get(r.reason) ?? 0) + 1);
console.log('做不到的原因:', [...why].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(','));
for (const [k, m] of kinds) console.log(`  ${k}: ${Object.entries(m).map(([s, v]) => `${s} ${v}`).join(',')}`);

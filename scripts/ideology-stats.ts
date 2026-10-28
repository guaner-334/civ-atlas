/**
 * 思潮的多种子统计(调参用):npx tsx scripts/ideology-stats.ts [个数=20] [from=1] [cells=…] [end=3000]
 * 每个种子一行:推演耗时;各说世上头一回冒出来的年份(没冒 = -);第 end 年还在的国家几个,最盛的是哪说(几国,最盛那说几成的中位数),
 * 一说都不到半成的几国。最后汇总:各说冒出来的年份最小 / 中位 / 最大、几个种子冒过;第 end 年各国最盛的说各占几成、几成的中位数;
 * 各说到半成的国家占几成
 */
import { generateWorld, type WorldParams } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ARRIVE, THOUGHTS, THOUGHT_COUNT, polityIdeologyAt } from '../src/gen/civ/ideology';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const N = Number(args.find((a) => !a.includes('=')) ?? 20);
const from = Number(opt('from') ?? 1);
const end = Number(opt('end') ?? 3000);
const K = THOUGHT_COUNT;
const short = THOUGHTS.map((t) => t.name.slice(0, 2));

const first: number[][] = THOUGHTS.map(() => []);
const tops: number[][] = THOUGHTS.map(() => []);
const reach = new Array<number>(K).fill(0);
let live = 0;
let none = 0;
for (let seed = from; seed < from + N; seed++) {
  const params = { seed } as WorldParams;
  if (opt('cells')) params.cells = Number(opt('cells'));
  const w = generateWorld(params);
  const t0 = performance.now();
  const civ = generateCiv(w, { endYear: end });
  const ms = performance.now() - t0;
  const ideo = civ.ideology!;
  const origin = THOUGHTS.map((_, k) => ideo.events.find((e) => e.thought === k)?.year);
  origin.forEach((y, k) => y !== undefined && first[k].push(y));
  const byTop: number[][] = THOUGHTS.map(() => []);
  let n = 0;
  let empty = 0;
  for (const p of civ.polities) {
    if (!(p.founded <= end) || (p.ended ?? Infinity) <= end) continue;
    n++;
    const v = polityIdeologyAt(ideo, p.id, end);
    let k = 0;
    for (let j = 1; j < K; j++) if (v[j] > v[k]) k = j;
    for (let j = 0; j < K; j++) if (v[j] >= ARRIVE) reach[j]++;
    if (v[k] < ARRIVE) {
      empty++;
      continue;
    }
    byTop[k].push(v[k]);
    tops[k].push(v[k]);
  }
  live += n;
  none += empty;
  const med = (a: number[]) => (a.length ? a.slice().sort((x, y) => x - y)[a.length >> 1] : NaN);
  const topText = byTop
    .map((a, k) => (a.length ? `${short[k]}${a.length}国/${Math.round(med(a) * 100)}%` : ''))
    .filter(Boolean)
    .join(' ');
  console.log(`seed ${seed}  ${Math.round(ms)}ms  冒出 ${origin.map((y, k) => `${short[k]}${y === undefined ? '-' : Math.round(y)}`).join(' ')}  |  ${n} 国:${topText}${empty ? ` 无${empty}国` : ''}`);
}
const q = (a: number[]) => {
  if (!a.length) return '—';
  const s = a.slice().sort((x, y) => x - y);
  return `${Math.round(s[0])}/${Math.round(s[s.length >> 1])}/${Math.round(s[s.length - 1])}`;
};
console.log(`\n各说世上头一回冒出来(最早/中位/最晚,${N} 个种子里冒过几个):`);
THOUGHTS.forEach((t, k) => console.log(`  ${t.name}  ${q(first[k])}  (${first[k].length}/${N})`));
console.log(`\n第 ${end} 年还在的 ${live} 国,最盛的说(占几成国家,那说几成的中位数):`);
THOUGHTS.forEach((t, k) => {
  const a = tops[k];
  if (a.length) console.log(`  ${t.name}  ${Math.round((100 * a.length) / live)}%  ${Math.round(a.slice().sort((x, y) => x - y)[a.length >> 1] * 100)}%`);
});
console.log(`  一说都不到半成  ${Math.round((100 * none) / Math.max(1, live))}%`);
console.log(`\n第 ${end} 年各说到半成的国家占几成:${THOUGHTS.map((t, k) => `${t.name} ${Math.round((100 * reach[k]) / Math.max(1, live))}%`).join('  ')}`);

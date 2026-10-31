/**
 * 全球大疫(src/gen/civ/pandemic.ts)的统计,只打印摘要:
 *
 *   npx tsx scripts/pandemic-stats.ts hash <out.json>         20 个种子(1–19、2024)默认参数推完,整份历史的指纹存进文件(和 main 上存的对账)
 *   npx tsx scripts/pandemic-stats.ts trial <种子> <年> [城名] 那年从那座城(不给 = 那年人口最多的港口)起一场全球大疫(中,无人收拾 30 年),
 *                                                             看疫前、疫后几个年份的天下人口、时代平均值、大城 / 城、故城遗址,几年恢复
 *   npx tsx scripts/pandemic-stats.ts many [more|many]         「天灾 很多」(或 多)20 个种子:全球大疫几场、文明断没断、天下人口最低到疫前几成、推得多快
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { settlementKey, type Intervention } from '../src/gen/edits';
import { populationAt, polityAlive, regionPopulationAt, ruinSites, settlementRank } from '../src/gen/civ/growth';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { sailsOcean } from '../src/gen/civ/polities';
import { developmentAt, eraLevel } from '../src/gen/civ/development';
import { pandemicsOf, wasteAt } from '../src/gen/civ/story/pandemicInfo';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { developmentEntries } from '../src/gen/civ/story/developmentText';
import type { Calamity } from '../src/gen/civ/calamity';

const SEEDS = [...Array.from({ length: 19 }, (_, i) => i + 1), 2024];

const f64 = new Float64Array(1);
const f64b = new Uint8Array(f64.buffer);
/** 指纹:类型化数组逐字节,数按 64 位原样,对象按键名排序(同 scripts/fingerprint.ts) */
function print(v: unknown): string {
  const h = createHash('sha1');
  const feed = (x: unknown): void => {
    if (x === null || x === undefined) return void h.update(`~${x}`);
    if (ArrayBuffer.isView(x)) {
      h.update(`<${x.constructor.name}:${x.byteLength}>`);
      return void h.update(new Uint8Array(x.buffer, x.byteOffset, x.byteLength));
    }
    if (Array.isArray(x)) {
      h.update(`[${x.length}`);
      x.forEach(feed);
      return void h.update(']');
    }
    if (x instanceof Map) {
      h.update(`{map${x.size}`);
      for (const [k, v] of x) {
        feed(k);
        feed(v);
      }
      return void h.update('}');
    }
    if (typeof x === 'object') {
      for (const k of Object.keys(x as object).sort()) {
        h.update(`.${k}`);
        feed((x as Record<string, unknown>)[k]);
      }
      return;
    }
    if (typeof x === 'number') {
      f64[0] = x;
      h.update('n');
      return void h.update(f64b);
    }
    h.update(`${typeof x}:${String(x)}`);
  };
  feed(v);
  return h.digest('hex').slice(0, 16);
}

function worldPop(civ: Civ, y: number): number {
  let s = 0;
  for (let r = 0; r < civ.regions.count; r++) s += regionPopulationAt(civ, r, y);
  return s;
}

/** 有人住的州的时代平均值、各时代几州 */
function eras(civ: Civ, y: number): { mean: number; count: number[] } {
  const own = ownersAt(civ, y).culture;
  const lv = developmentAt(civ.development!, y);
  let sum = 0;
  let n = 0;
  const count = new Array(9).fill(0);
  for (let r = 0; r < civ.regions.count; r++) {
    if (own[r] < 0) continue;
    const e = eraLevel(lv, r);
    sum += e;
    n++;
    count[Math.max(0, Math.min(8, Math.floor(e)))]++;
  }
  return { mean: n ? sum / n : 0, count };
}

/** 那年的大城、城几座 */
function cities(civ: Civ, y: number): [number, number] {
  let big = 0;
  let mid = 0;
  for (const s of civ.settlements) {
    const rk = settlementRank(populationAt(s, y));
    if (populationAt(s, y) <= 0) continue;
    if (rk === 3) big++;
    else if (rk === 2) mid++;
  }
  return [big, mid];
}

const worlds = new Map<number, World>();
const worldOf = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};

const [mode, ...args] = process.argv.slice(2);

if (mode === 'hash') {
  const out: Record<string, string> = {};
  for (const seed of SEEDS) {
    const civ = generateCiv(worldOf(seed));
    out[seed] = print(civ);
    console.log(`seed ${seed}: ${out[seed]}`);
  }
  writeFileSync(args[0], JSON.stringify(out, null, 1));
} else if (mode === 'compare') {
  const a = JSON.parse(readFileSync(args[0], 'utf8')) as Record<string, string>;
  const b = JSON.parse(readFileSync(args[1], 'utf8')) as Record<string, string>;
  const diff = Object.keys(a).filter((k) => a[k] !== b[k]);
  console.log(`${Object.keys(a).length} 个种子,${diff.length ? `不一样:${diff.join(', ')}` : '逐字节一样'}`);
} else if (mode === 'trial') {
  const seed = Number(args[0] ?? 7);
  const Y = Number(args[1] ?? 2476);
  const w = worldOf(seed);
  const base = generateCiv(w);
  const alive = (s: Civ['settlements'][number]) => s.founded <= Y && !(s.ended !== undefined && s.ended <= Y);
  let city = args[2] ? base.settlements.find((s) => s.name === args[2] && alive(s)) : undefined;
  // 不给城名:那年能远洋的国家人口最多的港口(没有能远洋的就是人口最多的港口)
  const own = ownersAt(base, Y).polity;
  const sails = (s: Civ['settlements'][number]) => own[s.region] >= 0 && sailsOcean(base, base.polities[own[s.region]], Y);
  const ports = base.settlements.filter((s) => alive(s) && s.port).sort((x, y) => populationAt(y, Y) - populationAt(x, Y));
  if (!city) city = ports.find(sails) ?? ports[0];
  console.log(`那年能远洋的国家:${new Set(base.settlements.filter((s) => alive(s) && sails(s)).map((s) => own[s.region])).size} 国`);
  const iv: Intervention = { kind: 'disaster', type: 'pandemic', level: 2, from: Y, city: settlementKey(base, city.id) };
  const t0 = performance.now();
  const civ = generateCiv(w, { interventions: [iv] });
  const ms = performance.now() - t0;
  const p = pandemicsOf(civ)[0];
  console.log(`seed ${seed} 第 ${Y} 年从${city.name}起全球大疫(${(ms / 1000).toFixed(1)} 秒):染了 ${p?.hits.length ?? 0} 州,传了 ${p ? Math.floor(Math.max(...p.hits.map((h) => h.year))) - Y + 1 : 0} 年,城里平均死 ${p ? ((p.hits.reduce((s, h) => s + h.loss, 0) / p.hits.length) * 100).toFixed(0) : 0}%,荒废 ${p?.desolated.length ?? 0} 处`);
  const pre = worldPop(civ, Y - 10);
  for (const y of [Y - 10, Y + 10, Y + 30, Y + 80, Y + 110]) {
    const e = eras(civ, y);
    const [big, mid] = cities(civ, y);
    const b0 = eras(base, y);
    const [bb, bm] = cities(base, y);
    console.log(
      `  ${y}:人口 ${Math.round(worldPop(civ, y))}(不下 ${Math.round(worldPop(base, y))},疫前的 ${((worldPop(civ, y) / pre) * 100).toFixed(0)}%) 时代 ${e.mean.toFixed(2)}(不下 ${b0.mean.toFixed(2)}) 大城/城 ${big}/${mid}(不下 ${bb}/${bm}) 遗址 ${ruinSites(civ, y).length}(不下 ${ruinSites(base, y).length})`,
    );
  }
  const e30 = eras(civ, Y + 30);
  console.log(`  ${Y + 30} 时代表:${['石器', '青铜', '铁器', '中古', '火药', '工业'].map((n, i) => `${n} ${eras(base, Y + 30).count[i]}→${e30.count[i]}`).join(',')}`);
  let back = -1;
  for (let y = Y + 31; y <= civ.endYear; y++) {
    if (worldPop(civ, y) >= pre) {
      back = y;
      break;
    }
  }
  console.log(`  人口回到疫前(第 ${Y - 10} 年):${back >= 0 ? `第 ${back} 年(疫后 ${back - Y} 年)` : '推完还没回到'}`);
  const roadsAt = (c: Civ, y: number) => c.routes.filter((r) => r.kind !== 'sea' && r.built <= y && !(r.abandoned !== undefined && r.abandoned <= y)).length;
  console.log(`  陆路:疫前 ${roadsAt(civ, Y)},凋敝结束 ${roadsAt(civ, Y + 30)}(不下 ${roadsAt(base, Y + 30)}),第 ${Y + 80} 年 ${roadsAt(civ, Y + 80)}`);
  const waste = wasteAt(civ, Y + 30);
  console.log(`  荒地(第 ${Y + 30} 年):${waste ? [...waste].filter((v) => v > 0).length : 0} 州`);
  const chron = [...buildChronicle(civ), ...developmentEntries(civ)]
    .filter((e) => e.year >= Y - 1 && e.year <= Y + 60 && (e.kind === 'plague' || e.text.includes('退入') || e.kind === 'intervene'))
    .sort((a, b) => a.year - b.year);
  for (const e of chron) console.log(`  [${Math.floor(e.year)}${e.end > e.year ? `–${Math.floor(e.end)}` : ''}] ${e.text}`);
} else if (mode === 'many') {
  const calamity = (args[0] === 'more' ? 'more' : 'many') as Calamity;
  let total = 0;
  let worst = 1;
  let speedMin = Infinity;
  for (const seed of SEEDS) {
    const w = worldOf(seed);
    const t0 = performance.now();
    const civ = generateCiv(w, { calamity });
    const sec = (performance.now() - t0) / 1000;
    speedMin = Math.min(speedMin, civ.endYear / sec);
    const list = pandemicsOf(civ);
    total += list.length;
    const lows: string[] = [];
    for (const p of list) {
      let low = Infinity;
      for (let y = Math.ceil(p.year); y <= Math.min(civ.endYear, p.end + 20); y += 2) low = Math.min(low, worldPop(civ, y));
      const ratio = p.pre > 0 ? low / p.pre : 1;
      worst = Math.min(worst, ratio);
      lows.push(`${Math.floor(p.year)} 年 ${(ratio * 100).toFixed(0)}%`);
    }
    const alive = civ.polities.filter((q) => polityAlive(q, civ.endYear)).length;
    const quakes = civ.annals.filter((e) => e.kind === 'famine' && e.cause === 'quake').length;
    console.log(`seed ${seed}:${sec.toFixed(1)} 秒(每秒 ${Math.round(civ.endYear / sec)} 年),全球大疫 ${list.length} 场${lows.length ? `(人口最低到疫前:${lows.join(',')})` : ''},地震水旱 ${quakes} 条,推完还有 ${alive} 国`);
  }
  console.log(`合计全球大疫 ${total} 场;人口最低到疫前 ${(worst * 100).toFixed(0)}%;最慢每秒 ${Math.round(speedMin)} 年`);
} else {
  console.log('用法见文件头');
}

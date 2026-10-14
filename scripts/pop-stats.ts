/**
 * 人口与宜居度的多种子统计:npx tsx scripts/pop-stats.ts [种子数=20] [from=1] [cells=…] [json=输出文件]
 *
 * 每个种子生成世界 + 3000 年历史,打印一行摘要,最后按种子取最小 / 中位 / 最大:
 *   - 各时代(第 500 … 3000 年)全世界人口、结束时最大国的人口和州数、最大城的人口
 *   - 结束时城的等级分布(村 / 镇 / 城 / 大城,国都按人口算级)
 *   - 雨林 / 平原 / 三角洲州的平均人口和平均宜居分(分类见 classify)
 *   - 宜居分前一成的地块里雨林占几成
 *   - 立国、分裂、复国、同化、战争的次数;文明推演耗时
 */
import { writeFileSync } from 'node:fs';
import { generateWorld, type World, type WorldParams } from '../src/gen/world';
import { Biome } from '../src/gen/biomes';
import { generateCiv, type Civ } from '../src/gen/civ';
import * as growth from '../src/gen/civ/growth';
import { MAJOR_RIVER, frozenSea } from '../src/gen/civ/habitat';
import { politicsStats } from '../src/gen/civ/politics';
import { warStats } from '../src/gen/civ/wars';
import { assimStats } from '../src/gen/civ/assimilation';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`${k}=`))?.slice(k.length + 1);
const N = Number(args.find((a) => !a.includes('=')) ?? 20);
const FROM = Number(opt('from') ?? 1);
const YEARS = [500, 1000, 1500, 2000, 2500, 3000];
/** 看最大的几座城在哪 */
const TOP = 20;
/** 一个世界单位² 是多少平方公里 */
const KM2 = (40000 / 2048) ** 2;

/** 州 r 在 year 年的人口(千人):治所的城 + 乡村 */
const regionPop = (civ: Civ, r: number, year: number) => growth.regionPopulationAt(civ, r, year);

type Kind = 'rainforest' | 'plain' | 'delta' | 'other';
const PLAIN_BIOMES = new Set<number>([Biome.TemperateForest, Biome.Steppe, Biome.Savanna, Biome.TropicalDryForest]);

/** 州的类别:三角洲 = 区内有大河入海口、平均海拔 < 250 米;雨林 = 主导群落是热带雨林;平原 = 温带森林 / 草原 / 稀树草原 / 季雨林为主、平均海拔 < 400 米 */
function classify(world: World, civ: Civ): Kind[] {
  const reg = civ.regions;
  const { adjStart, adj } = world.mesh;
  const out: Kind[] = [];
  for (let r = 0; r < reg.count; r++) {
    let mouth = false;
    for (let t = reg.cellStart[r]; t < reg.cellStart[r + 1] && !mouth; t++) {
      const i = reg.cells[t];
      if (world.flux[i] < MAJOR_RIVER * world.riverThreshold) continue;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        if (world.water[j] === 1 && !frozenSea(world, j)) mouth = true;
      }
    }
    if (mouth && reg.elevation[r] < 250) out.push('delta');
    else if (reg.biome[r] === Biome.Rainforest) out.push('rainforest');
    else if (PLAIN_BIOMES.has(reg.biome[r]) && reg.elevation[r] < 400) out.push('plain');
    else out.push('other');
  }
  return out;
}

interface Row {
  seed: number;
  pop: number[];
  bigPolity: number;
  bigPolityRegions: number;
  bigCity: number;
  /** 最大国的国都人口 */
  bigCapital: number;
  /** 人口最多的州 */
  bigRegion: number;
  /** 城里的人占总人口的比例 */
  urban: number;
  ranks: number[];
  kindPop: Record<Kind, number>;
  kindSuit: Record<Kind, number>;
  kindCount: Record<Kind, number>;
  /** 每平方公里的人数(这一类州的人口之和 ÷ 面积之和) */
  kindDensity: Record<Kind, number>;
  topRainforest: number;
  /** 结束时最大的 TOP 座城里:挨着大河、是港口、在平原 / 三角洲州、在雨林州的各几座 */
  topRiver: number;
  topPort: number;
  topPlain: number;
  topJungle: number;
  /** 部落地带(有人住、没有国家)占有人州的比例 */
  tribal: number;
  polities: number;
  splits: number;
  restorations: number;
  assimilated: number;
  wars: number;
  falls: number;
  civMs: number;
}

const rows: Row[] = [];
for (let seed = FROM; seed < FROM + N; seed++) {
  const p = { seed } as WorldParams;
  if (opt('cells')) p.cells = Number(opt('cells'));
  const world = generateWorld(p);
  const t = performance.now();
  const civ = generateCiv(world);
  const civMs = performance.now() - t;
  const reg = civ.regions;
  const end = civ.endYear - 1 / 512;
  const yearOf = (y: number) => Math.min(y, end);

  const pop = YEARS.map((y) => {
    let s = 0;
    for (let r = 0; r < reg.count; r++) s += regionPop(civ, r, yearOf(y));
    return s;
  });
  // 最大国(结束时):州人口之和
  const owner = civ.polity;
  const byPolity = new Map<number, { pop: number; n: number }>();
  for (let r = 0; r < reg.count; r++) {
    const o = owner[r];
    if (o < 0) continue;
    const e = byPolity.get(o) ?? { pop: 0, n: 0 };
    e.pop += regionPop(civ, r, end);
    e.n++;
    byPolity.set(o, e);
  }
  let big = { pop: 0, n: 0 };
  let bigId = -1;
  for (const [id, e] of byPolity) if (e.pop > big.pop) [big, bigId] = [e, id];
  const bigCapital = bigId >= 0 ? growth.populationAt(civ.settlements[growth.capitalAt(civ.polities[bigId], end)], end) : 0;
  let bigRegion = 0;
  let cityPop = 0;
  for (let r = 0; r < reg.count; r++) bigRegion = Math.max(bigRegion, regionPop(civ, r, end));
  const ranks = [0, 0, 0, 0];
  let bigCity = 0;
  for (const s of civ.settlements) {
    const v = growth.populationAt(s, end);
    if (!(v > 0)) continue;
    ranks[growth.settlementRank(v)]++;
    cityPop += v;
    bigCity = Math.max(bigCity, v);
  }
  // 州的类别
  const habitat = civ.habitat;
  const kinds = classify(world, civ);
  const kp = { rainforest: 0, plain: 0, delta: 0, other: 0 } as Record<Kind, number>;
  const ks = { ...kp };
  const kc = { ...kp };
  const kArea = { ...kp };
  const refArea = (world.mesh.width * world.mesh.height) / 36000;
  for (let r = 0; r < reg.count; r++) {
    const k = kinds[r];
    kc[k]++;
    kp[k] += regionPop(civ, r, end);
    kArea[k] += reg.area[r] * KM2;
    ks[k] += reg.area[r] > 0 ? reg.capacity[r] / (reg.area[r] / refArea) : 0;
  }
  const kd = { ...kp };
  for (const k of Object.keys(kp) as Kind[]) {
    kd[k] = kArea[k] ? (kp[k] * 1000) / kArea[k] : NaN;
    kp[k] = kc[k] ? kp[k] / kc[k] : NaN;
    ks[k] = kc[k] ? ks[k] / kc[k] : NaN;
  }
  // 宜居分前一成的地块里雨林占几成
  const suit: number[] = [];
  for (let i = 0; i < world.mesh.n; i++) if (habitat.suitability[i] > 0) suit.push(i);
  suit.sort((a, b) => habitat.suitability[b] - habitat.suitability[a]);
  const top = suit.slice(0, Math.max(1, Math.floor(suit.length / 10)));
  const topRainforest = top.filter((i) => world.biome[i] === Biome.Rainforest).length / top.length;

  // 最大的 TOP 座城在哪
  const major = MAJOR_RIVER * world.riverThreshold;
  const nearRiver = (c: number) => {
    if (world.flux[c] >= major) return true;
    for (let k = world.mesh.adjStart[c]; k < world.mesh.adjStart[c + 1]; k++) {
      const j = world.mesh.adj[k];
      if (world.water[j] === 0 && world.flux[j] >= major) return true;
    }
    return false;
  };
  const tops = civ.settlements
    .map((s) => ({ s, v: growth.populationAt(s, end) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || a.s.id - b.s.id)
    .slice(0, TOP);
  const topRiver = tops.filter((x) => nearRiver(x.s.cell)).length;
  const topPort = tops.filter((x) => x.s.port).length;
  const topPlain = tops.filter((x) => kinds[x.s.region] === 'plain' || kinds[x.s.region] === 'delta').length;
  const topJungle = tops.filter((x) => kinds[x.s.region] === 'rainforest').length;
  const ps = politicsStats(civ);
  const ws = warStats(civ);
  const as = assimStats(civ);
  const row: Row = {
    seed,
    pop,
    bigPolity: big.pop,
    bigPolityRegions: big.n,
    bigCity,
    bigCapital,
    bigRegion,
    urban: cityPop / pop[pop.length - 1],
    ranks,
    kindPop: kp,
    kindSuit: ks,
    kindCount: kc,
    kindDensity: kd,
    topRainforest,
    topRiver,
    topPort,
    topPlain,
    topJungle,
    tribal: ws.tribalShare,
    polities: civ.polities.length,
    splits: ps.splits,
    restorations: ps.restorations,
    assimilated: as.assimilated,
    wars: ws.wars,
    falls: ws.falls,
    civMs,
  };
  rows.push(row);
  const wan = (v: number) => `${(v / 10).toFixed(v >= 1000 ? 0 : 1)}万`;
  console.log(
    `种子 ${seed}:人口 ${pop.map(wan).join(' / ')} · 最大国 ${wan(big.pop)}(${big.n} 州,国都 ${wan(bigCapital)})· 最大城 ${wan(bigCity)} · 最大州 ${wan(bigRegion)} · ` +
      `村镇城大城 ${ranks.join('/')} · 雨林 / 平原 / 三角洲州 ${wan(kp.rainforest)} / ${wan(kp.plain)} / ${wan(kp.delta)}(${kc.rainforest}/${kc.plain}/${kc.delta} 州;` +
      `每平方公里 ${kd.rainforest.toFixed(1)} / ${kd.plain.toFixed(1)} / ${kd.delta.toFixed(1)} 人)· ` +
      `宜居前一成里雨林 ${(topRainforest * 100).toFixed(0)}% · 前 ${TOP} 大城:大河边 ${topRiver} 港口 ${topPort} 平原三角洲 ${topPlain} 雨林 ${topJungle} · ` +
      `部落地带 ${(ws.tribalShare * 100).toFixed(0)}% · 立国 ${row.polities} 分裂 ${row.splits} 复国 ${row.restorations} 同化 ${row.assimilated} 战争 ${row.wars} · ${Math.round(civMs)}ms`,
  );
}

const stat = (f: (r: Row) => number) => {
  const v = rows.map(f).filter((x) => x === x).sort((a, b) => a - b);
  if (!v.length) return '—';
  const fmt = (x: number) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 10 ? x.toFixed(1) : x.toFixed(2));
  return `${fmt(v[0])} / ${fmt(v[Math.floor(v.length / 2)])} / ${fmt(v[v.length - 1])}`;
};
console.log(`\n${rows.length} 个种子(最小 / 中位 / 最大;人口单位千人):`);
YEARS.forEach((y, k) => console.log(`  第 ${y} 年全世界人口 ${stat((r) => r.pop[k])}`));
console.log(`  最大国人口 ${stat((r) => r.bigPolity)} · 州数 ${stat((r) => r.bigPolityRegions)}`);
console.log(`  最大城人口 ${stat((r) => r.bigCity)} · 最大国的国都 ${stat((r) => r.bigCapital)} · 最大州 ${stat((r) => r.bigRegion)} · 城里人占 ${stat((r) => r.urban)}`);
['村', '镇', '城', '大城'].forEach((n, k) => console.log(`  ${n} ${stat((r) => r.ranks[k])}`));
for (const k of ['rainforest', 'plain', 'delta'] as Kind[]) {
  console.log(
    `  ${k} 州平均人口 ${stat((r) => r.kindPop[k])} · 每平方公里 ${stat((r) => r.kindDensity[k])} 人 · 平均宜居分 ${stat((r) => r.kindSuit[k])} · 州数 ${stat((r) => r.kindCount[k])}`,
  );
}
console.log(
  `  平原 ÷ 雨林(每平方公里人数)${stat((r) => r.kindDensity.plain / r.kindDensity.rainforest)} · 三角洲 ÷ 雨林 ${stat((r) => r.kindDensity.delta / r.kindDensity.rainforest)}`,
);
console.log(`  宜居前一成里雨林占比 ${stat((r) => r.topRainforest)}`);
console.log(
  `  前 ${TOP} 大城:挨着大河 ${stat((r) => r.topRiver)} · 港口 ${stat((r) => r.topPort)} · 在平原 / 三角洲州 ${stat((r) => r.topPlain)} · 在雨林州 ${stat((r) => r.topJungle)}`,
);
console.log(`  部落地带占有人州 ${stat((r) => r.tribal)}`);
console.log(
  `  立国 ${stat((r) => r.polities)} · 分裂 ${stat((r) => r.splits)} · 复国 ${stat((r) => r.restorations)} · 同化 ${stat((r) => r.assimilated)} · ` +
    `战争 ${stat((r) => r.wars)} · 灭国 ${stat((r) => r.falls)} · 推演 ms ${stat((r) => r.civMs)}`,
);
if (opt('json')) writeFileSync(opt('json')!, JSON.stringify(rows, null, 1));

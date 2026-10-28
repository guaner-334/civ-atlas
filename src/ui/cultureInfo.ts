/**
 * 民族卡片(CulturePanel.tsx)和 AI 写风俗的材料(ai/prompts/customs.ts)共用的数:这一年住在哪、信什么、多少人,
 * 历年人口(小柱图)、支族、迁徙、大事。只读历史,不碰 DOM。
 */
import type { Civ, Culture, MigrationDir } from '../gen/civ/types';
import { regionPopulationAt } from '../gen/civ/growth';
import { cultureLabel, regionLabel } from '../gen/civ/display';
import { cnNumber, type ChronicleEntry } from '../gen/civ/chronicle';
import { faithAt } from '../gen/civ/religion';
import { ownersAt, type Owners } from '../gen/civ/timeline';
import { fullChronicle } from '../gen/civ/religionText';
import { ownersOf } from './panelData';

/** 民族在 y 年之前最后还在的那一年(已消亡的 = 消亡前一年;还没出现的 = 出现那年;还在的 = y) */
export function cultureShownYear(cu: Culture, y: number): number {
  if (y < cu.born) return Math.ceil(cu.born);
  if (cu.ended === undefined || cu.ended > y) return y;
  return Math.max(Math.ceil(cu.born), Math.ceil(cu.ended) - 1);
}

export interface CultureNow {
  /** 那一年住的州 */
  regions: number[];
  /** 人口(万人 × 10,和 regionPopulationAt 一样的单位) */
  pop: number;
  /** 住在哪些国家:几州(多的在前) */
  polities: { id: number; n: number }[];
  /** 无主的几州 */
  wild: number;
  /** 信什么:几州(多的在前;没有信仰的不算) */
  faiths: { id: number; n: number }[];
}

/** 民族 id 在 year 年:住的州、人口、各国几州、各教几州 */
export function cultureNow(civ: Civ, id: number, year: number, own: Owners = ownersOf(civ, year)): CultureNow {
  const regions: number[] = [];
  for (let r = 0; r < civ.regions.count; r++) if (own.culture[r] === id) regions.push(r);
  let pop = 0;
  const pol = new Map<number, number>();
  const fa = new Map<number, number>();
  const faith = civ.religion ? faithAt(civ, year) : null;
  let wild = 0;
  for (const r of regions) {
    pop += regionPopulationAt(civ, r, year);
    const p = own.polity[r];
    if (p >= 0 && civ.polities[p]) pol.set(p, (pol.get(p) ?? 0) + 1);
    else wild++;
    const f = faith ? faith[r] : -1;
    if (f >= 0 && civ.religion!.faiths[f]) fa.set(f, (fa.get(f) ?? 0) + 1);
  }
  const sorted = (m: Map<number, number>) => [...m].map(([k, n]) => ({ id: k, n })).sort((a, b) => b.n - a.n || a.id - b.id);
  return { regions, pop, polities: sorted(pol), wild, faiths: sorted(fa) };
}

// ---------------------------------------------------------------------------
// 历年人口(小柱图)

/** 小柱图最多几根(每一百年一根;再多就隔一根取一根,放得进卡片的一行) */
const SPARK_MAX = 30;

interface Series {
  years: number[];
  /** 第 c 族在 [c * years.length, (c + 1) * years.length) */
  pop: Float64Array;
}
const seriesCache = new WeakMap<object, Series>();

/** 各族每一百年的人口;同一份历史只算一次(改名不重算) */
function series(civ: Civ): Series {
  const hit = seriesCache.get(civ.log);
  if (hit && hit.pop.length === hit.years.length * civ.cultures.length) return hit;
  const years: number[] = [];
  for (let y = 0; y <= civ.endYear; y += 100) years.push(y);
  const C = civ.cultures.length;
  const N = years.length;
  const pop = new Float64Array(C * N);
  let own: Owners | undefined;
  for (let i = 0; i < N; i++) {
    own = ownersAt(civ, years[i], own);
    for (let r = 0; r < civ.regions.count; r++) {
      const c = own.culture[r];
      if (c >= 0 && c < C) pop[c * N + i] += regionPopulationAt(civ, r, years[i]);
    }
  }
  const out = { years, pop };
  seriesCache.set(civ.log, out);
  return out;
}

/**
 * 小柱图的数:出现以后每一百年一根(多于 SPARK_MAX 根的从这一年往前隔一根取一根),最后一根是 year 这一年(now = 这一年的人口);
 * 已消亡的到消亡前为止
 */
export function cultureSpark(civ: Civ, id: number, year: number, now: number): { year: number; pop: number }[] {
  const cu = civ.cultures[id];
  if (!cu || cu.unborn || year < cu.born) return [];
  const s = series(civ);
  const N = s.years.length;
  const out: { year: number; pop: number }[] = [];
  for (let i = 0; i < N; i++) {
    const y = s.years[i];
    if (y < cu.born || y >= year) continue;
    out.push({ year: y, pop: s.pop[id * N + i] });
  }
  const stride = Math.ceil((out.length + 1) / SPARK_MAX);
  const kept = stride > 1 ? out.filter((_, i) => (out.length - i) % stride === 0) : out;
  kept.push({ year, pop: now });
  return kept;
}

// ---------------------------------------------------------------------------
// 族系

/** 到 year 年为止从这一族分出去的支族(按分出的先后) */
export function cultureBranches(civ: Civ, id: number, year: number): Culture[] {
  return civ.cultures.filter((c) => c.parent === id && !c.unborn && c.born <= year).sort((a, b) => a.born - b.born || a.id - b.id);
}

export interface Wave {
  year: number;
  dir: MigrationDir;
  /** 迁入的州 */
  regions: number[];
}

/** 到 year 年为止成规模的迁徙(每一波:年份、方位、迁入的州) */
export function cultureWaves(civ: Civ, id: number, year: number): Wave[] {
  const cu = civ.cultures[id];
  const out: Wave[] = [];
  for (const m of cu?.migrations ?? []) {
    if (m.year > year) break;
    out.push({ year: m.year, dir: m.dir, regions: [] });
  }
  if (!out.length) return out;
  const at = new Map(out.map((w) => [w.year, w]));
  for (const a of civ.annals) {
    if (a.kind !== 'migrate' || a.a !== id || a.year > year) continue;
    const w = at.get(a.year);
    if (w && a.region >= 0) w.regions.push(a.region);
  }
  return out;
}

/** 一波迁徙怎么写:"东迁，入问月洲等三州"(州的写法和编年史一样:人口上限大的在前,两州都写,三州以上"某州等几州") */
export function waveText(civ: Civ, w: Wave): string {
  const cap = civ.regions.capacity;
  const rs = [...new Set(w.regions)].sort((a, b) => cap[b] - cap[a] || a - b);
  const names = rs.map((r) => regionLabel(civ, r));
  const into = !rs.length ? '' : rs.length === 1 ? names[0] : rs.length === 2 ? `${names[0]}、${names[1]}` : `${names[0]}等${cnNumber(rs.length)}州`;
  return `${w.dir}迁${into ? `，入${into}` : ''}`;
}

// ---------------------------------------------------------------------------
// 大事

const KINDS = new Set(['migrate', 'assimilate', 'vanish', 'diverge']);
const entryCache = new WeakMap<readonly ChronicleEntry[], Map<number, ChronicleEntry[]>>();

/** 自然兴起的民族"出现"那一条(编年史里没有这一条,卡片的大事里补上;分化出来的有编年史里的分化那一条) */
function birthEntry(civ: Civ, cu: Culture): ChronicleEntry {
  const r = cu.hearth;
  return {
    id: -1 - cu.id,
    kind: 'found',
    year: cu.born,
    end: cu.born,
    text: `${cultureLabel(cu)}兴起于${regionLabel(civ, r)}`,
    tag: '兴',
    importance: 2,
    polities: [],
    regions: r >= 0 && r < civ.regions.count ? [r] : [],
    settlement: -1,
  };
}

/**
 * 和这一族有关的编年史条目(按年份排好):出现(自然兴起的补一条)、这一族的迁徙(别族迁进它的地方不算,那一条写的是别族)
 * 和大迁徙、同化(这一族的州改了族,或别族的州改成这一族)、消亡(它的,或它取代的)、分化(它分出来,或从它分出去);折叠的条目看子条目
 */
export function cultureEntries(civ: Civ, id: number): ChronicleEntry[] {
  const all = fullChronicle(civ);
  let m = entryCache.get(all);
  if (!m) entryCache.set(all, (m = new Map()));
  let hit = m.get(id);
  if (!hit) {
    const A = civ.history?.annals ?? civ.annals;
    const test = (e: ChronicleEntry) => {
      if (!KINDS.has(e.kind)) return false;
      const a = A[e.id];
      // 大迁徙那一条是 migrate,第一件史事是 trek(a = 迁徙的民族)
      if (a?.kind === 'trek') return e.kind === 'migrate' && a.a === id;
      return !!a && a.kind === e.kind && (a.a === id || (a.b === id && a.kind !== 'migrate'));
    };
    hit = all.filter((e) => test(e) || !!e.children?.some(test));
    const cu = civ.cultures[id];
    if (cu && !cu.unborn && cu.parent === undefined) hit.unshift(birthEntry(civ, cu));
    m.set(id, hit);
  }
  return hit;
}

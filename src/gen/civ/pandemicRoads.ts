/**
 * 全球大疫的清单和疫后断路(推演规则那一侧;界面、地图、编年史用的凋敝、荒地这些在 story/pandemicInfo.ts)。
 *
 *   pandemicsOf(civ)         起过的全球大疫(从史事、城镇表整理;界面、编年史经 story/pandemicInfo.ts 取的是同一份)
 *   breakRoads(civ, routes)  全球大疫以后断了的路(推完以后 finishCiv 调,改路表)
 *
 * 只读 Civ,不碰推演引擎。纯计算,不碰 DOM。
 */
import type { Civ, Regions, Route, Year } from './types';
import { keyed, subSeed } from './engine/rand';
import { PLAGUE_IV, PANDEMIC_K } from './calamity';

/** 一场全球大疫 */
export interface PandemicInfo {
  /** 第几场瘟疫(史事 plague / pandemic 的 war 列;作者下的 = PLAGUE_IV + 干预下标,自己发生的 = PANDEMIC_K + 第几次看) */
  id: number;
  /** 史事 pandemic 的下标 */
  annal: number;
  /** 起疫的时刻、凋敝结束的那年、疫后无人收拾几年 */
  year: Year;
  end: Year;
  slump: number;
  /** 起疫的州、城、那时的主人(−1 = 部落地带) */
  region: number;
  settlement: number;
  polity: number;
  /** 疫前天下人口(千人) */
  pre: number;
  /** 作者下的(干预"天灾"):第几条干预;自己发生的 = 不给 */
  iv?: number;
  /** 染疫的州(按染上的先后;一州只记第一次,死几成取重的):州、城、哪一刻、城里死几成 */
  hits: { region: number; settlement: number; year: Year; loss: number }[];
  /** 疫后荒废的城(史事 desolate,按先后):城、州、当时的国家、哪一年 */
  desolated: { settlement: number; region: number; polity: number; year: Year }[];
}

const cache = new WeakMap<Civ, PandemicInfo[]>();

/** 这个世界里起过的全球大疫(按先后);没有 = 空数组 */
export function pandemicsOf(civ: Civ): PandemicInfo[] {
  const hit = cache.get(civ);
  if (hit) return hit;
  const out: PandemicInfo[] = [];
  civ.annals.forEach((e, i) => {
    if (e.kind === 'pandemic') {
      out.push({
        id: e.war,
        annal: i,
        year: e.year,
        end: e.year + e.b,
        slump: e.b,
        region: e.region,
        settlement: e.settlement,
        polity: e.a,
        pre: e.n ?? 0,
        ...(e.war >= PLAGUE_IV && e.war < PANDEMIC_K ? { iv: e.war - PLAGUE_IV } : {}),
        hits: [],
        desolated: [],
      });
    } else if (e.kind === 'desolate') {
      const p = out.find((x) => x.id === e.war);
      p?.desolated.push({ settlement: e.settlement, region: e.region, polity: e.a, year: e.year });
    }
  });
  if (out.length) {
    const all: { region: number; settlement: number; year: Year; loss: number; pan: number }[] = [];
    for (const s of civ.settlements) for (const x of s.sacks ?? []) if (x.cause === 'plague' && x.pan !== undefined) all.push({ region: s.region, settlement: s.id, year: x.year, loss: x.loss, pan: x.pan });
    all.sort((a, b) => a.year - b.year || a.region - b.region);
    for (const h of all) {
      let p: PandemicInfo | undefined;
      for (let i = out.length - 1; i >= 0 && !p; i--) if (out[i].id === h.pan) p = out[i];
      if (!p) continue;
      const had = p.hits.find((x) => x.region === h.region);
      if (had) had.loss = Math.max(had.loss, h.loss);
      else p.hits.push({ region: h.region, settlement: h.settlement, year: h.year, loss: h.loss });
    }
  }
  cache.set(civ, out);
  return out;
}

/** 死四成算重灾(轻重 = 1) */
export const SEV_REF = 0.4;

// ---------------------------------------------------------------------------
// 路断(推完以后画路时算,不进推演)

/** 大半段(这么多成的地块)在染了疫的州里的路才会失修 */
const ROAD_SHARE = 0.6;
/** 重灾(死四成)时小路、大路失修断掉的几成 */
const ROAD_BREAK: Readonly<Record<'road' | 'trail', number>> = { trail: 0.6, road: 0.3 };
/** 起疫后第几年起断(到凋敝结束为止陆续断);凋敝结束后第几年起修回、修回要几年 */
const BREAK_FROM = 5;
const MEND_FROM = 15;
const MEND_SPAN = 30;
const U_BREAK = 1;
const U_CUT = 2;
const U_MEND = 3;

/**
 * 全球大疫以后断了的路(finishCiv 调用,routes 是 buildRoutes 修好的路):起疫时还通着、大半段在染了疫的州里的小路约六成、
 * 大路约三成(× 轻重)在凋敝里失修断掉(Route.abandoned),凋敝结束后 MEND_FROM–MEND_FROM + MEND_SPAN 年陆续修回(另起一段,built = 修回那年)。
 * 只按那一刻以前已经染上的州算:推得再远,早先断的路不变。返回新的路表(没有全球大疫 = 原样返回)
 */
export function breakRoads(civ: Pick<Civ, 'seed' | 'annals' | 'settlements'> & { regions: Pick<Regions, 'of' | 'count'> }, routes: Route[]): Route[] {
  const list = pandemicsOf(civ as Civ);
  if (!list.length) return routes;
  const base = subSeed(civ.seed, 'civ-roads-decay');
  const of = civ.regions.of;
  const out = routes.slice();
  for (const p of list) {
    // 各州染上的时刻、死几成
    const at = new Float64Array(civ.regions.count).fill(NaN);
    const loss = new Float64Array(civ.regions.count);
    for (const h of p.hits) {
      at[h.region] = h.year;
      loss[h.region] = h.loss;
    }
    const span = Math.max(1, Math.min(p.end - p.year - BREAK_FROM, 15));
    for (let i = 0; i < out.length; i++) {
      const rt = out[i];
      if (rt.kind === 'sea' || rt.built > p.year || (rt.abandoned ?? Infinity) <= p.year || rt.cells.length < 2) continue;
      const tag = rt.cells[0] * 7919 + rt.cells[rt.cells.length - 1];
      const cut = p.year + BREAK_FROM + Math.floor(span * keyed(base, p.id, tag, U_CUT));
      // 那时已经荒废了的(通往废城、被大路取代的)不动,早先的荒废年份不往后推
      if (cut >= p.end || (rt.abandoned ?? Infinity) <= cut) continue;
      let n = 0;
      let sev = 0;
      for (const c of rt.cells) {
        const r = of[c];
        if (r >= 0 && at[r] <= cut) {
          n++;
          sev += loss[r];
        }
      }
      if (n < rt.cells.length * ROAD_SHARE) continue;
      const odds = Math.min(0.95, ROAD_BREAK[rt.kind] * (sev / n / SEV_REF));
      if (keyed(base, p.id, tag, U_BREAK) >= odds) continue;
      const back = p.end + MEND_FROM + Math.floor(MEND_SPAN * keyed(base, p.id, tag, U_MEND));
      const old = rt.abandoned;
      out[i] = { ...rt, abandoned: cut };
      if (old === undefined || old > back) out.push(old === undefined ? { kind: rt.kind, cells: rt.cells, built: back } : { kind: rt.kind, cells: rt.cells, built: back, abandoned: old });
    }
  }
  return out;
}

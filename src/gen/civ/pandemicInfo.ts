/**
 * 全球大疫(pandemic.ts)的整理:只读 Civ(史事 pandemic / plague / desolate、城镇表里带 until 的折损、乡村人口和发展度的快照),
 * 不碰推演引擎。界面(国家卡片、时间轴)、地图(荒地、疫区)、编年史、统计都用它;推完以后断路(breakRoads)也在这里。纯计算,不碰 DOM。
 *
 * 给界面和地图的数据:
 *   pandemicsOf(civ)        起过的全球大疫:哪年起、凋敝到哪年、起疫的城、疫前天下人口、染了哪些州(哪一刻、死几成)、疫后荒废了哪些城
 *   slumpAt(civ, 年)        那年各州凋敝的程度(0–1;染了疫、凋敝还没结束的州 = 轻重)
 *   wasteAt(civ, 年)        那年各州荒了几成(荒地,0–1:乡下比疫前少了 WASTE_FROM 以上的,少得越多越大;人长回来就淡掉)
 *   peakEraAt(civ, 州, 年)  州到那年为止到过的最高时代数值(国家卡片"时代写曾到哪")
 *   城荒废:Settlement.ended + 史事 desolate;路断:Route.abandoned / 修回的那一段(breakRoads)
 */
import type { Civ, Regions, Route, Year } from './types';
import { ruralPopulationAt } from './growth';
import { CAP_COUNT, LEVEL_SCALE, developmentAt, eraLevel } from './development';
import { keyed, subSeed } from './rand';
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
    const all: { region: number; settlement: number; year: Year; loss: number; until: Year }[] = [];
    for (const s of civ.settlements) for (const x of s.sacks ?? []) if (x.cause === 'plague' && x.until !== undefined) all.push({ region: s.region, settlement: s.id, year: x.year, loss: x.loss, until: x.until });
    all.sort((a, b) => a.year - b.year || a.region - b.region);
    for (const h of all) {
      let p: PandemicInfo | undefined;
      for (let i = out.length - 1; i >= 0 && !p; i--) if (out[i].end === h.until && h.year >= out[i].year) p = out[i];
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
const SEV_REF = 0.4;

/** 第 year 年各州凋敝的程度(0–1:染了疫、凋敝还没结束的州 = 城里死几成 ÷ 0.4,最多 1;几场叠着的取重的);这年没有凋敝 = null */
export function slumpAt(civ: Civ, year: Year): Float32Array | null {
  let out: Float32Array | null = null;
  for (const p of pandemicsOf(civ)) {
    if (!(p.year <= year && year < p.end)) continue;
    for (const h of p.hits) {
      if (!(h.year <= year)) continue;
      out ??= new Float32Array(civ.regions.count);
      out[h.region] = Math.max(out[h.region], Math.min(1, h.loss / SEV_REF));
    }
  }
  return out;
}

/** 荒地:乡下比疫前少了这么多才算荒;再少 WASTE_SPAN 就是最荒(1) */
export const WASTE_FROM = 0.12;
const WASTE_SPAN = 0.3;
/** 凋敝结束后这么多年还在看荒不荒(人早长回来了) */
const WASTE_AFTER = 250;

/**
 * 第 year 年各州荒了几成(0–1;荒地):染过全球大疫的州,乡下人口比疫前(起疫那一刻)少了 WASTE_FROM 以上的,少得越多越大,
 * 人长回来就淡掉。几场叠着的取荒的;这年哪里都不荒 = null
 */
export function wasteAt(civ: Civ, year: Year): Float32Array | null {
  let out: Float32Array | null = null;
  for (const p of pandemicsOf(civ)) {
    if (!(p.year <= year && year < p.end + WASTE_AFTER)) continue;
    for (const h of p.hits) {
      if (!(h.year <= year)) continue;
      const before = ruralPopulationAt(civ, h.region, p.year);
      if (!(before > 0)) continue;
      const v = 1 - ruralPopulationAt(civ, h.region, year) / before;
      if (!(v > WASTE_FROM)) continue;
      out ??= new Float32Array(civ.regions.count);
      out[h.region] = Math.max(out[h.region], Math.min(1, (v - WASTE_FROM) / WASTE_SPAN));
    }
  }
  return out;
}

/** 州 r 到第 year 年为止到过的最高时代数值(按发展度的快照,和那一年的;没有发展度 = 0) */
export function peakEraAt(civ: Civ, r: number, year: Year): number {
  const dev = civ.development;
  if (!dev) return 0;
  let best = eraLevel(developmentAt(dev, year), r);
  const ys = dev.snapYears;
  const v = new Float32Array(CAP_COUNT);
  for (let i = 0; i < ys.length && ys[i] <= year; i++) {
    const lv = dev.snaps[i];
    for (let c = 0; c < CAP_COUNT; c++) v[c] = lv[r * CAP_COUNT + c] / LEVEL_SCALE;
    const e = eraLevel(v, 0);
    if (e > best) best = e;
  }
  return best;
}

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
      if (cut >= p.end) continue;
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

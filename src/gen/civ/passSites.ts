/**
 * 地图上画的关隘:从州与州之间认得出的口子(passes.ts 的 regionPasses / findPass)里挑出上地图的那些。
 *
 *   口子   州与州交界上又低又窄的那一处(passes.ts);同一处被相邻的几对州认出好几次的(相隔 MERGE 个地块间距以内)只算一处,
 *          几对州都记上(留口子最低的那一块)
 *   绕路   口子附近(DETOUR_R 个地块间距以内)不走这个口子(挖掉口子周围 DETOUR_HOLE 个间距),从这边的州到那边的州
 *          最省力的路要翻多高(经过的最高点);附近根本绕不过去的按两旁山脊、口子高出 GAP 米里取高的算
 *   名关   大路翻过去的口子(口子 ROAD_NEAR 个地块间距以内有大路),绕路比口子高出 NAMED_GAIN 米以上;
 *          按大路修通的先后挑(同一年修通的,绕路多翻得多的先;再一样的地块编号小的先),彼此隔开 SPACING 个间距,
 *          名额 = 有人住得下的州 ÷ PER_REGIONS(最少 QUOTA_MIN、最多 QUOTA_MAX 处)。大路修通那年起画上地图,之后一直在。
 *          按修路先后挑:哪一年以前的名关只看那一年以前修的路,往后推得再远也不变(推到第 800 年和推到第 3000 年,
 *          第 800 年地图上的关一样);门槛定在 NAMED_GAIN,早修的路翻过的平常山口不占名额,挑出来的多是绕开要多翻很多的要紧关口
 *   守关战 推演里据险断后(史事 stand)守的口子:不是名关也画,从那一仗那年起
 *
 * 只读地形、州、道路和推演出来的史事,不改历史、不用随机数:同一个种子、同一段历史算出来一样。纯计算,不碰 DOM(在 worker 里算)。
 * 距离按默认精细度下的地块间距(refSpacing)算,换精细度时挑出来的大致不变。
 */
import type { World } from '../world';
import { geometryOf } from '../geometry';
import { MinHeap } from '../util';
import { refSpacing } from './geo';
import { findPass, regionPasses } from './passes';
import { ownersAt } from './engine/timeline';
import type { Annal, Civ, Regions, Route } from './types';

/** 同一处口子:相隔这么多个地块间距以内 */
const MERGE = 2;
/** 绕路:口子附近这么多个地块间距以内找;口子周围这么多个间距挖掉(不许走口子) */
const DETOUR_R = 20;
const DETOUR_HOLE = 2.2;
/** 附近绕不过去的口子:绕路按两旁山脊、口子高出 GAP 米里取高的算 */
const GAP = 500;
/** 名关:绕路比口子高出这么多(米)以上 */
const NAMED_GAIN = 800;
/** 口子这么多个地块间距以内有大路 = 大路翻过这个口子 */
const ROAD_NEAR = 1.6;
/** 名关彼此至少隔开这么多个地块间距 */
const SPACING = 8;
/** 名额:每这么多个住得下人的州一处 */
const PER_REGIONS = 80;
const QUOTA_MIN = 3;
const QUOTA_MAX = 14;

/** 一处认得出的口子 */
export interface PassSite {
  /** 口子那一块地块(口子最低的那一对里低的那一块) */
  cell: number;
  /** 两边的州:[a0, b0, a1, b1, …](同一处被几对州认出来的都记上;每对 a < b) */
  pairs: number[];
  /** 翻过口子要爬多高(米) */
  height: number;
  /** 交界的山脊(米,中位数) */
  ridge: number;
  /** 绕开它最低要翻多高(米);附近根本绕不过去 = 不给。只给大路翻过去的、打过守关战的口子算 */
  detour?: number;
  /** 大路最早哪年修过这个口子(没有大路 = 不给) */
  road?: number;
  /** 第一次在这里据险断后的年份(没有 = 不给) */
  stand?: number;
  /** 在这里据险断后的史事(civ.annals 的下标,按先后;没有 = 不给):编年史、导播按它把那一仗对到这处关 */
  stands?: number[];
  /** 名关(挑进名额的) */
  named: boolean;
}

/** 从哪年起画在地图上:名关从大路修通那年起,打过守关战的从那一仗那年起,取早的;不画 = Infinity */
export function passSince(s: Pick<PassSite, 'named' | 'road' | 'stand'>): number {
  return Math.min(s.named && s.road !== undefined ? s.road : Infinity, s.stand ?? Infinity);
}

/** 推演结果里认关隘要的几样(Civ 的一部分;finishCiv 里 Civ 还没拼起来时也能用) */
export type PassHistory = Pick<Civ, 'regions' | 'checkpoints' | 'log' | 'annals'>;

/**
 * 认出全部口子,标上名关、大路修通的年份、守关战的年份。routes = 道路网(Civ.routes);
 * hist = 推演结果(据险断后的口子按它认;不给 = 不看守关战)
 */
export function passSites(world: World, regions: Regions, routes: readonly Route[], hist?: PassHistory): PassSite[] {
  const { mesh } = world;
  const geo = geometryOf(mesh);
  const sp = refSpacing(mesh);
  const gate = regionPasses(world, regions);
  const { adjStart, adj, cellStart, cells, of } = regions;
  // 每对相邻的州认一次(a < b)
  const raw: PassSite[] = [];
  for (let a = 0; a < regions.count; a++) {
    for (let k = adjStart[a]; k < adjStart[a + 1]; k++) {
      const b = adj[k];
      if (b < a || gate[k] < 0) continue;
      const p = findPass(world, cells.subarray(cellStart[a], cellStart[a + 1]), (j) => of[j] === b);
      if (p) raw.push({ cell: p.cell, pairs: [a, b], height: p.height, ridge: p.ridge, named: false });
    }
  }
  // 同一处:口子低的(一样低取地块编号小的)先占,附近的并进来
  raw.sort((x, y) => x.height - y.height || x.cell - y.cell || x.pairs[0] - y.pairs[0] || x.pairs[1] - y.pairs[1]);
  const sites: PassSite[] = [];
  for (const s of raw) {
    const host = sites.find((o) => geo.dist(o.cell, s.cell) <= MERGE * sp);
    if (host) {
      host.pairs.push(...s.pairs);
      host.ridge = Math.max(host.ridge, s.ridge);
    } else sites.push(s);
  }
  sites.sort((x, y) => x.cell - y.cell);
  // 大路:每块地最早哪年有大路经过
  const roadYear = new Float64Array(mesh.n).fill(Infinity);
  for (const r of routes) {
    if (r.kind !== 'road') continue;
    for (const c of r.cells) if (r.built < roadYear[c]) roadYear[c] = r.built;
  }
  const near = nearCells(world, sp);
  for (const s of sites) {
    let y = Infinity;
    for (const c of near(s.cell, ROAD_NEAR)) y = Math.min(y, roadYear[c]);
    if (y < Infinity) s.road = y;
  }
  // 守关战
  if (hist) {
    for (const { annal, cell, year } of standCells(world, hist)) {
      const s = sites.find((o) => o.cell === cell) ?? sites.find((o) => geo.dist(o.cell, cell) <= MERGE * sp);
      if (!s) continue;
      if (s.stand === undefined || year < s.stand) s.stand = year;
      (s.stands ??= []).push(annal);
    }
  }
  // 绕路(大路翻过去的、打过守关战的才算)
  const detour = detourFinder(world, regions, sp);
  for (const s of sites) if (s.road !== undefined || s.stand !== undefined) {
    const d = detour(s);
    if (d < Infinity) s.detour = d;
  }
  // 名关:按大路修通的先后
  let land = 0;
  for (let r = 0; r < regions.count; r++) if (regions.capacity[r] > 0) land++;
  const quota = Math.max(QUOTA_MIN, Math.min(QUOTA_MAX, Math.round(land / PER_REGIONS)));
  const gain = (s: PassSite) => (s.detour ?? Math.max(s.ridge, s.height + GAP)) - s.height;
  const order = sites.filter((s) => s.road !== undefined && gain(s) >= NAMED_GAIN).sort((x, y) => x.road! - y.road! || gain(y) - gain(x) || x.cell - y.cell);
  const named: PassSite[] = [];
  for (const s of order) {
    if (named.length >= quota) break;
    if (named.some((o) => geo.dist(o.cell, s.cell) < SPACING * sp)) continue;
    s.named = true;
    named.push(s);
  }
  return sites;
}

/** 地块 c 周围 r 个地块间距以内的地块(含 c 自己;沿邻接往外找) */
function nearCells(world: World, sp: number): (c: number, r: number) => number[] {
  const { adjStart, adj } = world.mesh;
  const geo = geometryOf(world.mesh);
  return (c, r) => {
    const out = [c];
    const seen = new Set(out);
    for (let i = 0; i < out.length; i++) {
      const u = out[i];
      for (let k = adjStart[u]; k < adjStart[u + 1]; k++) {
        const v = adj[k];
        if (seen.has(v)) continue;
        seen.add(v);
        if (geo.dist(c, v) <= r * sp) out.push(v);
      }
    }
    return out;
  };
}

/**
 * 绕路:口子附近(DETOUR_R 个间距以内、挖掉口子周围 DETOUR_HOLE 个间距)从口子这边的州(pairs[0])走到那边的州(pairs[1]),
 * 只走陆地,经过的最高点最低是多少(米,海平面以下按 0)。绕不过去 = Infinity
 */
function detourFinder(world: World, regions: Regions, sp: number): (s: PassSite) => number {
  const { mesh } = world;
  const { adjStart, adj } = mesh;
  const e = world.elevation;
  const geo = geometryOf(mesh);
  const of = regions.of;
  const mark = new Int32Array(mesh.n);
  const done = new Int32Array(mesh.n);
  const best = new Float64Array(mesh.n);
  let stamp = 0;
  const heap = new MinHeap();
  return (s) => {
    stamp++;
    const [a, b] = s.pairs;
    const inDisc = (c: number) => {
      const d = geo.dist(c, s.cell);
      return d <= DETOUR_R * sp && d > DETOUR_HOLE * sp;
    };
    heap.size = 0;
    for (let k = regions.cellStart[a]; k < regions.cellStart[a + 1]; k++) {
      const c = regions.cells[k];
      if (!inDisc(c)) continue;
      mark[c] = stamp;
      best[c] = Math.max(0, e[c]);
      heap.push(c, best[c]);
    }
    while (heap.size) {
      const c = heap.pop();
      if (done[c] === stamp) continue;
      done[c] = stamp;
      const hc = best[c];
      if (of[c] === b) return hc;
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const j = adj[k];
        if (of[j] < 0 || done[j] === stamp || !inDisc(j)) continue;
        const hj = Math.max(hc, e[j], 0);
        if (mark[j] !== stamp || hj < best[j]) {
          mark[j] = stamp;
          best[j] = hj;
          heap.push(j, hj);
        }
      }
    }
    return Infinity;
  };
}

/**
 * 推演里据险断后(史事 stand)守的是哪个口子:返回 [{ 史事下标, 口子地块, 年份 }],按史事的先后。
 * 史事记了口子所在的州(region)和大军退保的那一州(foe):口子在 foe 和它的一个邻州的交界上(史事不记地块:推演的结果一个字不改)。
 * region ≠ foe 时那个邻州就是 region;否则是 foe 的邻州里当时归追兵(b)、口子落在 foe 这边的那一个:
 * 只有一个就是它(默认参数 20 个种子 125 次守关战里 123 次是这两种,认得准);
 * 几个都是时,先看这一仗紧挨着的上一件事(同一场仗里攻下 / 打的那一州:败兵是从那里退的)在不在里面,
 * 不在再取共享边界最长的、一样长取治所地块小的(和推演里挑关隘的先后一样)。
 * "当时"= 守关那一刻:同一刻这场仗随即议和、割让的州(史事里排在它后面的攻占)退回去再看
 */
export function standCells(world: World, hist: PassHistory): { annal: number; cell: number; year: number }[] {
  const reg = hist.regions;
  const gate = regionPasses(world, reg);
  const out: { annal: number; cell: number; year: number }[] = [];
  const annals: readonly Annal[] = hist.annals;
  for (let i = 0; i < annals.length; i++) {
    const an = annals[i];
    if (an.kind !== 'stand' || an.foe === undefined || an.foe < 0) continue;
    const cell = standCell(hist, i, gate);
    if (cell >= 0) out.push({ annal: i, cell, year: an.year });
  }
  return out;
}

/** 第 i 条史事(据险断后)那一刻的国家归属:这一刻末了的归属,退回同一刻排在它后面、同一场仗的攻占(随即议和时割让的州) */
function ownersAtStand(hist: PassHistory, i: number): Int16Array {
  const A = hist.annals;
  const an = A[i];
  const own = ownersAt(hist as Civ, an.year).polity;
  let last = i;
  while (last + 1 < A.length && A[last + 1].year === an.year) last++;
  for (let j = last; j > i; j--) if (A[j].kind === 'conquer' && A[j].war === an.war) own[A[j].region] = A[j].b;
  return own;
}

function standCell(hist: PassHistory, i: number, gate: Int32Array): number {
  const reg = hist.regions;
  const an = hist.annals[i];
  const foe = an.foe!;
  let owner: Int16Array | null = null;
  const cand: number[] = [];
  for (let k = reg.adjStart[foe]; k < reg.adjStart[foe + 1]; k++) {
    const g = gate[k];
    if (g < 0 || reg.of[g] !== an.region) continue;
    const j = reg.adj[k];
    if (an.region !== foe) {
      if (j === an.region) return g;
      continue;
    }
    owner ??= ownersAtStand(hist, i);
    if (owner[j] === an.b) cand.push(k);
  }
  if (cand.length <= 1) return cand.length ? gate[cand[0]] : -1;
  // 几个都是:这一场仗紧挨着的上一件攻下 / 打的那一州
  for (let j = i - 1; j >= 0; j--) {
    const p = hist.annals[j];
    if (p.war !== an.war || (p.kind !== 'conquer' && p.kind !== 'battle')) continue;
    const hit = cand.find((k) => reg.adj[k] === p.region);
    if (hit !== undefined) return gate[hit];
    break;
  }
  let best = cand[0];
  for (const k of cand) if (reg.adjBorder[k] > reg.adjBorder[best] || (reg.adjBorder[k] === reg.adjBorder[best] && reg.seat[reg.adj[k]] < reg.seat[reg.adj[best]])) best = k;
  return gate[best];
}

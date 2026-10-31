/**
 * 商道:要紧的货(盐、铁、马、金银,快到时代门口时加上门槛要的矿)从哪来、运到哪去。
 * 在推演里每 STEP(20)年算一步(挂在发展度那一步后面,development.ts 的 接口 dev.afterTick),只读推演的状态,
 * **不改历史**:不预约事件、不取随机数序列、不写别的模型(日后"断道缺货"这类后果读 Civ.trade)。纯计算,不碰 DOM。
 *
 * **一步怎么算**:
 *   1. 两步之间的史事:买方和商道经过的国家(含产地所属的国)宣战 → 那一年断(记下是哪一仗);那一仗议和、再没有别的仗挡着 → 那一年复通。
 *      买方亡了 → 那一年废。
 *   2. 买方:还在的、至少 MIN_SIZE 州、国都还在本国的国家。缺什么和打仗看物产用同一套门槛:本国一州都采不到的盐、马;
 *      国都所在州的生产认得铁、金银以后的铁、金银;快到时代门口、门槛要而本国采不到的矿。
 *      产地:有人住、这一刻采得到这样物产的州(发现了、没采空;马要在草原、荒漠上)。
 *   3. 从买方国都沿州与州相邻走(Dijkstra;翻山、过海峡贵,会远洋的国家才走航线),不进和它交兵的国家;
 *      路程上限随国都所在州的运输能力变长(早期只到邻近几国,后来能横跨大陆)。每样缺的货取最近的产地;
 *      原来就从某处运的、那里还产、路程不超过最近的 HYST 倍,照旧从那里运(名字不跳);
 *      原来的路被交兵的国家挡住的,算"断",断着不换产地,断满 BROKEN_MAX 年才另找。
 *   4. 同一个买方、同一处产地的几样货合成一条商道;按买方大小 × 货的分量排,取前 N 条(N 随州数,5–12),
 *      上一步就在的商道分数 × KEEP(不轻易换)。挤出去的那些年 = 废(商旅渐稀)。
 *   5. 每条商道记路线(经过的州,产地 → 买方国都所在州;路线变了另记一版)、运过的货、通断的大事(通、断、复通、废)。
 *      没有确切年份的(这一步才看出来通了、断了)按 keyed 在这一步的 20 年里定一个年份。
 *
 * 结果是 Civ.trade(finishTrade 整理,起好名字);接着推(resumeCiv)从 Civ.trade.state 接上,和一口气推完一样。
 * 只用加减乘除和比较,跨 CPU 逐位一致。
 */
import type { Civ, Regions, Year } from './types';
import { AdjKind, Layer } from './types';
import { Biome } from '../biomes';
import { MinHeap } from '../util';
import { keyed, subSeed } from './engine/rand';
import type { CivSim } from './engine/sim';
import { Cap, CAP_COUNT, DISCOVER_AT, GATE_NEAR, RESOURCE_COUNT, devModelOf, gateNeed, type DevModel } from './development';
import { warModelOf, type WarModel } from './wars';
import { polityModelOf, sailsOcean, type PolityModel } from './polities';
import { capitalAt } from './growth';
import type { CivModule } from './modules';
import { civApi } from './api';

/** 一步多少年(和发展度同一步) */
const STEP = 20;
/** 买方至少几州 */
const MIN_SIZE = 3;
/** 同时在用的商道:每这么多州一条,至少 MIN_ROUTES、至多 MAX_ROUTES 条 */
const REGIONS_PER_ROUTE = 75;
const MIN_ROUTES = 5;
const MAX_ROUTES = 12;
/** 上一步就在的商道,排名时分数 × KEEP */
const KEEP = 1.6;
/** 原来的产地比最近的远不过这么多倍,照旧从那里运 */
const HYST = 1.8;
/** 断满这么多年,另找产地 */
const BROKEN_MAX = 60;
/** 路程上限(世界单位):RANGE_BASE + RANGE_PER × 国都所在州的运输能力 */
const RANGE_BASE = 150;
const RANGE_PER = 150;
/** 过界的代价(按 AdjKind:平地、跨河、翻山、海峡、航线) */
const EDGE = [1, 1, 2, 2, 2.5];

/**
 * 物产的下标(同 development.ts 的 Res)。推演的几个文件互相引用,这个文件装载时 development.ts 可能还没装载完,
 * 装载时就要用的值不从那边取
 */
export const G = { Livestock: 1, Copper: 2, Iron: 3, Coal: 4, Salt: 6, Oil: 8, Rare: 9, Gold: 10 } as const;
/** 运的货(物产下标),按分量从重到轻 */
export const TRADE_GOODS: readonly number[] = [G.Salt, G.Iron, G.Copper, G.Coal, G.Oil, G.Livestock, G.Rare, G.Gold];
/** 每样货的分量(排名、"按运得最多的那样起名"用) */
const WEIGHT: Readonly<Record<number, number>> = { [G.Salt]: 1, [G.Iron]: 0.9, [G.Copper]: 0.9, [G.Coal]: 0.9, [G.Oil]: 0.9, [G.Livestock]: 0.8, [G.Rare]: 0.7, [G.Gold]: 0.6 };
const GOODS_MASK = TRADE_GOODS.reduce((m, g) => m | (1 << g), 0);
/** 马:牲畜要在这些群落里才算(草原、荒漠) */
const HORSE_BIOMES = new Set<number>([Biome.Steppe, Biome.Savanna, Biome.ColdDesert, Biome.TemperateDesert, Biome.HotDesert]);

// ---------------------------------------------------------------------------
// 数据(Civ.trade)

/** 商道的一件大事:通、断、复通、废 */
export interface TradeEvent {
  year: Year;
  kind: 'open' | 'break' | 'reopen' | 'end';
  /** 断、复通:哪一仗(史事 war 的编号;宣战断的、议和复通的才有) */
  war?: number;
  /** 断:和哪国交兵(没有 = 不给) */
  foe?: number;
  /** 废:买方亡了(fall)/ 本国采得到了(gain)/ 用不着了(need:过了时代门口,门槛要的矿不再缺)/ 产地不产了或另找了产地(gone)/ 商旅渐稀(fade) */
  why?: 'fall' | 'gain' | 'need' | 'gone' | 'fade';
}

export interface TradeRoute {
  id: number;
  /** 名字(finishTrade 起;按运得最多的那样货 + 产地的名字) */
  name: string;
  /** 买方国家 */
  buyer: number;
  /** 产地州 */
  from: number;
  /** 运过的货(Res 下标):从哪年运到哪年(还在运 = until 不给);按开始运的先后 */
  goods: { res: number; from: Year; until?: Year }[];
  /** 通断(按年份排好):第一件是通,最后一件可能是废 */
  events: TradeEvent[];
  /** 路线:经过的州(产地 → 买方国都所在州);路线变了从那年起另记一版 */
  paths: { year: Year; regions: number[] }[];
}

/** 接着推要的状态 */
export interface TradeState {
  /** 上一步算到哪一年;史事读到第几条 */
  last: Year;
  annals: number;
  /** 还没废的商道:编号、挡着它的仗(断着时)、上一步经过的国家(含产地所属国,不含买方) */
  live: { id: number; broken: boolean; blockers: number[]; via: number[] }[];
  /** 停下那一刻(不在整步上)先记上的事:[商道编号, 几件](接着推时去掉);没有 = 不给 */
  tail?: [number, number][];
}

export interface Trade {
  routes: TradeRoute[];
  state: TradeState;
}

// ---------------------------------------------------------------------------
// 推演里的模型

interface Live {
  r: TradeRoute;
  broken: boolean;
  blockers: number[];
  via: number[];
}

interface TradeModel {
  base: number;
  d: DevModel;
  pm: PolityModel;
  wm: WarModel;
  last: Year;
  annals: number;
  routes: TradeRoute[];
  live: Live[];
  /** 寻路的草稿 */
  dist: Float64Array;
  prev: Int32Array;
  stamp: Int32Array;
  /** 走完了(出堆)的州:fin = round */
  fin: Int32Array;
  round: number;
  heap: MinHeap;
}

const models = new WeakMap<CivSim, TradeModel>();

/** 登记商道(generateCiv 里,installDevelopment 之后) */
export function installTrade(sim: CivSim, seed: number): void {
  hook(sim, subSeed(seed, 'civ-trade'), null);
}

/** 接着推(resumeCiv,resumeDevelopment 之后):从 Civ.trade 接上;没有的(旧版本的历史)从现在起算 */
export function resumeTrade(sim: CivSim, civ: Civ): void {
  hook(sim, subSeed(civ.seed, 'civ-trade'), civ);
}

function hook(sim: CivSim, base: number, civ: Civ | null): void {
  const api = civApi(sim);
  const d = devModelOf(sim);
  const pm = polityModelOf(sim);
  const wm = warModelOf(sim);
  if (!d || !pm || !wm) return;
  const R = pm.terrain.R;
  const m: TradeModel = {
    base,
    d,
    pm,
    wm,
    last: -Infinity,
    annals: 0,
    routes: [],
    live: [],
    dist: new Float64Array(R),
    prev: new Int32Array(R),
    stamp: new Int32Array(R),
    fin: new Int32Array(R),
    round: 0,
    heap: new MinHeap(256),
  };
  const t = civ?.trade;
  if (t) {
    m.last = t.state.last;
    m.annals = t.state.annals;
    m.routes = t.routes.map(copyRoute);
    // 停下那一刻先记上的几件(上一步以后的宣战、议和、亡国):去掉,从上一步接着算
    for (const [id, n] of t.state.tail ?? []) m.routes[id]?.events.splice(-n, n);
    m.live = t.state.live.filter((l) => m.routes[l.id]).map((l) => ({ r: m.routes[l.id], broken: l.broken, blockers: l.blockers.slice(), via: l.via.slice() }));
  } else if (civ) {
    m.annals = civ.annals.length;
  }
  models.set(sim, m);
  api.dev.afterTick = (y) => step(sim, m, y);
}

/**
 * 推演到这一刻的商道(整理一份;regions = 州表,起名用,不给 = 不起名)。
 * 上一步以后到这一刻的宣战、议和、买方亡国先记上(这一刻停下的历史里看得到);接着推时去掉它们,从上一步接着算(TradeState.tail)
 */
export function finishTrade(sim: CivSim, regions?: Regions): Trade | undefined {
  const m = models.get(sim);
  if (!m) return undefined;
  const routes: TradeRoute[] = m.routes.map(copyRoute);
  const before = routes.map((r) => r.events.length);
  const live = m.live.map((L) => ({ r: routes[L.r.id], broken: L.broken, blockers: L.blockers.slice(), via: L.via.slice() }));
  scanAnnals(sim, m.pm, live, m.annals);
  dropFallen(m.pm, live, sim.now, false);
  const tail: [number, number][] = [];
  routes.forEach((r, i) => {
    if (r.events.length > before[i]) tail.push([i, r.events.length - before[i]]);
  });
  if (regions) nameRoutes(routes, regions, m.d.world.mesh);
  return {
    routes,
    state: {
      last: m.last,
      annals: m.annals,
      live: m.live.map((l) => ({ id: l.r.id, broken: l.broken, blockers: l.blockers.slice(), via: l.via.slice() })),
      ...(tail.length ? { tail } : {}),
    },
  };
}

function copyRoute(r: TradeRoute): TradeRoute {
  return { ...r, goods: r.goods.map((g) => ({ ...g })), events: r.events.map((e) => ({ ...e })), paths: r.paths.map((p) => ({ year: p.year, regions: p.regions.slice() })) };
}

/** 推演引擎上挂着的商道模型里此刻的商道(测试、统计用) */
export function tradeRoutesOf(sim: CivSim): readonly TradeRoute[] | undefined {
  return models.get(sim)?.routes;
}

function push(L: Live, e: TradeEvent): void {
  L.r.events.push(e);
}

/**
 * 这一步里"看出来"的大事定在哪一刻:(t − STEP, t] 里按 keyed 取(1/256 年为单位,和推演的时刻一样),
 * 晚于这条商道上一件事(上一件在这一步里的:取它和 t 的正中)
 */
function when(m: TradeModel, L: Live, t: Year, what: number, who: number): Year {
  const y = t - Math.floor(keyed(m.base, who, Math.floor(t), what) * STEP * 256) / 256;
  const lo = lastYear(L);
  if (y > lo) return y;
  const z = Math.ceil(((lo + t) / 2) * 256) / 256;
  return z > lo && z <= t ? z : t;
}

function step(sim: CivSim, m: TradeModel, t: Year): void {
  const { pm, wm, d } = m;
  const ownP = sim.owners[Layer.Polity];
  const ownC = sim.owners[Layer.Culture];
  const reg = pm.terrain.regions;
  const R = Math.min(pm.terrain.R, ownP.length);

  // 1. 两步之间的史事:宣战断、议和复通;2. 买方亡了:那一年废
  m.annals = scanAnnals(sim, pm, m.live, m.annals);
  const P = pm.polities.length;
  const alive = (p: number) => p >= 0 && p < P && pm.polities[p].ended === undefined && pm.size[p] > 0;
  m.live = dropFallen(pm, m.live, t, true);

  // 3. 各州眼下产什么(按位):有人住、这一刻采得到(发现了、没采空;development.ts 的 availNow);马要在草原、荒漠上
  const prod = new Uint16Array(R);
  const availNow = d.availNow;
  for (let r = 0; r < R; r++) {
    if (ownC[r] < 0) continue;
    const o = r * RESOURCE_COUNT;
    let b = 0;
    for (const g of TRADE_GOODS) if (availNow[o + g] > 0) b |= 1 << g;
    if (b & (1 << G.Livestock) && !HORSE_BIOMES.has(reg.biome[r])) b &= ~(1 << G.Livestock);
    prod[r] = b;
  }

  // 交兵的国家
  const foes = new Map<number, Map<number, number>>();
  for (const w of wm.active) {
    if (w.end !== undefined) continue;
    (foes.get(w.a) ?? foes.set(w.a, new Map()).get(w.a)!).set(w.b, w.id);
    (foes.get(w.b) ?? foes.set(w.b, new Map()).get(w.b)!).set(w.a, w.id);
  }

  // 4. 各买方缺的货从哪运
  interface Flow {
    p: number;
    g: number;
    s: number;
  }
  const flows: Flow[] = [];
  /** 断着、照旧挂在原来产地上的 */
  const held = new Set<Live>();
  const liveOf = new Map<number, Live[]>();
  for (const L of m.live) (liveOf.get(L.r.buyer) ?? liveOf.set(L.r.buyer, []).get(L.r.buyer)!).push(L);
  /** 买方 → 这一步的寻路结果(路径用) */
  const paths = new Map<number, Map<number, number[]>>();
  /** 买方 → 缺的货(按位);不在里面的 = 这一步不算买方(太小、国都丢了) */
  const wants = new Map<number, number>();
  /** 买方 → 本国眼下采得到的货(按位) */
  const owns = new Map<number, number>();
  const reachOf = new Map<number, Set<number>>();
  for (let p = 0; p < P; p++) {
    const mine = liveOf.get(p);
    if (!alive(p) || pm.size[p] < MIN_SIZE) continue;
    const q = pm.polities[p];
    const cap = pm.settlements[capitalAt(q, Infinity)];
    const cr = cap ? cap.region : -1;
    if (cr < 0 || cr >= R || ownP[cr] !== p) continue;
    // 缺什么:本国一州都采不到的盐、马;国都所在州的生产认得铁、金银以后的铁、金银;快到下一个时代门口、门槛要的矿
    // (和打仗看物产同一套门槛,development.ts 的 DISCOVER_AT、gateNeed;"有"按眼下采得到的算)
    let has = 0;
    for (const r of pm.lands[p]) if (r < R) has |= prod[r];
    const lv = d.cur[cr * CAP_COUNT + Cap.Production];
    let need0 = (1 << G.Salt) | (1 << G.Livestock);
    if (lv >= DISCOVER_AT[G.Iron]) need0 |= 1 << G.Iron;
    if (lv >= DISCOVER_AT[G.Gold]) need0 |= 1 << G.Gold;
    if (lv > Math.floor(lv) + 1 - GATE_NEAR) need0 |= gateNeed(lv);
    const want = need0 & GOODS_MASK & ~has;
    wants.set(p, want);
    owns.set(p, has);
    if (!want && !mine) continue;
    const enemies = foes.get(p);
    // 原来从哪运(货 → 那条商道)
    const prevOf = new Map<number, Live>();
    for (const L of mine ?? []) for (const g of L.r.goods) if (g.until === undefined) prevOf.set(g.res, L);
    const range = RANGE_BASE + RANGE_PER * d.cur[cr * CAP_COUNT + Cap.Transport];
    const sail = sailsOcean(pm, q, t);
    const need = new Set<number>();
    for (const g of TRADE_GOODS) if (want & (1 << g)) need.add(g);
    const best = search(m, reg, R, cr, range, sail, (r) => (enemies ? enemies.has(ownP[r]) : false), prod, ownP, p, need, prevOf);
    const got = new Map<number, number[]>();
    paths.set(p, got);
    const reached = new Set<number>();
    reachOf.set(p, reached);
    const route = (s: number) => {
      let path = got.get(s);
      if (!path) {
        path = [];
        for (let r = s; r >= 0; r = m.prev[r]) path.push(r);
        got.set(s, path);
      }
      return path;
    };
    for (const g of need) {
      const b = best.get(g);
      const L = prevOf.get(g);
      if (L) {
        const s = L.r.from;
        const still = (prod[s] & (1 << g)) !== 0;
        if (still) {
          const cs = m.fin[s] === m.round ? m.dist[s] : Infinity;
          if (cs <= range && (b === undefined || cs <= HYST * m.dist[b] || cs - m.dist[b] < 1e-9)) {
            route(s);
            reached.add(s);
            flows.push({ p, g, s });
            continue;
          }
          // 被交兵的国家挡住:断着,照旧挂在原来的产地上(断满 BROKEN_MAX 年另找)
          if (warBlocked(L, ownP, enemies) && t - brokeAt(L, t) < BROKEN_MAX) {
            held.add(L);
            flows.push({ p, g, s });
            continue;
          }
        }
      }
      if (b !== undefined) {
        route(b);
        reached.add(b);
        flows.push({ p, g, s: b });
      }
    }
  }

  // 5. 合成商道(同一买方、同一产地),排名取前 N 条
  const key = (p: number, s: number) => p * 65536 + s;
  const groups = new Map<number, { p: number; s: number; goods: number[]; L: Live | null }>();
  for (const f of flows) {
    const k = key(f.p, f.s);
    let gr = groups.get(k);
    if (!gr) groups.set(k, (gr = { p: f.p, s: f.s, goods: [], L: null }));
    gr.goods.push(f.g);
  }
  for (const L of m.live) {
    const gr = groups.get(key(L.r.buyer, L.r.from));
    if (gr) gr.L = L;
  }
  const N = Math.max(MIN_ROUTES, Math.min(MAX_ROUTES, Math.round(R / REGIONS_PER_ROUTE)));
  const ranked = [...groups.values()]
    .map((gr) => ({ gr, score: pm.size[gr.p] * gr.goods.reduce((s, g) => s + WEIGHT[g], 0) * (gr.L ? KEEP : 1) }))
    .sort((a, b) => b.score - a.score || (a.gr.L ? 0 : 1) - (b.gr.L ? 0 : 1) || a.gr.p - b.gr.p || a.gr.s - b.gr.s);
  const keep = ranked.slice(0, N).map((x) => x.gr);
  const kept = new Set<Live>();
  for (const gr of keep) if (gr.L) kept.add(gr.L);

  // 没选上 / 没货了的旧商道:废
  m.live = m.live.filter((L) => {
    if (kept.has(L)) return true;
    const gr = groups.get(key(L.r.buyer, L.r.from));
    const w = wants.get(L.r.buyer);
    const why: TradeEvent['why'] = gr || w === undefined ? 'fade' : lostWhy(L, w, owns.get(L.r.buyer) ?? 0);
    end(L, when(m, L, t, 1, L.r.id), why);
    return false;
  });

  // 6. 选上的:货、路线、通断
  for (const gr of keep) {
    let L = gr.L;
    const fresh = !L;
    if (!L) {
      const r: TradeRoute = { id: m.routes.length, name: '', buyer: gr.p, from: gr.s, goods: [], events: [], paths: [] };
      m.routes.push(r);
      L = { r, broken: false, blockers: [], via: [] };
      m.live.push(L);
      push(L, { year: when(m, L, t, 0, gr.p * 4096 + gr.s), kind: 'open' });
    }
    const r = L.r;
    // 货:不运了的记 until,新运的接在后面
    const now = new Set(gr.goods);
    for (const g of r.goods) if (g.until === undefined && !now.has(g.res)) g.until = t;
    const on = new Set(r.goods.filter((g) => g.until === undefined).map((g) => g.res));
    const added = TRADE_GOODS.filter((g) => now.has(g) && !on.has(g));
    for (const g of added) r.goods.push({ res: g, from: fresh ? r.events[0].year : t });
    // 路线:这一步走得到就照这一步的,变了另记一版
    const path = held.has(L) && !reachOf.get(gr.p)?.has(gr.s) ? null : paths.get(gr.p)?.get(gr.s);
    if (path && path.length) {
      const lastP = r.paths[r.paths.length - 1];
      if (!lastP || !same(lastP.regions, path)) r.paths.push({ year: fresh ? r.events[0].year : t, regions: path.slice() });
    }
    // 通断:这一刻还被挡着 = 断
    const enemies = foes.get(gr.p);
    const blocked = !path || !path.length;
    if (blocked && !L.broken) {
      const foe = foeOn(L, ownP, enemies);
      push(L, { year: when(m, L, t, 2, r.id), kind: 'break', ...(foe ? { war: foe.war, foe: foe.p } : {}) });
      L.broken = true;
    } else if (!blocked && L.broken) {
      push(L, { year: when(m, L, t, 3, r.id), kind: 'reopen' });
      L.broken = false;
    }
    // 挡着它的仗、经过的国家
    L.via = viaOf(r, ownP, gr.p);
    L.blockers = L.broken && enemies ? L.via.filter((q) => enemies.has(q)).map((q) => enemies.get(q)!) : [];
  }
  finishStep(m, t);
}

/**
 * 史事从第 from 条读起:买方和商道经过的国家宣战 → 断(记下是哪一仗),挡着它的仗都议和了 → 复通
 * (买方那一刻已经亡了的不算复通:亡国时它的仗都议和了,接着就废)。返回读到第几条
 */
function scanAnnals(sim: CivSim, pm: PolityModel, live: Live[], from: number): number {
  let i = from;
  for (; i < sim.annalCount; i++) {
    const e = sim.annal(i);
    if (e.kind === 'war') {
      for (const L of live) {
        const p = L.r.buyer;
        const q = e.a === p ? e.b : e.b === p ? e.a : -1;
        if (q < 0 || !L.via.includes(q)) continue;
        if (!L.broken) {
          push(L, { year: e.year, kind: 'break', war: e.war, foe: q });
          L.broken = true;
        }
        if (!L.blockers.includes(e.war)) L.blockers.push(e.war);
      }
    } else if (e.kind === 'peace') {
      for (const L of live) {
        const k = L.blockers.indexOf(e.war);
        if (k < 0) continue;
        L.blockers.splice(k, 1);
        const gone = pm.polities[L.r.buyer]?.ended;
        if (L.broken && !L.blockers.length && !(gone !== undefined && gone <= e.year)) {
          push(L, { year: e.year, kind: 'reopen', war: e.war });
          L.broken = false;
        }
      }
    }
  }
  return i;
}

/** 买方亡了的:那一年废(goods = 运的货也记上到哪年);返回还在的 */
function dropFallen(pm: PolityModel, live: Live[], t: Year, goods: boolean): Live[] {
  const P = pm.polities.length;
  return live.filter((L) => {
    const p = L.r.buyer;
    if (p >= 0 && p < P && pm.polities[p].ended === undefined && pm.size[p] > 0) return true;
    const y = pm.polities[p]?.ended ?? t;
    end(L, Math.max(y, lastYear(L)), 'fall', goods);
    return false;
  });
}

function finishStep(m: TradeModel, t: Year): void {
  m.last = t;
}

function lastYear(L: Live): Year {
  const ev = L.r.events;
  return ev.length ? ev[ev.length - 1].year : -Infinity;
}

function end(L: Live, y: Year, why: TradeEvent['why'], goods = true): void {
  if (L.broken) L.broken = false;
  if (goods) for (const g of L.r.goods) if (g.until === undefined) g.until = y;
  push(L, { year: y, kind: 'end', why });
}

/** 断的那一年(没断着 = t) */
function brokeAt(L: Live, t: Year): Year {
  if (!L.broken) return t;
  const ev = L.r.events;
  for (let i = ev.length - 1; i >= 0; i--) if (ev[i].kind === 'break') return ev[i].year;
  return t;
}

/** 被交兵的国家挡住:产地归了交兵的国家,或上一版路线经过交兵的国家 */
function warBlocked(L: Live, ownP: Int16Array, enemies: Map<number, number> | undefined): boolean {
  if (!enemies) return false;
  const path = L.r.paths[L.r.paths.length - 1];
  if (!path) return enemies.has(ownP[L.r.from]);
  for (const r of path.regions) if (r < ownP.length && enemies.has(ownP[r])) return true;
  return false;
}

/** 挡路的是哪国、哪一仗(产地所属国先看,再按路线从产地往国都看) */
function foeOn(L: Live, ownP: Int16Array, enemies: Map<number, number> | undefined): { p: number; war: number } | null {
  if (!enemies) return null;
  const path = L.r.paths[L.r.paths.length - 1];
  const regions = path ? path.regions : [L.r.from];
  for (const r of regions) {
    const q = r < ownP.length ? ownP[r] : -1;
    if (q >= 0 && enemies.has(q)) return { p: q, war: enemies.get(q)! };
  }
  return null;
}

/**
 * 为什么没货了:还在运的货买方都不缺了 —— 本国都采得到了 = gain,不然 = need(用不着了);
 * 还缺着 = 产地不产了或另找了产地(gone)
 */
function lostWhy(L: Live, want: number, has: number): TradeEvent['why'] {
  const on = L.r.goods.filter((g) => g.until === undefined);
  if (on.some((g) => want & (1 << g.res))) return 'gone';
  return on.every((g) => has & (1 << g.res)) ? 'gain' : 'need';
}

/** 路线经过的国家(含产地所属国;不含买方、没有国家的地方),按从产地到国都的先后 */
function viaOf(r: TradeRoute, ownP: Int16Array, p: number): number[] {
  const out: number[] = [];
  const path = r.paths[r.paths.length - 1];
  for (const x of path ? path.regions : [r.from]) {
    const q = x < ownP.length ? ownP[x] : -1;
    if (q >= 0 && q !== p && !out.includes(q)) out.push(q);
  }
  return out;
}

function same(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * 从买方国都所在州 cr 出发的 Dijkstra(路程上限 range;交兵的国家不进;sail = 能走航线)。
 * 返回每样要的货最近的产地(不在买方本国);走到的州的路程、来路留在 m.dist / m.prev(m.stamp = m.round 的才算)。
 * 要的货都找到了、原来的产地也都走到了(或已经远过最近的 HYST 倍)就停
 */
function search(
  m: TradeModel,
  reg: Regions,
  R: number,
  cr: number,
  range: number,
  sail: boolean,
  blocked: (r: number) => boolean,
  prod: Uint16Array,
  ownP: Int16Array,
  p: number,
  need: Set<number>,
  prevOf: Map<number, Live>,
): Map<number, number> {
  const round = ++m.round;
  const { dist, prev, stamp, fin, heap } = m;
  heap.size = 0;
  dist[cr] = 0;
  prev[cr] = -1;
  stamp[cr] = round;
  heap.push(cr, 0);
  const best = new Map<number, number>();
  // 原来的产地:最近的都找到以后,还要走到它们(或远过最近的 HYST 倍)才停
  const wait = new Set<number>();
  for (const [g, L] of prevOf) if (need.has(g)) wait.add(L.r.from);
  let left = need.size;
  let stopAt = Infinity;
  while (heap.size) {
    const u = heap.pop();
    const du = heap.lastPri;
    if (fin[u] === round || du > dist[u]) continue;
    if (du > range || du > stopAt) break;
    fin[u] = round;
    wait.delete(u);
    const b = prod[u];
    if (left && b && ownP[u] !== p)
      for (const g of need) {
        if (best.has(g) || !(b & (1 << g))) continue;
        best.set(g, u);
        left--;
      }
    if (!left) {
      if (!wait.size) break;
      if (stopAt === Infinity) {
        let far = 0;
        for (const g of need) far = Math.max(far, dist[best.get(g)!]);
        stopAt = far * HYST + 1e-9;
      }
    }
    const a1 = reg.adjStart[u + 1];
    for (let e = reg.adjStart[u]; e < a1; e++) {
      const v = reg.adj[e];
      if (v >= R || fin[v] === round) continue;
      const k = reg.adjKind[e];
      if (k === AdjKind.SeaRoute && !sail) continue;
      if (blocked(v)) continue;
      const nd = du + reg.adjLen[e] * EDGE[k];
      if (stamp[v] !== round || nd < dist[v]) {
        stamp[v] = round;
        dist[v] = nd;
        prev[v] = u;
        heap.push(v, nd);
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 起名

/** 货 → 名字里的字(铁、石油、稀有矿不带字:避开"铁道""油道"这类现代词,只用产地的名字) */
const GOOD_CHAR: Readonly<Record<number, string>> = { [G.Salt]: '盐', [G.Livestock]: '马', [G.Gold]: '金', [G.Copper]: '铜', [G.Coal]: '煤' };
/** 州名末尾的这些字起名时去掉("万兴郡" → "万兴道") */
const SUFFIX = /(州|郡|府|县|省|道|原|川|部)$/;

/**
 * 起名:产地的名字 + 运得最多的那样货 + "道";和开通时还在的商道同名的加方位("万兴西道"),再同名加"新"。
 * 同一个买方从同一处产地运的(废了以后又开的)用同一个名字。按开通的先后起,接着推时早先的名字不变
 */
function nameRoutes(routes: TradeRoute[], regions: Regions, mesh: { x: Float32Array; y: Float32Array; width: number }): void {
  const used = new Map<string, TradeRoute>();
  const endOf = (r: TradeRoute) => {
    const e = r.events[r.events.length - 1];
    return e.kind === 'end' ? e.year : Infinity;
  };
  const byPair = new Map<number, string>();
  const order = routes.slice().sort((a, b) => a.events[0].year - b.events[0].year || a.id - b.id);
  // 东西相连:世界宽度就是周期
  const W = mesh.width;
  for (const r of order) {
    const pair = r.buyer * 65536 + r.from;
    const t0 = r.events[0].year;
    const taken = (n: string) => {
      const o = used.get(n);
      return !!o && endOf(o) > t0;
    };
    // 同一个买方、同一处产地又开的:用原来的名字(这名字眼下没被别的商道占着)
    const again = byPair.get(pair);
    if (again && !taken(again)) {
      r.name = again;
      used.set(again, r);
      continue;
    }
    const raw = regions.name?.[r.from] || '';
    // "丹江之野" → "丹江";"万兴郡" → "万兴"
    const of = raw.indexOf('之');
    let stem = of >= 2 ? raw.slice(0, of) : raw.length >= 3 ? raw.replace(SUFFIX, '') : raw;
    if (!stem) stem = '无名';
    const first = r.goods.filter((g) => g.from <= r.events[0].year);
    const main = (first.length ? first : r.goods).reduce((a, g) => (WEIGHT[g.res] > WEIGHT[a.res] ? g : a)).res;
    const ch = GOOD_CHAR[main] ?? '';
    let name = `${stem}${ch}道`;
    if (taken(name)) {
      const path = r.paths[0]?.regions;
      const to = path && path.length ? path[path.length - 1] : r.from;
      name = `${stem}${direction(mesh, regions.seat[r.from], regions.seat[to], W)}${ch}道`;
      if (taken(name)) name = `新${name}`;
      for (let i = 2; taken(name); i++) name = `${stem}${ch}${i}道`;
    }
    r.name = name;
    used.set(name, r);
    byPair.set(pair, name);
  }
}

/** b 在 a 的哪一边(东西南北;东西相连的世界按近的一边) */
function direction(mesh: { x: Float32Array; y: Float32Array }, a: number, b: number, W: number): string {
  let dx = mesh.x[b] - mesh.x[a];
  if (W) dx -= W * Math.round(dx / W);
  const dy = mesh.y[b] - mesh.y[a];
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? '东' : '西';
  return dy >= 0 ? '南' : '北';
}

/** 模块:商道:跟着发展度每 20 年算一步,只读推演、不改历史(清单和次序见 modules.ts) */
export const tradeModule: CivModule = {
  id: 'trade',
  install: (c) => {
    if (c.pm) installTrade(c.sim, c.seed);
  },
  resume: (c) => resumeTrade(c.sim, c.civ),
  finish: (c) => {
    const trade = finishTrade(c.sim, c.regions);
    if (trade) c.civ.trade = trade;
  },
};

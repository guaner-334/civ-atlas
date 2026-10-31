/**
 * 道路网与航线:城与城之间修路,港口之间开航线。纯计算,不碰 DOM。
 *
 *   1. 定城:有城镇列表时用城镇(见 RouteCity);没有时每个州的治所就是一座城(不可居的除外),
 *      人口上限最大、彼此隔得开的一批当"大城",代替国都。
 *   2. 定连哪些城(只走邻接,每片陆地各算各的):城按够格的年份一批批加进来,从新城洇染,两城的势力范围相接就是"邻城";
 *      再做 Urquhart 图 —— 每个"三城两两相邻"的三角里删掉代价最大的那条新连线,
 *      不会有太远的连线,也没有太多三角回路(见 GrowingGraph)。先在大城之间连(大路),再在所有城之间连(小路)。
 *      后来的城只添新连线、不改早先的:推演推得再远,早先修好的路不变。
 *      新城留下的连线连的全是那年已毁的城时,补一条连最近的、那年还在的城(不然它不通路)。
 *   3. 地块级 A* 寻路。每一步的代价 = 距离 × 坡度 × 海拔 × 群落 × 河流(沿河道本身走、跨河都加价,
 *      所以路走在河谷里、河的旁边);已有路的打五折(后修的路并进先修的路,形成主干道),
 *      不穿城(那时已经有的城)的地块加罚(路愿意穿城而过);不下海、不进湖、不穿冰原。
 *      和已有路重合的部分切掉,只留新修的段落。
 *      大路走到早先修的小路上,那一段从大路的修建年份起升级成大路(小路记 abandoned)。
 *   4. 平行的冗余小路:修一段小路时,两端之间沿那时的路网另有一条差不多长、又紧挨着它的路,就不修(并进主干道)。
 *   5. 航线:同一片海的港口之间,同样用"势力范围相接 + Urquhart"定连哪些港,在海上 A* 寻路;
 *      近岸便宜、远洋贵;结冰的海(海冰 ≥ 0.5 或海冰群落)不能走。
 *      同一片陆地上、陆路本来就连着的两港,只有海路比陆路(只比地形)近得多时才开航线(省得沿海岸画两道线)。
 *   6. 阶段 3 城市兴衰:城被毁(RouteCity.lives 一段结束)后,只通往它的路那一年起荒废(Route.abandoned);原址重建的城够格以后重新通路。
 *      每一步路记下"用它的连线里最晚结束的那一年"(两端都还在的连线 = 永不结束),全都结束了才荒废;
 *      废城的邻城之间另加"绕行"连线(城被毁那年起;寻路时几乎全走原来经过废城的路),所以路过废城的干道照常在,只有岔进废城的那一截荒废。
 *      没修的冗余小路,它的连线改记在替代它的那条路上。停用以后又有新连线走上来的路段,从那年起重新开一段。
 *      推演里走过的航线(opts.lanes)登岸处是故址的(城被毁、还没在原址重建,见 polities.ts 的 ruinGaps),那些年也不画,重建以后照原路重新画。
 *
 * 距离和启发函数一律来自几何层(geo.ts / gen/geometry.ts),只沿 mesh 邻接走,不用 x、y 直接算间距。
 * 没有随机数:结果只由世界决定;并列时按地块 / 城的编号定先后。
 */
import { biomeColumn, biomeTagged } from '../biomes';
import { MinHeap } from '../util';
import type { Progress, World } from '../world';
import { AdjKind, Layer, type ChangeLog, type Culture, type Habitat, type Regions, type Route, type Year } from './types';
import { KM_PER_UNIT, adjLengths, cellAreas, refSpacing } from './geo';
import { geometryOf } from '../geometry';
import { defineKnobs } from './engine/knobs';

/** 修路用的"城"。由城镇列表生成(polities.ts 的 routeCities;大城 = 国都,port = 城镇的港口标记) */
export interface RouteCity {
  cell: number;
  /** 大城:先在它们之间修大路(没有城镇列表时 = 人口上限最大的一批州的治所) */
  major: boolean;
  /** 港口:可以开航线 */
  port: boolean;
  /** 建城年份。一条路的 built = 两端城市里较晚的那个 */
  founded: Year;
  /** 成为大城(国都)的年份:大路的 built = 两端里较晚的那个。不给 = founded */
  majorFrom?: Year;
  /** 成为港口的年份(地形大事以后才成了港口的):航线的 built = 两端里较晚的那个。不给 = founded */
  portFrom?: Year;
  /**
   * 阶段 3 城市兴衰:城被毁的年份(还在 = 不给)。只通往它的路从这一年起荒废(Route.abandoned);
   * 路过它、还连着别的城的路照常用(它的邻城之间另算一条"绕行"连线,见 buildRoutes)
   */
  ended?: Year;
  /**
   * 在世的年份段 [够格修路, 被毁)(同一处城址毁了又重建的有好几段;不给 = [founded, ended ?? Infinity) 一段):
   * 通往它的路在两段之间荒废,重建的城够格以后重新通路
   */
  lives?: [Year, Year][];
}

/** 推演里走过的一条海峡 / 航线(州图上的边):两头的海岸地块 a、b(Regions.adjCoast),从 built 那年起画 */
export interface UsedLane {
  a: number;
  b: number;
  built: Year;
}

export interface RouteOptions {
  /** 不传 = 每州治所一座城(见 seatCities) */
  cities?: RouteCity[];
  /** 推演里走过的海峡、航线(usedLanes):两头的海岸之间一定画一条航线,从 built 那年起(和港口之间的航线一起修,重合的并成一条) */
  lanes?: UsedLane[];
  /** 城址空着的年份段(polities.ts 的 ruinGaps):走过的航线登岸处是故址的,这些年不画,原址重建以后照原路重新画 */
  ruins?: ReadonlyMap<number, readonly (readonly [Year, Year])[]>;
  progress?: Progress;
}

// ---- 调参(以截图效果为准) ----
/** 这一段的旋钮(名字、默认值;推演照 values 里的数算) */
export const ROUTES_KNOBS = defineKnobs('routes', {
  /** 宜居分低于这个值的治所不算城(和"城址"显示一致) */
  CITY_MIN_SUIT: 1,
  /** 大城约占城数的这个比例(没有城镇列表时代替国都) */
  MAJOR_SHARE: 1 / 40,
  /** 大城彼此至少隔开 √(陆地面积 / 大城数) × 这个系数(沿陆地走) */
  MAJOR_SPACING: 0.6,
  /** 已有路的地块之间走:打几折 */
  REUSE: 0.5,
  /** 不是城的地块:代价乘几 */
  NO_CITY: 2,
  /** 坡度(米 / 公里)到这个值时,代价翻倍;按平方增长 */
  SLOPE_REF: 2.5,
  SLOPE_MAX: 40,
  /** 平均海拔每多这么多米,代价多一倍 */
  ELEV_REF: 3000,
  /** 沿着河道本身走(两块都是河):代价乘几。路走在河边,不压在河上 */
  RIVER_ALONG: 1.5,
  /** 跨河:一侧是河的一步多走几成路,按河的大小 √(流量 / 阈值) 放大 */
  RIVER_CROSS: 0.25,
  /** 航线:离岸第 1、2、3、4、5+ 块海的代价倍数(近岸便宜、远洋贵) */
  SEA_DEPTH: [1, 1, 1.4, 2, 3],
  /** 航线最长多少个地块间距(势力范围洇染的上限) */
  SEA_MAX_STEPS: 45,
  /** 同陆地两港:陆路代价 > 海路代价 × 这个倍数才开航线 */
  SEA_VS_LAND: 2.5,
  /** 冗余小路:另一条路不超过它长度的这个倍数,而且它的每一块都挨着那条路,就不修 */
  PARALLEL_RATIO: 1.6,
});
const { CITY_MIN_SUIT, MAJOR_SHARE, MAJOR_SPACING, REUSE, NO_CITY, SLOPE_REF, SLOPE_MAX, ELEV_REF, RIVER_ALONG, RIVER_CROSS, SEA_DEPTH, SEA_MAX_STEPS, SEA_VS_LAND, PARALLEL_RATIO } = ROUTES_KNOBS.values;

/** 路段类别在 slot 数组里的编号(0 = 没有路) */
const KIND_CODE = { road: 1, trail: 2, sea: 1 } as const;

/** 群落修路难度(乘在代价上;冰原不能走;见地貌表的 roadCost) */
const BIOME_ROAD = biomeColumn('roadCost');

/** 海冰、冰原群落(地貌表的标签 seaIce、ice) */
const SEA_ICE = biomeTagged('seaIce');
const ICE = biomeTagged('ice');

/** 结冰的水面:海冰 ≥ 0.5,或海冰群落 */
export function icyWater(world: World, i: number): boolean {
  return world.seaIce[i] >= 0.5 || SEA_ICE[world.biome[i]] === 1;
}

/** 路能走的地块:陆地,且不是冰原 */
export function roadPassable(world: World, i: number): boolean {
  return world.water[i] === 0 && !ICE[world.biome[i]];
}

/** 航线能走的地块:海面(不含湖),且没结冰 */
export function seaPassable(world: World, i: number): boolean {
  return world.water[i] === 1 && !icyWater(world, i);
}

/**
 * 没有城镇列表时的城:每州治所一座(不可居 / 冰原上的除外)。
 * 大城 = 人口上限最大、彼此隔得开的一批;港口 = 挨着能通航的海。
 */
export function seatCities(world: World, habitat: Habitat, regions: Regions): RouteCity[] {
  const { mesh } = world;
  const { adjStart, adj } = mesh;
  const list: { cell: number; cap: number }[] = [];
  for (let r = 0; r < regions.count; r++) {
    const s = regions.seat[r];
    if (habitat.suitability[s] < CITY_MIN_SUIT || !roadPassable(world, s)) continue;
    list.push({ cell: s, cap: regions.capacity[r] });
  }
  const cities: RouteCity[] = list.map(({ cell }) => {
    let port = false;
    for (let k = adjStart[cell]; k < adjStart[cell + 1]; k++) if (seaPassable(world, adj[k])) port = true;
    return { cell, major: false, port, founded: 0 };
  });
  if (!cities.length) return cities;

  // 大城:按人口上限从大到小,和已选的大城沿陆地隔得够远才选
  let landArea = 0;
  const area = cellAreas(mesh);
  for (let i = 0; i < mesh.n; i++) if (world.water[i] === 0) landArea += area[i];
  const want = Math.max(1, Math.round(cities.length * MAJOR_SHARE));
  const spacing = Math.sqrt(landArea / want) * MAJOR_SPACING;
  const order = list.map((_, i) => i).sort((a, b) => list[b].cap - list[a].cap || list[a].cell - list[b].cell);
  const len = adjLengths(mesh);
  const dist = new Float64Array(mesh.n).fill(Infinity);
  const heap = new MinHeap(256);
  let picked = 0;
  for (const c of order) {
    if (picked >= want) break;
    const s = list[c].cell;
    if (dist[s] < spacing) continue;
    cities[c].major = true;
    picked++;
    // 从新大城出发洇染到 spacing 为止,记下离最近大城的路程
    dist[s] = 0;
    heap.size = 0;
    heap.push(s, 0);
    while (heap.size) {
      const i = heap.pop();
      const d = heap.lastPri;
      if (d > dist[i]) continue;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        if (!roadPassable(world, j)) continue;
        const nd = d + len[k];
        if (nd < spacing && nd < dist[j]) {
          dist[j] = nd;
          heap.push(j, nd);
        }
      }
    }
  }
  return cities;
}

export interface Link {
  a: number;
  b: number;
  w: number;
}

/**
 * 城的"邻城图":从所有城同时洇染(代价 cost,< 0 不能走;maxD 以外不去),
 * 两城的势力范围相接就连一条边,边权 = 两边到交界的代价之和(取最小)。
 */
export function neighborGraph(
  mesh: World['mesh'],
  src: number[],
  cost: Float32Array,
  maxD = Infinity,
): Link[] {
  const { n, adjStart, adj } = mesh;
  const d = new Float64Array(n).fill(Infinity);
  const lab = new Int32Array(n).fill(-1);
  const heap = new MinHeap(1024);
  for (let c = 0; c < src.length; c++) {
    const s = src[c];
    if (lab[s] >= 0) continue; // 两城同一块地(不会发生)
    d[s] = 0;
    lab[s] = c;
    heap.push(s, 0);
  }
  while (heap.size) {
    const i = heap.pop();
    const di = heap.lastPri;
    if (di > d[i]) continue;
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const c = cost[k];
      if (c < 0) continue;
      const j = adj[k];
      const nd = di + c;
      if (nd < d[j] && nd <= maxD) {
        d[j] = nd;
        lab[j] = lab[i];
        heap.push(j, nd);
      }
    }
  }
  const best = new Map<number, Link>();
  const C = src.length;
  for (let i = 0; i < n; i++) {
    const li = lab[i];
    if (li < 0) continue;
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const c = cost[k];
      if (c < 0) continue;
      const j = adj[k];
      const lj = lab[j];
      if (lj < 0 || lj === li) continue;
      const w = d[i] + c + d[j];
      if (w > maxD) continue;
      const a = li < lj ? li : lj;
      const b = li < lj ? lj : li;
      const key = a * C + b;
      const cur = best.get(key);
      if (!cur || w < cur.w) best.set(key, { a, b, w });
    }
  }
  return [...best.values()].sort((x, y) => x.a - y.a || x.b - y.b);
}

/** Urquhart 图:每个三角(三点两两相连)删掉最长的那条边。边权并列时按编号定,保证最小生成树留在图里 */
export function urquhart(count: number, links: Link[]): Link[] {
  const longer = (x: Link, y: Link) => x.w > y.w || (x.w === y.w && (x.a > y.a || (x.a === y.a && x.b > y.b)));
  const nb: Map<number, number>[] = Array.from({ length: count }, () => new Map());
  links.forEach((e, idx) => {
    nb[e.a].set(e.b, idx);
    nb[e.b].set(e.a, idx);
  });
  const drop = new Uint8Array(links.length);
  for (let a = 0; a < count; a++) {
    const na = [...nb[a].keys()].filter((b) => b > a).sort((x, y) => x - y);
    for (let s = 0; s < na.length; s++) {
      const b = na[s];
      for (let t = s + 1; t < na.length; t++) {
        const c = na[t];
        const bc = nb[b].get(c);
        if (bc === undefined) continue;
        const ab = nb[a].get(b)!;
        const ac = nb[a].get(c)!;
        let m = ab;
        if (longer(links[ac], links[m])) m = ac;
        if (longer(links[bc], links[m])) m = bc;
        drop[m] = 1;
      }
    }
  }
  return links.filter((_, i) => !drop[i]);
}

/** 由 cell 找邻接槽位 k(adj[k] === j)。邻居只有六七个,直接扫 */
function slotOf(mesh: World['mesh'], i: number, j: number): number {
  for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) if (mesh.adj[k] === j) return k;
  return -1;
}

/** 可复用的 A* 寻路器(类型化数组 + 版本戳,不每次清零) */
class Finder {
  g: Float64Array;
  prev: Int32Array;
  seen: Int32Array;
  done: Int32Array;
  stamp = 0;
  heap = new MinHeap(1024);
  constructor(n: number) {
    this.g = new Float64Array(n);
    this.prev = new Int32Array(n);
    this.seen = new Int32Array(n);
    this.done = new Int32Array(n);
  }
}

export function buildRoutes(world: World, habitat: Habitat, regions: Regions, opts: RouteOptions = {}): Route[] {
  const progress = opts.progress ?? (() => {});
  progress('道路', 0.85);
  const cities = opts.cities ?? seatCities(world, habitat, regions);
  if (cities.length < 2 && !opts.lanes?.length) return [];

  const { mesh, water, biome, elevation, flux, riverThreshold } = world;
  const { n, adjStart, adj } = mesh;
  const len = adjLengths(mesh);
  const step = refSpacing(mesh);
  const geo = geometryOf(mesh);
  /** A* 的启发函数:两地块间距离的下界 */
  const heuristic = (i: number, j: number) => geo.dist(i, j);

  // ---- 静态代价(每个邻接槽位一个;-1 = 不能走) ----
  const pass = new Uint8Array(n);
  const seaOk = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (roadPassable(world, i)) pass[i] = 1;
    else if (seaPassable(world, i)) seaOk[i] = 1;
  }
  const riverSize = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // 河的大小 = √(流量 / 河流阈值):刚成河为 1,大河约 2.5。只用 √ 和四则运算(各浏览器逐位一致)
    if (water[i] === 0 && flux[i] >= riverThreshold) riverSize[i] = Math.sqrt(flux[i] / riverThreshold);
  }
  const depthF = (j: number) => {
    const d = -habitat.coastDist[j];
    return SEA_DEPTH[Math.min(SEA_DEPTH.length - 1, Math.max(0, d - 1))];
  };
  const landCost = new Float32Array(adj.length);
  const seaCost = new Float32Array(adj.length);
  for (let i = 0; i < n; i++) {
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      const l = len[k];
      // 航线:走进开阔海面(起点可以是港口所在的陆地块;走进终点港口在寻路里单独处理)
      seaCost[k] = seaOk[j] && (seaOk[i] || pass[i]) ? l * depthF(j) : -1;
      if (!pass[i] || !pass[j]) {
        landCost[k] = -1;
        continue;
      }
      const ei = Math.max(0, elevation[i]);
      const ej = Math.max(0, elevation[j]);
      const slope = Math.abs(ej - ei) / (l * KM_PER_UNIT); // 米 / 公里
      const sr = slope / SLOPE_REF;
      let f = Math.min(SLOPE_MAX, 1 + sr * sr);
      f *= 1 + (ei + ej) / 2 / ELEV_REF;
      f *= (BIOME_ROAD[biome[i]] + BIOME_ROAD[biome[j]]) / 2;
      const ri = riverSize[i];
      const rj = riverSize[j];
      if (ri > 0 && rj > 0) f *= RIVER_ALONG;
      else if (ri > 0 || rj > 0) f += RIVER_CROSS * (ri + rj);
      landCost[k] = l * f;
    }
  }

  // ---- 城 ----
  /** 地块上的城从哪年起有(够格修路那年;没有城 = Infinity):修路时只把那时已经有的城当城 */
  const cityFrom = new Float64Array(n).fill(Infinity);
  for (const c of cities) cityFrom[c.cell] = Math.min(cityFrom[c.cell], c.founded);
  /** 陆地连通块(可走的陆地),给航线判断"同一片陆地" */
  const comp = new Int32Array(n).fill(-1);
  {
    const q = new Int32Array(n);
    let id = 0;
    for (let s = 0; s < n; s++) {
      if (!pass[s] || comp[s] >= 0) continue;
      let qt = 0;
      q[qt++] = s;
      comp[s] = id;
      for (let qh = 0; qh < qt; qh++) {
        const i = q[qh];
        for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
          const j = adj[k];
          if (pass[j] && comp[j] < 0) {
            comp[j] = id;
            q[qt++] = j;
          }
        }
      }
      id++;
    }
  }

  // ---- 寻路 ----
  const F = new Finder(n);
  /** 地块上已有路(大路、小路都算) / 已有航线 */
  const onRoad = new Uint8Array(n);
  const onSea = new Uint8Array(n);

  /** 陆路 A*(year 那年修):返回地块序列(起点 → 终点),走不通返回 null。reuse = false:不看已有的路(只比地形) */
  const findLand = (start: number, goal: number, year: Year, reuse = true): number[] | null => {
    const { g, prev, seen, done, heap } = F;
    const st = ++F.stamp;
    const hf = reuse ? REUSE : 1;
    seen[start] = st;
    g[start] = 0;
    prev[start] = -1;
    heap.size = 0;
    heap.push(start, hf * heuristic(start, goal));
    while (heap.size) {
      const i = heap.pop();
      if (done[i] === st) continue;
      done[i] = st;
      if (i === goal) break;
      const gi = g[i];
      const ri = reuse && onRoad[i];
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        let c = landCost[k];
        if (c < 0) continue;
        const j = adj[k];
        if (done[j] === st) continue;
        if (ri && onRoad[j]) c *= REUSE;
        if (!(cityFrom[j] <= year)) c *= NO_CITY;
        const ng = gi + c;
        if (seen[j] !== st || ng < g[j]) {
          seen[j] = st;
          g[j] = ng;
          prev[j] = i;
          heap.push(j, ng + hf * heuristic(j, goal));
        }
      }
    }
    if (done[goal] !== st) return null;
    const path: number[] = [];
    for (let i = goal; i >= 0; i = prev[i]) path.push(i);
    return path.reverse();
  };

  /** 航线 A*:从港口出海,只走开阔海面,最后靠进终点港口 */
  const findSea = (start: number, goal: number): number[] | null => {
    const { g, prev, seen, done, heap } = F;
    const st = ++F.stamp;
    seen[start] = st;
    g[start] = 0;
    prev[start] = -1;
    heap.size = 0;
    heap.push(start, REUSE * heuristic(start, goal));
    while (heap.size) {
      const i = heap.pop();
      if (done[i] === st) continue;
      done[i] = st;
      if (i === goal) break;
      const gi = g[i];
      const si = onSea[i];
      const fromSea = seaOk[i] === 1;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        if (done[j] === st) continue;
        let c: number;
        if (j === goal) {
          if (!fromSea) continue;
          c = len[k];
        } else {
          c = seaCost[k];
          if (c < 0) continue;
        }
        if (si && onSea[j]) c *= REUSE;
        const ng = gi + c;
        if (seen[j] !== st || ng < g[j]) {
          seen[j] = st;
          g[j] = ng;
          prev[j] = i;
          heap.push(j, ng + REUSE * heuristic(j, goal));
        }
      }
    }
    if (done[goal] !== st) return null;
    const path: number[] = [];
    for (let i = goal; i >= 0; i = prev[i]) path.push(i);
    return path.reverse();
  };

  interface Piece {
    kind: Route['kind'];
    cells: number[];
    built: Year;
    /**
     * 每一步(邻接槽位,两个方向都记)画到哪一年为止:用它的连线里最晚结束的那一年(两端都还在 = Infinity);
     * 小路被大路升级的 = 升级那年(之后由大路接着画)
     */
    stop: Map<number, Year>;
  }
  const pieces: Piece[] = [];
  /** 邻接槽位上最近一次修的路段(pieces 的下标;−1 = 没修过):陆路、航线各一份 */
  const roadOwner = new Int32Array(adj.length).fill(-1);
  const seaOwner = new Int32Array(adj.length).fill(-1);
  /** 邻接槽位 k 上 t 那年还在用的路段(停用了 / 没修过 = undefined) */
  const liveAt = (own: Int32Array, k: number, t: Year): Piece | undefined => {
    const o = own[k];
    return o >= 0 && pieces[o].stop.get(k)! > t ? pieces[o] : undefined;
  };

  // ---- 冗余的平行小路 ----
  const dist = new Float64Array(n);
  const prevOf = new Int32Array(n);
  const seenAt = new Int32Array(n);
  const near = new Int32Array(n);
  let stamp = 0;
  const pheap = new MinHeap(256);
  /**
   * 一段新修的小路(cells,中间没有城、不碰已有的路):两端之间沿那时还在用的路有没有另一条不超过 PARALLEL_RATIO 倍长、
   * 而且处处紧挨着它(它的每一块都在那条路上或和那条路相邻)的路。有就不修,车马改走那条路:那条路至少用到 end 那年
   */
  const parallel = (cells: number[], built: Year, end: Year): boolean => {
    let length = 0;
    for (let t = 1; t < cells.length; t++) length += len[slotOf(mesh, cells[t - 1], cells[t])];
    const u = cells[0];
    const v = cells[cells.length - 1];
    if (u === v) return false;
    const limit = PARALLEL_RATIO * length;
    const st = ++stamp;
    seenAt[u] = st;
    dist[u] = 0;
    prevOf[u] = -1;
    pheap.size = 0;
    pheap.push(u, 0);
    let found = false;
    while (pheap.size) {
      const i = pheap.pop();
      const d = pheap.lastPri;
      if (d > dist[i]) continue;
      if (i === v) {
        found = true;
        break;
      }
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        if (!liveAt(roadOwner, k, built)) continue;
        const j = adj[k];
        const nd = d + len[k];
        if (nd > limit) continue;
        if (seenAt[j] !== st || nd < dist[j]) {
          seenAt[j] = st;
          dist[j] = nd;
          prevOf[j] = i;
          pheap.push(j, nd);
        }
      }
    }
    if (!found) return false;
    for (let i = v; i >= 0; i = prevOf[i]) {
      near[i] = st;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) near[adj[k]] = st;
    }
    for (let t = 1; t < cells.length - 1; t++) if (near[cells[t]] !== st) return false;
    for (let i = v; prevOf[i] >= 0; i = prevOf[i]) {
      const k = slotOf(mesh, prevOf[i], i);
      const back = slotOf(mesh, i, prevOf[i]);
      const p = liveAt(roadOwner, k, built)!;
      if (end > p.stop.get(k)!) p.stop.set(k, end).set(back, end);
    }
    return true;
  };

  /**
   * 把一条路径记进路网(built 那年修,用到 end 那年):和那时还在用的路段重合的部分并进去(那几步至少用到 end),
   * 剩下的每一段新路成为一条 Route。早先修过、到 built 已经停用的路段从 built 起重新开一段(停用的那段照旧停在停用那年)。
   * 大路走到还在用的小路上,那一段从这一年起"升级"成大路(小路那年停用,大路接着画),
   * 所以国都之间的大路是一整条,回放时先有小路、立都之后才变成大路。
   * 小路新修的那几段在城、岔口处断开,紧挨着一条那时已经有的路、长度差不多的不修(见 parallel)。
   * 只看那时已经有的路:后来修的路不改早先修的路
   */
  const lay = (path: number[], kind: Route['kind'], built: Year, end: Year) => {
    const own = kind === 'sea' ? seaOwner : roadOwner;
    const cellsOn = kind === 'sea' ? onSea : onRoad;
    const T = path.length - 1;
    const ks = new Int32Array(T);
    const backs = new Int32Array(T);
    /** 每一步:0 = 新修(或重新开),1 = 并进还在用的路,2 = 大路升级还在用的小路,3 = 冗余的平行小路,不修 */
    const how = new Uint8Array(T);
    for (let t = 0; t < T; t++) {
      ks[t] = slotOf(mesh, path[t], path[t + 1]);
      backs[t] = slotOf(mesh, path[t + 1], path[t]);
      const o = liveAt(own, ks[t], built);
      how[t] = !o ? 0 : kind === 'road' && o.kind === 'trail' ? 2 : 1;
    }
    if (kind === 'trail') {
      for (let t = 0; t < T; ) {
        if (how[t] !== 0) {
          t++;
          continue;
        }
        let u = t + 1;
        while (u < T && how[u] === 0 && !(cityFrom[path[u]] <= built) && !onRoad[path[u]]) u++;
        if (u - t >= 2 && parallel(path.slice(t, u + 1), built, end)) how.fill(3, t, u);
        t = u;
      }
    }
    let cur: Piece | null = null;
    let at = -1;
    for (let t = 0; t < T; t++) {
      const k = ks[t];
      const back = backs[t];
      if (how[t] === 3) {
        cur = null;
        continue;
      }
      if (how[t] === 1) {
        const o = pieces[own[k]];
        if (end > o.stop.get(k)!) o.stop.set(k, end).set(back, end);
        cur = null;
        continue;
      }
      let stop = end;
      if (how[t] === 2) {
        const o = pieces[own[k]];
        stop = Math.max(end, o.stop.get(k)!);
        o.stop.set(k, built).set(back, built);
      }
      if (!cur) {
        cur = { kind, cells: [path[t]], built, stop: new Map() };
        at = pieces.push(cur) - 1;
      }
      cur.cells.push(path[t + 1]);
      cur.stop.set(k, stop).set(back, stop);
      own[k] = own[back] = at;
      cellsOn[path[t]] = cellsOn[path[t + 1]] = 1;
    }
  };

  // ---- 定连哪些城 ----
  const all = cities.map((_, i) => i).filter((c) => pass[cities[c].cell]);
  const cellOf = (c: number) => cities[c].cell;
  const livesOf = (c: number): readonly (readonly [Year, Year])[] => cities[c].lives ?? [[cities[c].founded, cities[c].ended ?? Infinity]];
  const majorOf = (c: number) => Math.max(cities[c].founded, cities[c].majorFrom ?? cities[c].founded);
  const portOf = (c: number) => Math.max(cities[c].founded, cities[c].portFrom ?? cities[c].founded);
  /** a–b 两端的城都在、又不早于 from 的年份段:每段修一次(一端毁了那年荒废,原址重建以后重新通路) */
  const spans = (a: number, b: number, from: Year): [Year, Year][] => {
    const out: [Year, Year][] = [];
    for (const [sa, ea] of livesOf(a)) {
      for (const [sb, eb] of livesOf(b)) {
        const s = Math.max(sa, sb, from);
        const e = Math.min(ea, eb);
        if (s < e) out.push([s, e]);
      }
    }
    return out;
  };
  /** 一组城按够格的年份(at)一批批加进邻城图(GrowingGraph):新城和别的城的连线,t = 连上的那年 */
  const alive = (c: number, t: Year) => livesOf(c).some(([s, e]) => s <= t && t < e);
  const linksOf = (ids: number[], at: (c: number) => Year, cost: Float32Array, maxD?: number): TimedLink[] => {
    const graph = new GrowingGraph(mesh, cost, alive, maxD);
    const order = ids.filter((c) => at(c) < Infinity).sort((x, y) => at(x) - at(y) || x - y);
    const out: TimedLink[] = [];
    for (let i = 0; i < order.length; ) {
      const t = at(order[i]);
      let j = i;
      while (j < order.length && at(order[j]) === t) j++;
      for (const e of graph.add(order.slice(i, j), cellOf, t)) out.push({ ...e, t });
      i = j;
    }
    return out;
  };

  // ---- 陆路:大城之间的大路 + 所有城之间的小路 ----
  // 修路顺序:先按修建年份,同年先大路后小路,再先近后远 —— 局部路网先成形,远的连线、后来的路再并进去
  interface Job {
    a: number;
    b: number;
    w: number;
    kind: 'road' | 'trail';
    built: Year;
    end: Year;
  }
  const roadLinks = linksOf(
    all.filter((c) => cities[c].major),
    majorOf,
    landCost,
  );
  const trailLinks = linksOf(all, (c) => cities[c].founded, landCost);
  const jobs: Job[] = [];
  const addJobs = (a: number, b: number, w: number, kind: Job['kind'], from: Year) => {
    for (const [built, end] of spans(a, b, from)) jobs.push({ a, b, w, kind, built, end });
  };
  for (const e of roadLinks) addJobs(e.a, e.b, e.w, 'road', e.t);
  for (const e of trailLinks) addJobs(e.a, e.b, e.w, 'trail', e.t);
  for (const e of bypassLinks([...roadLinks, ...trailLinks], livesOf)) addJobs(e.a, e.b, e.w, 'trail', e.t);
  const tier = { road: 0, trail: 1 } as const;
  jobs.sort((p, q) => p.built - q.built || tier[p.kind] - tier[q.kind] || p.w - q.w || p.a - q.a || p.b - q.b);
  for (let t = 0; t < jobs.length; t++) {
    const e = jobs[t];
    const path = findLand(cities[e.a].cell, cities[e.b].cell, e.built);
    if (path) lay(path, e.kind, e.built, e.end);
    if (t === jobs.length >> 1) progress('道路', 0.88);
  }

  // ---- 航线 ----
  progress('航线', 0.9);
  const ports = all.filter((c) => cities[c].port);
  // 港口之间的航线 + 推演里走过的航线(出海口之间,opts.lanes):一起按修建年份修,早修的先占海面,后修的重合的那几段并进去
  interface SeaJob {
    ca: number;
    cb: number;
    built: Year;
    end: Year;
    /** 港口之间的连线:海路代价(同一片陆地上要和陆路比);走过的航线 = −1(一定画) */
    w: number;
  }
  const seaJobs: SeaJob[] = [];
  for (const e of linksOf(ports, portOf, seaCost, SEA_MAX_STEPS * step)) {
    for (const [built, end] of spans(e.a, e.b, e.t)) seaJobs.push({ ca: cities[e.a].cell, cb: cities[e.b].cell, built, end, w: e.w });
  }
  /** 走过的航线:从 from 起、两头登岸处都不是故址(opts.ruins)的年份段 */
  const landed = (a: number, b: number, from: Year): [Year, Year][] => {
    const gaps = [...(opts.ruins?.get(a) ?? []), ...(opts.ruins?.get(b) ?? [])].sort((p, q) => p[0] - q[0]);
    const out: [Year, Year][] = [];
    let s = from;
    for (const [g0, g1] of gaps) {
      if (g0 > s) out.push([s, g0]);
      s = Math.max(s, g1);
    }
    if (s < Infinity) out.push([s, Infinity]);
    return out;
  };
  for (const e of opts.lanes ?? []) {
    if (e.a !== e.b) for (const [built, end] of landed(e.a, e.b, e.built)) seaJobs.push({ ca: e.a, cb: e.b, built, end, w: -1 });
  }
  seaJobs.sort((p, q) => p.built - q.built || (p.w < 0 ? 1 : 0) - (q.w < 0 ? 1 : 0) || p.w - q.w || p.ca - q.ca || p.cb - q.cb);
  /** 走过的航线隔着故址断成几段的:后几段照第一段的路走(不重新寻路,别的航线也就不跟着挪) */
  const lanePaths = new Map<number, number[] | null>();
  for (const e of seaJobs) {
    const { ca, cb } = e;
    if (e.w >= 0 && comp[ca] === comp[cb]) {
      // 同一片陆地:陆路本来就连着。海路要比陆路近得多才开
      // (只比地形,不看已有的路:后来修的路不改早先开的航线)
      const land = findLand(ca, cb, e.built, false);
      if (land) {
        let lc = 0;
        for (let t = 1; t < land.length; t++) lc += landCost[slotOf(mesh, land[t - 1], land[t])];
        if (lc <= SEA_VS_LAND * e.w) continue;
      }
    }
    let path: number[] | null;
    if (e.w < 0) {
      const key = ca * mesh.n + cb;
      path = lanePaths.has(key) ? lanePaths.get(key)! : findSea(ca, cb);
      lanePaths.set(key, path);
    } else path = findSea(ca, cb);
    if (path) lay(path, 'sea', e.built, e.end);
  }

  const out: Route[] = [];
  for (const p of pieces) {
    if (p.cells.length < 2) continue;
    // 按"停用年份"切段:小路升级过的那几段到升级那年为止(之后由大路接着画);
    // 通往废城的那几段到城被毁那年为止(阶段 3 城市兴衰)。修好当年就停用的不留
    let run: number[] = [p.cells[0]];
    let runU = NaN;
    const flush = () => {
      if (run.length >= 2 && runU > p.built) {
        const r: Route = { kind: p.kind, cells: Int32Array.from(run), built: p.built };
        if (runU < Infinity) r.abandoned = runU;
        out.push(r);
      }
    };
    for (let t = 1; t < p.cells.length; t++) {
      const u = p.stop.get(slotOf(mesh, p.cells[t - 1], p.cells[t]))!;
      if (t > 1 && u !== runU) {
        flush();
        run = [p.cells[t - 1]];
      }
      runU = u;
      run.push(p.cells[t]);
    }
    flush();
  }
  const order = { road: 0, trail: 1, sea: 2 } as const;
  out.sort((a, b) => order[a.kind] - order[b.kind]);
  return out;
}

/**
 * 推演里走过的海峡、航线:州图上的海峡(AdjKind.Strait)、航线(AdjKind.SeaRoute)两头的州,哪一年起归了同一个国家、
 * 或同一个海洋民族(民族迁徙只看海洋民族:别的民族过海峡也是当陆路走)。跨海扩张、隔海攻占,分裂、合并、复国以后隔海的两块国土,
 * 都有这样一条连着 —— 按它补画航线(buildRoutes 的 lanes),画出来的就包括推演里走过的(两头偶然同属一家、其实没走过的也画,宁多不少)。
 * from = 这一段地形从哪年起(地形大事以后州图变了):那一刻已经同属一家的记 from,之前的不看。
 * 返回两头的海岸地块(Regions.adjCoast),按州号 (a, b) 升序
 */
export function usedLanes(regions: Regions, log: ChangeLog, cultures: readonly Culture[], from = -Infinity): UsedLane[] {
  const R = regions.count;
  const { adjStart, adj, adjKind, adjCoast } = regions;
  const own = [new Int16Array(R).fill(-1), new Int16Array(R).fill(-1)];
  /** 州对 → [年份, 这一侧的海岸, 那一侧的海岸] */
  const first = new Map<number, [Year, number, number]>();
  /** 州 r 隔海的另一头和它同属一家(layer 这一层的 v)的,记下年份 y */
  const mark = (r: number, layer: number, v: number, y: Year) => {
    if (v < 0 || (layer === Layer.Culture && cultures[v]?.kind !== 'sea')) return;
    const o = own[layer];
    for (let k = adjStart[r]; k < adjStart[r + 1]; k++) {
      if (adjKind[k] !== AdjKind.SeaRoute && adjKind[k] !== AdjKind.Strait) continue;
      const j = adj[k];
      if (o[j] !== v) continue;
      const key = Math.min(r, j) * R + Math.max(r, j);
      if (first.has(key)) continue;
      let back = -1;
      for (let q = adjStart[j]; q < adjStart[j + 1] && back < 0; q++) if (adj[q] === r) back = q;
      first.set(key, r < j ? [y, adjCoast[k], adjCoast[back]] : [y, adjCoast[back], adjCoast[k]]);
    }
  };
  let swept = false;
  /** 过了 from 那一刻:那时同属一家的都记上(from 那一刻的归属变化先都算进去,地形大事清掉、改划的州不算) */
  const sweep = () => {
    swept = true;
    for (let r = 0; r < R; r++) for (let layer = 0; layer < 2; layer++) mark(r, layer, own[layer][r], from);
  };
  for (let i = 0; i < log.size; i++) {
    const y = log.year[i];
    if (!swept && y > from) sweep();
    const r = log.region[i];
    if (r >= R) continue;
    const layer = log.layer[i];
    const v = log.value[i];
    own[layer][r] = v;
    if (swept) mark(r, layer, v, y);
  }
  if (!swept) sweep();
  return [...first]
    .sort((p, q) => p[0] - q[0])
    .filter(([, [, a, b]]) => a >= 0 && b >= 0)
    .map(([, [built, a, b]]) => ({ a, b, built }));
}

/** 新城和别的城:沿已经连上的城绕过去不超过这个倍数远,就不另连一条 */
const DETOUR = 1.6;

/** 邻城图里的一条连线,t = 连上的那年(两端里较晚够格的那座加进图的那年) */
interface TimedLink extends Link {
  t: Year;
}

/**
 * 按年份一批批加城的邻城图(neighborGraph + urquhart 的增量版)。先加的城的势力范围只会被后加的城切走,
 * 所以新的"邻城"只出现在新城和别的城之间:每加一批,只从新城洇染、只看新城势力范围的边上。
 * 三角(三城两两连过)里删掉代价最大的那条也只删新连线(早先连上的路已经修了)。
 * 结果只取决于到那一年为止加进来的城 —— 推演推得再远,早先的连线不变
 */
class GrowingGraph {
  private readonly d: Float64Array;
  private readonly lab: Int32Array;
  private readonly heap = new MinHeap(1024);
  /** 连过的邻城(含三角里删掉的):城 → (邻城 → 边权) */
  private readonly nb = new Map<number, Map<number, number>>();
  constructor(
    private readonly mesh: World['mesh'],
    private readonly cost: Float32Array,
    /** 城 c 在 t 年在世吗(绕路只走那年还在的城) */
    private readonly alive: (c: number, t: Year) => boolean,
    private readonly maxD = Infinity,
  ) {
    this.d = new Float64Array(mesh.n).fill(Infinity);
    this.lab = new Int32Array(mesh.n).fill(-1);
  }

  /** t 年加一批城(ids = 城的编号),返回留下的新连线(a < b) */
  add(ids: readonly number[], cellOf: (c: number) => number, t: Year): Link[] {
    const { mesh, d, lab, heap, cost, maxD } = this;
    const { adjStart, adj } = mesh;
    const got: number[] = [];
    heap.size = 0;
    for (const c of ids) {
      const s = cellOf(c);
      d[s] = 0;
      lab[s] = c;
      heap.push(s, 0);
      got.push(s);
    }
    while (heap.size) {
      const i = heap.pop();
      const di = heap.lastPri;
      if (di > d[i]) continue;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const c = cost[k];
        if (c < 0) continue;
        const j = adj[k];
        const nd = di + c;
        if (nd < d[j] && nd <= maxD) {
          d[j] = nd;
          lab[j] = lab[i];
          heap.push(j, nd);
          got.push(j);
        }
      }
    }
    // 新城势力范围的边上:两边到交界的代价之和(两个方向取小)
    const best = new Map<number, Link>();
    const key = (a: number, b: number) => a * 0x100000 + b;
    for (const i of got) {
      const li = lab[i];
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        const lj = lab[j];
        if (lj < 0 || lj === li) continue;
        let w = cost[k] >= 0 ? d[i] + cost[k] + d[j] : Infinity;
        const back = slotOf(mesh, j, i);
        if (cost[back] >= 0) w = Math.min(w, d[j] + cost[back] + d[i]);
        if (!(w <= maxD)) continue;
        const a = Math.min(li, lj);
        const b = Math.max(li, lj);
        const cur = best.get(key(a, b));
        if (!cur || w < cur.w) best.set(key(a, b), { a, b, w });
      }
    }
    const fresh = [...best.values()].sort((x, y) => x.a - y.a || x.b - y.b);
    const nbOf = (c: number) => {
      let m = this.nb.get(c);
      if (!m) this.nb.set(c, (m = new Map()));
      return m;
    };
    for (const e of fresh) {
      nbOf(e.a).set(e.b, e.w);
      nbOf(e.b).set(e.a, e.w);
    }
    const longer = (x: Link, y: Link) => x.w > y.w || (x.w === y.w && (x.a > y.a || (x.a === y.a && x.b > y.b)));
    const kept = fresh.filter((e) => {
      const nbB = nbOf(e.b);
      for (const [c, wac] of nbOf(e.a)) {
        if (c === e.b) continue;
        const wbc = nbB.get(c);
        if (wbc === undefined) continue;
        const ac = { a: Math.min(e.a, c), b: Math.max(e.a, c), w: wac };
        const bc = { a: Math.min(e.b, c), b: Math.max(e.b, c), w: wbc };
        if (longer(e, ac) && longer(e, bc)) return false;
      }
      return true;
    });
    const keep = (e: Link) => {
      for (const [x, y] of [
        [e.a, e.b],
        [e.b, e.a],
      ]) {
        let m = this.links.get(x);
        if (!m) this.links.set(x, (m = []));
        m.push([y, e.w]);
      }
    };
    // 由近到远:两城沿已经留下的连线、经那年还在的城绕过去不超过 DETOUR 倍远的,不再连(早先连上的路还在,新城不必条条都连)
    kept.sort((x, y) => x.w - y.w || x.a - y.a || x.b - y.b);
    const out = kept.filter((e) => {
      if (this.reach(e.a, e.b, DETOUR * e.w, t)) return false;
      keep(e);
      return true;
    });
    // 留下的连线连的全是那年已毁的城(三角里删掉的正是连活城的那条,或者四周只剩废城):
    // 补一条连那年还在的城 —— 邻城里最近的一座,邻城全废了就穿过废城的地盘找最近的一座;不然新城孤零零地不通路
    for (const c of ids) {
      if ((this.links.get(c) ?? []).some(([o]) => this.alive(o, t))) continue;
      let e: Link | null = null;
      for (const [o, w] of this.nb.get(c) ?? []) {
        if (!this.alive(o, t)) continue;
        const x = { a: Math.min(c, o), b: Math.max(c, o), w };
        if (!e || longer(e, x)) e = x;
      }
      e ??= this.nearestAlive(c, cellOf(c), t);
      if (!e) continue;
      nbOf(e.a).set(e.b, e.w);
      nbOf(e.b).set(e.a, e.w);
      keep(e);
      out.push(e);
    }
    return out;
  }

  /** 从城 c(地块 s)往外洇染、不管势力范围,碰到的第一块 t 年还在的城的地盘:连那座城(边权 = 两边到交界的代价之和);碰不到 = null */
  private nearestAlive(c: number, s: number, t: Year): Link | null {
    const { mesh, cost, lab, maxD } = this;
    const { adjStart, adj } = mesh;
    const dist = new Map<number, number>([[s, 0]]);
    const heap = new MinHeap(256);
    heap.push(s, 0);
    while (heap.size) {
      const i = heap.pop();
      const di = heap.lastPri;
      if (di > dist.get(i)!) continue;
      const li = lab[i];
      if (li >= 0 && li !== c && this.alive(li, t)) {
        const w = di + this.d[i];
        return w <= maxD ? { a: Math.min(c, li), b: Math.max(c, li), w } : null;
      }
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const ck = cost[k];
        if (ck < 0) continue;
        const j = adj[k];
        const nd = di + ck;
        if (nd > maxD || nd >= (dist.get(j) ?? Infinity)) continue;
        dist.set(j, nd);
        heap.push(j, nd);
      }
    }
    return null;
  }

  /** 留下的连线:城 → [邻城, 边权] */
  private readonly links = new Map<number, [number, number][]>();
  private readonly cityHeap = new MinHeap(64);
  /** t 年沿留下的连线、只经过那年还在的城,从 a 走到 b,路程不超过 limit 吗 */
  private reach(a: number, b: number, limit: number, t: Year): boolean {
    const dist = new Map<number, number>([[a, 0]]);
    const heap = this.cityHeap;
    heap.size = 0;
    heap.push(a, 0);
    while (heap.size) {
      const i = heap.pop();
      const d = heap.lastPri;
      if (d > dist.get(i)!) continue;
      if (i === b) return true;
      for (const [j, w] of this.links.get(i) ?? []) {
        const nd = d + w;
        if (nd > limit || nd >= (dist.get(j) ?? Infinity) || (j !== b && !this.alive(j, t))) continue;
        dist.set(j, nd);
        heap.push(j, nd);
      }
    }
    return false;
  }
}

/** 废城邻城之间的绕行连线:一座废城的邻城不超过这么多座时两两相连,多了后来的每座连代价最接近的两座 */
const BYPASS_ALL = 4;

/**
 * 废城的绕行连线(阶段 3 城市兴衰):城被毁时(在世的一段结束),它在陆路连线图里的邻城两两之间另加一条小路连线,
 * 从城被毁那年起、代价 = 两段之和(寻路时几乎全走经过废城的原路,这些路段因此"还有人用",不随废城荒废)。
 * 邻城那时已经被毁、之后也没重建的不连;废城毁了以后才长起来(或重建)的邻城从它够格那年起也算:
 * 不然它的邻城全是废城时,它就孤零零地不通路。
 * 邻城按能连的先后排:前 BYPASS_ALL 座两两相连,之后的每座连先前的邻城里代价最接近的两座 —— 只看先前的,推得更远也不改早先的连线
 */
function bypassLinks(links: readonly TimedLink[], livesOf: (c: number) => readonly (readonly [Year, Year])[]): TimedLink[] {
  /** 城 → (邻城 → 最早的连线) */
  const nb = new Map<number, Map<number, TimedLink>>();
  const add = (c: number, o: number, e: TimedLink) => {
    let m = nb.get(c);
    if (!m) nb.set(c, (m = new Map()));
    const old = m.get(o);
    if (!old || e.t < old.t || (e.t === old.t && e.w < old.w)) m.set(o, e);
  };
  for (const e of links) {
    add(e.a, e.b, e);
    add(e.b, e.a, e);
  }
  /** 两座邻城之间的绕行连线:几座废城都连到它们的,取最早能连的那条 */
  const best = new Map<number, TimedLink>();
  for (const c of nb.keys()) {
    for (const [, end] of livesOf(c)) {
      if (!(end < Infinity)) continue;
      // 每座邻城从哪年起能连:城被毁、连线连上、邻城(重建后)够格,三者里晚的那个
      const spokes: { o: number; e: TimedLink; t: Year }[] = [];
      for (const [o, e] of nb.get(c)!) {
        const life = livesOf(o).find(([, x]) => x > end);
        if (life) spokes.push({ o, e, t: Math.max(end, e.t, life[0]) });
      }
      spokes.sort((x, y) => x.t - y.t || x.e.w - y.e.w || x.o - y.o);
      for (let i = 1; i < spokes.length; i++) {
        let mates = spokes.slice(0, i);
        if (i >= BYPASS_ALL) {
          const wi = spokes[i].e.w;
          mates = mates
            .map((s, j) => ({ s, j, d: Math.abs(s.e.w - wi) }))
            .sort((x, y) => x.d - y.d || x.j - y.j)
            .slice(0, 2)
            .map((x) => x.s);
        }
        for (const m of mates) {
          const s = spokes[i];
          const a = Math.min(m.o, s.o);
          const b = Math.max(m.o, s.o);
          const key = a * 0x100000 + b;
          const w = m.e.w + s.e.w;
          const old = best.get(key);
          if (!old || s.t < old.t || (s.t === old.t && w < old.w)) best.set(key, { a, b, w, t: s.t });
        }
      }
    }
  }
  return [...best.values()].sort((x, y) => x.a - y.a || x.b - y.b);
}

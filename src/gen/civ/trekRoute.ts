/**
 * 大迁徙怎么找路(migration.ts 推演时用;界面上下令时估那条虚线也用同一套,ui/trekInfo.ts):
 * 只走陆路(平地、跨河、翻山,不过海),按走的年数最短 —— 草原荒漠快,林地、湿地慢,高山再慢,翻山另加。
 * 纯计算,不碰 DOM;只引地形的表,不引推演引擎(界面上用不着把推演打包进来)。
 */
import { biomeColumn } from '../biomes';
import { MinHeap } from '../util';
import { AdjKind, type Regions } from './types';

/** 作者下令的大迁徙走不成(史事 intervene 的 b 列):陆路走不到指定的那一州 / 推演挑没有可去的地方 */
export const IV_NO_WAY = -18;

/** 走一州要几年(× 地形,推演里再 ± 一点随机) */
export const STEP_YEARS = 1;
/** 走一州的地形系数:草原荒漠快,林地、湿地慢(见地貌表的 trekPace) */
const PACE = biomeColumn('trekPace');
/** 高山(海拔超过这么多)再慢 HIGH_PACE 倍;翻山再加 CLIMB 年 */
const HIGH_ELEV = 1500;
const HIGH_PACE = 1.5;
const CLIMB = 0.8;

/** 这种边走得过(陆路:平地、跨河、翻山) */
export const trekLand = (kind: number) => kind === AdjKind.Flat || kind === AdjKind.River || kind === AdjKind.Mountain;

/** 走进州 j(从邻州过界,边的种类 kind)要几年(不含随机) */
export function trekPace(reg: Pick<Regions, 'biome' | 'elevation'>, j: number, kind: number): number {
  return STEP_YEARS * (PACE[reg.biome[j]] ?? 1) * (reg.elevation[j] > HIGH_ELEV ? HIGH_PACE : 1) + (kind === AdjKind.Mountain ? CLIMB : 0);
}

/** 找路用的几张表:到每一州要几年、几州远、从哪一州走进来(−1 = 起点 / 走不到) */
export interface TrekPaths {
  dist: Float64Array;
  hops: Int32Array;
  from: Int32Array;
  done: Uint8Array;
  heap: MinHeap;
}

export function trekPaths(R: number): TrekPaths {
  return { dist: new Float64Array(R), hops: new Int32Array(R), from: new Int32Array(R), done: new Uint8Array(R), heap: new MinHeap(256) };
}

type RouteRegions = Pick<Regions, 'adjStart' | 'adj' | 'adjKind' | 'seat' | 'biome' | 'elevation'>;

/**
 * 从民族 c 往外找路,最多 maxHops 州远,填好 P:
 *   start < 0 = 从本族各州一起往外(本族的州是起点,不再走进去;推演自己起的大迁徙这样找,从离目的地最近的本族那州出发);
 *   start ≥ 0 = 只从那一州出发(作者下令从这州走),本族的州也走得过。
 * 一样快的两条路挑治所地块号小的那一边走进来(和处理顺序无关)。culture = 此刻各州的民族;R = 州数
 */
export function searchTrek(reg: RouteRegions, R: number, culture: ArrayLike<number>, c: number, start: number, maxHops: number, P: TrekPaths): void {
  const { dist, hops, from, done, heap } = P;
  dist.fill(Infinity);
  hops.fill(-1);
  from.fill(-1);
  done.fill(0);
  heap.size = 0;
  if (start >= 0) {
    if (start < R) {
      dist[start] = 0;
      hops[start] = 0;
      heap.push(start, 0);
    }
  } else {
    for (let r = 0; r < R; r++) {
      if (culture[r] !== c) continue;
      dist[r] = 0;
      hops[r] = 0;
      heap.push(r, 0);
    }
  }
  const own = start < 0;
  while (heap.size) {
    const r = heap.pop();
    if (done[r]) continue;
    done[r] = 1;
    if (hops[r] >= maxHops) continue;
    for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
      const j = reg.adj[e];
      const kind = reg.adjKind[e];
      if (j >= R || done[j] || !trekLand(kind) || (own && culture[j] === c)) continue;
      const d = dist[r] + trekPace(reg, j, kind);
      if (d < dist[j] || (d === dist[j] && reg.seat[r] < reg.seat[from[j]])) {
        dist[j] = d;
        hops[j] = hops[r] + 1;
        from[j] = r;
        heap.push(j, d);
      }
    }
  }
}

/** 找好路以后,走到 target 的那条路线(起点 … target);走不到 = 只有 target 一州 */
export function trekRouteTo(P: TrekPaths, target: number): number[] {
  const route: number[] = [];
  for (let r = target; r >= 0; r = P.from[r]) route.push(r);
  return route.reverse();
}

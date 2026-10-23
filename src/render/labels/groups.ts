/**
 * 族名、教名、时代名的摆法:一组(一族、一个教、一个时代)在地图上占的那几片,各自在最宽处排一行字 ——
 * 和国名同一套拟合(polity.ts:国土栅格 → 离界距离 → 最难到达点发放射线 → 字号从大往小试,横排或竖排)。区别是按「片」排:
 *
 *   片 = 国土栅格上属于同一组、上下左右连成一块的格子(隔着海、湖不算连着;东西相连的世界跨过左右边也算连着)。
 *   一组分成好几片时,州数最多的那片总写;别的片至少 minPiece 州才写(更碎的不写,悬停照样看得到)。
 *   哪几片在总览里写、哪几片放大才出来,由调用方按州数和字号定(render/civ/labels.ts)。
 *
 * 每州属于哪一组由调用方给(GroupSource:族 = 民族填色那份归属,教 = 信仰填色那份,时代 = 时代填色每 20 年取一次的那份)。
 * 纯计算(不碰画布),世界坐标(弯边投影下是地图平面坐标,planar)。同一份归属(stamp)、同一批名字只算一次。
 */
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { Civ } from '../../gen/civ/types';
import type { MapProj } from '../projection';
import { fitShape, maxNameCss, projectedTerritoryGrid, territoryField, territoryGrid, type OwnerGrid, type TerritoryField, type TerritoryGrid } from './polity';

/** 一片的名字摆法 */
export interface GroupLabel {
  /** 哪一组(族 / 教 / 时代的编号) */
  id: number;
  text: string;
  /** 路径(x,y,x,y…):直线,或拐角抹圆的两段 */
  path: number[];
  /** 字号(世界单位):地图按参照宽度显示、缩放 1 倍时正好铺满这一片 */
  size: number;
  vertical: boolean;
  /** 这一片的州数 */
  regions: number;
  /** 是不是这一组最大的那片 */
  main: boolean;
  /** 这一组最大那片的州数 */
  mainRegions: number;
  /** 路径是地图平面坐标(弯边投影下按投影后的形状拟合的) */
  planar?: boolean;
}

export interface GroupLabelOptions {
  /** 参照宽度(CSS 像素):字号按"地图这么宽、缩放 1 倍"来铺满这一片 */
  refCss: number;
  /** 除了最大那片,至少几州的片才写 */
  minPiece: number;
  /** 字号上限(CSS 像素):按州数(和国名一样 12–26)乘 scale(不给 = 1),再不超过 maxCss */
  scale?: number;
  maxCss?: number;
  /** 弯边投影:在投影后的栅格里拟合(见 polity.ts 的 PolityLabelOptions.proj) */
  proj?: MapProj;
}

/** 哪种名字:族名、教名、时代名 */
export type GroupKind = 'culture' | 'faith' | 'era';

/** 某一年每州属于哪一组 */
export interface GroupSource {
  kind: GroupKind;
  /** 归属从哪份数据来(核对用的栅格按它缓存:数据换了就重算) */
  data: object;
  /** 这一年的归属是第几版:同一种名字、同一份数据、同一个 stamp = 同一份归属,直接用上次的结果 */
  stamp: number;
  /** 每州属于哪一组(−1 = 没有)。只在调用当下读,可以是复用的数组 */
  of: () => Int16Array;
}

interface Cached {
  key: string;
  labels: GroupLabel[];
}
/**
 * 按 civ 存(名字跟着 civ:改了名的另算),每种名字、等距圆柱 / 弯边投影各一份
 * (弯边投影拖动时用世界坐标那一份,停下来用投影那一份,来回不互相冲掉;和国名一样)
 */
const cache = new WeakMap<Civ, Map<string, Cached>>();

/**
 * 某一年某种名字的全部摆法(每组的每一片)。nameOf 返回 null 的组不写(如民间信仰)。
 * 归属没变(stamp 相同)、名字没变(同一个 civ)时直接用上次的结果
 */
export function groupLabels(
  world: World,
  raster: Raster,
  civ: Civ,
  src: GroupSource,
  nameOf: (id: number) => string | null,
  opt: GroupLabelOptions,
): GroupLabel[] {
  const mp = opt.proj;
  const key = `${src.stamp}|${opt.refCss}|${opt.minPiece}|${opt.scale ?? 1}|${opt.maxCss ?? ''}|${raster.w}|${mp?.key ?? ''}`;
  let byKind = cache.get(civ);
  if (!byKind) cache.set(civ, (byKind = new Map()));
  const slot = `${src.kind}|${mp ? 'proj' : 'world'}`;
  const hit = byKind.get(slot);
  if (hit && hit.key === key) return hit.labels;
  const grid = mp ? projectedTerritoryGrid(world, raster, civ, mp) : territoryGrid(world, raster, civ);
  const field = territoryField(grid, src.of());
  const labels = fitPieces(field, civ.regions.count, nameOf, opt, mp ? mp.W : world.width);
  if (mp) for (const l of labels) l.planar = true;
  byKind.set(slot, { key, labels });
  return labels;
}

const ownerCache = new WeakMap<object, Map<GroupKind, { stamp: number; grid: TerritoryGrid; f: OwnerGrid }>>();

/** 某一年每格属于哪一组(世界坐标的栅格,不算离界距离):核对名字的每个字落没落在这一组当年的地盘上 */
export function groupOwnerGrid(world: World, raster: Raster, civ: Civ, src: GroupSource): OwnerGrid {
  const grid = territoryGrid(world, raster, civ);
  let byKind = ownerCache.get(src.data);
  if (!byKind) ownerCache.set(src.data, (byKind = new Map()));
  const hit = byKind.get(src.kind);
  if (hit && hit.stamp === src.stamp && hit.grid === grid) return hit.f;
  const of = src.of();
  const N = grid.gw * grid.gh;
  const owner = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    const r = grid.region[i];
    owner[i] = r >= 0 ? of[r] : -1;
  }
  const f = { grid, owner };
  byKind.set(src.kind, { stamp: src.stamp, grid, f });
  return f;
}

/** 一片:属于哪组、离界最远的格子、州数 */
interface Piece {
  id: number;
  deep: number;
  deepD: number;
  regions: number;
}

/** 栅格上连成一块的片(上下左右相邻;东西相连的栅格跨过左右边) */
export function pieces(field: TerritoryField, regionCount: number): Piece[] {
  const { gw, gh, wrap, region } = field.grid;
  const { owner, dist } = field;
  const N = gw * gh;
  const seen = new Uint8Array(N);
  // 每州最后记在哪一片(数一片里有几个不同的州)
  const stamp = new Int32Array(Math.max(1, regionCount)).fill(-1);
  const stack = new Int32Array(N);
  const out: Piece[] = [];
  for (let i0 = 0; i0 < N; i0++) {
    const o = owner[i0];
    if (o < 0 || seen[i0]) continue;
    const ci = out.length;
    const pc: Piece = { id: o, deep: i0, deepD: -1, regions: 0 };
    out.push(pc);
    seen[i0] = 1;
    let sp = 0;
    stack[sp++] = i0;
    while (sp) {
      const i = stack[--sp];
      if (dist[i] > pc.deepD) {
        pc.deepD = dist[i];
        pc.deep = i;
      }
      const r = region[i];
      if (r >= 0 && r < stamp.length && stamp[r] !== ci) {
        stamp[r] = ci;
        pc.regions++;
      }
      const x = i % gw;
      const y = (i - x) / gw;
      const up = y > 0 ? i - gw : -1;
      const dn = y < gh - 1 ? i + gw : -1;
      const lf = x > 0 ? i - 1 : wrap ? i + gw - 1 : -1;
      const rt = x < gw - 1 ? i + 1 : wrap ? i - gw + 1 : -1;
      if (up >= 0 && !seen[up] && owner[up] === o) (seen[up] = 1), (stack[sp++] = up);
      if (dn >= 0 && !seen[dn] && owner[dn] === o) (seen[dn] = 1), (stack[sp++] = dn);
      if (lf >= 0 && !seen[lf] && owner[lf] === o) (seen[lf] = 1), (stack[sp++] = lf);
      if (rt >= 0 && !seen[rt] && owner[rt] === o) (seen[rt] = 1), (stack[sp++] = rt);
    }
  }
  return out;
}

/** 字号阶梯的下限(CSS 像素):和国名一样,再小也照样拟合(放大地图后才放得下) */
const MIN_FIT_CSS = 5;

/** 按已算好的栅格给每组的每一片排名字(纯计算,测试直接调它) */
export function fitPieces(field: TerritoryField, regionCount: number, nameOf: (id: number) => string | null, opt: GroupLabelOptions, worldW: number): GroupLabel[] {
  const byId = new Map<number, Piece[]>();
  for (const pc of pieces(field, regionCount)) {
    let a = byId.get(pc.id);
    if (!a) byId.set(pc.id, (a = []));
    a.push(pc);
  }
  const worldPerCss = worldW / opt.refCss;
  const out: GroupLabel[] = [];
  // 按组的编号排(结果和 Map 的插入顺序无关)
  for (const id of [...byId.keys()].sort((a, b) => a - b)) {
    const text = nameOf(id);
    if (!text) continue;
    const n = [...text].length;
    const ps = byId.get(id)!.sort((a, b) => b.regions - a.regions || b.deepD - a.deepD || a.deep - b.deep);
    const mainRegions = ps[0].regions;
    ps.forEach((pc, i) => {
      if (i > 0 && pc.regions < opt.minPiece) return;
      const maxCss = Math.min(opt.maxCss ?? Infinity, maxNameCss(pc.regions) * (opt.scale ?? 1));
      const sizes: number[] = [];
      for (let c = maxCss; c >= MIN_FIT_CSS; c *= 0.92) sizes.push(c * worldPerCss);
      const f = fitShape(field, id, pc.deep, n, sizes, maxCss * worldPerCss * 14);
      if (!f) return;
      out.push({ id, text, path: f.path, size: f.size, vertical: f.vertical, regions: pc.regions, main: i === 0, mainRegions });
    });
  }
  return out;
}

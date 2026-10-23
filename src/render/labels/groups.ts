/**
 * 族名的摆法:一族在地图上住的那几片,各自在最宽处排一行字 —— 和国名同一套拟合(polity.ts:国土栅格 → 离界距离 →
 * 最难到达点发放射线 → 字号从大往小试,横排或竖排)。区别是按「片」排:
 *
 *   片 = 国土栅格上属于同一族、上下左右连成一块的格子(隔着海、湖不算连着;东西相连的世界跨过左右边也算连着)。
 *   一族分成好几片时,州数最多的那片总写;别的片至少 minPiece 州才写(1–3 州的碎片不写,悬停照样看得到)。
 *   哪几片在总览里写、哪几片放大才出来,由调用方按州数和字号定(render/civ/labels.ts)。
 *
 * 纯计算(不碰画布),世界坐标(弯边投影下是地图平面坐标,planar)。同一份归属(日志下标)、同一批名字只算一次。
 */
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { ChangeLog, Civ, Year } from '../../gen/civ/types';
import { logIndexAfter, ownersAt, type Owners } from '../../gen/civ/timeline';
import type { MapProj } from '../projection';
import { fitShape, maxNameCss, projectedTerritoryGrid, territoryField, territoryGrid, type OwnerGrid, type TerritoryField, type TerritoryGrid } from './polity';

/** 一片的名字摆法 */
export interface GroupLabel {
  /** 哪一组(族的编号) */
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
  /** 字号上限(CSS 像素);不给 = 按州数(和国名一样 12–26) */
  maxCss?: number;
  /** 弯边投影:在投影后的栅格里拟合(见 polity.ts 的 PolityLabelOptions.proj) */
  proj?: MapProj;
}

/** 哪种名字:现在只有族名(以后的教名、时代名也走这里) */
export type GroupKind = 'culture';

let ownScratch: Owners | undefined;

/** 某一年每州属于哪一组(−1 = 没有)。族:和民族填色同一份归属(ownersAt) */
function groupsAt(kind: GroupKind, civ: Civ, year: Year): Int16Array {
  switch (kind) {
    case 'culture':
      ownScratch = ownersAt(civ, year, ownScratch);
      return ownScratch.culture;
  }
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
 * 某一年某种名字的全部摆法(每组的每一片)。nameOf 返回 null 的组不写。
 * 归属没变(日志下标相同)、名字没变(同一个 civ)时直接用上次的结果
 */
export function groupLabels(
  world: World,
  raster: Raster,
  civ: Civ,
  year: Year,
  kind: GroupKind,
  nameOf: (id: number) => string | null,
  opt: GroupLabelOptions,
): GroupLabel[] {
  const idx = logIndexAfter(civ.log, year);
  const mp = opt.proj;
  const key = `${idx}|${opt.refCss}|${opt.minPiece}|${opt.maxCss ?? ''}|${raster.w}|${mp?.key ?? ''}`;
  let byKind = cache.get(civ);
  if (!byKind) cache.set(civ, (byKind = new Map()));
  const slot = `${kind}|${mp ? 'proj' : 'world'}`;
  const hit = byKind.get(slot);
  if (hit && hit.key === key) return hit.labels;
  const grid = mp ? projectedTerritoryGrid(world, raster, civ, mp) : territoryGrid(world, raster, civ);
  const field = territoryField(grid, groupsAt(kind, civ, year));
  const labels = fitPieces(field, civ.regions.count, nameOf, opt, mp ? mp.W : world.width);
  if (mp) for (const l of labels) l.planar = true;
  byKind.set(slot, { key, labels });
  return labels;
}

const ownerCache = new WeakMap<ChangeLog, Map<GroupKind, { idx: number; grid: TerritoryGrid; f: OwnerGrid }>>();

/** 某一年每格属于哪一组(世界坐标的栅格,不算离界距离):核对名字的每个字落没落在这一组当年的地盘上 */
export function groupOwnerGrid(world: World, raster: Raster, civ: Civ, year: Year, kind: GroupKind): OwnerGrid {
  const grid = territoryGrid(world, raster, civ);
  const idx = logIndexAfter(civ.log, year);
  let byKind = ownerCache.get(civ.log);
  if (!byKind) ownerCache.set(civ.log, (byKind = new Map()));
  const hit = byKind.get(kind);
  if (hit && hit.idx === idx && hit.grid === grid) return hit.f;
  const of = groupsAt(kind, civ, year);
  const N = grid.gw * grid.gh;
  const owner = new Int16Array(N);
  for (let i = 0; i < N; i++) {
    const r = grid.region[i];
    owner[i] = r >= 0 ? of[r] : -1;
  }
  const f = { grid, owner };
  byKind.set(kind, { idx, grid, f });
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
      const maxCss = Math.min(opt.maxCss ?? Infinity, maxNameCss(pc.regions));
      const sizes: number[] = [];
      for (let c = maxCss; c >= MIN_FIT_CSS; c *= 0.92) sizes.push(c * worldPerCss);
      const f = fitShape(field, id, pc.deep, n, sizes, maxCss * worldPerCss * 14);
      if (!f) return;
      out.push({ id, text, path: f.path, size: f.size, vertical: f.vertical, regions: pc.regions, main: i === 0, mainRegions });
    });
  }
  return out;
}

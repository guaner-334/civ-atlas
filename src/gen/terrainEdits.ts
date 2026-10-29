/**
 * 改地形(阶段 4):把作者的地形修改(gen/edits.ts 的 TerrainOp,格式见那里的文件头"地形修改")套进生成流程。
 * 纯计算,不碰 DOM。
 *
 * 不直接改最终的海拔,而是在生成流程里对应的那一步"补一把自然之力",之后的侵蚀、排水、气候、群落照常跑 ——
 * 改过的地形和天然长出来的一样(河谷、雪线、群落都跟着变):
 *
 * - 侵蚀之前(applyTerrainTectonics,原地改板块那一步得到的 land、uplift、oceanDepth):
 *   - 火山:抬升场里加一个圆锥(中心最强);放在海里的,锥体中间一片改成陆地(成岛),周围海底抬高成海山
 *   - 山脉:沿折线加一道抬升脊,脊上高低起伏、两头收尖;穿过海面、抬得够高的一段改成陆地(岛链 / 半岛)
 *   - 抬起陆地:画笔走过的地方改成陆地(低平,和天然平原一样的基础抬升);本来就是陆地的稍微抬高
 *   - 沉成海:画笔走过的地方改成浅海;边上留下的陆地抬升减弱(海岸低平)
 *   侵蚀按抬升造山、按降水刻河谷,火山、山脉就被刻出放射状的山谷和水系。
 *   新海岸线加一点噪声,不是整整齐齐的圆。
 * - 海拔换算成米时,"最高峰"取样跳过改过的地块(返回的 touched):一座大火山不会把全世界的山都压矮
 * - 随机洼地之后(carveLakes):在湖的位置挖一个碗形洼地,碗底比碗沿外一圈的最低处还低,
 *   排水(Priority-Flood)自己把它灌满成湖;用户挖的湖不受"太大的湖填成平地"的限制
 * - 随机洼地之后、挖湖之前(applyHeightPens):高度五种笔(抬高 / 压低 / 平滑 / 抹平 / 定高)直接改最后的海拔(米),
 *   改过以后高过海平面的是陆地、低于海平面的是海;之后的湖、河、气候、群落照新高度算。侵蚀已经跑完,涂的高度不会被抹掉
 * - 排水、填湖之后(deleteLakes):删河湖点在湖里的,整片湖填平成地;算完流量、串河之前(deleteRivers):删河湖指着的河连同支流,
 *   上游流域的流量压到成河门槛以下
 * - 最后(volcanoPeaks):每座火山的峰顶地块,手绘风在那里画火山符号
 *
 * 确定性:不用随机数;山脉脊上的起伏、新海岸线的细碎用 subSeed(seed, 'terrain-edit') 的噪声。
 */
import type { Mesh } from './mesh';
import type { Tectonics } from './tectonics';
import type { TerrainOp } from './edits';
import { clamp, smoothstep, subSeed } from './util';
import { geometryOf, type Geometry } from './geometry';
import { isClimateKind, isHeightKind, nearLon, TERRAIN_W } from './terrainOps';

// 取值范围、预设、整理、比较在 terrainOps.ts;原来从这里 import 的照旧能用
export * from './terrainOps';

// ---------------------------------------------------------------------------
// 形状(点到折线的最近点在 geometry.ts 的 polyline)

/** 形状扭一扭(域扭曲):山脊蜿蜒、火山和湖不是正圆。把地块 i 扭过的位置(世界坐标)写进 out */
function warper(geo: Geometry, seed: number) {
  const wx = geo.fbm(subSeed(seed, 'terrain-edit') ^ 0x3c6e, 3);
  const wy = geo.fbm(subSeed(seed, 'terrain-edit') ^ 0x7a91, 3);
  return (i: number, amp: number, out: number[]) => geo.moveCell(out, i, amp * wx.atScale(i, 48), amp * wy.atScale(i, 48));
}

// ---------------------------------------------------------------------------
// 侵蚀之前:陆地 / 海洋、抬升、海底

/** 火山圆锥中心的抬升(× 强度;天然碰撞带最强约 1.1–1.5,火山细而尖,要更大的抬升才堆得起来) */
const VOLCANO_U = 3.2;
/** 山脉脊线上的抬升(× 强度) */
const RANGE_U = 1.5;
/** 抬起陆地:新陆地上额外的丘陵抬升(× 强度) */
const RAISE_U = 0.07;

/**
 * 侵蚀之前套上火山、山脉、抬起陆地、沉成海(原地改 tect.land / tect.uplift / tect.oceanDepth,按列表先后,后改的盖住先改的)。
 * 返回"改过的地块"(1 = 这里的地形被改过;换算成米时不参与最高峰取样)。没有这几种修改 = null(什么都没动)
 */
export function applyTerrainTectonics(mesh: Mesh, tect: Tectonics, ops: readonly TerrainOp[], seed: number): Uint8Array | null {
  const shapes = ops.filter((o) => o.kind === 'volcano' || o.kind === 'range' || o.kind === 'raise' || o.kind === 'sink');
  if (!shapes.length) return null;
  const { n } = mesh;
  const geo = geometryOf(mesh);
  const { land, uplift, oceanDepth } = tect;
  const nz = geo.fbm(subSeed(seed, 'terrain-edit'), 3);
  const warp = warper(geo, seed);
  const q = [0, 0];
  /** 1 = 改成陆地,−1 = 改成海 */
  const over = new Int8Array(n);
  const add = new Float32Array(n);
  const mul = new Float32Array(n).fill(1);
  /** 沉成海的地方的水深(负数) */
  const sea = new Float32Array(n);
  /** 海底往浅处抬的程度 0–1 */
  const floor = new Float32Array(n);
  const touched = new Uint8Array(n);

  for (const op of shapes) {
    const r = op.r;
    const s = op.s;
    const reach = op.kind === 'volcano' ? 2.6 * r : op.kind === 'range' ? 2.4 * r : 2.2 * r;
    // 山脊蜿蜒、火山山体不正圆、画笔画出的海岸线不是光溜溜的一条(边上另有细碎的海岸噪声)
    const amp = op.kind === 'range' ? 0.45 * r : op.kind === 'volcano' ? 0.2 * r : 0.35 * r;
    const sh = geo.polyline(op.pts, reach);
    // 山脉两头收尖的长度;太短的(几乎是点一下)当成一座圆山
    const taperLen = Math.min(sh.len * 0.35, 1.8 * r);
    for (let i = 0; i < n; i++) {
      if (!sh.covers(i)) continue;
      warp(i, amp, q);
      const h = sh.nearest(q[0], q[1]);
      const t = h.d / r;
      // 海岸线的细碎:同一张噪声,两种尺度
      const coast = 0.6 * nz.atScale(i, 22) + 0.4 * nz.atScale(i, 9, 31.7, -12.9);
      if (op.kind === 'volcano') {
        if (t >= 2.6) continue;
        if (t < 1) {
          add[i] += s * VOLCANO_U * Math.pow(1 - t, 1.6);
          if (t + 0.16 * coast < 0.72) over[i] = 1;
        }
        floor[i] = Math.max(floor[i], 1 - smoothstep(0.6, 2.6, t));
        touched[i] = 1;
      } else if (op.kind === 'range') {
        if (t >= 2.4) continue;
        const a = h.a;
        const taper = taperLen > 0.5 * r ? 0.15 + 0.85 * smoothstep(0, taperLen, a) * smoothstep(0, taperLen, sh.len - a) : 1;
        // 脊上高低起伏:按最近点的位置取噪声(同一处的两道山脉起伏一致)
        const v = 0.78 + 0.32 * nz.pointScale(h.qx, h.qy, 60, 7.3, -3.1);
        const f = taper * v * Math.exp(-1.4 * t * t);
        add[i] += s * RANGE_U * f;
        if (f + 0.14 * coast > 0.55) over[i] = 1;
        floor[i] = Math.max(floor[i], taper * Math.exp(-0.45 * t * t));
        touched[i] = 1;
      } else {
        // 画笔:核心一片实心,边缘软
        if (t >= 2.2) continue;
        const f = 1 - smoothstep(0.55, 1.1, t);
        const core = f + 0.42 * coast > 0.5;
        if (op.kind === 'raise') {
          if (core) over[i] = 1;
          add[i] += s * RAISE_U * f;
          floor[i] = Math.max(floor[i], 1 - smoothstep(0.8, 2.2, t));
        } else {
          if (core) {
            over[i] = -1;
            add[i] = 0;
            sea[i] = -(30 + 220 * s * smoothstep(0.3, 1, f + 0.2 * coast));
            floor[i] = 0;
          } else {
            // 边上的陆地抬升减弱:新海岸低平
            mul[i] *= 1 - 0.75 * (1 - smoothstep(0.9, 2.2, t));
          }
        }
        touched[i] = 1;
      }
    }
  }

  // 套上:改陆地 / 海洋,再加抬升;海底往浅处抬
  const base = geo.fbm(subSeed(seed, 'terrain-edit') ^ 0x5bd1, 3);
  for (let i = 0; i < n; i++) {
    if (!touched[i]) continue;
    if (over[i] === 1 && !land[i]) {
      land[i] = 1;
      oceanDepth[i] = 0;
      // 新陆地的基础抬升和天然平原一样(0.02–0.07)
      uplift[i] = 0.045 + 0.025 * base.atScale(i, 180);
    } else if (over[i] === -1 && land[i]) {
      land[i] = 0;
      uplift[i] = 0;
      oceanDepth[i] = Math.min(-20, sea[i]);
    }
    if (land[i]) uplift[i] = uplift[i] * mul[i] + add[i];
    else if (floor[i] > 0 && over[i] !== -1) {
      // 海山 / 海岭:往 −60 米抬,只往浅里抬
      const d = oceanDepth[i] + (-60 - oceanDepth[i]) * floor[i];
      if (d > oceanDepth[i]) oceanDepth[i] = Math.min(-20, d);
    }
  }
  return touched;
}

// ---------------------------------------------------------------------------
// 随机洼地之后、挖湖之前:高度五种笔

/** 抬高 / 压低:力度 1 时每个点在笔心抬(压)多少米 */
const LIFT_M = 60;
/** 平滑、抹平:力度 1 时每个点在笔心往目标走多少(比例) */
const SMOOTH_K = 0.5;
const FLAT_K = 0.5;
/** 定高的三种边缘(硬 / 适中 / 软):笔半径的多少倍以内照足,往外到笔的边上渐弱到 0 */
const EDGE_IN = [0.85, 0.5, 0.15];

/** 笔心到边上的权重(t = 离笔心的距离 / 半径):(1 − t²)²,笔心 1、边上 0,没有折角(涂出来没有台阶、尖刺) */
export const penFalloff = (t: number) => (t >= 1 ? 0 : (1 - t * t) * (1 - t * t));

/** 定高在离笔走过的线 t 个半径处的权重(1 = 正好是写的海拔) */
export const setHeightWeight = (t: number, edge: 0 | 1 | 2 = 1) => (t >= 1 ? 0 : 1 - smoothstep(EDGE_IN[edge], 1, t));

/**
 * 抬高 / 压低一笔在世界坐标点 (x, y) 处一共抬了多少米(压低是负数;编辑地形的读数用,和 applyHeightPens 同一个算法)。
 * dist = 两个世界坐标点的距离(生成时是球面上的弦长)
 */
export function liftAt(op: TerrainOp, x: number, y: number, dist: (ax: number, ay: number, bx: number, by: number) => number): number {
  if (op.kind !== 'lift' && op.kind !== 'lower') return 0;
  let sum = 0;
  for (let k = 0; k < op.pts.length; k += 2) sum += penFalloff(dist(op.pts[k], op.pts[k + 1], x, y) / op.r);
  return (op.kind === 'lift' ? 1 : -1) * op.s * LIFT_M * sum;
}

/**
 * 按先后套上高度五种笔(原地改 elevation、land):
 * - 抬高 / 压低、平滑、抹平:笔按过的每个点(按住不动时同一个点记好几次)各改一下笔下的地块,权重 penFalloff,越涂越多;
 *   平滑 = 往四周邻居的平均走,抹平 = 往这一笔第一个点(按下的地方)那时的海拔走
 * - 定高:笔走过的带子里改成 h 米,边缘按 edge 渐弱(setHeightWeight)
 * 改完以后,改过的地块高过海平面的是陆地、不高于海平面的是海。
 * 返回改过的地块(1 = 改过);没有这几种 = null(什么都没动)
 */
export function applyHeightPens(mesh: Mesh, land: Uint8Array, elevation: Float32Array, ops: readonly TerrainOp[]): Uint8Array | null {
  const pens = ops.filter((o) => isHeightKind(o.kind));
  if (!pens.length) return null;
  const { n, adjStart, adj } = mesh;
  const geo = geometryOf(mesh);
  const mask = new Uint8Array(n);
  let at: ((x: number, y: number) => number) | null = null;
  for (const op of pens) {
    const r = op.r;
    if (op.kind === 'setHeight') {
      const h = op.h ?? 0;
      const sh = geo.polyline(op.pts, r);
      for (let i = 0; i < n; i++) {
        if (!sh.covers(i)) continue;
        const w = setHeightWeight(sh.nearest(mesh.x[i], mesh.y[i]).d / r, op.edge);
        if (w <= 0) continue;
        elevation[i] = w >= 1 ? h : elevation[i] + (h - elevation[i]) * w;
        mask[i] = 1;
      }
      continue;
    }
    const sign = op.kind === 'lower' ? -1 : 1;
    let target = 0;
    if (op.kind === 'flatten') {
      at ??= geo.locator();
      target = elevation[at(op.pts[0], op.pts[1])];
    }
    for (let k = 0; k < op.pts.length; k += 2) {
      const px = op.pts[k];
      const py = op.pts[k + 1];
      const cells = geo.cellsNearPoint(px, py, r);
      // 平滑:这一个点笔下的地块一起算(都按改之前的邻居),再一起写回去
      const next = op.kind === 'smooth' ? new Float64Array(cells.length) : null;
      for (let j = 0; j < cells.length; j++) {
        const i = cells[j];
        const f = penFalloff(geo.distTo(i, px, py) / r);
        if (op.kind === 'lift' || op.kind === 'lower') elevation[i] += sign * op.s * LIFT_M * f;
        else if (op.kind === 'flatten') elevation[i] += (target - elevation[i]) * Math.min(1, op.s * FLAT_K * f);
        else {
          let sum = 0;
          for (let a = adjStart[i]; a < adjStart[i + 1]; a++) sum += elevation[adj[a]];
          const avg = sum / (adjStart[i + 1] - adjStart[i]);
          next![j] = elevation[i] + (avg - elevation[i]) * Math.min(1, op.s * SMOOTH_K * f);
        }
        if (f > 0) mask[i] = 1;
      }
      if (next) for (let j = 0; j < cells.length; j++) elevation[cells[j]] = next[j];
    }
  }
  for (let i = 0; i < n; i++) {
    if (!mask[i]) continue;
    if (land[i] && elevation[i] <= 0) land[i] = 0;
    else if (!land[i] && elevation[i] > 0) land[i] = 1;
  }
  return mask;
}

// ---------------------------------------------------------------------------
// 随机洼地之后:湖

/** 湖最深多少米(× 强度),碗沿再低多少米 */
const LAKE_DEPTH = 50;
const LAKE_LIP = 6;

/**
 * 在每个湖的位置挖碗形洼地(原地改 elevation):碗里的地块都低于碗外一圈邻居里最低的那个(= 溢出口),
 * 排水时自己灌满成湖,从溢出口流出去。湖心点在海里的不挖。
 * 返回用户湖的地块(1 = 这里是作者挖的湖,"太大的湖填平"跳过它们);没有湖 = null
 */
export function carveLakes(mesh: Mesh, land: Uint8Array, elevation: Float32Array, ops: readonly TerrainOp[], seed: number): Uint8Array | null {
  const lakes = ops.filter((o) => o.kind === 'lake');
  if (!lakes.length) return null;
  const { n, adjStart, adj } = mesh;
  const geo = geometryOf(mesh);
  const mask = new Uint8Array(n);
  const inBowl = new Uint8Array(n);
  const warp = warper(geo, seed);
  const q = [0, 0];
  const nz = geo.fbm(subSeed(seed, 'terrain-lake') ^ 0x2f17, 3);
  const off = [0, 0];
  for (const op of lakes) {
    const [px, py] = op.pts;
    const r = op.r;
    const e = op.e;
    // 碗:湖心半径 r 内的陆地(湖岸扭一扭,不是正圆)
    const bowl: number[] = [];
    const amp = e === undefined ? 0.3 * r : (0.25 + 0.45 * e) * r;
    const R = (e === undefined ? r : r * 1.7) + amp;
    // 新画法:按湖的大小取噪声的尺度(小湖也有弯),整体拉长成椭圆、朝向随位置
    const th = Math.PI * nz.pointScale(px, py, 400, 3.1, 7.7);
    const str = 1 + (0.35 + 0.5 * (e ?? 0)) * (0.5 + 0.5 * nz.pointScale(px, py, 400, -5.3, 1.9));
    const ca = Math.cos(th);
    const sa = Math.sin(th);
    const tOf = (i: number): number => {
      if (e === undefined) {
        warp(i, amp, q);
        return geo.pointDist(q[0], q[1], px, py) / r;
      }
      geo.pointOffset(px, py, mesh.x[i], mesh.y[i], off);
      const sc = Math.max(6, 0.9 * r);
      let u = off[0] + amp * nz.atScale(i, sc, 11.3, 2.9) + 0.18 * e * r * nz.atScale(i, sc * 0.35, -4.1, 8.3);
      let v = off[1] + amp * nz.atScale(i, sc, -6.7, 5.1) + 0.18 * e * r * nz.atScale(i, sc * 0.35, 9.9, -2.2);
      const a = (u * ca + v * sa) / Math.sqrt(str);
      const b = (-u * sa + v * ca) * Math.sqrt(str);
      u = a;
      v = b;
      return Math.sqrt(u * u + v * v) / r;
    };
    // 湖心落在哪一块:新画法的小湖可能比地块还小,找最近的一块时至少看出去一块半地块那么远
    const Rc = e === undefined ? R : Math.max(R, 1.5 * mesh.spacing);
    let c = -1;
    let cd = Infinity;
    for (let i = 0; i < n; i++) {
      const d = geo.nearTo(i, px, py, Rc);
      if (d < 0) continue;
      if (d < cd) {
        cd = d;
        c = i;
      }
      if (d <= R && tOf(i) < 1 && land[i]) bowl.push(i);
    }
    if (c < 0 || !land[c]) continue;
    if (!bowl.includes(c)) bowl.push(c);
    for (const i of bowl) inBowl[i] = 1;
    // 碗沿 = 碗外一圈邻居里最低的(海 = 0 米)
    let rim = Infinity;
    for (const i of bowl) {
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        if (inBowl[j]) continue;
        rim = Math.min(rim, land[j] ? elevation[j] : 0);
      }
    }
    if (!Number.isFinite(rim)) rim = elevation[c];
    for (const i of bowl) {
      const t = Math.min(1, tOf(i));
      const target = rim - LAKE_LIP - LAKE_DEPTH * op.s * (1 - t * t);
      if (elevation[i] > target) elevation[i] = target;
      mask[i] = 1;
      inBowl[i] = 0;
    }
  }
  return mask;
}

// ---------------------------------------------------------------------------
// 湖之后:河

/** 河谷:河道比两岸最低处还低多少米(× 强度),一路往下游每个地块至少再低多少米 */
const RIVER_CUT = 12;
const RIVER_DROP = 0.4;

/**
 * 沿作者画的河挖一道河谷(原地改 elevation):把线经过的地块串成一条链,低的那头当河口(有一头在海里的,那头是河口);
 * 从源头往下游,每个地块挖到比它两岸(不在链上的邻居)最低处还低、也比上游那块低 —— 排水时水就顺着这条链流。
 * 链走到海、湖就停(河口)。海拔不低于 1 米(不挖到海平面以下积成一串湖)。
 * 返回"一定画成河"的地块(1 = 这里是作者画的河道,流量不够也画);没有河 = null
 */
export function carveRivers(mesh: Mesh, water: Uint8Array, elevation: Float32Array, ops: readonly TerrainOp[]): Uint8Array | null {
  const rivers = ops.filter((o) => o.kind === 'river');
  if (!rivers.length) return null;
  const { n, adjStart, adj } = mesh;
  const geo = geometryOf(mesh);
  const at = geo.locator();
  const forced = new Uint8Array(n);
  const onChain = new Uint8Array(n);
  for (const op of rivers) {
    // 线上密密地取点,每个点落在哪块,连成链(相邻的重复去掉)
    const sh = geo.polyline(op.pts, 0);
    const step = Math.max(0.5, mesh.spacing / 3);
    const chain: number[] = [];
    const m = op.pts.length >> 1;
    for (let k = 0; k < Math.max(1, m - 1); k++) {
      const ax = op.pts[2 * k];
      const ay = op.pts[2 * k + 1];
      const bx = m > 1 ? op.pts[2 * k + 2] : ax;
      const by = m > 1 ? op.pts[2 * k + 3] : ay;
      const len = m > 1 ? sh.cum[k + 1] - sh.cum[k] : 0;
      const steps = Math.max(1, Math.ceil(len / step));
      for (let t = 0; t <= steps; t++) {
        const c = at(ax + ((bx - ax) * t) / steps, ay + ((by - ay) * t) / steps);
        if (chain[chain.length - 1] !== c) chain.push(c);
      }
    }
    // 哪头是源头:有一头在水里的,那头是河口;否则高的那头是源头
    const head = chain[0];
    const tail = chain[chain.length - 1];
    const wetHead = water[head] !== 0;
    const wetTail = water[tail] !== 0;
    if ((wetHead && !wetTail) || (!wetHead && !wetTail && elevation[head] < elevation[tail])) chain.reverse();
    // 源头那头在水里的部分去掉,走到水就停
    let s0 = 0;
    while (s0 < chain.length && water[chain[s0]] !== 0) s0++;
    let s1 = s0;
    while (s1 < chain.length && water[chain[s1]] === 0) s1++;
    const run = chain.slice(s0, s1);
    if (run.length < 2) continue;
    for (const c of run) onChain[c] = 1;
    let prev = Infinity;
    for (const c of run) {
      let low = Infinity;
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const j = adj[k];
        if (onChain[j]) continue;
        low = Math.min(low, water[j] === 0 ? elevation[j] : 0);
      }
      let e = Math.min(elevation[c], low - RIVER_CUT * op.s, prev - RIVER_DROP);
      if (!Number.isFinite(e)) e = elevation[c];
      e = Math.max(1, e);
      elevation[c] = e;
      prev = e;
      forced[c] = Math.max(forced[c], Math.min(255, Math.round(op.r)));
    }
    for (const c of run) onChain[c] = 0;
  }
  return forced;
}

// ---------------------------------------------------------------------------
// 删河湖

/** 河(world.ts 的 River 里删河湖要用的几样;这里不引 world.ts) */
export interface RiverLike {
  /** x, y, 流量 交错存 */
  pts: Float32Array;
  /** 经过的地块链 */
  cells: Int32Array;
  /** 作者画的河经过的点(有 = 作者画的河) */
  drawn?: Uint8Array;
}

/**
 * 点 (px, py) 落在哪个湖里:离它最近的地块是湖(water = 2)= 那一整片湖(相连的湖水地块,从那一块开始一圈圈往外);不是湖 = null。
 * own 标着作者放的湖:这片湖碰到其中一块就不算(删河湖只删程序生成的)
 */
export function lakeAt(mesh: Mesh, water: Uint8Array, px: number, py: number, own?: ArrayLike<number> | null): number[] | null {
  const c = geometryOf(mesh).nearest(px, py, 0);
  if (water[c] !== 2) return null;
  const comp = [c];
  const seen = new Set(comp);
  for (let q = 0; q < comp.length; q++) {
    const a = comp[q];
    for (let k = mesh.adjStart[a]; k < mesh.adjStart[a + 1]; k++) {
      const j = mesh.adj[k];
      if (water[j] === 2 && !seen.has(j)) {
        seen.add(j);
        comp.push(j);
      }
    }
  }
  return own && comp.some((i) => own[i]) ? null : comp;
}

/** 作者放的湖各自的中心落在哪个地块(标 1):地图上指着湖时,用它认出作者放的湖、不描红 */
export function ownLakeCells(mesh: Mesh, ops: readonly TerrainOp[]): Uint8Array {
  const out = new Uint8Array(mesh.n);
  for (const op of ops) if (op.kind === 'lake') out[geometryOf(mesh).nearest(op.pts[0], op.pts[1], 0)] = 1;
  return out;
}

/**
 * 点 (px, py) 指着哪几条河:离它不超过 R(主图上的距离,东西相连)的河里最近的一条(作者画的河不算),
 * 连同流进它的支流(一层层往上:河的最后一个地块落在要删的河自己的陆地段上 = 流进它;作者画的支流不算)。返回河的下标(先是指着的那条);没有 = []。
 * 地图上指着时描红、生成时删,都按这个算
 */
export function riversAt(rivers: readonly RiverLike[], water: Uint8Array, px: number, py: number, R: number): number[] {
  let best = -1;
  let bestD = R * R;
  rivers.forEach((rv, i) => {
    if (rv.drawn) return;
    const p = rv.pts;
    let sx = 0;
    let sy = 0;
    for (let k = 0; k < p.length; k += 3) {
      // 第一个点挪到离 px 最近的那一圈,之后每个点挪到离上一个点最近的那一圈(跨 180° 经线的一段是连着的)
      const bx = p[k] - TERRAIN_W * Math.round((p[k] - (k === 0 ? px : sx)) / TERRAIN_W);
      const by = p[k + 1];
      if (k === 0) {
        sx = bx;
        sy = by;
      }
      const dx = bx - sx;
      const dy = by - sy;
      const l = dx * dx + dy * dy;
      const t = l > 0 ? clamp(((px - sx) * dx + (py - sy) * dy) / l, 0, 1) : 0;
      const d = (px - sx - t * dx) ** 2 + (py - sy - t * dy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
      sx = bx;
      sy = by;
    }
  });
  if (best < 0) return [];
  const out = [best];
  const taken = new Set(out);
  const own = riverOwner(rivers, water);
  const gone = new Set(riverCells(rivers, water, out, own));
  for (let more = true; more; ) {
    more = false;
    rivers.forEach((rv, i) => {
      const last = rv.cells[rv.cells.length - 1];
      if (rv.drawn || taken.has(i) || own.get(last) === i || !gone.has(last)) return;
      out.push(i);
      taken.add(i);
      for (const c of riverCells(rivers, water, [i], own)) gone.add(c);
      more = true;
    });
  }
  return out;
}

/** 每个陆地块归哪条河:最先经过它的那条(后串的河走到串过的地块就停,那一块是汇进去的地方,归先串的那条) */
function riverOwner(rivers: readonly RiverLike[], water: Uint8Array): Map<number, number> {
  const own = new Map<number, number>();
  rivers.forEach((rv, i) => {
    for (const c of rv.cells) if (water[c] === 0 && !own.has(c)) own.set(c, i);
  });
  return own;
}

/**
 * 这几条河自己的陆地段:河口(海、湖)和汇进别的河的那一块不算;流到冰盖边停下的河,最后一块是它自己的。
 * 删河时压的就是这些地块(和它们的上游)
 */
export function riverCells(rivers: readonly RiverLike[], water: Uint8Array, idx: readonly number[], own = riverOwner(rivers, water)): number[] {
  const out: number[] = [];
  for (const i of idx) for (const c of rivers[i].cells) if (own.get(c) === i) out.push(c);
  return out;
}

// ---------------------------------------------------------------------------
// 火山峰顶(手绘风的火山符号)

/** 每座火山的峰顶地块(火山中心 0.6 个半径内最高的陆地;一块陆地都没有的火山跳过),按修改的先后 */
export function volcanoPeaks(mesh: Mesh, water: Uint8Array, elevation: Float32Array, ops: readonly TerrainOp[]): number[] {
  const out: number[] = [];
  const { n } = mesh;
  const geo = geometryOf(mesh);
  for (const op of ops) {
    if (op.kind !== 'volcano') continue;
    const [px, py] = op.pts;
    const R = Math.max(op.r * 0.6, 8);
    let best = -1;
    for (let i = 0; i < n; i++) {
      const d = geo.nearTo(i, px, py, R);
      if (d < 0 || water[i] !== 0 || d >= R) continue;
      if (best < 0 || elevation[i] > elevation[best]) best = i;
    }
    if (best >= 0 && !out.includes(best)) out.push(best);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 算完气候之后:改气候的四支笔

/** 程度 1 时:更湿多下的雨(mm,另按原来的雨量加九成)、更干少下的比例、更暖 / 更冷的度数 */
const WET_MM = 260;
const WET_MUL = 0.9;
const DRY_MUL = 0.5;
const WARM_C = 6;
/** 叠笔的上限:降水(毫米 / 年)、最暖、最冷(°C) */
const WET_CAP = 6000;
const WARM_CAP = 40;
const COLD_CAP = -50;

/**
 * 按先后套上改气候的笔(原地改 temperature、precipitation):涂抹 = 笔走过的带子,圈起来填满 = 圈里整片;
 * 核心一片照足,边缘软(半径的 0.6–1.1 倍之间渐弱)。没有这几种 = 什么都不动
 */
export function applyClimatePens(mesh: Mesh, temperature: Float32Array, precipitation: Float32Array, ops: readonly TerrainOp[]) {
  const pens = ops.filter((o) => isClimateKind(o.kind));
  if (!pens.length) return;
  const { n } = mesh;
  const geo = geometryOf(mesh);
  for (const op of pens) {
    const r = op.r;
    const sh = geo.polyline(op.f ? [...op.pts, op.pts[0], op.pts[1]] : op.pts, 1.1 * r);
    // 圈起来填满的圈可能很大,圈里不一定在包围球里:另按圈在主图上的外框筛(x 和 insidePolygon 一样挪到离第一个点最近的那一圈)
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    if (op.f) {
      for (let k = 0; k < op.pts.length; k += 2) {
        x0 = Math.min(x0, op.pts[k]);
        x1 = Math.max(x1, op.pts[k]);
        y0 = Math.min(y0, op.pts[k + 1]);
        y1 = Math.max(y1, op.pts[k + 1]);
      }
    }
    for (let i = 0; i < n; i++) {
      if (!sh.covers(i)) {
        if (!op.f) continue;
        const y = mesh.y[i];
        if (y < y0 || y > y1) continue;
        const x = nearLon(mesh.x[i], op.pts[0]) + (mesh.x[i] - Math.round(mesh.x[i]));
        if (x < x0 || x > x1) continue;
      }
      const d = sh.nearest(mesh.x[i], mesh.y[i]).d;
      const w = op.f && insidePolygon(op.pts, mesh.x[i], mesh.y[i]) ? 1 : 1 - smoothstep(0.6 * r, 1.1 * r, d);
      if (w <= 0) continue;
      const k = op.s * w;
      // 同一处叠很多笔也有个头:雨水最多加到 WET_CAP,气温最多推到 WARM_CAP / COLD_CAP(本来就超过的不动)
      const p0 = precipitation[i];
      const t0 = temperature[i];
      if (op.kind === 'wet') precipitation[i] = Math.max(p0, Math.min(WET_CAP, p0 * (1 + WET_MUL * k) + WET_MM * k));
      else if (op.kind === 'dry') precipitation[i] = p0 * Math.max(0.05, 1 - DRY_MUL * k);
      else if (op.kind === 'warm') temperature[i] = Math.max(t0, Math.min(WARM_CAP, t0 + WARM_C * k));
      else temperature[i] = Math.min(t0, Math.max(COLD_CAP, t0 - WARM_C * k));
    }
  }
}

/** 世界坐标点 (px, py) 在不在折线首尾连起来的圈里(主图平面上数射线穿过几次;x 先挪到离圈的第一个点最近的那一圈) */
function insidePolygon(pts: readonly number[], px0: number, py: number): boolean {
  const px = nearLon(px0, pts[0]) + (px0 - Math.round(px0));
  let inside = false;
  const m = pts.length >> 1;
  for (let a = 0, b = m - 1; a < m; b = a++) {
    const xa = pts[2 * a];
    const ya = pts[2 * a + 1];
    const xb = pts[2 * b];
    const yb = pts[2 * b + 1];
    if (ya > py !== yb > py && px < ((xb - xa) * (py - ya)) / (yb - ya) + xa) inside = !inside;
  }
  return inside;
}

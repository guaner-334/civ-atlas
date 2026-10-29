/**
 * 编辑地形「板块」页的改动(草图里的 plates,格式见 edits.ts 文件头「地形草图」):选中一块改漂移的方向快慢、陆壳 / 洋壳,
 * 画一条线切开,点两块合并,「板块相撞时造山」开关。纯计算,不碰 DOM。
 *
 * 改动按先后存成一串(PlateOp),都用"点"指板块:板块的编号随种子、精细度变,点不变。
 * - set:pts = [x, y],那里的板块改漂移(dir 往哪边,度,0 = 北、90 = 东;speed 每年几厘米)或地壳(crust)
 * - cut:pts 是画的线;线把哪块板块整个分成了两片(或几片),那块就沿线切开 —— 大的一片留原来的编号,别的另起编号,
 *   照搬原来那块的转动(角速度一样,新的边界上起初不碰也不离),之后再选中改
 * - merge:pts = [ax, ay, bx, by],点 b 所在的板块并进点 a 所在的(两块要挨着;b 的编号空着,别的编号不变,颜色不跳)
 *
 * 照一张图分(image):图片本身不存,只存认出来的分块格子图(sketchImage.ts 的 plateRegions 认,LAYER_W × LAYER_H,值 = 第几块,
 * 0 = 描的线 / 太碎认不出,生成时归给挨着的块)。生成时最先套上:整张板块图换成图上的分块,每块的漂移按种子另取;上面那串改动再叠在它上面。
 *
 * 生成时(tectonics.ts)在板块长好、挑完大陆之后按先后套上:地壳记在每个地块上(合并不会把大洋变成大陆,
 * 切开的两半各是原来的地壳),改了陆壳 / 洋壳的那块整块换;山脉、海沟、裂谷按新的边界和漂移重新长。
 */
import type { Mesh } from './mesh';
import { geometryOf } from './geometry';
import { round24 } from './civ/rand';
import { keyed, subSeed } from './util';
import { TERRAIN_H, TERRAIN_W, wrapLon } from './terrainOps';
import { LAYER_H, LAYER_W } from './sketch';
import { driftOf, PLATE_CM, type PlateOp } from './plateOps';

// 改动的格式、上限、整理、比较、罗盘和漂移的写法在 plateOps.ts;原来从这里 import 的照旧能用
export * from './plateOps';

// ---------------------------------------------------------------------------
// 生成时套上

/** 套改动时的板块状态(tectonics.ts 给;原地改) */
export interface PlateState {
  /** 每个地块属于哪块板块 */
  plate: Int16Array;
  /** 板块编号用到几(合并空出来的编号也算) */
  count: number;
  /** 每块板块的角速度向量(交错存 x, y, z)、密度、自转 */
  omega: number[];
  density: number[];
  spin: number[];
  /** 每个地块的地壳:0 大洋、1 微大陆、2 大陆 */
  crust: Uint8Array;
  /** 改过的板块(地块变了、转动变了) */
  touched: Set<number>;
}

/** 切下来的一片至少多大才另起一块(占那块板块的比例;再小的并回旁边的那片) */
const MIN_PIECE = 0.03;

/** 照图分的一块至少多大(地块数占全图的比例):再小的碎片归给挨着的块 */
const MIN_IMAGE_PIECE = 1 / 2000;

/**
 * 照图分:整张板块图换成图上的分块(st 原地改)。每个地块取它落在格子图哪一格;线、认不出的格子和太碎的小片从挨着的块往外长着归过去。
 * 块号按图上的号从小到大重排成 0、1、2…;每块的漂移(方向、快慢、密度、自转)按种子和块号另取,和随机分的板块同一个范围
 */
export function applyPlateImage(mesh: Mesh, st: PlateState, layer: Uint8Array, seed: number) {
  const { n, x, y, adjStart, adj } = mesh;
  const { plate } = st;
  const cw = TERRAIN_W / LAYER_W;
  const ch = TERRAIN_H / LAYER_H;
  const lab = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const lx = Math.min(LAYER_W - 1, Math.floor(wrapLon(x[i]) / cw));
    const ly = Math.min(LAYER_H - 1, Math.max(0, Math.floor(y[i] / ch)));
    lab[i] = layer[ly * LAYER_W + lx] - 1;
  }
  const grow = () => {
    const q: number[] = [];
    for (let i = 0; i < n; i++) if (lab[i] >= 0) q.push(i);
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const j = adj[k];
        if (lab[j] < 0) {
          lab[j] = lab[c];
          q.push(j);
        }
      }
    }
  };
  grow();
  // 太碎的小片(连成一片的同一块不到 MIN_IMAGE_PIECE)清掉,再从挨着的长过去
  const min = Math.max(3, n * MIN_IMAGE_PIECE);
  const seen = new Uint8Array(n);
  let dropped = false;
  for (let s = 0; s < n; s++) {
    if (seen[s]) continue;
    const q = [s];
    seen[s] = 1;
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
        const j = adj[k];
        if (!seen[j] && lab[j] === lab[s]) {
          seen[j] = 1;
          q.push(j);
        }
      }
    }
    if (q.length < min) {
      for (const c of q) lab[c] = -1;
      dropped = true;
    }
  }
  if (dropped) grow();
  const ids = [...new Set(lab)].sort((a, b) => a - b);
  // 落到地块上的不到两块(图上的块太窄、精细度太低,一格都没分到或碎掉了):留着原来的板块
  if (ids.length < 2 || ids[0] < 0) return;
  const to = new Map(ids.map((v, k) => [v, k]));
  const P = ids.length;
  for (let i = 0; i < n; i++) plate[i] = to.get(lab[i])!;
  const geo = geometryOf(mesh);
  const cnt = new Float32Array(P);
  for (let i = 0; i < n; i++) cnt[plate[i]]++;
  const c = geo.groupCentroids(plate, P, cnt);
  const vx = new Float32Array(P);
  const vy = new Float32Array(P);
  const base = subSeed(seed, 'plate-image');
  st.density = [];
  st.spin = [];
  for (let k = 0; k < P; k++) {
    const a = keyed(base, k, 0) * Math.PI * 2;
    const sp = 0.3 + 0.7 * keyed(base, k, 1);
    vx[k] = round24(Math.cos(a)) * sp;
    vy[k] = round24(Math.sin(a)) * sp;
    st.density.push(keyed(base, k, 2));
    st.spin.push(2 * keyed(base, k, 3) - 1);
  }
  st.omega = Array.from(geo.plateMotion(vx, vy, c.x, c.y, st.spin).omega);
  st.count = P;
  st.touched = new Set(ids.map((_, k) => k));
}

/** 按先后套上板块改动(st 原地改) */
export function applyPlateOps(mesh: Mesh, st: PlateState, ops: readonly PlateOp[]) {
  for (const op of ops) {
    if (op.kind === 'set') setPlate(mesh, st, op);
    else if (op.kind === 'merge') mergePlates(mesh, st, op.pts);
    else cutPlates(mesh, st, op.pts);
  }
}

/** 板块 k 的地块(按编号从小到大) */
function cellsOf(st: PlateState, k: number): number[] {
  const out: number[] = [];
  const { plate } = st;
  for (let i = 0; i < plate.length; i++) if (plate[i] === k) out.push(i);
  return out;
}

function setPlate(mesh: Mesh, st: PlateState, op: Extract<PlateOp, { kind: 'set' }>) {
  const geo = geometryOf(mesh);
  const k = st.plate[geo.nearest(op.pts[0], op.pts[1], 0)];
  const cells = cellsOf(st, k);
  if (op.crust) {
    const v = op.crust === 'continental' ? 2 : 0;
    for (const i of cells) st.crust[i] = v;
  }
  if (op.dir !== undefined || op.speed !== undefined) {
    // 速度给在质心处(和随机分的板块一样),自转照旧;只给了一样的,另一样照现在的
    const c = [0, 0];
    geo.centroid(cells, (i) => i, () => 1, c);
    const v = [0, 0];
    geo.motionOf(Float32Array.from(st.omega.slice(3 * k, 3 * k + 3))).atPoint(0, c[0], c[1], v);
    const now = driftOf(v[0], v[1]);
    const dir = ((op.dir ?? now.dir) * Math.PI) / 180;
    const s = (op.speed ?? now.speed) / PLATE_CM;
    const ve = round24(Math.sin(dir)) * s;
    const vs = -round24(Math.cos(dir)) * s;
    const w = geo.plateMotion(Float32Array.of(ve), Float32Array.of(vs), Float32Array.of(c[0]), Float32Array.of(c[1]), [st.spin[k]]).omega;
    st.omega[3 * k] = w[0];
    st.omega[3 * k + 1] = w[1];
    st.omega[3 * k + 2] = w[2];
  }
  st.touched.add(k);
}

function mergePlates(mesh: Mesh, st: PlateState, pts: readonly number[]) {
  const geo = geometryOf(mesh);
  const { adjStart, adj } = mesh;
  const a = st.plate[geo.nearest(pts[0], pts[1], 0)];
  const b = st.plate[geo.nearest(pts[2], pts[3], 0)];
  if (a === b) return;
  const cells = cellsOf(st, b);
  // 不挨着的两块不合(合了就是隔开的两片,算不出一块板块的转动)
  const touch = cells.some((i) => {
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) if (st.plate[adj[k]] === a) return true;
    return false;
  });
  if (!touch) return;
  for (const i of cells) st.plate[i] = a;
  st.touched.add(a);
  st.touched.add(b);
}

/** 这条线能不能把哪块板块整个切开(编辑地形松手前先看一眼,切不开的不记) */
export function cutsPlate(mesh: Mesh, plate: Int16Array, pts: readonly number[]): boolean {
  let P = 0;
  for (let i = 0; i < plate.length; i++) if (plate[i] >= P) P = plate[i] + 1;
  const st: PlateState = { plate: plate.slice(), count: P, omega: new Array(3 * P).fill(0), density: new Array(P).fill(0), spin: new Array(P).fill(0), crust: new Uint8Array(plate.length), touched: new Set() };
  cutPlates(mesh, st, pts);
  return st.count > P;
}

function cutPlates(mesh: Mesh, st: PlateState, pts: readonly number[]) {
  const geo = geometryOf(mesh);
  const { n, x, y, adjStart, adj, spacing } = mesh;
  // 线两边各这么宽的一道当作切口:跨过线的每条邻接边至少有一头落在切口里,两边就连不上了
  const reach = 0.9 * spacing;
  const line = geo.polyline(pts, reach);
  const gap = new Uint8Array(n);
  const hit: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!line.covers(i) || line.nearest(x[i], y[i]).d > reach) continue;
    gap[i] = 1;
    if (!hit.includes(st.plate[i])) hit.push(st.plate[i]);
  }
  hit.sort((a, b) => a - b);
  const label = new Int32Array(n).fill(-1);
  for (const p of hit) {
    const cells = cellsOf(st, p);
    // 切口以外连成一片的各片
    const pieces: number[][] = [];
    for (const s of cells) {
      if (gap[s] || label[s] >= 0) continue;
      const id = pieces.length;
      const q = [s];
      label[s] = id;
      for (let h = 0; h < q.length; h++) {
        const c = q[h];
        for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
          const j = adj[k];
          if (st.plate[j] === p && !gap[j] && label[j] < 0) {
            label[j] = id;
            q.push(j);
          }
        }
      }
      pieces.push(q);
    }
    const min = Math.max(n / 3000, MIN_PIECE * cells.length);
    const big = pieces.map((q, id) => ({ q, id })).filter((e) => e.q.length >= min);
    if (big.length >= 2) {
      // 大的一片留原来的编号,别的另起编号(照搬转动、密度、自转)
      big.sort((a, b) => b.q.length - a.q.length || a.q[0] - b.q[0]);
      const to = new Int32Array(pieces.length).fill(-1);
      big.forEach((e, r) => {
        if (r === 0) return void (to[e.id] = p);
        const k = st.count++;
        st.omega.push(st.omega[3 * p], st.omega[3 * p + 1], st.omega[3 * p + 2]);
        st.density.push(st.density[p]);
        st.spin.push(st.spin[p]);
        to[e.id] = k;
        st.touched.add(k);
      });
      // 切口和太小的碎片:从各片往外长,挨着哪片归哪片
      const own = new Int32Array(cells.length).fill(-1);
      const at = new Map<number, number>();
      cells.forEach((c, r) => at.set(c, r));
      const q: number[] = [];
      cells.forEach((c, r) => {
        const l = label[c];
        if (l >= 0 && to[l] >= 0) {
          own[r] = to[l];
          q.push(c);
        }
      });
      for (let h = 0; h < q.length; h++) {
        const c = q[h];
        const o = own[at.get(c)!];
        for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
          const r = at.get(adj[k]);
          if (r === undefined || own[r] >= 0) continue;
          own[r] = o;
          q.push(adj[k]);
        }
      }
      cells.forEach((c, r) => {
        if (own[r] >= 0) st.plate[c] = own[r];
      });
      st.touched.add(p);
    }
    for (const c of cells) label[c] = -1;
  }
}

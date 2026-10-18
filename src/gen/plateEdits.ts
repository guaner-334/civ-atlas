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
 * 生成时(tectonics.ts)在板块长好、挑完大陆之后按先后套上:地壳记在每个地块上(合并不会把大洋变成大陆,
 * 切开的两半各是原来的地壳),改了陆壳 / 洋壳的那块整块换;山脉、海沟、裂谷按新的边界和漂移重新长。
 */
import type { Mesh } from './mesh';
import { geometryOf } from './geometry';
import { round24 } from './civ/rand';
import { clamp } from './util';
import { TERRAIN_H, nearLon, wrapLon } from './terrainEdits';

/** 板块的一处改动 */
export type PlateOp =
  | { kind: 'set'; pts: number[]; dir?: number; speed?: number; crust?: PlateCrust }
  | { kind: 'cut'; pts: number[] }
  | { kind: 'merge'; pts: number[] };

/** 地壳:陆壳 / 洋壳 */
export type PlateCrust = 'continental' | 'oceanic';

export interface PlateEdit {
  /** 改动,按先后 */
  ops: PlateOp[];
  /** false = 板块相撞时不造山(只长草图画的山);不给 = 造山 */
  orogeny?: false;
}

/** 最多多少处改动、切开的线最多几个点 */
export const PLATE_MAX_OPS = 300;
export const PLATE_MAX_PTS = 400;
/** 漂移速度:生成里的速度 1 = 每年这么多厘米(随机分的板块是 0.3–1,也就是每年 2–8 厘米) */
export const PLATE_CM = 8;
/** 能改到的速度范围(每年厘米) */
export const PLATE_SPEED: readonly [number, number] = [0, 16];

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** 清理点:x 照改地形的折线(第一个点取模,之后挪到离上一个点最近的那一圈),y 夹在两极之间,都取整;坐标不是有限数 = null */
function cleanPts(raw: unknown, min: number, max: number): number[] | null {
  if (!Array.isArray(raw) || raw.length < min * 2) return null;
  const take = Math.min(raw.length, max * 2) & ~1;
  const pts: number[] = [];
  for (let i = 0; i < take; i += 2) {
    const px = num(raw[i]);
    const py = num(raw[i + 1]);
    if (px === null || py === null) return null;
    pts.push(i ? nearLon(px, pts[i - 2]) : wrapLon(px), Math.round(clamp(py, 0, TERRAIN_H)));
  }
  return pts;
}

/**
 * 清理一处改动:种类不认识、点不对的 = null。set 只有一个点(多的不要),dir 取整到 [0, 360),speed 夹到 PLATE_SPEED 取到半厘米,
 * crust 只认陆壳 / 洋壳,三样一样也没有 = null;merge 正好两个点;cut 至少两个点,最多 PLATE_MAX_PTS 个。本来就合格的原样返回
 */
export function cleanPlateOp(x: unknown): PlateOp | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  let out: PlateOp;
  if (o.kind === 'set') {
    const pts = cleanPts(o.pts, 1, 1);
    if (!pts) return null;
    const d = num(o.dir);
    const s = num(o.speed);
    const crust = o.crust === 'continental' || o.crust === 'oceanic' ? o.crust : undefined;
    const set: PlateOp = { kind: 'set', pts };
    if (d !== null) set.dir = ((Math.round(d) % 360) + 360) % 360;
    if (s !== null) set.speed = Math.round(clamp(s, PLATE_SPEED[0], PLATE_SPEED[1]) * 2) / 2;
    if (crust) set.crust = crust;
    if (set.dir === undefined && set.speed === undefined && !set.crust) return null;
    out = set;
  } else if (o.kind === 'merge') {
    const pts = cleanPts(o.pts, 2, 2);
    if (!pts) return null;
    out = { kind: 'merge', pts };
  } else if (o.kind === 'cut') {
    const pts = cleanPts(o.pts, 2, PLATE_MAX_PTS);
    if (!pts) return null;
    out = { kind: 'cut', pts };
  } else return null;
  return JSON.stringify(out) === JSON.stringify(x) ? (x as PlateOp) : out;
}

/** 清理板块改动:改动逐处过 cleanPlateOp(不合格的丢掉,最多 PLATE_MAX_OPS 处);orogeny 只认 false。一处没有、又造山 = null。本来就合格的原样返回 */
export function cleanPlates(x: unknown): PlateEdit | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const list = Array.isArray(o.ops) ? (o.ops as unknown[]) : [];
  const ops: PlateOp[] = [];
  let same = list === o.ops && list.length <= PLATE_MAX_OPS;
  for (const v of list) {
    if (ops.length >= PLATE_MAX_OPS) break;
    const c = cleanPlateOp(v);
    if (c) ops.push(c);
    if (c !== v) same = false;
  }
  const off = o.orogeny === false;
  if (!ops.length && !off) return null;
  same = same && Object.keys(o).length === (off ? 2 : 1);
  if (same) return x as PlateEdit;
  return off ? { ops, orogeny: false } : { ops };
}

/** 两份板块改动是不是一样(都清理过;都没有也算一样) */
export function samePlates(a: PlateEdit | null | undefined, b: PlateEdit | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 罗盘方向:dir(度,0 = 北、90 = 东)→ 八个方向的名字 */
const COMPASS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
export function compassName(dir: number): string {
  return COMPASS[Math.round((((dir % 360) + 360) % 360) / 45) % 8];
}

/** 漂移速度(东、南分量,生成里的单位)→ 往哪边(度,0 = 北、90 = 东)、每年几厘米 */
export function driftOf(ve: number, vs: number): { dir: number; speed: number } {
  // 生成里也用它(只改了快慢、没改方向时取现在的方向):开方是精确舍入的,反正切舍入到 24 位,任何电脑上一样
  const speed = Math.sqrt(ve * ve + vs * vs) * PLATE_CM;
  const dir = speed > 0 ? ((((round24(Math.atan2(ve, -vs)) * 180) / Math.PI) % 360) + 360) % 360 : 0;
  return { dir, speed };
}

/** 面板、地图上写的一句:"每年 4 厘米，往东北"(取到半厘米,和拖箭头改的一样);不到半厘米 = "几乎不动" */
export function driftText(dir: number, speed: number): string {
  const cm = Math.round(speed * 2) / 2;
  return cm < 0.5 ? '几乎不动' : `每年 ${cm} 厘米，往${compassName(dir)}`;
}

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

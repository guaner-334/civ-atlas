/**
 * 地形草图(新建世界时「画大陆和海」):作者用陆地 / 山地 / 海三种笔粗涂,程序照着在板块上长出大陆、山脉(tectonics.ts 的 4b 步),
 * 之后的侵蚀、河流、气候照常跑。纯计算,不碰 DOM。格式见 edits.ts 文件头「地形草图」。
 *
 * 存的是笔画(SketchEdit.strokes):每一笔 = 笔的种类 + 半径 + 经过的点,坐标和改地形一样是主图的世界坐标(2048 × 1024)。
 * 生成前(sketchGrid)按先后把笔画涂到一张等距圆柱的小格子图上(SKETCH_W × SKETCH_H,一格 = 世界坐标 4 × 4),后涂的盖住先涂的;
 * 格子值:0 = 没涂(照旧由程序定),1 = 海,2 = 陆地,3 = 山地。rest = 'sea' 时没涂的格子都当海。
 */
import type { Mesh } from './mesh';
import { clamp } from './util';
import { TERRAIN_H, TERRAIN_W, nearLon, wrapLon } from './terrainEdits';

export const SKETCH_W = 512;
export const SKETCH_H = 256;
/** 一格是世界坐标的几乘几 */
const CELL = TERRAIN_W / SKETCH_W;

export const SKETCH_NONE = 0;
export const SKETCH_SEA = 1;
export const SKETCH_LAND = 2;
export const SKETCH_MOUNTAIN = 3;

/** 一张草图的格子图:SKETCH_W × SKETCH_H 格,逐行从北往南、每行从西往东 */
export type Sketch = Uint8Array;

/** 笔:陆地、山地、海,擦掉 = 涂回"没涂" */
export type SketchKind = 'land' | 'mountain' | 'sea' | 'erase';

export interface SketchStroke {
  kind: SketchKind;
  /** 笔的半径(世界坐标) */
  r: number;
  /** 经过的点 [x0, y0, x1, y1, …](世界坐标,规则同改地形的折线;只有一个点 = 点了一下) */
  pts: number[];
}

export interface SketchEdit {
  /** 没涂的地方:'auto' = 照旧由程序定,'sea' = 都是海 */
  rest: 'auto' | 'sea';
  /** 笔画,按先后 */
  strokes: SketchStroke[];
}

/** 最多多少笔、一笔最多多少个点 */
export const SKETCH_MAX_STROKES = 400;
export const SKETCH_MAX_PTS = 2000;
/** 笔的半径范围(世界坐标) */
export const SKETCH_R: readonly [number, number] = [4, 128];
/** 三档笔(小 / 中 / 大)的半径(世界坐标) */
export const SKETCH_SIZES: readonly number[] = [16, 32, 64];

const KINDS: readonly SketchKind[] = ['land', 'mountain', 'sea', 'erase'];
const VALUE: Record<SketchKind, number> = { land: SKETCH_LAND, mountain: SKETCH_MOUNTAIN, sea: SKETCH_SEA, erase: SKETCH_NONE };

// ---------------------------------------------------------------------------
// 清理(读档、加一笔时用)

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * 清理一笔:种类不认识、半径或坐标不是有限数、一个点也没有的 = null。
 * 坐标取整,y 夹在两极之间,x 和改地形的折线一样(第一个点取模到 [0, TERRAIN_W),之后挪到离上一个点最近的那一圈);
 * 半径夹到 SKETCH_R(保留一位小数),最多 SKETCH_MAX_PTS 个点。本来就合格的原样返回(同一个对象)
 */
export function cleanSketchStroke(x: unknown): SketchStroke | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const kind = o.kind as SketchKind;
  if (!KINDS.includes(kind) || !Array.isArray(o.pts) || o.pts.length < 2) return null;
  const raw = o.pts as unknown[];
  const take = Math.min(raw.length, SKETCH_MAX_PTS * 2) & ~1;
  const pts: number[] = [];
  for (let i = 0; i < take; i += 2) {
    const px = num(raw[i]);
    const py = num(raw[i + 1]);
    if (px === null || py === null) return null;
    pts.push(i ? nearLon(px, pts[i - 2]) : wrapLon(px), Math.round(clamp(py, 0, TERRAIN_H)));
  }
  const r0 = num(o.r);
  if (r0 === null) return null;
  const r = Math.round(clamp(r0, SKETCH_R[0], SKETCH_R[1]) * 10) / 10;
  const same = Object.keys(o).length === 3 && r === o.r && raw.length === pts.length && pts.every((v, i) => v === raw[i]);
  return same ? (x as SketchStroke) : { kind, r, pts };
}

/**
 * 清理一份草图:不是对象的 = null;笔画逐笔过 cleanSketchStroke(不合格的丢掉,最多 SKETCH_MAX_STROKES 笔);
 * rest 不认识的当 'auto'。一笔也没有、没涂的又交给程序 = null(和没画一样)。本来就合格的原样返回
 */
export function cleanSketch(x: unknown): SketchEdit | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const rest = o.rest === 'sea' ? 'sea' : 'auto';
  const list = Array.isArray(o.strokes) ? (o.strokes as unknown[]) : [];
  const strokes: SketchStroke[] = [];
  let same = rest === o.rest && list === o.strokes && list.length <= SKETCH_MAX_STROKES && Object.keys(o).length === 2;
  for (const s of list) {
    if (strokes.length >= SKETCH_MAX_STROKES) break;
    const v = cleanSketchStroke(s);
    if (v) strokes.push(v);
    if (v !== s) same = false;
  }
  if (!strokes.length && rest === 'auto') return null;
  return same ? (x as SketchEdit) : { rest, strokes };
}

/** 两份草图是不是一样(逐笔逐字段比;都没有也算一样) */
export function sameSketch(a: SketchEdit | null | undefined, b: SketchEdit | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.rest !== b.rest || a.strokes.length !== b.strokes.length) return false;
  return a.strokes.every((x, i) => {
    const y = b.strokes[i];
    return x.kind === y.kind && x.r === y.r && x.pts.length === y.pts.length && x.pts.every((v, j) => v === y.pts[j]);
  });
}

// ---------------------------------------------------------------------------
// 涂到格子上

/** 一笔涂到格子图上:离折线不超过半径的格子(按格子中心算)改成这支笔的值;x 绕一圈取模 */
function paint(grid: Sketch, s: SketchStroke) {
  const v = VALUE[s.kind];
  const r = s.r / CELL;
  const r2 = r * r;
  const n = s.pts.length >> 1;
  // 一段 a → b(格子坐标);只有一个点 = a、b 重合,涂一个圆
  const last = n - 1;
  for (let k = 0; k < Math.max(1, last); k++) {
    const kb = Math.min(k + 1, last);
    const ax = s.pts[2 * k] / CELL;
    const ay = s.pts[2 * k + 1] / CELL;
    const bx = s.pts[2 * kb] / CELL;
    const by = s.pts[2 * kb + 1] / CELL;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const x0 = Math.floor(Math.min(ax, bx) - r);
    const x1 = Math.ceil(Math.max(ax, bx) + r);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const y1 = Math.min(SKETCH_H - 1, Math.ceil(Math.max(ay, by) + r));
    for (let gy = y0; gy <= y1; gy++) {
      const cy = gy + 0.5;
      for (let gx = x0; gx <= x1; gx++) {
        const cx = gx + 0.5;
        const t = len2 > 0 ? clamp(((cx - ax) * dx + (cy - ay) * dy) / len2, 0, 1) : 0;
        const ex = cx - (ax + t * dx);
        const ey = cy - (ay + t * dy);
        if (ex * ex + ey * ey > r2) continue;
        grid[gy * SKETCH_W + (((gx % SKETCH_W) + SKETCH_W) % SKETCH_W)] = v;
      }
    }
  }
}

/**
 * 草图涂成的格子图(生成用)。没有草图、或者涂完一格陆地 / 海 / 山地也没有(没涂的又交给程序)= null,和没画一样。
 * rest = 'sea' 时没涂的格子当海:什么也没画就是一颗全是海的星球
 */
export function sketchGrid(edit: SketchEdit | null | undefined): Sketch | null {
  if (!edit) return null;
  const grid = new Uint8Array(SKETCH_W * SKETCH_H);
  for (const s of edit.strokes) paint(grid, s);
  if (edit.rest === 'sea') {
    for (let i = 0; i < grid.length; i++) if (grid[i] === SKETCH_NONE) grid[i] = SKETCH_SEA;
    return grid;
  }
  return sketchUsed(grid) ? grid : null;
}

/** 世界坐标 (x, y)(主图 width × height)落在草图的哪一格,取那一格的值;x 绕一圈取模 */
export function sketchAt(sketch: Sketch, x: number, y: number, width: number, height: number): number {
  let gx = Math.floor((x / width) * SKETCH_W);
  gx = ((gx % SKETCH_W) + SKETCH_W) % SKETCH_W;
  const gy = Math.min(SKETCH_H - 1, Math.max(0, Math.floor((y / height) * SKETCH_H)));
  return sketch[gy * SKETCH_W + gx];
}

/** 每个地块中心落在草图的哪一格,取那一格的值 */
export function sketchCells(mesh: Mesh, sketch: Sketch): Uint8Array {
  const { n, x, y, width, height } = mesh;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = sketchAt(sketch, x[i], y[i], width, height);
  return out;
}

/** 格子图上有没有涂过东西 */
export function sketchUsed(sketch: Sketch | null | undefined): sketch is Sketch {
  return !!sketch && sketch.some((v) => v !== SKETCH_NONE);
}

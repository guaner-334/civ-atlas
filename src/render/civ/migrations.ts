/**
 * 文明叠加层 · 大迁徙的路线:一支举族远走的队伍从老家走到落脚地的箭头。数据全是推演记下的(civ.migrations、史事 trek),不改推演。
 *
 *   - 一次大迁徙一条箭头:沿路线(州治所连起来、再抹圆),这一族的颜色压深一点,尾细头粗,外面一圈浅色边(手绘纸色、写实白色)
 *   - 走的那些年随年份往前长(箭头就是队伍的头,按到每一州的那一刻插);到了以后整条留 LINGER 年,再用 FADE 年淡完
 *   - 起点写族名(粗)和动身那年,到了以后箭头旁再写到达那年;路上洗劫过的州、到了攻进去的地方各画一个小火苗,
 *     放大到 NOTE_K 倍起旁边写"1905 掠某州""1910 破某州"
 *   - 字躲开地名、城镇符号和地图上盖着的界面;起点出了画面时,族名和年份贴着画面边写在看得到的那一段开头
 *   - 粗细按世界单位定(缩放 1 倍时),放大 k 倍时 × k^GROW(4 倍约 1.9 倍):比地图放大得慢;字按 CSS 像素定
 *
 * 只在国家、民族填色上画(不填、信仰、时代、管辖不画)。画在文字层上:国界、填色上面,城镇符号和地名下面
 * (CivLayer 的文字层、导出图片、回放视频和长图的文字那一步;地球仪每帧按正射投影画,见 drawGlobeTreks)。
 */
import type { Civ, Migration, Year } from '../../gen/civ/types';
import type { World } from '../../gen/world';
import { ownersAt } from '../../gen/civ/timeline';
import { cultureLabel, regionLabel } from '../../gen/civ/story/display';
import { yearShort, type Era } from '../../gen/era';
import { nearX } from '../common';
import { civFillOf } from './show';
import type { CivDrawParams, CivStyle } from './overlay';
import { pathToCanvas, placedMarkBox, toCanvas, type LabelView, type Placement } from '../labels/draw';
import { glyphBox } from '../labels/layout';
import { familyFor, fontCss } from '../labels/fonts';
import { clipOutline, projectLinePts, type Projector } from '../projection';
import { shiftsIn } from './warfare';

// ---------------------------------------------------------------------------
// 1. 数据:路线、走到哪了、路上的事

/** 到了以后整条留多少年、再用多少年淡完 */
export const LINGER = 20;
export const FADE = 30;

/** 一条路线抹圆以后的样子(世界坐标,x 按相邻两点接着走,可能伸出 [0, 宽)) */
export interface TrekPath {
  /** 抹圆后的折线 x, y 交错 */
  pts: Float64Array;
  /** 每一点到起点的路程(世界单位) */
  s: Float64Array;
  /** 路线里每一州(Migration.route 的下标)在抹圆后的折线上对应的路程 */
  node: Float64Array;
  /** 全长 */
  L: number;
}

/** 路上的事:洗劫(raid,史事 trek n = 1)、到了攻进去落脚(breach,从那一国手里占下的州里最大的一州) */
export interface TrekMark {
  kind: 'raid' | 'breach';
  year: Year;
  region: number;
  /** 在路线上的路程(破:落脚的那一头) */
  s: number;
}

/** 某一年地图上的一支 */
export interface TrekShown {
  /** 第几次大迁徙(civ.migrations 的下标) */
  m: number;
  M: Migration;
  path: TrekPath;
  /** 走到哪了(路程;到了 = 全长) */
  upto: number;
  arrived: boolean;
  /** 不透明度:走的时候、到了以后 LINGER 年里是 1,之后 FADE 年淡完 */
  alpha: number;
  /** 到这一年为止的路上的事(按先后) */
  marks: TrekMark[];
}

/** 抹圆:端点不动、中间的点和前后两点取平均,再切角(Chaikin)几轮 */
function smooth(raw: number[], rounds: number): number[] {
  const n = raw.length >> 1;
  let p = raw.slice();
  for (let i = 1; i < n - 1; i++) {
    p[2 * i] = (raw[2 * i - 2] + raw[2 * i] + raw[2 * i + 2]) / 3;
    p[2 * i + 1] = (raw[2 * i - 1] + raw[2 * i + 1] + raw[2 * i + 3]) / 3;
  }
  for (let r = 0; r < rounds; r++) {
    const m = p.length >> 1;
    if (m < 3) break;
    const q: number[] = [p[0], p[1]];
    for (let i = 0; i < m - 1; i++) {
      const x0 = p[2 * i];
      const y0 = p[2 * i + 1];
      const x1 = p[2 * i + 2];
      const y1 = p[2 * i + 3];
      q.push(x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25, x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75);
    }
    q.push(p[2 * m - 2], p[2 * m - 1]);
    p = q;
  }
  return p;
}

/** 折线(x, y 交错)每一点到起点的路程 */
function cumulative(p: ArrayLike<number>): Float64Array {
  const n = p.length >> 1;
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++) s[i] = s[i - 1] + Math.hypot(p[2 * i] - p[2 * i - 2], p[2 * i + 1] - p[2 * i - 1]);
  return s;
}

/** 路线:州治所连起来(x 接着走)→ 抹圆;每一州按原来折线上的路程比例对到抹圆后的折线上 */
export function trekPathOf(civ: Civ, world: World, M: Migration): TrekPath | null {
  const { x, y } = world.mesh;
  const W = world.width;
  const R = civ.regions.count;
  const raw: number[] = [];
  for (const r of M.route) {
    const c = r >= 0 && r < R ? civ.regions.seat[r] : -1;
    if (c < 0) {
      // 对不上的州(不该有):原地踏步,下标照旧一一对应
      if (raw.length) raw.push(raw[raw.length - 2], raw[raw.length - 1]);
      continue;
    }
    raw.push(raw.length ? nearX(x[c], raw[raw.length - 2], W) : x[c], y[c]);
  }
  if (raw.length < 4 || raw.length >> 1 !== M.route.length) return null;
  const rs = cumulative(raw);
  const rawL = rs[rs.length - 1];
  const pts = Float64Array.from(smooth(raw, 4));
  const s = cumulative(pts);
  const L = s[s.length - 1];
  const node = new Float64Array(rs.length);
  for (let j = 0; j < rs.length; j++) node[j] = rawL > 0 ? (rs[j] / rawL) * L : 0;
  return { pts, s, node, L };
}

const pathCache = new WeakMap<Civ, { world: World; list: (TrekPath | null | undefined)[] }>();

/** 第 m 次大迁徙的路线(按 civ、world 缓存) */
export function trekPath(civ: Civ, world: World, m: number): TrekPath | null {
  let c = pathCache.get(civ);
  if (!c || c.world !== world) pathCache.set(civ, (c = { world, list: [] }));
  let hit = c.list[m];
  if (hit === undefined) {
    const M = civ.migrations?.[m];
    hit = c.list[m] = M ? trekPathOf(civ, world, M) : null;
  }
  return hit;
}

/** 走到第 t 年时到了路线上的哪里(路程):按到每一州的那一刻线性插 */
export function trekReach(M: Migration, path: TrekPath, t: Year): number {
  const Y = M.years;
  const n = Math.min(Y.length, path.node.length);
  if (!n || t <= Y[0]) return 0;
  if (t >= Y[n - 1]) return path.L;
  let j = 0;
  while (j + 1 < n && Y[j + 1] <= t) j++;
  const f = (t - Y[j]) / Math.max(1e-9, Y[j + 1] - Y[j]);
  return path.node[j] + (path.node[j + 1] - path.node[j]) * f;
}

/** 到了以后的不透明度(还在路上 = 1);淡完 = 0 */
export function trekAlpha(M: Migration, t: Year): number {
  if (M.settled === undefined || t < M.settled) return 1;
  const age = t - M.settled;
  return age <= LINGER ? 1 : Math.max(0, 1 - (age - LINGER) / FADE);
}

/** 这一年地图上有没有这一支(动身以后、淡完以前) */
export function trekOnMap(M: Migration, t: Year): boolean {
  return t >= M.year && trekAlpha(M, t) > 0;
}

const marksCache = new WeakMap<Civ, TrekMark[][]>();

/** 每一次大迁徙路上的事(洗劫、到了攻进去的那一州),按先后;路程按 trekPath 对上 */
function trekMarks(civ: Civ, world: World): TrekMark[][] {
  const hit = marksCache.get(civ);
  if (hit) return hit;
  const list = civ.migrations ?? [];
  const out: TrekMark[][] = list.map(() => []);
  // 立的国 → 第几次;到了以后那一仗(cause = trek)的对手
  const byPolity = new Map<number, number>();
  const foeOf = new Map<number, number>();
  for (const e of civ.annals) {
    if (e.kind === 'trek' && e.war >= 0 && e.war < list.length) {
      const M = list[e.war];
      if (e.n === 1 && e.region >= 0) {
        const j = M.route.indexOf(e.region);
        const path = trekPath(civ, world, e.war);
        if (j >= 0 && path) out[e.war].push({ kind: 'raid', year: e.year, region: e.region, s: path.node[j] });
      } else if (e.n === 2 && e.b >= 0) byPolity.set(e.b, e.war);
    } else if (e.kind === 'war' && e.cause === 'trek' && byPolity.has(e.a) && !foeOf.has(byPolity.get(e.a)!)) foeOf.set(byPolity.get(e.a)!, e.b);
  }
  // 攻进去:立国那一刻从对手手里占下的州里最大的一州(和编年史"入某国,破某州"同一个算法)
  for (const [m, foe] of foeOf) {
    const M = list[m];
    const path = trekPath(civ, world, m);
    if (M.settled === undefined || M.polity === undefined || !path) continue;
    const now = ownersAt(civ, M.settled).polity;
    const was = ownersAt(civ, M.settled - 1 / 512).polity;
    let best = -1;
    for (let r = 0; r < now.length; r++) {
      if (now[r] !== M.polity || was[r] !== foe) continue;
      if (best < 0 || civ.regions.capacity[r] > civ.regions.capacity[best]) best = r;
    }
    if (best >= 0) out[m].push({ kind: 'breach', year: M.settled, region: best, s: path.L });
  }
  for (const l of out) l.sort((a, b) => a.year - b.year);
  marksCache.set(civ, out);
  return out;
}

const sceneCache = new WeakMap<Civ, { world: World; year: Year; list: TrekShown[] }>();

/** 某一年地图上的几支(按 civ 缓存最近的一年:回放时每帧一年,文字层、地球仪共用) */
export function trekScene(civ: Civ, world: World, year: Year): TrekShown[] {
  const hit = sceneCache.get(civ);
  if (hit && hit.year === year && hit.world === world) return hit.list;
  const list: TrekShown[] = [];
  const all = civ.migrations ?? [];
  for (let m = 0; m < all.length; m++) {
    const M = all[m];
    if (!trekOnMap(M, year)) continue;
    const path = trekPath(civ, world, m);
    if (!path) continue;
    const arrived = M.settled !== undefined && year >= M.settled;
    list.push({
      m,
      M,
      path,
      upto: arrived ? path.L : trekReach(M, path, year),
      arrived,
      alpha: trekAlpha(M, year),
      marks: trekMarks(civ, world)[m].filter((k) => k.year <= year),
    });
  }
  sceneCache.set(civ, { world, year, list });
  return list;
}

/** 开着国家或民族填色、这个世界有大迁徙 */
export function treksShown(p: Pick<CivDrawParams, 'civ' | 'show'>): boolean {
  const f = civFillOf(p.show);
  return (f === 'polities' || f === 'cultures') && !!p.civ.migrations?.length;
}

// ---------------------------------------------------------------------------
// 2. 样子

/** 粗细(世界单位,缩放 1 倍时;画的时候 × 一个世界单位是几个画布像素):尾、头、浅色边、亮一下时的光边 */
export const TREK_SIZE = { tail: 2.5, head: 9.7, halo: 3, glow: 13.6 };
/** 放大 k 倍时粗细 × k^GROW(4 倍约 1.9 倍) */
const GROW = 0.45;
/** 放大到这个倍数起,火苗旁写"1905 掠某州" */
export const NOTE_K = 1.5;
/** 字号(CSS 像素):族名(放大到 NOTE_K 倍起大一号)、年份、火苗旁的字 */
const TEXT = { name: 15, nameZoom: 16, year: 12, note: 12, noteZoom: 13 };

/** 颜色:箭头(族色压深一点)、字(再深一些)、浅色边(手绘纸色、写实白色)、亮一下时的光边 */
export interface TrekLook {
  fill: string;
  ink: string;
  halo: string;
  glow: string;
  flame: string;
}

function hsl(rgb: readonly number[]): [number, number, number] {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslCss(h: number, s: number, l: number): string {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (t: number) => {
    t = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    const v = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    return Math.round(v * 255);
  };
  return `rgb(${ch(h + 1 / 3)},${ch(h)},${ch(h - 1 / 3)})`;
}

/** 这一族的箭头颜色:族色压深(亮度 × 0.78)、浓一点;字再深三成 */
export function trekLook(rgb: readonly number[], style: CivStyle): TrekLook {
  const [h, s, l] = hsl(rgb);
  const fl = Math.min(0.45, Math.max(0.2, l * 0.78));
  const fs = s > 0.05 ? Math.min(0.9, s + 0.2) : s;
  const fantasy = style === 'fantasy';
  return {
    fill: hslCss(h, fs, fl),
    ink: hslCss(h, Math.min(0.95, fs + 0.03), fl * 0.68),
    halo: fantasy ? 'rgba(250,244,228,0.96)' : 'rgba(255,255,255,0.95)',
    glow: fantasy ? '#fff3c4' : '#ffffff',
    flame: '#d4392b',
  };
}

// ---------------------------------------------------------------------------
// 3. 画法(画布像素)

/** 折线(画布像素)上 0…d 那一段的终点 */
function pointAt(p: ArrayLike<number>, s: ArrayLike<number>, d: number): [number, number] {
  const n = s.length;
  if (n === 1 || d <= 0) return [p[0], p[1]];
  let i = 1;
  while (i < n - 1 && s[i] < d) i++;
  const t = Math.min(1, (d - s[i - 1]) / Math.max(1e-9, s[i] - s[i - 1]));
  return [p[2 * i - 2] + (p[2 * i] - p[2 * i - 2]) * t, p[2 * i - 1] + (p[2 * i + 1] - p[2 * i - 1]) * t];
}

/** 折线 a…b 那一段(按路程) */
function cutPath(p: ArrayLike<number>, s: ArrayLike<number>, a: number, b: number): number[] {
  const out: number[] = [...pointAt(p, s, a)];
  for (let i = 0; i < s.length; i++) if (s[i] > a && s[i] < b) out.push(p[2 * i], p[2 * i + 1]);
  out.push(...pointAt(p, s, b));
  return out;
}

/** 箭头的头多长、多宽(画布像素):w1 = 头那一端的箭身粗细,L = 整条多长 */
function headSize(w1: number, L: number): { len: number; half: number } {
  return { len: Math.min(w1 * 2.3, L * 0.45), half: w1 * 1.35 };
}

/**
 * 尾细头粗的箭身 + 箭头(一个封闭的形状):pts = 画布像素的折线(x, y 交错),w0 / w1 = 尾、头两端的粗细。
 * 粗细沿路程按 t^0.7 变(头那一截粗得快);head = false 只画箭身(地球仪上头转到背面时)。太短 = null
 */
export function arrowPath(pts: ArrayLike<number>, w0: number, w1: number, head = true): Path2D | null {
  const s = cumulative(pts);
  const L = s[s.length - 1];
  if (!(L > 0.5)) return null;
  const hd = head ? headSize(w1, L) : { len: 0, half: 0 };
  const body = cutPath(pts, s, 0, Math.max(0.5, L - hd.len * 0.92));
  const bs = cumulative(body);
  const BL = bs[bs.length - 1] || 1;
  const n = body.length >> 1;
  const left: number[] = [];
  const right: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let dx = body[2 * b] - body[2 * a];
    let dy = body[2 * b + 1] - body[2 * a + 1];
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const w = (w0 + (w1 - w0) * Math.pow(bs[i] / BL, 0.7)) / 2;
    left.push(body[2 * i] - dy * w, body[2 * i + 1] + dx * w);
    right.push(body[2 * i] + dy * w, body[2 * i + 1] - dx * w);
  }
  const path = new Path2D();
  path.moveTo(left[0], left[1]);
  for (let i = 2; i < left.length; i += 2) path.lineTo(left[i], left[i + 1]);
  if (head) {
    const tx = pts[pts.length - 2];
    const ty = pts[pts.length - 1];
    let dx = tx - body[body.length - 2];
    let dy = ty - body[body.length - 1];
    const d = Math.hypot(dx, dy) || 1;
    dx /= d;
    dy /= d;
    const bx = tx - dx * hd.len;
    const by = ty - dy * hd.len;
    path.lineTo(bx - dy * hd.half, by + dx * hd.half);
    path.lineTo(tx, ty);
    path.lineTo(bx + dy * hd.half, by - dx * hd.half);
  }
  for (let i = right.length - 2; i >= 0; i -= 2) path.lineTo(right[i], right[i + 1]);
  path.closePath();
  return path;
}

/** 小火苗(洗劫、攻进去):x, y = 中心,k = 大小倍数(1 ≈ 11 CSS 像素高 × dpr) */
function flamePath(x: number, y: number, k: number): Path2D {
  const f = new Path2D();
  f.moveTo(x, y - 7 * k);
  f.bezierCurveTo(x + 4.5 * k, y - 2.5 * k, x + 4.2 * k, y + 3.5 * k, x, y + 4 * k);
  f.bezierCurveTo(x - 4.2 * k, y + 3.5 * k, x - 4.5 * k, y - 1.5 * k, x - 1.2 * k, y - 4 * k);
  f.bezierCurveTo(x - 0.8 * k, y - 1.5 * k, x + 0.6 * k, y - 1 * k, x, y - 7 * k);
  f.closePath();
  return f;
}

type Box = readonly [number, number, number, number];

/** 字往哪边摆:above 正上方居中、below 正下方居中、right 右边左对齐、left 左边右对齐 */
type Side = 'above' | 'below' | 'right' | 'left';

/** 一块字(一行或两行)的摆法和占的框 */
interface TextBlock {
  lines: { text: string; px: number; weight: number }[];
  /** 每一行的基线(画布像素)、对齐 */
  ys: number[];
  x: number;
  align: CanvasTextAlign;
  box: Box;
}

/** 字摆在 (x, y) 旁边 gap 处:几行从上往下排 */
function blockAt(ctx: CanvasRenderingContext2D, lines: TextBlock['lines'], family: string, x: number, y: number, side: Side, gap: number): TextBlock {
  const ws = lines.map((l) => {
    ctx.font = fontCss(family, l.weight, l.px);
    return ctx.measureText(l.text).width;
  });
  const W = Math.max(...ws);
  const lh = lines.map((l) => l.px * 1.12);
  const H = lh.reduce((a, b) => a + b, 0);
  let top: number;
  let x0: number;
  let align: CanvasTextAlign;
  if (side === 'above' || side === 'below') {
    top = side === 'above' ? y - gap - H : y + gap;
    x0 = x - W / 2;
    align = 'center';
  } else {
    top = y - H / 2;
    x0 = side === 'right' ? x + gap : x - gap - W;
    align = side === 'right' ? 'left' : 'right';
  }
  const ys: number[] = [];
  let acc = top;
  for (let i = 0; i < lines.length; i++) {
    acc += lh[i];
    ys.push(acc - lines[i].px * 0.2);
  }
  return { lines, ys, x: align === 'center' ? x : align === 'left' ? x0 : x0 + W, align, box: [x0, top, x0 + W, top + H] };
}

const hit = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** 已经占住的地方(画布像素):地名的每个字、城镇符号、盖着的界面、前面摆好的字 */
class Taken {
  boxes: Box[] = [];
  constructor(placed: Placement | null | undefined, blocked: readonly Box[] | undefined) {
    if (placed) {
      for (const l of placed.labels) for (const g of l.glyphs) this.boxes.push(glyphBox(g, l.px, 1));
      for (const m of placed.marks) this.boxes.push(placedMarkBox(m));
    }
    if (blocked) this.boxes.push(...blocked);
  }
  /** 压着别的东西的面积(画布像素²;不压 = 0) */
  overlap(b: Box): number {
    let s = 0;
    for (const x of this.boxes) if (hit(x, b)) s += (Math.min(x[2], b[2]) - Math.max(x[0], b[0])) * (Math.min(x[3], b[3]) - Math.max(x[1], b[1]));
    return s;
  }
}

/** 按顺序试几种摆法,头一个不压东西的;都压着 = 压得最少的那种(force)或不摆(null) */
function pickBlock(taken: Taken, tries: (() => TextBlock)[], force: boolean): TextBlock | null {
  let best: TextBlock | null = null;
  let least = Infinity;
  for (const t of tries) {
    const b = t();
    const o = taken.overlap(b.box);
    if (o === 0) return b;
    if (o < least) [best, least] = [b, o];
  }
  return force ? best : null;
}

function drawBlock(ctx: CanvasRenderingContext2D, b: TextBlock, family: string, ink: string, halo: string, haloW: number) {
  ctx.textAlign = b.align;
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  b.lines.forEach((l, i) => {
    ctx.font = fontCss(family, l.weight, l.px);
    ctx.strokeStyle = halo;
    ctx.lineWidth = haloW;
    ctx.strokeText(l.text, b.x, b.ys[i]);
    ctx.fillStyle = ink;
    ctx.fillText(l.text, b.x, b.ys[i]);
  });
}

/** 折线(画布像素)在第 i 点附近的走向:横着走(|dx| ≥ |dy|)还是竖着走 */
function across(p: ArrayLike<number>, i: number, span: number): boolean {
  const n = p.length >> 1;
  const a = Math.max(0, i - span);
  const b = Math.min(n - 1, i + span);
  return Math.abs(p[2 * b] - p[2 * a]) >= Math.abs(p[2 * b + 1] - p[2 * a + 1]);
}

/** 一支在画布上的样子:箭身的折线(画布像素)、起点、路上的事的位置;画法共用(主图、导出、地球仪) */
export interface TrekCanvas {
  t: TrekShown;
  /** 走过的那一段(画布像素,x, y 交错);还没出发 = 只有起点 */
  pts: number[];
  /** 头在不在(地球仪上转到背面 = false) */
  head: boolean;
  /** 起点(画布像素;看不见 = null) */
  start: [number, number] | null;
  /** 路上的事(画布像素;看不见的不给) */
  marks: { k: TrekMark; x: number; y: number }[];
}

export interface TrekDrawOpts {
  /** 已经排好的地名、城镇符号(画布像素):字躲开它们 */
  placed?: Placement | null;
  /** 地图上盖着的界面(画布像素 [x0, y0, x1, y1]):字不放在下面;起点在下面算"出了画面" */
  blocked?: readonly Box[];
  /** 纪年(年份照它写;不给 = 第几年) */
  era?: Era | null;
  /** 点编年史那一条时亮一下的那一支(m)和这一刻有多亮(0–1) */
  glow?: { m: number; a: number } | null;
  /** 画布大小(画布像素):起点出了画面时字贴着边写;不给 = 不贴 */
  w?: number;
  h?: number;
}

/**
 * 画几支(画布像素,已经投好):先画箭身(光边 → 浅色边 → 族色),再画火苗,最后写字(躲开地名、符号、界面)。
 * u = 一个世界单位是几个画布像素(已乘上放大的 k^GROW),dpr = 画布像素 / CSS 像素,zoom = 地图放大倍数(决定写不写火苗旁的字)
 */
export function paintTreks(ctx: CanvasRenderingContext2D, civ: Civ, list: readonly TrekCanvas[], u: number, dpr: number, zoom: number, style: CivStyle, opt: TrekDrawOpts = {}): void {
  if (!list.length) return;
  const family = familyFor(style === 'fantasy' ? 'fantasy' : 'realistic');
  const w0 = TREK_SIZE.tail * u;
  const w1 = TREK_SIZE.head * u;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const looks = list.map((c) => trekLook(civ.cultures[c.t.M.culture]?.color ?? [128, 128, 128], style));
  // 箭身
  list.forEach((c, i) => {
    const shape = c.pts.length >= 4 ? arrowPath(c.pts, w0, w1, c.head) : null;
    if (!shape) return;
    const look = looks[i];
    const g = opt.glow && opt.glow.m === c.t.m ? opt.glow.a : 0;
    if (g > 0.01) {
      ctx.globalAlpha = c.t.alpha * g * 0.6;
      ctx.strokeStyle = look.glow;
      ctx.lineWidth = TREK_SIZE.glow * u;
      ctx.stroke(shape);
      ctx.fillStyle = look.glow;
      ctx.fill(shape);
    }
    ctx.globalAlpha = c.t.alpha;
    ctx.strokeStyle = look.halo;
    ctx.lineWidth = TREK_SIZE.halo * u;
    ctx.stroke(shape);
    ctx.fillStyle = look.fill;
    ctx.fill(shape);
  });
  // 火苗
  const noted = zoom >= NOTE_K;
  const fk = (noted ? 1.5 : 1.15) * dpr;
  list.forEach((c, i) => {
    ctx.globalAlpha = c.t.alpha;
    for (const mk of c.marks) {
      const f = flamePath(mk.x, mk.y, fk);
      ctx.strokeStyle = looks[i].halo;
      ctx.lineWidth = 2.2 * dpr;
      ctx.stroke(f);
      ctx.fillStyle = looks[i].flame;
      ctx.fill(f);
    }
  });
  // 字:起点的族名和年份、到达那年、火苗旁的字(放大以后)
  const taken = new Taken(opt.placed, opt.blocked);
  const inView = (x: number, y: number, pad: number) =>
    (opt.w === undefined || (x > pad && x < opt.w - pad && y > pad && opt.h !== undefined && y < opt.h - pad)) &&
    !(opt.blocked ?? []).some((b) => x > b[0] - pad && x < b[2] + pad && y > b[1] - pad && y < b[3] + pad);
  const namePx = (noted ? TEXT.nameZoom : TEXT.name) * dpr;
  const yearPx = TEXT.year * dpr;
  const notePx = (noted ? TEXT.noteZoom : TEXT.note) * dpr;
  const headGap = w1 * 0.5 + 6 * dpr;
  list.forEach((c, i) => {
    const look = looks[i];
    ctx.globalAlpha = c.t.alpha;
    const M = c.t.M;
    const lines = [
      { text: cultureLabel(civ.cultures[M.culture]), px: namePx, weight: 700 },
      { text: yearShort(M.year, opt.era), px: yearPx, weight: 500 },
    ];
    const P = c.pts;
    const n = P.length >> 1;
    // 起点:横着走的写在正上方,竖着走的写在右边(压着东西就换一边);起点出了画面,贴着画面边写在看得到的那一段开头
    let start = c.start;
    let clamped = false;
    if ((!start || !inView(start[0], start[1], 8 * dpr)) && opt.w !== undefined) {
      start = null;
      for (let j = 0; j < n; j++) {
        if (inView(P[2 * j], P[2 * j + 1], 24 * dpr)) {
          start = [P[2 * j], P[2 * j + 1]];
          clamped = true;
          break;
        }
      }
    }
    if (start) {
      const [sx, sy] = start;
      let b: TextBlock | null;
      if (clamped) {
        const side: Side = opt.w !== undefined && sx > opt.w / 2 ? 'left' : 'right';
        b = pickBlock(taken, [() => blockAt(ctx, lines, family, sx, sy - 22 * dpr, side, 4 * dpr), () => blockAt(ctx, lines, family, sx, sy + 22 * dpr, side, 4 * dpr)], true);
      } else {
        const flat = n < 2 || across(P, 0, 8);
        const order: Side[] = flat ? ['above', 'below', 'right', 'left'] : ['right', 'left', 'below', 'above'];
        // 正上方的那一块压低一点:年份那一行落在尾巴起头那里(尾巴细,字有浅色边)
        const gapOf = (sd: Side) => (sd === 'above' ? -6 : sd === 'below' ? 5 : 12) * dpr;
        b = pickBlock(
          taken,
          order.map((sd) => () => blockAt(ctx, lines, family, sx, sy, sd, gapOf(sd))),
          true,
        );
      }
      if (b) {
        drawBlock(ctx, b, family, look.ink, look.halo, 3.6 * dpr);
        taken.boxes.push(b.box);
      }
    }
    // 到达那年:写在头旁边(横着走的写在上方,竖着走的写在右边)
    if (c.t.arrived && c.head && n >= 2) {
      const tx = P[2 * n - 2];
      const ty = P[2 * n - 1];
      const flat = across(P, n - 1, 8);
      const ln = [{ text: yearShort(M.settled!, opt.era), px: yearPx, weight: 500 }];
      const order: Side[] = flat ? ['above', 'below', 'right', 'left'] : ['right', 'left', 'above', 'below'];
      const b = pickBlock(
        taken,
        order.map((sd) => () => blockAt(ctx, ln, family, tx, ty, sd, headGap)),
        true,
      );
      if (b && inView(tx, ty, 0)) {
        drawBlock(ctx, b, family, look.ink, look.halo, 3.6 * dpr);
        taken.boxes.push(b.box);
      }
    }
    // 火苗旁的字(放大到 NOTE_K 倍起):横着走的写在下面,竖着走的写在右边;压着东西就不写
    if (noted) {
      for (const mk of c.marks) {
        let j = 0;
        let best = Infinity;
        for (let q = 0; q < n; q++) {
          const d = (P[2 * q] - mk.x) ** 2 + (P[2 * q + 1] - mk.y) ** 2;
          if (d < best) [best, j] = [d, q];
        }
        const flat = n < 2 || across(P, j, 6);
        const text = `${yearShort(mk.k.year, opt.era)} ${mk.k.kind === 'raid' ? '掠' : '破'}${regionLabel(civ, mk.k.region)}`;
        const ln = [{ text, px: notePx, weight: 500 }];
        const fg = 11 * dpr;
        const order: Side[] = flat ? ['below', 'above', 'right', 'left'] : ['right', 'left', 'below', 'above'];
        const b = pickBlock(
          taken,
          order.map((sd) => () => blockAt(ctx, ln, family, mk.x, mk.y, sd, fg)),
          false,
        );
        if (!b) continue;
        drawBlock(ctx, b, family, look.ink, look.halo, 3.2 * dpr);
        taken.boxes.push(b.box);
      }
    }
  });
  ctx.restore();
}

/** 世界坐标的路线(x 展开)截到 upto,画布上的事的位置跟着截 */
function cutWorld(t: TrekShown): number[] {
  return cutPath(t.path.pts, t.path.s, 0, Math.max(0, t.upto));
}

/** 破城的火苗放在头后面一点(不压在箭头底下):退回的路程(世界单位) */
function markS(t: TrekShown, k: TrekMark, back: number): number {
  return k.kind === 'breach' ? Math.max(0, t.path.L - back) : k.s;
}

/**
 * 画在文字层上(画布像素;CivLayer 的文字层、导出图片、回放视频的文字那一步)。
 * pj = 弯边投影(和 lv.proj 同一个投影;不出外轮廓)。返回画了几支(东西相连伸出画布、在另一圈再画的算多支)
 */
export function drawTreks(ctx: CanvasRenderingContext2D, p: CivDrawParams, lv: LabelView, pj: Projector | null, opt: TrekDrawOpts = {}): number {
  if (!treksShown(p)) return 0;
  const scene = trekScene(p.civ, p.world, p.year);
  if (!scene.length) return 0;
  const k = Math.max(1, lv.k);
  const u = (lv.scale / k) * k ** GROW;
  // 头的长度(世界单位):破城的火苗退到头后面
  const back = (TREK_SIZE.head * 2.3 * 1.3 * u) / lv.scale;
  const out: TrekCanvas[] = [];
  for (const t of scene) {
    const w = cutWorld(t);
    const marks = t.marks.map((mk) => ({ mk, at: pointAt(t.path.pts, t.path.s, markS(t, mk, back)) }));
    if (pj) {
      // 弯边投影:整条按起点那一刻的经度差连续投过去;伸出 ±180° 的那一截在另一边再画一份(和战线一样,见 projectLinePts),
      // 起点、火苗跟着同一份挪
      const v = { s: lv.scale, ox: lv.ox, oy: lv.oy };
      const k2 = (2 * Math.PI) / pj.W;
      const r0 = pj.rel(w[0]);
      let lo = r0;
      let hi = r0;
      for (let i = 2; i < w.length; i += 2) {
        const r = r0 + (w[i] - w[0]) * k2;
        if (r < lo) lo = r;
        if (r > hi) hi = r;
      }
      const at = (x: number, y: number, shift: number): [number, number] => [
        (pj.W / 2 + pj.K(y) * (r0 + (x - w[0]) * k2 + shift)) * v.s + v.ox,
        pj.Y(y) * v.s + v.oy,
      ];
      const shifts = [0];
      if (lo < -Math.PI) shifts.push(2 * Math.PI);
      if (hi > Math.PI) shifts.push(-2 * Math.PI);
      const copies = projectLinePts(w, 2, pj, v);
      shifts.forEach((sh, i) => {
        const start = at(w[0], w[1], sh);
        out.push({
          t,
          pts: copies[i] ? Array.from(copies[i]) : [...start, ...start],
          head: true,
          start,
          marks: marks.map(({ mk, at: q }) => {
            const [x, y] = at(q[0], q[1], sh);
            return { k: mk, x, y };
          }),
        });
      });
      continue;
    }
    if (lv.proj) {
      // 只有标注投影、没给画线的投影(不该有):整条连续投过去
      const ref = midX(w);
      out.push({
        t,
        pts: pathToCanvas(w, lv),
        head: true,
        start: toCanvas(lv, w[0], w[1], ref),
        marks: marks.map(({ mk, at }) => {
          const [x, y] = toCanvas(lv, at[0], at[1], ref);
          return { k: mk, x, y };
        }),
      });
      continue;
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < w.length; i += 2) {
      if (w[i] < lo) lo = w[i];
      if (w[i] > hi) hi = w[i];
    }
    const pad = TREK_SIZE.head * 2 * u + 120 * lv.dpr;
    for (const sh of shiftsIn(lo, hi, lv, pad)) {
      const pts: number[] = [];
      for (let i = 0; i < w.length; i += 2) pts.push((w[i] + sh) * lv.scale + lv.ox, w[i + 1] * lv.scale + lv.oy);
      out.push({
        t,
        pts,
        head: true,
        start: [pts[0], pts[1]],
        marks: marks.map(({ mk, at }) => ({ k: mk, x: (at[0] + sh) * lv.scale + lv.ox, y: at[1] * lv.scale + lv.oy })),
      });
    }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (pj) clipOutline(ctx, pj.mp, { s: lv.scale, ox: lv.ox, oy: lv.oy });
  paintTreks(ctx, p.civ, out, u, lv.dpr, lv.k, p.style, { w: lv.canvasW, h: lv.canvasH, ...opt });
  ctx.restore();
  return out.length;
}

function midX(w: ArrayLike<number>): number {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < w.length; i += 2) {
    if (w[i] < lo) lo = w[i];
    if (w[i] > hi) hi = w[i];
  }
  return (lo + hi) / 2;
}

/**
 * 地球仪:每帧按正射投影画(画布像素)。at(wx, wy) = [x, y, 朝向](朝向 < minD 的在背面或贴着球边,不画);
 * 箭身只画朝着这边的几段,头在背面时不画头;字写在默认的位置。u = 一个世界单位是几个画布像素
 */
export function drawGlobeTreks(
  ctx: CanvasRenderingContext2D,
  p: CivDrawParams,
  at: (wx: number, wy: number) => [number, number, number],
  minD: number,
  u: number,
  dpr: number,
  alpha = 1,
  era?: Era | null,
): number {
  if (!treksShown(p)) return 0;
  const scene = trekScene(p.civ, p.world, p.year);
  if (!scene.length) return 0;
  const out: TrekCanvas[] = [];
  for (const t of scene) {
    const w = cutWorld(t);
    // 朝着这边的几段(各画各的箭身;最后一段的头在不在看头那一点)
    let run: number[] = [];
    const runs: number[][] = [];
    for (let i = 0; i < w.length; i += 2) {
      const [x, y, d] = at(w[i], w[i + 1]);
      if (d >= minD) run.push(x, y);
      else if (run.length) {
        runs.push(run);
        run = [];
      }
    }
    if (run.length) runs.push(run);
    const s0 = at(w[0], w[1]);
    const tip = at(w[w.length - 2], w[w.length - 1]);
    const marks = t.marks
      .map((mk) => {
        const q = pointAt(t.path.pts, t.path.s, markS(t, mk, TREK_SIZE.head * 3));
        const [x, y, d] = at(q[0], q[1]);
        return d >= minD ? { k: mk, x, y } : null;
      })
      .filter((x): x is { k: TrekMark; x: number; y: number } => !!x);
    const shown = { ...t, alpha: t.alpha * alpha };
    runs.forEach((r, i) => {
      const last = i === runs.length - 1;
      out.push({ t: shown, pts: r, head: last && tip[2] >= minD, start: i === 0 && s0[2] >= minD ? [s0[0], s0[1]] : null, marks: last ? marks : [] });
    });
    if (!runs.length && s0[2] >= minD) out.push({ t: shown, pts: [s0[0], s0[1]], head: false, start: [s0[0], s0[1]], marks: [] });
  }
  paintTreks(ctx, p.civ, out, u, dpr, 1, p.style, { era });
  return out.length;
}

/** 这一支(第 m 次)此刻在地图上的那一段的外接框(世界坐标,x 按 ref 展开);不在地图上 = null。选中迁来立的国时镜头把它框进来 */
export function trekBox(civ: Civ, world: World, m: number, year: Year, ref: number): [number, number, number, number] | null {
  const M = civ.migrations?.[m];
  const path = M && trekOnMap(M, year) ? trekPath(civ, world, m) : null;
  if (!M || !path) return null;
  const upto = M.settled !== undefined && year >= M.settled ? path.L : trekReach(M, path, year);
  const w = cutPath(path.pts, path.s, 0, upto);
  const W = world.width;
  // 按落脚的那一头对齐(迁来立的国就在那一头)
  const sh = nearX(w[w.length - 2], ref, W) - w[w.length - 2];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < w.length; i += 2) {
    const x = w[i] + sh;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (w[i + 1] < y0) y0 = w[i + 1];
    if (w[i + 1] > y1) y1 = w[i + 1];
  }
  return [x0, y0, x1, y1];
}

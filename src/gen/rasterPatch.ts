/**
 * 主图的一块补丁:地形大事(civ/upheaval.ts)以后地形变了,主图(gen/raster.ts 的 Raster,2048 × 1024 起)只有附近一块不一样。
 * 每件大事各存一整张主图太占内存,只存"和上一段比变了的那一块":后台线程铺好两张整图,比出框(diffRaster),只交回框里的一块;
 * 主线程按时间轴所在的那一段,把原来的主图复制一份、按先后贴上各件大事的补丁(composeRaster)。纯计算,不碰 DOM。
 *
 * 框按"看得出来的差别"划(TOL:海拔 1 米、气温 0.05 度、降水 0.005 毫米、沟 0.5 米、冰 0.01;水陆、群落、冰的样子一变就算),
 * 框里的像素整块照抄(一位不差);框外的差别小到看不出来,沿用上一段。
 * 好几件大事时,每段要和"拼好的上一段"比(composeOnto 拼出来的,不是上一段真正的主图):框外沿用的小差别一段段攒下来,
 * 几件下来就超过 TOL 看得出来了;和拼好的比,攒够了的那段就进框,拼好的每段离真图都不超过 TOL。
 * 主图东西相连:框的列可以跨过右边接回左边(x0 + w 超过主图宽的部分取模)。
 * 细沟的线(Raster.veinLines,放大现算时照它画)不大,补丁里整份带上。
 */
import type { Raster } from './raster';
import type { DrainLines } from './pixelDrain';
import { boxOfCols, boxSpans, type PixelBox } from './pixelBox';

/** 补丁里有的字段(cell 只由网格定,各段一样,不存) */
const F32 = ['elev', 'temp', 'precip', 'ice', 'gully'] as const;
const U8 = ['water', 'biome', 'iceConc', 'iceTone', 'wet', 'bank', 'vein'] as const;
type F32Key = (typeof F32)[number];
type U8Key = (typeof U8)[number];

/** 看得出来的差别(超过它才算变了);U8 的字段一变就算 */
const TOL: Record<F32Key, number> = { elev: 1, temp: 0.05, precip: 0.005, ice: 0.01, gully: 0.5 };

export interface RasterPatch {
  /** 主图的大小(贴的时候核对) */
  W: number;
  H: number;
  /** 框:左上角列 x0(0 ≤ x0 < W)、行 y0,宽 w、高 h(列跨过右边的取模) */
  x0: number;
  y0: number;
  w: number;
  h: number;
  f32: Partial<Record<F32Key, Float32Array>>;
  u8: Partial<Record<U8Key, Uint8Array>>;
  /** 这一段整张图的细沟(拷的一份) */
  veins?: DrainLines;
}

/** b 比 a 变了的那一块(两张主图一样大);一个像素也没变、细沟的线也一样 = null */
export function diffRaster(a: Raster, b: Raster): RasterPatch | null {
  const W = b.w;
  const H = b.h;
  if (a.w !== W || a.h !== H) throw new Error('主图大小不一样');
  const col = new Uint8Array(W);
  let y0 = H;
  let y1 = -1;
  const mark = (i: number) => {
    const y = (i / W) | 0;
    col[i - y * W] = 1;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  for (const k of F32) {
    const p = a[k];
    const q = b[k];
    if (!p || !q) continue;
    const t = TOL[k];
    for (let i = 0; i < p.length; i++) if (Math.abs(p[i] - q[i]) > t) mark(i);
  }
  for (const k of U8) {
    const p = a[k];
    const q = b[k];
    if (!p || !q) continue;
    for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) mark(i);
  }
  if (y1 < 0) {
    // 像素一个也没变,细沟的线却变了(放大、导出时照线画,看得出来):只带线,框是空的
    const v = b.veinLines;
    if (!v || sameLines(a.veinLines, v)) return null;
    return { W, H, x0: 0, y0: 0, w: 0, h: 0, f32: {}, u8: {}, veins: copyLines(v) };
  }
  // 列:找最长的一段没变的(东西相连,绕一圈),框 = 剩下的那一段
  return cutPatch(b, boxOfCols(col, y0, y1)!, true);
}

/** b 上一块框里的各字段拷出来成一块补丁;lines = 连细沟的线一起带上(有的话) */
function cutPatch(b: Raster, box: PixelBox, lines: boolean): RasterPatch {
  const W = b.w;
  const H = b.h;
  const { x0, y0, w, h } = box;
  const f32: RasterPatch['f32'] = {};
  const u8: RasterPatch['u8'] = {};
  for (const k of F32) {
    const q = b[k];
    if (q) f32[k] = cut(q, W, x0, y0, w, h, new Float32Array(w * h));
  }
  for (const k of U8) {
    const q = b[k];
    if (q) u8[k] = cut(q, W, x0, y0, w, h, new Uint8Array(w * h));
  }
  const v = lines ? b.veinLines : undefined;
  return { W, H, x0, y0, w, h, f32, u8, ...(v ? { veins: copyLines(v) } : {}) };
}

/**
 * b 比 a 变了的那一块,逐位比(没有"看不出来"的差别;编辑地形后交给主线程按块换上、按块重画,换上以后和 b 逐位相同)。
 * win:只在这块里比(调用方保证框外除了细沟都和 a 一样;不给 = 整张比);细沟(vein)整张比,细沟的线变了才带上。
 * 一个像素、一条线也没变 = null
 */
export function exactPatch(a: Raster, b: Raster, win?: PixelBox | null): RasterPatch | null {
  const d = exactDiff(a, b, win);
  return d && cutExact(b, d);
}

/** exactPatch 比出来的:变了的框(只有细沟的线变了 = null)、细沟的线变没变 */
export interface ExactDiff {
  box: PixelBox | null;
  lines: boolean;
}

/**
 * exactPatch 的前一半:只比、不拷(参数同 exactPatch;一个像素、一条线也没变 = null)。
 * 先看框有多大再决定交不交补丁(太大就整张交)时用,不白拷一份几十 MB 的补丁
 */
export function exactDiff(a: Raster, b: Raster, win?: PixelBox | null): ExactDiff | null {
  const W = b.w;
  const H = b.h;
  if (a.w !== W || a.h !== H) throw new Error('主图大小不一样');
  const col = new Uint8Array(W);
  let y0 = H;
  let y1 = -1;
  const scan = (p: ArrayLike<number>, q: ArrayLike<number>, box: PixelBox) => {
    for (let y = box.y0; y < box.y0 + box.h; y++) {
      const row = y * W;
      for (const [s, e] of boxSpans(box, W)) {
        for (let x = s; x < e; x++) {
          if (p[row + x] === q[row + x]) continue;
          col[x] = 1;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
  };
  const all: PixelBox = { x0: 0, y0: 0, w: W, h: H };
  const box = win === undefined ? all : win;
  const bits = (x: Float32Array) => new Int32Array(x.buffer, x.byteOffset, x.length);
  if (box) {
    for (const k of F32) {
      const p = a[k];
      const q = b[k];
      if (!p && !q) continue;
      if (!p || !q) throw new Error(`主图的 ${k} 一份有一份没有`);
      scan(bits(p), bits(q), box);
    }
    for (const k of U8) {
      if (k === 'vein') continue;
      const p = a[k];
      const q = b[k];
      if (!p && !q) continue;
      if (!p || !q) throw new Error(`主图的 ${k} 一份有一份没有`);
      scan(p, q, box);
    }
  }
  if (a.vein && b.vein) scan(a.vein, b.vein, all);
  else if (a.vein || b.vein) throw new Error('主图的 vein 一份有一份没有');
  const v = b.veinLines;
  const linesChanged = !!v && !sameLines(a.veinLines, v);
  if (y1 < 0) return linesChanged ? { box: null, lines: true } : null;
  return { box: boxOfCols(col, y0, y1)!, lines: linesChanged };
}

/**
 * 一张主图就地改之前的样子:框里各字段的原样(cutPatch 的格式;没给框 = 一个像素也不改)、整张的细沟和细沟的线(这两样改的时候换成新数组,
 * 原来的不动)。编辑地形按块重铺时直接改上一张主图的数组(不另拷一整张,见 gen/rasterEdit.ts 的 rasterizePatch),比补丁时拿它当上一张
 */
export interface RasterBefore {
  W: number;
  H: number;
  box: RasterPatch | null;
  vein?: Uint8Array;
  veinLines?: DrainLines;
}

/** r 就地改之前:记下框里的原样、细沟 */
export function rasterBefore(r: Raster, box: PixelBox | null): RasterBefore {
  return { W: r.w, H: r.h, box: box && cutPatch(r, box, false), vein: r.vein, veinLines: r.veinLines };
}

/**
 * 同 exactDiff,上一张是就地改之前记下的样子(rasterBefore;框得盖住 win):win 里逐位比,细沟整张比、细沟的线比。
 * 结果和拿改之前的整张主图做 exactDiff 一样
 */
export function exactDiffBefore(a: RasterBefore, b: Raster, win: PixelBox | null): ExactDiff | null {
  const W = b.w;
  const H = b.h;
  if (a.W !== W || a.H !== H) throw new Error('主图大小不一样');
  const col = new Uint8Array(W);
  let y0 = H;
  let y1 = -1;
  if (win) {
    const p = a.box;
    // 框盖住 win:行在里面,列从框的左边起算(东西相连)也在里面;框占满整圈就都在
    const dx = p ? (win.x0 - p.x0 + W) % W : 0;
    if (!p || win.y0 < p.y0 || win.y0 + win.h > p.y0 + p.h || (p.w < W && dx + win.w > p.w)) throw new Error('改之前记下的那块没盖住要比的框');
    const spans = boxSpans(win, W);
    const scan = (s: ArrayLike<number>, q: ArrayLike<number>) => {
      for (let y = win.y0; y < win.y0 + win.h; y++) {
        const row = y * W;
        const prow = (y - p.y0) * p.w;
        for (const [s0, e0] of spans) {
          for (let x = s0; x < e0; x++) {
            const d = x - p.x0;
            if (s[prow + (d < 0 ? d + W : d)] === q[row + x]) continue;
            col[x] = 1;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
    };
    const bits = (x: Float32Array) => new Int32Array(x.buffer, x.byteOffset, x.length);
    for (const k of F32) {
      const s = p.f32[k];
      const q = b[k];
      if (!s && !q) continue;
      if (!s || !q) throw new Error(`主图的 ${k} 一份有一份没有`);
      scan(bits(s), bits(q));
    }
    for (const k of U8) {
      if (k === 'vein') continue;
      const s = p.u8[k];
      const q = b[k];
      if (!s && !q) continue;
      if (!s || !q) throw new Error(`主图的 ${k} 一份有一份没有`);
      scan(s, q);
    }
  }
  // 细沟整张比(就地改的时候换成了新数组,原来的那份原样留着)
  if (a.vein && b.vein) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (a.vein[row + x] === b.vein[row + x]) continue;
        col[x] = 1;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  } else if (a.vein || b.vein) throw new Error('主图的 vein 一份有一份没有');
  const v = b.veinLines;
  const linesChanged = !!v && !sameLines(a.veinLines, v);
  if (y1 < 0) return linesChanged ? { box: null, lines: true } : null;
  return { box: boxOfCols(col, y0, y1)!, lines: linesChanged };
}

/** exactPatch 的后一半:照 exactDiff 比出来的,从 b 上拷出补丁 */
export function cutExact(b: Raster, d: ExactDiff): RasterPatch {
  if (!d.box) return { W: b.w, H: b.h, x0: 0, y0: 0, w: 0, h: 0, f32: {}, u8: {}, veins: copyLines(b.veinLines!) };
  return cutPatch(b, d.box, d.lines);
}

function copyLines(v: DrainLines): DrainLines {
  return { off: v.off.slice(), x: v.x.slice(), y: v.y.slice(), a: v.a.slice() };
}

/** 两份细沟的线一样(点数、坐标、集水面积一位不差) */
function sameLines(p: DrainLines | undefined, q: DrainLines): boolean {
  if (!p) return false;
  const eq = (u: ArrayLike<number>, v: ArrayLike<number>) => {
    if (u.length !== v.length) return false;
    for (let i = 0; i < u.length; i++) if (u[i] !== v[i]) return false;
    return true;
  };
  return eq(p.off, q.off) && eq(p.x, q.x) && eq(p.y, q.y) && eq(p.a, q.a);
}

function cut<T extends Float32Array | Uint8Array>(src: T, W: number, x0: number, y0: number, w: number, h: number, out: T): T {
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * W;
    const first = Math.min(w, W - x0);
    out.set(src.subarray(row + x0, row + x0 + first), y * w);
    if (first < w) out.set(src.subarray(row, row + w - first), y * w + first);
  }
  return out;
}

function paste<T extends Float32Array | Uint8Array>(dst: T, W: number, p: RasterPatch, src: T): void {
  const first = Math.min(p.w, W - p.x0);
  for (let y = 0; y < p.h; y++) {
    const row = (p.y0 + y) * W;
    dst.set(src.subarray(y * p.w, y * p.w + first), row + p.x0);
    if (first < p.w) dst.set(src.subarray(y * p.w + first, (y + 1) * p.w), row);
  }
}

/** 把补丁贴到 r 上(就地改) */
export function applyPatch(r: Raster, p: RasterPatch): void {
  if (r.w !== p.W || r.h !== p.H) throw new Error('补丁和主图大小不一样');
  for (const k of F32) {
    const s = p.f32[k];
    if (!s) continue;
    if (!r[k]) r[k] = new Float32Array(r.w * r.h);
    paste(r[k]!, r.w, p, s);
  }
  for (const k of U8) {
    const s = p.u8[k];
    if (!s) continue;
    if (!r[k]) r[k] = new Uint8Array(r.w * r.h);
    paste(r[k]!, r.w, p, s);
  }
  if (p.veins) r.veinLines = p.veins;
}

/** 原来的主图复制一份,按先后贴上补丁(原图不动;cell 共用) */
export function composeRaster(base: Raster, patches: readonly RasterPatch[]): Raster {
  if (!patches.length) return base;
  const out: Raster = {
    ...base,
    elev: base.elev.slice(),
    temp: base.temp.slice(),
    precip: base.precip.slice(),
    water: base.water.slice(),
    biome: base.biome.slice(),
    ice: base.ice.slice(),
    iceConc: base.iceConc.slice(),
    iceTone: base.iceTone.slice(),
    wet: base.wet.slice(),
    gully: base.gully?.slice(),
    bank: base.bank?.slice(),
    vein: base.vein?.slice(),
  };
  for (const p of patches) applyPatch(out, p);
  return out;
}

/**
 * composeRaster(a, p ? [p] : []) 的省内存版,p = diffRaster(a, b):补丁就是从 b 上切的,框里的 b 本来就对,
 * 只要把框外的各字段换成 a 的、细沟的线补丁里没带的换成 a 的,b 就是贴好的样子 —— 就地改 b,不另开一整张(b 原来的值不要了)。
 * 补丁管的字段和细沟的线和 composeRaster 逐位相同;没有补丁 = a 本身。a 不动。
 * 一段接一段交补丁时用:下一段和拼好的这一段比(见文件头)
 */
export function composeOnto(a: Raster, b: Raster, p: RasterPatch | null): Raster {
  if (!p) return a;
  const W = b.w;
  const keys = [...F32, ...U8];
  // 两张图的字段对不上(一张有沟、一张没有之类):照常复制一份贴
  if (a.w !== W || a.h !== b.h || keys.some((k) => !a[k] !== !b[k])) return composeRaster(a, [p]);
  // 框那几行里框外的列:框不跨右边 = 左右两段,跨右边 = 中间一段;框是空的(只带细沟的线)= 没有那几行
  const end = p.x0 + p.w;
  const side: [number, number][] = p.w >= W ? [] : end <= W ? [[0, p.x0], [end, W]] : [[end - W, p.x0]];
  const y1 = p.y0 + p.h;
  for (const k of keys) {
    const s = a[k];
    const d = b[k];
    if (!s || !d) continue;
    d.set(s.subarray(0, p.y0 * W));
    d.set(s.subarray(y1 * W), y1 * W);
    for (let y = p.y0; y < y1; y++) for (const [x0, x1] of side) if (x1 > x0) d.set(s.subarray(y * W + x0, y * W + x1), y * W + x0);
  }
  if (!p.veins && a.veinLines) b.veinLines = a.veinLines;
  return b;
}

/** 补丁里的数组 */
function arrays(p: RasterPatch): (Float32Array | Uint8Array | Int32Array)[] {
  const v = p.veins;
  return [...Object.values(p.f32), ...Object.values(p.u8), ...(v ? [v.off, v.x, v.y, v.a] : [])] as (Float32Array | Uint8Array | Int32Array)[];
}

/** 补丁里的数组(交给主线程时转移,不复制) */
export function patchTransferables(p: RasterPatch): ArrayBuffer[] {
  return arrays(p).map((a) => a.buffer as ArrayBuffer);
}

/** 补丁占多少字节 */
export function patchBytes(p: RasterPatch): number {
  return arrays(p).reduce((s, a) => s + a.byteLength, 0);
}

/**
 * 主图上一块(列从 x0 起往右 w 列,出右边接回左边)拷出来成一张小图(带 win:它在整张图上的位置)。
 * reuse = 用完了的另一块(同样切出来的):数组够大就拷进它的数组里,不另分配(连着切很多块时少留一堆等着回收的大数组)
 */
export function cutRaster(r: Raster, x0: number, y0: number, w: number, h: number, reuse?: Raster | null): Raster {
  const W = r.w;
  const N = w * h;
  const f32 = (old: Float32Array | undefined) => (old && old.buffer.byteLength >= N * 4 ? new Float32Array(old.buffer, 0, N) : new Float32Array(N));
  const u8 = (old: Uint8Array | undefined) => (old && old.buffer.byteLength >= N ? new Uint8Array(old.buffer, 0, N) : new Uint8Array(N));
  const cut = <T extends Float32Array | Uint8Array>(src: T, out: T): T => {
    for (let y = 0; y < h; y++) {
      const row = (y0 + y) * W;
      const first = Math.min(w, W - x0);
      out.set(src.subarray(row + x0, row + x0 + first), y * w);
      if (first < w) out.set(src.subarray(row, row + w - first), y * w + first);
    }
    return out;
  };
  const o = reuse ?? undefined;
  return {
    w,
    h,
    scale: r.scale,
    elev: cut(r.elev, f32(o?.elev)),
    temp: cut(r.temp, f32(o?.temp)),
    precip: cut(r.precip, f32(o?.precip)),
    water: cut(r.water, u8(o?.water)),
    biome: cut(r.biome, u8(o?.biome)),
    cell: new Int32Array(0),
    ice: cut(r.ice, f32(o?.ice)),
    iceConc: cut(r.iceConc, u8(o?.iceConc)),
    iceTone: cut(r.iceTone, u8(o?.iceTone)),
    wet: cut(r.wet, u8(o?.wet)),
    gully: r.gully && cut(r.gully, f32(o?.gully)),
    bank: r.bank && cut(r.bank, u8(o?.bank)),
    vein: r.vein && cut(r.vein, u8(o?.vein)),
    wrap: true,
    win: { x0, y0, W, H: r.h },
  };
}

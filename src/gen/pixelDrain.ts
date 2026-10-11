/**
 * 逐像素汇流(只在写实风里画进地面,世界数据不变):在整张主图的海拔上一个像素一个像素地算雨水往哪流、上游有多大,
 * 把集水面积够大的像素串成一条条沟。做法和地形软件里常见的一样:
 *   1. 填洼(priority-flood):从挨着海、湖、河面的陆地像素开始,按海拔从低往高"灌水"(按海拔分桶排队),
 *      每个像素记下是哪个邻居把它灌到的 —— 水就往那个邻居流(洼地里按原来的高低灌,水顺着洼地里的沟流到出口,不会困在坑里)
 *   2. 汇流:倒着灌水的顺序,把每个像素的面积加到它的下游,得到每个像素的集水面积
 *   3. 串线:集水面积够大的像素从源头往下游串成折线,碰到水或别的沟就停;太短的不要,平滑两遍去掉台阶
 * 河和小溪(放大后才画的那些)也是出口:沿它们刻一道看不见的浅谷把附近的水引过去,沟流到河、溪边就停;
 * 河、溪自己也当作沟画一道(全图上看得到小溪的沟,放大后画出来的溪正好躺在沟里)。
 * 东西相连(最左一列和最右一列是邻居);面积按纬度缩(等距圆柱图上高纬度的像素实际更小)。
 * 纯计算:不碰页面,worker / Node 都能跑;同一张海拔图结果一样。
 */
import type { Raster } from './raster';
import { smoothstep } from './util';
import { carveValleys, valleyLines, type ValleyLines } from './valleys';

/** 一条条沟(展平存):第 i 条是点 off[i] .. off[i + 1] − 1;坐标是世界单位(x 已展开成连续的,可能出左右边),a = 集水面积(世界单位²) */
export interface DrainLines {
  off: Int32Array;
  x: Float32Array;
  y: Float32Array;
  a: Float32Array;
}

// ---------------------------------------------------------------------------
// 细沟:算线、画进图里

/** 细沟的强弱:集水面积(世界单位²,1 ≈ 380 平方公里)从 VEIN_A0 到 VEIN_A1 由 0 长到 1(按对数) */
const VEIN_A0 = 8;
const VEIN_A1 = 800;
/** 细沟中线到边多宽(世界单位)= VEIN_K × √集水面积,最宽 VEIN_MAX;最窄不小于 VEIN_MIN_PX 个像素 */
const VEIN_K = 0.025;
const VEIN_MAX = 0.4;
const VEIN_MIN_PX = 0.7;
/** 沟两侧谷地:半径是沟的几倍、最浓多少 */
const VEIN_HALO = 2.5;
const VEIN_HALO_V = 0.35;
/** 沟头这么长一段(世界单位)由细变粗、由淡变浓;不到 VEIN_MIN_LEN 长的沟不画(大沟边上的小疙瘩) */
const VEIN_TAPER = 3;
const VEIN_MIN_LEN = 3;
/** 画出来的河面附近(bank 到这么大,约河岸外一个像素)当作水:沟流到河边就停,不在河旁边另走一条 */
const BANK_SINK = 230;

/**
 * 把逐像素汇流串出来的沟(gen/pixelDrain.ts)画进 out(0..255,取各段最大值)。画布的位置、东西相连的做法同 gen/raster.ts 的 carveValleys
 */
export function stampVeins(lines: DrainLines, scale: number, w: number, h: number, out: Uint8Array, ox = 0, oy = 0, period = w) {
  const l0 = Math.log(VEIN_A0);
  const l1 = Math.log(VEIN_A1);
  const { off, x, y, a } = lines;
  for (let c = 0; c < off.length - 1; c++) {
    // 这一段的起点离沟头多远(世界单位)
    let d0 = 0;
    for (let i = off[c]; i < off[c + 1] - 1; i++) {
      const sx = x[i + 1] - x[i];
      const sy = y[i + 1] - y[i];
      const seg = Math.sqrt(sx * sx + sy * sy);
      const tp = Math.min(1, (d0 + 0.5 * seg) / VEIN_TAPER);
      d0 += seg;
      const ar = 0.5 * (a[i] + a[i + 1]);
      const st = smoothstep(l0, l1, Math.log(ar)) * tp;
      if (st < 0.02) continue;
      const r = Math.max(VEIN_MIN_PX, Math.min(VEIN_MAX, VEIN_K * Math.sqrt(ar)) * scale * (0.5 + 0.5 * tp));
      const R = VEIN_HALO * r;
      const ax = x[i] * scale - ox;
      const bx = x[i + 1] * scale - ox;
      const ay = y[i] * scale - oy;
      const by = y[i + 1] * scale - oy;
      if (Math.min(ay, by) - R > h || Math.max(ay, by) + R < 0) continue;
      for (const s of WRAP_SHIFTS) {
        const sh = s * period;
        if (Math.min(ax, bx) + sh - R > w || Math.max(ax, bx) + sh + R < 0) continue;
        veinSegment(out, w, h, ax + sh, ay, bx + sh, by, r, R, st * 255);
      }
    }
  }
}

/** 沟中线(半径 r 内)按 (1 − (d/r)²)² 收;外面一圈(半径 R)是淡淡的谷地,按 VEIN_HALO_V × (1 − (d/R)²)² 收 */
function veinSegment(out: Uint8Array, w: number, h: number, ax: number, ay: number, bx: number, by: number, r: number, R: number, v: number) {
  const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - R - 0.5));
  const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + R));
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - R - 0.5));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + R));
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  const r2 = r * r;
  const R2 = R * R;
  for (let py = y0; py <= y1; py++) {
    const qy = py + 0.5 - ay;
    for (let px = x0; px <= x1; px++) {
      const qx = px + 0.5 - ax;
      let s = L2 > 0 ? (qx * dx + qy * dy) / L2 : 0;
      s = s < 0 ? 0 : s > 1 ? 1 : s;
      const ex = qx - s * dx;
      const ey = qy - s * dy;
      const d2 = ex * ex + ey * ey;
      if (d2 >= R2) continue;
      const qh = 1 - d2 / R2;
      let val = VEIN_HALO_V * qh * qh;
      if (d2 < r2) {
        const q = 1 - d2 / r2;
        if (q * q > val) val = q * q;
      }
      val *= v;
      const k = py * w + px;
      if (val > out[k]) out[k] = val;
    }
  }
}

/** 河和小溪(世界数据的河 + gen/creeks.ts 的溪,和放大后画的、刻谷的是同一组):细沟流到它们边上就停 */
export interface Streams {
  rivers: { pts: Float32Array }[];
  /** 成河门槛(World.riverThreshold) */
  threshold: number;
  /** 世界宽度(东西相连) */
  width: number;
}

/** 算细沟要的几样(整张主图铺好以后;可以交给帮手线程,和推文明同时算)。lines 已经有了就只画进图里 */
export interface VeinJob {
  w: number;
  h: number;
  scale: number;
  elev: Float32Array;
  water: Uint8Array;
  bank: Uint8Array;
  streams?: Streams;
  lines?: DrainLines;
}

/** 河、溪的浅谷(只给汇流用,不画):河道几何、下切深度、离河多近。只和世界有关,不用等像素铺好(帮手线程可以先算着) */
export interface StreamBeds {
  geom: ValleyLines;
  carve: Float32Array;
  calm: Float32Array;
  w: number;
  h: number;
  threshold: number;
}

/** w × h 的主图(scale 像素 / 世界单位)上河、溪的浅谷 */
export function streamBeds(s: Streams, w: number, h: number, scale: number): StreamBeds {
  const geom = valleyLines(s.rivers, s.threshold, s.width);
  const carve = new Float32Array(w * h);
  const calm = new Float32Array(w * h);
  carveValleys(geom, s.threshold, scale, w, h, carve, calm);
  return { geom, carve, calm, w, h, threshold: s.threshold };
}

/** 细沟:线(没给就现算;beds = 先算好的河、溪浅谷)和画进图里的那一层(Raster.veinLines、Raster.vein) */
export function veinsOf(j: VeinJob, beds?: StreamBeds): { lines: DrainLines; vein: Uint8Array } {
  const lines = j.lines ?? veinLinesOf(j, j.streams, beds);
  const vein = new Uint8Array(j.w * j.h);
  stampVeins(lines, j.scale, j.w, j.h, vein);
  return { lines, vein };
}

/**
 * 整张主图的沟(逐像素汇流 → 串线;放大现算的块、导出的大图都用这一份)。水和画出来的河面是出口,河谷里起伏压平。
 * 放大导出的图(scale 是 ≥ 2 的整数)先缩回 1 倍再算:沟的疏密和屏幕上一样,也不用几倍的内存
 */
export function veinLinesOf(r: Pick<Raster, 'w' | 'h' | 'scale' | 'elev' | 'water' | 'bank'>, streams?: Streams, ready?: StreamBeds): DrainLines {
  const s = r.scale >= 2 && Number.isInteger(r.scale) ? shrinkForVeins(r, r.scale) : r;
  const { w, h, scale, water } = s;
  const N = w * h;
  let { elev, bank } = s;
  // 河和小溪:刻一道浅谷(只给汇流用,不画),谷底一带当作出口
  const beds = ready && ready.w === w && ready.h === h ? ready : streams ? streamBeds(streams, w, h, scale) : null;
  if (beds) {
    const { carve, calm } = beds;
    const e = new Float32Array(N);
    const b = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      e[k] = elev[k] - carve[k];
      const c = calm[k] * 255 + 0.5;
      b[k] = bank && bank[k] > c ? bank[k] : c;
    }
    elev = e;
    bank = b;
  }
  const sink = new Uint8Array(N);
  for (let k = 0; k < N; k++) sink[k] = water[k] !== 0 ? 255 : bank && bank[k] >= BANK_SINK ? bank[k] : 0;
  const { recv, area } = pixelDrain(roughen(elev, w, h, scale, sink, bank), sink, w, h, scale);
  const lines = drainLines(recv, area, w, h, scale, VEIN_A0, VEIN_MIN_LEN);
  return beds ? withBeds(lines, beds.geom, beds.threshold) : lines;
}

/** 河、溪当作沟的集水面积:流量到成河门槛时算 BED_A(世界单位²),按流量成正比 */
const BED_A = 150;
/** 河、溪当作沟时隔多远取一个点(世界单位) */
const BED_STEP = 0.5;

/** 细沟后面接上河、溪本身(沿画出来的河道)当作沟:流量换成集水面积 */
function withBeds(lines: DrainLines, geom: ValleyLines, threshold: number): DrainLines {
  // 河道加密得很细:隔 BED_STEP 取一个点就够(首尾都留)
  const keep = (d: ValleyLines[number], i: number, last: number) => {
    if (i === 0 || i === d.x.length - 1) return true;
    const ex = d.x[i] - d.x[last];
    const ey = d.y[i] - d.y[last];
    return ex * ex + ey * ey >= BED_STEP * BED_STEP;
  };
  let n = lines.x.length;
  for (const d of geom) n += d.x.length;
  const off = new Int32Array(lines.off.length + geom.length);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const a = new Float32Array(n);
  off.set(lines.off);
  x.set(lines.x);
  y.set(lines.y);
  a.set(lines.a);
  let c = lines.off.length - 1;
  let p = lines.x.length;
  for (const d of geom) {
    let last = 0;
    for (let i = 0; i < d.x.length; i++) {
      if (!keep(d, i, last)) continue;
      last = i;
      x[p] = d.x[i];
      y[p] = d.y[i];
      a[p] = (BED_A * d.f[i]) / threshold;
      p++;
    }
    off[++c] = p;
  }
  return { off, x: x.slice(0, p), y: y.slice(0, p), a: a.slice(0, p) };
}

/** k 倍的主图缩回 1 倍:海拔取平均,一半以上是水就算水,bank 取最大 */
function shrinkForVeins(r: Pick<Raster, 'w' | 'h' | 'scale' | 'elev' | 'water' | 'bank'>, k: number) {
  const w = Math.floor(r.w / k);
  const h = Math.floor(r.h / k);
  const elev = new Float32Array(w * h);
  const water = new Uint8Array(w * h);
  const bank = r.bank ? new Uint8Array(w * h) : undefined;
  const kk = k * k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let e = 0;
      let wet = 0;
      let b = 0;
      for (let dy = 0; dy < k; dy++) {
        const row = (y * k + dy) * r.w + x * k;
        for (let dx = 0; dx < k; dx++) {
          e += r.elev[row + dx];
          if (r.water[row + dx] !== 0) wet++;
          if (r.bank && r.bank[row + dx] > b) b = r.bank[row + dx];
        }
      }
      const i = y * w + x;
      elev[i] = e / kk;
      water[i] = 2 * wet >= kk ? 1 : 0;
      if (bank) bank[i] = b;
    }
  }
  return { w, h, scale: r.scale / k, elev, water, bank };
}

/** 东西相连的主图上,一样东西画在哪几份:本身、往左挪一整圈、往右挪一整圈(× 图宽) */
const WRAP_SHIFTS = [0, -1, 1];

// ---------------------------------------------------------------------------
// 逐像素汇流

/** 按海拔分桶排队,一桶多高(米):桶里先进先出。比一个个比大小的堆快得多,差别只在海拔差不到一桶的像素谁先谁后 */
const BUCKET = 0.1;

/** 还没灌到的陆地像素(下游的初值) */
const UNSEEN = 0x7fffffff;

/**
 * 每个像素的下游和集水面积(世界单位²)。下游 ≤ −2:挨着水,流进 −2 − 下游 那个水像素;−1 = 水本身或者没灌到。
 * h:海拔(米);sink:非 0 = 水(海、湖,画出来的河面也算 —— 沟流到河边就停);w × hh 像素,scale 像素 / 世界单位
 */
export function pixelDrain(h: Float32Array, sink: Uint8Array, w: number, hh: number, scale: number): { recv: Int32Array; area: Float32Array } {
  const N = w * hh;
  const recv = new Int32Array(N);
  const order = new Int32Array(N);
  let len = 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < N; k++) {
    if (sink[k] !== 0) recv[k] = -1;
    else {
      recv[k] = UNSEEN;
      const v = h[k];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (lo > hi) return { recv, area: new Float32Array(N) };
  // 分桶的队:head / tail 每桶的头尾,next 桶里下一个
  const nb = Math.floor((hi - lo) / BUCKET) + 2;
  const head = new Int32Array(nb).fill(-1);
  const tail = new Int32Array(nb);
  const next = new Int32Array(N);
  let cur = 0;
  const push = (j: number, key: number) => {
    let b = ((key - lo) / BUCKET) | 0;
    if (b < cur) b = cur;
    else if (b >= nb) b = nb - 1;
    next[j] = -1;
    if (head[b] < 0) head[b] = j;
    else next[tail[b]] = j;
    tail[b] = j;
  };
  const nbr = new Int32Array(8);
  const off8 = Int32Array.of(-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1);
  /** i 的邻居(东西相连、南北到边为止)写进 nbr,返回个数 */
  const around = (i: number) => {
    const py = (i / w) | 0;
    const px = i - py * w;
    // 不挨边的像素(绝大多数)邻居是固定的偏移
    if (px > 0 && px < w - 1 && py > 0 && py < hh - 1) {
      for (let q = 0; q < 8; q++) nbr[q] = i + off8[q];
      return 8;
    }
    const l = px === 0 ? i + w - 1 : i - 1;
    const r = px === w - 1 ? i - w + 1 : i + 1;
    let n = 0;
    nbr[n++] = l;
    nbr[n++] = r;
    if (py > 0) {
      nbr[n++] = l - w;
      nbr[n++] = i - w;
      nbr[n++] = r - w;
    }
    if (py < hh - 1) {
      nbr[n++] = l + w;
      nbr[n++] = i + w;
      nbr[n++] = r + w;
    }
    return n;
  };
  // 挨着水的陆地像素先入队;下游记成 −2 − 流进的那个水像素(sink 最大的那个邻居,沟画到那里接上水边)
  for (let k = 0; k < N; k++) {
    if (sink[k] !== 0) continue;
    const n = around(k);
    let best = -1;
    for (let q = 0; q < n; q++) {
      const j = nbr[q];
      if (sink[j] !== 0 && (best < 0 || sink[j] > sink[best])) best = j;
    }
    if (best >= 0) {
      recv[k] = -2 - best;
      push(k, h[k]);
    }
  }
  // 灌水。从分桶的队里出来的像素,灌到的水面就是它自己的海拔;比水面还低的邻居是洼地,另排一队(pit),
  // 按原来的海拔先低后高灌完(水面都是 level),再回到分桶的队。这样水在洼地里顺着原来的沟走到出口,
  // 不是从出口一圈圈往外、流成一条条放射的直线
  const pit = new Heap();
  let level = 0;
  for (;;) {
    let i: number;
    if (pit.size) i = pit.pop();
    else {
      while (cur < nb && head[cur] < 0) cur++;
      if (cur >= nb) break;
      i = head[cur];
      head[cur] = next[i];
      level = h[i];
    }
    order[len++] = i;
    const n = around(i);
    for (let q = 0; q < n; q++) {
      const j = nbr[q];
      if (recv[j] !== UNSEEN) continue;
      recv[j] = i;
      const hj = h[j];
      if (hj > level) push(j, hj);
      else pit.push(j, hj);
    }
  }
  // 没灌到的(和水不连着的陆地):当作没有下游
  for (let k = 0; k < N; k++) if (recv[k] === UNSEEN) recv[k] = -1;
  // 汇流:上游(后灌到的)先加
  const area = new Float32Array(N);
  const pa = 1 / (scale * scale);
  for (let py = 0; py < hh; py++) {
    const c = pa * Math.fround(Math.cos(((py + 0.5) / hh - 0.5) * Math.PI));
    for (let px = 0; px < w; px++) if (sink[py * w + px] === 0) area[py * w + px] = c;
  }
  for (let q = len - 1; q >= 0; q--) {
    const i = order[q];
    const r = recv[i];
    if (r >= 0) area[r] += area[i];
  }
  return { recv, area };
}

/**
 * 集水面积不到 minArea(世界单位²)的不算沟(水面积是 0);够的从源头往下游串成折线(点在像素中心,世界单位),
 * 碰到水(串到水边那个像素)或已经串过的沟就停(停在那一点上,和那条沟接上)。不到 minLen(世界单位)长的不要
 * (多半是坡上漫流刚好在大沟边汇到一个像素,画出来是沟边一个个小疙瘩)。平滑两遍,首尾不动
 */
export function drainLines(recv: Int32Array, area: Float32Array, w: number, hh: number, scale: number, minArea: number, minLen = 0): DrainLines {
  const N = w * hh;
  const isCh = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (area[k] >= minArea) isCh[k] = 1;
  const hasDonor = new Uint8Array(N);
  for (let k = 0; k < N; k++) if (isCh[k] && recv[k] >= 0) hasDonor[recv[k]] = 1;
  const visited = new Uint8Array(N);
  const off: number[] = [0];
  const xs: number[] = [];
  const ys: number[] = [];
  const as: number[] = [];
  const W = w / scale;
  const cx: number[] = [];
  const cy: number[] = [];
  const ca: number[] = [];
  /** 这一条新串上的像素(不要它时退回去,后面的沟还能从这里过) */
  const ci: number[] = [];
  for (let s = 0; s < N; s++) {
    if (!isCh[s] || hasDonor[s] || visited[s]) continue;
    cx.length = cy.length = ca.length = ci.length = 0;
    let i = s;
    for (;;) {
      const py = (i / w) | 0;
      const px = i - py * w;
      let x = (px + 0.5) / scale;
      // 跨过东西接缝:接着上一点展开
      if (cx.length) {
        const prev = cx[cx.length - 1];
        while (x - prev > W / 2) x -= W;
        while (prev - x > W / 2) x += W;
      }
      cx.push(x);
      cy.push((py + 0.5) / scale);
      ca.push(area[i]);
      if (visited[i]) break;
      visited[i] = 1;
      ci.push(i);
      const r = recv[i];
      if (r < 0) {
        // 流进水里:多画一点到水边那个像素
        if (r <= -2) {
          const o = -2 - r;
          const oy = (o / w) | 0;
          let ox = (o - oy * w + 0.5) / scale;
          const prev = cx[cx.length - 1];
          while (ox - prev > W / 2) ox -= W;
          while (prev - ox > W / 2) ox += W;
          cx.push(ox);
          cy.push((oy + 0.5) / scale);
          ca.push(area[i]);
        }
        break;
      }
      i = r;
    }
    const m = cx.length;
    if (m < 2) continue;
    let len = 0;
    for (let k = 1; k < m; k++) {
      const dx = cx[k] - cx[k - 1];
      const dy = cy[k] - cy[k - 1];
      len += Math.sqrt(dx * dx + dy * dy);
    }
    if (len < minLen) {
      for (const k of ci) visited[k] = 0;
      continue;
    }
    // 平滑两遍(D8 的台阶),首尾不动
    for (let pass = 0; pass < 2; pass++) {
      let px0 = cx[0];
      let py0 = cy[0];
      for (let k = 1; k < m - 1; k++) {
        const nx = 0.25 * px0 + 0.5 * cx[k] + 0.25 * cx[k + 1];
        const ny = 0.25 * py0 + 0.5 * cy[k] + 0.25 * cy[k + 1];
        px0 = cx[k];
        py0 = cy[k];
        cx[k] = nx;
        cy[k] = ny;
      }
    }
    for (let k = 0; k < m; k++) {
      xs.push(cx[k]);
      ys.push(cy[k]);
      as.push(ca[k]);
    }
    off.push(xs.length);
  }
  return { off: Int32Array.from(off), x: Float32Array.from(xs), y: Float32Array.from(ys), a: Float32Array.from(as) };
}

/**
 * 汇流前给海拔加的起伏(米):几层值噪声(波长按世界单位,幅度米)。插值出来的海拔在平地上是一个个光滑的斜面,
 * 水会顺着斜面走一条条平行的直线;加上起伏后才弯弯曲曲地汇到一起,像真的水系。只用来算流向,不改画出来的海拔
 */
const ROUGH_OCT: [number, number][] = [
  [48, 150],
  [24, 90],
  [12, 50],
  [6, 28],
  [3, 15],
  [1.5, 8],
];

/**
 * h 加上起伏(新数组);东西方向按整圈取整,左右无缝。skip 非 0 的像素(水)不加;
 * damp(0..255,河谷的 bank)越大起伏越小:河谷里按刻出来的谷走,不被起伏带偏到河边另走一条
 */
export function roughen(h: Float32Array, w: number, hh: number, scale: number, skip: Uint8Array, damp?: Uint8Array): Float32Array {
  const out = new Float32Array(h);
  const W = w / scale;
  const oct = ROUGH_OCT.map(([lam, amp], o) => ({ lam, amp, o, P: Math.max(1, Math.round(W / lam)) }))
    .filter((q) => q.lam * scale >= 1.5)
    .map((q) => {
      const ix = new Int32Array(w);
      const ux = new Float32Array(w);
      for (let px = 0; px < w; px++) {
        const f = ((px + 0.5) / scale / W) * q.P;
        const i = Math.floor(f);
        const t = f - i;
        ix[px] = i;
        ux[px] = t * t * (3 - 2 * t);
      }
      return { ...q, ix, ux, A: new Float32Array(q.P + 1), C: new Float32Array(q.P + 1), cy: NaN };
    });
  const line = (iy: number, arr: Float32Array, P: number, o: number) => {
    for (let i = 0; i <= P; i++) arr[i] = hash01(i % P, iy, 977 + o) * 2 - 1;
  };
  const acc = new Float32Array(w);
  const runs = new Int32Array(w + 2);
  for (let py = 0; py < hh; py++) {
    const row = py * w;
    // 这一行的陆地一段段(只算这些)
    let nr = 0;
    for (let x = 0; x < w; ) {
      while (x < w && skip[row + x] !== 0) x++;
      if (x >= w) break;
      runs[nr++] = x;
      while (x < w && skip[row + x] === 0) x++;
      runs[nr++] = x;
    }
    if (!nr) continue;
    for (let r = 0; r < nr; r += 2) acc.fill(0, runs[r], runs[r + 1]);
    for (const q of oct) {
      const f = (py + 0.5) / scale / q.lam;
      const iy = Math.floor(f);
      const t = f - iy;
      const uy = t * t * (3 - 2 * t);
      if (iy !== q.cy) {
        if (iy === q.cy + 1) {
          const tmp = q.A;
          q.A = q.C;
          q.C = tmp;
          line(iy + 1, q.C, q.P, q.o);
        } else {
          line(iy, q.A, q.P, q.o);
          line(iy + 1, q.C, q.P, q.o);
        }
        q.cy = iy;
      }
      const { ix, ux, A, C, amp } = q;
      for (let r = 0; r < nr; r += 2) {
        for (let px = runs[r], e = runs[r + 1]; px < e; px++) {
          const i = ix[px];
          const u = ux[px];
          const a = A[i] + (A[i + 1] - A[i]) * u;
          const c = C[i] + (C[i + 1] - C[i]) * u;
          acc[px] += amp * (a + (c - a) * uy);
        }
      }
    }
    for (let r = 0; r < nr; r += 2) {
      for (let px = runs[r], e = runs[r + 1]; px < e; px++) {
        const k = row + px;
        out[k] = h[k] + (damp ? acc[px] * (1 - damp[k] / 255) : acc[px]);
      }
    }
  }
  return out;
}

/** 整数格点 → 0..1 */
function hash01(x: number, y: number, s: number): number {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + 0x632be5ab, 0xc2b2ae35) ^ Math.imul(s, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 小顶堆(洼地那一队):像素编号 + 键(原来的海拔);不够大就翻倍 */
class Heap {
  private id = new Int32Array(1024);
  private key = new Float32Array(1024);
  size = 0;
  push(i: number, k: number): void {
    if (this.size === this.id.length) {
      const id = new Int32Array(this.size * 2);
      const key = new Float32Array(this.size * 2);
      id.set(this.id);
      key.set(this.key);
      this.id = id;
      this.key = key;
    }
    let c = this.size++;
    const id = this.id;
    const key = this.key;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (key[p] <= k) break;
      id[c] = id[p];
      key[c] = key[p];
      c = p;
    }
    id[c] = i;
    key[c] = k;
  }
  pop(): number {
    const id = this.id;
    const key = this.key;
    const top = id[0];
    const n = --this.size;
    if (n > 0) {
      const li = id[n];
      const lk = key[n];
      let c = 0;
      for (;;) {
        let ch = 2 * c + 1;
        if (ch >= n) break;
        if (ch + 1 < n && key[ch + 1] < key[ch]) ch++;
        if (key[ch] >= lk) break;
        id[c] = id[ch];
        key[c] = key[ch];
        c = ch;
      }
      id[c] = li;
      key[c] = lk;
    }
    return top;
  }
}

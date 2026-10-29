/**
 * 生成管线共用的小工具:确定性随机数、最小堆、插值(噪声在 noise.ts)。
 * 所有生成步骤只通过 seed 取随机,保证"同一个种子 = 同一个世界"。
 */

export type Rng = () => number;

/** mulberry32:32 位种子 → [0,1) 伪随机序列。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 从主种子派生出互不相关的子种子,让每个步骤各用一条随机流。 */
export function subSeed(seed: number, salt: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h = Math.imul(h ^ salt.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** 32 位整数混合(murmur3 fmix32) */
function fmix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * 按实体取随机数:[0, 1)。a、b、c 是整数(位置锚、年份、用途编号……),缺省为 0。
 * 同样的参数永远得到同样的数,和取的先后无关(文明推演见 civ/rand.ts;地形里按地块取的也用它)。
 */
export function keyed(base: number, a = 0, b = 0, c = 0): number {
  let h = fmix((base ^ 0x2545f491) >>> 0);
  h = fmix((h ^ Math.imul(a | 0, 0x9e3779b1)) >>> 0);
  h = fmix((h ^ Math.imul(b | 0, 0x85ebca77)) >>> 0);
  h = fmix((h ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0);
  return h / 4294967296;
}

/** 四个整数的 keyed(两个实体的位置锚 + 第几次 + 用途):[0, 1) */
export function keyed4(base: number, a: number, b: number, c: number, d: number): number {
  let h = fmix((base ^ 0x2545f491) >>> 0);
  h = fmix((h ^ Math.imul(a | 0, 0x9e3779b1)) >>> 0);
  h = fmix((h ^ Math.imul(b | 0, 0x85ebca77)) >>> 0);
  h = fmix((h ^ Math.imul(c | 0, 0xc2b2ae3d)) >>> 0);
  h = fmix((h ^ Math.imul(d | 0, 0x27d4eb2f)) >>> 0);
  return h / 4294967296;
}

/**
 * 平面距离 √(dx² + dy²)。生成代码里一律用它,不用 Math.hypot:
 * 各 JS 引擎的 Math.hypot 末位精度不同(V8 与 JavaScriptCore 实测有差),
 * 会让同一种子在不同浏览器里长出略有差别的世界;sqrt 和加减乘除是 IEEE 754 精确舍入的,各引擎一致。
 */
export const hypot2 = (dx: number, dy: number) => Math.sqrt(dx * dx + dy * dy);
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** 分段线性查表:table 为 [x0,y0,x1,y1,...],x 递增。 */
export function piecewise(table: number[], x: number): number {
  if (x <= table[0]) return table[1];
  for (let i = 2; i < table.length; i += 2) {
    if (x <= table[i]) {
      const x0 = table[i - 2];
      const y0 = table[i - 1];
      return y0 + ((table[i + 1] - y0) * (x - x0)) / (table[i] - x0);
    }
  }
  return table[table.length - 1];
}

/**
 * 0..n−1 按 key 从小到大排的顺序,key 相同的按编号从小到大 —— 和 `下标数组.sort((a, b) => key[a] - key[b])`(稳定排序)
 * 结果一样,但快得多:每项编成"key 的排序码 × 2^21 + 编号"(53 位以内,双精度里是精确整数),用 Float64Array 自带的数值排序。
 * key 不能有 NaN;+0 和 −0 算相同(和那个比较函数一样)。超过 2^21 项时照旧用比较函数排
 */
export function orderByKey(key: Float32Array): Int32Array {
  const n = key.length;
  const order = new Int32Array(n);
  if (n > ORDER_SPAN) {
    for (let i = 0; i < n; i++) order[i] = i;
    return order.sort((a, b) => key[a] - key[b]);
  }
  const bits = new Uint32Array(key.buffer, key.byteOffset, n);
  const code = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const b = bits[i] === 0x80000000 ? 0 : bits[i]; // −0 当 +0
    // 32 位浮点的位 → 保序的无符号整数:负数各位取反,正数最高位置 1
    const u = b & 0x80000000 ? ~b >>> 0 : (b | 0x80000000) >>> 0;
    code[i] = u * ORDER_SPAN + i;
  }
  code.sort();
  for (let q = 0; q < n; q++) order[q] = code[q] % ORDER_SPAN;
  return order;
}
const ORDER_SPAN = 2 ** 21;

/** 二叉最小堆(id + 优先级),容量自动增长。Dijkstra / Priority-Flood 用。 */
export class MinHeap {
  ids: Int32Array;
  pri: Float64Array;
  size = 0;
  constructor(capacity = 1024) {
    this.ids = new Int32Array(capacity);
    this.pri = new Float64Array(capacity);
  }
  push(id: number, p: number) {
    if (this.size === this.ids.length) {
      const ids = new Int32Array(this.size * 2);
      ids.set(this.ids);
      const pri = new Float64Array(this.size * 2);
      pri.set(this.pri);
      this.ids = ids;
      this.pri = pri;
    }
    let i = this.size++;
    const ids = this.ids;
    const pr = this.pri;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pr[parent] <= p) break;
      ids[i] = ids[parent];
      pr[i] = pr[parent];
      i = parent;
    }
    ids[i] = id;
    pr[i] = p;
  }
  /** 弹出最小项,返回 id;其优先级写入 lastPri。 */
  lastPri = 0;
  pop(): number {
    const ids = this.ids;
    const pr = this.pri;
    const top = ids[0];
    this.lastPri = pr[0];
    const n = --this.size;
    if (n > 0) {
      const id = ids[n];
      const p = pr[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pr[c + 1] < pr[c]) c++;
        if (pr[c] >= p) break;
        ids[i] = ids[c];
        pr[i] = pr[c];
        i = c;
      }
      ids[i] = id;
      pr[i] = p;
    }
    return top;
  }
}

/** 可分离盒式模糊(原地,单通道 Float32)。 */
export function boxBlur(src: Float32Array, w: number, h: number, radius: number) {
  const tmp = new Float32Array(w * h);
  const r = radius;
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc * inv;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      src[y * w + x] = acc * inv;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
}

/**
 * 两份列表按内容比出"新加的 / 少了的",一模一样的几件按个数算(各加了几件就算几件);
 * 次序保持:新加的在前、少了的在后,各自按原列表里的先后。
 */
export function multisetDiff<T>(now: readonly T[], before: readonly T[]): { added: T[]; removed: T[] } {
  const left = (from: readonly T[], other: readonly T[]) => {
    const pool = new Map<string, number>();
    for (const v of other) {
      const k = JSON.stringify(v);
      pool.set(k, (pool.get(k) ?? 0) + 1);
    }
    return from.filter((v) => {
      const k = JSON.stringify(v);
      const n = pool.get(k) ?? 0;
      if (n > 0) pool.set(k, n - 1);
      return n === 0;
    });
  };
  return { added: left(now, before), removed: left(before, now) };
}

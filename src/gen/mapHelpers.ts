/**
 * 网站替地图插件算的几样「帮手」:噪声、平滑、离某些地块几步、某块附近的地块,另有两块之间多少公里。
 * 只读网格、按种子定,交回新数组;插件在 QuickJS 里算这些要慢几十倍,网站这头算好递进去。
 * 参数是插件给的,一律当不可信的核对,写错了抛 Error(说是哪个帮手、哪一项)。纯计算,worker 和 Node 里都能跑。
 */
import type { Mesh } from './mesh';
import { blurField } from './mesh';
import { geometryOf } from './geometry';
import { subSeed } from './util';
import { KM_PER_UNIT } from './civ/scale';

export interface NoiseOptions {
  /** 起伏的尺度(公里):大约多远一个起落 */
  km: number;
  /** 叠几层(1–8,默认 1);每多一层尺度减半 */
  octaves?: number;
  /** 每多一层起伏乘多少(0–1,默认 0.5) */
  persistence?: number;
  /** 同一个插件要几张不同的噪声时各给一个 */
  salt?: string | number;
}

export interface MapHelpers {
  /** 每个地块一个 −1…1 左右的数,和官方生成用的同一套噪声 */
  noise(o: NoiseOptions): Float32Array;
  /** 和邻居平均 passes 遍(0–200);给了 mask 只在标了 1 的地块上平均、只和标了 1 的邻居平均,别的地块不变 */
  blur(field: ArrayLike<number>, passes: number, mask?: ArrayLike<number>): Float32Array;
  /** 从 from 标了 1 的地块沿邻居走,每块要走几步(到不了 = −1);给了 through 只能走进标了 1 的地块 */
  steps(from: ArrayLike<number>, through?: ArrayLike<number>): Int32Array;
  /** 离地块 cell 不超过 km 公里的地块(含它自己),按编号从小到大 */
  near(cell: number, km: number): Int32Array;
  /** 两块之间多少公里(直线穿过星球的距离,近处和沿地面走差不多) */
  km(a: number, b: number): number;
}

export const NOISE_OCTAVES_MAX = 8;
export const BLUR_PASSES_MAX = 200;
const SALT_MAX = 64;

const arrayLike = (v: unknown): v is ArrayLike<unknown> => typeof v === 'object' && v !== null && typeof (v as ArrayLike<unknown>).length === 'number';

/** 地块数那么长、每格是数 */
function cellsOf(name: string, v: unknown, n: number): ArrayLike<number> {
  if (!arrayLike(v) || v.length !== n) throw new Error(`${name} 要是一个长度等于地块数 ${n} 的数组`);
  if (ArrayBuffer.isView(v)) return v as unknown as ArrayLike<number>;
  for (let i = 0; i < n; i++) if (typeof v[i] !== 'number') throw new Error(`${name}[${i}] 不是数`);
  return v as ArrayLike<number>;
}

/** 标了 1 的地块 */
function marks(name: string, v: unknown, n: number): Uint8Array {
  const a = cellsOf(name, v, n);
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] === 1 ? 1 : 0;
  return out;
}

const isCell = (a: unknown, n: number): a is number => typeof a === 'number' && (a | 0) === a && a >= 0 && a < n;

/** 只在 mask 上平均:自己 + 标了 1 的邻居,按邻接表的先后加起来再除以个数 */
function blurMasked(mesh: Mesh, f: Float32Array, passes: number, mask: Uint8Array): Float32Array {
  const { n, adjStart, adj } = mesh;
  let a = f.slice();
  let b = f.slice();
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      if (!mask[i]) continue;
      let s = a[i];
      let c = 1;
      for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
        const j = adj[k];
        if (!mask[j]) continue;
        s += a[j];
        c++;
      }
      b[i] = s / c;
    }
    const t = a;
    a = b;
    b = t;
  }
  return a;
}

/** 一个插件的帮手:seed = 地图种子,id = 插件编号(噪声的种子按它分开) */
export function mapHelpers(mesh: Mesh, seed: number, id: string): MapHelpers {
  const { n, xyz } = mesh;
  const kmPerUnit = (mesh.width * KM_PER_UNIT) / (2 * Math.PI);
  return {
    noise(o) {
      if (typeof o !== 'object' || o === null) throw new Error('d.noise 要给一个对象,比如 { km: 800, octaves: 4 }');
      const { km, octaves = 1, persistence = 0.5, salt = '' } = o;
      if (typeof km !== 'number' || !(km > 0 && km < Infinity)) throw new Error('d.noise 的 km 要是大于 0 的数');
      if (!Number.isInteger(octaves) || octaves < 1 || octaves > NOISE_OCTAVES_MAX) throw new Error(`d.noise 的 octaves 要是 1 到 ${NOISE_OCTAVES_MAX} 的整数`);
      if (typeof persistence !== 'number' || !(persistence > 0 && persistence <= 1)) throw new Error('d.noise 的 persistence 要是大于 0、不超过 1 的数');
      if (!((typeof salt === 'string' && salt.length <= SALT_MAX) || (typeof salt === 'number' && Number.isFinite(salt)))) {
        throw new Error(`d.noise 的 salt 要是不超过 ${SALT_MAX} 个字的字,或者一个数`);
      }
      const nz = geometryOf(mesh).fbm(subSeed(seed, `map:${id}:${salt}`), octaves, persistence);
      const scale = km / KM_PER_UNIT;
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = nz.atScale(i, scale);
      return out;
    },
    blur(field, passes, mask) {
      const a = cellsOf('d.blur 的 field', field, n);
      if (!Number.isInteger(passes) || passes < 0 || passes > BLUR_PASSES_MAX) throw new Error(`d.blur 的遍数要是 0 到 ${BLUR_PASSES_MAX} 的整数`);
      const f = a instanceof Float32Array ? a : Float32Array.from(a);
      return mask === undefined ? blurField(mesh, f, passes) : blurMasked(mesh, f, passes, marks('d.blur 的 mask', mask, n));
    },
    steps(from, through) {
      const src = marks('d.steps 的 from', from, n);
      const pass = through === undefined ? null : marks('d.steps 的 through', through, n);
      const { adjStart, adj } = mesh;
      const out = new Int32Array(n).fill(-1);
      const q = new Int32Array(n);
      let head = 0;
      let tail = 0;
      for (let i = 0; i < n; i++) {
        if (!src[i]) continue;
        out[i] = 0;
        q[tail++] = i;
      }
      while (head < tail) {
        const c = q[head++];
        for (let k = adjStart[c]; k < adjStart[c + 1]; k++) {
          const j = adj[k];
          if (out[j] >= 0 || (pass && !pass[j])) continue;
          out[j] = out[c] + 1;
          q[tail++] = j;
        }
      }
      return out;
    },
    near(cell, km) {
      if (!isCell(cell, n)) throw new Error('d.near 的第一项要是地块编号(0 到 n − 1 的整数)');
      if (typeof km !== 'number' || !(km >= 0 && km < Infinity)) throw new Error('d.near 的 km 要是不小于 0 的数');
      return geometryOf(mesh).cellsNear(cell, km / KM_PER_UNIT);
    },
    km(a, b) {
      if (!isCell(a, n) || !isCell(b, n)) throw new TypeError('d.km(a, b) 的 a、b 要是地块编号(0 到 n − 1 的整数)');
      const dx = xyz[3 * a] - xyz[3 * b];
      const dy = xyz[3 * a + 1] - xyz[3 * b + 1];
      const dz = xyz[3 * a + 2] - xyz[3 * b + 2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz) * kmPerUnit;
    },
  };
}

/**
 * 生成、推演线程和 QuickJS 之间递数据:结构走 JSON,JSON 表达不了的(类型化数组、-0、NaN、±Infinity、值是 undefined 的键)
 * 在 JSON 里先写 null,另记一张补丁表(路径 → 换成什么),类型化数组的字节单独递。
 *
 * 补丁:[路径, 0, 类型名, 第几块字节] | [路径, 1, '-0' | 'NaN' | 'Infinity' | '-Infinity'] | [路径, 2](undefined);
 * 路径是一串键(对象的键是字,数组的下标是数),空路径 = 整个值。QuickJS 里那一层(shim.ts)用同一套写法。
 */

/** 递得过去的类型化数组(两边按名字对上构造函数) */
export const TYPED_ARRAYS = {
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  Float32Array,
  Float64Array,
} as const;

export type TypedName = keyof typeof TYPED_ARRAYS;
type Typed = InstanceType<(typeof TYPED_ARRAYS)[TypedName]>;
type Key = string | number;
type Patch = [Key[], 0, TypedName, number] | [Key[], 1, string] | [Key[], 2];

/** 递一次的东西:JSON、补丁表(没有 = 空字)、字节 */
export interface Wire {
  text: string;
  patches: string;
  bufs: ArrayBuffer[];
}

/** 回话最多套几层(小本子本来就限 8 层) */
export const WIRE_DEPTH = 64;

const SPECIAL: Readonly<Record<string, number>> = { '-0': -0, NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };

const TYPED_NAMES = new Map<unknown, TypedName>(Object.entries(TYPED_ARRAYS).map(([k, v]) => [v.prototype, k as TypedName]));

const specialOf = (x: number): string | null =>
  x !== x ? 'NaN' : x === Infinity ? 'Infinity' : x === -Infinity ? '-Infinity' : x === 0 && 1 / x < 0 ? '-0' : null;

const isPlain = (x: object) => {
  const p = Object.getPrototypeOf(x);
  return p === Object.prototype || p === null;
};

const replacer = (_k: string, x: unknown) => (x === undefined || ArrayBuffer.isView(x) || (typeof x === 'number' && specialOf(x) !== null) ? null : x);

/** 线程这头打包(读口、帮手的结果,一回合、一口递进去的);只认数、字、真假、null、undefined、数组、类型化数组、普通对象 */
export function toWire(v: unknown): Wire {
  const patches: Patch[] = [];
  const bufs: ArrayBuffer[] = [];
  const path: Key[] = [];
  const walk = (x: unknown, depth: number): void => {
    if (depth > WIRE_DEPTH) throw new Error(`套得太深(超过 ${WIRE_DEPTH} 层)`);
    switch (typeof x) {
      case 'number': {
        const s = specialOf(x);
        if (s !== null) patches.push([path.slice(), 1, s]);
        return;
      }
      case 'string':
      case 'boolean':
        return;
      case 'undefined':
        patches.push([path.slice(), 2]);
        return;
      case 'object': {
        if (x === null) return;
        if (ArrayBuffer.isView(x)) {
          const name = TYPED_NAMES.get(Object.getPrototypeOf(x));
          if (!name) throw new Error('递不过去的数组');
          patches.push([path.slice(), 0, name, bufs.length]);
          bufs.push((x as Typed).slice().buffer as ArrayBuffer);
          return;
        }
        if (Array.isArray(x)) {
          for (let i = 0; i < x.length; i++) {
            path.push(i);
            walk(x[i], depth + 1);
            path.pop();
          }
          return;
        }
        if (!isPlain(x)) throw new Error('只能递普通对象');
        for (const k of Object.keys(x)) {
          path.push(k);
          walk((x as Record<string, unknown>)[k], depth + 1);
          path.pop();
        }
        return;
      }
      default:
        throw new Error(`递不过去的值(${typeof x})`);
    }
  };
  walk(v, 0);
  const text = patches.length ? JSON.stringify(v, replacer) : JSON.stringify(v);
  return { text: text ?? 'null', patches: patches.length ? JSON.stringify(patches) : '', bufs };
}

const isKey = (k: unknown): k is Key => typeof k === 'string' || (typeof k === 'number' && Number.isInteger(k) && k >= 0);

/** 这一格能不能换:o 是 JSON 读出来的对象或数组,k 是它自己有的键 */
function slot(o: unknown, k: unknown): o is Record<Key, unknown> {
  if (o === null || typeof o !== 'object' || ArrayBuffer.isView(o) || !isKey(k)) return false;
  return Array.isArray(o) ? typeof k === 'number' && k < o.length : Object.prototype.hasOwnProperty.call(o, k);
}

/**
 * 线程这头拆开 QuickJS 递回来的(插件的回话、调帮手的参数):照补丁换回去。QuickJS 那头是插件能动的,
 * 补丁表、字节一律当不可信的核对:路径只走 JSON 读出来的自己的键,换的时候直接定义成自己的属性
 */
export function fromWire(w: Wire): unknown {
  const bad = (): never => {
    throw new Error('QuickJS 递回来的数据坏了');
  };
  let root: unknown = JSON.parse(w.text);
  if (!w.patches) return root;
  const ps: unknown = JSON.parse(w.patches);
  if (!Array.isArray(ps)) bad();
  for (const q of ps as unknown[]) {
    if (!Array.isArray(q) || !Array.isArray(q[0])) bad();
    const p = q as unknown[];
    const [path, code] = p as [unknown[], unknown];
    let v: unknown;
    if (code === 0) {
      const name = p[2];
      const at = p[3];
      if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(TYPED_ARRAYS, name) || !Number.isInteger(at) || (at as number) < 0 || (at as number) >= w.bufs.length) bad();
      const C = TYPED_ARRAYS[name as TypedName];
      const buf = w.bufs[at as number];
      if (buf.byteLength % C.BYTES_PER_ELEMENT) bad();
      v = new C(buf);
    } else if (code === 1) {
      const s = p[2];
      if (typeof s !== 'string' || !Object.prototype.hasOwnProperty.call(SPECIAL, s)) bad();
      v = SPECIAL[s as string];
    } else if (code === 2) v = undefined;
    else bad();
    if (!path.length) {
      root = v;
      continue;
    }
    let o: unknown = root;
    for (let i = 0; i < path.length - 1; i++) {
      if (!slot(o, path[i])) bad();
      o = (o as Record<Key, unknown>)[path[i] as Key];
    }
    const last = path[path.length - 1];
    if (!slot(o, last)) bad();
    Object.defineProperty(o, last as Key, { value: v, writable: true, enumerable: true, configurable: true });
  }
  return root;
}

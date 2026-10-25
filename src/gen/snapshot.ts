/**
 * 世界的原件:生成好的地图和推演好的整段历史,原样打包成几块二进制(和存档 savefile.ts 分开存)。
 *
 * 存档只记"种子 + 参数 + 修改",打开时按参数重新生成;生成器一升级(GENERATOR_VERSION 加一),同样的存档就会长成另一个样子。
 * 原件存的是当时生成出来的结果本身,以后的版本读它就不用重新生成,还是存档时的样子。
 *
 * 一份原件(Snapshot)= 生成器版本 + 配方指纹 + 几块(SnapshotPart):
 * - map:生成出来的世界(World),不带形成过程的回放快照(history;太大,formation = false 说明没带)
 * - eras:地形大事以后的各段世界(worker.ts 的 EraWorld,不带网格:和 map 是同一套网格,读回来时接上)和原来那段的键
 * - civ:推演好的整段历史(Civ)
 * 每块单独压缩、单独算校验(SHA-256,压缩前的字节),读的时候对不上就不认;以后加别的内容就多加一块,认不出的块原样留着。
 *
 * 配方指纹(recipeKey):生成这份结果用到的全部输入(参数、地形修改、草图、干预、地形大事、地名风格、推演年数、拓荒、起源、文明种子、逐年推演进度),
 * 规范成一个字符串再算 SHA-256。存档里的输入和它一样,这份原件才是这个存档的结果(改了干预、还没推完的不算)。
 *
 * 一块的字节(packValue):
 *   "CIVSNAP1"(8 字节)| 结构的长度(4 字节,小端)| 结构(UTF-8 的 JSON)| 补到 8 的倍数 | 各个数组的原始字节(各自补到 8 的倍数)
 * 结构就是这个值本身,其中数组(Float32Array 等)换成 {"$$":"a","t":"F32","o":偏移,"n":个数},
 * 还有 JSON 写不了的几种也换成带 "$$" 的小对象:Map、Set、undefined、NaN、±Infinity、-0、同一个对象第二次出现(引用)、
 * 本身就有 "$$" 键的对象。字节序一律小端(大端的机器读写都拒绝)。
 *
 * 纯计算,不碰 DOM:worker 里打包,主线程、Node 里都能读。压缩用平台自带的 CompressionStream('gzip'),没有就不压缩。
 */
import { cleanCivSeed, cleanEndYear, cleanPlay, type Intervention, type PlayState, type TerrainOp, type Upheaval } from './edits';
import type { SketchEdit } from './sketch';
import type { NameMix } from './names';
import { cleanFrontier, cleanOrigins, type Frontier, type Origins } from './civ/frontier';
import type { SaveFile } from './savefile';
import type { WorldParams } from './world';

/** 原件格式的版本(各块的结构有不兼容的变化时加一) */
export const SNAPSHOT_FORMAT = 1;

/** 一块原件 */
export interface SnapshotPart {
  /** 哪一块:map / eras / civ(以后可能有别的) */
  name: string;
  /** 压缩前的字节数 */
  bytes: number;
  /** 压缩前字节的 SHA-256(十六进制) */
  sum: string;
  /** 压缩方式:gzip / none */
  zip: 'gzip' | 'none';
  data: ArrayBuffer;
}

/** 一份原件 */
export interface Snapshot {
  format: typeof SNAPSHOT_FORMAT;
  /** 生成它的生成器版本(GENERATOR_VERSION) */
  generator: number;
  /** 配方指纹(recipeKey) */
  recipe: string;
  /** 带没带形成过程的回放快照(现在都不带) */
  formation: boolean;
  parts: SnapshotPart[];
}

// ---------------------------------------------------------------------------
// 配方指纹

/** 生成一份结果用到的全部输入(和 worker.ts 推文明的请求里同名的几项一样) */
export interface Recipe {
  params: WorldParams;
  terrain?: readonly TerrainOp[];
  sketch?: SketchEdit;
  interventions?: readonly Intervention[];
  upheavals?: readonly Upheaval[];
  names?: NameMix;
  endYear?: number;
  frontier?: Frontier;
  origins?: Origins;
  /** 文明种子(没给 = 地图种子;不给时和加这一项以前的指纹一样) */
  civSeed?: number;
  /** 逐年推演的进度(推到哪年 + 命令串;没在逐年推演 = 不给,和加这一项以前的指纹一样) */
  play?: PlayState;
}

/** 规范成固定的样子:对象的键排好序、去掉 undefined;顶层的空数组、空对象、3000 年(默认的推演年数)当没给 */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canon(x);
    }
    return out;
  }
  return v;
}

/** 配方规范成的字符串(recipeKey 对它算指纹;单测直接比它) */
export function recipeText(r: Recipe): string {
  const top: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) ? !v.length : typeof v === 'object' && !Object.keys(v).length) continue;
    if (k === 'endYear' && v === 3000) continue;
    top[k] = v;
  }
  return JSON.stringify(canon(top));
}

/** 存档里的配方:和 App 推这个(建好的)世界时交给 worker 的那几项取法一样 */
export function recipeOfSave(save: SaveFile): Recipe {
  const e = save.edits;
  return {
    params: save.params,
    terrain: e.terrain,
    sketch: e.sketch,
    interventions: e.interventions,
    upheavals: e.upheavals,
    names: e.nameMix,
    endYear: cleanEndYear(e.endYear),
    frontier: cleanFrontier(e.frontier),
    origins: cleanOrigins(e.origins),
    civSeed: cleanCivSeed(e.civSeed),
    play: cleanPlay(e.play),
  };
}

/** 配方指纹:规范成的字符串的 SHA-256(十六进制) */
export function recipeKey(r: Recipe): Promise<string> {
  return sha256(new TextEncoder().encode(recipeText(r)));
}

// ---------------------------------------------------------------------------
// 校验、压缩

/** SHA-256(十六进制) */
export async function sha256(data: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let s = '';
  for (const b of h) s += b.toString(16).padStart(2, '0');
  return s;
}

const canZip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function through(data: Uint8Array, ts: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(ts);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ---------------------------------------------------------------------------
// 打包、读回一个值

const MAGIC = 'CIVSNAP1';
/** 数组种类 ↔ 结构里的短名 */
const ARRAYS = {
  F32: Float32Array,
  F64: Float64Array,
  I8: Int8Array,
  U8: Uint8Array,
  U8C: Uint8ClampedArray,
  I16: Int16Array,
  U16: Uint16Array,
  I32: Int32Array,
  U32: Uint32Array,
} as const;
type ArrayTag = keyof typeof ARRAYS;
type Typed = InstanceType<(typeof ARRAYS)[ArrayTag]>;

function tagOf(a: ArrayBufferView): ArrayTag | null {
  for (const [t, C] of Object.entries(ARRAYS)) if (a instanceof C) return t as ArrayTag;
  return null;
}

const littleEndian = () => new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const pad8 = (n: number) => (n + 7) & ~7;

/**
 * 把一个值(普通对象、数组、数字、字符串、布尔、null、undefined、Map、Set、各种数字数组)打成字节。
 * 函数、类的实例、BigInt 这些认不出的直接抛错(世界和历史里不该有)
 */
export function packValue(root: unknown): Uint8Array {
  if (!littleEndian()) throw new Error('大端的机器不支持');
  const arrays: Typed[] = [];
  let at = 0;
  const seen = new Map<object, number>();
  let nextId = 0;
  const enc = (v: unknown): unknown => {
    if (v === undefined) return { $$: 'u' };
    if (typeof v === 'number') {
      if (Number.isNaN(v)) return { $$: 'n', v: 'NaN' };
      if (v === Infinity) return { $$: 'n', v: 'Inf' };
      if (v === -Infinity) return { $$: 'n', v: '-Inf' };
      if (Object.is(v, -0)) return { $$: 'n', v: '-0' };
      return v;
    }
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return v;
    if (typeof v !== 'object') throw new Error(`原件里不能有 ${typeof v}`);
    // 同一个对象第二次出现:记成引用(读回来还是同一个对象)。编号按第一次遇到的先后,读的时候按同样的先后编
    const ref = seen.get(v);
    if (ref !== undefined) return { $$: 'r', i: ref };
    seen.set(v, nextId++);
    if (ArrayBuffer.isView(v)) {
      const t = tagOf(v);
      if (!t) throw new Error('原件里不能有这种数组');
      const a = v as Typed;
      const o = at;
      arrays.push(a);
      at = pad8(at + a.byteLength);
      return { $$: 'a', t, o, n: a.length };
    }
    if (v instanceof Map) return { $$: 'm', v: [...v].map(([k, x]) => [enc(k), enc(x)]) };
    if (v instanceof Set) return { $$: 's', v: [...v].map(enc) };
    if (Array.isArray(v)) return v.map(enc);
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) throw new Error('原件里不能有类的实例');
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = enc((v as Record<string, unknown>)[k]);
    return '$$' in out ? { $$: 'o', v: out } : out;
  };
  const head = new TextEncoder().encode(JSON.stringify(enc(root)));
  const start = pad8(MAGIC.length + 4 + head.length);
  const bytes = new Uint8Array(start + at);
  for (let i = 0; i < MAGIC.length; i++) bytes[i] = MAGIC.charCodeAt(i);
  new DataView(bytes.buffer).setUint32(MAGIC.length, head.length, true);
  bytes.set(head, MAGIC.length + 4);
  let o = start;
  for (const a of arrays) {
    bytes.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), o);
    o = pad8(o + a.byteLength);
  }
  return bytes;
}

/** packValue 打的字节读回成值(数组各自复制一份,不和这些字节共用);格式不对抛错 */
export function unpackValue(bytes: Uint8Array): unknown {
  if (!littleEndian()) throw new Error('大端的机器不支持');
  if (bytes.length < MAGIC.length + 4) throw new Error('原件不完整');
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error('不是原件');
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length, true);
  if (MAGIC.length + 4 + len > bytes.length) throw new Error('原件不完整');
  const raw = JSON.parse(new TextDecoder().decode(bytes.subarray(MAGIC.length + 4, MAGIC.length + 4 + len))) as unknown;
  const start = pad8(MAGIC.length + 4 + len);
  const objs: unknown[] = [];
  const dec = (v: unknown): unknown => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      objs.push(out);
      for (const x of v) out.push(dec(x));
      return out;
    }
    const o = v as Record<string, unknown>;
    switch (o.$$) {
      case undefined: {
        const out: Record<string, unknown> = {};
        objs.push(out);
        for (const k of Object.keys(o)) out[k] = dec(o[k]);
        return out;
      }
      case 'o': {
        const out: Record<string, unknown> = {};
        objs.push(out);
        const inner = o.v as Record<string, unknown>;
        for (const k of Object.keys(inner)) out[k] = dec(inner[k]);
        return out;
      }
      case 'u':
        return undefined;
      case 'n':
        return o.v === 'NaN' ? NaN : o.v === 'Inf' ? Infinity : o.v === '-Inf' ? -Infinity : -0;
      case 'r': {
        const i = o.i as number;
        if (!(i >= 0 && i < objs.length)) throw new Error('原件里的引用指不到');
        return objs[i];
      }
      case 'a': {
        const C = ARRAYS[o.t as ArrayTag];
        const n = o.n as number;
        const off = o.o as number;
        if (!C || !Number.isInteger(n) || n < 0 || !Number.isInteger(off) || off < 0) throw new Error('原件里的数组不对');
        const end = start + off + n * C.BYTES_PER_ELEMENT;
        if (end > bytes.length) throw new Error('原件不完整');
        const out = new C(n);
        new Uint8Array(out.buffer).set(bytes.subarray(start + off, end));
        objs.push(out);
        return out;
      }
      case 'm': {
        const out = new Map<unknown, unknown>();
        objs.push(out);
        for (const [k, x] of o.v as [unknown, unknown][]) out.set(dec(k), dec(x));
        return out;
      }
      case 's': {
        const out = new Set<unknown>();
        objs.push(out);
        for (const x of o.v as unknown[]) out.add(dec(x));
        return out;
      }
      default:
        throw new Error('原件里有认不出的东西');
    }
  };
  return dec(raw);
}

// ---------------------------------------------------------------------------
// 一块

/** 把一个值打成一块原件(打包、算校验、能压缩就压缩) */
export async function makePart(name: string, value: unknown): Promise<SnapshotPart> {
  const raw = packValue(value);
  const sum = await sha256(raw);
  const zipped = canZip() ? await through(raw, new CompressionStream('gzip')) : null;
  const data = zipped ?? raw;
  const buf = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength ? (data.buffer as ArrayBuffer) : (data.slice().buffer as ArrayBuffer);
  return { name, bytes: raw.length, sum, zip: zipped ? 'gzip' : 'none', data: buf };
}

/** 读回一块原件;解不开、校验对不上抛错 */
export async function readPart(part: SnapshotPart): Promise<unknown> {
  let raw = new Uint8Array(part.data);
  if (part.zip === 'gzip') {
    if (!canZip()) throw new Error('这个浏览器太旧,解不开原件');
    raw = await through(raw, new DecompressionStream('gzip'));
  } else if (part.zip !== 'none') throw new Error('原件的压缩方式认不出');
  if (raw.length !== part.bytes || (await sha256(raw)) !== part.sum) throw new Error('原件对不上校验');
  return unpackValue(raw);
}

/** 原件里叫 name 的那一块;没有 = undefined */
export function partOf(s: Snapshot, name: string): SnapshotPart | undefined {
  return s.parts.find((p) => p.name === name);
}

/** 一份原件压缩后一共多少字节 */
export function snapshotSize(s: Snapshot): number {
  return s.parts.reduce((n, p) => n + p.data.byteLength, 0);
}

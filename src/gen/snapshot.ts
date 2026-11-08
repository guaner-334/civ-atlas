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
 * 配方指纹(recipeKey):生成这份结果用到的全部输入(参数、地形修改、草图、干预、地形大事、地名风格、推演年数、拓荒、起源、天灾、规则、文明种子、逐年推演进度),
 * 规范成一个字符串再算 SHA-256。存档里的输入和它一样,这份原件才是这个存档的结果(改了干预、还没推完的不算)。
 *
 * 一块的字节(packValue):
 *   "CIVSNAP1"(8 字节)| 结构的长度(4 字节,小端)| 结构(UTF-8 的 JSON)| 补到 8 的倍数 | 各个数组的原始字节(各自补到 8 的倍数)
 * 结构就是这个值本身,其中数组(Float32Array 等)换成 {"$$":"a","t":"F32","o":偏移,"n":个数},
 * 还有 JSON 写不了的几种也换成带 "$$" 的小对象:Map、Set、undefined、NaN、±Infinity、-0、同一个对象第二次出现(引用)、
 * 本身就有 "$$" 键的对象。字节序一律小端(大端的机器读写都拒绝)。
 *
 * 读的时候把字节当成别人写的(以后世界可以从文件读进来,每个数字、每个字都可能是乱填的):解压边解边数,超上限立刻停;
 * 对象的键不许是 __proto__、constructor、prototype;引用只能指已经读完的对象;层数、结构大小都有上限。出错一律抛 Error,不卡死。
 * 这些上限只管「能不能安全读完」,读出来的内容对不对(编号在不在范围里之类)不归这里管。
 *
 * 纯计算,不碰 DOM:worker 里打包,主线程、Node 里都能读。压缩用平台自带的 CompressionStream('gzip'),没有就不压缩。
 */
import { sha256, type Snapshot, type SnapshotPart } from './recipe';
import { PLUGIN_LAYER_MAX_BYTES, PLUGIN_LAYER_PREFIX, SIM_STATE_MAX_BYTES, SIM_STATE_PREFIX } from './worldFormat';

export * from './recipe';

// ---------------------------------------------------------------------------
// 读的时候的上限

/** 上限里的 MB 按 100 万字节算,和量世界大小时的算法一样 */
const MB = 1e6;
/**
 * 各块解压后最多多大。按量到的最大的世界(20 万地块、6 万年、5 件地形大事、陆地 95%)留余量:地图实测 27.6 MB,各段世界(最多 5 段)53.2 MB,
 * 历史 246.8 MB,编年史 54.4 MB
 */
const PART_LIMITS: ReadonlyMap<string, number> = new Map([
  ['map', 40 * MB],
  ['eras', 80 * MB],
  ['civ', 320 * MB],
  ['chronicle', 80 * MB],
  // 各国历代的旗:实测最大(20 万地块、6 万年)不到 1 MB
  ['flags', 16 * MB],
  // AI 写的正文:量不出最大值(看作者写多少),按编年史的量级给足,别让写得多的世界打不开
  ['author', 64 * MB],
  // 封面:480 × 240 的 JPEG 几十 KB
  ['thumb', 2 * MB],
  // 星球参照:实测 3.6 万、20 万地块都是几十个地名,不到 10 KB
  ['planet', 4 * MB],
]);
/**
 * 认不出的块名给 16 MB。认不出的块本来就只原样留着、不用解开;真要读的只会是以后新加的块,那时在上面的表里按实测写明上限。
 * 没量过的东西不能照最大的给:别人的文件里块名是随便写的,给大了等于让它挑最大的额度来撑内存;给小了最多是这一块读不出来
 */
const UNKNOWN_PART_LIMIT = 16 * MB;
/** 一块里结构(JSON)最多多大:实测最大 71.6 MB */
const MAX_HEAD_BYTES = 96 * MB;
/**
 * 本机存取的世界文件用这两个数,代替上面的表和 MAX_HEAD_BYTES:本机不限世界多大,上面的表是给传上服务器的文件防撑爆内存的。
 * 这两个数只防撑爆内存:一块最多解到 1 GB,和本机的文件大小上限(zipStore.ts 的 ZIP_LOCAL_MAX_BYTES)一个数;
 * 结构再大 JavaScript 的字符串也放不下(最长约 5.4 亿个字符)
 */
export const LOCAL_PART_MAX_BYTES = 1e9;
export const LOCAL_HEAD_MAX_BYTES = 512 * MB;
/** 结构最多几层:真实世界不到 20 层(单测盯着)。限了层数,读的时候递归才不会把栈撑爆 */
const MAX_DEPTH = 64;
/**
 * 把引用都展开成一棵树,最多多少个值(不带引用的结构再大也到不了:96 MB 的 JSON 最多四千多万个值;真实世界的引用只有几十个,展开也多不了多少)。
 * 几十层、每层引用上一层两次,文件才几 KB,展开有几万亿个值;后面哪段代码按树走一遍就卡死了,所以读的时候就拒绝
 */
const MAX_NODES = 1e8;

/** 这一块解压后最多多大 */
export function partLimit(name: string): number {
  return PART_LIMITS.get(name) ?? (name.startsWith(SIM_STATE_PREFIX) ? SIM_STATE_MAX_BYTES : name.startsWith(PLUGIN_LAYER_PREFIX) ? PLUGIN_LAYER_MAX_BYTES : UNKNOWN_PART_LIMIT);
}

/**
 * 不许当对象键的几个名字:读回来会换掉对象的原型、盖掉谁都默认有的字段,后面的代码就读到文件里明面上没写的东西。
 * 真实数据里对象的键只有代码写死的字段名、数表名和数字编号:用户起的名字(国名、城名、人名、改名……)都在值里,不当键,
 * 用户叫 constructor 也读得开。按名字索引的表一律用 Map(Map 的键不受这条限制)。packValue 也拒绝这几个键,写得出来的就读得回来
 */
const isBadKey = (k: string) => k === '__proto__' || k === 'constructor' || k === 'prototype';

// ---------------------------------------------------------------------------
// 校验、压缩

const canZip = () => typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';

async function through(data: Uint8Array, ts: CompressionStream): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(ts);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 解压时一次喂多少压缩的字节 */
const INFLATE_SLICE = 64 * 1024;

/**
 * 解压,一边解一边数:比 expect 多一个字节就停,后面的不再解(压缩炸弹撑不开内存)。
 * 比 expect 少的,交回解出来的那些(读的地方核对长度时拒绝)。
 * 压缩的字节自己切成小段、要一段喂一段:浏览器的 Blob 流一次给多少由它定,一次给得多,解压那一步在交回来之前就可能撑开几十 GB;
 * 这样不管哪个浏览器,多解的也就一段的量(gzip 最多放大约 1000 倍,不到 70 MB,而且这些字节不留)
 */
async function inflate(data: Uint8Array, expect: number): Promise<Uint8Array> {
  let at = 0;
  const source = new ReadableStream<Uint8Array>(
    {
      pull(c) {
        if (at >= data.length) return c.close();
        c.enqueue(data.subarray(at, at + INFLATE_SLICE));
        at += INFLATE_SLICE;
      },
    },
    { highWaterMark: 0 },
  );
  const reader = (source.pipeThrough(new DecompressionStream('gzip')) as ReadableStream<Uint8Array>).getReader();
  const out = new Uint8Array(expect);
  let n = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return out.subarray(0, n);
      if (value.length > expect - n) throw new Error('原件解压出来比说好的大');
      out.set(value, n);
      n += value.length;
    }
  } catch (err) {
    // 上游的解压、读字节一起停下;已经出错的流再取消也会出错,不用管
    reader.cancel().catch(() => undefined);
    throw err;
  }
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
    for (const k of Object.keys(v)) {
      if (isBadKey(k)) throw new Error(`原件里不能有叫 ${k} 的键`);
      out[k] = enc((v as Record<string, unknown>)[k]);
    }
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

/**
 * 结构的字节最深几层,超上限就拒绝(还没开始 JSON.parse):字符串里的括号不算。
 * 不是合格 JSON 的,这里算出来的层数不作数,接着 JSON.parse 会拒绝
 */
export function checkDepth(head: Uint8Array): void {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < head.length; i++) {
    const c = head[i];
    if (inString) {
      if (c === 0x5c) i++; // 反斜杠:下一个字节是转义的
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x5b || c === 0x7b) {
      if (++depth > MAX_DEPTH) throw new Error('原件的结构层数太多');
    } else if (c === 0x5d || c === 0x7d) depth--;
  }
}

/** packValue 打的字节读回成值(数组各自复制一份,不和这些字节共用);格式不对、超上限抛错。字节当别人写的看(见文件头)。maxHead = 结构最多多大 */
export function unpackValue(bytes: Uint8Array, maxHead: number = MAX_HEAD_BYTES): unknown {
  if (!littleEndian()) throw new Error('大端的机器不支持');
  if (bytes.length < MAGIC.length + 4) throw new Error('原件不完整');
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) throw new Error('不是原件');
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(MAGIC.length, true);
  if (len > maxHead) throw new Error('原件的结构太大');
  if (MAGIC.length + 4 + len > bytes.length) throw new Error('原件不完整');
  const head = bytes.subarray(MAGIC.length + 4, MAGIC.length + 4 + len);
  checkDepth(head);
  const raw = JSON.parse(new TextDecoder().decode(head)) as unknown;
  const start = pad8(MAGIC.length + 4 + len);
  // 读到过的对象,编号按第一次遇到的先后(和 packValue 一样)
  const objs: unknown[] = [];
  // 各对象展开成树有多少个值;还没读完的是 -1(这时候引用它就成环了)
  const sizes: number[] = [];
  // 到现在一共读了多少个值(引用按展开算)
  let nodes = 0;
  // 各个数组一共要多少字节:几个数组指同一段字节不会更占地方,但结构里写上几百万遍就能把内存撑爆;老实打的包不重叠,加起来放得下
  let arrayBytes = 0;
  const open = (out: unknown) => {
    sizes.push(-1);
    return objs.push(out) - 1;
  };
  const object = (o: Record<string, unknown>) => {
    const out: Record<string, unknown> = {};
    const id = open(out);
    const from = nodes;
    for (const k of Object.keys(o)) {
      if (isBadKey(k)) throw new Error(`原件里有不许用的键 ${k}`);
      out[k] = dec(o[k]);
    }
    sizes[id] = nodes - from;
    return out;
  };
  const dec = (v: unknown): unknown => {
    nodes++;
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      const id = open(out);
      const from = nodes;
      for (const x of v) out.push(dec(x));
      sizes[id] = nodes - from;
      return out;
    }
    const o = v as Record<string, unknown>;
    switch (o.$$) {
      case undefined:
        return object(o);
      case 'o': {
        if (o.v === null || typeof o.v !== 'object' || Array.isArray(o.v)) throw new Error('原件里的对象不对');
        return object(o.v as Record<string, unknown>);
      }
      case 'u':
        return undefined;
      case 'n':
        if (o.v === 'NaN') return NaN;
        if (o.v === 'Inf') return Infinity;
        if (o.v === '-Inf') return -Infinity;
        if (o.v === '-0') return -0;
        throw new Error('原件里的数字不对');
      case 'r': {
        const i = o.i as number;
        if (!Number.isInteger(i) || i < 0 || i >= objs.length) throw new Error('原件里的引用指不到');
        if (sizes[i] < 0) throw new Error('原件里的引用成环');
        nodes += sizes[i];
        if (nodes > MAX_NODES) throw new Error('原件里的引用展开太多');
        return objs[i];
      }
      case 'a': {
        const t = o.t;
        const C = typeof t === 'string' && Object.prototype.hasOwnProperty.call(ARRAYS, t) ? ARRAYS[t as ArrayTag] : null;
        const n = o.n as number;
        const off = o.o as number;
        if (!C || !Number.isInteger(n) || n < 0 || !Number.isInteger(off) || off < 0) throw new Error('原件里的数组不对');
        const size = n * C.BYTES_PER_ELEMENT;
        const end = start + off + size;
        if (end > bytes.length) throw new Error('原件不完整');
        arrayBytes += size;
        if (arrayBytes > bytes.length - start) throw new Error('原件里的数组重叠');
        const out = new C(n);
        new Uint8Array(out.buffer).set(bytes.subarray(start + off, end));
        sizes[open(out)] = 1;
        return out;
      }
      case 'm': {
        if (!Array.isArray(o.v)) throw new Error('原件里的 Map 不对');
        const out = new Map<unknown, unknown>();
        const id = open(out);
        const from = nodes;
        for (const e of o.v as unknown[]) {
          if (!Array.isArray(e) || e.length !== 2) throw new Error('原件里的 Map 不对');
          out.set(dec(e[0]), dec(e[1]));
        }
        sizes[id] = nodes - from;
        return out;
      }
      case 's': {
        if (!Array.isArray(o.v)) throw new Error('原件里的 Set 不对');
        const out = new Set<unknown>();
        const id = open(out);
        const from = nodes;
        for (const x of o.v as unknown[]) out.add(dec(x));
        sizes[id] = nodes - from;
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

/**
 * 读回一块原件;解不开、超上限、校验对不上抛错。
 * 说好的字节数先看:超这块的上限不开始解;解的时候比说好的多就停,所以解多少由 min(上限, 说好的) 管着,压缩炸弹撑不开内存
 */
export async function readPart(part: SnapshotPart): Promise<unknown> {
  if (Object.prototype.toString.call(part.data) !== '[object ArrayBuffer]') throw new Error('原件的字节不对');
  return unpackValue(await partBytes(part, new Uint8Array(part.data)));
}

/**
 * 读回存在这台设备上的一块原件:和 readPart 一样核对,上限换成本机那两个数(LOCAL_PART_MAX_BYTES、LOCAL_HEAD_MAX_BYTES)。
 * 上面那张表是给传上服务器的文件用的,用的人自己推出来的世界可以比它大;
 * 用那张表读,这种世界读不出来,就会退回按存档重新生成,生成器一升级它就变样了
 */
export async function readLocalPart(part: SnapshotPart): Promise<unknown> {
  if (Object.prototype.toString.call(part.data) !== '[object ArrayBuffer]') throw new Error('原件的字节不对');
  return unpackValue(await partBytes(part, new Uint8Array(part.data), LOCAL_PART_MAX_BYTES), LOCAL_HEAD_MAX_BYTES);
}

/**
 * 一块解压后的字节:解不开、超上限、校验对不上抛错(规矩同 readPart)。data 是这一块压缩后的字节;没压缩的直接交回 data 本身。
 * 不是 packValue 打的块(封面)也从这里取。limit = 这一块最多多大
 */
export async function partBytes(part: Pick<SnapshotPart, 'name' | 'bytes' | 'sum' | 'zip'>, data: Uint8Array, limit: number = partLimit(part.name)): Promise<Uint8Array> {
  const { bytes, zip } = part;
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > limit) throw new Error('原件这一块超过上限');
  let raw = data;
  if (zip === 'gzip') {
    if (!canZip()) throw new Error('这个浏览器太旧,解不开原件');
    raw = await inflate(raw, bytes);
  } else if (zip !== 'none') throw new Error('原件的压缩方式认不出');
  if (raw.length !== bytes || (await sha256(raw)) !== part.sum) throw new Error('原件对不上校验');
  return raw;
}

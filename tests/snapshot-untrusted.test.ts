import { isDeepStrictEqual } from 'node:util';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCiv } from '../src/gen/civ';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { applyNames, cultureKey, personKey, polityKey, regionKey, settlementKey, type Upheaval } from '../src/gen/edits';
import { makePart, packValue, partLimit, readPart, sha256, unpackValue, type SnapshotPart } from '../src/gen/snapshot';
import { mulberry32 } from '../src/gen/util';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';

/** 手工拼一块:结构(JSON 字符串)+ 数组的字节 */
function pack(head: string, body: Uint8Array = new Uint8Array(0)): Uint8Array {
  const h = new TextEncoder().encode(head);
  const start = (12 + h.length + 7) & ~7;
  const b = new Uint8Array(start + body.length);
  b.set(new TextEncoder().encode('CIVSNAP1'), 0);
  new DataView(b.buffer).setUint32(8, h.length, true);
  b.set(h, 12);
  b.set(body, start);
  return b;
}
const read = (head: string, body?: Uint8Array) => unpackValue(pack(head, body));

/** 把一块原件的结构读成字符串 */
function headOf(bytes: Uint8Array): string {
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(8, true);
  return new TextDecoder().decode(bytes.subarray(12, 12 + len));
}

/** 读出来的值:没有环、原型没被换掉、没有不许用的键(按树走,走过的不再走) */
function expectClean(root: unknown) {
  const stack = new Set<object>();
  const done = new Set<object>();
  // 真实世界有几万个对象,这里不用 expect(一个值一个 expect 太慢)
  const walk = (v: unknown) => {
    if (v === null || typeof v !== 'object') return;
    if (stack.has(v)) throw new Error('读出来的值成环');
    if (done.has(v)) return;
    done.add(v);
    if (ArrayBuffer.isView(v)) return;
    stack.add(v);
    if (Array.isArray(v)) v.forEach(walk);
    else if (v instanceof Map) v.forEach((x, k) => (walk(k), walk(x)));
    else if (v instanceof Set) v.forEach(walk);
    else {
      if (Object.getPrototypeOf(v) !== Object.prototype) throw new Error('读出来的对象原型被换掉');
      for (const k of Object.keys(v)) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new Error(`读出来的对象有键 ${k}`);
        walk((v as Record<string, unknown>)[k]);
      }
    }
    stack.delete(v);
  };
  walk(root);
}

/** 所有带标记的写法都用上的小样本 */
const SAMPLE = () => {
  const shared = [1, 2];
  const arr = new Float32Array([1.5, NaN, -0, Infinity]);
  return {
    a: undefined,
    list: [undefined, null, 1, 'x', true],
    n: [NaN, Infinity, -Infinity, -0, 0, 3.25],
    m: new Map<unknown, unknown>([
      [1, 'one'],
      ['k', { z: new Int16Array([-3, 4]) }],
    ]),
    s: new Set([1, 'b']),
    odd: { $$: 'not a tag', x: 1 },
    arr,
    again: arr,
    p: shared,
    q: shared,
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('读原件:格式不变', () => {
  /** 现在的字节格式写死在这里:改了打包的写法,已经存在用户浏览器里的原件就读不了了 */
  const OLD_HEAD = '{"a":{"$$":"a","t":"I16","o":0,"n":2},"b":{"$$":"r","i":1},"c":{"$$":"u"},"d":{"$$":"n","v":"-0"},"e":{"$$":"n","v":"NaN"},"m":{"$$":"m","v":[["k",1]]},"s":{"$$":"s","v":[1]},"o":{"$$":"o","v":{"$$":"x"}},"f":[{"$$":"r","i":1},1.5,"字",null,true]}';
  const OLD_BODY = new Uint8Array([1, 0, 2, 0, 0, 0, 0, 0]);
  const value = () => {
    const a = new Int16Array([1, 2]);
    return { a, b: a, c: undefined, d: -0, e: NaN, m: new Map([['k', 1]]), s: new Set([1]), o: { $$: 'x' }, f: [a, 1.5, '字', null, true] };
  };

  it('打出来的字节和以前一模一样,以前的字节读得回来', () => {
    const old = pack(OLD_HEAD, OLD_BODY);
    expect(Buffer.compare(packValue(value()), old)).toBe(0);
    const back = unpackValue(old) as ReturnType<typeof value>;
    expect(isDeepStrictEqual(back, value())).toBe(true);
    expect(back.b).toBe(back.a);
    expect(back.f[0]).toBe(back.a);
  });

  it('小样本打包再读回,各种写法都一样', () => {
    const v = SAMPLE();
    const back = unpackValue(packValue(v)) as typeof v;
    expect(isDeepStrictEqual(back, v)).toBe(true);
    expect(back.again).toBe(back.arr);
    expect(back.p).toBe(back.q);
    expectClean(back);
  });
});

describe('读原件:真实的小世界', () => {
  const params = { ...DEFAULT_PARAMS, seed: 7, cells: 4000 };
  const endYear = 1000;
  const world = generateWorld(params);
  const ups: Upheaval[] = [
    { year: 400, ops: [{ kind: 'sink', pts: [1856, 574, 1936, 584], r: 40, s: 1.1 }] },
    { year: 700, ops: [{ kind: 'raise', pts: [900, 300, 1000, 320], r: 40, s: 1.1 }] },
  ];
  const steps = upheavalSteps(params, [], null, ups, { endYear });
  const civ = generateCiv(world, { upheavals: steps, endYear });
  const { history: _h, ...map } = world;
  void _h;
  const eras = steps.map((s) => {
    const { mesh: _m, history: _x, ...rest } = s.world;
    void _m;
    void _x;
    return { key: `k${s.year}`, world: { ...rest, history: [] } };
  });

  it('地图、各段世界、历史都带着引用,打成块再读回逐项相等', async () => {
    for (const [name, value, refs] of [
      ['map', { ...map, history: [] }, 0],
      ['eras', { baseKey: 'k0', eras }, 1],
      ['civ', civ, 1],
    ] as const) {
      const part = await makePart(name, value);
      const raw = packValue(value);
      expect(part.sum).toBe(await sha256(raw));
      // 引用不能简单禁掉:真实世界就有(颜色数组、各段世界共用的数组)
      expect(headOf(raw).split('"$$":"r"').length - 1, name).toBeGreaterThanOrEqual(refs);
      const back = await readPart(part);
      expect(isDeepStrictEqual(back, value), name).toBe(true);
      expectClean(back);
    }
  });

  it('真实世界的层数离上限很远', () => {
    const depth = (head: string) => {
      let d = 0;
      let max = 0;
      let s = false;
      for (let i = 0; i < head.length; i++) {
        const c = head[i];
        if (s) {
          if (c === '\\') i++;
          else if (c === '"') s = false;
        } else if (c === '"') s = true;
        else if (c === '[' || c === '{') max = Math.max(max, ++d);
        else if (c === ']' || c === '}') d--;
      }
      return max;
    };
    expect(depth(headOf(packValue(civ)))).toBeLessThan(20);
    expect(depth(headOf(packValue({ baseKey: 'k0', eras })))).toBeLessThan(20);
  });

  it('用户把国、城、民族、州、人物起名叫 constructor、__proto__、prototype,世界照样读得开', async () => {
    const names: Record<string, string> = {
      [polityKey(civ, civ.polities[0].id)]: 'constructor',
      [settlementKey(civ, civ.settlements[0].id)]: '__proto__',
      [cultureKey(civ, 0)]: 'prototype',
      [regionKey(civ, 0)]: 'constructor',
      [personKey(civ, 0)]: '__proto__',
    };
    const renamed = applyNames(civ, names);
    expect(renamed).not.toBe(civ);
    expect(renamed.polities[0].name).toContain('constructor');
    expect(renamed.settlements[0].name).toBe('__proto__');
    expect(renamed.cultures[0].name).toBe('prototype');
    expect(renamed.regionNames?.[0]).toBe('constructor');
    const back = await readPart(await makePart('civ', renamed));
    expect(isDeepStrictEqual(back, renamed)).toBe(true);
    expectClean(back);
  });
});

describe('读原件:坏结构', () => {
  it.each(['__proto__', 'constructor', 'prototype'])('键 %s 直接拒绝(明面的、藏在 $$ 对象里的、深处的)', (k) => {
    expect(() => read(`{"${k}":{"polities":"假的"}}`)).toThrow('不许用的键');
    expect(() => read(`{"$$":"o","v":{"$$":"x","${k}":1}}`)).toThrow('不许用的键');
    expect(() => read(`{"a":[{"b":{"${k}":1}}]}`)).toThrow('不许用的键');
  });

  it('带 __proto__ 的文件不会凭空多字段,也不会污染所有对象', () => {
    expect(() => read('{"__proto__":{"polities":"假的"}}')).toThrow();
    expect(({} as Record<string, unknown>).polities).toBeUndefined();
  });

  it('不许用的名字当值、当 Map 的键都没事(用户起的名字走这些地方)', () => {
    const v = { a: 'constructor', b: ['__proto__', 'prototype'], m: new Map([['constructor', 1], ['__proto__', 2]]), s: new Set(['prototype']) };
    const back = unpackValue(packValue(v));
    expect(isDeepStrictEqual(back, v)).toBe(true);
    expectClean(back);
  });

  it('写的时候也不写这几个键(写得出来的就读得回来)', () => {
    expect(() => packValue({ constructor: 1 })).toThrow('不能有');
    expect(() => packValue({ a: [{ prototype: 1 }] })).toThrow('不能有');
    expect(() => packValue(JSON.parse('{"__proto__":{"x":1}}'))).toThrow('不能有');
  });

  it('引用:指自己、指祖先、指后面的、不是整数的都拒绝,指读完的可以', () => {
    expect(() => read('{"a":{"$$":"r","i":0}}')).toThrow('成环');
    expect(() => read('[[{"$$":"r","i":0}]]')).toThrow('成环');
    expect(() => read('[[{"$$":"r","i":1}]]')).toThrow('成环');
    expect(() => read('{"m":{"$$":"m","v":[[1,{"$$":"r","i":1}]]}}')).toThrow('成环');
    expect(() => read('{"s":{"$$":"s","v":[{"$$":"r","i":1}]}}')).toThrow('成环');
    expect(() => read('{"$$":"o","v":{"$$":"x","a":{"$$":"r","i":0}}}')).toThrow('成环');
    expect(() => read('[{"$$":"r","i":1},[]]')).toThrow('指不到');
    for (const i of ['-1', '1.5', '"0"', 'null', '[0]', '1e300']) expect(() => read(`[[],{"$$":"r","i":${i}}]`), i).toThrow('指不到');
    const v = read('[[1],{"$$":"r","i":1},{"x":{"$$":"r","i":1}}]') as [number[], number[], { x: number[] }];
    expect(v[1]).toBe(v[0]);
    expect(v[2].x).toBe(v[0]);
  });

  it('引用炸弹:每层引用上一层两次,几 KB 展开有天文数字个值,马上拒绝', () => {
    // 编号按第一次遇到的先后:根是 0,[1,2] 是 1,之后每层一个新数组,引用上一层的数组两次
    const bomb = (levels: number) => {
      let head = '[[1,2]';
      for (let i = 0; i < levels; i++) head += `,[{"$$":"r","i":${i + 1}},{"$$":"r","i":${i + 1}}]`;
      return head + ']';
    };
    const t0 = performance.now();
    expect(() => read(bomb(40))).toThrow('展开太多');
    expect(performance.now() - t0).toBeLessThan(500);
    // 展开不多的不受影响
    expect((read(bomb(8)) as unknown[]).length).toBe(9);
  });

  it('嵌套:20 万层在 JSON.parse 以前就拒绝,64 层可以,字符串里的括号不算', () => {
    const parse = vi.spyOn(JSON, 'parse');
    expect(() => read('['.repeat(200000) + ']'.repeat(200000))).toThrow('层数太多');
    expect(() => read('{"a":'.repeat(200000) + '1' + '}'.repeat(200000))).toThrow('层数太多');
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
    expect(() => read('['.repeat(65) + ']'.repeat(65))).toThrow('层数太多');
    expect(() => read('['.repeat(64) + ']'.repeat(64))).not.toThrow();
    const strings = JSON.stringify(['['.repeat(1000), '"\\[[[', '{{{{\\']);
    expect(read(strings)).toEqual(JSON.parse(strings));
    // 转义的引号不会让字符串提前结束,字符串外的括号照数
    expect(() => read('["\\"",' + '['.repeat(70) + ']'.repeat(70) + ']')).toThrow('层数太多');
  });

  it('结构的上限可以由调用方给(本机存取的世界比传上服务器的大)', () => {
    const b = packValue({ a: 'x'.repeat(1000) });
    expect(() => unpackValue(b, 100)).toThrow('结构太大');
    expect(unpackValue(b, 2000)).toEqual({ a: 'x'.repeat(1000) });
  });

  it('结构太大:不用解析就拒绝', () => {
    const b = new Uint8Array(12 + 64e6 + 1);
    b.set(new TextEncoder().encode('CIVSNAP1'), 0);
    new DataView(b.buffer).setUint32(8, 64e6 + 1, true);
    const parse = vi.spyOn(JSON, 'parse');
    expect(() => unpackValue(b)).toThrow('结构太大');
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });

  it('数组:号称 10 亿个、种类认不出、负数、小数都拒绝', () => {
    expect(() => read('{"$$":"a","t":"F64","o":0,"n":1000000000}')).toThrow('不完整');
    expect(() => read('{"$$":"a","t":"F64","o":1e300,"n":1}')).toThrow('不完整');
    expect(() => read('{"$$":"a","t":"F64","o":0,"n":1e300}')).toThrow('不完整');
    for (const t of ['"constructor"', '"__proto__"', '"toString"', '"X"', '["F32"]', '1', 'null']) expect(() => read(`{"$$":"a","t":${t},"o":0,"n":0}`), t).toThrow('数组不对');
    for (const [o, n] of [
      [-8, 1],
      [0, -1],
      [0.5, 1],
      [0, 1.5],
      ['"0"', 1],
      [0, '"1"'],
      [null, 1],
    ])
      expect(() => read(`{"$$":"a","t":"U8","o":${o},"n":${n}}`), `${o},${n}`).toThrow('数组不对');
  });

  it('好多个数组指同一段字节:撑内存的写法拒绝', () => {
    const body = new Uint8Array(1 << 20);
    const one = '{"$$":"a","t":"U8","o":0,"n":1048576}';
    expect((read(`[${one}]`, body) as Uint8Array[])[0].length).toBe(1 << 20);
    const t0 = performance.now();
    expect(() => read(`[${Array(100000).fill(one).join(',')}]`, body)).toThrow('重叠');
    expect(performance.now() - t0).toBeLessThan(1000);
  });

  it.each([
    '{"$$":"m","v":"ab"}',
    '{"$$":"m","v":5}',
    '{"$$":"m"}',
    '{"$$":"m","v":[[1]]}',
    '{"$$":"m","v":[[1,2,3]]}',
    '{"$$":"m","v":["ab"]}',
    '{"$$":"s","v":5}',
    '{"$$":"s","v":"ab"}',
    '{"$$":"s"}',
    '{"$$":"o"}',
    '{"$$":"o","v":"abc"}',
    '{"$$":"o","v":[1]}',
    '{"$$":"o","v":null}',
    '{"$$":"n","v":"x"}',
    '{"$$":"n"}',
    '{"$$":"z"}',
    '{"$$":5}',
    '{"$$":null}',
    '{"$$":"r"}',
    '{"$$":"a"}',
  ])('标记的内容不对:%s', (head) => {
    expect(() => read(head)).toThrow();
  });

  it('文件头不对:太短、不是原件、结构长度超出文件', () => {
    expect(() => unpackValue(new Uint8Array(3))).toThrow();
    expect(() => unpackValue(new TextEncoder().encode('{"a":1}aaaaaaaaaaaa'))).toThrow('不是原件');
    const b = pack('{}');
    new DataView(b.buffer).setUint32(8, 1 << 20, true);
    expect(() => unpackValue(b)).toThrow('不完整');
  });
});

describe('读一块:解压的上限', () => {
  /** 记下解压一共吐出来多少字节 */
  function countInflate() {
    const Real = globalThis.DecompressionStream;
    const seen = { made: 0, bytes: 0 };
    class Counting {
      readable: ReadableStream;
      writable: WritableStream;
      constructor(kind: CompressionFormat) {
        seen.made++;
        const real = new Real(kind);
        this.writable = real.writable;
        this.readable = real.readable.pipeThrough(
          new TransformStream({
            transform(chunk: Uint8Array, c) {
              seen.bytes += chunk.length;
              c.enqueue(chunk);
            },
          }),
        );
      }
    }
    vi.stubGlobal('DecompressionStream', Counting);
    return seen;
  }
  const part = async (name: string, data: Uint8Array, bytes = data.length, sum?: string): Promise<SnapshotPart> => ({ name, bytes, sum: sum ?? (await sha256(data)), zip: 'none', data: data.slice().buffer as ArrayBuffer });
  const gz = (data: Uint8Array) => {
    const z = gzipSync(data, { level: 1 });
    return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength) as ArrayBuffer;
  };
  /** 全是 0 的压缩炸弹:200 MB 压完只有 200 KB */
  const BOMB = gz(new Uint8Array(200e6));

  it('各块的上限', () => {
    expect(partLimit('map')).toBe(40e6);
    expect(partLimit('eras')).toBe(80e6);
    expect(partLimit('civ')).toBe(160e6);
    expect(partLimit('chronicle')).toBe(64e6);
    expect(partLimit('flags')).toBe(16e6);
    expect(partLimit('author')).toBe(64e6);
    expect(partLimit('thumb')).toBe(2e6);
    // 认不出的块名(包括和对象自带的属性同名的)给保守的上限
    for (const name of ['ext.magic', 'constructor', '__proto__', '']) expect(partLimit(name), name).toBe(16e6);
  });

  it('说好的字节数超上限:碰都不碰解压', async () => {
    const seen = countInflate();
    await expect(readPart({ name: 'map', bytes: 40e6 + 1, sum: '', zip: 'gzip', data: BOMB })).rejects.toThrow('上限');
    await expect(readPart({ name: 'civ', bytes: 160e6 + 1, sum: '', zip: 'gzip', data: BOMB })).rejects.toThrow('上限');
    await expect(readPart({ name: '不认识', bytes: 16e6 + 1, sum: '', zip: 'gzip', data: BOMB })).rejects.toThrow('上限');
    expect(seen.made).toBe(0);
  });

  it('压缩炸弹:说得小解得大,超了就停,不把 200 MB 解完', async () => {
    const seen = countInflate();
    const t0 = performance.now();
    await expect(readPart({ name: 'map', bytes: 1000, sum: '', zip: 'gzip', data: BOMB })).rejects.toThrow('比说好的大');
    expect(seen.made).toBe(1);
    expect(seen.bytes).toBeLessThan(40e6);
    expect(performance.now() - t0).toBeLessThan(2000);
    // 在上限以内撒谎的一样
    seen.bytes = 0;
    await expect(readPart({ name: 'map', bytes: 20e6, sum: '', zip: 'gzip', data: BOMB })).rejects.toThrow('比说好的大');
    expect(seen.bytes).toBeLessThan(60e6);
  });

  it('同一块读两遍一样:解压不动存着的字节', async () => {
    const value = { a: new Int32Array([1, 2, 3]), b: '字' };
    const p = await makePart('civ', value);
    const size = p.data.byteLength;
    expect(isDeepStrictEqual(await readPart(p), value)).toBe(true);
    expect(p.data.byteLength).toBe(size);
    expect(isDeepStrictEqual(await readPart(p), value)).toBe(true);
  });

  it('解出来比说好的小、校验不对、不压缩的长度不对', async () => {
    const raw = packValue({ a: 1 });
    const data = gz(raw);
    const sum = await sha256(raw);
    await expect(readPart({ name: 'map', bytes: raw.length, sum, zip: 'gzip', data })).resolves.toEqual({ a: 1 });
    await expect(readPart({ name: 'map', bytes: raw.length + 1, sum, zip: 'gzip', data })).rejects.toThrow('校验');
    await expect(readPart({ name: 'map', bytes: raw.length, sum: '0'.repeat(64), zip: 'gzip', data })).rejects.toThrow('校验');
    await expect(readPart(await part('map', raw))).resolves.toEqual({ a: 1 });
    await expect(readPart(await part('map', raw, raw.length - 1))).rejects.toThrow('校验');
    // 不压缩的也管上限
    const big = new Uint8Array(16e6 + 1);
    await expect(readPart({ name: '不认识', bytes: big.length, sum: '', zip: 'none', data: big.buffer as ArrayBuffer })).rejects.toThrow('上限');
  });

  it('字段本身不对:字节数不是整数、字节不是 ArrayBuffer、压缩方式认不出', async () => {
    const raw = packValue({ a: 1 });
    const good = await part('map', raw);
    for (const bytes of [NaN, -1, 1.5, Infinity, '12', null, undefined]) await expect(readPart({ ...good, bytes } as unknown as SnapshotPart), String(bytes)).rejects.toThrow('上限');
    // 数字当字节:不能变成 new Uint8Array(10 亿)
    for (const data of [1e9, 'abc', null, undefined, {}, new Uint8Array(4)]) await expect(readPart({ ...good, data } as unknown as SnapshotPart), String(data)).rejects.toThrow('字节不对');
    for (const zip of ['deflate', 'constructor', '', null]) await expect(readPart({ ...good, zip } as unknown as SnapshotPart), String(zip)).rejects.toThrow('压缩方式');
    await expect(readPart({ ...good, sum: 5 } as unknown as SnapshotPart)).rejects.toThrow('校验');
  });
});

describe('乱改文件反复试', () => {
  /** 随机数用固定种子,每次试的都一样 */
  const rand = mulberry32(20261104);
  const pick = (n: number) => Math.floor(rand() * n);
  const SPECIAL = [0, 1, -1, 2 ** 31 - 1, 2 ** 31, 2 ** 32 - 1];

  /** 要么抛 Error,要么读出干净的值 */
  const tryRead = (b: Uint8Array) => {
    let v: unknown;
    try {
      v = unpackValue(b);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      return;
    }
    expectClean(v);
  };

  it('结构和数组的字节:截断、翻字节、改长度', () => {
    const good = packValue(SAMPLE());
    for (let n = 0; n < good.length; n++) tryRead(good.subarray(0, n));
    for (let i = 0; i < 4000; i++) {
      const bad = good.slice();
      for (let k = 1 + pick(3); k > 0; k--) bad[pick(bad.length)] ^= 1 << pick(8);
      tryRead(bad);
    }
    // 改结构的长度
    for (const x of SPECIAL) {
      const bad = good.slice();
      new DataView(bad.buffer).setInt32(8, x, true);
      tryRead(bad);
    }
    // 把结构里的数字换成特别的数:偏移、个数、引用编号
    const head = headOf(good);
    for (let i = 0; i < 2000; i++) {
      const numbers = [...head.matchAll(/\d+/g)];
      const m = numbers[pick(numbers.length)];
      const word = ['0', '1', '-1', '1.5', '1e300', '4294967296', 'null', '"x"', '[]', '{}'][pick(10)];
      const body = good.subarray((12 + new TextEncoder().encode(head).length + 7) & ~7);
      tryRead(pack(head.slice(0, m.index) + word + head.slice(m.index! + m[0].length), body));
    }
    // 把结构里的标记、键换掉
    const tokens = [...head.matchAll(/"[^"]*"/g)];
    for (let i = 0; i < 2000; i++) {
      const m = tokens[pick(tokens.length)];
      const word = ['"$$"', '"a"', '"r"', '"m"', '"s"', '"o"', '"n"', '"u"', '"v"', '"i"', '"__proto__"', '"constructor"', '"F64"'][pick(13)];
      const body = good.subarray((12 + new TextEncoder().encode(head).length + 7) & ~7);
      tryRead(pack(head.slice(0, m.index) + word + head.slice(m.index! + m[0].length), body));
    }
  });

  it('一块:截断压缩的字节、翻字节、改说好的长度和校验', async () => {
    const part = await makePart('map', SAMPLE());
    const real = new Uint8Array(part.data);
    const tryPart = async (p: SnapshotPart) => {
      let v: unknown;
      try {
        v = await readPart(p);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        return false;
      }
      // 校验对上了才算读出来:内容只能是原来那份
      expect(isDeepStrictEqual(v, SAMPLE())).toBe(true);
      return true;
    };
    for (let n = 0; n < real.length; n += 7) expect(await tryPart({ ...part, data: real.slice(0, n).buffer })).toBe(false);
    for (let i = 0; i < 300; i++) {
      const bad = real.slice();
      for (let k = 1 + pick(3); k > 0; k--) bad[pick(bad.length)] ^= 1 << pick(8);
      await tryPart({ ...part, data: bad.buffer });
    }
    for (const bytes of [0, 1, part.bytes - 1, part.bytes + 1, 40e6, 40e6 + 1, 2 ** 31, 2 ** 53]) expect(await tryPart({ ...part, bytes })).toBe(false);
    for (let i = 0; i < 40; i++) {
      const sum = part.sum.slice(0, 63) + '0123456789abcdef'[pick(16)];
      await tryPart({ ...part, sum });
    }
    await expect(readPart(part)).resolves.toBeDefined();
  });

  it('真实小世界的字节也试几遍', () => {
    const params = { ...DEFAULT_PARAMS, seed: 7, cells: 2000 };
    const world = generateWorld(params);
    const civ = generateCiv(world, { endYear: 200 });
    const good = packValue(civ);
    for (let i = 0; i < 60; i++) {
      const bad = good.slice();
      for (let k = 1 + pick(8); k > 0; k--) bad[12 + pick(Math.min(bad.length - 12, 200000))] ^= 1 << pick(8);
      tryRead(bad);
    }
    for (let i = 0; i < 20; i++) tryRead(good.subarray(0, pick(good.length)));
  });
});

/**
 * 推演插件关进 QuickJS 跑(src/gen/civ/quickjs/):照接口写的插件以源码进 QuickJS,推出来的历史和直接跑逐位一样;
 * QuickJS 里没有时间、随机数、eval;死循环叫停、内存用完、栈用完都报错停下
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, startContinue, type Civ } from '../src/gen/civ';
import { PluginError, type PluginTurn, type SimPlugin } from '../src/gen/civ/engine/plugin';
import { keyed, keyed4, subSeed } from '../src/gen/civ/engine/rand';
import type { SimRead } from '../src/gen/civ/simRead';
import { quickjsPlugin, type QuickJSLimits, type QuickJSPlugin } from '../src/gen/civ/quickjs/plugin';
import { fromWire } from '../src/gen/civ/quickjs/wire';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { pluginScript, quickjsWasm } from '../scripts/lib/quickjsNode';
import { loadPlugin } from '../scripts/lib/simPluginLoad';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { faithEffect, weariness } from './lib/simV1Plugins';

const V1 = fileURLToPath(new URL('./lib/simV1Plugins.ts', import.meta.url));
const LOAD = fileURLToPath(new URL('../scripts/lib/simPluginLoad.ts', import.meta.url));

/** 推出来的历史的指纹:史事、归属、干预、插件写的编年史和状态 */
function digest(civ: Civ): string {
  const x = packValue({ annals: civ.annals, polity: civ.polity, culture: civ.culture, interventions: civ.interventions ?? [], chronicle: civ.simChronicle ?? [], plugins: civ.simPlugins ?? [] });
  return createHash('sha256').update(x).digest('hex').slice(0, 16);
}

const setupOf = ({ id: _id, act: _act, ...setup }: SimPlugin<SimRead>) => setup;

/** 同一个插件的 QuickJS 版:file 里的源码 + civAtlas.sim(make) */
const boxed = (file: string, native: SimPlugin<SimRead>, make: string, seed: number) =>
  quickjsPlugin(quickjsWasm(), { id: native.id, code: pluginScript(file, make), setup: setupOf(native), seed });

const v1 = (seed: number) => Promise.all([boxed(V1, weariness(), 'weariness()', seed), boxed(V1, faithEffect(), 'faithEffect()', seed)]);

async function using<T>(made: Promise<QuickJSPlugin[]>, run: (ps: QuickJSPlugin[]) => T): Promise<T> {
  const ps = await made;
  try {
    return run(ps);
  } finally {
    ps.forEach((p) => p.dispose());
  }
}

describe('照接口写的插件以源码进 QuickJS,和直接跑一样', () => {
  it.each([7, 2024])('seed %i 厌战、宗教生效一起推 3000 年:历史的指纹和直接跑一样', async (seed) => {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed });
    const native = generateCiv(w, { plugins: [weariness(), faithEffect()] });
    const boxedCiv = await using(v1(seed), (plugins) => generateCiv(w, { plugins }));
    expect(boxedCiv.endYear).toBe(3000);
    expect(boxedCiv.stuck).toBeUndefined();
    expect((boxedCiv.interventions ?? []).filter((v) => v.plugin).length).toBeGreaterThan(0);
    expect(digest(boxedCiv)).toBe(digest(native));
  }, 120_000);

  it('推到 1500 年存下、读回来接着推(接着推那段换新的 QuickJS),和一口气推完一样', async () => {
    const seed = 2024;
    const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
    const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;
    const native = roundTrip(generateCiv(w, { plugins: [weariness(), faithEffect()] }));
    const one = roundTrip(await using(v1(seed), (plugins) => generateCiv(w, { plugins })));
    const half = roundTrip(await using(v1(seed), (plugins) => generateCiv(w, { plugins, endYear: 1500 })));
    const rest = roundTrip(
      await using(v1(seed), (plugins) => {
        const run = startContinue(w, half, { plugins });
        expect(run).not.toBeNull();
        return run!.finish();
      }),
    );
    expect(civDiff(one, native)).toBeNull();
    expect(civDiff(rest, one)).toBeNull();
    expect(digest(rest)).toBe(digest(native));
  }, 120_000);

  it('重插件(自己的表、接官方表、约事、听史事、读全部的国和城)推 800 年:整个结果和直接跑一样', async () => {
    const seed = 7;
    const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
    const native = generateCiv(w, { plugins: [loadPlugin()], endYear: 800 });
    const boxedCiv = await using(Promise.all([boxed(LOAD, loadPlugin(), 'loadPlugin()', seed)]), (plugins) => generateCiv(w, { plugins, endYear: 800 }));
    expect(boxedCiv.simPlugins?.[0].tables).toBeDefined();
    expect(Buffer.from(packValue(boxedCiv)).equals(Buffer.from(packValue(native)))).toBe(true);
  }, 120_000);
});

// ---- 单测:造一回合直接交给 act ----

const SEED = 7;
const ID = 'probe';

function turnOf(over: Partial<Record<string, unknown>> = {}, read: Record<string, unknown> = {}): PluginTurn<SimRead> {
  const base = subSeed(SEED, `plugin:${ID}`);
  return {
    year: 0,
    tick: true,
    events: [],
    heard: [],
    note: undefined,
    read: { year: 0, ...read } as unknown as SimRead,
    table: (t: string) => {
      throw new PluginError(ID, `没有表 ${t}`);
    },
    rand: (a: number, b = 0, c = 0, d?: number) => (d === undefined ? keyed(base, a, b, c) : keyed4(base, a, b, c, d)),
    influence: (k: string) => {
      if (k !== 'war.odds') throw new PluginError(ID, `没有登记交给影响口 ${k}`);
      return Float64Array.of(1, 1, 1);
    },
    ...over,
  } as PluginTurn<SimRead>;
}

const make = (code: string, limits?: Partial<QuickJSLimits>, params?: Record<string, number>) => quickjsPlugin(quickjsWasm(), { id: ID, code, seed: SEED, limits, params });
const sim = (body: string) => `civAtlas.sim({ act(turn) { ${body} } });`;

/** 装上、出手一次、放掉 */
async function once(body: string, turn = turnOf(), limits?: Partial<QuickJSLimits>) {
  const p = await make(sim(body), limits);
  try {
    return p.act(turn);
  } finally {
    p.dispose();
  }
}

const errOf = async (run: () => unknown): Promise<unknown> => {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('应该出错');
};

describe('QuickJS 里只有 JS 语言本身', () => {
  it('全局只有语言自带的几样、civAtlas 和什么都不做的 console;联网、存储、计时、线程一样都没有', async () => {
    const r = await once('return { commands: Object.getOwnPropertyNames(globalThis).sort() };');
    expect(r?.commands).toEqual([
      'AggregateError', 'Array', 'ArrayBuffer', 'BigInt', 'BigInt64Array', 'BigUint64Array', 'Boolean', 'DataView', 'Date', 'Error', 'EvalError',
      'Float16Array', 'Float32Array', 'Float64Array', 'Function', 'Infinity', 'Int16Array', 'Int32Array', 'Int8Array', 'InternalError', 'Iterator',
      'JSON', 'Map', 'Math', 'NaN', 'Number', 'Object', 'Promise', 'Proxy', 'RangeError', 'ReferenceError', 'Reflect', 'RegExp', 'Set',
      'SharedArrayBuffer', 'String', 'Symbol', 'SyntaxError', 'TypeError', 'URIError', 'Uint16Array', 'Uint32Array', 'Uint8Array', 'Uint8ClampedArray',
      'WeakMap', 'WeakSet', 'civAtlas', 'console', 'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent', 'escape', 'eval', 'globalThis',
      'isFinite', 'isNaN', 'parseFloat', 'parseInt', 'undefined', 'unescape',
    ]);
  });

  it('插件代码里留着 console.log 这些不出错,什么都不做', async () => {
    const p = await make(`console.log('装上了', globalThis);\n${sim("console.log('第', turn.year, '年'); console.warn(1); console.error(2); console.table([1]); console.time('t'); console.timeEnd('t'); return { note: [console.info('x') === undefined ? 1 : 0] };")}`);
    try {
      expect(p.act(turnOf())).toEqual({ note: [1] });
    } finally {
      p.dispose();
    }
  });

  it.each([
    ['new Date()', /不能用 Date/],
    ['Date.now()', /不能用 Date\.now/],
    ['Math.random()', /不能用 Math\.random.*turn\.rand/],
    ['eval("1 + 1")', /不能用 eval/],
    ['(0, eval)("1 + 1")', /不能用 eval/],
    ['Function("return 1")()', /不能用 Function/],
    ['(function () {}).constructor("return 1")()', /不能用 Function/],
    ['(async function () {}).constructor("return 1")', /不能用 函数构造器/],
    ['(function* () {}).constructor("yield 1")', /不能用 函数构造器/],
  ])('出手时用 %s 就报错停下', async (code, why) => {
    const e = await errOf(() => once(`${code}; return {};`));
    expect(e).toBeInstanceOf(PluginError);
    expect((e as Error).message).toMatch(why);
  });

  it('插件代码顶层用了也报错,装不上', async () => {
    const e = await errOf(() => make(`const t = Date.now();\n${sim('return {};')}`));
    expect((e as Error).message).toMatch(/插件代码出错.*不能用 Date\.now/);
  });

  it('函数照常是 Function 的实例;turn.rand 和推演算的逐位一样', async () => {
    const r = await once('return { commands: [(() => 1) instanceof Function, typeof Function, turn.rand(3), turn.rand(-1, 2.7, 1e10), turn.rand(5, 6, 7, 8)] };');
    const base = subSeed(SEED, `plugin:${ID}`);
    expect(r?.commands).toEqual([true, 'function', keyed(base, 3), keyed(base, -1, 2.7, 1e10), keyed4(base, 5, 6, 7, 8)]);
  });
});

describe('叫停、内存、栈', () => {
  it('出手时死循环:跑到上限叫停,插件的 try 接不住', async () => {
    const t0 = performance.now();
    const e = await errOf(() => once('try { for (;;) {} } catch (e) { return { note: 1 }; }', turnOf(), { moment: 150 }));
    expect((e as Error).message).toMatch(/第 0 年这一刻跑了 0\.1 秒还没跑完,叫停了/);
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('插件代码顶层死循环:装的时候叫停', async () => {
    const e = await errOf(() => make(`for (;;) {}\n${sim('return {};')}`, { moment: 150 }));
    expect((e as Error).message).toMatch(/插件代码跑了 0\.1 秒还没跑完,叫停了/);
  });

  it('抛出来的错读 message 时死循环也叫停,不卡住推演线程', async () => {
    const t0 = performance.now();
    const top = await errOf(() => make(`throw { get message() { for (;;) {} } };\n${sim('return {};')}`, { moment: 150 }));
    expect((top as Error).message).toBe('推演插件 probe:插件代码出错:说不清的错');
    expect(((await errOf(() => make(`throw 42;\n${sim('return {};')}`))) as Error).message).toBe('推演插件 probe:插件代码出错:42');
    const inAct = await errOf(() => once('const e = new Error("x"); Object.defineProperty(e, "message", { get() { for (;;) {} } }); throw e;', turnOf(), { moment: 150 }));
    expect((inAct as Error).message).toMatch(/叫停了/);
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('内存用到上限报错停下;别的插件照常跑', async () => {
    const e = await errOf(() => once('const a = []; for (;;) a.push(new Float64Array(1 << 20));'));
    expect((e as Error).message).toMatch(/这一刻用的内存超过 64 MB/);
    const e2 = await errOf(() => once('let s = "x"; const a = []; for (;;) { s += s; a.push(s + "y"); }'));
    expect((e2 as Error).message).toMatch(/内存超过 64 MB|string too long/);
    expect(await once('return { note: [1, 2, 3].map((x) => x * 2) };')).toEqual({ note: [2, 4, 6] });
  });

  it('递归太深报错停下,不把推演线程的栈用完', async () => {
    const e = await errOf(() => once('const f = (n) => f(n + 1) + 1; f(0);'));
    expect(e).toBeInstanceOf(PluginError);
    expect((e as Error).message).toMatch(/栈用完了/);
  });
});

describe('出错的说法', () => {
  it('推演那头抛的错插件没接住:原样抛出去(和直接跑一样)', async () => {
    const thrown = new PluginError(ID, '没有登记交给影响口 bad');
    const e = await errOf(() =>
      once(
        'turn.influence("bad"); return {};',
        turnOf({
          influence: () => {
            throw thrown;
          },
        }),
      ),
    );
    expect(e).toBe(thrown);
  });

  it('插件接住了照常交回话', async () => {
    expect(await once('try { turn.influence("bad"); } catch (e) { return { note: e.message.length }; }')).toEqual({ note: '推演插件 probe:没有登记交给影响口 bad'.length });
  });

  it.each([
    ['throw new Error("坏了");', '推演插件 probe:坏了'],
    ['throw "坏了";', '推演插件 probe:坏了'],
    ['return Promise.resolve({});', '推演插件 probe:回话要当场交回'],
    ['return { commands: [() => 1] };', '推演插件 probe:回话里只能放数、字、真假、数组和普通对象,不能有函数'],
    ['return { note: new Map() };', '推演插件 probe:回话里只能放普通对象'],
  ])('%s → %s', async (body, msg) => {
    const e = await errOf(() => once(body));
    expect(e).toBeInstanceOf(PluginError);
    expect((e as Error).message).toBe(msg);
  });

  it('没有登记、登记两次、出手时才登记都装不上或报错', async () => {
    expect(((await errOf(() => make('const x = 1;'))) as Error).message).toMatch(/没有用 civAtlas\.sim/);
    expect(((await errOf(() => make(`${sim('return {};')}\n${sim('return {};')}`))) as Error).message).toMatch(/只能调用一次/);
    expect(((await errOf(() => once('civAtlas.sim({ act() {} });'))) as Error).message).toMatch(/只能在插件代码的顶层调用/);
  });

  it('插件换掉全局的 Error 也挡不住我们那一层报错,不会卡住', async () => {
    const t0 = performance.now();
    const e = await errOf(() => make('Error = function () { for (;;) {} }; TypeError = Error;', { moment: 150 }));
    expect((e as Error).message).toMatch(/没有用 civAtlas\.sim/);
    const e2 = await errOf(() => once('Error = function () { for (;;) {} }; return { note: [() => 1] };', turnOf(), { moment: 150 }));
    expect((e2 as Error).message).toMatch(/不能有函数/);
    expect(performance.now() - t0).toBeLessThan(5000);
  });

  it('插件在数组、对象的原型上装 setter / getter:我们递来递去的东西不走它,真走到了也叫停,不卡住推演线程', async () => {
    const t0 = performance.now();
    const trap = (i: number) => `Object.defineProperty(Array.prototype, ${i}, { set(v) { Object.defineProperty(this, ${i}, { get() { for (;;) {} } }); }, configurable: true });`;
    const read = { polities: () => [{ id: 0 }] };
    const r = await once(
      `${[3, 4].map(trap).join(' ')} Object.defineProperty(Object.prototype, 'note', { set(v) { for (;;) {} }, configurable: true });
       return { note: new Uint8Array([1]), influences: { a: Float64Array.of(-0) }, commands: [turn.read.polities()[0].id] };`,
      turnOf({}, read),
      { moment: 150 },
    );
    expect(r?.note).toEqual(Uint8Array.of(1));
    expect(Object.is((r?.influences?.a as Float64Array)[0], -0)).toBe(true);
    expect(r?.commands).toEqual([0]);
    // QuickJS 自带的 JSON.stringify 里面也往数组里写,这样的插件自己坏了,但只是这一刻叫停
    const e = await errOf(() => once(`${[0, 1, 2].map(trap).join(' ')} return { note: new Uint8Array([1]) };`, turnOf(), { moment: 150 }));
    expect((e as Error).message).toMatch(/叫停了/);
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});

describe('递数据', () => {
  it('读口的结果原样递进去:-0、NaN、±Infinity、值是 undefined 的键、各种类型化数组', async () => {
    const read = {
      polities: () => [{ id: 0, power: -0, broke: NaN, ended: undefined, wars: [1, 2] }],
      owners: (f: string) => (f === 'polity' ? Int16Array.of(-1, 0, 3) : Uint8Array.of(9)),
      regions: () => ({ count: 2, area: Float64Array.of(1.5, -0), habitability: Float32Array.of(0.1), neighbors: { start: Int32Array.of(0, 1, 2), list: Int32Array.of(1, 0) } }),
      official: () => Float64Array.of(Infinity, -Infinity, 1e-300),
    };
    const r = await once(
      `const p = turn.read.polities()[0];
       const g = turn.read.regions();
       const o = turn.read.owners('polity');
       const x = turn.read.official('rural');
       return { commands: [
         Object.is(p.power, -0), Number.isNaN(p.broke), 'ended' in p, p.ended === undefined, Object.keys(p).join(),
         o.constructor.name, Array.from(o).join(), turn.read.owners('faith').constructor.name,
         g.area.constructor.name, Object.is(g.area[1], -0), g.habitability.constructor.name, g.habitability[0],
         g.neighbors.start.constructor.name, Array.from(g.neighbors.list).join(),
         x[0] === Infinity, x[1] === -Infinity, x[2], turn.read.year, turn.note === undefined, 'note' in turn,
       ] };`,
      turnOf({}, read),
    );
    expect(r?.commands).toEqual([
      true, true, true, true, 'id,power,broke,ended,wars',
      'Int16Array', '-1,0,3', 'Uint8Array',
      'Float64Array', true, 'Float32Array', Math.fround(0.1),
      'Int32Array', '1,0',
      true, true, 1e-300, 0, true, true,
    ]);
  });

  it('回话原样递回来:-0、NaN、值是 undefined 的键、类型化数组和它的种类', async () => {
    const r = await once('return { note: { a: -0, b: [NaN, Infinity] }, commands: [{ kind: "x", a: undefined }], influences: { "war.odds": Float64Array.of(-0, 0.5), "k": Int32Array.of(-7) } };');
    expect(Object.is((r?.note as { a: number }).a, -0)).toBe(true);
    expect((r?.note as { b: number[] }).b).toEqual([NaN, Infinity]);
    const c = r?.commands?.[0] as Record<string, unknown>;
    expect(Object.keys(c)).toEqual(['kind', 'a']);
    expect(c.a).toBeUndefined();
    const odds = r?.influences?.['war.odds'] as Float64Array;
    expect(odds).toBeInstanceOf(Float64Array);
    expect(Object.is(odds[0], -0)).toBe(true);
    expect(r?.influences?.k).toEqual(Int32Array.of(-7));
  });

  it('同一回合里同样的读口只算一次,但每次给插件的都是新的一份(改了不影响下一次)', async () => {
    let calls = 0;
    const read = { polities: () => (calls++, [{ id: 0, wars: [] as number[] }]) };
    const r = await once('const a = turn.read.polities(); a[0].wars.push(9); const b = turn.read.polities(); return { commands: [a[0].wars.length, b[0].wars.length, a === b] };', turnOf({}, read));
    expect(r?.commands).toEqual([1, 0, false]);
    expect(calls).toBe(1);
  });

  it('回合里别的数据(挡下的命令、约到的事、听到的史事)原样递进去,键的先后也一样', async () => {
    const refused = [{ kind: 'declare', index: 1, why: '作者不许' }];
    const events = [{ year: 3.5, kind: 2, data: [-0, 7] }];
    const heard = [{ year: 3, kind: 'war', a: 1, b: 2, region: -1, settlement: -1, war: 5 }];
    const r = await once('return { commands: [Object.keys(turn).join(), turn.refused, turn.events, turn.heard, Object.is(turn.events[0].data[0], -0)] };', turnOf({ events, heard, refused }));
    expect(r?.commands).toEqual(['year,tick,events,heard,note,read,table,rand,influence,refused', refused, events, heard, true]);
  });

  it('读口的参数是 ±Infinity、-0 时各算各的,不和别的参数共用一份', async () => {
    let calls = 0;
    const read = { annals: (from: number) => (calls++, [{ from: Object.is(from, -0) ? '-0' : String(from) }]) };
    const r = await once(
      'const f = (x) => turn.read.annals(x)[0].from; return { commands: [f(-Infinity), f(Infinity), f(0), f(-0), f(NaN), f(Infinity)] };',
      turnOf({}, read),
    );
    expect(r?.commands).toEqual(['-Infinity', 'Infinity', '0', '-0', 'NaN', 'Infinity']);
    expect(calls).toBe(5);
  });

  it('civAtlas.params 是只读的滑条', async () => {
    const p = await make(sim('"use strict"; let ok = 0; try { civAtlas.params.k = 9; } catch (e) { ok = 1; } return { note: [civAtlas.params.k, ok] };'), undefined, { k: 2.5 });
    try {
      expect(p.act(turnOf())).toEqual({ note: [2.5, 1] });
    } finally {
      p.dispose();
    }
  });

  it('同一段推演里全局变量留着;往回推(年份比上一回合早)换新环境,全局变量不带过去', async () => {
    const p = await make(`let n = 0;\n${sim('n++; return { note: n };')}`);
    try {
      const at = (year: number) => (p.act(turnOf({ year })) as { note: number }).note;
      expect([at(1), at(2), at(3), at(2), at(3)]).toEqual([1, 2, 3, 1, 2]);
    } finally {
      p.dispose();
    }
  });

  it('QuickJS 递回来的补丁表只能换 JSON 读出来的自己的格子,动不到推演线程的原型', async () => {
    const r = await once('return { note: JSON.parse(\'{"__proto__": { "polluted": 1 }, "a": 1 }\') };');
    expect(Object.getPrototypeOf(r?.note)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const buf = new Float64Array(1).buffer;
    for (const patches of [[[['__proto__', 'x'], 1, 'NaN']], [[['constructor', 'prototype', 'x'], 2]], [[['a'], 0, 'Function', 0]], [[['a'], 0, 'Float64Array', 3]], [[['a', 'b'], 2]]]) {
      expect(() => fromWire({ text: '{"a":1}', patches: JSON.stringify(patches), bufs: [buf] })).toThrow(/坏了/);
    }
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    const ok = fromWire({ text: '{"__proto__":null,"a":null}', patches: JSON.stringify([[['__proto__'], 1, '-0'], [['a'], 0, 'Float64Array', 0]]), bufs: [buf] }) as Record<string, unknown>;
    expect(Object.getPrototypeOf(ok)).toBe(Object.prototype);
    expect(Object.is(Object.getOwnPropertyDescriptor(ok, '__proto__')?.value, -0)).toBe(true);
    expect(ok.a).toEqual(new Float64Array(1));
  });
});

describe('QuickJS 这份 wasm', () => {
  it('从外头只引进 19 个函数和一块内存;外层胶水代码里没有能执行字的(eval、Function)', () => {
    const req = createRequire(import.meta.url);
    const wasm = new WebAssembly.Module(readFileSync(req.resolve('@jitl/quickjs-wasmfile-release-sync/wasm')));
    const imports = WebAssembly.Module.imports(wasm);
    expect(imports.filter((i) => i.kind === 'function').length).toBe(19);
    expect(imports.filter((i) => i.kind !== 'function').map((i) => i.kind)).toEqual(['memory']);
    const dir = req.resolve('@jitl/quickjs-wasmfile-release-sync/wasm').replace(/emscripten-module\.wasm$/, '');
    for (const f of ['emscripten-module.browser.mjs', 'emscripten-module.mjs']) {
      const src = readFileSync(dir + f, 'utf8');
      expect(src, f).not.toMatch(/(^|[^.\w$])eval\s*\(|new Function|[^.\w$]Function\s*\(/);
    }
  });
});

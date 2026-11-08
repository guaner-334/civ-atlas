/**
 * QuickJS 里插件代码之前先跑的那一层(推演插件 SIM_SHIM、地图插件 MAP_SHIM):登记插件、把递进来的包成插件拿到的样子、
 * 交回的打包递回去,再拿掉会让同一个种子算出不同结果(Date、Math.random)或跑审核没看过的代码(eval、Function 一族的构造器)的几样。
 * 数据的写法见 wire.ts;rand 和 util.ts 的 keyed / keyed4 逐位一样。
 *
 * 两份都是一个函数表达式,装的时候调一次:SHIM(host, base, paramsJson, logOn) → [出手, ready]。
 * host(2, 方法名, ...参数) = console[方法名](...参数)(只在 logOn 时调,不交回东西);别的 host 调用见各自那份。
 * 出手交回:undefined(没有回话)| [0, JSON, 补丁表, ...字节] | [1, 说明, 宿主错误的编号(没有 = −1), 1 内存用完 / 2 栈用完 / 0 别的]。
 * host 出错交回 [null, 编号, 名字, 说明]。
 */

/** 两份共用:先取好要用的内置函数(插件代码之后才跑,换不掉这几个),递数据、随机数、拿掉的几样、console */
const COMMON = String.raw`
  const G = globalThis;
  const O = Object;
  const apply = Reflect.apply;
  const parse = JSON.parse;
  const stringify = JSON.stringify;
  const keys = O.keys;
  const getProto = O.getPrototypeOf;
  const defProp = O.defineProperty;
  const freeze = O.freeze;
  const hasOwn = O.prototype.hasOwnProperty;
  const isArray = Array.isArray;
  const isView = ArrayBuffer.isView;
  const imul = Math.imul;
  const sqrt = Math.sqrt;
  const OP = O.prototype;
  const IE = G.InternalError;
  const Err = Error;
  const TErr = TypeError;
  const TA = {
    Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
  };
  const taBuffer = O.getOwnPropertyDescriptor(getProto(Int8Array.prototype), 'buffer').get;
  const NAMES = new Map();
  for (const k of keys(TA)) NAMES.set(TA[k].prototype, k);
  const mapGet = Map.prototype.get;
  const nameOf = (x) => apply(mapGet, NAMES, [getProto(x)]);
  const Str = String;
  // 只写自己的属性:插件在原型上装的 setter、getter 碰不到我们递来递去的东西
  const put = (o, k, v) => defProp(o, k, { value: v, writable: true, enumerable: true, configurable: true });
  const has = (list, k) => {
    for (let i = 0; i < list.length; i++) if (list[i] === k) return true;
    return false;
  };
  const SPECIAL = { '-0': -0, NaN: NaN, Infinity: Infinity, '-Infinity': -Infinity };
  const DEPTH = 64;

  const special = (x) => (x !== x ? 'NaN' : x === Infinity ? 'Infinity' : x === -Infinity ? '-Infinity' : x === 0 && 1 / x < 0 ? '-0' : null);
  const replacer = (k, x) => (x === undefined || isView(x) || (typeof x === 'number' && special(x) !== null) ? null : x);

  function decode(text, patches, list, from) {
    let root = parse(text);
    if (!patches) return root;
    const ps = parse(patches);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const path = p[0];
      const v = p[1] === 0 ? new TA[p[2]](list[from + p[3]]) : p[1] === 1 ? SPECIAL[p[2]] : undefined;
      if (!path.length) {
        root = v;
        continue;
      }
      let o = root;
      for (let j = 0; j < path.length - 1; j++) o = o[path[j]];
      put(o, path[path.length - 1], v);
    }
    return root;
  }

  function encode(v, what = '回话') {
    const patches = [];
    const bufs = [];
    const path = [];
    const at = () => {
      const c = [];
      for (let i = 0; i < path.length; i++) put(c, i, path[i]);
      return c;
    };
    const walk = (x, depth) => {
      if (depth > DEPTH) throw new Err(what + '套得太深(超过 ' + DEPTH + ' 层)');
      switch (typeof x) {
        case 'number': {
          const s = special(x);
          if (s !== null) put(patches, patches.length, [at(), 1, s]);
          return;
        }
        case 'string':
        case 'boolean':
          return;
        case 'undefined':
          put(patches, patches.length, [at(), 2]);
          return;
        case 'object': {
          if (x === null) return;
          if (isView(x)) {
            const name = nameOf(x);
            if (name === undefined) throw new Err(what + '里的数组只能是数的类型化数组(Int8Array…Float64Array)');
            put(patches, patches.length, [at(), 0, name, bufs.length]);
            put(bufs, bufs.length, apply(taBuffer, new TA[name](x), []));
            return;
          }
          if (isArray(x)) {
            const n = x.length;
            for (let i = 0; i < n; i++) {
              put(path, path.length, i);
              walk(x[i], depth + 1);
              path.length--;
            }
            return;
          }
          const proto = getProto(x);
          if (proto !== OP && proto !== null) throw new Err(what + '里只能放普通对象');
          const ks = keys(x);
          for (let i = 0; i < ks.length; i++) {
            put(path, path.length, ks[i]);
            walk(x[ks[i]], depth + 1);
            path.length--;
          }
          return;
        }
        default:
          throw new Err(what + '里只能放数、字、真假、数组和普通对象,不能有' + (typeof x === 'function' ? '函数' : typeof x));
      }
    };
    walk(v, 0);
    const text = patches.length ? stringify(v, replacer) : stringify(v);
    const out = [0, text === undefined ? 'null' : text, patches.length ? stringify(patches) : ''];
    for (let i = 0; i < bufs.length; i++) put(out, out.length, bufs[i]);
    return out;
  }

  // host 交回的错在 QuickJS 里抛成同名、同说明的错,带上编号(插件没接住时宿主那头按编号原样抛出去)
  function hostThrow(w) {
    const e = new Err(w[3]);
    defProp(e, 'name', { value: w[2], writable: true, configurable: true });
    defProp(e, '__civHost', { value: w[1] });
    throw e;
  }

  function fmix(h) {
    h ^= h >>> 16;
    h = imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }
  function keyed(a, b, c) {
    let h = fmix((base ^ 0x2545f491) >>> 0);
    h = fmix((h ^ imul(a | 0, 0x9e3779b1)) >>> 0);
    h = fmix((h ^ imul(b | 0, 0x85ebca77)) >>> 0);
    h = fmix((h ^ imul(c | 0, 0xc2b2ae3d)) >>> 0);
    return h / 4294967296;
  }
  function keyed4(a, b, c, d) {
    let h = fmix((base ^ 0x2545f491) >>> 0);
    h = fmix((h ^ imul(a | 0, 0x9e3779b1)) >>> 0);
    h = fmix((h ^ imul(b | 0, 0x85ebca77)) >>> 0);
    h = fmix((h ^ imul(c | 0, 0xc2b2ae3d)) >>> 0);
    h = fmix((h ^ imul(d | 0, 0x27d4eb2f)) >>> 0);
    return h / 4294967296;
  }

  const RUN = '跑的代码要和审过的一样';
  const ban = (what, why) =>
    function () {
      throw new TErr(KIND + '里不能用 ' + what + ':' + why);
    };
  const D = ban('Date', SAME);
  for (const k of ['now', 'parse', 'UTC']) D[k] = ban('Date.' + k, SAME);
  defProp(G, 'Date', { value: D, writable: true, configurable: true });
  defProp(Math, 'random', { value: ban('Math.random', SAME + ';' + RAND_HINT), writable: true, configurable: true });
  defProp(G, 'eval', { value: ban('eval', RUN), writable: true, configurable: true });
  const F = ban('Function', RUN);
  F.prototype = Function.prototype;
  defProp(G, 'Function', { value: F, writable: true, configurable: true });
  defProp(Function.prototype, 'constructor', { value: F, writable: true, configurable: true });
  for (const f of [async function () {}, function* () {}, async function* () {}]) {
    defProp(getProto(f), 'constructor', { value: ban('函数构造器', RUN), writable: true, configurable: true });
  }
  // QuickJS 本来没有 console:给一个什么都不做的,插件里留着 console.log 不出错;开发者模式试跑时 log、info、warn、error、debug 交给宿主记日志
  const quiet = {};
  const said = { log: 1, info: 1, warn: 1, error: 1, debug: 1 };
  for (const k of ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table', 'assert', 'count', 'countReset', 'group', 'groupCollapsed', 'groupEnd', 'time', 'timeLog', 'timeEnd']) {
    put(
      quiet,
      k,
      logOn && apply(hasOwn, said, [k])
        ? function () {
            const args = [2, k];
            for (let i = 0; i < arguments.length; i++) put(args, i + 2, arguments[i]);
            apply(host, undefined, args);
          }
        : () => undefined,
    );
  }
  defProp(G, 'console', { value: quiet, writable: true, configurable: true });

  const describe = (e) => {
    try {
      return e instanceof Err ? Str(e.message) : Str(e);
    } catch (x) {
      return '插件抛出的错说不清';
    }
  };
  // 插件出手时没接住的错
  const failed = (e) => {
    const tag = e !== null && typeof e === 'object' && apply(hasOwn, e, ['__civHost']) ? e.__civHost : -1;
    const ie = IE !== undefined && e instanceof IE;
    return [1, describe(e), tag, ie && e.message === 'out of memory' ? 1 : ie && e.message === 'stack overflow' ? 2 : 0];
  };
  // 交回的东西要当场交回(不能是 Promise 那样的)
  const later = (r) => (typeof r === 'object' || typeof r === 'function') && typeof r.then === 'function';
`;

/**
 * 推演插件:civAtlas.sim({ act })。出手 = act(JSON, 补丁表, ...字节)(递进来的一回合)。
 * host(kind, name, ...参数):kind 0 = turn.read[name],1 = turn[name];成功交回 [JSON, 补丁表, ...字节]
 */
export const SIM_SHIM = String.raw`(function (host, base, paramsJson, logOn) {
  'use strict';
  const KIND = '推演插件';
  const SAME = '同一个种子在哪里推都要得到同一段历史';
  const RAND_HINT = '随机数用 turn.rand';
${COMMON}
  function ask(kind, name, args) {
    const call = [kind, name];
    for (let i = 0; i < args.length; i++) put(call, call.length, args[i]);
    const w = apply(host, undefined, call);
    if (w[0] === null) hostThrow(w);
    return decode(w[0], w[1], w, 2);
  }
  const method = (kind, name) => (...args) => ask(kind, name, args);
  const rand = (a, b = 0, c = 0, d) => (d === undefined ? keyed(a, b, c) : keyed4(a, b, c, d));

  let def = null;
  let open = true;
  function sim(d) {
    if (!open) throw new Err('civAtlas.sim 只能在插件代码的顶层调用');
    if (def) throw new Err('civAtlas.sim 只能调用一次');
    if (d === null || typeof d !== 'object' || typeof d.act !== 'function') throw new TErr('civAtlas.sim 要给一个带 act 函数的对象');
    def = d;
  }
  defProp(G, 'civAtlas', { value: freeze({ sim, params: freeze(parse(paramsJson)) }), enumerable: true });

  const read = {};
  let readKeys = null;
  let cur = null;

  function act(text, patches) {
    const h = decode(text, patches, arguments, 2);
    cur = h;
    if (readKeys === null) {
      readKeys = h.rk;
      for (let i = 0; i < readKeys.length; i++) {
        const k = readKeys[i];
        if (has(h.rf, k)) put(read, k, method(0, k));
        else defProp(read, k, { get: () => cur.rd[k], enumerable: true, configurable: true });
      }
    }
    const turn = {};
    for (let i = 0; i < h.k.length; i++) {
      const k = h.k[i];
      put(turn, k, k === 'read' ? read : k === 'rand' ? rand : has(h.f, k) ? method(1, k) : h.d[k]);
    }
    try {
      const r = def.act(turn);
      if (r === undefined || r === null) return undefined;
      if (later(r)) throw new Err('回话要当场交回');
      return encode(r);
    } catch (e) {
      return failed(e);
    }
  }
  function ready() {
    open = false;
    if (!def) throw new Err('插件代码里没有用 civAtlas.sim({ act }) 登记');
  }
  return [act, ready];
})`;

/**
 * 地图插件:civAtlas.map({ height, climate, layers })。出手 = call(哪一口, JSON, 补丁表, ...字节)(递进来的 { d: 数据, f: 帮手的名字 }),
 * 调 def[哪一口](d);ready(各口的 JSON) 查登记的对象里有没有这几口的函数。
 * host(0, 帮手名, JSON, 补丁表, ...字节)(参数打包成一个数组)成功交回 [JSON, 补丁表, ...字节]。
 * d.rand、d.km 在这里算(d.km 用自己留的一份位置,插件改了 d.xyz 也不变);d.params 和 civAtlas.params 是同一份只读的滑条
 */
export const MAP_SHIM = String.raw`(function (host, base, paramsJson, logOn) {
  'use strict';
  const KIND = '地图插件';
  const SAME = '同一个种子在哪里生成都要长出同一张图';
  const RAND_HINT = '随机数用 d.rand';
${COMMON}
  const F32 = Float32Array;
  function ask(name, args) {
    const w0 = encode(args, '参数');
    const call = [0, name];
    for (let i = 1; i < w0.length; i++) put(call, call.length, w0[i]);
    const w = apply(host, undefined, call);
    if (w[0] === null) hostThrow(w);
    return decode(w[0], w[1], w, 2);
  }
  const method = (name) => (...args) => ask(name, args);
  const rand = (a = 0, b = 0, c = 0) => keyed(a, b, c);

  let def = null;
  let open = true;
  function map(d) {
    if (!open) throw new Err('civAtlas.map 只能在插件代码的顶层调用');
    if (def) throw new Err('civAtlas.map 只能调用一次');
    if (d === null || typeof d !== 'object') throw new TErr('civAtlas.map 要给一个对象,里面是各步的函数(height、climate、layers)');
    def = d;
  }
  const params = freeze(parse(paramsJson));
  defProp(G, 'civAtlas', { value: freeze({ map, params }), enumerable: true });

  function call(stage, text, patches) {
    const h = decode(text, patches, arguments, 3);
    const data = h.d;
    const P = new F32(data.xyz);
    const N = data.n;
    const K = data.kmPerUnit;
    const cell = (a) => (a | 0) === a && a >= 0 && a < N;
    const km = (a, b) => {
      if (!cell(a) || !cell(b)) throw new TErr('d.km(a, b) 的 a、b 要是地块编号(0 到 n − 1 的整数)');
      const dx = P[3 * a] - P[3 * b];
      const dy = P[3 * a + 1] - P[3 * b + 1];
      const dz = P[3 * a + 2] - P[3 * b + 2];
      return sqrt(dx * dx + dy * dy + dz * dz) * K;
    };
    const d = {};
    const ks = keys(data);
    for (let i = 0; i < ks.length; i++) put(d, ks[i], data[ks[i]]);
    for (let i = 0; i < h.f.length; i++) {
      const f = h.f[i];
      put(d, f, f === 'rand' ? rand : f === 'km' ? km : method(f));
    }
    put(d, 'params', params);
    try {
      const r = apply(def[stage], def, [d]);
      if (r === undefined || r === null) return undefined;
      if (later(r)) throw new Err('要当场交回,不能交回 Promise');
      return encode(r);
    } catch (e) {
      return failed(e);
    }
  }
  function ready(stagesJson) {
    open = false;
    if (!def) throw new Err('插件代码里没有用 civAtlas.map({ ... }) 登记');
    const st = parse(stagesJson);
    for (let i = 0; i < st.length; i++) {
      if (typeof def[st[i]] !== 'function') throw new Err('civAtlas.map 登记的对象里没有 ' + st[i] + ' 函数(清单的 map.stages 写了这一步)');
    }
  }
  return [call, ready];
})`;

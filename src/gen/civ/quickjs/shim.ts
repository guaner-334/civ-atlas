/**
 * QuickJS 里插件代码之前先跑的那一层:登记 civAtlas.sim、把递进来的一回合包成 PluginTurn 的样子、回话打包递回去,
 * 再拿掉会让同一个种子推出不同历史(Date、Math.random)或跑审核没看过的代码(eval、Function 一族的构造器)的几样。
 *
 * 这段整个是一个函数表达式,装的时候调一次:SHIM(host, base, paramsJson) → [act, ready]。
 * host(kind, name, ...args):kind 0 = turn.read[name],1 = turn[name];成功交回 [JSON, 补丁表, ...字节],出错交回 [null, 编号, 名字, 说明]。
 * act(JSON, 补丁表, ...字节) 交回:undefined(没有回话)| [0, JSON, 补丁表, ...字节] | [1, 说明, 宿主错误的编号(没有 = −1), 1 内存用完 / 2 栈用完 / 0 别的]。
 * 数据的写法见 wire.ts;rand 和 util.ts 的 keyed / keyed4 逐位一样。
 */
export const SHIM = String.raw`(function (host, base, paramsJson) {
  'use strict';
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

  function encode(v) {
    const patches = [];
    const bufs = [];
    const path = [];
    const at = () => {
      const c = [];
      for (let i = 0; i < path.length; i++) put(c, i, path[i]);
      return c;
    };
    const walk = (x, depth) => {
      if (depth > DEPTH) throw new Err('回话套得太深(超过 ' + DEPTH + ' 层)');
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
            if (name === undefined) throw new Err('回话里的数组只能是数的类型化数组(Int8Array…Float64Array)');
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
          if (proto !== OP && proto !== null) throw new Err('回话里只能放普通对象');
          const ks = keys(x);
          for (let i = 0; i < ks.length; i++) {
            put(path, path.length, ks[i]);
            walk(x[ks[i]], depth + 1);
            path.length--;
          }
          return;
        }
        default:
          throw new Err('回话里只能放数、字、真假、数组和普通对象,不能有' + (typeof x === 'function' ? '函数' : typeof x));
      }
    };
    walk(v, 0);
    const text = patches.length ? stringify(v, replacer) : stringify(v);
    const out = [0, text === undefined ? 'null' : text, patches.length ? stringify(patches) : ''];
    for (let i = 0; i < bufs.length; i++) put(out, out.length, bufs[i]);
    return out;
  }

  function ask(kind, name, args) {
    const call = [kind, name];
    for (let i = 0; i < args.length; i++) put(call, call.length, args[i]);
    const w = apply(host, undefined, call);
    if (w[0] === null) {
      const e = new Err(w[3]);
      defProp(e, 'name', { value: w[2], writable: true, configurable: true });
      defProp(e, '__civHost', { value: w[1] });
      throw e;
    }
    return decode(w[0], w[1], w, 2);
  }
  const method = (kind, name) => (...args) => ask(kind, name, args);

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

  const SAME = '同一个种子在哪里推都要得到同一段历史';
  const RUN = '跑的代码要和审过的一样';
  const ban = (what, why) =>
    function () {
      throw new TErr('推演插件里不能用 ' + what + ':' + why);
    };
  const D = ban('Date', SAME);
  for (const k of ['now', 'parse', 'UTC']) D[k] = ban('Date.' + k, SAME);
  defProp(G, 'Date', { value: D, writable: true, configurable: true });
  defProp(Math, 'random', { value: ban('Math.random', SAME + ';随机数用 turn.rand'), writable: true, configurable: true });
  defProp(G, 'eval', { value: ban('eval', RUN), writable: true, configurable: true });
  const F = ban('Function', RUN);
  F.prototype = Function.prototype;
  defProp(G, 'Function', { value: F, writable: true, configurable: true });
  defProp(Function.prototype, 'constructor', { value: F, writable: true, configurable: true });
  for (const f of [async function () {}, function* () {}, async function* () {}]) {
    defProp(getProto(f), 'constructor', { value: ban('函数构造器', RUN), writable: true, configurable: true });
  }

  const read = {};
  let readKeys = null;
  let cur = null;
  const describe = (e) => {
    try {
      return e instanceof Err ? Str(e.message) : Str(e);
    } catch (x) {
      return '插件抛出的错说不清';
    }
  };

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
      if ((typeof r === 'object' || typeof r === 'function') && typeof r.then === 'function') throw new Err('回话要当场交回');
      return encode(r);
    } catch (e) {
      const tag = e !== null && typeof e === 'object' && apply(hasOwn, e, ['__civHost']) ? e.__civHost : -1;
      const ie = IE !== undefined && e instanceof IE;
      return [1, describe(e), tag, ie && e.message === 'out of memory' ? 1 : ie && e.message === 'stack overflow' ? 2 : 0];
    }
  }
  function ready() {
    open = false;
    if (!def) throw new Err('插件代码里没有用 civAtlas.sim({ act }) 登记');
  }
  return [act, ready];
})`;

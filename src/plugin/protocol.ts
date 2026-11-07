/**
 * 插件沙箱的里外两层怎么传话。纯逻辑,不碰 DOM,单测直接调;开沙箱的那一半在 ./sandbox.ts。
 *
 * 网站页面
 *  └─ <iframe sandbox="allow-scripts" srcdoc>   不透明来源,一个插件一个;里面只有 BOOT
 *       └─ new Worker(blob:)                     PRELUDE + 插件代码 + EPILOGUE
 *
 * 网站 → 框:   { kind: 'start', code }   { kind: 'to', data, t?(转交的 ArrayBuffer) }   { kind: 'stop' }
 * 框 → 网站:   { from: 'boot', kind: 'ready' }   { from: 'boot', kind: 'error', message }   { from: 'plugin', data }
 * 线程里外(data 那一层,v = PROTOCOL):
 *   网站 → 插件  { v, kind: 'ping', id }  { v, kind: 'call', id, data }  { v, kind: 'post', data }
 *               { v, kind: 'res', id, ok: true, data } / { v, kind: 'res', id, ok: false, error: { code, text } }  { v, kind: 'event', name, data }
 *   插件 → 网站  { v, kind: 'hello' }(插件代码顶层跑完)  { v, kind: 'pong', id }
 *               { v, kind: 'reply', id, ok: true, data } / { v, kind: 'reply', id, ok: false, error }  { v, kind: 'post', data }
 *               { v, kind: 'req', id, call, args }(插件调接口,网站回 res)
 *
 * 插件在线程里用 civAtlas.onCall(fn) 接 call(fn 的返回值或 Promise 结果就是回话)、civAtlas.onMessage(fn) 接 post、
 * civAtlas.post(data) 发 post(插件发出来的一律拷贝,不转交:框里转一手时带不过去 MessagePort 这类);
 * 接口照 caps.ts 的 PLUGIN_METHODS 长成 civAtlas.world.cells(args) 这样的函数,样子见 types.ts。
 */
import { PLUGIN_METHODS } from './caps';

export const PROTOCOL = 1;

/** 绝不能加 allow-same-origin:和 allow-scripts 一起开,框里能自己把 sandbox 属性删掉 */
export const SANDBOX_FLAGS = 'allow-scripts';

/** scriptSrc 是 script-src 的值;用散列不用 nonce:nonce 放行的脚本 import() 别的网址也放行 */
export function frameCsp(scriptSrc: string): string {
  return [
    "default-src 'none'",
    `script-src ${scriptSrc}`,
    'worker-src blob:',
    "connect-src 'none'",
    "img-src 'none'",
    "style-src 'none'",
    "font-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "manifest-src 'none'",
  ].join('; ');
}

/** 框里唯一的代码:只建线程、原样转话、叫停,不解释插件发来的任何东西。改了要跟着改 BOOT_HASH(单测会查) */
export const BOOT = `(function () {
  var O = '*', w = null, started = false;
  function up(m) { parent.postMessage(m, O); }
  function fail(e) { up({ from: 'boot', kind: 'error', message: String((e && e.message) || e) }); }
  addEventListener('message', function (e) {
    if (e.source !== parent) return;
    var m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.kind === 'start' && !started && typeof m.code === 'string') {
      started = true;
      if (e.origin && e.origin !== 'null') O = e.origin;
      try { w = new Worker(URL.createObjectURL(new Blob([m.code], { type: 'text/javascript' }))); } catch (err) { fail(err); return; }
      w.onmessage = function (ev) { try { up({ from: 'plugin', data: ev.data }); } catch (err) { fail(err); } };
      w.onerror = function (ev) { fail(ev.message || 'error'); };
      w.onmessageerror = function () { fail('messageerror'); };
    } else if (m.kind === 'to' && w) {
      try { w.postMessage(m.data, Array.isArray(m.t) ? m.t : []); } catch (err) { fail(err); }
    } else if (m.kind === 'stop' && w) {
      w.terminate();
      w = null;
    }
  });
  up({ from: 'boot', kind: 'ready' });
})();`;

export const BOOT_HASH = 'sha256-Yjga12ibMNQ4zGZqbgBfdoSXcH8w8ob4UyQzoME42qk=';

export const FRAME_SRCDOC = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${frameCsp(`'${BOOT_HASH}'`)}"></head><body><script>${BOOT}</script></body></html>`;

/**
 * 删掉 Worker:插件另开的线程不归 ping 管,能偷偷占满 CPU。
 * 顶层里发的话推到微任务里,排在 hello 后面;调接口的参数传不过去(带了函数之类)只让那一次调用失败,code 是 bad-args
 */
const PRELUDE = `(() => {
  const post = self.postMessage.bind(self);
  const V = ${PROTOCOL};
  const METHODS = ${JSON.stringify(Object.keys(PLUGIN_METHODS))};
  let onCall = null;
  let onMessage = null;
  let booting = true;
  let seq = 0;
  const waiting = new Map();
  const listeners = new Map();
  queueMicrotask(() => { booting = false; });
  const send = (m) => (booting ? queueMicrotask(() => post(m)) : post(m));
  try { delete self.Worker; } catch (e) {}
  const fail = (id, err) => post({ v: V, kind: 'reply', id, ok: false, error: String((err && err.message) || err) });
  const request = (call, args) => new Promise((resolve, reject) => {
    const id = ++seq;
    const m = { v: V, kind: 'req', id, call: String(call), args };
    const go = () => {
      try { post(m); waiting.set(id, { resolve, reject }); } catch (err) {
        const e = new Error('args cannot be sent: ' + String((err && err.message) || err));
        e.code = 'bad-args';
        reject(e);
      }
    };
    if (booting) queueMicrotask(go); else go();
  });
  const text = (x) => {
    if (typeof x === 'string') return x;
    try { const j = JSON.stringify(x); return j === undefined ? String(x) : j; } catch (e) { return String(x); }
  };
  const api = {
    protocol: V,
    onCall(fn) { onCall = typeof fn === 'function' ? fn : null; },
    onMessage(fn) { onMessage = typeof fn === 'function' ? fn : null; },
    post(data) { send({ v: V, kind: 'post', data }); },
    request,
    on(name, fn) {
      if (typeof fn !== 'function') return () => {};
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      set.add(fn);
      return () => { set.delete(fn); };
    },
    log(...parts) { request('log', { text: parts.map(text).join(' ') }).catch(() => {}); },
  };
  for (const name of METHODS) {
    if (name === 'log') continue;
    const path = name.split('.');
    let o = api;
    for (let i = 0; i < path.length - 1; i++) o = o[path[i]] || (o[path[i]] = {});
    o[path[path.length - 1]] = (args) => request(name, args);
  }
  const freeze = (o) => { for (const k of Object.keys(o)) if (o[k] && typeof o[k] === 'object') freeze(o[k]); return Object.freeze(o); };
  Object.defineProperty(self, 'civAtlas', { enumerable: true, value: freeze(api) });
  self.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.v !== V) return;
    if (m.kind === 'ping') post({ v: V, kind: 'pong', id: m.id });
    else if (m.kind === 'post') { if (onMessage) onMessage(m.data); }
    else if (m.kind === 'call') {
      Promise.resolve()
        .then(() => { if (!onCall) throw new Error('plugin has no onCall handler'); return onCall(m.data); })
        .then((data) => post({ v: V, kind: 'reply', id: m.id, ok: true, data }))
        .catch((err) => fail(m.id, err));
    } else if (m.kind === 'res') {
      const w = waiting.get(m.id);
      if (!w) return;
      waiting.delete(m.id);
      if (m.ok) { w.resolve(m.data); return; }
      const er = m.error || {};
      const err = new Error(String(er.text || er.code || 'error'));
      err.code = String(er.code || 'failed');
      w.reject(err);
    } else if (m.kind === 'event') {
      const set = listeners.get(m.name);
      if (set) for (const fn of [...set]) fn(m.data);
    }
  });
})();`;

/** 顶层跑完才说 hello;顶层里 civAtlas.post 的话排在 hello 后面发(send 推到微任务里) */
const EPILOGUE = `postMessage({ v: ${PROTOCOL}, kind: 'hello' });`;

/** 换行和分号隔开:插件代码最后一行是注释、没写分号也不会吞掉后面那句 */
export function workerSource(code: string): string {
  return `${PRELUDE}\n${code}\n;${EPILOGUE}\n`;
}

export type PluginMessage =
  | { kind: 'hello' }
  | { kind: 'pong'; id: number }
  | { kind: 'reply'; id: number; ok: true; data: unknown }
  | { kind: 'reply'; id: number; ok: false; error: string }
  | { kind: 'post'; data: unknown }
  | { kind: 'req'; id: number; call: string; args: unknown };

/** 网站回插件的调用:出错时 code 见 types.ts 的 PluginErrorCode */
export type PluginResponse = { ok: true; data: unknown } | { ok: false; error: { code: string; text: string } };

export type FrameMessage = { from: 'boot'; kind: 'ready' } | { from: 'boot'; kind: 'error'; message: string } | { from: 'plugin'; msg: PluginMessage };

const TEXT_MAX = 500;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) > 0;
const clip = (s: string) => (s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) : s);
/** 调用名的写法(认不认得这个调用由网站那边回话,写法不对算乱发话) */
const CALL_NAME = /^[a-z][a-zA-Z0-9]{0,31}(\.[a-z][a-zA-Z0-9]{0,31}){0,3}$/;

/** 框发来的一条话;不合格式返回 null(插件可以绕开 civAtlas 直接 postMessage,什么都可能来) */
export function readFrameMessage(raw: unknown): FrameMessage | null {
  if (!isRecord(raw)) return null;
  if (raw.from === 'boot') {
    if (raw.kind === 'ready') return { from: 'boot', kind: 'ready' };
    if (raw.kind === 'error') return { from: 'boot', kind: 'error', message: clip(typeof raw.message === 'string' ? raw.message : '') };
    return null;
  }
  if (raw.from !== 'plugin') return null;
  const msg = readPluginMessage(raw.data);
  return msg ? { from: 'plugin', msg } : null;
}

function readPluginMessage(m: unknown): PluginMessage | null {
  if (!isRecord(m) || m.v !== PROTOCOL) return null;
  switch (m.kind) {
    case 'hello':
      return { kind: 'hello' };
    case 'pong':
      return isId(m.id) ? { kind: 'pong', id: m.id } : null;
    case 'reply':
      if (!isId(m.id)) return null;
      if (m.ok === true) return { kind: 'reply', id: m.id, ok: true, data: m.data };
      if (m.ok === false) return { kind: 'reply', id: m.id, ok: false, error: clip(typeof m.error === 'string' ? m.error : '') };
      return null;
    case 'post':
      return { kind: 'post', data: m.data };
    case 'req':
      return isId(m.id) && typeof m.call === 'string' && CALL_NAME.test(m.call) ? { kind: 'req', id: m.id, call: m.call, args: m.args } : null;
    default:
      return null;
  }
}

/** 插件一秒最多发几条话,多了停掉 */
export const MESSAGES_PER_SECOND = 200;
/** 插件发来的一条话最大多少字节(估的),大了停掉 */
export const MESSAGE_MAX_BYTES = 4 * 1024 * 1024;
/** 估大小时最多看多少个值:层层套的小对象估起来也花时间(合规矩的话里最多的是 20 万个点的标注图层写成普通数组) */
const MEASURE_MAX_NODES = 1_000_000;

/**
 * 估一个值传过来占多少字节:字串按两字节一个字,数值数组按整个缓冲区的字节,别的值算 8 个字节。超过 max(或者值太多)就不再往下数,
 * 返回的数大于 max。同一个对象、同一个缓冲区出现几次只算一次。图片、画布这类估不了的东西一律算太大(接口只传数据)
 */
export function approxBytes(value: unknown, max: number): number {
  let total = 0;
  let nodes = 0;
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  const room = () => MEASURE_MAX_NODES - nodes - stack.length;
  while (stack.length) {
    const x = stack.pop();
    if (++nodes > MEASURE_MAX_NODES) return Infinity;
    if (typeof x === 'string') total += 8 + 2 * x.length;
    else if (x === null || typeof x !== 'object') total += 8;
    else if (seen.has(x)) continue;
    else {
      seen.add(x);
      // 小视图后面可能挂着大缓冲区,传过去的是整个缓冲区
      if (ArrayBuffer.isView(x)) stack.push(x.buffer);
      else if (x instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && x instanceof SharedArrayBuffer)) total += x.byteLength;
      else if (typeof Blob !== 'undefined' && x instanceof Blob) total += x.size;
      else if (Array.isArray(x)) {
        if (x.length > room()) return Infinity;
        total += 8;
        for (let i = 0; i < x.length; i++) stack.push(x[i]);
      } else if (x instanceof Map) {
        if (x.size * 2 > room()) return Infinity;
        for (const [k, v] of x) stack.push(k, v);
      } else if (x instanceof Set) {
        if (x.size > room()) return Infinity;
        for (const v of x) stack.push(v);
      } else if (x instanceof Error) {
        // 传过来的 Error 带着 message、stack、cause,都不是可枚举的键
        total += 8 + 2 * (String(x.name).length + String(x.message).length + String(x.stack ?? '').length);
        if ('cause' in x) stack.push(x.cause);
      } else if (x instanceof RegExp) total += 8 + 2 * x.source.length;
      else if (x instanceof String) total += 8 + 2 * x.length;
      else if (x instanceof Date || x instanceof Number || x instanceof Boolean) total += 8;
      else if (Object.getPrototypeOf(x) !== Object.prototype && Object.getPrototypeOf(x) !== null) return Infinity;
      else {
        const keys = Object.keys(x);
        if (keys.length > room()) return Infinity;
        for (const k of keys) {
          total += 8 + 2 * k.length;
          stack.push((x as Record<string, unknown>)[k]);
        }
      }
    }
    if (total > max) return total;
  }
  return total;
}

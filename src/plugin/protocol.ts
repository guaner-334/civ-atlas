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
 *   插件 → 网站  { v, kind: 'hello' }(插件代码顶层跑完)  { v, kind: 'pong', id }
 *               { v, kind: 'reply', id, ok: true, data } / { v, kind: 'reply', id, ok: false, error }  { v, kind: 'post', data }
 *
 * 插件在线程里用 civAtlas.onCall(fn) 接 call(fn 的返回值或 Promise 结果就是回话)、civAtlas.onMessage(fn) 接 post、
 * civAtlas.post(data) 发 post(插件发出来的一律拷贝,不转交:框里转一手时带不过去 MessagePort 这类)。
 */

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

/** 删掉 Worker:插件另开的线程不归 ping 管,能偷偷占满 CPU */
const PRELUDE = `(() => {
  const post = self.postMessage.bind(self);
  const V = ${PROTOCOL};
  let onCall = null;
  let onMessage = null;
  let booting = true;
  queueMicrotask(() => { booting = false; });
  const send = (m) => (booting ? queueMicrotask(() => post(m)) : post(m));
  try { delete self.Worker; } catch (e) {}
  const fail = (id, err) => post({ v: V, kind: 'reply', id, ok: false, error: String((err && err.message) || err) });
  Object.defineProperty(self, 'civAtlas', {
    enumerable: true,
    value: Object.freeze({
      protocol: V,
      onCall(fn) { onCall = typeof fn === 'function' ? fn : null; },
      onMessage(fn) { onMessage = typeof fn === 'function' ? fn : null; },
      post(data) { send({ v: V, kind: 'post', data }); },
    }),
  });
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
  | { kind: 'post'; data: unknown };

export type FrameMessage = { from: 'boot'; kind: 'ready' } | { from: 'boot'; kind: 'error'; message: string } | { from: 'plugin'; msg: PluginMessage };

const TEXT_MAX = 500;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isId = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) > 0;
const clip = (s: string) => (s.length > TEXT_MAX ? s.slice(0, TEXT_MAX) : s);

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
    default:
      return null;
  }
}

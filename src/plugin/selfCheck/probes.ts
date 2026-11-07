/**
 * 插件隔离自检真去试的那一半:用网站真用的沙箱(../sandbox.ts)开插件,把坏事试一遍。
 * 试法照 scripts/sandbox-check.ts(那边有收信站,这里只有插件自己看到的),判过没过在 ./verdict.ts。
 */
import batterySource from '../../../scripts/lib/sandbox/battery.js?raw';
import { frameCsp, SANDBOX_FLAGS } from '../protocol';
import { SandboxStopped, startPluginSandbox, type PluginSandbox } from '../sandbox';
import { ESCAPED_PARAM, NAV_WAYS, STOP_CASES, type BatteryRaw, type EchoRaw, type IsolationRaw, type NavRaw, type Outcome, type SpinRaw, type StopRaw } from './verdict';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reasonOf = (e: unknown) => (e instanceof SandboxStopped ? e.reason : `not stopped: ${String(e)}`);
const text = (x: unknown) => (typeof x === 'string' ? x : JSON.stringify(x)).slice(0, 120);

/** 网站页面在这两个频道上听着,插件喊话被听到就算漏 */
const CHANNELS = ['civ-atlas', 'civ-atlas-check'];

/** 每项检查的框挂在自己的盒子里,查完数盒子里还剩几个框 */
function box(): HTMLElement {
  const b = document.createElement('div');
  b.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  document.body.append(b);
  return b;
}
const framesIn = (b: HTMLElement) => b.querySelectorAll('iframe').length;

/** 往外连的地方都指着这个网站自己(没有收信站);读的本机存储是个不存在的名字,真漏了也带不出东西 */
export function batteryCode(page: URL): string {
  const probe = new URL('sandbox-probe', page).href;
  const swap: Record<string, string> = {
    __COLLECT__: probe,
    __WS__: probe.replace(/^http/, 'ws'),
    __HOST__: page.origin,
    __PRECONNECT__: '9',
    __TURN__: '9',
    __UDP__: '9',
    __SECRET_KEY__: 'sandbox-check-probe',
  };
  return batterySource.replace(/__[A-Z][A-Z_]*?__/g, (k) => swap[k] ?? k);
}

export async function battery(code: string): Promise<BatteryRaw> {
  const heard: string[] = [];
  const chans = typeof BroadcastChannel === 'undefined' ? [] : CHANNELS.map((n) => new BroadcastChannel(n));
  for (const c of chans) c.onmessage = (e) => heard.push(text(e.data));
  const b = box();
  try {
    let got: (v: { results?: Outcome[] }) => void = () => {};
    const out = new Promise<{ results?: Outcome[] }>((r) => (got = r));
    const t0 = performance.now();
    const sb = await startPluginSandbox(code, { parent: b, onMessage: (d) => (d as { type?: string })?.type === 'results' && got(d as { results?: Outcome[] }) });
    const readyMs = Math.round(performance.now() - t0);
    const r = await Promise.race([out, sleep(30_000).then(() => null)]);
    await sleep(300);
    const stoppedBefore = sb.stopped;
    sb.stop();
    return { readyMs, stoppedBefore, results: Array.isArray(r?.results) ? r.results : null, heard, framesLeft: framesIn(b) };
  } finally {
    for (const c of chans) c.close();
    b.remove();
  }
}

/** 两个插件各在各的来源:B 的频道喊话 A 听不到,网站也听不到 */
export async function isolation(): Promise<IsolationRaw> {
  const hostHeard: string[] = [];
  const aHeard: string[] = [];
  const chan = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('civ-atlas-check');
  if (chan) chan.onmessage = (e) => hostHeard.push(text(e.data));
  const b = box();
  try {
    const a = await startPluginSandbox(
      "const c = new BroadcastChannel('civ-atlas-check'); c.onmessage = (e) => civAtlas.post(e.data); civAtlas.onCall(() => { new BroadcastChannel('civ-atlas-check').postMessage('from-a-itself'); return 'ok'; });",
      { parent: b, onMessage: (d) => aHeard.push(text(d)) },
    );
    const bb = await startPluginSandbox("civAtlas.onCall(() => { new BroadcastChannel('civ-atlas-check').postMessage('from-b'); return 'ok'; });", { parent: b });
    await a.call(1);
    await bb.call(1);
    await sleep(500);
    a.stop();
    bb.stop();
    return { aHeard, hostHeard };
  } finally {
    chan?.close();
    b.remove();
  }
}

/** 一来一回、转交 36k 个数;另查回话出错、递了传不过去的东西、停了以后 */
export async function echo(): Promise<EchoRaw> {
  const msgs: unknown[] = [];
  const b = box();
  try {
    const sb = await startPluginSandbox(
      "civAtlas.post('early'); civAtlas.onCall((d) => { let s = 0; for (const x of d.a) s += x; return { s, n: d.a.length, back: d.a }; });",
      { parent: b, onMessage: (d) => msgs.push(d) },
    );
    const a = new Float32Array(36_000).fill(1);
    const t0 = performance.now();
    const r = (await sb.call({ a }, { transfer: [a.buffer] })) as { s: number; n: number; back: unknown };
    const ms = performance.now() - t0;
    let errorReply = '';
    try {
      await sb.call('x', { timeoutMs: 2000 });
    } catch (e) {
      errorReply = e instanceof Error ? e.message : String(e);
    }
    let uncloneable = '';
    try {
      await sb.call({ f: () => 1 });
    } catch (e) {
      uncloneable = `${(e as Error).name}, ${sb.stopped ?? 'still running'}`;
    }
    await sb.ping();
    sb.stop();
    return {
      s: r.s,
      n: r.n,
      backIsArray: r.back instanceof Float32Array && r.back.length === 36_000,
      detached: a.byteLength === 0,
      ms: +ms.toFixed(1),
      errorReply,
      uncloneable,
      early: msgs[0] === 'early',
      stopped: sb.stopped,
      afterStop: await sb.call('x').then(
        () => 'replied',
        (e) => reasonOf(e),
      ),
      framesLeft: framesIn(b),
    };
  } finally {
    b.remove();
  }
}

/** 一个出问题的插件:等它被停掉(最多 3 秒),记为什么停 */
async function expectStop(code: string, opts: { startTimeoutMs?: number } = {}, after?: (sb: PluginSandbox) => Promise<unknown>): Promise<StopRaw> {
  const b = box();
  const t0 = performance.now();
  let reason = '';
  let detail = '';
  let stopped: () => void = () => {};
  const gone = new Promise<void>((r) => (stopped = r));
  try {
    const sb = await startPluginSandbox(code, {
      ...opts,
      parent: b,
      onStop: (r, d) => {
        reason = r;
        detail = d;
        stopped();
      },
    });
    if (after) await after(sb).catch(() => {});
    await Promise.race([gone, sleep(3000)]);
    if (!reason) {
      sb.stop();
      reason = 'still running';
    }
  } catch (e) {
    reason = reasonOf(e);
    detail = e instanceof SandboxStopped ? e.detail : '';
  }
  await sleep(50);
  const framesLeft = framesIn(b);
  b.remove();
  return { reason, detail: detail.slice(0, 120), ms: Math.round(performance.now() - t0), framesLeft };
}

const STOP_CODE: Record<string, () => Promise<StopRaw>> = {
  syntax: () => expectStop('this is not javascript((('),
  throwLater: () => expectStop("setTimeout(() => { throw new Error('boom'); }, 50);"),
  garbage: () => expectStop("setTimeout(() => postMessage('garbage'), 50);"),
  forgedBoot: () => expectStop("setTimeout(() => postMessage({ from: 'boot', kind: 'error', message: 'forged' }), 50);"),
  wrongVersion: () => expectStop("setTimeout(() => postMessage({ v: 99, kind: 'post', data: 1 }), 50);"),
  strayReply: () => expectStop("setTimeout(() => postMessage({ v: 1, kind: 'reply', id: 12345, ok: true, data: 1 }), 50);"),
  topLevelLoop: () => expectStop('for (;;) {}', { startTimeoutMs: 1500 }),
  pingLoop: () => expectStop('setTimeout(() => { for (;;) {} }, 100);', {}, async (sb) => (await sleep(300), sb.ping(1000))),
};

/** 八种一起开:各等各的,一起等完 */
export async function stops(): Promise<Record<string, StopRaw>> {
  const keys = Object.keys(STOP_CASES);
  const res = await Promise.all(keys.map((k) => STOP_CODE[k]()));
  return Object.fromEntries(keys.map((k, i) => [k, res[i]]));
}

/** 插件死循环:网站这边每 10 毫秒的计时器最长隔多久,call 超时以后停没停 */
export async function spin(): Promise<SpinRaw> {
  const b = box();
  try {
    const sb = await startPluginSandbox('civAtlas.onCall(() => { for (;;) {} });', { parent: b });
    await sb.ping();
    let maxGap = 0;
    let last = performance.now();
    const tick = setInterval(() => {
      const now = performance.now();
      maxGap = Math.max(maxGap, now - last);
      last = now;
    }, 10);
    const reason = await sb.call('spin', { timeoutMs: 2500 }).then(
      () => 'replied',
      (e) => reasonOf(e),
    );
    clearInterval(tick);
    await sleep(50);
    return { reason, stopped: sb.stopped, maxGapMs: Math.round(maxGap), framesLeft: framesIn(b) };
  } finally {
    b.remove();
  }
}

/** 框的页面里直接跑的代码(模拟插件跑出了线程):属性、内容安全策略和沙箱一样,放行的散列换成这段代码的 */
async function rawFrame(script: string, parent: HTMLElement): Promise<HTMLIFrameElement> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(script));
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', SANDBOX_FLAGS);
  f.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${frameCsp(`'sha256-${hash}'`)}"></head><body><script>${script}</script></body></html>`;
  parent.append(f);
  return f;
}

/** 跳去的地方:.invalid 永远解析不了,真跳出去也连不到别人;整页被带走就回到这一页、网址上带记号 */
const NAV_HOST = (way: string) => `${way}.sandbox-check.invalid`;

/**
 * 框自己跳走、弹新窗口,五种各开一个框。没有收信站,靠两样看:
 * 前三种(框自己跳)被网站页面的 frame-src 拦下时,页面会收到 securitypolicyviolation;
 * 后两种(带走整页、弹窗)框里自己看得到 window.open 拿到 null 或抛错,整页真被带走了下次打开时网址上有记号。
 * 带着记号回来的那一次不再试带走整页,不然每次打开都被带走、一直查不完
 */
export async function frameNav(page: URL, skipTop = false): Promise<NavRaw> {
  const back = new URL(page.href);
  back.searchParams.set(ESCAPED_PARAM, 'top');
  const ways: Record<string, string> = {
    self: `location.href = 'https://${NAV_HOST('self')}/';`,
    refresh: `const m = document.createElement('meta'); m.httpEquiv = 'refresh'; m.content = '0;url=https://${NAV_HOST('refresh')}/'; document.head.append(m);`,
    link: `const a = document.createElement('a'); a.href = 'https://${NAV_HOST('link')}/'; document.body.append(a); a.click();`,
    top: `top.location.href = ${JSON.stringify(back.href)};`,
    open: `parent.postMessage('open:' + String(window.open('https://${NAV_HOST('open')}/')), '*');`,
  };
  if (skipTop) delete ways.top;
  const ran: string[] = [];
  const blocked: string[] = [];
  const loads: Record<string, number> = {};
  let open = '';
  let top = '';
  const onMsg = (e: MessageEvent) => {
    if (typeof e.data !== 'string') return;
    const [kind, rest] = [e.data.slice(0, e.data.indexOf(':')), e.data.slice(e.data.indexOf(':') + 1)];
    if (kind === 'ran') ran.push(rest);
    else if (kind === 'open') open = rest;
    else if (kind === 'threw') {
      const [way, name] = rest.split(' ');
      if (way === 'top') top = name;
      if (way === 'open') open = `threw:${name}`;
    }
  };
  const onViolation = (e: SecurityPolicyViolationEvent) => {
    if (!(e.effectiveDirective || e.violatedDirective || '').startsWith('frame-src')) return;
    const way = NAV_WAYS.find((w) => e.blockedURI.includes(NAV_HOST(w)));
    if (way && !blocked.includes(way)) blocked.push(way);
  };
  addEventListener('message', onMsg);
  document.addEventListener('securitypolicyviolation', onViolation, true);
  const b = box();
  try {
    for (const [k, code] of Object.entries(ways)) {
      const f = await rawFrame(`parent.postMessage('ran:${k}', '*'); setTimeout(() => { try { ${code} } catch (e) { parent.postMessage('threw:${k} ' + e.name, '*'); } }, 50);`, b);
      loads[k] = 0;
      f.addEventListener('load', () => loads[k]++);
    }
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      await sleep(100);
      if (ran.length === Object.keys(ways).length && blocked.length === 3 && open && (top || skipTop)) break;
    }
    // 第一次 load 是框自己的页面
    for (const k of Object.keys(loads)) loads[k] = Math.max(0, loads[k] - 1);
    return { ran: ran.sort(), blocked: blocked.sort(), open, top, loads };
  } finally {
    removeEventListener('message', onMsg);
    document.removeEventListener('securitypolicyviolation', onViolation, true);
    b.remove();
  }
}

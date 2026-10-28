/**
 * 地图操作测速:像用户一样放大、拖动、点国家,量每次操作主线程被占住多久、画面掉不掉帧,只打印摘要。
 *
 *   pnpm build && npx tsx scripts/perf-map.ts                 默认一组(电脑:政区 seed 7 / 2024、纯地形、实景;手机:触屏、4 倍降速)
 *   npx tsx scripts/perf-map.ts desktop | mobile | all        只跑电脑 / 只跑手机 / 全部(另加像素密度 1、关地名、72k、12k、20 万地块)
 *   npx tsx scripts/perf-map.ts --dist=别的目录                 量另一份构建(比如改之前的那份),和这份对比
 *   npx tsx scripts/perf-map.ts --url=https://…/               量线上网站(不起本地服务)
 *   npx tsx scripts/perf-map.ts --query=detail=sync            网址另加参数(detail=sync:细节层按原来的办法当场画完,对比用)
 *   --runs=3(放大那一组重复几轮,默认 3)  --out=snaps/perf.json(逐次原始记录)  --headed(开窗口跑)
 *   --case=4倍降速                                             只跑名字里带这几个字的情况
 *   npx tsx scripts/perf-map.ts curved                         弯边投影(罗宾森、摩尔威德):拖动转中央经线,停下再精画
 *   npx tsx scripts/perf-map.ts curvedops --runs=5             弯边投影逐项:第一次切到罗宾森 / 摩尔威德、换中心、拖动第一帧、拖动中、松手后(seed 7 / 2024,手绘 / 写实;
 *                                                              每轮开一个新页面;主线程每个任务多长从浏览器的跟踪记录里取,50 ms 以下也量得出;见文件末尾 runCurvedOps)
 *   npx tsx scripts/perf-map.ts globe                          地球仪:显卡画法、CPU 兼容画法(网址加 globe=cpu,没有 WebGL2 时走的那条路)
 *   npx tsx scripts/perf-map.ts click --op=点国家              点国家:平面、罗宾森、地球仪(电脑、手机 4 倍降速),只量点选
 *   --op=放大,点国家                                            只跑名字里带这几个字的操作(逗号分开)
 *   --profile=snaps/prof                                       每次操作另录一份 CPU profile,摘要里打印最耗时的几个函数
 *   --proj=mollweide                                           curvedops 只量这几种投影(逗号分开)
 *   curvedops 加 --profile=1:每段最长的那个任务里浏览器自己的几步(跑脚本、绘制……)各占多久、耗时最多的函数(--top=25 列几个);
 *                                                              函数名要可读就量一份不压缩的构建(vite build --minify false --outDir 别处,再 --dist= 指过去)
 *   --gpu                                                      用完整版 Chromium 的无界面模式跑(用得上显卡,画布走显卡加速,接近有独显 / 核显的电脑;默认的没有显卡)
 *
 * 每种情况开一个新页面,世界画好后依次:1 倍拖动 → 放大到 4 倍(第 1 轮 = 这一页第一次放大,之后几轮是第二、三次)→
 * 4 倍短拖 → 4 倍长拖(跨过画好的那一块)→(政区)放回 1 倍点一个国家。
 * 电脑用鼠标、按着 Ctrl 滚轮;手机用触屏拖动、双指捏合(Chromium 的触屏模拟,不是真机)。
 *
 * 摘要里每次操作一行:
 *   最长任务   这次操作里主线程一口气占住最久的一次(Long Task,≥ 50 ms 才记;0 = 没有超过 50 ms 的)
 *   阻塞合计   各次 Long Task 超出 50 ms 的部分加起来
 *   最长帧距   两帧之间最长隔了多久(requestAnimationFrame;16.7 = 一帧没掉)
 *   操作中 p95 操作进行中帧距的 95 分位
 *   补画       松手后到细节层最后一次画完(画面变清楚)多久(地球仪 CPU 画法:最后一次换上底图)
 *   面板       点国家:从按下到面板出现在屏幕上的那一帧画完
 *   底图p95   地球仪 CPU 画法:操作中底图两次换上之间的 95 分位(主线程不卡时球面本身多久更新一次)
 *   地形 / 文明 细节层画一次最久多少毫秒(主线程上的,后台分帧做的部分另算在"分帧"里)
 * 数字只在同一台机器、同一个浏览器上前后对比有意义;没有显卡的机器上画图比真机慢得多,只看趋势。
 */
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { preview } from 'vite';

interface Case {
  id: string;
  w: number;
  h: number;
  dpr: number;
  /** CPU 降速倍数(Chromium 模拟) */
  cpu: number;
  touch: boolean;
  seed: number;
  layer: 'political' | 'terrain' | 'realistic';
  civ?: string;
  cells?: number;
  /** 投影(不给 = 等距圆柱;globe = 地球仪) */
  proj?: string;
  /** 网址另加的参数(globe=cpu:地球仪走 CPU 兼容画法) */
  extra?: string;
}

const DESKTOP = { w: 1440, h: 900, dpr: 2, cpu: 1, touch: false };
const PHONE = { w: 390, h: 844, dpr: 3, cpu: 1, touch: true };
const PRESETS: Record<string, Case[]> = {
  desktop: [
    { id: '电脑-政区-7', ...DESKTOP, seed: 7, layer: 'political' },
    { id: '电脑-政区-2024', ...DESKTOP, seed: 2024, layer: 'political' },
    { id: '电脑-地形-7', ...DESKTOP, seed: 7, layer: 'terrain' },
    { id: '电脑-实景-7', ...DESKTOP, seed: 7, layer: 'realistic' },
  ],
  mobile: [
    { id: '手机-政区-7', ...PHONE, seed: 7, layer: 'political' },
    { id: '手机4倍降速-政区-7', ...PHONE, cpu: 4, seed: 7, layer: 'political' },
    { id: '手机4倍降速-实景-7', ...PHONE, cpu: 4, seed: 7, layer: 'realistic' },
  ],
  extra: [
    { id: '电脑密度1-政区-7', ...DESKTOP, dpr: 1, seed: 7, layer: 'political' },
    { id: '电脑-关地名-7', ...DESKTOP, seed: 7, layer: 'political', civ: '-labels' },
    { id: '电脑-12k-7', ...DESKTOP, seed: 7, layer: 'political', cells: 12000 },
    { id: '电脑-72k-7', ...DESKTOP, seed: 7, layer: 'political', cells: 72000 },
    { id: '电脑-20万-7', ...DESKTOP, seed: 7, layer: 'political', cells: 200000 },
  ],
  curved: [
    { id: '电脑-罗宾森-7', ...DESKTOP, seed: 7, layer: 'political', proj: 'robinson' },
    { id: '电脑-摩尔威德-7', ...DESKTOP, seed: 7, layer: 'political', proj: 'mollweide' },
    { id: '电脑-罗宾森-地形-7', ...DESKTOP, seed: 7, layer: 'terrain', proj: 'robinson' },
    { id: '手机4倍降速-罗宾森-7', ...PHONE, cpu: 4, seed: 7, layer: 'political', proj: 'robinson' },
  ],
};
// 弯边投影逐项(runCurvedOps):页面按等距圆柱打开,依次切到 CURVED_PROJS 里的每一种再量;写实 = 卫星(细节画法)+ 国家
PRESETS.curvedops = [7, 2024].flatMap((seed): Case[] => [
  { id: `电脑-手绘-${seed}`, ...DESKTOP, seed, layer: 'political' },
  { id: `电脑-写实-${seed}`, ...DESKTOP, seed, layer: 'political', extra: 'map=satellite&sat=detail' },
]);
PRESETS.globe = [
  { id: '电脑-地球仪CPU-7', ...DESKTOP, seed: 7, layer: 'political', proj: 'globe', extra: 'globe=cpu' },
  { id: '电脑-地球仪-7', ...DESKTOP, seed: 7, layer: 'political', proj: 'globe' },
  { id: '手机4倍降速-地球仪CPU-7', ...PHONE, cpu: 4, seed: 7, layer: 'political', proj: 'globe', extra: 'globe=cpu' },
  { id: '手机4倍降速-地球仪-7', ...PHONE, cpu: 4, seed: 7, layer: 'political', proj: 'globe' },
];
PRESETS.click = [
  PRESETS.desktop[0],
  PRESETS.curved[0],
  PRESETS.globe[1],
  PRESETS.globe[0],
  PRESETS.mobile[1],
  PRESETS.curved[3],
  PRESETS.globe[3],
  PRESETS.globe[2],
];
PRESETS.default = [...PRESETS.desktop, ...PRESETS.mobile];
PRESETS.all = [...PRESETS.desktop, ...PRESETS.mobile, ...PRESETS.extra, ...PRESETS.curved, ...PRESETS.globe];

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const preset = args.find((a) => !a.startsWith('--')) ?? 'default';
const ONLY = opt('case');
const OPS = opt('op')?.split(',').filter(Boolean);
const runOp = (op: string) => !OPS || OPS.some((o) => op.includes(o));
const cases = PRESETS[preset]?.filter((c) => !ONLY || c.id.includes(ONLY));
if (!cases) throw new Error(`没有「${preset}」这一组;可选:${Object.keys(PRESETS).join(' / ')}`);
const RUNS = Number(opt('runs') ?? 3);
const EXTRA_QUERY = opt('query') ?? '';
const OUT = opt('out');
const HEADED = args.includes('--headed');
const PROFILE = opt('profile');
/** curvedops 量哪几种弯边投影 */
const CURVED_PROJS = opt('proj')?.split(',') ?? ['robinson', 'mollweide'];

/**
 * 页面里的记录器(字符串:tsx 编译出的函数带 __name 包装,页面里没有)。
 * 拦下页面公开的调试字段(__wfDetail、__wfCivDetail、__wfView)每次赋值的时刻,逐帧记 RAF,Long Task 用 PerformanceObserver
 */
const RECORDER = `(() => {
  if (window.__perf) return;
  const P = (window.__perf = { cur: null });
  for (const key of ['__wfDetail', '__wfCivDetail', '__wfView', '__wfProj', '__wfCivProj', '__wfGlobe']) {
    let v = window[key];
    Object.defineProperty(window, key, {
      configurable: true,
      get: () => v,
      set: (n) => {
        const prev = v;
        v = n;
        const a = P.cur;
        if (!a || !n) return;
        const t = performance.now();
        if (key === '__wfView') { a.views.push({ t, k: n.k, x: n.x, y: n.y, lon: n.lon }); return; }
        if (key === '__wfGlobe') {
          // 地球仪每一帧都会重写一遍:视角变了才算一次视角变化;CPU 画法每换上一张底图记一次(旧版每帧当场画,没有 cpuSeq)
          if (!prev || prev.lon !== n.lon || prev.lat !== n.lat || prev.k !== n.k || prev.shift !== n.shift) a.views.push({ t, k: n.k, x: n.lon, y: n.lat, lon: n.lon });
          if (n.renderer === 'cpu' && (n.cpuSeq === undefined || !prev || prev.cpuSeq !== n.cpuSeq)) a.shows.push({ t });
          return;
        }
        if (n.ms === undefined || (key === '__wfCivDetail' && n.drew !== true)) return;
        a.draws.push({ t, key, ms: n.ms, exact: !!n.exact, k: n.k, prep: n.prep || 0, slices: n.slices || 0 });
      },
    });
  }
  // 按下的时刻(点国家:从这里算到面板出现)
  window.addEventListener('pointerdown', (e) => { const a = P.cur; if (a && !a.downAt) a.downAt = e.timeStamp; }, true);
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { const a = P.cur; if (a && a.panelSeen && !a.panelAt) a.panelAt = performance.now(); };
  P.begin = () => {
    const a = { start: performance.now(), inputEnd: 0, frames: [], tasks: [], draws: [], views: [], shows: [], running: true, obs: null, downAt: 0, panelSeen: 0, panelAt: 0 };
    P.cur = a;
    let last = null;
    const tick = (t) => {
      if (!a.running) return;
      if (last !== null) a.frames.push({ t, dt: t - last });
      last = t;
      // 面板第一次出现在这一帧:这一帧画完(紧跟着的消息)记为"面板出来"
      if (a.downAt && !a.panelSeen && document.querySelector('.inspector:not(.hidden)')) { a.panelSeen = t; ch.port2.postMessage(0); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    if (PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      a.obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) a.tasks.push({ t: e.startTime, ms: e.duration }); });
      a.obs.observe({ type: 'longtask' });
    }
  };
  P.end = async () => {
    const a = P.cur;
    a.inputEnd = performance.now();
    // 等画面稳下来:松手后至少 0.6 秒,且 0.4 秒里没有新的视角变化、细节层没有再画(最多等 6 秒)
    const quiet = () => {
      const t = Math.max(a.views.length ? a.views[a.views.length - 1].t : 0, a.draws.length ? a.draws[a.draws.length - 1].t : 0);
      const d = window.__wfDetail, c = window.__wfCivDetail, g = window.__wfGlobe;
      return performance.now() - t > 400 && !(d && d.pending) && !(c && c.pending) && !(g && g.cpuPending);
    };
    while (performance.now() - a.inputEnd < 6000) {
      await new Promise((r) => setTimeout(r, 50));
      if (performance.now() - a.inputEnd > 600 && quiet()) break;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (a.obs) { for (const e of a.obs.takeRecords()) a.tasks.push({ t: e.startTime, ms: e.duration }); a.obs.disconnect(); }
    a.running = false;
    a.end = performance.now();
    const g = window.__wfGlobe;
    a.final = g ? { k: g.k, x: g.lon, y: g.lat, lon: g.lon } : window.__wfView ? { k: window.__wfView.k, x: window.__wfView.x, y: window.__wfView.y, lon: window.__wfView.lon } : null;
    a.panel = [...document.querySelectorAll('.inspector')].some((e) => e.getBoundingClientRect().width > 0);
    a.canvasMiB = [...document.querySelectorAll('canvas')].reduce((s, c) => s + c.width * c.height * 4, 0) / 1048576;
    delete a.obs;
    P.cur = null;
    return a;
  };
})()`;

interface Raw {
  start: number;
  inputEnd: number;
  end: number;
  frames: { t: number; dt: number }[];
  tasks: { t: number; ms: number }[];
  draws: { t: number; key: string; ms: number; exact: boolean; k: number; prep: number; slices: number }[];
  views: { t: number; k: number; x: number; y: number; lon?: number }[];
  /** 地球仪 CPU 画法:每次换上底图的时刻 */
  shows: { t: number }[];
  downAt: number;
  panelAt: number;
  final: { k: number; x: number; y: number; lon?: number } | null;
  panel: boolean;
  canvasMiB: number;
  initial?: { k: number; x: number; y: number; lon?: number } | null;
}

interface Row {
  case: string;
  op: string;
  run: number;
  valid: boolean;
  longMax: number;
  blocking: number;
  frameMax: number;
  activeP95: number;
  settle: number;
  terrainMax: number;
  civMax: number;
  prepMax: number;
  /** 弯边投影:地形 / 文明重投影一次最久多少毫秒 */
  projMax: number;
  /** 点国家:按下到面板出现 */
  panelMs: number;
  /** 地球仪 CPU 画法:操作中底图换上间隔的 95 分位 */
  imgP95: number;
  k: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
function pct(a: number[], q: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))];
}

function summarize(c: Case, op: string, run: number, raw: Raw, valid: boolean): Row {
  const tasks = raw.tasks.filter((t) => t.t + t.ms >= raw.start);
  const active = raw.frames.filter((f) => f.t <= raw.inputEnd).map((f) => f.dt);
  const after = raw.draws.filter((d) => d.t > raw.inputEnd);
  const of = (key: string) => Math.max(0, ...raw.draws.filter((d) => d.key === key).map((d) => d.ms));
  const shows = raw.shows ?? [];
  const showGaps: number[] = [];
  for (let i = 1; i < shows.length; i++) if (shows[i].t <= raw.inputEnd + 100) showGaps.push(shows[i].t - shows[i - 1].t);
  const lastShow = shows.filter((d) => d.t > raw.inputEnd).pop();
  return {
    case: c.id,
    op,
    run,
    valid,
    longMax: r1(Math.max(0, ...tasks.map((t) => t.ms))),
    blocking: r1(tasks.reduce((s, t) => s + Math.max(0, t.ms - 50), 0)),
    frameMax: r1(Math.max(0, ...raw.frames.map((f) => f.dt))),
    activeP95: r1(pct(active, 0.95)),
    settle: after.length ? r1(after[after.length - 1].t - raw.inputEnd) : lastShow ? r1(lastShow.t - raw.inputEnd) : 0,
    terrainMax: r1(of('__wfDetail')),
    civMax: r1(of('__wfCivDetail')),
    prepMax: r1(Math.max(0, ...raw.draws.map((d) => d.prep))),
    projMax: r1(Math.max(of('__wfProj'), of('__wfCivProj'))),
    panelMs: raw.downAt && raw.panelAt ? r1(raw.panelAt - raw.downAt) : 0,
    imgP95: r1(pct(showGaps, 0.95)),
    k: Math.round((raw.final?.k ?? 0) * 1000) / 1000,
  };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

/** 量哪一份:--url 给的网站;否则把 --dist(默认 dist/)用 vite preview 起一个本地服务 */
async function serve(): Promise<{ url: string; close: () => Promise<void> }> {
  const url = opt('url');
  if (url) return { url: url.replace(/\/?$/, '/'), close: async () => {} };
  const dist = path.resolve(opt('dist') ?? 'dist');
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`${dist} 里没有构建好的网站:先 pnpm build(或用 --dist= 指一份)`);
  const port = await freePort();
  const server = await preview({ build: { outDir: dist }, preview: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
  return { url: `http://127.0.0.1:${port}/`, close: () => new Promise<void>((r) => server.httpServer.close(() => r())) };
}

async function drag(page: Page, c: Case, cdp: CDPSession, far: boolean) {
  const y = c.h * 0.43;
  const x0 = c.touch ? c.w * 0.2 : c.w * 0.78;
  const x1 = far ? (c.touch ? c.w * 0.8 : Math.max(420, c.w * 0.32)) : x0 + 35;
  for (let round = 0; round < (far ? 2 : 1); round++) {
    if (c.touch) {
      const pt = (x: number) => [{ id: 1, x, y, radiusX: 3, radiusY: 3, force: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0) });
      for (let i = 1; i <= 30; i++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + ((x1 - x0) * i) / 30) });
        await page.waitForTimeout(12);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x0, y);
      await page.mouse.down();
      for (let i = 1; i <= 30; i++) {
        await page.mouse.move(x0 + ((x1 - x0) * i) / 30, y);
        await page.waitForTimeout(12);
      }
      await page.mouse.up();
    }
  }
}

/** 放大到 4 倍:电脑按着 Ctrl 滚 12 下;手机双指捏合 20 步 */
async function zoom(page: Page, c: Case, cdp: CDPSession) {
  const x = c.w * (c.touch ? 0.5 : 0.65);
  const y = c.h * 0.43;
  if (c.touch) {
    const pts = (d: number) => [
      { id: 1, x: x - d, y, radiusX: 3, radiusY: 3, force: 1 },
      { id: 2, x: x + d, y, radiusX: 3, radiusY: 3, force: 1 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(25) });
    for (let i = 1; i <= 20; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(25 * Math.pow(4, i / 20)) });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.keyboard.down('Control');
    // 乘 dpr:Playwright 在 2 倍屏下发出去的滚动量到页面里会少一半,乘上以后实测正好停在 4 倍(结果里 at4 也会核对)
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, (-Math.log(4) / 12) * 100 * c.dpr);
      await page.waitForTimeout(30);
    }
    await page.keyboard.up('Control');
  }
}

interface CpuProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[];
  samples: number[];
  timeDeltas: number[];
}
/** profile 里自身耗时最多的几个函数(毫秒;不含空闲、垃圾回收照记) */
function topSelf(p: CpuProfile, n = 6): string {
  const self = new Map<number, number>();
  p.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (p.timeDeltas[i] ?? 0) / 1000));
  const byName = new Map<string, number>();
  for (const node of p.nodes) {
    const f = node.callFrame;
    if (f.functionName === '(idle)' || f.functionName === '(program)') continue;
    const name = `${f.functionName || '(匿名)'}@${f.url.split('/').pop()}:${f.lineNumber + 1}`;
    byName.set(name, (byName.get(name) ?? 0) + (self.get(node.id) ?? 0));
  }
  return [...byName].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${r1(v)}`).join('  ');
}

async function reset(page: Page, c: Case) {
  await page.keyboard.press('Escape');
  await page.evaluate(c.proj === 'globe' ? 'window.__wfGlobeSet(0, 18, 1)' : 'window.__wfSetView({ k: 1, x: 0, y: 0 }); window.__wfSetCenter(0);');
  await page.waitForTimeout(600);
  if (c.proj === 'globe') await page.waitForFunction('!(window.__wfGlobe && window.__wfGlobe.cpuPending)', null, { timeout: 30000 }).catch(() => {});
}

/**
 * 地球仪上找一个点了会打开国家面板的地方(球上没有公开的地名位置):从球心往外按固定顺序试,
 * 找到就关掉面板、转回来。改前改后试的顺序一样,点到的是同一个国家
 */
async function globePolityPoint(page: Page, c: Case): Promise<{ x: number; y: number } | null> {
  const offs: [number, number][] = [
    [0, 0],
    [0.3, 0],
    [-0.3, 0],
    [0, 0.3],
    [0, -0.3],
    [0.3, 0.3],
    [-0.3, 0.3],
    [0.3, -0.3],
    [-0.3, -0.3],
    [0.55, 0],
    [-0.55, 0],
    [0, 0.55],
    [0, -0.55],
  ];
  for (const [ox, oy] of offs) {
    await reset(page, c);
    const g = (await page.evaluate(
      `(() => { const b = document.querySelector('.globe').getBoundingClientRect(); const g = window.__wfGlobe; return { x: b.left, y: b.top, w: b.width, h: b.height, k: g.k, shift: g.shift }; })()`,
    )) as { x: number; y: number; w: number; h: number; k: number; shift: number };
    const R = 0.43 * Math.min(Math.max(1, g.w - 2 * Math.abs(g.shift)), g.h) * g.k;
    const pt = { x: g.x + g.w / 2 + g.shift + ox * R, y: g.y + g.h * 0.48 + oy * R };
    if (c.touch) await page.touchscreen.tap(pt.x, pt.y);
    else await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(800);
    const kind = await page.evaluate(`(() => { const e = document.querySelector('.inspector:not(.hidden)'); return e ? e.className : ''; })()`);
    if (String(kind).includes('k-polity')) {
      await reset(page, c);
      return pt;
    }
  }
  await reset(page, c);
  return null;
}

async function runCase(browser: Browser, base: string, c: Case, rows: Row[], raws: unknown[]) {
  const context: BrowserContext = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.dpr, isMobile: c.touch, hasTouch: c.touch });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const q = new URLSearchParams({
    ...(c.extra ? Object.fromEntries(new URLSearchParams(c.extra)) : {}),
    seed: String(c.seed),
    play: '0',
    layer: c.layer,
    ...(c.civ ? { civ: c.civ } : {}),
    ...(c.cells ? { cells: String(c.cells) } : {}),
    ...(c.proj ? { proj: c.proj } : {}),
  });
  const url = `${base}?${q}${EXTRA_QUERY ? `&${EXTRA_QUERY}` : ''}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 地球仪:球画出来了(平面主图的文字层不挂;地名排上要等历史推完,再等一会儿)
  await page.waitForFunction(c.proj === 'globe' ? 'window.__wfGlobe && window.__wfGlobe.ready' : 'window.__wfLabels && window.__wfLabels.ready', null, { timeout: 180000 });
  if (c.proj === 'globe') await page.waitForFunction('window.__wfGlobe.labels > 0', null, { timeout: 8000 }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await page.evaluate(RECORDER);
  const cdp = await context.newCDPSession(page);
  if (c.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: c.cpu });
  const view = () =>
    page.evaluate(
      'window.__wfGlobe ? { k: window.__wfGlobe.k, x: window.__wfGlobe.lon, y: window.__wfGlobe.lat, lon: window.__wfGlobe.lon } : window.__wfView ? { k: window.__wfView.k, x: window.__wfView.x, y: window.__wfView.y, lon: window.__wfView.lon } : null',
    ) as Promise<Raw['final']>;
  // 地球仪:等后台贴图、降速后的第一帧稳下来
  if (c.proj === 'globe') await page.waitForTimeout(1000);
  if (PROFILE) await cdp.send('Profiler.enable');
  const measure = async (op: string, run: number, act: () => Promise<void>, ok: (a: Raw) => boolean) => {
    if (!runOp(op)) return;
    const initial = await view();
    await page.evaluate('window.__perf.begin()');
    if (PROFILE) await cdp.send('Profiler.start');
    await act();
    const raw = (await page.evaluate('window.__perf.end()')) as Raw;
    raw.initial = initial;
    const row = summarize(c, op, run, raw, ok(raw));
    rows.push(row);
    raws.push({ case: c.id, op, run, raw });
    console.log(fmt(row));
    if (PROFILE) {
      const { profile } = (await cdp.send('Profiler.stop')) as { profile: CpuProfile };
      fs.mkdirSync(PROFILE, { recursive: true });
      fs.writeFileSync(path.join(PROFILE, `${c.id}-${op}-${run}.cpuprofile`), JSON.stringify(profile));
      console.log(`    ${topSelf(profile)}`);
    }
  };
  // 弯边投影里横向拖动转的是中央经线,不是平移
  const moved = (a: Raw) => !!a.initial && !!a.final && (Math.abs(a.final.x - a.initial.x) > 5 || Math.abs((a.final.lon ?? 0) - (a.initial.lon ?? 0)) > 1);
  const at4 = (a: Raw) => (a.final?.k ?? 0) >= 3.8 && (a.final?.k ?? 0) <= 4.3;
  const globePick = c.proj === 'globe' && c.layer === 'political' && runOp('点国家') ? await globePolityPoint(page, c) : null;
  await measure('1倍拖动', 0, () => drag(page, c, cdp, true), moved);
  for (let r = 0; r < RUNS; r++) {
    await reset(page, c);
    await measure('放大到4倍', r, () => zoom(page, c, cdp), at4);
    await measure('4倍短拖', r, () => drag(page, c, cdp, false), (a) => at4(a) && moved(a));
    await measure('4倍长拖', r, () => drag(page, c, cdp, true), (a) => at4(a) && moved(a));
    if (c.layer !== 'political' || !runOp('点国家')) continue;
    await reset(page, c);
    // 点一个看得见的国家(国名所在处),地图会飞过去、放大(地球仪:转过去)
    const pick =
      c.proj === 'globe'
        ? globePick
        : ((await page.evaluate(`(window.__wfPickables ? window.__wfPickables() : [])
      .filter((p) => p.kind === 'polity' && p.x > ${c.touch ? 30 : 370} && p.x < ${c.w - 30} && p.y > 120 && p.y < ${c.h - 230})
      .sort((a, b) => a.id - b.id)[0] || null`)) as { x: number; y: number } | null);
    if (!pick) continue;
    await measure(
      '点国家',
      r,
      async () => {
        if (c.touch) await page.touchscreen.tap(pick.x, pick.y);
        else await page.mouse.click(pick.x, pick.y);
        await page.waitForTimeout(30);
      },
      (a) => a.panel,
    );
  }
  if (errors.length) console.log(`  页面报错 ${errors.length} 条:${errors[0]}`);
  await context.close();
}

const COLS: [keyof Row, string][] = [
  ['longMax', '最长任务'],
  ['blocking', '阻塞合计'],
  ['frameMax', '最长帧距'],
  ['activeP95', '操作中p95'],
  ['settle', '补画'],
  ['terrainMax', '地形'],
  ['civMax', '文明'],
  ['prepMax', '分帧'],
  ['projMax', '投影'],
  ['panelMs', '面板'],
  ['imgP95', '底图p95'],
];
const fmt = (r: Row) =>
  `${r.case.padEnd(14)} ${`${r.op}#${r.run}`.padEnd(8)} ${COLS.map(([k, n]) => `${n} ${String(r[k]).padStart(6)}`).join('  ')}  k=${r.k}${r.valid ? '' : '  (轨迹不对,不算)'}`;

// ---------------------------------------------------------------------------
// 弯边投影逐项(curvedops)

/**
 * 页面里的记录器:几个调试字段最后一次被写的时刻(判断画面稳下来没有),逐帧记 RAF;
 * 每一段的起止用 performance.mark 打在浏览器的跟踪记录里(主线程每个任务多长从跟踪记录里取)
 */
const CURVED_RECORDER = `(() => {
  if (window.__cperf) return;
  const P = (window.__cperf = { last: 0, frames: [] });
  for (const key of ['__wfView', '__wfProj', '__wfCivProj', '__wfCiv', '__wfLabels', '__wf', '__wfDetail', '__wfCivDetail']) {
    let v = window[key];
    Object.defineProperty(window, key, { configurable: true, get: () => v, set: (n) => { v = n; P.last = performance.now(); } });
  }
  let last = null;
  const tick = (t) => { if (last !== null) P.frames.push({ t, dt: t - last }); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  P.mark = (name) => { performance.mark(name); return performance.now(); };
  // 等画面稳下来:至少 minMs,且 0.6 秒里调试字段没再被写、地形精画不在备(最多 10 秒)
  P.settle = async (minMs) => {
    const t0 = performance.now();
    while (performance.now() - t0 < 10000) {
      await new Promise((r) => setTimeout(r, 50));
      const p = window.__wfProj, d = window.__wfDetail, c = window.__wfCivDetail;
      if (performance.now() - t0 > minMs && performance.now() - P.last > 600 && !(p && p.pending) && !(d && d.pending) && !(c && c.pending)) break;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  };
})()`;

/** 一项的一次:主线程最长的任务(跟踪记录)、最长帧距(RAF) */
interface CurvedRow {
  case: string;
  proj: string;
  op: string;
  run: number;
  task: number;
  frame: number;
}

interface TraceEv {
  name: string;
  cat: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
}

/**
 * 量一轮:新页面按等距圆柱打开,对每种弯边投影依次 第一次切过去 → 换中心 → 拖动(第一帧 / 拖动中 / 松手后)→ 切回等距圆柱。
 * 段的划分:第一帧 = 按下到第 3 次移动;拖动中 = 之后到松手前;松手后 = 松手到画面稳下来(精画换上、国名重新排好)
 */
async function runCurvedOps(browser: Browser, base: string, c: Case, run: number, out: CurvedRow[]) {
  const context: BrowserContext = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.dpr });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const q = new URLSearchParams({ ...(c.extra ? Object.fromEntries(new URLSearchParams(c.extra)) : {}), seed: String(c.seed), play: '0', ...(c.extra?.includes('map=') ? {} : { layer: c.layer }) });
  await page.goto(`${base}?${q}${EXTRA_QUERY ? `&${EXTRA_QUERY}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__wfLabels && window.__wfLabels.ready', null, { timeout: 180000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await page.evaluate(CURVED_RECORDER);
  const mark = (name: string) => page.evaluate(`window.__cperf.mark(${JSON.stringify(name)})`) as Promise<number>;
  const settle = (min: number) => page.evaluate(`window.__cperf.settle(${min})`);
  // 每一段:[起点 mark, 终点 mark]
  const spans: { proj: string; op: string; a: string; b: string; ta: number; tb: number }[] = [];
  const cdp = PROFILE ? await context.newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  if (run === 0 && c === cases[0])
    console.log(
      `显卡 ${await page.evaluate(`(() => { const gl = document.createElement('canvas').getContext('webgl', { failIfMajorPerformanceCaveat: true }); if (!gl) return '没有(画布走 CPU)'; const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : '有'; })()`)}`,
    );
  await browser.startTracing(page, { categories: ['toplevel', 'blink.user_timing', ...(PROFILE ? ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'blink', 'v8'] : [])] });
  for (const proj of CURVED_PROJS) {
    const m = async (op: string, act: () => Promise<void>) => {
      const a = `cop:${proj}:${op}:a`;
      const b = `cop:${proj}:${op}:b`;
      const ta = await mark(a);
      await act();
      spans.push({ proj, op, a, b, ta, tb: await mark(b) });
    };
    await m('第一次切过去', async () => {
      await page.evaluate(`window.__wfSetProjection(${JSON.stringify(proj)})`);
      await settle(1500);
    });
    await m('换中心', async () => {
      await page.evaluate(`window.__wfSetCenter(${40 + run * 23})`);
      await settle(1000);
    });
    // 拖动:和 curved 那组的 1 倍拖动一样,从右往左 30 步
    const y = c.h * 0.43;
    const x0 = c.w * 0.78;
    const x1 = Math.max(420, c.w * 0.32);
    const pre = `cop:${proj}:`;
    const t0 = await mark(`${pre}拖动第一帧:a`);
    await page.mouse.move(x0, y);
    await page.mouse.down();
    for (let i = 1; i <= 3; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / 30, y);
      await page.waitForTimeout(12);
    }
    await page.waitForTimeout(40);
    const t1 = await mark(`${pre}拖动第一帧:b`);
    for (let i = 4; i <= 30; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / 30, y);
      await page.waitForTimeout(12);
    }
    const t2 = await mark(`${pre}松手后:a`);
    await page.mouse.up();
    await settle(1000);
    const t3 = await mark(`${pre}松手后:b`);
    spans.push({ proj, op: '拖动第一帧', a: `${pre}拖动第一帧:a`, b: `${pre}拖动第一帧:b`, ta: t0, tb: t1 });
    spans.push({ proj, op: '拖动中', a: `${pre}拖动第一帧:b`, b: `${pre}松手后:a`, ta: t1, tb: t2 });
    spans.push({ proj, op: '松手后', a: `${pre}松手后:a`, b: `${pre}松手后:b`, ta: t2, tb: t3 });
    await page.evaluate(`window.__wfSetProjection('equirect')`);
    await settle(1000);
  }
  const trace = JSON.parse((await browser.stopTracing()).toString()) as { traceEvents: TraceEv[] };
  const prof = cdp ? ((await cdp.send('Profiler.stop')) as { profile: CpuProfile & { startTime: number } }).profile : null;
  const frames = (await page.evaluate('window.__cperf.frames')) as { t: number; dt: number }[];
  const evs = trace.traceEvents;
  const marks = new Map<string, TraceEv>();
  for (const e of evs) if (e.name.startsWith('cop:') && e.cat.includes('blink.user_timing')) marks.set(e.name, e);
  const any = marks.values().next().value as TraceEv | undefined;
  if (!any) throw new Error('跟踪记录里没找到打的点');
  // 主线程:打点的那个线程;顶层任务(同一个任务两种名字都有时取外层)
  const tasks = evs.filter((e) => e.pid === any.pid && e.tid === any.tid && e.ph === 'X' && (e.name === 'ThreadControllerImpl::RunTask' || e.name === 'RunTask') && e.dur);
  for (const s of spans) {
    const a = marks.get(s.a)?.ts;
    const b = marks.get(s.b)?.ts;
    if (a === undefined || b === undefined) continue;
    const inSpan = tasks.filter((e) => e.ts < b && e.ts + (e.dur ?? 0) > a);
    const task = Math.max(0, ...inSpan.map((e) => (e.dur ?? 0) / 1000));
    // 帧距:这一段里画出来的帧(第一帧这一段算到它后面紧跟的那一帧)
    const frame = Math.max(0, ...frames.filter((f) => f.t > s.ta && f.t - f.dt < s.tb).map((f) => f.dt));
    const row: CurvedRow = { case: c.id, proj: s.proj, op: s.op, run, task: r1(task), frame: r1(frame) };
    out.push(row);
    // --profile:这一段最长的那个任务里,(含调用的)耗时最多的几个函数
    const top = inSpan.find((e) => (e.dur ?? 0) / 1000 === task);
    if (prof && top && task > 20) {
      // 这个任务里浏览器自己的几步(跑脚本、样式、绘制……)各占多久
      const kids = new Map<string, number>();
      for (const e of evs)
        if (e.pid === top.pid && e.tid === top.tid && e.ph === 'X' && e.cat !== 'toplevel' && e.ts >= top.ts && e.ts < top.ts + (top.dur ?? 0) && e !== top)
          kids.set(e.name, (kids.get(e.name) ?? 0) + (e.dur ?? 0) / 1000);
      console.log(`    ${s.proj}-${s.op} ${r1(task)}:${[...kids].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k} ${r1(v)}`).join('  ')}`);
      console.log(`      ${spanTop(prof, top.ts, top.ts + (top.dur ?? 0))}`);
    }
  }
  const mine = out.filter((r) => r.case === c.id && r.run === run);
  console.log(`${c.id} 第 ${run + 1} 轮  ${mine.map((r) => `${r.proj.slice(0, 3)}-${r.op} ${r.task}/${r.frame}`).join('  ')}`);
  if (errors.length) console.log(`  页面报错 ${errors.length} 条:${errors[0]}`);
  await context.close();
}

/** CPU profile 里 [t0, t1](微秒,和跟踪记录同一个时钟)这段时间,含调用的耗时最多的几个函数(毫秒) */
function spanTop(p: CpuProfile & { startTime: number }, t0: number, t1: number, n = Number(opt('top') ?? 10)): string {
  const parent = new Map<number, number>();
  const byId = new Map(p.nodes.map((nd) => [nd.id, nd]));
  for (const nd of p.nodes) for (const ch of nd.children ?? []) parent.set(ch, nd.id);
  const total = new Map<string, number>();
  let t = p.startTime;
  p.samples.forEach((id, i) => {
    const dt = p.timeDeltas[i] ?? 0;
    t += dt;
    if (t < t0 || t > t1) return;
    const seen = new Set<string>();
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
      const f = byId.get(cur)!.callFrame;
      if (!f.url) continue;
      const name = `${f.functionName || '(匿名)'}@${f.url.split('/').pop()}:${f.lineNumber + 1}`;
      if (seen.has(name)) continue;
      seen.add(name);
      total.set(name, (total.get(name) ?? 0) + (p.timeDeltas[i + 1] ?? dt) / 1000);
    }
  });
  return [...total].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${r1(v)}`).join('  ');
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : r1((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
}

const srv = await serve();
console.log(`量 ${srv.url}${EXTRA_QUERY ? `(另加 ${EXTRA_QUERY})` : ''},${cases.length} 种情况,放大重复 ${RUNS} 轮;单位 ms`);
// --gpu:用完整版 Chromium 的无界面模式(能用上本机显卡,画布走显卡加速;默认的精简无界面版没有显卡,画布全在 CPU 上画)
const browser = await chromium.launch({ headless: !HEADED, ...(args.includes('--gpu') ? { channel: 'chromium' } : {}) });
console.log(`浏览器 ${browser.version()}`);
const rows: Row[] = [];
const raws: unknown[] = [];
if (preset === 'curvedops') {
  console.log(`负载 ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
  const out: CurvedRow[] = [];
  try {
    for (const c of cases) for (let r = 0; r < RUNS; r++) await runCurvedOps(browser, srv.url, c, r, out);
  } finally {
    await browser.close();
    await srv.close();
  }
  console.log(`负载 ${os.loadavg().map((x) => x.toFixed(2)).join(' ')}`);
  console.log(`\n== 汇总(主线程最长任务:中位 / 最大;括号里是最长帧距的最大值;${RUNS} 轮)`);
  const opNames = ['第一次切过去', '换中心', '拖动第一帧', '拖动中', '松手后'];
  console.log(`${'情况'.padEnd(18)} ${opNames.map((o) => o.padStart(20)).join(' ')}`);
  for (const c of cases)
    for (const proj of CURVED_PROJS) {
      const cells = opNames.map((o) => {
        const sel = out.filter((r) => r.case === c.id && r.proj === proj && r.op === o);
        if (!sel.length) return '—'.padStart(20);
        return `${median(sel.map((r) => r.task))} / ${Math.max(...sel.map((r) => r.task))} (${Math.max(...sel.map((r) => r.frame))})`.padStart(20);
      });
      console.log(`${`${c.id}-${proj}`.padEnd(18)} ${cells.join(' ')}`);
    }
  if (OUT) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ url: srv.url, query: EXTRA_QUERY, rows: out }, null, 1));
  }
  process.exit(0);
}
try {
  for (const c of cases) await runCase(browser, srv.url, c, rows, raws);
} finally {
  await browser.close();
  await srv.close();
}
// 汇总:每种情况、每种操作取有效的几轮里最差的(第一次放大单列)
console.log('\n== 汇总(每格 = 有效几轮里最长任务的最大值 / 最长帧距的最大值;点国家另加按下到面板出现的最大值)');
const ops = ['1倍拖动', '放大到4倍#0', '放大到4倍#1+', '4倍短拖', '4倍长拖', '点国家'];
console.log(`${'情况'.padEnd(14)} ${ops.map((o) => o.padStart(14)).join('')}`);
for (const c of cases) {
  const cells = ops.map((o) => {
    const sel = rows.filter((r) => r.case === c.id && r.valid && (o === '放大到4倍#0' ? r.op === '放大到4倍' && r.run === 0 : o === '放大到4倍#1+' ? r.op === '放大到4倍' && r.run > 0 : r.op === o));
    if (!sel.length) return '—'.padStart(14);
    const panel = o === '点国家' ? ` / ${Math.max(...sel.map((r) => r.panelMs))}` : '';
    return `${Math.max(...sel.map((r) => r.longMax))} / ${Math.max(...sel.map((r) => r.frameMax))}${panel}`.padStart(o === '点国家' ? 20 : 14);
  });
  console.log(`${c.id.padEnd(14)} ${cells.join('')}`);
}
if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ url: srv.url, query: EXTRA_QUERY, browser: browser.version(), rows, raws }, null, 1));
  console.log(`逐次原始记录:${OUT}`);
}

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
 *   补画       松手后到细节层最后一次画完(画面变清楚)多久
 *   地形 / 文明 细节层画一次最久多少毫秒(主线程上的,后台分帧做的部分另算在"分帧"里)
 * 数字只在同一台机器、同一个浏览器上前后对比有意义;没有显卡的机器上画图比真机慢得多,只看趋势。
 */
import fs from 'node:fs';
import net from 'node:net';
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
};
PRESETS.default = [...PRESETS.desktop, ...PRESETS.mobile];
PRESETS.all = [...PRESETS.desktop, ...PRESETS.mobile, ...PRESETS.extra];

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const preset = args.find((a) => !a.startsWith('--')) ?? 'default';
const ONLY = opt('case');
const cases = PRESETS[preset]?.filter((c) => !ONLY || c.id.includes(ONLY));
if (!cases) throw new Error(`没有「${preset}」这一组;可选:${Object.keys(PRESETS).join(' / ')}`);
const RUNS = Number(opt('runs') ?? 3);
const EXTRA_QUERY = opt('query') ?? '';
const OUT = opt('out');
const HEADED = args.includes('--headed');

/**
 * 页面里的记录器(字符串:tsx 编译出的函数带 __name 包装,页面里没有)。
 * 拦下页面公开的调试字段(__wfDetail、__wfCivDetail、__wfView)每次赋值的时刻,逐帧记 RAF,Long Task 用 PerformanceObserver
 */
const RECORDER = `(() => {
  if (window.__perf) return;
  const P = (window.__perf = { cur: null });
  for (const key of ['__wfDetail', '__wfCivDetail', '__wfView']) {
    let v = window[key];
    Object.defineProperty(window, key, {
      configurable: true,
      get: () => v,
      set: (n) => {
        v = n;
        const a = P.cur;
        if (!a || !n) return;
        const t = performance.now();
        if (key === '__wfView') { a.views.push({ t, k: n.k, x: n.x, y: n.y }); return; }
        if (n.ms === undefined || (key === '__wfCivDetail' && n.drew !== true)) return;
        a.draws.push({ t, key, ms: n.ms, exact: !!n.exact, k: n.k, prep: n.prep || 0, slices: n.slices || 0 });
      },
    });
  }
  P.begin = () => {
    const a = { start: performance.now(), inputEnd: 0, frames: [], tasks: [], draws: [], views: [], running: true, obs: null };
    P.cur = a;
    let last = null;
    const tick = (t) => {
      if (!a.running) return;
      if (last !== null) a.frames.push({ t, dt: t - last });
      last = t;
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
      const d = window.__wfDetail, c = window.__wfCivDetail;
      return performance.now() - t > 400 && !(d && d.pending) && !(c && c.pending);
    };
    while (performance.now() - a.inputEnd < 6000) {
      await new Promise((r) => setTimeout(r, 50));
      if (performance.now() - a.inputEnd > 600 && quiet()) break;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    if (a.obs) { for (const e of a.obs.takeRecords()) a.tasks.push({ t: e.startTime, ms: e.duration }); a.obs.disconnect(); }
    a.running = false;
    a.end = performance.now();
    a.final = window.__wfView ? { k: window.__wfView.k, x: window.__wfView.x, y: window.__wfView.y } : null;
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
  views: { t: number; k: number; x: number; y: number }[];
  final: { k: number; x: number; y: number } | null;
  panel: boolean;
  canvasMiB: number;
  initial?: { k: number; x: number; y: number } | null;
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
  return {
    case: c.id,
    op,
    run,
    valid,
    longMax: r1(Math.max(0, ...tasks.map((t) => t.ms))),
    blocking: r1(tasks.reduce((s, t) => s + Math.max(0, t.ms - 50), 0)),
    frameMax: r1(Math.max(0, ...raw.frames.map((f) => f.dt))),
    activeP95: r1(pct(active, 0.95)),
    settle: after.length ? r1(after[after.length - 1].t - raw.inputEnd) : 0,
    terrainMax: r1(of('__wfDetail')),
    civMax: r1(of('__wfCivDetail')),
    prepMax: r1(Math.max(0, ...raw.draws.map((d) => d.prep))),
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

async function reset(page: Page) {
  await page.keyboard.press('Escape');
  await page.evaluate('window.__wfSetView({ k: 1, x: 0, y: 0 }); window.__wfSetCenter(0);');
  await page.waitForTimeout(600);
}

async function runCase(browser: Browser, base: string, c: Case, rows: Row[], raws: unknown[]) {
  const context: BrowserContext = await browser.newContext({ viewport: { width: c.w, height: c.h }, deviceScaleFactor: c.dpr, isMobile: c.touch, hasTouch: c.touch });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const q = new URLSearchParams({ seed: String(c.seed), play: '0', layer: c.layer, ...(c.civ ? { civ: c.civ } : {}), ...(c.cells ? { cells: String(c.cells) } : {}) });
  const url = `${base}?${q}${EXTRA_QUERY ? `&${EXTRA_QUERY}` : ''}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction('window.__wfLabels && window.__wfLabels.ready', null, { timeout: 180000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  await page.evaluate(RECORDER);
  const cdp = await context.newCDPSession(page);
  if (c.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: c.cpu });
  const view = () => page.evaluate('window.__wfView ? { k: window.__wfView.k, x: window.__wfView.x, y: window.__wfView.y } : null') as Promise<Raw['final']>;
  const measure = async (op: string, run: number, act: () => Promise<void>, ok: (a: Raw) => boolean) => {
    const initial = await view();
    await page.evaluate('window.__perf.begin()');
    await act();
    const raw = (await page.evaluate('window.__perf.end()')) as Raw;
    raw.initial = initial;
    const row = summarize(c, op, run, raw, ok(raw));
    rows.push(row);
    raws.push({ case: c.id, op, run, raw });
    console.log(fmt(row));
  };
  const moved = (a: Raw) => !!a.initial && !!a.final && Math.abs(a.final.x - a.initial.x) > 5;
  const at4 = (a: Raw) => (a.final?.k ?? 0) >= 3.8 && (a.final?.k ?? 0) <= 4.3;
  await measure('1倍拖动', 0, () => drag(page, c, cdp, true), moved);
  for (let r = 0; r < RUNS; r++) {
    await reset(page);
    await measure('放大到4倍', r, () => zoom(page, c, cdp), at4);
    await measure('4倍短拖', r, () => drag(page, c, cdp, false), (a) => at4(a) && moved(a));
    await measure('4倍长拖', r, () => drag(page, c, cdp, true), (a) => at4(a) && moved(a));
    if (c.layer !== 'political') continue;
    await reset(page);
    // 点一个看得见的国家(国名所在处),地图会飞过去、放大
    const pick = (await page.evaluate(`(window.__wfPickables ? window.__wfPickables() : [])
      .filter((p) => p.kind === 'polity' && p.x > ${c.touch ? 30 : 370} && p.x < ${c.w - 30} && p.y > 120 && p.y < ${c.h - 230})
      .sort((a, b) => a.id - b.id)[0] || null`)) as { x: number; y: number } | null;
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
];
const fmt = (r: Row) =>
  `${r.case.padEnd(14)} ${`${r.op}#${r.run}`.padEnd(8)} ${COLS.map(([k, n]) => `${n} ${String(r[k]).padStart(6)}`).join('  ')}  k=${r.k}${r.valid ? '' : '  (轨迹不对,不算)'}`;

const srv = await serve();
console.log(`量 ${srv.url}${EXTRA_QUERY ? `(另加 ${EXTRA_QUERY})` : ''},${cases.length} 种情况,放大重复 ${RUNS} 轮;单位 ms`);
const browser = await chromium.launch({ headless: !HEADED });
console.log(`浏览器 ${browser.version()}`);
const rows: Row[] = [];
const raws: unknown[] = [];
try {
  for (const c of cases) await runCase(browser, srv.url, c, rows, raws);
} finally {
  await browser.close();
  await srv.close();
}
// 汇总:每种情况、每种操作取有效的几轮里最差的(第一次放大单列)
console.log('\n== 汇总(每格 = 有效几轮里最长任务的最大值 / 最长帧距的最大值)');
const ops = ['1倍拖动', '放大到4倍#0', '放大到4倍#1+', '4倍短拖', '4倍长拖', '点国家'];
console.log(`${'情况'.padEnd(14)} ${ops.map((o) => o.padStart(14)).join('')}`);
for (const c of cases) {
  const cells = ops.map((o) => {
    const sel = rows.filter((r) => r.case === c.id && r.valid && (o === '放大到4倍#0' ? r.op === '放大到4倍' && r.run === 0 : o === '放大到4倍#1+' ? r.op === '放大到4倍' && r.run > 0 : r.op === o));
    if (!sel.length) return '—'.padStart(14);
    return `${Math.max(...sel.map((r) => r.longMax))} / ${Math.max(...sel.map((r) => r.frameMax))}`.padStart(14);
  });
  console.log(`${c.id.padEnd(14)} ${cells.join('')}`);
}
if (OUT) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ url: srv.url, query: EXTRA_QUERY, browser: browser.version(), rows, raws }, null, 1));
  console.log(`逐次原始记录:${OUT}`);
}

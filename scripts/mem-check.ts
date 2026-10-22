/**
 * 手机尺寸下各种操作的内存:像手机用户一样操作(390×844、3 倍屏、触屏),操作期间每 300 ms 取一次记峰值,做完收一次垃圾再取(回落到多少)。
 *
 *   pnpm build && npx tsx scripts/mem-check.ts               全部场景,量 dist/
 *   npx tsx scripts/mem-check.ts --dist=别的目录               量另一份构建(比如改之前的那份),和这份对比
 *   --only=new36k,edit20                                     只跑这几个场景   --out=snaps/mem.json  原始数据
 *   --every=150                                              操作期间多少毫秒取一次(默认 300;短的峰值取得到,取样本身也占一点)
 *
 * 场景:new36k / new200k 新建世界(3.6 万 / 20 万地块);edit20 编辑地形连涂 20 笔(陆地笔,星球照草图重新长;另打每一笔里的峰值);
 * edit20h 同上,换到「高度」页用抬高笔涂(按块重铺、按块换上);open 打开一个世界;play 播放时间轴 45 秒;
 * director 导播 45 秒;globe 地球仪开关 3 次(每次转几下);globezoom 打开地球仪放大到 2.4 倍、5 倍;export 导出地图图片 1 倍、2 倍;switch5 回我的世界新建并创建,连换 5 个世界;
 * stepui 逐年推演的界面:世界卡片里「从这里演绎」,照默认设置往下走 60 秒(停下来就点「接着演绎」);
 * stepwise50 逐年推演走 50 步(一步 20 年;只量后台线程这一头:在空白首页里另开一个生成线程,按逐年推演的请求一步步走)。
 *
 * 每个场景一个新浏览器。量的几样(MB):
 *   JS 主     页面主线程的 JS 堆 + ArrayBuffer(Runtime.getHeapUsage 的 usedSize + backingStorageSize)
 *   线程      各后台线程(生成、帮手、导出、地球仪……)同样两项加起来
 *   画布      建过上下文、还活着的画布和 ImageBitmap 按 宽×高×4 估算(主线程 + 线程;显存里的那份浏览器不报,只能估)
 *   渲染进程 / 显卡进程   系统看到的进程私有内存(Windows 是 PrivateMemorySize,别的系统是常驻内存)
 * 用的是 Chromium 的手机模拟,不是真机:Safari 的 JS 引擎、画布、显存记账都不一样,数字只在同一台机器上前后对比有意义。
 * Playwright 起浏览器时另开一个调试端口,脚本直接连上(页面和它开的每个线程各连一路)。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { preview } from 'vite';
import { DEFAULT_PARAMS } from '../src/gen/world';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DIST = path.resolve(opt('dist') ?? 'dist');
const ONLY = opt('only')?.split(',');
const OUT = opt('out');
/** 操作期间多少毫秒取一次样 */
const EVERY = Number(opt('every')) || 300;
const MB = 1024 * 1024;
const mb = (n: number | undefined) => (n === undefined ? '—' : (n / MB).toFixed(0));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** 页面里、线程里都注入:登记建过上下文的画布和 ImageBitmap(弱引用),__memCensus() 数还活着的占多少字节 */
const CENSUS = `(() => {
  if (self.__memCensus) return;
  const cvs = new Set();
  const bms = new Set();
  for (const C of [self.HTMLCanvasElement, self.OffscreenCanvas]) {
    if (!C) continue;
    const g = C.prototype.getContext;
    C.prototype.getContext = function (...a) { const ctx = g.apply(this, a); if (ctx && !this.__memReg) { this.__memReg = 1; cvs.add(new WeakRef(this)); } return ctx; };
    const tb = C.prototype.transferToImageBitmap;
    if (tb) C.prototype.transferToImageBitmap = function (...a) { const b = tb.apply(this, a); bms.add(new WeakRef(b)); return b; };
  }
  const cib = self.createImageBitmap;
  if (cib) self.createImageBitmap = function (...a) { return cib.apply(this, a).then((b) => { bms.add(new WeakRef(b)); return b; }); };
  self.__memCensus = () => {
    let n = 0;
    for (const set of [cvs, bms]) for (const r of set) { const c = r.deref(); if (!c) set.delete(r); else n += c.width * c.height * 4; }
    return n;
  };
})();`;

// ---------------------------------------------------------------------------
// 调试端口:页面、线程各连一路

interface Usage {
  used: number;
  backing: number;
}

class Cdp {
  private ws!: WebSocket;
  private seq = 0;
  private pending = new Map<number, { ok: (v: any) => void; bad: (e: Error) => void }>();
  /** 每一路连接 → 名字(main / 线程脚本名#序号) */
  sessions = new Map<string, string>();
  private names = new Map<string, number>();
  page = '';

  static async connect(port: number): Promise<Cdp> {
    const c = new Cdp();
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    c.ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise<void>((ok, bad) => {
      c.ws.onopen = () => ok();
      c.ws.onerror = () => bad(new Error('连不上调试端口'));
    });
    c.ws.onmessage = (e) => c.onMessage(JSON.parse(String(e.data)));
    return c;
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeout = 20000): Promise<any> {
    const id = ++this.seq;
    return new Promise((ok, bad) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        bad(new Error(`${method} 超时`));
      }, timeout);
      this.pending.set(id, {
        ok: (v) => (clearTimeout(timer), ok(v)),
        bad: (e) => (clearTimeout(timer), bad(e)),
      });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  private onMessage(m: any) {
    if (m.id) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.bad(new Error(m.error.message));
      else p.ok(m.result);
      return;
    }
    if (m.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo, waitingForDebugger } = m.params;
      void (async () => {
        if (targetInfo.type === 'worker') {
          const short = (targetInfo.url.replace(/[?#].*$/, '').split('/').pop() || 'worker').replace(/-[A-Za-z0-9_-]{6,}\.js$/, '').replace(/\.(js|ts)$/, '');
          const k = (this.names.get(short) ?? 0) + 1;
          this.names.set(short, k);
          this.sessions.set(sessionId, `${short}#${k}`);
          // 线程开始跑之前注入画布登记;它再开的线程也接上
          await this.send('Runtime.evaluate', { expression: CENSUS }, sessionId).catch(() => {});
          await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId).catch(() => {});
        }
        if (waitingForDebugger) await this.send('Runtime.runIfWaitingForDebugger', {}, sessionId).catch(() => {});
      })();
    } else if (m.method === 'Target.detachedFromTarget') this.sessions.delete(m.params.sessionId);
  }

  async attachPage(): Promise<void> {
    const t = await this.send('Target.getTargets');
    const pg = t.targetInfos.find((x: any) => x.type === 'page');
    const a = await this.send('Target.attachToTarget', { targetId: pg.targetId, flatten: true });
    this.page = a.sessionId;
    this.sessions.set(a.sessionId, 'main');
    await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, a.sessionId);
  }

  async heap(s: string): Promise<Usage | null> {
    const r = await this.send('Runtime.getHeapUsage', {}, s, 5000).catch(() => null);
    return r ? { used: r.usedSize, backing: r.backingStorageSize ?? 0 } : null;
  }

  async census(s: string): Promise<number> {
    const r = await this.send('Runtime.evaluate', { expression: 'self.__memCensus ? self.__memCensus() : 0', returnByValue: true }, s, 5000).catch(() => null);
    return r?.result?.value ?? 0;
  }

  async gc(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((s) => this.send('HeapProfiler.collectGarbage', {}, s, 20000).catch(() => {})));
  }

  close() {
    this.ws.close();
  }
}

/** 进程私有内存(字节):Windows 用一直开着的 PowerShell 取;别的系统用 ps 取常驻内存 */
class ProcMem {
  private ps: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private waiters: ((s: string) => void)[] = [];

  constructor() {
    if (process.platform !== 'win32') return;
    this.ps = spawn('powershell', ['-NoProfile', '-NoLogo', '-Command', '-'], { stdio: 'pipe' });
    this.ps.stdout.setEncoding('utf8');
    this.ps.stdout.on('data', (d: string) => {
      this.buf += d;
      let i: number;
      while ((i = this.buf.indexOf('@@END')) >= 0) {
        this.waiters.shift()?.(this.buf.slice(0, i));
        this.buf = this.buf.slice(i + 5);
      }
    });
  }

  async read(pids: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    if (!pids.length) return out;
    let text: string;
    if (this.ps) {
      const p = new Promise<string>((r) => this.waiters.push(r));
      this.ps.stdin.write(`Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.PrivateMemorySize64)" }; "@@END"\n`);
      text = await p;
    } else {
      const { execFileSync } = await import('node:child_process');
      text = execFileSync('ps', ['-o', 'pid=,rss=', '-p', pids.join(',')], { encoding: 'utf8' })
        .split('\n')
        .map((l) => l.trim().replace(/^(\d+)\s+(\d+)$/, (_, a, b) => `${a} ${Number(b) * 1024}`))
        .join('\n');
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.trim().match(/^(\d+) (\d+)$/);
      if (m) out.set(Number(m[1]), Number(m[2]));
    }
    return out;
  }

  close() {
    this.ps?.stdin.end();
    this.ps?.kill();
  }
}

// ---------------------------------------------------------------------------
// 取样

/** 一次取样的几项(字节) */
interface Keys {
  mainJs: number;
  workers: number;
  canvas: number;
  renderer?: number;
  gpu?: number;
  /** 各路分开的 JS(页面叫 main,线程按脚本名 + 序号;不算进峰值那几项) */
  by?: Record<string, number>;
}

/** 操作期间的一次取样(t = 取样的时刻,Date.now()) */
interface Trace {
  t: number;
  k: Keys;
}

interface Rig {
  browser: Browser;
  ctx: BrowserContext;
  page: Page;
  cdp: Cdp;
  sample: (proc?: boolean) => Promise<Keys>;
  close: () => Promise<void>;
}

async function openRig(url: string): Promise<Rig> {
  const port = await freePort();
  const browser = await chromium.launch({ args: [`--remote-debugging-port=${port}`] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(CENSUS);
  const page = await ctx.newPage();
  await page.goto('about:blank');
  const cdp = await Cdp.connect(port);
  await cdp.attachPage();
  const proc = new ProcMem();
  const sample = async (withProc = false): Promise<Keys> => {
    const ids = [...cdp.sessions.keys()];
    const heaps = await Promise.all(ids.map((s) => cdp.heap(s)));
    const cens = await Promise.all(ids.map((s) => cdp.census(s)));
    const k: Keys = { mainJs: 0, workers: 0, canvas: 0, by: {} };
    ids.forEach((s, i) => {
      const h = heaps[i];
      const sz = h ? h.used + h.backing : 0;
      if (s === cdp.page) k.mainJs = sz;
      else k.workers += sz;
      k.canvas += cens[i];
      const name = cdp.sessions.get(s);
      if (name) k.by![name] = sz;
    });
    if (withProc) {
      const info = await cdp.send('SystemInfo.getProcessInfo');
      const of = (type: string) => info.processInfo.filter((p: any) => p.type === type).map((p: any) => p.id as number);
      const r = of('renderer');
      const g = of('GPU');
      const m = await proc.read([...r, ...g]);
      k.renderer = r.reduce((a: number, p: number) => a + (m.get(p) ?? 0), 0);
      k.gpu = g.reduce((a: number, p: number) => a + (m.get(p) ?? 0), 0);
    }
    return k;
  };
  await page.goto(url);
  return {
    browser,
    ctx,
    page,
    cdp,
    sample,
    close: async () => {
      cdp.close();
      proc.close();
      await browser.close();
    },
  };
}

/** 收垃圾以后的值(回落到多少) */
async function settled(rig: Rig): Promise<Keys> {
  await rig.cdp.gc();
  await sleep(1500);
  await rig.cdp.gc();
  await sleep(500);
  return rig.sample(true);
}

const fmt = (k: Partial<Keys>) => `JS 主 ${mb(k.mainJs)} 线程 ${mb(k.workers)} 画布 ${mb(k.canvas)} | 渲染进程 ${mb(k.renderer)} 显卡进程 ${mb(k.gpu)}`;

// ---------------------------------------------------------------------------
// 操作(手机)

const ready = (rig: Rig) => rig.page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 180000 });
const civReady = (rig: Rig) => rig.page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 180000 });

async function touchDrag(rig: Rig, pts: [number, number][]) {
  const s = rig.cdp.page;
  const tp = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await rig.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(...pts[0]) }, s);
  for (const p of pts.slice(1)) {
    await rig.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(...p) }, s);
    await sleep(16);
  }
  await rig.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, s);
}
const line = (x0: number, y0: number, x1: number, y1: number, n = 20): [number, number][] => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);

/** 拉开新建界面的底部卡片(收着的时候) */
async function openSheet(p: Page) {
  if (await p.locator('.st-sheet.peek').count()) {
    await p.tap('.st-sheet [data-act=new-sheet]');
    await sleep(400);
  }
}

/** 新建界面里创建世界,等文明出来 */
async function createNow(rig: Rig) {
  const p = rig.page;
  await openSheet(p);
  const next = p.locator('.studio [data-act=to-civ]');
  if (await next.count()) {
    await next.tap();
    await sleep(500);
  }
  await p.tap('.studio [data-act=create-world]');
  await p.tap('.st-dlg [data-act=confirm-create]');
  await p.locator('.studio').waitFor({ state: 'detached', timeout: 60000 });
  await civReady(rig);
}

// ---------------------------------------------------------------------------
// 场景

interface Row {
  name: string;
  peak: Partial<Keys>;
  rest: Partial<Keys>;
  marks: [string, Keys][];
  note?: string;
  /** 各路(页面、每个线程)各自的 JS 峰值 */
  peakBy?: Record<string, number>;
  /** 场景自己记的明细(比如连涂每一笔的峰值) */
  detail?: unknown;
}
const rows: Row[] = [];
const port = await freePort();
const server = await preview({ build: { outDir: DIST }, preview: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const base = `http://127.0.0.1:${port}`;

/** 场景里能用的:mark 收一次垃圾记一下回落;trace = 操作期间的每次取样(按时间先后,场景拿来算一段时间里的峰值);detail 记进 --out */
interface Ctx {
  mark: (label: string) => Promise<void>;
  trace: Trace[];
  detail: (v: unknown) => void;
}

async function scenario(name: string, query: string, body: (rig: Rig, mark: Ctx['mark'], ctx: Ctx) => Promise<string | void>) {
  if (ONLY && !ONLY.includes(name)) return;
  const t0 = Date.now();
  let rig: Rig | null = null;
  // 取样停下的开关(场景中途出错也要停:finally 里关)
  let stop = false;
  let loop: Promise<void> | null = null;
  try {
    rig = await openRig(`${base}/?${query}`);
    const r = rig;
    // 操作期间每 EVERY 毫秒(默认 300)取一次(每三次带上进程内存),记各项峰值
    const peak: Partial<Keys> = {};
    const peakBy: Record<string, number> = {};
    const trace: Trace[] = [];
    loop = (async () => {
      for (let n = 0; !stop; n++) {
        const t = Date.now();
        try {
          const k = await r.sample(n % 3 === 0);
          trace.push({ t, k });
          for (const [key, v] of Object.entries(k)) if (typeof v === 'number') peak[key as 'mainJs'] = Math.max(peak[key as 'mainJs'] ?? 0, v);
          for (const [key, v] of Object.entries(k.by ?? {})) peakBy[key] = Math.max(peakBy[key] ?? 0, v);
        } catch {
          /* 页面在换 */
        }
        await sleep(Math.max(0, EVERY - (Date.now() - t)));
      }
    })();
    const marks: [string, Keys][] = [];
    const mark = async (label: string) => {
      const k = await settled(r);
      marks.push([label, k]);
      const by = Object.entries(k.by ?? {})
        .filter(([n]) => n !== 'main')
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([n, v]) => `${n} ${mb(v)}`)
        .join(' ');
      console.log(`    ${name} ${label}: ${fmt(k)}${by ? `(${by})` : ''}`);
    };
    let detail: unknown;
    const note = await body(rig, mark, { mark, trace, detail: (v) => (detail = v) });
    stop = true;
    await loop;
    const rest = await settled(rig);
    rows.push({ name, peak, rest, marks, note: note || undefined, peakBy, detail });
    const by = Object.entries(peakBy)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${k} ${mb(v)}`)
      .join(' ');
    console.log(`${name}(${((Date.now() - t0) / 1000).toFixed(0)} s)${note ? ' ' + note : ''}\n  峰值 ${fmt(peak)}\n  回落 ${fmt(rest)}\n  各路 JS 峰值 ${by}`);
  } catch (e) {
    const msg = (e as Error).message.split('\n')[0];
    console.log(`${name} 出错:${msg}`);
    rows.push({ name, peak: {}, rest: {}, marks: [], note: `出错:${msg}` });
  } finally {
    stop = true;
    await loop;
    await rig?.close().catch(() => {});
  }
}

await scenario('new36k', 'new=1&seed=7&play=0', async (rig) => {
  await ready(rig);
  await sleep(12000);
});

/** 编辑地形连涂 20 笔;height = 换到「高度」页用抬高笔涂(多半按块重铺、按块换上),不然用默认的陆地笔(星球照草图重新长,多半整张重铺) */
const editStrokes = (name: string, height: boolean) => async (rig: Rig, mark: Ctx['mark'], ctx: Ctx) => {
  const p = rig.page;
  await ready(rig);
  await sleep(8000);
  await mark('编辑前');
  // 进编辑地形(星球摊成平面),在卡片上面露出来的地图上一笔笔横着拖
  await p.locator('.studio').waitFor({ timeout: 30000 });
  await openSheet(p);
  await p.tap('.studio [data-act=terrain]');
  await p.locator('.tp').waitFor({ timeout: 10000 });
  await p.locator('.app.studio-flat').waitFor({ timeout: 15000 });
  await sleep(800);
  if (height) {
    await p.evaluate(() => (document.querySelector('[data-act=terrain-page] [data-v=height]') as HTMLElement).click());
    await p.locator('.tp-tile.on[data-tool=lift]').waitFor({ timeout: 5000 });
    await sleep(400);
  }
  const box = (await p.locator('main.stage').boundingBox())!;
  const top = await p.evaluate(() => document.querySelector('.st-sheet')?.getBoundingClientRect().top ?? innerHeight);
  const y0 = box.y + 80;
  const y1 = Math.min(box.y + box.height, top) - 40;
  let done = 0;
  let patched = 0;
  const shown: number[] = [];
  // 每一笔里的峰值:页面主线程、所有线程加起来、各路分开;再按这一笔的几段分开(松手时刻起算,时刻取自 __wfTerrain):
  // 生成 = 松手到线程交回来,换上 = 交回来到地图换上,之后 = 换上以后 1.5 秒
  type Peak = { main: number; workers: number; by: Record<string, number> };
  const peakIn = (a: number, b: number): Peak => {
    const s: Peak = { main: 0, workers: 0, by: {} };
    for (const { t: at, k } of ctx.trace) {
      if (at < a || at > b) continue;
      s.main = Math.max(s.main, k.mainJs);
      s.workers = Math.max(s.workers, k.workers);
      for (const [n, v] of Object.entries(k.by ?? {})) s.by[n] = Math.max(s.by[n] ?? 0, v);
    }
    return s;
  };
  const strokes: (Peak & { ms?: number; gen?: Peak; swap?: Peak; after?: Peak })[] = [];
  for (let i = 0; i < 20; i++) {
    const prev = await p.evaluate(() => (window as any).__wfTerrain?.id ?? 0);
    const y = y0 + ((y1 - y0) * ((i * 7) % 20)) / 20;
    const x = 60 + ((i * 53) % 260);
    const ts = Date.now();
    await touchDrag(rig, line(x, y, x + 50, y + 12));
    const up = Date.now();
    const ok = await p
      .waitForFunction((n) => ((window as any).__wfTerrain?.id ?? 0) > n, prev, { timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    if (ok) done++;
    await sleep(1500);
    const t = await p.evaluate(() => (window as any).__wfTerrain);
    if (ok && i > 0 && t?.shownMs !== undefined) shown.push(t.shownMs);
    if (ok && t?.patch) patched++;
    const te = Date.now();
    const s = { ...peakIn(ts, te), ms: ok ? t?.shownMs : undefined };
    if (ok && t?.gotMs !== undefined && t?.shownMs !== undefined) {
      Object.assign(s, { gen: peakIn(ts, up + t.gotMs), swap: peakIn(up + t.gotMs, up + t.shownMs), after: peakIn(up + t.shownMs, te) });
    }
    strokes.push(s);
    if ((i + 1) % 5 === 0) await mark(`第 ${i + 1} 笔`);
  }
  ctx.detail({ strokes });
  const midOf = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  const rest = strokes.slice(1);
  console.log(`    ${name} 每一笔的峰值(JS 主 / 线程,MB):${strokes.map((s) => `${mb(s.main)}/${mb(s.workers)}`).join(' ')}`);
  console.log(`    ${name} 第 2–20 笔峰值中位:JS 主 ${mb(midOf(rest.map((s) => s.main)))} 线程 ${mb(midOf(rest.map((s) => s.workers)))}`);
  for (const [k, label] of [['gen', '生成'], ['swap', '换上'], ['after', '之后']] as const) {
    const ps = rest.map((s) => s[k]).filter((x): x is Peak => !!x);
    if (!ps.length) continue;
    const names = [...new Set(ps.flatMap((x) => Object.keys(x.by)))].sort();
    console.log(`    ${name} ${label}那段峰值中位:JS 主 ${mb(midOf(ps.map((x) => x.main)))} 线程 ${mb(midOf(ps.map((x) => x.workers)))}(${names.map((n) => `${n} ${mb(midOf(ps.map((x) => x.by[n] ?? 0)))}`).join(' ')})`);
  }
  const med = midOf(shown);
  return `换上 ${done} / 20 笔(按块换上 ${patched} 笔);涂完到地图换上 中位 ${med?.toFixed(0)} ms`;
};
await scenario('edit20', 'new=1&seed=7&play=0', editStrokes('edit20', false));
await scenario('edit20h', 'new=1&seed=7&play=0', editStrokes('edit20h', true));

await scenario('new200k', 'new=1&seed=7&play=0&cells=200000', async (rig) => {
  await ready(rig);
  await sleep(15000);
});

await scenario('open', 'seed=7&play=0', async (rig) => {
  await civReady(rig);
  await sleep(8000);
});

await scenario('play', 'seed=7&play=0', async (rig, mark) => {
  await civReady(rig);
  await sleep(5000);
  await mark('播放前');
  await rig.page.tap('.timebar button.tb-play');
  for (let i = 1; i <= 3; i++) {
    await sleep(15000);
    await mark(`播放 ${i * 15} s`);
  }
  if (await rig.page.locator('.timebar .tb-play.on').count()) await rig.page.tap('.timebar button.tb-play');
  await sleep(1500);
});

await scenario('director', 'seed=7&play=0', async (rig, mark) => {
  await civReady(rig);
  await sleep(5000);
  await mark('导播前');
  await rig.page.tap('[data-act=director]');
  for (let i = 1; i <= 3; i++) {
    await sleep(15000);
    await mark(`导播 ${i * 15} s`);
  }
  await rig.page.tap('[data-act=director]').catch(() => {});
  await sleep(1500);
});

await scenario('globe', 'seed=7&play=0', async (rig, mark) => {
  await civReady(rig);
  await sleep(5000);
  await mark('地球仪前');
  for (let c = 1; c <= 3; c++) {
    await rig.page.tap('[data-act=globe]');
    await sleep(4000);
    for (let i = 0; i < 5; i++) {
      await touchDrag(rig, line(100, 350, 300, 380, 25));
      await sleep(600);
    }
    await sleep(2000);
    await rig.page.tap('[data-act=globe]');
    await sleep(3000);
    await mark(`第 ${c} 次回到平面`);
  }
});

await scenario('globezoom', 'seed=7&play=0', async (rig, mark) => {
  const p = rig.page;
  await civReady(rig);
  await sleep(5000);
  await mark('地球仪前');
  await p.tap('[data-act=globe]');
  await p.waitForFunction(() => (window as any).__wfGlobe?.ready, null, { timeout: 60000 });
  await sleep(3000);
  await mark('打开地球仪');
  // 放大到 2.4 倍、再到 5 倍,各停一会儿(主图那张不够清楚:以前自己去铺高清贴图)
  for (const k of [2.4, 5]) {
    await p.evaluate((k) => (window as any).__wfGlobeSet(20, 20, k), k);
    await sleep(12000);
    await mark(`放大 ${k} 倍`);
  }
  const g = await p.evaluate(() => (window as any).__wfGlobe);
  const ask = await p.locator('.toast [data-act=globe-hd]').count();
  return `贴图第 ${g?.tier} 档,起过 ${g?.hdStarted} 次高清;顶上${ask ? '问了「换高清」' : '没有问'}`;
});

await scenario('export', 'seed=7&play=0', async (rig, mark) => {
  const p = rig.page;
  await civReady(rig);
  await sleep(5000);
  await mark('导出前');
  for (const scale of [1, 2]) {
    await p.tap('[data-act=world-sheet]');
    await sleep(600);
    await p.tap('.ps-tiles .export-btn');
    await p.tap(`.export-scale button:nth-child(${scale})`);
    const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), p.tap('.export-item[data-job=map]')]);
    await dl.path();
    await sleep(2000);
    await mark(`导出 ${scale} 倍以后`);
    await p.keyboard.press('Escape').catch(() => {});
    if (await p.locator('.ps-tiles').count()) await p.tap('[data-act=world-sheet]').catch(() => {});
    await sleep(500);
  }
});

await scenario('switch5', 'seed=7&play=0', async (rig, mark) => {
  const p = rig.page;
  await civReady(rig);
  await sleep(5000);
  await mark('第 0 个世界');
  for (let i = 1; i <= 5; i++) {
    await p.tap('[data-act=home]');
    await p.locator('.mw [data-act=new-world]').first().waitFor({ timeout: 15000 });
    await p.locator('.mw [data-act=new-world]').first().tap();
    await p.locator('.nd-scrim').waitFor({ timeout: 5000 });
    await p.tap('.nd-scrim [data-act=dlg-next]');
    await p.tap('.nd-scrim [data-act=dlg-start]');
    await p.locator('.studio').waitFor({ timeout: 30000 });
    await ready(rig);
    await sleep(3000);
    await createNow(rig);
    await sleep(5000);
    await mark(`第 ${i} 个世界`);
  }
});

await scenario('stepui', 'seed=7&play=0', async (rig, mark) => {
  const p = rig.page;
  await civReady(rig);
  await sleep(5000);
  await mark('演绎前');
  // 世界卡片里「从这里演绎」→「开始演绎」,停下来就点「接着演绎」
  if (!(await p.locator('[data-act=step-from]').isVisible().catch(() => false))) {
    await p.tap('[data-act=world-sheet]');
    await sleep(800);
  }
  await p.locator('[data-act=step-from]').first().tap();
  await p.locator('[data-act=step-start]').first().tap();
  const t0 = Date.now();
  for (let i = 1; i <= 3; i++) {
    while (Date.now() - t0 < i * 20000) {
      const go = p.locator('[data-act=step-go]:visible').first();
      if (await go.count()) await go.tap().catch(() => {});
      await sleep(1000);
    }
    await mark(`演绎 ${i * 20} s`);
  }
  const s = await p.evaluate(() => (window as any).__wfStep?.());
  await p.locator('[data-act=step-hold]:visible').first().tap().catch(() => {});
  await sleep(1500);
  return `演绎到第 ${s?.now ?? '?'} 年(从第 ${s?.start ?? '?'} 年起)`;
});

await scenario('stepwise50', '', async (rig, mark) => {
  const p = rig.page;
  await sleep(3000);
  const file = fs.readdirSync(path.join(DIST, 'assets')).find((f) => /^worker-.*\.js$/.test(f));
  await p.evaluate(
    async ({ file, params }) => {
      const W = window as any;
      const w = new Worker(`/assets/${file}`, { type: 'module' });
      W.__sw = w;
      W.__swParams = params;
      await new Promise<void>((res) => {
        w.onmessage = (e) => {
          if (e.data.type !== 'done') return;
          W.__swCiv = e.data.civ;
          W.__swPlay = { year: 1, commands: [] };
          res();
        };
        w.postMessage({ type: 'generate', id: 1, scale: 1, params, play: { year: 1, commands: [] } });
      });
    },
    { file: file!, params: { ...DEFAULT_PARAMS, seed: 7 } },
  );
  await mark('第 0 步');
  let ms = 0;
  for (let i = 1; i <= 50; i++) {
    ms += await p.evaluate(
      (id) =>
        new Promise<number>((res) => {
          const W = window as any;
          W.__sw.onmessage = (e: MessageEvent) => {
            if (e.data.type !== 'turn') return;
            // 主线程留着最新的一份(像界面那样)
            W.__swCiv = e.data.civ;
            W.__swPlay = e.data.play;
            res(e.data.ms);
          };
          W.__sw.postMessage({ type: 'turn', id, params: W.__swParams, play: W.__swPlay, commands: [], years: 20 });
        }),
      i + 1,
    );
    if (i % 10 === 0) {
      await sleep(1500);
      await mark(`第 ${i} 步`);
    }
  }
  return `50 步线程里共 ${(ms / 1000).toFixed(1)} s`;
});

await server.close();
if (OUT) fs.writeFileSync(OUT, JSON.stringify(rows, null, 1));

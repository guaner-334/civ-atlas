/**
 * 打开一个存着的世界那一下,主线程一口气最长占住多久(Long Task)、时间花在哪。像用户一样操作(全走界面,量构建好的网站):
 * 先照网址新建几个世界存进浏览器(种子 / 地块数 / 推演年数),再分别量三种打开:
 *   - refresh 刷新页面:开着这个世界时刷新(网页重新下载、主程序重新起来,再生成这个世界)
 *   - open    打开存档:新开一页我的世界(等主程序在后台下好),点开这个世界
 *   - switch  换世界:开着另一个世界(列表里的上一个)时回到我的世界,点开这个世界
 * 每种从下命令起,到地图画好、文明层出来以后再过 3 秒,打印这段时间里最长的一个 Long Task、超出 50 ms 的部分加起来、从下命令到地图画好用了多久
 * (刷新页面的从页面开始算);换上之前在后台分小步备了地图的,另打印备了多久、最长的一步。
 * --profile 另记 CPU 剖面:最长的几个 Long Task 各自时间花在哪几个函数上(含调用的;按页面时钟对上采样,差几毫秒);
 * 刷新页面的(页面时钟从头算了)改按主线程连续忙(没有空闲的采样连成一段 ≥ 50 ms)的算。
 *
 *   pnpm build && npx tsx scripts/open-check.ts               默认:种子 7 / 2024 默认地块 3000 年、种子 7 默认地块 60000 年、种子 7 二十万地块 3000 年;电脑
 *   --dist=dist-base,dist                                    量这几份构建(逗号分开;每种情况轮流量,前后对比时数字少受机器忙闲影响)
 *   --worlds=7/36000/3000,7/200000/60000                     种子 / 地块数 / 推演年数
 *   --cases=refresh,open,switch   --runs=2(每份构建每种量几轮)   --phone(390×844 触屏,CPU 减速 4 倍)   --profile
 *   --map=geo|satellite|biomes…                               打开时的底图(网址 map=;不写 = 手绘)   --query=proj=robinson(网址另加的参数)
 *   --debug                                                  打印建世界、打开时走到哪一步
 *   --shots=snaps/open                                       每个世界第一次打开后,地图画布(铺好的地形图)和整页各存一张 PNG;量了几份构建的,
 *                                                            最后把每份和第一份逐像素比(地图画布读一次像素以后浏览器可能改用软件画,别和量速度一起跑)
 * 数字只在同一台机器上前后对比有意义。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { preview, type PreviewServer } from 'vite';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const DISTS = (opt('dist') ?? 'dist').split(',');
const WORLDS = (opt('worlds') ?? '7/36000/3000,2024/36000/3000,7/36000/60000,7/200000/3000').split(',').map((s) => {
  const [seed, cells, years] = s.split('/').map(Number);
  return { seed, cells, years, label: `种子 ${seed} ${cells >= 10000 ? `${+(cells / 10000).toFixed(1)} 万` : cells} 地块 ${years} 年` };
});
const CASES = (opt('cases') ?? 'refresh,open,switch').split(',');
const RUNS = Number(opt('runs')) || 1;
const phone = args.includes('--phone');
const profile = args.includes('--profile');
const MAP = opt('map');
/** 网址另加的参数(比如 proj=robinson) */
const QUERY = opt('query');
const SHOTS = opt('shots');
// 要逐像素比的:中央经线定成 0(建世界时记下的是那一刻星球转到哪儿,两份构建建的不一样,画面跟着偏)
const EXTRA = `${MAP ? `&map=${MAP}` : ''}${QUERY ? `&${QUERY}` : ''}${SHOTS && !/(^|&)lon=/.test(QUERY ?? '') ? '&lon=0' : ''}`;
const TAG = `${MAP ? `-${MAP}` : ''}${QUERY ? `-${QUERY.replace(/[^a-z0-9]+/gi, '_')}` : ''}`;
const SETTLE = 3000;
const WAIT = 600_000;
const DEBUG = args.includes('--debug');
const dbg = (...a: unknown[]) => DEBUG && console.log('  ·', ...a);

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

/** 页面一打开就记下所有 Long Task(主线程一口气占住 ≥ 50 ms 的) */
const LONG_TASKS = `window.__lt = [];
if (PerformanceObserver.supportedEntryTypes.includes('longtask'))
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });`;

interface Stat {
  max: number;
  over: number;
  n: number;
}
const stat = (lt: [number, number][]): Stat => ({
  max: Math.round(Math.max(0, ...lt.map((x) => x[1]))),
  over: Math.round(lt.reduce((s, x) => s + Math.max(0, x[1] - 50), 0)),
  n: lt.length,
});

const browser = await chromium.launch();
const servers: { dist: string; url: string; srv: PreviewServer }[] = [];
for (const d of DISTS) {
  const port = await freePort();
  const srv = await preview({ build: { outDir: path.resolve(d) }, preview: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
  servers.push({ dist: d, url: `http://127.0.0.1:${port}`, srv });
}

async function newContext(): Promise<BrowserContext> {
  const ctx = await browser.newContext(
    phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1600, height: 900 } },
  );
  await ctx.addInitScript(LONG_TASKS);
  return ctx;
}
async function newPage(ctx: BrowserContext): Promise<{ page: Page; cdp: CDPSession }> {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  const cdp = await ctx.newCDPSession(page);
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return { page, cdp };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ready = (page: Page) => page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: WAIT });
const civReady = (page: Page) => page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: WAIT });
const press = async (page: Page, sel: string) => {
  const l = page.locator(sel).first();
  await l.waitFor({ timeout: 60_000 }).catch(async (e) => {
    await page.screenshot({ path: 'snaps/open-check-fail.png' });
    throw e;
  });
  if (phone) await l.tap();
  else await l.click();
};

/** 新建界面里创建世界,等文明出来;返回世界的编号 */
async function createWorld(page: Page, w: (typeof WORLDS)[number]): Promise<string> {
  await page.goto(`${page.url().replace(/\/[^/]*$/, '')}/?new=1&seed=${w.seed}&cells=${w.cells}&years=${w.years}&play=0${EXTRA}`);
  await ready(page);
  dbg('新建界面出来了');
  if (await page.locator('.st-sheet.peek').count()) await press(page, '.st-sheet [data-act=new-sheet]');
  const next = page.locator('.studio [data-act=to-civ]');
  if (await next.count()) {
    await press(page, '.studio [data-act=to-civ]');
    await sleep(500);
  }
  await press(page, '.studio [data-act=create-world]');
  await press(page, '.st-dlg [data-act=confirm-create]');
  dbg('点了创建');
  await page.locator('.studio').waitFor({ state: 'detached', timeout: WAIT });
  await civReady(page);
  dbg('文明出来了', page.url());
  await page.waitForFunction(() => new URLSearchParams(location.search).has('w'), null, { timeout: WAIT });
  return new URL(page.url()).searchParams.get('w')!;
}

/** 我的世界里换到「文明」页签,点开 id 这个世界 */
async function pickWorld(page: Page, id: string) {
  await press(page, '.mw [data-tab=civs]');
  await press(page, `.mw-card[data-id="${id}"] [data-act=open-world]`);
}
/** 回到我的世界,点开 id 这个世界 */
async function openFromHome(page: Page, id: string) {
  await press(page, phone ? '.ps-link[data-act=home], .ps-tile[data-act=home]' : '[data-act=home]');
  await pickWorld(page, id);
}

/**
 * 剖面:最长的几个 Long Task(lt = 页面里记的 [开始, 时长],at = 开始记剖面那一刻页面的 performance.now(),差几毫秒)各自花在哪
 * (含调用的函数,按名字合并);刷新页面的(页面的时钟从头算了,lt = null)改按没有空闲的采样连成一段(主线程连续忙)≥ 50 ms 的算
 */
function busyRuns(p: any, lt: [number, number][] | null, at: number, top = 4): string[] {
  const byId = new Map<number, any>(p.nodes.map((x: any) => [x.id, x]));
  const parent = new Map<number, number>();
  for (const x of p.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const dt: number[] = p.timeDeltas;
  const runs: { ms: number; from: number; to: number; what: string }[] = [];
  if (lt) {
    // 采样的时刻换成页面的时钟
    const tAt: number[] = [];
    let t = at;
    for (let i = 0; i < p.samples.length; i++) tAt.push((t += (dt[i] ?? 0) / 1000));
    for (const [s0, d] of [...lt].sort((a, b) => b[1] - a[1]).slice(0, top)) {
      const from = tAt.findIndex((x) => x >= s0);
      let to = tAt.findIndex((x) => x > s0 + d);
      if (to < 0) to = tAt.length;
      if (from >= 0) runs.push({ ms: d, from, to, what: 'Long Task' });
    }
  } else {
    let s = -1;
    let ms = 0;
    for (let i = 0; i <= p.samples.length; i++) {
      const name = i < p.samples.length ? byId.get(p.samples[i]).callFrame.functionName : '(idle)';
      if (name === '(idle)') {
        if (s >= 0 && ms >= 50) runs.push({ ms, from: s, to: i, what: '连续忙' });
        s = -1;
        ms = 0;
      } else {
        if (s < 0) s = i;
        ms += (dt[i + 1] ?? 0) / 1000;
      }
    }
    runs.sort((a, b) => b.ms - a.ms);
  }
  const out: string[] = [];
  for (const r of runs.slice(0, top)) {
    const incl = new Map<string, number>();
    for (let i = r.from; i < r.to; i++) {
      const seen = new Set<string>();
      const d = (dt[i + 1] ?? 0) / 1000;
      for (let id: number | undefined = p.samples[i]; id !== undefined; id = parent.get(id)) {
        const cf = byId.get(id).callFrame;
        if (!cf.functionName || cf.functionName === '(root)') continue;
        const key = `${cf.functionName} ${cf.url.replace(/^.*\/assets\//, '').replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        incl.set(key, (incl.get(key) ?? 0) + d);
      }
    }
    const list = [...incl]
      .filter(([, v]) => v >= Math.max(5, r.ms * 0.04))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([k, v]) => `${v.toFixed(0).padStart(5)} ${k}`);
    out.push(`${r.what} ${r.ms.toFixed(0)} ms:\n        ${list.join('\n        ')}`);
  }
  return out;
}

const rows: string[] = [];
const shotsDone = new Set<string>();

async function measure(page: Page, cdp: CDPSession, label: string, act: () => Promise<unknown>) {
  if (profile) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
    await cdp.send('Profiler.start');
  }
  const pAt = await page.evaluate(() => performance.now());
  const t0 = await page.evaluate(() => ((window as any).__wf = (window as any).__wfOpenPrep = null, performance.now()));
  const reload = await act();
  await ready(page);
  const shown = await page.evaluate(() => performance.now());
  await civReady(page);
  await page.waitForTimeout(SETTLE);
  const lt = await page.evaluate((t) => ((window as any).__lt as [number, number][]).filter((x) => x[0] + x[1] > t), reload ? 0 : t0);
  const s = stat(lt);
  const took = reload ? shown : shown - t0;
  // 换上之前在后台分小步备地图(改了以后才有):各步加起来、从开始到换上、最长的一步
  const prep = await page.evaluate(() => (window as any).__wfOpenPrep as { prep: number; wall: number; maxStep: number } | undefined);
  const pt = prep ? `;备地图 ${Math.round(prep.prep)} / ${Math.round(prep.wall)} ms,最长一步 ${Math.round(prep.maxStep)} ms` : '';
  rows.push(`${label}  最长 ${String(s.max).padStart(5)} ms,超出 50 ms 共 ${String(s.over).padStart(5)} ms(${s.n} 个),${Math.round(took)} ms 后画好${pt}`);
  console.log(rows.at(-1));
  if (profile) {
    const { profile: p } = (await cdp.send('Profiler.stop')) as any;
    for (const l of busyRuns(p, reload ? null : lt, pAt)) console.log('     ', l);
  }
}

/** 地图画布(铺好的地形图)和整页各存一张 PNG(逐像素对比用) */
async function shot(page: Page, dist: string, name: string) {
  if (!SHOTS || shotsDone.has(`${dist}|${name}`)) return;
  shotsDone.add(`${dist}|${name}`);
  const url = await page.evaluate(() => (document.querySelector('.map-box > canvas:not(.wrap-copy)') as HTMLCanvasElement).toDataURL('image/png'));
  writeFileSync(`${SHOTS}-${dist}-${name}-map.png`, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  await page.screenshot({ path: `${SHOTS}-${dist}-${name}-page.png` });
}

/** 两张 PNG 有几个像素不一样(大小不一样 = -1) */
function pngDiff(a: string, b: string): number {
  const x = PNG.sync.read(readFileSync(a));
  const y = PNG.sync.read(readFileSync(b));
  if (x.width !== y.width || x.height !== y.height) return -1;
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4)
    if (x.data[i] !== y.data[i] || x.data[i + 1] !== y.data[i + 1] || x.data[i + 2] !== y.data[i + 2] || x.data[i + 3] !== y.data[i + 3]) n++;
  return n;
}

for (const s of servers) {
  // 每份构建一个浏览器上下文:先把要量的世界都建好存进去
  const ctx = await newContext();
  const { page, cdp } = await newPage(ctx);
  await page.goto(`${s.url}/`);
  const ids: string[] = [];
  for (const w of WORLDS) {
    const t = Date.now();
    ids.push(await createWorld(page, w));
    console.log(`[${s.dist}] 建好 ${w.label}(${((Date.now() - t) / 1000).toFixed(0)} s)`);
    await page.waitForTimeout(2000);
  }
  (s as any).ctx = { ctx, page, cdp, ids };
}

for (let run = 0; run < RUNS; run++) {
  for (let wi = 0; wi < WORLDS.length; wi++) {
    const w = WORLDS[wi];
    for (const c of CASES) {
      for (const s of servers) {
        const { page, cdp, ids } = (s as any).ctx as { page: Page; cdp: CDPSession; ids: string[] };
        const id = ids[wi];
        const label = `[${s.dist}] ${w.label}  ${c === 'refresh' ? '刷新页面' : c === 'open' ? '打开存档' : '换世界  '}`;
        if (c === 'refresh') {
          // 先开着这个世界(网址另加了参数的照网址开:建世界时网址里的底图、中央经线不一定留着)
          if (EXTRA || new URL(page.url()).searchParams.get('w') !== id) {
            await page.goto(`${s.url}/?w=${id}${EXTRA}`);
            await civReady(page);
            await page.waitForTimeout(1000);
          }
          await measure(page, cdp, label, async () => {
            await page.reload();
            return true;
          });
        } else if (c === 'open') {
          // 新开一页我的世界(主程序在后台下好),再点开这个世界
          await page.goto(`${s.url}/`);
          dbg('我的世界');
          await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => dbg('网络一直没停'));
          await page.waitForTimeout(phone ? 6000 : 3000);
          await press(page, '.mw [data-tab=civs]');
          dbg('点开');
          await measure(page, cdp, label, () => press(page, `.mw-card[data-id="${id}"] [data-act=open-world]`));
        } else {
          // 开着另一个世界 → 回我的世界点开这个
          const other = ids[(wi + ids.length - 1) % ids.length];
          // 回去点开的就是开着的这个:不会重新打开(要量换世界,--worlds 至少给两个)
          if (other === id) {
            console.log(`${label}  (只建了一个世界,量不了换世界)`);
            continue;
          }
          await page.goto(`${s.url}/?w=${other}${EXTRA}`);
          await civReady(page);
          await page.waitForTimeout(1500);
          await measure(page, cdp, label, () => openFromHome(page, id));
        }
        await shot(page, path.basename(s.dist), `${w.seed}-${w.cells}-${w.years}${TAG}`);
      }
    }
  }
}

console.log(`\n${phone ? '手机(390×844,CPU 减速 4 倍)' : '电脑(1600×900)'}${EXTRA ? ` ${EXTRA.slice(1)}` : ''}:`);
for (const r of rows) console.log(r);
if (SHOTS && servers.length > 1) {
  console.log('\n逐像素对比(和第一份构建比;不一样的像素个数,-1 = 大小不同):');
  const d0 = path.basename(servers[0].dist);
  for (const w of WORLDS)
    for (const s of servers.slice(1)) {
      const name = `${w.seed}-${w.cells}-${w.years}${TAG}`;
      const d = path.basename(s.dist);
      const part = (k: string) => pngDiff(`${SHOTS}-${d0}-${name}-${k}.png`, `${SHOTS}-${d}-${name}-${k}.png`);
      console.log(`  ${w.label}  ${d}:地图画布 ${part('map')},整页 ${part('page')}`);
    }
}
await browser.close();
for (const s of servers) await s.srv.close();

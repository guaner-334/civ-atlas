/**
 * 换投影、开关地球仪测速:量切过去那一下主线程一口气占住多久、画面多久换好,只打印摘要。
 *
 *   pnpm build && npx tsx scripts/perf-proj.ts                 默认:关显卡加速(画布、合成都走 CPU)+ CPU 降速 2 倍,1920×1080,像素密度 1.5
 *   --gpu                                                       不关显卡加速(无头浏览器里 WebGL 是软件的,画布照样可能走显卡)
 *   --cpu=4  --dpr=1  --runs=3  --dist=别的目录  --query=网址另加的参数
 *
 * 每种底图(手绘政区、卫星)依次:平面 → 罗宾森 → 平面 → 地球仪 → 平面,每一步各量 runs 轮。
 * 摘要每格:最长任务 / 最长帧距(ms);最长任务 = Long Task(≥ 50 ms 才记)里最长的一次,最长帧距 = 两次 requestAnimationFrame 之间最久。
 * 数字只在同一台机器上前后对比有意义。
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium } from 'playwright';
import { preview } from 'vite';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const GPU = args.includes('--gpu');
const CPU = Number(opt('cpu') ?? 2);
const DPR = Number(opt('dpr') ?? 1.5);
const RUNS = Number(opt('runs') ?? 3);
const EXTRA = opt('query') ?? '';

const RECORDER = `(() => {
  const P = (window.__pp = {});
  P.begin = () => {
    const a = { start: performance.now(), frames: [], tasks: [], running: true };
    P.cur = a;
    let last = null;
    const tick = (t) => { if (!a.running) return; if (last !== null) a.frames.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    a.obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.startTime + e.duration >= a.start) a.tasks.push(e.duration); });
    a.obs.observe({ type: 'longtask' });
  };
  P.end = () => {
    const a = P.cur;
    for (const e of a.obs.takeRecords()) a.tasks.push(e.duration);
    a.obs.disconnect();
    a.running = false;
    return { longMax: Math.max(0, ...a.tasks), frameMax: Math.max(0, ...a.frames), blocking: a.tasks.reduce((s, t) => s + Math.max(0, t - 50), 0) };
  };
})()`;

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

const dist = path.resolve(opt('dist') ?? 'dist');
if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`${dist} 里没有构建好的网站:先 pnpm build`);
const port = await freePort();
const server = await preview({ build: { outDir: dist }, preview: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const base = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch({ args: GPU ? [] : ['--disable-gpu'] });
console.log(`量 ${base},${GPU ? '' : '关显卡加速,'}CPU 降速 ${CPU} 倍,像素密度 ${DPR},每步 ${RUNS} 轮;单位 ms(最长任务 / 最长帧距)`);

type Res = { longMax: number; frameMax: number; blocking: number };
const STEPS: [string, string][] = [
  ['→罗宾森', 'robinson'],
  ['→平面', 'equirect'],
  ['→地球仪', 'globe'],
  ['地球仪→平面', 'equirect'],
];
const table: Record<string, Res[]> = {};
try {
  for (const layer of ['political', 'realistic']) {
    for (let run = 0; run < RUNS; run++) {
      const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: DPR });
      const page = await ctx.newPage();
      await page.goto(`${base}?seed=7&play=0&layer=${layer}${EXTRA ? `&${EXTRA}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction('window.__wfLabels && window.__wfLabels.ready', null, { timeout: 180000 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(1500);
      await page.evaluate(RECORDER);
      const cdp = await ctx.newCDPSession(page);
      if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
      for (const [name, proj] of STEPS) {
        await page.evaluate('window.__pp.begin()');
        await page.evaluate(`window.__wfSetProjection(${JSON.stringify(proj)})`);
        // 等画面稳下来:按投影重画、地球仪贴图都在后台,给足 4 秒
        await page.waitForTimeout(4000);
        const r = (await page.evaluate('window.__pp.end()')) as Res;
        (table[`${layer} ${name}`] ??= []).push(r);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close();
  await new Promise<void>((r) => server.httpServer.close(() => r()));
}
const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
for (const [k, rs] of Object.entries(table))
  console.log(`${k.padEnd(24)} ${rs.map((r) => `${Math.round(r.longMax)}/${Math.round(r.frameMax)}`).join('  ').padEnd(36)} 中位 ${Math.round(med(rs.map((r) => r.longMax)))} / ${Math.round(med(rs.map((r) => r.frameMax)))}`);

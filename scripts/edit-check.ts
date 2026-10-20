/**
 * 编辑地形一笔以后的地图:按块重画的结果和整张重画逐像素比,外加各段耗时。像用户一样打开新建世界、点「编辑地形」,
 * 再一笔一笔加地形修改(和地图上涂一笔一样走 editsStore.addTerrainOp),每一笔等地图换上以后:
 *   - 从头整张重画一遍(主图换一个对象,缓存一概不用;弯边投影照投影重画)和画面上那张逐像素比,打印不一样的像素数;
 *   - 打印这一笔的耗时:线程里(生成 + 铺像素 + 推文明)、交回来、换上地图、画好,以及铺像素、按块重画各用了多久。
 *
 *   npx tsx scripts/edit-check.ts                    默认:种子 7、2024 × 写实、手绘 × 平面、罗宾森,每种三笔(中纬度、跨 180° 经线、南极附近)
 *   npx tsx scripts/edit-check.ts --time             只测速:种子 7,手绘 + 写实平面各涂 5 笔(第一笔不算),打印中位数
 *   --cells=200000                                    换精细度(测速用)
 *   --proj=robinson                                   测速时换成弯边投影
 *   --no-check                                       不比像素(量改之前的版本时用:那一版没有比像素要用的调试字段)
 *   npx tsx scripts/edit-check.ts --node [--cells=…]  不开浏览器,在 Node 里一段一段量(见 nodeTimes)
 *   WF_URL=http://localhost:5173 npx tsx …           用现成的服务(比如另一份代码起的 dev server)
 * 自动起一个临时 dev server(随机端口)。数字只在同一台机器上前后对比有意义。
 */
import { chromium, type Page } from 'playwright';
import { startDevServer } from './lib/devserver';

const args = process.argv.slice(2);
const timeOnly = args.includes('--time');
const check = !args.includes('--no-check');
const cells = Number(args.find((a) => a.startsWith('--cells='))?.slice(8) ?? 0) || undefined;
const timeProj = args.find((a) => a.startsWith('--proj='))?.slice(7);

/**
 * --node:不开浏览器,在 Node 里一段一段量(种子 7,同一处涂 5 笔,第一笔不算,打印中位数):
 * 后台线程里的生成、铺像素(整张 / 按块)、沟壑(整张 / 按块)、细沟、推历史;主线程上的上色(写实、手绘,整张 / 按块)
 */
async function nodeTimes(): Promise<void> {
  const { DEFAULT_PARAMS, generateWorld } = await import('../src/gen/world');
  const { rasterizeDeferred, gullyHeights, finishGully, finishVeins, veinsOf } = await import('../src/gen/raster');
  const { rasterizePatch } = await import('../src/gen/rasterEdit');
  const { exactPatch } = await import('../src/gen/rasterPatch');
  const { generateCiv } = await import('../src/gen/civ');
  const { macroGrids, realisticBandPixels, realisticPatchRegion, realisticPixels } = await import('../src/render/realistic');
  const { fantasyPatchPixels, fantasyPixels } = await import('../src/render/fantasy');
  const params = { ...DEFAULT_PARAMS, seed: 7, ...(cells ? { cells } : {}) };
  const cache = { base: null };
  const t = () => performance.now();
  const w0 = generateWorld(params, undefined, [], null, cache);
  const d0 = rasterizeDeferred(w0, 1);
  finishGully(d0.raster, d0.job, gullyHeights(d0.job, 0, d0.job.n));
  finishVeins(d0.raster, veinsOf(d0.veins));
  let keep = { raster: d0.raster, inputs: d0.inputs };
  let world = w0;
  let real = realisticPixels(d0.raster, 'detail');
  let fant = fantasyPixels(w0, d0.raster);
  let land = 0;
  for (let i = 0; i < w0.mesh.n; i++) if (w0.water[i] === 0 && w0.elevation[i] > 200 && w0.elevation[i] < 900 && Math.abs(w0.mesh.y[i] - 512) < 250) { land = i; break; }
  const x = Math.round(w0.mesh.x[land]);
  const y = Math.round(w0.mesh.y[land]);
  const ops: unknown[] = [];
  const rec: Record<string, number[]> = {};
  const put = (k: string, v: number) => (rec[k] ??= []).push(v);
  for (let i = 0; i < 5; i++) {
    ops.push({ kind: 'lift', pts: [x + 6 * i, y, x + 6 * i + 10, y], r: 30, s: 0.6 });
    let t0 = t();
    const w1 = generateWorld(params, undefined, ops as never, null, cache);
    const gen = t() - t0;
    t0 = t();
    const full = rasterizeDeferred(w1, 1);
    const rFull = t() - t0;
    t0 = t();
    gullyHeights(full.job, 0, full.job.n);
    const gFull = t() - t0;
    t0 = t();
    const tried = rasterizePatch(w1, keep);
    if (!tried || !('job' in tried)) throw new Error('这一笔没按块重铺');
    const pj = tried;
    const rPatch = t() - t0;
    t0 = t();
    const hp = gullyHeights(pj.job, 0, pj.job.n);
    const gPatch = t() - t0;
    finishGully(pj.raster, pj.job, hp);
    t0 = t();
    finishVeins(pj.raster, veinsOf(pj.veins));
    const veins = t() - t0;
    t0 = t();
    const patch = exactPatch(keep.raster, pj.raster, pj.win);
    const diff = t() - t0;
    t0 = t();
    if (i === 0) generateCiv(w1, {});
    const civ = t() - t0;
    const r1 = pj.raster;
    const box = patch && patch.w ? { x0: patch.x0, y0: patch.y0, w: patch.w, h: patch.h } : null;
    t0 = t();
    const realFull = realisticPixels(r1, 'detail');
    const paintRealFull = t() - t0;
    t0 = t();
    const g0 = macroGrids(keep.raster);
    const g1 = macroGrids(r1);
    const region = realisticPatchRegion(box, g0, g1, r1.w, r1.h);
    if (region) realisticBandPixels(r1, g1, 'detail', region, region.y0, region.y0 + region.h, true);
    const paintRealPatch = t() - t0;
    t0 = t();
    const fantFull = fantasyPixels(w1, r1);
    const paintFantFull = t() - t0;
    t0 = t();
    fantasyPatchPixels(w1, r1, world, keep.raster, box, fant);
    const paintFantPatch = t() - t0;
    if (i > 0) {
      put('生成(接着上一次)', gen);
      put('铺像素 整张', rFull);
      put('铺像素 按块', rPatch);
      put('沟壑 整张', gFull);
      put('沟壑 按块', gPatch);
      put('细沟(整张)', veins);
      put('比出补丁', diff);
      put('上色·写实 整张', paintRealFull);
      put('上色·写实 按块', paintRealPatch);
      put('上色·手绘 整张', paintFantFull);
      put('上色·手绘 按块', paintFantPatch);
    } else put('推历史', civ);
    keep = { raster: r1, inputs: pj.inputs };
    world = w1;
    real = realFull;
    fant = fantFull;
  }
  void real;
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  console.log(`Node 里一段一段量(种子 7,${params.cells} 个地块;中位数,毫秒):`);
  for (const [k, v] of Object.entries(rec)) console.log(`  ${k.padEnd(14)} ${med(v).toFixed(0)}`);
}

if (args.includes('--node')) {
  await nodeTimes();
  process.exit(0);
}

interface Case {
  seed: number;
  style: 'fantasy' | 'realistic';
  proj?: string;
}

const CASES: Case[] = timeOnly
  ? [
      { seed: 7, style: 'fantasy', proj: timeProj },
      { seed: 7, style: 'realistic', proj: timeProj },
    ]
  : [7, 2024].flatMap((seed) => (['realistic', 'fantasy'] as const).flatMap((style) => [{ seed, style }, { seed, style, proj: 'robinson' }]));

const dev = await startDevServer();
const browser = await chromium.launch();
const errs: string[] = [];
const rows: string[] = [];
const times: Record<string, number[]> = {};

/** 进入编辑地形(同 scripts/replay-check.ts 的 terrainOn):左边点「编辑地形」,星球摊平成平常的地图 */
async function terrainOn(p: Page) {
  await p.locator('.studio').waitFor({ timeout: 30000 });
  await p.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await p.waitForTimeout(450);
  if (await p.locator('.st-sheet.peek').count()) {
    await p.click('.st-sheet [data-act=new-sheet]');
    await p.waitForTimeout(350);
  }
  await p.click('.studio [data-act=terrain]');
  await p.locator('.tp').waitFor({ timeout: 5000 });
  await p.locator('.app.studio-flat').waitFor({ timeout: 10000 });
  await p.waitForTimeout(400);
}

/** 加一笔,等地图换上;返回 __wfTerrain */
async function stroke(p: Page, op: unknown): Promise<any> {
  const prev = await p.evaluate(() => (window as any).__wfTerrain?.id ?? 0);
  await p.evaluate(async (o) => {
    const m = await import('/src/ui/editsStore.ts' as string);
    m.addTerrainOp(o);
  }, op);
  await p.waitForFunction((n) => ((window as any).__wfTerrain?.id ?? 0) > n, prev, { timeout: 60000 });
  // 换上以后等一会儿(文明层、底图缩略图这些各自在后台补画;测速时等它们画完再涂下一笔,像用户涂一笔看一眼再涂)
  await p.waitForTimeout(timeOnly ? 3000 : 300);
  return p.evaluate(() => (window as any).__wfTerrain);
}

/**
 * 页面里:地图上这张从头整张重画(主图换一个对象 = 各种缓存都不认,像素层、符号层整张重画;弯边投影照投影重画),
 * 和画面上的地形画布逐像素比,返回不一样的像素数和第一处
 */
const COMPARE = `(async () => {
  const RE = await import('/src/render/realistic.ts');
  const F = await import('/src/render/fantasy.ts');
  const D = await import('/src/render/detail.ts');
  const P = await import('/src/render/projection.ts');
  const st = window.__wfMapData();
  const { data, mp } = st;
  const world = data.world;
  const r = { ...data.raster };
  const shown = document.querySelector('.map-box canvas');
  const cv = document.createElement('canvas');
  cv.width = shown.width;
  cv.height = shown.height;
  const ctx = cv.getContext('2d');
  const look = st.look;
  if (mp) {
    ctx.fillStyle = P.pageColor(st.style);
    ctx.fillRect(0, 0, cv.width, cv.height);
    D.drawTerrainProjected(ctx, world, r, st.style, mp, { s: r.scale, ox: 0, oy: 0, k: 1 }, look);
  } else if (st.style === 'realistic') RE.renderRealistic(ctx, world, r, look);
  else F.renderFantasy(ctx, world, r);
  const a = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const b = shown.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let n = 0;
  let first = '';
  for (let i = 0; i < a.length; i += 4) {
    if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2] && a[i + 3] === b[i + 3]) continue;
    if (!n) first = ((i / 4) % cv.width) + ',' + Math.floor(i / 4 / cv.width);
    n++;
  }
  return { n, first, style: st.style, proj: mp ? mp.def.id : 'equirect' };
})()`;

for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript('window.__name = (f) => f');
  page.on('pageerror', (e) => errs.push(`${c.seed} ${c.style}: ${e.message}`));
  const q = new URLSearchParams({ new: '1', seed: String(c.seed), play: '0', style: c.style, ...(cells ? { cells: String(cells) } : {}) });
  await page.goto(`${dev.url}/?${q}`);
  await terrainOn(page);
  if (c.proj) {
    await page.evaluate((p) => (window as any).__wfSetProjection(p), c.proj);
    await page.waitForTimeout(1500);
  }
  // 笔落在哪:中纬度的一块陆地、跨 180° 经线、南极附近
  const land = await page.evaluate(() => {
    const w = (window as any).__wfMapData?.()?.data?.world;
    if (!w) return [1000, 400];
    for (let i = 0; i < w.mesh.n; i++) if (w.water[i] === 0 && w.elevation[i] > 200 && w.elevation[i] < 900 && Math.abs(w.mesh.y[i] - 512) < 250) return [Math.round(w.mesh.x[i]), Math.round(w.mesh.y[i])];
    return [1000, 400];
  });
  const [x, y] = land as [number, number];
  const ops = timeOnly
    ? [0, 1, 2, 3, 4].map((i) => ({ kind: 'lift', pts: [x + 6 * i, y, x + 6 * i + 10, y], r: 30, s: 0.6 }))
    : [
        { kind: 'lift', pts: [x, y, x + 10, y], r: 30, s: 0.6 },
        { kind: 'lower', pts: [2030, 500, 2070, 505], r: 25, s: 1 },
        { kind: 'lift', pts: [1000, 1012, 1040, 1015], r: 20, s: 1 },
      ];
  const label = `${c.seed} ${c.style}${c.proj ? ` ${c.proj}` : ''}`;
  for (let i = 0; i < ops.length; i++) {
    const t = await stroke(page, ops[i]);
    const p = t.patch ? `${t.patch.kind} 备料 ${t.patch.prep.toFixed(0)} / ${t.patch.wall.toFixed(0)} ms,最长一步 ${t.patch.maxStep.toFixed(0)}` : '整张';
    let cmp = '';
    if (check) {
      const r = (await page.evaluate(COMPARE)) as { n: number; first: string };
      cmp = r.n ? `✗ ${r.n} 个像素不一样(第一处 ${r.first})` : '✓ 逐像素相同';
      if (r.n) errs.push(`${label} 第 ${i + 1} 笔:${r.n} 个像素不一样(第一处 ${r.first})`);
    }
    const n = (v: number | undefined) => (v === undefined ? '—' : v.toFixed(0));
    rows.push(`${label} 第 ${i + 1} 笔:线程 ${n(t.workerMs)}(铺像素 ${n(t.rasterMs)})交回 ${n(t.gotMs)} 换上 ${n(t.arrivedMs)} 地图上看到 ${n(t.shownMs)} ms;${p} ${cmp}`);
    if (timeOnly && i > 0) {
      // 改之前的版本没有 shownMs:用 paintedMs(换上以后的下一帧;那一版换上就是整张画完)
      for (const [k, v] of Object.entries({ worker: t.workerMs, raster: t.rasterMs, got: t.gotMs, arrived: t.arrivedMs, shown: t.shownMs ?? t.paintedMs, prep: t.patch?.prep, maxStep: t.patch?.maxStep })) {
        if (v === undefined) continue;
        (times[`${c.style} ${k}`] ??= []).push(v);
      }
    }
  }
  await page.close();
}
await browser.close();
await dev.close();
console.log(rows.join('\n'));
if (timeOnly) {
  const med = (a: number[]) => [...a].sort((p, q) => p - q)[Math.floor(a.length / 2)];
  console.log('\n中位数(毫秒):');
  for (const [k, v] of Object.entries(times)) console.log(`  ${k.padEnd(20)} ${med(v).toFixed(0)}`);
}
if (errs.length) {
  console.log('\n问题:\n' + errs.join('\n'));
  process.exit(1);
}

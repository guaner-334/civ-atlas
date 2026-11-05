/**
 * 世界存成文件、打开文件的浏览器检查(走测试钩子 window.__wfWorldFiles;量构建好的网站。真点界面见 scripts/world-file-ui-check.ts)。
 *
 *   pnpm build && npx tsx scripts/world-files-check.ts [--browsers=chromium,webkit] [--only=roundtrip,backup,bad,escape]
 *   --out=<目录>                      存文件、对比图的地方(默认 snaps/world-files)
 *   --kinds=默认,改名                  往返只跑这几种世界
 *   --cross=<世界文件>                别的浏览器存的文件:打开、走存下的内容
 *   --big=<世界文件>                  再量大文件:打开、存、再打开的耗时和内存峰值
 *   --sixty=<放世界文件的目录>         再量很多世界:全部放进一个浏览器,全部存成文件,换一个干净的浏览器放回来
 *   --over=<世界文件>                 超过一个文件的上限:这个世界放 8 份(名字不同),全部存成文件该分成几个,一起选、分开选都放得回来(只在 Chromium)
 *
 * roundtrip:7 种世界存成文件,换一个干净的浏览器配置打开,地图、放大细部(逐像素)、历史、人口、国旗、编年史、AI 正文、封面逐项比,字节也比。真实 AI 接口不调
 * backup:   全部存成文件往返;坏一个不影响其余;本机已有的不被盖掉
 * bad:      乱改的文件:不白屏、不卡死(页面一直能响应),报的错分得对
 * escape:   校验器之外打开时出事(内容缺块、配方和内容对不上):接得住,不白屏
 *
 * 内存是这个脚本启动的浏览器全部子进程的 RSS 加起来;WebKit 的网页进程不是它的子进程,那边的内存数不算数,只看耗时。
 * 没过的打印「没过」,退出码非 0。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { preview } from 'vite';
import { generateCiv } from '../src/gen/civ';
import { polityKey, type WorldEdits } from '../src/gen/edits';
import { makeSave, worldCheck, type SaveFile } from '../src/gen/savefile';
import { sha256 } from '../src/gen/snapshot';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { openWorldFile } from '../src/gen/worldFile';
import { READER_VERSIONS } from '../src/gen/readers/versions';
import { GENERATOR_VERSION } from '../src/gen/edits';
import { ZIP_LOCAL_MAX_BYTES, parseZip, walkZip, writeZip, type ZipInput } from '../src/gen/zipStore';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BROWSERS = (opt('browsers') ?? 'chromium,webkit').split(',');
const ONLY = (opt('only') ?? 'roundtrip,backup,bad,escape').split(',');
const OUT = path.resolve(opt('out') ?? 'snaps/world-files');
mkdirSync(OUT, { recursive: true });
const WAIT = 180_000;
const VIEW = { viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true };

const fails: string[] = [];
const say = (...a: unknown[]) => console.log(...a);
const check = (ok: boolean, what: string) => {
  say(`  ${ok ? '过' : '没过'}  ${what}`);
  if (!ok) fails.push(what);
};

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

const port = await freePort();
const srv = await preview({ build: { outDir: path.resolve('dist') }, preview: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const BASE = `http://127.0.0.1:${port}/`;

// ---------------------------------------------------------------------------
// 7 种世界(存档用 Node 里生成的世界算地形哈希、挑国家;世界本身在浏览器里算)

const AI_NOTE = { key: '史书:world', kind: '史书', title: '检查用的史书', text: '这是检查脚本写进去的 AI 正文,<b>不当网页内容</b>。', createdAt: '2026-11-04T08:00:00.000Z', provider: 'test', model: 'test-1' };

interface Kind {
  name: string;
  save: SaveFile;
  note?: boolean;
}

function kinds(): Kind[] {
  const small = { ...DEFAULT_PARAMS, seed: 2024, cells: 4000 };
  const w = generateWorld(small);
  const check = worldCheck(w);
  const civ = generateCiv(w, { endYear: 1000 });
  const a = polityKey(civ, civ.polities[0].id);
  const none: WorldEdits = { names: {}, interventions: [], terrain: [], endYear: 1000 };
  const def = { ...DEFAULT_PARAMS, seed: 7 };
  return [
    { name: '默认', save: makeSave(def, { names: {}, interventions: [], terrain: [] }, worldCheck(generateWorld(def)), '默认世界') },
    { name: '改名', save: makeSave(small, { ...none, names: { [`polity:${a}`]: '饕餮王朝' } }, check, '改了名的世界') },
    { name: '干预', save: makeSave(small, { ...none, interventions: [{ kind: 'protect', a, from: 100, until: 600 }] }, check, '干预过的世界') },
    { name: '逐年推演', save: makeSave(small, { ...none, play: { year: 1000, commands: [] }, endYear: 1000 }, check, '逐年推演的世界') },
    { name: '地形大事', save: makeSave(small, { ...none, upheavals: [{ year: 500, ops: [{ kind: 'volcano', pts: [1310, 763], r: 60, s: 1.5 }] }] }, check, '有地形大事的世界') },
    { name: '作者人物', save: makeSave(small, { ...none, characters: [{ id: 1, name: '检查用的人物', color: 'red', born: 100, died: 170 }] } as WorldEdits, check, '有作者人物的世界') },
    { name: 'AI 正文', save: makeSave(small, none, check, '有 AI 正文的世界'), note: true },
  ];
}

// ---------------------------------------------------------------------------
// 页面上的几步

/** 页面上调世界文件那几个函数:Blob 放在 window.__blobs 里,用编号拿 */
const WF = `(async () => { window.__blobs ??= {}; return window.__wfWorldFiles(); })()`;

async function hookReady(page: Page) {
  await page.waitForFunction(() => typeof (window as any).__wfWorldFiles === 'function', null, { timeout: WAIT });
}

/** 打开网站首页(新的上下文里) */
async function home(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
  await page.goto(BASE);
  await hookReady(page);
  return page;
}

/** 本地文件交给页面:存在 window.__blobs[key](第一个)、window.__picked(全部) */
async function upload(page: Page, file: string | string[], key: string) {
  await page.evaluate(() => {
    let el = document.getElementById('wf-in') as HTMLInputElement | null;
    if (!el) {
      el = Object.assign(document.createElement('input'), { type: 'file', id: 'wf-in', hidden: true, multiple: true });
      document.body.append(el);
    }
  });
  await page.setInputFiles('#wf-in', file);
  await page.evaluate((k) => {
    const w = window as any;
    w.__blobs ??= {};
    const files = [...(document.getElementById('wf-in') as HTMLInputElement).files!];
    w.__blobs[k] = files[0];
    w.__picked = files;
  }, key);
}

/** 页面里的 Blob 下载到本地 */
async function download(page: Page, key: string, to: string): Promise<void> {
  const [d] = await Promise.all([
    page.waitForEvent('download', { timeout: WAIT }),
    page.evaluate((k) => {
      const w = window as any;
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(w.__blobs[k]), download: 'x.bin' });
      document.body.append(a);
      a.click();
      a.remove();
    }, key),
  ]);
  await d.saveAs(to);
}

/** 打开一个 .json 存档,等世界推完;返回编号 */
async function openJson(page: Page, save: SaveFile, name: string): Promise<string> {
  const file = path.join(OUT, `${name}.json`);
  writeFileSync(file, JSON.stringify(save));
  await page.goto(BASE);
  await page.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
  await page.setInputFiles('[data-testid=save-file-input]', file);
  await page.waitForFunction(() => new URLSearchParams(location.search).has('w') && (window as any).__wf?.ready, null, { timeout: WAIT });
  await settle(page);
  return new URL(page.url()).searchParams.get('w')!;
}

/** 等世界画好、停稳 */
async function settle(page: Page) {
  await page.waitForFunction(() => (window as any).__wf?.ready && (window as any).__wfCiv?.ready, null, { timeout: WAIT });
  await page.waitForTimeout(2500);
}

/** 等这个世界的封面截好、一会儿不变了 */
async function thumbSettled(page: Page, id: string) {
  let last: string | null = null;
  let quiet = 0;
  for (let i = 0; i < 120 && quiet < 3; i++) {
    const now = await page.evaluate((x) => localStorage.getItem(`wenming-ditu:thumb:${x}`), id);
    quiet = now && now === last ? quiet + 1 : 0;
    last = now;
    await page.waitForTimeout(500);
  }
}

/** 存成文件:交回名字,文件在 to */
async function saveFile(page: Page, id: string, to: string): Promise<{ name: string; stale: boolean; ms: number }> {
  const r = await page.evaluate(
    async ([wf, i]) => {
      const m = await eval(wf as string);
      const t = performance.now();
      const out = await m.saveWorldFile(i);
      const ms = performance.now() - t;
      if (!out.ok) return { error: `${out.kind} ${out.message}`, ms };
      (window as any).__blobs.saved = out.file;
      return { name: out.name, stale: out.stale, ms };
    },
    [WF, id],
  );
  if ('error' in r) throw new Error(`存不了 ${id}:${r.error}`);
  await download(page, 'saved', to);
  return r as { name: string; stale: boolean; ms: number };
}

/** 打开文件:核对、存成新世界;交回本机编号 */
async function keepFile(page: Page, file: string): Promise<{ id: string; lookMs: number; keepMs: number; match: string }> {
  await upload(page, file, 'in');
  const r = await page.evaluate(async (wf) => {
    const m = await eval(wf);
    const t0 = performance.now();
    const l = await m.lookWorldFile((window as any).__blobs.in, { timeoutMs: 120000 });
    const t1 = performance.now();
    if (!l.ok) return { error: `${l.kind} ${l.message}` };
    const k = await m.keepWorldFile(l);
    if (!k.ok) return { error: `${k.kind} ${k.message}` };
    return { id: k.id, lookMs: t1 - t0, keepMs: performance.now() - t1, match: l.match.kind };
  }, WF);
  if ('error' in r) throw new Error(`打不开 ${file}:${r.error}`);
  return r as { id: string; lookMs: number; keepMs: number; match: string };
}

/** 看得见的东西:地图像素(两张)、历史、人口、国旗、编年史 */
interface Seen {
  load: string;
  map: Buffer;
  zoom: Buffer;
  countries: string;
  flags: string;
  chronicle: string;
  probes: string;
}

async function seen(page: Page): Promise<Seen> {
  const load = await page.evaluate(() => String((window as any).__wfLoad));
  const url = await page.evaluate(() => (document.querySelector('.map-box > canvas:not(.wrap-copy)') as HTMLCanvasElement).toDataURL('image/png'));
  const map = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  const probes = await page.evaluate(() => {
    const w = window as any;
    const out: string[] = [];
    for (const [x, y] of [
      [400, 300],
      [700, 400],
      [900, 300],
      [1100, 500],
      [600, 600],
    ])
      out.push((w.__wfProbe?.(x, y) ?? []).join('/'));
    return out.join('\n');
  });
  // 世界概览:国家表(人口、国旗)、编年史
  await page.click('[data-act=overview]', { timeout: 15000 });
  await page.locator('.ov-root:not([hidden]) .ov').waitFor({ timeout: 15000 });
  await page.click('.ov-tab[data-tab=countries]');
  await page.waitForTimeout(400);
  const countries = (await page.locator('.ov-body').innerText()).replace(/\s+/g, ' ');
  const flags = await page.evaluate(() =>
    [...document.querySelectorAll('.ov-body svg')]
      .slice(0, 80)
      .map((e) => e.outerHTML)
      .join('\n'),
  );
  await page.click('.ov-tab[data-tab=chronicle]');
  await page.waitForTimeout(400);
  const chronicle = (await page.locator('.ov-body').innerText()).replace(/\s+/g, ' ');
  await page.click('.ov-x');
  await page.waitForTimeout(300);
  // 放大细部:地图中间放大到 8 倍,细部铺好以后截图
  await page.mouse.move(800, 400);
  await page.mouse.wheel(0, -Math.log(8) / 0.0015);
  await page.waitForTimeout(800);
  await page.waitForFunction(
    () => {
      const w = window as any;
      return w.__wfDetail?.on && !w.__wfDetail?.pending && !w.__wfCivDetail?.pending;
    },
    null,
    { timeout: 60000 },
  ).catch(() => say('  (放大细部没等到)'));
  await page.waitForTimeout(1500);
  const zoom = await page.screenshot({ clip: { x: 450, y: 100, width: 800, height: 600 } });
  return { load, map, zoom, countries, flags, chronicle, probes };
}

function pngDiff(a: Buffer, b: Buffer): number {
  const x = PNG.sync.read(a);
  const y = PNG.sync.read(b);
  if (x.width !== y.width || x.height !== y.height) return -1;
  // 一个通道差 1 不算:WebKit 的画布偶尔有个别像素差 1(各块字节都一样),打印出来看得到
  let n = 0;
  let small = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]), Math.abs(x.data[i + 3] - y.data[i + 3]));
    if (d > 1) n++;
    else if (d) small++;
  }
  if (small) say(`  (${small} 个像素差 1,不算)`);
  return n;
}

/** 文件里各块的指纹(块名 → 指纹) */
async function sumsOf(file: string): Promise<Map<string, string>> {
  const o = await openWorldFile(new Uint8Array(readFileSync(file)), { readers: { ...READER_VERSIONS } });
  const out = new Map<string, string>();
  for (const p of o.manifest.parts) out.set(p.name, await sha256(o.bytes.get(p.name)!));
  return out;
}

// ---------------------------------------------------------------------------
// 往返

async function roundtrip(browser: Browser, tag: string, list: Kind[]): Promise<{ id: string; kind: Kind }[]> {
  say(`\n== 往返(${tag})`);
  const a = await browser.newContext(VIEW);
  const pa = await a.newPage();
  pa.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
  const b = await browser.newContext(VIEW);
  const pb = await home(b);
  const made: { id: string; kind: Kind }[] = [];
  for (const k of list) {
    say(` ${k.name}`);
    const id = await openJson(pa, k.save, `${tag}-${k.name}`);
    await hookReady(pa);
    if (k.note) await pa.evaluate(([i, n]) => localStorage.setItem(`civ-atlas:ai-notes:${i}`, JSON.stringify([n])), [id, AI_NOTE] as const);
    if (k.note) {
      await pa.reload();
      await hookReady(pa);
      await settle(pa);
    }
    made.push({ id, kind: k });
    // 封面是画好以后才截的(有地形大事的要等那一段的主图铺好):等它截好、停下来再存,不然文件里是空的,对方自己再截一张
    await thumbSettled(pa, id);
    const file = path.join(OUT, `${tag}-${k.name}.civworld`);
    const s = await saveFile(pa, id, file);
    check(s.name.endsWith('.civworld') && statSync(file).size > 1000, `${k.name}:存成文件 ${s.name}(${(statSync(file).size / 1e6).toFixed(2)} MB,${Math.round(s.ms)} ms)`);
    check(!s.stale, `${k.name}:没有没推完的修改`);
    const raw = (() => {
      try {
        execFileSync('unzip', ['-tq', file], { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })();
    check(raw, `${k.name}:解压软件打得开`);
    const thumbA = await pa.evaluate((i) => localStorage.getItem(`wenming-ditu:thumb:${i}`), id);
    // 原来这边再打开一次(走存下的内容):和对方比的是用的人原来看到的
    await pa.reload();
    await settle(pa);
    const sa = await seen(pa);

    await pb.goto(BASE);
    await hookReady(pb);
    const kept = await keepFile(pb, file);
    check(kept.match === 'new', `${k.name}:干净的浏览器里是新世界`);
    check(kept.id !== id, `${k.name}:本机编号是新的`);
    await pb.goto(`${BASE}?w=${kept.id}`);
    await settle(pb);
    const sb = await seen(pb);
    check(sb.load === 'stored', `${k.name}:打开走存下的内容,不重新生成(${sb.load})`);
    const dMap = pngDiff(sa.map, sb.map);
    const dZoom = pngDiff(sa.zoom, sb.zoom);
    writeFileSync(path.join(OUT, `${tag}-${k.name}-zoom-a.png`), sa.zoom);
    writeFileSync(path.join(OUT, `${tag}-${k.name}-zoom-b.png`), sb.zoom);
    check(dMap === 0, `${k.name}:地图逐像素一样(差 ${dMap})`);
    check(dZoom === 0, `${k.name}:放大细部逐像素一样(差 ${dZoom})`);
    check(sa.countries === sb.countries && sa.countries.length > 20, `${k.name}:历史、人口(国家表)一样`);
    if (sa.countries !== sb.countries) {
      writeFileSync(path.join(OUT, `${tag}-${k.name}-countries-a.txt`), sa.countries);
      writeFileSync(path.join(OUT, `${tag}-${k.name}-countries-b.txt`), sb.countries);
    }
    check(sa.flags === sb.flags, `${k.name}:国旗一样(${sa.flags.length} 字)`);
    check(sa.chronicle === sb.chronicle && sa.chronicle.length > 20, `${k.name}:编年史一样(${sa.chronicle.length} 字)`);
    check(sa.probes === sb.probes, `${k.name}:地块读数(群落、海拔、国家、民族)一样`);
    const thumbB = await pb.evaluate((i) => localStorage.getItem(`wenming-ditu:thumb:${i}`), kept.id);
    check(!!thumbA && thumbA === thumbB, `${k.name}:封面一样`);
    const notes = await pb.evaluate(async (i) => {
      const lib = (await (window as any).__wfNotes()).notes;
      await lib.notesReady([i]);
      return lib.exportNotes(i) as { text: string }[];
    }, kept.id);
    if (k.note) check(notes[0]?.text === AI_NOTE.text, `${k.name}:AI 正文回来了`);
    // 再存一次:字节和原来一样(清单除外,AI 正文可能重新打包)
    const back = path.join(OUT, `${tag}-${k.name}-back.civworld`);
    await saveFile(pb, kept.id, back);
    const s1 = await sumsOf(file);
    const s2 = await sumsOf(back);
    const differ = ['map', 'eras', 'civ', 'chronicle', 'flags', 'thumb'].filter((n) => s1.get(n) !== s2.get(n));
    check(!differ.length, `${k.name}:再存成文件,各块字节一样${differ.length ? `(不一样的:${differ.join('、')})` : ''}`);
  }
  await pa.close();
  await pb.close();
  await b.close();
  // 上下文留着,全部存成文件接着用
  (globalThis as any).__ctxA = a;
  return made;
}

// ---------------------------------------------------------------------------
// 全部存成文件

const worldsOf = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('wenming-ditu:world:')).length);

async function saveAll(page: Page, to: string): Promise<{ ms: number; count: number; whole: number; recipeOnly: number; size: number; files: number; paths: string[] }> {
  const r = await page.evaluate(async (wf) => {
    const m = await eval(wf);
    const t = performance.now();
    const out = await m.saveAllWorldFiles();
    if (!out.ok) return { error: `${out.kind} ${out.message}` };
    out.files.forEach((f: { file: Blob }, i: number) => ((window as any).__blobs[`all${i}`] = f.file));
    return { ms: performance.now() - t, count: out.count, whole: out.whole, recipeOnly: out.recipeOnly.length, size: out.bytes, files: out.files.length };
  }, WF);
  if ('error' in r) throw new Error(`全部存成文件失败:${r.error}`);
  const paths: string[] = [];
  for (let i = 0; i < (r as { files: number }).files; i++) {
    const p = i ? to.replace(/\.civworld$/, `-${i + 1}.civworld`) : to;
    await download(page, `all${i}`, p);
    paths.push(p);
  }
  return { ...(r as never as { ms: number; count: number; whole: number; recipeOnly: number; size: number; files: number }), paths };
}

interface Restored {
  added: number;
  copied: number;
  same: number;
  skipped: [string, string][];
  cut: boolean;
  ms: number;
}

async function openAll(page: Page, file: string | string[]): Promise<Restored> {
  await upload(page, file, 'pack');
  const r = await page.evaluate(async (wf) => {
    const m = await eval(wf);
    const t = performance.now();
    const out = await m.openWorldFiles((window as any).__picked);
    return { added: out.added.length, copied: out.copied.length, same: out.same.length, skipped: out.skipped.map((p: { name: string; kind: string }) => [p.name, p.kind]), cut: out.cut, ms: performance.now() - t };
  }, WF);
  return r as Restored;
}

async function backup(browser: Browser, tag: string, made: { id: string; kind: Kind }[]) {
  say(`\n== 全部存成文件(${tag})`);
  const a: BrowserContext = (globalThis as any).__ctxA;
  const pa = await a.newPage();
  await pa.goto(BASE);
  await hookReady(pa);
  const file = path.join(OUT, `${tag}-all.civworld`);
  const s = await saveAll(pa, file);
  check(s.count === made.length && s.whole === made.length && s.recipeOnly === 0 && s.files === 1, `${s.whole} 个世界带完整内容,一个文件 ${(s.size / 1e6).toFixed(1)} MB,${Math.round(s.ms)} ms`);

  const b = await browser.newContext(VIEW);
  const pb = await home(b);
  const r = await openAll(pb, file);
  check(r.added === made.length && !r.skipped.length && !r.cut, `干净的浏览器放回 ${r.added} 个,${Math.round(r.ms)} ms`);
  // 里面任意一个打开走存下的内容
  const ids = await pb.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('wenming-ditu:world:')).map((k) => k.slice('wenming-ditu:world:'.length)));
  await pb.goto(`${BASE}?w=${ids[1]}`);
  await settle(pb);
  check((await pb.evaluate(() => (window as any).__wfLoad)) === 'stored', '放回来的世界打开走存下的内容');
  await pb.close();
  await b.close();

  // 坏一个不影响其余
  const walk = await walkZip(new Blob([readFileSync(file)]));
  const worlds = walk.entries.filter((e) => e.name.endsWith('.civworld'));
  // 中间那个世界最新的一份(旧修订坏了不算这个世界坏了)
  const dir = worlds[Math.floor(worlds.length / 2)].name.split('/')[1];
  const target = worlds.filter((e) => e.name.split('/')[1] === dir).at(-1)!.name;
  const entries: ZipInput[] = [];
  for (const e of walk.entries) {
    const d = new Uint8Array(await e.data.arrayBuffer());
    if (e.name === target) d[Math.floor(d.length / 2)] ^= 0xff;
    entries.push({ name: e.name, data: d });
  }
  const hurt = path.join(OUT, `${tag}-all-hurt.civworld`);
  writeFileSync(hurt, new Uint8Array(await (await writeZip(entries, 2 * ZIP_LOCAL_MAX_BYTES)).arrayBuffer()));
  const c = await browser.newContext(VIEW);
  const pc = await home(c);
  const rc = await openAll(pc, hurt);
  check(rc.added === made.length - 1 && rc.skipped.length === 1 && target.startsWith(rc.skipped[0][0]) && rc.skipped[0][1] === 'broken', `坏一个:放回 ${rc.added} 个,${target} 报 ${rc.skipped[0]?.[1]}`);
  await pc.close();
  await c.close();

  // 下载断了
  const cutFile = path.join(OUT, `${tag}-all-cut.civworld`);
  const all = readFileSync(file);
  writeFileSync(cutFile, all.subarray(0, Math.floor(all.length * 0.6)));
  const d = await browser.newContext(VIEW);
  const pd = await home(d);
  const rd = await openAll(pd, cutFile);
  check(rd.cut && rd.added > 0 && rd.added < made.length, `下载断了(留 60%):放回 ${rd.added} 个,标了不完整`);
  await pd.close();
  await d.close();

  // 本机已有的不被盖掉:一个改了名
  const victim = made[1].id;
  await pa.evaluate(
    ([i]) => {
      const k = `wenming-ditu:world:${i}`;
      const s = JSON.parse(localStorage.getItem(k)!);
      s.title = '本机改过的名字';
      localStorage.setItem(k, JSON.stringify(s));
    },
    [victim],
  );
  await pa.reload();
  await hookReady(pa);
  const before = await worldsOf(pa);
  const re = await openAll(pa, file);
  check(re.added === 0 && re.same === made.length - 1 && re.copied === 1, `本机已有的:${re.same} 个相同不重复放,${re.copied} 个不同另存了一份`);
  check((await worldsOf(pa)) === before + 1, '世界只多了另存的那一个');
  const title = await pa.evaluate((i) => JSON.parse(localStorage.getItem(`wenming-ditu:world:${i}`)!).title, victim);
  check(title === '本机改过的名字', '本机改过的那个没被盖掉');
  await pa.close();
  await a.close();
}

// ---------------------------------------------------------------------------
// 乱改的文件

async function retouch(from: Uint8Array, change: (e: ZipInput[], m: any) => void | Promise<void>): Promise<Uint8Array> {
  const entries: ZipInput[] = parseZip(from, ZIP_LOCAL_MAX_BYTES).map((e) => ({ name: e.name, data: e.data.slice() }));
  const me = entries.find((x) => x.name === 'manifest.json')!;
  const m = JSON.parse(new TextDecoder().decode(me.data as Uint8Array));
  await change(entries, m);
  me.data = new TextEncoder().encode(JSON.stringify(m));
  return new Uint8Array(await (await writeZip(entries, ZIP_LOCAL_MAX_BYTES)).arrayBuffer());
}

async function bad(browser: Browser, tag: string, good: string) {
  say(`\n== 乱改的文件(${tag})`);
  const src = new Uint8Array(readFileSync(good));
  const flip = src.slice();
  flip[Math.floor(src.length / 2)] ^= 0xff;
  const fake = new TextEncoder().encode('<script>window.__owned=1</script>');
  const fakeSum = await sha256(fake);
  const cases: [string, Uint8Array, string][] = [
    ['改了一个字节', flip, 'broken'],
    ['截断', src.slice(0, Math.floor(src.length * 0.7)), 'broken'],
    ['空文件', new Uint8Array(0), 'broken'],
    ['不是 ZIP', new TextEncoder().encode('{"app":"文明与地图"}'), 'broken'],
    ['加没列的条目', await retouch(src, (e) => void e.push({ name: 'parts/evil.gz', data: new Uint8Array(9) })), 'broken'],
    [
      '假 JPEG',
      await retouch(src, (e, m) => {
        const t = e.find((x) => x.name === 'parts/thumb.jpg');
        if (t) t.data = fake;
        else e.push({ name: 'parts/thumb.jpg', data: fake });
        m.parts = m.parts.filter((p: { name: string }) => p.name !== 'thumb');
        m.parts.push({ name: 'thumb', file: 'parts/thumb.jpg', schema: 1, sum: fakeSum, bytes: fake.length, zip: 'none', need: 'extra' });
      }),
      'broken',
    ],
    ['超大块', await retouch(src, (_, m) => void (m.parts.find((p: { name: string }) => p.name === 'civ').bytes = 9e9)), 'broken'],
    [
      '__proto__',
      await retouch(src, (e, m) => {
        Object.defineProperty(m, '__proto__', { value: { polluted: 1 }, enumerable: true });
        void e;
      }),
      'broken',
    ],
    ['版本太新(外壳)', await retouch(src, (_, m) => void (m.format = 99)), 'newer'],
    ['版本太新(读取规则)', await retouch(src, (_, m) => void (m.readers.terrain = 99)), 'newer'],
    ['版本太新(结构)', await retouch(src, (_, m) => void (m.parts.find((p: { name: string }) => p.name === 'civ').schema = 99)), 'newer'],
    [
      '版本太新(生成器)',
      await retouch(src, (_, m) => {
        m.made.generator = GENERATOR_VERSION + 1;
        m.recipe.generator = GENERATOR_VERSION + 1;
      }),
      'newer',
    ],
    ['http 的出处', await retouch(src, (_, m) => void (m.recipe.origin = { title: 't', url: 'javascript:alert(1)' })), 'broken'],
    ['id 乱填', await retouch(src, (_, m) => void (m.id = '__proto__')), 'ok'],
    ['标题带标签', await retouch(src, (_, m) => void (m.recipe.title = '<img src=x onerror="window.__owned=1">')), 'ok'],
  ];
  const c = await browser.newContext(VIEW);
  const page = await home(c);
  for (const [name, bytes, want] of cases) {
    const f = path.join(OUT, `${tag}-bad.bin`);
    writeFileSync(f, bytes);
    await upload(page, f, 'in');
    const r = await page.evaluate(async (wf) => {
      const w = window as any;
      const m = await eval(wf);
      // 核对的时候主线程照样转:一直有响应
      let gap = 0;
      let last = performance.now();
      const tick = setInterval(() => {
        const now = performance.now();
        gap = Math.max(gap, now - last);
        last = now;
      }, 20);
      const l = await m.lookWorldFile(w.__blobs.in);
      clearInterval(tick);
      return { kind: l.ok ? 'ok' : l.kind, gap, title: l.ok ? l.title : null };
    }, WF);
    check(r.kind === want, `${name}:报 ${r.kind}(主线程最长停 ${Math.round(r.gap)} ms)`);
  }
  // 标题带标签的文件存进来、打开:是字,不是网页内容
  const titled = path.join(OUT, `${tag}-titled.civworld`);
  writeFileSync(titled, cases.find((x) => x[0] === '标题带标签')![1]);
  const k = await keepFile(page, titled);
  await page.goto(`${BASE}?w=${k.id}`);
  await settle(page);
  check(!(await page.evaluate(() => (window as any).__owned)), '带标签的标题打开后没有变成网页内容');
  check(await page.evaluate(() => !!document.querySelector('.app')), '没白屏');
  await page.close();
  await c.close();
}

// ---------------------------------------------------------------------------
// 校验器之外打开时出事

async function escape(browser: Browser, tag: string, good: string) {
  say(`\n== 校验器之外打开时出事(${tag})`);
  const c = await browser.newContext(VIEW);
  const page = await home(c);
  // 1. 收进来以后块没了(存储被清了一部分):退回旧路
  const k = await keepFile(page, good);
  await page.evaluate(async (id) => {
    await new Promise<void>((resolve, reject) => {
      const q = indexedDB.open('civ-atlas:worlds');
      q.onsuccess = () => {
        const d = q.result;
        const t = d.transaction(['parts', 'manifests'], 'readwrite');
        const g = t.objectStore('manifests').getAll();
        g.onsuccess = () => {
          const row = (g.result as { id: string; text: string }[]).find((r) => r.id === id)!;
          const m = JSON.parse(row.text) as { parts: { name: string; sum: string; zip: string }[] };
          const civ = m.parts.find((p) => p.name === 'civ')!;
          t.objectStore('parts').delete(`${civ.sum}.${civ.zip}`);
        };
        t.oncomplete = () => {
          d.close();
          resolve();
        };
        t.onerror = () => reject(t.error);
      };
    });
  }, k.id);
  await page.goto(`${BASE}?w=${k.id}`);
  await settle(page);
  check(await page.evaluate(() => !!document.querySelector('.app')), '块没了:没白屏,世界打开了');
  check((await page.evaluate(() => (window as any).__wfLoad)) === 'made', '块没了:退回按配方生成');
  // 2. 校验器看不到的问题:配方和内容对不上,打开时后台线程抛错(绕过文件那道核对,模拟校验器漏掉的情况)
  await page.goto(BASE);
  await hookReady(page);
  await upload(page, good, 'in');
  const id2 = await page.evaluate(async (wf) => {
    const m = await eval(wf);
    const l = await m.lookWorldFile((window as any).__blobs.in);
    const save = { ...l.facts.save, seed: l.facts.save.seed + 1, params: { ...l.facts.save.params, seed: l.facts.save.seed + 1 }, title: '对不上的世界' };
    const k2 = await m.keepWorldFile({ ...l, facts: { ...l.facts, recipeKey: await m._recipeKeyOf(save) } }, { save });
    return k2.ok ? k2.id : null;
  }, WF);
  check(!!id2, '绕过核对收进来了');
  await page.goto(`${BASE}?w=${id2}`);
  await settle(page);
  check(await page.evaluate(() => !!document.querySelector('.app')), '打开时出事:没白屏,世界打开了');
  check((await page.evaluate(() => (window as any).__wfLoad)) === 'made', '打开时出事:退回按配方生成');
  await page.close();
  await c.close();
}

// ---------------------------------------------------------------------------
// 量大文件、很多世界

/** 量这段时间里浏览器全部进程的内存峰值(MB,RSS 加起来) */
function sampleRss(pid: number): { stop: () => { peak: number; base: number } } {
  const read = () => {
    try {
      const out = execFileSync('ps', ['-axo', 'pid=,ppid=,rss='], { encoding: 'utf8' });
      const rows = out.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
      const kids = new Set([pid]);
      for (let again = true; again; ) {
        again = false;
        for (const [p, pp] of rows)
          if (kids.has(pp) && !kids.has(p)) {
            kids.add(p);
            again = true;
          }
      }
      return rows.filter(([p]) => kids.has(p)).reduce((s, r) => s + r[2], 0) / 1024;
    } catch {
      return 0;
    }
  };
  const base = read();
  let peak = base;
  const t = setInterval(() => {
    peak = Math.max(peak, read());
  }, 150);
  return {
    stop: () => {
      clearInterval(t);
      return { peak: Math.round(peak), base: Math.round(base) };
    },
  };
}

function browserPid(): number {
  // Playwright 不给 pid:本脚本启动的浏览器是这个进程的子进程
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n');
  for (const l of rows) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (m && Number(m[2]) === process.pid && /chrom|headless|webkit|playwright|pw_run/i.test(m[3])) return Number(m[1]);
  }
  throw new Error('找不到浏览器进程');
}

async function big(browser: Browser, file: string) {
  say(`\n== 大文件 ${path.basename(file)}(${(statSync(file).size / 1e6).toFixed(1)} MB)`);
  const pid = browserPid();
  const c = await browser.newContext(VIEW);
  const page = await home(c);
  const s0 = sampleRss(pid);
  const k = await keepFile(page, file);
  const m0 = s0.stop();
  say(`  核对 ${(k.lookMs / 1000).toFixed(1)} s,存进仓库 ${(k.keepMs / 1000).toFixed(1)} s;内存 ${m0.base} → 峰值 ${m0.peak} MB`);
  const s1 = sampleRss(pid);
  const out = path.join(OUT, 'big-back.civworld');
  const s = await saveFile(page, k.id, out);
  const m1 = s1.stop();
  say(`  存成文件 ${(s.ms / 1000).toFixed(1)} s(${(statSync(out).size / 1e6).toFixed(1)} MB);内存 ${m1.base} → 峰值 ${m1.peak} MB`);
  const s1a = await sumsOf(file);
  const s1b = await sumsOf(out);
  check(['map', 'eras', 'civ', 'chronicle', 'flags'].every((n) => s1a.get(n) === s1b.get(n)), '存出来的各块字节和原来一样');
  const s2 = sampleRss(pid);
  const t0 = Date.now();
  await page.goto(`${BASE}?w=${k.id}`);
  await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 600_000 });
  const shown = Date.now() - t0;
  await page.waitForFunction(() => (window as any).__wfCiv?.ready, null, { timeout: 600_000 });
  const civ = Date.now() - t0;
  const m2 = s2.stop();
  check((await page.evaluate(() => (window as any).__wfLoad)) === 'stored', '打开走存下的内容');
  say(`  打开世界:地图画好 ${(shown / 1000).toFixed(1)} s,文明出来 ${(civ / 1000).toFixed(1)} s;内存峰值 ${m2.peak} MB`);
  await page.close();
  await c.close();
}

/** 超过一个文件的上限 */
async function over(browser: Browser, file: string) {
  const copies = 8;
  say(`\n== 超过 1 GB(${path.basename(file)} 放 ${copies} 份,Chromium)`);
  const pid = browserPid();
  const c = await browser.newContext(VIEW);
  const page = await home(c);
  await upload(page, file, 'in');
  await page.evaluate(
    async ([wf, n]) => {
      const m = await eval(wf as string);
      const l = await m.lookWorldFile((window as any).__blobs.in, { timeoutMs: 120000 });
      if (!l.ok) throw new Error(l.message);
      for (let i = 0; i < (n as number); i++) {
        const k = await m.keepWorldFile(l, { save: { ...l.facts.save, title: `第 ${i + 1} 份` } });
        if (!k.ok) throw new Error(k.message);
      }
    },
    [WF, copies] as const,
  );
  const zip = path.join(OUT, 'over.civworld');
  const s0 = sampleRss(pid);
  const s = await saveAll(page, zip);
  const m0 = s0.stop();
  const sizes = s.paths.map((p) => statSync(p).size);
  check(s.files === 2 && sizes.every((x) => x <= 1e9) && s.whole === copies, `全部存成文件:${s.whole} 个世界,分成 ${s.files} 个文件(${sizes.map((x) => (x / 1e6).toFixed(0)).join('、')} MB),${(s.ms / 1000).toFixed(1)} s;内存 ${m0.base} → 峰值 ${m0.peak} MB`);
  await page.close();
  await c.close();

  const d = await browser.newContext(VIEW);
  const pd = await home(d);
  // 只选了第二个:说得出还差第一个;放回它里面的
  await upload(pd, s.paths[1], 'p');
  const sets = await pd.evaluate(async (wf) => {
    const m = await eval(wf);
    const r = await m.lookWorldFiles((window as any).__picked);
    return { sets: r.sets, part: r.files[0].part, parts: r.files[0].parts };
  }, WF);
  check(sets.part === 2 && sets.parts === 2 && sets.sets[0].missing.join() === '1', `只选第二个:第 ${sets.part} 个,共 ${sets.parts} 个,还差第 ${sets.sets[0]?.missing.join('、')} 个`);
  // 一起选
  const s1 = sampleRss(pid);
  const r = await openAll(pd, s.paths);
  const m1 = s1.stop();
  check(r.added === copies && !r.skipped.length, `一起选:放回 ${r.added} 个,${(r.ms / 1000).toFixed(1)} s;内存 ${m1.base} → 峰值 ${m1.peak} MB`);
  await pd.close();
  await d.close();
}

async function sixty(browser: Browser, dir: string) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.civworld')).map((f) => path.join(dir, f));
  const total = files.reduce((s, f) => s + statSync(f).size, 0);
  say(`\n== ${files.length} 个世界(加起来 ${(total / 1e6).toFixed(1)} MB)`);
  const pid = browserPid();
  const c = await browser.newContext(VIEW);
  const page = await home(c);
  const t0 = Date.now();
  for (const f of files) await keepFile(page, f);
  say(`  一个个放进来 ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const zip = path.join(OUT, 'sixty.civworld');
  const s0 = sampleRss(pid);
  const s = await saveAll(page, zip);
  const m0 = s0.stop();
  check(s.count === files.length && s.whole === files.length, `全部存成文件:${s.whole} 个世界,一个文件 ${(s.size / 1e6).toFixed(1)} MB,${(s.ms / 1000).toFixed(1)} s;内存 ${m0.base} → 峰值 ${m0.peak} MB`);
  await page.close();
  await c.close();
  const d = await browser.newContext(VIEW);
  const pd = await home(d);
  const s1 = sampleRss(pid);
  const r = await openAll(pd, zip);
  const m1 = s1.stop();
  check(r.added === files.length && !r.skipped.length, `干净的浏览器放回 ${r.added} 个,${(r.ms / 1000).toFixed(1)} s;内存 ${m1.base} → 峰值 ${m1.peak} MB`);
  await pd.close();
  await d.close();
}

// ---------------------------------------------------------------------------

if (!existsSync('dist/index.html')) throw new Error('先 pnpm build');
const KINDS = opt('kinds')?.split(',');
const list = kinds().filter((k) => !KINDS || KINDS.includes(k.name));
for (const name of BROWSERS) {
  const browser = await (name === 'webkit' ? webkit : chromium).launch();
  try {
    let good = path.join(OUT, `${name}-AI 正文.civworld`);
    if (ONLY.includes('roundtrip') || ONLY.includes('backup')) {
      const made = await roundtrip(browser, name, ONLY.includes('roundtrip') ? list : list.slice(1, 3));
      if (ONLY.includes('backup')) await backup(browser, name, made);
      good = path.join(OUT, `${name}-${made.at(-1)!.kind.name}.civworld`);
    } else if (ONLY.some((x) => x === 'bad' || x === 'escape') && !existsSync(good)) {
      const c = await browser.newContext(VIEW);
      const p = await c.newPage();
      const k = list[1];
      const id = await openJson(p, k.save, `${name}-seed`);
      await hookReady(p);
      await saveFile(p, id, good);
      await p.close();
      await c.close();
    }
    if (ONLY.includes('bad')) await bad(browser, name, good);
    if (ONLY.includes('escape')) await escape(browser, name, good);
    if (opt('cross')) {
      say(`\n== 别的浏览器存的文件(${name})`);
      const c = await browser.newContext(VIEW);
      const page = await home(c);
      const k = await keepFile(page, opt('cross')!);
      await page.goto(`${BASE}?w=${k.id}`);
      await settle(page);
      check((await page.evaluate(() => (window as any).__wfLoad)) === 'stored', `${path.basename(opt('cross')!)}:打开走存下的内容`);
      await page.close();
      await c.close();
    }
    if (opt('big')) await big(browser, opt('big')!);
    if (opt('sixty')) await sixty(browser, opt('sixty')!);
    if (name === 'chromium' && opt('over')) await over(browser, opt('over')!);
  } finally {
    await browser.close();
  }
}
await srv.close();
say(fails.length ? `\n没过 ${fails.length} 项:\n${fails.map((f) => `  ${f}`).join('\n')}` : '\n全部过了');
process.exit(fails.length ? 1 : 0);

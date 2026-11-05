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
 *   --only=full,trash                 存储真的塞满(默认不跑,要单独点名)。Chromium 用硬盘上的配置,CDP 把这个网站的额度调小再写满(见 limitQuota);
 *                                     调小额度时 estimate 还是说有地方,这时候靠「写不下过」认出满了,「快满了」那条线在 WebKit 上看。
 *                                     WebKit 没有调额度的办法,临时配置不认额度,硬盘上的配置额度跟着用量涨(写到 30 GB 额度 82 GB):
 *   --volume=<文件夹>                 配置放在这个文件夹里(一个配置从头用到尾,塞满了接着用)。WebKit 要给:挂一个 1–2 GB 的小磁盘映像,真的把硬盘写满(hdiutil create -size 2g -fs APFS …、hdiutil attach … -mountpoint …),
 *                                     full、trash 分开跑,各用一个映像。trash 在 WebKit 上写到只剩一点(见 fillDisk)
 *   --huge=<存档 json>               量大世界:先塞满再打开这个存档(什么都存不下),存成文件(线程当场打);放进干净的配置,塞满,改名,再存(只换清单)。打印内存峰值(只在 Chromium)
 *
 * full:  塞满以后改世界、加 AI 正文,存成文件:刚才的改动在文件里,换干净的浏览器打开逐项一样;从没存进去的世界也能存;全部存成文件说得清哪个世界怎么了
 * trash: 塞满以后删世界:撤销提示开着时不清、撤销了世界完整回来;收起以后地方腾出来、能接着存;别的标签页开着时不清
 * roster:(默认不跑)名单丢了认回来,内容逐项一样;删了的、撤销中的、退出登录全清的不回来;两个标签页不重复认
 * roster-disk:(默认不跑,要 --volume 和 --image=<那个映像文件>)硬盘真的写满,删、撤销,重开浏览器(WebKit 的 localStorage 这时才回退),看认得对不对。写满以后靠把映像改大腾地方,每跑一遍映像大约涨 1 GB
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
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, statfsSync, truncateSync, writeFileSync, writeSync } from 'node:fs';
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

function browserPid(profile?: string): number {
  // Playwright 不给 pid:本脚本启动的浏览器是这个进程的子进程;profile = 用这个配置开的那一个
  const rows = execFileSync('ps', ['-axwwo', 'pid=,ppid=,command='], { encoding: 'utf8' }).trim().split('\n');
  for (const l of rows) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l);
    if (m && (profile ? m[3].includes(profile) && !m[3].includes('--type=') : Number(m[2]) === process.pid && /chrom|headless|webkit|playwright|pw_run/i.test(m[3]))) return Number(m[1]);
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
// 存储塞满

type Vault = { latestOf: { n: number; recipeKey: string; content: string } | null };

/** 调检查用的那几样(src/ui/notesCheck.ts) */
const CHECK = `(window.__wfNotes())`;

/**
 * Chromium:这个网站的额度调成 bytes。要在这个网站第一次用 IndexedDB 之前调:连着库的时候 Chromium 记着上次问到的还能存多少,半路调小它要写掉那么多才认。
 * 不调的话额度跟着硬盘走,写到上百 GB 还没满
 */
async function limitQuota(page: Page, name: string, bytes: number): Promise<void> {
  if (name !== 'chromium') return;
  const c = await page.context().newCDPSession(page);
  await c.send('Storage.overrideQuotaForOrigin', { origin: new URL(BASE).origin, quotaSize: bytes });
}

/** 真的写满 IndexedDB:另开一个库写随机的字节,从大块写到小块,一直写到浏览器说写不下。返回写了多少 */
async function fillIdb(page: Page): Promise<number> {
  // tsx 给带名字的函数套一层 __name,页面里没有
  await page.evaluate('globalThis.__name ??= (f) => f');
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('filler', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('x');
      r.onsuccess = () => res(r.result);
      // 硬盘真的满了时 WebKit 连库都打不开:已经满了
      r.onerror = () => res(null);
    });
    if (!db) return 0;
    const put = (k: number, size: number) =>
      new Promise<boolean>((res) => {
        const b = new Uint8Array(size);
        for (let i = 0; i < size; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(i + 65536, size)));
        const t = db.transaction('x', 'readwrite');
        t.objectStore('x').put(b.buffer, k);
        t.oncomplete = () => res(true);
        t.onabort = () => res(false);
        t.onerror = () => res(false);
      });
    let total = 0;
    let n = 0;
    for (const size of [64e6, 16e6, 4e6, 1e6, 256e3, 64e3, 16e3, 4e3]) {
      // 写到这么多还没满就是额度比想的大,别把硬盘写满了
      while (total < 30e9 && (await put(n++, size))) total += size;
    }
    db.close();
    return total;
  });
}

/** 真的写满 localStorage */
function fillLocal(page: Page): Promise<number> {
  return page.evaluate(() => {
    let total = 0;
    let n = 0;
    for (let size = 1 << 20; size >= 1; size >>= 1) {
      const text = 'x'.repeat(size);
      for (;;) {
        try {
          localStorage.setItem(`filler-${n}`, text);
          n++;
          total += size;
        } catch {
          break;
        }
      }
    }
    return total;
  });
}

/** 整段历史的摘要 */
const civSum = (page: Page) => page.evaluate(() => JSON.stringify((window as any).__wfCivSum?.(1e9) ?? null));

/** 提示条(塞满了会提示)挡着截图,藏起来 */
const noToasts = (page: Page) => page.addStyleTag({ content: '.toast{display:none!important}' });

/** 调额度时调成多少:放得下这里用的几个小世界 */
const SMALL_QUOTA = 60e6;

/** 一个新的浏览器配置,在硬盘上(临时配置满了的样子和真的不一样) */
let diskSeq = 0;
/** 最近开的那个配置的文件夹 */
let lastProfile = '';
function freshContext(name: string): Promise<BrowserContext> {
  const dir = path.join(opt('volume') ?? path.join(OUT, 'profiles'), `${name}-${process.pid}-${++diskSeq}`);
  mkdirSync(dir, { recursive: true });
  lastProfile = dir;
  return (name === 'webkit' ? webkit : chromium).launchPersistentContext(dir, VIEW);
}

/** 这个页面所在的网站塞满:IndexedDB,localStorage 看 local(不塞的话,以前塞的腾掉) */
async function fillUp(page: Page, local: boolean): Promise<void> {
  const t = Date.now();
  if (!local) await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('filler-')).forEach((k) => localStorage.removeItem(k)));
  const idb = await fillIdb(page);
  const ls = local ? await fillLocal(page) : 0;
  const e = await page.evaluate(async () => {
    const x = await navigator.storage.estimate();
    return { usage: x.usage ?? 0, quota: x.quota ?? 0 };
  });
  say(`  塞满:IndexedDB 又写了 ${(idb / 1e6).toFixed(1)} MB${local ? `,localStorage 又写了 ${(ls / 1e6).toFixed(1)} M 字`: ''},${((Date.now() - t) / 1000).toFixed(0)} s(占 ${(e.usage / 1e6).toFixed(0)} MB / 额度 ${(e.quota / 1e6).toFixed(0)} MB)`);
}

/**
 * 小磁盘写到只剩 room 字节(从外面写一个大文件,网站占的没变)。一点都不剩时库连提交删除都做不到(见 trash 的说明),只剩一点才是用的人碰到的「快满了」
 */
function fillDisk(dir: string, room: number): void {
  const file = path.join(dir, 'filler.bin');
  const fd = openSync(file, 'a');
  const left = () => {
    const st = statfsSync(dir);
    return st.bavail * st.bsize;
  };
  // 磁盘映像报的剩余不总是准的:写到报错也算写满了
  for (const size of [64e6, 16e6, 4e6, 1e6]) {
    const chunk = randomBytes(size);
    try {
      while (left() > room + size) writeSync(fd, chunk);
    } catch {
      /* 下一档小的接着写 */
    }
  }
  closeSync(fd);
  // 写过头了:退回来一点
  const over = room - left();
  if (over > 0) truncateSync(file, Math.max(0, statSync(file).size - over));
  say(`  硬盘写到只剩 ${(left() / 1e6).toFixed(1)} MB`);
}

/** 真的写得进去吗(另开一个库写一点) */
function canWrite(page: Page, size = 200_000): Promise<boolean> {
  return page.evaluate(
    (sz) =>
      new Promise<boolean>((res) => {
        const r = indexedDB.open('probe', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('x');
        r.onerror = () => res(false);
        r.onblocked = () => res(false);
        r.onsuccess = () => {
          const b = new Uint8Array(sz);
          for (let i = 0; i < sz; i += 65536) crypto.getRandomValues(b.subarray(i, Math.min(i + 65536, sz)));
          const t = r.result.transaction('x', 'readwrite');
          t.objectStore('x').put(b.buffer, 1);
          t.oncomplete = () => {
            // 写得进去:这一点不留着占地方
            const d = r.result.transaction('x', 'readwrite');
            d.objectStore('x').clear();
            d.oncomplete = () => {
              r.result.close();
              res(true);
            };
          };
          t.onabort = () => {
            r.result.close();
            res(false);
          };
        };
      }),
    size,
  );
}

/** 一直问到 f 说行,最多等 ms 毫秒;等到了 = true。(page.waitForFunction 不等 async 的函数:返回的 Promise 算真,问一次就走了) */
async function until(f: () => Promise<boolean>, ms: number): Promise<boolean> {
  const t0 = Date.now();
  for (;;) {
    if (await f()) return true;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 400));
  }
}

/** 等这个世界存进仓库 */
async function vaultHas(page: Page, id: string): Promise<void> {
  if (!(await until(async () => !!(await latest(page, id)), WAIT))) throw new Error(`${id} 一直没存进仓库`);
}

/** 这个世界在仓库里最新的一份;打不开库算没有(硬盘真的满了时 WebKit 连库都打不开) */
const latest = (page: Page, id: string) =>
  page.evaluate(
    async ([c, i]) => {
      const { store } = await eval(c as string);
      return (await store.vaultCall('latestOf', [i]).catch(() => null)) as Vault['latestOf'];
    },
    [CHECK, id],
  );

/** 打开「我的世界」;世界按名字找 */
async function worldsPage(page: Page) {
  await page.goto(BASE);
  await civsTab(page);
}

/** 「我的世界」页签换到「文明」:才看得到一个个世界 */
async function civsTab(page: Page) {
  await page.locator('.mw').first().waitFor({ timeout: 20000 });
  const tab = page.locator('.mw-seg [data-tab=civs]');
  if (await tab.count()) await tab.click();
  await page.locator('.mw [data-act=world-menu]').first().waitFor({ timeout: 20000 }).catch(() => {});
}

/** 从「我的世界」删掉一个世界(真的点界面):id 这个世界那张卡片上的菜单 */
async function deleteInUi(page: Page, title: string) {
  await page.bringToFront();
  const card = page.locator('.mw .mw-card, .mw [data-act=open-world]').filter({ hasText: title }).first();
  await card.waitFor({ timeout: 20000 });
  const row = page.locator('.mw *:has(> [data-act=world-menu])').filter({ hasText: title }).first();
  await row.locator('[data-act=world-menu]').click({ timeout: 5000 });
  await page.locator('[data-act=world-delete]').click({ timeout: 5000 });
  await page.locator('[data-act=world-undelete]').waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
}

const undoOpen = (page: Page) => page.locator('[data-act=world-undelete]').count().then((n) => n > 0);

async function fullStorage(browser: Browser, name: string) {
  say(`\n== 存储塞满了存成文件(${name})`);
  const list = kinds();
  const plain = list.find((k) => k.name === '改名')!;
  const other = list.find((k) => k.name === '干预')!;
  const fresh = list.find((k) => k.name === '作者人物')!;
  const fresh2 = list.find((k) => k.name === '逐年推演')!;
  const small = { ...DEFAULT_PARAMS, seed: 2024, cells: 4000 };
  const civ = generateCiv(generateWorld(small), { endYear: 1000 });
  const ctx = await freshContext(name);
  // 小磁盘只够写满一次:一个配置从头用到尾,已经满了的接着用。不然每一段一个新的
  const shared = !!opt('volume');
  const nextContext = async () => (shared ? ctx : freshContext(name));
  const endContext = async (c: BrowserContext) => {
    if (c !== ctx || !shared) await c.close();
  };
  const page = await ctx.newPage();
  page.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
  await limitQuota(page, name, SMALL_QUOTA);
  const idA = await openJson(page, plain.save, `${name}-full-a`);
  await vaultHas(page, idA);
  await thumbSettled(page, idA);
  const idB = await openJson(page, other.save, `${name}-full-b`);
  await vaultHas(page, idB);
  await page.goto(`${BASE}?w=${idA}`);
  await settle(page);
  const before = await latest(page, idA);
  // AI 正文一条存在仓库里
  await page.evaluate(
    async ([c, i]) => {
      const { notes } = await eval(c as string);
      await notes.notesReady([i]);
      notes.putNote(i, { key: '史书:早', kind: '史书', title: '早', text: '塞满之前写的', createdAt: '2026-11-04T08:00:00.000Z', provider: 'test', model: 't' });
      await notes._notesSettled();
    },
    [CHECK, idA],
  );
  await fillUp(page, true);
  check(!(await canWrite(page)), `${name}:真的写不进去了`);

  say(' 改了世界(改名、干预、AI 正文)再存成文件');
  // 这个世界本来就改过名的那一国再改一次(换了历史也认得出来)
  const b = polityKey(civ, civ.polities[0].id);
  const newName = '只在页面里的王朝';
  await page.evaluate(
    async ([c, i, polity, title]) => {
      const { saves, notes } = await eval(c as string);
      const e = saves.getEdits();
      saves.setEdits({ ...e, names: { ...e.names, [`polity:${polity}`]: title }, interventions: [...e.interventions, { kind: 'protect', a: polity, from: 200, until: 800 }] });
      notes.putNote(i, { key: '史书:新', kind: '史书', title: '新', text: '塞满以后写的', createdAt: '2026-11-04T09:00:00.000Z', provider: 'test', model: 't' });
    },
    [CHECK, idA, b, newName],
  );
  await page.waitForTimeout(4000);
  await settle(page);
  // 重推完时间轴停在改的那一年;打开文件时在最后一年,比的时候对齐
  await page.evaluate(async (c) => (await eval(c)).saves.setCivTime({ year: null, playing: false }), CHECK);
  await page.waitForTimeout(1500);
  const state = await page.evaluate(
    async ([c, i]) => {
      const { saves, notes } = await eval(c as string);
      return { unsaved: saves.currentUnsaved(), behind: notes.notesBehind(i), stored: JSON.stringify(saves.loadWorld(i)?.save.edits.names ?? {}) };
    },
    [CHECK, idA],
  );
  check(state.unsaved && !state.stored.includes(newName), `${name}:改动只在页面里(存档没写进去)`);
  const after = await latest(page, idA);
  check(after?.recipeKey === before?.recipeKey, `${name}:仓库里还是改之前的`);
  await noToasts(page);
  const civA = await civSum(page);
  writeFileSync(path.join(OUT, `${name}-full-whole-a.png`), await page.screenshot());
  const sa = await seen(page);
  const fileA = path.join(OUT, `${name}-full-a.civworld`);
  const r = await saveFile(page, idA, fileA);
  check(!r.stale, `${name}:存成文件没有落后(${(statSync(fileA).size / 1e6).toFixed(2)} MB,${Math.round(r.ms)} ms)`);

  const clean = await browser.newContext(VIEW);
  const pc = await home(clean);
  const kept = await keepFile(pc, fileA);
  await pc.goto(`${BASE}?w=${kept.id}`);
  await settle(pc);
  await noToasts(pc);
  check((await civSum(pc)) === civA, `${name}:整段历史一样(${civA})`);
  writeFileSync(path.join(OUT, `${name}-full-whole-b.png`), await pc.screenshot());
  const sb = await seen(pc);
  check(sb.load === 'stored', `${name}:干净的浏览器打开走文件里的内容(${sb.load})`);
  const dMap = pngDiff(sa.map, sb.map);
  const dZoom = pngDiff(sa.zoom, sb.zoom);
  writeFileSync(path.join(OUT, `${name}-full-zoom-a.png`), sa.zoom);
  writeFileSync(path.join(OUT, `${name}-full-zoom-b.png`), sb.zoom);
  check(dMap === 0, `${name}:地图逐像素一样(差 ${dMap})`);
  check(dZoom === 0, `${name}:放大细部逐像素一样(差 ${dZoom})`);
  check(sa.countries === sb.countries && sa.countries.length > 20, `${name}:历史、人口一样`);
  check((await pc.evaluate(([c, i]) => (window as any).__wfNotes().then((m: any) => JSON.stringify(m.saves.loadWorld(i)?.save.edits.names ?? {})), [CHECK, kept.id])).includes(newName), `${name}:新名字在`);
  if (sa.countries !== sb.countries) {
    writeFileSync(path.join(OUT, `${name}-full-countries-a.txt`), sa.countries);
    writeFileSync(path.join(OUT, `${name}-full-countries-b.txt`), sb.countries);
  }
  check(sa.flags === sb.flags, `${name}:国旗一样`);
  check(sa.chronicle === sb.chronicle, `${name}:编年史一样`);
  check(sa.probes === sb.probes, `${name}:地块读数一样`);
  const notesB = await pc.evaluate(async (i) => {
    const lib = (await (window as any).__wfNotes()).notes;
    await lib.notesReady([i]);
    return (lib.exportNotes(i) as { key: string }[]).map((n) => n.key).sort();
  }, kept.id);
  check(notesB.join() === '史书:新,史书:早', `${name}:AI 正文都在,塞满以后写的也在(${notesB.join()})`);
  const madeBack = (await openWorldFile(new Uint8Array(readFileSync(fileA)), { readers: { ...READER_VERSIONS } })).manifest;
  check(madeBack.made.generator === GENERATOR_VERSION && !!madeBack.made.at && madeBack.readers.terrain === READER_VERSIONS.terrain && madeBack.recipe.edits.interventions.length === 1, `${name}:文件里的版本、读取规则、配方写对了`);

  say(' 全部存成文件');
  // 没开着的世界 C:存档在,内容从没存进仓库(下面塞满以后才放进来)
  const all = await page.evaluate(async (wf) => {
    const m = await eval(wf);
    const out = await m.saveAllWorldFiles();
    if (!out.ok) return { error: out.kind };
    (window as any).__blobs.all = out.files[0].file;
    return { whole: out.whole, count: out.count, recipeOnly: out.recipeOnly, left: out.left, behind: out.behind };
  }, WF);
  check(!('error' in all) && all.whole === 2 && !all.behind.length && !all.left.length, `${name}:两个世界都带着完整内容(${JSON.stringify(all)})`);
  const allFile = path.join(OUT, `${name}-full-all.civworld`);
  await download(page, 'all', allFile);
  const pc2 = await home(await browser.newContext(VIEW));
  const restored = await openAll(pc2, allFile);
  check(restored.added === 2 && !restored.skipped.length, `${name}:干净的浏览器放回 ${restored.added} 个`);
  await page.close();
  await endContext(ctx);
  await pc.close();
  await clean.close();
  await pc2.context().close();

  for (const kind of [fresh, fresh2, list.find((k) => k.name === '地形大事')!]) {
    say(` 从没存进去的世界:${kind.name}`);
    const tag = `${name}:${kind.name}`;
    const c2 = await nextContext();
    const p2 = await c2.newPage();
    p2.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
    await limitQuota(p2, name, SMALL_QUOTA);
    await p2.goto(BASE);
    await hookReady(p2);
    await fillUp(p2, true);
    check(!(await canWrite(p2)), `${tag}:真的写不进去了`);
    const json = path.join(OUT, `${name}-full-never-${kind.name}.json`);
    writeFileSync(json, JSON.stringify(kind.save));
    await p2.goto(BASE);
    await p2.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
    await p2.setInputFiles('[data-testid=save-file-input]', json);
    await p2.waitForFunction(() => (window as any).__wf?.ready && (window as any).__wfCiv?.ready, null, { timeout: WAIT });
    await p2.waitForTimeout(3000);
    const never = await p2.evaluate(async (c) => {
      const { saves, store } = await eval(c);
      const id = saves.currentWorld()?.id as string;
      // 硬盘真的满了时 WebKit 连库都打不开
      return { id, stored: !!saves.loadWorld(id), vault: !!(await store.vaultCall('latestOf', [id]).catch(() => null)), unsaved: saves.currentUnsaved() };
    }, CHECK);
    check(!never.stored && !never.vault, `${tag}:浏览器里什么都没存下(${JSON.stringify(never)})`);
    await noToasts(p2);
    const civN = await civSum(p2);
    // 地形大事那几段的主图在后台铺:等它铺好再比(打开文件那边也一样)
    await p2.waitForTimeout(3000);
    const sn = await seen(p2);
    const fileN = path.join(OUT, `${name}-full-never-${kind.name}.civworld`);
    const rn = await saveFile(p2, never.id, fileN);
    check(!rn.stale, `${tag}:从没存进去的世界存成文件(${(statSync(fileN).size / 1e6).toFixed(2)} MB,${Math.round(rn.ms)} ms)`);
    const c3 = await browser.newContext(VIEW);
    const p3 = await home(c3);
    const kn = await keepFile(p3, fileN);
    await p3.goto(`${BASE}?w=${kn.id}`);
    await settle(p3);
    await noToasts(p3);
    check((await civSum(p3)) === civN, `${tag}:整段历史一样(${civN})`);
    const sm = await seen(p3);
    check(sm.load === 'stored', `${tag}:打开走文件里的内容(${sm.load})`);
    const dNeverMap = pngDiff(sn.map, sm.map);
    check(dNeverMap === 0, `${tag}:地图逐像素一样(差 ${dNeverMap})`);
    const dNever = pngDiff(sn.zoom, sm.zoom);
    writeFileSync(path.join(OUT, `${name}-never-${kind.name}-zoom-a.png`), sn.zoom);
    writeFileSync(path.join(OUT, `${name}-never-${kind.name}-zoom-b.png`), sm.zoom);
    check(dNever === 0, `${tag}:放大细部逐像素一样(差 ${dNever})`);
    check(sn.countries === sm.countries && sn.chronicle === sm.chronicle && sn.flags === sm.flags && sn.probes === sm.probes, `${tag}:历史、国旗、编年史、读数一样`);

    // 全部存成文件:改过、写不进去的这个不在列表里也带上
    const edited = await p2.evaluate(async (c) => {
      const { saves } = await eval(c);
      const e = saves.getEdits();
      saves.setEdits({ ...e, names: { ...e.names, 'polity:页面里': '也带上' } });
      const w = saves.currentWorld();
      return { kind: w?.kind, unsaved: w?.unsaved, gone: w?.gone, stored: !!saves.loadWorld(w?.id) };
    }, CHECK);
    await p2.waitForTimeout(500);
    const allNever = await p2.evaluate(async (wf) => {
      const m = await eval(wf);
      const out = await m.saveAllWorldFiles();
      return out.ok ? { whole: out.whole, count: out.count, left: out.left, behind: out.behind } : { error: out.kind };
    }, WF);
    say(`  改过以后:${JSON.stringify(edited)}`);
    check(!('error' in allNever) && allNever.whole >= 1 && !allNever.behind.length && !allNever.left.length, `${tag}:全部存成文件带上了它(${JSON.stringify(allNever)})`);
    await p2.close();
    await endContext(c2);
    await p3.close();
    await c3.close();
  }

  if (!shared) {
  say(' 地图留着的世界:塞满以后换了历史');
  const cm = await freshContext(name);
  const pm = await cm.newPage();
  pm.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
  await limitQuota(pm, name, SMALL_QUOTA);
  const idM = await openJson(pm, plain.save, `${name}-full-m`);
  await vaultHas(pm, idM);
  const copied = await pm.evaluate((i) => (window as any).__wfKeepMapCopy(i), idM);
  check(copied.ok, `${name}:另存了一份,地图不变(${JSON.stringify(copied).slice(0, 80)})`);
  await pm.goto(`${BASE}?w=${copied.id}`);
  await settle(pm);
  const mapBefore = (await latest(pm, copied.id))!;
  await fillUp(pm, true);
  await pm.evaluate(
    async ([c, polity]) => {
      const { saves } = await eval(c as string);
      const e = saves.getEdits();
      saves.setEdits({ ...e, interventions: [...e.interventions, { kind: 'protect', a: polity, from: 200, until: 800 }] });
    },
    [CHECK, polityKey(civ, civ.polities[0].id)],
  );
  await pm.waitForTimeout(4000);
  await settle(pm);
  await pm.evaluate(async (c) => (await eval(c)).saves.setCivTime({ year: null, playing: false }), CHECK);
  await pm.waitForTimeout(1000);
  check((await latest(pm, copied.id))?.recipeKey === mapBefore.recipeKey, `${name}:仓库里还是改之前的`);
  await noToasts(pm);
  const civM = await civSum(pm);
  const fileM = path.join(OUT, `${name}-full-m.civworld`);
  const rm = await saveFile(pm, copied.id, fileM);
  check(!rm.stale, `${name}:存成文件没有落后(${(statSync(fileM).size / 1e6).toFixed(2)} MB,${Math.round(rm.ms)} ms)`);
  const mo = await openWorldFile(new Uint8Array(readFileSync(fileM)), { readers: { ...READER_VERSIONS } });
  check(!!mo.manifest.recipe.edits.map && mo.manifest.recipe.edits.interventions.length > 0, `${name}:文件里还是地图留着的世界,新的干预在`);
  const cm2 = await browser.newContext(VIEW);
  const pm2 = await home(cm2);
  const km = await keepFile(pm2, fileM);
  await pm2.goto(`${BASE}?w=${km.id}`);
  await settle(pm2);
  check((await pm2.evaluate(() => String((window as any).__wfLoad))) === 'stored', `${name}:打开走文件里的内容`);
  check((await civSum(pm2)) === civM, `${name}:整段历史一样(${civM})`);
  await pm2.close();
  await cm2.close();
  await pm.close();
  await cm.close();
  }

  // 硬盘真的满了时 WebKit 的 localStorage 写了也会丢,存档留不住,这种世界没有:见单测和 Chromium
  if (!shared) {
  say(' 没开着、内容从没存进去的世界');
  const c4 = await nextContext();
  const p4 = await c4.newPage();
  p4.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
  await limitQuota(p4, name, SMALL_QUOTA);
  await p4.goto(BASE);
  await hookReady(p4);
  // 只塞满 IndexedDB:存档写得进 localStorage,内容写不进仓库
  await fillUp(p4, false);
  const idC = await openJson(p4, fresh2.save, `${name}-full-c`);
  await p4.goto(BASE);
  await hookReady(p4);
  await p4.waitForTimeout(1000);
  const cState = await p4.evaluate(
    async ([c, i]) => {
      const { saves, store } = await eval(c as string);
      // 硬盘真的满了时 WebKit 连库都打不开
      return { open: saves.currentWorld()?.id ?? null, stored: !!saves.loadWorld(i), vault: !!(await store.vaultCall('latestOf', [i]).catch(() => null)) };
    },
    [CHECK, idC],
  );
  check(cState.stored && !cState.vault && cState.open !== idC, `${name}:存档在,内容不在,也没开着(${JSON.stringify(cState)})`);
  const fileC = path.join(OUT, `${name}-full-c.civworld`);
  const rc = await saveFile(p4, idC, fileC);
  check(!rc.stale, `${name}:现算一遍装成文件(${(statSync(fileC).size / 1e6).toFixed(2)} MB,${Math.round(rc.ms)} ms)`);
  const c5 = await browser.newContext(VIEW);
  const p5 = await home(c5);
  const kc = await keepFile(p5, fileC);
  await p5.goto(`${BASE}?w=${kc.id}`);
  await settle(p5);
  check((await p5.evaluate(() => String((window as any).__wfLoad))) === 'stored', `${name}:打开走文件里的内容`);
  await p5.close();
  await c5.close();
  await p4.close();
  await c4.close();
  }
  await ctx.close();
}

async function trashFull(name: string) {
  say(`\n== 删世界(${name})`);
  const list = kinds();
  const ctx = await freshContext(name);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
  await limitQuota(page, name, SMALL_QUOTA);
  const a = list.find((k) => k.name === '改名')!;
  const b = list.find((k) => k.name === '干预')!;
  const k3 = list.find((k) => k.name === '作者人物')!;
  const t4 = list.find((k) => k.name === '逐年推演')!;
  const idA = await openJson(page, a.save, `${name}-trash-a`);
  await vaultHas(page, idA);
  const idB = await openJson(page, b.save, `${name}-trash-b`);
  await vaultHas(page, idB);
  const idK = await openJson(page, k3.save, `${name}-trash-k`);
  await vaultHas(page, idK);
  const idT = await openJson(page, t4.save, `${name}-trash-t`);
  await vaultHas(page, idT);
  const usageOf = (p: Page) => p.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0);
  const clearNow = (p: Page) => p.evaluate(async (c) => (await eval(c)).store.clearTrashNow(), CHECK) as Promise<{ cleared: string[]; kept: string[] }>;

  // 几个标签页的事和满不满无关,先看(硬盘真的满了时 WebKit 的 localStorage 不可靠,几个标签页之间对不上)
  say(' 别的标签页不抢:这边提示开着,那边要清');
  await worldsPage(page);
  const other = await ctx.newPage();
  await other.goto(BASE);
  await hookReady(other);
  await deleteInUi(page, t4.save.title!);
  check(await undoOpen(page), `${name}:撤销提示开着`);
  await page.waitForTimeout(3200);
  check(await undoOpen(page), `${name}:撤销提示还开着`);
  const cl2 = await clearNow(other);
  check(!cl2.cleared.length && cl2.kept.includes(idT), `${name}:别的标签页「现在清掉」也不动它`);
  check(!!(await latest(page, idT)), `${name}:内容还在`);
  await page.locator('[data-act=world-undelete]').click({ timeout: 5000 });
  await page.waitForTimeout(500);
  check((await page.evaluate((i) => !!localStorage.getItem(`wenming-ditu:world:${i}`), idT)) && !!(await latest(page, idT)), `${name}:撤销了,存档、内容都在`);

  say(' 别的标签页开着它');
  await page.goto(`${BASE}?w=${idT}`);
  await settle(page);
  await worldsPage(other);
  await deleteInUi(other, t4.save.title!);
  await other.waitForFunction(() => !document.querySelector('[data-act=world-undelete]'), null, { timeout: 30000 });
  await other.waitForTimeout(3500);
  const cl3 = await clearNow(other);
  check(!cl3.cleared.includes(idT) && !!(await latest(other, idT)), `${name}:别的标签页还开着它,不清`);
  const fileT = path.join(OUT, `${name}-trash-t.civworld`);
  const rt = await saveFile(page, idT, fileT);
  check(!rt.stale, `${name}:别的标签页删了,这边还能存成文件(${(statSync(fileT).size / 1e6).toFixed(2)} MB)`);
  await page.goto(BASE);
  await hookReady(page);
  await other.waitForTimeout(2000);
  const cl4 = await clearNow(other);
  check(cl4.cleared.includes(idT) && !(await latest(other, idT)), `${name}:那边不开了,清得掉`);
  await other.close();

  // 开着 K,塞满,改名写不进去(这个页面知道满了),再回「我的世界」(不刷新)
  say(' 塞满');
  await page.goto(`${BASE}?w=${idK}`);
  await settle(page);
  // WebKit 上写到一点不剩时,库连提交删除都做不到:世界清不掉、也不丢,等硬盘有了地方。这里看「只剩一点」(小的写得进,大的写不进)
  const volume = opt('volume');
  if (volume) fillDisk(volume, 8e6);
  else await fillUp(page, false);
  check(!(await canWrite(page, volume ? 40e6 : 200e3)), `${name}:真的写不进去了`);
  const renamed = '满的时候改的名字';
  await page.evaluate(
    async ([c, title]) => {
      const { saves } = await eval(c as string);
      const e = saves.getEdits();
      saves.setEdits({ ...e, names: { ...e.names, 'polity:c9#9': title } });
    },
    [CHECK, renamed],
  );
  // 配方以外的改动停 3 秒才写
  await page.waitForTimeout(4500);
  const namesInVault = (i: string) =>
    page.evaluate(
      async ([c, x]) => {
        const { store } = await eval(c as string);
        const r = await store.vaultCall('readRevision', [x, undefined, []]);
        return JSON.stringify(r?.manifest.recipe.edits.names ?? {});
      },
      [CHECK, i],
    );
  // WebKit 上刚清掉的世界腾出来的地方这个库还能接着用,写得进这一点点:那就不算写不下
  const inVault = (await namesInVault(idK)).includes(renamed);
  if (!opt('volume')) check(!inVault, `${name}:改名没写进仓库`);
  else say(`  改名${inVault ? '写进去了(库里还有清掉的世界腾出来的地方)' : '没写进去'}`);
  // 写一大段 AI 正文(压不小的):写不下,这个页面就知道满了
  await page.evaluate(
    async ([c, i, n]) => {
      const { notes } = await eval(c as string);
      await notes.notesReady([i]);
      const b = new Uint8Array(n as number);
      for (let k = 0; k < b.length; k += 65536) crypto.getRandomValues(b.subarray(k, Math.min(k + 65536, b.length)));
      notes.putNote(i, { key: '史书:长', kind: '史书', title: '长', text: Array.from(b, (x) => x.toString(36)).join(''), createdAt: '2026-11-04T09:00:00.000Z', provider: 'test', model: 't' });
    },
    [CHECK, idK, volume ? 20e6 : 3e6],
  );
  check(await until(() => page.evaluate(async (c) => (await eval(c)).store.vaultIsFull() as boolean, CHECK), 30000), `${name}:页面知道写不下了`);
  await page.getByText('我的世界', { exact: true }).first().click({ timeout: 5000 });
  await civsTab(page);

  const info0 = await page.evaluate(async (c) => (await eval(c)).store.trashInfo(), CHECK);
  check(info0.count === 0 && info0.bytes === 0 && info0.clearBy === null, `${name}:没有删掉的世界时是空的`);

  say(' 满了时删,撤销提示开着');
  const u0 = await usageOf(page);
  await deleteInUi(page, a.save.title!);
  check(await undoOpen(page), `${name}:撤销提示开着`);
  const info1 = await page.evaluate(async (c) => (await eval(c)).store.trashInfo(), CHECK);
  check(info1.count === 1 && info1.bytes > 100_000 && info1.held === 1 && info1.clearBy > Date.now() + 29 * 86400_000, `${name}:占多少、几个、哪天清掉都说得出(${JSON.stringify(info1)})`);
  const cl = await clearNow(page);
  check(!cl.cleared.length && cl.kept.includes(idA), `${name}:提示开着时「现在清掉」不动它`);
  check(!!(await latest(page, idA)), `${name}:内容还在`);
  await page.locator('[data-act=world-undelete]').click({ timeout: 5000 });
  await page.waitForTimeout(500);
  check((await page.evaluate((i) => !!localStorage.getItem(`wenming-ditu:world:${i}`), idA)) && !!(await latest(page, idA)), `${name}:撤销了,存档、内容都在`);
  check(!(await page.evaluate(async ([c, i]) => (i as string) in (await eval(c as string)).saves.trashMarks(), [CHECK, idA])), `${name}:撤销了不再算删掉的世界`);
  const headA = await page.evaluate(
    async ([c, i]) => {
      const { store } = await eval(c as string);
      const r = await store.vaultCall('readRevision', [i]);
      return { parts: r?.parts.length ?? 0, content: r?.head.content };
    },
    [CHECK, idA],
  );
  check(headA.parts >= 4, `${name}:撤销回来的世界各块都读得出来(${headA.parts} 块)`);

  // 硬盘真的满了时 WebKit 的 localStorage 写了也会丢,腾 localStorage 时存档跟着回退:这一段只在 Chromium 上看
  if (!opt('volume')) {
  say(' localStorage 也满了:删了再撤销');
  await fillLocal(page);
  await deleteInUi(page, a.save.title!);
  check(await undoOpen(page), `${name}:撤销提示开着`);
  await page.locator('[data-act=world-undelete]').click({ timeout: 5000 });
  await page.waitForTimeout(500);
  check((await page.evaluate((i) => !!localStorage.getItem(`wenming-ditu:world:${i}`), idA)) && !!(await latest(page, idA)), `${name}:放得回去,存档、内容都在`);
  await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('filler-')).forEach((k) => localStorage.removeItem(k)));
  }

  say(' 撤销提示收起');
  const lookNow = () =>
    page.evaluate(
      async ([c, i]) => {
        const { saves, store } = await eval(c as string);
        return { stored: !!saves.loadWorld(i), marked: (i as string) in saves.trashMarks(), full: store.vaultIsFull(), toast: document.querySelector('.toast-main')?.textContent ?? null };
      },
      [CHECK, idA],
    );
  await deleteInUi(page, a.save.title!);
  say(`  删之后:${JSON.stringify(await lookNow())}`);
  check(await undoOpen(page), `${name}:撤销提示开着`);
  check(!!(await latest(page, idA)), `${name}:提示开着,内容还在`);
  await page.waitForFunction(() => !document.querySelector('[data-act=world-undelete]'), null, { timeout: 30000 });
  say(`  收起:${JSON.stringify(await lookNow())}`);
  const t1 = Date.now();
  const emptied = await until(async () => !(await latest(page, idA)), 30000);
  check(emptied, `${name}:提示收起以后内容清掉了(${((Date.now() - t1) / 1000).toFixed(1)} s)`);
  await page.waitForTimeout(1500);
  const u1 = await usageOf(page);
  say(`  占的地方 ${(u0 / 1e6).toFixed(1)} → ${(u1 / 1e6).toFixed(1)} MB`);
  // WebKit 把块存在库文件里,删了文件不变小,腾出来的地方这个库接着用(下面「接着存」看得到),别的库用不上,所以这两样只在 Chromium 上看
  if (!opt('volume')) {
    check(u1 < u0, `${name}:占的地方少了`);
    check(await canWrite(page), `${name}:腾出了地方,写得进去了`);
  }
  check(!!(await latest(page, idB)), `${name}:别的世界一点没动`);
  const info2 = await page.evaluate(
    async ([c, i]) => {
      const { saves, store } = await eval(c as string);
      return { ...(await store.trashInfo()), marks: Object.keys(saves.trashMarks()).length, marked: (i as string) in saves.trashMarks() };
    },
    [CHECK, idA],
  );
  check(info2.count === 0, `${name}:删掉的世界空了(${JSON.stringify(info2)})`);

  say(' 接着存');
  // 满的时候写不进去的改名,腾出地方后自己补上(再转一遍,闲下来才转)
  const t2 = Date.now();
  const filled = await until(async () => (await namesInVault(idK)).includes(renamed), 90000);
  check(filled, `${name}:满的时候的改名补进仓库了(${((Date.now() - t2) / 1000).toFixed(1)} s)`);
  await page.close();
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 名单丢了

const WORLD_KEYS = ['wenming-ditu:world:', 'wenming-ditu:thumb:', 'wenming-ditu:meta:', 'wenming-ditu:mapthumb:', 'wenming-ditu:orig:', 'civ-atlas:ai-notes:'];

/** 名单上少了这几个世界 */
const lose = (page: Page, ids: string[]) => page.evaluate(([keys, list]) => (list as string[]).forEach((id) => (keys as string[]).forEach((p) => localStorage.removeItem(p + id))), [WORLD_KEYS, ids]);

const listed = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('wenming-ditu:world:')).map((k) => k.slice('wenming-ditu:world:'.length)));

const trashOf = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('civ-atlas:trash') ?? '{}') as Record<string, number>);

const allLocal = (page: Page) => page.evaluate(() => JSON.stringify(Object.entries(localStorage)));

/** localStorage 回退到以前的样子(硬盘真满时 WebKit 重开浏览器就是这样) */
const rollBack = (page: Page, text: string) =>
  page.evaluate((t) => {
    localStorage.clear();
    for (const [k, v] of JSON.parse(t) as [string, string][]) localStorage.setItem(k, v);
  }, text);

/** 首页上「我的世界」文明页签的卡片有几张 */
const cardCount = async (page: Page, title: string) => {
  await civsTab(page);
  return page.locator('.mw *:has(> [data-act=world-menu])').filter({ hasText: title }).count();
};

/** 等列表上有这几个世界 */
const untilListed = (page: Page, ids: string[], ms = 30000) => until(async () => (await page.evaluate(([list]) => (list as string[]).every((id) => !!localStorage.getItem(`wenming-ditu:world:${id}`)), [ids])), ms);

/** 建一个世界,内容、封面都写进仓库 */
async function makeStored(page: Page, k: Kind, tag: string): Promise<string> {
  const id = await openJson(page, k.save, `${tag}-${k.name}`);
  await vaultHas(page, id);
  if (k.note) {
    await page.evaluate(
      async ([c, i, n]) => {
        const { notes } = await eval(c as string);
        await notes.notesReady([i]);
        notes.putNote(i, n);
        await notes._notesSettled();
      },
      [CHECK, id, AI_NOTE] as const,
    );
  }
  await thumbSettled(page, id);
  // 封面、现存几国写进新清单:配方以外的改动停 3 秒才写
  await page.waitForTimeout(4000);
  return id;
}

/** 名单上的这一行 + 打开看到的全部 */
interface Whole {
  title?: string;
  alive?: number;
  thumb: string | null;
  notes: string;
  seen: Seen;
}

async function wholeOf(page: Page, id: string): Promise<Whole> {
  await page.goto(`${BASE}?w=${id}`);
  await settle(page);
  const row = await page.evaluate(
    async ([c, i]) => {
      const { saves, notes } = await eval(c as string);
      await notes.notesReady([i]);
      const w = saves.loadWorld(i);
      return { title: w?.save.title as string | undefined, alive: w?.alive as number | undefined, thumb: (w?.thumb ?? null) as string | null, notes: JSON.stringify(notes.exportNotes(i)) };
    },
    [CHECK, id],
  );
  return { ...row, seen: await seen(page) };
}

function sameWhole(a: Whole, b: Whole, what: string) {
  check(b.seen.load === 'stored', `${what}:打开走存下的内容(${b.seen.load})`);
  check(a.title === b.title && a.alive === b.alive && a.thumb === b.thumb && !!b.thumb, `${what}:名字、现存几国、封面一样(${b.title},${b.alive} 国,封面 ${b.thumb?.length ?? 0} 字)`);
  const dMap = pngDiff(a.seen.map, b.seen.map);
  const dZoom = pngDiff(a.seen.zoom, b.seen.zoom);
  check(dMap === 0, `${what}:地图逐像素一样(差 ${dMap})`);
  check(dZoom === 0, `${what}:放大细部逐像素一样(差 ${dZoom})`);
  check(a.seen.countries === b.seen.countries && a.seen.countries.length > 20, `${what}:历史、人口一样`);
  check(a.seen.flags === b.seen.flags, `${what}:国旗一样`);
  check(a.seen.chronicle === b.seen.chronicle, `${what}:编年史一样`);
  check(a.seen.probes === b.seen.probes, `${what}:地块读数一样`);
  check(a.notes === b.notes, `${what}:AI 正文一样(${b.notes.length} 字)`);
}

/** 过这么久,首页、主程序该认的都认完了 */
const ROSTER_SETTLE = 6000;

async function rosterCheck(browser: Browser, name: string) {
  say(`\n== 名单丢了(${name})`);
  const list = kinds();
  const pick = (n: string) => list.find((k) => k.name === n)!;
  const ctx = await browser.newContext(VIEW);
  const page = await home(ctx);
  await page.waitForTimeout(3000);
  check(!(await page.evaluate(async () => (await indexedDB.databases()).some((x) => x.name === 'civ-atlas:worlds'))), `${name}:第一次打开首页,看一眼不把库建出来`);
  const a = pick('改名');
  const b = pick('干预');
  const c = pick('AI 正文');
  const d = pick('逐年推演');
  const idA = await makeStored(page, a, `${name}-roster`);
  const idB = await makeStored(page, b, `${name}-roster`);
  const idC = await makeStored(page, c, `${name}-roster`);
  const idD = await makeStored(page, d, `${name}-roster`);
  const wholeA = await wholeOf(page, idA);
  const wholeC = await wholeOf(page, idC);
  const wholeD = await wholeOf(page, idD);

  say(' 名单少了几个(只开首页)');
  await page.goto(BASE);
  await hookReady(page);
  await lose(page, [idA, idC, idD]);
  await page.goto(BASE);
  check(await untilListed(page, [idA, idC, idD]), `${name}:回到了列表`);
  check((await cardCount(page, a.save.title!)) === 1 && (await cardCount(page, c.save.title!)) === 1 && (await cardCount(page, b.save.title!)) === 1, `${name}:卡片上看得到,一个一张`);
  sameWhole(wholeA, await wholeOf(page, idA), `${name}:改名的世界`);
  sameWhole(wholeC, await wholeOf(page, idC), `${name}:有 AI 正文的世界`);
  sameWhole(wholeD, await wholeOf(page, idD), `${name}:逐年推演的世界`);

  say(' 网址直接打开丢了的世界');
  await page.goto(BASE);
  await hookReady(page);
  await lose(page, [idA]);
  await page.goto(`${BASE}?w=${idA}`);
  await page.locator('.mw').first().waitFor({ timeout: 20000 });
  check(await untilListed(page, [idA]), `${name}:先回到「我的世界」,过一会儿列表上有了`);

  say(' localStorage 整个清了');
  await page.goto(BASE);
  await hookReady(page);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  check(await untilListed(page, [idA, idB, idC, idD]), `${name}:全部回来了`);
  check((await listed(page)).length === 4, `${name}:没有多出来的`);
  sameWhole(wholeC, await wholeOf(page, idC), `${name}:有 AI 正文的世界`);

  say(' 删了的,提示收起');
  await page.goto(BASE);
  await civsTab(page);
  await deleteInUi(page, b.save.title!);
  await page.waitForFunction(() => !document.querySelector('[data-act=world-undelete]'), null, { timeout: 30000 });
  await page.waitForTimeout(300);
  const markB = (await trashOf(page))[idB];
  await page.goto(BASE);
  await page.waitForTimeout(ROSTER_SETTLE);
  check(!(await listed(page)).includes(idB), `${name}:刷新了不回来`);
  await page.evaluate(() => localStorage.removeItem('civ-atlas:trash'));
  await page.goto(BASE);
  check(await until(async () => (await trashOf(page))[idB] === markB, 15000), `${name}:删除记录丢了:仓库里的那一笔补回来,时间还是原来的`);
  check(!(await listed(page)).includes(idB) && (await cardCount(page, b.save.title!)) === 0, `${name}:删除记录丢了也不回来`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(BASE);
  check(await untilListed(page, [idA, idC, idD]), `${name}:整个清了,别的世界回来了`);
  await page.waitForTimeout(1000);
  check(!(await listed(page)).includes(idB), `${name}:整个清了,删的这个不回来`);

  say(' 撤销中');
  await page.goto(BASE);
  await civsTab(page);
  await deleteInUi(page, d.save.title!);
  check(await undoOpen(page), `${name}:撤销提示开着`);
  const other = await ctx.newPage();
  await other.goto(BASE);
  await hookReady(other);
  const r1 = (await other.evaluate(async (x) => (await eval(x)).store.rescueLostWorlds(), CHECK)) as { rescued: string[] };
  check(!r1.rescued.includes(idD) && !(await listed(other)).includes(idD), `${name}:别的标签页对一遍:不回来`);
  check(!!(await latest(other, idD)), `${name}:内容还在`);
  await other.close();
  await page.goto(BASE);
  await page.waitForTimeout(ROSTER_SETTLE);
  check(!(await listed(page)).includes(idD), `${name}:没等提示收起就刷新:不回来`);
  await page.evaluate(() => localStorage.removeItem('civ-atlas:trash'));
  await page.goto(BASE);
  await page.waitForTimeout(ROSTER_SETTLE);
  check(!(await listed(page)).includes(idD), `${name}:记录也丢了:还是不回来`);

  say(' 撤销了,记录被回退');
  await page.goto(BASE);
  await civsTab(page);
  await deleteInUi(page, a.save.title!);
  check(await undoOpen(page), `${name}:撤销提示开着`);
  await page.waitForTimeout(300);
  const deleted = await allLocal(page);
  await page.locator('[data-act=world-undelete]').click({ timeout: 5000 });
  await page.waitForTimeout(800);
  check((await listed(page)).includes(idA), `${name}:撤销了`);
  // 回退以后、认回来之前,清理走一遍
  await page.goto(BASE);
  await hookReady(page);
  await rollBack(page, deleted);
  const held = (await page.evaluate(async (x) => {
    const { store } = await eval(x);
    await store.maintain(0);
    return store.clearTrashNow();
  }, CHECK)) as { cleared: string[] };
  check(!held.cleared.includes(idA) && !!(await latest(page, idA)), `${name}:到期清理、「现在清掉」都不清它`);
  await page.goto(BASE);
  check(await untilListed(page, [idA]), `${name}:认回来了`);
  check(!(idA in (await trashOf(page))), `${name}:删除记录划掉了`);
  sameWhole(wholeA, await wholeOf(page, idA), `${name}:撤销回来的世界`);

  say(' 什么记号都没有');
  await page.goto(BASE);
  await hookReady(page);
  await page.evaluate(async ([x, i]) => (await eval(x as string)).store.vaultCall('patchState', [i, { listed: undefined, alive: undefined }]), [CHECK, idC]);
  await lose(page, [idC]);
  await page.goto(BASE);
  await page.waitForTimeout(ROSTER_SETTLE);
  check(!(await listed(page)).includes(idC) && !!(await latest(page, idC)), `${name}:不认,也不清`);

  say(' 两个标签页同时开');
  await lose(page, [idA]);
  const [t1, t2] = await Promise.all([ctx.newPage(), ctx.newPage()]);
  await Promise.all([t1.goto(BASE), t2.goto(BASE)]);
  check(await untilListed(t1, [idA]), `${name}:认回来了`);
  await t1.waitForTimeout(2000);
  check((await cardCount(t1, a.save.title!)) === 1, `${name}:这边一张卡片`);
  check((await cardCount(t2, a.save.title!)) === 1, `${name}:那边也是一张`);
  check((await listed(t1)).filter((x) => x === idA).length === 1, `${name}:不重复`);
  await t2.close();

  say(' 别的标签页开着它');
  await t1.goto(`${BASE}?w=${idA}`);
  await settle(t1);
  await page.goto(BASE);
  await hookReady(page);
  await lose(page, [idA]);
  await page.goto(BASE);
  await page.waitForTimeout(ROSTER_SETTLE);
  check(!(await listed(page)).includes(idA), `${name}:那边开着,这边不认`);
  check(await t1.evaluate(() => !!(window as any).__wf?.ready), `${name}:那边的世界没被打断`);
  await t1.close();
  await page.goto(BASE);
  check(await untilListed(page, [idA]), `${name}:那边关了,再打开认回来`);

  say(' 别的标签页正在放文件进来');
  const file = path.join(OUT, `${name}-roster-a.civworld`);
  await page.goto(`${BASE}?w=${idA}`);
  await settle(page);
  await saveFile(page, idA, file);
  await page.goto(BASE);
  await hookReady(page);
  const t3 = await ctx.newPage();
  await t3.goto(BASE);
  await hookReady(t3);
  // 那边一直在对,这边放文件
  await t3.evaluate(async (x) => {
    const { store } = await eval(x);
    (window as any).__rescued = [];
    (window as any).__loop = setInterval(async () => (window as any).__rescued.push(...(await store.rescueLostWorlds()).rescued), 20);
  }, CHECK);
  const n0 = (await listed(page)).length;
  const kept = await keepFile(page, file);
  await page.waitForTimeout(500);
  const seenThere = await t3.evaluate(() => {
    clearInterval((window as any).__loop);
    return (window as any).__rescued as string[];
  });
  await t3.close();
  check(!seenThere.includes(kept.id), `${name}:放的半路没被认走`);
  check((await listed(page)).filter((x) => x === kept.id).length === 1 && (await listed(page)).length === n0 + 1, `${name}:多了一个,只多一个`);
  check(!(kept.id in (await trashOf(page))), `${name}:放好了不算删掉的世界`);

  say(' 退出登录全清');
  await page.goto(BASE);
  await hookReady(page);
  const before = await listed(page);
  check(before.length > 0, `${name}:还有世界`);
  const wiped = await page.evaluate(async (x) => (await eval(x)).saves.removeAllWorlds(), CHECK);
  check(wiped === true, `${name}:名单删干净了`);
  await page.goto(BASE);
  await page.waitForTimeout(ROSTER_SETTLE);
  check(!(await listed(page)).length, `${name}:仓库还没清掉:不回来`);
  await page.evaluate(async (x) => (await eval(x)).store.clearWorldStore(), CHECK);
  await page.goto(BASE);
  await page.waitForTimeout(ROSTER_SETTLE);
  check(!(await listed(page)).length, `${name}:仓库也清了:不回来`);
  check(!(await latest(page, idA)), `${name}:仓库是空的`);
  await page.close();
  await ctx.close();
}

/** 把硬盘写得一点不剩 */
function fillDiskAll(dir: string): void {
  const fd = openSync(path.join(dir, 'filler.bin'), 'a');
  for (const size of [64e6, 16e6, 4e6, 1e6, 256e3, 64e3, 16e3, 4e3, 1e3]) {
    const chunk = randomBytes(size);
    try {
      for (;;) writeSync(fd, chunk);
    } catch {
      /* 下一档小的接着写 */
    }
  }
  closeSync(fd);
  const st = statfsSync(dir);
  say(`  硬盘写到只剩 ${((st.bavail * st.bsize) / 1e6).toFixed(3)} MB`);
}

/** 硬盘有了地方:映像变大 bytes(写得一点不剩时连把文件改小都报 ENOSPC)。浏览器要先关掉 */
function growDisk(dir: string, image: string, bytes: number): void {
  const st = statfsSync(dir);
  const mb = Math.ceil((st.blocks * st.bsize + bytes) / 1e6);
  execFileSync('hdiutil', ['detach', dir], { stdio: 'pipe' });
  execFileSync('hdiutil', ['resize', '-size', `${mb}m`, image], { stdio: 'pipe' });
  execFileSync('hdiutil', ['attach', image, '-mountpoint', dir, '-nobrowse'], { stdio: 'pipe' });
  const now = statfsSync(dir);
  say(`  硬盘多了 ${(bytes / 1e6).toFixed(0)} MB,还能写 ${((now.bavail * now.bsize) / 1e6).toFixed(1)} MB`);
}

/** WebKit 把硬盘真的写满:撤销、删、新记录写了也可能丢,重开浏览器看认得对不对 */
async function rosterDisk(name: string) {
  say(`\n== 名单丢了:硬盘真的满了(${name})`);
  const volume = opt('volume');
  const image = opt('image');
  if (!volume || !image) throw new Error('--only=roster-disk 要给 --volume 和 --image');
  const dir = path.join(volume, `roster-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const open = async () => {
    const c = await (name === 'webkit' ? webkit : chromium).launchPersistentContext(dir, VIEW);
    const p = await c.newPage();
    p.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
    return { ctx: c, page: p };
  };
  let { ctx, page } = await open();
  const list = kinds();
  const pick = (n: string) => list.find((k) => k.name === n)!;
  const titles = ['改名', '干预', '作者人物', '逐年推演', '地形大事'];
  const [a, b, c, d, e] = titles.map(pick);
  const ids: string[] = [];
  for (const k of [a, b, c, d, e]) ids.push(await makeStored(page, k, `${name}-disk`));
  const [idA, idB, idC, idD, idE] = ids;
  const wholeA = await wholeOf(page, idA);
  const wholeD = await wholeOf(page, idD);
  const letter = (i: string) => 'ABCDE'[ids.indexOf(i)] ?? '?';
  const look = async (p: Page, what: string) => {
    const s = await p.evaluate(
      async ([x, all]) => {
        const { store } = await eval(x as string);
        const out: unknown[] = [];
        for (const i of all as string[]) {
          const st = await store.vaultCall('stateOf', [i]).catch((err: Error) => `读不了:${err.message.slice(0, 40)}`);
          out.push(st && typeof st === 'object' ? { listed: !!st.listed, deleted: !!st.deleted, settled: !!st.settled, undid: !!st.undid } : st);
        }
        return out;
      },
      [CHECK, ids],
    );
    const named = s.map((x, n) => (typeof x === 'object' && x ? `${'ABCDE'[n]}:${Object.entries(x).filter(([, v]) => v).map(([k]) => k).join('+') || '无'}` : `${'ABCDE'[n]}:${String(x)}`));
    say(`  ${what}:名单 ${(await listed(p)).map(letter).sort().join('')};删除记录 ${Object.keys(await trashOf(p)).map(letter).sort().join('') || '无'};小状态 ${named.join(' ')};提示条 ${JSON.stringify(await p.locator('.toast-main').allTextContents())}`);
  };
  await page.goto(BASE);
  await civsTab(page);
  await look(page, '写满之前');

  say(' 还有地方时删 A、E(记录写得下),A 的撤销提示开着时写满,然后撤销;满了删 B,提示收起;满了删 C,提示开着就关浏览器');
  fillDisk(volume, 60e6);
  await deleteInUi(page, e.save.title!);
  await page.waitForFunction(() => !document.querySelector('[data-act=world-undelete]'), null, { timeout: 30000 });
  await deleteInUi(page, a.save.title!);
  await page.waitForTimeout(1500);
  await look(page, '删了 A、E');
  fillDiskAll(volume);
  check(!(await canWrite(page, 200e3)), `${name}:真的写不进去了`);
  check(await undoOpen(page), `${name}:A 的撤销提示还开着`);
  await page.locator('[data-act=world-undelete]').click({ timeout: 5000 });
  await page.waitForTimeout(800);
  await deleteInUi(page, b.save.title!);
  await page.waitForFunction(() => !document.querySelector('[data-act=world-undelete]'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await deleteInUi(page, c.save.title!);
  await look(page, '关之前(这个页面看到的)');
  await page.close();
  await ctx.close();

  say(' 重开浏览器,硬盘还满着');
  ({ ctx, page } = await open());
  await page.goto(BASE);
  await hookReady(page);
  await page.waitForTimeout(ROSTER_SETTLE);
  await look(page, '满着打开');
  await page.close();
  await ctx.close();

  say(' 硬盘有了一点地方,重开浏览器');
  for (const room of [4e6, 8e6, 16e6]) {
    growDisk(volume, image, room);
    ({ ctx, page } = await open());
    await page.goto(BASE);
    await hookReady(page);
    await page.waitForTimeout(ROSTER_SETTLE);
    await look(page, `多了 ${room / 1e6} MB`);
    await page.close();
    await ctx.close();
  }

  say(' 硬盘有地方了,重开浏览器');
  growDisk(volume, image, 300e6);
  ({ ctx, page } = await open());
  await page.goto(BASE);
  await hookReady(page);
  await page.waitForTimeout(ROSTER_SETTLE);
  await look(page, '有地方了打开');
  const now = await listed(page);
  const trash = await trashOf(page);
  const contentOf = async (i: string) => !!(await latest(page, i));
  say(`  内容:${(await Promise.all(ids.map(async (i) => `${letter(i)}:${(await contentOf(i)) ? '在' : '没了'}`))).join(' ')}`);
  check(!now.some((i) => i in trash), `${name}:没有既在名单上又算删了的`);
  check(now.includes(idD) && (await contentOf(idD)), `${name}:没动过的 D 还在`);
  check(await contentOf(idA), `${name}:撤销了的 A:内容没被清`);
  // 存储紧张时自动清一遍:撤销被回退的 A 不能被清,提示收起过的 E 可以
  await page.evaluate(async (x) => (await eval(x)).store.maintain(), CHECK);
  await page.waitForTimeout(1000);
  check(await contentOf(idA), `${name}:清理走一遍,A 的内容还在`);
  if (now.includes(idA)) sameWhole(wholeA, await wholeOf(page, idA), `${name}:撤销了的 A`);
  sameWhole(wholeD, await wholeOf(page, idD), `${name}:没动过的 D`);
  await page.close();
  await ctx.close();

  say(' 再开一次:认过的不重复,记录一样');
  ({ ctx, page } = await open());
  await page.goto(BASE);
  await hookReady(page);
  await page.waitForTimeout(ROSTER_SETTLE);
  await look(page, '再开一次');
  check((await cardCount(page, d.save.title!)) === 1, `${name}:D 一张卡片`);

  // 撤销那一笔写进了仓库,localStorage 还没落盘硬盘就满了:实测碰到过的那次。localStorage 过一会儿才落盘,所以撤销完马上写满
  say(' 删了 D 再撤销,撤销一完硬盘就满');
  fillDisk(volume, 60e6);
  await deleteInUi(page, d.save.title!);
  await page.waitForTimeout(1500);
  await page.locator('[data-act=world-undelete]').click({ timeout: 5000 });
  await until(() => page.evaluate(async ([x, i]) => !!(await (await eval(x as string)).store.vaultCall('stateOf', [i]))?.undid, [CHECK, idD]), 2000);
  fillDiskAll(volume);
  await page.close();
  await ctx.close();
  growDisk(volume, image, 300e6);
  ({ ctx, page } = await open());
  await page.goto(BASE);
  const first = await listed(page);
  const firstTrash = await trashOf(page);
  say(`  刚打开,还没认:名单 ${first.map(letter).sort().join('')};删除记录 ${Object.keys(firstTrash).map(letter).sort().join('') || '无'}`);
  say(idD in firstTrash ? '  这一次 localStorage 真的回退了,认回来的路走到了' : '  这一次 localStorage 赶在写满前落了盘,没回退');
  await hookReady(page);
  check(await untilListed(page, [idD]), `${name}:D 在名单上`);
  await page.waitForTimeout(ROSTER_SETTLE);
  check(!(idD in (await trashOf(page))), `${name}:D 不算删掉的世界`);
  sameWhole(wholeD, await wholeOf(page, idD), `${name}:撤销了的 D`);
  await page.close();
  await ctx.close();
}

/** 量大世界:存储满了存成文件的内存峰值 */
async function hugeFull(browser: Browser, file: string) {
  say(`\n== 大世界塞满了存成文件(${path.basename(file)})`);
  const ctx = await freshContext('chromium');
  const pid = browserPid(lastProfile);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
  await limitQuota(page, 'chromium', 20e6);
  await page.goto(BASE);
  await hookReady(page);
  await fillUp(page, true);
  check(!(await canWrite(page)), '真的写不进去了');
  await page.goto(BASE);
  await page.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
  const t0 = Date.now();
  const s0 = sampleRss(pid);
  await page.setInputFiles('[data-testid=save-file-input]', file);
  await page.waitForFunction(() => (window as any).__wf?.ready && (window as any).__wfCiv?.ready, null, { timeout: 7200_000, polling: 2000 });
  const m0 = s0.stop();
  say(`  新建 + 推完:${((Date.now() - t0) / 1000).toFixed(0)} s;内存 ${m0.base} → 峰值 ${m0.peak} MB`);
  await page.waitForTimeout(20000);
  const id = await page.evaluate(async (c) => (await eval(c)).saves.currentWorld()?.id as string, CHECK);
  check(!(await latest(page, id)), '仓库里什么都没存下');
  const civA = await civSum(page);
  const s1 = sampleRss(pid);
  const out = path.join(OUT, 'huge-page.civworld');
  const r = await saveFile(page, id, out);
  const m1 = s1.stop();
  check(!r.stale, `页面里的世界当场打:存成文件 ${(r.ms / 1000).toFixed(1)} s(${(statSync(out).size / 1e6).toFixed(1)} MB);内存 ${m1.base} → 峰值 ${m1.peak} MB`);
  await page.close();
  await ctx.close();

  const c2 = await freshContext('chromium');
  const pid2 = browserPid(lastProfile);
  const p2 = await c2.newPage();
  p2.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
  // 放得下这个世界,不多
  await limitQuota(p2, 'chromium', 2 * statSync(out).size + 100e6);
  await p2.goto(BASE);
  await hookReady(p2);
  const s2 = sampleRss(pid2);
  const kept = await keepFile(p2, out);
  const m2 = s2.stop();
  check(kept.match === 'new', `干净的浏览器核对过了,放进来了:核对 ${(kept.lookMs / 1000).toFixed(1)} s,存进仓库 ${(kept.keepMs / 1000).toFixed(1)} s;内存 ${m2.base} → 峰值 ${m2.peak} MB`);
  await p2.goto(`${BASE}?w=${kept.id}`);
  const t3 = Date.now();
  await p2.waitForFunction(() => (window as any).__wf?.ready && (window as any).__wfCiv?.ready, null, { timeout: 1800_000, polling: 1000 });
  await p2.waitForTimeout(3000);
  say(`  打开 ${((Date.now() - t3) / 1000).toFixed(0)} s,走${await p2.evaluate(() => String((window as any).__wfLoad))}`);
  check((await civSum(p2)) === civA, `整段历史一样(${civA})`);
  // 同一段历史只改名:只换清单,块从仓库里读
  await fillUp(p2, true);
  check(!(await canWrite(p2)), '真的写不进去了');
  await p2.evaluate(async (c) => {
    const { saves } = await eval(c);
    const e = saves.getEdits();
    saves.setEdits({ ...e, names: { ...e.names, 'polity:页面里': '只在页面里' } });
  }, CHECK);
  await p2.waitForTimeout(4000);
  const s3 = sampleRss(pid2);
  const out2 = path.join(OUT, 'huge-light.civworld');
  const r2 = await saveFile(p2, kept.id, out2);
  const m3 = s3.stop();
  check(!r2.stale, `只改了名:存成文件 ${(r2.ms / 1000).toFixed(1)} s(${(statSync(out2).size / 1e6).toFixed(1)} MB);内存 ${m3.base} → 峰值 ${m3.peak} MB`);
  // 全部存成文件
  const s4 = sampleRss(pid2);
  const t4 = Date.now();
  const all = await p2.evaluate(async (wf) => {
    const m = await eval(wf);
    const o = await m.saveAllWorldFiles();
    return o.ok ? { whole: o.whole, bytes: o.bytes, left: o.left, behind: o.behind } : { error: o.kind };
  }, WF);
  const m4 = s4.stop();
  check(!('error' in all) && all.whole === 1 && !all.behind.length, `全部存成文件 ${((Date.now() - t4) / 1000).toFixed(1)} s(${JSON.stringify(all)});内存 ${m4.base} → 峰值 ${m4.peak} MB`);
  await p2.close();
  await c2.close();
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
    if (ONLY.includes('full')) await fullStorage(browser, name);
    if (ONLY.includes('trash')) await trashFull(name);
    if (ONLY.includes('roster')) await rosterCheck(browser, name);
    if (ONLY.includes('roster-disk')) await rosterDisk(name);
    if (name === 'chromium' && opt('huge')) await hugeFull(browser, opt('huge')!);
  } finally {
    await browser.close();
  }
}
await srv.close();
say(fails.length ? `\n没过 ${fails.length} 项:\n${fails.map((f) => `  ${f}`).join('\n')}` : '\n全部过了');
process.exit(fails.length ? 1 : 0);

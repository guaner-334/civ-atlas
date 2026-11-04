/**
 * 另存一份、地图不变的浏览器检查(界面接上之前走测试钩子 window.__wfKeepMapCopy;走开发服务器,页面里直接 import 几个模块下命令)。
 *
 * 要两版代码才查得出来,同一个端口、同一份浏览器配置先后跑:
 *
 *   npx tsx scripts/keep-map-check.ts --phase=make  --profile=<目录> --port=5199 [--browsers=chromium,webkit]    现在的代码:建几个世界存下来
 *   (另开一份代码,升 GENERATOR_VERSION,改生成地图和推演的算法,在那份代码的目录里跑)
 *   npx tsx scripts/keep-map-check.ts --phase=check --profile=<目录> --port=5199 [--browsers=chromium,webkit]    另存、打开、重推、改名、换规则、存成文件……逐项比
 *
 * check 比什么:原来的世界打开照旧;另存的世界地图(块的指纹、整张地图逐像素、放大细部逐像素)和原来一样,历史不一样;
 * 刷新、改名、干预重推、再推、推的线程重开过、换规则、复制、存成文件换一个干净的浏览器再打开,地图都不变;只有配方打不开、不长新地图。
 * 没过的打印「没过」,退出码非 0。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, webkit, type BrowserContext, type BrowserType, type Page } from 'playwright';
import { PNG } from 'pngjs';
import { createServer } from 'vite';
import { makeSave, type SaveFile } from '../src/gen/savefile';
import { EMPTY_EDITS, GENERATOR_VERSION, type WorldEdits } from '../src/gen/edits';
import { DEFAULT_PARAMS } from '../src/gen/world';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const PHASE = opt('phase') ?? 'make';
const PROFILE = path.resolve(opt('profile') ?? 'snaps/keep-map');
const PORT = Number(opt('port') ?? 5199);
const BROWSERS = (opt('browsers') ?? 'chromium,webkit').split(',');
const BASE = `http://127.0.0.1:${PORT}/`;
const WAIT = 240_000;
const VIEW = { viewport: { width: 1400, height: 800 }, deviceScaleFactor: 1, acceptDownloads: true };
/** 只看地形:填色、文明的东西都关掉(放大细部比像素) */
const PLAIN_VIEW = '&fill=none&civ=-labels,-sites,-routes,-wars';

const fails: string[] = [];
const say = (...a: unknown[]) => console.log(...a);
const check = (ok: boolean, what: string) => {
  say(`  ${ok ? '过' : '没过'}  ${what}`);
  if (!ok) fails.push(what);
};

const small = { ...DEFAULT_PARAMS, seed: 7, cells: 4000 };
const none: WorldEdits = { ...EMPTY_EDITS, endYear: 1000 };
const KINDS: { name: string; save: SaveFile }[] = [
  { name: '普通', save: makeSave(small, none, '', '普通的老世界') },
  { name: '地形大事', save: makeSave({ ...small, seed: 2024 }, { ...none, upheavals: [{ year: 500, ops: [{ kind: 'volcano', pts: [1310, 763], r: 60, s: 1.5 }] }] }, '', '有地形大事的老世界') },
  { name: '作者修改', save: makeSave(small, { ...none, names: { 'polity:c1#0': '饕餮王朝' }, interventions: [{ kind: 'protect', a: 'c999999#0', from: 100, until: 600 }] }, '', '改过的老世界') },
];

/** 打开一个 .json 存档,等世界推完;返回编号 */
async function openJson(page: Page, save: SaveFile, name: string): Promise<string> {
  const file = path.join(PROFILE, `${name}.json`);
  writeFileSync(file, JSON.stringify(save));
  await page.goto(BASE);
  await page.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
  await page.setInputFiles('[data-testid=save-file-input]', file);
  await page.waitForFunction(() => new URLSearchParams(location.search).has('w') && (window as any).__wf?.ready, null, { timeout: WAIT });
  await settle(page);
  return new URL(page.url()).searchParams.get('w')!;
}

async function settle(page: Page) {
  await page.waitForFunction(() => (window as any).__wf?.ready && (window as any).__wfCiv?.ready, null, { timeout: WAIT });
  await page.waitForTimeout(1500);
}

async function openWorld(page: Page, id: string) {
  await page.goto(`${BASE}?w=${id}${PLAIN_VIEW}`);
  await settle(page);
}

/** 仓库里这个世界最新的一份:清单里的地图、各段世界、历史的指纹,读取版本,修订号 */
async function stored(page: Page, id: string): Promise<{ map: string; eras?: string; civ: string; readers: unknown; n: number; recipe: string; generator: number } | null> {
  return page.evaluate(
    (i) =>
      new Promise((resolve, reject) => {
        const q = indexedDB.open('civ-atlas:worlds');
        q.onerror = () => reject(new Error('开不了仓库'));
        q.onsuccess = () => {
          const db = q.result;
          const all = db.transaction('manifests').objectStore('manifests').getAll();
          all.onsuccess = () => {
            db.close();
            const rows = (all.result as any[]).filter((r) => r.id === i && r.source !== 'archive').sort((a, b) => a.n - b.n);
            const row = rows.at(-1);
            if (!row) return resolve(null);
            const m = JSON.parse(row.text);
            const sum = (n: string) => m.parts.find((p: any) => p.name === n)?.sum;
            resolve({ map: sum('map'), eras: sum('eras'), civ: sum('civ'), readers: m.readers, n: row.n, recipe: row.recipeKey, generator: row.generator });
          };
        };
      }),
    id,
  );
}

async function waitStored(page: Page, id: string, after = 0) {
  for (let i = 0; i < 240; i++) {
    const s = await stored(page, id);
    if (s && s.n > after) return s;
    await page.waitForTimeout(500);
  }
  throw new Error(`${id} 一直没存进仓库`);
}

/** 整张地图的像素 */
async function wholeMap(page: Page): Promise<string> {
  return page.evaluate(() => (document.querySelector('.map-box > canvas:not(.wrap-copy)') as HTMLCanvasElement).toDataURL('image/png'));
}

/** 整张地图停下来不变的样子(有地形大事的:结束那一年的主图是后台铺好的补丁贴上去的,要等) */
async function stableWhole(page: Page): Promise<string> {
  let last = await wholeMap(page);
  for (let quiet = 0; quiet < 12; ) {
    await page.waitForTimeout(500);
    const now = await wholeMap(page);
    quiet = now === last ? quiet + 1 : 0;
    last = now;
  }
  return last;
}

/** 放大 8 倍的细部(只有地形:文明层、字都藏起来) */
async function zoomed(page: Page): Promise<Buffer> {
  await page.addStyleTag({ content: '.screen-layer ~ .screen-layer, .map-box-upper { visibility: hidden !important; }' });
  await page.mouse.move(800, 400);
  await page.mouse.wheel(0, -Math.log(8) / 0.0015);
  await page.waitForTimeout(800);
  await page
    .waitForFunction(
      () => {
        const w = window as any;
        return w.__wfDetail?.on && !w.__wfDetail?.pending;
      },
      null,
      { timeout: 60000 },
    )
    .catch(() => say('  (放大细部没等到)'));
  // 鼠标挪开:悬停的小牌子上写着国名
  await page.mouse.move(2, 2);
  await page.waitForTimeout(1500);
  return page.screenshot({ clip: { x: 450, y: 100, width: 800, height: 600 } });
}

function pngDiff(a: Buffer, b: Buffer): number {
  const x = PNG.sync.read(a);
  const y = PNG.sync.read(b);
  if (x.width !== y.width || x.height !== y.height) return -1;
  let n = 0;
  for (let i = 0; i < x.data.length; i += 4) {
    const d = Math.max(Math.abs(x.data[i] - y.data[i]), Math.abs(x.data[i + 1] - y.data[i + 1]), Math.abs(x.data[i + 2] - y.data[i + 2]));
    if (d > 1) n++;
  }
  return n;
}

const load = (page: Page) => page.evaluate(() => String((window as any).__wfLoad));
const civSum = (page: Page) => page.evaluate(() => JSON.stringify((window as any).__wfCivSum?.(1e9) ?? null));
const noCrash = (page: Page) => page.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));

/** tsx 给传进页面的函数加的 __name,页面里没有 */
const NAME_SHIM = 'window.__name = (f) => f;';
/** 记下页面开的后台线程(要叫推的线程出错) */
const WORKER_LIST = `{
  const W = window.Worker;
  const list = [];
  window.__workers = list;
  window.Worker = class extends W {
    constructor(u, o) {
      super(u, o);
      list.push({ url: String(u), w: this });
    }
  };
}`;

async function contextFor(type: BrowserType, dir: string): Promise<BrowserContext> {
  mkdirSync(dir, { recursive: true });
  const ctx = await type.launchPersistentContext(dir, VIEW);
  await ctx.addInitScript(NAME_SHIM);
  await ctx.addInitScript(WORKER_LIST);
  return ctx;
}

// ---------------------------------------------------------------------------

async function make(type: BrowserType, tag: string) {
  say(`\n== 建老世界(${tag},生成器第 ${GENERATOR_VERSION} 版)`);
  const ctx = await contextFor(type, path.join(PROFILE, tag));
  const page = await ctx.newPage();
  noCrash(page);
  const out: Record<string, { id: string; map: string; civ: string; whole: string; zoom: string; sum: string }> = {};
  for (const k of KINDS) {
    const id = await openJson(page, k.save, `${tag}-${k.name}`);
    const s = await waitStored(page, id);
    await openWorld(page, id);
    const whole = await stableWhole(page);
    const sum = await civSum(page);
    const zoom = await zoomed(page);
    const file = path.join(PROFILE, `${tag}-${k.name}-zoom.png`);
    writeFileSync(file, zoom);
    out[k.name] = { id, map: s.map, civ: s.civ, whole, zoom: file, sum };
    say(`  ${k.name}:${id} 第 ${s.n} 份,地图 ${s.map.slice(0, 8)}`);
  }
  writeFileSync(path.join(PROFILE, `${tag}.json`), JSON.stringify(out));
  await ctx.close();
}

/** 页面里看 saveStore 里的这份存档 */
const saveOf = (page: Page, id: string) => page.evaluate(async (i) => ((await import('/src/ui/saveStore.ts' as string)).loadWorld(i) as { save: SaveFile }).save, id);

/** 整张地图停下来以后是不是 want */
const sameWhole = async (page: Page, want: string): Promise<boolean> => (await stableWhole(page)) === want;

/** 一份修订除了修订号以外的内容(打开世界时封面会写新清单,修订号会动) */
const contentOf = (s: Awaited<ReturnType<typeof stored>>) => JSON.stringify(s && { ...s, n: 0 });

async function sameMapAs(page: Page, id: string, o: { map: string; whole: string }, what: string) {
  const s = await waitStored(page, id);
  check(s.map === o.map, `${what}:地图那一块的指纹没变`);
  check(await sameWhole(page, o.whole), `${what}:整张地图逐像素一样`);
  return s;
}

/** 改推演年数(配方变了,要重推),等重推画完 */
async function resim(page: Page, endYear: number) {
  const before = await page.evaluate(() => (window as any).__wfResim?.seq ?? 0);
  await page.evaluate(async (y) => (await import('/src/ui/editsStore.ts' as string)).setEndYear(y), endYear);
  await page.waitForFunction((n) => ((window as any).__wfResim?.seq ?? 0) > n, before, { timeout: WAIT });
  await settle(page);
}

async function verify(type: BrowserType, tag: string) {
  say(`\n== 另存、再改(${tag},生成器第 ${GENERATOR_VERSION} 版)`);
  const made = JSON.parse(readFileSync(path.join(PROFILE, `${tag}.json`), 'utf8')) as Record<string, { id: string; map: string; civ: string; whole: string; zoom: string; sum: string }>;
  const ctx = await contextFor(type, path.join(PROFILE, tag));
  const page = await ctx.newPage();
  noCrash(page);

  // 这份代码确实改了算法:按种子现长的地图和老世界不一样
  await openWorld(page, await openJson(page, makeSave(small, none, '', '按种子现长的'), `${tag}-现长`));
  check((await load(page)) === 'stored' || (await load(page)) === 'made', '按种子现长的世界照常打开');
  check((await wholeMap(page)) !== made['普通'].whole, '升了版本改了算法:按种子现长的地图和老世界不一样(不一样才查得出来)');

  const copies: Record<string, string> = {};
  for (const k of KINDS) {
    say(` ${k.name}`);
    const o = made[k.name];
    await openWorld(page, o.id);
    check((await load(page)) === 'stored', '原来的世界读存下的内容');
    check(await sameWhole(page, o.whole), '原来的世界:整张地图逐像素没变');
    check((await civSum(page)) === o.sum, '原来的世界:历史没变');
    const saveBefore = JSON.stringify(await saveOf(page, o.id));
    const revBefore = contentOf(await stored(page, o.id));

    const t0 = Date.now();
    const r = await page.evaluate((i) => (window as any).__wfKeepMapCopy(i), o.id);
    if (!r.ok) {
      check(false, `另存没成:${r.kind} ${r.message}`);
      continue;
    }
    say(`  另存一份 ${Date.now() - t0} ms`);
    copies[k.name] = r.id;
    check(JSON.stringify(await saveOf(page, o.id)) === saveBefore, '原来那份的存档没动');
    check(contentOf(await stored(page, o.id)) === revBefore, '原来那份的内容、配方、读取版本没动');

    await openWorld(page, r.id);
    check((await load(page)) === 'stored', '新世界读存下的内容');
    const s = await sameMapAs(page, r.id, o, '新世界');
    check(s.generator === GENERATOR_VERSION, '新世界是现在的版本算的');
    check(JSON.stringify(s.readers) === JSON.stringify({ terrain: 1, query: 1 }), '读取版本记着地形第 1 版');
    check(s.civ !== o.civ, '新世界的历史和原来不一样(按新规则)');
    check((await civSum(page)) !== o.sum, '新世界看到的历史和原来不一样');
    const z = await zoomed(page);
    const d = pngDiff(z, readFileSync(o.zoom));
    check(d === 0, `新世界:放大 8 倍的细部和原来逐像素一样(差 ${d} 个像素)`);
    if (d) writeFileSync(path.join(PROFILE, `${tag}-${k.name}-zoom-copy.png`), z);
    await page.reload();
    await settle(page);
    check((await load(page)) === 'stored', '刷新:读存下的内容');
    await sameMapAs(page, r.id, o, '刷新');
  }

  // 地图留着的世界再改
  const id = copies['普通'];
  const o = made['普通'];
  if (id) {
    say(' 再改');
    await openWorld(page, id);
    await page.evaluate(async (i) => (await import('/src/ui/saveStore.ts' as string)).renameWorld(i, '换了名字'), id);
    await page.waitForTimeout(4000);
    const named = await sameMapAs(page, id, o, '改名');
    check(named.n >= 1, '改名:仓库跟上了');

    const a = await stored(page, id);
    await resim(page, 900);
    const s1 = await waitStored(page, id, a!.n);
    check(s1.recipe !== a!.recipe, '重推:配方变了,存进仓库了');
    await sameMapAs(page, id, o, '重推');
    check(JSON.stringify(s1.readers) === JSON.stringify({ terrain: 1, query: 1 }), '重推:读取版本没变');

    // 推的线程出错了、重开:新线程要重新钉住那张地图(这时配方已经和打开时不一样了)
    await page.evaluate(() => {
      const list = (window as any).__workers as { url: string; w: Worker }[];
      const w = list.filter((x) => /\/worker\.ts|\/worker[-.]/.test(x.url)).at(-1)!.w;
      w.onerror?.(new ErrorEvent('error', { message: '检查脚本叫推的线程出错' }));
    });
    await page.waitForTimeout(500);
    const threads = await page.evaluate(() => (window as any).__workers.length);
    const b = await stored(page, id);
    await resim(page, 800);
    check((await page.evaluate(() => (window as any).__workers.length)) > threads, '推的线程真的重开了');
    await sameMapAs(page, id, o, '线程重开过以后再重推');
    const s2 = await waitStored(page, id, b!.n);
    check(s2.map === o.map, '线程重开过以后存的还是那一块');

    const c = await stored(page, id);
    await page.evaluate(async () => (await import('/src/ui/extendStore.ts' as string)).extendStart(500));
    await page.waitForFunction(() => (window as any).__wfExtend, null, { timeout: WAIT });
    await settle(page);
    const s3 = await waitStored(page, id, c!.n);
    check(s3.map === o.map, '再推:存的还是那一块');
    await sameMapAs(page, id, o, '再推');

    // 地形改不了
    const ups = await page.evaluate(async () => {
      const st = await import('/src/ui/editsStore.ts' as string);
      const r = st.addUpheaval({ year: 100, ops: [{ kind: 'volcano', pts: [812, 403], r: 60, s: 1.5 }] });
      return { added: r !== null, count: st.getEdits().upheavals?.length ?? 0, terrain: st.addTerrainOp({ kind: 'volcano', pts: [812, 403], r: 60, s: 1.5 }) };
    });
    check(!ups.added && !ups.count && !ups.terrain, '加地形大事、改地形被拦下');
    await page.waitForTimeout(1500);
    await sameMapAs(page, id, o, '拦下以后');

    // 换规则(用另一版规则另存一份重推)
    await page.evaluate(async (i) => (await import('/src/ui/newCivAction.ts' as string)).redoWithRules(i, { id: 'r1', name: '乱世', values: { 'war.odds': 2 } }), id);
    await page.waitForFunction((i) => new URLSearchParams(location.search).get('w') !== i && (window as any).__wfLoad === 'stored' && (window as any).__wf?.ready, id, { timeout: WAIT });
    await settle(page);
    const redo = new URL(page.url()).searchParams.get('w')!;
    check(redo !== id, '换规则:另存成了新世界');
    const rs = await saveOf(page, redo);
    check(!!rs.edits.rules && rs.edits.map?.sum === o.map, '换规则:带着规则,记着那张地图');
    const rr = await waitStored(page, redo);
    check(rr.map === o.map, '换规则:地图那一块的指纹没变');

    // 复制
    const dup = await page.evaluate(async (i) => (await import('/src/ui/saveStore.ts' as string)).duplicateWorld(i), id);
    await openWorld(page, dup);
    check((await load(page)) === 'stored', '复制:读存下的内容');
    await sameMapAs(page, dup, o, '复制');

    // 在这张地图上打造新文明:现在长不出这张地图,按旧世界的办法不让新开
    await openWorld(page, id);
    await page.evaluate(async (i) => (await import('/src/ui/newCivAction.ts' as string)).startNewCiv(i), id);
    await page.waitForSelector('text=没法在这张地图上打造文明', { timeout: WAIT }).then(
      () => check(true, '打造新文明:说明白了,没有长一颗别的星球'),
      () => check(false, '打造新文明:没看到说明'),
    );

    // 存成文件,换一个什么都没有的浏览器
    await openWorld(page, id);
    const file = path.join(PROFILE, `${tag}-kept.civworld`);
    const [d] = await Promise.all([
      page.waitForEvent('download', { timeout: WAIT }),
      page.evaluate(async (i) => {
        const m = await (window as any).__wfWorldFiles();
        const out = await m.saveWorldFile(i);
        if (!out.ok) throw new Error(out.message);
        const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(out.file), download: 'x.bin' });
        document.body.append(a);
        a.click();
        a.remove();
      }, id),
    ]);
    await d.saveAs(file);
    const text = JSON.stringify(await saveOf(page, id));
    const whole = await wholeMap(page);

    const browser = await type.launch();
    const clean = await browser.newContext(VIEW);
    await clean.addInitScript(NAME_SHIM);
    const p2 = await clean.newPage();
    noCrash(p2);
    await p2.goto(BASE);
    await p2.waitForFunction(() => typeof (window as any).__wfWorldFiles === 'function', null, { timeout: WAIT });
    await p2.evaluate(() => {
      const el = Object.assign(document.createElement('input'), { type: 'file', id: 'wf-in', hidden: true });
      document.body.append(el);
    });
    await p2.setInputFiles('#wf-in', file);
    const placed = await p2.evaluate(async () => {
      const m = await (window as any).__wfWorldFiles();
      const r = await m.openWorldFromFile((document.getElementById('wf-in') as HTMLInputElement).files![0]);
      return r.ok ? { ok: true, id: r.id } : { ok: false, message: r.message };
    });
    check(placed.ok, `文件:放进干净的浏览器 ${placed.ok ? '' : placed.message}`);
    if (placed.ok) {
      await openWorld(p2, placed.id!);
      check((await load(p2)) === 'stored', '文件:读存下的内容');
      check((await stored(p2, placed.id!))?.map === o.map, '文件:地图那一块的指纹没变');
      check((await wholeMap(p2)) === whole, '文件:整张地图逐像素一样');
      await p2.reload();
      await settle(p2);
      check((await wholeMap(p2)) === whole, '文件:再刷新一样');
    }
    await clean.close();

    // 只有配方(分享链接、存档文件、别的设备同步来的):打不开,不长新地图
    const bare = await browser.newContext(VIEW);
    await bare.addInitScript(NAME_SHIM);
    const p3 = await bare.newPage();
    noCrash(p3);
    const jf = path.join(PROFILE, `${tag}-kept.json`);
    writeFileSync(jf, text);
    await p3.goto(BASE);
    await p3.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
    await p3.setInputFiles('[data-testid=save-file-input]', jf);
    await p3.waitForSelector('text=打不开这个世界', { timeout: WAIT }).then(
      () => check(true, '只有配方:说明白了'),
      () => check(false, '只有配方:没看到说明'),
    );
    check((await load(p3)) === 'undefined', '只有配方:没有世界打开');
    await bare.close();
    await browser.close();
  }
  await ctx.close();
}

// ---------------------------------------------------------------------------

mkdirSync(PROFILE, { recursive: true });
const server = await createServer({ root: process.cwd(), server: { port: PORT, strictPort: true, host: '127.0.0.1', fs: { strict: false } }, logLevel: 'error' });
await server.listen();
try {
  for (const b of BROWSERS) {
    const type = b === 'webkit' ? webkit : chromium;
    if (PHASE === 'make') await make(type, b);
    else await verify(type, b);
  }
} catch (e) {
  say(`没过:跑到一半出错了:${(e as Error).stack}`);
  process.exit(1);
}
void server.close();
say(fails.length ? `\n没过 ${fails.length} 项:\n${fails.join('\n')}` : '\n全过');
process.exit(fails.length ? 1 : 0);

/**
 * 存成文件、打开文件的界面:真点按钮、真存真开的浏览器检查(量构建好的网站)。
 *
 *   pnpm build && npx tsx scripts/world-file-ui-check.ts [--browsers=chromium,webkit] [--devices=电脑,手机] [--only=存,开,全部,出错,满,手机] [--out=<目录>] [--shots=<目录>]
 *
 * 取消、空间不够、超时、内存不够都走真的流程:页面上的代码一个字不换,只在后台线程的脚本最前面加几句,
 * 让它慢下来(看得到进度、来得及点取消、核对超时)、读文件时报内存不够、写文件时报空间不够、一启动就崩;
 * 浏览器存储满了用 Chromium 的配额开关(Storage.overrideQuotaForOrigin),是真的写不进去。
 * 分成几个文件要超过 1 GB:用测试钩子 window.__wfBackupMaxBytes 把一个文件的上限调小,别的都是真的。
 *
 * --shots:每个画面截一张(按画面编号起名)。
 * 没过的打印「没过」,退出码非 0。手机是模拟的(屏幕大小、触屏);真手机上的分享菜单、下载到哪里这里验不了。
 */
import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { chromium, webkit, type Browser, type BrowserContext, type Page } from 'playwright';
import { preview } from 'vite';
import { GENERATOR_VERSION } from '../src/gen/edits';
import { makeSave, worldCheck, type SaveFile } from '../src/gen/savefile';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { ZIP_LOCAL_MAX_BYTES, parseZip, writeZip, type ZipInput } from '../src/gen/zipStore';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BROWSERS = (opt('browsers') ?? 'chromium,webkit').split(',');
const DEVICES = (opt('devices') ?? '电脑,手机').split(',');
const ONLY = (opt('only') ?? '存,开,全部,出错,满,手机').split(',');
const OUT = path.resolve(opt('out') ?? 'snaps/world-file-ui');
const SHOTS = opt('shots') ? path.resolve(opt('shots')!) : null;
mkdirSync(OUT, { recursive: true });
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const WAIT = 180_000;

const fails: string[] = [];
const say = (...a: unknown[]) => console.log(...a);
const check = (ok: boolean, what: string) => {
  say(`  ${ok ? '过' : '没过'}  ${what}`);
  if (!ok) fails.push(what);
};
/** 一段出了事不挡着后面的 */
async function step(name: string, f: () => Promise<void>) {
  say(`\n-- ${name}`);
  try {
    await f();
  } catch (e) {
    check(false, `${name}:${(e as Error).message.split('\n')[0]}`);
  }
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

const port = await freePort();
const srv = await preview({ build: { outDir: path.resolve('dist') }, preview: { port, strictPort: true, host: '127.0.0.1' }, logLevel: 'error' });
const BASE = `http://127.0.0.1:${port}/`;

// ---------------------------------------------------------------------------
// 文件

const NAME = '塞雷尼亚';
const COPY = `${NAME}（二）`;

function worldSave(seed: number, title: string): SaveFile {
  const params = { ...DEFAULT_PARAMS, seed };
  return makeSave(params, { names: {}, interventions: [], terrain: [] }, worldCheck(generateWorld(params)), title);
}

function writeJson(name: string, save: unknown): string {
  const f = path.join(OUT, `${name}.json`);
  writeFileSync(f, JSON.stringify(save));
  return f;
}

/** 改一个世界文件:清单、条目都能动 */
async function retouch(from: Uint8Array, change: (e: ZipInput[], m: any) => void): Promise<Uint8Array> {
  const entries: ZipInput[] = parseZip(from, ZIP_LOCAL_MAX_BYTES).map((e) => ({ name: e.name, data: e.data.slice() }));
  const me = entries.find((x) => x.name === 'manifest.json')!;
  const m = JSON.parse(new TextDecoder().decode(me.data as Uint8Array));
  change(entries, m);
  me.data = new TextEncoder().encode(JSON.stringify(m));
  return new Uint8Array(await (await writeZip(entries, ZIP_LOCAL_MAX_BYTES)).arrayBuffer());
}

/** 大世界:多带一块 mb MB 的数据(只当字节留着),文件真的这么大 */
function padded(from: Uint8Array, mb: number): Promise<Uint8Array> {
  const pad = randomBytes(mb * 1e6);
  const sum = createHash('sha256').update(pad).digest('hex');
  return retouch(from, (e, m) => {
    e.push({ name: 'parts/padding.bin', data: new Uint8Array(pad) });
    m.parts.push({ name: 'padding', file: 'parts/padding.bin', schema: 1, sum, bytes: pad.length, zip: 'none', need: 'extra' });
  });
}

// ---------------------------------------------------------------------------
// 后台线程脚本最前面加的几句

const SLOW_DIGEST = (ms: number) => `{const d=SubtleCrypto.prototype.digest;SubtleCrypto.prototype.digest=async function(a,b){await new Promise((r)=>setTimeout(r,${ms}));return d.call(this,a,b)};}`;
const NO_MEMORY = `Blob.prototype.arrayBuffer=()=>Promise.reject(new RangeError('Array buffer allocation failed'));`;
const NO_ROOM = `{const B=Blob;self.Blob=class extends B{constructor(...a){if(a[0]&&a[0].length>1)throw new DOMException('no room','QuotaExceededError');super(...a)}};}`;
const CRASH = `throw new Error('worker crashed on purpose');`;
/** 现在所有块都是第一版,没有转不了的文件可做:核对线程照「转不了」回话,界面这边是真的 */
const CANT_CONVERT = `{const p=self.postMessage.bind(self);self.postMessage=()=>p({ok:false,kind:'readonly',message:'转不了'});}`;

/** 这两种线程的脚本:worldFileLook 核对文件,worldVaultWorker 读写仓库、拼文件 */
async function inject(ctx: BrowserContext, worker: 'worldFileLook' | 'worldVaultWorker', code: string): Promise<() => Promise<void>> {
  const glob = `**/assets/${worker}*`;
  const handler = async (route: Parameters<Parameters<BrowserContext['route']>[1]>[0]) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), 'cache-control': 'no-store' }, body: code + (await res.text()) });
  };
  await ctx.route(glob, handler);
  return () => ctx.unroute(glob, handler);
}

// ---------------------------------------------------------------------------
// 页面上的几步

type Device = '电脑' | '手机';

interface Run {
  browser: Browser;
  tag: string;
  device: Device;
}

function newContext(r: Run): Promise<BrowserContext> {
  return r.browser.newContext(
    r.device === '电脑'
      ? { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true, locale: 'zh-CN' }
      : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true, locale: 'zh-CN' },
  );
}

async function newPage(ctx: BrowserContext): Promise<Page> {
  // 自动化的 WebKit 说能分享文件,点了却等不到回音(没有真的菜单可点):这里走下载那条路;分享那条路另外试(模拟 iPhone 那一段)
  await ctx.addInitScript(() => {
    (navigator as unknown as { canShare?: unknown }).canShare = undefined;
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    if (!e.message.includes('on purpose')) check(false, `页面报错:${e.message.slice(0, 200)}`);
  });
  return page;
}

async function shot(r: Run, page: Page, board: string) {
  if (!SHOTS) return;
  await page.waitForTimeout(350);
  const [num, ...rest] = board.split('-');
  const dir = path.join(SHOTS, r.tag);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${num}-${r.device}-${rest.join('-')}.jpg`), await page.screenshot({ type: 'jpeg', quality: 80 }));
}

async function goHome(page: Page) {
  await page.goto(BASE);
  await page.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
  await civsTab(page);
}

async function civsTab(page: Page) {
  const tab = page.locator('[data-tab="civs"]');
  if (await tab.count()) await tab.click({ timeout: 10_000 });
}

/** 选文件。先收掉提示条,好认出这次的结果 */
async function pick(page: Page, file: string | string[]) {
  for (const x of await page.locator('.toast .toast-x').all()) await x.click().catch(() => {});
  await page
    .locator('.toast')
    .first()
    .waitFor({ state: 'detached', timeout: 10_000 })
    .catch(() => {});
  await page.setInputFiles('[data-testid=save-file-input]', file);
}

/** 提示条的字(第一行 + 小字);等到有 has 这几个字 */
async function toastHas(page: Page, has: string | RegExp, timeout = 60_000): Promise<string> {
  const el = page.locator('.toast').filter({ hasText: has }).first();
  await el.waitFor({ timeout });
  return (await el.innerText()).replace(/\s*\n\s*/g, ' / ');
}

/** 文字是不是一字不差地在提示条上 */
async function toastIs(page: Page, want: (string | RegExp)[], what: string, timeout = 60_000) {
  try {
    const text = await toastHas(page, want[0], timeout);
    const miss = want.filter((w) => (typeof w === 'string' ? !text.includes(w) : !w.test(text)));
    check(!miss.length, `${what}:「${text}」${miss.length ? ` 少了「${miss.map(String).join('」「')}」` : ''}`);
    return text;
  } catch {
    const now = await page
      .locator('.toast')
      .allInnerTexts()
      .catch(() => []);
    check(false, `${what}:等不到「${String(want[0])}」,提示条是「${now.join(' | ').replace(/\n/g, ' / ')}」`);
    return '';
  }
}

async function worldReady(page: Page) {
  await page.waitForFunction(() => new URLSearchParams(location.search).has('w') && (window as any).__wf?.ready && (window as any).__wfCiv?.ready, null, { timeout: WAIT });
  await page.waitForTimeout(1500);
}

const clickToast = (page: Page, act: string) => page.locator(`.toast [data-act="${act}"]`).click({ timeout: 30_000 });

/** 接住下载,存到 to */
async function downloadOf(page: Page, doIt: () => Promise<unknown>, to?: string): Promise<{ name: string; path: string }> {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: WAIT }), doIt()]);
  const file = to ?? path.join(OUT, d.suggestedFilename());
  await d.saveAs(file);
  return { name: d.suggestedFilename(), path: file };
}

/** 一段时间里没有下载 */
async function noDownload(page: Page, ms: number): Promise<boolean> {
  let got = false;
  const on = () => (got = true);
  page.on('download', on);
  await page.waitForTimeout(ms);
  page.off('download', on);
  return !got;
}

async function openMenu(r: Run, page: Page) {
  if (r.device === '手机' && !(await page.locator('.ps-tiles').count())) {
    await page.locator('[data-act="world-sheet"]').click();
    await page.waitForTimeout(500);
  }
  await page.locator('.save-btn:visible').first().click();
  await page.waitForSelector('.save-menu');
}

const closeMenu = async (page: Page) => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
};

const cardCount = async (page: Page) => {
  await civsTab(page);
  await page.waitForTimeout(200);
  return page.locator('.mw-card').count();
};

const cardOf = (page: Page, title: string) => page.locator('.mw-card').filter({ has: page.locator('.mw-name', { hasText: new RegExp(`^${title}$`) }) }).first();

/** 打开「我的世界」里的一个 */
async function openCard(page: Page, title: string) {
  await goHome(page);
  await civsTab(page);
  await cardOf(page, title).locator('[data-act="open-world"]').click();
  await worldReady(page);
}

async function renameCard(page: Page, from: string, to: string) {
  await goHome(page);
  await civsTab(page);
  await cardOf(page, from).locator('.mw-open').dispatchEvent('contextmenu');
  await page.locator('.mw-menu [data-act="world-rename"]').click();
  await page.locator('.mw-title-input').fill(to);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

/** 存成文件:点存档菜单;手机上还要点「存到手机」。交回文件 */
async function saveCurrent(r: Run, page: Page, to?: string): Promise<{ name: string; path: string }> {
  await openMenu(r, page);
  if (r.device === '电脑') return downloadOf(page, () => page.locator('.save-menu [data-act="save-file"]').click(), to);
  await page.locator('.save-menu [data-act="save-file"]').click();
  await page.locator('.toast [data-act="save-to-phone"]').waitFor({ timeout: WAIT });
  return downloadOf(page, () => clickToast(page, 'save-to-phone'), to);
}

// ---------------------------------------------------------------------------

/** 这份检查用的世界:存进来(几个旧文件一起选),都打开过一次(有缩略图、内容进了仓库) */
async function prepare(r: Run, page: Page) {
  const saves = [
    [7, NAME],
    [2024, '九州大陆'],
    [11, '南海诸国'],
    [99, '北境王朝'],
    ...(SHOTS ? [[1009, '群岛纪元']] : []),
  ];
  const files = saves.map(([seed, title]) => writeJson(`${r.tag}-${title}`, worldSave(seed as number, title as string)));
  await goHome(page);
  await pick(page, files);
  await toastIs(page, [`已放回 ${files.length} 个世界`], '几个旧 .json 一起选:都放进「我的世界」');
  check((await cardCount(page)) === files.length, `卡片有 ${files.length} 张`);
  // 截图时这几个世界当作自己建的(不写「来自文件」)
  if (SHOTS) {
    await page.evaluate(() => {
      for (const k of Object.keys(localStorage)) {
        if (!k.startsWith('wenming-ditu:meta:')) continue;
        const m = JSON.parse(localStorage.getItem(k)!);
        delete m.fromFile;
        localStorage.setItem(k, JSON.stringify(m));
      }
    });
  }
  for (const [, title] of [...saves].reverse()) await openCard(page, title as string);
}

/** 存下来的世界文件放在哪(文件名不改,提示条上写的就是它) */
function savedPath(r: Run): string {
  const dir = path.join(OUT, r.tag);
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `文明与地图-${NAME}.civworld`);
}

async function saving(r: Run, ctx: BrowserContext, page: Page): Promise<string> {
  let saved = '';
  await step('存档菜单', async () => {
    await openCard(page, NAME);
    await openMenu(r, page);
    const small = page.locator('.save-menu [data-act="save-file"] small');
    await page.waitForFunction(() => /约 \d+ MB|不到 1 MB/.test(document.querySelector('.save-menu [data-act="save-file"] small')?.textContent ?? ''), null, { timeout: 30_000 });
    const text = (await small.innerText()).trim();
    check(/^存下整个世界，(约 \d+ MB|不到 1 MB)。换台设备、发给别人，看到的都一模一样$/.test(text), `存成文件的小字:${text}`);
    check((await page.locator('.save-menu [data-act="save-file"] b').innerText()) === '存成文件', '存成文件的名字');
    check((await page.locator('.save-menu [data-act="share-link"] b').innerText()) === '复制配方链接', '复制配方链接');
    check((await page.locator('.save-menu [data-act="share-link"] small').innerText()) === '对方打开时重新长一遍，可能和你看到的不一样', '配方链接的小字');
    await shot(r, page, '01-存档菜单-推荐');
    await closeMenu(page);
  });

  await step('存文件:要等一会儿、取消', async () => {
    const off = await inject(ctx, 'worldVaultWorker', SLOW_DIGEST(1200));
    await openMenu(r, page);
    await page.locator('.save-menu [data-act="save-file"]').click();
    const text = await toastIs(page, ['正在存成文件', '别关页面'], '等过 1 秒出进度', 10_000);
    check(text.includes(`「${NAME}」有 `), `写了多大:${text}`);
    await page.waitForFunction(() => document.querySelector('.toast .toast-bar span') !== null, null, { timeout: 20_000 });
    await shot(r, page, '04-存成文件-大世界要等');
    await clickToast(page, 'world-file-cancel');
    await toastIs(page, ['已取消，没有存下文件'], '取消');
    check(await noDownload(page, 3000), '取消了不下载');
    await off();
  });

  await step('存文件', async () => {
    await openMenu(r, page);
    await page.locator('.save-menu [data-act="save-file"]').click();
    if (r.device === '手机') {
      const t = await toastIs(page, ['文件准备好了，', `文明与地图-${NAME}.civworld`, '存到手机'], '手机:文件准备好了', WAIT);
      check(/文件准备好了，[\d.]+ MB/.test(t), '手机:写了大小');
      await shot(r, page, '27-手机-文件准备好了');
      const d = await downloadOf(page, () => clickToast(page, 'save-to-phone'), savedPath(r));
      saved = d.path;
      check(d.name === `文明与地图-${NAME}.civworld`, `文件名:${d.name}`);
      await toastIs(page, ['已存成文件', '在手机的「下载」里，', '发给别人时，让对方到这个网站点「打开存档文件」选它'], '手机:存好了');
    } else {
      const d = await downloadOf(page, () => page.waitForTimeout(0), savedPath(r));
      saved = d.path;
      check(d.name === `文明与地图-${NAME}.civworld`, `文件名:${d.name}`);
      await toastIs(page, ['已存成文件', `文明与地图-${NAME}.civworld，`, ' MB。发给别人时，让对方到这个网站点「打开存档文件」选它'], '电脑:存好了');
    }
    await shot(r, page, '05-存成文件-存好了');
    check(readFileSync(saved).subarray(0, 2).toString() === 'PK', '文件是世界文件');
  });

  await step('卡片菜单', async () => {
    await goHome(page);
    await civsTab(page);
    await cardOf(page, NAME).locator('.mw-open').dispatchEvent('contextmenu');
    await page.locator('.mw-menu [data-act="world-file"] .pm-note').waitFor({ timeout: 20_000 });
    check(/约 \d+ MB|不到 1 MB/.test(await page.locator('.mw-menu [data-act="world-file"] .pm-note').innerText()), '卡片菜单上写大小');
    await shot(r, page, '03-卡片菜单');
    if (r.device === '电脑') {
      const d = await downloadOf(page, () => page.locator('.mw-menu [data-act="world-file"]').click(), path.join(OUT, `${r.tag}-卡片.civworld`));
      check(d.name.endsWith('.civworld'), '卡片菜单存的也是整个世界');
    } else {
      await page.locator('.mw-menu [data-act="world-file"]').click();
      await toastIs(page, ['文件准备好了'], '手机:卡片菜单存', WAIT);
      await page.locator('.toast .toast-x').click();
    }
  });
  return saved;
}

async function opening(r: Run, ctx: BrowserContext, page: Page, saved: string) {
  await step('打开同一个文件', async () => {
    await goHome(page);
    const before = await cardCount(page);
    await pick(page, saved);
    await worldReady(page);
    await toastIs(page, [`「${NAME}」已经在「我的世界」里了`, '和文件内容一样，打开的就是它'], '内容一样');
    await shot(r, page, '21-同一个世界-内容一样');
    await goHome(page);
    check((await cardCount(page)) === before, '不多一张卡片');
  });

  await step('打开内容不一样的文件:先问', async () => {
    await renameCard(page, NAME, `${NAME}甲`);
    const before = await cardCount(page);
    const ask = page.locator('[data-testid="same-world-ask"]');
    const askNow = async (doIt: () => Promise<void>) => {
      await doIt();
      await ask.waitFor({ timeout: WAIT });
      return {
        title: (await ask.locator('.dup-title').innerText()).replace(/\s+/g, ''),
        tags: (await ask.locator('.dup-tag').allInnerTexts()).join('|'),
        note: await ask.locator('.dup-note').innerText(),
        original: await ask.locator('[data-act="same-original"]').count(),
      };
    };
    const a = await askNow(() => pick(page, saved));
    check(a.title === `「${NAME}甲」已经有了，内容不一样`, `标题:${a.title}`);
    check(a.tags === '原来的|文件里的', `两列:${a.tags}`);
    check(a.note === `两种都不会盖掉原来的。另存的一份叫「${COPY}」。`, `小字:${a.note}`);
    check(a.original === 1, '三个按钮');
    check(!(await ask.locator('.dup-alike').count()), '名字不一样:不说「这几项都一样」');
    await shot(r, page, '22-同一个世界-内容不一样-先问');
    const url = page.url();
    await ask.locator('[data-act="same-cancel"]').click();
    await ask.waitFor({ state: 'detached' });
    await page.waitForTimeout(500);
    check(page.url() === url && !(await page.locator('.toast').filter({ hasText: NAME }).count()), '取消:留在这一页,没有提示');
    check((await cardCount(page)) === before, '取消:没存进来');

    await askNow(() => pick(page, saved));
    await ask.locator('[data-act="same-original"]').click();
    await worldReady(page);
    await toastIs(page, [`已打开原来的「${NAME}甲」`, '文件里的那份没存进「我的世界」'], '选了打开原来的');
    await openMenu(r, page);
    check((await page.locator('.save-menu .save-cur-name').innerText()) === `${NAME}甲`, '「打开原来的」打开的是原来那个');
    await closeMenu(page);

    // 拖到正开着的这个世界上:「打开原来的」就是留在这里,只有两个按钮(手机没有拖放)
    if (r.device === '电脑') {
      const here = page.url();
      const data = readFileSync(saved).toString('base64');
      const b = await askNow(() =>
        page.evaluate(
          ([b64, name]) => {
            const dt = new DataTransfer();
            dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name));
            const el = document.querySelector('.app')!;
            el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
            el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
          },
          [data, `文明与地图-${NAME}.civworld`],
        ),
      );
      check(b.tags === '正开着的|文件里的' && b.original === 0, `拖到正开着的世界上:两个按钮,左边写正开着的(${b.tags})`);
      check(b.note === `正开着的不会被盖掉。另存的一份叫「${COPY}」。`, `拖到正开着的世界上的小字:${b.note}`);
      await shot(r, page, '23-同一个世界-拖到正开着的');
      await page.keyboard.press('Escape');
      await ask.waitFor({ state: 'detached' });
      await page.waitForTimeout(500);
      check(page.url() === here && !(await page.locator('.toast').filter({ hasText: COPY }).count()), 'Esc:什么都不动');
    }

    await goHome(page);
    await askNow(() => pick(page, saved));
    await ask.locator('[data-act="same-copy"]').click();
    await worldReady(page);
    await toastIs(page, [`已打开「${COPY}」`, `另存了一份，原来的「${NAME}甲」没动`], '选了另存一份并打开');
    check(!(await page.locator('.toast [data-act="open-original"]').count()), '提示条上没有「打开原来的」');
    await shot(r, page, '25-同一个世界-选了另存一份');
    await openMenu(r, page);
    const line = await page.locator('[data-testid="save-from-file"]').innerText();
    check(/^来自文件，\d+ 月 \d+ 日打开$/.test(line), `存档菜单写来源:${line}`);
    await shot(r, page, '24-来源-存档菜单写一句-推荐');
    check((await page.locator('.save-menu .save-cur-name').innerText()) === COPY, '打开的是另存的那份');
    await closeMenu(page);
    // 再开一次同一个文件:认得出另存的那份,不多出「(三)」
    await goHome(page);
    const n = await cardCount(page);
    await pick(page, saved);
    await worldReady(page);
    await toastIs(page, [`「${COPY}」已经在「我的世界」里了`], '再开一次:认出另存的那份');
    await goHome(page);
    check((await cardCount(page)) === n, '不多出第三份');
    await renameCard(page, `${NAME}甲`, NAME);
  });

  await step('换一个干净的浏览器打开', async () => {
    const c2 = await newContext(r);
    const p2 = await newPage(c2);
    await goHome(p2);
    await pick(p2, saved);
    await worldReady(p2);
    await toastIs(p2, [`已打开存档「${NAME}」`, '已存进「我的世界」，下次不用再选文件'], '打开了');
    await shot(r, p2, '13-打开文件-打开了');
    await goHome(p2);
    check((await cardCount(p2)) === 1, '存进了「我的世界」');
    // 旧的 .json
    await pick(p2, writeJson(`${r.tag}-旧`, worldSave(2024, '旧文件的世界')));
    await worldReady(p2);
    await toastIs(p2, ['已打开存档「旧文件的世界」', '已存进「我的世界」，下次不用再选文件'], '旧的 .json:照旧打开');
    await openMenu(r, p2);
    check(!!(await p2.locator('[data-testid="save-from-file"]').count()), '旧的 .json 打开的也写来自文件');
    await closeMenu(p2);
    // 选错文件:那几句不变
    await goHome(p2);
    const wrong = path.join(OUT, `${r.tag}-错.json`);
    writeFileSync(wrong, JSON.stringify({ hello: 'world' }));
    await pick(p2, wrong);
    await toastIs(p2, ['不是「文明与地图」的存档'], '选错文件');
    await c2.close();
  });

  await step('拖进页面', async () => {
    await goHome(page);
    const data = readFileSync(saved).toString('base64');
    await page.evaluate(
      ([b64, name]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], name));
        const el = document.querySelector('.app')!;
        el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
        (window as any).__dt = dt;
      },
      [data, 'x.civworld'],
    );
    await page.waitForSelector('.drop-hint');
    check((await page.locator('.drop-hint').innerText()).trim() === '松手打开存档', '提示不写后缀');
    if (r.device === '电脑') await shot(r, page, '26-拖进页面');
    await page.evaluate(() => {
      document.querySelector('.app')!.dispatchEvent(new DragEvent('drop', { dataTransfer: (window as any).__dt, bubbles: true, cancelable: true }));
    });
    await worldReady(page);
    await toastHas(page, '已经在「我的世界」里了');
    check(true, '拖进来的 .civworld 打开了');
  });

  await step('打开文件要等一会儿、取消', async () => {
    await goHome(page);
    const off = await inject(ctx, 'worldFileLook', SLOW_DIGEST(2000));
    await pick(page, saved);
    const t = await toastIs(page, ['正在打开 ', '要核对一会儿', '取消'], '过 0.5 秒出提示', 15_000);
    check(/这个世界有 [\d.]+ MB/.test(t), '写了多大');
    await shot(r, page, '12-打开文件-大文件');
    const url = page.url();
    await clickToast(page, 'world-file-cancel');
    await page.waitForTimeout(800);
    check(!(await page.locator('.toast').filter({ hasText: '正在打开' }).count()), '取消了提示条收起');
    check(page.url() === url, '取消了不打开');
    await off();
    await page.waitForTimeout(500);
  });
}

async function allWorlds(r: Run, ctx: BrowserContext, page: Page): Promise<string> {
  const saveAll = () => page.locator('[data-act="save-all"]').click();
  const file = path.join(OUT, `${r.tag}-全部.civworld`);
  await step('全部存成文件:进度、取消', async () => {
    await goHome(page);
    const n = await cardCount(page);
    const off = await inject(ctx, 'worldVaultWorker', SLOW_DIGEST(700));
    await saveAll();
    const t = await toastIs(page, ['正在存成文件：第 ', ` / ${n} 个`, '别关页面', '取消'], '进度', 15_000);
    await toastHas(page, /一共约 \d+ MB，别关页面/, 60_000)
      .then((x) => check(true, `算出一共多大:${x}`))
      .catch(() => check(false, `算出一共多大:${t}`));
    await shot(r, page, '08-全部存成文件-正在存');
    await clickToast(page, 'world-file-cancel');
    await toastIs(page, ['已取消，没有存下文件'], '取消');
    check(await noDownload(page, 3000), '取消了不下载');
    await off();
  });

  await step('全部存成文件', async () => {
    await goHome(page);
    const n = await cardCount(page);
    await saveAll();
    if (r.device === '手机') {
      await toastIs(page, ['文件准备好了，', `${n} 个世界。以后点「打开存档文件」选它，都会回来`, '存到手机'], '手机:文件准备好了', WAIT);
      await shot(r, page, '09-全部存成文件-存好了');
      const d = await downloadOf(page, () => clickToast(page, 'save-to-phone'), file);
      check(d.name.endsWith('.civworld') && d.name.includes('全部世界'), `文件名:${d.name}`);
      await toastIs(page, [`${n} 个世界已存成一个文件`, '在手机的「下载」里，'], '手机:存好了');
    } else {
      const d = await downloadOf(page, () => page.waitForTimeout(0), file);
      check(d.name.endsWith('.civworld') && d.name.includes('全部世界'), `文件名:${d.name}`);
      await toastIs(page, [`${n} 个世界已存成一个文件`, `${d.name}，`, '以后点「打开存档文件」选它，这些世界都会回来'], '电脑:存好了');
      await shot(r, page, '09-全部存成文件-存好了');
    }
  });

  await step('全部存成文件:空间不够,再试一次', async () => {
    await goHome(page);
    const off = await inject(ctx, 'worldVaultWorker', NO_ROOM);
    await saveAll();
    await toastIs(page, ['没能存成文件', '空间不够了。世界都还在，腾出地方再试', '再试一次'], '空间不够', WAIT);
    await toastHas(page, /存到第 \d+ 个时空间不够了/).then((x) => check(true, x));
    await shot(r, page, '10-全部存成文件-空间不够');
    await off();
    await clickToast(page, 'world-file-retry');
    if (r.device === '手机') await toastHas(page, '文件准备好了', WAIT);
    else await toastHas(page, '已存成一个文件', WAIT);
    check(true, '再试一次:存好了');
  });

  await step('全部存成文件:分成几个文件', async () => {
    await goHome(page);
    await page.evaluate(() => {
      (window as any).__wfBackupMaxBytes = 20e6;
    });
    await saveAll();
    const parts: string[] = [];
    if (r.device === '手机') {
      await toastIs(page, ['文件准备好了，', '一个文件放不下，分成 ', '打开时都选上', '存到手机'], '手机:第一个也要点一下', WAIT);
      parts.push((await downloadOf(page, () => clickToast(page, 'save-to-phone'), path.join(OUT, `${r.tag}-分-1.civworld`))).path);
    } else parts.push((await downloadOf(page, () => page.waitForTimeout(0), path.join(OUT, `${r.tag}-分-1.civworld`))).path);
    const t = await toastIs(page, ['第 1 个文件存好了，还有 ', '一个文件放不下，分成 ', '打开时都选上', '存下一个'], '第 1 个', WAIT);
    await shot(r, page, '11-全部存成文件-分几个文件');
    const n = Number(/分成 (\d+) 个/.exec(t)?.[1] ?? 0);
    for (let i = 2; i <= n; i++) parts.push((await downloadOf(page, () => clickToast(page, 'save-next'), path.join(OUT, `${r.tag}-分-${i}.civworld`))).path);
    await toastIs(page, [`已存成 ${n} 个文件`, '都选上'], '都存好了');
    await page.evaluate(() => {
      delete (window as any).__wfBackupMaxBytes;
    });
    // 分开的几个一起选,全部放回来
    const c2 = await newContext(r);
    const p2 = await newPage(c2);
    await goHome(p2);
    await pick(p2, parts);
    const told = await toastHas(p2, /已放回 \d+ 个世界/, WAIT);
    // 另存出来、内容又一样的两份,放回来算一个
    const w = await cardCount(p2);
    const had = await cardCount(page);
    check(w + Number(/(\d+) 个原来就有/.exec(told)?.[1] ?? 0) === had, `一起选:${had} 个世界放回 ${w} 个(${told})`);
    if (parts.length > 1) {
      // 只选一个:说还差哪个
      const c3 = await newContext(r);
      const p3 = await newPage(c3);
      await goHome(p3);
      await pick(p3, parts[0]);
      const m = await toastIs(p3, [/已放回 \d+ 个世界/, `分成 ${parts.length} 个文件的还差第 `], '只选一个:说还差哪个', WAIT);
      check(m.includes('一起选上再打开一次'), m);
      await c3.close();
    }
    await c2.close();
  });

  await step('放回全部:进度、取消、内容不一样、坏了一个', async () => {
    const c2 = await newContext(r);
    const p2 = await newPage(c2);
    await goHome(p2);
    const off = await inject(c2, 'worldFileLook', SLOW_DIGEST(700));
    await pick(p2, file);
    await toastIs(p2, ['正在放回世界：第 ', '取消的话，已放回的留着', '取消'], '进度', 30_000);
    await shot(r, p2, '19-放回全部-正在放回');
    await clickToast(p2, 'world-file-cancel');
    await toastIs(p2, [/已放回 \d+ 个世界/, '剩下的没有放'], '取消:已放回的留着', WAIT);
    const kept = await cardCount(p2);
    await off();
    await pick(p2, file);
    await toastIs(p2, [/已放回 \d+ 个世界/], '接着放回', WAIT);
    const all = await cardCount(p2);
    check(all > kept || all === 1, `放完 ${all} 个(取消时 ${kept} 个)`);
    await pick(p2, file);
    await toastIs(p2, ['这些世界都已经在「我的世界」里了'], '再放一次:都已经有了', WAIT);
    await c2.close();
    // 存文件的这个浏览器:删一个(放回来)、改名一个(内容不一样,另存);文件里再弄坏一个(跳过);别的原来就有
    await goHome(page);
    await civsTab(page);
    await cardOf(page, '九州大陆').locator('.mw-open').dispatchEvent('contextmenu');
    await page.locator('.mw-menu [data-act="world-delete"]').click();
    await page.locator('.mw-menu [data-act="world-delete"]').click({ timeout: 2000 }).catch(() => {});
    await renameCard(page, '北境王朝', '北境王朝甲');
    const entries = parseZip(new Uint8Array(readFileSync(file)), ZIP_LOCAL_MAX_BYTES).map((e) => ({ name: e.name, data: e.data.slice() }));
    const index = JSON.parse(new TextDecoder().decode(entries.find((e) => e.name === 'worlds.json')!.data as Uint8Array));
    const dir = index.worlds.find((w: { title?: string }) => w.title === '南海诸国').dir;
    const victim = entries.find((e) => e.name.startsWith(`worlds/${dir}/`))!;
    (victim.data as Uint8Array)[Math.floor((victim.data as Uint8Array).length / 2)] ^= 0xff;
    const broken = path.join(OUT, `${r.tag}-全部-坏一个.civworld`);
    writeFileSync(broken, new Uint8Array(await (await writeZip(entries, ZIP_LOCAL_MAX_BYTES)).arrayBuffer()));
    await goHome(page);
    await pick(page, broken);
    await toastIs(page, ['已放回 2 个世界', '其中 1 个和原来的内容不一样，另存成了新的', '个原来就有，没重复放', '1 个读不出来，跳过了'], '一个放回、一个另存、几个原来就有、坏一个不影响别的', WAIT);
    await shot(r, page, '20-放回全部-放好了');
  });

  await step('只带上配方的世界', async () => {
    // 更旧的版本建的、又没有原件:存不了内容,只能带配方
    const old = { ...worldSave(11, '更旧的世界'), generator: GENERATOR_VERSION - 1 };
    await goHome(page);
    await pick(page, writeJson(`${r.tag}-更旧`, old));
    await worldReady(page);
    await goHome(page);
    await page.waitForTimeout(2000);
    await saveAll();
    if (r.device === '手机') await toastIs(page, ['文件准备好了', '其中 1 个只带上了配方，打开时要重新算'], '手机:说只带上了配方', WAIT);
    else await toastIs(page, ['个世界已存成一个文件', '其中 1 个只带上了配方，打开时要重新算'], '电脑:说只带上了配方', WAIT);
    await page.locator('.toast .toast-x').click();
  });
  return file;
}

async function troubles(r: Run, ctx: BrowserContext, page: Page, saved: string) {
  const good = new Uint8Array(readFileSync(saved));
  const name = `文明与地图-${NAME}.civworld`;
  const write = (dir: string, bytes: Uint8Array) => {
    const d = path.join(OUT, `${r.tag}-${dir}`);
    mkdirSync(d, { recursive: true });
    const f = path.join(d, name);
    writeFileSync(f, bytes);
    return f;
  };
  await step('文件坏了', async () => {
    await goHome(page);
    const flip = good.slice();
    flip[Math.floor(flip.length / 2)] ^= 0xff;
    await pick(page, write('坏', flip));
    await toastIs(page, [`打不开 ${name}`, '这个文件可能没存完整，或者被改过。网站没有动它，先别删'], '改了一个字节');
    await shot(r, page, '14-打不开-文件坏了');
    await pick(page, write('断', good.slice(0, Math.floor(good.length * 0.7))));
    await toastIs(page, [`打不开 ${name}`, '这个文件可能没存完整'], '只下了一半');
    await pick(page, write('空', new Uint8Array(0)));
    await toastIs(page, [`打不开 ${name}`, '这个文件可能没存完整'], '空文件');
  });

  await step('比网站新:刷新再开', async () => {
    await goHome(page);
    await pick(page, write('新', await retouch(good, (_, m) => void (m.format = 99))));
    await toastIs(page, [`打不开「${NAME}」`, '它是新版存的，这个页面还是旧的。刷新后再打开一次这个文件，世界没有丢', '刷新页面'], '比网站新');
    await shot(r, page, '15-打不开-比网站新');
    await Promise.all([page.waitForEvent('load', { timeout: WAIT }), clickToast(page, 'reload-page')]);
    await page.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
    await pick(page, write('新', await retouch(good, (_, m) => void (m.format = 99))));
    const t = await toastIs(page, [`打不开「${NAME}」`, '它比这个网站的版本还新，网站更新后就能打开。世界没有丢'], '刷新以后还是比网站新');
    check(!t.includes('刷新页面'), '不再叫人刷新');
    await page.evaluate(() => sessionStorage.clear());
  });

  await step('内存不够,再试一次', async () => {
    await goHome(page);
    const off = await inject(ctx, 'worldFileLook', NO_MEMORY);
    await pick(page, saved);
    await toastIs(page, [`打不开 ${path.basename(saved)}`, '内存不够，读不下这个世界。文件没有坏，关掉别的页面再试', '再试一次'], '内存不够');
    await shot(r, page, '16-打不开-内存不够');
    await off();
    await clickToast(page, 'world-file-retry');
    await worldReady(page);
    check(true, '再试一次打开了');
  });

  await step('核对超时,再试一次', async () => {
    await goHome(page);
    const off = await inject(ctx, 'worldFileLook', SLOW_DIGEST(120_000));
    await pick(page, saved);
    const t = await toastIs(page, [`打不开 ${path.basename(saved)}`, '秒还没完，先停下了。不一定是文件的问题，先别删', '再试一次'], '真等到时限', 120_000);
    check(/核对了 \d+ 秒/.test(t), t);
    await shot(r, page, '17-打不开-超时');
    await off();
    await clickToast(page, 'world-file-retry');
    await worldReady(page);
    check(true, '再试一次打开了');
  });

  await step('后台线程崩了,再试一次', async () => {
    await goHome(page);
    const off = await inject(ctx, 'worldFileLook', CRASH);
    await pick(page, saved);
    await toastIs(page, [`打不开 ${path.basename(saved)}`, '读的时候出错了。不一定是文件的问题，先别删', '再试一次'], '线程崩了');
    await off();
    await clickToast(page, 'world-file-retry');
    await worldReady(page);
    check(true, '再试一次打开了');
  });

  await step('这一版读不了', async () => {
    await goHome(page);
    const off = await inject(ctx, 'worldFileLook', CANT_CONVERT);
    await pick(page, write('读不了', good));
    await toastIs(page, [`打不开 ${name}`, '文件是好的，只是这一版网站读不了它。网站没有动它，先别删'], '这一版读不了');
    await shot(r, page, '18-打不开-这一版读不了');
    await off();
  });
}

async function storage(r: Run, page: Page, saved: string) {
  if (r.tag.startsWith('chromium')) {
    await step('打开文件:浏览器存储真的满了', async () => {
      const ctx = await newContext(r);
      const p = await newPage(ctx);
      // 要在网站第一次碰浏览器存储之前设
      const cdp = await ctx.newCDPSession(p);
      await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(BASE).origin, quotaSize: 200_000 });
      await goHome(p);
      await pick(p, saved);
      await toastIs(p, [`已打开存档「${NAME}」`, '浏览器存储已满，这个世界没存进去，这个文件先别删'], '世界照样打开,说没存进去', WAIT);
      await goHome(p);
      check((await cardCount(p)) === 0, '没存进「我的世界」');
      await ctx.close();
    });
  }

  await step('自动存存不下:提示条、菜单、存成文件', async () => {
    await openCard(page, NAME);
    await page.evaluate(`
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).startsWith('wenming-ditu:world:')) throw new DOMException('full', 'QuotaExceededError');
        return set.call(this, k, v);
      };
    `);
    // 给一个国家改名:自动存写不进去
    if (r.device === '手机') {
      await openMenu(r, page);
      await closeMenu(page);
    }
    await page.locator('text=/\\d+ 年立国/').first().click();
    await page.locator('[data-act="rename"]:visible').first().click({ timeout: 20_000 });
    await page.locator('.ins-edit input:visible').first().fill('饕餮城');
    await page.keyboard.press('Enter');
    await toastIs(page, ['没能自动存档', '浏览器存储已满。存成文件就不会丢，或者删掉几个世界', '存成文件'], '提示条');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await shot(r, page, '06-存储满了-提示条');
    await openMenu(r, page);
    await page.waitForTimeout(800);
    const small = await page.locator('.save-menu [data-act="save-file"] small').innerText();
    check(small === '存下整个世界。换台设备、发给别人，看到的都一模一样', `菜单不写大小:${small}`);
    await shot(r, page, '07-存储满了-存档菜单');
    await closeMenu(page);
    // 写不进浏览器也能存下整个世界:文件里有刚才的改动
    if (r.device === '电脑') {
      const d = await downloadOf(page, () => page.locator('.toast').filter({ hasText: '没能自动存档' }).locator('button.toast-act').click());
      const text = readFileSync(d.path, 'utf8');
      check(d.name.endsWith('.civworld') && text.includes('饕餮城'), `存出来的文件带着刚才的改动:${d.name}`);
    }
    await page.evaluate(`Storage.prototype.setItem = set`).catch(() => {});
  });
}

async function phone(r: Run, ctx: BrowserContext, page: Page, saved: string) {
  await step('选择框不灰掉', async () => {
    await goHome(page);
    const accept = await page.locator('[data-testid=save-file-input]').getAttribute('accept');
    const multiple = await page.locator('[data-testid=save-file-input]').getAttribute('multiple');
    check(multiple !== null, '能多选');
    if (r.device === '手机' || r.tag.startsWith('webkit')) check(accept === null, `手机、Safari 不限后缀(accept=${accept})`);
    else check(accept === '.civworld,.json,application/json', `电脑上的限制(${accept})`);
  });
  if (r.device !== '手机') return;

  await step('手机:大文件', async () => {
    const big = path.join(OUT, `${r.tag}-大.civworld`);
    writeFileSync(big, await padded(new Uint8Array(readFileSync(saved)), 60));
    await goHome(page);
    await renameCard(page, NAME, `${NAME}乙`);
    await pick(page, big);
    await worldReady(page);
    await openMenu(r, page);
    await page.locator('.save-menu [data-act="save-file"]').click();
    const t = await toastIs(page, ['文件准备好了，', '存到手机不花流量，发给别人才花', '存到手机'], '超过 50 MB 多说一句', WAIT);
    check(/文件准备好了，\d+ MB/.test(t), t);
    await shot(r, page, '28-手机-大文件');
    const d = await downloadOf(page, () => clickToast(page, 'save-to-phone'), path.join(OUT, `${r.tag}-大-存回.civworld`));
    check(readFileSync(d.path).length > 60e6, '存出来还是这么大');
    await renameCard(page, `${NAME}乙`, NAME);
  });

  await step('手机:分享菜单(模拟 iPhone)', async () => {
    await openCard(page, NAME);
    await page.evaluate(() => {
      const nav = navigator as any;
      nav.canShare = () => true;
      nav.share = async (d: { files: File[] }) => {
        (window as any).__shared = (window as any).__refuse ? null : { name: d.files[0].name, size: d.files[0].size };
        if ((window as any).__refuse) throw new DOMException('no', 'AbortError');
      };
      (window as any).__refuse = true;
    });
    await openMenu(r, page);
    await page.locator('.save-menu [data-act="save-file"]').click();
    await page.locator('.toast [data-act="save-to-phone"]').waitFor({ timeout: WAIT });
    await clickToast(page, 'save-to-phone');
    await page.waitForTimeout(500);
    check(!!(await page.locator('.toast [data-act="save-to-phone"]').count()), '分享菜单里点了取消:提示条留着,还能再点');
    await page.evaluate(() => {
      (window as any).__refuse = false;
    });
    await clickToast(page, 'save-to-phone');
    await page.waitForFunction(() => (window as any).__shared, null, { timeout: 10_000 });
    const got = await page.evaluate(() => (window as any).__shared);
    check(got.name === `文明与地图-${NAME}.civworld` && got.size > 1000, `分享的是这个文件:${got.name}`);
    await page.waitForTimeout(300);
    check(!(await page.locator('.toast [data-act="save-to-phone"]').count()), '分享完提示条收起');
    void ctx;
  });

  await step('微信、QQ 的小窗口', async () => {
    const c2 = await r.browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 MicroMessenger/8.0.40 Mobile Safari/537.36' });
    const p2 = await newPage(c2);
    await goHome(p2);
    await pick(p2, saved);
    await worldReady(p2);
    await goHome(p2);
    await p2.locator('[data-act="save-all"]').click();
    await toastIs(p2, ['这里存不了文件', '微信、QQ 里的小窗口不让存'], '说存不了,不白打包');
    await c2.close();
  });
}

for (const b of BROWSERS) {
  const browser = await (b === 'webkit' ? webkit : chromium).launch();
  for (const device of DEVICES as Device[]) {
    const r: Run = { browser, tag: `${b}-${device}`, device };
    say(`\n=========== ${b} ${device}`);
    const ctx = await newContext(r);
    const page = await newPage(ctx);
    const given = savedPath(r);
    let saved = existsSync(given) && !ONLY.includes('存') ? given : '';
    await step('准备世界', () => prepare(r, page));
    if (ONLY.includes('存')) saved = await saving(r, ctx, page);
    if (saved) {
      if (ONLY.includes('开')) await opening(r, ctx, page, saved);
      if (ONLY.includes('出错')) await troubles(r, ctx, page, saved);
      if (ONLY.includes('满')) await storage(r, page, saved);
      if (ONLY.includes('手机')) await phone(r, ctx, page, saved);
    } else check(false, '没有存出文件,后面的不跑');
    if (ONLY.includes('全部')) await allWorlds(r, ctx, page);
    await ctx.close();
  }
  await browser.close();
}

await new Promise<void>((resolve) => srv.httpServer?.close(() => resolve()) ?? resolve());
say(fails.length ? `\n没过 ${fails.length} 项:\n${fails.map((f) => `  ${f}`).join('\n')}` : '\n全过');
process.exit(fails.length ? 1 : 0);

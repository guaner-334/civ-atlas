/**
 * pnpm build && npx tsx scripts/space-check.ts [--browsers=chromium,webkit] [--devices=电脑,手机] [--only=平常,快满,满了,放名字,个数,防丢,小窗口,火狐] [--shots=<目录>] [--profiles=<目录> | --temp] [--volume=<目录>]
 *
 * --profiles 放浏览器配置,写满时占硬盘;--temp 用临时配置,关了就没了。
 * 快满只换了 estimate 的回答:调额度的开关不改它,小硬盘上它也不变。小窗口、火狐只换了浏览器标记。手机是模拟的。
 * WebKit 的满了要 --volume,一个 2 GB 小磁盘映像挂上的目录,一个设备一个、跑一遍换一个,写满的 APFS 连清空文件都不肯(WebKit 没有调额度的办法):hdiutil create -size 2g -fs APFS -type SPARSE …、hdiutil attach … -mountpoint …
 */
import { closeSync, mkdirSync, openSync, statSync, statfsSync, truncateSync, writeFileSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { chromium, devices, webkit, type BrowserContext, type Page } from 'playwright';
import { preview } from 'vite';
import { makeSave, worldCheck, type SaveFile } from '../src/gen/savefile';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BROWSERS = (opt('browsers') ?? 'chromium,webkit').split(',');
const DEVICES = (opt('devices') ?? '电脑,手机').split(',') as Device[];
const ONLY = (opt('only') ?? '平常,快满,满了,放名字,个数,防丢,小窗口,火狐').split(',');
const OUT = path.resolve(opt('out') ?? 'snaps/space-check');
const SHOTS = opt('shots') ? path.resolve(opt('shots')!) : null;
const PROFILES = path.resolve(opt('profiles') ?? path.join(OUT, 'profiles'));
const VOLUME = opt('volume');
const TEMP = args.includes('--temp');
mkdirSync(OUT, { recursive: true });
mkdirSync(PROFILES, { recursive: true });
const WAIT = 180_000;

type Device = '电脑' | '手机';
type Kind = 'chromium' | 'webkit';

const fails: string[] = [];
let lastPage: Page | null = null;
const say = (...a: unknown[]) => console.log(...a);
const check = (ok: boolean, what: string) => {
  say(`  ${ok ? '过' : '没过'}  ${what}`);
  if (!ok) fails.push(what);
};
const same = (got: unknown, want: unknown, what: string) => check(JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got) === JSON.stringify(want) ? what : `${what}:是 ${JSON.stringify(got)},该是 ${JSON.stringify(want)}`);

async function step(name: string, f: () => Promise<void>) {
  say(`\n-- ${name}`);
  try {
    await f();
  } catch (e) {
    check(false, `${name}:${(e as Error).message.split('\n')[0]}`);
    if (SHOTS && lastPage) {
      mkdirSync(SHOTS, { recursive: true });
      await lastPage.screenshot({ path: path.join(SHOTS, `出错-${name.replace(/[^\p{L}\p{N}-]/gu, '-')}.png`) }).catch(() => {});
    }
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

const NAME = '塞雷尼亚';
const WORLDS: { seed: number; title: string; civSeed?: number }[] = [
  { seed: 7, title: NAME },
  { seed: 7, title: `${NAME}（二）`, civSeed: 5 },
  { seed: 2024, title: '九州大陆' },
  { seed: 11, title: '南海诸国' },
  { seed: 99, title: '北境王朝' },
  { seed: 1009, title: '群岛纪元' },
];

function worldFile(w: (typeof WORLDS)[number]): string {
  const params = { ...DEFAULT_PARAMS, seed: w.seed };
  const edits = { names: {}, interventions: [], terrain: [], ...(w.civSeed === undefined ? {} : { civSeed: w.civSeed }) };
  const save: SaveFile = makeSave(params, edits, worldCheck(generateWorld(params)), w.title);
  const f = path.join(OUT, `${w.title}.json`);
  writeFileSync(f, JSON.stringify(save));
  return f;
}
const FILES = new Map(WORLDS.map((w) => [w.title, worldFile(w)]));

const fileFor = (title: string) => FILES.get(title)!;

let seq = 0;
const IPHONE = devices['iPhone 13'];

interface Run {
  ctx: BrowserContext;
  page: Page;
  device: Device;
  kind: Kind;
  tag: string;
  dir: string;
}

async function open(kind: Kind, device: Device, name: string, o: { quota?: number; userAgent?: string; root?: string } = {}): Promise<Run> {
  const dir = TEMP && !o.root ? '' : path.join(o.root ?? PROFILES, `${name}-${kind}-${device}-${process.pid}-${++seq}`);
  if (dir) mkdirSync(dir, { recursive: true });
  const common = { acceptDownloads: true, locale: 'zh-CN', ...(o.userAgent ? { userAgent: o.userAgent } : {}) };
  const phone = kind === 'webkit' ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE.userAgent } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  const ctx = await (kind === 'webkit' ? webkit : chromium).launchPersistentContext(dir, device === '电脑' ? { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, ...common } : { ...phone, ...common });
  // 自动化的 WebKit 说能分享文件,点了却等不到回音
  await ctx.addInitScript(() => {
    (navigator as unknown as { canShare?: unknown }).canShare = undefined;
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('pageerror', (e) => check(false, `页面报错:${e.message.slice(0, 200)}`));
  lastPage = page;
  if (o.quota !== undefined) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(BASE).origin, quotaSize: o.quota });
  }
  return { ctx, page, device, kind, tag: `${kind}-${device}`, dir };
}

async function shot(r: Run, board: string) {
  if (!SHOTS) return;
  await r.page.waitForTimeout(350);
  const [num, ...rest] = board.split('-');
  const dir = path.join(SHOTS, r.kind);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${num}-${r.device}-${rest.join('-')}.jpg`), await r.page.screenshot({ type: 'jpeg', quality: 82 }));
}

async function goHome(page: Page) {
  await page.goto(BASE);
  await page.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
  const tab = page.locator('[data-tab="civs"]');
  if (await tab.count()) await tab.click({ timeout: 10_000 });
}

/** 不刷新回到「我的世界」:正开着的世界还在 */
async function backHome(page: Page) {
  // 手机上国家的小卡开着时看不到回去的按钮
  if (!(await page.locator('[data-act="home"]:visible').count())) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  if (!(await page.locator('[data-act="home"]:visible').count()) && (await page.locator('[data-act="world-sheet"]').count())) {
    await page.locator('[data-act="world-sheet"]').first().click();
    await page.waitForTimeout(500);
  }
  await page.locator('[data-act="home"]:visible').first().click({ timeout: 20_000 });
  await page.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
  await page.locator('[data-tab="civs"]').click({ timeout: 10_000 });
}

async function worldReady(page: Page) {
  await page.waitForFunction(() => new URLSearchParams(location.search).has('w') && (window as any).__wf?.ready && (window as any).__wfCiv?.ready, null, { timeout: WAIT });
  await page.waitForTimeout(1500);
}

const worldId = (page: Page) => page.evaluate(() => new URLSearchParams(location.search).get('w'));

/** 等这个世界的内容真的存进了仓库 */
async function stored(page: Page, id: string | null, timeout = 60_000) {
  await page.waitForFunction(
    async (x) => {
      const { store } = await (window as any).__wfNotes();
      return !!(await store.vaultCall('latestOf', [x]).catch(() => null));
    },
    id,
    { timeout, polling: 500 },
  );
}

/** 从文件打开一个世界,等它存好 */
async function addWorld(page: Page, title: string, o: { wait?: boolean } = {}) {
  await page.setInputFiles('[data-testid=save-file-input]', fileFor(title));
  await worldReady(page);
  if (o.wait !== false) await stored(page, await worldId(page));
}

async function addWorlds(page: Page, titles: readonly string[]) {
  for (const t of [...titles].reverse()) {
    await goHome(page);
    await addWorld(page, t);
  }
  await goHome(page);
}

const cardOf = (page: Page, title: string) => page.locator('.mw-card').filter({ has: page.locator('.mw-name', { hasText: new RegExp(`^${title}$`) }) }).first();

async function openCard(page: Page, title: string) {
  await goHome(page);
  await cardOf(page, title).locator('[data-act="open-world"]').click();
  await worldReady(page);
}

async function renameCard(page: Page, from: string, to: string) {
  await cardOf(page, from).locator('.mw-open').dispatchEvent('contextmenu');
  await page.locator('.mw-menu [data-act="world-rename"]').click();
  await page.locator('.mw-title-input').fill(to);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

async function downloadOf(page: Page, doIt: () => Promise<unknown>): Promise<string> {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: WAIT }), doIt()]);
  const file = path.join(OUT, `${++seq}-${d.suggestedFilename()}`);
  await d.saveAs(file);
  return file;
}

/** 点一下存成文件;手机上还要在提示条上点「存到手机」 */
async function saveBy(r: Run, click: () => Promise<unknown>): Promise<string> {
  if (r.device === '电脑') return downloadOf(r.page, click);
  await click();
  await r.page.locator('.toast [data-act="save-to-phone"]').waitFor({ timeout: WAIT });
  return downloadOf(r.page, () => r.page.locator('.toast [data-act="save-to-phone"]').click());
}

const toastText = async (page: Page, has: string | RegExp, timeout = 60_000) => {
  const el = page.locator('.toast').filter({ hasText: has }).first();
  await el.waitFor({ timeout });
  return (await el.innerText()).replace(/\s*\n\s*/g, ' / ');
};

const barText = async (page: Page, wait = 8000): Promise<string | null> => {
  const el = page.locator('[data-space-bar]');
  await el.waitFor({ timeout: wait }).catch(() => {});
  return (await el.count()) ? (await el.locator('.mwn-txt').innerText()).replace(/\s*\n\s*/g, ' / ') : null;
};
/** 确认没有那一条:仓库的代码过一会儿才下载,要等够 */
const noBar = async (page: Page, what: string) => {
  await page.waitForTimeout(2200);
  const t = await barText(page, 10);
  check(t === null, `${what}${t ? `(现在是「${t}」)` : ''}`);
};
const headLink = (page: Page) => page.locator('.mw-heading [data-act="save-all"]').count();

async function openWindow(page: Page) {
  await page.locator('[data-act="space-open"]').first().click({ timeout: 20_000 });
  await page.locator('[data-testid="space-dialog"]').waitFor({ timeout: 30_000 });
  await page.waitForFunction(() => !!document.querySelector('[data-testid="space-sum"]')?.textContent?.trim() && !!document.querySelector('[data-testid="space-dialog"] .acct-small'), null, { timeout: 60_000 });
  await page.waitForTimeout(600);
}
const closeWindow = async (page: Page) => {
  await page.keyboard.press('Escape');
  await page.locator('[data-testid="space-dialog"]').waitFor({ state: 'detached', timeout: 10_000 });
};
const sum = (page: Page) => page.locator('[data-testid="space-sum"]').innerText();
const rows = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="space-dialog"] .sz-list[role=list] .sz-row')].map((r) => ({
      id: (r as HTMLElement).dataset.id,
      name: r.querySelector('.sz-name')?.textContent ?? '',
      sub: r.querySelector('.sz-sub')?.textContent ?? '',
      warn: !!r.querySelector('.sz-sub.warn'),
      size: r.querySelector('.sz-size')?.textContent ?? '',
    })),
  );
const notes = (page: Page) => page.locator('[data-testid="space-dialog"] .acct-small').allInnerTexts();
const rowOf = (page: Page, name: string) => page.locator('[data-testid="space-dialog"] .sz-list[role=list] .sz-row').filter({ has: page.locator('.sz-name', { hasText: new RegExp(`^${name}$`) }) });
const hasMeter = (page: Page) => page.locator('.sz-meter').count();

const SIZE_NOTE = '这里的大小比存成文件时大，因为浏览器里多留了一份备用。同一张地图上的文明共用一份地图，删掉其中一个，腾出来的比写的少一点。';
const CHROME_NOTE = '硬盘快满时，浏览器可能先清掉这里的世界。存成文件就不会丢。';
const bytesOf = (size: string) => {
  const m = /([\d.]+) (KB|MB|GB)/.exec(size);
  return m ? Number(m[1]) * { KB: 1e3, MB: 1e6, GB: 1e9 }[m[2] as 'KB'] : 0;
};

async function fillIdb(page: Page, leave = 0): Promise<number> {
  await page.evaluate('globalThis.__name ??= (f) => f');
  return page.evaluate(async (keep) => {
    const db = await new Promise<IDBDatabase | null>((res) => {
      const r = indexedDB.open('filler', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('x');
      r.onsuccess = () => res(r.result);
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
    const room = async () => {
      const e = await navigator.storage.estimate();
      return (e.quota ?? 0) - (e.usage ?? 0);
    };
    let total = 0;
    let n = Date.now();
    for (const size of [16e6, 4e6, 1e6, 256e3, 64e3, 16e3, 4e3]) {
      while (total < 3e9 && (!keep || (await room()) > keep + size) && (await put(n++, size))) total += size;
    }
    db.close();
    return total;
  }, leave);
}

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

/** 硬盘写到只剩 room 字节:一点都不剩时库连删除都提交不了 */
function fillDisk(dir: string, room: number): void {
  const file = path.join(dir, 'filler.bin');
  const fd = openSync(file, 'a');
  const left = () => {
    const st = statfsSync(dir);
    return st.bavail * st.bsize;
  };
  for (const size of [64e6, 16e6, 4e6, 1e6]) {
    const chunk = randomBytes(size);
    try {
      while (left() > room + size) writeSync(fd, chunk);
    } catch {
      /* 下一档小的接着写 */
    }
  }
  closeSync(fd);
  const over = room - left();
  if (over > 0) truncateSync(file, Math.max(0, statSync(file).size - over));
  say(`  硬盘写到只剩 ${(left() / 1e6).toFixed(1)} MB`);
}

/** 改一个国家的名字:改动真的存一次 */
async function openSaveMenu(r: Run) {
  if (r.device === '手机' && !(await r.page.locator('.ps-tiles').count())) {
    await r.page.locator('[data-act="world-sheet"]').click();
    await r.page.waitForTimeout(500);
  }
  await r.page.locator('.save-btn:visible').first().click();
  await r.page.waitForSelector('.save-menu');
  await r.page.waitForTimeout(300);
}

async function renameCountry(r: Run, to: string) {
  if (r.device === '手机' && !(await r.page.locator('.ps-tiles').count())) {
    await r.page.locator('[data-act="world-sheet"]').click();
    await r.page.waitForTimeout(500);
    await r.page.locator('.save-btn:visible').first().click();
    await r.page.keyboard.press('Escape');
    await r.page.waitForTimeout(200);
  }
  await r.page.locator('text=/\\d+ 年立国/').first().click();
  await r.page.locator('[data-act="rename"]:visible').first().click({ timeout: 20_000 });
  await r.page.locator('.ins-edit input:visible').first().fill(to);
  await r.page.keyboard.press('Enter');
  await r.page.waitForTimeout(800);
}

// ---------------------------------------------------------------------------

async function plain(kind: Kind, device: Device) {
  const r = await open(kind, device, 'plain');
  const { page } = r;
  await step(`平常:${r.tag}`, async () => {
    await goHome(page);
    await page.waitForTimeout(800);
    same(await page.locator('[data-act="space-open"]').count(), 0, '一个世界都没有:没有入口');
    await noBar(page, '一个世界都没有:没有那一条');
    await shot(r, '03-空的时候');

    await addWorld(page, NAME);
    await goHome(page);
    await page.locator('[data-act="space-open"]').waitFor({ timeout: 10_000 });
    await shot(r, '04-只有一个世界');
    await noBar(page, '一个世界:只多那行小字');

    await addWorlds(page, WORLDS.slice(1).map((w) => w.title));
    const entry = await page.locator('[data-act="space-open"]').innerText();
    check(/^占了 [\d.]+ (MB|GB)$/.test(entry.trim()), `入口的字:${entry}`);
    same(await page.locator(device === '电脑' ? '.mw-foot .mwf-size' : '.mw-open-file + .mwf-phone').count(), 1, '入口的位置');
    await shot(r, '01-入口-页面最下面');

    await openWindow(page);
    await shot(r, '05-占了多少-平常');
    const first = await sum(page);
    check(/^这个浏览器里占了 [\d.]+ (MB|GB)，最多还能存约 [\d.]+ GB。$/.test(first), `第一句:${first}`);
    same(await hasMeter(page), 0, '地方够的时候不画进度条');
    const list = await rows(page);
    same(list.length, 6, '每个世界一行');
    const sizes = list.map((x) => bytesOf(x.size));
    check(sizes.every((s, i) => s > 1e6 && (i === 0 || sizes[i - 1] >= s)), `从大到小:${list.map((x) => x.size).join(' ')}`);
    check(list.every((x) => x.sub === '还没存过文件'), '都还没存过文件');
    same(await notes(page), [SIZE_NOTE, CHROME_NOTE], '小字');

    await saveBy(r, () => rowOf(page, '九州大陆').locator('[data-act="space-save"]').click());
    await page.waitForFunction(() => [...document.querySelectorAll('.sz-sub')].some((x) => x.textContent === '今天存过文件'), null, { timeout: 10_000 });
    same((await rows(page)).filter((x) => x.sub === '今天存过文件').map((x) => x.name), ['九州大陆'], '点了存成文件:这一行写今天存过');
    await closeWindow(page);
    await renameCard(page, '九州大陆', '大九州');
    await openWindow(page);
    same((await rows(page)).find((x) => x.name === '大九州')?.sub, '今天存过，之后改过', '存过又改过');
    await closeWindow(page);
    await page.reload();
    await page.locator('[data-tab="civs"]').click();
    await openWindow(page);
    same((await rows(page)).find((x) => x.name === '大九州')?.sub, '今天存过，之后改过', '刷新以后记录还在');

    // 窗口开着也要点得到提示条上的「撤销」
    await rowOf(page, '群岛纪元').locator('[data-act="space-delete"]').click();
    await page.locator('.toast [data-act="world-undelete"]').click({ timeout: 5000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.sz-name')].some((x) => x.textContent === '群岛纪元'), null, { timeout: 5000 });
    check(true, '删除后在窗口上面点撤销,世界回来了');
    await rowOf(page, '群岛纪元').locator('[data-act="space-delete"]').click();
    await page.locator('[data-testid="space-gone"]').waitFor({ timeout: 10_000 });
    const held = await page.locator('[data-testid="space-gone"] .sz-sub').innerText();
    check(held.includes('现在还不能清'), `撤销提示开着:说还不能清(${held})`);
    check(await page.locator('[data-act="space-clear"]').isDisabled(), '撤销提示开着:现在清掉点不了');
    await page.locator('.toast').filter({ hasText: '已删除' }).waitFor({ state: 'detached', timeout: 15_000 });
    await page.waitForFunction(() => !document.querySelector('[data-testid="space-gone"] .sz-sub')?.textContent?.includes('现在还不能清'), null, { timeout: 10_000 });
    const gone = await page.locator('[data-testid="space-gone"] .sz-sub').innerText();
    check(/^1 个，\d+ 月 \d+ 日前自己清掉$/.test(gone), `删掉的世界那一行:${gone}`);
    await shot(r, '06-占了多少-有删掉的世界');
    same(await notes(page), [SIZE_NOTE], '有删掉的世界时的小字');
    await page.waitForTimeout(3200);
    await page.locator('[data-act="space-clear"]').click();
    await page.locator('[data-testid="space-gone"]').waitFor({ state: 'detached', timeout: 20_000 });
    check(true, '现在清掉:那一行没了');

    await saveBy(r, () => page.locator('[data-act="space-save-all"]').click());
    await page.waitForFunction(() => [...document.querySelectorAll('.sz-sub')].every((x) => x.textContent === '今天存过文件'), null, { timeout: 10_000 });
    check(true, '全部存成文件:每一行都写今天存过');
    await closeWindow(page);
    await noBar(page, '不是苹果设备:不说防丢');
    same(await headLink(page), 1, '标题下的蓝字还在');

    // 打开网址、没存进「我的世界」的世界:存成文件也是整个世界
    await page.goto(`${BASE}?seed=321`);
    await page.waitForFunction(() => (window as any).__wf?.ready && (window as any).__wfCiv?.ready, null, { timeout: WAIT });
    await page.waitForTimeout(1500);
    await openSaveMenu(r);
    same(await page.locator('[data-testid="save-status"]').innerText(), '还没存进我的世界；改了名字或历史就会自动存', '没存进我的世界');
    const file = await saveBy(r, () => page.locator('.save-menu [data-act="save-file"]').click());
    check(file.endsWith('.civworld') && statSync(file).size > 1e6, `存下整个世界:${path.basename(file)},${(statSync(file).size / 1e6).toFixed(1)} MB`);
  });
  await r.ctx.close();
}

async function nearly(device: Device) {
  const r = await open('chromium', device, 'near');
  const { page } = r;
  const fakeLeft = (left: number) =>
    page.addInitScript((room) => {
      
      navigator.storage.estimate = async () => {
        
        return { usage: 840e6, quota: 840e6 + room };
      };
    }, left);
  await step(`快满了:${r.tag}`, async () => {
    await addWorlds(page, [NAME, '九州大陆']);
    await noBar(page, '才用了一点:不说快满了');
    await fakeLeft(160e6);
    await goHome(page);
    const text = await barText(page);
    check(/^快放不下了，最多还能存约 \d+ MB \/ 一个世界约 10 MB。不常看的世界存成文件再删掉，就能腾出地方$/.test(text ?? ''), `那一条:${text}`);
    same(await headLink(page), 0, '这时蓝字收起来');
    await shot(r, '07-快满了-我的世界');
    await openWindow(page);
    check(/^这个浏览器里占了 [\d.]+ (MB|GB)，最多还能存约 \d+ MB。$/.test(await sum(page)), `第一句:${await sum(page)}`);
    check((await hasMeter(page)) === 1, '有进度条');
    same(await notes(page), ['不常看的世界存成文件再删掉，就能腾出地方。这台设备剩的地方不多，别的应用也在用。'], '小字');
    check(await page.locator('[data-act="space-save-all"].blue').count() === 1, '全部存成文件是蓝的');
    await shot(r, '08-快满了-占了多少');
    await closeWindow(page);
    await page.locator('[data-act="space-bar-close"]').click();
    await noBar(page, '关掉了');
    same(await headLink(page), 1, '关掉以后蓝字回来');
    await page.reload();
    await noBar(page, '刷新以后也不说');
    await fakeLeft(60e6);
    await page.reload();
    check(((await barText(page)) ?? '').startsWith('快放不下了'), `剩下的少了一半多:再说一次(${await barText(page)})`);
  });
  await r.ctx.close();
}

const SAFARI_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

/** safari:Chromium 换上 Safari 的浏览器标记。真的小硬盘上 WebKit 连库都打不开,腾不腾地方都写不进去,走不到接着存 */
async function fullUp(kind: Kind, device: Device, safari = false) {
  const onVolume = kind === 'webkit';
  const noRoom = onVolume || safari;
  const r = await open(kind, device, 'full', onVolume ? { root: VOLUME! } : { quota: 60e6, ...(safari ? { userAgent: SAFARI_UA } : {}) });
  const { page } = r;
  await step(`满了:${r.tag}${safari ? '(Safari 标记)' : ''}`, async () => {
    await addWorlds(page, [NAME, '九州大陆']);
    if (onVolume) fillDisk(VOLUME!, 3e6);
    else await fillIdb(page);

    // 打开一个新世界:配方存得下,内容写不进去
    await goHome(page);
    await addWorld(page, '南海诸国', { wait: false });
    await page.waitForFunction(async () => (await (window as any).__wfNotes()).store.vaultIsFull(), null, { timeout: 90_000, polling: 500 });
    check(true, '真的写不下了');
    check((await toastText(page, '没能自动存档')).includes('浏览器存储已满。存成文件就不会丢，或者删掉几个世界'), '世界页:提示条说满了');
    check((await page.locator('.toast').filter({ hasText: '没能自动存档' }).locator('.toast-act').count()) === 1, '世界页:提示条上有存成文件');

    await backHome(page);
    await page.waitForTimeout(800);
    const text = await barText(page);
    check(/^浏览器存储已满，\d+ 个世界没存上 \/ (它们|它)现在还能看。全部存成文件就不会丢，或者删掉几个世界$/.test(text ?? ''), `我的世界:那一条(${text})`);
    same(await page.locator('.toast').filter({ hasText: '没能自动存档' }).count(), 0, '回到我的世界:提示条换成这一条,不说两句');
    same(await headLink(page), 0, '蓝字收起来');
    if (!safari) await shot(r, '09-满了-我的世界');
    await openWindow(page);
    check((await sum(page)).endsWith('已经放不下了。'), `窗口第一句:${await sum(page)}`);
    same(await hasMeter(page), noRoom ? 0 : 1, noRoom ? 'Safari 上不画进度条' : '进度条');
    const list = await rows(page);
    check(list[0]?.warn && list[0].sub === '内容没存上，以后要重新算', `没存上的排最前面:${JSON.stringify(list[0])}`);
    same((await notes(page))[0], '标着「没存上」的世界现在还能看。存成文件就不会丢，或者删掉几个世界，腾出地方后会接着存。', '小字');
    if (!safari) await shot(r, '10-满了-占了多少');

    // 满了也存得成文件
    const file = await saveBy(r, () => page.locator('[data-act="space-save-all"]').click());
    check(statSync(file).size > 10e6, `满了时全部存成文件:${(statSync(file).size / 1e6).toFixed(1)} MB`);
    await closeWindow(page);

    // 删掉一个:撤销提示收起后马上腾,接着存
    await openWindow(page);
    await rowOf(page, '九州大陆').locator('[data-act="space-delete"]').click();
    await page.locator('.toast').filter({ hasText: '已删除' }).waitFor({ timeout: 5000 });
    await page.locator('.toast').filter({ hasText: '已删除' }).waitFor({ state: 'detached', timeout: 15_000 });
    // 硬盘快满时 WebKit 要多留一点才肯写,一个世界腾出来的不够
    if (onVolume) {
      await rowOf(page, NAME).locator('[data-act="space-delete"]').click();
      await page.locator('.toast').filter({ hasText: '已删除' }).waitFor({ timeout: 5000 });
      await page.locator('.toast').filter({ hasText: '已删除' }).waitFor({ state: 'detached', timeout: 15_000 });
    }
    await closeWindow(page);
    await page.waitForFunction(async () => !(await (window as any).__wfNotes()).store.vaultIsFull(), null, { timeout: 60_000, polling: 500 });
    check(true, '撤销提示收起后腾出了地方');
    if (onVolume) {
      say('  真的小硬盘上写满后库打不开,接着存这一步看 Safari 标记那一轮');
      return;
    }
    await page.waitForFunction(() => !document.querySelector('[data-space-bar="full"]'), null, { timeout: 120_000, polling: 1000 });
    check(true, '接着存上了,那一条没了');
    await openWindow(page);
    await page.waitForFunction(() => !document.querySelector('.sz-sub.warn'), null, { timeout: 120_000, polling: 500 });
    check(true, '窗口里不再标没存上');
    await closeWindow(page);
  });
  await r.ctx.close();
}

async function cabinet(device: Device) {
  const r = await open('chromium', device, 'cabinet');
  const { page } = r;
  await step(`放名字的地方满了:${r.tag}`, async () => {
    await addWorlds(page, [NAME]);
    await openCard(page, NAME);
    await fillLocal(page);
    await renameCountry(r, '饕餮城');
    check((await toastText(page, '没能自动存档')).includes('浏览器存储已满'), '世界页:提示条');
    await backHome(page);
    check(((await barText(page)) ?? '').startsWith('浏览器存储已满，1 个世界没存上'), `我的世界:那一条(${await barText(page)})`);
    await openWindow(page);
    check(/最多还能存约/.test(await sum(page)), `窗口第一句照常:${await sum(page)}`);
    same((await rows(page))[0]?.sub, '改动没存上，关掉页面就没了', '那一行');
    same(await notes(page), ['放世界名字、封面和 AI 写的文字的地方满了。这部分浏览器只给约 5 MB，和上面的数字不是一回事。删掉几个世界就能腾出来，存成文件腾不出来。'], '小字');
    await shot(r, '11-满了-放名字的地方满了');
    await closeWindow(page);
  });
  await r.ctx.close();
}

async function atCount(device: Device) {
  const r = await open('chromium', device, 'count');
  const { page } = r;
  await step(`到了 60 个:${r.tag}`, async () => {
    await goHome(page);
    const worlds = Array.from({ length: 60 }, (_, i) => ({ save: makeSave({ ...DEFAULT_PARAMS, seed: 100 + i }, { names: {}, interventions: [], terrain: [] }, '', `世界 ${i + 1}`) }));
    const file = path.join(OUT, '六十个.json');
    writeFileSync(file, JSON.stringify({ app: worlds[0].save.app, bundle: 1, worlds }));
    await page.setInputFiles('[data-testid=save-file-input]', file);
    await toastText(page, '已放回 60 个世界');
    await page.locator('[data-tab="civs"]').click();
    const text = await barText(page);
    same(text, '「我的世界」最多存 60 个，已经存满了 / 新的世界存不进来，现在的不受影响。存成文件再删掉几个，就能接着存', '那一条');
    await shot(r, '12-到了六十个');
    same(await page.locator('[data-space-bar] [data-act="save-all"]').count(), 1, '有全部存成文件');
    await page.locator('[data-act="space-bar-close"]').click();
    await noBar(page, '关掉了');
    same(await headLink(page), 1, '蓝字回来');
  });
  await r.ctx.close();
}

async function loseIt(device: Device) {
  const r = await open('webkit', device, 'lose');
  const { page } = r;
  const iphone = device === '手机';
  const RISK = iphone ? '在 iPhone 上，连续 7 天没打开这个网站，世界可能会被清掉。' : '用 Safari 时，连续 7 天没打开这个网站，世界可能会被清掉。';
  const KEEP = iphone ? '存成文件放进手机，就不会丢。' : '存成文件放在电脑里，就不会丢。';
  await step(`防丢:${r.tag}`, async () => {
    await goHome(page);
    const persisted = await page.evaluate(() => navigator.storage?.persisted?.());
    say(`  这个 WebKit 的 persisted:${String(persisted)}`);
    // 第一次存世界:说一次
    await addWorld(page, NAME, { wait: false });
    const first = await toastText(page, '世界存在这个浏览器里', 60_000);
    check(first.startsWith("世界存在这个浏览器里 / 7 天没打开这个网站可能被清掉，存成文件就不会丢 / 存成文件"), `世界页:第一次存世界说一次(${first})`);
    await shot(r, '18-防丢-第一次存世界');
    await page.locator('.toast').filter({ hasText: '世界存在这个浏览器里' }).locator('.toast-x').click();
    await openSaveMenu(r);
    same(await page.locator('[data-testid="save-status"]').innerText(), '已自动存在这个浏览器里，7 天没打开可能被清掉', '存档菜单多半句');
    await shot(r, '19-防丢-存档菜单');
    await page.keyboard.press('Escape');

    await addWorlds(page, WORLDS.slice(1).map((w) => w.title));
    const text = await barText(page);
    same(text, `这 6 个世界还没存成文件 / ${RISK}${KEEP}`, '那一条');
    same(await headLink(page), 0, '蓝字收起来');
    const entry = (await page.locator('[data-act="space-open"]').innerText()).trim();
    check(/^占了 [\d.]+ MB$/.test(entry), `Safari 上入口是世界自己加起来的:${entry}`);
    await shot(r, '15-防丢-我的世界');

    await openWindow(page);
    check(/^这个浏览器里占了 [\d.]+ MB。$/.test(await sum(page)), `Safari 上不写还能存多少:${await sum(page)}`);
    same(await hasMeter(page), 0, 'Safari 上不画进度条');
    same(await notes(page), [`${RISK}${KEEP}`, SIZE_NOTE], '窗口小字');
    await shot(r, '22-防丢-占了多少');
    await closeWindow(page);

    // 点了以后
    if (iphone) {
      await page.locator('[data-space-bar] [data-act="save-all"]').click();
      await page.locator('.toast [data-act="save-to-phone"]').waitFor({ timeout: WAIT });
      check(((await barText(page)) ?? '').length > 0, '手机上:点「存到手机」之前那一条还在');
      await shot(r, '21-防丢-点了-存好了');
      await downloadOf(page, () => page.locator('.toast [data-act="save-to-phone"]').click());
    } else {
      void page
        .locator('.toast.k-progress')
        .waitFor({ timeout: 8000 })
        .then(() => shot(r, '20-防丢-点了-正在存'))
        .catch(() => {});
      await downloadOf(page, () => page.locator('[data-space-bar] [data-act="save-all"]').click());
      await toastText(page, '6 个世界已存成一个文件');
      await shot(r, '21-防丢-点了-存好了');
    }
    await noBar(page, '存好了:那一条收起');
    same(await headLink(page), 1, '蓝字回来');
    await openWindow(page);
    check((await rows(page)).every((x) => x.sub === '今天存过文件'), '每一行都写今天存过');
    same((await notes(page))[0], `${RISK}你已经存过文件，清掉了也能放回来。`, '窗口小字换了');
    await shot(r, '23-防丢-存好以后');
    await closeWindow(page);

    // 打开一个世界再回来:不算改过
    await openCard(page, '九州大陆');
    await page.waitForTimeout(1500);
    await goHome(page);
    await noBar(page, '打开看一眼不算改过');

    // 又改过:不到 14 天不说
    await renameCard(page, '九州大陆', '大九州');
    await page.reload();
    await noBar(page, '又改过,没到 14 天:不说');

    // 时间过去了(这一步是改记录造的)
    await page.evaluate(() => {
      const rec = JSON.parse(localStorage.getItem('civ-atlas:file-saved')!);
      for (const k of Object.keys(rec)) rec[k].at -= 18 * 86400e3;
      localStorage.setItem('civ-atlas:file-saved', JSON.stringify(rec));
    });
    await page.reload();
    same(await barText(page), `有 1 个世界上次存文件以后又改过 / 上次存文件是 18 天前。${RISK}再存一次就不会丢。`, '过了 14 天:再说一次');
    await page.locator('[data-tab="civs"]').click();
    await shot(r, '17-防丢-隔一阵再说');
    await page.locator('[data-act="space-bar-close"]').click();
    await noBar(page, '关掉了');
    await page.reload();
    await noBar(page, '刷新以后也不说');
    await page.evaluate(() => localStorage.setItem('civ-atlas:lose-off', String(Date.now() - 29 * 86400e3)));
    await page.reload();
    await noBar(page, '关了 29 天:还不说');
    await page.evaluate(() => localStorage.setItem('civ-atlas:lose-off', String(Date.now() - 31 * 86400e3)));
    await page.reload();
    check(((await barText(page)) ?? '').startsWith('有 1 个世界'), '关了 31 天:再说');
  });
  await r.ctx.close();
}

async function small(device: Device) {
  const r = await open('chromium', device, 'small', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.50' });
  const { page } = r;
  await step(`QQ、微信的小窗口:${r.tag}`, async () => {
    await addWorlds(page, [NAME]);
    same(await barText(page), '这个小窗口里的世界可能留不久 / 到手机浏览器里打开这个网站，新建的世界才留得住。', '那一条');
    same(await page.locator('[data-space-bar] .mwn-acts').count(), 0, '没有按钮');
  });
  await r.ctx.close();
}

async function firefox(device: Device) {
  const r = await open('chromium', device, 'firefox', { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0' });
  const { page } = r;
  await step(`Firefox 没答应:${r.tag}`, async () => {
    await addWorlds(page, [NAME]);
    await page.evaluate(() => localStorage.setItem('civ-atlas:persist-asked', '1'));
    await page.reload();
    await noBar(page, '不弹');
    await openWindow(page);
    same((await notes(page))[0], '你没有答应 Firefox 长期保存。硬盘快满时，它可能先清掉这里的世界。存成文件就不会丢。', '窗口里写一句');
    await shot(r, '24-Firefox拒绝-窗口里写一句');

    // 删掉最后一个世界:内容还占着地方,窗口不能关,不然这一页就没有入口了
    await rowOf(page, NAME).locator('[data-act="space-delete"]').click();
    await page.locator('[data-testid="space-gone"]').waitFor({ timeout: 10_000 });
    same(await page.locator('[data-testid="space-dialog"]').count(), 1, '删掉最后一个世界:窗口还在,能看到删掉的世界');
    await page.locator('.toast').filter({ hasText: '已删除' }).waitFor({ state: 'detached', timeout: 15_000 });
    await page.waitForTimeout(3200);
    await page.locator('[data-act="space-clear"]').click();
    await page.locator('[data-testid="space-dialog"]').waitFor({ state: 'detached', timeout: 20_000 });
    check(true, '现在清掉以后什么都没了:窗口自己关');
  });
  await r.ctx.close();
}

for (const device of DEVICES) {
  if (BROWSERS.includes('chromium')) {
    if (ONLY.includes('平常')) await plain('chromium', device);
    if (ONLY.includes('快满')) await nearly(device);
    if (ONLY.includes('满了')) {
      await fullUp('chromium', device);
      await fullUp('chromium', device, true);
    }
    if (ONLY.includes('放名字')) await cabinet(device);
    if (ONLY.includes('个数')) await atCount(device);
    if (ONLY.includes('小窗口')) await small(device);
    if (ONLY.includes('火狐')) await firefox(device);
  }
  if (BROWSERS.includes('webkit')) {
    if (ONLY.includes('防丢')) await loseIt(device);
    if (ONLY.includes('满了') && VOLUME) await fullUp('webkit', device);
  }
}

await new Promise<void>((resolve) => srv.httpServer?.close(() => resolve()) ?? resolve());
say(fails.length ? `\n没过 ${fails.length} 项:\n${fails.map((f) => `  ${f}`).join('\n')}` : '\n全过');
process.exit(fails.length ? 1 : 0);

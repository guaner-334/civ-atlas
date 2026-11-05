/**
 * 要两版代码才走得到,同一个端口、同一份浏览器配置先后跑:
 *
 *   npx tsx scripts/old-world-check.ts --phase=make  --profile=<目录> [--port=5198] [--browsers=chromium,webkit] [--devices=desktop,phone]    现在的代码:建几个世界存下来
 *   (另开一份代码,升 GENERATOR_VERSION,改生成地图和推演的算法)
 *   npx tsx scripts/old-world-check.ts --phase=check --profile=<目录> --root=<那份代码> [--shots=<目录>] [--only=kept,recipe]                    点界面,逐项比
 *
 * 走不到真实流程、直接改状态的写在各段开头。没过的打印「没过」,退出码非 0。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, webkit, type BrowserContext, type BrowserContextOptions, type BrowserType, type Page } from 'playwright';
import { createServer } from 'vite';
import { encodeShare, makeSave, type SaveFile } from '../src/gen/savefile';
import { EMPTY_EDITS, type WorldEdits } from '../src/gen/edits';
import { DEFAULT_PARAMS } from '../src/gen/world';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const PHASE = opt('phase') ?? 'make';
const PROFILE = path.resolve(opt('profile') ?? 'snaps/old-world');
const ROOT = path.resolve(opt('root') ?? process.cwd());
const SHOTS = opt('shots') ? path.resolve(opt('shots')!) : null;
const PORT = Number(opt('port') ?? 5198);
const BROWSERS = (opt('browsers') ?? 'chromium,webkit').split(',');
const DEVICES = (opt('devices') ?? 'desktop,phone').split(',');
const ONLY = (opt('only') ?? 'kept,recipe').split(',');
const BASE = `http://127.0.0.1:${PORT}/`;
const WAIT = 240_000;

const NAME = '塞雷尼亚';
const COPY = `${NAME}（新版）`;

const VIEWS: Record<string, BrowserContextOptions> = {
  desktop: { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, acceptDownloads: true },
};

const fails: string[] = [];
const say = (...a: unknown[]) => console.log(...a);
const check = (ok: boolean, what: string) => {
  say(`  ${ok ? '过' : '没过'}  ${what}`);
  if (!ok) fails.push(what);
};

const save0 = (seed: number, title: string, edits: Partial<WorldEdits> = {}): SaveFile => makeSave({ ...DEFAULT_PARAMS, seed }, { ...EMPTY_EDITS, ...edits }, '', title);
/** 只有配方的旧世界 */
const oldSave = (seed: number, title: string, generator: number, check = ''): SaveFile => ({ ...save0(seed, title), generator, check });

/** 一个设备上的页面和常用动作 */
class Drive {
  phone: boolean;
  constructor(
    public page: Page,
    public tag: string,
    public device: string,
  ) {
    this.phone = device === 'phone';
  }
  async shot(name: string) {
    if (!SHOTS) return;
    await this.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
    await this.page.waitForTimeout(350);
    mkdirSync(path.join(SHOTS, this.tag), { recursive: true });
    await this.page.screenshot({ path: path.join(SHOTS, this.tag, `${name}-${this.device === 'phone' ? '手机' : '电脑'}.jpg`), type: 'jpeg', quality: 80 });
  }
  has = (text: string) => this.page.locator(`text=${text}`).first().isVisible();
  sees = (text: string, timeout = WAIT) =>
    this.page
      .locator(`text=${text}`)
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(
        () => true,
        () => false,
      );
  async seen(text: string, what: string, timeout = WAIT) {
    check(await this.sees(text, timeout), `${what}:看到「${text.slice(0, 30)}」`);
  }
  async ready() {
    await this.page.waitForFunction(() => (window as any).__wf?.ready && (window as any).__wfCiv?.ready, null, { timeout: WAIT });
    await this.page.waitForFunction(() => (window as any).__wfLabels?.ready, null, { timeout: 30000 }).catch(() => {});
    await this.page.waitForTimeout(800);
  }
  async home() {
    await this.page.goto(BASE);
    await this.page.locator('[data-tab="civs"]').click({ timeout: WAIT });
    await this.page.waitForTimeout(500);
  }
  card = (title: string) => this.page.locator('.mw-card').filter({ has: this.page.locator('.mw-name', { hasText: new RegExp(`^${title}$`) }) }).first();
  async open(title: string) {
    await this.home();
    await this.card(title).locator('[data-act="open-world"]').click();
    await this.ready();
  }
  /** 打开一个 .json 存档;fresh = 算这份代码的版本建的 */
  async openFile(save: SaveFile, name: string, fresh = true) {
    const file = path.join(PROFILE, `${this.tag}-${name}.json`);
    await this.page.goto(BASE);
    const generator = fresh ? await this.page.evaluate(async () => (await import('/src/gen/edits.ts' as string)).GENERATOR_VERSION as number) : save.generator;
    writeFileSync(file, JSON.stringify({ ...save, generator }));
    await this.page.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
    await this.page.setInputFiles('[data-testid=save-file-input]', file);
    await this.page.waitForFunction(() => new URLSearchParams(location.search).has('w') && (window as any).__wf?.ready, null, { timeout: WAIT });
    await this.ready();
    return this.worldId();
  }
  worldId = () => new URL(this.page.url()).searchParams.get('w')!;
  /** 手机:世界卡片拉上来 / 收下去 */
  async setSheet(to: 'full' | 'peek') {
    if (!this.phone) return;
    await this.page.evaluate(async (t) => (await import('/src/ui/panelStore.ts' as string)).setWorldSheet(t), to);
    await this.page.waitForTimeout(500);
  }
  sheet = () => this.setSheet('full');
  async menu() {
    await this.sheet();
    await this.page.locator('.save-btn:visible').first().click();
    await this.page.waitForSelector('.save-menu');
    await this.page.waitForTimeout(300);
  }
  async closeMenu() {
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(150);
  }
  /** 点一行地形大事 */
  async upheaval() {
    await this.sheet();
    const row = this.page.locator('[data-act="upheaval"]:visible').first();
    await row.scrollIntoViewIfNeeded();
    await row.click();
  }
  /** 排几条命令,点「全部推演」 */
  async queue(n: number) {
    const errs = await this.page.evaluate(async (k) => {
      const m = await import('/src/ui/pendingStore.ts' as string);
      const stamp = Date.now() % 90000;
      const out: (string | null)[] = [];
      for (let i = 0; i < k; i++) out.push(m.queueIntervention({ kind: 'protect', a: `polity:c${stamp + i}#0`, from: 100 + i * 50, until: 600 + i * 50 }, `第 ${i + 1} 条`));
      return out.filter(Boolean);
    }, n);
    if (errs.length) throw new Error(`排不进单子:${errs.join('、')}`);
    await this.page.waitForTimeout(300);
  }
  async push() {
    await this.setSheet('peek');
    await this.page.locator('[data-act="iv-push"]:visible').first().click();
    await this.page.waitForSelector('[data-testid=frozen-ask]', { timeout: 10000 });
    await this.page.waitForTimeout(350);
  }
  ask = () => this.page.locator('[data-testid=frozen-ask]');
  async cancelAsk() {
    await this.ask().locator('button', { hasText: '取消' }).click();
    await this.page.waitForTimeout(250);
  }
  go = () => this.ask().locator('[data-act=frozen-save]').click();
  saveOf = (id: string) => this.page.evaluate(async (i) => ((await import('/src/ui/saveStore.ts' as string)).loadWorld(i) as { save: SaveFile } | null)?.save ?? null, id);
  current = () => this.page.evaluate(async () => (await import('/src/ui/saveStore.ts' as string)).currentWorld() as { id: string; frozen?: number; readonly?: boolean; oldRecipe?: unknown } | null);
  /** 仓库里最新一份:地图那一块的指纹、哪一版算的 */
  head = (id: string) =>
    this.page.evaluate(async (i) => {
      const m = await import('/src/ui/worldStore.ts' as string);
      const h = await m.vaultCall('latestOf', [i]);
      if (!h) return null;
      return { generator: h.generator as number, map: (h.content as string).split('|').find((x: string) => x.startsWith('map:')) ?? '', content: h.content as string };
    }, id);
  toast = () => this.page.locator('.toast').first();
  async clearToasts() {
    await this.page.evaluate(async () => (await import('/src/ui/toastStore.ts' as string)).clearToast());
    await this.page.evaluate(async () => {
      const m = await import('/src/ui/toastStore.ts' as string);
      for (const id of ['save', 'world-file', 'edit-block', 'open-trouble']) m.clearToast(id);
    });
  }
}

const NAME_SHIM = 'window.__name = (f) => f;';
/** 灰着写原因的按钮不是真的 disabled(playwright 的 isDisabled 把 aria-disabled 也算上,这里看属性本身) */
const realDisabled = (l: ReturnType<Page['locator']>) => l.evaluate((x) => (x as HTMLButtonElement).disabled);

async function contextFor(type: BrowserType, dir: string, device: string): Promise<BrowserContext> {
  mkdirSync(dir, { recursive: true });
  const ctx = await type.launchPersistentContext(dir, VIEWS[device]);
  await ctx.addInitScript(NAME_SHIM);
  return ctx;
}

// ---------------------------------------------------------------------------
// 现在的代码:建几个世界存下来

const MADE = [
  { seed: 7, title: NAME },
  { seed: 2024, title: '九州大陆' },
  { seed: 1009, title: '群岛纪元' },
];

async function make(type: BrowserType, tag: string, device: string) {
  say(`\n== 建世界(${tag})`);
  const ctx = await contextFor(type, path.join(PROFILE, tag), device);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
  const d = new Drive(page, tag, device);
  const waitHead = async (id: string) => {
    for (let i = 0; i < 240; i++) {
      if (await d.head(id)) return;
      await page.waitForTimeout(500);
    }
    throw new Error(`${id} 一直没存进仓库`);
  };
  for (const w of MADE) {
    const id = await d.openFile(save0(w.seed, w.title), `${w.seed}`);
    await waitHead(id);
    say(`  ${w.title} ${id}`);
  }
  // 带地形大事的
  const up = await d.openFile(save0(99, '北境王朝', { upheavals: [{ year: 500, ops: [{ kind: 'volcano', pts: [1310, 763], r: 60, s: 1.5 }] }] }), '99');
  await waitHead(up);
  // 上次有改动没推完就关了:关掉页面时还没推完,存档里多几条
  const pending = await d.openFile(save0(11, '南海诸国'), '11');
  await waitHead(pending);
  await page.waitForTimeout(4000);
  await page.evaluate(async () => {
    const s = await import('/src/ui/saveStore.ts' as string);
    const c = s.currentWorld();
    const w = s.loadWorld(c.id);
    const interventions = [0, 1, 2].map((i) => ({ kind: 'protect', a: `polity:c88888${i}#0`, from: 100 + i * 50, until: 600 + i * 50 }));
    s.detachWorld();
    s.overwriteWorld(c.id, { ...w.save.edits, interventions });
  });
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 升了版本以后:照原样打开的旧世界、另存出来的世界

async function sceneKept(type: BrowserType, tag: string, device: string) {
  say(`\n== 照原样打开的旧世界、另存的世界(${tag})`);
  const ctx = await contextFor(type, path.join(PROFILE, tag), device);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
  const d = new Drive(page, tag, device);
  const gen = await page.goto(BASE).then(() => page.evaluate(async () => (await import('/src/gen/edits.ts' as string)).GENERATOR_VERSION as number));
  check(gen > 57, `这份代码升了版本(第 ${gen} 版)`);

  // ---- 打开、存档菜单、推演窗口
  await d.open(NAME);
  check((await d.current())?.frozen === 57, '旧世界照原样打开');
  const oldId = d.worldId();
  const saveBefore = JSON.stringify(await d.saveOf(oldId));
  const headBefore = await d.head(oldId);
  check(!(await d.has('按新版算的')), '照原样打开的不说按新版算');
  await d.menu();
  await d.seen('地图不变，历史按现在的规则重推。这一份照原样留着', '存档菜单');
  check(!(await page.locator('[data-act=see-original]').count()) && !(await page.locator('[data-act=see-original-none]').count()), '照原样打开的不放看原样');
  check(await d.has('存下整个世界'), '照原样打开的还是存成文件');
  await d.shot('旧世界-存档菜单');
  await d.closeMenu();

  await d.queue(3);
  await d.push();
  check((await d.ask().innerText()).includes(`「${NAME}」是旧版本建的，一直照原样存着。新版的规则变了，推演的话地图不变，历史按新规则从第 0 年重推，整段都会不一样。`), '推演窗口:第一句');
  check((await d.ask().innerText()).includes(`原来的「${NAME}」不动；另存一份「${COPY}」，在那一份上推演这 3 条命令。`), '推演窗口:小字');
  check((await d.ask().innerText()).includes('另存并推演'), '推演窗口:按钮');
  await d.shot('10');
  await d.cancelAsk();
  check((await page.evaluate(async () => (await import('/src/ui/pendingStore.ts' as string)).getPending().length)) === 3, '取消:单子留着');
  await d.push();

  // ---- 正在另存、15
  const t0 = Date.now();
  await d.go();
  const waited = await d.sees(`正在另存「${COPY}」`, 4000);
  if (waited) {
    await d.seen('历史在从第 0 年重推，好了会自动打开', '正在另存');
    await d.shot('14');
  } else say('  (不到 1 秒就好了,没出等的那一条)');
  await d.seen(`已另存为「${COPY}」`, '另存好了');
  await d.seen('地图没变，历史按新版重推了。原来的世界照原样留着', '另存好了');
  say(`  另存到打开 ${Date.now() - t0} ms`);
  await d.ready();
  await d.shot('15');
  const keptId = d.worldId();
  check(keptId !== oldId, '另存成了新世界');
  const kept = (await d.saveOf(keptId))!;
  check(kept.generator === gen, '新世界是现在的版本');
  check(kept.edits.interventions.length === 3, '带着那 3 条命令');
  check(!!kept.edits.map?.grown, '记着地图留着');
  check(JSON.stringify(await d.saveOf(oldId)) === saveBefore, '原来的存档一个字没动');
  const hk = await d.head(keptId);
  check(hk?.map === headBefore?.map, '地图那一块的指纹没变');
  check(hk?.content !== headBefore?.content, '历史变了');
  check((await page.evaluate(async () => (await import('/src/ui/pendingStore.ts' as string)).getPending().length)) === 0, '单子跟着走了');

  // ---- 另存的世界菜单
  await d.menu();
  await d.seen(`地图留自「${NAME}」，历史按新版重推`, '另存的世界菜单');
  await d.seen('地图带不进链接，对方打不开。要发给别人，请存成文件', '另存的世界菜单');
  check(await d.has('存下整个世界'), '另存的世界菜单:存成文件和别的世界一样');
  check(!(await d.has('停在这一刻')), '另存的世界菜单:不放停在这一刻');
  check(!(await realDisabled(page.locator('.save-it[data-act=share-link]'))), '另存的世界菜单:灰着的不是 disabled');
  const smallColor = await page.locator('.save-it[data-act=share-link] small').evaluate((x) => getComputedStyle(x).opacity + getComputedStyle(x.parentElement!.parentElement!).opacity);
  check(smallColor === '11', '另存的世界菜单:小字没有跟着淡');
  await page.locator('.save-it[data-act=share-link]').click({ force: true });
  check(await page.locator('.save-menu').isVisible(), '另存的世界菜单:点灰着的没反应');
  await d.shot('16');
  await d.closeMenu();

  // ---- 登录了的菜单(造的:令牌直接写上,网址指到假服务器,服务器的回话只认登录、别的都连不上)
  await page.evaluate(() => {
    localStorage.setItem('civ-atlas:account', JSON.stringify({ token: 'x', user: { id: 'u1', account: 'a@b.c', name: '测试' } }));
  });
  await ctx.route('**/__fake-ai/**', (r) => (r.request().url().endsWith('/v1/me') ? r.fulfill({ status: 200, json: { user: { id: 'u1', account: 'a@b.c', name: '测试' }, credits: 0, pricing: { note: '' } } }) : r.abort()));
  await page.goto(`${BASE}?w=${keptId}&aiServer=fake`);
  await d.ready();
  await d.menu();
  check((await page.locator('.save-it[data-act=share]').innerText()).includes('地图带不进链接'), '登录了的菜单:分享灰着写原因');
  await d.shot('17');
  await d.closeMenu();
  await page.evaluate(() => localStorage.removeItem('civ-atlas:account'));
  await ctx.unroute('**/__fake-ai/**');
  await page.goto(`${BASE}?w=${keptId}`);
  await d.ready();

  // ---- 地形大事
  await d.sheet();
  const upRow = page.locator('[data-act="upheaval"]:visible').first();
  check((await upRow.innerText()).includes('不能加'), '地形大事:右边写不能加');
  check(!(await realDisabled(upRow)), '地形大事:能点');
  await upRow.scrollIntoViewIfNeeded();
  await upRow.click({ force: true });
  await d.seen('这个世界不能再改地形大事', '地形大事');
  await d.seen('它的地图是旧世界留下的，一改就要重新长。要加大事，到原来那个世界上加', '地形大事');
  check(!(await page.evaluate(async () => (await import('/src/ui/upheavalStore.ts' as string)).getUpUi().on)), '地形大事:面板没打开');
  await d.shot('19');
  await d.clearToasts();

  // ---- 世界设定、想换个样子
  await page.locator('[data-act="genesis"]:visible').first().click();
  await page.waitForSelector('.ov-settings', { timeout: 30000 });
  await d.seen(`可以以「${COPY}」为底稿另建一个世界：设定带过去，地图按新版重新长，和这里的不一样。`, '想换个样子');
  await page.locator('.ov-seg [data-tab="map"]').click();
  await d.seen(`留自「${NAME}」`, '世界设定');
  await d.seen('这张地图是旧世界留下的，不会再按种子重新长。', '世界设定');
  await d.shot('18');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---- 国家卡片上的复制配方链接
  await page.evaluate(async () => (await import('/src/ui/shareMoment.tsx' as string)).copyMomentLink());
  await d.seen('这个世界的地图带不进链接', '卡片上的配方链接');
  await d.seen('要发给别人，请到「存档」里存成文件', '卡片上的配方链接');
  await d.clearToasts();

  // ---- 打开、改名、重推:地图不变
  await page.evaluate(async (i) => (await import('/src/ui/saveStore.ts' as string)).renameWorld(i, '换了名字'), keptId);
  await page.waitForTimeout(4000);
  check((await d.head(keptId))?.map === headBefore?.map, '改名以后地图没变');
  await page.evaluate(async (i) => (await import('/src/ui/saveStore.ts' as string)).renameWorld(i, '塞雷尼亚（新版）'), keptId);
  await page.waitForTimeout(500);
  const before = await d.head(keptId);
  await d.queue(1);
  await d.setSheet('peek');
  await page.locator('[data-act="iv-push"]:visible').first().click();
  await page.waitForFunction(() => (window as any).__wfResim?.seq > 0, null, { timeout: WAIT }).catch(() => {});
  await d.ready();
  for (let i = 0; i < 60; i++) {
    const h = await d.head(keptId);
    if (h && h.content !== before?.content) break;
    await page.waitForTimeout(500);
  }
  const after = await d.head(keptId);
  check(after?.map === headBefore?.map, '再重推:地图没变');
  check(after?.content !== before?.content, '再重推:历史变了');

  // ---- 转得进来的不标,只有配方的才标
  await d.home();
  await page.waitForTimeout(1500);
  check(!(await d.card('九州大陆').locator('.mw-tag').count()), '旧版本但存下了内容的,卡片不标');
  check(!(await d.card(COPY).locator('.mw-tag').count()), '另存的世界,卡片不标');

  // ---- 打造新文明
  await d.home();
  await d.card(COPY).locator('[data-act="open-world"]').click({ button: 'right' });
  await page.locator('[data-act="world-new-civ"]').click();
  await d.seen('没法在这张地图上打造文明', '打造新文明');
  await d.seen('这张地图是旧世界留下的，现在长不出一样的，没法新开', '打造新文明');
  await d.shot('20');

  // ---- 链接打不开、配方文件、别的设备:干净的浏览器
  const keptNow = (await d.saveOf(keptId))!;
  const browser = await type.launch();
  const view = VIEWS[device];
  {
    const c = await browser.newContext(view);
    await c.addInitScript(NAME_SHIM);
    const p = await c.newPage();
    const x = new Drive(p, tag, device);
    await p.goto(`${BASE}?seed=${keptNow.params.seed}${await encodeShare(keptNow)}`);
    await x.seen(`打不开「${COPY}」`, '链接打不开');
    await x.seen('这个链接带不上它的地图。请对方存成文件发给你，再点「打开存档文件」选它', '链接打不开');
    check(!(await x.has('正在生成世界')), '链接打不开:进度收掉了');
    await x.shot('21');
    await c.close();
  }
  {
    const c = await browser.newContext(view);
    await c.addInitScript(NAME_SHIM);
    const p = await c.newPage();
    const x = new Drive(p, tag, device);
    await p.goto(BASE);
    await p.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
    const f = path.join(PROFILE, `${tag}-kept.json`);
    writeFileSync(f, JSON.stringify(keptNow));
    await p.setInputFiles('[data-testid=save-file-input]', f);
    await x.seen('这个文件只有配方，带不上它的地图。请对方重新存成文件发给你', '配方文件');
    check(!(await p.locator('.mw-card').count()), '配方文件:不留卡片');
    await c.close();
  }
  {
    // 造的:存档直接放进浏览器,这台没有账号服务器
    const c = await browser.newContext(view);
    await c.addInitScript(NAME_SHIM);
    const p = await c.newPage();
    const x = new Drive(p, tag, device);
    await p.goto(BASE);
    await p.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
    const id = await p.evaluate(async (s) => {
      const st = await import('/src/ui/saveStore.ts' as string);
      const i = st.newWorldId();
      st.putSyncedWorld(i, { save: JSON.stringify(s), meta: {}, thumb: null });
      return i;
    }, keptNow);
    await p.goto(`${BASE}?w=${id}`);
    await x.seen(`打不开「${COPY}」`, '别的设备');
    await x.seen('它的地图还在另一台设备上，世界没有丢。到那台存成文件，再到这里打开', '别的设备');
    await x.shot('22');
    await c.close();
  }
  await browser.close();

  // ---- 加大事窗口
  await d.open(NAME);
  await d.upheaval();
  await page.waitForSelector('[data-testid=frozen-ask]', { timeout: 10000 });
  await page.waitForTimeout(300);
  const t13 = await d.ask().innerText();
  check(t13.includes('另存一份再加地形大事？'), '加大事窗口:标题');
  check(t13.includes(`「${NAME}」是旧版本建的，一直照原样存着。地形大事要在新版长的地图上发生，所以地图和整段历史都会和原来不一样。`), '加大事窗口:第一句');
  check(t13.includes(`原来的「${NAME}」不动；另存一份「${COPY}」，到那一份上加。`), '加大事窗口:小字');
  check(t13.includes('连地图重新长'), '加大事窗口:按钮');
  await d.shot('13');
  await d.cancelAsk();
  check(!(await page.evaluate(async () => (await import('/src/ui/upheavalStore.ts' as string)).getUpUi().on)), '加大事窗口:取消了不开面板');
  await d.upheaval();
  await page.waitForSelector('[data-testid=frozen-ask]', { timeout: 10000 });
  await d.go();
  await d.seen('这是按新版长的副本，和原来可能不同，以后不会再变。原来的世界照原样留着', '加大事窗口:另存好了');
  await d.ready();
  check(await page.evaluate(async () => (await import('/src/ui/upheavalStore.ts' as string)).getUpUi().on), '加大事窗口:到新的那份上接着开面板');
  const grown = (await d.saveOf(d.worldId()))!;
  check(!grown.edits.map && grown.generator === gen, '加大事窗口:新的那份地图按新版长');
  check(JSON.stringify(await d.saveOf(oldId)) === saveBefore, '加大事窗口:原来的没动');
  await d.shot('13-之后');
  await page.evaluate(async () => (await import('/src/ui/upheavalStore.ts' as string)).closeUpheaval());

  // ---- 动了地形大事:北境王朝删一件
  await d.open('北境王朝');
  check((await d.current())?.frozen === 57, '带大事的旧世界照原样打开');
  await page.evaluate(async () => {
    const m = await import('/src/ui/editsStore.ts' as string);
    m.removeUpheaval(0);
  });
  await page.waitForSelector('[data-testid=frozen-ask]', { timeout: 10000 });
  const tT = await d.ask().innerText();
  check(tT.includes('这次动了地形大事，地图要跟着重新长，地图和整段历史都会和原来不一样。'), '动了地形大事:说地图要变');
  check(tT.includes('连地图重新长'), '动了地形大事:按钮');
  await d.cancelAsk();

  // ---- 带大事的地图不变另存
  await d.queue(1);
  await d.push();
  check((await d.ask().innerText()).includes('另存并推演'), '带大事的世界推演:地图不变');
  await d.go();
  await d.seen('已另存为「北境王朝（新版）」', '带大事的另存');
  await d.ready();
  const upCopy = (await d.saveOf(d.worldId()))!;
  check(!!upCopy.edits.map?.grown && upCopy.edits.upheavals?.length === 1, '带大事的另存:大事还在,地图留着');
  await d.sheet();
  check((await page.locator('[data-act="upheaval"]:visible').first().innerText()).includes('1 件，不能改'), '地形大事:带着大事的写 1 件，不能改');
  await d.shot('19-有大事');

  // ---- 没推完窗口:上次有改动没推完
  await d.home();
  await d.card('南海诸国').locator('[data-act="open-world"]').click();
  await d.seen('上次有 3 处改动没推完', '没推完');
  await d.ready();
  const pid = d.worldId();
  check((await d.current())?.readonly === true, '没推完:只读打开');
  // 只读状态下改名
  await page.evaluate(async (i) => (await import('/src/ui/saveStore.ts' as string)).renameWorld(i, '南海诸国'), pid);
  await d.seen('这里的改动不会存。要留下，先另存一份', '只读时改名');
  await d.shot('只读改名');
  await d.clearToasts();
  await page.evaluate(async () => {
    const t = await import('/src/ui/toastStore.ts' as string);
    t.clearToast('pending-edit');
  });
  await d.home();
  await d.card('南海诸国').locator('[data-act="open-world"]').click();
  await page.locator('[data-act=pending-go]').click({ timeout: WAIT });
  await page.waitForSelector('[data-testid=frozen-ask]', { timeout: 10000 });
  await page.waitForTimeout(300);
  const t11 = await d.ask().innerText();
  check(t11.includes('上次有 3 处改动没推完页面就关了，之后网站更新了，规则也变了。接着推演的话，地图不变，历史按新规则从第 0 年重推，整段都会不一样。'), '没推完窗口:第一句');
  check(t11.includes('不要这些改动') && t11.includes('另存一份接着推演？'), '没推完窗口:标题、按钮');
  await d.shot('11');
  await d.cancelAsk();
  await d.seen('上次有 3 处改动没推完', '没推完窗口:取消了提示条回来');
  await page.locator('[data-act=pending-go]').click();
  await page.waitForSelector('[data-testid=frozen-ask]', { timeout: 10000 });
  await d.go();
  await d.seen('已另存为「南海诸国（新版）」', '没推完窗口:另存');
  await d.ready();
  const pCopy = (await d.saveOf(d.worldId()))!;
  check(pCopy.edits.interventions.length === 3 && !!pCopy.edits.map?.grown, '没推完窗口:改动跟着走,地图留着');
  await d.open('南海诸国');
  check(!(await d.has('上次有 3 处改动没推完')), '没推完窗口:原来的不再提示');

  // ---- 没能另存:推不出来(造的:叫转存的线程报错)
  await d.open('九州大陆');
  await page.evaluate(async () => {
    const m = await import('/src/ui/worldStore.ts' as string);
    m._setWorldStore({ runner: () => ({ done: Promise.resolve({ ok: false, kind: 'failed', message: '推不出来' }), stop() {} }) });
  });
  await d.menu();
  await page.locator('[data-act=save-new]').click();
  await d.seen('没能另存', '推不出来');
  await d.seen('新的历史没推出来，原来的「九州大陆」没有动', '推不出来');
  await d.shot('没能另存');
  check(!(await page.evaluate(async () => (await import('/src/ui/saveStore.ts' as string)).listWorlds().some((w: any) => w.save.title === '九州大陆（新版）'))), '推不出来:不留打不开的世界');
  await page.reload();
  await d.ready();

  // ---- 另存的时候连点、换到别的世界
  const count = () => page.evaluate(async () => (await import('/src/ui/saveStore.ts' as string)).listWorlds().length);
  const n0 = await count();
  await page.evaluate(async () => {
    const m = await import('/src/ui/FrozenWorld.tsx' as string);
    m.saveAsNew();
    m.saveAsNew();
  });
  // 马上回我的世界
  await page.evaluate(() => history.length);
  await page.waitForTimeout(100);
  if (d.phone) {
    await d.sheet();
    await page.locator('.ps-tiles button', { hasText: '我的世界' }).first().click();
  } else await page.locator('.sb-back, [data-act=back-home], button:has-text("我的世界")').first().click();
  await d.seen('「九州大陆（新版）」另存好了', '换走了:不抢着跳');
  await d.seen('地图没变，历史按新版重推了', '换走了');
  await d.shot('换走了');
  check((await count()) === n0 + 1, '连点:只多一份');
  await page.locator('[data-act=open-copy]').click();
  await page.waitForFunction(async () => (await import('/src/ui/saveStore.ts' as string)).currentWorld()?.title === '九州大陆（新版）', null, { timeout: WAIT });
  await d.ready();
  check(true, '点「打开」打开了');

  // ---- 地图读不出来(造的:把存的内容和原件都删掉):窗口换成只有配方窗口的字
  await d.open('群岛纪元');
  const gid = d.worldId();
  await page.evaluate(async (i) => {
    await (await import('/src/ui/worldStore.ts' as string)).vaultCall('purgeWorld', [i]);
    await (await import('/src/ui/resultStore.ts' as string)).dropResults(i);
  }, gid);
  await d.menu();
  await page.locator('[data-act=save-new]').click();
  await page.waitForSelector('[data-testid=frozen-ask]', { timeout: WAIT });
  await page.waitForTimeout(300);
  const tN = await d.ask().innerText();
  check(tN.includes('只存了配方，地图没存下来') && tN.includes('连地图重新长'), '读不出地图:换成只有配方窗口 的字');
  check((await page.evaluate(async () => (await import('/src/ui/saveStore.ts' as string)).listWorlds().some((w: any) => w.save.title === '群岛纪元（新版）'))) === false, '读不出地图:人没点就不长');
  await d.go();
  await d.seen('已另存为「群岛纪元（新版）」', '读不出地图:点了才长');
  await d.ready();

  // ---- 并排试推
  await d.open(NAME);
  await page.evaluate(async () => (await import('/src/ui/compare/compareStore.ts' as string)).openCompare({ rules: { name: '少打仗', version: 1, values: {} }, kind: 'world' }));
  await page.waitForSelector('[data-act="compare-map"]', { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.locator('[data-act="compare-map"]').click();
  await d.seen(`「${NAME}」的新版地图`, '并排试推');
  await d.shot('23');

  // ---- 原来那个世界删掉以后:世界还打得开,地图还是那张,说法换成旧世界
  await page.goto(BASE);
  await page.waitForSelector('[data-testid=save-file-input]', { state: 'attached', timeout: WAIT });
  await page.evaluate(async (i) => (await import('/src/ui/saveStore.ts' as string)).deleteWorld(i), oldId);
  await d.open(COPY);
  check((await d.head(keptId))?.map === headBefore?.map, '原来的删了:地图还是那张');
  await d.menu();
  await d.seen('地图留自旧世界，历史按新版重推', '原来的删了:存档菜单');
  await d.closeMenu();
  await d.sheet();
  await page.locator('[data-act="upheaval"]:visible').first().click({ force: true });
  await d.seen('它的地图是旧世界留下的，一改就要重新长', '原来的删了:地形大事');
  check(!(await d.has('要加大事')), '原来的删了:不说到原来那个世界上加');
  await d.clearToasts();
  await page.locator('[data-act="genesis"]:visible').first().click();
  await page.waitForSelector('.ov-settings', { timeout: 30000 });
  await page.locator('.ov-seg [data-tab="map"]').click();
  await d.seen('留自旧世界', '原来的删了:世界设定');

  // ---- 存的内容读不出来(造的:存下的地图块写坏、原件删掉):先按新版算了一遍;另存算不出来时也是窗口,人点了才长
  await d.open('九州大陆');
  const bid = d.worldId();
  await page.evaluate(async (i) => {
    const m = await import('/src/ui/worldStore.ts' as string);
    const h = await m.vaultCall('latestOf', [i]);
    const sum = (h.content as string).split('|').find((x: string) => x.startsWith('map:'))!.slice(4);
    await (await import('/src/ui/resultStore.ts' as string)).dropResults(i);
    await new Promise<void>((res, rej) => {
      const q = indexedDB.open('civ-atlas:worlds');
      q.onerror = () => rej(new Error('开不了仓库'));
      q.onsuccess = () => {
        const db = q.result;
        const t = db.transaction('parts', 'readwrite');
        const store = t.objectStore('parts');
        const all = store.getAll();
        all.onsuccess = () => {
          for (const row of all.result as { key: string; data: ArrayBuffer }[]) if (row.key.includes(sum)) store.put({ ...row, data: new Uint8Array([1, 2, 3]).buffer });
        };
        t.oncomplete = () => {
          db.close();
          res();
        };
      };
    });
  }, bid);
  await page.reload();
  await d.seen('存的内容这次没读出来，先按新版算了一遍，可能和原来不同。原来的还留着', '读不出存的内容');
  await d.ready();
  check((await d.current())?.readonly === true, '读不出存的内容:只读打开');
  await page.evaluate(async (i) => (await import('/src/ui/saveStore.ts' as string)).renameWorld(i, '九州大陆'), bid);
  await d.seen('这里的改动不会存。要留下，先另存一份', '读不出存的内容:改名');
  await d.clearToasts();
  await d.menu();
  await page.locator('[data-act=save-new]').click();
  await page.waitForSelector('[data-testid=frozen-ask]', { timeout: WAIT });
  await page.waitForTimeout(300);
  check((await d.ask().innerText()).includes('连地图重新长'), '读不出存的内容:另存算不出来,问了才长');
  await d.cancelAsk();

  // ---- 怎么上作品墙(本地假服务器的作品墙)
  await page.goto(`${BASE}?gallery&aiServer=fake`);
  await page.locator('[data-act="gallery-howto"]:visible').first().click({ timeout: WAIT });
  await d.seen('复制不了配方链接的世界，把存成的文件发给管理员', '怎么上作品墙');
  await d.shot('24');
  await ctx.close();
}

// ---------------------------------------------------------------------------
// 只有配方的旧世界

async function sceneRecipe(type: BrowserType, tag: string, device: string) {
  say(`\n== 只有配方的旧世界(${tag})`);
  const ctx = await contextFor(type, path.join(PROFILE, `${tag}-recipe${opt('run') ?? ''}`), device);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on('pageerror', (e) => say('  [pageerror]', e.message.slice(0, 200)));
  const d = new Drive(page, tag, device);
  // 手机上存文件:能分享文件的浏览器出系统的分享菜单,这里点不了,走直接下载那条路
  if (d.phone) await ctx.addInitScript('Object.defineProperty(navigator, "canShare", { value: () => false, configurable: true });');
  const others = [
    [2024, '九州大陆'],
    [11, '南海诸国'],
  ] as const;
  for (const [seed, title] of others) await d.openFile(save0(seed, title), `r${seed}`);
  // 校验对不上(跨过了地形变化)、有旧版网站
  const id22 = await d.openFile(oldSave(7, NAME, 22, 'aaaaaaaaaaaa'), 'r7', false);
  check((await d.saveOf(id22))?.generator === 22, '打开不写成新版');
  check((await d.current())?.oldRecipe !== undefined, '认得出只有配方');
  const id40 = await d.openFile(oldSave(99, '北境王朝', 40), 'r99', false);
  check((await d.saveOf(id40))?.generator === 40, '没有旧版网站的也不写成新版');

  // ---- 卡片标记:读到才标
  await d.home();
  const tagged = await page.locator('.mw-card .mw-tag', { hasText: '按新版算' }).first().waitFor({ state: 'visible', timeout: 30000 }).then(
    () => true,
    () => false,
  );
  check(tagged, '卡片标记:卡片标按新版算');
  await page.waitForFunction(() => document.querySelectorAll('.mw-tag').length >= 2, null, { timeout: 30000 }).catch(() => {});
  check((await d.card(NAME).locator('.mw-tag').innerText()) === '按新版算', '卡片标记:塞雷尼亚标了');
  check(!(await d.card('九州大陆').locator('.mw-tag').count()), '卡片标记:存得下内容的不标');
  check((await d.card(NAME).locator('.mw-tag').getAttribute('title')) === '打开这个世界（只存了配方，打开时按新版算）', '卡片标记:悬停的字');
  await d.shot('01');

  // ---- 卡片菜单、06
  await d.card(NAME).locator('[data-act="open-world"]').click({ button: 'right' });
  await page.waitForTimeout(250);
  const item = page.locator('[data-act="world-file"]');
  check((await item.innerText()).replace(/\s+/g, '').includes('存配方文件几KB'), '卡片菜单:存配方文件,右边几 KB');
  const box = await page.locator('.mw-menu').boundingBox();
  check(!!box && box.x >= 0, `卡片菜单没被屏幕切掉(左边 ${Math.round(box?.x ?? -1)})`);
  await d.shot('07');
  if (d.phone) {
    await item.click();
    await page.locator('[data-act=save-to-phone]').waitFor({ timeout: 10000 });
    await d.shot('06-手机先点一下');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('[data-act=save-to-phone]').click()]);
    check(dl.suggestedFilename().endsWith('.json'), '配方文件:存的是 .json');
  } else {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), item.click()]);
    check(dl.suggestedFilename().endsWith('.json'), '配方文件:存的是 .json');
  }
  await d.seen('已存成配方文件', '配方文件');
  await d.seen('只有几 KB。对方打开时重新长一遍，可能和你看到的不一样', '配方文件');
  await d.shot('06');

  // ---- 打开提示条、自己收
  await d.card(NAME).locator('[data-act="open-world"]').click();
  await d.seen(`已打开「${NAME}」`, '打开提示条');
  await d.seen('按新版算的：', '打开提示条');
  check(await page.locator('.toast [data-act=see-original]').isVisible(), '打开提示条:有旧版网站放看原样');
  await d.ready();
  await d.shot('02');
  const gone = await page.locator('.toast', { hasText: '按新版算的' }).waitFor({ state: 'hidden', timeout: 12000 }).then(
    () => true,
    () => false,
  );
  check(gone, '打开提示条:7 秒后自己收');
  check((await d.saveOf(id22))?.generator === 22, '打开了还是第 22 版');

  // ---- 存档菜单
  await d.menu();
  await d.seen('只存了配方，看到的是按新版算的', '存档菜单');
  check((await page.locator('.save-it[data-act=save-file]').innerText()).includes('存配方文件（.json）'), '存档菜单:存配方文件');
  await d.seen('只有几 KB。对方打开时重新长一遍，可能和你看到的不一样', '存档菜单');
  await d.seen('地图和历史都按新版长一份副本，以后不再变。这一份的配方留着', '存档菜单');
  await d.seen('在新页面里用建它的那一版网站打开', '存档菜单');
  check(await d.has('停在这一刻'), '存档菜单:配方链接照旧有停在这一刻');
  await d.shot('03');

  // 看原样:旧版网站这里没有,给一页空白顶上,看新页面去了哪
  await ctx.route(/\/v\d+\/(\?|$)/, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>旧版</title>' }));
  const pop = ctx.waitForEvent('page', { timeout: 15000 });
  await page.locator('[data-act=see-original]').click();
  const np = await pop;
  await np.waitForURL(/\/v22\//, { timeout: 10000, waitUntil: 'commit' }).catch(() => {});
  const u = new URL(np.url());
  check(u.pathname.endsWith('/v22/') && u.searchParams.get('own') === '1' && u.hash.startsWith('#share='), `看原样:到第 22 版的旧网站(${u.pathname})`);
  await np.close();

  // ---- 看原样打不开(造的:删掉 CompressionStream,当成太旧的浏览器)
  await page.evaluate(() => {
    delete (globalThis as { CompressionStream?: unknown }).CompressionStream;
  });
  await d.menu();
  await page.locator('[data-act=see-original]').click();
  await d.seen('这个浏览器打不开', '看原样打不开');
  await d.seen('存下配方文件，到旧版网站点「打开存档文件」选它', '看原样打不开');
  await d.shot('05');
  if (d.phone) {
    await page.locator('[data-act=save-old-file]').click();
    await page.locator('[data-act=save-to-phone]').waitFor({ timeout: 10000 });
    await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('[data-act=save-to-phone]').click()]);
  } else {
    await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.locator('[data-act=save-old-file]').click()]);
  }
  await d.seen('已存成配方文件', '看原样打不开 存好了');
  await d.seen('到旧版网站点「打开存档文件」选它', '看原样打不开 存好了');
  check(await page.locator('[data-act=go-old-site]').isVisible(), '看原样打不开 存好了:给去旧版网站');
  await d.shot('05-存好了');
  const pop2 = ctx.waitForEvent('page', { timeout: 15000 });
  await page.locator('[data-act=go-old-site]').click();
  const np2 = await pop2;
  await np2.waitForURL(/\/v22\//, { timeout: 10000, waitUntil: 'commit' }).catch(() => {});
  check(new URL(np2.url()).pathname.endsWith('/v22/'), '去旧版网站:去对了');
  await np2.close();
  await ctx.unroute(/\/v\d+\/(\?|$)/);
  await page.reload();
  await d.ready();

  // ---- 改名、拖地图不写成新版
  await page.evaluate(async (i) => {
    (await import('/src/ui/mapWrap.ts' as string)).publishMapCenter(40);
    const s = await import('/src/ui/saveStore.ts' as string);
    s.viewChanged();
    s.renameWorld(i, '塞雷尼亚');
  }, id22);
  await page.waitForTimeout(300);
  check((await d.saveOf(id22))?.generator === 22, '拖地图、改名还是第 22 版');

  // ---- 只有配方窗口
  await d.queue(3);
  await d.push();
  const t12 = await d.ask().innerText();
  check(t12.includes(`「${NAME}」是旧版本建的，只存了配方，地图没存下来。推演的话，地图和整段历史都按新版重新长，和原来可能不同。`), '只有配方窗口:第一句');
  check(t12.includes(`另存一份「${COPY}」，在那一份上推演这 3 条命令。`), '只有配方窗口:小字');
  check(t12.includes('连地图重新长'), '只有配方窗口:按钮');
  await d.shot('12');
  await d.cancelAsk();
  await page.evaluate(async () => (await import('/src/ui/pendingStore.ts' as string)).clearPending());

  // ---- 副本:菜单上的按新版另存
  await d.menu();
  await page.locator('[data-act=save-new]').click();
  await d.seen(`已另存为「${COPY}」`, '副本');
  await d.seen('这是按新版长的副本，和原来可能不同，以后不会再变。原来的配方还留着', '副本');
  await d.ready();
  await d.shot('08');
  const grown = (await d.saveOf(d.worldId()))!;
  check(grown.generator > 22 && !grown.edits.map?.grown, '副本:副本是新版,地图不算留着');
  check((await d.saveOf(id22))?.generator === 22, '副本:原来的配方还是第 22 版');
  await d.menu();
  check(await d.has('存下整个世界'), '副本的存档菜单和别的世界一样');
  await d.closeMenu();

  // ---- 没留旧版网站
  await d.home();
  await d.card('北境王朝').locator('[data-act="open-world"]').click();
  await d.seen('按新版算的：', '没有旧版网站的:提示条');
  await d.ready();
  check(!(await page.locator('.toast [data-act=see-original]').count()), '没有旧版网站的:提示条上不放看原样');
  await d.menu();
  await d.seen('建它的那一版没留旧版网站，原样看不到了', '没留旧版网站');
  const off = page.locator('.save-it[data-act=see-original-none]');
  check(!(await realDisabled(off)), '没留旧版网站:灰着的不是 disabled');
  await off.click({ force: true });
  check(await page.locator('.save-menu').isVisible(), '没留旧版网站:点灰着的没反应');
  await d.shot('04');
  await d.closeMenu();

  // ---- 转存失败(造的:转存失败的记录直接写上,存的内容删掉;点「再存一次」是真的转)
  await d.open('九州大陆');
  const fid = d.worldId();
  const breakIt = async () => {
    await page.waitForTimeout(1500);
    await page.evaluate(async (i) => {
      const m = await import('/src/ui/worldStore.ts' as string);
      await m._settled();
      await m.vaultCall('purgeWorld', [i]);
      await m.vaultCall('patchState', [i, { status: 'failed', app: (await import('/src/ui/version.ts' as string)).APP_VERSION, error: '检查脚本写的' }]);
    }, fid);
  };
  await breakIt();
  await d.menu();
  await d.seen('内容没能存下来，现在看到的不受影响', '转存失败');
  await d.seen('上次没存成，世界本身没事。存下来以后，网站更新也不会变', '转存失败');
  check((await page.locator('.save-it[data-act=save-file]').innerText()).includes('存配方文件（.json）'), '转存失败:存配方文件');
  await d.shot('09');
  // 还是不行
  await page.evaluate(async () => {
    const m = await import('/src/ui/worldStore.ts' as string);
    m._setWorldStore({ runner: () => ({ done: Promise.resolve({ ok: false, kind: 'failed', message: '推不出来' }), stop() {} }) });
  });
  await page.locator('[data-act=save-again]').click();
  await d.seen('还是没能存下来', '再存一次:还是不行');
  await d.seen('世界本身没事，现在还能打开。网站下次更新时会再试', '再存一次:还是不行');
  await d.shot('09-还是不行');
  // 刷新:打开时线程交回来的内容存下了,就不再说
  await page.reload();
  await d.ready();
  await page.waitForTimeout(2500);
  await d.menu();
  check(!(await page.locator('[data-act=save-again]').count()), '打开时存下了:不再说');
  await d.closeMenu();
  // 再存一次,这回成
  await breakIt();
  await d.menu();
  await page.locator('[data-act=save-again]').click();
  await d.seen('「九州大陆」存好了', '再存一次:成了');
  await d.seen('以后网站更新也不会变', '再存一次:成了');
  await d.shot('09-存好了');
  await page.waitForTimeout(500);
  await d.menu();
  check(!(await page.locator('[data-act=save-again]').count()), '再存一次:成了以后不再说');
  check(await d.has('存下整个世界'), '再存一次:成了以后是存成文件');
  await ctx.close();
}

// ---------------------------------------------------------------------------

mkdirSync(PROFILE, { recursive: true });
const server = await createServer({ root: ROOT, server: { port: PORT, strictPort: true, host: '127.0.0.1', fs: { strict: false } }, logLevel: 'error' });
await server.listen();
try {
  for (const b of BROWSERS) {
    const type = b === 'webkit' ? webkit : chromium;
    for (const device of DEVICES) {
      const tag = `${b}-${device}`;
      if (PHASE === 'make') await make(type, tag, device);
      else {
        if (ONLY.includes('kept')) await sceneKept(type, tag, device);
        if (ONLY.includes('recipe')) await sceneRecipe(type, tag, device);
      }
    }
  }
} catch (e) {
  say(`没过:跑到一半出错了:${(e as Error).stack}`);
  process.exit(1);
}
void server.close();
say(fails.length ? `\n没过 ${fails.length} 项:\n${fails.join('\n')}` : '\n全过');
process.exit(fails.length ? 1 : 0);


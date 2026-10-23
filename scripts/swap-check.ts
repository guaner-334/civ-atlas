/**
 * 换上一段很长的历史、换了名字的那一下,主线程一口气最长占住多久(Long Task)。像用户一样打开种子 7 的世界(默认推 3000 年),
 * 推演年数改成要量的长度,再分别量几种情况(--cases 选,默认前三种):
 *   - extend  再推 N 年:从「长度 − 500」年再推 500 年,推好换上
 *   - resim   干预重推:在这段历史中间保护一个国家,重推完换上
 *   - load    打开存档:刷新网页,打开存着的这个世界(先按存着的推演年数推出历史换上,再带上那条干预重推、换上)
 *   - rename  改名:给第 1 号国家改个名,地图、编年史换上新名字;接着用 AI 起名的方式给第 2 号国家换个名字(编年史同样换上)
 *   - export  导出时换回原名:有 AI 起的名字时,导出菜单选「换回原名」,导出编年史(纯文本)
 *   - preview 助手"先在地图上看看":假 AI(网址 ai=mock)列好确认单以后,点「先在地图上看看」,地图换成试推演的历史
 * 每种从下命令(刷新)起,到换上以后再过 3 秒,打印这段时间里最长的一个 Long Task 和超出 50 ms 的部分加起来;
 * 改名、先看看另打印从下命令到地图上换好用了多久(文明层要是先在后台备料,等备好、画上才算换好)。
 * 开始之前先给第 0 号国家改个名(编年史要按改过的名字写);每种换上以后核对:界面用的编年史和在这一页上从头重算的逐条一样。
 *
 *   npx tsx scripts/swap-check.ts                       默认:3000、13000、60000 年,电脑,extend、resim、load
 *   --years=3000,13000                                  只量这几种长度
 *   --cases=rename,export,preview                       量哪几种
 *   --phone                                             手机:390×844 的触屏视口,CPU 减速 4 倍
 *   --seeds=7,2024                                      量哪几个种子(默认 7)
 *   --fill=cultures --map=satellite                     填色、底图(同网址的 fill=、map=;默认国家、手绘)
 *   --profile                                           顺带记 CPU 剖面,打印那段时间里主线程上算编年史共用了多久、自身耗时最多的函数,
 *                                                       和最长一段连着忙的时间花在哪(文明底图的色块、国界……,文字层的排版……)
 *   --profile-self                                      同 --profile,最长几段连着忙的时间再各列自身耗时最多的函数
 *   --dump=out.json                                     把每种换上以后界面用的编年史(全部条目)、导出的编年史写进这个文件(改前改后比对用)
 *   WF_URL=http://localhost:5173 npx tsx …              用现成的服务
 * 自动起一个临时 dev server(随机端口)。数字只在同一台机器上前后对比有意义。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium, type CDPSession, type Page } from 'playwright';
import { startDevServer } from './lib/devserver';

const args = process.argv.slice(2);
const opt = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const LENGTHS = (opt('years') ?? '3000,13000,60000').split(',').map(Number);
const CASES = new Set((opt('cases') ?? 'extend,resim,load').split(','));
const SWAPS = CASES.has('extend') || CASES.has('resim') || CASES.has('load');
const NAMES = CASES.has('rename') || CASES.has('export') || CASES.has('preview');
const phone = args.includes('--phone');
const SEEDS = (opt('seeds') ?? '7').split(',').map(Number);
/** 填色、底图(网址的 fill=、map=;不给 = 国家、手绘) */
const VIEW_Q = `${opt('fill') ? `&fill=${opt('fill')}` : ''}${opt('map') ? `&map=${opt('map')}` : ''}`;
const profile = args.includes('--profile') || args.includes('--profile-self');
/** 每个 Long Task 再列出自身耗时最多的函数 */
const profileSelf = args.includes('--profile-self');
const dumpTo = opt('dump');
const SETTLE = 3000;
const LONG_WAIT = 600_000;

/** 页面一打开就记下所有 Long Task(主线程一口气占住 ≥ 50 ms 的) */
const LONG_TASKS = `window.__lt = [];
if (PerformanceObserver.supportedEntryTypes.includes('longtask'))
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });`;

const dev = await startDevServer();
const browser = await chromium.launch();

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
const fmt = (s: Stat) => `最长 ${String(s.max).padStart(5)} ms,超出 50 ms 共 ${String(s.over).padStart(5)} ms(${s.n} 个)`;

async function newPage(): Promise<{ page: Page; cdp: CDPSession }> {
  const ctx = await browser.newContext(
    phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1600, height: 900 } },
  );
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.addInitScript(LONG_TASKS);
  const cdp = await ctx.newCDPSession(page);
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  return { page, cdp };
}

const ltSince = (page: Page, t: number) => page.evaluate((t0) => ((window as any).__lt as [number, number][]).filter((x) => x[0] + x[1] > t0), t);
const now = (page: Page) => page.evaluate(() => performance.now());
/** 地图上这份历史推到哪年(按回放导出用的那份整段历史看:读一个字段,不占主线程) */
const END = () => (window as any).__swapFs?.getFilmSource()?.full?.endYear ?? null;
const endYear = (page: Page) => page.evaluate(END);

async function waitReady(page: Page) {
  await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: LONG_WAIT });
  await page.evaluate(async () => {
    const w = window as any;
    w.__swapFs = await import('/src/ui/filmSource.ts' as string);
    w.__swapJobs = await import('/src/ui/detailJobs.ts' as string);
  });
  await page.waitForFunction(() => (window as any).__swapFs.getFilmSource()?.full?.endYear > 0, null, { timeout: LONG_WAIT });
}

/** 等文明层真的换上:过两帧(这一层收到新的历史),在后台备着的活('civ-swap',没有就不等)做完,再过一帧(画上) */
async function civShown(page: Page) {
  const frames = (n: number) =>
    page.evaluate(async (k) => {
      for (let i = 0; i < k; i++) await new Promise((done) => requestAnimationFrame(done));
    }, n);
  await frames(2);
  await page.waitForFunction(() => !(window as any).__swapJobs?.detailJobPending?.('civ-swap'), null, { timeout: LONG_WAIT, polling: 'raf' });
  await frames(1);
}

/** 界面用的编年史(整段历史的 fullChronicle;已经算过就是缓存里那份)和在这一页上从头重算的(浅拷一层,不走缓存)逐条一样吗 */
async function chronicleNow(page: Page): Promise<{ list: unknown; same: boolean; n: number }> {
  return page.evaluate(async () => {
    const rt = await import('/src/gen/civ/religionText.ts' as string);
    const ch = await import('/src/gen/civ/chronicle.ts' as string);
    const civ = (window as any).__swapFs.getFilmSource()?.full;
    const shown = rt.fullChronicle(civ);
    const build = ch.buildChronicle(civ);
    const copy = { ...civ };
    const same = JSON.stringify(shown) === JSON.stringify(rt.fullChronicle(copy)) && JSON.stringify(build) === JSON.stringify(ch.buildChronicle(copy));
    return { list: shown, same, n: shown.length };
  });
}

/** 推演年数改成 y,等重推完换上 */
async function toYears(page: Page, y: number) {
  await page.evaluate(async (v) => {
    const m = await import('/src/ui/editsStore.ts' as string);
    m.setEndYear(v);
  }, y);
  await page.waitForFunction((v) => (window as any).__swapFs.getFilmSource()?.full?.endYear === v, y, { timeout: LONG_WAIT });
  await civShown(page);
  await page.waitForTimeout(SETTLE);
}

/**
 * Long Task 里的时间花在哪:按调用栈里离叶子最近的那个认得的函数归类(文明底图的各步、文字层的各步、编年史……;
 * 都不是就记最里面那一层的源文件)
 */
const BUSY_KINDS: Record<string, string> = {
  drawTerritory: '底图 色块',
  drawBorders: '底图 国界',
  drawRoutes: '底图 道路',
  drawWarHatch: '底图 战事斜线',
  drawPlague: '底图 瘟疫',
  drawHabitat: '底图 宜居度',
  drawRegionLines: '底图 州界',
  drawSites: '底图 城址',
  drawCivOverlay: '底图 其它',
  mirrorCanvas: '底图 复制右边一份',
  civMapLayer: '文字 国名城名(civMapLayer)',
  civLabelItems: '文字 地理名(civLabelItems)',
  labelViewExtras: '文字 labelViewExtras',
  civLabelChars: '文字 civLabelChars',
  placeMap: '文字 排版(placeMap)',
  drawPlacedLabels: '文字 画字',
  drawSettlementMarks: '文字 城镇符号',
  drawWarfare: '文字 战线双剑',
  drawSelection: '选中层',
  drawHighlight: '高亮层',
  buildChronicle: '编年史',
  fullChronicle: '编年史',
  chronicleSteps: '编年史',
  fullChronicleSteps: '编年史',
};

/** 剖面和页面时钟对齐用:页面上空转 3 ms 的一个认得出名字的函数,返回它开始时的 performance.now() */
const MARK = '__swapMark';
const markNow = (page: Page) =>
  page.evaluate((name) => {
    const f = new Function(`return function ${name}() { const t = performance.now(); while (performance.now() < t + 3); return t; }`)();
    return f() as number;
  }, MARK);

/**
 * CPU 剖面:自身耗时最多的几个函数,编年史共用了多久;再把最长的三个 Long Task 各自的时间按 BUSY_KINDS 归类
 * (markAt = 停剖面前空转的那一下开始的 performance.now(),拿来把采样时间换成页面时钟)
 */
async function topFunctions(cdp: CDPSession, lt: [number, number][], markAt: number, n = 12): Promise<string[]> {
  const { profile: p } = (await cdp.send('Profiler.stop')) as any;
  const byId = new Map<number, any>(p.nodes.map((x: any) => [x.id, x]));
  const self = new Map<string, number>();
  const dt: number[] = p.timeDeltas;
  const parent = new Map<number, number>();
  for (const x of p.nodes) for (const c of x.children ?? []) parent.set(c, x.id);
  const at: number[] = [];
  for (let i = 0, t = p.startTime; i < p.samples.length; i++) at.push((t += dt[i] ?? 0) / 1000);
  // 编年史(整段史事、宗教和物产的大事)在主线程上算了多久:采样的调用栈里有这几个函数的
  const CHRON = new Set(['buildChronicle', 'fullChronicle', 'chronicleSteps', 'fullChronicleSteps', 'faithEntries', 'developmentEntries']);
  let chron = 0;
  let mark = -1;
  for (let i = 0; i < p.samples.length; i++) {
    for (let id: number | undefined = p.samples[i]; id !== undefined; id = parent.get(id)) {
      const fn = byId.get(id).callFrame.functionName;
      if (fn === MARK && mark < 0) mark = i;
      if (CHRON.has(fn)) {
        chron += (dt[i] ?? 0) / 1000;
        break;
      }
    }
  }
  for (let i = 0; i < p.samples.length; i++) {
    const node = byId.get(p.samples[i]);
    const cf = node.callFrame;
    if (cf.functionName === '(idle)' || cf.functionName === '(program)' || cf.functionName === MARK) continue;
    const key = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
  }
  const out = [`主线程上算编年史共 ${chron.toFixed(0)} ms`, ...[...self].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`)];
  if (mark < 0) return [...out, '(剖面里找不到对时钟的那一下,不分 Long Task)'];
  // 采样时间(剖面时钟)− off = 页面的 performance.now()
  const off = at[mark] - markAt;
  for (const [s, d] of [...lt].sort((a, b) => b[1] - a[1]).slice(0, 3)) {
    const kinds = new Map<string, number>();
    const selfIn = new Map<string, number>();
    for (let i = 0; i < p.samples.length; i++) {
      const t = at[i] - off;
      if (t < s || t > s + d) continue;
      let kind = '';
      let file = '';
      let id: number | undefined = p.samples[i];
      for (; id !== undefined && !kind; id = parent.get(id)) {
        const cf = byId.get(id).callFrame;
        kind = BUSY_KINDS[cf.functionName] ?? '';
        if (!file && cf.url.includes('/src/')) file = cf.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '');
        if (!file && /^\((program|garbage collector|idle)\)$/.test(cf.functionName)) file = cf.functionName;
      }
      // 文明底图是谁画的(主图 CivLayer、缩略图 App、地球仪 Globe……):往上找第一个不在 render/ 里的源文件
      if (kind.startsWith('底图'))
        for (; id !== undefined; id = parent.get(id)) {
          const u = byId.get(id).callFrame.url as string;
          if (u.includes('/src/') && !u.includes('/src/render/')) {
            kind += `(${u.replace(/^.*\/src\/(ui\/)?/, '').replace(/\?.*$/, '')})`;
            break;
          }
        }
      const k = kind || file || '(框架、浏览器)';
      kinds.set(k, (kinds.get(k) ?? 0) + (dt[i + 1] ?? 0) / 1000);
      const cf = byId.get(p.samples[i]).callFrame;
      const fk = `${cf.functionName || '(anon)'} ${cf.url.replace(/^.*\/src\//, 'src/').replace(/\?.*$/, '')}`;
      selfIn.set(fk, (selfIn.get(fk) ?? 0) + (dt[i + 1] ?? 0) / 1000);
    }
    out.push(
      `Long Task ${d.toFixed(0)} ms(${s.toFixed(0)} 起):`,
      ...[...kinds]
        .sort((x, y) => y[1] - x[1])
        .filter((x) => x[1] >= 2)
        .map(([k, v]) => `  ${v.toFixed(0).padStart(6)} ms  ${k}`),
    );
    if (profileSelf)
      out.push(
        '   自身耗时:',
        ...[...selfIn]
          .sort((x, y) => y[1] - x[1])
          .slice(0, 14)
          .map(([k, v]) => `     ${v.toFixed(0).padStart(6)} ms  ${k}`),
      );
  }
  return out;
}

async function startProfile(cdp: CDPSession) {
  if (!profile) return;
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
}
/** 停剖面、打印(lt = 这段时间里的 Long Task) */
async function endProfile(cdp: CDPSession, page: Page, lt: [number, number][]) {
  if (!profile) return;
  const markAt = await markNow(page);
  for (const l of await topFunctions(cdp, lt, markAt)) console.log('     ', l);
}

const dump: Record<string, unknown> = {};
const rows: string[] = [];
/** 换上以后核对编年史、记下来 */
async function check(page: Page, label: string) {
  const c = await chronicleNow(page);
  if (dumpTo) dump[label] = c.list;
  rows.push(`${label}  编年史 ${c.n} 条,和从头重算的${c.same ? '一样' : '不一样!'}`);
  console.log(rows.at(-1));
}
/** 给第 id 号国家改名(ai = 当作从 AI 起名里挑的) */
async function rename(page: Page, id: number, name: string, ai = false) {
  await page.evaluate(
    async ([i, n, a]) => {
      const ed = await import('/src/gen/edits.ts' as string);
      const st = await import('/src/ui/editsStore.ts' as string);
      st.setName(ed.polityKey((window as any).__swapFs.getFilmSource().full, i), n, a ? 'ai' : undefined);
    },
    [id, name, ai] as const,
  );
}
/** 地图上用的整段历史里,第 id 号国家的名字里有 name 了 */
const named = (page: Page, id: number, name: string) =>
  page.waitForFunction(([i, n]) => JSON.stringify((window as any).__swapFs.getFilmSource()?.full?.polities[i] ?? null).includes(n), [id, name] as const, { timeout: LONG_WAIT });

/** 打开一页这个种子的世界,第 0 号国家改个名(编年史按改过的名字写),推演年数改成 y */
async function openWorld(seed: number, y: number, query = '') {
  const { page, cdp } = await newPage();
  await page.goto(`${dev.url}/?seed=${seed}${VIEW_Q}${query}`);
  await waitReady(page);
  await rename(page, 0, '甲乙国');
  await page.waitForTimeout(500);
  if (y !== (await endYear(page))) await toYears(page, y);
  return { page, cdp };
}

/** 量一种:下命令(act),等地图上换好(done,文明层真的换上),再过 3 秒;打印最长的 Long Task(和从下命令到换好用了多久) */
async function measure(page: Page, cdp: CDPSession, label: string, act: () => Promise<unknown>, done: () => Promise<unknown>, lag = true) {
  const t0 = await now(page);
  await startProfile(cdp);
  await act();
  await done();
  // 文明层在后台备料的话,等它换上再开始数那 3 秒(备料、换上那一下都算在里面)
  await civShown(page);
  const t1 = await now(page);
  await page.waitForTimeout(SETTLE);
  rows.push(`${label}  ${fmt(stat(await ltSince(page, t0)))}${lag ? `,${Math.round(t1 - t0)} ms 后换好` : ''}`);
  console.log(rows.at(-1));
  await endProfile(cdp, page, await ltSince(page, t0));
}

for (const seed of SEEDS) {
  const S = SEEDS.length > 1 ? `种子 ${seed}  ` : '';
  for (const L of NAMES ? LENGTHS : []) {
    const { page, cdp } = await openWorld(seed, L, CASES.has('preview') ? '&ai=mock' : '');
    if (CASES.has('rename')) {
      await measure(page, cdp, `${S}${L} 年  改名`, () => rename(page, 1, '丙丁国'), () => named(page, 1, '丙丁'));
      await check(page, `${S}${L}-rename`);
      await measure(page, cdp, `${S}${L} 年  AI 起名`, () => rename(page, 2, '戊己国', true), () => named(page, 2, '戊己'));
      await check(page, `${S}${L}-ainame`);
      // 只分小块算一份改了名的编年史、不换上(界面不跟着重画):算的时候主线程每一块占多久
      const t0 = await now(page);
      const sliced = await page.evaluate(async () => {
        const h = await import('/src/ui/chronicleHandoff.ts' as string);
        if (!h.chronicleInSlices) return false;
        const ed = await import('/src/gen/edits.ts' as string);
        const full = (window as any).__swapFs.getFilmSource().full;
        await h.chronicleInSlices(ed.applyNames({ ...full }, { [ed.polityKey(full, 3)]: '庚辛国' }));
        return true;
      });
      if (sliced) {
        await page.waitForTimeout(500);
        rows.push(`${S}${L} 年  只分小块算编年史  ${fmt(stat(await ltSince(page, t0)))}`);
        console.log(rows.at(-1));
      }
    }
    if (CASES.has('export')) {
      // 有 AI 起的名字,导出菜单才问"换回原名"
      if (!CASES.has('rename')) {
        await rename(page, 2, '戊己国', true);
        await named(page, 2, '戊己');
        await page.waitForTimeout(SETTLE);
      }
      // 手机:导出在世界卡片的按钮里
      if (phone) {
        await page.tap('[data-act=world-sheet]');
        await page.waitForTimeout(600);
        await page.tap('.ps-tiles .export-btn');
      } else await page.click('.export-btn');
      await page.click('.export-ainames button:has-text("换回原名")');
      let text = '';
      await measure(
        page,
        cdp,
        `${S}${L} 年  导出换回原名`,
        async () => {
          const got = page.waitForEvent('download', { timeout: LONG_WAIT });
          await page.click('.export-item[data-job=txt]');
          text = readFileSync((await (await got).path())!, 'utf8');
        },
        async () => {},
        false,
      );
      // 手机:收起世界卡片(不然挡着右上的按钮)
      if (phone) await page.tap('[data-act=world-sheet]');
      if (dumpTo) dump[`${S}${L}-export`] = text;
      rows.push(`${S}${L}-export  导出的编年史 ${text.length} 字,${text.includes('戊己') ? '还带着 AI 起的名字!' : '换回了原名'}`);
      console.log(rows.at(-1));
    }
    if (CASES.has('preview')) {
      // 假 AI:查国家 → 查格局 → 试推演两次 → 列确认单(附带试推演的结果)
      await page.click(phone ? '.phone-btns [data-act=assistant]' : '.map-bar [data-act=assistant]');
      await page.fill('.ast-field textarea', '让它多撑一阵');
      await page.click('[data-act=ast-send]');
      await page.waitForSelector('[data-act=ast-preview]', { timeout: LONG_WAIT });
      await page.waitForTimeout(SETTLE);
      const real = await page.evaluate(() => ((window as any).__swapReal = (window as any).__swapFs.getFilmSource()?.full) && true);
      await measure(
        page,
        cdp,
        `${S}${L} 年  助手先看看`,
        () => page.click('[data-act=ast-preview]'),
        () =>
          page.waitForFunction(
            () => {
              const w = window as any;
              const full = w.__swapFs.getFilmSource()?.full;
              return document.querySelector('.app')?.classList.contains('ast-preview') && !!full && full !== w.__swapReal;
            },
            null,
            { timeout: LONG_WAIT },
          ),
      );
      if (real) await check(page, `${S}${L}-preview`);
      await page.click('[data-act=ast-banner-back]').catch(() => null);
    }
    await page.context().close();
  }

  for (const L of SWAPS ? LENGTHS : []) {
    const { page, cdp } = await openWorld(seed, CASES.has('extend') ? L - 500 : L);

    let t0 = 0;
    if (CASES.has('extend')) {
      // 再推 500 年
      t0 = await now(page);
      await startProfile(cdp);
      await page.evaluate(async () => {
        const m = await import('/src/ui/extendStore.ts' as string);
        m.extendStart(500);
      });
      await page.waitForFunction((v) => (window as any).__wfExtend?.to === v, L, { timeout: LONG_WAIT });
      await page.waitForTimeout(SETTLE);
      const ext = stat(await ltSince(page, t0));
      rows.push(`${S}${L} 年  再推 N 年  ${fmt(ext)}`);
      console.log(rows.at(-1));
      await endProfile(cdp, page, await ltSince(page, t0));
      await check(page, `${S}${L}-extend`);
    }

    if (CASES.has('resim')) {
      // 干预重推:保护一个在这段历史中间活着的国家,从中间那一年起
      const mid = Math.round(L / 2);
      const before = await page.evaluate(() => (window as any).__wfResim?.seq ?? 0);
      t0 = await now(page);
      await startProfile(cdp);
      const picked = await page.evaluate(async (y) => {
        const ed = await import('/src/gen/edits.ts' as string);
        const st = await import('/src/ui/editsStore.ts' as string);
        const civ = (window as any).__swapFs.getFilmSource()?.full;
        const p = civ?.polities.find((q: any) => q.founded < y - 50 && (q.ended ?? Infinity) > y + 50);
        if (!p) return null;
        st.addIntervention({ kind: 'protect', a: ed.polityKey(civ, p.id), from: y });
        return p.id as number;
      }, mid);
      if (picked === null) rows.push(`${S}${L} 年  干预重推  (找不到中间活着的国家)`);
      else {
        await page.waitForFunction((n) => ((window as any).__wfResim?.seq ?? 0) > n, before, { timeout: LONG_WAIT });
        await page.waitForTimeout(SETTLE);
        rows.push(`${S}${L} 年  干预重推  ${fmt(stat(await ltSince(page, t0)))}`);
      }
      console.log(rows.at(-1));
      await endProfile(cdp, page, await ltSince(page, t0));
      await check(page, `${S}${L}-resim`);
    }

    if (CASES.has('load')) {
      // 打开存档:刷新(存着的世界从浏览器里读回来)
      const url = page.url();
      await startProfile(cdp);
      await page.reload();
      await waitReady(page);
      const got = await endYear(page);
      // 等存着的那条干预也套上(重推完换上)
      await page.evaluate(async () => ((window as any).__swapEd = await import('/src/ui/editsStore.ts' as string)));
      await page.waitForFunction(
        () => {
          const w = window as any;
          const full = w.__swapFs.getFilmSource()?.full;
          return !!full && (full.interventions?.length ?? 0) === w.__swapEd.getEdits().interventions.length;
        },
        null,
        { timeout: LONG_WAIT },
      );
      await page.waitForTimeout(SETTLE);
      rows.push(`${S}${L} 年  打开存档  ${fmt(stat(await ltSince(page, 0)))}${got === L ? '' : `(读回来的是 ${got} 年;网址 ${url})`}`);
      console.log(rows.at(-1));
      await endProfile(cdp, page, await ltSince(page, 0));
      await check(page, `${S}${L}-load`);
    }
    await page.context().close();
  }
}
console.log(`\n${phone ? '手机(390×844,CPU 减速 4 倍)' : '电脑'}:`);
for (const r of rows) console.log(r);
if (dumpTo) writeFileSync(dumpTo, JSON.stringify(dump));
await browser.close();
await dev.close();

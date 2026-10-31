/**
 * 冒烟检查:npx tsx scripts/replay-check.ts(SMOKE_PART=2/5 只跑其中一份,见 PART_STARTS、MOVED)
 * 界面骨架(左边侧栏 + 地图、右上图层按钮、图层与投影弹层、世界概览浮层、侧栏里的详情面板)、回放、悬停、点选改名、
 * 存档读档分享、导出、干预、改地形、AI、键盘快捷键、人物(人物卡片、历代君主、编年史里的人名、人物页、世系图、搜人名)、作者标记、作者的人物、信仰图层与宗教卡片、东西相连、多种投影、地球仪、宽屏侧栏收起、浏览器的后退和前进;手机布局(390×844 触屏:底部的世界 / 详情卡片、时间轴胶囊、双指捏合)。
 * 宽屏:存档在侧栏顶上,成书、AI 设置在侧栏右上的"更多"里,导出在地图右上;创建时定下的种子、参数、地形在世界概览的"世界设定"页(只能看)
 * (点侧栏顶上的世界名打开);某一点的完整读数用 window.__wfProbe(悬停卡片只露一两行)。
 * 快慢(每帧、重推、重画的耗时)只记数、不算失败,跑完汇总(见 timing);要用到推演里某位人物、某国的段,例子按条件现找(scripts/lib/smokeExamples.ts)。
 */
import { appendFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { startDevServer } from './lib/devserver';
import { GENERATOR_VERSION } from '../src/gen/edits';
const dev = await startDevServer();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
const errs: string[] = [];
/** 宽屏(视口宽 ≥ 1100)左边浮着的侧栏卡片占掉的宽度(左边距 14 + 卡片 372 + 右边留空 14):看得见的地图从这里往右 */
const SIDE_ROOM = 400;
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));

/**
 * 打开世界概览(点侧栏顶上的世界名;窄屏是左上角的世界名),翻到某一页:countries 国家 / chronicle 编年史 /
 * interventions 我的干预 / genesis 世界设定(创建时定下的种子、参数、地形,只能看;以它为底稿新建、回放世界形成)
 */
const openOverview = async (p: Page = page, tab?: string) => {
  if (!(await p.locator('.ov-root:not([hidden])').count())) await p.click('[data-act=overview]');
  await p.locator('.ov-root:not([hidden]) .ov').waitFor({ timeout: 5000 });
  if (tab) await p.click(`.ov-tab[data-tab=${tab}]`);
  await p.waitForTimeout(200);
};
const closeOverview = async (p: Page = page) => {
  if (await p.locator('.ov-root:not([hidden])').count()) await p.click('.ov-x');
  await p.waitForTimeout(200);
};
/**
 * 宽屏左边被侧栏卡片挡住一截,看得见的地图比整张世界窄(等距圆柱左右无限拖动):世界坐标 (wx, wy) 不在看得见的地方时
 * 左右平移,把它挪到卡片右边那一块的正中;
 * 返回它的屏幕坐标
 */
const centerOn = async (p: Page, wx: number, wy: number): Promise<[number, number] | null> => {
  const at = (await p.evaluate(([x, y]) => (window as any).__wfWorldToClient(x, y), [wx, wy])) as [number, number] | null;
  const vw = p.viewportSize()!.width;
  if (!at || (at[0] > SIDE_ROOM + 60 && at[0] < vw - 60)) return at;
  await p.evaluate((dx) => {
    const v = (window as any).__wfView;
    (window as any).__wfSetView({ k: v.k, x: v.x + dx, y: v.y });
  }, SIDE_ROOM + (vw - SIDE_ROOM) / 2 - at[0]);
  await p.waitForTimeout(250);
  return (await p.evaluate(([x, y]) => (window as any).__wfWorldToClient(x, y), [wx, wy])) as [number, number] | null;
};
/** 详情面板藏起来了(在地图上选目标、正在推演):窄屏的抽屉整个藏起;宽屏侧栏里的面板留着、变淡不能点 */
const insHidden = async (p: Page = page) =>
  (await p.locator('.inspector.hidden').count()) > 0 || !(await p.locator('.inspector').isVisible().catch(() => false));
/** AI 设置(宽屏在侧栏右上的"更多"里;窄屏在概览头部) */
const openAi = async (p: Page = page) => {
  await closeOverview(p);
  await p.click('[data-act=world-more]');
  await p.click('[data-act=ai-settings]');
};
/** 生成史书窗口(宽屏在侧栏右上的"更多"里) */
const openBook = async (p: Page = page) => {
  await p.click('[data-act=world-more]');
  await p.click('[data-act=book]');
};
/** 图层与投影弹层 */
const openLayers = async (p: Page = page) => {
  if (!(await p.locator('.lp-pop').count())) await p.click('[data-act=layers]');
  await p.locator('.lp-pop').waitFor({ timeout: 5000 });
};
/** 图层面板里点开「投影」一行(投影列表、中央经线) */
const openProj = async (p: Page = page) => {
  await openLayers(p);
  if (!(await p.locator('.lp-projs').count())) await p.click('.lp-pop [data-act=projections]');
  await p.locator('.lp-projs').waitFor({ timeout: 5000 });
};
/** 旧图层名 → 底图 + 填色(数据图层 = 那种数据底图 + 不填) */
const LAYER_PARTS: Record<string, [string, string]> = {
  political: ['fantasy', 'polities'],
  cultures: ['fantasy', 'cultures'],
  faith: ['fantasy', 'faiths'],
  terrain: ['fantasy', 'none'],
  realistic: ['satellite', 'none'],
};
/** 换图层(政区 / 民族 / 地形 / 生态 / 高程 / 实景 / 板块 / 气温 / 降水):在图层面板里点底图、填色,再点按钮收起 */
const pickLayer = async (p: Page, id: string) => {
  const [base, fill] = LAYER_PARTS[id] ?? [id, 'none'];
  await openLayers(p);
  await p.click(`.lp-pop [data-base=${base}]`);
  await p.click(`.lp-pop [data-fill=${fill}]`);
  await p.click('[data-act=layers]');
};
/** 换投影(点完收起弹层) */
const pickProj = async (p: Page, id: string) => {
  await openProj(p);
  await p.click(`.lp-proj[data-proj=${id}]`);
  await p.keyboard.press('Escape');
};
/** 弹层里当前选中的投影 */
const projOn = async (p: Page = page) => {
  await openProj(p);
  const v = await p.locator('.lp-proj.on').getAttribute('data-proj').catch(() => null);
  await p.keyboard.press('Escape');
  return v;
};
/**
 * 新建界面(网址 new=1、我的世界里点「新建世界」再在弹窗里点「开始」)准备好:世界生成出来了,两边面板(手机:底部卡片)在
 */
const studioReady = async (p: Page = page) => {
  await p.locator('.studio').waitFor({ timeout: 30000 });
  await p.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await p.waitForTimeout(450);
};
/** 「我的世界」默认在「地图」页签,一个世界(文明)一张的卡片在「文明」页签:切过去(空的首页没有页签,不动) */
const civsTab = async (p: Page = page) => {
  await p.locator('.mw').waitFor({ timeout: 10000 }).catch(() => {});
  const tab = p.locator('.mw-seg [data-tab=civs]');
  if (await tab.count()) await tab.click();
};
/** 「新建世界」弹窗:第 1 步(默认随机生成)点「下一步」,第 2 步点「开始」;tap = 手机上点 */
const dialogStart = async (p: Page, tap = false) => {
  const hit = (sel: string) => (tap ? p.tap(sel) : p.click(sel));
  await p.locator('.nd-scrim').waitFor({ timeout: 5000 });
  await hit('.nd-scrim [data-act=dlg-next]');
  await hit('.nd-scrim [data-act=dlg-start]');
};
/**
 * 进入编辑地形:只有新建世界时能改(网址 new=1);点左边(手机:拉开底部卡片)的"编辑地形",卡片里换成编辑地形的工具(.tp),
 * 星球摊成平面、换成平常的平面地图铺在中间那块;转到 0° 经线在正中(主图正好铺满那一块)。
 * 已经创建的世界没有这个入口(地形是创建时定下的)
 */
const terrainOn = async (p: Page = page) => {
  await studioReady(p);
  if (await p.locator('.st-sheet.peek').count()) {
    await p.click('.st-sheet [data-act=new-sheet]');
    await p.waitForTimeout(350);
  }
  await p.click('.studio [data-act=terrain]');
  await p.locator('.tp').waitFor({ timeout: 5000 });
  await p.locator('.app.studio-flat').waitFor({ timeout: 10000 });
  await p
    .waitForFunction(
      () => {
        const st = document.querySelector('main.stage')!.getBoundingClientRect();
        const v = (window as any).__wfView;
        return !!v && Math.abs(v.sw - st.width) < 1.5 && v.k === 1;
      },
      null,
      { timeout: 5000 },
    )
    .catch(() => {});
  await p.waitForTimeout(200);
  await p.evaluate(() => (window as any).__wfSetCenter?.(0));
  await p.waitForTimeout(250);
};
/** 随机生成的新建分两步:第 1 步(地图)点「打造文明 ›」到第 2 步(文明);已经在第 2 步、照图的、以它为底稿的没有这一步 */
const toCivStep = async (p: Page = page) => {
  const next = p.locator('.studio [data-act=to-civ]');
  if (!(await next.count())) return;
  await next.click();
  await p.locator('.studio [data-act=back-to-map]').waitFor({ timeout: 5000 }).catch(() => {});
};
/** 新建界面里创建:(随机生成的先到第 2 步)点「创建世界 / 开始推演」→ 确认框里点「确认创建」→ 星球展开、新建界面淡出 */
const createNow = async (p: Page = page) => {
  await studioReady(p);
  await toCivStep(p);
  await p.click('.studio [data-act=create-world]');
  await p.click('.st-dlg [data-act=confirm-create]');
  await p.locator('.studio').waitFor({ state: 'detached', timeout: 15000 });
};
/** 回放世界形成(创建好的世界:概览"世界设定"页「地图」那一页的按钮,点了概览收起) */
const replayClick = async (p: Page = page) => {
  await openOverview(p, 'genesis');
  await p.click('.ov-seg [data-tab=map]');
  await p.click('.ov [data-act=replay]');
};
/**
 * 从文件打开:"我的世界"里有"从文件打开"(藏着的文件框);别的时候把文件拖进页面(宽屏、手机都认)
 */
const openFile = async (p: Page, file: string) => {
  if (await p.locator('[data-testid=save-file-input]').count()) return p.setInputFiles('[data-testid=save-file-input]', file);
  const text = (await import('node:fs')).readFileSync(file, 'utf8');
  const name = (await import('node:path')).basename(file);
  await p.evaluate(
    ([t, n]) => {
      const dt = new DataTransfer();
      dt.items.add(new File([t], n, { type: 'application/json' }));
      const el = document.querySelector('.app')!;
      for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    },
    [text, name],
  );
};
/** 某一点的完整读数:群落 / 海拔(水深)/ 气温降水 / 经纬度板块 / 国家 · 最近城市 / 民族 / 州(一行一条,用 " / " 连起来) */
const probe = (p: Page, x: number, y: number) =>
  p.evaluate(([cx, cy]) => (((window as any).__wfProbe?.(cx, cy) ?? []) as string[]).join(' / '), [x, y]);
/**
 * 等地图停稳:镜头不动了(点选后飞过去、滚轮缩放都停下,视图连着 300 毫秒、至少 6 帧没变),放大后的地形、文明细节层也在后台备好了。
 * 量"按下去 → 画出来"多快、看拖动时细节层藏没藏之前先等它:不然量进去的是还在飞、还在备料的那一段,
 * 慢的机器上时快时慢(镜头飞一次 0.6 秒,人点完城再去改名、放大后再拖,本来就在这之后)。
 * 只看时间不够:机器卡住几百毫秒再醒过来的那一帧,视图还没来得及更新,看着也"没变";要连着几帧都没变才算。
 * 返回等了多久(毫秒),最多等 timeout
 */
const mapSettled = (p: Page = page, timeout = 15000) =>
  p.evaluate(`new Promise((res) => {
    const w = window;
    const t0 = performance.now();
    let last = '';
    let since = t0;
    let frames = 0;
    const tick = () => {
      const now = performance.now();
      const v = w.__wfView;
      const key = v ? [v.k, v.x, v.y, v.lon].join() : '';
      if (key !== last) {
        last = key;
        since = now;
        frames = 0;
      } else frames++;
      const busy = (w.__wfDetail && w.__wfDetail.pending) || (w.__wfCivDetail && w.__wfCivDetail.pending);
      if ((now - since >= 300 && frames >= 6 && !busy) || now - t0 > ${timeout}) res(now - t0);
      else requestAnimationFrame(tick);
    };
    tick();
  })`) as Promise<number>;
/** 下的令先进待推演的单子:点「全部推演」(国家干预页底部的,没有就点时间轴上面单子里的;手机上轻点) */
const pushOrders = async (p: Page, tap = false) => {
  await p.waitForTimeout(150);
  const foot = p.locator('.inspector [data-act=iv-push]');
  const el = (await foot.isVisible().catch(() => false)) ? foot : p.locator('.ivq [data-act=iv-push]');
  await (tap ? el.tap({ timeout: 5000 }) : el.click({ timeout: 5000 })).catch(() => {});
};
/**
 * 悬停卡片现在写的字,没有卡片就是空的。不等卡片出来:挪着鼠标找目标时不少点落在海上、没有卡片,
 * 用 locator.innerText() 每落空一次要等满 30 秒(GitHub 上「国家面板」一段曾因此多花十几分钟)
 */
const hoverText = (p: Page, sel = '.hover-card') =>
  p.evaluate((s) => (document.querySelector(s) as HTMLElement | null)?.innerText ?? '', sel).then((t) => t.replace(/\n/g, ' '));
/** 顶部提示条上某个来源的那条(save 存档 / export 导出 / progress 生成……) */
const toastText = (p: Page, id: string, timeout = 3000) =>
  p.locator(`.toast[data-toast=${id}]`).innerText({ timeout }).then((t) => t.replace(/\n/g, ' '), () => '');
// 每次画完地图都会换一个新的 window.__wf;先在旧的上做个记号,记号消失 = 画了新的一张
const wf = () => page.evaluate(() => (window as any).__wf);
const markWf = () => page.evaluate(() => ((window as any).__wf.mark = 1));
const waitRedraw = () => page.waitForFunction(() => !(window as any).__wf.mark, null, { timeout: 30000 });
/**
 * 快慢只记数、不卡合并:同一段代码在 CI 的虚拟机上快慢能差三成以上(整局重推在没动过推演的分支上也常跑到预算边上),
 * 卡合并只会误报。每一项照旧量、照旧打印,记进 timings;跑完汇总成一段(日志里,和检查页摘要里的一张表),
 * 超了写"超预算"、在检查页挂一条 warning,不算失败。功能对不对(元素在不在、文字对不对、点了有没有反应)照旧记进 errs
 */
const timings: { label: string; ms: number; budget: number }[] = [];
const fmtMs = (ms: number) => (Number.isFinite(ms) ? `${ms < 100 ? ms.toFixed(1) : ms.toFixed(0)} ms` : '没量到');
const timing = (label: string, ms: number, budget: number) => {
  timings.push({ label, ms, budget });
  if (!(ms <= budget)) console.log(`超预算(只记数,不算失败):${label} ${fmtMs(ms)},预算 ${budget} ms`);
};
// 回放每帧耗时的预算:本机约 10–20 ms;CI 的虚拟机慢两三倍,同一段回放在 CI 上 16–40 ms 来回跳,预算放宽到 2 倍
const REPLAY_BUDGET = process.env.CI ? 60 : 30;

/**
 * 分几份同时跑:SMOKE_PART=2/5 只跑第 2 份(PR 检查上 5 台机器同时跑,各开各的浏览器);不设就从头跑到尾。
 * 下面每一段都包在 if (part('段名')) 里,从上往下按顺序归份:PART_STARTS 是第 2–5 份打头的那一段,其余的段跟着上一段走,
 * 所以一份里的先后和从头跑到尾时一样。打头的那段要自己打开页面(page.goto 或新开浏览器页面),不靠前面几段留下的页面和存档。
 * MOVED 里的段不跟上一段走,改归写的那一份(在那一份里照样按先后跑)。只有不碰主页面 page 的段能挪:它自己新开浏览器页面,
 * 不靠别的段留下的页面和存档;挪走、挪来都不改变用 page 的那几段看到的页面和存档。
 * 第 4 份打头的「地球仪」也不碰 page(自己另开一个浏览器),它到「手机布局」之间没有别的段,所以第 4 份里没有用 page 的段。
 * 按 GitHub 机器上各段的耗时大致均分(每份约七分半;每份最后「跑了几段」那行写着各段用了几秒);某一份明显变慢了就挪一挪这里的段名。
 */
const PART_STARTS = ['点选改名', '搜索', '地球仪', '手机布局'];
const MOVED: Record<string, number> = {
  写实风放大: 5,
  立体地形: 4,
  第一次来: 3,
  新建时让助手改: 4,
  隐私模式: 5,
  改名等推完: 3,
  生成器版本: 4,
  分享这一刻: 4,
  各种状态: 5,
  编辑地形: 5,
  成书: 4,
  世界之最: 3,
};
const [PART, PARTS] = (process.env.SMOKE_PART ?? '1/1').split('/').map(Number);
if (!(PARTS === 1 || PARTS === PART_STARTS.length + 1) || !(PART >= 1 && PART <= PARTS)) {
  throw new Error(`SMOKE_PART 要写成"第几份/共几份"(共 1 份或 ${PART_STARTS.length + 1} 份),比如 2/${PART_STARTS.length + 1};现在是 ${process.env.SMOKE_PART}`);
}
for (const [name, k] of Object.entries(MOVED)) {
  if (!(Number.isInteger(k) && k >= 1 && k <= PART_STARTS.length + 1) || PART_STARTS.includes(name)) {
    throw new Error(`MOVED 里的「${name}」要归第 1–${PART_STARTS.length + 1} 份中的一份,而且不能是 PART_STARTS 里打头的段`);
  }
}
const partNames = new Set<string>();
const partRan: string[] = [];
let partNow = 1;
/** 正在跑的那段和它开始的时刻;下一段开始(或全跑完)时记下它用了几秒,写进 partRan */
let partOpen: [string, number] | null = null;
/** 开第一段之前的准备(起开发服务器、开浏览器)用了几毫秒 */
let partSetupMs = 0;
const partClose = () => {
  if (partOpen) partRan.push(`${partOpen[0]} ${Math.round((performance.now() - partOpen[1]) / 1000)}s`);
  partOpen = null;
};
/** 这一段在不在这次跑的那一份里 */
const part = (name: string) => {
  if (partNames.has(name)) throw new Error(`冒烟的段名「${name}」重复了`);
  partNames.add(name);
  partClose();
  const i = PART_STARTS.indexOf(name);
  if (i >= 0) {
    if (i + 2 !== partNow + 1) throw new Error(`PART_STARTS 里的段要按冒烟里的先后排(「${name}」排错了)`);
    partNow = i + 2;
  }
  const on = PARTS === 1 || (MOVED[name] ?? partNow) === PART;
  if (on) {
    if (!partSetupMs) partSetupMs = performance.now();
    partOpen = [name, performance.now()];
  }
  return on;
};
// 界面骨架:地图铺满窗口,左边浮着侧栏卡片(世界名 + 副标、搜索框);右上填色分段按钮"国家"亮着、底图按钮写"手绘";第一次打开有操作提示(拖一下就没了);
// 悬停小卡片(国名 + 州数);右下 + − 缩放;图层面板:缩略图、切到卫星 → 深色主题、网址记下、面板不收;叠加开关(地名……)、民族图例;
// 世界概览:打开、四个页签、Esc / 点外面收起、国家表点一行 → 概览收起、选中这国;点国家 → 详情在侧栏里(世界首页换成面板)
if (part('界面骨架')) {
  await page.goto(`${dev.url}/?seed=7`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  const stage = (await page.locator('main.stage').boundingBox())!;
  const mapBox = (await page.locator('.map-box').boundingBox())!;
  const side = await page.locator('aside.sidebar').boundingBox();
  const sideRadius = await page.locator('aside.sidebar').evaluate((e) => getComputedStyle(e).borderTopLeftRadius);
  const title = (await page.locator('.sb-title').innerText()).replace(/\n/g, ' ');
  const label0 = await page.locator('.seg-btn.on').innerText();
  const base0 = await page.locator('.lp-base').innerText();
  const theme0 = await page.locator('.app').getAttribute('data-theme');
  const hint0 = await page.locator('.first-hint').count();
  // 右下 + −
  const k0 = (await page.evaluate(() => (window as any).__wfView)).k;
  await page.click('[data-act=zoom-in]');
  await page.waitForTimeout(150);
  const k1 = (await page.evaluate(() => (window as any).__wfView)).k;
  await page.click('[data-act=zoom-out]');
  await page.waitForTimeout(150);
  const k2 = (await page.evaluate(() => (window as any).__wfView)).k;
  // 拖一下
  await page.mouse.move(700, 400);
  await page.mouse.down();
  await page.mouse.move(760, 410, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const hint1 = await page.locator('.first-hint').count();
  // 悬停小卡片:国家图层上显示"某国 N 州"
  let card = '';
  for (let i = 0; i < 80 && !/\d+ 州/.test(card); i++) {
    await page.mouse.move(150 + ((i * 197) % 1000), 160 + ((i * 83) % 460));
    await page.waitForTimeout(25);
    card = await hoverText(page);
  }
  // 图层面板:缩略图做出来;切到卫星(面板不收)
  await page.click('[data-act=layers]');
  const pop = (await page.locator('.lp-pop').innerText().catch(() => '')).replace(/\n/g, ' ');
  await page.waitForFunction(() => document.querySelectorAll('.lp-layer .lp-thumb:not(.empty)').length >= 4, null, { timeout: 20000 }).catch(() => {});
  const thumbs = await page.locator('.lp-layer .lp-thumb:not(.empty)').count();
  await page.click('.lp-layer[data-base=satellite]');
  await page.waitForFunction(() => (window as any).__wf?.style === 'realistic', null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  const theme1 = await page.locator('.app').getAttribute('data-theme');
  const label1 = `${await page.locator('.seg-btn.on').innerText()}+${await page.locator('.lp-base').innerText()}`;
  const url1 = page.url();
  const popClosed = !(await page.locator('.lp-pop').count());
  const satRow = (await page.locator('.lp-sat').innerText().catch(() => '')).replace(/\n/g, ' ');
  await page.click('[data-act=layers]');
  await pickLayer(page, 'political');
  await page.waitForTimeout(300);
  const theme2 = await page.locator('.app').getAttribute('data-theme');
  // 弹层里的叠加开关:点"州"打开州界(弹层不收),再点关掉;选"民族"时下面列出民族色块
  await page.click('[data-act=layers]');
  const togs = (await page.locator('.lp-toggles').innerText().catch(() => '')).replace(/\n/g, ' ');
  await page.click('.lp-tog[data-civ=regions]');
  const regionsOn = (await page.locator('.lp-tog[data-civ=regions]').getAttribute('aria-checked')) === 'true';
  const stillOpen = (await page.locator('.lp-pop').count()) === 1;
  await page.click('.lp-tog[data-civ=regions]');
  await page.click('.lp-pop [data-fill=cultures]');
  await page.waitForTimeout(200);
  const cultureKeys = await page.locator('.lp-cultures .lp-cu').count();
  await page.click('.lp-pop [data-fill=polities]');
  await page.click('[data-act=layers]');
  await page.waitForTimeout(300);
  // 世界概览:点世界名打开;头部、页签(国家、民族都列出几行);Esc 收起;点外面收起
  await page.click('[data-act=overview]');
  await page.waitForTimeout(300);
  const ovOpen = await page.locator('.ov-root:not([hidden]) .ov').isVisible();
  const ovHead = (await page.locator('.ov-head').innerText()).replace(/\n/g, ' ');
  const ovTabs = (await page.locator('.ov-tabs').innerText()).replace(/\n/g, ' ');
  const ovRows = await page.locator('.ov-countries .ov-row').count();
  await page.click('.ov-tab[data-tab=cultures]');
  await page.waitForTimeout(200);
  const ovFolks = await page.locator('.ov-cultures .ov-row').count();
  const pages: Record<string, string> = {};
  for (const t of ['chronicle', 'interventions', 'genesis']) {
    await page.click(`.ov-tab[data-tab=${t}]`);
    await page.waitForTimeout(200);
    pages[t] = (await page.locator('.ov-body').innerText()).replace(/\n/g, ' ');
    // 世界设定分「文明」「地图」两页:两页的字连起来看
    if (t === 'genesis' && (await page.locator('.ov-seg [data-tab=map]').count())) {
      await page.click('.ov-seg [data-tab=map]');
      await page.waitForTimeout(200);
      pages[t] += ' ' + (await page.locator('.ov-body').innerText()).replace(/\n/g, ' ');
    }
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const escClosed = !(await page.locator('.ov-root:not([hidden])').count());
  await page.click('[data-act=overview]');
  await page.mouse.click(8, vp.height / 2);
  await page.waitForTimeout(200);
  const scrimClosed = !(await page.locator('.ov-root:not([hidden])').count());
  // 国家表点一行:概览收起,选中这国(右侧面板)
  await openOverview(page, 'countries');
  const rowName = (await page.locator('.ov-countries .ov-row:not(.dead) .ov-name').first().innerText()).trim();
  await page.click('.ov-countries .ov-row:not(.dead) >> nth=0');
  await page.waitForTimeout(300);
  const rowClosed = !(await page.locator('.ov-root:not([hidden])').count());
  const rowIns = (await page.locator('.inspector').innerText({ timeout: 3000 }).catch(() => '')).replace(/\n/g, ' ');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  // 点国家:右侧面板,右下按钮左移
  type Pick = { kind: string; id: number; text: string; x: number; y: number };
  const pol = ((await page.evaluate('window.__wfPickables()')) as Pick[])
    .filter((q) => q.kind === 'polity' && q.x > SIDE_ROOM + 60 && q.x < vp.width - 80 && q.y > 120 && q.y < vp.height - 140)
    .sort((a, b) => Math.abs(a.x - (SIDE_ROOM + vp.width) / 2) - Math.abs(b.x - (SIDE_ROOM + vp.width) / 2))[0];
  let ins: { x: number; y: number; width: number; height: number } | null = null;
  let home = -1;
  if (pol) {
    await page.mouse.click(pol.x, pol.y);
    ins = await page.locator('.sidebar .inspector').boundingBox({ timeout: 3000 }).catch(() => null);
    home = await page.locator('.sidebar .sb-home').count();
    await page.keyboard.press('Escape');
  }
  console.log(
    `界面骨架:侧栏 ${side ? `${side.width}×${side.height}` : '没有'},舞台 ${stage.width}×${stage.height} @ ${stage.x}(视口 ${vp.width}×${vp.height}),地图框 ${Math.round(mapBox.width)}×${Math.round(mapBox.height)};侧栏顶上「${title}」;图层「${label0}」;` +
      `主题 ${theme0};首次提示 ${hint0} → 拖动后 ${hint1};缩放按钮 ${k0} → ${k1.toFixed(2)} → ${k2.toFixed(2)};悬停「${card}」;` +
      `弹层「${pop.slice(0, 40)}…」缩略图 ${thumbs} 张;切卫星 → 主题 ${theme1}、按钮「${label1}」、面板收起 ${popClosed}、${satRow}、网址 ${url1.split('?')[1]};切回手绘 + 国家 → 主题 ${theme2};` +
      `叠加开关「${togs}」:点"州" ${regionsOn}、弹层不收 ${stillOpen};民族色块 ${cultureKeys} 个;` +
      `概览打开 ${ovOpen}、头部「${ovHead}」、页签「${ovTabs}」、国家 ${ovRows} 行、民族 ${ovFolks} 行;编年史「${pages.chronicle?.slice(0, 30)}…」;我的干预「${pages.interventions}」;` +
      `世界设定「${pages.genesis?.slice(0, 40)}…」;Esc 收起 ${escClosed}、点外面收起 ${scrimClosed};国家表点「${rowName}」→ 概览收起 ${rowClosed}、面板「${rowIns.slice(0, 30)}」;` +
      `点「${pol?.text}」→ 侧栏里的面板 ${ins ? `${Math.round(ins.width)}×${Math.round(ins.height)} @ ${Math.round(ins.x)},${Math.round(ins.y)}` : '没出来'}、世界首页收起 ${home === 0}`,
  );
  if (
    !side ||
    side.x !== 14 ||
    side.y !== 14 ||
    side.height !== vp.height - 28 ||
    Math.abs(side.x + side.width + 14 - SIDE_ROOM) > 1 ||
    sideRadius !== '14px' ||
    stage.x !== 0 ||
    stage.width !== vp.width ||
    stage.height !== vp.height
  )
    errs.push(`界面骨架:应是地图铺满窗口 + 左边浮着圆角的侧栏卡片(卡片 ${JSON.stringify(side)}、圆角 ${sideRadius};舞台 ${JSON.stringify(stage)})`);
  if (!(mapBox.height >= stage.height - 1 && mapBox.width >= stage.width - 1)) errs.push('界面骨架:地图框没有盖满舞台');
  if (!/未命名世界/.test(title) || !/种子 7，现存 \d+ 国/.test(title)) errs.push(`界面骨架:侧栏顶上的世界名 / 副标不对(${title})`);
  if (label0 !== '国家' || base0 !== '手绘' || theme0 !== 'light') errs.push(`界面骨架:默认应为手绘 + 国家、浅色(${label0},${base0},${theme0})`);
  if (hint0 !== 1 || hint1 !== 0) errs.push('界面骨架:第一次打开的操作提示没出现 / 拖动后没消失');
  if (!(k1 > 1.4 && Math.abs(k2 - 1) < 0.01)) errs.push(`界面骨架:右下的 + − 没有缩放(${k0} → ${k1} → ${k2})`);
  if (!/\d+ 州/.test(card)) errs.push(`界面骨架:国家图层上悬停没有"国名 N 州"(${card})`);
  if (!['底图', '数据底图', '填色', '叠加', '经纬网', '等值线', '投影'].every((w) => pop.includes(w))) errs.push(`界面骨架:图层面板内容不全(${pop.slice(0, 80)})`);
  if (thumbs < 4) errs.push(`界面骨架:面板里的缩略图没做出来(${thumbs} 张)`);
  if (theme1 !== 'dark' || label1 !== '国家+卫星' || popClosed || !/[?&]map=satellite/.test(url1) || !/[?&]sat=detail/.test(url1) || !satRow.includes('细节'))
    errs.push(`界面骨架:切到卫星不对(主题 ${theme1},按钮 ${label1},面板收起 ${popClosed},${satRow},网址 ${url1})`);
  if (theme2 !== 'light') errs.push('界面骨架:切回手绘后没换回浅色主题');
  if (!['地名', '宜居度', '州', '城址', '道路'].every((w) => togs.includes(w)) || !regionsOn || !stillOpen) errs.push(`图层弹层:叠加开关不全 / 点了没反应(${togs})`);
  if (cultureKeys < 2) errs.push(`图层弹层:选"民族"时没有列出民族色块(${cultureKeys})`);
  if (!ovOpen || !['现存', '历来', '民族', '城镇', '种子 7', '当前'].every((w) => ovHead.includes(w))) errs.push(`世界概览:打不开 / 头部不全(${ovHead})`);
  if (!['国家', '民族', '编年史', '我的干预 0', '世界设定'].every((w) => ovTabs.includes(w)) || ovRows < 3) errs.push(`世界概览:页签不全 / 国家表没有列出国家(${ovTabs};${ovRows} 行)`);
  if (ovFolks < 3) errs.push(`世界概览:民族页没有列出民族(${ovFolks} 行)`);
  if (!/大事 \d+/.test(pages.chronicle ?? '') || !(pages.interventions ?? '').includes('还没有干预')) errs.push('世界概览:编年史页 / 我的干预页(空)不对');
  if (!['创建时定下的', '不能再改', '文明种子', '陆地', '改过的地形', '以它为底稿新建', '回放世界形成'].every((w) => (pages.genesis ?? '').includes(w)) || /换一颗|随机/.test(pages.genesis ?? ''))
    errs.push(`世界概览:世界设定页不对(应只能看、能以它为底稿新建、回放;${pages.genesis})`);
  if (!escClosed || !scrimClosed) errs.push('世界概览:Esc / 点外面收不起');
  if (!rowClosed || !rowIns.includes(rowName)) errs.push(`世界概览:国家表点一行没有收起概览、选中这国(${rowName};${rowIns.slice(0, 40)})`);
  if (!ins || !side || ins.x < side.x - 1 || ins.x + ins.width > side.x + side.width + 1 || home !== 0) errs.push('界面骨架:点国家后面板没有出现在侧栏里 / 世界首页没收起');
  await page.evaluate(() => localStorage.clear());
}

// 早年一个国家都没有:侧栏"国家"下说一句为什么、第一个国家哪年立国,不显示"全部 0 国";点"跳到 N 年"时间轴跳过去,列表里有了它
if (part('早年没有国家')) {
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civYear=300`);
  await page.waitForFunction(() => (window as any).__wfCiv?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const empty = await page.locator('.sidebar .sb-no-polity').innerText({ timeout: 3000 }).then((t) => t.replace(/\n/g, ' '), () => '');
  const allLink = await page.locator('.sidebar [data-act=all-countries]').count();
  // 刚打开时地图头几帧很忙,点击要等按钮"稳定",多给点时间
  await page.locator('.sidebar [data-act=first-polity]').click({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(400);
  const yearNow = await page.locator('.timebar .tb-year').innerText().catch(() => '');
  const rowsNow = await page.locator('.sidebar .sb-home .sb-row.two[data-polity]').count();
  const gone = (await page.locator('.sidebar .sb-no-polity').count()) === 0;
  console.log(`早年没有国家:第 300 年「${empty}」,"全部 N 国"${allLink ? '还在' : '不显示'};点跳转 → ${yearNow},国家 ${rowsNow} 个,说明收起 ${gone}`);
  const m = empty.match(/在 \d+ 年立国.*跳到 (\d+) 年/);
  if (!m || allLink) errs.push(`第 300 年一个国家都没有时侧栏没有说明 / 还显示"全部 0 国"(「${empty}」)`);
  else if (yearNow !== `第 ${m[1]} 年` || rowsNow < 1 || !gone) errs.push(`点"跳到 ${m[1]} 年"没跳到第一个国家立国(${yearNow},国家 ${rowsNow} 个)`);
}

// 键盘快捷键(电脑上):← → 走 10 年(Shift 100 年)、空格播放 / 暂停(用鼠标点过播放键以后按空格只算一下)、+ − 缩放、1–5 换图层、
// / 跳进搜索框(在框里打数字不换图层)、? 打开一览(开着时空格不播放,Esc 收起)、Ctrl+S 打开存档菜单(拦下浏览器的"存储网页")、
// 改名后 Ctrl+Z 撤销、Ctrl+Shift+Z 重做;Ctrl+\ 收起 / 展开左边的卡片(收起着按 / 先展开);按钮的提示框右边写着键;"更多"菜单里有"键盘快捷键"
if (part('键盘快捷键')) {
  await page.goto(`${dev.url}/?seed=7`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  const year = async () => Number((await page.locator('.timebar .tb-year').innerText()).replace(/[^\d]/g, ''));
  const playing = async () => (await page.locator('.timebar .tb-play.on').count()) > 0;
  const layer = () => page.locator('.seg-btn.on').innerText();
  const k = async () => (await page.evaluate(() => (window as any).__wfView)).k as number;
  await page.mouse.click(SIDE_ROOM + (vp.width - SIDE_ROOM) / 2, vp.height / 2);
  await page.keyboard.press('Escape');
  const y0 = await year();
  await page.keyboard.press('ArrowLeft');
  const y1 = await year();
  await page.keyboard.press('Shift+ArrowLeft');
  const y2 = await year();
  await page.keyboard.press('ArrowRight');
  const y3 = await year();
  await page.keyboard.press('Space');
  await page.waitForTimeout(250);
  const play1 = await playing();
  await page.keyboard.press('Space');
  const play2 = await playing();
  await page.click('.timebar button.tb-play');
  await page.waitForTimeout(150);
  const play3 = await playing();
  await page.keyboard.press('Space');
  await page.waitForTimeout(150);
  const play4 = await playing();
  const k0 = await k();
  await page.keyboard.press('Equal');
  await page.waitForTimeout(400);
  const k1 = await k();
  await page.keyboard.press('Minus');
  await page.waitForTimeout(400);
  const k2 = await k();
  await page.keyboard.press('2');
  await page.waitForTimeout(250);
  const l2 = await layer();
  await page.keyboard.press('1');
  await page.waitForTimeout(250);
  const l1 = await layer();
  await page.keyboard.press('/');
  const searchFocused = await page.evaluate(() => document.activeElement?.classList.contains('search-input') ?? false);
  await page.keyboard.type('2');
  const typed = await page.locator('input.search-input').inputValue();
  const lTyped = await layer();
  await page.keyboard.press('Escape');
  await page.locator('input.search-input').fill('');
  await page.mouse.click(SIDE_ROOM + (vp.width - SIDE_ROOM) / 2, vp.height / 2);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Slash');
  await page.waitForTimeout(200);
  const help = (await page.locator('[data-testid=shortcuts]').innerText().catch(() => '')).replace(/\n/g, ' ');
  await page.keyboard.press('Space');
  const playUnderHelp = await playing();
  await page.keyboard.press('Escape');
  const helpClosed = !(await page.locator('[data-testid=shortcuts]').count());
  await page.evaluate(() => window.addEventListener('keydown', (e) => e.code === 'KeyS' && ((window as any).__kbSave = e.defaultPrevented)));
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(200);
  const saveMenu = await page.locator('.save-menu').isVisible().catch(() => false);
  const savePrevented = await page.evaluate(() => (window as any).__kbSave);
  await page.keyboard.press('Escape');
  // 提示框:鼠标停在"民族"上
  await page.hover('.seg-btn[data-fill=cultures]');
  await page.waitForTimeout(700);
  const tip = (await page.locator('.ui-tip').innerText().catch(() => '')).replace(/\s+/g, ' ');
  await page.mouse.move(SIDE_ROOM + (vp.width - SIDE_ROOM) / 2, vp.height / 2);
  // "更多"菜单 → 键盘快捷键
  await page.click('[data-act=world-more]');
  const menu = (await page.locator('.pm-menu').innerText().catch(() => '')).replace(/\s+/g, ' ');
  await page.click('[data-act=shortcuts]');
  const menuOpens = (await page.locator('[data-testid=shortcuts]').count()) === 1;
  await page.click('[data-act=shortcuts-close]');
  // 改一座城的名字,Ctrl+Z 撤销、Ctrl+Shift+Z 重做
  type Pick = { kind: string; id: number; text: string; x: number; y: number };
  const ps = (await page.evaluate('window.__wfPickables()')) as Pick[];
  const city = ps.find((c) => c.kind === 'settlement' && ps.some((m) => m.kind === 'mark' && m.id === c.id && m.x > SIDE_ROOM + 60 && m.x < vp.width - 60 && m.y > 120 && m.y < vp.height - 160));
  const has = (n: string) => page.evaluate((t) => ((window as any).__wfLabels?.texts ?? []).includes(t), n);
  /**
   * 等地图上的字成了 want 写的样子(哪些名字在、哪些不在),最多 5 秒;等了多久记进 waits。
   * 改名以后地图上的字不是当下就换:编年史按新名字分小块重算、新的字在后台备好再换上;点城时地图还在飞过去的话,
   * 要等飞完、细节层画完才轮到,CI 的虚拟机上要半秒上下(固定等 400 毫秒会偶发没等到)
   */
  const waits: number[] = [];
  const labelsAre = async (want: Record<string, boolean>) => {
    const t0 = performance.now();
    await page
      .waitForFunction((w) => Object.entries(w).every(([t, on]) => ((window as any).__wfLabels?.texts ?? []).includes(t) === on), want, { timeout: 5000, polling: 50 })
      .catch(() => {});
    waits.push(Math.round(performance.now() - t0));
  };
  let undo = '';
  let redo = '';
  const named: boolean[] = [];
  if (city) {
    const m = ps.find((q) => q.kind === 'mark' && q.id === city.id)!;
    await page.mouse.click(m.x, m.y);
    await page.click('.inspector .ins-name');
    await page.fill('.inspector .ins-edit input', '快捷键城');
    await page.keyboard.press('Enter');
    await labelsAre({ 快捷键城: true });
    named.push(await has('快捷键城'));
    await page.keyboard.press('Control+z');
    undo = await toastText(page, 'resim-done');
    await labelsAre({ 快捷键城: false, [city.text]: true });
    named.push(await has('快捷键城'), await has(city.text));
    await page.keyboard.press('Control+Shift+z');
    redo = await toastText(page, 'resim-done');
    await labelsAre({ 快捷键城: true });
    named.push(await has('快捷键城'));
  }
  // 收起按钮的提示框;Ctrl+\ 收起、再按展开;收起着按 / :卡片展开、光标在搜索框里
  await page.keyboard.press('Escape');
  await page.hover('[data-act=side-collapse]');
  await page.waitForTimeout(700);
  const tipSide = (await page.locator('.ui-tip').innerText().catch(() => '')).replace(/\s+/g, ' ');
  await page.mouse.move(SIDE_ROOM + (vp.width - SIDE_ROOM) / 2, vp.height / 2);
  const folded = async () => (await page.locator('.side-open').count()) === 1;
  await page.keyboard.press('Control+Backslash');
  await page.waitForTimeout(400);
  const fold1 = await folded();
  await page.keyboard.press('Control+Backslash');
  await page.waitForTimeout(400);
  const fold2 = await folded();
  await page.keyboard.press('Control+Backslash');
  await page.waitForTimeout(400);
  await page.keyboard.press('/');
  await page.waitForTimeout(300);
  const fold3 = await folded();
  const searchAfterFold = await page.evaluate(() => document.activeElement?.classList.contains('search-input') ?? false);
  await page.keyboard.press('Escape');
  console.log(
    `快捷键:年份 ${y0} → ← ${y1} → Shift+← ${y2} → → ${y3};空格 ${play1}/${play2},点播放键 ${play3} 后空格 ${play4};缩放 ${k0.toFixed(2)} → ${k1.toFixed(2)} → ${k2.toFixed(2)};` +
      `2 → ${l2}、1 → ${l1};/ 进搜索框 ${searchFocused}、打「${typed}」图层 ${lTyped};? 一览「${help.slice(0, 30)}…」、开着时空格播放 ${playUnderHelp}、Esc 收起 ${helpClosed};` +
      `Ctrl+S 存档菜单 ${saveMenu}、拦下 ${savePrevented};提示「${tip}」;更多菜单「${menu}」→ 一览 ${menuOpens};` +
      `改名「${city?.text}」→ 快捷键城 ${named.join('/')}(地图上的字等了 ${waits.join(' / ')} ms)、撤销「${undo}」、重做「${redo}」;收起按钮提示「${tipSide}」;Ctrl+\\ 收起 ${fold1} → 展开 ${!fold2};收起着按 / → 展开 ${!fold3}、进搜索框 ${searchAfterFold}`,
  );
  if (!(y1 === y0 - 10 && y2 === y0 - 110 && y3 === y0 - 100)) errs.push(`快捷键:← → 没有按 10 年 / Shift 100 年走(${y0} → ${y1} → ${y2} → ${y3})`);
  if (!play1 || play2) errs.push(`快捷键:空格没有播放 / 暂停(${play1}、${play2})`);
  if (!play3 || play4) errs.push(`快捷键:点过播放键以后按空格,应只暂停一次(${play3} → ${play4})`);
  if (!(k1 > k0 * 1.3 && Math.abs(k2 - k0) < 0.01)) errs.push(`快捷键:+ − 没有缩放(${k0} → ${k1} → ${k2})`);
  if (l2 !== '民族' || l1 !== '国家') errs.push(`快捷键:1 2 没有换填色(${l2}、${l1})`);
  if (!searchFocused || typed !== '2' || lTyped !== '国家') errs.push(`快捷键:/ 没有跳进搜索框,或在框里打字换了图层(${searchFocused}、「${typed}」、${lTyped})`);
  // 修饰键苹果电脑上写成 ⌘(⌘S、⌘\),别的系统写成 Ctrl+(见 src/ui/shortcuts.ts 的 keyLabel)
  if (!['时间', '地图', '世界', '播放 / 暂停', '撤销 / 重做'].every((w) => help.includes(w)) || !/Ctrl\+S|⌘S/.test(help) || playUnderHelp || !helpClosed)
    errs.push(`快捷键:? 一览不对,或开着时空格还在播放 / Esc 收不起(${help.slice(0, 60)};${playUnderHelp};${helpClosed})`);
  if (!saveMenu || savePrevented !== true) errs.push(`快捷键:Ctrl+S 没有打开存档菜单 / 没拦下浏览器的存网页(${saveMenu}、${savePrevented})`);
  if (!/民族\s*2/.test(tip)) errs.push(`快捷键:"民族"按钮的提示框没写键(${tip})`);
  if (!/键盘快捷键\s*\?/.test(menu) || !menuOpens) errs.push(`快捷键:"更多"菜单里没有"键盘快捷键",或点了没打开一览(${menu})`);
  if (!city) errs.push('快捷键:没找到能点的城');
  else if (named.join() !== 'true,false,true,true' || undo !== '已撤销改名' || redo !== '已重做改名')
    errs.push(`快捷键:改名后 Ctrl+Z / Ctrl+Shift+Z 不对(${named.join('/')},各等了最多 5 秒;${undo};${redo})`);
  if (!/收起侧栏\s*(Ctrl\+|⌘)\\/.test(tipSide)) errs.push(`快捷键:收起按钮的提示框没写键(${tipSide})`);
  if (!fold1 || fold2) errs.push(`快捷键:Ctrl+\\ 没有收起 / 展开左边的卡片(${fold1}、${fold2})`);
  if (fold3 || !searchAfterFold) errs.push(`快捷键:卡片收起着按 / ,应先展开再跳进搜索框(${fold3}、${searchAfterFold})`);
  await page.evaluate(() => localStorage.clear());
}

// 人物:国家卡片的「君主」行和「历代君主」(当前那位标"当前"、点了打开他);人物卡片(名人第一行「事迹」、前任 / 继任、将领可点;
// 君主有「倾向」一组四行,复制生平里也有一行,将领、宗室没有;
// 「出征那年」跳时间轴;「编年史」打开这国的编年史;「复制生平」);编年史里的人名是蓝字,点了收起概览、打开这个人,不跳年份;
// 世界概览的「人物」页(名人 / 君主 / 将领,「全部 N 位」进来停在这国的君主);搜名字第一个是这个人。
// 例子按条件现找(scripts/lib/smokeExamples.ts 的 findPersonExample;历史变了不用跟着改人名、年份):继位来的一位君主
// (前任、继任和他同一朝,卡片上写得出亲属;本国至少 5 位君主),他在位时本国有将领头一回出征(跳到出征那年,在位的还是他)。
// GENERATOR_VERSION 40 时找到的是种子 7 天灵(6 号国)霄朝的高宗沈岚尘(前任祖父仁宗沈瑶、继任儿子孝宗沈羽,将领晏昀 2892 年头一回出征)
if (part('人物')) person: {
  const { findPersonExample, reEsc } = await import('./lib/smokeExamples');
  const ex = findPersonExample();
  if (!ex) {
    errs.push('人物:几个种子里都找不到够格的例子(继位来的君主,前任、继任写得出亲属,在位时有将领头一回出征)');
    break person;
  }
  const { ruler: R, general: G, lineage: L } = ex;
  const nm = reEsc(R.name);
  console.log(
    `人物:例子是种子 ${ex.seed} 第 ${ex.year} 年 ${ex.polity} 号国的${R.name}(${R.from}–${R.until} 年在位,前任${R.prev.kin}${R.prev.name}、继任${R.next.kin}${R.next.name}),` +
      `将领${G.name}(${G.from}–${G.until} 年领兵)`,
  );
  await page.goto(`${dev.url}/?seed=${ex.seed}&civYear=${ex.year}`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const year = async () => Number((await page.locator('.timebar .tb-year').innerText()).replace(/[^\d]/g, ''));
  const text = (sel: string) => page.locator(sel).first().innerText().then((t) => t.replace(/\s+/g, ' ')).catch(() => '');
  await page.evaluate((id) => (window as any).__wfSelect('polity', id), ex.polity);
  await page.waitForTimeout(600);
  const stats = await text('.inspector .cp-stats');
  const rulers = await page.locator('.inspector .cp-rulers .cp-dyn-row').count();
  const cur = await text('.inspector .cp-rulers .cp-dyn-row.on');
  const all = await text('.inspector [data-act=all-rulers]');
  await page.click('.inspector .cp-rulers .cp-dyn-row.on');
  await page.waitForTimeout(400);
  const card1 = await text('.inspector .cp.pp');
  const deed = await text('.inspector .cp.pp .cp-stats');
  const leans = await text('.inspector .cp.pp [data-sec=leanings]');
  const leanRows = await page.locator('.inspector .cp.pp [data-sec=leanings] .pp-lean').count();
  await page.click('.inspector .cp.pp [data-act=person-copy]');
  await page.waitForTimeout(200);
  const copied = (await page.evaluate(() => (window as any).__wfPersonText as string)) ?? '';
  // 将领一行的名字 → 将领的卡片;出征那年
  await page.locator('.inspector .cp.pp .cp-stats .ins-link', { hasText: new RegExp(`^${reEsc(G.name)}$`) }).first().click();
  await page.waitForTimeout(400);
  const card2 = await text('.inspector .cp.pp');
  const genLeans = await page.locator('.inspector .cp.pp [data-sec=leanings]').count();
  await page.click('.inspector [data-act=person-year]');
  await page.waitForTimeout(300);
  const y1 = await year();
  // 编年史:这国、全部;正文里的人名是蓝字
  await page.click('.inspector [data-act=person-chronicle]');
  await page.waitForTimeout(600);
  const chronOpen = await page.locator('.ov-tab.on[data-tab=chronicle]').count();
  const names = await page.locator('.chron-list .pp-name').count();
  const pick = page.locator('.chron-list .pp-name').first();
  const pickName = (await pick.innerText().catch(() => '')).trim();
  const pickId = Number(await pick.getAttribute('data-person').catch(() => '-1'));
  await pick.click().catch(() => {});
  await page.waitForTimeout(500);
  const closed = !(await page.locator('.ov-root:not([hidden])').count());
  const card3Id = Number(await page.locator('.inspector .cp.pp').getAttribute('data-person').catch(() => '-1'));
  const y2 = await year();
  // 人物页:名人(默认)→ 点一行;国家卡片「全部 N 位」→ 君主、只看这国
  await openOverview(page, 'people');
  await page.waitForTimeout(300);
  const famousOn = await page.locator('.chronicle.people [data-list=famous].on').count();
  const famous = await page.locator('.chronicle.people .pp-row').count();
  const famousFirst = await text('.chronicle.people .pp-row');
  await page.locator('.chronicle.people .pp-row').first().click();
  await page.waitForTimeout(500);
  const card4 = await text('.inspector .cp.pp');
  await page.evaluate((id) => (window as any).__wfSelect('polity', id), ex.polity);
  await page.waitForTimeout(400);
  await page.click('.inspector [data-act=all-rulers]');
  await page.waitForTimeout(500);
  const rulersOn = await page.locator('.chronicle.people [data-list=rulers].on').count();
  const polityPick = await page.locator('[data-act=people-polity]').inputValue();
  const groups = await page.locator('.chronicle.people .pp-group').count();
  const rows = await page.locator('.chronicle.people .pp-row').count();
  // 世系图:时间轴那一年的那一朝、在位的那位蓝框;点没即位的宗室 → 宗室卡片,卡片上「世系图」→ 回来圈出他
  await page.click('[data-act=people-as-tree]');
  await page.waitForTimeout(500);
  const lgHead = await text('.lg-head');
  const lgNodes = await page.locator('.lg-node').count();
  const lgOn = await text('.lg-node.on');
  const princeId = await page.locator('.lg-node.lg-prince').first().getAttribute('data-person').catch(() => null);
  await page.locator('.lg-node.lg-prince').first().click().catch(() => {});
  await page.waitForTimeout(500);
  const princeCard = await text('.inspector .cp.pp');
  const princeLeans = await page.locator('.inspector .cp.pp [data-sec=leanings]').count();
  await page.click('.inspector [data-act=person-lineage]').catch(() => {});
  await page.waitForTimeout(600);
  const lgFocus = await page.locator(`.lg-node.focus[data-person="${princeId}"]`).count();
  await closeOverview();
  // 搜索
  await page.fill('.sidebar .search-input', R.name);
  await page.waitForTimeout(300);
  const hit = await text('.search-row');
  const hitKind = await page.locator('.search-row').first().getAttribute('data-kind');
  await page.locator('.search-row').first().click();
  await page.waitForTimeout(400);
  const card5 = await text('.inspector .cp.pp .ins-name');
  console.log(
    `人物:国家卡片「${stats.slice(0, 40)}…」,历代君主 ${rulers} 行、当前「${cur}」、「${all}」;卡片「${card1.slice(0, 50)}…」,倾向 ${leanRows} 行「${leans.slice(0, 30)}…」,复制 ${copied.length} 字;` +
      `将领卡片「${card2.slice(0, 30)}…」、出征那年 → ${y1};编年史开 ${chronOpen}、蓝字 ${names} 个,点「${pickName}」→ 收起 ${closed}、卡片 ${card3Id}/${pickId}、年份 ${y1} → ${y2};` +
      `人物页名人 ${famousOn}/${famous} 行「${famousFirst.slice(0, 30)}」→ 卡片「${card4.slice(0, 20)}」;全部 N 位 → 君主 ${rulersOn}、只看 ${polityPick}、${groups} 组 ${rows} 行;` +
      `世系图「${lgHead.slice(0, 40)}」${lgNodes} 人、当前「${lgOn}」,宗室卡片「${princeCard.slice(0, 30)}」→ 圈出 ${lgFocus};搜"${R.name}"「${hit}」(${hitKind})→「${card5}」`,
  );
  if (!new RegExp(`君主\\s*${nm}\\s*${R.from} 年即位`).test(stats)) errs.push(`人物:国家卡片没有「君主」行(${stats.slice(0, 80)})`);
  if (rulers !== 5 || !new RegExp(`${nm}\\s*当前`).test(cur) || !all.includes(`全部 ${ex.rulers} 位`)) errs.push(`人物:国家卡片的历代君主不对(${rulers} 行;${cur};${all})`);
  // 前任、继任的小字写亲属(祖父、子……)
  if (
    !card1.includes(R.name) ||
    !card1.includes(`${R.role}，${R.from}–${R.until} 年在位`) ||
    !new RegExp(`前任\\s*${reEsc(R.prev.name)}\\s*${R.prev.kin}`).test(deed) ||
    !new RegExp(`继任\\s*${reEsc(R.next.name)}\\s*${R.next.kin}`).test(deed)
  )
    errs.push(`人物:君主卡片不对(${card1.slice(0, 160)})`);
  if (!copied.startsWith(`${R.name}\n${R.role}，`) || !copied.includes('在位时：')) errs.push(`人物:复制生平不对(${copied.slice(0, 60)})`);
  if (
    leanRows !== 4 ||
    // 那年在位的君主:倾向右上多一个「改」
    !/^倾向 (?:改 )?开拓\s*\d+ 更愿意开垦偏远贫瘠的土地 好战\s*\d+ 更容易发动战争且更难停止 发展\s*\d+ 更重视领地内的建设 重商\s*\d+ 偏向沿海/.test(leans) ||
    !/\n倾向：开拓 \d+，好战 \d+，发展 \d+，重商 \d+\n/.test(copied)
  )
    errs.push(`人物:君主卡片的倾向不对(${leanRows} 行;${leans.slice(0, 80)};复制里 ${/倾向：.*/.exec(copied)?.[0]})`);
  if (genLeans || princeLeans) errs.push(`人物:将领 / 宗室的卡片上不该有倾向(${genLeans};${princeLeans})`);
  // 起止同一年只写一个年份("2874 年领兵")
  const gSpan = G.until > G.from ? `${G.from}–${G.until}` : `${G.from}`;
  if (!new RegExp(`${reEsc(G.name)}\\s*${reEsc(G.role)}，${gSpan} 年领兵`).test(card2) || y1 !== G.from)
    errs.push(`人物:将领卡片 / 出征那年不对(${card2.slice(0, 60)};${y1})`);
  if (!chronOpen || names < 3 || !closed || pickId < 0 || card3Id !== pickId || y2 !== y1) errs.push(`人物:编年史里的人名点不开,或点了跳了年份(${chronOpen};${names};${closed};${card3Id}/${pickId};${y1} → ${y2})`);
  if (!famousOn || famous < 20 || !card4) errs.push(`人物:人物页的名人不对,或点一行没打开卡片(${famousOn};${famous};${card4.slice(0, 30)})`);
  if (!rulersOn || polityPick !== String(ex.polity) || groups < 1 || rows !== ex.rulers) errs.push(`人物:「全部 N 位」没有打开这国的君主(${rulersOn};${polityPick};${groups};${rows})`);
  if (!new RegExp(`^${reEsc(L.dynasty)}\\s*${reEsc(L.note)}`).test(lgHead) || lgNodes < 8 || !new RegExp(`${nm}.*当前`).test(lgOn))
    errs.push(`人物:世系图不对(${lgHead};${lgNodes};${lgOn})`);
  if (!new RegExp(`${reEsc(L.princeRole)}，\\d+–\\d+`).test(princeCard) || !princeCard.includes('子嗣') || lgFocus !== 1)
    errs.push(`人物:宗室卡片 / 从卡片回到世系图不对(${princeCard.slice(0, 60)};${lgFocus})`);
  if (hit !== `${R.name} ${R.role}，${R.from}–${R.until}` || hitKind !== 'person' || card5 !== R.name) errs.push(`人物:搜"${R.name}"不对(${hit};${hitKind};${card5})`);
  await page.fill('.sidebar .search-input', '');
  await page.keyboard.press('Escape');
  await page.evaluate(() => localStorage.clear());
}

// 世界之最:世界概览「之最」页(人物后面)15 条纪录,跟着时间轴;刚被刷新的那条淡蓝、标「新纪录」;「历来 N 任」就地展开(键盘回车也行),点名字开他的卡片;
// 点一场仗 → 编年史只看攻方;点一朝 → 世系图;复制全文。例子按 Node 里同一份历史现找(某条纪录刚被刷新的那一年),历史变了照样找得到
if (part('世界之最')) records: {
  const { civOfSeed } = await import('./lib/smokeExamples');
  const { recordBook, recordsAt, recordName } = await import('../src/gen/civ/story/records');
  const civ = civOfSeed(7);
  const book = recordBook(civ);
  let Y = -1;
  for (let y = 1000; y <= Math.min(2600, civ.endYear) && Y < 0; y += 10) {
    const r = recordsAt(book, y).get('took');
    if (r && r.count > 2 && y - r.since <= 20 && y - r.since >= 3) Y = y;
  }
  if (Y < 0) {
    errs.push('世界之最:种子 7 里找不到"攻下州最多的将领"刚被刷新的年份');
    break records;
  }
  const at = recordsAt(book, Y);
  const took = at.get('took')!;
  const tookName = recordName(civ, took.ref, Y);
  const prevName = took.prev ? recordName(civ, took.prev.ref, took.since) : '';
  const war = at.get('war');
  const dyn = at.get('dynasty');
  const rctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const rp = await rctx.newPage();
  rp.on('pageerror', (e) => errs.push(`世界之最:${e.message}`));
  await rp.goto(`${dev.url}/?seed=7&civYear=${Y}`);
  await rp.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  const text = (sel: string) => rp.locator(sel).first().innerText().then((t) => t.replace(/\s+/g, ' ')).catch(() => '');
  const t0 = Date.now();
  await openOverview(rp, 'records');
  await rp.locator('.rec-row').first().waitFor({ timeout: 5000 });
  const openMs = Date.now() - t0;
  const tabAfter = await rp.locator('.ov-tabs .ov-tab').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')).join(','));
  const rows = await rp.locator('.rec-row').count();
  const groups = await rp.locator('.rec .pp-group').count();
  const tookRow = await text('.rec-row[data-key=took]');
  const tookNew = await rp.locator('.rec-row[data-key=took].rec-new .rec-pill').count();
  // 用键盘展开:焦点在「历来 N 任」上按回车(不是打开这一行的卡片)
  await rp.focus('.rec-row[data-key=took] [data-act=record-history]');
  await rp.keyboard.press('Enter');
  await rp.waitForTimeout(200);
  const chain = await rp.locator('.rec-chain[data-chain=took] .rec-ch').count();
  const chainTop = await text('.rec-chain[data-chain=took] .rec-ch');
  await rp.locator('.rec-chain[data-chain=took] [data-act=record-holder]').nth(1).click();
  await rp.waitForTimeout(500);
  const closed = !(await rp.locator('.ov-root:not([hidden])').count());
  const card = await text('.inspector .cp.pp .ins-name');
  await openOverview(rp);
  await rp.click('[data-act=records-copy]');
  await rp.waitForTimeout(200);
  const copied = ((await rp.evaluate(() => (window as any).__wfRecordsText)) as string) ?? '';
  let warOk = true;
  if (war && war.ref.kind === 'war') {
    await rp.click('.rec-row[data-key=war]');
    await rp.waitForTimeout(500);
    const on = await rp.locator('.ov-tab.on[data-tab=chronicle]').count();
    const pick = await rp.locator('.chron-pick select').first().inputValue().catch(() => '');
    warOk = on === 1 && pick === String(war.ref.a);
    await rp.click('.ov-tab[data-tab=records]');
    await rp.waitForTimeout(300);
  }
  let dynOk = true;
  if (dyn) {
    await rp.click('.rec-row[data-key=dynasty]');
    await rp.waitForTimeout(600);
    dynOk = (await rp.locator('.ov-tab.on[data-tab=people]').count()) === 1 && (await rp.locator('.lg-box').count()) === 1;
  }
  console.log(
    `世界之最:种子 7 第 ${Y} 年,页签 ${tabAfter};${rows} 行 ${groups} 组(${openMs} ms 出来);攻下州最多「${tookRow.slice(0, 60)}」新纪录 ${tookNew};` +
      `历来 ${chain} 任「${chainTop.slice(0, 30)}」→ 点上一任:收起 ${closed}、卡片「${card}」;复制「${copied.split('\n')[0]}」;仗 → 编年史 ${warOk};一朝 → 世系图 ${dynOk}`,
  );
  if (!tabAfter.includes('people,records,marks')) errs.push(`世界之最:「之最」页签没有放在「人物」后面(${tabAfter})`);
  if (rows !== 15 || groups !== 3) errs.push(`世界之最:不是 15 条、三组(${rows} 行;${groups} 组)`);
  if (!tookRow.includes(tookName) || !tookRow.includes(`${took.value} 州`) || !tookRow.includes(`历来 ${took.count} 任`) || tookNew !== 1)
    errs.push(`世界之最:"攻下州最多的将领"那行不对,或没标新纪录(${tookRow};应是 ${tookName} ${took.value} 州、历来 ${took.count} 任;${tookNew})`);
  if (chain !== took.count || !chainTop.includes(tookName) || !chainTop.includes('保持至今')) errs.push(`世界之最:「历来」展开不对(${chain} 行,应 ${took.count};${chainTop})`);
  if (!closed || card !== prevName) errs.push(`世界之最:点历来的名字没有收起概览、打开他的卡片(${closed};${card};应是 ${prevName})`);
  if (!copied.startsWith(`世界之最 · 到 ${Y} 年为止 · 种子 7`) || !copied.includes(`攻下州最多的将领：${tookName}`)) errs.push(`世界之最:复制全文不对(${copied.slice(0, 80)})`);
  if (!warOk) errs.push('世界之最:点打得最久的仗没有打开编年史、只看攻方');
  if (!dynOk) errs.push('世界之最:点国祚最长的一朝没有打开世系图');
  await rctx.close();
}

// 人物关系图:君主卡片「更多」最上面「关系图」→ 右边铺开以他为中心的图(左边卡片留着);点图上一位 → 换他居中、左边卡片跟着换、路径两段;
// ‹ 退回;× 收起 → 地图左上「回到关系图」→ 再打开(中心还在);Esc 收起、卡片还开着
if (part('人物关系图')) relation: {
  const { findPersonExample } = await import('./lib/smokeExamples');
  const ex = findPersonExample();
  if (!ex) break relation;
  await page.goto(`${dev.url}/?seed=${ex.seed}&civYear=${ex.year}`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.evaluate((id) => (window as any).__wfSelect('polity', id), ex.polity);
  await page.waitForTimeout(500);
  await page.click('.inspector .cp-rulers .cp-dyn-row.on');
  await page.waitForTimeout(400);
  const id = await page.locator('.inspector .cp.pp').getAttribute('data-person');
  await page.click('.inspector .cp.pp [data-act=more]');
  const first = await page.locator('.pm-menu .pm-item').first().getAttribute('data-act');
  await page.click('.pm-menu [data-act=person-relation]');
  await page.waitForTimeout(500);
  const center = await page.locator('.rg').getAttribute('data-relation-graph').catch(() => null);
  const nodes = await page.locator('.rg-canvas > .rg-node[data-relation]').count();
  const blocks = await page.locator('.rg-block').count();
  const next = page.locator('.rg-canvas > .rg-node[data-relation^="p"]').first();
  const nextK = await next.getAttribute('data-relation');
  await next.click();
  await page.waitForTimeout(700);
  const center2 = await page.locator('.rg').getAttribute('data-relation-graph').catch(() => null);
  const card2 = await page.locator('.inspector .cp.pp').getAttribute('data-person').catch(() => null);
  const crumbs = await page.locator('.rg-crumbs b, .rg-crumbs .lnk').count();
  await page.click('.rg [data-act=relation-back-step]');
  await page.waitForTimeout(600);
  const center3 = await page.locator('.rg').getAttribute('data-relation-graph').catch(() => null);
  const card3 = await page.locator('.inspector .cp.pp').getAttribute('data-person').catch(() => null);
  await page.click('.rg [data-act=relation-close]');
  await page.waitForTimeout(300);
  const back = await page.locator('.corner-tl [data-act=relation-back]').count();
  await page.click('.corner-tl [data-act=relation-back]').catch(() => {});
  await page.waitForTimeout(500);
  const reopened = await page.locator('.rg').getAttribute('data-relation-graph').catch(() => null);
  await page.mouse.move(5, 5);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const closed = !(await page.locator('.rg').count());
  const cardKept = await page.locator('.inspector .cp.pp').getAttribute('data-person').catch(() => null);
  console.log(
    `人物关系图:「更多」第一项 ${first};${center} ${nodes} 人、${blocks} 簇;点 ${nextK} → ${center2}、卡片 ${card2}、路径 ${crumbs} 段;‹ → ${center3}、卡片 ${card3};` +
      `× → 回到关系图 ${back} → ${reopened};Esc 收起 ${closed}、卡片 ${cardKept}`,
  );
  if (first !== 'person-relation') errs.push(`人物关系图:「更多」最上面不是「关系图」(${first})`);
  if (center !== `p${id}` || nodes < 2) errs.push(`人物关系图:没有以他为中心打开(${center};p${id};${nodes} 人)`);
  if (!nextK || center2 !== nextK || `p${card2}` !== nextK || crumbs !== 2) errs.push(`人物关系图:点一位没有换他居中、卡片没跟着换(${nextK};${center2};${card2};${crumbs})`);
  if (center3 !== `p${id}` || card3 !== id) errs.push(`人物关系图:‹ 没有退回(${center3};${card3})`);
  if (back !== 1 || reopened !== `p${id}`) errs.push(`人物关系图:收起后「回到关系图」不对(${back};${reopened})`);
  if (!closed || cardKept !== id) errs.push(`人物关系图:Esc 没收起、或者把卡片也关了(${closed};${cardKept})`);
  await page.keyboard.press('Escape');
}

// 作者标记:右下角「标记」→ 顶部提示条"点地图放标记",点城的位置放下 → 填写卡片(名字、年份、说明)→ 完成:地图上有图钉和名字、
// 卡片是看的样子;悬停图钉 = 小卡片在图钉左上方;撤销 / 重做;往回拖 100 年标记不见了;搜得到;世界概览「标记」页一行,点了打开;
// 「更多」→ 删除,提示条上「撤销」放回;州卡片「更多」→ 在这里加标记(几个州,地图上有名字牌);导出菜单多一行"作者标记"
if (part('作者标记')) {
  await page.goto(`${dev.url}/?seed=7&civYear=2512`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  const text = (sel: string) => page.locator(sel).first().innerText().then((t) => t.replace(/\s+/g, ' ')).catch(() => '');
  const marks = () => page.evaluate(() => (window as any).__wfMarks ?? null) as Promise<{ pins: { id: number; x: number; y: number; w: number; label: string | null }[]; areas: { id: number; pill: { text: string } | null }[] } | null>;
  // 放大到写名字的程度(大羽沿海城多的一带,世界坐标 1852, 512 放到地图中间),挑一座在看得见的地方的城
  await page.evaluate(
    ([sx, sy]) => {
      const w = window as any;
      w.__wfSetView({ k: 1, x: 0, y: 0 });
      const st = document.querySelector('.stage')!.getBoundingClientRect();
      const [bx, by] = w.__wfWorldToClient(1852, 512);
      w.__wfSetView({ k: 2.8, x: sx - (bx - st.left) * 2.8, y: sy - (by - st.top) * 2.8 });
    },
    [SIDE_ROOM + (vp.width - SIDE_ROOM) / 2, vp.height / 2 - 40],
  );
  await page.waitForTimeout(1200);
  const cities = (await page.evaluate(() => (window as any).__wfPickables())) as { kind: string; x: number; y: number }[];
  const city = cities.find((c) => c.kind === 'mark' && c.x > SIDE_ROOM + 120 && c.x < vp.width - 160 && c.y > 140 && c.y < vp.height - 200);
  await page.click('.map-controls [data-act=mark]');
  await page.waitForTimeout(200);
  const pressed = await page.locator('.map-controls [data-act=mark]').getAttribute('aria-pressed');
  const tip = await text('.toast');
  if (city) await page.mouse.click(city.x, city.y);
  await page.waitForTimeout(500);
  const editing = await page.locator('.inspector .mk-editing').count();
  const sub = await text('.inspector .mk-editing .cp-sub');
  await page.fill('[data-mk=title]', '主角的故乡');
  await page.fill('[data-mk=from]', '2490');
  await page.fill('[data-mk=to]', '2531');
  await page.fill('[data-mk=note]', '主角出生的渡口小镇。');
  await page.click('[data-act=mark-done]');
  await page.waitForTimeout(500);
  const card = await text('.inspector .mk-card');
  const m1 = await marks();
  const pin = m1?.pins.find((x) => x.label === '主角的故乡');
  // 悬停图钉(先关卡片:选中时别的都变淡,不影响悬停)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  let hover = '';
  let above = false;
  if (pin) {
    await page.mouse.move(pin.x, pin.y - pin.w * 0.7);
    await page.waitForTimeout(150);
    await page.mouse.move(pin.x + 0.5, pin.y - pin.w * 0.7);
    await page.waitForTimeout(250);
    hover = await text('.hover-card');
    const hb = await page.locator('.hover-card').boundingBox();
    above = !!hb && hb.y + hb.height < pin.y && hb.x + hb.width < pin.x;
  }
  await page.mouse.move(vp.width - 30, vp.height / 2);
  // 撤销 / 重做
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const undone = (await marks())?.pins.length ?? 0;
  const undoTip = await text('.toast');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  const redone = (await marks())?.pins.length ?? 0;
  // 往回 100 年(2412):标记还没开始,不画
  await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForTimeout(400);
  const before = (await marks())?.pins.length ?? -1;
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(400);
  // 搜索
  await page.fill('.sidebar .search-input', '渡口小镇');
  await page.waitForTimeout(300);
  const hitKind = await page.locator('.search-row').first().getAttribute('data-kind').catch(() => null);
  const hit = await text('.search-row');
  await page.fill('.sidebar .search-input', '');
  await page.keyboard.press('Escape');
  // 世界概览「标记」页
  await openOverview(page, 'marks');
  const rows = await page.locator('.chronicle.marks .mk-row').count();
  const row = await text('.chronicle.marks .mk-row');
  await page.locator('.chronicle.marks .mk-row').first().click();
  await page.waitForTimeout(500);
  const closed = !(await page.locator('.ov-root:not([hidden])').count());
  const card2 = await text('.inspector .mk-card .mk-title');
  // 删除 → 撤销
  await page.click('.inspector .mk-card [data-act=more]');
  await page.click('[data-act=mark-delete]');
  await page.waitForTimeout(300);
  const gone = (await marks())?.pins.length ?? 0;
  const delTip = await text('.toast');
  await page.click('.toast [data-act=mark-restore]').catch(() => {});
  await page.waitForTimeout(400);
  const back = (await marks())?.pins.filter((x) => x.label === '主角的故乡').length ?? 0;
  // 州卡片「更多」→ 在这里加标记:默认圈这一州
  await page.evaluate(() => (window as any).__wfSelect('region', 324));
  await page.waitForTimeout(500);
  await page.click('.inspector [data-act=more]');
  await page.click('[data-act=add-mark]');
  await page.waitForTimeout(400);
  const chips = await page.locator('.inspector .mk-editing .mk-chips span').count();
  await page.fill('[data-mk=title]', '第一卷');
  await page.click('[data-act=mark-done]');
  await page.waitForTimeout(500);
  const pill = (await marks())?.areas.find((a) => a.pill?.text === '第一卷');
  // 导出菜单:有标记时多一行
  await page.keyboard.press('Escape');
  await page.click('.export-btn');
  await page.waitForTimeout(300);
  const exportRow = await text('.export-marks');
  await page.click('.export-btn');
  console.log(
    `作者标记:按钮按下 ${pressed}、提示「${tip}」;点城 → 填写 ${editing}「${sub}」→ 卡片「${card.slice(0, 40)}…」、图钉 ${pin ? '有' : '没有'};` +
      `悬停「${hover}」在左上方 ${above};撤销 ${undone}「${undoTip}」、重做 ${redone};2412 年 ${before} 个;搜「${hit}」(${hitKind});` +
      `概览 ${rows} 行「${row.slice(0, 30)}」→ 收起 ${closed}、卡片「${card2}」;删除 ${gone}「${delTip}」→ 撤销 ${back};州卡片加标记 ${chips} 州、名字牌 ${pill ? '有' : '没有'};导出「${exportRow}」`,
  );
  if (pressed !== 'true' || !tip.includes('点地图放标记')) errs.push(`作者标记:「标记」按钮没有进入放标记(${pressed};${tip})`);
  if (!city || !editing || !/^作者标记，在.+的.+/.test(sub)) errs.push(`作者标记:点地图没有打开填写卡片(${!!city};${editing};${sub})`);
  if (!card.includes('主角的故乡') || !card.includes('作者标记，2490–2531 年') || !card.includes('主角出生的渡口小镇') || !pin) errs.push(`作者标记:完成后卡片 / 地图不对(${card.slice(0, 80)};${!!pin})`);
  if (!hover.includes('主角的故乡') || !hover.includes('点开看说明') || !above) errs.push(`作者标记:悬停小卡片不对(${hover};${above})`);
  if (undone !== 0 || !undoTip.includes('已撤销标记的修改') || redone !== 1) errs.push(`作者标记:撤销 / 重做不对(${undone};${undoTip};${redone})`);
  if (before !== 0) errs.push(`作者标记:还没到年份时地图上还画着(${before})`);
  if (hitKind !== 'mark' || !hit.includes('主角的故乡')) errs.push(`作者标记:按说明搜不到(${hit};${hitKind})`);
  if (rows !== 1 || !row.includes('2490') || !closed || card2 !== '主角的故乡') errs.push(`作者标记:概览「标记」页不对(${rows};${row};${closed};${card2})`);
  if (gone !== 0 || !delTip.includes('已删除标记「主角的故乡」') || back !== 1) errs.push(`作者标记:删除 / 放回不对(${gone};${delTip};${back})`);
  if (chips !== 1 || !pill) errs.push(`作者标记:州卡片加的标记不对(${chips};${!!pill})`);
  if (!exportRow.includes('作者标记')) errs.push(`作者标记:导出菜单没有"作者标记"一行(${exportRow})`);
  await page.evaluate(() => localStorage.clear());
}

// 作者的人物:世界概览「人物」→「我的 0」→ 新建人物:提示条"点地图选出生地",点城 → 出生地填上;填名字、生卒、身份 → 加一段经历(点另一座城、
// 勾推演里的人)→ 完成:卡片是看的样子(年龄、一生),地图上有足迹和头像;悬停头像 = 小卡片;拖到出生前不画头像;撤销 / 重做;搜得到;
// 「我的」一行,点了打开;勾过的推演人物、出生的城的卡片里有「作者的人物」;城卡片「更多」→ 在这里加人物;「更多」→ 删除,提示条上「撤销」放回
if (part('作者的人物')) {
  await page.goto(`${dev.url}/?seed=7&civYear=2512`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  const text = (sel: string) => page.locator(sel).first().innerText().then((t) => t.replace(/\s+/g, ' ')).catch(() => '');
  const trail = () => page.evaluate(() => (window as any).__wfTrail ?? null) as Promise<{ id: number; segs: unknown[]; dots: unknown[]; labels: { text: string }[]; pins: { x: number; y: number }[] } | null>;
  // 和作者标记同一处:大羽沿海城多的一带放大,挑两座在看得见的地方的城
  await page.evaluate(
    ([sx, sy]) => {
      const w = window as any;
      w.__wfSetView({ k: 1, x: 0, y: 0 });
      const st = document.querySelector('.stage')!.getBoundingClientRect();
      const [bx, by] = w.__wfWorldToClient(1852, 512);
      w.__wfSetView({ k: 2.8, x: sx - (bx - st.left) * 2.8, y: sy - (by - st.top) * 2.8 });
    },
    [SIDE_ROOM + (vp.width - SIDE_ROOM) / 2, vp.height / 2 - 40],
  );
  await page.waitForTimeout(1200);
  const picks = (await page.evaluate(() => (window as any).__wfPickables())) as { kind: string; id: number; x: number; y: number }[];
  const inView = picks.filter((c) => c.kind === 'mark' && c.x > SIDE_ROOM + 120 && c.x < vp.width - 160 && c.y > 140 && c.y < vp.height - 200);
  const cityA = inView[0];
  const cityB = inView.find((c) => Math.hypot(c.x - cityA.x, c.y - cityA.y) > 120);
  // 「我的 0」→ 新建人物
  await openOverview(page, 'people');
  const tabs = await page.locator('.chronicle.people .seg button').allInnerTexts();
  await page.locator('.chronicle.people .seg button').first().click();
  await page.waitForTimeout(200);
  const empty = await text('.oc-empty-mine');
  await page.click('[data-act=character-new-empty]');
  await page.waitForTimeout(400);
  const pickTip = await text('.toast');
  if (cityA) await page.mouse.click(cityA.x, cityA.y);
  await page.waitForTimeout(400);
  const birth = await text('.inspector [data-oc=character-birth]');
  await page.fill('[data-oc=name]', '林小满');
  await page.fill('[data-oc=born]', '2490');
  await page.fill('[data-oc=died]', '2561');
  await page.fill('[data-oc=role]', '书记官');
  // 加一段经历:点另一座城,勾一个推演里的人
  await page.click('[data-act=character-add-life]');
  await page.waitForTimeout(300);
  const lifeTip = await text('.toast');
  if (cityB) await page.mouse.click(cityB.x, cityB.y);
  await page.waitForTimeout(400);
  await page.fill('[data-oc=life-year]', '2506');
  await page.fill('[data-oc=life-text]', '随军西征');
  const chip = page.locator('.inspector [data-oc=life-people] .oc-chip').first();
  const chipText = (await chip.innerText().catch(() => '')).replace(/\s+/g, ' ');
  await chip.click().catch(() => {});
  await page.click('[data-act=character-life-done]');
  await page.waitForTimeout(300);
  await page.click('[data-act=character-done]');
  await page.waitForTimeout(600);
  const card = await text('.inspector .oc-card');
  const t1 = await trail();
  // 悬停头像
  let hover = '';
  const pin = t1?.pins[0];
  if (pin) {
    await page.mouse.move(pin.x, pin.y - 29);
    await page.waitForTimeout(150);
    await page.mouse.move(pin.x + 0.5, pin.y - 29);
    await page.waitForTimeout(250);
    hover = await text('.hover-card');
  }
  await page.mouse.move(vp.width - 30, vp.height / 2);
  // 往回 100 年(2412):还没出生,不画头像,足迹照画
  await page.keyboard.press('Shift+ArrowLeft');
  await page.waitForTimeout(400);
  const t2 = await trail();
  await page.keyboard.press('Shift+ArrowRight');
  await page.waitForTimeout(400);
  // 撤销 / 重做
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  const undone = (await trail())?.dots.length ?? -1;
  const undoTip = await text('.toast');
  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  // 搜索
  await page.fill('.sidebar .search-input', '随军西征');
  await page.waitForTimeout(300);
  const hitKind = await page.locator('.search-row').first().getAttribute('data-kind').catch(() => null);
  const hit = await text('.search-row');
  await page.fill('.sidebar .search-input', '');
  await page.keyboard.press('Escape');
  // 世界概览「人物」默认「我的」,一行,点了打开
  await openOverview(page, 'people');
  const rows = await page.locator('.chronicle.people .oc-row-mine').count();
  const row = await text('.chronicle.people .oc-row-mine');
  await page.locator('.chronicle.people .oc-row-mine').first().click();
  await page.waitForTimeout(500);
  const closed = !(await page.locator('.ov-root:not([hidden])').count());
  const card2 = await text('.inspector .oc-card .oc-name');
  // 勾过的推演人物的卡片
  const chipName = chipText.split(' ')[0];
  let personRefs = '';
  if (chipName) {
    await page.fill('.sidebar .search-input', chipName);
    await page.waitForTimeout(300);
    await page.locator('.search-row[data-kind=person]').first().click();
    await page.waitForTimeout(500);
    personRefs = await text('.inspector [data-oc=refs]');
  }
  // 出生的城的卡片;「更多」→ 在这里加人物
  let cityRefs = '';
  let addHere = '';
  let addPicking = '';
  if (cityA) {
    await page.evaluate((id) => (window as any).__wfSelect('settlement', id), cityA.id);
    await page.waitForTimeout(500);
    cityRefs = await text('.inspector [data-oc=refs]');
    await page.click('.inspector [data-act=more]');
    await page.click('[data-act=add-character]');
    await page.waitForTimeout(400);
    addHere = await text('.inspector [data-oc=character-birth]');
    addPicking = (await page.locator('.toast').count()) ? await text('.toast') : '';
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  const addClosed = !(await page.locator('.inspector .oc-editing').count());
  // 删除 → 撤销
  await openOverview(page, 'people');
  await page.locator('.chronicle.people .oc-row-mine').first().click();
  await page.waitForTimeout(500);
  await page.click('.inspector .oc-card [data-act=more]');
  await page.click('[data-act=character-delete]');
  await page.waitForTimeout(300);
  const gone = (await trail())?.dots.length ?? -1;
  const delTip = await text('.toast');
  await page.click('.toast [data-act=character-restore]').catch(() => {});
  await page.waitForTimeout(400);
  const back = (await trail())?.dots.length ?? 0;
  console.log(
    `作者的人物:分档 ${tabs.join('/')};空的「${empty.slice(0, 20)}…」;新建 → 提示「${pickTip}」→ 出生地「${birth}」;加经历提示「${lifeTip}」、勾「${chipText}」;` +
      `卡片「${card.slice(0, 50)}…」;足迹 ${t1?.dots.length ?? 0} 点 ${t1?.segs.length ?? 0} 段、头像 ${t1?.pins.length ?? 0};悬停「${hover}」;2412 年头像 ${t2?.pins.length ?? -1}、点 ${t2?.dots.length ?? -1};` +
      `撤销 ${undone}「${undoTip}」;搜「${hit}」(${hitKind});「我的」${rows} 行「${row.slice(0, 30)}」→ 收起 ${closed}、卡片「${card2}」;` +
      `推演人物卡片「${personRefs}」;城卡片「${cityRefs}」;在这里加人物「${addHere}」${addPicking ? `、提示「${addPicking}」` : ''}→ Esc 关掉 ${addClosed};删除 ${gone}「${delTip}」→ 撤销 ${back}`,
  );
  if (!tabs[0]?.startsWith('我的 0') || !empty.includes('还没有自己的人物')) errs.push(`作者的人物:「我的」页不对(${tabs.join('/')};${empty})`);
  if (!pickTip.includes('点地图选出生地') || !cityA || !birth || birth.includes('在地图上点')) errs.push(`作者的人物:新建后点地图没有选上出生地(${pickTip};${!!cityA};${birth})`);
  if (!lifeTip.includes('点地图选这段经历在哪') || !cityB || !chipText) errs.push(`作者的人物:加经历时挑地方 / 勾人不对(${lifeTip};${!!cityB};${chipText})`);
  if (!card.includes('林小满') || !card.includes('作者的人物，2490–2561 年') || !card.includes('22 岁') || !card.includes('随军西征')) errs.push(`作者的人物:完成后卡片不对(${card.slice(0, 120)})`);
  if (t1?.dots.length !== 2 || t1.segs.length !== 1 || t1.pins.length !== 1 || !t1.labels.some((l) => l.text.startsWith('2490'))) errs.push(`作者的人物:地图上的足迹不对(${JSON.stringify(t1)?.slice(0, 200)})`);
  if (!hover.includes('林小满') || !hover.includes('22 岁') || !hover.includes('点开看生平')) errs.push(`作者的人物:悬停头像的小卡片不对(${hover})`);
  if (t2?.pins.length !== 0 || t2.dots.length !== 2) errs.push(`作者的人物:出生前还画着头像(${t2?.pins.length};${t2?.dots.length})`);
  if (undone !== 0 || !undoTip.includes('已撤销人物的修改')) errs.push(`作者的人物:撤销不对(${undone};${undoTip})`);
  if (hitKind !== 'character' || !hit.includes('林小满')) errs.push(`作者的人物:按经历搜不到(${hit};${hitKind})`);
  if (rows !== 1 || !row.includes('林小满') || !row.includes('书记官') || !closed || card2 !== '林小满') errs.push(`作者的人物:「我的」页不对(${rows};${row};${closed};${card2})`);
  if (!personRefs.includes('林小满') || !personRefs.includes('2506 年随军西征')) errs.push(`作者的人物:勾过的推演人物卡片里没有他(${personRefs})`);
  if (!cityRefs.includes('林小满') || !cityRefs.includes('2490 年生在这里')) errs.push(`作者的人物:出生的城的卡片里没有他(${cityRefs})`);
  if (!addHere || addHere.includes('在地图上点') || addPicking.includes('点地图选出生地') || !addClosed) errs.push(`作者的人物:城卡片「在这里加人物」不对(${addHere};${addPicking};${addClosed})`);
  if (gone !== 0 || !delTip.includes('已删除人物「林小满」') || back !== 2) errs.push(`作者的人物:删除 / 放回不对(${gone};${delTip};${back})`);
  await page.evaluate(() => localStorage.clear());
}

// 信仰图层:按 3 换到"信仰"(网址记下);侧栏列出各教(大教、教派、最后一行民间信仰);悬停陆地显示这里信的教和所属的国;
// 点陆地打开这里信的教的卡片(类型、信众、大事);点侧栏的一行打开那个教;国家卡片里有"国教"一行
if (part('信仰图层')) {
  await page.goto(`${dev.url}/?seed=7`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  await page.mouse.click(SIDE_ROOM + (vp.width - SIDE_ROOM) / 2, vp.height / 2);
  await page.keyboard.press('Escape');
  await page.keyboard.press('3');
  await page.waitForFunction(() => (window as any).__wfCiv?.show?.faiths === true, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(300);
  const label = await page.locator('.seg-btn.on').innerText();
  const url = page.url();
  const rows = await page.locator('[data-testid=faiths] .sb-row').evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ')));
  const names = await page.locator('[data-testid=faiths] button.sb-row b').allInnerTexts();
  // 悬停:找一块不压着字的陆地,卡片上是某个教(侧栏里的大教 / 教派,或"某族祖灵 / 旧神")
  let card = '';
  let spot: [number, number] | null = null;
  for (let i = 0; i < 120 && !spot; i++) {
    const x = SIDE_ROOM + 40 + ((i * 197) % (vp.width - SIDE_ROOM - 120));
    const y = 140 + ((i * 83) % (vp.height - 320));
    await page.mouse.move(x, y);
    await page.waitForTimeout(25);
    card = await hoverText(page);
    if (names.some((n) => card.startsWith(n)) || /^\S+(祖灵|旧神)/.test(card)) spot = [x, y];
  }
  let panel = '';
  let panelFaith = '';
  if (spot) {
    await page.mouse.click(spot[0], spot[1]);
    await page.locator('.inspector .cp[data-faith]').waitFor({ timeout: 3000 }).catch(() => {});
    panel = (await page.locator('.inspector .cp[data-faith]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    await page.keyboard.press('Escape');
  }
  // 侧栏第一行(最大的教)
  await page.waitForTimeout(300);
  if (names.length) {
    await page.click('[data-testid=faiths] button.sb-row >> nth=0');
    await page.locator('.inspector .cp[data-faith]').waitFor({ timeout: 3000 }).catch(() => {});
    panelFaith = (await page.locator('.inspector .cp[data-faith]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    await page.keyboard.press('Escape');
  }
  // 国家卡片里的国教
  await page.evaluate(() => (window as any).__wfSelect('polity', 0));
  await page.waitForTimeout(400);
  const country = (await page.locator('.inspector .cp').innerText().catch(() => '')).replace(/\s+/g, ' ');
  await page.keyboard.press('Escape');
  console.log(
    `信仰图层:按 3 → ${label}(${/[?&]fill=faiths/.test(url) ? '网址记下' : url});侧栏 ${rows.length} 行「${rows.slice(0, 3).join(' | ')} … ${rows[rows.length - 1] ?? ''}」;` +
      `悬停「${card}」→ 卡片「${panel.slice(0, 60)}…」;侧栏第一行 → 「${panelFaith.slice(0, 40)}…」;国家卡片${country.includes('国教') ? '有' : '没有'}国教`,
  );
  if (label !== '信仰' || !/[?&]fill=faiths/.test(url)) errs.push(`信仰图层:按 3 没有换到"信仰" / 网址没记下(${label};${url})`);
  if (names.length < 2 || !/民间信仰/.test(rows[rows.length - 1] ?? '') || !rows.every((r) => /\d+ 州/.test(r))) errs.push(`信仰图层:侧栏的信仰列表不对(${rows.join(' | ')})`);
  if (!spot) errs.push(`信仰图层:悬停陆地没有显示这里信的教(${card})`);
  else if (!panel || !['类型', '信众'].every((w) => panel.includes(w)) || !panel.startsWith(card.split(' ')[0]))
    errs.push(`信仰图层:点陆地没有打开这里信的教的卡片(悬停「${card}」;卡片「${panel.slice(0, 80)}」)`);
  if (names.length && (!panelFaith.startsWith(names[0]) || !['类型', '创立', '圣城', '信众', '国教', '大事'].every((w) => panelFaith.includes(w))))
    errs.push(`信仰图层:点侧栏的教没有打开它的卡片 / 卡片缺行(${names[0]};${panelFaith.slice(0, 120)})`);
  if (!country.includes('国教')) errs.push(`信仰图层:国家卡片里没有"国教"一行(${country.slice(0, 80)})`);
  await page.evaluate(() => localStorage.clear());
}

// 写实风:地名(第一次画就用对字体、放大后重画)、某一点的读数、回放世界形成(地质放完接着放文明)、切回画过的画风不重画
if (part('写实风回放')) {
  await page.goto(`${dev.url}/?seed=7&style=realistic`);
  await page.waitForFunction(() => (window as any).__wf?.ready);

  // 地名(默认打开):第一次画字时字体就已经加载好(不闪默认字体),画出来的条数合理;滚轮放大后按新的倍数重画
  const labelsOk = await page
    .waitForFunction(() => (window as any).__wfLabels?.ready, null, { timeout: 30000 })
    .then(() => true, () => false);
  const labels = await page.evaluate(() => (window as any).__wfLabels);
  console.log('地名:', JSON.stringify(labels));
  if (!labelsOk || !(labels?.drawn > 5)) errs.push('地名没有画出来');
  if (labels && !labels.firstFontOk) errs.push('第一次画地名时字体还没加载好(会闪一下默认字体)');
  {
    const box = (await page.locator('.map-box').boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.4);
    await page.mouse.wheel(0, -600);
    await page.waitForFunction(() => (window as any).__wfLabels?.k > 1.5, null, { timeout: 10000 }).catch(() => {});
    const z = await page.evaluate(() => (window as any).__wfLabels);
    console.log('放大后地名:', JSON.stringify(z));
    if (!(z?.k > 1.5) || !(z?.drawn > 5)) errs.push('放大后地名没有重画');
    await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(200);
  }
  await replayClick();
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'snaps/replay-a.png' });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: 'snaps/replay-b.png' });
  // 某一点的读数(回放时悬停卡片不出来,读数照常)
  await page.mouse.move(900, 400);
  await page.waitForTimeout(300);
  const hover = await probe(page, 900, 400);
  console.log('读数:', hover || '(无)');
  if (!hover.includes('海拔') && !hover.includes('水深')) errs.push('某一点的读数(海拔 / 水深)没有');

  // 回放按钮在概览"世界设定"页(点了概览收起);地质放完时字幕从"约 N 百万年前 / 今天"换成文明回放的"第 N 年"
  await page.waitForFunction(() => /第 \d+ 年/.test(document.querySelector('.caption .big')?.textContent ?? ''), null, { timeout: 20000 });

  // 地质放完接着放文明:时间轴从第 0 年往后走,色块用半分辨率,量每帧耗时(底图 + 国名、城镇符号的文字层;只记数,见 timing)
  const civFrames = await page.evaluate(async () => {
    const w = window as any;
    const ms: number[] = [];
    const years: number[] = [];
    let last: unknown = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      await new Promise((r) => requestAnimationFrame(r));
      const c = w.__wfCiv;
      if (c && c !== last && c.fast) {
        const l = w.__wfLabels;
        ms.push(c.ms + (l && l.fast && Math.abs(l.year - c.year) < 1e-6 ? l.ms : 0));
        years.push(c.year);
      }
      last = c;
    }
    return { ms, years, caption: document.querySelector('.caption .big')?.textContent ?? '', bar: !!document.querySelector('.civ-timeline') };
  });
  const sorted = [...civFrames.ms].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? NaN;
  console.log(
    `文明回放:${civFrames.ms.length} 帧,第 ${Math.round(civFrames.years[0] ?? NaN)} → ${Math.round(civFrames.years.at(-1) ?? NaN)} 年,` +
      `每帧(底图 + 文字层)中位数 ${median.toFixed(1)} ms、最慢 ${(sorted.at(-1) ?? NaN).toFixed(1)} ms;字幕 ${JSON.stringify(civFrames.caption)}`,
  );
  if (civFrames.ms.length < 5 || !(civFrames.years.at(-1)! > civFrames.years[0])) errs.push('地质回放放完后文明回放没有接着放');
  if (!civFrames.bar || !/第 \d+ 年/.test(civFrames.caption)) errs.push('文明回放时没有时间轴 / "第 N 年"字幕');
  timing('文明回放每帧(中位数)', median, REPLAY_BUDGET);
  // 悬停时显示民族名
  await page.mouse.move(1150, 330);
  await page.waitForTimeout(300);
  const civHover = await page.locator('.hover').innerText().catch(() => '');
  console.log('文明回放时悬停:', civHover.replace(/\n/g, ' / ') || '(无)');

  // 同一个世界里切回画过的画风:直接贴缓存,不重画
  for (const id of ['terrain', 'realistic', 'terrain']) {
    await markWf();
    await pickLayer(page, id);
    await waitRedraw();
  }
  const cached = await wf();
  console.log('切回画过的画风 renderMs:', cached.renderMs.toFixed(1));
  if (!(cached.renderMs < 20)) errs.push(`切回画过的画风仍在重画(renderMs=${cached.renderMs.toFixed(1)})`);
}

// 写实风放大到 4 倍左右:地形按屏幕现算一块块(后台线程),停下来以后看得见的块都算好、放上去(淡入完),没有报错;
// 换到地形图(手绘风)现算的块撤掉;缩回 1 倍细节层关掉
if (part('写实风放大')) {
  const zp = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  zp.on('pageerror', (e) => errs.push(`放大现算:${e.message}`));
  zp.on('console', (m) => m.type() === 'error' && errs.push(`放大现算:${m.text()}`));
  await zp.goto(`${dev.url}/?seed=7&style=realistic`);
  await zp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  const at = await centerOn(zp, 1040, 650);
  if (at) await zp.mouse.move(at[0], at[1]);
  const zk = () => zp.evaluate(() => (window as any).__wfDetail?.k ?? (window as any).__wfView?.k ?? 1);
  for (let i = 0; i < 8; i++) {
    const cur = await zk();
    if (Math.abs(Math.log(4 / cur)) < 0.05) break;
    await zp.mouse.wheel(0, -Math.log(4 / cur) / 0.0015);
    await zp.waitForTimeout(250);
    // 细节层在后台备料(分帧),画上去以后读到的才是这一次的倍数
    await zp.waitForFunction(() => !(window as any).__wfDetail?.pending, null, { timeout: 30000 }).catch(() => {});
  }
  await zp.mouse.move(5, 5);
  const t0 = Date.now();
  const allIn = await zp
    .waitForFunction(() => {
      const t = (window as any).__wfDetail?.tiles;
      return t && t.want > 0 && t.shown >= t.want && t.busy === 0 && t.queued === 0;
    }, null, { timeout: 60000 })
    .then(() => true, () => false);
  const took = Date.now() - t0;
  await zp.waitForTimeout(600);
  const z = await zp.evaluate(() => {
    const d = (window as any).__wfDetail;
    const tiles = [...document.querySelectorAll('.detail-tiles canvas.tile')] as HTMLCanvasElement[];
    // 放上去的块有画面(不是空白的)
    let lit = 0;
    for (const c of tiles.slice(0, 4)) {
      const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < px.length; i += 4 * 97) if (px[i] > 0) n++;
      if (n > 0.9 * (px.length / (4 * 97))) lit++;
    }
    return { k: d?.k, tiles: d?.tiles, dom: tiles.length, faded: tiles.filter((c) => c.classList.contains('fade') || getComputedStyle(c).opacity !== '1').length, lit, checked: Math.min(4, tiles.length) };
  });
  console.log(
    `写实风放大 ${z.k?.toFixed(1)} 倍现算:第 ${z.tiles?.S} 档,要 ${z.tiles?.want} 块、放上 ${z.tiles?.shown} 块(页面上 ${z.dom} 块,没淡入完 ${z.faded} 块,抽查 ${z.checked} 块有画面 ${z.lit} 块);` +
      `停下来到齐 ${took} ms,${z.tiles?.workers} 个后台线程、每块平均 ${z.tiles?.ms?.toFixed(0)} ms`,
  );
  if (!allIn || !z.tiles || !(z.tiles.want > 0)) errs.push(`放大现算:写实风放大到 4 倍停下来以后,看得见的块没有都算好(${JSON.stringify(z.tiles)})`);
  if (z.dom < (z.tiles?.want ?? 1) || z.faded) errs.push(`放大现算:块没有都放上去 / 没淡入完(页面上 ${z.dom} 块,没淡入完 ${z.faded} 块)`);
  if (z.lit < z.checked) errs.push(`放大现算:放上去的块是空白的(抽查 ${z.checked} 块,有画面 ${z.lit} 块)`);
  // 同一档往旁边拖几屏再停下:挪出视口的块撤掉,页面上的块不越攒越多(不超过看得见的块数)
  for (let i = 0; i < 3; i++) {
    await zp.evaluate(() => {
      const v = (window as any).__wfView;
      (window as any).__wfSetView({ k: v.k, x: v.x - 700, y: v.y });
    });
    await zp.waitForTimeout(300);
  }
  const panIn = await zp
    .waitForFunction(() => {
      const t = (window as any).__wfDetail?.tiles;
      return t && t.want > 0 && t.shown >= t.want && t.busy === 0 && t.queued === 0;
    }, null, { timeout: 60000 })
    .then(() => true, () => false);
  await zp.waitForTimeout(600);
  const pan = await zp.evaluate(() => ({ dom: document.querySelectorAll('.detail-tiles canvas.tile').length, tiles: (window as any).__wfDetail?.tiles }));
  if (!panIn || !pan.tiles || pan.dom > pan.tiles.want) errs.push(`放大现算:拖远以后页面上的块比看得见的多(页面上 ${pan.dom} 块,${JSON.stringify(pan.tiles)})`);
  await pickLayer(zp, 'terrain');
  await zp.waitForFunction(() => (window as any).__wf?.style === 'fantasy', null, { timeout: 30000 }).catch(() => {});
  await zp.waitForTimeout(400);
  const fz = await zp.evaluate(() => ({ dom: document.querySelectorAll('.detail-tiles canvas.tile').length, tiles: (window as any).__wfDetail?.tiles ?? null }));
  if (fz.dom || fz.tiles) errs.push(`放大现算:换到手绘风以后现算的块没有撤掉(页面上 ${fz.dom} 块)`);
  await pickLayer(zp, 'realistic');
  await zp.waitForFunction(() => (window as any).__wf?.style === 'realistic', null, { timeout: 30000 }).catch(() => {});
  await zp.mouse.move(700, 400);
  for (let i = 0; i < 8 && (await zk()) > 1.01; i++) {
    await zp.mouse.wheel(0, Math.log(await zk()) / 0.0015 + 50);
    await zp.waitForTimeout(250);
  }
  await zp.waitForTimeout(400);
  const back = await zp.evaluate(() => ({ k: (window as any).__wfView?.k, on: (window as any).__wfDetail?.on, dom: document.querySelectorAll('.detail-tiles canvas.tile').length }));
  if (back.on || back.dom) errs.push(`放大现算:缩回 1 倍后细节层 / 现算的块没有撤掉(${JSON.stringify(back)})`);
  await zp.close();
}

// 地区(地区图、立体):右下「地区」→ 地图上出一个框(写着多大)、按钮按下去;看这一块 = 地区图(一页:先粗后细,标题是框里的山名,
// 2 倍清晰度,图例列出这一页上的城镇、线和山峰);底条切到立体:先粗后细都画出来,时间轴的位置换成控件条;
// 框和角度写进网址、新页面打开那个网址是同一个角度;导出菜单里导出立体这一面;
// 拖着转、换画风(重新上色)不出错;「回到地图」→ 收起、时间轴回来、刚才的框淡淡留一会儿
if (part('立体地形')) {
  const rp = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  rp.on('pageerror', (e) => errs.push(`立体地形:${e.message}`));
  rp.on('console', (m) => m.type() === 'error' && errs.push(`立体地形:${m.text()}`));
  await rp.goto(`${dev.url}/?seed=7&map=satellite&sat=detail&fill=none`);
  await rp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await rp.click('.map-controls [data-act=relief]');
  const picking = await rp
    .waitForSelector('.rp-box', { timeout: 30000 })
    .then(() => true, () => false);
  const pressed = await rp.locator('.map-controls [data-act=relief]').getAttribute('aria-pressed');
  const size = await rp.locator('.rp-size').innerText().catch(() => '');
  // 玉屏山一带的一小块(约 580 公里见方):先看地区图
  const tr = Date.now();
  await rp.evaluate(() => (window as any).__wfReliefPick?.open({ cx: 1478, cy: 436, w: 30, h: 30 }));
  const paged = await rp
    .waitForFunction(() => (window as any).__wfRegion?.drawn === 'fine', null, { timeout: 90000 })
    .then(() => true, () => false);
  const rg = await rp.evaluate(() => ({
    dbg: (window as any).__wfRegion,
    title: document.querySelector('.rv-t b')?.textContent ?? '',
    cv: (() => {
      const c = document.querySelector('.rgm-sheet') as HTMLCanvasElement | null;
      return c ? [c.width, c.height] : null;
    })(),
    face: document.querySelector('.ab-seg button.on')?.getAttribute('data-face'),
    timeline: !!document.querySelector('.bottom-row') && getComputedStyle(document.querySelector('.bottom-row')!).display !== 'none',
  }));
  console.log(`地区图:${Date.now() - tr} ms(粗的 ${rg.dbg?.coarseMs} ms、细的 ${rg.dbg?.fineMs} ms),「${rg.title}」${rg.cv?.join('×')},山峰 ${rg.dbg?.peaks} 座,图例 ${rg.dbg?.lines?.join('、')}`);
  if (!paged || rg.title !== '玉屏山一带' || rg.face !== 'flat' || rg.timeline || !rg.cv || rg.cv[0] !== 2560 || !(rg.dbg?.peaks > 0) || !rg.dbg?.lines?.includes('河'))
    errs.push(`立体地形:看这一块没出地区图 / 标题、清晰度、图例不对(${JSON.stringify({ paged, ...rg })})`);
  // 导出这一页:底条右边「导出图片」→ 卡片(标题、版式、清晰度、格式)→ 导出 2 倍 PNG(就是屏幕上那一页)
  await rp.click('.rv-bar [data-act=region-export]');
  const rx = await rp.evaluate(() => ({
    title: (document.querySelector('.rx .rx-field') as HTMLInputElement | null)?.value ?? '',
    sizes: [...document.querySelectorAll('.rx .rx-seg button')].map((b) => b.textContent ?? ''),
    name: document.querySelector('.rx .rx-small')?.textContent ?? '',
  }));
  await rp.click('[data-act=region-save]');
  const saved = await rp
    .waitForFunction(() => (window as any).__wfRegionExport?.bytes > 0 && !document.querySelector('.rx'), null, { timeout: 30000 })
    .then(() => rp.evaluate(() => (window as any).__wfRegionExport), () => null);
  console.log(`地区图导出:「${rx.title}」${rx.sizes.join(' / ')};${saved?.name} ${Math.round((saved?.bytes ?? 0) / 1e3)} KB`);
  if (rx.title !== '玉屏山一带' || !rx.sizes.includes(`${rg.cv?.[0]}×${rg.cv?.[1]}`) || !saved || !/^文明与地图-种子7-玉屏山一带-第\d+年-.+\.png$/.test(saved.name) || saved.type !== 'image/png')
    errs.push(`立体地形:地区图导出卡片 / 导出的文件不对(${JSON.stringify({ rx, saved })})`);
  // 底条切到立体:同一个框立起来
  const t0 = Date.now();
  await rp.click('.ab-seg [data-face=relief]');
  const fine = await rp
    .waitForFunction(() => (window as any).__wfRelief?.level === 'fine', null, { timeout: 90000 })
    .then(() => true, () => false);
  const took = Date.now() - t0;
  const rv = await rp.evaluate(() => ({
    dbg: (window as any).__wfRelief,
    title: document.querySelector('.rv-t b')?.textContent ?? '',
    sub: document.querySelector('.rv-t small')?.textContent ?? '',
    timeline: !!document.querySelector('.bottom-row') && getComputedStyle(document.querySelector('.bottom-row')!).display !== 'none',
    controls: [...document.querySelectorAll('.rv .map-controls button')].length,
  }));
  console.log(`立体地形:框上写「${size}」;立起来 ${took} ms(粗的 ${rv.dbg?.coarseMs} ms、细的 ${rv.dbg?.fineMs} ms,贴图 ${rv.dbg?.tex}、${rv.dbg?.verts} 个点、起伏 ×${rv.dbg?.ex});「${rv.title}」${rv.sub}`);
  if (!picking || pressed !== 'true' || !/^约 \d+/.test(size)) errs.push(`立体地形:点「立体」没出框 / 按钮没按下 / 框上没写多大(${picking} ${pressed}「${size}」)`);
  if (!fine) errs.push(`立体地形:细的一档没画出来(${JSON.stringify(rv.dbg)})`);
  if (rv.title !== '玉屏山一带' || rv.timeline || rv.controls < 4) errs.push(`立体地形:控件条 / 右下一列不对(「${rv.title}」,时间轴还在 ${rv.timeline},右下 ${rv.controls} 个按钮)`);
  // 拖着转一下、换成地理图(只重新上色)
  const cv = await rp.locator('.rv canvas').boundingBox();
  if (cv) {
    await rp.mouse.move(cv.x + cv.width * 0.6, cv.y + cv.height * 0.5);
    await rp.mouse.down();
    await rp.mouse.move(cv.x + cv.width * 0.6 - 120, cv.y + cv.height * 0.5 + 30, { steps: 6 });
    await rp.mouse.up();
  }
  // 框和角度写进网址(停下约半秒);导出菜单里「导出立体这一面」→ PNG(看得见的那一块,两倍像素密度);
  // 同一个网址在新页面打开:直接进这一块的立体,角度一样
  await rp.waitForTimeout(900);
  const linkUrl = await rp.evaluate(() => location.href);
  const ang = await rp.evaluate(() => (window as any).__wfRelief?.angle);
  await rp.click('.export-btn');
  await rp.click('.export-item[data-job=relief]');
  const shot = await rp
    .waitForFunction(() => (window as any).__wfExport?.job === 'relief' && (window as any).__wfExport.bytes > 0, null, { timeout: 30000 })
    .then(() => rp.evaluate(() => (window as any).__wfExport), () => null);
  console.log(`立体导出:${shot?.name} ${shot?.w}×${shot?.h} ${Math.round((shot?.bytes ?? 0) / 1e3)} KB;网址 ${linkUrl.replace(/^.*?\?/, '?')}`);
  if (!/[?&]area=[\d.,%C-]+/.test(linkUrl) || !/[?&]face=3d/.test(linkUrl) || !/[?&]ang=/.test(linkUrl) || !ang)
    errs.push(`立体地形:框、角度没写进网址(${linkUrl})`);
  if (!shot || !/^文明与地图-种子7-玉屏山一带-第\d+年-立体-.+\.png$/.test(shot.name) || !(shot.w > 1000))
    errs.push(`立体地形:导出立体这一面不对(${JSON.stringify(shot)})`);
  const lp = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  lp.on('pageerror', (e) => errs.push(`立体地形(链接):${e.message}`));
  await lp.goto(linkUrl);
  const linked = await lp
    .waitForFunction(() => (window as any).__wfRelief?.level === 'fine' && (window as any).__wfRelief?.angle, null, { timeout: 120000 })
    .then(() => lp.evaluate(() => ({ angle: (window as any).__wfRelief?.angle, title: document.querySelector('.rv-t b')?.textContent ?? '', face: document.querySelector('.ab-seg button.on')?.getAttribute('data-face') })), () => null);
  console.log(`立体链接:${JSON.stringify(linked)}(原来 ${JSON.stringify(ang)})`);
  if (!linked || linked.face !== 'relief' || linked.title !== '玉屏山一带' || !ang || Math.abs(linked.angle.yaw - ang.yaw) > 0.2 || Math.abs(linked.angle.pitch - ang.pitch) > 0.2 || Math.abs(linked.angle.zoom / ang.zoom - 1) > 0.02)
    errs.push(`立体地形:网址打开没进同一个角度的立体(${JSON.stringify({ linked, ang })})`);
  await lp.close();
  const f0 = await rp.evaluate(() => (window as any).__wfRelief?.frames ?? 0);
  await pickLayer(rp, 'geo');
  await rp.waitForTimeout(3000);
  const f1 = await rp.evaluate(() => (window as any).__wfRelief?.frames ?? 0);
  if (!(f1 > f0)) errs.push(`立体地形:换成地理图以后立体没有重画(${f0} → ${f1} 帧)`);
  // 换成手绘:按这一块的大小重画(整块画一张)
  await pickLayer(rp, 'terrain');
  const drawn = await rp
    .waitForFunction(() => (window as any).__wfRelief?.look === 'fantasy', null, { timeout: 60000 })
    .then(() => true, () => false);
  if (!drawn) errs.push(`立体地形:换成手绘以后立体没有按手绘重画(${JSON.stringify(await rp.evaluate(() => (window as any).__wfRelief))})`);
  await rp.click('.rv-bar .b');
  await rp.waitForTimeout(400);
  const closed = await rp.evaluate(() => ({ rv: document.querySelectorAll('.rv').length, timeline: getComputedStyle(document.querySelector('.bottom-row')!).display !== 'none', ghost: !!document.querySelector('.rp-ghost') }));
  if (closed.rv || !closed.timeline || !closed.ghost) errs.push(`立体地形:点「回到地图」以后没收起 / 时间轴没回来 / 刚才的框没留下(${JSON.stringify(closed)})`);
  // 导出菜单里的「地区图」:进框一块
  await rp.click('.export-btn');
  await rp.click('.export-item[data-job=region]');
  const picked = await rp
    .waitForSelector('.rp-box', { timeout: 15000 })
    .then(() => true, () => false);
  if (!picked) errs.push('立体地形:导出菜单里点「地区图」没进框一块');
  await rp.keyboard.press('Escape');
  // 山脉卡片「看立体」:搜玉屏山点开卡片 → 直接立起来(手绘),山名和最高峰的海拔立在山顶
  await rp.fill('[data-act=search]', '玉屏山');
  await rp.waitForTimeout(400);
  await rp.press('[data-act=search]', 'Enter');
  const card = await rp
    .waitForSelector('[data-act=view-relief]', { timeout: 15000 })
    .then(() => true, () => false);
  if (!card) errs.push('立体地形:玉屏山的卡片上没有「看立体」');
  else {
    const peak = await rp.evaluate(() => document.querySelector('[data-stat="最高峰"]')?.textContent ?? '');
    await rp.click('[data-act=view-relief]');
    const up = await rp
      .waitForFunction(() => (window as any).__wfRelief?.level === 'fine' && document.querySelector('.rv-peak b'), null, { timeout: 90000 })
      .then(() => true, () => false);
    const rv2 = await rp.evaluate(() => ({
      title: document.querySelector('.rv-t b')?.textContent ?? '',
      peaks: [...document.querySelectorAll('.rv-peak b')].map((e) => e.textContent ?? ''),
      shown: [...document.querySelectorAll('.rv-peak')].filter((e) => (e as HTMLElement).style.visibility !== 'hidden').length,
      look: (window as any).__wfRelief?.look,
    }));
    console.log(`立体地形:卡片「看立体」→「${rv2.title}」,山名 ${rv2.peaks.join('、')}(卡片上最高峰 ${peak})`);
    const m = peak.match(/(\d+)/);
    if (!up || rv2.title !== '玉屏山一带' || rv2.look !== 'fantasy' || !rv2.shown || !rv2.peaks.some((t) => t.startsWith('玉屏山') && (!m || t.includes(`${m[1]} 米`))))
      errs.push(`立体地形:卡片上点「看立体」没立起来 / 山名不对(${JSON.stringify({ up, peak, ...rv2 })})`);
    await rp.click('.rv-bar .b');
  }
  await rp.close();
}

// 回放中点概览"世界设定"页的"以它为底稿新建…":概览收起,换成新建界面(不弹新建窗口;左边设定:种子锁着,地形、参数带过去);
// 带着东西、起好了名,一开始就存成没建完的(网址 w=编号,刷新不丢);什么都没动就点返回,这一份删掉
if (part('以它为底稿新建')) {
  await replayClick();
  await page.waitForTimeout(1000);
  await openOverview(page, 'genesis');
  await page.click('.ov-seg [data-tab=civ]');
  await page.click('.ov [data-act=draft-from]');
  const fromCard = (await page.locator('.studio .st-left').waitFor({ timeout: 5000 }).then(() => true, () => false)) && !(await page.locator('.nd-scrim').count());
  const fromClosed = !(await page.locator('.ov-root:not([hidden])').count());
  const fromSeed = (await page.locator('.st-left [data-act=seed-locked]').innerText().catch(() => '')).replace(/\n/g, ' ');
  const fromUrl = page.url();
  const fromId = new URL(fromUrl).searchParams.get('w');
  const fromKey = `wenming-ditu:world:${fromId}`;
  const fromStored = !!fromId && (await page.evaluate((k) => localStorage.getItem(k) !== null, fromKey));
  await page.click('.st-left [data-act=back]').catch(() => {});
  await page.locator('.studio').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  const fromLeft = !!fromId && (await page.evaluate((k) => localStorage.getItem(k) !== null, fromKey));
  console.log(`以它为底稿新建:卡片 ${fromCard}、概览收起 ${fromClosed}、种子「${fromSeed}」、网址 ${fromUrl.split('?')[1]}、存下了 ${fromStored};没动就返回后还在 ${fromLeft}`);
  if (!fromCard || !fromClosed) errs.push('点"以它为底稿新建"后没有换成新建界面(或弹了新建窗口) / 概览没收起');
  if (!/种子.*7/.test(fromSeed)) errs.push(`以它为底稿新建:种子应锁着、还是 7(${fromSeed})`);
  if (!fromStored) errs.push(`以它为底稿新建:应一开始就存成没建完的、网址带 w=编号(${fromUrl})`);
  if (fromLeft) errs.push('以它为底稿新建后什么都没动就返回,没建完的那一份没有删掉');
}

// 新建界面:进来就是地球仪(不放板块漂移,左边没有「重看星球形成」),左边一句说是按种子随机生成;
// 「换一颗」:种子、网址换了,生成时顶部提示条上有进度;随机生成的新建拖进图片不导入(提示条说一句)
if (part('新建界面')) {
  await page.goto(`${dev.url}/?new=1&seed=7&style=realistic`);
  await studioReady();
  const theme = await page.locator('.app').getAttribute('data-theme');
  const styles = await page.locator('.st-right [data-style]').count();
  const projs = await page.locator('.st-right [data-proj]').count();
  const replayRow = await page.locator('.studio [data-act=replay]').count();
  const intro = await page.locator('.st-left .nw-intro').innerText().catch(() => '');
  await markWf();
  const planet0 = await page.evaluate(() => (window as any).__wfPlanet?.tag);
  const genT0 = await page.evaluate(() => performance.now());
  await page.click('.studio [data-act=new-seed]');
  // 生成新世界时顶部提示条上有进度
  const genToast = await page.locator('.toast[data-toast=progress]').innerText({ timeout: 5000 }).catch(() => '');
  await waitRedraw();
  // 默认大小(3.6 万地块)的新世界,从点下去到新建界面的星球露出新的一颗(开始淡入的那一帧;地图先出来,历史随后在后台推完);
  // 目标 2 秒内。Node 里单线程量不准,在浏览器里量(页面自己的时钟);只记数不卡合并
  const planetAt = await page
    .waitForFunction((t) => ((window as any).__wfPlanet?.tag !== t ? (window as any).__wfPlanet.at : null), planet0, { timeout: 30000 })
    .then((h) => h.jsonValue() as Promise<number>, () => NaN);
  timing('新建默认世界到星球露出新的一颗', planetAt - genT0, 2000);
  // 历史推完(世界齐了)再往下查
  await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  const seed2 = await page.locator('.nw-seed-input').inputValue();
  const imgNote = await page
    .evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' }));
      const el = document.querySelector('.app')!;
      for (const type of ['dragenter', 'dragover', 'drop']) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    })
    .then(() => page.locator('.toast').filter({ hasText: '不能导入图片' }).innerText({ timeout: 3000 }))
    .then((t) => t.replace(/\n/g, ' '), () => '');
  console.log(
    `新建界面:主题 ${theme}、样式 ${styles} 种、投影 ${projs} 种、重看星球形成 ${replayRow} 个、「${intro}」;` +
      `换一颗:种子 7 → ${seed2},生成时提示条「${genToast.replace(/\n/g, ' ')}」;拖进图片 →「${imgNote}」`,
  );
  if (theme !== 'dark' || styles !== 7 || projs !== 6) errs.push(`新建界面:不是深色(${theme}),或右边样式 / 投影不全(${styles} / ${projs})`);
  if (replayRow || !intro.includes('按种子随机生成')) errs.push(`新建界面:左边还有「重看星球形成」,或开头那句没说按种子随机生成(${intro})`);
  if (!genToast) errs.push('生成新世界时顶部提示条上没有进度');
  if (seed2 === '7' || !new RegExp(`[?&]seed=${seed2}(&|$)`).test(page.url())) errs.push(`点"换一颗"后种子 / 网址没变(${seed2},${page.url()})`);
  if (!imgNote || (await page.locator('.imp-step').count())) errs.push(`随机生成的新建:拖进图片应不导入、提示条说一句(${imgNote})`);
}

// 照故事找世界:新建第 1 步「照故事找世界 ›」→ 条件页(地图露出来、浅色);选例子「海上强国」、搜 6 个(真推,后台线程)→
// 搜的时候有进度、搜完有全合的;点一个 → 地图换成那个世界、顶上一条写种子和开场年份;「用这个世界」→ 回到新建第 2 步(文明种子锁着、
// 一句说明、按钮「建好，停在第 N 年」)→ 建好以后时间停在那一年、侧栏顶上「照故事找的」一组
if (part('照故事找世界')) {
  await page.goto(`${dev.url}/?new=1&seed=7&play=0`);
  await studioReady();
  await page.locator('.studio [data-act=story-finder]:not([disabled])').click({ timeout: 30000 });
  await page.locator('.fd-panel [data-page=conds]').waitFor({ timeout: 10000 });
  const theme = await page.locator('.app').getAttribute('data-theme');
  await page.click('.fd-panel [data-preset=sea-power]');
  const count = page.locator('.fd-panel input[aria-label="搜几个世界"]');
  await count.fill('6');
  await count.blur();
  const t0 = Date.now();
  await page.click('.fd-panel [data-act=finder-start]');
  const prog = await page.locator('[data-testid=finder-progress]').innerText({ timeout: 10000 }).catch(() => '');
  await page.waitForFunction(() => !document.querySelector('[data-testid=finder-progress]'), null, { timeout: 240000 }).catch(() => {});
  const searchMs = Date.now() - t0;
  const full = await page.locator('.fd-panel .fd-res:not(.near)').count();
  const lead = await page.locator('.fd-panel .fd-lead').first().innerText().catch(() => '');
  // 搜完会选上最合的那个:等它生成好(顶上一条不再写"正在打开")
  await page.waitForFunction(() => /种子 \d+，第 \d+ 年/.test(document.querySelector('[data-testid=finder-pill]')?.textContent ?? '') && !document.querySelector('[data-testid=finder-pill]')?.textContent?.includes('正在打开'), null, { timeout: 60000 }).catch(() => {});
  const pill = await page.locator('[data-testid=finder-pill]').innerText().catch(() => '');
  const year = Number(/第 (\d+) 年/.exec(pill)?.[1] ?? NaN);
  await page.locator('.fd-panel [data-act=finder-use]').first().click({ timeout: 10000 }).catch(() => {});
  const note = await page.locator('.studio [data-testid=found-note]').innerText({ timeout: 30000 }).catch(() => '');
  const btn = await page.locator('.studio [data-act=create-world]').innerText().catch(() => '');
  const civSeed = await page.locator('.studio [data-act=civ-seed-found]').innerText().catch(() => '');
  await createNow().catch(() => {});
  await page.locator('[data-testid=found-side]').waitFor({ timeout: 30000 }).catch(() => {});
  const side = await page.locator('[data-testid=found-side]').innerText().catch(() => '');
  const tl = await page.locator('.bottom-row').innerText().catch(() => '');
  console.log(
    `照故事找世界:条件页主题 ${theme};进度「${prog.split('\n')[0]}」,搜 6 个 ${Math.round(searchMs / 1000)} 秒、全合 ${full} 个(${lead.replace(/\n/g, ' ')});` +
      `选中「${pill.replace(/\n/g, ' ')}」→ 第 2 步「${civSeed.replace(/\n/g, ' ')}」「${btn}」;建好以后侧栏「${side.split('\n').slice(0, 3).join(' ')}」、时间轴「${tl.split('\n')[0]}」`,
  );
  if (theme !== 'light') errs.push(`照故事找世界:条件页不是浅色(${theme})`);
  if (!prog.includes('正在推第')) errs.push(`照故事找世界:搜的时候没有进度(${prog})`);
  if (!full) errs.push(`照故事找世界:海上强国搜 6 个一个全合都没有(${lead})`);
  if (!Number.isFinite(year)) errs.push(`照故事找世界:选中以后地图顶上那一条不对(${pill})`);
  if (!note.includes(`建好以后停在第 ${year} 年`) || btn !== `建好，停在第 ${year} 年` || !civSeed.includes('照故事找的')) errs.push(`照故事找世界:「用这个世界」以后第 2 步不对(${note} / ${btn} / ${civSeed})`);
  if (!side.includes('照故事找的') || !side.includes(`第 ${year} 年开场`)) errs.push(`照故事找世界:建好以后侧栏没有「照故事找的」一组(${side})`);
  if (!tl.includes(`第 ${year} 年`)) errs.push(`照故事找世界:建好以后时间轴没停在开场那年(${tl.split('\n')[0]})`);
}

// 大纲找更合的世界:存一个写了大纲的世界(种子 7,4 条:甲攻乙、甲迁都、某州立国、只讲故事;按这个种子的历史现写,见 smokeExamples.ts)→
// 概览「大纲」页右上「找更合的世界」→ 找世界那一页「‹ 大纲」、大纲里的两国列成故事里的国家(叫法是国名);「‹ 大纲」回原来那个世界的大纲 →
// 再点进来,选例子「海上强国」(套到甲上;乙没加条件,找的时候不管它)、搜 6 个 →「用这个世界」(第 2 步那句写大纲带过去)→ 建好以后
// 大纲还是 4 条:甲换成找到的那一国,乙、迁都的城、立国的州对不上,写原来的名字、标「要重新指」
if (part('大纲找更合的世界')) {
  const { findOutlineExample } = await import('./lib/smokeExamples');
  const { DEFAULT_PARAMS } = await import('../src/gen/world');
  const ex = findOutlineExample(7);
  if (!ex) errs.push('大纲找更合的世界:种子 7 里找不到两国接壤的例子');
  else {
    const id = 'woutlinefind01';
    const save = {
      app: '文明与地图',
      format: 1,
      generator: GENERATOR_VERSION,
      seed: 7,
      params: { ...DEFAULT_PARAMS, seed: 7 },
      edits: { names: {}, interventions: [], terrain: [], outline: { plots: ex.plots } },
      savedAt: '2026-10-26T12:00:00.000Z',
    };
    await page.goto(`${dev.url}/?play=0`);
    await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`wenming-ditu:world:${id}`, JSON.stringify(save)]);
    const openOutline = async () => {
      await page.goto(`${dev.url}/?w=${id}&play=0`);
      await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
      await openOverview(page, 'outline');
    };
    await openOutline();
    const rows0 = await page.locator('[data-testid=outline-table] tr.ol-tr').count();
    await page.click('[data-act=outline-find-world]');
    await page.locator('.fd-panel [data-page=conds]').waitFor({ timeout: 30000 });
    const back = await page.locator('.fd-panel [data-act=finder-exit]').innerText();
    const roles = await page.locator('.fd-panel [data-act=role-name]').allInnerTexts();
    const free = await page.locator('.fd-panel [data-testid=finder-role-empty]').count();
    // 「‹ 大纲」:回原来那个世界,概览开在「大纲」页
    await page.click('.fd-panel [data-act=finder-exit]');
    const backOk = await page
      .waitForFunction((w) => new URL(location.href).searchParams.get('w') === w && !!document.querySelector('.ov-root:not([hidden]) [data-act=outline-find-world]'), id, { timeout: 60000 })
      .then(() => true, () => false);
    await openOutline();
    await page.click('[data-act=outline-find-world]');
    await page.locator('.fd-panel [data-page=conds]').waitFor({ timeout: 30000 });
    await page.click('.fd-panel [data-preset=sea-power]');
    const roles2 = await page.locator('.fd-panel [data-act=role-name]').allInnerTexts();
    const count = page.locator('.fd-panel input[aria-label="搜几个世界"]');
    await count.fill('6');
    await count.blur();
    await page.click('.fd-panel [data-act=finder-start]');
    await page.waitForFunction(() => !document.querySelector('[data-testid=finder-progress]'), null, { timeout: 240000 }).catch(() => {});
    await page.waitForFunction(() => /种子 \d+，第 \d+ 年/.test(document.querySelector('[data-testid=finder-pill]')?.textContent ?? '') && !document.querySelector('[data-testid=finder-pill]')?.textContent?.includes('正在打开'), null, { timeout: 60000 }).catch(() => {});
    await page.locator('.fd-panel [data-act=finder-use]').first().click({ timeout: 10000 }).catch(() => {});
    const note = await page.locator('.studio [data-testid=found-note]').innerText({ timeout: 30000 }).catch(() => '');
    await createNow().catch(() => {});
    await page.locator('[data-testid=found-side]').waitFor({ timeout: 30000 }).catch(() => {});
    await openOverview(page, 'outline').catch(() => {});
    const lead = await page.locator('.ol-top .ol-lead').innerText().catch(() => '');
    const rows = page.locator('[data-testid=outline-table] tr.ol-tr');
    const n = await rows.count();
    const who1 = await rows.nth(0).locator('td.who').innerText().catch(() => '');
    const redoWho1 = await rows.nth(0).locator('td.who .ol-redo').innerText().catch(() => '');
    const tags = await page.locator('[data-testid=outline-table] .ol-st.redo').count();
    console.log(
      `大纲找更合的世界:大纲 ${rows0} 条 → 「‹ ${back.trim()}」、故事里的国家「${roles.join('、')}」(没条件的 ${free} 国);回原来的大纲 ${backOk};` +
        `套上海上强国「${roles2.join('、')}」→ 第 2 步「${note.replace(/\n/g, ' ').slice(0, 80)}」;建好以后大纲 ${n} 条,第 1 条谁「${who1.replace(/\n/g, ' ')}」,要重新指 ${tags} 条`,
    );
    if (rows0 !== 4 || back.trim() !== '大纲' || roles.length !== 2 || !ex.a.name.startsWith(roles[0]) || free !== 2) errs.push(`大纲找更合的世界:进来以后不是「‹ 大纲」、大纲里的两国没列成故事里的国家(${back} / ${roles.join('、')} / ${free})`);
    if (!backOk) errs.push('大纲找更合的世界:「‹ 大纲」没回到原来那个世界的大纲');
    if (roles2.join('、') !== roles.join('、')) errs.push(`大纲找更合的世界:套上例子以后叫法不是大纲里的国名了(${roles2.join('、')})`);
    if (!note.includes('大纲 4 条一起带过去')) errs.push(`大纲找更合的世界:第 2 步那句没写大纲带过去(${note})`);
    if (n !== 4 || !lead.includes('大纲从原来的世界搬过来了')) errs.push(`大纲找更合的世界:建好以后大纲没搬过来(${n} 条,${lead})`);
    if (who1.startsWith(ex.a.name) || redoWho1 !== ex.b.name) errs.push(`大纲找更合的世界:第 1 条的国家没换成找到的、或乙国没标要重新指(${who1} / ${redoWho1})`);
    if (tags !== 3) errs.push(`大纲找更合的世界:要重新指的应是 3 条(乙国、迁都的城、立国的州),现在 ${tags} 条`);
  }
}

// 大纲找更合的世界(手机,390×844 触屏):同一份大纲,整页大纲顶上「+」左边一个放大镜(读屏念"找更合的世界",和「+」隔 22 像素)→
// 整页的条件页:左上「‹ 大纲」、大纲里的两国列成故事里的国家 →「‹ 大纲」回原来那个世界的手机大纲页
if (part('大纲找更合的世界(手机)')) {
  const { findOutlineExample } = await import('./lib/smokeExamples');
  const { DEFAULT_PARAMS } = await import('../src/gen/world');
  const ex = findOutlineExample(7);
  if (!ex) errs.push('大纲找更合的世界(手机):种子 7 里找不到两国接壤的例子');
  else {
    const id = 'woutlinefind02';
    const save = {
      app: '文明与地图',
      format: 1,
      generator: GENERATOR_VERSION,
      seed: 7,
      params: { ...DEFAULT_PARAMS, seed: 7 },
      edits: { names: {}, interventions: [], terrain: [], outline: { plots: ex.plots } },
      savedAt: '2026-10-26T12:00:00.000Z',
    };
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const pp = await pctx.newPage();
    pp.on('pageerror', (e) => errs.push(`大纲找更合的世界(手机):${e.message}`));
    await pp.goto(`${dev.url}/?play=0`);
    await pp.evaluate(([k, v]) => localStorage.setItem(k, v), [`wenming-ditu:world:${id}`, JSON.stringify(save)]);
    await pp.goto(`${dev.url}/?w=${id}&play=0`);
    await pp.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
    await pp.tap('.psheet [data-act=overview]', { timeout: 5000 });
    await pp.locator('.ov-root:not([hidden]) .ov').waitFor({ timeout: 5000 });
    await pp.tap('.ov-tab[data-tab=outline]');
    const olp = pp.locator('[data-testid=outline-phone]');
    await olp.waitFor({ timeout: 5000 });
    const cards = await olp.locator('.ol-crow').count();
    const find = olp.locator('[data-act=outline-find-world]');
    const name = await find.getAttribute('aria-label').catch(() => null);
    const bFind = await find.boundingBox();
    const bAdd = await olp.locator('[data-act=outline-add]').boundingBox();
    const gap = bFind && bAdd ? Math.round(bAdd.x - (bFind.x + bFind.width)) : NaN;
    await find.tap();
    const fp = pp.locator('.fd-phone-page');
    await fp.waitFor({ timeout: 30000 });
    const back = await fp.locator('[data-act=finder-exit]').innerText();
    const roles = await fp.locator('[data-act=role-name]').allInnerTexts();
    // 「‹ 大纲」:回原来那个世界,还是整页的大纲
    await fp.locator('[data-act=finder-exit]').tap();
    const backOk = await pp
      .waitForFunction((w) => new URL(location.href).searchParams.get('w') === w && !!document.querySelector('[data-testid=outline-phone] [data-act=outline-find-world]'), id, { timeout: 60000 })
      .then(() => true, () => false);
    console.log(`大纲找更合的世界(手机):大纲 ${cards} 条,放大镜「${name}」和「+」隔 ${gap} 像素 → 「‹ ${back.trim()}」、故事里的国家「${roles.join('、')}」;回原来的大纲 ${backOk}`);
    if (cards !== 4 || name !== '找更合的世界') errs.push(`大纲找更合的世界(手机):大纲页顶上没有放大镜 / 读屏名字不对(${cards} 条,${name})`);
    if (!(Math.abs(gap - 22) <= 2)) errs.push(`大纲找更合的世界(手机):放大镜和「+」隔的不是 22 像素(${gap})`);
    if (back.trim() !== '大纲' || roles.length !== 2 || !ex.a.name.startsWith(roles[0])) errs.push(`大纲找更合的世界(手机):进来以后不是「‹ 大纲」、大纲里的两国没列成故事里的国家(${back} / ${roles.join('、')})`);
    if (!backOk) errs.push('大纲找更合的世界(手机):「‹ 大纲」没回到原来那个世界的大纲');
    await pctx.close();
  }
}

// 第一次来(什么都没存):先到「我的世界」,中间一颗星球、一段话、「新建世界」;点了先弹窗(第 1 步两种、默认随机生成,
// 第 2 步种子和参数、说进去还能改;Esc 关掉什么都不留下),「开始」才进新建界面;
// 「创建世界」先弹确认框(列出种子、世界参数、地形、地名风格四样不能再改),「再改改」关掉、「确认创建」才建好,回到平常的世界页面(浅色、政区)
if (part('第一次来')) {
  const fctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const fp = await fctx.newPage();
  fp.on('pageerror', (e) => errs.push(`第一次来:${e.message}`));
  await fp.goto(`${dev.url}/?play=0`);
  const empty = await fp.locator('.mw-empty').waitFor({ timeout: 15000 }).then(() => true, () => false);
  const emptyText = (await fp.locator('.mw-empty').innerText().catch(() => '')).replace(/\n/g, '');
  const globe = await fp.locator('.mw-empty .mw-globe canvas').count();
  await fp.click('.mw-empty [data-act=new-world]');
  const dlg1 = (await fp.locator('.nd-sheet').innerText({ timeout: 5000 }).catch(() => '')).replace(/\n/g, ' ');
  const dlgOn = await fp.locator('.nd-card.on').getAttribute('data-mode').catch(() => null);
  await fp.keyboard.press('Escape');
  const dlgGone = !(await fp.locator('.nd-scrim').count()) && !(await fp.locator('.studio').count()) && !/[?&]new=/.test(fp.url());
  await fp.click('.mw-empty [data-act=new-world]');
  await fp.click('.nd-scrim [data-act=dlg-next]');
  const dlg2 = (await fp.locator('.nd-sheet').innerText().catch(() => '')).replace(/\n/g, ' ');
  const dlgParams = await fp.locator('.nd-sheet [data-param]').count();
  const dlgFrontier = await fp.locator('.nd-sheet [data-group=frontier]').count();
  await fp.click('.nd-scrim [data-act=dlg-start]');
  await studioReady(fp);
  const draftUrl = fp.url();
  await toCivStep(fp);
  await fp.click('.studio [data-act=create-world]');
  const dlg = (await fp.locator('.st-dlg').innerText().catch(() => '')).replace(/\n/g, ' ');
  const dlgSeed = await fp.locator('.st-dlg [data-confirm=seed]').innerText().catch(() => '');
  await fp.click('.st-dlg [data-act=confirm-back]');
  const closed = !(await fp.locator('.st-dlg').count());
  const stillDraft = (await fp.locator('.studio').count()) === 1;
  await createNow(fp);
  await fp.locator('.sidebar .sb-title').waitFor({ timeout: 15000 }).catch(() => {});
  const worldUrl = fp.url();
  const theme = await fp.locator('.app').getAttribute('data-theme');
  const layer = await fp.locator('.app').getAttribute('data-layer');
  console.log(
    `第一次来:我的世界空的 ${empty}、星球 ${globe}、「${emptyText.slice(0, 40)}…」;新建弹窗「${dlg1.slice(0, 50)}…」默认 ${dlgOn}、Esc 关掉 ${dlgGone};` +
      `第 2 步「${dlg2.slice(0, 40)}…」参数 ${dlgParams} 项;开始 → ${draftUrl.split('?')[1]};` +
      `确认框「${dlg.slice(0, 60)}…」种子 ${dlgSeed};` +
      `再改改 → 关掉 ${closed}、还在新建 ${stillDraft};确认创建 → ${worldUrl.split('?')[1]}、${theme}、${layer}`,
  );
  if (!empty || !globe || !emptyText.includes('还没有世界') || !emptyText.includes('打造一颗独属于你的星球')) errs.push(`第一次来:我的世界空着时不是"星球 + 一段话 + 新建世界"(${emptyText})`);
  if (!emptyText.includes('无需登录') || !emptyText.includes('不主张任何权利')) errs.push(`第一次来:「或者打开存档文件」下面没有"无需登录……归你"那行小字(${emptyText})`);
  if (!/[?&]new=1/.test(draftUrl)) errs.push(`第一次来:新建弹窗里点「开始」没进新建(${draftUrl})`);
  if (!dlg1.includes('随机生成') || !dlg1.includes('照手绘图生成') || dlgOn !== 'random' || !dlgGone) errs.push(`新建弹窗:第 1 步没有两种(默认随机生成),或 Esc 没关掉(${dlg1},${dlgOn},${dlgGone})`);
  if (!dlg2.includes('种子') || !dlg2.includes('都还能改') || dlgParams !== 6 || dlgFrontier) errs.push(`新建弹窗:第 2 步没有种子、六项世界参数和"进去以后还能改",或还列着拓荒(随机生成先只定地图)(${dlg2},${dlgParams},${dlgFrontier})`);
  if (!['不能再改', '种子', '世界参数', '地形', '地名风格'].every((w) => dlg.includes(w)) || !new RegExp(`[?&]seed=${dlgSeed}(&|$)`).test(draftUrl)) errs.push(`新建界面:确认框没列出不能再改的四样(${dlg},种子 ${dlgSeed})`);
  if (!closed || !stillDraft) errs.push('新建界面:确认框点「再改改」没有关掉、回到新建');
  if (!/[?&]w=w/.test(worldUrl) || theme !== 'light' || layer !== 'political') errs.push(`新建界面:确认创建后没回到平常的世界页面(${worldUrl},${theme},${layer})`);
  await fctx.close();
}

// 照手绘图新建:弹窗里选「照手绘图生成」→ 第 2 步没有陆地比例,没选图时「开始」是灰的 → 选一张图 → 开始;
// 新建界面是照图的那一页(左边图片一行和三步,没有右边的样式投影、没有种子和「换一颗」),进来就是第 1 步认图、后两步灰着、创建不了;
// 在图上点一下海 →「照这样长出星球」→ 第 1 步打勾写着认出来多少、第 2 步(笔)展开、切换条上「长出来的」能点;
// 确认框里「种子」那行换成「图片」
if (part('照手绘图新建')) {
  const { PNG } = await import('pngjs');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  // 一张 240×120 的图:蓝色的海当中一块绿色的椭圆陆地
  const png = new PNG({ width: 240, height: 120 });
  for (let y = 0; y < 120; y++)
    for (let x = 0; x < 240; x++) {
      const i = (y * 240 + x) * 4;
      const land = ((x - 120) / 70) ** 2 + ((y - 60) / 32) ** 2 < 1;
      png.data[i] = land ? 110 : 50;
      png.data[i + 1] = land ? 190 : 110;
      png.data[i + 2] = land ? 90 : 210;
      png.data[i + 3] = 255;
    }
  const ictx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const ip = await ictx.newPage();
  ip.on('pageerror', (e) => errs.push(`照手绘图新建:${e.message}`));
  await ip.goto(`${dev.url}/?play=0`);
  await ip.locator('.mw-empty').waitFor({ timeout: 15000 });
  await ip.click('.mw-empty [data-act=new-world]');
  await ip.click('.nd-card[data-mode=image]');
  await ip.click('.nd-scrim [data-act=dlg-next]');
  const noLand = !(await ip.locator('.nd-sheet [data-param=landFraction]').count()) && (await ip.locator('.nd-sheet [data-param=plates]').count()) === 1;
  const startOff = await ip.locator('.nd-scrim [data-act=dlg-start]').isDisabled();
  await ip.setInputFiles('.nd-sheet input[type=file]', { name: '照图测试.png', mimeType: 'image/png', buffer: PNG.sync.write(png) });
  const picked = (await ip.locator('.nd-picked').innerText({ timeout: 5000 }).catch(() => '')).replace(/\n/g, ' ');
  await ip.click('.nd-scrim [data-act=dlg-start]');
  await studioReady(ip);
  const heading = await ip.locator('.st-left .nw-title').innerText().catch(() => '');
  const noRight = !(await ip.locator('.st-right').count()) && !(await ip.locator('.st-left .nw-seed').count());
  const step1 = await ip.locator('.sk-group[data-step="1"] .sk-body .imp-step').count();
  const locked = await ip.locator('.sk-group[data-step="2"] .sk-head').isDisabled();
  const createOff = await ip.locator('.studio [data-act=create-world]').isDisabled();
  await ip.locator('.app.studio-flat').waitFor({ timeout: 10000 }).catch(() => {});
  await ip.waitForTimeout(500);
  const st = await ip.locator('main.stage').boundingBox();
  if (st) await ip.mouse.click(st.x + st.width * 0.05, st.y + st.height * 0.1);
  await ip.waitForTimeout(300);
  const clicks = await ip.locator('.sk-group[data-step="1"] .tp-n').innerText().catch(() => '');
  await ip.evaluate(() => ((window as any).__wf.mark = 1));
  await ip.click('.studio [data-act=import-use]').catch(() => {});
  await ip.waitForFunction(() => !(window as any).__wf?.mark, null, { timeout: 30000 }).catch(() => {});
  const step1Done = await ip.locator('.sk-group[data-step="1"] .sk-no.ok').count();
  const sum1 = await ip.locator('.sk-group[data-step="1"] .sk-s').innerText().catch(() => '');
  const step2Open = await ip.locator('.sk-group[data-step="2"] .sk-body .tp-step').count();
  // 第 2 步和随机生成一样分四页、放一处有删河湖、有程序补全
  const step2Pages = await ip.locator('.sk-group[data-step="2"] [data-act=terrain-page] [role=tab]').count();
  const step2Extra = (await ip.locator('.sk-group[data-step="2"] [data-tool=delWater]').count()) + (await ip.locator('.sk-group[data-step="2"] [data-act=terrain-fill]').count());
  const grownOk = !(await ip.locator('.sk-vbar [data-v=grown]').isDisabled().catch(() => true));
  await ip.waitForFunction(() => !document.querySelector('.studio [data-act=create-world]')?.hasAttribute('disabled'), null, { timeout: 30000 }).catch(() => {});
  await ip.click('.studio [data-act=create-world]').catch(() => {});
  const dlgImage = await ip.locator('.st-dlg [data-confirm=image]').innerText({ timeout: 3000 }).catch(() => '');
  const dlgSeed = await ip.locator('.st-dlg [data-confirm=seed]').count();
  await ip.click('.st-dlg [data-act=confirm-back]').catch(() => {});
  console.log(
    `照手绘图新建:弹窗第 2 步没有陆地比例 ${noLand}、没选图时开始是灰的 ${startOff}、选好「${picked}」;进来「${heading}」、没有右边和种子 ${noRight}、` +
      `第 1 步认图 ${step1}、后两步灰着 ${locked}、创建不了 ${createOff};点一下海 →「${clicks}」;长出星球 → 第 1 步打勾 ${step1Done}「${sum1}」、` +
      `第 2 步展开 ${step2Open}、长出来的能点 ${grownOk};确认框图片「${dlgImage}」、种子那行 ${dlgSeed}`,
  );
  if (!noLand || !startOff || !picked.includes('照图测试.png')) errs.push(`照手绘图新建:弹窗第 2 步应没有陆地比例、没选图时「开始」是灰的、选好图写着文件名(${noLand},${startOff},${picked})`);
  if (heading !== '照手绘图新建' || !noRight || !step1 || !locked || !createOff) errs.push(`照手绘图新建:进来应是照图那一页的第 1 步(${heading},${noRight},${step1},${locked},${createOff})`);
  if (step2Pages !== 4 || step2Extra !== 2) errs.push(`照手绘图新建:第 2 步应有四页、删河湖和程序补全(${step2Pages},${step2Extra})`);
  if (!clicks.includes('点了 1 处')) errs.push(`照手绘图新建:在图上点一下海没记上(${clicks})`);
  if (!step1Done || !/陆地 \d+%/.test(sum1) || !step2Open || !grownOk) errs.push(`照手绘图新建:「照这样长出星球」以后第 1 步应打勾、第 2 步展开(${step1Done},${sum1},${step2Open},${grownOk})`);
  if (dlgImage !== '照图测试.png' || dlgSeed) errs.push(`照手绘图新建:确认框里应是「图片」那一行(${dlgImage},${dlgSeed})`);
  await ictx.close();
}

// 手机新建:第一眼星球整个在底部卡片上面(不是只露一角);创建以后正中看到的是陆地(展开的同时转到陆地最多的那一面)
if (part('手机新建')) {
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pp = await pctx.newPage();
  pp.on('pageerror', (e) => errs.push(`手机新建:${e.message}`));
  await pp.goto(`${dev.url}/?new=1&seed=7&play=0`);
  await studioReady(pp);
  const g = await pp.locator('.st-glow').boundingBox();
  const sheet = await pp.locator('.st-sheet').boundingBox();
  // 光晕的直径 = 星球直径 × 2.4
  const R = g ? g.width / 2.4 : 0;
  const gcx = g ? g.x + g.width / 2 : 0;
  const gcy = g ? g.y + g.height / 2 : 0;
  await createNow(pp);
  await pp.waitForTimeout(500);
  const land = await pp.evaluate(() => {
    let n = 0;
    let hit = 0;
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 5; j++) {
        const r = ((window as any).__wfProbe?.(40 + i * 77, 120 + j * 110) ?? []).join(' ');
        n++;
        if (r.includes('海拔')) hit++;
      }
    return hit / n;
  });
  console.log(`手机新建:星球 ${Math.round(gcx)},${Math.round(gcy)} 半径 ${Math.round(R)},底部卡片上边 ${sheet ? Math.round(sheet.y) : '-'};创建后屏幕上取样陆地 ${(land * 100).toFixed(0)}%`);
  if (!g || !sheet || gcy + R > sheet.y + 1 || gcy - R < 0 || Math.abs(gcx - 195) > 2 || R < 120) errs.push(`手机新建:星球没有整个摆在底部卡片上面(中心 ${gcx},${gcy} 半径 ${R},卡片 ${sheet?.y})`);
  if (!(land >= 0.3)) errs.push(`手机新建:创建以后正中对着的大半是海(陆地 ${(land * 100).toFixed(0)}%)`);
  await pctx.close();
}

// 新建时让助手改(测试用假 AI):左边「地形」里「让助手改」→ 右边的样式和投影换成助手面板;说一句要改的 →
// 列出改地形的两条(带编号),星球转过去、圈出这两处;勾掉一条,圈跟着少一个;执行 → 按新地形重新生成,左边「地形」写"画了 2 笔",
// 不放提示条,清单收起、助手里只留一行"已执行 2 条"带撤销;撤销 → 回到"还没改"。打开编辑地形时助手收起;换一颗,对话清掉
if (part('新建时让助手改')) {
  const actx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const ap = await actx.newPage();
  ap.on('pageerror', (e) => errs.push(`新建时让助手改:${e.message}`));
  const row = () => ap.locator('.studio [data-act=terrain] .sb-row-side').innerText().catch(() => '');
  await ap.goto(`${dev.url}/?new=1&seed=7&play=0&ai=mock`);
  await studioReady(ap);
  await ap.click('.studio [data-act=ask-assistant]');
  const shown = await ap.locator('.studio > .ast-panel').waitFor({ timeout: 5000 }).then(() => true, () => false);
  await ap.waitForTimeout(500);
  const panel = await ap.locator('.studio > .ast-panel').boundingBox();
  const rightGone = await ap.evaluate(() => (document.querySelector('.st-right')?.getBoundingClientRect().left ?? 0) >= innerWidth - 1);
  const hint = await ap.locator('.ast-hint').innerText().catch(() => '');
  await ap.fill('.ast-field textarea', '在最大的那块陆地中间挖个大湖，湖北边再加一道山脉');
  await ap.press('.ast-field textarea', 'Enter');
  await ap.waitForSelector('[data-act=ast-apply]', { timeout: 30000 }).catch(() => null);
  const nos = (await ap.locator('.ast-items .ast-no').allInnerTexts().catch(() => [] as string[])) as string[];
  const marksAt = (n: string) =>
    ap
      .waitForFunction((v) => document.querySelector('.st-marks.on')?.getAttribute('data-marks') === v, n, { timeout: 8000 })
      .then(() => true, () => false);
  const marks2 = await marksAt('2');
  await ap.click('.ast-items .ast-ck >> nth=1');
  const marks1 = await marksAt('1');
  await ap.click('.ast-items .ast-ck >> nth=1');
  await ap.click('[data-act=ast-apply]');
  await ap.waitForFunction(() => /画了 2 笔/.test(document.querySelector('.studio [data-act=terrain] .sb-row-side')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
  await ap.waitForFunction(() => !document.querySelector('.toast[data-toast=progress]'), null, { timeout: 30000 }).catch(() => {});
  await ap.waitForTimeout(600);
  const row2 = await row();
  const applied = (await ap.locator('.ast-applied').innerText().catch(() => '')).replace(/\n/g, ' ');
  const toast = await ap.locator('.toast[data-toast=terrain]').count();
  const marksGone = !(await ap.locator('.st-marks.on').count());
  const listGone = !(await ap.locator('.ast-items').count());
  await ap.click('.ast-applied [data-act=ast-undo]').catch(() => {});
  await ap.waitForFunction(() => /还没改/.test(document.querySelector('.studio [data-act=terrain] .sb-row-side')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});
  const row0 = await row();
  await ap.waitForFunction(() => !document.querySelector('.toast[data-toast=progress]'), null, { timeout: 30000 }).catch(() => {});
  await ap.click('.studio [data-act=terrain]');
  await ap.locator('.tp').waitFor({ timeout: 5000 }).catch(() => {});
  const closedByTool = !(await ap.locator('.ast-panel').count());
  await ap.click('.tp [data-act=terrain-done]');
  await ap.waitForTimeout(1200);
  await ap.click('.studio [data-act=ask-assistant]');
  const turns = await ap.locator('.ast-turn').count();
  await ap.click('.studio [data-act=new-seed]');
  await ap.waitForFunction(() => !document.querySelector('.ast-turn'), null, { timeout: 10000 }).catch(() => {});
  const turnsAfter = await ap.locator('.ast-turn').count();
  console.log(
    `新建时让助手改:面板 ${shown}(左边 ${panel ? Math.round(panel.x) : '-'}、宽 ${panel ? Math.round(panel.width) : '-'}),右边样式投影让开 ${rightGone};「${hint.slice(0, 16)}…」;` +
      `编号 ${nos.join(',')},星球上圈 ${marks2 ? 2 : '?'} → 勾掉一条 ${marks1 ? 1 : '?'};执行 → 左边「${row2}」、「${applied}」、清单收起 ${listGone}、提示条 ${toast}、圈没了 ${marksGone};` +
      `撤销 → 「${row0}」;开编辑地形助手收起 ${closedByTool};换一颗对话 ${turns} → ${turnsAfter} 轮`,
  );
  if (!shown || !panel || Math.abs(panel.x + panel.width - 1600) > 1 || Math.abs(panel.width - 372) > 1 || !rightGone)
    errs.push(`新建时让助手改:助手面板没有换掉右边的样式和投影(${shown},${JSON.stringify(panel)},${rightGone})`);
  if (!hint.includes('圈出')) errs.push(`新建时让助手改:空的时候的说明不对(${hint})`);
  if (nos.join(',') !== '1,2' || !marks2 || !marks1) errs.push(`新建时让助手改:确认单没编号,或星球上没圈出要改的地方 / 勾掉一条圈没跟着少(${nos},${marks2},${marks1})`);
  if (row2 !== '画了 2 笔' || !applied.includes('已执行 2 条') || !listGone || toast || !marksGone)
    errs.push(`新建时让助手改:执行后左边没写"画了 2 笔" / 助手里没写已执行 / 清单没收起 / 放了提示条(${row2},${applied},${listGone},${toast},${marksGone})`);
  if (row0 !== '还没改') errs.push(`新建时让助手改:撤销以后地形没回去(${row0})`);
  if (!closedByTool) errs.push('新建时让助手改:打开编辑地形时助手没收起');
  if (!turns || turnsAfter) errs.push(`新建时让助手改:换一颗以后对话没清掉(${turns} → ${turnsAfter})`);
  await actx.close();
}

// 打开"民族"视图:悬停在有人住的地方要显示"XX族"
if (part('民族和国家视图')) {
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=cultures`);
  await page.waitForFunction(() => (window as any).__wfCiv?.ready, null, { timeout: 60000 });
  const box = (await page.locator('.map-box canvas').first().boundingBox())!;
  let people = '';
  for (let i = 0; i < 40 && !people; i++) {
    await page.mouse.move(box.x + box.width * (0.1 + 0.8 * ((i * 0.618) % 1)), box.y + box.height * (0.2 + 0.6 * ((i * 0.382) % 1)));
    await page.waitForTimeout(40);
    const t = await hoverText(page, '.hover');
    if (t.includes('族')) people = t;
  }
  console.log('民族视图悬停:', people.replace(/\n/g, ' / ') || '(没找到有人住的地方)');
  if (!people) errs.push('民族视图下悬停没有显示"XX族"');
  if (!(await page.locator('.civ-timeline').isVisible())) errs.push('打开"民族"后没有时间轴');

  // 打开"国家"视图:首次绘制文明层(底图 + 国名、城名、城镇符号的文字层;预算 150 ms,只记数);概览的国家页列出这一年的国家;
  // 悬停显示"某国 · 最近城市 某城";从第 1500 年按 4× 接着放,国家、城市随年份变化时每帧(底图 + 文字层;预算 30 ms,只记数)。
  // CI 的虚拟机比一般电脑慢两三倍(同一段回放每帧耗时约是本机的 2.5 倍),首次绘制的预算在 CI 上放宽到 2 倍
  const DRAW_BUDGET = process.env.CI ? 300 : 150;
  for (const style of ['realistic', 'fantasy']) {
    await page.goto(`${dev.url}/?seed=7&style=${style}&civ=polities,routes&civYear=1500`);
    await page.waitForFunction(() => (window as any).__wfCiv?.ready, null, { timeout: 60000 });
    // 文字层等字体加载好才画;画出国名、城镇符号才算画完
    await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 30000 }).catch(() => {});
    const civMs = await page.evaluate(() => (window as any).__wfCiv.ms as number);
    const lab = await page.evaluate(() => (window as any).__wfLabels);
    const first = civMs + (lab?.ms ?? NaN);
    await openOverview(page, 'countries');
    const nations = await page.locator('.ov-countries .ov-row:not(.dead)').count();
    await closeOverview();
    console.log(
      `国家视图(${style}):首次绘制 ${first.toFixed(1)} ms(底图 ${civMs.toFixed(1)} + 文字层 ${(lab?.ms ?? NaN).toFixed(1)}),` +
        `国名 ${lab?.polities} 个、城镇符号 ${lab?.marks} 个、文字 ${lab?.drawn} 条,图例 ${nations} 行`,
    );
    timing(`国家视图首次绘制(${style})`, first, DRAW_BUDGET);
    if (!(lab?.polities > 0) || !(lab?.marks > 0)) errs.push('国家视图没有画出国名 / 城镇符号');
    if (nations < 2) errs.push('国家视图的图例没有列出国家');
    if (style === 'realistic') {
      let found = '';
      let card = '';
      // 先在国名上悬停(国名写在国土上),再在地图上撒点找
      const spots = ((await page.evaluate('window.__wfPickables()')) as { kind: string; x: number; y: number }[]).filter((p) => p.kind === 'polity');
      for (let i = 0; i < spots.length + 200 && !found; i++) {
        if (i < spots.length) await page.mouse.move(spots[i].x, spots[i].y);
        else await page.mouse.move(box.x + box.width * (0.05 + 0.9 * ((i * 0.618) % 1)), box.y + box.height * (0.1 + 0.8 * ((i * 0.382) % 1)));
        await page.waitForTimeout(30);
        const x = i < spots.length ? spots[i].x : box.x + box.width * (0.05 + 0.9 * ((i * 0.618) % 1));
        const y = i < spots.length ? spots[i].y : box.y + box.height * (0.1 + 0.8 * ((i * 0.382) % 1));
        const t = (await probe(page, x, y)).replace(/ \/ /g, '\n');
        // 国名可能是"索拉特王国",也可能是东方的"大昌"、"景辰王朝":只要"某国 · 最近城市",不是部落地带
        if (/^(?!部落地带).+ · 最近城市/m.test(t)) {
          found = t;
          // 悬停小卡片:国名 + 州数
          card = (await page.locator('.hover-card').innerText().catch(() => '')).replace(/\n/g, ' ');
        }
      }
      console.log('国家视图读数:', found.replace(/\n/g, ' / ') || '(没找到国内的地方)', `;悬停卡片「${card}」`);
      if (!found) errs.push('国家视图下读数里没有"某国 · 最近城市"');
      else if (!/\d+ 州/.test(card)) errs.push(`国家视图下悬停卡片没有"国名 N 州"(${card})`);
    }
    await page.mouse.move(5, 5);
    await page.click('.timebar .tb-speed button:has-text("4×")');
    await page.click('.timebar button.tb-play');
    const frames = await page.evaluate(async () => {
      const w = window as any;
      const ms: number[] = [];
      const years: number[] = [];
      const text: number[] = [];
      let last: unknown = null;
      const t0 = performance.now();
      while (performance.now() - t0 < 2500) {
        await new Promise((r) => requestAnimationFrame(r));
        const c = w.__wfCiv;
        if (c && c !== last && c.fast) {
          // 这一帧的文字层(国名、城镇符号随年份重画):同一年画的那次
          const l = w.__wfLabels;
          const lm = l && l.fast && Math.abs(l.year - c.year) < 1e-6 ? l.ms : 0;
          ms.push(c.ms + lm);
          text.push(lm);
          years.push(c.year);
        }
        last = c;
      }
      return { ms, years, text };
    });
    const fs = [...frames.ms].sort((a, b) => a - b);
    const med = fs[fs.length >> 1] ?? NaN;
    const ts = [...frames.text].sort((a, b) => a - b);
    console.log(
      `国家视图回放(${style}):${fs.length} 帧,第 ${Math.round(frames.years[0] ?? NaN)} → ${Math.round(frames.years.at(-1) ?? NaN)} 年,` +
        `每帧(底图 + 文字层)中位数 ${med.toFixed(1)} ms、最慢 ${(fs.at(-1) ?? NaN).toFixed(1)} ms;其中文字层中位数 ${(ts[ts.length >> 1] ?? NaN).toFixed(1)} ms`,
    );
    if (fs.length < 5) errs.push('国家视图点播放后没有接着放');
    timing(`国家视图回放每帧(${style},中位数)`, med, REPLAY_BUDGET);
  }
}

// 时间轴:打开网页从第 2600 年起按 1× 自动播放(无头浏览器里默认不播,网址加 play=1);经过大事时事发地出标签、
// 左下出最近事件;4× 快四倍;放到第 3000 年停下,再点播放从 2600 年重播;点最近事件跳到那一年、地图高亮事发地;点国家暂停
if (part('时间轴')) {
  const tlState = () =>
    page.evaluate(() => ({
      year: Number(document.querySelector('.timebar .tb-year')?.textContent?.match(/\d+/)?.[0] ?? NaN),
      playing: !!document.querySelector('.timebar .tb-play.on'),
    }));
  const visiblePin = (timeout: number) =>
    page
      .waitForFunction(() => [...document.querySelectorAll('.ev-pin')].find((e) => (e as HTMLElement).style.visibility === 'visible')?.textContent ?? '', null, { timeout })
      .then((h) => h.jsonValue() as Promise<string>, () => '');
  // 宽屏左边被侧栏卡片挡住一截,只露出大半个世界:先算出 2640 年以后第一件大事的事发地,打开后把地图挪过去(播放经过它时标签才在地图里)
  const { DEFAULT_PARAMS: DP, generateWorld: genW } = await import('../src/gen/world');
  const { generateCiv: genC } = await import('../src/gen/civ');
  const { buildChronicle: buildC, filterChronicle: filterC } = await import('../src/gen/civ/story/chronicle');
  const { entryAnchor } = await import('../src/ui/timelineLayout');
  const wT = genW({ ...DP, seed: 7 });
  const cT = genC(wT);
  const evNext = filterC(buildC(cT), { major: true }).find((e) => e.year >= 2640 && entryAnchor(wT, cT, e));
  const evAt = evNext ? entryAnchor(wT, cT, evNext) : null;
  await page.goto(`${dev.url}/?seed=7&style=fantasy&play=1`);
  await page.waitForFunction(() => (window as any).__wfCiv?.ready, null, { timeout: 60000 });
  const s0 = await tlState();
  if (evAt) await centerOn(page, evAt[0], evAt[1]);
  const pin = await visiblePin(15000);
  const recent = await page.locator('.sidebar .sb-row.ev').count();
  const a = await tlState();
  await page.waitForTimeout(1000);
  const b = await tlState();
  await page.click('.timebar .tb-speed button:has-text("4×")');
  const c = await tlState();
  await page.waitForTimeout(1000);
  const d = await tlState();
  const stopped = await page
    .waitForFunction(() => !document.querySelector('.timebar .tb-play.on') && document.querySelector('.timebar .tb-year')?.textContent === '第 3000 年', null, { timeout: 20000 })
    .then(() => true, () => false);
  await page.click('.timebar button.tb-play');
  await page.waitForTimeout(150);
  const again = await tlState();
  // 点侧栏"最近大事"的第二条(新的在上)
  // 还在放:列表随时会多出一条、往下挤,读年份和点击放在同一刻做(分两步的话中间可能换了一行)
  const h0 = await page.evaluate(() => (window as any).__wfHighlight?.stamp ?? 0);
  const rowYear = await page.evaluate(() => {
    const rows = document.querySelectorAll<HTMLElement>('.sidebar .sb-row.ev');
    const row = rows[Math.min(1, rows.length - 1)];
    if (!row) return 0;
    const y = Number(row.querySelector('.sb-year')?.textContent?.trim());
    row.click();
    return y;
  });
  await page.waitForFunction((s) => (window as any).__wfHighlight?.stamp > s, h0, { timeout: 5000 }).catch(() => {});
  const jumped = await tlState();
  const lit = await page.evaluate(() => (window as any).__wfHighlight?.lit ?? 0);
  const jumpPin = await visiblePin(3000);
  // 接着放,再点一个国家:暂停
  await page.click('.timebar button.tb-play');
  await page.waitForTimeout(300);
  const before = await tlState();
  // 点一个在看得见的地方的国名(地图左右相连,名单里的国名也可能在屏幕外、侧栏底下或时间轴上,点了碰不到它)
  const tvp = page.viewportSize()!;
  const spots = ((await page.evaluate('window.__wfPickables()')) as { kind: string; x: number; y: number }[]).filter(
    (p) => p.kind === 'polity' && p.x > SIDE_ROOM + 60 && p.x < tvp.width - 80 && p.y > 120 && p.y < tvp.height - 140,
  );
  if (spots.length) await page.mouse.click(spots[0].x, spots[0].y);
  await page.waitForTimeout(300);
  const paused = await tlState();
  await page.keyboard.press('Escape');
  const rate1 = b.year - a.year;
  const rate4 = d.year - c.year;
  console.log(
    `时间轴:打开 → 第 ${s0.year} 年${s0.playing ? '(在放)' : '(停着)'};标签「${pin.slice(0, 40)}」;最近事件 ${recent} 条;` +
      `1× 每秒 ${rate1} 年、4× 每秒 ${rate4} 年;放到头停下 ${stopped},再点播放 → 第 ${again.year} 年;` +
      `点最近事件第 ${rowYear} 年 → 时间轴第 ${jumped.year} 年${jumped.playing ? '(在放)' : '(停着)'},高亮 ${lit} 州,标签「${jumpPin.slice(0, 30)}」;` +
      `播放中点国家 → ${before.playing && !paused.playing ? '暂停' : '没暂停'}`,
  );
  if (!s0.playing || !(s0.year >= 2600 && s0.year <= 2660)) errs.push(`时间轴:打开网页没有从第 2600 年起自动播放(第 ${s0.year} 年${s0.playing ? '' : ',没在放'})`);
  if (!pin) errs.push('时间轴:播放经过大事时地图上没有出事件标签');
  if (!(recent >= 1 && recent <= 3)) errs.push(`时间轴:侧栏的最近大事应有 1–3 条(${recent})`);
  if (!(rate1 >= 12 && rate1 <= 30)) errs.push(`时间轴:1× 应每秒约 20 年(${rate1})`);
  if (!(rate4 >= 50 && rate4 <= 110)) errs.push(`时间轴:4× 应每秒约 80 年(${rate4})`);
  if (!stopped) errs.push('时间轴:放到第 3000 年没有停下');
  if (!again.playing || !(again.year >= 2600 && again.year <= 2640)) errs.push(`时间轴:放完再点播放没有从第 2600 年重播(第 ${again.year} 年)`);
  if (!rowYear || jumped.year !== rowYear || jumped.playing) errs.push(`时间轴:点最近事件没有跳到那一年并暂停(第 ${rowYear} 年 → 第 ${jumped.year} 年)`);
  if (!(lit > 0)) errs.push('时间轴:点最近事件后地图上没有高亮事发地');
  if (!jumpPin) errs.push('时间轴:点最近事件后事发地没有标签');
  if (!spots.length || !before.playing || paused.playing) errs.push('时间轴:播放中点国家没有暂停');
  // 无头浏览器里默认不自动播放(截图固定),网址给了 civYear 也不播
  await page.goto(`${dev.url}/?seed=7&style=fantasy`);
  await page.waitForFunction(() => (window as any).__wfCiv?.ready || (window as any).__wfLabels?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const still = await tlState();
  if (still.playing) errs.push('时间轴:无头浏览器里不该自动播放');
}

// 编年史(阶段 3):世界概览的编年史页点一条:时间轴跳到那一年并暂停,地图上高亮事发地,还没发生的淡显
if (part('编年史')) {
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
  await page.waitForFunction(() => (window as any).__wfCiv?.ready, null, { timeout: 60000 });
  // 时间轴上的大事菱形:有菱形、每 100 年一格刻度;悬停出提示;点一个 → 时间轴跳到那一年、地图上高亮(和点编年史的一条一样)
  {
    const nDots = await page.locator('.timebar .tb-mark').count();
    const nTicks = await page.locator('.timebar .tb-tick').count();
    const single = page.locator('.timebar .tb-mark[data-n="1"]');
    const ns = await single.count();
    const dot = single.nth(Math.floor(ns / 2));
    const want = ns ? await dot.getAttribute('data-year') : null;
    const b = ns ? await dot.boundingBox() : null;
    let tip = '';
    let tl = '';
    let lit = 0;
    if (b) {
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      tip = await page
        .locator('.tb-tip')
        .innerText({ timeout: 3000 })
        .catch(() => '');
      const s0 = await page.evaluate(() => (window as any).__wfHighlight?.stamp ?? 0);
      await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      await page.waitForFunction((s) => (window as any).__wfHighlight?.stamp > s, s0, { timeout: 5000 }).catch(() => {});
      tl = await page.locator('.timebar .tb-year').innerText();
      lit = await page.evaluate(() => (window as any).__wfHighlight?.lit ?? 0);
    }
    console.log(`时间轴刻度:菱形 ${nDots}、百年刻度 ${nTicks};悬停「${tip.replace(/\n/g, ' ')}」;点第 ${want} 年的菱形 → 时间轴 ${tl},高亮 ${lit} 州`);
    if (nDots < 5) errs.push(`时间轴上没有大事菱形(${nDots})`);
    if (nTicks !== 31) errs.push(`时间轴的百年刻度不对(${nTicks} 格,应为 31)`);
    if (!/\d+ 年/.test(tip)) errs.push('悬停在刻度上没有出提示');
    if (!want || tl !== `第 ${want} 年`) errs.push(`点时间轴上的刻度后年份没有跟着变(刻度 ${want},时间轴 ${tl})`);
    if (!(lit > 0)) errs.push('点时间轴上的刻度后地图上没有高亮');
    await page.mouse.move(5, 5);
  }
  // 时间轴上没有"编年史"按钮(编年史在世界概览里);概览的编年史页(新的在上)点一条:概览收起,时间轴跳到那一年、地图高亮
  if (await page.locator('.timebar button:has-text("编年史")').count()) errs.push('时间轴上还有"编年史"按钮');
  await openOverview(page, 'chronicle');
  const opened = await page
    .waitForSelector('.ov .chronicle .chron-row', { timeout: 10000 })
    .then(() => true, () => false);
  const rows = page.locator('.chron-list > .chron-item > .chron-row');
  const n = await rows.count();
  const row = rows.nth(Math.min(Math.floor(n * 0.7), Math.max(0, n - 1)));
  const label = opened ? await row.innerText() : '';
  // 年份从行上的 data-y 取(年份后面可能跟着月份,行里的字连起来是"163811 月")
  const y = opened ? Number(await row.getAttribute('data-y')) : NaN;
  const want = Number.isFinite(y) ? String(Math.floor(y)) : undefined;
  if (opened) await row.click();
  await page.waitForFunction(() => (window as any).__wfHighlight?.stamp > 0, null, { timeout: 5000 }).catch(() => {});
  const chronClosed = !(await page.locator('.ov-root:not([hidden])').count());
  const tl = await page.locator('.timebar .tb-year').innerText().catch(() => '');
  const hl = await page.evaluate(() => (window as any).__wfHighlight);
  // 再打开编年史页:那一年之后的事淡显
  await openOverview(page, 'chronicle');
  const future = await page.locator('.chron-row[data-st=future]').count();
  await closeOverview();
  console.log(
    `编年史:${n} 条;点「${label.replace(/\n/g, ' ')}」→ 概览收起 ${chronClosed}、时间轴 ${tl},高亮 ${hl?.lit} 州(${hl?.ms?.toFixed(1)} ms),淡显 ${future} 条`,
  );
  if (!opened || n < 3) errs.push('编年史页没有打开 / 没有列出纪事');
  if (!chronClosed) errs.push('点编年史的一条后概览没有收起');
  if (!want || tl !== `第 ${want} 年`) errs.push(`点编年史的一条后时间轴没有跳到那一年(条目 ${want},时间轴 ${tl})`);
  if (!(hl?.lit > 0)) errs.push('点编年史的一条后地图上没有高亮');
  if (!(future > 0)) errs.push('编年史里还没发生的事没有淡显');

  // 只看一国(下拉框里第一个 = 最大的国):"全部"里按年份插进它的君主继位;"大事"、看全部国家时没有
  {
    await openOverview(page, 'chronicle');
    const box = page.locator('.ov-root:not([hidden]) .chronicle');
    const sel = box.locator('[data-act=chron-polity]');
    const seg = box.locator('.chron-filters .seg button');
    const reigns = () => box.locator('.chron-list > .chron-item > .chron-row .chron-type', { hasText: /^继位$/ }).count();
    const first = await sel.evaluate((el: HTMLSelectElement) => el.options[1]?.value ?? '').catch(() => '');
    let counts = [-1, -1, -1, -1];
    if (first) {
      await seg.nth(1).click();
      const everyAll = await reigns();
      await seg.nth(0).click();
      const everyMajor = await reigns();
      await sel.selectOption(first);
      const oneMajor = await reigns();
      await seg.nth(1).click();
      const oneAll = await reigns();
      counts = [everyAll, everyMajor, oneMajor, oneAll];
      // 回到默认:全部国家、大事
      await seg.nth(0).click();
      await sel.selectOption('');
    }
    await closeOverview();
    console.log(`编年史的君主继位:全部国家 全部 ${counts[0]} / 大事 ${counts[1]} 条;只看一国 大事 ${counts[2]} / 全部 ${counts[3]} 条`);
    if (!(counts[3] > 0)) errs.push('编年史只看一国时"全部"里没有君主继位');
    if (counts[0] || counts[1] || counts[2]) errs.push(`编年史看全部国家、看"大事"时不该列君主继位(${counts.join(' / ')})`);
  }

  // 导出(阶段 4):顶栏"导出 → 地图图片",接住下载的 PNG:尺寸对、不是空白、文件名带种子和时间轴当前的年份;
  // 再导一张 16 位高度图:位深、尺寸对,海平面灰度和提示里写的一致
  {
    const year = (await page.locator('.timebar .tb-year').innerText().catch(() => '')).match(/\d+/)?.[0];
    const grab = async (job: string) => {
      await closeOverview();
      await page.click('.export-btn');
      await page.click('.export-scale button:nth-child(1)');
      const [dl] = await Promise.all([
        page.waitForEvent('download', { timeout: 60000 }),
        page.click(`.export-item[data-job=${job}]`),
      ]);
      const file = await dl.path();
      const buf = file ? (await import('node:fs')).readFileSync(file) : Buffer.alloc(0);
      return { name: dl.suggestedFilename(), buf, dbg: await page.evaluate(() => (window as any).__wfExport) };
    };
    const { PNG } = await import('pngjs');
    try {
      const map = await grab('map');
      const png = PNG.sync.read(map.buf);
      // 不是空白:抽样看亮度的起伏,且没有透明像素
      let sum = 0;
      let sum2 = 0;
      let n = 0;
      let clear = 0;
      for (let i = 0; i < png.data.length; i += 4 * 97) {
        const l = png.data[i] * 0.3 + png.data[i + 1] * 0.59 + png.data[i + 2] * 0.11;
        sum += l;
        sum2 += l * l;
        n++;
        if (png.data[i + 3] < 255) clear++;
      }
      const sd = Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2));
      console.log(
        `导出地图图片:${map.name},${png.width}×${png.height},${(map.buf.length / 1e6).toFixed(1)} MB,亮度标准差 ${sd.toFixed(1)},` +
          `文字 ${map.dbg?.detail?.labelCount} 条,用时 ${map.dbg?.ms?.toFixed(0)} ms`,
      );
      if (png.width !== 2048 || png.height !== 1024) errs.push(`导出的地图图片尺寸不对(${png.width}×${png.height})`);
      if (!(sd > 10) || clear > 0) errs.push(`导出的地图图片像是空白的(亮度标准差 ${sd.toFixed(1)},透明像素 ${clear})`);
      if (!(map.dbg?.detail?.labelCount > 5)) errs.push('导出的地图图片上没有地名');
      if (!year || !map.name.includes(`种子7-第${year}年-手绘`)) errs.push(`导出的文件名没带种子 / 时间轴当前的年份(${map.name},时间轴第 ${year} 年)`);

      // 同一张图导成 JPEG:是 JPEG、尺寸对、比 PNG 小得多
      const jpg = await grab('mapjpg');
      const isJpeg = jpg.buf[0] === 0xff && jpg.buf[1] === 0xd8 && jpg.buf[2] === 0xff;
      console.log(
        `导出地图 JPEG:${jpg.name},${jpg.dbg?.w}×${jpg.dbg?.h},${(jpg.buf.length / 1e6).toFixed(2)} MB` +
          `(PNG ${(map.buf.length / 1e6).toFixed(2)} MB,是它的 1/${(map.buf.length / Math.max(1, jpg.buf.length)).toFixed(1)})`,
      );
      if (!isJpeg || !jpg.name.endsWith('.jpg') || jpg.dbg?.w !== 2048) errs.push(`导出的 JPEG 不对(${jpg.name},${jpg.buf.length} 字节)`);
      if (!(jpg.buf.length < map.buf.length / 2)) errs.push(`JPEG 没比 PNG 小多少(${jpg.buf.length} / ${map.buf.length} 字节)`);

      const hm = await grab('height16');
      const h = PNG.sync.read(hm.buf, { skipRescale: true });
      const status = await toastText(page, 'export');
      const sea = Number(status.match(/海平面 = 灰度 (\d+)/)?.[1]);
      console.log(`导出 16 位高度图:${hm.name},${h.width}×${h.height},位深 ${h.depth};提示「${status.replace(/\n/g, ' ')}」`);
      if (h.width !== 2048 || h.height !== 1024 || h.depth !== 16) errs.push(`16 位高度图不对(${h.width}×${h.height},位深 ${h.depth})`);
      if (!(sea > 0 && sea < 65535) || sea !== hm.dbg?.seaLevel) errs.push('16 位高度图导出后没有写海平面灰度');
    } catch (e) {
      errs.push(`导出失败:${(e as Error).message}`);
    }
    await closeOverview();
  }
}

// 点选 + 改名(阶段 4):拖动地图不选中;点一座城 → 详情面板 → 改名 → 地图上的字、悬停都变了 → 恢复默认 → Esc 关面板
if (part('点选改名')) {
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const mb = (await page.locator('.map-box').boundingBox())!;
  // 拖动(按下 → 挪 120 像素 → 松开)不算单击
  await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.5);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(mb.x + mb.width * 0.5 + i * 20, mb.y + mb.height * 0.5 + i * 8);
  await page.mouse.up();
  await page.waitForTimeout(250);
  const dragSel = await page.locator('.inspector').count();
  await page.mouse.dblclick(mb.x + mb.width * 0.5, mb.y + mb.height * 0.5);
  await page.waitForTimeout(250);
  const dblSel = await page.locator('.inspector').count();
  type Pick = { kind: string; id: number; text: string; x: number; y: number };
  const ps = (await page.evaluate('window.__wfPickables()')) as Pick[];
  // 挑一座悬停时"最近城市"就是它自己的城(同一州里可能有更大的城):改名后悬停信息里才看得到新名字;
  // 符号在舞台中间一带(详情面板在左 / 右边弹出,宽约 300 像素,会盖住靠边的符号)
  let city: Pick | undefined;
  let mark: Pick | undefined;
  const vw = page.viewportSize()!.width;
  for (const c of ps.filter((p) => p.kind === 'settlement' && ps.some((m) => m.kind === 'mark' && m.id === p.id && m.x > 450 && m.x < vw - 450)).slice(0, 20)) {
    const m = ps.find((q) => q.kind === 'mark' && q.id === c.id)!;
    const t = await probe(page, m.x, m.y);
    if (t.includes(`最近城市 ${c.text}`)) {
      city = c;
      mark = m;
      break;
    }
  }
  let panel = '';
  let renamed = false;
  let hoverNew = '';
  let reset = false;
  let closed = false;
  let renameMs = NaN;
  let settleMs = NaN;
  let exportNew = false;
  if (city && mark) {
    await page.mouse.click(mark.x, mark.y);
    panel = await page
      .locator('.inspector')
      .innerText({ timeout: 3000 })
      .catch(() => '');
    await page.click('.inspector .ins-name');
    await page.fill('.inspector .ins-edit input', '饕餮城');
    // 点城以后地图飞过去、放大后的细节层在后台备料:等停稳再量(不然量进去的是飞行和备料,慢的机器上一次一个样)
    settleMs = await mapSettled();
    // 在页面里计时:按回车 → 地图文字层画出新名字
    renameMs = (await page.evaluate(`(async () => {
      const w = window;
      const t0 = performance.now();
      document.querySelector('.inspector .ins-edit input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise((res) => {
        const check = () => ((w.__wfLabels?.texts || []).includes('饕餮城') || performance.now() - t0 > 5000 ? res() : requestAnimationFrame(check));
        check();
      });
      return performance.now() - t0;
    })()`)) as number;
    const texts = (await page.evaluate('window.__wfLabels.texts')) as string[];
    renamed = texts.includes('饕餮城') && !texts.includes(city.text);
    // 改名后重新取一次这座城的符号位置(地图万一挪动过也能对准)
    const after = ((await page.evaluate('window.__wfPickables()')) as Pick[]).find((q) => q.kind === 'mark' && q.id === mark!.id) ?? mark;
    await page.mouse.move(after.x, after.y);
    await page.waitForTimeout(200);
    // 悬停在城镇符号上:小卡片写这座城的名字
    hoverNew = await page.locator('.hover-card').innerText().catch(() => '');
    // 导出的编年史里也是改过的名字
    try {
      await closeOverview();
      await page.click('.export-btn');
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('.export-item[data-job=md]')]);
      const file = await dl.path();
      exportNew = file ? (await import('node:fs')).readFileSync(file, 'utf8').includes('饕餮城') : false;
    } catch (e) {
      errs.push(`改名后导出编年史失败:${(e as Error).message}`);
    }
    await closeOverview();
    await page.click('.inspector .ins-reset');
    reset = await page
      .waitForFunction((n) => (window as any).__wfLabels?.texts?.includes(n), city.text, { timeout: 5000 })
      .then(() => true, () => false);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    closed = (await page.locator('.inspector').count()) === 0;
  }
  console.log(
    `点选:拖动后面板 ${dragSel} 个、双击后 ${dblSel} 个;点「${city?.text}」→ 面板「${panel.replace(/\n/g, ' ').slice(0, 40)}…」;` +
      `改名 → 地图上的字变了 ${renamed}(${renameMs.toFixed(1)} ms;按回车前等地图停稳 ${settleMs.toFixed(0)} ms),悬停「${hoverNew.replace(/\n/g, ' ')}」;导出的编年史里有新名字 ${exportNew};恢复默认 ${reset};Esc 关面板 ${closed}`,
  );
  if (dragSel) errs.push('拖动地图误触发了选中');
  if (dblSel) errs.push('双击(复位视图)后留下了选中');
  if (!city || !panel.includes(city.text)) errs.push('点城镇符号后没有出现这座城的详情面板');
  if (!renamed) errs.push('改名后地图上的城名没有变');
  if (!hoverNew.includes('饕餮城')) errs.push('改名后悬停信息里的城名没有变');
  if (!exportNew) errs.push('改名后导出的编年史里没有新名字');
  if (!reset) errs.push('恢复默认后地图上的城名没有变回来');
  if (!closed) errs.push('按 Esc 没有关掉详情面板');
  const RENAME_BUDGET = process.env.CI ? 250 : 100;
  timing('改名到地图上的字变了', renameMs, RENAME_BUDGET);
}
// 存档(阶段 4):打开一个种子(只是看看,不存)→ 改一个名字 → 存进"我的世界"、网址换成 w=编号 → 刷新页面 → 名字还在(自动恢复);
// 存档菜单写着"已自动存";存成文件;回到"我的世界"有这张卡片 → 换一个世界、清掉浏览器里的存档 → 从文件打开 → 名字回来
if (part('存档')) {
  const labelsHave = (n: string, timeout = 60000) =>
    page.waitForFunction((t) => (window as any).__wfLabels?.texts?.includes(t), n, { timeout }).then(() => true, () => false);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  type Pick = { kind: string; id: number; text: string; x: number; y: number };
  const ps = (await page.evaluate('window.__wfPickables()')) as Pick[];
  // 挑一座悬停时"最近城市"就是它自己的城(同一州里可能有更大的城):改名后悬停信息里才看得到新名字;
  // 符号在舞台中间一带(详情面板在左 / 右边弹出,宽约 300 像素,会盖住靠边的符号)
  let city: Pick | undefined;
  let mark: Pick | undefined;
  const vw = page.viewportSize()!.width;
  for (const c of ps.filter((p) => p.kind === 'settlement' && ps.some((m) => m.kind === 'mark' && m.id === p.id && m.x > 450 && m.x < vw - 450)).slice(0, 20)) {
    const m = ps.find((q) => q.kind === 'mark' && q.id === c.id)!;
    const t = await probe(page, m.x, m.y);
    if (t.includes(`最近城市 ${c.text}`)) {
      city = c;
      mark = m;
      break;
    }
  }
  let kept = false;
  let restoredNote = '';
  let fileName = '';
  let fileOk = false;
  let back = false;
  let loadNote = '';
  let listed = 0;
  let visitUrl = '';
  let storedUrl = '';
  let menu = '';
  if (city && mark) {
    visitUrl = page.url();
    await page.mouse.click(mark.x, mark.y);
    await page.click('.inspector .ins-name');
    await page.fill('.inspector .ins-edit input', '饕餮城');
    await page.keyboard.press('Enter');
    await labelsHave('饕餮城', 5000);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => /[?&]w=w/.test(location.search), null, { timeout: 5000 }).catch(() => {});
    storedUrl = page.url();
    await page.reload();
    await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
    kept = await labelsHave('饕餮城', 10000);
    restoredNote = await toastText(page, 'save');
    // 存档菜单:当前世界一行写着"已自动存";存成文件
    await closeOverview();
    await page.click('.save-btn');
    menu = (await page.locator('.save-menu .save-cur').innerText().catch(() => '')).replace(/\n/g, ' ');
    try {
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('[data-act=save-file]')]);
      fileName = dl.suggestedFilename();
      const file = await dl.path();
      const text = file ? (await import('node:fs')).readFileSync(file, 'utf8') : '';
      const save = JSON.parse(text);
      fileOk = save.app === '文明与地图' && save.seed === 7 && Object.values(save.edits?.names ?? {}).includes('饕餮城') && /^[0-9a-f]{12}$/.test(save.check);
      await page.click('.save-btn');
      // 回到"我的世界":有这个世界的卡片
      await page.click('.sidebar [data-act=home]');
      await page.locator('.mw').waitFor({ timeout: 5000 });
      await civsTab(page);
      listed = await page.locator('.mw [data-act=open-world]').count();
      // 换一个世界(种子 2024),清掉浏览器里的存档(像换了台电脑),再从文件打开
      await page.goto(`${dev.url}/?seed=2024&style=fantasy&civ=polities`);
      await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
      await page.evaluate(() => localStorage.clear());
      await page.waitForTimeout(300);
      if (file) await openFile(page, file);
      back = (await labelsHave('饕餮城')) && page.url().includes('seed=7');
      loadNote = await toastText(page, 'save');
    } catch (e) {
      errs.push(`存成文件 / 从文件打开失败:${(e as Error).message}`);
    }
    await closeOverview();
  }
  console.log(
    `存档:改名「${city?.text}」→ 饕餮城,网址 ${visitUrl.split('?')[1]} → ${storedUrl.split('?')[1]},刷新后还在 ${kept}(提示「${restoredNote.replace(/\n/g, ' ')}」);` +
      `存档菜单「${menu}」;我的世界 ${listed} 个;` +
      `存成文件 ${fileName} 内容对 ${fileOk};换种子 2024 后从文件打开,名字回来 ${back}(提示「${loadNote.replace(/\n/g, ' ')}」)`,
  );
  if (!city) errs.push('存档检查没找到可以改名的城');
  if (!kept) errs.push('改名后刷新页面,名字没有自动恢复');
  if (!restoredNote.includes('已恢复')) errs.push('刷新后没有"已恢复上次的修改"的提示');
  if (/[?&]w=/.test(visitUrl) || !/[?&]w=w/.test(storedUrl)) errs.push(`只是看看的世界改了以后,网址应换成 w=编号(${visitUrl} → ${storedUrl})`);
  if (!menu.includes('已自动存')) errs.push(`存档菜单里当前世界没写"已自动存"(${menu})`);
  if (listed !== 1) errs.push(`"我的世界"里应正好有改过的这一个世界(${listed})`);
  if (!fileOk || !/^文明与地图-.+\.json$/.test(fileName)) errs.push(`存成的文件不对(${fileName})`);
  if (!back) errs.push('从文件打开后没有回到存档的世界 / 名字没回来');
  // 收尾:删掉这个世界的存档(不影响后面的检查)
  await page.evaluate(() => localStorage.clear());
}

// 旧存档的键(阶段 4 远处的历史别乱):浏览器里存着一个旧版本(按"种子 + 参数"当编号、r + 州号的键)的自动存档 →
// 进站先到"我的世界",列着这个世界(换成了新编号)→ 打开 → 改名照样套上(州名、城名),自动存里的键就地换成了 c 格式(按地块)
if (part('旧存档的键')) {
  const { worldKey } = await import('../src/gen/savefile');
  const { DEFAULT_PARAMS } = await import('../src/gen/world');
  const params = { ...DEFAULT_PARAMS, seed: 7 };
  const id = worldKey(params);
  const legacy = {
    app: '文明与地图',
    format: 1,
    generator: 1,
    seed: 7,
    params,
    edits: { names: { 'region:r0': '九嶷州', 'settlement:r3#0': '饕餮城' }, interventions: [], terrain: [] },
    check: '',
    savedAt: '2026-09-20T08:00:00.000Z',
  };
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`wenming-ditu:world:${id}`, JSON.stringify(legacy)]);
  await page.goto(`${dev.url}/?style=fantasy&civ=polities`);
  await civsTab(page);
  const card = await page.locator('.mw [data-act=open-world]').first().waitFor({ timeout: 10000 }).then(() => true, () => false);
  if (card) await page.locator('.mw [data-act=open-world]').first().click();
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  // 自动存写回去是同步的(套上修改那一刻);等一下提示出来
  await page.waitForTimeout(500);
  const keysNow = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('wenming-ditu:world:')));
  const newKey = keysNow.length === 1 && /^wenming-ditu:world:w/.test(keysNow[0]) ? keysNow[0] : '';
  const stored = newKey ? await page.evaluate((k) => localStorage.getItem(k), newKey) : null;
  const names: Record<string, string> = stored ? JSON.parse(stored).edits?.names ?? {} : {};
  const keys = Object.keys(names);
  const note = await toastText(page, 'save');
  const upgraded = keys.length === 2 && keys.every((k) => /^(region|settlement):c\d+(#\d+)?$/.test(k)) && Object.values(names).sort().join() === '九嶷州,饕餮城';
  console.log(`旧存档的键:我的世界里有卡片 ${card},存档的键 ${keysNow.join()};读回后 ${JSON.stringify(names)},换成 c 格式 ${upgraded}(提示「${note.replace(/\n/g, ' ')}」)`);
  if (!card) errs.push('旧版本的自动存档没有出现在"我的世界"里');
  if (!newKey) errs.push(`旧版本的自动存档没有换成新编号(${keysNow.join()},旧的 ${id})`);
  if (!upgraded) errs.push(`旧存档里 r 格式的键没有换成 c 格式:${JSON.stringify(names)}`);
  if (/找不到对应的地方/.test(note)) errs.push(`旧存档的改名有找不到的:${note}`);
  // 改版前的网址(只带种子、参数,没有 w=)刷新:回到这个存档(换成新编号,改名都在),不是一个空白的"看看"
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [`wenming-ditu:world:${id}`, JSON.stringify(legacy)]);
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  const back = await page.evaluate(() => {
    const w = new URLSearchParams(location.search).get('w');
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('wenming-ditu:world:'));
    return { w, keys, stored: w ? localStorage.getItem(`wenming-ditu:world:${w}`) : null };
  });
  const backNames = back.stored ? Object.values(JSON.parse(back.stored).edits?.names ?? {}).sort().join() : '';
  console.log(`改版前的网址刷新:网址里的世界编号 ${back.w},存档的键 ${back.keys.join()},改名 ${backNames}`);
  if (!back.w || back.keys.length !== 1 || backNames !== '九嶷州,饕餮城')
    errs.push(`改版前的网址刷新没有回到原来的存档(w=${back.w},键 ${back.keys.join()},改名 ${backNames})`);
  // "我的世界"里删除:点一下就删(不再问第二次),提示条上点"撤销"放回来
  await page.goto(`${dev.url}/?style=fantasy&civ=polities`);
  await civsTab(page);
  await page.locator('.mw [data-act=open-world]').first().waitFor({ timeout: 10000 }).catch(() => {});
  const cardCount = () => page.locator('.mw [data-act=open-world]').count();
  const cardsBefore = await cardCount();
  await page.locator('.mw [data-act=world-menu]').first().click().catch(() => {});
  await page.locator('[data-act=world-delete]').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
  const cardsGone = await cardCount();
  const delNote = await toastText(page, 'save');
  await page.locator('[data-act=world-undelete]').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(200);
  const cardsBack = await cardCount();
  const keptKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('wenming-ditu:world:')).length);
  console.log(`我的世界里删除:${cardsBefore} 个 → 删后 ${cardsGone} 个(提示「${delNote}」)→ 撤销后 ${cardsBack} 个,存档 ${keptKeys} 个`);
  if (cardsBefore !== 1 || cardsGone !== 0 || !/已删除.*撤销/.test(delNote) || cardsBack !== 1 || keptKeys !== 1)
    errs.push(`"我的世界"里点一下删除、再点撤销不对(${cardsBefore} → ${cardsGone} → ${cardsBack},存档 ${keptKeys} 个,提示「${delNote}」)`);
  // 删的是最后一个:停在"我的世界"(提示条上还能撤销);提示收起了也不自动新建,留在空的首页等用户点「新建世界」
  await page.locator('.mw [data-act=world-menu]').first().click().catch(() => {});
  await page.locator('[data-act=world-delete]').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const waitHome = (await page.locator('.mw').count()) > 0 && /撤销/.test(await toastText(page, 'save'));
  await page.waitForFunction(() => !document.querySelector('[data-act=world-undelete]'), null, { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(500);
  const emptyHome = (await page.locator('.mw-empty [data-act=new-world]').count()) > 0 && !(await page.locator('.studio').count());
  console.log(`删掉最后一个世界:提示条在的时候停在我的世界 ${waitHome},提示收起后是空的首页 ${emptyHome}`);
  if (!waitHome || !emptyHome) errs.push(`删掉最后一个世界:应停在"我的世界"(提示条上能撤销),提示收起后是空的首页、不自动新建(停住 ${waitHome},空首页 ${emptyHome})`);
  await page.evaluate(() => localStorage.clear());
}
// 世界换成球面以前(生成器版本 4 及以前)的存档文件、分享链接:照常打开成同一个种子的球面世界,提示"来自旧版本",
// 地形修改按经纬度套上(跨 180° 经线的那一笔也行),指不到的改名 / 干预先留着;页面不报错
if (part('平面时代的存档')) {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { encodeShare } = await import('../src/gen/savefile');
  const old = {
    app: '文明与地图',
    format: 1,
    generator: 4,
    seed: 7,
    params: { seed: 7, cells: 12000, landFraction: 0.33, plates: 30, mountains: 1, temperature: 0, rainfall: 1 },
    edits: {
      names: { 'settlement:r3#0': '饕餮城', 'polity:c4567#0': '秦', 'place:river@c11999#0': '弱水' },
      interventions: [{ kind: 'protect', a: 'polity:c4567#0', from: 1200 }],
      terrain: [{ kind: 'range', pts: [2000, 300, 2048, 340, 30, 380], r: 23, s: 1 }],
    },
    check: '3f9a0c1d7b2e',
    title: '平面时代的世界',
    savedAt: '2026-09-20T08:00:00.000Z',
  };
  const before = errs.length;
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${dev.url}/?seed=2024&style=fantasy&civ=polities`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  const file = path.join(os.tmpdir(), `wf-old-save-${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify(old));
  await openFile(page, file);
  const fileOpened = await page
    .waitForFunction(() => location.search.includes('seed=7') && (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 })
    .then(() => true, () => false);
  // 存档里的干预对上了这个世界里的国家时,打开后先重推一遍,提示等重推完才出来
  const fileNote = await toastText(page, 'save', 30000);
  // 地形修改也套上了(打开时直接带着地形修改生成):改了 5 处 = 3 处改名 + 1 条干预 + 1 处地形
  const regen = fileNote.includes('改了 5 处');
  fs.rmSync(file, { force: true });
  // 分享链接:另一个浏览器(没有本地存档)打开
  const ctx4 = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const p4 = await ctx4.newPage();
  p4.on('pageerror', (e) => errs.push(`旧分享链接:${e.message}`));
  const hash = await encodeShare(old as never);
  await p4.goto(`${dev.url}/?seed=7&cells=12000${hash}`);
  const linkOpened = await p4
    .waitForFunction(() => location.search.includes('seed=7') && (window as any).__wf?.ready, null, { timeout: 60000 })
    .then(() => true, () => false);
  await p4.waitForTimeout(500);
  const linkNote = await toastText(p4, 'save', 5000);
  await ctx4.close();
  const pageErrs = errs.length - before;
  console.log(`平面时代的存档:从文件打开 ${fileOpened}(提示「${fileNote}」),修改(含地形)都套上 ${regen};分享链接打开 ${linkOpened}(提示「${linkNote}」)`);
  if (!fileOpened || !fileNote.includes('来自旧版本')) errs.push(`平面时代的存档文件没有照常打开 / 没提示"来自旧版本"(${fileNote})`);
  if (!regen) errs.push('平面时代的存档:修改没有全部套上(应为改了 5 处)');
  if (!linkOpened || !linkNote.includes('来自旧版本')) errs.push(`平面时代的分享链接没有照常打开 / 没提示"来自旧版本"(${linkNote})`);
  if (pageErrs > 0) errs.push('打开平面时代的存档、分享链接时页面报错');
  await page.evaluate(() => localStorage.clear());
}
// 隐私模式(localStorage 一碰就抛错):页面照常能用,改名照样生效,存档菜单里提示"不让存"
if (part('隐私模式')) {
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  await ctx2.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  });
  const p2 = await ctx2.newPage();
  const errs2: string[] = [];
  p2.on('pageerror', (e) => errs2.push(e.message));
  p2.on('console', (m) => m.type() === 'error' && errs2.push(m.text()));
  await p2.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
  const ok = await p2.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 }).then(() => true, () => false);
  await p2.waitForTimeout(300);
  type Pick = { kind: string; id: number; text: string; x: number; y: number };
  const ps = ok ? ((await p2.evaluate('window.__wfPickables()')) as Pick[]) : [];
  const mark = ps.find((m) => m.kind === 'mark');
  let renamed = false;
  let note = '';
  if (mark) {
    await p2.mouse.click(mark.x, mark.y);
    await p2.click('.inspector .ins-name');
    await p2.fill('.inspector .ins-edit input', '饕餮城');
    await p2.keyboard.press('Enter');
    renamed = await p2
      .waitForFunction(() => (window as any).__wfLabels?.texts?.includes('饕餮城'), null, { timeout: 5000 })
      .then(() => true, () => false);
    await p2.keyboard.press('Escape');
    await closeOverview(p2);
    await p2.click('.save-btn');
    note = await p2.locator('.save-menu').innerText().catch(() => '');
  }
  console.log(`隐私模式:页面加载 ${ok},改名生效 ${renamed},菜单提示「${note.split('\n').find((l) => l.includes('不让')) ?? ''}」;错误 ${errs2.length} 条`);
  if (!ok || !renamed) errs.push('隐私模式(浏览器不让存)下页面不能用 / 改名不生效');
  if (!note.includes('不让网页存数据')) errs.push('隐私模式下存档菜单没有提示"不让存"');
  if (errs2.length) errs.push(`隐私模式下有报错:${errs2[0]}`);
  await ctx2.close();
}

// 分享链接(阶段 4):改名 → 复制分享链接 → 另一个浏览器(什么都没存)打开这个链接 → 名字在、地址栏的 # 去掉了、地图下面说明"别人分享给你的世界";
// 那边改成别的名字(存进那边的"我的世界")后再打开链接 → 看到的是链接里的(不问、不覆盖),回"我的世界"打开本地那个还是自己改的名字;
// 剪贴板用不了 → 存档菜单里一行手动复制
if (part('分享链接')) {
  type Pick = { kind: string; id: number; text: string; x: number; y: number };
  const has = (p: typeof page, n: string, timeout = 30000) =>
    p.waitForFunction((t) => (window as any).__wfLabels?.texts?.includes(t), n, { timeout }).then(() => true, () => false);
  const ready = (p: typeof page) => p.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  const rename = async (p: typeof page, id: number, name: string) => {
    const mark = ((await p.evaluate('window.__wfPickables()')) as Pick[]).find((m) => m.kind === 'mark' && m.id === id);
    if (!mark) return false;
    await p.mouse.click(mark.x, mark.y);
    await p.click('.inspector .ins-name');
    await p.fill('.inspector .ins-edit input', name);
    await p.keyboard.press('Enter');
    const ok = await has(p, name, 5000);
    await p.keyboard.press('Escape');
    return ok;
  };
  const note = (p: typeof page) => toastText(p, 'save');
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 820 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  for (const p of [a, b]) {
    p.on('pageerror', (e) => errs.push(`分享:${e.message}`));
    p.on('console', (m) => m.type() === 'error' && errs.push(`分享:${m.text()}`));
  }
  await a.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
  await ready(a);
  await a.waitForTimeout(300);
  const picks = (await a.evaluate('window.__wfPickables()')) as Pick[];
  const city = picks.find((p) => p.kind === 'settlement' && picks.some((m) => m.kind === 'mark' && m.id === p.id));
  let share: { url: string; length: number; withData: boolean; copied: boolean } | null = null;
  let clip = '';
  let copyNote = '';
  let opened = false;
  let hashGone = false;
  let openNote = '';
  let again = false;
  /** 再打开链接时开着的窗口 / 问的提示条(都应该没有) */
  let askModal = 0;
  let cards = 0;
  let kept = false;
  let manualOk = false;
  if (city && (await rename(a, city.id, '梼杌城'))) {
    await closeOverview(a);
    await a.click('.save-btn');
    await a.click('[data-act=share-link]');
    share = await a.waitForFunction(() => (window as any).__wfShare, null, { timeout: 10000 }).then((h) => h.jsonValue(), () => null);
    clip = await a.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    copyNote = await note(a);
    if (share) {
      // 另一个浏览器打开
      await b.goto(share.url);
      await ready(b);
      opened = await has(b, '梼杌城');
      hashGone = (await b.evaluate(() => location.hash)) === '' && b.url().includes('seed=7');
      openNote = (await b.locator('.shared-hint').textContent({ timeout: 10000 }).catch(() => null)) ?? (await note(b));
      // 那边改成别的名字(存进那边的"我的世界"),再打开同一个链接:就是链接里的样子;本地改过的那个另外留着
      if (opened && (await rename(b, city.id, '混沌城'))) {
        await b.waitForTimeout(300);
        await b.goto(share.url);
        await ready(b);
        again = (await has(b, '梼杌城')) && !(await b.evaluate(() => (window as any).__wfLabels.texts.includes('混沌城')));
        askModal = (await b.locator('[aria-modal=true]:visible').count()) + (await b.locator('.toast[data-toast=share-ask]').count());
        await closeOverview(b);
        await b.click('.sidebar [data-act=home]');
        await b.locator('.mw').waitFor({ timeout: 5000 }).catch(() => {});
        await civsTab(b);
        cards = await b.locator('.mw [data-act=open-world]').count();
        await b.locator('.mw [data-act=open-world]').first().click().catch(() => {});
        await ready(b);
        kept = (await has(b, '混沌城', 10000)) && !(await b.evaluate(() => (window as any).__wfLabels.texts.includes('梼杌城')));
      }
    }
    // 剪贴板用不了:存档菜单留着,里面多一行选中了链接的输入框
    // (写成字符串:tsx 编译函数时会插入页面里没有的 __name)
    await a.evaluate(`
      Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: function () { return Promise.reject(new DOMException('denied', 'NotAllowedError')); } });
      document.execCommand = function () { return false; };
    `);
    await closeOverview(a);
    await a.click('.save-btn');
    await a.click('[data-act=share-link]');
    const ta = await a.locator('.save-menu [data-testid=share-manual] input').inputValue({ timeout: 10000 }).catch(() => '');
    manualOk = !!ta && ta === (await a.evaluate(() => (window as any).__wfShare?.url)) && ta.includes('#share=');
    await a.keyboard.press('Escape');
  }
  console.log(
    `分享链接:改名「${city?.text}」→ 梼杌城,复制 ${share?.length ?? '-'} 字(剪贴板一致 ${!!share && clip === share.url},提示「${copyNote}」);` +
      `新浏览器打开 名字在 ${opened}、# 去掉 ${hashGone}(提示「${openNote}」);本地改过再开:是链接里的 ${again}、问 ${askModal} 次;` +
      `我的世界 ${cards} 个,打开是本地改的 ${kept};剪贴板用不了时手动复制框 ${manualOk}`,
  );
  if (!city) errs.push('分享:没找到可以改名的城');
  else {
    if (!share?.withData || !share.url.includes('#share=')) errs.push('分享:复制的链接没带修改');
    if (!share || clip !== share.url) errs.push('分享:剪贴板里的不是分享链接');
    if (!copyNote.startsWith('已复制分享链接')) errs.push(`分享:复制后的提示不对(${copyNote})`);
    if (!opened) errs.push('分享:另一个浏览器打开链接后名字不在');
    if (!hashGone) errs.push('分享:打开后地址栏的 # 没去掉');
    if (!openNote.includes('别人分享给你的世界')) errs.push(`分享:打开链接后地图下面没有"别人分享给你的世界"那条说明(${openNote})`);
    if (!again || askModal) errs.push(`分享:本地改过以后再打开链接,应直接是链接里的样子、不问(链接里的 ${again},问 ${askModal})`);
    if (cards !== 1 || !kept) errs.push(`分享:本地改过的那个世界应留在"我的世界"里(${cards} 个,名字是本地的 ${kept})`);
    if (!manualOk) errs.push('分享:剪贴板用不了时存档菜单里没有手动复制的一行');
  }
  await ctxA.close();
  await ctxB.close();
}

// 带干预的世界里给人物改名:打开分享链接时地图上先出来的是没带干预的历史,改名的那个人要等后台重推完才有 ——
// 打开时不说"没对上",推完以后按推好的历史核对:那个人对上了(搜得到新名字),确实不存在的那一处照旧说"1 处改名没对上";
// 不带干预的世界不用等重推,打开时就说
if (part('改名等推完')) {
  const { encodeShare } = await import('../src/gen/savefile');
  const { DEFAULT_PARAMS, generateWorld } = await import('../src/gen/world');
  const { generateCiv } = await import('../src/gen/civ');
  const { personKey, polityKey, resolveKey } = await import('../src/gen/edits');
  const params = { ...DEFAULT_PARAMS, seed: 7 };
  const w = generateWorld(params);
  const plain = generateCiv(w);
  // 保住第 1000 年还在的一国:往后的历史都变了,找一位只有带着这条干预才有的人
  const keep = plain.polities.findIndex((x) => x.founded <= 1000 && (x.ended ?? Infinity) > 1000);
  const iv = { kind: 'protect' as const, a: polityKey(plain, keep), from: 1000 };
  const withIv = generateCiv(w, { interventions: [iv] });
  let who = '';
  // 搜得到的人(没即位的宗室不进搜索)
  for (let i = 0; i < (withIv.people?.length ?? 0) && !who; i++) {
    const k = personKey(withIv, i);
    if (k && withIv.people![i].role !== 'prince' && !resolveKey(plain, k)) who = k;
  }
  const nobody = 'person:polity:c1#0|general|乌有|2000';
  const share = (names: Record<string, string>, interventions: unknown[]) =>
    encodeShare({ app: '文明与地图', format: 1, generator: GENERATOR_VERSION, seed: 7, params, edits: { names, interventions, terrain: [] }, check: '', title: '改名核对', savedAt: '2026-10-26T08:00:00.000Z' } as never);
  const open = async (hash: string, wait: boolean) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`改名等推完:${e.message}`));
    await p.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities${hash}`);
    await p.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
    const early = (await p.locator('.toast').allInnerTexts().catch(() => [] as string[])).join(' ').replace(/\n/g, ' ');
    // 重推完、画到地图上(__wfResim)以后再看提示
    if (wait) await p.waitForFunction(() => (window as any).__wfResim, null, { timeout: 120000 }).catch(() => {});
    await p.waitForTimeout(500);
    const done = await toastText(p, 'save', 2000);
    let found: string[] = [];
    if (wait) {
      await p.click('[data-act=search]');
      await p.fill('.sidebar .search-input', '阎溟');
      await p.waitForTimeout(300);
      found = await p.locator('.search-row .search-name').allInnerTexts().catch(() => [] as string[]);
    }
    await ctx.close();
    return { early, done, found };
  };
  const a = who ? await open(await share({ [who]: '阎溟', [nobody]: '子虚' }, [iv]), true) : null;
  const b = await open(await share({ [nobody]: '子虚' }, []), false);
  console.log(`改名等推完:改名的人 ${who || '没找到'};带干预:刚打开「${a?.early}」→ 推完「${a?.done}」、搜到 ${JSON.stringify(a?.found)};不带干预:打开就说「${b.done}」`);
  if (!who || !a) errs.push('改名等推完:没找到只有带着干预才有的人物');
  else {
    if (a.early.includes('没对上')) errs.push(`改名等推完:历史还没重推完就说改名没对上(${a.early})`);
    if (!a.done.includes('1 处改名没对上')) errs.push(`改名等推完:重推完应只有确实不存在的那 1 处没对上(${a.done})`);
    if (!a.found.some((t) => t.startsWith('阎溟'))) errs.push(`改名等推完:重推完搜不到改的新名字(${JSON.stringify(a.found)})`);
  }
  if (!b.done.includes('1 处改名没对上')) errs.push(`改名等推完:不带干预的世界打开时没说改名没对上(${b.done})`);
}

// 没改过的世界:复制出来的普通链接、地址栏都带生成器版本(gen=);打开旧版本时的普通链接,提示条说清变了什么;版本一样不提示
if (part('生成器版本')) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`版本号:${e.message}`));
  const ready = () => p.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await p.goto(`${dev.url}/?seed=7`);
  await ready();
  const bar = new URLSearchParams(await p.evaluate(() => location.search)).get('gen');
  await p.click('.save-btn');
  // 不带"这一刻"(取消勾选「停在这一刻」):没改过的世界就是普通链接
  await p.locator('.save-menu [data-act=share-moment]').uncheck();
  await p.click('[data-act=share-link]');
  const plain = await p.waitForFunction(() => (window as any).__wfShare, null, { timeout: 10000 }).then((h) => h.jsonValue() as Promise<{ url: string; withData: boolean }>, () => null);
  const linkGen = plain ? new URL(plain.url).searchParams.get('gen') : null;
  await p.goto(`${dev.url}/?seed=7&gen=6`);
  await ready();
  const oldNote = await toastText(p, 'save', 8000);
  await p.goto(`${dev.url}/?seed=7&gen=${GENERATOR_VERSION}`);
  await ready();
  const sameNote = await toastText(p, 'save', 1500);
  console.log(`版本号:地址栏 gen=${bar},普通链接 gen=${linkGen}(带修改 ${plain?.withData});旧版本链接提示「${oldNote}」;同版本「${sameNote}」`);
  if (bar !== String(GENERATOR_VERSION)) errs.push(`版本号:地址栏没带 gen=${GENERATOR_VERSION}(${bar})`);
  if (!plain || plain.withData || linkGen !== String(GENERATOR_VERSION)) errs.push(`版本号:没改过的世界复制的链接没带 gen=${GENERATOR_VERSION}(${plain?.url})`);
  if (!oldNote.startsWith('已打开「种子 7」') || !oldNote.includes('来自旧版本：')) errs.push(`版本号:打开旧版本的普通链接,提示不对(${oldNote})`);
  if (sameNote) errs.push(`版本号:同版本的链接不该有提示(${sameNote})`);
  // 网址带的版本比页面新(页面是旧的,还没刷新):提示刷新,地址栏、复制的链接都照留;带了认不出的版本号按认不出的旧版本说
  await p.goto(`${dev.url}/?seed=7&gen=${GENERATOR_VERSION + 1}`);
  await ready();
  const newerNote = await toastText(p, 'save', 8000);
  const newerBar = new URLSearchParams(await p.evaluate(() => location.search)).get('gen');
  await p.click('.save-btn');
  await p.click('[data-act=share-link]');
  const newer = await p.waitForFunction(() => (window as any).__wfShare, null, { timeout: 10000 }).then((h) => h.jsonValue() as Promise<{ url: string }>, () => null);
  const newerLink = newer ? new URL(newer.url).searchParams.get('gen') : null;
  await p.goto(`${dev.url}/?seed=7&gen=7.5`);
  await ready();
  const oddNote = await toastText(p, 'save', 8000);
  console.log(`版本号:更新版本的链接提示「${newerNote}」,地址栏 gen=${newerBar},复制的链接 gen=${newerLink};认不出的版本号提示「${oddNote}」`);
  if (!newerNote.includes('来自更新的版本')) errs.push(`版本号:打开更新版本的链接,提示不对(${newerNote})`);
  if (newerBar !== String(GENERATOR_VERSION + 1) || newerLink !== String(GENERATOR_VERSION + 1)) errs.push(`版本号:更新版本的 gen 没照留(地址栏 ${newerBar},链接 ${newerLink})`);
  if (!oddNote.includes('来自旧版本：整颗星球')) errs.push(`版本号:认不出的版本号,提示不对(${oddNote})`);
  // 新建中还没存的网址(new=1)不带版本号:打开这种网址是接着新建,用的总是现在的版本
  await p.goto(`${dev.url}/?new=1&seed=7&gen=6`);
  await ready();
  const draftBar = new URLSearchParams(await p.evaluate(() => location.search));
  if (draftBar.get('new') !== '1' || draftBar.has('gen')) errs.push(`版本号:新建中的网址不该带 gen(${draftBar})`);
  await ctx.close();
}

// 分享链接带上"这一刻":第 1500 年选中一国、复制(「停在这一刻」默认勾着)→ 另一个浏览器打开停在第 1500 年、那一国选中、镜头一样,
// 地图下的说明开头说停在哪,「从头放」以后不再选中;国家卡片「更多」里的「复制分享链接」也带着这一国。
// 朋友的预设链接:打开就是新建弹窗第 2 步、参数照链接填好,顶上一条说明 +「存进我的预设…」;坏了的链接提示、照常停在我的世界
if (part('分享这一刻')) {
  const ctxA = await browser.newContext({ viewport: { width: 1400, height: 820 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const ctxB = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  for (const p of [a, b]) p.on('pageerror', (e) => errs.push(`这一刻:${e.message}`));
  const ready = (p: Page) => p.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await a.goto(`${dev.url}/?seed=7&civYear=1500&civ=polities`);
  await ready(a);
  await a.waitForTimeout(300);
  const pol = ((await a.evaluate('window.__wfPickables()')) as { kind: string; id: number }[]).find((x) => x.kind === 'polity');
  let link: { url: string; moment?: { year?: number; selected?: string; camera?: unknown } } | null = null;
  let menuLink: { moment?: { selected?: string } } | null = null;
  let menuNote = '';
  let opened: { sel?: { kind: string; id: number }; k?: number; hint?: string; year?: string } = {};
  let sharerK = 0;
  let replayed = '';
  if (pol) {
    await a.evaluate((id) => (window as any).__wfSelect('polity', id), pol.id);
    await a.waitForTimeout(1200);
    sharerK = await a.evaluate(() => (window as any).__wfView.k);
    await a.click('.save-btn');
    menuNote = (await a.locator('.save-menu .save-moment').textContent().catch(() => '')) ?? '';
    await a.click('[data-act=share-link]');
    link = await a.waitForFunction(() => (window as any).__wfShare, null, { timeout: 10000 }).then((h) => h.jsonValue(), () => null);
    await a.evaluate(() => delete (window as any).__wfShare);
    await a.click('.inspector [data-act=more]');
    await a.click('[data-act=share-moment-link]');
    menuLink = await a.waitForFunction(() => (window as any).__wfShare, null, { timeout: 10000 }).then((h) => h.jsonValue(), () => null);
    if (link) {
      await b.goto(link.url);
      await ready(b);
      await b.waitForTimeout(1500);
      opened = await b.evaluate(() => ({
        sel: (window as any).__wfSelection,
        k: (window as any).__wfView?.k,
        hint: document.querySelector('.shared-hint')?.textContent ?? '',
        year: document.querySelector('.civ-timeline')?.textContent ?? '',
      }));
      await b.click('[data-act=shared-replay]').catch(() => {});
      await b.waitForTimeout(500);
      replayed = `${await b.locator('.shared-hint').textContent().catch(() => '')}|${await b.locator('.inspector .cp').count()}`;
    }
  }
  console.log(
    `这一刻:菜单「${menuNote}」,链接 ${link?.url.length ?? '-'} 字 ${JSON.stringify(link?.moment)};更多菜单 ${JSON.stringify(menuLink?.moment)};` +
      `打开 选中 ${JSON.stringify(opened.sel)} 倍数 ${opened.k?.toFixed(2)}(分享时 ${sharerK.toFixed(2)}),说明「${opened.hint}」;从头放以后「${replayed}」`,
  );
  if (!pol) errs.push('这一刻:没找到国家');
  else {
    if (!menuNote.includes('停在这一刻') || !menuNote.includes('第 1500 年')) errs.push(`这一刻:存档菜单里没写停在第 1500 年(${menuNote})`);
    if (link?.moment?.year !== 1500 || !link.moment.selected?.startsWith('polity:') || !link.moment.camera) errs.push(`这一刻:复制的链接没带这一刻(${JSON.stringify(link?.moment)})`);
    if (menuLink?.moment?.selected !== link?.moment?.selected) errs.push('这一刻:国家卡片「更多」复制的链接没带这一国');
    if (opened.sel?.kind !== 'polity' || opened.sel.id !== pol.id) errs.push(`这一刻:打开后没选中那一国(${JSON.stringify(opened.sel)})`);
    if (!opened.year?.includes('1500')) errs.push(`这一刻:打开后时间轴不在第 1500 年(${opened.year})`);
    if (!opened.k || Math.abs(opened.k - sharerK) > 0.05) errs.push(`这一刻:打开后镜头的放大倍数不一样(${opened.k} / ${sharerK})`);
    if (!opened.hint?.includes('停在对方分享时看的那一刻：第 1500 年')) errs.push(`这一刻:说明没写停在哪(${opened.hint})`);
    if (replayed.includes('停在') || !replayed.endsWith('|0')) errs.push(`这一刻:「从头放」以后还停着(${replayed})`);
  }
  // 朋友的预设链接
  await b.goto(`${dev.url}/#preset=1&name=${encodeURIComponent('两块完整大陆')}&landFraction=0.4&continents=2&gather=0.5`);
  await b.locator('.nd-sheet').waitFor({ timeout: 30000 }).catch(() => {});
  const pre = await b.evaluate(() => ({
    step: document.querySelector('.nd-sheet')?.getAttribute('data-step'),
    bar: document.querySelector('[data-testid=shared-preset]')?.textContent ?? '',
    pop: document.querySelector('.nd-sheet [data-act=preset]')?.textContent ?? '',
    land: (document.querySelector('.nd-sheet [data-param=landFraction] input[type=range]') as HTMLInputElement | null)?.value,
    hash: location.hash,
  }));
  await b.click('[data-act=shared-preset-keep]').catch(() => {});
  await b.click('[data-act=preset-save-ok]').catch(() => {});
  const kept = await b.evaluate(() => JSON.parse(localStorage.getItem('wenming-ditu:presets') ?? '{}').list?.map((x: { name: string }) => x.name) ?? []);
  await b.goto(`${dev.url}/#preset=1&name=x&landFraction=0.4%`);
  await b.waitForTimeout(2500);
  const broken = await toastText(b, 'save', 8000);
  console.log(`预设链接:第 ${pre.step} 步,「${pre.bar}」,预设「${pre.pop}」,陆地 ${pre.land},# 去掉 ${!pre.hash};存进我的预设 ${JSON.stringify(kept)};坏链接「${broken}」`);
  if (pre.step !== '2' || !pre.bar.includes('朋友分享的预设「两块完整大陆」') || !pre.pop.includes('分享的') || pre.land !== '0.4' || pre.hash) errs.push(`预设链接:打开后不是填好参数的新建弹窗(${JSON.stringify(pre)})`);
  if (!kept.includes('两块完整大陆')) errs.push('预设链接:「存进我的预设…」没存上');
  if (!broken.includes('预设链接不完整')) errs.push(`预设链接:坏了的链接提示不对(${broken})`);
  await ctxA.close();
  await ctxB.close();
}

// 看原样:有旧网站的那一版(FIRST_OLD_SITE 起、比现在旧)建的世界,存档菜单里有一行「看原样」;提示条上也有,
// 不过只在这个世界真的变了样(提示"来自旧版本…")时才放 —— 之后几版只改了改过地形的世界的,没改过地形的世界提示条上不放
// (上一版另拿一个改过地形的世界看提示条上的)。
// 点了开一个新页面到 /v<那一版>/,带 own=1 和整份存档(# 后面)。没有旧网站的更早版本、现在这一版建的都没有
if (part('看原样')) {
  const { FIRST_OLD_SITE } = await import('../src/ui/oldSite');
  const { versionNote } = await import('../src/gen/savefile');
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`看原样:${e.message}`));
  /** 浏览器里存一个第 gen 版建的「青岚纪」(edited = 海里放了一座火山),从网址打开它:提示条、存档菜单里各有没有「看原样」 */
  const openGen = async (gen: number, edited: boolean) => {
    const id = `wsee${gen}${edited ? 'e' : 'x'}0001`;
    const save = {
      app: '文明与地图',
      format: 1,
      generator: gen,
      seed: 7,
      params: { seed: 7, cells: 12000, landFraction: 0.3, plates: 30, mountains: 1, temperature: 0, rainfall: 1 },
      edits: { names: {}, interventions: [], terrain: edited ? [{ kind: 'volcano', pts: [1813, 512], r: 18, s: 0.85 }] : [] },
      title: '青岚纪',
      savedAt: '2026-10-08T12:00:00.000Z',
    };
    await p.goto(`${dev.url}/`);
    await p.evaluate(([k, v]) => (localStorage.clear(), localStorage.setItem(k, v)), [`wenming-ditu:world:${id}`, JSON.stringify(save)]);
    await p.goto(`${dev.url}/?w=${id}`);
    await p.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
    const note = await toastText(p, 'save', 8000);
    const inToast = await p.locator('.toast [data-act=see-original]').count();
    await p.click('.save-btn');
    const inMenu = await p.locator('.save-menu [data-act=see-original]').count();
    await p.click('.save-btn');
    return { note, inToast, inMenu };
  };
  const gens = [...new Set([GENERATOR_VERSION - 1, FIRST_OLD_SITE - 1, GENERATOR_VERSION])];
  const cases: [number, boolean][] = [...gens.map((g): [number, boolean] => [g, false]), [GENERATOR_VERSION - 1, true]];
  for (const [gen, edited] of cases) {
    const has = gen >= FIRST_OLD_SITE && gen < GENERATOR_VERSION;
    // 提示条上放不放:这个世界从那一版到现在变没变样
    const inToast = has && versionNote(gen, edited) !== null;
    const r = await openGen(gen, edited);
    let popup = '';
    if (has && (r.inToast || r.inMenu)) {
      // 旧网站在开发服务器上没有:给一页空白顶上,只看新页面去了哪个网址(提示条上没有就从存档菜单里点)
      await ctx.route(/\/v\d+\/(\?|$)/, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>旧版</title>' }));
      const pop = ctx.waitForEvent('page', { timeout: 10000 });
      if (r.inToast) await p.click('.toast [data-act=see-original]');
      else {
        await p.click('.save-btn');
        await p.click('.save-menu [data-act=see-original]');
      }
      const np = await pop.catch(() => null);
      if (np) {
        await np.waitForURL(/\/v\d+\//, { timeout: 10000, waitUntil: 'commit' }).catch(() => {});
        popup = np.url();
        await np.close();
      }
      await ctx.unroute(/\/v\d+\/(\?|$)/);
    }
    const what = `第 ${gen} 版${edited ? '改过地形' : ''}的世界`;
    console.log(`看原样:${what},提示「${r.note}」,提示条上的按钮 ${r.inToast},存档菜单里 ${r.inMenu}${popup ? `,新页面 ${popup.slice(0, 80)}…` : ''}`);
    if (inToast !== (r.inToast === 1) || has !== (r.inMenu === 1))
      errs.push(`看原样:${what}提示条上${inToast ? '应该' : '不该'}有、存档菜单里${has ? '应该' : '不该'}有「看原样」(提示条 ${r.inToast},存档菜单 ${r.inMenu})`);
    if (has) {
      const u = popup ? new URL(popup) : null;
      if (!u || !u.pathname.endsWith(`/v${gen}/`) || u.searchParams.get('own') !== '1' || !u.hash.startsWith('#share=')) errs.push(`看原样:新页面的网址不对(${popup})`);
    }
  }
  await ctx.close();
}

// 各种状态(统一走顶部提示条,不另开窗口):首次打开世界出来之前只有同色底 + "正在生成世界"的进度(四角先藏着);
// 导入坏文件 → 提示条报错(打不开 xx.json + 原因);没有干预时概览"我的干预"是一句空状态;
// 浏览器存储满了 → 提示"没能自动存档"带"存成文件",存档菜单里当前世界那一行也写着
if (part('各种状态')) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const sp = await ctx.newPage();
  sp.on('pageerror', (e) => errs.push(`各种状态:${e.message}`));
  await sp.goto(`${dev.url}/?seed=7`);
  await sp.locator('.toast[data-toast=progress]').waitFor({ timeout: 20000 }).catch(() => {});
  const boot = await sp.evaluate(() => ({
    booting: !!document.querySelector('.app.booting'),
    toast: document.querySelector('.toast[data-toast=progress]')?.textContent ?? '',
    corner: getComputedStyle((document.querySelector('.map-bar') ?? document.querySelector('.corner-tl'))!).visibility,
    world: !!(window as any).__wf?.ready,
  }));
  await sp.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  const after = await sp.evaluate(() => ({ booting: !!document.querySelector('.app.booting'), corner: getComputedStyle((document.querySelector('.map-bar') ?? document.querySelector('.corner-tl'))!).visibility }));
  // 坏文件
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const bad = path.join(os.tmpdir(), `wf-bad-${process.pid}.json`);
  fs.writeFileSync(bad, JSON.stringify({ hello: 'world' }));
  await openFile(sp, bad);
  // 读完再删(页面是异步读文件的,先删了会变成"读不了这个文件")
  const badNote = await sp.locator('.toast[data-toast=save].k-error').innerText({ timeout: 5000 }).then((t) => t.replace(/\n/g, ' '), () => '');
  fs.rmSync(bad, { force: true });
  // 没有干预
  await openOverview(sp, 'interventions');
  const empty = await sp.locator('.ov [data-empty=interventions]').innerText().catch(() => '');
  await closeOverview(sp);
  // 存储满了:同一个页面里把世界存档的写入换成一写就报配额满(不再开新页面、重新生成世界,冒烟省时间)
  await sp.evaluate(`
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('wenming-ditu:world:')) throw new DOMException('full', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  `);
  const fp = sp;
  type Pick = { kind: string; id: number; text: string; x: number; y: number };
  // 避开顶部的提示条(坏文件的报错还在)
  const mark = ((await fp.evaluate('window.__wfPickables()')) as Pick[]).find((m) => m.kind === 'mark' && m.y > 140);
  let fullNote = '';
  let fullMenu = '';
  if (mark) {
    await fp.mouse.click(mark.x, mark.y);
    await fp.click('.inspector .ins-name');
    await fp.fill('.inspector .ins-edit input', '饕餮城');
    await fp.keyboard.press('Enter');
    fullNote = await toastText(fp, 'storage', 5000);
    await fp.keyboard.press('Escape');
    await closeOverview(fp);
    await fp.click('.save-btn');
    fullMenu = await fp.locator('.save-menu .save-cur').innerText().catch(() => '');
  }
  await ctx.close();
  console.log(
    `各种状态:首次打开 同色底 ${boot.booting}、四角 ${boot.corner}、提示条「${boot.toast}」→ 生成好后 四角 ${after.corner};` +
      `坏文件「${badNote}」;没有干预「${empty}」;存储满了「${fullNote}」,菜单「${fullMenu.replace(/\n/g, ' ')}」`,
  );
  if (!boot.world && (!boot.booting || boot.corner !== 'hidden' || !boot.toast.includes('正在生成世界')))
    errs.push(`首次打开:世界出来之前应该只有同色底和"正在生成世界"的进度(四角 ${boot.corner},提示条「${boot.toast}」)`);
  if (after.booting || after.corner !== 'visible') errs.push('首次打开:世界生成好以后四角没有出来');
  if (!badNote.includes('打不开') || !badNote.includes('不是「文明与地图」的存档')) errs.push(`导入坏文件:没有报错提示(${badNote})`);
  if (!empty.includes('还没有干预')) errs.push(`概览"我的干预"没有空状态(${empty})`);
  if (!mark) errs.push('存储满了:没找到可以改名的城');
  else {
    if (!fullNote.includes('没能自动存档') || !fullNote.includes('存成文件')) errs.push(`存储满了:没有提示"没能自动存档"(${fullNote})`);
    if (!fullMenu.includes('存储已满')) errs.push(`存储满了:存档菜单里当前世界那一行没写(${fullMenu})`);
  }
}

// 干预(阶段 4):点一个后来会亡的国家 → 国家面板"干预历史 → 保护" → 后台重推 → 它到最后都没亡,相关事件里记了一条干预,
// 时间轴从干预那一年接着放、轨道上多一枚"令";刷新页面恢复这条干预时不打断(无头浏览器里没有自动播放:停着不动)
if (part('干预保护')) {
  // 找一个"那一年还在、后来会亡"的国家:在 Node 里推一遍同一个世界,挑亡国之前国土最大的那一年,
  // 在地图上点它的国土(按世界坐标换成屏幕坐标;历史换了一遍时不用改这里)
  let Y = 0;
  let name = '';
  let fellAt = '';
  let best: { y: number; regs: number[]; id: number } | null = null;
  /** 某州里离治所(可能有城镇符号)最远的那块地的世界坐标 */
  let seatAt: (r: number) => [number, number] = () => [NaN, NaN];
  {
    const { DEFAULT_PARAMS, generateWorld } = await import('../src/gen/world');
    const { generateCiv } = await import('../src/gen/civ');
    const { ownersAt } = await import('../src/gen/civ/timeline');
    const w7 = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
    const c7 = generateCiv(w7);
    seatAt = (r) => {
      const R = c7.regions;
      let far = R.seat[r];
      let fd = -1;
      for (let k = R.cellStart[r]; k < R.cellStart[r + 1]; k++) {
        const c = R.cells[k];
        const d = Math.hypot(w7.mesh.x[c] - w7.mesh.x[R.seat[r]], w7.mesh.y[c] - w7.mesh.y[R.seat[r]]);
        if (d > fd && d < 200) (fd = d), (far = c);
      }
      return [w7.mesh.x[far], w7.mesh.y[far]];
    };
    for (const p of c7.polities) {
      if (p.ended === undefined || !c7.annals.some((e) => e.kind === 'fall' && e.a === p.id)) continue;
      for (const f of [0.5, 0.7, 0.85]) {
        const y = Math.floor(p.founded + (p.ended - p.founded) * f);
        const own = ownersAt(c7, y).polity;
        const regs: number[] = [];
        for (let r = 0; r < own.length; r++) if (own[r] === p.id) regs.push(r);
        if (!best || regs.length > best.regs.length) best = { y, regs, id: p.id };
      }
    }
    if (best) {
      Y = best.y;
      await page.evaluate(() => localStorage.clear());
      await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities&civYear=${Y}`);
      await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(300);
      const R = c7.regions;
      for (const r of best.regs.slice(0, 12)) {
        // 这州里离治所(可能有城镇符号)最远的那块地
        let far = R.seat[r];
        let fd = -1;
        for (let k = R.cellStart[r]; k < R.cellStart[r + 1]; k++) {
          const c = R.cells[k];
          const d = Math.hypot(w7.mesh.x[c] - w7.mesh.x[R.seat[r]], w7.mesh.y[c] - w7.mesh.y[R.seat[r]]);
          if (d > fd && d < 200) (fd = d), (far = c);
        }
        // 上一下选中后地图还在飞过去:停稳了再换算坐标
        await page.keyboard.press('Escape');
        await page.waitForTimeout(700);
        const at = await centerOn(page, w7.mesh.x[far], w7.mesh.y[far]);
        if (!at) continue;
        await page.mouse.click(at[0], at[1]);
        const id = await page
          .locator('.inspector .cp[data-polity]')
          .getAttribute('data-polity', { timeout: 3000 })
          .catch(() => null);
        if (id !== null && Number(id) === best.id) {
          name = (await page.locator('.inspector .ins-name').innerText()).trim();
          fellAt = String(Math.floor(c7.polities[best.id].ended!));
          break;
        }
      }
    }
  }
  /** 在地图上重新点开这个国家(地图可能飞走了:每次停稳了再按世界坐标换算);返回面板的字 */
  const reopen = async (): Promise<string> => {
    if (!best) return '';
    for (const r of best.regs.slice(0, 12)) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      const at = await centerOn(page, ...seatAt(r));
      if (!at) continue;
      await page.mouse.click(at[0], at[1]);
      const id = await page
        .locator('.inspector .cp[data-polity]')
        .getAttribute('data-polity', { timeout: 3000 })
        .catch(() => null);
      if (id !== null && Number(id) === best!.id) return page.locator('.inspector').innerText();
    }
    return '';
  };
  let resim: { paintedMs: number; workerMs: number } | null = null;
  let aliveAfter = '';
  let chron = '';
  let tl = '';
  let playing = false;
  let orders = 0;
  let listed = 0;
  let ivToast = '';
  let insChron = '';
  let events = '';
  /** 面板大事里干预那一条(类型只用圆点颜色表示,类型名在悬停提示里) */
  let ivEvent = '';
  if (name) {
    // 国家面板"相关事件"旁的"全部 ›" = 打开概览的编年史页、只看这国;收起概览再下干预
    await page.click('.inspector [data-act=chronicle]');
    insChron = await page.locator('.ov-root:not([hidden]) .chron-pick select').evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.text ?? '').catch(() => '');
    await closeOverview();
    const prev = await page.evaluate(() => (window as any).__wfResim?.seq ?? 0);
    await page.click('.inspector [data-act=intervene]');
    await page.click('.inspector .cp-cmd[data-cmd=protect]');
    await pushOrders(page);
    await page.waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prev, { timeout: 20000 }).catch(() => null);
    resim = await page.evaluate(() => (window as any).__wfResim ?? null);
    await page.waitForTimeout(300);
    tl = await page.locator('.timebar .tb-year').innerText().catch(() => '');
    playing = (await page.locator('.timebar .tb-play.on').count()) > 0;
    if (playing) await page.click('.timebar button.tb-play'); // 暂停,下面在地图上重新点开这个国家读面板
    orders = await page.locator('.timebar .tb-order').count();
    // 已生效的提示(带撤销)
    ivToast = await toastText(page, 'resim-done');
    // 放得快,停下时已经过了好些年:这国后来的大事会把干预那条挤出面板(只列最近 5 件)。按 G 打年份,跳到干预的下一年;
    // 打不了的话按 ← 一次退 10 年,退到干预那年附近(不退到干预那年之前:那时面板里还没有这条)
    await page.keyboard.press('g');
    const jumpIn = page.locator('.timebar .jy-in');
    if (await jumpIn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await jumpIn.fill(String(Y + 1));
      await jumpIn.press('Enter');
      await page.waitForTimeout(300);
    }
    for (let i = 0; i < 20; i++) {
      const y = Number((await page.locator('.timebar .tb-year').innerText().catch(() => '')).replace(/[^\d]/g, ''));
      if (!(y >= Y + 10)) break;
      await page.keyboard.press('ArrowLeft');
      await page.waitForTimeout(150);
    }
    const again = await reopen();
    // 还活着:没有"结局"一行,小字是"N 年立国"
    aliveAfter = again ? (again.includes('结局') ? `还是亡了(${again.replace(/\n/g, ' ').slice(0, 80)})` : '至今还在') : '';
    events = await page.locator('.inspector .cp-events').innerText().catch(() => '');
    ivEvent = await page.locator('.inspector .cp-events .cp-ev[data-ev=order][title=干预]').innerText().catch(() => '');
    await page.keyboard.press('Escape');
    await openOverview(page, 'chronicle');
    chron = await page.locator('.chronicle').innerText().catch(() => '');
    await page.click('.ov-tab[data-tab=interventions]');
    listed = await page.locator('.ov-ivs .ov-iv').count();
    await closeOverview();
  }
  console.log(
    `干预:「${name}」原本第 ${fellAt} 年亡 → 点"保护" → 重推 ${resim ? `${resim.paintedMs.toFixed(0)} ms(线程里 ${resim.workerMs.toFixed(0)} ms)` : '没完成'};` +
      `面板「${aliveAfter}」;时间轴 ${tl}${playing ? '(在放)' : '(停着)'}、「令」${orders} 枚;提示条「${ivToast}」;概览里干预 ${listed} 条;` +
      `面板的"全部 ›"打开概览、只看「${insChron}」;面板相关事件里有干预 ${ivEvent.includes('自此不亡')};编年史里有干预 ${/干预\s+[^\n]*自此不亡/.test(chron)}`,
  );
  if (!name) errs.push('干预:没在地图上点到一个后来会亡的国家');
  else {
    if (!resim) errs.push('干预:点"保护"后没有重推');
    if (!aliveAfter.includes('至今')) errs.push(`干预:加了"保护"以后「${name}」还是亡了(${aliveAfter})`);
    if (!ivEvent.includes('自此不亡')) errs.push(`干预:国家面板的相关事件里没有这条干预(${events.replace(/\n/g, ' ')})`);
    if (!/干预\s+[^\n]*自此不亡/.test(chron)) errs.push('干预:编年史里没有记这条干预');
    if (!insChron || insChron === '全部国家') errs.push(`干预:面板里点"全部 ›"没有打开概览的编年史页、只看这国(${insChron})`);
    const ty = Number(tl.match(/\d+/)?.[0] ?? NaN);
    if (!(ty >= Y && ty <= Y + 40) || !playing) errs.push(`干预:重推完时间轴没有从干预那一年(${Y})接着放(${tl}${playing ? '' : ',没在放'})`);
    if (orders !== 1) errs.push(`干预:时间轴上应有 1 枚「令」(${orders})`);
    if (listed !== 1) errs.push(`干预:概览里的干预列表应有 1 条(${listed})`);
    if (!/保护.+,已从 \d+ 年起重新推演.*撤销/.test(ivToast)) errs.push(`干预:重推完顶部没有"保护…,已从 N 年起重新推演"(带撤销)的提示(${ivToast})`);
    // 推演只要比播放快(每秒 80 年以上),整局重推不用卡得太紧
    const RESIM_BUDGET = process.env.CI ? 4000 : 1600;
    if (resim) timing('干预保护:重推到画完', resim.paintedMs, RESIM_BUDGET);
    // 干预也自动存:刷新页面 → 自动恢复修改 → 按存下的干预重推一次
    await page.waitForTimeout(1500);
    await page.reload();
    await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
    const again = await page
      .waitForFunction(() => ((window as any).__wfResim?.seq ?? 0) > 0, null, { timeout: 20000 })
      .then(() => true, () => false);
    await page.waitForTimeout(300);
    const tlAgain = await page.locator('.timebar .tb-year').innerText().catch(() => '');
    const playAgain = (await page.locator('.timebar .tb-play.on').count()) > 0;
    await openOverview(page, 'interventions');
    const listedAgain = await page.locator('.ov-ivs .ov-iv').count();
    console.log(`干预:刷新后自动恢复、重推 ${again},概览里干预 ${listedAgain} 条;时间轴 ${tlAgain}${playAgain ? '(在放)' : '(停着)'}`);
    if (!again || listedAgain !== 1) errs.push('干预:刷新页面后没有按自动存下的干预重推');
    if (playAgain || tlAgain.replace(/\s/g, '') !== `第${Y}年`) errs.push(`干预:刷新后恢复干预不该动时间轴(网址里的第 ${Y} 年;${tlAgain}${playAgain ? ',在放' : ''})`);
    // "我的干预"里撤销这一条:重推历史,顶部提示"已撤销",列表变成空状态
    const prevU = await page.evaluate(() => (window as any).__wfResim?.seq ?? 0);
    await page.click('.ov [data-act=iv-undo]');
    const undone = await page
      .waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prevU, { timeout: 20000 })
      .then(() => true, () => false);
    const undoToast = await toastText(page, 'resim-done');
    const emptyAfter = await page.locator('.ov [data-empty=interventions]').count();
    const tabAfter = (await page.locator('.ov-tab[data-tab=interventions]').innerText()).trim();
    await closeOverview();
    console.log(`干预:概览里撤销 → 重推 ${undone},提示「${undoToast}」,列表空 ${emptyAfter === 1},页签「${tabAfter}」`);
    if (!undone || !undoToast.includes('已撤销') || emptyAfter !== 1 || tabAfter !== '我的干预 0') errs.push(`干预:概览里撤销不对(重推 ${undone},提示「${undoToast}」,页签「${tabAfter}」)`);
  }
  await page.evaluate(() => localStorage.clear());
}

// 国家面板:点国家 → 暂停、地图飞过去(疆域在面板左边)、国都圆环;信息页(三格数字、朝代条、疆域、邻国、相关事件、2×2 按钮)
// → 干预历史 → 干预页(生效年份、十五条命令)→ 宣战:只有相邻国家浮出名牌 → Esc 回到干预页 → 结盟:地图压暗、提示条"选择与…结盟的国家"、
// 悬停名牌反色、悬停国土"点击选择" → 点名牌 → 推演时面板藏起,推完面板还在(回到信息页)、地图飞回这国、"…结盟,已从 N 年起重新推演"带撤销、
// 从 N 年接着放 → 撤销 →"已撤销"
if (part('国家面板')) {
  type Plate = { kind: string; id: number; text: string; note: string; x: number; y: number; on: boolean; self: boolean };
  type Pick = { kind: string; id: number; text: string; x: number; y: number };
  const Y = 2600;
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${dev.url}/?seed=7&civYear=${Y}`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  const plates = () => page.evaluate('window.__wfPlates()') as Promise<Plate[]>;
  const pol = ((await page.evaluate('window.__wfPickables()')) as Pick[])
    .filter((q) => q.kind === 'polity' && q.x > 300 && q.x < vp.width - 500 && q.y > 150 && q.y < vp.height - 180)
    .sort((a, b) => Math.abs(a.x - vp.width / 2) - Math.abs(b.x - vp.width / 2))[0];
  let info = '';
  let flown = '';
  let mark = false;
  let near: string[] = [];
  let cmds = 0;
  let cmdText = '';
  let untilText = '';
  let untilOff = false;
  let warPlates: Plate[] = [];
  let backToCmd = false;
  let dim = 0;
  let allyPlates: Plate[] = [];
  let pickToast = '';
  let hiddenWhilePicking = false;
  let plateOn = false;
  let hoverVerdict = '';
  let doneToast = '';
  let panelAfter = -1;
  let infoAfter = false;
  let kPick = NaN;
  let kAfter = NaN;
  let tlAfter = '';
  let playingAfter = false;
  let undoToast = '';
  let moved = false;
  if (pol) {
    const v0 = await page.evaluate(() => (window as any).__wfView);
    await page.mouse.click(pol.x, pol.y);
    await page.waitForTimeout(900);
    const v1 = await page.evaluate(() => (window as any).__wfView);
    flown = `k ${v0.k.toFixed(2)} → ${v1.k.toFixed(2)},中心经度 ${v0.lon.toFixed(1)}° → ${v1.lon.toFixed(1)}°`;
    moved = Math.abs(v1.k - v0.k) > 0.01 || Math.abs(((v1.lon - v0.lon + 540) % 360) - 180) > 0.5 || Math.abs(v1.y - v0.y) > 2;
    info = (await page.locator('.inspector').innerText().catch(() => '')).replace(/\n/g, ' / ');
    mark = await page.locator('.tp-mark .tp-ring').isVisible().catch(() => false);
    // 「邻国」那一行(前面可能还有「藩属」「盟国」,也是 .cp-links)
    near = await page.locator('.inspector .cp-grid').locator('xpath=./span[contains(@class,"cp-k") and normalize-space()="邻国"]/following-sibling::span[1]').first().locator('.ins-link').allInnerTexts();
    // 干预页
    await page.click('.inspector [data-act=intervene]');
    cmds = await page.locator('.inspector .cp-cmd').count();
    cmdText = (await page.locator('.inspector .cp-from').first().innerText().catch(() => '')).replace(/\n/g, ' ');
    // 持续到:选「到某一年」多出年份,切回「一直有效」收起(后面的结盟照旧一直有效)
    await page.click('.inspector .cp-until [data-act=until-on]');
    untilText = (await page.locator('.inspector .cp-until').innerText().catch(() => '')).replace(/\n/g, ' ');
    await page.click('.inspector .cp-until [data-act=until-off]');
    untilOff = !(await page.locator('.inspector .cp-until .cp-from-row').count());
    // 宣战:只有相邻的国家浮出名牌;Esc 回到干预页
    if (await page.locator('.inspector .cp-cmd[data-cmd=declare]').isEnabled()) {
      await page.click('.inspector .cp-cmd[data-cmd=declare]');
      await page.waitForTimeout(900);
      warPlates = await plates();
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    backToCmd = (await page.locator('.inspector .cp[data-tab=cmd]').isVisible().catch(() => false)) && !(await page.locator('.tp-dim').count());
    // 结盟:地图压暗、名牌、提示条
    await page.click('.inspector .cp-cmd[data-cmd=ally]');
    await page.waitForTimeout(900);
    dim = await page.locator('.tp-dim').count();
    allyPlates = await plates();
    kPick = await page.evaluate(() => (window as any).__wfView.k);
    pickToast = await toastText(page, 'pick');
    hiddenWhilePicking = (await insHidden(page));
    // 悬停在目标国的国土上(名牌四周绕几圈找):悬停卡片写"点击选择",名牌反色。
    // 离屏幕正中近的先试;名牌离国土远的小岛国找不着,就换下一个
    const cands = allyPlates.filter((p) => !p.self).sort((a, b) => Math.abs(a.x - vp.width / 2) - Math.abs(b.x - vp.width / 2));
    let tgt = cands[0];
    search: for (const c of cands.slice(0, 4))
      for (const r of [12, 20, 30, 50, 80, 120])
        for (let a = 0; a < 8; a++) {
          await page.mouse.move(c.x + r * Math.cos((a * Math.PI) / 4), c.y + r * Math.sin((a * Math.PI) / 4));
          await page.waitForTimeout(80);
          hoverVerdict = await hoverText(page);
          if (hoverVerdict.includes(c.text)) {
            tgt = c;
            break search;
          }
        }
    if (tgt) {
      await page.mouse.move(tgt.x, tgt.y);
      await page.waitForTimeout(150);
      plateOn = (await plates()).some((p) => p.id === tgt.id && p.on);
      const prev = await page.evaluate(() => (window as any).__wfResim?.seq ?? 0);
      await page.mouse.click(tgt.x, tgt.y);
      await pushOrders(page);
      await page.waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prev, { timeout: 20000 }).catch(() => null);
      await page.waitForTimeout(300);
      doneToast = await toastText(page, 'resim-done');
      // 提示条 7 秒就收,后面要点它的"撤销":先记下时间轴、停下播放(放着的时候每一步都慢),再看面板和地图
      tlAfter = await page.locator('.timebar .tb-year').innerText().catch(() => '');
      playingAfter = (await page.locator('.timebar .tb-play.on').count()) > 0;
      if (playingAfter) await page.click('.timebar .tb-play').catch(() => {});
      panelAfter = await page.locator('.inspector:not(.hidden)').count();
      infoAfter = await page.locator('.inspector .cp[data-tab=info]').isVisible().catch(() => false);
      // 选对象时地图缩回了整张图:推完飞回这个国家
      await page.waitForFunction((k0) => (window as any).__wfView.k > k0 + 0.01, kPick, { timeout: 3000 }).catch(() => null);
      kAfter = await page.evaluate(() => (window as any).__wfView.k);
      // 撤销
      const prev2 = await page.evaluate(() => (window as any).__wfResim?.seq ?? 0);
      await page.click('.toast[data-toast=resim-done] .toast-act').catch(() => {});
      await page.waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prev2, { timeout: 20000 }).catch(() => null);
      await page.waitForTimeout(300);
      undoToast = await toastText(page, 'resim-done');
    }
  }
  const warNames = warPlates.filter((p) => !p.self).map((p) => p.text);
  console.log(
    `国家面板:点「${pol?.text}」→ 飞过去 ${flown};国都圆环 ${mark};面板「${info.slice(0, 160)}…」;` +
      `干预页 ${cmds} 条命令、「${cmdText}」;宣战名牌 ${warNames.join('、') || '—'}(邻国 ${near.join('、') || '—'});Esc 回到干预页 ${backToCmd};` +
      `结盟:压暗 ${dim}、名牌 ${allyPlates.length} 个、提示条「${pickToast}」、面板藏起 ${hiddenWhilePicking}、悬停「${hoverVerdict}」、名牌反色 ${plateOn};` +
      `点名牌 →「${doneToast}」,面板 ${panelAfter} 个${infoAfter ? '(信息页)' : ''},地图 k ${kPick.toFixed(2)} → ${kAfter.toFixed(2)},时间轴 ${tlAfter}${playingAfter ? '(在放)' : '(停着)'};撤销 →「${undoToast}」`,
  );
  if (!pol) errs.push('国家面板:没找到能点的国家');
  else {
    if (!/ \/ 国家，/.test(info) || !['国都', '疆域', '州', '人口', '主体民族', '邻国', '大事', '干预历史', '设为中心', '改名', '更多'].every((w) => info.includes(w)))
      errs.push(`国家面板:信息页内容不全(${info.slice(0, 200)})`);
    if (!moved) errs.push(`国家面板:点国家后地图没有飞过去(${flown})`);
    if (!mark) errs.push('国家面板:选中国家后国都没有圆环');
    if (cmds !== 18 || !/生效年份.*年.*该年之前的历史不变/.test(cmdText)) errs.push(`国家面板:干预页不对(${cmds} 条命令,「${cmdText}」)`);
    if (!/持续到.*到某一年.*\d+.*年.*只对保护、保住王室、禁止扩张、结盟有效/.test(untilText) || !untilOff) errs.push(`国家面板:「持续到」不对(「${untilText}」,切回一直有效后收起 ${untilOff})`);
    if (warNames.some((n) => !near.includes(n))) errs.push(`国家面板:宣战时浮出了不相邻国家的名牌(${warNames.join('、')};邻国 ${near.join('、')})`);
    if (!backToCmd) errs.push('国家面板:选目标时按 Esc 没有回到干预页');
    if (!dim || allyPlates.length < 3 || !allyPlates.some((p) => p.self && p.note === '本国')) errs.push(`国家面板:结盟选目标时没有压暗 / 名牌不对(压暗 ${dim},名牌 ${allyPlates.length})`);
    if (!/^选择与.+结盟的国家 \d+ 年起生效 取消 · Esc$/.test(pickToast)) errs.push(`国家面板:选目标的提示条不对(${pickToast})`);
    if (!hiddenWhilePicking) errs.push('国家面板:选目标时面板没有收起');
    if (!/点击选择/.test(hoverVerdict)) errs.push(`国家面板:选目标时悬停可选的国家没有"点击选择"(${hoverVerdict})`);
    if (!plateOn) errs.push('国家面板:鼠标移到可选目标上名牌没有反色');
    if (!/^.+与.+结盟,已从 \d+ 年起重新推演( \d+ 年时它叫.+)? 撤销$/.test(doneToast)) errs.push(`国家面板:下令后没有"…结盟,已从 N 年起重新推演"带撤销(${doneToast})`);
    if (panelAfter !== 1 || !infoAfter) errs.push(`国家面板:下令推完面板应留着、回到信息页(面板 ${panelAfter} 个,信息页 ${infoAfter})`);
    if (!(kAfter > kPick + 0.01)) errs.push(`国家面板:结盟推完地图没有飞回这个国家(k ${kPick.toFixed(2)} → ${kAfter.toFixed(2)})`);
    const ty = Number(tlAfter.match(/\d+/)?.[0] ?? NaN);
    if (!(ty >= Y - 1 && ty <= Y + 40) || !playingAfter) errs.push(`国家面板:下令后没有从生效年份接着放(${tlAfter}${playingAfter ? '' : ',没在放'})`);
    if (!/^已撤销/.test(undoToast)) errs.push(`国家面板:撤销后没有"已撤销"(${undoToast})`);
  }
  await page.evaluate(() => localStorage.clear());
}

// 政体和朝政页:国家卡片「国都」下面一行「政体」(政体名 + 哪年起),点了换成朝政页:政体名(大字)、为什么叫这个、
// 征税 / 兵制 / 官制三条分段条(现在那档亮着,各一句)、共用的"地方 ↔ 朝廷"轴;「历次改制」一条时间条 + 一条一行,点一条打开编年史;
// 拖时间轴(换年份)政体跟着变;够不上议事的小国(没有「朝政」一行)也能点「政体」进朝政页
if (part('政体和朝政页')) {
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.goto(`${dev.url}/?seed=7`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  const rowText = () => page.locator('.inspector .ct-form-row').innerText().then((t) => t.replace(/\s+/g, ' '), () => '');
  const pickPolity = async (id: number) => {
    await page.evaluate((i) => (window as any).__wfSelect('polity', i), id);
    await page.locator(`.inspector .cp[data-polity="${id}"] .cp-k`).first().waitFor({ timeout: 10000 });
  };
  const changeRows = page.locator('.inspector [data-sec=form-changes] [data-act=form-change]');
  // 挑前几国里改过制的那一国(历次改制除了立国还有几条):不认死某一国,推演改了历史也照样能查
  let id = -1;
  let row = '';
  let ms = NaN;
  for (let i = 0; i < 12 && id < 0; i++) {
    await pickPolity(i);
    row = await rowText();
    const t0 = performance.now();
    await page.click('.inspector [data-act=court-form]');
    await page.locator('.inspector .ct-page .ct-gov').waitFor({ timeout: 5000 }).catch(() => {});
    ms = performance.now() - t0;
    if ((await changeRows.count()) >= 3) id = i;
    else await page.click('.inspector [data-act=court-back]').catch(() => {});
  }
  timing('点「政体」→ 朝政页', ms, 800);
  const name = row.split(' ')[0];
  const gov = (await page.locator('.inspector .ct-gov').innerText().catch(() => '')).replace(/\s+/g, ' ');
  // 征税、兵制、官制一块,继任、议政、参与一块(.ct-bars2),各三条、一条轴
  const segs = await page.locator('.inspector .ct-bars:not(.ct-bars2) .ct-seg').count();
  const lit = await page.locator('.inspector .ct-bars:not(.ct-bars2) .ct-seg span.on').allInnerTexts();
  const says = await page.locator('.inspector .ct-bars:not(.ct-bars2) .ct-say').allInnerTexts();
  const axis = (await page.locator('.inspector .ct-bars:not(.ct-bars2) .ct-axis').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const segs2 = await page.locator('.inspector .ct-bars2 .ct-seg').count();
  const lit2 = await page.locator('.inspector .ct-bars2 .ct-seg span.on').allInnerTexts();
  const axis2 = (await page.locator('.inspector .ct-bars2 .ct-axis').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const changes = (await changeRows.allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  const bar = await page.locator('.inspector [data-sec=form-changes] .ct-tbar i').count();
  // 最近两次改制的年份;拖到这两次中间,政体应是最近那次改之前的名字
  const ys = (await changeRows.locator('.ct-y').allInnerTexts()).map(Number);
  const from = changes[0]?.match(/(\S+) → /)?.[1] ?? '';
  const mid = Math.floor((ys[0] + ys[1]) / 2);
  await changeRows.first().click().catch(() => {});
  const chron = await page.locator('.ov-root:not([hidden]) .ov').isVisible({ timeout: 3000 }).catch(() => false);
  if (chron) await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  let early = '';
  if (id >= 0 && Number.isFinite(mid)) {
    await page.evaluate(() => localStorage.clear());
    await page.goto(`${dev.url}/?seed=7&civYear=${mid}`);
    await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
    await pickPolity(id);
    early = await rowText();
  }
  // 够不上议事的小国(没有「朝政」一行)也有「政体」,点得进朝政页
  const small = ((await page.evaluate('window.__wfPickables()')) as { kind: string; id: number }[]).filter((q) => q.kind === 'polity').map((q) => q.id);
  let smallRow = '';
  let smallPage = '';
  // 先在能点的国名里挨个看(前 40 个);都够得上议事(小国的名字常常没标在图上)就按国家编号挨个选:这一年还在、有「政体」一行的
  const tryPolity = async (q: number, quick: boolean) => {
    if (quick) await pickPolity(q);
    else {
      await page.evaluate((i) => (window as any).__wfSelect('polity', i), q);
      if (!(await page.locator(`.inspector .cp[data-polity="${q}"] .cp-k`).first().waitFor({ timeout: 1500 }).then(() => true, () => false))) return false;
    }
    if (await page.locator('.inspector [data-act=court]').count()) return false;
    const r = await rowText();
    if (!r) return false;
    smallRow = r;
    await page.click('.inspector [data-act=court-form]').catch(() => {});
    smallPage = (await page.locator('.inspector .ct-page').innerText({ timeout: 3000 }).catch(() => '')).replace(/\s+/g, ' ');
    return true;
  };
  let found = false;
  for (const q of small.slice(0, 40)) if ((found = await tryPolity(q, true))) break;
  for (let q = 0; q < 150 && !found; q++) found = await tryPolity(q, false);
  console.log(
    `政体和朝政页:第 ${id} 国「${row}」→ 朝政页「${gov}」,${segs} 条分段条亮着「${lit.join('、')}」,轴「${axis}」;` +
      `历次改制 ${changes.length} 条、时间条 ${bar} 段(最新「${(changes[0] ?? '').slice(0, 60)}」),点了打开编年史 ${chron};` +
      `拖到 ${mid} 年「${early}」(应是${from});小国「${smallRow}」→「${smallPage.slice(0, 80)}…」`,
  );
  if (id < 0) errs.push('政体和朝政页:前 12 国里没找到改过制的国家');
  else {
    if (!/^\S+ \d+ 年起$/.test(row)) errs.push(`政体和朝政页:国家卡片「政体」一行不对(${row})`);
    if (gov !== row) errs.push(`政体和朝政页:朝政页上面的政体名、哪年起和卡片上的对不上(${gov} / ${row})`);
    if (segs !== 3 || lit.length !== 3 || says.length !== 3 || says.some((x) => !x.trim())) errs.push(`政体和朝政页:征税、兵制、官制三条不全(${segs} 条,亮着 ${lit.join('、')},${says.length} 句)`);
    if (axis !== '地方说了算 朝廷说了算') errs.push(`政体和朝政页:三条下面的轴不对(${axis})`);
    if (segs2 !== 3 || lit2.length !== 3) errs.push(`政体和朝政页:继任、议政、参与三条不全(${segs2} 条,亮着 ${lit2.join('、')})`);
    if (axis2 !== '少数人说了算 众人说了算') errs.push(`政体和朝政页:继任、议政、参与下面的轴不对(${axis2})`);
    if (bar !== changes.length || !(changes[0] ?? '').includes(`→ ${name}`) || !(ys[0] >= ys[1])) errs.push(`政体和朝政页:历次改制不对(${changes.length} 条、时间条 ${bar} 段;${changes[0]})`);
    if (!chron) errs.push('政体和朝政页:点历次改制的一条没有打开编年史');
    if (!from || !early.startsWith(`${from} `)) errs.push(`政体和朝政页:拖到 ${mid} 年政体没跟着变(${early},应是${from})`);
  }
  if (!/^\S+ \d+ 年起$/.test(smallRow) || !/征税.*兵制.*官制.*历次改制/.test(smallPage)) errs.push(`政体和朝政页:小国的「政体」点不进朝政页(${smallRow};${smallPage.slice(0, 80)})`);
  await page.evaluate(() => localStorage.clear());
}

// 编辑地形(新建世界时):陆地笔在大洋中间涂一笔 → 重新生成后那里成了陆地,"画了 1 笔";撤销 → 又是海;重做 → 又是陆地;
// 海 + 圈起来填满圈住那一片(画的时候地图下边有一句提示)→ 又沉成海;河画一条;关掉"在地图上显示草图"地图上不画草图;
// 全部清除(点两下)→ "还没画",那里回到原来的海
if (part('编辑地形')) {
  const ectx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const ep = await ectx.newPage();
  ep.on('pageerror', (e) => errs.push(`编辑地形:${e.message}`));
  await ep.goto(`${dev.url}/?new=1&seed=7&play=0`);
  await ep.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await terrainOn(ep);
  const toClient = async (x: number, y: number) => (await ep.evaluate(([a, b]) => (window as any).__wfWorldToClient(a, b), [x, y])) as [number, number];
  const regen = async (act: () => Promise<unknown>) => {
    const prev = await ep.evaluate(() => (window as any).__wfTerrain?.id ?? 0);
    await act();
    return ep.waitForFunction((p) => ((window as any).__wfTerrain?.id ?? 0) > p, prev, { timeout: 30000 }).then(() => true, () => false);
  };
  // 种子 7 大洋中间的一处海(和下面改地形那段同一处)
  const at = async () => {
    const [x, y] = await toClient(1205, 577);
    await ep.mouse.move(x + 1, y);
    await ep.mouse.move(x, y);
    await ep.waitForTimeout(200);
    return (await probe(ep, x, y)).split(' / ')[1] ?? '';
  };
  const press = async (pts: [number, number][]) => {
    const q = await Promise.all(pts.map(([x, y]) => toClient(x, y)));
    await ep.mouse.move(...q[0]);
    await ep.mouse.down();
    for (const [x, y] of q.slice(1)) await ep.mouse.move(x, y, { steps: 6 });
  };
  const count = () => ep.locator('.tp .tp-n').innerText().catch(() => '');
  const sea0 = await at();
  const painted = await regen(async () => {
    await press([
      [1165, 577],
      [1205, 579],
      [1245, 577],
    ]);
    await ep.mouse.up();
  });
  const land = await at();
  const c1 = await count();
  const undone = await regen(() => ep.click('.tp [data-act=terrain-undo]'));
  const sea1 = await at();
  const redone = await regen(() => ep.click('.tp [data-act=terrain-redo]'));
  const land2 = await at();
  await ep.click('.tp [data-tool=sea]');
  await ep.click('[data-act=terrain-method] [data-v=lasso]');
  let cap = '';
  const lassoed = await regen(async () => {
    await press([
      [1150, 540],
      [1260, 540],
      [1260, 620],
      [1150, 620],
    ]);
    cap = await ep.locator('.tp-cap:not(.off)').innerText().catch(() => '');
    await ep.mouse.up();
  });
  const sea2 = await at();
  const c2 = await count();
  await ep.click('.tp [data-tool=river]');
  const rivered = await regen(async () => {
    await press([
      [1300, 300],
      [1330, 350],
      [1340, 400],
    ]);
    await ep.mouse.up();
  });
  const c3 = await count();
  const marks = await ep.locator('.terrain-overlay .sk-mark, .terrain-overlay .tt-mark').count();
  const riverLine = await ep.locator('.terrain-overlay .tt-river').count();
  await ep.click('[data-act=terrain-show]');
  const marksOff = await ep.locator('.terrain-overlay .sk-mark, .terrain-overlay .tt-mark').count();
  await ep.click('.tp [data-act=terrain-clear]');
  const cleared = await regen(() => ep.click('.tp [data-act=terrain-clear]'));
  const c0 = await count();
  const sea3 = await at();
  console.log(
    `编辑地形:海「${sea0}」→ 涂一笔陆地 ${painted}「${land}」「${c1}」→ 撤销 ${undone}「${sea1}」→ 重做 ${redone}「${land2}」;` +
      `海 + 圈起来填满 ${lassoed}「${sea2}」「${c2}」(画的时候提示「${cap}」);画河 ${rivered}「${c3}」、地图上 ${marks} 处记号(河 ${riverLine} 条),关掉显示 → ${marksOff};` +
      `全部清除 ${cleared}「${c0}」「${sea3}」`,
  );
  if (!sea0.includes('水深')) errs.push(`编辑地形:测试点原本应该是海(${sea0})`);
  if (!painted || !land.includes('海拔') || c1 !== '画了 1 笔') errs.push(`编辑地形:海里涂一笔陆地没长出陆地 / 计数不对(${painted},${land},${c1})`);
  if (!undone || !sea1.includes('水深') || !redone || !land2.includes('海拔')) errs.push(`编辑地形:撤销 / 重做不对(${undone} ${sea1},${redone} ${land2})`);
  if (!lassoed || !sea2.includes('水深') || c2 !== '画了 2 笔' || !cap.includes('圈里整片变成海')) errs.push(`编辑地形:圈起来填满的海没沉下去 / 计数、提示不对(${lassoed},${sea2},${c2},${cap})`);
  if (!rivered || c3 !== '画了 3 笔' || riverLine !== 1 || marks < 3 || marksOff !== 0) errs.push(`编辑地形:画河 / 地图上的草图显示不对(${rivered},${c3},${riverLine},${marks},${marksOff})`);
  if (!cleared || c0 !== '还没画' || !sea3.includes('水深')) errs.push(`编辑地形:全部清除以后没回到原来的样子(${cleared},${c0},${sea3})`);
  await ectx.close();
}

// 改地形(阶段 4):只在新建世界时能改。新建界面左边点"编辑地形" → 卡片里换成编辑地形的工具、星球摊成平面 → 选火山,在海里点一下放一座 → 后台按新地形重新生成 →
// 那里成了陆地(悬停显示海拔);撤销 → 又变回海,再放一次;"完成"收起工具;动过的新建世界存下来了,刷新后自动恢复(直接带着地形修改生成);
// 创建以后没有改地形的入口,概览"世界设定"页写着改过的地形;分享链接在另一个浏览器里打开,地形修改在(也是直接带着修改生成)
if (part('改地形')) {
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${dev.url}/?new=1&seed=7&style=fantasy`);
  await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  // 种子 7 大洋中间的一处海(世界坐标;生成算法换代、这里成了陆地时改它)
  const at = async (p = page) => {
    const r = (await p.locator('.map-box').boundingBox())!;
    return [r.x + (1205 / 2048) * r.width, r.y + (577 / 1024) * r.height] as const;
  };
  const probeSea = async (p = page) => {
    const [x, y] = await at(p);
    await p.mouse.move(x + 1, y);
    await p.mouse.move(x, y);
    await p.waitForTimeout(200);
    return probe(p, x, y);
  };
  const regen = async (act: () => Promise<unknown>) => {
    const prev = await page.evaluate(() => (window as any).__wfTerrain?.id ?? 0);
    await act();
    await page.waitForFunction((p) => ((window as any).__wfTerrain?.id ?? 0) > p, prev, { timeout: 30000 }).catch(() => null);
    return page.evaluate(() => (window as any).__wfTerrain ?? null) as Promise<{ id: number; paintedMs: number; workerMs: number } | null>;
  };
  const volcano = () =>
    regen(async () => {
      const [x, y] = await at();
      await page.mouse.click(x, y);
    });
  const urlBefore = page.url();
  const before = await probeSea();
  await terrainOn();
  await page.click('.tp [data-tool=volcano]');
  const panel = await page.locator('.tp').innerText().catch(() => '');
  const barBox = await page.locator('.tp').boundingBox();
  const sideBox = await page.locator('.st-left').boundingBox();
  const t = await volcano();
  const after = await probeSea();
  const count = await page.locator('.tp .tp-n').innerText().catch(() => '');
  // 重新生成的结果照旧走顶部提示条(在地图那一块,不压侧栏)
  const tBox = await page.locator('.toast[data-toast=terrain]').boundingBox().catch(() => null);
  console.log(
    `改地形:工具 ${barBox ? `${Math.round(barBox.width)}×${Math.round(barBox.height)} @ ${Math.round(barBox.x)},${Math.round(barBox.y)}` : '没出来'};` +
      `海里点火山 → 重新生成 ${t ? `${t.paintedMs.toFixed(0)} ms(线程里 ${t.workerMs.toFixed(0)} ms)` : '没完成'};` +
      `之前「${before.split(' / ')[1] ?? ''}」→ 之后「${after.split(' / ')[1] ?? ''}」;工具「${count}」;提示条在 ${tBox ? `${Math.round(tBox.x)},${Math.round(tBox.y)}` : '-'}`,
  );
  if (!['陆地', '山地', '群岛', '擦掉', '火山', '湖', '河', '撤销', '重做', '完成'].every((w) => panel.includes(w))) errs.push(`改地形:进入后卡片里没有编辑地形的工具(${panel})`);
  if (!barBox || !sideBox || barBox.x < sideBox.x || barBox.x + barBox.width > sideBox.x + sideBox.width + 1) errs.push('改地形:工具应在左边的新建卡片里');
  if (tBox && sideBox && tBox.x < sideBox.x + sideBox.width) errs.push('改地形:提示条压在侧栏卡片上');
  if (!count.includes('画了 1 笔')) errs.push(`改地形:工具里的计数不对(${count})`);
  if (!before.includes('水深')) errs.push(`改地形:测试点原本应该是海(${before})`);
  if (!t) errs.push('改地形:放了火山以后没有重新生成');
  else {
    if (!after.includes('海拔')) errs.push(`改地形:海里放了火山,重新生成后那里没变成陆地(${after})`);
    // 从点下去到新地图画好(线程里生成 + 文明 + 铺像素约 0.8–1 秒,主线程画手绘底图、文字约 0.6 秒);
    // 机器负载高时单次能慢到 2.5 秒,CI 虚拟机再慢两倍
    const BUDGET = process.env.CI ? 6000 : 3000;
    timing('改地形:重新生成到画完', t.paintedMs, BUDGET);
    // 撤销:又变回海;再放一次
    const u = await regen(() => page.click('.tp [data-act=terrain-undo]'));
    const undone = await probeSea();
    const t2 = await volcano();
    // "完成":工具收起,左边「地形」那行写着画了几笔
    await page.click('.tp [data-act=terrain-done]');
    await page.waitForTimeout(200);
    const barGone = !(await page.locator('.tp').count());
    const row = (await page.locator('.nw-body [data-act=terrain]').innerText().catch(() => '')).replace(/\n/g, ' ');
    console.log(`改地形:撤销 → 「${undone.split(' / ')[1] ?? ''}」;再放一次 ${!!t2};点"完成"工具收起 ${barGone}、卡片上「${row}」`);
    if (!u || !undone.includes('水深')) errs.push(`改地形:撤销后没有变回海(${undone})`);
    if (!barGone) errs.push('改地形:点"完成"后工具没收起');
    if (!row.includes('画了 1 笔')) errs.push(`改地形:收起后左边「地形」那行没写画了几笔(${row})`);
    // 自动存:动过的新建世界存下来了(网址换成 w=编号),刷新后还在新建、直接带着地形修改生成(只生成一次),那里还是陆地
    await page.waitForFunction(() => /[?&]w=w/.test(location.search), null, { timeout: 5000 }).catch(() => {});
    const urlStored = page.url();
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
    await page.waitForTimeout(500);
    const again = await probeSea();
    const regenAfterReload = await page.evaluate(() => (window as any).__wfTerrain ?? null);
    const stillDraft = (await page.locator('.studio .st-left').count()) === 1;
    console.log(
      `改地形:网址 ${urlBefore.split('?')[1]} → ${urlStored.split('?')[1]};刷新后「${again.split(' / ')[1] ?? ''}」、还在新建 ${stillDraft},刷新后又重新生成了 ${regenAfterReload ? '是' : '否'}`,
    );
    if (!/[?&]new=1/.test(urlBefore) || !/[?&]w=w/.test(urlStored) || /[?&]new=1/.test(urlStored)) errs.push(`改地形:新建世界动过以后网址应换成 w=编号(${urlBefore} → ${urlStored})`);
    if (!again.includes('海拔') || !stillDraft) errs.push('改地形:刷新页面后没回到新建 / 地形修改没有自动恢复');
    if (regenAfterReload) errs.push('改地形:刷新后先生成原样再按地形修改重新生成了一遍(应该直接带着修改生成)');
    // 创建:没有改地形的入口了;世界设定页写着改过的地形
    await createNow();
    await page.locator('.sidebar .sb-title').waitFor({ timeout: 10000 }).catch(() => {});
    const noEntry = (await page.locator('[data-act=terrain]').count()) === 0;
    await openOverview(page, 'genesis');
    await page.click('.ov-seg [data-tab=map]');
    const settings = (await page.locator('.ov-settings [data-param=terrain]').innerText().catch(() => '')).replace(/\n/g, ' ');
    await closeOverview();
    console.log(`改地形:创建后改地形入口 ${noEntry ? '没有' : '还在'},世界设定页「${settings}」`);
    if (!noEntry) errs.push('改地形:创建以后还能改地形');
    if (!settings.includes('1 处') || !settings.includes('火山')) errs.push(`改地形:世界设定页没写改过的地形(${settings})`);
    // 分享链接:另一个浏览器(什么都没存)打开,那里是陆地;也是直接带着地形修改生成
    await page.click('.save-btn');
    await page.click('[data-act=share-link]');
    const link = await page.waitForFunction(() => (window as any).__wfShare?.url, null, { timeout: 10000 }).then((h) => h.jsonValue() as Promise<string>, () => '');
    await page.keyboard.press('Escape');
    const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 820 } });
    const p3 = await ctx3.newPage();
    p3.on('pageerror', (e) => errs.push(`改地形分享:${e.message}`));
    let shared = '';
    let regenShared: unknown = null;
    if (link) {
      await p3.goto(link);
      await p3.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
      await p3.waitForTimeout(800);
      // 建好的世界从星球展开时正对的经线接着看,分享链接里带着它:转回 0° 再按世界坐标取那一点(不然那一点可能在窗口外)
      await p3.evaluate(() => (window as any).__wfSetCenter?.(0));
      await p3.waitForFunction(() => Math.abs((window as any).__wfView?.lon ?? 99) < 0.01, null, { timeout: 5000 }).catch(() => {});
      await p3.waitForTimeout(200);
      shared = await probeSea(p3);
      regenShared = await p3.evaluate(() => (window as any).__wfTerrain ?? null);
    }
    console.log(`改地形:分享链接 ${link.length} 字,另一个浏览器打开 →「${shared.split(' / ')[1] ?? ''}」,打开后又重新生成了 ${regenShared ? '是' : '否'}`);
    if (!link.includes('#share=')) errs.push('改地形:只改了地形时分享链接没带修改');
    else if (!shared.includes('海拔')) errs.push(`改地形:带地形修改的分享链接打开后,那里不是陆地(${shared})`);
    if (regenShared) errs.push('改地形:分享链接打开时先生成原样再按地形修改重新生成了一遍(应该直接带着修改生成)');
    await ctx3.close();
  }
  await page.evaluate(() => localStorage.clear());
}

// 干预 · 立国:点一个有主的州 → 详情面板"在这里立国"(起名"饕餮")→ 后台重推 → 地图上那一州归了新国家
if (part('立国')) {
  const Y = 1500;
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=regions&civYear=${Y}`);
  await page.waitForFunction(() => (window as any).__wfLabels?.ready, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const inspector = () =>
    page
      .locator('.inspector')
      .innerText({ timeout: 2000 })
      .catch(() => '');
  // 按网格点地图,找一个详情面板是"州"、写着"属某国"的。
  // 选中以后地图会飞过去:网格先换成世界坐标,每次等地图停稳了再换回屏幕坐标
  const box = (await page.locator('.map-box').boundingBox())!;
  const grid: [number, number][] = [];
  for (let gy = 0.3; gy < 0.8; gy += 0.07)
    for (let gx = 0.2; gx < 0.62; gx += 0.04) {
      const w = (await page.evaluate(([cx, cy]) => (window as any).__wfClientToWorld(cx, cy), [box.x + box.width * gx, box.y + box.height * gy])) as [number, number] | null;
      if (w) grid.push(w);
    }
  let spot: { x: number; y: number; name: string; wx: number; wy: number } | null = null;
  for (const [wx, wy] of grid) {
    if (spot) break;
    {
      // 先关掉上一次的详情面板(它可能正好盖住这一点),和上一下隔开,免得算成双击;等上一下的飞行停下
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      const at = (await page.evaluate(([x, y]) => (window as any).__wfWorldToClient(x, y), [wx, wy])) as [number, number] | null;
      if (!at || at[0] < SIDE_ROOM + 40 || at[0] > page.viewportSize()!.width - 80 || at[1] < 100 || at[1] > page.viewportSize()!.height - 120) continue;
      const [x, y] = at;
      await page.mouse.move(x, y);
      await page.waitForTimeout(150);
      // 点到的是州名(字可能压在邻州上)就不算:悬停信息里这一点所在的州要和面板里的是同一州(点之前量:点了地图就飞走了)
      const hv = await probe(page, x, y);
      await page.mouse.click(x, y);
      await page.waitForTimeout(100);
      // 面板顶部:州名(可能带"恢复默认"),下一行"州，属 某国，…"(州名以外的"第 N 州"只看顶部这两行)
      await page.locator('.inspector .cp-head').waitFor({ timeout: 2000 }).catch(() => {});
      const t = await page
        .evaluate(() => {
          const h = document.querySelector('.inspector .cp-head') as HTMLElement | null;
          const sub = document.querySelector('.inspector .cp-sub') as HTMLElement | null;
          return h ? `${h.innerText}\n${sub?.innerText ?? ''}` : '';
        })
        .catch(() => '');
      const m = /^(.+?)\s*\n(?:\s*恢复默认\s*\n)?\s*州，属(.+?)(?:，|\n|$)/.exec(t.trim());
      const inHover = /第 (\d+) 州/.exec(hv)?.[1];
      const inPanel = [...t.matchAll(/第 (\d+) 州/g)].at(-1)?.[1];
      if (m && inHover && inHover === inPanel && (await page.locator('.inspector [data-act=found]').count())) {
        spot = { x, y, name: m[1], wx, wy };
      }
    }
  }
  let resim: { paintedMs: number; workerMs: number } | null = null;
  let regionAfter = '';
  let onMap = '';
  let listed = '';
  let chron = '';
  if (spot) {
    // 州面板的"在这里立国" → 干预页(生效年份 + 国名)→ "立国"
    await page.click('.inspector [data-act=found]');
    await page.fill('.inspector .cp-field input', '饕餮');
    const prev = await page.evaluate(() => (window as any).__wfResim?.seq ?? 0);
    await page.click('.inspector [data-act=found-go]');
    await pushOrders(page);
    await page.waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prev, { timeout: 20000 }).catch(() => null);
    resim = await page.evaluate(() => (window as any).__wfResim ?? null);
    // 重推完时间轴从立国那年接着放:先停下,看刚立国时的地图(新国家过些年可能又被并回去)
    if (await page.locator('.timebar .tb-play.on').count()) await page.click('.timebar .tb-play');
    await page.waitForTimeout(300);
    regionAfter = (await page.locator('.inspector .ins-status').innerText().catch(() => '')).replace(/\n/g, ' ');
    // 重推完时间轴从立国那年接着放:先停下,免得放到后面这州又被邻国吞了(下面还要在地图上点它)
    if (await page.locator('.timebar .tb-play.on').count()) await page.click('.timebar button.tb-play');
    await openOverview(page, 'interventions');
    listed = (await page.locator('.ov-ivs .ov-iv').allInnerTexts().catch(() => [])).join(' / ').replace(/\n/g, ' ');
    await closeOverview();
    // 换成"政区"图层,在同一处点一下:点到的是新国家(或它的国都)
    await pickLayer(page, 'political');
    await page.waitForTimeout(500);
    // 按世界坐标重新换成屏幕坐标(中间开关过概览、换过图层,地图万一挪动过也能对准)
    const at = (await page.evaluate(([x, y]) => (window as any).__wfWorldToClient(x, y), [spot.wx, spot.wy])) as [number, number] | null;
    // 先看悬停信息(不受文字影响;点下去以后详情面板可能正好盖住这一点)
    await page.mouse.move(at?.[0] ?? spot.x, at?.[1] ?? spot.y);
    await page.waitForTimeout(200);
    const hov = await probe(page, at?.[0] ?? spot.x, at?.[1] ?? spot.y);
    await page.mouse.click(at?.[0] ?? spot.x, at?.[1] ?? spot.y);
    await page.waitForTimeout(300);
    onMap = (await inspector()).replace(/\n/g, ' ').slice(0, 120);
    // 立国以后文字重新排过,那一点上可能正好压着邻州的州名(点到的是字):那就看悬停信息
    if (!onMap.includes('饕餮')) onMap += ` / 悬停 ${hov}`;
    await openOverview(page, 'chronicle');
    chron = await page.locator('.chronicle').innerText().catch(() => '');
    await closeOverview();
  }
  console.log(
    `立国:州「${spot?.name}」→ 点"在这里立国" → 重推 ${resim ? `${resim.paintedMs.toFixed(0)} ms(线程里 ${resim.workerMs.toFixed(0)} ms)` : '没完成'};` +
      `州面板「${regionAfter}」;地图上点同一处「${onMap}」;概览「${listed}」`,
  );
  if (!spot) errs.push('立国:没找到一个有主、能立国的州');
  else {
    if (!resim) errs.push('立国:点"立国"后没有重推');
    if (!regionAfter.includes('属 饕餮')) errs.push(`立国:重推后这州没归新国家(${regionAfter})`);
    if (!onMap.includes('饕餮')) errs.push(`立国:打开"国家"后在地图上点这州,不是新国家(${onMap})`);
    if (!/\d+ 年起.*在.+立国,即饕餮/.test(listed)) errs.push(`立国:概览里的干预列表不对(${listed})`);
    if (!/干预\s+[^\n]*自立,号饕餮/.test(chron)) errs.push('立国:编年史里没有这条干预');
    // 推演只要比播放快(每秒 80 年以上),整局重推不用卡得太紧
    const RESIM_BUDGET = process.env.CI ? 4000 : 1600;
    if (resim) timing('立国:重推到画完', resim.paintedMs, RESIM_BUDGET);
  }
  await page.evaluate(() => localStorage.clear());
}

// 城 / 地理实体 / 州的面板(和国家面板同一套):点一座城 → 城面板(三格、兴衰、历任归属、2×2 按钮)→ "看所属国家"切到国家面板;
// 点一个地名 → 地理实体面板(改名 / 名字由来 / 起名);点一个州 → 州面板 → "划给…" → 干预页 → "选择国家" → 地图压暗、名牌、
// 提示条 → 点名牌 → "…划给…,已从 N 年起重新推演"带撤销,州面板里列出这一州的干预 → 撤销 → "已撤销"、列表没了
if (part('城和州的面板')) {
  type Plate = { kind: string; id: number; text: string; note: string; x: number; y: number; on: boolean; self: boolean };
  type Pick = { kind: string; id: number; text: string; x: number; y: number };
  const Y = 2600;
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${dev.url}/?seed=7&civYear=${Y}`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const vp = page.viewportSize()!;
  const free = (x: number, y: number) => x > SIDE_ROOM + 60 && x < vp.width - 80 && y > 110 && y < vp.height - 150;
  const panel = () =>
    page
      .locator('.inspector')
      .innerText({ timeout: 2000 })
      .then((t) => t.replace(/\n/g, ' / '), () => '');
  const picks = () => page.evaluate('window.__wfPickables()') as Promise<Pick[]>;
  /** 关掉面板、等上一下的飞行停下,再点编号为 id 的东西(按现在的屏幕位置) */
  const clickPick = async (kind: string, id: number): Promise<boolean> => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    const p = (await picks()).find((q) => q.kind === kind && q.id === id && free(q.x, q.y));
    if (!p) return false;
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(300);
    return true;
  };
  // 1. 城(挑一座属某国、不是国都的:"迁都到这里"、"更多"里的"看所属国家"都能点;看得见的城里国都多,多试几座)
  let cityInfo = '';
  let ownerInfo = '';
  let moveCity = -1;
  const marks = (await picks()).filter((q) => q.kind === 'mark' && free(q.x, q.y)).slice(0, 40);
  for (const m of marks) {
    if (!(await clickPick('mark', m.id))) continue;
    if (!(await page.locator('.inspector .cp[data-settlement]').count())) continue;
    if (!(await page.locator('.inspector [data-act=move-here]').isEnabled())) continue;
    await page.click('.inspector [data-act=more]');
    if (!(await page.locator('.inspector [data-act=owner]').isEnabled())) continue;
    moveCity = m.id;
    cityInfo = await panel();
    await page.click('.inspector [data-act=owner]');
    await page.waitForTimeout(300);
    ownerInfo = (await page.locator('.inspector .cp[data-polity]').count()) ? await panel() : '';
    break;
  }
  // 2. 地理实体(地名)
  let placeInfo = '';
  let places = (await picks()).filter((q) => q.kind === 'place' && free(q.x, q.y)).slice(0, 8);
  // 上一步"看所属国家"会飞过去放大,那一带可能一个地名都没有:放回整张地图再挑
  if (!places.length) {
    await page.keyboard.press('Escape');
    await page.evaluate(() => (window as any).__wfSetView({ k: 1, x: 0, y: 0 }));
    await page.waitForTimeout(900);
    places = (await picks()).filter((q) => q.kind === 'place' && free(q.x, q.y)).slice(0, 8);
  }
  for (const q of places) {
    if (!(await clickPick('place', q.id))) continue;
    if (await page.locator('.inspector .cp[data-place]').count()) {
      placeInfo = await panel();
      break;
    }
  }
  // 3. 州:按网格找地图上的点(先用悬停读数看是不是某个州,是才点),找一个面板是"州"、能"划给…"的。
  //    点有国家的州会选中那个国家,所以只点有人住、没有国家的(悬停读数是"部落地带")。
  //    看得见的地方没有,就放回整张地图、转到别的经度再找(换了世界也找得到);找完放回原来的视图(下面还要点那座城)
  let regionInfo = '';
  let cedePage = '';
  let pickToast = '';
  let dim = 0;
  let cedePlates: Plate[] = [];
  let hidden = false;
  let doneToast = '';
  let mineAfter = '';
  let undoToast = '';
  let mineGone = false;
  const v0 = (await page.evaluate(() => (window as any).__wfView)) as { k: number; x: number; y: number; lon: number };
  let turned = false;
  search: for (const lon of [null, 0, 90, 180, 270]) {
    if (lon !== null) {
      turned = true;
      await page.keyboard.press('Escape');
      await page.evaluate((l) => {
        (window as any).__wfSetView({ k: 1, x: 0, y: 0 });
        (window as any).__wfSetCenter(l);
      }, lon);
      await page.waitForTimeout(900);
    }
    const box = (await page.locator('.map-box').boundingBox())!;
    const grid: [number, number][] = [];
    for (let gy = 0.14; gy < 0.82; gy += 0.06)
      for (let gx = 0.15; gx < 0.9; gx += 0.04) {
        const w = (await page.evaluate(([cx, cy]) => (window as any).__wfClientToWorld(cx, cy), [box.x + box.width * gx, box.y + box.height * gy])) as [number, number] | null;
        if (w) grid.push(w);
      }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(700);
    for (const [wx, wy] of grid) {
      const at = (await page.evaluate(([x, y]) => (window as any).__wfWorldToClient(x, y), [wx, wy])) as [number, number] | null;
      if (!at || !free(at[0], at[1])) continue;
      const here = ` / ${await probe(page, at[0], at[1])}`;
      if (!/第 \d+ 州/.test(here) || !here.includes(' / 部落地带')) continue;
      await page.mouse.click(at[0], at[1]);
      await page.waitForTimeout(300);
      if (!(await page.locator('.inspector .cp[data-region] [data-act=cede]').count())) {
        // 点到的是字 / 城:关掉、等地图停稳再试下一处
        await page.keyboard.press('Escape');
        await page.waitForTimeout(700);
        continue;
      }
      regionInfo = await panel();
      await page.click('.inspector [data-act=cede]');
      await page.waitForTimeout(200);
      cedePage = await panel();
      if (!(await page.locator('.inspector [data-act=cede-pick]').isEnabled())) continue;
      await page.click('.inspector [data-act=cede-pick]');
      await page.waitForTimeout(900);
      dim = await page.locator('.tp-dim').count();
      cedePlates = (await page.evaluate('window.__wfPlates()')) as Plate[];
      pickToast = await toastText(page, 'pick');
      hidden = (await insHidden(page));
      const tgt = cedePlates.filter((p) => !p.self).sort((a, b) => Math.abs(a.x - vp.width / 2) - Math.abs(b.x - vp.width / 2))[0];
      if (tgt) {
        const prev = await page.evaluate(() => (window as any).__wfResim?.seq ?? 0);
        await page.mouse.click(tgt.x, tgt.y);
        await pushOrders(page);
        await page.waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prev, { timeout: 20000 }).catch(() => null);
        await page.waitForTimeout(300);
        doneToast = await toastText(page, 'resim-done');
        mineAfter = (await page.locator('.inspector .cp-mine').innerText({ timeout: 2000 }).catch(() => '')).replace(/\n/g, ' ');
        const prev2 = await page.evaluate(() => (window as any).__wfResim?.seq ?? 0);
        await page.click('.toast[data-toast=resim-done] .toast-act').catch(() => {});
        await page.waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prev2, { timeout: 20000 }).catch(() => null);
        await page.waitForTimeout(300);
        undoToast = await toastText(page, 'resim-done');
        mineGone = (await page.locator('.inspector .cp[data-region]').count()) === 1 && !(await page.locator('.inspector .cp-mine').count());
      }
      break search;
    }
  }
  if (turned) {
    await page.keyboard.press('Escape');
    await page.evaluate((v) => {
      (window as any).__wfSetView({ k: v.k, x: v.x, y: v.y });
      (window as any).__wfSetCenter(v.lon);
    }, v0);
    await page.waitForTimeout(900);
  }
  // 4. 城面板"迁都到这里":替所属国下迁都令(和国家干预页同一套)→ 面板收起、推演 → "…迁都…,已从 N 年起重新推演"带撤销 → 撤销。
  //    上一步撤销后时间轴从那一年往后放,第 1 步那座城到时候不一定还标在地图上,不在就从看得见的城里另挑一座能迁都的
  let moveToast = '';
  let moveHidden = false;
  let moveUndo = '';
  const canMove = async (id: number): Promise<boolean> =>
    (await clickPick('mark', id)) &&
    (await page.locator('.inspector .cp[data-settlement]').count()) > 0 &&
    (await page.locator('.inspector [data-act=move-here]').isEnabled().catch(() => false));
  let movable = moveCity >= 0 && (await canMove(moveCity));
  if (moveCity >= 0 && !movable)
    for (const m of (await picks()).filter((q) => q.kind === 'mark' && q.id !== moveCity && free(q.x, q.y)).slice(0, 12))
      if ((movable = await canMove(m.id))) break;
  if (movable) {
    const prev = await page.evaluate(() => (window as any).__wfResim?.seq ?? 0);
    await page.click('.inspector [data-act=move-here]');
    await pushOrders(page);
    await page.waitForTimeout(100);
    moveHidden = (await insHidden(page));
    await page.waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prev, { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(300);
    moveToast = await toastText(page, 'resim-done');
    const prev2 = await page.evaluate(() => (window as any).__wfResim?.seq ?? 0);
    await page.click('.toast[data-toast=resim-done] .toast-act').catch(() => {});
    await page.waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prev2, { timeout: 20000 }).catch(() => null);
    await page.waitForTimeout(300);
    moveUndo = await toastText(page, 'resim-done');
  }
  console.log(
    `城面板「${cityInfo.slice(0, 120)}…」→ 看所属国家「${ownerInfo.slice(0, 40)}」;地理实体面板「${placeInfo.slice(0, 80)}」;` +
      `州面板「${regionInfo.slice(0, 80)}…」→ 划给…「${cedePage.replace(/.*?生效年份/, '生效年份').slice(0, 60)}」→ 压暗 ${dim}、名牌 ${cedePlates.length} 个、提示条「${pickToast}」、面板藏起 ${hidden}` +
      ` → 点名牌「${doneToast}」,这一州的干预「${mineAfter}」→ 撤销「${undoToast}」,列表没了 ${mineGone};` +
      `迁都到这里 → 面板收起 ${moveHidden}、「${moveToast}」→ 撤销「${moveUndo}」`,
  );
  if (!/ \/ 城，\d+ 年建城/.test(cityInfo) || !['级别', '人口', '做过国都', '兴衰', '迁都到这里', '看所属国家', '改名', '名字由来'].every((w) => cityInfo.includes(w)))
    errs.push(`城面板:内容不全(${cityInfo.slice(0, 200)})`);
  if (!/ \/ 国家，/.test(ownerInfo)) errs.push(`城面板:"看所属国家"没有切到国家面板(${ownerInfo.slice(0, 60)})`);
  if (!/ \/ (山脉|河流|湖泊|岛屿|荒漠|海|大洋|海湾)(，| \/ |$)/.test(placeInfo) || !['设为中心', '改名', '更多'].every((w) => placeInfo.includes(w)))
    errs.push(`地理实体面板:没出来 / 内容不全(${placeInfo.slice(0, 120)})`);
  if (!/ \/ 州，/.test(regionInfo) || !['主体民族', '宜居度', '在这里立国', '划给…', '改名', '更多'].every((w) => regionInfo.includes(w)))
    errs.push(`州面板:没出来 / 内容不全(${regionInfo.slice(0, 160)})`);
  if (!/生效年份.*该年之前的历史不变.*永久.*选择国家/.test(cedePage)) errs.push(`州面板:"划给…"的干预页不对(${cedePage.slice(0, 160)})`);
  if (!dim || !cedePlates.length) errs.push(`州面板:"划给…"选国家时没有压暗 / 名牌(压暗 ${dim},名牌 ${cedePlates.length})`);
  if (!/^选择.+要划给的国家 \d+ 年起生效 取消 · Esc$/.test(pickToast)) errs.push(`州面板:"划给…"选国家的提示条不对(${pickToast})`);
  if (!hidden) errs.push('州面板:选国家时面板没有收起');
  if (!/^.+划给.+,已从 \d+ 年起重新推演 撤销$/.test(doneToast)) errs.push(`州面板:划给后没有"…划给…,已从 N 年起重新推演"带撤销(${doneToast})`);
  if (!mineAfter.includes('划给')) errs.push(`州面板:划给后面板里没列出这一州的干预(${mineAfter})`);
  if (!/^已撤销/.test(undoToast) || !mineGone) errs.push(`州面板:撤销后不对(「${undoToast}」,列表没了 ${mineGone})`);
  if (moveCity < 0) errs.push('城面板:没找到能"迁都到这里"的城');
  else if (!moveHidden || !/^.+迁都.+,已从 \d+ 年起重新推演 撤销$/.test(moveToast) || !/^已撤销/.test(moveUndo))
    errs.push(`城面板:"迁都到这里"不对(面板收起 ${moveHidden},「${moveToast}」,撤销「${moveUndo}」)`);
  await page.evaluate(() => localStorage.clear());
}

// 成书(不联网):侧栏右上"更多"里的"把历史写成史书" → 生成史书窗口(写什么 / 文体 / 篇幅,切选项);没设置 AI 时点"开始生成" →
// 窗口关上、提示条"还没有设置 AI · 去设置"(打开 AI 设置);窗口里的"AI 设置"打开设置,Esc 只关设置。
// 测试用假 AI(放慢):开始生成 → 右上"正在撰写《世界通史》"+ 进度条 → "已完成 · 打开" → 阅读页(书名、正文)→
// 读过就收起;刷新后"已写的史书"里还在,点开能读,删除(点两次)
if (part('成书')) {
  const hp = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  hp.on('pageerror', (e) => errs.push(`[成书] ${e.message}`));
  hp.on('console', (m) => m.type() === 'error' && errs.push(`[成书] ${m.text()}`));
  await hp.goto(`${dev.url}/?seed=7&style=fantasy`);
  await hp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await openBook(hp);
  const opened = await hp.waitForSelector('.bk-dialog', { timeout: 5000 }).then(() => true, () => false);
  const labels = (await hp.locator('.bk-k').allInnerTexts().catch(() => [] as string[])).join(' / ');
  const scopes = await hp.locator('[data-scope]').count();
  await hp.click('[data-style=annals]').catch(() => null);
  await hp.click('[data-length=k3]').catch(() => null);
  const styleOn = await hp.locator('[data-style=annals].on').count();
  const lengthOn = await hp.locator('[data-length=k3].on').count();
  const hint = await hp.locator('[data-testid=book-hint]').innerText().catch(() => '');
  // 窗口里的"AI 设置":打开设置,Esc 只关设置,成书窗口还在
  await hp.click('.bk-ai').catch(() => null);
  const aiFromDialog = await hp.waitForSelector('.ai-dialog', { timeout: 5000 }).then(() => true, () => false);
  await hp.keyboard.press('Escape');
  await hp.waitForTimeout(200);
  const aiClosedOnly = !(await hp.locator('.ai-dialog').count()) && (await hp.locator('.bk-dialog').count()) === 1;
  await hp.click('[data-act=book-start]').catch(() => null);
  const noAi = await toastText(hp, 'book');
  const dialogClosed = !(await hp.locator('.bk-dialog').count());
  await hp.click('.toast[data-toast=book] .toast-act').catch(() => null);
  const settings = await hp.waitForSelector('.ai-dialog', { timeout: 5000 }).then(() => true, () => false);
  await hp.keyboard.press('Escape');
  // 编年史页的"写成史书"也打开同一个窗口(概览收起)
  await openOverview(hp, 'chronicle');
  await hp.click('.chron-ai').catch(() => null);
  const fromChronicle = await hp.waitForSelector('.bk-dialog', { timeout: 3000 }).then(() => true, () => false);
  await hp.keyboard.press('Escape');
  if (!fromChronicle) errs.push('成书:编年史的"写成史书"没打开生成史书窗口');
  console.log(
    `成书(没设置 AI):窗口 ${opened ? '打开' : '没打开'}(${labels};写什么 ${scopes} 项);切到编年体 ${styleOn}、短篇 ${lengthOn};「${hint}」;` +
      `窗口里的 AI 设置 ${aiFromDialog}、Esc 只关设置 ${aiClosedOnly};开始生成 → 提示「${noAi}」、窗口关上 ${dialogClosed};点"去设置"打开设置 ${settings}`,
  );
  if (!opened) errs.push('成书:点"把历史写成史书"没有打开生成史书窗口');
  else {
    if (labels !== '写什么 / 文体 / 篇幅') errs.push(`成书:窗口里的三行选项不对(${labels})`);
    if (scopes !== 1) errs.push(`成书:没选中国家时"写什么"应该只有"整个世界"(${scopes} 项)`);
    if (!styleOn || !lengthOn) errs.push('成书:点文体 / 篇幅选项没有切过去');
    if (!/约需 \d+–\d+ 分钟/.test(hint)) errs.push(`成书:窗口里没有写要多久(${hint})`);
    if (!aiFromDialog || !aiClosedOnly) errs.push('成书:窗口里的"AI 设置"没打开设置,或 Esc 把成书窗口也关了');
    if (!noAi.includes('还没有设置 AI') || !noAi.includes('去设置')) errs.push(`成书:没设置 AI 时点"开始生成"没有提示条(${noAi})`);
    if (!dialogClosed) errs.push('成书:没设置 AI 时窗口挡着提示条');
    if (!settings) errs.push('成书:提示条上的"去设置"没打开 AI 设置');
  }

  await hp.goto(`${dev.url}/?seed=7&style=fantasy&ai=mock&mockms=150`);
  await hp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await openBook(hp);
  await hp.waitForSelector('.bk-dialog', { timeout: 5000 }).catch(() => null);
  await hp.click('[data-length=k3]').catch(() => null);
  const t0 = Date.now();
  await hp.click('[data-act=book-start]').catch(() => null);
  const writing = await hp.locator('.book-chip').innerText({ timeout: 3000 }).catch(() => '');
  const done = await hp.locator('.book-chip.done').innerText({ timeout: 20000 }).catch(() => '');
  const ms = Date.now() - t0;
  await hp.click('.book-chip.done').catch(() => null);
  await hp.waitForSelector('.bk-reader', { timeout: 5000 }).catch(() => null);
  const title = await hp.locator('.bk-reader .bk-book').innerText().catch(() => '');
  const meta = await hp.locator('.bk-reader .bk-meta').innerText().catch(() => '');
  const body = await hp.locator('.bk-reader .bk-text').innerText().catch(() => '');
  await hp.keyboard.press('Escape');
  await hp.waitForTimeout(200);
  const readerClosed = !(await hp.locator('.bk-reader').count());
  const chipGone = !(await hp.locator('.book-chip').count());
  await hp.reload();
  await hp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await openBook(hp);
  await hp.waitForSelector('.bk-dialog', { timeout: 5000 }).catch(() => null);
  const kept = await hp.locator('.bk-lib-row').count();
  await hp.click('.bk-lib-row >> nth=0').catch(() => null);
  const reopened = await hp.locator('.bk-reader .bk-book').innerText({ timeout: 3000 }).catch(() => '');
  await hp.click('[data-act=book-delete]').catch(() => null);
  await hp.click('[data-act=book-delete]').catch(() => null);
  await hp.waitForTimeout(200);
  const deleted = !(await hp.locator('.bk-reader').count());
  await openBook(hp);
  const left = await hp.locator('.bk-lib-row').count();
  // 写的时候点右上的进度:边写边看,可以停止(写到一半的不存),再点"重试"接着写完
  await hp.click('[data-act=book-start]').catch(() => null);
  await hp.click('.book-chip', { timeout: 3000 }).catch(() => null);
  const stopBtn = await hp.locator('[data-act=book-stop]').count();
  await hp.click('[data-act=book-stop]').catch(() => null);
  await hp.waitForFunction(() => document.querySelector('.bk-reader .bk-info')?.textContent?.includes('已停止'), null, { timeout: 3000 }).catch(() => null);
  const stopped = await hp.locator('.bk-reader .bk-info').innerText({ timeout: 3000 }).catch(() => '');
  const stoppedLeft = await hp.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('civ-atlas:ai-notes:')).length);
  await hp.click('[data-act=book-redo]').catch(() => null);
  const redone = await hp
    .waitForFunction(() => /\d+ 字，测试用假 AI/.test(document.querySelector('.bk-reader .bk-info')?.textContent ?? ''), null, { timeout: 20000 })
    .then(() => true, () => false);
  await hp.keyboard.press('Escape');
  console.log(
    `成书(假 AI):「${writing.replace(/\n/g, ' ')}」→「${done.replace(/\n/g, ' ')}」${ms} ms;阅读「${title}」(${meta}),正文 ${body.length} 字;` +
      `Esc 关上 ${readerClosed}、右上收起 ${chipGone};刷新后已写的史书 ${kept} 部,点开「${reopened}」;删除 ${deleted},剩 ${left} 部;` +
      `写的时候打开:停止按钮 ${stopBtn}、停下后「${stopped}」(存下 ${stoppedLeft} 部)、重试写完 ${redone}`,
  );
  if (!stopBtn || !stopped.includes('已停止') || stoppedLeft !== 0) errs.push(`成书:写的时候不能停止,或停下后存了半部(${stopped})`);
  if (!redone) errs.push('成书:停下后点"重试"没有写完');
  if (!writing.includes('正在撰写《世界通史》')) errs.push(`成书:开始生成后右上没有"正在撰写《世界通史》"(${writing})`);
  if (!done.includes('《世界通史》已完成 · 打开')) errs.push(`成书:写完右上没有"已完成 · 打开"(${done})`);
  if (title !== '《世界通史》') errs.push(`成书:阅读页书名不对(${title})`);
  if (!/编年体|纪传体/.test(meta) || !meta.includes('短篇') || !meta.includes('截至')) errs.push(`成书:阅读页元信息不对(${meta})`);
  if (!body.includes('测试用假 AI')) errs.push('成书:阅读页没有正文');
  if (!readerClosed || !chipGone) errs.push('成书:Esc 没关上阅读页,或读过之后右上的"已完成"还在');
  if (kept !== 1) errs.push(`成书:刷新后"已写的史书"应该有 1 部(${kept})`);
  if (reopened !== '《世界通史》') errs.push(`成书:点已写的史书没打开阅读页(${reopened})`);
  if (!deleted || left !== 0) errs.push(`成书:删除没生效(阅读页关上 ${deleted},剩 ${left} 部)`);
  await hp.evaluate(() => localStorage.clear());
  await hp.close();
}

// 搜索:侧栏顶上的搜索框 → 输入名字,下面换成结果 → 点一条:结果收起、选中它(侧栏里换成面板);Esc 清空;
// 选中国家后"成书"的"写什么"多出这一国;国家面板"更多"里的"让 AI 写国史"默认写这一国
if (part('搜索')) {
  const sp = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  sp.on('pageerror', (e) => errs.push(`[搜索] ${e.message}`));
  sp.on('console', (m) => m.type() === 'error' && errs.push(`[搜索] ${m.text()}`));
  await sp.goto(`${dev.url}/?seed=7&style=fantasy`);
  await sp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  const placeholder = await sp.locator('.sidebar .search-input').getAttribute('placeholder').catch(() => '');
  // 侧栏首页"国家"里的第一个(最大的)
  const first = await sp.locator('.sb-home .sb-row >> nth=0').innerText().catch(() => '');
  const name = first.split('\n')[0];
  await sp.click('[data-act=search]');
  await sp.keyboard.type(name.slice(0, 2));
  await sp.waitForTimeout(150);
  const partial = await sp.locator('.search-row').count();
  await sp.keyboard.press('Escape');
  const escClosed = !(await sp.locator('.search-row').count()) && (await sp.locator('.sb-home').count()) === 1;
  // 按名字搜第一个国家
  await sp.fill('.sidebar .search-input', name);
  await sp.waitForTimeout(150);
  const rows = (await sp.locator('.search-row .search-name').allInnerTexts().catch(() => [] as string[])) as string[];
  await sp.click('.search-row >> nth=0').catch(() => null);
  await sp.waitForTimeout(300);
  const pickClosed = !(await sp.locator('.search-row').count()) && (await sp.locator('.sidebar .search-input').inputValue()) === '';
  const selected = await sp.evaluate(() => document.querySelector('.app')?.classList.contains('panel-open') ?? false);
  await openBook(sp);
  await sp.waitForSelector('.bk-dialog', { timeout: 5000 }).catch(() => null);
  const scopes = (await sp.locator('[data-scope]').allInnerTexts().catch(() => [] as string[])).join(' / ');
  const worldFirst = await sp.locator('[data-scope=world].on').count();
  await sp.keyboard.press('Escape');
  // 国家面板"更多"里的"让 AI 写国史":打开成书窗口,默认写这一国
  await sp.click('.inspector [data-act=more]', { timeout: 3000 }).catch(() => null);
  await sp.click('.inspector [data-act=book]', { timeout: 3000 }).catch(() => null);
  const polityDefault = await sp.locator('.bk-dialog [data-scope=polity].on').innerText({ timeout: 3000 }).catch(() => '');
  await sp.keyboard.press('Escape');
  console.log(
    `搜索:占位「${placeholder}」;打两个字「${name.slice(0, 2)}」→ ${partial} 条;Esc 清空 ${escClosed};` +
      `搜「${name}」→ ${rows.join('、')};点第一条:结果收起 ${pickClosed}、选中 ${selected};成书的写什么:${scopes}(默认整个世界 ${worldFirst});` +
      `面板里写国史 → 默认「${polityDefault}」`,
  );
  if (placeholder !== '搜索国家、城市、人物、山河') errs.push(`搜索:占位文字不对(${placeholder})`);
  if (!name || !(partial >= 1)) errs.push(`搜索:打两个字没有结果(${name},${partial} 条)`);
  if (!escClosed) errs.push('搜索:Esc 没清空搜索、回到世界首页');
  if (!rows.length || !rows.some((r) => r.includes(name))) errs.push(`搜索:输入名字没搜到(${rows.join('、')})`);
  if (!pickClosed || !selected) errs.push('搜索:点一条没收起结果 / 没选中');
  if (!scopes.includes('整个世界') || !scopes.includes(name) || !worldFirst) errs.push(`搜索:选中国家后成书的"写什么"没有这一国 / 默认不是整个世界(${scopes})`);
  if (polityDefault !== name) errs.push(`成书:国家面板里的"让 AI 写国史"没有默认写这一国(${polityDefault})`);
  await sp.close();
}

// 再推 N 年:时间轴尽头「再推」→ 弹层选 100 年 → 推好:时间轴到第 3100 年(刻度只写 3100,3000 挨得太近省掉)、播放头停在原来的第 3000 年、
// 刚推的那段标出来、顶上提示条「已推到第 3100 年」;提示条上「撤销」→ 和推之前一模一样。推的时候点「停下」→ 什么都不留
if (part('再推')) {
  const xp = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  xp.on('pageerror', (e) => errs.push(`[再推] ${e.message}`));
  xp.on('console', (m) => m.type() === 'error' && errs.push(`[再推] ${m.text()}`));
  await xp.goto(`${dev.url}/?seed=7&style=fantasy`);
  await xp.waitForFunction(() => (window as any).__wfCiv?.ready, null, { timeout: 60000 });
  const sum = () => xp.evaluate(() => JSON.stringify((window as any).__wfCivSum?.(1e9) ?? null));
  const s0 = await sum();
  await xp.click('.timebar [data-act=extend]');
  const pop = await xp.locator('.xt-pop').isVisible().catch(() => false);
  const def = await xp.locator('.xt-seg button.on').innerText().catch(() => '');
  await xp.click('[data-act=extend-100]');
  await xp.click('[data-act=extend-go]');
  const done = await xp.waitForSelector('[data-toast=extend-done]', { timeout: 30000 }).then(() => true, () => false);
  const s1 = (await xp.evaluate(() => (window as any).__wfCivSum?.(1e9))) as { endYear: number } | null;
  const head = await xp.locator('.timebar .tb-year').innerText().catch(() => '');
  const labels = await xp.locator('.timebar .tb-label').allInnerTexts();
  const fresh = await xp.locator('.timebar .tb-fresh').count();
  const toast = await xp.locator('[data-toast=extend-done]').innerText().catch(() => '');
  await xp.click('[data-act=extend-undo]').catch(() => {});
  await xp.waitForTimeout(500);
  const s2 = await sum();
  const fresh2 = await xp.locator('.timebar .tb-fresh').count();
  // 停下:推到第 60000 年要好一会儿,推的时候点「停下」
  await xp.click('.timebar [data-act=extend]');
  await xp.click('[data-act=extend-own]');
  await xp.fill('[data-act=extend-years]', '57000');
  await xp.click('[data-act=extend-go]');
  const busy = await xp.waitForSelector('.timebar .xt-btn.busy', { timeout: 5000 }).then(() => true, () => false);
  await xp.click('[data-act=extend-stop]').catch(() => {});
  await xp.waitForTimeout(1500);
  const s3 = await sum();
  const toast3 = await xp.locator('[data-toast=extend-done]').count();
  const idle = await xp.locator('.timebar [data-act=extend]:not(.busy)').count();
  console.log(
    `再推:弹层 ${pop}(默认「${def}」);推 100 年 ${done ? '推好了' : '没推好'} → 第 ${s1?.endYear} 年,播放头「${head}」,刻度 ${labels.join('/')},刚推的那段 ${fresh};` +
      `提示条「${toast.replace(/\n/g, ' ')}」;撤销以后和推之前一样 ${s2 === s0}(标记 ${fresh2});推的时候停下 ${busy}:和推之前一样 ${s3 === s0}、没有提示条 ${!toast3}、按钮回来 ${idle}`,
  );
  if (!pop || def !== '500 年') errs.push(`再推:点「再推」没弹出选几年的弹层 / 默认不是 500 年(${def})`);
  if (!done || s1?.endYear !== 3100) errs.push(`再推:推 100 年没推到第 3100 年(${s1?.endYear})`);
  if (head !== '第 3000 年') errs.push(`再推:推完播放头没停在原来的第 3000 年(${head})`);
  if (labels.join('/') !== '0/1000/2000/3100') errs.push(`再推:3100 年的刻度字不对(${labels.join('/')})`);
  if (fresh !== 1) errs.push('再推:刚推的那段没标出来');
  if (!toast.includes('已推到第 3100 年') || !toast.includes('从第 3000 年接着看') || !toast.includes('撤销')) errs.push(`再推:提示条不对(${toast})`);
  if (s2 !== s0 || fresh2) errs.push('再推:撤销以后和推之前不一样');
  if (!busy || s3 !== s0 || toast3 || idle !== 1) errs.push('再推:推的时候点停下,世界没回到推之前 / 还出了提示条');
  await xp.close();
}

// 助手(不联网):右上「助手」开关右边的面板,地图那一块往左让;"更多"菜单里不再有改写。没设置 AI 时一行说明 + 五句按这个世界写的例子、
// 底部"设置 AI",照样能发(这一轮报"还没有设置 AI")。测试用假 AI(时间轴在 2000 年):说一句要改的 → 查、试推演、列确认单(附试推演的结果),做完的几步收成一行 →
// "先在地图上看看":地图上方的提示条,"回到现在"收起 → "执行 N 条":后台重推,提示条"已按你说的改写"(带撤销)、侧栏顶上"干预了 N 处",
// 确认单写"已执行" → 提示条上点撤销 → 重推回没有干预、确认单写"已撤销"。问一句 → 地图上选中它;再点「助手」收起、地图回原位。
// 手机:右上第三个按钮打开拉到顶的卡片;"先在地图上看看"收起卡片,提示条上能直接执行
if (part('助手')) {
  const rp = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  rp.on('pageerror', (e) => errs.push(`[助手] ${e.message}`));
  rp.on('console', (m) => m.type() === 'error' && errs.push(`[助手] ${m.text()}`));
  /** 历史推完了:侧栏顶上的小字写出现存几国(这个网址默认是地形图层,地图上没有国名,不能按国名等) */
  const historyReady = () => /现存/.test(document.querySelector('.sb-sub')?.textContent ?? '');
  const right = (sel: string) => rp.evaluate((s) => document.querySelector(s)?.getBoundingClientRect().right ?? -1, sel);
  await rp.goto(`${dev.url}/?seed=7&style=fantasy`);
  await rp.waitForFunction(historyReady, null, { timeout: 60000 });
  await rp.click('[data-act=world-more]');
  const rewriteGone = (await rp.locator('.pm-menu [data-act=rewrite]').count()) === 0;
  await rp.keyboard.press('Escape');
  const barRight0 = await right('.map-bar');
  await rp.click('.map-bar [data-act=assistant]');
  const shown = await rp.waitForSelector('.ast-panel', { timeout: 5000 }).then(() => true, () => false);
  const pressed = await rp.locator('.map-bar [data-act=assistant]').getAttribute('aria-pressed');
  await rp.waitForTimeout(300);
  const panelLeft = await rp.evaluate(() => document.querySelector('.ast-panel')?.getBoundingClientRect().left ?? -1);
  const barRight1 = await right('.map-bar');
  const timeRight = await right('.bottom-row');
  const hint = await rp.locator('.ast-hint').innerText().catch(() => '');
  const examples = (await rp.locator('.ast-example').allInnerTexts().catch(() => [] as string[])) as string[];
  const unset = await rp.locator('.ast-unset').first().innerText().catch(() => '');
  // 没设置 AI 也能发:按回车,这一轮报"还没有设置 AI",旁边一个"设置 AI"
  await rp.fill('.ast-field textarea', '让最大的国家多撑三百年');
  await rp.press('.ast-field textarea', 'Enter');
  const sentErr = await rp
    .waitForSelector('.ast-error', { timeout: 5000 })
    .then((el) => el.innerText())
    .catch(() => '');
  // 清掉这一轮(对话按世界存着,后面再打开同一个世界要从空的开始)
  await rp.click('[data-act=ast-new]').catch(() => null);
  await rp.click('.map-bar [data-act=assistant]');
  await rp.waitForTimeout(300);
  const closed = !(await rp.locator('.ast-panel').count());
  const barRight2 = await right('.map-bar');
  console.log(
    `助手(没设置 AI):更多菜单里没有改写 ${rewriteGone};面板 ${shown ? '出来' : '没出来'}(按钮按下 ${pressed}),左边 ${Math.round(panelLeft)},` +
      `右上按钮右边 ${Math.round(barRight0)} → ${Math.round(barRight1)}、时间轴右边 ${Math.round(timeRight)};「${hint.slice(0, 20)}…」,例子 ${examples.join(' / ')};` +
      `「${unset.replace(/\n/g, ' ')}」,按回车「${sentErr.replace(/\n/g, ' ')}」;再点收起 ${closed}、右上按钮回到 ${Math.round(barRight2)}`,
  );
  if (!rewriteGone) errs.push('助手:"更多"菜单里还有"用一句话改写世界"');
  if (!shown || pressed !== 'true') errs.push(`助手:点右上「助手」没有出来面板 / 按钮没按下(${shown}、${pressed})`);
  else {
    if (!(barRight1 <= panelLeft + 1 && timeRight <= panelLeft + 1 && barRight1 < barRight0 - 300))
      errs.push(`助手:面板开着时右上按钮、时间轴没有挪到面板左边(面板左边 ${panelLeft},按钮 ${barRight0} → ${barRight1},时间轴 ${timeRight})`);
    if (!hint.includes('都会先列出来给你确认')) errs.push(`助手:空的时候没有说明(${hint})`);
    if (examples.length !== 5) errs.push(`助手:空的时候应该有五句例子(${examples.join(' / ')})`);
    if (!unset.includes('设置 AI') || !sentErr.includes('设置 AI')) errs.push(`助手:没设置 AI 时应该提示,按回车这一轮报还没有设置 AI(${unset};${sentErr})`);
    if (!closed || Math.abs(barRight2 - barRight0) > 1) errs.push(`助手:再点「助手」没收起 / 右上按钮没回原位(${closed},${barRight0} → ${barRight2})`);
  }

  await rp.goto(`${dev.url}/?seed=7&style=fantasy&ai=mock&civYear=2000`);
  await rp.waitForFunction(historyReady, null, { timeout: 60000 });
  await rp.waitForTimeout(300);
  const sub0 = await rp.locator('.sb-sub').innerText().catch(() => '');
  await rp.click('.map-bar [data-act=assistant]');
  await rp.fill('.ast-field textarea', '让它多撑一阵');
  await rp.click('[data-act=ast-send]');
  await rp.waitForSelector('[data-act=ast-apply]', { timeout: 30000 }).catch(() => null);
  const folded = await rp.locator('[data-act=ast-steps]').innerText().catch(() => '');
  const items = (await rp.locator('.ast-items .ast-row .tx b').allInnerTexts().catch(() => [] as string[])) as string[];
  const years = (await rp.locator('.ast-items .ast-row .yr').allInnerTexts().catch(() => [] as string[])) as string[];
  const checked = await rp.locator('.ast-ck[aria-checked=true]').count();
  const result = (await rp.locator('.ast-result .ast-row').allInnerTexts().catch(() => [] as string[])) as string[];
  const go = await rp.locator('[data-act=ast-apply]').innerText().catch(() => '');
  const cant = await rp.locator('.ast-cant').count();
  await rp.click('[data-act=ast-steps]').catch(() => null);
  const stepRows = (await rp.locator('.ast-steps .ast-row .tx b').allInnerTexts().catch(() => [] as string[])) as string[];
  // 先在地图上看看
  await rp.click('[data-act=ast-preview]').catch(() => null);
  const banner = await rp
    .waitForFunction(() => document.querySelector('.ast-banner-text')?.textContent?.includes('还没执行'), null, { timeout: 20000 })
    .then(() => true, () => false);
  const previewCls = await rp.evaluate(() => document.querySelector('.app')?.classList.contains('ast-preview') ?? false);
  await rp.click('[data-act=ast-banner-back]').catch(() => null);
  await rp.waitForTimeout(150);
  const backed = !(await rp.locator('.ast-banner').count());
  // 执行 → 撤销
  const prev = await rp.evaluate(() => (window as any).__wfResim?.seq ?? 0);
  await rp.click('[data-act=ast-apply]').catch(() => null);
  const resimmed = await rp
    .waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prev, { timeout: 20000 })
    .then(() => true, () => false);
  const done = await toastText(rp, 'resim-done', 5000);
  const sub1 = await rp.locator('.sb-sub').innerText().catch(() => '');
  const doneMark = await rp.locator('.ast-done').innerText().catch(() => '');
  const prevU = await rp.evaluate(() => (window as any).__wfResim?.seq ?? 0);
  await rp.click('.toast[data-toast=resim-done] [data-act=rw-undo]').catch(() => null);
  const undone = await rp
    .waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prevU, { timeout: 20000 })
    .then(() => true, () => false);
  const undoToast = await toastText(rp, 'resim-done', 5000);
  const sub2 = await rp.locator('.sb-sub').innerText().catch(() => '');
  const undoMark = await rp.locator('.ast-done').innerText().catch(() => '');
  // 问一句:地图上选中它
  await rp.fill('.ast-field textarea', '它为什么会亡？');
  await rp.click('[data-act=ast-send]');
  await rp.waitForFunction(() => document.querySelectorAll('.ast-turn').length === 2 && !document.querySelector('[data-act=ast-stop]'), null, { timeout: 20000 }).catch(() => null);
  const asked = await rp.locator('.ast-turn').last().locator('[data-act=ast-steps]').innerText().catch(() => '');
  const said = await rp.locator('.ast-turn').last().locator('.ast-say').first().innerText().catch(() => '');
  const opened = await rp.evaluate(() => !!document.querySelector('.inspector'));
  console.log(
    `助手(假 AI):做完收成「${folded}」(展开 ${stepRows.join(' / ')});确认单 ${items.map((t, i) => `${years[i]} ${t}`).join(';')}(勾着 ${checked} 条,按钮「${go}」,做不到 ${cant} 句);` +
      `试推演的结果 ${result.map((r) => r.replace(/\n/g, ' ')).join(';')};先在地图上看看:提示条 ${banner}、地图换成试推演 ${previewCls}、回到现在 ${backed};` +
      `执行:重推 ${resimmed}、提示「${done}」、左上「${sub0}」→「${sub1}」、确认单「${doneMark}」;撤销:重推 ${undone}、提示「${undoToast}」、左上「${sub2}」、确认单「${undoMark}」;` +
      `问一句:「${asked}」「${said.slice(0, 30)}…」,详情打开 ${opened}`,
  );
  if (!/^查了 2 次，试推演 \d 次$/.test(folded)) errs.push(`助手:做完的几步没有收成一行(${folded})`);
  if (!stepRows.some((t) => t.startsWith('查国家：')) || !stepRows.some((t) => t.startsWith('试推演：'))) errs.push(`助手:展开后的步骤不对(${stepRows.join(' / ')})`);
  if (!items.length || items.length !== checked || go !== `执行 ${items.length} 条` || cant !== 1) errs.push(`助手:确认单默认全勾、按钮写条数、做不到的一句(${items.length} 条,勾 ${checked},「${go}」,做不到 ${cant})`);
  if (!items[0]?.includes('保护') || !/^\d+$/.test(years[0] ?? '')) errs.push(`助手:假 AI 的确认单不对(${years[0]} ${items[0]})`);
  if (!result.length || !result[0].includes('→')) errs.push(`助手:确认单下面没有试推演的结果(${result.join(';')})`);
  if (!banner || !previewCls || !backed) errs.push(`助手:"先在地图上看看"不对(提示条 ${banner},地图 ${previewCls},回到现在 ${backed})`);
  if (!resimmed || !/已按你说的改写 · 从 \d+ 年重新推演.*撤销/.test(done)) errs.push(`助手:执行后没有重推 / 提示条不对(${resimmed},${done})`);
  if (!sub0 || sub0.includes('干预') || !sub1.includes(`干预了 ${items.length} 处`) || doneMark !== '已执行') errs.push(`助手:执行后侧栏顶上 / 确认单不对(${sub0} → ${sub1},「${doneMark}」)`);
  if (!undone || !undoToast.includes('已撤销改写') || !sub2 || sub2.includes('干预') || undoMark !== '已撤销') errs.push(`助手:提示条上的撤销不对(重推 ${undone},「${undoToast}」,「${sub2}」,「${undoMark}」)`);
  if (!asked.includes('在地图上打开了') || !said.startsWith('【测试用假 AI】') || !opened) errs.push(`助手:问一句没在地图上打开它(${asked};${said};详情 ${opened})`);
  await rp.evaluate(() => localStorage.clear());
  await rp.close();

  // 手机
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const pp = await pctx.newPage();
  pp.on('pageerror', (e) => errs.push(`[助手 手机] ${e.message}`));
  await pp.goto(`${dev.url}/?seed=7&style=fantasy&ai=mock&civYear=2000`);
  await pp.waitForFunction(() => (window as any).__wf?.ready && /现存/.test(document.querySelector('.sb-sub')?.textContent ?? ''), null, { timeout: 60000 });
  await pp.click('.phone-btns [data-act=assistant]');
  const sheet = await pp.waitForSelector('.ast-panel.phone', { timeout: 5000 }).then(() => true, () => false);
  await pp.fill('.ast-field textarea', '让它多撑一阵');
  await pp.click('[data-act=ast-send]');
  await pp.waitForSelector('[data-act=ast-preview]', { timeout: 30000 }).catch(() => null);
  const pGo = await pp.locator('[data-act=ast-apply]').innerText().catch(() => '');
  await pp.click('[data-act=ast-preview]').catch(() => null);
  await pp.waitForTimeout(300);
  const sheetGone = !(await pp.locator('.ast-panel').count());
  const pBanner = await pp.waitForSelector('.ast-banner.phone [data-act=ast-banner-apply]:not([disabled])', { timeout: 20000 }).then(() => true, () => false);
  const pPrev = await pp.evaluate(() => (window as any).__wfResim?.seq ?? 0);
  await pp.click('[data-act=ast-banner-apply]').catch(() => null);
  const pResim = await pp
    .waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, pPrev, { timeout: 20000 })
    .then(() => true, () => false);
  const pBannerGone = !(await pp.locator('.ast-banner').count());
  console.log(`助手(手机):卡片 ${sheet}、按钮「${pGo}」;先在地图上看看:卡片收起 ${sheetGone}、提示条 ${pBanner};提示条上执行:重推 ${pResim}、提示条收起 ${pBannerGone}`);
  if (!sheet || !pGo.startsWith('执行')) errs.push(`助手(手机):右上第三个按钮没打开卡片 / 没列确认单(${sheet},「${pGo}」)`);
  if (!sheetGone || !pBanner || !pResim || !pBannerGone) errs.push(`助手(手机):先看再执行不对(卡片收起 ${sheetGone},提示条 ${pBanner},重推 ${pResim},提示条收起 ${pBannerGone})`);
  await pp.evaluate(() => localStorage.clear());
  await pctx.close();
}

// AI 设置(阶段 5):打开"AI" → 我们的 AI 显示"内测" → 假 AI(ai=mock,不联网)"测试一下"成功 → 调用记录里有一条、刷新后还在 → 清空
if (part('AI 设置')) {
  const outside: string[] = [];
  const onReq = (r: { url: () => string }) => /deepseek\.com|aliyuncs\.com/.test(new URL(r.url()).host) && outside.push(r.url());
  page.on('request', onReq);
  await page.goto(`${dev.url}/?seed=7&ai=mock`);
  await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await openAi();
  await page.waitForSelector('.ai-dialog', { timeout: 10000 });
  const official = await page.locator('[data-ai=official]').innerText();
  const mockOn = await page.locator('[data-ai=mock]').getAttribute('aria-checked');
  await page.click('[data-act=ai-test]');
  const test = await page
    .waitForSelector('.ai-test.ok, .ai-test.error', { timeout: 10000 })
    .then((h) => h.innerText(), () => '');
  await page.click('[data-tab=log]');
  const rows = await page.locator('.ai-log-row').count();
  await page.click('.ai-log-row >> nth=0 >> .ai-log-head');
  const detail = (await page.locator('.ai-log-body').innerText().catch(() => '')).replace(/\n/g, ' ');
  // 刷新后记录还在(存在浏览器的 IndexedDB 里)
  await page.reload();
  await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await openAi();
  await page.click('[data-tab=log]');
  await page.waitForFunction(() => document.querySelectorAll('.ai-log-row').length > 0, null, { timeout: 5000 }).catch(() => {});
  const kept = await page.locator('.ai-log-row').count();
  await page.click('[data-act=ai-log-clear]');
  await page.click('[data-act=ai-log-clear]');
  const cleared = await page.locator('.ai-log-row').count();
  await page.keyboard.press('Escape');
  const closed = !(await page.locator('.ai-dialog').count());
  await closeOverview();
  page.off('request', onReq);
  console.log(
    `AI 设置:我们的 AI「${official.replace(/\n/g, ' ')}」;假 AI 选中 ${mockOn};测试「${test}」;` +
      `调用记录 ${rows} 条,展开「${detail.slice(0, 60)}」;刷新后 ${kept} 条;清空后 ${cleared} 条`,
  );
  if (!official.includes('内测')) errs.push(`AI 设置:没配置服务器时"我们的 AI"没显示内测(${official})`);
  if (mockOn !== 'true') errs.push('AI 设置:网址带 ai=mock 时假 AI 没被选中');
  if (!test.includes('连上了')) errs.push(`AI 设置:假 AI"测试一下"没成功(${test})`);
  if (rows !== 1) errs.push(`AI 设置:测试后调用记录应该有 1 条(实际 ${rows})`);
  if (!detail.includes('连接测试') && !detail.includes('你好')) errs.push(`AI 设置:展开调用记录看不到发出去的内容(${detail})`);
  if (kept !== 1) errs.push(`AI 设置:刷新后调用记录没留住(${kept} 条)`);
  if (cleared !== 0) errs.push('AI 设置:清空后还有记录');
  if (!closed) errs.push('AI 设置:按 Esc 没关掉');
  if (outside.length) errs.push(`AI 设置:冒烟测试里请求了真的服务商(${outside[0]})`);
  await page.evaluate(() => localStorage.clear());
}

// AI 释名 / 起名(阶段 5,不联网):没设置 AI 时点"释名" → 一行提示"还没有设置 AI" +"设置 AI"打开设置面板;
// 测试用假 AI:点一座城 → 释名(写完存下)→ AI 起名 → 选第一个 → 就用这个 → 地图上的城名变了
if (part('AI 释名')) {
  await page.evaluate(() => localStorage.clear());
  let notSet = '';
  let settingsOpened = false;
  {
    await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
    await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
    await page.waitForTimeout(300);
    type Pick = { kind: string; id: number; text: string; x: number; y: number };
    const ps = (await page.evaluate('window.__wfPickables()')) as Pick[];
    const city = ps.find((p) => p.kind === 'settlement' && ps.some((m) => m.kind === 'mark' && m.id === p.id));
    const mark = city && ps.find((m) => m.kind === 'mark' && m.id === city.id);
    if (mark) {
      await page.mouse.click(mark.x, mark.y);
      await page.click('.inspector [data-act=more]');
      await page.click('.inspector [data-ain=explain]');
      notSet = await page
        .waitForSelector('.inspector .ain-err', { timeout: 5000 })
        .then((h) => h.innerText(), () => '');
      await page.click('.inspector .ain-err button:has-text("设置 AI")').catch(() => {});
      settingsOpened = await page
        .waitForSelector('.ai-dialog', { timeout: 5000 })
        .then(() => true, () => false);
      await page.keyboard.press('Escape');
    }
  }
  console.log(`AI 释名(没设置 AI):「${notSet.replace(/\n/g, ' ')}」→ 点"设置 AI"打开设置面板 ${settingsOpened}`);
  if (!/还没有设置 AI/.test(notSet) || !notSet.includes('设置 AI')) errs.push(`AI 释名:没设置 AI 时没有一行提示和"设置 AI"(${notSet})`);
  if (!settingsOpened) errs.push('AI 释名:点"设置 AI"没有打开设置面板');
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities&ai=mock`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  type Pick = { kind: string; id: number; text: string; x: number; y: number };
  const ps = (await page.evaluate('window.__wfPickables()')) as Pick[];
  // 挑一座悬停时"最近城市"就是它自己的城(同一州里可能有更大的城):改名后悬停信息里才看得到新名字;
  // 符号在舞台中间一带(详情面板在左 / 右边弹出,宽约 300 像素,会盖住靠边的符号)
  let city: Pick | undefined;
  let mark: Pick | undefined;
  const vw = page.viewportSize()!.width;
  for (const c of ps.filter((p) => p.kind === 'settlement' && ps.some((m) => m.kind === 'mark' && m.id === p.id && m.x > 450 && m.x < vw - 450)).slice(0, 20)) {
    const m = ps.find((q) => q.kind === 'mark' && q.id === c.id)!;
    const t = await probe(page, m.x, m.y);
    if (t.includes(`最近城市 ${c.text}`)) {
      city = c;
      mark = m;
      break;
    }
  }
  let note = '';
  let cands: string[] = [];
  let chosen = '';
  let renamed = false;
  let stale = '';
  if (city && mark) {
    await page.mouse.click(mark.x, mark.y);
    await page.click('.inspector [data-act=more]');
    await page.click('.inspector [data-ain=explain]');
    await page.waitForSelector('.inspector .ain-note:not(.writing) .ain-text', { timeout: 10000 }).catch(() => null);
    note = await page.locator('.inspector .ain-note .ain-text').innerText().catch(() => '');
    // "AI 起名"在改名时的输入框下面(和国家面板一样);先点进要求框(名字输入框收起),再点"起 5 个"
    await page.click('.inspector [data-act=rename]');
    await page.click('.inspector [data-ain=suggest]');
    await page.click('.inspector .ain-wish input');
    await page.click('.inspector .ain-go');
    await page.waitForSelector('.inspector .ain-cand', { timeout: 10000 }).catch(() => null);
    cands = await page.locator('.inspector .ain-cand-name').allInnerTexts();
    if (cands.length) {
      chosen = cands[0];
      await page.click('.inspector .ain-cand-btn >> nth=0');
      await page.click('.inspector .ain-ok');
      renamed = await page
        .waitForFunction(([n, old]) => (window as any).__wfLabels?.texts?.includes(n) && !(window as any).__wfLabels.texts.includes(old), [chosen, city.text], { timeout: 5000 })
        .then(() => true, () => false);
      stale = await page.locator('.inspector .ain-stale').innerText().catch(() => '');
    }
  }
  console.log(`AI 释名 / 起名:点「${city?.text}」→ 释名「${note.slice(0, 30)}…」;候选 ${cands.join('、')};选「${chosen}」→ 地图上的城名变了 ${renamed};释名标「${stale}」`);
  if (!city) errs.push('AI 起名:没找到能点的城');
  else {
    if (!note.includes('测试用假 AI')) errs.push('AI 释名:没写出(假 AI 的)名字由来');
    if (!cands.length) errs.push('AI 起名:没出候选名字');
    if (!renamed) errs.push('AI 起名:选中候选、确定后地图上的城名没有变');
    if (!stale.includes('写于改名前')) errs.push('AI 起名:改名后释名没有标"写于改名前"');
  }
  // 国家"更多"里也能讲主体民族的族名由来(和州面板民族一行的同一套),写在面板最下面
  let folkItem = '';
  let folkNote = '';
  // 有主体民族(占一半以上的州)的国家才有这一项:挑前几个国家里第一个有的
  const pols = ((await page.evaluate('window.__wfPickables()')) as Pick[]).filter((q) => q.kind === 'polity').slice(0, 8);
  let pol: Pick | undefined;
  for (const q of pols) {
    await page.keyboard.press('Escape');
    await page.evaluate((id) => (window as any).__wfSelect('polity', id), q.id);
    await page.waitForTimeout(600);
    await page.click('.inspector [data-act=more]');
    if (await page.locator('.pm-menu [data-act=culture-explain]').count()) {
      pol = q;
      break;
    }
  }
  if (!pol) pol = pols[0];
  if (pol) {
    folkItem = await page.locator('.pm-menu [data-act=culture-explain]').innerText({ timeout: 3000 }).catch(() => '');
    await page.click('.pm-menu [data-act=culture-explain]', { timeout: 3000 }).catch(() => {});
    await page.waitForSelector('.inspector .cp-ai .ain-note:not(.writing) .ain-text', { timeout: 10000 }).catch(() => null);
    folkNote = (await page.locator('.inspector .cp-ai').last().innerText().catch(() => '')).replace(/\n/g, ' ');
  }
  console.log(`国家「${pol?.text}」的"更多"里「${folkItem.replace(/\n/g, ' ')}」→ 面板最下面「${folkNote.slice(0, 40)}…」`);
  if (!/^让 AI 讲.+族的族名由来/.test(folkItem) || !folkNote.includes('族名由来') || !folkNote.includes('测试用假 AI'))
    errs.push(`国家面板:"更多"里讲主体民族的族名由来不对(「${folkItem}」→「${folkNote.slice(0, 60)}」)`);
  await page.evaluate(() => localStorage.clear());
}

// 世界东西相连:左右无限拖动(每帧耗时)、拖一整圈回到原处画面一致、接缝两侧点到同一块地、
// 编年史跳转走短边、手绘风的外框罗盘画在视窗上、导出按当前视图中心展开
if (part('东西相连')) {
  const { PNG } = await import('pngjs');
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const view = () => page.evaluate(() => (window as any).__wfView);
  const setCenter = async (lon: number) => {
    await page.evaluate(() => (((window as any).__wfLabels ??= {}).mark = 1));
    await page.evaluate((l) => (window as any).__wfSetCenter(l), lon);
    await page.waitForFunction(() => !(window as any).__wfLabels?.mark, null, { timeout: 5000 }).catch(() => {});
  };
  const v0 = await view();
  const box = (await page.locator('.map-box').boundingBox())!;
  // 从卡片右边那一块里起手(左边浮着侧栏卡片,按在卡片上拖不动地图)
  const side = await page.locator('.sidebar').boundingBox();
  const sx = Math.max(box.x + box.width * 0.3, (side ? side.x + side.width : 0) + 40);
  const sy = box.y + box.height * 0.5;
  // 1. 拖动时每帧耗时:按住以后在页面里连发 60 次移动,每次量"事件 → 地图层变换、文字层重排、视窗装饰重画"做完
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  const frames = await page.evaluate(
    async ([x0, y0]) => {
      const el = document.querySelector('main.stage')!;
      // 等 React 这一轮做完:它排的任务在前,我们的消息在后(不要在这里声明具名函数:tsx 会插入页面里没有的 __name)
      const ch = new MessageChannel();
      const ms: number[] = [];
      const lab: number[] = [];
      for (let i = 1; i <= 60; i++) {
        const t0 = performance.now();
        el.dispatchEvent(new PointerEvent('pointermove', { clientX: x0 + i * 9, clientY: y0, bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, buttons: 1 }));
        await new Promise<void>((r) => {
          ch.port1.onmessage = () => r();
          ch.port2.postMessage(0);
        });
        ms.push(performance.now() - t0);
        lab.push((window as any).__wfLabels?.ms ?? NaN);
        await new Promise((r) => requestAnimationFrame(r));
      }
      return { ms, lab };
    },
    [sx, sy],
  );
  await page.mouse.up();
  const med = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const panMed = med(frames.ms);
  const panMax = Math.max(...frames.ms);
  const v1 = await view();
  console.log(
    `左右拖动:60 帧,每帧(事件 → 重排文字 → 画完)中位数 ${panMed.toFixed(1)} ms、最慢 ${panMax.toFixed(1)} ms(文字层中位数 ${med(frames.lab).toFixed(1)} ms);` +
      `中心经度 ${v0.lon.toFixed(1)}° → ${v1.lon.toFixed(1)}°`,
  );
  if (!(Math.abs(v1.lon - v0.lon) > 30)) errs.push('东西相连:缩放 1 倍时左右拖不动');
  // 预算一帧 16 ms(60 帧 / 秒);CI 的虚拟机比一般电脑慢两三倍(同一段文字层重排约是本机的 3 倍),放宽到 2.5 倍
  const PAN_BUDGET = process.env.CI ? 40 : 16;
  timing('东西相连:拖动每帧(中位数)', panMed, PAN_BUDGET);

  // 2. 拖一整圈(一圈 = 缩放倍数 × 地图框宽)回到原处:画面一模一样
  await setCenter(0);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(300);
  const shotA = PNG.sync.read(await page.locator('main.stage').screenshot());
  const vA = await view();
  const P = vA.k * vA.bw;
  let halfway = NaN;
  for (let h = 0; h < 2; h++) {
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(sx + P / 2, sy, { steps: 12 });
    await page.mouse.up();
    // __wfView 在 React 画完这一帧以后才更新:慢的机器上马上读会读到上一步的(差一步 = 15°)
    await page.waitForTimeout(200);
    if (h === 0) halfway = (await view()).lon;
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  const shotB = PNG.sync.read(await page.locator('main.stage').screenshot());
  const vB = await view();
  let diff = 0;
  for (let i = 0; i < shotA.data.length; i += 4) {
    if (Math.max(Math.abs(shotA.data[i] - shotB.data[i]), Math.abs(shotA.data[i + 1] - shotB.data[i + 1]), Math.abs(shotA.data[i + 2] - shotB.data[i + 2])) > 16) diff++;
  }
  const diffPct = (diff / (shotA.width * shotA.height)) * 100;
  console.log(`拖一整圈(${P.toFixed(0)} 像素):中心 ${vA.lon.toFixed(2)}° → 半圈时 ${halfway.toFixed(2)}° → ${vB.lon.toFixed(2)}°,画面变化 ${diffPct.toFixed(3)}%`);
  if (!(Math.abs(Math.abs(halfway) - 180) < 0.5)) errs.push(`东西相连:拖半圈没转到 180°(${halfway})`);
  if (!(Math.abs(vB.lon - vA.lon) < 0.01) || !(diffPct < 0.2)) errs.push(`东西相连:拖一整圈没回到原处(画面变化 ${diffPct.toFixed(2)}%)`);

  // 3. 接缝两侧:同一个地方从视窗的不同位置点(一次在主图上,一次在右边接的那一份上),选中的是同一个州、悬停信息一样(带经度)。
  // 关掉地名、国名(字的位置随视窗变,点到字就选中字了),只比地块
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=-labels`);
  await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await page.waitForFunction(() => (window as any).__wfCiv?.ready, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(300);
  const W = 2048;
  const H = 1024;
  let pairs = 0;
  let same = 0;
  let lonHover = '';
  // 同一个世界点:一次让它落在视窗中线右边 300 像素(主图右边接的那一份上),一次落在左边 300 像素(主图上);
  // 两次都正好落在整数屏幕像素上(转中心时按它算),点到的是同一个像素
  const stage = (await page.locator('main.stage').boundingBox())!;
  const vv = await view();
  const lonOf = (x: number) => ((x / W - Math.floor(x / W)) * 360) - 180;
  // 180° 经线两边找陆地(那一带可能大半是海:从接缝往两边各找几档)
  for (let yy = 0.12; yy <= 0.88 && pairs < 6; yy += 0.04) {
    const Y = Math.round(box.y + yy * box.height);
    for (const wx of [5, W - 5, 60, W - 60, 150, W - 150]) {
      if (pairs >= 6) break;
      const got: string[] = [];
      for (const side of [1, -1]) {
        const X = Math.round(SIDE_ROOM + (stage.x + stage.width - SIDE_ROOM) / 2 + side * 280);
        const d = X - stage.x - vv.sw / 2;
        // 上一下选中后地图飞走了(国家:缩放到看全疆域):先放回原来的视图
        await page.evaluate((v) => (window as any).__wfSetView({ k: v.k, x: v.x, y: v.y }), vv);
        await page.evaluate((l) => (window as any).__wfSetCenter(l), lonOf(wx - (d * W) / (vv.k * vv.bw)));
        // 先取消选中(同一个州再选一次不会重画选中层),和上一下隔开,免得算成双击
        await page.keyboard.press('Escape');
        await page.waitForTimeout(450);
        await page.evaluate(() => ((window as any).__wfSelection = null));
        const at = [X, Y];
        await page.mouse.move(at[0], at[1]);
        await page.waitForTimeout(60);
        const hov = (await probe(page, at[0], at[1])).replace(/ \/ /g, '\n');
        await page.mouse.click(at[0], at[1]);
        await page.waitForTimeout(120);
        const sel = await page.evaluate(() => (window as any).__wfSelection);
        got.push(sel ? `${sel.kind}:${sel.id}|${hov}` : '');
        if (!lonHover) lonHover = hov.split('\n').find((l) => l.includes('经度')) ?? '';
      }
      if (!got[0]) continue; // 海上(点了是取消选中),换一处
      pairs++;
      if (got[0] === got[1]) same++;
    }
  }
  await page.keyboard.press('Escape');
  console.log(`接缝两侧点选:${pairs} 处,两种中心下选中同一个 ${same} 处;读数「${lonHover}」`);
  if (!pairs || same !== pairs) errs.push(`东西相连:接缝附近同一处从不同位置点,选中的不一样(${same}/${pairs})`);
  if (!/经度 \d+°[EW]?/.test(lonHover)) errs.push('东西相连:读数里没有经度');

  // 4. 编年史点一条:放大 3 倍、中心转到 180°,事发地不在视野里就平移过去 —— 走短边(平移量不超过半圈)
  {
    await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
    await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
    await page.waitForTimeout(300);
    await setCenter(180);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let i = 0; i < 6; i++) {
      const k = (await view()).k;
      if (k >= 2.9) break;
      // 只差一点时一下不到 50 像素,会被当成触控板平移:按着 Ctrl 滚(当成捏合,倍数 = e^(−deltaY / 100))
      const d = -Math.log(3 / k) / 0.0015;
      if (Math.abs(d) >= 50) await page.mouse.wheel(0, d);
      else {
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, -Math.log(3 / k) * 100);
        await page.keyboard.up('Control');
      }
      await page.waitForTimeout(100);
    }
    await openOverview(page, 'chronicle');
    await page.waitForSelector('.chronicle .chron-row', { timeout: 10000 });
    const rows = page.locator('.chron-list > .chron-item > .chron-row');
    const n = Math.min(12, await rows.count());
    const pans: number[] = [];
    let half = 0;
    for (let i = 0; i < n; i++) {
      // 点一条概览就收起:每条之前再打开编年史页
      await openOverview(page, 'chronicle');
      await page.evaluate(() => ((window as any).__wfPan = null));
      await rows.nth(i).click();
      await page.waitForTimeout(550);
      const pan = await page.evaluate(() => (window as any).__wfPan);
      const v = await view();
      half = (v.k * v.bw) / 2;
      if (pan) pans.push(pan.dx);
    }
    const worst = pans.length ? Math.max(...pans.map((d) => Math.abs(d))) : 0;
    console.log(`编年史跳转(东西相连):点了 ${n} 条,平移了 ${pans.length} 次,最大横向平移 ${worst.toFixed(0)} 像素(半圈 ${half.toFixed(0)} 像素)`);
    if (!pans.length) errs.push('东西相连:编年史点了好几条,地图一次都没平移过去');
    if (worst > half + 2) errs.push(`东西相连:编年史跳转绕了远路(平移 ${worst.toFixed(0)} 像素 > 半圈 ${half.toFixed(0)})`);
    // 双击:缩放复位,中央经线不变(它是这个世界的设置)。
    // 点一条编年史地图要飞 600 毫秒(机器忙时起飞也晚),上面每条只等 550 毫秒:最后一条可能还在飞,
    // 这时记下的中心不是停下来的中心。先等平移、缩放连着 300 毫秒没变(最多 5 秒)再记
    const lonEarly = (await view()).lon;
    const still = await page
      .waitForFunction(
        () => {
          const w = window as any;
          const v = w.__wfView;
          const key = `${v.k.toFixed(4)},${v.x.toFixed(1)},${v.y.toFixed(1)}`;
          const now = performance.now();
          if (w.__stillKey !== key) (w.__stillKey = key), (w.__stillAt = now);
          return now - w.__stillAt > 300;
        },
        null,
        { timeout: 5000, polling: 50 },
      )
      .then(() => true, () => false);
    const before = (await view()).lon;
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(200);
    const vr = await view();
    const dl = Math.abs(((vr.lon - before + 540) % 360) - 180);
    console.log(
      `双击复位(东西相连):编年史最后一条点完 550 毫秒时中心 ${lonEarly.toFixed(1)}°,停稳${still ? '' : '(没等到)'}后 ${before.toFixed(1)}° → 双击 k=${vr.k}、中心 ${vr.lon.toFixed(1)}°`,
    );
    if (!(vr.k === 1 && dl < 0.5))
      errs.push(`东西相连:双击没有只复位缩放(k=${vr.k},中心 ${before.toFixed(1)}° → ${vr.lon.toFixed(1)}°${still ? '' : ';双击前地图 5 秒没停稳'})`);
  }

  // 5. 手绘风:外框、罗盘、纸边做旧画在视窗上(视窗装饰层画了,地形图本身没有外框)
  const decor = await page.evaluate(() => {
    const d = document.querySelector('canvas.decor') as HTMLCanvasElement | null;
    return { shown: !!d && d.style.display !== 'none' && d.width > 0, dbg: (window as any).__wfDecor };
  });
  console.log(`视窗装饰:${JSON.stringify(decor)}`);
  if (!decor.shown) errs.push('东西相连:手绘风的外框 / 罗盘没有画在视窗上');

  // 6. 编辑地形(新建世界时):中心转到 180°(接缝在视窗正中),"山地"按住从接缝左边涂到右边 —— 涂的一笔是连着的(不横穿整张图),能照常重新生成
  {
    await page.goto(`${dev.url}/?new=1&seed=7&style=fantasy&civ=-labels`);
    await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
    await terrainOn();
    await page.evaluate(() => (window as any).__wfSetCenter(180));
    await page.waitForTimeout(250);
    await page.click('.tp [data-tool=mountain]');
    const [cx, cy] = (await page.evaluate(() => (window as any).__wfWorldToClient(0, 420))) as [number, number];
    const prev = await page.evaluate(() => (window as any).__wfTerrain?.id ?? 0);
    await page.mouse.move(cx - 70, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 70, cy + 10, { steps: 14 });
    await page.mouse.up();
    const d = await page.locator('.terrain-overlay .sk-mark path.sk-band').first().getAttribute('d').catch(() => null);
    const xs = (d ?? '').match(/-?[\d.]+/g)?.map(Number).filter((_, i) => i % 2 === 0) ?? [];
    let jump = 0;
    for (let i = 1; i < xs.length; i++) jump = Math.max(jump, Math.abs(xs[i] - xs[i - 1]));
    const regen = await page
      .waitForFunction((p) => ((window as any).__wfTerrain?.id ?? 0) > p, prev, { timeout: 60000 })
      .then(() => page.evaluate(() => (window as any).__wfTerrain), () => null);
    console.log(`编辑地形跨接缝:一笔 ${xs.length} 个点,x 从 ${xs[0]} 到 ${xs.at(-1)},相邻两点最大跳 ${jump};重新生成 ${regen ? `${regen.paintedMs.toFixed(0)} ms` : '没完成'}`);
    if (xs.length < 3 || jump > 200) errs.push(`东西相连:跨接缝涂的山地不是连着的一笔(相邻两点跳 ${jump})`);
    if (!(Math.min(...xs) < 2048 && Math.max(...xs) > 2048) && !(Math.min(...xs) < 0 && Math.max(...xs) > 0)) errs.push('东西相连:涂的山地没有跨过 180° 经线');
    if (!regen) errs.push('东西相连:跨接缝涂了山地以后没有重新生成');
  }

  // 7. 导出:中心转到 90°E 导出地图图片(不带地名),图片中部 = 地形图左右转四分之一圈
  {
    await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=-labels`);
    await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => (window as any).__wfSetCenter(90));
    await page.waitForTimeout(200);
    const terrain = await page.evaluate(() => {
      const cv = document.querySelector('.map-box canvas') as HTMLCanvasElement;
      return { w: cv.width, h: cv.height, px: Array.from(cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data) };
    });
    await closeOverview();
    await page.click('.export-btn');
    await page.click('.export-scale button:nth-child(1)');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.export-item[data-job=map]')]);
    const file = await dl.path();
    const png = PNG.sync.read((await import('node:fs')).readFileSync(file!));
    const sp = terrain.w / 4;
    let bad = 0;
    let n = 0;
    for (let y = Math.floor(terrain.h * 0.36); y < terrain.h * 0.64; y += 3) {
      for (let x = Math.floor(terrain.w * 0.3); x < terrain.w * 0.7; x += 3) {
        const i = (y * png.width + x) * 4;
        const j = (y * terrain.w + ((x + sp) % terrain.w)) * 4;
        n++;
        if (Math.max(Math.abs(png.data[i] - terrain.px[j]), Math.abs(png.data[i + 1] - terrain.px[j + 1]), Math.abs(png.data[i + 2] - terrain.px[j + 2])) > 12) bad++;
      }
    }
    await closeOverview();
    console.log(`导出(中心 90°E):${png.width}×${png.height},中部和地形图转四分之一圈对不上的像素 ${((bad / n) * 100).toFixed(2)}%`);
    if (png.width !== 2048 || bad / n > 0.01) errs.push(`东西相连:导出没有按当前视图中心展开(${((bad / n) * 100).toFixed(1)}% 对不上)`);
  }
}

// 放大后的文明细节层:国家视图放大到 8 倍 → 细节层开着,画在不缩放的屏幕层里、画布像素 = 屏幕像素(不在被 CSS 放大的地图框里),
// 被放大的文明底图藏起来,色块、国界画出来了;放大后回放每帧耗时(回放时按粗一点的格画,停下来补细的);缩回 1 倍细节层关掉、底图回来
if (part('文明细节层')) {
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const mb = (await page.locator('.map-box').boundingBox())!;
  const st = (await page.locator('main.stage').boundingBox())!;
  // 有鸿皇朝靠边的地方(第 3000 年;陆地上有色块、国界)
  await page.mouse.move(st.x + (st.width - mb.width) / 2 + mb.width * 0.4, mb.y + mb.height * 0.67);
  for (let i = 0; i < 40 && (await page.evaluate(() => (window as any).__wfView.k)) < 8; i++) {
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(30);
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  // 细节层在后台备料(分帧),备好了才换上
  const settled = () =>
    page.waitForFunction(() => !(window as any).__wfDetail?.pending && !(window as any).__wfCivDetail?.pending, null, { timeout: 30000 }).catch(() => {});
  await settled();
  const d = await page.evaluate(() => {
    const w = window as any;
    const cv = document.querySelector('canvas.civ-detail') as HTMLCanvasElement;
    const r = cv.getBoundingClientRect();
    const low = document.querySelector('.map-box-upper canvas.civ') as HTMLCanvasElement;
    // 画了东西:取样看有没有不透明的像素
    const px = cv.width ? cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data : new Uint8ClampedArray(0);
    let lit = 0;
    let n = 0;
    for (let i = 3; i < px.length; i += 4 * 101) {
      n++;
      if (px[i] > 8) lit++;
    }
    return {
      ...w.__wfCivDetail,
      inScreen: !!cv.closest('.screen-layer') && !cv.closest('.map-box, .map-box-upper'),
      shown: getComputedStyle(cv).display !== 'none',
      // 画布像素 / 屏幕上的 CSS 像素 = 像素密度(按屏幕像素画,不是被 CSS 放大的)
      ratio: cv.width / r.width,
      dpr: window.devicePixelRatio,
      lowHidden: getComputedStyle(low).visibility === 'hidden',
      litFrac: n ? lit / n : 0,
    };
  });
  console.log(
    `放大 ${d.k?.toFixed(1)} 倍:文明细节层 ${d.on ? '开' : '关'}(画布 ${d.w}×${d.h},画布像素 / 屏幕像素 ${d.ratio?.toFixed(2)},在屏幕层里 ${d.inScreen}),` +
      `重画 ${d.ms?.toFixed(0)} ms(色块 ${d.wash?.toFixed(0)}、符号遮罩 ${d.ink?.toFixed(0)}),上了色的取样 ${(d.litFrac * 100).toFixed(0)}%;被放大的底图藏起来 ${d.lowHidden}`,
  );
  if (!d.on || !d.shown) errs.push('文明细节层:放大到 8 倍后没有打开');
  if (!d.inScreen) errs.push('文明细节层:画布不在屏幕层里(放在被 CSS 放大的地图框里,Safari 会按低分辨率显示)');
  if (!(Math.abs(d.ratio - d.dpr) < 0.05)) errs.push(`文明细节层:不是按屏幕像素画的(画布像素 / 屏幕像素 ${d.ratio},像素密度 ${d.dpr})`);
  if (!d.lowHidden) errs.push('文明细节层:被放大的文明底图没有藏起来(会叠在上面发糊)');
  if (!(d.litFrac > 0.05)) errs.push('文明细节层:放大后没画出色块 / 国界');
  // 放大后回放:每帧(细节层重画)耗时;回放中按粗一点的格画,停下来补细的
  await page.click('.timebar .tb-speed button:has-text("4×")');
  await page.click('.timebar button.tb-play');
  const fr = await page.evaluate(async () => {
    const w = window as any;
    const ms: number[] = [];
    const steps: number[] = [];
    let last: unknown = null;
    const t0 = performance.now();
    while (performance.now() - t0 < 2500) {
      await new Promise((r) => requestAnimationFrame(r));
      const c = w.__wfCivDetail;
      if (c && c !== last && c.drew && c.fast) {
        ms.push(c.ms);
        steps.push(c.step);
      }
      last = c;
    }
    return { ms, steps };
  });
  await page.click('.timebar button.tb-play');
  await page.waitForTimeout(600);
  await settled();
  const dEnd = await page.evaluate(() => (window as any).__wfCivDetail);
  const fs = [...fr.ms].sort((a, b) => a - b);
  const med = fs[fs.length >> 1] ?? NaN;
  console.log(
    `放大后回放:${fs.length} 帧,细节层每帧中位数 ${med.toFixed(1)} ms、最慢 ${(fs.at(-1) ?? NaN).toFixed(1)} ms(格宽 ${fr.steps[0]?.toFixed(1)} CSS 像素);` +
      `停下来后格宽 ${dEnd?.step?.toFixed(1)}`,
  );
  if (fs.length < 5) errs.push('文明细节层:放大后回放没有跟着年份重画');
  timing('文明细节层:放大后回放每帧(中位数)', med, REPLAY_BUDGET);
  if (!(dEnd?.step <= 1.01) || dEnd?.fast) errs.push('文明细节层:回放停下来后没有按细格补画');
  // 缩回 1 倍:细节层关掉,被放大的底图回来
  await page.evaluate(() => (window as any).__wfSetView({ k: 1, x: 0, y: 0 }));
  await page.waitForTimeout(400);
  const back = await page.evaluate(() => ({ on: (window as any).__wfCivDetail?.on, low: getComputedStyle(document.querySelector('.map-box-upper canvas.civ')!).visibility }));
  if (back.on || back.low === 'hidden') errs.push(`文明细节层:缩回 1 倍后没有关掉(${JSON.stringify(back)})`);
}

// 多种投影:弹层里切到罗宾森(切换耗时)→ 点一座城 → 详情是这座城;左右拖 = 转中央经线;弹层里的中央经线滑条;
// 改中央经线 → 刷新后投影和中心都还在;导出罗宾森图片(尺寸、外轮廓外是底色、里面有图)
if (part('多种投影')) {
  const { PNG } = await import('pngjs');
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
  await page.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const view = () => page.evaluate(() => (window as any).__wfView);
  // 1. 切到罗宾森:地形、文明层、文字都按投影重画;量"点下去 → 画完"的耗时
  await openProj();
  const t0 = Date.now();
  await page.click('.lp-proj[data-proj=robinson]');
  const switched = await page
    .waitForFunction(() => (window as any).__wfLabels?.proj === 'robinson' && (window as any).__wfLabels?.fitted && (window as any).__wfCivProj?.proj === 'robinson', null, { timeout: 10000 })
    .then(() => true, () => false);
  const switchMs = Date.now() - t0;
  const lab = await page.evaluate(() => (window as any).__wfLabels);
  const projNow = await page.locator('.lp-pop .lp-proj.on').getAttribute('data-proj').catch(() => '');
  await page.keyboard.press('Escape');
  if (projNow !== 'robinson') errs.push(`投影:切到罗宾森后图层弹层里选中的投影不是罗宾森(${projNow})`);
  console.log(`切到罗宾森:${switched ? `${switchMs} ms 画完` : '没画完'};文字 ${lab?.drawn} 条、国名 ${lab?.polities} 个、城镇符号 ${lab?.marks} 个`);
  if (!switched) errs.push('投影:切到罗宾森以后地图没有按投影重画');
  // 整个世界一眼看全时只给大国写国名(seed 7 第 3000 年:几个大帝国占了大半,写得下两三个)
  if (!(lab?.polities >= 2 && lab?.marks > 5)) errs.push('投影:罗宾森里国名、城镇符号没画出来');
  // 2. 点一座城(城镇符号)→ 详情面板是这座城
  const pk = await page.evaluate(() => {
    const all = (window as any).__wfPickables() as { kind: string; id: number; text: string; x: number; y: number }[];
    const names = all.filter((p) => p.kind === 'settlement' && p.text);
    // 在侧栏卡片右边那一块里的
    const sideW = document.querySelector('.sidebar')?.getBoundingClientRect().right ?? 0;
    for (const n of names) {
      const m = all.find((p) => p.kind === 'mark' && p.id === n.id && p.x > sideW + 20 && p.x < innerWidth - 20);
      if (m) return { name: n.text, x: m.x, y: m.y };
    }
    return null;
  });
  let insp = '';
  if (pk) {
    await page.mouse.click(pk.x, pk.y);
    await page.waitForSelector('.inspector', { timeout: 5000 }).catch(() => {});
    insp = (await page.locator('.inspector').innerText().catch(() => '')).replace(/\n/g, ' / ');
  }
  console.log(`罗宾森里点城「${pk?.name ?? '(没找到)'}」→ 详情「${insp.slice(0, 40)}」`);
  if (!pk || !insp.includes(pk.name)) errs.push('投影:罗宾森里点一座城,详情不是这座城');
  // 详情面板"设为中心":中央经线转到这座城
  if (pk) {
    await page.click('.inspector [data-act=set-center]');
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Escape');
  // 3. 左右拖 = 转中央经线(整图重投影);悬停信息照常(点城时地图飞过去放大了:先放回整张图)
  await page.evaluate(() => (window as any).__wfSetView({ k: 1, x: 0, y: 0 }));
  await page.waitForTimeout(300);
  const c0 = (await view()).lon;
  const mb = (await page.locator('.map-box').boundingBox())!;
  await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(mb.x + mb.width * 0.62, mb.y + mb.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const c1 = (await view()).lon;
  await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.45);
  await page.waitForTimeout(200);
  const hov = await page.locator('.hover').innerText().catch(() => '');
  console.log(`罗宾森里左右拖:中央经线 ${c0.toFixed(1)}° → ${c1.toFixed(1)}°;悬停「${hov.split('\n')[0]}」`);
  if (Math.abs(((c1 - c0 + 540) % 360) - 180) < 20) errs.push('投影:罗宾森里左右拖动没有转中央经线');
  if (!hov) errs.push('投影:罗宾森里悬停没有信息');
  // 3b. 放大后左右拖:细节层(放大后按屏幕像素重画的那一层)不藏起来,跟着整块平移;松手后按新的中央经线重画
  await page.mouse.move(mb.x + mb.width * 0.5, mb.y + mb.height * 0.5);
  for (let i = 0; i < 40 && (await view()).k < 8; i++) {
    await page.mouse.wheel(0, -200);
    await page.waitForTimeout(30);
  }
  // 放大后两层细节层在后台备料:等画上去了再拖(慢的机器上备得久,还没画上去时拖,头几步本来就是放大的整图,不是拖动把它藏了)
  const zoomSettleMs = await mapSettled();
  const kz = (await view()).k;
  const zoomedOn = await page.evaluate(() => [!!(window as any).__wfDetail?.on, !!(window as any).__wfCivDetail?.on]);
  if (!zoomedOn[0] || !zoomedOn[1]) errs.push(`投影:罗宾森放大到 ${kz.toFixed(1)} 倍、停稳以后细节层没有画上去(地形 ${zoomedOn[0]}、文明 ${zoomedOn[1]})`);
  let dHidden = 0;
  let dSlid = 0;
  let cHidden = 0;
  /** 哪几步藏起来了(d = 地形细节层,c = 文明细节层) */
  const hidAt: string[] = [];
  await page.mouse.down();
  for (let s = 1; s <= 15; s++) {
    await page.mouse.move(mb.x + mb.width * (0.5 - (0.2 * s) / 15), mb.y + mb.height * 0.5);
    await page.waitForTimeout(16);
    const d = await page.evaluate(() => ({ ...(window as any).__wfDetail, shown: (document.querySelector('canvas.detail') as HTMLElement).style.display !== 'none' }));
    if (!d.on || !d.shown) {
      dHidden++;
      hidAt.push(`d${s}`);
    } else if (d.slide) dSlid++;
    // 文明细节层跟着一起平移,不藏起来
    const c = await page.evaluate(() => ({ ...(window as any).__wfCivDetail, shown: (document.querySelector('canvas.civ-detail') as HTMLElement).style.display !== 'none' }));
    if (!c.on || !c.shown) {
      cHidden++;
      hidAt.push(`c${s}`);
    }
  }
  await page.mouse.up();
  await page.waitForTimeout(400);
  // 按新中心重画是在后台分段备料的:等两层都画上去
  await page
    .waitForFunction(() => !(window as any).__wfDetail?.pending && !(window as any).__wfCivDetail?.pending, null, { timeout: 15000 })
    .catch(() => {});
  const dEnd = await page.evaluate(() => (window as any).__wfDetail);
  const lonEnd = (await view()).lon;
  console.log(
    `罗宾森放大 ${kz.toFixed(1)} 倍(等细节层画上 ${zoomSettleMs.toFixed(0)} ms)左右拖:15 步里细节层藏起来 ${dHidden} 次、整块平移 ${dSlid} 次(文明细节层藏起来 ${cHidden} 次${hidAt.length ? `;藏在 ${hidAt.join(' ')}` : ''});` +
      `松手后按 ${dEnd?.lon?.toFixed(1)}°(中央经线 ${lonEnd.toFixed(1)}°)重画`,
  );
  if (dHidden) errs.push('投影:罗宾森放大后左右拖动时细节层藏起来了(露出放大的整图,发糊)');
  if (cHidden) errs.push('投影:罗宾森放大后左右拖动时文明细节层藏起来了(露出放大的文明底图,发糊)');
  if (!dSlid) errs.push('投影:罗宾森放大后左右拖动时细节层没有跟着平移');
  if (!dEnd?.on || dEnd.slide || Math.abs(dEnd.lon - lonEnd) > 1e-6) errs.push('投影:罗宾森放大后拖完,细节层没有按新的中央经线重画');
  const cEnd = await page.evaluate(() => (window as any).__wfCivDetail);
  if (!cEnd?.on || cEnd.slide || Math.abs(cEnd.lon - lonEnd) > 1e-6) errs.push('投影:罗宾森放大后拖完,文明细节层没有按新的中央经线重画');
  await page.evaluate(() => (window as any).__wfSetView({ k: 1, x: 0, y: 0 }));
  await page.waitForTimeout(300);
  // 4. 只用左键:右键不出菜单;弹层里的中央经线滑条转到 −120°(显示"120°W")
  await page.mouse.click(mb.x + mb.width * 0.3, mb.y + mb.height * 0.5, { button: 'right' });
  const ctx = await page.locator('.ctx-menu').count();
  await openProj();
  await page.evaluate(() => {
    const el = document.querySelector('.lp-center input') as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '-120');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const lonLabel = await page.locator('.lp-center b').innerText().catch(() => '');
  await page.keyboard.press('Escape');
  const c2 = (await view()).lon;
  console.log(`右键菜单 ${ctx} 个;中央经线滑条 → ${c2.toFixed(1)}°(显示「${lonLabel}」)`);
  if (ctx) errs.push('投影:右键还会出菜单(只用左键)');
  if (Math.abs(c2 + 120) > 0.5 || lonLabel !== '120°W') errs.push(`投影:弹层里的中央经线滑条没有转过去(${c2},${lonLabel})`);
  // 5. 改中心(和弹层里的中央经线滑条走同一个入口 requestMapCenter)→ 刷新后投影、中心都还在
  await page.evaluate(() => (window as any).__wfSetCenter(75));
  await page.waitForTimeout(700);
  const url = page.url();
  await page.reload();
  await page.waitForFunction(() => (window as any).__wfLabels?.proj === 'robinson', null, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(300);
  const vr = await view();
  const on = await projOn(page);
  console.log(`改中心 75° 后刷新(${url.split('?')[1]}):投影 ${vr?.proj}(弹层 ${on}),中心 ${vr?.lon?.toFixed(1)}°`);
  if (vr?.proj !== 'robinson' || on !== 'robinson' || Math.abs((vr?.lon ?? 0) - 75) > 0.5) errs.push('投影:改了投影和中央经线,刷新后没留住');
  // 6. 换中心 / 换投影重画耗时(每次:地形 + 文明层重铺 + 国名重新拟合 + 排字)
  const redraw = await page.evaluate(async () => {
    const w = window as any;
    const ms: number[] = [];
    for (const lon of [100, 130, 160, -170, -140]) {
      const t = performance.now();
      w.__wfSetCenter(lon);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      ms.push(performance.now() - t);
    }
    for (const p of ['mollweide', 'mercator', 'naturalEarth', 'robinson']) {
      const t = performance.now();
      w.__wfSetProjection(p);
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      ms.push(performance.now() - t);
    }
    return ms;
  });
  const worstRedraw = Math.max(...redraw);
  console.log(`换中心 / 换投影重画:${redraw.map((x) => x.toFixed(0)).join('、')} ms(最慢 ${worstRedraw.toFixed(0)} ms,预算 300 ms)`);
  // 地图铺满全屏后地图框约是原来的两倍大(1400×820 的窗口里 1640×820,原来约 1126×563),重画跟着慢一倍;
  // CI 的虚拟机又比本机慢两三倍、偶尔一次卡到 1 秒多,上限放宽到 2 倍。本机仍按 900 ms
  const REDRAW_LIMIT = process.env.CI ? 1800 : 900;
  timing('投影:换中心 / 换投影重画(最慢一次)', worstRedraw, REDRAW_LIMIT);
  // 7. 导出罗宾森图片:尺寸对,四角在外轮廓外(底色),正中有图(和底色不同、颜色有变化)
  await closeOverview();
  await page.click('.export-btn');
  await page.click('.export-scale button:nth-child(1)');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.click('.export-item[data-job=map]')]);
  const png = PNG.sync.read((await import('node:fs')).readFileSync((await dl.path())!));
  await closeOverview();
  const px = (x: number, y: number) => {
    const i = (Math.floor(y) * png.width + Math.floor(x)) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const corner = px(png.width * 0.02, png.height * 0.03);
  let varied = 0;
  let last = '';
  for (let y = png.height * 0.3; y < png.height * 0.7; y += 37) {
    for (let x = png.width * 0.3; x < png.width * 0.7; x += 41) {
      const c = px(x, y).join(',');
      if (c !== last) varied++;
      last = c;
    }
  }
  const paper = [0xef, 0xe2, 0xc2];
  const cornerPaper = corner.every((v, i) => Math.abs(v - paper[i]) < 40);
  console.log(`导出罗宾森:${png.width}×${png.height},角上 ${corner.join(',')}(纸色 ${cornerPaper}),中部取样 ${varied} 种颜色变化`);
  if (png.width !== 2048 || png.height !== 1024) errs.push(`投影:导出的罗宾森图片尺寸不对(${png.width}×${png.height})`);
  if (!cornerPaper || varied < 20) errs.push('投影:导出的罗宾森图片不对(外轮廓外不是底色,或中部是空白)');
  // 8. 新建世界时平常的地图一直是等距圆柱(改地形只在等距圆柱上改;新建界面右边的投影只换星球的样子),
  //    改地形时右边的投影停在等距圆柱、点不了;没创建就回到我的世界,换回原来的罗宾森
  await page.goto(`${dev.url}/?new=1&seed=7&style=fantasy&proj=robinson`);
  await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await terrainOn();
  await page.waitForTimeout(300);
  const onAfter = await page.evaluate(() => (window as any).__wfView?.proj);
  const rowOn = await page.locator('.st-right [data-proj][aria-checked=true]').getAttribute('data-proj').catch(() => null);
  const rowsOff = await page.locator('.st-right [data-proj=robinson]').isDisabled();
  await page.click('.tp [data-act=terrain-done]');
  await page.waitForTimeout(1200);
  await page.click('.st-left [data-act=back]');
  await page.locator('.mw').waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(300);
  const projHome = await page.evaluate(() => (window as any).__wfView?.proj);
  console.log(`罗宾森里新建、改地形 → 平常的地图 ${onAfter}、右边 ${rowOn}(点不了 ${rowsOff});回到我的世界 → ${projHome}`);
  if (onAfter !== 'equirect') errs.push('投影:新建世界改地形时平常的地图不是等距圆柱');
  if (projHome !== 'robinson') errs.push(`投影:没创建就回到我的世界,没有换回原来的罗宾森(${projHome})`);
  if (rowOn !== 'equirect' || !rowsOff) errs.push(`投影:改地形时新建界面右边的投影应停在等距圆柱、点不了(${rowOn},${rowsOff})`);
  await page.evaluate(() => localStorage.clear());
}

// 触控板和鼠标滚轮(平面地图):鼠标滚轮一格照旧缩放;触控板捏合跟着手指缩放(Chrome 把捏合报成按着 Ctrl 的滚轮);
// 触控板两指滑动 = 平移、不缩放;手指在侧栏卡片上捏合,浏览器不放大整个网页
if (part('触控板')) {
  const tp = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  tp.on('pageerror', (e) => errs.push(`触控板:${e.message}`));
  const cdp = await tp.context().newCDPSession(tp);
  await tp.goto(`${dev.url}/?seed=7`);
  await tp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await tp.waitForTimeout(300);
  const st = (await tp.locator('main.stage').boundingBox())!;
  const x = Math.round(st.x + SIDE_ROOM + (st.width - SIDE_ROOM) / 2);
  const y = Math.round(st.y + st.height / 2);
  type V = { k: number; x: number; y: number; lon: number };
  const view = () => tp.evaluate(() => ({ ...(window as any).__wfView })) as Promise<V>;
  const wheel = (dx: number, dy: number) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
  const pinch = (px: number, py: number, scaleFactor: number) =>
    cdp.send('Input.synthesizePinchGesture', { x: Math.round(px), y: Math.round(py), scaleFactor, relativeSpeed: 400, gestureSourceType: 'mouse' });
  const v0 = await view();
  await wheel(0, -100);
  await tp.waitForTimeout(400);
  const v1 = await view();
  await pinch(x, y, 2);
  await tp.waitForTimeout(400);
  const v2 = await view();
  // 停一会儿再滑(和上面的滚轮不连成一串):往右上推,地图往左上走
  await tp.waitForTimeout(400);
  for (let i = 0; i < 20; i++) await wheel(6, 4);
  await tp.waitForTimeout(400);
  const v3 = await view();
  const sb = (await tp.locator('.sidebar').boundingBox())!;
  await pinch(sb.x + sb.width / 2, sb.y + sb.height / 2, 2);
  await tp.waitForTimeout(400);
  const pageScale = await tp.evaluate(() => window.visualViewport?.scale ?? 1);
  const v4 = await view();
  const dLon = ((v3.lon - v2.lon + 540) % 360) - 180;
  console.log(
    `触控板:滚轮一格 ${(v1.k / v0.k).toFixed(3)} 倍;捏合张开 2 倍 → ${(v2.k / v1.k).toFixed(3)} 倍;` +
      `两指滑动 (120, 80) → 缩放 ${(v3.k / v2.k).toFixed(3)} 倍、中心经度 ${dLon.toFixed(1)}°、上下 ${(v3.y - v2.y).toFixed(0)};侧栏上捏合 → 网页 ${pageScale.toFixed(2)} 倍、地图 ${(v4.k / v3.k).toFixed(3)} 倍`,
  );
  if (!(Math.abs(v1.k / v0.k - Math.exp(0.15)) < 0.01)) errs.push(`鼠标滚轮:一格应该放大约 1.16 倍(${(v1.k / v0.k).toFixed(3)})`);
  if (!(Math.abs(v2.k / v1.k - 2) < 0.05)) errs.push(`触控板:手指张开 2 倍,地图应该也放大 2 倍(${(v2.k / v1.k).toFixed(3)})`);
  if (v3.k !== v2.k) errs.push('触控板:两指滑动不该缩放');
  if (!(dLon > 5)) errs.push(`触控板:两指往右滑,地图应该往左走(中心经度 ${dLon.toFixed(1)}°)`);
  if (!(Math.abs(v3.y - v2.y + 80) < 2)) errs.push(`触控板:两指往上推 80 像素,地图应该往上走 80 像素(${(v3.y - v2.y).toFixed(0)})`);
  if (pageScale !== 1) errs.push(`触控板:侧栏上捏合,浏览器把整个网页放大了(${pageScale.toFixed(2)} 倍)`);
  if (v4.k !== v3.k) errs.push('触控板:侧栏上捏合不该缩放地图');
  await tp.close();
}

// 3D 地球仪:从平面主图打开的耗时(网址记下 proj=globe)、转动每帧耗时(无头浏览器是软件渲染,量一个上限);拖动转了、拖动不算单击;
// 悬停有信息;单击一座城 → 详情是这座城;时间轴拖到早年 → 文明层贴图重新上传、球上画面变了;
// 回放世界形成在球上放;导出菜单里的"导出地球仪这一面"、双击回正;切回平面地图时中心经度接上;没有 WebGL2(globe=cpu)时退回 CPU 画、不白屏
if (part('地球仪')) {
  const { PNG } = await import('pngjs');
  // 无头浏览器里 WebGL2 走软件渲染(SwiftShader),新版 Chromium 要显式允许
  const gBrowser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const gp = await gBrowser.newPage({ viewport: { width: 1400, height: 820 } });
  gp.on('pageerror', (e) => errs.push(`地球仪:${e.message}`));
  gp.on('console', (m) => m.type() === 'error' && errs.push(`地球仪:${m.text()}`));
  const G = () => gp.evaluate(() => (window as any).__wfGlobe);
  type Img = ReturnType<typeof PNG.sync.read>;
  const shot = async (): Promise<Img> => PNG.sync.read(await gp.locator('.globe').screenshot());
  const diff = (a: Img, b: Img) => {
    let n = 0;
    let bad = 0;
    for (let i = 0; i < Math.min(a.data.length, b.data.length); i += 4 * 7) {
      n++;
      if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 24) bad++;
    }
    return bad / Math.max(1, n);
  };
  // 从平面主图点"地球仪"打开(地形图已经画好;打开的耗时 = 编译着色器 + 上传贴图 + 画第一帧)
  await gp.goto(`${dev.url}/?seed=7&style=fantasy&civ=polities`);
  await gp.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await gp.click('button.globe-toggle');
  const opened = await gp.waitForFunction(() => (window as any).__wfGlobe?.ready, null, { timeout: 60000 }).then(() => true, () => false);
  // 网址记下投影(proj=globe;稍等一下,投影、中心停下来半秒才写)
  const urlOk = await gp.waitForFunction(() => /[?&]proj=globe/.test(location.search), null, { timeout: 5000 }).then(() => true, () => false);
  if (!urlOk) errs.push('地球仪:打开后网址里没有 proj=globe(刷新会回到平面地图)');
  await gp.waitForFunction(() => (window as any).__wfGlobe?.marks > 5, null, { timeout: 30000 }).catch(() => {});
  const g0 = await G();
  console.log(`地球仪:${g0?.renderer}(${g0?.gpu}),打开 ${g0?.openMs?.toFixed(0)} ms,贴图上传 ${JSON.stringify(g0?.upload)},符号 ${g0?.marks}、文字 ${g0?.labels}`);
  if (!opened) errs.push('地球仪没有打开');
  if (!(await gp.locator('.canvas-wrap').isHidden())) errs.push('地球仪打开时平面主图没有藏起来');
  if (!(g0?.marks > 5)) errs.push('地球仪上没有城镇符号');
  // 每帧耗时(着色器 + 符号文字层,等显卡画完,全分辨率):无头浏览器是软件渲染,只量一个上限 ——
  // 本机约 25 ms,CI 的虚拟机(SwiftShader 不带 LLVM)约 300 ms;真显卡上约 1–2 ms(scripts/globe-snap.ts --gpu --bench)。
  // 这里只防"慢了一个数量级"的退步;转动时还会按帧间隔自动降分辨率
  const bench = await gp.evaluate(() => (window as any).__wfGlobeBench(20));
  console.log(`地球仪每帧(${bench.renderer},${bench.w}×${bench.h}):中位数 ${bench.median.toFixed(1)} ms、p90 ${bench.p90.toFixed(1)} ms、最慢 ${bench.max.toFixed(1)} ms`);
  if (bench.renderer === 'webgl2') timing('地球仪每帧(中位数)', bench.median, 1000);

  // 拖动:经度变了;拖动不算单击
  const gb = (await gp.locator('.globe').boundingBox())!;
  const cx = gb.x + gb.width / 2;
  const cy = gb.y + gb.height * 0.48;
  await gp.mouse.move(cx, cy);
  await gp.mouse.down();
  for (let i = 1; i <= 8; i++) await gp.mouse.move(cx - i * 25, cy + i * 4);
  await gp.waitForTimeout(120);
  await gp.mouse.up();
  await gp.waitForTimeout(400);
  const g1 = await G();
  const dLon = ((g1.lon - g0.lon + 540) % 360) - 180;
  console.log(`拖动 200 像素(转动时分辨率比例 ${g1.q?.toFixed(2)}):经度 ${g0.lon.toFixed(1)}° → ${g1.lon.toFixed(1)}°,纬度 ${g0.lat.toFixed(1)}° → ${g1.lat.toFixed(1)}°`);
  if (!(dLon > 10)) errs.push('地球仪:往左拖没有往东转');
  if (await gp.locator('.inspector').count()) errs.push('地球仪:拖动被当成了单击');

  // 触控板两指往右滑:和往左拖一样往东转、不缩放;捏合张开 1.5 倍 → 球也放大 1.5 倍
  {
    const cdp = await gp.context().newCDPSession(gp);
    await gp.waitForTimeout(400);
    const a = await G();
    for (let i = 0; i < 20; i++) await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.round(cx), y: Math.round(cy), deltaX: 10, deltaY: 0 });
    await gp.waitForTimeout(400);
    const b = await G();
    await cdp.send('Input.synthesizePinchGesture', { x: Math.round(cx), y: Math.round(cy), scaleFactor: 1.5, relativeSpeed: 400, gestureSourceType: 'mouse' });
    await gp.waitForTimeout(400);
    const c = await G();
    const swipe = ((b.lon - a.lon + 540) % 360) - 180;
    console.log(`地球仪触控板:两指往右滑 200 像素 → 经度 ${swipe.toFixed(1)}°、缩放 ${(b.k / a.k).toFixed(3)} 倍;捏合张开 1.5 倍 → ${(c.k / b.k).toFixed(3)} 倍`);
    if (!(swipe > 10) || b.k !== a.k) errs.push('地球仪:触控板两指往右滑应该往东转、不缩放');
    if (!(Math.abs(c.k / b.k - 1.5) < 0.05)) errs.push(`地球仪:手指张开 1.5 倍,球应该也放大 1.5 倍(${(c.k / b.k).toFixed(3)})`);
    // 回到原来的大小,免得影响后面的单击、回正
    await cdp.send('Input.synthesizePinchGesture', { x: Math.round(cx), y: Math.round(cy), scaleFactor: 1 / 1.5, relativeSpeed: 400, gestureSourceType: 'mouse' });
    await gp.waitForTimeout(400);
  }

  // 悬停
  await gp.mouse.move(cx + 30, cy - 20);
  await gp.waitForTimeout(200);
  const hov = await gp.locator('.hover-card').innerText().catch(() => '');
  console.log('地球仪悬停:', hov.replace(/\n/g, ' / ') || '(无)');
  if (!hov.trim()) errs.push('地球仪:悬停小卡片没有出现');

  // 单击一座城(正面中间一带、侧栏卡片挡不到的地方)→ 详情是这座城
  type GMark = { id: number; name: string; x: number; y: number; d: number };
  const marks = ((await gp.evaluate('window.__wfGlobeMarks()')) as GMark[]).filter((m) => m.name && m.d > 0.5 && m.x > SIDE_ROOM + 40 && m.x < gb.x + gb.width - 120 && m.y > gb.y + 120 && m.y < gb.y + gb.height - 160);
  let picked = '';
  let panel = '';
  for (const m of marks.slice(0, 6)) {
    await gp.mouse.click(m.x, m.y);
    panel = await gp.locator('.inspector .ins-name').innerText({ timeout: 2000 }).catch(() => '');
    if (panel.includes(m.name)) {
      picked = m.name;
      break;
    }
    await gp.keyboard.press('Escape');
    // 等转到这座城的飞行停下再点下一个
    await gp.waitForTimeout(700);
  }
  console.log(`地球仪单击城:候选 ${marks.length} 个,点到「${picked || '—'}」,详情「${panel.replace(/\n/g, ' ')}」`);
  if (!picked) errs.push('地球仪:单击城镇符号没有打开这座城的详情');
  await gp.keyboard.press('Escape');
  // 等球停稳(约 0.6 秒)
  await gp.waitForTimeout(700);

  // 时间轴拖到早年:文明层贴图重新上传,球上画面变了;拖动时每帧(文明底图 + 上传 + 画一帧)耗时
  const before = await shot();
  const ver0 = (await G()).civVer;
  const scrub = await gp.evaluate(async () => {
    const w = window as any;
    const ms: number[] = [];
    let last: unknown = null;
    let lastG: unknown = null;
    const t0 = performance.now();
    // 像用户一样按住时间轴的轨道往左拖(按在基线上,不是菱形那一行)
    const el = document.querySelector('.timebar .tb-track') as HTMLElement;
    const r = el.getBoundingClientRect();
    // (这里不定义具名函数:tsx 会给它包一层页面里没有的 __name)
    const ev = { bubbles: true, pointerId: 7, button: 0, clientX: r.right, clientY: r.top + 30 };
    el.dispatchEvent(new PointerEvent('pointerdown', ev));
    let i = 0;
    while (performance.now() - t0 < 1500) {
      // 每帧挪一点(从结束年份往前拖)
      el.dispatchEvent(new PointerEvent('pointermove', { ...ev, clientX: r.left + r.width * (1 - Math.min(1, i++ / 60) * 0.7) }));
      await new Promise((r) => requestAnimationFrame(r));
      const c = w.__wfCiv;
      const g = w.__wfGlobe;
      if (c && c !== last && g && g !== lastG) ms.push(c.ms + (g.upload.civ ?? 0) + g.frameMs);
      last = c;
      lastG = g;
    }
    // 最后停在第 30% 年(慢的机器上一秒半拖不了几帧:保证和开始时差得够远)
    el.dispatchEvent(new PointerEvent('pointermove', { ...ev, clientX: r.left + r.width * 0.3 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...ev, clientX: r.left + r.width * 0.3 }));
    return ms;
  });
  await gp.waitForTimeout(800);
  const after = await shot();
  const ver1 = (await G()).civVer;
  const sorted = [...scrub].sort((a, b) => a - b);
  const d = diff(before, after);
  console.log(`地球仪拖时间轴:${scrub.length} 帧,每帧(文明底图 + 上传贴图 + 画球)中位数 ${(sorted[sorted.length >> 1] ?? NaN).toFixed(1)} ms、最慢 ${(sorted.at(-1) ?? NaN).toFixed(1)} ms;文明底图画了 ${ver1 - ver0} 次,画面变了 ${(d * 100).toFixed(1)}%`);
  if (!(ver1 > ver0) || !(d > 0.01)) errs.push('地球仪:拖时间轴后文明层贴图没有变');
  if (!(scrub.length >= 3)) errs.push('地球仪:拖时间轴时文明层没有跟着画');

  // 回放世界形成:回放帧盖到球上
  await replayClick(gp);
  const replayed = await gp.waitForFunction(() => (window as any).__wfGlobe?.replay > 0.9 && (window as any).__wfGlobe?.upload?.replay !== undefined, null, { timeout: 30000 }).then(() => true, () => false);
  console.log('地球仪回放世界形成:', replayed ? '回放帧上了球' : '没有');
  if (!replayed) errs.push('地球仪:回放世界形成没有在球上放');
  await gp.waitForFunction(() => /第 \d+ 年/.test(document.querySelector('.caption .big')?.textContent ?? ''), null, { timeout: 30000 }).catch(() => {});

  // 球上没有按钮(回正靠双击、经纬网在图层弹层里、导出在导出菜单里);导出菜单里多一项"导出地球仪这一面"
  const globeBtns = await gp.locator('.globe button').count();
  if (globeBtns) errs.push(`地球仪:球上还有按钮(${globeBtns} 个)`);
  await closeOverview(gp);
  await gp.click('.export-btn');
  const globeItem = await gp.locator('.export-item[data-job=globe]').innerText().catch(() => '');
  const [dl] = await Promise.all([gp.waitForEvent('download', { timeout: 30000 }).catch(() => null), gp.click('.export-item[data-job=globe]')]);
  const ex = await gp.evaluate(() => (window as any).__wfGlobeExport);
  await closeOverview(gp);
  console.log(`地球仪导出:菜单项「${globeItem.replace(/\n/g, ' ')}」`, JSON.stringify(ex), dl ? dl.suggestedFilename() : '(没有下载)');
  if (!globeItem.includes('导出地球仪这一面')) errs.push('地球仪:导出菜单里没有"导出地球仪这一面"');
  if (!dl || !/地球仪/.test(dl.suggestedFilename()) || !(ex?.w >= 1000)) errs.push('地球仪:导出这一面没有下载图片');
  // 双击回正:北在上、赤道居中
  await gp.evaluate(() => (window as any).__wfGlobeSet(40, 50, 1.4));
  await gp.waitForTimeout(200);
  {
    const b = (await gp.locator('.globe').boundingBox())!;
    await gp.mouse.dblclick(b.x + b.width / 2, b.y + b.height / 2);
  }
  await gp.waitForTimeout(1000);
  const reset = await G();
  console.log(`双击回正:纬度 50° → ${reset.lat?.toFixed(1)}°,缩放 1.4 → ${reset.k?.toFixed(2)}`);
  if (!(Math.abs(reset.lat) < 1 && Math.abs(reset.k - 1) < 0.02)) errs.push(`地球仪:双击没有回正(纬度 ${reset.lat},缩放 ${reset.k})`);
  await gp.keyboard.press('Escape');

  // 切回平面地图:中心经度接上
  const gl = (await G()).lon;
  await gp.click('button.globe-toggle');
  await gp.waitForTimeout(400);
  const fv = await gp.evaluate(() => (window as any).__wfView);
  const off = Math.abs(((fv.lon - gl + 540) % 360) - 180);
  console.log(`切回平面地图:地球仪中心 ${gl.toFixed(1)}° → 主图中心 ${fv.lon.toFixed(1)}°`);
  if (!(await gp.locator('.canvas-wrap').isVisible()) || (await gp.locator('.globe').count())) errs.push('地球仪:切回平面地图后主图没有出来');
  if (!(off < 2)) errs.push(`地球仪:切回平面地图后中心经度没有接上(差 ${off.toFixed(1)}°)`);

  // 投影切换里的"地球仪":罗宾森 → 地球仪(从罗宾森的中心转起)→ 右下角按钮切回罗宾森(中心接上)→ 点一座城照常;
  // 经纬网只有一个开关(在图层弹层里;开了以后地球仪上也画经纬网)
  {
    await pickProj(gp, 'robinson');
    await gp.waitForFunction(() => (window as any).__wfLabels?.proj === 'robinson' && (window as any).__wfLabels?.fitted, null, { timeout: 15000 }).catch(() => {});
    await gp.evaluate(() => (window as any).__wfSetCenter(60));
    await gp.waitForTimeout(300);
    await pickProj(gp, 'globe');
    await gp.waitForFunction(() => (window as any).__wfGlobe?.ready, null, { timeout: 60000 }).catch(() => {});
    await gp.waitForTimeout(300);
    const glon = (await G()).lon;
    await openLayers(gp);
    await gp.keyboard.press('Escape');
    const gratShot0 = await shot();
    await openLayers(gp);
    await gp.click('.lp-pop [data-act=graticule]');
    await gp.keyboard.press('Escape');
    await gp.waitForTimeout(300);
    const gratDiff = diff(gratShot0, await shot());
    const gratOn = (await G()).graticule ? 'on' : 'off';
    await openLayers(gp);
    await gp.click('.lp-pop [data-act=graticule]');
    await gp.keyboard.press('Escape');
    // 地球仪转一下再切回
    await gp.evaluate(() => (window as any).__wfGlobeSet(100, 10, 1));
    await gp.waitForTimeout(400);
    await gp.click('button.globe-toggle');
    await gp.waitForFunction(() => (window as any).__wfLabels?.proj === 'robinson' && (window as any).__wfLabels?.fitted, null, { timeout: 15000 }).catch(() => {});
    await gp.waitForTimeout(300);
    const on = await projOn(gp);
    const back = await gp.evaluate(() => (window as any).__wfView);
    const pk = await gp.evaluate(() => {
      const all = (window as any).__wfPickables() as { kind: string; id: number; text: string; x: number; y: number }[];
      const sideW = document.querySelector('.sidebar')?.getBoundingClientRect().right ?? 0;
      for (const n of all.filter((p) => p.kind === 'settlement' && p.text)) {
        const m = all.find((p) => p.kind === 'mark' && p.id === n.id && p.x > sideW + 20 && p.x < innerWidth - 20);
        if (m) return { name: n.text, x: m.x, y: m.y };
      }
      return null;
    });
    let insp = '';
    if (pk) {
      await gp.mouse.click(pk.x, pk.y);
      await gp.waitForSelector('.inspector', { timeout: 5000 }).catch(() => {});
      insp = await gp.locator('.inspector').innerText().catch(() => '');
      await gp.keyboard.press('Escape');
    }
    console.log(
      `罗宾森 → 地球仪:中心 60° → 球朝 ${glon?.toFixed(1)}°;经纬网共用 ${gratOn}(画面变了 ${(gratDiff * 100).toFixed(1)}%);转到 100° 切回 → ${on},中心 ${back?.lon?.toFixed(1)}°;点城「${pk?.name}」→ 详情 ${insp.includes(pk?.name ?? '---')}`,
    );
    if (Math.abs(((glon - 60 + 540) % 360) - 180) > 2) errs.push('投影 × 地球仪:切到地球仪时没有朝着当前的中央经线');
    if (gratOn !== 'on' || !(gratDiff > 0.002)) errs.push(`投影 × 地球仪:弹层里开了经纬网,地球仪上没有跟着画(${gratOn},画面变了 ${(gratDiff * 100).toFixed(2)}%)`);
    if (on !== 'robinson') errs.push('投影 × 地球仪:从地球仪切回来没有回到罗宾森');
    if (Math.abs(((back?.lon - 100 + 540) % 360) - 180) > 2) errs.push('投影 × 地球仪:从地球仪切回罗宾森,中心没有接上');
    if (!pk || !insp.includes(pk.name)) errs.push('投影 × 地球仪:切回罗宾森后点城,详情不是这座城');
  }

  // 高清贴图(两倍像素密度的屏幕):缩放 1 倍时不起后台线程(换画风也不起);放大到 1.5 倍以上才铺;
  // 缩回 1 倍以后留着;换画风再换回来直接用,不重铺;换世界才扔
  {
    const hp = await gBrowser.newPage({ viewport: { width: 1400, height: 820 }, deviceScaleFactor: 2 });
    hp.on('pageerror', (e) => errs.push(`地球仪高清贴图:${e.message}`));
    const H = () => hp.evaluate(() => (window as any).__wfGlobe);
    await hp.goto(`${dev.url}/?seed=7&style=realistic&view=globe`);
    await hp.waitForFunction(() => (window as any).__wfGlobe?.ready, null, { timeout: 60000 });
    await hp.waitForTimeout(1500);
    const a = await H();
    await pickLayer(hp, 'terrain');
    await hp.waitForFunction(() => (window as any).__wfGlobe?.style === 'fantasy', null, { timeout: 30000 });
    await hp.waitForTimeout(1000);
    const b = await H();
    await pickLayer(hp, 'realistic');
    await hp.waitForFunction(() => (window as any).__wfGlobe?.style === 'realistic', null, { timeout: 30000 });
    // 放大到 1.8 倍:后台铺高清,铺好换上
    await hp.evaluate(() => (window as any).__wfGlobeSet(20, 20, 1.8));
    const got = await hp.waitForFunction(() => (window as any).__wfGlobe?.tier === 2, null, { timeout: 90000 }).then(() => true, () => false);
    const c = await H();
    // 缩回 1 倍:留着
    await hp.evaluate(() => (window as any).__wfGlobeSet(20, 20, 1));
    await hp.waitForTimeout(500);
    const d = await H();
    // 换手绘(1 倍,不铺)再换回写实:直接用留着的那张
    await pickLayer(hp, 'terrain');
    await hp.waitForFunction(() => (window as any).__wfGlobe?.style === 'fantasy', null, { timeout: 30000 });
    await hp.waitForTimeout(800);
    const e = await H();
    await pickLayer(hp, 'realistic');
    await hp.waitForFunction(() => (window as any).__wfGlobe?.style === 'realistic', null, { timeout: 30000 });
    await hp.waitForTimeout(500);
    const f = await H();
    // 换世界(把另一颗星球的存档文件拖进页面,在地球仪上直接打开):扔掉,1 倍时也不重铺
    await closeOverview(hp);
    const op = await gBrowser.newPage({ viewport: { width: 1400, height: 820 } });
    // 存档里记着投影:在地球仪上存的,打开时才留在地球仪上
    await op.goto(`${dev.url}/?seed=2024&style=realistic&view=globe`);
    await op.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
    await op.click('.save-btn');
    const [odl] = await Promise.all([op.waitForEvent('download', { timeout: 30000 }), op.click('[data-act=save-file]')]);
    const ofile = await odl.path();
    // 下载的文件跟着这一页的浏览器环境走,关页面会删掉:先读完再关
    if (ofile) await openFile(hp, ofile);
    await op.close();
    await hp.waitForFunction(() => (window as any).__wfGlobe?.hdCached === 0 && (window as any).__wf?.ready && /seed=2024/.test(location.search), null, { timeout: 60000 }).catch(() => {});
    await hp.waitForTimeout(1500);
    const g = await H();
    const row = (x: any) => `${x.style} ${x.k.toFixed(1)} 倍:第 ${x.tier} 档,起过 ${x.hdStarted} 次、留着 ${x.hdCached} 张`;
    console.log(`地球仪高清贴图(两倍像素密度):打开 ${row(a)};换手绘 ${row(b)};放大 ${row(c)}(${c.hiMs?.toFixed(0)} ms);缩回 ${row(d)};换手绘 ${row(e)};换回写实 ${row(f)};换世界 ${row(g)}`);
    if (a.hdStarted !== 0 || b.hdStarted !== 0) errs.push('地球仪:缩放 1 倍时起了高清贴图的后台线程');
    if (!got || c.hdStarted !== 1) errs.push('地球仪:放大到 1.8 倍没有换上高清贴图');
    if (d.tier !== 2) errs.push('地球仪:缩回 1 倍后高清贴图没有留着');
    if (e.hdStarted !== 1 || e.tier !== 1) errs.push('地球仪:1 倍时换画风起了后台线程');
    if (f.tier !== 2 || f.hdStarted !== 1) errs.push('地球仪:换回铺过高清的画风没有直接用留着的那张');
    if (g.hdCached !== 0 || g.tier !== 1 || g.hdStarted !== 1) errs.push('地球仪:换世界后高清贴图没有扔掉,或 1 倍时又去铺了');
    await hp.close();
  }

  // 地球仪按投影重画:手绘的山丘等符号每帧正立着画(贴图里不带)、写实风换上不打光 + 坡度的贴图(后台画好换上);
  // 宽屏左边浮着侧栏卡片:球心一直往右挪卡片宽的一半(选中国家、关掉面板都不变);事件标签钉在球上的事发地,转到背面就藏起来
  {
    const pp = await gBrowser.newPage({ viewport: { width: 1400, height: 820 } });
    pp.on('pageerror', (e) => errs.push(`地球仪按投影重画:${e.message}`));
    const P = () => pp.evaluate(() => (window as any).__wfGlobe);
    await pp.goto(`${dev.url}/?seed=7&style=fantasy&view=globe`);
    await pp.waitForFunction(() => (window as any).__wfGlobe?.ready, null, { timeout: 60000 });
    await pp.evaluate(() => (window as any).__wfGlobeSet(0, -80, 1));
    await pp.waitForTimeout(400);
    const f1 = await P();
    // 写实:先用主图那张,后台画好换上
    await pickLayer(pp, 'realistic');
    const relit = await pp.waitForFunction(() => (window as any).__wfGlobe?.style === 'realistic' && (window as any).__wfGlobe?.relief, null, { timeout: 60000 }).then(() => true, () => false);
    const r1 = await P();
    // 面板:选中球上的一个名字 → 球心不挪(面板在侧栏里);Esc 关掉 → 还在原处(都在卡片右边那一块的正中)
    const name = r1.texts[0];
    await pp.evaluate((n) => (window as any).__wfGlobeSelectName(n), name);
    await pp.waitForTimeout(900);
    const s1 = (await P()).shift;
    await pp.keyboard.press('Escape');
    await pp.waitForTimeout(900);
    const s2 = (await P()).shift;
    console.log(
      `地球仪按投影重画:手绘南极 ${f1.tex} 贴图、正立符号 ${f1.glyphs} 个(${f1.glyphMs?.toFixed(1)} ms);写实 ${r1.tex} 贴图、重新打光 ${r1.relief}(后台 ${r1.texMs?.toFixed(0)} ms);` +
        `选中「${name}」球心 ${s1} → 关掉 ${s2}`,
    );
    if (f1.tex !== 'globe' || !(f1.glyphs > 50)) errs.push('地球仪:手绘风的山丘等符号没有在球上正立着画');
    if (!relit || r1.tex !== 'globe') errs.push('地球仪:写实风没有换上重新打光的贴图');
    if (Math.abs(s1 - SIDE_ROOM / 2) > 1 || Math.abs(s2 - SIDE_ROOM / 2) > 1) errs.push(`地球仪:球心应往右挪侧栏卡片宽的一半(${SIDE_ROOM / 2}),选中、关掉都不变(${s1} → ${s2})`);
    // 事件标签:点侧栏里的最近大事(球转到事发地,那一条的标签停约 5 秒)→ 标签在球上(在球的圆盘里),转到对面就藏起来
    // (不靠播放:CI 上软件渲染一帧几百毫秒,放到下一件大事要很久)
    await pp.goto(`${dev.url}/?seed=7&style=fantasy&view=globe`);
    await pp.waitForFunction(() => (window as any).__wfGlobe?.ready, null, { timeout: 60000 });
    const pinAt = () =>
      pp.evaluate(() => {
        const el = [...document.querySelectorAll('.ev-pin')].find((e) => (e as HTMLElement).style.visibility === 'visible') as HTMLElement | undefined;
        if (!el) return null;
        const r = el.querySelector('.ev-ring')!.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, text: el.textContent ?? '' };
      });
    const recentRows = pp.locator('.sidebar .sb-row.ev');
    if (await recentRows.count()) await recentRows.last().click();
    const seen = await pp.waitForFunction(() => [...document.querySelectorAll('.ev-pin')].some((e) => (e as HTMLElement).style.visibility === 'visible'), null, { timeout: 20000 }).then(() => true, () => false);
    // 等球转到事发地(约 0.65 秒)再量位置
    if (seen) await pp.waitForTimeout(1200);
    const pin = seen ? await pinAt() : null;
    let inDisk = false;
    let hidden = false;
    if (pin) {
      const gb = (await pp.locator('.globe').boundingBox())!;
      const g = await P();
      const R = 0.43 * Math.min(gb.width, gb.height) * g.k;
      inDisk = Math.hypot(pin.x - (gb.x + gb.width / 2 + g.shift), pin.y - (gb.y + gb.height * 0.48)) < R;
      // 转到对面(经度 + 180°、纬度反过来):这个标签藏起来(原来在背面的别的标签这时可能转到了正面)
      await pp.evaluate(([lon, lat]) => (window as any).__wfGlobeSet(lon + 180, -lat), [g.lon, g.lat]);
      await pp.waitForTimeout(600);
      hidden = await pp.evaluate(
        (t) => [...document.querySelectorAll('.ev-pin')].filter((e) => e.textContent === t).every((e) => (e as HTMLElement).style.visibility !== 'visible'),
        pin.text,
      );
    }
    console.log(`地球仪事件标签:${pin ? `「${pin.text.slice(0, 30)}」在球上 ${inDisk}、转到对面藏起来 ${hidden}` : '没出现'}`);
    if (!pin || !inDisk) errs.push('地球仪:点最近事件后球上的事发地没有事件标签');
    if (pin && !hidden) errs.push('地球仪:事件标签转到球的背面还在');
    await pp.close();
  }

  // 没有 WebGL2:退回 CPU 画,不白屏(旧网址 view=globe 照样打开地球仪)
  await gp.goto(`${dev.url}/?seed=2024&style=realistic&view=globe&globe=cpu`);
  const cpuOk = await gp.waitForFunction(() => (window as any).__wfGlobe?.ready, null, { timeout: 60000 }).then(() => true, () => false);
  // 状态在顶部提示条上(不在球上另写一行)
  const cpuToast = await gp
    .waitForFunction(() => [...document.querySelectorAll('.toast-main')].some((e) => e.textContent?.includes('兼容画法')), null, { timeout: 8000 })
    .then(() => true, () => false);
  const gc = await G();
  const img = await shot();
  const at = (x: number, y: number) => {
    const i = (Math.round(y) * img.width + Math.round(x)) * 4;
    return [img.data[i], img.data[i + 1], img.data[i + 2]];
  };
  const mid = at(img.width / 2, img.height * 0.48);
  console.log(`CPU 画法:${gc?.renderer},打开 ${gc?.openMs?.toFixed(0)} ms,一帧 ${gc?.frameMs?.toFixed(0)} ms,球心颜色 ${mid},顶部提示 ${cpuToast}`);
  if (!cpuToast) errs.push('地球仪:CPU 画法时顶部没有提示');
  if (!cpuOk || gc?.renderer !== 'cpu') errs.push('地球仪:CPU 画法没有打开');
  if (mid[0] + mid[1] + mid[2] < 60) errs.push('地球仪:CPU 画法球上是黑的');
  await gBrowser.close();
}

// 手机布局(390×844,触屏):底部是收起的世界卡片(搜索框 + 世界名一行),时间轴胶囊浮在它上面、一行;右上竖排图层、标记、地球、助手四个按钮;
// 右下没有 + −、操作提示是"双指缩放"、悬停卡片不出来;往上拖世界卡片 → 拉到顶(四个大按钮、整个世界,胶囊藏起来)→ 点拖动条收起;
// 拉到顶后点"改地形" → 卡片收起;
// 双指捏合 → 地图比例变了;点国家 → 详情卡片升到半屏(胶囊跟上去,国家落在胶囊上方)→ 往上拖拉到顶 → 干预 → 结盟 → 点名牌 → 已生效 → 撤销;
// 图层抽屉(从底部升起)切到实景;点世界名打开概览,国家列表点一国;搜索框打字(卡片拉到顶)点一条
if (part('手机布局')) {
  type Pick = { kind: string; id: number; text: string; x: number; y: number };
  type Plate = { kind: string; id: number; text: string; note: string; x: number; y: number; on: boolean; self: boolean };
  const VW = 390;
  const VH = 844;
  const mctx = await browser.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  mp.on('pageerror', (e) => errs.push(`手机:${e.message}`));
  const cdp = await mctx.newCDPSession(mp);
  const touch = (type: string, pts: [number, number][]) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) } as never);
  /** 手指从 a 滑到 b(一根或两根手指,按 steps 步) */
  const swipe = async (a: [number, number][], b: [number, number][], steps = 10) => {
    await touch('touchStart', a);
    for (let i = 1; i <= steps; i++) {
      await touch(
        'touchMove',
        a.map(([x, y], j) => [x + ((b[j][0] - x) * i) / steps, y + ((b[j][1] - y) * i) / steps]),
      );
      await mp.waitForTimeout(20);
    }
    await touch('touchEnd', []);
  };
  const mToast = (id: string) => mp.locator(`.toast[data-toast=${id}]`).innerText({ timeout: 3000 }).then((t) => t.replace(/\n/g, ' '), () => '');
  const box = (sel: string) => mp.locator(sel).first().boundingBox().catch(() => null);
  /** 地图停稳:平移、缩放连着 300 毫秒没变(飞行动画放完);最多等 5 秒 */
  const mapStill = () =>
    mp
      .waitForFunction(
        () => {
          const w = window as any;
          const v = w.__wfView;
          const key = `${v.k.toFixed(4)},${v.x.toFixed(1)},${v.y.toFixed(1)}`;
          const now = performance.now();
          if (w.__stillKey !== key) (w.__stillKey = key), (w.__stillAt = now);
          return now - w.__stillAt > 300;
        },
        null,
        { timeout: 5000, polling: 50 },
      )
      .catch(() => {});
  type Rect = { x: number; y: number; width: number; height: number } | null;
  // 地图中心转到西经 50°(lon=-50):种子 7 第 2600 年的有桂皇朝落在屏幕中间一带,下面点国家、选结盟的国家都点得到
  await mp.goto(`${dev.url}/?seed=7&civYear=2600&lon=-50`);
  await mp.waitForFunction(() => (window as any).__wfLabels?.polities > 0, null, { timeout: 60000 });
  await mp.waitForTimeout(600);
  // 骨架:收起的世界卡片在最底、胶囊在它上面、右上两个按钮
  const PEEK = 108;
  const row = await box('.bottom-row');
  const track = await box('.tb-track');
  const ws0 = await box('.psheet');
  const sub = await mp.locator('.ps-row .sb-sub').innerText().catch(() => '');
  const btns = await box('.phone-btns .pb-group');
  const btnActs = await mp.locator('.phone-btns [data-act]').evaluateAll((els) => els.map((e) => e.getAttribute('data-act')).join(','));
  const hint0 = await mp.locator('.first-hint').innerText().catch(() => '');
  const zoomBtns = await mp.locator('[data-act=zoom-in], [data-act=zoom-out], .map-controls').count();
  // 往上拖世界名那一行 → 拉到顶;点拖动条 → 收起
  const wRow = await box('.ps-title');
  let wsFull: Rect = null;
  let tiles = 0;
  let capsuleHidden = false;
  let ws1: Rect = null;
  let gripTaps = 0;
  let gripClicks = 0;
  if (wRow) {
    await swipe([[wRow.x + 60, wRow.y + wRow.height / 2]], [[wRow.x + 60, wRow.y + wRow.height / 2 - 420]]);
    await mp.waitForTimeout(500);
    wsFull = await box('.psheet.ps-full');
    tiles = await mp.locator('.ps-tiles > *').count();
    capsuleHidden = !(await mp.locator('.bottom-row').isVisible());
    // 机器很忙时,浏览器偶尔会把模拟的一下轻点吞掉(按下、抬起都到了,却不出 click):没收到 click 就再点一次(最多三次);
    // 收到了 click 卡片却没收起,才是拖动条的毛病
    await mp.evaluate(() =>
      window.addEventListener('click', (e) => (e.target as Element).closest?.('.psheet .sheet-grip') && ((window as any).__gripClicks = ((window as any).__gripClicks ?? 0) + 1), true),
    );
    const peeked = () => mp.locator('.psheet.ps-peek').waitFor({ timeout: 3000 }).then(() => true, () => false);
    do {
      gripTaps++;
      await mp.tap('.psheet .sheet-grip');
    } while (!(await peeked()) && !(await mp.evaluate(() => (window as any).__gripClicks)) && gripTaps < 3);
    await mp.waitForTimeout(500);
    ws1 = await mp.locator('.psheet.ps-peek').boundingBox({ timeout: 1000 }).catch(() => null);
    gripClicks = await mp.evaluate(() => (window as any).__gripClicks ?? 0);
    // 没收起:用脚本收起,下面捏合、拖动照样查得了(不然手指都落在拉到顶的卡片上)
    if (!ws1 && (await mp.locator('.psheet.ps-full').count())) {
      await mp.locator('.psheet .sheet-grip').dispatchEvent('click');
      await mp.waitForTimeout(500);
    }
  }
  // 双指捏合:两指从中间往两边分开 → 放大;中点下的地方还在中点下
  const k0 = (await mp.evaluate(() => (window as any).__wfView)).k;
  const mid0 = await mp.evaluate(([x, y]) => (window as any).__wfClientToWorld(x, y), [195, 380]);
  await swipe(
    [
      [150, 380],
      [240, 380],
    ],
    [
      [90, 380],
      [300, 380],
    ],
  );
  await mp.waitForTimeout(300);
  const k1 = (await mp.evaluate(() => (window as any).__wfView)).k;
  const mid1 = await mp.evaluate(([x, y]) => (window as any).__wfClientToWorld(x, y), [195, 380]);
  const hint1 = await mp.locator('.first-hint').count();
  // 单指拖动:平移
  const vA = await mp.evaluate(() => (window as any).__wfView);
  await swipe([[200, 300]], [[140, 330]]);
  await mp.waitForTimeout(200);
  const vB = await mp.evaluate(() => (window as any).__wfView);
  const panned = Math.abs(vB.x - vA.x) > 20 || Math.abs(vB.y - vA.y) > 10;
  // 手指点两下:回正
  await mp.touchscreen.tap(195, 250);
  await mp.waitForTimeout(80);
  await mp.touchscreen.tap(197, 252);
  await mp.waitForTimeout(500);
  const kReset = (await mp.evaluate(() => (window as any).__wfView)).k;
  await mp.evaluate(() => (window as any).__wfSelect('polity', -1));
  await mp.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await mp.waitForTimeout(300);
  // 点国家 → 底部抽屉半高;国家落在抽屉上方
  // 等地图停稳(双击回正有动画,机器慢时还在动)再取国名的位置
  for (let i = 0, last = ''; i < 40; i++) {
    const v = JSON.stringify(await mp.evaluate(() => (window as any).__wfView));
    if (v === last) break;
    last = v;
    await mp.waitForTimeout(150);
  }
  // 国名旁边 30 像素内有城镇符号等别的可点之物的不挑:手指点偏一点就点成了城(字体不同,国名的位置会差几个像素)
  const picks = (await mp.evaluate('window.__wfPickables()')) as Pick[];
  const pol = picks
    .filter((q) => q.kind === 'polity' && q.x > 40 && q.x < VW - 40 && q.y > 130 && q.y < VH - 200)
    .filter((q) => !picks.some((o) => o !== q && Math.hypot(o.x - q.x, o.y - q.y) < 30))
    .sort((a, b) => Math.abs(a.x - VW / 2) + Math.abs(a.y - VH / 2) - Math.abs(b.x - VW / 2) - Math.abs(b.y - VH / 2))[0];
  let sheet0: Rect = null;
  let row1: Rect = null;
  let fullCapsuleHidden = false;
  let sheet1: Rect = null;
  let ring: Rect = null;
  let hover = 0;
  let info = '';
  let full = false;
  let cmds = 0;
  let pickToast = '';
  let hiddenWhilePicking = false;
  let doneToast = '';
  let undoToast = '';
  let tgtText = '';
  let plateN = 0;
  let pickLeft = false;
  if (pol) {
    await mp.touchscreen.tap(pol.x, pol.y);
    await mp.waitForTimeout(1100);
    hover = await mp.locator('.hover-card').count();
    sheet0 = await box('.inspector.sheet');
    row1 = await box('.bottom-row');
    ring = await box('.tp-mark .tp-ring');
    info = (await mp.locator('.inspector').innerText().catch(() => '')).replace(/\n/g, ' / ');
    // 往上拖拖动条 → 展开
    const grip = await box('.inspector .sheet-grip');
    if (grip) {
      await swipe([[VW / 2, grip.y + grip.height / 2]], [[VW / 2, grip.y + grip.height / 2 - 260]]);
      await mp.waitForTimeout(500);
      full = /sheet-full/.test((await mp.locator('.inspector').getAttribute('class')) ?? '');
      sheet1 = await box('.inspector.sheet');
      fullCapsuleHidden = !(await mp.locator('.bottom-row').isVisible());
    }
    // 干预 → 结盟 → 点名牌
    if (!(await mp.locator('.inspector [data-act=intervene]').count())) throw new Error(`手机:点「${pol.text}」(${Math.round(pol.x)}, ${Math.round(pol.y)})没出国家卡片:${info.slice(0, 80)}`);
    await mp.tap('.inspector [data-act=intervene]');
    await mp.waitForTimeout(300);
    cmds = await mp.locator('.inspector .cp-cmd').count();
    if (await mp.locator('.inspector .cp-cmd[data-cmd=ally]').isEnabled().catch(() => false)) {
      await mp.tap('.inspector .cp-cmd[data-cmd=ally]');
      // 选目标时地图会飞到看得见这些国家的地方(机器慢时要好一会儿):等名牌出来、地图停稳了再挑,不然点的是半路上的位置
      await mp.waitForFunction(() => (window as any).__wfPlates().some((p: Plate) => !p.self), null, { timeout: 10000 }).catch(() => {});
      await mapStill();
      pickToast = await mToast('pick');
      hiddenWhilePicking = !(await mp.locator('.inspector').isVisible().catch(() => false));
      const plates = ((await mp.evaluate('window.__wfPlates()')) as Plate[]).filter((p) => !p.self);
      plateN = plates.length;
      const tgt = plates
        .filter((p) => p.x > 30 && p.x < VW - 30 && p.y > 150 && p.y < VH - 120)
        .sort((a, b) => Math.abs(a.y - VH / 2) - Math.abs(b.y - VH / 2))[0];
      if (tgt) {
        tgtText = tgt.text;
        const prev = await mp.evaluate(() => (window as any).__wfResim?.seq ?? 0);
        await mp.touchscreen.tap(tgt.x, tgt.y);
        await pushOrders(mp, true);
        await mp.waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prev, { timeout: 20000 }).catch(() => null);
        await mp.waitForTimeout(300);
        doneToast = await mToast('resim-done');
        const prev2 = await mp.evaluate(() => (window as any).__wfResim?.seq ?? 0);
        // 提示条 7 秒后自己收起;机器很忙时这一下轻点可能等到它收起都没点上(按钮中途重画过),就直接点它的按钮
        await mp
          .tap('.toast[data-toast=resim-done] .toast-act', { timeout: 3000 })
          .catch(() => mp.locator('.toast[data-toast=resim-done] .toast-act').dispatchEvent('click', undefined, { timeout: 2000 }))
          .catch(() => {});
        await mp.waitForFunction((s) => ((window as any).__wfResim?.seq ?? 0) > s, prev2, { timeout: 20000 }).catch(() => null);
        await mp.waitForTimeout(300);
        undoToast = await mToast('resim-done');
      }
      // 没挑到 / 没点中目标还在选:取消,下面的步骤照常走(没生效由下面的检查报出来)
      pickLeft = (await mp.locator('.toast[data-toast=pick]').count()) > 0;
      if (pickLeft) {
        await mp.keyboard.press('Escape');
        await mp.waitForTimeout(300);
      }
    }
  }
  // 图层抽屉:从底部升起、铺满宽度;切到卫星(抽屉不收),再点图层按钮收起
  await mp.tap('[data-act=layers]');
  await mp.waitForTimeout(400);
  const lp = await box('.lp-pop');
  await mp.tap('.lp-pop [data-base=satellite]');
  await mp.waitForFunction(() => (window as any).__wf?.style === 'realistic', null, { timeout: 10000 }).catch(() => {});
  await mp.waitForTimeout(300);
  const dark = await mp.locator('.app').getAttribute('data-theme');
  const lpOpen = (await mp.locator('.lp-pop').count()) === 1;
  await mp.tap('[data-act=layers]');
  await mp.waitForTimeout(300);
  const lpClosed = lpOpen && !(await mp.locator('.lp-pop').count());
  // 概览:关掉详情卡片,点世界卡片上的世界名 → 概览;国家列表点一国 → 概览收起、详情卡片里是这国
  await mp.tap('.inspector .cp-x', { timeout: 5000 }).catch(() => {});
  await mp.waitForTimeout(400);
  // 关掉以后应当回到世界卡片;没回来时记下当时的样子(选中着什么、图层抽屉和提示条还在不在),按 Esc 取消选中接着查
  const afterX = await mp.evaluate(() => ({
    sheet: !!document.querySelector('.psheet'),
    ins: (document.querySelector('.inspector') as HTMLElement | null)?.innerText.slice(0, 30).replace(/\n/g, ' ') ?? null,
    lp: !!document.querySelector('.lp-pop'),
    toasts: [...document.querySelectorAll<HTMLElement>('.toast')].map((e) => e.dataset.toast),
  }));
  if (!afterX.sheet) {
    await mp.keyboard.press('Escape');
    await mp.waitForTimeout(400);
  }
  // 上面撤销结盟、重推完以后时间轴从 2600 年接着放;国家表按那一年的州数排,两国州数交错的那几年先后跟着换,
  // 读第一行和点下去之间可能已经换了一国(放到哪一年看机器快慢,偶发)。
  // 先点胶囊上的暂停键,让表停在一年上;点的时候也按国家编号点读到的那一行
  const ovPlaying = (await mp.locator('.bottom-row .tb-play.on:not([disabled])').count()) > 0;
  if (ovPlaying) {
    await mp.tap('.bottom-row .tb-play.on').catch(() => {});
    await mp.locator('.bottom-row .tb-play.on').waitFor({ state: 'detached', timeout: 3000 }).catch(() => {});
  }
  const ovYear = (await mp.locator('.bottom-row .tb-year').first().innerText().catch(() => '')).replace(/\s+/g, '');
  await mp.tap('.psheet [data-act=overview]', { timeout: 5000 }).catch(() => {});
  await mp.waitForTimeout(400);
  const ovId = await mp.locator('.ov-row').first().getAttribute('data-polity', { timeout: 5000 }).catch(() => null);
  const ovRow = mp.locator(`.ov-row[data-polity="${ovId}"]`);
  const ovName = await ovRow.locator('.ov-name').innerText().catch(() => '');
  const ovRowText = (await ovRow.innerText().catch(() => '')).replace(/\n/g, ' ');
  await ovRow.tap().catch(() => {});
  await mp.waitForTimeout(900);
  const ovClosed = !(await mp.locator('.ov-root:not([hidden])').count());
  const ovIns = await mp.locator('.inspector').innerText().catch(() => '');
  // 搜索:点世界卡片上的搜索框打字 → 卡片拉到顶、下面是搜索结果;点一条 → 详情卡片里是它
  await mp.tap('.inspector .cp-x').catch(() => {});
  await mp.waitForTimeout(400);
  await mp.tap('.psheet [data-act=search]');
  await mp.keyboard.type((ovName || pol?.text || '王').slice(0, 1));
  await mp.waitForTimeout(500);
  const sb = await box('.psheet .sb-search');
  const searchFull = (await mp.locator('.psheet.ps-full').count()) === 1;
  const hit = mp.locator('.psheet .search-row').first();
  const hitName = await hit.locator('.search-name').innerText().catch(() => '');
  await hit.tap().catch(() => {});
  await mp.waitForTimeout(900);
  const searchIns = await mp.locator('.inspector').innerText().catch(() => '');
  // 拉到顶的世界卡片里点"我的世界":整屏换成我的世界(改过的这个世界在里面);点"新建世界" → 新建界面,底部是新建世界的卡片;
  // 拉开卡片点"编辑地形" → 卡片里换成编辑地形的工具;点"完成"退回(关掉详情卡片时世界卡片还是搜索时拉到顶的样子)
  await mp.tap('.inspector .cp-x').catch(() => {});
  await mp.waitForTimeout(400);
  if (!(await mp.locator('.psheet.ps-full').count())) {
    await mp.tap('.psheet .sheet-grip').catch(() => {});
    await mp.waitForTimeout(500);
  }
  const homeFull = (await mp.locator('.psheet.ps-full .ps-tiles [data-act=home]').count()) === 1;
  await mp.tap('.psheet .ps-tiles [data-act=home]').catch(() => {});
  await mp.locator('.mw').waitFor({ timeout: 5000 }).catch(() => {});
  const homeBox = await box('.mw');
  await civsTab(mp);
  const homeCards = await mp.locator('.mw [data-act=open-world]').count();
  await mp.tap('.mw [data-act=new-world] >> nth=0').catch(() => {});
  await dialogStart(mp, true).catch(() => {});
  await studioReady(mp).catch(() => {});
  const nwBox = await box('.st-sheet');
  await mp.tap('.st-sheet [data-act=new-sheet]').catch(() => {});
  await mp.waitForTimeout(400);
  await mp.locator('.st-sheet [data-act=terrain]:not([disabled])').waitFor({ timeout: 60000 }).catch(() => {});
  await mp.tap('.st-sheet [data-act=terrain]').catch(() => {});
  await mp.waitForTimeout(400);
  // 随机生成的第 1 步(地图)底部是「保存地图」「地图做好了，下一步」
  const nwTools = (await mp.locator('.st-sheet.tools .tp').isVisible().catch(() => false)) && !(await mp.locator('.st-sheet [data-act=to-civ]').count());
  await mp.tap('.tp [data-act=terrain-done]').catch(() => {});
  await mp.waitForTimeout(400);
  const nwBack = !(await mp.locator('.tp').count()) && (await mp.locator('.st-sheet [data-act=to-civ]').isVisible().catch(() => false));
  console.log(
    `手机布局:胶囊 ${JSON.stringify(row)},轨道 ${JSON.stringify(track)};世界卡片 ${JSON.stringify(ws0)}「${sub}」;右上 ${btnActs} ${JSON.stringify(btns)};提示「${hint0}」;+ − ${zoomBtns} 个;` +
      `上拖 → 拉到顶 ${JSON.stringify(wsFull)}、大按钮 ${tiles} 个、胶囊藏起 ${capsuleHidden};点拖动条${gripTaps > 1 ? `(点了 ${gripTaps} 次)` : ''} → 收起 ${JSON.stringify(ws1)};` +
      `捏合 k ${k0.toFixed(2)} → ${k1.toFixed(2)}(中点下 ${mid0?.map((v: number) => v.toFixed(0))} → ${mid1?.map((v: number) => v.toFixed(0))});单指拖动 ${panned};点两下回正 k ${kReset.toFixed(2)};` +
      `点「${pol?.text}」→ 详情卡片 ${JSON.stringify(sheet0)}、胶囊 ${JSON.stringify(row1)}、国都圆环 ${JSON.stringify(ring)}、悬停卡片 ${hover};上拖 → 拉到顶 ${full} ${JSON.stringify(sheet1)}、胶囊藏起 ${fullCapsuleHidden};` +
      `干预页 ${cmds} 条;结盟提示「${pickToast}」、卡片藏起 ${hiddenWhilePicking};点「${tgtText}」→「${doneToast}」;撤销 →「${undoToast}」;` +
      `图层抽屉 ${JSON.stringify(lp)} → 卫星 ${dark}、收起 ${lpClosed};概览(${ovYear}${ovPlaying ? ',在放 → 先暂停' : ''})「${ovRowText}」→ 收起 ${ovClosed};搜索框 ${JSON.stringify(sb)} 拉到顶 ${searchFull} → 「${hitName}」;` +
      `拉到顶 ${homeFull} 点我的世界 → ${JSON.stringify(homeBox)}、${homeCards} 个世界;新建 → 卡片 ${JSON.stringify(nwBox)};改地形 → 工具 ${nwTools};完成 → 退回 ${nwBack}`,
  );
  if (!ws0 || Math.abs(ws0.y - (VH - PEEK)) > 2 || Math.abs(ws0.y + ws0.height - VH) > 1 || ws0.width !== VW) errs.push(`手机:世界卡片没有收在最底(${JSON.stringify(ws0)})`);
  if (!row || !ws0 || Math.abs(row.y + row.height - (ws0.y - 10)) > 2 || Math.abs(row.width - (VW - 24)) > 1 || row.height > 56)
    errs.push(`手机:时间轴胶囊不在世界卡片上面 / 不是一行(${JSON.stringify(row)})`);
  if (!track || !row || track.height < 32 || track.y < row.y || track.y + track.height > row.y + row.height) errs.push(`手机:时间轴轨道不在胶囊里 / 太矮(${JSON.stringify(track)})`);
  if (!/^种子 7，现存 \d+ 国$/.test(sub)) errs.push(`手机:世界名后面的副标不对(${sub})`);
  if (btnActs !== 'layers,mark,globe,director,assistant,relief' || !btns || Math.abs(btns.x + btns.width - (VW - 12)) > 1 || btns.y > 20 || btns.height < 160)
    errs.push(`手机:右上不是竖排的图层、标记、地球、导播、助手、立体六个按钮(${btnActs} ${JSON.stringify(btns)})`);
  if (!wsFull || Math.abs(wsFull.y - 0.08 * VH) > 8 || tiles !== 4 || !capsuleHidden) errs.push(`手机:往上拖世界卡片没有拉到顶(${JSON.stringify(wsFull)},大按钮 ${tiles},胶囊藏起 ${capsuleHidden})`);
  if (!ws1 || Math.abs(ws1.y - (VH - PEEK)) > 2) errs.push(`手机:点拖动条没有收起世界卡片(${JSON.stringify(ws1)},点了 ${gripTaps} 次、收到 click ${gripClicks} 次)`);
  if (!hint0.includes('双指缩放') || hint1 !== 0) errs.push(`手机:操作提示不对 / 捏合后没消失(${hint0})`);
  if (zoomBtns) errs.push('手机:右下还有地球仪 / 缩放按钮');
  if (!(k1 > k0 * 1.6)) errs.push(`手机:双指捏合后地图比例没变(${k0} → ${k1})`);
  if (!mid0 || !mid1 || Math.hypot(mid1[0] - mid0[0], mid1[1] - mid0[1]) > 12) errs.push(`手机:捏合不是以两指中点为中心(${mid0} → ${mid1})`);
  if (!panned) errs.push('手机:单指拖动没有平移');
  if (Math.abs(kReset - 1) > 0.01) errs.push(`手机:点两下没有回正(k ${kReset})`);
  if (!pol) errs.push('手机:没找到能点的国家');
  else {
    const halfTop = 0.5 * VH;
    if (!sheet0 || Math.abs(sheet0.y - halfTop) > 8 || Math.abs(sheet0.y + sheet0.height - VH) > 1 || sheet0.width !== VW)
      errs.push(`手机:点国家后详情卡片的位置不对(${JSON.stringify(sheet0)},半屏上边应在 ${halfTop})`);
    if (!row1 || !sheet0 || Math.abs(row1.y + row1.height - (sheet0.y - 10)) > 2) errs.push(`手机:时间轴胶囊没有跟到详情卡片上面(${JSON.stringify(row1)})`);
    if (!/ \/ 国家，/.test(info) || !info.includes('干预历史')) errs.push(`手机:卡片里不是国家面板(${info.slice(0, 80)})`);
    if (!ring || !row1 || !(ring.y > 20 && ring.y + ring.height < row1.y)) errs.push(`手机:选中的国家没有落在时间轴胶囊上方(国都圆环 ${JSON.stringify(ring)})`);
    if (hover) errs.push('手机:点了以后出了悬停卡片');
    if (!full || !sheet1 || Math.abs(sheet1.y - 0.08 * VH) > 8 || !fullCapsuleHidden) errs.push(`手机:往上拖没有拉到顶 / 胶囊没藏起来(${JSON.stringify(sheet1)})`);
    if (cmds !== 18) errs.push(`手机:干预页不对(${cmds} 条命令)`);
    if (!/^选择与.+结盟的国家 \d+ 年起生效 取消$/.test(pickToast) || !hiddenWhilePicking) errs.push(`手机:选目标的提示条 / 卡片收起不对(${pickToast})`);
    if (!/^.+与.+结盟,已从 \d+ 年起重新推演( \d+ 年时它叫.+)? 撤销$/.test(doneToast))
      errs.push(`手机:点名牌后没有生效(${doneToast};点的「${tgtText}」,看得见的名牌 ${plateN} 个${pickLeft ? ',还停在选目标' : ''})`);
    if (!/^已撤销/.test(undoToast)) errs.push(`手机:撤销后没有"已撤销"(${undoToast})`);
  }
  if (!lp || Math.abs(lp.y + lp.height - VH) > 1 || lp.width !== VW) errs.push(`手机:图层弹层不是底部抽屉(${JSON.stringify(lp)})`);
  if (dark !== 'dark' || !lpClosed) errs.push(`手机:图层抽屉里切到卫星不对 / 收不起来(${dark},${lpClosed})`);
  if (!afterX.sheet) errs.push(`手机:关掉详情卡片后没有回到世界卡片(${JSON.stringify(afterX)})`);
  if (!ovClosed || !ovName || !ovIns.includes(ovName)) errs.push(`手机:概览的国家列表点一国没有打开这国(${ovName};${ovYear},详情卡片「${ovIns.slice(0, 20).replace(/\n/g, ' ')}」)`);
  if (!sb || sb.width < VW - 40 || !searchFull) errs.push(`手机:搜索时世界卡片没有拉到顶(${JSON.stringify(sb)})`);
  if (!hitName || !searchIns.includes(hitName)) errs.push(`手机:搜索点一条没有打开它(${hitName})`);
  if (!homeFull || !homeBox || homeBox.width !== VW || homeCards !== 1) errs.push(`手机:拉到顶的世界卡片里点"我的世界"没有整屏换成我的世界(${JSON.stringify(homeBox)},${homeCards} 个世界)`);
  if (!nwBox || Math.abs(nwBox.y + nwBox.height - VH) > 1 || nwBox.width !== VW) errs.push(`手机:我的世界里点"新建世界",底部没有新建世界的卡片(${JSON.stringify(nwBox)})`);
  if (!nwTools || !nwBack) errs.push(`手机:新建卡片里点"编辑地形"没有换成编辑地形的工具 / 点"完成"没退回(${nwTools},${nwBack})`);
  await mctx.close();
}

// 宽屏侧栏收起:卡片右上角的侧栏图标 → 卡片滑走、左上角留"图标 + 世界名"的小按钮,时间轴拉到最左,地图不动;
// 收起时选中一个国家卡片弹出来显示它,取消选中又收回去;刷新后还是收起;点小按钮展开;
// 新建世界不受影响(新建界面左边的设定每次进来都展开着),新建里也能收起、展开
if (part('侧栏收起')) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const sp = await ctx.newPage();
  sp.on('pageerror', (e) => errs.push(`侧栏收起:${e.message}`));
  await sp.goto(`${dev.url}/?seed=7`);
  await sp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await sp.waitForTimeout(500);
  const state = () =>
    sp.evaluate(() => {
      const side = document.querySelector('aside.sidebar:not(.nw-card)');
      const r = side?.getBoundingClientRect();
      const tl = document.querySelector('.bottom-row')?.getBoundingClientRect();
      const pill = document.querySelector('.side-open') as HTMLElement | null;
      const v = (window as any).__wfView;
      return {
        shown: !!side && r!.right > 0 && getComputedStyle(side).visibility === 'visible',
        tlLeft: Math.round(tl?.left ?? -1),
        pill: pill ? pill.innerText.trim() : null,
        view: `${v.k.toFixed(3)},${Math.round(v.x)},${Math.round(v.y)}`,
      };
    });
  // 卡片滑走 / 滑回、时间轴挪位都有过渡动画,机器慢时开始得晚:等卡片到了该在的地方、动画都放完再读
  // (最多等 5 秒;没到位照样往下走,由下面的检查报出来)
  const settled = (shown: boolean) =>
    sp
      .waitForFunction(
        (want) => {
          const side = document.querySelector('aside.sidebar:not(.nw-card)');
          if (!side || document.getAnimations().some((a) => a instanceof CSSTransition)) return false;
          return (side.getBoundingClientRect().right > 0 && getComputedStyle(side).visibility === 'visible') === want;
        },
        shown,
        { timeout: 5000 },
      )
      .catch(() => {});
  const s0 = await state();
  await sp.click('[data-act=side-collapse]');
  await settled(false);
  const s1 = await state();
  // 收起时选中一个国家(和地图上点一样走 setSelection)
  await sp.evaluate(() => (window as any).__wfSelect('polity', 1));
  await settled(true);
  const s2 = await state();
  const ins = await sp.locator('.sidebar .inspector').count();
  await sp.keyboard.press('Escape');
  await settled(false);
  const s3 = await state();
  await sp.reload();
  await sp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await settled(false);
  const s4 = await state();
  await sp.click('[data-act=side-expand]');
  await settled(true);
  const s5 = await state();
  // 收起着进新建世界:新建界面左边的设定照常展开着;在新建里收起 → 滑走、左上角留小按钮;点小按钮展开
  await sp.click('[data-act=side-collapse]');
  await sp.goto(`${dev.url}/?seed=7&new=1`);
  await studioReady(sp);
  const nw = await sp.locator('.st-left').boundingBox();
  await sp.click('.st-left [data-act=side-collapse]');
  await sp.waitForTimeout(500);
  const nwC = await sp.locator('.st-left').boundingBox();
  const nwPill = await sp.locator('.studio [data-act=side-expand]').isVisible();
  await sp.click('.studio [data-act=side-expand]');
  await sp.waitForTimeout(500);
  const nwE = await sp.locator('.st-left').boundingBox();
  console.log(
    `侧栏收起:开着 ${JSON.stringify(s0)};收起 ${JSON.stringify(s1)};选中 ${JSON.stringify(s2)};Esc ${JSON.stringify(s3)};刷新 ${JSON.stringify(s4)};展开 ${JSON.stringify(s5)};` +
      `新建 ${JSON.stringify(nw)} → 收起 ${JSON.stringify(nwC)}(小按钮 ${nwPill})→ 展开 ${JSON.stringify(nwE)}`,
  );
  if (!s0.shown || s0.pill !== null || s0.tlLeft !== SIDE_ROOM) errs.push(`侧栏收起:一开始卡片应该开着、时间轴从 ${SIDE_ROOM} 起(${JSON.stringify(s0)})`);
  if (s1.shown || !s1.pill || s1.tlLeft !== 14 || s1.view !== s0.view) errs.push(`侧栏收起:点收起后卡片没滑走 / 没有左上角的小按钮 / 时间轴没拉到最左 / 地图动了(${JSON.stringify(s1)})`);
  if (!s2.shown || s2.pill !== null || !ins) errs.push(`侧栏收起:收起时选中国家,卡片没弹出来显示它(${JSON.stringify(s2)},面板 ${ins})`);
  if (s3.shown || !s3.pill) errs.push(`侧栏收起:取消选中后卡片没收回去(${JSON.stringify(s3)})`);
  if (s4.shown || !s4.pill) errs.push(`侧栏收起:刷新后没记住收起(${JSON.stringify(s4)})`);
  if (!s5.shown || s5.pill !== null || s5.tlLeft !== SIDE_ROOM) errs.push(`侧栏收起:点左上角的小按钮没展开(${JSON.stringify(s5)})`);
  if (!nw || Math.abs(nw.x) > 1) errs.push(`侧栏收起:收起着进新建世界,左边的设定不见了(${JSON.stringify(nw)})`);
  if (!nwC || nwC.x + nwC.width > 1 || !nwPill || !nwE || Math.abs(nwE.x) > 1) errs.push(`侧栏收起:新建界面里收起 / 展开不对(${JSON.stringify(nwC)},${nwPill},${JSON.stringify(nwE)})`);
  await ctx.close();
}

// 浏览器的后退、前进:我的世界 → 世界 → 国家卡片 → 卡片里点人名,后退一张张退回来(不换画面)、再后退回我的世界,前进再走回去;
// 卡片的 Esc = 退回没开卡片的那一步;新建里换一颗,后退换回刚才那颗;创建世界后后退跳过新建那几步;
// 后退到一个在别的页面里删掉的世界:停在我的世界,提示删掉了
if (part('后退前进')) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const bp = await ctx.newPage();
  bp.on('pageerror', (e) => errs.push(`后退:${e.message}`));
  const ready = (q: Page) => q.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  for (const [seed, title] of [[2024, '群星之海'], [7, '落日洋']] as const) {
    await bp.goto(`${dev.url}/?new=1&seed=${seed}&play=0`);
    await studioReady(bp);
    await toCivStep(bp);
    await bp.fill('input[placeholder="给这个世界起个名字"]', title);
    await bp.keyboard.press('Enter');
    await createNow(bp);
    await ready(bp);
  }
  // 换一个标签页从头开始(前面的几步不算)
  await bp.close();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`后退:${e.message}`));
  const at = async () => {
    await p.waitForTimeout(700);
    return p.evaluate(() => {
      const h = history.state as { idx?: number; layer?: { sel?: { kind: string } } } | null;
      const where = document.querySelector('.studio') ? '新建' : document.querySelector('.mw') ? '我的世界' : '世界';
      const card = (document.querySelector('.cp-title') as HTMLElement | null)?.innerText.split('\n')[0] ?? '';
      return { where, idx: h?.idx ?? -1, sel: h?.layer?.sel?.kind ?? '', card, seed: new URLSearchParams(location.search).get('seed') };
    });
  };
  const steps: string[] = [];
  const step = async (what: string, ok: (s: Awaited<ReturnType<typeof at>>) => boolean) => {
    const s = await at();
    steps.push(`${what}:${s.where}${s.card ? `「${s.card}」` : ''}`);
    if (!ok(s)) errs.push(`后退:${what}不对(${JSON.stringify(s)})`);
    return s;
  };
  await p.goto(`${dev.url}/?play=0`);
  await civsTab(p);
  await p.locator('.mw-card').first().waitFor({ timeout: 15000 });
  await p.locator('.mw-card', { hasText: '落日洋' }).locator('[data-act=open-world]').click();
  await ready(p);
  await step('打开世界', (s) => s.where === '世界' && !s.sel);
  await p.click('.sidebar [data-polity] >> nth=0');
  const c1 = await step('国家卡片', (s) => s.sel === 'polity' && !!s.card);
  const person = p.locator('[data-person]').first();
  const hasPerson = (await person.count()) > 0;
  if (hasPerson) {
    await person.click();
    await step('点人名', (s) => s.sel === 'person' && s.card !== c1.card);
    await p.goBack();
    await step('后退', (s) => s.sel === 'polity' && s.card === c1.card);
  }
  await p.goBack();
  await step('后退', (s) => s.where === '世界' && !s.sel && !s.card);
  await p.goBack();
  await step('后退', (s) => s.where === '我的世界');
  await p.goForward();
  await ready(p);
  await step('前进', (s) => s.where === '世界' && !s.sel);
  await p.goForward();
  await step('前进', (s) => s.sel === 'polity' && s.card === c1.card);
  await p.keyboard.press('Escape');
  const esc = await step('Esc', (s) => s.where === '世界' && !s.sel && !s.card);
  if (esc.idx !== c1.idx - 1) errs.push(`后退:卡片的 Esc 应退回没开卡片的那一步(第 ${esc.idx} 步,应是第 ${c1.idx - 1} 步)`);
  // 新建:换一颗,后退换回刚才那颗;创建以后后退跳过新建那几步
  await p.click('[data-act=home] >> nth=0');
  await step('左上回我的世界', (s) => s.where === '我的世界');
  await p.click('[data-act=new-world] >> nth=0');
  await dialogStart(p);
  await studioReady(p);
  const d1 = await step('新建', (s) => s.where === '新建');
  // 等网址里的种子换好(新建界面一直开着,换的只是星球)
  const seedIs = (want: string | null, same: boolean) =>
    p
      .waitForFunction(([w, eq]) => (new URLSearchParams(location.search).get('seed') === w) === eq, [want, same] as const, { timeout: 30000 })
      .catch(() => {});
  await p.click('.studio [data-act=new-seed]');
  await seedIs(d1.seed, false);
  const d2 = await step('换一颗', (s) => s.where === '新建' && s.seed !== d1.seed);
  await p.goBack();
  await seedIs(d1.seed, true);
  await step('后退', (s) => s.where === '新建' && s.seed === d1.seed);
  await p.goForward();
  await seedIs(d2.seed, true);
  await step('前进', (s) => s.where === '新建' && s.seed === d2.seed);
  await studioReady(p);
  await toCivStep(p);
  await p.fill('input[placeholder="给这个世界起个名字"]', '北境');
  await p.keyboard.press('Enter');
  await createNow(p);
  await ready(p);
  await step('创建', (s) => s.where === '世界');
  await p.goBack();
  await step('后退', (s) => s.where === '我的世界');
  // 别的页面里删掉了
  // 等这个世界生成好(__wf 还是上一个世界的)
  await p.evaluate(() => ((window as any).__wf = null));
  await p.locator('.mw-card', { hasText: '群星之海' }).locator('[data-act=open-world]').click();
  await ready(p);
  await step('打开另一个世界', (s) => s.where === '世界');
  await p.click('[data-act=home] >> nth=0');
  await step('左上回我的世界', (s) => s.where === '我的世界');
  const other = await ctx.newPage();
  await other.goto(`${dev.url}/?play=0`);
  await civsTab(other);
  await other.locator('.mw-card', { hasText: '群星之海' }).locator('[data-act=world-menu]').click();
  await other.locator('[data-act=world-delete]').click();
  await other.waitForTimeout(300);
  await other.close();
  await p.goBack();
  await step('后退到删掉的世界', (s) => s.where === '我的世界');
  const gone = await toastText(p, 'nav-gone');
  if (!/回不到「群星之海」.*已经删掉了/.test(gone)) errs.push(`后退到删掉的世界:没有提示(「${gone}」)`);
  console.log(`后退:${steps.join(' → ')};删掉的世界提示「${gone}」${hasPerson ? '' : '(卡片里没有人名,没试点人名)'}`);
  await ctx.close();
}

// 源代码 · 隐私政策 · 用户协议:概览底部三条链接(网址和 src/ui/links.ts 一致、新标签页打开;手机上在屏幕里、点得到);
// AI 设置里的"隐私政策";构建产物里有 privacy.html、terms.html,能打开(200),页面里的仓库网址和 links.ts 一致
if (part('链接')) {
  const { SOURCE_URL, PRIVACY_URL, TERMS_URL } = await import('../src/ui/links');
  const want: Record<string, string> = { source: SOURCE_URL, privacy: PRIVACY_URL, terms: TERMS_URL };
  type Link = { id: string; text: string; href: string; abs: string; target: string; box: [number, number, number, number]; hit: boolean };
  const aboutLinks = (p: Page) =>
    p.locator('.ov-about a').evaluateAll((as) =>
      as.map((a) => {
        const r = a.getBoundingClientRect();
        const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          id: a.getAttribute('data-link') ?? '',
          text: a.textContent ?? '',
          href: a.getAttribute('href') ?? '',
          abs: (a as HTMLAnchorElement).href,
          target: a.getAttribute('target') ?? '',
          box: [r.x, r.y, r.width, r.height].map(Math.round) as [number, number, number, number],
          hit: !!top && a.contains(top),
        };
      }),
    );
  const checkLinks = (tag: string, links: Link[], vw: number, vh: number) => {
    if (links.map((l) => l.text).join(' · ') !== '源代码 · 隐私政策 · 用户协议') errs.push(`${tag}概览底部的链接不对(${links.map((l) => l.text).join(' · ')})`);
    for (const l of links) {
      if (l.href !== want[l.id]) errs.push(`${tag}「${l.text}」的网址不对(${l.href},应为 ${want[l.id]})`);
      if (l.target !== '_blank') errs.push(`${tag}「${l.text}」不是新标签页打开`);
      const [x, y, w, h] = l.box;
      if (!(w > 0 && h > 0 && x >= 0 && y >= 0 && x + w <= vw && y + h <= vh) || !l.hit) errs.push(`${tag}「${l.text}」不在屏幕里或被挡住(${l.box})`);
    }
  };
  // 宽屏:概览底部;AI 设置里的"隐私政策";两个页面从开发服务打开
  await page.setViewportSize({ width: 1400, height: 820 });
  await page.goto(`${dev.url}/?seed=7`);
  await page.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await openOverview();
  const desk = await aboutLinks(page);
  checkLinks('链接:', desk, 1400, 820);
  // 版本号:概览底部、侧栏"更多"菜单底部,都是 package.json 里的版本
  const pkgVer = JSON.parse((await import('node:fs')).readFileSync('package.json', 'utf8')).version as string;
  const ovVer = await page.locator('.ov-about [data-version]').innerText().catch(() => '');
  await closeOverview();
  await page.click('[data-act=world-more]');
  const menuVer = await page.locator('.pm-menu [data-version]').innerText().catch(() => '');
  await page.keyboard.press('Escape');
  console.log(`版本号:概览「${ovVer}」、更多菜单「${menuVer}」(package.json ${pkgVer})`);
  if (ovVer !== `版本 ${pkgVer}` || menuVer !== `版本 ${pkgVer}`) errs.push(`版本号:界面上的版本号和 package.json 不一致(概览「${ovVer}」,菜单「${menuVer}」,应为 ${pkgVer})`);
  await openAi();
  await page.waitForSelector('.ai-dialog', { timeout: 10000 });
  const aiPriv = await page.locator('.ai-foot a[data-link=privacy]').evaluate((a) => [a.getAttribute('href'), a.getAttribute('target'), a.textContent]).catch(() => null);
  await page.keyboard.press('Escape');
  await closeOverview();
  if (!aiPriv || aiPriv[0] !== PRIVACY_URL || aiPriv[1] !== '_blank' || aiPriv[2] !== '隐私政策') errs.push(`链接:AI 设置里没有"隐私政策"链接(${aiPriv})`);
  const devPages: string[] = [];
  for (const l of desk.filter((l) => l.id !== 'source')) {
    const r = await page.request.get(l.abs);
    const body = await r.text();
    devPages.push(`${l.text} ${r.status()}`);
    if (r.status() !== 200 || !body.includes(`<h1>${l.text}</h1>`)) errs.push(`链接:「${l.text}」(${l.abs})打不开(${r.status()})`);
  }
  // 手机:概览铺满全屏,底部三条链接在屏幕里、点得到
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mp = await mctx.newPage();
  await mp.goto(`${dev.url}/?seed=7`);
  await mp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await mp.tap('[data-act=overview]');
  await mp.locator('.ov-root:not([hidden]) .ov-about').waitFor({ timeout: 5000 }).catch(() => {});
  const phone = await aboutLinks(mp);
  checkLinks('链接(手机):', phone, 390, 844);
  const minH = Math.min(...phone.map((l) => l.box[3]));
  if (!(minH >= 28)) errs.push(`链接(手机):概览底部的链接太矮,手指不好点(高 ${minH})`);
  await mctx.close();
  // 构建产物:vite build 到临时目录,vite preview 起一个服务,两个页面 200、仓库网址和 links.ts 一致
  const { build, preview } = await import('vite');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'civ-atlas-smoke-'));
  const built: string[] = [];
  try {
    await build({ logLevel: 'error', build: { outDir, emptyOutDir: true } });
    // 每个 JS 文件开头都有署名(版本和 package.json 一致、仓库网址和 links.ts 一致);主程序还带构建时的提交号
    const { execSync } = await import('node:child_process');
    let commit = '';
    try {
      commit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    } catch {
      commit = process.env.GITHUB_SHA?.slice(0, 7) ?? '';
    }
    const jsFiles = fs.readdirSync(path.join(outDir, 'assets')).filter((f) => f.endsWith('.js'));
    for (const f of jsFiles) {
      const head = fs.readFileSync(path.join(outDir, 'assets', f), 'utf8').slice(0, 1000);
      const sig = /\/\*! 文明与地图 [^*]*\*\//.exec(head)?.[0] ?? '';
      const main = f.startsWith('index-');
      const want = `/*! 文明与地图 v${pkgVer}${main && commit ? ` (${commit})` : ''} | Copyright (C) 2026 guaner-334 | AGPL-3.0-only | ${SOURCE_URL} */`;
      if (sig !== want) errs.push(`署名:构建出的 ${f} 开头的署名不对(${sig || '没有'},应为 ${want})`);
    }
    built.push(`署名 ${jsFiles.length} 个 JS 文件`);
    const srv = await preview({ logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port: 0, open: false } });
    const base = (srv.resolvedUrls?.local[0] ?? '').replace(/\/$/, '');
    try {
      for (const [f, h1] of [
        ['privacy.html', '隐私政策'],
        ['terms.html', '用户协议'],
      ]) {
        const onDisk = fs.existsSync(path.join(outDir, f));
        const r = await page.request.get(`${base}/${f}`);
        const body = await r.text();
        built.push(`${f} ${onDisk ? '有' : '没有'} ${r.status()}`);
        if (!onDisk) errs.push(`链接:构建产物里没有 ${f}`);
        if (r.status() !== 200 || !body.includes(`<h1>${h1}</h1>`)) errs.push(`链接:构建后的 ${f} 打不开(${r.status()})`);
        const repos = [...body.matchAll(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+/g)].map((m) => m[0]);
        if (!repos.length || repos.some((u) => u !== SOURCE_URL)) errs.push(`链接:${f} 里的仓库网址和 links.ts 不一致(${[...new Set(repos)]})`);
        if (!body.includes('href="./"')) errs.push(`链接:${f} 底部没有回到地图的链接`);
      }
      // 使用教程:页面读同目录的 guide.md 转成网页,两样都要在构建产物里
      for (const [f, want] of [
        ['guide.html', '<h1>使用教程</h1>'],
        ['guide.md', '# 使用教程'],
      ]) {
        const r = await page.request.get(`${base}/${f}`);
        const body = await r.text();
        built.push(`${f} ${r.status()}`);
        if (r.status() !== 200 || !body.includes(want)) errs.push(`链接:构建后的 ${f} 打不开(${r.status()})`);
      }
      // 加载画面(scripts/lib/loadScreen.ts,只在构建出的页面里有):页面的代码、样式表由它下好再交给浏览器;
      // 首页 / 打开的世界挂上以后它淡出拿掉,样式表已经放上
      const lctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      try {
        const lp = await lctx.newPage();
        const lerrs: string[] = [];
        lp.on('pageerror', (e) => lerrs.push(e.message));
        const shown = async (ready: () => Promise<unknown>) => {
          const ok = await ready().then(
            () => true,
            () => false,
          );
          const gone = await lp
            .locator('#ld')
            .waitFor({ state: 'detached', timeout: 5000 })
            .then(
              () => true,
              () => false,
            );
          const css = await lp.evaluate(() => [...document.styleSheets].some((s) => /\/assets\/index-[\w-]+\.css$/.test(s.href ?? '')));
          return { ok, gone, css };
        };
        await lp.goto(`${base}/`);
        const home = await shown(() => lp.locator('.mw').waitFor({ timeout: 30000 }));
        await lp.goto(`${base}/?seed=7`);
        const world = await shown(() => lp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 }));
        built.push(`加载画面:首页 ${JSON.stringify(home)}、打开世界 ${JSON.stringify(world)}`);
        for (const [what, r] of [
          ['首页', home],
          ['打开世界', world],
        ] as const) {
          if (!r.ok) errs.push(`加载画面:构建出的页面${what}没出来`);
          if (!r.gone) errs.push(`加载画面:${what}出来以后加载画面没拿掉`);
          if (!r.css) errs.push(`加载画面:${what}出来时样式表没放上`);
        }
        if (lerrs.length) errs.push(`加载画面:构建出的页面报错(${lerrs.join(';')})`);
      } finally {
        await lctx.close();
      }
    } finally {
      await srv.close();
    }
  } catch (e) {
    errs.push(`链接:构建 / 预览失败(${(e as Error).message})`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
  console.log(
    `链接:宽屏 ${desk.map((l) => `${l.text}→${l.href}`).join(' · ')};AI 设置「${aiPriv?.[2]}」→ ${aiPriv?.[0]};开发服务 ${devPages.join('、')};` +
      `手机 ${phone.map((l) => `${l.text}@${l.box}${l.hit ? '' : '(被挡)'}`).join(' · ')};构建 ${built.join('、')}`,
  );
}

// 联系我们:网站根目录的 contact.json(src/ui/contact.ts)。开发服务里没有这个文件 → 哪里都没有「联系我们」;
// 有了以后:首页底部有,新标签页打开加群链接;鼠标移上去出小卡片(二维码、群名、群号),点「复制」群号进剪贴板、按钮换成「已复制」,
// 鼠标移开收起;世界概览底部、世界里的「更多」菜单也有;手机上概览底部不放,「更多」里有;格式不对的 contact.json 当没配
if (part('联系我们')) {
  const CONTACT = { name: '测试交流群', qq: '925687934', url: 'https://qm.qq.com/q/xXrrfGrKso' };
  const cctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  await cctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: dev.url });
  const cp = await cctx.newPage();
  await cp.goto(`${dev.url}/`);
  await cp.locator('.mw-foot').waitFor({ timeout: 30000 });
  await cp.waitForTimeout(800);
  const none = await cp.locator('[data-link=contact]').count();
  let body = JSON.stringify(CONTACT);
  await cctx.route('**/contact.json', (r) => r.fulfill({ contentType: 'application/json', body }));
  await cp.reload();
  const link = cp.locator('.mw-foot [data-link=contact]');
  const shown = await link.waitFor({ timeout: 10000 }).then(
    () => true,
    () => false,
  );
  const attrs = shown ? await link.evaluate((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target')]) : null;
  let pop: { name: string; qq: string; qr: number } | null = null;
  let copied = '';
  let btn = '';
  let gone = -1;
  let keys: { toLink: string; backVer: string; out: string; left: number } | null = null;
  if (shown) {
    await link.hover();
    const pp = cp.locator('[data-testid=contact-pop]');
    await pp.locator('svg path').waitFor({ timeout: 10000 }).catch(() => {});
    pop = await pp
      .evaluate((el) => ({
        name: el.querySelector('.contact-name')?.textContent ?? '',
        qq: el.querySelector('[data-contact-qq]')?.textContent ?? '',
        qr: el.querySelector('svg path')?.getAttribute('d')?.length ?? 0,
      }))
      .catch(() => null);
    await cp.click('[data-act=contact-copy]');
    btn = await cp.locator('[data-act=contact-copy]').innerText().catch(() => '');
    copied = await cp.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    await cp.mouse.move(700, 200);
    await cp.waitForTimeout(500);
    gone = await pp.count();
  }
  // 世界里:概览底部、「更多」菜单
  await cp.goto(`${dev.url}/?seed=7`);
  await cp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await openOverview(cp);
  const ovLink = await cp.locator('.ov-about [data-link=contact]').getAttribute('href', { timeout: 5000 }).catch(() => null);
  await closeOverview(cp);
  await cp.click('[data-act=world-more]');
  const menuLink = await cp.locator('.pm-menu [data-link=contact]').getAttribute('href', { timeout: 5000 }).catch(() => null);
  await cp.keyboard.press('Escape');
  // 格式不对:当没配
  body = JSON.stringify({ qq: '群号', url: 'javascript:alert(1)' });
  await cp.goto(`${dev.url}/`);
  await cp.locator('.mw-foot').waitFor({ timeout: 30000 });
  await cp.waitForTimeout(800);
  const bad = await cp.locator('[data-link=contact]').count();
  // 手机:概览底部没有,「更多」里有
  body = JSON.stringify(CONTACT);
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mc.route('**/contact.json', (r) => r.fulfill({ contentType: 'application/json', body }));
  const mp = await mc.newPage();
  await mp.goto(`${dev.url}/?seed=7`);
  await mp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await mp.tap('[data-act=world-sheet]');
  await mp.waitForTimeout(600);
  await mp.tap('[data-act=world-more]');
  const phoneMenu = await mp.locator('.pm-menu [data-link=contact]').getAttribute('href', { timeout: 5000 }).catch(() => null);
  await mp.keyboard.press('Escape');
  await mp.tap('[data-act=overview]');
  await mp.locator('.ov-root:not([hidden]) .ov-about').waitFor({ timeout: 5000 }).catch(() => {});
  const phoneOv = await mp.locator('.ov-about [data-link=contact]').count();
  await mc.close();
  await cctx.close();
  console.log(
    `联系我们:没配 ${none} 个;配了 首页 ${JSON.stringify(attrs)},小卡片 ${JSON.stringify(pop)},复制「${btn}」剪贴板「${copied}」,移开后 ${gone};` +
      `概览 ${ovLink},更多菜单 ${menuLink};格式不对 ${bad} 个;手机 更多 ${phoneMenu}、概览 ${phoneOv} 个`,
  );
  if (none) errs.push(`联系我们:没有 contact.json 也出现了(${none} 个)`);
  if (!attrs || attrs[0] !== '联系我们' || attrs[1] !== CONTACT.url || attrs[2] !== '_blank') errs.push(`联系我们:首页底部没有,或网址不对、不是新标签页打开(${JSON.stringify(attrs)})`);
  if (!pop || pop.name !== CONTACT.name || pop.qq !== CONTACT.qq || pop.qr < 100) errs.push(`联系我们:鼠标移上去的小卡片不对(${JSON.stringify(pop)})`);
  if (copied !== CONTACT.qq || !btn.includes('已复制')) errs.push(`联系我们:点「复制」没把群号放进剪贴板(剪贴板「${copied}」,按钮「${btn}」)`);
  if (gone !== 0) errs.push('联系我们:鼠标移开后小卡片没收起');
  if (ovLink !== CONTACT.url || menuLink !== CONTACT.url) errs.push(`联系我们:概览底部、「更多」菜单里没有(${ovLink},${menuLink})`);
  if (bad) errs.push('联系我们:contact.json 格式不对也出现了');
  if (phoneMenu !== CONTACT.url || phoneOv) errs.push(`联系我们(手机):「更多」里应该有、概览底部不放(${phoneMenu},概览 ${phoneOv} 个)`);
}

// 测试版新功能:正式网站读测试网站的 beta/whats-new.json(src/ui/betaNews.ts),列出自己的清单里没有的几条。
// 开发服务里没有这个文件 → 版本号和以前一样;有了以后:首页右下角版本号后面小蓝点,鼠标移上去上面出小卡片(新功能、预计日期、测试地址),
// 移开收起;键盘 Tab 进出卡片里的链接;世界概览里开着卡片按后退,卡片跟着收起;
// 世界里「更多」菜单最底下一行移上去,卡片出在菜单右边;手机上点那一行,菜单换成卡片;两边一样时不出
if (part('测试版新功能')) {
  const WHATS_NEW = (await import('./lib/whatsNew')).readWhatsNew();
  const { beijingDay, dayText, nextSync } = await import('../src/ui/betaNews');
  const wantWhen = `预计 ${dayText(nextSync('2026-10-12', beijingDay()))}（周日）更新到正式版`;
  const fresh = [
    { pr: 9002, title: '新功能乙', text: '测试网站先有的第二个功能' },
    { pr: 9001, title: '新功能甲', text: '测试网站先有的第一个功能' },
  ];
  let body = JSON.stringify({ built: '2026-10-12', news: [...fresh, ...WHATS_NEW] });
  const nctx = await browser.newContext({ viewport: { width: 1400, height: 820 } });
  const np = await nctx.newPage();
  np.on('pageerror', (e) => errs.push(`测试版新功能:${e.message}`));
  await np.goto(`${dev.url}/`);
  await np.locator('.mw-foot').waitFor({ timeout: 30000 });
  await np.waitForTimeout(800);
  const plain = await np.locator('.mw-foot [data-version]').innerText().catch(() => '');
  const noneNews = await np.locator('[data-act=beta-news]').count();
  await nctx.route('**/beta/whats-new.json', (r) => r.fulfill({ contentType: 'application/json', body }));
  await np.reload();
  const ver = np.locator('.mw-foot [data-act=beta-news]');
  const shown = await ver.waitFor({ timeout: 10000 }).then(
    () => true,
    () => false,
  );
  let card: { titles: string[]; when: string; href: string | null; above: boolean; inView: boolean } | null = null;
  let gone = -1;
  let keys: { toLink: string; backVer: string; out: string; left: number } | null = null;
  if (shown) {
    await ver.hover();
    const pp = np.locator('[data-testid=beta-news]');
    await pp.waitFor({ timeout: 5000 }).catch(() => {});
    card = await pp
      .evaluate((el, vb) => {
        const r = el.getBoundingClientRect();
        return {
          titles: [...el.querySelectorAll('.news-list b')].map((b) => b.textContent ?? ''),
          when: el.querySelector('.news-when')?.textContent ?? '',
          href: el.querySelector('a[data-link=beta-news]')?.getAttribute('href') ?? null,
          above: r.bottom <= vb + 1,
          inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        };
      }, (await ver.boundingBox())!.y)
      .catch(() => null);
    await np.mouse.move(700, 200);
    await np.waitForTimeout(500);
    gone = await pp.count();
    // 键盘:版本号上按 Tab 进卡片里的链接,Shift+Tab 回到版本号,再按两下 Tab 出了卡片就收起
    const focused = () =>
      np.evaluate(() => {
        const a = document.activeElement;
        return a ? `${a.tagName.toLowerCase()}:${a.getAttribute('data-link') ?? a.getAttribute('data-act') ?? ''}` : '';
      });
    await ver.focus();
    await np.keyboard.press('Tab');
    const toLink = await focused();
    await np.keyboard.press('Shift+Tab');
    const backVer = await focused();
    await np.keyboard.press('Tab');
    await np.keyboard.press('Tab');
    await np.waitForTimeout(500);
    keys = { toLink, backVer, out: await focused(), left: await pp.count() };
  }
  // 世界里「更多」菜单:最底下一行移上去,卡片在菜单右边
  await np.goto(`${dev.url}/?seed=7`);
  await np.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await np.click('[data-act=world-more]');
  const row = np.locator('.pm-menu [data-act=beta-news]');
  const menuVer = await row.locator('[data-version]').innerText({ timeout: 5000 }).catch(() => '');
  await row.hover().catch(() => {});
  const side = await np
    .locator('[data-testid=beta-news]')
    .evaluate((el) => {
      const m = document.querySelector('.pm-menu')!.getBoundingClientRect();
      return el.getBoundingClientRect().left >= m.right;
    }, null, { timeout: 5000 })
    .catch(() => null);
  await np.keyboard.press('Escape');
  // 世界概览底下的版本号:卡片开着时按浏览器后退(概览关了),卡片跟着收起
  await np.click('[data-act=overview]');
  const ovVer = np.locator('.ov-root:not([hidden]) [data-act=beta-news]');
  await ovVer.hover({ timeout: 10000 }).catch(() => {});
  const ovOpen = await np
    .locator('[data-testid=beta-news]')
    .waitFor({ timeout: 5000 })
    .then(
      () => true,
      () => false,
    );
  await np.goBack();
  await np.waitForTimeout(500);
  const ovBack = { open: ovOpen, ovHidden: !(await np.locator('.ov-root:not([hidden])').count()), left: await np.locator('[data-testid=beta-news]').count() };
  // 两边一样:不出
  body = JSON.stringify({ built: '2026-10-12', news: WHATS_NEW });
  await np.goto(`${dev.url}/`);
  await np.locator('.mw-foot').waitFor({ timeout: 30000 });
  await np.waitForTimeout(800);
  const same = await np.locator('[data-act=beta-news]').count();
  // 手机:点「更多」最底下一行,菜单换成卡片
  body = JSON.stringify({ built: '2026-10-12', news: [...fresh, ...WHATS_NEW] });
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await mc.route('**/beta/whats-new.json', (r) => r.fulfill({ contentType: 'application/json', body }));
  const mp = await mc.newPage();
  await mp.goto(`${dev.url}/?seed=7`);
  await mp.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await mp.tap('[data-act=world-sheet]');
  await mp.waitForTimeout(600);
  await mp.tap('[data-act=world-more]');
  await mp.tap('.pm-menu [data-act=beta-news]').catch(() => {});
  const phone = await mp
    .locator('.pm-menu.pm-panel [data-testid=beta-news]')
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { n: el.querySelectorAll('.news-list li').length, inView: r.left >= 0 && r.right <= innerWidth };
    }, null, { timeout: 5000 })
    .catch(() => null);
  await mc.close();
  await nctx.close();
  console.log(
    `测试版新功能:没有清单 ${noneNews} 个(版本号「${plain}」);有了 首页 ${shown},小卡片 ${JSON.stringify(card)},移开后 ${gone};` +
      `键盘 ${JSON.stringify(keys)};更多菜单「${menuVer}」、卡片在右边 ${side};概览后退 ${JSON.stringify(ovBack)};两边一样 ${same} 个;手机 ${JSON.stringify(phone)}`,
  );
  if (noneNews || !plain.startsWith('版本 ')) errs.push(`测试版新功能:没有测试网站的清单也出现了(${noneNews} 个,版本号「${plain}」)`);
  if (!shown) errs.push('测试版新功能:测试网站有多出来的功能,首页右下角的版本号上没有');
  if (!card || card.titles.join() !== fresh.map((f) => f.title).join() || card.when !== wantWhen || !card.href?.endsWith('/beta/') || !card.above || !card.inView)
    errs.push(`测试版新功能:鼠标移到版本号上的小卡片不对(${JSON.stringify(card)})`);
  if (gone !== 0) errs.push('测试版新功能:鼠标移开后小卡片没收起');
  if (!keys || keys.toLink !== 'a:beta-news' || keys.backVer !== 'button:beta-news' || keys.out.endsWith(':beta-news') || keys.left !== 0)
    errs.push(`测试版新功能:键盘 Tab 进出小卡片不对(${JSON.stringify(keys)})`);
  if (!ovBack.open || !ovBack.ovHidden || ovBack.left !== 0) errs.push(`测试版新功能:世界概览里开着小卡片按后退,卡片没跟着收起(${JSON.stringify(ovBack)})`);
  if (!menuVer.startsWith('版本 ') || side !== true) errs.push(`测试版新功能:「更多」菜单最底下一行不对(「${menuVer}」,卡片在右边 ${side})`);
  if (same) errs.push('测试版新功能:两边清单一样也出现了');
  if (!phone || phone.n !== fresh.length || !phone.inView) errs.push(`测试版新功能(手机):点「更多」最底下一行没换成卡片(${JSON.stringify(phone)})`);
}

// 手机上的大图和高清贴图(多占三四百 MB 内存):导出选 4096×2048 时清晰度下面多一行后果,选回 2048×1024 就没了;
// 地球仪放大到要铺高清贴图时先不铺,顶上问一句,点「换高清」才铺
if (part('手机大图')) {
  const mc = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const ep = await mc.newPage();
  ep.on('pageerror', (e) => errs.push(`手机导出大图:${e.message}`));
  await ep.goto(`${dev.url}/?seed=7`);
  await ep.waitForFunction(() => (window as any).__wf?.ready, null, { timeout: 60000 });
  await ep.tap('[data-act=world-sheet]');
  await ep.waitForTimeout(600);
  await ep.tap('.ps-tiles .export-btn');
  const warn = async () => ep.locator('[data-act=export-big-warn]').count();
  const w1 = await warn();
  await ep.tap('.export-scale button:nth-child(2)');
  const w2 = await warn();
  const wText = (await ep.locator('[data-act=export-big-warn]').textContent().catch(() => '')) ?? '';
  await ep.tap('.export-scale button:nth-child(1)');
  const w3 = await warn();
  await ep.close();
  const gp = await mc.newPage();
  gp.on('pageerror', (e) => errs.push(`手机地球仪高清贴图:${e.message}`));
  const G = () => gp.evaluate(() => (window as any).__wfGlobe);
  await gp.goto(`${dev.url}/?seed=7&style=realistic&view=globe`);
  await gp.waitForFunction(() => (window as any).__wfGlobe?.ready, null, { timeout: 60000 });
  await gp.waitForTimeout(1000);
  await gp.evaluate(() => (window as any).__wfGlobeSet(20, 20, 2.4));
  // 没有显卡的机器上地球仪画得慢,放大以后要过一会儿才去看贴图够不够清楚:等那一条出来(最多 30 秒)
  const asked = await gp
    .locator('.toast [data-act=globe-hd]')
    .waitFor({ timeout: 30000 })
    .then(
      () => 1,
      () => 0,
    );
  const g1 = await G();
  await gp.tap('.toast [data-act=globe-hd]').catch(() => {});
  const got = await gp.waitForFunction(() => (window as any).__wfGlobe?.tier === 2, null, { timeout: 90000 }).then(() => true, () => false);
  const g2 = await G();
  await mc.close();
  console.log(`手机大图:导出提示 2048 ${w1} 行、4096 ${w2} 行、选回 ${w3} 行;地球仪放大问了 ${asked} 次,问的时候起过 ${g1?.hdStarted} 次高清,点了以后换上 ${got}(起过 ${g2?.hdStarted} 次)`);
  if (w1 || w2 !== 1 || w3 || !wText.includes('手机上可能闪退')) errs.push(`手机导出:选 4096×2048 时清晰度下面那行后果不对(${w1} / ${w2} / ${w3},「${wText}」)`);
  if (asked !== 1 || g1?.hdStarted !== 0) errs.push(`手机地球仪:放大时没有先问「换高清」,或者没问就铺了(问了 ${asked} 次,起过 ${g1?.hdStarted} 次)`);
  if (!got || g2?.hdStarted !== 1) errs.push('手机地球仪:点了「换高清」没有换上高清贴图');
}

partClose();
const lostStarts = [...PART_STARTS, ...Object.keys(MOVED)].filter((n) => !partNames.has(n));
if (lostStarts.length) errs.push(`分份:PART_STARTS / MOVED 里的段「${lostStarts.join('、')}」找不到了(改了段名要跟着改)`);
if (PARTS > 1) {
  console.log(`第 ${PART}/${PARTS} 份跑了 ${partRan.length} 段(开浏览器等准备 ${Math.round(partSetupMs / 1000)}s):${partRan.join('、')}`);
}
// 快慢汇总(只记数,见 timing):日志里一段;在 GitHub 上再写进检查页的摘要(一张表),超了的挂一条 warning
if (timings.length) {
  const over = timings.filter((t) => !(t.ms <= t.budget));
  const which = PARTS > 1 ? `第 ${PART}/${PARTS} 份` : '';
  console.log(`\n速度(${which ? `${which},` : ''}只记数,超预算不影响检查结果):`);
  for (const t of timings) console.log(`  ${t.label}:${fmtMs(t.ms)}(预算 ${t.budget} ms${t.ms <= t.budget ? '' : ',超预算'})`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = timings.map((t) => `| ${t.label} | ${fmtMs(t.ms)} | ${t.budget} ms | ${t.ms <= t.budget ? '' : '超预算'} |`);
    const md = [`### 冒烟速度${which ? `(${which})` : ''}`, '', '只记数,超预算不影响检查结果。', '', '| 项 | 这次 | 预算 | |', '| --- | ---: | ---: | --- |', ...rows, ''];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
  }
  if (over.length && process.env.GITHUB_ACTIONS) {
    console.log(`::warning title=冒烟速度${which ? `(${which})` : ''}::${over.map((t) => `${t.label} ${fmtMs(t.ms)}(预算 ${t.budget} ms)`).join(';')} 超预算(只记数,不影响检查结果)`);
  }
}
console.log('errors:', errs);
await browser.close();
await dev.close();
if (errs.length) process.exit(1);

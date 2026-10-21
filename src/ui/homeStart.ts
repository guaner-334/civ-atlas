/**
 * 打开网站时先出「我的世界」那一页,主程序(App.tsx:地图、推演、编辑地形、助手、导出……)在后台接着下载(见 Boot.tsx)。
 * 这里放两边都要用、又不能拖进一大串代码的小东西:什么时候算"只是打开首页"、离开首页时交给 App 做的那一件事、
 * 页面里最先跑的那一小段(bootScript,构建时写进 index.html)。
 *
 * 纯函数和类型,不碰 React。
 */
import type { NewWorldStart } from './NewWorldDialog';

/**
 * 首页上点了要离开这一页的东西,交给 App 接着做(App 挂上以后照常做这一件,和一开始就在 App 里点的一样):
 *   open    打开我的世界里的一个(没建完的回到新建)
 *   text    打开存档文件(选的、拖进页面的;文件名用在出错的提示里)
 *   newCiv  在这张地图上打造新文明
 *   dialog  「新建世界」弹窗里点了「开始」
 */
export type HomeStart =
  | { kind: 'open'; id: string }
  | { kind: 'text'; text: string; fileName?: string }
  | { kind: 'newCiv'; id: string }
  | { kind: 'dialog'; start: NewWorldStart };

/** 随机一个种子(新建世界、"换一颗") */
export function randomSeedValue(): number {
  return Math.floor(Math.random() * 999999) + 1;
}

/**
 * 网址里有也不碍事的几样(不换打开哪一页、首页长什么样,App 挂上以后照网址自己接着用):
 * lon=(地图正中的经线;从世界回到首页时网址里留着它)、play=(创建后放不放历史)、ai=mock / aiServer=fake(测试用的假 AI、假服务器)
 */
const HARMLESS = ['lon', 'play', 'ai', 'aiServer'];

/**
 * 打开网页时就停在我的世界、不带别的事:网址后面没有别的(没有世界、分享、新建、邀请、图层投影这些),
 * 这一步也不是浏览器记着的某个世界 / 新建(刷新、后退回来的)。
 * 这时先出首页、后台下载主程序;别的情况一律直接交给 App,和以前一样按网址打开。
 * (index.html 里最先跑的那一段是同一个判断,见 bootScript)
 */
export function plainHome(loc: { search: string; hash: string } = location, state: unknown = history.state): boolean {
  if (loc.hash.replace(/^#/, '') !== '') return false;
  for (const k of new URLSearchParams(loc.search).keys()) if (!HARMLESS.includes(k)) return false;
  // 这个网站记的一步(nav.ts 的 NavState):只认我的世界那一步
  if (state && typeof state === 'object' && (state as { wf?: unknown }).wf === 1) return (state as { page?: unknown }).page === 'home';
  return true;
}

/**
 * index.html 里最先跑的一小段(构建时写进去,见 vite.config.ts):打开的不是首页(打开某个世界、分享链接、新建……;
 * 和 plainHome 同一个判断)时,主程序(appUrl = 打包以后的地址)和页面的代码同时开始下载,不用等页面的代码跑起来再去要。
 * 首页什么都不多下:线路慢的时候,同时多下一样,首页就晚出来一点(主程序等首页要的下好了再下,见 Boot.tsx)
 */
export function bootScript(appUrl: string): string {
  return `(function () {
  try {
    var home = !location.hash.replace(/^#/, '');
    new URLSearchParams(location.search).forEach(function (v, k) {
      if (${JSON.stringify(HARMLESS)}.indexOf(k) < 0) home = false;
    });
    var s = history.state;
    if (s && typeof s === 'object' && s.wf === 1 && s.page !== 'home') home = false;
    if (home) return;
    var l = document.createElement('link');
    l.rel = 'modulepreload';
    l.href = ${JSON.stringify(appUrl)};
    document.head.appendChild(l);
  } catch (e) {}
})();`;
}

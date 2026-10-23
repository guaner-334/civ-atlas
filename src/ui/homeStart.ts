/**
 * 打开网站时先出「我的世界」那一页,主程序(App.tsx:地图、推演、编辑地形、助手、导出……)在后台接着下载(见 Boot.tsx)。
 * 这里放两边都要用、又不能拖进一大串代码的小东西:什么时候算"只是打开首页"、离开首页时交给 App 做的那一件事。
 *
 * 纯函数和类型,不碰 React。
 */
import type { NewWorldStart } from './NewWorldDialog';
import type { SharedPreset } from './presetStore';

/**
 * 首页上点了要离开这一页的东西,交给 App 接着做(App 挂上以后照常做这一件,和一开始就在 App 里点的一样):
 *   open    打开我的世界里的一个(没建完的回到新建)
 *   text    打开存档文件(选的、拖进页面的;文件名用在出错的提示里)
 *   newCiv  在这张地图上打造新文明
 *   dialog  「新建世界」弹窗里点了「开始」
 *   gallery 去作品墙那一页(主程序没下好时这里先放出那一页,见 HomeShell.tsx)
 *   work    打开作品墙上的一个作品
 *   preset  作品墙上的新建参数作品点了「用这套参数新建」
 */
export type HomeStart =
  | { kind: 'open'; id: string }
  | { kind: 'text'; text: string; fileName?: string }
  | { kind: 'newCiv'; id: string }
  | { kind: 'dialog'; start: NewWorldStart }
  | { kind: 'gallery' }
  | { kind: 'work'; id: string }
  | { kind: 'preset'; preset: SharedPreset };

/** 随机一个种子(新建世界、"换一颗") */
export function randomSeedValue(): number {
  return Math.floor(Math.random() * 999999) + 1;
}

/**
 * 网址里有也不碍事的几样(不换打开哪一页、首页长什么样,App 挂上以后照网址自己接着用):
 * lon=(地图正中的经线;从世界回到首页时网址里留着它)、play=(创建后放不放历史)、ai=mock / aiServer=fake(测试用的假 AI、假服务器)
 */
export const HARMLESS = ['lon', 'play', 'ai', 'aiServer'];

/**
 * 打开网页时就停在我的世界、不带别的事:网址后面没有别的(没有世界、分享、新建、邀请、图层投影这些),
 * 这一步也不是浏览器记着的某个世界 / 新建(刷新、后退回来的)。
 * 这时先出首页、后台下载主程序;别的情况一律直接交给 App,和以前一样按网址打开。
 * (页面里的加载画面是同一个判断:不是首页时主程序和页面的代码一起下,见 scripts/lib/loadScreen.ts)
 */
export function plainHome(loc: { search: string; hash: string } = location, state: unknown = history.state): boolean {
  if (loc.hash.replace(/^#/, '') !== '') return false;
  for (const k of new URLSearchParams(loc.search).keys()) if (!HARMLESS.includes(k)) return false;
  // 这个网站记的一步(nav.ts 的 NavState):只认我的世界那一步
  if (state && typeof state === 'object' && (state as { wf?: unknown }).wf === 1) return (state as { page?: unknown }).page === 'home';
  return true;
}

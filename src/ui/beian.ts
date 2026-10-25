/**
 * 网站备案号:页面最底下一行小字,点了新标签页打开备案查询。
 *
 * 号码不写在代码里:构建时从环境变量 ICP_BEIAN 读(网站的发布流程设好了它;vite.config.ts 写进页面)。
 * 没设的构建(自己架的网站、本机开发)哪里都不显示,别人用这份代码架的网站不会挂上不属于它的号。
 * 网站的发布流程另有总开关:仓库变量 ICP_BEIAN_SHOW 不是 1 时,不把 ICP_BEIAN 传给构建(暂时不想挂号码就不设它)。
 *
 * 挂在这几处(没有号码时都不出现):
 *   首页、分享停了的那一页  底部那排小字的正中(MyWorlds.tsx、AccountDialogs.tsx;手机上单独一行居中)
 *   世界概览              底部那排小字的正中(电脑上;WorldOverview.tsx)
 *   「更多」菜单          版本号下面一行(VersionNews.tsx 的 VersionMenuFoot)
 *   加载画面              最底下正中,和首页同一个位置(scripts/lib/loadScreen.ts)
 *   隐私政策、用户协议、使用教程  页面最底下(public/ 下的静态页,构建时写进去,见 scripts/lib/beian.ts)
 *
 * 以后再有别的备案号(比如公安备案),在 beianRecords 里加一项:各处并排(菜单里一项一行)。
 */

/** 一个备案号:显示的文字、点了打开的查询页 */
export interface BeianRecord {
  id: string;
  text: string;
  href: string;
}

/** ICP 备案号点了打开的查询页 */
export const ICP_QUERY_URL = 'https://beian.miit.gov.cn/';

/** 构建时给的号码 → 要挂的备案号(没给、空白 = 一个都不挂) */
export function beianRecords(icp: string | null | undefined): BeianRecord[] {
  const text = (icp ?? '').trim();
  return text ? [{ id: 'icp', text, href: ICP_QUERY_URL }] : [];
}

declare const __ICP_BEIAN__: string | undefined;

/** 这次构建要挂的备案号 */
export const BEIAN: BeianRecord[] = beianRecords(typeof __ICP_BEIAN__ === 'string' ? __ICP_BEIAN__ : '');

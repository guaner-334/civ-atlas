/**
 * 调规则的入口开没开:「我的世界」的「规则」分段、规则的分享链接(#rules=…)、打开规则文件,三处都看这一个开关。
 *
 * 默认关(RULES_UI = false):新建世界时选规则那一块还没做好,只有调规则的页用不起来,先不让人看到;
 * 那一块做好以后把 RULES_UI 改成 true,一起露出来。
 *
 * 关着的时候本地开发、截图、测试照样能打开(打开网页时看一次,之后改网址不影响):
 *   - 网址加 ?rulesUi=1(只这一次打开的页面;首页照常先出,见 homeStart.ts 的 HARMLESS)
 *   - 或者浏览器存储里 wenming-ditu:rules-ui 设成 1(一直开着;控制台里 localStorage.setItem('wenming-ditu:rules-ui', '1'))
 */

/** 正式打开(改成 true 就不用上面的办法了) */
export const RULES_UI = false;

/** 网址里打开调规则入口的键(?rulesUi=1) */
export const RULES_UI_PARAM = 'rulesUi';
const KEY = 'wenming-ditu:rules-ui';

let on: boolean | null = null;

/** 调规则的入口开没开(打开网页时看一次) */
export function rulesUiOn(): boolean {
  if (on !== null) return on;
  on = RULES_UI;
  if (!on && typeof location !== 'undefined') {
    try {
      on = new URLSearchParams(location.search).get(RULES_UI_PARAM) === '1' || localStorage.getItem(KEY) === '1';
    } catch {
      on = false;
    }
  }
  return on;
}

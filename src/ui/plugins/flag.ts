/**
 * 插件界面开没开:「更多」菜单里的「插件」、插件页、装插件时的权限框都看这一个开关;关着时这些代码都不下载。
 *
 * 构建时带 VITE_PLUGINS=on 才整个打开,别的值或不带都是关;关着时测试网站和本机开发的网址带 plugins=on 能在这个标签页里临时打开。
 */
import { BETA_SITE } from '../oldSite';

export const PLUGINS_UI: boolean = import.meta.env?.VITE_PLUGINS === 'on';

const PARAM = 'plugins';
/** 网站换网址时会去掉认不得的参数,所以记在这个标签页里 */
const KEY = 'civ-atlas:plugins-ui';

function askedHere(): boolean {
  try {
    if (new URLSearchParams(location.search).get(PARAM) === 'on') {
      sessionStorage.setItem(KEY, '1');
      return true;
    }
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

const TRYABLE = BETA_SITE || !!import.meta.env?.DEV;
let asked: boolean | null = null;

/** 插件界面开没开 */
export function pluginsUiOn(): boolean {
  if (PLUGINS_UI) return true;
  if (!TRYABLE) return false;
  asked ??= askedHere();
  return asked;
}

// 网址里的参数要在网站第一次换网址之前读到
if (TRYABLE && typeof location !== 'undefined') pluginsUiOn();

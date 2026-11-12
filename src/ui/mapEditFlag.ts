/**
 * 「我的世界」地图面板上修改、删除地图的新按钮开没开。
 *
 * 测试网站一直开着,正式网站关着;本机开发的网址带 mapedit=on 能在这个标签页里临时打开。
 */
import { BETA_SITE } from './oldSite';

const PARAM = 'mapedit';
/** 网站换网址时会去掉认不得的参数,所以记在这个标签页里 */
const KEY = 'civ-atlas:map-edit-ui';

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

const TRYABLE = !!import.meta.env?.DEV;
let asked: boolean | null = null;

/** 地图面板的修改、删除按钮开没开 */
export function mapEditOn(): boolean {
  if (BETA_SITE) return true;
  if (!TRYABLE) return false;
  asked ??= askedHere();
  return asked;
}

// 网址里的参数要在网站第一次换网址之前读到
if (!BETA_SITE && TRYABLE && typeof location !== 'undefined') mapEditOn();

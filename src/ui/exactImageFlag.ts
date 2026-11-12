/**
 * 照手绘图新建第 1 步的「海岸:照图原样 / 自然一些」开没开。
 *
 * 默认关;测试网站和本机开发的网址带 exactimage=on 能在这个标签页里临时打开。
 */
import { BETA_SITE } from './oldSite';

const PARAM = 'exactimage';
/** 网站换网址时会去掉认不得的参数,所以记在这个标签页里 */
const KEY = 'civ-atlas:exact-image-ui';

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

/** 照图原样那一行开没开 */
export function exactImageOn(): boolean {
  if (!TRYABLE) return false;
  asked ??= askedHere();
  return asked;
}

// 网址里的参数要在网站第一次换网址之前读到
if (TRYABLE && typeof location !== 'undefined') exactImageOn();

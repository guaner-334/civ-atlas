import { PLUGIN_FILE_EXT } from '../../plugin/pluginFile';
import { isCoarse } from '../device';

/** 手机和 Safari 上不限文件类型:.civplugin 系统不认识,写了可能灰掉不让选 */
export function pickAccept(): string | undefined {
  const ua = navigator.userAgent;
  if (isCoarse() || /iPhone|iPad|iPod|Android|Mobile/i.test(ua) || (/Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua))) return undefined;
  return PLUGIN_FILE_EXT;
}

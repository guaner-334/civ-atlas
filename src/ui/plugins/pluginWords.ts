/** 插件的版本、大小、权限的短说法。不碰插件代码:投稿窗、我的投稿也用 */

/** 「1.0.0」→「1.0」;补丁号不是 0 的照写 */
export function versionText(v: string): string {
  return v.replace(/^(\d+\.\d+)\.0$/, '$1');
}

/** 「第 1.0 版」 */
export const versionLabel = (v: string): string => `第 ${versionText(v)} 版`;

/** 22 KB、1.2 MB */
export function sizeText(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1000) return `${Math.max(1, Math.round(kb))} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

const COUNT = ['', '一', '两', '三', '四', '五', '六', '七', '八', '九'];

/** 「新版多要一样：」 */
export function moreText(n: number): string {
  return `新版多要${COUNT[n] ?? n}样：`;
}

/** 权限框各行的短说法(小标签上用) */
export const CAP_LABEL: Readonly<Record<string, string>> = {
  map: '看地图',
  history: '看历史',
  authorRead: '看你写的',
  authorWrite: '改你写的',
  view: '看你点了哪',
  layer: '加图层',
  storeWorld: '存进世界',
};

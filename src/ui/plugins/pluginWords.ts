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
  sim: '推演里加数',
  simSteer: '改推演',
  mapSteer: '改地图',
};

/** 没装插件那一页:没有服务器就没有作品墙,只说从文件装 */
export function installHowText(hasWall: boolean): string {
  return `在插件页里从${hasWall ? '作品墙或' : ''}文件装，装好回到这里选。`;
}

/** 问框里本机没装、作品墙上又没有这一版的插件下面那句 */
export function noWallVersionText(hasWall: boolean): string {
  return `${hasWall ? '作品墙上没有这一版：' : ''}向分享这个世界的人要插件文件，在「插件」页从文件装`;
}

/** 往世界里存插件数据后不能做的事 */
export function noShareText(hasWall: boolean): string {
  return `不能复制链接、不能分享${hasWall ? '、不能投到作品墙' : ''}`;
}

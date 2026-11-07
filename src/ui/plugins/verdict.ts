/** 一份插件文件(按指纹)审没审过、停没停用。作品墙和停用名单还没有,所以从文件装的都是没审核、没停用 */

export interface PluginVerdict {
  reviewed: boolean;
  /** 网站停用了这一版:why 写为什么,day 哪天停的(「11 月 6 日」) */
  blocked: { why: string; day: string } | null;
}

const NONE: PluginVerdict = { reviewed: false, blocked: null };

export function verdictOf(sum: string): PluginVerdict {
  // 开发时截图用:window.__pluginVerdicts = { 指纹: { reviewed, blocked } }
  if (import.meta.env?.DEV) {
    const fake = (globalThis as { __pluginVerdicts?: Record<string, PluginVerdict> }).__pluginVerdicts?.[sum];
    if (fake) return fake;
  }
  return NONE;
}

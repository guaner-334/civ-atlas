/** 插件页、权限框上的几句话。纯计算,单测直接测 */
import { permissionLines, type PermissionLine } from '../../plugin/pluginCaps';
import type { PluginManifest } from '../../plugin/pluginFile';

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

/** 11 月 8 日(不是今年的带上年) */
export function dayText(at: number, now = Date.now()): string {
  const d = new Date(at);
  const year = d.getFullYear() === new Date(now).getFullYear() ? '' : `${d.getFullYear()} 年 `;
  return `${year}${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

const who = (m: PluginManifest): string[] => (m.author ? [`${m.author.name} 写的`] : []);

/** 权限框标题下面那行;phone 不写许可证 */
export function askByLine(m: PluginManifest, bytes: number, phone: boolean): string {
  return [...who(m), versionLabel(m.version), sizeText(bytes), ...(phone ? [] : [`开源许可证 ${m.license}`])].join('，');
}

/** 插件页名字下面那行(版本号在名字旁边) */
export function pageByLine(m: PluginManifest, bytes: number): string {
  return [...who(m), `开源许可证 ${m.license}`, sizeText(bytes)].join('，');
}

const COUNT = ['', '一', '两', '三', '四', '五', '六', '七', '八', '九'];

/** 「新版多要一样：」 */
export function moreText(n: number): string {
  return `新版多要${COUNT[n] ?? n}样：`;
}

/** 更新时新多出来的权限行(旧版没有的行;同一行里多要了一样能力不算) */
export function addedLines(old: PluginManifest, next: PluginManifest): PermissionLine[] {
  const had = new Set(permissionLines(old).map((l) => l.key));
  return permissionLines(next).filter((l) => !had.has(l.key));
}

const caps = (m: PluginManifest) => new Set([...m.requires, ...(m.optional ?? [])]);

export interface AddsRow {
  k: string;
  v: string;
  small?: string;
}

/** 插件页「它加了什么」 */
export function addsRows(m: PluginManifest, phone: boolean): AddsRow[] {
  const c = caps(m);
  const rows: AddsRow[] = [];
  if (c.has('ui.panel@1')) rows.push({ k: `工具「${m.name}」`, v: phone ? '在右上竖排的拼图里' : '在地图右下的「工具」里' });
  if (c.has('layer.cells@1')) rows.push({ k: '图层', v: '在图层面板的「插件图层」里' });
  const k = '往世界里存东西';
  if (c.has('store.world@1')) rows.push({ k, v: '存它自己的数据', small: '存了以后那个世界不能公开分享，能存成文件发给别人' });
  else if (c.has('author.write@1')) rows.push({ k, v: '不存它自己的数据', small: phone ? '改的东西记进你的修改，照常能分享' : '改的东西记进你的修改，和你自己改的一样：能分享、能撤销' });
  else rows.push({ k, v: '不存', small: '它算的关掉就没了，世界不变' });
  return rows;
}

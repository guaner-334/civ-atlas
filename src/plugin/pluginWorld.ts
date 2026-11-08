/**
 * 插件和世界文件之间:世界清单里怎么记插件、一个世界用到了哪些插件、本机装没装。纯计算,网页、Worker、服务器共用。
 */
import { PLUGIN_DATA_PREFIX, PLUGIN_LAYER_ID, type WorldManifest, type WorldPartInfo, type WorldPlugin } from '../gen/worldFormat';
import type { OpenedPlugin } from './pluginFile';

/** 世界清单 plugins 里记这个插件的那一条 */
export function worldPluginOf(p: Pick<OpenedPlugin, 'manifest' | 'sum'>): WorldPlugin {
  return { id: p.manifest.id, version: p.manifest.version, sum: p.sum, role: p.manifest.role, name: p.manifest.name };
}

/**
 * 工具插件交的图层编号(字母、数字、- 和 _,最长 32)存进世界时块名里写成什么:合块名规矩的(PLUGIN_LAYER_ID)原样用,
 * 有大写、下划线或太长的换成 h + 编号的 8 位十六进制散列(FNV-1a)
 */
export function savedLayerId(layerId: string): string {
  if (PLUGIN_LAYER_ID.test(layerId)) return layerId;
  let h = 0x811c9dc5;
  for (let i = 0; i < layerId.length; i++) h = Math.imul(h ^ layerId.charCodeAt(i), 0x01000193) >>> 0;
  return `h${h.toString(16).padStart(8, '0')}`;
}

/** 世界里用到的一个插件 */
export interface WorldPluginUse {
  id: string;
  /** 清单里的记录;没记 = null */
  plugin: WorldPlugin | null;
  /** 它存的数据那一块;没存 = null */
  data: WorldPartInfo | null;
  /** 本机:same 装的正是世界记的那一版,other 装了别的版本,none 没装 */
  here: 'same' | 'other' | 'none';
}

/** 一个世界用到的插件(清单里记的,和存了数据的),按清单里的先后;installed = 本机装的插件和现在用的那一版的指纹 */
export function pluginsInWorld(m: Pick<WorldManifest, 'parts' | 'plugins'>, installed: readonly { id: string; current: { sum: string } }[]): WorldPluginUse[] {
  const data = new Map(m.parts.filter((p) => p.name.startsWith(PLUGIN_DATA_PREFIX)).map((p) => [p.name.slice(PLUGIN_DATA_PREFIX.length), p]));
  const ids = [...new Set([...m.plugins.map((p) => p.id), ...data.keys()])];
  return ids.map((id) => {
    const plugin = m.plugins.find((p) => p.id === id) ?? null;
    const have = installed.find((p) => p.id === id);
    const here = !have ? 'none' : plugin && have.current.sum === plugin.sum ? 'same' : 'other';
    return { id, plugin, data: data.get(id) ?? null, here };
  });
}

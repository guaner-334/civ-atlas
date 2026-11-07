/** 本机装的插件。TEMP:本机插件仓库还没合进来,先存在内存里,接口照它的写 */
import { openPluginFile, type PluginManifest } from '../../plugin/pluginFile';

export interface PluginVersion {
  sum: string;
  bytes: number;
  manifest: PluginManifest;
  at: number;
  /** 装的时候的文件名 */
  file?: string;
}

export interface InstalledPlugin {
  id: string;
  current: PluginVersion;
  previous?: PluginVersion;
  on: boolean;
  from: 'file';
  at: number;
}

export type InstallResult = { status: 'added' | 'same'; plugin: InstalledPlugin } | { status: 'updated'; plugin: InstalledPlugin; replaced: PluginVersion };

const rows = new Map<string, InstalledPlugin>();
const files = new Map<string, Uint8Array>();

export async function listPlugins(): Promise<InstalledPlugin[]> {
  return [...rows.values()].sort((a, b) => a.at - b.at);
}

export async function installPlugin(bytes: Uint8Array, file?: string): Promise<InstallResult> {
  const opened = await openPluginFile(bytes);
  const ver: PluginVersion = { sum: opened.sum, bytes: opened.bytes, manifest: opened.manifest, at: Date.now(), ...(file ? { file } : {}) };
  const had = rows.get(ver.manifest.id);
  if (had?.current.sum === ver.sum) return { status: 'same', plugin: had };
  files.set(ver.sum, bytes);
  const plugin: InstalledPlugin = had ? { ...had, current: ver, previous: had.current, on: true } : { id: ver.manifest.id, current: ver, on: true, from: 'file', at: ver.at };
  rows.set(plugin.id, plugin);
  return had ? { status: 'updated', plugin, replaced: had.current } : { status: 'added', plugin };
}

export async function removePlugin(id: string): Promise<boolean> {
  return rows.delete(id);
}

export async function setPluginOn(id: string, on: boolean): Promise<InstalledPlugin> {
  const p = rows.get(id);
  if (!p) throw new Error(`没装 ${id}`);
  const next = { ...p, on };
  rows.set(id, next);
  return next;
}

export async function pluginFileBytes(sum: string): Promise<Uint8Array | null> {
  return files.get(sum) ?? null;
}

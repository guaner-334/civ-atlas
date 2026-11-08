/**
 * 推演要带的推演插件从本机插件仓库取出来(交给推演线程的 SimPluginFile)。只在用到插件时 import(),首页不带它。
 * 接着推只用世界记的那一版(指纹一样)和世界记的滑条;对不上不偷偷按官方推,交回核对的结果
 */
import type { WorldPlugin } from '../gen/worldFormat';
import { PluginStoreError, listPlugins, pluginFileBytes } from './pluginStore';
import { checkSimPlugins, recordParams, simPluginsIn, type SimPluginCheck, type SimPluginFile } from './pluginWorld';

/** 接着推:都对得上 = 各插件的文件(按世界记的先后,没用推演插件 = 空);有对不上的 = 每个插件的核对结果 */
export type SimPluginsReady = { ok: true; files: SimPluginFile[] } | { ok: false; checks: SimPluginCheck[] };

/** 世界清单里记的推演插件(plugins)本机都有同一版就取出来;仓库里那一版的文件没了算没装 */
export async function simPluginsReady(plugins: readonly WorldPlugin[]): Promise<SimPluginsReady> {
  if (!simPluginsIn(plugins).length) return { ok: true, files: [] };
  const checks = checkSimPlugins(plugins, await listPlugins());
  const files: SimPluginFile[] = [];
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const bytes = c.status === 'ready' ? await pluginFileBytes(c.plugin.sum) : null;
    if (!bytes) {
      if (c.status === 'ready') checks[i] = { id: c.id, plugin: c.plugin, status: 'missing' };
      continue;
    }
    const params = recordParams(c.plugin);
    files.push({ id: c.id, sum: c.plugin.sum, bytes, ...(params ? { params } : {}) });
  }
  return checks.every((c) => c.status === 'ready') ? { ok: true, files } : { ok: false, checks };
}

/** 新推一个世界(新建、另存按新版重推)带的推演插件:各用本机现在用的那一版;没装的抛 PluginStoreError(missing) */
export async function simPluginFiles(chosen: readonly { id: string; params?: Readonly<Record<string, number>> }[]): Promise<SimPluginFile[]> {
  const installed = await listPlugins();
  const files: SimPluginFile[] = [];
  for (const c of chosen) {
    const have = installed.find((p) => p.id === c.id);
    const bytes = have && (await pluginFileBytes(have.current.sum));
    if (!have || !bytes) throw new PluginStoreError('missing', `没装 ${c.id}`);
    files.push({ id: c.id, sum: have.current.sum, bytes, ...(c.params ? { params: { ...c.params } } : {}) });
  }
  return files;
}

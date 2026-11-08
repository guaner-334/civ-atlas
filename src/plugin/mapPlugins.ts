/**
 * 生成要带的地图插件从本机插件仓库取出来(交给生成线程的 MapPluginFile)。只在用到插件时 import(),首页不带它。
 * 世界记着的地图插件:本机有同一版才带字节(改地形、重长都照它);对不上的只带编号和指纹,交回核对的结果
 */
import type { WorldPlugin } from '../gen/worldFormat';
import { PluginStoreError, listPlugins, pluginFileBytes } from './pluginStore';
import { checkMapPlugins, mapPluginIds, simParamsOf, type MapPluginCheck, type MapPluginFile } from './pluginWorld';

/**
 * 世界记着的地图插件:files 按世界记的先后,和清单一一对上(没用地图插件 = 空);都对得上的带字节。
 * ok = false 时 checks 是每个插件的核对结果,files 只带编号、指纹、滑条
 */
export type MapPluginsReady = { ok: true; files: MapPluginFile[] } | { ok: false; files: MapPluginFile[]; checks: MapPluginCheck[] };

/** 世界清单里记的地图插件本机都有同一版就取出来;仓库里那一版的文件没了算没装 */
export async function mapPluginsReady(plugins: readonly WorldPlugin[]): Promise<MapPluginsReady> {
  const ids = mapPluginIds(plugins);
  if (!ids.length) return { ok: true, files: [] };
  const checks = checkMapPlugins(plugins, await listPlugins());
  const files: MapPluginFile[] = [];
  for (let i = 0; i < checks.length; i++) {
    const c = checks[i];
    const bytes = c.status === 'ready' ? await pluginFileBytes(c.plugin.sum) : null;
    if (!bytes && c.status === 'ready') checks[i] = { id: c.id, plugin: c.plugin, status: 'missing' };
    files.push(bytes ? { ...ids[i], bytes } : ids[i]);
  }
  return checks.every((c) => c.status === 'ready') ? { ok: true, files } : { ok: false, files: ids, checks };
}

/**
 * 新长一张地图(新建、另存按新版重长)带的地图插件:各用本机现在用的那一版,滑条照它的清单补齐、压回上下限
 * (世界记的、线程认的都是补齐以后的);没装的、不是地图插件的抛 PluginStoreError(missing)
 */
export async function mapPluginFiles(chosen: readonly { id: string; params?: Readonly<Record<string, number>> }[]): Promise<MapPluginFile[]> {
  const installed = await listPlugins();
  const files: MapPluginFile[] = [];
  for (const c of chosen) {
    const have = installed.find((p) => p.id === c.id);
    const bytes = have && have.current.manifest.role === 'map' && (await pluginFileBytes(have.current.sum));
    if (!have || !bytes) throw new PluginStoreError('missing', `没装 ${c.id}`);
    const params = simParamsOf(have.current.manifest.map?.params, c.params);
    files.push({ id: c.id, sum: have.current.sum, bytes, ...(Object.keys(params).length ? { params } : {}) });
  }
  return files;
}

/**
 * 打开着的世界和插件:用到了哪些插件、哪些存了自己的数据(存了的世界不能公开分享)、本机没装的;
 * 插件往世界里存自己的数据(store.world):每个世界第一次存时先问一句;去掉插件存的数据。
 */
import { PLUGIN_DATA_PREFIX, type WorldPlugin } from '../../gen/worldFormat';
import { PluginApiError } from '../../plugin/check';
import { worldDataStore } from '../../plugin/pluginData';
import { listPlugins, type InstalledPlugin } from '../../plugin/pluginStore';
import { pluginsInWorld, type WorldPluginUse } from '../../plugin/pluginWorld';
import { approxBytes } from '../../plugin/protocol';
import type { PluginDataStore } from '../../plugin/store';
import { currentWorld, keepWorld } from '../saveStore';
import { settleWorld, vaultCall } from '../worldStore';
import { askData, kbText } from './askState';
import './worldData.css';

/** 世界里用到的一个插件,连同叫什么(清单里记的名字,没记看本机装的,都没有写编号) */
export interface UsedPlugin extends WorldPluginUse {
  name: string;
  installed: InstalledPlugin | null;
}

/** 这个世界用到的插件(按清单里的先后);读不了 = 空 */
export async function usedPlugins(worldId: string): Promise<UsedPlugin[]> {
  const [m, installed] = await Promise.all([vaultCall('worldPluginsOf', [worldId]).catch(() => null), listPlugins().catch(() => [] as InstalledPlugin[])]);
  if (!m) return [];
  return pluginsInWorld(m, installed).map((u) => {
    const have = installed.find((p) => p.id === u.id) ?? null;
    return { ...u, name: u.plugin?.name ?? have?.current.manifest.name ?? u.id, installed: have };
  });
}

/** 存了自己数据的插件(这几个让世界不能公开分享) */
export const withData = (list: readonly UsedPlugin[]): UsedPlugin[] => list.filter((u) => u.data);

/** 名字连起来:「城邦税赋」「起名助手」 */
export const namesText = (list: readonly { name: string }[]): string => list.map((u) => `「${u.name}」`).join('');

/** 打开世界时要说的那句:存了自己数据、本机没装的插件(只存了图层的不算);没有 = null */
export async function missingNote(worldId: string): Promise<string | null> {
  const miss = withData(await usedPlugins(worldId)).filter((u) => u.here === 'none');
  return miss.length ? `用到了你没装的插件${namesText(miss)}，它${miss.length > 1 ? '们' : ''}存的数据原样留着` : null;
}

/** 去掉这个世界里所有插件存的数据(先问一句);去掉了 = true */
export async function removePluginData(worldId: string, list: readonly UsedPlugin[]): Promise<boolean> {
  const data = withData(list);
  if (!data.length) return false;
  const bytes = data.reduce((n, u) => n + (u.data?.bytes ?? 0), 0);
  if (!(await askData({ kind: 'remove', plugins: data.map((u) => u.name), kb: kbText(bytes) }))) return false;
  for (const u of data) {
    const rec: WorldPlugin = u.plugin ?? { id: u.id, version: '0', sum: '0'.repeat(64), role: 'tool' };
    await vaultCall('changePluginData', [worldId, rec, null]);
  }
  return true;
}

/** 这个世界、这个插件:这次打开里点过「存进这个世界」的(不再问)、点过「这次不存」的(不再问,直接回插件不行) */
const agreed = new Set<string>();
const declined = new Set<string>();
const asking = new Map<string, Promise<boolean>>();

/** 世界还没存进「我的世界」的先存下来再写 */
async function write(st: PluginDataStore, worldId: string, pid: string, data: Parameters<PluginDataStore['set']>[1]) {
  keepWorld(worldId);
  try {
    await st.set(pid, data);
  } catch (e) {
    if (!(e instanceof PluginApiError) || e.code !== 'unavailable') throw e;
    await settleWorld(worldId);
    await st.set(pid, data);
  }
}

/**
 * 插件存进打开着的世界的数据:每个世界第一次存(世界里还没有它的数据)时先问用的人;点「这次不存」回插件 cancelled,
 * 这次打开里不再问。record = 世界清单里记的这个插件,name = 框上写的名字
 */
export function askingWorldStore(record: WorldPlugin, name: string): PluginDataStore {
  const store = (worldId: string) => worldDataStore(vaultCall, worldId, record);
  const world = () => currentWorld()?.id ?? null;
  return {
    get: (pid) => {
      const w = world();
      if (!w) throw new PluginApiError('unavailable', '还没有打开世界');
      return store(w).get(pid);
    },
    set: async (pid, data) => {
      const w = world();
      if (!w) throw new PluginApiError('unavailable', '还没有打开世界');
      const key = `${w}\n${pid}`;
      // 去掉:不用问;世界还没存下来就本来没有
      if (!data)
        return void (await Promise.resolve(store(w).set(pid, null)).catch((e: unknown) => {
          if (!(e instanceof PluginApiError && e.code === 'unavailable')) throw e;
        }));
      if (!agreed.has(key)) {
        const m = await vaultCall('worldPluginsOf', [w]).catch(() => null);
        if (!m?.parts.some((p) => p.name === `${PLUGIN_DATA_PREFIX}${pid}`)) {
          if (declined.has(key)) throw new PluginApiError('cancelled', '用的人这次没让存进这个世界');
          let q = asking.get(key);
          if (!q) {
            q = askData({ kind: 'store', plugin: name, pluginId: pid, sum: record.sum, kb: kbText(approxBytes(data.value, Infinity)) });
            asking.set(key, q);
            void q.finally(() => asking.delete(key));
          }
          if (!(await q)) {
            declined.add(key);
            throw new PluginApiError('cancelled', '用的人这次没让存进这个世界');
          }
        }
        agreed.add(key);
      }
      await write(store(w), w, pid, data);
    },
  };
}

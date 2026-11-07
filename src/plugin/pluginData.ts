/**
 * 插件接口存数据(store.local、store.world)落到本机:设置进插件仓库,世界的数据进世界仓库(写一份新修订)。
 * 开插件时作为 stores 交给 startPluginHost。
 */
import type { WorldPlugin } from '../gen/worldFormat';
import type { VaultCaller } from '../ui/worldStore';
import { PluginApiError } from './check';
import { PluginStoreError, readPluginLocal, writePluginLocal } from './pluginStore';
import type { PluginDataStore } from './store';
import type { StoredData } from './types';

const asApiError = (e: unknown): unknown => (e instanceof PluginStoreError && e.kind === 'big' ? new PluginApiError('limit', e.message) : e);

/** 插件的设置:存在插件仓库,不在世界里 */
export const localDataStore: PluginDataStore = {
  get: async (pluginId) => ((await readPluginLocal(pluginId)) as StoredData | undefined) ?? null,
  set: (pluginId, data) =>
    writePluginLocal(pluginId, data ?? undefined).catch((e: unknown) => {
      throw asApiError(e);
    }),
};

/** 存进这个世界的数据;plugin = 世界清单里记的这个插件(pluginWorld.ts 的 worldPluginOf) */
export function worldDataStore(call: VaultCaller, worldId: string, plugin: WorldPlugin): PluginDataStore {
  return {
    get: async (pluginId) => {
      const r = await call('readPluginData', [worldId, pluginId]);
      return r ? { schema: r.schema, value: r.value } : null;
    },
    set: async (pluginId, data) => {
      const r = await call('changePluginData', [worldId, { ...plugin, id: pluginId }, data]);
      if (r.status === 'nobase') throw new PluginApiError('unavailable', '这个世界还没存下来');
      if (r.status === 'big') throw new PluginApiError('limit', '最多 1 MB');
    },
  };
}

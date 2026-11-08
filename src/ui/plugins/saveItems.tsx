/** 「存档」菜单里和插件存的数据有关的几样:有插件存了自己数据的世界分享灰着、「去掉插件存的数据…」(插件界面开着才有) */
import { useEffect, useState } from 'react';
import { showToast } from '../toastStore';
import { pluginsUiOn } from './flag';
import type { UsedPlugin } from './worldPlugins';

const load = () => import('./worldPlugins');

/** 菜单开着时这个世界里存了自己数据的插件;没有、还没查到 = 空 */
export function usePluginData(open: boolean, worldId: string | undefined, version: number): UsedPlugin[] {
  const [got, setGot] = useState<{ id: string; list: UsedPlugin[] } | null>(null);
  useEffect(() => {
    if (!open || !worldId || !pluginsUiOn()) return;
    let live = true;
    void load()
      .then(async (m) => m.withData(await m.usedPlugins(worldId)))
      .then(
        (list) => live && setGot({ id: worldId, list }),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [open, worldId, version]);
  return got && got.id === worldId ? got.list : [];
}

export const pluginNames = (list: readonly UsedPlugin[]): string => list.map((u) => `「${u.name}」`).join('');

/** 这个世界里存了自己数据的插件的名字(「城邦税赋」);没有、插件界面关着、查不了 = '' */
export async function pluginDataNames(worldId: string | undefined): Promise<string> {
  if (!worldId || !pluginsUiOn()) return '';
  try {
    const m = await load();
    return pluginNames(m.withData(await m.usedPlugins(worldId)));
  } catch {
    return '';
  }
}

/** 一个盒子:插件存的东西 */
function BoxIcon() {
  return (
    <svg className="icon" width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
      <path d="m3 8 9 5 9-5M12 13v8" />
    </svg>
  );
}

/** 「去掉插件存的数据…」:先问一句,去掉以后这个世界就能分享了 */
export function RemoveDataItem({ worldId, list, phone, onDone }: { worldId: string; list: UsedPlugin[]; phone: boolean; onDone: () => void }) {
  const names = pluginNames(list);
  const click = () => {
    onDone();
    void load()
      .then((m) => m.removePluginData(worldId, list))
      .then(
        (done) => done && showToast({ id: 'plugin-data', kind: 'ok', text: `已去掉插件${names}存的数据`, more: ['这个世界能分享了'] }),
        () => showToast({ id: 'plugin-data', kind: 'error', text: `没能去掉插件${names}存的数据`, more: ['这次没写进去，世界没变'] }),
      );
  };
  return (
    <button className="save-it" data-act="plugin-data-remove" onClick={click}>
      <BoxIcon />
      <span>
        <b>去掉插件存的数据…</b>
        <small>{phone ? '去掉以后就能分享，世界本身不变' : `去掉以后就能分享。${names}存在这个世界里的数据会没了，世界本身不变`}</small>
      </span>
    </button>
  );
}

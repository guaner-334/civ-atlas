/** 世界用的地图插件本机对不上时改地形先问(问的窗另做,这里只记着要问什么)、配方链接不给:只在世界页用,不进首页 */
import { useSyncExternalStore } from 'react';
import type { WorldEdits } from '../../gen/edits';
import type { MapPluginCheck } from '../../plugin/pluginWorld';
import { currentWorld } from '../saveStore';
import { useMapNow } from './mapNow';

/** 地图上这个世界用了地图插件:配方链接不给(配方里没有插件,别人点开长出来是另一张图) */
export function useMapLinkOff(): boolean {
  const s = useMapNow();
  return !!s && s.id === currentWorld()?.id;
}

/**
 * 世界用的地图插件本机对不上(没装、只有别的版本、被网站停用)时要改地形(画草图、加地形大事)先问一声:
 * 不改,地图照原样(装上同一版、另存一份按新版或不带停用的重长,由问的窗决定)
 */
export interface MapAsk {
  title: string;
  checks: MapPluginCheck[];
  /** 改之前、要改成的修改 */
  now: WorldEdits;
  next: WorldEdits;
}

let ask: MapAsk | null = null;
const askSubs = new Set<() => void>();
export function askMaps(a: MapAsk | null): void {
  ask = a;
  for (const f of askSubs) f();
}
export function useMapAsk(): MapAsk | null {
  return useSyncExternalStore(
    (f) => {
      askSubs.add(f);
      return () => askSubs.delete(f);
    },
    () => ask,
  );
}

/** 世界用的推演插件本机对不上时问的窗、配方链接灰着:只在世界页用,不进首页 */
import { useSyncExternalStore } from 'react';
import type { WorldEdits } from '../../gen/edits';
import type { SimPluginCheck } from '../../plugin/pluginWorld';
import { currentWorld } from '../saveStore';
import { getSimNow, useSimNow } from './simNow';

/** 配方链接带不上推演插件,对方长出来的历史不一样 */
export const SIM_NO_LINK = '推演插件带不进链接，对方长出来的历史不一样。要发给别人，请存成文件';

/** 世界在等本机装上推演插件才存得下(世界小状态的 simWait):存档菜单里那一句 */
export function simWaitText(ids: readonly string[]): string {
  const list = getSimNow()?.list ?? [];
  const names = ids.map((id) => `「${list.find((p) => p.id === id)?.name ?? id}」`).join('');
  return `用了推演插件${names}，这台设备没装同一版，内容先照原样留着。看不用装；装上同一版以后会自己存好`;
}

/** 地图上这个世界用了推演插件:「复制配方链接」灰着 */
export function useSimLinkOff(): boolean {
  const s = useSimNow();
  return !!s && s.id === currentWorld()?.id;
}

/**
 * 世界用的推演插件本机对不上时,要接着推(再推、改过去、照大纲、逐年推演走下一步)先问一声(plugins/SimAsk.tsx):
 * 有被网站停用的先说停用了,只能另存一份不带它的;有没装的说要先装;都装了、有的只有别的版本,问要不要另存一份按新版从第 0 年重推
 * (copy 做这件事,drop = 不带的插件)
 */
export interface SimAsk {
  title: string;
  checks: SimPluginCheck[];
  /** 改之前、要改成的修改(说这次要做的:再推几年、推演几条命令) */
  now: WorldEdits;
  next: WorldEdits;
  copy: (drop: readonly string[]) => void;
}

let gate: ((next: WorldEdits) => boolean) | null = null;
export function setSimGate(f: ((next: WorldEdits) => boolean) | null): void {
  gate = f;
}
/** 要接着推成 next 之前核对推演插件:对不上就问(见 SimAsk),交回 true = 这次不推 */
export function simGated(next: WorldEdits): boolean {
  return !!gate && gate(next);
}

let ask: SimAsk | null = null;
const askSubs = new Set<() => void>();
export function askSims(a: SimAsk | null): void {
  ask = a;
  for (const f of askSubs) f();
}
export function useSimAsk(): SimAsk | null {
  return useSyncExternalStore(
    (f) => {
      askSubs.add(f);
      return () => askSubs.delete(f);
    },
    () => ask,
  );
}

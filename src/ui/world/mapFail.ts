/** 新建中的世界地图插件长不出地图(后台线程交回 mapFailed):星球上那张「长不出这张地图」的卡要说的;换了选的、重新长就收起 */
import { useSyncExternalStore } from 'react';
import type { MapStage } from '../../gen/mapHooks';
import type { MapFailedKind } from '../../worker';

export interface MapFail {
  /** 哪个世界(新建中的) */
  worldId: string;
  plugin: string;
  name: string;
  /** 世界记的那一版、文件指纹、滑条(复制给作者用) */
  version?: string;
  sum?: string;
  params?: Readonly<Record<string, number>>;
  stage: MapStage | null;
  why: string;
  kind: MapFailedKind;
  /** 合计算太久:到那时每一口各用了多久(按先后;名字换成给人看的) */
  spent?: { id: string; name: string; stage: MapStage; ms: number }[];
  seed: number;
  /** 改地形涂的一笔长不出来:卡先不放(顶上一条说了),「保存地图」「创建」照样灰着,撤销这一笔或重新长才放开;点「看看」才放卡 */
  quiet?: boolean;
}

let now: MapFail | null = null;
const subs = new Set<() => void>();

export function setMapFail(f: MapFail | null): void {
  if (f === now) return;
  now = f;
  for (const s of subs) s();
}

export const getMapFail = (): MapFail | null => now;

export function useMapFail(): MapFail | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => now,
  );
}

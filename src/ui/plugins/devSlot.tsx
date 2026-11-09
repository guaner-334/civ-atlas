/** 开发者模式载入的插件在地图左下角的小卡;卡和载入插件的代码(DevCard.tsx、dev.ts)载入了插件才下载 */
import { Suspense, lazy, useLayoutEffect, type MutableRefObject } from 'react';
import type { Civ } from '../../gen/civ/types';
import type { DevTryResult } from '../../plugin/devTry';
import type { DevGenLook } from '../../plugin/devGenWorker';
import type { SimPluginFile } from '../../plugin/pluginWorld';
import type { World } from '../../gen/world';
import { createStore } from '../createStore';
import type { MarkApi } from '../MarkLayer';
import type { MapProj } from '../../render/projection';

/**
 * 开发者模式载入的、图层面板里开的插件读的世界:地图上打开着的那个(civ 套了改名,raw 没套),没打开 = null。
 * root = 不带地形大事的那张(试生成照它),look = 地图现在的画风
 */
export const pluginWorld: { world: World | null; root: World | null; civ: Civ | null; raw: Civ | null; api: MutableRefObject<MarkApi | null> | null; look: DevGenLook } = {
  world: null,
  root: null,
  civ: null,
  raw: null,
  api: null,
  look: { style: 'fantasy' },
};

/** 地图上这个世界不带地形大事的那张:换了就是换了一张地图,之前的试生成不算 */
export const devRoot = createStore<World | null>(null);

/** 「放到地图上看」:盖在地图上的那张(没盖 = null) */
export const devMapView = createStore<ImageBitmap | null>(null);
export const useDevMapOn = (): boolean => devMapView.use() !== null;

/** 有没有载入的插件(dev.ts 改) */
export const devCardOn = createStore(false);

/** 开发者模式的「试推」:在地图上这个世界上带着 files 从第 0 年推 years 年(不改世界);progress = 推到哪了(0–1)。App 接上后台线程(sim/useSimRunners.ts) */
export type DevTryRunner = (files: SimPluginFile[], years: number, progress: (pct: number) => void) => Promise<DevTryResult>;
let tryRunner: DevTryRunner | null = null;
export function setDevTryRunner(r: DevTryRunner | null): void {
  tryRunner = r;
}
export function devTryRunner(): DevTryRunner | null {
  return tryRunner;
}

const DevCard = lazy(() => import('./DevCard').catch(() => ({ default: () => null })));
const DevMapCanvas = lazy(() => import('./DevMapCanvas').catch(() => ({ default: () => null })));

export function PluginDevMapSlot({ mp }: { mp: MapProj | null }) {
  const bitmap = devMapView.use();
  if (!bitmap) return null;
  return (
    <Suspense fallback={null}>
      <DevMapCanvas bitmap={bitmap} mp={mp} />
    </Suspense>
  );
}

export function PluginDevSlot({ phone, world, root, civ, raw, api, look }: { phone: boolean; world: World; root: World; civ: Civ | null; raw: Civ | null; api: MutableRefObject<MarkApi | null>; look: DevGenLook }) {
  useLayoutEffect(() => {
    Object.assign(pluginWorld, { world, civ, raw, api, look });
  }, [world, civ, raw, api, look.style, look.look, look.layer]);
  // 换了一张地图:盖着的那张是别的地图试生成的
  useLayoutEffect(() => {
    if (pluginWorld.root && pluginWorld.root !== root) devMapView.set(null);
    pluginWorld.root = root;
    devRoot.set(root);
  }, [root]);
  useLayoutEffect(
    () => () => {
      Object.assign(pluginWorld, { world: null, root: null, civ: null, raw: null, api: null });
      devMapView.set(null);
      devRoot.set(null);
    },
    [],
  );
  if (!devCardOn.use()) return null;
  return (
    <Suspense fallback={null}>
      <DevCard phone={phone} />
    </Suspense>
  );
}

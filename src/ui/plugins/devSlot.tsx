/** 开发者模式载入的插件在地图左下角的小卡;卡和载入插件的代码(DevCard.tsx、dev.ts)载入了插件才下载 */
import { Suspense, lazy, useLayoutEffect, type MutableRefObject } from 'react';
import type { Civ } from '../../gen/civ/types';
import type { World } from '../../gen/world';
import { createStore } from '../createStore';
import type { MarkApi } from '../MarkLayer';

/** 开发者模式载入的、图层面板里开的插件读的世界:地图上打开着的那个(civ 套了改名,raw 没套),没打开 = null */
export const pluginWorld: { world: World | null; civ: Civ | null; raw: Civ | null; api: MutableRefObject<MarkApi | null> | null } = { world: null, civ: null, raw: null, api: null };

/** 有没有载入的插件(dev.ts 改) */
export const devCardOn = createStore(false);

const DevCard = lazy(() => import('./DevCard').catch(() => ({ default: () => null })));

export function PluginDevSlot({ phone, world, civ, raw, api }: { phone: boolean; world: World; civ: Civ | null; raw: Civ | null; api: MutableRefObject<MarkApi | null> }) {
  useLayoutEffect(() => {
    Object.assign(pluginWorld, { world, civ, raw, api });
  }, [world, civ, raw, api]);
  useLayoutEffect(
    () => () => {
      Object.assign(pluginWorld, { world: null, civ: null, raw: null, api: null });
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

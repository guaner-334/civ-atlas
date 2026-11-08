/** 开发者模式载入的插件在地图左下角的小卡;卡和载入插件的代码(DevCard.tsx、dev.ts)载入了插件才下载 */
import { Suspense, lazy, useLayoutEffect } from 'react';
import type { Civ } from '../../gen/civ/types';
import type { World } from '../../gen/world';
import { createStore } from '../createStore';

/** 载入的插件读的世界:地图上打开着的那个,没打开 = null */
export const devWorld: { world: World | null; civ: Civ | null } = { world: null, civ: null };

/** 有没有载入的插件(dev.ts 改) */
export const devCardOn = createStore(false);

const DevCard = lazy(() => import('./DevCard').catch(() => ({ default: () => null })));

export function PluginDevSlot({ phone, world, civ }: { phone: boolean; world: World; civ: Civ | null }) {
  useLayoutEffect(() => {
    devWorld.world = world;
    devWorld.civ = civ;
  }, [world, civ]);
  useLayoutEffect(
    () => () => {
      devWorld.world = null;
      devWorld.civ = null;
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

/**
 * 地区模式(框好一块以后):平面图(RegionView.tsx,地区图)和立体(View.tsx)两面,底条上「平面图 | 立体」来回切,同一个框。
 * 两面共用一组后台线程(jobs.ts)和画好的地区图;离开地区模式(回到地图)才关掉线程、放掉画好的那一页。
 * Esc 回到地图(正在改标题时不算)。
 */
import { useEffect } from 'react';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { Civ } from '../../gen/civ/types';
import type { LayerId } from '../../render/layers';
import type { SurfaceLook } from '../../render/surface';
import type { CivStyle } from '../../render/civ/overlay';
import { closeRelief, getRelief, useRelief } from '../terrain3dStore';
import { reliefRelease } from './jobs';
import { RegionView, dropRegionCache } from './RegionView';
import { ReliefView } from './View';
import { isTyping } from '../useShortcuts';

interface Props {
  world: World;
  raster: Raster;
  civ: Civ | null;
  style: CivStyle;
  look: SurfaceLook;
  layer: LayerId;
  phone: boolean;
}

export function AreaView(props: Props) {
  const face = useRelief().face;
  // 离开地区模式:关掉线程、放掉画好的那一页
  useEffect(
    () => () => {
      reliefRelease();
      dropRegionCache();
    },
    [],
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || getRelief().phase !== 'view') return;
      if (isTyping(e.target)) return;
      closeRelief();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (face === 'flat') return <RegionView {...props} />;
  return <ReliefView world={props.world} raster={props.raster} civ={props.civ} style={props.style} look={props.look} phone={props.phone} />;
}

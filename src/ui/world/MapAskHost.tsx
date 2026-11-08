/** 世界用的地图插件本机对不上、要改地形之前问的窗(plugins/MapAsk.tsx,问的时候才下载) */
import { Suspense, lazy } from 'react';
import { useMapAsk } from './mapAsk';

const MapAskBox = lazy(() => import('../plugins/MapAsk'));

export function MapAskHost({ phone }: { phone: boolean }) {
  const ask = useMapAsk();
  if (!ask) return null;
  return (
    <Suspense fallback={null}>
      <MapAskBox ask={ask} phone={phone} />
    </Suspense>
  );
}

/** 「放到地图上看」:试生成带插件的那张盖在地图上,跟着地图拖动、缩放 */
import { useEffect, useLayoutEffect, useRef, type ReactElement } from 'react';
import type { MapProj } from '../../render/projection';
import { mirrorCanvas } from '../mapWrap';
import { ProjLayer } from '../projection';

export default function DevMapCanvas({ bitmap, mp }: { bitmap: ImageBitmap; mp: MapProj | null }): ReactElement | null {
  const ref = useRef<HTMLCanvasElement>(null);
  const copyRef = useRef<HTMLCanvasElement>(null);
  const proj = useRef<ProjLayer | null>(null);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    if (mp) {
      const layer = (proj.current ??= new ProjLayer());
      layer.source(bitmap.width, bitmap.height).getContext('2d')!.drawImage(bitmap, 0, 0);
      layer.present(cv, mp, null);
      mirrorCanvas(copyRef.current, null, false);
    } else {
      proj.current?.release();
      cv.width = bitmap.width;
      cv.height = bitmap.height;
      cv.getContext('2d')!.drawImage(bitmap, 0, 0);
      mirrorCanvas(copyRef.current, cv, true);
    }
  }, [bitmap, mp]);
  useEffect(
    () => () => {
      proj.current?.release();
    },
    [],
  );
  return (
    <>
      <canvas ref={ref} data-testid="plugin-dev-map" />
      <canvas ref={copyRef} className="wrap-copy" />
    </>
  );
}

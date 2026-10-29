/**
 * 回到地图时刚才的框:地图停在原处,框的位置画一道白色虚线,淡淡留 2 秒再淡掉(不弹提示)。
 * 再点「地区」,框还在刚才的位置(terrain3dStore 里留着)。
 */
import { useEffect, useState, type MutableRefObject } from 'react';
import type { MarkApi } from '../MarkLayer';
import { clearReliefGhost, useRelief } from '../terrain3dStore';
import { readFrame, toScreen, type Frame } from './Pick';
import './terrain3d.css';

/** 留多久(毫秒;最后 0.6 秒淡掉) */
export const GHOST_MS = 2000;

export function ReliefGhost({ api }: { api: MutableRefObject<MarkApi | null> }) {
  const ghost = useRelief().ghost;
  const [frame, setFrame] = useState<Frame | null>(null);
  // 跟着地图(拖动、缩放时框贴在地上);到时候就收起
  useEffect(() => {
    if (!ghost) return;
    let raf = 0;
    let sig = '';
    const tick = () => {
      if (performance.now() - ghost.at > GHOST_MS) return clearReliefGhost();
      raf = requestAnimationFrame(tick);
      const f = readFrame(api.current);
      if (f && f.sig !== sig) {
        sig = f.sig;
        setFrame(f);
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [ghost, api]);
  if (!ghost || !frame) return null;
  const b = ghost.box;
  const [sx, sy] = toScreen(frame, b, frame.sw / 2);
  const w = b.w * frame.k;
  const h = b.h * frame.k;
  const left = Math.max(0, GHOST_MS - (performance.now() - ghost.at));
  return <div className="rp-ghost" style={{ left: sx - w / 2, top: sy - h / 2, width: w, height: h, animationDuration: `${GHOST_MS}ms`, animationDelay: `${left - GHOST_MS}ms` }} aria-hidden="true" />;
}

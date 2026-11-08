/**
 * 插件请用的人框一片:在地图上拖一个框;有上一次的框时拖框里面挪、拖边角改大小、框外拖一下重新框。松手就把框住的地块交给插件。
 * 拖法、框的样子照「地区」(terrain3d/Pick.tsx),不压暗地图;只在平面地图上框(开始时切回平面,框的时候换成地球仪、弯边投影就不框了)。
 * 滚轮、双指照样缩放地图。
 */
import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import type { World } from '../../../gen/world';
import type { MarkApi } from '../../MarkLayer';
import { getProjection, setProjection } from '../../projectionStore';
import { kmPerUnitX } from '../../../render/terrain3d/box';
import { KM_PER_UNIT } from '../../../gen/civ/geo';
import type { ToolBox } from './toolRun';

/** 这一刻地图的换算(平面等距圆柱才有):世界 → 舞台像素、左右相连的一整圈多宽 */
interface Frame {
  ox: number;
  oy: number;
  k: number;
  period: number;
  sw: number;
  sig: string;
}

function readFrame(api: MarkApi | null): Frame | null {
  const f = api?.frame();
  if (!f || getProjection() !== 'equirect') return null;
  const a = f.pt(0, 0);
  const b = f.pt(1000, 1000);
  if (!a || !b) return null;
  return { ox: a[0], oy: a[1], k: (b[0] - a[0]) / 1000, period: f.period, sw: f.w, sig: f.sig };
}

/** 框的中心在舞台上的位置:左右相连时取离 nearX 最近的那一圈 */
function toScreen(f: Frame, b: ToolBox, nearX: number): [number, number] {
  let x = f.ox + b.cx * f.k;
  if (f.period > 0) x += f.period * Math.round((nearX - x) / f.period);
  return [x, f.oy + b.cy * f.k];
}

/** 框最小几个像素(再小当成点了一下,不算) */
const MIN_PX = 8;

type Grab = { pid: number; mode: 'move' | 'new' | 'size'; ex: number; ey: number; box: ToolBox | null; hx: number; hy: number; sx: number; sy: number; moved: boolean };

const HANDLES: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
];
const CURSOR: Record<string, string> = { '-1,-1': 'nwse-resize', '1,1': 'nwse-resize', '1,-1': 'nesw-resize', '-1,1': 'nesw-resize', '0,-1': 'ns-resize', '0,1': 'ns-resize', '-1,0': 'ew-resize', '1,0': 'ew-resize' };

/** 框上写的大小:"约 4,600 × 3,300 公里"(一千公里以上取整到百,以下取整到十) */
export function boxSize(b: ToolBox, H: number): string {
  const r = (km: number) => {
    const step = km >= 1000 ? 100 : 10;
    return (Math.max(step, Math.round(km / step) * step)).toLocaleString('en-US');
  };
  return `约 ${r(b.w * kmPerUnitX(b.cy, H))} × ${r(b.h * KM_PER_UNIT)} 公里`;
}

/** 框住的地块(东西两头连着) */
export function cellsInBox(world: World, b: ToolBox): Int32Array {
  const W = world.width;
  const { x, y, n } = world.mesh;
  const x0 = b.cx - b.w / 2;
  const y0 = b.cy - b.h / 2;
  const y1 = b.cy + b.h / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (y[i] < y0 || y[i] > y1) continue;
    const dx = (((x[i] - x0) % W) + W) % W;
    if (dx <= b.w) out.push(i);
  }
  return Int32Array.from(out);
}

function clamp(b: ToolBox, W: number, H: number): ToolBox {
  const h = Math.min(H, Math.max(0, b.h));
  const cy = Math.min(H - h / 2, Math.max(h / 2, b.cy));
  return { cx: b.cx, cy, w: Math.min(W, Math.max(0, b.w)), h };
}

/** onLost = 换成了地球仪、弯边投影(框不了了) */
export function BoxPick({ world, api, box: start, onDone, onLost }: { world: World; api: MutableRefObject<MarkApi | null>; box: ToolBox | null; onDone: (b: ToolBox) => void; onLost: () => void }) {
  const W = world.width;
  const H = world.height;
  const [frame, setFrame] = useState<Frame | null>(null);
  const [box, setBox] = useState<ToolBox | null>(start);
  const grab = useRef<Grab | null>(null);
  /** 按着的手指:第二根按下去 = 双指缩放地图,框不跟着动 */
  const touches = useRef(new Set<number>());
  const lost = useRef(onLost);
  lost.current = onLost;

  // 只在平面地图上框
  useEffect(() => {
    if (getProjection() !== 'equirect') setProjection('equirect');
  }, []);

  // 地图挪了、缩放了:跟着重画
  useEffect(() => {
    let raf = 0;
    let sig = '';
    let seen = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const f = readFrame(api.current);
      if (!f) {
        if (seen && getProjection() !== 'equirect') lost.current();
        return;
      }
      seen = true;
      if (f.sig !== sig) {
        sig = f.sig;
        setFrame(f);
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [api]);

  if (!frame) return null;
  let px: { x: number; y: number; w: number; h: number } | null = null;
  if (box) {
    const [sx, sy] = toScreen(frame, box, frame.sw / 2);
    px = { x: sx - (box.w * frame.k) / 2, y: sy - (box.h * frame.k) / 2, w: box.w * frame.k, h: box.h * frame.k };
  }

  const at = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'touch') touches.current.add(e.pointerId);
    if (touches.current.size > 1) {
      // 交给地图捏合:正在拖的这一下作废
      const g = grab.current;
      grab.current = null;
      if (g) setBox(g.box);
      return;
    }
    e.stopPropagation();
    const [x, y] = at(e);
    const t = e.target as HTMLElement;
    const h = t.dataset.h;
    const base = { pid: e.pointerId, ex: x, ey: y, box, hx: 0, hy: 0, sx: (x - frame.ox) / frame.k, sy: (y - frame.oy) / frame.k, moved: false };
    if (h && box) {
      const [hx, hy] = h.split(',').map(Number);
      grab.current = { ...base, mode: 'size', hx, hy };
    } else if (t.classList.contains('plg-box') && box) grab.current = { ...base, mode: 'move' };
    else grab.current = { ...base, mode: 'new' };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g || g.pid !== e.pointerId) return;
    e.stopPropagation();
    const [x, y] = at(e);
    if (!g.moved && Math.abs(x - g.ex) + Math.abs(y - g.ey) < 4) return;
    g.moved = true;
    const dx = (x - g.ex) / frame.k;
    const dy = (y - g.ey) / frame.k;
    const b = g.box;
    if (g.mode === 'move' && b) return setBox(clamp({ ...b, cx: b.cx + dx, cy: b.cy + dy }, W, H));
    if (g.mode === 'new' || !b) {
      const wx = (x - frame.ox) / frame.k;
      const wy = (y - frame.oy) / frame.k;
      return setBox(clamp({ cx: (g.sx + wx) / 2, cy: (g.sy + wy) / 2, w: Math.abs(wx - g.sx), h: Math.abs(wy - g.sy) }, W, H));
    }
    // 拖边角:对边不动
    let l = b.cx - b.w / 2;
    let r = b.cx + b.w / 2;
    let t = b.cy - b.h / 2;
    let bt = b.cy + b.h / 2;
    if (g.hx < 0) l = Math.min(r, l + dx);
    if (g.hx > 0) r = Math.max(l, r + dx);
    if (g.hy < 0) t = Math.min(bt, t + dy);
    if (g.hy > 0) bt = Math.max(t, bt + dy);
    setBox(clamp({ cx: (l + r) / 2, cy: (t + bt) / 2, w: r - l, h: bt - t }, W, H));
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    touches.current.delete(e.pointerId);
    const g = grab.current;
    if (!g || g.pid !== e.pointerId) return;
    e.stopPropagation();
    grab.current = null;
    // 点了一下没拖:不算(新框太小也不算)
    if (!g.moved || !box) return setBox(g.box);
    if (box.w * frame.k < MIN_PX || box.h * frame.k < MIN_PX) return setBox(g.box);
    onDone(box);
  };
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  return (
    <div className="plg-bx" data-testid="plugin-box" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onClick={stop} onDoubleClick={stop}>
      {px && (
        <>
          <div className="plg-box" style={{ left: px.x, top: px.y, width: px.w, height: px.h }} />
          {HANDLES.map(([hx, hy]) => (
            <div key={`${hx},${hy}`} className="plg-bh" data-h={`${hx},${hy}`} style={{ left: px!.x + ((hx + 1) / 2) * px!.w, top: px!.y + ((hy + 1) / 2) * px!.h, cursor: CURSOR[`${hx},${hy}`] }} />
          ))}
          <div className="plg-bsz" style={{ left: px.x + px.w / 2, top: px.y }}>
            {boxSize(box!, H)}
          </div>
        </>
      )}
    </div>
  );
}

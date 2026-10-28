/**
 * 框一块地方立起来看(地图右下 / 手机右上的「立体」点了以后):
 *   电脑:一开始框住看得见的地图正中一块;拖框里面挪、拖边角改大小,在框外拖一下 = 重新框一个;滚轮照样缩放地图。
 *         框上写着多大;底下一条:怎么做、「取消」「立起来看」
 *   手机:框固定在屏幕正中,手指只管挪、缩放地图(框不动,地图动);顶上一句提示,底下「取消」「立起来看」
 * 框每条边 300–2000 公里(render/terrain3d/box.ts);框多大跟着世界走(地图缩放、挪动时框贴在地上)。
 * 一开始就把后台线程开好、把世界送过去准备,框的工夫里准备完,立起来时直接算。
 */
import { useEffect, useRef, useState, type MutableRefObject, type PointerEvent as RPointerEvent } from 'react';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { MarkApi } from '../MarkLayer';
import { BOX_MAX_KM, boxKm, boxSizeText, clampBox, kmPerUnitX, type ReliefBox } from '../../render/terrain3d/box';
import { closeRelief, getRelief, openReliefView } from '../terrain3dStore';
import { getProjection } from '../projection';
import { freeArea } from '../flyTo';
import { reliefPrepare, reliefRelease } from './jobs';
import './terrain3d.css';

/** 这一刻地图的换算:世界 → 舞台像素(线性,平面等距圆柱)、左右相连的一整圈多宽 */
interface Frame {
  ox: number;
  oy: number;
  /** 每世界单位多少像素 */
  k: number;
  period: number;
  sw: number;
  sh: number;
  sig: string;
}

function readFrame(api: MarkApi | null): Frame | null {
  const f = api?.frame();
  if (!f || getProjection() !== 'equirect') return null;
  const a = f.pt(0, 0);
  const b = f.pt(1000, 1000);
  if (!a || !b) return null;
  return { ox: a[0], oy: a[1], k: (b[0] - a[0]) / 1000, period: f.period, sw: f.w, sh: f.h, sig: f.sig };
}

type Grab = { mode: 'move' | 'new' | 'size'; ex: number; ey: number; box: ReliefBox; sx: number; sy: number; hx: number; hy: number; x0: number; y0: number };

/** 八个拖柄:(-1, 0, 1) × (-1, 0, 1),去掉正中 */
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

export function ReliefPick({ world, raster, api, phone }: { world: World; raster: Raster; api: MutableRefObject<MarkApi | null>; phone: boolean }) {
  const W = world.width;
  const H = world.height;
  const [frame, setFrame] = useState<Frame | null>(null);
  const [box, setBox] = useState<ReliefBox | null>(null);
  const grab = useRef<Grab | null>(null);
  const seen = useRef(false);

  // 线程先开好、世界先送过去;不框了(没立起来)就关掉
  useEffect(() => {
    reliefPrepare(world, raster, phone);
  }, [world, raster, phone]);
  useEffect(
    () => () => {
      if (getRelief().phase === 'off') reliefRelease();
    },
    [],
  );

  // 地图挪了、缩放了:跟着重画(每帧看一眼换算变没变);换成别的投影 = 不框了
  useEffect(() => {
    let raf = 0;
    let sig = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const f = readFrame(api.current);
      if (!f) {
        if (seen.current && getProjection() !== 'equirect') closeRelief();
        return;
      }
      seen.current = true;
      if (f.sig !== sig) {
        sig = f.sig;
        setFrame(f);
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [api]);

  // Esc:不框了
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || getRelief().phase !== 'pick') return;
      e.stopPropagation();
      closeRelief();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // 电脑:一开始框住看得见的地图正中一块(约四成宽,三比二);上次框过的还在看得见的地方就接着用
  useEffect(() => {
    if (phone || !frame || box) return;
    const [l, t, r, b] = freeArea({ sw: frame.sw, sh: frame.sh, bw: 0, bh: 0 }, false);
    const cx = (l + r) / 2;
    const cy = (t + b) / 2;
    const wx = (cx - frame.ox) / frame.k;
    const wy = (cy - frame.oy) / frame.k;
    const last = getRelief().box;
    if (last) {
      const [sx, sy] = toScreen(frame, last, cx);
      if (sx > l && sx < r && sy > t && sy < b) return setBox(last);
    }
    const wPx = (r - l) * 0.4;
    setBox(clampBox({ cx: wx, cy: wy, w: wPx / frame.k, h: (wPx * 2) / 3 / frame.k }, H));
  }, [phone, frame, box, H]);

  // 冒烟检查、截图用:直接定一个框(世界坐标)、立起来
  useEffect(() => {
    const g = window as unknown as { __wfReliefPick?: unknown };
    g.__wfReliefPick = { set: (b: ReliefBox) => setBox(clampBox(b, H)), open: (b: ReliefBox) => openReliefView(clampBox(b, H)) };
    return () => {
      delete g.__wfReliefPick;
    };
  }, [H]);

  if (!frame) return null;

  // 手机:框固定在屏幕正中(提示和按钮中间那一段),按现在的缩放换成世界里的一块;太大、太小就按夹过的大小画
  let shown: ReliefBox | null = box;
  let px: { x: number; y: number; w: number; h: number } | null = null;
  if (phone) {
    const top = 52;
    const bottom = frame.sh - 238;
    const side = Math.max(120, Math.min(frame.sw - 67, bottom - top - 72));
    const scx = frame.sw / 2;
    const scy = (top + bottom) / 2;
    const want = clampBox({ cx: (scx - frame.ox) / frame.k, cy: (scy - frame.oy) / frame.k, w: side / frame.k, h: side / frame.k }, H);
    // 正方形:两边按公里一样长
    const km = Math.min(boxKm(want, H).w, BOX_MAX_KM);
    shown = clampBox({ cx: want.cx, cy: want.cy, w: km / kmPerUnitX(want.cy, H), h: (km * 2048) / 40000 }, H);
  }
  if (shown) {
    const [sx, sy] = toScreen(frame, shown, frame.sw / 2);
    px = { x: sx - (shown.w * frame.k) / 2, y: sy - (shown.h * frame.k) / 2, w: shown.w * frame.k, h: shown.h * frame.k };
  }

  const go = () => {
    if (shown) openReliefView(shown);
  };

  // ---- 电脑上拖框 ----
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (phone || e.button !== 0 || !box || !px) return;
    e.stopPropagation();
    const t = e.target as HTMLElement;
    const h = t.dataset.h;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const base = { ex: x, ey: y, box, sx: 0, sy: 0, hx: 0, hy: 0, x0: px.x, y0: px.y };
    if (h) {
      const [hx, hy] = h.split(',').map(Number);
      grab.current = { ...base, mode: 'size', hx, hy };
    } else if (t.classList.contains('rp-box')) grab.current = { ...base, mode: 'move' };
    else grab.current = { ...base, mode: 'new', sx: (x - frame.ox) / frame.k, sy: (y - frame.oy) / frame.k };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const g = grab.current;
    if (!g) return;
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const dx = (x - g.ex) / frame.k;
    const dy = (y - g.ey) / frame.k;
    const b = g.box;
    if (g.mode === 'move') return setBox(clampBox({ ...b, cx: b.cx + dx, cy: b.cy + dy }, H));
    if (g.mode === 'new') {
      // 重新拖一个:按下的地方是一个角(拖得太小就按最小的)
      const wx = (x - frame.ox) / frame.k;
      const wy = (y - frame.oy) / frame.k;
      if (Math.abs(x - g.ex) + Math.abs(y - g.ey) < 6) return;
      return setBox(clampBox({ cx: (g.sx + wx) / 2, cy: (g.sy + wy) / 2, w: Math.abs(wx - g.sx), h: Math.abs(wy - g.sy) }, H));
    }
    // 拖边角:对边不动
    let l = b.cx - b.w / 2;
    let r = b.cx + b.w / 2;
    let t = b.cy - b.h / 2;
    let bt = b.cy + b.h / 2;
    if (g.hx < 0) l += dx;
    if (g.hx > 0) r += dx;
    if (g.hy < 0) t += dy;
    if (g.hy > 0) bt += dy;
    const nb = clampBox({ cx: (l + r) / 2, cy: (t + bt) / 2, w: Math.max(0, r - l), h: Math.max(0, bt - t) }, H);
    // 夹过以后对边还贴着原来的位置
    if (g.hx < 0) nb.cx = b.cx + b.w / 2 - nb.w / 2;
    if (g.hx > 0) nb.cx = b.cx - b.w / 2 + nb.w / 2;
    if (g.hx === 0) nb.cx = b.cx;
    if (g.hy < 0) nb.cy = b.cy + b.h / 2 - nb.h / 2;
    if (g.hy > 0) nb.cy = b.cy - b.h / 2 + nb.h / 2;
    if (g.hy === 0) nb.cy = b.cy;
    // 贴着对边挪过中心以后再夹一次(往极地拉时不出南北纬 75°、不出两极,东西宽照新纬度重新夹)
    setBox(clampBox(nb, H));
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    if (!grab.current) return;
    e.stopPropagation();
    grab.current = null;
  };
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  return (
    <div
      className={`rp${phone ? ' phone' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={phone ? undefined : stop}
      onDoubleClick={phone ? undefined : stop}
    >
      {px && (
        <>
          <div className="rp-dim" style={{ left: 0, top: 0, right: 0, height: Math.max(0, px.y) }} />
          <div className="rp-dim" style={{ left: 0, top: px.y + px.h, right: 0, bottom: 0 }} />
          <div className="rp-dim" style={{ left: 0, top: px.y, width: Math.max(0, px.x), height: px.h }} />
          <div className="rp-dim" style={{ left: px.x + px.w, top: px.y, right: 0, height: px.h }} />
          <div className="rp-box" style={{ left: px.x, top: px.y, width: px.w, height: px.h }} />
          {phone
            ? (['tl', 'tr', 'bl', 'br'] as const).map((c) => (
                <div key={c} className={`rp-cn ${c}`} style={{ left: c[1] === 'l' ? px.x - 3 : px.x + px.w - 15, top: c[0] === 't' ? px.y - 3 : px.y + px.h - 15 }} />
              ))
            : HANDLES.map(([hx, hy]) => (
                <div key={`${hx},${hy}`} className="rp-h" data-h={`${hx},${hy}`} style={{ left: px.x + ((hx + 1) / 2) * px.w, top: px.y + ((hy + 1) / 2) * px.h, cursor: CURSOR[`${hx},${hy}`] }} />
              ))}
          {shown && (
            <div className="rp-size" style={{ left: px.x + px.w / 2, top: px.y }}>
              {boxSizeText(shown, H)}
            </div>
          )}
        </>
      )}
      {phone ? (
        <>
          <div className="rp-chip">挪地图、双指缩放，让框住想立起来看的地方</div>
          <div className="rp-act">
            <button type="button" onClick={closeRelief}>
              取消
            </button>
            <button type="button" className="pri" onClick={go} disabled={!shown}>
              立起来看
            </button>
          </div>
        </>
      ) : (
        <div className="rp-bar" onPointerDown={stop}>
          拖一个框，框住想立起来看的地方；拖框里面挪动，拖边角改大小
          <button type="button" onClick={closeRelief}>
            取消
          </button>
          <button type="button" className="pri" onClick={go} disabled={!shown}>
            立起来看
          </button>
        </div>
      )}
    </div>
  );
}

/** 方框中心在舞台上的位置:左右相连时取离 nearX 最近的那一圈 */
function toScreen(f: Frame, b: ReliefBox, nearX: number): [number, number] {
  let x = f.ox + b.cx * f.k;
  if (f.period > 0) x += f.period * Math.round((nearX - x) / f.period);
  return [x, f.oy + b.cy * f.k];
}

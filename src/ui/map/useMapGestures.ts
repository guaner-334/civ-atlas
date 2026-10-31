/**
 * 按在地图上的鼠标和手指(App 用):按下拖动平移、单指拖动、双指捏合缩放(以两指中点为中心)、手指点一下 / 点两下,
 * 改地形时按下开始画、松开结束那一笔;Safari 的捏合(gesture 事件)和按着 Ctrl 的滚轮不放大整个网页。
 * 平移缩放本身、滚轮见 ./useMapView.ts。
 *
 * 舞台上的指针事件由 App 挂(onPointerDown、onPointerUp、捕获阶段的 onTouch…Capture);鼠标移动时的悬停小卡片还在 App 的
 * onPointerMove 里,按着的时候它调这里的 dragMove。这里的函数每次渲染新建(和原来写在 App 里一样)。
 */
import { useEffect, useRef, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { wrapLon, type MapProj } from '../../render/projection';
import { getMapCenter, publishMapCenter, type MapView } from '../mapWrap';
import { setMapMoving } from '../projection';
import { getGlobeOn, type GlobeApi } from '../Globe';
import { isDoubleTap, pinchStep, type Pt, type Tap } from '../gestures';
import { createPinchGuard, setGesturePinch, wheelSample } from '../wheel';
import { dismissing } from '../dismissClick';
import { getUpUi, upCancel, upDown, upUp } from '../upheavalStore';
import { terrainCancel, terrainDown, terrainUp } from '../TerrainTools';
import type { MapDrag, MapGeo, MapPinch } from './types';

type Ref<T> = MutableRefObject<T>;

/** 按下到松开移动不超过这么多(屏幕像素,横 + 竖)算单击 */
const CLICK_SLOP = 5;
/** 手指按下时总会抖一点:移动不超过这么多还算"点一下" */
const TOUCH_SLOP = 10;

/** App 传进来的:视图状态(见 ./useMapView.ts)和要一起改的界面状态 */
export interface MapGesturesDeps {
  view: MapView;
  setView: Dispatch<SetStateAction<MapView>>;
  viewRef: Ref<MapView>;
  stageRef: RefObject<HTMLDivElement>;
  globeApi: Ref<GlobeApi | null>;
  /** 弯边投影:当前投影 + 中心(等距圆柱 = null) */
  mp: MapProj | null;
  mpRef: Ref<MapProj | null>;
  /** 地图框(缩放 1 倍时)的大小 */
  box: { w: number; h: number };
  geo: Ref<MapGeo>;
  curvedRef: Ref<boolean>;
  clampRef: Ref<(v: MapView, w: number, h: number) => MapView>;
  drag: Ref<MapDrag | null>;
  pinch: Ref<MapPinch | null>;
  /** 弯边投影里拖动改中心:这一帧排着的(见 useMapView 的 scheduleCenter) */
  centerFrame: Ref<{ raf: number; lon: number | null }>;
  scheduleCenter: (lon: number) => void;
  zoomRef: Ref<(mx: number, my: number, f: number) => void>;
  stopFly: () => void;
  resetView: () => void;
  /** 碰了地图(第一次打开的操作提示收起) */
  touchRef: Ref<() => void>;
  /** 鼠标最近在哪(视口坐标) */
  mouseAt: Ref<[number, number]>;
  setHover: (h: null) => void;
  /** 屏幕坐标 → 世界坐标(不在地图上 = null) */
  worldAt: (cx: number, cy: number) => [number, number] | null;
}

export function useMapGestures({ view, setView, viewRef, stageRef, globeApi, mp, mpRef, box, geo, curvedRef, clampRef, drag, pinch, centerFrame, scheduleCenter, zoomRef, stopFly, resetView, touchRef, mouseAt, setHover, worldAt }: MapGesturesDeps) {
  /** 这次按下以后拖动过(拖过就不算单击,不选中) */
  const moved = useRef(false);
  // ---- 手指(触屏):单指拖动平移、双指捏合缩放(以两指中点为中心)、点一下 = 单击、点两下 = 回正 ----
  /** 按在地图上的手指(id → 屏幕坐标;地球仪上的也记,双击回正用) */
  const touches = useRef(new Map<number, Pt>());
  /** 改地形正用手指画线(这时第二根手指不捏合) */
  const terrainStroke = useRef(false);
  /** 正在画的那一笔是哪根手指 / 哪个指针按下的:别的手指的移动、松开不算进这一笔 */
  const terrainPointer = useRef<number | null>(null);
  /** 这一下手指按下的位置、时刻(松手时判断是不是"点一下");中途多了一根手指就不算 */
  const tapStart = useRef<(Tap & { id: number; multi: boolean }) | null>(null);
  /** 上一下"点一下"(和这一下够近就是双击) */
  const lastTap = useRef<Tap | null>(null);
  /** 刚被手指双击过(时刻):紧跟着的 click 按双击的第二下处理(恢复原来的选中) */
  const dblTapAt = useRef(-1e9);
  /** 平移(屏幕像素);弯边投影左右 = 转中央经线 */
  const panBy = (dx: number, dy: number) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const m = mpRef.current;
    const g = geo.current;
    if (m && g.bw) {
      const v = viewRef.current;
      const pxPerDeg = v.k * (g.bw / m.W) * m.s * m.def.kx(0) * (Math.PI / 180);
      if (pxPerDeg > 0 && dx) publishMapCenter(wrapLon(getMapCenter() - dx / pxPerDeg));
      const nv = clampRef.current({ k: v.k, x: v.x, y: v.y + dy }, rect.width, rect.height);
      viewRef.current = nv;
      setView(nv);
      return;
    }
    setView((v) => clampRef.current({ k: v.k, x: v.x + dx, y: v.y + dy }, rect.width, rect.height));
  };
  const startPinch = () => {
    const [a, b] = [...touches.current.values()];
    if (!a || !b) return;
    drag.current = null;
    moved.current = true;
    setHover(null);
    // 单指拖动时排着的"转中央经线"作废(不然下一帧把捏合的结果盖掉)
    const c = centerFrame.current;
    cancelAnimationFrame(c.raf);
    c.raf = 0;
    c.lon = null;
    if (pinch.current) cancelAnimationFrame(pinch.current.raf);
    pinch.current = { a: { ...a }, b: { ...b }, raf: 0 };
    if (curvedRef.current) setMapMoving(true);
  };
  const schedulePinch = () => {
    const p = pinch.current;
    if (!p || p.raf) return;
    p.raf = requestAnimationFrame(() => {
      p.raf = 0;
      if (pinch.current !== p) return;
      const [a, b] = [...touches.current.values()];
      const el = stageRef.current;
      if (!a || !b || !el) return;
      const st = pinchStep(p.a, p.b, a, b);
      p.a = { ...a };
      p.b = { ...b };
      const r = el.getBoundingClientRect();
      // 先以上一帧的中点为中心缩放,再跟着中点平移:两指下面的地方一直在两指下面
      if (Math.abs(st.f - 1) > 1e-4) zoomRef.current(st.mx - st.dx - r.left, st.my - st.dy - r.top, st.f);
      if (st.dx || st.dy) panBy(st.dx, st.dy);
    });
  };
  /** 捏合结束:还剩一根手指就接着单指拖动 */
  const endPinch = () => {
    const p = pinch.current;
    if (!p) return;
    cancelAnimationFrame(p.raf);
    pinch.current = null;
    const [rest] = [...touches.current.values()];
    if (rest) {
      const v = viewRef.current;
      drag.current = { x: rest.x, y: rest.y, vx: v.x, vy: v.y, lon: getMapCenter(), touch: true };
      return;
    }
    drag.current = null;
    setMapMoving(false);
  };
  // 手指的登记放在捕获阶段(地球仪自己的处理会拦住冒泡):哪几根手指按着、是不是"点一下"、双击回正
  const onTouchDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.current.size === 1) tapStart.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), multi: false };
    else if (tapStart.current) tapStart.current.multi = true;
  };
  const onTouchMoveCapture = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onTouchUpCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touches.current.delete(e.pointerId);
    const ts = tapStart.current;
    if (!ts || ts.id !== e.pointerId) return;
    tapStart.current = null;
    const now = performance.now();
    const onMap = !!(e.target as HTMLElement | null)?.closest?.('.canvas-wrap, .globe');
    if (e.type !== 'pointerup' || ts.multi || !onMap || now - ts.t > 500 || Math.hypot(e.clientX - ts.x, e.clientY - ts.y) > TOUCH_SLOP) {
      lastTap.current = null;
      return;
    }
    const tap: Tap = { x: e.clientX, y: e.clientY, t: now };
    if (!isDoubleTap(lastTap.current, tap)) {
      lastTap.current = tap;
      return;
    }
    // 点两下:回正(和鼠标双击一样;浏览器自己也发了 dblclick 的话再回正一次也不要紧)
    lastTap.current = null;
    dblTapAt.current = now;
    if (getGlobeOn()) globeApi.current?.reset();
    else resetView();
  };
  const onPointerDown = (e: React.PointerEvent) => {
    touchRef.current();
    stopFly();
    if (getGlobeOn()) return; // 地球仪自己管拖动
    const touch = e.pointerType === 'touch';
    // 第二根手指:开始捏合(编辑地形刚按下第一根手指就跟上第二根 = 想捏合,那一笔不算;已经画了一阵的不管)
    if (touch && touches.current.size >= 2) {
      if (terrainStroke.current) {
        if (!(getUpUi().on ? upCancel() : terrainCancel())) return;
        terrainStroke.current = false;
        terrainPointer.current = null;
      }
      if (touches.current.size === 2) startPinch();
      return;
    }
    // 改地形:画线的工具按下就开始画(不平移);点地图收菜单的那一下不画
    if (!dismissing(e.nativeEvent) && (terrainDown(worldAt(e.clientX, e.clientY), e.button) || upDown(worldAt(e.clientX, e.clientY), e.button))) {
      moved.current = true;
      terrainStroke.current = touch;
      terrainPointer.current = e.pointerId;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return; // 只用左键
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, lon: getMapCenter(), touch };
    moved.current = false;
    if (stageRef.current) stageRef.current.style.cursor = '';
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  /** 按着拖动(App 的 onPointerMove 里按着的时候调):挪过点击的容差就算拖过(松开不算单击),地图跟着挪 */
  const dragMove = (e: React.PointerEvent, d: MapDrag, rect: DOMRect) => {
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > (d.touch ? TOUCH_SLOP : CLICK_SLOP)) moved.current = true;
    if (mp && box.w) {
      // 弯边投影:左右拖 = 转中央经线(赤道上的地方跟着鼠标走),上下拖 = 平移。
      // 移动没超过点击的容差前不转:还算"点一下"时转了中心,停着的那一版就得按投影整张重画(几百毫秒),马上又被拖动盖掉
      if (moved.current) {
        setMapMoving(true);
        // 每度几像素按最新的缩放算(viewRef:拖着的时候刚滚轮缩放过、还没重画也算上)
        const pxPerDeg = viewRef.current.k * (box.w / mp.W) * mp.s * mp.def.kx(0) * (Math.PI / 180);
        if (pxPerDeg > 0) scheduleCenter(d.lon - (e.clientX - d.x) / pxPerDeg);
      }
      setView((v) => clampRef.current({ k: v.k, x: v.x, y: d.vy + e.clientY - d.y }, rect.width, rect.height));
    } else setView((v) => clampRef.current({ k: v.k, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }, rect.width, rect.height));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (getGlobeOn()) return;
    if (pinch.current) {
      // 还有两根手指按着(第三根松开了):接着捏合;否则结束捏合,剩下的一根接着拖
      if (touches.current.size >= 2) startPinch();
      else endPinch();
      return;
    }
    // 捏合以后剩下的那根手指:别的手指松开时不结束它的拖动
    if (e.pointerType === 'touch' && drag.current?.touch && touches.current.size > 0) return;
    // 正在画的那一笔:只认按下它的那根手指松开
    if (terrainPointer.current !== null && e.pointerId !== terrainPointer.current) return;
    terrainPointer.current = null;
    terrainUp();
    upUp();
    terrainStroke.current = false;
    drag.current = null;
    setMapMoving(false);
  };
  // 浏览器自己的页面缩放不抢捏合:
  // - 手机:双指捏合(Safari 的 gesture 事件;别的浏览器靠 touch-action,见 app.css),交给上面的手指处理
  // - 电脑上 Safari 的触控板捏合也是 gesture 事件(没有手指按在屏幕上):落在地图上就缩放地图
  // - Chrome、Firefox 的触控板捏合是按着 Ctrl 的滚轮:落在侧栏、时间轴、按钮上时也拦下,不放大整个网页
  useEffect(() => {
    /** 这次触控板捏合上一回的倍数(0 = 不归地图管) */
    let pinchAt = 0;
    const onMap = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el?.closest?.('.stage') && !el.closest('.inspector');
    };
    const start = (e: Event) => {
      e.preventDefault();
      const fingers = touches.current.size > 0;
      setGesturePinch(!fingers);
      pinchAt = !fingers && onMap(e.target) ? 1 : 0;
    };
    const change = (e: Event) => {
      e.preventDefault();
      const g = e as Event & { scale?: number; clientX?: number; clientY?: number };
      if (!pinchAt || touches.current.size || !(typeof g.scale === 'number' && g.scale > 0)) return;
      const f = g.scale / pinchAt;
      pinchAt = g.scale;
      const el = stageRef.current;
      if (!el || !Number.isFinite(f)) return;
      const rect = el.getBoundingClientRect();
      const cx = g.clientX ?? mouseAt.current[0];
      const cy = g.clientY ?? mouseAt.current[1];
      touchRef.current();
      if (getGlobeOn()) globeApi.current?.zoomBy(f, cx, cy, true);
      else zoomRef.current(cx - rect.left, cy - rect.top, f);
    };
    const end = () => {
      pinchAt = 0;
      setGesturePinch(false);
    };
    const isPinch = createPinchGuard();
    const pageZoom = (e: WheelEvent) => {
      if (e.ctrlKey && isPinch(wheelSample(e))) e.preventDefault();
    };
    document.addEventListener('gesturestart', start, { passive: false });
    document.addEventListener('gesturechange', change, { passive: false });
    document.addEventListener('gestureend', end);
    window.addEventListener('wheel', pageZoom, { passive: false, capture: true });
    return () => {
      document.removeEventListener('gesturestart', start);
      document.removeEventListener('gesturechange', change);
      document.removeEventListener('gestureend', end);
      window.removeEventListener('wheel', pageZoom, { capture: true });
    };
  }, []);
  return { moved, touches, terrainPointer, dblTapAt, schedulePinch, dragMove, onTouchDownCapture, onTouchMoveCapture, onTouchUpCapture, onPointerDown, onPointerUp };
}

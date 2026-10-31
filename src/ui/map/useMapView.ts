/**
 * 地图的视图(App 用):舞台和地图框的大小、平移范围、东西相连时的中心经度、换投影时视图怎么接,
 * 以及滚轮 / 触控板、右下角的 + −、双击复位、点合并的圆放大这些缩放和平移。
 * 飞到某处见 ./useMapFly.ts,拖动、手指、捏合见 ./useMapGestures.ts。
 *
 * 视图状态 view 还在 App 里(画地形图那一段要读),由 App 传进来;这里的函数每次渲染新建(和原来写在 App 里一样),
 * 事件监听和动画经 xxxRef.current 调到最新的那一份。截图脚本、冒烟检查用的 window.__wf… 也在这里挂上。
 */
import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import { nearX, wrapOf } from '../../render/common';
import { projectWorld, unprojectRel, unprojectWorld, wrapLon, type MapProj } from '../../render/projection';
import { NAME_ZOOM } from '../../render/marks';
import {
  centerX,
  clampCurved,
  clampSphere,
  getMapCenter,
  handleMapCenterRequests,
  lonOfX,
  publishMapCenter,
  requestMapCenter,
  stageToWorld,
  viewCentredAt,
  worldToStage,
  xOfLon,
  type MapView,
  type StageBox,
} from '../mapWrap';
import { getProjection, setMapMoving, setProjection, type MapProjection } from '../projection';
import { animProgress, easeOutCubic, phoneFree, sideRoom } from '../flyTo';
import { astRoom } from '../astPanel';
import { getGlobeOn, type GlobeApi } from '../Globe';
import { directorHandBack } from '../directorStore';
import { createWheelReader, inGesturePinch, wheelSample } from '../wheel';
import { setFilmViewport } from '../filmSource';
import type { PatchView } from '../terrainPatch';
import type { WorldToClient } from '../EventPins';
import type { MapDrag, MapGeo, MapPinch } from './types';

type Ref<T> = MutableRefObject<T>;

/** App 传进来的:视图状态、地图上现在这张图,和要一起改的界面状态 */
export interface MapViewDeps {
  view: MapView;
  setView: Dispatch<SetStateAction<MapView>>;
  stageRef: RefObject<HTMLDivElement>;
  data: { world: World; raster: Raster } | null;
  dataRef: Ref<{ world: World; raster: Raster } | null>;
  narrow: boolean;
  /** 详情面板开着(窄屏底部的卡片是半高的) */
  panelOpen: boolean;
  projection: MapProjection;
  /** 弯边投影(不是等距圆柱) */
  curved: boolean;
  /** 网址里读到的(这里只用带的中央经线 lon,没有 = null) */
  init: { lon: number | null };
  globeApi: Ref<GlobeApi | null>;
  /** 弯边投影:当前投影 + 中心(等距圆柱 = null) */
  mp: MapProj | null;
  mpRef: Ref<MapProj | null>;
  drawView: Ref<PatchView>;
  worldToClient: Ref<WorldToClient | null>;
  /** 某一点的完整读数(冒烟检查读) */
  probeRef: Ref<(cx: number, cy: number) => string[] | null>;
  /** 悬停小卡片(开着时触控板平移先收起) */
  hover: object | null;
  setHover: (h: null) => void;
  /** 碰了地图(第一次打开的操作提示收起) */
  touchRef: Ref<() => void>;
}

export function useMapView({ view, setView, stageRef, data, dataRef, narrow, panelOpen, projection, curved, init, globeApi, mp, mpRef, drawView, worldToClient, probeRef, hover, setHover, touchRef }: MapViewDeps) {
  const viewRef = useRef(view);
  // 只在视图状态真的变了时跟上:滚轮缩放先改 viewRef 再 setView,改中心(store)触发的那次重画可能还没带上这次 setView,
  // 拿旧的视图盖回去的话,下一下滚轮就从旧的倍数算起(丢一下)
  const seenView = useRef(view);
  if (seenView.current !== view) {
    seenView.current = view;
    viewRef.current = view;
  }
  // ---- 地图铺满全屏:2:1 的地图框按舞台"盖满"(舞台比 2:1 窄时上下正好顶到边、左右接着转;比 2:1 宽时左右顶到边) ----
  const [box, setBox] = useState({ w: 0, h: 0 });
  /** 舞台(视口)的大小:视窗、平移范围按它算 */
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const W = e.contentRect.width;
      const H = e.contentRect.height;
      const w = Math.max(100, W, H * 2);
      setBox({ w, h: w / 2 });
      setStageSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ---- 缩放 / 平移(视图 view 由 App 传进来,在它画地形图那一段声明)----
  /** 按下时的位置、视图(弯边投影:还有当时的中央经线;拖动改的是它) */
  const drag = useRef<MapDrag | null>(null);
  /** 双指捏合:上一次用到的两指位置;手指移动先记下,下一帧一起缩放 / 平移(一帧最多一次) */
  const pinch = useRef<MapPinch | null>(null);
  // 世界东西相连:左右无限拖动(见 mapWrap.ts)。wrapW = 一整圈的世界宽度,还没有世界时 0
  const wrapW = data ? wrapOf(data.world) : 0;
  /**
   * 窄屏底部被卡片和时间轴胶囊盖住的那一截:没选东西时是收起的世界卡片 + 胶囊,详情卡片开着时是半高的卡片 + 胶囊。
   * 地图可以往上推进这一截(见 mapWrap.ts 的 StageBox.padB),下半截的国家也能飞到上方看得见的地方;卡片收回去后慢慢回到原来的范围
   */
  const padB = !narrow || !stageSize.h ? 0 : Math.max(0, stageSize.h - phoneFree(stageSize.h, panelOpen)[1]);
  const geo = useRef<MapGeo>({ wrap: 0, bw: 0, bh: 0, W: 1, H: 1, padB: 0 });
  geo.current = { wrap: wrapW, bw: box.w, bh: box.h, W: data?.world.width ?? 1, H: data?.world.height ?? 1, padB };
  const curvedRef = useRef(curved);
  curvedRef.current = curved;
  /**
   * 平移范围:上下夹在两极以内;等距圆柱左右不限(挪整数圈),
   * 弯边投影横向正对外框(左右拖动改中央经线,见 mapWrap.ts 的 clampCurved)
   */
  const clampAny = (v: { k: number; x: number; y: number }, w: number, h: number) => {
    const g = geo.current;
    if (!g.bw) return v;
    const b = { sw: w, sh: h, bw: g.bw, bh: g.bh, padB: g.padB };
    return curvedRef.current ? clampCurved(v, b) : clampSphere(v, b);
  };
  const clampRef = useRef(clampAny);
  clampRef.current = clampAny;
  const sb: StageBox = { sw: stageSize.w, sh: stageSize.h, bw: box.w, bh: box.h, padB };
  /** 视窗中心的世界 x(舞台、地图框大小变了按它保持中心不动) */
  const centerRef = useRef<number | null>(null);
  /** 网址里带的中央经线:世界、舞台都出来以后把等距圆柱的视图转过去(只一次) */
  const pendingLon = useRef<number | null>(init.lon);
  // 换投影:缩放复位,中心不变(等距圆柱把视图转到这条经线;弯边投影横向正对外框)。
  // 在渲染时就换好视图,不会有一帧"新投影 + 旧视图"把中心记错
  const [viewProj, setViewProj] = useState<MapProjection>(projection);
  /** 从地球仪切出来时它正对着的经度:这一次提交后记进中心(渲染时只读、不改 store) */
  const handoffLon = useRef<number | null>(null);
  if (viewProj !== projection) {
    const fromGlobe = viewProj === 'globe' ? globeApi.current?.centerLon() : undefined;
    const lonNow = fromGlobe !== undefined ? wrapLon(fromGlobe) : getMapCenter();
    if (fromGlobe !== undefined) handoffLon.current = lonNow;
    setViewProj(projection);
    const base = { k: 1, x: 0, y: 0 };
    if (sb.sw && sb.bw) setView(curved || !wrapW ? clampCurved(base, sb) : viewCentredAt(base, sb, wrapW, xOfLon(lonNow, wrapW)));
    else setView(base);
  }
  useLayoutEffect(() => {
    if (handoffLon.current === null) return;
    publishMapCenter(handoffLon.current);
    handoffLon.current = null;
  });
  /** 这一次提交里视图刚被换掉(还是旧的):先不按它记中心,等下一次 */
  const settling = useRef(false);
  // 世界出来了、或者舞台大小变了,重新夹一下(保持中心经线不动)
  useEffect(() => {
    if (!sb.sw || !sb.bw || !wrapW) return;
    if (curvedRef.current) {
      pendingLon.current = null;
      setView((v) => clampCurved(v, sb));
      return;
    }
    let c = centerRef.current;
    if (pendingLon.current !== null) {
      c = xOfLon(pendingLon.current, wrapW);
      pendingLon.current = null;
      settling.current = true;
    }
    setView((v) => (c === null ? clampSphere(v, sb) : viewCentredAt(v, sb, wrapW, c)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wrapW, sb.sw, sb.sh, sb.bw, sb.bh]);
  // 窄屏详情卡片关上(地图不能再往上推进卡片那一截了):推上去的地图约 0.3 秒回到范围里
  const lastPadB = useRef(padB);
  useEffect(() => {
    const was = lastPadB.current;
    lastPadB.current = padB;
    if (padB >= was || !sb.sw || !sb.bw || flyRaf.current) return;
    const v0 = viewRef.current;
    const clamp = (v: { k: number; x: number; y: number }) => (curvedRef.current ? clampCurved(v, sb) : clampSphere(v, sb));
    const y1 = clamp(v0).y;
    if (Math.abs(y1 - v0.y) < 0.5) return;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = animProgress(now, t0, 300);
      // 用户按下地图 / 又飞走了:让给它们
      if (flyRaf.current || drag.current) return;
      const v = { k: v0.k, x: v0.x, y: v0.y + (y1 - v0.y) * easeOutCubic(t) };
      viewRef.current = v;
      setView(t < 1 ? v : clamp(v));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padB]);
  // 当前中心经度:等距圆柱时视图一变就记下(之后的"中央经线"设置、导出读它);
  // 弯边投影和地球仪时中心就在 store 里,由它们自己改,不从平面视图推
  useEffect(() => {
    const ready = !!wrapW && !!sb.sw && !!sb.bw;
    if (projection !== 'equirect') {
      const lon = getMapCenter();
      centerRef.current = ready ? xOfLon(lon, wrapW) : null;
      (window as unknown as { __wfView: unknown }).__wfView = { ...view, wrap: wrapW, lon, bw: sb.bw, sw: sb.sw, proj: projection };
      return;
    }
    // 网址里带的中心还没转过去(世界还没出来),或者视图刚被换掉:先别把旧视图的中心记下
    if (pendingLon.current !== null) return;
    if (settling.current) {
      settling.current = false;
      return;
    }
    const cx = ready ? centerX(view, sb, wrapW) : null;
    centerRef.current = cx;
    const lon = cx === null ? getMapCenter() : lonOfX(cx, wrapW);
    publishMapCenter(lon);
    (window as unknown as { __wfView: unknown }).__wfView = { ...view, wrap: wrapW, lon, bw: sb.bw, sw: sb.sw, proj: projection };
  });
  useEffect(() => {
    handleMapCenterRequests((lon) => {
      stopFly(); // "设为中心"等:正在飞的停下,别再盖掉它
      if (getGlobeOn()) return globeApi.current?.flyTo(lon);
      const g = geo.current;
      const el = stageRef.current;
      // 弯边投影:中心就是中央经线,直接改(整图按它重投影)
      if (getProjection() !== 'equirect') {
        publishMapCenter(wrapLon(lon));
        return;
      }
      if (!g.wrap || !el || !g.bw) {
        publishMapCenter(wrapLon(lon));
        pendingLon.current = wrapLon(lon);
        return;
      }
      const b = { sw: el.clientWidth, sh: el.clientHeight, bw: g.bw, bh: g.bh };
      setView((v) => viewCentredAt(v, b, g.wrap, xOfLon(lon, g.wrap)));
    });
    // 截图脚本、冒烟检查用:转到某经度;世界坐标 ↔ 屏幕坐标(取视窗里的那一份;弯边投影按投影)
    const w = window as unknown as Record<string, unknown>;
    w.__wfSetCenter = (lon: number) => requestMapCenter(lon);
    // 冒烟检查用:把视图放回某个样子(点选会让地图飞走;要在同一个视图下接着点时先放回来)
    w.__wfSetView = (v: { k: number; x: number; y: number }) => {
      stopFly();
      viewRef.current = v;
      setView(v);
    };
    w.__wfSetProjection = (p: MapProjection) => setProjection(p);
    // 编辑地形的检查脚本用:地图上现在这张(世界、主图)和投影,拿去从头整张重画、和画面逐像素比
    w.__wfMapData = () => ({ data: dataRef.current, mp: mpRef.current, style: drawView.current.style, look: drawView.current.look });
    w.__wfWorldToClient = worldToClient.current = (wx: number, wy: number): [number, number] | null => {
      const el = stageRef.current;
      const g = geo.current;
      if (!el || !g.bw) return null;
      const r = el.getBoundingClientRect();
      const b = { sw: r.width, sh: r.height, bw: g.bw, bh: g.bh };
      const v = viewRef.current;
      const m = mpRef.current;
      let x = wx;
      let y = wy;
      if (m) [x, y] = projectWorld(m, wx, wy);
      else if (g.wrap) x = nearX(wx, stageToWorld(r.width / 2, 0, v, b, g.W, g.H)[0], g.wrap);
      const [X, Y] = worldToStage(x, y, v, b, g.W, g.H);
      return [r.left + X, r.top + Y];
    };
    // 某一点的完整读数(群落、海拔、国家、最近城市……;悬停卡片只露一两行,冒烟检查读这个)
    w.__wfProbe = (cx: number, cy: number): string[] | null => probeRef.current(cx, cy);
    w.__wfClientToWorld = (cx: number, cy: number): [number, number] | null => {
      const el = stageRef.current;
      const g = geo.current;
      if (!el || !g.bw) return null;
      const r = el.getBoundingClientRect();
      const b = { sw: r.width, sh: r.height, bw: g.bw, bh: g.bh };
      const [x, y] = stageToWorld(cx - r.left, cy - r.top, viewRef.current, b, g.W, g.H);
      const m = mpRef.current;
      if (m) return unprojectWorld(m, x, y);
      return [x - g.W * Math.floor(x / g.W), y];
    };
    // 导出回放视频(框里一块):屏幕上的框 → 地图平面上的范围
    setFilmViewport(() => {
      const el = stageRef.current;
      const g = geo.current;
      if (!el || !g.bw) return null;
      const r = el.getBoundingClientRect();
      const b = { sw: r.width, sh: r.height, bw: g.bw, bh: g.bh };
      const v = viewRef.current;
      const m = mpRef.current;
      return {
        k: v.k,
        mapCss: g.bw,
        mp: m,
        worldW: g.W,
        plane: (cx: number, cy: number) => stageToWorld(cx - r.left, cy - r.top, v, b, g.W, g.H),
        key: `${v.k.toFixed(4)},${Math.round(v.x)},${Math.round(v.y)},${m?.key ?? ''},${g.bw},${r.width}x${r.height}`,
      };
    });
    return () => {
      handleMapCenterRequests(null);
      setFilmViewport(null);
    };
  }, []);
  // 弯边投影里拖动改中心:一帧最多改一次(每次改都要整图重铺)
  const centerFrame = useRef<{ raf: number; lon: number | null }>({ raf: 0, lon: null });
  const scheduleCenter = (lon: number) => {
    const c = centerFrame.current;
    c.lon = lon;
    if (c.raf) return;
    c.raf = requestAnimationFrame(() => {
      c.raf = 0;
      if (c.lon !== null) publishMapCenter(wrapLon(c.lon));
      c.lon = null;
    });
  };
  useEffect(() => () => cancelAnimationFrame(centerFrame.current.raf), []);
  /** 选中后地图正在飞过去(见 ./useMapFly.ts);用户自己拖动、缩放就停下 */
  const flyRaf = useRef(0);
  const stopFly = () => {
    if (!flyRaf.current) return;
    cancelAnimationFrame(flyRaf.current);
    flyRaf.current = 0;
    if (curvedRef.current) setMapMoving(false);
  };
  /**
   * 以舞台上的 (mx, my) 为中心缩放 f 倍(滚轮、右下角的 + −)。
   * 弯边投影:上下照常以这一点为中心缩放;横向转中央经线,让这一点下的地方还在这一点下
   */
  const zoomAt = (mx: number, my: number, f: number) => {
    stopFly();
    directorHandBack();
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const m = mpRef.current;
    const g = geo.current;
    if (m && g.bw) {
      // 缩放中心也在转:和拖动一样算"正在动"(整图先按投影重铺、细节层跟着挪),停一小会儿再按投影精画一次
      setMapMoving(true);
      clearTimeout(panIdle.current);
      panIdle.current = window.setTimeout(() => !drag.current && !pinch.current && setMapMoving(false), 150);
      const v = viewRef.current;
      const k = Math.min(12, Math.max(1, v.k * f));
      const b = { sw: rect.width, sh: rect.height, bw: g.bw, bh: g.bh, padB: g.padB };
      const nv = clampCurved({ k, x: v.x, y: my - (my - v.y) * (k / v.k) }, b);
      const [px, py] = stageToWorld(mx, my, v, b, g.W, g.H);
      const r = unprojectRel(m, px, py);
      if (r) {
        const kx = m.def.kx(r[1]);
        const [px2] = stageToWorld(mx, my, nv, b, g.W, g.H);
        if (kx > 1e-6) {
          const rel2 = Math.max(-Math.PI, Math.min(Math.PI, (px2 - g.W / 2) / (m.s * kx)));
          publishMapCenter(wrapLon(m.lon0 + ((r[0] - rel2) * 180) / Math.PI));
        }
      }
      viewRef.current = nv;
      setView(nv);
      return;
    }
    setView((v) => {
      const k = Math.min(12, Math.max(1, v.k * f));
      const q = k / v.k;
      const nx = mx - (mx - v.x) * q;
      const ny = my - (my - v.y) * q;
      return clampRef.current({ k, x: nx, y: ny }, rect.width, rect.height);
    });
  };
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  /**
   * 触控板两指滑动:平移(dx / dy = 滚轮的读数,地图往 −dx、−dy 挪,方向和滑动网页一样)。
   * 弯边投影:左右 = 转中央经线(和拖动一样),上下 = 平移;滑完停一小会儿算停下(国名按投影后的国土重新摆)
   */
  const panIdle = useRef(0);
  useEffect(() => () => clearTimeout(panIdle.current), []);
  const wheelPan = (dx: number, dy: number) => {
    stopFly();
    directorHandBack();
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (hover) setHover(null);
    if (mp && box.w) {
      setMapMoving(true);
      clearTimeout(panIdle.current);
      panIdle.current = window.setTimeout(() => !drag.current && setMapMoving(false), 150);
      // 每度几像素按最新的缩放算(viewRef:这一帧里刚滚轮缩放过、还没重画也算上,和 zoomAt 一样)
      const pxPerDeg = viewRef.current.k * (box.w / mp.W) * mp.s * mp.def.kx(0) * (Math.PI / 180);
      if (pxPerDeg > 0 && dx) scheduleCenter((centerFrame.current.lon ?? getMapCenter()) + dx / pxPerDeg);
      if (dy) setView((v) => clampRef.current({ k: v.k, x: v.x, y: v.y - dy }, rect.width, rect.height));
      return;
    }
    setView((v) => clampRef.current({ k: v.k, x: v.x - dx, y: v.y - dy }, rect.width, rect.height));
  };
  const panRef = useRef(wheelPan);
  panRef.current = wheelPan;
  // 滚轮:鼠标滚轮 / 捏合 = 缩放,触控板两指滑动 = 平移(怎么分见 wheel.ts)
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const read = createWheelReader();
    const onWheel = (e: WheelEvent) => {
      touchRef.current();
      // 详情面板里滚动 = 滚面板,不缩放地图;地球仪自己管缩放
      if ((e.target as HTMLElement | null)?.closest?.('.inspector') || getGlobeOn()) return;
      e.preventDefault();
      // Safari 的捏合已经按 gesture 事件缩放了(见 ./useMapGestures.ts 里"浏览器自己的页面缩放")
      if (e.ctrlKey && inGesturePinch()) return;
      const a = read(wheelSample(e));
      if (!a) return;
      const rect = el.getBoundingClientRect();
      if (a.kind === 'zoom') zoomRef.current(e.clientX - rect.left, e.clientY - rect.top, a.f);
      else panRef.current(a.dx, a.dy);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  /** 右下角的 + −:以看得见的地图中间为中心(宽屏让出左边的侧栏卡片);地球仪里交给地球仪自己缩放 */
  const zoomButton = (f: number) => {
    touchRef.current();
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = (sideRoom(rect.width) + rect.width - astRoom(rect.width)) / 2;
    const cy = rect.height / 2;
    directorHandBack();
    if (getGlobeOn()) return globeApi.current?.zoomBy(f, rect.left + cx, rect.top + cy);
    zoomAt(cx, cy, f);
  };
  /** 双击:缩放复位(中央经线不变 —— 它是这个世界的设置,拖远了、放大了双击回到整张图) */
  const resetView = () => {
    // 双击的第一下单击选中了国家、地图正飞过去:停下,不然飞完又盖掉复位
    stopFly();
    const el = stageRef.current;
    if (!el || !box.w) return setView({ k: 1, x: 0, y: 0 });
    const b = { sw: el.clientWidth, sh: el.clientHeight, bw: box.w, bh: box.h };
    const base = { k: 1, x: 0, y: 0 };
    setView(curved || !wrapW ? clampCurved(base, b) : viewCentredAt(base, b, wrapW, xOfLon(getMapCenter(), wrapW)));
  };
  /** 点到合并的圆:以它为中心放大到写名字的程度(至少 1.6 倍) */
  const zoomToCluster = (cx: number, cy: number) => {
    const el = stageRef.current;
    if (!el) return;
    const k = getGlobeOn() ? (globeApi.current?.viewSig()?.k ?? 1) : viewRef.current.k;
    const f = Math.max(1.6, (NAME_ZOOM * 1.05) / k);
    if (getGlobeOn()) return globeApi.current?.zoomBy(f, cx, cy);
    const r = el.getBoundingClientRect();
    zoomAt(cx - r.left, cy - r.top, f);
  };
  return {
    box,
    stageSize,
    drag,
    pinch,
    wrapW,
    padB,
    geo,
    curvedRef,
    clampRef,
    sb,
    viewRef,
    centerFrame,
    scheduleCenter,
    flyRaf,
    stopFly,
    zoomAt,
    zoomRef,
    zoomButton,
    resetView,
    zoomToCluster,
  };
}

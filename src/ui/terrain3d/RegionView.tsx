/**
 * 地区模式的平面图(地区图):框好的一块画成"地图集的一页"(标题、经纬度、比例尺、指北、图例、位置小图),摆在地图那一块的位置上;
 * 屏幕上看的就是导出的那一页(同一张画布,2 倍清晰度)。
 *   电脑:和立体一样占住地图那一块,中性灰底上一页纸(默认按 0.75 倍摆、放得下为止);滚轮放大(以鼠标处为中心)、拖动挪;
 *         时间轴的位置换成一条:回到地图、标题(点了能改名)/ 多大、平面图 | 立体、怎么操作(算细节时写进度);
 *         右下「地区」(按下的,点了回到地图)、放大缩小
 *   手机:占满整屏;一页按屏幕宽摆(先看全貌),双指放大、点两下放大 / 缩回;左上回到地图,中间标题,底下卡片里平面图 | 立体
 * 先出粗的(后台线程不到一秒),细的算好了换上;画风、填色换了重画(年份按进来时的,时间轴不在)。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { Civ } from '../../gen/civ/types';
import type { LayerId } from '../../render/layers';
import type { SurfaceLook } from '../../render/surface';
import type { CivStyle } from '../../render/civ/overlay';
import { boxSizeText } from '../../render/terrain3d/box';
import { regionPage } from '../../render/regionMap';
import { yearFull } from '../../gen/era';
import { closeRelief, getRelief, useRelief } from '../terrain3dStore';
import { useCivShow } from '../civView';
import { useEdits } from '../editsStore';
import { currentWorld } from '../saveStore';
import { freeArea } from '../flyTo';
import { showToast } from '../toastStore';
import { pinchStep, isDoubleTap, type Pt, type Tap } from '../gestures';
import { LOOK_NAMES } from '../mapLayers';
import { Icon } from '../icons';
import { reliefTitle } from './region';
import { buildRegionMap, drawRegionSheet, regionStyle, type RegionInput, type RegionMap } from './regionMap';
import { AreaTitle, FaceSwitch } from './AreaBar';
import './terrain3d.css';

interface Props {
  world: World;
  raster: Raster;
  civ: Civ | null;
  style: CivStyle;
  look: SurfaceLook;
  layer: LayerId;
  phone: boolean;
}

/** 屏幕上一页最大按几倍摆(电脑;页面 CSS 像素 → 屏幕像素)、最多放大到几倍 */
const DESK_SCALE = 0.75;
const MAX_SCALE = 2.5;

/** 画好的那一页留着(切到立体再切回来、改标题不重画);离开地区模式就放掉 */
let kept: { key: string; map: RegionMap } | null = null;
export function dropRegionCache(): void {
  if (kept) kept.map.map.width = kept.map.map.height = 0;
  kept = null;
}
/** 换下来的那一页:地图那一层放掉(地形那一层新的一页可能接着用,不动) */
function replaceKept(next: { key: string; map: RegionMap }): void {
  if (kept && kept.map !== next.map) kept.map.map.width = kept.map.map.height = 0;
  kept = next;
}

/** 调试 / 冒烟检查用:这一页画到哪一档、各步多少毫秒 */
export function regionDebug(): Record<string, unknown> {
  const g = window as unknown as { __wfRegion?: Record<string, unknown> };
  return (g.__wfRegion ??= {});
}

/** 地区图的画风名(手机卡片上写):写实照卫星 / 地理图的名字,手绘,数据底图按卫星画 */
function styleName(style: CivStyle, look: SurfaceLook): string {
  if (style === 'fantasy') return '手绘';
  if (style === 'realistic') return LOOK_NAMES[look];
  return LOOK_NAMES.detail;
}

export function RegionView({ world, raster, civ, style, look, layer, phone }: Props) {
  const ui = useRelief();
  const box = ui.box!;
  const H = world.height;
  const show = useCivShow();
  const edits = useEdits();
  const page = useMemo(() => regionPage(box, H), [box, H]);
  const autoTitle = useMemo(() => reliefTitle(box, civ, raster, world.width), [box, civ, raster, world.width]);
  const title = ui.title ?? autoTitle;
  const endYear = civ ? Math.floor(civ.endYear) : 0;
  const year = Math.max(0, Math.min(endYear, Math.floor(ui.year ?? endYear)));
  const seed = world.params.seed;
  const worldLine = `${currentWorld()?.title || '未命名世界'}(种子 ${seed})`;
  const yearText = yearFull(year, edits.era);
  const rstyle = regionStyle(style);
  // 只看会改变画面的那几样(换数据图层、别的画风细节不重画)
  const showKey = JSON.stringify(show);
  const lookKey = rstyle === 'realistic' && style === 'realistic' ? look : '';
  const key = `${box.cx},${box.cy},${box.w},${box.h}|${rstyle}|${lookKey}|${layer}|${year}|${showKey}`;

  const root = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLCanvasElement>(null);
  const [map, setMap] = useState<RegionMap | null>(() => (kept && kept.key === key && civ ? kept.map : null));
  /** 细的那一档算到几成(null = 没在算) */
  const [busy, setBusy] = useState<number | null>(null);
  const [tip, setTip] = useState(true);

  // 画这一页的地图:先粗后细;画风、填色、框换了重画
  useEffect(() => {
    if (!civ) return;
    if (kept && kept.key === key) {
      setMap(kept.map);
      setBusy(null);
      return;
    }
    let alive = true;
    const dbg = regionDebug();
    Object.assign(dbg, { level: 'none', drawn: undefined, ms: undefined, peaks: undefined, title: undefined });
    const t0 = getRelief().at || performance.now();
    const inp: RegionInput = { world, raster, civ, style, look, layer, show, year, box, D: 2, phone };
    setBusy(0);
    buildRegionMap(inp, {
      reuse: kept?.map,
      alive: () => alive,
      progress: (f) => alive && setBusy(f),
      onMap: (m) => {
        if (!alive) return;
        setMap(m);
        Object.assign(dbg, { level: m.fine ? 'fine' : 'coarse', [m.fine ? 'fineMs' : 'coarseMs']: Math.round(performance.now() - t0), ms: m.ms, peaks: m.peaks.length, marks: m.marks, lines: m.lines.map((l) => l.name) });
      },
    }).then(
      (m) => {
        if (!alive) return;
        setBusy(null);
        if (m) replaceKept({ key, map: m });
        else showToast({ id: 'region', kind: 'warn', text: '地区图没画出来', more: ['回到地图再框一次试试'] });
      },
      () => {
        if (!alive) return;
        setBusy(null);
        showToast({ id: 'region', kind: 'warn', text: '地区图没画出来', more: ['回到地图再框一次试试'] });
      },
    );
    return () => {
      alive = false;
    };
    // key 里已经有框、画风、填色、年份;世界换了也重来
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, world, raster, civ, phone]);

  // 地图或标题换了:重画四周(地图不重画)
  useEffect(() => {
    const cv = sheet.current;
    if (!map || !cv) return;
    let alive = true;
    void drawRegionSheet(map, { title, year: yearText, world: worldLine }, 'page', cv, () => alive).then((out) => {
      if (out) Object.assign(regionDebug(), { title, drawn: map.fine ? 'fine' : 'coarse' });
    });
    return () => {
      alive = false;
    };
  }, [map, title, yearText, worldLine]);

  // ---- 摆放:一页在看得见的那一块里的位置、大小(s = 屏幕像素 / 页面 CSS 像素) ----
  const vw = useRef<{ s: number; x: number; y: number } | null>(null);
  const area = useCallback((): [number, number, number, number] => {
    const r = root.current?.getBoundingClientRect();
    const sw = r?.width ?? window.innerWidth;
    const sh = r?.height ?? window.innerHeight;
    if (phone) {
      const sheetH = root.current?.querySelector('.rv-sheet')?.getBoundingClientRect().height ?? 130;
      return [12, 64, sw - 12, sh - sheetH - 46];
    }
    // 让开左边的卡片、右边那一列按钮、上面一排、底下的控件条
    const [l, , rr] = freeArea({ sw, sh, bw: 0, bh: 0 }, false);
    return [l + 16, 70, rr - 100, sh - 94];
  }, [phone]);
  const fitScale = useCallback(() => {
    const [l, t, r, b] = area();
    const fit = Math.min((r - l) / page.w, (b - t) / page.h);
    return phone ? (r - l) / page.w : Math.min(DESK_SCALE, fit);
  }, [area, page, phone]);
  /** 挪到看得见的那一块里:比它小的那一边居中,比它大的那一边不留空 */
  const clampView = useCallback(
    (v: { s: number; x: number; y: number }) => {
      const [l, t, r, b] = area();
      const w = page.w * v.s;
      const h = page.h * v.s;
      const x = w <= r - l ? (l + r - w) / 2 : Math.min(l, Math.max(r - w, v.x));
      const y = h <= b - t ? (t + b - h) / 2 : Math.min(t, Math.max(b - h, v.y));
      return { s: v.s, x, y };
    },
    [area, page],
  );
  const apply = useCallback(() => {
    const cv = sheet.current;
    const v = vw.current;
    if (!cv || !v) return;
    cv.style.width = `${page.w * v.s}px`;
    cv.style.height = `${page.h * v.s}px`;
    cv.style.transform = `translate(${v.x}px, ${v.y}px)`;
    const ph = root.current?.querySelector<HTMLElement>('.rgm-wait');
    if (ph) Object.assign(ph.style, { width: `${page.w * v.s}px`, height: `${page.h * v.s}px`, transform: `translate(${v.x}px, ${v.y}px)` });
  }, [page]);
  const fit = useCallback(() => {
    const v = clampView({ s: fitScale(), x: 0, y: 0 });
    vw.current = v;
    apply();
    // 手机上的手势提示贴在这一页底下
    const tipEl = root.current?.querySelector<HTMLElement>('.rgm-tip');
    if (tipEl) tipEl.style.top = `${Math.round(v.y + page.h * v.s + 16)}px`;
  }, [clampView, fitScale, apply, page]);
  /** 以屏幕上 (cx, cy) 为中心放大 f 倍 */
  const zoomAt = useCallback(
    (f: number, cx: number, cy: number) => {
      const v = vw.current;
      if (!v) return;
      const min = fitScale() * 0.6;
      const s = Math.min(MAX_SCALE, Math.max(min, v.s * f));
      const k = s / v.s;
      vw.current = clampView({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
      apply();
    },
    [fitScale, clampView, apply],
  );
  // 一开始、框换了、窗口大小变了:按看得见的那一块重新摆
  useEffect(() => {
    fit();
    const ro = new ResizeObserver(() => fit());
    if (root.current) ro.observe(root.current);
    return () => ro.disconnect();
  }, [fit]);
  useEffect(() => {
    apply();
  }, [map, apply]);

  // 滚轮放大(以鼠标处为中心;触控板双指捏合时 ctrlKey,步子大一些)
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      zoomAt(Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // ---- 拖动挪、双指放大、点两下放大 / 缩回 ----
  const pts = useRef(new Map<number, Pt>());
  const lastTap = useRef<Tap | null>(null);
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, input, .rv-bar, .rv-top, .rv-sheet, .map-controls')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    pts.current.set(e.pointerId, { x: e.clientX - r.left, y: e.clientY - r.top });
    setTip(false);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const p0 = pts.current.get(e.pointerId);
    const v = vw.current;
    if (!p0 || !v) return;
    const r = e.currentTarget.getBoundingClientRect();
    const p1 = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (pts.current.size >= 2) {
      const [ida, idb] = [...pts.current.keys()];
      const other = pts.current.get(e.pointerId === ida ? idb : ida)!;
      const st = e.pointerId === ida ? pinchStep(p0, other, p1, other) : pinchStep(other, p0, other, p1);
      vw.current = { ...v, x: v.x + st.dx, y: v.y + st.dy };
      pts.current.set(e.pointerId, p1);
      zoomAt(st.f, st.mx, st.my);
      return;
    }
    vw.current = clampView({ s: v.s, x: v.x + p1.x - p0.x, y: v.y + p1.y - p0.y });
    pts.current.set(e.pointerId, p1);
    apply();
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    const p = pts.current.get(e.pointerId);
    pts.current.delete(e.pointerId);
    if (!p || e.pointerType !== 'touch' || pts.current.size) return;
    const tap = { x: p.x, y: p.y, t: performance.now() };
    if (isDoubleTap(lastTap.current, tap)) {
      lastTap.current = null;
      toggleZoom(tap.x, tap.y);
    } else lastTap.current = tap;
  };
  /** 点两下:没放大就放大到看得清字(手机约 3 倍、电脑原大),放大了就缩回全貌 */
  const toggleZoom = (cx: number, cy: number) => {
    const v = vw.current;
    if (!v) return;
    const f0 = fitScale();
    if (v.s > f0 * 1.15) fit();
    else zoomAt((phone ? Math.min(MAX_SCALE, f0 * 3) : 1) / v.s, cx, cy);
  };

  const sizeText = boxSizeText(box, H);
  const busyText = busy !== null ? `正在补细节 ${Math.round(busy * 100)}%` : null;
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  return (
    <div
      ref={root}
      className={`rv rgm${phone ? ' phone' : ''}`}
      onPointerDown={(e) => {
        stop(e);
        down(e);
      }}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onClick={stop}
      onDoubleClick={(e) => {
        stop(e);
        if (phone) return;
        const r = e.currentTarget.getBoundingClientRect();
        toggleZoom(e.clientX - r.left, e.clientY - r.top);
      }}
    >
      {!map && (
        <div className="rgm-wait">
          <span className="spin" />
          正在画这一页…
        </div>
      )}
      <canvas ref={sheet} className="rgm-sheet" style={{ visibility: map ? 'visible' : 'hidden' }} />
      {phone ? (
        <>
          <div className="rv-top">
            <button type="button" className="rv-rb" onClick={closeRelief}>
              <Icon name="back" size={18} />
              地图
            </button>
            <AreaTitle phone editable title={title} sub={busyText ? `${sizeText}，${busyText}` : sizeText} />
            {/* 右上留给「导出」(和左边的按钮一样宽,标题居中) */}
            <span className="rv-rb rv-spacer" aria-hidden="true" />
          </div>
          {tip && <div className="rv-tip rgm-tip">先看全貌；双指放大（或点两下）看字</div>}
          <div className="rv-sheet">
            <div className="rv-grab" />
            <div className="rv-line">
              <FaceSwitch face="flat" />
            </div>
            <div className="rv-line rgm-note">画风跟着地图：{styleName(style, look)}（回地图在图层里换）</div>
          </div>
        </>
      ) : (
        <>
          <div className="map-controls rv-ctl">
            <button type="button" className="glass mc-btn mc-globe mc-relief on" data-act="relief" aria-pressed="true" onClick={closeRelief} title="回到地图">
              <Icon name="region" size={18} />
              <span>地区</span>
            </button>
            <div className="glass mc-zooms">
              <button type="button" className="mc-btn mc-zoom" onClick={() => zoomCenter(1.25)} aria-label="放大">
                +
              </button>
              <button type="button" className="mc-btn mc-zoom" onClick={() => zoomCenter(1 / 1.25)} aria-label="缩小">
                −
              </button>
            </div>
          </div>
          <div className="rv-bar">
            <button type="button" className="b" onClick={closeRelief}>
              <Icon name="back" size={16} />
              回到地图
            </button>
            <AreaTitle editable title={title} sub={sizeText} />
            <span className="rv-sep" />
            <FaceSwitch face="flat" />
            <span className="rv-hint">{busyText ?? '滚轮放大看细节，拖动挪；画风在右上角换'}</span>
          </div>
        </>
      )}
    </div>
  );

  function zoomCenter(f: number) {
    const [l, t, r, b] = area();
    zoomAt(f, (l + r) / 2, (t + b) / 2);
  }
}

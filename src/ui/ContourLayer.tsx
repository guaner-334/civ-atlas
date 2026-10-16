/**
 * 等值线层("图层与投影"弹层里选的等高线 / 等温线 / 等降水线,见 projection.ts 的 contours):叠在地形之上、文明层之下,
 * 和经纬网一样按屏幕像素画在屏幕层里。线在世界坐标里算一次(每张栅格、每种线一份),拖动、缩放只重画。
 * 等距圆柱跟着地图平移;弯边投影逐点投影、按外轮廓裁。线上的数字躲开地名、城镇符号和浮在地图上的界面。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import { computeContours, drawContours, type ContourKind, type ContourSet } from '../render/contours';
import type { MapProj } from '../render/projection';
import { mapBoxOf, placeOnScreen, visibleBox } from './mapWrap';
import { mapTextBoxes } from './mapPick';
import { useAvoidBoxes } from './uiAvoid';

const cache = new WeakMap<Raster, Partial<Record<ContourKind, ContourSet>>>();
/** 这张栅格上的某种线(第一次要的时候算,之后从缓存拿) */
export function contoursOf(world: World, raster: Raster, k: ContourKind): ContourSet {
  let m = cache.get(raster);
  if (!m) cache.set(raster, (m = {}));
  return (m[k] ??= computeContours(raster, k, world.width));
}

export function ContourLayer({
  world,
  raster,
  kind,
  style,
  dark,
  view,
  mp = null,
}: {
  world: World;
  raster: Raster;
  kind: ContourKind;
  style: string;
  dark: boolean;
  view: { k: number; x: number; y: number };
  mp?: MapProj | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const ui = useAvoidBoxes(ref);
  // 地图框大小变了(窗口缩放)、地名重新排过,都要重画(数字躲地名)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const box = mapBoxOf(ref.current);
    if (!box || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setTick((t) => t + 1));
    ro.observe(box);
    return () => ro.disconnect();
  }, []);
  const textVer = useRef(-1);
  useEffect(() => {
    const t = setInterval(() => {
      const v = mapTextBoxes().ver;
      if (v !== textVer.current) setTick((n) => n + 1);
    }, 250);
    return () => clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    const cv = ref.current;
    const box = mapBoxOf(cv);
    if (!cv || !box) return;
    const hide = () => {
      if (cv.style.display !== 'none') cv.style.display = 'none';
      if (cv.width) cv.width = cv.height = 0;
    };
    const vis = visibleBox(box);
    if (!vis) return hide();
    const t0 = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round((vis.x1 - vis.x0) * vis.k * dpr));
    const H = Math.max(1, Math.round((vis.y1 - vis.y0) * vis.k * dpr));
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    Object.assign(cv.style, { display: '', width: `${W / dpr}px`, height: `${H / dpr}px` });
    placeOnScreen(cv, vis, vis.x0, vis.y0, vis.k);
    const ctx = cv.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // 要躲开的框:屏幕坐标 → 这张画布的像素
    const text = mapTextBoxes();
    textVer.current = text.ver;
    const r = cv.getBoundingClientRect();
    const f = r.width ? W / r.width : dpr;
    const avoid = [...text.list, ...ui].map((b) => [(b[0] - r.left) * f, (b[1] - r.top) * f, (b[2] - r.left) * f, (b[3] - r.top) * f]);
    const s = (vis.bw / world.width) * vis.k * dpr;
    const set = contoursOf(world, raster, kind);
    drawContours(ctx, set, style, { mp, s, ox: -vis.x0 * vis.k * dpr, oy: -vis.y0 * vis.k * dpr }, dpr, vis.k, dark, avoid);
    (window as unknown as { __wfContours?: unknown }).__wfContours = { kind, lines: set.lines.length, ms: performance.now() - t0 };
  }, [world, raster, kind, style, dark, view, tick, mp, ui]);

  return <canvas ref={ref} className="contours" style={{ pointerEvents: 'none', display: 'none' }} />;
}

/**
 * 插件图层在地图上:选中的地块图层盖在底图上(和地图框一起缩放;弯边投影按投影铺),标注图层画在舞台上的一张画布里
 * (平面、弯边投影、地球仪都按 MarkApi 的换算画),左上角的图例(存进这个世界、已存在这个世界里)。打开世界时读出存着的图层。
 */
import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Raster } from '../../../gen/raster';
import type { World } from '../../../gen/world';
import type { MarkLayer } from '../../../plugin/check';
import { cellColors, paintPluginCells, rampRange, type CellPaint } from '../../../render/pluginLayer';
import { drawPluginMarks } from '../../../render/pluginMarks';
import type { MapProj } from '../../../render/projection';
import type { MarkApi } from '../../MarkLayer';
import { mirrorCanvas } from '../../mapWrap';
import { ProjLayer } from '../../projection';
import { noteDismiss } from '../../dismissClick';
import { currentShown, pluginLayers, rerunLayerPlugin, type ShownLayer } from '../layerState';
import { stopLayerPlugin } from './layerRun';
import { loadSavedLayers, removeLayer, sameAsSaved, saveLayer } from './layerSave';
import './layers.css';

const colorCache = new WeakMap<object, Uint8Array>();
function colorsOf(l: CellPaint): Uint8Array {
  let c = colorCache.get(l);
  if (!c) colorCache.set(l, (c = cellColors(l)));
  return c;
}

const useShown = (): ShownLayer | null => pluginLayers.use(currentShown);

/** 选中的地块图层:和地图一样大的两张画布(右边接的一份),放在文明层上面、文字层下面;个数和地块对不上的不画 */
export function CellCanvas({ world, raster, mp }: { world: World; raster: Raster; mp: MapProj | null }) {
  const shown = useShown();
  const cells = shown && shown.cells.values.length === world.mesh.n ? shown.cells : null;
  const ref = useRef<HTMLCanvasElement>(null);
  const copyRef = useRef<HTMLCanvasElement>(null);
  const proj = useRef<ProjLayer | null>(null);
  const painted = useRef<{ cells: object; raster: Raster; curved: boolean } | null>(null);
  useLayoutEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    if (!cells) {
      painted.current = null;
      if (cv.width) cv.width = cv.height = 0;
      mirrorCanvas(copyRef.current, null, false);
      proj.current?.release();
      return;
    }
    const curved = !!mp;
    const p = painted.current;
    const fresh = !p || p.cells !== cells || p.raster !== raster || p.curved !== curved;
    if (mp) {
      const layer = (proj.current ??= new ProjLayer());
      if (fresh) paintPluginCells(layer.source(raster.w, raster.h).getContext('2d')!, raster, colorsOf(cells));
      layer.present(cv, mp, null);
      mirrorCanvas(copyRef.current, null, false);
    } else {
      if (fresh) {
        proj.current?.release();
        cv.width = raster.w;
        cv.height = raster.h;
        paintPluginCells(cv.getContext('2d')!, raster, colorsOf(cells));
      }
      mirrorCanvas(copyRef.current, cv, true);
    }
    painted.current = { cells, raster, curved };
  }, [cells, raster, mp]);
  useEffect(
    () => () => {
      proj.current?.release();
    },
    [],
  );
  return (
    <>
      <canvas ref={ref} className="plg-cells" data-testid="plugin-layer" />
      <canvas ref={copyRef} className="plg-cells wrap-copy" />
    </>
  );
}

const markLayersOf = (live: ReadonlyMap<string, { layer: { kind: string } }>): MarkLayer[] => [...live.values()].filter((l) => l.layer.kind === 'marks').map((l) => l.layer as MarkLayer);

/** 标注图层:铺满舞台的一张画布,不接鼠标;地图动了、交来的变了才重画 */
export function MarksCanvas({ world, api }: { world: World; api: MutableRefObject<MarkApi | null> }) {
  const live = pluginLayers.use(() => pluginLayers.get().live);
  const ref = useRef<HTMLCanvasElement>(null);
  const has = [...live.values()].some((l) => l.layer.kind === 'marks');
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !has) return;
    const ctx = cv.getContext('2d')!;
    const layers = markLayersOf(live);
    let sig = '';
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const v = api.current?.frame();
      const dpr = window.devicePixelRatio || 1;
      const now = v ? `${v.sig}|${dpr}` : '';
      if (now === sig) return;
      sig = now;
      if (!v) return ctx.clearRect(0, 0, cv.width, cv.height);
      const W = Math.max(1, Math.round(v.w * dpr));
      const H = Math.max(1, Math.round(v.h * dpr));
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
        cv.style.width = `${v.w}px`;
        cv.style.height = `${v.h}px`;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      if (v.period) {
        ctx.beginPath();
        ctx.rect(v.win[0], 0, v.win[1] - v.win[0], v.h);
        ctx.clip();
      }
      drawPluginMarks(ctx, layers, v, world.mesh);
      ctx.restore();
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      ctx.clearRect(0, 0, cv.width, cv.height);
    };
  }, [live, has, api, world]);
  if (!has) return null;
  return <canvas ref={ref} className="plg-marks" aria-hidden="true" />;
}

/** 刻度:两头和中间三处,最多三位有效数字 */
function ticksOf(lo: number, hi: number): { at: number; text: string }[] {
  const fmt = (v: number) => Number(v.toPrecision(3)).toLocaleString('en-US');
  return [0, 0.25, 0.5, 0.75, 1].map((t) => ({ at: t, text: fmt(lo + (hi - lo) * t) }));
}

/** 左上角插件图层的图例:色条和刻度(或者一类一个色块)、标题和单位、「插件「XX」」,存进这个世界 / 已存在这个世界里 */
export function PluginLegend({ phone }: { phone: boolean }) {
  const shown = useShown();
  const runnable = pluginLayers.use(() => pluginLayers.get().runnable);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(false);
      noteDismiss(e);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);
  useEffect(() => setMenu(false), [shown?.key]);
  if (!shown) return null;
  const c = shown.cells;
  const { live, saved } = shown;
  const fresh = !!live && !shown.dev && (!saved || !sameAsSaved(live, saved));
  // 存着的是装着的、只交图层的插件的:能让它按现在的样子再算一遍(工具在「工具」里开)
  const rerun = !live && !!saved && runnable.some((p) => p.id === shown.pluginId);
  const run = (f: () => Promise<void>) => {
    setBusy(true);
    void f().finally(() => setBusy(false));
  };
  let body;
  if (c.ramp) {
    const [lo, hi] = rampRange(c);
    const n = c.ramp.colors.length;
    const g = c.ramp.colors.map((col: string, i: number) => `${col} ${(i / (n - 1)) * 100}%`).join(',');
    body = (
      <div className="gradient plg-ramp">
        <div className="bar" style={{ background: `linear-gradient(90deg, ${g})` }} />
        <div className="ticks">
          {ticksOf(lo, hi).map((t) => (
            <span key={t.at} style={{ left: `${t.at * 100}%` }}>
              {t.text}
            </span>
          ))}
        </div>
      </div>
    );
  } else
    body = (
      <div className="keys">
        {(c.classes ?? []).map((k) => (
          <span key={k.value}>
            <i style={{ background: k.color }} />
            {k.label}
          </span>
        ))}
      </div>
    );
  return (
    <div className={`legend plg-legend${phone ? ' phone' : ''}`} data-testid="plugin-legend">
      {body}
      <div className="plg-lt">
        <span className="plg-lname">
          {c.title}
          {c.legend ? `（${c.legend}）` : ''}
        </span>
        {shown.dev && <span className="plg-ltag dev">开发中</span>}
        <span className="plg-ltag">插件「{shown.plugin}」</span>
        {fresh ? (
          <button type="button" className="plg-lbtn" data-act="plugin-layer-save" disabled={busy} onClick={() => run(() => saveLayer(live!))}>
            {phone ? '存进世界' : '存进这个世界'}
          </button>
        ) : (
          saved && (
            <span className="plg-lsaved" ref={menuRef}>
              <button type="button" data-act="plugin-layer-saved" aria-expanded={menu} disabled={busy} onClick={() => setMenu((m) => !m)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
                {phone ? '已存进世界' : '已存在这个世界里'}
              </button>
              {menu && (
                <span className="plg-lmenu" role="menu">
                  {rerun && (
                    <button
                      type="button"
                      role="menuitem"
                      className="plain"
                      data-act="plugin-layer-rerun"
                      onClick={() => {
                        setMenu(false);
                        rerunLayerPlugin(shown.pluginId);
                      }}
                    >
                      让插件重新算一遍
                    </button>
                  )}
                  <button
                    type="button"
                    role="menuitem"
                    data-act="plugin-layer-remove"
                    onClick={() => {
                      setMenu(false);
                      run(() => removeLayer(saved));
                    }}
                  >
                    从这个世界里拿掉
                  </button>
                </span>
              )}
            </span>
          )
        )}
      </div>
    </div>
  );
}

/** 打开着的世界换了:读出它存着的插件图层(cells = 地图有几个地块);图层面板里开的插件是给上一个世界算的,停掉 */
export function SavedLoader({ worldId, cells }: { worldId: string | null; cells: number }) {
  useEffect(() => {
    stopLayerPlugin();
    if (worldId) void loadSavedLayers(worldId, cells);
    else pluginLayers.set({ ...pluginLayers.get(), saved: new Map(), savedFor: null });
  }, [worldId, cells]);
  return null;
}

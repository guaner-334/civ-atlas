/**
 * 立体模式:框好的一块立起来,能转着看。
 *   电脑:和地球仪一样占住地图那一块(左边的卡片、上面的画风和导出照旧能用);时间轴的位置换成一条控件:
 *         回到地图、这一块叫什么 / 多大、起伏几倍(滑条 1–30)、复位视角、怎么操作;右下是「立体」(按下的)、指南针、远近
 *   手机:占满整屏;左上回到地图,中间这一块叫什么,指南针在右上;底下一张小卡片放起伏和复位;第一次按下之前有一句手势提示
 * 先出粗的(几个后台线程分着算,不到 0.3 秒就能转),细的算好了换上;换画风只重新上色(网格不变)。
 * 起伏默认按框的大小定(render/terrain3d/box.ts 的 autoExaggeration),滑条一拉立刻变,影子也跟着(着色器里算)。
 * 卫星(经典 / 细节 / 简化)、地理图、白模照着现成的画法上色;别的底图(手绘、数据底图)先按卫星画。
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { Civ } from '../../gen/civ/types';
import type { SurfaceLook } from '../../render/surface';
import { autoExaggeration, boxKm, boxSizeText, reliefScales } from '../../render/terrain3d/box';
import { buildMesh, meshStep, type ReliefMesh } from '../../render/terrain3d/relief';
import { closeRelief, getRelief, useRelief } from '../terrain3dStore';
import { freeArea } from '../flyTo';
import { showToast } from '../toastStore';
import { Icon } from '../icons';
import { reliefImage, reliefPrepare, reliefRelease, type ReliefImage } from './jobs';
import { reliefTitle } from './region';
import { ReliefStage, reliefDebug } from './stage';
import './terrain3d.css';

/** 立体用哪种上色:写实底图照它自己的画法(地理图叠了填色的那份按地理图);别的底图按卫星 */
export function reliefLook(style: string, look: SurfaceLook): SurfaceLook {
  if (style !== 'realistic') return 'detail';
  return look === 'geoMute' ? 'geo' : look;
}

interface Props {
  world: World;
  raster: Raster;
  civ: Civ | null;
  style: string;
  look: SurfaceLook;
  phone: boolean;
}

export function ReliefView({ world, raster, civ, style, look, phone }: Props) {
  const ui = useRelief();
  const box = ui.box!;
  const H = world.height;
  const want = reliefLook(style, look);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const needle = useRef<SVGSVGElement>(null);
  const stage = useRef<ReliefStage | null>(null);
  /** 现在贴着的是哪种上色、哪一档(换画风时按它重新上色) */
  const shown = useRef<{ look: SurfaceLook; S: number } | null>(null);
  const wantRef = useRef(want);
  wantRef.current = want;
  const [ex, setEx] = useState<number | null>(null);
  /** 细的那一档算到几成(null = 没在算) */
  const [busy, setBusy] = useState<number | null>(null);
  const [tip, setTip] = useState(true);
  const title = useMemo(() => reliefTitle(box, civ, raster, world.width), [box, civ, raster, world.width]);
  const km = boxKm(box, H);

  // 打开:开画布、先粗后细
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    let st: ReliefStage;
    try {
      st = new ReliefStage(cv, () => visibleRect(root.current, phone), phone);
    } catch {
      showToast({ id: 'relief', kind: 'warn', text: '这个浏览器画不了立体地形', more: ['换个浏览器，或者打开浏览器的硬件加速再试'] });
      closeRelief();
      return;
    }
    stage.current = st;
    shown.current = null;
    st.onNorth = (deg) => {
      if (needle.current) needle.current.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    };
    st.onTouch = () => setTip(false);
    const dbg = reliefDebug();
    Object.assign(dbg, { level: 'none', coarseMs: undefined, fineMs: undefined, frames: 0 });
    (window as unknown as { __wfReliefSpin?: (ms: number) => unknown }).__wfReliefSpin = (ms: number) => st.spin(ms);
    let alive = true;
    const at = getRelief().at || performance.now();
    const sc = reliefScales(box, phone);
    const fail = () => {
      if (!alive) return;
      showToast({ id: 'relief', kind: 'warn', text: '立体地形没算出来', more: ['回到地图再框一次试试'] });
      closeRelief();
    };
    /** 换上一档(粗 / 细) */
    const put = (img: ReliefImage, mesh: ReliefMesh) => {
      st.setModel(mesh, km.w, km.h, img.w, img.h, img.parts, img.horizon!);
      for (const p of img.parts) p.img.close();
    };
    (async () => {
      if (!reliefPrepare(world, raster, phone)) return fail();
      const look0 = wantRef.current;
      const c = await reliefImage(box, sc.coarse, look0, true, H);
      if (!alive) return c?.parts.forEach((p) => p.img.close());
      if (!c) return fail();
      // 起伏默认倍数按粗的这一档的最高处定(细的换上时不再变,免得一跳)
      const mesh0 = buildMesh(c.elev!, c.w, c.h, 1, km.w, km.h);
      const e = autoExaggeration(box, H, mesh0.maxElev);
      st.setEx(e);
      setEx(e);
      put(c, mesh0);
      shown.current = { look: look0, S: sc.coarse };
      Object.assign(dbg, { level: 'coarse', coarseMs: Math.round(performance.now() - at), coarseCalc: Math.round(c.ms), ex: e, maxElev: Math.round(mesh0.maxElev) });
      setBusy(0);
      const look1 = wantRef.current;
      const f = await reliefImage(box, sc.fine, look1, true, H, (n, of) => alive && setBusy(n / of));
      if (!alive) return f?.parts.forEach((p) => p.img.close());
      setBusy(null);
      if (!f) return; // 细的没算出来:留着粗的
      const mesh = buildMesh(f.elev!, f.w, f.h, meshStep(f.w, f.h, phone ? 130_000 : 220_000), km.w, km.h);
      put(f, mesh);
      shown.current = { look: look1, S: sc.fine };
      Object.assign(dbg, { level: 'fine', fineMs: Math.round(performance.now() - at), fineCalc: Math.round(f.ms), tex: [f.w, f.h], S: sc.fine, verts: mesh.nx * mesh.ny });
      recolorRef.current();
    })();
    /** 画风换了:按现在这一档重新上色(后台线程留着铺好的像素,只重新上色) */
    let coloring = false;
    const recolor = async () => {
      const s = shown.current;
      if (coloring || !s || s.look === wantRef.current || !alive) return;
      coloring = true;
      const look2 = wantRef.current;
      const img = await reliefImage(box, s.S, look2, false, H);
      coloring = false;
      if (!alive) return img?.parts.forEach((p) => p.img.close());
      if (img && shown.current?.S === s.S) {
        st.setColor(img.w, img.h, img.parts);
        for (const p of img.parts) p.img.close();
        shown.current = { look: look2, S: s.S };
      } else img?.parts.forEach((p) => p.img.close());
      recolor();
    };
    recolorRef.current = recolor;
    return () => {
      alive = false;
      recolorRef.current = () => {};
      stage.current = null;
      st.dispose();
      reliefRelease();
      delete (window as unknown as { __wfReliefSpin?: unknown }).__wfReliefSpin;
    };
    // 方框、世界换了才重来;画风换了走下面的重新上色
  }, [box, world, raster, phone]);
  const recolorRef = useRef<() => void>(() => {});
  useEffect(() => {
    recolorRef.current();
  }, [want]);

  const exNow = ex ?? 12;
  const onEx = (v: number) => {
    setEx(v);
    stage.current?.setEx(v);
    reliefDebug().ex = v;
  };
  const sizeText = boxSizeText(box, H);
  /** 细的那一档还在算:电脑写在右边操作说明的位置(不挤动别的),手机写在标题下面 */
  const busyText = busy !== null ? `正在补细节 ${Math.round(busy * 100)}%` : null;
  const range = (
    <input
      className="rv-range"
      type="range"
      min={1}
      max={30}
      step={1}
      value={exNow}
      disabled={ex === null}
      aria-label="起伏夸大几倍"
      style={{ '--p': `${((exNow - 1) / 29) * 100}%` } as CSSProperties}
      onChange={(e) => onEx(Number(e.target.value))}
    />
  );
  const compass = (
    <svg ref={needle} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 15.2 12H8.8z" fill="#ff453a" />
      <path d="M12 20.5 8.8 12h6.4z" fill="currentColor" opacity=".55" />
    </svg>
  );
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  return (
    <div ref={root} className={`rv${phone ? ' phone' : ''}`} onPointerDown={stop} onClick={stop} onDoubleClick={stop}>
      <canvas ref={canvas} />
      {phone ? (
        <>
          <div className="rv-top">
            <button type="button" className="rv-rb" onClick={closeRelief}>
              <Icon name="back" size={18} />
              地图
            </button>
            <div className="rv-ttl">
              <b>{title}</b>
              <small>{busyText ? `${sizeText}，${busyText}` : sizeText}</small>
            </div>
            {/* 右上留给「导出」(和左边的按钮一样宽,标题居中) */}
            <span className="rv-rb rv-spacer" aria-hidden="true" />
          </div>
          <button type="button" className="rv-compass" onClick={() => stage.current?.north()} aria-label="转回正北" title="转回正北">
            {compass}
          </button>
          {tip && <div className="rv-tip">单指转动，双指缩放，双指上下推改俯角</div>}
          <div className="rv-sheet">
            <div className="rv-grab" />
            <div className="rv-line">
              <span className="rv-lab">起伏</span>
              {range}
              <span className="rv-val">×{exNow}</span>
            </div>
            <div className="rv-line">
              <button type="button" className="b" onClick={() => stage.current?.reset()}>
                复位视角
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="map-controls rv-ctl">
            <button type="button" className="glass mc-btn mc-globe mc-relief on" data-act="relief" aria-pressed="true" onClick={closeRelief} title="回到地图">
              <Icon name="relief" size={18} />
              <span>立体</span>
            </button>
            <button type="button" className="glass mc-btn mc-globe rv-north" onClick={() => stage.current?.north()} aria-label="转回正北" title="转回正北">
              {compass}
            </button>
            <div className="glass mc-zooms">
              <button type="button" className="mc-btn mc-zoom" onClick={() => stage.current?.zoomBy(1.5)} aria-label="拉近">
                +
              </button>
              <button type="button" className="mc-btn mc-zoom" onClick={() => stage.current?.zoomBy(1 / 1.5)} aria-label="拉远">
                −
              </button>
            </div>
          </div>
          <div className="rv-bar">
            <button type="button" className="b" onClick={closeRelief}>
              <Icon name="back" size={16} />
              回到地图
            </button>
            <span className="rv-t">
              <b>{title}</b>
              <small>{sizeText}</small>
            </span>
            <span className="rv-sep" />
            <span className="rv-lab">起伏</span>
            {range}
            <span className="rv-val">×{exNow}</span>
            <button type="button" className="b" onClick={() => stage.current?.reset()}>
              复位视角
            </button>
            <span className="rv-hint">{busyText ?? '拖动旋转，滚轮拉近拉远，按住右键拖动平移'}</span>
          </div>
        </>
      )}
    </div>
  );
}

/** 画面里看得见的那一块(CSS 像素):宽屏让开左边的卡片(和右边的助手)、上面一排按钮、底下的控件条;手机让开上面一排和底下的卡片 */
function visibleRect(el: HTMLElement | null, phone: boolean): [number, number, number, number] {
  const r = el?.getBoundingClientRect();
  const sw = r?.width ?? window.innerWidth;
  const sh = r?.height ?? window.innerHeight;
  if (phone) {
    const sheet = el?.querySelector('.rv-sheet')?.getBoundingClientRect().height ?? 140;
    return [0, 190, sw, sh - sheet - 10];
  }
  const [l, , rr] = freeArea({ sw, sh, bw: 0, bh: 0 }, false);
  return [l, 64, rr, sh - 92];
}

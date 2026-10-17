/**
 * 竖版长图的预览。宽屏:地图整个压暗,中间一张长图(可以上下滚着看),右边一条整张的缩略、框出现在看到哪(点、拖它跳过去);
 * 手机:整屏是长图预览,手指上下划着看。切成 3:4 时一页一页分开排,右上角写第几张。
 *
 * 选项、画风这些一变就按新的重画(longRun.ts 的 renderLong):要重拍疆域图时预览蒙一层白,中间写画到第几张;
 * 刚打开还没有旧的预览时,就是一张白卡片加这一句。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CivStyle } from '../render/civ/overlay';
import type { LayerId } from '../render/layers';
import { useCivShow, useResourceView } from './civView';
import { useEdits } from './editsStore';
import { useMapCenter } from './mapWrap';
import { useGraticuleLines, useProjection } from './projection';
import { useFlags } from './flagStore';
import { useFilmSource, type FilmSource } from './filmSource';
import { filmSetup } from './filmStore';
import { disposeLong, longResult, renderLong, type LongLook } from './longRun';
import { useLong } from './longStore';
import { LONG_W, PAGE_H } from '../render/longImage';
import './long.css';

export interface LongStageProps {
  phone: boolean;
  style: CivStyle;
  layer: LayerId;
}

const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object | null | undefined) => {
  if (!o) return 0;
  let v = ids.get(o);
  if (!v) ids.set(o, (v = nextId++));
  return v;
};

/** 地图画法的指纹:换了就把拍好的地图全部重拍 */
function lookKey(src: FilmSource, look: LongLook, marks: unknown, flags: unknown): string {
  return [idOf(src), look.style, look.layer, JSON.stringify(look.show), JSON.stringify(look.res ?? null), look.projection, look.center ?? '', look.graticule, idOf(marks as object), idOf(flags as object)].join('|');
}

interface Box {
  left: number;
  top: number;
  w: number;
  h: number;
}

/** 宽屏:预览和右边那一条放在左边面板右侧的空地中间 */
function measure(): { pv: Box; strip: Box } {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const side = document.querySelector('.film-side')?.getBoundingClientRect();
  const L = side ? side.right : 0;
  const stripW = 96;
  const gap = 26;
  const pvW = Math.max(240, Math.min(520, W - L - 2 * 40 - gap - stripW));
  const left = L + (W - L - (pvW + gap + stripW)) / 2;
  return { pv: { left, top: 24, w: pvW, h: H - 48 }, strip: { left: left + pvW + gap, top: 24, w: stripW, h: H - 24 - 54 } };
}

export function LongStage({ phone, style, layer }: LongStageProps) {
  const s = useLong();
  const src = useFilmSource();
  const show = useCivShow();
  const resView = useResourceView();
  const proj = useProjection();
  const grat = useGraticuleLines();
  const center = useMapCenter();
  const { marks, era } = useEdits();
  const flags = useFlags();
  const pvRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLCanvasElement>(null);
  const [room, setRoom] = useState<ReturnType<typeof measure> | null>(null);
  const [scroll, setScroll] = useState({ top: 0, h: 1, view: 1 });

  // 选项、画法变了就重画
  useEffect(() => {
    if (!src) return;
    const setup = filmSetup(src, { style, layer });
    const look: LongLook = {
      style: setup.style,
      layer: setup.layer,
      show: setup.show,
      res: setup.res,
      projection: setup.projection,
      center: setup.center,
      graticule: setup.graticule,
      marks: setup.marks,
      markChars: setup.markChars,
      font: setup.font,
    };
    void renderLong(src, look, lookKey(src, look, marks, flags)).catch((e) => console.error('长图画不出来', e));
  }, [src, style, layer, show, resView, proj, grat, center, marks, era, flags, s.scope, s.polity, s.maps, s.events, s.split, s.title]);
  // 关掉面板:画好的图放掉
  useEffect(() => () => disposeLong(), []);

  useLayoutEffect(() => {
    if (phone) return;
    const m = () => setRoom(measure());
    m();
    window.addEventListener('resize', m);
    return () => window.removeEventListener('resize', m);
  }, [phone]);

  const res = s.ver ? longResult() : null;
  const busy = s.busy;

  // 预览里放画好的画布(整张,或者切开的每一页)
  useLayoutEffect(() => {
    const host = pvRef.current?.querySelector('.long-doc');
    if (!host) return;
    host.replaceChildren();
    if (!res) return;
    if (res.canvas) {
      res.canvas.className = 'long-img';
      host.appendChild(res.canvas);
    } else {
      res.pageCanvases.forEach((c, i) => {
        const pg = document.createElement('div');
        pg.className = 'long-page';
        c.className = 'long-img';
        pg.appendChild(c);
        const no = document.createElement('span');
        no.className = 'long-no';
        no.textContent = `${i + 1} / ${res.pageCanvases.length}`;
        pg.appendChild(no);
        host.appendChild(pg);
      });
    }
    const el = pvRef.current!;
    setScroll({ top: el.scrollTop, h: el.scrollHeight, view: el.clientHeight });
  }, [res, s.ver, room?.pv.w]);

  // 右边那一条:整张缩小(切开时一页一页,73 像素宽、页间 6 像素);太长放不下就再缩窄一点
  const miniGap = 6;
  const nPages = res?.pages?.length ?? 0;
  let miniW = 0;
  if (room && res) {
    miniW = nPages
      ? Math.min(73, ((room.strip.h - (nPages - 1) * miniGap) / nPages) * (LONG_W / PAGE_H))
      : Math.min(room.strip.w, room.strip.h * (LONG_W / res.lay.h));
    miniW = Math.max(8, Math.floor(miniW));
  }
  const pageMiniH = nPages ? (miniW * PAGE_H) / LONG_W : 0;
  const stripH = !res ? 0 : nPages ? nPages * pageMiniH + (nPages - 1) * miniGap : (miniW * res.lay.h) / LONG_W;
  useLayoutEffect(() => {
    const cv = stripRef.current;
    if (!cv || !res || phone) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(miniW * dpr);
    cv.height = Math.round(stripH * dpr);
    const ctx = cv.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.imageSmoothingQuality = 'high';
    if (res.canvas) ctx.drawImage(res.canvas, 0, 0, miniW, stripH);
    else
      res.pageCanvases.forEach((c, i) => {
        const y = i * (pageMiniH + miniGap);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, y, miniW, pageMiniH);
        ctx.drawImage(c, 0, y, miniW, pageMiniH);
      });
  }, [res, s.ver, miniW, stripH, pageMiniH, phone]);

  const onScroll = () => {
    const el = pvRef.current;
    if (el) setScroll({ top: el.scrollTop, h: el.scrollHeight, view: el.clientHeight });
  };
  // 点、拖右边那一条:预览跳到那里
  const stripJump = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = pvRef.current;
    if (!el || !stripH) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (e.clientY - r.top) / stripH));
    el.scrollTop = f * el.scrollHeight - el.clientHeight / 2;
  };

  const pill = busy ? `正在画疆域图，第 ${Math.min(busy.total, busy.done + 1)} 张，共 ${busy.total} 张` : '';
  const sbarH = Math.max(30, (scroll.view * scroll.view) / Math.max(1, scroll.h));
  const sbarTop = 6 + (scroll.h > scroll.view ? (scroll.top / (scroll.h - scroll.view)) * (scroll.view - 12 - sbarH) : 0);
  const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

  if (phone) {
    return (
      <div className="long-stage phone" onPointerDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop}>
        <div className={`long-pv${res?.pages ? ' pages' : ''}${res ? '' : ' empty'}`} ref={pvRef} onScroll={onScroll}>
          <div className="long-doc" />
        </div>
        {busy && <div className="long-veil" />}
        {busy && <div className="long-busy">{pill}</div>}
      </div>
    );
  }
  if (!room) return null;
  // 右边那一条上"现在看到哪"的框(切开时:看得到的那几页描蓝边)
  const k = stripH / Math.max(1, scroll.h);
  const vpTop = scroll.top * k;
  const vpH = Math.min(stripH, scroll.view * k);
  /** 预览里一页多高(页间 16 像素) */
  const pvPageH = (room.pv.w * PAGE_H) / LONG_W;
  const meta = !res ? '' : res.pages ? `${res.pages.length} 张，每张 1080×1440` : `1080×${res.lay.h}`;
  return (
    <div className="long-stage" onPointerDown={stop} onClick={stop} onDoubleClick={stop} onWheel={stop}>
      <div className="film-dim" />
      <div
        className={`long-pv${res?.pages ? ' pages' : ''}${res ? '' : ' empty'}`}
        ref={pvRef}
        onScroll={onScroll}
        style={{ left: room.pv.left, top: room.pv.top, width: room.pv.w, height: room.pv.h }}
      >
        <div className="long-doc" />
      </div>
      {!res?.pages && res && scroll.h > scroll.view && <i className="long-sbar" style={{ left: room.pv.left + room.pv.w - 8, top: room.pv.top + sbarTop, height: sbarH }} />}
      {busy && <div className="long-veil" style={{ left: room.pv.left, top: room.pv.top, width: room.pv.w, height: room.pv.h }} />}
      {busy && (
        <div className="long-busy" style={{ left: room.pv.left + room.pv.w / 2, top: room.pv.top + room.pv.h / 2 - 18 }}>
          {pill}
        </div>
      )}
      {res && (
        <div
          className={`long-strip${res.pages ? ' pages' : ''}${busy ? ' off' : ''}`}
          style={{ left: room.strip.left + (room.strip.w - miniW) / 2, top: room.strip.top, width: miniW, height: stripH }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            stripJump(e);
          }}
          onPointerMove={(e) => e.buttons & 1 && stripJump(e)}
        >
          <canvas ref={stripRef} style={{ width: miniW, height: stripH }} />
          {!res.pages && <i className="long-vp" style={{ top: vpTop, height: vpH }} />}
          {res.pages &&
            res.pages.map((_, i) => {
              const y = i * (pageMiniH + miniGap);
              const py = i * (pvPageH + 16);
              const on = py + pvPageH > scroll.top + 1 && py < scroll.top + scroll.view - 1;
              return <i key={i} className={`long-mini${on ? ' on' : ''}`} style={{ top: y, height: pageMiniH }} />;
            })}
        </div>
      )}
      {res && (
        <div className="long-meta" style={{ left: room.strip.left - 18, top: room.strip.top + stripH + 6, width: room.strip.w + 36 }}>
          {meta}
        </div>
      )}
    </div>
  );
}

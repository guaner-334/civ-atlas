/**
 * 导出回放视频时地图上的样子:
 *   整张地图 —— 屏幕上的地图缩不到能一眼看全整个世界,所以不用框:地图整个压暗,中间放一张预览(和成片一模一样,
 *              按时间轴上的年份画;FilmRenderer 画的就是成片里的那一帧)。
 *   框里这一块 —— 地图上一个框,框外压暗;拖动、缩放地图,把要拍的地方放进框里。框里盖一层成片上的字
 *              (横屏:左上角年份、下面的字幕;竖屏:上下两栏),地图那一块透出底下屏幕上的地图。
 * 框 / 预览上面一行小字写画面大小(导出时写正在画哪一年),下面一个提示条。导出时预览换成正在编码的那一帧。
 * 宽屏:预览在左边面板和右边之间居中;手机:在顶上和时间轴之间。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CivStyle } from '../render/civ/overlay';
import type { LayerId } from '../render/layers';
import { drawFilmFrame, filmMapRect } from '../render/film';
import { useCivShow, useCivTime } from './civView';
import { useEdits } from './editsStore';
import { useMapCenter } from './mapWrap';
import { useGraticule, useProjection } from './projection';
import { getFilmViewport, useFilmSource } from './filmSource';
import { FilmRenderer } from './filmRun';
import { filmLiveCanvas, filmMajors, filmRangeOf, filmSetup, holeRegion, setFilmHole, useFilm } from './filmStore';
import { filmSize } from './filmPlan';

export interface FilmStageProps {
  phone: boolean;
  style: CivStyle;
  layer: LayerId;
}

interface Box {
  left: number;
  top: number;
  w: number;
  h: number;
}

interface Room {
  /** 预览 / 框能放的地方:水平中线、上沿、最宽、最高;提示条的上沿 */
  cx: number;
  top: number;
  maxW: number;
  maxH: number;
  pill: number;
}

/** 量一下界面:左边面板、右上按钮条、底下的时间轴(手机:底部卡片)之间还剩多大 */
function measure(phone: boolean, sheetH: number): Room {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const bottom = document.querySelector('.bottom-row')?.getBoundingClientRect();
  if (phone) {
    // 时间轴浮在卡片上面 10 像素(film.css);卡片变高时时间轴是滑上去的,按卡片算它最后停在哪
    const tl = bottom && bottom.height > 0 ? (sheetH > 0 ? H - sheetH - 10 - bottom.height : bottom.top) : H - 330;
    const B = tl - 14;
    const top = B - 84 >= 420 ? 84 : 56;
    return { cx: W / 2, top, maxW: W - 24, maxH: Math.max(120, B - top), pill: -1 };
  }
  const side = document.querySelector('.film-side')?.getBoundingClientRect();
  const bar = document.querySelector('.map-bar')?.getBoundingClientRect();
  const L = side ? side.right + 14 : 14;
  const R = bottom && bottom.width > 0 ? bottom.right : W - 14;
  const T = (bar && bar.height > 0 ? bar.bottom : 52) + 33;
  const tl = bottom && bottom.height > 0 ? bottom.top : H - 85;
  return { cx: (L + R) / 2, top: T, maxW: Math.max(160, R - L - 86), maxH: Math.max(120, tl - 90 - T), pill: tl - 59 };
}

/** 预览 / 框在页面上的位置 */
function frameBox(room: Room, shape: 'land' | 'port', area: 'whole' | 'region', phone: boolean): Box {
  const a = shape === 'land' ? 16 / 9 : 9 / 16;
  let w = Math.min(room.maxW, room.maxH * a);
  let h = w / a;
  if (!phone && area === 'region' && shape === 'land') {
    // 框比整张地图的预览小一圈,往下靠一点(露出上面的地图)
    w *= 0.96;
    h *= 0.96;
    return { left: room.cx - w / 2 - 10, top: room.top + Math.min(43, room.maxH - h), w, h };
  }
  return { left: room.cx - w / 2, top: room.top + (room.maxH - h) / 2, w, h };
}

export function FilmStage({ phone, style, layer }: FilmStageProps) {
  const s = useFilm();
  const src = useFilmSource();
  const t = useCivTime();
  const show = useCivShow();
  const proj = useProjection();
  const grat = useGraticule();
  const center = useMapCenter();
  const marks = useEdits().marks;
  const [room, setRoom] = useState<Room | null>(null);
  const [vkey, setVkey] = useState('');
  const pvRef = useRef<HTMLCanvasElement>(null);
  const holeRef = useRef<HTMLDivElement>(null);
  const run = s.run;
  const whole = s.area === 'whole';
  const film = filmSize(s.shape);

  // 量界面(窗口大小变了、手机底部卡片变高变矮了再量)
  useLayoutEffect(() => {
    const m = () => setRoom(measure(phone, s.sheetH));
    m();
    window.addEventListener('resize', m);
    const ro = new ResizeObserver(m);
    for (const el of document.querySelectorAll('.film-sheet, .film-side, .bottom-row')) ro.observe(el);
    return () => {
      window.removeEventListener('resize', m);
      ro.disconnect();
    };
  }, [phone, s.mode, !!run, s.sheetH]);

  const box = room ? frameBox(room, s.shape, s.area, phone) : null;
  const mr = filmMapRect(s.shape, s.area);
  const scale = box ? box.w / film.w : 1;

  // 框住地图的那一块报告给 filmStore(导出时按它取地图上的范围)
  useLayoutEffect(() => {
    const el = holeRef.current;
    if (!el || whole) return setFilmHole(null);
    const r = el.getBoundingClientRect();
    setFilmHole({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  });
  // 拍框里一块:地图平移、缩放了,字幕挑的大事跟着换(每半秒看一眼视图变没变)
  useEffect(() => {
    if (whole) return;
    const tick = () => setVkey(getFilmViewport()?.key ?? '');
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [whole]);

  const full = src?.full ?? null;
  const range = full ? filmRangeOf(full) : null;
  const year = full && range ? Math.min(range.to, Math.max(range.from, Math.floor(t.year ?? full.endYear))) : 0;

  // 预览用的画法:选项、画风、图层、地名开关、投影变了重开一个
  const renderer = useMemo(() => {
    if (!src || !s.mode) return null;
    const region = whole ? undefined : holeRegion();
    return new FilmRenderer(src, filmSetup(src, { style, layer }, region), filmMajors(src.full));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, s.mode, s.shape, s.area, s.rangeKind, s.range, s.seconds, s.captions, s.cards, s.title, style, layer, show, proj, grat, center, marks, whole ? '' : vkey, box?.w]);
  useEffect(() => () => renderer?.dispose(), [renderer]);

  // 整张地图:预览按年份重画(一帧要 0.1 秒多;拖时间轴时只画最新的那一年,选项改了用新的画法)
  const want = useRef<number | null>(null);
  const busy = useRef(false);
  const latest = useRef(renderer);
  latest.current = renderer;
  useEffect(() => {
    if (!renderer || run || !whole) return;
    want.current = year;
    if (busy.current) return;
    busy.current = true;
    void (async () => {
      try {
        while (want.current !== null) {
          const y = want.current;
          want.current = null;
          const r = latest.current;
          const ctx = pvRef.current?.getContext('2d');
          if (!r || !ctx) break;
          await r.draw(ctx, r.frameOf(y), y);
        }
      } catch (e) {
        console.error('预览画不出来', e);
      } finally {
        busy.current = false;
      }
    })();
  }, [renderer, year, run, whole]);

  // 框里这一块:框里盖一层字(地图透出来)
  useEffect(() => {
    if (!renderer || run || whole) return;
    const cv = pvRef.current;
    const ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    ctx.save();
    ctx.setTransform(cv.width / film.w, 0, 0, cv.height / film.h, 0, 0);
    drawFilmFrame(ctx, renderer.look, renderer.frameOf(year), null);
    ctx.restore();
  }, [renderer, year, run, whole, film.w, film.h, box?.w, box?.h]);

  // 导出时:预览换成正在编码的那一帧
  useEffect(() => {
    if (!run) return;
    const live = filmLiveCanvas();
    const cv = pvRef.current;
    const ctx = cv?.getContext('2d');
    if (!live || !cv || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(live, 0, 0, cv.width, cv.height);
    ctx.restore();
  }, [run]);

  if (!s.mode || s.mode !== 'video' || !box) return null;
  const dpr = window.devicePixelRatio || 1;
  // 整张地图的预览按成片的像素画(和成片一模一样);框里那一层按屏幕像素
  const cw = whole ? film.w : Math.round(box.w * dpr);
  const ch = whole ? film.h : Math.round(box.h * dpr);
  const label = run
    ? `正在导出　第 ${run.year} 年`
    : `${s.shape === 'land' ? '横屏' : '竖屏'}　${film.w}×${film.h}${whole ? '　整张地图' : ''}`;
  const pill = run
    ? '正在导出，先别关掉这个网页'
    : whole
      ? '整个世界都在画面里。只想拍一块，左边「拍哪里」选「框里这一块」'
      : '拖动、缩放地图，把要拍的地方放进框里';
  return (
    <div className={`film-stage${whole ? ' whole' : ' region'}${phone ? ' phone' : ''}`}>
      {whole ? (
        <div className="film-dim" />
      ) : (
        <>
          {/* 框外压暗(四块) */}
          <div className="film-dim part" style={{ left: 0, top: 0, right: 0, height: Math.max(0, box.top) }} />
          <div className="film-dim part" style={{ left: 0, top: box.top + box.h, right: 0, bottom: 0 }} />
          <div className="film-dim part" style={{ left: 0, top: box.top, width: Math.max(0, box.left), height: box.h }} />
          <div className="film-dim part" style={{ left: box.left + box.w, top: box.top, right: 0, height: box.h }} />
        </>
      )}
      <div
        className={`film-frame${whole ? ' pv' : ''}`}
        style={{ left: box.left, top: box.top, width: box.w, height: box.h }}
        data-shape={s.shape}
        data-area={s.area}
      >
        <canvas ref={pvRef} width={cw} height={ch} key={`${cw}x${ch}`} />
        {!whole && <div ref={holeRef} className="film-hole" style={{ left: mr.x * scale, top: mr.y * scale, width: mr.w * scale, height: mr.h * scale }} />}
      </div>
      <div className="film-size" style={{ left: box.left, top: box.top - 28 }}>
        {label}
      </div>
      {!phone && room && room.pill > 0 && (
        <div className="film-pill" style={{ left: room.cx, top: room.pill }}>
          {pill}
        </div>
      )}
    </div>
  );
}

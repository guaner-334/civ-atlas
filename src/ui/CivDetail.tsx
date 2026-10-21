/**
 * 文明细节层(canvas.civ-detail、civ-detail-sel、civ-detail-hl):放大到 DETAIL_K 倍以上时,把文明底图、选中层、高亮层
 * 看得见的那一块按屏幕像素重画(render/civ/detail.ts)—— 色块的边顺着界线和岸线、线条按屏幕粗细,放大多少倍都不糊、不起方块;
 * 同时把被 CSS 放大的那几张(canvas.civ、civ-sel、civ-hl 和右边接的那一份)藏起来。
 *
 * 和地形细节层一样放在不缩放的屏幕层里(App 传进来的 host:地形细节层、视窗装饰之上,文明底图那一层地图框之下;
 * 见 mapWrap.ts 的"屏幕层"),按地图框的位置摆(placeOnScreen),画布像素 = 屏幕像素。
 *
 * 画哪一块、什么时候重画,和地形细节层(TerrainDetail.tsx)同一套规则:视口附近一块(四周各留 1/4 视口);
 * 视口还在画好的那一块里、缩放倍数差不到 30% 就不重画只挪位置;停下来 0.15 秒后按准确的倍数补画;
 * 弯边投影拖动转中心时整块左右平移(放大不到 SLIDE_K 倍先藏起来)。两层同时重画、倍数一样 ——
 * 手绘风色块给符号"让位"的遮罩(按这个倍数画的符号层)和地形细节层的符号对得上。
 * 只换数据(回放 / 拖时间轴换年份、开关图层、选中、高亮)时在画好的那一块上重画,不挪位置、不换倍数。
 *
 * 逐格上色的粗细:停着的时候 1 个 CSS 像素一格;拖动、缩放中重画和回放 / 拖时间轴时 2 个 CSS 像素一格(快几倍),
 * 停下来、回放停了再按 1 个补画。线条一直按屏幕像素画。
 *
 * 重画时分帧(ui/detailJobs.ts,同地形细节层;弯边投影也一样,备的时候画好的那几张按投影平移着顶着):符号遮罩、逐格上色在后台一小段一小段地算,画好的那几张接着顶着,
 * 备好了和地形细节层一起整张换上(画出来的和一口气画完的逐像素一样)。拖到离画好那一块的边不到半个余量就提前备下一块
 * (往拖的方向多留一些),真拖出去了还没备好,剩下的当下做完。回放 / 拖时间轴(每一年都要马上画)、换了世界或画风
 * (被藏起来的整张图、画好的那几张都是旧的,不能露出来顶着)时当下画完。
 */
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import type { Civ } from '../gen/civ/types';
import { DETAIL_K } from '../render/detail';
import { centerShift, type MapProj } from '../render/projection';
import {
  detailCache,
  planCivDetail,
  planHighlightDetail,
  planSelectionDetail,
  releaseDetailCache,
  runPlan,
  type CivDetailView,
  type DetailCache,
  type DetailPlan,
  type DetailTiming,
} from '../render/civ/detail';
import { aheadOf, cancelDetailJob, DetailBuffer, detailAsync, flushDetailJobs, submitDetailJob, type JobStats } from './detailJobs';
import { washLayer } from '../render/civ/territory';
import type { CivDrawParams, CivStyle } from '../render/civ/overlay';
import type { CivHighlight, SelectionTarget } from '../render/civ/highlight';
import { mapBoxOf, placeOnScreen, visibleBox, watchMapBox, type Visible } from './mapWrap';
import { useMapMoving } from './projection';

/** 画好的那一块(地图框 CSS 坐标,缩放前)、画的时候的缩放倍数、画布 → 地图平面的变换 */
interface Region {
  id: number;
  world: World;
  raster: Raster;
  /** 地图框(缩放 1 倍)的宽:窗口缩放后坐标就不对了,要重画 */
  bw: number;
  k: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 画布像素 / CSS 像素 */
  dpr: number;
  /** 按哪个投影 + 中心画的(等距圆柱 = '') */
  proj: string;
  mp: MapProj | null;
  view: CivDetailView;
  cache: DetailCache;
}

/** 每张画布画的是哪一块、哪份数据(哪个 civ)、多粗的格 */
interface Drawn {
  region: number;
  data: unknown;
  civ: Civ | null;
  step: number;
}

/** 一块上要画的那几张(备料 / 画两半):'keep' = 画着的接着用,null = 不要这一张 */
interface Plans {
  R: Region;
  step: number;
  base: DetailPlan<DetailTiming> | 'keep' | null;
  sel: DetailPlan<number> | 'keep' | null;
  hl: DetailPlan<Uint8Array> | 'keep' | null;
}

/** 在后台备料的那一份,和按哪份数据备的 */
interface Pending {
  ps: Plans;
  params: CivDrawParams | null;
  selKey: string | null;
  hlKey: string | null;
  civ: Civ | null;
  /** 底图、选中这两张在藏着的那张画布上画好了(备料的最后几步画的),换上时对调,画出来的东西(draw 的返回值)存在这 */
  ready: { base?: DetailTiming; sel?: number };
}

/** 分帧备料时这一层的名字(见 detailJobs.ts) */
const JOB = 'civ';

/** 画布最多多少像素(约 48 MB 显存);超了就降低像素密度(同地形细节层) */
const MAX_PIXELS = 12e6;
/** 四周多画的余量(占看得见那一块的比例) */
const MARGIN = 0.25;
/** 缩放倍数变了多少以内不重画 */
const K_SLACK = Math.log(1.3);
/** 弯边投影里转中心时:放大到几倍以上才让画好的那一块跟着左右平移(以下先藏起来) */
const SLIDE_K = 3;
/** 平移和真实投影在视口上下边最多差几个 CSS 像素(超了就按新中心重画) */
const SLIDE_ERR = 8;
/** 按新中心重画的那一块在后台备料时,画好的那块平移着先顶着:允许差到几个 CSS 像素(同地形细节层) */
const HOLD_ERR = 3 * SLIDE_ERR;
/** 逐格上色:停着 / 拖动、回放时一格几个 CSS 像素;工作格最多多少个(超了就放粗) */
const STEP_FINE = 1;
const STEP_COARSE = 2;
const MAX_CELLS_FINE = 4.5e6;
const MAX_CELLS_COARSE = 1.2e6;

let regionSeq = 0;

/** 弯边投影:画好的那一块换到新中心时整体左右平移多少(地图框 CSS 像素);要重画 = null(同 TerrainDetail) */
function slideOf(d: Region, mp: MapProj, vis: Visible, maxErr = SLIDE_ERR): number | null {
  const from = d.mp;
  if (!from || from.def !== mp.def || from.W !== mp.W || from.H !== mp.H) return null;
  const ux = mp.W / vis.bw;
  const uy = mp.H / vis.bh;
  const { dx, err } = centerShift(from, mp, vis.y0 * uy, vis.y1 * uy);
  return (err / ux) * vis.k <= maxErr ? dx / ux : null;
}

/** 挪了 dx 的一块(提前备下一块时按它算离边多远) */
const shifted = (r: Region, dx: number) => ({ x0: r.x0 + dx, y0: r.y0, x1: r.x1 + dx, y1: r.y1 });

/** 底图这一层有没有东西要画(只开着地名时没有) */
function baseHasContent(p: CivDrawParams | null): boolean {
  if (!p) return false;
  const s = p.show;
  return washLayer(p) !== null || (s.polities && p.civ.polities.length > 0) || (s.routes && p.civ.routes.length > 0) || s.regions || s.sites || s.habitat;
}

/**
 * 卸下时收拾(给 useEffect 当清理函数用)。清理函数在这里(模块里)建:要是在组件那一次渲染里建,
 * 它会一直拉住挂上那一刻的世界、主图、历史,换了世界也放不掉
 */
function unmountDetail(timer: { current: number }, bufs: { current: { base: DetailBuffer; sel: DetailBuffer } | null }, hide: RefObject<HTMLCanvasElement>[]) {
  return () => {
    window.clearTimeout(timer.current);
    cancelDetailJob(JOB);
    bufs.current?.base.dispose();
    bufs.current?.sel.dispose();
    bufs.current = null;
    for (const r of hide) if (r.current) r.current.style.visibility = '';
  };
}

export interface CivDetailProps {
  world: World;
  raster: Raster;
  /** 底图的参数(和整张图同一份);没有文明 = null */
  params: CivDrawParams | null;
  /** 画选中 / 高亮用的 civ(原始的,改名不重画);没有 = null */
  civ: Civ | null;
  style: CivStyle;
  /** 选中的东西、选中国家按哪一年的国土画 */
  sel: SelectionTarget | null;
  selYear: number;
  hl: (CivHighlight & { stamp: number }) | null;
  view: { k: number; x: number; y: number };
  mp: MapProj | null;
  /** 放在哪(屏幕层);还没有 = 不画 */
  host: HTMLElement | null;
  /** 高亮那张画布(闪烁动画由 CivLayer 和整张图的高亮层一起放) */
  hlRef: RefObject<HTMLCanvasElement>;
  /** 细节层盖住时要藏起来的那几张(被 CSS 放大的文明底图、选中、高亮和右边接的那一份) */
  hide: RefObject<HTMLCanvasElement>[];
  /** 细节层开 / 关(开着时 CivLayer 不用再重画被藏起来的那几张) */
  onCover: (on: boolean) => void;
}

export function CivDetail({ world, raster, params, civ, style, sel, selYear, hl, view, mp, host, hlRef, hide, onCover }: CivDetailProps) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const selRef = useRef<HTMLCanvasElement>(null);
  /** 底图、选中各两张画布:显示着的和藏着的(备料的最后几步画在藏着的那张上,换上时对调,见 detailJobs.ts)。高亮那张有闪烁动画,不对调 */
  const bufs = useRef<{ base: DetailBuffer; sel: DetailBuffer } | null>(null);
  const region = useRef<Region | null>(null);
  /** 在后台备料、还没画上去的那一份(见 detailJobs.ts) */
  const pend = useRef<Pending | null>(null);
  const drawn = useRef<{ base: Drawn | null; sel: Drawn | null; hl: Drawn | null }>({ base: null, sel: null, hl: null });
  const covered = useRef(false);
  const lastView = useRef<unknown>(null);
  const timer = useRef(0);
  const moving = useMapMoving();
  /** 现在的投影 + 中心、是不是正在转中心(后台备好的那一份画上去时按它摆) */
  const live = useRef({ mp, moving });
  live.current = { mp, moving };
  const coverRef = useRef(onCover);
  coverRef.current = onCover;

  // 地图框大小变了(窗口缩放)也要重画
  const [tick, setTick] = useState(0);
  useEffect(() => watchMapBox(baseRef.current, setTick), [host]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => unmountDetail(timer, bufs, hide), []);

  useLayoutEffect(() => {
    const box = mapBoxOf(baseRef.current);
    if (!baseRef.current || !selRef.current || !hlRef.current || !box) return;
    const bf = (bufs.current ??= { base: new DetailBuffer(baseRef.current), sel: new DetailBuffer(selRef.current) });
    const hlCv = hlRef.current;
    /** 显示着的那几张(底图、选中两张会对调,每次现取) */
    const cvs = {
      get base() {
        return bf.base.front;
      },
      get sel() {
        return bf.sel.front;
      },
      hl: hlCv,
    };
    window.clearTimeout(timer.current);
    /** 在后台备的那一份不要了 */
    const cancel = () => {
      if (!pend.current) return;
      pend.current = null;
      bf.base.rest();
      bf.sel.rest();
      cancelDetailJob(JOB);
      const g = window as unknown as { __wfCivDetail?: Record<string, unknown> };
      if (g.__wfCivDetail?.pending) g.__wfCivDetail.pending = false;
    };
    const setCover = (on: boolean) => {
      if (covered.current === on) return;
      covered.current = on;
      for (const r of hide) if (r.current) r.current.style.visibility = on ? 'hidden' : '';
      coverRef.current(on);
    };
    /** release = false:只藏起来,画布留着(拖动中;停下来接着用,不重新分配) */
    const off = (release = true) => {
      cancel();
      for (const cv of [cvs.base!, cvs.sel!, cvs.hl!]) {
        if (cv.style.display !== 'none') cv.style.display = 'none';
        if (release && cv.width) cv.width = cv.height = 0;
      }
      if (release) {
        bf.base.drop();
        bf.sel.drop();
      }
      if (region.current) releaseDetailCache(region.current.cache);
      region.current = null;
      drawn.current = { base: null, sel: null, hl: null };
      setCover(false);
      (window as unknown as { __wfCivDetail?: unknown }).__wfCivDetail = { on: false, k: view.k };
    };
    const wantBase = baseHasContent(params);
    const wantSel = !!civ && !!sel && sel.kind !== 'settlement';
    const wantHl = !!civ && !!hl;
    if (view.k <= DETAIL_K || (!wantBase && !wantSel && !wantHl)) return off();
    const projKey = mp ? mp.key : '';
    const fast = !!params?.fast;
    const viewNow = view;
    // 分帧备料(见 detailJobs.ts):不在回放 / 拖时间轴时才分(回放每一年都要马上画);关掉开关时当下画完
    const async = detailAsync && !fast;
    const selKey = wantSel ? `${sel!.kind}|${sel!.id}|${selYear}|${style}` : null;
    const hlKey = wantHl ? `${hl!.stamp}|${style}` : null;

    /** r 这一块(整体左右挪 dx)盖住 [x0, x1] × [y0, y1] 没有 */
    const covers = (r: Region, x0: number, y0: number, x1: number, y1: number, dx = 0) =>
      r.x0 + dx <= x0 + 0.5 && r.y0 <= y0 + 0.5 && r.x1 + dx >= x1 - 0.5 && r.y1 >= y1 - 0.5;
    /** 画好的(或在备的)那一块能接着用:盖得住看得见的那一块,缩放倍数差得不多(停下来补画时要准) */
    const fits = (r: Region, vis: Visible, exact: boolean, dx = 0) =>
      covers(r, vis.x0, vis.y0, vis.x1, vis.y1, dx) && Math.abs(Math.log(vis.k / r.k)) < (exact ? 0.02 : K_SLACK);
    /**
     * 画好的(或在备的)那一块要左右挪多少才对得上(地图框 CSS 像素):同一个投影 + 中心 = 0;
     * 弯边投影正在转中心 = 按投影整体平移(停下来要准,不算);null = 用不上,要按新中心重画
     */
    const shiftOf = (r: Region | null, exact: boolean, vis: Visible) =>
      !r ? null : r.proj === projKey ? 0 : mp && moving && !exact ? slideOf(r, mp, vis) : null;
    /** 后台备新的一块时,画好的那块先顶着要挪多少(停下来了也先平移着顶着,差得太多 = null) */
    const holdOf = (r: Region, vis: Visible) => (r.proj === projKey ? 0 : mp ? slideOf(r, mp, vis, HOLD_ERR) : null);

    /** R 这一块按多粗的格上色(拖动、缩放中或回放中粗一点) */
    const stepOf = (R: Region, interacting: boolean) => {
      const css = fast || interacting ? STEP_COARSE : STEP_FINE;
      const cells = (R.view.cw * R.view.ch) / (R.dpr * R.dpr * css * css);
      const maxCells = css === STEP_FINE ? MAX_CELLS_FINE : MAX_CELLS_COARSE;
      return Math.max(1, Math.round(css * R.dpr * Math.max(1, Math.sqrt(cells / maxCells))));
    };

    /**
     * 在 R 这一块上要重画哪几张(备料 / 画两半,见 render/civ/detail.ts):没画过、换了数据、换了一块,或停下来要换细格的;
     * 'keep' = 画着的那张接着用,null = 不要这一张(藏起来)
     */
    const plansFor = (R: Region, step: number, interacting: boolean): Plans => {
      const dr = drawn.current;
      const need = (dw: Drawn | null, data: unknown, c: Civ | null = null) =>
        !dw || dw.region !== R.id || dw.data !== data || dw.civ !== c || (dw.step > step && !interacting);
      return {
        R,
        step,
        base: wantBase && params ? (need(dr.base, params) ? planCivDetail(params, R.view, step, R.cache) : 'keep') : null,
        sel: wantSel && civ ? (need(dr.sel, selKey, civ) ? planSelectionDetail(world, raster, civ, sel!, selYear, style, R.view, step, R.cache) : 'keep') : null,
        hl: wantHl && civ ? (need(dr.hl, hlKey, civ) ? planHighlightDetail(world, raster, civ, hl!, style, R.view, step, R.cache) : 'keep') : null,
      };
    };
    const anyNew = (ps: Plans) => [ps.base, ps.sel, ps.hl].some((x) => x !== null && x !== 'keep');
    const stepsOf = (ps: Plans) => [ps.base, ps.sel, ps.hl].flatMap((x) => (x && x !== 'keep' ? x.steps : []));

    /** 备好的画上去(没备的当下备完)、摆好、报告;st = 分帧备料的统计;ready = 藏着的那张已经画好的那几张,对调上来就行 */
    const paint = (ps: Plans, vis: Visible, exact: boolean, slide: number, st?: JobStats, ready: Pending['ready'] = {}) => {
      const { R, step } = ps;
      const old = region.current;
      if (old && old !== R) releaseDetailCache(old.cache);
      region.current = R;
      const t0 = performance.now();
      const timing = { wash: 0, lines: 0, ink: 0, sel: 0, hl: 0 };
      let did = false;
      // 分帧备好的(st):料都备齐了,直接画;当下画的先备料再画
      const run = <T,>(ctx: CanvasRenderingContext2D, pl: DetailPlan<T>) => (st ? pl.draw(ctx) : runPlan(ctx, pl));
      /** 对调上来的那张摆好(大小、显示) */
      const shown = (cv: HTMLCanvasElement) => {
        Object.assign(cv.style, { display: '', width: `${R.view.cw / R.dpr}px`, height: `${R.view.ch / R.dpr}px` });
      };
      const prep = (cv: HTMLCanvasElement) => {
        if (cv.width !== R.view.cw || cv.height !== R.view.ch) {
          cv.width = R.view.cw;
          cv.height = R.view.ch;
        }
        Object.assign(cv.style, { display: '', width: `${R.view.cw / R.dpr}px`, height: `${R.view.ch / R.dpr}px` });
        return cv.getContext('2d')!;
      };
      const hideCv = (cv: HTMLCanvasElement) => {
        if (cv.style.display !== 'none') cv.style.display = 'none';
        if (cv.width) cv.width = cv.height = 0;
      };
      // 底图
      const dr = drawn.current;
      if (ps.base === null) {
        if (dr.base || cvs.base!.width) {
          hideCv(cvs.base!);
          dr.base = null;
        }
      } else if (ps.base !== 'keep') {
        let t: DetailTiming;
        if (ready.base) {
          bf.base.swap();
          shown(cvs.base);
          t = ready.base;
        } else t = run(prep(cvs.base!), ps.base);
        timing.wash = t.wash;
        timing.lines = t.lines;
        timing.ink = t.ink;
        dr.base = { region: R.id, data: params, civ: null, step };
        did = true;
      }
      // 选中
      if (ps.sel === null) {
        if (dr.sel || cvs.sel!.width) {
          hideCv(cvs.sel!);
          dr.sel = null;
        }
      } else if (ps.sel !== 'keep') {
        const t1 = performance.now();
        let lit: number;
        if (ready.sel !== undefined) {
          bf.sel.swap();
          shown(cvs.sel);
          lit = ready.sel;
        } else lit = run(prep(cvs.sel!), ps.sel);
        timing.sel = performance.now() - t1;
        dr.sel = { region: R.id, data: selKey, civ, step };
        did = true;
        (window as unknown as { __wfSelection: unknown }).__wfSelection = { kind: sel!.kind, id: sel!.id, lit, ms: timing.sel, detail: true };
      }
      // 高亮(不透明度的闪烁动画在 CivLayer 里放)
      if (ps.hl === null) {
        if (dr.hl || cvs.hl!.width) {
          hideCv(cvs.hl!);
          dr.hl = null;
        }
      } else if (ps.hl !== 'keep') {
        const t1 = performance.now();
        run(prep(cvs.hl!), ps.hl);
        timing.hl = performance.now() - t1;
        dr.hl = { region: R.id, data: hlKey, civ, step };
        did = true;
      }
      for (const cv of [cvs.base!, cvs.sel!, cvs.hl!]) if (cv.width) placeOnScreen(cv, vis, R.x0 + slide, R.y0, R.k);
      setCover(true);
      const w = window as unknown as { __wfCivDetail?: Record<string, unknown> };
      const ms = performance.now() - t0;
      const prev = w.__wfCivDetail;
      // 画着的那几张是按几个 CSS 像素一格上的色
      const cur = dr.base ?? dr.sel ?? dr.hl;
      w.__wfCivDetail = {
        on: true,
        k: R.k,
        w: R.view.cw,
        h: R.view.ch,
        cssW: R.view.cw / R.dpr,
        dpr: R.dpr,
        // 这一次重画了没有(没重画 = 只挪了位置;耗时留着上一次重画的)
        ms: did || !prev?.on ? ms : prev.ms,
        drew: did,
        step: (cur ? cur.step : step) / R.dpr,
        ...timing,
        exact,
        fast,
        slide,
        year: params?.year,
        proj: mp?.def.id ?? 'equirect',
        lon: R.mp?.lon0,
        // 分帧备料:备了多久、分几段(当下画完的没有);还有没有在后台备的
        prep: st?.prep ?? 0,
        slices: st?.slices ?? 0,
        pending: !!pend.current,
      };
    };

    /** 后台备料,备好了画上去(在等的旧活作废) */
    const submit = (ps: Plans, exact: boolean) => {
      pend.current = { ps, params, selKey, hlKey, civ, ready: {} };
      const job = pend.current;
      const { cw, ch } = ps.R.view;
      // 最后几步:底图、选中要重画的各一步先画在藏着的那张上,换上时对调
      const steps = stepsOf(ps);
      const { base, sel: s } = ps;
      if (base && base !== 'keep')
        steps.push(() => {
          const ctx = pend.current === job ? bf.base.back(cw, ch) : null;
          if (ctx) job.ready.base = base.draw(ctx);
        });
      if (s && s !== 'keep')
        steps.push(() => {
          const ctx = pend.current === job ? bf.sel.back(cw, ch) : null;
          if (ctx) job.ready.sel = s.draw(ctx);
        });
      const drop = () => {
        bf.base.rest();
        bf.sel.rest();
      };
      submitDetailJob(JOB, steps, (st) => {
        if (pend.current !== job) return;
        pend.current = null;
        const vis = visibleBox(box);
        if (!vis) return drop();
        // 备料期间中心又转了(还在拖):按现在的中心平移过去;对不上就不画了(下一次重画会再备)
        const R = ps.R;
        const now = live.current;
        const slide = !R.mp ? 0 : now.mp && R.proj === now.mp.key ? 0 : now.mp && now.moving ? slideOf(R, now.mp, vis) : null;
        if (slide !== null) paint(ps, vis, exact, slide, st, job.ready);
        else {
          drop();
          const g = window as unknown as { __wfCivDetail?: Record<string, unknown> };
          if (g.__wfCivDetail) g.__wfCivDetail.pending = false;
        }
      });
      const g = window as unknown as { __wfCivDetail?: Record<string, unknown> };
      // 还没画上去过:倍数报在备的这一份的(画上去以后同样报这个)
      if (!g.__wfCivDetail) g.__wfCivDetail = { on: false, k: ps.R.k, pending: true };
      else {
        g.__wfCivDetail.pending = true;
        if (!g.__wfCivDetail.on) g.__wfCivDetail.k = ps.R.k;
      }
    };
    /** 在备的那一份还能用:同一个世界、地图框没变大小(第一次放大还没画上去时也可能变)、同一份数据、要画的那几张一样,格不比要的粗 */
    const pendOk = (p: Pending | null, R: Region, vis: Visible, step: number) =>
      !!p &&
      p.ps.R === R &&
      R.world === world &&
      R.raster === raster &&
      R.bw === vis.bw &&
      p.params === params &&
      p.selKey === selKey &&
      p.hlKey === hlKey &&
      p.civ === civ &&
      p.ps.step <= step &&
      (p.ps.base === null) === !(wantBase && params) &&
      (p.ps.sel === null) === !(wantSel && civ) &&
      (p.ps.hl === null) === !(wantHl && civ);

    const draw = (exact: boolean) => {
      const vis = visibleBox(box);
      if (!vis) return off();
      const d0 = region.current;
      const d = d0 && d0.world === world && d0.raster === raster && d0.bw === vis.bw ? d0 : null;
      const precise = !!d && d.proj === projKey;
      // 弯边投影里正在转中心、放大得不够:平移对不齐,先藏起来(画布留着),停下来再画
      if (mp && moving && !precise && vis.k < SLIDE_K) return off(false);
      const dx = shiftOf(d, exact, vis);
      const R = d && dx !== null && fits(d, vis, exact, dx) ? d : null;
      const slide = R ? dx! : 0;
      // 拖动、缩放中(视图和上一次不一样)或回放中:粗一点的格
      const interacting = !exact && (lastView.current !== viewNow || moving);
      lastView.current = viewNow;
      // 当下画完:没开分帧;换了世界、地图框变了大小(被藏起来的整张图还是旧的,不能露出来顶着);
      // 换了画风(旧画风的那张不能再顶着)
      const based = drawn.current.base?.data as CivDrawParams | undefined;
      if (!async || (d0 && !d) || (based && based.style !== style)) {
        cancel();
        const T = R ?? newRegion(vis);
        const ps = plansFor(T, stepOf(T, interacting), interacting);
        paint(ps, vis, exact, slide);
        return;
      }
      // 在备的那一份(弯边投影:按备的时候的中心;用不上的不算)
      const pdx = shiftOf(pend.current?.ps.R ?? null, exact, vis);
      const p = pdx === null ? null : pend.current;
      const xMax = mp ? vis.bw : 2 * vis.bw;
      if (R) {
        const step = stepOf(R, interacting);
        const ps = plansFor(R, step, interacting);
        if (anyNew(ps)) {
          // 同一块上换数据、换细格:后台备好再换(画着的那几张先顶着)
          for (const cv of [cvs.base!, cvs.sel!, cvs.hl!]) if (cv.width) placeOnScreen(cv, vis, R.x0 + slide, R.y0, R.k);
          if (!pendOk(p, R, vis, step)) submit(ps, exact);
          return;
        }
        // 不用重画:挪好位置(不要的那几张藏起来)
        paint(ps, vis, exact, slide);
        // 拖到离画好那一块的边不到半个余量:提前在后台备好下一块,往拖的方向多留一些(拖出去之前多半已经换上了);停下来了就不备
        const ahead = exact ? null : aheadOf(shifted(R, slide), vis, MARGIN, xMax, vis.bh);
        if (!ahead) cancel();
        else if (!p || !fits(p.ps.R, vis, false, pdx!) || aheadOf(shifted(p.ps.R, pdx!), vis, MARGIN, xMax, vis.bh) || !pendOk(p, p.ps.R, vis, stepOf(p.ps.R, true))) {
          const T = newRegion(vis, ahead);
          submit(plansFor(T, stepOf(T, true), true), false);
        }
        return;
      }
      // 画好的那一块用不上了:后台备新的一块,备好了整张换上
      const pOk = !!p && fits(p.ps.R, vis, exact, pdx!) && pendOk(p, p.ps.R, vis, stepOf(p.ps.R, interacting));
      // 画好的那几张先顶着要挪多少(弯边投影换了中心:按投影平移过去;差得太多 = null)
      const hold = d ? holdOf(d, vis) : null;
      if (d && (hold === null || !covers(d, vis.x0, vis.y0, vis.x1, vis.y1, hold))) {
        // 拖出了画好的那一块(太快,提前备的还没好),或者平移对不上了:等不及了,当下画完
        if (pOk) flushDetailJobs();
        else {
          cancel();
          const T = newRegion(vis);
          paint(plansFor(T, stepOf(T, interacting), interacting), vis, exact, 0);
        }
        return;
      }
      // 先用画好的那几张顶着(缩放倍数不准,按比例拉一点);还没画过的时候底下的整张图露着
      if (d) for (const cv of [cvs.base!, cvs.sel!, cvs.hl!]) if (cv.width) placeOnScreen(cv, vis, d.x0 + hold!, d.y0, d.k);
      if (!pOk) {
        const T = newRegion(vis);
        submit(plansFor(T, stepOf(T, interacting), interacting), exact);
      }
    };

    /**
     * 新的一块:看得见的那块四周各多 1/4,不超出地图;画布按屏幕像素(太大就降低像素密度)。
     * [sx, sy] = 整块往哪边挪(拖动中提前备的那一块往拖的方向挪,见 aheadOf)
     */
    function newRegion(vis: Visible, [sx, sy] = [0, 0]): Region {
      const mw = (vis.x1 - vis.x0) * MARGIN;
      const mh = (vis.y1 - vis.y0) * MARGIN;
      const x0 = Math.max(0, vis.x0 - mw + sx);
      const y0 = Math.max(0, vis.y0 - mh + sy);
      const x1 = Math.min(mp ? vis.bw : 2 * vis.bw, vis.x1 + mw + sx);
      const y1 = Math.min(vis.bh, vis.y1 + mh + sy);
      let dpr = window.devicePixelRatio || 1;
      const px = (x1 - x0) * (y1 - y0) * vis.k * vis.k;
      if (px * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / px);
      const cw = Math.max(1, Math.round((x1 - x0) * vis.k * dpr));
      const ch = Math.max(1, Math.round((y1 - y0) * vis.k * dpr));
      // 画布像素 / 世界单位(地图平面和世界一样大);画布左上角 = 地图框坐标 (x0, y0)
      const s = (vis.bw / world.width) * vis.k * dpr;
      return {
        id: ++regionSeq,
        world,
        raster,
        bw: vis.bw,
        k: vis.k,
        x0,
        y0,
        x1,
        y1,
        dpr,
        proj: projKey,
        mp,
        view: { cw, ch, s, ox: -x0 * vis.k * dpr, oy: -y0 * vis.k * dpr, k: vis.k, mp, dpr },
        cache: detailCache(),
      };
    }

    draw(false);
    // 停下来以后按准确的缩放倍数、细一点的格补画一次
    timer.current = window.setTimeout(() => draw(true), 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, raster, params, civ, style, sel, selYear, hl, view, tick, mp, moving, host]);

  if (!host) return null;
  return createPortal(
    <>
      <canvas ref={baseRef} className="civ-detail" style={{ pointerEvents: 'none', display: 'none' }} />
      <canvas ref={selRef} className="civ-detail-sel" style={{ pointerEvents: 'none', display: 'none' }} />
      <canvas ref={hlRef} className="civ-detail-hl" style={{ pointerEvents: 'none', display: 'none', opacity: 0 }} />
    </>,
    host,
  );
}

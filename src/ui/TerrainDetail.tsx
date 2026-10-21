/**
 * 放大后的地形细节层(canvas.detail,在地形图之上、文明层之下的屏幕层里,见 mapWrap.ts 的"屏幕层"):
 * 放大到 DETAIL_K 倍以上时,把视口附近那一块按屏幕像素重画(render/detail.ts)——
 * 手绘风的符号逐级变大、细节变多,写实风的河流按缩放分级;放大多少倍都不糊。
 *
 * 和文字层一样,画布只盖住看得见的那一块(外加四周各留 1/4 视口的余量),画布像素 = 屏幕像素;地图平移、缩放时按地图框的位置
 * 挪过去(placeOnScreen)。重画一次要几十毫秒,所以不是每一帧都画:
 *   - 视口还在画好的那一块里、缩放倍数和画的时候差不到 30%:不重画,只挪位置(缩放倍数变了就按比例放大一点点,看不出)
 *   - 否则重画;停下来约 0.15 秒后,再按准确的缩放倍数补画一次
 * 重画时分帧(ui/detailJobs.ts):整张图的缓存(第一次放大时最慢的那部分)在后台一小段一小段地备,
 * 这期间画好的那张接着顶着(按比例拉一点),还没画过就露着底下的地形图;备好了和文明细节层一起整张换上。
 * 拖到离画好那一块的边不到半个余量就提前备下一块(往拖的方向多留一些,不多画);真拖出去了还没备好,剩下的当下做完。
 * 画出来的和当下一口气画完的逐像素一样;地址带 detail=sync 就关掉分帧。
 * 没盖到的地方(拖得太快)露出底下的地形图(缩放 1 倍的那一份),不会出现空白。
 *
 * 弯边投影(mp,罗宾森、摩尔威德……):按投影直接在画布上重画(render/detail.ts 的 drawTerrainProjected)——
 * 面按行重投影,海岸、河逐点投影,符号在投影后的位置上正立、按屏幕大小画,放大多少倍都不糊。
 * 同样分帧:按这个中心逐点投影、重铺的缓存(terrainProjPrep)也在后台备;备的时候画好的那一块按投影平移着顶着
 * (停下来以后也是,差出 HOLD_ERR 像素以上才当下画完),备好了按那时的中心平移到位换上。
 *
 * 转中心(左右拖动、选中后地图飞过去)时整张图都在变,但放大以后视口里纬度跨得不大,转中心约等于整块左右平移:
 *   - 放大到 SLIDE_K 倍以上:画好的那一块按视口中间那条纬线的比例整体左右挪过去(只改 CSS 位置,不重画);
 *     挪出了画好的那一块、或视口上下边和真实投影差出 SLIDE_ERR 像素以上,就按新中心马上重画;停下来再按准确的中心补画
 *   - 放大不到 SLIDE_K 倍:视口里纬度跨得大,平移对不齐 —— 先藏起来(露出底下的地形图,这时它本来就不太糊),停下来再画
 * 拖动时画布一直是同一张(不释放、不重建),只在缩小到 DETAIL_K 以下、换成数据图层时才释放显存。
 *
 * 写实风、等距圆柱再放大一些(一个世界单位占 TILE_MIN_S 个屏幕像素左右以上):地形连河按屏幕现算(ui/terrainTiles.ts,后台线程)——
 * 一块块盖在这张画布上。停下来才要块,算好一块淡入一块;拖动、缩放时已有的块跟着挪,
 * 换了一档缩放,上一档的块留到这一档看得见的都齐了再撤。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { World } from '../gen/world';
import type { Raster } from '../gen/raster';
import { DETAIL_K, drawTerrainDetail, drawTerrainProjected, terrainDetailPrep, terrainProjPrep, type DetailStyle } from '../render/detail';
import { aheadOf, cancelDetailJob, DetailBuffer, detailAsync, flushDetailJobs, submitDetailJob, type JobStats, type WorkStep } from './detailJobs';
import { TILE, tileCanvas, tileKey, tilesAvailable, tileStats, tilesWorld, wantTiles } from './terrainTiles';
import { centerShift, type MapProj } from '../render/projection';
import { mapBoxOf, placeOnScreen, visibleBox, watchMapBox, type Visible } from './mapWrap';
import { useMapMoving } from './projection';
import type { SurfaceLook } from '../render/surface';

/** 画好的那一块(地图框 CSS 坐标,缩放前)和画的时候的缩放倍数 */
interface Drawn {
  world: World;
  raster: Raster;
  style: string;
  look: SurfaceLook;
  k: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  dpr: number;
  /** 弯边投影:按哪个投影 + 中心画的(等距圆柱 = '') */
  proj: string;
  mp: MapProj | null;
}

/** 画布最多多少像素(约 48 MB 显存);超了就降低像素密度 */
const MAX_PIXELS = 12e6;
/** 四周多画的余量(占看得见那一块的比例) */
const MARGIN = 0.25;
/** 缩放倍数变了多少以内不重画 */
const K_SLACK = Math.log(1.3);
/** 弯边投影里转中心时:放大到几倍以上才让画好的那一块跟着左右平移(以下先藏起来) */
const SLIDE_K = 3;
/** 平移和真实投影在视口上下边最多差几个 CSS 像素(超了就按新中心重画) */
const SLIDE_ERR = 8;
/** 按新中心重画的那一块在后台备料时,画好的那块平移着先顶着:允许差到几个 CSS 像素(更大就当下画完) */
const HOLD_ERR = 3 * SLIDE_ERR;

/** 分帧备料时这一层的名字(见 detailJobs.ts) */
const JOB = 'terrain';

/**
 * 卸下时收拾(给 useEffect 当清理函数用)。清理函数在这里(模块里)建:要是在组件那一次渲染里建,
 * 它会一直拉住挂上那一刻的世界、主图,换了世界也放不掉
 */
function unmountDetail(timer: { current: number }, buf: { current: DetailBuffer | null }) {
  return () => {
    window.clearTimeout(timer.current);
    cancelDetailJob(JOB);
    buf.current?.dispose();
    buf.current = null;
  };
}

/** 现算的块:S 像素 / 世界单位,按屏幕像素取最近的 2 的幂;不到 TILE_MIN_S 不现算(拉大的像素层不太糊),最多 TILE_MAX_S */
const TILE_MIN_S = 2;
const TILE_MAX_S = 16;

/** 一档缩放的块:一个容器(按这一档的比例缩放)+ 放上去的块(键 = 展开的列/行;只留看得见的) */
interface TileLevel {
  /** 档的编号(S 和河的缩放倍数 k) */
  id: string;
  S: number;
  k: number;
  div: HTMLDivElement;
  shown: Map<string, HTMLCanvasElement>;
}

/**
 * 弯边投影:按 d.mp 画好的那一块换到新中心 mp 时,整体左右平移多少(地图框 CSS 像素,缩放前);
 * 不是同一种投影、或视口上下边和真实投影差太多 = null(要重画)
 */
function slideOf(d: Drawn, mp: MapProj, vis: Visible, maxErr = SLIDE_ERR): number | null {
  const from = d.mp;
  if (!from || from.def !== mp.def || from.W !== mp.W || from.H !== mp.H) return null;
  // 地图平面单位 / 地图框 CSS 像素
  const ux = mp.W / vis.bw;
  const uy = mp.H / vis.bh;
  const { dx, err } = centerShift(from, mp, vis.y0 * uy, vis.y1 * uy);
  return (err / ux) * vis.k <= maxErr ? dx / ux : null;
}

export function TerrainDetail({
  world,
  raster,
  style,
  look = 'classic',
  view,
  mp = null,
}: {
  world: World;
  raster: Raster;
  style: string;
  /** 写实风的画法(surface.ts) */
  look?: SurfaceLook;
  view: { k: number; x: number; y: number };
  /** 弯边投影(当前投影 + 中心);等距圆柱 = null */
  mp?: MapProj | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tilesRef = useRef<HTMLDivElement>(null);
  const levels = useRef<Map<string, TileLevel>>(new Map());
  /** 现在这一档、看得见的块(列已展开)、它们放在哪个世界上 */
  const tileView = useRef<{ id: string; want: { tx: number; ty: number }[]; world: World; look: SurfaceLook } | null>(null);
  const drawn = useRef<Drawn | null>(null);
  /** 在后台备料、还没画上去的那一块(见 detailJobs.ts) */
  const pend = useRef<Drawn | null>(null);
  /** 画布两张:显示着的和藏着的(备料的最后一步画在藏着的那张上,换上时对调,见 detailJobs.ts) */
  const buf = useRef<DetailBuffer | null>(null);
  /** 藏着的那张画好了哪一块(在备的那一块画完了 = pend.current;没有 = null) */
  const ready = useRef<Drawn | null>(null);
  const timer = useRef(0);
  const moving = useMapMoving();
  /** 现在的投影 + 中心、是不是正在转中心(后台备好的那一块画上去时按它摆) */
  const live = useRef({ mp, moving });
  live.current = { mp, moving };

  // 地图框大小变了(窗口缩放)也要重画
  const [tick, setTick] = useState(0);
  useEffect(() => watchMapBox(ref.current, setTick), []);
  useEffect(() => unmountDetail(timer, buf), []);

  useLayoutEffect(() => {
    const el = ref.current;
    const tl = tilesRef.current;
    const box = mapBoxOf(el);
    if (!el || !tl || !box) return;
    const bf = (buf.current ??= new DetailBuffer(el));
    window.clearTimeout(timer.current);
    /** 在后台备的那一块不要了 */
    const cancel = () => {
      if (!pend.current) return;
      pend.current = null;
      ready.current = null;
      bf.rest();
      cancelDetailJob(JOB);
      const g = window as unknown as { __wfDetail?: Record<string, unknown> };
      if (g.__wfDetail?.pending) g.__wfDetail.pending = false;
    };
    /** 现算的块全部撤掉(换了世界、画风、投影,或缩小到不现算) */
    const clearTiles = () => {
      for (const lv of levels.current.values()) lv.div.remove();
      levels.current.clear();
      tileView.current = null;
      if (tl.style.display !== 'none') tl.style.display = 'none';
    };
    /** release = false:只藏起来,画布留着(拖动中;停下来接着用这一张,不重新分配) */
    const hide = (release = true) => {
      cancel();
      const cv = bf.front;
      if (cv.style.display !== 'none') cv.style.display = 'none';
      if (release && cv.width) cv.width = cv.height = 0; // 释放显存(几十 MB)
      if (release) bf.drop();
      if (release) clearTiles();
      else if (tl.style.display !== 'none') tl.style.display = 'none';
      drawn.current = null;
      (window as unknown as { __wfDetail?: unknown }).__wfDetail = { on: false, k: view.k };
    };
    if ((style !== 'fantasy' && style !== 'realistic') || view.k <= DETAIL_K) return hide();
    // 写实风、等距圆柱:地形连河按屏幕现算一块块(后台线程能用时;放大到细节层才起线程)
    const tiled = style === 'realistic' && !mp && tilesAvailable();
    if (!tiled) clearTiles();
    else if (tileView.current && (tileView.current.world !== world || tileView.current.look !== look)) clearTiles();
    const projKey = mp ? mp.key : '';

    /** 一块放上去(fade:刚算好的淡入;缓存里拿的直接显示) */
    const showTile = (lv: TileLevel, tx: number, ty: number, nx: number, fade: boolean) => {
      const dk = `${tx}/${ty}`;
      if (lv.shown.has(dk)) return true;
      const src = tileCanvas(tileKey(lv.S, lv.k, ((tx % nx) + nx) % nx, ty));
      if (!src) return false;
      const c = document.createElement('canvas');
      c.width = c.height = TILE;
      c.getContext('2d')!.drawImage(src, 0, 0);
      c.className = fade ? 'tile fade' : 'tile';
      c.style.left = `${tx * TILE}px`;
      c.style.top = `${ty * TILE}px`;
      lv.div.appendChild(c);
      lv.shown.set(dk, c);
      if (fade) requestAnimationFrame(() => requestAnimationFrame(() => c.classList.remove('fade')));
      return true;
    };

    /**
     * 现算的块:按这一次的视口定档、挪容器、放上缓存里有的;停下来(exact)才向后台要缺的。
     * 这一档看得见的都齐了,别的档撤掉
     */
    const updateTiles = (vis: Visible, exact: boolean) => {
      if (!tiled) return;
      tilesWorld(world, raster, look);
      const perUnit = (vis.bw / world.width) * vis.k; // 屏幕 CSS 像素 / 世界单位
      const S = Math.min(TILE_MAX_S, 2 ** Math.round(Math.log2(Math.max(perUnit, 1e-6))));
      if (S < TILE_MIN_S) {
        clearTiles();
        return;
      }
      // 河按这一档一个像素 = 一个屏幕像素时的缩放倍数画(取到 2 的 1/8 次方一档:同一档的块缓存着,不随 k 细调;
      // 地图框变宽变窄换一档,旧的块不接着用)
      const kl = 2 ** (Math.round(Math.log2((S * world.width) / vis.bw) * 8) / 8);
      if (tl.style.display === 'none') tl.style.display = '';
      const ls = levels.current;
      const id = `${S}/${kl}`;
      let lv = ls.get(id);
      if (!lv) {
        const div = document.createElement('div');
        div.className = 'tile-level';
        tl.appendChild(div);
        lv = { id, S, k: kl, div, shown: new Map() };
        ls.set(id, lv);
      }
      // 这一档在最上面
      if (tl.lastChild !== lv.div) tl.appendChild(lv.div);
      for (const l of ls.values()) {
        const f = (vis.k * vis.bw) / (world.width * l.S);
        l.div.style.transform = `translate(${vis.ox}px, ${vis.oy}px) scale(${f})`;
      }
      // 看得见的块(地图框 CSS 坐标 → 这一档的像素;列可以伸到右边接的那一份里)
      const W = Math.round(world.width * S);
      const H = Math.round(world.height * S);
      const nx = W / TILE;
      const ny = Math.ceil(H / TILE);
      const ux = W / vis.bw;
      const uy = H / vis.bh;
      const tx0 = Math.floor((vis.x0 * ux) / TILE);
      const tx1 = Math.floor((vis.x1 * ux - 1e-6) / TILE);
      const ty0 = Math.max(0, Math.floor((vis.y0 * uy) / TILE));
      const ty1 = Math.min(ny - 1, Math.floor((vis.y1 * uy - 1e-6) / TILE));
      const cx = ((vis.x0 + vis.x1) / 2) * ux;
      const cy = ((vis.y0 + vis.y1) / 2) * uy;
      const want: { tx: number; ty: number; d: number }[] = [];
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) want.push({ tx, ty, d: Math.hypot((tx + 0.5) * TILE - cx, (ty + 0.5) * TILE - cy) });
      want.sort((a, b) => a.d - b.d);
      // 挪出视口的块撤掉(拖远了不越攒越多;挪回来从缓存里拿)
      const keep = new Set(want.map((t) => `${t.tx}/${t.ty}`));
      for (const [dk, c] of lv.shown)
        if (!keep.has(dk)) {
          c.remove();
          c.width = c.height = 0;
          lv.shown.delete(dk);
        }
      let missing = 0;
      for (const t of want) if (!showTile(lv, t.tx, t.ty, nx, false)) missing++;
      tileView.current = { id, want, world, look };
      if (!missing) dropOtherLevels(id);
      if (exact && missing) {
        const level = lv;
        wantTiles(
          want.map((t) => ({ S, tx: ((t.tx % nx) + nx) % nx, ty: t.ty, k: kl })),
          (key) => {
            if (key === null) {
              // 后台线程停掉了:撤掉块,画布按拉大整张图重画(连小溪)
              drawn.current = null;
              setTick((n) => n + 1);
              return;
            }
            const tv = tileView.current;
            if (!tv || tv.id !== level.id || levels.current.get(level.id) !== level) return;
            let left = 0;
            for (const t of tv.want) if (!showTile(level, t.tx, t.ty, nx, true)) left++;
            if (!left) dropOtherLevels(level.id);
            reportTiles();
          },
        );
      }
      reportTiles();
    };
    /** 只留这一档(等最后一块淡入完再撤,免得闪一下) */
    const dropOtherLevels = (id: string) => {
      for (const [s, l] of levels.current) {
        if (s === id) continue;
        levels.current.delete(s);
        window.setTimeout(() => l.div.remove(), 400);
      }
    };
    const reportTiles = () => {
      const tv = tileView.current;
      const lv = tv && levels.current.get(tv.id);
      const g = window as unknown as { __wfDetail?: Record<string, unknown> };
      if (g.__wfDetail) g.__wfDetail.tiles = tv && lv ? { S: lv.S, want: tv.want.length, shown: lv.shown.size, ...tileStats() } : null;
    };

    /**
     * 看得见的那一块(地图框 CSS 坐标)和当前缩放倍数;看不见返回 null。
     * 可以伸到地图框右边接的那一份里(x 到 2 × 地图框宽,见 mapWrap.ts)
     */
    const visible = () => visibleBox(box);
    /** 分帧备料(见 detailJobs.ts);关掉开关时当下画完 */
    const async = detailAsync;

    /** d 这一块(整体左右挪 dx)盖住 [x0, x1] × [y0, y1] 没有 */
    const covers = (d: Drawn, x0: number, y0: number, x1: number, y1: number, dx = 0) =>
      d.x0 + dx <= x0 + 0.5 && d.y0 <= y0 + 0.5 && d.x1 + dx >= x1 - 0.5 && d.y1 >= y1 - 0.5;
    /** 画好的(或在备的)那一块能接着用:盖得住看得见的那一块,缩放倍数差得不多(停下来补画时要准) */
    const fits = (d: Drawn, vis: Visible, exact: boolean, dx = 0) =>
      covers(d, vis.x0, vis.y0, vis.x1, vis.y1, dx) && Math.abs(Math.log(vis.k / d.k)) < (exact ? 0.02 : K_SLACK);
    /** 同一个世界、同一种画风画的 */
    const same = (d: Drawn | null) => (d && d.world === world && d.raster === raster && d.style === style && d.look === look ? d : null);
    /**
     * 画好的(或在备的)那一块要左右挪多少才对得上(地图框 CSS 像素):同一个投影 + 中心 = 0;
     * 弯边投影正在转中心 = 按投影整体平移(停下来要准,不算);null = 用不上,要按新中心重画
     */
    const shiftOf = (d: Drawn | null, exact: boolean, vis: Visible) =>
      !d ? null : d.proj === projKey ? 0 : mp && moving && !exact ? slideOf(d, mp, vis) : null;
    /** 后台备新的一块时,画好的那块先顶着要挪多少(停下来了也先平移着顶着,差得太多 = null) */
    const holdOf = (d: Drawn, vis: Visible) => (d.proj === projKey ? 0 : mp ? slideOf(d, mp, vis, HOLD_ERR) : null);
    /** 挪了 dx 的 d(提前备下一块时按它算离边多远) */
    const shifted = (d: Drawn, dx: number) => ({ x0: d.x0 + dx, y0: d.y0, x1: d.x1 + dx, y1: d.y1 });

    /**
     * 新的一块:多画的余量四周各 1/4 视口,不超出地图;画布按屏幕像素(太大就降低像素密度)。
     * [sx, sy] = 整块往哪边挪(拖动中提前备的那一块往拖的方向挪,见 aheadOf;挪得不超过余量,还是盖得住看得见的那一块)
     */
    const regionOf = (vis: Visible, [sx, sy] = [0, 0]): Drawn => {
      const mw = (vis.x1 - vis.x0) * MARGIN;
      const mh = (vis.y1 - vis.y0) * MARGIN;
      const x0 = Math.max(0, vis.x0 - mw + sx);
      const y0 = Math.max(0, vis.y0 - mh + sy);
      const x1 = Math.min(mp ? vis.bw : 2 * vis.bw, vis.x1 + mw + sx);
      const y1 = Math.min(vis.bh, vis.y1 + mh + sy);
      let dpr = window.devicePixelRatio || 1;
      const px = (x1 - x0) * (y1 - y0) * vis.k * vis.k;
      if (px * dpr * dpr > MAX_PIXELS) dpr = Math.sqrt(MAX_PIXELS / px);
      return { world, raster, style, look, k: vis.k, x0, y0, x1, y1, dpr, proj: projKey, mp };
    };

    /** r 这一块的画布多大(画布像素) */
    const sizeOf = (r: Drawn) => [Math.max(1, Math.round((r.x1 - r.x0) * r.k * r.dpr)), Math.max(1, Math.round((r.y1 - r.y0) * r.k * r.dpr))];

    /** 把 r 这一块画到 ctx 上(画布 W × H,先清空;bw = 地图框宽,creeks = 连小溪画) */
    const drawRegion = (ctx: CanvasRenderingContext2D, r: Drawn, bw: number, W: number, H: number, creeks: boolean) => {
      const { x0, y0, x1, k, dpr } = r;
      const s = (bw / world.width) * k * dpr; // 画布像素 / 世界单位
      const v = { s, ox: -x0 * k * dpr, oy: -y0 * k * dpr, k };
      if (r.mp) {
        // 弯边投影:按投影直接在画布上重画(面按行重投影,线逐点投影、符号正立按屏幕大小画),不是把像素拉大
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, W, H);
        // 地图平面和世界一样大:画布像素 / 地图平面单位 = s,偏移同等距圆柱
        drawTerrainProjected(ctx, world, raster, style as DetailStyle, r.mp, v, look);
      } else if (x0 < bw && x1 > bw) {
        // 这一块跨过主图的右边(180° 经线):左右两段各画一遍(右段 = 挪一整圈),各自裁在自己那一段里,
        // 接缝处的符号、河不会画两遍叠深
        const seam = (bw - x0) * k * dpr;
        ctx.clearRect(0, 0, W, H);
        for (const [c0, c1, shift] of [
          [0, seam, 0],
          [seam, W, world.width * s],
        ]) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(c0, 0, c1 - c0, H);
          ctx.clip();
          drawTerrainDetail(ctx, world, raster, style as DetailStyle, { ...v, ox: v.ox + shift }, creeks, look);
          ctx.restore();
        }
      } else {
        // 整块都在右边接的那一份里:挪回一整圈画
        const shift = x0 >= bw ? world.width * s : 0;
        drawTerrainDetail(ctx, world, raster, style as DetailStyle, { ...v, ox: v.ox + shift }, creeks, look);
      }
    };

    /**
     * 把 r 这一块画到画布上、摆好(左右挪 slide;st = 分帧备料的统计;
     * swap = 藏着的那张已经画好了这一块(备料的最后一步画的),对调上来就行)
     */
    const paint = (r: Drawn, vis: Visible, exact: boolean, st?: JobStats, slide = 0, swap = false) => {
      const t0 = performance.now();
      const { x0, y0, k, dpr } = r;
      const [W, H] = sizeOf(r);
      if (swap) bf.swap();
      const cv = bf.front;
      if (cv.width !== W || cv.height !== H) {
        cv.width = W;
        cv.height = H;
      }
      Object.assign(cv.style, { display: '', width: `${W / dpr}px`, height: `${H / dpr}px` });
      placeOnScreen(cv, vis, x0 + slide, y0, k);
      if (!swap) drawRegion(cv.getContext('2d')!, r, vis.bw, W, H, !tileView.current);
      drawn.current = r;
      (window as unknown as { __wfDetail?: unknown }).__wfDetail = {
        on: true,
        k,
        ms: performance.now() - t0,
        w: W,
        h: H,
        exact,
        proj: r.mp?.def.id ?? 'equirect',
        lon: r.mp?.lon0,
        slide,
        // 分帧备料:备了多久、分几段(当下画完的没有)
        prep: st?.prep ?? 0,
        slices: st?.slices ?? 0,
      };
      reportTiles();
    };

    /** 后台备料,备好了画 r(在等的旧活作废);bw = 地图框宽(同 paint 里画布像素 / 世界单位的算法) */
    const submit = (r: Drawn, bw: number, exact: boolean) => {
      pend.current = r;
      ready.current = null;
      const s = (bw / world.width) * r.k * r.dpr;
      const creeks = !tileView.current;
      // 画布大小、变换同 paint
      const [W, H] = sizeOf(r);
      let steps: WorkStep[];
      if (r.mp) steps = terrainProjPrep(world, raster, style as DetailStyle, r.mp, { s, ox: -r.x0 * r.k * r.dpr, oy: -r.y0 * r.k * r.dpr, k: r.k }, W, H, look);
      else steps = terrainDetailPrep(world, raster, style as DetailStyle, s, creeks, look);
      // 最后一步:先画在藏着的那张上,换上时对调
      steps = [
        ...steps,
        () => {
          if (pend.current !== r) return;
          const ctx = bf.back(W, H);
          if (!ctx) return;
          drawRegion(ctx, r, bw, W, H, creeks);
          ready.current = r;
        },
      ];
      submitDetailJob(JOB, steps, (st) => {
        if (pend.current !== r) return;
        pend.current = null;
        // 藏着的那张是按备料时的地图框宽、小溪开关画的:变了就当下重画
        const vis = visible();
        const ok = ready.current === r && !!vis && vis.bw === bw && creeks === !tileView.current;
        ready.current = null;
        if (!ok) bf.rest();
        if (!vis) return;
        // 备料期间中心又转了(还在拖):按现在的中心平移过去;对不上就不画了(下一次重画会再备)
        const now = live.current;
        const slide = !r.mp ? 0 : now.mp && r.proj === now.mp.key ? 0 : now.mp && now.moving ? slideOf(r, now.mp, vis) : null;
        if (slide !== null) paint(r, vis, exact, st, slide, ok);
        else {
          bf.rest();
          const g = window as unknown as { __wfDetail?: Record<string, unknown> };
          if (g.__wfDetail) g.__wfDetail.pending = false;
        }
      });
      const g = window as unknown as { __wfDetail?: Record<string, unknown> };
      // 还没画上去过:倍数报在备的这一份的(画上去以后同样报这个)
      if (!g.__wfDetail) g.__wfDetail = { on: false, k: r.k, pending: true };
      else {
        g.__wfDetail.pending = true;
        if (!g.__wfDetail.on) g.__wfDetail.k = r.k;
      }
    };

    const draw = (exact: boolean) => {
      const vis = visible();
      if (!vis) return hide();
      // 现算的块先要(后台线程马上开工),再画这张画布
      updateTiles(vis, exact);
      const d = same(drawn.current);
      const precise = !!d && d.proj === projKey;
      // 弯边投影里正在转中心、放大得不够:平移对不齐,先藏起来(画布留着),停下来再画
      if (mp && moving && !precise && vis.k < SLIDE_K) return hide(false);
      // 画好的那一块要左右挪多少才对得上(地图框 CSS 像素):中心没变 = 0;正在转中心 = 按投影整体平移;null = 要重画
      const dx = shiftOf(d, exact, vis);
      // 在备的那一块(弯边投影:按备的时候的中心;用不上的不算)
      const p0 = async ? same(pend.current) : null;
      const pdx = shiftOf(p0, exact, vis);
      const p = pdx === null ? null : p0;
      const xMax = mp ? vis.bw : 2 * vis.bw;
      if (d && dx !== null && fits(d, vis, exact, dx)) {
        placeOnScreen(bf.front, vis, d.x0 + dx, d.y0, d.k);
        if (dx) (window as unknown as { __wfDetail?: unknown }).__wfDetail = { on: true, k: d.k, slide: dx, proj: mp?.def.id ?? 'equirect', lon: mp?.lon0 };
        reportTiles();
        if (!async) return;
        // 拖到离画好那一块的边不到半个余量:提前在后台备好下一块,往拖的方向多留一些(拖出去之前多半已经换上了);停下来了就不备
        const ahead = exact ? null : aheadOf(shifted(d, dx), vis, MARGIN, xMax, vis.bh);
        if (!ahead) cancel();
        else if (!p || !fits(p, vis, false, pdx!) || aheadOf(shifted(p, pdx!), vis, MARGIN, xMax, vis.bh)) submit(regionOf(vis, ahead), vis.bw, false);
        return;
      }
      if (!async) {
        cancel();
        return paint(regionOf(vis), vis, exact);
      }
      // 分帧:要重画的那一块在后台备料,备好了整张换上
      const pOk = !!p && fits(p, vis, exact, pdx!);
      // 画好的那张先顶着要挪多少(弯边投影换了中心:按投影平移过去;差得太多 = null)
      const hold = d ? holdOf(d, vis) : null;
      if (d && (hold === null || !covers(d, vis.x0, vis.y0, vis.x1, vis.y1, hold))) {
        // 拖出了画好的那一块(太快,提前备的还没好),或者平移对不上了:等不及了,当下画完
        if (pOk) flushDetailJobs();
        else {
          cancel();
          paint(regionOf(vis), vis, exact);
        }
        return;
      }
      // 先用画好的那张顶着(缩放倍数不准,按比例拉一点);换了画风、世界的那张不能再露出来,藏起来露出底下的整张图
      if (d) placeOnScreen(bf.front, vis, d.x0 + hold!, d.y0, d.k);
      else if (drawn.current) {
        bf.front.style.display = 'none';
        drawn.current = null;
      }
      if (!pOk) submit(regionOf(vis), vis.bw, exact);
      reportTiles();
    };
    draw(false);
    // 停下来以后按准确的缩放倍数补画一次
    timer.current = window.setTimeout(() => draw(true), 150);
  }, [world, raster, style, look, view, tick, mp, moving]);

  return (
    <>
      <canvas ref={ref} className="detail" style={{ pointerEvents: 'none', display: 'none' }} />
      <div ref={tilesRef} className="detail-tiles" style={{ display: 'none' }} />
    </>
  );
}

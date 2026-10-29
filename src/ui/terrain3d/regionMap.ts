/**
 * 地区图(框一块,单独画成一页)的组装:
 *   1. 地形:后台线程现算细地形(和立体共用 jobs.ts 那组线程;写实照放大地图的画法、带小溪,手绘按这一块重画),
 *      先出四分之一细的一档(不到一秒),再算细的(进度一条一条报);现算的海拔顺手交回来找山峰
 *   2. 文明底图、字:主线程用 render/shot.ts 的 MapShot 画(render/regionMap.ts 的 regionArea:字按放大 2.2 倍的样子长、
 *      州界州名和镇村关故城都写、写实的国家颜色淡一半),山峰 ▲ 海拔和地名一起排
 *   3. 四周:render/regionMap.ts 的 drawRegionPage(标题能改,改了只重画四周)
 * 屏幕上看的和导出 2 倍是同一张(D = 2);导出 4 倍按 D = 4 整个重画。
 */
import type { World } from '../../gen/world';
import type { Raster } from '../../gen/raster';
import type { Civ } from '../../gen/civ/types';
import type { LayerId } from '../../render/layers';
import type { CivShow, CivStyle } from '../../render/civ/overlay';
import type { SurfaceLook } from '../../render/surface';
import type { SettlementKind } from '../../render/civ/settlements';
import type { LabelItem } from '../../render/labels/draw';
import { MapShot, type ShotScene } from '../../render/shot';
import { drawRegionPage, findPeaks, MARK_ORDER, pageChars, peakItems, regionArea, regionPage, terrainScale, type LegendLine, type Peak, type RegionPage } from '../../render/regionMap';
import type { ReliefLook } from '../../render/terrain3d/relief';
import { boxStyle } from '../../render/terrain3d/fantasyBox';
import type { ReliefBox } from '../../render/terrain3d/box';
import { ensureFonts } from '../../render/labels/fonts';
import { detailPen } from '../../render/civ/detail';
import { strokeBorders } from '../../render/civ/borders';
import { strokeRegionLines } from '../../render/civ/debug';
import { strokeRoutes, routeLines } from '../../render/civ/routes';
import { realisticRiverStyle } from '../../render/realistic';
import { fantasyBoxRiverStyle } from '../../render/fantasy';
import { ownersAt } from '../../gen/civ/timeline';
import { polityName } from '../../gen/civ/growth';
import { reliefImage, reliefPrepare, type ReliefImage } from './jobs';

/** 要画的这一页 */
export interface RegionInput {
  world: World;
  raster: Raster;
  /** 地图上的文字用的(套过改名) */
  civ: Civ;
  style: CivStyle;
  look: SurfaceLook;
  layer: LayerId;
  show: CivShow;
  year: number;
  box: ReliefBox;
  /** 画布像素 / 页面 CSS 像素(屏幕上、导出 2 倍 = 2;导出 4 倍 = 4) */
  D: number;
  phone: boolean;
}

/** 画好的地图(四周另画) */
export interface RegionMap {
  input: RegionInput;
  page: RegionPage;
  /** 地图(page.mapW × page.mapH CSS 像素 × D):地形 + 文明底图 + 字 */
  map: HTMLCanvasElement;
  /** 地形那一层(同样大;只换了填色、改名时不用重算地形)和它是哪一块、哪种上色 */
  terrain: HTMLCanvasElement;
  terrainKey: string;
  /** 细的一档画好了(false = 先出来的粗的) */
  fine: boolean;
  peaks: Peak[];
  /** 图例:这一页上有的城镇符号、线 */
  marks: SettlementKind[];
  lines: LegendLine[];
  /** 框里有哪几国(按州数,多的在前) */
  countries: string[];
  /** 各步多少毫秒(调试) */
  ms: Record<string, number>;
}

/** 地区图的画风:写实、手绘照地图;数据底图按写实画(地形按卫星) */
export function regionStyle(style: CivStyle): CivStyle {
  return style === 'fantasy' ? 'fantasy' : 'realistic';
}

/** 地形用哪种上色(同立体:写实照它自己的画法,地理图叠了填色的那份按地理图;手绘按手绘;别的按卫星) */
function terrainLook(style: CivStyle, look: SurfaceLook): ReliefLook {
  if (style === 'fantasy') return 'fantasy';
  if (style !== 'realistic') return 'detail';
  return look === 'geoMute' ? 'geo' : look;
}

const makeCanvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(h)) });

/**
 * 画这一页的地图。粗的一档画好先交一次(onMap),细的画好再交一次;中途不要了(alive() = false)就停下、返回 null。
 * progress:细的一档算到几成(0–1)。coarse = false:不出粗的(导出)
 */
export async function buildRegionMap(
  inp: RegionInput,
  opt: { onMap?: (m: RegionMap) => void; progress?: (f: number) => void; alive: () => boolean; coarse?: boolean; reuse?: RegionMap | null },
): Promise<RegionMap | null> {
  const { world, raster, civ, box, D } = inp;
  const style = regionStyle(inp.style);
  const W = world.width;
  const H = world.height;
  const ms: Record<string, number> = {};
  let t = performance.now();
  const lap = (k: string) => {
    const n = performance.now();
    ms[k] = Math.round(n - t);
    t = n;
  };
  const page = regionPage(box, H);
  const MW = Math.round(page.mapW * D);
  const MH = Math.round(page.mapH * D);
  const S = terrainScale(box, MW, MH);
  const look = terrainLook(inp.style, inp.look);
  const bstyle = boxStyle(box, H, false, S);
  const terrainKey = `${box.cx},${box.cy},${box.w},${box.h}|${look}|${D}|${world.params.seed}`;
  // 只换了填色、改名(地形一样):接着用画好的地形和山峰
  const reuse = opt.reuse && opt.reuse.terrainKey === terrainKey && opt.reuse.input.world === world && opt.reuse.terrain.width === MW ? opt.reuse : null;
  if (!reuse && !reliefPrepare(world, raster, inp.phone)) return null;
  // 地形先发出去(后台线程算),主线程趁这工夫画文明底图
  const wantCoarse = opt.coarse !== false && !reuse;
  const coarseJob = wantCoarse ? reliefImage(box, Math.max(1, S / 4), look, 'elev', H, bstyle) : null;
  const fineJob = wantCoarse || reuse ? null : reliefImage(box, S, look, 'elev', H, bstyle, (n, of) => opt.progress?.(n / of));

  const extra: LabelItem[] = [];
  const area = regionArea(box, W, H, MW, D, style, extra);
  const scene: ShotScene = {
    world,
    raster,
    civ,
    style,
    layer: inp.layer,
    look: inp.look,
    show: { ...inp.show, regions: true, routes: true, labels: true, wars: false, plague: false, habitat: false, sites: false },
    markChars: '▲0123456789',
  };
  const shot = new MapShot(scene, area, MW, MH);
  const civC = makeCanvas(MW, MH);
  await shot.prepare();
  if (!opt.alive()) return dispose();
  await shot.draw(civC.getContext('2d')!, inp.year, { only: 'civ' });
  lap('civ');
  const countries = countriesIn(inp);
  const lines = legendLines(inp, style, area.civK ?? area.k, area.civAlpha ?? 1, (MW / (area.x1 - area.x0)) / D);
  const terrain = reuse ? reuse.terrain : makeCanvas(MW, MH);
  const map = makeCanvas(MW, MH);
  let shownPeaks: Peak[] | null = null;

  /** 地形换了一档(img;接着用画好的地形时不给):铺上地形(东西方向收回去)、叠文明底图、排字 */
  const compose = async (img: ReliefImage | null, fine: boolean): Promise<RegionMap> => {
    let peaks = reuse?.peaks ?? [];
    if (img) {
      const tc = terrain.getContext('2d')!;
      tc.imageSmoothingEnabled = true;
      tc.imageSmoothingQuality = 'high';
      const sy = MH / img.h;
      for (const p of img.parts) {
        tc.drawImage(p.img, 0, p.y * sy, MW, p.img.height * sy);
        p.img.close();
      }
      peaks = img.elev ? findPeaks(img.elev, img.w, img.h, img.S, Math.round((box.cx - box.w / 2) * img.S), Math.round((box.cy - box.h / 2) * img.S), Math.max(box.w, box.h)) : [];
    }
    const mc = map.getContext('2d')!;
    mc.clearRect(0, 0, MW, MH);
    mc.drawImage(terrain, 0, 0);
    mc.drawImage(civC, 0, 0);
    if (!shownPeaks || !samePeaks(shownPeaks, peaks)) extra.splice(0, extra.length, ...peakItems(peaks, style));
    shownPeaks = peaks;
    await shot.draw(mc, inp.year, { only: 'labels' });
    const marks = marksOf(shot);
    lap(fine ? 'fineCompose' : 'coarseCompose');
    return { input: inp, page, map, terrain, terrainKey, fine, peaks, marks, lines: peaks.length ? [...lines, peakLine(style)] : lines, countries, ms };
  };

  try {
    if (reuse) {
      const m = await compose(null, true);
      opt.onMap?.(m);
      shot.dispose();
      civC.width = civC.height = 0;
      return m;
    }
    if (coarseJob) {
      const c = await coarseJob;
      lap('coarse');
      if (!opt.alive() || !c) {
        c?.parts.forEach((p) => p.img.close());
        return dispose();
      }
      opt.onMap?.(await compose(c, false));
      if (!opt.alive()) return dispose();
    }
    const f = await (fineJob ?? reliefImage(box, S, look, 'elev', H, bstyle, (n, of) => opt.progress?.(n / of)));
    lap('fine');
    if (!opt.alive() || !f) {
      f?.parts.forEach((p) => p.img.close());
      return dispose();
    }
    const m = await compose(f, true);
    opt.onMap?.(m);
    shot.dispose();
    civC.width = civC.height = 0;
    return m;
  } catch (e) {
    dispose();
    throw e;
  }

  function dispose(): null {
    shot.dispose();
    civC.width = civC.height = 0;
    return null;
  }
}

/** 两组山峰一样(位置、海拔都一样,不用重排字) */
function samePeaks(a: readonly Peak[], b: readonly Peak[]): boolean {
  return a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y && p.e === b[i].e);
}

/** 这一页上放上去了哪几种城镇符号(图例按它列) */
function marksOf(shot: MapShot): SettlementKind[] {
  const got = new Set<number>();
  for (const m of shot.placed?.marks ?? []) {
    const k = (m.mark as { kind?: number }).kind;
    if (k !== undefined) got.add(k);
  }
  return MARK_ORDER.filter((r) => got.has(r.kind)).map((r) => r.kind);
}

/** 框里的州(地块中心落在框里的),按出现的先后 */
function regionsIn(inp: RegionInput): number[] {
  const { world, civ, box } = inp;
  const W = world.width;
  const seen = new Set<number>();
  const out: number[] = [];
  const { x, y, n } = world.mesh;
  for (let c = 0; c < n; c++) {
    let dx = x[c] - box.cx;
    dx -= W * Math.round(dx / W);
    if (Math.abs(dx) > box.w / 2 || Math.abs(y[c] - box.cy) > box.h / 2) continue;
    const r = civ.regions.of[c];
    if (r < 0 || seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  return out;
}

/** 框里有哪几国(那一年;按框里的州数,多的在前) */
function countriesIn(inp: RegionInput): string[] {
  const { civ, year } = inp;
  const own = ownersAt(civ, year).polity;
  const count = new Map<number, number>();
  for (const r of regionsIn(inp)) {
    const p = own[r];
    if (p >= 0) count.set(p, (count.get(p) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([p]) => polityName(civ.polities[p], year));
}

/** 标题后面的小字:框里有哪几国("大定王朝"、"甲国、乙国、丙国 等 5 国") */
export function countriesText(list: readonly string[]): string {
  return list.slice(0, 3).join('、') + (list.length > 3 ? ` 等 ${list.length} 国` : '');
}

/**
 * 图例里的线(只列这一页上有的):国界、州界、大路用地图上同一支笔画(线宽、虚线按地图上这一页的粗细),河照这一页的河色。
 * pk = 文明底图的线按放大几倍的粗细画;alpha = 文明底图多浓;spu = 每世界单位多少页面 CSS 像素
 */
function legendLines(inp: RegionInput, style: CivStyle, pk: number, alpha: number, spu: number): LegendLine[] {
  const { world, raster, civ, year, show } = inp;
  const S = raster.scale;
  const pen = detailPen(Math.max(1, pk), style);
  const len = 24;
  /** 在 (x, y) 起画一小段:世界坐标里一条横线,按地图上这一页的比例画 */
  /**
   * 在 (x, y) 起画一小段:世界坐标里一条横线,按地图上这一页的比例画。widest = 这支笔最宽的那一道是几个 P;
   * 地图上的线比 maxCss 还粗(手绘的国界)就整个按比例缩小(线宽、虚线长短一起缩),24 像素里看得出虚线的样子
   */
  const sample = (widest: number, maxCss: number, draw: (ctx: CanvasRenderingContext2D, pts: Float32Array) => void) => (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const g = spu * Math.min(1, maxCss / (widest * pen * spu));
    ctx.translate(x, y);
    ctx.scale(g / S, g / S);
    ctx.globalAlpha = alpha;
    draw(ctx, new Float32Array([0, 0, len / g, 0]));
  };
  const out: LegendLine[] = [];
  const regs = regionsIn(inp);
  const own = ownersAt(civ, year).polity;
  // 国界:框里有两国(或者国家和没人管的地方)相接
  if (show.polities && new Set(regs.map((r) => own[r])).size > 1) {
    out.push({
      name: '国界',
      draw: sample(4, 7, (ctx, pts) => strokeBorders(ctx, { inner: [{ pts, closed: false, left: 0, right: 1, end0: true, end1: true }], bloc: [], outer: [] }, style, S, pen, 0)),
    });
  }
  if (regs.length > 1) {
    out.push({
      name: '州界',
      draw: sample(2, 4, (ctx, pts) => {
        const pa = new Path2D();
        pa.moveTo(pts[0] * S, pts[1] * S);
        pa.lineTo(pts[2] * S, pts[3] * S);
        strokeRegionLines(ctx, pa, style, S * pen);
      }),
    });
  }
  if (roadsIn(inp)) {
    out.push({
      name: '大路',
      draw: sample(2.8, 5, (ctx, pts) => {
        const road = new Path2D();
        road.moveTo(pts[0] * S, pts[1] * S);
        road.lineTo(pts[2] * S, pts[3] * S);
        strokeRoutes(ctx, { road, trail: new Path2D(), sea: new Path2D() }, style, S * pen);
      }),
    });
  }
  const river = style === 'fantasy' ? fantasyBoxRiverStyle(world.riverThreshold, 1).color : realisticRiverStyle(20, world.riverThreshold, inp.look).color;
  out.push({
    name: '河',
    draw: (ctx, x, y) => {
      ctx.strokeStyle = river;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y + 2);
      ctx.bezierCurveTo(x + 8, y - 4, x + 16, y + 6, x + len, y - 1);
      ctx.stroke();
    },
  });
  return out;
}

/** 框里有没有大路(那一年修好、没荒掉的) */
function roadsIn(inp: RegionInput): boolean {
  const { world, civ, year, box } = inp;
  if (!civ.routes.length) return false;
  const W = world.width;
  for (const l of routeLines(world.mesh, civ, year).road) {
    const p = l.pts;
    for (let i = 0; i + 1 < p.length; i += 2) {
      let dx = p[i] - box.cx;
      dx -= W * Math.round(dx / W);
      if (Math.abs(dx) <= box.w / 2 && Math.abs(p[i + 1] - box.cy) <= box.h / 2) return true;
    }
  }
  return false;
}

/** 图例里的山峰:▲ 用山峰字的颜色 */
function peakLine(style: CivStyle): LegendLine {
  return {
    name: '山峰(米)',
    draw: (ctx, x, y) => {
      ctx.fillStyle = style === 'fantasy' ? 'rgb(78, 52, 32)' : 'rgb(46, 40, 34)';
      ctx.font = `500 12px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('▲', x + 12, y + 1);
    },
  };
}

/** 四周要写的字 */
export interface RegionText {
  title: string;
  year: string;
  world: string;
}

/**
 * 整页(page.w × page.h CSS 像素 × D):四周 + 地图。版式 'map' = 只要地图(不要四周)。
 * 先等四周的字体加载好;等的工夫里不要了(alive() = false)就不画,返回 null
 */
export async function drawRegionSheet(
  m: RegionMap,
  text: RegionText,
  layout: 'page' | 'map' = 'page',
  into?: HTMLCanvasElement,
  alive: () => boolean = () => true,
): Promise<HTMLCanvasElement | null> {
  const { page, input } = m;
  const D = input.D;
  if (layout === 'map') {
    const out = into ?? makeCanvas(m.map.width, m.map.height);
    out.width = m.map.width;
    out.height = m.map.height;
    out.getContext('2d')!.drawImage(m.map, 0, 0);
    return out;
  }
  const style = regionStyle(input.style);
  const spec = {
    style,
    box: input.box,
    W: input.world.width,
    H: input.world.height,
    title: text.title,
    sub: countriesText(m.countries),
    year: text.year,
    world: text.world,
    marks: m.marks,
    lines: m.lines,
    water: input.raster.water,
    rw: input.raster.w,
    rh: input.raster.h,
  };
  await ensureFonts(style === 'fantasy' ? 'fantasy' : 'realistic', pageChars(spec), 15000);
  if (!alive()) return null;
  const out = into ?? makeCanvas(page.w * D, page.h * D);
  out.width = Math.round(page.w * D);
  out.height = Math.round(page.h * D);
  const ctx = out.getContext('2d')!;
  ctx.setTransform(D, 0, 0, D, 0, 0);
  drawRegionPage(ctx, page, m.map, spec, D);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}

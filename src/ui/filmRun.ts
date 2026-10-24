/**
 * 回放视频一帧一帧地画:按年份取那一段的世界(filmSource.ts),地图交给 MapShot(render/shot.ts)按成片的像素画,
 * 再由 render/film.ts 写上年份、字幕、片头片尾。导出和面板里的预览用同一个 FilmRenderer,预览和成片一模一样。
 *
 * - 地形大事把历史分成几段:放到下一段时换一个 MapShot(那一段的地形只画一次)。
 * - 拍框里一块时,字幕只写框里看得到的国家的大事:事发的州在框里(有一块地在框里就算),或者事情牵涉的国家那一年在框里有地。
 */
import type { ChronicleEntry } from '../gen/civ/chronicle';
import type { Civ } from '../gen/civ/types';
import type { World } from '../gen/world';
import type { Era } from '../gen/era';
import { ownersAt } from '../gen/civ/timeline';
import { MapShot, type ShotArea, type ShotScene } from '../render/shot';
import type { SurfaceLook } from '../render/surface';
import { drawFilmFrame, filmMapRect, type FilmLook } from '../render/film';
import { labelProjection, type MapProj } from '../render/projection';
import type { MarkItem } from '../render/marks';
import type { CivShow, CivStyle } from '../render/civ/overlay';
import type { ResourceLook } from '../render/civ/resources';
import type { LayerId } from '../render/layers';
import type { ProjectionId } from '../render/projection';
import type { FilmSource } from './filmSource';
import {
  captionSlots,
  filmClock,
  filmEvents,
  filmSize,
  outlineEvents,
  rangeText,
  yearFrame,
  type FilmArea,
  type FilmClock,
  type FilmPlot,
  type FilmRange,
  type FilmShape,
} from './filmPlan';

/** 拍框里一块:地图平面上的范围(等距圆柱 = 展开的世界坐标)、屏幕上的缩放倍数、缩放 1 倍时地图多宽 */
export interface FilmRegion {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  k: number;
  mapCss: number;
  mp: MapProj | null;
}

export interface FilmSetup {
  shape: FilmShape;
  area: FilmArea;
  range: FilmRange;
  seconds: number;
  captions: boolean;
  /** 字幕按大纲:照大纲推演推过的情节(不给 = 字幕写大事) */
  plots?: readonly FilmPlot[];
  cards: boolean;
  /** 片尾卡片上带不带"用「文明与地图」推演生成"和网址 */
  url: boolean;
  title: string;
  style: CivStyle;
  layer: LayerId;
  /** 写实底图的画法(经典卫星、卫星、地理图、白模) */
  look?: SurfaceLook;
  show: CivShow;
  /** 物产图层只看哪一样、画不画还没发现的(和屏幕上一样) */
  res?: ResourceLook;
  projection: ProjectionId;
  center?: number;
  /** 经纬网每隔几度一条(0 = 不画) */
  graticule: number;
  /** 那一年的作者标记(按那一段的世界和历史算形状) */
  marks?: (civ: Civ, world: World, year: number) => MarkItem[];
  /** 无色标记名字里的字(和地图文字一起先加载字体) */
  markChars?: string;
  region?: FilmRegion;
  /** 界面字体 */
  font: string;
  /** 纪年(没设 = 按第几年写) */
  era?: Era;
}

const canvas = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: w, height: h });

/** 拍框里一块时字幕留哪些大事:事发的州在框里,或者牵涉的国家那一年在框里有地 */
export function regionKeep(geo: Civ, world: World, r: FilmRegion): (e: ChronicleEntry) => boolean {
  const R = geo.regions.count;
  const inside = new Uint8Array(R);
  const W = world.width;
  const fwd = r.mp ? labelProjection(r.mp).fwd : null;
  let any = false;
  // 一个州有一块地在框里就算(框小、挨着边时治所常在框外)
  const of = geo.regions.of;
  for (let c = 0; c < of.length; c++) {
    const i = of[c];
    if (i < 0 || i >= R || inside[i]) continue;
    let x = world.mesh.x[c];
    let y = world.mesh.y[c];
    if (fwd) [x, y] = fwd(x, y);
    else {
      while (x < r.x0) x += W;
      while (x - W >= r.x0) x -= W;
    }
    if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) {
      inside[i] = 1;
      any = true;
    }
  }
  if (!any) return () => false;
  const cache = new Map<number, Set<number>>();
  const polsAt = (year: number) => {
    let s = cache.get(year);
    if (!s) {
      s = new Set<number>();
      const own = ownersAt(geo, year).polity;
      for (let i = 0; i < Math.min(R, own.length); i++) if (inside[i] && own[i] >= 0) s.add(own[i]);
      cache.set(year, s);
    }
    return s;
  };
  return (e) => {
    if (e.regions.some((i) => i >= 0 && i < R && inside[i])) return true;
    if (!e.polities.length) return false;
    const s = polsAt(Math.floor(e.year));
    return e.polities.some((p) => s.has(p));
  };
}

export class FilmRenderer {
  readonly look: FilmLook;
  readonly clock: FilmClock;
  readonly w: number;
  readonly h: number;
  private readonly src: FilmSource;
  private readonly setup: FilmSetup;
  private shot: MapShot | null = null;
  private shotK = -1;
  private readonly map: HTMLCanvasElement;
  /** 放掉了(预览换了一个新的):还没画完的那一帧不画了 */
  private dead = false;

  constructor(src: FilmSource, setup: FilmSetup, majors: readonly ChronicleEntry[]) {
    this.src = src;
    this.setup = setup;
    const { w, h } = filmSize(setup.shape);
    this.w = w;
    this.h = h;
    const clock = filmClock(setup.range, setup.seconds, setup.cards);
    this.clock = clock;
    let keep: ((e: ChronicleEntry) => boolean) | undefined;
    if (setup.area === 'region' && setup.region) {
      // 有地形大事的世界各段的州不一样:每件事按它那一年所在那一段的州和地形看在不在框里
      const region = setup.region;
      const byK = new Map<number, (e: ChronicleEntry) => boolean>();
      keep = (e) => {
        const sc = src.at(e.year);
        let f = byK.get(sc.k);
        if (!f) byK.set(sc.k, (f = regionKeep(sc.geo, sc.world, region)));
        return f(e);
      };
    }
    const majorEvents = filmEvents(majors, setup.range, keep, setup.era);
    const events = setup.plots ? outlineEvents(majorEvents, setup.plots, setup.range) : majorEvents;
    this.look = {
      shape: setup.shape,
      area: setup.area,
      clock,
      title: setup.title.trim(),
      range: rangeText(setup.range, setup.era),
      captions: setup.captions,
      cards: setup.cards,
      url: setup.url,
      slots: setup.captions && setup.shape === 'land' ? captionSlots(events, clock, setup.era) : [],
      events,
      font: setup.font,
      era: setup.era,
    };
    const r = filmMapRect(setup.shape, setup.area);
    this.map = canvas(r.w, r.h);
  }

  /** 拍框里一块时,框里的地图是哪一块(成片像素);整张地图 = null */
  get mapRect() {
    return filmMapRect(this.setup.shape, this.setup.area);
  }

  /** 第 year 年那一段的 MapShot(换段了另开一个) */
  private async shotAt(year: number): Promise<{ shot: MapShot; civ: Civ; world: World }> {
    const sc = this.src.at(year);
    if (!this.shot || sc.k !== this.shotK) {
      this.shot?.dispose();
      const s = this.setup;
      const scene: ShotScene = {
        world: sc.world,
        raster: sc.raster,
        civ: sc.civ,
        geo: sc.geo,
        style: s.style,
        layer: s.layer,
        look: s.look,
        show: s.show,
        res: s.res,
        projection: s.projection,
        center: s.center,
        graticule: s.graticule,
        marks: s.marks ? (y) => s.marks!(sc.civ, sc.world, y) : undefined,
        markChars: s.markChars,
      };
      const r = this.mapRect;
      const area: ShotArea = s.area === 'region' && s.region ? { kind: 'region', ...s.region } : { kind: 'whole', dpr: 1 };
      const shot = new MapShot(scene, area, r.w, r.h);
      this.shot = shot;
      this.shotK = sc.k;
      await shot.prepare();
      return { shot, civ: sc.civ, world: sc.world };
    }
    return { shot: this.shot, civ: sc.civ, world: sc.world };
  }

  /** 画第 f 帧到 ctx(大小 = 成片) */
  async draw(ctx: CanvasRenderingContext2D, f: number, year: number): Promise<void> {
    if (this.dead) return;
    const { shot } = await this.shotAt(year);
    if (this.dead) return;
    const mctx = this.map.getContext('2d')!;
    try {
      await shot.draw(mctx, year, { fast: true });
    } catch (e) {
      if (this.dead) return;
      throw e;
    }
    if (this.dead) return;
    // 横屏整张地图上下两条边:和地图纸边同色(取地图最上面一行)
    if (this.look.band === undefined && this.setup.shape === 'land' && this.setup.area === 'whole') this.look.band = edgeColor(mctx, this.map.width);
    drawFilmFrame(ctx, this.look, f, this.map);
  }

  /** 预览:放到第 year 年时的那一帧(在片头片尾以外) */
  frameOf(year: number): number {
    return yearFrame(this.clock, year);
  }

  dispose() {
    this.dead = true;
    this.shot?.dispose();
    this.shot = null;
    this.map.width = this.map.height = 0;
  }
}

/** 地图最上面一行的平均颜色 */
function edgeColor(ctx: CanvasRenderingContext2D, w: number): string {
  try {
    const d = ctx.getImageData(0, 1, w, 1).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
  } catch {
    return '#f5f5f7';
  }
}

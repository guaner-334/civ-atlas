/**
 * 并排试推的两张地图怎么画:和世界里平常的地图同一种样子(手绘画风、国家填色、地名;render/shot.ts 的 MapShot 整张地图那一种)。
 *
 * - 地形、外框两张共用一份(同一张地图),只画一次;每张图每换一份历史另开一个 MapShot(借这份地形),只重画国土和字
 * - 换了年份、交来新的历史就重画;一次只画一张。播放时每张图最多每 MIN_GAP 毫秒画一次(每秒最多 10 次),左右轮流,
 *   字按回放时的画法(国名隔几年才重新摆、小城不写名字);停下来当场两张都画全
 * - 还没有历史的那张只画地形
 * 只在主线程用(要用页面里加载好的字体)。
 */
import { MapShot, wholeTerrain, type ShotScene, type WholeTerrain } from '../../render/shot';
import { CIV_SHOW_DEFAULT } from '../../render/civ/show';
import type { CivShow } from '../../render/civ/overlay';
import type { Civ } from '../../gen/civ/types';
import type { DrawMap } from './drawMap';

/** 播放时同一张图两次重画至少隔多久(毫秒) */
const MIN_GAP = 100;
/** 和世界里打开时的地图一样:国家填色、地名、战事、瘟疫 */
const SHOW: CivShow = { ...CIV_SHOW_DEFAULT, polities: true };

interface Pane {
  canvas: HTMLCanvasElement | null;
  w: number;
  h: number;
  dpr: number;
  civ: Civ | null;
  year: number;
  shot: MapShot | null;
  /** 这一张现在要画成什么样、画好的是什么样 */
  want: string;
  drawn: string;
  last: number;
}

export class PaneDrawer {
  private map: DrawMap | null = null;
  private terrain: WholeTerrain | null = null;
  private readonly panes: Pane[] = [0, 1].map(() => ({ canvas: null, w: 0, h: 0, dpr: 1, civ: null, year: 0, shot: null, want: '', drawn: '', last: 0 }));
  private playing = false;
  private busy = false;
  private next = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private gone = false;
  /** 画过一次的(冒烟检查看两张图都画出来了没有) */
  painted = [false, false];

  /** 要画的都画好了(冒烟检查、截图等它) */
  get idle(): boolean {
    return !this.busy && !this.panes.some((p) => this.stale(p));
  }

  private scene(civ: Civ): ShotScene {
    const m = this.map!;
    return { world: m.world, raster: m.raster, civ, style: 'fantasy', layer: 'biomes', show: SHOW };
  }

  /** 换地图(null = 还没有):地形重画一份,两张图的 MapShot 作废 */
  setMap(map: DrawMap | null): void {
    if (map === this.map) return;
    for (const p of this.panes) this.dropShot(p);
    if (this.terrain) {
      this.terrain.terrain.width = this.terrain.terrain.height = 0;
      this.terrain.decor.width = this.terrain.decor.height = 0;
    }
    this.map = map;
    this.terrain = map ? wholeTerrain({ world: map.world, raster: map.raster, style: 'fantasy', layer: 'biomes', show: SHOW }) : null;
    for (const p of this.panes) p.drawn = '';
    this.kick();
  }

  private dropShot(p: Pane) {
    p.shot?.dispose();
    p.shot = null;
  }

  /** 第 k 张图:画在哪张画布上(CSS 像素大小、像素密度)、哪一份历史、哪一年 */
  set(k: number, canvas: HTMLCanvasElement | null, w: number, h: number, dpr: number, civ: Civ | null, year: number): void {
    const p = this.panes[k];
    const W = Math.max(1, Math.round(w * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    if (p.canvas !== canvas || p.w !== W || p.h !== H || p.civ !== civ) {
      if (p.w !== W || p.h !== H || p.civ !== civ) this.dropShot(p);
      p.canvas = canvas;
      p.w = W;
      p.h = H;
      p.dpr = dpr;
      p.civ = civ;
      p.drawn = '';
    }
    p.year = Math.floor(civ ? Math.min(year, civ.endYear) : 0);
    p.want = `${p.year}|${this.playing ? 'fast' : 'full'}`;
    this.kick();
  }

  /** 播放中:限速、字按回放时的画法;停下来补画全 */
  setPlaying(on: boolean): void {
    if (on === this.playing) return;
    this.playing = on;
    for (const p of this.panes) p.want = `${p.year}|${on ? 'fast' : 'full'}`;
    this.kick();
  }

  private stale(p: Pane) {
    return !!p.canvas && !!this.terrain && p.want !== p.drawn;
  }

  private kick() {
    if (this.gone || this.busy) return;
    clearTimeout(this.timer);
    void this.pump();
  }

  private async pump() {
    this.busy = true;
    try {
      for (;;) {
        if (this.gone) return;
        const now = performance.now();
        let pick = -1;
        let wait = Infinity;
        for (const k of [this.next, 1 - this.next]) {
          const p = this.panes[k];
          if (!this.stale(p)) continue;
          const gap = this.playing ? MIN_GAP - (now - p.last) : 0;
          if (gap <= 0) {
            pick = k;
            break;
          }
          wait = Math.min(wait, gap);
        }
        if (pick < 0) {
          if (wait < Infinity) this.timer = setTimeout(() => this.kick(), wait);
          return;
        }
        this.next = 1 - pick;
        const p = this.panes[pick];
        const want = p.want;
        p.last = now;
        await this.draw(p);
        p.drawn = want;
        this.painted[pick] = true;
        // 让一下:拖时间轴、点按钮先响应
        await new Promise((r) => setTimeout(r, 0));
      }
    } finally {
      this.busy = false;
    }
  }

  private async draw(p: Pane) {
    const c = p.canvas!;
    if (c.width !== p.w || c.height !== p.h) {
      c.width = p.w;
      c.height = p.h;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (!p.civ) {
      // 还没有历史:只有地形
      const t = this.terrain!;
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(t.terrain, 0, 0, p.w, p.h);
      ctx.drawImage(t.decor, 0, 0, p.w, p.h);
      ctx.restore();
      return;
    }
    if (!p.shot) {
      p.shot = new MapShot(this.scene(p.civ), { kind: 'whole', dpr: p.dpr }, p.w, p.h);
      p.shot.useTerrain(this.terrain!);
    }
    await p.shot.draw(ctx, p.year, { fast: this.playing });
  }

  dispose(): void {
    this.gone = true;
    clearTimeout(this.timer);
    this.setMapNull();
  }

  private setMapNull() {
    for (const p of this.panes) this.dropShot(p);
    if (this.terrain) {
      this.terrain.terrain.width = this.terrain.terrain.height = 0;
      this.terrain.decor.width = this.terrain.decor.height = 0;
    }
    this.terrain = null;
    this.map = null;
  }
}

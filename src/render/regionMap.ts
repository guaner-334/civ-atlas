/**
 * 地区图:地图上框一块,单独画成"地图集的一页"(界面、后台线程在 ui/terrain3d/)。这里是纯画法:
 *
 *   regionProj   这一块用的投影:中央经线 = 框中心,东西方向按框中心那条纬线收回去(等距圆柱 + 标准纬线),
 *                高纬度的一块不横着拉宽;比例尺按同一条纬线算
 *   regionPage   一页的大小(CSS 像素):地图 1200 宽、高按这一块的公里数;四周留出标题、经纬度、比例尺、图例
 *   regionArea   这一块在投影平面上的范围 + 地区图的画法(交给 render/shot.ts 的 MapShot 画文明底图和字)
 *   findPeaks    在现算的细地形上找框里最高的几座山;peakItems 把它们写成 ▲ + 海拔(和地名一起排)
 *   drawRegionPage 四周:标题、年份、经纬度刻度、比例尺、指北、图例(只列这一页上有的,线用地图上同一支笔)、位置小图
 *
 * 一页按 CSS 像素排,画的时候整页放大 D 倍(屏幕上、导出 2 倍是 D = 2,导出 4 倍是 D = 4),字和图的比例不变。
 */
import { PROJECTIONS, latText, lonText, type MapProj, type ProjectionDef, type ProjectionId } from './projection';
import { boxKm, kmPerUnitX, latOfY, type ReliefBox } from './terrain3d/box';
import { toCanvas, type LabelItem, type LabelMark, type LabelView, type PlacedMark } from './labels/draw';
import type { Candidate } from './labels/layout';
import { familyFor, fontCss } from './labels/fonts';
import type { CivStyle } from './civ/overlay';
import { drawSettlementMarks, SYMBOL_BOX, SYMBOL_GROW, type SettlementKind } from './civ/settlements';
import type { RegionLook } from './shot';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// 投影、一页的大小

/** 地图部分多宽(CSS 像素) */
export const REGION_MAP_W = 1200;
/** 四周:左右各留多少、上面(标题)、下面(比例尺、图例、位置小图) */
const PAD = 40;
const TOP = 78;
const BOT = 118;

/** 这一块用的投影:中央经线 = 框中心,东西方向 × cos(框中心纬度);地图平面和世界一样大(南北方向和世界坐标一样) */
export function regionProj(box: ReliefBox, W: number, H: number): MapProj {
  const c = Math.max(0.05, Math.cos(latOfY(box.cy, H) * DEG));
  const eq = PROJECTIONS.equirect;
  const def: ProjectionDef = { ...eq, id: `region:${c.toFixed(6)}` as ProjectionId, kx: () => c };
  const t = (((box.cx / W) % 1) + 1) % 1;
  const lon0 = t * 360 - 180;
  const s = W / (2 * Math.PI);
  return { def, lon0, W, H, s, xMax: c * Math.PI, yMax: def.y(def.latMax), key: `region|${c.toFixed(6)}|${lon0.toFixed(4)}|${W}x${H}` };
}

/** 一页的大小(CSS 像素):地图 mapW × mapH(按这一块东西、南北多少公里),整页 w × h,地图左上角在 (mx, my) */
export interface RegionPage {
  mapW: number;
  mapH: number;
  w: number;
  h: number;
  mx: number;
  my: number;
}

export function regionPage(box: ReliefBox, H: number): RegionPage {
  const km = boxKm(box, H);
  const mapW = REGION_MAP_W;
  const mapH = Math.max(120, Math.round((mapW * km.h) / km.w));
  return { mapW, mapH, w: mapW + 2 * PAD, h: mapH + TOP + BOT, mx: PAD, my: TOP };
}

/**
 * 交给 MapShot 的范围和画法(地图画布 MW × MH 像素,字按 D 倍):投影平面上框住这一块;字按放大 2.2 倍的样子长、
 * 该出现的名字都出现(缩放倍数按地图在屏幕上真放大到这么细算);国界、州界、道路按放大 150 倍的细度画(细线,不压地形),
 * 写实的国家颜色淡一半;地形另外叠在下面
 */
export function regionArea(box: ReliefBox, W: number, H: number, MW: number, D: number, style: CivStyle, extra: readonly LabelItem[]) {
  const mp = regionProj(box, W, H);
  const c = mp.def.kx(0);
  const half = (box.w * c) / 2;
  const y0 = H / 2 - mp.s * latOfY(box.cy - box.h / 2, H) * DEG;
  const y1 = H / 2 - mp.s * latOfY(box.cy + box.h / 2, H) * DEG;
  const s = MW / (2 * half);
  const mapCss = 1300;
  const look: RegionLook = {
    textK: 2.2,
    civK: 150,
    civAlpha: style === 'realistic' ? 0.5 : 1,
    noTerrain: true,
    noInk: true,
    extra,
  };
  return { kind: 'region' as const, x0: W / 2 - half, x1: W / 2 + half, y0, y1, k: (s * W) / (mapCss * D), mapCss, mp, ...look };
}

/**
 * 地形贴图每世界单位几个像素(现算的细地形按等距圆柱铺,画的时候东西方向收回去):南北方向和地图一样细;
 * 高纬度东西方向要多铺 1 / cos 倍,最多多铺 1.6 倍(再往上南北方向稍糊一点,不让一页算太久)
 */
export function terrainScale(box: ReliefBox, MW: number, MH: number): number {
  const S = MH / box.h;
  return box.w * S > 1.6 * MW ? (1.6 * MW) / box.w : S;
}

// ---------------------------------------------------------------------------
// 山峰

export interface Peak {
  /** 世界坐标 */
  x: number;
  y: number;
  /** 海拔(米) */
  e: number;
}

/** 一页最多标几座山、多高才算山 */
const MAX_PEAKS = 7;
const MIN_PEAK_M = 1200;

/**
 * 细地形(elev:w × h,每世界单位 S 像素,左上角在 S 倍主图的 (x0, y0))上框里最高的几座山:
 * 先按约 0.75 个世界单位一格取每格最高点,四周三格以内最高的才算山顶;按海拔排,相隔至少框长边的七分之一,最多 7 座
 */
export function findPeaks(elev: Float32Array, w: number, h: number, S: number, x0: number, y0: number, boxSide: number): Peak[] {
  const B = Math.max(2, Math.round(S * 0.75));
  const gw = Math.ceil(w / B);
  const gh = Math.ceil(h / B);
  const top = new Float32Array(gw * gh);
  const at = new Int32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      let best = -1;
      let bi = -1;
      for (let y = gy * B; y < Math.min(h, gy * B + B); y++)
        for (let x = gx * B; x < Math.min(w, gx * B + B); x++) {
          const e = elev[y * w + x];
          if (e > best) {
            best = e;
            bi = y * w + x;
          }
        }
      top[gy * gw + gx] = best;
      at[gy * gw + gx] = bi;
    }
  const R = 3;
  const M = Math.max(B, Math.round(S * 2));
  const cand: Peak[] = [];
  for (let gy = 0; gy < gh; gy++)
    for (let gx = 0; gx < gw; gx++) {
      const e = top[gy * gw + gx];
      if (!(e >= MIN_PEAK_M)) continue;
      const i = at[gy * gw + gx];
      const px = i % w;
      const py = (i - px) / w;
      // 贴着框边的不算(框外可能更高,只是半山腰;离边两个世界单位以内的,海拔数字也写不下)
      if (px < M || py < M || px >= w - M || py >= h - M) continue;
      let peak = true;
      for (let dy = -R; dy <= R && peak; dy++)
        for (let dx = -R; dx <= R; dx++) {
          if (!dx && !dy) continue;
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          if (top[ny * gw + nx] > e) {
            peak = false;
            break;
          }
        }
      if (peak) cand.push({ x: (x0 + px + 0.5) / S, y: (y0 + py + 0.5) / S, e });
    }
  cand.sort((a, b) => b.e - a.e);
  const sep = boxSide / 7;
  const out: Peak[] = [];
  for (const c of cand) {
    if (out.some((o) => Math.hypot(o.x - c.x, o.y - c.y) < sep)) continue;
    out.push(c);
    if (out.length >= MAX_PEAKS) break;
  }
  return out;
}

/** 山峰的字色、光晕(手绘墨褐 + 纸色光晕;写实深灰 + 白光晕) */
function peakInk(style: CivStyle) {
  return style === 'fantasy'
    ? { color: 'rgb(78, 52, 32)', halo: { color: 'rgba(241, 230, 201, 0.9)', width: 2.2 } }
    : { color: 'rgb(46, 40, 34)', halo: { color: 'rgba(255, 255, 255, 0.75)', width: 2 } };
}

/** 山峰写成 ▲ + 海拔:▲ 正好落在山顶,数字放在右边 / 左边 / 下面 / 上面(哪边放得下放哪边) */
export function peakItems(peaks: readonly Peak[], style: CivStyle): LabelItem[] {
  const ink = peakInk(style);
  const family = familyFor(style === 'fantasy' ? 'fantasy' : 'realistic');
  return peaks.map((p, i) => {
    const digits = `${Math.round(p.e)}`;
    return {
      text: `▲${digits}`,
      path: [p.x, p.y],
      layout: 'point',
      size: 9.5,
      grow: 0.3,
      tracking: [0, 0],
      minZoom: 1,
      priority: 40 - i,
      family,
      weight: 500,
      color: ink.color,
      halo: ink.halo,
      place: (px: number, view: LabelView): Candidate[] => {
        const [X, Y] = toCanvas(view, p.x, p.y);
        const tri = { ch: '▲', x: X, y: Y, a: 0 };
        const cw = px * 0.56;
        const n = digits.length;
        const mk = (sx: number, sy: number) => [tri, ...[...digits].map((ch, j) => ({ ch, x: sx + j * cw, y: sy, a: 0 }))];
        return [
          { glyphs: mk(X + px * 0.85, Y), on: 15 },
          { glyphs: mk(X - px * 0.85 - (n - 1) * cw, Y), on: 15 },
          { glyphs: mk(X - ((n - 1) * cw) / 2, Y + px * 1.05), on: 15 },
          { glyphs: mk(X - ((n - 1) * cw) / 2, Y - px * 1.05), on: 15 },
        ];
      },
    } as LabelItem;
  });
}

// ---------------------------------------------------------------------------
// 四周

/** 经纬度刻度每隔几度:框有多少度宽就挑一档,让一条边上写两到五个 */
export function tickStep(spanDeg: number): number {
  for (const s of [1, 2, 5, 10, 15, 30]) if (spanDeg / s <= 5) return s;
  return 30;
}

/** 比例尺一格多少公里(三格):三格加起来至少约 150 CSS 像素,取整齐的数 */
export function scaleUnit(kmPerCss: number): number {
  const nice = [25, 50, 100, 200, 250, 500, 1000];
  return nice.find((u) => (u * 3) / kmPerCss >= 150) ?? 1000;
}

/** 图例里的一种线:name + 怎么画(在 (x, y) 起、24 CSS 像素长的一小段上;ctx 已经按页面 CSS 像素缩放好) */
export interface LegendLine {
  name: string;
  draw: (ctx: CanvasRenderingContext2D, x: number, y: number) => void;
}

/** 四周要写的东西 */
export interface RegionPageSpec {
  style: CivStyle;
  box: ReliefBox;
  W: number;
  H: number;
  title: string;
  /** 标题后面的小字(框里有哪几国) */
  sub: string;
  /** 右上两行:年份、哪个世界 */
  year: string;
  world: string;
  /** 这一页上有的城镇符号(按图例的先后) */
  marks: SettlementKind[];
  lines: LegendLine[];
  /** 位置小图用的水陆(主图,1 = 水) */
  water: Uint8Array;
  rw: number;
  rh: number;
}

/** 城镇符号在图例里叫什么(按这个先后列) */
export const MARK_ORDER: { kind: SettlementKind; name: string }[] = [
  { kind: 4, name: '国都' },
  { kind: 3, name: '大城' },
  { kind: 2, name: '城' },
  { kind: 1, name: '镇' },
  { kind: 0, name: '村' },
  { kind: 6, name: '关' },
  { kind: 5, name: '故城' },
];

/** 纸色、字色(手绘:纸 + 墨褐;写实:白纸 + 深灰) */
function palette(style: CivStyle) {
  return style === 'fantasy'
    ? { bg: '#efe3c6', ink: 'rgb(58, 45, 34)', mute: 'rgba(78, 52, 32, 0.72)', rule: 'rgb(78, 52, 32)', box: '#c43c2c', sea: [170, 196, 196], land: [214, 196, 152] }
    : { bg: '#ffffff', ink: '#1d1d1f', mute: '#6e6e73', rule: '#1d1d1f', box: '#e0452f', sea: [205, 220, 232], land: [222, 216, 200] };
}

/** 四周用的字(手绘用地图上的楷体;写实用无衬线) */
function pageFont(style: CivStyle): (weight: number, px: number) => string {
  if (style === 'fantasy') {
    const fam = familyFor('fantasy');
    return (w, px) => fontCss(fam, w, px);
  }
  return (w, px) => `${w} ${px}px "PingFang SC", "Noto Sans SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`;
}

/** 四周要用到的字(先加载字体) */
export function pageChars(spec: Pick<RegionPageSpec, 'title' | 'sub' | 'year' | 'world'>): string {
  return `${spec.title}${spec.sub}${spec.year}${spec.world}比例尺公里北在世界上的位置约见方×国都大城镇村关故城界州路河山峰(米)0123456789°ENWS`;
}

/**
 * 画一页(ctx 已经按页面 CSS 像素缩放好,画布 = page.w × page.h CSS 像素):纸色底、地图(map,铺满地图那一块)、
 * 两道图廓、经纬度、标题、比例尺、指北、图例、位置小图。D = 画布像素 / CSS 像素(城镇符号按它画)
 */
export function drawRegionPage(ctx: CanvasRenderingContext2D, page: RegionPage, map: CanvasImageSource, spec: RegionPageSpec, D: number): void {
  const { style, box, W, H } = spec;
  const pal = palette(style);
  const ff = pageFont(style);
  const { mapW, mapH, mx, my } = page;
  ctx.save();
  ctx.fillStyle = pal.bg;
  ctx.fillRect(0, 0, page.w, page.h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(map, mx, my, mapW, mapH);
  // 图廓:内细线 + 外粗线
  ctx.strokeStyle = pal.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(mx - 0.5, my - 0.5, mapW + 1, mapH + 1);
  ctx.lineWidth = 2.2;
  ctx.strokeRect(mx - 7, my - 7, mapW + 14, mapH + 14);
  // 经纬度刻度:刻度线在两道框之间,度数写在外框外
  const x0 = box.cx - box.w / 2;
  const y0 = box.cy - box.h / 2;
  const lonOf = (x: number) => (x / W) * 360 - 180;
  const step = tickStep(Math.max(box.w * (360 / W), box.h * (180 / H)));
  ctx.font = ff(500, 10.5);
  ctx.fillStyle = pal.mute;
  ctx.lineWidth = 1;
  const lonA = lonOf(x0);
  const lonB = lonOf(x0 + box.w);
  for (let lon = Math.ceil(lonA / step) * step; lon <= lonB + 1e-9; lon += step) {
    const x = mx + ((((lon + 180) / 360) * W - x0) / box.w) * mapW;
    for (const [ya, yb, ty, base] of [
      [my - 7, my, my - 11, 'bottom'],
      [my + mapH, my + mapH + 7, my + mapH + 11, 'top'],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x, ya);
      ctx.lineTo(x, yb);
      ctx.strokeStyle = pal.rule;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = base;
      ctx.fillText(lonText(lon), x, ty);
    }
  }
  const latA = latOfY(y0 + box.h, H);
  const latB = latOfY(y0, H);
  for (let lat = Math.ceil(latA / step) * step; lat <= latB + 1e-9; lat += step) {
    const y = my + ((((90 - lat) / 180) * H - y0) / box.h) * mapH;
    for (const [xa, xb, tx, al] of [
      [mx - 7, mx, mx - 11, 'right'],
      [mx + mapW, mx + mapW + 7, mx + mapW + 11, 'left'],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(xa, y);
      ctx.lineTo(xb, y);
      ctx.strokeStyle = pal.rule;
      ctx.stroke();
      ctx.textAlign = al;
      ctx.textBaseline = 'middle';
      ctx.fillText(latText(lat), tx, y);
    }
  }
  // 标题(左上)+ 框里有哪几国;右上年份、哪个世界
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = pal.ink;
  ctx.font = ff(style === 'fantasy' ? 500 : 700, 30);
  const titleMax = mapW * 0.62;
  ctx.fillText(spec.title, mx - 7, 50, titleMax);
  const tw = Math.min(titleMax, ctx.measureText(spec.title).width);
  ctx.font = ff(500, 13.5);
  ctx.fillStyle = pal.mute;
  if (spec.sub) ctx.fillText(spec.sub, mx - 7 + tw + 16, 50, Math.max(40, mapW * 0.8 - tw - 16));
  ctx.textAlign = 'right';
  ctx.fillText(spec.year, mx + mapW + 7, 32);
  ctx.fillText(spec.world, mx + mapW + 7, 52, mapW * 0.3);
  // 底下一条:比例尺 + 指北 | 图例 | 位置小图
  const by = my + mapH + 36;
  const kmPerCss = (box.w * kmPerUnitX(box.cy, H)) / mapW;
  const unit = scaleUnit(kmPerCss);
  const segW = unit / kmPerCss;
  const sx = mx - 7;
  const sy = by + 24;
  ctx.textAlign = 'left';
  ctx.font = ff(500, 11.5);
  ctx.fillStyle = pal.mute;
  ctx.fillText('比例尺', sx, by + 6);
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = i % 2 ? pal.bg : pal.ink;
    ctx.fillRect(sx + i * segW, sy, segW, 6);
  }
  ctx.strokeStyle = pal.ink;
  ctx.lineWidth = 1;
  ctx.strokeRect(sx + 0.5, sy + 0.5, segW * 3 - 1, 5);
  ctx.fillStyle = pal.ink;
  ctx.font = ff(500, 11);
  ctx.textAlign = 'center';
  for (let i = 0; i <= 3; i++) ctx.fillText(i === 3 ? `${unit * 3} 公里` : `${unit * i}`, sx + i * segW + (i === 3 ? 14 : 0), sy + 22);
  // 指北
  const nx = sx + segW * 3 + 58;
  const ny = by + 22;
  ctx.beginPath();
  ctx.moveTo(nx, ny - 18);
  ctx.lineTo(nx + 7, ny + 6);
  ctx.lineTo(nx, ny + 1);
  ctx.lineTo(nx - 7, ny + 6);
  ctx.closePath();
  ctx.fillStyle = pal.ink;
  ctx.fill();
  ctx.font = ff(600, 12);
  ctx.fillText('北', nx, ny + 22);
  // 图例:第一行城镇符号(这一页上有的),第二行线和山峰
  const lx = nx + 46;
  const colW = 70;
  const boxes = SYMBOL_BOX[style === 'fantasy' ? 'fantasy' : 'realistic'];
  const placed: PlacedMark[] = [];
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = ff(500, 12.5);
  ctx.fillStyle = pal.ink;
  MARK_ORDER.filter((m) => spec.marks.includes(m.kind)).forEach((r, i) => {
    const x = lx + i * colW + 8;
    const y = by + 6;
    const mark = { id: -1 - i, x, y, box: boxes[r.kind], grow: SYMBOL_GROW, minZoom: 1, priority: 0, kind: r.kind, color: [150, 60, 50] };
    placed.push({ mark: mark as unknown as LabelMark, x: x * D, y: y * D, s: 1.25 * D });
    ctx.fillText(r.name, x + 13, y + 1);
  });
  const y2 = by + 36;
  spec.lines.forEach((l, i) => {
    const x = lx + i * colW;
    ctx.save();
    l.draw(ctx, x - 4, y2);
    ctx.restore();
    ctx.fillStyle = pal.ink;
    ctx.font = ff(500, 12.5);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(l.name, x + 26, y2 + 1);
  });
  // 城镇符号按画布像素画
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawSettlementMarks(ctx, placed, style);
  ctx.restore();
  // 位置小图(右下):整个世界的海陆 + 红框
  const iw = 150;
  const ih = 75;
  const ix = mx + mapW + 7 - iw;
  const iy = by - 8;
  drawInset(ctx, spec, ix, iy, iw, ih, D, pal);
  ctx.fillStyle = pal.mute;
  ctx.font = ff(500, 11);
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('在世界上的位置', ix - 8, iy + ih);
  const km = boxKm(box, H);
  const kw = Math.round(km.w / 10) * 10;
  const kh = Math.round(km.h / 10) * 10;
  ctx.fillText(kw === kh ? `约 ${kw} 公里见方` : `约 ${kw} × ${kh} 公里`, ix - 8, iy + ih - 18);
  ctx.restore();
}

/** 位置小图:整个世界的海陆(按小图的像素取主图),框的那一块画红框(跨过左右接缝的框两边各画一截) */
function drawInset(ctx: CanvasRenderingContext2D, spec: RegionPageSpec, ix: number, iy: number, iw: number, ih: number, D: number, pal: ReturnType<typeof palette>) {
  const pw = Math.max(1, Math.round(iw * D));
  const ph = Math.max(1, Math.round(ih * D));
  const img = new ImageData(pw, ph);
  for (let y = 0; y < ph; y++) {
    const ry = Math.min(spec.rh - 1, Math.floor((y / ph) * spec.rh));
    for (let x = 0; x < pw; x++) {
      const rx = Math.min(spec.rw - 1, Math.floor((x / pw) * spec.rw));
      const col = spec.water[ry * spec.rw + rx] !== 0 ? pal.sea : pal.land;
      const o = (y * pw + x) * 4;
      img.data[o] = col[0];
      img.data[o + 1] = col[1];
      img.data[o + 2] = col[2];
      img.data[o + 3] = 255;
    }
  }
  const cv = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(pw, ph) : Object.assign(document.createElement('canvas'), { width: pw, height: ph });
  (cv.getContext('2d') as CanvasRenderingContext2D).putImageData(img, 0, 0);
  ctx.drawImage(cv, ix, iy, iw, ih);
  ctx.strokeStyle = pal.mute;
  ctx.lineWidth = 1;
  ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
  const { box, W, H } = spec;
  const bx = ((((box.cx - box.w / 2) / W) % 1) + 1) % 1;
  const bw = Math.max(3 / iw, box.w / W);
  const by = (box.cy - box.h / 2) / H;
  const bh = Math.max(3 / ih, box.h / H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(ix, iy, iw, ih);
  ctx.clip();
  ctx.strokeStyle = pal.box;
  ctx.lineWidth = 1.6;
  for (const sh of [0, -1]) ctx.strokeRect(ix + (bx + sh) * iw, iy + by * ih, bw * iw, bh * ih);
  ctx.restore();
}

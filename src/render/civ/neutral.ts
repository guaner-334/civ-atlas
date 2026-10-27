/**
 * 文明叠加层 · 中立地:几国共建(或议和划出)、不归任何一国的那一州,铺一层共建几国颜色相间的细横纹
 * (历史地图上共管地几国颜色相间的条纹;斜线已经是战事,这里用横的),名字"星河域中立地"在文字层(labels.ts 的 civMapLayer)。
 * 数据按史事整理(gen/civ/treatyInfo.ts 的 zonesAt),不改推演。
 *
 *   - 整张图:和战事的斜线一样是"面",画在文明底图 / 地球仪的文明贴图上(drawNeutral;弯边投影按行重投影)。
 *     逐像素按州栅格上色,横纹按世界 y 排、按像素算覆盖(边缘抗锯齿);手绘风给山、林符号让位(和国土色块同一张遮罩,
 *     territory.ts 的 inkOf:墨线、林块、山的纸色底上不画)。中立地一样就用上次画好的,每帧只贴有横纹的那一框
 *   - 放大后的细节层:色块那一步逐格上色时一起画(territory.ts 的 washDetail 收 WashZones),
 *     横纹在屏幕上的间距、粗细不随放大变(DETAIL_GAP_CSS、DETAIL_LINE_CSS),同样给符号让位
 *
 * 只在开着"国家"时画。
 */
import { Layer, type Civ, type Year } from '../../gen/civ/types';
import { zonesAt } from '../../gen/civ/treatyInfo';
import { pixOf } from './highlight';
import { STRIPE_ALPHA, STRIPE_GAP, STRIPE_LINE, inkOf, stripeAt, washLayer } from './territory';
import type { CivDrawParams } from './overlay';
import { reprojectImage } from '../projection';

/** 整张图:横纹间距、线宽(世界单位)、浓淡(territory.ts 的 STRIPE_*,划中立地那一页的预览也用它) */
const GAP = STRIPE_GAP;
const LINE = STRIPE_LINE;
const ALPHA = STRIPE_ALPHA;
/** 细节层:横纹间距、线宽(CSS 像素,放大多少倍屏幕上都一样)、浓淡 */
export const DETAIL_GAP_CSS = 5;
export const DETAIL_LINE_CSS = 1.7;
export const DETAIL_ALPHA = 0.75;
/**
 * 给符号让位:墨线、河流上全让开;林块、山的纸色底上只让四成(国土色块在里面几乎全让开、靠贴边的色带认疆域,
 * 中立地只有一州、多半就在林子里或山口上,全让开就看不出来了)
 */
const SOFT_GIVE = 0.4;
/** 框四周多留几个像素(抗锯齿的边) */
const BOX_PAD = 2;

/** 填色是"国家"时才画(民族、信仰、时代、管辖填色上不画;整张图、放大后的细节层、名字都一样) */
export function neutralShown(p: Pick<CivDrawParams, 'show' | 'civ'>): boolean {
  return washLayer(p as CivDrawParams) === Layer.Polity;
}

/** 这一年的中立地:州 → 第几处(−1 = 不是),每处共建几国的颜色(RGB 连着放) */
export interface NeutralZones {
  of: Int16Array;
  colors: Uint8Array[];
  /** 哪几州、谁共建(画好的那张按它认) */
  key: string;
}

/** 细节层逐格上色用(territory.ts 的 washDetail):横纹间距、线宽(世界单位)、浓淡、林块和山的纸色底上让几成 */
export interface WashZones extends NeutralZones {
  gap: number;
  line: number;
  alpha: number;
  soft: number;
}

const zoneCache = new WeakMap<Civ, { year: Year; v: NeutralZones | null }>();

/** 第 year 年的中立地(没有 = null;按 civ 记着上一次的年份) */
export function neutralZones(civ: Civ, year: Year): NeutralZones | null {
  const hit = zoneCache.get(civ);
  if (hit && hit.year === year) return hit.v;
  const zs = zonesAt(civ, year);
  let v: NeutralZones | null = null;
  if (zs.length) {
    const of = new Int16Array(civ.regions.count).fill(-1);
    const colors: Uint8Array[] = [];
    let key = '';
    zs.forEach((z, i) => {
      if (z.region < 0 || z.region >= of.length) return;
      of[z.region] = colors.length;
      const cs = z.founders.map((p) => civ.polities[p]?.color).filter((c): c is [number, number, number] => !!c);
      colors.push(Uint8Array.from((cs.length ? cs : [[150, 140, 128]]).flat()));
      key += `${i ? ',' : ''}${z.region}:${z.founders.join('.')}`;
    });
    if (colors.length) v = { of, colors, key };
  }
  zoneCache.set(civ, { year, v });
  return v;
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
interface Hit {
  raster: unknown;
  key: string;
  canvas: AnyCanvas;
  /** 有横纹的那一框(画布像素 [x0, x1) × [y0, y1));没有 = null */
  box: [number, number, number, number] | null;
}
/** 主图、地球仪贴图(让位遮罩不同)各存一份,不互相挤掉 */
const mainCache = new WeakMap<Civ, Hit>();
const globeCache = new WeakMap<Civ, Hit>();

function makeCanvas(w: number, h: number): AnyCanvas {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

/** 州 r 的外接框(栅格像素,四周留 BOX_PAD;跨过左右接缝的 = 整个宽度) */
function regionBox(p: CivDrawParams, r: number): [number, number, number, number] {
  const { world, civ, raster } = p;
  const { w, h, scale: S } = raster;
  const R = civ.regions;
  const { x, y } = world.mesh;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let k = R.cellStart[r]; k < R.cellStart[r + 1]; k++) {
    const c = R.cells[k];
    if (x[c] < x0) x0 = x[c];
    if (x[c] > x1) x1 = x[c];
    if (y[c] < y0) y0 = y[c];
    if (y[c] > y1) y1 = y[c];
  }
  if (!(x0 <= x1)) return [0, 0, 0, 0];
  // 地块中心以外还有半个地块:按平均地块大小放宽
  const pad = Math.sqrt((world.width * world.height) / Math.max(1, world.mesh.n)) * 1.5;
  const wrap = x1 - x0 > world.width / 2;
  return [
    wrap ? 0 : Math.max(0, Math.floor((x0 - pad) * S) - BOX_PAD),
    Math.max(0, Math.floor((y0 - pad) * S) - BOX_PAD),
    wrap ? w : Math.min(w, Math.ceil((x1 + pad) * S) + BOX_PAD),
    Math.min(h, Math.ceil((y1 + pad) * S) + BOX_PAD),
  ];
}

/** 这一年中立地的横纹画好的那张(raster.w × raster.h,按 civ 缓存;中立地一样就用上次画好的);不画 = null */
export function neutralCanvas(p: CivDrawParams): AnyCanvas | null {
  if (!neutralShown(p)) return null;
  const nz = neutralZones(p.civ, p.year);
  if (!nz) return null;
  const { raster, civ, world } = p;
  const cache = p.globeInk ? globeCache : mainCache;
  // 地球仪贴图另有一套让位遮罩(林块按纬度拉宽过):横纹在那上面不让位
  const ink = p.globeInk ? null : inkOf(p);
  const key = `${nz.key}|${ink ? 'ink' : ''}`;
  let hit = cache.get(civ);
  if (hit && hit.raster === raster && hit.key === key) return hit.canvas;
  const { w, h, scale: S } = raster;
  const pix = pixOf(world, raster, civ);
  const canvas = hit && hit.raster === raster ? hit.canvas : makeCanvas(w, h);
  const c = canvas.getContext('2d') as CanvasRenderingContext2D;
  c.clearRect(0, 0, w, h);
  let box: [number, number, number, number] | null = null;
  for (let r = 0; r < nz.of.length; r++) {
    const zi = nz.of[r];
    if (zi < 0) continue;
    const [x0, y0, x1, y1] = regionBox(p, r);
    const bw = x1 - x0;
    const bh = y1 - y0;
    if (bw <= 0 || bh <= 0) continue;
    const col = nz.colors[zi];
    const n = col.length / 3;
    const img = c.createImageData(bw, bh);
    const d = img.data;
    let any = false;
    for (let py = y0; py < y1; py++) {
      const s = stripeAt((py + 0.5) / S, GAP, LINE, 1 / S);
      if (s.cover <= 0) continue;
      const ci = (((s.k % n) + n) % n) * 3;
      const row = py * w;
      for (let px = x0; px < x1; px++) {
        const q = row + px;
        if (pix[q] !== r) continue;
        let a = ALPHA * s.cover;
        if (ink) {
          const give = (ink.hard[q] + ink.soft[q] * SOFT_GIVE) / 255;
          if (give >= 1) continue;
          a *= 1 - give;
        }
        const o = ((py - y0) * bw + (px - x0)) * 4;
        d[o] = col[ci];
        d[o + 1] = col[ci + 1];
        d[o + 2] = col[ci + 2];
        d[o + 3] = a * 255;
        any = true;
      }
    }
    if (!any) continue;
    // 几处中立地挨得近、框叠在一起:先画到一张小画布上再贴,不把前一处画好的抹掉
    const tile = makeCanvas(bw, bh);
    (tile.getContext('2d') as CanvasRenderingContext2D).putImageData(img, 0, 0);
    c.drawImage(tile, x0, y0);
    box = box ? [Math.min(box[0], x0), Math.min(box[1], y0), Math.max(box[2], x1), Math.max(box[3], y1)] : [x0, y0, x1, y1];
  }
  hit = { raster, key, canvas, box };
  cache.set(civ, hit);
  return canvas;
}

/** 中立地的横纹(和国土色块一样是"面",画布 = raster.w × raster.h;弯边投影按行重投影)。每帧只贴有横纹的那一框 */
export function drawNeutral(ctx: CanvasRenderingContext2D, p: CivDrawParams): void {
  const canvas = neutralCanvas(p);
  if (!canvas) return;
  const { w, h, scale: S } = p.raster;
  if (p.proj) return reprojectImage(ctx, canvas, w, h, p.proj.mp, { s: S, ox: 0, oy: 0 });
  const box = (p.globeInk ? globeCache : mainCache).get(p.civ)?.box;
  if (box === null) return;
  if (box && ctx.getTransform().isIdentity) {
    const [x0, y0, x1, y1] = box;
    ctx.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);
  } else ctx.drawImage(canvas, 0, 0);
}

/**
 * 细节层逐格上色用的中立地(色块是国家那一层、开着"国家"时;没有中立地 = null):
 * 横纹间距、线宽换算成世界单位(upp = 一个画布像素多少世界单位,dpr = 一个 CSS 像素几个画布像素)
 */
export function washZones(p: CivDrawParams, upp: number, dpr: number): WashZones | null {
  if (!neutralShown(p)) return null;
  const nz = neutralZones(p.civ, p.year);
  if (!nz || !(upp > 0)) return null;
  return { ...nz, gap: DETAIL_GAP_CSS * dpr * upp, line: DETAIL_LINE_CSS * dpr * upp, alpha: DETAIL_ALPHA, soft: SOFT_GIVE };
}

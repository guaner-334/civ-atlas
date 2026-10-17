/**
 * 物产图层:州治上的小圆章(白边 + 彩色圆底 + 一个字),大小按这一年能用多少分三档。
 *
 * - 全部显示:每州只画一个 —— 这一年能用到"多"那一档的物产里最稀有的(RARITY);稀有的先放,屏幕上挤了(GAP)就让。
 * - 只看一样:那样物产只要能用就画(小的也画),多的先放,间距放小(GAP_ONE)。
 * - 显示未发现的:还没发现的储量画成虚线灰章(白色半透明底 + 物产颜色的虚线圈;大的才写字)。
 * - 压着地名、界面的不画(调用方给判断函数)。
 */
import type { Civ, Development } from '../../gen/civ/types';
import type { World } from '../../gen/world';
import { RESOURCE_COUNT, resourcesAt } from '../../gen/civ/development';
import { toCanvas, type LabelView, type PlacedLabel } from '../labels/draw';
import { glyphBox } from '../labels/layout';
import { nearX } from '../common';

/** 圆章上的字(和 RESOURCES 一一对应) */
export const RESOURCE_GLYPHS = ['粮', '畜', '铜', '铁', '煤', '木', '盐', '渔', '油', '稀', '金'] as const;
/** 圆章的颜色 */
export const RESOURCE_COLORS = ['#c9952a', '#7d8a3a', '#c06a3a', '#4e5f80', '#3a3a3a', '#3f7a48', '#6f9cc0', '#2f78b0', '#6b4f8a', '#b0457a', '#d4a414'] as const;
/** 稀有的在前:全部显示时每州画最稀有的那一样,也先放 */
export const RESOURCE_RARITY = [9, 8, 10, 2, 4, 6, 3, 1, 7, 5, 0] as const;

/** 三档圆章的半径(CSS 像素) */
const RADIUS = [0, 4, 6.5, 8];
/** 两个圆章中心至少隔这么远(CSS 像素):全部显示 / 只看一样 */
const GAP = 30;
const GAP_ONE = 18;

/** 这一年能用多少 → 档(0 = 没有 / 1 少 / 2 中 / 3 多) */
export function resourceTier(v: number): number {
  return v > 2.3 ? 3 : v > 1.3 ? 2 : v > 0.05 ? 1 : 0;
}

export interface ResourceBadge {
  region: number;
  resource: number;
  tier: number;
  /** 还没发现(虚线灰章) */
  hidden: boolean;
}

let at: Float32Array | undefined;

/**
 * 这一年要画的圆章,按先放的顺序排好(还没按屏幕挤不挤筛)。
 * focus = 只看哪一样(null = 全部显示);hidden = 也列还没发现的储量
 */
export function resourceBadges(dev: Development, year: number, regions: number, focus: number | null, hidden: boolean): ResourceBadge[] {
  at = resourcesAt(dev, year, at);
  const tierOf = (i: number): number => {
    const t = resourceTier(at![i]);
    if (t) return t;
    return hidden && dev.found[i] > year ? -dev.resources[i] : 0;
  };
  const out: (ResourceBadge & { rank: number })[] = [];
  for (let r = 0; r < regions; r++) {
    if (focus !== null) {
      const t = tierOf(r * RESOURCE_COUNT + focus);
      if (t) out.push({ region: r, resource: focus, tier: Math.abs(t), hidden: t < 0, rank: -Math.abs(t) });
      continue;
    }
    for (let q = 0; q < RESOURCE_RARITY.length; q++) {
      const k = RESOURCE_RARITY[q];
      const t = tierOf(r * RESOURCE_COUNT + k);
      if (Math.abs(t) !== 3) continue;
      out.push({ region: r, resource: k, tier: 3, hidden: t < 0, rank: q });
      break;
    }
  }
  // 稳定排序:同档 / 同样稀有的按州的顺序
  out.sort((a, b) => a.rank - b.rank || a.region - b.region);
  return out;
}

/** 半径 r 的圆章放在 (x, y)(画布像素)会不会压着哪个地名的字(按字的实际大小、转角,再留 2 像素) */
export function hitsLabels(labels: readonly PlacedLabel[], x: number, y: number, r: number): boolean {
  return labels.some((l) =>
    l.glyphs.some((g) => {
      const b = glyphBox(g, l.px, r + 2);
      return x > b[0] && x < b[2] && y > b[1] && y < b[3];
    }),
  );
}

/**
 * 按屏幕位置画圆章:pos 给州治在画布上的位置(看不见 = null),blocked 判断那里(半径 r 的圆章)压没压着地名、界面。
 * 返回画了几个
 */
export function drawResourceBadges(
  ctx: CanvasRenderingContext2D,
  badges: readonly ResourceBadge[],
  pos: (region: number) => [number, number] | null,
  blocked: (x: number, y: number, r: number) => boolean,
  focus: boolean,
  dpr: number,
): number {
  const gap = (focus ? GAP_ONE : GAP) * dpr;
  const put: [number, number][] = [];
  for (const b of badges) {
    const p = pos(b.region);
    if (!p) continue;
    const [x, y] = p;
    if (blocked(x, y, RADIUS[Math.max(1, Math.min(3, b.tier))] * dpr) || put.some(([px, py]) => Math.hypot(px - x, py - y) < gap)) continue;
    put.push([x, y]);
    drawResourceBadge(ctx, x, y, b.resource, b.tier, b.hidden, dpr);
  }
  return put.length;
}

/** 一个圆章(画在设备像素坐标上) */
export function drawResourceBadge(ctx: CanvasRenderingContext2D, x: number, y: number, k: number, tier: number, hidden: boolean, dpr: number) {
  const rad = RADIUS[Math.max(1, Math.min(3, tier))] * dpr;
  const color = RESOURCE_COLORS[k];
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (hidden) {
    ctx.beginPath();
    ctx.arc(x, y, rad - 1, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.setLineDash([2 * dpr, 2 * dpr]);
    ctx.lineWidth = 1.2 * dpr;
    ctx.strokeStyle = color;
    ctx.stroke();
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 2 * dpr;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.beginPath();
    ctx.arc(x, y, rad - 1.5 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
  if (tier >= 2) {
    ctx.fillStyle = hidden ? color : '#fff';
    ctx.font = `600 ${(tier === 3 ? 10 : 8) * dpr}px "PingFang SC", "WenQuanYi Zen Hei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(RESOURCE_GLYPHS[k], x, y + 0.5 * dpr);
  }
  ctx.restore();
}

/** 物产图层怎么看:只看哪一样(null = 全部)、画不画还没发现的 */
export interface ResourceLook {
  focus: number | null;
  hidden: boolean;
}

/**
 * 在排好地名的画布上画圆章(屏幕上的文字层、导出图共用):州治按 lv 换到画布上,画布外的、压着地名的、
 * blocked 说压着界面的不画。返回画了几个
 */
export function drawResourceLayer(
  ctx: CanvasRenderingContext2D,
  civ: Civ,
  world: World,
  year: number,
  lv: LabelView,
  labels: readonly PlacedLabel[],
  look: ResourceLook = { focus: null, hidden: false },
  blocked?: (x: number, y: number) => boolean,
  badges?: readonly ResourceBadge[],
): number {
  const dev = civ.development;
  if (!dev) return 0;
  const list = badges ?? resourceBadges(dev, year, civ.regions.count, look.focus, look.hidden);
  const W = lv.canvasW ?? ctx.canvas.width;
  const H = lv.canvasH ?? ctx.canvas.height;
  const cx = (W / 2 - lv.ox) / lv.scale;
  return drawResourceBadges(
    ctx,
    list,
    (r) => {
      const c = civ.regions.seat[r];
      const wx = world.mesh.x[c];
      const wy = world.mesh.y[c];
      const [x, y] = lv.proj ? toCanvas(lv, wx, wy) : [nearX(wx, cx, lv.wrap ?? 0) * lv.scale + lv.ox, wy * lv.scale + lv.oy];
      return Number.isFinite(x) && x >= 0 && y >= 0 && x <= W && y <= H ? [x, y] : null;
    },
    (x, y, r) => !!blocked?.(x, y) || hitsLabels(labels, x, y, r),
    look.focus !== null,
    lv.dpr,
  );
}

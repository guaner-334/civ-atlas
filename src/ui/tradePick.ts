/**
 * 地图上的商道(render/civ/trade.ts 画在文字层上;地球仪上 render/globeTrade.ts 画在球面那层上):点选、悬停。
 *
 *   - 文字层(地球仪:球面那层)每画一次记下这一次画的各条商道(画布像素的折线,setTradeHits);鼠标、手指的位置换成画布像素,
 *     离哪条线够近(线宽的一半 + SLOP 个屏幕像素)就是哪条,几条叠在一起取最近的。
 *     平面地图、地球仪各记各的(地球仪开着时平面地图的文字层还在、也会重画)
 *   - 鼠标停着的那条(useTradeHover):那条亮一圈;悬停小卡的内容见 tradeHoverInfo
 */
import { useSyncExternalStore } from 'react';
import type { Civ } from '../gen/civ/types';
import type { TradeHit } from '../render/civ/trade';
import type { LabelView } from '../render/labels/draw';
import { TRADE_INK } from '../render/civ/trade';
import { regionLabel } from '../gen/civ/story/display';
import { goodsAt, goodsText, tradeCapital, tradeStateAt } from '../gen/civ/story/tradeText';
import { yearAt, type Era } from '../gen/era';
import type { HoverInfo } from './hoverInfo';

/** 离线多远(屏幕像素)还算点到 */
const SLOP = 4;

/** 画在哪:平面地图 / 地球仪 */
export type TradeSurface = 'map' | 'globe';

interface Drawn {
  canvas: HTMLCanvasElement;
  hits: TradeHit[];
  view?: LabelView;
}
const last: Record<TradeSurface, Drawn | null> = { map: null, globe: null };
/** 测试入口的名字:画了哪几条;某一条线上第 f(0–1)处在屏幕上的位置(截图、冒烟测试把鼠标挪过去用) */
const HOOK: Record<TradeSurface, string> = { map: '__wfTrade', globe: '__wfGlobeTrade' };

/** 画完商道以后记下(没画 = null;view = 文字层的视口,弯边投影时外轮廓外面不算点到) */
export function setTradeHits(s: Drawn | null, where: TradeSurface = 'map') {
  const d = (last[where] = s && s.hits.length ? s : null);
  (window as unknown as Record<string, unknown>)[HOOK[where]] = {
    ids: d ? d.hits.map((h) => h.id) : [],
    at: (id: number, f = 0.5) => tradePoint(where, id, f),
  };
}

/** 第 id 条商道线上第 f 处(按点数)的屏幕坐标;没画 = null */
function tradePoint(where: TradeSurface, id: number, f: number): [number, number] | null {
  const d = last[where];
  const h = d?.hits.find((x) => x.id === id);
  if (!d || !h) return null;
  const r = d.canvas.getBoundingClientRect();
  const k = r.width / d.canvas.width;
  for (const pl of h.polys) {
    const n = pl.length >> 1;
    const i = Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))));
    const x = r.left + pl[i * 2] * k;
    const y = r.top + pl[i * 2 + 1] * k;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return [x, y];
  }
  return null;
}

/** 点到 / 鼠标停着的商道(屏幕坐标);没有 = null */
export function tradeAtClient(clientX: number, clientY: number, where: TradeSurface = 'map'): number | null {
  const d = last[where];
  if (!d || !d.canvas.isConnected) return null;
  const { canvas, hits } = d;
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height || !canvas.width) return null;
  const f = canvas.width / r.width;
  const x = (clientX - r.left) * f;
  const y = (clientY - r.top) * f;
  // 画布外面、弯边投影的外轮廓外面(伸出去的那截没画)不算
  if (x < 0 || y < 0 || x > canvas.width || y > canvas.height) return null;
  const v = d.view;
  if (v?.proj && !v.proj.inside((x - v.ox) / v.scale, (y - v.oy) / v.scale, 0)) return null;
  let best: number | null = null;
  let bestD = Infinity;
  for (const h of hits) {
    const tol = h.half + SLOP * f;
    for (const pl of h.polys) {
      for (let i = 2; i < pl.length; i += 2) {
        const dd = segDist(x, y, pl[i - 2], pl[i - 1], pl[i], pl[i + 1]);
        if (dd <= tol && dd < bestD) {
          bestD = dd;
          best = h.id;
        }
      }
    }
  }
  return best;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

// ---- 鼠标停着的那条 ----

let hover: number | null = null;
const subs = new Set<() => void>();

export function setTradeHover(id: number | null) {
  if (id === hover) return;
  hover = id;
  for (const f of subs) f();
}

export function useTradeHover(): number | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => hover,
  );
}

/** 悬停小卡:色块、名字、"商道，运铁";下一行起止和通断("万兴郡 → 提罗斯，通（2217 年复通）") */
export function tradeHoverInfo(civ: Civ, id: number, year: number, era: Era | null): HoverInfo | null {
  const r = civ.trade?.routes[id];
  if (!r) return null;
  const cap = civ.settlements[tradeCapital(civ, r, year)];
  const { state, event } = tradeStateAt(r, year);
  const when = event ? yearAt(Math.floor(event.year), era) : '';
  const now =
    state === 'broken'
      ? `断（${when}起）`
      : state === 'ended'
        ? `废（${when}）`
        : state === 'before'
          ? `未通（${yearAt(Math.floor(r.events[0].year), era)}才通）`
          : `通（${when}${event?.kind === 'reopen' ? '复通' : '通'}）`;
  return {
    color: TRADE_INK,
    name: r.name,
    sub: `商道，运${goodsText(goodsAt(r, year))}`,
    extra: `${regionLabel(civ, r.from)} → ${cap ? cap.name : '—'}，${now}`,
  };
}

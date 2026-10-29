/**
 * 地图上的小牌子(天灾页"翼门之野一带 8 州"、大迁徙页"从这里出发",TargetPlates.tsx 的 MapTag)摆在哪:
 * 默认在那个地块正下方居中;会被右边那排按钮挡住时(电脑:右上的填色条和编年史、助手,右下的立体 / 导播 / 标记 / 地球 / 缩放那一列;
 * 手机:右上那一列),在"挪到按钮左边""翻到地块上方""挪到按钮下面"几处里挑离原位最近、不压按钮、不出屏幕的;
 * 哪处都不行就照原位。坐标都是屏幕坐标(和 getBoundingClientRect 一样)。
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 牌子要躲开的按钮(一个按钮或一组连着的按钮一个框) */
export const TAG_AVOID = '.map-bar > *, .map-controls > *, .phone-btns > *';

/** 牌子和按钮之间至少留这么宽 */
const GAP = 6;
/** 牌子上沿离地块这么远(翻到上方时是下沿) */
const DROP = 16;

/**
 * 牌子左上角放在哪:(ax, ay) 是地块在屏幕上的位置,w × h 是牌子的大小,blocks 是要躲开的按钮,vw × vh 是窗口大小
 */
export function tagSpot(ax: number, ay: number, w: number, h: number, blocks: readonly Box[], vw: number, vh: number): [number, number] {
  const x0 = ax - w / 2;
  const y0 = ay + DROP;
  const hits = (x: number, y: number) => blocks.some((b) => x < b.right + GAP && x + w > b.left - GAP && y < b.bottom + GAP && y + h > b.top - GAP);
  if (!hits(x0, y0)) return [x0, y0];
  const up = ay - DROP - h;
  const spots: [number, number][] = [[x0, up]];
  for (const b of blocks) {
    const left = b.left - GAP - w;
    spots.push([left, y0], [left, up], [x0, b.bottom + GAP]);
  }
  let best: [number, number] = [x0, y0];
  let far = Infinity;
  for (const [x, y] of spots) {
    if (x < 0 || y < 0 || x + w > vw || y + h > vh || hits(x, y)) continue;
    const d = Math.hypot(x - x0, y - y0);
    if (d < far) {
      far = d;
      best = [x, y];
    }
  }
  return best;
}

/** 现在页面上看得见的、牌子要躲开的按钮 */
export function tagBlocks(): Box[] {
  const out: Box[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(TAG_AVOID)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0 || getComputedStyle(el).visibility === 'hidden') continue;
    out.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
}

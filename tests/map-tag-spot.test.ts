/**
 * 地图上的小牌子(天灾页、大迁徙页,src/ui/tagSpot.ts)躲开右边那排按钮:平时在地块正下方居中;
 * 会被按钮挡住时挪到按钮左边、翻到地块上方或挪到按钮下面,挑离原位最近、不压按钮、不出窗口的。
 */
import { describe, expect, it } from 'vitest';
import { tagSpot, type Box } from '../src/ui/tagSpot';

const W = 96;
const H = 24;
const overlaps = (x: number, y: number, b: Box) => x < b.right && x + W > b.left && y < b.bottom && y + H > b.top;

describe('地图小牌子躲开右边的按钮', () => {
  // 电脑:右下那一列(立体 / 导播 / 标记 / 地球 + 缩放),右上的填色条
  const column: Box[] = [
    { left: 1317, top: 452, right: 1386, bottom: 490 },
    { left: 1317, top: 500, right: 1386, bottom: 538 },
    { left: 1317, top: 548, right: 1386, bottom: 586 },
    { left: 1317, top: 596, right: 1386, bottom: 634 },
    { left: 1350, top: 644, right: 1386, bottom: 716 },
  ];
  const bar: Box = { left: 800, top: 14, right: 1386, bottom: 50 };
  const blocks = [...column, bar];

  it('不挨着按钮:照旧在地块正下方居中', () => {
    expect(tagSpot(700, 400, W, H, blocks, 1400, 820)).toEqual([700 - W / 2, 416]);
  });

  it('贴着右下那一列:挪到按钮左边,高低不变', () => {
    const [x, y] = tagSpot(1320, 540, W, H, blocks, 1400, 820);
    expect(y).toBe(556);
    expect(x + W).toBeLessThanOrEqual(1317 - 6);
    for (const b of blocks) expect(overlaps(x, y, b)).toBe(false);
  });

  it('压在缩放按钮上:左边让开缩放按钮,也不碰上面那几个', () => {
    const [x, y] = tagSpot(1370, 640, W, H, blocks, 1400, 820);
    for (const b of blocks) expect(overlaps(x, y, b)).toBe(false);
    expect(Math.abs(x + W / 2 - 1370) + Math.abs(y - 656)).toBeLessThan(140);
  });

  it('右上的填色条下面:挪到填色条下方(不往左挪出老远)', () => {
    const [x, y] = tagSpot(1000, 20, W, H, blocks, 1400, 820);
    expect(x).toBe(1000 - W / 2);
    expect(y).toBeGreaterThanOrEqual(50 + 6);
  });

  it('手机右上那一列:挪到左边;贴着右边窗口的也不出窗口', () => {
    const phone: Box[] = [{ left: 334, top: 12, right: 378, bottom: 276 }];
    const [x, y] = tagSpot(370, 60, W, H, phone, 390, 844);
    expect(x + W).toBeLessThanOrEqual(334 - 6);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBe(76);
  });

  it('哪处都躲不开:照原位', () => {
    const wall: Box[] = [{ left: 0, top: 0, right: 400, bottom: 800 }];
    expect(tagSpot(200, 300, W, H, wall, 400, 800)).toEqual([200 - W / 2, 316]);
  });
});

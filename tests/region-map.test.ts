/**
 * 地区图(框一块单独画成一页,render/regionMap.ts、ui/terrain3dStore.ts):
 *   - 投影:中央经线 = 框中心,东西方向按框中心纬线收回去(低纬几乎不变、高纬收得多),来回换算对得上
 *   - 一页的大小:地图 1200 宽、高按公里数;交给 MapShot 的范围正好框住这一块,字按 D 倍
 *   - 地形贴图的密度:南北方向和地图一样细,高纬度东西方向最多多铺 1.6 倍
 *   - 山峰:找局部最高、按海拔排、离得太近的只留高的、贴边的和太矮的不算;写成 ▲ + 海拔
 *   - 经纬度刻度、比例尺一格取整齐的数
 *   - 「地区」的状态:看这一块先看平面图,山脉卡片直接立体;换了框标题回到按地名起;回到地图留下刚才的框
 */
import { describe, expect, it } from 'vitest';
import { findPeaks, peakItems, regionArea, regionPage, regionProj, scaleUnit, terrainScale, tickStep } from '../src/render/regionMap';
import { projectWorld, unprojectWorld } from '../src/render/projection';
import { boxKm } from '../src/render/terrain3d/box';
import type { LabelView } from '../src/render/labels/draw';
import { closeRelief, getRelief, openReliefAt, openReliefPick, openReliefView, setRegionTitle, setReliefFace } from '../src/ui/terrain3dStore';

const W = 2048;
const H = 1024;

describe('投影', () => {
  it('框中心落在地图平面正中;东西方向 × cos(框中心纬度)', () => {
    const box = { cx: 1470, cy: 440, w: 70, h: 46 };
    const mp = regionProj(box, W, H);
    const [x, y] = projectWorld(mp, box.cx, box.cy);
    expect(x).toBeCloseTo(W / 2, 6);
    expect(y).toBeCloseTo(box.cy, 6);
    const lat = 90 - (box.cy / H) * 180;
    const c = Math.cos((lat * Math.PI) / 180);
    const [x1] = projectWorld(mp, box.cx + 10, box.cy + 20);
    expect(x1 - W / 2).toBeCloseTo(10 * c, 6);
  });

  it('高纬度收得多;来回换算回到原处(跨过左右接缝的框也一样)', () => {
    const box = { cx: 5, cy: 120, w: 40, h: 30 };
    const mp = regionProj(box, W, H);
    expect(mp.def.kx(0)).toBeLessThan(0.5);
    for (const [wx, wy] of [
      [5, 120],
      [W - 10, 110],
      [20, 135],
    ]) {
      const [mx, my] = projectWorld(mp, wx, wy);
      const back = unprojectWorld(mp, mx, my)!;
      expect(back[0]).toBeCloseTo(wx, 4);
      expect(back[1]).toBeCloseTo(wy, 4);
    }
  });
});

describe('一页', () => {
  it('地图 1200 宽,高按公里数;四周留出标题、图例', () => {
    const box = { cx: 1470, cy: 440, w: 70, h: 46 };
    const p = regionPage(box, H);
    const km = boxKm(box, H);
    expect(p.mapW).toBe(1200);
    expect(Math.abs(p.mapH - (1200 * km.h) / km.w)).toBeLessThanOrEqual(0.5);
    expect(p.w).toBe(1280);
    expect(p.h).toBeGreaterThan(p.mapH + 150);
    expect(p.mx).toBeGreaterThan(0);
    expect(p.my).toBeGreaterThan(40);
  });

  it('交给 MapShot 的范围正好框住这一块、字按 D 倍;写实的国家颜色淡一半,手绘照旧', () => {
    const box = { cx: 1470, cy: 440, w: 70, h: 46 };
    const MW = 2400;
    const a = regionArea(box, W, H, MW, 2, 'realistic', []);
    const [x0, y0] = projectWorld(a.mp, box.cx - box.w / 2, box.cy - box.h / 2);
    const [x1, y1] = projectWorld(a.mp, box.cx + box.w / 2, box.cy + box.h / 2);
    expect(a.x0).toBeCloseTo(x0, 4);
    expect(a.x1).toBeCloseTo(x1, 4);
    expect(a.y0).toBeCloseTo(y0, 4);
    expect(a.y1).toBeCloseTo(y1, 4);
    // MapShot:dpr = 每单位像素 × 世界宽 / (mapCss × k)
    const s = MW / (a.x1 - a.x0);
    expect((s * W) / (a.mapCss * a.k)).toBeCloseTo(2, 6);
    expect(a.textK).toBeLessThan(a.k);
    expect(a.civAlpha).toBe(0.5);
    expect(regionArea(box, W, H, MW, 2, 'fantasy', []).civAlpha).toBe(1);
  });

  it('地形贴图:南北方向和地图一样细;高纬度东西方向最多多铺 1.6 倍', () => {
    const low = { cx: 1470, cy: 440, w: 70, h: 46 };
    const pl = regionPage(low, H);
    const S = terrainScale(low, pl.mapW * 2, pl.mapH * 2);
    expect(S).toBeCloseTo((pl.mapH * 2) / low.h, 6);
    const high = { cx: 300, cy: 100, w: 120, h: 30 };
    const ph = regionPage(high, H);
    const Sh = terrainScale(high, ph.mapW * 2, ph.mapH * 2);
    expect(high.w * Sh).toBeLessThanOrEqual(1.6 * ph.mapW * 2 + 1e-6);
  });
});

describe('山峰', () => {
  /** 一块 200 × 150 的地形,每世界单位 4 像素;几个高斯山包 */
  function terrain(bumps: [number, number, number][]): Float32Array {
    const w = 200;
    const h = 150;
    const e = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = 200;
        for (const [bx, by, top] of bumps) v = Math.max(v, top * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / 120));
        e[y * w + x] = v;
      }
    return e;
  }

  it('局部最高、按海拔排;离得太近只留高的;贴边、太矮的不算', () => {
    const e = terrain([
      [60, 70, 3500],
      [150, 60, 4200],
      [156, 66, 4000],
      [100, 120, 900],
      [2, 70, 5000],
    ]);
    const S = 4;
    const peaks = findPeaks(e, 200, 150, S, 400, 800, 50);
    expect(peaks.map((p) => Math.round(p.e))).toEqual([4200, 3500]);
    expect(peaks[0].x).toBeCloseTo((400 + 150 + 0.5) / S, 6);
    expect(peaks[0].y).toBeCloseTo((800 + 60 + 0.5) / S, 6);
  });

  it('写成 ▲ + 海拔;▲ 落在山顶(按投影换到画布上)', () => {
    const items = peakItems([{ x: 100, y: 50, e: 3850.4 }], 'realistic');
    expect(items[0].text).toBe('▲3850');
    const view = { scale: 2, ox: -10, oy: 4, dpr: 2, k: 10, mapCss: 1300, worldW: W, worldH: H } as LabelView;
    const cands = [...items[0].place!(10, view)];
    expect(cands.length).toBe(4);
    for (const c of cands) {
      expect(c.glyphs[0].ch).toBe('▲');
      expect(c.glyphs[0].x).toBeCloseTo(190, 6);
      expect(c.glyphs[0].y).toBeCloseTo(104, 6);
    }
  });
});

describe('四周', () => {
  it('经纬度刻度每边写两到五个', () => {
    expect(tickStep(4)).toBe(1);
    expect(tickStep(12.3)).toBe(5);
    expect(tickStep(30)).toBe(10);
  });
  it('比例尺三格至少约 150 像素,取整齐的数', () => {
    // 1330 公里画 1200 像素宽
    expect(scaleUnit(1330 / 1200)).toBe(100);
    expect(scaleUnit(300 / 1200)).toBe(25);
    expect(scaleUnit(2000 / 1200)).toBe(100);
  });
});

describe('「地区」的状态', () => {
  const box = { cx: 1470, cy: 440, w: 70, h: 46 };
  it('看这一块先看平面图;底条上切到立体;山脉卡片直接立体', () => {
    openReliefPick();
    expect(getRelief().phase).toBe('pick');
    openReliefView(box);
    expect(getRelief().phase).toBe('view');
    expect(getRelief().face).toBe('flat');
    setReliefFace('relief');
    expect(getRelief().face).toBe('relief');
    closeRelief();
    openReliefAt({ ...box, cx: 1000 });
    expect(getRelief().face).toBe('relief');
    closeRelief();
  });

  it('改过的标题跟着这个框;换了框回到按地名起;回到地图留下刚才的框', () => {
    openReliefView(box);
    setRegionTitle('  我的山  ');
    expect(getRelief().title).toBe('我的山');
    openReliefView({ ...box });
    expect(getRelief().title).toBe('我的山');
    openReliefView({ ...box, cx: 1400 });
    expect(getRelief().title).toBeNull();
    setRegionTitle('   ');
    expect(getRelief().title).toBeNull();
    closeRelief();
    const r = getRelief();
    expect(r.phase).toBe('off');
    expect(r.ghost?.box.cx).toBe(1400);
    expect(r.box?.cx).toBe(1400);
  });
});

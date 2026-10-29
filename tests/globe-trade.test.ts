/**
 * 地球仪上的商道(render/globeTrade.ts)纯计算的部分:路线换成线组(按路线缓存)、按这一帧的投影描成画布上的折线
 * (背面的裁掉、跨 180° 经线不断)、字框在不在球面上。
 */
import { describe, expect, it } from 'vitest';
import { globeFrame, lonLatToWorld, type GlobeView } from '../src/render/globe';
import { globeProjector } from '../src/render/globeLines';
import { boxOnGlobe, globeTradeSet, traceGlobePolys } from '../src/render/globeTrade';

const D = Math.PI / 180;
const W = 2048;
const H = 1024;

/** 经纬度(度)的一串点 → 世界坐标的折线(x 按相邻两点接着走,可以伸出主图左右边;和商道的路线一样) */
function route(pts: [number, number][]): Float32Array {
  const out: number[] = [];
  for (const [lon, lat] of pts) {
    let [x, y] = lonLatToWorld(lon * D, lat * D, W, H);
    if (out.length) x -= W * Math.round((x - out[out.length - 2]) / W);
    out.push(x, y);
  }
  return Float32Array.from(out);
}

function projectorAt(lon: number, lat: number, w = 800, h = 600) {
  const view: GlobeView = { lon: lon * D, lat: lat * D, k: 1 };
  const f = globeFrame(view, w, h);
  return { P: globeProjector(view, f), f };
}

describe('地球仪上的商道', () => {
  it('同一条路线只建一次线组', () => {
    const pts = route([
      [10, 20],
      [20, 25],
      [30, 22],
    ]);
    expect(globeTradeSet(pts, W, H)).toBe(globeTradeSet(pts, W, H));
    expect(globeTradeSet(pts, W, H).vertices).toBeGreaterThan(3);
  });

  it('正面的路线描成一段连着的折线,点都在球上;转到背面就不画', () => {
    const pts = route([
      [-10, 0],
      [0, 5],
      [10, 0],
    ]);
    const set = globeTradeSet(pts, W, H);
    const { P, f } = projectorAt(0, 0);
    const polys = traceGlobePolys(set, P, 8);
    expect(polys.length).toBe(1);
    for (const pl of polys)
      for (let i = 0; i < pl.length; i += 2) expect(Math.hypot(pl[i] - f.cx, pl[i + 1] - f.cy)).toBeLessThanOrEqual(f.R + 1e-6);
    // 从左往右:西边的一头在左
    expect(polys[0][0]).toBeLessThan(polys[0][polys[0].length - 2]);
    expect(traceGlobePolys(set, projectorAt(180, 0).P, 8)).toEqual([]);
  });

  it('跨 180° 经线的路线不断开;一头转到背面时在球的轮廓上断开', () => {
    const across = globeTradeSet(
      route([
        [170, 10],
        [180, 12],
        [-170, 10],
      ]),
      W,
      H,
    );
    expect(traceGlobePolys(across, projectorAt(180, 10).P, 8).length).toBe(1);
    // 从正面一直走到背面:只剩正面那一截,收在轮廓上
    const long = globeTradeSet(
      route([
        [0, 0],
        [60, 0],
        [120, 0],
      ]),
      W,
      H,
    );
    const { P, f } = projectorAt(0, 0);
    const polys = traceGlobePolys(long, P, 8);
    expect(polys.length).toBe(1);
    const pl = polys[0];
    expect(Math.hypot(pl[pl.length - 2] - f.cx, pl[pl.length - 1] - f.cy)).toBeCloseTo(f.R, 3);
  });

  it('字框的四个角都在球面上(离轮廓还有一点距离)才算', () => {
    const g = { cx: 400, cy: 300, R: 200 };
    expect(boxOnGlobe([390, 290, 410, 310], g)).toBe(true);
    expect(boxOnGlobe([590, 290, 610, 310], g)).toBe(false);
    expect(boxOnGlobe([585, 280, 599, 320], g)).toBe(false);
  });
});

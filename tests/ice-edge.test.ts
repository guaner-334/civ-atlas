/**
 * 手绘风放大后的冰缘(矢量):冰面填色范围(按非零环绕规则填,和像素图上的冰逐像素对得上)、东西相连、
 * 零星浮冰和冰间水道、只在挨着海面的那几截描墨线、冰缘带。(真正的画面在 scripts/snap.ts 放大截图里看)
 */
import { describe, expect, it } from 'vitest';
import { clipLoopRect, fillLoops, forTilesIn, iceBand, iceLines, inkRuns, tileLoops, traceOriented, type OrientedLine, type TileGrid } from '../src/render/fantasy';

const w = 64;
const h = 32;
const W = w;

/** 一张小图:全是海(scale = 1);ice(x, y) 为真的海面像素结冰,land(x, y) 为真的是陆地 */
function grid(ice: (x: number, y: number) => boolean, land: (x: number, y: number) => boolean = () => false) {
  const water = new Uint8Array(w * h);
  const iceM = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      const isLand = land(x, y);
      water[k] = isLand ? 0 : 1;
      iceM[k] = !isLand && ice(x, y) ? 1 : 0;
    }
  return { r: { w, h, scale: 1, water }, iceM };
}

/** 点 (px, py) 在多边形(首尾自动相连)里的环绕数 */
function winding(p: ArrayLike<number>, px: number, py: number): number {
  let wn = 0;
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    const ax = p[i * 2];
    const ay = p[i * 2 + 1];
    const bx = p[j * 2];
    const by = p[j * 2 + 1];
    const side = (bx - ax) * (py - ay) - (px - ax) * (by - ay);
    if (ay <= py) {
      if (by > py && side > 0) wn++;
    } else if (by <= py && side < 0) wn--;
  }
  return wn;
}

/** 格子:4 × 2 格铺满一圈(同 fantasy.ts 等距圆柱的切法,格子小一点好测切开的地方) */
const tiling: TileGrid = { x0: 0, y0: 0, tw: W / 4, th: h / 2, nc: 4, nr: 2 };

/** 范围 [x0, x1] × [y0, y1] 里填色的子路径(同 fantasy.ts 的 tilePathIn:闭合多边形 → 切进格子 → 挑范围附近的格子,伸出左右边的平移整圈) */
function fillPolys(lines: OrientedLine[], x0: number, y0: number, x1: number, y1: number): number[][] {
  const tiles = tileLoops(fillLoops(lines, W, h), tiling, 0);
  const out: number[][] = [];
  forTilesIn(tiling, W, x0, y0, x1, y1, (i, dx) => {
    for (const q of tiles[i]) out.push(q.map((v, j) => (j % 2 ? v : v + dx)));
  });
  return out;
}

/**
 * 范围里每个像素中心:填色(环绕数非零)⇔ 这个像素结冰(x 按东西相连折回图里)。
 * 冰在左手边(y 朝下)的线,按 winding() 的算法里面是 −1;不论正负,里面处处同一个值、外面处处 0
 */
function expectFillMatches(lines: OrientedLine[], iceM: Uint8Array, x0: number, x1: number, y0 = 0, y1 = h) {
  const polys = fillPolys(lines, x0, y0, x1, y1);
  const bad: string[] = [];
  const IN = -1;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(h, Math.ceil(y1)); y++)
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (cx < x0 || cx > x1 || cy < y0 || cy > y1) continue;
      let wn = 0;
      for (const p of polys) wn += winding(p, cx, cy);
      const want = iceM[y * w + ((x % w) + w) % w] ? 1 : 0;
      if (wn !== (want ? IN : 0)) bad.push(`(${x},${y}) wn=${wn} ice=${want}`);
    }
  expect(bad).toEqual([]);
}

/** 一块不规则的冰:几个圆叠起来,再挖一个洞(冰间水道) */
const blob = (x: number, y: number) =>
  (Math.hypot(x - 20, y - 14) < 6.5 || Math.hypot(x - 27, y - 17) < 4.2 || Math.hypot(x - 15, y - 19) < 3) && !(x === 20 && y === 14);

describe('冰的分界线(有方向,冰在左手边)', () => {
  it('不规则冰块 + 里面的洞:每个像素中心按环绕数判断,和冰像素一一对上', () => {
    const { r, iceM } = grid(blob);
    const lines = iceLines(r, iceM);
    // 外圈 + 洞
    expect(lines.length).toBe(2);
    for (const l of lines) expect(l.wrap).toBe(0);
    expectFillMatches(lines, iceM, 0, w);
  });

  it('洞和外圈方向相反(洞里环绕数回到 0)', () => {
    const { r, iceM } = grid(blob);
    const lines = iceLines(r, iceM);
    const area = (p: Float32Array) => {
      let a = 0;
      for (let i = 0; i < p.length; i += 2) {
        const j = (i + 2) % p.length;
        a += p[i] * p[j + 1] - p[j] * p[i + 1];
      }
      return a / 2;
    };
    const [a0, a1] = lines.map((l) => area(l.pts));
    expect(Math.sign(a0)).toBe(-Math.sign(a1));
  });

  it('零星的一格浮冰也圈出来(小圈,圈住像素中心)', () => {
    const { r, iceM } = grid((x, y) => (x === 40 && y === 10) || (x === 50 && y === 20) || (x === 51 && y === 21));
    const lines = iceLines(r, iceM);
    // 斜着挨着的两格按走方格的规则可能连成一块,也可能分开;至少圈出两块,每一格都被圈住
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expectFillMatches(lines, iceM, 0, w);
    for (const l of lines) {
      const xs = Array.from(l.pts).filter((_, i) => i % 2 === 0);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(2.5);
    }
  });

  it('跨 180° 经线的冰块:线的 x 连续展开,左右两边都填对', () => {
    const { r, iceM } = grid((x, y) => Math.hypot(Math.min(x, w - x) - 0.5, y - 16) < 5);
    const lines = iceLines(r, iceM);
    expect(lines.length).toBe(1);
    expect(lines[0].wrap).toBe(0);
    const p = lines[0].pts;
    for (let i = 2; i < p.length; i += 2) expect(Math.abs(p[i] - p[i - 2])).toBeLessThan(2);
    // 视口伸出左边、右边各一截
    expectFillMatches(lines, iceM, -12, 12);
    expectFillMatches(lines, iceM, w - 12, w + 12);
  });

  it('极地冰盖(从地图上边一直到冰缘,绕地球一圈):补上矩形后,冰缘以上是冰、以下是海', () => {
    // 冰缘随经度起伏,带两块零星浮冰、一块陆地(冰在陆地那边收住)
    const cap = (x: number, y: number) => y < 8 + Math.round(3 * Math.sin((x / w) * 2 * Math.PI * 3)) || (x === 30 && y === 15);
    const land = (x: number, y: number) => x >= 40 && x < 46 && y >= 4 && y < 12;
    const { r, iceM } = grid(cap, land);
    const lines = iceLines(r, iceM);
    // 绕一圈的:冰缘(要描墨线)+ 地图上边(不描)
    const caps = lines.filter((l) => l.wrap !== 0);
    expect(caps.length).toBe(2);
    expect(caps.filter((l) => l.ink.some((v) => v)).length).toBe(1);
    expectFillMatches(lines, iceM, 0, w);
    expectFillMatches(lines, iceM, -20, 20);
    expectFillMatches(lines, iceM, 50, 90, 3, 20);
    // 视口整个在冰缘以下 / 以上
    expectFillMatches(lines, iceM, 10, 30, 13, 32);
    expectFillMatches(lines, iceM, 10, 30, 0, 3);
  });

  it('南极冰盖(从冰缘一直到地图下边)也一样', () => {
    const { r, iceM } = grid((x, y) => y >= 24 + Math.round(2 * Math.cos((x / w) * 2 * Math.PI * 2)));
    const lines = iceLines(r, iceM);
    expect(lines.filter((l) => l.wrap !== 0 && l.ink.some((v) => v)).length).toBe(1);
    expectFillMatches(lines, iceM, 0, w);
    expectFillMatches(lines, iceM, -30, 10);
  });

  it('两个冰盖都在、中间还有浮冰', () => {
    const { r, iceM } = grid((x, y) => y < 5 + (x % 7 === 0 ? 1 : 0) || y >= 27 || (x === 33 && y === 16));
    const lines = iceLines(r, iceM);
    expect(lines.filter((l) => l.wrap !== 0 && l.ink.some((v) => v)).length).toBe(2);
    expectFillMatches(lines, iceM, -5, w + 5);
  });

  it('切进格子后每格的多边形都在自己的格子里,伸出地图的部分不要', () => {
    const { r, iceM } = grid((x, y) => y < 6 || y >= 29 || blob(x, y) || (x === 63 && y === 15));
    const tiles = tileLoops(fillLoops(iceLines(r, iceM), W, h), tiling, 0);
    tiles.forEach((polys, i) => {
      const c = i % tiling.nc;
      const rr = (i - c) / tiling.nc;
      for (const q of polys)
        for (let j = 0; j < q.length; j += 2) {
          expect(q[j]).toBeGreaterThanOrEqual(c * tiling.tw - 1e-9);
          expect(q[j]).toBeLessThanOrEqual((c + 1) * tiling.tw + 1e-9);
          expect(q[j + 1]).toBeGreaterThanOrEqual(rr * tiling.th - 1e-9);
          expect(q[j + 1]).toBeLessThanOrEqual((rr + 1) * tiling.th + 1e-9);
        }
    });
  });

  it('traceOriented 走出来的每条线都首尾相接(最后一点离首点不到一格;绕一圈的接回首点 + 一圈)', () => {
    const { r, iceM } = grid((x, y) => y < 6 || blob(x, y));
    for (const l of traceOriented(r, iceM, () => 0.5, () => 0)) {
      const n = l.pts.length;
      const dx = l.pts[0] + l.wrap * W - l.pts[n - 2];
      const dy = l.pts[1] - l.pts[n - 1];
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(1 + 1e-6);
    }
  });
});

describe('冰缘墨线只描挨着海面的那几截', () => {
  it('冰块西边贴着陆地:贴陆地那一截不描,其余连成一截', () => {
    const { r, iceM } = grid(
      (x, y) => x >= 10 && x < 20 && y >= 8 && y < 16,
      (x) => x < 10,
    );
    const lines = iceLines(r, iceM).filter((l) => l.wrap === 0);
    expect(lines.length).toBe(1);
    const runs = inkRuns(lines[0], W);
    expect(runs.length).toBe(1);
    const p = runs[0];
    for (let i = 2; i < p.length - 2; i += 2) {
      // 中间的点都不在冰 / 陆地的分界(x = 10)上
      if (p[i + 1] > 9 && p[i + 1] < 15) expect(p[i]).toBeGreaterThan(10.3);
    }
  });

  it('四周都是海:整圈描(首尾相接)', () => {
    const { r, iceM } = grid(blob);
    for (const l of iceLines(r, iceM)) {
      const runs = inkRuns(l, W);
      expect(runs.length).toBe(1);
      const p = runs[0];
      expect([p[0], p[1]]).toEqual([p[p.length - 2], p[p.length - 1]]);
    }
  });

  it('绕一圈的冰缘描成连续的一截,跨过首尾也不断开', () => {
    const { r, iceM } = grid((x, y) => y < 8 + (x % 5 === 0 ? 1 : 0), (x, y) => x >= 30 && x < 34 && y >= 3 && y < 12);
    const cap = iceLines(r, iceM).find((l) => l.wrap !== 0 && l.ink.some((v) => v))!;
    const runs = inkRuns(cap, W);
    // 陆地把冰缘断成一截(从陆地东边绕一圈回到陆地西边)
    expect(runs.length).toBe(1);
    const p = runs[0];
    for (let i = 2; i < p.length; i += 2) expect(Math.abs(p[i] - p[i - 2])).toBeLessThan(2);
    // 东西跨度将近一圈
    const xs = Array.from(p).filter((_, i) => i % 2 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(W - 6);
  });
});

describe('裁剪', () => {
  it('Sutherland–Hodgman:矩形里每一点的环绕数不变', () => {
    // 一个伸出矩形的凹多边形
    const poly = [-5, 2, 12, -3, 6, 5, 14, 12, 3, 9, -2, 15];
    const c = clipLoopRect(poly, 0, 0, 10, 10);
    for (let y = 0.25; y < 10; y += 0.5)
      for (let x = 0.25; x < 10; x += 0.5) expect(winding(c, x, y)).toBe(winding(poly, x, y));
    for (let i = 0; i < c.length; i += 2) {
      expect(c[i]).toBeGreaterThanOrEqual(0);
      expect(c[i]).toBeLessThanOrEqual(10);
      expect(c[i + 1]).toBeGreaterThanOrEqual(0);
      expect(c[i + 1]).toBeLessThanOrEqual(10);
    }
  });

  it('整个在矩形外:裁完是空的或者面积为 0', () => {
    const c = clipLoopRect([20, 20, 30, 20, 25, 28], 0, 0, 10, 10);
    let a = 0;
    for (let i = 0; i < c.length; i += 2) {
      const j = (i + 2) % c.length;
      a += c[i] * c[j + 1] - c[j] * c[i + 1];
    }
    expect(Math.abs(a)).toBeLessThan(1e-9);
  });
});

describe('冰缘带(放大后像素层要换颜色的海面像素)', () => {
  it('冰 / 水分界两边各 2 格的海面像素,陆地不算;东西相连', () => {
    const land = (x: number, y: number) => x >= 40 && x < 44 && y >= 10 && y < 14;
    const { r, iceM } = grid((x) => x < 3 || x >= w - 3 || (x >= 44 && x < 50), land);
    const near = new Uint8Array(w * h).fill(1);
    const band = iceBand(r, iceM, near);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (r.water[k] !== 1) {
          expect(band[k]).toBe(0);
          continue;
        }
        // 到最近的"冰 / 水"分界像素(上下左右有另一种海面像素)的切比雪夫距离
        let best = Infinity;
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++) {
            const q = yy * w + xx;
            if (r.water[q] !== 1) continue;
            const nb = [
              yy * w + ((xx + 1) % w),
              yy * w + ((xx + w - 1) % w),
              yy > 0 ? q - w : -1,
              yy < h - 1 ? q + w : -1,
            ];
            if (!nb.some((o) => o >= 0 && r.water[o] === 1 && iceM[o] !== iceM[q])) continue;
            const dx = Math.min(Math.abs(xx - x), w - Math.abs(xx - x));
            best = Math.min(best, Math.max(dx, Math.abs(yy - y)));
          }
        expect(band[k], `(${x},${y})`).toBe(best <= 2 ? 1 : 0);
      }
  });

  it('没有冰 / 水分界:全是 0', () => {
    const { r, iceM } = grid(() => false);
    expect(iceBand(r, iceM, new Uint8Array(w * h).fill(1)).some((v) => v)).toBe(false);
  });
});

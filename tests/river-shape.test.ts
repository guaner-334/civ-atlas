/**
 * 河道的样子(render/common.ts 的 riverGeometry):
 *   - 弯一弯:同一组河每次一样;中间弯出去一些(不远),入海的一头不挪
 *   - 上游多接一段小溪,下游的弯不变(放大前后同一条河弯得一样)
 *   - 河谷沿着弯过的河刻(gen/valleys.ts):画出来的河底下就是谷底
 */
import { describe, expect, it } from 'vitest';
import { riverGeometry } from '../src/render/common';
import { carveValleys, valleyLines } from '../src/gen/valleys';

const STYLE = { color: '', minW: 0.5, maxW: 6, fluxRef: 1000 };

/** 一条直直往东流的河:x 从 x0 到 x1(每 7.6 一个点),流量越往下越大 */
function straight(x0: number, x1: number, y: number, f0: number): { pts: Float32Array } {
  const pts: number[] = [];
  for (let x = x0, f = f0; x <= x1 + 1e-6; x += 7.6, f += 3) pts.push(x, y, f);
  return { pts: Float32Array.from(pts) };
}

describe('河道弯一弯', () => {
  const river = straight(10, 162, 50, 20);

  it('同一组河每次一样;中间弯出去一些(不远),河口不挪', () => {
    const a = riverGeometry([river], 10, STYLE, 1.7, 0.65);
    const b = riverGeometry([river], 10, STYLE, 1.7, 0.65);
    expect(a[0].x).toEqual(b[0].x);
    expect(a[0].y).toEqual(b[0].y);
    const d = a[0];
    const n = d.x.length;
    let far = 0;
    let len = 0;
    for (let i = 0; i < n; i++) {
      far = Math.max(far, Math.abs(d.y[i] - 50));
      if (i) len += Math.hypot(d.x[i] - d.x[i - 1], d.y[i] - d.y[i - 1]);
    }
    expect(far).toBeGreaterThan(0.3);
    expect(far).toBeLessThan(3);
    // 比直线长(弯了),但长不了太多
    const straightLen = d.x[n - 1] - d.x[0];
    expect(len / straightLen).toBeGreaterThan(1.01);
    expect(len / straightLen).toBeLessThan(1.3);
    // 河口(伸进水里的那一点)正好在直线上
    expect(d.y[n - 1]).toBeCloseTo(50, 6);
    expect(d.x[n - 1]).toBeCloseTo(162 + 7.6, 4);
  });

  it('上游多接一段小溪:下游弯得一样', () => {
    const alone = riverGeometry([river], 10, STYLE, 1.7, 0.65)[0];
    const creek = { pts: Float32Array.of(-5.2, 50, 3, 2.4, 50, 6, 10, 50, 9) };
    const both = riverGeometry([river, creek], 10, STYLE, 1.7, 0.65);
    expect(both.length).toBe(1);
    const d = both[0];
    const k = 200;
    for (let i = 1; i <= k; i++) {
      expect(d.x[d.x.length - i]).toBeCloseTo(alone.x[alone.x.length - i], 6);
      expect(d.y[d.y.length - i]).toBeCloseTo(alone.y[alone.y.length - i], 6);
    }
  });

  it('河谷沿着弯过的河刻:河道底下就是谷底', () => {
    const S = 4;
    const w = 200 * S;
    const h = 100 * S;
    const carve = new Float32Array(w * h);
    const calm = new Float32Array(w * h);
    const lines = valleyLines([river], 10, 0);
    carveValleys(lines, 10, S, w, h, carve, calm);
    let max = 0;
    for (const v of carve) max = Math.max(max, v);
    const d = lines[0];
    let checked = 0;
    for (let i = 20; i < d.x.length - 20; i += 7) {
      const k = Math.floor(d.y[i] * S) * w + Math.floor(d.x[i] * S);
      expect(carve[k]).toBeGreaterThan(0.9 * max * 0.5);
      expect(calm[k]).toBeGreaterThan(0.95);
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
  });
});

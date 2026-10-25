import { describe, expect, it } from 'vitest';
import { CLOUD_H, CLOUD_W, WET_H, WET_W, bakeClouds, cyclonesOf, wetFromPrecip } from '../src/render/clouds';

// 小尺寸画云图:单测里不必画满 1024×512
const W = 128;
const H = 64;

describe('云图(render/clouds.ts)', () => {
  it('同一个种子、同一份降水画出同一张云图;换种子就不一样', () => {
    const a = bakeClouds(7, null, W, H);
    const b = bakeClouds(7, null, W, H);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    const c = bakeClouds(8, null, W, H);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
  });

  it('云量在合理范围:有云有晴空,不是满天云也不是一片晴', () => {
    for (const seed of [7, 2024, 31]) {
      const d = bakeClouds(seed, null, W, H);
      let cloudy = 0;
      for (const v of d) if (v > 26) cloudy++;
      const f = cloudy / d.length;
      expect(f).toBeGreaterThan(0.25);
      expect(f).toBeLessThan(0.75);
    }
  });

  it('东西两边接得上:最左一列和最右一列的云量接近(没有 180° 经线的接缝)', () => {
    const d = bakeClouds(7, null, 256, 128);
    let seam = 0;
    let inner = 0;
    for (let j = 0; j < 128; j++) {
      seam += Math.abs(d[j * 256] - d[j * 256 + 255]);
      inner += Math.abs(d[j * 256 + 100] - d[j * 256 + 101]);
    }
    // 相邻两列平均差多少,接缝处就差多少(同一个量级)
    expect(seam).toBeLessThan(inner * 3 + 128 * 8);
  });

  it('气旋南北半球各三个,转向相反,都在中纬度', () => {
    const cy = cyclonesOf(7);
    expect(cy.length).toBe(6);
    expect(cy.filter((k) => k.sgn > 0).length).toBe(3);
    for (const k of cy) {
      const lat = (Math.asin(k.c[2]) * 180) / Math.PI;
      expect(Math.abs(lat)).toBeGreaterThan(37);
      expect(Math.abs(lat)).toBeLessThan(61);
      expect(Math.sign(lat)).toBe(k.sgn);
    }
  });

  it('干湿图:同一纬度里比平均湿的 > 0.5、干的 < 0.5;大小对得上', () => {
    const w = 64;
    const h = 32;
    const p = new Float32Array(w * h).fill(1000);
    // 每一行的左半边很湿、右半边很干
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) p[j * w + i] = i < w / 2 ? 2000 : 250;
    const wet = wetFromPrecip(p, w, h);
    expect(wet.length).toBe(WET_W * WET_H);
    expect(wet[10 * WET_W + 10]).toBeGreaterThan(0.6);
    expect(wet[10 * WET_W + WET_W - 10]).toBeLessThan(0.4);
  });

  it('降水多的地方云多、降水少的地方云少(其余相同)', () => {
    const wetAll = new Float32Array(WET_W * WET_H).fill(0.95);
    const dryAll = new Float32Array(WET_W * WET_H).fill(0.05);
    const mean = (d: Uint8Array) => d.reduce((a, v) => a + v, 0) / d.length;
    expect(mean(bakeClouds(7, wetAll, W, H))).toBeGreaterThan(mean(bakeClouds(7, dryAll, W, H)) + 15);
  });

  it('默认大小', () => {
    expect(CLOUD_W / CLOUD_H).toBe(2);
  });
});

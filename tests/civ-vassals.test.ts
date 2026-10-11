/**
 * 地图上的藩属(render/civ/vassals.ts):
 * - 藩属的颜色往宗主那边靠 VASSAL_TINT,别的国家不变
 * - 真实世界(默认参数 seed 7,最后一年有藩属):铺国土的颜色换成靠过的那一套;
 *   宗主和藩属之间的国界单独分出来(平面主图、地球仪画细点线),其余国界不变
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { rasterize, type Raster } from '../src/gen/raster';
import { generateCiv, type Civ } from '../src/gen/civ';
import { Layer } from '../src/gen/civ/types';
import { relationsAt } from '../src/gen/civ/diplomacy';
import { VASSAL_TINT, tiedPair, vassalColors, vassalTies } from '../src/render/civ/vassals';
import { washFields } from '../src/render/civ/territory';
import { borderLines } from '../src/render/civ/borders';
import { globeBorderSets } from '../src/render/globeLines';
import { CIV_SHOW_OFF, type CivDrawParams } from '../src/render/civ/overlay';

describe('藩属的颜色', () => {
  it('藩属往宗主的颜色靠,宗主和别的国家不变;没有藩属原样返回', () => {
    const colors = Uint8Array.from([200, 0, 0, 0, 0, 200, 10, 20, 30]);
    const t = { liege: new Map([[1, 0]]), key: '1>0' };
    const out = vassalColors(colors, t);
    expect([...out.slice(0, 3)]).toEqual([200, 0, 0]);
    expect([...out.slice(3, 6)]).toEqual([Math.round(200 * VASSAL_TINT), 0, Math.round(200 * (1 - VASSAL_TINT))]);
    expect([...out.slice(6)]).toEqual([10, 20, 30]);
    expect([...colors.slice(3, 6)]).toEqual([0, 0, 200]);
    expect(vassalColors(colors, { liege: new Map(), key: '' })).toBe(colors);
    expect(tiedPair(t, 0, 1) && tiedPair(t, 1, 0)).toBe(true);
    expect(tiedPair(t, 0, 2)).toBe(false);
  });
});

describe('真实世界', () => {
  let cached: { w: World; r: Raster; civ: Civ } | null = null;
  const setup = () => {
    if (!cached) {
      const w = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
      cached = { w, r: rasterize(w, 1), civ: generateCiv(w) };
    }
    return cached;
  };
  const params = (style: 'fantasy' | 'realistic'): CivDrawParams => {
    const { w, r, civ } = setup();
    return { world: w, raster: r, civ, style, year: civ.endYear, show: { ...CIV_SHOW_OFF, polities: true } };
  };

  it('宗藩和 relationsAt 一致;国土的颜色换成靠过的那一套', () => {
    const p = params('fantasy');
    const { civ } = p;
    const t = vassalTies(civ, p.year);
    const rel = relationsAt(civ, p.year);
    expect(t.liege.size).toBeGreaterThan(0);
    expect([...t.liege]).toEqual([...rel.liege].map(([v, x]) => [v, x.liege]));
    const fl = washFields(p, 1)!;
    for (const q of civ.polities) {
      const L = t.liege.get(q.id);
      const want = q.color.map((c, k) => (L === undefined ? c : Math.round(c * (1 - VASSAL_TINT) + civ.polities[L].color[k] * VASSAL_TINT)));
      expect([...fl.colors.slice(q.id * 3, q.id * 3 + 3)]).toEqual(want);
    }
    // 民族图层不变
    const cu = washFields({ ...p, show: { ...CIV_SHOW_OFF, cultures: true } }, 1)!;
    expect(cu.layer).toBe(Layer.Culture);
    expect([...cu.colors.slice(0, 3)]).toEqual(civ.cultures[0].color);
  }, 120_000);

  it('宗主和藩属之间的国界单独分出来(地球仪同一套)', () => {
    const p = params('fantasy');
    const t = vassalTies(p.civ, p.year);
    const lines = borderLines(p, Layer.Polity);
    const bloc = lines.filter((l) => l.left >= 0 && l.right >= 0 && tiedPair(t, l.left, l.right));
    expect(bloc.length).toBeGreaterThan(0);
    const W = p.world.width;
    const H = p.world.height;
    const none = { liege: new Map<number, number>(), key: '' };
    const plain = globeBorderSets(lines, W, H, true, none);
    const split = globeBorderSets(lines, W, H, true, t);
    expect(plain.bloc.vertices).toBe(0);
    expect(split.bloc.vertices).toBeGreaterThan(0);
    // 分出去的那几条不在"两国之间"里了,部落地带的界不变
    expect(split.inner.vertices).toBeLessThan(plain.inner.vertices);
    expect(split.outer.vertices).toBe(plain.outer.vertices);
  }, 120_000);
});

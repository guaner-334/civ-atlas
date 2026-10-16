/**
 * 等值线(render/contours.ts)和估算的气候分类(gen/koppen.ts):
 * 分类门槛照柯本 - 盖格;同一个世界算出来一样;线的数值在范围内、线是连起来的;存档的视图记着叠的是哪种线。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { rasterize } from '../src/gen/raster';
import { CLIMATE_CLASSES, CLIMATE_WATER, annualRange, classOf, climateClasses } from '../src/gen/koppen';
import { CONTOUR_SPEC, computeContours, contourShown } from '../src/render/contours';
import { cleanView, sameView } from '../src/gen/savefile';

const code = (i: number) => CLIMATE_CLASSES[i].code;

describe('气候分类(估算)', () => {
  it('门槛:最热月 < 10°C 为 E,干旱看 20 × 年均温 + 140,最冷月定 A / C / D,第三个字母看夏天', () => {
    // 年均温、年较差、年降水
    expect(code(classOf(27, 2, 2500))).toBe('A');
    expect(code(classOf(-20, 20, 300))).toBe('EF');
    expect(code(classOf(-2, 16, 300))).toBe('ET');
    expect(code(classOf(25, 10, 100))).toBe('BWh');
    expect(code(classOf(8, 30, 100))).toBe('BWk');
    expect(code(classOf(22, 10, 450))).toBe('BSh');
    expect(code(classOf(8, 30, 250))).toBe('BSk');
    expect(code(classOf(17, 16, 1200))).toBe('Ca');
    expect(code(classOf(11, 10, 900))).toBe('Cb');
    expect(code(classOf(7, 6, 900))).toBe('Cc');
    expect(code(classOf(10, 30, 800))).toBe('Da');
    expect(code(classOf(4, 30, 700))).toBe('Db');
    expect(code(classOf(-2, 26, 500))).toBe('Dc');
    expect(code(classOf(-15, 50, 500))).toBe('Dd');
  });

  it('年较差:赤道小、高纬大,内陆比海边大', () => {
    expect(annualRange(0, 1)).toBeCloseTo(3);
    expect(annualRange(60, 0)).toBeLessThan(annualRange(60, 1));
    expect(annualRange(20, 0.5)).toBeLessThan(annualRange(50, 0.5));
    expect(annualRange(-50, 0.5)).toBeCloseTo(annualRange(50, 0.5));
  });

  it('整个世界:同一个世界算出来一样;水面不分类;陆地上有热带也有冰原', () => {
    const world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
    const r = rasterize(world, 1);
    const a = climateClasses(r);
    expect(climateClasses(r)).toEqual(a);
    const n = new Array(CLIMATE_CLASSES.length).fill(0);
    for (let k = 0; k < a.length; k++) {
      if (r.water[k] !== 0) expect(a[k]).toBe(CLIMATE_WATER);
      else n[a[k]]++;
    }
    const land = n.reduce((s, v) => s + v, 0);
    expect(land).toBeGreaterThan(0);
    expect(n[0] / land).toBeGreaterThan(0.02); // A
    expect(n[13] / land).toBeGreaterThan(0.02); // EF
    // 至少分出 8 类
    expect(n.filter((v) => v > 0).length).toBeGreaterThanOrEqual(8);
  });
});

describe('等值线', () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: 2024 });
  const r = rasterize(world, 1);

  for (const kind of ['elev', 'temp', 'precip'] as const)
    it(`${kind}:数值都是规定的那几档,点在世界范围内,粗线照规定`, () => {
      const set = computeContours(r, kind, world.width);
      expect(set.kind).toBe(kind);
      expect(set.lines.length).toBeGreaterThan(10);
      const spec = CONTOUR_SPEC[kind];
      for (const l of set.lines) {
        expect(spec.levels).toContain(l.level);
        expect(l.major).toBe(spec.major(l.level));
        expect(l.pts.length).toBeGreaterThanOrEqual(4);
        for (let i = 0; i < l.pts.length; i += 2) {
          expect(Number.isFinite(l.pts[i])).toBe(true);
          expect(l.pts[i + 1]).toBeGreaterThanOrEqual(-1);
          expect(l.pts[i + 1]).toBeLessThanOrEqual(world.height + 1);
        }
      }
      // 同一张栅格算两次一样
      expect(computeContours(r, kind, world.width).lines.length).toBe(set.lines.length);
    });

  it('等高线放大到 3 倍以上才画 250 米一条', () => {
    expect(contourShown('elev', 250, 1)).toBe(false);
    expect(contourShown('elev', 250, 3)).toBe(true);
    expect(contourShown('elev', 500, 1)).toBe(true);
    expect(contourShown('temp', 5, 1)).toBe(true);
  });

  it('存档的视图记着叠的是哪种线;认不出的当没记;有一份没记就不比', () => {
    expect(cleanView({ projection: 'equirect', center: 0, contours: 'temp' })).toEqual({ projection: 'equirect', center: 0, contours: 'temp' });
    expect(cleanView({ projection: 'equirect', center: 0, contours: '' })).toEqual({ projection: 'equirect', center: 0, contours: '' });
    for (const bad of ['rain', 1, true, null]) expect(cleanView({ projection: 'equirect', center: 0, contours: bad }), String(bad)).toEqual({ projection: 'equirect', center: 0 });
    expect(sameView({ projection: 'equirect', center: 0, contours: 'elev' }, { projection: 'equirect', center: 0, contours: '' })).toBe(false);
    expect(sameView({ projection: 'equirect', center: 0 }, { projection: 'equirect', center: 0, contours: 'elev' })).toBe(true);
  });
});

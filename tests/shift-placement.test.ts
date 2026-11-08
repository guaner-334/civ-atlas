/**
 * 排好的地名搬到另一个视口(shiftPlacement):视口没变时原样不动;换了中心、缩放后符号落在新位置,城名还在自家符号旁边。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { rasterize, type Raster } from '../src/gen/raster';
import { generateCiv, type Civ } from '../src/gen/civ';
import { civLabelItems, civMapLayer, labelViewExtras } from '../src/render/civ/labels';
import { CIV_SHOW_DEFAULT, type CivDrawParams } from '../src/render/civ/overlay';
import { labelPx, placeMap, shiftPlacement, toCanvas, type LabelView, type Placement } from '../src/render/labels/draw';
import { labelProjection, mapProj } from '../src/render/projection';

let world: World;
let raster: Raster;
let civ: Civ;
beforeAll(() => {
  world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
  raster = rasterize(world, 1);
  civ = generateCiv(world);
});

const show = { ...CIV_SHOW_DEFAULT, polities: true };

function setup(lon0: number, k: number, ox = 0, oy = 0) {
  const p: CivDrawParams = { world, raster, civ, style: 'fantasy', year: civ.endYear, show };
  const mp = mapProj('robinson', lon0, world.width, world.height);
  const mapCss = 1300;
  const view: LabelView = {
    ...labelViewExtras(p),
    reserved: [],
    wrap: 0,
    frameLeft: 0,
    proj: labelProjection(mp),
    scale: (mapCss / world.width) * k,
    ox,
    oy,
    dpr: 1,
    k,
    mapCss,
    canvasW: mapCss * k,
    canvasH: (mapCss / 2) * k,
  };
  return { p, view };
}

function placed(lon0: number, k: number): { view: LabelView; placed: Placement } {
  const { p, view } = setup(lon0, k);
  const layer = civMapLayer(p, { fast: false, proj: null, sides: true });
  return { view, placed: placeMap(civLabelItems(p).concat(layer.items), layer.marks, view) };
}

describe('排好的地名搬到另一个视口', () => {
  it('视口没变:每个字、每个符号都在原处', () => {
    const a = placed(0, 1);
    expect(a.placed.labels.length).toBeGreaterThan(20);
    const b = shiftPlacement(a.placed, a.view, a.view);
    expect(b.marks.length).toBe(a.placed.marks.length);
    b.marks.forEach((m, i) => {
      expect(m.x).toBeCloseTo(a.placed.marks[i].x, 6);
      expect(m.y).toBeCloseTo(a.placed.marks[i].y, 6);
    });
    const kept = new Map(b.labels.map((l) => [l.item, l]));
    expect(kept.size).toBeGreaterThan(a.placed.labels.length * 0.95);
    for (const l of a.placed.labels) {
      const s = kept.get(l.item);
      if (!s) continue;
      expect(s.px).toBeCloseTo(l.px, 9);
      s.glyphs.forEach((g, i) => {
        expect(g.x).toBeCloseTo(l.glyphs[i].x, 3);
        expect(g.y).toBeCloseTo(l.glyphs[i].y, 3);
        expect(g.a).toBe(l.glyphs[i].a);
      });
    }
  });

  it('换了中心、放大以后:符号落在新视口里的位置,城名离自家符号的距离按字号缩放', () => {
    const a = placed(0, 1);
    const { view: to } = setup(25, 1.8, -200, -120);
    const b = shiftPlacement(a.placed, a.view, to);
    b.marks.forEach((m) => {
      const [x, y] = toCanvas(to, m.mark.x, m.mark.y);
      expect(m.x).toBeCloseTo(x, 6);
      expect(m.y).toBeCloseTo(y, 6);
    });
    const markOf = (pl: Placement, id: number) => pl.marks.find((m) => m.mark.id === id)!;
    let cities = 0;
    for (const l of b.labels) {
      if (l.item.mark === undefined) continue;
      const before = a.placed.labels.find((x) => x.item === l.item)!;
      const s = labelPx(l.item, to) / labelPx(l.item, a.view);
      expect(l.px).toBeCloseTo(before.px * s, 9);
      const m0 = markOf(a.placed, l.item.mark);
      const m1 = markOf(b, l.item.mark);
      l.glyphs.forEach((g, i) => {
        expect(g.x - m1.x).toBeCloseTo((before.glyphs[i].x - m0.x) * s, 6);
        expect(g.y - m1.y).toBeCloseTo((before.glyphs[i].y - m0.y) * s, 6);
      });
      cities++;
    }
    expect(cities).toBeGreaterThan(5);
  });
});

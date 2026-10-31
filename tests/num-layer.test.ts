import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { CIV_SHOW_OFF } from '../src/render/civ/show';
import { numBase, numCiv, numColors, numLayerOf, numLegendRows } from '../src/render/civ/numLayer';
import { NUM_LAYERS, numLayerDrawn, numLayerShown } from '../src/render/civ/numLayers';
import { ERA_LAYER } from '../src/render/civ/era';
import { CONTROL_LAYER } from '../src/render/civ/control';
import { THOUGHT_LAYER } from '../src/render/civ/thoughts';

const civ = generateCiv(generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 }));
const show = (patch: Partial<typeof CIV_SHOW_OFF>) => ({ ...CIV_SHOW_OFF, polities: true, ...patch });

describe('数值填色图层的定义', () => {
  it('三种都在清单里;这个世界都有这三种数', () => {
    expect(NUM_LAYERS.map((l) => l.id)).toEqual(['eras', 'control', 'ideology']);
    for (const l of NUM_LAYERS) expect(l.has(civ)).toBe(true);
  });

  it('换出来的 Civ:民族表 = 各档(名字、颜色),按 civ + 图层 + 哪一份缓存,认得出原来的 Civ 和哪一层', () => {
    for (const l of NUM_LAYERS) {
      const k = l.focus(civ, {}, civ.endYear);
      const view = numCiv(l, civ, k);
      expect(numCiv(l, civ, k)).toBe(view);
      expect(numBase(view)).toBe(civ);
      expect(numBase(view, l)).toBe(civ);
      expect(numBase(civ)).toBeNull();
      expect(numLayerOf(view)).toBe(l);
      expect(view.cultures.map((c) => c.color)).toEqual(l.bands.map((b) => [...b.color]));
      expect(view.cultures.map((c) => c.name)).toEqual(l.bands.map((b, i) => (l.kindName ? l.kindName(i, k) : b.name)));
      expect([...numColors(l)]).toEqual(l.bands.flatMap((b) => [...b.color]));
      for (const other of NUM_LAYERS) if (other !== l) expect(numBase(view, other)).toBeNull();
    }
  });

  it('图例:各档州数加起来 = 那一年上了色的州数;时代新的在上、空档不列,管辖照档的先后、空档不列,思潮深的在上、五档都列', () => {
    const y = 2000;
    for (const l of NUM_LAYERS) {
      const k = l.focus(civ, {}, y);
      const n = l.counts(civ, y, k);
      expect(n.length).toBe(l.bands.length);
      const rows = numLegendRows(l, civ, y, k);
      expect(rows.reduce((s, r) => s + parseInt(r.note), 0)).toBe(n.reduce((s, v) => s + v, 0));
      if (!l.legend.keepEmpty) expect(rows.every((r) => parseInt(r.note) > 0)).toBe(true);
    }
    const era = numLegendRows(ERA_LAYER, civ, y, 0).map((r) => ERA_LAYER.bands.findIndex((b) => b.name === r.name));
    expect(era).toEqual([...era].sort((a, b) => b - a));
    const ctl = numLegendRows(CONTROL_LAYER, civ, y, 0).map((r) => CONTROL_LAYER.bands.findIndex((b) => b.name === r.name));
    expect(ctl).toEqual([...ctl].sort((a, b) => a - b));
    const th = numLegendRows(THOUGHT_LAYER, civ, y, THOUGHT_LAYER.focus(civ, {}, y));
    expect(th.map((r) => r.name)).toEqual(['七成以上', '五成到七成', '三成到五成', '一成到三成', '半成到一成']);
  });

  it('悬停:说得出的州带档的颜色和一句小字;没人住的州时代、思潮不说', () => {
    const y = civ.endYear;
    const own = ownersAt(civ, y);
    let said = 0;
    for (let r = 0; r < civ.regions.count; r++) {
      for (const l of NUM_LAYERS) {
        const h = l.hover(civ, y, r, own, {});
        if (!h) continue;
        said++;
        expect(h.sub.length).toBeGreaterThan(0);
        expect(h.band).toBeLessThan(l.bands.length);
        if (l !== CONTROL_LAYER) expect(own.culture[r]).toBeGreaterThanOrEqual(0);
      }
    }
    expect(said).toBeGreaterThan(0);
  });

  it('开着哪一种:按清单先后;思潮遇到信仰也开着时地图上让给信仰', () => {
    expect(numLayerShown(civ, show({}))).toBeNull();
    expect(numLayerShown(civ, show({ eras: true }))).toBe(ERA_LAYER);
    expect(numLayerShown(civ, show({ control: true }))).toBe(CONTROL_LAYER);
    expect(numLayerShown(civ, show({ ideology: true }))).toBe(THOUGHT_LAYER);
    expect(numLayerDrawn(civ, show({ ideology: true }))).toBe(THOUGHT_LAYER);
    expect(numLayerDrawn(civ, show({ ideology: true, faiths: true }))).toBeNull();
    expect(numLayerShown(civ, show({ ideology: true, faiths: true }))).toBe(THOUGHT_LAYER);
    expect(numLayerDrawn(civ, show({ eras: true, faiths: true }))).toBe(ERA_LAYER);
  });
});

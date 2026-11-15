/**
 * 数据图层图例的内容(屏幕和导出共用一份):每个图层都有标题和内容,连续色阶的刻度落在色带范围内,
 * 地图上只给有数值色阶的四种图层留位置。
 */
import { describe, expect, it } from 'vitest';
import { LAYERS, type LayerId } from '../src/render/layers';
import { dataLegend, dataLegendText, isGradientLegend } from '../src/render/dataLegend';
import { mapLegendBox, mapLegendCanvasBoxes } from '../src/render/export';

const GRADIENT: LayerId[] = ['elevation', 'temperature', 'precipitation', 'currents'];

describe('数据图层图例', () => {
  it('每个数据图层都有标题和内容', () => {
    for (const { id } of LAYERS) {
      const d = dataLegend(id);
      expect(d.title.length).toBeGreaterThan(0);
      if (d.kind === 'gradient') {
        expect(d.stops.length).toBeGreaterThan(1);
        expect(d.labels.length).toBeGreaterThan(1);
        expect(d.unit.length).toBeGreaterThan(0);
      } else if (d.kind === 'keys') {
        expect(d.keys.length).toBeGreaterThan(1);
      } else {
        expect(d.groups.length).toBeGreaterThan(1);
        expect(d.groups.reduce((n, g) => n + g.classes.length, 0)).toBeGreaterThan(1);
        expect(d.note.length).toBeGreaterThan(0);
      }
    }
  });

  it('连续色阶的刻度从低到高、都落在色带范围内', () => {
    for (const id of GRADIENT) {
      const d = dataLegend(id);
      expect(d.kind).toBe('gradient');
      if (d.kind !== 'gradient') continue;
      const lo = d.stops[0][0];
      const hi = d.stops[d.stops.length - 1][0];
      expect(d.labels[0]).toBeGreaterThanOrEqual(lo);
      expect(d.labels[d.labels.length - 1]).toBeLessThanOrEqual(hi);
      expect([...d.labels].sort((a, b) => a - b)).toEqual(d.labels);
      for (const [v] of d.stops) expect(v).toBeGreaterThanOrEqual(lo);
    }
  });

  it('地图上只给连续色阶留位置', () => {
    for (const { id } of LAYERS) {
      const box = mapLegendBox(id);
      if (GRADIENT.includes(id)) {
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThan(0);
        expect(box!.y).toBeGreaterThan(0);
        expect(box!.w).toBeGreaterThan(100);
        expect(box!.h).toBeGreaterThan(50);
      } else {
        expect(box).toBeNull();
      }
    }
  });

  it('标记和足迹排名字时让开的色阶位置:连续色阶按倍数放大,其余不留', () => {
    const grad = LAYERS.find((l) => GRADIENT.includes(l.id))!.id;
    const flat = LAYERS.find((l) => !GRADIENT.includes(l.id))!.id;
    const box = mapLegendBox(grad)!;
    expect(mapLegendCanvasBoxes({ style: 'data', layer: grad }, 2)).toEqual([[box.x * 2, box.y * 2, (box.x + box.w) * 2, (box.y + box.h) * 2]]);
    expect(mapLegendCanvasBoxes({ style: 'data', layer: grad, legend: false }, 2)).toEqual([]);
    expect(mapLegendCanvasBoxes({ style: 'data', layer: flat }, 2)).toEqual([]);
    expect(mapLegendCanvasBoxes({ style: 'fantasy', layer: grad }, 1)).toEqual([]);
  });

  it('图例里要写的字包括标题、单位 / 刻度和说明', () => {
    for (const { id } of LAYERS) {
      const d = dataLegend(id);
      const text = dataLegendText(id);
      expect(text).toContain(d.title);
      if (d.kind === 'gradient') {
        expect(text).toContain(d.unit);
        for (const v of d.labels) expect(text).toContain(String(v));
      } else if (d.kind === 'keys') {
        for (const k of d.keys) expect(text).toContain(k.name);
      } else {
        expect(text).toContain(d.subtitle);
        for (const g of d.groups) for (const c of g.classes) expect(text).toContain(c.code);
      }
    }
  });

  it('生态 15 类(含湿地)、气候 14 类分组齐全', () => {
    const biomes = dataLegend('biomes');
    expect(biomes.kind).toBe('keys');
    if (biomes.kind === 'keys') {
      expect(biomes.keys).toHaveLength(15);
      expect(biomes.keys.map((k) => k.name)).toContain('湿地');
    }
    const climate = dataLegend('climate');
    expect(climate.kind).toBe('climate');
    if (climate.kind === 'climate') {
      expect(climate.groups.map((g) => g.letter)).toEqual(['A', 'B', 'C', 'D', 'E']);
      expect(climate.groups.reduce((n, g) => n + g.classes.length, 0)).toBe(14);
    }
  });

  it('只有连续色阶算"地图上能画"', () => {
    for (const { id } of LAYERS) expect(isGradientLegend(id)).toBe(GRADIENT.includes(id));
  });

  it('世界真有超出普通世界那截的值时才多画延伸段;湖底或水面不算陆地高山', () => {
    const normal = {
      elevation: new Float32Array([8000, -5000]),
      water: new Uint8Array([0, 1]),
      temperature: new Float32Array([-65, 30]),
      precipitation: new Float32Array([25000, 800]),
    };
    for (const id of GRADIENT) {
      const a = dataLegend(id);
      const b = dataLegend(id, normal);
      expect(a.kind === 'gradient' && a.extra).toBeUndefined();
      expect(b.kind === 'gradient' && b.extra).toBeUndefined();
    }

    const lakeHigh = { ...normal, elevation: new Float32Array([15000, 500]), water: new Uint8Array([2, 0]) };
    const dlLake = dataLegend('elevation', lakeHigh);
    expect(dlLake.kind === 'gradient' && dlLake.extra).toBeUndefined();

    const extreme = {
      elevation: new Float32Array([15000, -5000]),
      water: new Uint8Array([0, 1]),
      temperature: new Float32Array([-90, 20]),
      precipitation: new Float32Array([80000, 1000]),
    };
    const elev = dataLegend('elevation', extreme);
    expect(elev.kind === 'gradient' && elev.extra).toMatchObject({ side: 'high', label: '12,000 ~ 20,000' });
    expect(dataLegendText('elevation', extreme)).toContain('≈');
    expect(dataLegendText('elevation', extreme)).toContain('12,000 ~ 20,000');

    const temp = dataLegend('temperature', extreme);
    expect(temp.kind === 'gradient' && temp.extra).toMatchObject({ side: 'low', label: '-120 ~ -82' });
    expect(dataLegendText('temperature', extreme)).toContain('≈');
    expect(dataLegendText('temperature', extreme)).toContain('-120 ~ -82');

    const precip = dataLegend('precipitation', extreme);
    expect(precip.kind === 'gradient' && precip.extra).toMatchObject({ side: 'high', label: '70,000 ~ 100,000' });
    expect(dataLegendText('precipitation', extreme)).toContain('≈');
    expect(dataLegendText('precipitation', extreme)).toContain('70,000 ~ 100,000');
  });
});

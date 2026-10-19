/**
 * 数据图层图例的内容(屏幕和导出共用一份):每个图层都有标题和内容,连续色阶的刻度落在色带范围内,
 * 地图上只给有数值色阶的四种图层留位置。
 */
import { describe, expect, it } from 'vitest';
import { LAYERS, type LayerId } from '../src/render/layers';
import { dataLegend, dataLegendText, isGradientLegend } from '../src/render/dataLegend';
import { mapLegendBox } from '../src/render/export';

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

  it('生态 14 类、气候 14 类分组齐全', () => {
    const biomes = dataLegend('biomes');
    expect(biomes.kind).toBe('keys');
    if (biomes.kind === 'keys') expect(biomes.keys).toHaveLength(14);
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
});

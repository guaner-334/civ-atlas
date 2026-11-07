/**
 * 选中国家 / 州那一层:飞过去、转中心、换缩放时接着用上一次备好的罩染和描边,画出来的每一步和重新备一遍一模一样。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { rasterize } from '../src/gen/raster';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { drawSelection, type SelectionTarget } from '../src/render/civ/highlight';
import { mapProj, projector } from '../src/render/projection';

/** 罩染图(putImageData 进去的像素)的指纹 */
function hashPixels(d: Uint8ClampedArray): string {
  let h = 2166136261;
  for (let i = 0; i < d.length; i++) h = Math.imul(h ^ d[i], 16777619);
  return `${d.length}:${h >>> 0}`;
}

class FakeImageData {
  data: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}

class FakeCanvas {
  pixels = '';
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext() {
    return { putImageData: (img: FakeImageData) => (this.pixels = hashPixels(img.data)) };
  }
}

class FakePath {
  ops: string[] = [];
  moveTo(x: number, y: number) {
    this.ops.push(`M${x},${y}`);
  }
  lineTo(x: number, y: number) {
    this.ops.push(`L${x},${y}`);
  }
  closePath() {
    this.ops.push('Z');
  }
  arc(...a: number[]) {
    this.ops.push(`A${a.join(',')}`);
  }
}

const show = (v: unknown): string => (v instanceof FakePath ? `path[${v.ops.join(' ')}]` : v instanceof FakeCanvas ? `canvas[${v.width}x${v.height} ${v.pixels}]` : String(v));

/** 记下对画布做的每一步(方法和参数、属性赋值) */
function recorder(w: number, h: number) {
  const log: string[] = [];
  const canvas = { width: w, height: h };
  const ctx = new Proxy(
    {},
    {
      get: (_t, k) => (k === 'canvas' ? canvas : (...a: unknown[]) => log.push(`${String(k)}(${a.map(show).join(',')})`)),
      set: (_t, k, v) => (log.push(`${String(k)}=${show(v)}`), true),
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

describe('选中层接着用备好的罩染和描边', () => {
  const world = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 });
  const civ = generateCiv(world);
  const raster = rasterize(world, 1);
  beforeAll(() => {
    const g = globalThis as Record<string, unknown>;
    g.ImageData ??= FakeImageData;
    g.OffscreenCanvas ??= FakeCanvas;
    g.Path2D ??= FakePath;
  });
  const year = Math.floor(civ.endYear / 2);
  const own = ownersAt(civ, year);
  const polity = own.polity.find((p) => p >= 0)!;
  const targets: SelectionTarget[] = [
    { kind: 'polity', id: polity },
    { kind: 'region', id: 3 },
  ];
  const draw = (sel: SelectionTarget, zoom: number, lon: number | null, style: 'fantasy' | 'realistic') => {
    const { ctx, log } = recorder(raster.w, raster.h);
    const pj = lon === null ? null : projector(mapProj('robinson', lon, world.width, world.height));
    const lit = drawSelection(ctx, world, raster, civ, sel, year, style, zoom, pj);
    return { lit, log: log.join('\n') };
  };
  it('换缩放、转中心再画,和换了选中以后重新备的一样', () => {
    for (const sel of targets)
      for (const style of ['fantasy', 'realistic'] as const)
        for (const lon of [null, 0, 40]) {
          const other = targets.find((t) => t !== sel)!;
          draw(other, 1, lon, style);
          const fresh = draw(sel, 2, lon, style);
          expect(fresh.lit).toBeGreaterThan(0);
          draw(sel, 1, lon === null ? null : lon + 10, style);
          const again = draw(sel, 2, lon, style);
          expect(again.lit).toBe(fresh.lit);
          expect(again.log).toBe(fresh.log);
        }
  });
});

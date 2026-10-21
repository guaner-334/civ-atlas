import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { rasterize, type Raster } from '../src/gen/raster';
import { macroGrids, realisticBandPixels, realisticBase, realisticFullSteps, realisticPixels } from '../src/render/realistic';
import { fantasyFullPixels, fantasyPixels } from '../src/render/fantasy';
import { prepareLayer, renderLayer, hasPreparedLayer, type LayerId } from '../src/render/layers';
import type { WorkStep } from '../src/render/common';

/**
 * Node 里没有画布:只存像素的假画布(putImageData 照脏矩形写、同样大的画布贴画布照抄),
 * 够跑像素层;矢量层(河、符号)要真正的画布,这里不测
 */
class FakeCanvas {
  px: Uint8ClampedArray;
  constructor(
    public width: number,
    public height: number,
  ) {
    this.px = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    const cv = this;
    return {
      canvas: cv,
      getTransform: () => ({ isIdentity: true }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
      putImageData: (img: { data: Uint8ClampedArray; width: number }, dx: number, dy: number, sx = 0, sy = 0, sw = img.width, sh = img.data.length / 4 / img.width) => {
        for (let y = sy; y < sy + sh; y++)
          for (let x = sx; x < sx + sw; x++) {
            const s = (y * img.width + x) * 4;
            const d = ((dy + y) * cv.width + dx + x) * 4;
            cv.px.set(img.data.subarray(s, s + 4), d);
          }
      },
      drawImage: (src: FakeCanvas, x: number, y: number) => {
        if (x !== 0 || y !== 0 || src.width !== cv.width || src.height !== cv.height) throw new Error('只会原样贴同样大的');
        cv.px.set(src.px);
      },
    };
  }
}
beforeAll(() => {
  const g = globalThis as unknown as { OffscreenCanvas: unknown; ImageData: unknown };
  g.OffscreenCanvas ??= FakeCanvas;
  g.ImageData ??= class {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
  };
});

const worlds = new Map<number, { w: World; r: Raster }>();
function worldOf(seed: number): { w: World; r: Raster } {
  let x = worlds.get(seed);
  if (!x) {
    const w = generateWorld({ ...DEFAULT_PARAMS, seed });
    worlds.set(seed, (x = { w, r: rasterize(w, 1) }));
  }
  return x;
}

/** 两份 RGBA 第一个不一样的像素(都一样 = '') */
function firstDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, W: number): string {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const k = (i / 4) | 0;
    return `(${k % W}, ${Math.floor(k / W)})`;
  }
  return a.length === b.length ? '' : '长度不一样';
}

const runAll = (steps: WorkStep[]) => {
  for (const s of steps) while (s(Infinity) === true);
};

describe('缩略图的底图分小步画', () => {
  it('写实:整张分带子画(realisticFullSteps)和一口气整张画逐像素相同,抗锯齿之前的那份也一样', { timeout: 300000 }, () => {
    const { r } = worldOf(7);
    const W = r.w;
    for (const look of ['detail', 'classic'] as const) {
      const steps = realisticFullSteps(r, look);
      expect(steps, look).not.toBeNull();
      runAll(steps!);
      // 放进了缓存:realisticBase 直接拿这一张;再要分步画 = null
      expect(realisticFullSteps(r, look)).toBeNull();
      const got = (realisticBase(r, look) as unknown as FakeCanvas).px;
      const want = realisticPixels(r, look);
      expect(firstDiff(got, want.px, W), look).toBe('');
      // 抗锯齿之前的那份(放大后的岸线要用):同样的带子拼起来
      const g = macroGrids(r);
      const raw = new Uint8ClampedArray(W * r.h * 4);
      const region = { x0: 0, y0: 0, w: W, h: r.h };
      for (let y = 0; y < r.h; y += 61) {
        const y1 = Math.min(r.h, y + 61);
        for (const p of realisticBandPixels(r, g, look, region, y, y1, true)) raw.set(p.raw!, (y * W + p.x) * 4);
      }
      expect(firstDiff(raw, want.raw, W), `${look} 抗锯齿之前`).toBe('');
    }
  });

  it('手绘:整张分步铺(fantasyFullPixels)和一口气整张画逐像素相同,墨线原色、波纹的场也一样', { timeout: 600000 }, () => {
    for (const seed of [7, 2024]) {
      const { w, r } = worldOf(seed);
      const W = r.w;
      const got = fantasyFullPixels(w, r);
      const want = fantasyPixels(w, r);
      expect(firstDiff(got.px, want.px, W), `${seed} 像素`).toBe('');
      for (const k of ['dist', 'fade'] as const) expect(Buffer.from(got.sea[k].buffer).equals(Buffer.from(want.sea[k].buffer)), `${seed} sea.${k}`).toBe(true);
      for (const k of ['coast', 'lake', 'sea', 'iceW', 'iceI'] as const) {
        const a = new Map<number, string>();
        const b = new Map<number, string>();
        for (const [m, p] of [
          [a, got.patch[k]],
          [b, want.patch[k]],
        ] as const)
          for (let i = 0; i < p.n; i++) m.set(p.k[i], `${p.c[i * 3]},${p.c[i * 3 + 1]},${p.c[i * 3 + 2]}`);
        expect(a.size, `${seed} patch.${k} 个数`).toBe(b.size);
        for (const [i, c] of b) if (a.get(i) !== c) throw new Error(`${seed} patch.${k} 像素 ${i % W},${Math.floor(i / W)}`);
      }
    }
  });

  it('数据图层:分带子上色铺满整张;先在后台备好的,下一次 renderLayer 原样贴上(贴完就丢),和当场画的一样', { timeout: 300000 }, () => {
    const { w, r } = worldOf(7);
    for (const layer of ['temperature', 'biomes'] as LayerId[]) {
      // 当场画:每条带子的脏矩形拼起来就是整张(和最后一次交上来的整张 ImageData 一样)
      const direct = new FakeCanvas(r.w, r.h);
      const ctx = direct.getContext();
      let whole: Uint8ClampedArray | null = null;
      const put = ctx.putImageData;
      ctx.putImageData = (img, ...rest) => {
        whole = img.data;
        put(img, ...rest);
      };
      renderLayer(ctx as unknown as CanvasRenderingContext2D, w, r, layer);
      expect(firstDiff(direct.px, whole!, r.w), `${layer} 带子拼起来`).toBe('');
      // 后台备好的
      const pre = new FakeCanvas(r.w, r.h);
      runAll(prepareLayer(pre as unknown as HTMLCanvasElement, w, r, layer));
      expect(hasPreparedLayer(r, layer)).toBe(true);
      const out = new FakeCanvas(r.w, r.h);
      renderLayer(out.getContext() as unknown as CanvasRenderingContext2D, w, r, layer);
      expect(firstDiff(out.px, direct.px, r.w), `${layer} 备好的`).toBe('');
      expect(hasPreparedLayer(r, layer), '贴完就丢').toBe(false);
      expect(pre.width).toBe(0);
    }
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { rasterize, type Raster } from '../src/gen/raster';
import { generateCiv, type Civ } from '../src/gen/civ';
import { CIV_SHOW_OFF, type CivDrawParams } from '../src/render/civ/overlay';
import { drawTerritory, territorySteps } from '../src/render/civ/territory';
import type { WorkStep } from '../src/render/common';

/**
 * 换上一段新的历史时,色块在后台分小步备好(territorySteps),之后 drawTerritory 直接贴上:
 * 和当场一口气画逐像素一样;分步做的中途别处同步画了别的年份(共用的草稿、缓存被改写),结果也不变。
 * Node 里没有画布:只存像素的假画布(同样大的画布贴画布照抄)。手绘风要地形符号层(真画布),这里只测写实风
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
      imageSmoothingEnabled: true,
      save() {},
      restore() {},
      putImageData(img: { data: Uint8ClampedArray; width: number; height: number }, dx: number, dy: number) {
        if (dx !== 0 || dy !== 0 || img.width !== cv.width || img.height !== cv.height) throw new Error('只会整张放');
        cv.px.set(img.data);
      },
      drawImage(src: FakeCanvas, x: number, y: number, w = src.width, h = src.height) {
        if (x !== 0 || y !== 0 || w !== cv.width || h !== cv.height || src.width !== cv.width || src.height !== cv.height) throw new Error('只会原样贴同样大的');
        cv.px.set(src.px);
      },
    };
  }
}

beforeAll(() => {
  const g = globalThis as unknown as { OffscreenCanvas: unknown; ImageData: unknown };
  g.OffscreenCanvas ??= FakeCanvas;
  g.ImageData ??= class {
    data: Uint8ClampedArray;
    constructor(
      public width: number,
      public height: number,
    ) {
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
});

let world: World;
let raster: Raster;
let civ: Civ;
beforeAll(() => {
  world = generateWorld({ ...DEFAULT_PARAMS, seed: 7 });
  raster = rasterize(world, 1);
  civ = generateCiv(world);
}, 300000);

/** drawTerritory 画到一张新的假画布上,返回像素 */
function draw(p: CivDrawParams): Uint8ClampedArray {
  const cv = new FakeCanvas(p.raster.w, p.raster.h);
  drawTerritory(cv.getContext() as unknown as CanvasRenderingContext2D, p);
  return cv.px;
}

/**
 * 两份 RGBA 第一个不一样的像素(都一样 = '')。全透明的像素不比颜色:逐像素上色时全透明的只写不透明度,
 * 颜色留着上一次的;真画布里存的是预乘过的,全透明就是全透明
 */
function firstDiff(a: Uint8ClampedArray, b: Uint8ClampedArray, W: number): string {
  if (a.length !== b.length) return '长度不一样';
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === b[i + 3] && (a[i + 3] === 0 || (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]))) continue;
    const k = i / 4;
    return `(${k % W}, ${Math.floor(k / W)})`;
  }
  return '';
}

/** 一步一步做完;每一步做了一小段以后(还没做完时)调一次 between */
function runAll(steps: WorkStep[], between?: () => void) {
  for (const s of steps) {
    let first = true;
    while (s(-Infinity) === true)
      if (first) {
        first = false;
        between?.();
      }
  }
}

describe('换上历史时色块分小步备好', () => {
  const cases: [string, CivDrawParams['show']][] = [
    ['国家', { ...CIV_SHOW_OFF, polities: true }],
    ['民族', { ...CIV_SHOW_OFF, cultures: true }],
    ['信仰', { ...CIV_SHOW_OFF, faiths: true }],
  ];
  for (const [name, show] of cases)
    it(`${name}:备好以后贴上的和当场画的逐像素一样,中途别处画了别的年份也一样`, { timeout: 300000 }, () => {
      const p: CivDrawParams = { world, raster, civ, style: 'realistic', year: civ.endYear, show };
      const other: CivDrawParams = { ...p, year: Math.round(civ.endYear / 2) };
      // 主图先画着别的年份(缓存里是那一年的)
      draw(other);
      runAll(territorySteps(p), () => draw(other));
      const got = draw(p);
      // 备好了:再要备的几步什么也不用做,缓存里的就是这一张
      const again = territorySteps(p);
      runAll(again);
      expect(firstDiff(draw(p), got, raster.w), '再画一次').toBe('');
      // 当场画:先画别的年份把缓存挤掉,再画这一年
      draw(other);
      const want = draw(p);
      expect(firstDiff(got, want, raster.w)).toBe('');
      expect(got.some((v) => v > 0)).toBe(true);
    });

  it('存档缩略图:另用一份画布,不挤掉主图那一年的;画出来和当场画的一样', { timeout: 300000 }, () => {
    const main: CivDrawParams = { world, raster, civ, style: 'realistic', year: Math.round(civ.endYear / 3), show: { ...CIV_SHOW_OFF, polities: true } };
    const thumb: CivDrawParams = { ...main, year: civ.endYear, thumb: true };
    const mainPx = draw(main);
    runAll(territorySteps(thumb), () => draw(main));
    const got = draw(thumb);
    expect(firstDiff(draw(main), mainPx, raster.w), '主图').toBe('');
    // 当场画(缩略图那份画完就放掉了,这一次是重新算的)
    expect(firstDiff(draw(thumb), got, raster.w), '缩略图').toBe('');
    expect(firstDiff(draw({ ...thumb, thumb: undefined }), got, raster.w), '和主图画同一年').toBe('');
  });
});

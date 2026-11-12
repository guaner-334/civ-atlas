/**
 * 照图原样:细图、连续高低的存法,存档来回不丢,长出来的海陆和图上一致(放大现算也一致),没开照图原样的照旧。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { finishGully, finishVeins, gullyHeights, rasterize, rasterizeDeferred, veinsOf } from '../src/gen/raster';
import { rasterizePatch } from '../src/gen/rasterEdit';
import { rasterizeWindow, zoomSource } from '../src/gen/rasterWindow';
import { EMPTY_EDITS, type WorldEdits } from '../src/gen/edits';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { validateWorld } from '../src/gen/worldValidate';
import { FINE_PICTURE_W, autoSeaLevel, greyLayer, levelsFrom, placeOnFine, preparePicture } from '../src/gen/sketchImage';
import { LAYER_H, LAYER_W, SKETCH_LAND, SKETCH_SEA, cleanSketch, encodeLayer, sameSketch, sketchGrid, type SketchEdit } from '../src/gen/sketch';
import { FINE_H, FINE_LAND, FINE_NONE, FINE_W, FINE_WATER, GREY_H, GREY_W, decodeFine, decodeGrey } from '../src/gen/sketchFine';
import { encodeFine, encodeGrey } from '../src/gen/sketchFineWrite';

/** 细图:一块大陆(带一条 4 像素宽的细半岛、一道 4 像素宽的海峡)、一个半径 4 像素的小岛 */
function sampleFine(): Uint8Array {
  const g = new Uint8Array(FINE_W * FINE_H).fill(FINE_WATER);
  for (let y = 0; y < FINE_H; y++) {
    for (let x = 0; x < FINE_W; x++) {
      let land = ((x - 900) / 300) ** 2 + ((y - 500) / 180) ** 2 < 1;
      if (x >= 1180 && x < 1500 && y >= 498 && y < 502) land = true;
      if (x >= 898 && x < 902) land = false;
      if ((x - 400) ** 2 + (y - 300) ** 2 <= 16) land = true;
      if (land) g[y * FINE_W + x] = FINE_LAND;
    }
  }
  return g;
}

/** 细图对应的粗格子图(和认图时一样从同一张图来) */
function layerOf(fine: Uint8Array): Uint8Array {
  const l = new Uint8Array(LAYER_W * LAYER_H);
  for (let y = 0; y < LAYER_H; y++) for (let x = 0; x < LAYER_W; x++) l[y * LAYER_W + x] = fine[(4 * y + 2) * FINE_W + 4 * x + 2] === FINE_LAND ? SKETCH_LAND : SKETCH_SEA;
  return l;
}

const FINE = sampleFine();
const IMAGE = { name: 'a.png', cells: encodeLayer(layerOf(FINE)) };
const TRACED: SketchEdit = { rest: 'sea', fill: 'detail', strokes: [], image: { ...IMAGE, fine: encodeFine(FINE) }, trace: 1 };
const PARAMS = { ...DEFAULT_PARAMS, seed: 11, cells: 12000 };

function mismatch(world: World, fine: Uint8Array): { pct: number; island: number; strip: number; strait: number } {
  const r = rasterize(world, 1, false);
  let landN = 0;
  let bad = 0;
  for (let k = 0; k < fine.length; k++) {
    const want = fine[k] === FINE_LAND;
    const got = r.water[k] === 0;
    if (want) landN++;
    if (want !== got) bad++;
  }
  const isLand = (x: number, y: number) => (r.water[y * FINE_W + x] === 0 ? 1 : 0);
  return { pct: (100 * bad) / landN, island: isLand(400, 300), strip: isLand(1400, 500), strait: isLand(900, 450) };
}

describe('细图、连续高低的存法', () => {
  it('细图来回一样,一行和上一行一样时只记一个字节;坏的读不出来', () => {
    const s = encodeFine(FINE);
    const same = (a: Uint8Array | null, b: Uint8Array) => !!a && Buffer.from(a).equals(Buffer.from(b));
    expect(same(decodeFine(s), FINE)).toBe(true);
    expect(s.length).toBeLessThan(20_000);
    const mixed = new Uint8Array(FINE_W * FINE_H);
    for (let k = 0; k < 64 * FINE_W; k++) mixed[k] = (k * 7919) % 3;
    expect(same(decodeFine(encodeFine(mixed)), mixed)).toBe(true);
    const bin = atob(s);
    expect(decodeFine(btoa(bin + '\u0001'))).toBeNull();
    expect(decodeFine(btoa(bin.slice(0, -1)))).toBeNull();
    expect(decodeFine(btoa('\u0003'))).toBeNull();
    expect(decodeFine('不是 base64')).toBeNull();
  });

  it('连续高低来回一样(连着的 0、大的落差都行);超出 0–255 的读不出来', () => {
    const g = new Uint8Array(GREY_W * GREY_H);
    for (let y = 0; y < GREY_H; y++) for (let x = 200; x < 330; x++) g[y * GREY_W + x] = x === 260 ? 255 : 1 + ((x * 3 + y) % 200);
    const s = encodeGrey(g);
    expect(decodeGrey(s)).toEqual(g);
    // 第一格就往下落:-1
    expect(decodeGrey(btoa('\u0002' + atob(s).slice(1)))).toBeNull();
  });
});

describe('照图原样认图', () => {
  /** 黑白图:左半黑(陆地)右半白,中间一条 3 像素宽的白缝 */
  function picture(w: number, h: number) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const white = x >= w / 2 || (x >= 100 && x < 103);
        data.set([white ? 255 : 0, white ? 255 : 0, white ? 255 : 0, 255], (y * w + x) * 4);
      }
    return { data, width: w, height: h };
  }

  it('黑白图的海平面取正中间;不糊时 3 像素的缝原样留着', () => {
    const big = preparePicture(picture(2048, 1024), FINE_PICTURE_W);
    expect(big.w).toBe(2048);
    const sea = autoSeaLevel(big, true, true);
    expect(sea).toBeGreaterThan(100);
    expect(sea).toBeLessThan(156);
    const v = levelsFrom(big, { sea, dark: true, sharp: true });
    const fine = placeOnFine(v, big.w, big.h, { fit: 'fill' });
    const row = 500 * FINE_W;
    expect([fine[row + 99], fine[row + 100], fine[row + 102], fine[row + 103]]).toEqual([FINE_LAND, FINE_WATER, FINE_WATER, FINE_LAND]);
    // 糊过、海平面照旧取的那种认法缝两边各被吃掉一格
    const blurred = levelsFrom(big, { sea: autoSeaLevel(big, true), dark: true });
    expect([blurred[500 * big.w + 100], blurred[500 * big.w + 101]]).toEqual([SKETCH_LAND, SKETCH_SEA]);
  });

  it('保持比例放的:细图和连续高低在图外面都是没盖到', () => {
    const pic = preparePicture(picture(400, 200));
    const v = levelsFrom(pic, { sea: 128, dark: true });
    const place = { fit: 'keep' as const, x: 0.5, y: 0.5, scale: 0.5 };
    const fine = placeOnFine(v, pic.w, pic.h, place);
    expect(fine[10 * FINE_W + 10]).toBe(FINE_NONE);
    expect(fine[512 * FINE_W + 700]).toBe(FINE_LAND);
    const grey = greyLayer(pic, 128, true, v, place);
    expect(grey[5 * GREY_W + 5]).toBe(0);
    expect(grey[128 * GREY_W + 180]).toBeGreaterThan(0);
  });
});

describe('清理和存档', () => {
  it('cleanSketch 认 trace = 1 和图里的 fine、grey;别的值、读不出来的丢掉;合格的原样返回', () => {
    const grey = encodeGrey(new Uint8Array(GREY_W * GREY_H).fill(9));
    const ok = { ...TRACED, image: { ...TRACED.image!, grey } };
    expect(cleanSketch(ok)).toBe(ok);
    const odd = cleanSketch({ ...TRACED, trace: 2, image: { ...IMAGE, fine: 'AAAA', grey: '%%' } });
    expect(odd).toEqual({ rest: 'sea', fill: 'detail', strokes: [], image: IMAGE });
    expect(sameSketch(ok, { ...ok, trace: undefined })).toBe(false);
    expect(sameSketch(ok, { ...ok, image: { ...ok.image, fine: encodeFine(new Uint8Array(FINE_W * FINE_H).fill(FINE_WATER)) } })).toBe(false);
    expect(sameSketch(ok, JSON.parse(JSON.stringify(ok)))).toBe(true);
  });

  it('存档读回来,照图原样、细图、高低都在', () => {
    const grey = encodeGrey(new Uint8Array(GREY_W * GREY_H).fill(40));
    const sketch: SketchEdit = { ...TRACED, image: { ...TRACED.image!, grey } };
    const edits: WorldEdits = { ...EMPTY_EDITS, sketch };
    const r = parseSave(saveText(makeSave(PARAMS, edits, 'abc')));
    expect(r.ok && r.save.edits.sketch).toEqual(sketch);
    expect(r.ok && r.warnings).toEqual([]);
  });
});

describe('长出来的海陆', () => {
  const traced = generateWorld(PARAMS, undefined, [], sketchGrid(TRACED));

  it('照图原样:和图上逐像素一致,细半岛、窄海峡、小岛都在;不照图的差得远', () => {
    const t = mismatch(traced, FINE);
    expect(t.pct).toBeLessThan(0.5);
    expect(t).toMatchObject({ island: 1, strip: 1, strait: 0 });
    const loose = mismatch(generateWorld(PARAMS, undefined, [], sketchGrid({ rest: 'sea', fill: 'detail', strokes: [], image: IMAGE })), FINE);
    expect(loose.pct).toBeGreaterThan(3);
  });

  it('放大现算也照图:4 倍的块里细半岛、海峡和整张图一样', () => {
    const whole = rasterize(traced, 1, false);
    const src = zoomSource(traced, whole);
    const S = 4;
    const win = rasterizeWindow(src, S, 1380 * S, 480 * S, 40 * S, 40 * S);
    const at = (x: number, y: number) => win.water[(y - 480) * S * win.w + (x - 1380) * S + S / 2];
    expect(at(1400, 500)).toBe(0);
    expect(at(1400, 490)).not.toBe(0);
    const st = rasterizeWindow(src, S, 880 * S, 440 * S, 40 * S, 20 * S);
    expect(st.water[10 * S * st.w + 20 * S]).not.toBe(0);
  });

  it('改地形以后按块重铺:海岸照样照图,和整张重铺逐位相同', () => {
    const finish = (d: ReturnType<typeof rasterizeDeferred>) => {
      finishGully(d.raster, d.job, gullyHeights(d.job, 0, d.job.n));
      finishVeins(d.raster, veinsOf(d.veins));
      return d.raster;
    };
    const sk = sketchGrid(TRACED);
    const d0 = rasterizeDeferred(traced, 1);
    const keep = { raster: finish(d0), inputs: d0.inputs };
    const w1 = generateWorld(PARAMS, undefined, [{ kind: 'lift', pts: [1300, 500, 1340, 500], r: 30, s: 0.6 }], sk);
    const t = rasterizePatch(w1, keep);
    if (!t || !('job' in t)) throw new Error('没按块重铺');
    const got = finish(t);
    const full = finish(rasterizeDeferred(w1, 1));
    expect(Buffer.from(got.water.buffer).equals(Buffer.from(full.water.buffer))).toBe(true);
    expect(Buffer.from(got.elev.buffer).equals(Buffer.from(full.elev.buffer))).toBe(true);
    expect(got.water[500 * FINE_W + 1400]).toBe(0);
    expect(got.water[450 * FINE_W + 900]).not.toBe(0);
  });

  it('只改了细图(两个地块中间涂一座小岛):按块重铺也画出来,和整张重铺逐位相同', () => {
    const finish = (d: ReturnType<typeof rasterizeDeferred>) => {
      finishGully(d.raster, d.job, gullyHeights(d.job, 0, d.job.n));
      finishVeins(d.raster, veinsOf(d.veins));
      return d.raster;
    };
    const d0 = rasterizeDeferred(traced, 1);
    const keep = { raster: finish(d0), inputs: d0.inputs };
    const w1 = generateWorld(PARAMS, undefined, [], sketchGrid({ ...TRACED, strokes: [{ kind: 'land', r: 2, pts: [1702, 801] }] }));
    const t = rasterizePatch(w1, keep);
    if (!t || !('job' in t)) throw new Error('没按块重铺');
    const got = finish(t);
    const full = finish(rasterizeDeferred(w1, 1));
    expect(full.water[801 * FINE_W + 1702]).toBe(0);
    expect(Buffer.from(got.water.buffer).equals(Buffer.from(full.water.buffer))).toBe(true);
  });

  it('作者在照图的陆地上挖的湖留着', () => {
    const w = generateWorld(PARAMS, undefined, [{ kind: 'lake', pts: [760, 560], r: 16, s: 0.7 }], sketchGrid(TRACED));
    const r = rasterize(w, 1, false);
    expect(r.water[560 * FINE_W + 760]).toBe(2);
  });

  it('图后面用笔涂的几笔照样改海陆(海里涂陆地、陆地上涂海)', () => {
    const strokes = [
      { kind: 'land' as const, r: 12, pts: [1700, 300] },
      { kind: 'sea' as const, r: 12, pts: [800, 500] },
    ];
    const w = generateWorld(PARAMS, undefined, [], sketchGrid({ ...TRACED, strokes }));
    const r = rasterize(w, 1, false);
    expect(r.water[300 * FINE_W + 1700]).toBe(0);
    expect(r.water[500 * FINE_W + 800]).not.toBe(0);
  });

  it('没开照图原样时细图不管用:和没有细图逐位相同', () => {
    const plain: SketchEdit = { rest: 'sea', fill: 'detail', strokes: [], image: IMAGE };
    const withFine: SketchEdit = { ...plain, image: { ...IMAGE, fine: encodeFine(FINE) } };
    const a = rasterize(generateWorld(PARAMS, undefined, [], sketchGrid(plain)), 1, false);
    const b = rasterize(generateWorld(PARAMS, undefined, [], sketchGrid(withFine)), 1, false);
    expect(Buffer.from(b.elev.buffer).equals(Buffer.from(a.elev.buffer))).toBe(true);
    expect(Buffer.from(b.water.buffer).equals(Buffer.from(a.water.buffer))).toBe(true);
  });

  it('连续高低:陆地的海拔跟着图的亮度走', () => {
    const grey = new Uint8Array(GREY_W * GREY_H);
    for (let y = 0; y < GREY_H; y++) for (let x = 0; x < GREY_W; x++) if (FINE[(4 * y + 2) * FINE_W + 4 * x + 2] === FINE_LAND) grey[y * GREY_W + x] = 1 + Math.round((254 * (x - 150)) / 230);
    const w = generateWorld(PARAMS, undefined, [], sketchGrid({ ...TRACED, image: { ...TRACED.image!, grey: encodeGrey(grey) } }));
    let n = 0;
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (let i = 0; i < w.mesh.n; i++) {
      const gx = Math.floor((w.mesh.x[i] / w.width) * GREY_W);
      const gy = Math.floor((w.mesh.y[i] / w.height) * GREY_H);
      const g = grey[gy * GREY_W + gx];
      if (!w.tect.land[i] || !g || gx > 330) continue;
      const e = w.elevation[i];
      n++;
      sx += g;
      sy += e;
      sxx += g * g;
      syy += e * e;
      sxy += g * e;
    }
    const corr = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    expect(corr).toBeGreaterThan(0.8);
  });

  it('别人给的世界文件:照图原样的几样格式对才认', () => {
    const m = { ...traced, history: [] };
    expect(() => validateWorld(m)).not.toThrow();
    expect(() => validateWorld({ ...m, sketch: { ...m.sketch!, mask: new Uint8Array(10) } })).toThrow();
    expect(() => validateWorld({ ...m, sketch: { ...m.sketch!, heights: { grey: new Uint8Array(GREY_W * GREY_H), off: 5 } } })).toThrow();
  });

  it('细图里没盖到的地方照草图格子由程序定', () => {
    const half = FINE.slice();
    for (let y = 0; y < FINE_H; y++) half.fill(FINE_NONE, y * FINE_W + 1600, y * FINE_W + FINE_W);
    expect(sketchGrid({ ...TRACED, rest: 'auto', image: { ...IMAGE, fine: encodeFine(half) } })?.mask?.[300 * FINE_W + 1700]).toBe(FINE_NONE);
  });
});

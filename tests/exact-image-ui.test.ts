/**
 * 照图原样在界面这边:照这样长出星球时草图记下照图原样和细图;细图后认好的,草图底下还是那张图时才补上;换回自然一些就去掉。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { clearEdits, getEdits, setSketchBase, setSketchFine } from '../src/ui/editsStore';
import { LAYER_H, LAYER_W, SKETCH_LAND, SKETCH_SEA } from '../src/gen/sketch';
import { FINE_H, FINE_LAND, FINE_W, FINE_WATER, GREY_H, GREY_W } from '../src/gen/sketchFine';
import { encodeFine, encodeGrey } from '../src/gen/sketchFineWrite';

const layer = new Uint8Array(LAYER_W * LAYER_H).fill(SKETCH_SEA);
for (let y = 100; y < 150; y++) layer.fill(SKETCH_LAND, y * LAYER_W + 100, y * LAYER_W + 200);
const fineGrid = new Uint8Array(FINE_W * FINE_H).fill(FINE_WATER);
for (let y = 400; y < 600; y++) fineGrid.fill(FINE_LAND, y * FINE_W + 400, y * FINE_W + 800);
const FINE = encodeFine(fineGrid);
const GREY = encodeGrey(new Uint8Array(GREY_W * GREY_H).fill(20));

beforeEach(() => clearEdits());

describe('照这样长出星球', () => {
  it('照图原样:草图记下 trace、细图和连续高低;再按自然一些长一次就都去掉', () => {
    expect(setSketchBase('a.png', layer, undefined, 'detail', { fine: FINE, grey: GREY })).toBe(true);
    const sk = getEdits().sketch!;
    expect(sk.trace).toBe(1);
    expect(sk.image).toMatchObject({ name: 'a.png', fine: FINE, grey: GREY });
    expect(setSketchBase('a.png', layer, undefined, 'detail')).toBe(true);
    const plain = getEdits().sketch!;
    expect('trace' in plain).toBe(false);
    expect(Object.keys(plain.image!).sort()).toEqual(['cells', 'name']);
  });

  it('细图后认好的:还照图原样、还是那张图、还没有细图时才补上', () => {
    setSketchBase('a.png', layer, undefined, 'detail', {});
    const cells = getEdits().sketch!.image!.cells;
    expect(setSketchFine('别的图', FINE)).toBe(false);
    expect(setSketchFine(cells, FINE)).toBe(true);
    expect(getEdits().sketch!.image!.fine).toBe(FINE);
    expect(setSketchFine(cells, FINE)).toBe(false);
    setSketchBase('a.png', layer, undefined, 'detail');
    expect(setSketchFine(getEdits().sketch!.image!.cells, FINE)).toBe(false);
  });
});

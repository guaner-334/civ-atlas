import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { EMPTY_EDITS, type Upheaval } from '../src/gen/edits';
import { makeSave } from '../src/gen/savefile';
import { makePart, packValue, readPart, recipeKey, recipeOfSave, recipeText, unpackValue } from '../src/gen/snapshot';

describe('原件:打包、读回一个值', () => {
  it('JSON 写不了的几种原样读回:undefined、NaN、±Infinity、-0、Map、Set、各种数组、带 $$ 键的对象', () => {
    const shared = [1, 2];
    const arr = new Float32Array([1.5, NaN, -0, Infinity]);
    const v = {
      a: undefined,
      list: [undefined, null, 1, 'x', true],
      n: [NaN, Infinity, -Infinity, -0, 0, 3.25],
      m: new Map<unknown, unknown>([
        [1, 'one'],
        ['k', { z: new Int16Array([-3, 4]) }],
      ]),
      s: new Set([1, 'b']),
      arrays: [new Float64Array([Math.PI]), new Int8Array([-1]), new Uint8Array([255]), new Uint8ClampedArray([7]), new Uint16Array([65535]), new Int32Array([-5, 6]), new Uint32Array([4e9])],
      odd: { $$: 'not a tag', x: 1 },
      empty: new Uint8Array(0),
      arr,
      again: arr,
      p: shared,
      q: shared,
    };
    const back = unpackValue(packValue(v)) as typeof v;
    expect(isDeepStrictEqual(back, v)).toBe(true);
    expect(Object.is(back.n[3], -0)).toBe(true);
    expect('a' in back).toBe(true);
    // 同一个对象读回来还是同一个
    expect(back.p).toBe(back.q);
    expect(back.again).toBe(back.arr);
    // 数组是复制出来的,不和原来的共用
    expect(back.arr).not.toBe(arr);
  });

  it('函数、类的实例打不了包;字节不全、不是原件的读不回', () => {
    expect(() => packValue({ f: () => 1 })).toThrow();
    expect(() => packValue({ d: new Date() })).toThrow();
    const bytes = packValue({ a: new Float32Array(100) });
    expect(() => unpackValue(bytes.subarray(0, bytes.length - 8))).toThrow();
    expect(() => unpackValue(new TextEncoder().encode('{"a":1}'))).toThrow();
  });
});

describe('原件:真实的世界和历史', () => {
  it('地图、地形大事以后的各段、整段历史打成块再读回,和原来一模一样;改一个字节就不认', async () => {
    const params = { ...DEFAULT_PARAMS, seed: 7, cells: 6000 };
    const world = generateWorld(params);
    const ups: Upheaval[] = [{ year: 1600, ops: [{ kind: 'sink', pts: [1856, 574, 1936, 584], r: 40, s: 1.1 }] }];
    const steps = upheavalSteps(params, [], null, ups, { endYear: 3000 });
    const civ = generateCiv(world, { upheavals: steps });
    const { history: _h, ...map } = world;
    void _h;
    const eras = steps.map((s) => {
      const { mesh: _m, history: _x, ...rest } = s.world;
      void _m;
      void _x;
      return { key: `k${s.year}`, world: { ...rest, history: [] } };
    });
    for (const [name, value] of [
      ['map', { ...map, history: [] }],
      ['eras', { baseKey: 'k0', eras }],
      ['civ', civ],
    ] as const) {
      const part = await makePart(name, value);
      expect(part.zip).toBe('gzip');
      expect(part.data.byteLength).toBeLessThan(part.bytes);
      expect(isDeepStrictEqual(await readPart(part), value)).toBe(true);
      const bad = new Uint8Array(part.data.slice(0));
      bad[bad.length >> 1] ^= 0xff;
      await expect(readPart({ ...part, data: bad.buffer })).rejects.toThrow();
    }
  });
});

describe('原件:配方指纹', () => {
  it('存档里的配方和推文明的请求取法一致:默认值、空的、键的先后不算不同', async () => {
    const params = { ...DEFAULT_PARAMS, seed: 7 };
    const edits = { ...EMPTY_EDITS, interventions: [], terrain: [], nameMix: {}, endYear: 3000 };
    const save = makeSave(params, edits, 'c');
    // 请求里:默认的推演年数、自动的地名风格、空的地形修改都不带
    const request = { params: Object.fromEntries(Object.entries(params).reverse()) as typeof params, interventions: [] };
    expect(recipeText(recipeOfSave(save))).toBe(recipeText(request));
    expect(await recipeKey(recipeOfSave(save))).toBe(await recipeKey(request));
    expect(await recipeKey(recipeOfSave(save))).toMatch(/^[0-9a-f]{64}$/);
  });

  it('输入不一样指纹就不一样:种子、干预、推演年数、地名风格', () => {
    const base = { params: { ...DEFAULT_PARAMS, seed: 7 } };
    const texts = [
      base,
      { params: { ...DEFAULT_PARAMS, seed: 8 } },
      { ...base, interventions: [{ kind: 'halt' as const, a: 'polity:c1#0', from: 100 }] },
      { ...base, endYear: 6000 },
      { ...base, names: { xianxia: 1 } },
    ].map(recipeText);
    expect(new Set(texts).size).toBe(texts.length);
  });
});

/**
 * 推不下去时停在那一年(gen/civ/stuck.ts)和再推里的那一头(gen/civ/extend.ts):
 * - 推得完的照旧,和 generateCiv 逐字段一样,不带 stuck
 * - 推不下去:停在出错前最后推好的那一年,和一口气推到那一年逐字段一样(只多一个 stuck);同样的输入停在同一年
 * - 从推好的一份接着推、接不着推(按年份找)、再推,停在同一年;整理时出错的按年份往前找;头几年就推不下去 = 照旧抛错
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { breakAt, growEngine, type GrowEngine } from '../src/gen/civ/grow';
import { civOrStuck, continueOrStuck, findStuck } from '../src/gen/civ/stuck';
import { extendCiv } from '../src/gen/civ/extend';

const PARAMS = { ...DEFAULT_PARAMS, cells: 12000, seed: 7 };
let world: World | null = null;
const worldOf = () => (world ??= generateWorld(PARAMS));

/** 两份历史逐字段一样(stuck 不算) */
function sameCiv(a: Civ, b: Civ, label: string) {
  const { stuck: _a, ...x } = a;
  const { stuck: _b, ...y } = b;
  for (const k of Object.keys(y) as (keyof typeof y)[]) expect(x[k], `${label} ${k}`).toEqual(y[k]);
  expect(Object.keys(x).sort(), label).toEqual(Object.keys(y).sort());
}

describe('推不下去时停在那一年', () => {
  it('推得完的照旧:和 generateCiv 一样,不带 stuck', () => {
    const w = worldOf();
    const civ = civOrStuck(w, { endYear: 200 });
    expect('stuck' in civ).toBe(false);
    sameCiv(civ, generateCiv(w, { endYear: 200 }), '推完');
  }, 120_000);

  it('推不下去:停在出错前那一年,和一口气推到那年一样;再推一遍停在同一年', () => {
    const w = worldOf();
    const errs: unknown[] = [];
    const civ = civOrStuck(w, { endYear: 400 }, { engine: breakAt(150), failed: (e) => errs.push(e) });
    expect(civ.stuck).toEqual({ at: 150, to: 400 });
    expect(civ.endYear).toBe(150);
    expect(errs.length).toBe(1);
    sameCiv(civ, generateCiv(w, { endYear: 150 }), '停在 150 年');
    const again = civOrStuck(w, { endYear: 400 }, { engine: breakAt(150) });
    expect(again.stuck).toEqual(civ.stuck);
    sameCiv(again, civ, '再推一遍');
  }, 120_000);

  it('从推好的一份接着推、接不着推按年份找、再推:停在同一年', async () => {
    const w = worldOf();
    const base = generateCiv(w, { endYear: 120 });
    const want = generateCiv(w, { endYear: 170 });
    const go = continueOrStuck(w, base, { endYear: 400 }, { engine: breakAt(170) });
    expect(go.stuck).toEqual({ at: 170, to: 400 });
    sameCiv(go, want, '接着推');
    // 接不着推的(有地形大事的世界):按年份二分
    const noResume: GrowEngine = { ...breakAt(170), resume: () => null };
    const bis = findStuck(w, { endYear: 400 }, null, noResume)!;
    expect(bis.stuck).toEqual({ at: 170, to: 400 });
    sameCiv(bis, want, '按年份找');
    const ext = (await extendCiv(w, base, { endYear: 400 }, { engine: breakAt(170) }))!;
    expect(ext.stuck).toEqual({ at: 170, to: 400 });
    sameCiv(ext, want, '再推');
  }, 180_000);

  it('推得过去、整理时出错:按年份往前找到整理得出来的那一年', () => {
    const w = worldOf();
    const finishBreaks: GrowEngine = {
      generate: breakAt(170).generate,
      resume: (world, civ, params) => {
        const r = growEngine.resume(world, civ, params);
        if (!r) return r;
        return {
          get from() {
            return r.from;
          },
          get to() {
            return r.to;
          },
          get year() {
            return r.year;
          },
          advance: (y: number) => r.advance(y),
          finish: () => {
            if (r.to > 170) throw new Error('整理时出错');
            return r.finish();
          },
          partial: () => r.partial(),
        };
      },
    };
    const civ = civOrStuck(w, { endYear: 300 }, { engine: finishBreaks });
    expect(civ.stuck).toEqual({ at: 170, to: 300 });
    sameCiv(civ, generateCiv(w, { endYear: 170 }), '整理时出错');
  }, 180_000);

  it('头几年就推不下去:照旧抛错', () => {
    const w = worldOf();
    expect(() => civOrStuck(w, { endYear: 400 }, { engine: breakAt(5) })).toThrow();
  }, 60_000);
});

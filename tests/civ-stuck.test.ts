/**
 * 推不下去时停在那一年(gen/civ/stuck.ts)和再推里的那一头(gen/civ/extend.ts):
 * - 推得完的照旧,和 generateCiv 逐字段一样,不带 stuck
 * - 推不下去:停在出错前最后推好的那一年,和一口气推到那一年逐字段一样(只多一个 stuck);同样的输入停在同一年
 * - 从推好的一份接着推、接不着推(按年份找)、再推,停在同一年;整理时出错的按年份往前找;头几年就推不下去 = 照旧抛错
 * - 逐年推演的一步推不下去:停在出错前那一年年初,进度跟着停在那里;一点都没往前走的停在原处
 * - 照大纲推演推不下去:停在那一年,前面查过的照旧,没查到的标「推不下去」
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { breakAt, growEngine, type GrowEngine } from '../src/gen/civ/grow';
import { civOrStuck, continueOrStuck, findStuck } from '../src/gen/civ/stuck';
import { extendCiv } from '../src/gen/civ/extend';
import { playCiv, playStop, playTurn, type PlayContinue } from '../src/gen/civ/play';
import { playAt, playState, YEAR_TICKS } from '../src/gen/edits';
import { runOutline } from '../src/gen/outline';
import { samplePlots } from '../scripts/lib/outlineSample';

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

  it('逐年推演的一步推不下去:停在出错前那一年年初,进度跟着停;一点没往前走的停在原处', () => {
    const w = worldOf();
    const cont: PlayContinue = (world, civ, params) => continueOrStuck(world, civ, params, { engine: breakAt(170), snap: (y) => playStop(y) });
    const play = playState(150, 0, []);
    const from = playCiv(w, {}, play);
    const step = playTurn(w, from, {}, play, [], 40, cont);
    expect(step.civ.stuck).toEqual({ at: 170, to: playStop(190) });
    expect(playAt(step.play)).toBe(170 * YEAR_TICKS);
    sameCiv(step.civ, playCiv(w, {}, playState(170, 0, [])), '停在第 170 年年初');
    const again = playTurn(w, step.civ, {}, step.play, [], 5, cont);
    expect(again.civ.stuck?.at).toBe(170);
    expect(playAt(again.play)).toBe(170 * YEAR_TICKS);
    expect(again.civ.endYear).toBe(step.civ.endYear);
    // 推得完的照旧:和不换 cont 一样
    const ok = playTurn(w, from, {}, play, [], 10, (world, civ, params) => continueOrStuck(world, civ, params, { snap: (y) => playStop(y) }));
    expect('stuck' in ok.civ).toBe(false);
    sameCiv(ok.civ, playTurn(w, from, {}, play, [], 10).civ, '推得完');
  }, 180_000);

  it('照大纲推演推不下去:停在那一年,前面查过的照旧,没查到的标「推不下去」', async () => {
    const w = worldOf();
    const base = generateCiv(w, { endYear: 400 });
    const plots = samplePlots(base, 7, 6, 150, 380);
    const errs: unknown[] = [];
    const out = (await runOutline(w, { endYear: 400 }, { plots, interventions: [] }, { engine: breakAt(358), failed: (e) => errs.push(e) }))!;
    expect(out.civ.stuck).toEqual({ at: 358, to: 400 });
    expect(errs.length).toBeGreaterThan(0);
    expect(out.review.map((r) => r.id)).toEqual(plots.map((p) => p.id));
    const late = out.review.filter((r) => r.reason === 'stuck');
    expect(late.length).toBeGreaterThan(0);
    expect(late.length).toBeLessThan(plots.length);
    for (const r of late) expect(r.status).toBe('failed');
    sameCiv(out.civ, generateCiv(w, { interventions: out.interventions.length ? out.interventions : undefined, endYear: 358 }), '停在第 358 年');
    // 前面查过的几条和推得完时一样
    const full = (await runOutline(w, { endYear: 400 }, { plots, interventions: [] }))!;
    for (const r of out.review) if (r.reason !== 'stuck') expect(r).toEqual(full.review.find((x) => x.id === r.id));
  }, 240_000);
});

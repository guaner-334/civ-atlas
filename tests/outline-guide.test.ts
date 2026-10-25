/**
 * 照大纲推演的"顺着引"(gen/outline.ts 文件头"顺着引"):
 * - 不给 tries = 不引,和以前一样;引了的世界 = 带着同样的干预从第 0 年一口气推完(seed 7 / 2024 / 11)
 * - 引成了标「顺着引了一把」,引出来的方针带 plot、guide,引到窗口最后一年年底就换回去;没引成的硬改、做不到记下试了几版
 * - 编年史不写引出来的方针;guideNotes 和作者自己的方针比;引的时候能叫停
 * - 存档往返(guide、guided、tried 都带着;guide 只认照大纲的方针)
 */
import { describe, expect, it } from 'vitest';
import { generateWorld, DEFAULT_PARAMS, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { buildChronicle } from '../src/gen/civ/chronicle';
import { runOutline } from '../src/gen/outline';
import { cleanIntervention, cleanOutline, guideNotes, type Intervention, type Plot } from '../src/gen/edits';
import { samplePlots } from '../scripts/lib/outlineSample';

const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};
const bases = new Map<number, Civ>();
const baseCiv = (seed: number) => {
  let c = bases.get(seed);
  if (!c) bases.set(seed, (c = generateCiv(world(seed), {})));
  return c;
};

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

/** seed 6 的随机大纲里第 2555 年那条开战(和它前面的几条硬改):照常推没发生,引几版能引成 */
const GUIDED_SEED = 6;
const GUIDED_YEAR = 2555;
const guidedCase = () => samplePlots(baseCiv(GUIDED_SEED), GUIDED_SEED, 20).filter((p) => p.year <= GUIDED_YEAR && p.kind !== 'peace' && p.kind !== 'submit');

describe('不引 = 和以前一样', () => {
  it('tries 不给、给 0 一样;没有 guided、tried', async () => {
    const seed = 7;
    const plots = samplePlots(baseCiv(seed), seed, 8);
    const a = (await runOutline(world(seed), {}, { plots, interventions: [] }))!;
    const b = (await runOutline(world(seed), {}, { plots, interventions: [], tries: 0 }))!;
    expect(b.review).toEqual(a.review);
    expect(b.interventions).toEqual(a.interventions);
    for (const r of a.review) {
      expect(r.status).not.toBe('guided');
      expect(r.tried).toBeUndefined();
    }
    expect(a.interventions.some((v) => v.guide)).toBe(false);
  }, 120_000);
});

describe('引了的世界 = 带着同样的干预从第 0 年一口气推完', () => {
  for (const seed of [7, 2024, 11]) {
    it(`seed ${seed}:10 条随机情节,每条最多试 4 版`, async () => {
      const w = world(seed);
      const plots = samplePlots(baseCiv(seed), seed, 10);
      const out = (await runOutline(w, {}, { plots, interventions: [], tries: 4 }))!;
      for (const r of out.review) {
        if (r.tried !== undefined) {
          expect(['forced', 'failed']).toContain(r.status);
          expect(r.tried).toBeGreaterThanOrEqual(1);
          expect(r.tried).toBeLessThanOrEqual(4);
        }
      }
      // 引出来的都是方针、带着它那条情节的编号,那条批改是"顺着引了一把"
      for (const v of out.interventions.filter((v) => v.guide)) {
        expect(v.kind).toBe('policy');
        expect(out.review.find((r) => r.id === v.plot)?.status).toBe('guided');
      }
      same(out.civ, generateCiv(w, { interventions: out.interventions }), `seed ${seed}`);
    }, 180_000);
  }
});

describe('顺着引了一把', () => {
  it(`seed ${GUIDED_SEED} 第 ${GUIDED_YEAR} 年的开战:引成了,方针引到窗口最后一年年底就换回去;编年史不写`, async () => {
    const seed = GUIDED_SEED;
    const w = world(seed);
    const plots = guidedCase();
    const war = plots.find((p) => p.kind === 'war' && p.year === GUIDED_YEAR)!;
    const plain = (await runOutline(w, {}, { plots, interventions: [] }))!;
    expect(plain.review.find((r) => r.id === war.id)?.status).toBe('forced');
    const stages: { n: number; of: number }[] = [];
    const out = (await runOutline(w, {}, { plots, interventions: [], tries: 12 }, { stage: (id, _fix, t) => id === war.id && t && stages.push(t) }))!;
    const r = out.review.find((x) => x.id === war.id)!;
    expect(r, JSON.stringify(out.review)).toMatchObject({ status: 'guided' });
    expect(r.year).toBeGreaterThanOrEqual(GUIDED_YEAR - 10);
    expect(r.year).toBeLessThanOrEqual(GUIDED_YEAR + 10);
    // 第几版:从 1 起一版版往上数,最后一版就是引成的那版
    expect(stages.map((t) => t.n)).toEqual(stages.map((_, i) => i + 1));
    expect(stages.every((t) => t.of === stages[0].of)).toBe(true);
    const gs = out.interventions.filter((v) => v.plot === war.id);
    expect(gs.every((v) => v.kind === 'policy' && v.guide)).toBe(true);
    // 起引那条:a 更好战、仇国是 b;窗口最后一年的下一年换回(a 自己没有方针 = 罢方针)
    const start = gs.find((v) => v.kind === 'policy' && v.foes?.length)!;
    expect(start).toMatchObject({ a: war.a, foes: [war.b] });
    expect(gs.find((v) => v !== start)).toEqual({ kind: 'policy', a: war.a, from: GUIDED_YEAR + 11, plot: war.id, guide: true });
    expect(guideNotes(out.interventions, war.id)).toEqual([{ a: war.a, from: start.from, war: (start as { war?: number }).war, expand: 0, peace: 0, foes: [war.b], friends: [] }]);
    same(out.civ, generateCiv(w, { interventions: out.interventions }), `seed ${seed} 引了`);
    // 编年史:引出来的方针不写;硬改的照旧写【照大纲】
    const entries = buildChronicle(out.civ);
    const guided = new Set(out.civ.annals.flatMap((e, i) => (e.kind === 'intervene' && out.civ.interventions?.[e.war]?.guide ? [i] : [])));
    expect(guided.size).toBe(2);
    expect(entries.some((e) => e.kind === 'intervene' && guided.has(e.id))).toBe(false);
    expect(entries.some((e) => e.text.includes('【照大纲】'))).toBe(true);
  }, 180_000);

  it('作者自己定过方针:引的时候加在它上面,引完换回它;guideNotes 只写多加的', () => {
    const own: Intervention[] = [{ kind: 'policy', a: 'polity:c1#0', from: 500, preset: 'trade', war: -15, coast: 35, foes: ['polity:c3#0'], focus: 'transport' }];
    const list: Intervention[] = [
      ...own,
      { kind: 'policy', a: 'polity:c1#0', from: 900, war: 5, coast: 35, foes: ['polity:c2#0', 'polity:c3#0'], focus: 'transport', plot: 4, guide: true },
      { kind: 'policy', a: 'polity:c1#0', from: 931, preset: 'trade', war: -15, coast: 35, foes: ['polity:c3#0'], focus: 'transport', plot: 4, guide: true },
    ];
    expect(guideNotes(list, 4)).toEqual([{ a: 'polity:c1#0', from: 900, war: 20, expand: 0, peace: 0, foes: ['polity:c2#0'], friends: [] }]);
    expect(guideNotes(list, 5)).toEqual([]);
  });

  it('引的时候能叫停 = null', async () => {
    const seed = GUIDED_SEED;
    let trials = 0;
    const out = await runOutline(world(seed), {}, { plots: guidedCase(), interventions: [], tries: 12 }, { stage: (_id, _fix, t) => t && trials++, stop: () => trials >= 1 });
    // 不拿整份历史去比:比不上时 vitest 把它整个打印出来,太大
    expect(out === null).toBe(true);
    expect(trials).toBe(1);
  }, 120_000);
});

describe('存档', () => {
  it('guide 只认照大纲的方针;guided、tried 往返不变', () => {
    const g: Intervention = { kind: 'policy', a: 'polity:c1#0', from: 900, war: 20, foes: ['polity:c2#0'], plot: 3, guide: true };
    expect(cleanIntervention(g)).toBe(g);
    expect(cleanIntervention({ ...g, plot: undefined })).toEqual({ kind: 'policy', a: 'polity:c1#0', from: 900, war: 20, foes: ['polity:c2#0'] });
    expect(cleanIntervention({ kind: 'declare', a: 'polity:c1#0', b: 'polity:c2#0', from: 900, plot: 3, guide: true })).toEqual({ kind: 'declare', a: 'polity:c1#0', b: 'polity:c2#0', from: 900, plot: 3 });
    const plots: Plot[] = [
      { id: 1, kind: 'war', year: 1520, a: 'polity:c1#0', b: 'polity:c2#0' },
      { id: 2, kind: 'peace', year: 1600, a: 'polity:c1#0', b: 'polity:c2#0' },
      { id: 3, kind: 'fall', year: 1700, a: 'polity:c2#0' },
    ];
    const outline = { plots, review: [{ id: 1, status: 'guided' as const, year: 1515 }, { id: 2, status: 'failed' as const, year: 1600, reason: 'unsupported' as const, tried: 12 }, { id: 3, status: 'forced' as const, year: 1700, tried: 4 }] };
    expect(cleanOutline(outline)).toBe(outline);
    // tried 只跟着硬改的、做不到的;不合格的去掉
    const bad = { plots, review: [{ id: 1, status: 'guided', year: 1515, tried: 3 }, { id: 2, status: 'failed', year: 1600, reason: 'unsupported', tried: 0 }] };
    expect(cleanOutline(bad)?.review).toEqual([{ id: 1, status: 'guided', year: 1515 }, { id: 2, status: 'failed', year: 1600, reason: 'unsupported' }]);
  });
});

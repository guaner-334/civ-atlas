/**
 * 一段历史边推边交(gen/civ/grow.ts)和后台线程里那一头(src/growThread.ts):
 * - 分几次交的每一份,和一口气推到那一年逐字段一样;最后一份就是一口气推到底的那一份(官方规则、改过的规则、带文明种子和天灾)
 * - 每次 step 推满时间就停(至少往前推一次),年份只往前走
 * - 推不下去:停在出错前最后推好的那一年,交到那年为止整理好的历史(和一口气推到那年一样);头几年就出错 = 没有历史;整理时出错 = 上一份
 * - 线程那一头:几段轮流推、各自交;换了规则的那段从头推,没换的接着推(不重来);推完的不再推
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startContinue, type Civ, type CivParams } from '../src/gen/civ';
import { startGrow, type GrowEngine, type GrowEvent } from '../src/gen/civ/grow';
import { tuningPatch } from '../src/gen/civ/tuningPatch';
import { growMessage, type GrowReply } from '../src/growThread';

const PARAMS = { ...DEFAULT_PARAMS, cells: 12000, seed: 7 };
let world: World | null = null;
const worldOf = () => (world ??= generateWorld(PARAMS));

/** 两份历史逐字段一样(键也一样) */
function sameCiv(a: Civ, b: Civ, label: string) {
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
}

/** 一直推到推完,收下所有的事 */
function drain(g: ReturnType<typeof startGrow>, budget = 1e9): GrowEvent[] {
  const out: GrowEvent[] = [];
  for (let i = 0; !g.done && i < 1e6; i++) {
    const e = g.step(budget);
    if (e) out.push(e);
  }
  return out;
}

const MARKS = [120, 260, 400];

describe('边推边交', () => {
  it('官方规则、改过的规则:每一份和一口气推到那一年逐字段一样,最后一份推完', () => {
    const w = worldOf();
    const tuned: Partial<CivParams> = { knobs: tuningPatch({ 'war.odds': 4, 'war.truce': 0, 'diplo.marry': 0 }), civSeed: 52817, calamity: 'more' };
    for (const [label, params] of [
      ['官方', {}],
      ['改过', tuned],
    ] as const) {
      const evs = drain(startGrow(w, params, { marks: MARKS }));
      expect(evs.map((e) => e.kind)).toEqual(['civ', 'civ', 'civ']);
      const civs = evs.map((e) => (e as Extract<GrowEvent, { kind: 'civ' }>).civ);
      expect(civs.map((c) => c.endYear)).toEqual(MARKS);
      expect(evs.map((e) => (e as Extract<GrowEvent, { kind: 'civ' }>).done)).toEqual([false, false, true]);
      sameCiv(civs[2], generateCiv(w, { ...params, endYear: 400 }), `${label} 最后一份`);
      sameCiv(civs[0], generateCiv(w, { ...params, endYear: 120 }), `${label} 第一份`);
    }
  }, 120_000);

  it('推满时间就停、至少往前推一次;年份只往前走', () => {
    const w = worldOf();
    let t = 0;
    // 假的表:每看一次过去 1000 毫秒,于是每次 step 只往前推一步
    const g = startGrow(w, {}, { marks: [30, 60], now: () => (t += 1000) });
    const years: number[] = [];
    let steps = 0;
    while (!g.done && steps < 500) {
      const e = g.step(50);
      steps++;
      years.push(g.year);
      if (e) expect(e.kind).toBe('civ');
    }
    expect(g.done).toBe(true);
    expect(steps).toBeGreaterThan(30);
    for (let i = 1; i < years.length; i++) expect(years[i]).toBeGreaterThanOrEqual(years[i - 1]);
    expect(g.step(50)).toBeNull();
  }, 60_000);

  it('推不下去:停在出错前最后推好的那一年,交到那年为止的历史;头几年就出错 = 没有历史;整理时出错 = 上一份', () => {
    const w = worldOf();
    /** 推到 bad 年以后就出错的引擎(从 bad 年起往后推一步就抛) */
    const breaking = (bad: number, where: 'advance' | 'generate' | 'finish'): GrowEngine => ({
      generate: (world, params) => {
        if (where === 'generate') throw new Error('坏了');
        return generateCiv(world, params);
      },
      resume: (world, civ, params) => {
        const r = startContinue(world, civ, params);
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
          advance(y: number) {
            if (where === 'advance' && y > bad && params.endYear! > bad) throw new Error('坏了');
            r.advance(y);
          },
          finish() {
            if (where === 'finish' && r.to > bad) throw new Error('坏了');
            return r.finish();
          },
          partial: () => r.partial(),
        };
      },
    });
    const evs = drain(startGrow(w, {}, { marks: MARKS, engine: breaking(187, 'advance') }));
    expect(evs.map((e) => e.kind)).toEqual(['civ', 'failed']);
    const f = evs[1] as Extract<GrowEvent, { kind: 'failed' }>;
    expect(f.at).toBe(187);
    expect(f.civ!.endYear).toBe(187);
    sameCiv(f.civ!, generateCiv(w, { endYear: 187 }), '停在出错前');

    const first = drain(startGrow(w, {}, { marks: MARKS, engine: breaking(0, 'generate') }));
    expect(first).toEqual([{ kind: 'failed', at: 0, civ: null }]);

    const fin = drain(startGrow(w, {}, { marks: MARKS, engine: breaking(200, 'finish') }));
    expect(fin.map((e) => e.kind)).toEqual(['civ', 'failed']);
    const ff = fin[1] as Extract<GrowEvent, { kind: 'failed' }>;
    expect(ff.civ!.endYear).toBe(120);
    expect(ff.at).toBe(260);
  }, 120_000);
});

describe('后台线程里几段轮流推', () => {
  const MAP = { params: PARAMS };

  it('两段各交各的,最后一份和一口气推完一样;换了规则的那段从头推,没换的接着推;推完的不再推', async () => {
    const w = worldOf();
    const got: GrowReply[] = [];
    let switched = false;
    const reply = (r: GrowReply) => {
      got.push(r);
      // 第 0 段交了第一份以后,第 1 段换一套规则(第 0 段 key 不变)
      if (!switched && r.grow === 'civ' && r.side === 0) {
        switched = true;
        void growMessage({ grow: 'start', map: MAP, setup: {}, sides: [{ side: 0, key: 1 }, { side: 1, key: 3, tuning: { 'split.odds': 4 } }] }, reply);
      }
    };
    await growMessage({ grow: 'start', map: MAP, setup: {}, sides: [{ side: 0, key: 1 }, { side: 1, key: 2, tuning: { 'war.odds': 4 } }] }, reply);
    const civs = (side: number, key: number) => got.filter((r): r is Extract<GrowReply, { grow: 'civ' }> => r.grow === 'civ' && r.side === side && r.key === key);
    // 第 0 段没重来:每个交历史的年份只交一次
    expect(civs(0, 1).map((r) => r.civ.endYear)).toEqual([300, 700, 1300, 2100, 3000]);
    expect(civs(0, 1).at(-1)!.done).toBe(true);
    // 第 1 段换了规则以后从头推完
    expect(civs(1, 3).map((r) => r.civ.endYear)).toEqual([300, 700, 1300, 2100, 3000]);
    sameCiv(civs(1, 3).at(-1)!.civ, generateCiv(w, { knobs: tuningPatch({ 'split.odds': 4 }) }), '换了规则的那段');
    sameCiv(civs(0, 1).at(-1)!.civ, generateCiv(w), '官方那段');
    // 推的时候报过推到哪年
    expect(got.some((r) => r.grow === 'progress' && r.side === 0)).toBe(true);

    // 两段都推完了,再发一样的:不再推
    const again: GrowReply[] = [];
    await growMessage({ grow: 'start', map: MAP, setup: {}, sides: [{ side: 0, key: 1 }, { side: 1, key: 3, tuning: { 'split.odds': 4 } }] }, (r) => again.push(r));
    expect(again).toEqual([]);
  }, 300_000);
});

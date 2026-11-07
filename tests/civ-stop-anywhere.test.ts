/**
 * 从第 0 年起一步步推(gen/civ/index.ts 的 startCiv):停在哪一刻、停几次,推完和一口气推完(generateCiv)逐字节一样(存成原件的字节比)。
 * 随机挑的时刻(带小数)、头几年每 1/256 年停一次、第 0 年和最后一年、地形大事前后、带干预和天灾、改过的规则、文明种子
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startCiv, type Civ, type CivParams } from '../src/gen/civ';
import { packValue } from '../src/gen/snapshot';
import { upheavalSteps, type UpheavalStep } from '../src/gen/civ/upheaval';
import { polityKey, type Intervention, type Upheaval } from '../src/gen/edits';
import { mulberry32, subSeed } from '../src/gen/util';
import { tuningPatch } from '../src/gen/civ/tuningPatch';
import { TUNING_CALC } from '../src/gen/civ/tuning';
import { civDiff } from '../scripts/lib/resumeFuzz';

const PARAMS = { ...DEFAULT_PARAMS, cells: 12000 };
const worlds = new Map<number, World>();
function worldOf(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...PARAMS, seed })));
  return w;
}

/** 存成原件的字节一样(键的先后、数组的类型、共用的对象都算) */
function sameBytes(a: Civ, b: Civ, label: string) {
  const x = packValue(a);
  const y = packValue(b);
  const same = Buffer.from(x.buffer, x.byteOffset, x.byteLength).equals(Buffer.from(y.buffer, y.byteOffset, y.byteLength));
  if (!same) expect(civDiff(a, b), label).toBeNull();
  expect(same, label).toBe(true);
}

/** 照给的时刻依次停下(每停一次 year 就是那一刻),再推完 */
function stepped(world: World, params: Partial<CivParams>, stops: readonly number[]): Civ {
  const run = startCiv(world, params);
  expect(run.year).toBe(0);
  for (const t of stops) {
    run.advance(t);
    expect(run.year).toBe(Math.min(t, run.to));
  }
  return run.finish();
}

/** 在 (0, to) 里随机挑 n 个时刻,一半带小数,从小到大 */
function randomStops(seed: number, to: number, n: number): number[] {
  const rnd = mulberry32(subSeed(seed, 'stop-anywhere'));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = rnd() * to;
    out.push(i % 2 ? Math.floor(t) : t);
  }
  return out.sort((a, b) => a - b);
}

/** 第 year 年活着、还要再活 200 年的两个国家 */
function twoAlive(civ: Civ, year: number): [number, number] {
  const alive = civ.polities.filter((q) => q.founded < year && (q.ended === undefined || q.ended > year + 200)).map((q) => q.id);
  return [alive[0], alive[1]];
}

describe('从第 0 年起一步步推:停在哪、停几次都和一口气推完逐字节一样', () => {
  it('seed 7 官方规则、seed 2024 天灾多 + 改过的规则 + 文明种子:随机挑 12 个时刻停', () => {
    const tuned: Partial<CivParams> = { calamity: 'more', civSeed: 52817, knobs: tuningPatch({ 'war.odds': 4, 'split.odds': 2 }, TUNING_CALC) };
    for (const [seed, params] of [
      [7, {}],
      [2024, tuned],
    ] as const) {
      const w = worldOf(seed);
      const stops = randomStops(seed, 3000, 12);
      sameBytes(stepped(w, params, stops), generateCiv(w, params), `seed ${seed} 停在 ${stops.map((t) => t.toFixed(3)).join('、')}`);
    }
  }, 120_000);

  it('头 3 年每 1/256 年停一次,之后每年停一次', () => {
    const w = worldOf(7);
    const stops = [...Array.from({ length: 3 * 256 }, (_, i) => i / 256), ...Array.from({ length: 298 }, (_, i) => i + 3)];
    sameBytes(stepped(w, { endYear: 300 }, stops), generateCiv(w, { endYear: 300 }), '逐刻、逐年');
  }, 60_000);

  it('停在第 0 年和最后一年;往回推不动;超过最后一年的按最后一年;推到第 0 年为止的也一样', () => {
    const w = worldOf(2024);
    const run = startCiv(w, { endYear: 1000 });
    run.advance(0);
    expect(run.year).toBe(0);
    run.advance(0);
    run.advance(400);
    run.advance(399);
    expect(run.year).toBe(400);
    run.advance(1000);
    run.advance(1050);
    expect(run.year).toBe(1000);
    sameBytes(run.finish(), generateCiv(w, { endYear: 1000 }), '第 0 年、最后一年');
    expect(() => run.finish()).toThrow();
    expect(() => run.advance(1000)).toThrow();
    sameBytes(stepped(w, { endYear: 0 }, [0]), generateCiv(w, { endYear: 0 }), '推到第 0 年');
    // 一次都不停:推到底
    sameBytes(startCiv(w, { endYear: 700 }).finish(), generateCiv(w, { endYear: 700 }), '不停');
  }, 60_000);

  it('带作者干预:随机挑的时刻停,干预前后、生效那一刻都停', () => {
    const w = worldOf(2024);
    const base = generateCiv(w, { endYear: 1500 });
    const [a, b] = twoAlive(base, 1200);
    const interventions: Intervention[] = [
      { kind: 'declare', a: polityKey(base, a), b: polityKey(base, b), from: 1250 },
      { kind: 'protect', a: polityKey(base, a), from: 1250, until: 1800 },
    ];
    const stops = [...randomStops(11, 2200, 6), 1249, 1250 - 1 / 256, 1250, 1250 + 1 / 256, 1251].sort((x, y) => x - y);
    sameBytes(stepped(w, { interventions, endYear: 2200 }, stops), generateCiv(w, { interventions, endYear: 2200 }), '带干预');
  }, 120_000);

  it('地形大事前后停:大事前一年、前一刻、前半刻、那一刻、后一刻、后一年,两件大事各一遍', () => {
    const w = worldOf(7);
    const FLOOD: Upheaval = { year: 1600, ops: [{ kind: 'sink', pts: [1850, 520, 1930, 530, 1903, 469], r: 40, s: 1.1 }] };
    const VOLCANO: Upheaval = { year: 1800, ops: [{ kind: 'volcano', pts: [1169, 764], r: 36, s: 1.1 }] };
    const upheavals: UpheavalStep[] = upheavalSteps({ ...PARAMS, seed: 7 }, [], null, [FLOOD, VOLCANO]);
    const one = generateCiv(w, { upheavals, calamity: 'many' });
    expect(one.upheavals?.map((u) => u.year)).toEqual([1600, 1800]);
    const around = (y: number) => [y - 1, y - 1 / 256, y - 0.5 / 256, y, y + 1 / 256, y + 1];
    const stops = [...randomStops(7, 3000, 4), ...around(1600), ...around(1800)].sort((x, y) => x - y);
    sameBytes(stepped(w, { upheavals, calamity: 'many' }, stops), one, '地形大事前后');
    // 跨过两件大事才停一次
    sameBytes(stepped(w, { upheavals, calamity: 'many' }, [1500, 2500]), one, '一步跨过两件大事');
  }, 180_000);
});

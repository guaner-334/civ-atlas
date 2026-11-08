/**
 * 推演插件接口第 1 版(gen/civ/simApi.ts):能力名和影响口、命令的名字定下来;只照接口写的两个插件(tests/lib/simV1Plugins.ts)
 * 种子 7、2024 默认参数推 3000 年推得完、历史看得出效果,结果钉住。
 * 改了官方推演(同一种子的历史变了)这里的钉子跟着变:PRINT_PINS=1 跑一遍,照打出来的换掉 PINS
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startContinue, type Civ } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { CAP_NAME, PLUGIN_CAPS } from '../src/plugin/pluginCaps';
import { PLUGIN_ROLES } from '../src/plugin/pluginFile';
import { COMMAND_KINDS, INFLUENCE_NAMES, OFFICIAL_INFLUENCES, SIM_CAPS, type InfluenceName, type SimCommand } from '../src/gen/civ/simApi';
import { courtRulesAt } from '../src/gen/civ/council';
import { dynastyIndexAt } from '../src/gen/civ/polityRoot';
import { segRegime } from '../src/gen/civ/regime';
import { faithRoot, stateFaithAt } from '../src/gen/civ/religion';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { WEARY, faithEffect, parliamentary, weariness } from './lib/simV1Plugins';

const SEEDS = [7, 2024] as const;
type Seed = (typeof SEEDS)[number];

const worlds = new Map<number, World>();
const worldOf = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};
const bases = new Map<number, Civ>();
const baseOf = (seed: number) => {
  let c = bases.get(seed);
  if (!c) bases.set(seed, (c = generateCiv(worldOf(seed))));
  return c;
};

/** 推出来的历史的指纹:史事、归属、干预、插件写的编年史和状态 */
function digest(civ: Civ): string {
  const x = packValue({ annals: civ.annals, polity: civ.polity, culture: civ.culture, interventions: civ.interventions ?? [], chronicle: civ.simChronicle ?? [], plugins: civ.simPlugins ?? [] });
  return createHash('sha256').update(x).digest('hex').slice(0, 16);
}

const by = (civ: Civ, id: string) => (civ.interventions ?? []).filter((v) => v.plugin === id);

/** 议事的国(宣战那年)开的仗:几场、平均打几年、打满 WEARY.years 年的几场(打自己分出去的国不算) */
function deliberated(civ: Civ) {
  const ends = new Map<number, number>();
  for (const e of civ.annals) if ((e.kind === 'peace' || e.kind === 'fall') && e.war >= 0 && !ends.has(e.war)) ends.set(e.war, e.year);
  let wars = 0;
  let years = 0;
  let long = 0;
  for (const e of civ.annals) {
    if (e.kind !== 'war' || civ.polities[e.b]?.parent === e.a) continue;
    const P = civ.polities[e.a];
    if (!parliamentary({ regime: segRegime(P, dynastyIndexAt(P, e.year)), charter: courtRulesAt(civ, e.a, e.year).charter })) continue;
    const d = (ends.get(e.war) ?? civ.endYear) - e.year;
    wars++;
    years += d;
    if (d >= WEARY.years) long++;
  }
  return { wars, meanYears: Math.round((years / Math.max(1, wars)) * 100) / 100, long };
}

/** 两边都有国教的宣战(内战不算)里异教的几场,两边都有国教的结盟(下令结的也算)里同教的几回 */
function faithMix(civ: Civ) {
  const rel = civ.religion;
  const gap = (a: number, b: number, y: number) => {
    const fa = stateFaithAt(rel, a, y)?.faith;
    const fb = stateFaithAt(rel, b, y)?.faith;
    if (fa === undefined || fb === undefined) return -1;
    return fa === fb ? 0 : faithRoot(rel!, fa) === faithRoot(rel!, fb) ? 0.5 : 1;
  };
  const civil = new Set(['quell', 'heir', 'warlord', 'punish']);
  const out = { wars: 0, farWars: 0, pacts: 0, samePacts: 0 };
  for (const e of civ.annals) {
    if (e.kind === 'war' && !(e.cause && civil.has(e.cause))) {
      const g = gap(e.a, e.b, e.year);
      if (g < 0) continue;
      out.wars++;
      if (g === 1) out.farWars++;
    } else if (e.kind === 'alliance' || (e.kind === 'intervene' && civ.interventions?.[e.war]?.kind === 'ally' && e.b >= 0)) {
      const g = gap(e.a, e.b, e.year);
      if (g < 0) continue;
      out.pacts++;
      if (g === 0) out.samePacts++;
    }
  }
  return out;
}

const PINS: Record<Seed, { weariness: unknown; faith: unknown }> = {
  7: {
    weariness: { before: { wars: 90, meanYears: 7.25, long: 28 }, after: { wars: 39, meanYears: 3.96, long: 3 }, treaties: 23, digest: '57d64d61ff100c94' },
    faith: { before: { wars: 100, farWars: 27, pacts: 3, samePacts: 0 }, after: { wars: 109, farWars: 47, pacts: 8, samePacts: 4 }, declare: 0, ally: 2, digest: '576a425e9055be22' },
  },
  2024: {
    weariness: { before: { wars: 8, meanYears: 4.22, long: 0 }, after: { wars: 7, meanYears: 2.8, long: 0 }, treaties: 3, digest: 'c9bfc1aa61958641' },
    faith: { before: { wars: 94, farWars: 17, pacts: 1, samePacts: 0 }, after: { wars: 148, farWars: 82, pacts: 13, samePacts: 8 }, declare: 2, ally: 8, digest: '724181989f1f7336' },
  },
};

function pin(seed: Seed, which: 'weariness' | 'faith', got: unknown) {
  if (process.env.PRINT_PINS) console.log(`${seed} ${which}: ${JSON.stringify(got)}`);
  expect(got).toEqual(PINS[seed][which]);
}

describe('接口第 1 版:名字定下来', () => {
  it('七样 sim.*@1 能力合规矩;网站认推演插件(清单 role 认 sim)时都进 PLUGIN_CAPS,会改推演怎么走的两样归权限框上显眼的那一行', () => {
    const caps = Object.keys(SIM_CAPS);
    expect(caps.sort()).toEqual(['sim.chronicle@1', 'sim.commands@1', 'sim.events@1', 'sim.influence@1', 'sim.read@1', 'sim.state@1', 'sim.tables@1']);
    for (const c of caps) expect(CAP_NAME.test(c), c).toBe(true);
    const runnable = PLUGIN_ROLES.includes('sim');
    for (const c of caps) expect(PLUGIN_CAPS.has(c), `${c} 和 role sim 一起开`).toBe(runnable);
    expect(Object.entries(SIM_CAPS).filter(([, v]) => v.steer).map(([k]) => k).sort()).toEqual(['sim.commands@1', 'sim.influence@1']);
    if (runnable) for (const [c, v] of Object.entries(SIM_CAPS)) expect(PLUGIN_CAPS.get(c), c).toBe(v.steer ? 'simSteer' : 'sim');
    expect([...PLUGIN_CAPS.keys()].filter((c) => c.startsWith('sim.')).sort()).toEqual(runnable ? caps.sort() : []);
  });

  it('影响口的名字和官方登记的一样;命令的种类和收命令的那一口一样', () => {
    expect([...INFLUENCE_NAMES].sort()).toEqual(OFFICIAL_INFLUENCES.map((p) => p.id).sort());
    const names: Record<InfluenceName, true> = {
      'city.capacity': true,
      'rural.capacity': true,
      'unrest.add': true,
      'dev.rate': true,
      'assim.rate': true,
      'control.reach': true,
      'war.odds': true,
      'war.power': true,
      'split.odds': true,
      'dynasty.odds': true,
      'plague.odds': true,
      'plague.loss': true,
    };
    expect(Object.keys(names).sort()).toEqual([...INFLUENCE_NAMES].sort());
    const kinds: Record<SimCommand['kind'], true> = { declare: true, ally: true, treaty: true, cede: true, found: true, move: true, destroy: true, disaster: true, trek: true };
    expect(Object.keys(kinds).sort()).toEqual([...COMMAND_KINDS].sort());
  });
});

describe('试金石:厌战(议事的国开战先过议会、久战不决就罢兵)', () => {
  it.each(SEEDS)('seed %i 推 3000 年:议事的国开的仗少了、打得短了,久战不决的遣使议和;结果钉住', (seed) => {
    const base = baseOf(seed);
    const civ = generateCiv(worldOf(seed), { plugins: [weariness()] });
    expect(civ.stuck).toBeUndefined();
    expect(civ.endYear).toBe(3000);
    const before = deliberated(base);
    const after = deliberated(civ);
    expect(after.wars).toBeLessThan(before.wars);
    expect(after.meanYears).toBeLessThan(before.meanYears);
    expect(after.long).toBeLessThanOrEqual(before.long);
    const asked = by(civ, 'weariness');
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((v) => v.kind === 'treaty')).toBe(true);
    expect(civ.simChronicle!.length).toBe(asked.length);
    expect(civ.simChronicle!.every((l) => l.text.includes('议和'))).toBe(true);
    pin(seed, 'weariness', { before, after, treaties: asked.length, digest: digest(civ) });
  }, 120_000);
});

describe('试金石:宗教生效(异教难治、难融合;圣城在异教国手里就兴兵;同教联手拒强邻)', () => {
  it.each(SEEDS)('seed %i 推 3000 年:异教之间的仗多了,同教结盟多了;结果钉住', (seed) => {
    const base = baseOf(seed);
    const civ = generateCiv(worldOf(seed), { plugins: [faithEffect()] });
    expect(civ.stuck).toBeUndefined();
    expect(civ.endYear).toBe(3000);
    const before = faithMix(base);
    const after = faithMix(civ);
    expect(after.farWars / after.wars).toBeGreaterThan(before.farWars / before.wars);
    expect(after.samePacts).toBeGreaterThan(before.samePacts);
    const cmds = by(civ, 'faith');
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds.every((v) => v.kind === 'declare' || v.kind === 'ally')).toBe(true);
    expect(civ.simChronicle!.length).toBe(cmds.length);
    pin(seed, 'faith', { before, after, declare: cmds.filter((v) => v.kind === 'declare').length, ally: cmds.filter((v) => v.kind === 'ally').length, digest: digest(civ) });
  }, 120_000);
});

describe('两个插件一起装', () => {
  it('推到 1500 年存下、读回来接着推到 3000 年,和一口气推完一样(都往 war.odds 交数,乘在一起)', () => {
    const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 2024 });
    const plugins = [weariness(), faithEffect()];
    const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;
    const one = roundTrip(generateCiv(w, { plugins }));
    expect(by(one, 'weariness').length + by(one, 'faith').length).toBeGreaterThan(0);
    const run = startContinue(w, roundTrip(generateCiv(w, { plugins, endYear: 1500 })), { plugins });
    expect(run).not.toBeNull();
    const rest = roundTrip(run!.finish());
    expect(civDiff(rest, one)).toBeNull();
    expect(digest(rest)).toBe(digest(one));
  }, 120_000);
});

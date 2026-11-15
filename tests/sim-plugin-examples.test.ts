/**
 * 推演插件的示例(examples/plugins/ 里 role 是 sim 的):从插件文件照推演线程的装法关进 QuickJS,种子 7、2024 各推 3000 年。
 * 厌战、宗教生效是照接口写的那两个(tests/lib/simV1Plugins.ts)搬成插件包,历史的指纹和直接跑钉的一样;魔力、国力与疆域、灾异、乱世、民生与时代钉自己的。
 * 清单要的能力都用得到;编辑器用的类型(examples/plugins/civ-atlas-sim.d.ts)和接口一样。
 * 改了官方推演,魔力、国力与疆域、灾异、乱世、民生与时代的钉子跟着变:PRINT_PINS=1 跑一遍,照打出来的换掉 MAGIC_PINS、REALM_PINS、OMEN_PINS、CHAOS_PINS、LIVELIHOOD_PINS
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startContinue, type Civ } from '../src/gen/civ';
import { populationAt, regionPopulationAt } from '../src/gen/civ/growth';
import { RESOURCES, RESOURCE_COUNT, developmentAt, eraLevel, resourcesAt } from '../src/gen/civ/development';
import type { PluginReply, PluginTurn, SimPlugin } from '../src/gen/civ/engine/plugin';
import type { InfluenceName, OfficialName, SimCommand, SimRead } from '../src/gen/civ/simApi';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { polityKey } from '../src/gen/edits';
import { PLUGIN_FILE_EXT, type OpenedPlugin } from '../src/plugin/pluginFile';
import { simCapsUnused } from '../src/plugin/pluginSim';
import type { SimPluginFile } from '../src/plugin/pluginWorld';
import { civDiff } from '../scripts/lib/resumeFuzz';
import { openSimPlugin, simPluginsInNode } from '../scripts/lib/simPluginFile';
import { V1_PINS, V1_SEEDS, simDigest, type V1Seed } from './lib/simV1Pins';
import type * as Dts from '../examples/plugins/civ-atlas-sim';

const ROOT = fileURLToPath(new URL('../examples/plugins/', import.meta.url));
const SIM_EXAMPLES = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && JSON.parse(readFileSync(join(ROOT, d.name, 'plugin.json'), 'utf8')).role === 'sim')
  .map((d) => d.name)
  .sort();

type Example = { opened: OpenedPlugin; file: SimPluginFile };
const examples = new Map<string, Promise<Example>>();
const open = (name: string) => {
  let p = examples.get(name);
  if (!p) examples.set(name, (p = openSimPlugin(join(ROOT, name, `${name}${PLUGIN_FILE_EXT}`))));
  return p;
};
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

/** 回话里交过什么、读过哪几样 */
interface Seen {
  acts: number;
  reply: Set<keyof PluginReply>;
  turn: Set<string>;
}

/** 插件文件照推演线程的装法推一段;每次出手记下回话交了哪几样 */
async function run(x: Example, seed: number, go: (plugins: SimPlugin<SimRead>[]) => Civ, params?: Record<string, number>): Promise<{ civ: Civ; seen: Seen }> {
  const on = await simPluginsInNode([{ ...x.file, ...(params ? { params } : {}) }], seed);
  const q = on.plugins[0];
  const seen: Seen = { acts: 0, reply: new Set(), turn: new Set() };
  try {
    const spy: SimPlugin<SimRead> = {
      ...q,
      act(turn: PluginTurn<SimRead>) {
        seen.acts++;
        if (turn.events.length) seen.turn.add('events');
        const r = q.act(turn) as PluginReply | undefined;
        for (const k of Object.keys(r ?? {}) as (keyof PluginReply)[]) seen.reply.add(k);
        return r;
      },
    };
    return { civ: go([spy]), seen };
  } finally {
    on.dispose();
  }
}

/** 清单要的能力:sim 段、代码、回话里看得出用到的 */
function capsUsed({ opened: p }: Example, seen: Seen): string[] {
  const s = p.manifest.sim!;
  const used = new Set<string>();
  if (s.listen?.length || /\bturn\.(read|heard)\b/.test(p.code)) used.add('sim.read@1');
  if (s.tables?.length || /\bturn\.table\(/.test(p.code) || seen.reply.has('tables')) used.add('sim.tables@1');
  if (s.every !== undefined || seen.reply.has('at') || seen.turn.has('events')) used.add('sim.events@1');
  if (seen.reply.has('chronicle')) used.add('sim.chronicle@1');
  if (/\bturn\.note\b/.test(p.code) || seen.reply.has('note')) used.add('sim.state@1');
  if (s.influences?.length || seen.reply.has('influences')) used.add('sim.influence@1');
  if (s.commands?.length || seen.reply.has('commands')) used.add('sim.commands@1');
  return [...used].sort();
}

const by = (civ: Civ, id: string) => (civ.interventions ?? []).filter((v) => v.plugin === id);

describe('推演插件的示例', () => {
  it('七个都在:厌战、宗教生效、魔力、国力与疆域、灾异、乱世、民生与时代', () => {
    expect(SIM_EXAMPLES).toEqual(['chaos', 'faith', 'livelihood', 'magic', 'omens', 'realm', 'weariness']);
  });

  it.each(SIM_EXAMPLES)('%s:清单是推演插件、跑法 quickjs;要的能力都用得到(sim 段看得出的也没多要)', async (name) => {
    const { opened } = await open(name);
    expect(opened.manifest).toMatchObject({ role: 'sim', runtime: 'quickjs', api: 1 });
    expect(simCapsUnused(opened.manifest)).toEqual([]);
  });
});

describe.each(['weariness', 'faith'] as const)('%s:打成插件包经 QuickJS,和直接跑钉的一样', (name) => {
  it.each(V1_SEEDS)('seed %i 推 3000 年:历史的指纹和接口第 1 版钉的一样;要的能力都用到了', async (seed) => {
    const p = await open(name);
    const { civ, seen } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins }));
    expect(civ.stuck).toBeUndefined();
    expect(civ.endYear).toBe(3000);
    expect(by(civ, name).length).toBeGreaterThan(0);
    expect(simDigest(civ)).toBe(V1_PINS[seed as V1Seed][name].digest);
    expect(capsUsed(p, seen)).toEqual([...p.opened.manifest.requires].sort());
  }, 120_000);
});

/** 3000 年还在的城的平均人口(千人):全部,和魔力 ≥ 20 的州里的(州按带魔力那一遍的最后一份图层分) */
function towns(civ: Civ, magic: Float32Array) {
  let all = 0;
  let n = 0;
  let rich = 0;
  let m = 0;
  for (const s of civ.settlements) {
    if (s.ended !== undefined && s.ended <= civ.endYear) continue;
    const pop = populationAt(s, civ.endYear);
    all += pop;
    n++;
    if (magic[s.region] >= 20) (rich += pop), m++;
  }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { towns: n, mean: r1(all / n), richTowns: m, richMean: r1(rich / Math.max(1, m)) };
}

/** 图层第 k 份:各州平均、最浓 */
function frameStat(civ: Civ, year: number) {
  const L = civ.simLayers!.find((l) => l.by === 'magic' && l.id === 'magic')!;
  const n = L.values.length / L.years.length;
  const k = L.years.indexOf(year);
  const f = L.values.subarray(k * n, (k + 1) * n);
  let sum = 0;
  let max = 0;
  for (const v of f) (sum += v), (max = Math.max(max, v));
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return { mean: r2(sum / n), max: r2(max) };
}

const lastFrame = (civ: Civ) => {
  const L = civ.simLayers![0];
  const n = L.values.length / L.years.length;
  return L.values.subarray(L.values.length - n);
};

const MAGIC_PINS: Record<V1Seed, unknown> = {
  7: {
    layer: { y100: { mean: 5.02, max: 39.56 }, y500: { mean: 12.64, max: 48.17 }, y1500: { mean: 10.61, max: 46.89 }, y3000: { mean: 6.92, max: 42.78 } },
    before: { towns: 726, mean: 27, richTowns: 32, richMean: 20.7 },
    after: { towns: 734, mean: 29, richTowns: 36, richMean: 29.8 },
    digest: '890f7572bd948999',
  },
  2024: {
    layer: { y100: { mean: 4.6, max: 38.54 }, y500: { mean: 11.94, max: 49.52 }, y1500: { mean: 9.56, max: 47.72 }, y3000: { mean: 6.04, max: 43 } },
    before: { towns: 810, mean: 25.4, richTowns: 39, richMean: 28 },
    after: { towns: 782, mean: 27, richTowns: 35, richMean: 39 },
    digest: 'ac5ab24ee3baa5ab',
  },
};

describe('魔力:自己的表、图层、滑条', () => {
  it.each(V1_SEEDS)('seed %i 推 3000 年:魔力从灵脉漫开又被人耗掉,图层每 50 年一份;魔力浓的州城大了;结果钉住', async (seed) => {
    const p = await open('magic');
    const { civ, seen } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins }));
    expect(civ.stuck).toBeUndefined();
    expect(civ.endYear).toBe(3000);
    expect(capsUsed(p, seen)).toEqual([...p.opened.manifest.requires].sort());
    expect(civ.simLayers).toHaveLength(1);
    const L = civ.simLayers![0];
    expect(L).toMatchObject({ by: 'magic', id: 'magic', title: '魔力浓度', unit: 'region' });
    expect(L.years).toEqual(Array.from({ length: 61 }, (_, k) => k * 50));
    const layer = { y100: frameStat(civ, 100), y500: frameStat(civ, 500), y1500: frameStat(civ, 1500), y3000: frameStat(civ, 3000) };
    // 先漫开、后被人耗掉
    expect(layer.y500.mean).toBeGreaterThan(layer.y100.mean);
    expect(layer.y3000.mean).toBeLessThan(layer.y500.mean);
    const magic = lastFrame(civ);
    const before = towns(baseOf(seed), magic);
    const after = towns(civ, magic);
    expect(after.richMean).toBeGreaterThan(before.richMean);
    const got = { layer, before, after, digest: simDigest(civ) };
    if (process.env.PRINT_PINS) console.log(`magic ${seed}: ${JSON.stringify(got)}`);
    expect(got).toEqual(MAGIC_PINS[seed as V1Seed]);
  }, 120_000);

  it('滑条拨到 0:魔力照样涨落、存成图层,官方的历史和没装一样', async () => {
    const seed = 7;
    const p = await open('magic');
    const { civ } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins }), { strength: 0 });
    const base = baseOf(seed);
    expect(civ.simLayers![0].years).toHaveLength(61);
    expect(frameStat(civ, 3000).max).toBeGreaterThan(20);
    expect(packValue({ annals: civ.annals, polity: civ.polity, culture: civ.culture })).toEqual(packValue({ annals: base.annals, polity: base.polity, culture: base.culture }));
  }, 120_000);

  it('推到 1500 年存下、读回来接着推(接着推那段换新的 QuickJS),和一口气推完一样:表、图层接得上', async () => {
    const seed = 2024;
    const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
    const p = await open('magic');
    const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;
    const one = roundTrip((await run(p, seed, (plugins) => generateCiv(w, { plugins }))).civ);
    const half = roundTrip((await run(p, seed, (plugins) => generateCiv(w, { plugins, endYear: 1500 }))).civ);
    const rest = roundTrip(
      (
        await run(p, seed, (plugins) => {
          const r = startContinue(w, half, { plugins });
          expect(r).not.toBeNull();
          return r!.finish();
        })
      ).civ,
    );
    expect(one.simLayers![0].years).toHaveLength(61);
    expect(civDiff(rest, one)).toBeNull();
  }, 120_000);
});

/** 套在插件外面:每次出手交回的回话给 look 看一眼 */
const peek =
  (look: (turn: PluginTurn<SimRead>, reply: PluginReply | undefined) => void) =>
  (q: SimPlugin<SimRead>): SimPlugin<SimRead> => ({
    ...q,
    act(turn: PluginTurn<SimRead>) {
      const r = q.act(turn) as PluginReply | undefined;
      look(turn, r);
      return r;
    },
  });

/** 3000 年里的国家数、战争、分裂(含复国)、迁都 */
function realmStat(civ: Civ) {
  const n = (kind: string) => civ.annals.filter((e) => e.kind === kind).length;
  return { polities: civ.polities.length, wars: n('war'), splits: n('split'), capitals: n('capital') };
}

const REALM_PINS: Record<V1Seed, unknown> = {
  7: { hurt: 61, cede: 27, move: 117, before: { polities: 123, wars: 246, splits: 45, capitals: 27 }, after: { polities: 128, wars: 253, splits: 46, capitals: 132 }, digest: '7905f152acdc9e48' },
  2024: { hurt: 147, cede: 36, move: 64, before: { polities: 151, wars: 186, splits: 58, capitals: 21 }, after: { polities: 169, wars: 278, splits: 68, capitals: 98 }, digest: '8a3b2fd0cc3ff15d' },
};

describe('国力与疆域:六个滑条交五个影响口,下划州、迁都', () => {
  it.each(V1_SEEDS)('seed %i 推 3000 年:有国亏空伤国,划了州、迁了都;结果钉住', async (seed) => {
    const p = await open('realm');
    let hurt = 0;
    const look = peek((_turn, r) => {
      const split = r?.influences?.['split.odds'];
      if (split) for (let i = 0; i < split.length; i++) if (split[i] > 1) hurt++;
    });
    const { civ, seen } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins: plugins.map(look) }));
    expect(civ.stuck).toBeUndefined();
    expect(civ.endYear).toBe(3000);
    expect(capsUsed(p, seen)).toEqual([...p.opened.manifest.requires].sort());
    const done = by(civ, 'realm');
    const cede = done.filter((v) => v.kind === 'cede').length;
    const move = done.filter((v) => v.kind === 'move').length;
    expect(hurt).toBeGreaterThan(0);
    expect(cede).toBeGreaterThan(0);
    expect(move).toBeGreaterThan(0);
    const got = { hurt, cede, move, before: realmStat(baseOf(seed)), after: realmStat(civ), digest: simDigest(civ) };
    if (process.env.PRINT_PINS) console.log(`realm ${seed}: ${JSON.stringify(got)}`);
    expect(got).toEqual(REALM_PINS[seed as V1Seed]);
  }, 120_000);

  it.each(V1_SEEDS)('seed %i 六个滑条都拨到 0:官方的历史和没装一样', async (seed) => {
    const p = await open('realm');
    const zero = { deficit: 0, levy: 0, terrain: 0, early: 0, tidy: 0, nomad: 0 };
    const { civ } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins }), zero);
    const base = baseOf(seed);
    expect(civ.stuck).toBeUndefined();
    expect(by(civ, 'realm')).toEqual([]);
    const history = (c: Civ) => packValue({ annals: c.annals, polity: c.polity, culture: c.culture, settlements: c.settlements });
    expect(history(civ)).toEqual(history(base));
  }, 120_000);

  it('存下再接着推(接着推那段换新的 QuickJS),和一口气推完一样:停在第 1500 年、停在有国连着亏了 20–50 年的时候', async () => {
    const seed = 2024;
    const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
    const p = await open('realm');
    const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;
    let mid = -1;
    const look = peek((turn, r) => {
      const broke = (r?.note as { broke?: Record<string, number> } | undefined)?.broke;
      if (mid < 0 && turn.year >= 300 && broke && Object.values(broke).some((y) => y >= 20 && y < 50)) mid = turn.year;
    });
    const one = roundTrip((await run(p, seed, (plugins) => generateCiv(w, { plugins: plugins.map(look) }))).civ);
    expect(mid).toBeGreaterThan(0);
    for (const stop of [1500, mid + 2]) {
      const half = roundTrip((await run(p, seed, (plugins) => generateCiv(w, { plugins, endYear: stop }))).civ);
      const rest = roundTrip(
        (
          await run(p, seed, (plugins) => {
            const r = startContinue(w, half, { plugins });
            expect(r).not.toBeNull();
            return r!.finish();
          })
        ).civ,
      );
      expect(civDiff(rest, one), `停在第 ${stop} 年`).toBeNull();
    }
    if (process.env.PRINT_PINS) console.log(`realm 接着推:停在第 1500 年、第 ${mid + 2} 年`);
  }, 240_000);
});


/** 灾异写的编年史按哪一样分开数 */
const OMEN_LINES = { 潮灾: '大潮', 入冷: '转寒', 出冷: '回暖', 天变: '天象', 灾后疫: '又起疫病', 经济危机: '市面崩坏', 技术失控: '失控' } as const;
function omenLines(civ: Civ) {
  const n = Object.fromEntries(Object.keys(OMEN_LINES).map((k) => [k, 0])) as Record<keyof typeof OMEN_LINES, number>;
  for (const l of civ.simChronicle ?? []) {
    const k = (Object.keys(OMEN_LINES) as (keyof typeof OMEN_LINES)[]).find((x) => l.text.includes(OMEN_LINES[x]));
    if (k) n[k]++;
  }
  return n;
}
const yearsOf = (civ: Civ, word: string) => (civ.simChronicle ?? []).filter((l) => l.text.includes(word)).map((l) => l.year);
const OMENS_OFF = { aftermath: 0, modern: 0, cosmic: 0, climate: 0, tide: 0 };

const OMEN_PINS: Record<V1Seed, unknown> = {
  7: {
    lines: { 潮灾: 154, 入冷: 6, 出冷: 5, 天变: 0, 灾后疫: 0, 经济危机: 0, 技术失控: 0 },
    cold: [459, 1016, 1412, 1788, 2341, 2936],
    plagues: { before: 98, after: 87 },
    commands: 0,
    digest: '3ac2c34f41f61f1c',
  },
  2024: {
    lines: { 潮灾: 132, 入冷: 6, 出冷: 6, 天变: 1, 灾后疫: 3, 经济危机: 0, 技术失控: 0 },
    cold: [408, 761, 1140, 1606, 2059, 2544],
    plagues: { before: 81, after: 107 },
    commands: 4,
    digest: '8b228650c55067af',
  },
};

describe('灾异:听史事、约事、五个影响口、天灾命令、滑条', () => {
  it.each(V1_SEEDS)('seed %i 推 3000 年:大潮、冷期都来过,冷期一段 100–200 年;结果钉住', async (seed) => {
    const p = await open('omens');
    const { civ, seen } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins }));
    expect(civ.stuck).toBeUndefined();
    expect(civ.endYear).toBe(3000);
    expect(capsUsed(p, seen)).toEqual([...p.opened.manifest.requires].sort());
    const lines = omenLines(civ);
    expect(lines.潮灾).toBeGreaterThan(0);
    const cold = yearsOf(civ, OMEN_LINES.入冷);
    const warm = yearsOf(civ, OMEN_LINES.出冷);
    expect(cold.length).toBeGreaterThan(0);
    for (let i = 0; i < warm.length; i++) expect(warm[i] - cold[i]).toBeGreaterThanOrEqual(100), expect(warm[i] - cold[i]).toBeLessThan(200);
    const plagues = (c: Civ) => c.annals.filter((e) => e.kind === 'plague').length;
    const got = { lines, cold, plagues: { before: plagues(baseOf(seed)), after: plagues(civ) }, commands: by(civ, 'omens').length, digest: simDigest(civ) };
    if (process.env.PRINT_PINS) console.log(`omens ${seed}: ${JSON.stringify(got)}`);
    expect(got).toEqual(OMEN_PINS[seed as V1Seed]);
  }, 120_000);

  it('滑条全拨到 0:什么都不交、不写,历史和没装一样', async () => {
    const seed = 7;
    const p = await open('omens');
    const { civ, seen } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins }), OMENS_OFF);
    const base = baseOf(seed);
    expect([...seen.reply]).toEqual([]);
    expect(civ.simChronicle ?? []).toEqual([]);
    expect(packValue({ annals: civ.annals, polity: civ.polity, culture: civ.culture })).toEqual(packValue({ annals: base.annals, polity: base.polity, culture: base.culture }));
  }, 120_000);

  it('后世之灾:推一把发展进了工业、信息时代的国,会有经济危机、技术失控', async () => {
    const seed = 7;
    const base = baseOf(seed);
    const old = base.polities.filter((q) => q.founded <= 500 && (q.ended === undefined || q.ended > 1200)).sort((a, b) => a.founded - b.founded || a.id - b.id)[0];
    const a = polityKey(base, old.id);
    const interventions = Array.from({ length: 8 }, (_, i) => ({ kind: 'boost' as const, a, from: 600 + 5 * i }));
    const p = await open('omens');
    const { civ } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins, interventions, endYear: 1200 }), { ...OMENS_OFF, modern: 3 });
    expect(civ.stuck).toBeUndefined();
    const lines = omenLines(civ);
    expect(lines.经济危机).toBeGreaterThan(0);
    expect(lines.技术失控).toBeGreaterThan(0);
    expect(lines.经济危机 + lines.技术失控).toBe((civ.simChronicle ?? []).length);
  }, 120_000);

  it('推到 1500 年、推到冷期中间存下,读回来接着推(换新的 QuickJS),和一口气推完一样', async () => {
    const seed = 2024;
    const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
    const p = await open('omens');
    const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;
    const one = roundTrip((await run(p, seed, (plugins) => generateCiv(w, { plugins }))).civ);
    const cold = yearsOf(one, OMEN_LINES.入冷).find((y) => y > 1500)!;
    const warm = yearsOf(one, OMEN_LINES.出冷).find((y) => y > cold)!;
    for (const cut of [1500, Math.round((cold + warm) / 2)]) {
      const half = roundTrip((await run(p, seed, (plugins) => generateCiv(w, { plugins, endYear: cut }))).civ);
      if (cut !== 1500) expect(half.simPlugins!.find((s) => s.id === 'omens')!.note).toMatchObject({ cold: 1 });
      const rest = roundTrip(
        (
          await run(p, seed, (plugins) => {
            const r = startContinue(w, half, { plugins });
            expect(r).not.toBeNull();
            return r!.finish();
          })
        ).civ,
      );
      expect(civDiff(rest, one)).toBeNull();
    }
  }, 120_000);
});

/** 和不装比:国家数、战争、分裂、复国,末年的人口(万人,城加乡村) */
function chaosStats(civ: Civ) {
  const count = (kind: string) => civ.annals.filter((e) => e.kind === kind).length;
  let pop = 0;
  for (const s of civ.settlements) if (s.ended === undefined || s.ended > civ.endYear) pop += populationAt(s, civ.endYear);
  const rural = civ.development?.rural;
  for (const v of rural?.[rural.length - 1] ?? []) pop += v;
  return { polities: civ.polities.length, wars: count('war'), splits: count('split'), restored: civ.polities.filter((p) => p.restores !== undefined).length, pop: Math.round(pop / 10) };
}

/** 编年史里乱世各件事写了几句 */
function chaosLines(civ: Civ) {
  const lines = (civ.simChronicle ?? []).filter((l) => l.by === 'chaos');
  const n = (word: string) => lines.filter((l) => l.text.includes(word)).length;
  return { shatter: n('崩解之际'), rise: n('拥兵自立'), loyal: n('勤王'), revive: n('据地立'), distant: n('远交'), all: lines.length };
}

const CHAOS_PINS: Record<V1Seed, unknown> = {
  7: {
    before: { polities: 123, wars: 246, splits: 45, restored: 24, pop: 27739 },
    after: { polities: 203, wars: 407, splits: 53, restored: 31, pop: 27665 },
    commands: { found: 92, ally: 90, declare: 15 },
    lines: { shatter: 5, rise: 25, loyal: 6, revive: 25, distant: 88, all: 149 },
    digest: 'ff2775a7787d7fef',
  },
  2024: {
    before: { polities: 151, wars: 186, splits: 58, restored: 35, pop: 28185 },
    after: { polities: 214, wars: 360, splits: 60, restored: 29, pop: 28097 },
    commands: { found: 79, ally: 139, declare: 8 },
    lines: { shatter: 2, rise: 25, loyal: 5, revive: 23, distant: 135, all: 190 },
    digest: 'ee5e93e3a461569e',
  },
};

describe('乱世:听史事、约事、立国、宣战、结盟', () => {
  it.each(V1_SEEDS)('seed %i 推 3000 年:崩解、改朝换代时有州自立、互相宣战,无主的富州立国,远交结盟;国家比不装多;结果钉住', async (seed) => {
    const p = await open('chaos');
    const { civ, seen } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins }));
    expect(civ.stuck).toBeUndefined();
    expect(civ.endYear).toBe(3000);
    expect(capsUsed(p, seen)).toEqual([...p.opened.manifest.requires].sort());
    const commands: Record<string, number> = {};
    for (const v of by(civ, 'chaos')) commands[v.kind] = (commands[v.kind] ?? 0) + 1;
    expect(Object.keys(commands).sort()).toEqual(['ally', 'declare', 'found']);
    const lines = chaosLines(civ);
    expect(lines.shatter).toBeGreaterThan(0);
    expect(lines.rise).toBeGreaterThan(0);
    expect(lines.revive).toBeGreaterThan(0);
    expect(lines.distant).toBeGreaterThan(0);
    const before = chaosStats(baseOf(seed));
    const after = chaosStats(civ);
    expect(after.polities).toBeGreaterThan(before.polities);
    const got = { before, after, commands, lines, digest: simDigest(civ) };
    if (process.env.PRINT_PINS) console.log(`chaos ${seed}: ${JSON.stringify(got)}`);
    expect(got).toEqual(CHAOS_PINS[seed as V1Seed]);
  }, 120_000);

  it('滑条全拨到 0:一条命令都不下、编年史不写,历史和没装一样', async () => {
    const seed = 7;
    const p = await open('chaos');
    const { civ } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins }), { shatter: 0, rise: 0, revive: 0, distant: 0 });
    const base = baseOf(seed);
    expect(by(civ, 'chaos')).toEqual([]);
    expect(civ.simChronicle ?? []).toEqual([]);
    expect(packValue({ annals: civ.annals, polity: civ.polity, culture: civ.culture })).toEqual(packValue({ annals: base.annals, polity: base.polity, culture: base.culture }));
  }, 120_000);

  it('存下读回来接着推(接着推那段换新的 QuickJS),和一口气推完一样:第 1500 年,和崩成几家约好的宣战还没到的那年', async () => {
    const seed = 2024;
    const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
    const p = await open('chaos');
    const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;
    const one = roundTrip((await run(p, seed, (plugins) => generateCiv(w, { plugins }))).civ);
    // 崩成几家:下令立国那一年约好半年后认出新国、宣战,到时编年史记「崩解之际」
    const fight = (one.simChronicle ?? []).find((l) => l.by === 'chaos' && l.text.includes('崩解之际'));
    expect(fight).toBeDefined();
    const ordered = fight!.year - 0.5;
    for (const stop of [1500, ordered]) {
      const half = roundTrip((await run(p, seed, (plugins) => generateCiv(w, { plugins, endYear: stop }))).civ);
      if (stop === ordered) expect(half.simPlugins![0].events.length).toBeGreaterThan(0);
      const rest = roundTrip(
        (
          await run(p, seed, (plugins) => {
            const r = startContinue(w, half, { plugins });
            expect(r).not.toBeNull();
            return r!.finish();
          })
        ).civ,
      );
      expect(civDiff(rest, one), `第 ${stop} 年存下`).toBeNull();
    }
  }, 240_000);
});

/** 各州的「食」= 粮 + 牲畜 / 2 + 渔获 / 2,按这份历史末年眼下能用的物产 */
function foodOf(civ: Civ): Float64Array {
  const res = resourcesAt(civ.development!, civ.endYear);
  const [g, l, f] = (['粮', '牲畜', '渔获'] as const).map((k) => RESOURCES.indexOf(k));
  const out = new Float64Array(civ.regions.count);
  for (let r = 0; r < out.length; r++) {
    const o = r * RESOURCE_COUNT;
    out[r] = res[o + g] + res[o + l] / 2 + res[o + f] / 2;
  }
  return out;
}

/** 末年的人口(千人):食少(< 1.5)、食多(≥ 3)的州各一共多少 */
function fed(civ: Civ, food: Float64Array) {
  let poor = 0;
  let rich = 0;
  for (let r = 0; r < food.length; r++) {
    const p = regionPopulationAt(civ, r, civ.endYear);
    if (food[r] < 1.5) poor += p;
    else if (food[r] >= 3) rich += p;
  }
  return { poor: Math.round(poor), rich: Math.round(rich) };
}

/** 记下插件每次交 dev.rate 时有几州被技术卡着(年 → 州数) */
const watchSlow =
  (slowed: Map<number, number>) =>
  (q: SimPlugin<SimRead>): SimPlugin<SimRead> => ({
    ...q,
    act(turn: PluginTurn<SimRead>) {
      const r = q.act(turn) as PluginReply | undefined;
      const rate = r?.influences?.['dev.rate'];
      if (rate) {
        let n = 0;
        for (let i = 0; i < rate.length; i += 5) if (rate[i] < 1) n++;
        slowed.set(turn.year, n);
      }
      return r;
    },
  });

const LIVELIHOOD_PINS: Record<V1Seed, unknown> = {
  7: { before: { poor: 30493, rich: 115331 }, after: { poor: 24673, rich: 156424 }, slow: { turns: 94, of: 151, most: 54 }, cedes: 0, digest: 'bd2d14361d663c96' },
  2024: { before: { poor: 46093, rich: 94278 }, after: { poor: 36245, rich: 124807 }, slow: { turns: 89, of: 151, most: 39 }, cedes: 0, digest: '1b50c16d6229f12d' },
};
const LIVELIHOOD_PINS_6000 = { cedes: 22, first: 4800, metro: { before: 16331, after: 22349 }, digest: '2d31a477ab050c72' };

describe('民生与时代:粮养人、技术门槛、后世大城、近现代拓荒', () => {
  it.each(V1_SEEDS)('seed %i 推 3000 年:粮多的州人多、粮少的州人少;有州被技术卡着发展慢;结果钉住', async (seed) => {
    const p = await open('livelihood');
    const slowed = new Map<number, number>();
    const { civ, seen } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins: plugins.map(watchSlow(slowed)) }));
    expect(civ.stuck).toBeUndefined();
    expect(civ.endYear).toBe(3000);
    expect(capsUsed(p, seen)).toEqual([...p.opened.manifest.requires].sort());
    const base = baseOf(seed);
    const food = foodOf(base);
    const before = fed(base, food);
    const after = fed(civ, food);
    expect(after.rich).toBeGreaterThan(before.rich);
    expect(after.poor).toBeLessThan(before.poor);
    const counts = [...slowed.values()];
    const slow = { turns: counts.filter((n) => n > 0).length, of: counts.length, most: Math.max(...counts) };
    expect(slow.turns).toBeGreaterThan(0);
    const got = { before, after, slow, cedes: by(civ, 'livelihood').length, digest: simDigest(civ) };
    if (process.env.PRINT_PINS) console.log(`livelihood ${seed}: ${JSON.stringify(got)}`);
    expect(got).toEqual(LIVELIHOOD_PINS[seed as V1Seed]);
  }, 120_000);

  it('四个滑条都拨到 0:历史和没装一样', async () => {
    const seed = 7;
    const p = await open('livelihood');
    const { civ } = await run(p, seed, (plugins) => generateCiv(worldOf(seed), { plugins }), { grain: 0, tech: 0, metro: 0, frontier: 0 });
    const keep = (c: Civ) => packValue({ annals: c.annals, polity: c.polity, culture: c.culture, settlements: c.settlements });
    expect(keep(civ)).toEqual(keep(baseOf(seed)));
  }, 120_000);

  it('存下、读回来接着推,和一口气推完一样:在第 1500 年、在后来一个有州正被技术卡着的年份各断开一次', async () => {
    const seed = 2024;
    const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
    const p = await open('livelihood');
    const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;
    const slowed = new Map<number, number>();
    const one = roundTrip((await run(p, seed, (plugins) => generateCiv(w, { plugins: plugins.map(watchSlow(slowed)) }))).civ);
    const late = Math.max(...[...slowed].filter(([y, n]) => y > 1500 && y < 3000 && n > 0).map(([y]) => y));
    expect(late).toBeGreaterThan(1500);
    for (const cut of [1500, late]) {
      const half = roundTrip((await run(p, seed, (plugins) => generateCiv(w, { plugins, endYear: cut }))).civ);
      const rate = half.simPlugins![0].influences!['dev.rate'];
      expect(rate.some((x) => x < 1)).toBe(true);
      const rest = roundTrip(
        (
          await run(p, seed, (plugins) => {
            const r = startContinue(w, half, { plugins });
            expect(r).not.toBeNull();
            return r!.finish();
          })
        ).civ,
      );
      expect(civDiff(rest, one), `第 ${cut} 年断开`).toBeNull();
    }
  }, 180_000);

  it('seed 2024 小一点的世界推 6000 年:到了工业时代城更大,挨着的荒地划进版图;结果钉住', async () => {
    const seed = 2024;
    const end = 6000;
    const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed });
    const p = await open('livelihood');
    const base = generateCiv(w, { endYear: end });
    const { civ } = await run(p, seed, (plugins) => generateCiv(w, { plugins, endYear: end }));
    expect(civ.stuck).toBeUndefined();
    expect(civ.endYear).toBe(end);
    // 拓荒:划的都是没有主、有人住的州,都划成了;一回最多 6 州
    const cedes = by(civ, 'livelihood');
    expect(cedes.length).toBeGreaterThan(0);
    expect(cedes.every((v) => v.kind === 'cede')).toBe(true);
    const took = civ.annals.filter((e) => e.kind === 'intervene' && civ.interventions![e.war]?.plugin === 'livelihood');
    expect(took.map((e) => e.b)).toEqual(cedes.map(() => -1));
    const perRound = new Map<number, number>();
    for (const v of cedes) perRound.set(v.from, (perRound.get(v.from) ?? 0) + 1);
    expect(Math.max(...perRound.values())).toBeLessThanOrEqual(6);
    // 后世大城:按不装插件那一遍末年到了工业时代的州,城里的人多了
    const lv = developmentAt(base.development!, end);
    const townsIn = (c: Civ) => {
      let sum = 0;
      for (const s of c.settlements) if ((s.ended === undefined || s.ended > end) && eraLevel(lv, s.region) >= 5) sum += populationAt(s, end);
      return Math.round(sum);
    };
    const metro = { before: townsIn(base), after: townsIn(civ) };
    expect(metro.after).toBeGreaterThan(metro.before);
    const got = { cedes: cedes.length, first: Math.min(...cedes.map((v) => v.from)), metro, digest: simDigest(civ) };
    if (process.env.PRINT_PINS) console.log(`livelihood 6000: ${JSON.stringify(got)}`);
    expect(got).toEqual(LIVELIHOOD_PINS_6000);
  }, 180_000);
});

/** 两个类型一模一样(不只是能互相赋值) */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

describe('编辑器用的类型', () => {
  it('examples/plugins/civ-atlas-sim.d.ts 里一回合、回话、命令、影响口和官方表的名字和接口第 1 版一样(typecheck 时查)', () => {
    const same: [
      Same<Dts.SimTurn, PluginTurn<SimRead>>,
      Same<Dts.PluginReply, PluginReply>,
      Same<Dts.SimCommand, SimCommand>,
      Same<Dts.InfluenceName, InfluenceName>,
      Same<Dts.OfficialName, OfficialName>,
    ] = [true, true, true, true, true];
    expect(same.every(Boolean)).toBe(true);
  });
});

/**
 * 推演插件的示例(examples/plugins/ 里 role 是 sim 的):从插件文件照推演线程的装法关进 QuickJS,种子 7、2024 各推 3000 年。
 * 厌战、宗教生效是照接口写的那两个(tests/lib/simV1Plugins.ts)搬成插件包,历史的指纹和直接跑钉的一样;魔力钉自己的。
 * 清单要的能力都用得到;编辑器用的类型(examples/plugins/civ-atlas-sim.d.ts)和接口一样。
 * 改了官方推演,魔力的钉子跟着变:PRINT_PINS=1 跑一遍,照打出来的换掉 MAGIC_PINS
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startContinue, type Civ } from '../src/gen/civ';
import { populationAt } from '../src/gen/civ/growth';
import type { PluginReply, PluginTurn, SimPlugin } from '../src/gen/civ/engine/plugin';
import type { InfluenceName, OfficialName, SimCommand, SimRead } from '../src/gen/civ/simApi';
import { packValue, unpackValue } from '../src/gen/snapshot';
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
  it('三个都在:厌战、宗教生效、魔力', () => {
    expect(SIM_EXAMPLES).toEqual(['faith', 'magic', 'weariness']);
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

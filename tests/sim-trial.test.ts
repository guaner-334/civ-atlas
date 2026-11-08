/**
 * 审推演插件时的试跑(src/plugin/simTrial.ts):和官方比几样数、插件写的编年史、图层,推到 1500 年存成世界文件读回来接着推和一口气推比;
 * 推不下去、装不上照实交回。插件从文件装进 QuickJS,和网站上一样
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { generateCiv, type Civ } from '../src/gen/civ';
import { quickjsPlugin } from '../src/gen/quickjs/sim';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { openPluginFile, packPluginFile, type PluginPackInput } from '../src/plugin/pluginFile';
import type { SimPluginFile } from '../src/plugin/pluginWorld';
import { firstDiff, resumeDiff, simLayerPaint, simStats, trialSim, type SimTrialSeed } from '../src/plugin/simTrial';
import type { SimBoxer } from '../src/simPluginRun';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { simV1File } from './lib/simV1Files';

const box: SimBoxer = (spec) => quickjsPlugin(quickjsWasm(), spec);
const LICENSE = 'MIT License\n\nCopyright (c) 2026\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n';

async function fileOf(bytes: Uint8Array): Promise<SimPluginFile> {
  const o = await openPluginFile(bytes);
  return { id: o.manifest.id, sum: o.sum, bytes };
}

/** 一个现写的推演插件文件 */
async function simFile(id: string, sim: Record<string, unknown>, requires: string[], code: string): Promise<SimPluginFile> {
  const manifest = { id, name: id, version: '1.0.0', role: 'sim', api: 1, runtime: 'quickjs', requires, sim, license: 'MIT' } as PluginPackInput['manifest'];
  return fileOf(await packPluginFile({ manifest, files: { 'main.js': code, 'README.md': `# ${id}\n`, LICENSE } }));
}

let w: World;
let official: Civ;

beforeAll(() => {
  w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 2024 });
  official = generateCiv(w);
}, 60_000);

describe('推演插件试跑', () => {
  it('厌战:和官方比几样数、插件下的命令、写的编年史;推到 1500 年存成文件读回来接着推和一口气推的一样', async () => {
    const steps: SimTrialSeed[] = [];
    let ran: Civ | null = null;
    const r = await trialSim(w, [await fileOf(await simV1File('weariness'))], box, { report: (x) => steps.push(x), ran: (c) => (ran = c) });
    const s = r.sim;
    expect(r.error).toBeUndefined();
    expect(s.years).toBe(3000);
    expect(s.stuck).toBeUndefined();
    expect(s.turns).toBe(3001);
    expect(s.pluginMs).toBeGreaterThan(0);
    expect(s.worstMomentMs).toBeGreaterThan(0);
    expect(s.worstMomentMs).toBeLessThanOrEqual(s.pluginMs);
    expect(Object.keys(s.commands)).toEqual(['treaty']);
    expect(s.commands.treaty).toBeGreaterThan(0);
    expect(s.lines).toBe(r.civ!.simChronicle!.length);
    expect(s.chronicle.length).toBe(Math.min(20, s.lines));
    expect(s.chronicle.every((l, i) => i === 0 || l.year >= s.chronicle[i - 1].year)).toBe(true);
    expect(s.chronicle.some((l) => /[{}]/.test(l.text))).toBe(false);
    expect(s.layers).toEqual([]);
    expect(s.stats.official).toEqual(simStats(official, 3000));
    expect(s.stats.plugin).toEqual(simStats(r.civ!, 3000));
    expect(s.stats.plugin!.wars).not.toBe(s.stats.official!.wars);
    expect(s.resumeSame).toBe(true);
    expect(s.resumeNote).toBeUndefined();
    expect(r.log).toHaveLength(3);
    expect(r.log[2]).toMatch(/和一口气推的一样/);
    // 每做完一步交一次:官方、带插件、查分段推
    expect(steps.map((x) => x.log.length)).toEqual([1, 2, 3]);
    expect(steps[0].sim.stats.plugin).toBeNull();
    expect(steps[1].sim.resumeSame).toBeNull();
    expect(ran).toBe(r.civ);
  }, 180_000);

  it('插件用全局变量记数:分段推的接不上一口气推的,算出错,说从哪年起不一样', async () => {
    const code = "let n = 0;\ncivAtlas.sim({ act(turn) { n++; const c = turn.influence('war.odds'); for (let i = 0; i < c.length; i++) c[i] = 1 + (n % 7) / 5; return { influences: { 'war.odds': c } }; } });\n";
    const f = await simFile('counter', { every: 1, influences: ['war.odds'] }, ['sim.events@1', 'sim.influence@1'], code);
    const r = await trialSim(w, [f], box);
    expect(r.error).toBe(`分段推和一口气推的对不上：${r.sim.resumeNote}`);
    expect(r.sim.years).toBe(3000);
    expect(r.sim.resumeSame).toBe(false);
    expect(r.sim.resumeNote).toMatch(/^从第 \d+ 年起史事不一样$/);
    expect(Number(/第 (\d+) 年/.exec(r.sim.resumeNote!)![1])).toBeGreaterThan(1500);
    expect(r.log[2]).toMatch(/和一口气推的对不上/);
  }, 180_000);

  it('推不下去:停在哪年、出的错;几样数按那年和官方比;不查分段推,截图用推到那年的历史', async () => {
    const f = await simFile('broken', { every: 100 }, ['sim.events@1'], "civAtlas.sim({ act(turn) { if (turn.year >= 1200) throw new Error('故意出错'); return {}; } });\n");
    let ran: Civ | null = null;
    const r = await trialSim(w, [f], box, { ran: (c) => (ran = c) });
    expect(r.sim.stuck).toBe(1200);
    expect(r.sim.years).toBeLessThan(1200);
    expect(r.error).toMatch(/^推到第 1200 年推不下去：.*故意出错/);
    expect(r.sim.turns).toBe(13);
    expect(r.sim.stats.official).toEqual(simStats(official, r.sim.years));
    expect(r.sim.resumeSame).toBeNull();
    expect(r.log.at(-1)).toBe(r.error);
    expect(ran).toBe(r.civ);
    expect(r.civ!.stuck?.at).toBe(1200);
  }, 180_000);

  it('图层:交回名字;第一个图层在最后一年的样子按地块铺开,水上不画', async () => {
    const sim = {
      every: 100,
      tables: [{ id: 'heat', name: '热度', unit: 'region', input: true, min: 0, max: 100, off: 0 }],
      layers: [{ id: 'heat', table: 'heat', keep: 500, title: '热度', ramp: { colors: ['#000000', '#ffffff'], min: 0, max: 100 } }],
    };
    const code = "civAtlas.sim({ act(turn) { const t = turn.table('heat'); for (let r = 0; r < t.length; r++) t[r] = r % 100; return { tables: { heat: t } }; } });\n";
    const r = await trialSim(w, [await simFile('heat', sim, ['sim.events@1', 'sim.tables@1'], code)], box);
    expect(r.error).toBeUndefined();
    expect(r.sim.layers).toEqual(['热度']);
    expect(r.sim.resumeSame).toBe(true);
    const civ = r.civ!;
    const paint = simLayerPaint(civ, 3000)!;
    expect(paint.ramp).toEqual({ colors: ['#000000', '#ffffff'], min: 0, max: 100 });
    const of = civ.regions.of;
    expect(paint.values.length).toBe(of.length);
    for (let c = 0; c < of.length; c++) {
      if (of[c] < 0) expect(paint.values[c]).toBeNaN();
      else expect(paint.values[c]).toBe(of[c] % 100);
    }
    expect(simLayerPaint(official, 3000)).toBeNull();
  }, 180_000);

  it('装不上(文件和指纹对不上):说装不上,不推', async () => {
    const f = await fileOf(await simV1File('weariness'));
    let called = 0;
    const r = await trialSim(w, [{ ...f, sum: 'x'.repeat(f.sum.length) }], box, { report: () => called++, ran: () => called++ });
    expect(r.error).toMatch(/^插件装不上：/);
    expect(r.civ).toBeNull();
    expect(r.sim.stats).toEqual({ official: null, plugin: null });
    expect(r.log).toEqual([r.error]);
    expect(called).toBe(0);
  });
});

describe('比两份历史、几样数', () => {
  it('firstDiff:数按 Object.is 比、类型化数组逐个比、对象不看键的先后、值是 undefined 的键当没有', () => {
    expect(firstDiff({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBeNull();
    expect(firstDiff({ a: 1, c: undefined }, { a: 1 })).toBeNull();
    expect(firstDiff({ a: NaN }, { a: NaN })).toBeNull();
    expect(firstDiff({ a: 0 }, { a: -0 })).toBe('a');
    expect(firstDiff({ a: { b: [1, 2] } }, { a: { b: [1, 3] } })).toBe('a.b[1]');
    expect(firstDiff(new Float32Array([1, 2]), new Float32Array([1, 2]))).toBeNull();
    expect(firstDiff({ v: new Float32Array([1, 2]) }, { v: new Float32Array([1, 3]) })).toBe('v[1]');
    expect(firstDiff({ v: new Float32Array([1, 2]) }, { v: new Float64Array([1, 2]) })).toBe('v');
    expect(firstDiff({ v: [1] }, { v: [1, 2] })).toBe('v');
  });

  it('resumeDiff:史事从哪年起不一样;史事一样时说哪一项', () => {
    const a = official;
    expect(resumeDiff(a, { ...a })).toBeNull();
    const i = a.annals.findIndex((x) => x.year >= 1700);
    const annals = a.annals.map((x, k) => (k === i ? { ...x, a: x.a + 1 } : x));
    expect(resumeDiff({ ...a, annals }, a)).toBe(`从第 ${Math.floor(a.annals[i].year)} 年起史事不一样`);
    expect(resumeDiff({ ...a, endYear: 2999 }, a)).toBe('史事一样，endYear 不一样');
  });

  it('simStats:只算到那一年;那年现存几国、人口', () => {
    const at = (y: number) => simStats(official, y);
    expect(at(0)).toMatchObject({ wars: 0, fallen: 0, splits: 0, dynasties: 0, plagues: 0 });
    const s = at(3000);
    expect(s.wars).toBe(official.annals.filter((x) => x.kind === 'war').length);
    expect(s.states).toBeGreaterThan(0);
    expect(s.people).toBeGreaterThan(at(500).people);
    for (const k of ['wars', 'fallen', 'splits', 'dynasties', 'plagues'] as const) expect(at(1500)[k]).toBeLessThanOrEqual(s[k]);
  });
});

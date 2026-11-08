/**
 * 审地图插件时的试跑(src/plugin/mapTrial.ts):不带 / 带插件各长一张比几样数、每一口多久、长两遍和改一笔一不一样、各推几千年;
 * 出错停在哪一口、装不上照实交回。插件从文件装进 QuickJS,和网站上一样
 */
import { describe, expect, it } from 'vitest';
import { quickjsMapPlugin } from '../src/gen/quickjs/map';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import type { MapBoxer } from '../src/mapPluginRun';
import { mapStats, trialMap, worldDiff, type MapTrialSeed } from '../src/plugin/mapTrial';
import { openPluginFile, packPluginFile } from '../src/plugin/pluginFile';
import type { MapManifest } from '../src/plugin/pluginMap';
import { simParamsOf, type MapPluginFile } from '../src/plugin/pluginWorld';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { mapTestFile } from './lib/mapPluginFiles';

const box: MapBoxer = (spec) => quickjsMapPlugin(quickjsWasm(), spec);
const LICENSE = 'MIT License\n\nCopyright (c) 2026\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n';
const P = { ...DEFAULT_PARAMS, cells: 12000, seed: 2024 };

async function fileOf(bytes: Uint8Array): Promise<MapPluginFile & { bytes: Uint8Array }> {
  const o = await openPluginFile(bytes);
  const params = simParamsOf(o.manifest.map?.params);
  return { id: o.manifest.id, sum: o.sum, bytes, ...(Object.keys(params).length ? { params } : {}) };
}

/** 一个现写的地图插件文件 */
async function mapFile(id: string, map: MapManifest, requires: string[], code: string) {
  const manifest = { id, name: id, version: '1.0.0', role: 'map', api: 1, runtime: 'quickjs', requires, map, license: 'MIT' } as const;
  return fileOf(await packPluginFile({ manifest: manifest as never, files: { 'main.js': code, 'README.md': `# ${id}\n`, LICENSE } }));
}

describe('地图插件试跑', () => {
  it('环形山:改了海拔、多了湖;每一口多久;长两遍、改一笔都一样;两张都长出了文明;一步步交回', async () => {
    const steps: MapTrialSeed[] = [];
    const r = await trialMap(P, await fileOf(await mapTestFile('craters')), box, { bigCells: 0, report: (x) => steps.push(x) });
    const m = r.map;
    expect(r.error).toBeUndefined();
    expect(m.stage).toBeUndefined();
    expect(m.cells).toBe(generateWorld(P).mesh.n);
    expect(Object.keys(m.stageMs)).toEqual(['height']);
    expect(m.stageMs.height).toBeGreaterThan(0);
    expect(m.bigStageMs).toBeNull();
    expect(m.stats.plugin!.lakes).toBeGreaterThan(m.stats.official!.lakes);
    expect(m.changed!.elevation).toBeGreaterThan(0);
    expect(Object.keys(m.stats.official!.biomes)).toEqual(Object.keys(m.stats.plugin!.biomes));
    expect(m.sameTwice).toBe(true);
    expect(m.cachedSame).toBe(true);
    expect(m.edit!.official).toBeGreaterThan(0);
    expect(m.edit!.plugin).toBeGreaterThan(0);
    expect(m.edit!.far).toBeLessThan(m.cells / 20);
    expect(m.civ.official!.viable && m.civ.plugin!.viable).toBe(true);
    expect(m.civ.plugin!.states).toBeGreaterThan(0);
    expect(m.layers).toEqual([]);
    expect(r.log.length).toBe(4);
    // 先交用时和几样数,再交推历史、两遍一样
    expect(steps.length).toBe(3);
    expect(steps[0].map.stats.plugin && !steps[0].map.civ.plugin).toBeTruthy();
    expect(steps[1].map.civ.plugin && steps[1].map.sameTwice === null).toBeTruthy();
    expect(steps[2].map).toEqual(m);
  }, 120_000);

  it('柯本气候:只改气候、出一张图层;20 万地块那一次照样量每一口', async () => {
    const r = await trialMap(P, await fileOf(await mapTestFile('koppen')), box, { bigCells: 16000, years: 500 });
    const m = r.map;
    expect(r.error).toBeUndefined();
    expect(Object.keys(m.stageMs).sort()).toEqual(['climate', 'layers']);
    expect(Object.keys(m.bigStageMs!).sort()).toEqual(['climate', 'layers']);
    expect(m.bigError).toBeUndefined();
    expect(m.changed).toMatchObject({ elevation: 0, water: 0 });
    expect(m.changed!.climate).toBeGreaterThan(0);
    expect(m.layers).toEqual([{ id: 'koppen', title: '柯本气候', cells: expect.any(Number) }]);
    expect(m.layers[0].cells).toBeGreaterThan(0);
    expect(r.log.at(-1)).toMatch(/^1\.6 万地块带插件长一张/);
  }, 120_000);

  it('按全图平均海拔整体抬高的:改一笔牵动全图,官方没变的地方也变了', async () => {
    const code = 'civAtlas.map({ height(d) { const e = d.elevation.slice(); let sum = 0; for (let i = 0; i < d.n; i++) sum += e[i]; for (let i = 0; i < d.n; i++) e[i] += (sum / d.n) * 0.05; return { elevation: e }; } });\n';
    const r = await trialMap(P, await mapFile('lift-all', { stages: ['height'] }, ['gen.height@1'], code), box, { bigCells: 0, years: 200 });
    expect(r.error).toBeUndefined();
    expect(r.map.cachedSame).toBe(true);
    expect(r.map.edit!.far).toBeGreaterThan(r.map.cells / 2);
  }, 120_000);

  it('改海拔时出错:停在那一口,只有不带插件的几样数', async () => {
    const steps: MapTrialSeed[] = [];
    const r = await trialMap(P, await mapFile('broken', { stages: ['height'] }, ['gen.height@1'], "civAtlas.map({ height() { throw new Error('故意出错'); } });\n"), box, {
      bigCells: 0,
      report: (x) => steps.push(x),
    });
    expect(r.error).toMatch(/^改海拔这一口出错：.*故意出错/);
    expect(r.map.stage).toBe('height');
    expect(r.map.stats.official).not.toBeNull();
    expect(r.map.stats.plugin).toBeNull();
    expect(r.map.civ).toEqual({ official: null, plugin: null });
    expect(steps.at(-1)?.error).toBe(r.error);
  }, 60_000);

  it('文件和指纹对不上:装不上', async () => {
    const f = await fileOf(await mapTestFile('craters'));
    const r = await trialMap(P, { ...f, sum: 'x'.repeat(f.sum.length) }, box, { bigCells: 0 });
    expect(r.error).toMatch(/^插件装不上：.*指纹/);
    expect(r.map.stats).toEqual({ official: null, plugin: null });
  });

  it('两张图哪里不一样;几样数', () => {
    const w = generateWorld(P);
    expect(worldDiff(w, generateWorld(P))).toBeNull();
    const t = new Float32Array(w.temperature);
    t[5] += 1;
    expect(worldDiff(w, { ...w, temperature: t })).toBe('气温');
    expect(worldDiff(w, { ...w, rivers: w.rivers.slice(1) })).toBe('河');
    const s = mapStats(w);
    expect(s.land).toBeGreaterThan(10);
    expect(s.land).toBeLessThan(90);
    expect(Object.values(s.biomes).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
  });
});

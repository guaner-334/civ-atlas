/** 开发者模式的试生成(src/plugin/devGen.ts)和小卡上的几句话 */
import { describe, expect, it } from 'vitest';
import { quickjsMapPlugin } from '../src/gen/quickjs/map';
import { DEFAULT_PARAMS } from '../src/gen/world';
import type { MapBoxer } from '../src/mapPluginRun';
import { devGen } from '../src/plugin/devGen';
import { openPluginFile, packPluginFile } from '../src/plugin/pluginFile';
import { simParamsOf, type MapPluginFile } from '../src/plugin/pluginWorld';
import { devGenBrief, devGenChecks, devGenCopy, devGenLine, devGenRows, devGenTally, genTime, type GenView } from '../src/ui/plugins/pluginText';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { mapTestFile, type MapTestPlugin } from './lib/mapPluginFiles';

const box: MapBoxer = (spec) => quickjsMapPlugin(quickjsWasm(), spec);
const P = { ...DEFAULT_PARAMS, cells: 12000, seed: 2024 };
const LICENSE = 'MIT License\n\nCopyright (c) 2026\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n';

async function fileOf(bytes: Uint8Array): Promise<MapPluginFile & { bytes: Uint8Array }> {
  const o = await openPluginFile(bytes);
  const params = simParamsOf(o.manifest.map?.params);
  return { id: o.manifest.id, sum: o.sum, bytes, ...(Object.keys(params).length ? { params } : {}) };
}
const example = async (which: MapTestPlugin) => fileOf(await mapTestFile(which));

/** 一个现写的地图插件文件 */
async function mapFile(id: string, stages: string[], requires: string[], code: string) {
  const manifest = { id, name: id, version: '1.0.0', role: 'map', api: 1, runtime: 'quickjs', requires, map: { stages }, license: 'MIT' } as const;
  return fileOf(await packPluginFile({ manifest: manifest as never, files: { 'main.js': code, 'README.md': `# ${id}\n`, LICENSE } }));
}

const view = (run: Awaited<ReturnType<typeof devGen>>, names: Record<string, string>): GenView => ({
  at: new Date(2026, 10, 9, 15, 42, 8).getTime(),
  file: 'crater.civplugin',
  plugins: Object.entries(names).map(([id, name]) => ({ id, name, dev: id === 'craters' })),
  alone: false,
  result: run.result,
});

describe('开发者模式的试生成', () => {
  it('环形山 + 柯本气候:每一口一行(先改海拔,再改气候、出图层),几样数,两条自动查都一样', async () => {
    const steps: number[] = [];
    const run = await devGen({ params: P, files: [await example('craters'), await example('koppen')] }, box, { progress: (p) => steps.push(p) });
    const r = run.result;
    expect(r.error).toBeNull();
    expect(r.steps.map((s) => [s.id, s.stage])).toEqual([
      ['craters', 'height'],
      ['koppen', 'climate'],
      ['koppen', 'layers'],
    ]);
    expect(r.steps[0].changed).toBeGreaterThan(0);
    expect(r.steps[1].changed).toBeGreaterThan(0);
    expect(r.steps[2].changed).toBe(1);
    expect(r.stats.plugin!.lakes).toBeGreaterThan(r.stats.official!.lakes);
    expect(r.sameTwice).toBe(true);
    expect(r.cachedSame).toBe(true);
    expect(run.official && run.plugin).toBeTruthy();
    expect(steps.at(-1)).toBeGreaterThan(0.9);

    const t = view(run, { craters: '环形山', koppen: '柯本气候' });
    expect(devGenLine(t, false)).toMatch(/^15:42:08 试生成完：这个世界的种子和参数，不带 \/ 带插件各长一遍，用了 \d+\.\d 秒（crater\.civplugin）$/);
    expect(devGenLine(t, true)).toMatch(/^15:42:08 试生成完：不带 \/ 带插件各长一遍，用了 \d+\.\d 秒$/);
    expect(devGenRows(t).map((x) => [x.name, x.stage, x.changed.replace(/[\d,]+/, 'N')])).toEqual([
      ['环形山', '改海拔', 'N 块'],
      ['柯本气候', '改气候', 'N 块'],
      ['柯本气候', '出图层', 'N 张'],
    ]);
    expect(devGenTally(t).map((x) => x.name)).toEqual(['陆地', '湖', '河']);
    expect(devGenChecks(t, false).map((c) => [c.ok, c.text])).toEqual([
      [true, '同一个种子长两遍一样'],
      [true, '改一笔地形（挖一个湖）和从头长一样'],
    ]);
    expect(devGenChecks(t, true).map((c) => c.text)).toEqual(['长两遍一样', '改一笔地形和从头长一样']);
    expect(devGenBrief(t)[0]).toMatch(/^环形山改海拔 .+，柯本气候改气候 .+，柯本气候出图层 .+$/);
    expect(devGenBrief(t)[1]).toMatch(/湖 \d+ → \d+ 块/);
  }, 120_000);

  it('插件打的日志带是哪一步;交回超出范围的,网站记一条压回去了', async () => {
    const f = await mapFile('tall', ['height'], ['gen.height@1'], "civAtlas.map({ height(d) { console.log('抬高三块'); const e = Array.from(d.elevation); e[0] = 20000; e[1] = 30000; e[2] = -20000; return { elevation: e }; } });");
    const run = await devGen({ params: P, files: [f] }, box);
    expect(run.result.error).toBeNull();
    expect(run.result.steps).toEqual([{ id: 'tall', stage: 'height', ms: expect.any(Number), changed: 3 }]);
    expect(run.result.logs).toEqual([
      { stage: 'height', level: 'info', plugin: 'tall', text: '抬高三块' },
      { stage: 'height', level: 'site', plugin: 'tall', text: '交回的海拔有 2 块高过 9000 米，压回 9000 米' },
      { stage: 'height', level: 'site', plugin: 'tall', text: '交回的海拔有 1 块低过 -11000 米，压回 -11000 米' },
    ]);
  }, 60_000);

  it('出错停下:第二行写停在哪一步,表格列到那一口,日志最后一条是那句错,不查两遍', async () => {
    const f = await mapFile('boom', ['height'], ['gen.height@1'], "civAtlas.map({ height() { throw new Error('坑砸穿了'); } });");
    const run = await devGen({ params: P, files: [f] }, box);
    const r = run.result;
    expect(r.error).toEqual({ plugin: 'boom', stage: 'height', why: '坑砸穿了' });
    expect(r.steps).toEqual([{ id: 'boom', stage: 'height', ms: expect.any(Number), changed: 0, failed: true }]);
    expect(r.logs.at(-1)).toEqual({ stage: 'height', level: 'error', plugin: 'boom', text: '坑砸穿了' });
    expect(r.sameTwice).toBeNull();
    expect(run.plugin).toBeNull();
    const t = { ...view(run, { boom: 'boom' }), file: 'boom.civplugin' };
    expect(devGenLine(t, false)).toBe('15:42:08 试生成到「改海拔」出错停下（boom.civplugin）');
    expect(devGenRows(t).map((x) => x.changed)).toEqual(['出错']);
    expect(devGenChecks(t, false)).toEqual([]);
    expect(devGenCopy(t).split('\n').at(-1)).toBe('改海拔 出错 [boom] 坑砸穿了');
  }, 60_000);

  it('两条自动查对不上、后几遍出错时的说法', () => {
    const base: GenView = {
      at: 0,
      file: 'x.civplugin',
      plugins: [],
      alone: false,
      result: { ms: 1, steps: [], stats: { official: null, plugin: null }, sameTwice: false, sameNote: '海拔', cachedSame: false, cachedNote: '出错：太慢', logs: [], error: null },
    };
    expect(devGenChecks(base, false).map((c) => c.text)).toEqual(['不一样：长两遍海拔对不上，多半是用了全局变量记东西', '不一样：改一笔地形以后接着长时出错：太慢，多半是用了全局变量记东西']);
  });

  it('用时的写法', () => {
    expect([0.2, 3, 9.6, 20, 93, 1234].map(genTime)).toEqual(['不到 1 毫秒', '3 毫秒', '10 毫秒', '0.02 秒', '0.09 秒', '1.2 秒']);
  });
});

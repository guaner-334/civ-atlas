/**
 * 开发者模式的试推(src/plugin/devTry.ts):每个插件出手几回、一共多久、最慢一次;命令和编年史;插件 console 打的带年份;
 * 推到一半存下另装一份接着推和一口气推比;推不下去停在哪年。小卡上的几句话(ui/plugins/pluginText.ts)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { quickjsPlugin } from '../src/gen/quickjs/sim';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { devTry } from '../src/plugin/devTry';
import { openPluginFile, packPluginFile, type PluginPackInput } from '../src/plugin/pluginFile';
import type { SimPluginFile } from '../src/plugin/pluginWorld';
import type { SimBoxer } from '../src/simPluginRun';
import { devTryCounts, devTryLine, devTryResume, devTryRows, type TriedView } from '../src/ui/plugins/pluginText';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { simV1File } from './lib/simV1Files';

const box: SimBoxer = (spec) => quickjsPlugin(quickjsWasm(), spec);
const LICENSE = 'MIT License\n\nCopyright (c) 2026\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software.\n';

async function fileOf(bytes: Uint8Array): Promise<SimPluginFile> {
  const o = await openPluginFile(bytes);
  return { id: o.manifest.id, sum: o.sum, bytes };
}
async function simFile(id: string, sim: Record<string, unknown>, requires: string[], code: string): Promise<SimPluginFile> {
  const manifest = { id, name: id, version: '1.0.0', role: 'sim', api: 1, runtime: 'quickjs', requires, sim, license: 'MIT' } as PluginPackInput['manifest'];
  return fileOf(await packPluginFile({ manifest, files: { 'main.js': code, 'README.md': `# ${id}\n`, LICENSE } }));
}

let w: World;
beforeAll(() => {
  w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 2024 });
}, 60_000);

const opt = { years: 300, half: 150, box };

describe('开发者模式试推', () => {
  it('厌战和一个打日志的插件:每个出手几回、多久;命令、编年史;console 打的带年份;分段推和一口气推一样', async () => {
    const talk = await simFile('talk', { every: 100 }, ['sim.events@1'], "console.log('装好了');\ncivAtlas.sim({ act(turn) { console.log('到了', turn.year); if (turn.year === 200) console.warn({ y: turn.year }); return {}; } });\n");
    const pct: number[] = [];
    const r = await devTry(w, {}, [await fileOf(await simV1File('weariness')), talk], 2024, { ...opt, progress: (p) => pct.push(p) });
    expect(r.years).toBe(300);
    expect(r.stuck).toBeNull();
    expect(r.plugins.map((p) => [p.id, p.turns])).toEqual([
      ['weariness', 301],
      ['talk', 4],
    ]);
    for (const p of r.plugins) {
      expect(p.worst).toBeLessThanOrEqual(p.ms);
      expect(p.worstYear).toBeGreaterThanOrEqual(0);
    }
    expect(Object.keys(r.commands).every((k) => k === 'treaty')).toBe(true);
    expect(r.lines).toBeGreaterThanOrEqual(0);
    expect(r.logs).toEqual([
      { year: null, level: 'info', plugin: 'talk', text: '装好了' },
      { year: 0, level: 'info', plugin: 'talk', text: '到了 0' },
      { year: 100, level: 'info', plugin: 'talk', text: '到了 100' },
      { year: 200, level: 'info', plugin: 'talk', text: '到了 200' },
      { year: 200, level: 'warn', plugin: 'talk', text: '{"y":200}' },
      { year: 300, level: 'info', plugin: 'talk', text: '到了 300' },
    ]);
    expect(r.resume).toEqual({ same: true });
    expect(pct[0]).toBe(0.6);
    expect(pct.at(-1)).toBe(1);
  }, 180_000);

  it('插件用全局变量记数:分段推的对不上,说从哪年起', async () => {
    const code = "let n = 0;\ncivAtlas.sim({ act(turn) { n++; return n % 50 === 0 ? { chronicle: [{ text: '第 ' + n + ' 回' }] } : {}; } });\n";
    const r = await devTry(w, {}, [await simFile('counter', { every: 1 }, ['sim.events@1', 'sim.chronicle@1'], code)], 2024, opt);
    expect(r.stuck).toBeNull();
    expect(r.lines).toBe(6);
    // 一口气推的第 199 年写「第 200 回」,接着推的那一份从第 150 年重数,第 199 年写的是「第 50 回」
    expect(r.resume).toEqual({ same: false, year: 199, what: 'history' });
  }, 180_000);

  it('推不下去:停在哪年、那句错记在日志最后,用时只算第一遍,不查分段推', async () => {
    const f = await simFile('broken', { every: 10 }, ['sim.events@1'], "civAtlas.sim({ act(turn) { console.log('出手', turn.year); if (turn.year >= 120) throw new Error('故意出错'); return {}; } });\n");
    const r = await devTry(w, {}, [f], 2024, opt);
    expect(r.stuck?.year).toBe(120);
    expect(r.stuck?.error).toMatch(/故意出错/);
    expect(r.plugins[0].turns).toBe(13);
    expect(r.logs.filter((l) => l.level === 'info')).toHaveLength(13);
    expect(r.logs.at(-1)).toMatchObject({ year: 120, level: 'error' });
    expect(r.resume).toBeNull();
  }, 180_000);
});

describe('小卡上的话', () => {
  const tried = (over: Partial<NonNullable<TriedView['result']>> = {}): TriedView => ({
    at: new Date(2026, 10, 8, 15, 42, 8).getTime(),
    file: 'weariness.civplugin',
    plugins: [
      { id: 'weariness', name: '厌战', dev: true },
      { id: 'faith', name: '宗教生效', dev: false },
    ],
    alone: false,
    result: {
      years: 300,
      stuck: null,
      ms: 2100,
      plugins: [
        { id: 'weariness', turns: 300, ms: 420, worst: 3.2, worstYear: 212 },
        { id: 'faith', turns: 60, ms: 210, worst: 0.4, worstYear: 155 },
      ],
      commands: { treaty: 9, declare: 3, ally: 2 },
      lines: 14,
      logs: [],
      resume: { same: true },
      ...over,
    },
  });

  it('试推完:第二行、每个插件一行、命令和编年史、分段推;手机上短一些', () => {
    expect(devTryLine(tried(), false)).toBe('15:42:08 试推完：这个世界的地图，第 0 年推到第 300 年，用了 2.1 秒（weariness.civplugin）');
    expect(devTryLine(tried(), true)).toBe('15:42:08 试推完：第 0 年推到第 300 年，用了 2.1 秒');
    expect(devTryRows(tried(), false)).toEqual([
      { id: 'weariness', name: '厌战（开发中）', turns: '300 回', total: '0.42 秒', worst: '3 毫秒，第 212 年' },
      { id: 'faith', name: '宗教生效', turns: '60 回', total: '0.21 秒', worst: '不到 1 毫秒，第 155 年' },
    ]);
    expect(devTryRows(tried(), true)[0].worst).toBe('3 毫秒');
    expect(devTryCounts(tried(), false)).toBe('下了 14 条命令（立约 9、宣战 3、结盟 2），写了 14 句编年史');
    expect(devTryCounts(tried(), true)).toBe('下了 14 条命令，写了 14 句编年史');
    expect(devTryCounts(tried({ commands: {}, lines: 0 }), false)).toBe('没下命令，没写编年史');
    expect(devTryResume(tried(), 150, false)).toEqual({ ok: true, text: '分段推（推到第 150 年存下、打开再接着推）和一口气推一样' });
    expect(devTryResume(tried(), 150, true)).toEqual({ ok: true, text: '分段推和一口气推一样' });
  });

  it('推不下去、分段推对不上、没推成', () => {
    expect(devTryLine(tried({ stuck: { year: 287, error: '故意出错' }, resume: null }), false)).toBe('15:42:08 试推到第 287 年出错停下（weariness.civplugin）');
    expect(devTryResume(tried({ resume: null }), 150, false)).toBeNull();
    expect(devTryResume(tried({ resume: { same: false, year: 151, what: 'history' } }), 150, false)).toEqual({ ok: false, text: '不一样：第 151 年起对不上，多半是用了全局变量记东西' });
    expect(devTryLine({ ...tried(), result: null, error: '世界换了' }, false)).toBe('15:42:08 没推成：世界换了');
  });
});

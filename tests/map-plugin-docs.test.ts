/**
 * 地图插件文档(docs/plugins/map.md)里的代码片段都能跑、都对得上:
 * - 每段 js 是一个完整的插件,和它前面最近的那段完整清单(json,写了 role)打成插件包,经 QuickJS 在种子 7 长一张图,
 *   地图的指纹、几样统计、图层和 tests/fixtures/map-plugin-docs.json 对上
 * - 摘的 json(一张图层、几个滑条)和示例或文档里某份清单的那一块一模一样
 * - ts 是从 examples/plugins/civ-atlas-map.d.ts 原样摘的
 * 有意改了文档里的插件、或改了官方生成,PRINT_PINS=1 跑一遍重写那份快照,和文档一起提交
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { packPluginFile, type PluginPackInput } from '../src/plugin/pluginFile';
import { mapFileOf, mapPluginInNode } from '../scripts/lib/mapPluginFile';
import { mapDigest } from './lib/mapPins';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const DOC = lf(readFileSync(at('../docs/plugins/map.md'), 'utf8'));
const DTS = lf(readFileSync(at('../examples/plugins/civ-atlas-map.d.ts'), 'utf8'));
const EXAMPLES = at('../examples/plugins/');
const FIXTURE = at('./fixtures/map-plugin-docs.json');
const LICENSE = readFileSync(join(EXAMPLES, 'craters', 'LICENSE'));

const blocks = [...DOC.matchAll(/^```(\w*)\n([\s\S]*?)^```$/gm)].map((m) => ({ lang: m[1], text: m[2] }));
const isManifest = (j: unknown): j is Record<string, unknown> => typeof j === 'object' && j !== null && 'role' in j;

/** 每段 js 和它前面最近的完整清单 */
const plugins: { manifest: Record<string, unknown>; code: string }[] = [];
{
  let last: Record<string, unknown> | null = null;
  for (const b of blocks) {
    if (b.lang === 'json') {
      const j = JSON.parse(b.text);
      if (isManifest(j)) last = j;
    } else if (b.lang === 'js') {
      if (!last) throw new Error('文档里有一段 js 前面没有清单');
      plugins.push({ manifest: last, code: b.text });
      last = null;
    }
  }
}

/** x 是不是 v 里(任意一层)的某一块 */
function inside(v: unknown, x: unknown): boolean {
  if (JSON.stringify(v) === JSON.stringify(x)) return true;
  if (v === null || typeof v !== 'object') return false;
  return Object.values(v).some((y) => inside(y, x));
}

const ws = (s: string) => s.replace(/\s+/g, ' ').trim();
const r1 = (x: number) => Math.round(x * 10) / 10;

/** 几样统计:陆地几成、湖多少块、河几条、陆地平均气温和降水;每张图层有值的地块、最小、最大 */
function summary(w: World) {
  const n = w.mesh.n;
  let land = 0;
  let t = 0;
  let p = 0;
  for (let i = 0; i < n; i++) {
    if (w.water[i] !== 0) continue;
    land++;
    t += w.temperature[i];
    p += w.precipitation[i];
  }
  const layers = (w.mapLayers ?? []).map((l) => {
    let cells = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of l.values) {
      if (Number.isNaN(x)) continue;
      cells++;
      lo = Math.min(lo, x);
      hi = Math.max(hi, x);
    }
    return { id: `${l.by}/${l.id}`, cells, min: r1(lo), max: r1(hi) };
  });
  return {
    land: r1((100 * land) / n),
    lakes: w.water.filter((x) => x === 2).length,
    rivers: w.rivers.length,
    temperature: r1(t / land),
    precipitation: Math.round(p / land),
    ...(layers.length ? { layers } : {}),
    digest: mapDigest(w),
  };
}

describe('地图插件文档的代码片段', () => {
  it('有教程和几个完整的例子;json 都是合法的 JSON', () => {
    expect(plugins.map((p) => p.manifest.id)).toEqual(['sealevel', 'dryinland', 'hills', 'riverside']);
    for (const b of blocks.filter((x) => x.lang === 'json')) expect(() => JSON.parse(b.text), b.text.slice(0, 60)).not.toThrow();
  });

  it('摘的 json 和示例或文档里某份清单的那一块一模一样', () => {
    const sources = [
      ...readdirSync(EXAMPLES, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => JSON.parse(readFileSync(join(EXAMPLES, d.name, 'plugin.json'), 'utf8'))),
      ...plugins.map((p) => p.manifest),
    ];
    const parts = blocks.filter((b) => b.lang === 'json').map((b) => JSON.parse(b.text)).filter((j) => !isManifest(j));
    expect(parts.length).toBeGreaterThan(0);
    for (const j of parts) expect(sources.some((s) => inside(s, j)), JSON.stringify(j).slice(0, 80)).toBe(true);
  });

  it('ts 是从 civ-atlas-map.d.ts 原样摘的', () => {
    const ts = blocks.filter((b) => b.lang === 'ts');
    expect(ts.length).toBeGreaterThan(0);
    for (const b of ts) expect(ws(DTS).includes(ws(b.text)), b.text.slice(0, 60)).toBe(true);
  });

  it('完整的例子打成插件包,经 QuickJS 在种子 7 长一张图,结果和快照对上', async () => {
    const P = { ...DEFAULT_PARAMS, seed: 7 };
    const got: Record<string, unknown> = { plain: summary(generateWorld(P)) };
    for (const { manifest, code } of plugins) {
      const bytes = await packPluginFile({
        manifest: manifest as PluginPackInput['manifest'],
        files: { 'main.js': code, 'README.md': `# ${String(manifest.name)}\n`, LICENSE: new Uint8Array(LICENSE) },
      });
      const pl = await mapPluginInNode(await mapFileOf(bytes));
      try {
        got[String(manifest.id)] = summary(generateWorld(P, undefined, undefined, undefined, undefined, [pl]));
      } finally {
        pl.dispose();
      }
    }
    if (process.env.PRINT_PINS) writeFileSync(FIXTURE, `${JSON.stringify(got, null, 2)}\n`);
    expect(got).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  }, 120_000);
});

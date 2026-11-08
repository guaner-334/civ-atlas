/**
 * 推演插件文档(docs/plugins/sim.md)里的代码片段都能跑、都对得上:
 * - 每段 js 是一个完整的插件,和它前面最近的那段完整清单(json,写了 role)打成插件包,经 QuickJS 在种子 7 推 3000 年,
 *   出手几次、下的命令、编年史、图层和历史的指纹和 tests/fixtures/sim-plugin-docs.json 对上
 * - 摘的 json(一张表、一个图层)和示例或文档里某份清单的那一块一模一样
 * - ts 是从 examples/plugins/civ-atlas-sim.d.ts 原样摘的
 * 有意改了文档里的插件、或改了官方推演,PRINT_PINS=1 跑一遍重写那份快照,和文档一起提交
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { PluginReply, PluginTurn, SimPlugin } from '../src/gen/civ/engine/plugin';
import type { SimRead } from '../src/gen/civ/simApi';
import { packPluginFile, type PluginPackInput } from '../src/plugin/pluginFile';
import { simFileOf, simPluginsInNode } from '../scripts/lib/simPluginFile';
import { simDigest } from './lib/simV1Pins';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const lf = (s: string) => s.replace(/\r\n/g, '\n');
const DOC = lf(readFileSync(at('../docs/plugins/sim.md'), 'utf8'));
const DTS = lf(readFileSync(at('../examples/plugins/civ-atlas-sim.d.ts'), 'utf8'));
const EXAMPLES = at('../examples/plugins/');
const FIXTURE = at('./fixtures/sim-plugin-docs.json');
const LICENSE = readFileSync(join(EXAMPLES, 'magic', 'LICENSE'));

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

describe('推演插件文档的代码片段', () => {
  it('有教程和几个完整的例子;json 都是合法的 JSON', () => {
    expect(plugins.map((p) => p.manifest.id)).toEqual(['harbor', 'comet', 'fallen', 'conquest']);
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

  it('ts 是从 civ-atlas-sim.d.ts 原样摘的', () => {
    const ts = blocks.filter((b) => b.lang === 'ts');
    expect(ts.length).toBeGreaterThan(0);
    for (const b of ts) expect(ws(DTS).includes(ws(b.text)), b.text.slice(0, 60)).toBe(true);
  });

  it('完整的例子打成插件包,经 QuickJS 在种子 7 推 3000 年推得完,结果和快照对上', async () => {
    const seed = 7;
    const world = generateWorld({ ...DEFAULT_PARAMS, seed });
    const got: Record<string, unknown> = {};
    for (const { manifest, code } of plugins) {
      const bytes = await packPluginFile({
        manifest: manifest as PluginPackInput['manifest'],
        files: { 'main.js': code, 'README.md': `# ${String(manifest.name)}\n`, LICENSE: new Uint8Array(LICENSE) },
      });
      const on = await simPluginsInNode([(await simFileOf(bytes)).file], seed);
      const q = on.plugins[0];
      let acts = 0;
      const commands: Record<string, number> = {};
      const spy: SimPlugin<SimRead> = {
        ...q,
        act(turn: PluginTurn<SimRead>) {
          acts++;
          const r = q.act(turn) as PluginReply | undefined;
          for (const c of r?.commands ?? []) {
            const k = String((c as { kind?: unknown }).kind);
            commands[k] = (commands[k] ?? 0) + 1;
          }
          return r;
        },
      };
      let civ: Civ;
      try {
        civ = generateCiv(world, { plugins: [spy] });
      } finally {
        on.dispose();
      }
      expect(civ.stuck, String(manifest.id)).toBeUndefined();
      expect(civ.endYear).toBe(3000);
      const lines = civ.simChronicle ?? [];
      got[String(manifest.id)] = { acts, commands, chronicle: lines.length, first: lines.slice(0, 3).map((l) => `${l.year} ${l.text}`), digest: simDigest(civ) };
    }
    if (process.env.PRINT_PINS) writeFileSync(FIXTURE, `${JSON.stringify(got, null, 2)}\n`);
    expect(got).toEqual(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  }, 240_000);
});

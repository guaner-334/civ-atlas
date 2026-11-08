/**
 * 推演插件试跑:照推演线程的装法(src/simPluginRun.ts)把插件关进 QuickJS,在一个种子的世界上推一遍,和官方的比一比。
 *
 *   npx tsx scripts/sim-plugin-try.ts examples/plugins/magic                  # 种子 7、默认参数推 3000 年
 *   npx tsx scripts/sim-plugin-try.ts <插件文件夹或 .civplugin> [seed=2024] [years=1000] [滑条名=数 ...]
 *
 * 打印:出手几次、下的命令和被挡下的、编年史前 20 句、图层、几样统计(官方 → 带插件)。插件出错停下的打印那句错,退出码 1。
 */
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { DEFAULT_CIV_PARAMS, generateCiv, type Civ } from '../src/gen/civ';
import type { PluginReply, PluginTurn, SimPlugin } from '../src/gen/civ/engine/plugin';
import { chronicleText } from '../src/gen/civ/engine/pluginChronicle';
import type { SimRead } from '../src/gen/civ/simApi';
import { openSimPlugin, simPluginsInNode } from './lib/simPluginFile';

const args = process.argv.slice(2);
const path = args.find((a) => !a.includes('='));
if (!path) {
  console.error('用法:npx tsx scripts/sim-plugin-try.ts <插件文件夹或 .civplugin> [seed=7] [years=3000] [滑条名=数 ...]');
  process.exit(1);
}
let seed = 7;
let years = DEFAULT_CIV_PARAMS.endYear;
const params: Record<string, number> = {};
for (const a of args) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(-?[\d.]+(?:e-?\d+)?)$/.exec(a);
  if (!m) continue;
  if (m[1] === 'seed') seed = Number(m[2]);
  else if (m[1] === 'years') years = Number(m[2]);
  else params[m[1]] = Number(m[2]);
}

function stop(e: unknown): never {
  console.error(`出错停下:${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
const { opened, file } = await openSimPlugin(path, params).catch(stop);
const m = opened.manifest;
console.log(`${m.name} ${m.version}(${m.id}),种子 ${seed},推 ${years} 年`);
const world = generateWorld({ ...DEFAULT_PARAMS, seed });
let t0 = performance.now();
const base = generateCiv(world, { endYear: years });
const baseMs = performance.now() - t0;

const on = await simPluginsInNode([file], seed).catch(stop);
const q = on.plugins[0];
let acts = 0;
let refused = 0;
const kinds: Record<string, number> = {};
const spy: SimPlugin<SimRead> = {
  ...q,
  act(turn: PluginTurn<SimRead>) {
    acts++;
    refused += turn.refused?.length ?? 0;
    const r = q.act(turn) as PluginReply | undefined;
    for (const c of r?.commands ?? []) {
      const k = String((c as { kind?: unknown }).kind);
      kinds[k] = (kinds[k] ?? 0) + 1;
    }
    return r;
  },
};
let civ: Civ;
t0 = performance.now();
try {
  civ = generateCiv(world, { endYear: years, plugins: [spy] });
} catch (e) {
  stop(e);
} finally {
  on.dispose();
}
const ms = performance.now() - t0;
if (civ.stuck) console.log(`推到第 ${civ.endYear} 年推不下去了:${JSON.stringify(civ.stuck)}`);

const sec = (x: number) => (x / 1000).toFixed(1);
console.log(`用时:官方 ${sec(baseMs)} 秒,带插件 ${sec(ms)} 秒(每秒 ${Math.round(civ.endYear / (ms / 1000))} 年)`);
console.log(`出手 ${acts} 次;下的命令 ${Object.entries(kinds).map(([k, n]) => `${k} ${n} 条`).join('、') || '没有'};被挡下 ${refused} 条`);

const nameOf = (kind: string, id: number): string => {
  const pick = kind === 'polity' ? civ.polities[id]?.name : kind === 'settlement' ? civ.settlements[id]?.name : kind === 'culture' ? civ.cultures[id]?.name : civ.regions.name?.[id];
  return pick || `${kind} ${id}`;
};
const lines = civ.simChronicle ?? [];
console.log(`编年史 ${lines.length} 句${lines.length > 20 ? '(前 20 句)' : ''}:`);
for (const l of lines.slice(0, 20)) console.log(`  第 ${l.year} 年  ${chronicleText(l.text, nameOf)}`);

for (const L of civ.simLayers ?? []) {
  const n = L.values.length / L.years.length;
  const last = L.values.subarray(L.values.length - n);
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  let k = 0;
  for (const v of last) {
    if (Number.isNaN(v)) continue;
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
    sum += v;
    k++;
  }
  console.log(`图层 ${L.id}「${L.title}」:${L.years.length} 份(第 ${L.years[0]}–${L.years[L.years.length - 1]} 年);最后一份 最小 ${lo.toFixed(2)} 平均 ${(sum / k).toFixed(2)} 最大 ${hi.toFixed(2)}`);
}

const count = (c: Civ) => {
  const by = (kind: string) => c.annals.filter((e) => e.kind === kind).length;
  return { 国家: c.polities.length, 战争: by('war'), 灭国: by('fall'), 分裂: by('split'), 改朝换代: by('dynasty'), 瘟疫: by('plague') };
};
const a = count(base);
const b = count(civ);
console.log(`统计(官方 → 带插件):${Object.keys(a).map((k) => `${k} ${a[k as keyof typeof a]} → ${b[k as keyof typeof b]}`).join(',')}`);

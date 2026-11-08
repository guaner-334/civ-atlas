/**
 * 自检页「推演插件」一组真去量的那一半(在后台线程里跑,见 simProbe.worker.ts;单测在 Node 里跑同一份,钉住散列):
 *   1. 示例插件「宗教生效」「厌战」带着推 SIM_PROBE_YEARS 年(种子 7、默认地图),量每一回合多久,取中间那一回合;
 *      再量不算插件推一年多久,估带两个示例插件推 3000 年要几秒
 *   2. 推出来的历史打成散列,和电脑上事先算好的 SIM_PROBE_SUM 比(一样 = 这台推出来的和电脑上逐位一样)
 *   3. QuickJS 的栈:一直往下调,看是 QuickJS 自己先停(够),还是后台线程本身的栈先用完(不够:各家浏览器停的地方不一样)
 */
import { newQuickJSWASMModuleFromVariant, newVariant } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import type { PluginTurn, SimPlugin } from '../../gen/civ/engine/plugin';
import { generateCiv } from '../../gen/civ';
import { QUICKJS_LIMITS } from '../../gen/quickjs/sim';
import type { SimRead } from '../../gen/civ/simRead';
import { packValue } from '../../gen/snapshot';
import { DEFAULT_PARAMS, generateWorld } from '../../gen/world';
import { simPluginsOn, type SimBoxer } from '../../simPluginRun';
import type { SimPluginFile } from '../pluginWorld';
import { SIM_PROBE_SEED, SIM_PROBE_SUM, SIM_PROBE_YEARS, type SimProbeRaw, type StackRaw } from './verdict';

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};
const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

/** 历史的散列:史事、国家、民族、命令、插件写的编年史和它记的状态(SHA-256 的前 16 位) */
export async function simSum(civ: { annals: unknown; polity: unknown; culture: unknown; interventions?: unknown; simChronicle?: unknown; simPlugins?: unknown }): Promise<string> {
  const x = packValue({ annals: civ.annals, polity: civ.polity, culture: civ.culture, interventions: civ.interventions ?? [], chronicle: civ.simChronicle ?? [], plugins: civ.simPlugins ?? [] });
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', x));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** files = 宗教生效、厌战(按这个先后出手) */
export async function simProbe(files: readonly SimPluginFile[], box: SimBoxer, now: () => number = () => performance.now()): Promise<SimProbeRaw> {
  let t0 = now();
  const world = generateWorld({ ...DEFAULT_PARAMS, seed: SIM_PROBE_SEED });
  const genMs = now() - t0;
  const on = await simPluginsOn(files, SIM_PROBE_SEED, box);
  const times = new Map<string, number[]>(files.map((f) => [f.id, []]));
  const plugins = on.plugins.map(
    (p): SimPlugin<SimRead> => ({
      ...p,
      act(turn: PluginTurn<SimRead>) {
        const a = now();
        try {
          return p.act(turn);
        } finally {
          times.get(p.id)!.push(now() - a);
        }
      },
    }),
  );
  t0 = now();
  let civ;
  try {
    civ = generateCiv(world, { endYear: SIM_PROBE_YEARS, plugins });
  } finally {
    on.dispose();
  }
  const civMs = now() - t0;
  const [faith, wear] = files.map((f) => times.get(f.id) ?? []);
  const inPlugins = [...times.values()].flat().reduce((s, x) => s + x, 0);
  const yearMs = Math.max(0, civMs - inPlugins) / SIM_PROBE_YEARS;
  const faithMs = median(faith);
  const wearMs = median(wear ?? []);
  const estSec = (yearMs * 3000 + faithMs * 601 + wearMs * 3001) / 1000;
  const sum = await simSum(civ);
  return { faithMs: round(faithMs), faithTurns: faith.length, wearMs: round(wearMs), yearMs: round(yearMs, 3), estSec: round(estSec, 1), genMs: Math.round(genMs), civMs: Math.round(civMs), sum, same: sum === SIM_PROBE_SUM };
}

/** QuickJS 的栈够不够:和推演插件一样的上限,一直往下调,看谁先停 */
export async function stackProbe(wasm: WebAssembly.Module): Promise<StackRaw> {
  const pages = Math.floor(QUICKJS_LIMITS.memory / 65536);
  const qjs = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmModule: wasm, wasmMemory: new WebAssembly.Memory({ initial: 256, maximum: pages }) }));
  const rt = qjs.newRuntime();
  rt.setMaxStackSize(QUICKJS_LIMITS.stack);
  const vm = rt.newContext();
  try {
    const r = vm.evalCode("var d = 0, m = ''; function f() { d++; f(); } try { f(); } catch (e) { m = String((e && e.message) || e); } [d, m]");
    if (r.error) {
      const e = vm.dump(r.error) as { message?: string };
      r.error.dispose();
      return { depth: 0, by: 'none', note: String(e?.message ?? e).slice(0, 120) };
    }
    const [depth, note] = vm.dump(r.value) as [number, string];
    r.value.dispose();
    return { depth, by: /stack/i.test(note) ? 'quickjs' : 'none', note: note.slice(0, 120) };
  } catch (e) {
    // 后台线程本身的栈先用完了:QuickJS 停在半路,这一份不能再用
    return { depth: 0, by: 'thread', note: (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 120) };
  } finally {
    try {
      vm.dispose();
      rt.dispose();
    } catch {
      // 停在半路的放不掉,线程用完就关
    }
  }
}

/**
 * 推演线程里装推演插件:插件文件(SimPluginFile)→ 关进 QuickJS 的插件,连同世界清单里记它的那一条。
 * 一段推演装一次、推完放掉:插件的全局变量不跨段带,接着推和从第 0 年推一样。只在世界用了推演插件时 import()。
 */
import { PluginError, type SimPlugin } from './gen/civ/engine/plugin';
import type { SimRead } from './gen/civ/simRead';
import type { QuickJSPlugin, QuickJSPluginSpec, SimSetup } from './gen/civ/quickjs/plugin';
import type { WorldPlugin } from './gen/worldFormat';
import type { OpenedPlugin } from './plugin/pluginFile';
import { undeclaredCommand } from './plugin/pluginSim';
import { openPluginFileFully } from './plugin/pluginSimTables';
import { simParamsOf, simPluginOf, type SimPluginFile } from './plugin/pluginWorld';

/** 装好一个插件(浏览器里经 import() 取 QuickJS 和它的 wasm,Node 里直接给) */
export type SimBoxer = (spec: QuickJSPluginSpec) => Promise<QuickJSPlugin>;

/** 一段推演带的推演插件 */
export interface SimPluginsOn {
  plugins: SimPlugin<SimRead>[];
  /** 世界清单里记它们的那几条(按出手的先后) */
  records: WorldPlugin[];
  dispose(): void;
}

/** 读过、核对过的插件文件(键 = 指纹) */
const opened = new Map<string, Promise<OpenedPlugin>>();
const OPENED_KEEP = 8;

function openOnce(f: SimPluginFile): Promise<OpenedPlugin> {
  let p = opened.get(f.sum);
  if (!p) {
    p = openPluginFileFully(f.bytes).then((o) => {
      if (o.sum !== f.sum) throw new Error(`推演插件 ${f.id} 的文件和指纹对不上`);
      return o;
    });
    opened.set(f.sum, p);
    p.catch(() => opened.delete(f.sum));
    while (opened.size > OPENED_KEEP) opened.delete(opened.keys().next().value!);
  }
  return p;
}

/** 插件文件读出来、核对:是推演插件、编号对得上 */
async function openSim(f: SimPluginFile): Promise<OpenedPlugin> {
  const o = await openOnce(f);
  if (o.manifest.id !== f.id) throw new Error(`推演插件 ${f.id} 的文件里是 ${o.manifest.id}`);
  if (o.manifest.role !== 'sim' || !o.manifest.sim) throw new Error(`${f.id} 不是推演插件`);
  return o;
}

/** 世界清单里记这几个推演插件的那几条(只读文件,不装) */
export async function simRecordsOf(files: readonly SimPluginFile[]): Promise<WorldPlugin[]> {
  const out: WorldPlugin[] = [];
  for (const f of files) {
    const o = await openSim(f);
    out.push(simPluginOf(o, simParamsOf(o.manifest.sim!.params, f.params)));
  }
  return out;
}

/** 装好这一段推演带的推演插件(按给的先后出手);seed = 文明种子。装不上抛错,装好的放掉 */
export async function simPluginsOn(files: readonly SimPluginFile[], seed: number, box: SimBoxer): Promise<SimPluginsOn> {
  const boxes: QuickJSPlugin[] = [];
  const dispose = () => boxes.splice(0).forEach((b) => b.dispose());
  try {
    const records: WorldPlugin[] = [];
    const plugins: SimPlugin<SimRead>[] = [];
    for (const f of files) {
      if (records.some((r) => r.id === f.id)) throw new Error(`推演插件 ${f.id} 给了两次`);
      const o = await openSim(f);
      const sim = o.manifest.sim!;
      const params = simParamsOf(sim.params, f.params);
      const { commands: declared, params: _p, ...rest } = sim;
      void _p;
      // 史事种类读插件文件时查过了(这一版不认得的读不进来)
      const setup = rest as SimSetup;
      const b = await box({ id: f.id, code: o.code, setup, params, seed });
      boxes.push(b);
      records.push(simPluginOf(o, params));
      plugins.push({
        ...setup,
        id: f.id,
        act(turn) {
          const reply = b.act(turn);
          const bad = reply?.commands && undeclaredCommand(declared, reply.commands);
          if (bad) throw new PluginError(f.id, bad);
          return reply;
        },
      });
    }
    return { plugins, records, dispose };
  } catch (e) {
    dispose();
    throw e;
  }
}

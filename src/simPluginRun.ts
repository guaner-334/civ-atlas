/**
 * 推演线程里装推演插件:插件文件(SimPluginFile)→ 关进 QuickJS 的插件,连同世界清单里记它的那一条。
 * 一段推演装一次、推完放掉:插件的全局变量不跨段带,接着推和从第 0 年推一样。只在世界用了推演插件时 import()。
 */
import { PluginError, type SimPlugin } from './gen/civ/engine/plugin';
import type { SimRead } from './gen/civ/simRead';
import type { QuickJSPlugin, QuickJSPluginSpec, SimSetup } from './gen/quickjs/sim';
import type { WorldPlugin } from './gen/worldFormat';
import { openPluginFile, type OpenedPlugin } from './plugin/pluginFile';
import { undeclaredCommand } from './plugin/pluginSim';
import { checkSimTables } from './plugin/pluginSimTables';
import { simParamsOf, simPluginOf, type SimPluginFile } from './plugin/pluginWorld';

/** 装好一个插件(浏览器里经 import() 取 QuickJS 和它的 wasm,Node 里直接给) */
export type SimBoxer = (spec: QuickJSPluginSpec) => Promise<QuickJSPlugin>;

/** 浏览器里:QuickJS 和它的 wasm 用到才下载 */
export const quickjsBox: SimBoxer = async (spec) => {
  const q = await import('./gen/quickjs');
  return q.quickjsPlugin(await q.quickjsWasm(), spec);
};

/** 一段推演带的推演插件 */
export interface SimPluginsOn {
  /** 装不上的(代码出错、表的公式不对)换成头一回出手就抛那个错的,推演停在那里、说是它 */
  plugins: SimPlugin<SimRead>[];
  /** 世界清单里记它们的那几条(按出手的先后) */
  records: WorldPlugin[];
  dispose(): void;
}

/** 读过、核对过的插件文件;tables = 表的公式哪里不对(没毛病 = null) */
interface Read {
  o: OpenedPlugin;
  tables: string | null;
}

/** 读过的插件文件(键 = 指纹) */
const opened = new Map<string, Promise<Read>>();
const OPENED_KEEP = 8;

function tablesProblem(o: OpenedPlugin): string | null {
  if (o.manifest.role !== 'sim' || !o.manifest.sim) return null;
  try {
    checkSimTables(o.manifest.sim);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function openOnce(f: SimPluginFile): Promise<Read> {
  let p = opened.get(f.sum);
  if (!p) {
    p = openPluginFile(f.bytes).then((o) => {
      if (o.sum !== f.sum) throw new Error(`推演插件 ${f.id} 的文件和指纹对不上`);
      return { o, tables: tablesProblem(o) };
    });
    opened.set(f.sum, p);
    p.catch(() => opened.delete(f.sum));
    while (opened.size > OPENED_KEEP) opened.delete(opened.keys().next().value!);
  }
  return p;
}

/** 插件文件读出来、核对:是推演插件、编号对得上 */
async function openSim(f: SimPluginFile): Promise<Read> {
  const r = await openOnce(f);
  const o = r.o;
  if (o.manifest.id !== f.id) throw new Error(`推演插件 ${f.id} 的文件里是 ${o.manifest.id}`);
  if (o.manifest.role !== 'sim' || !o.manifest.sim) throw new Error(`${f.id} 不是推演插件`);
  return r;
}

/** 世界清单里记这几个推演插件的那几条(只读文件,不装) */
export async function simRecordsOf(files: readonly SimPluginFile[]): Promise<WorldPlugin[]> {
  const out: WorldPlugin[] = [];
  for (const f of files) {
    const { o } = await openSim(f);
    out.push(simPluginOf(o, simParamsOf(o.manifest.sim!.params, f.params)));
  }
  return out;
}

/** 装不上的插件:设定照清单(接着推时和存下的状态对得上;表本身不对的不带设定),头一回出手就抛装的时候那个错 */
function cantLoad(id: string, err: PluginError, setup?: SimSetup): SimPlugin<SimRead> {
  return {
    ...setup,
    id,
    act() {
      throw err;
    },
  };
}

/**
 * 装好这一段推演带的推演插件(按给的先后出手);seed = 文明种子。
 * 插件自己的毛病(代码出错、表的公式不对)不抛,见 SimPluginsOn.plugins;文件对不上、给错了、QuickJS 下载不了的抛错,装好的放掉
 */
export async function simPluginsOn(files: readonly SimPluginFile[], seed: number, box: SimBoxer): Promise<SimPluginsOn> {
  const boxes: QuickJSPlugin[] = [];
  const dispose = () => boxes.splice(0).forEach((b) => b.dispose());
  try {
    const records: WorldPlugin[] = [];
    const plugins: SimPlugin<SimRead>[] = [];
    for (const f of files) {
      if (records.some((r) => r.id === f.id)) throw new Error(`推演插件 ${f.id} 给了两次`);
      const { o, tables } = await openSim(f);
      const sim = o.manifest.sim!;
      const params = simParamsOf(sim.params, f.params);
      const { commands: declared, params: _p, ...rest } = sim;
      void _p;
      // 史事种类读插件文件时查过了(这一版不认得的读不进来)
      const setup = rest as SimSetup;
      records.push(simPluginOf(o, params));
      if (tables !== null) {
        plugins.push(cantLoad(f.id, new PluginError(f.id, tables)));
        continue;
      }
      let b: QuickJSPlugin;
      try {
        b = await box({ id: f.id, code: o.code, setup, params, seed });
      } catch (e) {
        if (!(e instanceof PluginError)) throw e;
        plugins.push(cantLoad(f.id, e, setup));
        continue;
      }
      boxes.push(b);
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

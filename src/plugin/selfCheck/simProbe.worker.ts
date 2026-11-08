/// <reference lib="webworker" />
/**
 * 自检页「推演插件」一组的后台线程(和推演线程一样是一个后台线程,插件也是这样关进 QuickJS 跑的):
 * 先交 { sim }(一回合多久、散列),再交 { stack }(栈够不够);出错交 { error }
 */
import faithUrl from '../../../examples/plugins/faith/faith.civplugin?url';
import wearUrl from '../../../examples/plugins/weariness/weariness.civplugin?url';
import { quickjsPlugin } from '../../gen/quickjs/sim';
import { quickjsWasm } from '../../gen/quickjs/wasm';
import { openPluginFile } from '../pluginFile';
import type { SimPluginFile } from '../pluginWorld';
import { simProbe, stackProbe } from './simProbe';

async function fileOf(url: string): Promise<SimPluginFile> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`示例插件下载失败(${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const o = await openPluginFile(bytes);
  return { id: o.manifest.id, sum: o.sum, bytes };
}

const say = (m: unknown) => self.postMessage(m);

self.onmessage = async () => {
  try {
    const wasm = await quickjsWasm();
    const files = await Promise.all([fileOf(faithUrl), fileOf(wearUrl)]);
    say({ sim: await simProbe(files, (spec) => quickjsPlugin(wasm, spec)) });
    say({ stack: await stackProbe(wasm) });
  } catch (e) {
    say({ error: String((e as Error)?.message ?? e).slice(0, 200) });
  }
};

/// <reference lib="webworker" />
/** 自检页「地图插件」一组的后台线程(和生成线程一样关进 QuickJS 跑):交 { map };出错交 { error } */
import koppenUrl from '../../../examples/plugins/koppen/koppen.civplugin?url';
import { quickjsMapPlugin } from '../../gen/quickjs/map';
import { quickjsWasm } from '../../gen/quickjs/wasm';
import { openPluginFile } from '../pluginFile';
import { simParamsOf } from '../pluginWorld';
import { mapProbe } from './mapProbe';

const say = (m: unknown) => self.postMessage(m);

self.onmessage = async () => {
  try {
    const wasm = await quickjsWasm();
    const res = await fetch(koppenUrl);
    if (!res.ok) throw new Error(`示例插件下载失败(${res.status})`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const o = await openPluginFile(bytes);
    const params = simParamsOf(o.manifest.map?.params);
    say({ map: await mapProbe({ id: o.manifest.id, sum: o.sum, bytes, ...(Object.keys(params).length ? { params } : {}) }, (spec) => quickjsMapPlugin(wasm, spec)) });
  } catch (e) {
    say({ error: String((e as Error)?.message ?? e).slice(0, 200) });
  }
};

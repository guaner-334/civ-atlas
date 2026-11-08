/**
 * 生成线程里装地图插件:插件文件(MapPluginFile)→ 关进 QuickJS 的插件,连同世界清单里记它的那一条、它登记的图层画法。
 * 装好的按「同一个文件、同样的滑条」记着(MapPlugin.key),改地形每一笔不用重装;每一口都新开环境,所以记着的和新装的长出同一张图。
 * 只在请求带了地图插件时 import()。
 */
import type { MapPlugin } from './gen/mapHooks';
import { MapPluginLoadError, quickjsMapPlugin, type QuickJSMapPlugin, type QuickJSMapSpec } from './gen/quickjs/map';
import type { WorldPlugin } from './gen/worldFormat';
import { openPluginFile } from './plugin/pluginFile';
import type { MapLayerSpec } from './plugin/pluginMap';
import { mapPluginKey, mapPluginOf, simParamsOf, type MapPluginFile } from './plugin/pluginWorld';

/** 装好一个插件(浏览器里经 import() 取 QuickJS 和它的 wasm,Node 里直接给) */
export type MapBoxer = (spec: QuickJSMapSpec) => Promise<QuickJSMapPlugin>;

/** 浏览器里:QuickJS 的 wasm 用到才下载 */
export const quickjsMapBox: MapBoxer = async (spec) => quickjsMapPlugin(await (await import('./gen/quickjs/wasm')).quickjsWasm(), spec);

/** 装好的一个地图插件 */
export interface LoadedMap {
  plugin: QuickJSMapPlugin;
  /** 世界清单里记它的那一条(滑条补齐以后的) */
  record: WorldPlugin;
  /** 清单里登记的图层画法(按登记的先后) */
  looks: readonly MapLayerSpec[];
}

const loaded = new Map<string, Promise<LoadedMap>>();
const done = new Map<string, LoadedMap>();
/** 最多记几个(超了先放掉最久没用的) */
const KEEP = 8;

async function load(f: MapPluginFile & { bytes: Uint8Array }, key: string, box: MapBoxer): Promise<LoadedMap> {
  let o: Awaited<ReturnType<typeof openPluginFile>>;
  try {
    o = await openPluginFile(f.bytes);
  } catch (e) {
    throw new MapPluginLoadError(f.id, e instanceof Error ? e.message : String(e));
  }
  if (o.sum !== f.sum) throw new MapPluginLoadError(f.id, '文件和指纹对不上');
  if (o.manifest.id !== f.id) throw new MapPluginLoadError(f.id, `文件里是 ${o.manifest.id}`);
  const map = o.manifest.map;
  if (o.manifest.role !== 'map' || !map) throw new MapPluginLoadError(f.id, '不是地图插件');
  const params = simParamsOf(map.params, f.params);
  // 世界键、世界记的都按补齐的滑条认:没补齐的请求长出来的世界和清单对不上
  if (mapPluginKey({ id: f.id, sum: f.sum, params }) !== key) throw new MapPluginLoadError(f.id, '滑条要照清单补齐、压回上下限');
  const looks = map.layers ?? [];
  const setup = { stages: map.stages as QuickJSMapSpec['setup']['stages'], ...(looks.length ? { layerIds: looks.map((l) => l.id) } : {}) };
  let plugin: QuickJSMapPlugin;
  try {
    plugin = await box({ id: f.id, key, code: o.code, setup, params });
  } catch (e) {
    if (e instanceof MapPluginLoadError) throw e;
    throw new MapPluginLoadError(f.id, e instanceof Error ? e.message : String(e));
  }
  return { plugin, record: mapPluginOf(o, params), looks };
}

/** 放掉一个记着的(装好了的连 QuickJS 一起放) */
function drop(key: string): void {
  const p = loaded.get(key);
  loaded.delete(key);
  done.delete(key);
  void p?.then((l) => l.plugin.dispose()).catch(() => {});
}

/** 装不上的(键 = MapPlugin.key):下次带着它再装一遍 */
const failed = new Map<string, Error>();

/**
 * 装好这串地图插件里带了字节的(按 MapPlugin.key 记着,装过的不再装)。不抛错:装不上的记下(loadError),要长地图时才报;
 * 没带字节的跳过:loadedMap 拿不到它
 */
export async function loadMaps(files: readonly MapPluginFile[], box: MapBoxer): Promise<void> {
  const keys = files.map(mapPluginKey);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const key = keys[i];
    if (!f.bytes) continue;
    let p = loaded.get(key);
    if (p) loaded.delete(key);
    else {
      failed.delete(key);
      p = load({ ...f, bytes: f.bytes }, key, box);
      p.then(
        (l) => void (loaded.get(key) === p && done.set(key, l)),
        (e: unknown) => {
          if (loaded.get(key) !== p) return;
          drop(key);
          failed.set(key, e instanceof Error ? e : new Error(String(e)));
        },
      );
    }
    loaded.set(key, p);
    await p.catch(() => {});
  }
  for (const key of [...loaded.keys()]) {
    if (loaded.size <= KEEP) break;
    if (!keys.includes(key)) drop(key);
  }
}

/** 这一个装的时候出的错(没出错、没装过 = undefined) */
export const loadError = (key: string): Error | undefined => failed.get(key);

/** 装好了的(没装、还在装、装不上 = undefined) */
export const loadedMap = (key: string): LoadedMap | undefined => done.get(key);

/** 这个插件出过错:记着的都放掉,下次重装(QuickJS 出了收拾不了的错以后这一份一直报错) */
export function forgetMap(id: string): void {
  for (const [key, l] of [...done]) if (l.plugin.id === id) drop(key);
  for (const key of [...loaded.keys()]) if (key.startsWith(`${id}@`)) drop(key);
}

/** 交给生成用的那串(按先后);有没装好的 = null */
export function mapPluginsOf(keys: readonly string[]): MapPlugin[] | null {
  const out: MapPlugin[] = [];
  for (const k of keys) {
    const l = done.get(k);
    if (!l) return null;
    out.push(l.plugin);
  }
  return out;
}

/**
 * Node 里跑地图插件文件(.civplugin):打开、核对是地图插件,滑条照清单补齐、压进范围,关进 QuickJS(wasm 从磁盘读)。单测、试跑脚本用
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { MapStage } from '../../src/gen/mapHooks';
import { quickjsMapPlugin, type QuickJSMapPlugin, type QuickJSMapSpec } from '../../src/gen/quickjs/map';
import { openPluginFile, type OpenedPlugin } from '../../src/plugin/pluginFile';
import { simParamsOf } from '../../src/plugin/pluginWorld';
import { packPluginDir } from './pluginDir';
import { quickjsWasm } from './quickjsNode';

export interface MapFile {
  opened: OpenedPlugin;
  /** 拨到几(清单里每个滑条都有) */
  params: Record<string, number>;
}

/** 地图插件文件的字节 → 打开的插件;params 写了清单里没有的滑条算写错 */
export async function mapFileOf(bytes: Uint8Array, params?: Readonly<Record<string, number>>): Promise<MapFile> {
  const opened = await openPluginFile(bytes);
  const m = opened.manifest;
  if (m.role !== 'map' || !m.map) throw new Error(`${m.name} 不是地图插件(role 是 ${m.role})`);
  for (const k of Object.keys(params ?? {})) if (!m.map.params || !Object.prototype.hasOwnProperty.call(m.map.params, k)) throw new Error(`清单的 map.params 里没有 ${k}`);
  return { opened, params: simParamsOf(m.map.params, params) };
}

/** 文件夹(先打包)或插件文件 */
export async function openMapPlugin(path: string, params?: Readonly<Record<string, number>>): Promise<MapFile> {
  const bytes = existsSync(path) && statSync(path).isDirectory() ? (await packPluginDir(path)).bytes : new Uint8Array(readFileSync(path));
  return mapFileOf(bytes, params);
}

/** 关进 QuickJS(用完 dispose);键 = 编号 + 文件指纹 + 滑条 */
export function mapPluginInNode(f: MapFile, log?: QuickJSMapSpec['log']): Promise<QuickJSMapPlugin> {
  const m = f.opened.manifest;
  const map = m.map!;
  return quickjsMapPlugin(quickjsWasm(), {
    id: m.id,
    key: `${m.id}@${f.opened.sum}${Object.keys(f.params).length ? JSON.stringify(f.params) : ''}`,
    code: f.opened.code,
    setup: { stages: map.stages as MapStage[], ...(map.layers?.length ? { layerIds: map.layers.map((l) => l.id) } : {}) },
    params: f.params,
    ...(log ? { log } : {}),
  });
}

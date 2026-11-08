/**
 * Node 里跑推演插件文件(.civplugin):装法和推演线程同一份(src/simPluginRun.ts),QuickJS 的 wasm 从磁盘读。单测、试跑脚本用
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { quickjsPlugin } from '../../src/gen/civ/quickjs/plugin';
import type { OpenedPlugin } from '../../src/plugin/pluginFile';
import { openPluginFileFully } from '../../src/plugin/pluginSimTables';
import type { SimPluginFile } from '../../src/plugin/pluginWorld';
import { simPluginsOn, type SimBoxer, type SimPluginsOn } from '../../src/simPluginRun';
import { packPluginDir } from './pluginDir';
import { quickjsWasm } from './quickjsNode';

const box: SimBoxer = (spec) => quickjsPlugin(quickjsWasm(), spec);

/** 推演插件文件的字节 → 打开的插件、交给推演的那份文件;params 写了清单里没有的滑条算写错 */
export async function simFileOf(bytes: Uint8Array, params?: Readonly<Record<string, number>>): Promise<{ opened: OpenedPlugin; file: SimPluginFile }> {
  const opened = await openPluginFileFully(bytes);
  const m = opened.manifest;
  if (m.role !== 'sim' || !m.sim) throw new Error(`${m.name} 不是推演插件(role 是 ${m.role})`);
  for (const k of Object.keys(params ?? {})) if (!m.sim.params || !Object.prototype.hasOwnProperty.call(m.sim.params, k)) throw new Error(`清单的 sim.params 里没有 ${k}`);
  return { opened, file: { id: m.id, sum: opened.sum, bytes, ...(params ? { params: { ...params } } : {}) } };
}

/** 文件夹(先打包)或插件文件 */
export async function openSimPlugin(path: string, params?: Readonly<Record<string, number>>): Promise<{ opened: OpenedPlugin; file: SimPluginFile }> {
  const bytes = existsSync(path) && statSync(path).isDirectory() ? (await packPluginDir(path)).bytes : new Uint8Array(readFileSync(path));
  return simFileOf(bytes, params);
}

/** 装好这一段推演带的推演插件(和推演线程一样;用完 dispose) */
export const simPluginsInNode = (files: readonly SimPluginFile[], seed: number): Promise<SimPluginsOn> => simPluginsOn(files, seed, box);

/**
 * Node 里把推演插件文件(.civplugin)关进 QuickJS 跑:清单的 sim 段当设定,滑条没给的取默认值;
 * 回话里下了清单 sim.commands 没写的命令算插件出错。单测、试跑脚本用
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { PluginError, type PluginReply } from '../../src/gen/civ/engine/plugin';
import { quickjsPlugin, type QuickJSPlugin, type SimSetup } from '../../src/gen/civ/quickjs/plugin';
import { openPluginFile, type OpenedPlugin } from '../../src/plugin/pluginFile';
import { undeclaredCommand, type SimManifest } from '../../src/plugin/pluginSim';
import { packPluginDir } from './pluginDir';
import { quickjsWasm } from './quickjsNode';

/** 文件夹(先打包)或插件文件 → 打开的插件 */
export async function openSimPlugin(path: string): Promise<OpenedPlugin> {
  const bytes = existsSync(path) && statSync(path).isDirectory() ? (await packPluginDir(path)).bytes : new Uint8Array(readFileSync(path));
  const p = await openPluginFile(bytes);
  if (p.manifest.role !== 'sim') throw new Error(`${p.manifest.name} 不是推演插件(role 是 ${p.manifest.role})`);
  return p;
}

/** 清单的 sim 段里交给推演的那几样(滑条、会下哪几种命令推演不管) */
export function simSetupOf(sim: SimManifest): SimSetup {
  const { params: _params, commands: _commands, ...setup } = sim;
  return setup as SimSetup;
}

/** 滑条拨到几:清单里的默认值,给了的换上 */
export function simParamsOf(sim: SimManifest, given: Readonly<Record<string, number>> = {}): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, p] of Object.entries(sim.params ?? {})) out[k] = Object.prototype.hasOwnProperty.call(given, k) ? given[k] : p.default;
  for (const k of Object.keys(given)) if (!(k in out)) throw new Error(`清单的 sim.params 里没有 ${k}`);
  return out;
}

/** 打开的推演插件 → 文明种子 seed 上跑的 QuickJS 插件(用完 dispose) */
export async function simPluginOf(p: OpenedPlugin, seed: number, params?: Readonly<Record<string, number>>): Promise<QuickJSPlugin> {
  const sim = p.manifest.sim!;
  const q = await quickjsPlugin(quickjsWasm(), { id: p.manifest.id, code: p.code, setup: simSetupOf(sim), params: simParamsOf(sim, params), seed });
  return {
    ...q,
    act(turn) {
      const reply = q.act(turn) as PluginReply | undefined;
      const bad = reply?.commands ? undeclaredCommand(sim.commands, reply.commands) : null;
      if (bad) throw new PluginError(p.manifest.id, bad);
      return reply;
    },
  };
}

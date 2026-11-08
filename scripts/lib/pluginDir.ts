/**
 * 插件文件夹 → 插件文件(.civplugin)的字节。文件夹里:
 *
 *   plugin.json   清单里作者写的那几项(PLUGIN_DIR_KEYS);app、kind、format、entry、files 由打包填
 *   main.js、README.md、LICENSE,可选 icon.png   原样装进去
 *
 * 别的文件不管。打出来照网站读插件的规矩核对过,不合格抛 PluginFileError。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packPluginFile, PLUGIN_FILES, type PluginPackInput } from '../../src/plugin/pluginFile';

export const PLUGIN_DIR_MANIFEST = 'plugin.json';
export const PLUGIN_DIR_KEYS: readonly string[] = ['id', 'name', 'version', 'role', 'api', 'runtime', 'requires', 'optional', 'why', 'description', 'license', 'author'];
const FILLED = ['app', 'kind', 'format', 'entry', 'files'];

/** patch = 打包前改清单里的几项(开发用的假服务器拿示例插件打别的版本) */
export async function packPluginDir(dir: string, patch: Record<string, unknown> = {}): Promise<{ id: string; bytes: Uint8Array }> {
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(readFileSync(join(dir, PLUGIN_DIR_MANIFEST), 'utf8'));
  } catch (e) {
    throw new Error(`读不了 ${PLUGIN_DIR_MANIFEST}:${(e as Error).message}`);
  }
  for (const k of Object.keys(manifest)) {
    if (FILLED.includes(k)) throw new Error(`${PLUGIN_DIR_MANIFEST} 里不用写 ${k},打包时自动填`);
    if (!PLUGIN_DIR_KEYS.includes(k)) throw new Error(`${PLUGIN_DIR_MANIFEST} 里的 ${k} 不认得,能写的有 ${PLUGIN_DIR_KEYS.join('、')}`);
  }
  const files: Record<string, Uint8Array> = {};
  for (const path of PLUGIN_FILES.keys()) {
    const p = join(dir, path);
    if (existsSync(p)) files[path] = new Uint8Array(readFileSync(p));
  }
  manifest = { ...manifest, ...patch };
  const bytes = await packPluginFile({ manifest: manifest as unknown as PluginPackInput['manifest'], files });
  return { id: String(manifest.id), bytes };
}

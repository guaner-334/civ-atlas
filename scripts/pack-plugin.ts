/**
 * 把插件文件夹打成插件文件(文件夹里放什么见 lib/pluginDir.ts,写插件见 docs/plugins/):
 *
 *   npx tsx scripts/pack-plugin.ts examples/plugins/route-days            # 写到文件夹里的 route-days.civplugin
 *   npx tsx scripts/pack-plugin.ts <文件夹> <输出文件>
 *
 * 打出来先照网站读插件的规矩核对一遍;不合格的打印哪里不对,退出码 1。
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLUGIN_FILE_EXT } from '../src/plugin/pluginFile';
import { packPluginDir } from './lib/pluginDir';

const [dir, out] = process.argv.slice(2);
if (!dir) {
  console.error('用法:npx tsx scripts/pack-plugin.ts <插件文件夹> [输出文件]');
  process.exit(1);
}
try {
  const { id, bytes } = await packPluginDir(dir);
  const file = out ?? join(dir, `${id}${PLUGIN_FILE_EXT}`);
  writeFileSync(file, bytes);
  console.log(`打好了:${file}(${(bytes.length / 1024).toFixed(1)} KB)`);
  console.log(`指纹 ${createHash('sha256').update(bytes).digest('hex')}`);
} catch (e) {
  console.error(`没打成:${(e as Error).message}`);
  process.exit(1);
}

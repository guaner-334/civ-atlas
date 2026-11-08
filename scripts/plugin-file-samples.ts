/**
 * 把插件文件的样本(tests/lib/pluginFileSample.ts)写进 tests/fixtures/plugin-file/:
 *
 *   npx tsx scripts/plugin-file-samples.ts
 *
 * index.json 列着每个文件该读出什么:kind 是 ok(好的)、broken(坏了)或 newer(要更新网站),why 是错在哪。
 * 太大的几个不写。只覆盖同名文件,样本表里删掉的旧文件要自己删。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLUGIN_FILE_EXT } from '../src/plugin/pluginFile';
import { PLUGIN_SAMPLES, goodPlugin, goodSimPlugin } from '../tests/lib/pluginFileSample';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'plugin-file');
mkdirSync(dir, { recursive: true });

const index: { file: string; kind: string; why: string }[] = [];
const write = (name: string, bytes: Uint8Array, kind: string, why: string) => {
  const file = `${name}${PLUGIN_FILE_EXT}`;
  writeFileSync(join(dir, file), bytes);
  index.push({ file, kind, why });
};

write('good', await goodPlugin(), 'ok', '好的插件文件,每个字段、每个文件都有');
write('good-sim', await goodSimPlugin(), 'ok', '好的推演插件,sim 段每一项都有');
for (const s of PLUGIN_SAMPLES) if (!s.big) write(s.name, await s.build(), s.kind, s.why);
writeFileSync(join(dir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`写了 ${index.length} 个样本到 ${dir}`);

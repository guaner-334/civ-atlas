/**
 * 示例插件(examples/plugins/):重新打包和仓库里的插件文件一个字节不差,许可证是 MIT,
 * 代码里用到的调用、事件清单里都要了,清单要的能力代码里都用到了。
 * 在真沙箱里跑出来的面板、图层和存下的对不对得上,见 scripts/sandbox-check.ts。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PLUGIN_EVENTS, PLUGIN_METHODS } from '../src/plugin/caps';
import { openPluginFile, PLUGIN_FILE_EXT } from '../src/plugin/pluginFile';
import { packPluginDir } from '../scripts/lib/pluginDir';

const ROOT = fileURLToPath(new URL('../examples/plugins/', import.meta.url));
const EXAMPLES = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe('示例插件', () => {
  it('三个示例都在', () => {
    expect(EXAMPLES).toEqual(['box-summary', 'coast-distance', 'route-days']);
  });

  describe.each(EXAMPLES)('%s', (name) => {
    const dir = join(ROOT, name);
    const committed = () => new Uint8Array(readFileSync(join(dir, `${name}${PLUGIN_FILE_EXT}`)));

    it('重新打包和仓库里的插件文件一样(改了示例要重新打包:npx tsx scripts/pack-plugin.ts <文件夹>)', async () => {
      const { id, bytes } = await packPluginDir(dir);
      expect(id).toBe(name);
      expect(Buffer.from(bytes).equals(Buffer.from(committed()))).toBe(true);
    });

    it('网站打得开,许可证是 MIT', async () => {
      const p = await openPluginFile(committed());
      expect(p.manifest.license).toBe('MIT');
      expect(new TextDecoder().decode(p.files.get('LICENSE'))).toMatch(/^MIT License\n/);
    });

    it('用到的调用、事件清单里都要了,要的能力都用到了', async () => {
      const { manifest, code } = await openPluginFile(committed());
      const caps = [...manifest.requires, ...(manifest.optional ?? [])];
      const used = new Set<string>();
      const calls = [...code.matchAll(/civAtlas\.((?:[a-z]+\.)+[a-z]+)\(/gi)].map((m) => m[1]);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) {
        expect(Object.prototype.hasOwnProperty.call(PLUGIN_METHODS, c), `没有 ${c} 这个调用`).toBe(true);
        const need = PLUGIN_METHODS[c];
        const have = need.filter((x) => caps.includes(x));
        expect(need.length === 0 || have.length > 0, `${c} 要 ${need.join(' 或 ')}`).toBe(true);
        have.forEach((x) => used.add(x));
      }
      for (const [, e] of code.matchAll(/civAtlas\.on\('([a-z.]+)'/g)) {
        const need = PLUGIN_EVENTS[e];
        expect(need && caps.includes(need), `事件 ${e} 要 ${need}`).toBe(true);
        used.add(need);
      }
      expect(caps.filter((c) => !used.has(c))).toEqual([]);
    });
  });
});

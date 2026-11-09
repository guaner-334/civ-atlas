/**
 * 自检页「地图插件」一组(src/plugin/selfCheck/mapProbe.ts):在 Node 里跑和手机上同一份,散列要等于钉住的 MAP_PROBE_SUM。
 * 改了生成或示例插件「柯本气候」,散列跟着变:PRINT_PINS=1 跑一遍,照打出来的换掉 MAP_PROBE_SUM
 */
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { quickjsMapPlugin } from '../src/gen/quickjs/map';
import { openPluginFile } from '../src/plugin/pluginFile';
import { simParamsOf } from '../src/plugin/pluginWorld';
import { mapProbe } from '../src/plugin/selfCheck/mapProbe';
import { MAP_PROBE_SUM, mapRows, report, type Raw } from '../src/plugin/selfCheck/verdict';
import { quickjsWasm } from '../scripts/lib/quickjsNode';

const FILE = join(fileURLToPath(new URL('../examples/plugins/', import.meta.url)), 'koppen', 'koppen.civplugin');

describe('自检页的地图插件一组', () => {
  it('示例插件柯本气候长一张 3.6 万块地的图:量它多花多久;散列和钉住的一样', async () => {
    const bytes = new Uint8Array(readFileSync(FILE));
    const o = await openPluginFile(bytes);
    const params = simParamsOf(o.manifest.map?.params);
    const r = await mapProbe({ id: o.manifest.id, sum: o.sum, bytes, ...(Object.keys(params).length ? { params } : {}) }, (spec) => quickjsMapPlugin(quickjsWasm(), spec));
    if (process.env.PRINT_PINS) console.log('MAP_PROBE_SUM', r.sum, 'ms', r.ms, 'genMs', r.genMs);
    expect(r.cells).toBe(36000);
    expect(r.ms).toBeGreaterThan(0);
    expect(r.sum).toBe(MAP_PROBE_SUM);
    expect(r.same).toBe(true);
  }, 120_000);

  it('那一组的两行:多花多久(对照电脑上)、和电脑上一样不一样;慢的、不一样的标出来;复制结果带这一组', () => {
    const raw: Raw = { escapedTop: false, map: { ms: 412.3, genMs: 1900, cells: 36000, sum: MAP_PROBE_SUM, same: true } };
    expect(mapRows(raw).map((r) => [r.label, r.state, r.result, r.why])).toEqual([
      ['长一张图多花多久', 'ok', '0.4 秒', '示例插件「柯本气候」长 3.6 万块地的一张图；电脑上约 0.1 秒'],
      ['长出来的图和电脑上一样', 'ok', '一样', ''],
    ]);
    const bad = mapRows({ ...raw, map: { ...raw.map!, ms: 1500, same: false, sum: 'ffff' } } as Raw);
    expect(bad.map((r) => [r.state, r.result])).toEqual([
      ['slow', '1.5 秒'],
      ['bad', '不一样'],
    ]);
    expect(bad[0].why).toBe('示例插件「柯本气候」长 3.6 万块地的一张图；电脑上约 0.1 秒。用了地图插件的世界在这台上新建、改地形会慢一些');
    expect(bad[1].why).toBe('同一个世界在这台上长出来的地图和电脑上不一样');
    expect(mapRows({ escapedTop: false }).map((r) => r.state)).toEqual(['run', 'run']);
    expect(mapRows({ escapedTop: false, map: { error: 'boom' } }).map((r) => r.state)).toEqual(['err', 'err']);
    const text = report([], raw, { when: new Date(2026, 10, 9, 15, 0), url: 'u', device: 'd', ua: 'ua', site: 's' });
    expect(text).toContain('地图插件（只量，不算进全部通过）\n✓ 长一张图多花多久：0.4 秒');
  });
});

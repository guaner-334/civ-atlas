/**
 * 自检页「推演插件」一组(src/plugin/selfCheck/simProbe.ts):在 Node 里跑和手机上同一份,散列要等于钉住的 SIM_PROBE_SUM
 * (手机上推出来的和它比);QuickJS 的栈在这里是 QuickJS 自己先停。
 * 改了推演或示例插件,散列跟着变:PRINT_PINS=1 跑一遍,照打出来的换掉 SIM_PROBE_SUM
 */
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { quickjsPlugin } from '../src/gen/civ/quickjs/plugin';
import { PLUGIN_FILE_EXT } from '../src/plugin/pluginFile';
import { simProbe, stackProbe } from '../src/plugin/selfCheck/simProbe';
import { SIM_PROBE_SUM, simRows, type Raw } from '../src/plugin/selfCheck/verdict';
import type { SimBoxer } from '../src/simPluginRun';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { openSimPlugin } from '../scripts/lib/simPluginFile';

const ROOT = fileURLToPath(new URL('../examples/plugins/', import.meta.url));
const box: SimBoxer = (spec) => quickjsPlugin(quickjsWasm(), spec);
const file = async (name: string) => (await openSimPlugin(join(ROOT, name, `${name}${PLUGIN_FILE_EXT}`))).file;

describe('自检页的推演插件一组', () => {
  it('两个示例插件推 1000 年:宗教生效取 200 回合左右的中间值,估 3000 年;散列和钉住的一样', async () => {
    const r = await simProbe([await file('faith'), await file('weariness')], box);
    if (process.env.PRINT_PINS) console.log('SIM_PROBE_SUM', r.sum);
    expect(r.faithTurns).toBe(201);
    expect(r.faithMs).toBeGreaterThan(0);
    expect(r.estSec).toBeGreaterThan(0);
    expect(r.sum).toBe(SIM_PROBE_SUM);
    expect(r.same).toBe(true);
  }, 180_000);

  it('QuickJS 的栈:QuickJS 自己先停下', async () => {
    const s = await stackProbe(quickjsWasm());
    expect(s.by).toBe('quickjs');
    expect(s.depth).toBeGreaterThan(100);
  });

  it('那一组的几行:一回合多久(估 3000 年几秒)、和电脑上一样不一样、栈够不够;慢的、不一样的、不够的标出来', () => {
    const raw: Raw = {
      escapedTop: false,
      sim: { faithMs: 3.4, faithTurns: 201, wearMs: 0.3, yearMs: 1.6, estSec: 26.3, genMs: 2000, civMs: 2500, sum: SIM_PROBE_SUM, same: true },
      stack: { depth: 812, by: 'quickjs', note: 'stack overflow' },
    };
    expect(simRows(raw).map((r) => [r.label, r.state, r.result, r.why])).toEqual([
      ['算一回合要多久', 'ok', '3.4 毫秒', '示例插件「宗教生效」跑 201 回合取中间；照这个，带两个示例插件推 3000 年约 26 秒'],
      ['推出来的和电脑上一样', 'ok', '一样', ''],
      ['插件调用能套多深', 'ok', '812 层', ''],
    ]);
    const slow = simRows({ ...raw, sim: { ...raw.sim!, faithMs: 20, estSec: 180, same: false, sum: 'ffff' }, stack: { depth: 0, by: 'thread', note: 'RangeError: Maximum call stack size exceeded' } });
    expect(slow.map((r) => [r.state, r.result])).toEqual([
      ['slow', '20 毫秒'],
      ['bad', '不一样'],
      ['bad', '不够'],
    ]);
    expect(slow[0].why).toBe('示例插件「宗教生效」跑 201 回合取中间；照这个，带两个示例插件推 3000 年约 3 分钟，用了推演插件的世界会推得很慢');
    expect(simRows({ escapedTop: false }).map((r) => r.state)).toEqual(['run', 'run', 'run']);
  });
});

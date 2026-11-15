/**
 * 推演插件放宽的几条上限:表 32 张 128 栏、小本子约 1 MB、一次 256 条命令、QuickJS 的栈 256 KB。
 * 顶到上限的推得下去、存得下、读回来核对得过、接得上;过了上限停下说是哪个插件
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startContinue, type Civ } from '../src/gen/civ';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { PLUGIN_LIMITS, type PluginNote, type SimPlugin } from '../src/gen/civ/engine/plugin';
import type { TableCard } from '../src/gen/civ/engine/tables';
import type { SimRead } from '../src/gen/civ/simRead';
import { validateSimState } from '../src/gen/worldValidate';
import { quickjsPlugin } from '../src/gen/quickjs/sim';
import { quickjsWasm } from '../scripts/lib/quickjsNode';

let world: World | undefined;
const worldOf = () => (world ??= generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 }));
const roundTrip = (c: Civ) => unpackValue(packValue(c)) as Civ;
const bytes = (v: unknown) => Buffer.from(packValue(v));

/** 小本子里 n 个数(一个数算 8 字节,数组本身也算一个) */
const noteOf = (n: number, year: number): PluginNote => Array.from({ length: n }, (_, i) => (i * 7 + year) % 1000);

describe('放宽的上限', () => {
  it('表:32 张、一共 128 栏推得下去、接得上;多一张、多一栏装的时候就停下', () => {
    const w = worldOf();
    const tables: TableCard[] = Array.from({ length: 32 }, (_, i) => ({ id: `t${i}`, name: `表${i}`, unit: 'region', every: 20, min: 0, max: 100, init: 1, off: 0, cols: ['a', 'b', 'c', 'd'], rate: `0.01 * (50 - t${i})` }));
    const plugin: SimPlugin<SimRead> = { id: 'wide', every: 100, tables, act: () => {} };
    const one = generateCiv(w, { endYear: 600, plugins: [plugin] });
    expect(Object.keys(one.simPlugins![0].tables!.tables)).toHaveLength(32);
    expect(() => validateSimState(one.simPlugins![0], 'wide')).not.toThrow();
    const run = startContinue(w, roundTrip(generateCiv(w, { endYear: 300, plugins: [plugin] })), { endYear: 600, plugins: [plugin] });
    expect(bytes(run!.finish().simPlugins).equals(bytes(one.simPlugins))).toBe(true);
    const more = { ...tables[0], id: 'extra', cols: undefined };
    expect(() => generateCiv(w, { endYear: 5, plugins: [{ ...plugin, tables: [...tables, more] }] })).toThrow(/最多 32 张表/);
    expect(() => generateCiv(w, { endYear: 5, plugins: [{ ...plugin, tables: tables.map((t, i) => (i ? t : { ...t, cols: ['a', 'b', 'c', 'd', 'e'] })) }] })).toThrow(/最多 128 栏/);
  }, 120_000);

  it('小本子:约 1 MB 存得下、读回来核对得过;多一点停下', () => {
    const w = worldOf();
    const n = 1024 * 128 - 1;
    const keeper = (k: number): SimPlugin<SimRead> => ({ id: 'big', every: 100, act: (t) => ({ note: noteOf(k, t.year) }) });
    const civ = generateCiv(w, { endYear: 300, plugins: [keeper(n)] });
    expect((civ.simPlugins![0].note as number[]).length).toBe(n);
    expect(() => validateSimState(roundTrip(civ).simPlugins![0], 'big')).not.toThrow();
    expect(() => generateCiv(w, { endYear: 10, plugins: [keeper(n + 1)] })).toThrow(/小本子超过 1048576 字节/);
  }, 60_000);

  it('命令:一次 256 条照收;挡下的第 255 条存得下、核对得过,第 256 条不算数', () => {
    const w = worldOf();
    const plugin: SimPlugin<SimRead> = {
      id: 'many',
      every: 100,
      act(t) {
        const alive = t.read.polities().filter((p) => p.ended === undefined && p.size > 0);
        if (t.note === 1 || alive.length < 3) return;
        return { note: 1, commands: Array.from({ length: 256 }, (_, i) => ({ kind: 'ally', a: alive[i % 2].id, b: alive[2 + (i % (alive.length - 2))].id })) };
      },
    };
    const civ = generateCiv(w, { endYear: 1500, plugins: [plugin] });
    expect((civ.interventions ?? []).filter((v) => v.plugin === 'many').length).toBeGreaterThan(PLUGIN_LIMITS.commands / 4);
    const s = roundTrip(civ).simPlugins![0];
    expect(() => validateSimState(s, 'many')).not.toThrow();
    expect(() => validateSimState({ ...s, refused: [{ kind: 'declare', index: 255, why: 'halt' }] }, 'many')).not.toThrow();
    expect(() => validateSimState({ ...s, refused: [{ kind: 'declare', index: 256, why: 'halt' }] }, 'many')).toThrow(/refused/);
  }, 60_000);

  it('QuickJS 的栈:递归一千层推得下去(栈 64 KB 时三百多层就满了)', async () => {
    const code = 'const f = (n) => (n === 0 ? 0 : 1 + f(n - 1));\ncivAtlas.sim({ act(turn) { return { note: f(1000) }; } });';
    const p = await quickjsPlugin(quickjsWasm(), { id: 'deep', code, seed: 7, setup: { every: 100 } });
    try {
      const civ = generateCiv(worldOf(), { endYear: 100, plugins: [p] });
      expect(civ.simPlugins![0].note).toBe(1000);
    } finally {
      p.dispose();
    }
    const small = await quickjsPlugin(quickjsWasm(), { id: 'deep', code, seed: 7, setup: { every: 100 }, limits: { stack: 64 * 1024 } });
    try {
      expect(() => generateCiv(worldOf(), { endYear: 100, plugins: [small] })).toThrow(/deep/);
    } finally {
      small.dispose();
    }
  }, 60_000);
});

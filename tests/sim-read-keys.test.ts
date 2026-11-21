/**
 * 推演插件读口补齐:
 * - read.regions().keys:每州稳定键(非空、互异、和命令解析及工具插件 history.regions() 一致,跨地形大事保持身份)
 * - turn.chronicleLeft:出手开始时还能写几句编年史(按插件独立计数、存档续推接上、边界 1/0 照旧报错)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, startCiv, startContinue, type Civ } from '../src/gen/civ';
import { resumeCiv } from '../src/gen/civ/modules';
import { simRead, type SimRead } from '../src/gen/civ/simRead';
import { commandTaker } from '../src/gen/civ/commands';
import { interventionModelOf } from '../src/gen/civ/interventions';
import { CHRONICLE_LIMITS } from '../src/gen/civ/engine/pluginChronicle';
import { PluginError, type PluginTurn, type SimPlugin } from '../src/gen/civ/engine/plugin';
import { keyCells, regionOfKey, type Upheaval } from '../src/gen/edits';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { historyRegions } from '../src/plugin/read';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { quickjsPlugin } from '../src/gen/quickjs/sim';
import { quickjsWasm } from '../scripts/lib/quickjsNode';

const PARAMS = { ...DEFAULT_PARAMS, cells: 12000, seed: 7 };
let cachedWorld: World | null = null;
const world = () => (cachedWorld ??= generateWorld(PARAMS));

/** 在海洋深处找一块离陆地远的地块,抬成海岛以便产生新州 */
function openOceanPoint(w: World): [number, number] {
  const { x, y, n } = w.mesh;
  const land: number[] = [];
  for (let i = 0; i < n; i++) if (w.water[i] === 0) land.push(i);
  let best = -1;
  let bestDist = -1;
  for (let i = 0; i < n; i += 7) {
    if (w.water[i] === 0) continue;
    let dMin = Infinity;
    for (let k = 0; k < land.length; k += 13) {
      const j = land[k];
      const dx = Math.abs(x[i] - x[j]);
      const d = Math.hypot(Math.min(dx, w.width - dx), y[i] - y[j]);
      if (d < dMin) dMin = d;
    }
    if (dMin > bestDist) {
      bestDist = dMin;
      best = i;
    }
  }
  return [x[best], y[best]];
}

describe('read.regions().keys', () => {
  it('长度、非空、唯一性;每个键拿去下认州命令都解析回该州,且与 history.regions() 一致', () => {
    const w = world();
    const civ = generateCiv(w, { endYear: 600 });
    const sim = resumeCiv(w, civ);
    const read = simRead(sim)!;
    const reg = read.regions();
    const R = reg.count;

    expect(R).toBeGreaterThan(0);
    expect(reg.keys).toHaveLength(R);
    expect(new Set(reg.keys).size).toBe(R);
    for (let r = 0; r < R; r++) {
      expect(typeof reg.keys[r]).toBe('string');
      expect(reg.keys[r].length).toBeGreaterThan(0);
    }

    // 交出去的是复制的一份:改动不影响下次读取
    const copy = reg.keys.slice();
    reg.keys[0] = 'mutated';
    reg.keys.push('extra');
    expect(read.regions().keys).toEqual(copy);

    // 推完那一刻与工具插件 history.regions() 的 key 逐项一致
    expect(copy).toEqual(historyRegions(civ, {}).map((x) => x.key));

    // 每个 keys[r] 都能直接用于认州命令(划中立地),且由命令解析器解析回州 r
    const alive = read.polities().filter((p) => p.ended === undefined && p.size > 0);
    expect(alive.length).toBeGreaterThanOrEqual(2);
    const [p0, p1] = [alive[0].id, alive[1].id];
    const take = commandTaker(sim, civ.seed);
    for (let r = 0; r < R; r++) {
      const k = copy[r];
      expect(regionOfKey(k, keyCells(civ.regions)), `州 ${r} 键 ${k}`).toBe(r);
      const beforeLen = interventionModelOf(sim)?.list.length ?? 0;
      take('key-check', [{ kind: 'neutral', a: p0, region: k, ps: [p1] }], sim.now + 1 / 256);
      const iv = interventionModelOf(sim)!;
      expect(iv.list.length).toBe(beforeLen + 1);
      const added = iv.list[iv.list.length - 1];
      expect(added.kind).toBe('neutral');
      if (added.kind === 'neutral') expect(regionOfKey(added.region, iv.of)).toBe(r);
    }
  }, 60_000);

  it('推演中拿 read.regions().keys[r] 下划中立地命令,实际落在该州 r', () => {
    const w = world();
    let targetRegion = -1;
    let targetKey = '';
    let seenZoneRegion = -1;
    const plugin: SimPlugin<SimRead> = {
      id: 'zone-by-key',
      every: 20,
      act(turn) {
        if (targetRegion < 0 && turn.year >= 300) {
          const ps = turn.read.polities().filter((p) => p.ended === undefined && p.size >= 2);
          if (ps.length >= 2) {
            const owner = turn.read.owners('polity');
            const ss = turn.read.settlements();
            const a = ps[0];
            const b = ps[1];
            const capRegion = ss[a.capital].region;
            const reg = turn.read.regions();
            for (let r = 0; r < reg.count; r++) {
              if (owner[r] === a.id && r !== capRegion) {
                targetRegion = r;
                targetKey = reg.keys[r];
                return { commands: [{ kind: 'neutral', a: a.id, region: targetKey, ps: [b.id] }] };
              }
            }
          }
        } else if (targetRegion >= 0 && seenZoneRegion < 0) {
          const z = turn.read.pacts().zones.find((x) => x.region === targetRegion);
          if (z) seenZoneRegion = z.region;
        }
        return undefined;
      },
    };
    const civ = generateCiv(w, { endYear: 500, plugins: [plugin] });
    expect(targetRegion).toBeGreaterThanOrEqual(0);
    expect(seenZoneRegion).toBe(targetRegion);
    const cmd = (civ.interventions ?? []).find((v) => v.plugin === 'zone-by-key' && v.kind === 'neutral');
    expect(cmd).toBeDefined();
    if (cmd && cmd.kind === 'neutral') expect(cmd.region).toBe(targetKey);
  }, 60_000);

  it('跨地形大事:原有州键不变且仍解析回原州(含换治所、全沉),新州键不重且解析回自身', () => {
    const w = world();
    const base = generateCiv(w, { endYear: 400 });
    // 找一块有多个邻州的陆地作下沉区(既淹没整州,也让相邻残州换治所),再在远海抬出新岛
    const seat0 = base.regions.seat[Math.floor(base.regions.count / 3)];
    const [sx, sy] = [w.mesh.x[seat0], w.mesh.y[seat0]];
    const [rx, ry] = openOceanPoint(w);
    const upheaval: Upheaval = {
      year: 200,
      ops: [
        { kind: 'sink', pts: [sx, sy, sx + 45, sy + 20], r: 75, s: 1.4 },
        { kind: 'raise', pts: [rx, ry, rx + 70, ry + 30], r: 85, s: 1.5 },
      ],
    };
    const steps = upheavalSteps(PARAMS, [], null, [upheaval]);

    let before: { count: number; keys: string[]; seat: Int32Array } | null = null;
    let after: { count: number; keys: string[]; seat: Int32Array; area: Float64Array } | null = null;
    let issuedOldKey = '';
    let issuedOldRegion = -1;
    let issuedNewKey = '';
    let issuedNewRegion = -1;

    const spy: SimPlugin<SimRead> = {
      id: 'upheaval-keys',
      every: 20,
      act(turn) {
        const reg = turn.read.regions();
        if (turn.year === 180) {
          before = { count: reg.count, keys: reg.keys.slice(), seat: reg.seat.slice() };
        } else if (turn.year === 220 && before) {
          after = { count: reg.count, keys: reg.keys.slice(), seat: reg.seat.slice(), area: reg.area.slice() };
          const shifted = Array.from({ length: before.count }, (_, r) => r).find((r) => reg.area[r] > 0 && reg.seat[r] !== before!.seat[r]);
          const cmds: unknown[] = [];
          if (shifted !== undefined) {
            issuedOldRegion = shifted;
            issuedOldKey = before.keys[shifted];
            cmds.push({ kind: 'disaster', type: 'quake', level: 1, region: issuedOldKey });
          }
          if (reg.count > before.count) {
            issuedNewRegion = before.count;
            issuedNewKey = reg.keys[before.count];
            cmds.push({ kind: 'disaster', type: 'quake', level: 1, region: issuedNewKey });
          }
          if (cmds.length) return { commands: cmds };
        }
        return undefined;
      },
    };

    const civ = generateCiv(w, { endYear: 300, upheavals: steps, plugins: [spy] });
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();

    const b = before!;
    const a = after!;
    const sunkRegions: number[] = [];
    const shiftedRegions: number[] = [];
    for (let r = 0; r < b.count; r++) {
      if (a.area[r] === 0) sunkRegions.push(r);
      else if (a.seat[r] !== b.seat[r]) shiftedRegions.push(r);
    }
    expect(sunkRegions.length, '至少有一个整州全沉').toBeGreaterThan(0);
    expect(shiftedRegions.length, '至少有一个治所换了的州').toBeGreaterThan(0);
    expect(a.count, '至少冒出一个新州').toBeGreaterThan(b.count);

    expect(a.keys).toHaveLength(a.count);
    expect(new Set(a.keys).size).toBe(a.count);
    for (const k of a.keys) expect(k.length).toBeGreaterThan(0);

    // 大事以后原有编号的键完全不变
    for (let r = 0; r < b.count; r++) expect(a.keys[r], `旧州 ${r}`).toBe(b.keys[r]);

    // 经命令解析器(iv.of)验旧键(含全沉、换治所)和新键
    const postWorld = steps[steps.length - 1].world;
    const sim = resumeCiv(postWorld, civ, civ.interventions);
    const iv = interventionModelOf(sim)!;
    const beforeSet = new Set(b.keys);
    for (let r = 0; r < b.count; r++) expect(regionOfKey(b.keys[r], iv.of), `旧键 ${r}`).toBe(r);
    for (const r of sunkRegions) expect(regionOfKey(b.keys[r], iv.of), `全沉州 ${r}`).toBe(r);
    for (const r of shiftedRegions) expect(regionOfKey(b.keys[r], iv.of), `换治所州 ${r}`).toBe(r);
    for (let r = b.count; r < a.count; r++) {
      expect(beforeSet.has(a.keys[r]), `新州 ${r} 键不与旧键重`).toBe(false);
      expect(regionOfKey(a.keys[r], iv.of), `新州 ${r}`).toBe(r);
    }

    // 推演里下过的旧键、新键命令被收下并解析回目标州
    expect(issuedOldRegion).toBeGreaterThanOrEqual(0);
    expect(issuedNewRegion).toBeGreaterThanOrEqual(b.count);
    const cmds = (civ.interventions ?? []).filter((v) => v.plugin === 'upheaval-keys' && v.kind === 'disaster');
    expect(cmds).toHaveLength(2);
    if (cmds[0].kind === 'disaster' && cmds[0].type === 'quake') {
      expect(cmds[0].region).toBe(issuedOldKey);
      expect(regionOfKey(cmds[0].region!, iv.of)).toBe(issuedOldRegion);
    }
    if (cmds[1].kind === 'disaster' && cmds[1].type === 'quake') {
      expect(cmds[1].region).toBe(issuedNewKey);
      expect(regionOfKey(cmds[1].region!, iv.of)).toBe(issuedNewRegion);
    }

    // 推完后仍与工具插件 history.regions() 一致
    expect(simRead(sim)!.regions().keys).toEqual(historyRegions(civ, {}).map((x) => x.key));
  }, 60_000);
});

describe('turn.chronicleLeft', () => {
  const line = (n = 1) => Array.from({ length: n }, (_, i) => ({ text: `记${i}` }));

  it('首次出手等于上限、写了 n 句后下次少 n、同回合内不变、无需能力也有', () => {
    const w = world();
    const seen: { year: number; left: number }[] = [];
    const held: { turn: PluginTurn<SimRead>; atStart: number }[] = [];
    const writes: Record<number, number> = { 0: 3, 20: 5, 40: 0, 60: 2 };
    const plugin: SimPlugin<SimRead> = {
      id: 'counter',
      every: 20,
      act(turn) {
        seen.push({ year: turn.year, left: turn.chronicleLeft });
        held.push({ turn, atStart: turn.chronicleLeft });
        const n = writes[turn.year] ?? 0;
        return n ? { chronicle: line(n) } : undefined;
      },
    };
    const civ = generateCiv(w, { endYear: 80, plugins: [plugin] });
    const L = CHRONICLE_LIMITS.lines;
    expect(seen).toEqual([
      { year: 0, left: L },
      { year: 20, left: L - 3 },
      { year: 40, left: L - 8 },
      { year: 60, left: L - 8 },
      { year: 80, left: L - 10 },
    ]);
    // 回话里写编年史不会改那一次已经拿到的 turn.chronicleLeft
    for (const h of held) expect(h.turn.chronicleLeft).toBe(h.atStart);
    expect(civ.simChronicle).toHaveLength(10);
  }, 60_000);

  it('存档接着推以后接得上,且两个插件各看各的', () => {
    const w = world();
    const makePair = (logA: number[], logB: number[]): SimPlugin<SimRead>[] => [
      {
        id: 'alpha',
        every: 20,
        act(turn) {
          logA.push(turn.chronicleLeft);
          return { chronicle: line(2) };
        },
      },
      {
        id: 'beta',
        every: 20,
        act(turn) {
          logB.push(turn.chronicleLeft);
          return { chronicle: line(5) };
        },
      },
    ];

    const fullA: number[] = [];
    const fullB: number[] = [];
    generateCiv(w, { endYear: 100, plugins: makePair(fullA, fullB) });
    const L = CHRONICLE_LIMITS.lines;
    expect(fullA).toEqual([L, L - 2, L - 4, L - 6, L - 8, L - 10]);
    expect(fullB).toEqual([L, L - 5, L - 10, L - 15, L - 20, L - 25]);

    const partA: number[] = [];
    const partB: number[] = [];
    const saved = unpackValue(packValue(generateCiv(w, { endYear: 40, plugins: makePair(partA, partB) }))) as Civ;
    const contA: number[] = [];
    const contB: number[] = [];
    const run = startContinue(w, saved, { endYear: 100, plugins: makePair(contA, contB) });
    expect(run).not.toBeNull();
    run!.finish();
    expect([...partA, ...contA]).toEqual(fullA);
    expect([...partB, ...contB]).toEqual(fullB);
  }, 60_000);

  it('边界:剩 1 时写 1 句成功、下次为 0;剩 1 时写 2 句第 2 句报错;剩 0 时写 1 句报错', () => {
    const w = world();
    const L = CHRONICLE_LIMITS.lines;

    // 情况 1:先写 L - 1 句 → 剩 1 时写 1 句成功 → 下次剩 0
    const seen: number[] = [];
    const okPlugin: SimPlugin<SimRead> = {
      id: 'exact-cap',
      every: 20,
      act(turn) {
        seen.push(turn.chronicleLeft);
        if (turn.year === 0) return { chronicle: line(L - 1) };
        if (turn.year === 20) return { chronicle: line(1) };
        return undefined;
      },
    };
    const civ = generateCiv(w, { endYear: 40, plugins: [okPlugin] });
    expect(seen).toEqual([L, 1, 0]);
    expect(civ.simChronicle).toHaveLength(L);

    // 情况 2:剩 1 时写 2 句 → 第 2 句报错、推演停下
    const overFromOne: SimPlugin<SimRead> = {
      id: 'over-from-one',
      every: 20,
      act(turn) {
        if (turn.year === 0) return { chronicle: line(L - 1) };
        if (turn.year === 20) {
          expect(turn.chronicleLeft).toBe(1);
          return { chronicle: line(2) };
        }
        return undefined;
      },
    };
    let err1: unknown;
    try {
      const run = startCiv(w, { endYear: 40, plugins: [overFromOne] });
      run.advance(10);
      run.advance(40);
    } catch (e) {
      err1 = e;
    }
    expect(err1).toBeInstanceOf(PluginError);
    expect((err1 as PluginError).plugin).toBe('over-from-one');
    expect((err1 as Error).message).toContain(`最多写 ${L} 句编年史`);

    // 情况 3:剩 0 时再写 1 句 → 照旧报错、推演停下
    const overFromZero: SimPlugin<SimRead> = {
      id: 'over-from-zero',
      every: 20,
      act(turn) {
        if (turn.year === 0) return { chronicle: line(L) };
        if (turn.year === 20) {
          expect(turn.chronicleLeft).toBe(0);
          return { chronicle: line(1) };
        }
        return undefined;
      },
    };
    let err2: unknown;
    try {
      generateCiv(w, { endYear: 40, plugins: [overFromZero] });
    } catch (e) {
      err2 = e;
    }
    expect(err2).toBeInstanceOf(PluginError);
    expect((err2 as PluginError).plugin).toBe('over-from-zero');
    expect((err2 as Error).message).toContain(`最多写 ${L} 句编年史`);
  }, 60_000);

  it('在 QuickJS 沙箱中同样读得到 read.regions().keys 和 turn.chronicleLeft', async () => {
    const w = world();
    const L = CHRONICLE_LIMITS.lines;
    const code = `
      civAtlas.sim({
        act(turn) {
          const prev = Array.isArray(turn.note) ? turn.note : [];
          const reg = turn.read.regions();
          const ok = reg.keys.length === reg.count && new Set(reg.keys).size === reg.count && reg.keys.every((k) => typeof k === 'string' && k.length > 0);
          return {
            note: [...prev, ok ? 1 : 0, turn.chronicleLeft],
            chronicle: [{ text: '记一笔' }, { text: '记两笔' }],
          };
        },
      });
    `;
    const qp = await quickjsPlugin(quickjsWasm(), { id: 'qjs-read', code, setup: { every: 20 }, seed: PARAMS.seed });
    try {
      const civ = generateCiv(w, { endYear: 40, plugins: [qp] });
      expect(civ.simPlugins?.[0].note).toEqual([1, L, 1, L - 2, 1, L - 4]);
      expect(civ.simChronicle).toHaveLength(6);
    } finally {
      qp.dispose();
    }
  }, 60_000);
});

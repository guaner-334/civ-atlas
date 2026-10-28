/**
 * 商道(gen/civ/trade.ts):推演里每 20 年算一步,只读推演、不改历史。
 * 历史一个字没变由 names-stable.test.ts(不算商道的历史指纹,期望值和加商道以前一样)和 determinism.test.ts 钉住;这里看:
 * 同一个种子推两遍一样、从半路接着推和一口气推完一样、数据本身说得通(通断按年份排、废了就不再有事、路线从产地起)。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { CivSim } from '../src/gen/civ/sim';
import { finishTrade } from '../src/gen/civ/trade';
import { tradeEntries } from '../src/gen/civ/tradeText';
import { applyNames, resolveKey, tradeKey } from '../src/gen/edits';
import { fullChronicle } from '../src/gen/civ/religionText';

const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
}
const civs = new Map<number, Civ>();
function civOf(seed: number): Civ {
  let c = civs.get(seed);
  if (!c) civs.set(seed, (c = generateCiv(world(seed))));
  return c;
}

/** y 年时这条商道的状态:还没通 = ''、通 / 断 / 废 */
function stateAt(events: { year: number; kind: string }[], y: number): string {
  let st = '';
  for (const e of events) if (e.year <= y) st = e.kind === 'reopen' ? 'open' : e.kind;
  return st;
}

describe.each([7, 2024])('商道 · seed=%i', (seed) => {
  it('同一个种子推两遍一样;从半路接着推(整步上、不在整步上)和一口气推完一样', () => {
    const civ = civOf(seed);
    const again = generateCiv(world(seed));
    expect(again.trade).toEqual(civ.trade);
    for (const cut of [1200, 1655.5]) {
      const half = generateCiv(world(seed), { endYear: cut });
      const sim = CivSim.fromCiv(world(seed), half);
      sim.run(civ.endYear);
      const t = finishTrade(sim, civ.regions)!;
      expect(t.routes, `从第 ${cut} 年接着推`).toEqual(civ.trade!.routes);
      expect(t.state, `从第 ${cut} 年接着推`).toEqual(civ.trade!.state);
    }
  }, 120_000);

  it('数据说得通:通断按年份排,第一件是通、废了就不再有事;路线从产地起;同时在用的不超过 12 条;同时在用的不重名', () => {
    const civ = civOf(seed);
    const T = civ.trade!;
    expect(T.routes.length).toBeGreaterThan(3);
    // 按开通的先后看名字
    const byOpen = T.routes.slice().sort((a, b) => a.events[0].year - b.events[0].year || a.id - b.id);
    const names = new Map<string, { pair: string; end: number }>();
    for (const r of byOpen) {
      expect(r.events[0].kind).toBe('open');
      for (let i = 1; i < r.events.length; i++) expect(r.events[i].year).toBeGreaterThanOrEqual(r.events[i - 1].year);
      const ends = r.events.filter((e) => e.kind === 'end');
      expect(ends.length).toBeLessThanOrEqual(1);
      if (ends.length) expect(r.events[r.events.length - 1].kind).toBe('end');
      // 断、复通交替
      let broken = false;
      for (const e of r.events) {
        if (e.kind === 'break') expect(broken).toBe(false), (broken = true);
        if (e.kind === 'reopen') expect(broken).toBe(true), (broken = false);
      }
      expect(r.goods.length).toBeGreaterThan(0);
      expect(r.paths.length).toBeGreaterThan(0);
      for (const p of r.paths) expect(p.regions[0]).toBe(r.from);
      expect(r.name).toMatch(/道$/);
      expect(r.name).not.toMatch(/铁道|油道/);
      // 同名的:同一个买方、同一处产地(废了以后又开的),或者前一条废了以后才开的
      const pair = `${r.buyer}:${r.from}`;
      const prev = names.get(r.name);
      if (prev && prev.pair !== pair) expect(r.events[0].year, r.name).toBeGreaterThanOrEqual(prev.end);
      const last = r.events[r.events.length - 1];
      names.set(r.name, { pair, end: Math.max(prev?.end ?? -Infinity, last.kind === 'end' ? last.year : Infinity) });
    }
    for (let y = 0; y <= civ.endYear; y += 50) {
      const n = T.routes.filter((r) => {
        const st = stateAt(r.events, y);
        return st === 'open' || st === 'break';
      }).length;
      expect(n, `第 ${y} 年`).toBeLessThanOrEqual(12);
    }
  }, 120_000);

  it('编年史:每件通、断、复通、废都写进去(同一仗断的、同一国亡而废的并成一句),都是小事;和别的纪事编号不撞', () => {
    const civ = civOf(seed);
    const T = civ.trade!;
    const es = tradeEntries(civ);
    const n = T.routes.reduce((s, r) => s + r.events.length, 0);
    expect(es.reduce((s, e) => s + e.trade!.length, 0)).toBe(n);
    for (let i = 1; i < es.length; i++) expect(es[i].year).toBeGreaterThanOrEqual(es[i - 1].year);
    for (const e of es) {
      expect(e.importance).toBe(1);
      expect(e.kind).toBe('era');
      expect(e.tag).toBe('商');
      expect(e.text).toMatch(/(通|断|复通|废)$/);
      for (const id of e.trade!) expect(e.text).toContain(T.routes[id].name);
    }
    const all = fullChronicle(civ);
    expect(new Set(all.map((e) => `${e.kind}:${e.id}`)).size).toBe(all.length);
    expect(all.filter((e) => e.tag === '商').length).toBe(es.length);
  }, 120_000);

  it('改名:稳定键找得回同一条(各条的键都不一样);改过的名字套上,原来那份不动', () => {
    const civ = civOf(seed);
    const keys = civ.trade!.routes.map((r) => tradeKey(civ, r.id));
    expect(new Set(keys).size).toBe(keys.length);
    const id = civ.trade!.routes.length >> 1;
    expect(resolveKey(civ, keys[id])).toEqual({ kind: 'trade', id });
    const named = applyNames(civ, { [keys[id]]: '新商道' });
    expect(named.trade!.routes[id].name).toBe('新商道');
    expect(civ.trade!.routes[id].name).not.toBe('新商道');
  }, 120_000);
});

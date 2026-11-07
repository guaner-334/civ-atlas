/**
 * 推演里的读口(sim.read@1)和数表总登记:
 * - 三组数表各用各的引擎,按「组名.表名」找到的就是那组引擎里的那张表
 * - 读口交出来的和推演此刻的状态一样
 * - 交出来的东西拷贝出去随便改,推演不受影响;读口本身不改状态:推演中途反复读、改,推出来的整份历史和不读的逐项一样
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, startContinue, type Civ } from '../src/gen/civ';
import type { CivSim } from '../src/gen/civ/engine/sim';
import { controlModelOf } from '../src/gen/civ/control';
import { devModelOf } from '../src/gen/civ/development';
import { ideoModelOf } from '../src/gen/civ/ideology';
import { capitalAt, populationAt } from '../src/gen/civ/growth';
import { faithAt } from '../src/gen/civ/religion';
import { OFFICIAL_NAMES, officialUnit, simRead, type SimRead } from '../src/gen/civ/simRead';

/** 接着推时建出来的推演(startContinue 不交出它,这里截下来) */
const sims: CivSim[] = [];
vi.mock('../src/gen/civ/modules', async (importOriginal) => {
  const m = await importOriginal<typeof import('../src/gen/civ/modules')>();
  return {
    ...m,
    resumeCiv: (...args: Parameters<typeof m.resumeCiv>) => {
      const sim = m.resumeCiv(...args);
      sims.push(sim);
      return sim;
    },
  };
});
const { resumeCiv } = await import('../src/gen/civ/modules');

const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
};
const SEEDS = [7, 2024];

/** 读口能交出来的全部东西 */
function readAll(v: SimRead) {
  const from = Math.floor(v.year) - 5;
  return {
    year: v.year,
    regions: v.regions(),
    owners: (['polity', 'culture', 'faith'] as const).map((f) => v.owners(f)),
    polities: v.polities(),
    settlements: v.settlements(),
    cultures: v.cultures(),
    official: OFFICIAL_NAMES.map((n) => v.official(n)),
    annals: v.annals(from),
  };
}

/** 把读到的一股脑改掉:数组填满乱数,列表塞东西,对象的字段改成别的 */
function scribble(x: unknown): void {
  if (ArrayBuffer.isView(x)) {
    const a = x as unknown as { fill(v: number): void };
    a.fill(x instanceof Float64Array || x instanceof Float32Array ? NaN : 7);
    return;
  }
  if (Array.isArray(x)) {
    x.forEach(scribble);
    x.push(-12345);
    return;
  }
  if (x && typeof x === 'object') {
    for (const [k, v] of Object.entries(x)) {
      if (v && typeof v === 'object') scribble(v);
      else (x as Record<string, unknown>)[k] = typeof v === 'number' ? -999 : 'x';
    }
  }
}

describe('数表总登记', () => {
  it('三组各用各的引擎,按「组名.表名」找到的就是那组里的那张表;同名的表分属不同的组', () => {
    const w = world(7);
    const civ = generateCiv(w, { endYear: 900 });
    const sim = resumeCiv(w, civ);
    const t = sim.tables;
    expect(t.groupNames().sort()).toEqual(['dev', 'ideology', 'state']);
    const cm = controlModelOf(sim)!;
    const dm = devModelOf(sim)!;
    const im = ideoModelOf(sim)!;
    expect(t.engine('state')).toBe(cm.eng);
    expect(t.engine('dev')).toBe(dm.eng);
    expect(t.engine('ideology')).toBe(im.eng);
    expect(new Set([cm.eng, dm.eng, im.eng]).size).toBe(3);
    expect(t.get('state.动荡')).toBe(cm.eng.get('动荡'));
    expect(t.get('dev.能力')).toBe(dm.eng!.get('能力'));
    expect(t.get('ideology.思潮')).toBe(im.eng.get('思潮'));
    expect(t.get('state.国')).not.toBe(t.get('dev.国'));
    expect(t.card('dev.能用')?.cols?.length).toBe(11);
    for (const bad of ['动荡', 'state.', 'state.没有这张', 'nope.动荡', '.动荡']) expect(t.get(bad), bad).toBeUndefined();
    expect(t.names().length).toBe(cm.eng.cards.length + dm.eng!.cards.length + im.eng.cards.length);
    // 算一步会换数组:总登记每次现找,拿到的是算过以后的那一份
    sim.run(960);
    expect(t.get('state.动荡')).toBe(cm.eng.get('动荡'));
    expect(t.get('dev.能力')).toBe(dm.eng!.get('能力'));
    expect(t.get('ideology.思潮')).toBe(im.eng.get('思潮'));
  });
});

describe('读口 sim.read@1', () => {
  it.each(SEEDS)('交出来的和推演此刻一样(seed %i)', (seed) => {
    const w = world(seed);
    const civ = generateCiv(w, { endYear: 900 });
    const sim = resumeCiv(w, civ);
    const v = simRead(sim)!;
    expect(v.year).toBe(900);
    const R = civ.regions.count;

    const reg = v.regions();
    expect(reg.count).toBe(R);
    expect(reg.seat).toEqual(civ.regions.seat);
    expect(reg.biome).toEqual(civ.regions.biome);
    expect(reg.neighbors.start).toEqual(civ.regions.adjStart);
    expect(reg.neighbors.list).toEqual(civ.regions.adj);
    expect(reg.area[0]).toBeGreaterThan(100);
    expect(reg.coastal.some((c) => c === 1)).toBe(true);

    expect(v.owners('polity')).toEqual(civ.polity);
    expect(v.owners('culture')).toEqual(civ.culture);
    expect(v.owners('faith')).toEqual(faithAt(civ, 900));

    const ps = v.polities();
    expect(ps.map((p) => [p.id, p.founded, p.ended, p.culture, p.parent, p.capital])).toEqual(
      civ.polities.map((P) => [P.id, P.founded, P.ended, P.culture, P.parent, capitalAt(P, 900)]),
    );
    for (const p of ps) {
      expect(p.size, `国 ${p.id} 几州`).toBe(civ.polity.filter((x) => x === p.id).length);
      if (p.ended !== undefined) expect(p.size).toBe(0);
      expect(p.treasury).toBeGreaterThanOrEqual(0);
      expect(p.treasury).toBeLessThanOrEqual(1);
      for (const q of p.wars) expect(ps[q].wars, `${p.id} 和 ${q} 打仗是两头的`).toContain(p.id);
      for (const q of p.allies) expect(ps[q].allies).toContain(p.id);
    }
    const alive = ps.filter((p) => p.size > 0);
    expect(alive.length).toBeGreaterThan(3);
    expect(alive.every((p) => p.power > 0)).toBe(true);

    const ss = v.settlements();
    expect(ss.map((s) => [s.id, s.cell, s.region, s.founded, s.ended, s.population])).toEqual(
      civ.settlements.map((s) => [s.id, s.cell, s.region, s.founded, s.ended, populationAt(s, 900)]),
    );
    expect(ss.some((s) => s.rank >= 2)).toBe(true);

    expect(v.cultures().map((c) => [c.id, c.kind, c.hearth, c.born, c.ended, c.parent])).toEqual(
      civ.cultures.map((c) => [c.id, c.kind, c.hearth, c.born, c.ended, c.parent]),
    );

    // 官方表:每个稳定名字都找得到、单位和卡上的一样,值就是总登记里那一栏
    const dm = devModelOf(sim)!;
    for (const name of OFFICIAL_NAMES) {
      const a = v.official(name);
      expect(a.length, name).toBe(officialUnit(name) === 'region' ? R : civ.polities.length);
      expect(a.every(Number.isFinite), name).toBe(true);
    }
    const adm = v.official('dev.administration');
    for (let r = 0; r < R; r++) expect(adm[r]).toBe(dm.cur[r * 5 + 3]);
    expect(v.official('res.grain').some((x) => x > 0)).toBe(true);
    expect(v.official('rural').some((x) => x > 0)).toBe(true);
    expect(v.official('control').some((x) => x > 0)).toBe(true);

    const pick = (lo: number, hi: number) =>
      civ.annals.filter((e) => e.year >= lo && e.year <= hi).map((e) => ({ year: e.year, kind: e.kind, a: e.a, b: e.b, region: e.region, settlement: e.settlement, war: e.war }));
    expect(v.annals(800, 850)).toEqual(pick(800, 850));
    expect(v.annals(850)).toEqual(pick(850, 900));
    expect(v.annals(901)).toEqual([]);
  });

  it('推演中途读的就是此刻:读口上的年份、归属跟着推演走', () => {
    const w = world(7);
    const sim = resumeCiv(w, generateCiv(w, { endYear: 900 }));
    const v = simRead(sim)!;
    sim.run(1250.5);
    expect(v.year).toBe(1250.5);
    expect(v.owners('polity')).toEqual(sim.owners[1]);
    expect(v.annals(1250).every((e) => e.year >= 1250 && e.year <= 1250.5)).toBe(true);
  });

  it.each(SEEDS)('分段推读到的 = 一口气推读到的:从存下的第 900 年接着推,和从更早接着推到第 900 年,读口交的一样(seed %i)', (seed) => {
    const w = world(seed);
    const early = resumeCiv(w, generateCiv(w, { endYear: 600 }));
    early.run(900);
    const saved = resumeCiv(w, generateCiv(w, { endYear: 900 }));
    expect(readAll(simRead(saved)!)).toEqual(readAll(simRead(early)!));
  });

  it.each(SEEDS)('推演中途每 5 年读一遍、把读到的全改掉,推出来的整份历史和不读的逐项一样(seed %i)', (seed) => {
    const w = world(seed);
    const civ = generateCiv(w, { endYear: 700 });
    const plain = continueCiv(w, civ, { endYear: 1600 });

    sims.length = 0;
    const run = startContinue(w, civ, { endYear: 1600 })!;
    expect(sims.length).toBe(1);
    const sim = sims[0];
    const v = simRead(sim)!;
    let reads = 0;
    const poke = () => {
      const got = readAll(v);
      scribble(got);
      // 改过以后再读一遍:读口交的是新做的一份,和改过的那份无关
      expect(readAll(v).year).toBe(sim.now);
      reads++;
    };
    sim.everyYears(705, 5, poke);
    for (let y = 737; y < 1600; y += 137) {
      run.advance(y);
      poke();
    }
    const read = run.finish();
    expect(reads).toBeGreaterThan(170);
    const keys = Object.keys(plain).sort();
    expect(Object.keys(read).sort()).toEqual(keys);
    for (const k of keys) expect((read as unknown as Record<string, unknown>)[k], k).toEqual((plain as unknown as Record<string, unknown>)[k as keyof Civ]);
  });
});

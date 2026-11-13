/**
 * 读口 sim.read@1 后加的几样:战争、停战和记恨、各州易手、邦交、在位的君主、商道、大迁徙、瘟疫,国和城多的几项、官方表多的几张、史事的由头和成员。
 * - 交出来的和推演此刻一样:能从史事、变化日志、整理出来的历史推的照它们对,推不出来的和推演模型里的对
 * - 关进 QuickJS 也一样;同一回合里同样的调用只取一次;只读不写,读了历史一位不变
 * 读了改掉、分段推和一口气推读到的一样,在 sim-read.test.ts(readAll 带上了这几样)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import type { CivSim } from '../src/gen/civ/engine/sim';
import type { PluginTurn, SimPlugin } from '../src/gen/civ/engine/plugin';
import { resumeCiv } from '../src/gen/civ/modules';
import { simRead, SIM_RESOURCES, type SimPolity, type SimRead, type SimWar } from '../src/gen/civ/simRead';
import { OFFICIAL } from '../src/gen/civ/simOfficial';
import { RESOURCES } from '../src/gen/civ/development';
import { controlModelOf } from '../src/gen/civ/control';
import { devModelOf } from '../src/gen/civ/development';
import { ideoModelOf } from '../src/gen/civ/ideology';
import { effOf, polityModelOf, regentOf, rulerOf } from '../src/gen/civ/polities';
import { goalOf, lengthOf, warModelOf } from '../src/gen/civ/wars';
import { treatyModelOf } from '../src/gen/civ/treaties';
import { courtRulesAt } from '../src/gen/civ/council';
import { dynastyIndexAt } from '../src/gen/civ/polityRoot';
import { populationAt } from '../src/gen/civ/growth';
import { ROYALS_KNOBS } from '../src/gen/civ/royals';
import { polityKey } from '../src/gen/edits';
import { quickjsPlugin } from '../src/gen/quickjs/sim';
import { quickjsWasm } from '../scripts/lib/quickjsNode';
import { packValue } from '../src/gen/snapshot';

const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed })));
  return w;
};
const SEEDS = [7, 2024];
const POLITY = 1;

/** 推到 T 年存下、接着推的那个引擎(读口读的就是它) */
function at(seed: number, T: number, opts: Parameters<typeof generateCiv>[1] = {}): { civ: Civ; sim: CivSim; v: SimRead } {
  const w = world(seed);
  const civ = generateCiv(w, { ...opts, endYear: T });
  const sim = resumeCiv(w, civ, opts.interventions);
  return { civ, sim, v: simRead(sim)! };
}

const pairKey = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
const CIVIL = new Set(['quell', 'heir', 'trek']);

/** 照史事重建的战争(和推演里一样:宣战、带战争编号的攻占、议和) */
function warsFromAnnals(civ: Civ): { wars: SimWar[]; civil: Set<number> } {
  const wars: SimWar[] = [];
  const civil = new Set<number>();
  for (const e of civ.annals) {
    if (e.kind === 'war') {
      wars[e.war] = { id: e.war, a: e.a, b: e.b, start: e.year, takes: [] };
      if (e.cause && CIVIL.has(e.cause)) civil.add(e.war);
    } else if (e.kind === 'conquer' && e.war >= 0) wars[e.war]?.takes.push({ year: e.year, region: e.region, by: e.a });
    else if (e.kind === 'peace' && wars[e.war]) wars[e.war].end = e.year;
  }
  return { wars, civil };
}

describe('读口后加的几样和推演此刻一样', () => {
  it.each(SEEDS)('战争、停战、记恨、各州易手(第 1700 年,seed %i)', (seed) => {
    const T = 1700;
    const { civ, sim, v } = at(seed, T);
    const alive = (p: number) => civ.polities[p].ended === undefined;
    const { wars, civil } = warsFromAnnals(civ);
    const got = v.wars();
    expect(got.length).toBeGreaterThan(20);
    expect(got.map(({ goal: _g, length: _l, ...x }) => x)).toEqual(wars);

    // 还在打的:目标、年限和推演里议和那一步算的一样;两头的 SimPolity.wars 里有对方
    const wm = warModelOf(sim)!;
    const pm = polityModelOf(sim)!;
    const ps = v.polities();
    for (const x of got) {
      if (x.end !== undefined) {
        expect([x.goal, x.length]).toEqual([undefined, undefined]);
        continue;
      }
      expect(ps[x.a].wars).toContain(x.b);
      expect(ps[x.b].wars).toContain(x.a);
      const eff = effOf(pm, x.a, T);
      const len = lengthOf(wm, wm.wars[x.id]) * eff.war;
      if (civil.has(x.id)) expect([x.goal, x.length]).toEqual([undefined, wm.k.REVOLT_LENGTH * len]);
      else expect([x.goal, x.length]).toEqual([Math.max(1, goalOf(wm, wm.wars[x.id]) + eff.goal), len]);
      expect(x.length! > 0 && (x.goal === undefined || (Number.isInteger(x.goal) && x.goal >= 1))).toBe(true);
    }
    const active = got.filter((x) => x.end === undefined).length;
    expect(ps.reduce((n, p) => n + p.wars.length, 0)).toBeLessThanOrEqual(2 * active);

    // 停战:每对两国最近一次议和 + TRUCE;记恨:净丢了州的一方记恨赢它的(内战不算),GRUDGE_YEARS 年
    const truce = new Map<string, { a: number; b: number; since: number }>();
    const grudge = new Map<string, { a: number; b: number; since: number }>();
    for (const e of civ.annals) {
      if (e.kind !== 'peace') continue;
      const a = Math.min(e.a, e.b);
      const b = Math.max(e.a, e.b);
      truce.set(pairKey(a, b), { a, b, since: e.year });
      const w = wars[e.war];
      if (!w || civil.has(w.id)) continue;
      let g = 0;
      for (const x of w.takes) g += x.by === w.a ? 1 : -1;
      if (g) grudge.set(`${g > 0 ? w.b : w.a}:${g > 0 ? w.a : w.b}`, { a: g > 0 ? w.b : w.a, b: g > 0 ? w.a : w.b, since: e.year });
    }
    const live = (m: Map<string, { a: number; b: number; since: number }>, years: number) =>
      [...m.values()]
        .map((x) => ({ ...x, until: x.since + years }))
        .filter((x) => T < x.until && alive(x.a) && alive(x.b))
        .sort((x, y) => x.a - y.a || x.b - y.b);
    expect(v.truces()).toEqual(live(truce, wm.k.TRUCE));
    expect(v.grudges()).toEqual(live(grudge, wm.k.GRUDGE_YEARS));
    expect(wm.truce.size).toBeGreaterThan(0);

    // 各州易手:变化日志里国家那一层的最后一条
    const R = civ.regions.count;
    const since = new Float64Array(R).fill(-Infinity);
    const prev = new Int16Array(R).fill(-1);
    const cur = new Int16Array(R).fill(-1);
    const log = civ.log;
    for (let i = 0; i < log.size; i++) {
      if (log.layer[i] !== POLITY) continue;
      const r = log.region[i];
      since[r] = log.year[i];
      prev[r] = cur[r];
      cur[r] = log.value[i];
    }
    const h = v.handover();
    expect(h.since).toEqual(since);
    expect(h.prev).toEqual(prev);
    expect(h.prev.some((p, r) => p >= 0 && p !== civ.polity[r])).toBe(true);
  }, 60_000);

  it.each(SEEDS)('盟约、藩属、约和中立地(第 2000 年,seed %i)', (seed) => {
    const T = 2000;
    const { civ, sim, v } = at(seed, T);
    const alive = (p: number) => civ.polities[p].ended === undefined;
    const allies = new Map<string, { a: number; b: number; since: number; foe: number }>();
    const lieges = new Map<number, { b: number; since: number }>();
    for (const e of civ.annals) {
      if (e.kind === 'alliance') allies.set(pairKey(e.a, e.b), { a: e.a, b: e.b, since: e.year, foe: e.foe ?? -1 });
      else if (e.kind === 'unally') allies.delete(pairKey(e.a, e.b));
      else if (e.kind === 'submit') lieges.set(e.a, { b: e.b, since: e.year });
      else if (e.kind === 'defect') lieges.delete(e.a);
    }
    const p = v.pacts();
    expect(p.alliances).toEqual([...allies.values()].filter((x) => alive(x.a) && alive(x.b)));
    expect(p.vassals).toEqual(
      [...lieges]
        .filter(([a, x]) => alive(a) && alive(x.b))
        .map(([a, x]) => ({ a, b: x.b, since: x.since }))
        .sort((x, y) => x.a - y.a),
    );
    const ps = v.polities();
    for (const x of p.alliances) expect(ps[x.a].allies).toContain(x.b);
    for (const x of p.vassals) expect(ps[x.a].liege).toBe(x.b);

    // 约:还没废的、此刻还在约里的几国;中立地那州此刻无主
    const tm = treatyModelOf(sim)!;
    expect(p.treaties.map((x) => x.id)).toEqual(tm.live.map((x) => x.id));
    for (const x of p.treaties) {
      const t = tm.treaties[x.id];
      expect(x.members).toEqual(tm.members(t));
      expect([x.start, x.since, x.until, x.limited, x.keep, x.foe, x.zone]).toEqual([t.start, t.since, t.term > 0 ? t.since + t.term : undefined, t.multi, t.keep, t.foe, t.zone]);
      const named = new Set(civ.annals.filter((e) => e.kind === 'treaty' && e.war === x.id).flatMap((e) => e.ps ?? []));
      for (const q of x.members) expect(named.has(q)).toBe(true);
      expect(x.until === undefined || x.until > T).toBe(true);
    }
    const owner = v.owners('polity');
    for (const z of p.zones) {
      expect(owner[z.region]).toBe(-1);
      expect(tm.zones[z.id].ended).toBeUndefined();
    }
    expect(p.zones.length).toBe(tm.zones.filter((z) => z.ended === undefined).length);
  }, 60_000);

  it.each(SEEDS)('在位的君主、掌权的人、诸子(第 1500 年,seed %i)', (seed) => {
    const T = 1500;
    const { civ, sim, v } = at(seed, T);
    const pm = polityModelOf(sim)!;
    const { CLAIM_AGE } = pm.knobs.get(ROYALS_KNOBS);
    const rs = v.rulers();
    expect(rs.map((r) => r.polity)).toEqual(civ.polities.filter((P) => P.ended === undefined).map((P) => P.id));
    let sons = 0;
    let matched = 0;
    for (const r of rs) {
      const R = rulerOf(pm, r.polity, T);
      expect([r.k, r.dynasty, r.from]).toEqual([R.k, R.dynasty, R.from]);
      // 整理出来的人物里此刻在位的那一位:生年、即位、倾向一样
      const P = civ.people!.filter((x) => x.role === 'ruler' && x.polity === r.polity && (x.from ?? -Infinity) <= T && (x.until ?? Infinity) > T);
      if (P.length === 1 && P[0].from === r.from) {
        matched++;
        expect(P[0].born).toBe(r.born);
        if (!P[0].moods) expect(r.leanings).toEqual(P[0].leanings);
      }
      const g = regentOf(pm, r.polity, T, R);
      expect(r.regent === undefined).toBe(!g);
      if (g) expect(r.regent).toEqual({ kind: g.kind, since: g.start, born: g.born, leanings: { ...g.leanings } });
      expect(r.sons.filter((s) => s.heir).length).toBeLessThanOrEqual(1);
      for (let i = 1; i < r.sons.length; i++) expect(r.sons[i].born).toBeGreaterThanOrEqual(r.sons[i - 1].born);
      for (const s of r.sons) expect(s.born <= T && s.born > r.born).toBe(true);
      for (const c of r.claimants) {
        expect(r.sons.some((s) => !s.heir && s.born === c)).toBe(true);
        expect(T - c >= CLAIM_AGE[0] && T - c <= CLAIM_AGE[1]).toBe(true);
      }
      sons += r.sons.length;
    }
    expect(matched).toBeGreaterThan(rs.length * 0.8);
    expect(sons).toBeGreaterThan(0);
  }, 60_000);

  it.each(SEEDS)('商道、在路上的大迁徙和整理出来的历史一样(第 2600 年,seed %i)', (seed) => {
    const T = 2600;
    const { civ, v } = at(seed, T);
    const tr = civ.trade!;
    const got = v.trades();
    expect(got.map((x) => [x.id, x.broken])).toEqual(tr.state.live.map((l) => [l.id, l.broken]));
    expect(got.length).toBeGreaterThan(0);
    for (const x of got) {
      const r = tr.routes[x.id];
      expect([x.buyer, x.from, x.opened]).toEqual([r.buyer, r.from, r.events[0].year]);
      expect(x.path).toEqual(r.paths[r.paths.length - 1].regions);
      const carried = new Set(r.goods.filter((g) => g.from <= T).map((g) => SIM_RESOURCES[g.res]));
      for (const g of x.goods) expect(carried.has(g)).toBe(true);
    }
    const dirs = { 东: 'east', 南: 'south', 西: 'west', 北: 'north' } as const;
    const treks = (civ.migrations ?? []).map((M, id) => ({ M, id })).filter(({ M }) => M.settled === undefined && M.year <= T);
    expect(v.treks()).toEqual(
      treks.map(({ M, id }) => ({
        id,
        culture: M.culture,
        start: M.year,
        route: M.route,
        years: M.years,
        at: M.years.filter((y) => y <= T).length - 1,
        dir: dirs[M.dir],
        size: M.size,
        push: M.push,
        pull: M.pull,
        target: M.target,
      })),
    );
  }, 60_000);

  it.each(SEEDS)('正在传的瘟疫:染过的州就是这一场染疫的城所在的州(seed %i)', (seed) => {
    const w = world(seed);
    const sim = resumeCiv(w, generateCiv(w, { endYear: 300 }));
    const v = simRead(sim)!;
    let seen = 0;
    sim.everyYears(300.5, 1, () => {
      const pl = v.plague();
      if (!pl) return;
      seen++;
      const t = sim.now;
      const mine = sim.annalsView.filter((e) => e.kind === 'plague' && e.war === pl.id && e.year <= t);
      expect(mine.length).toBeGreaterThan(0);
      expect(mine[0].year).toBe(pl.start);
      const hit = new Set<number>();
      for (const s of polityModelOf(sim)!.settlements) for (const k of s.sacks ?? []) if (k.cause === 'plague' && k.year >= pl.start && k.year <= t) hit.add(s.region);
      expect(pl.regions).toEqual([...hit].sort((a, b) => a - b));
      for (const e of mine) expect(pl.regions).toContain(e.region);
      for (const r of pl.front) expect(pl.regions).toContain(r);
    });
    sim.run(2200);
    expect(seen).toBeGreaterThan(3);
  }, 60_000);

  it.each(SEEDS)('国家多的几项、城多的几项、史事的由头和成员(第 2400 年,seed %i)', (seed) => {
    const T = 2400;
    const { civ, v } = at(seed, T);
    const ps = v.polities();
    for (const p of ps) {
      const P = civ.polities[p.id];
      expect(p.dynasty).toBe(dynastyIndexAt(P, T));
      expect(p.dynasties.map((d) => [d.from, d.seat])).toEqual(P.dynasties ? P.dynasties.map((d) => [d.year, d.seat]) : [[P.founded, P.capital]]);
      expect(p.dynasties[p.dynasty].regime).toBe(p.regime);
      const c = courtRulesAt(civ, p.id, T);
      expect(p.rules).toEqual({ tax: c.tax, fief: c.fiefBy >= 0, army: c.army, office: c.office });
      expect(p.policy).toBeUndefined();
    }
    expect(ps.some((p) => p.dynasties.length > 1)).toBe(true);
    expect(ps.some((p) => p.rules.tax > 0 || p.rules.army !== 0 || p.rules.office !== 0)).toBe(true);

    const ss = v.settlements();
    for (const s of ss) {
      const S = civ.settlements[s.id];
      expect(s.culture).toBe(S.culture);
      if (s.ended !== undefined) expect(s.capacity).toBe(0);
      else expect(s.capacity).toBeGreaterThanOrEqual(populationAt(S, T));
    }
    // 城受的灾:各城的 sacks 摊平,按年份、城的编号排
    const sacks = civ.settlements
      .flatMap((S) => (S.sacks ?? []).map((k) => ({ year: k.year, settlement: S.id, loss: k.loss, cause: k.cause ?? 'sack' })))
      .sort((a, b) => a.year - b.year || a.settlement - b.settlement);
    expect(v.sacks(0)).toEqual(sacks);
    expect(v.sacks(1800, 2000)).toEqual(sacks.filter((k) => k.year >= 1800 && k.year <= 2000));
    expect(v.sacks(T + 1)).toEqual([]);
    expect(sacks.some((k) => k.cause === 'sack') && sacks.some((k) => k.cause === 'plague')).toBe(true);

    const pick = (lo: number, hi: number) =>
      civ.annals
        .filter((e) => e.year >= lo && e.year <= hi)
        .map((e) => ({ year: e.year, kind: e.kind, a: e.a, b: e.b, region: e.region, settlement: e.settlement, war: e.war, ...(e.cause !== undefined ? { cause: e.cause } : {}), ...(e.ps !== undefined ? { ps: e.ps } : {}) }));
    const got = v.annals(0);
    expect(got).toEqual(pick(0, T));
    expect(got.some((e) => e.cause === 'expand')).toBe(true);
    for (const e of got) if (e.kind === 'treaty') expect(e.ps!.length).toBeGreaterThanOrEqual(2);
  }, 60_000);

  it('官方表后加的几张:就是总登记里那一栏;物产的名字和发展度的物产一一对上', () => {
    const T = 1800;
    const { civ, sim, v } = at(7, T);
    expect(SIM_RESOURCES.map((k) => OFFICIAL[`res.${k}`].col)).toEqual([...RESOURCES]);
    expect(SIM_RESOURCES.map((k) => OFFICIAL[`res.base.${k}`].col)).toEqual([...RESOURCES]);
    expect(SIM_RESOURCES.map((k) => OFFICIAL[`res.stock.${k}`].col)).toEqual([...RESOURCES]);
    const R = civ.regions.count;
    const P = civ.polities.length;
    const col = (data: Float64Array, cols: number, c: number, n: number) => Float64Array.from({ length: n }, (_, i) => data[i * cols + c]);
    const st = controlModelOf(sim)!.eng;
    const dv = devModelOf(sim)!.eng!;
    const id = ideoModelOf(sim)!.eng;
    expect(v.official('fiscal.treasury')).toEqual(st.get('国库').slice(0, P));
    expect(v.official('fiscal.land')).toEqual(st.get('田赋').slice(0, R));
    expect(v.official('strife')).toEqual(st.get('兵祸').slice(0, R));
    expect(v.official('soil')).toEqual(st.get('州地力').slice(0, R));
    expect(v.official('era')).toEqual(dv.get('时代').slice(0, R));
    expect(v.official('res.base.iron')).toEqual(col(dv.get('物产'), 11, 3, R));
    expect(v.official('res.stock.timber')).toEqual(col(dv.get('存量'), 11, 5, R));
    expect(v.official('ideology.polity.law')).toEqual(col(id.get('国中'), 7, 1, P));
    expect(v.official('fiscal.collected').some((x) => x > 0)).toBe(true);
    expect(v.official('soil').some((x) => x > 0 && x < 1)).toBe(true);
    expect(v.official('res.stock.iron').some((x) => x > 0)).toBe(true);
  }, 60_000);

  it('作者定的方针、下令结的盟读得到:亲仇是此刻的编号,结盟带期限', () => {
    const seed = 7;
    const base = generateCiv(world(seed), { endYear: 1200 });
    const live = base.polities.filter((P) => P.ended === undefined).sort((x, y) => base.polity.filter((q) => q === y.id).length - base.polity.filter((q) => q === x.id).length);
    const [a, b, c] = live.map((P) => P.id);
    const interventions = [
      { kind: 'policy' as const, a: polityKey(base, a), from: 1200, war: 25, focus: 'transport' as const, foes: [polityKey(base, b)], friends: [polityKey(base, c)] },
      { kind: 'ally' as const, a: polityKey(base, b), b: polityKey(base, c), from: 1200, until: 1400 },
    ];
    const { civ, v } = at(seed, 1250, { interventions });
    expect(civ.polities[a].ended).toBeUndefined();
    const pol = v.polities()[a].policy;
    expect(pol).toEqual({ from: 1200, friends: [c], foes: [b], war: 25, focus: 'transport' });
    for (const p of v.polities()) if (p.id !== a) expect(p.policy).toBeUndefined();
    const al = v.pacts().alliances.filter((x) => pairKey(x.a, x.b) === pairKey(b, c));
    if (civ.polities[b].ended === undefined && civ.polities[c].ended === undefined) {
      expect(al).toHaveLength(1);
      expect(al[0].until === 1400 || al[0].until === undefined).toBe(true);
    }
  }, 60_000);
});

describe('关进 QuickJS 读', () => {
  const CALLS = ['wars', 'truces', 'grudges', 'handover', 'pacts', 'rulers', 'trades', 'treks', 'plague', 'sacks'] as const;
  /** 每回合把后加的几样各读两遍,记几个数进小本子 */
  const CODE = `civAtlas.sim({ act(turn) {
    const r = turn.read;
    for (let i = 0; i < 2; i++) { ${CALLS.map((k) => `r.${k}(${k === 'sacks' ? 0 : ''});`).join(' ')} }
    const ws = r.wars(), h = r.handover(), p = r.pacts(), rs = r.rulers(), pl = r.plague();
    const war = ws.find((w) => w.end === undefined);
    const n = Object.keys(turn.note || {}).length;
    return { note: Object.assign({}, turn.note || {}, { ['y' + n]: [turn.year, ws.length, war ? war.goal || 0 : -1, war ? war.takes.length : -1,
      h.since.constructor === Float64Array ? 1 : 0, h.since.filter((x) => x === -Infinity).length, h.prev.constructor === Int16Array ? 1 : 0,
      p.alliances.length, p.vassals.length, p.treaties.length, rs.length, rs.reduce((s, x) => s + x.sons.length, 0), r.trades().length, r.treks().length, pl === null ? -1 : pl.regions.length,
      r.annals(0).filter((e) => e.cause !== undefined).length, r.polities().reduce((s, x) => s + x.dynasties.length, 0), r.sacks(0).length, r.settlements().reduce((s, x) => s + x.capacity, 0)] }) };
  } });`;
  /** 本地跑的同一个插件 */
  const native: SimPlugin<SimRead> = {
    id: 'reader',
    every: 100,
    act(turn) {
      const r = turn.read;
      const ws = r.wars();
      const h = r.handover();
      const p = r.pacts();
      const rs = r.rulers();
      const pl = r.plague();
      const war = ws.find((w) => w.end === undefined);
      const note = { ...((turn.note as Record<string, number[]>) ?? {}) };
      note[`y${Object.keys(note).length}`] = [
        turn.year,
        ws.length,
        war ? war.goal || 0 : -1,
        war ? war.takes.length : -1,
        1,
        h.since.filter((x) => x === -Infinity).length,
        1,
        p.alliances.length,
        p.vassals.length,
        p.treaties.length,
        rs.length,
        rs.reduce((s, x) => s + x.sons.length, 0),
        r.trades().length,
        r.treks().length,
        pl === null ? -1 : pl.regions.length,
        r.annals(0).filter((e) => e.cause !== undefined).length,
        r.polities().reduce((s, x: SimPolity) => s + x.dynasties.length, 0),
        r.sacks(0).length,
        r.settlements().reduce((s, x) => s + x.capacity, 0),
      ];
      return { note };
    },
  };

  it('读到的和本地跑一样;同一回合里同样的调用只取一次;读了历史一位不变', async () => {
    const seed = 2024;
    const w = world(seed);
    const q = await quickjsPlugin(quickjsWasm(), { id: 'reader', code: CODE, setup: { every: 100 }, seed });
    const calls = new Map<string, number>();
    let turns = 0;
    const counted: SimPlugin<SimRead> = {
      ...q,
      act(turn: PluginTurn<SimRead>) {
        turns++;
        const read = turn.read as unknown as Record<string, unknown>;
        const wrap: Record<string, unknown> = { year: turn.read.year };
        for (const k of Object.keys(read)) {
          const f = read[k];
          if (typeof f === 'function')
            wrap[k] = (...args: unknown[]) => {
              calls.set(k, (calls.get(k) ?? 0) + 1);
              return Reflect.apply(f, read, args);
            };
        }
        return q.act({ ...turn, read: wrap as unknown as SimRead });
      },
    };
    let boxed: Civ;
    try {
      boxed = generateCiv(w, { plugins: [counted], endYear: 2000 });
    } finally {
      q.dispose();
    }
    const mine = generateCiv(w, { plugins: [native], endYear: 2000 });
    const plain = generateCiv(w, { endYear: 2000 });
    expect(turns).toBe(21);
    for (const k of CALLS) expect(calls.get(k), k).toBe(turns);
    expect(boxed.simPlugins![0].note).toEqual(mine.simPlugins![0].note);
    const pin = (c: Civ) => Buffer.from(packValue({ annals: c.annals, polity: c.polity, culture: c.culture, settlements: c.settlements })).toString('base64');
    expect(pin(boxed)).toBe(pin(plain));
    const last = (mine.simPlugins![0].note as Record<string, number[]>).y20;
    expect(last[1]).toBeGreaterThan(20);
    expect(last[10]).toBeGreaterThan(5);
  }, 120_000);
});

/**
 * 工具插件多读的一批:板块、洋流、世系、朝代、约和中立地、盟约宗藩、商道、大迁徙、州的历年数、改过的地形。
 * 每样和世界里的数逐项对;沙箱换成假的(同 plugin-api.test.ts)。
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { generateCiv } from '../src/gen/civ';
import type { Civ } from '../src/gen/civ/types';
import { controlAt, controlShare } from '../src/gen/civ/control';
import { CAP_COUNT, developmentAt, eraLevel, LEVEL_SCALE, RESOURCE_COUNT, RESOURCES, resourcesAt } from '../src/gen/civ/development';
import { polityTies, relationsAt } from '../src/gen/civ/diplomacy';
import { dynastyTitle, polityAlive, regionPopulationAt } from '../src/gen/civ/growth';
import { ideologyAt, THOUGHT_COUNT } from '../src/gen/civ/ideology';
import { treatyBook, treatyMembersAt, treatyTitle } from '../src/gen/civ/story/treatyInfo';
import { applyNames, dynastyKey, EMPTY_EDITS, polityKey, resolveKey, tradeKey, treatyKey, type WorldEdits } from '../src/gen/edits';
import { driftOf } from '../src/gen/plateOps';
import { PLUGIN_METHODS } from '../src/plugin/caps';
import { PluginApiError } from '../src/plugin/check';
import { planChanges } from '../src/plugin/edit';
import type { PluginResponse } from '../src/plugin/protocol';
import * as read from '../src/plugin/read';
import type { SandboxOptions } from '../src/plugin/sandbox';
import { TrialRecorder } from '../src/plugin/trial';

function codeOf(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    if (e instanceof PluginApiError) return e.code;
    throw e;
  }
  return 'no error';
}
const noGive: read.Give = (a) => a;
/** 去掉值是 undefined 的键(toMatchObject 要求键在) */
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
/** 翻完所有页 */
function all<T>(f: (a: { offset: number }) => { items: T[]; next: number | null }): T[] {
  const out: T[] = [];
  for (let next: number | null = 0; next !== null; ) {
    const pg = f({ offset: next });
    out.push(...pg.items);
    next = pg.next;
  }
  return out;
}

// 种子 26 的默认世界:有三国立约、中立地、大迁徙、商道、改朝换代、盟约和藩属、联姻(同 treaty-ui.test.ts)
const world = generateWorld({ ...DEFAULT_PARAMS, seed: 26 });
const civ = generateCiv(world);

describe('能力', () => {
  it('地图的要 world.read,历史的要 history.read,改过的地形算你写的东西要 author.read', () => {
    expect(PLUGIN_METHODS['world.plates']).toEqual(['world.read@1']);
    for (const c of ['dynasties', 'treaties', 'zones', 'relations', 'trade', 'migrations', 'regionStats']) expect(PLUGIN_METHODS[`history.${c}`], c).toEqual(['history.read@1']);
    expect(PLUGIN_METHODS['author.terrain']).toEqual(['author.read@1']);
  });
});

describe('板块、洋流', () => {
  it('每个地块属于哪块板块、洋流的流向和水温偏差:新的一份,和世界里的一样', () => {
    const out = read.worldCells(world, { fields: ['plate', 'currentX', 'currentY', 'currentTemp'] }, noGive);
    expect(out.plate).toEqual(world.tect.plate);
    expect(out.plate!.buffer).not.toBe(world.tect.plate.buffer);
    expect(out.currentX).toEqual(world.currents.u);
    expect(out.currentY).toEqual(world.currents.v);
    expect(out.currentTemp).toEqual(world.currents.sst);
    // 16 种一次取得完
    expect(Object.keys(read.worldCells(world, { fields: ['x', 'y', 'lon', 'lat', 'area', 'elevation', 'water', 'temperature', 'precipitation', 'biome', 'flux', 'seaIce', 'plate', 'currentX', 'currentY', 'currentTemp'] }, noGive))).toHaveLength(16);
  });

  it('板块:有地块的每块一项,地块数加起来是全图;大陆 / 大洋、漂移照世界里的', () => {
    const ps = read.worldPlates(world);
    expect(ps.reduce((s, p) => s + p.cells, 0)).toBe(world.mesh.n);
    for (const p of ps) {
      expect(p.cells).toBe(world.tect.plate.filter((x) => x === p.id).length);
      expect(p.continental).toBe(world.tect.plateContinental[p.id] === 1);
      expect(p).toMatchObject(driftOf(world.tect.plateVx[p.id], world.tect.plateVy[p.id]));
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(world.height);
    }
  });
});

describe('世系、朝代', () => {
  it('人物带上父母、配偶、第几朝、复国之君出自哪位', () => {
    const people = all((a) => read.historyPeople(civ, a));
    expect(people).toHaveLength(civ.people!.length);
    let spouses = 0;
    let moms = 0;
    for (const p of people) {
      const x = civ.people![p.id];
      expect(p.parent).toBe(x.parent);
      expect(p.adopted).toBe(x.adopted);
      expect(p.mom).toBe(x.mom);
      expect(p.husband).toBe(x.husband);
      expect(p.dynasty).toBe(x.dynasty);
      expect(p.descent).toEqual(x.descent);
      expect(p.spouses?.map((s) => [s.polity, s.father, s.year, s.person])).toEqual(x.spouses?.map((s) => [s.polity, s.father, s.year, s.person]));
      if (p.spouses) spouses++;
      if (p.mom !== undefined) moms++;
    }
    expect(spouses).toBeGreaterThan(0);
    expect(moms).toBeGreaterThan(0);
  });

  it('改朝换代过的国家的各朝:键找得回自己,名字、起止照世界里的;能只要某国的;一页最多 2000', () => {
    const ds = all((a) => read.historyDynasties(civ, a));
    expect(ds).toHaveLength(civ.polities.reduce((s, p) => s + (p.dynasties?.length ?? 0), 0));
    expect(ds.some((d) => d.index > 0)).toBe(true);
    for (const d of ds) {
      const p = civ.polities[d.polity];
      expect(resolveKey(civ, d.key)).toEqual({ kind: 'dynasty', id: d.polity, index: d.index });
      expect(d.name).toBe(dynastyTitle(p, d.index));
      expect(d.from).toBe(p.dynasties![d.index].year);
      expect(d.until).toBe(p.dynasties![d.index + 1]?.year ?? p.ended);
    }
    const one = ds.find((d) => d.index > 0)!.polity;
    expect(read.historyDynasties(civ, { polity: one }).items.every((d) => d.polity === one)).toBe(true);
    expect(codeOf(() => read.historyDynasties(civ, { limit: 2001 }))).toBe('limit');
    expect(codeOf(() => read.historyDynasties(civ, { polity: civ.polities.length }))).toBe('bad-args');
  });
});

describe('约、中立地、盟约和宗藩', () => {
  const book = treatyBook(civ);

  it('约:键找得回自己;名字同条约卡片;给了年份只列那年在的,带那年还在约里的几国', () => {
    const ts = all((a) => read.historyTreaties(civ, a));
    expect(ts).toHaveLength(book.treaties.filter(Boolean).length);
    expect(ts.some((t) => t.parties.length >= 3 && t.zone >= 0)).toBe(true);
    for (const t of ts) {
      const x = book.treaties[t.id];
      expect(resolveKey(civ, t.key)).toEqual({ kind: 'treaty', id: t.id });
      expect(t.name).toBe(treatyTitle(civ, t.id));
      expect(t).toMatchObject({ kind: x.kind, how: x.how, parties: x.parties, start: x.start, term: x.term, settlement: x.settlement, region: x.region, zone: x.zone });
      expect(t.until).toBe(Number.isFinite(x.until) ? x.until : undefined);
      expect(t.ended).toBe(x.ended);
      expect(t.renewals.map((r) => r.year)).toEqual(x.renewals.map((r) => r.year));
      expect(t.members).toBeUndefined();
      const y = t.start;
      const at = all((a) => read.historyTreaties(civ, { ...a, year: y }));
      expect(at.find((u) => u.id === t.id)?.members).toEqual(treatyMembersAt(civ, x, y));
      expect(at.every((u) => u.start <= y && (u.ended === undefined || y < u.ended))).toBe(true);
    }
  });

  it('中立地:照世界里的,住过谁也在', () => {
    const zs = all((a) => read.historyZones(civ, a));
    expect(zs).toHaveLength(book.zones.filter(Boolean).length);
    expect(zs.length).toBeGreaterThan(0);
    for (const z of zs) expect(z).toMatchObject({ region: book.zones[z.id].region, treaty: book.zones[z.id].treaty, from: book.zones[z.id].from, residents: book.zones[z.id].residents });
    const z0 = zs[0];
    expect(all((a) => read.historyZones(civ, { ...a, year: z0.from })).some((z) => z.id === z0.id)).toBe(true);
    if (z0.from > 0) expect(all((a) => read.historyZones(civ, { ...a, year: z0.from - 1 })).some((z) => z.id === z0.id)).toBe(false);
  });

  it('盟约、宗藩和国家卡片上的一样;用的人下令结的盟也在,标着 decree', () => {
    const alive = (y: number) => civ.polities.filter((p) => polityAlive(p, y));
    const pair = (a: number, b: number) => `${Math.min(a, b)},${Math.max(a, b)}`;
    // 下令结盟:挑两个那年都在、还没结盟的国家
    const Y = 1500;
    const r0 = relationsAt(civ, Y);
    const ps = alive(Y);
    const [a, b] = ps.flatMap((p) => ps.filter((q) => q.id > p.id && !r0.pacts.some((x) => pair(x.a, x.b) === pair(p.id, q.id))).map((q) => [p.id, q.id]))[0];
    const c2: Civ = { ...civ, interventions: [{ kind: 'ally', a: polityKey(civ, a), b: polityKey(civ, b), from: 1400 }] };
    let allies = 0;
    let vassals = 0;
    for (const y of [300, 900, Y, 2400, civ.endYear]) {
      const rel = read.historyRelations(c2, { year: y });
      allies += rel.alliances.length;
      vassals += rel.vassals.length;
      for (const p of alive(y)) {
        const ties = polityTies(c2, p.id, y);
        const mine = rel.alliances.filter((x) => x.a === p.id || x.b === p.id).map((x) => (x.a === p.id ? x.b : x.a));
        expect(mine.sort(), `${y} 年 ${p.id} 的盟国`).toEqual(ties.allies.map((x) => x.id).sort());
        expect(rel.vassals.filter((x) => x.liege === p.id).map((x) => x.polity).sort()).toEqual(ties.vassals.map((x) => x.id).sort());
        expect(rel.vassals.find((x) => x.polity === p.id)?.liege).toBe(ties.liege?.liege);
      }
    }
    expect(allies).toBeGreaterThan(0);
    expect(vassals).toBeGreaterThan(0);
    expect(read.historyRelations(c2, { year: Y }).alliances.find((x) => pair(x.a, x.b) === pair(a, b))).toMatchObject({ decree: true, foe: -1 });
    expect(codeOf(() => read.historyRelations(civ, {}))).toBe('bad-args');
  });
});

describe('商道、大迁徙', () => {
  it('商道:键找得回自己,货换成物产的名字;给了年份只列那年开通了、还没废的', () => {
    const routes = civ.trade!.routes;
    const ts = all((a) => read.historyTrade(civ, a));
    expect(ts).toHaveLength(routes.length);
    for (const t of ts) {
      const r = routes[t.id];
      expect(resolveKey(civ, t.key)).toEqual({ kind: 'trade', id: t.id });
      expect(t).toMatchObject({ name: r.name, buyer: r.buyer, from: r.from });
      expect(t.goods.map((g) => g.from)).toEqual(r.goods.map((g) => g.from));
      expect(t.events.map((e) => [e.year, e.kind])).toEqual(r.events.map((e) => [e.year, e.kind]));
      expect(t.paths).toEqual(r.paths.map((p) => ({ year: p.year, regions: p.regions })));
    }
    const iron = RESOURCES.indexOf('铁');
    const withIron = routes.find((r) => r.goods.some((g) => g.res === iron));
    if (withIron) expect(ts[withIron.id].goods.some((g) => g.resource === 'iron')).toBe(true);
    const y = 2000;
    const at = all((a) => read.historyTrade(civ, { ...a, year: y }));
    expect(at.length).toBeGreaterThan(0);
    for (const t of at) {
      expect(t.events[0].year).toBeLessThanOrEqual(y);
      expect(t.events.some((e) => e.kind === 'end' && e.year <= y)).toBe(false);
    }
  });

  it('大迁徙:编号、路线、结局照世界里的,方位换成 east 这类', () => {
    const ms = all((a) => read.historyMigrations(civ, a));
    expect(ms).toHaveLength(civ.migrations!.length);
    expect(ms.length).toBeGreaterThan(0);
    ms.forEach((m, i) => {
      const x = civ.migrations![i];
      expect(m).toEqual(defined({ id: i, culture: x.culture, year: x.year, route: x.route, years: x.years, dir: m.dir, size: x.size, push: x.push, pull: x.pull, target: x.target, settled: x.settled, outcome: x.outcome, outcomeYear: x.outcomeYear, polity: x.polity }));
      expect(m.dir).toBe({ 东: 'east', 南: 'south', 西: 'west', 北: 'north' }[x.dir]);
    });
    expect(read.historyMigrations(civ, { offset: 1, limit: 1 }).items[0]?.id).toBe(ms.length > 1 ? 1 : undefined);
  });
});

describe('州的历年数', () => {
  const R = civ.regions.count;
  const dev = civ.development!;
  const ALL = ['population', 'control', 'era', 'dev.production', 'dev.transport', 'dev.information', 'dev.administration', 'dev.mobilization', 'res.grain', 'res.livestock', 'res.copper', 'res.iron', 'res.coal', 'res.timber', 'res.salt', 'res.fish', 'res.oil', 'res.rare', 'res.gold', 'ideology.mandate', 'ideology.law', 'ideology.council', 'ideology.craft', 'ideology.rights', 'ideology.nation', 'ideology.commons'];

  it('每州一个数,和网站自己算的一样(人口、管辖、时代、能力、物产、思潮)', () => {
    // 不在快照年份上的一年
    const y = 1234.5;
    const s = read.historyRegionStats(civ, { year: y, fields: ALL }, noGive);
    expect(Object.keys(s)).toHaveLength(ALL.length);
    const lv = developmentAt(dev, y);
    const rs = resourcesAt(dev, y);
    const id = ideologyAt(civ.ideology!, y);
    const ctl = controlAt(civ, y)!;
    for (let r = 0; r < R; r++) {
      expect(s.population![r]).toBe(Math.fround(regionPopulationAt(civ, r, y)));
      expect(s.control![r]).toBe(Math.fround(controlShare(ctl[r])));
      expect(s.era![r]).toBe(Math.fround(eraLevel(lv, r)));
      expect(s['dev.production']![r]).toBe(lv[r * CAP_COUNT]);
      expect(s['dev.mobilization']![r]).toBe(lv[r * CAP_COUNT + 4]);
      expect(s['res.iron']![r]).toBe(rs[r * RESOURCE_COUNT + 3]);
      expect(s['res.gold']![r]).toBe(rs[r * RESOURCE_COUNT + 10]);
      expect(s['ideology.law']![r]).toBe(id[r * THOUGHT_COUNT + 1]);
    }
  });

  it('不在快照上的年份:能力、物产、思潮在前后两份之间插值,管辖照不晚于那年的最近一份', () => {
    const ys = dev.snapYears;
    const k = ys.findIndex((y) => y >= 1000);
    const [y0, y1] = [ys[k], ys[k + 1]];
    const mid = (y0 + y1) / 2;
    const s = read.historyRegionStats(civ, { year: mid, fields: ['dev.production', 'control'] }, noGive);
    const cy = dev.controlYears!;
    const c0 = cy.filter((y) => y <= mid).length - 1;
    let moved = 0;
    for (let r = 0; r < R; r++) {
      const a = dev.snaps[k][r * CAP_COUNT] / LEVEL_SCALE;
      const b = dev.snaps[k + 1][r * CAP_COUNT] / LEVEL_SCALE;
      expect(s['dev.production']![r]).toBeCloseTo((a + b) / 2, 5);
      if (a !== b) moved++;
      const v = dev.control![c0][r];
      if (v === 0) expect(s.control![r]).toBeNaN();
      else expect(s.control![r]).toBe(Math.fround(controlShare(v)));
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('不认得的、太多的、年份不对的不给', () => {
    expect(codeOf(() => read.historyRegionStats(civ, { year: 1, fields: ['dev.magic'] }, noGive))).toBe('bad-args');
    expect(codeOf(() => read.historyRegionStats(civ, { year: 1, fields: [] }, noGive))).toBe('bad-args');
    expect(codeOf(() => read.historyRegionStats(civ, { year: 1, fields: Array(33).fill('era') }, noGive))).toBe('limit');
    expect(codeOf(() => read.historyRegionStats(civ, { year: civ.endYear + 1, fields: ['era'] }, noGive))).toBe('bad-args');
    // 同一种取两遍只给一份
    const given: ArrayBufferView[] = [];
    read.historyRegionStats(civ, { year: 1, fields: ['era', 'era', 'population'] }, (a) => (given.push(a), a));
    expect(given).toHaveLength(2);
  });
});

describe('用的人改过的名字', () => {
  it('约名、商道名、朝代名照改过的', () => {
    const t = treatyBook(civ).treaties.find(Boolean)!;
    const r = civ.trade!.routes[0];
    const d = all((a) => read.historyDynasties(civ, a)).find((x) => x.index > 0 && x.name)!;
    const named = applyNames(civ, { [treatyKey(civ, t.id)]: '甲子之约', [tradeKey(civ, r.id)]: '丝路', [dynastyKey(civ, d.polity, d.index)]: '新' });
    expect(all((a) => read.historyTreaties(named, a)).find((x) => x.id === t.id)!.name).toBe('甲子之约');
    expect(read.historyTrade(named, {}).items[0].name).toBe('丝路');
    expect(read.historyDynasties(named, { polity: d.polity }).items.find((x) => x.index === d.index)!.name).toBe(civ.polities[d.polity].eastern ? '新' : '新王朝');
  });

  it('这几样的键能拿去 author.apply 改名', () => {
    const t = all((a) => read.historyTreaties(civ, a))[0];
    const r = read.historyTrade(civ, {}).items[0];
    const d = all((a) => read.historyDynasties(civ, a)).find((x) => x.index > 0)!;
    const plan = planChanges(EMPTY_EDITS, civ, { changes: [t, r, d].map((x, i) => ({ kind: 'name', key: x.key, name: `名${i}` })) }, world.params);
    expect(plan.result.applied).toBe(3);
    expect(plan.next.names).toEqual({ [t.key]: '名0', [r.key]: '名1', [d.key]: '名2' });
  });
});

describe('改过的地形', () => {
  it('地形修改、地形大事、草图原样复制一份;没改过 = 空的', () => {
    expect(read.authorTerrain(EMPTY_EDITS)).toEqual({ terrain: [], upheavals: [] });
    const edits: WorldEdits = {
      ...EMPTY_EDITS,
      terrain: [{ kind: 'volcano', pts: [100, 200], r: 20, s: 1 }],
      upheavals: [{ year: 500, ops: [{ kind: 'sink', pts: [10, 10, 30, 12], r: 8, s: 1 }] }],
      sketch: { rest: 'auto', strokes: [{ kind: 'land', r: 12, pts: [5, 5] }] },
    };
    const out = read.authorTerrain(edits);
    expect(out).toEqual({ terrain: edits.terrain, upheavals: edits.upheavals, sketch: edits.sketch });
    out.terrain[0].pts[0] = 999;
    out.upheavals[0].year = 1;
    expect(edits.terrain[0].pts[0]).toBe(100);
    expect(edits.upheavals![0].year).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// 经网站这边回调用、审核试跑:沙箱换成假的

interface FakeSandbox {
  opts: SandboxOptions;
  sent: { id: number; res: PluginResponse }[];
}
const fakes: FakeSandbox[] = [];
vi.mock('../src/plugin/sandbox', () => ({
  startPluginSandbox: async (_code: string, opts: SandboxOptions) => {
    const f: FakeSandbox = { opts, sent: [] };
    fakes.push(f);
    return {
      stopped: null,
      send() {},
      call: async () => undefined,
      ping: async () => {},
      respond(id: number, res: PluginResponse) {
        f.sent.push({ id, res });
      },
      emit() {},
      stop() {},
    };
  },
}));
const { startPluginHost } = await import('../src/plugin/host');

async function open(requires: string[], source: Parameters<typeof startPluginHost>[0]['source'], sink?: Parameters<typeof startPluginHost>[0]['sink']) {
  await startPluginHost({ plugin: { id: 'test', requires }, code: '', source, sink });
  const f = fakes.at(-1)!;
  let seq = 0;
  return (name: string, args?: unknown) => {
    const id = ++seq;
    f.opts.onRequest!(id, name, args);
    return f.sent.find((s) => s.id === id)!.res;
  };
}

describe('回调用', () => {
  const terrain: WorldEdits = { ...EMPTY_EDITS, terrain: [{ kind: 'lake', pts: [300, 300], r: 10, s: 1 }] };
  const source = { world: () => world, civ: () => civ, edits: () => terrain };

  it('没要能力回 no-permission;要了就给', async () => {
    const none = await open(['world.read@1'], source);
    expect(none('history.treaties', {})).toMatchObject({ ok: false, error: { code: 'no-permission' } });
    expect(none('author.terrain')).toMatchObject({ ok: false, error: { code: 'no-permission' } });
    expect(none('world.plates')).toMatchObject({ ok: true });
    const call = await open(['history.read@1', 'author.read@1'], source);
    expect(call('history.relations', { year: 1500 })).toMatchObject({ ok: true });
    expect(call('history.regionStats', { year: 1500, fields: ['era'] })).toMatchObject({ ok: true });
    expect(call('history.regionStats', { year: 1500, fields: ['x'] })).toMatchObject({ ok: false, error: { code: 'bad-args' } });
    expect(call('author.terrain')).toMatchObject({ ok: true, data: { terrain: terrain.terrain, upheavals: [] } });
  });

  it('审核试跑照常:新的调用记进「拿了什么」,试跑的世界里没有改过的地形', async () => {
    const rec = new TrialRecorder({ world, civ, year: civ.endYear, now: () => 1000 });
    const call = await open(['world.read@1', 'history.read@1', 'author.read@1'], rec.source(), rec.sink());
    expect(call('world.plates')).toMatchObject({ ok: true });
    expect(call('history.treaties', {})).toMatchObject({ ok: true });
    expect(call('history.regionStats', { year: 10, fields: ['population'] })).toMatchObject({ ok: true });
    expect(call('author.terrain')).toMatchObject({ ok: true, data: { terrain: [], upheavals: [] } });
    expect(rec.did().got).toBe('地图 1 次（plates）、历史 2 次（treaties、regionStats）、你写的 1 次（terrain）');
  });
});

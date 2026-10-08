/**
 * 地形大事(gen/civ/upheaval.ts;格式见 gen/edits.ts 文件头"地形大事"):选一年让火山喷发、地震抬升、海水漫进来。
 * - 格式:清理(年份取整夹回范围、只认三种修改、件数和笔数有上限)、同一年的合成一件、存档往返
 * - 大事那一年以前:日志、史事、名字、人物、信仰、地名、道路和没有大事时一致;没有大事 = 逐字节不变
 * - 后果:沉了的州没人住、城没于水(不再重建)、国都迁走;火山毁城;隆起的陆地连起两块陆地;编年史并成一条
 * - 确定性:同样的大事两次推演逐字节相同
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { mergeUpheavals, upheavalSteps, type UpheavalStep } from '../src/gen/civ/upheaval';
import { buildChronicle } from '../src/gen/civ/chronicle';
import { ownersAt } from '../src/gen/civ/timeline';
import { capitalAt } from '../src/gen/civ/growth';
import { UPHEAVALS_MAX, UPHEAVAL_OPS_MAX, UPHEAVAL_YEARS, cleanUpheavals, sameUpheavals } from '../src/gen/terrainEdits';
import { EMPTY_EDITS, type Upheaval } from '../src/gen/edits';
import { editCount, makeSave, parseSave, saveText } from '../src/gen/savefile';

const PARAMS = { ...DEFAULT_PARAMS, seed: 7 };
/** 种子 7 上的三件大事:大霄国都一带海水漫进来、兹拉季纳国都一带火山喷发、两国之间的海峡隆起 */
const FLOOD: Upheaval = { year: 1600, ops: [{ kind: 'sink', pts: [1856, 574, 1936, 584], r: 40, s: 1.1 }] };
const VOLCANO: Upheaval = { year: 1800, ops: [{ kind: 'volcano', pts: [1278, 768], r: 36, s: 1.1 }] };
const BRIDGE: Upheaval = { year: 2000, ops: [{ kind: 'raise', pts: [1566, 632, 1604, 670], r: 18, s: 1.1 }] };

let w0: World | null = null;
const world = () => (w0 ??= generateWorld(PARAMS));
let plain: Civ | null = null;
const base = () => (plain ??= generateCiv(world()));
const stepsCache = new Map<string, UpheavalStep[]>();
const steps = (list: Upheaval[]) => {
  const key = JSON.stringify(list);
  let s = stepsCache.get(key);
  if (!s) stepsCache.set(key, (s = upheavalSteps(PARAMS, [], null, list)));
  return s;
};
const civs = new Map<string, Civ>();
const civOf = (list: Upheaval[]) => {
  const key = JSON.stringify(list);
  let c = civs.get(key);
  if (!c) civs.set(key, (c = generateCiv(world(), { upheavals: steps(list) })));
  return c;
};

const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
function logBefore(civ: Civ, y: number) {
  const L = civ.log;
  let n = 0;
  while (n < L.size && L.year[n] < y) n++;
  return { n, parts: (['year', 'region', 'layer', 'value', 'cause'] as const).map((k) => bytes(L[k].subarray(0, n))) };
}
/** 大事那一年以前出现过的名字、配色 */
function namesBefore(civ: Civ, y: number, R: number) {
  return JSON.stringify({
    polities: civ.polities.filter((p) => p.founded < y).map((p) => [p.name, p.color, p.eastern, (p.dynasties ?? []).filter((d) => d.year < y).map((d) => d.name)]),
    settlements: civ.settlements.filter((s) => s.founded < y).map((s) => s.name),
    cultures: civ.cultures.map((c) => [c.name, c.style, c.color]),
    regions: (civ.regions.name ?? []).slice(0, R),
  });
}
/** 大事那一年以前的人物(编号可能因为之后多出来的人错开,按内容比) */
const peopleBefore = (civ: Civ, y: number) =>
  JSON.stringify(
    (civ.people ?? [])
      .filter((p) => (p.from ?? Infinity) < y)
      .map((p) => [p.role, p.name, p.polity, p.from, p.born])
      .sort(),
  );
function religionBefore(civ: Civ, y: number, R: number) {
  const r = civ.religion!;
  return JSON.stringify({
    events: r.events.filter((e) => e.year < y).map((e) => [e.year, e.kind, r.faiths[e.faith].name, e.polity, e.region, e.settlement]),
    states: r.states.filter((s) => s.from < y).map((s) => [s.polity, r.faiths[s.faith].name, s.from, s.until !== undefined && s.until < y ? s.until : null]),
    checkpoints: r.checkpoints.filter((c) => c.year < y).map((c) => [c.year, Array.from(c.faith.subarray(0, R))]),
  });
}
const placesOf = (ps: Civ['places']) => JSON.stringify(ps.map((p) => [p.kind, p.name, p.cell, p.path.length]));

describe('地形大事 · 格式', () => {
  it('清理:年份取整夹回范围,只认火山 / 抬起陆地 / 沉成海,一笔不剩的丢掉,最多几件几笔;本来就合格的原样返回', () => {
    const ok = [FLOOD, VOLCANO];
    expect(cleanUpheavals(ok)).toBe(ok);
    expect(cleanUpheavals(null)).toEqual([]);
    const lake = { kind: 'lake', pts: [100, 100], r: 10, s: 1 };
    const got = cleanUpheavals([
      { year: 1600.7, ops: [FLOOD.ops[0], lake] },
      { year: -5, ops: VOLCANO.ops },
      { year: 99999, ops: BRIDGE.ops },
      { year: 1200, ops: [lake] },
      { year: 'x', ops: VOLCANO.ops },
      'nope',
    ]);
    expect(got).toEqual([
      { year: 1600, ops: FLOOD.ops },
      { year: UPHEAVAL_YEARS[0], ops: VOLCANO.ops },
      { year: UPHEAVAL_YEARS[1], ops: BRIDGE.ops },
    ]);
    const many = Array.from({ length: UPHEAVALS_MAX + 3 }, (_, i) => ({ year: 100 + i, ops: VOLCANO.ops }));
    expect(cleanUpheavals(many)).toHaveLength(UPHEAVALS_MAX);
    const strokes = Array.from({ length: UPHEAVAL_OPS_MAX + 5 }, () => FLOOD.ops[0]);
    expect(cleanUpheavals([{ year: 10, ops: strokes }])[0].ops).toHaveLength(UPHEAVAL_OPS_MAX);
    expect(sameUpheavals([FLOOD], [{ year: 1600, ops: [{ ...FLOOD.ops[0], pts: FLOOD.ops[0].pts.slice() }] }])).toBe(true);
    expect(sameUpheavals([FLOOD], [VOLCANO])).toBe(false);
    expect(sameUpheavals(undefined, [])).toBe(true);
  });

  it('按年份排,同一年的按列表先后合成一件(修改接在一起,记下是哪几件);年份不在推演里的不算', () => {
    const m = mergeUpheavals([VOLCANO, FLOOD, { year: 1800, ops: BRIDGE.ops }, { year: 3000, ops: BRIDGE.ops }]);
    expect(m.map((u) => [u.year, u.items, u.ops.map((o) => o.kind)])).toEqual([
      [1600, [1], ['sink']],
      [1800, [0, 2], ['volcano', 'raise']],
    ]);
  });

  it('存档:存读往返不变,改了几处把地形大事算进去;格式不对的跳过并提示;没有地形大事不写这一项', () => {
    const edits = { ...EMPTY_EDITS, upheavals: [FLOOD, BRIDGE] };
    const save = makeSave(PARAMS, edits, 'x', '世界', '2026-10-08T00:00:00.000Z');
    expect(editCount(save.edits)).toBe(2);
    const back = parseSave(saveText(save));
    expect(back.ok && back.save.edits.upheavals).toEqual([FLOOD, BRIDGE]);
    expect('upheavals' in makeSave(PARAMS, EMPTY_EDITS, 'x').edits).toBe(false);
    const raw = JSON.parse(saveText(save));
    raw.edits.upheavals.push({ year: 5, ops: [] }, 'bad');
    const r = parseSave(JSON.stringify(raw));
    expect(r.ok && r.save.edits.upheavals).toEqual([FLOOD, BRIDGE]);
    expect(r.ok && r.warnings.some((w) => w.includes('2 件地形大事'))).toBe(true);
  });
});

describe('地形大事 · 推演', () => {
  it('没有地形大事:和不加这一项逐字节相同', () => {
    const a = base();
    const b = generateCiv(world(), { upheavals: [] });
    expect(logBefore(b, Infinity)).toEqual(logBefore(a, Infinity));
    expect(JSON.stringify(b.annals)).toBe(JSON.stringify(a.annals));
    expect(b.eras).toBeUndefined();
    expect(b.upheavals).toBeUndefined();
  }, 120_000);

  it('三件连着发生:第一件那一年以前的日志、史事、名字、人物、信仰、地名、道路和没有大事时一样', () => {
    const a = base();
    const b = civOf([FLOOD, VOLCANO, BRIDGE]);
    const Y = FLOOD.year;
    const R = a.regions.count;
    expect(logBefore(b, Y)).toEqual(logBefore(a, Y));
    expect(JSON.stringify(b.annals.filter((e) => e.year < Y))).toBe(JSON.stringify(a.annals.filter((e) => e.year < Y)));
    expect(namesBefore(b, Y, R)).toBe(namesBefore(a, Y, R));
    expect(peopleBefore(b, Y)).toBe(peopleBefore(a, Y));
    expect(religionBefore(b, Y, R)).toBe(religionBefore(a, Y, R));
    expect(b.eras!.map((e) => e.until)).toEqual([1600, 1800, 2000]);
    expect(placesOf(b.eras![0].places)).toBe(placesOf(a.places));
    expect(JSON.stringify(b.eras![0].routes)).toBe(JSON.stringify(a.routes));
    expect(b.upheavals!.map((u) => [u.year, u.kinds, u.items])).toEqual([
      [1600, ['sink'], [0]],
      [1800, ['volcano'], [1]],
      [2000, ['raise'], [2]],
    ]);
    // 第二件以前和"只有第一件"一样
    const one = civOf([FLOOD]);
    expect(logBefore(b, VOLCANO.year)).toEqual(logBefore(one, VOLCANO.year));
    expect(JSON.stringify(b.annals.filter((e) => e.year < VOLCANO.year))).toBe(JSON.stringify(one.annals.filter((e) => e.year < VOLCANO.year)));
  }, 300_000);

  it('海水漫进来:整州沉没的州从那一刻起没人住,城没于水、不再重建,国都迁走;编年史并成一条', () => {
    const b = civOf([FLOOD]);
    const Y = FLOOD.year;
    const f = b.upheavals![0];
    expect(f.drowned.length).toBeGreaterThan(0);
    for (const r of f.drowned) expect(b.regions.cellStart[r + 1] - b.regions.cellStart[r]).toBe(0);
    const after = ownersAt(b, Y + 0.5);
    for (const r of f.drowned) {
      expect(after.polity[r]).toBe(-1);
      expect(after.culture[r]).toBe(-1);
      expect(b.polity[r]).toBe(-1);
    }
    const sunk = b.annals.filter((e) => e.kind === 'sunk' && e.year === Y);
    expect(sunk.length).toBeGreaterThan(1);
    const last = steps([FLOOD])[0].world;
    for (const e of sunk) {
      expect(e.b).toBe(1);
      expect(b.settlements[e.settlement].ended).toBe(Y);
      expect(last.water[b.settlements[e.settlement].cell]).not.toBe(0);
      expect(b.settlements.some((s) => s.rebuilds === e.settlement)).toBe(false);
    }
    // 结束时还在的城都在陆地上
    for (const s of b.settlements) if (s.ended === undefined) expect(last.water[s.cell]).toBe(0);
    // 大霄的国都沉了,迁都
    const p = b.polities[f.polity];
    expect(capitalAt(p, Y - 1 / 256)).toBe(sunk[0].settlement);
    expect(b.settlements[capitalAt(p, Y + 0.5)].ended).toBeUndefined();
    const e = buildChronicle(b).find((x) => x.kind === 'upheaval')!;
    expect(e.tag).toBe('变');
    expect(e.importance).toBe(3);
    expect(e.text).toMatch(/^海水漫入.+州沉入海中,国都.+城没于水,迁都.+$/);
    expect(e.children!.filter((c) => c.kind === 'sunk')).toHaveLength(sunk.length);
    expect(buildChronicle(b).some((x) => x.kind === 'sunk')).toBe(false);
  }, 300_000);

  it('火山喷发:山下的国都被毁、迁都;隆起的陆地连起两块陆地;同一年的两件合成一件', () => {
    const v = civOf([VOLCANO]);
    const ev = buildChronicle(v).find((x) => x.kind === 'upheaval')!;
    expect(ev.text).toMatch(/境内火山喷发,国都.+被毁,迁都/);
    const burnt = v.annals.filter((e) => e.kind === 'sunk');
    expect(burnt.length).toBeGreaterThan(0);
    for (const e of burnt) expect(e.b).toBe(0);

    const r = civOf([BRIDGE]);
    const f = r.upheavals![0];
    expect(f.joined).toBeDefined();
    expect(f.joinedBy![0]).not.toBe(f.joinedBy![1]);
    expect(buildChronicle(r).find((x) => x.kind === 'upheaval')!.text).toMatch(/之间的海峡隆起成陆$/);
    // 新冒出来的陆地都分进了州
    const w = steps([BRIDGE])[0].world;
    for (let c = 0; c < w.mesh.n; c++) if (w.water[c] === 0) expect(r.regions.of[c]).toBeGreaterThanOrEqual(0);

    const both = steps([VOLCANO, { year: VOLCANO.year, ops: BRIDGE.ops }]);
    expect(both).toHaveLength(1);
    expect(both[0].items).toEqual([0, 1]);
    expect(both[0].ops.map((o) => o.kind)).toEqual(['volcano', 'raise']);
  }, 300_000);

  it('确定性:同样的大事两次推演逐字节相同', () => {
    const a = civOf([FLOOD, VOLCANO, BRIDGE]);
    const b = generateCiv(world(), { upheavals: upheavalSteps(PARAMS, [], null, [FLOOD, VOLCANO, BRIDGE]) });
    expect(logBefore(b, Infinity)).toEqual(logBefore(a, Infinity));
    expect(JSON.stringify(b.annals)).toBe(JSON.stringify(a.annals));
    expect(JSON.stringify(b.polities)).toBe(JSON.stringify(a.polities));
    expect(JSON.stringify(b.settlements)).toBe(JSON.stringify(a.settlements));
    expect(placesOf(b.places)).toBe(placesOf(a.places));
    expect(JSON.stringify(b.upheavals)).toBe(JSON.stringify(a.upheavals));
  }, 300_000);
});

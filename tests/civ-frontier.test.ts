/**
 * 拓荒与起源(gen/civ/frontier.ts):新建世界时调民族扩散、国家扩张快慢,各种地形难走的程度;自己选文明从哪里起源;
 * 干预"立国"立在没人住的州时,一支新民族来这里落脚。
 * - 都不调(或调成和默认一样)和不给逐字节一致
 * - 民族扩散快了,住满得早;国家扩张快了,没有国家的部落地少;某种地形难走了,人到那里晚
 * - 自选起源:第 0 年从点的几处出现;"只有这几支"就只有这几个民族;住不了人的点跳过
 * - 没人住的州立国:新民族那一年在那里兴起,之前的历史逐字节一致(备着没用上的也不影响信仰);地形大事里新冒出来的陆地也立得成;
 *   住不了人的州立不成,写明原因
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { Layer } from '../src/gen/civ/types';
import { Biome } from '../src/gen/biomes';
import { HABITABLE_SUIT } from '../src/gen/civ/story/display';
import { cleanFrontier, cleanOrigins, filledYear, frontierBrief, frontierFx, sameFrontier, speedText, terrainBrief, terrainText, TERRAIN_GROUPS } from '../src/gen/civ/frontier';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { buildChronicle, interventionOutcome } from '../src/gen/civ/story/chronicle';
import { regionKey, type Intervention } from '../src/gen/edits';
import { fullChronicle } from '../src/gen/civ/story/religionText';
import { upheavalSteps } from '../src/gen/civ/upheaval';
import { originCiv, originSpots } from '../src/ui/studio/origins';

const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
}
const bases = new Map<number, Civ>();
function base(seed: number): Civ {
  let c = bases.get(seed);
  if (!c) bases.set(seed, (c = generateCiv(world(seed))));
  return c;
}

const bytes = (a: ArrayBufferView) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

/** 推演结果的"指纹":民族、城、国家、史事、日志、最终归属 */
function print(c: Civ): string {
  const L = c.log;
  return [
    JSON.stringify(c.cultures),
    JSON.stringify(c.settlements),
    JSON.stringify(c.polities),
    JSON.stringify(c.annals),
    ...(['year', 'region', 'layer', 'value', 'cause'] as const).map((k) => bytes(L[k].subarray(0, L.size)).toString('base64')),
    bytes(c.culture).toString('base64'),
    bytes(c.polity).toString('base64'),
  ].join('|');
}

const habitable = (c: Civ, r: number) => c.habitat.suitability[c.regions.seat[r]] >= HABITABLE_SUIT;

/** 各州第一次有人住的年份(没人到 = Infinity) */
function settledYears(c: Civ): Float64Array {
  const first = new Float64Array(c.regions.count).fill(Infinity);
  const L = c.log;
  for (let i = 0; i < L.size; i++) if (L.layer[i] === Layer.Culture && L.value[i] >= 0 && first[L.region[i]] === Infinity) first[L.region[i]] = L.year[i];
  return first;
}

/** 九成可居州有人住的年份 */
function y90(c: Civ): number {
  const first = settledYears(c);
  const ts: number[] = [];
  for (let r = 0; r < c.regions.count; r++) if (habitable(c, r)) ts.push(first[r]);
  ts.sort((a, b) => a - b);
  return ts[Math.ceil(0.9 * ts.length) - 1];
}

/** 推演结束时有人住的州里没有国家的比例 */
function stateless(c: Civ): number {
  // 第 1500、2000、2500 年和结束那年的平均(只看一年,碰上大崩解、亡国散回部落的那几年数会跳;GENERATOR_VERSION 43 仗打得密以后跳得更多)
  let sum = 0;
  const years = [1500, 2000, 2500, c.endYear];
  for (const y of years) {
    const o = ownersAt(c, y);
    let peo = 0;
    let none = 0;
    for (let r = 0; r < c.regions.count; r++) {
      if (o.culture[r] < 0) continue;
      peo++;
      if (o.polity[r] < 0) none++;
    }
    sum += none / peo;
  }
  return sum / years.length;
}

/** 州 r 治所的世界坐标 */
function at(c: Civ, w: World, r: number): [number, number] {
  const s = c.regions.seat[r];
  return [Math.round(w.mesh.x[s]), Math.round(w.mesh.y[s])];
}

describe('拓荒 · 数据格式', () => {
  it('cleanFrontier:吸到最近的一档,和默认一样的去掉;都没调 = undefined', () => {
    expect(cleanFrontier(undefined)).toBeUndefined();
    expect(cleanFrontier({})).toBeUndefined();
    expect(cleanFrontier({ spread: 1, expand: 1.02, terrain: { forest: 1, tundra: 11 } })).toBeUndefined();
    expect(cleanFrontier({ spread: 1.48, expand: 'x', terrain: { desert: 6.3, rainforest: 3, nope: 4 } })).toEqual({ spread: 1.5, terrain: { desert: 6, rainforest: 3 } });
    expect(cleanFrontier({ spread: 99, terrain: { mountain: 0 } })).toEqual({ spread: 3, terrain: { mountain: 0.5 } });
    expect(sameFrontier(cleanFrontier({ spread: 2 }), { spread: 2 })).toBe(true);
    expect(sameFrontier(undefined, { spread: 2 })).toBe(false);
  });

  it('frontierFx:没调全是 1;调了的那组按"值 ÷ 默认值"缩放,国家的缓一些', () => {
    const d = frontierFx(undefined);
    expect([...d.people].every((x) => x === 1) && [...d.state].every((x) => x === 1) && d.peopleMtn === 1 && d.stateMtn === 1).toBe(true);
    const fx = frontierFx({ terrain: { desert: 5.2, mountain: 4.4 } });
    for (const b of [Biome.HotDesert, Biome.TemperateDesert, Biome.ColdDesert]) {
      expect(fx.people[b]).toBe(2);
      expect(fx.state[b]).toBeCloseTo(2 ** (2 / 3), 5);
    }
    expect(fx.people[Biome.Steppe]).toBe(1);
    expect(fx.peopleMtn).toBe(2);
    expect(TERRAIN_GROUPS.find((g) => g.key === 'forest')!.def).toBe(1);
  });

  it('显示:约第几年住满、地形值的写法', () => {
    expect(filledYear(1)).toBe(3000);
    expect(filledYear(1.5)).toBe(2000);
    expect(filledYear(2)).toBe(1500);
    expect(terrainText(1)).toBe('1.0');
    expect(terrainText(2.6)).toBe('2.6');
    expect(terrainText(11)).toBe('11');
    expect(speedText(1.5)).toBe('1.50×');
    const f = cleanFrontier({ spread: 1.5, expand: 2, terrain: { rainforest: 3, desert: 6 } });
    expect(terrainBrief(f)).toBe('雨林 3，沙漠 6，其余默认');
    expect(terrainBrief(undefined)).toBe('默认');
    expect(frontierBrief(f)).toBe('民族 1.5×，国家 2×，地形改过 2 样');
    expect(frontierBrief(undefined)).toBe('');
  });

  it('cleanOrigins:坐标取整、绕回、去重,最多 16 处;一处也没有 = undefined', () => {
    expect(cleanOrigins(undefined)).toBeUndefined();
    expect(cleanOrigins({ pts: [] })).toBeUndefined();
    expect(cleanOrigins({ pts: [100.4, 200.6, 2148, -5, 100, 201, 'x', 3] })).toEqual({ pts: [100, 201, 100, 0] });
    expect(cleanOrigins({ pts: [1, 2], only: true })).toEqual({ pts: [1, 2], only: true });
    expect(cleanOrigins({ pts: Array.from({ length: 40 }, (_, i) => i * 10) })!.pts.length).toBe(32);
  });
});

describe('拓荒 · 推演', () => {
  it('都不调、调成和默认一样:和不给逐字节一致', () => {
    for (const seed of [7, 2024]) {
      const c = generateCiv(world(seed), { frontier: { spread: 1, expand: 1, terrain: { forest: 1, desert: 2.6 } }, origins: { pts: [] } });
      expect(print(c), `seed ${seed}`).toBe(print(base(seed)));
      expect(c.frontier).toBeUndefined();
    }
  }, 120_000);

  it('民族扩散 2×:住满早一大截;0.5×:到第 3000 年住不满', () => {
    for (const seed of [7, 2024]) {
      const d = y90(base(seed));
      const fast = generateCiv(world(seed), { frontier: { spread: 2 } });
      // GENERATOR_VERSION 18 起 seed 2024 是 0.67(东岸湿了,最后住满的是远处的海岛,要等能远洋)
      expect(y90(fast), `seed ${seed}`).toBeLessThan(d * 0.7);
      expect(fast.frontier).toEqual({ spread: 2 });
      const slow = generateCiv(world(seed), { frontier: { spread: 0.5 } });
      expect(y90(slow), `seed ${seed}`).toBe(Infinity);
    }
  }, 120_000);

  it('国家扩张 2×:有人住却没有国家的地少了;0.5×:多了', () => {
    for (const seed of [7, 2024]) {
      const d = stateless(base(seed));
      expect(stateless(generateCiv(world(seed), { frontier: { expand: 2 } })), `seed ${seed}`).toBeLessThan(d * 0.85);
      expect(stateless(generateCiv(world(seed), { frontier: { expand: 0.5 } })), `seed ${seed}`).toBeGreaterThan(d * 1.5);
    }
  }, 120_000);

  it('雨林、沙漠难走了:人到那里晚;别的地方几乎不受影响', () => {
    for (const seed of [7, 2024]) {
      const c0 = base(seed);
      const c1 = generateCiv(world(seed), { frontier: { terrain: { rainforest: 8, desert: 14 } } });
      const f0 = settledYears(c0);
      const f1 = settledYears(c1);
      const hard = new Set<number>([Biome.Rainforest, Biome.TemperateRainforest, Biome.HotDesert, Biome.TemperateDesert, Biome.ColdDesert]);
      let n = 0;
      let later = 0;
      for (let r = 0; r < c0.regions.count; r++) {
        if (!hard.has(c0.regions.biome[r]) || !habitable(c0, r) || f0[r] === Infinity) continue;
        n++;
        if (f1[r] > f0[r]) later++;
      }
      expect(n, `seed ${seed}:有这几种地形的有人州`).toBeGreaterThan(5);
      expect(later / n, `seed ${seed}`).toBeGreaterThan(0.7);
      expect(c1.frontier).toEqual({ terrain: { rainforest: 8, desert: 14 } });
    }
  }, 120_000);
});

describe('起源', () => {
  /** 可居州里挑几个离得远的 */
  function picks(c: Civ, n: number): number[] {
    const hab: number[] = [];
    for (let r = 0; r < c.regions.count; r++) if (habitable(c, r)) hab.push(r);
    return Array.from({ length: n }, (_, i) => hab[Math.floor(((i + 0.5) * hab.length) / n)]);
  }

  it('只有这几支:民族就是点的这几个,按点的先后,都在第 0 年从那里出现;落在海上的点跳过', () => {
    for (const seed of [7, 2024]) {
      const c0 = base(seed);
      const w = world(seed);
      const rs = picks(c0, 3);
      // 第二个点放在海上(找一个水上的地块)
      let sea = 0;
      while (w.water[sea] === 0) sea++;
      const pts = [...at(c0, w, rs[0]), Math.round(w.mesh.x[sea]), Math.round(w.mesh.y[sea]), ...at(c0, w, rs[1]), ...at(c0, w, rs[2])];
      const c = generateCiv(w, { origins: { pts, only: true } });
      // 推演中分化出来的民族(Culture.parent)不算
      const roots = c.cultures.filter((x) => x.parent === undefined);
      expect(roots.map((x) => x.hearth), `seed ${seed}`).toEqual(rs);
      expect(roots.every((x) => x.born === 0)).toBe(true);
      for (const r of rs) expect(ownersAt(c, 0.5).culture[r]).toBeGreaterThanOrEqual(0);
    }
  }, 120_000);

  it('别处也自动长:总数照自动的定,点的几处排最前、第 0 年出现,其余照常陆续出现', () => {
    for (const seed of [7, 2024]) {
      const c0 = base(seed);
      const w = world(seed);
      const rs = picks(c0, 2);
      const c = generateCiv(w, { origins: { pts: rs.flatMap((r) => at(c0, w, r)) } });
      // 推演中分化出来的民族(Culture.parent)不算
      const roots = (x: Civ) => x.cultures.filter((cu) => cu.parent === undefined);
      expect(roots(c).length, `seed ${seed}`).toBe(roots(c0).length);
      expect(c.cultures.slice(0, 2).map((x) => [x.hearth, x.born])).toEqual(rs.map((r) => [r, 0]));
      expect(roots(c).slice(2).some((x) => x.born > 0)).toBe(true);
      // 扩张节拍按自动起源标定:不因为点了起源变快变慢
      expect(c.spreadYears).toBe(c0.spreadYears);
    }
  }, 120_000);
});

describe('没人住的州立国', () => {
  /** y 年还没人住、住得了人的州 */
  function emptyHabitable(c: Civ, y: number): number {
    const own = ownersAt(c, y - 0.01);
    for (let r = 0; r < c.regions.count; r++) if (own.culture[r] < 0 && habitable(c, r) && c.culture[r] >= 0) return r;
    throw new Error('找不到');
  }

  it('一支新民族那一年在那里兴起,国家就是它的;之前的历史逐字节一致;编年史写"本无人居"', () => {
    for (const seed of [7, 2024]) {
      const c0 = base(seed);
      const y = 600;
      const r = emptyHabitable(c0, y);
      const v: Intervention = { kind: 'found', region: regionKey(c0, r), from: y, name: '饕餮' };
      const c = generateCiv(world(seed), { interventions: [v] });
      const iv = c.annals.find((e) => e.kind === 'intervene')!;
      const p = c.polities[iv.a];
      expect(p, `seed ${seed}`).toBeTruthy();
      expect(p.name).toBe('饕餮');
      const cu = c.cultures[p.culture];
      expect(cu.pioneer).toBe(0);
      expect(cu.hearth).toBe(r);
      expect(cu.born).toBe(y);
      expect(cu.unborn).toBeUndefined();
      // 之后可能被同化(消亡),但不会早于立国那一年
      expect(cu.ended === undefined || cu.ended > y).toBe(true);
      expect(ownersAt(c, y).culture[r]).toBe(cu.id);
      // 别的民族照旧(编号、名字、发源地、诞生年份、语感);颜色按整段历史里的接壤配,立国以后接壤变了可能换一种。
      // 那一年以后分化出的民族跟着之后的历史变,不比
      const old = (x: Civ) => JSON.stringify(x.cultures.filter((u) => u.pioneer === undefined && (u.parent === undefined || u.born < y)).map((u) => [u.id, u.name, u.hearth, u.born, u.style]));
      expect(old(c)).toBe(old(c0));
      const L = c.log;
      let n = 0;
      while (n < L.size && L.year[n] < y) n++;
      for (const k of ['year', 'region', 'layer', 'value', 'cause'] as const) expect(bytes(L[k].subarray(0, n)).equals(bytes(c0.log[k].subarray(0, n)))).toBe(true);
      expect(JSON.stringify(c.annals.filter((e) => e.year < y))).toBe(JSON.stringify(c0.annals.filter((e) => e.year < y)));
      const text = buildChronicle(c).find((e) => e.kind === 'intervene')!.text;
      expect(text).toMatch(new RegExp(`^【干预】.+本无人居,${cu.name}人徙居于此,立国,号饕餮`));
      expect(interventionOutcome(c, 0)).toMatchObject({ ok: true });
    }
  }, 180_000);

  it('州里已经有人住:照常以当地民族立国,备的新民族没用上(一州也没有,史书里不列)', () => {
    const seed = 7;
    const c0 = base(seed);
    // GENERATOR_VERSION 56 以后第 2800 年那一州立的国改了西罗斯皇帝后来的战绩,早先编年史里他的称号跟着变(二世 → 大帝),换成第 2700 年
    const y = 2700;
    const own = ownersAt(c0, y - 0.01);
    let r = 0;
    while (own.culture[r] < 0) r++;
    const c = generateCiv(world(seed), { interventions: [{ kind: 'found', region: regionKey(c0, r), from: y }] });
    const p = c.polities[c.annals.find((e) => e.kind === 'intervene')!.a];
    expect(p.culture).toBe(own.culture[r]);
    const extra = c.cultures[c.cultures.length - 1];
    expect(extra.pioneer).toBe(0);
    expect(extra.unborn).toBe(true);
    expect([...c.culture].includes(extra.id)).toBe(false);
    const old = (x: Civ) => x.cultures.filter((u) => u.pioneer === undefined && (u.parent === undefined || u.born < y)).map((u) => u.name);
    expect(old(c)).toEqual(old(c0));
    // 备着没用上的那支不影响之前的历史:信仰(大教分派按编号取随机数)和编年史一字不差
    const before = (x: Civ) => JSON.stringify(fullChronicle(x).filter((e) => e.year < y).map((e) => e.text));
    expect(before(c)).toBe(before(c0));
    const greats = (x: Civ) => JSON.stringify(x.religion!.faiths.filter((f) => f.kind !== 'folk' && f.founded! < y).map((f) => [f.name, f.kind, f.form, f.founded]));
    expect(greats(c)).toBe(greats(c0));
  }, 120_000);

  it('地形大事里新冒出来的陆地:大事以后在那里立国,新民族照样来落脚;选起源按第 0 年的海陆看', () => {
    const seed = 7;
    const P = { ...DEFAULT_PARAMS, seed };
    // 落日洋里抬起一片新陆地(第 2000 年)
    const steps = upheavalSteps(P, [], null, [{ year: 2000, ops: [{ kind: 'raise', pts: [600, 350], r: 60, s: 1.1 }] }]);
    const c0 = generateCiv(world(seed), { upheavals: steps });
    const R0 = c0.eras![0].regions.count;
    const own = ownersAt(c0, 2000.5);
    let r = R0;
    while (r < c0.regions.count && !(habitable(c0, r) && own.culture[r] < 0)) r++;
    expect(r).toBeLessThan(c0.regions.count);
    const c = generateCiv(world(seed), { upheavals: steps, interventions: [{ kind: 'found', region: regionKey(c0, r), from: 2001, name: '饕餮' }] });
    expect(interventionOutcome(c, 0)).toMatchObject({ ok: true });
    const p = c.polities[c.annals.find((e) => e.kind === 'intervene')!.a];
    const cu = c.cultures[p.culture];
    expect(cu.pioneer).toBe(0);
    expect(cu.hearth).toBe(r);
    expect(cu.born).toBe(2001);
    expect(cu.name).toBeTruthy();
    // 别的民族的名字、配色照没有这条干预时
    // (第 2001 年以后分化出的民族跟着之后的历史变,不比)
    const old = (x: Civ) => JSON.stringify(x.cultures.filter((u) => u.pioneer === undefined && (u.parent === undefined || u.born < 2001)).map((u) => [u.name, u.color]));
    expect(old(c)).toBe(old(c0));
    // 那片地第 0 年是海:选起源时点在那里落在水上
    expect(originSpots(world(seed), originCiv(c0), [600, 350])[0].region).toBe(-1);
  }, 240_000);

  it('住不了人的州立不成,写明原因', () => {
    const seed = 7;
    const c0 = base(seed);
    let r = 0;
    while (habitable(c0, r)) r++;
    const c = generateCiv(world(seed), { interventions: [{ kind: 'found', region: regionKey(c0, r), from: 800 }] });
    expect(c.polities.length).toBe(c0.polities.length);
    expect(interventionOutcome(c, 0)).toMatchObject({ ok: false, why: expect.stringMatching(/住不了人$/) });
    expect(buildChronicle(c).find((e) => e.kind === 'intervene')!.text).toMatch(/然其地不可居$/);
  }, 120_000);
});

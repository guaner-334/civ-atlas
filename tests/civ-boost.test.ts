/**
 * 推一把发展(干预 boost,gen/civ/boost.ts):
 * - 清理:快几倍吸到 3 / 10、管到哪年不给 = 50 年;直接进不要 until;几州去重、去掉格式不对的
 * - 下了但还没到生效那年:历史逐字节不变(发展度的规则多乘的「推」没推的州是 1,不改任何一个数;没下这条干预的世界不变另由 determinism.test.ts 的指纹管着)
 * - 直接进:那一刻整国四样能力拉到国都的下一个时代开头,"始入某时代""为天下之先"和带出来的发明记在那一刻;史事 n = 州数 × 16 + 时代
 * - 快 10 倍管 50 年:进下一个时代的州比不推、快 3 倍多;到期以后照常长
 * - 几州:只推那几州;那一年这国已亡:不生效,写原因
 * - 直接进之后、快几倍管着的那几年里停下接着推,和一口气推完逐字段相等
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { capitalAt } from '../src/gen/civ/growth';
import { ERAS, developmentAt, eraLevel, eraOf } from '../src/gen/civ/development';
import { BOOST_N } from '../src/gen/civ/boost';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { interventionFate } from '../src/gen/stepwise';
import { cleanIntervention, polityKey, regionKey, type Intervention } from '../src/gen/edits';

const SEED = 2024;
let w: World | null = null;
const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, seed: SEED }));
let base: Civ | null = null;
const baseCiv = () => (base ??= generateCiv(world()));

/** T 年州最多的国家 */
function biggestAt(civ: Civ, T: number): number {
  const n = new Map<number, number>();
  for (const o of ownersAt(civ, T).polity) if (o >= 0) n.set(o, (n.get(o) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** y 年 pid 的州各在第几个时代 */
function erasOf(civ: Civ, pid: number, y: number): number[] {
  const own = ownersAt(civ, y).polity;
  const lv = developmentAt(civ.development!, y);
  const out: number[] = [];
  for (let r = 0; r < own.length; r++) if (own[r] === pid) out.push(eraOf(eraLevel(lv, r)).era);
  return out;
}

const capRegion = (civ: Civ, pid: number, y: number) => civ.settlements[capitalAt(civ.polities[pid], y)].region;

function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

describe('推一把发展(boost)', () => {
  it('清理:快几倍吸到 3 / 10,管到哪年默认 50 年;直接进不要 until;几州去重', () => {
    const a = 'polity:c12#0';
    expect(cleanIntervention({ kind: 'boost', a, from: 1500, mul: 10, until: 1550 })).toEqual({ kind: 'boost', a, from: 1500, mul: 10, until: 1550 });
    expect(cleanIntervention({ kind: 'boost', a, from: 1500, mul: 6 })).toEqual({ kind: 'boost', a, from: 1500, mul: 3, until: 1550 });
    expect(cleanIntervention({ kind: 'boost', a, from: 1500, mul: 8, until: 1400 })).toEqual({ kind: 'boost', a, from: 1500, mul: 10, until: 1550 });
    expect(cleanIntervention({ kind: 'boost', a, from: 1500, until: 1600 })).toEqual({ kind: 'boost', a, from: 1500 });
    expect(cleanIntervention({ kind: 'boost', a, from: 1500, mul: 1 })).toEqual({ kind: 'boost', a, from: 1500 });
    expect(cleanIntervention({ kind: 'boost', a, from: 1500, regions: ['region:c5', 'region:c5', 'x', 'region:c9'] })).toEqual({ kind: 'boost', a, from: 1500, regions: ['region:c5', 'region:c9'] });
    expect(cleanIntervention({ kind: 'boost', a, from: 1500, regions: ['x'] })).toBeNull();
    expect(cleanIntervention({ kind: 'boost', from: 1500 })).toBeNull();
    // 本来就合格的原样返回
    const v = { kind: 'boost', a, from: 1500, mul: 3, until: 1520, regions: ['region:c5'] };
    expect(cleanIntervention(v)).toBe(v);
  });

  it('下了但还没到生效那年的推一把(快几倍、直接进):历史逐字节不变', () => {
    const c0 = baseCiv();
    const p = biggestAt(c0, 1500);
    const late = c0.endYear + 100;
    const ivs: Intervention[] = [
      { kind: 'boost', a: polityKey(c0, p), from: late, mul: 10, until: late + 50 },
      { kind: 'boost', a: polityKey(c0, p), from: late },
    ];
    const c1 = generateCiv(world(), { interventions: ivs });
    const { interventions: _a, ...x } = c1;
    const { interventions: _b, ...y } = c0;
    same(x as Civ, y as Civ, '没到生效那年');
  }, 120_000);

  it('直接进:那一刻整国拉到国都的下一个时代,大事记在那一刻;史事 n、编年史', () => {
    const c0 = baseCiv();
    const T = 1510;
    const p = biggestAt(c0, T);
    const capEra = eraOf(eraLevel(developmentAt(c0.development!, T - 10), capRegion(c0, p, T))).era;
    const c = generateCiv(world(), { interventions: [{ kind: 'boost', a: polityKey(c0, p), from: T }] });
    // 推的那一年以前不变
    expect(c.annals.filter((e) => e.year < T)).toEqual(c0.annals.filter((e) => e.year < T));
    const e = c.annals.find((x) => x.kind === 'intervene')!;
    expect(e.b).toBe(-1);
    const target = (e.n ?? 0) % BOOST_N;
    const n = Math.floor((e.n ?? 0) / BOOST_N);
    expect(target).toBe(capEra + 1);
    const eras = erasOf(c, p, T);
    expect(n).toBe(eras.length);
    // 那一年整国都在那个时代或更高;前一年照旧
    expect(eras.every((k) => k >= target)).toBe(true);
    expect(erasOf(c, p, T - 1)).toEqual(erasOf(c0, p, T - 1));
    // 国都"始入"记在推的那一年
    const enter = c.development!.events.find((x) => x.kind === 'enter' && x.polity === p && x.era === target);
    expect(enter?.year).toBe(T);
    // 编年史:【干预】一句
    const ch = buildChronicle(c).find((x) => x.year === T && x.text.startsWith('【干预】'));
    expect(ch?.text).toMatch(/变法图强,诸州一时并进$/);
    expect(interventionFate(c, 0).state).toBe('done');
    expect(ERAS[target]).toBeTruthy();
  }, 120_000);

  it('快 10 倍管 50 年:进下一个时代的州比不推、快 3 倍多;编年史写到哪一年', () => {
    const c0 = baseCiv();
    const T = 1500;
    // T 年州最多、治下有铜锡的国家(治下没有铜锡的推不进青铜时代,见下一条;最大的那国不一定有)
    const res = c0.development!.resources;
    const own0 = ownersAt(c0, T).polity;
    const sizes = new Map<number, number>();
    for (const o of own0) if (o >= 0) sizes.set(o, (sizes.get(o) ?? 0) + 1);
    const p = [...sizes.entries()]
      .sort((x, y) => y[1] - x[1] || x[0] - y[0])
      .map((x) => x[0])
      .find((q) => own0.some((o, r) => o === q && res[r * 11 + 2] > 0))!;
    const a = polityKey(c0, p);
    const ahead = (c: Civ, y: number) => {
      const lv = developmentAt(c.development!, y);
      const own = ownersAt(c, y).polity;
      let n = 0;
      for (let r = 0; r < own.length; r++) if (own[r] === p && eraLevel(lv, r) >= 1) n++;
      return n;
    };
    const c3 = generateCiv(world(), { interventions: [{ kind: 'boost', a, from: T, mul: 3, until: T + 50 }] });
    const c10 = generateCiv(world(), { interventions: [{ kind: 'boost', a, from: T, mul: 10, until: T + 50 }] });
    const n0 = ahead(c0, T + 60);
    const n3 = ahead(c3, T + 60);
    const n10 = ahead(c10, T + 60);
    expect(n3).toBeGreaterThan(n0);
    expect(n10).toBeGreaterThan(n3);
    const ch = buildChronicle(c10).find((x) => x.year === T && x.text.startsWith('【干预】'));
    expect(ch?.text).toMatch(/励精图治,百业日新,至第 1550 年$/);
  }, 120_000);

  it('快几倍照规矩:生产到了青铜门口、治下没有铜锡的国家,国都推不过去;前后接着下的两条和一条管到底的一样', () => {
    const c0 = baseCiv();
    const T = 1500;
    const res = c0.development!.resources;
    const lv0 = developmentAt(c0.development!, T);
    const own = ownersAt(c0, T).polity;
    // 那年治下一州铜锡都没有、国都的生产已在青铜门口(0.7–1)的国家
    const stuck = c0.polities.filter((q) => {
      if (!(q.founded <= T && (q.ended === undefined || q.ended > T))) return false;
      const r = capRegion(c0, q.id, T);
      const prod = lv0[r * 5];
      if (!(prod > 0.7 && prod < 1)) return false;
      for (let x = 0; x < own.length; x++) if (own[x] === q.id && res[x * 11 + 2] > 0) return false;
      return true;
    });
    expect(stuck.length).toBeGreaterThan(0);
    // 推的那 50 年里国都没挪、也没打下有铜锡的州的那一国(挪了、打下了,规矩就管不着了;头一个这样的国家国都可能挪了,挨个往下找):
    // 国都的生产推不过青铜门口
    let checked = 0;
    for (const q of stuck) {
      const c = generateCiv(world(), { interventions: [{ kind: 'boost', a: polityKey(c0, q.id), from: T, mul: 10, until: T + 50 }] });
      const r = capRegion(c, q.id, T + 50);
      const own50 = ownersAt(c, T + 50).polity;
      let copper = false;
      for (let x = 0; x < own50.length; x++) if (own50[x] === q.id && c.development!.resources[x * 11 + 2] > 0) copper = true;
      if (r !== capRegion(c0, q.id, T) || copper || c.polities[q.id].ended !== undefined) continue;
      expect(developmentAt(c.development!, T + 50)[r * 5]).toBeLessThan(1);
      checked++;
      break;
    }
    expect(checked).toBe(1);
    // 前后接着下的两条(1500–1550、1550–1600)和一条 1500–1600 推出来的发展度一样
    const p = biggestAt(c0, T);
    const a = polityKey(c0, p);
    const one = generateCiv(world(), { interventions: [{ kind: 'boost', a, from: T, mul: 10, until: T + 100 }], endYear: T + 120 });
    const two = generateCiv(world(), { interventions: [{ kind: 'boost', a, from: T, mul: 10, until: T + 50 }, { kind: 'boost', a, from: T + 50, mul: 10, until: T + 100 }], endYear: T + 120 });
    expect(developmentAt(two.development!, T + 120)).toEqual(developmentAt(one.development!, T + 120));
  }, 120_000);

  it('几州:只推那几州,别的州和不推一样', () => {
    const c0 = baseCiv();
    const T = 1500;
    const p = biggestAt(c0, T);
    const cap = capRegion(c0, p, T);
    const c = generateCiv(world(), { interventions: [{ kind: 'boost', a: polityKey(c0, p), from: T, regions: [regionKey(c0, cap)] }] });
    const e = c.annals.find((x) => x.kind === 'intervene')!;
    expect(Math.floor((e.n ?? 0) / BOOST_N)).toBe(1);
    const lv = developmentAt(c.development!, T);
    const lv0 = developmentAt(c0.development!, T);
    expect(eraOf(eraLevel(lv, cap)).era).toBe(eraOf(eraLevel(lv0, cap)).era + 1);
    // 不在国都的一州(推的那一刻)没动
    const own = ownersAt(c0, T).polity;
    const other = own.findIndex((o, r) => o === p && r !== cap);
    expect(eraLevel(lv, other)).toBeCloseTo(eraLevel(lv0, other), 6);
  }, 120_000);

  it('那一年这国已亡:不生效,写原因', () => {
    const c0 = baseCiv();
    const gone = c0.polities.find((q) => q.ended !== undefined && q.ended < c0.endYear - 100 && q.ended - q.founded > 10)!;
    const T = Math.ceil(gone.ended!) + 5;
    const c = generateCiv(world(), { interventions: [{ kind: 'boost', a: polityKey(c0, gone.id), from: T, mul: 10, until: T + 50 }] });
    const f = interventionFate(c, 0);
    expect(f.state).toBe('void');
    if (f.state === 'void') expect(f.why).toMatch(/已亡/);
  }, 120_000);

  it('直接进之后、快几倍管着的那几年里停下接着推,和一口气推完逐字段相等', () => {
    const c0 = baseCiv();
    const p = biggestAt(c0, 1500);
    const q = biggestAt(c0, 1300);
    const ivs: Intervention[] = [
      { kind: 'boost', a: polityKey(c0, q), from: 1490, mul: 10, until: 1540 },
      { kind: 'boost', a: polityKey(c0, p), from: 1510 },
    ];
    const one = generateCiv(world(), { interventions: ivs, endYear: 1600 });
    for (const cut of [1495, 1515]) {
      const mid = generateCiv(world(), { interventions: ivs, endYear: cut });
      const cont = continueCiv(world(), mid, { interventions: ivs, endYear: 1600 });
      same(cont, one, `停在 ${cut}`);
    }
  }, 300_000);
});

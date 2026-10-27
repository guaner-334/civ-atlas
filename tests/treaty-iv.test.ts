/**
 * 干预「立约」「划中立地」(gen/civ/treaties.ts 的 decree):
 * 下令那年之前的历史和不下令时一样;那一刻记一条干预、紧跟着记约 / 中立地(选项照下令的);约里正在交战的当即议和;
 * 约期内不许背约的不背约;一直有效的约不满期;一直留着的中立地约废了也不撤、到某一年撤的那年撤;
 * 演一国时下的照推演的规矩定肯不肯(同一份命令推几遍结果一样);接着推和一口气推完一样;编年史、干预列表读得通。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { treatyBook, treatyMembersAt, zonesAt, IV_REFUSED } from '../src/gen/civ/treatyInfo';
import { buildChronicle, interventionOutcome } from '../src/gen/civ/chronicle';
import { cleanIntervention, polityKey, regionKey, type Intervention } from '../src/gen/edits';
import { packValue, unpackValue } from '../src/gen/snapshot';
import { zoneChoices } from '../src/ui/treatyIv';
import { treatyEntries, treatyPeriod, zoneEntries } from '../src/ui/treatyRows';
import { fullChronicle } from '../src/gen/civ/religionText';

const world = generateWorld({ ...DEFAULT_PARAMS, seed: 14 });
const base = generateCiv(world);
const Y = 1700;

/** 第 Y 年的两个邻国(A 的州数最多的那几国里挑一个有陆上邻国的)、A 和 B 交界、A 的一州 */
function pair(civ: Civ, y: number): { a: number; b: number; r: number } {
  const own = ownersAt(civ, y).polity;
  const R = civ.regions;
  const n = new Map<number, number>();
  for (const o of own) if (o >= 0) n.set(o, (n.get(o) ?? 0) + 1);
  const big = [...n].sort((x, z) => z[1] - x[1] || x[0] - z[0]).map(([p]) => p);
  for (const a of big) {
    for (let r = 0; r < R.count; r++) {
      if (own[r] !== a) continue;
      for (let k = R.adjStart[r]; k < R.adjStart[r + 1]; k++) {
        const b = own[R.adj[k]];
        if (b >= 0 && b !== a && R.adjKind[k] <= 2 && (n.get(b) ?? 0) > 3) {
          const cap = civ.settlements[civ.polities[a].capitals?.at(-1)?.settlement ?? civ.polities[a].capital]?.region;
          if (r !== cap) return { a, b, r };
        }
      }
    }
  }
  throw new Error('没找到两个接壤的国家');
}

const { a: A, b: B, r: Z } = pair(base, Y);
const run = (ivs: Intervention[], endYear?: number) => generateCiv(world, { interventions: ivs.map((v) => cleanIntervention(v)!), ...(endYear !== undefined ? { endYear } : {}) });
const decreeAt = (civ: Civ) => civ.annals.findIndex((e) => e.kind === 'intervene' && e.year === Y);

describe('干预:立约、划中立地', () => {
  it('立约:之前的历史不变;那一刻记干预、紧跟着记约和中立地,选项照下令的;约期内不许背约的不背约', () => {
    const v: Intervention = { kind: 'treaty', a: polityKey(base, A), ps: [polityKey(base, B)], from: Y, term: 50, limited: true, keep: true, zone: regionKey(base, Z) };
    const civ = run([v]);
    expect(civ.annals.filter((e) => e.year < Y)).toEqual(base.annals.filter((e) => e.year < Y));
    const i = decreeAt(civ);
    expect(civ.annals[i]).toMatchObject({ kind: 'intervene', a: A, b: -1 });
    const t = civ.annals[i + 1];
    expect(t).toMatchObject({ kind: 'treaty', cause: 'decree', n: 50, opt: 3, ps: [A, B] });
    const x = treatyBook(civ).treaties[t.war];
    expect(x.kind).toBe('limited');
    expect(x.keep).toBe(true);
    expect(x.breaches).toEqual([]);
    // 中立地:那一州那一刻起不归任何一国
    const n = civ.annals[i + 2];
    expect(n).toMatchObject({ kind: 'neutral', cause: 'decree', region: Z, n: t.war });
    expect(ownersAt(civ, Y + 0.5).polity[Z]).toBe(-1);
    // 编年史:干预那一条写全(约和中立地并进去),不另列
    const ch = buildChronicle(civ);
    const e = ch.find((c) => c.kind === 'intervene' && c.id === i)!;
    expect(e.text.startsWith('【干预】')).toBe(true);
    expect(e.text).toContain('为中立地');
    expect(ch.some((c) => c.id === i + 1 || c.id === i + 2)).toBe(false);
    expect(interventionOutcome(civ, 0).ok).toBe(true);
  }, 60_000);

  it('一直有效的约不满期;一直留着的中立地约废了也不撤;到某一年撤的那年撤', () => {
    const forever = run([{ kind: 'treaty', a: polityKey(base, A), ps: [polityKey(base, B)], from: Y }]);
    const t = forever.annals[decreeAt(forever) + 1];
    const x = treatyBook(forever).treaties[t.war];
    expect(x.term).toBe(0);
    expect(x.until).toBe(Infinity);
    expect(x.end).not.toBe('expire');
    const lasting = run([{ kind: 'neutral', a: polityKey(base, A), region: regionKey(base, Z), ps: [polityKey(base, B)], from: Y, lasting: true }]);
    const zl = treatyBook(lasting).zones.find((z) => z && z.from === Y)!;
    expect(zl.lasting).toBe(true);
    const xl = treatyBook(lasting).treaties[zl.treaty];
    if (xl.ended !== undefined) expect(zl.ended === undefined || zl.ended > xl.ended).toBe(true);
    const until = run([{ kind: 'neutral', a: polityKey(base, A), region: regionKey(base, Z), ps: [polityKey(base, B)], from: Y, until: Y + 7 }]);
    const zu = treatyBook(until).zones.find((z) => z && z.from === Y)!;
    expect(zu.until).toBe(Y + 7);
    expect(zu.ended).toBeLessThanOrEqual(Y + 7);
    expect(zonesAt(until, Y + 8).some((z) => z.id === zu.id)).toBe(false);
  }, 120_000);

  it('演一国时下的:对方肯不肯照推演的规矩定,同一份命令推几遍一样;不肯 = 记一条没生效的干预', () => {
    const ivs: Intervention[] = [];
    const own = ownersAt(base, Y).polity;
    const others = [...new Set(own)].filter((q) => q >= 0 && q !== A).slice(0, 8);
    for (const q of others) ivs.push({ kind: 'treaty', a: polityKey(base, A), ps: [polityKey(base, q)], from: Y, ask: true });
    const c1 = run(ivs, Y + 5);
    const c2 = run(ivs, Y + 5);
    expect(c1.annals).toEqual(c2.annals);
    const got = c1.annals.filter((e) => e.kind === 'intervene' && e.year === Y);
    expect(got.length).toBe(ivs.length);
    for (const e of got) expect([-1, IV_REFUSED]).toContain(e.b);
  }, 60_000);

  it('推荐的中立地:碰到两国以上(连同本国)、按碰到的国家数从多到少', () => {
    const cs = zoneChoices(base, world, A, Y);
    expect(cs.length).toBeGreaterThan(0);
    for (const c of cs) {
      expect(c.touch[0]).toBe(A);
      expect(c.touch.length).toBeGreaterThanOrEqual(2);
    }
    for (let i = 1; i < cs.length; i++) expect(cs[i].touch.length).toBeLessThanOrEqual(cs[i - 1].touch.length);
  });

  it('卡片、大事:一直有效的约这一期到 Infinity;干预那一条算在约和中立地的大事里;一直留着的中立地那州被划走了照样撤', () => {
    const civ = run([{ kind: 'treaty', a: polityKey(base, A), ps: [polityKey(base, B)], from: Y, zone: regionKey(base, Z) }], Y + 10);
    const i = decreeAt(civ);
    const x = treatyBook(civ).treaties[civ.annals[i + 1].war];
    expect(treatyPeriod(x, Y + 5).until).toBe(Infinity);
    const all = fullChronicle(civ);
    expect(treatyEntries(civ, x, all).map((e) => e.id)).toContain(i);
    const z = treatyBook(civ).zones[x.zone];
    expect(zoneEntries(civ, z, all).map((e) => e.id)).toContain(i);
    // 一直留着的中立地:立约的一国亡了、约废了,中立地还在;那州后来被划给下令的那国,中立地撤
    const ivs: Intervention[] = [
      { kind: 'neutral', a: polityKey(base, A), region: regionKey(base, Z), ps: [polityKey(base, B)], from: Y, lasting: true },
      { kind: 'destroy', a: polityKey(base, B), from: Y + 1 },
      { kind: 'cede', a: polityKey(base, A), region: regionKey(base, Z), from: Y + 3 },
    ];
    const c2 = run(ivs, 1900);
    const z2 = treatyBook(c2).zones.find((q) => q && q.from === Y)!;
    const x2 = treatyBook(c2).treaties[z2.treaty];
    expect(x2.ended).toBeDefined();
    expect(z2.ended).toBeDefined();
    expect(z2.ended!).toBeGreaterThanOrEqual(Y + 3);
    expect(zonesAt(c2, 1899).some((q) => q.id === z2.id)).toBe(false);
  }, 120_000);

  it('同一刻预约、撞在同一刻的中立地到期和约满:停下接着推,先后和一口气推完一样', () => {
    const ivs: Intervention[] = [
      { kind: 'neutral', a: polityKey(base, A), region: regionKey(base, Z), ps: [polityKey(base, B)], from: Y, until: Y + 20 },
      { kind: 'treaty', a: polityKey(base, A), ps: [polityKey(base, B)], from: Y, term: 20 },
    ];
    const whole = run(ivs, Y + 40);
    const mid = run(ivs, Y + 10);
    const cont = continueCiv(world, unpackValue(packValue(mid)) as Civ, { endYear: Y + 40, interventions: ivs.map((v) => cleanIntervention(v)!) });
    for (const k of ['annals', 'log', 'polity'] as const) expect(cont[k], k).toEqual(whole[k]);
  }, 120_000);

  it('约和中立地还在的时候停下、存档读回、接着推:和一口气推完一样', () => {
    const ivs: Intervention[] = [
      { kind: 'treaty', a: polityKey(base, A), ps: [polityKey(base, B)], from: Y, term: 30, keep: true },
      { kind: 'neutral', a: polityKey(base, A), region: regionKey(base, Z), ps: [polityKey(base, B)], from: Y + 2, until: Y + 40, quiet: true },
    ];
    const whole = run(ivs, 1900);
    const mid = run(ivs, Y + 20);
    expect(treatyBook(mid).treaties.some((x) => x && x.how === 'decree' && treatyMembersAt(mid, x, Y + 19).length >= 2)).toBe(true);
    const saved = unpackValue(packValue(mid)) as Civ;
    const cont = continueCiv(world, saved, { endYear: 1900, interventions: ivs.map((v) => cleanIntervention(v)!) });
    for (const k of ['annals', 'log', 'polity', 'people'] as const) expect(cont[k], k).toEqual(whole[k]);
  }, 240_000);
});

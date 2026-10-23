/**
 * 灭国、让人物去世、改君主倾向、等下台再即位在界面上的部分(ui/newIvInfo.ts、ui/Interventions.tsx 的说法):
 * - 灭国页:默认并入接壤的邻国里州最多的、单子上的一行
 * - 让人物去世 / 改倾向:能下的年份(君主在位那几年、将领领兵以后、名臣入仕以后)、不能下的原因、那年在不在位、下面那一句
 * - 「我的干预」一次性的不写"起";推完的提示条(将领、名臣去世写"历史不变")
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { personKey, polityKey, type Intervention } from '../src/gen/edits';
import type { Person } from '../src/gen/civ/types';
import {
  deathNote,
  destroyDefault,
  destroyQueueText,
  leaningsThen,
  moodSince,
  newIvDoneText,
  onceOnly,
  personIvRange,
  personIvWhy,
  rulerEndText,
  rulerOnThrone,
} from '../src/ui/newIvInfo';
import { interventionText, nameAt } from '../src/ui/Interventions';

const seed = 7;
const T = 1500;
let w: World | null = null;
let b: Civ | null = null;
const world = () => (w ??= generateWorld({ ...DEFAULT_PARAMS, seed }));
const base = () => (b ??= generateCiv(world()));

/** T 年有接壤邻国的国家里州最多的 */
function biggest(civ: Civ, t: number): number {
  const n = new Map<number, number>();
  for (const o of ownersAt(civ, t).polity) if (o >= 0) n.set(o, (n.get(o) ?? 0) + 1);
  return [...n.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]).find(([id]) => destroyDefault(civ, id, t).b >= 0)![0];
}

/** T 年在位、在位够长(前后各留几年)的君主 */
function rulerThen(civ: Civ, t: number): Person {
  return civ.people!.find((x) => x.role === 'ruler' && x.author === undefined && x.from! < t - 3 && (x.until ?? Infinity) > t + 3 && (x.died ?? Infinity) > t + 3)!;
}

describe('灭国页', () => {
  it('默认并入接壤的邻国里州最多的;n = 那年几州;单子上的一行', () => {
    const civ = base();
    const id = biggest(civ, T);
    const d = destroyDefault(civ, id, T);
    expect(d.n).toBeGreaterThan(1);
    expect(d.near.size).toBeGreaterThan(0);
    expect(d.near.has(d.b)).toBe(true);
    for (const q of d.near) expect(d.size.get(q) ?? 0).toBeLessThanOrEqual(d.size.get(d.b) ?? 0);
    expect(destroyQueueText('东定国', 13, '大定')).toBe('东定国:灭国，13 州并入大定');
    expect(destroyQueueText('东定国', 13, null)).toBe('东定国:灭国，散成无主');
  });

  it('推完的提示条:并入写州数和国名,散成无主写"散为无主之地";那年已亡的写原因', () => {
    const base0 = base();
    const id = biggest(base0, T);
    const d = destroyDefault(base0, id, T);
    const A = nameAt(base0.polities[id], T);
    const merge: Intervention = { kind: 'destroy', a: polityKey(base0, id), b: polityKey(base0, d.b), from: T };
    const civ = generateCiv(world(), { interventions: [merge], endYear: T + 40 });
    const r = newIvDoneText(civ, merge, 0, A, undefined)!;
    expect(r.ok).toBe(true);
    expect(r.text).toBe(`${A}亡，${d.n} 州并入${nameAt(civ.polities[d.b], T)}`);
    // 「我的干预」:推过以后写出并入几州
    expect(interventionText(civ, merge, 0, A)).toBe(`${A}:灭国，${d.n} 州并入${nameAt(civ.polities[d.b], T)}`);
    const loose: Intervention = { kind: 'destroy', a: polityKey(base0, id), from: T };
    const c2 = generateCiv(world(), { interventions: [loose], endYear: T + 40 });
    expect(newIvDoneText(c2, loose, 0, A, undefined)!.text).toBe(`${A}亡，${d.n} 州散为无主之地`);
    // 亡了以后再灭:没生效,黄色写原因
    const gone = base0.polities.find((p) => p.ended !== undefined && p.ended < T - 50 && p.founded < T - 300)!;
    const late: Intervention = { kind: 'destroy', a: polityKey(base0, gone.id), from: T };
    const c3 = generateCiv(world(), { interventions: [late], endYear: T + 10 });
    const r3 = newIvDoneText(c3, late, 0, '某国', undefined)!;
    expect(r3.ok).toBe(false);
    expect(r3.text).toMatch(/^灭某国没生效：/);
  });
});

describe('让人物去世、改倾向', () => {
  it('君主:能下的是在位那几年;早了写"才即位",晚了写"已不在位"/"已卒";那年在位才有入口', () => {
    const civ = base();
    const x = rulerThen(civ, T);
    const { lo, hi } = personIvRange(civ, x);
    expect(lo).toBe(Math.ceil(x.from!));
    expect(hi).toBeLessThan(x.until ?? Infinity);
    expect(personIvWhy(civ, x, T)).toBeNull();
    expect(personIvWhy(civ, x, lo - 1)).toMatch(/才即位$/);
    expect(personIvWhy(civ, x, hi + 1)).toMatch(/已不在位$|已卒$|还没推到$/);
    expect(rulerOnThrone(x, T)).toBe(true);
    expect(rulerOnThrone(x, lo - 1)).toBe(false);
    expect(deathNote(civ, x, undefined)).toMatch(new RegExp(`^他 ${Math.floor(x.from!)} 年即位，(原定 \\d+ 年|在位至今).*。之前的历史不变。$`));
    expect(rulerEndText(civ, x, undefined)).toMatch(/^原定 \d+ 年|^在位至今$/);
  });

  it('将领:领兵以后、卒年以前;名臣:入仕以后、去职以前', () => {
    const civ = base();
    const g = civ.people!.find((x) => x.role === 'general' && x.commands?.length && x.died !== undefined && x.died - x.commands[0].from > 5)!;
    const r = personIvRange(civ, g);
    expect(r.lo).toBe(Math.floor(g.commands![0].from) + 1);
    expect(r.hi).toBe(Math.ceil(g.died!) - 1);
    expect(personIvWhy(civ, g, r.lo - 1)).toMatch(/才领兵$/);
    expect(personIvWhy(civ, g, Math.ceil(g.died!))).toMatch(/已卒$/);
    expect(deathNote(civ, g, undefined)).toMatch(/^他 \d+ 年生，原定 \d+ 年(卒|战死)。$/);
    const m = civ.people!.find((x) => x.role === 'minister' && x.until !== undefined && x.from !== undefined && x.until - x.from > 5 && (x.died ?? Infinity) > x.until + 1)!;
    const rm = personIvRange(civ, m);
    expect(rm.hi).toBe(Math.ceil(m.until!) - 1);
    expect(personIvWhy(civ, m, rm.hi + 1)).toMatch(/已去职$/);
  });

  it('推完的提示条:君主去世 / 改倾向 / 将领去世写"历史不变"(same);改过倾向的那年照改后的', () => {
    const base0 = base();
    const x = rulerThen(base0, T);
    const g = base0.people!.find((p) => p.role === 'general' && p.commands?.length && p.commands[0].from < T - 2 && (p.died ?? Infinity) > T + 2)!;
    const die: Intervention = { kind: 'death', a: polityKey(base0, x.polity), person: personKey(base0, x.id), from: T };
    const c1 = generateCiv(world(), { interventions: [die], endYear: T + 20 });
    const r1 = newIvDoneText(c1, die, 0, '', undefined)!;
    expect(r1).toMatchObject({ ok: true });
    expect(r1.text).toMatch(new RegExp(` ${T} 年去世，下一位照常继位$`));
    expect(r1.same).toBeUndefined();
    const gd: Intervention = { kind: 'death', a: polityKey(base0, g.polity), person: personKey(base0, g.id), from: T };
    const c2 = generateCiv(world(), { interventions: [gd], endYear: T + 20 });
    const r2 = newIvDoneText(c2, gd, 0, '', undefined)!;
    expect(r2).toMatchObject({ ok: true, same: true });
    expect(r2.text).toMatch(new RegExp(`改成 ${T} 年去世；历史不变$`));
    expect(interventionText(c2, gd, 0)).toMatch(/:去世（只改人物和编年史）$/);
    const lean = { expand: 10, war: 90, develop: 50, trade: 20 };
    const tm: Intervention = { kind: 'temper', a: polityKey(base0, x.polity), person: personKey(base0, x.id), from: T, leanings: lean };
    const c3 = generateCiv(world(), { interventions: [tm], endYear: T + 20 });
    expect(newIvDoneText(c3, tm, 0, '', undefined)!.text).toMatch(/的倾向改了，到他下台为止$/);
    const x3 = c3.people!.find((p) => p.killed === undefined && p.moods?.length)!;
    expect(moodSince(x3, T + 1)).toBe(x3.moods![0].year);
    expect(moodSince(x3, x3.moods![0].year - 1)).toBeNull();
    expect(leaningsThen(x3, T + 1)).toEqual(lean);
    expect(leaningsThen(x3, x3.moods![0].year - 1)).toEqual(x3.leanings);
  });

  it('「我的干预」:一次性的不写"起"', () => {
    expect(onceOnly({ kind: 'destroy', a: 'polity:c1#0', from: T })).toBe(true);
    expect(onceOnly({ kind: 'death', a: 'polity:c1#0', person: 'x', from: T })).toBe(true);
    expect(onceOnly({ kind: 'crown', a: 'polity:c1#0', char: 1, from: T, born: 1480, after: true, leanings: { expand: 50, war: 50, develop: 50, trade: 50 } })).toBe(true);
    expect(onceOnly({ kind: 'crown', a: 'polity:c1#0', char: 1, from: T, born: 1480, leanings: { expand: 50, war: 50, develop: 50, trade: 50 } })).toBe(false);
    expect(onceOnly({ kind: 'protect', a: 'polity:c1#0', from: T })).toBe(false);
  });
});

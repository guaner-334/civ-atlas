/**
 * 灭国、让人物去世、改君主倾向、等下台再即位在界面上的部分(ui/newIvInfo.ts、ui/Interventions.tsx 的说法):
 * - 灭国页:默认并入接壤的邻国里州最多的、单子上的一行
 * - 让人物去世 / 改倾向:能下的年份(君主在位那几年、将领领兵以后、名臣入仕以后)、不能下的原因、那年在不在位、下面那一句
 * - 「我的干预」一次性的不写"起";推完的提示条(将领、名臣去世写"历史不变")
 * - 天灾:受灾的州(地图上的预览)、轻重下面那一句、单子上的一行(全角标点)、推完的提示条、州卡片上划掉的原数(长回来以后不写)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { generateCiv, type Civ } from '../src/gen/civ';
import { ownersAt } from '../src/gen/civ/timeline';
import { capitalAt, regionPopulationAt } from '../src/gen/civ/growth';
import { PLAGUE_IV, quakeRing } from '../src/gen/civ/calamity';
import { plagueSpans } from '../src/gen/civ/plagueSpans';
import { regionLabel } from '../src/gen/civ/display';
import { personKey, polityKey, regionKey, settlementKey, type Intervention } from '../src/gen/edits';
import type { Person } from '../src/gen/civ/types';
import {
  biggestPort,
  deathNote,
  destroyDefault,
  destroyQueueText,
  disasterArea,
  disasterLevelNote,
  disasterQueueText,
  disasterToll,
  leaningsThen,
  livingCity,
  moodSince,
  newIvDoneText,
  onceOnly,
  personIvRange,
  personIvWhy,
  regionDisasterMark,
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
    // 灭国后面又下了"不许灭"(后下的为准):没生效,写那一年被"保护"护着
    const keep: Intervention = { kind: 'protect', a: polityKey(base0, id), from: T - 10 };
    const c4 = generateCiv(world(), { interventions: [loose, keep], endYear: T + 10 });
    const r4 = newIvDoneText(c4, loose, 0, A, undefined)!;
    expect(r4.ok).toBe(false);
    expect(r4.text).toBe(`灭${A}没生效：第 ${T} 年${A}受后下的「保护」护着`);
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
    // 逐年推演:下在推过的历史后面(那时还在位的)不按历史推到哪年卡
    const now = base().people!.find((p) => p.role === 'ruler' && p.until === undefined && p.died === undefined)!;
    expect(personIvWhy(base(), now, Math.ceil(base().endYear))).toMatch(/还没推到$/);
    expect(personIvWhy(base(), now, Math.ceil(base().endYear), true)).toBeNull();
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
    expect(onceOnly({ kind: 'disaster', type: 'quake', level: 2, from: T, region: 'region:c1' })).toBe(true);
  });
});

describe('天灾', () => {
  /** T 年州最多的国家、它的国都和国都那一州 */
  const capital = (civ: Civ) => {
    const id = biggest(civ, T);
    const sid = capitalAt(civ.polities[id], T);
    return { id, sid, r: civ.settlements[sid].region };
  };

  it('轻重下面那一句:电脑写三档和后果,手机只写死几成', () => {
    expect(disasterLevelNote(2, false)).toBe('中：城里约死三成（轻一成半、重五成），几十年长回来，其间国内更易动荡。不改地形。');
    expect(disasterLevelNote(1, false)).toBe('轻：城里约死一成半（中三成、重五成），几十年长回来，其间国内更易动荡。不改地形。');
    expect(disasterLevelNote(3, true)).toBe('重：城里约死五成。');
  });

  it('全球大疫:「死几成」下面那一句、默认从这国人最多的港口起、单子上的一行写疫后无人收拾几年', () => {
    expect(disasterLevelNote(2, false, 'pandemic')).toBe('中：染疫的城约死三到四成（轻两成、重五成），乡下少一些；全世界人口约十去其二三。');
    expect(disasterLevelNote(2, true, 'pandemic')).toBe('中：染疫的城约死三到四成，天下人口十去其二三。');
    const civ = base();
    const { id } = capital(civ);
    const own = ownersAt(civ, T).polity;
    const port = biggestPort(civ, id, own, T);
    if (port >= 0) {
      const s = civ.settlements[port];
      expect(own[s.region]).toBe(id);
      expect(s.port).toBe(true);
      expect(disasterArea(civ, { type: 'pandemic', city: port }, T)).toEqual([s.region]);
      const v: Intervention = { kind: 'disaster', type: 'pandemic', level: 2, from: T, city: settlementKey(civ, port) };
      expect(interventionText(civ, v)).toBe(`${s.name}:全球大疫（中），疫后无人收拾 30 年`);
      expect(interventionText(civ, { ...v, slump: 60 })).toBe(`${s.name}:全球大疫（中），疫后无人收拾 60 年`);
    }
    // 没有这国的城 = −1
    expect(biggestPort(civ, -5, own, T)).toBe(-1);
  });

  it('受灾的州:地震水旱 = 那一处连同一圈,饥荒一国 = 那年的国土,瘟疫 = 起疫那城的州;人口、有人烟的州数', () => {
    const civ = base();
    const { id, sid, r } = capital(civ);
    expect(livingCity(civ, r, T)).toBe(sid);
    const ring = disasterArea(civ, { type: 'quake', region: r }, T);
    expect(ring).toEqual(quakeRing(civ.regions, r));
    expect(ring.length).toBeGreaterThan(1);
    const lands = disasterArea(civ, { type: 'famine', polity: id }, T);
    expect(lands.length).toBe(destroyDefault(civ, id, T).n);
    expect(disasterArea(civ, { type: 'plague', city: sid }, T)).toEqual([r]);
    expect(disasterArea(civ, { type: 'famine', regions: [ring[1], ring[0], ring[1]] }, T)).toEqual([ring[0], ring[1]]);
    const t = disasterToll(civ, ring, T);
    expect(t.hit).toBeGreaterThan(0);
    expect(t.hit).toBeLessThanOrEqual(ring.length);
    expect(t.pop).toBeCloseTo(ring.reduce((s, x) => s + regionPopulationAt(civ, x, T), 0), 6);
  });

  it('单子 / 「我的干预」的一行用全角标点;地震水旱写几州受灾', () => {
    const civ = base();
    const { id, sid, r } = capital(civ);
    const A = nameAt(civ.polities[id], T);
    const city = civ.settlements[sid].name;
    const plague: Intervention = { kind: 'disaster', type: 'plague', level: 3, from: T, city: settlementKey(civ, sid) };
    expect(interventionText(civ, plague)).toBe(`${city}:瘟疫（重）`);
    const famine: Intervention = { kind: 'disaster', type: 'famine', level: 1, from: T, a: polityKey(civ, id) };
    expect(disasterQueueText(civ, famine, A, 0)).toBe(`${A}:饥荒（轻）`);
    const ring = quakeRing(civ.regions, r);
    const some: Intervention = { kind: 'disaster', type: 'famine', level: 1, from: T, regions: ring.slice(0, 3).map((x) => regionKey(civ, x)) };
    expect(interventionText(civ, some)).toBe(`${regionLabel(civ, ring[0])}等 3 州:饥荒（轻）`);
    const quake: Intervention = { kind: 'disaster', type: 'quake', level: 2, from: T, region: regionKey(civ, r) };
    expect(disasterQueueText(civ, quake, undefined, 8)).toMatch(new RegExp(`^${regionLabel(civ, r)}一带:(地震|大水|大旱)（中），8 州受灾$`));
  });

  it('推完的提示条:"某城大疫（重）""某国大饥（轻）""某州一带地震，N 州受灾";那城已毁的写原因;州卡片写划掉的原数,长回来以后不写', () => {
    const base0 = base();
    const { id, sid, r } = capital(base0);
    const A = nameAt(base0.polities[id], T);
    const city = base0.settlements[sid].name;
    const plague: Intervention = { kind: 'disaster', type: 'plague', level: 3, from: T, city: settlementKey(base0, sid) };
    const famine: Intervention = { kind: 'disaster', type: 'famine', level: 1, from: T, a: polityKey(base0, id) };
    const quake: Intervention = { kind: 'disaster', type: 'quake', level: 2, from: T, region: regionKey(base0, r) };
    const c1 = generateCiv(world(), { interventions: [plague], endYear: T + 20 });
    expect(newIvDoneText(c1, plague, 0, '', undefined)!.text).toMatch(new RegExp(`^${city}大疫（重）(，并进了 \\d+ 年起的那场大疫)?$`));
    // 起了新的一场时,传到别的州的那几州卡片上也写"瘟疫"
    const span = plagueSpans(c1).find((s) => s.id === PLAGUE_IV);
    const far = span?.hits.find((h) => h.region !== r && h.loss >= 0.1);
    expect(far).toBeDefined();
    expect(regionDisasterMark(c1, far!.region, far!.year)?.word).toBe('瘟疫');
    const c2 = generateCiv(world(), { interventions: [famine], endYear: T + 20 });
    expect(newIvDoneText(c2, famine, 0, A, undefined)).toEqual({ ok: true, text: `${A}大饥（轻）` });
    const c3 = generateCiv(world(), { interventions: [quake], endYear: T + 200 });
    const r3 = newIvDoneText(c3, quake, 0, '', undefined)!;
    expect(r3.ok).toBe(true);
    expect(r3.text).toMatch(new RegExp(`^${regionLabel(c3, r)}一带(地震|大水|大旱)，\\d+ 州受灾$`));
    // 州卡片:那年起写划掉的原数和哪年什么灾,之前不写,两百年后长回来了也不写
    const m = regionDisasterMark(c3, r, T)!;
    expect(m.when).toBe(T);
    expect(m.word).toMatch(/^(地震|大水|大旱)$/);
    expect(m.now).toBeCloseTo(regionPopulationAt(c3, r, T), 6);
    expect(m.was).toBeGreaterThan(m.now * 1.1);
    expect(regionDisasterMark(c3, r, T - 1)).toBeNull();
    expect(regionDisasterMark(c3, r, T + 199)).toBeNull();
    // 没下天灾的世界一律不写
    expect(regionDisasterMark(base0, r, T)).toBeNull();
    // 那座城已毁:没生效,黄色写原因
    const gone = base0.settlements.find((s) => s.ended !== undefined && s.ended < T - 20 && s.founded < T - 200 && s.name)!;
    const late: Intervention = { kind: 'disaster', type: 'plague', level: 1, from: T, city: settlementKey(base0, gone.id) };
    const c4 = generateCiv(world(), { interventions: [late], endYear: T + 10 });
    const r4 = newIvDoneText(c4, late, 0, '', undefined)!;
    expect(r4.ok).toBe(false);
    expect(r4.text).toMatch(new RegExp(`^${gone.name}的瘟疫没生效：`));
  });
});

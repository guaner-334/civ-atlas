/**
 * 新干预:灭国(destroy)、让人物去世(death)、改君主倾向(temper)、即位等在位的那位下台(crown 的 after)、天灾(disaster):
 * - 清理:各种只留自己的字段;人物键的国家要和 a 一样、身份对得上(改倾向只认君主)
 * - 第 T 年下:T 以前逐字节不变;各自生效的样子(归属、在位表、人物、城的折损、史事);没生效的原因;编年史的说法
 * - 将领、名臣去世只改人物和编年史:历史(归属日志、史事)和不下这条一样
 * - 逐年推演中途下这几种,和带着同样的命令一口气推完逐字段相等(seed 7、2024、11);从任一年接着推、存档读回来也一样
 * 没有这几种干预的世界不变由 determinism.test.ts 的指纹管着(21 组)
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import { effOf, polityModelOf, rulerOf } from '../src/gen/civ/polities';
import { IV_PROTECTED, leaningEffect } from '../src/gen/civ/rulers';
import { ownersAt } from '../src/gen/civ/engine/timeline';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { capitalAt } from '../src/gen/civ/growth';
import { rulerAt } from '../src/gen/civ/story/peopleInfo';
import { IV_LOSS, PLAGUE_IV, quakeRing } from '../src/gen/civ/calamity';
import { plagueSpans } from '../src/gen/civ/story/plagueSpans';
import { playCiv, playStop, playTurn } from '../src/gen/civ/play';
import { interventionFate } from '../src/gen/stepwise';
import { cleanIntervention, cleanInterventions, personKey, polityKey, regionKey, resolvePersonKey, settlementKey, type Intervention } from '../src/gen/edits';
import type { Person } from '../src/gen/civ/types';
import { resumeCiv } from '../src/gen/civ/modules';

const worlds = new Map<number, World>();
const world = (seed: number) => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld({ ...DEFAULT_PARAMS, seed })));
  return w;
};
const bases = new Map<number, Civ>();
const baseOf = (seed: number) => {
  let c = bases.get(seed);
  if (!c) bases.set(seed, (c = generateCiv(world(seed))));
  return c;
};

/** T 年州最多的国家 */
function biggestAt(civ: Civ, T: number): number {
  const n = new Map<number, number>();
  for (const o of ownersAt(civ, T).polity) if (o >= 0) n.set(o, (n.get(o) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** T 年和 pid 接壤的国家(编号升序) */
function neighborsAt(civ: Civ, pid: number, T: number): number[] {
  const own = ownersAt(civ, T).polity;
  const reg = civ.regions;
  const out = new Set<number>();
  for (let r = 0; r < reg.count; r++) {
    if (own[r] !== pid) continue;
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) if (own[reg.adj[k]] >= 0 && own[reg.adj[k]] !== pid) out.add(own[reg.adj[k]]);
  }
  return [...out].sort((a, b) => a - b);
}

/** T 年 pid 的州 */
function landsAt(civ: Civ, pid: number, T: number): number[] {
  const own = ownersAt(civ, T).polity;
  const out: number[] = [];
  for (let r = 0; r < own.length; r++) if (own[r] === pid) out.push(r);
  return out;
}

/** 变化日志里 T 年以前的条目 */
function logBefore(civ: Civ, T: number): number[][] {
  const L = civ.log;
  const out: number[][] = [];
  for (let i = 0; i < L.size && L.year[i] < T; i++) out.push([L.year[i], L.region[i], L.layer[i], L.value[i], L.cause[i]]);
  return out;
}

/** T 以前逐字节不变(日志、史事、检查点) */
function sameBefore(civ: Civ, base: Civ, T: number) {
  expect(logBefore(civ, T)).toEqual(logBefore(base, T));
  expect(civ.annals.filter((e) => e.year < T)).toEqual(base.annals.filter((e) => e.year < T));
  expect(civ.checkpoints.filter((c) => c.year < T)).toEqual(base.checkpoints.filter((c) => c.year < T));
}

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

/** 编年史里 T 年的【干预】那几条 */
const ivLines = (civ: Civ, T?: number) => buildChronicle(civ).filter((x) => (T === undefined || Math.floor(x.year) === T) && x.text.startsWith('【干预】'));

/** T 年州最多、有邻国的国家和它的一个邻国 */
function pairAt(civ: Civ, T: number): [number, number] {
  const n = new Map<number, number>();
  for (const o of ownersAt(civ, T).polity) if (o >= 0) n.set(o, (n.get(o) ?? 0) + 1);
  for (const [p] of [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])) {
    const near = neighborsAt(civ, p, T);
    if (near.length) return [p, near[0]];
  }
  throw new Error('没有接壤的国家');
}

/** T 年在世、出过道的将领 / 入了仕的名臣(之后还有事的优先;没有 = undefined) */
function officerAt(civ: Civ, role: 'general' | 'minister', T: number): Person | undefined {
  const live = (civ.people ?? []).filter((x) => {
    if (x.role !== role || (x.died !== undefined && x.died <= T)) return false;
    // 名臣还要在朝(已经致仕、随故朝去职的,让他去世不生效)
    if (role === 'minister' && x.until !== undefined && x.until <= T) return false;
    const from = role === 'general' ? x.commands?.[0]?.from : x.from;
    return from !== undefined && from < T;
  });
  const busy = live.filter((x) => (role === 'general' ? (x.commands ?? []).some((c) => c.from > T) : (x.deeds ?? []).some((d) => d.year > T)));
  return (busy.length ? busy : live)[0];
}

const L0 = { expand: 0, war: 0, develop: 50, trade: 50 };

describe('新干预 · 清理', () => {
  const a = 'polity:c100#0';
  const b = 'polity:c200#0';
  const ruler = `person:${a}|ruler|燕溟|1290`;
  it('灭国:并入别国的留 b,并入自己 / 格式不对的去掉 b', () => {
    const ok: Intervention = { kind: 'destroy', a, from: 1300, b };
    expect(cleanIntervention(ok)).toBe(ok);
    expect(cleanIntervention({ kind: 'destroy', a, from: 1300, b: a })).toEqual({ kind: 'destroy', a, from: 1300 });
    expect(cleanIntervention({ kind: 'destroy', a, from: 1300, b: 'x', city: 'settlement:c1#0' })).toEqual({ kind: 'destroy', a, from: 1300 });
  });
  it('让人物去世、改倾向:人物键的国家要是 a;去世认君主、将领、名臣,改倾向只认君主;倾向取整夹回', () => {
    const d: Intervention = { kind: 'death', a, person: ruler, from: 1300 };
    expect(cleanIntervention(d)).toBe(d);
    expect(cleanIntervention({ kind: 'death', a, person: `person:${a}|general|燕鸾澈|1270#1`, from: 1300 })).not.toBeNull();
    expect(cleanIntervention({ kind: 'death', a, person: `person:${a}|minister|鸿丘|1260`, from: 1300 })).not.toBeNull();
    expect(cleanIntervention({ kind: 'death', a, person: `person:${a}|prince|燕某|1290`, from: 1300 })).toBeNull();
    expect(cleanIntervention({ kind: 'death', a: b, person: ruler, from: 1300 })).toBeNull();
    expect(cleanIntervention({ kind: 'death', a, person: 'person:x', from: 1300 })).toBeNull();
    expect(cleanIntervention({ kind: 'temper', a, person: `person:${a}|general|燕鸾澈|1270`, from: 1300, leanings: L0 })).toBeNull();
    expect(cleanIntervention({ kind: 'temper', a, person: ruler, from: 1300, leanings: { expand: 120.4, war: -3, trade: 33.6 } })).toEqual({
      kind: 'temper',
      a,
      person: ruler,
      from: 1300,
      leanings: { expand: 100, war: 0, develop: 50, trade: 34 },
    });
  });
  it('即位等在位的那位下台:after 留着,字段先后照旧;不是 true 的去掉', () => {
    const v: Intervention = { kind: 'crown', a, char: 3, from: 1300, born: 1270, until: 1340, after: true, leanings: L0 };
    expect(cleanIntervention(v)).toBe(v);
    expect(cleanIntervention({ ...v, after: 1 })).toEqual({ kind: 'crown', a, char: 3, from: 1300, born: 1270, until: 1340, leanings: L0 });
  });
  it('天灾:只留那一种用的字段;饥荒给了国家就不要州,州去重、最多 64 个;种类、轻重不对的不收', () => {
    const p: Intervention = { kind: 'disaster', type: 'plague', level: 3, from: 1300, city: 'settlement:c5#0' };
    expect(cleanIntervention(p)).toBe(p);
    expect(cleanIntervention({ ...p, region: 'region:c1', a })).toEqual(p);
    expect(cleanIntervention({ kind: 'disaster', type: 'famine', level: 1, from: 1300, a, regions: ['region:c1'] })).toEqual({ kind: 'disaster', type: 'famine', level: 1, from: 1300, a });
    const many = Array.from({ length: 80 }, (_, i) => `region:c${i % 70}`);
    const f = cleanIntervention({ kind: 'disaster', type: 'famine', level: 2, from: 1300, regions: ['bad', ...many] });
    expect(f && f.kind === 'disaster' ? f.regions : null).toEqual(Array.from({ length: 64 }, (_, i) => `region:c${i}`));
    expect(cleanIntervention({ kind: 'disaster', type: 'famine', level: 2, from: 1300, regions: [] })).toBeNull();
    expect(cleanIntervention({ kind: 'disaster', type: 'quake', level: 2, from: 1300, region: 'region:c9' })).toEqual({ kind: 'disaster', type: 'quake', level: 2, from: 1300, region: 'region:c9' });
    expect(cleanIntervention({ kind: 'disaster', type: 'quake', level: 4, from: 1300, region: 'region:c9' })).toBeNull();
    expect(cleanIntervention({ kind: 'disaster', type: 'flood', level: 1, from: 1300, region: 'region:c9' })).toBeNull();
    expect(cleanIntervention({ kind: 'disaster', type: 'plague', level: 1, from: 1300 })).toBeNull();
  });
});

describe.each([7, 2024])('新干预 · seed=%i', (seed) => {
  const T = 1300;

  it('灭国:并入一国 —— 那一刻全部国土归它,史事记州数,编年史一条;散成无主 —— 那一刻都没了主,日后邻国再往里去', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const [pid, nb] = pairAt(base, T);
    const lands = landsAt(base, pid, T);
    const civ = generateCiv(w, { interventions: [{ kind: 'destroy', a: polityKey(base, pid), b: polityKey(base, nb), from: T }], endYear: T + 60 });
    sameBefore(civ, base, T);
    const e = civ.annals.find((x) => x.kind === 'intervene')!;
    expect(e).toMatchObject({ year: T, a: pid, b: nb, war: 0, n: lands.length });
    expect(civ.polities[pid].ended).toBe(T);
    const own = ownersAt(civ, T).polity;
    for (const r of lands) expect(own[r]).toBe(nb);
    expect(interventionFate(civ, 0)).toEqual({ state: 'done', annal: civ.annals.indexOf(e) });
    const lines = ivLines(civ, T);
    expect(lines.map((x) => x.text)).toEqual([expect.stringMatching(/^【干预】.+亡,.+州并入.+$/)]);
    // 亡国那一条并进了干预那一条
    expect(buildChronicle(civ).some((x) => x.year === T && x.kind === 'fall' && !x.text.startsWith('【干预】'))).toBe(false);

    const loose = generateCiv(w, { interventions: [{ kind: 'destroy', a: polityKey(base, pid), from: T }], endYear: T + 80 });
    expect(loose.annals.find((x) => x.kind === 'intervene')).toMatchObject({ a: pid, b: -1, n: lands.length });
    const now = ownersAt(loose, T).polity;
    for (const r of lands) expect(now[r]).toBe(-1);
    const later = ownersAt(loose, T + 80).polity;
    expect(lands.some((r) => later[r] >= 0)).toBe(true);
    expect(ivLines(loose, T)[0].text).toMatch(/散为无主之地$/);
  }, 120_000);

  it('灭国:那一年已亡 = 不生效(历史和不下一样,写原因)', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const gone = base.polities.find((p) => p.ended !== undefined && p.ended < T - 50)!;
    const civ = generateCiv(w, { interventions: [{ kind: 'destroy', a: polityKey(base, gone.id), from: T }] });
    expect(civ.annals.find((e) => e.kind === 'intervene')).toMatchObject({ a: gone.id, b: -3 });
    expect(civ.log).toEqual(base.log);
    expect(interventionFate(civ, 0)).toMatchObject({ state: 'void', why: expect.stringMatching(/已亡$/) });
  }, 120_000);

  it('灭国撞上"不许灭":后下的为准 —— 灭国后面又下了护着那一刻的"不许灭" = 不生效(写原因);"不许灭"先下 / 那一刻还没生效 = 照灭', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const [pid] = pairAt(base, T);
    const a = polityKey(base, pid);
    const kill: Intervention = { kind: 'destroy', a, from: T };
    const keep: Intervention = { kind: 'protect', a, from: T - 20 };
    const end = T + 60;
    // 灭国在前、"不许灭"在后:没灭,历史和只下"不许灭"一样
    const kept = generateCiv(w, { interventions: [kill, keep], endYear: end });
    const only = generateCiv(w, { interventions: [keep], endYear: end });
    expect(kept.annals.find((e) => e.kind === 'intervene' && e.war === 0)).toMatchObject({ year: T, a: pid, b: IV_PROTECTED });
    expect(kept.log).toEqual(only.log);
    expect(kept.polities[pid].ended).toBe(only.polities[pid].ended);
    expect(interventionFate(kept, 0)).toMatchObject({ state: 'void', why: expect.stringMatching(/受后下的「保护」护着$/) });
    expect(ivLines(kept, T).some((x) => /欲灭.+然又有令保.+不亡/.test(x.text))).toBe(true);
    // "不许灭"在前、灭国在后:照灭
    const gone = generateCiv(w, { interventions: [keep, kill], endYear: end });
    expect(gone.annals.find((e) => e.kind === 'intervene' && e.war === 1)).toMatchObject({ year: T, a: pid, b: -1 });
    expect(gone.polities[pid].ended).toBe(T);
    // 后下的"不许灭"那一刻已到期 / 还没生效:不算,照灭
    for (const late of [{ ...keep, until: T - 5 }, { ...keep, from: T + 10 }] as Intervention[]) {
      const civ = generateCiv(w, { interventions: [kill, late], endYear: end });
      expect(civ.polities[pid].ended).toBe(T);
    }
  }, 120_000);

  it('让君主去世:他到那一刻为止(卒年 = 那一年),下一位从那一刻即位;编年史写"暴崩 / 暴薨……";不在位的写原因', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const pid = biggestAt(base, T);
    const x = rulerAt(base, pid, T)!;
    const key = personKey(base, x.id);
    const civ = generateCiv(w, { interventions: [{ kind: 'death', a: polityKey(base, pid), person: key, from: T }], endYear: T + 60 });
    sameBefore(civ, base, T);
    expect(civ.annals.find((e) => e.kind === 'intervene')).toMatchObject({ year: T, a: pid, b: -1 });
    const him = civ.people![resolvePersonKey(civ, key)];
    expect(him).toMatchObject({ killed: 0, died: T, until: T, fate: 'died' });
    const next = civ.people!.filter((p) => p.role === 'ruler' && p.polity === pid && p.from === T);
    expect(next).toHaveLength(1);
    expect(next[0].rise).toBe('heir');
    // 推演里:那一刻还是他,下一刻起是下一位
    const pm = polityModelOf(resumeCiv(w, civ))!;
    expect(rulerOf(pm, pid, T).from).toBe(x.from);
    expect(rulerOf(pm, pid, T + 1 / 256).from).toBe(T);
    expect(ivLines(civ, T)[0].text).toMatch(/^【干预】.+(暴|猝然).+(在位.+年|即位当年)$/);
    expect(interventionFate(civ, 0).state).toBe('done');

    // 他早已下台 / 已卒:不生效(历史和不下一样)
    const old = base.people!.find((p) => p.role === 'ruler' && p.polity === pid && p.until !== undefined && p.until < T && p.author === undefined)!;
    const c2 = generateCiv(w, { interventions: [{ kind: 'death', a: polityKey(base, pid), person: personKey(base, old.id), from: T }] });
    expect(c2.annals.find((e) => e.kind === 'intervene')).toMatchObject({ a: pid, b: -4 });
    expect(c2.log).toEqual(base.log);
    expect(interventionFate(c2, 0)).toMatchObject({ state: 'void', why: expect.stringMatching(/已不在位|已卒/) });
  }, 120_000);

  it('让将领、名臣去世:只改人物和编年史(归属日志、别的史事和不下一样),他那一年卒;已卒的写原因', () => {
    const w = world(seed);
    const base = baseOf(seed);
    for (const role of ['general', 'minister'] as const) {
      // 那一年在世、出过道的(种子 7 那几百年少打仗:找不到就往后挪)
      let Y = 1300;
      while (!officerAt(base, role, Y)) Y += 50;
      const x = officerAt(base, role, Y)!;
      const key = personKey(base, x.id);
      const civ = generateCiv(w, { interventions: [{ kind: 'death', a: polityKey(base, x.polity), person: key, from: Y }] });
      expect(civ.log, role).toEqual(base.log);
      expect(civ.annals.filter((e) => e.kind !== 'intervene'), role).toEqual(base.annals);
      expect(civ.annals.find((e) => e.kind === 'intervene'), role).toMatchObject({ a: x.polity, b: -5 });
      const him = civ.people![resolvePersonKey(civ, key)];
      expect(him, role).toMatchObject({ killed: 0, died: Y });
      if (role === 'general') expect(him.commands!.every((c) => c.from <= Y), role).toBe(true);
      expect(ivLines(civ, Y)[0].text, role).toMatch(/卒$/);
      expect(interventionFate(civ, 0).state, role).toBe('done');
      // 已卒的:不生效
      const dead = base.people!.find((p) => p.role === role && p.died !== undefined && p.died < Y - 10)!;
      const c2 = generateCiv(w, { interventions: [{ kind: 'death', a: polityKey(base, dead.polity), person: personKey(base, dead.id), from: Y }] });
      expect(c2.people!.some((p) => p.killed !== undefined), role).toBe(false);
      expect(interventionFate(c2, 0), role).toMatchObject({ state: 'void', why: expect.stringMatching(/已卒$/) });
      // 名臣已经去职(还在世):不生效
      const left = role === 'minister' ? base.people!.find((p) => p.role === role && p.until !== undefined && p.until < Y && (p.died === undefined || p.died > Y + 1)) : undefined;
      if (left) {
        const c3 = generateCiv(w, { interventions: [{ kind: 'death', a: polityKey(base, left.polity), person: personKey(base, left.id), from: Y }] });
        expect(c3.people!.some((p) => p.killed !== undefined)).toBe(false);
        expect(interventionFate(c3, 0)).toMatchObject({ state: 'void', why: expect.stringMatching(/已去职$/) });
      }
    }
  }, 240_000);

  it('让将领去世:那一刻以前各场仗的统帅都不变(同一国同时打着别的仗也一样),同一个人不会同时领两场仗', () => {
    const w = world(seed);
    const base = baseOf(seed);
    /** 那一刻以前开始领兵的每一段:战争 + 哪一方 + 从哪年起 → 谁 */
    const before = (civ: Civ, Y: number) => {
      const out = new Map<string, string>();
      for (const x of civ.people ?? []) for (const c of x.commands ?? []) if (c.from < Y) out.set(`${c.war}:${c.side}:${c.from}`, `${x.name}|${x.born}`);
      return out;
    };
    // 正领着一场仗、本国同时还在打另一场仗的将领(找不到就退回随便一位在世的将领)
    let pick: [Person, number] | undefined;
    for (let Y = 1300; Y < base.endYear && !pick; Y += 25) {
      for (const x of base.people ?? []) {
        if (x.role !== 'general' || (x.died !== undefined && x.died <= Y)) continue;
        const now = (x.commands ?? []).find((c) => c.from < Y && c.until > Y);
        if (!now) continue;
        const busy = (base.people ?? []).some((o) => o !== x && o.polity === x.polity && (o.commands ?? []).some((c) => c.war !== now.war && c.side === now.side && c.from < Y && c.until > Y));
        if (busy) {
          pick = [x, Y];
          break;
        }
      }
    }
    if (!pick) {
      const Y = 1500;
      pick = [officerAt(base, 'general', Y)!, Y];
    }
    const [x, Y] = pick;
    const civ = generateCiv(w, { interventions: [{ kind: 'death', a: polityKey(base, x.polity), person: personKey(base, x.id), from: Y }] });
    expect(before(civ, Y)).toEqual(before(base, Y));
    for (const c of [base, civ]) {
      for (const p of c.people ?? []) {
        const cs = p.commands ?? [];
        for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) expect(cs[i].from < cs[j].until && cs[j].from < cs[i].until, p.name).toBe(false);
      }
    }
  }, 240_000);

  it('改君主倾向:那一刻照旧,下一刻起照新的倾向到他下台;人物记着改过的;编年史写"性情大变"', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const pid = biggestAt(base, T);
    const x = rulerAt(base, pid, T)!;
    const key = personKey(base, x.id);
    const to = { expand: 0, war: 0, develop: 90, trade: 90 };
    const civ = generateCiv(w, { interventions: [{ kind: 'temper', a: polityKey(base, pid), person: key, from: T, leanings: to }], endYear: T + 60 });
    sameBefore(civ, base, T);
    expect(civ.annals.find((e) => e.kind === 'intervene')).toMatchObject({ year: T, a: pid, b: -1 });
    const him = civ.people![resolvePersonKey(civ, key)];
    expect(him.leanings).toEqual(x.leanings);
    expect(him.moods).toEqual([{ year: T, leanings: to, iv: 0 }]);
    const pm = polityModelOf(resumeCiv(w, civ))!;
    expect(effOf(pm, pid, T)).toEqual(leaningEffect(x.leanings!));
    if ((him.until ?? Infinity) > T + 1) expect(effOf(pm, pid, T + 1 / 256)).toEqual(leaningEffect(to));
    expect(ivLines(civ, T)[0].text).toMatch(/性情大变/);
  }, 120_000);

  it('即位等在位的那位下台:下令那年只登记(编年史不列),他下台那一刻作者的人物即位;同时让他去世 = 那一刻即位', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const pid = biggestAt(base, T);
    const x = rulerAt(base, pid, T)!;
    const a = polityKey(base, pid);
    const v: Intervention = { kind: 'crown', a, char: 7, from: T, born: T - 30, after: true, leanings: L0 };
    const civ = generateCiv(w, { interventions: [v], endYear: T + 200 });
    sameBefore(civ, base, T);
    const ivs = civ.annals.filter((e) => e.kind === 'intervene');
    expect(ivs[0]).toMatchObject({ year: T, a: pid, b: -6 });
    expect(ivLines(civ, T)).toEqual([]);
    const cur = rulerAt(civ, pid, T)!;
    expect(cur.from).toBe(x.from);
    const me = civ.people!.find((p) => p.author === 7);
    if (cur.until !== undefined && (cur.fate === 'died' || cur.fate === 'murdered' || cur.fate === 'retired')) {
      // 他照常下台:作者的人物那一刻接位
      expect(me).toMatchObject({ rise: 'crown', from: cur.until, polity: pid });
      expect(ivs[1]).toMatchObject({ year: cur.until, a: pid, b: -1, war: 0 });
      expect(interventionFate(civ, 0)).toEqual({ state: 'done', annal: civ.annals.indexOf(ivs[1]) });
      expect(ivLines(civ, Math.floor(cur.until))[0].text).toMatch(/即.+君位$/);
    } else expect(me === undefined || me.from === undefined || me.from > T).toBe(true);

    // 同时(第 T + 5 年)让他去世:作者的人物那一刻即位
    const x5 = rulerAt(base, pid, T + 5)!;
    if (x5 !== x) return;
    const c2 = generateCiv(w, { interventions: [v, { kind: 'death', a, person: personKey(base, x.id), from: T + 5 }], endYear: T + 60 });
    const me2 = c2.people!.find((p) => p.author === 7)!;
    expect(me2).toMatchObject({ rise: 'crown', from: T + 5 });
    expect(c2.annals.filter((e) => e.kind === 'intervene' && e.war === 0).map((e) => e.b)).toEqual([-6, -1]);
  }, 180_000);

  it('天灾:瘟疫从那座城起(城里死五成,史事 plague 编号 PLAGUE_IV + 下标)、饥荒一国的城都折损、地震水旱那一带;编年史各一条', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const pid = biggestAt(base, T);
    const cap = capitalAt(base.polities[pid], T);
    const list: Intervention[] = [{ kind: 'disaster', type: 'plague', level: 3, from: T, city: settlementKey(base, cap) }];
    const civ = generateCiv(w, { interventions: list, endYear: T + 40 });
    sameBefore(civ, base, T);
    const k = civ.annals.findIndex((e) => e.kind === 'intervene');
    expect(civ.annals[k]).toMatchObject({ year: T, a: pid, b: 1, settlement: cap });
    expect(civ.annals[k + 1]).toMatchObject({ year: T, kind: 'plague', war: PLAGUE_IV });
    expect(civ.settlements[cap].sacks).toContainEqual({ year: T, loss: IV_LOSS[3], cause: 'plague' });
    expect(ivLines(civ, T)[0].text).toMatch(/大疫,死者十之五$/);
    expect(plagueSpans(civ).find((x) => x.id === PLAGUE_IV)).toMatchObject({ start: T });
    // 起疫那城在部落地带(没有史事 plague):照样算一场,城的折损归它
    const own = ownersAt(base, T);
    const wild = base.settlements.find((s) => s.ended === undefined && s.founded < T && own.polity[s.region] < 0 && own.culture[s.region] >= 0);
    if (wild) {
      const c3 = generateCiv(w, { interventions: [{ kind: 'disaster', type: 'plague', level: 2, from: T, city: settlementKey(base, wild.id) }], endYear: T + 40 });
      const span = plagueSpans(c3).find((x) => x.id === PLAGUE_IV);
      expect(span).toMatchObject({ start: T });
      expect(span!.hits[0]).toMatchObject({ settlement: wild.id, year: T, loss: IV_LOSS[2] });
    }

    const fam = generateCiv(w, { interventions: [{ kind: 'disaster', type: 'famine', level: 2, from: T, a: polityKey(base, pid) }], endYear: T + 40 });
    const fk = fam.annals.findIndex((e) => e.kind === 'intervene');
    expect(fam.annals[fk + 1]).toMatchObject({ year: T, kind: 'famine', a: pid });
    const hit = fam.settlements.filter((s) => s.sacks?.some((x) => x.year === T && x.cause === 'famine'));
    expect(hit.length).toBe(fam.annals[fk].b);
    expect(hit.every((s) => s.sacks!.find((x) => x.year === T)!.loss === IV_LOSS[2])).toBe(true);
    expect(ivLines(fam, T).map((x) => x.text)).toEqual([expect.stringMatching(/大饥,民多饿死,死者十之三$/)]);

    const r = civ.settlements[cap].region;
    const quake = generateCiv(w, { interventions: [{ kind: 'disaster', type: 'quake', level: 1, from: T, region: regionKey(base, r) }], endYear: T + 40 });
    const q = quake.annals.find((e) => e.kind === 'intervene')!;
    const ring = new Set(quakeRing(quake.regions, r));
    const shaken = quake.settlements.filter((s) => s.sacks?.some((x) => x.year === T && x.cause === 'quake'));
    expect(q).toMatchObject({ region: r, b: shaken.length });
    expect(shaken.every((s) => ring.has(s.region))).toBe(true);
    expect(ivLines(quake, T)[0].text).toMatch(/一带(地震|大水|大旱).+死者十之一二$/);
  }, 180_000);

  it('瘟疫接连几年下:并进正在传的那一场(同一刻那一场也在往外传),从哪一刻接着推都和一口气推完一样', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const [pid, nb] = pairAt(base, T);
    const city = (p: number) => settlementKey(base, capitalAt(base.polities[p], T));
    const list: Intervention[] = [
      { kind: 'disaster', type: 'plague', level: 3, from: T, city: city(pid) },
      { kind: 'disaster', type: 'plague', level: 2, from: T + 1, city: city(nb) },
      { kind: 'disaster', type: 'plague', level: 1, from: T + 2, city: city(pid) },
    ];
    const full = generateCiv(w, { interventions: list, endYear: T + 30 });
    expect(full.annals.filter((e) => e.kind === 'intervene').map((e) => e.b)).toContain(2);
    for (const from of [T, playStop(T + 1), T + 1, playStop(T + 2), T + 2, T + 3]) {
      const head = generateCiv(w, { interventions: list, endYear: from });
      same(continueCiv(w, head, { interventions: list, endYear: T + 30 }), full, `从 ${from} 接着推`);
    }
  }, 120_000);

  it('天灾:那座城已毁 / 那一带没人住 = 不生效(历史和不下一样,写原因)', () => {
    const w = world(seed);
    const base = baseOf(seed);
    // 早先毁了的城(GENERATOR_VERSION 39 时种子 2024 第 1280 年以前没有毁过城:那就在头一座毁了 20 年以后下)
    const ruin = base.settlements.filter((s) => s.ended !== undefined).sort((a, b) => a.ended! - b.ended!)[0];
    const at = Math.max(T, Math.ceil(ruin.ended!) + 20);
    const civ = generateCiv(w, { interventions: [{ kind: 'disaster', type: 'plague', level: 2, from: at, city: settlementKey(base, ruin.id) }] });
    expect(civ.annals.find((e) => e.kind === 'intervene')).toMatchObject({ b: 0 });
    expect(civ.log).toEqual(base.log);
    expect(interventionFate(civ, 0)).toMatchObject({ state: 'void', why: expect.stringMatching(/已毁$/) });
    const cu = ownersAt(base, T).culture.slice();
    const empty = cu.findIndex((c, r) => c < 0 && quakeRing(base.regions, r).every((q) => cu[q] < 0));
    if (empty < 0) return;
    const c2 = generateCiv(w, { interventions: [{ kind: 'disaster', type: 'quake', level: 3, from: T, region: regionKey(base, empty) }] });
    expect(c2.annals.find((e) => e.kind === 'intervene')).toMatchObject({ b: 0 });
    expect(c2.log).toEqual(base.log);
    expect(interventionFate(c2, 0)).toMatchObject({ state: 'void', why: '那一带那年没人住' });
  }, 120_000);
});

describe.each([7, 2024, 11])('新干预 · 逐年推演 seed=%i', (seed) => {
  const T = 1300;

  it('中途下灭国、让人物去世、改倾向、等他下台再即位、天灾,和带着同样的命令一口气推完逐字段相等;从任一年接着推、存档读回来也一样', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const pid = biggestAt(base, T);
    const a = polityKey(base, pid);
    const near = neighborsAt(base, pid, T);
    const x = rulerAt(base, pid, T)!;
    const officers = [officerAt(base, 'general', T + 5), officerAt(base, 'minister', T + 5)].filter((x) => x !== undefined);
    const cap = capitalAt(base.polities[pid], T);
    const steps: [number, Intervention[]][] = [
      [T, [{ kind: 'temper', a, person: personKey(base, x.id), from: T, leanings: { expand: 90, war: 90, develop: 10, trade: 10 } }, { kind: 'crown', a, char: 5, from: T, born: T - 25, after: true, leanings: L0 }]],
      [
        T + 5,
        [
          ...officers.map((o): Intervention => ({ kind: 'death', a: polityKey(base, o.polity), person: personKey(base, o.id), from: T + 5 })),
          { kind: 'disaster', type: 'plague', level: 2, from: T + 5, city: settlementKey(base, cap) },
        ],
      ],
      [T + 12, [{ kind: 'death', a, person: personKey(base, x.id), from: T + 12 }, { kind: 'disaster', type: 'famine', level: 1, from: T + 12, a }]],
      [T + 30, near.length ? [{ kind: 'destroy', a: polityKey(base, near[0]), from: T + 30 }, { kind: 'disaster', type: 'quake', level: 3, from: T + 30, region: regionKey(base, base.settlements[cap].region) }] : []],
    ];
    let civ = playCiv(w, {}, { year: T, commands: [] });
    let play = { year: T, commands: [] as Intervention[] };
    const all: Intervention[] = [];
    for (let i = 0; i < steps.length; i++) {
      const [y, cmds] = steps[i];
      expect(play.year).toBe(y);
      const n = (steps[i + 1]?.[0] ?? T + 80) - y;
      const r = playTurn(w, civ, {}, play, cmds, n);
      expect(r.rejected).toEqual([]);
      civ = r.civ;
      play = r.play;
      all.push(...cmds);
    }
    const one = generateCiv(w, { interventions: all, endYear: playStop(T + 80) });
    same(civ, one, '逐年推演');
    // 存档读回来(JSON 往返、清理)接着推,和一口气推完一样
    const saved = cleanInterventions(JSON.parse(JSON.stringify(all)));
    expect(saved).toEqual(all);
    const full = generateCiv(w, { interventions: all, endYear: T + 150 });
    for (const from of [T - 5, T, T + 5, T + 12, T + 13, T + 31, T + 80]) {
      const head = generateCiv(w, { interventions: saved, endYear: from });
      same(continueCiv(w, head, { interventions: saved, endYear: T + 150 }), full, `从 ${from} 年接着推`);
    }
  }, 600_000);
});

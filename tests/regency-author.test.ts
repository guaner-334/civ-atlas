/**
 * 让作者的人物掌权(干预 regent 带 char,不带人物键):推演照推演人物的大臣专权算 —— 名义君主照旧在位,那几年本国照他的性格,
 * 到期还政 / 到卒年卒于位;人物里添一位(Person.author)、编年史写他的名字;下令以前的历史不变;从哪一刻接着推都和一口气推完一样;
 * 存档读回来推出同一个世界;不能生效的(国已亡、共和国、作者立的君主在位、已有人掌权、他还没出生 / 已去世 / 不满 16 岁)写原因、历史不变。
 * 没下这条干预的世界不受影响由 determinism.test.ts 的指纹管着
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import type { Person } from '../src/gen/civ/types';
import { CivSim } from '../src/gen/civ/sim';
import { polityModelOf, rulingLeanings } from '../src/gen/civ/polities';
import { buildChronicle } from '../src/gen/civ/chronicle';
import { holderAt } from '../src/gen/civ/regentInfo';
import { IV_NOT_HIM } from '../src/gen/civ/rulers';
import { IV_GONE, IV_HELD, IV_NO_THRONE } from '../src/gen/civ/regents';
import { applyCharacters } from '../src/gen/characters';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { EMPTY_EDITS, cleanIntervention, polityKey, type Intervention } from '../src/gen/edits';

const PARAMS = (seed: number) => ({ ...DEFAULT_PARAMS, cells: 12000, seed });
const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld(PARAMS(seed))));
  return w;
}
const bases = new Map<number, Civ>();
function baseOf(seed: number): Civ {
  let c = bases.get(seed);
  if (!c) bases.set(seed, (c = generateCiv(world(seed))));
  return c;
}

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}
const before = (civ: Civ, T: number) => civ.annals.filter((e) => e.year < T);
const rulersOf = (civ: Civ) => (civ.people ?? []).filter((x) => x.role === 'ruler' && x.author === undefined && civ.polities[x.polity]?.lineage !== 'republic');
const free = (civ: Civ, pid: number, T: number, n: number) => {
  for (let t = T; t <= T + n; t++) if (holderAt(civ, pid, t)) return false;
  return true;
};

/** 一位君主 R 在位、那几年没人掌权的一年 T(R 即位后一年,往后至少还在位 n 年) */
function caseOf(civ: Civ, n = 14): { pid: number; T: number; R: Person } | null {
  for (const R of rulersOf(civ)) {
    if ((R.from ?? 0) < 700 || R.until === undefined) continue;
    const T = Math.ceil(R.from!) + 1;
    if (T + n < R.until && free(civ, R.polity, T, n)) return { pid: R.polity, T, R };
  }
  return null;
}

const BOLD = { expand: 100, war: 100, develop: 40, trade: 30 };
const CHAR = 1;
const NAME = '林小满';
/** 让作者的人物 1 号第 T 年起掌 pid 的权 */
const regent = (civ: Civ, pid: number, T: number, o: { born: number; died?: number; years?: number; how?: 'chancellor' | 'general' }): Intervention =>
  cleanIntervention({ kind: 'regent', a: polityKey(civ, pid), char: CHAR, born: o.born, ...(o.died !== undefined ? { died: o.died } : {}), from: T, how: o.how ?? 'chancellor', end: 'return', ...(o.years !== undefined ? { years: o.years } : {}), leanings: BOLD })!;
/** 套上人物卡的名字 */
const named = (civ: Civ, born: number) => applyCharacters(civ, [{ id: CHAR, name: NAME, color: 'red', born }]);
/** 第 i 条干预那一条史事 */
const ivAnnal = (civ: Civ, i = 0) => civ.annals.find((e) => e.kind === 'intervene' && e.war === i)!;
/** 推演里的他(作者的人物、那一国) */
const authorIn = (civ: Civ, pid: number) => civ.people?.find((x) => x.author === CHAR && x.polity === pid);

for (const seed of [7, 2024]) {
  describe(`让作者的人物掌权 · seed=${seed}`, () => {
    it('掌权几年后还政:那几年本国照他的性格,到期还政、接着推;人物里添一位;编年史写他的名字;下令以前的历史不变', () => {
      const w = world(seed);
      const base = baseOf(seed);
      const c = caseOf(base)!;
      expect(c).not.toBeNull();
      const born = c.T - 35;
      const v = regent(base, c.pid, c.T, { born, years: 5 });
      const end = c.T + 20;
      const civ = generateCiv(w, { interventions: [v], endYear: end });
      expect(before(civ, c.T)).toEqual(before(generateCiv(w, { endYear: end }), c.T));
      expect(ivAnnal(civ).b).toBe(-1);
      // 人物:作者的人物(名字空着,界面按人物卡填)、名臣的身份、不写卒年;掌权的那一段
      const X = authorIn(civ, c.pid)!;
      expect(X).toMatchObject({ role: 'minister', name: '', born, from: c.T, until: c.T + 5 });
      expect(X.died).toBeUndefined();
      expect(X.regencies).toEqual([expect.objectContaining({ kind: 'chancellor', from: c.T, until: c.T + 5, end: 'return' })]);
      expect(holderAt(civ, c.pid, c.T + 0.5)?.x).toBe(X);
      expect(holderAt(civ, c.pid, c.T + 5.5)).toBeNull();
      // 推演里:掌权那一刻的下一刻起照他的性格,还政以后照君主的
      const pm = polityModelOf(CivSim.fromCiv(w, civ))!;
      expect(rulingLeanings(pm, c.pid, c.T)).not.toEqual(BOLD);
      for (const t of [c.T + 1 / 256, c.T + 2.5, c.T + 5 - 1 / 256]) expect(rulingLeanings(pm, c.pid, t), `${t}`).toEqual(BOLD);
      expect(rulingLeanings(pm, c.pid, c.T + 5 + 1 / 256)).not.toEqual(BOLD);
      // 还政以后照常往下推
      expect(civ.endYear).toBe(end);
      // 编年史:先写【干预】,再写他总揽朝政;到期还政
      const lines = buildChronicle(named(civ, born)).filter((e) => e.polities.includes(c.pid));
      expect(lines.some((e) => e.year === c.T && e.text.startsWith(`【干预】令${NAME}掌`))).toBe(true);
      expect(lines.some((e) => e.year === c.T && e.kind === 'regent' && e.text.includes(NAME) && /总揽朝政|独揽朝政/.test(e.text))).toBe(true);
      expect(lines.some((e) => e.year === c.T + 5 && e.kind === 'regent' && e.text.includes(NAME) && /还政|交还/.test(e.text))).toBe(true);
    }, 180_000);

    it('从哪一刻接着推都和一口气推完一样;存档读回来推出同一个世界', () => {
      const w = world(seed);
      const base = baseOf(seed);
      const c = caseOf(base)!;
      const v = regent(base, c.pid, c.T, { born: c.T - 40, years: 4 });
      const end = c.T + 12;
      const full = generateCiv(w, { interventions: [v], endYear: end });
      for (const from of [c.T, c.T + 1, c.T + 4, c.T + 5]) {
        const head = generateCiv(w, { interventions: [v], endYear: from });
        same(continueCiv(w, head, { interventions: [v], endYear: end }), full, `从 ${from} 接着推`);
      }
      const r = parseSave(saveText(makeSave(PARAMS(seed), { ...EMPTY_EDITS, interventions: [v] }, 'x')));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.save.edits.interventions).toEqual([v]);
      same(generateCiv(w, { interventions: r.save.edits.interventions, endYear: end }), full, '存档读回');
    }, 240_000);

    it('没填还政年:到卒年卒于位(编年史写"卒",人物不写卒年);卒年也没有:到 70 岁还政', () => {
      const w = world(seed);
      const base = baseOf(seed);
      const c = caseOf(base)!;
      const born = c.T - 30;
      const civ = generateCiv(w, { interventions: [regent(base, c.pid, c.T, { born, died: c.T + 4 })], endYear: c.T + 10 });
      expect(ivAnnal(civ).b).toBe(-1);
      const X = authorIn(civ, c.pid)!;
      expect(X.regencies?.[0]).toMatchObject({ until: c.T + 4, end: 'died' });
      expect(X.died).toBeUndefined();
      expect(buildChronicle(named(civ, born)).some((e) => e.year === c.T + 4 && e.kind === 'regent' && e.text.includes(NAME) && /卒|去世/.test(e.text))).toBe(true);
      // 给了还政年、卒年更早:到卒年为止
      const early = generateCiv(w, { interventions: [regent(base, c.pid, c.T, { born, died: c.T + 3, years: 8 })], endYear: c.T + 10 });
      expect(authorIn(early, c.pid)?.regencies?.[0]).toMatchObject({ until: c.T + 3, end: 'died' });
      // 66 岁掌权、没写卒年:4 年后(70 岁)还政
      const old = generateCiv(w, { interventions: [regent(base, c.pid, c.T, { born: c.T - 66 })], endYear: c.T + 10 });
      expect(authorIn(old, c.pid)?.regencies?.[0]).toMatchObject({ until: c.T + 4, end: 'return' });
    }, 180_000);

    it('以将领的身份掌权:眼下也按名臣的身份挂人(推演里记成大将专权)', () => {
      const w = world(seed);
      const base = baseOf(seed);
      const c = caseOf(base)!;
      const civ = generateCiv(w, { interventions: [regent(base, c.pid, c.T, { born: c.T - 35, years: 3, how: 'general' })], endYear: c.T + 6 });
      expect(ivAnnal(civ).b).toBe(-1);
      expect(civ.annals.find((e) => e.kind === 'regent' && e.year === c.T)?.b).toBe(5);
      const X = authorIn(civ, c.pid)!;
      expect(X.role).toBe('minister');
      expect(X.regencies?.[0]).toMatchObject({ kind: 'chancellor', until: c.T + 3, end: 'return' });
    }, 120_000);

    it('不能生效的写原因,历史和不下一样:他还没出生、已去世、不满 16 岁;国已亡;作者立的君主在位;已有人掌权;共和国', () => {
      const w = world(seed);
      const base = baseOf(seed);
      const c = caseOf(base)!;
      const end = c.T + 6;
      const plain = generateCiv(w, { endYear: end });
      const tryIt = (list: Intervention[], i: number, b: number, why: RegExp, endYear = end, ref = plain) => {
        const civ = generateCiv(w, { interventions: list, endYear });
        expect(ivAnnal(civ, i).b, String(why)).toBe(b);
        expect(civ.people?.some((x) => x.author === CHAR)).toBe(false);
        if (list.length === 1) expect(civ.annals.filter((e) => e.kind !== 'intervene')).toEqual(ref.annals);
        const text = buildChronicle(named(civ, 0)).find((e) => e.kind === 'intervene' && e.year === list[i].from && e.text.includes(NAME))?.text ?? '';
        expect(text, String(why)).toMatch(/^【干预】欲令林小满掌.+国政/);
        expect(text, String(why)).toMatch(why);
      };
      tryIt([regent(base, c.pid, c.T, { born: c.T + 1, years: 3 })], 0, -2, /尚未出生/);
      tryIt([regent(base, c.pid, c.T, { born: c.T - 50, died: c.T, years: 3 })], 0, IV_GONE, /已卒/);
      tryIt([regent(base, c.pid, c.T, { born: c.T - 10, years: 3 })], 0, IV_NOT_HIM, /尚幼/);
      // 作者立的君主在位:前一年立作者的人物 2 号为君
      const crown = cleanIntervention({ kind: 'crown', a: polityKey(base, c.pid), char: 2, from: c.T, born: c.T - 30, leanings: BOLD })!;
      tryIt([crown, regent(base, c.pid, c.T + 1, { born: c.T - 35, years: 3 })], 1, IV_NO_THRONE, /无君可架空/);
      // 那一年已亡的国家
      const gone = base.polities.find((p) => p.ended !== undefined && p.ended < c.T);
      if (gone) tryIt([regent(base, gone.id, c.T, { born: c.T - 35, years: 3 })], 0, -3, /已亡/);
      // 已有人掌着权:推演里自己出的一段掌权当中
      const held = (base.people ?? []).flatMap((x) => (x.regencies ?? []).map((g) => ({ x, g }))).find(({ g }) => g.from >= 700 && g.until !== undefined && g.until - g.from >= 3);
      if (held) {
        const T = Math.floor(held.g.from) + 1;
        if (T < held.g.until!) tryIt([regent(base, held.x.polity, T, { born: T - 35, years: 3 })], 0, IV_HELD, /已有人秉政/, T + 4, generateCiv(w, { endYear: T + 4 }));
      }
      // 共和国
      const rep = base.polities.find((p) => p.lineage === 'republic' && p.founded < c.T - 5 && (p.ended ?? Infinity) > c.T + 6);
      if (rep) tryIt([regent(base, rep.id, c.T, { born: c.T - 35, years: 3 })], 0, IV_NO_THRONE, /无君可架空/);
    }, 300_000);
  });
}

describe('清理', () => {
  const a = 'polity:c1#0';
  const L = { expand: 60, war: 85, develop: 40, trade: 30 };
  it('作者的人物:编号、生年要对,只能以名臣 / 将领的身份专权、只能还政;卒年早于生年的去掉;还政年数夹到 1–40;倾向补齐', () => {
    const ok = { kind: 'regent', a, char: 3, born: 1200, died: 1260, from: 1230, how: 'chancellor', end: 'return', years: 5, leanings: L };
    expect(cleanIntervention(ok)).toBe(ok);
    expect(cleanIntervention({ ...ok, how: 'general' })).toEqual({ ...ok, how: 'general' });
    for (const bad of [{ how: 'march' }, { how: 'uncle' }, { end: 'usurp' }, { end: 'succeed' }, { char: 0 }, { char: 1.5 }, { born: undefined }, { years: 'x' }])
      expect(cleanIntervention({ ...ok, ...bad }), JSON.stringify(bad)).toBeNull();
    expect(cleanIntervention({ ...ok, died: 1190 })).toEqual({ kind: 'regent', a, char: 3, born: 1200, from: 1230, how: 'chancellor', end: 'return', years: 5, leanings: L });
    expect(cleanIntervention({ ...ok, years: 99 })).toMatchObject({ years: 40 });
    const bare = cleanIntervention({ kind: 'regent', a, char: 3, born: 1200, from: 1230, how: 'chancellor' });
    expect(bare).toEqual({ kind: 'regent', a, char: 3, born: 1200, from: 1230, how: 'chancellor', end: 'return', leanings: { expand: 50, war: 50, develop: 50, trade: 50 } });
    // 带了人物键的照推演人物认(旧存档都是这样),char 不要
    const person = `person:${a}|minister|某某|1200`;
    expect(cleanIntervention({ kind: 'regent', a, person, char: 3, born: 1200, from: 1230, how: 'chancellor', end: 'return', years: 5, leanings: L })).toEqual({ kind: 'regent', a, person, from: 1230, how: 'chancellor', end: 'return', years: 5, leanings: L });
  });
});

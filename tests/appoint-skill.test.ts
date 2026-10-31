/**
 * 任将带能力(干预 appoint 的 skill:良将 / 名将):他挂帅的那几仗本方兵力 × APPOINT_SKILL_POWER ——
 * 寻常 = 和不带一样(不改历史);良将 / 名将只从他上任那一刻起变,之前一字不变;
 * "他领哪几仗"推演里打仗那一刻问的(authorLeadsNow)和事后排人物的(authorPostsFrom)是同一份;
 * 从哪一刻接着推都和一口气推完一样;存档读回来一样。没下这条干预的世界不受影响由 determinism.test.ts 的指纹管着
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import type { Annal, Person } from '../src/gen/civ/types';
import { authorLeadsNow, authorPostsFrom, skillPower, type AppointInput } from '../src/gen/civ/appoint';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { APPOINT_SKILL_POWER, EMPTY_EDITS, cleanIntervention, polityKey, type AppointSkill, type Intervention } from '../src/gen/edits';

const SEED = 7;
const PARAMS = { ...DEFAULT_PARAMS, cells: 12000, seed: SEED };
let W: World | null = null;
const world = () => (W ??= generateWorld(PARAMS));
const END = 2200;
let PLAIN: Civ | null = null;
const plainCiv = () => (PLAIN ??= generateCiv(world(), { endYear: END }));

const CHAR = 1;
/** 任作者的人物为 pid 的将领(skill 不给 = 寻常) */
const general = (civ: Civ, pid: number, T: number, o: { born: number; until?: number; skill?: AppointSkill }): Intervention =>
  cleanIntervention({ kind: 'appoint', a: polityKey(civ, pid), char: CHAR, role: 'general', born: o.born, from: T, ...(o.until !== undefined ? { until: o.until } : {}), ...(o.skill ? { skill: o.skill } : {}) })!;
/** 下了令的历史:除了干预那几条史事 */
const history = (civ: Civ) => civ.annals.filter((e) => e.kind !== 'intervene');
const authorOf = (civ: Civ): Person | undefined => (civ.people ?? []).find((x) => x.author === CHAR);

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

/** 几场仗:pid 在 T 年以后一年里开打(攻守都算),开战时推演派的统帅是将领;T 那年这国已立了几年、往后还在至少 n 年 */
function warCases(civ: Civ, n = 20, max = 8): { pid: number; T: number; war: number }[] {
  const leadAt = new Map<string, Person>();
  for (const x of civ.people ?? []) for (const c of x.commands ?? []) if (!c.rear) leadAt.set(`${c.war}:${c.side}:${c.first}`, x);
  const out: { pid: number; T: number; war: number }[] = [];
  civ.annals.forEach((e, i) => {
    if (out.length >= max || e.kind !== 'war' || e.war < 0 || e.year < 800 || e.year > END - 200) return;
    for (const side of [0, 1] as const) {
      const pid = side === 0 ? e.a : e.b;
      const P = civ.polities[pid];
      const T = Math.floor(e.year) - 1;
      if (!P || P.founded > T - 5 || (P.ended ?? Infinity) < T + n || e.year - T < 0.5) continue;
      if (leadAt.get(`${e.war}:${side}:${i}`)?.role !== 'general' || out.some((c) => c.pid === pid && c.T === T)) continue;
      out.push({ pid, T, war: e.war });
    }
  });
  return out;
}

/**
 * 推演里打仗那一刻问的和事后排的同一份:任期里他那国每一条 battle / conquer(第 j 条),
 * 拿记到它前面的史事问 authorLeadsNow,他领着这场 ⇔ 事后排的挂帅那几段里有一段盖住 j(哪一方也一样)。
 * holds = 掌权那几段(事后的;问的时候按那一刻截:此刻还掌着的不给了结)。返回盖住的条数
 */
function checkLeads(civ: Civ, holds?: { char: number; polity: number; start: number; stop?: number }[]): number {
  const [post] = authorPostsFrom({ annals: civ.annals, polities: civ.polities, endYear: civ.endYear, interventions: civ.interventions, holds });
  let n = 0;
  for (let j = post.annal + 1; j < civ.annals.length; j++) {
    const e: Annal = civ.annals[j];
    if ((e.kind !== 'battle' && e.kind !== 'conquer') || e.war < 0 || (e.a !== post.polity && e.b !== post.polity)) continue;
    if (post.until !== undefined && e.year >= post.until + 1) break;
    const seg = post.wars.find((s) => s.war === e.war && s.start <= j && j < s.stop);
    const cut = holds?.map((h) => (h.stop !== undefined && h.stop <= e.year ? h : { char: h.char, polity: h.polity, start: h.start }));
    const input: AppointInput = { annals: civ.annals.slice(0, j), polities: civ.polities, endYear: e.year, interventions: civ.interventions, holds: cut };
    const lead = authorLeadsNow(input, e.year).find((l) => l.polity === post.polity && l.war === e.war);
    expect(!!lead, `第 ${j} 条(${e.year})`).toBe(!!seg);
    if (seg && lead) expect(lead.side).toBe(seg.side);
    if (seg) n++;
  }
  return n;
}

describe(`任将带能力 · seed=${SEED}`, () => {
  it('寻常 = 不改历史;良将 / 名将:上任以前一字不变,之后他挂帅的仗胜负可能变;他领哪几仗推演里和事后同一份', () => {
    const plain = plainCiv();
    const cases = warCases(plain);
    expect(cases.length).toBeGreaterThan(3);
    let changed = 0;
    let checked = 0;
    for (const c of cases) {
      const born = c.T - 30;
      const until = c.T + 20;
      const normal = generateCiv(world(), { interventions: [general(plain, c.pid, c.T, { born, until })], endYear: END });
      expect(history(normal)).toEqual(plain.annals);
      for (const skill of ['good', 'great'] as const) {
        const civ = generateCiv(world(), { interventions: [general(plain, c.pid, c.T, { born, until, skill })], endYear: END });
        const H = history(civ);
        // 上任以前一字不变
        expect(H.filter((e) => e.year < c.T)).toEqual(plain.annals.filter((e) => e.year < c.T));
        let k = 0;
        while (k < H.length && k < plain.annals.length && JSON.stringify(H[k]) === JSON.stringify(plain.annals[k])) k++;
        const post = authorPostsFrom(civ)[0];
        if (k < Math.max(H.length, plain.annals.length)) {
          changed++;
          // 变是从他挂帅的头一仗起
          expect(post.wars.length).toBeGreaterThan(0);
          expect(H[k].year).toBeGreaterThanOrEqual(post.wars[0].from);
        }
        checked += checkLeads(civ);
        // 他还是挂帅、照旧有人物
        expect(authorOf(civ)).toMatchObject({ role: 'general', polity: c.pid, from: c.T });
      }
    }
    expect(changed).toBeGreaterThan(0);
    expect(checked).toBeGreaterThan(10);
  }, 300_000);

  it('让他掌权、掌权比任期长:在任到掌权了结,这几年他领的仗推演里也照样加', () => {
    const plain = plainCiv();
    const L = { expand: 50, war: 50, develop: 50, trade: 50 };
    // 任到 T + 4、T + 2 起掌权 10 年(到 T + 12):这国的仗在 T + 4 以后才开打,他领的几仗全在掌权延长的那几年里。
    // 推演里得和"直接任到 T + 12"一样;名将和寻常推出来不同的(那几年里有仗打得不一样),才说明这几年确实加了
    let done = 0;
    let felt = 0;
    for (const c of warCases(plain, 20, 40)) {
      if (done >= 12 || (felt && done >= 2)) break;
      const P = plain.polities[c.pid];
      const T = c.T - 4;
      if (P.lineage === 'republic' || P.founded > T - 5) continue;
      if ((plain.people ?? []).some((x) => x.polity === c.pid && x.regencies?.some((g) => g.from < T + 16 && (g.until ?? Infinity) > T - 2))) continue;
      const regent = cleanIntervention({ kind: 'regent', a: polityKey(plain, c.pid), char: CHAR, born: T - 40, from: T + 2, how: 'general', end: 'return', years: 10, leanings: L })!;
      const run = (until: number, skill?: AppointSkill) => generateCiv(world(), { interventions: [general(plain, c.pid, T, { born: T - 40, until, skill }), regent], endYear: T + 16 });
      const civ = run(T + 4, 'great');
      const X = authorOf(civ);
      if (civ.annals.find((e) => e.kind === 'intervene' && e.war === 1)?.b !== -1 || !X) continue;
      done++;
      expect(history(civ).filter((e) => e.year < T)).toEqual(plain.annals.filter((e) => e.year < T));
      expect(X).toMatchObject({ role: 'general', from: T, until: T + 12 });
      const holds = (X.regencies ?? []).map((g) => ({ char: CHAR, polity: c.pid, start: g.from, ...(g.until !== undefined ? { stop: g.until } : {}) }));
      expect(holds.length).toBe(1);
      checkLeads(civ, holds);
      const direct = run(T + 12, 'great');
      expect(civ.annals).toEqual(direct.annals);
      if (JSON.stringify(run(T + 12).annals) !== JSON.stringify(direct.annals)) felt++;
    }
    expect(done).toBeGreaterThan(1);
    expect(felt).toBeGreaterThan(0);
  }, 300_000);

  it('从哪一刻接着推都和一口气推完一样;存档读回来推出同一个世界(旧存档没有能力 = 寻常)', () => {
    const plain = plainCiv();
    // 挑一场名将改了历史的
    const c = warCases(plain).find((x) => {
      const civ = generateCiv(world(), { interventions: [general(plain, x.pid, x.T, { born: x.T - 30, until: x.T + 20, skill: 'great' })], endYear: x.T + 20 });
      return JSON.stringify(history(civ)) !== JSON.stringify(plain.annals.filter((e) => e.year < x.T + 20));
    })!;
    expect(c).toBeDefined();
    const list = [general(plain, c.pid, c.T, { born: c.T - 30, until: c.T + 20, skill: 'great' })];
    const end = c.T + 24;
    const full = generateCiv(world(), { interventions: list, endYear: end });
    for (const from of [c.T, c.T + 1, c.T + 3, c.T + 7, c.T + 20]) {
      const head = generateCiv(world(), { interventions: list, endYear: from });
      same(continueCiv(world(), head, { interventions: list, endYear: end }), full, `从 ${from} 接着推`);
    }
    const r = parseSave(saveText(makeSave(PARAMS, { ...EMPTY_EDITS, interventions: list }, 'x')));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.save.edits.interventions).toEqual(list);
    same(generateCiv(world(), { interventions: r.save.edits.interventions, endYear: end }), full, '存档读回');
    // 去掉能力的存档(旧存档)= 寻常 = 和没任能力一样不改历史
    const { skill: _drop, ...old } = list[0] as Extract<Intervention, { kind: 'appoint' }>;
    const r2 = parseSave(saveText(makeSave(PARAMS, { ...EMPTY_EDITS, interventions: [old] }, 'x')));
    expect(r2.ok && r2.save.edits.interventions[0]).toEqual(old);
    expect(history(generateCiv(world(), { interventions: [old], endYear: end }))).toEqual(generateCiv(world(), { endYear: end }).annals);
  }, 300_000);
});

describe('能力', () => {
  const a = 'polity:c1#0';
  it('清理:只留将领带的 good / great;名臣、别的值去掉(= 寻常)', () => {
    const ok = { kind: 'appoint', a, char: 3, role: 'general', born: 1200, from: 1230, skill: 'great' };
    expect(cleanIntervention(ok)).toEqual(ok);
    expect(cleanIntervention({ ...ok, skill: 'good' })).toEqual({ ...ok, skill: 'good' });
    const { skill: _s, ...plain } = ok;
    for (const bad of ['normal', 'best', 1, null]) expect(cleanIntervention({ ...ok, skill: bad }), String(bad)).toEqual(plain);
    expect(cleanIntervention({ ...ok, role: 'minister' })).toEqual({ ...plain, role: 'minister' });
  });
  it('倍数:他那国、那场、那一方才乘;同一场几位作者将领取最大的', () => {
    const list = [
      { kind: 'appoint', a, char: 1, role: 'general', born: 0, from: 0, skill: 'good' },
      { kind: 'appoint', a, char: 2, role: 'general', born: 0, from: 0, skill: 'great' },
      { kind: 'appoint', a, char: 3, role: 'general', born: 0, from: 0 },
    ] as Intervention[];
    const lead = (iv: number, war = 5, side: 0 | 1 = 0) => ({ iv, char: iv + 1, polity: 4, war, side });
    expect(skillPower(list, [lead(0)], 4, 5, 0)).toBe(APPOINT_SKILL_POWER.good);
    expect(skillPower(list, [lead(0), lead(1)], 4, 5, 0)).toBe(APPOINT_SKILL_POWER.great);
    expect(skillPower(list, [lead(2)], 4, 5, 0)).toBe(1);
    expect(skillPower(list, [lead(0)], 3, 5, 0)).toBe(1);
    expect(skillPower(list, [lead(0)], 4, 6, 0)).toBe(1);
    expect(skillPower(list, [lead(0, 5, 1)], 4, 5, 0)).toBe(1);
  });
});

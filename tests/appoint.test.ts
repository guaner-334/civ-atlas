/**
 * 任将 / 任臣(干预 appoint;宣战 declare 带 lead = 谁挂帅):只改人物和编年史,不改历史 ——
 * 下了令的世界历史一字不变、推演里的人一个不变,只是多了他:将领挂帅(推演原来派的那位写成副将),名臣经手朝中的事;
 * 任期、卸任(卸任年、卒年、卸甲致仕的岁数、亡国出降出奔、改朝换代名臣去职、又任了别的、即了位)按 appoint.ts;
 * 让作者的人物掌权时他正任职的,掌权挂在任职的那一位上;从哪一刻接着推都和一口气推完一样;存档读回来推出同一个世界;
 * 不能生效的写原因。没下这条干预的世界不受影响由 determinism.test.ts 的指纹管着
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ } from '../src/gen/civ';
import type { Annal, Person, Polity } from '../src/gen/civ/types';
import { buildChronicle, interventionOutcome, type ChronicleEntry } from '../src/gen/civ/chronicle';
import { IV_REIGNING, authorPostsFrom, type AuthorPost } from '../src/gen/civ/appoint';
import { IV_NOT_HIM } from '../src/gen/civ/rulers';
import { IV_GONE } from '../src/gen/civ/regents';
import { applyCharacters } from '../src/gen/characters';
import { makeSave, parseSave, saveText } from '../src/gen/savefile';
import { AUTHOR_GENERAL_AGE_END, AUTHOR_MINISTER_AGE_END, EMPTY_EDITS, cleanIntervention, polityKey, type Intervention } from '../src/gen/edits';

const PARAMS = (seed: number) => ({ ...DEFAULT_PARAMS, cells: 12000, seed });
const worlds = new Map<number, World>();
function world(seed: number): World {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = generateWorld(PARAMS(seed))));
  return w;
}
const bases = new Map<string, Civ>();
function plainOf(seed: number, endYear: number): Civ {
  const k = `${seed}:${endYear}`;
  let c = bases.get(k);
  if (!c) bases.set(k, (c = generateCiv(world(seed), { endYear })));
  return c;
}

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

const CHAR = 1;
const NAME = '林小满';
/** 任作者的人物(编号 char)为 pid 的将领 / 名臣 */
const appoint = (civ: Civ, pid: number, T: number, o: { role: 'general' | 'minister'; born: number; died?: number; until?: number; char?: number }): Intervention =>
  cleanIntervention({ kind: 'appoint', a: polityKey(civ, pid), char: o.char ?? CHAR, role: o.role, born: o.born, ...(o.died !== undefined ? { died: o.died } : {}), from: T, ...(o.until !== undefined ? { until: o.until } : {}) })!;
/** 套上人物卡的名字 */
const named = (civ: Civ) =>
  applyCharacters(civ, [
    { id: CHAR, name: NAME, color: 'red', born: 0 },
    { id: 2, name: '顾长安', color: 'red', born: 0 },
  ]);
/** 第 i 条干预那一条史事 */
const ivAnnal = (civ: Civ, i = 0) => civ.annals.find((e) => e.kind === 'intervene' && e.war === i)!;
const authorsOf = (civ: Civ, char = CHAR) => (civ.people ?? []).filter((x) => x.author === char);
/** 编年史摊平(连同子条目) */
const flat = (es: ChronicleEntry[]): ChronicleEntry[] => es.flatMap((e) => [e, ...flat(e.children ?? [])]);
/** 推演里的人(不算作者的人物)逐个比:身份、名字、生卒、任期、领兵、官职、掌权、经手的事(编号、史事下标会因多出的那条史事挪位,不比) */
const sig = (x: Person) =>
  JSON.stringify({
    r: x.role,
    p: x.polity,
    n: x.name,
    b: x.born,
    d: x.died,
    f: x.fate,
    fr: x.from,
    u: x.until,
    t: x.title,
    fe: x.female,
    c: x.commands?.map((m) => [m.war, m.side, m.from, m.until, m.rear]),
    po: x.posts,
    g: x.regencies?.map((g) => [g.kind, g.from, g.until, g.end]),
    de: x.deeds?.map((d) => [d.kind, d.year]),
  });
const simPeople = (civ: Civ, noPosts = false) => (civ.people ?? []).filter((x) => x.author === undefined).map((x) => sig(noPosts ? { ...x, posts: undefined } : x));
/**
 * 作者的名臣 X 升到最高的官时,那一刻正做着的推演名臣:人物卡上从那一刻起写次一级,X 去职后复为原官;别的推演人物官职一个不变
 */
function checkDisplaced(civ: Civ, plain: Civ, X: Person) {
  const top = X.posts![X.posts!.length - 1];
  const sims = (c: Civ) => (c.people ?? []).filter((x) => x.author === undefined);
  const a = sims(civ);
  const b = sims(plain);
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i].posts) === JSON.stringify(b[i].posts)) continue;
    expect(a[i].role).toBe('minister');
    expect(a[i].polity).toBe(X.polity);
    const held = b[i].posts!.find((p, k, ps) => p.title === top.title && p.from <= top.from && (ps[k + 1]?.from ?? Infinity) > top.from);
    expect(held, a[i].name).toBeDefined();
    expect(a[i].posts!.some((p) => p.from === top.from && p.title !== top.title)).toBe(true);
  }
}
/** 下了令的历史:除了干预那几条史事,和不下一样 */
const history = (civ: Civ) => civ.annals.filter((e) => e.kind !== 'intervene');

/**
 * 一场仗:pid 在 T 年以后几年里开打(攻守都算),开战时推演派的统帅是将领(不是亲征的君主);T 那一年这国已立了几年、往后还在至少 n 年
 */
function warCase(civ: Civ, n = 20): { pid: number; T: number; war: number; side: 0 | 1 } | null {
  const leadAt = new Map<string, Person>();
  for (const x of civ.people ?? []) for (const c of x.commands ?? []) if (!c.rear) leadAt.set(`${c.war}:${c.side}:${c.first}`, x);
  for (const e of civ.annals) {
    if (e.kind !== 'war' || e.war < 0 || e.year < 800) continue;
    const i = civ.annals.indexOf(e);
    for (const side of [0, 1] as const) {
      const pid = side === 0 ? e.a : e.b;
      const P = civ.polities[pid];
      const T = Math.floor(e.year) - 1;
      if (!P || P.founded > T - 5 || (P.ended ?? Infinity) < T + n || e.year - T < 0.5) continue;
      const x = leadAt.get(`${e.war}:${side}:${i}`);
      if (x?.role !== 'general') continue;
      // 这一场开打时这国没在打别的仗(他手上空着,这一场一开打就挂帅)
      const busy = civ.annals.some((w, k) => k < i && w.kind === 'war' && w.war >= 0 && (w.a === pid || w.b === pid) && !civ.annals.some((q, j) => j < i && q.kind === 'peace' && q.war === w.war));
      if (busy) continue;
      return { pid, T, war: e.war, side };
    }
  }
  return null;
}

for (const seed of [7, 2024]) {
  describe(`任将任臣 · seed=${seed}`, () => {
    it('任将:历史一字不变、推演里的人一个不变;他挂帅那场仗(推演派的那位写成副将);到卸任年卸任;编年史写他', () => {
      const w = world(seed);
      const end = 2200;
      const plain = plainOf(seed, end);
      const c = warCase(plain)!;
      expect(c).not.toBeNull();
      const born = c.T - 30;
      const v = appoint(plain, c.pid, c.T, { role: 'general', born, until: c.T + 15 });
      const civ = generateCiv(w, { interventions: [v], endYear: end });
      expect(ivAnnal(civ).b).toBe(-1);
      expect(history(civ)).toEqual(plain.annals);
      expect(simPeople(civ)).toEqual(simPeople(plain));
      const [X] = authorsOf(civ);
      expect(X).toMatchObject({ role: 'general', polity: c.pid, name: '', born, from: c.T, until: c.T + 15, fate: 'retired' });
      expect(X.died).toBeUndefined();
      expect(X.posts?.[0]).toMatchObject({ from: c.T });
      // 他挂帅那场仗:从开打起;推演原来派的那位照旧领着
      const cmd = X.commands?.find((m) => m.war === c.war)!;
      expect(cmd).toMatchObject({ side: c.side });
      const decl = civ.annals.findIndex((e) => e.kind === 'war' && e.war === c.war);
      expect(cmd.first).toBe(decl);
      const own = (civ.people ?? []).find((x) => x.author === undefined && x.commands?.some((m) => m.war === c.war && m.side === c.side && m.first === decl))!;
      expect(own.role).toBe('general');
      // 任期以内挂帅、以外不挂
      for (const m of X.commands!) {
        expect(m.from).toBeGreaterThanOrEqual(c.T);
        expect(m.until).toBeLessThanOrEqual(c.T + 15);
      }
      // 编年史:【干预】以他为某国将;开战那一条他为将、原来那位为副;后面的仗统帅写他
      const lines = flat(buildChronicle(named(civ)));
      expect(lines.some((e) => e.kind === 'intervene' && e.year === c.T && new RegExp(`以${NAME}为.+将$`).test(e.text))).toBe(true);
      const head = lines.find((e) => e.kind === 'war' && e.year === civ.annals[decl].year && e.text.includes(`以${NAME}为将`));
      expect(head?.text).toContain(`${own.name}为副`);
      expect(head?.people).toContain(X.id);
      expect(head?.people).toContain(own.id);
    }, 240_000);

    it('任臣:朝中的事他也经手(推演里的名臣照旧);议和写上他;到卒年为止;改朝换代去职', () => {
      const w = world(seed);
      const end = 2200;
      const plain = plainOf(seed, end);
      // 一国 T 年起 30 年里有议和、没改朝换代
      const pick = (() => {
        for (const e of plain.annals) {
          if (e.kind !== 'peace' || e.year < 900 || e.year > end - 40) continue;
          for (const pid of [e.a, e.b]) {
            const P = plain.polities[pid];
            const T = Math.floor(e.year) - 3;
            if (!P || P.founded > T || (P.ended ?? Infinity) < T + 30 || P.lineage === 'republic') continue;
            if ((P.dynasties ?? []).some((d) => d.year > T && d.year < T + 30)) continue;
            const ms = (plain.people ?? []).filter((x) => x.role === 'minister' && x.polity === pid && x.deeds?.some((d) => d.kind === 'peace' && Math.abs(d.year - e.year) < 1e-9));
            if (ms.length) return { pid, T, peace: e.year, envoy: ms[0] };
          }
        }
        return null;
      })()!;
      expect(pick).not.toBeNull();
      const born = pick.T - 40;
      const v = appoint(plain, pick.pid, pick.T, { role: 'minister', born, died: pick.T + 25 });
      const civ = generateCiv(w, { interventions: [v], endYear: end });
      expect(history(civ)).toEqual(plain.annals);
      const [X] = authorsOf(civ);
      // 推演里的人一个不变;只有他升到最高的官那一刻正做着的那位,人物卡上这几年写次一级(他去职后复为原官)
      expect(simPeople(civ, true)).toEqual(simPeople(plain, true));
      checkDisplaced(civ, plain, X);
      expect(X).toMatchObject({ role: 'minister', polity: pick.pid, name: '', born, from: pick.T, until: pick.T + 25, fate: 'died' });
      expect(X.died).toBeUndefined();
      expect(X.posts?.length).toBeGreaterThan(0);
      expect(X.deeds?.some((d) => d.kind === 'peace' && Math.abs(d.year - pick.peace) < 1e-9)).toBe(true);
      for (const d of X.deeds ?? []) {
        expect(d.year).toBeGreaterThanOrEqual(pick.T);
        expect(d.year).toBeLessThan(pick.T + 25);
        expect(['rank', 'enthrone', 'capital', 'relief', 'peace', 'war', 'defend']).toContain(d.kind);
      }
      const lines = flat(buildChronicle(named(civ)));
      expect(lines.some((e) => e.kind === 'intervene' && e.text.includes(`以${NAME}为`))).toBe(true);
      // 议和:他写在推演里经手的那位后面
      const peace = lines.find((e) => e.year === pick.peace && e.text.includes('议和') && e.text.includes(NAME));
      expect(peace?.text).toContain(pick.envoy.name);
      expect(peace!.text.indexOf(NAME)).toBeGreaterThan(peace!.text.indexOf(pick.envoy.name));
      // 官:入朝比最高的低两级,经手一件升一级(经手完的下一刻)
      expect(X.posts!.length).toBeLessThanOrEqual(1 + (X.deeds?.length ?? 0));
      (X.deeds ?? []).slice(0, X.posts!.length - 1).forEach((d, k) => expect(X.posts![k + 1].from).toBeCloseTo(d.year + 1 / 256, 6));
      // 改朝换代:名臣去职
      const dyn = plain.polities.find((p) => p.founded < 900 && (p.dynasties ?? []).some((d) => d.year > 1000 && d.year < end - 20) && (p.ended ?? Infinity) > end - 10);
      if (dyn) {
        const D = dyn.dynasties!.find((d) => d.year > 1000)!.year;
        const T = Math.floor(D) - 3;
        const m = generateCiv(w, { interventions: [appoint(plain, dyn.id, T, { role: 'minister', born: T - 30 })], endYear: end });
        expect(authorsOf(m)[0]).toMatchObject({ until: D, fate: 'deposed' });
        const g = generateCiv(w, { interventions: [appoint(plain, dyn.id, T, { role: 'general', born: T - 30, until: T + 10 })], endYear: end });
        expect(authorsOf(g)[0]).toMatchObject({ until: T + 10, fate: 'retired' });
      }
    }, 300_000);

    it('派他出征:任将同时宣战(点他挂帅),那场仗由他挂帅;编年史【干预】写"以他为帅"', () => {
      const w = world(seed);
      const end = 2200;
      const plain = plainOf(seed, end);
      // 打过仗、T 那年都还在、没在交战的两国(还得接壤:试几对,宣战打得起来的那一对)
      const tried = new Set<string>();
      let done = false;
      for (const e of plain.annals) {
        if (done || e.kind !== 'peace' || e.year < 1000 || e.year > 1800) continue;
        const T = Math.floor(e.year) + 2;
        const key = `${e.a}:${e.b}`;
        const A = plain.polities[e.a];
        const B = plain.polities[e.b];
        if (tried.has(key) || !A || !B || (A.ended ?? Infinity) < T + 20 || (B.ended ?? Infinity) < T + 20) continue;
        tried.add(key);
        if (tried.size > 6) break;
        const list = [appoint(plain, e.a, T, { role: 'general', born: T - 30 }), cleanIntervention({ kind: 'declare', a: polityKey(plain, e.a), b: polityKey(plain, e.b), from: T, lead: CHAR })!];
        const civ = generateCiv(w, { interventions: list, endYear: T + 20 });
        const k = civ.annals.findIndex((x) => x.kind === 'intervene' && x.war === 1);
        const war = civ.annals.slice(k + 1).find((x) => x.year === T && x.kind === 'war' && x.a === e.a && x.b === e.b);
        if (!war) continue;
        done = true;
        expect(history(civ).filter((x) => x.year < T)).toEqual(plain.annals.filter((x) => x.year < T));
        const [X] = authorsOf(civ);
        expect(X.commands?.find((m) => m.war === war.war)).toMatchObject({ side: 0, from: T });
        expect(authorPostsFrom(civ)[0].wars.find((m) => m.war === war.war)).toMatchObject({ sent: true });
        const line = flat(buildChronicle(named(civ))).find((x) => x.kind === 'intervene' && x.text.includes('宣战'))!;
        expect(line.text).toMatch(new RegExp(`宣战,(以${NAME}为帅|${NAME}随驾)$`));
        // 宣战点了他、他却不是这国的将领(没任将):仗照打,统帅照推演派
        const bare = generateCiv(w, { interventions: [list[1]], endYear: T + 20 });
        expect(authorsOf(bare)).toEqual([]);
        expect(flat(buildChronicle(named(bare))).find((x) => x.kind === 'intervene')!.text).toContain(`欲以${NAME}为帅`);
      }
      expect(done).toBe(true);
    }, 300_000);

    it('从哪一刻接着推都和一口气推完一样;存档读回来推出同一个世界', () => {
      const w = world(seed);
      const plain = plainOf(seed, 2200);
      const c = warCase(plain)!;
      const list = [appoint(plain, c.pid, c.T, { role: 'general', born: c.T - 30, until: c.T + 8 }), appoint(plain, c.pid, c.T + 8, { role: 'minister', born: c.T - 30 })];
      const end = c.T + 14;
      const full = generateCiv(w, { interventions: list, endYear: end });
      expect(authorsOf(full).map((x) => x.role)).toEqual(['general', 'minister']);
      for (const from of [c.T, c.T + 1, c.T + 5, c.T + 8, c.T + 9]) {
        const head = generateCiv(w, { interventions: list, endYear: from });
        same(continueCiv(w, head, { interventions: list, endYear: end }), full, `从 ${from} 接着推`);
      }
      const r = parseSave(saveText(makeSave(PARAMS(seed), { ...EMPTY_EDITS, interventions: list }, 'x')));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.save.edits.interventions).toEqual(list);
      same(generateCiv(w, { interventions: r.save.edits.interventions, endYear: end }), full, '存档读回');
    }, 300_000);

    it('让作者的人物掌权时他正任着这国的将领 / 名臣:掌权挂在任职的那一位上(将领 = 大将专权),不另起一位', () => {
      const w = world(seed);
      const plain = plainOf(seed, 2200);
      // 一位寻常君主在位、往后十几年没人掌权
      const R = (plain.people ?? []).find(
        (x) => x.role === 'ruler' && (x.from ?? 0) > 900 && x.until !== undefined && x.until - x.from! > 16 && plain.polities[x.polity].lineage !== 'republic' && !(plain.people ?? []).some((y) => y.polity === x.polity && y.regencies?.some((g) => g.from < x.until! && (g.until ?? Infinity) > x.from!)),
      )!;
      expect(R).toBeDefined();
      const T = Math.ceil(R.from!) + 1;
      const regent = (how: 'chancellor' | 'general') =>
        cleanIntervention({ kind: 'regent', a: polityKey(plain, R.polity), char: CHAR, born: T - 40, from: T + 2, how, end: 'return', years: 5, leanings: { expand: 50, war: 50, develop: 50, trade: 50 } })!;
      for (const [role, how, kind] of [
        ['minister', 'chancellor', 'chancellor'],
        ['general', 'general', 'general'],
      ] as const) {
        const civ = generateCiv(w, { interventions: [appoint(plain, R.polity, T, { role, born: T - 40, until: T + 4 }), regent(how)], endYear: T + 12 });
        expect(ivAnnal(civ, 1).b).toBe(-1);
        const xs = authorsOf(civ);
        expect(xs.length, role).toBe(1);
        // 任期到 T + 4,掌权到 T + 7:在任到掌权了结
        expect(xs[0]).toMatchObject({ role, from: T, until: T + 7, fate: 'retired' });
        expect(xs[0].regencies).toEqual([expect.objectContaining({ kind, from: T + 2, until: T + 7, end: 'return' })]);
      }
    }, 240_000);
  });
}

describe('任将任臣 · 身份先后、没生效的原因(seed=7)', () => {
  it('将 → 相:后一个到时前一个卸任(yielded);同一刻又任 = 前一个没生效;即位时卸任;在位时任将不生效', () => {
    const w = world(7);
    const plain = plainOf(7, 2200);
    const c = warCase(plain)!;
    const T = c.T;
    const born = T - 30;
    const two = generateCiv(w, { interventions: [appoint(plain, c.pid, T, { role: 'general', born }), appoint(plain, c.pid, T + 6, { role: 'minister', born })], endYear: T + 12 });
    expect(authorsOf(two).map((x) => [x.role, x.from, x.until, x.fate])).toEqual([
      ['general', T, T + 6, 'yielded'],
      ['minister', T + 6, undefined, undefined],
    ]);
    const same = generateCiv(w, { interventions: [appoint(plain, c.pid, T, { role: 'general', born }), appoint(plain, c.pid, T, { role: 'minister', born })], endYear: T + 6 });
    expect(authorsOf(same).map((x) => x.role)).toEqual(['minister']);
    expect(interventionOutcome(named(same), 0)).toMatchObject({ ok: false, why: '同一年又给他任了别的' });
    // 即位时卸任
    const L = { expand: 50, war: 50, develop: 50, trade: 50 };
    const crown = cleanIntervention({ kind: 'crown', a: polityKey(plain, c.pid), char: CHAR, from: T + 5, born, until: T + 9, leanings: L })!;
    const king = generateCiv(w, { interventions: [appoint(plain, c.pid, T, { role: 'general', born }), crown], endYear: T + 12 });
    expect(authorsOf(king).filter((x) => x.role === 'general')[0]).toMatchObject({ until: T + 5, fate: 'yielded' });
    // 在位时任将:不生效,写原因
    const crown2 = cleanIntervention({ kind: 'crown', a: polityKey(plain, c.pid), char: CHAR, from: T, born, until: T + 9, leanings: L })!;
    const busy = generateCiv(w, { interventions: [crown2, appoint(plain, c.pid, T + 2, { role: 'general', born })], endYear: T + 6 });
    expect(ivAnnal(busy, 1).b).toBe(IV_REIGNING);
    expect(authorsOf(busy).filter((x) => x.role === 'general')).toEqual([]);
    expect(interventionOutcome(named(busy), 1)).toMatchObject({ ok: false });
  }, 240_000);

  it('不能生效的写原因,历史和不下一样:还没出生、已去世、不满 16 岁、国已亡', () => {
    const w = world(7);
    const plain = plainOf(7, 2200);
    const c = warCase(plain)!;
    const end = c.T + 6;
    const ref = plainOf(7, end);
    const tryIt = (v: Intervention, b: number, why: RegExp) => {
      const civ = generateCiv(w, { interventions: [v], endYear: end });
      expect(ivAnnal(civ).b, String(why)).toBe(b);
      expect(authorsOf(civ)).toEqual([]);
      expect(history(civ)).toEqual(ref.annals);
      const text = flat(buildChronicle(named(civ))).find((e) => e.kind === 'intervene')?.text ?? '';
      expect(text, String(why)).toMatch(/^【干预】欲拜林小满为.+之将/);
      expect(text, String(why)).toMatch(why);
    };
    tryIt(appoint(plain, c.pid, c.T, { role: 'general', born: c.T + 1 }), -2, /尚未出生/);
    tryIt(appoint(plain, c.pid, c.T, { role: 'general', born: c.T - 50, died: c.T }), IV_GONE, /已卒/);
    tryIt(appoint(plain, c.pid, c.T, { role: 'general', born: c.T - 10 }), IV_NOT_HIM, /尚幼/);
    const gone = plain.polities.find((p) => p.ended !== undefined && p.ended < c.T);
    if (gone) tryIt(appoint(plain, gone.id, c.T, { role: 'general', born: c.T - 30 }), -3, /已亡/);
  }, 240_000);

  it('亡国:有灭它的国家 = 出降,散了 = 出奔,并入别国 = 随国归附;任期到亡国那一刻', () => {
    const w = world(7);
    const plain = plainOf(7, 2200);
    let n = 0;
    for (const P of plain.polities) {
      if (P.ended === undefined || P.ended < 1000 || P.ended > 2150 || P.ended - P.founded < 20 || n >= 2) continue;
      const T = Math.floor(P.ended) - 5;
      if (T <= P.founded) continue;
      n++;
      const civ = generateCiv(w, { interventions: [appoint(plain, P.id, T, { role: 'general', born: T - 30 })], endYear: Math.ceil(P.ended) + 2 });
      const [X] = authorsOf(civ);
      expect(X.until).toBe(P.ended);
      const merge = civ.annals.find((e) => e.kind === 'merge' && e.b === P.id);
      const fall = civ.annals.find((e) => e.kind === 'fall' && e.a === P.id);
      expect(X.fate).toBe(merge && (!fall || merge.year <= fall.year) ? 'merged' : fall && fall.b >= 0 ? 'surrendered' : 'fled');
    }
    expect(n).toBeGreaterThan(0);
  }, 240_000);
});

describe('挂帅哪几仗(appoint.ts,拼出来的史事)', () => {
  const P = (id: number, o: Partial<Polity> = {}) => ({ id, founded: 0, dynasties: [{ year: 0, name: '', seat: 0 }], ...o }) as unknown as Polity;
  const ev = (year: number, kind: Annal['kind'], a: number, b: number, war = -1): Annal => ({ year, kind, a, b, region: -1, settlement: -1, war });
  const ap = (o: Partial<Extract<Intervention, { kind: 'appoint' }>> = {}): Intervention => ({ kind: 'appoint', a: 'polity:c1#0', char: 1, role: 'general', born: 960, from: 1000, ...o });
  const posts = (annals: Annal[], interventions: Intervention[], polities = [P(0), P(1), P(2)], endYear = 1100): AuthorPost[] => authorPostsFrom({ annals, polities, endYear, interventions });

  it('上任时挑最先开打、还在打的那场;打完换下一场;没仗就等下一场开打;任期以外不挂', () => {
    const A = [
      ev(990, 'war', 0, 1, 0), // 0
      ev(995, 'war', 2, 0, 1), // 1
      ev(1000, 'intervene', 0, -1, 0), // 2 上任
      ev(1003, 'peace', 0, 1, 0), // 3 第一场打完:换到第二场
      ev(1006, 'peace', 2, 0, 1), // 4
      ev(1010, 'war', 0, 2, 2), // 5 闲着:这场开打就挂帅
      ev(1011, 'war', 1, 0, 3), // 6 手上有仗:不换
      ev(1015, 'peace', 0, 2, 2), // 7 → 换到第 3 场
      ev(1030, 'peace', 1, 0, 3), // 8
    ];
    const [p] = posts(A, [ap({ until: 1020 })]);
    expect(p).toMatchObject({ polity: 0, from: 1000, until: 1020, end: 'retired' });
    expect(p.wars.map((w) => [w.war, w.side, w.from, w.until, w.start, w.stop])).toEqual([
      [0, 0, 1000, 1003, 2, 3],
      [1, 1, 1003, 1006, 3, 4],
      [2, 0, 1010, 1015, 5, 7],
      [3, 1, 1015, 1020, 7, 8],
    ]);
  });

  it('派他出征:宣战带 lead = 他、本国是攻方的那场一开打就换过去;上任时有这样的仗先挑它', () => {
    const declare = (b: string, lead?: number): Intervention => ({ kind: 'declare', a: 'polity:c1#0', b, from: 1005, ...(lead !== undefined ? { lead } : {}) });
    const A = [
      ev(990, 'war', 0, 1, 0), // 0
      ev(1000, 'intervene', 0, -1, 0), // 1 上任
      ev(1005, 'intervene', 0, 2, 1), // 2 宣战(点他挂帅)
      ev(1005, 'war', 0, 2, 1), // 3
      ev(1009, 'peace', 0, 2, 1), // 4 → 回到还在打的第一场
      ev(1012, 'peace', 0, 1, 0), // 5
    ];
    const [p] = posts(A, [ap({ until: 1020 }), declare('polity:c2#0', 1)]);
    expect(p.wars.map((w) => [w.war, w.from, w.until, !!w.sent])).toEqual([
      [0, 1000, 1005, false],
      [1, 1005, 1009, true],
      [0, 1009, 1012, false],
    ]);
    // 点的是别人:不换
    const [q] = posts(A, [ap({ until: 1020 }), declare('polity:c2#0', 9)]);
    expect(q.wars.map((w) => w.war)).toEqual([0]);
    // 手上的也是派他出征的:照样换到新派的那场
    const B = [
      ev(1000, 'intervene', 0, -1, 0), // 0 上任
      ev(1005, 'intervene', 0, 2, 1), // 1
      ev(1005, 'war', 0, 2, 1), // 2
      ev(1006, 'intervene', 0, 1, 2), // 3
      ev(1006, 'war', 0, 1, 2), // 4
      ev(1008, 'peace', 0, 1, 2), // 5 → 回到第一场
      ev(1010, 'peace', 0, 2, 1), // 6
    ];
    const [r] = posts(B, [ap({ until: 1020 }), declare('polity:c2#0', 1), declare('polity:c3#0', 1)]);
    expect(r.wars.map((w) => [w.war, w.from, w.until, !!w.sent])).toEqual([
      [1, 1005, 1006, true],
      [2, 1006, 1008, true],
      [1, 1008, 1010, true],
    ]);
  });

  it('任期里在这国掌了权、掌权比任期长:在任到掌权了结(挂帅也排到那时)', () => {
    const A = [ev(1000, 'intervene', 0, -1, 0), ev(1012, 'war', 0, 1, 0), ev(1018, 'peace', 0, 1, 0)];
    const hold = (o: { start?: number; stop?: number; died?: boolean; polity?: number } = {}) => [{ char: 1, polity: o.polity ?? 0, start: o.start ?? 1005, ...(o.stop !== undefined ? { stop: o.stop } : {}), died: !!o.died }];
    const at = (h: ReturnType<typeof hold>) => authorPostsFrom({ annals: A, polities: [P(0), P(1)], endYear: 1100, interventions: [ap({ until: 1010 })], holds: h })[0];
    expect(at(hold({ stop: 1020 }))).toMatchObject({ until: 1020, end: 'retired' });
    expect(at(hold({ stop: 1020 })).wars.map((w) => [w.war, w.from, w.until])).toEqual([[0, 1012, 1018]]);
    expect(at(hold({ stop: 1020, died: true }))).toMatchObject({ until: 1020, end: 'died' });
    const still = at(hold());
    expect(still.until).toBeUndefined();
    // 掌权比任期短、在别国掌权、卸任以后才掌权:照原来的任期
    for (const h of [hold({ stop: 1008 }), hold({ stop: 1020, polity: 1 }), hold({ start: 1011, stop: 1020 })]) expect(at(h)).toMatchObject({ until: 1010, end: 'retired' });
  });

  it('卸任年 / 卒年 / 卸甲致仕的岁数;到结束年份还在任;亡国;名臣改朝换代;又任了别的、即位', () => {
    const base = [ev(1000, 'intervene', 0, -1, 0)];
    expect(posts(base, [ap({ died: 1030, until: 1050 })])[0]).toMatchObject({ until: 1030, end: 'died' });
    expect(posts(base, [ap()])[0]).toMatchObject({ until: 960 + AUTHOR_GENERAL_AGE_END, end: 'retired' });
    expect(posts(base, [ap({ role: 'minister' })], undefined, 1200)[0]).toMatchObject({ until: 960 + AUTHOR_MINISTER_AGE_END, end: 'retired' });
    const still = posts(base, [ap({ born: 990 })], undefined, 1050)[0];
    expect(still.until).toBeUndefined();
    expect(still.end).toBeUndefined();
    // 亡国:有灭它的国家 = 出降 / 散了 = 出奔 / 并入 = 随国归附
    const fallen = (b: number) => posts([...base, ev(1010, 'fall', 0, b)], [ap()], [P(0, { ended: 1010 }), P(1)])[0];
    expect(fallen(1)).toMatchObject({ until: 1010, end: 'surrendered' });
    expect(fallen(-1)).toMatchObject({ until: 1010, end: 'fled' });
    expect(posts([...base, ev(1010, 'merge', 1, 0), ev(1010, 'fall', 0, 1)], [ap()], [P(0, { ended: 1010 }), P(1)])[0]).toMatchObject({ until: 1010, end: 'merged' });
    // 改朝换代:名臣去职,将领照旧
    const dyn = [...base, ev(1010, 'dynasty', 0, -1)];
    expect(posts(dyn, [ap({ role: 'minister', until: 1040 })])[0]).toMatchObject({ until: 1010, end: 'deposed' });
    expect(posts(dyn, [ap({ until: 1040 })])[0]).toMatchObject({ until: 1040, end: 'retired' });
    // 又任了别的:前一个到那一刻;同一刻的前一个没生效
    const two = posts([...base, ev(1008, 'intervene', 1, -1, 1)], [ap({ until: 1040 }), ap({ role: 'minister', a: 'polity:c2#0', until: 1040 })]);
    expect(two.map((p) => [p.polity, p.until, p.end])).toEqual([
      [0, 1008, 'yielded'],
      [1, 1040, 'retired'],
    ]);
    expect(posts([...base, ev(1000, 'intervene', 1, -1, 1)], [ap(), ap({ role: 'minister' })])[0].skip).toBe('replaced');
    // 即位:到即位那一刻;同一刻即位 = 没生效
    const L = { expand: 50, war: 50, develop: 50, trade: 50 };
    const crown = (from: number): Intervention => ({ kind: 'crown', a: 'polity:c3#0', char: 1, from, born: 960, leanings: L });
    expect(posts([...base, ev(1012, 'intervene', 2, -1, 1)], [ap({ until: 1040 }), crown(1012)])[0]).toMatchObject({ until: 1012, end: 'yielded' });
    expect(posts([...base, ev(1000, 'intervene', 2, -1, 1)], [ap(), crown(1000)])[0].skip).toBe('crowned');
    // 没生效的(b 列不是 −1)不算
    expect(posts([ev(1000, 'intervene', 0, -2, 0)], [ap()])).toEqual([]);
  });
});

describe('清理', () => {
  const a = 'polity:c1#0';
  it('任将任臣:编号、生年、身份要对;卒年早于生年的去掉;卸任年不晚于上任的去掉', () => {
    const ok = { kind: 'appoint', a, char: 3, role: 'general', born: 1200, died: 1260, from: 1230, until: 1250 };
    expect(cleanIntervention(ok)).toBe(ok);
    expect(cleanIntervention({ ...ok, role: 'minister' })).toEqual({ ...ok, role: 'minister' });
    for (const bad of [{ role: 'ruler' }, { role: undefined }, { char: 0 }, { char: 1.5 }, { born: undefined }, { a: 'x' }])
      expect(cleanIntervention({ ...ok, ...bad }), JSON.stringify(bad)).toBeNull();
    expect(cleanIntervention({ ...ok, died: 1190 })).toEqual({ kind: 'appoint', a, char: 3, role: 'general', born: 1200, from: 1230, until: 1250 });
    expect(cleanIntervention({ ...ok, until: 1230 })).toEqual({ kind: 'appoint', a, char: 3, role: 'general', born: 1200, died: 1260, from: 1230 });
    expect(cleanIntervention({ ...ok, extra: 1 })).toEqual(ok);
  });
  it('宣战的谁挂帅:作者人物的编号才留;旧存档的宣战没有它,照旧', () => {
    const v = { kind: 'declare', a, b: 'polity:c2#0', from: 1230 };
    expect(cleanIntervention(v)).toBe(v);
    expect(cleanIntervention({ ...v, lead: 4 })).toEqual({ ...v, lead: 4 });
    expect(cleanIntervention({ ...v, lead: 0 })).toEqual(v);
    expect(cleanIntervention({ ...v, lead: 'x' })).toEqual(v);
  });
});

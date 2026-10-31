/**
 * 干预"即位"(crown,gen/edits.ts;推演里 civ/interventions.ts、在位表 civ/rulers.ts、人物 civ/people.ts):
 * - 第 T 年立作者的人物为某国君主:T 以前的归属、日志、史事逐字节不变;T 到下台那年推演里在位的是他(倾向照干预),
 *   之后是继位者;人物里有他(author = 人物编号),原来那位让位
 * - 那年国家已亡 / 还没立国 / 他还没出生:不生效,说明原因
 * - 同一年先立国再立他:他是开国之君,没有在位 0 天的君主;同一刻改朝换代:他当新朝第一位(在位表)
 * - 他在位时亡国、改朝换代:那一刻下台,不写卒年
 * - 他在位时这国的强制宣战:他亲征,编年史写他的名字
 * - 逐年推演、接着推、再推 N 年和一口气推完一样
 * - 清理规则
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ, type Person } from '../src/gen/civ';
import { polityModelOf, rulerOf } from '../src/gen/civ/polities';
import { reignBook, reignStart, rulerBase, type Crown, type ReignPolity } from '../src/gen/civ/rulers';
import { ownersAt } from '../src/gen/civ/timeline';
import { buildChronicle } from '../src/gen/civ/story/chronicle';
import { playCiv, playStop, playTurn } from '../src/gen/civ/play';
import { applyCharacters } from '../src/gen/characters';
import { kinOf } from '../src/gen/civ/story/peopleText';
import { interventionFate, laterInterventions, rewindStepwise, startStepwise } from '../src/gen/stepwise';
import { EMPTY_EDITS, cleanIntervention, cleanInterventions, polityKey, regionKey, type Intervention, type WorldEdits } from '../src/gen/edits';
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

const BOLD = { expand: 100, war: 100, develop: 50, trade: 50 };
type CrownIv = Extract<Intervention, { kind: 'crown' }>;
const crown = (a: string, from: number, o: Partial<CrownIv> = {}): CrownIv => ({ kind: 'crown', a, char: 1, from, born: from - 30, leanings: BOLD, ...o });

/** T 年州最多的国家 */
function biggestAt(civ: Civ, T: number): number {
  const n = new Map<number, number>();
  for (const o of ownersAt(civ, T).polity) if (o >= 0) n.set(o, (n.get(o) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** 变化日志里 T 年以前的条目(年份、州、层、新值、原因) */
function logBefore(civ: Civ, T: number): number[][] {
  const L = civ.log;
  const out: number[][] = [];
  for (let i = 0; i < L.size && L.year[i] < T; i++) out.push([L.year[i], L.region[i], L.layer[i], L.value[i], L.cause[i]]);
  return out;
}

const rulersOf = (civ: Civ, pid: number) => civ.people!.filter((x) => x.role === 'ruler' && x.polity === pid).sort((a, b) => a.from! - b.from! || a.id - b.id);
const authorsOf = (civ: Civ) => civ.people!.filter((x) => x.author !== undefined);

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

describe.each([7, 2024])('即位 · seed=%i', (seed) => {
  const T = 1500;

  it('第 1500 年立作者的人物为最大国的君主(在位到 1530 年):之前逐字节不变,在位期间推演里是他,之后是继位者(在位时改朝换代的到那一刻)', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const pid = biggestAt(base, T);
    const v = crown(polityKey(base, pid), T, { until: T + 30 });
    const civ = generateCiv(w, { interventions: [v] });
    // T 以前:归属(变化日志、检查点)、史事一样
    expect(logBefore(civ, T)).toEqual(logBefore(base, T));
    expect(civ.annals.filter((e) => e.year < T)).toEqual(base.annals.filter((e) => e.year < T));
    expect(civ.checkpoints.filter((c) => c.year < T)).toEqual(base.checkpoints.filter((c) => c.year < T));
    // 史事:生效了
    const iv = civ.annals.filter((e) => e.kind === 'intervene');
    expect(iv).toHaveLength(1);
    expect(iv[0]).toMatchObject({ year: T, a: pid, b: -1, war: 0 });
    // 人物:作者立的君主 1500–1530,原来那位到 1500 年让位
    const rs = rulersOf(civ, pid);
    const k = rs.findIndex((x) => x.author === 1);
    expect(k).toBeGreaterThan(0);
    const me = rs[k];
    expect(me).toMatchObject({ role: 'ruler', name: '', born: T - 30, from: T, rise: 'crown', author: 1, leanings: BOLD });
    expect(me.died).toBeUndefined();
    expect(me.title).toBe('');
    // 在位到 1530 年退位;那之前改朝换代了就在那一刻被废(seed 2024 第 1529 年改朝换代)
    const end = me.until!;
    const dyn = civ.annals.find((e) => e.kind === 'dynasty' && e.a === pid && e.year > T && e.year <= T + 30);
    expect(end).toBe(dyn ? dyn.year : T + 30);
    expect(me.fate).toBe(dyn ? 'deposed' : 'retired');
    expect(rs[k - 1]).toMatchObject({ until: T, fate: 'yielded' });
    expect(rs[k - 1].from!).toBeLessThan(T);
    // 继位的照常有人,不连成他的儿子
    expect(rs[k + 1]).toMatchObject({ from: end, rise: dyn ? expect.stringMatching(/^(rise|usurp)$/) : 'heir' });
    expect(rs[k + 1].parent).not.toBe(me.id);
    expect(kinOf(civ, me, rs[k + 1])).toBe('');
    expect(authorsOf(civ)).toHaveLength(1);
    // 推演里的在位表(接着推时重建的同一份):他从即位的下一刻起在位,到下台那一刻;即位那一刻还算原来那位
    const pm = polityModelOf(resumeCiv(w, civ))!;
    expect(rulerOf(pm, pid, T).leanings).toEqual(rs[k - 1].leanings);
    for (const t of [T + 1 / 256, T + 0.5, T + 15, end - 1 / 256]) expect(rulerOf(pm, pid, t).leanings, `${t}`).toEqual(BOLD);
    // 新朝的第一位从改朝换代的下一刻起在位
    const next = end + (dyn ? 1 / 256 : 0);
    expect(rulerOf(pm, pid, next).leanings).toEqual(rs[k + 1].leanings);
    expect(rulerOf(pm, pid, next).crown).toBeUndefined();
    // 干预列表的说法
    expect(interventionFate(civ, 0)).toEqual({ state: 'done', annal: civ.annals.indexOf(iv[0]) });
  }, 120_000);

  it('不生效:那一年国家已亡 / 还没立国 / 他还没出生(说明原因;历史和不干预一样)', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const dead = base.polities.find((p) => p.ended !== undefined && p.ended < T - 50)!;
    const later = base.polities.find((p) => p.founded > T + 50)!;
    const alive = biggestAt(base, T);
    const list = [crown(polityKey(base, dead.id), T), crown(polityKey(base, later.id), T), crown(polityKey(base, alive), T, { born: T + 5 })];
    const civ = generateCiv(w, { interventions: list });
    const iv = civ.annals.filter((e) => e.kind === 'intervene');
    // 已亡、没出生记了史事(b = −3 / −2);还没立国的国家键指不到,不记
    expect(iv.map((e) => [e.a, e.b, e.war])).toEqual([
      [dead.id, -3, 0],
      [alive, -2, 2],
    ]);
    const a = interventionFate(civ, 0);
    const b = interventionFate(civ, 1);
    const c = interventionFate(civ, 2);
    expect(a.state).toBe('void');
    expect(b.state).toBe('void');
    expect(c.state).toBe('void');
    expect(a.state === 'void' && a.why).toMatch(/^那一年.+已亡$/);
    expect(b.state === 'void' && b.why).toBe(`${b.state === 'void' && b.why.split('第')[0]}第 ${Math.floor(later.founded)} 年才立国`);
    expect(c.state === 'void' && c.why).toBe(`他第 ${T + 5} 年才出生`);
    // 历史和不干预一样(只多了两条史事)
    expect(authorsOf(civ)).toHaveLength(0);
    expect(logBefore(civ, Infinity)).toEqual(logBefore(base, Infinity));
    expect(civ.annals.filter((e) => e.kind !== 'intervene')).toEqual(base.annals);
    // 人物一样(经手的史事下标跟着多出来的两条史事挪了,不比)
    const core = (c: Civ) => c.people!.map((x) => [x.role, x.polity, x.name, x.born, x.died, x.from, x.until, x.fate, x.rise, x.title, x.parent]);
    expect(core(civ)).toEqual(core(base));
    // 编年史写原因
    const text = buildChronicle(applyCharacters(civ, [{ id: 1, name: '林小满', color: 'red', born: T - 30 }]))
      .filter((e) => e.kind === 'intervene')
      .map((e) => e.text);
    expect(text[0]).toMatch(/^【干预】欲立林小满为.+之主,然.+已亡$/);
    expect(text[1]).toMatch(/^【干预】欲立林小满为.+之主,然其人尚未出生$/);
  }, 120_000);

  it('同一年先立国再立他:他是开国之君,没有在位 0 天的君主;接着推跨过这一刻和一口气推完一样', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const pid = biggestAt(base, T);
    const own = ownersAt(base, T).polity;
    // 大国里一州有城、不是国都的地方
    const s = base.settlements.find((x) => x.founded < T && (x.ended === undefined || x.ended > T) && own[x.region] === pid && !base.polities.some((p) => p.capitals!.some((c) => c.settlement === x.id)))!;
    const found: Intervention = { kind: 'found', region: regionKey(base, s.region), from: T };
    const c1 = generateCiv(w, { interventions: [found] });
    const made = c1.annals.find((e) => e.kind === 'intervene')!.a;
    expect(made).toBeGreaterThanOrEqual(0);
    const list = [found, crown(polityKey(c1, made), T)];
    const civ = generateCiv(w, { interventions: list });
    expect(civ.annals.filter((e) => e.kind === 'intervene').map((e) => [e.a, e.b])).toEqual([
      [made, pid],
      [made, -1],
    ]);
    const rs = rulersOf(civ, made);
    expect(rs[0]).toMatchObject({ author: 1, from: T, rise: 'crown', dynasty: 0 });
    for (const x of rs) expect(x.until === undefined || x.until > x.from!, x.name).toBe(true);
    if (rs[1]) expect(rs[1]).toMatchObject({ from: rs[0].until, rise: 'heir' });
    // 推演里:立国那一刻还是生成的开国之君(在位 0 天,人物里不列),下一刻起是他
    const pm = polityModelOf(resumeCiv(w, civ))!;
    expect(rulerOf(pm, made, T).crown).toBeUndefined();
    expect(rulerOf(pm, made, T + 1 / 256).leanings).toEqual(BOLD);
    // 推到 T + 20 再接着推到 T + 200,和一口气推到 T + 200 一样(接着推时重放立国那一刻的扩张预约)
    const one = generateCiv(w, { interventions: list, endYear: T + 200 });
    const head = generateCiv(w, { interventions: list, endYear: T + 20 });
    same(continueCiv(w, head, { interventions: list, endYear: T + 200 }), one, '接着推');
    // 停在 T 那一刻(他已即位、还没开始在位)接着推,也一样
    const at = generateCiv(w, { interventions: list, endYear: T });
    same(continueCiv(w, at, { interventions: list, endYear: T + 200 }), one, '从 T 接着推');
  }, 300_000);

  it('同一年给同一国先后立两位:后一位顶替前一位,前一位那条算没即位', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const A = polityKey(base, biggestAt(base, T));
    const civ = generateCiv(w, { interventions: [crown(A, T), crown(A, T, { char: 2 })], endYear: T + 50 });
    expect(authorsOf(civ).map((x) => [x.author, x.from])).toEqual([[2, T]]);
    expect(interventionFate(civ, 0)).toMatchObject({ state: 'void', why: '同一年又给这国立了别的人物' });
    expect(interventionFate(civ, 1).state).toBe('done');
    // 同一个人立了两次、中间夹着别人:只有最后那条算即位
    const aba = generateCiv(w, { interventions: [crown(A, T), crown(A, T, { char: 2 }), crown(A, T)], endYear: T + 50 });
    expect(authorsOf(aba).map((x) => [x.author, x.from])).toEqual([[1, T]]);
    expect([0, 1, 2].map((i) => interventionFate(aba, i).state)).toEqual(['void', 'void', 'done']);
  }, 120_000);

  it('他在位时亡国 / 改朝换代:那一刻下台(出降、出奔 / 被废),不写卒年', () => {
    const w = world(seed);
    const base = baseOf(seed);
    // 原来的历史里亡于别国(或改朝换代)的那一刻在位的君主,在那一年年初换成一位倾向和他一样的作者君主:到那一刻历史不变
    const cases: { kind: 'fall' | 'dynasty'; pid: number; at: number; ruler: Person }[] = [];
    // 有人掌着实权的那几年(regents.ts)换了作者的君主,掌权就了结、推演跟着变:不挑这样的(掌实权的人篡位的改朝换代也不挑)
    const held = (pid: number, a: number, b: number) =>
      (base.people ?? []).some((x) => x.regencies?.some((g) => P0(g.ruler) === pid && g.from < b && (g.until ?? Infinity) > a));
    const P0 = (id: number) => base.people![id].polity;
    for (const [i, e] of base.annals.entries()) {
      if ((e.kind !== 'fall' || e.b < 0) && e.kind !== 'dynasty') continue;
      if (Math.floor(e.year) === e.year || e.year < 300) continue;
      if (base.annals[i - 1]?.kind === 'regent' || held(e.a, Math.floor(e.year), e.year)) continue;
      const r = rulersOf(base, e.a).find((x) => x.from! < Math.floor(e.year) && x.until === e.year);
      if (r) cases.push({ kind: e.kind === 'fall' ? 'fall' : 'dynasty', pid: e.a, at: e.year, ruler: r });
    }
    const fall = cases.find((x) => x.kind === 'fall')!;
    const dyn = cases.find((x) => x.kind === 'dynasty')!;
    expect(fall).toBeDefined();
    expect(dyn).toBeDefined();
    const list = [fall, dyn].map((x) => crown(polityKey(base, x.pid), Math.floor(x.at), { char: x === fall ? 1 : 2, leanings: x.ruler.leanings!, born: Math.floor(x.at) - 40 }));
    // 两条分开推(各自在那一刻以前的历史一样)
    for (const [i, x] of [fall, dyn].entries()) {
      const civ = generateCiv(w, { interventions: [list[i]], endYear: Math.ceil(x.at) + 10 });
      const me = authorsOf(civ)[0];
      expect(me, x.kind).toMatchObject({ polity: x.pid, from: Math.floor(x.at), until: x.at });
      expect(me.died, x.kind).toBeUndefined();
      if (x.kind === 'fall') expect(['surrendered', 'fled', 'merged']).toContain(me.fate);
      else expect(me.fate).toBe('deposed');
      // 原来那位让位
      expect(rulersOf(civ, x.pid).find((r) => r.until === Math.floor(x.at))).toMatchObject({ fate: 'yielded', name: x.ruler.name });
    }
  }, 300_000);

  it('他在位时这国的强制宣战:他亲征,编年史写他的名字', () => {
    const w = world(seed);
    const base = baseOf(seed);
    // T 年年初(之前的历史一样)陆上接壤、没在交战的两国,挑最大的那一国
    const own = ownersAt(base, T - 1 / 512).polity;
    const reg = base.regions;
    const open = new Set<number>();
    for (const e of base.annals) {
      if (e.year >= T) break;
      if (e.kind === 'war') open.add(e.war);
      else if (e.kind === 'peace') open.delete(e.war);
    }
    const fighting = base.annals.filter((e) => e.kind === 'war' && e.year < T && open.has(e.war)).map((e) => `${Math.min(e.a, e.b)}|${Math.max(e.a, e.b)}`);
    const size = new Map<number, number>();
    for (const o of own) if (o >= 0) size.set(o, (size.get(o) ?? 0) + 1);
    let pid = -1;
    let foe = -1;
    for (const [p] of [...size.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])) {
      const near: number[] = [];
      for (let r = 0; r < reg.count; r++) {
        if (own[r] !== p) continue;
        for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
          const q = own[reg.adj[k]];
          if (q >= 0 && q !== p && reg.adjKind[k] < 3 && !fighting.includes(`${Math.min(p, q)}|${Math.max(p, q)}`)) near.push(q);
        }
      }
      if (near.length) {
        pid = p;
        foe = Math.min(...near);
        break;
      }
    }
    expect(foe).toBeGreaterThanOrEqual(0);
    // 好战 0 的君主本来不亲征:作者下令的仗一律他领兵(同一年下的宣战排在即位后面)
    const list: Intervention[] = [crown(polityKey(base, pid), T, { until: T + 30, leanings: { expand: 50, war: 0, develop: 50, trade: 50 } }), { kind: 'declare', a: polityKey(base, pid), b: polityKey(base, foe), from: T }];
    const civ = applyCharacters(generateCiv(w, { interventions: list, endYear: T + 60 }), [{ id: 1, name: '林小满', color: 'red', born: T - 30 }]);
    const ai = civ.annals.findIndex((e) => e.kind === 'intervene' && e.war === 1);
    const war = civ.annals.slice(ai + 1).find((e) => e.year === T && e.kind === 'war' && e.a === pid && e.b === foe);
    expect(war, '宣战打成了').toBeDefined();
    const me = authorsOf(civ)[0];
    expect(me.name).toBe('林小满');
    expect(me.commands?.[0]).toMatchObject({ war: war!.war, side: 0, from: T });
    const all = buildChronicle(civ);
    expect(all.find((e) => e.year === T && e.text.includes('亲征'))?.text ?? '').toContain('林小满');
    expect(all.find((e) => e.kind === 'intervene' && e.year === T)?.text).toMatch(/^【干预】林小满即.+君位$/);
    // 同一年先宣战、后立他:那场仗打起来时他还没即位,不由他领兵(好战 100 的也不)
    const late = generateCiv(w, { interventions: [list[1], { ...(list[0] as CrownIv), leanings: BOLD }], endYear: T + 60 });
    const war2 = late.annals.find((e) => e.year === T && e.kind === 'war' && e.a === pid && e.b === foe);
    expect(war2).toBeDefined();
    const decl = late.annals.indexOf(war2!);
    // 开战那一刻不是他(之后他即了位,仗打到一半换他领兵照常可以)
    expect((authorsOf(late)[0].commands ?? []).filter((m) => m.war === war2!.war && m.first <= decl)).toEqual([]);
  }, 120_000);

  it('逐年推演:第 T 年停下下即位命令、接着推,和带着同样的命令一口气推完一样;倒回 T 以前这条去掉,从 T 以前开始时它照样带着', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const v = crown(polityKey(base, biggestAt(base, T)), T, { until: T + 30 });
    // 停在 T 年年初下命令,推 50 年
    const at = playCiv(w, {}, { year: T, commands: [] });
    const r = playTurn(w, at, {}, { year: T, commands: [] }, [v], 50);
    expect(r.rejected).toEqual([]);
    same(r.civ, generateCiv(w, { interventions: [v], endYear: playStop(T + 50) }), '逐年推演');
    expect(authorsOf(r.civ)).toHaveLength(1);
    // 倒回 T 以前:这条命令去掉
    const edits: WorldEdits = { ...EMPTY_EDITS, play: r.play, playFrom: T };
    const back = rewindStepwise(edits, T - 10)!;
    expect(back.dropped).toEqual([v]);
    expect(back.edits.play!.commands).toEqual([]);
    // 推演模式里第 T 年的即位,从 T − 25 年开始逐年推演时照样带着,走到 T + 25 年和一口气推完一样
    const normal: WorldEdits = { ...EMPTY_EDITS, interventions: [v] };
    expect(laterInterventions(normal, T - 25).map((x) => x.v)).toEqual([v]);
    const start = startStepwise(normal, T - 25);
    let civ = playCiv(w, { interventions: start.interventions }, start.play!);
    let play = start.play!;
    for (const n of [25, 25]) {
      const s = playTurn(w, civ, { interventions: start.interventions }, play, [], n);
      civ = s.civ;
      play = s.play;
    }
    same(civ, generateCiv(w, { interventions: [v], endYear: playStop(T + 25) }), '从 T 以前开始');
  }, 300_000);

  it('再推 N 年 / 接着推跨过他的在位期,和一口气推完逐字节一样', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const list = [crown(polityKey(base, biggestAt(base, T)), T, { until: T + 30 }), crown(polityKey(base, biggestAt(base, 900)), 900, { char: 2 })];
    const one = generateCiv(w, { interventions: list, endYear: 1700 });
    for (const from of [850, 905, T - 10, T, T + 10, T + 30, T + 60]) {
      const head = generateCiv(w, { interventions: list, endYear: from });
      same(continueCiv(w, head, { interventions: list, endYear: 1700 }), one, `从 ${from} 年接着推`);
    }
  }, 600_000);
});

describe('即位 · 在位表(rulers.ts)', () => {
  const base = rulerBase(7);
  const tag = 123456;
  const leanings = { expand: 90, war: 10, develop: 50, trade: 50 };
  const c = (t: number, o: Partial<Crown> = {}): Crown => ({ kind: 'crown', t, born: t - 20, leanings, char: 1, iv: 0, ...o });

  it('同一刻改朝换代:他当新朝的第一位(顶替,不留在位 0 天的新君)', () => {
    const p: ReignPolity = { founded: 100, kind: 'river', lineage: 'realm', dynasties: [{ year: 100, name: '', seat: 0 }, { year: 400, name: '', seat: 0 }] };
    const plain = reignBook(base, tag, { ...p }, 600);
    const list = reignBook(base, tag, p, 600, [c(400)]);
    const i = list.findIndex((r) => r.crown);
    expect(list[i]).toMatchObject({ dynasty: 1, j: 0, from: 400 });
    expect(list[i].k).toBe(plain.findIndex((r) => r.dynasty === 1));
    expect(list.some((r) => r.cut === r.from)).toBe(false);
    // 改朝换代前的一样
    expect(list.slice(0, i)).toEqual(plain.slice(0, i));
    expect(reignStart(list[i])).toBe(400 + 1 / 256);
  });

  it('同一刻立国 / 刚交接的新君:那一位留在表里在位 0 天(推演里那一刻还是他),作者君主从下一刻起', () => {
    const p: ReignPolity = { founded: 300, kind: 'river', lineage: 'realm' };
    const list = reignBook(base, tag, p, 500, [c(300)]);
    expect(list[0]).toMatchObject({ k: 0, from: 300, cut: 300 });
    expect(list[1]).toMatchObject({ k: 1, from: 300, crown: { t: 300 } });
    // 同一刻两位作者君主:后一位顶替前一位
    const two = reignBook(base, tag, { ...p }, 500, [c(300), c(300, { char: 2, iv: 1 })]);
    expect(two.filter((r) => r.crown).map((r) => r.crown!.char)).toEqual([2]);
    expect(two[1]).toMatchObject({ k: 1, crown: { char: 2 } });
  });

  it('作者君主被后来的作者君主取代、在位年数按位次的随机数、一生不超过 88 岁', () => {
    const p: ReignPolity = { founded: 0, kind: 'river', lineage: 'realm' };
    const list = reignBook(base, tag, p, 2000, [c(500, { until: 540 }), c(520, { char: 2, iv: 1, born: 440 })]);
    const a = list.find((r) => r.crown?.char === 1)!;
    const b = list.find((r) => r.crown?.char === 2)!;
    expect(a).toMatchObject({ from: 500, cut: 520 });
    expect(b).toMatchObject({ from: 520, k: a.k + 1 });
    // 80 岁即位:最多在位到 88 岁(至少 1 年)
    expect(b.natural).toBeLessThanOrEqual(440 + 88);
    expect(b.natural).toBeGreaterThanOrEqual(521);
    // 下一位从他下台那年起
    expect(list[b.k + 1].from).toBe(b.natural);
  });
});

describe('即位 · 清理', () => {
  const A = 'polity:c4567#0';
  it('合格的原样返回;char 要 1–1e9 的整数、born 要是数;年份取整夹回;until 不晚于 from 的去掉;倾向取整夹到 0–100、缺的补 50;多余字段去掉', () => {
    const ok: Intervention = { kind: 'crown', a: A, char: 3, from: 1500, born: 1470, until: 1530, leanings: { expand: 100, war: 0, develop: 50, trade: 20 } };
    expect(cleanIntervention(ok)).toBe(ok);
    const list = [ok];
    expect(cleanInterventions(list)).toBe(list);
    expect(cleanIntervention({ ...ok, char: 0 })).toBeNull();
    expect(cleanIntervention({ ...ok, char: 1.5 })).toBeNull();
    expect(cleanIntervention({ ...ok, char: 2e9 })).toBeNull();
    expect(cleanIntervention({ ...ok, char: '3' })).toBeNull();
    expect(cleanIntervention({ ...ok, born: undefined })).toBeNull();
    expect(cleanIntervention({ ...ok, born: 'x' })).toBeNull();
    expect(cleanIntervention({ ...ok, a: 'polity:x' })).toBeNull();
    expect(cleanIntervention({ ...ok, from: 1500.7, born: -20.5, until: 1500, extra: 1 })).toEqual({ kind: 'crown', a: A, char: 3, from: 1500, born: 0, leanings: ok.leanings });
    expect(cleanIntervention({ ...ok, until: 99999 })).toEqual({ ...ok, until: 65535 });
    expect(cleanIntervention({ ...ok, leanings: { expand: 140.6, war: -3, develop: 'x', other: 9 } })).toEqual({ ...ok, leanings: { expand: 100, war: 0, develop: 50, trade: 50 } });
    expect(cleanIntervention({ ...ok, leanings: undefined })).toEqual({ ...ok, leanings: { expand: 50, war: 50, develop: 50, trade: 50 } });
    expect(cleanIntervention({ ...ok, leanings: { expand: 70.4, war: 1, develop: 2, trade: 3 } })).toEqual({ ...ok, leanings: { expand: 70, war: 1, develop: 2, trade: 3 } });
  });

  it('套上人物卡的名字(applyCharacters):按编号填,找不到的叫"作者的人物";没有即位的历史原样返回', () => {
    const civ = { polities: [], interventions: [], people: [{ id: 0, role: 'ruler', polity: 0, name: '李昭', born: 0 }] } as unknown as Civ;
    expect(applyCharacters(civ, [])).toBe(civ);
    const two = {
      polities: [],
      interventions: [crown(A, 10), crown(A, 20, { char: 9 })],
      people: [{ id: 0, role: 'ruler', polity: 0, name: '', born: 0, author: 1 }, { id: 1, role: 'ruler', polity: 0, name: '李昭', born: 0 }],
    } as unknown as Civ;
    const out = applyCharacters(two, [{ id: 1, name: '林小满', color: 'red', born: 0 }]);
    expect(out).not.toBe(two);
    expect(out.people!.map((x) => x.name)).toEqual(['林小满', '李昭']);
    expect(out.people![1]).toBe(two.people![1]);
    expect(out.authorNames).toEqual({ 1: '林小满', 9: '作者的人物' });
    expect(two.people![0].name).toBe('');
  });
});

/**
 * 干预「保住王室」(keep;即位带的勾 = crown 的 keep: true;推演里 civ/interventions.ts 的 keeps、dynasty.ts、regency.ts):
 * - 没下这条干预、即位没勾的世界和加它以前逐字节一样(旧存档里的即位没有 keep,按没勾算)
 * - 开关:从 T 年起这国不改朝换代 —— 本该改朝的那一刻记一句未遂(史事 keep),在那以前历史一个字不变;到期以后照常
 * - 即位带勾:作者的人物在位那些年不改朝换代,在位到原定那年
 * - 掌实权的人到期篡位:挡下,名臣、大臣伏诛 / 叔父还政,编年史并成一句
 * - 那一年这国已亡:不生效,写原因
 * - 接着推、逐年推演和一口气推完一样
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, generateWorld, type World } from '../src/gen/world';
import { continueCiv, generateCiv, type Civ, type Person } from '../src/gen/civ';
import { holderAt } from '../src/gen/civ/regentInfo';
import { ownersAt } from '../src/gen/civ/timeline';
import { buildChronicle } from '../src/gen/civ/chronicle';
import { playCiv, playStop, playTurn } from '../src/gen/civ/play';
import { KEEP_REGENT } from '../src/gen/civ/rulers';
import { RG_PURGE, RG_RETURN, RG_USURP, REGENCY_KINDS } from '../src/gen/civ/regents';
import { interventionFate } from '../src/gen/stepwise';
import { cleanIntervention, personKey, polityKey, type Intervention } from '../src/gen/edits';

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

const L = { expand: 60, war: 70, develop: 50, trade: 40 };

/** 两份历史逐项一样 */
function same(a: Civ, b: Civ, label: string) {
  expect(Object.keys(a).sort(), label).toEqual(Object.keys(b).sort());
  for (const k of Object.keys(b) as (keyof Civ)[]) expect(a[k], `${label} ${k}`).toEqual(b[k]);
}

/** 变化日志里 T 年以前的条目 */
function logBefore(civ: Civ, T: number): number[][] {
  const g = civ.log;
  const out: number[][] = [];
  for (let i = 0; i < g.size && g.year[i] < T; i++) out.push([g.year[i], g.region[i], g.layer[i], g.value[i], g.cause[i]]);
  return out;
}

/** 不干预时第一次看王朝改朝换代(不是掌实权的人篡位开的那种)的那一条:900 年以后 */
function firstChange(civ: Civ) {
  return civ.annals.find((e, i) => e.kind === 'dynasty' && e.year >= 900 && !(civ.annals[i - 1]?.kind === 'regent' && civ.annals[i - 1].year === e.year))!;
}

const fp = (x: unknown) =>
  createHash('sha256')
    .update(JSON.stringify(x, (_k, v) => (ArrayBuffer.isView(v) ? Array.from(v as unknown as ArrayLike<number>) : v)))
    .digest('hex')
    .slice(0, 16);

describe('保住王室 · 没下、即位没勾的世界不变', () => {
  /**
   * 种子 7(12000 地块)1500 年给最大的国立作者的人物(没勾保住王室)、1600 年起保护它:各字段的指纹。
   * 期望值是加「保住王室」以前的代码算的(和改动后一样;GENERATOR_VERSION 43 战争节奏、44 出奔邻国、46 大迁徙、47 季节进推演重算;48 大迁徙的方位字只重算了 chronicle;49 时代做法重算);推演改了历史、升 GENERATOR_VERSION 时照 determinism.test.ts 的做法
   * 用 PRINT_FINGERPRINT=1 重算
   */
  const EXPECTED: Record<string, string> = {
    annals: '05219f6273974438',
    checkpoints: '09470fa6e9f2c1e5',
    log: '463547ad21c9de19',
    people: '3c70a7240f23b424',
    polities: '6aa53808d0ef9944',
    settlements: '43336581a8161375',
    chronicle: '84e321c02b2f7b29',
  };

  it('即位没勾(旧存档里的即位没有 keep)的世界和加这条干预以前逐字节一样', () => {
    const w = generateWorld({ ...DEFAULT_PARAMS, cells: 12000, seed: 7 });
    const base = generateCiv(w);
    const n = new Map<number, number>();
    for (const o of ownersAt(base, 1500).polity) if (o >= 0) n.set(o, (n.get(o) ?? 0) + 1);
    const big = [...n.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
    const list: Intervention[] = [
      { kind: 'crown', a: polityKey(base, big), char: 1, from: 1500, born: 1470, until: 1540, leanings: L },
      { kind: 'protect', a: polityKey(base, big), from: 1600, until: 1700 },
    ];
    const civ = generateCiv(w, { interventions: list });
    const got: Record<string, string> = {};
    for (const k of Object.keys(EXPECTED)) got[k] = k === 'chronicle' ? fp(buildChronicle(civ).map((e) => [e.year, e.kind, e.tag, e.importance, e.text])) : fp((civ as unknown as Record<string, unknown>)[k]);
    if (process.env.PRINT_FINGERPRINT) console.log(JSON.stringify(got, null, 2));
    expect(got).toEqual(EXPECTED);
    expect(civ.annals.some((e) => e.kind === 'keep')).toBe(false);
  }, 120_000);

  it('清理:即位的 keep 只认 true(旧存档的即位原样返回、不补);开关同保护(until 不晚于 from 的去掉,多余字段去掉)', () => {
    const old = { kind: 'crown', a: 'polity:c12#0', char: 1, from: 1500, born: 1470, leanings: L };
    expect(cleanIntervention(old)).toBe(old);
    const kept = { kind: 'crown', a: 'polity:c12#0', char: 1, from: 1500, born: 1470, keep: true, leanings: L };
    expect(cleanIntervention(kept)).toBe(kept);
    expect(cleanIntervention({ ...old, keep: 'yes' })).toEqual(old);
    expect(cleanIntervention({ ...old, until: 1530, after: true, keep: true })).toEqual({ kind: 'crown', a: 'polity:c12#0', char: 1, from: 1500, born: 1470, until: 1530, after: true, keep: true, leanings: L });
    const k = { kind: 'keep', a: 'polity:c12#0', from: 1500, until: 1560 };
    expect(cleanIntervention(k)).toBe(k);
    expect(cleanIntervention({ kind: 'keep', a: 'polity:c12#0', from: 1500, until: 1500, x: 1 })).toEqual({ kind: 'keep', a: 'polity:c12#0', from: 1500 });
    expect(cleanIntervention({ kind: 'keep', a: 'bad', from: 1500 })).toBeNull();
  });
});

describe.each([7, 2024])('保住王室 · seed=%i', (seed) => {
  it('开关:本该改朝的那一年前保这国 60 年 —— 之前逐字节不变,那一刻记一句未遂、王朝不换;编年史只进「全部」', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const e = firstChange(base);
    const P = e.a;
    const T = Math.floor(e.year) < e.year ? Math.floor(e.year) : e.year - 1;
    const v: Intervention = { kind: 'keep', a: polityKey(base, P), from: T, until: T + 60 };
    const civ = generateCiv(w, { interventions: [v] });
    // T 以前一字不变;挡下的那一刻以前,除了下令那一条,史事也一样
    expect(logBefore(civ, T)).toEqual(logBefore(base, T));
    expect(civ.annals.filter((x) => x.year < T)).toEqual(base.annals.filter((x) => x.year < T));
    const keeps = civ.annals.filter((x) => x.kind === 'keep');
    expect(keeps.length).toBeGreaterThan(0);
    expect(keeps[0].year).toBe(e.year);
    expect(keeps[0].a).toBe(P);
    expect(keeps.every((x) => x.war === 0 && x.a === P && x.year >= T && x.year < T + 60)).toBe(true);
    const upTo = (c: Civ) => c.annals.filter((x) => x.year < e.year && x.kind !== 'intervene');
    expect(upTo(civ)).toEqual(upTo(base));
    // 管着的那些年这国不换朝;生效了
    expect((civ.polities[P].dynasties ?? []).some((d) => d.year >= T && d.year < T + 60)).toBe(false);
    expect(interventionFate(civ, 0).state).toBe('done');
    // 编年史:【干预】一句、未遂的那几句(只在"全部")
    const ch = buildChronicle(civ);
    expect(ch.find((x) => x.kind === 'intervene')!.text).toContain('自此宗社不移,至第');
    const tried = ch.filter((x) => x.kind === 'keep');
    expect(tried.length).toBe(keeps.length);
    for (const x of tried) {
      expect(x.importance).toBeLessThan(3);
      expect(x.tag).toBe('保');
      expect(x.text).toMatch(/未成|伏诛|处死/);
    }
  }, 120_000);

  it('即位带勾:作者的人物在位那些年不改朝换代,在位到原定那年;挡下的都记在这条即位上', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const e = firstChange(base);
    const P = e.a;
    const T = Math.floor(e.year) - 2;
    const crown = (keep: boolean): Intervention => ({ kind: 'crown', a: polityKey(base, P), char: 1, from: T, born: T - 30, until: T + 40, ...(keep ? { keep: true as const } : {}), leanings: L });
    const civ = generateCiv(w, { interventions: [crown(true)] });
    const him = civ.people!.find((x) => x.author === 1)!;
    expect(him.from).toBe(T);
    expect(him.until).toBe(T + 40);
    expect((civ.polities[P].dynasties ?? []).some((d) => d.year >= T && d.year < T + 40)).toBe(false);
    const keeps = civ.annals.filter((x) => x.kind === 'keep');
    expect(keeps.every((x) => x.war === 0 && x.a === P && x.year > T && x.year < T + 40)).toBe(true);
    expect(buildChronicle(civ).find((x) => x.kind === 'intervene')!.text).toContain('君位,在位期间保住王室');
    // 没勾的:没有未遂这回事
    const plain = generateCiv(w, { interventions: [crown(false)] });
    expect(plain.annals.some((x) => x.kind === 'keep')).toBe(false);
  }, 120_000);

  it('掌实权的人到期篡位:挡下 —— 名臣、大臣伏诛 / 叔父还政,不改朝换代;编年史并成一句', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const cases = [
      base.annals.find((x) => x.kind === 'regent' && x.n === RG_USURP && x.year >= 800 && REGENCY_KINDS[x.b] !== 'uncle'),
      base.annals.find((x) => x.kind === 'regent' && x.n === RG_USURP && x.year >= 800 && REGENCY_KINDS[x.b] === 'uncle'),
    ].filter((x) => !!x);
    expect(cases.length).toBeGreaterThan(0);
    for (const u of cases) {
      const P = u!.a;
      const T = Math.floor(u!.year) < u!.year ? Math.floor(u!.year) : u!.year - 1;
      const civ = generateCiv(w, { interventions: [{ kind: 'keep', a: polityKey(base, P), from: T, until: T + 5 }] });
      const i = civ.annals.findIndex((x) => x.kind === 'keep' && x.year === u!.year);
      expect(i, `${REGENCY_KINDS[u!.b]} ${u!.year}`).toBeGreaterThan(0);
      const k = civ.annals[i];
      const r = civ.annals[i + 1];
      expect(k.b).toBe(KEEP_REGENT);
      expect(r.kind).toBe('regent');
      expect(r.n).toBe(REGENCY_KINDS[u!.b] === 'uncle' ? RG_RETURN : RG_PURGE);
      expect(civ.annals.some((x) => x.kind === 'dynasty' && x.a === P && x.year === u!.year)).toBe(false);
      expect((civ.polities[P].seizes ?? []).some((s) => s.year === u!.year)).toBe(false);
      // 编年史:未遂那一句把结局并进来(结局那条不另列)
      const ch = buildChronicle(civ);
      const x = ch.find((c) => c.kind === 'keep' && c.id === i)!;
      expect(x.text).toMatch(REGENCY_KINDS[u!.b] === 'uncle' ? /谋废.*未成|废黜.*未成/ : /谋篡,事泄伏诛|图谋篡位,事泄被处死/);
      expect(ch.some((c) => c.id === i + 1)).toBe(false);
    }
  }, 300_000);

  it('作者下令"让他掌权"到期篡位,和保住王室撞上:后下的为准', () => {
    const w = world(seed);
    const base = baseOf(seed);
    // 君主 N 和接着即位的太子 H,T = H 满 17 岁、N 在位、那几年没人掌权的一年:令 H 监国,三年后篡位
    const rs = (base.people ?? []).filter((x) => x.role === 'ruler' && x.author === undefined && base.polities[x.polity]?.lineage !== 'republic');
    let pick: { H: Person; T: number } | null = null;
    for (const N of rs) {
      if ((N.from ?? 0) < 700 || N.until === undefined) continue;
      const H = rs.find((x) => x.polity === N.polity && x.parent === N.id && x.rise === 'heir' && x.from === N.until);
      if (!H) continue;
      const T = Math.ceil(Math.max(N.from!, H.born + 17)) + 1;
      let free = true;
      for (let t = T; t <= T + 6; t++) if (holderAt(base, N.polity, t)) free = false;
      if (T + 6 < N.until && free) {
        pick = { H, T };
        break;
      }
    }
    expect(pick).not.toBeNull();
    const { H, T } = pick!;
    const a = polityKey(base, H.polity);
    const reg = cleanIntervention({ kind: 'regent', a, person: personKey(base, H.id), from: T, how: 'heir', end: 'usurp', years: 3 })!;
    const keep: Intervention = { kind: 'keep', a, from: T, until: T + 20 };
    const usurpAt = (c: Civ) => c.annals.some((x) => x.kind === 'regent' && x.n === RG_USURP && x.a === H.polity && x.year === T + 3);
    // 先让他掌权、后保住王室:挡下
    const late = generateCiv(w, { interventions: [reg, keep], endYear: T + 10 });
    expect(usurpAt(late)).toBe(false);
    expect(late.annals.some((x) => x.kind === 'keep' && x.b === KEEP_REGENT && x.year === T + 3 && x.war === 1)).toBe(true);
    // 先保住王室、后让他掌权:照他篡位
    const early = generateCiv(w, { interventions: [keep, reg], endYear: T + 10 });
    expect(usurpAt(early)).toBe(true);
    expect(early.annals.some((x) => x.kind === 'keep')).toBe(false);
  }, 120_000);

  it('那一年这国已亡:不生效,写原因;历史和不干预一样', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const p = base.polities.find((q) => q.ended !== undefined && q.ended < 1400 && q.founded < q.ended - 50)!;
    const v: Intervention = { kind: 'keep', a: polityKey(base, p.id), from: Math.ceil(p.ended!) + 10 };
    const civ = generateCiv(w, { interventions: [v] });
    const f = interventionFate(civ, 0);
    expect(f.state).toBe('void');
    expect(f.state === 'void' && f.why).toContain('已亡');
    expect(civ.annals.filter((x) => x.kind !== 'intervene')).toEqual(base.annals);
  }, 120_000);

  it('接着推、逐年推演和一口气推完一样', () => {
    const w = world(seed);
    const base = baseOf(seed);
    const e = firstChange(base);
    const P = e.a;
    const T = Math.floor(e.year) - 2;
    const list: Intervention[] = [
      { kind: 'crown', a: polityKey(base, P), char: 1, from: T, born: T - 30, until: T + 40, keep: true, leanings: L },
      { kind: 'keep', a: polityKey(base, P), from: T + 50, until: T + 150 },
    ];
    const one = generateCiv(w, { interventions: list, endYear: T + 200 });
    for (const from of [T - 5, Math.floor(e.year), T + 45, T + 100]) {
      const head = generateCiv(w, { interventions: list, endYear: from });
      same(continueCiv(w, head, { interventions: list, endYear: T + 200 }), one, `从 ${from} 年接着推`);
    }
    // 逐年推演:第 T 年停下下这两条(第二条下在 T + 50 年那一步),接着推
    const at = playCiv(w, {}, { year: T, commands: [] });
    const r1 = playTurn(w, at, {}, { year: T, commands: [] }, [list[0]], 50);
    expect(r1.rejected).toEqual([]);
    const r2 = playTurn(w, r1.civ, {}, r1.play, [list[1]], 60);
    expect(r2.rejected).toEqual([]);
    same(r2.civ, generateCiv(w, { interventions: list, endYear: playStop(T + 110) }), '逐年推演');
  }, 600_000);
});

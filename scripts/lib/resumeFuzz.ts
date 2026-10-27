/**
 * 接着推的随机自查(scripts/stress.ts、tests/civ-resume-fuzz.test.ts 共用;不依赖 vitest):
 * 逐年推演(gen/civ/play.ts)从第 0 年起,每一步推随机的 1–60 年(两成是 1 年;上限可调),每停一下在"现在"随机下 0–4 条命令
 * —— 宣战、结盟、迁都、划州(含永久)、立国(含起名、在没人住的州、在别国国都)、不许扩张、不许灭、禁止分裂、即位(含还没出生的、
 * 给同一刻刚立的新国立君主、等在位的那位下台再即位)、方针(含照大纲顺着引的:国力、动荡加减,多看几眼)、灭国(并入一国 / 散成无主)、让人物去世(君主、将领、名臣)、改君主倾向、
 * 天灾(瘟疫、饥荒、地震水旱),对象多半挑在世的国家和它们的人物、城、州,也挑已亡的、对不上的 ——
 * 推到第 to 年,和带着同样的命令从第 0 年一口气推完逐字段比。
 * 作者在推演模式里下的干预(比逐年推演的进度晚才生效的几条,对象按先推一遍的历史挑)也带上:接着推时补上它们的事件。
 * 随机数一律从 subSeed(种子, …) 取,同一个种子每次下一样的命令、停在一样的年份。
 */
import { isDeepStrictEqual } from 'node:util';
import { generateWorld, DEFAULT_PARAMS, MAP_H, type World } from '../../src/gen/world';
import { generateCiv, type Civ, type CivParams } from '../../src/gen/civ';
import { playCiv, playStop, playTurn } from '../../src/gen/civ/play';
import { upheavalSteps } from '../../src/gen/civ/upheaval';
import { UPHEAVALS_MAX } from '../../src/gen/terrainEdits';
import { mulberry32, subSeed } from '../../src/gen/civ/rand';
import { capitalAt } from '../../src/gen/civ/growth';
import {
  DEATH_ROLES,
  GUIDE_LOOKS,
  POLICY_FOCI,
  POLICY_PRESETS_KEYS,
  cleanIntervention,
  personKey,
  polityKey,
  regionKey,
  settlementKey,
  type DisasterLevel,
  type Intervention,
  type InterventionKind,
  type PlayState,
} from '../../src/gen/edits';
import { POLICY_PRESETS } from '../../src/gen/civ/policy';

type Rng = () => number;

/** 一组随机自查的设定 */
export interface FuzzCase {
  seed: number;
  /** 世界有几个地块(不给 = 默认大小) */
  cells?: number;
  /** 推到第几年年初 */
  to: number;
  /** 推出这段历史的参数(作者的干预另外随机放,不在这里给) */
  params?: Partial<CivParams>;
  /** 一步最多推几年(不给 = 60;给得小,停得密) */
  maxStep?: number;
  /** 每一步都和一口气推完比(找第一处分叉的那一步用;不给 = 只在最后比一次) */
  everyStep?: boolean;
  /** 每一步推之前看一眼(调试用):停在第 now 年年初的历史、这一步的干预列表(作者的 + 到这一步为止的命令)、推到第几年年初 */
  onStep?: (now: number, civ: Civ, interventions: Intervention[], to: number) => void;
}

export interface FuzzResult {
  /** 推了几步、下了几条命令(各种类各几条)、作者的干预几条 */
  steps: number;
  commands: number;
  kinds: Partial<Record<InterventionKind, number>>;
  author: number;
  /** 和一口气推完不一样的地方(没有 = null):停在第几年、哪几项、第一条不一样的日志 / 史事、那一步下的命令 */
  diff: string | null;
}

const worlds = new Map<string, World>();
/** 种子 seed、cells 个地块的世界,同一个只生成一次 */
export function fuzzWorld(seed: number, cells = DEFAULT_PARAMS.cells): World {
  const key = `${seed}/${cells}`;
  let w = worlds.get(key);
  if (!w) worlds.set(key, (w = generateWorld({ ...DEFAULT_PARAMS, seed, cells })));
  return w;
}

const pick = <T>(rnd: Rng, xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)];
const between = (rnd: Rng, a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

/** 第 T 年年初给 civ 随机下的命令(0–4 条;国家一个都还没有时只可能下立国) */
export function fuzzOrders(civ: Civ, T: number): Intervention[] {
  const rnd = mulberry32(subSeed(civ.seed, `resume-fuzz:${T}`));
  const P = civ.polities;
  const alive = P.filter((p) => p.ended === undefined);
  const out: Intervention[] = [];
  const n = rnd() < 0.15 ? 0 : between(rnd, 1, 4);
  /** 一个国家:多半在世的,也有已亡的 */
  const anyPolity = () => (alive.length && rnd() < 0.88 ? pick(rnd, alive) : P.length ? pick(rnd, P) : undefined);
  const lands = (pid: number) => {
    const out: number[] = [];
    for (let r = 0; r < civ.polity.length; r++) if (civ.polity[r] === pid) out.push(r);
    return out;
  };
  /** 现在的国都(Polity.capital 是立国时的国都) */
  const capOf = (pid: number) => capitalAt(P[pid], Infinity);
  const capRegion = (pid: number) => civ.settlements[capOf(pid)].region;
  /** 州 r 里下一个立国的国家的稳定键(按立国时国都所在的州数第几个;给同一刻在这里立的新国立君主) */
  const nextPolityKey = (r: number) => `polity:c${(civ.regions.keySeat ?? civ.regions.seat)[r]}#${P.filter((p) => civ.settlements[p.capital].region === r).length}`;
  const crown = (a: string): Intervention => {
    const L = () => between(rnd, 0, 100);
    const born = Math.max(0, T - between(rnd, 0, 90) + (rnd() < 0.1 ? between(rnd, 1, 40) : 0));
    const until = rnd() < 0.5 ? T + between(rnd, 1, 80) : undefined;
    const after = rnd() < 0.25;
    // 在位期间保住王室:照生年的奇偶带上一半(不多取随机数,别的命令照旧)
    const keep = born % 2 === 0;
    return {
      kind: 'crown',
      a,
      char: between(rnd, 1, 999),
      from: T,
      born,
      ...(until !== undefined ? { until } : {}),
      ...(after ? { after } : {}),
      ...(keep ? { keep: true as const } : {}),
      leanings: { expand: L(), war: L(), develop: L(), trade: L() },
    };
  };
  /** 让人物去世、改君主倾向:多半挑这国此刻在位的君主,也有将领、名臣(只改人物)、已经下台的 */
  const personOrder = (kind: 'death' | 'temper', A: number, a: string): Intervention | null => {
    const ps = (civ.people ?? []).filter((x) => x.polity === A && (kind === 'death' ? (DEATH_ROLES as readonly string[]).includes(x.role) : x.role === 'ruler'));
    const now = ps.filter((x) => x.role === 'ruler' && (x.from ?? Infinity) <= T && (x.until === undefined || x.until > T));
    const x = now.length && rnd() < 0.7 ? pick(rnd, now) : ps.length ? pick(rnd, ps) : undefined;
    const person = x ? personKey(civ, x.id) : '';
    if (!person) return null;
    const L = () => between(rnd, 0, 100);
    return cleanIntervention(kind === 'death' ? { kind, a, person, from: T } : { kind, a, person, from: T, leanings: { expand: L(), war: L(), develop: L(), trade: L() } });
  };
  /** 天灾:瘟疫(多半挑还在的城;两成是全球大疫,疫后无人收拾 10 / 30 / 60 年)、饥荒(一国 / 几州)、地震水旱(多半在这国境内) */
  const disaster = (A: number, a: string): Intervention | null => {
    const level = between(rnd, 1, 3) as DisasterLevel;
    const u = rnd();
    if (u < 0.35) {
      const cs = civ.settlements.filter((s) => s.ended === undefined);
      const c = cs.length && rnd() < 0.9 ? pick(rnd, cs) : civ.settlements.length ? pick(rnd, civ.settlements) : undefined;
      if (c && rnd() < 0.2) return cleanIntervention({ kind: 'disaster', type: 'pandemic', level, from: T, city: settlementKey(civ, c.id), slump: pick(rnd, [10, 30, 60]) });
      return c ? cleanIntervention({ kind: 'disaster', type: 'plague', level, from: T, city: settlementKey(civ, c.id) }) : null;
    }
    const ls = lands(A);
    const some = () => (ls.length && rnd() < 0.8 ? pick(rnd, ls) : between(rnd, 0, civ.regions.count - 1));
    if (u < 0.7) {
      if (rnd() < 0.5) return cleanIntervention({ kind: 'disaster', type: 'famine', level, from: T, a });
      const rs = Array.from({ length: between(rnd, 1, 5) }, some);
      return cleanIntervention({ kind: 'disaster', type: 'famine', level, from: T, regions: rs.map((r) => regionKey(civ, r)) });
    }
    return cleanIntervention({ kind: 'disaster', type: 'quake', level, from: T, region: regionKey(civ, some()) });
  };
  /** 接壤的国家(方针的亲、仇多半挑它们,挑得上才起作用) */
  const neighbors = (pid: number) => {
    const reg = civ.regions;
    const out = new Set<number>();
    for (const r of lands(pid)) for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) if (civ.polity[reg.adj[k]] >= 0 && civ.polity[reg.adj[k]] !== pid) out.add(civ.polity[reg.adj[k]]);
    return [...out].sort((x, y) => x - y);
  };
  /** 方针:一键选的 / 随手拧的旋钮,挑几个亲、仇和发展重点;也有罢方针的 */
  const policy = (A: number, a: string): Intervention => {
    const v: Extract<Intervention, { kind: 'policy' }> = { kind: 'policy', a, from: T };
    if (rnd() < 0.15) return v;
    if (rnd() < 0.5) {
      const k = pick(rnd, [...POLICY_PRESETS_KEYS]);
      Object.assign(v, POLICY_PRESETS[k], { preset: k });
    } else for (const k of ['war', 'expand', 'coast', 'peace'] as const) if (rnd() < 0.6) v[k] = between(rnd, -50, 50);
    const near = neighbors(A);
    const keys = () => {
      const out: string[] = [];
      for (let j = between(rnd, 0, 3); j > 0; j--) {
        const q = near.length && rnd() < 0.8 ? pick(rnd, near) : anyPolity()?.id;
        if (q !== undefined) out.push(polityKey(civ, q));
      }
      return out;
    };
    v.foes = keys();
    v.friends = keys();
    if (rnd() < 0.4) v.focus = pick(rnd, [...POLICY_FOCI]);
    // 照大纲顺着引的那种:另加减国力、动荡,在往后几十年里多看几眼邻国 / 内政 / 王朝
    // (另取一串随机数:别的命令和以前一样)
    const g = mulberry32(subSeed(civ.seed, `resume-fuzz:guide:${T}:${a}`));
    if (g() < 0.3) {
      const years = Array.from({ length: between(g, 1, 6) }, () => T + between(g, 0, 60));
      Object.assign(v, { plot: 1, guide: true, power: between(g, -50, 100), unrest: between(g, -50, 50), look: { kind: pick(g, [...GUIDE_LOOKS]), years } });
    }
    return cleanIntervention(v)!;
  };
  for (let i = 0; i < n; i++) {
    const A = anyPolity();
    const kinds: InterventionKind[] = A
      ? ['declare', 'ally', 'move', 'move', 'cede', 'cede', 'found', 'found', 'halt', 'protect', 'unity', 'crown', 'crown', 'policy', 'policy', 'destroy', 'death', 'death', 'temper', 'disaster', 'disaster', 'treaty', 'treaty', 'neutral', 'neutral']
      : ['found'];
    const kind = pick(rnd, kinds);
    const others = alive.filter((p) => p !== A);
    const B = others.length && rnd() < 0.9 ? pick(rnd, others) : anyPolity();
    const a = A ? polityKey(civ, A.id) : '';
    if (kind === 'declare' || kind === 'ally') {
      if (!B || B === A) continue;
      const b = polityKey(civ, B.id);
      if (kind === 'declare') out.push({ kind, a, b, from: T });
      else out.push(rnd() < 0.3 ? { kind, a, b, from: T } : { kind, a, b, from: T, until: T + between(rnd, 1, 100) });
    } else if (kind === 'halt' || kind === 'protect') {
      out.push(rnd() < 0.3 ? { kind, a, from: T } : { kind, a, from: T, until: T + between(rnd, 1, 80) });
    } else if (kind === 'unity') out.push({ kind, a, from: T });
    else if (kind === 'keep') out.push(rnd() < 0.3 ? { kind, a, from: T } : { kind, a, from: T, until: T + between(rnd, 1, 80) });
    else if (kind === 'policy') out.push(policy(A!.id, a));
    else if (kind === 'destroy') out.push(B && B !== A && rnd() < 0.6 ? { kind, a, b: polityKey(civ, B.id), from: T } : { kind, a, from: T });
    else if (kind === 'death' || kind === 'temper' || kind === 'disaster') {
      const v = kind === 'disaster' ? disaster(A!.id, a) : personOrder(kind, A!.id, a);
      if (v) out.push(v);
    }
    else if (kind === 'crown') out.push(crown(a));
    else if (kind === 'treaty' || kind === 'neutral') {
      // 立约 / 划中立地:和 B(有时再加一国;可能已亡);中立地多半是两国的一州,也有随便哪一州(多半划不成)
      if (!B || B === A) continue;
      const ps = [polityKey(civ, B.id)];
      const C = others.length > 1 && rnd() < 0.4 ? pick(rnd, others) : undefined;
      if (C && C !== B && C !== A) ps.push(polityKey(civ, C.id));
      const own = [...lands(A!.id), ...lands(B.id)];
      const r = own.length && rnd() < 0.8 ? pick(rnd, own) : between(rnd, 0, civ.regions.count - 1);
      const v =
        kind === 'treaty'
          ? cleanIntervention({ kind, a, ps, from: T, term: pick(rnd, [10, 20, 30, 0]), limited: rnd() < 0.4, keep: rnd() < 0.3, zone: rnd() < 0.4 ? regionKey(civ, r) : undefined, ask: rnd() < 0.3 })
          : cleanIntervention({ kind, a, region: regionKey(civ, r), ps, from: T, quiet: rnd() < 0.3, lasting: rnd() < 0.3, until: rnd() < 0.3 ? T + between(rnd, 1, 60) : undefined, ask: rnd() < 0.3 });
      if (v) out.push(v);
    } else if (kind === 'move') {
      // 多半迁到本国的另一座城;也有迁到别国的城、已毁的城(迁不成)
      const own = civ.settlements.filter((s) => s.ended === undefined && civ.polity[s.region] === A!.id && s.id !== capOf(A!.id));
      const c = own.length && rnd() < 0.8 ? pick(rnd, own) : civ.settlements.length ? pick(rnd, civ.settlements) : undefined;
      if (c) out.push({ kind, a, city: settlementKey(civ, c.id), from: T });
    } else if (kind === 'cede') {
      // 多半是别国的一州(有时正是它的国都);也有部落地带、随便哪一州(可能没人住)
      const u = rnd();
      let r = -1;
      if (B && u < 0.6) {
        const ls = lands(B.id);
        if (ls.length) r = rnd() < 0.25 ? capRegion(B.id) : pick(rnd, ls);
      } else if (u < 0.8) {
        const free: number[] = [];
        for (let q = 0; q < civ.polity.length; q++) if (civ.polity[q] < 0 && civ.culture[q] >= 0) free.push(q);
        if (free.length) r = pick(rnd, free);
      } else r = between(rnd, 0, civ.regions.count - 1);
      if (r >= 0) out.push(rnd() < 0.3 ? { kind, a, region: regionKey(civ, r), from: T, permanent: true } : { kind, a, region: regionKey(civ, r), from: T });
    } else if (kind === 'found') {
      // 立国:多半在有城、不是国都的州;也有别国的国都、没人住的州(先来一支新民族)
      const u = rnd();
      let r = -1;
      if (u < 0.6) {
        const caps = new Set(alive.map((p) => capOf(p.id)));
        const cs = civ.settlements.filter((s) => s.ended === undefined && !caps.has(s.id));
        if (cs.length) r = pick(rnd, cs).region;
      } else if (u < 0.8 && alive.length) r = capRegion(pick(rnd, alive).id);
      else {
        const empty: number[] = [];
        for (let q = 0; q < civ.culture.length; q++) if (civ.culture[q] < 0) empty.push(q);
        if (empty.length) r = pick(rnd, empty);
      }
      if (r < 0) continue;
      out.push(rnd() < 0.2 ? { kind, region: regionKey(civ, r), from: T, name: '试立之国' } : { kind, region: regionKey(civ, r), from: T });
      // 同一刻给新国立一位君主(键按"这州第几个立国"推出来;没立成就对不上,不生效)
      if (rnd() < 0.3) out.push(crown(nextPolityKey(r)));
    }
  }
  return out;
}

/** 作者的干预落在第 100 年到这一年之间(对象按推到这一年的历史挑;和推到第几年无关,同一个种子总是这几条) */
const AUTHOR_TO = 1500;

/** 作者在推演模式里下的干预:base(先推到 AUTHOR_TO 年的历史)里那几年还在的国家,随机挑几种(都比逐年推演的进度晚才生效) */
function authorPlan(base: Civ): Intervention[] {
  const rnd = mulberry32(subSeed(base.seed, 'resume-fuzz:author'));
  const out: Intervention[] = [];
  const n = between(rnd, 2, 5);
  for (let i = 0; i < n; i++) {
    const y = between(rnd, 100, AUTHOR_TO - 1);
    const alive = base.polities.filter((p) => p.founded <= y && (p.ended === undefined || p.ended > y));
    if (alive.length < 2) continue;
    const A = pick(rnd, alive);
    const B = pick(rnd, alive.filter((p) => p !== A));
    const a = polityKey(base, A.id);
    const b = polityKey(base, B.id);
    const k = between(rnd, 0, 4);
    if (k === 0) out.push({ kind: 'protect', a, from: y, until: y + between(rnd, 20, 150) });
    else if (k === 1) out.push({ kind: 'ally', a, b, from: y, until: y + between(rnd, 20, 150) });
    else if (k === 2) out.push({ kind: 'halt', a, from: y, until: y + between(rnd, 10, 80) });
    else if (k === 3) out.push({ kind: 'declare', a, b, from: y });
    else out.push({ kind: 'unity', a, from: y });
  }
  return out.sort((x, y) => x.from - y.from);
}

/** 两份历史第一处不一样的地方(都一样 = null) */
export function civDiff(a: Civ, b: Civ): string | null {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])] as (keyof Civ)[];
  const bad = keys.filter((k) => !isDeepStrictEqual(a[k], b[k]));
  if (!bad.length) return null;
  const lines = [`不一样:${bad.join('、')}`];
  const L = a.log;
  const M = b.log;
  for (let i = 0; i < Math.max(L.size, M.size); i++) {
    const x = [L.year[i], L.region[i], L.layer[i], L.value[i], L.cause[i]];
    const y = [M.year[i], M.region[i], M.layer[i], M.value[i], M.cause[i]];
    if (!isDeepStrictEqual(x, y)) {
      lines.push(`变化日志第 ${i} 条(年份、州、层、值、原因):接着推 ${JSON.stringify(x)},一口气 ${JSON.stringify(y)}`);
      break;
    }
  }
  for (let i = 0; i < Math.max(a.annals.length, b.annals.length); i++) {
    if (!isDeepStrictEqual(a.annals[i], b.annals[i])) {
      lines.push(`史事第 ${i} 条:接着推 ${JSON.stringify(a.annals[i])},一口气 ${JSON.stringify(b.annals[i])}`);
      break;
    }
  }
  return lines.join('\n');
}

/** 离陆地最远的一处深海(地图中间一带;世界坐标):在那里"沉下去"一点不改海陆 */
function deepSea(w: World): number[] {
  const { n, adjStart, adj, x, y } = w.mesh;
  const dist = new Int32Array(n).fill(-1);
  const q: number[] = [];
  for (let i = 0; i < n; i++) if (w.water[i] === 0) (dist[i] = 0), q.push(i);
  for (let h = 0; h < q.length; h++) for (let k = adjStart[q[h]]; k < adjStart[q[h] + 1]; k++) if (dist[adj[k]] < 0) (dist[adj[k]] = dist[q[h]] + 1), q.push(adj[k]);
  let best = -1;
  for (let i = 0; i < n; i++) if (Math.abs(y[i] - MAP_H / 2) < 300 && (best < 0 || dist[i] > dist[best])) best = i;
  return [Math.round(x[best]), Math.round(y[best])];
}

/** 带地形大事的一组随机自查的结果:大事在哪几年、下了几条命令;和没有大事时不一样的地方(没有 = null) */
export interface UpheavalFuzzResult {
  years: number[];
  commands: number;
  diff: string | null;
}

/**
 * 带地形大事的世界,大事那一刻接着推(gen/civ/index.ts:推到大事前一刻,套上新地形接着推)和一口气推完一样:
 * 随机挑 count 个年份(默认界面上的上限;可以多放,多停几次)各放一件不改海陆的大事(离陆地最远的深海里沉一下),带着作者的干预和随机几年下的命令(同 fuzzOrders),
 * 推完以后的日志、史事(大事那几条除外)、各州归属、检查点和没有大事、一口气推完的逐项相等。
 * 大事那一刻要从各层补事件(补立国、补建城、同一刻撞上的几件按预约先后排),补得不对历史就会分叉
 */
export function fuzzUpheavalResume(seed: number, count = UPHEAVALS_MAX): UpheavalFuzzResult {
  const w = fuzzWorld(seed);
  const rnd = mulberry32(subSeed(seed, 'resume-fuzz:upheavals'));
  const interventions = authorPlan(generateCiv(w, { endYear: AUTHOR_TO }));
  // 随机几年下的命令(对象按推到那一年的历史挑)
  const orderYears = [...new Set(Array.from({ length: 4 }, () => between(rnd, 100, 2800)))].sort((a, b) => a - b);
  for (const T of orderYears) interventions.push(...fuzzOrders(generateCiv(w, { interventions: interventions.slice(), endYear: playStop(T) }), T));
  const years = new Set<number>();
  while (years.size < count) years.add(between(rnd, 20, 2980));
  const ys = [...years].sort((a, b) => a - b);
  const at = deepSea(w);
  const steps = upheavalSteps(w.params, [], null, ys.map((year) => ({ year, ops: [{ kind: 'sink', pts: at, r: 6, s: 0.3 }] })));
  const result = (diff: string | null): UpheavalFuzzResult => ({ years: ys, commands: interventions.length, diff });
  if (steps.some((s) => !isDeepStrictEqual(s.world.water, w.water))) return result('大事改了海陆,比不了');
  const one = generateCiv(w, { interventions });
  const up = generateCiv(w, { interventions, upheavals: steps });
  const pick = (c: Civ) => ({
    log: c.log,
    annals: c.annals.filter((e) => e.kind !== 'upheaval'),
    culture: c.culture,
    polity: c.polity,
    checkpoints: c.checkpoints,
  });
  const a = pick(up);
  const b = pick(one);
  const bad = (Object.keys(a) as (keyof typeof a)[]).filter((k) => !isDeepStrictEqual(a[k], b[k]));
  if (!bad.length) return result(null);
  const lines = [`不一样:${bad.join('、')}`];
  for (let i = 0; i < Math.max(a.annals.length, b.annals.length); i++) {
    if (!isDeepStrictEqual(a.annals[i], b.annals[i])) {
      lines.push(`史事第 ${i} 条:有大事 ${JSON.stringify(a.annals[i])},没有大事 ${JSON.stringify(b.annals[i])}`);
      break;
    }
  }
  return result(lines.join('\n'));
}

/** 跑一组随机自查(见文件头) */
export function fuzzResume(c: FuzzCase): FuzzResult {
  const w = fuzzWorld(c.seed, c.cells);
  const params = c.params ?? {};
  const author = authorPlan(generateCiv(w, { ...params, endYear: AUTHOR_TO }));
  const p: Partial<CivParams> = { ...params, interventions: author };
  const rnd = mulberry32(subSeed(c.seed, 'resume-fuzz:steps'));
  let play: PlayState = { year: 0, commands: [] };
  let civ = playCiv(w, p, play);
  let steps = 0;
  const kinds: FuzzResult['kinds'] = {};
  const result = (diff: string | null): FuzzResult => ({ steps, commands: play.commands.length, kinds, author: author.length, diff });
  while (play.year < c.to) {
    const now = play.year;
    const cmds = fuzzOrders(civ, now);
    const years = Math.min(c.to - now, rnd() < 0.2 ? 1 : between(rnd, 1, c.maxStep ?? 60));
    c.onStep?.(now, civ, [...author, ...play.commands, ...cmds], now + years);
    const r = playTurn(w, civ, p, play, cmds, years);
    if (r.rejected.length) return result(`第 ${now} 年:命令没收下 ${JSON.stringify(r.rejected)}`);
    for (const v of cmds) kinds[v.kind] = (kinds[v.kind] ?? 0) + 1;
    civ = r.civ;
    play = r.play;
    steps++;
    if (c.everyStep || play.year >= c.to) {
      const one = generateCiv(w, { ...params, interventions: [...author, ...play.commands], endYear: playStop(play.year) });
      const d = civDiff(civ, one);
      if (d) return result(`停在第 ${now} 年、推到第 ${play.year} 年年初时:\n${d}\n这一步下的命令:${JSON.stringify(cmds)}`);
    }
  }
  return result(null);
}

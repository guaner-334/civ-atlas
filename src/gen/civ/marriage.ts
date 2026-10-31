/**
 * 两国宗室联姻在推演里什么时候办(规则、加成在 marriages.ts):挂在同一个推演引擎(sim.ts)上,只记史事 marry、改宣战 / 结盟 / 援盟的赔率,不改归属。
 *
 * 流程(index.ts 在 installRegency 之后调用 installMarriage):
 *   - 看邦交时(diplomacy.ts,约 40 年一次;不占"一次最多出一件事"):两国都是有王室的君主国(共和国没有)、接壤或结着盟(宗主、藩属也行)、
 *     当时没在交兵、眼下没结着亲,娶亲的一方有合适的人、对方在位的君主有女儿可嫁 —— 机会 MARRY_PER × 合格的亲家数(最多 MARRY_MAX),
 *     挑中的是盟国再加 MARRY_ALLY;一次最多结一门。MUTUAL 的机会互嫁(对方的太子同时娶这边的宗室女;紧跟着记第二条 marry)
 *   - 打到厌战、达成目标议和时(wars.ts 的 onPeace):PEACE_MATCH 的机会以和亲作结 —— 得了地的一方(没得 = 守方)娶输的一方的宗室女
 *   - 宣战(wars.ts 的 kin):两国结着亲的赔率按分量打折;在位的君主母亲出自对方的 × UNCLE_DECLARE;背盟(kinBetray)、
 *     挑盟友、援盟(diplomacy.ts 的 bond)照分量加减
 * **不存内存状态**:结过的亲由史事 marry 推出来(marriages.ts 的 matchesFrom);两国后来开没开过战看战争模型(史事重建)。
 * 随机数:keyed4(subSeed(seed, 'civ-marriage'), 国家的位置锚(PolityModel.ptag), 第几次看邦交, 用途, 0);和亲按攻守两国 + 宣战那一刻。纯计算,不碰 DOM。
 */
import type { Civ, Year } from './types';
import { Layer } from './types';
import { parsePersonKey, type Intervention } from '../edits';
import { IV_NOT_HIM } from './rulers';
import { IV_NO_THRONE } from './regents';
import { keyed4, subSeed } from './rand';
import type { CivSim } from './sim';
import { bookOf, polityModelOf, rulerOf, type PolityModel } from './polities';
import { warModelOf, type War } from './wars';
import { diplomacyModelOf } from './diplomacy';
import { capitalAt } from './growth';
import { reignBorn, type Reign } from './rulers';
import { broodOf } from './royals';
import {
  BRIDE_FATHER,
  GROOM_AGE,
  GROOM_SELF,
  IV_AT_WAR,
  IV_NO_BRIDE,
  IV_NO_GROOM,
  IV_NO_PARTNER,
  KIN_BETRAY,
  KIN_DECLARE,
  MARRY_ALLY,
  MARRY_MAX,
  MARRY_PER,
  MUTUAL,
  PEACE_MATCH,
  UNCLE_DECLARE,
  YOUNG_RULER,
  bondOf,
  kinKey,
  lastMatch,
  matchesFrom,
  type Match,
  type MatchCtx,
} from './marriages';
import { royalAt } from './regime';

// 随机数用途
const U_MARRY = 1;
const U_PICK = 2;
const U_MUTUAL = 3;
const U_PEACE = 4;

export interface MarriageModel {
  pm: PolityModel;
  cx: MatchCtx;
  base: number;
  /** 结过的亲(按先后) */
  list: Match[];
  /** 两国之间的几门亲(键见 kinKey) */
  pair: Map<number, Match[]>;
  /** 娶过亲的人(国家:生年)→ 他结的几门亲 */
  groom: Map<string, Match[]>;
  /**
   * 作者下令"为他联姻"(干预第 i 条,interventions.ts 在那一刻调;q = 对方国家,没有 = −1):先查能不能(note 记史事 intervene,
   * b 列见 marriages.ts 的 IV_NO_PARTNER 等),能就结亲(记 marry;互嫁记两条)
   */
  intervene?: (v: MarryIv, i: number, pid: number, q: number, t: Year, note: (b: number) => void) => void;
}

/** 作者下令"为他联姻"的一条 */
export type MarryIv = Extract<Intervention, { kind: 'marry' }>;

const models = new WeakMap<CivSim, MarriageModel>();

/** 推演引擎上挂着的联姻模型(测试、统计用) */
export function marriageModelOf(sim: CivSim): MarriageModel | undefined {
  return models.get(sim);
}

function newModel(pm: PolityModel): MarriageModel {
  const cx: MatchCtx = { rbase: pm.rbase, tag: pm.rtag, polities: pm.polities, book: (pid, t) => bookOf(pm, pid, t) };
  return { pm, cx, base: subSeed(pm.seed, 'civ-marriage'), list: [], pair: new Map(), groom: new Map() };
}

function add(mm: MarriageModel, m: Match): void {
  mm.list.push(m);
  const k = kinKey(m.a, m.b);
  const p = mm.pair.get(k);
  if (p) p.push(m);
  else mm.pair.set(k, [m]);
  const g = `${m.a}:${m.born}`;
  const q = mm.groom.get(g);
  if (q) q.push(m);
  else mm.groom.set(g, [m]);
}

/** 登记联姻的钩子(installRegency 之后调用;要先装好战争、邦交) */
export function installMarriage(sim: CivSim, pm: PolityModel): MarriageModel {
  const mm = newModel(pm);
  hook(sim, mm);
  return mm;
}

/** 接着推(resumeCiv,在 resumeRegency 之后):结过的亲由史事推出来 */
export function resumeMarriage(sim: CivSim, civ: Civ): void {
  const pm = polityModelOf(sim);
  if (!pm || !warModelOf(sim) || !diplomacyModelOf(sim)) return;
  const mm = newModel(pm);
  for (const m of matchesFrom(mm.cx, civ.annals)) add(mm, m);
  hook(sim, mm);
}

function hook(sim: CivSim, mm: MarriageModel): void {
  models.set(sim, mm);
  const { pm } = mm;
  const wm = warModelOf(sim)!;
  const dm = diplomacyModelOf(sim);
  const owner = sim.owners[Layer.Polity];
  const alive = (p: number) => p >= 0 && pm.polities[p]?.ended === undefined;
  const fighting = (p: number, q: number) => wm.active.some((w) => (w.a === p && w.b === q) || (w.a === q && w.b === p));
  /** p、q 在 t0 以后开过战(战争按宣战先后排) */
  const fought = (p: number, q: number) => (t0: Year) => {
    for (let i = wm.wars.length - 1; i >= 0; i--) {
      const w = wm.wars[i];
      if (!(w.start > t0)) break;
      if ((w.a === p && w.b === q) || (w.a === q && w.b === p)) return true;
    }
    return false;
  };
  const bond = (p: number, q: number, t: Year) => bondOf(mm.pair.get(kinKey(p, q)), t, fought(p, q));
  const married = (p: number, born: Year) => mm.groom.has(`${p}:${born}`);
  /** 君主 r(国家 p)的母亲出自哪国(她是联姻嫁来的;不是 = −1) */
  const mothers = new WeakMap<Reign, number>();
  const motherOf = (p: number, r: Reign): number => {
    const hit = mothers.get(r);
    if (hit !== undefined) return hit;
    let out = -1;
    const P = pm.polities[p];
    const f = r.k > 0 ? bookOf(pm, p, r.from)[r.k - 1] : undefined;
    if (f && !r.crown && !r.seize && !f.crown && f.dynasty === r.dynasty && r.from === f.natural && broodOf(pm.rbase, pm.rtag[p], f, P).heir === reignBorn(r)) {
      const fb = reignBorn(f);
      out = lastMatch(mm.groom.get(`${p}:${fb}`), p, fb, reignBorn(r))?.b ?? -1;
    }
    mothers.set(r, out);
    return out;
  };

  /** 国家 p 此刻娶亲的人:未成婚的成年太子 → 年轻的在位君主 → 别的成年宗室;没有 = null */
  const groomOf = (p: number, t: Year): { code: number; born: Year } | null => {
    const P = pm.polities[p];
    if (!P || !royalAt(P, t)) return null;
    const r = rulerOf(pm, p, t);
    if (r.crown) return null;
    const ok = (born: Year) => t - born >= GROOM_AGE[0] && t - born <= GROOM_AGE[1] && !married(p, born);
    const br = broodOf(pm.rbase, pm.rtag[p], r, P);
    if (br.heir !== undefined && ok(br.heir)) return { code: r.k * 16, born: br.heir };
    const self = reignBorn(r);
    if (t - self <= YOUNG_RULER && ok(self)) return { code: r.k * 16 + GROOM_SELF, born: self };
    // 别的宗室:先君晚年引兵入朝过的,他那时的兄弟被杀过一轮,不挑
    if (pm.regents.get(p)?.some((g) => g.kind === 'march' && g.k === r.k)) return null;
    let best: { s: number; born: Year } | null = null;
    for (const x of br.extra) if (x.life > t && ok(x.born) && (!best || x.born < best.born)) best = x;
    return best ? { code: r.k * 16 + best.s, born: best.born } : null;
  };
  /** 国家 q 此刻在位的君主有女儿可嫁 */
  const brideOk = (q: number, t: Year): boolean => {
    const Q = pm.polities[q];
    if (!Q || !royalAt(Q, t)) return false;
    return t - reignBorn(rulerOf(pm, q, t)) >= BRIDE_FATHER;
  };
  const note = (p: number, q: number, g: { code: number; born: Year }, t: Year, war = -1) => {
    const sid = capitalAt(pm.polities[p], t);
    sim.record('marry', { a: p, b: q, region: pm.settlements[sid]?.region ?? -1, settlement: sid, war, n: g.code });
    add(mm, { t, a: p, b: q, born: g.born, code: g.code, war, annal: sim.annalCount - 1 });
  };

  // ---- 看邦交时结亲 ----
  if (dm) {
    dm.bond = bond;
    dm.marry = (p: number, k: number, t: Year) => {
      const P = pm.polities[p];
      if (!P || !royalAt(P, t)) return;
      const g = groomOf(p, t);
      if (!g) return;
      const near = new Set<number>(dm.neighborsOf?.(p) ?? []);
      for (const z of dm.alliesOf(p)) near.add(z);
      const L = dm.liegeOf(p);
      if (L >= 0) near.add(L);
      for (const v of dm.vassalsOf(p)) near.add(v);
      const cand = [...near].filter((q) => q !== p && alive(q) && !fighting(p, q) && bond(p, q, t) === 0 && brideOk(q, t)).sort((x, y) => x - y);
      if (!cand.length) return;
      const tag = pm.ptag[p];
      const q = cand[Math.min(cand.length - 1, Math.floor(keyed4(mm.base, tag, k, U_PICK, 0) * cand.length))];
      const odds = Math.min(MARRY_MAX, MARRY_PER * cand.length) + (dm.pactOf(p, q) ? MARRY_ALLY : 0);
      if (keyed4(mm.base, tag, k, U_MARRY, 0) >= odds) return;
      note(p, q, g, t);
      // 互嫁:对方的太子(没有就照样挑)娶这边的宗室女
      if (keyed4(mm.base, tag, k, U_MUTUAL, 0) < MUTUAL && brideOk(p, t)) {
        const h = groomOf(q, t);
        if (h) note(q, p, h, t);
      }
    };
  }

  // ---- 作者下令"为他联姻" ----
  /** 人物键对上的那位宗室(国家 p、t 那一刻):在位的君主本人,或同一朝先前各位君主的儿子(在世、成年;已经即过位的不算);对不上 = null */
  const ivGroom = (p: number, key: string, t: Year): { code: number; born: Year } | null => {
    const who = parsePersonKey(key);
    const P = pm.polities[p];
    if (!who || !P) return null;
    const r = rulerOf(pm, p, t);
    if (r.crown || t - who.born < GROOM_AGE[0]) return null;
    if (Math.round(reignBorn(r)) === who.born) return { code: r.k * 16 + GROOM_SELF, born: reignBorn(r) };
    const book = bookOf(pm, p, t);
    for (let k = r.k; k >= 0 && book[k] && book[k].dynasty === r.dynasty; k--) {
      if (book[k].crown) continue;
      const br = broodOf(pm.rbase, pm.rtag[p], book[k], P);
      // 预定的继承人:在位君主的;先前几位的(父亲被作者让他去世、让位,他没即位)也算,接着即了位的不算(他就是后来的君主)
      const hb = br.heir;
      if (hb !== undefined && Math.round(hb) === who.born && (k === r.k || Math.round(reignBorn(book[k + 1])) !== who.born)) return { code: k * 16, born: hb };
      const x = br.extra.find((e) => Math.round(e.born) === who.born);
      if (x) return x.life > t ? { code: k * 16 + x.s, born: x.born } : null;
    }
    return null;
  };
  mm.intervene = (v, _i, p, q, t, noteIv) => {
    if (!alive(p)) return noteIv(-3);
    if (q < 0 || q === p || !alive(q)) return noteIv(IV_NO_PARTNER);
    if (!royalAt(pm.polities[p], t) || !royalAt(pm.polities[q], t)) return noteIv(IV_NO_THRONE);
    if (fighting(p, q)) return noteIv(IV_AT_WAR);
    const me = ivGroom(p, v.person, t);
    if (!me) return noteIv(IV_NOT_HIM);
    const take = v.how !== 'give';
    const give = v.how === 'give' || v.how === 'mutual';
    if ((take && !brideOk(q, t)) || (give && !brideOk(p, t))) return noteIv(IV_NO_BRIDE);
    const other = give ? groomOf(q, t) : null;
    if (give && !other) return noteIv(IV_NO_GROOM);
    noteIv(-1);
    if (take) note(p, q, me, t);
    if (other) note(q, p, other, t);
  };

  // ---- 议和时以和亲作结 ----
  wm.onPeace = (w: War, t: Year) => {
    if (!alive(w.a) || !alive(w.b)) return;
    if (keyed4(mm.base, pm.ptag[w.a], pm.ptag[w.b], Math.round(w.start * 256), U_PEACE) >= PEACE_MATCH) return;
    let held = 0;
    for (const e of w.takes) if (e.by === w.a && owner[e.region] === w.a) held++;
    const [x, y] = held > 0 ? [w.a, w.b] : [w.b, w.a];
    const g = groomOf(x, t);
    if (!g || !brideOk(y, t)) return;
    note(x, y, g, t, w.id);
  };

  // ---- 宣战、背盟 ----
  wm.kin = (p: number, q: number, t: Year): number => {
    let f = 1;
    const b = bond(p, q, t);
    if (b > 0) f *= 1 - (1 - KIN_DECLARE) * b;
    if (motherOf(p, rulerOf(pm, p, t)) === q) f *= UNCLE_DECLARE;
    return f;
  };
  wm.kinBetray = (p: number, q: number, t: Year): number => 1 - (1 - KIN_BETRAY) * bond(p, q, t);
}

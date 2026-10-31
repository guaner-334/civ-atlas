/**
 * 照故事找世界:一个种子推一遍、逐种配法量数(后台线程 src/finderWorker.ts 里一次跑一个种子;Node 里也能跑)。
 * 纯计算,不碰 DOM。条件、判定、排序在 query.ts。
 *
 * 一个种子:照新建世界生成地图、推历史(和新建世界一模一样,只是推到够用就停:开场最晚那年 + 条件要看的年数,见 finderPlan),
 * 再在候选开场年份(每 YEAR_STEP 年一个;有"跟着某国进某时代"的,那国进时代前那几年每 ERA_YEAR_STEP 年再看一个)里、
 * 每种配法(故事里每国对上哪一国)逐条量数。配法这样挑:第一国任一国;和已经配上的某国有接壤、隘口条件的,只在那国的邻国里挑;
 * 有打仗、占地、比海拔条件的,在那国两层邻国里挑;都没有的,在已经配上的几国两层邻国里挑(故事里的国家离得不远)。
 * 量完按 relaxVariants 的每一种门槛各留最合的一种配法,再留几种别的国家组合("换一种配法"),只交回这几种的数,不留整个世界。
 */
import { generateWorld, type World } from '../world';
import { DEFAULT_PARAMS } from '../params';
import { DEFAULT_CIV_PARAMS, generateCiv } from '../civ';
import { ownersAt } from '../civ/engine/timeline';
import { developmentAt, eraLevel, eraOf } from '../civ/development';
import { capitalAt, polityName, portAt } from '../civ/growth';
import { crossings, measureCrossings, mergeCrossings, type Crossings, type PassMeasure } from '../civ/passes';
import { buildChronicle, entryInvolves, MAJOR, type ChronicleEntry } from '../civ/story/chronicle';
import { AdjKind, type Civ } from '../civ/types';
import {
  ALT_KEEP,
  DEFAULT_START,
  ERA_YEAR_STEP,
  YEAR_STEP,
  condList,
  judgeCond,
  placesFor,
  relaxCond,
  relaxQuery,
  relaxVariants,
  type CondRef,
  type Fact,
  type FinderCand,
  type FinderCond,
  type FinderPlace,
  type FinderQuery,
  type FinderSetup,
  type FinderStoryLine,
  type FinderThumb,
  type SeedReport,
} from './query';

/** 后来怎样:每种配法最多挑几条 */
const STORY_KEEP = 8;
/** 没写故事讲多少年的,后来怎样看开场后这么多年 */
const STORY_YEARS = 100;

/** 这条条件管到开场后第几年 */
function reach(c: FinderCond): number {
  switch (c.kind) {
    case 'eraEnter':
      return c.max;
    case 'fate':
    case 'war':
    case 'conquer':
      return c.within;
    case 'span':
      return c.years;
    case 'junction':
      return 'lasting' in c ? (c.lasting ?? 0) : 0;
    case 'start':
      return 'from' in c ? 0 : c.max;
    default:
      return 0;
  }
}

/** 一次搜在哪几年里找开场、历史推到哪年 */
export interface FinderPlan {
  /** 开场年份在 from–to 里找(含放宽以后的范围) */
  from: number;
  to: number;
  /** 历史推到这一年(开场最晚那年 + 条件要看的年数,不超过新建世界设的推演年数) */
  needEnd: number;
}

/** 这条条件至少要看到开场后第几年才可能合(撑多少年、进时代的最早那年) */
function needs(c: FinderCond): number {
  switch (c.kind) {
    case 'eraEnter':
      return Math.max(0, c.min);
    case 'span':
      return c.years;
    case 'junction':
      return 'lasting' in c ? (c.lasting ?? 0) : 0;
    case 'start':
      return 'from' in c ? 0 : Math.max(0, c.min);
    default:
      return 0;
  }
}

/**
 * 推到够用就停:开场最晚 to 年、条件最多要看开场后 h 年,就只推到 to + h。
 * 开场年份的范围、要看的年数都按放宽以后的条件算(推演年数不够时,放宽以后才合得上的开场年份也要量到;原来的门槛照样判它不合)
 */
export function finderPlan(q: FinderQuery, endYear: number = DEFAULT_CIV_PARAMS.endYear): FinderPlan {
  const all = condList(q);
  const loose = condList(relaxQuery(q, all.map((_, i) => i)));
  const h = Math.max(0, ...all.map((r) => reach(r.cond)), ...loose.map((r) => reach(r.cond)));
  let win: { from: number; to: number } = DEFAULT_START;
  for (const r of loose) if (r.cond.kind === 'start' && 'from' in r.cond) win = r.cond;
  const from = Math.max(0, Math.ceil(win.from));
  const to = Math.min(Math.floor(win.to), endYear - Math.max(0, ...loose.map((r) => needs(r.cond))));
  return { from, to, needEnd: Math.max(0, Math.min(endYear, to + h)) };
}

// ---------------------------------------------------------------------------
// 一个种子

/** 都用这张地图时,同一个线程里记着上一张(只换文明种子,不用每个种子再生成一遍地图) */
let fixedWorld: { key: string; world: World } | null = null;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 推一个种子、量完。出错不往外抛:交回一份带 error 的(这个种子算没找到) */
export function searchSeed(q: FinderQuery, setup: FinderSetup, seed: number): SeedReport {
  return searchSeedWith(q, setup, seed).report;
}

/** 同 searchSeed,另外交出推好的世界和历史(后台线程拿来把列表里的小图画成手绘地图;出错了 = 没有) */
export function searchSeedWith(q: FinderQuery, setup: FinderSetup, seed: number): { report: SeedReport; world?: World; civ?: Civ } {
  const t0 = now();
  try {
    const plan = finderPlan(q, setup.civ?.endYear ?? DEFAULT_CIV_PARAMS.endYear);
    let world: World;
    if (setup.map === 'fixed') {
      const key = JSON.stringify([setup.world, setup.terrain ?? null, setup.sketch ?? null]);
      if (fixedWorld?.key !== key) fixedWorld = { key, world: generateWorld({ ...DEFAULT_PARAMS, ...setup.world }, undefined, setup.terrain, setup.sketch) };
      world = fixedWorld.world;
    } else {
      world = generateWorld({ ...DEFAULT_PARAMS, ...setup.world, seed });
    }
    const civ = generateCiv(world, { ...setup.civ, endYear: plan.needEnd, ...(setup.map === 'fixed' ? { civSeed: seed } : {}) });
    return { report: { seed, ...searchCiv(q, world, civ, plan), ms: Math.round(now() - t0) }, world, civ };
  } catch (e) {
    return { report: { ...emptyReport(q, seed), ms: Math.round(now() - t0), error: e instanceof Error ? e.message : String(e) } };
  }
}

function emptyReport(q: FinderQuery, seed: number): SeedReport {
  return { seed, ms: 0, viable: false, tried: 0, cands: [], best: relaxVariants(q).map(() => -1), alts: [] };
}

// ---------------------------------------------------------------------------
// 某一年的样子

interface YearStats {
  Y: number;
  own: Int16Array;
  /** 国家 → 几州 */
  size: Int32Array;
  /** 那年有地的国家(编号升序) */
  alive: number[];
  /** 国家 → 陆上接壤的国家(升序) */
  nb: number[][];
  /** 国家 → 那年的州 */
  regionsOf: number[][];
  /** 国家 → 陆上边界总长、其中隔着山的 */
  border: Float64Array;
  mtn: Float64Array;
  /** 国家 → 平均海拔(按州面积) */
  elev: Float64Array;
  /** 两国共同边界长(键 = 小编号 × P + 大编号) */
  pair: Map<number, number>;
  /** 国家 → 连着航线的港口城几座 */
  ports: Int32Array;
  /** 国家 → 国都那州的时代(没算 = 空) */
  era: Int8Array | null;
  /** 交界用:州 → 它和陆上邻州分属的几家(CSR);国家 → 哪几州的这几家里有它 */
  touch: { start: Int32Array; list: Int16Array } | null;
  touchedBy: number[][] | null;
  /** 两层邻国(按需算) */
  hop2: Map<number, number[]>;
}

/**
 * 一个推完的世界里按一套条件逐种配法量数(searchSeed 的后一半;测试直接拿推好的世界用)。
 * onCand:每量完一种配法叫一次(测试拿来逐种对照;不给 = 不叫)
 */
export function searchCiv(
  q: FinderQuery,
  world: World,
  civ: Civ,
  plan: FinderPlan = finderPlan(q, civ.endYear),
  onCand?: (year: number, roles: readonly number[], facts: readonly Fact[]) => void,
): Omit<SeedReport, 'seed' | 'ms'> {
  const list = condList(q);
  const n = list.length;
  const variants = relaxVariants(q);
  const V = variants.length;
  const empty = (): Omit<SeedReport, 'seed' | 'ms'> => ({ viable: civ.viable, tried: 0, cands: [], best: variants.map(() => -1), alts: [] });
  const P = civ.polities.length;
  if (!civ.viable || !P) return empty();

  const reg = civ.regions;
  const R = reg.count;
  const roles = q.roles.length;
  const needEnd = Math.min(plan.needEnd, civ.endYear);
  const relaxed = list.map((r) => relaxCond(r.cond));
  const vmask = variants.map((w) => {
    const m = new Uint8Array(n);
    for (const i of w) m[i] = 1;
    return m;
  });
  const has = (k: FinderCond['kind']) => list.some((r) => r.cond.kind === k);
  const needEra = list.some((r) => r.cond.kind === 'era' || (r.cond.kind === 'start' && 'role' in r.cond && r.cond.era !== undefined));
  const needTouch = has('junction');
  const needPorts = has('ports');

  // ---- 不随年份变的 ----
  // 陆上相邻(不算海峡、航线)的州:CSR;陆上的边(a < b)
  const landStart = new Int32Array(R + 1);
  const landAdj: number[] = [];
  const edges: number[] = []; // a, b, kind, border 四个一组
  const seaLinked = new Uint8Array(R);
  for (let a = 0; a < R; a++) {
    for (let k = reg.adjStart[a]; k < reg.adjStart[a + 1]; k++) {
      const b = reg.adj[k];
      const kind = reg.adjKind[k];
      if (kind === AdjKind.SeaRoute || kind === AdjKind.Strait) {
        seaLinked[a] = 1;
        continue;
      }
      landAdj.push(b);
      if (b > a) edges.push(a, b, kind, reg.adjBorder[k]);
    }
    landStart[a + 1] = landAdj.length;
  }
  const seatX = new Float64Array(R);
  const seatY = new Float64Array(R);
  for (let r = 0; r < R; r++) {
    seatX[r] = world.mesh.x[reg.seat[r]];
    seatY[r] = world.mesh.y[reg.seat[r]];
  }
  const W = world.width;
  const dist2 = (cx: number, cy: number, r: number) => {
    let dx = Math.abs(seatX[r] - cx);
    if (dx > W / 2) dx = W - dx;
    const dy = seatY[r] - cy;
    return dx * dx + dy * dy;
  };

  // 进时代:国家 × 时代 → 第一次进的年份
  const enterAt = new Map<number, number>();
  for (const e of civ.development?.events ?? []) {
    if (e.kind !== 'enter' || e.polity < 0) continue;
    const key = e.polity * 16 + e.era;
    const was = enterAt.get(key);
    if (was === undefined || e.year < was) enterAt.set(key, e.year);
  }
  const enter = (p: number, era: number) => enterAt.get(p * 16 + era) ?? null;

  // 编年史里的事:两国之间打仗、攻占;一国亡、分裂、改朝
  const wars = new Map<number, number[]>();
  /** 攻占:攻方 × P + 守方 → [年份, 州] 按年份 */
  const takes = new Map<number, [number, number][]>();
  const fates = { fall: new Map<number, number[]>(), split: new Map<number, number[]>(), dynasty: new Map<number, number[]>() };
  const push = (m: Map<number, number[]>, k: number, y: number) => {
    const l = m.get(k);
    if (l) l.push(y);
    else m.set(k, [y]);
  };
  for (const e of civ.annals ?? []) {
    if ((e.kind === 'war' || e.kind === 'battle') && e.a >= 0 && e.b >= 0 && e.a !== e.b) push(wars, Math.min(e.a, e.b) * P + Math.max(e.a, e.b), e.year);
    else if (e.kind === 'conquer' && e.a >= 0 && e.b >= 0) {
      const k = e.a * P + e.b;
      const l = takes.get(k);
      if (l) l.push([e.year, e.region]);
      else takes.set(k, [[e.year, e.region]]);
    }
    else if ((e.kind === 'split' || e.kind === 'revolt') && e.b >= 0) push(fates.split, e.b, e.year);
    else if (e.kind === 'collapse' && e.a >= 0) push(fates.split, e.a, e.year);
    else if (e.kind === 'dynasty' && e.a >= 0) push(fates.dynasty, e.a, e.year);
  }
  civ.polities.forEach((p, i) => {
    if (p.ended !== undefined) push(fates.fall, i, p.ended);
  });
  for (const m of [wars, fates.fall, fates.split, fates.dynasty]) for (const l of m.values()) l.sort((a, b) => a - b);
  for (const l of takes.values()) l.sort((a, b) => a[0] - b[0]);
  /** 开场(含)以后第一件的年数;没有 = null */
  const firstAfter = (l: number[] | undefined, Y: number): number | null => {
    if (!l) return null;
    for (const t of l) if (t >= Y && t <= needEnd) return t - Y;
    return null;
  };
  const survive = (p: number, Y: number) => Math.min(civ.polities[p].ended ?? Infinity, needEnd) - Y;

  // 州与州之间的交界(隘口用;passes.ts 的量法),按州对缓存;两国之间的按两边的州对缓存
  const crossCache = new Map<number, Crossings>();
  const crossOf = (key: number): Crossings => {
    let c = crossCache.get(key);
    if (!c) {
      const a = Math.floor(key / R);
      const b = key - a * R;
      c = crossings(world, reg.cells.subarray(reg.cellStart[a], reg.cellStart[a + 1]), (j) => reg.of[j] === b);
      crossCache.set(key, c);
    }
    return c;
  };
  const passCache = new Map<string, PassMeasure | null>();

  // ---- 某一年 ----
  const devBuf: { lv?: Float32Array } = {};
  const yearStats = (Y: number): YearStats => {
    const own = ownersAt(civ, Y).polity;
    const size = new Int32Array(P);
    const regionsOf: number[][] = Array.from({ length: P }, () => []);
    const eSum = new Float64Array(P);
    const aSum = new Float64Array(P);
    for (let r = 0; r < R; r++) {
      const p = own[r];
      if (p < 0) continue;
      size[p]++;
      regionsOf[p].push(r);
      eSum[p] += reg.elevation[r] * reg.area[r];
      aSum[p] += reg.area[r];
    }
    const alive: number[] = [];
    const elev = new Float64Array(P);
    for (let p = 0; p < P; p++) {
      if (!size[p]) continue;
      alive.push(p);
      elev[p] = aSum[p] > 0 ? eSum[p] / aSum[p] : 0;
    }
    const nb: number[][] = Array.from({ length: P }, () => []);
    const border = new Float64Array(P);
    const mtn = new Float64Array(P);
    const pair = new Map<number, number>();
    for (let k = 0; k < edges.length; k += 4) {
      const p = own[edges[k]];
      const o = own[edges[k + 1]];
      if (p === o) continue;
      const len = edges[k + 3];
      const hill = edges[k + 2] === AdjKind.Mountain;
      for (const x of [p, o]) {
        if (x < 0) continue;
        border[x] += len;
        if (hill) mtn[x] += len;
      }
      if (p < 0 || o < 0) continue;
      if (!nb[p].includes(o)) nb[p].push(o);
      if (!nb[o].includes(p)) nb[o].push(p);
      const key = Math.min(p, o) * P + Math.max(p, o);
      pair.set(key, (pair.get(key) ?? 0) + len);
    }
    for (const l of nb) l.sort((a, b) => a - b);
    const ports = new Int32Array(P);
    if (needPorts)
      for (const s of civ.settlements) {
        if (s.founded > Y || (s.ended !== undefined && s.ended <= Y) || !seaLinked[s.region] || !portAt(s, Y)) continue;
        const p = own[s.region];
        if (p >= 0) ports[p]++;
      }
    let era: Int8Array | null = null;
    if (needEra && civ.development) {
      const lv = (devBuf.lv = developmentAt(civ.development, Y, devBuf.lv));
      era = new Int8Array(P).fill(-1);
      for (const p of alive) era[p] = eraOf(eraLevel(lv, civ.settlements[capitalAt(civ.polities[p], Y)].region)).era;
    }
    let touch: YearStats['touch'] = null;
    let touchedBy: number[][] | null = null;
    if (needTouch) {
      const start = new Int32Array(R + 1);
      const tl: number[] = [];
      touchedBy = Array.from({ length: P }, () => []);
      for (let r = 0; r < R; r++) {
        const s0 = tl.length;
        const add = (x: number) => {
          if (x < 0) return;
          for (let i = s0; i < tl.length; i++) if (tl[i] === x) return;
          tl.push(x);
        };
        add(own[r]);
        for (let k = landStart[r]; k < landStart[r + 1]; k++) add(own[landAdj[k]]);
        start[r + 1] = tl.length;
        for (let i = s0; i < tl.length; i++) touchedBy[tl[i]].push(r);
      }
      touch = { start, list: Int16Array.from(tl) };
    }
    return { Y, own, size, alive, nb, regionsOf, border, mtn, elev, pair, ports, era, touch, touchedBy, hop2: new Map() };
  };
  const hop2Of = (st: YearStats, x: number): number[] => {
    let l = st.hop2.get(x);
    if (!l) {
      const s = new Set<number>(st.nb[x]);
      for (const y of st.nb[x]) for (const z of st.nb[y]) s.add(z);
      s.delete(x);
      l = [...s].sort((a, b) => a - b);
      st.hop2.set(x, l);
    }
    return l;
  };

  /** 两国交界上的口子(passes.ts 的量法;两国不接壤、交界太短 = null) */
  const passBetween = (st: YearStats, p: number, o: number): PassMeasure | null => {
    const [a, b] = st.size[p] <= st.size[o] ? [p, o] : [o, p];
    const keys: number[] = [];
    for (const r of st.regionsOf[a])
      for (let k = landStart[r]; k < landStart[r + 1]; k++) {
        const q2 = landAdj[k];
        if (st.own[q2] === b) keys.push(r < q2 ? r * R + q2 : q2 * R + r);
      }
    if (!keys.length) return null;
    keys.sort((x, y) => x - y);
    const ck = keys.join(',');
    if (passCache.has(ck)) return passCache.get(ck)!;
    const m = measureCrossings(mergeCrossings(keys.map(crossOf)));
    passCache.set(ck, m);
    return m;
  };

  // ---- 交界 ----
  const mark = new Int32Array(P);
  let stampN = 0;
  const seen = new Int32Array(R);
  let seenN = 0;
  /**
   * 交界:own = 那州要归谁(−1 = 不管);数 tuple 和它们的邻国(故事里没有国家时数所有国家),lasting = 只数撑过这么多年的。
   * 返回 [挨着最多几国, 那州, 无主的州里最多几国, 那州];同样多的先挑无主的,再挑离 anchor(地块;−1 = 不管)近的
   */
  const junction = (st: YearStats, tuple: readonly number[], lasting: number, own: number, anchor: number): number[] => {
    const stamp = ++stampN;
    const ok = (x: number) => !lasting || survive(x, st.Y) >= lasting;
    if (tuple.length) {
      for (const p of tuple) {
        if (ok(p)) mark[p] = stamp;
        for (const x of st.nb[p]) if (ok(x)) mark[x] = stamp;
      }
    } else for (const p of st.alive) if (ok(p)) mark[p] = stamp;
    const ax = anchor >= 0 ? world.mesh.x[anchor] : 0;
    const ay = anchor >= 0 ? world.mesh.y[anchor] : 0;
    let bA = 0;
    let rA = -1;
    let dA = Infinity;
    let fA = false;
    let bF = 0;
    let rF = -1;
    let dF = Infinity;
    const { start, list: tl } = st.touch!;
    const visit = (r: number) => {
      let c = 0;
      for (let i = start[r]; i < start[r + 1]; i++) if (mark[tl[i]] === stamp) c++;
      if (!c) return;
      const free = st.own[r] < 0;
      if (c > bA || (c === bA && (free && !fA ? true : free === fA && anchor >= 0 && dist2(ax, ay, r) < dA))) {
        bA = c;
        rA = r;
        fA = free;
        dA = anchor >= 0 ? dist2(ax, ay, r) : Infinity;
      }
      if (free && (c > bF || (c === bF && anchor >= 0 && dist2(ax, ay, r) < dF))) {
        bF = c;
        rF = r;
        dF = anchor >= 0 ? dist2(ax, ay, r) : Infinity;
      }
    };
    if (own >= 0) for (const r of st.regionsOf[own]) visit(r);
    else if (!tuple.length) for (let r = 0; r < R; r++) visit(r);
    else {
      const sn = ++seenN;
      for (let p = 0; p < P; p++) {
        if (mark[p] !== stamp) continue;
        for (const r of st.touchedBy![p]) if (seen[r] !== sn) (seen[r] = sn), visit(r);
      }
    }
    return own >= 0 ? [bA, rA] : [bA, rA, bF, rF];
  };

  // ---- 一种配法逐条量 ----
  const capCell = (p: number, Y: number) => civ.settlements[capitalAt(civ.polities[p], Y)].cell;
  const measure = (ref: CondRef, st: YearStats, tuple: readonly number[], facts: Fact[]): Fact => {
    const c = ref.cond;
    const Y = st.Y;
    const p = ref.role >= 0 ? tuple[ref.role] : -1;
    const other = 'other' in c && c.other >= 0 && c.other < roles && c.other !== ref.role ? tuple[c.other] : -1;
    switch (c.kind) {
      case 'size': {
        let om = 0;
        tuple.forEach((x, i) => {
          if (i !== ref.role) om = Math.max(om, st.size[x]);
        });
        let nm = 0;
        for (const x of st.nb[p]) nm = Math.max(nm, st.size[x]);
        return [st.size[p], om, nm];
      }
      case 'neighbors':
        return [st.nb[p].length];
      case 'ports':
        return [st.ports[p]];
      case 'age':
        return [Y - civ.polities[p].founded];
      case 'era':
        return [st.era?.[p] ?? null];
      case 'eraEnter': {
        const t = enter(p, c.era);
        return [t === null ? null : t - Y];
      }
      case 'fate': {
        let best: number | null = null;
        for (const w of c.what) {
          const d = firstAfter(fates[w]?.get(p), Y);
          if (d !== null && (best === null || d < best)) best = d;
        }
        return [best];
      }
      case 'mountain':
        return [st.border[p] > 0 ? st.mtn[p] / st.border[p] : 0];
      case 'elevation':
        return [st.elev[p]];
      case 'higher':
        return other < 0 ? null : [st.elev[p] - st.elev[other]];
      case 'border':
        return other < 0 ? null : [st.pair.get(Math.min(p, other) * P + Math.max(p, other)) ?? 0];
      case 'pass': {
        if (other < 0) return null;
        const m = passBetween(st, p, other);
        return m ? [m.height, m.ridge, m.narrow, m.pairs, m.cell] : null;
      }
      case 'war':
        return other < 0 ? null : [firstAfter(wars.get(Math.min(p, other) * P + Math.max(p, other)), Y)];
      case 'conquer': {
        if (other < 0) return null;
        // 每州只算开场以后第一次被占(同一州丢了又夺回来不重复算)
        const seenR = new Set<number>();
        const out: number[] = [];
        for (const [t, r] of takes.get(c.dir === 'took' ? p * P + other : other * P + p) ?? []) {
          if (t < Y || t > needEnd || seenR.has(r)) continue;
          seenR.add(r);
          out.push(t - Y);
        }
        return out;
      }
      case 'junction': {
        // 同样多的,挑离隘口近的(没有隘口条件 = 离第一国的国都近的)
        let anchor = -1;
        for (let i = 0; i < list.length && anchor < 0; i++) if (list[i].cond.kind === 'pass' && facts[i]) anchor = facts[i]![4] ?? -1;
        if (anchor < 0 && tuple.length) anchor = capCell(tuple[0], Y);
        return junction(st, tuple, 'lasting' in c ? (c.lasting ?? 0) : 0, ref.role >= 0 ? p : -1, anchor);
      }
      case 'span': {
        if (!tuple.length) return null;
        let m = Infinity;
        for (const x of tuple) m = Math.min(m, survive(x, Y));
        return [m];
      }
      case 'start': {
        if ('from' in c) return [Y];
        const x = c.role >= 0 && c.role < roles ? tuple[c.role] : -1;
        if (x < 0) return null;
        const t = enter(x, c.enter);
        return [st.era?.[x] ?? null, t === null ? null : t - Y];
      }
    }
  };

  // ---- 候选开场年份 ----
  const years = new Set<number>();
  for (let y = Math.ceil(plan.from / YEAR_STEP) * YEAR_STEP; y <= plan.to; y += YEAR_STEP) years.add(y);
  /** 跟着某国进某时代的:年份 → [第几国, 那国] */
  const fixedAt = new Map<number, [number, number][]>();
  const loose = condList(relaxQuery(q, list.map((_, i) => i)));
  loose.forEach((r) => {
    const c = r.cond;
    let role = -1;
    let era = -1;
    let lo = 0;
    let hi = 0;
    if (c.kind === 'eraEnter') [role, era, lo, hi] = [r.role, c.era, c.min, c.max];
    else if (c.kind === 'start' && 'role' in c) [role, era, lo, hi] = [c.role, c.enter, c.min, c.max];
    if (role < 0 || role >= roles) return;
    for (let p = 0; p < P; p++) {
      const t = enter(p, era);
      if (t === null) continue;
      for (let y = Math.ceil((t - hi) / ERA_YEAR_STEP) * ERA_YEAR_STEP; y <= t - lo; y += ERA_YEAR_STEP) {
        if (y < plan.from || y > plan.to || years.has(y)) continue;
        const l = fixedAt.get(y);
        if (l) l.push([role, p]);
        else fixedAt.set(y, [[role, p]]);
      }
    }
  });
  const allYears = [...new Set([...years, ...fixedAt.keys()])].sort((a, b) => a - b);

  // ---- 配法的先后:和已经配上的有关系的先配 ----
  const land: boolean[][] = Array.from({ length: roles }, () => Array(roles).fill(false));
  const any: boolean[][] = Array.from({ length: roles }, () => Array(roles).fill(false));
  q.roles.forEach((r, i) =>
    r.conds.forEach((c) => {
      if (!('other' in c) || c.other < 0 || c.other >= roles || c.other === i) return;
      any[i][c.other] = any[c.other][i] = true;
      if (c.kind === 'border' || c.kind === 'pass') land[i][c.other] = land[c.other][i] = true;
    }),
  );
  const order: number[] = [];
  while (order.length < roles) {
    let next = -1;
    for (let i = 0; i < roles && next < 0; i++) if (!order.includes(i) && order.some((j) => any[i][j])) next = i;
    for (let i = 0; i < roles && next < 0; i++) if (!order.includes(i)) next = i;
    order.push(next);
  }
  /** 第 k 个要配的国家能是哪几国 */
  const choices = (st: YearStats, k: number, tuple: number[]): number[] => {
    if (k === 0) return st.alive;
    const me = order[k];
    const placed = order.slice(0, k);
    const l = placed.find((j) => land[me][j]);
    if (l !== undefined) return st.nb[tuple[l]];
    const a = placed.find((j) => any[me][j]);
    if (a !== undefined) return hop2Of(st, tuple[a]);
    const s = new Set<number>();
    for (const j of placed) for (const x of hop2Of(st, tuple[j])) s.add(x);
    return [...s].sort((x, y) => x - y);
  };

  // ---- 逐种配法量、判、留 ----
  interface Rec {
    year: number;
    roles: number[];
    facts: Fact[];
    sizes: number[];
  }
  interface Best {
    misses: number;
    score: number;
    rec: Rec;
  }
  const best: (Best | null)[] = Array(V).fill(null);
  const byTuple = new Map<string, Best>();
  const okB = new Uint8Array(n);
  const okR = new Uint8Array(n);
  const qB = new Float64Array(n);
  const qR = new Float64Array(n);
  let tried = 0;
  /** 先于 b:差得少、合得好、开场早、国家编号小(和 query.ts 的 rankCompare 一样) */
  const before = (m: number, s: number, Y: number, tuple: readonly number[], b: Best | null) => {
    if (!b) return true;
    if (m !== b.misses) return m < b.misses;
    if (s !== b.score) return s > b.score;
    if (Y !== b.rec.year) return Y < b.rec.year;
    for (let i = 0; i < tuple.length; i++) if (tuple[i] !== b.rec.roles[i]) return tuple[i] < b.rec.roles[i];
    return false;
  };
  const junctionLast = list.map((r, i) => i).sort((a, b) => Number(list[a].cond.kind === 'junction') - Number(list[b].cond.kind === 'junction'));
  const tryTuple = (st: YearStats, tuple: number[]) => {
    tried++;
    const facts: Fact[] = Array(n).fill(null);
    for (const i of junctionLast) facts[i] = measure(list[i], st, tuple, facts);
    onCand?.(st.Y, tuple, facts);
    for (let i = 0; i < n; i++) {
      const b = judgeCond(list[i].cond, facts[i]);
      okB[i] = b.ok ? 1 : 0;
      qB[i] = b.quality;
      const rc = relaxed[i];
      const r = rc ? judgeCond(rc, facts[i]) : b;
      okR[i] = r.ok ? 1 : 0;
      qR[i] = r.quality;
    }
    let rec: Rec | null = null;
    const make = () => (rec ??= { year: st.Y, roles: tuple.slice(), facts, sizes: tuple.map((p) => st.size[p]) });
    for (let v = 0; v < V; v++) {
      const m = vmask[v];
      let misses = 0;
      let score = 0;
      // 和 query.ts 的 judge 一样按条加(合的加合得多好,不合的减差得多远),浮点数逐位一样
      for (let i = 0; i < n; i++) {
        score += m[i] ? qR[i] : qB[i];
        if (!(m[i] ? okR[i] : okB[i])) misses++;
      }
      if (before(misses, score, st.Y, tuple, best[v])) best[v] = { misses, score, rec: make() };
      if (v === 0 && misses <= 1 && roles) {
        const key = tuple.join(',');
        const was = byTuple.get(key) ?? null;
        if (before(misses, score, st.Y, tuple, was)) byTuple.set(key, { misses, score, rec: make() });
      }
    }
  };
  const tuple: number[] = Array(roles).fill(-1);
  const walk = (st: YearStats, k: number, fixRole: number, fixP: number, done: Set<string> | null) => {
    if (k === roles) {
      if (done) {
        const key = tuple.join(',');
        if (done.has(key)) return;
        done.add(key);
      }
      tryTuple(st, tuple);
      return;
    }
    const me = order[k];
    for (const p of choices(st, k, tuple)) {
      if (me === fixRole && p !== fixP) continue;
      let used = false;
      for (let j = 0; j < k; j++) if (tuple[order[j]] === p) used = true;
      if (used) continue;
      tuple[me] = p;
      walk(st, k + 1, fixRole, fixP, done);
    }
    tuple[me] = -1;
  };
  for (const Y of allYears) {
    const st = yearStats(Y);
    if (years.has(Y)) walk(st, 0, -1, -1, null);
    else {
      const done = new Set<string>();
      for (const [role, p] of fixedAt.get(Y) ?? []) if (st.size[p] > 0) walk(st, 0, role, p, done);
    }
  }

  // ---- 留下的几种配法:各种门槛下最合的 + 换一种配法 ----
  const cands: FinderCand[] = [];
  const index = new Map<Rec, number>();
  const keep = (r: Rec) => {
    let i = index.get(r);
    if (i === undefined) {
      i = cands.length;
      index.set(r, i);
      cands.push({ year: r.year, roles: r.roles, names: [], sizes: r.sizes, facts: r.facts, capitals: [], places: [], story: [] });
    }
    return i;
  };
  const bestIdx = best.map((b) => (b ? keep(b.rec) : -1));
  const top = best[0];
  const alts = [...byTuple.values()]
    .filter((b) => !top || b.rec.roles.join(',') !== top.rec.roles.join(','))
    .sort((a, b) => (before(a.misses, a.score, a.rec.year, a.rec.roles, b) ? -1 : 1))
    .slice(0, ALT_KEEP)
    .map((b) => keep(b.rec));

  // ---- 补上国名、国都、地方、后来怎样 ----
  const statsAt = new Map<number, YearStats>();
  let chronicle: ChronicleEntry[] | null = null;
  const nearIdx = new Set<number>();
  best.forEach((b, v) => {
    if (b && b.misses <= 1) nearIdx.add(bestIdx[v]);
  });
  const thumbIdx = new Set(nearIdx);
  for (const i of alts) nearIdx.add(i);
  const spanC = list.find((r) => r.cond.kind === 'span')?.cond as { years: number } | undefined;
  const lastingC = list.find((r) => r.cond.kind === 'junction' && 'lasting' in r.cond && r.cond.lasting)?.cond as { lasting: number } | undefined;
  const storyYears = spanC?.years ?? lastingC?.lasting ?? STORY_YEARS;
  cands.forEach((cd, ci) => {
    let st = statsAt.get(cd.year);
    if (!st) statsAt.set(cd.year, (st = yearStats(cd.year)));
    const Y = cd.year;
    cd.names = cd.roles.map((p) => polityName(civ.polities[p], Y));
    cd.capitals = cd.roles.map((p) => {
      const sid = capitalAt(civ.polities[p], Y);
      return { settlement: sid, cell: civ.settlements[sid].cell };
    });
    const places: FinderPlace[] = [];
    list.forEach((ref, i) => {
      const c = ref.cond;
      const f = cd.facts[i];
      if (c.kind === 'pass' && f) {
        const cell = f[4] ?? -1;
        if (cell >= 0) places.push({ cond: i, kind: 'pass', cell, region: reg.of[cell], polities: [cd.roles[ref.role], cd.roles[c.other]] });
      } else if (c.kind === 'junction' && f) {
        // 「一起」的交界两处都给:挨着最多国的州、无主的州里挨着最多国的(要不要无主看哪种门槛,query.ts 的 placesFor 挑)
        const spots: [number, boolean | undefined][] = f.length >= 4 ? [[f[1] ?? -1, false], [f[3] ?? -1, true]] : [[f[1] ?? -1, undefined]];
        for (const [region, free] of spots) {
          if (region < 0) continue;
          const ps: number[] = [];
          const add = (x: number) => x >= 0 && !ps.includes(x) && ps.push(x);
          add(st!.own[region]);
          for (let k = landStart[region]; k < landStart[region + 1]; k++) add(st!.own[landAdj[k]]);
          places.push({ cond: i, kind: 'junction', cell: reg.seat[region], region, polities: ps, ...(free === undefined ? {} : { free }) });
        }
      } else if (c.kind === 'ports' && ref.role >= 0) {
        // 离国都最近的一座连着航线的港口
        const p = cd.roles[ref.role];
        const cap = cd.capitals[ref.role].cell;
        let bestS = -1;
        let bestD = Infinity;
        for (const s of civ.settlements) {
          if (s.founded > Y || (s.ended !== undefined && s.ended <= Y) || st!.own[s.region] !== p || !seaLinked[s.region] || !portAt(s, Y)) continue;
          const d = dist2(world.mesh.x[cap], world.mesh.y[cap], s.region);
          if (d < bestD) (bestD = d), (bestS = s.id);
        }
        if (bestS >= 0) {
          const s = civ.settlements[bestS];
          places.push({ cond: i, kind: 'port', cell: s.cell, region: s.region, settlement: s.id, polities: [p] });
        }
      }
    });
    cd.places = places;
    // 列表里的小图:只给各种门槛下最合、差一条以内的那几种配法(列表上的行就是它们)
    if (thumbIdx.has(ci)) {
      // 故事里没有国家(只看交界):框住交界那州和碰头的几国
      const junc = cd.roles.length ? null : placesFor(q, cd).find((x) => x.kind === 'junction');
      cd.thumb = junc ? thumbOf(world, civ, st!.own, [{ cell: junc.cell }], junc.polities) : thumbOf(world, civ, st!.own, cd.capitals, cd.roles);
    }
    if (nearIdx.has(ci)) {
      chronicle ??= buildChronicle(civ);
      const who = cd.roles.length ? cd.roles : (placesFor(q, cd).find((x) => x.kind === 'junction')?.polities ?? []);
      cd.story = storyOf(chronicle, who, Y, Math.min(Y + storyYears, needEnd));
    }
  });

  return { viable: true, tried, cands, best: bestIdx, alts };
}

/** 小图多大(像素;4:3,整个世界的高度,宽度按它裁) */
export const THUMB_W = 96;
export const THUMB_H = 72;
/** 小图调色板里的前两种:海、没有国家的陆地(各国从第 2 个起) */
export const THUMB_SEA = 0;
export const THUMB_LAND = 1;
/** 小图的地形(FinderThumb.ter):海(湖)、平地、干地、丘陵、高山、冰雪 */
export const THUMB_TER = { sea: 0, green: 1, dry: 2, hills: 3, high: 4, snow: 5 } as const;

/** 一个地块在小图上的地形 */
function terOf(world: World, c: number): number {
  if (world.water[c] !== 0) return THUMB_TER.sea;
  if (world.temperature[c] < -8) return THUMB_TER.snow;
  const e = world.elevation[c];
  if (e > 2200) return THUMB_TER.high;
  if (e > 1000) return THUMB_TER.hills;
  return world.precipitation[c] < 450 ? THUMB_TER.dry : THUMB_TER.green;
}

/** 小图框住故事里各国的那一块再往外放多少(倍)、最小多大(占世界宽的几分之一) */
const THUMB_PAD = 1.7;
const THUMB_MIN = 1 / 7;

/**
 * 列表里的小图:开场那年的国家图(地形打底,各国一种颜色铺在上面),4:3,框住故事里各国那一年的疆土(往外放一些;
 * 故事里没有国家 = 交界那一带)。每个像素取离它最近的地块(按格子分桶找)。只交下标(国家、地形),界面上再上色
 */
function thumbOf(world: World, civ: Civ, own: Int16Array, capitals: readonly { cell: number }[], focus: readonly number[] = []): FinderThumb {
  const { x: X, y: Y, n } = world.mesh;
  const W = world.width;
  const H = world.height;
  const TW = THUMB_W;
  const TH = THUMB_H;
  const roles = new Set(focus);
  const seat = civ.regions.seat;
  // 要框住的点:故事里各国那年的州的治所;没有 = 国都 / 交界那州
  const pts: number[] = [];
  if (roles.size) for (let r = 0; r < own.length; r++) if (roles.has(own[r])) pts.push(seat[r]);
  if (!pts.length) for (const c of capitals) pts.push(c.cell);
  // 中心:按圆周平均(左右接着的世界);范围:离中心最远的那几个点
  let cx = W / 2;
  let cy = H / 2;
  if (pts.length) {
    let sx = 0;
    let sy = 0;
    let yy = 0;
    for (const c of pts) {
      const a = (X[c] / W) * Math.PI * 2;
      sx += Math.cos(a);
      sy += Math.sin(a);
      yy += Y[c];
    }
    cx = ((Math.atan2(sy, sx) / (Math.PI * 2) + 1) % 1) * W;
    cy = yy / pts.length;
  }
  const rel = (x: number) => {
    let d = (x - cx) % W;
    if (d > W / 2) d -= W;
    if (d < -W / 2) d += W;
    return d;
  };
  let hx = 0;
  let hy = 0;
  for (const c of pts) {
    hx = Math.max(hx, Math.abs(rel(X[c])));
    hy = Math.max(hy, Math.abs(Y[c] - cy));
  }
  // 窗口:宽高比 4:3,框住那几国再往外放一些;不小于世界宽的 1/7,不高过整个世界
  let ww = Math.max(W * THUMB_MIN, 2 * hx * THUMB_PAD, ((2 * hy * THUMB_PAD) * TW) / TH);
  let wh = (ww * TH) / TW;
  if (wh > H) {
    wh = H;
    ww = (H * TW) / TH;
  }
  const x0 = cx - ww / 2;
  const y0 = Math.max(0, Math.min(H - wh, cy - wh / 2));
  const at = (x: number) => (((x - x0) % W) + W) % W;
  // 窗口里的地块分桶(多留一圈,边上的像素也找得到最近的)
  const G = 24;
  const bw = ww / G;
  const bh = wh / G;
  const buckets: number[][] = Array.from({ length: G * G }, () => []);
  const pad = Math.max(bw, bh);
  for (let c = 0; c < n; c++) {
    const dx = at(X[c] + pad) - pad;
    const dy = Y[c] - y0;
    if (dx < -pad || dx >= ww + pad || dy < -pad || dy >= wh + pad) continue;
    const bi = Math.max(0, Math.min(G - 1, Math.floor(dx / bw)));
    const bj = Math.max(0, Math.min(G - 1, Math.floor(dy / bh)));
    buckets[bj * G + bi].push(c);
  }
  const cellAt = new Int32Array(TW * TH).fill(-1);
  for (let j = 0; j < TH; j++) {
    const py = ((j + 0.5) / TH) * wh;
    const bj = Math.min(G - 1, Math.floor(py / bh));
    for (let i = 0; i < TW; i++) {
      const px = ((i + 0.5) / TW) * ww;
      const bi = Math.min(G - 1, Math.floor(px / bw));
      let best = -1;
      let bd = Infinity;
      for (let r = 1; r <= 3 && best < 0; r++) {
        for (let v = Math.max(0, bj - r); v <= Math.min(G - 1, bj + r); v++)
          for (let u = Math.max(0, bi - r); u <= Math.min(G - 1, bi + r); u++)
            for (const c of buckets[v * G + u]) {
              const ddx = at(X[c] + pad) - pad - px;
              const ddy = Y[c] - y0 - py;
              const d = ddx * ddx + ddy * ddy;
              if (d < bd) (bd = d), (best = c);
            }
      }
      cellAt[j * TW + i] = best;
    }
  }
  const px = new Uint8Array(TW * TH);
  const ter = new Uint8Array(TW * TH);
  const pal: number[] = [0, 0];
  const slot = new Map<number, number>();
  const of = civ.regions.of;
  for (let k = 0; k < cellAt.length; k++) {
    const c = cellAt[k];
    if (c < 0) continue;
    ter[k] = terOf(world, c);
    if (world.water[c] !== 0) continue;
    const r = of[c];
    const p = r >= 0 ? own[r] : -1;
    let v = THUMB_LAND;
    if (p >= 0) {
      let s = slot.get(p);
      if (s === undefined && pal.length < 255) {
        const col = civ.polities[p].color;
        s = pal.length;
        pal.push((col[0] << 16) | (col[1] << 8) | col[2]);
        slot.set(p, s);
      }
      if (s !== undefined) v = s;
    }
    px[k] = v;
  }
  const dots: number[] = [];
  for (const c of capitals) dots.push(Math.round((at(X[c.cell]) / ww) * TW * 10) / 10, Math.round(((Y[c.cell] - y0) / wh) * TH * 10) / 10);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { w: TW, h: TH, pal, px, ter, dots, win: [r1(x0), r1(y0), r1(ww), r1(wh)] };
}

/** 后来怎样:开场到 until 年里,故事里两国以上一起出现的事优先,其次各国自己的大事,再次各国别的事;最多 STORY_KEEP 条,按年份 */
function storyOf(entries: readonly ChronicleEntry[], who: readonly number[], from: number, until: number): FinderStoryLine[] {
  const picked: { e: ChronicleEntry; pri: number }[] = [];
  for (const e of entries) {
    if (e.year < from || e.year > until) continue;
    let k = 0;
    for (const p of who) if (entryInvolves(e, p)) k++;
    const pri = k >= 2 ? 3 : k === 1 ? (e.importance >= MAJOR ? 2 : 1) : 0;
    if (pri) picked.push({ e, pri });
  }
  return picked
    .sort((a, b) => b.pri - a.pri || a.e.year - b.e.year)
    .slice(0, STORY_KEEP)
    .sort((a, b) => a.e.year - b.e.year)
    .map(({ e }) => ({ year: Math.floor(e.year), tag: e.tag, text: e.text, polities: e.polities.slice(), regions: e.regions.slice() }));
}

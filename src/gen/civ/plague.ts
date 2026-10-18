/**
 * 瘟疫:偶尔从一座大城或港口起疫,一年年沿相邻的州、海峡和航线传开,染疫的城人口骤降,几十年慢慢长回来。
 * 挂在同一个推演引擎(sim.ts)上;不改归属,只改城镇表(Settlement.sacks,cause = plague)、记史事 plague。
 *
 * 流程(index.ts 在 installUnrest 之后调用 installPlague):
 *
 *   **起疫**(Ev.PlagueCheck,每 PLAGUE_EVERY 年看一次,每段里随机一个时刻):上一场起疫不到 GAP 年的不看;
 *     人口至少 ORIGIN_MIN、属于某国的城各掷一次(按州的治所取随机数,改了别处的地形这里照旧),人口越多越容易,港口再 × PORT_W;
 *     掷中了的(一般至多一座)里挑掷得最险的那座起疫。世上大城越多,瘟疫越频繁。起疫的是港口、它的主人能远洋时,GREAT_ODDS 的几率是大瘟疫
 *     (像黑死病,循着航线传遍几块大陆:传得更开、毒力衰得更慢)。
 *
 *   **传开**(Ev.PlagueStep,起疫那一刻算第 0 年,之后每年一次):上一年刚染疫的州往相邻的州传(这一场已经染过的不再染,
 *     没有城的州没有人烟、传不过去)。每一对州传不传开各掷一次:几率 = SPREAD(大瘟疫 GREAT_SPREAD)× 毒力 × 边的难易(KIND)
 *     × 人烟(染疫的那城人口不到 DENSE 的按比例降)。毒力每过一年 × DECAY(大瘟疫 × GREAT_DECAY,衰得慢);航线只有起点那州的主人能远洋、两头都是港口时才走。
 *     某一年一州也没传开、或传满 MAX_YEARS(大瘟疫 GREAT_YEARS)年,这一场就过去了。
 *
 *   **死人**:染疫的城人口掉一截(LOSS,大瘟疫 GREAT_LOSS 里随机;大城、港口人挤,再多死一些,见 lossOf),
 *     记进 Settlement.sacks(cause = plague;和洗劫一样之后慢慢长回来;乡下跟着折损,见 growth.ts 的 RURAL_PLAGUE)。
 *     国力(wars.ts 按城的人口算)随之下降,仗打不动;染疫的州多了国家更动荡(unrest.ts 的 PLAGUE_W)。
 *     每一年一国治下染疫的几州记一条史事 plague(部落地带不记;war 列 = 第几场瘟疫,大瘟疫 cause = great)。
 *
 * **不存内存状态**:正在传的那一场由史事和城镇表重建(resumePlague):同一时刻只有一场瘟疫在传(见 GAP),
 * 起疫那年以后、cause = plague 的折损就是这一场染疫的州,最后一年的那几州接着往外传。
 * 随机数:keyed(subSeed(seed, 'civ-plague'), 第几场 / 州的治所…, 用途),和处理顺序无关。纯计算,不碰 DOM。
 */
import type { World } from '../world';
import { AdjKind, Layer, type Civ, type Year } from './types';
import { keyed, keyed4, subSeed } from './rand';
import { Ev, quantize, type CivSim } from './sim';
import { polityModelOf, sailsOcean, type PolityModel } from './polities';
import { unrestModelOf } from './unrest';
import { populationAt } from './growth';

// ---- 调参(以 20 个种子的统计为准) ----
/** 看疫情:第一次在哪一年,之后每隔多少年 */
const PLAGUE_FIRST = 0;
const PLAGUE_EVERY = 30;
/** 起疫:人口至少 ORIGIN_MIN(千人)的城每次各掷一次,几率 = 人口 ÷ ORIGIN_NORM(港口再 × PORT_W) */
const ORIGIN_MIN = 25;
const ORIGIN_NORM = 30000;
const PORT_W = 2;
/** 大瘟疫的几率(起疫时掷;只有起疫的是港口、它的主人能远洋时才会是大瘟疫:循着航线传遍几块大陆) */
const GREAT_ODDS = 0.3;
/** 传开:一州一年传给相邻一州的几率 = SPREAD × 毒力 × KIND[边] × 人烟 */
const SPREAD = 0.8;
const GREAT_SPREAD = 1.5;
/** 边的难易:平地、跨河(沿河舟楫往来,更容易)、翻山、海峡、航线 */
const KIND: readonly number[] = [1, 1.15, 0.35, 0.6, 0.8];
/** 毒力每过一年乘上的数 */
const DECAY = 0.8;
const GREAT_DECAY = 0.95;
/** 染疫的那州人口(千人,城加乡下)不到 DENSE 的,传出去的几率按比例降(最低 DENSE_MIN) */
const DENSE = 12;
const DENSE_MIN = 0.25;
/** 最多传几年 */
const MAX_YEARS = 10;
const GREAT_YEARS = 24;
/** 上一场起疫后这么多年内不再起疫(比最长的传得久,两场不会同时在传;只看起疫的年份,改了别处的地形这里照旧) */
const GAP = GREAT_YEARS + 2;
/** 死几成:一般 LOSS、大瘟疫 GREAT_LOSS 里随机,再按城的大小、港口加减(lossOf) */
const LOSS: readonly [number, number] = [0.08, 0.2];
const GREAT_LOSS: readonly [number, number] = [0.24, 0.38];

// 随机数用途编号
const U_T = 1;
const U_ORIGIN = 3;
const U_GREAT = 4;
const U_SPREAD = 5;
const U_LOSS = 6;

// ---------------------------------------------------------------------------
// 模型

/** 正在传的那一场瘟疫 */
interface Outbreak {
  /** 第几场(起疫那次看疫情的编号) */
  k: number;
  /** 起疫的时刻 */
  t0: Year;
  great: boolean;
  /** 这一场染过的州 */
  hit: Uint8Array;
  /** 上一年刚染疫的州(按州号排) */
  front: number[];
}

export interface PlagueModel {
  pm: PolityModel;
  base: number;
  /** 正在传的那一场;没有 = null */
  now: Outbreak | null;
  /** 上一场起疫的时刻(没有 = −Infinity) */
  last: Year;
}

const models = new WeakMap<CivSim, PlagueModel>();

/** 推演引擎上挂着的瘟疫模型(测试、统计用) */
export function plagueModelOf(sim: CivSim): PlagueModel | undefined {
  return models.get(sim);
}

/** 第 k 次看疫情的时刻 */
function checkTime(base: number, k: number): number {
  return PLAGUE_FIRST + PLAGUE_EVERY * (k + 0.2 + 0.6 * keyed(base, k, 0, U_T));
}

/** 染疫的城死几成:基数随机;人口过 ORIGIN_MIN 的大城人挤死得多(最多 × 1.25),港口再 × 1.1;不超过 0.5 */
function lossOf(base: number, k: number, tag: number, great: boolean, pop: number, port: boolean): number {
  const [a, b] = great ? GREAT_LOSS : LOSS;
  let x = a + (b - a) * keyed4(base, k, tag, 0, U_LOSS);
  x *= 0.85 + 0.4 * Math.min(1, pop / (4 * ORIGIN_MIN));
  if (port) x *= 1.1;
  return Math.round(Math.min(0.5, x) * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// 挂到推演引擎上

/** 登记瘟疫的事件处理(installUnrest 之后调用),预约第一次看疫情 */
export function installPlague(sim: CivSim, pm: PolityModel, seed: number): PlagueModel {
  const pl: PlagueModel = { pm, base: subSeed(seed, 'civ-plague'), now: null, last: -Infinity };
  hook(sim, pl);
  sim.schedule(checkTime(pl.base, 0), Ev.PlagueCheck, 0, 0);
  return pl;
}

function hook(sim: CivSim, pl: PlagueModel): void {
  models.set(sim, pl);
  const { pm, base } = pl;
  const reg = pm.terrain.regions;
  const R = pm.terrain.R;
  const culture = sim.owners[Layer.Culture];
  const owner = sim.owners[Layer.Polity];
  const um = unrestModelOf(sim);

  /** 州 r 此刻有人烟的城(没有 = −1) */
  const cityNow = (r: number, t: number): number => {
    const sid = pm.cityOf[r];
    if (sid < 0 || culture[r] < 0) return -1;
    const s = pm.settlements[sid];
    return s.ended === undefined && t >= s.founded ? sid : -1;
  };

  /** 这一年染上疫的几州:各城记折损;一国一条史事 */
  const infect = (ob: Outbreak, list: number[], t: number): void => {
    const per = new Map<number, [number, number][]>();
    for (const r of list) {
      ob.hit[r] = 1;
      const sid = pm.cityOf[r];
      const s = pm.settlements[sid];
      const loss = lossOf(base, ob.k, reg.seat[r], ob.great, populationAt(s, t), !!pm.port[r]);
      (s.sacks ??= []).push({ year: t, loss, cause: 'plague' });
      const p = owner[r];
      if (p < 0) continue;
      let l = per.get(p);
      if (!l) per.set(p, (l = []));
      l.push([r, loss]);
    }
    // 起疫的那一国排第一条(第一年只有它),别的按国家号
    for (const p of [...per.keys()].sort((a, b) => a - b)) {
      const l = per.get(p)!;
      let worst = l[0];
      for (const x of l) if (x[1] > worst[1] || (x[1] === worst[1] && x[0] < worst[0])) worst = x;
      sim.record('plague', { a: p, b: l.length, region: worst[0], settlement: pm.cityOf[worst[0]], war: ob.k, ...(ob.great ? { cause: 'great' as const } : {}) });
      if (um) {
        let ul = um.plagues.get(p);
        if (!ul) um.plagues.set(p, (ul = []));
        ul.push({ year: t, n: l.length });
      }
    }
    ob.front = list;
  };

  /** 接着传:这一年(起疫后第 g 年)还传不传;传就预约 */
  const next = (ob: Outbreak, g: number): void => {
    if (ob.front.length && g < (ob.great ? GREAT_YEARS : MAX_YEARS)) sim.schedule(ob.t0 + g + 1, Ev.PlagueStep, ob.k, g + 1);
    else pl.now = null;
  };

  // ---- 起疫 ----
  sim.on(Ev.PlagueCheck, (k, _b, t) => {
    sim.schedule(checkTime(base, k + 1), Ev.PlagueCheck, k + 1, 0);
    if (t - pl.last < GAP) return;
    // 各城各掷各的:随机数 < 分量 ÷ ORIGIN_NORM 算掷中;掷中的里挑 随机数 ÷ 分量 最小的
    let r0 = -1;
    let best = Infinity;
    for (let r = 0; r < R; r++) {
      if (owner[r] < 0) continue;
      const sid = cityNow(r, t);
      if (sid < 0) continue;
      const pop = populationAt(pm.settlements[sid], t);
      if (!(pop >= ORIGIN_MIN)) continue;
      const w = pop * (pm.port[r] ? PORT_W : 1);
      const u = keyed4(base, k, reg.seat[r], 0, U_ORIGIN);
      if (u * ORIGIN_NORM >= w) continue;
      const score = u / w;
      if (score < best) {
        best = score;
        r0 = r;
      }
    }
    if (r0 < 0) return;
    const sail = !!pm.port[r0] && sailsOcean(pm, pm.polities[owner[r0]], t);
    const ob: Outbreak = { k, t0: t, great: sail && keyed(base, k, 1, U_GREAT) < GREAT_ODDS, hit: new Uint8Array(R), front: [] };
    pl.now = ob;
    pl.last = t;
    infect(ob, [r0], t);
    next(ob, 0);
  });

  // ---- 传开 ----
  sim.on(Ev.PlagueStep, (k, g, t) => {
    const ob = pl.now;
    if (!ob || ob.k !== k) return;
    const vir = ob.great ? GREAT_SPREAD * GREAT_DECAY ** g : SPREAD * DECAY ** g;
    const add: number[] = [];
    for (const r of ob.front) {
      // 染上以后城毁了的:乡下还有人,照常往外传(按没人烟算,传得慢)
      const sid = pm.cityOf[r];
      const pop = sid >= 0 ? populationAt(pm.settlements[sid], t) : 0;
      const dense = Math.max(DENSE_MIN, Math.min(1, pop / DENSE));
      const p = owner[r];
      const sail = p >= 0 && !!pm.port[r] && sailsOcean(pm, pm.polities[p], t);
      for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
        const j = reg.adj[e];
        if (j >= R || ob.hit[j]) continue;
        const kind = reg.adjKind[e];
        if (kind === AdjKind.SeaRoute && (!sail || !pm.port[j])) continue;
        if (cityNow(j, t) < 0) continue;
        if (keyed4(base, k, reg.seat[r], reg.seat[j], U_SPREAD) >= vir * (KIND[kind] ?? 1) * dense) continue;
        ob.hit[j] = 1;
        add.push(j);
      }
    }
    add.sort((a, b) => a - b);
    if (add.length) infect(ob, add, t);
    else ob.front = [];
    next(ob, g);
  });
}

/**
 * 由 Civ 重建瘟疫的推演状态(CivSim.fromCiv 调用,在 resumeUnrest 之后):
 * 最后一场瘟疫(史事 plague 的 war 列)还在传的话,从城镇表里 cause = plague 的折损找回它染过的州和最后一年染上的几州;
 * 再算出下一次看疫情,补进引擎。
 */
export function resumePlague(sim: CivSim, _world: World, civ: Civ): void {
  const pm = polityModelOf(sim);
  if (!pm) return;
  const pl: PlagueModel = { pm, base: subSeed(civ.seed, 'civ-plague'), now: null, last: -Infinity };
  const A = civ.annals;
  let last = -1;
  for (let i = A.length - 1; i >= 0; i--) {
    if (A[i].kind === 'plague') {
      last = A[i].war;
      break;
    }
  }
  hook(sim, pl);
  if (last >= 0) {
    const first = A.find((e) => e.kind === 'plague' && e.war === last)!;
    const t0 = first.year;
    pl.last = t0;
    const great = first.cause === 'great';
    const R = pm.terrain.R;
    const hit = new Uint8Array(R);
    // 起疫后第几年(已经过去的最后一年)
    const g = Math.floor(sim.now - t0 + 1e-9);
    const front: number[] = [];
    for (const s of pm.settlements) {
      if (!s.sacks) continue;
      for (const x of s.sacks) {
        if (x.cause !== 'plague' || x.year < t0 || x.year > sim.now) continue;
        hit[s.region] = 1;
        if (x.year === t0 + g) front.push(s.region);
      }
    }
    front.sort((a, b) => a - b);
    if (front.length && g < (great ? GREAT_YEARS : MAX_YEARS)) {
      pl.now = { k: last, t0, great, hit, front };
      sim.schedule(t0 + g + 1, Ev.PlagueStep, last, g + 1);
    }
  }
  let k = 0;
  while (quantize(checkTime(pl.base, k)) <= sim.now) k++;
  sim.schedule(checkTime(pl.base, k), Ev.PlagueCheck, k, 0);
}

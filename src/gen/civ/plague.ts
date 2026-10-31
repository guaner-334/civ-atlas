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
 * **作者下的瘟疫**(干预"天灾"的瘟疫,disaster.ts 调用 PlagueModel.strike):从指定的城起疫,这一场是第 PLAGUE_IV + 干预下标 场,
 *   起疫那城死 IV_LOSS[轻重],之后照上面的规矩传开(毒力 × IV_SPREAD[轻重],传到的城死 IV_LOSS × 0.6–1);不会是大瘟疫。
 *   那年已有一场在传:不另起,那城并进正在传的那一场(这一年染上 / 再染一次,死 IV_LOSS[轻重]),下一年跟着往外传。
 *   这一刻起 GAP 年内不再自己起疫(和自己起疫一样)。
 *
 * **全球大疫**(pandemic.ts 调用 PlagueModel.pandemic:作者下的、大纲里写的,或「天灾」多 / 很多时自己发生的):从指定的城起,
 *   正在传的那一场到此为止(并进全球大疫);一年往外传 PAN_HOPS 圈、毒力几乎不衰(PAN_SPREAD、PAN_DECAY),最多传 PAN_YEARS 年:
 *   小城也传得开(人烟最低 PAN_DENSE_MIN),隔着一州没人住的荒漠、深山循商路过得去(× PAN_CROSS),航线两头有一头的主人能远洋就走;
 *   远洋商船:去年染上的能远洋的港口越多,别处的港口这一年越容易染上(PAN_SHIP);各州有 PAN_SPARE 的几率这一场躲过去;
 *   染疫的城死 PAN_LOSS[轻重](大城、港口再多 PAN_CROWD,越往后传死得越少,一城最多 PAN_LOSS_MAX);
 *   折损带 until = 凋敝结束那年(无人收拾,之前不长回来);史事 plague 的 cause = pandemic。凋敝里不自己起疫(PlagueModel.quiet)。
 * **「天灾」多 / 很多**(calamity.ts 的 CalamityRates):起疫的几率、大瘟疫的几率、死几成照表加(平常照旧,不走这些分支)。
 *
 * **不存内存状态**:正在传的那一场由史事和城镇表重建(resumePlague):同一时刻只有一场瘟疫在传(见 GAP),
 * 起疫那年以后、cause = plague 的折损就是这一场染疫的州,最后一年的那几州接着往外传
 * (作者并进来的那几州按史事 intervene 认:并进来以后还没传过一年的接着往外传,同一刻刚传过的不算)。
 * 随机数:keyed(subSeed(seed, 'civ-plague'), 第几场 / 州的治所…, 用途),和处理顺序无关。纯计算,不碰 DOM。
 */
import type { World } from '../world';
import { AdjKind, Layer, type Civ, type Year } from './types';
import { fpow, keyed, keyed4, subSeed } from './rand';
import { Ev, quantize, type CivSim } from './sim';
import { polityModelOf, sailsOcean, type PolityModel } from './polities';
import { unrestModelOf } from './unrest';
import { populationAt } from './growth';
import {
  IV_LOSS,
  PANDEMIC_K,
  PAN_CROWD,
  PAN_CROWD_POP,
  PAN_LOSS,
  PAN_LOSS_MAX,
  PLAGUE_IV,
  PLAGUE_LOSS_CAP,
  calamityRates,
  naturalPandemic,
  pandemicBase,
  type CalamityRates,
} from './calamity';
import type { DisasterLevel, Intervention } from '../edits';

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

/** 作者下的瘟疫:传开的几率倍数(轻 / 中 / 重) */
const IV_SPREAD: readonly number[] = [0, 0.7, 1, 1.3];

/** 全球大疫:传开的几率(同 SPREAD,再按边的难易、人烟折算)、毒力每年乘上的数、一年往外传几圈、最多传几年 */
const PAN_SPREAD = 1;
const PAN_DECAY = 0.97;
const PAN_HOPS = 6;
export const PAN_YEARS = 8;
/** 全球大疫:染疫的州人烟再稀,传出去的几率最低也按这么多算 */
const PAN_DENSE_MIN = 0.6;
/** 全球大疫:隔着一州没人住的地方(荒漠、深山)循商路传过去,几率再打这个折 */
const PAN_CROSS = 0.5;
/** 全球大疫:远洋商船把疫带到别处港口 —— 去年染上的能远洋的港口每有一座,别处每个港口这一年多 PAN_SHIP 的几率染上(最多算 PAN_SHIP_MAX 座) */
const PAN_SHIP = 0.015;
const PAN_SHIP_MAX = 30;
/** 全球大疫:各州有这么多的几率这一场躲过去(闭门自守、隔绝往来;孤岛、深山、部落地带另外还有传不到的) */
const PAN_SPARE = 0.1;
/** 全球大疫越往后传死得越少:起疫后每过一年少几成(最多算 PAN_FADE_YEARS 年) */
const PAN_FADE = 0.02;
const PAN_FADE_YEARS = 10;

// 随机数用途编号
const U_T = 1;
const U_ORIGIN = 3;
const U_GREAT = 4;
const U_SPREAD = 5;
const U_LOSS = 6;
/** 全球大疫传开、隔着没人住的州传过去:U_PAN_SPREAD / U_PAN_CROSS + 16 × 起疫后第几年 */
const U_PAN_SPREAD = 7;
const U_PAN_CROSS = 8;
const U_PAN_SHIP = 9;
const U_PAN_SPARE = 10;

// ---------------------------------------------------------------------------
// 模型

/** 正在传的那一场瘟疫 */
interface Outbreak {
  /** 第几场(起疫那次看疫情的编号) */
  k: number;
  /** 起疫的时刻 */
  t0: Year;
  great: boolean;
  /** 作者下的瘟疫、全球大疫的轻重(1–3;自己起的一般瘟疫 = 0) */
  level: number;
  /** 全球大疫:凋敝结束那年(染疫的折损带这个 until);不是全球大疫 = 不给 */
  pan?: Year;
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
  /**
   * 作者下的瘟疫(干预"天灾",第 iv 条):从州 r 的城起疫;那年已有一场在传就并进那一场。
   * 返回 1 = 起了一场新的,2 = 并进了正在传的那一场(hook 时挂上)
   */
  strike?: (r: number, level: DisasterLevel, iv: number, t: Year) => 1 | 2;
  /**
   * 全球大疫(pandemic.ts 调用):从州 r 的城起第 k 场(轻重 level,凋敝到 end)。正在传的那一场到此为止,并进这一场(hook 时挂上)
   */
  pandemic?: (r: number, level: number, k: number, end: Year, t: Year) => void;
  /** 此刻不自己起疫(全球大疫的凋敝里;pandemic.ts 挂上) */
  quiet?: (t: Year) => boolean;
  /** 全球大疫染上一州(pandemic.ts 挂上,记进它的状态) */
  onPandemicHit?: (k: number, r: number, sid: number, t: Year, loss: number) => void;
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

/** 作者下的瘟疫传到的城死几成:IV_LOSS[轻重] × 0.6–1(随机),不超过 0.5 */
function ivLossOf(base: number, k: number, tag: number, level: number): number {
  const x = IV_LOSS[level] * (0.6 + 0.4 * keyed4(base, k, tag, 0, U_LOSS));
  return Math.round(Math.min(0.5, x) * 1000) / 1000;
}

/**
 * 染疫的城死几成:基数随机;人口过 ORIGIN_MIN 的大城人挤死得多(最多 × 1.25),港口再 × 1.1;不超过 0.5。
 * 「天灾」多 / 很多(rate):再 × CalamityRates.plagueLoss,不超过 PLAGUE_LOSS_CAP
 */
function lossOf(base: number, k: number, tag: number, great: boolean, pop: number, port: boolean, rate: CalamityRates | null): number {
  const [a, b] = great ? GREAT_LOSS : LOSS;
  let x = a + (b - a) * keyed4(base, k, tag, 0, U_LOSS);
  x *= 0.85 + 0.4 * Math.min(1, pop / (4 * ORIGIN_MIN));
  if (port) x *= 1.1;
  if (rate) return Math.round(Math.min(PLAGUE_LOSS_CAP, x * rate.plagueLoss) * 1000) / 1000;
  return Math.round(Math.min(0.5, x) * 1000) / 1000;
}

/**
 * 全球大疫染上的城死几成:PAN_LOSS[轻重] × 0.85–1.15(随机);大城、港口人挤再多 PAN_CROWD;
 * 起疫后第 g 年染上的少 PAN_FADE × g(最多算 PAN_FADE_YEARS 年);一城最多 PAN_LOSS_MAX
 */
function panLossOf(base: number, k: number, tag: number, level: number, pop: number, port: boolean, g: number): number {
  let x = PAN_LOSS[level] * (0.85 + 0.3 * keyed4(base, k, tag, 0, U_LOSS));
  if (pop >= PAN_CROWD_POP || port) x += PAN_CROWD;
  x *= 1 - PAN_FADE * Math.min(PAN_FADE_YEARS, Math.max(0, g));
  return Math.round(Math.min(PAN_LOSS_MAX, x) * 1000) / 1000;
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
  /** 「天灾」多 / 很多的倍数(平常 = null:照旧的规则,不走这些分支) */
  const rate = calamityRates(sim.calamity);

  /** 州 r 此刻有人烟的城(没有 = −1) */
  const cityNow = (r: number, t: number): number => {
    const sid = pm.cityOf[r];
    if (sid < 0 || culture[r] < 0) return -1;
    const s = pm.settlements[sid];
    return s.ended === undefined && t >= s.founded ? sid : -1;
  };

  /** 这一年染上疫的几州:各城记折损(fixed = 作者下的,城里死这么多);一国一条史事 */
  const infect = (ob: Outbreak, list: number[], t: number, fixed?: number): void => {
    const per = new Map<number, [number, number][]>();
    for (const r of list) {
      ob.hit[r] = 1;
      const sid = pm.cityOf[r];
      const s = pm.settlements[sid];
      if (ob.pan !== undefined) {
        // 全球大疫:折损带凋敝结束那年(无人收拾,之前不长回来),记进全球大疫的状态
        const loss = fixed ?? panLossOf(base, ob.k, reg.seat[r], ob.level, populationAt(s, t), !!pm.port[r], Math.round(t - ob.t0));
        (s.sacks ??= []).push({ year: t, loss, cause: 'plague', until: ob.pan, pan: ob.k });
        pl.onPandemicHit?.(ob.k, r, sid, t, loss);
        const p = owner[r];
        if (p < 0) continue;
        let l = per.get(p);
        if (!l) per.set(p, (l = []));
        l.push([r, loss]);
        continue;
      }
      const loss =
        fixed ?? (ob.level ? ivLossOf(base, ob.k, reg.seat[r], ob.level) : lossOf(base, ob.k, reg.seat[r], ob.great, populationAt(s, t), !!pm.port[r], rate));
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
      const cause = ob.pan !== undefined ? { cause: 'pandemic' as const } : ob.great ? { cause: 'great' as const } : {};
      sim.record('plague', { a: p, b: l.length, region: worst[0], settlement: pm.cityOf[worst[0]], war: ob.k, ...cause });
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
    if (ob.front.length && g < maxYears(ob)) sim.schedule(ob.t0 + g + 1, Ev.PlagueStep, ob.k, g + 1);
    else pl.now = null;
  };

  // ---- 起疫 ----
  sim.on(Ev.PlagueCheck, (k, _b, t) => {
    sim.schedule(checkTime(base, k + 1), Ev.PlagueCheck, k + 1, 0);
    if (t - pl.last < GAP) return;
    // 全球大疫的凋敝里不自己起疫
    if (pl.quiet?.(t)) return;
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
      if (u * ORIGIN_NORM >= (rate ? w * rate.plague : w)) continue;
      const score = u / w;
      if (score < best) {
        best = score;
        r0 = r;
      }
    }
    if (r0 < 0) return;
    const sail = !!pm.port[r0] && sailsOcean(pm, pm.polities[owner[r0]], t);
    const ob: Outbreak = { k, t0: t, great: sail && keyed(base, k, 1, U_GREAT) < (rate ? rate.great : GREAT_ODDS), level: 0, hit: new Uint8Array(R), front: [] };
    pl.now = ob;
    pl.last = t;
    infect(ob, [r0], t);
    next(ob, 0);
  });

  /** 全球大疫这一场躲过去的州(闭门自守、隔绝往来;按州各掷一次,PAN_SPARE 的几率) */
  const spared = (ob: Outbreak, j: number): boolean => keyed4(base, ob.k, reg.seat[j], 0, U_PAN_SPARE) < PAN_SPARE;

  /** 这一场从州 r 往相邻的州传(毒力 vir;这一场染过的不再染),传到的记进 out、标进 ob.hit */
  const spreadFrom = (ob: Outbreak, r: number, vir: number, t: number, out: number[]): void => {
    // 染上以后城毁了的:乡下还有人,照常往外传(按没人烟算,传得慢)
    const sid = pm.cityOf[r];
    const pop = sid >= 0 ? populationAt(pm.settlements[sid], t) : 0;
    const p = owner[r];
    const sail = p >= 0 && !!pm.port[r] && sailsOcean(pm, pm.polities[p], t);
    if (ob.pan !== undefined) {
      // 全球大疫:小城也传得开(人烟最低算 PAN_DENSE_MIN);航线两头有一头的主人能远洋就有人走;每年各掷各的(g = 起疫后第几年)
      const dense = Math.max(PAN_DENSE_MIN, Math.min(1, pop / DENSE));
      const g = Math.round(t - ob.t0);
      for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
        const j = reg.adj[e];
        if (j >= R || ob.hit[j]) continue;
        const kind = reg.adjKind[e];
        if (kind === AdjKind.SeaRoute) {
          if (!pm.port[r] || !pm.port[j]) continue;
          const q = owner[j];
          if (!sail && !(q >= 0 && sailsOcean(pm, pm.polities[q], t))) continue;
        }
        if (culture[j] < 0 && kind !== AdjKind.SeaRoute) {
          // 隔着一州没人住的荒漠、深山:循商路过去(再打 PAN_CROSS 折)
          for (let f = reg.adjStart[j]; f < reg.adjStart[j + 1]; f++) {
            const m = reg.adj[f];
            const k2 = reg.adjKind[f];
            if (m >= R || m === r || ob.hit[m] || k2 === AdjKind.SeaRoute || cityNow(m, t) < 0 || spared(ob, m)) continue;
            if (keyed4(base, ob.k, reg.seat[r], reg.seat[m], U_PAN_CROSS + 16 * g) >= vir * (KIND[kind] ?? 1) * (KIND[k2] ?? 1) * dense * PAN_CROSS) continue;
            ob.hit[m] = 1;
            out.push(m);
          }
          continue;
        }
        if (cityNow(j, t) < 0 || spared(ob, j)) continue;
        if (keyed4(base, ob.k, reg.seat[r], reg.seat[j], U_PAN_SPREAD + 16 * g) >= vir * (KIND[kind] ?? 1) * dense) continue;
        ob.hit[j] = 1;
        out.push(j);
      }
      return;
    }
    const dense = Math.max(DENSE_MIN, Math.min(1, pop / DENSE));
    for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
      const j = reg.adj[e];
      if (j >= R || ob.hit[j]) continue;
      const kind = reg.adjKind[e];
      if (kind === AdjKind.SeaRoute && (!sail || !pm.port[j])) continue;
      if (cityNow(j, t) < 0) continue;
      if (keyed4(base, ob.k, reg.seat[r], reg.seat[j], U_SPREAD) >= vir * (KIND[kind] ?? 1) * dense) continue;
      ob.hit[j] = 1;
      out.push(j);
    }
  };

  // ---- 传开 ----
  sim.on(Ev.PlagueStep, (k, g, t) => {
    const ob = pl.now;
    if (!ob || ob.k !== k) return;
    const add: number[] = [];
    if (ob.pan !== undefined) {
      // 全球大疫:一年往外传 PAN_HOPS 圈(这一年刚染上的接着往外传),毒力几乎不衰
      const vir = PAN_SPREAD * fpow(PAN_DECAY, g);
      // 远洋商船:去年染上的港口里,主人能远洋的有几座;别处的港口(这一场没染过的)各掷一次,船越多越容易染上
      let ships = 0;
      for (const r of ob.front) if (pm.port[r] && owner[r] >= 0 && sailsOcean(pm, pm.polities[owner[r]], t)) ships++;
      if (ships) {
        const odds = (1 - fpow(1 - PAN_SHIP, Math.min(ships, PAN_SHIP_MAX))) * fpow(PAN_DECAY, g);
        for (let j = 0; j < R; j++) {
          if (ob.hit[j] || !pm.port[j] || cityNow(j, t) < 0 || spared(ob, j)) continue;
          if (keyed4(base, ob.k, reg.seat[j], 0, U_PAN_SHIP + 16 * g) >= odds) continue;
          ob.hit[j] = 1;
          add.push(j);
        }
      }
      let front = ob.front;
      for (let h = 0; h < PAN_HOPS && front.length; h++) {
        const got: number[] = [];
        for (const r of front) spreadFrom(ob, r, vir, t, got);
        got.sort((a, b) => a - b);
        for (const j of got) add.push(j);
        front = got;
      }
    } else {
      const vir = ob.great ? GREAT_SPREAD * GREAT_DECAY ** g : SPREAD * (ob.level ? IV_SPREAD[ob.level] : 1) * DECAY ** g;
      for (const r of ob.front) spreadFrom(ob, r, vir, t, add);
    }
    add.sort((a, b) => a - b);
    if (add.length) infect(ob, add, t);
    else ob.front = [];
    next(ob, g);
  });

  // ---- 作者下的瘟疫 ----
  pl.strike = (r, level, iv, t) => {
    const loss = IV_LOSS[level];
    const ob = pl.now;
    if (ob) {
      // 并进正在传的那一场:这城这一年染上(染过的再染一次),下一年跟着往外传
      const front = ob.front;
      infect(ob, [r], t, loss);
      ob.front = front.includes(r) ? front : [...front, r].sort((a, b) => a - b);
      return 2;
    }
    const k = PLAGUE_IV + iv;
    const nb: Outbreak = { k, t0: t, great: false, level, hit: new Uint8Array(R), front: [] };
    pl.now = nb;
    pl.last = t;
    infect(nb, [r], t, loss);
    next(nb, 0);
    return 1;
  };

  // ---- 全球大疫 ----
  pl.pandemic = (r, level, k, end, t) => {
    // 正在传的那一场到此为止(它预约的下一年对不上 pl.now,丢掉)
    const ob: Outbreak = { k, t0: t, great: false, level, pan: end, hit: new Uint8Array(R), front: [] };
    pl.now = ob;
    pl.last = t;
    infect(ob, [r], t);
    next(ob, 0);
  };
}

/** 一场瘟疫最多传几年 */
function maxYears(ob: { great: boolean; pan?: Year }): number {
  return ob.pan !== undefined ? PAN_YEARS : ob.great ? GREAT_YEARS : MAX_YEARS;
}

/**
 * 由 Civ 重建瘟疫的推演状态(resumeCiv 调用,在 resumeUnrest 之后):
 * 最后一场瘟疫(史事 plague 的 war 列)还在传的话,从城镇表里 cause = plague 的折损找回它染过的州和最后一年染上的几州;
 * 再算出下一次看疫情,补进引擎。
 */
export function resumePlague(sim: CivSim, _world: World, civ: Civ, list: readonly Intervention[] = civ.interventions ?? []): void {
  const pm = polityModelOf(sim);
  if (!pm) return;
  const pl: PlagueModel = { pm, base: subSeed(civ.seed, 'civ-plague'), now: null, last: -Infinity };
  const A = civ.annals;
  // 最后一场:史事 plague 的最后一条是第几场;作者下的(起疫那城可能在部落地带,没有 plague 那一条)按史事 intervene(b = 1:起了一场新的)认。
  // 两场不会同时在传,起得晚的就是最后一场
  let last = -1;
  let t0 = -Infinity;
  for (let i = A.length - 1; i >= 0; i--) {
    if (A[i].kind === 'plague') {
      last = A[i].war;
      break;
    }
  }
  const ivStart = (k: number) => A.find((e) => e.kind === 'intervene' && e.war === k - PLAGUE_IV && e.b === 1)?.year;
  if (last >= PLAGUE_IV) t0 = ivStart(last) ?? -Infinity;
  else if (last >= 0) t0 = A.find((e) => e.kind === 'plague' && e.war === last)!.year;
  for (let i = A.length - 1; i >= 0; i--) {
    const e = A[i];
    if (e.kind !== 'intervene' || e.b !== 1 || e.year <= t0) continue;
    const w = list[e.war];
    if (w?.kind !== 'disaster' || w.type !== 'plague') continue;
    last = PLAGUE_IV + e.war;
    t0 = e.year;
    break;
  }
  // 全球大疫(史事 pandemic,pandemic.ts):起得不比上面找到的那一场早,最后一场就是它(起疫时正在传的那一场到此为止)
  let pan: Year | undefined;
  let panLevel = 0;
  for (let i = A.length - 1; i >= 0; i--) {
    const e = A[i];
    if (e.kind !== 'pandemic') continue;
    if (e.year >= t0) {
      last = e.war;
      t0 = e.year;
      pan = e.year + e.b;
      const v = e.war < PANDEMIC_K ? list[e.war - PLAGUE_IV] : undefined;
      panLevel = v?.kind === 'disaster' ? v.level : civ.calamity ? naturalPandemic(pandemicBase(civ.seed), civ.calamity, e.war - PANDEMIC_K).level : 2;
    }
    break;
  }
  hook(sim, pl);
  if (last >= 0 && t0 > -Infinity) {
    pl.last = t0;
    const great = pan === undefined && last < PLAGUE_IV && A.find((e) => e.kind === 'plague' && e.war === last)?.cause === 'great';
    // 作者下的那一场:轻重照那条干预
    const v = pan === undefined && last >= PLAGUE_IV ? list[last - PLAGUE_IV] : undefined;
    const level = pan !== undefined ? panLevel : v?.kind === 'disaster' ? v.level : last >= PLAGUE_IV ? 2 : 0;
    const R = pm.terrain.R;
    const hit = new Uint8Array(R);
    // 起疫后第几年(已经过去的最后一年)
    const g = Math.floor(sim.now - t0 + 1e-9);
    // 作者并进来的州(年份、州):最后一次传开(第 g 年那一刻)以后并进来的接着往外传 —— 同一刻的传开排在干预前面(sim.ts 的 earlyOrder),
    // 正好在那一刻并进来的也算;更早并进来的,那一刻传开时已经传过了
    const merged = new Set<string>();
    for (const e of A) {
      if (e.kind !== 'intervene' || e.year < t0 || e.year > sim.now || e.b !== 2) continue;
      const w = list[e.war];
      if (w?.kind === 'disaster' && w.type === 'plague') merged.add(`${e.year}:${e.region}`);
    }
    const front = new Set<number>();
    for (const s of pm.settlements) {
      if (!s.sacks) continue;
      for (const x of s.sacks) {
        if (x.cause !== 'plague' || x.year < t0 || x.year > sim.now) continue;
        hit[s.region] = 1;
        const mine = merged.has(`${x.year}:${s.region}`);
        if (mine ? x.year >= t0 + g : x.year === t0 + g) front.add(s.region);
      }
    }
    const fr = [...front].sort((a, b) => a - b);
    if (fr.length && g < maxYears({ great, pan })) {
      pl.now = { k: last, t0, great, level, ...(pan !== undefined ? { pan } : {}), hit, front: fr };
      sim.schedule(t0 + g + 1, Ev.PlagueStep, last, g + 1);
    }
  }
  let k = 0;
  while (quantize(checkTime(pl.base, k)) <= sim.now) k++;
  sim.schedule(checkTime(pl.base, k), Ev.PlagueCheck, k, 0);
}

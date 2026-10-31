/**
 * 全球大疫和疫后凋敝;「天灾」多 / 很多时自己发生的全球大疫、地震水旱。挂在同一个推演引擎(sim.ts)上,纯计算,不碰 DOM。
 *
 * **从哪来**:作者下的(干预"天灾"的全球大疫、大纲里写的,disaster.ts 调用 startPandemic),
 *   或「天灾」多 / 很多(calamity.ts 的 CalamityRates)时自己发生(Ev.PandemicCheck,每 PAN_CHECK 年看一次,每段里随机一个时刻):
 *   别的全球大疫凋敝已过、上一场起疫满 PAN_GAP 年,按 PAN_CHECK ÷ CalamityRates.pandemicYears 掷;
 *   起疫的是能远洋的国家的港口里人口至少 ORIGIN_MIN 的一座(人口越多越容易);有多重、凋敝几年按 calamity.ts 的 naturalPandemic。
 *   「天灾」平常的世界不预约这些事件,没下全球大疫干预的历史和没有这一层逐字节一样。
 *
 * **起疫**(startPandemic):记一条史事 pandemic(疫前天下人口记在 n),再交给瘟疫那一层(plague.ts 的 PlagueModel.pandemic)
 *   从那城起、照全球大疫的规矩传开、死人(染疫的城、州记进这里的状态,pandemicState.ts)。
 *
 * **疫后无人收拾的那些年(凋敝,到 起疫 + 凋敝年数 为止)**,染过疫的州:
 *   - 人口不回升:染疫、复作的折损带 until(凋敝结束以前不长回来,growth.ts 的 sackAge);乡下的也不往回长(population.ts 读这里);
 *   - 疫气复作、流亡(Ev.SlumpStep,起疫后每 SLUMP_EVERY 年一次):城里再死 SLUMP_LOSS × 轻重(一次比一次轻,SLUMP_FADE),
 *     乡下跟着(growth.ts 的 RURAL_SLUMP);天下人口不到疫前 FLOOR 时不再复作(保底:不低于一半);
 *   - 村镇荒废:不是国都的村(不到 8 千人)、镇(不到 2.5 万),凋敝 DESOLATE_YEARS 年里约 DESOLATE[村 / 镇] × 轻重 荒废
 *     (每次复作时掷);城的 ended = 那一刻,记史事 desolate,之后照毁城的规矩看重建(cities.ts;凋敝里不重建);
 *   - 发展度往回掉、时代跟着退(development.ts 读这里);国力、钱粮跟着人口掉,动荡照现有规则(unrest.ts 的瘟疫那一项)。
 *   凋敝里不自己起新的瘟疫(plague.ts 的 PlagueModel.quiet)。
 *
 * **地震水旱**(「天灾」多 / 很多,Ev.QuakeCheck,每 QUAKE_CHECK 年看一次):各国按 QUAKE_CHECK ÷ CalamityRates.quakeYears 掷,
 *   掷中的在国土里挑一处有城的州当震中,照作者下的地震水旱那样受灾(disaster.ts 的 afflict;轻重按 QUAKE_LEVELS 掷)。
 *
 * **不存内存状态**:全球大疫由史事 pandemic 和城镇表里带 pan(第几场)的折损重建(resumePandemic);看全球大疫、看地震水旱、复作的时刻都由
 *   "第几次 / 起疫的时刻"算出来。随机数:keyed(subSeed(seed, 'civ-pandemic'), 第几次 / 第几场, 州的治所 / 城…, 用途)。
 */
import type { Civ, Year } from './types';
import { Layer } from './types';
import type { Intervention } from '../edits';
import { fpow, keyed, keyed4 } from './engine/rand';
import { quantize, type CivSim } from './engine/sim';
import { polityModelOf, sailsOcean, type PolityModel } from './polities';
import { plagueModelOf } from './plague';
import { capitalAt, populationAt, settlementRank } from './growth';
import { scheduleRebuild } from './cities';
import { afflict } from './disaster';
import { IV_LOSS, PANDEMIC_K, PLAGUE_IV, calamityRates, naturalPandemic, pandemicBase, quakeRing, type Calamity } from './calamity';
import { anySlump, newPandemic, notePandemicHit, pandemicModelOf, setPandemicModel, type Pandemic, type PandemicModel } from './pandemicState';
import type { CivModule } from './modules';
import { Ev } from './events';
import { civApi } from './api';

// ---- 调参(以 20 个种子的统计为准,见 scripts/pandemic-stats.ts) ----
/** 看全球大疫:每隔多少年;上一场起疫后这么多年内不再自己起 */
const PAN_CHECK = 50;
const PAN_GAP = 150;
/** 起疫的港口人口至少多少(千人;同 plague.ts 的 ORIGIN_MIN) */
const ORIGIN_MIN = 25;
/** 疫气复作:起疫后每隔几年一次;城里再死几成(× 轻重);一次比一次轻(× SLUMP_FADE) */
export const SLUMP_EVERY = 8;
const SLUMP_LOSS = 0.03;
const SLUMP_FADE = 0.85;
/** 保底:天下人口不到疫前这么多,不再复作 */
const FLOOR = 0.55;
/** 村镇荒废:凋敝 DESOLATE_YEARS 年里村、镇荒废几成(× 轻重;一次最多 DESOLATE_MAX) */
const DESOLATE: readonly number[] = [0.22, 0.11];
const DESOLATE_YEARS = 30;
const DESOLATE_MAX = 0.9;
/** 看地震水旱:每隔多少年;轻、中的几率(余下是重) */
const QUAKE_CHECK = 20;
const QUAKE_LEVELS: readonly number[] = [0.5, 0.35];

// 随机数用途编号(calamity.ts 的 naturalPandemic 用 9)
const U_T = 1;
const U_ODDS = 2;
const U_ORIGIN = 3;
const U_DESOLATE = 4;
const U_QUAKE_T = 5;
const U_QUAKE = 6;
const U_QUAKE_AT = 7;
const U_QUAKE_LV = 8;

interface Runner {
  sim: CivSim;
  pm: PolityModel;
  base: number;
  state: PandemicModel;
  calamity: Calamity | undefined;
  /** 已经预约了的复作时刻(1/256 年为单位;同一刻几场一起处理,只约一次) */
  booked: Set<number>;
}

const runners = new WeakMap<CivSim, Runner>();

/** 第 k 次看全球大疫、看地震水旱的时刻 */
function panTime(base: number, k: number): number {
  return PAN_CHECK * (k + 0.2 + 0.6 * keyed(base, k, 0, U_T));
}
function quakeTime(base: number, k: number): number {
  return QUAKE_CHECK * (k + 0.2 + 0.6 * keyed(base, k, 1, U_QUAKE_T));
}

/** 一场全球大疫的第 j 次复作(j ≥ 1)的时刻;凋敝结束以后的没有(= Infinity) */
function relapseTime(p: Pandemic, j: number): number {
  const t = p.t0 + SLUMP_EVERY * j;
  return t < p.end ? t : Infinity;
}

/** 登记全球大疫这一层(installPlague 之后调用);「天灾」多 / 很多时预约第一次看全球大疫、看地震水旱 */
export function installPandemic(sim: CivSim, pm: PolityModel, seed: number): void {
  const run: Runner = { sim, pm, base: pandemicBase(seed), state: { list: [] }, calamity: sim.calamity, booked: new Set() };
  hook(run);
  if (calamityRates(run.calamity)) {
    sim.schedule(panTime(run.base, 0), Ev.PandemicCheck, 0, 0);
    sim.schedule(quakeTime(run.base, 0), Ev.QuakeCheck, 0, 0);
  }
}

/** 此刻天下人口(千人):各州乡村(population.ts 最近一步算的)+ 各城 */
function worldPopulation(run: Runner, t: Year): number {
  const rural = civApi(run.sim).dev.ruralNow?.().data;
  let sum = 0;
  if (rural) for (let r = 0; r < rural.length; r++) sum += rural[r];
  for (const s of run.pm.settlements) if (s.ended === undefined && t >= s.founded) sum += populationAt(s, t);
  return sum;
}

/**
 * 起一场全球大疫(干预 / 大纲 / 自己发生):从州 r 的城起,第 k 场,轻重 level,疫后无人收拾 slump 年。
 * 记史事 pandemic(疫前天下人口在 n),交给瘟疫那一层传开,预约凋敝里的复作
 */
export function startPandemic(sim: CivSim, r: number, level: number, k: number, slump: number, t: Year): void {
  const run = runners.get(sim);
  const pl = plagueModelOf(sim);
  if (!run || !pl?.pandemic) return;
  const pm = run.pm;
  const pre = Math.round(worldPopulation(run, t));
  const end = t + slump;
  sim.record('pandemic', { a: sim.owners[Layer.Polity][r], b: slump, region: r, settlement: pm.cityOf[r], war: k, n: pre });
  const p = newPandemic(pm.terrain.R, k, t, end, level, pre);
  run.state.list.push(p);
  pl.pandemic(r, level, k, end, t);
  bookRelapses(run, p, t);
}

/** 预约一场全球大疫此刻以后的复作(同一刻已约过的不再约) */
function bookRelapses(run: Runner, p: Pandemic, now: Year): void {
  for (let j = 1; ; j++) {
    const t = relapseTime(p, j);
    if (t === Infinity) break;
    const tick = Math.round(quantize(t) * 256);
    if (quantize(t) <= now || run.booked.has(tick)) continue;
    run.booked.add(tick);
    run.sim.schedule(t, Ev.SlumpStep, 0, 0);
  }
}

function hook(run: Runner): void {
  const { sim, pm, base, state } = run;
  runners.set(sim, run);
  setPandemicModel(sim, state);
  const reg = pm.terrain.regions;
  const R = pm.terrain.R;
  const S = pm.settlements;
  const culture = sim.owners[Layer.Culture];
  const owner = sim.owners[Layer.Polity];
  const rate = calamityRates(run.calamity);

  const pl = plagueModelOf(sim);
  if (pl) {
    pl.quiet = (t) => anySlump(state, t);
    pl.onPandemicHit = (k, r, sid, t, loss) => {
      for (let i = state.list.length - 1; i >= 0; i--) {
        if (state.list[i].k !== k) continue;
        notePandemicHit(state.list[i], r, sid, t, loss);
        break;
      }
    };
  }

  /** 州 r 此刻有人烟的城(没有 = −1) */
  const cityNow = (r: number, t: number): number => {
    const sid = pm.cityOf[r];
    if (sid < 0 || culture[r] < 0) return -1;
    const s = S[sid];
    return s.ended === undefined && t >= s.founded ? sid : -1;
  };

  // ---- 自己发生的全球大疫 ----
  sim.on(Ev.PandemicCheck, (k, _b, t) => {
    sim.schedule(panTime(base, k + 1), Ev.PandemicCheck, k + 1, 0);
    if (!rate || !run.calamity) return;
    if (anySlump(state, t)) return;
    const last = state.list.length ? state.list[state.list.length - 1].t0 : -Infinity;
    if (t - last < PAN_GAP) return;
    if (keyed(base, k, 0, U_ODDS) >= PAN_CHECK / rate.pandemicYears) return;
    // 能远洋的国家的大港:人口越多越容易(掷得最险的那座)
    let r0 = -1;
    let best = Infinity;
    for (let r = 0; r < R; r++) {
      const p = owner[r];
      if (p < 0 || !pm.port[r]) continue;
      const sid = cityNow(r, t);
      if (sid < 0) continue;
      const pop = populationAt(S[sid], t);
      if (!(pop >= ORIGIN_MIN) || !sailsOcean(pm, pm.polities[p], t)) continue;
      const score = keyed4(base, k, reg.seat[r], 0, U_ORIGIN) / pop;
      if (score < best) {
        best = score;
        r0 = r;
      }
    }
    if (r0 < 0) return;
    const { level, slump } = naturalPandemic(base, run.calamity, k);
    startPandemic(sim, r0, level, PANDEMIC_K + k, slump, t);
  });

  // ---- 凋敝里的复作、村镇荒废 ----
  sim.on(Ev.SlumpStep, (_a, _b, t) => {
    const tq = quantize(t);
    for (const p of state.list) {
      if (!(p.t0 < t && t < p.end)) continue;
      const j = Math.round((t - p.t0) / SLUMP_EVERY);
      if (j < 1 || quantize(relapseTime(p, j)) !== tq) continue;
      relapse(p, j, t);
    }
  });

  /** 第 j 次复作:染过疫的州再死一截(天下人口太少了不再死),不是国都的村镇有的荒废 */
  const relapse = (p: Pandemic, j: number, t: Year): void => {
    const more = worldPopulation(run, t) >= FLOOR * p.pre;
    const fade = fpow(SLUMP_FADE, j - 1);
    const share = SLUMP_EVERY / DESOLATE_YEARS;
    const caps = new Set<number>();
    for (const q of pm.polities) if (q.ended === undefined && pm.size[q.id]) caps.add(capitalAt(q, t));
    for (let r = 0; r < R; r++) {
      if (!(p.at[r] < t)) continue;
      const sid = p.sid[r];
      const s = S[sid];
      if (!s) continue;
      const sev = p.sev[r];
      // 村镇荒废(按复作以前的人口):还是染疫时那座、还在、不是国都、不到城的
      const live = pm.cityOf[r] === sid && s.ended === undefined && !caps.has(sid);
      const rank = live ? settlementRank(populationAt(s, t)) : 2;
      if (more) {
        const loss = Math.round(SLUMP_LOSS * sev * fade * 1000) / 1000;
        if (loss > 0) (s.sacks ??= []).push({ year: t, loss, cause: 'slump', until: p.end });
      }
      if (rank >= 2) continue;
      const odds = 1 - fpow(1 - Math.min(DESOLATE_MAX, DESOLATE[rank] * sev), share);
      if (keyed4(base, p.k, pm.stag[sid], j, U_DESOLATE) >= odds) continue;
      s.ended = t;
      pm.cityOf[r] = -1;
      sim.record('desolate', { a: owner[r], region: r, settlement: sid, war: p.k });
      scheduleRebuild(sim, sid);
    }
  };

  // ---- 自己发生的地震水旱 ----
  sim.on(Ev.QuakeCheck, (k, _b, t) => {
    sim.schedule(quakeTime(base, k + 1), Ev.QuakeCheck, k + 1, 0);
    if (!rate) return;
    // 各国在国土里挑一处有城的州当震中(掷得最小的那州)
    const at = new Map<number, [number, number]>();
    for (let r = 0; r < R; r++) {
      const p = owner[r];
      if (p < 0 || cityNow(r, t) < 0) continue;
      const u = keyed4(base, k, reg.seat[r], 0, U_QUAKE_AT);
      const cur = at.get(p);
      if (!cur || u < cur[0]) at.set(p, [u, r]);
    }
    const odds = QUAKE_CHECK / rate.quakeYears;
    for (const p of [...at.keys()].sort((x, y) => x - y)) {
      const tag = pm.ptag[p];
      if (keyed4(base, k, tag, 0, U_QUAKE) >= odds) continue;
      const u = keyed4(base, k, tag, 0, U_QUAKE_LV);
      const level = u < QUAKE_LEVELS[0] ? 1 : u < QUAKE_LEVELS[0] + QUAKE_LEVELS[1] ? 2 : 3;
      const center = at.get(p)![1];
      const hit: number[] = [];
      const pop = new Map<number, number>();
      for (const r of quakeRing(reg, center)) {
        const sid = cityNow(r, t);
        if (sid < 0) continue;
        hit.push(r);
        pop.set(r, populationAt(S[sid], t));
      }
      if (hit.length) afflict(sim, pm, hit, pop, t, IV_LOSS[level], 'quake', center);
    }
  });
}

/**
 * 由 Civ 重建全球大疫这一层(resumeCiv 调用,在 resumePlague 之后):史事 pandemic 是起过的几场,
 * 城镇表里 cause = plague、带 pan(= 第几场)的折损是各场染上的州;再补上还没到的复作、看全球大疫、看地震水旱
 */
export function resumePandemic(sim: CivSim, civ: Civ, list: readonly Intervention[] = civ.interventions ?? []): void {
  const pm = polityModelOf(sim);
  if (!pm) return;
  const run: Runner = { sim, pm, base: pandemicBase(civ.seed), state: { list: [] }, calamity: sim.calamity, booked: new Set() };
  const R = pm.terrain.R;
  for (const e of civ.annals) {
    if (e.kind !== 'pandemic') continue;
    const v = e.war < PANDEMIC_K ? list[e.war - PLAGUE_IV] : undefined;
    const level = v?.kind === 'disaster' ? v.level : run.calamity ? naturalPandemic(run.base, run.calamity, e.war - PANDEMIC_K).level : 2;
    run.state.list.push(newPandemic(R, e.war, e.year, e.year + e.b, level, e.n ?? 0));
  }
  if (run.state.list.length) {
    const hits: { r: number; sid: number; year: Year; loss: number; pan: number }[] = [];
    for (const s of pm.settlements) {
      for (const x of s.sacks ?? []) if (x.cause === 'plague' && x.pan !== undefined && x.year <= sim.now) hits.push({ r: s.region, sid: s.id, year: x.year, loss: x.loss, pan: x.pan });
    }
    hits.sort((a, b) => a.year - b.year || a.r - b.r);
    for (const h of hits) {
      for (let i = run.state.list.length - 1; i >= 0; i--) {
        const p = run.state.list[i];
        if (p.k !== h.pan) continue;
        notePandemicHit(p, h.r, h.sid, h.year, h.loss);
        break;
      }
    }
  }
  hook(run);
  for (const p of run.state.list) bookRelapses(run, p, sim.now);
  if (calamityRates(run.calamity)) {
    let k = 0;
    while (quantize(panTime(run.base, k)) <= sim.now) k++;
    sim.schedule(panTime(run.base, k), Ev.PandemicCheck, k, 0);
    let q = 0;
    while (quantize(quakeTime(run.base, q)) <= sim.now) q++;
    sim.schedule(quakeTime(run.base, q), Ev.QuakeCheck, q, 0);
  }
}

/** 推演引擎上的全球大疫(测试、统计用) */
export { pandemicModelOf };

/** 模块:全球大疫、疫后凋敝;「天灾」多 / 很多时自己发生的全球大疫、地震水旱(清单和次序见 modules.ts) */
export const pandemicModule: CivModule = {
  id: 'pandemic',
  install: (c) => {
    if (c.pm) installPandemic(c.sim, c.pm, c.seed);
  },
  resume: (c) => resumePandemic(c.sim, c.civ, c.iv?.list),
};

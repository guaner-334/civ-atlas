/**
 * 动荡、饥荒、民变、大崩解:国家越大越难管,碰上饥荒、打败仗、王朝老了就可能一下子散架。
 * 挂在同一个推演引擎(sim.ts)上,改归属一律走 setOwner(自立的州原因 = Ev.Split,散回部落的 = Ev.Collapse),
 * 发生了什么记进史事(sim.record:famine / revolt / collapse)。
 *
 * 流程(index.ts 在 installDevelopment 之后调用 installUnrest):
 *
 *   **动荡**:每个国家一个看不见的"乱"值(0 起,一般 0–3),按国一张数表,每年年初算一次(规则见 stateTables.ts,
 *     control.ts 建引擎、填输入;年里出的事下一年才算进去):
 *     危机(politics.ts 的 strain:国土大、刚丢了国都 / 迁了都、正在打仗、接连丢州)
 *     + 边远的州多(各州离国都多远的平均,按行政能力折算,见 control.ts;超过 FAR_0 的部分 × FAR_W)+ 异族多(异族州的比例 × FOREIGN_W)
 *     + 王朝老了(当朝 AGE_0 年以后渐涨,AGE_SPAN 年涨满 AGE_W;新朝初立 NEW_YEARS 年内反倒减 NEW_W)
 *     + 闹了饥荒(FAMINE_YEARS 年内闹饥荒的州,占国土 FAMINE_FULL 就加满 FAMINE_W)
 *     + 闹了瘟疫(PLAGUE_YEARS 年内染疫的州,占国土 PLAGUE_FULL 就加满 PLAGUE_W;瘟疫见 plague.ts)+ 民变还没平(REVOLT_W)
 *     + 国用不足(钱粮,见 stateTables.ts;FISCAL_W × 窘迫)
 *     + 照大纲顺着引的动荡加减(policy.ts 的 GUIDE_UNREST;control.ts 读表时加上)。
 *     它让国家更容易分裂(politics.ts 的分裂赔率用它)、更容易被邻国趁虚而入、更想对外开战转移矛盾(wars.ts)、
 *     动荡到顶的大国就会大崩解(见下)。
 *
 *   **饥荒**(Ev.FamineCheck,每 FAMINE_EVERY 年看一次年景,每段里随机一个时刻):
 *     世上闹几处灾年(有城的州每 CLUSTER_PER 个一处;干旱、寒冷的地方更容易,见 CLIMATE),每处从一州往外 1–3 州。
 *     灾区里人口离上限越近、地越薄的城越容易闹饥荒(赔率 ∝ 灾情 × 气候 × (P_BASE + P_FULL × 人口顶到上限的几成⁴) × (1 + SOIL_W × (1 − 地力))):
 *     城的人口掉一截(LOSS 里随机,记进 Settlement.sacks,cause = famine,和洗劫一样几十年慢慢长回来);
 *     FAMINE_REST 年内闹过饥荒的城不再闹。一国治下同一处灾年里闹饥荒的几州记一条史事 famine(部落地带不记)。
 *
 *   **民变**:闹了饥荒的国家(至少 REVOLT_STATE 州),动荡越高越容易有饥民起事:
 *     赔率 = REVOLT_ODDS × e^(REVOLT_K × (动荡 − REVOLT_U0)) × min(1, 闹饥荒的州数 ÷ 3)。
 *     起事的州 = 灾最重、不是国都的那州;连同周围闹了饥荒的州、再往外几州(最多 REVOLT_MAX,不超过国土的 REVOLT_FRAC)
 *     立一个新势力(记 revolt),原来的国家当即发兵讨伐(记 war,cause = quell)。
 *     打这一仗时饥民初起声势大(国力 × REBEL_MORALE,从起事或最近一次攻下一州那年起 REBEL_FADE 年里淡去),
 *     朝廷一方人心不附(× COURT_MORALE);朝廷刚丢的州马上就能去打,起事的一方往都城打(不限于夺回失地);
 *     不到 REVOLT_LENGTH 倍的厌战年限不罢兵(见 wars.ts 的 WarModel.revolt)。
 *     结局照打仗的规矩:被讨平(起事的国家亡)、割据一方(议和)、或者打进都城 —— 原来的国家余下的州一并归起事的一方,亡国
 *     (wars.ts 的 overthrow,像农民起义攻破京城、建立新朝)。
 *
 *   **宗室争位、据地自立**(新君即位那一刻,polities.ts 的 onReign):先君寿终(不是遇弑、不是作者让他去世;先君晚年新君没有引兵入朝,regents.ts)、同一朝的下一位即位,
 *     先君还有 20–60 岁、在世的儿子(不算即位的那位;royals.ts 的 claimants),至少 CLAIM_STATE 州的国家有机会起内乱:
 *     赔率 = CLAIM_ODDS × (1 + CLAIM_MORE × (这样的儿子数 − 1)) × e^(CLAIM_K × (动荡 − CLAIM_U0))。
 *     起兵的是其中最年长的那位(人物里就是他,做新国家的开国之君;生年记在 Polity.prince):以离国都远、有城的一州为起事的州,
 *     连同周围几州(国土的 CLAIM_FRAC,CLAIM_MIN–CLAIM_MAX 州)据地自立(记 split,cause = heir),原来的国家当即发兵讨伐
 *     (记 war,cause = heir)。这一仗和讨伐民变一样打到一方亡(或厌战议和、割据一方);宗室初起时国力 × CLAIM_MORALE、
 *     CLAIM_FADE 年里淡去,朝廷一方 × CLAIM_COURT;打进都城的,原来的国家余下的州一并归他(夺了大位)。
 *
 *   **大崩解**(看内政时最先看,politics.ts 的 crisis):国土至少 COLLAPSE_MIN 州、立国满 COLLAPSE_AGE 年的大国,
 *     赔率 = COLLAPSE_ODDS × e^(COLLAPSE_K × (动荡 − COLLAPSE_U0));同一国崩过 COLLAPSE_REST 年内不再崩。
 *     盛极而衰:只看占了所在大陆(国土最多的那块陆地)有人住的州 HEG_GATE 以上的大国;占的越多动荡越高
 *     (超过 HEG_0 的部分,再占 HEG_SPAN 加满 HEG_W),称霸一块大陆的国家迟早散架,过些年再被邻国、新兴的国家收拾起来。
 *     崩的时候国都一带(按离国都的路程,留国土的 KEEP 里随机的几成)留给原来的国家,其余的散成 2–4 块
 *     (离国都远、不满最重的州先起事,各块从起事的州往外长,块和块尽量离得远),各块以块里人口最多的城为都自立(记 split,cause = collapse;
 *     故都是同族亡国国都的算复国)。三种崩法(记在 collapse 的 b):
 *       中央崩(0):各地自立,发展度不掉;
 *       地方崩(1):诸州残破,散出去的州发展度掉一截(development.ts 按日志找这些州);
 *       两样都崩(2):散出去的州不立国,散回部落地带(日志原因 Ev.Collapse),发展度掉得更多。
 *     哪一种:时代越早、游牧国家越容易散回部落;刚闹了饥荒、正在打仗的多是地方崩;别的多是中央崩。
 *
 * **不存内存状态**:饥荒、民变、崩解都由史事重建(resumeUnrest);看年景的时刻由"第几次"算出来。
 * 随机数:keyed(subSeed(seed, 'civ-unrest'), 国家 / 州…, 第几次, 用途),和处理顺序无关。纯计算,不碰 DOM。
 */
import type { World } from '../world';
import { AdjKind, Layer, type Civ, type Polity, type Year } from './types';
import { Biome } from '../biomes';
import { fexp, keyed, keyed4, subSeed } from './rand';
import { BOOKED_AT_START, bookChain, Ev, quantize, type CivSim } from './sim';
import { polityModelOf, type PolityModel } from './polities';
import { warModelOf, type War, type WarModel } from './wars';
import { politicsModelOf, type PoliticsModel } from './politics';
import { devModelOf } from './development';
import { GROWTH_A, capitalAt, populationAt } from './growth';
import type { UnrestRuleConsts } from './stateTables';
import { claimants, murderedAt } from './royals';

// ---- 调参(以 20 个种子的统计为准) ----
/** 动荡:各州离国都的路程 ÷ REACH(最多 4)的平均,超过 FAR_0 的部分 × FAR_W */
const REACH = 12;
const FAR_0 = 0.6;
const FAR_W = 0.5;
/** 动荡:异族州的比例 × FOREIGN_W */
const FOREIGN_W = 0.6;
/** 动荡:当朝 AGE_0 年以后渐涨,再过 AGE_SPAN 年涨满 AGE_W;新朝初立 NEW_YEARS 年内减 NEW_W */
const AGE_0 = 150;
const AGE_SPAN = 250;
const AGE_W = 0.6;
const NEW_YEARS = 30;
const NEW_W = 0.3;
/** 动荡:FAMINE_YEARS 年内闹饥荒的州,占国土 FAMINE_FULL(至少 FAMINE_FULL_MIN 州)就加满 FAMINE_W */
const FAMINE_YEARS = 30;
const FAMINE_FULL = 0.12;
const FAMINE_FULL_MIN = 3;
const FAMINE_W = 0.9;
/** 动荡:PLAGUE_YEARS 年内染疫的州,占国土 PLAGUE_FULL(至少 FAMINE_FULL_MIN 州)就加满 PLAGUE_W */
const PLAGUE_YEARS = 20;
const PLAGUE_FULL = 0.25;
const PLAGUE_W = 0.6;
/** 动荡:民变还没平 */
const REVOLT_W = 0.4;

/** 看年景:第一次在哪一年,之后每隔多少年 */
const FAMINE_FIRST = 0;
const FAMINE_EVERY = 10;
/** 有城的州每这么多个闹一处灾年(按世界大小;再随机多一处或少一处) */
const CLUSTER_PER = 450;
/** 一处灾年从一州往外最多几州 */
const CLUSTER_HOPS = 3;
/** 灾情(每处灾年随机):SEV 里;离灾年中心每远一州打 HOP_FADE 的折 */
const SEV: readonly [number, number] = [0.3, 1];
const HOP_FADE = 0.2;
/** 闹饥荒的赔率 = 灾情 × 气候 × (P_BASE + P_FULL × 人口顶到上限的几成⁴) */
const P_BASE = 0.02;
const P_FULL = 0.6;
/** 地薄的州更容易闹饥荒:赔率再乘 1 + SOIL_W × (1 − 地力)(地力见 population.ts) */
const SOIL_W = 2;
/** 人口掉几成(按赔率在里面取,再加一点随机) */
const LOSS: readonly [number, number] = [0.08, 0.3];
/** 闹过饥荒的城这么多年内不再闹 */
const FAMINE_REST = 30;

/** 民变:国家至少几州;赔率;起事的最多几州、不超过国土的几成 */
const REVOLT_STATE = 8;
const REVOLT_ODDS = 0.12;
const REVOLT_K = 1.6;
const REVOLT_U0 = 1.5;
const REVOLT_MAX = 8;
const REVOLT_MIN = 2;
const REVOLT_FRAC = 0.15;
/** 讨伐民变:起事的一方国力 × (1 + (REBEL_MORALE − 1) × e^(−年数 ÷ REBEL_FADE)),朝廷一方 × COURT_MORALE */
const REBEL_MORALE = 8;
const REBEL_FADE = 12;
const COURT_MORALE = 0.6;

/** 宗室争位:国家至少几州;赔率;起兵的州组占国土的几成、最多 / 最少几州 */
const CLAIM_STATE = 10;
const CLAIM_ODDS = 0.08;
const CLAIM_MORE = 0.5;
const CLAIM_K = 1.2;
const CLAIM_U0 = 1;
const CLAIM_FRAC = 0.25;
const CLAIM_MAX = 10;
const CLAIM_MIN = 3;
/** 讨伐争位的宗室:宗室一方国力 × (1 + (CLAIM_MORALE − 1) × e^(−年数 ÷ CLAIM_FADE)),朝廷一方 × CLAIM_COURT */
const CLAIM_MORALE = 3;
const CLAIM_FADE = 15;
const CLAIM_COURT = 0.85;

/** 大崩解:国土至少几州、立国满几年;同一国这么多年内不再崩 */
const COLLAPSE_MIN = 30;
const COLLAPSE_AGE = 150;
const COLLAPSE_REST = 300;
/** 大崩解的赔率 = COLLAPSE_ODDS × e^(COLLAPSE_K × (动荡 − COLLAPSE_U0)) */
const COLLAPSE_ODDS = 0.05;
const COLLAPSE_K = 2.5;
const COLLAPSE_U0 = 2.35;
/** 盛极而衰:占所在大陆有人住的州不到几成的不崩;超过 HEG_0 的部分每多 HEG_SPAN,崩解时的动荡多 HEG_W(加满为止) */
const HEG_GATE = 0.25;
const HEG_0 = 0.3;
const HEG_SPAN = 0.3;
const HEG_W = 2;
/** 大崩解:国都一带留给原来的国家的几成(KEEP 里随机);散出去的每块大约几州;每块至少几州 */
const KEEP: readonly [number, number] = [0.25, 0.4];
const PIECE_SIZE = 12;
const PIECE_MIN = 3;

/** 干旱、寒冷的地方更容易闹灾年(按州的生物群落) */
const CLIMATE: readonly number[] = (() => {
  const c = new Array<number>(16).fill(1);
  c[Biome.HotDesert] = c[Biome.TemperateDesert] = c[Biome.ColdDesert] = 1.7;
  c[Biome.Steppe] = c[Biome.Savanna] = 1.4;
  c[Biome.Tundra] = c[Biome.Taiga] = 1.3;
  c[Biome.TropicalDryForest] = 1.1;
  c[Biome.TemperateRainforest] = c[Biome.Rainforest] = c[Biome.Wetland] = 0.8;
  return c;
})();

// 随机数用途编号
const U_FAM_T = 1;
const U_CENTER = 3;
const U_HOPS = 4;
const U_SEV = 5;
const U_HIT = 6;
const U_LOSS = 7;
const U_REVOLT = 8;
const U_COLLAPSE = 9;
const U_KIND = 10;
const U_KEEP = 11;
const U_PIECES = 12;
const U_SEED = 13;
const U_CLAIM = 14;
const U_CLAIM_R = 15;

// ---------------------------------------------------------------------------
// 模型

export interface UnrestModel {
  pm: PolityModel;
  wm: WarModel;
  pol: PoliticsModel;
  base: number;
  /** 国家 → 闹过的饥荒(按先后:年份、州数) */
  famines: Map<number, { year: Year; n: number }[]>;
  /** 国家 → 染过的瘟疫(按先后:年份、这一年染疫的州数;plague.ts 往里记) */
  plagues: Map<number, { year: Year; n: number }[]>;
  /** 讨伐民变的战争 → 起事的国家 */
  quell: Map<number, number>;
  /** 讨伐争位宗室的战争 → 他据地自立的国家 */
  claims: Map<number, number>;
  /** 国家 → 最近一次大崩解的年份 */
  collapsed: Map<number, Year>;
}

function newModel(pm: PolityModel, wm: WarModel, pol: PoliticsModel, seed: number): UnrestModel {
  return { pm, wm, pol, base: subSeed(seed, 'civ-unrest'), famines: new Map(), plagues: new Map(), quell: new Map(), claims: new Map(), collapsed: new Map() };
}

const models = new WeakMap<CivSim, UnrestModel>();

/** 推演引擎上挂着的动荡模型(测试、统计用) */
export function unrestModelOf(sim: CivSim): UnrestModel | undefined {
  return models.get(sim);
}

/** 第 k 次看年景的时刻 */
function famineTime(um: UnrestModel, k: number): number {
  return FAMINE_FIRST + FAMINE_EVERY * (k + 0.2 + 0.6 * keyed(um.base, k, 0, U_FAM_T));
}

/** 当朝从哪一年起(没改朝换代过 = 立国那年;同 dynasty.ts 的 dynastyStart) */
function dynastyStart(p: Polity): Year {
  const d = p.dynasties;
  return d && d.length ? d[d.length - 1].year : p.founded;
}

/** 动荡的规则用到的常数(stateTables.ts 的「动荡」) */
export const UNREST_CONSTS: UnrestRuleConsts = { FAR_0, FAR_W, FOREIGN_W, AGE_0, AGE_SPAN, AGE_W, NEW_YEARS, NEW_W, FAMINE_FULL, FAMINE_FULL_MIN, FAMINE_W, PLAGUE_FULL, PLAGUE_W, REVOLT_W };

/** 动荡的输入里归这里管的几样(此刻):当朝几年、近年闹饥荒 / 染疫的州数、在讨伐的民变有几处 */
export function unrestInputs(um: UnrestModel, P: Polity, t: Year): { age: number; famine: number; plague: number; quell: number } {
  const pid = P.id;
  const recent = (l: { year: Year; n: number }[] | undefined, span: number) => {
    let n = 0;
    if (l) for (let i = l.length - 1; i >= 0 && t - l[i].year < span; i--) n += l[i].n;
    return n;
  };
  let quell = 0;
  for (const w of um.wm.active) if (w.a === pid && (um.quell.has(w.id) || um.claims.has(w.id))) quell++;
  return { age: t - dynastyStart(P), famine: recent(um.famines.get(pid), FAMINE_YEARS), plague: recent(um.plagues.get(pid), PLAGUE_YEARS), quell };
}

// ---------------------------------------------------------------------------
// 挂到推演引擎上

/** 登记动荡、饥荒、民变、大崩解的事件处理和挂钩(installDevelopment 之后调用),预约第一次看年景 */
export function installUnrest(sim: CivSim, pm: PolityModel, seed: number): UnrestModel {
  const wm = warModelOf(sim);
  const pol = politicsModelOf(sim);
  if (!wm || !pol) throw new Error('installUnrest:先 installWars、installPolitics');
  const um = newModel(pm, wm, pol, seed);
  hook(sim, um);
  sim.schedule(famineTime(um, 0), Ev.FamineCheck, 0, 0);
  return um;
}

function hook(sim: CivSim, um: UnrestModel): void {
  models.set(sim, um);
  const { pm, wm, pol } = um;
  const reg = pm.terrain.regions;
  const R = pm.terrain.R;
  const culture = sim.owners[Layer.Culture];
  const owner = sim.owners[Layer.Polity];

  // ---- 动荡:按国一张数表,每年算一次(规则见 stateTables.ts;control.ts 建引擎、填输入,挂 pol.unrest、wm.unrest) ----

  // ---- 讨伐民变:士气、攻破都城 ----
  wm.morale = (w: War, x: number, t: number) => {
    const claim = um.claims.get(w.id);
    const rebel = claim ?? um.quell.get(w.id);
    if (rebel === undefined) return 1;
    if (x === rebel) {
      // 声势从起事(或最近一次攻下一州)那年起淡去:势如破竹时一直很盛
      let since = w.start;
      for (let i = w.takes.length - 1; i >= 0; i--) {
        if (w.takes[i].by === rebel) {
          since = w.takes[i].year;
          break;
        }
      }
      return claim !== undefined ? 1 + (CLAIM_MORALE - 1) * fexp(-(t - since) / CLAIM_FADE) : 1 + (REBEL_MORALE - 1) * fexp(-(t - since) / REBEL_FADE);
    }
    return claim !== undefined ? CLAIM_COURT : COURT_MORALE;
  };
  wm.overthrow = (w, x) => um.quell.get(w.id) === x || um.claims.get(w.id) === x;
  wm.revolt = (w) => um.quell.has(w.id) || um.claims.has(w.id);

  /** 国家 p 此刻是不是还在被讨伐的民变(起事的一方) */
  const rebelNow = (p: number) => wm.active.some((w) => w.b === p && um.quell.get(w.id) === p);
  /** 国家 p 此刻是不是正在讨伐民变、争位的宗室 */
  const quelling = (p: number) => wm.active.some((w) => w.a === p && (um.quell.has(w.id) || um.claims.has(w.id)));

  // ---- 宗室争位、据地自立(新君即位那一刻) ----
  pm.onReign = (pid, k, list, t) => {
    const P = pm.polities[pid];
    const R = list[k - 1];
    const X = list[k];
    if (P.ended !== undefined || P.lineage === 'republic' || pm.size[pid] < CLAIM_STATE) return;
    // 先君寿终、同一朝里交接(遇弑的由名臣迎立新君;作者立的、作者让他去世的不算)
    if (R.crown || X.crown || R.death || R.cut !== undefined || R.natural !== t || R.dynasty !== X.dynasty || X.j === 0) return;
    if (murderedAt(pm.rbase, pm.rtag[pid], R.k)) return;
    // 先君晚年新君已引兵入朝、杀过一轮兄弟(regency.ts):不再起兵争位
    if (pm.regents.get(pid)?.some((g) => g.kind === 'march' && g.k === R.k)) return;
    if (rebelNow(pid) || quelling(pid) || wm.iv?.unites(pid, t)) return;
    const sons = claimants(pm.rbase, pm.rtag[pid], R, P, t);
    if (!sons.length) return;
    const u = pol.unrest?.(P, t) ?? 0;
    const odds = CLAIM_ODDS * (1 + CLAIM_MORE * (sons.length - 1)) * fexp(CLAIM_K * (u - CLAIM_U0));
    const tag = pm.ptag[pid];
    if (keyed(um.base, tag, k, U_CLAIM) >= odds / (1 + odds)) return;
    // 起事的州:离国都远、有城、不是国都、不是永久划给它的州(加一点随机)
    const capR = pm.settlements[capitalAt(P, t)].region;
    const dist = pm.capDist[pid];
    let r0 = -1;
    let best = -Infinity;
    for (const r of pm.lands[pid]) {
      if (r === capR || pm.cityOf[r] < 0 || wm.iv?.locked(r, t)) continue;
      const v = (dist[r] < Infinity ? Math.min(4, dist[r] / REACH) : 4) + keyed4(um.base, tag, reg.seat[r], k, U_CLAIM_R);
      if (v > best) {
        best = v;
        r0 = r;
      }
    }
    if (r0 < 0) return;
    const limit = Math.min(CLAIM_MAX, Math.max(CLAIM_MIN, Math.floor(pm.size[pid] * CLAIM_FRAC)));
    const group = grow(pid, r0, limit, t, () => 0, capR);
    if (group.length < CLAIM_MIN) return;
    const sid = pol.biggestCity!(group, t);
    if (sid < 0) return;
    const full = pol.cutOff!(pid, group.slice().sort((a, b) => a - b), t, limit * 2 + 2);
    if (!full) return;
    const rival = pol.secede!(pid, full, sid, r0, t, 'split', 'heir', { prince: sons[0], lineage: P.lineage });
    const w = wm.declare!(pid, rival.id, t, -1, 'heir');
    um.claims.set(w.id, rival.id);
  };

  // ---- 饥荒 ----
  const queue = new Int32Array(R);
  const hop = new Int32Array(R);
  const mark = new Int32Array(R);
  let stamp = 0;
  /** 第 k 次看年景:挑几处灾年,闹饥荒;闹了饥荒的国家看会不会民变 */
  sim.on(Ev.FamineCheck, (k, _b, t) => {
    sim.schedule(famineTime(um, k + 1), Ev.FamineCheck, k + 1, 0);
    // 灾年的中心:有城、有人住的州各自掷(按州的治所取随机数,改了别处的地形这里照旧);干旱、寒冷的地方更容易
    const centres: number[] = [];
    for (let r = 0; r < R; r++) {
      if (pm.cityOf[r] < 0 || culture[r] < 0) continue;
      if (keyed4(um.base, k, reg.seat[r], 0, U_CENTER) < (CLIMATE[reg.biome[r]] ?? 1) / CLUSTER_PER) centres.push(r);
    }
    if (!centres.length) return;
    const soil = devModelOf(sim)?.soilNow?.();
    /** 这一次闹了饥荒的州:国家 → [州, 折损] */
    const hits = new Map<number, [number, number][]>();
    for (const c0 of centres) {
      const c = reg.seat[c0];
      const hops = 1 + Math.floor(CLUSTER_HOPS * keyed4(um.base, k, c, 0, U_HOPS));
      const sev = SEV[0] + (SEV[1] - SEV[0]) * keyed4(um.base, k, c, 0, U_SEV);
      // 从中心往外几州(陆上、跨河、翻山、海峡)
      const st = ++stamp;
      let qt = 0;
      queue[qt++] = c0;
      mark[c0] = st;
      hop[c0] = 0;
      for (let h = 0; h < qt; h++) {
        const r = queue[h];
        if (hop[r] >= hops) continue;
        for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
          const j = reg.adj[e];
          if (j >= R || mark[j] === st || reg.adjKind[e] === AdjKind.SeaRoute || culture[j] < 0) continue;
          mark[j] = st;
          hop[j] = hop[r] + 1;
          queue[qt++] = j;
        }
      }
      for (let h = 0; h < qt; h++) {
        const r = queue[h];
        const sid = pm.cityOf[r];
        if (sid < 0) continue;
        const s = pm.settlements[sid];
        if (s.ended !== undefined || !(t >= s.founded)) continue;
        // 已经在这一次闹过(两处灾年挨着)、FAMINE_REST 年内闹过的不再闹
        const sk = s.sacks;
        let rest = false;
        if (sk) for (let i = sk.length - 1; i >= 0 && t - sk[i].year < FAMINE_REST; i--) if (sk[i].cause === 'famine') rest = true;
        if (rest) continue;
        const full = 1 / (1 + GROWTH_A * fexp(-s.growth * (t - s.founded)));
        const f2 = full * full;
        const odds = sev * (1 - HOP_FADE * hop[r]) * (CLIMATE[reg.biome[r]] ?? 1) * (P_BASE + P_FULL * f2 * f2) * (soil ? 1 + SOIL_W * (1 - soil[r]) : 1);
        const tag = reg.seat[r];
        if (keyed4(um.base, k, tag, c, U_HIT) >= odds) continue;
        const loss = LOSS[0] + (LOSS[1] - LOSS[0]) * Math.min(1, 0.5 * odds + 0.5 * keyed4(um.base, k, tag, c, U_LOSS));
        (s.sacks ??= []).push({ year: t, loss: Math.round(loss * 1000) / 1000, cause: 'famine' });
        const p = owner[r];
        let list = hits.get(p);
        if (!list) hits.set(p, (list = []));
        list.push([r, loss]);
      }
    }
    // 一国一条史事(部落地带不记);按国家号的顺序
    const ps = [...hits.keys()].filter((p) => p >= 0).sort((a, b) => a - b);
    for (const p of ps) {
      const list = hits.get(p)!;
      let worst = list[0];
      for (const x of list) if (x[1] > worst[1] || (x[1] === worst[1] && x[0] < worst[0])) worst = x;
      sim.record('famine', { a: p, b: list.length, region: worst[0], settlement: pm.cityOf[worst[0]] });
      let fl = um.famines.get(p);
      if (!fl) um.famines.set(p, (fl = []));
      fl.push({ year: t, n: list.length });
    }
    for (const p of ps) tryRevolt(pm.polities[p], hits.get(p)!, k, t);
  });

  // ---- 民变 ----
  const tryRevolt = (P: Polity, list: [number, number][], k: number, t: number): boolean => {
    const pid = P.id;
    const N = pm.size[pid];
    if (P.ended !== undefined || N < REVOLT_STATE || rebelNow(pid) || wm.iv?.unites(pid, t)) return false;
    // 这次的饥荒表里还没算进去(每年年初才算),先加上
    const u = pol.unrest!(P, t) + (pol.famineBump?.(P, list.length) ?? 0);
    const odds = REVOLT_ODDS * fexp(REVOLT_K * (u - REVOLT_U0)) * Math.min(1, list.length / 3);
    if (keyed(um.base, pm.ptag[pid], k, U_REVOLT) >= odds / (1 + odds)) return false;
    const capR = pm.settlements[capitalAt(P, t)].region;
    // 起事的州:灾最重的、不是国都、有城、不是永久划给它的州(阶段 4 干预)
    let r0 = -1;
    let worst = -1;
    const hit = new Set<number>();
    for (const [r, loss] of list) {
      if (owner[r] !== pid) continue;
      hit.add(r);
      if (r === capR || pm.cityOf[r] < 0 || wm.iv?.locked(r, t)) continue;
      if (loss > worst || (loss === worst && r < r0)) {
        worst = loss;
        r0 = r;
      }
    }
    if (r0 < 0) return false;
    // 从起事的州往外:闹了饥荒的州先,再往外近的(只走陆路);不碰国都
    const limit = Math.min(REVOLT_MAX, Math.max(REVOLT_MIN, Math.floor(N * REVOLT_FRAC)));
    const group = grow(pid, r0, limit, t, (r) => (hit.has(r) ? 0 : 1), capR);
    if (group.length < REVOLT_MIN) return false;
    const sid = pol.biggestCity!(group, t);
    if (sid < 0) return false;
    const full = pol.cutOff!(pid, group.slice().sort((a, b) => a - b), t, limit * 2 + 2);
    if (!full) return false;
    const rebel = pol.secede!(pid, full, sid, r0, t, 'revolt');
    const w = wm.declare!(pid, rebel.id, t, -1, 'quell');
    um.quell.set(w.id, rebel.id);
    return true;
  };

  /**
   * 从州 r0 往外长一个州组(pid 的国土,只走陆路,不碰 skip):按"cost(州) + 离 r0 隔几州"从小到大挑,最多 limit 州。
   * 返回挑上的州(按挑的先后)
   */
  const grow = (pid: number, r0: number, limit: number, t: number, cost: (r: number) => number, skip: number): number[] => {
    const st = ++stamp;
    const out: number[] = [];
    const front: [number, number][] = [[r0, 0]];
    mark[r0] = st;
    hop[r0] = 0;
    while (front.length && out.length < limit) {
      let bi = 0;
      for (let i = 1; i < front.length; i++) {
        const a = front[i];
        const b = front[bi];
        if (a[1] < b[1] || (a[1] === b[1] && reg.seat[a[0]] < reg.seat[b[0]])) bi = i;
      }
      const [r] = front.splice(bi, 1)[0];
      out.push(r);
      for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
        const j = reg.adj[e];
        const kind = reg.adjKind[e];
        if (kind === AdjKind.Strait || kind === AdjKind.SeaRoute) continue;
        if (mark[j] === st || owner[j] !== pid || j === skip || wm.iv?.locked(j, t)) continue;
        mark[j] = st;
        hop[j] = hop[r] + 1;
        front.push([j, hop[j] + cost(j)]);
      }
    }
    return out;
  };

  // ---- 大崩解 ----
  /** 各块陆地上的州(州号升序) */
  const lands: number[][] = [];
  for (let r = 0; r < R; r++) (lands[reg.landmass[r]] ??= []).push(r);
  /** 国家 pid 占它国土最多的那块陆地上有人住的州的几成 */
  const landShare = (pid: number): number => {
    const by = new Map<number, number>();
    for (const r of pm.lands[pid]) by.set(reg.landmass[r], (by.get(reg.landmass[r]) ?? 0) + 1);
    let best = -1;
    let most = 0;
    for (const [l, n] of by) if (n > most || (n === most && l < best)) [best, most] = [l, n];
    let lived = 0;
    for (const r of lands[best]) if (culture[r] >= 0) lived++;
    return most / Math.max(1, lived);
  };
  pol.crisis = (P: Polity, k: number, t: number): boolean => {
    const pid = P.id;
    const N = pm.size[pid];
    if (N < COLLAPSE_MIN || t - P.founded < COLLAPSE_AGE || t - (um.collapsed.get(pid) ?? -Infinity) < COLLAPSE_REST) return false;
    if (wm.iv?.unites(pid, t)) return false; // 阶段 4 干预"禁止分裂"
    const share = landShare(pid);
    if (share < HEG_GATE) return false;
    const u = pol.unrest!(P, t) + HEG_W * Math.min(1, Math.max(0, (share - HEG_0) / HEG_SPAN));
    const odds = COLLAPSE_ODDS * fexp(COLLAPSE_K * (u - COLLAPSE_U0));
    if (keyed(um.base, pm.ptag[pid], k, U_COLLAPSE) >= odds / (1 + odds)) return false;
    return collapse(P, k, t);
  };

  const collapse = (P: Polity, k: number, t: number): boolean => {
    const pid = P.id;
    const tag = pm.ptag[pid];
    const mine = pm.lands[pid].slice();
    const N = mine.length;
    const capSid = capitalAt(P, t);
    const capR = pm.settlements[capSid].region;
    const dist = pm.capDist[pid];
    // 留给原来的国家的:离国都最近的几成
    const keepFrac = KEEP[0] + (KEEP[1] - KEEP[0]) * keyed(um.base, tag, k, U_KEEP);
    const byDist = mine.slice().sort((a, b) => dist[a] - dist[b] || reg.seat[a] - reg.seat[b]);
    const keep = new Set<number>(byDist.slice(0, Math.max(1, Math.ceil(N * keepFrac))));
    keep.add(capR);
    // 永久划给它的州(阶段 4 干预)不散出去
    const rest = mine.filter((r) => !keep.has(r) && !wm.iv?.locked(r, t));
    // 散成几块
    const m = Math.max(2, Math.min(4, Math.floor(rest.length / PIECE_SIZE + keyed(um.base, tag, k, U_PIECES))));
    if (rest.length < m * PIECE_MIN) return false;
    const inRest = new Set(rest);
    // 不满(离国都远、异族;加一点随机)
    const grudge = (r: number) =>
      (dist[r] < Infinity ? Math.min(4, dist[r] / REACH) : 4) + (culture[r] !== P.culture ? 0.7 : 0) + 0.5 * keyed4(um.base, tag, reg.seat[r], k, U_SEED);
    // 起事的州:第一块挑最不满的,往后挑离已有各块最远(隔的州数;平手看不满)的
    const seeds: number[] = [];
    const away = new Float64Array(R).fill(Infinity);
    const bfs = (src: number) => {
      const st = ++stamp;
      let qt = 0;
      queue[qt++] = src;
      mark[src] = st;
      hop[src] = 0;
      for (let h = 0; h < qt; h++) {
        const r = queue[h];
        if (hop[r] < away[r]) away[r] = hop[r];
        for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
          const j = reg.adj[e];
          if (mark[j] === st || !inRest.has(j) || reg.adjKind[e] === AdjKind.SeaRoute || reg.adjKind[e] === AdjKind.Strait) continue;
          mark[j] = st;
          hop[j] = hop[r] + 1;
          queue[qt++] = j;
        }
      }
    };
    for (let i = 0; i < m; i++) {
      let best = -1;
      let bs = -Infinity;
      for (const r of rest) {
        if (seeds.includes(r)) continue;
        const a = away[r];
        const s = (i === 0 ? 0 : (a < Infinity ? a : 1000) * 10) + grudge(r);
        if (s > bs) {
          bs = s;
          best = r;
        }
      }
      if (best < 0) break;
      seeds.push(best);
      bfs(best);
    }
    // 各州归最近的那块(同时从各块往外长,只走陆路;海峡、航线隔着的留给原来的国家)
    const piece = new Int32Array(R).fill(-1);
    let qt = 0;
    for (let i = 0; i < seeds.length; i++) {
      piece[seeds[i]] = i;
      queue[qt++] = seeds[i];
    }
    for (let h = 0; h < qt; h++) {
      const r = queue[h];
      for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
        const j = reg.adj[e];
        if (piece[j] >= 0 || !inRest.has(j) || reg.adjKind[e] === AdjKind.SeaRoute || reg.adjKind[e] === AdjKind.Strait) continue;
        piece[j] = piece[r];
        queue[qt++] = j;
      }
    }
    const groups: number[][] = seeds.map(() => []);
    for (const r of rest) if (piece[r] >= 0) groups[piece[r]].push(r);
    // 怎么崩
    const era = devModelOf(sim)?.era[capR] ?? 0;
    const fl = um.famines.get(pid);
    let famine = 0;
    if (fl) for (let i = fl.length - 1; i >= 0 && t - fl[i].year < FAMINE_YEARS; i--) famine += fl[i].n;
    const wT = (era < 2 ? 1.5 : era < 3 ? 0.4 : 0.1) + (P.kind === 'nomad' ? 1.2 : 0);
    const wL = 0.6 + 2 * Math.min(1, famine / Math.max(FAMINE_FULL_MIN, FAMINE_FULL * N)) + (wm.active.some((w) => w.a === pid || w.b === pid) ? 0.4 : 0);
    const wC = 1.2;
    const x = keyed(um.base, tag, k, U_KIND) * (wT + wL + wC);
    const kind = x < wC ? 0 : x < wC + wL ? 1 : 2;
    if (kind === 2) {
      // 两样都崩:散出去的州不立国,散回部落地带
      let n = 0;
      const out: number[] = [];
      for (const g of groups) for (const r of g) out.push(r);
      if (out.length < m * PIECE_MIN) return false;
      out.sort((a, b) => a - b);
      sim.record('collapse', { a: pid, b: 2, region: capR, settlement: capSid, war: out.length });
      for (const r of out) {
        sim.setOwner(Layer.Polity, r, -1, Ev.Collapse);
        n++;
      }
      um.collapsed.set(pid, t);
      pol.lastSplit.set(pid, t);
      return n > 0;
    }
    // 中央崩、地方崩:各块以块里人口最多的城为都自立(没有城的块留给原来的国家)
    const ready: [number[], number, number][] = [];
    groups.forEach((g, i) => {
      if (g.length < PIECE_MIN) return;
      const sid = pol.biggestCity!(g, t);
      if (sid >= 0) ready.push([g.sort((a, b) => a - b), sid, seeds[i]]);
    });
    if (ready.length < 2) return false;
    sim.record('collapse', { a: pid, b: kind, region: capR, settlement: capSid, war: ready.length });
    for (const [g, sid, r0] of ready) pol.secede!(pid, g, sid, r0, t, 'split', 'collapse');
    um.collapsed.set(pid, t);
    return true;
  };
}

/**
 * 由 Civ 重建动荡的推演状态(CivSim.fromCiv 调用,在 resumeDevelopment 之后):
 * 饥荒、讨伐民变的战争、大崩解从史事里读;再算出下一次看年景,补进引擎。
 */
export function resumeUnrest(sim: CivSim, _world: World, civ: Civ): void {
  const pm = polityModelOf(sim);
  const wm = warModelOf(sim);
  const pol = politicsModelOf(sim);
  if (!pm || !wm || !pol) return;
  const um = newModel(pm, wm, pol, civ.seed);
  const A = civ.annals;
  for (let i = 0; i < A.length; i++) {
    const e = A[i];
    if (e.kind === 'famine' && e.a >= 0) {
      let fl = um.famines.get(e.a);
      if (!fl) um.famines.set(e.a, (fl = []));
      fl.push({ year: e.year, n: e.b });
    } else if (e.kind === 'plague' && e.a >= 0) {
      let pl = um.plagues.get(e.a);
      if (!pl) um.plagues.set(e.a, (pl = []));
      pl.push({ year: e.year, n: e.b });
    } else if (e.kind === 'revolt') {
      const w = A[i + 1];
      if (w && w.kind === 'war' && w.cause === 'quell' && w.b === e.a) um.quell.set(w.war, e.a);
    } else if (e.kind === 'war' && e.cause === 'heir') um.claims.set(e.war, e.b);
    else if (e.kind === 'collapse') um.collapsed.set(e.a, e.year);
  }
  hook(sim, um);
  let k = 0;
  while (quantize(famineTime(um, k)) <= sim.now) k++;
  // 一口气推时上一次看年景那一刻预约的(第一次是开头)
  sim.schedule(famineTime(um, k), Ev.FamineCheck, k, 0, bookChain(k, (j) => famineTime(um, j), BOOKED_AT_START));
}

// ---------------------------------------------------------------------------
// 统计(调参、单测用)

export interface UnrestStats {
  /** 饥荒(史事条数;部落地带的不记)、闹饥荒的州数 */
  famines: number;
  famineRegions: number;
  /** 民变;被讨平的、攻破都城亡了原国的 */
  revolts: number;
  quelled: number;
  overthrows: number;
  /** 大崩解:三种崩法各几次 */
  collapses: [number, number, number];
}

export function unrestStats(civ: Civ): UnrestStats {
  const A = civ.annals;
  const quell = new Map<number, number>();
  const out: UnrestStats = { famines: 0, famineRegions: 0, revolts: 0, quelled: 0, overthrows: 0, collapses: [0, 0, 0] };
  A.forEach((e, i) => {
    if (e.kind === 'famine') {
      out.famines++;
      out.famineRegions += e.b;
    } else if (e.kind === 'revolt') {
      out.revolts++;
      const w = A[i + 1];
      if (w && w.kind === 'war' && w.cause === 'quell') quell.set(w.war, e.a);
    } else if (e.kind === 'collapse') out.collapses[e.b]++;
    else if (e.kind === 'fall' && quell.has(e.war)) {
      if (quell.get(e.war) === e.a) out.quelled++;
      else if (quell.get(e.war) === e.b) out.overthrows++;
    }
  });
  return out;
}

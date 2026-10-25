/**
 * 中央管到什么程度:每州一个"中央管得到几成"(0–1),地方坐大了会割据(名义上还归这国、实际自己说了算),
 * 割据的地方打仗时不出兵(抗命),割据久了容易真的自立。
 * 挂在同一个推演引擎(sim.ts)上,不改归属(真自立还是走 politics.ts 的分裂);发生了什么记进史事(warlord / reclaim / defy)。
 *
 * 流程(index.ts 在 installUnrest 之后调用 installControl):
 *
 *   **政局的数表**(stateTables.ts;Ev.TableTick,每年年初、发展度之后算一步):各州管得到几成、离国都多远,各国的动荡。
 *     事件层读最近一步算的值(raw、remote、pol.unrest),年里出的事(打下一州、迁都、开战)下一年才算进去;
 *     这一年里才换了国家的州还没管上(c = 0)。表的状态随发展度一起存(Civ.development.state.tables),接着推时接上。
 *
 *   **管得到几成**(raw):国都所在州 = 1;别的州
 *       c = 1 ÷ (1 + (离国都的路程 ÷ 管得到的远近)²) × 异族 FOREIGN × 刚被征服(RECENT 年内,随年数淡去)× 当地大城 BIG_CITY
 *     管得到的远近 = REACH × (1 + ADMIN_GAIN × 国都所在州的行政能力)(发展度,development.ts;行政能力 0–9):
 *     行政越强,远处的州也管得住。分四档(controlTier):直辖、代管、自治,割据的州另算(见下)。
 *     行政能力也折进原来"离国都多远"的那几项(remote:路程 ÷ (FAR_REACH × 行政折算),行政越强远处越不算远):
 *       分裂的离心力(politics.ts),割据的州再加一截(politics.ts 的 LORD_D):割据久了的地方先起兵;
 *       动荡(unrest.ts)的"边远"一项,每有一处割据再加 LORD_U(分裂、民变、大崩解、打仗都用这同一个动荡);
 *       打仗的国力(wars.ts 的 powers)= Σ 城的人口 × 出兵的几成(管得到几成 + LEVY_0,最多 1;割据的州 0:抗命不出兵)。
 *
 *   **割据**(看内政时,politics.ts 在分裂没成之后调 check):国土至少 MIN_SIZE 州、立国满 MIN_AGE 年的国家,
 *     管得最松(c < WARLORD_C)、有城的那州(不是国都、SETTLE 年没换过国家,离心力加一点随机挑),
 *     赔率 = ODDS × e^(K × (动荡 + (WARLORD_C − c) × GAP_W − U0)),换成概率;同时最多 MAX_LORDS 处。
 *     割据的地盘(mark,现算):从那座城所在的州往外走陆路 HOPS 州以内、还是这国的、c < HOLD 的州(不含国都;近的先算,最多 DOMAIN_MAX 州)。
 *     名义上照旧归这国:地图上国界不变,只在「中央管到什么程度」图层上看得出来。
 *     割据了结:①那州换了国家(被打下、自立出去)= 就此了结,不另记;②中央收回(reclaim):以后每次看内政,
 *       那州的 c 已回到 HOLD 以上(行政变强、迁都近了)、或者国都迁到了那座城,就收回;否则按 RECLAIM_P × 1 ÷ (1 + 动荡) 的机会收回。
 *     割据的州起兵自立的,史事 split 记 cause = warlord(编年史写"割据多年,遂……自立")。
 *
 *   **钱粮**(同一张政局的数表,公式见 stateTables.ts):各州田赋、工商、市税(每 FISCAL_EVERY 年按人口、生产 / 运输能力、港口大河算一次),
 *     交上来几成跟着管得到几成(割据的地盘不交),藩属向宗主纳贡;养官、打仗花钱;国库攒到 RESERVE 年的应缴为止。
 *     国库空了还入不敷出 = 国用不足(窘迫 0–1):动荡里加一项(unrest.ts),宣战少、攻方早罢兵(wars.ts 的 broke);
 *     窘迫刚到 NOTE 以上记一条史事 fiscal(同一国 NOTE_REST 年内只记一次;接着推时由史事重建)。
 *
 *   **乡村人口**(同一张政局的数表,每 5 年一步;population.ts):会搬家、逃兵灾,洗劫、饥荒、瘟疫的折损写回表里;田赋读它。
 *
 *   **抗命**(defy):每场战争的第一仗之前(点兵,wars.ts 调 onMuster),交战的一方有割据的地方、地盘里的城人口占全国 DEFY_SHARE 以上,
 *     这处割据 DEFY_REST 年内没抗过命,就记一条 defy(拥兵不出)。国力里本来就不算它(见上),这一条只是让编年史写得出来。
 *
 * **割据不存内存状态**:由史事重建(resumeControl):warlord 开始;reclaim 了结;那州 SETTLE……换过国家的(wm.since 晚于割据那年)也了结。
 * 各州管得到几成每 20 年(发展度那一步之后的那一次数表)存一份快照进 Civ.development.control(给图层用),推演里不读快照。
 * 随机数:keyed(subSeed(seed, 'civ-control'), 国家锚, 第几次看内政, 用途),和处理顺序无关。纯计算,不碰 DOM。
 */
import { Layer, AdjKind, type Civ, type Polity, type TablesState, type Year } from './types';
import { fexp, keyed, keyed4, subSeed } from './rand';
import { Ev, type CivSim } from './sim';
import { polityModelOf, unrestShiftOf, type PolityModel } from './polities';
import { GUIDE_UNREST } from './policy';
import { warModelOf, type War, type WarModel } from './wars';
import { politicsModelOf, type PoliticsModel } from './politics';
import { Cap, CAP_COUNT, cityPopulationsAt, devModelOf, type DevModel } from './development';
import { capacityAt, capitalAt, populationAt } from './growth';
import { TableEngine } from './tables';
import { NEVER } from './devTables';
import { stateCards, type ControlRuleConsts, type FiscalRuleConsts } from './stateTables';
import { UNREST_CONSTS, unrestInputs, unrestModelOf } from './unrest';
import { POP_CONSTS, POP_TABLES, popLayer } from './population';

// ---- 调参(以 20 个种子的统计为准,见 scripts/control-stats.ts) ----
/** 管得到的远近:REACH × (1 + ADMIN_GAIN × 行政能力)(标准路程) */
const REACH = 3.3;
const ADMIN_GAIN = 0.2;
/** 异族的州、刚被征服的州(RECENT 年内,随年数淡去)、当地有大城(城的人口上限有国都的 BIG_RATIO 以上)打的折 */
const FOREIGN = 0.6;
const RECENT = 150;
const RECENT_CUT = 0.35;
const BIG_RATIO = 0.5;
const BIG_CITY = 0.85;
/** 四档:直辖 ≥ TIER_DIRECT,代管 ≥ TIER_PROXY,再低是自治;割据另算 */
const TIER_DIRECT = 0.6;
const TIER_PROXY = 0.35;
/**
 * 分裂的离心力、动荡里"离国都远"的那一项:路程 ÷ (FAR_REACH × 行政折算),最多 REMOTE_MAX;
 * 行政折算 = (1 + ADMIN_GAIN × 行政能力) ÷ (1 + ADMIN_GAIN × ADMIN_REF):行政能力在 ADMIN_REF 时和原来"路程 ÷ 12"一样
 */
const FAR_REACH = 12;
const ADMIN_REF = 1;
const REMOTE_MAX = 4;
/** 动荡:每有一处割据加 LORD_U,最多加 LORD_U_MAX */
const LORD_U = 0.08;
const LORD_U_MAX = 0.24;
/** 出兵的几成 = min(1, c + LEVY_0);割据的州 0 */
const LEVY_0 = 0.45;

// ---- 钱粮(公式见 stateTables.ts;以 20 个种子的统计为准) ----
/** 各州三样收入:田赋(乡村人口)、工商(城的人口)、市税(城的人口,看运输、港口、大河);每样随生产 / 运输能力涨 */
const LAND = 0.05;
const LAND_PROD = 0.25;
const CRAFT = 0.12;
const CRAFT_PROD = 0.3;
const TRADE = 0.06;
const TRADE_MOVE = 0.3;
const PORT_W = 0.8;
const RIVER_W = 0.4;
/** 交上来几成 = REMIT_0 + (1 − REMIT_0) × 管得到几成 */
const REMIT_0 = 0.3;
/** 藩属每年把实收的几成交给宗主 */
const TRIBUTE = 0.1;
/** 岁出:养官占应缴几成;每打一场仗再花应缴的几成 */
const OFFICE = 0.55;
const ARMY = 0.3;
/** 国库最多攒几年的应缴 */
const RESERVE = 1.5;
/** 国库空了还入不敷出:窘迫 = 缺口占岁出的几成 × GAIN(最多 1);新朝初立这么多年内不算 */
const GAIN = 4;
const GRACE = 10;
/** 动荡里"国用不足"一项:FISCAL_W × 窘迫 */
const FISCAL_W = 0.4;
/** 各州人口、能力每几年填一次(三样收入跟着这么久算一次) */
const FISCAL_EVERY = 10;
/** 国用不足记进史事:窘迫到 NOTE 以上(上一年还不到)、同一国这么多年内只记一次 */
const NOTE = 0.5;
const NOTE_REST = 60;

/** 割据:国土至少几州、立国满几年;同时最多几处;c 低于 WARLORD_C 的州才会割据;城的人口至少几千人 */
const MIN_SIZE = 12;
const MIN_AGE = 100;
const MAX_LORDS = 3;
const WARLORD_C = 0.22;
const MIN_POP = 4;
/** 起事、并进地盘的州要这么多年没换过国家(和分裂一样) */
const SETTLE = 30;
/** 赔率 = ODDS × e^(K × (动荡 + (WARLORD_C − c) × GAP_W − U0)) */
const ODDS = 0.07;
const K = 1.5;
const GAP_W = 3;
const U0 = 1.2;
/** 挑哪州:c 越低越先,加一点随机 */
const JITTER = 0.08;
/** 地盘:从那州往外走陆路几州以内、c 低于 HOLD 的州 */
const HOPS = 2;
const HOLD = 0.45;
/** 地盘最多几州(近的先算) */
const DOMAIN_MAX = 8;
/** 收回:那州的 c 回到 HOLD 以上就收回;不然每次看内政按 RECLAIM_P ÷ (1 + 动荡) 的机会收回;割据满 RECLAIM_AGE 年以前不收 */
const RECLAIM_P = 0.15;
const RECLAIM_AGE = 20;
/** 抗命:地盘里的城人口占全国几成以上才记;同一处这么多年内只记一次 */
const DEFY_SHARE = 0.06;
const DEFY_REST = 100;

/** 快照里一州存的数:0 = 不在国家里;1–101 = 1 + 管得到几成 × 100;LORD_BYTE = 割据 */
export const LORD_BYTE = 200;
/** 四档的名字(controlTier 的下标) */
export const CONTROL_TIERS = ['直辖', '代管', '自治', '割据'] as const;

// 随机数用途编号
const U_PICK = 1;
const U_RISE = 2;
const U_RECLAIM = 3;

/** 快照里的一个数是哪一档(0 直辖、1 代管、2 自治、3 割据);0(不在国家里)当自治 */
export function controlTier(v: number): number {
  if (v === LORD_BYTE) return 3;
  const c = (v - 1) / 100;
  return c >= TIER_DIRECT ? 0 : c >= TIER_PROXY ? 1 : 2;
}

/** 快照里的一个数 → 管得到几成(0–1;割据 = 0;不在国家里 = NaN) */
export function controlShare(v: number): number {
  if (v === 0) return NaN;
  if (v === LORD_BYTE) return 0;
  return (v - 1) / 100;
}

/** 某一年各州的快照(取不晚于这一年的最近一份;没有快照 = null)。不复制,别改 */
export function controlAt(civ: Pick<Civ, 'development'>, year: Year): Uint8Array | null {
  const dev = civ.development;
  const ys = dev?.controlYears;
  if (!dev?.control || !ys?.length || year < ys[0]) return null;
  let lo = 0;
  let hi = ys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ys[mid] <= year) lo = mid + 1;
    else hi = mid;
  }
  return dev.control[lo - 1] ?? null;
}

/** 一处割据 */
export interface Warlord {
  /** 名义上的国家 */
  p: number;
  /** 起事的那座城所在的州、那座城 */
  region: number;
  city: number;
  /** 割据那年 */
  start: Year;
  /** 收回了(那年);没收回 = undefined */
  end?: Year;
  /** 最近一次抗命 */
  defied: Year;
}

export interface ControlModel {
  pm: PolityModel;
  wm: WarModel;
  pol: PoliticsModel;
  base: number;
  /** 所有割据(按先后;了结了的也留着,end 记上) */
  lords: Warlord[];
  /** 州 c(0–1;读每年年初算的数表) */
  raw: (p: number, r: number, t: Year) => number;
  /** 分裂的离心力、动荡里"离国都远"的那一项:路程按行政能力折算(最多 REMOTE_MAX) */
  remote: (p: number, r: number, t: Year) => number;
  /** 国家 p 此刻还在的割据 */
  lordsOf: (p: number, t: Year) => Warlord[];
  /** 标出国家 p 此刻割据的地盘(inLord(r) 为真);返回有几处 */
  mark: (p: number, t: Year) => number;
  inLord: (r: number) => boolean;
}

const models = new WeakMap<CivSim, ControlModel>();

/** 推演引擎上挂着的模型(测试、统计用) */
export function controlModelOf(sim: CivSim): ControlModel | undefined {
  return models.get(sim);
}

/** 登记(installUnrest 之后调用):挂到分裂、动荡、打仗、发展度那几处 */
export function installControl(sim: CivSim, seed: number): ControlModel | undefined {
  return hook(sim, seed, [], null, new Map());
}

/** 接着推(CivSim.fromCiv,在各层 resume 之后):割据由史事重建 */
export function resumeControl(sim: CivSim, civ: Civ): void {
  const lords: Warlord[] = [];
  /** 同一国、同一州最近起的那一处(以前那州丢过又割据过的,前一处早已了结) */
  const latest = (p: number, r: number) => {
    for (let i = lords.length - 1; i >= 0; i--) if (lords[i].p === p && lords[i].region === r) return lords[i];
    return undefined;
  };
  /** 各国最近一次记国用不足的年份 */
  const noted = new Map<number, Year>();
  for (const e of civ.annals) {
    if (e.kind === 'fiscal') noted.set(e.a, e.year);
    else if (e.kind === 'warlord') lords.push({ p: e.a, region: e.region, city: e.settlement, start: e.year, defied: -Infinity });
    else if (e.kind === 'reclaim') {
      const w = latest(e.a, e.region);
      if (w) w.end = e.year;
    } else if (e.kind === 'defy') {
      const w = latest(e.a, e.region);
      if (w) w.defied = e.year;
    }
  }
  hook(sim, civ.seed, lords, civ.development?.state?.tables ?? undefined, noted);
}

/** 政局的数表(管得到几成、离国都多远、动荡;见 stateTables.ts)里归这里管的常数 */
export const CONTROL_CONSTS: ControlRuleConsts = { REACH, ADMIN_GAIN, FOREIGN, RECENT, RECENT_CUT, BIG_CITY, FAR_REACH, ADMIN_REF, REMOTE_MAX, LORD_U, LORD_U_MAX };
/** 钱粮的常数(见 stateTables.ts) */
export const FISCAL_CONSTS: FiscalRuleConsts = {
  LAND,
  LAND_PROD,
  CRAFT,
  CRAFT_PROD,
  TRADE,
  TRADE_MOVE,
  PORT_W,
  RIVER_W,
  REMIT_0,
  TRIBUTE,
  OFFICE,
  ARMY,
  RESERVE,
  GAIN,
  GRACE,
  FISCAL_W,
  FISCAL_EVERY,
};
const STATE_CARDS = stateCards(CONTROL_CONSTS, UNREST_CONSTS, FISCAL_CONSTS, POP_CONSTS);
/**
 * 存下来的表(接着推时填回):算出来的几张(三样收入几年才算一次、国库和乡村人口接着上一年的,都得存),和事件层还要读的几张输入表。
 * 岁入、岁出每年重算,不用存(应缴要存:看邻国时读国库攒到几成)
 */
const SAVED_TABLES = ['国', '饥荒', '州数', '管辖', '边远', ...POP_TABLES, '田赋', '工商', '市税', '税', '应缴', '实收', '国库', '窘迫', '动荡底', '动荡'] as const;

/**
 * saved:接着推时存档里政局数表的状态(null = 从头推;undefined = 存档里没有,接着推的那一刻现算一次)
 */
function hook(sim: CivSim, seed: number, lords: Warlord[], saved: TablesState | null | undefined, noted: Map<number, Year>): ControlModel | undefined {
  const pm = polityModelOf(sim);
  const wm = warModelOf(sim);
  const pol = politicsModelOf(sim);
  const dev = devModelOf(sim);
  const um = unrestModelOf(sim);
  if (!pm || !wm || !pol || !dev || !um) return undefined;
  const reg = pm.terrain.regions;
  const R = pm.terrain.R;
  const culture = sim.owners[Layer.Culture];
  const owner = sim.owners[Layer.Polity];

  const capRegion = (P: Polity, t: number) => pm.settlements[capitalAt(P, t)].region;

  // ---- 政局的数表(管得到几成、离国都多远、动荡;规则见 stateTables.ts):每年年初填好输入、算一步,这一年里的事件读它 ----
  const eng = new TableEngine({
    seed: subSeed(seed, 'civ-state'),
    cards: STATE_CARDS,
    units: { region: { count: R, adjStart: reg.adjStart, adj: reg.adj, adjKind: reg.adjKind, seat: reg.seat } },
    owner: '国',
  });
  /** 上一步算的时候各州归哪国(这一年里换了国家的州,表里的值是原来那国的) */
  const tOwn = eng.input('国');
  let tCtl = eng.get('管辖');
  let tFar = eng.get('边远');
  let tU = eng.get('动荡');
  let tBroke = eng.get('窘迫');
  /** 算完一步换了新的数组(表是双缓冲的),重新拿 */
  const refresh = () => {
    tCtl = eng.get('管辖');
    tFar = eng.get('边远');
    tU = eng.get('动荡');
    tBroke = eng.get('窘迫');
  };
  const T = pm.terrain;
  const cityPop = new Float64Array(R);
  // 乡村人口(population.ts):接着推时,存的那一年以前的折损、兵灾算过了
  const pop = popLayer(sim, pm, dev, eng, saved === null ? null : saved && saved.last > -Infinity ? saved.last : Math.floor(sim.now));
  let capR = new Int32Array(0);
  let capCap = new Float64Array(0);
  /** 填输入表:此刻各州的归属、离国都的路程、异族、刚被征服、大城;各国国都所在州的行政能力、危机、当朝几年、近年的饥荒疫病、民变、割据 */
  const fill = (t: number): void => {
    const NP = pm.polities.length;
    eng.setPolities(NP);
    if (capR.length < NP) {
      capR = new Int32Array(NP);
      capCap = new Float64Array(NP);
    }
    const [admin, crisis, age, famine, plague, quell, lordsN, size] = ['国都行政', '危机', '当朝', '饥荒', '疫病', '平叛', '割据', '州数'].map((id) => eng.input(id));
    const lordLand = eng.input('割据州').fill(0);
    for (let p = 0; p < NP; p++) {
      capR[p] = -1;
      const P = pm.polities[p];
      if (!(pm.size[p] > 0)) {
        admin[p] = crisis[p] = age[p] = famine[p] = plague[p] = quell[p] = lordsN[p] = size[p] = 0;
        continue;
      }
      const sid = capitalAt(P, t);
      const r = pm.settlements[sid].region;
      capR[p] = r;
      capCap[p] = capacityAt(pm.settlements[sid], t);
      admin[p] = dev.cur[r * CAP_COUNT + Cap.Administration] || 0;
      crisis[p] = pol.strain!(P, t);
      const x = unrestInputs(um, P, t);
      age[p] = x.age;
      famine[p] = x.famine;
      plague[p] = x.plague;
      quell[p] = x.quell;
      lordsN[p] = lordsOf(p, t).length;
      size[p] = pm.size[p];
      if (lordsN[p] && mark(p, t)) for (const r of pm.lands[p]) if (inLord(r)) lordLand[r] = 1;
    }
    // 在打几场仗;贡赋按上一步藩属的实收算
    const [wars, paid, got] = ['战事', '纳贡', '收贡'].map((id) => eng.input(id).fill(0));
    for (const w of wm.active) {
      if (w.a < NP) wars[w.a]++;
      if (w.b < NP) wars[w.b]++;
    }
    const dm = wm.dm;
    if (dm && started) {
      const rev = eng.get('实收');
      // 按国家编号的先后加(和接着推时重建的先后无关)
      for (let v = 0; v < Math.min(NP, rev.length); v++) {
        if (!dm.liege.has(v) || !(pm.size[v] > 0)) continue;
        const l = dm.liegeOf(v);
        if (l < 0 || l >= NP) continue;
        const x = TRIBUTE * rev[v];
        paid[v] += x;
        got[l] += x;
      }
    }
    // 三样收入要的各州城的人口、能力:几年填一次(只在那几张表要算的年份填,接着推时也一样;乡村人口读表)
    if (t % FISCAL_EVERY === 0) {
      cityPopulationsAt(dev, t, owner, cityPop);
      const [iCity, iProd, iMove, iPort, iRiver] = ['城民', '生产', '运输', '港口', '大河'].map((id) => eng.input(id));
      for (let r = 0; r < R; r++) {
        iCity[r] = cityPop[r];
        iProd[r] = dev.cur[r * CAP_COUNT + Cap.Production] || 0;
        iMove[r] = dev.cur[r * CAP_COUNT + Cap.Transport] || 0;
        iPort[r] = pm.port[r];
        iRiver[r] = T.riverSeat[r] | T.river[r];
      }
    }
    const [dist, seat, foreign, recent, big] = ['路程', '是国都', '异族', '新征', '大城'].map((id) => eng.input(id));
    const { capDist, cityOf, settlements, polities } = pm;
    const { prev, since } = wm;
    for (let r = 0; r < R; r++) {
      const p = owner[r];
      tOwn[r] = p;
      if (p < 0) {
        dist[r] = seat[r] = foreign[r] = big[r] = 0;
        recent[r] = NEVER;
        continue;
      }
      const d = capDist[p][r];
      dist[r] = d < Infinity ? d : NEVER;
      seat[r] = r === capR[p] ? 1 : 0;
      foreign[r] = culture[r] !== polities[p].culture ? 1 : 0;
      recent[r] = prev[r] >= 0 && prev[r] !== p ? t - since[r] : NEVER;
      const s = cityOf[r];
      big[r] = s >= 0 && settlements[s].ended === undefined && capacityAt(settlements[s], t) >= BIG_RATIO * capCap[p] ? 1 : 0;
    }
  };

  /** 州 c(0–1):上一步算的;这一年里才到手的州还没管上(0) */
  const raw = (p: number, r: number, _t: number): number => (tOwn[r] === p ? tCtl[r] : 0);
  /** 离国都多远:上一步算的;这一年里才到手的州按最远算(还没安顿下来,分裂时本来就不挑它) */
  const remote = (p: number, r: number, _t: number): number => (tOwn[r] === p ? tFar[r] : REMOTE_MAX);

  /** 割据 w 此刻还在不在:没收回、那州还是这国的、割据以后没换过国家 */
  const alive = (w: Warlord) => w.end === undefined && owner[w.region] === w.p && wm.since[w.region] <= w.start;
  const lordsOf = (p: number, _t: number): Warlord[] => {
    const out: Warlord[] = [];
    for (const w of lords) if (w.p === p && alive(w)) out.push(w);
    return out;
  };

  // 地盘的标记(每次 mark 换一个戳)
  const mk = new Int32Array(R);
  let stamp = 0;
  const queue = new Int32Array(R);
  const hop = new Int32Array(R);
  /** 割据 w 的地盘标上 stamp(从那州往外走陆路 HOPS 州以内、还是这国的、c < HOLD 的州,不含国都);返回地盘里的州 */
  const domain = (w: Warlord, t: number, out?: number[]): void => {
    const P = pm.polities[w.p];
    const capR = capRegion(P, t);
    if (w.region === capR) return; // 迁都迁到了割据的那座城:不算割据(下次看内政就收回)
    let qt = 0;
    queue[qt++] = w.region;
    mk[w.region] = stamp;
    hop[w.region] = 0;
    out?.push(w.region);
    for (let h = 0; h < qt; h++) {
      const r = queue[h];
      if (hop[r] >= HOPS) continue;
      for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
        const j = reg.adj[e];
        const kind = reg.adjKind[e];
        if (kind === AdjKind.Strait || kind === AdjKind.SeaRoute) continue;
        if (qt >= DOMAIN_MAX) return;
        if (mk[j] === stamp || owner[j] !== w.p || j === capR || raw(w.p, j, t) >= HOLD) continue;
        mk[j] = stamp;
        hop[j] = hop[r] + 1;
        queue[qt++] = j;
        out?.push(j);
      }
    }
  };
  const mark = (p: number, t: number): number => {
    stamp++;
    const ls = lordsOf(p, t);
    for (const w of ls) domain(w, t);
    return ls.length;
  };
  const inLord = (r: number) => mk[r] === stamp;

  const cm: ControlModel = { pm, wm, pol, base: subSeed(seed, 'civ-control'), lords, raw, remote, lordsOf, mark, inLord };
  models.set(sim, cm);

  // ---- 挂到分裂(离心力)、动荡、看内政 ----
  pol.control = cm;
  pol.lordCheck = (P, k, t) => check(P, k, t);

  // ---- 打仗:出兵的几成、抗命 ----
  wm.levy = (p, t) => {
    const lordsN = mark(p, t);
    return (r: number) => (lordsN && inLord(r) ? 0 : Math.min(1, raw(p, r, t) + LEVY_0));
  };
  wm.onMuster = (w: War, t: number) => {
    for (const x of [w.a, w.b]) {
      const ls = lordsOf(x, t);
      if (!ls.length) continue;
      let total = 0;
      for (const r of pm.lands[x]) {
        const c = pm.cityOf[r];
        if (c >= 0) total += populationAt(pm.settlements[c], t);
      }
      for (const l of ls) {
        if (t - l.defied < DEFY_REST) continue;
        const rs: number[] = [];
        stamp++;
        domain(l, t, rs);
        let sum = 0;
        for (const r of rs) {
          const c = pm.cityOf[r];
          if (c >= 0) sum += populationAt(pm.settlements[c], t);
        }
        if (sum < DEFY_SHARE * total) continue;
        l.defied = t;
        sim.record('defy', { a: x, b: x === w.a ? w.b : w.a, region: l.region, settlement: l.city, war: w.id });
      }
    }
  };

  /** 看内政时(分裂没成之后):先看收回,再看会不会新起一处割据;出了一件事 = true */
  const check = (P: Polity, k: number, t: number): boolean => {
    const p = P.id;
    const ls = lordsOf(p, t);
    const u = pol.unrest ? pol.unrest(P, t) : 0;
    // 收回
    const capR = capRegion(P, t);
    for (const w of ls) {
      const seat = w.region === capR;
      if (!seat && t - w.start < RECLAIM_AGE) continue;
      const c = raw(p, w.region, t);
      if (seat || c >= HOLD || keyed4(cm.base, pm.ptag[p], reg.seat[w.region], k, U_RECLAIM) < RECLAIM_P / (1 + u)) {
        w.end = t;
        sim.record('reclaim', { a: p, region: w.region, settlement: w.city, war: Math.round(t - w.start) });
        return true;
      }
    }
    if (pm.size[p] < MIN_SIZE || t - P.founded < MIN_AGE || ls.length >= MAX_LORDS) return false;
    if (wm.iv?.unites(p, t)) return false; // 阶段 4 干预"禁止分裂":也不割据
    // 挑管得最松、有城的那州
    stamp++;
    for (const w of ls) domain(w, t);
    let r0 = -1;
    let c0 = Infinity;
    let s0 = Infinity;
    for (const r of pm.lands[p]) {
      if (r === capR || mk[r] === stamp) continue;
      const s = pm.cityOf[r];
      if (s < 0 || pm.settlements[s].ended !== undefined) continue;
      if (t - wm.since[r] < SETTLE || wm.iv?.locked(r, t)) continue;
      const c = raw(p, r, t);
      if (c >= WARLORD_C) continue;
      if (populationAt(pm.settlements[s], t) < MIN_POP) continue;
      const score = c + JITTER * keyed4(cm.base, pm.ptag[p], reg.seat[r], k, U_PICK);
      if (score < s0) {
        s0 = score;
        c0 = c;
        r0 = r;
      }
    }
    if (r0 < 0) return false;
    const odds = ODDS * fexp(K * (u + (WARLORD_C - c0) * GAP_W - U0));
    if (keyed(cm.base, pm.ptag[p], k, U_RISE) >= odds / (1 + odds)) return false;
    lords.push({ p, region: r0, city: pm.cityOf[r0], start: t, defied: -Infinity });
    // 地盘有几州(借用 war 列)
    const rs: number[] = [];
    stamp++;
    domain(lords[lords.length - 1], t, rs);
    sim.record('warlord', { a: p, region: r0, settlement: pm.cityOf[r0], war: rs.length });
    return true;
  };

  // ---- 动荡:读表(这一年里才立的国还没算过 = 0);民变时这次饥荒先加上(表里下一年才算进去) ----
  // 照大纲顺着引的动荡加减(policy.ts)读的时候加上:引的那一刻就算,不等下一年
  const guided = (p: number, t: number, u: number): number => {
    const g = unrestShiftOf(pm, p, t);
    return g ? Math.max(0, u + GUIDE_UNREST * g) : u;
  };
  pol.unrest = (P, t) => guided(P.id, t, P.id < tU.length ? tU[P.id] : 0);
  wm.unrest = (p, t) => guided(p, t, p < tU.length ? tU[p] : 0);
  // ---- 钱粮:国用不足(窘迫)让宣战少、战事早罢(wars.ts) ----
  wm.broke = (p, _t) => (p < tBroke.length ? tBroke[p] : 0);
  wm.purse = (p, _t) => {
    if (p >= tBroke.length) return 1;
    const full = RESERVE * eng.value('应缴', p);
    return full > 0 ? Math.min(1, eng.value('国库', p) / full) : 1;
  };
  pol.famineBump = (P, n) => {
    const p = P.id;
    if (p >= tU.length) return 0;
    const N = eng.value('州数', p);
    if (!(N > 0)) return 0;
    const n0 = eng.value('饥荒', p);
    const full = Math.max(UNREST_CONSTS.FAMINE_FULL_MIN, UNREST_CONSTS.FAMINE_FULL * N);
    const add = UNREST_CONSTS.FAMINE_W * (Math.min(1, (n0 + n) / full) - Math.min(1, n0 / full));
    // 压到 0 以上之前加(新朝初立减的那一点先抵掉)
    const u0 = eng.value('动荡底', p);
    return Math.max(0, u0 + add) - Math.max(0, u0);
  };

  // ---- 每年一步;发展度刚算完的那一年存一份快照(给图层用) ----
  let started = false;
  let last = -Infinity;
  let before = new Float64Array(0);
  const tick = (t: number): void => {
    fill(t);
    if (!started) {
      eng.start(t);
      started = true;
    }
    pop.prepare(t);
    if (before.length < tBroke.length) before = new Float64Array(tBroke.length);
    before.set(tBroke);
    eng.step(t);
    last = t;
    pop.done(t);
    refresh();
    note(t);
    if (dev.last === t) snapshot(t);
  };
  /** 国用不足:窘迫这一年到了 NOTE 以上(上一年还不到),记一条 fiscal;war 列记主要是因为打仗(0)还是地方拖欠(1) */
  const note = (t: number): void => {
    for (let p = 0; p < tBroke.length; p++) {
      if (tBroke[p] < NOTE || (p < before.length && before[p] >= NOTE) || !(pm.size[p] > 0)) continue;
      if (t - (noted.get(p) ?? -Infinity) < NOTE_REST) continue;
      noted.set(p, t);
      const P = pm.polities[p];
      const sid = capitalAt(P, t);
      const owed = eng.value('应缴', p);
      const army = ARMY * eng.value('战事', p) * owed;
      const arrears = owed - eng.value('实收', p);
      sim.record('fiscal', { a: p, region: pm.settlements[sid].region, settlement: sid, war: army >= arrears ? 0 : 1 });
    }
  };
  const snapshot = (y: number): void => {
    const snap = new Uint8Array(R);
    const P = pm.polities.length;
    for (let p = 0; p < P; p++) {
      if (!(pm.size[p] > 0)) continue;
      const lordsN = mark(p, y);
      for (const r of pm.lands[p]) {
        if (lordsN && inLord(r)) snap[r] = LORD_BYTE;
        else snap[r] = 1 + Math.round(100 * Math.min(1, Math.max(0, raw(p, r, y))));
      }
    }
    pushSnap(dev, y, snap);
  };
  sim.on(Ev.TableTick, (_a, _b, t) => {
    tick(t);
    sim.schedule(t + 1, Ev.TableTick, 0, 0);
  });
  dev.saveTables = () => ({ last, data: Object.fromEntries(SAVED_TABLES.map((id) => [id, eng.get(id).slice()])) });
  if (saved === null) sim.schedule(Math.max(0, Math.ceil(sim.now)), Ev.TableTick, 0, 0);
  else if (saved && saved.last > -Infinity) {
    // 接着存档里的状态算(国的个数按存的;地形大事以后多出来的州补上)
    eng.setPolities(saved.data['动荡']?.length ?? 0);
    eng.start(saved.last);
    for (const id of SAVED_TABLES) {
      const v = saved.data[id];
      if (v) eng.set(id, fit(v, eng.get(id).length, id === '国' ? -1 : 0));
    }
    eng.resume(saved.last);
    started = true;
    last = saved.last;
    refresh();
    sim.schedule(last + 1, Ev.TableTick, 0, 0);
  } else {
    // 旧存档没存:接着推的那一刻现算一次
    const y = Math.floor(sim.now);
    tick(y);
    sim.schedule(y + 1, Ev.TableTick, 0, 0);
  }
  return cm;
}

/** 存一份快照(同一年的、更晚的先去掉:接着推时最后一份可能和这一份同年) */
function pushSnap(dev: DevModel, y: Year, snap: Uint8Array): void {
  const ys = dev.controlYears;
  while (ys.length && ys[ys.length - 1] >= y) {
    ys.pop();
    dev.control.pop();
  }
  ys.push(y);
  dev.control.push(snap);
}

/** 存的数组按现在的长度截短、补齐(补的格填 pad) */
function fit(v: Float64Array, n: number, pad: number): Float64Array {
  if (v.length === n) return v;
  const out = new Float64Array(n).fill(pad);
  out.set(v.subarray(0, Math.min(n, v.length)));
  return out;
}

/** 统计(scripts、测试用):割据、收回、抗命的次数,割据自立的次数 */
export function controlStats(civ: Civ): { warlords: number; reclaims: number; defies: number; lordSplits: number } {
  let warlords = 0;
  let reclaims = 0;
  let defies = 0;
  let lordSplits = 0;
  for (const e of civ.annals) {
    if (e.kind === 'warlord') warlords++;
    else if (e.kind === 'reclaim') reclaims++;
    else if (e.kind === 'defy') defies++;
    else if (e.kind === 'split' && e.cause === 'warlord') lordSplits++;
  }
  return { warlords, reclaims, defies, lordSplits };
}

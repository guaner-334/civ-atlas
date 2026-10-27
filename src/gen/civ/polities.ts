/**
 * 城市与国家:建城、S 形成长、港口、立国、国家扩张、国号分档。
 * 全部挂在民族用的同一个推演引擎(sim.ts)上,改归属一律走 setOwner,写进同一本变化日志。
 *
 * 流程(index.ts 调用):
 *   planPolities    民族定好之后:港口、国都间距、城市规模的基准
 *   installPolities 挂到 CivSim 上(在 sim.run 之前):
 *     州有人定居(民族层归属变了)→ 过 5–40 年"建城":治所成为聚落
 *     建城 → 人口上限够大的,算出人口越过立国门槛的那一年(S 形曲线可以直接反解),预约"立国"
 *     立国 → 这一州还没归别国、离别的国都足够远(州图跳数),就成为国都,国家从这里出发
 *     国家拿下一州(国家层归属变了)→ 预约邻州的"国家到达";国土跨过一档就预约"升格"
 *     邻州后来才有人住 → 也给它预约"国家到达"(阶段 3 部落地带的州被同化 / 迁入改换了民族,也重新预约)
 *   (sim.run)
 *   finishPolities  推演之后:配色、起城名 / 国名(含历朝的王朝名,阶段 3 王朝更替)
 *
 * 国家走一步要几年 = STEP_YEARS × 路程 × 地形 × 过界 × 民族(同族 1、异族 ×2.5)× 类型修正 × 离国都远近 × 抖动 ÷ 扩张性
 *   - 只进有人住、还没有国家的州:无人区不去;阶段 2 先到先得,两国相接就停在那里
 *   - 只有海洋国家能跨海(海峡、航线),别的国家不会有跨海领土
 *   - 离国都越远越慢(× e^(离国都的路程 / REACH)):国家不会无限铺开,边远处留下有人住、没有国家的"部落地带"
 *   - 阶段 3 有了战争(wars.ts):国家会丢州、迁都、灭亡。"国家到达"触发时要求这个国家和国都连成一片的国土
 *     还挨着那一州(丢了出发的那一州、或者只剩被切出去的飞地挨着,就不去了:不长出飞地);灭亡的国家撤掉国都间距标记;
 *     迁都后"离国都的路程"按新国都算(迁都那一刻之后预约的才按新的);迁都的下一刻从现有国土往外重新预约一遍
 *     (Ev.Respread:扩张算账按新国都的路程重算,原来嫌远的边地可能值得去了)
 *   - 阶段 4 干预"不许扩张"(interventions.ts,挂在 PolityModel.iv 上):"国家到达"触发时这国在禁令里就不去;
 *     禁令到期那一刻从现有国土重新预约(respread;fromCiv 接着推时 resumePolities 按日志把那一刻的预约也补上)
 *
 * 由 Civ 能重建"接下来该发生什么"(resumePolities,CivSim.fromCiv 调用),不用存事件堆。
 * 随机数:subSeed(seed, 'civ-polity…') + keyed(按实体取),和处理顺序无关。纯计算,不碰 DOM。
 * keyed 的"实体"一律是位置锚(见 rand.ts):州 = 治所地块,城 / 国家 = PolityModel.stag / ptag(地块 + 这州第几个),
 * 改地形后多一个、少一个州或国家,别处的随机数不跟着错位。
 */
import { Biome } from '../biomes';
import type { World } from '../world';
import { MinHeap } from '../util';
import { geometryOf } from '../geometry';
import { AdjKind, Layer, type Annal, type ChangeLog, type Civ, type Culture, type NamePins, type Polity, type PolityLineage, type Regions, type RulerLeanings, type Settlement, type Year } from './types';
import { BIOME_COST } from './habitat';
import { anchorTag, fexp, fpow, keyed, subSeed } from './rand';
import { WORTH_EXP } from './frontier';
import { quantize, Ev, type CivSim } from './sim';
import { KIND_INFO } from './display';
import { OwnerReplay, REF_YEAR, cultureModelOf, cultureTerrain, ownersNear, type CultureModel, type CultureTerrain } from './cultures';
import { RESHAPE_RAMP, SETTLEMENT_RANKS, capacityAt, capitalAt, portAt, portSince, tierOf, yearReaching, yearReachingPop } from './growth';
import { namePolities, nameSettlements, type RestoreDirection } from './naming';
import type { RouteCity } from './routes';
import type { InterventionModel } from './interventions';
import { actsFrom, leaningsAt, reignAt, reignBook, reignStart, rulerBase, type LeaningEffect, type Reign, type RulerAct } from './rulers';
import { POLICY_RESPREAD, policiesFrom, policySeg, powerScale, segAt, segEffect, unrestShift, type PolicyIv, type PolicySeg } from './policy';
import { regencyBase, regentAt, regentsFrom, type Regency, type RegencyCtx } from './regents';

// ---- 调参(以截图效果为准) ----
/** 州有人定居后,过这么多年建城(随机) */
const FOUND_DELAY: [number, number] = [5, 40];
/**
 * 城的人口上限(千人)= CAP_REF × (州的人口上限 / 基准)^CAP_EXP × 港口 / 大河加成 × 随机 0.8–1.25。
 * 基准 = 这个世界可居州人口上限的第 90 百分位 ÷ CAP_P90(默认世界约 100):换精细度、气候时城市的大小分布不变。
 * 指数 > 1:沃野里的城比贫瘠处的城大得多,少数大城、大量村镇(城市规模的"长尾")。
 * CAP_REF 和立国门槛 FOUND_POP 同比例定:两个一起放大,城都变大,哪座城先够立国不变
 */
const CAP_REF = 17.6;
const CAP_P90 = 2.07;
const CAP_EXP = 1.6;
const PORT_CAP = 1.3;
const RIVER_CAP = 1.35;
/** 成长速度(每年):GROWTH × 随机 0.75–1.25 */
const GROWTH = 0.0022;
/**
 * 立国:人口上限够 FOUND_POP(千人)的城才立得了国(哪些城能立国由它定),人口越过 FOUND_AT、而且建城满 MIN_AGE 年就立国。
 * 立国看的是"够不够一方之主",不必等城长到很大:第一批国家在几百年里出现,前一千年不再几乎没有历史
 */
export const FOUND_POP = 32;
const FOUND_AT = 10;
const MIN_AGE = 120;
/** 自动国家数:每多少个可居州一个(只用来定国都间距;实际数量由推演决定) */
const REGIONS_PER_POLITY = 60;
/** 国都间距(州图跳数)= SPACING × √(可居州数 / 目标国家数) */
const SPACING = 0.85;
/** 过界系数(按 AdjKind 下标:平地、跨河、翻山、海峡、航线);海峡、航线:海洋国家从来就能走,普通国家到航海时代才能走(见 sailsOcean) */
const CROSS = [1, 1.3, 2, 2, 3];
/**
 * 航海时代(见 sailsOcean):从标定的推演进程(cultures.ts 的 REF_YEAR)的这个比例起,有港口的普通国家也能沿航线往海外扩张
 * (20 个种子调的:取 0.6 = 默认第 1800.5 年,立国高峰已过、本土大多占满,出海的多是沿海大国;
 * 0.5 来得太早,0.7 留给海外扩张的年份太少,普通国家的海外领土少了三成)
 */
const SAIL_FRAC = 0.6;
/**
 * 航海时代的普通国家走海峡、航线:过界系数再乘这么多,比海洋国家难走(海洋国家不乘)。
 * 20 个种子:1.5 时航海时代以后有海外领土的普通国家约占国·年的 3.6%,1 时约 5.2%,取中间
 */
const SAIL_CROSS = 1.2;
/** 进异族的州 */
const OTHER_CULTURE = 2.5;
/** 国家走一个标准路程要几年(国都旁边;离国都越远越慢) */
const STEP_YEARS = 60;
/** 离国都越远越慢:× e^(路程 / REACH),路程以"标准路程"计 */
const REACH = 12;
/** 群落系数 = (通行代价 / 70) ^ BIOME_EXP */
const BIOME_EXP = 0.6;
/**
 * 扩张算账(国家要不要去一州,由当时在位的君主定;见 wants):
 *   值 = 州的平均宜居分 × 民族类型的偏好(游牧看重草原荒漠、海洋看重沿海……)× 港口 PORT_VALUE / 大河 RIVER_VALUE
 *   代价 = e^(离国都的路程 / WORTH_REACH) × 异族 WORTH_FOREIGN × (1 − ENCLAVE × 四邻里已是本国的比例)
 *          × 不是山地民族时上高山 (1 + 高出 HIGH_COST 米的部分 / HIGH_SCALE)
 *   值 ≥ WORTH × 代价 × 君主倾向折算的门槛倍数(rulers.ts 的 leaningEffect)才去。荒漠、苔原、高山、离国都太远的州不划算,留给部落
 *   (20 个种子,第 3000 年:有人住的地方没有国家的从近两成到三成多,中位两成半;立国更早、有了边缘立国以后国家更多,门槛相应提高)
 */
const WORTH = 11;
const WORTH_REACH = 9;
const WORTH_FOREIGN = 1.4;
const ENCLAVE = 0.6;
const HIGH_COST = 800;
const HIGH_SCALE = 1200;
const PORT_VALUE = 1.3;
const RIVER_VALUE = 1.2;
/** 民族类型的偏好:游牧在草原荒漠、山地在高处(海拔 ≥ HIGH 米)、海洋在沿海、河谷 / 湖滨 / 林地在各自的地方 × PREFER(游牧 × NOMAD_PREFER);海洋民族进内陆、游牧进林地 × AVOID */
const PREFER = 1.4;
const NOMAD_PREFER = 2.2;
const AVOID = 0.6;
const HIGH = 600;
/** 修路:到结束年份至少长到这一级(1 = 镇)的城镇才连路(国都、港口总是连) */
const ROUTE_MIN_RANK = 1;
/** 海洋国家走城邦共和一系的概率(其余走农耕一系) */
const REPUBLIC_P = 0.75;

const BIOME_F = BIOME_COST.map((c) => fpow(Math.max(1, c) / 70, BIOME_EXP));
const biomeSet = (list: number[]) => {
  const t = new Uint8Array(16);
  for (const b of list) t[b] = 1;
  return t;
};
const STEPPE_DESERT = biomeSet([Biome.Steppe, Biome.ColdDesert, Biome.TemperateDesert, Biome.HotDesert, Biome.Savanna]);
const FOREST = biomeSet([Biome.TemperateForest, Biome.TemperateRainforest, Biome.Rainforest, Biome.TropicalDryForest, Biome.Taiga]);

// ---------------------------------------------------------------------------
// 模型:推演要用的全部东西(可以由 Civ 重建,见 resumePolities)

export interface PolityModel {
  terrain: CultureTerrain;
  cultures: Culture[];
  /** keyed 随机数的根 */
  base: number;
  /** 推演中逐步长出来的城镇、国家(编号 = 下标) */
  settlements: Settlement[];
  polities: Polity[];
  /** 州 → 城镇编号(−1 = 还没建城) */
  cityOf: Int32Array;
  /** 州 → 治所能当港口 */
  port: Uint8Array;
  /** 国家 → 当前州数、当前国号档位 */
  size: number[];
  tier: number[];
  /** 国家 → 现在的国土(州号升序;和 size 一起在归属监听里维护)。战争、分合要扫某国国土时用它,不用扫全部州 */
  lands: number[][];
  /** 州 → 离它不到 spacing 跳的国都个数(> 0 的州不能再立国;国家灭亡时撤掉它立国时加的标记) */
  near: Int32Array;
  /** 国家 → 各州离(现在的)国都的路程(标准路程;走不到 = Infinity) */
  capDist: Float32Array[];
  /** 国家 → 上一个国都的路程表、最近一次迁都的年份(迁都那一刻预约的扩张还按旧国都算,见 distFor) */
  capDistPrev: (Float32Array | null)[];
  capMoved: number[];
  /**
   * 国家 → 位置锚:anchorTag(立国时国都的地块, 这州第几个立的国)(和稳定键 `polity:c4567#0` 同一个意思)。
   * 推演里按国家取的随机数(keyed)一律按它取,不按编号(见 rand.ts)
   */
  ptag: number[];
  /** 城 → 位置锚:anchorTag(所在地块, 这州第几座城)(稳定键 `settlement:c4567#1`) */
  stag: number[];
  /** 地块 → 那里已经立过几国 / 建过几座城(算位置锚的"第几个") */
  pAt: Map<number, number>;
  sAt: Map<number, number>;
  /** 种子(战争等后续模块取自己的随机数根) */
  seed: number;
  /** 国都间距(州图跳数) */
  spacing: number;
  /** 城的人口上限的基准(州的人口上限,见 CAP_P90) */
  capNorm: number;
  /** 国家走一个标准路程要几年(STEP_YEARS ÷ 扩张快慢总系数 ÷ 拓荒设定的国家扩张) */
  years: number;
  /** 扩张算账的门槛倍数(拓荒设定的国家扩张调快了,门槛降低;默认 1) */
  worthMul: number;
  /** 离国都越远越慢:× e^(路程 / reach) */
  reach: number;
  /** 航海时代从哪一刻起(见 sailsOcean;ageOfSailYear) */
  sailFrom: Year;
  /** 阶段 4 干预(interventions.ts 挂上;没有干预 = 不给):"不许扩张"在"国家到达"时查 */
  iv?: InterventionModel;
  /**
   * 发展度(development.ts)挂上:各州城的人口上限此刻随生产能力变的倍数(新建的城从它记起,见 Settlement.devCap)、
   * 各国此刻的军力系数(按国家号;打仗的国力乘它,见 wars.ts)。没有发展度 = 不给(倍数、系数都是 1)
   */
  capFactor?: Float64Array;
  military?: number[];
  /** 君主在位表(rulers.ts)的随机数根、各国的位置锚(和 people.ts 一样按国都的城所在地块数,见 rulerTags) */
  rbase: number;
  rtag: number[];
  /** 地块 → 那里已经立过几国(按国都的城所在地块数,算 rtag) */
  rAt: Map<number, number>;
  /** 国家 → 已经预约过君主交接(Ev.Reign)了 */
  reigned: boolean[];
  /**
   * 新君即位那一刻(Ev.Reign;k = 他在在位表 list 里第几位,k ≥ 1)、处理完扩张以后调(unrest.ts 挂上:先君的儿子据地争位)
   */
  onReign?: (pid: number, k: number, list: readonly Reign[], t: Year) => void;
  /**
   * 新君即位那一刻、onReign(宗室争位、放逐失势的宗室)之后调,不管那边有没有截住(regency.ts 挂上:
   * 预约他晚年的引兵入朝、太子监国;继位的幼主当即定摄政 / 辅政)
   */
  afterReign?: (pid: number, k: number, list: readonly Reign[], t: Year) => void;
  /**
   * 立约与中立地(treaties.ts 挂上):无主的州 r 此刻进不去 —— 是中立地(谁都不扩张进去、不在那里立国;pid = −1 = 立国),
   * 或者 pid 和邻国立了"有限竞争"之约,r 挨着约国的国土(各守今疆)
   */
  closed?: (r: number, pid: number, t: Year) => boolean;
  /**
   * 国家 → 改在位表的干预(即位、让君主去世、改君主倾向生效了的,按先后;rulers.ts 的 RulerAct)。在位表按它排(bookOf);
   * 接着推时由史事推出来(rulers.ts 的 actsFrom),不存进 Civ
   */
  acts: Map<number, RulerAct[]>;
  /** 国家 → 最近一次预约"定了方针 / 改了君主倾向的下一刻看门槛"(Ev.Respread,a = POLICY_RESPREAD)是哪一刻定的(同一刻只预约一次) */
  retune: Map<number, Year>;
  /**
   * 国家 → 方针(干预"方针"生效了的,按先后;policy.ts 的 PolicySeg)。扩张算账、打仗、议和、邦交、发展度照它和君主的倾向一起算(effOf);
   * 接着推时由史事推出来(policy.ts 的 policiesFrom),不存进 Civ
   */
  policies: Map<number, PolicySeg[]>;
  /**
   * 国家 → 掌实权的几段(regency.ts 的 Regency,按掌权先后;同一国同一时刻至多一段在掌权)。在掌权的那段,扩张算账、打仗、议和、邦交、议事
   * 照掌权的人的倾向(effOf);接着推时由史事 regent 推出来(regency.ts 的 regentsFrom),不存进 Civ
   */
  regents: Map<number, Regency[]>;
}

/** 升序数组里的位置(第一个 ≥ r 的下标) */
function lowerBound(a: number[], r: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < r) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
function landAdd(a: number[], r: number) {
  const i = lowerBound(a, r);
  if (a[i] !== r) a.splice(i, 0, r);
}
function landRemove(a: number[], r: number) {
  const i = lowerBound(a, r);
  if (a[i] === r) a.splice(i, 1);
}

/** 地块 cell 上下一个实体的位置锚(count 里记着这个地块上已经有几个) */
function nextTag(count: Map<number, number>, cell: number): number {
  const n = count.get(cell) ?? 0;
  count.set(cell, n + 1);
  return anchorTag(cell, n);
}

/** 国家的位置锚(keyed 随机数用,见 PolityModel.ptag) */
export function polityTag(m: PolityModel, pid: number): number {
  return m.ptag[pid];
}

/** 城的位置锚(keyed 随机数用,见 PolityModel.stag) */
export function cityTag(m: PolityModel, sid: number): number {
  return m.stag[sid];
}

/** 民族的位置锚:发源州的治所地块(keyed 随机数用) */
export function cultureTag(m: PolityModel, c: number): number {
  return m.terrain.regions.seat[m.cultures[c].hearth];
}

/** 州 r 的城:人口上限(千人) */
function cityCapacity(m: PolityModel, r: number): number {
  const T = m.terrain;
  let cap = CAP_REF * fpow(T.regions.capacity[r] / m.capNorm, CAP_EXP);
  if (m.port[r]) cap *= PORT_CAP;
  if (T.riverSeat[r]) cap *= RIVER_CAP;
  return cap * (0.8 + 0.45 * keyed(m.base, T.regions.seat[r], 2));
}

/**
 * 州 r 的城址里随地形变的那几样相乘:州的人口上限 ^ CAP_EXP × 港口 × 大河(城的人口上限大体和它成正比,见 cityCapacity)。
 * 地形大事以后老城的上限按它前后之比缩放(upheaval.ts 的 reshapeCities;建城时的基准、随机部分不变)
 */
export function siteFactor(T: CultureTerrain, port: boolean, r: number): number {
  let f = fpow(T.regions.capacity[r], CAP_EXP);
  if (port) f *= PORT_CAP;
  if (T.riverSeat[r]) f *= RIVER_CAP;
  return f;
}

function cityGrowth(m: PolityModel, r: number): number {
  return GROWTH * (0.75 + 0.5 * keyed(m.base, m.terrain.regions.seat[r], 3));
}

/** 有人定居后几年建城 */
function foundDelay(m: PolityModel, r: number): number {
  return FOUND_DELAY[0] + (FOUND_DELAY[1] - FOUND_DELAY[0]) * keyed(m.base, m.terrain.regions.seat[r], 1);
}

/**
 * 这座城建城满 MIN_AGE 年以后、人口越过 FOUND_AT 的第一年(那时的人口上限得够 FOUND_POP);够不着 = Infinity。
 * 建城不满 MIN_AGE 年就越过了的,往后推到满 MIN_AGE 年 —— 那时人口还得够(地形大事降了上限、人口跌回去的不算)
 */
export function foundingYear(s: Settlement): Year {
  // 按地形大事切成几段(段里的上限 = 那次换成的值),只在上限够 FOUND_POP 的段里找
  const L = s.reshaped ?? [];
  for (let i = -1; i < L.length; i++) {
    if ((i < 0 ? s.capacity : L[i].capacity) < FOUND_POP) continue;
    let a = i < 0 ? -Infinity : L[i].year;
    const b = i + 1 < L.length ? L[i + 1].year : Infinity;
    // 上限是涨上去的(RESHAPE_RAMP 年里线性涨):从涨到 FOUND_POP 的那一刻起才算
    if (i >= 0) {
      const from = capacityAt(s, a);
      if (from < FOUND_POP) a += (RESHAPE_RAMP * (FOUND_POP - from)) / (L[i].capacity - from);
    }
    const t = yearReaching(s, FOUND_AT, Math.max(a, s.founded + MIN_AGE));
    if (t < b) return t;
  }
  return Infinity;
}

/**
 * 港口:治所挨着能通航的海,而且是天然良港(只挨着一块海)或河口;
 * 每块陆地在它挨着的每片海上至少一个港口(挑人口上限最大的);一片海凑不够两个港口就一个都不设(航线要两头)。
 * 只看宜居的州(新城只建在那里);also 里标了的州不宜居也看(地形大事以后城还在、州变得不宜居的,港口照样按海岸认)
 */
export function findPorts(world: World, T: CultureTerrain, also?: Uint8Array): Uint8Array {
  const { mesh, water, flux, riverThreshold } = world;
  const { n, adjStart, adj } = mesh;
  const reg = T.regions;
  const R = reg.count;
  const open = (i: number) => water[i] === 1 && !frozen(world, i);
  // 能通航的海面连通片
  const sea = new Int32Array(n).fill(-1);
  {
    const q = new Int32Array(n);
    let id = 0;
    for (let s = 0; s < n; s++) {
      if (!open(s) || sea[s] >= 0) continue;
      let qt = 0;
      q[qt++] = s;
      sea[s] = id;
      for (let qh = 0; qh < qt; qh++) {
        const i = q[qh];
        for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
          const j = adj[k];
          if (sea[j] < 0 && open(j)) {
            sea[j] = id;
            q[qt++] = j;
          }
        }
      }
      id++;
    }
  }
  // 每个治所挨着的海(取挨着的第一片)
  const seaOf = new Int32Array(R).fill(-1);
  const good = new Uint8Array(R);
  for (let r = 0; r < R; r++) {
    if (!T.habitable[r] && !also?.[r]) continue;
    const s = reg.seat[r];
    let nSea = 0;
    for (let k = adjStart[s]; k < adjStart[s + 1]; k++) {
      const j = adj[k];
      if (water[j] === 1) nSea++;
      if (sea[j] >= 0 && seaOf[r] < 0) seaOf[r] = sea[j];
    }
    if (seaOf[r] < 0) continue;
    if (nSea === 1 || flux[s] >= riverThreshold) good[r] = 1;
  }
  const port = new Uint8Array(R);
  // 每块陆地 × 每片海:最好的一个
  const best = new Map<number, number>();
  for (let r = 0; r < R; r++) {
    if (seaOf[r] < 0) continue;
    if (good[r]) port[r] = 1;
    const key = reg.landmass[r] * 65536 + seaOf[r];
    const b = best.get(key);
    if (b === undefined || reg.capacity[r] > reg.capacity[b]) best.set(key, r);
  }
  for (const r of best.values()) port[r] = 1;
  // 一片海不到两个港口:都不算
  const perSea = new Map<number, number>();
  for (let r = 0; r < R; r++) if (port[r]) perSea.set(seaOf[r], (perSea.get(seaOf[r]) ?? 0) + 1);
  for (let r = 0; r < R; r++) if (port[r] && (perSea.get(seaOf[r]) ?? 0) < 2) port[r] = 0;
  return port;
}

function frozen(world: World, i: number): boolean {
  return world.seaIce[i] >= 0.5 || world.biome[i] === Biome.SeaIce;
}

/**
 * 这一刻预约国家 pid 的扩张用哪张"离国都的路程"表:迁都那一刻(同一个时刻)还按旧国都算,之后按新国都。
 * 这样同一时刻里迁都和扩张谁先谁后都一样,fromCiv 按日志重放时能算出同样的到达年份
 */
function distFor(m: PolityModel, pid: number, now: number): Float32Array {
  return now > m.capMoved[pid] ? m.capDist[pid] : m.capDistPrev[pid] ?? m.capDist[pid];
}

/**
 * 国家 p 在 t 这一刻经邻接边 k 进州 b 要几年;Infinity = 走不了。dist = 离国都的路程表,cb = 州 b 的民族。
 * 海峡、航线:能不能走看 sailsOcean;普通国家走航线只能从港口出发(k 的起点州 m.port)
 */
function stepYearsWith(m: PolityModel, p: Polity, k: number, b: number, dist: Float32Array, cb: number, t: Year): number {
  const T = m.terrain;
  const reg = T.regions;
  const kind = reg.adjKind[k];
  const overSea = kind === AdjKind.Strait || kind === AdjKind.SeaRoute;
  const sailing = overSea && p.kind !== 'sea';
  if (overSea && !sailsOcean(m, p, t)) return Infinity;
  if (sailing && kind === AdjKind.SeaRoute && !m.port[edgeFrom(reg, k)]) return Infinity;
  const d = dist[b];
  if (!(d < Infinity)) return Infinity;
  const bi = reg.biome[b];
  let mod = 1;
  let cross = CROSS[kind];
  if (kind === AdjKind.Mountain) cross *= T.fx.stateMtn;
  if (sailing) cross *= SAIL_CROSS;
  switch (p.kind) {
    case 'nomad':
      mod = STEPPE_DESERT[bi] ? 0.7 : FOREST[bi] ? 2.5 : 1;
      break;
    case 'highland':
      mod = reg.elevation[b] < 300 ? 2 : 1;
      if (kind === AdjKind.Mountain) cross = 1.1;
      break;
    case 'sea':
      mod = T.coastal[b] ? 0.7 : T.inland[b] ? 1.8 : 1;
      break;
    case 'river':
      mod = T.river[b] ? 0.7 : 1.3;
      break;
    case 'lake':
      mod = T.lake[b] ? 0.7 : 1.2;
      break;
    case 'forest':
      mod = FOREST[bi] ? 0.8 : 1.4;
      break;
    default:
      break;
  }
  const culture = cb === p.culture ? 1 : OTHER_CULTURE;
  const len = reg.adjLen[k] / T.refLen;
  const jitter = 0.8 + 0.4 * keyed(m.base, m.ptag[p.id], reg.seat[b], 4);
  return (
    (m.years * len * (BIOME_F[bi] * T.fx.state[bi]) * Math.sqrt(T.poverty[b]) * cross * mod * culture * fexp(d / m.reach) * jitter) /
    p.expansionism
  );
}

/** 国家 pid 的在位表(rulers.ts),排到 t 时在位的那一位;带上这国改在位表的干预(PolityModel.acts) */
export function bookOf(m: PolityModel, pid: number, t: Year): readonly Reign[] {
  return reignBook(m.rbase, m.rtag[pid], m.polities[pid], t, m.acts.get(pid));
}

/** 国家 pid 在 t 这一刻在位的君主(rulers.ts 的在位表;改朝换代那一刻还算旧君) */
export function rulerOf(m: PolityModel, pid: number, t: Year): Reign {
  return reignAt(m.rbase, m.rtag[pid], m.polities[pid], t, m.acts.get(pid));
}

/** 国家 pid 在 t 这一刻照的方针(policy.ts:t 以前定的最后一条;没有 / 罢了 = null) */
export function policyAt(m: PolityModel, pid: number, t: Year): PolicyIv | null {
  return segAt(m.policies.get(pid), t)?.v ?? null;
}

/** 国家 pid 此刻的国力倍数(顺着引的方针加减国力,policy.ts;没有 = 1) */
export function powerScaleOf(m: PolityModel, pid: number, t: Year): number {
  return m.policies.size ? powerScale(policyAt(m, pid, t)) : 1;
}

/** 国家 pid 此刻的动荡加减(顺着引的方针,−1…1,policy.ts;没有 = 0) */
export function unrestShiftOf(m: PolityModel, pid: number, t: Year): number {
  return m.policies.size ? unrestShift(policyAt(m, pid, t)) : 0;
}

/** 君主 r 在国家 pid 此刻(t)的方针下的倍数(没有方针 = 他自己的,r.eff;作者改过他的倾向的按此刻的,见 rulers.ts 的 leaningsAt) */
export function effFor(m: PolityModel, pid: number, r: Reign, t: Year): LeaningEffect {
  return segEffect(segAt(m.policies.get(pid), t), r.moods ? leaningsAt(r, t) : r);
}

/**
 * 国家 pid 在 t 这一刻做决定用的倍数:在位君主的倾向加上方针(policy.ts;没有方针 = 君主的)。
 * 有人掌着实权(regency.ts)的那几年照掌权的人的倾向(方针照旧加在上面)
 */
export function effOf(m: PolityModel, pid: number, t: Year): LeaningEffect {
  const r = rulerOf(m, pid, t);
  const g = regentOf(m, pid, t, r);
  return g ? segEffect(segAt(m.policies.get(pid), t), g) : effFor(m, pid, r, t);
}

/** 国家 pid 在 t 这一刻说了算的人的倾向:有人掌着实权 = 掌权的人的,不然 = 在位君主此刻的(作者改过的按改过的) */
export function rulingLeanings(m: PolityModel, pid: number, t: Year): RulerLeanings {
  const r = rulerOf(m, pid, t);
  const g = regentOf(m, pid, t, r);
  return g ? g.leanings : leaningsAt(r, t).leanings;
}

/** 国家 pid 在 t 这一刻掌着实权的那一段(r = 此刻在位的;没有 = null) */
export function regentOf(m: PolityModel, pid: number, t: Year, r: Reign): Regency | null {
  const list = m.regents.size ? m.regents.get(pid) : undefined;
  return list ? regentAt(m.polities[pid], list, t, r, bookOf(m, pid, t)) : null;
}

/** 掌实权推算要用的那几样(regents.ts):在位表照这国此刻的(带干预、宗室篡位) */
export function regencyCtx(m: PolityModel): RegencyCtx {
  return { rbase: m.rbase, base: regencyBase(m.seed), tag: m.rtag, polities: m.polities, book: (pid, t) => bookOf(m, pid, t) };
}

/** 方针里的国家键(亲、仇)有没有指着 q(键要用时才解析,见 interventions.ts 的 resolve) */
export function picks(m: PolityModel, keys: readonly string[] | undefined, q: number): boolean {
  if (!keys || !m.iv) return false;
  for (const k of keys) if (m.iv.resolve(k) === q) return true;
  return false;
}

/** 国家 p 此刻的方针把 q 当亲国(不主动打它;没有方针 = false) */
export function befriends(m: PolityModel, p: number, q: number, t: Year): boolean {
  return m.policies.size > 0 && picks(m, policyAt(m, p, t)?.friends, q);
}

/** 国家 p 此刻的方针把 q 当仇国(没有方针 = false) */
export function hates(m: PolityModel, p: number, q: number, t: Year): boolean {
  return m.policies.size > 0 && picks(m, policyAt(m, p, t)?.foes, q);
}

/**
 * 国家 pid 此刻定了方针(干预"方针",interventions.ts 在生效那一刻调用;t = 此刻):登记进 PolityModel.policies,下一刻起照它算。
 * 下一刻预约一次 Ev.Respread(a = POLICY_RESPREAD):那时门槛比原来低了就从现有国土往外重新看一遍(同一刻同一国定了几条只预约一次)
 */
export function setPolicy(sim: CivSim, m: PolityModel, pid: number, v: PolicyIv, iv: number, t: Year): void {
  let list = m.policies.get(pid);
  if (!list) m.policies.set(pid, (list = []));
  list.push(policySeg(v, t, iv));
  retune(sim, m, pid, t);
}

/** 定了方针、改了君主倾向:下一刻预约一次 Ev.Respread(a = POLICY_RESPREAD;同一刻同一国只预约一次,见 PolityModel.retune) */
function retune(sim: CivSim, m: PolityModel, pid: number, t: Year): void {
  if (m.retune.get(pid) === t) return;
  m.retune.set(pid, t);
  sim.schedule(t + 1 / 256, Ev.Respread, POLICY_RESPREAD, pid);
}

/** 国家 pid 定方针、改君主倾向的那几刻(按先后,不重复;接着推时重放"下一刻看门槛"用) */
function retuneTimes(m: PolityModel, pid: number): Year[] {
  const out: Year[] = [];
  for (const s of m.policies.get(pid) ?? []) out.push(s.t);
  for (const c of m.acts.get(pid) ?? []) if (c.kind === 'temper') out.push(c.t);
  out.sort((a, b) => a - b);
  return out.filter((t, i) => i === 0 || out[i - 1] !== t);
}

/**
 * 定了方针的下一刻(t):上一刻(原来的君主、原来的方针)和此刻比一比,门槛放低了的返回上一刻的倍数(只补此刻才肯去的州);没放低 = null。
 * 同一刻新君即位的,两边比的都是"原来的君主 + 原来的方针"(见 Ev.Reign),不会两头都当别人补过了
 */
function policyWidens(m: PolityModel, pid: number, t: Year): LeaningEffect | null {
  const prev = effOf(m, pid, t - 1 / 256);
  return widens(prev, effOf(m, pid, t)) ? prev : null;
}

/**
 * 扩张算账:国家 p 在 t 这一刻值不值得去州 b(见 WORTH)。dist = 离国都的路程表,cb = 州 b 的民族,owner = 此刻各州的国家。
 * 由当时在位的君主定:扩张高的不太计较,扩张低的只要富庶、离国都近的地方,重商高的看重沿海、大河、港口
 */
function wants(m: PolityModel, owner: Int16Array, p: Polity, b: number, dist: Float32Array, cb: number, e: LeaningEffect): boolean {
  const T = m.terrain;
  const reg = T.regions;
  const d = dist[b];
  if (!(d < Infinity)) return false;
  const bi = reg.biome[b];
  let value = T.meanSuit[b];
  switch (p.kind) {
    case 'nomad':
      value *= STEPPE_DESERT[bi] ? NOMAD_PREFER : FOREST[bi] ? AVOID : 1;
      break;
    case 'highland':
      if (reg.elevation[b] >= HIGH) value *= PREFER;
      break;
    case 'sea':
      value *= T.coastal[b] ? PREFER : T.inland[b] ? AVOID : 1;
      break;
    case 'river':
      if (T.river[b]) value *= PREFER;
      break;
    case 'lake':
      if (T.lake[b]) value *= PREFER;
      break;
    case 'forest':
      if (FOREST[bi]) value *= PREFER;
      break;
    default:
      break;
  }
  if (m.port[b]) value *= PORT_VALUE;
  else if (T.riverSeat[b]) value *= RIVER_VALUE;
  // 四邻(陆上、跨河、翻山)里已是本国的越多,越好管:国土里不留一个个部落的窟窿
  let n = 0;
  let mine = 0;
  for (let k = reg.adjStart[b]; k < reg.adjStart[b + 1]; k++) {
    const kind = reg.adjKind[k];
    if (kind === AdjKind.Strait || kind === AdjKind.SeaRoute) continue;
    n++;
    if (owner[reg.adj[k]] === p.id) mine++;
  }
  let cost = fexp(d / WORTH_REACH) * (cb === p.culture ? 1 : WORTH_FOREIGN) * (1 - (ENCLAVE * mine) / Math.max(1, n));
  // 高山难治(山地民族不算)
  if (p.kind !== 'highland') cost *= 1 + Math.max(0, reg.elevation[b] - HIGH_COST) / HIGH_SCALE;
  const coast = T.coastal[b] === 1 || T.river[b] === 1 || m.port[b] === 1;
  return value >= WORTH * cost * (coast ? e.coast : e.worth) * m.worthMul;
}

/**
 * 国家 p 经邻接边 k 进州 b 要几年(现在预约);不值得去(扩张算账)或走不了 = Infinity。
 * prev = 新君即位时上一位的倍数:上一位就肯去的州那时已经预约过,不重复预约(只补新君才肯去的)
 */
function reachYears(m: PolityModel, sim: CivSim, p: Polity, k: number, b: number, prev?: LeaningEffect): number {
  const dist = distFor(m, p.id, sim.now);
  const cb = sim.owners[Layer.Culture][b];
  const owner = sim.owners[Layer.Polity];
  if (!wants(m, owner, p, b, dist, cb, effOf(m, p.id, sim.now))) return Infinity;
  if (prev && wants(m, owner, p, b, dist, cb, prev)) return Infinity;
  return stepYearsWith(m, p, k, b, dist, cb, sim.now);
}

/** 新君即位、定了方针以后,原来不值得去的地方会不会有一些值得去了(门槛放低了) */
function widens(prev: LeaningEffect, cur: LeaningEffect): boolean {
  return cur.worth < prev.worth || cur.coast < prev.coast;
}

/** 预约国家 pid 的下一次君主交接:在位表里第 k 位开始"在位"的那一刻(rulers.ts 的 reignStart) */
function scheduleReign(sim: CivSim, m: PolityModel, pid: number, k: number, t: Year) {
  let list = bookOf(m, pid, t);
  // 在位表只排到此刻在位的那一位:下一位从他不被打断时让位的那一年起
  if (!list[k] && list[k - 1]) list = bookOf(m, pid, list[k - 1].natural);
  const r = list[k];
  if (r) sim.schedule(reignStart(r), Ev.Reign, k, pid);
}

/**
 * 改在位表的干预此刻生效(interventions.ts 在生效那一刻调用;c.t = 此刻):登记进 PolityModel.acts,在位表跟着重排(rulers.ts)。
 * - 即位:作者的人物从下一刻起在位,预约他的即位(Ev.Reign;门槛比上一位低就从现有国土往外重新看一遍,见 widens)。
 *   他的位次在下一刻本来就有交接预约着的(顶替同一刻改朝换代的新君、同一刻先立的作者君主,或原来那一位正好在下一刻交接),不重复预约
 * - 让君主去世:下一位从下一刻起在位,同样预约他的即位
 * - 等下台再即位:不另预约 —— 在位的那位到期下台时原来预约的交接就是作者的人物(他从那一刻起在位,见 reignStart);
 *   那位先被让他去世,由去世那一条预约
 * - 改君主倾向:下一刻看一眼门槛(和定方针一样,见 retune)
 * 原来预约的下一位的交接到时对不上(在位表重排了),丢掉
 */
export function rulerAct(sim: CivSim, m: PolityModel, pid: number, c: RulerAct): void {
  const at = c.t + 1 / 256;
  const before = bookOf(m, pid, at);
  let list = m.acts.get(pid);
  if (!list) m.acts.set(pid, (list = []));
  list.push(c);
  if (c.kind === 'temper') {
    retune(sim, m, pid, c.t);
    return;
  }
  if (c.kind === 'crown' && c.after) return;
  const after = bookOf(m, pid, at);
  let k = after.length - 1;
  if (c.kind === 'crown') while (k >= 0 && after[k].crown !== c) k--;
  else {
    // 去世的那位(落在前一位身上的只记一笔,不换人)的下一位
    while (k >= 0 && !(after[k].death?.iv === c.iv && after[k].cut === c.t)) k--;
    if (k >= 0) k++;
  }
  if (k < 0 || !after[k]) return;
  const t = reignStart(after[k]);
  if (!(before[k] && reignStart(before[k]) === t)) sim.schedule(t, Ev.Reign, k, pid);
}

/**
 * 改朝换代了(dynasty.ts 在 Polity.dynasties 加了一条之后调用):新朝第一位的即位在下一刻预约(rulers.ts 的 reignStart)。
 * 旧君原来预约的交接到时对不上(在位表重排了),丢掉
 */
export function dynastyReign(sim: CivSim, m: PolityModel, pid: number, t: Year): void {
  const p = m.polities[pid];
  const list = bookOf(m, pid, t + 1 / 256);
  const dyn = (p.dynasties?.length ?? 1) - 1;
  for (let k = list.length - 1; k >= 0; k--) {
    if (list[k].dynasty === dyn && list[k].j === 0) {
      sim.schedule(reignStart(list[k]), Ev.Reign, k, pid);
      return;
    }
  }
}

/**
 * 国家 p 在 t 这一刻能不能走远洋(海峡、航线):海洋国家从来就能,普通国家从国都的运输能力够了的那一刻(Polity.sail,
 * development.ts 每 20 年看一次)起能。旧版本的历史全世界同一年进航海时代(m.sailFrom / Civ.sailFrom;现在推出来的是 Infinity)。
 * 推演里"某国此刻能不能出海"只在这里判断(扩张、离国都的路程、国土连不连成一片、打仗、邦交都经它);离国都的路程表也按它分档(voyageOf)
 */
export function sailsOcean(at: SailClock, p: Polity, t: Year): boolean {
  return p.kind === 'sea' || t >= (p.sail ?? Infinity) || t >= (at.sailFrom ?? Infinity);
}

/** 航海时代从哪一刻起:推演模型(PolityModel)或推演结果(Civ)都带着 */
export type SailClock = { sailFrom?: Year };

/**
 * 航海时代从哪年起:标定的推演进程(REF_YEAR)× SAIL_FRAC,按扩张快慢(pace)缩放 ——
 * 不按推演年数:推演年数改长改短,同一年以前的历史照旧。落在半年上(第 N.5 年),不和整年的地形大事、干预撞在同一刻
 */
export function ageOfSailYear(pace: number): Year {
  return Math.floor((SAIL_FRAC * REF_YEAR) / Math.max(1e-3, pace)) + 0.5;
}

/** 离国都的路程表按哪一档算(capitalDistance):0 = 不渡海,1 = 海洋国家,2 = 航海时代的普通国家 */
function voyageOf(m: PolityModel, p: Pick<Polity, 'kind' | 'sail'>, t: Year): Voyage {
  return p.kind === 'sea' ? 1 : t >= m.sailFrom || t >= (p.sail ?? Infinity) ? 2 : 0;
}

/** 国家 p 在 t 这一刻能不能走邻接边 k(海峡、航线见 sailsOcean) */
export function canCross(at: SailClock, p: Polity, kind: number, t: Year): boolean {
  return (kind !== AdjKind.Strait && kind !== AdjKind.SeaRoute) || sailsOcean(at, p, t);
}

/** 邻接边 k 的起点州(adjStart 里二分) */
function edgeFrom(reg: Regions, k: number): number {
  let lo = 0;
  let hi = reg.count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (reg.adjStart[mid + 1] <= k) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 连通搜索用的草稿(每个州图一份):访问标记 + 队列 */
const scratch = new WeakMap<Regions, { seen: Int32Array; stamp: number; q: Int32Array }>();

/**
 * 国家 pid 的国土里,和国都(经本国国土、它能走的边)连成一片的州:mark[州] === 返回的戳记。
 * 战争里国土被切开时,切出去的那几块不算(见 bordersCore);海洋国家可以走海路
 */
export function coreOf(m: PolityModel, owner: Int16Array, pid: number, t: Year): { seen: Int32Array; stamp: number } {
  const reg = m.terrain.regions;
  let sc = scratch.get(reg);
  if (!sc) scratch.set(reg, (sc = { seen: new Int32Array(reg.count), stamp: 0, q: new Int32Array(reg.count) }));
  const stamp = ++sc.stamp;
  const p = m.polities[pid];
  const cap = m.settlements[capitalAt(p, t)].region;
  if (owner[cap] !== pid) return { seen: sc.seen, stamp };
  const { seen, q } = sc;
  let qt = 0;
  q[qt++] = cap;
  seen[cap] = stamp;
  for (let h = 0; h < qt; h++) {
    const r = q[h];
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
      const j = reg.adj[k];
      if (seen[j] === stamp || owner[j] !== pid || !canCross(m, p, reg.adjKind[k], t)) continue;
      seen[j] = stamp;
      q[qt++] = j;
    }
  }
  return { seen, stamp };
}

/**
 * 国家 pid 现在有没有挨着州 r、而且和国都连成一片的州(经它能走的边)。
 * 阶段 2 国土只增不减、总是连成一片,等于"有没有州挨着 r";阶段 3 国土被切开以后,切出去的飞地不再往外长
 */
function bordersCore(m: PolityModel, owner: Int16Array, pid: number, r: number, t: Year): boolean {
  const reg = m.terrain.regions;
  const p = m.polities[pid];
  let any = false;
  for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
    if (owner[reg.adj[k]] === pid && canCross(m, p, reg.adjKind[k], t)) any = true;
  }
  if (!any) return false;
  const { seen, stamp } = coreOf(m, owner, pid, t);
  for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
    if (seen[reg.adj[k]] === stamp && canCross(m, p, reg.adjKind[k], t)) return true;
  }
  return false;
}

/**
 * 各州离国都的路程(标准路程,Dijkstra)。国家扩张(stepYears)和战争(远征远近)共用这一份。
 * sea = 渡海的一档(voyageOf):0 不走海峡、航线;1 海洋国家;2 航海时代的普通国家(海峡、航线 × SAIL_CROSS,航线只从港口 port 出发)。
 * 搜索时用 Float64 记路程(和堆里的优先级同一精度),最后才存成 Float32 ——
 * 阶段 2 曾直接用 Float32 记,"弹出的优先级 > 表里取整后的值"就被当成过期跳过,约一半的州没被展开,背后的州成了"走不到"
 */
export function capitalDistance(T: CultureTerrain, from: number, sea: Voyage, port: Uint8Array): Float32Array {
  // 按"地形 + 出发州 + 渡海的一档"缓存:迁都、复国常常回到用过的国都,不用每次重算(返回的表只读;港口由地形定)
  let cache = distCache.get(T);
  if (!cache) distCache.set(T, (cache = new Map()));
  const key = from * 3 + sea;
  const hit = cache.get(key);
  if (hit) return hit;
  const out = capitalDistanceRaw(T, from, sea, port);
  cache.set(key, out);
  return out;
}

const distCache = new WeakMap<CultureTerrain, Map<number, Float32Array>>();

/** 两个 Dijkstra(离国都的路程、国都间距标记)共用的堆和路程表(推演是单线程的,两者不会同时跑);路程表用完都复原成 Infinity */
const dijkstra = { heap: new MinHeap(256), d: new Float64Array(0) };
function dijkstraScratch(R: number): Float64Array {
  if (dijkstra.d.length < R) dijkstra.d = new Float64Array(R).fill(Infinity);
  dijkstra.heap.size = 0;
  return dijkstra.d;
}

/** 渡海的一档(capitalDistance) */
type Voyage = 0 | 1 | 2;

function capitalDistanceRaw(T: CultureTerrain, from: number, sea: Voyage, port: Uint8Array): Float32Array {
  const reg = T.regions;
  const R = reg.count;
  const d = new Float64Array(R).fill(Infinity);
  dijkstraScratch(R);
  const heap = dijkstra.heap;
  d[from] = 0;
  heap.push(from, 0);
  while (heap.size) {
    const r = heap.pop();
    const dr = heap.lastPri;
    if (dr > d[r]) continue;
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
      const kind = reg.adjKind[k];
      const overSea = kind === AdjKind.Strait || kind === AdjKind.SeaRoute;
      if (overSea && (sea === 0 || (sea === 2 && kind === AdjKind.SeaRoute && !port[r]))) continue;
      const j = reg.adj[k];
      const nd = dr + (reg.adjLen[k] / T.refLen) * CROSS[kind] * (overSea && sea === 2 ? SAIL_CROSS : 1);
      if (nd < d[j]) {
        d[j] = nd;
        heap.push(j, nd);
      }
    }
  }
  return Float32Array.from(d);
}

/** 州图跳数(陆上 1、海峡 2、航线 5)不到 limit 的州:mark[州] += add */
export function markNear(reg: Regions, from: number, limit: number, mark: Int32Array, add: number) {
  const d = dijkstraScratch(reg.count);
  const heap = dijkstra.heap;
  const touched = [from];
  d[from] = 0;
  heap.push(from, 0);
  while (heap.size) {
    const r = heap.pop();
    const dr = heap.lastPri;
    if (dr > d[r]) continue;
    mark[r] += add;
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
      const kind = reg.adjKind[k];
      const nd = dr + (kind === AdjKind.SeaRoute ? 5 : kind === AdjKind.Strait ? 2 : 1);
      const j = reg.adj[k];
      if (nd < limit && nd < d[j]) {
        if (d[j] === Infinity) touched.push(j);
        d[j] = nd;
        heap.push(j, nd);
      }
    }
  }
  for (const r of touched) d[r] = Infinity;
}

/** 州 a 在州 b 的邻接表里的下标(b → a 的那条边) */
export function edgeTo(reg: Regions, b: number, a: number): number {
  for (let k = reg.adjStart[b]; k < reg.adjStart[b + 1]; k++) if (reg.adj[k] === a) return k;
  return -1;
}

/** 国号一系;seatCell = 国都所在州的治所地块(位置锚) */
function lineageOf(base: number, kind: Culture['kind'], seatCell: number): PolityLineage {
  if (kind === 'nomad') return 'khanate';
  if (kind === 'sea') return keyed(base, seatCell, 6) < REPUBLIC_P ? 'republic' : 'realm';
  return 'realm';
}

/** 可居州人口上限的第 90 百分位 ÷ CAP_P90(改过地形的世界沿用没改地形时的,见 index.ts 的 planetTempo) */
export function capacityNorm(T: CultureTerrain): number {
  const caps: number[] = [];
  for (let r = 0; r < T.R; r++) if (T.habitable[r]) caps.push(T.regions.capacity[r]);
  if (!caps.length) return 1;
  caps.sort((a, b) => a - b);
  return Math.max(1e-3, caps[Math.floor(0.9 * (caps.length - 1))] / CAP_P90);
}

/** 国都间距:SPACING × √(可居州数 / 目标国家数) */
function capitalSpacing(T: CultureTerrain, polities: number | 'auto'): number {
  let H = 0;
  for (let r = 0; r < T.R; r++) H += T.habitable[r];
  const target = polities === 'auto' ? Math.max(8, Math.min(20, H / REGIONS_PER_POLITY)) : Math.max(1, polities);
  return Math.max(2, SPACING * Math.sqrt(H / target));
}

function emptyModel(T: CultureTerrain, cultures: Culture[], seed: number, port: Uint8Array, spacing: number, years: number, sailFrom: Year, capNorm?: number, expand = 1): PolityModel {
  return {
    terrain: T,
    cultures,
    base: subSeed(seed, 'civ-polity'),
    seed,
    settlements: [],
    polities: [],
    cityOf: new Int32Array(T.R).fill(-1),
    port,
    size: [],
    lands: [],
    tier: [],
    near: new Int32Array(T.R),
    capDist: [],
    capDistPrev: [],
    capMoved: [],
    ptag: [],
    stag: [],
    pAt: new Map(),
    sAt: new Map(),
    spacing,
    capNorm: capNorm ?? capacityNorm(T),
    years,
    worthMul: expand === 1 ? 1 : 1 / fpow(expand, WORTH_EXP),
    reach: REACH,
    sailFrom,
    rbase: rulerBase(seed),
    rtag: [],
    rAt: new Map(),
    reigned: [],
    acts: new Map(),
    retune: new Map(),
    policies: new Map(),
    regents: new Map(),
  };
}

// ---------------------------------------------------------------------------
// 定参数

export interface PolityPlanParams {
  polities: number | 'auto';
  /** 扩张快慢总系数(和民族共用) */
  pace: number;
  /** 城的人口上限按这个数折算;不给 = 按这个世界算(capacityNorm) */
  capNorm?: number;
  /** 拓荒设定的国家扩张快慢(倍数;不给 = 1) */
  expand?: number;
}

/** 民族定好之后(planCultures 的结果):港口、国都间距、城市规模的基准、国家扩张快慢 */
export function planPolities(world: World, cm: CultureModel, p: PolityPlanParams): PolityModel {
  const T = cm.terrain;
  const expand = p.expand ?? 1;
  // 远洋看各国自己的运输能力(Polity.sail),没有全世界统一的航海时代
  return emptyModel(T, cm.cultures, cm.seed, findPorts(world, T), capitalSpacing(T, p.polities), STEP_YEARS / Math.max(1e-3, p.pace * expand), Infinity, p.capNorm, expand);
}

// ---------------------------------------------------------------------------
// 挂到推演引擎上

const models = new WeakMap<CivSim, PolityModel>();

/** 推演引擎上挂着的城镇 / 国家模型(推演中途、或 fromCiv 接着推之后,拿到最新的城镇和国家表) */
export function polityModelOf(sim: CivSim): PolityModel | undefined {
  return models.get(sim);
}

/** 登记城镇、国家的事件处理和监听(民族的 installCultures 之后调用) */
export function installPolities(sim: CivSim, m: PolityModel): void {
  models.set(sim, m);
  simOf.set(m, sim);
  const T = m.terrain;
  const reg = T.regions;
  const culture = sim.owners[Layer.Culture];
  const polity = sim.owners[Layer.Polity];

  // 州有人定居:预约建城;邻州已有国家的,预约国家到达。
  // 阶段 3 同化 / 迁徙改换了部落地带的民族:不再建城(城早建好了,或者定居时已经预约过),
  // 但之前预约到这一州的国家到达都过期了(版本号变了),按新的民族重新预约
  sim.onChange(Layer.Culture, (r, v, prev) => {
    if (v < 0) return;
    const t = sim.now;
    if (prev < 0 && m.cityOf[r] < 0 && T.habitable[r]) sim.schedule(t + foundDelay(m, r), Ev.SettlementFound, r, 0);
    if (polity[r] >= 0) return;
    for (let q = reg.adjStart[r]; q < reg.adjStart[r + 1]; q++) {
      const j = reg.adj[q];
      const pid = polity[j];
      if (pid < 0) continue;
      const k = edgeTo(reg, j, r);
      const dt = reachYears(m, sim, m.polities[pid], k, r);
      if (dt < Infinity) sim.schedule(t + dt, Ev.PolityArrive, r, pid);
    }
  });

  // 国家拿下一州(扩张、立国,或战争里攻占):州数 +1(跨过一档就预约"升格"),记下新接壤的国家,预约邻州的国家到达
  sim.onChange(Layer.Polity, (r, v, prev) => {
    if (prev >= 0) {
      m.size[prev]--;
      landRemove(m.lands[prev], r);
    }
    if (v < 0) return;
    m.size[v]++;
    landAdd(m.lands[v], r);
    // 立国(国都划给它)的那一刻:预约第二位君主即位
    if (!m.reigned[v]) {
      m.reigned[v] = true;
      scheduleReign(sim, m, v, 1, sim.now);
    }
    if (tierOf(m.size[v]) > m.tier[v]) sim.schedule(sim.now, Ev.PolityRank, m.settlements[capitalAt(m.polities[v], sim.now)].region, v);
    spreadFrom(sim, m, r, v, sim.now);
  });

  sim.on(Ev.SettlementFound, (r, _b, t) => {
    if (m.cityOf[r] >= 0 || culture[r] < 0) return;
    foundCity(sim, m, r, t);
  });

  sim.on(Ev.PolityFound, (r, sid, t) => {
    const s = m.settlements[sid];
    // 阶段 3 城市兴衰:城已经被毁了(cities.ts)就立不成
    if (!s || s.region !== r || s.ended !== undefined || polity[r] >= 0 || m.near[r] > 0 || culture[r] < 0 || m.closed?.(r, -1, t)) return;
    const p = addPolity(m, sid, culture[r], t);
    sim.setOwner(Layer.Polity, r, p.id, Ev.PolityFound);
    sim.record('found', { a: p.id, region: r, settlement: sid });
  });

  sim.on(Ev.PolityArrive, (r, pid, t) => {
    if (polity[r] >= 0 || culture[r] < 0) return;
    // 阶段 4 干预"不许扩张":不进无主的州(禁令到期时 respread 从现有国土重新预约)
    if (m.iv?.halted(pid, t)) return;
    // 中立地、有限竞争之约(treaties.ts):不进
    if (m.closed?.(r, pid, t)) return;
    // 战争里丢了出发的那一州(或者已经灭亡),又没有和国都连成一片的州挨着这一州:不去了(不长出、不扩大飞地)
    if (m.polities[pid].ended !== undefined || !bordersCore(m, polity, pid, r, t)) return;
    sim.setOwner(Layer.Polity, r, pid, Ev.PolityArrive);
  });

  sim.on(Ev.PolityRank, (r, pid, t) => {
    const nt = tierOf(m.size[pid]);
    if (nt <= m.tier[pid]) return;
    const first = m.tier[pid] < 0;
    m.tier[pid] = nt;
    m.polities[pid].titles!.push({ year: t, tier: nt });
    // 立国那一刻的第 0 档不算升格(已经记了"立国")
    if (!first) sim.record('rank', { a: pid, region: r, settlement: capitalAt(m.polities[pid], t) });
  });

  // 新君即位(rulers.ts):门槛比上一位低的(比如扩张高的接了扩张低的),从现有国土往外重新看一遍边上的部落地带;预约下一位
  /** 国家 → 上一次办的、前一位被作者让他去世的交接是哪一刻(同一刻又改朝换代:两边各预约了一次,只办一次) */
  const killedHandover = new Map<number, Year>();
  sim.on(Ev.Reign, (k, pid, t) => {
    const p = m.polities[pid];
    if (!p || p.ended !== undefined) return;
    const list = bookOf(m, pid, t);
    // 改朝换代以后在位表重排了:旧君原来预约的交接对不上,丢掉(新朝的另有预约,见 dynastyReign)
    if (!list[k] || reignStart(list[k]) !== t) return;
    if (k > 0 && list[k - 1].death) {
      if (killedHandover.get(pid) === t) return;
      killedHandover.set(pid, t);
    }
    scheduleReign(sim, m, pid, k + 1, t);
    // 等前一位下台再即位的作者人物:这一刻即位,记一条史事(登记那一条 b = −6 在下令的那一年)
    const c = list[k].crown;
    if (c?.after) {
      const sid = capitalAt(p, t);
      sim.record('intervene', { a: pid, b: -1, region: m.settlements[sid]?.region ?? -1, settlement: sid, war: c.iv });
    }
    if (k > 0) {
      // 和方针一起算:上一位在上一刻的方针下 → 这一位在此刻的方针下(同一刻刚定了方针的,比的是原来的方针;没有方针 = 两位君主自己的倍数)
      const prev = effFor(m, pid, list[k - 1], t - 1 / 256);
      if (widens(prev, effFor(m, pid, list[k], t))) respread(sim, m, pid, prev);
      m.onReign?.(pid, k, list, t);
      m.afterReign?.(pid, k, list, t);
    }
  });

  // 迁都的下一刻(见 moveCapital):按新国都的路程从现有国土往外重新预约;
  // 定了方针的下一刻(a = POLICY_RESPREAD,见 setPolicy):门槛放低了才重新预约(只补新方针才肯去的州);
  // 立约与中立地解禁了几州的下一刻(a ≥ REOPEN,见 reopenedBy):四周的国家重新往那几州预约
  sim.on(Ev.Respread, (a, pid, t) => {
    if (a >= REOPEN) {
      reopen(sim, m, reopenedBy(sim.annal(a - REOPEN), reg, polity, culture));
      return;
    }
    const p = m.polities[pid];
    if (!p || p.ended !== undefined) return;
    if (a === POLICY_RESPREAD) {
      const prev = policyWidens(m, pid, t);
      if (prev) respread(sim, m, pid, prev);
      return;
    }
    respread(sim, m, pid);
  });

  // 航海时代(见 sailsOcean):在世的普通国家换成能渡海的路程表,从现有国土往外重新预约一遍(港口出发的航线、海峡对岸)。
  // 同一刻里排在别的事件前面(只在地形大事后面),这一刻起立的国、迁的都直接按能渡海的表算(voyageOf)
  sim.on(Ev.AgeOfSail, () => {
    for (const p of m.polities) {
      if (p.ended !== undefined || p.kind === 'sea') continue;
      m.capDist[p.id] = capitalDistance(T, m.settlements[capitalAt(p, Infinity)].region, 2, m.port);
      respread(sim, m, p.id);
    }
  });
  if (m.sailFrom > sim.now) sim.schedule(m.sailFrom, Ev.AgeOfSail, 0, 0);
}

/**
 * 普通国家 pid 从这一刻起能走远洋(国都的运输能力够了;development.ts 的发展度那一刻调用):记进 Polity.sail,
 * 换成能渡海的路程表,从现有国土往外重新预约一遍(和航海时代一样;resumePolities 按 Polity.sail 在同一刻重放)
 */
export function grantSail(sim: CivSim, m: PolityModel, pid: number): void {
  const p = m.polities[pid];
  if (p.kind === 'sea' || p.ended !== undefined || p.sail !== undefined) return;
  p.sail = sim.now;
  if (sim.now >= m.sailFrom) return; // 旧版本的历史:全世界已经进了航海时代
  m.capDist[pid] = capitalDistance(m.terrain, m.settlements[capitalAt(p, Infinity)].region, 2, m.port);
  respread(sim, m, pid);
}

/** 国家 pid 刚拿下州 r:给 r 的邻州里有人住、还没有国家的预约"国家到达" */
function spreadFrom(sim: CivSim, m: PolityModel, r: number, pid: number, t: number, prev?: LeaningEffect) {
  const reg = m.terrain.regions;
  const culture = sim.owners[Layer.Culture];
  const polity = sim.owners[Layer.Polity];
  const p = m.polities[pid];
  for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
    const j = reg.adj[k];
    if (culture[j] < 0 || polity[j] >= 0) continue;
    const dt = reachYears(m, sim, p, k, j, prev);
    if (dt < Infinity) sim.schedule(t + dt, Ev.PolityArrive, j, pid);
  }
}

/**
 * 刚散成无主的州 rs(干预"灭国"散成无主,interventions.ts;按州号升序):接壤的国家预约"国家到达"(和州刚有人定居时一样),
 * 这片地方慢慢被邻国扩进去。接着推时 resumePolities 按日志重放(归属变成 −1、原因 Ev.Cede 的那几条)
 */
export function reopen(sim: CivSim, m: PolityModel, rs: readonly number[]): void {
  const reg = m.terrain.regions;
  const culture = sim.owners[Layer.Culture];
  const polity = sim.owners[Layer.Polity];
  for (const r of rs) {
    if (culture[r] < 0 || polity[r] >= 0) continue;
    for (let q = reg.adjStart[r]; q < reg.adjStart[r + 1]; q++) {
      const j = reg.adj[q];
      const pid = polity[j];
      if (pid < 0) continue;
      const dt = reachYears(m, sim, m.polities[pid], edgeTo(reg, j, r), r);
      if (dt < Infinity) sim.schedule(sim.now + dt, Ev.PolityArrive, r, pid);
    }
  }
}

/**
 * Ev.Respread 的 a 从这里往上 = 立约与中立地(treaties.ts)解禁了几州:a − REOPEN = 那条史事的下标(见 reopenedBy)。
 * 那一刻的下一刻(b = 0)四周的国家重新往那几州预约扩张(reopen);中立地、有限竞争之约在的时候进那里的"国家到达"都丢掉了(PolityModel.closed)。
 * 接着推时 resumePolities 按史事在同一刻重放
 */
export const REOPEN = 1 << 24;

/**
 * 这条史事是不是有限竞争之约废了(约满不续 / 剩不到两国;下一刻约国旁边的无主之地解禁):
 * 推演自己立的看立约时几国(n,三国以上);作者下令立的照作者选的(Annal.opt 的第 1 位,见 treatyInfo.ts 的 OPT_LIMITED)
 */
export function limitedEnd(e: Readonly<Annal>): boolean {
  if (e.kind !== 'expire') return false;
  return e.opt !== undefined ? (e.opt & 1) !== 0 : (e.n ?? 0) >= 3;
}

/**
 * 史事 e 解禁了哪几州(此刻无主、有人住;owner / culture = 那一刻的归属;州号升序):
 * 中立地撤销、没还给哪国(neutral,cause = lapse,a = −1)= 那一州;有限竞争之约废了(expire,n = 立约时的国数,三国以上)= 约里几国陆上挨着的无主之地
 */
export function reopenedBy(e: Readonly<Annal>, reg: Regions, owner: ArrayLike<number>, culture: ArrayLike<number>): number[] {
  if (e.kind === 'neutral' && e.cause === 'lapse' && e.a < 0) return e.region >= 0 && culture[e.region] >= 0 && owner[e.region] < 0 ? [e.region] : [];
  if (!limitedEnd(e) || !e.ps?.length) return [];
  const ps = e.ps;
  const out = new Set<number>();
  for (let r = 0; r < reg.count; r++) {
    if (owner[r] < 0 || !ps.includes(owner[r])) continue;
    for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
      const j = reg.adj[k];
      const kind = reg.adjKind[k];
      if ((kind === AdjKind.Flat || kind === AdjKind.River || kind === AdjKind.Mountain) && owner[j] < 0 && culture[j] >= 0) out.add(j);
    }
  }
  return [...out].sort((a, b) => a - b);
}

/**
 * 国家 pid 从现有国土(州号升序)往外重新预约扩张:和每拿下一州时预约的一样(阶段 4 干预"不许扩张"到期、
 * 门槛更低的新君即位、迁都的下一刻调用;resumePolities 按日志重放时在同一刻做同样的事)。
 * prev(新君即位时)= 上一位君主的倍数:上一位就肯去的州不重复预约
 */
export function respread(sim: CivSim, m: PolityModel, pid: number, prev?: LeaningEffect): void {
  for (const r of m.lands[pid].slice()) spreadFrom(sim, m, r, pid, sim.now, prev);
}

/**
 * 在州 r 的治所建一座城(建城事件;阶段 3 城市兴衰的重建也走这里:rebuild.of = 被毁的旧城,成长速度 × rebuild.growth):
 * 人口上限、成长速度按州定(keyed,和先后无关);人口够立国的,预约"立国"。返回新城
 */
export function foundCity(sim: CivSim, m: PolityModel, r: number, t: Year, rebuild?: { of: number; growth: number }): Settlement {
  const reg = m.terrain.regions;
  const id = m.settlements.length;
  const s: Settlement = {
    id,
    cell: reg.seat[r],
    region: r,
    culture: sim.owners[Layer.Culture][r],
    name: '',
    founded: t,
    capacity: cityCapacity(m, r),
    growth: cityGrowth(m, r) * (rebuild ? rebuild.growth : 1),
    port: m.port[r] === 1,
  };
  if (rebuild) s.rebuilds = rebuild.of;
  // 人口上限随生产能力变的倍数:从建城那一刻的(development.ts 每 20 年更新)记起
  if (m.capFactor) s.devCap = [t, m.capFactor[r]];
  m.settlements.push(s);
  m.stag.push(nextTag(m.sAt, s.cell));
  m.cityOf[r] = id;
  const tf = foundingYear(s);
  if (tf < Infinity) sim.schedule(tf, Ev.PolityFound, r, id);
  return s;
}

/** 城 s 从 t 起做 pid 的国都(阶段 3 城市兴衰:记进 Settlement.capitalSpans,人口的国都加成按它涨落) */
function capitalOpen(s: Settlement, pid: number, t: Year) {
  if (s.capitalFrom === undefined) s.capitalFrom = t;
  const spans = (s.capitalSpans ??= []);
  const last = spans[spans.length - 1];
  if (last && last.until === undefined) return; // 已经是国都(同一刻换了一国:极少见)
  spans.push({ from: t, polity: pid });
}

/** 城 s 从 t 起不再是 pid 的国都(迁都 / 亡国;旧都的国都加成慢慢退掉) */
function capitalClose(s: Settlement, pid: number, t: Year) {
  const last = s.capitalSpans?.[s.capitalSpans.length - 1];
  if (last && last.until === undefined && last.polity === pid) last.until = t;
}

/** 国家 → 国都失去国都之位时的回调(阶段 3 城市兴衰:cities.ts 预约"看旧都"。只在推演里挂,不存进 Civ) */
const capitalLost = new WeakMap<PolityModel, (sid: number, pid: number, t: Year) => void>();

/** 推演模型 → 它挂着的推演引擎(installPolities 登记;迁都时预约 Ev.Respread 用) */
const simOf = new WeakMap<PolityModel, CivSim>();

/** 挂上"国都失去国都之位"的回调(cities.ts 用) */
export function onCapitalLost(m: PolityModel, fn: (sid: number, pid: number, t: Year) => void): void {
  capitalLost.set(m, fn);
}

/**
 * 迁都(战争里国都失守时由 wars.ts 调用,主动迁都由 politics.ts 调用):国都变迁表加一条、国都间距标记挪到新国都、新国都开始享受国都的人口加成(已经当过国都的照旧)、
 * 以后的扩张按新国都算路程(下一刻从现有国土往外重新预约一遍,Ev.Respread)。只改模型,史事由调用方记。
 * 旧都的国都加成慢慢退掉(Settlement.capitalSpans)
 */
export function moveCapital(m: PolityModel, pid: number, sid: number, t: Year): void {
  const p = m.polities[pid];
  const s = m.settlements[sid];
  const old = capitalAt(p, Infinity);
  // 国都间距标记跟着国都走:旧国都一带(没归别国的部落地带)以后又能立国,新国都周围不能
  const reg = m.terrain.regions;
  markNear(reg, m.settlements[old].region, m.spacing, m.near, -1);
  markNear(reg, s.region, m.spacing, m.near, 1);
  p.capitals!.push({ year: t, settlement: sid });
  if (old !== sid) {
    capitalClose(m.settlements[old], pid, t);
    capitalOpen(s, pid, t);
    capitalLost.get(m)?.(old, pid, t);
  }
  m.capDistPrev[pid] = m.capDist[pid];
  m.capDist[pid] = capitalDistance(m.terrain, s.region, voyageOf(m, p, t), m.port);
  m.capMoved[pid] = t;
  // 迁都那一刻的预约还按旧国都算(见 distFor),下一刻起按新的
  simOf.get(m)?.schedule(t + 1 / 256, Ev.Respread, 0, pid);
}

/** 国家灭亡 / 被并掉(wars.ts、politics.ts 调用):记下年份,撤掉(最后一个)国都周围的"国都间距"标记(以后那里又能立新国) */
export function endPolity(m: PolityModel, pid: number, t: Year): void {
  const p = m.polities[pid];
  p.ended = t;
  const cap = capitalAt(p, Infinity);
  markNear(m.terrain.regions, m.settlements[cap].region, m.spacing, m.near, -1);
  capitalClose(m.settlements[cap], pid, t);
  capitalLost.get(m)?.(cap, pid, t);
}

/**
 * 新国家(立国、分裂、复国共用):建国家表的一项、模型里各项(州数、档位、离国都的路程……)、国都周围的"国都间距"标记。
 * 还没有国土:调用方接着用 setOwner 把国都(和别的州)划给它,国都要第一个划(州数、升格、预约扩张都挂在监听上)。
 * sid = 国都,cu = 民族(国家的类型、扩张性、国号一系按它和国都所在州定)
 */
export function addPolity(m: PolityModel, sid: number, cu: number, t: Year, extra: Partial<Polity> = {}): Polity {
  const s = m.settlements[sid];
  const r = s.region;
  const seat = m.terrain.regions.seat[r];
  const kind = m.cultures[cu].kind;
  const p: Polity = {
    id: m.polities.length,
    name: '',
    culture: cu,
    capital: sid,
    founded: t,
    kind,
    expansionism: KIND_INFO[kind].expansionism * (0.8 + 0.5 * keyed(m.base, seat, 5)),
    color: [128, 128, 128],
    lineage: lineageOf(m.base, kind, seat),
    titles: [],
    capitals: [{ year: t, settlement: sid }],
    ...extra,
  };
  capitalOpen(s, p.id, t);
  m.polities.push(p);
  m.ptag.push(nextTag(m.pAt, seat));
  m.rtag.push(nextTag(m.rAt, s.cell));
  m.reigned.push(false);
  m.size.push(0);
  m.lands.push([]);
  m.tier.push(-1);
  m.capDist.push(capitalDistance(m.terrain, r, voyageOf(m, { kind, sail: p.sail }, t), m.port));
  m.capDistPrev.push(null);
  m.capMoved.push(-Infinity);
  markNear(m.terrain.regions, r, m.spacing, m.near, 1);
  return p;
}

/**
 * 由 Civ 重建城镇、国家层的推演状态(CivSim.fromCiv 调用,在 resumeCultures 之后):
 * 登记事件处理,再按日志重算所有还没发生的"建城""立国""国家到达"。
 *
 * "国家到达"按日志从头重放:每次有国家拿下一州、每次有州新定居,当时预约了哪些到达、各在哪一年,
 * 照原样重算一遍(离国都的路程按当时的国都),还没到期、目标州还没归国家的补进引擎 ——
 * 包括从后来在战争里丢掉的州出发的那些(触发时再按接壤与否判断,和一口气推完时一样)。
 * 阶段 4 干预"不许扩张"到期的那一刻(已经过去的,iv 给出)也照样重放:那一刻这国从当时的国土往外预约了一遍(见 respread),
 * 到期事件在同一刻里排在别的事件前面(只在地形大事、看王朝、即位、重看边地后面,其中只有地形大事改归属),
 * 所以排在那一刻的日志(大事改的除外)前面。门槛更低的新君即位、迁都的下一刻也一样重放。
 */
export function resumePolities(sim: CivSim, world: World, civ: Civ, iv?: InterventionModel | null): void {
  const T = cultureTerrain(world, civ.habitat, civ.regions, civ.frontier);
  const reg = T.regions;
  const R = T.R;
  // 国都间距:推出这份历史时定的(CivParams.polities);旧版本的历史没记,按默认的"自动"数量(和 planPolities 同一个公式)
  // 民族表用 cultures.ts 接着推时复制的那一份(推演中分化出的新民族加在那一份里)
  const m = emptyModel(T, cultureModelOf(sim)?.cultures ?? civ.cultures, civ.seed, findPorts(world, T), civ.capSpacing ?? capitalSpacing(T, 'auto'), civ.polityYears ?? STEP_YEARS, civ.sailFrom ?? ageOfSailYear(1), civ.capNorm, civ.frontier?.expand);
  // 阶段 3 城市兴衰:国都年份段、洗劫记录接着推时会往里加,复制一份(不改传进来的 civ)
  m.settlements = civ.settlements.map((s) => {
    const c = { ...s };
    if (s.capitalSpans) c.capitalSpans = s.capitalSpans.map((x) => ({ ...x }));
    if (s.sacks) c.sacks = s.sacks.map((x) => ({ ...x }));
    if (s.devCap) c.devCap = s.devCap.slice();
    return c;
  });
  m.polities = civ.polities.map((p) => ({
    ...p,
    titles: (p.titles ?? []).map((t) => ({ ...t })),
    capitals: (p.capitals ?? [{ year: p.founded, settlement: p.capital }]).map((c) => ({ ...c })),
    ...(p.dynasties ? { dynasties: p.dynasties.map((d) => ({ ...d })) } : {}),
    ...(p.seizes ? { seizes: p.seizes.map((x) => ({ ...x })) } : {}),
  }));
  // 作者立的君主、让君主去世、改君主倾向:生效了的由史事推出来,在位表照它排(和推演时一样)
  m.acts = actsFrom(civ.annals, iv?.list);
  // 国家方针:生效了的由史事推出来(和推演时一样,下一刻起算)
  m.policies = policiesFrom(civ.annals, iv?.list);
  // 州里现在的城(被毁的不算:阶段 3 城市兴衰,毁了还没重建的州没有城)
  for (const s of m.settlements) if (s.ended === undefined) m.cityOf[s.region] = s.id;
  // 位置锚:按编号(= 建城 / 立国先后)数"这州第几个",和推演时一样
  for (const s of m.settlements) m.stag.push(nextTag(m.sAt, s.cell));
  for (const p of m.polities) m.ptag.push(nextTag(m.pAt, reg.seat[m.settlements[p.capital].region]));
  // 君主在位表的位置锚(按国都的城所在地块数,和 people.ts 一样,见 rulerTags);交接都已预约过(下面补还没到的)
  for (const p of m.polities) {
    m.rtag.push(nextTag(m.rAt, m.settlements[p.capital].cell));
    m.reigned.push(true);
  }
  // 掌实权的几段:由史事推出来(regency.ts;下面重放扩张算账时就要照掌权的人的倾向算,和推演时一样)
  m.regents = regentsFrom(regencyCtx(m), civ.annals);
  // 各国历任国都的路程表(按国都所在州缓存)
  const distCache = new Map<number, Float32Array>();
  // t = 用这张表的时刻(渡海的一档按它定,见 voyageOf)
  const distOf = (p: Polity, sid: number, t: Year) => {
    const r = m.settlements[sid].region;
    const sea = voyageOf(m, p, t);
    const key = r * 3 + sea;
    let d = distCache.get(key);
    if (!d) distCache.set(key, (d = capitalDistance(T, r, sea, m.port)));
    return d;
  };
  for (const p of m.polities) {
    m.size.push(0);
    m.lands.push([]);
    const tl = p.titles ?? [];
    m.tier.push(tl.length ? tl[tl.length - 1].tier : -1);
    const caps = p.capitals!;
    // 航海时代那一刻起,在世的普通国家换成能渡海的表(见 Ev.AgeOfSail);上一张表是迁都那一刻在用的
    m.capDist.push(distOf(p, caps[caps.length - 1].settlement, Math.min(sim.now, p.ended ?? Infinity)));
    m.capDistPrev.push(caps.length > 1 ? distOf(p, caps[caps.length - 2].settlement, caps[caps.length - 1].year) : null);
    m.capMoved.push(caps.length > 1 ? caps[caps.length - 1].year : -Infinity);
    // 国都间距标记跟着国都走(见 moveCapital):在世的国家标在现在的国都周围
    if (p.ended === undefined) markNear(reg, m.settlements[caps[caps.length - 1].settlement].region, m.spacing, m.near, 1);
  }
  for (let r = 0; r < R; r++) {
    if (civ.polity[r] < 0) continue;
    m.size[civ.polity[r]]++;
    m.lands[civ.polity[r]].push(r);
  }
  installPolities(sim, m);

  const now = sim.now;
  const culture = sim.owners[Layer.Culture];
  const polity = sim.owners[Layer.Polity];
  // 定居年份(日志里最后一次"从没人住变成有人住";阶段 3 同化、迁徙改换民族不算定居,建城不另预约)。
  // 顺带记下每州最后一条日志的下标(下面判断当年预约的"国家到达"过期了没有)
  const settled = new Float64Array(R).fill(Infinity);
  const settledAt = new Int32Array(R).fill(-1);
  const lastLog = new Int32Array(R).fill(-1);
  const log = civ.log;
  {
    const cur = new Int16Array(R).fill(-1);
    for (let i = 0; i < log.size; i++) {
      const r = log.region[i];
      lastLog[r] = i;
      if (log.layer[i] !== Layer.Culture) continue;
      const v = log.value[i];
      if (v >= 0 && cur[r] < 0) {
        settled[r] = log.year[i];
        settledAt[r] = i;
      } else if (v < 0) settled[r] = Infinity;
      cur[r] = v;
    }
  }
  // 建城:住得了人的州在定居那一刻预约过,还没到的补上。州里已经有城(或有过城、后来被毁了)的照样补:到时州里有城就建不成,
  // 城被毁了、还没重建的就建一座新城,和一口气推完一样(立国干预在没人住的州先来一支新民族、当场建城,城没过几年就被毁,就会这样)。
  // 地形大事那一刻接着推也一样
  // 按定居的先后预约(一口气推完时是定居那一刻预约的):同一刻建两座城的,先后和一口气推完一样
  const toFound: number[] = [];
  for (let r = 0; r < R; r++) {
    if (culture[r] < 0 || !T.habitable[r] || !(settled[r] < Infinity)) continue;
    if (quantize(settled[r] + foundDelay(m, r)) <= now) continue;
    toFound.push(r);
  }
  toFound.sort((x, y) => settledAt[x] - settledAt[y]);
  for (const r of toFound) sim.schedule(settled[r] + foundDelay(m, r), Ev.SettlementFound, r, 0, settled[r]);
  // 还没到立国年份的城(建城那一刻预约的)。当过国都的照样补:迁都迁来的城、立国干预 / 边缘立国用的城,自己的立国还在后头,
  // 那时那一州要是又没了国家(原来的国家亡了、散回部落……)、离别的国都也够远,就照原定的年份立国,和一口气推完一样。
  // 被毁的城不补(立国事件触发时立不成)。地形大事那一刻接着推也一样
  for (const s of m.settlements) {
    if (s.ended !== undefined) continue;
    const tf = foundingYear(s);
    if (tf < Infinity && quantize(tf) > now) sim.schedule(tf, Ev.PolityFound, s.region, s.id, s.founded);
  }
  // "国家到达":按日志重放。预约那一刻的国都 = 在那一刻之前(不含同一时刻)最近的一次迁都后的国都,见 distFor
  const distAt = (pid: number, y: number): Float32Array => {
    const p = m.polities[pid];
    const caps = p.capitals!;
    let sid = caps[0].settlement;
    for (let i = 1; i < caps.length && caps[i].year < y; i++) sid = caps[i].settlement;
    return distOf(p, sid, y);
  };
  const cu = new Int16Array(R).fill(-1);
  const po = new Int16Array(R).fill(-1);
  const pend: { t: number; j: number; pid: number }[] = [];
  /** 第 i 条日志引起的一次预约:国家 pid 经边 k 进州 j(路程、民族都按当时的) */
  const add = (i: number, pid: number, k: number, j: number, y: number, prev?: LeaningEffect) => {
    // 预约之后目标州的归属(任何一层)又变过:引擎里那次到达已经过期(版本号对不上)——
    // 归了国家(以后也不会变回无主),或者阶段 3 同化 / 迁徙改换了民族
    if (lastLog[j] > i || polity[j] >= 0) return;
    // 扩张算账:当时在位的君主、当时的四邻(po 是那一刻的归属),和推演时一样
    const dist = distAt(pid, y);
    if (!wants(m, po, m.polities[pid], j, dist, cu[j], effOf(m, pid, y))) return;
    // 新君即位时重新预约的:上一位就肯去的不重复预约(见 reachYears)
    if (prev && wants(m, po, m.polities[pid], j, dist, cu[j], prev)) return;
    const dt = stepYearsWith(m, m.polities[pid], k, j, dist, cu[j], y);
    if (dt < Infinity && quantize(y + dt) > now) pend.push({ t: y + dt, j, pid });
  };
  // 从现有国土往外重新预约(respread)的时刻,按先后:
  // - 阶段 4 干预"不许扩张"已经到期的:到期那一刻这国从当时的国土(州号升序)往外预约
  // - 门槛比上一位低的新君即位的那一刻(Ev.Reign;在位表由立国、改朝换代的年份和作者立的君主算出来,见 rulers.ts)
  // - 迁都的下一刻(Ev.Respread;迁都记在 Polity.capitals)
  // 后两种在引擎里排在同一刻别的事件前面,只在地形大事、看王朝后面(sim.ts 的 earlyOrder;看王朝不改归属),所以这里在同一刻的日志之前重放,
  // 同一刻有地形大事的,在大事改归属的那几条日志之后
  if (iv) iv.pm = m;
  const ends: { t: number; key?: string; pid: number; prev?: LeaningEffect; annal?: number }[] = iv ? iv.haltEndsUpTo(now).map((e) => ({ t: e.t, key: e.key, pid: -1 })) : [];
  // 立约与中立地解禁了几州的下一刻(见 REOPEN):四周的国家往那几州预约(和 reopen 一样)
  civ.annals.forEach((e, i) => {
    if (((e.kind === 'neutral' && e.cause === 'lapse' && e.a < 0) || limitedEnd(e)) && e.year + 1 / 256 <= now) ends.push({ t: e.year + 1 / 256, pid: -1, annal: i });
  });
  for (const p of m.polities) {
    const until = Math.min(p.ended ?? Infinity, now);
    const list = bookOf(m, p.id, until);
    for (let k = 1; k < list.length; k++) {
      const t = reignStart(list[k]);
      if (t > until) break;
      const prev = effFor(m, p.id, list[k - 1], t - 1 / 256);
      if (widens(prev, effFor(m, p.id, list[k], t))) ends.push({ t, pid: p.id, prev });
    }
    // 定了方针、改了君主倾向的下一刻:门槛放低了的(同一刻同一国定了几条只算一次,见 retune)
    for (const t0 of retuneTimes(m, p.id)) {
      const t = t0 + 1 / 256;
      if (t > until) continue;
      const prev = policyWidens(m, p.id, t);
      if (prev) ends.push({ t, pid: p.id, prev });
    }
    const caps = p.capitals!;
    for (let i = 1; i < caps.length; i++) if (caps[i].year + 1 / 256 <= until) ends.push({ t: caps[i].year + 1 / 256, pid: p.id });
    // 航海时代那一刻在世的普通国家(见 Ev.AgeOfSail;同一刻灭亡的,灭亡排在它后面)
    if (p.kind !== 'sea' && p.founded < m.sailFrom && m.sailFrom <= now && !((p.ended ?? Infinity) < m.sailFrom)) ends.push({ t: m.sailFrom, pid: p.id });
    // 这国自己能远洋的那一刻(发展度那一刻,见 grantSail;那时它一定还在)。立国就带着的(分裂时从母国带来)在同一刻立国的日志之前重放,
    // 那时它还没有州,什么也不做 —— 和推演里一样(立国时离国都的路程表已经按能远洋算,见 addPolity)
    if (p.sail !== undefined && p.sail <= now && p.sail < m.sailFrom) ends.push({ t: p.sail, pid: p.id });
  }
  ends.sort((a, b) => a.t - b.t);
  let ei = 0;
  /** 在第 i 条日志之后(下一条之前)重放到期的预约 */
  const retrigger = (i: number, y: number) => {
    for (; ei < ends.length && ends[ei].t <= y; ei++) {
      const e = ends[ei];
      if (e.annal !== undefined) {
        for (const r of reopenedBy(civ.annals[e.annal], reg, po, cu)) {
          for (let q = reg.adjStart[r]; q < reg.adjStart[r + 1]; q++) {
            const j = reg.adj[q];
            if (po[j] >= 0) add(i, po[j], edgeTo(reg, j, r), r, e.t);
          }
        }
        continue;
      }
      const pid = e.key !== undefined ? iv!.resolveBefore(e.key, e.t) : e.pid;
      if (pid < 0) continue;
      for (let r = 0; r < R; r++) {
        if (po[r] !== pid) continue;
        for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
          const j = reg.adj[k];
          if (cu[j] >= 0 && po[j] < 0) add(i, pid, k, j, e.t, e.prev);
        }
      }
    }
  };
  for (let i = 0; i < log.size; i++) {
    const r = log.region[i];
    const v = log.value[i];
    const y = log.year[i];
    if (ei < ends.length) retrigger(i - 1, log.cause[i] === Ev.Upheaval ? y - 1 / 512 : y);
    if (log.layer[i] === Layer.Culture) {
      cu[r] = v;
      if (v < 0 || po[r] >= 0) continue;
      for (let q = reg.adjStart[r]; q < reg.adjStart[r + 1]; q++) {
        const pid = po[reg.adj[q]];
        if (pid >= 0) add(i, pid, edgeTo(reg, reg.adj[q], r), r, y);
      }
    } else {
      po[r] = v;
      if (v < 0) {
        // 干预"灭国"散成无主的州:接壤的国家预约到达(见 reopen;灭掉的那国这一刻已亡,还没散完的州不算)
        if (log.cause[i] === Ev.Cede && cu[r] >= 0) {
          for (let q = reg.adjStart[r]; q < reg.adjStart[r + 1]; q++) {
            const pid = po[reg.adj[q]];
            if (pid >= 0 && !((m.polities[pid].ended ?? Infinity) <= y)) add(i, pid, edgeTo(reg, reg.adj[q], r), r, y);
          }
        }
        continue;
      }
      for (let k = reg.adjStart[r]; k < reg.adjStart[r + 1]; k++) {
        const j = reg.adj[k];
        if (cu[j] >= 0 && po[j] < 0) add(i, v, k, j, y);
      }
    }
  }
  if (ei < ends.length) retrigger(log.size - 1, Infinity);
  for (const e of pend) sim.schedule(e.t, Ev.PolityArrive, e.j, e.pid);
  // 在世的国家:下一次君主交接(此刻刚改朝换代的,新朝第一位下一刻即位);此刻刚迁都、刚定了方针的,下一刻重新预约扩张
  for (const p of m.polities) {
    if (p.ended !== undefined) continue;
    // 立国那一条(capitals[0])不是迁都,推演里没有预约(分裂出来的国家正好在此刻立国时会多出一次)
    for (const c of p.capitals!.slice(1)) if (c.year + 1 / 256 > now) sim.schedule(c.year + 1 / 256, Ev.Respread, 0, p.id);
    // 此刻刚定了方针、改了君主倾向的:下一刻比一比门槛(见 retune;同一刻定了几条也只预约一次)
    const tunes = retuneTimes(m, p.id);
    const tune = tunes[tunes.length - 1];
    if (tune !== undefined && tune + 1 / 256 > now) {
      m.retune.set(p.id, tune);
      sim.schedule(tune + 1 / 256, Ev.Respread, POLICY_RESPREAD, p.id);
    }
    const list = bookOf(m, p.id, now);
    const last = list.length - 1;
    if (reignStart(list[last]) > now) sim.schedule(reignStart(list[last]), Ev.Reign, last, p.id);
    else scheduleReign(sim, m, p.id, last + 1, now);
  }
}

// ---------------------------------------------------------------------------
// 推演之后:配色、起名

/** 国家色板:柔和、色相拉开的政区图配色(写实风淡罩一层,手绘风做水彩);不用绿色(森林、林地本身是绿的,绿色罩染看不出来) */
export const POLITY_PALETTE: [number, number, number][] = [
  [214, 96, 77], // 朱
  [74, 128, 196], // 蓝
  [232, 168, 56], // 金
  [150, 98, 178], // 紫
  [70, 164, 158], // 青
  [226, 126, 164], // 粉
  [168, 120, 72], // 赭
  [228, 112, 108], // 鲑红
  [96, 104, 176], // 靛
  [206, 150, 110], // 驼
  [186, 70, 110], // 玫
  [96, 170, 212], // 天
  [196, 142, 48], // 赭黄(纸本身偏黄,太浅的黄色看不出来)
  [128, 96, 88], // 褐
  [200, 110, 200], // 品
  [58, 104, 168], // 钴蓝
  [240, 140, 96], // 橙
  [110, 128, 150], // 石板
  [178, 60, 60], // 绛
  [140, 180, 180], // 灰青
];

function colorDist(a: readonly number[], b: readonly number[]): number {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/**
 * 分裂 / 复国出来的国家和原来的国家(Polity.parent)的色差另加分(× PARENT_COLOR_W,最多算到 400):
 * 分出来的新国一定挨着原国,颜色要格外错开,回放时才看得出"裂出了一块"
 */
const PARENT_COLOR_W = 0.6;

/**
 * 配色:按编号(= 立国先后)依次挑,和邻国色差越大越好(和原国更要错开);同一时期的国家尽量不重复
 * (早已灭亡的国家的颜色可以再用:阶段 3 分分合合,先后立过的国家比色板里的颜色多)。
 * nb[国家] = 它的"邻国":只看编号在它前面的(立国以前就有的),推得再远颜色也不变
 */
function assignPolityColors(polities: Polity[], nb: Set<number>[], base: number, tags: readonly number[], pins?: NamePins['polities']) {
  const used = new Uint8Array(POLITY_PALETTE.length);
  const paletteOf: number[] = [];
  for (const p of polities) {
    // 地形大事:钉住的配色照用(见 NamePins)
    const pc = pins?.get(p.id)?.color;
    if (pc) {
      paletteOf.push(Math.max(0, POLITY_PALETTE.findIndex((c) => c[0] === pc[0] && c[1] === pc[1] && c[2] === pc[2])));
      p.color = [...pc] as [number, number, number];
      continue;
    }
    // 立国时还在世的国家用过的颜色(编号在前的国家立国不晚于它)
    used.fill(0);
    for (let q = 0; q < p.id; q++) {
      const Q = polities[q];
      if (Q.ended === undefined || Q.ended > p.founded) used[paletteOf[q]] = 1;
    }
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < POLITY_PALETTE.length; i++) {
      const col = POLITY_PALETTE[i];
      let near = 400;
      for (const o of nb[p.id]) if (o < p.id) near = Math.min(near, colorDist(col, polities[o].color));
      const parent = p.parent !== undefined ? PARENT_COLOR_W * Math.min(400, colorDist(col, polities[p.parent].color)) : 0;
      const s = Math.min(near, 280) + parent - (used[i] ? 220 : 0) - 1.2 * i + 20 * keyed(base, tags[p.id], i, 9);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    }
    paletteOf.push(best);
    p.color = [...POLITY_PALETTE[best]] as [number, number, number];
  }
}

/** 配色时的"邻国":立国那一刻,国都周围这么多跳(州图上走)以内有国土的国家(日后多半要接壤) */
const COLOR_NEAR_HOPS = 5;

/**
 * 推演结束后:配色、国名词根、城名。每样都只看它出现那一刻以前的历史,推到哪一年都一样 —— 接着往后推,已经有的不变:
 * 配色的"邻国"按立国那一刻国都周围的国家(按日志,见 COLOR_NEAR_HOPS);城名、国名、朝名按出现的先后起(见 naming.ts)。
 * authored = 作者在干预"立国"时起好的国名(国家编号 → 国名);别的国名、朝名都重起(接着推时传进来的是起过名的)
 */
export function finishPolities(world: World, m: PolityModel, log: Readonly<ChangeLog>, pins?: NamePins, authored?: ReadonlyMap<number, string>): void {
  const seed = m.seed;
  const reg = m.terrain.regions;
  const nb = m.polities.map(() => new Set<number>());
  const replay = new OwnerReplay(log, Layer.Polity, reg.count);
  for (const p of m.polities) {
    ownersNear(reg, replay.to(p.founded), m.settlements[p.capital].region, COLOR_NEAR_HOPS, p.id, nb[p.id]);
  }
  assignPolityColors(m.polities, nb, subSeed(seed, 'civ-polity-color'), m.ptag, pins?.polities);
  // 城名先起:西幻的王朝名借王室根据地的城名(阶段 3 王朝更替)。城名、国名各用各的种子,先后不影响结果
  nameSettlements(seed, m.settlements, m.cultures, pins?.settlements);
  for (const p of m.polities) {
    p.name = authored?.get(p.id) ?? '';
    p.dynasties?.forEach((d) => (d.name = ''));
  }
  // 地形大事:钉住的国名先占上(和干预"立国"时作者起的国名一样不另起),朝名起完再照钉住的改回去
  if (pins) for (const [id, v] of pins.polities) if (v.name && m.polities[id]) m.polities[id].name = v.name;
  const pinned = pins ? new Set([...pins.polities.values()].map((v) => v.name ?? '')) : undefined;
  namePolities(seed, m.polities, m.cultures, { settlements: m.settlements, regionNames: m.terrain.regions.name }, restoreDirection(world, m), pinned);
  if (pins)
    for (const [id, v] of pins.polities) {
      const ds = m.polities[id]?.dynasties;
      if (ds) v.dynasties.forEach((x, i) => x !== undefined && ds[i] && (ds[i].name = x));
    }
}

/** 复国的新国都离故国最后的国都超过这么多个州的间距,国名按方向加前缀("南昌"),否则算在故地复国("后昌") */
const RESTORE_FAR = 4;

/** 复国的国家在故国的哪个方向另立(见 naming.ts 的 namePolities) */
function restoreDirection(world: World, m: PolityModel): RestoreDirection {
  const reg = m.terrain.regions;
  let area = 0;
  for (let r = 0; r < reg.count; r++) area += reg.area[r];
  const far = RESTORE_FAR * Math.sqrt(area / Math.max(1, reg.count));
  const geo = geometryOf(world.mesh);
  const d = [0, 0];
  return (p, fallen) => {
    const a = m.settlements[p.capital].cell;
    const b = m.settlements[capitalAt(fallen, Infinity)].cell;
    if (geo.dist2(a, b) < far * far) return null;
    geo.offset(b, a, d);
    const dx = d[0];
    const dy = d[1]; // 当地(东, 南)分量:dy 正 = 向南
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? '东' : '西';
    return dy > 0 ? '南' : '北';
  };
}

/**
 * 修路用的城(交给 routes.ts):国都、港口,以及长到过"镇"以上的城镇(村子不修路,路网不至于密成一张网)。
 * 国都(含迁都后的新国都)= 大城(大路从立都 / 迁都那年起修),港口照城镇的标记。
 * "建城年份"交给道路的是这座城长成镇的年份(港口 = 真正的建城年份,国都 = 立都那年和长成镇那年里早的那个):
 * 路随城镇长大一条条修起来,早年只有零星村落,不会一开始就路网密布。路的修建年份取两端里较晚的那个。
 * 长成过镇、后来又衰落的城照样通路(路只随城被毁荒废):够不够格只看那一年以前,推得更远,早先修的路不变。
 *
 * 阶段 3 城市兴衰:同一处城址先后的城(被毁、又重建,同一地块)合成一座,每一座够格修路的城记一段在世的年份(lives):
 * 通往废城的路被毁那年荒废,原址重建的城长成镇(或立都)以后重新通路。ended = 最后一座城被毁的年份(还在 = 不给)。
 */
export function routeCities(settlements: Settlement[], polities: Polity[], endYear: Year): RouteCity[] {
  const capitalFrom = new Map<number, Year>();
  for (const p of polities) {
    for (const c of p.capitals ?? [{ year: p.founded, settlement: p.capital }]) {
      capitalFrom.set(c.settlement, Math.min(capitalFrom.get(c.settlement) ?? Infinity, c.year));
    }
  }
  const town = SETTLEMENT_RANKS[ROUTE_MIN_RANK].min;
  // 同一地块先后的城(按建城先后)
  const atCell = new Map<number, Settlement[]>();
  for (const s of settlements) {
    const g = atCell.get(s.cell);
    if (g) g.push(s);
    else atCell.set(s.cell, [s]);
  }
  /** 港口:按这份历史的最后一段地形(地形大事以后城址变了的,见 Settlement.reshaped) */
  const port = (s: Settlement) => portAt(s, Infinity);
  /**
   * 够格修路的年份:港口 = 建城那年;国都 = 立都那年和长成镇那年里早的那个;其余 = 长成镇那年
   * (只看结束年份 / 被毁以前;被毁前没长成镇 = Infinity)。地形大事以后才成了港口的:成港口那年和长成镇那年里早的那个(航线另记,见下面的 portFrom)
   */
  const from = (s: Settlement): Year => {
    const harbor = portSince(s);
    if (harbor === s.founded) return s.founded;
    let y = Math.max(s.founded, yearReachingPop(s, town, s.ended ?? endYear));
    if (s.ended !== undefined && !(y < s.ended)) y = Infinity;
    return Math.min(y, capitalFrom.get(s.id) ?? Infinity, harbor);
  };
  const out: RouteCity[] = [];
  for (const s of settlements) {
    const g = atCell.get(s.cell)!;
    if (g[0] !== s) continue;
    const lives: [Year, Year][] = [];
    let majorFrom = Infinity;
    for (const x of g) {
      const a = from(x);
      const e = x.ended ?? Infinity;
      if (a < e) {
        // 毁了当年就在原址重建的:连成一段
        const last = lives[lives.length - 1];
        if (last && a <= last[1]) last[1] = Math.max(last[1], e);
        else lives.push([a, e]);
      }
      if (capitalFrom.has(x.id)) majorFrom = Math.min(majorFrom, capitalFrom.get(x.id)!);
    }
    if (!lives.length) continue;
    const founded = lives[0][0];
    // 港口看这处城址的最后一座城:先前的城可能在地形大事以前就毁了,记着的还是那时的港口
    const last = g[g.length - 1];
    const c: RouteCity = { cell: s.cell, major: majorFrom < Infinity, majorFrom: majorFrom < Infinity ? majorFrom : undefined, port: port(last), founded };
    // 航线从这处城址一直是港口的那年起(陆路照上面的 founded):从最后一座城往前,前一座到最后也是港口的接着往前算
    // (中间毁了又重建不算断)。地形大事以后才成了港口的、原址重建时才成港口的,航线不早于那年
    let harbor = portSince(last);
    for (let i = g.length - 2; i >= 0 && harbor === g[i + 1].founded; i--) {
      const h = portSince(g[i]);
      if (!(h < Infinity)) break;
      harbor = h;
    }
    if (harbor < Infinity && harbor > founded) c.portFrom = harbor;
    if (last.ended !== undefined) c.ended = last.ended;
    if (lives.length > 1 || lives[0][1] !== (c.ended ?? Infinity)) c.lives = lives;
    out.push(c);
  }
  // 按够格的先后排(并列按地块):推得更远时,早先够格的城编号不变
  return out.sort((a, b) => a.founded - b.founded || a.cell - b.cell);
}

/**
 * 城址空着的年份段(交给 routes.ts):同一地块上的城被毁、到原址重建起下一座城以前(没重建 = 一直空着),村子也算。
 * 推演里走过的航线登岸处正是这样一处故址的,这些年不画(港口之间的航线、陆路已经按 RouteCity.lives 断开)
 */
export function ruinGaps(settlements: readonly Settlement[]): Map<number, [Year, Year][]> {
  const atCell = new Map<number, Settlement[]>();
  for (const s of settlements) {
    const g = atCell.get(s.cell);
    if (g) g.push(s);
    else atCell.set(s.cell, [s]);
  }
  const out = new Map<number, [Year, Year][]>();
  for (const [cell, g] of atCell) {
    const gaps: [Year, Year][] = [];
    for (let i = 0; i < g.length; i++) {
      const e = g[i].ended;
      const next = i + 1 < g.length ? g[i + 1].founded : Infinity;
      if (e !== undefined && e < next) gaps.push([e, next]);
    }
    if (gaps.length) out.set(cell, gaps);
  }
  return out;
}

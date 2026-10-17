/**
 * 发展度:各州的物产、五种能力和时代,在推演里每 STEP(20)年算一步(Ev.DevTick,同一刻里排在地形大事、航海时代后面,别的事件前面),
 * 再反过来影响推演。纯计算,不碰 DOM。
 *
 * **物产**(每州一份,不随年份变):粮、牲畜(含马)、铜锡、铁、煤、木材、盐、渔获、石油、稀有矿、金银,各 0–3 档(没有 / 少 / 中 / 多)。
 *   从地形、群落、气候、板块算一个"有多少"的分,按全世界的排名分档:每样只有一部分州有(RESOURCE_SHARE),
 *   有的里面少、中、多大约各占一半、三成、两成。矿和煤另加一点按州的随机(同一片山里也有贫有富)。
 *   这是底子(储量);眼下能用多少按年份变(avail):
 *   - 发现:粮、牲畜、木材、盐、渔获有人住就知道;矿要本州的生产能力到了 DISCOVER_AT(比要它的那道时代门槛早一截)才发现。
 *   - 矿(铜锡、铁、煤、石油、稀有矿、金银):技术越高采得越多(发现后约一个半时代采到足量);一档储量全力采 LIFE 年,剩最后三成时越采越少,直到采空。
 *   - 林、渔、田、牧:人多、开发久的地方慢慢吃空(捕鱼到火药以后才吃得空),人少了每年长回缺口的 REGROW;盐不变。
 *   生产、运输的动力和卡脖子的物产都按眼下能用的算(采空了也会卡住)。
 *   地形大事以后按新地形重新分档(接着推时),储量按新旧档位之比缩放。
 *
 * **五种能力**(每州每 STEP 年算一次):生产、运输、信息、行政、动员。数值和时代用同一把尺子(0 = 石器时代开头,
 *   1 = 青铜时代开头,……,见 ERAS),每样能力:
 *   - 自己长(创新):速度 = 动力 ÷ 这一档要的年数(ERA_YEARS)。动力看这一样能力靠什么:
 *       生产看粮和人口,运输看路(推演里还没有路网,在国家里、有长到镇的城就算有路)、大河、海港、木材,
 *       信息看大城、国都、和多少外邦相邻,行政看有没有国家、国家多大多老、是不是国都;
 *     打仗的地方长得慢(近几十年本州的战役、攻占、洗劫越多越慢)。
 *     某一样比这个州的时代领先近一档时,自己长得很慢;领先两档以上时,向邻居学也很慢(单靠一样堆不上去)。
 *   - 向邻居学(传播):向本样能力最高的那个邻州靠拢,差得越多学得越快。同一国里快、跨国慢,翻山、过海峡、走航线更慢;
 *     行政主要在一国之内传。
 *   - 战乱折损:本州的攻占、战役、洗劫、毁城当即扣一点;之后按到过的最高值较快地恢复(技术没丢,只是要重建)。
 *   - **跨时代的门槛**(到下一个时代门口 GATE_NEAR 以内时查;不够的自己长得只剩 GATE_SLOW,主要靠邻居传过来):
 *     · 物产(只卡生产):进青铜要铜锡,进铁器要铁,进工业要煤和铁,进电气要石油,进信息要稀有矿 —— 本州、相邻的州或者本国有就行(买得到);
 *     · 组织:进铁器以后要在国家里;进中古以后国家要到"国"一档以上、本州行政能力够(比要进的时代低 ADMIN_GAP 以内);
 *     · 太平和城:进火药以后本州近年少战乱、有长到镇的城;
 *     · 地理:进工业以后要沿海(有港口)、有大河或是平原。
 *   - 动员不单独长:跟着生产和行政走(游牧民族另高一截)。
 *   - 没人住的州不长;刚有人住的州带着邻居的本事来(取最高邻居的 SETTLE_CARRY)。
 *
 * **时代** = 生产、运输、信息、行政四样的"偏短板"平均(调和平均,见 eraLevel):整数部分是哪个时代,小数部分是走到这个时代的几成。
 *
 * **反过来影响推演**(第 2 步):
 *   - 城和乡村的人口上限 × popFactor(本州的生产能力):石器时代 POP_BASE 倍,往上每一档 + POP_PER,最多 POP_MAX 倍。
 *     每步看一次,变了才记进 Settlement.devCap(20 年里渐渐变过去,见 growth.ts 的 devFactorAt);立国的时机不随它变。
 *   - 打仗的国力 × 军力系数(PolityModel.military):1 + MIL_PER × 国都所在州的动员能力,最多 MIL_MAX。
 *   - 普通国家国都所在州的运输能力到了 SAIL_LEVEL,从这一刻起能走远洋(polities.ts 的 grantSail;没有全世界统一的航海时代了)。
 *
 * **大事**:世界上第一次有州进入某个时代(first,记州、民族、国家、城);各国国都所在的州第一次进入某个时代(enter;立国时已在的时代不记);
 *   储量多的州发现一样矿(discover)、一样物产采空或吃空(deplete);世界上第一次有州的某样能力到了某样发明那一档(invent,见 INVENTIONS)。
 *   年份按上一步到这一步线性估出跨过门槛的那一刻(不早于那州归了现在的民族、国家)。
 *
 * 结果是 Civ.development:物产的底子和发现年份、每 SNAP 年一份的各州能力和眼下能用的物产(加结束那年)、大事,
 * 还有接着推(CivSim.fromCiv)要用的全精度状态(state)。任意年份用 developmentAt、resourcesAt 查(前后两份线性插值)。
 * 每一步只读这一刻以前已经发生的事。只用加减乘除(IEEE 精确舍入)和推演里已经舍入过的人口,跨 CPU 逐位一致。
 * 随机数一律 keyed(subSeed(seed, 'civ-development'), 治所地块, …)。
 */
import type { Civ, DevEvent, DevState, Development, Settlement, Year } from './types';
import type { World } from '../world';
import { AdjKind, Layer } from './types';
import { Biome } from '../biomes';
import { MAJOR_RIVER } from './habitat';
import { GROWTH_A, capitalAt, populationAt, ruralCapacity } from './growth';
import { fexp, keyed, subSeed } from './rand';
import { Ev, type CivSim } from './sim';
import { grantSail, polityModelOf, type PolityModel } from './polities';
import { cultureModelOf } from './cultures';

/** 物产(下标就是 Development.resources 里的第几样) */
export const RESOURCES = ['粮', '牲畜', '铜锡', '铁', '煤', '木材', '盐', '渔获', '石油', '稀有矿', '金银'] as const;
export const enum Res {
  Grain = 0,
  Livestock = 1,
  Copper = 2,
  Iron = 3,
  Coal = 4,
  Timber = 5,
  Salt = 6,
  Fish = 7,
  Oil = 8,
  Rare = 9,
  Gold = 10,
}
export const RESOURCE_COUNT = 11;
/** 每样物产有的州占全部有人能住的州的比例 */
const RESOURCE_SHARE: readonly number[] = [0.7, 0.5, 0.22, 0.4, 0.2, 0.55, 0.3, 0.45, 0.15, 0.12, 0.12];
/** 生产能力到这么多时发现这样物产(粮、牲畜、木材、盐、渔获有人住就知道;矿都比要它的那道门槛早一截;金银不卡时代,石器时代后段就认得) */
const DISCOVER_AT: readonly number[] = [0, 0, 0.6, 1.5, 4.5, 0, 0, 0, 5.5, 6.5, 0.4];
/** 矿:一档储量全力开采能采几年 */
const LIFE: readonly number[] = [0, 0, 2500, 3000, 1200, 0, 0, 0, 400, 800, 800];
/** 林、渔、田、牧:吃空的快慢、每年长回缺口的几成 */
const DEPLETE: readonly number[] = [0.0015, 0.003, 0, 0, 0, 0.004, 0, 0.004, 0, 0, 0];
const REGROW = 0.003;
/** 眼下能用多少存成 0–3 档 × 这个数 */
export const AVAIL_SCALE = 80;

/** 五种能力(下标就是快照里每州的第几样) */
export const CAPS = ['生产', '运输', '信息', '行政', '动员'] as const;
export const enum Cap {
  Production = 0,
  Transport = 1,
  Information = 2,
  Administration = 3,
  Mobilization = 4,
}
export const CAP_COUNT = 5;

/** 时代(能力、时代数值的整数部分;最后一个没有上限) */
export const ERAS = ['石器', '青铜', '铁器', '中古', '火药', '工业', '电气', '信息', '未来'] as const;
/** 动力为 1 时,自己长过一个时代要几年(按所在的时代) */
const ERA_YEARS: readonly number[] = [1000, 800, 700, 750, 3000, 1600, 1300, 1500, 2000];
/** 能力的上限(未来时代以后不再往上记) */
const LEVEL_MAX = 9;
/** 快照里一档能力存成几(Uint8:LEVEL_MAX × LEVEL_SCALE ≤ 255) */
export const LEVEL_SCALE = 28;
/** 快照里算坏了(不是数)的能力存成这个 */
export const BAD_LEVEL = 255;

/** 每多少年算一步、多少年存一份快照 */
const STEP = 20;
const SNAP = 100;
/** 向邻居学:每年追上差距的比例(生产、运输、信息、行政) */
const LEARN: readonly number[] = [0.0015, 0.0012, 0.0025, 0.001];
/** 同一国里学得快几倍;行政跨国只剩几成 */
const SAME_STATE = 2;
const ADMIN_ABROAD = 0.3;
/** 邻接边的类型 → 学得多快(航线另加运输能力的几成) */
const LINK: readonly number[] = (() => {
  const t = [1, 1, 1, 1, 1];
  t[AdjKind.River] = 1.1;
  t[AdjKind.Mountain] = 0.35;
  t[AdjKind.Strait] = 0.6;
  t[AdjKind.SeaRoute] = 0.25;
  return t;
})();
const SEA_PER_TRANSPORT = 0.08;
/** 循环里要用的枚举值(另一个文件的 const enum,先取成本地常量) */
const SEA_ROUTE: number = AdjKind.SeaRoute;
/** 某样能力比时代领先 OVERSHOOT 以上时,自己长得只剩 OVERSHOOT_SLOW;领先 OVERSHOOT_LEARN 以上时,向邻居学也只剩这么多 */
const OVERSHOOT = 0.8;
const OVERSHOOT_LEARN = 2;
const OVERSHOOT_SLOW = 0.25;
/** 卡在物产门口:离下一时代还差这么多以内、又没有要的物产时,生产自己长得只剩 GATE_SLOW */
const GATE_NEAR = 0.3;
const GATE_SLOW = 0.15;
/** 跌下去以后每年按"到过的最高值 − 现在"的这个比例恢复 */
const RECOVER = 0.02;
/** 战乱:每步旧账留几成;每次扣多少(生产、运输、信息、行政) */
const WAR_KEEP = 0.8;
const HIT_CONQUER: readonly number[] = [0.08, 0.05, 0, 0.1];
const HIT_BATTLE: readonly number[] = [0.04, 0.02, 0, 0];
const HIT_SACK: readonly number[] = [0.12, 0.05, 0.08, 0.04];
const HIT_RUIN: readonly number[] = [0.2, 0.1, 0.15, 0.08];
/** 刚有人住的州:取邻居最高值的几成 */
const SETTLE_CARRY = 0.85;
/** 没人住了:每步剩几成 */
const ABANDON_KEEP = 0.98;
/** 国家有这么多州时,行政动力里「国家大」那一项到顶 */
const ADMIN_SIZE = 40;
/** 州的人口、城的人口到这么多(千人)时算一半(人口、城的规模 = 人口 ÷ (人口 + 这个数)) */
const POP_HALF = 300;
const CITY_HALF = 40;
/** 没有国家的地方行政最多长到几 */
const TRIBAL_ADMIN_MAX = 1.5;

/** 时代 = 生产、运输、信息、行政的调和平均(各加 1 再减 1,0 也能算;偏向短板) */
const ERA_WEIGHT: readonly number[] = [0.35, 0.2, 0.25, 0.2];

/** 州 r 的时代数值(整数部分 = 第几个时代,小数 = 走了几成);lv = R × CAP_COUNT 的能力 */
export function eraLevel(lv: ArrayLike<number>, r: number): number {
  const o = r * CAP_COUNT;
  let s = 0;
  for (let c = 0; c < 4; c++) s += ERA_WEIGHT[c] / (lv[o + c] + 1);
  return 1 / s - 1;
}

/** 时代数值 → 第几个时代和走了几成(0–1) */
export function eraOf(level: number): { era: number; progress: number } {
  const era = Math.max(0, Math.min(ERAS.length - 1, Math.floor(level)));
  return { era, progress: Math.max(0, Math.min(1, level - era)) };
}

/** 任意年份各州的五种能力(R × CAP_COUNT;前后两份快照线性插值)。out 可复用 */
export function developmentAt(dev: Development, year: Year, out?: Float32Array): Float32Array {
  return snapAt(dev.snaps, dev.snapYears, LEVEL_SCALE, year, out);
}

/** 任意年份各州物产眼下能用多少(R × RESOURCE_COUNT,0–3 档;前后两份快照线性插值;还没发现的是 0)。out 可复用 */
export function resourcesAt(dev: Development, year: Year, out?: Float32Array): Float32Array {
  out = snapAt(dev.avail, dev.snapYears, AVAIL_SCALE, year, out);
  // 插值会让快照之间刚发现的提前冒头:那一年还没发现的记 0
  for (let i = 0; i < out.length; i++) if (dev.found[i] > year) out[i] = 0;
  return out;
}

function snapAt(snaps: Uint8Array[], ys: Year[], scale: number, year: Year, out?: Float32Array): Float32Array {
  const len = snaps[0]?.length ?? 0;
  if (!out || out.length !== len) out = new Float32Array(len);
  if (!ys.length) return out;
  let lo = 0;
  let hi = ys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ys[mid] <= year) lo = mid + 1;
    else hi = mid;
  }
  const a = snaps[Math.max(0, lo - 1)];
  const b = snaps[Math.min(ys.length - 1, lo)];
  const t = lo <= 0 || lo >= ys.length ? 0 : (year - ys[lo - 1]) / (ys[lo] - ys[lo - 1]);
  for (let i = 0; i < len; i++) out[i] = (a[i] + (b[i] - a[i]) * t) / scale;
  return out;
}

// ---------------------------------------------------------------------------
// 反过来影响推演(第 2 步)

/** 城、乡村的人口上限 × (POP_BASE + POP_PER × 生产能力),POP_MAX 封顶;倍数取到 1/POP_QUANT(变了才记进 Settlement.devCap) */
const POP_BASE = 0.85;
const POP_PER = 0.1;
export const POP_MAX = 2;
const POP_QUANT = 32;
/** 军力系数 = 1 + MIL_PER × 国都所在州的动员能力,MIL_MAX 封顶 */
const MIL_PER = 0.12;
const MIL_MAX = 1.6;
/** 普通国家国都所在州的运输能力到这么多,从这一刻起能走远洋 */
const SAIL_LEVEL = 1.7;
/** 跨时代的门槛(见文件头):本州行政能力比要进的时代低这么多以内;近年战乱(war)不超过这么多算太平;平原 = 治所海拔低于这么多米 */
const ADMIN_GAP = 1.3;
const WAR_CALM = 0.5;
const PLAIN = 500;
/** 镇(千人;和 growth.ts 的 SETTLEMENT_RANKS 一致):在国家里、有长到镇的城算"有路";进火药以后要有 */
const TOWN = 8;

/** 州的生产能力 → 人口上限的倍数(取到 1/POP_QUANT) */
export function popFactor(production: number): number {
  const f = Math.min(POP_MAX, POP_BASE + POP_PER * Math.max(0, production));
  return Math.round(f * POP_QUANT) / POP_QUANT;
}

/**
 * 发明:哪样能力(Cap)到了哪一档(和时代同一把尺子),世上第一次到的那一州记一条 invent。
 * major = 编年史里算大事(见 developmentText.ts)。和时代同名的(青铜、铁器、火药……)不另列
 */
export const INVENTIONS: readonly { name: string; cap: number; level: number; major?: boolean }[] = [
  { name: '陶轮', cap: 0, level: 0.5 },
  { name: '车轮', cap: 1, level: 0.6 },
  { name: '文字', cap: 2, level: 0.7, major: true },
  { name: '战车', cap: 4, level: 0.9 },
  { name: '成文法', cap: 3, level: 1 },
  { name: '帆船', cap: 1, level: 1.2 },
  { name: '犁耕', cap: 0, level: 1.5 },
  { name: '字母', cap: 2, level: 1.6 },
  { name: '户籍', cap: 3, level: 1.8 },
  { name: '驿道', cap: 1, level: 2 },
  { name: '马镫', cap: 4, level: 2.2, major: true },
  { name: '造纸', cap: 2, level: 2.5, major: true },
  { name: '水车', cap: 0, level: 2.6 },
  { name: '文官考选', cap: 3, level: 2.8 },
  { name: '指南针', cap: 1, level: 3, major: true },
  { name: '常备军', cap: 4, level: 3 },
  { name: '高炉', cap: 0, level: 3.4 },
  { name: '印刷术', cap: 2, level: 3.4, major: true },
  { name: '远洋帆船', cap: 1, level: 3.7 },
  { name: '火器', cap: 4, level: 4.1 },
  { name: '人口普查', cap: 3, level: 4.5 },
  { name: '报刊', cap: 2, level: 4.6 },
  { name: '机械织机', cap: 0, level: 4.6 },
  { name: '征兵制', cap: 4, level: 5 },
  { name: '蒸汽机', cap: 0, level: 5.2, major: true },
  { name: '铁路', cap: 1, level: 5.4 },
  { name: '电报', cap: 2, level: 5.6, major: true },
  { name: '电力', cap: 0, level: 6.2 },
  { name: '汽车', cap: 1, level: 6.3 },
  { name: '无线电', cap: 2, level: 6.5 },
  { name: '飞机', cap: 1, level: 6.9 },
  { name: '计算机', cap: 2, level: 7.3, major: true },
];

// ---------------------------------------------------------------------------
// 推演里的模型

/** 状态各数组里每州的标记(DevModel.flags):有人住过 / 住过人后来空了 */
const SETTLED = 1;
const LEFT = 2;

interface DevModel {
  seed: number;
  pm: PolityModel;
  /** 州数(地形大事以后按新的州表补齐) */
  R: number;
  /** 物产的底子(州 × RESOURCE_COUNT) */
  resources: Uint8Array;
  /** 物产哪一年发现(州 × RESOURCE_COUNT;没发现 = Infinity) */
  found: Float64Array;
  /** 上一步算到哪一年;史事读到第几条 */
  last: Year;
  annals: number;
  /** 各州五种能力(州 × CAP_COUNT)、到过的最高值 */
  cur: Float64Array;
  best: Float64Array;
  /** 各州近年的战乱(每步旧账留 WAR_KEEP,每件 +1) */
  war: Float64Array;
  /** 各州上一步的时代数值 */
  era: Float64Array;
  flags: Uint8Array;
  /** 各州人口、城的规模(0–1)、有没有路(在国家里、有长到镇的城);每 SNAP 年更新 */
  pop: Float64Array;
  city: Float64Array;
  road: Uint8Array;
  /** 矿还剩多少年的量,林、渔、田、牧还剩几成;眼下能用多少(0–3 档);采空的大事记过没有 */
  stock: Float64Array;
  availNow: Float64Array;
  depleted: Uint8Array;
  /** 这样物产从哪一刻起有(地形大事以后才有的 = 那一刻;发现不早于它;一直有的 = −Infinity) */
  resFrom: Float64Array;
  /** 各国到过的时代(−1 = 还没看过;立国时已在的不记大事) */
  polityEra: number[];
  worldEra: number;
  /** 各样发明出现过没有 */
  invented: Uint8Array;
  /** 各州归了现在的民族、国家是哪一刻(归属监听里记) */
  sinceC: Float64Array;
  sinceP: Float64Array;
  /** 各州第一座城(乡村人口跟它一起长);已经看到第几座城了 */
  firstCity: Int32Array;
  seenCities: number;
  /** 各州城的人口上限此刻的倍数(PolityModel.capFactor,同一份) */
  capF: Float64Array;
  events: DevEvent[];
  snaps: Uint8Array[];
  avail: Uint8Array[];
  snapYears: Year[];
}

const models = new WeakMap<CivSim, DevModel>();

/** 推演引擎上挂着的发展度模型(测试、统计用) */
export function devModelOf(sim: CivSim): DevModel | undefined {
  return models.get(sim);
}

/** 新的模型(全是初始状态;推演开头,或接着推时 Civ 里没存状态) */
function emptyDev(world: World, pm: PolityModel, seed: number, habitat: Civ['habitat']): DevModel {
  const R = pm.terrain.R;
  const resources = computeResources(world, { regions: pm.terrain.regions, habitat }, seed);
  const RK = R * RESOURCE_COUNT;
  const stock = new Float64Array(RK);
  for (let i = 0; i < RK; i++) {
    const k = i % RESOURCE_COUNT;
    stock[i] = LIFE[k] ? resources[i] * LIFE[k] : 1;
  }
  return {
    seed,
    pm,
    R,
    resources,
    found: new Float64Array(RK).fill(Infinity),
    last: -Infinity,
    annals: 0,
    cur: new Float64Array(R * CAP_COUNT),
    best: new Float64Array(R * CAP_COUNT),
    war: new Float64Array(R),
    era: new Float64Array(R),
    flags: new Uint8Array(R),
    pop: new Float64Array(R),
    city: new Float64Array(R),
    road: new Uint8Array(R),
    stock,
    availNow: new Float64Array(RK),
    depleted: new Uint8Array(RK),
    resFrom: new Float64Array(RK).fill(-Infinity),
    polityEra: [],
    worldEra: 0,
    invented: new Uint8Array(INVENTIONS.length),
    sinceC: new Float64Array(R),
    sinceP: new Float64Array(R),
    firstCity: new Int32Array(R).fill(-1),
    seenCities: 0,
    capF: new Float64Array(R).fill(popFactor(0)),
    events: [],
    snaps: [],
    avail: [],
    snapYears: [],
  };
}

/** 登记发展度(generateCiv 里,各层 install 之后):第 0 年起每 STEP 年算一步 */
export function installDevelopment(sim: CivSim, world: World, pm: PolityModel, habitat: Civ['habitat'], seed: number): void {
  const d = emptyDev(world, pm, subSeed(seed, 'civ-development'), habitat);
  hook(sim, d);
  sim.schedule(0, Ev.DevTick, 0, 0);
}

/**
 * 接着推(CivSim.fromCiv 调用,在各层 resume 之后):从 Civ.development.state 接上(地形大事以后州多了的补齐、物产按新地形重新分档);
 * 没存状态的(旧版本的历史)从头开始的状态接着算
 */
export function resumeDevelopment(sim: CivSim, world: World, civ: Civ): void {
  const pm = polityModelOf(sim);
  if (!pm) return;
  const d = emptyDev(world, pm, subSeed(civ.seed, 'civ-development'), civ.habitat);
  const dev = civ.development;
  const st = dev?.state;
  const R = d.R;
  if (dev && st) {
    const R0 = Math.min(R, st.era.length);
    const copy = <T extends Float64Array | Uint8Array>(to: T, from: T, per: number) => to.set(from.subarray(0, R0 * per));
    copy(d.cur, st.cur, CAP_COUNT);
    copy(d.best, st.best, CAP_COUNT);
    copy(d.war, st.war, 1);
    copy(d.era, st.era, 1);
    copy(d.flags, st.flags, 1);
    copy(d.pop, st.pop, 1);
    copy(d.city, st.city, 1);
    copy(d.road, st.road, 1);
    copy(d.availNow, st.availNow, RESOURCE_COUNT);
    copy(d.depleted, st.depleted, RESOURCE_COUNT);
    if (st.resFrom) copy(d.resFrom, st.resFrom, RESOURCE_COUNT);
    copy(d.found, dev.found, RESOURCE_COUNT);
    // 储量:物产按这一段的地形重新分档了的,按新旧档位之比缩放(没变的原样接上)
    const old = dev.resources;
    for (let i = 0; i < R0 * RESOURCE_COUNT; i++) {
      const k = i % RESOURCE_COUNT;
      const a = old[i];
      const b = d.resources[i];
      if (!LIFE[k]) d.stock[i] = a ? st.stock[i] : 1;
      else if (a === b) d.stock[i] = st.stock[i];
      else if (a && b) d.stock[i] = (st.stock[i] * b) / a;
      // 这一段的地形里没有了(沉了、重新分档掉到没有):眼下能用的清零,发现的年份留着(拖回以前还看得到)
      if (!b) d.availNow[i] = 0;
      // 这一段才有的:发现不早于这一刻
      else if (!a) d.resFrom[i] = sim.now;
    }
    for (let i = R0 * RESOURCE_COUNT; i < d.resFrom.length; i++) d.resFrom[i] = sim.now;
    d.last = st.last;
    d.annals = st.annals;
    d.polityEra = st.polityEra.slice();
    d.worldEra = st.worldEra;
    d.invented.set(st.invented.subarray(0, d.invented.length));
    d.events = dev.events.map((e) => ({ ...e }));
    const keep = dev.snapYears.length - (st.tail ? 1 : 0);
    d.snaps = dev.snaps.slice(0, keep).map((x) => padTo(x, R * CAP_COUNT));
    d.avail = dev.avail.slice(0, keep).map((x) => padTo(x, R * RESOURCE_COUNT));
    d.snapYears = dev.snapYears.slice(0, keep);
    pm.military = st.military.slice();
  } else {
    // 没存状态:从下一个整 STEP 年起算,史事从现在起读
    d.last = Math.floor(sim.now / STEP) * STEP;
    d.annals = civ.annals.length;
  }
  // 归属的年份、各州第一座城:按日志、城表重建(和推演里监听记的一样)
  const log = civ.log;
  for (let i = 0; i < log.size; i++) {
    const r = log.region[i];
    if (r >= R) continue;
    if (log.layer[i] === Layer.Culture) d.sinceC[r] = log.year[i];
    else d.sinceP[r] = log.year[i];
  }
  seeCities(d);
  // 城的人口上限倍数:和上一步算完时一样(只看生产能力)
  if (st) for (let r = 0; r < R; r++) d.capF[r] = popFactor(d.cur[r * CAP_COUNT + Cap.Production]);
  hook(sim, d);
  sim.schedule(d.last + STEP, Ev.DevTick, 0, 0);
}

function padTo(a: Uint8Array, n: number): Uint8Array {
  if (a.length >= n) return a.slice();
  const b = new Uint8Array(n);
  b.set(a);
  return b;
}

/** 挂到推演引擎上:归属监听、事件处理;城的人口上限倍数交给国家模型(新建的城从它记起) */
function hook(sim: CivSim, d: DevModel): void {
  models.set(sim, d);
  d.pm.capFactor = d.capF;
  d.pm.military ??= [];
  sim.onChange(Layer.Culture, (r) => {
    if (r < d.R) d.sinceC[r] = sim.now;
  });
  sim.onChange(Layer.Polity, (r) => {
    if (r < d.R) d.sinceP[r] = sim.now;
  });
  sim.on(Ev.DevTick, (_a, _b, t) => {
    tick(sim, d, t);
    sim.schedule(t + STEP, Ev.DevTick, 0, 0);
  });
}

/** 新建的城:各州第一座城(编号即建城先后) */
function seeCities(d: DevModel) {
  const S = d.pm.settlements;
  for (; d.seenCities < S.length; d.seenCities++) {
    const s = S[d.seenCities];
    if (s.region < d.R && d.firstCity[s.region] < 0) d.firstCity[s.region] = s.id;
  }
}

/** 州 r 此刻的城(还在的那一座;没有 = undefined) */
function cityIn(pm: PolityModel, r: number): Settlement | undefined {
  const c = pm.cityOf[r];
  if (c < 0) return undefined;
  const s = pm.settlements[c];
  return s.ended === undefined ? s : undefined;
}

/** 每 SNAP 年:各州人口、城的规模、有没有路 */
function refreshRoads(d: DevModel, y: Year, sim: CivSim) {
  const pm = d.pm;
  const S = pm.settlements;
  const reg = pm.terrain.regions;
  const ownC = sim.owners[Layer.Culture];
  const ownP = sim.owners[Layer.Polity];
  for (let r = 0; r < d.R; r++) {
    if (ownC[r] < 0) continue;
    const s = cityIn(pm, r);
    const cityPop = s ? populationAt(s, y) : 0;
    // 乡村:和第一座城一起按 S 形曲线长(不算洗劫;只拿来定动力)
    const f = d.firstCity[r];
    const first = f >= 0 ? S[f] : undefined;
    const rural = first && y >= first.founded ? (ruralCapacity(reg, r) * d.capF[r]) / (1 + GROWTH_A * fexp(-first.growth * (y - first.founded))) : 0;
    const pop = cityPop + rural;
    d.pop[r] = pop / (pop + POP_HALF);
    d.city[r] = cityPop / (cityPop + CITY_HALF);
    d.road[r] = ownP[r] >= 0 && cityPop >= TOWN ? 1 : 0;
  }
}

/** 某年的国号档位(0 部 … 3 帝国;没升过格 = 0) */
function tierNow(titles: { year: Year; tier: number }[] | undefined): number {
  return titles?.length ? Math.max(0, titles[titles.length - 1].tier) : 0;
}

/** 算一步(第 y 年;见文件头) */
function tick(sim: CivSim, d: DevModel, y: Year): void {
  const pm = d.pm;
  const T = pm.terrain;
  const reg = T.regions;
  const R = d.R;
  const P = pm.polities.length;
  const S = pm.settlements;
  const cultures = cultureModelOf(sim)?.cultures ?? pm.cultures;
  const ownC = sim.owners[Layer.Culture];
  const ownP = sim.owners[Layer.Polity];
  const dt = d.last > -Infinity ? y - d.last : 0;
  const { cur, best, war, flags, availNow, resources, found, stock } = d;
  const E = d.era;
  const Eprev = E.slice();
  const prev = cur.slice();
  const next = cur.slice();
  seeCities(d);
  if (y % SNAP === 0) refreshRoads(d, y, sim);

  // 各州眼下有哪些物产(按位);各国:有哪些物产、国都所在的州
  const RK = R * RESOURCE_COUNT;
  const resBits = new Int32Array(R);
  for (let i = 0; i < RK; i++) if (availNow[i] > 0) resBits[(i / RESOURCE_COUNT) | 0] |= 1 << i % RESOURCE_COUNT;
  const has = new Int32Array(P);
  const capR = new Int32Array(P).fill(-1);
  for (let r = 0; r < R; r++) if (ownP[r] >= 0) has[ownP[r]] |= resBits[r];
  for (let p = 0; p < P; p++) {
    const q = pm.polities[p];
    if (q.ended !== undefined || !pm.size[p]) continue;
    const cap = S[capitalAt(q, Infinity)];
    if (cap && cap.region < R && ownP[cap.region] === p) capR[p] = cap.region;
  }
  const { adjStart, adj, adjKind } = reg;
  const drive = new Float64Array(4);
  const learn = new Float64Array(4);
  const needBits = (lvP: number): number => {
    const target = Math.floor(lvP) + 1;
    return target === 1 ? 1 << Res.Copper : target === 2 ? 1 << Res.Iron : target === 5 ? (1 << Res.Coal) | (1 << Res.Iron) : target === 6 ? 1 << Res.Oil : target === 7 ? 1 << Res.Rare : 0;
  };

  if (dt > 0) {
    for (let r = 0; r < R; r++) {
      const o = r * CAP_COUNT;
      if (ownC[r] < 0) {
        if (flags[r] & SETTLED) {
          flags[r] |= LEFT;
          for (let c = 0; c < CAP_COUNT; c++) next[o + c] = cur[o + c] * ABANDON_KEEP;
        }
        continue;
      }
      const p = ownP[r];
      if (!(flags[r] & SETTLED) || flags[r] & LEFT) {
        // 刚有人住(或空了以后又有人来):带着邻居的本事来,和本州留下的取高的
        flags[r] = SETTLED;
        for (let k = adjStart[r]; k < adjStart[r + 1]; k++) {
          const n = adj[k];
          if (n >= R || ownC[n] < 0) continue;
          for (let c = 0; c < CAP_COUNT; c++) next[o + c] = Math.max(next[o + c], cur[n * CAP_COUNT + c] * SETTLE_CARRY);
        }
        continue;
      }
      const popF = d.pop[r];
      const cityF = d.city[r];
      const ro = r * RESOURCE_COUNT;
      const polity = p >= 0 ? pm.polities[p] : undefined;
      const isCap = p >= 0 && capR[p] === r;
      const port = pm.port[r];
      const river = T.riverSeat[r] | T.river[r];
      // 和几个外邦(别国、部落地带)相邻;本国 / 本州附近能不能买到物产
      let foreign = 0;
      let near = resBits[r] | (p >= 0 ? has[p] : 0);
      for (let k = adjStart[r]; k < adjStart[r + 1]; k++) {
        const n = adj[k];
        if (n >= R || ownC[n] < 0) continue;
        near |= resBits[n];
        if (ownP[n] !== p && foreign < 4) foreign++;
      }
      const peace = 1 / (1 + war[r]);
      const road = d.road[r];
      drive[0] = 0.15 + 0.1 * availNow[ro + Res.Grain] + 1.2 * popF;
      drive[1] = 0.1 + 0.3 * road + 0.2 * river + 0.3 * port + 0.05 * availNow[ro + Res.Timber] + 0.6 * popF;
      drive[2] = 0.1 + 1.2 * cityF + (isCap ? 0.3 : 0) + 0.08 * foreign + 0.2 * road;
      drive[3] = !polity ? 0.15 : 0.3 + 0.15 * tierNow(polity.titles) + 0.2 * Math.min(1, pm.size[p] / ADMIN_SIZE) + (isCap ? 0.4 : 0) + 0.3 * Math.min(1, (y - polity.founded) / 400);
      // 向每样能力最高的邻居学(一遍邻居,四样一起看)
      learn.fill(0);
      for (let k = adjStart[r]; k < adjStart[r + 1]; k++) {
        const n = adj[k];
        if (n >= R || ownC[n] < 0) continue;
        const kind = adjKind[k];
        let link = LINK[kind] ?? 1;
        if (kind === SEA_ROUTE) link += SEA_PER_TRANSPORT * cur[o + Cap.Transport];
        const same = p >= 0 && ownP[n] === p;
        if (same) link *= SAME_STATE;
        const no = n * CAP_COUNT;
        for (let c = 0; c < 4; c++) {
          const gap = cur[no + c] - cur[o + c];
          if (gap <= 0) continue;
          const g = gap * LEARN[c] * (c === Cap.Administration && !same ? link * ADMIN_ABROAD : link);
          if (g > learn[c]) learn[c] = g;
        }
      }
      // 跨时代的门槛(组织、太平和城、地理;见文件头):到下一个时代门口时查
      const tier = polity ? tierNow(polity.titles) : -1;
      const flat = reg.elevation[r] < PLAIN;
      const gateOK = (target: number): boolean => {
        if (target >= 2 && !polity) return false;
        if (target >= 3 && (tier < 1 || cur[o + Cap.Administration] < target - ADMIN_GAP)) return false;
        if (target >= 4 && (war[r] > WAR_CALM || !road)) return false;
        if (target >= 5 && !(port || river || flat)) return false;
        return true;
      };
      const e = E[r];
      for (let c = 0; c < 4; c++) {
        const v = cur[o + c];
        const lvl = Math.min(ERA_YEARS.length - 1, Math.floor(v));
        let grow = (drive[c] * peace) / ERA_YEARS[lvl];
        let got = learn[c];
        if (v > e + OVERSHOOT) grow *= OVERSHOOT_SLOW;
        if (v > e + OVERSHOOT_LEARN) got *= OVERSHOOT_SLOW;
        if (v > Math.floor(v) + 1 - GATE_NEAR) {
          const need = c === Cap.Production ? needBits(v) : 0;
          if ((need && (near & need) !== need) || !gateOK(Math.floor(v) + 1)) grow *= GATE_SLOW;
        }
        const recover = (best[o + c] - v) * RECOVER;
        let nv = v + dt * (grow + got + (recover > 0 ? recover : 0));
        if (c === Cap.Administration && !polity && nv > TRIBAL_ADMIN_MAX) nv = Math.max(v, TRIBAL_ADMIN_MAX);
        next[o + c] = Math.min(LEVEL_MAX, nv);
      }
      // 动员:跟着生产和行政走
      const nomad = cultures[ownC[r]]?.kind === 'nomad';
      const target = 0.5 * (next[o + Cap.Production] + next[o + Cap.Administration]) + (nomad ? 0.7 : 0) + (polity ? 0.15 : 0);
      const m = cur[o + Cap.Mobilization];
      next[o + Cap.Mobilization] = Math.min(LEVEL_MAX, m + (target - m) * Math.min(1, 0.01 * dt));
    }
  }
  // 战乱折损:上一步到这一步的史事(攻占、战役、洗劫、毁城)
  for (let r = 0; r < R; r++) war[r] *= WAR_KEEP;
  for (; d.annals < sim.annalCount; d.annals++) {
    const a = sim.annal(d.annals);
    const hit = a.kind === 'conquer' ? HIT_CONQUER : a.kind === 'battle' ? HIT_BATTLE : a.kind === 'sack' ? HIT_SACK : a.kind === 'ruin' ? HIT_RUIN : null;
    if (!hit || !(a.region >= 0 && a.region < R)) continue;
    const o = a.region * CAP_COUNT;
    war[a.region] += 1;
    for (let c = 0; c < 4; c++) next[o + c] = Math.max(0, next[o + c] - hit[c]);
  }
  cur.set(next);
  for (let i = 0; i < cur.length; i++) if (cur[i] > best[i]) best[i] = cur[i];
  for (let r = 0; r < R; r++) E[r] = ownC[r] >= 0 ? eraLevel(cur, r) : 0;
  const t0 = d.last > -Infinity ? d.last : y;
  /** a → b 在这一步里哪一刻过了 k(按上一步到这一步线性估;不早于 since) */
  const crossAt = (a: number, b: number, k: number, since: number): Year => {
    const t = b > a ? Math.min(1, Math.max(0, (k - a) / (b - a))) : 1;
    return Math.min(y, Math.max(since, t0 + (y - t0) * t));
  };
  const sinceOf = (r: number) => Math.max(d.sinceC[r], d.sinceP[r]);
  const cityId = (r: number) => cityIn(pm, r)?.id ?? -1;
  const push = (e: Omit<DevEvent, 'era' | 'culture' | 'polity' | 'settlement'> & { era?: number }) => {
    const r = e.region;
    d.events.push({ era: eraOf(E[r]).era, ...e, culture: ownC[r], polity: ownP[r], settlement: cityId(r) });
  };

  /** 这一步里 a → b 过了 k 的州中,估出的那一刻最早的(同一刻取到得高的);没有 = -1 */
  const firstCross = (va: ArrayLike<number>, vb: ArrayLike<number>, per: number, off: number, k: number): { r: number; t: Year } => {
    let at = -1;
    let tAt = Infinity;
    for (let r = 0; r < R; r++) {
      const o = r * per + off;
      if (ownC[r] < 0 || !(vb[o] >= k)) continue;
      const t = crossAt(va[o], vb[o], k, sinceOf(r));
      if (t < tAt || (t === tAt && vb[o] > vb[at * per + off])) (tAt = t), (at = r);
    }
    return { r: at, t: tAt };
  };

  // 大事:世界第一次进入某个时代(同一步里有几州都进了,记估出的那一刻最早的);各国国都所在的州第一次进入某个时代
  let topLv = 0;
  for (let r = 0; r < R; r++) if (ownC[r] >= 0 && E[r] > topLv) topLv = E[r];
  const topEra = eraOf(topLv).era;
  for (let k = d.worldEra + 1; k <= topEra; k++) {
    const f = firstCross(Eprev, E, 1, 0, k);
    if (f.r >= 0) push({ year: f.t, kind: 'first', era: k, region: f.r });
  }
  if (topEra > d.worldEra) d.worldEra = topEra;
  for (let p = 0; p < P; p++) {
    const r = capR[p];
    if (r < 0) continue;
    const e = eraOf(E[r]).era;
    const seen = d.polityEra[p] ?? -1;
    if (seen < 0) d.polityEra[p] = e;
    else if (e > seen) {
      // 一步跨了几个时代(例如迁都到先进得多的州)就每个都记;不早于迁到这个国都
      const caps = pm.polities[p].capitals;
      let moved = -Infinity;
      if (caps) for (const c of caps) if (c.year <= y) moved = c.year;
      for (let k = seen + 1; k <= e; k++) push({ year: crossAt(Eprev[r], E[r], k, Math.max(sinceOf(r), moved)), kind: 'enter', era: k, region: r });
      d.polityEra[p] = e;
    }
  }
  // 发明:世上第一次有州的那样能力到了那一档(同一步里有几州都到了,记估出的那一刻最早的)
  INVENTIONS.forEach((inv, i) => {
    if (d.invented[i]) return;
    const f = firstCross(prev, cur, CAP_COUNT, inv.cap, inv.level);
    if (f.r < 0) return;
    d.invented[i] = 1;
    push({ year: f.t, kind: 'invent', invention: i, region: f.r });
  });

  // 物产:发现、开采、吃空、长回来
  for (let r = 0; r < R; r++) {
    const ro = r * RESOURCE_COUNT;
    const live = ownC[r] >= 0;
    const Pr = cur[r * CAP_COUNT + Cap.Production];
    const Pa = prev[r * CAP_COUNT + Cap.Production];
    const popF = live ? d.pop[r] : 0;
    const since = Math.max(d.sinceC[r], d.sinceP[r]);
    for (let k = 0; k < RESOURCE_COUNT; k++) {
      const i = ro + k;
      const tier = resources[i];
      if (!tier) continue;
      if (found[i] === Infinity) {
        if (!live || Pr < DISCOVER_AT[k]) continue;
        // 这一步里哪一刻过了门槛(不早于这州归了现在的民族和国家)
        found[i] = crossAt(Pa, Pr, DISCOVER_AT[k], Math.max(since, d.resFrom[i]));
        if (tier === 3 && LIFE[k]) push({ year: found[i], kind: 'discover', region: r, resource: k });
      }
      const vPrev = availNow[i];
      let v: number;
      if (LIFE[k]) {
        // 矿:技术越高采得越多(发现后一个半时代采到足量);一直采会采空,剩最后三成时越采越少
        const tech = Math.min(1, 0.25 + 0.5 * Math.max(0, Pr - DISCOVER_AT[k]));
        // 只扣发现以后、有人住以后的那几年
        const span = Math.max(0, Math.min(dt, y - Math.max(found[i], d.sinceC[r])));
        if (live) stock[i] = Math.max(0, stock[i] - span * tech * (0.4 + 0.6 * popF));
        v = tier * tech * Math.min(1, stock[i] / (0.3 * tier * LIFE[k]));
      } else if (DEPLETE[k]) {
        // 林、渔、田、牧:人多、开发久就吃空,人少了慢慢长回来;捕鱼到火药以后才吃得空
        const e = E[r];
        const press =
          k === Res.Timber ? Math.max(0, popF - 0.35) * (1 + 0.3 * Math.max(0, e - 3))
          : k === Res.Fish ? Math.max(0, popF - 0.3) * Math.max(0, e - 3.5)
          : k === Res.Grain ? Math.max(0, popF - 0.7)
          : Math.max(0, popF - 0.55);
        const h = stock[i];
        stock[i] = Math.min(1, Math.max(0.05, h + dt * (REGROW * (1 - h) - DEPLETE[k] * press * h)));
        v = tier * stock[i];
      } else v = tier;
      availNow[i] = v;
      const low = (LIFE[k] ? 0.2 : 0.4) * tier;
      if (tier === 3 && !d.depleted[i] && v < low && (!LIFE[k] || stock[i] < 0.3 * tier * LIFE[k])) {
        d.depleted[i] = 1;
        // 这一步里哪一刻掉过线(按能用量线性估;不早于发现、不早于这州归了现在的民族和国家)
        const t = vPrev > low && vPrev > v ? (vPrev - low) / (vPrev - v) : 1;
        push({ year: Math.min(y, Math.max(found[i], since, t0 + (y - t0) * t)), kind: 'deplete', region: r, resource: k });
      }
    }
  }

  // 反过来影响推演:城的人口上限倍数(变了才记)、各国的军力系数、远洋
  for (let r = 0; r < R; r++) {
    const f = popFactor(cur[r * CAP_COUNT + Cap.Production]);
    d.capF[r] = f;
    const s = cityIn(pm, r);
    if (!s) continue;
    const dc = (s.devCap ??= [s.founded, f]);
    if (dc[dc.length - 1] !== f) dc.push(y, f);
  }
  const mil = pm.military!;
  for (let p = 0; p < P; p++) {
    const r = capR[p];
    if (r < 0) continue;
    const o = r * CAP_COUNT;
    mil[p] = Math.min(MIL_MAX, 1 + MIL_PER * cur[o + Cap.Mobilization]);
    if (cur[o + Cap.Transport] >= SAIL_LEVEL) grantSail(sim, pm, p);
  }

  d.last = y;
  if (y % SNAP === 0) {
    const s = makeSnap(d);
    d.snaps.push(s.snap);
    d.avail.push(s.avail);
    d.snapYears.push(y);
  }
}

/** 此刻的一份快照(能力、眼下能用的物产) */
function makeSnap(d: DevModel): { snap: Uint8Array; avail: Uint8Array } {
  const RK = d.R * RESOURCE_COUNT;
  const av = new Uint8Array(RK);
  for (let i = 0; i < RK; i++) av[i] = d.availNow[i] >= 0 ? Math.min(3 * AVAIL_SCALE, Math.round(d.availNow[i] * AVAIL_SCALE)) : BAD_LEVEL;
  const snap = new Uint8Array(d.R * CAP_COUNT);
  // 算坏了(NaN)存成 BAD_LEVEL,压力测试查得出来;正常最多 LEVEL_MAX × LEVEL_SCALE
  for (let i = 0; i < snap.length; i++) snap[i] = d.cur[i] >= 0 ? Math.min(LEVEL_MAX * LEVEL_SCALE, Math.round(d.cur[i] * LEVEL_SCALE)) : BAD_LEVEL;
  return { snap, avail: av };
}

/**
 * 推演结束(或推到一半拼 Civ 时):整理成 Civ.development。结束那年不在整百年上的,补一份那一刻的快照(按最近一步的状态;接着推时去掉)。
 * 返回的数组都是副本,之后接着推不影响它
 */
export function finishDevelopment(sim: CivSim, endYear: Year): Development | undefined {
  const d = models.get(sim);
  if (!d) return undefined;
  const snaps = d.snaps.slice();
  const avail = d.avail.slice();
  const snapYears = d.snapYears.slice();
  const tail = !snapYears.length || snapYears[snapYears.length - 1] < endYear;
  if (tail) {
    const s = makeSnap(d);
    snaps.push(s.snap);
    avail.push(s.avail);
    snapYears.push(endYear);
  }
  const events = d.events.map((e) => ({ ...e }));
  // 同一步里的几件按估出来的那一刻排(排序是稳定的)
  events.sort((a, b) => a.year - b.year);
  const state: DevState = {
    last: d.last,
    annals: d.annals,
    tail,
    cur: d.cur.slice(),
    best: d.best.slice(),
    war: d.war.slice(),
    era: d.era.slice(),
    flags: d.flags.slice(),
    pop: d.pop.slice(),
    city: d.city.slice(),
    road: d.road.slice(),
    stock: d.stock.slice(),
    availNow: d.availNow.slice(),
    depleted: d.depleted.slice(),
    resFrom: d.resFrom.slice(),
    polityEra: d.polityEra.slice(),
    worldEra: d.worldEra,
    invented: d.invented.slice(),
    military: (d.pm.military ?? []).slice(),
  };
  return { resources: d.resources.slice(), found: d.found.slice(), avail, snaps, snapYears, events, state };
}

/**
 * 各州的物产(R × RESOURCE_COUNT,0–3 档):先按地块算"有多少"的分、州里取平均,再按全世界排名分档(见文件头)。
 * 按最后一段的地形和州算(地形大事以前也用它)
 */
export function computeResources(world: World, civ: Pick<Civ, 'regions' | 'habitat'>, seed: number): Uint8Array {
  const { regions, habitat } = civ;
  const R = regions.count;
  const { cellStart, cells } = regions;
  const { biome, elevation, temperature, precipitation, flux, riverThreshold, tect, water } = world;
  const { adjStart: mStart, adj: mAdj } = world.mesh;
  const score = Array.from({ length: RESOURCE_COUNT }, () => new Float64Array(R));
  const livable = new Uint8Array(R);
  const major = MAJOR_RIVER * riverThreshold;
  for (let r = 0; r < R; r++) {
    const a = cellStart[r];
    const b = cellStart[r + 1];
    if (b <= a) continue;
    let grain = 0;
    let stock = 0;
    let ore = 0;
    let hills = 0;
    let bog = 0;
    let basin = 0;
    let wood = 0;
    let salt = 0;
    let fish = 0;
    let oil = 0;
    let rare = 0;
    let gold = 0;
    let suit = 0;
    for (let k = a; k < b; k++) {
      const i = cells[k];
      const bi = biome[i];
      const s = habitat.suitability[i];
      suit += s;
      const h = elevation[i];
      // 粮:能种地的群落上的宜居分(草原、荒漠不靠河种不了多少)
      grain += s * FARM[bi];
      stock += GRAZE[bi];
      // 铜锡:板块碰撞带、高山
      const conv = tect.convergence[i];
      ore += (conv > 0 ? Math.min(1, conv) : 0) + (h > 1500 ? 0.6 : h > 800 ? 0.3 : 0);
      // 铁:丘陵山地常见,沼泽、针叶林里的沼铁也算
      hills += h > 400 ? Math.min(1, (h - 400) / 1200) : 0;
      bog += bi === Biome.Wetland || bi === Biome.Taiga ? 0.5 : 0;
      // 煤:古老的低地盆地(森林、温带,海拔不高)
      basin += h < 1000 && (bi === Biome.TemperateForest || bi === Biome.Taiga || bi === Biome.TemperateRainforest || bi === Biome.Wetland || bi === Biome.Steppe) ? 1 : 0;
      wood += WOOD[bi];
      // 盐:暖而干的海岸(晒盐)、荒漠盆地(盐湖)
      const coast = habitat.coastDist[i] === 1;
      if (coast && temperature[i] > 14 && precipitation[i] < 1000) salt += 1;
      if (bi === Biome.HotDesert || bi === Biome.TemperateDesert || bi === Biome.ColdDesert) salt += h < 1500 ? 0.6 : 0.2;
      // 石油:低地的沉积盆地(荒漠、沼泽、草原、海边)
      if (h < 600) oil += OIL[bi] + (coast ? 0.4 : 0);
      // 稀有矿:板块剧烈碰撞带(火山弧)、张裂带
      rare += conv > 0.3 ? Math.min(1, conv) : conv < -0.3 ? 0.7 * Math.min(1, -conv) : 0;
      // 金银:碰撞带、高山里的矿脉,加上山区大河里淘得到的沙金
      gold += (conv > 0.2 ? Math.min(1, conv) : 0) + (h > 1200 ? 0.4 : 0) + (h > 300 && flux[i] >= major ? 0.5 : 0);
      // 渔获:海岸(冷水更多)、湖岸、大河
      if (coast) fish += temperature[i] < 12 ? 1.4 : 1;
      if (flux[i] >= major) fish += 0.5;
      for (let j = mStart[i]; j < mStart[i + 1]; j++) {
        if (water[mAdj[j]] === 2) {
          fish += 0.6;
          break;
        }
      }
    }
    const m = b - a;
    if (suit > 0) livable[r] = 1;
    const at = regions.seat[r];
    const key = regions.keySeat?.[r] ?? at;
    // 矿和煤:同一片山里也有贫有富
    const luck = (k: number) => 0.4 + 1.2 * keyed(seed, key, k);
    score[Res.Grain][r] = grain / m;
    score[Res.Livestock][r] = stock / m;
    score[Res.Copper][r] = (ore / m) * luck(Res.Copper);
    score[Res.Iron][r] = (hills / m + bog / m + 0.15) * luck(Res.Iron);
    score[Res.Coal][r] = (basin / m) * luck(Res.Coal) * (0.3 + keyed(seed, key, 100));
    score[Res.Timber][r] = wood / m;
    score[Res.Salt][r] = (salt / m) * luck(Res.Salt);
    score[Res.Fish][r] = fish / m;
    // 油田、稀有矿比煤还更成片:一大半地方即使地形对也没有
    score[Res.Oil][r] = (oil / m) * luck(Res.Oil) * (0.15 + keyed(seed, key, 101));
    score[Res.Rare][r] = (rare / m) * luck(Res.Rare) * (0.15 + keyed(seed, key, 102));
    // 金银也成片:同样的山,有的出金银、有的没有
    score[Res.Gold][r] = (gold / m) * luck(Res.Gold) * (0.15 + keyed(seed, key, 103));
  }
  const out = new Uint8Array(R * RESOURCE_COUNT);
  const ids: number[] = [];
  for (let r = 0; r < R; r++) if (livable[r]) ids.push(r);
  for (let k = 0; k < RESOURCE_COUNT; k++) {
    const sc = score[k];
    const order = ids.filter((r) => sc[r] > 0).sort((x, y) => sc[y] - sc[x] || x - y);
    const n = Math.min(order.length, Math.round(ids.length * RESOURCE_SHARE[k]));
    for (let i = 0; i < n; i++) out[order[i] * RESOURCE_COUNT + k] = i < n * 0.2 ? 3 : i < n * 0.5 ? 2 : 1;
  }
  return out;
}

/** 群落 → 能种多少粮(乘在宜居分上)、能放多少牧、有多少木材 */
const FARM: readonly number[] = biomeTable({ TemperateForest: 1, TropicalDryForest: 1, TemperateRainforest: 0.7, Savanna: 0.6, Steppe: 0.5, Rainforest: 0.5, Wetland: 0.5, Taiga: 0.3, TemperateDesert: 0.3, HotDesert: 0.3, ColdDesert: 0.2 });
const GRAZE: readonly number[] = biomeTable({ Steppe: 1, Savanna: 0.8, ColdDesert: 0.5, TemperateDesert: 0.4, Tundra: 0.3, TemperateForest: 0.2, TropicalDryForest: 0.2, HotDesert: 0.1 });
const OIL: readonly number[] = biomeTable({ HotDesert: 1, TemperateDesert: 0.9, ColdDesert: 0.6, Wetland: 0.8, Steppe: 0.5, Tundra: 0.4, Savanna: 0.3, Taiga: 0.2 });
const WOOD: readonly number[] = biomeTable({ Taiga: 1, TemperateForest: 1, TemperateRainforest: 1, Rainforest: 0.8, TropicalDryForest: 0.7, Wetland: 0.3, Savanna: 0.2 });

function biomeTable(v: Partial<Record<keyof typeof Biome, number>>): number[] {
  const t = new Array<number>(16).fill(0);
  for (const [k, x] of Object.entries(v)) t[Biome[k as keyof typeof Biome]] = x!;
  return t;
}

/**
 * 城市人口、城市分级、国号形态 —— 纯函数,推演(polities.ts)和界面(面板、悬停、画城镇符号)共用。
 * 单独放一个文件,不引入起名器和推演代码:主线程只用得到这些,打包时不用把地名词库带上。
 *
 * 人口单位:千人。
 *
 * **城市怎么长**:S 形曲线逐年逼近上限,任何年份都能现算,不用存每年的人口:
 *   人口(年) = 上限 ÷ (1 + GROWTH_A × e^(−速度 × (年 − 建城年)))
 *   建城那年人口约是上限的 1/41(几百到几千人的村子);国都的上限再高 CAPITAL_BOOST,在 CAPITAL_RAMP 年里渐渐加上去。
 *   上限还随所在州的生产能力变(Settlement.devCap,发展度推演里每 20 年看一次):石器时代的城小,铁器、中古以后大(devFactorAt)。
 *
 * **州的人口**(regionPopulationAt)= 治所的城 + 乡村。乡村人口是推演里的一张数表(population.ts:会搬家、逃兵灾,死伤后慢慢长回来),
 * 每 10 年存一份(Civ.development.rural),ruralPopulationAt 按前后两份线性插值;上限 = 面积 × 每平方公里能养活的人数
 * (按州的平均宜居分,RURAL_*)。旧版本的历史没存,照原来的写法现算:和州里第一座城一起按同样的 S 形曲线长,城被洗劫 / 被毁时跟着折损一部分。
 * 国家的人口 = 境内各州相加。
 * 城里的人一般占州里的几个百分点;推演(战争的国力、立国、迁都)仍只看城的人口。
 *
 * **城市兴衰**(阶段 3,cities.ts):洗劫后人口大减、之后慢慢恢复(Settlement.sacks);迁都 / 亡国后旧都的国都加成慢慢退掉
 * (Settlement.capitalSpans);被毁(Settlement.ended)后为 0。都按年份段现算,见 populationAt。
 * 地形大事以后城址变了的(Settlement.reshaped),上限从大事那一刻起换值(capacityAt):低了当即降,高了 RESHAPE_RAMP 年里渐渐涨上去。
 *
 * **城市分级**(按当年人口):村 < 8 千 ≤ 镇 < 2.5 万 ≤ 城 < 8 万 ≤ 大城。国都另画(不看人口)。
 *
 * **国号**:按当年的国土(州数)分四档,"升格"是推演里的一条事件(polities.ts),记在 Polity.titles 里。
 *
 * 西幻语感(音译的国名)—— 全称 = 国名词根 + 当年的国号,如"索拉特部 → 索拉特汗国 → 索拉特大汗国":
 *
 *   | 档 | 州数   | 农耕一系 | 游牧(汗国一系) | 海洋(城邦共和一系) |
 *   |----|--------|----------|------------------|----------------------|
 *   | 0  | 1–4    | 部       | 部               | 城邦                 |
 *   | 1  | 5–24   | 国       | 汗国             | 共和国               |
 *   | 2  | 25–69  | 王国     | 汗国             | 共和国               |
 *   | 3  | ≥ 70   | 帝国     | 大汗国           | 帝国                 |
 *
 * 东方语感(Polity.eastern)走中式写法(见 easternTitles):单字国名配"王国 / 帝国"是翻译腔("昌王国"),
 * 改成"昌部 → 昌国 → 大昌 → 大昌王朝";游牧"昌部 → 昌汗国 → 大昌汗国";海洋民族也走农耕这一套。
 * 两个字的国名不硬加"大"("景辰国 → 景辰王朝 → 景辰皇朝"),自带"大"的("大安")不叠成"大大安"。
 *
 * **王朝更替**(阶段 3,Polity.dynasties):东方国家改朝换代换国号,词根按年份取当朝的("大昌 → 大景",档位不变);
 * 西幻国家王室更迭,国名不变。国名一律经由 polityName / polityTitles(p, 年份) / polityShortTitle(p, 档位, 年份) 取,
 * 界面、地图、编年史就都跟着年份变;不给年份 = 第一朝(立国时的国名)。
 */
import type { Civ, Polity, PolityLineage, PopulationAt, Regions, Settlement, Year } from './types';
import { fexp, flog, fpow } from './rand';
import { KM_PER_UNIT, REF_CELLS } from './scale';
import { dynastyIndexAt, polityRootAt } from './polityRoot';
import { hasReform, reformedSeg, titleSeg } from './regime';

// 某一年是第几朝、那年的国名词根在 polityRoot.ts(存档里的改名只用得到这几样);原来从这里 import 的照旧能用
export { dynastyAt, dynastyIndexAt, polityRootAt } from './polityRoot';

/** S 形成长的初值比:建城那年人口 = 上限 ÷ (1 + GROWTH_A) */
export const GROWTH_A = 40;
/** 国都:人口上限 × (1 + CAPITAL_BOOST),立都后 CAPITAL_RAMP 年里渐渐加上去 */
export const CAPITAL_BOOST = 1;
export const CAPITAL_RAMP = 200;
/** 旧都衰落(阶段 3 城市兴衰):失去国都之位后,国都加成在这么多年里渐渐退掉(人口一两百年里回落) */
export const CAPITAL_DECLINE = 150;
/** 洗劫后人口慢慢恢复:折损按 e^(−年数 ÷ SACK_RECOVER) 淡去(约 70 年恢复一大半,两百年后几乎看不出) */
export const SACK_RECOVER = 70;
/** 地形大事以后城址的人口上限变高了(长出新地、成了港口):这么多年里渐渐涨上去(变低了是当即的:水漫进来、火山压过来是一下子的事) */
export const RESHAPE_RAMP = 60;

/**
 * 某年的人口上限(千人;不算国都加成、洗劫):建城时的 capacity,地形大事以后按 Settlement.reshaped 换值 ——
 * 比那一刻低的从那一刻起就是新值,比那一刻高的在 RESHAPE_RAMP 年里线性涨上去。大事以前和没有大事时一样
 */
export function capacityAt(s: Settlement, year: Year): number {
  const L = s.reshaped;
  let cap = s.capacity;
  if (!L) return cap;
  for (let i = 0; i < L.length; i++) {
    const e = L[i];
    if (!(year >= e.year)) break;
    const until = i + 1 < L.length && L[i + 1].year <= year ? L[i + 1].year : year;
    cap = rampTo(cap, e.capacity, until - e.year);
  }
  return cap;
}

/** 上限从 from 换成 to 过了 dt 年:低了当即是 to,高了线性涨 */
function rampTo(from: number, to: number, dt: number): number {
  return to <= from ? to : from + (to - from) * Math.min(1, dt / RESHAPE_RAMP);
}

/** 某年是不是港口:建城时的 port,地形大事以后按 Settlement.reshaped 换(那一刻起) */
export function portAt(s: Settlement, year: Year): boolean {
  let port = s.port;
  for (const e of s.reshaped ?? []) {
    if (!(year >= e.year)) break;
    port = e.port;
  }
  return port;
}

/** 最后一段地形里是港口的:从哪年起一直是港口(建城时就是 = 建城那年;地形大事以后才成的 = 那一年);最后不是港口 = Infinity */
export function portSince(s: Settlement): Year {
  let since = s.port ? s.founded : Infinity;
  for (const e of s.reshaped ?? []) {
    if (!e.port) since = Infinity;
    else if (!(since < Infinity)) since = e.year;
  }
  return since;
}

/**
 * 国都加成此刻加到了几成(0..1):按做国都的年份段(Settlement.capitalSpans)分段现算 ——
 * 做国都时每年 +1/CAPITAL_RAMP、不做了每年 −1/CAPITAL_DECLINE(再次立都从剩下的那几成接着加)
 */
export function capitalLevel(s: Settlement, year: Year): number {
  const spans = s.capitalSpans;
  if (!spans) return s.capitalFrom !== undefined && year > s.capitalFrom ? Math.min(1, (year - s.capitalFrom) / CAPITAL_RAMP) : 0;
  let lvl = 0;
  /** 上一段结束的年份(还没有结束过的段 = NaN) */
  let off = NaN;
  // 从 year 以前最后一次"空了 CAPITAL_DECLINE 年以上才又立都"的那一段算起:那时加成已经正好退回 0,更早的段不影响结果
  // (做过很多国家国都的城,推演几万年后有几百段)
  let i = spans.length;
  while (i > 0 && !(year > spans[i - 1].from)) i--;
  while (i > 1 && !(spans[i - 1].from - (spans[i - 2].until ?? Infinity) >= CAPITAL_DECLINE)) i--;
  for (let j = Math.max(0, i - 1); j < spans.length; j++) {
    const sp = spans[j];
    if (!(year > sp.from)) break;
    if (off === off) lvl = Math.max(0, lvl - (sp.from - off) / CAPITAL_DECLINE);
    const until = sp.until ?? Infinity;
    lvl = Math.min(1, lvl + (Math.min(year, until) - sp.from) / CAPITAL_RAMP);
    if (year <= until) return lvl;
    off = until;
  }
  return off === off ? Math.max(0, lvl - (year - off) / CAPITAL_DECLINE) : lvl;
}

/** 人口上限随生产能力变的倍数,每一对从记下那一刻起这么多年里从上一个倍数线性变过去(= 发展度推演的步长) */
export const DEV_RAMP = 20;

/**
 * 某年人口上限随生产能力变的倍数(Settlement.devCap:[年份, 倍数, …]):第一对以前、第一对那一刻 = 第一个倍数;
 * 之后每一对从它的年份起 DEV_RAMP 年里从上一个倍数线性变到它的倍数(各对至少隔 DEV_RAMP 年,上一段一定变完了)
 */
export function devFactorAt(dc: readonly number[], year: Year): number {
  const n = dc.length >> 1;
  if (!n) return 1;
  if (!(year > dc[0])) return dc[1];
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (dc[mid * 2] <= year) lo = mid;
    else hi = mid - 1;
  }
  const f = dc[lo * 2 + 1];
  if (lo === 0) return f;
  const prev = dc[lo * 2 - 1];
  return prev + (f - prev) * Math.min(1, (year - dc[lo * 2]) / DEV_RAMP);
}

/**
 * 洗劫、饥荒、瘟疫过去这么多年后,"1 − 折损 × e^(−年数 ÷ SACK_RECOVER)"在双精度里正好是 1(折损不超过 1:
 * e^(−2700 / 70) < 2^−54),乘上去不改人口。推演很久(几万年)时一座城攒下几百次折损,算人口时跳过这些,结果逐位不变
 */
const SACK_FORGET = 2700;

/** sacks(按年份排)里第一条 year 这一年还算数的(年份晚于 year − SACK_FORGET) */
function sackFrom(sacks: readonly { year: Year }[], year: Year): number {
  const y = year - SACK_FORGET;
  if (!(sacks.length && sacks[0].year <= y)) return 0;
  let lo = 0;
  let hi = sacks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sacks[mid].year <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * 某年的人口(千人);还没建城 / 已经被毁 = 0。
 * = S 形曲线 × 随生产能力变的倍数(devFactorAt)× 国都加成(capitalLevel)× 各次洗劫后还没恢复的那部分(1 − 折损 × e^(−年数 ÷ SACK_RECOVER))。
 * 全是现算,任何年份都能直接算,不存每年的人口
 */
export const populationAt: PopulationAt = (s: Settlement, year: Year): number => {
  if (!(year >= s.founded) || (s.ended !== undefined && year >= s.ended)) return 0;
  let cap = capacityAt(s, year);
  if (s.devCap) cap *= devFactorAt(s.devCap, year);
  if (s.capitalFrom !== undefined && year > s.capitalFrom) cap *= 1 + CAPITAL_BOOST * capitalLevel(s, year);
  const sacks = s.sacks;
  if (sacks) {
    for (let i = sackFrom(sacks, year); i < sacks.length; i++) {
      const k = sacks[i];
      if (!(year >= k.year)) break;
      cap *= 1 - k.loss * fexp(-sackAge(k, year) / SACK_RECOVER);
    }
  }
  return cap / (1 + GROWTH_A * fexp(-s.growth * (year - s.founded)));
};

/**
 * 一次折损到第 year 年恢复了多少年:一般 = year − 折损那年;全球大疫的(带 until,pandemic.ts)凋敝结束以前不恢复(= 0),
 * 之后从凋敝结束那年(比折损那年早的从折损那年)算起
 */
export function sackAge(k: { year: Year; until?: Year }, year: Year): number {
  if (k.until === undefined) return year - k.year;
  return Math.max(0, year - Math.max(k.year, k.until));
}

/** 全球大疫的凋敝里"疫气复作、流亡"(Settlement.sacks 里 cause = slump):乡下折损城里那一成的这么多(城乡一样掉) */
export const RURAL_SLUMP = 1;

/** 城里折损一成时乡下跟着折损几成:瘟疫 RURAL_PLAGUE、疫后凋敝 RURAL_SLUMP,别的(洗劫、饥荒、地震水旱)RURAL_WAR */
export function ruralShare(cause: string | undefined): number {
  return cause === 'plague' ? RURAL_PLAGUE : cause === 'slump' ? RURAL_SLUMP : RURAL_WAR;
}

/**
 * 不算国都加成、洗劫,但算上随生产能力变的倍数(Settlement.devCap)时,人口越过 level(千人)的年份;上限不够 = Infinity。
 * 没有 devCap 的同 yearReaching;有的从建城起每 DEV_RAMP 年看一次(再加地形大事降上限的前一刻),取第一个够了的取样年份
 * (倍数变低时人口可能又跌回去,取第一次越过的)。只看 until(含)以前的取样:推得更远,早先算出的年份不变。
 */
export function yearReachingDev(s: Settlement, level: number, until: Year): Year {
  const dc = s.devCap;
  if (!dc) return yearReaching(s, level);
  const pop = (y: number) => (capacityAt(s, y) * devFactorAt(dc, y)) / (1 + GROWTH_A * fexp(-s.growth * (y - s.founded)));
  let a = s.founded;
  if (pop(a) >= level) return a;
  // 地形大事降上限的前一刻也看一次(之前长过 level、大事以后又跌回去的,在两个取样点之间)
  const cuts = (s.reshaped ?? []).map((x) => x.year - 1 / 256);
  for (let b = a + DEV_RAMP; a < until; a = b, b += DEV_RAMP) {
    const c = cuts.find((x) => x > a && x < b && x <= until && pop(x) >= level);
    if (c !== undefined) return c;
    if (b <= until && pop(b) >= level) return b;
  }
  return Infinity;
}

/**
 * 人口(populationAt:算上国都加成、洗劫)第一次到 level(千人)的取样年份;只看 until(含)以前,没到 = Infinity。
 * 从 yearReachingDev 起(不算国都加成、洗劫的人口不会更少 —— 国都加成只在立都以后),往后照它的取样点(每 DEV_RAMP 年 + 地形大事前一刻)一个个看:
 * 快到的时候被洗劫、人口没缓过来的,等缓过来那一刻才算。推得更远,早先算出的年份不变
 */
export function yearReachingPop(s: Settlement, level: number, until: Year): Year {
  const y0 = yearReachingDev(s, level, until);
  if (!(y0 <= until)) return Infinity;
  if (populationAt(s, y0) >= level) return y0;
  const cuts = (s.reshaped ?? []).map((x) => x.year - 1 / 256);
  for (let a = s.founded + Math.floor((y0 - s.founded) / DEV_RAMP) * DEV_RAMP, b = a + DEV_RAMP; a < until; a = b, b += DEV_RAMP) {
    for (const c of cuts) if (c > Math.max(a, y0) && c < b && c <= until && populationAt(s, c) >= level) return c;
    if (b > y0 && b <= until && populationAt(s, b) >= level) return b;
  }
  return Infinity;
}

/**
 * 不算国都加成、洗劫时,人口越过 level(千人)的年份;上限不够 = Infinity。
 * 也不算随生产能力变的倍数(推演里定立国的年份用它,立国的节奏不随能力变;要算上它见 yearReachingDev)。
 * since:只看这一年起(含)人口够不够 —— 地形大事把上限降下来以后人口会跌回 level 以下,早先越过的不算数
 */
export function yearReaching(s: Settlement, level: number, since = -Infinity): Year {
  const first = reachWith(s, s.capacity, level);
  const L = s.reshaped;
  if (!L?.length || Math.max(first, since) < L[0].year) return first < Infinity ? Math.max(first, since) : Infinity;
  // 地形大事以后(capacityAt):每一段里上限只在段首降一次、之后只涨不降,人口跟着只增不减,段内二分
  let c = s.capacity;
  for (let i = 0; i < L.length; i++) {
    const a = L[i].year;
    const b = i + 1 < L.length ? L[i + 1].year : Infinity;
    const to = L[i].capacity;
    const from = c;
    c = rampTo(from, to, b - a);
    if (!(since < b)) continue;
    const pop = (y: number) => rampTo(from, to, y - a) / (1 + GROWTH_A * fexp(-s.growth * (y - s.founded)));
    const start = Math.max(a, since);
    if (pop(start) >= level) return start;
    // 涨完以后(上限 = to)按公式算得出的那一年一定够了;这一段结束前还够不上的看下一段
    let hi = Math.max(reachWith(s, to, level), to <= from ? a : a + RESHAPE_RAMP);
    if (!(hi < b)) {
      if (!(b < Infinity && pop(b) >= level)) continue;
      hi = b;
    }
    let lo = start;
    for (let k = 0; k < 32; k++) {
      const m = (lo + hi) / 2;
      if (pop(m) >= level) hi = m;
      else lo = m;
    }
    return hi;
  }
  return Infinity;
}

/** 上限一直是 cap 时,人口越过 level 的年份(S 形曲线反过来解);上限不够 = Infinity */
function reachWith(s: Settlement, cap: number, level: number): Year {
  const ratio = cap / level - 1;
  if (!(ratio > 0)) return Infinity;
  return s.founded + Math.max(0, flog(GROWTH_A / ratio) / s.growth);
}

// ---------------------------------------------------------------------------
// 州的人口:城 + 乡村

/**
 * 乡村每平方公里能养活多少人 = RURAL_DENSITY × (州的平均宜居分 ÷ RURAL_SUIT) ^ RURAL_EXP。
 * 指数 > 1:沃野、大河下游的平原比荒原、雨林密得多(平均宜居分 30 的大河平原每平方公里约 34 人,20 分的约 10 人,10 分的约 1 人)
 */
export const RURAL_DENSITY = 10;
export const RURAL_SUIT = 20;
export const RURAL_EXP = 3;
/** 城被洗劫 / 被毁时,州里的乡村跟着折损城里那一成的这么多(毁城当作折损全部),之后按 SACK_RECOVER 慢慢恢复 */
export const RURAL_WAR = 0.3;
/** 瘟疫(plague.ts)时乡村折损城里那一成的几成:疫气城乡都染,乡下人稀,死得少一些 */
export const RURAL_PLAGUE = 0.7;
/** 一个世界单位² 是多少平方公里 */
const KM2_PER_UNIT2 = KM_PER_UNIT * KM_PER_UNIT;
/** 默认精细度下一块地的面积(世界单位²;同 geo.ts 的 refCellArea:主图 2048 × 1024 按默认精细度分)。州的人口上限之和按它折算 */
const REF_CELL_AREA = (2048 * 1024) / REF_CELLS;

/** 州 r 的平均宜居分(按面积加权;没有陆地 = 0) */
export function regionSuitability(regions: Regions, r: number): number {
  const a = regions.area[r];
  return a > 0 ? (regions.capacity[r] * REF_CELL_AREA) / a : 0;
}

/** 州 r 的乡村人口上限(千人):面积(平方公里)× 每平方公里能养活的人数 */
export function ruralCapacity(regions: Regions, r: number): number {
  const suit = regionSuitability(regions, r);
  if (!(suit > 0)) return 0;
  return (regions.area[r] * KM2_PER_UNIT2 * RURAL_DENSITY * fpow(suit / RURAL_SUIT, RURAL_EXP)) / 1000;
}

/** 州 → 先后建在这一州的城(按建城先后;编号即下标) */
const chainMemo = new WeakMap<readonly Settlement[], Settlement[][]>();
function regionCities(settlements: readonly Settlement[], r: number): Settlement[] {
  let m = chainMemo.get(settlements);
  if (!m) {
    m = [];
    for (const s of settlements) (m[s.region] ??= []).push(s);
    for (const l of m) l?.sort((a, b) => a.founded - b.founded || a.id - b.id);
    chainMemo.set(settlements, m);
  }
  return m[r] ?? [];
}

/** 第 year 年那一段地形里的州(地形大事以前的段见 Civ.eras;州的编号各段一样) */
function regionsAt(civ: Pick<Civ, 'regions' | 'eras'>, year: Year): Regions {
  const eras = civ.eras;
  if (eras) for (const e of eras) if (year < e.until) return e.regions;
  return civ.regions;
}

/** 算州的人口要用到的(development 没有 = 旧版本的历史,乡村照 S 形曲线现算) */
export type PopulationCiv = Pick<Civ, 'regions' | 'eras' | 'settlements'> & Partial<Pick<Civ, 'development'>>;

/**
 * 州 r 在第 year 年的乡村人口(千人);这州还没建过城 = 0。
 * 推演里存了快照的(Civ.development.rural,每 10 年一份):按前后两份线性插值,最后一份以后照最后一份。
 * 没存的(旧版本的历史)现算:从这州第一次建城那年起,和那座城一样按 S 形曲线长到乡村人口上限(ruralCapacity,按那一段地形里的州算;
 * 和城一样乘上随生产能力变的倍数);州里的城每被洗劫一次、被毁一次,乡村折损城里那一成的 RURAL_WAR,之后按 SACK_RECOVER 慢慢恢复。城毁了乡下的人还在
 */
export function ruralPopulationAt(civ: PopulationCiv, r: number, year: Year): number {
  const snaps = civ.development?.rural;
  const ys = civ.development?.ruralYears;
  if (snaps?.length && ys?.length === snaps.length) return snapRural(snaps, ys, r, year);
  return ruralFormula(civ, r, year);
}

/** 快照里州 r 第 year 年的乡村人口(前后两份线性插值;第一份以前 = 0,最后一份以后照最后一份) */
function snapRural(snaps: readonly Float32Array[], ys: readonly Year[], r: number, year: Year): number {
  if (!(year >= ys[0])) return 0;
  let lo = 0;
  let hi = ys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ys[mid] <= year) lo = mid + 1;
    else hi = mid;
  }
  const i = lo - 1;
  const a = r < snaps[i].length ? snaps[i][r] : 0;
  if (i + 1 >= ys.length) return a;
  const b = r < snaps[i + 1].length ? snaps[i + 1][r] : 0;
  return a + ((b - a) * (year - ys[i])) / (ys[i + 1] - ys[i]);
}

/** 旧版本的历史:乡村人口照 S 形曲线现算(见 ruralPopulationAt) */
function ruralFormula(civ: Pick<Civ, 'regions' | 'eras' | 'settlements'>, r: number, year: Year): number {
  const chain = regionCities(civ.settlements, r);
  const first = chain[0];
  if (!first || !(year >= first.founded)) return 0;
  const regions = regionsAt(civ, year);
  if (!(r < regions.count)) return 0;
  let cap = ruralCapacity(regions, r);
  if (!(cap > 0)) return 0;
  // 随生产能力变的倍数:按这一年(或这一年以前最后一座)城的(城毁了乡下照旧按毁时的)
  let last: Settlement | undefined;
  for (const s of chain) if (year >= s.founded) last = s;
  if (last?.devCap) cap *= devFactorAt(last.devCap, last.ended !== undefined ? Math.min(year, last.ended) : year);
  for (const s of chain) {
    if (s.sacks) {
      for (let i = sackFrom(s.sacks, year); i < s.sacks.length; i++) {
        const k = s.sacks[i];
        if (!(year >= k.year)) break;
        cap *= 1 - ruralShare(k.cause) * k.loss * fexp(-sackAge(k, year) / SACK_RECOVER);
      }
    }
    if (s.ended !== undefined && year >= s.ended) cap *= 1 - RURAL_WAR * fexp(-(year - s.ended) / SACK_RECOVER);
  }
  return cap / (1 + GROWTH_A * fexp(-first.growth * (year - first.founded)));
}

/** 州 r 在第 year 年的城(这一年还在的那一座;没有 = undefined) */
export function regionCityAt(civ: Pick<Civ, 'settlements'>, r: number, year: Year): Settlement | undefined {
  const chain = regionCities(civ.settlements, r);
  for (let i = chain.length - 1; i >= 0; i--) {
    const s = chain[i];
    if (year >= s.founded && (s.ended === undefined || year < s.ended)) return s;
  }
  return undefined;
}

/**
 * 州 r 在第 year 年的总人口(千人)= 治所的城(populationAt)+ 乡村(ruralPopulationAt)。
 * 面板上州、国家的"人口"都按它算(国家 = 境内各州相加);城自己的人口仍是 populationAt
 */
export function regionPopulationAt(civ: PopulationCiv, r: number, year: Year): number {
  const s = regionCityAt(civ, r, year);
  return (s ? populationAt(s, year) : 0) + ruralPopulationAt(civ, r, year);
}

/** 城市分级:按人口(千人)的门槛 */
export const SETTLEMENT_RANKS: readonly { name: string; min: number }[] = [
  { name: '村', min: 0 },
  { name: '镇', min: 8 },
  { name: '城', min: 25 },
  { name: '大城', min: 80 },
];

/** 人口 → 分级(0 村 / 1 镇 / 2 城 / 3 大城) */
export function settlementRank(pop: number): number {
  let r = 0;
  for (let i = 1; i < SETTLEMENT_RANKS.length; i++) if (pop >= SETTLEMENT_RANKS[i].min) r = i;
  return r;
}

/** 阶段 3 城市兴衰:被毁的城被毁前一刻的级别(0 村 … 3 大城);没被毁 = −1 */
export function ruinRank(s: Settlement): number {
  return s.ended === undefined ? -1 : settlementRank(populationAt(s, s.ended - 1 / 256));
}

/** 地形大事里沉入海中的城(史事 sunk,b = 1)和城址沉了的遗址(UpheavalFact.ruins):城 → 哪一年沉的(同一份史事只数一次) */
const drownedMemo = new WeakMap<readonly unknown[], Map<number, Year>>();
function drownedCities(civ: Civ): Map<number, Year> {
  let d = drownedMemo.get(civ.annals);
  if (!d) {
    d = new Map();
    if (civ.upheavals?.length) {
      for (const e of civ.annals) if (e.kind === 'sunk' && e.b === 1) d.set(e.settlement, e.year);
      for (const f of civ.upheavals) for (const s of f.ruins ?? []) if (!d.has(s)) d.set(s, f.year);
    }
    drownedMemo.set(civ.annals, d);
  }
  return d;
}

/**
 * 某一年地图上的遗址:毁了、到这一年还没在故址上重建起新城的城(按编号)。
 * 同一处先后毁过几次的只算最近那一座;沉入海中的(地形大事;早先的遗址从城址沉了那年起)没有遗址
 */
export function ruinSites(civ: Civ, year: Year): Settlement[] {
  const S = civ.settlements;
  /** 旧城 → 在它故址上重建的新城 */
  const next = new Map<number, Settlement>();
  for (const s of S) if (s.rebuilds !== undefined) next.set(s.rebuilds, s);
  const drowned = drownedCities(civ);
  const out: Settlement[] = [];
  for (const s of S) {
    if (s.ended === undefined || !(s.ended <= year) || (drowned.get(s.id) ?? Infinity) <= year) continue;
    const n = next.get(s.id);
    if (n && n.founded <= year) continue;
    out.push(s);
  }
  return out;
}

/** 人口的说法:"约 3.2 万人"、"约 4000 人" */
export function populationLabel(pop: number): string {
  if (pop >= 10) return `约 ${(pop / 10).toFixed(pop >= 100 ? 0 : 1).replace(/\.0$/, '')} 万人`;
  const n = Math.max(100, Math.round(pop * 10) * 100);
  return `约 ${n} 人`;
}

/** 国号四档的州数门槛:第 i 档要 ≥ TIER_REGIONS[i] 个州 */
export const TIER_REGIONS: readonly number[] = [1, 5, 25, 70];

export function tierOf(regions: number): number {
  let t = 0;
  for (let i = 1; i < TIER_REGIONS.length; i++) if (regions >= TIER_REGIONS[i]) t = i;
  return t;
}

/** 国号形态表(西幻语感,按一系、档位):全称 = 词根 + 国号 */
export const POLITY_FORMS: Record<PolityLineage, readonly [string, string, string, string]> = {
  realm: ['部', '国', '王国', '帝国'],
  khanate: ['部', '汗国', '汗国', '大汗国'],
  republic: ['城邦', '共和国', '共和国', '帝国'],
};

type Titles = readonly [string, string, string, string];

/**
 * 东方语感的国号形态表(按一系、档位)。root = 国名词根;single = 单字词根(或"大"+ 单字,如"大安"),
 * core = 去掉"大"的那个字。第 2、3 档单字国名加"大"(大昌、大昌王朝),两个字的不加(景辰王朝、景辰皇朝)。
 */
const EASTERN_FORMS: Record<'realm' | 'khanate', (root: string, single: boolean, core: string) => Titles> = {
  realm: (root, single, core) => [
    `${root}部`,
    `${root}国`,
    single ? `大${core}` : `${root}王朝`,
    single ? `大${core}王朝` : `${root}皇朝`,
  ],
  khanate: (root, single, core) => [
    `${root}部`,
    `${root}汗国`,
    `${root}汗国`,
    single ? `大${core}汗国` : `${root}大汗国`,
  ],
};

/** 词根拆成 [是否单字, 核心字]:"昌" → [true, 昌];"大安" → [true, 安];"景辰" → [false, 景辰] */
function splitRoot(root: string): [boolean, string] {
  const cs = [...root];
  if (cs.length === 1) return [true, root];
  if (cs.length === 2 && cs[0] === '大') return [true, cs[1]];
  return [false, root];
}

/** 东方语感的四档全称(海洋民族也走农耕这一套:中式没有"共和国") */
export function easternTitles(root: string, lineage: PolityLineage = 'realm'): Titles {
  const [single, core] = splitRoot(root);
  return EASTERN_FORMS[lineage === 'khanate' ? 'khanate' : 'realm'](root, single, core);
}

/**
 * 某一朝的王朝名:东方 = 国名词根("景",编年史里写"大景"之类用 polityName);西幻 = "卡诺王朝"。
 * 没改朝换代过、或还没起名、改制开的共和 / 军政府那一段(没有王室)= 空串
 */
export function dynastyTitle(p: Polity, i: number): string {
  const d = p.dynasties?.[i];
  if (!d || !d.name || d.regime) return '';
  return p.eastern ? d.name : `${d.name}王朝`;
}

const titleCache = new WeakMap<Polity, Map<string, Titles>>();

/** 词根 root 的四档全称(按这个国家的语感、一系) */
function titlesOf(p: Polity, root: string): Titles {
  const key = `${root}|${p.lineage ?? 'realm'}|${p.eastern ? 1 : 0}`;
  let m = titleCache.get(p);
  if (!m) titleCache.set(p, (m = new Map()));
  let t = m.get(key);
  if (!t) {
    const lineage = p.lineage ?? 'realm';
    t = p.eastern ? easternTitles(root, lineage) : (POLITY_FORMS[lineage].map((f) => root + f) as unknown as Titles);
    m.set(key, t);
  }
  return t;
}

/**
 * 改出来的共和国(regime.ts;本国原来有君主)的国号:不分档,西幻"博戈维纳共和国";东方单字国名留着"大"("大靖共和国"),
 * 两个字的"景辰共和国"。这里的字都是国号里的字(本文件的字面量会收进地图字体的字表)
 */
function republicTitles(p: Polity, root: string): Titles {
  const key = `${root}|共和|${p.eastern ? 1 : 0}`;
  let m = titleCache.get(p);
  if (!m) titleCache.set(p, (m = new Map()));
  let t = m.get(key);
  if (!t) {
    const [single, core] = splitRoot(root);
    const full = p.eastern && single ? `大${core}共和国` : `${root}共和国`;
    t = [full, full, full, full];
    m.set(key, t);
  }
  return t;
}

/** 那一年是不是改出来的共和国(军政府照它前面那一段:政变不改国号) */
function reformedAt(p: Polity, year: Year): boolean {
  return !!p.dynasties && reformedSeg(p, titleSeg(p, dynastyIndexAt(p, year)));
}

/**
 * 这个国家四档的全称(按语感、一系)。给了年份就按那一年的那一朝(东方改朝换代后国号换了;改制以后的共和国写"某共和国");
 * 不给 = 第一朝(立国时的国名)
 */
export function polityTitles(p: Polity, year?: Year): Titles {
  if (year === undefined) return reformedSeg(p, 0) ? republicTitles(p, p.name) : titlesOf(p, p.name);
  const root = polityRootAt(p, year);
  return reformedAt(p, year) ? republicTitles(p, root) : titlesOf(p, root);
}

/** 这个国家先后用过的国名词根(第一朝在前,去重;西幻只有一个) */
export function polityRoots(p: Polity): string[] {
  const out = [p.name];
  if (p.eastern) for (const d of p.dynasties ?? []) if (d.name && !out.includes(d.name)) out.push(d.name);
  return out;
}

/** 这个国家历朝历代各档的全称和简称(地图文字的字表、字体预载用) */
export function polityAllTitles(p: Polity): string[] {
  const out = new Set<string>();
  const reformed = hasReform(p);
  for (const root of polityRoots(p)) {
    const t = titlesOf(p, root);
    for (let tier = 0; tier < 4; tier++) {
      out.add(t[tier]);
      out.add(shortTitle(p, root, tier));
    }
    if (reformed) {
      out.add(republicTitles(p, root)[0]);
      out.add(shortTitle(p, root, 3, true));
    }
  }
  return [...out];
}

function shortTitle(p: Polity, root: string, tier: number, republic = false): string {
  if (tier < 0) return root;
  if (!p.eastern) return root;
  const [single, core] = splitRoot(root);
  if (!single) return root;
  // 改出来的共和国:单字国名的简称是"大X"(和全称"大X共和国"一样留着"大")
  if (republic) return `大${core}`;
  if (tier >= 2 && p.lineage !== 'khanate') return `大${core}`;
  return titlesOf(p, root)[tier];
}

/**
 * 地图上用的简称(国土放不下全称时写它):西幻语感 = 词根("索拉特王国" → "索拉特");
 * 东方语感:单字国名第 2 档起 = "大X"("大昌王朝" → "大昌"),两个字的 = 词根("景辰皇朝" → "景辰"),
 * 单字国名第 0、1 档("昌部""昌国")单写一个字认不出是国名,简称就是全称。
 * 给了年份就按那一年的那一朝(改朝换代后"大昌" → "大景");不给 = 第一朝
 */
export function polityShortTitle(p: Polity, tier: number, year?: Year): string {
  if (year === undefined) return shortTitle(p, p.name, tier, reformedSeg(p, 0));
  return shortTitle(p, polityRootAt(p, year), tier, reformedAt(p, year));
}

/** 某一年的国号档位(按 titles 查);还没立国 = −1 */
export function polityTierAt(p: Polity, year: Year): number {
  if (!(year >= p.founded)) return -1;
  const t = p.titles;
  if (!t || !t.length) return 0;
  let tier = t[0].tier;
  for (let i = 1; i < t.length && t[i].year <= year; i++) tier = t[i].tier;
  return tier;
}

/** 某一年的全称("索拉特王国"、"大昌王朝");还没立国 = 词根 */
export function polityName(p: Polity, year: Year): string {
  const tier = polityTierAt(p, year);
  return tier < 0 ? p.name : polityTitles(p, year)[tier];
}

/**
 * 国号升格的路线(去重):"昌部 → 昌国 → 大昌 → 大昌王朝"。
 * 东方改朝换代过的(阶段 3),写实际用过的国号,按先后:"昌部 → 昌国 → 大昌 → 大景 → 大景王朝 → 大雍王朝"
 * (西幻王室更迭国名不变,照旧)。这里的字都是国号里的字(本文件的字面量会收进地图字体的字表)
 */
export function polityTitleChain(p: Polity): string {
  const d = p.dynasties;
  if ((!p.eastern || !d || d.length < 2 || !d[1].name) && !hasReform(p)) {
    return polityTitles(p)
      .filter((f, i, a) => a.indexOf(f) === i)
      .join(' → ');
  }
  const years = [...(p.titles ?? []).map((x) => x.year), ...d!.map((x) => x.year)].sort((a, b) => a - b);
  const out: string[] = [];
  for (const y of years) {
    const n = polityName(p, y);
    if (out[out.length - 1] !== n) out.push(n);
  }
  return out.join(' → ');
}

/**
 * 某一年的国都(Settlement id;按 capitals 查,迁都当年起算新国都)。还没立国的年份 = 立国时的国都。
 * 画国都符号、悬停、面板都用它,别直接读 p.capital(那只是立国时的国都)
 */
export function capitalAt(p: Polity, year: Year): number {
  const c = p.capitals;
  if (!c || !c.length) return p.capital;
  let s = c[0].settlement;
  for (let i = 1; i < c.length && c[i].year <= year; i++) s = c[i].settlement;
  return s;
}

/**
 * 亡国那条史事(下标 i)前面,丢了国都撑不下去、残部一并归攻方的那几条攻占(不是打下来的,史事下标)。
 * 亡国前同一刻连着的几条攻占里,打下国都的那一条以前的是这一仗打下来的(乘胜连下的几州也在同一刻),以后的是残部;
 * 找不到国都那一条(手工拼的史事)时,只把最早一条当打下来的
 */
export function annexedRemnants(civ: Pick<Civ, 'annals' | 'polities' | 'settlements'>, i: number): number[] {
  const A = civ.annals;
  const e = A[i];
  const run: number[] = [];
  for (let j = i - 1; j >= 0; j--) {
    const c = A[j];
    if (c.kind !== 'conquer' || c.war !== e.war || c.year !== e.year || c.a !== e.b || c.b !== e.a) break;
    run.push(j);
  }
  const Y = civ.polities[e.a];
  const cr = Y ? civ.settlements[capitalAt(Y, e.year)]?.region : undefined;
  const k = cr === undefined ? -1 : run.findIndex((j) => A[j].region === cr);
  return k >= 0 ? run.slice(0, k) : run.slice(0, -1);
}

/** 国家在某一年存在(已立国、还没灭亡) */
export function polityAlive(p: Polity, year: Year): boolean {
  return year >= p.founded && (p.ended === undefined || year < p.ended);
}

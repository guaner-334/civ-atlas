/**
 * 大迁徙:草原、寒地的民族"分出一支,举族远走" —— 走过去再落脚,到了像民变起事那样占几州立国、当即开战;
 * 打进国都的,小国亡国、大国大崩解。挂在同一个推演引擎(sim.ts)上,改归属一律走 setOwner(立国的州原因 = Ev.Split,
 * 落脚的州改换民族 = Ev.TrekSettle),发生了什么记进史事(trek;立的国记 found、开的仗记 war,cause 都是 trek),每一次的经过记进 Civ.migrations。
 *
 * 流程(index.ts 在 installTreaties 之后调用 installMigration):
 *
 *   **看大迁徙**(Ev.TrekCheck,CHECK_FIRST 年起每 CHECK_EVERY 年一次,每段里随机一个时刻):
 *     全世界在路上的不到 LIVE 支、这个世界走过的不到 MAX 次时,看各个能迁的民族(游牧,和发源在苔原、针叶林的;海上民族不算):
 *     还在、至少 MIN_FOLK 州、GAP 年内没走过。
 *       推 = 老家挤(本族各州乡村人口顶到上限的几成,CROWD_0 以上的部分)× W_CROWD
 *          + 灾年(FAMINE_YEARS 年内闹过饥荒的城占本族有城的州几成,FAMINE_FULL 算满)× W_FAMINE
 *          + 本族的国 SCATTER_YEARS 年内大崩解过 / 亡了 × W_SCATTER
 *       拉 = 走得到的(陆路 HOPS_FLOOR–HOPS_MAX 州远)、有城、不是本族的地方里"值"最高的那一州:
 *          值 = 地好(城的人口 ÷ POP_REF 开方,最多 GOOD_MAX)
 *             × 守得弱(部落地带 WEAK_TRIBAL;国家:WEAK_0 + 动荡 × WEAK_UNREST + 近 CHAOS_YEARS 年大崩解过 / 是崩出来的一块 WEAK_CHAOS
 *                     + 疫后凋敝的几成 × WEAK_PLAGUE + 正打着仗 WEAK_WAR)
 *             × 远一点打点折(e^(−(州数 − HOPS_MIN) ÷ HOPS_FADE);小块陆地上不到 HOPS_MIN 州的,e^(−(HOPS_MIN − 州数) ÷ SHORT_FADE))
 *             × 大国(BIG 州以上)的腹地再乘 1 + HEART_W × e^(−离国都的路程 ÷ HEART_REACH)
 *               (这个世界已经有一支打进过大国国都的,大国的地一律打 LATE_BIG 折,腹地不另加)
 *       各族各掷一次(按发源州取随机数):赔率 = ODDS × s ÷ (s + HALF) × (1 + PACE_W × 落后几次),s = (PUSH_0 + 推) × 拉
 *       (每 PACE_YEARS 年该有一次,天下久无大迁徙,草原上攒的力量越大);中了的按发源州的先后,一次看最多走一支。
 *   **动身**:分出约 SHARE 的人(到了能占 SIZE_MIN–SIZE_MAX 州),从老家离那州最近的一州出发,沿陆路走(平地、跨河、翻山,不过海):
 *     路线挑走得最快的那条(草原荒漠快,林地、高山、翻山慢),每州 STEP_YEARS × 地形 × (1 ± STEP_JITTER)年;
 *     路线和到每一州的年份动身时就定下(记进 Civ.migrations、记一条 trek n = 0),每到一州预约一件 Ev.TrekStep。
 *   **路上**:路过有城、不是本族的州,有 RAID_P 的机会洗劫(部落地带再打 RAID_TRIBAL 折):城的人口掉 RAID_LOSS 里随机的几成
 *     (记进 Settlement.sacks,和战争里的洗劫一样几十年慢慢长回来),记一条 trek(n = 1)。队伍不占地。
 *   **落脚**(路线的最后一州):从那州往外占几州(那州的主人的、部落地带的;不碰各国国都、永久划给别国的州、中立地),
 *     改换成迁来的民族(HOLD 年内刚改换过民族的、原民族最后一州的不改,照样归它),以里面人口最多的城为都立国(Polity.trek;记 trek n = 2,紧跟着 found,cause = trek),
 *     当即和那里的国家开战(记 war,cause = trek;落脚的那州是部落地带的,和接壤的、动身时冲着的那国开战,不接壤就挑接壤最长的那国)。
 *     一座城都没有 = 不立国,散居那几州(trek n = 4,结局败散)。
 *     这一仗像讨伐民变那样打(WarModel.revolt):不到厌战的几倍年限不罢兵,不受降;迁来的一方初起声势大
 *     (国力 × (1 + (MORALE − 1) × e^(−年数 ÷ FADE)),从立国或最近一次攻下一州那年起淡去),守方 × COURT。
 *     打进那国的国都:比它小的(不到迁来的国的 SMALL_K 倍,或不到 SMALL_MIN 州)亡国、余下的州一并归它(WarModel.overthrow);
 *     别的(WarModel.storm):迁来的一方占着国都一带(那国国土的 GRAB_FRAC,GRAB_MIN–GRAB_MAX 州),那国迁都、议和(记 trek n = 3);
 *     丢国都以前还有 BIG 州的大国,有 SHATTER_0 + SHATTER_U × 动荡 的机会当即大崩解(politics.ts 的 shatter,紧跟着记 collapse)。
 *     开战时那国有 BIG 州以上、打进了它的国都(亡国或迁都)= 打进大国(Migration.big)。
 *     迁来的国亡于这一仗 = 败散,落脚的几州留下一块异族。
 *   之后照常:迁来的国照常打仗、分合、同化;统治民族在本国是少数时被同化得快(assimilation.ts 的 TREK_*)。
 *
 * **作者下令**(干预,interventions.ts 在 from 那一刻调 TrekModel.order;字段见 gen/edits.ts 的干预表):
 *   大迁徙 trek:那一刻这一族分出一支,不看推不推得动、全世界同时几支在路上、这个世界走过几次、这一族多久前走过(Migration.iv = 第几条干预)。
 *     出发:作者给的那一州那一刻还是这一族的,只从它出发(本族的州也走得过);不然和推演自己起的一样从本族离目的地最近的一州走。
 *     往哪去:指定一州 = 陆路走得到就去(多远都行);推演挑 = 和"看大迁徙"同一套"值",只是远近换成 REACH 的那一档。
 *     推演挑带着方位(dir,照大纲下的令):只挑走过去整条路线朝那个方位(trekDir)的州;那一档没有,依次放宽到中、近、远里别的几档。
 *     走不成记 intervene(b = IV_NO_WAY);这一族那一刻已消亡 b = −3;走了 b = −1(region / settlement = 目的地那州和它的城),紧跟着记 trek n = 0。
 *     史事 intervene 的 a = −1(不是国家),**民族在 Annal.n**。为什么走照"看大迁徙"的推算(没有推力的写老家挤)。
 *   不许迁 stay:看大迁徙时,生效期里的这一族不在候选里(InterventionModel.stays)。已经在路上的照走;作者下令的照走。
 *
 * **接着推**:Civ.migrations 里记着每一次的路线、年份和结局;还在路上的照记下的年份补上没走完的几步(动身那一刻一起预约的),
 *   开的那一仗由 Migration.war 认;看大迁徙的时刻由"第几次"算出来(resumeMigration)。
 * 随机数:keyed(subSeed(seed, 'civ-trek'), 第几次 / 民族的发源州 / 州的治所…, 用途),和处理顺序无关。纯计算,不碰 DOM。
 */
import { biomeTagged } from '../biomes';
import type { World } from '../world';
import { geometryOf, type Geometry } from '../geometry';
import { TREK_DIR_NAMES, regionOfKey, type Intervention, type TrekReach } from '../edits';
import { AdjKind, Layer, type Civ, type Culture, type Migration, type MigrationDir, type Year } from './types';
import { fexp, keyed, keyed4, subSeed } from './rand';
import { BOOKED_AT_START, bookChain, Ev, quantize, type CivSim } from './sim';
import { addPolity, moveCapital, polityModelOf, type PolityModel } from './polities';
import { bestCapital, polityBorders, warModelOf, type War, type WarModel } from './wars';
import { politicsModelOf, type PoliticsModel } from './politics';
import { unrestModelOf } from './unrest';
import { HOLD, assimModelOf } from './assimilation';
import { devModelOf } from './development';
import { capitalAt, populationAt, ruralCapacity } from './growth';
import { IV_NO_WAY, searchTrek, trekLand, trekPace, trekPaths, trekRouteTo } from './trekRoute';
import type { InterventionModel } from './interventions';

// ---- 调参(以 20 个种子的统计为准) ----
/** 第一次看大迁徙在哪一年附近;之后每隔多少年(每段里 20%–80% 处随机一个时刻) */
const CHECK_FIRST = 300;
const CHECK_EVERY = 50;
/** 全世界同时最多几支在路上;一个世界最多几次;同一个民族多少年内只走一次 */
const LIVE = 2;
const MAX = 6;
const GAP = 200;
/** 民族至少几州才分得出一支;分出几成;到了能占几州 */
const MIN_FOLK = 5;
const SHARE = 0.3;
const SIZE_MIN = 3;
const SIZE_MAX = 8;
/** 推:老家挤(乡村人口 ÷ 上限的平均,CROWD_0 以上的部分);灾年(FAMINE_YEARS 年内闹过饥荒的城,占有城的州 FAMINE_FULL 算满);本族的国散了 */
const CROWD_0 = 0.6;
const W_CROWD = 1;
const FAMINE_YEARS = 30;
const FAMINE_FULL = 0.2;
const W_FAMINE = 1.5;
const SCATTER_YEARS = 60;
const W_SCATTER = 1.2;
const PUSH_0 = 0.3;
/** 拉:走得到的范围(陆路几州远);远一点打的折 */
const HOPS_MIN = 10;
const HOPS_MAX = 20;
const HOPS_FADE = 15;
/** 小块陆地上走不了那么远:最近 HOPS_FLOOR 州,不到 HOPS_MIN 州的值打折 e^(−差几州 ÷ SHORT_FADE) */
const HOPS_FLOOR = 5;
const SHORT_FADE = 3;
/** 地好:城的人口(千人)÷ POP_REF 开方,最多 GOOD_MAX */
const POP_REF = 30;
const GOOD_MAX = 2.5;
/** 守得弱:部落地带;国家的底数、动荡、近年大乱、疫后凋敝、正打着仗 */
const WEAK_TRIBAL = 0.5;
const WEAK_0 = 0.2;
const WEAK_UNREST = 0.35;
const CHAOS_YEARS = 100;
const WEAK_CHAOS = 0.9;
const WEAK_PLAGUE = 1.2;
const WEAK_WAR = 0.25;
/** 大国腹地:离国都近的州值再乘 1 + HEART_W × e^(−路程 ÷ HEART_REACH) */
const HEART_W = 1.5;
const HEART_REACH = 6;
/** 这个世界已经有一支打进过大国国都(Migration.big)以后,大国的地的值打这么多折(腹地不另加) */
const LATE_BIG = 0.1;
/** 赔率底数(各族一次看一次;× s ÷ (s + HALF),s = (PUSH_0 + 推) × 拉);每 PACE_YEARS 年该有一次,落后一次赔率多乘 PACE_W */
const ODDS = 0.06;
const HALF = 0.3;
const PACE_YEARS = 600;
const PACE_W = 3;
/** 走一州的年数(trekRoute.ts 的 trekPace)再 ± STEP_JITTER 随机 */
const STEP_JITTER = 0.25;
/** 路上洗劫:有城的州每州的机会、部落地带打的折、人口掉几成 */
const RAID_P = 0.35;
const RAID_TRIBAL = 0.5;
const RAID_LOSS: readonly [number, number] = [0.08, 0.25];
/** 到了以后那一仗:迁来的一方初起声势(倍数)、几年里淡去;守方的倍数 */
const MORALE = 10;
const FADE = 25;
const COURT = 0.6;
/**
 * 打进国都:那国(丢国都以前)不到迁来的国的 SMALL_K 倍、或者不到 SMALL_MIN 州 = 比它小,亡国、州归它;
 * 到 BIG 州的算大国,大崩解;中间的迁都、议和。迁来的占着国都一带的几成、最少 / 最多几州
 */
const SMALL_K = 1.5;
const SMALL_MIN = 6;
const BIG = 25;
const GRAB_FRAC = 0.12;
const GRAB_MIN = 2;
const GRAB_MAX = 10;
/** 打进大国国都时大崩解的机会 = SHATTER_0 + SHATTER_U × 那国的动荡;取随机数用的"第几次"(和看内政的错开) */
const SHATTER_0 = 0.25;
const SHATTER_U = 0.3;
const SHATTER_K = 1 << 22;
/**
 * 作者下令"推演挑"时走多远(干预 trek 的 reach):[几州远起值不打折, 最远几州, 最近几州]。
 * 中 = 推演自己起的那样;远只有下令才有(横穿大陆)
 */
const REACH: Record<TrekReach, readonly [number, number, number]> = {
  near: [HOPS_FLOOR, HOPS_MIN, 2],
  mid: [HOPS_MIN, HOPS_MAX, HOPS_FLOOR],
  far: [HOPS_MAX, 2 * HOPS_MAX, HOPS_MIN],
};
/** 往某个方位的令,那一档没有地方可去时依次放宽到的几档 */
const TREK_ORDER: readonly TrekReach[] = ['mid', 'near', 'far'];

// 随机数用途编号
const U_CHECK_T = 1;
const U_GO = 2;
const U_STEP = 3;
const U_RAID = 4;
const U_LOSS = 5;
const U_GROW = 6;
const U_SHATTER = 7;

/** 发源在这些地方的民族会迁:苔原、针叶林(寒地;按 Biome 下标,见地貌表的标签 cold) */
const COLD = biomeTagged('cold');

// ---------------------------------------------------------------------------
// 模型

export interface TrekModel {
  pm: PolityModel;
  wm: WarModel;
  pol: PoliticsModel;
  base: number;
  geo: Geometry;
  /** 每一次大迁徙(写进 Civ.migrations 的就是这一份) */
  list: Migration[];
  /** 到了以后开的那一仗:战争编号 → 第几次大迁徙 */
  wars: Map<number, number>;
  /** 作者下令的大迁徙(干预 trek,interventions.ts 在那一刻调用;史事 intervene 也在这里记) */
  order?: (v: TrekIv, i: number, t: Year, iv: InterventionModel) => void;
  /**
   * 下令"推演挑"会去哪:民族 c 此刻按 reach 那一档、从 start 出发(−1 = 本族各州一起往外)找走得到的地方里值最高的那一州
   * (没有 = target −1;hops = 几州远)。out = 各候选州的值(测试用);dir = 只挑路线朝这个方位的
   */
  pick?: (c: number, t: Year, reach: TrekReach, start: number, out?: Map<number, number>, dir?: MigrationDir) => { target: number; why: Migration['pull']; hops: number };
}

/** 干预:大迁徙 */
export type TrekIv = Extract<Intervention, { kind: 'trek' }>;

function newModel(pm: PolityModel, wm: WarModel, pol: PoliticsModel, world: World, list: Migration[]): TrekModel {
  return { pm, wm, pol, base: subSeed(pm.seed, 'civ-trek'), geo: geometryOf(world.mesh), list, wars: new Map() };
}

const models = new WeakMap<CivSim, TrekModel>();

/** 推演引擎上挂着的大迁徙模型(整理成 Civ、测试、统计用) */
export function trekModelOf(sim: CivSim): TrekModel | undefined {
  return models.get(sim);
}

/** 复制一份(路线、年份、落脚的州都是新数组) */
function copyMigrations(list: readonly Migration[]): Migration[] {
  return list.map((M) => ({ ...M, route: M.route.slice(), years: M.years.slice(), ...(M.lands ? { lands: M.lands.slice() } : {}) }));
}

/** 写进 Civ 的那一份(复制:之后再接着推不改它);没装大迁徙 = undefined */
export function migrationsOf(sim: CivSim): Migration[] | undefined {
  const tm = models.get(sim);
  return tm ? copyMigrations(tm.list) : undefined;
}

/** 第 k 次看大迁徙的时刻 */
function checkTime(tm: TrekModel, k: number): number {
  return CHECK_FIRST + CHECK_EVERY * (k + 0.2 + 0.6 * keyed(tm.base, k, 0, U_CHECK_T));
}

/** 这个民族会不会举族远走:游牧,和发源在苔原、针叶林的(海上民族不算) */
export function trekFolk(c: Culture, biome: ArrayLike<number>): boolean {
  if (c.kind === 'sea') return false;
  return c.kind === 'nomad' || COLD[biome[c.hearth]] === 1;
}

/**
 * 一路往哪个方位走(Migration.dir):cells = 路线上依次走过的地块(各州治所)。按地图(经纬度)上整条路线的走向:
 * 一段一段的经度差(过 180° 经线的一段按近的那边算,和地图上画路线一样)、纬度差加起来,东西、南北哪个大取哪个。
 * 不看出发地到落脚地的大圆初始朝向:高纬度往西走得远的,大圆先偏向极地,会写成"南徙",地图上却一路往西
 */
export function trekDir(geo: Geometry, cells: readonly number[]): MigrationDir {
  const { x, y, width: W, height: H } = geo.mesh;
  let dx = 0;
  for (let j = 1; j < cells.length; j++) {
    const d = x[cells[j]] - x[cells[j - 1]];
    dx += d > W / 2 ? d - W : d < -W / 2 ? d + W : d;
  }
  // 换成度:东西按经度、南北按纬度(世界坐标 y 向下 = 向南)
  const e = (dx * 360) / W;
  const s = cells.length ? ((y[cells[cells.length - 1]] - y[cells[0]]) * 180) / H : 0;
  if (Math.abs(e) >= Math.abs(s)) return e >= 0 ? '东' : '西';
  return s > 0 ? '南' : '北';
}

// ---------------------------------------------------------------------------
// 挂到推演引擎上

/** 登记大迁徙的事件处理和挂钩(installTreaties 之后调用),预约第一次看大迁徙 */
export function installMigration(sim: CivSim, pm: PolityModel, world: World): TrekModel {
  const wm = warModelOf(sim);
  const pol = politicsModelOf(sim);
  if (!wm || !pol) throw new Error('installMigration:先 installWars、installPolitics');
  const tm = newModel(pm, wm, pol, world, []);
  hook(sim, tm);
  sim.schedule(checkTime(tm, 0), Ev.TrekCheck, 0, 0);
  return tm;
}

function hook(sim: CivSim, tm: TrekModel): void {
  models.set(sim, tm);
  const { pm, wm, pol, list } = tm;
  const T = pm.terrain;
  const reg = T.regions;
  const R = T.R;
  const culture = sim.owners[Layer.Culture];
  const owner = sim.owners[Layer.Polity];
  const am = assimModelOf(sim);
  const cultures = am?.cultures ?? pm.cultures;

  /** 民族 c 的发源州治所(位置锚) */
  const folkTag = (c: number) => reg.seat[Math.min(R - 1, Math.max(0, cultures[c].hearth))];
  /** 第 m 次大迁徙的位置锚:民族 + 动身那一刻 */
  const trekTag = (m: number) => folkTag(list[m].culture) * 64 + (Math.round(list[m].year * 256) & 63);
  const land = trekLand;

  /**
   * 落脚的州改换成迁来的民族(日志原因 Ev.TrekSettle)。HOLD 年内刚改换过民族的州不改(不闪烁),
   * 原民族只剩这一州的也不改(不让一个民族因此消亡):这两种州照样归迁来的国,民族不变。改了 = true
   */
  const changeFolk = (r: number, c: number, t: number): boolean => {
    const old = culture[r];
    if (old === c) return true;
    if (am && (t - am.since[r] < HOLD || (old >= 0 && am.count[old] <= 1))) return false;
    sim.setOwner(Layer.Culture, r, c, Ev.TrekSettle);
    return true;
  };

  /** 城 r 此刻的人口(没有城 = 0) */
  const cityPop = (r: number, t: number) => {
    const sid = pm.cityOf[r];
    return sid >= 0 ? populationAt(pm.settlements[sid], t) : 0;
  };

  // ---- 守得弱 ----
  const um = () => unrestModelOf(sim);
  /** 国家 o 此刻守得多弱;why = 主要因为什么 */
  const weakness = (o: number, t: number): { v: number; why: Migration['pull'] } => {
    if (o < 0) return { v: WEAK_TRIBAL, why: 'tribal' };
    const P = pm.polities[o];
    const u = pol.unrest?.(P, t) ?? 0;
    const col = um()?.collapsed.get(o);
    // 近年大崩解过,或者是崩出来的一块(自立不久)
    const chaos = (col !== undefined && t - col < CHAOS_YEARS) || (P.parent !== undefined && t - P.founded < CHAOS_YEARS && (um()?.collapsed.get(P.parent) ?? -Infinity) >= P.founded - 1e-6);
    const blight = wm.blight?.(o, t) ?? 0;
    const war = wm.active.some((w) => w.a === o || w.b === o);
    const vChaos = WEAK_UNREST * Math.max(0, u) + (chaos ? WEAK_CHAOS : 0) + (war ? WEAK_WAR : 0);
    const vPlague = WEAK_PLAGUE * blight;
    const v = WEAK_0 + vChaos + vPlague;
    const why: Migration['pull'] = vPlague > vChaos && vPlague > 0.2 ? 'plague' : vChaos > 0.5 ? 'chaos' : 'rich';
    return { v, why };
  };

  // ---- 找路:从本族各州出发(作者下令从哪州走的:只从那一州出发),陆路往外,按走的年数(地形)最短(trekRoute.ts) ----
  const P = trekPaths(R);
  const hops = P.hops;
  /** 从民族 c 往外找路(最多 maxHops 州远;start ≥ 0 = 只从那一州出发):P 填好 */
  const paths = (c: number, start = -1, maxHops = HOPS_MAX) => searchTrek(reg, R, culture, c, start, maxHops, P);

  /** 此刻各民族的州数、有城的州、闹过饥荒的城、乡村人口挤不挤、本族的国近年散了没有(推的几样) */
  const folkStats = (t: number) => {
    const n = new Int32Array(cultures.length);
    const cities = new Int32Array(cultures.length);
    const hungry = new Int32Array(cultures.length);
    const crowd = new Float64Array(cultures.length);
    const crowdN = new Int32Array(cultures.length);
    const rural = devModelOf(sim)?.ruralNow?.()?.data;
    for (let r = 0; r < R; r++) {
      const c = culture[r];
      if (c < 0 || c >= cultures.length) continue;
      n[c]++;
      const sid = pm.cityOf[r];
      if (sid >= 0) {
        cities[c]++;
        const sk = pm.settlements[sid].sacks;
        if (sk) {
          for (let i = sk.length - 1; i >= 0 && t - sk[i].year < FAMINE_YEARS; i--) {
            if (sk[i].cause === 'famine') {
              hungry[c]++;
              break;
            }
          }
        }
      }
      if (rural && r < rural.length) {
        const cap = ruralCapacity(reg, r);
        if (cap > 0) {
          crowd[c] += Math.min(1.5, rural[r] / cap);
          crowdN[c]++;
        }
      }
    }
    // 本族的国近年散了(大崩解过、亡了)
    const scattered = new Uint8Array(cultures.length);
    const col = um()?.collapsed;
    for (const Q of pm.polities) {
      if (Q.culture < 0 || Q.culture >= cultures.length) continue;
      if ((Q.ended !== undefined && t - Q.ended < SCATTER_YEARS) || (col && t - (col.get(Q.id) ?? -Infinity) < SCATTER_YEARS)) scattered[Q.culture] = 1;
    }
    return { n, cities, hungry, crowd, crowdN, scattered };
  };
  /** 民族 c 推的力量、主要因为什么 */
  const pushOf = (st: ReturnType<typeof folkStats>, c: number): { push: number; why: Migration['push'] } => {
    const { cities, hungry, crowd, crowdN, scattered } = st;
    const fCrowd = crowdN[c] ? Math.max(0, Math.min(1, (crowd[c] / crowdN[c] - CROWD_0) / (1 - CROWD_0))) : 0;
    const fFamine = cities[c] ? Math.min(1, hungry[c] / Math.max(1, FAMINE_FULL * cities[c])) : 0;
    const pCrowd = W_CROWD * fCrowd;
    const pFamine = W_FAMINE * fFamine;
    const pScatter = W_SCATTER * scattered[c];
    const push = pCrowd + pFamine + pScatter;
    const why: Migration['push'] = pScatter >= pFamine && pScatter >= pCrowd && pScatter > 0 ? 'scatter' : pFamine >= pCrowd && pFamine > 0 ? 'famine' : 'crowd';
    return { push, why };
  };

  /**
   * 拉:找过路以后(paths),lo–hi 州远(不到 lo 州的值打折,最近 floor 州)、有城、不是本族的地方里"值"最高的那一州:
   * 值 = 地好 × 守得弱 × 远近的折扣 × 大国腹地(见文件头)。bigDone = 这个世界已经有一支打进过大国国都。没有 = target −1。
   * out = 各候选州的值(测试用;不给不记);dir = 只看走过去整条路线朝这个方位的州(trekDir;照大纲下的令才有)
   */
  const bestTarget = (c: number, t: number, lo: number, hi: number, floor: number, bigDone: boolean, out?: Map<number, number>, dir?: MigrationDir) => {
    let target = -1;
    let pull = 0;
    let why: Migration['pull'] = 'rich';
    for (let r = 0; r < R; r++) {
      const h = hops[r];
      if (h < floor || h > hi || culture[r] < 0 || culture[r] === c || pm.cityOf[r] < 0) continue;
      const o = owner[r];
      if (o >= 0 && pm.polities[o].culture === c) continue;
      if (o < 0 && pm.closed?.(r, -1, t)) continue;
      if (wm.iv?.locked(r, t)) continue;
      if (dir !== undefined && trekDir(tm.geo, trekRouteTo(P, r).map((x) => reg.seat[x])) !== dir) continue;
      const good = Math.min(GOOD_MAX, Math.sqrt(cityPop(r, t) / POP_REF));
      const wk = weakness(o, t);
      let v = good * wk.v * (h >= lo ? fexp(-(h - lo) / HOPS_FADE) : fexp(-(lo - h) / SHORT_FADE));
      // 大国的腹地(离国都近):冲着国都去(这个世界已经有一支打进过大国国都的,大国的地打 LATE_BIG 折,腹地不另加)
      if (o >= 0 && pm.size[o] >= BIG) {
        const d = pm.capDist[o][r];
        if (bigDone) v *= LATE_BIG;
        else if (d < Infinity) v *= 1 + HEART_W * fexp(-d / HEART_REACH);
      }
      out?.set(r, v);
      if (v > pull || (v === pull && target >= 0 && reg.seat[r] < reg.seat[target])) {
        pull = v;
        target = r;
        why = wk.why;
      }
    }
    return { target, pull, why };
  };

  // ---- 看大迁徙 ----
  sim.on(Ev.TrekCheck, (k, _b, t) => {
    sim.schedule(checkTime(tm, k + 1), Ev.TrekCheck, k + 1, 0);
    if (list.length >= MAX) return;
    let live = 0;
    for (const M of list) if (M.settled === undefined) live++;
    if (live >= LIVE) return;
    // 各民族的州、有城的州、闹过饥荒的城、乡村人口挤不挤、本族的国近年散了没有
    const st = folkStats(t);
    const n = st.n;
    const cands: { c: number; score: number; target: number; push: Migration['push']; pull: Migration['pull'] }[] = [];
    // 这个世界已经有一支打进过大国国都:大国的地吸引力小一些,腹地不再格外招人
    const bigDone = list.some((M) => M.big);
    for (let c = 0; c < cultures.length; c++) {
      const C = cultures[c];
      if (C.ended !== undefined || n[c] < MIN_FOLK || !trekFolk(C, reg.biome)) continue;
      if (list.some((M) => M.culture === c && t - M.year < GAP)) continue;
      // 作者下令不许这一族迁(干预 stay)
      if (wm.iv?.stays(c, t, cultures)) continue;
      const { push, why: pw } = pushOf(st, c);
      // 拉:走得到的地方里"值"最高的那一州
      paths(c);
      const { target, pull, why } = bestTarget(c, t, HOPS_MIN, HOPS_MAX, HOPS_FLOOR, bigDone);
      if (target < 0) continue;
      cands.push({ c, score: (PUSH_0 + push) * pull, target, push: pw, pull: why });
    }
    if (!cands.length) return;
    // 走不走:各族各掷一次(按发源州取随机数,和别的民族无关);天下久无大迁徙(比每 PACE_YEARS 年一次落后几次)赔率再加。
    // 中了的按发源州的先后,一次看最多走一支
    const behind = Math.max(0, (t - CHECK_FIRST) / PACE_YEARS - list.length);
    cands.sort((a, b) => folkTag(a.c) - folkTag(b.c));
    for (const x of cands) {
      const odds = ODDS * (x.score / (x.score + HALF)) * (1 + PACE_W * behind);
      if (keyed(tm.base, k, folkTag(x.c), U_GO) >= odds / (1 + odds)) continue;
      paths(x.c);
      depart(x.c, x.target, x.push, x.pull, n[x.c], t);
      break;
    }
  });

  /** 民族 c 分出一支,往 target 那州去(先找好路:paths);iv = 作者下令的第几条干预。走不成(路线不到两州)= false */
  const depart = (c: number, target: number, push: Migration['push'], pull: Migration['pull'], folk: number, t: number, iv?: number): boolean => {
    const route = trekRouteTo(P, target);
    if (route.length < 2) return false;
    const m = list.length;
    const M: Migration = {
      culture: c,
      year: t,
      route,
      years: [t],
      dir: trekDir(tm.geo, route.map((r) => reg.seat[r])),
      size: Math.max(SIZE_MIN, Math.min(SIZE_MAX, Math.round(SHARE * folk))),
      push,
      pull,
      target: owner[target],
    };
    if (iv !== undefined) M.iv = iv;
    list.push(M);
    const tag = trekTag(m);
    for (let j = 1; j < route.length; j++) {
      let kind: number = AdjKind.Flat;
      for (let e = reg.adjStart[route[j - 1]]; e < reg.adjStart[route[j - 1] + 1]; e++) if (reg.adj[e] === route[j]) kind = reg.adjKind[e];
      const y = trekPace(reg, route[j], kind) * (1 - STEP_JITTER + 2 * STEP_JITTER * keyed4(tm.base, tag, reg.seat[route[j]], j, U_STEP));
      M.years.push(Math.max(quantize(M.years[j - 1] + y), M.years[j - 1] + 1 / 256));
    }
    sim.record('trek', { a: c, b: M.target, region: route[0], war: m, n: 0 });
    for (let j = 1; j < route.length; j++) sim.schedule(M.years[j], Ev.TrekStep, m, j);
    return true;
  };

  // ---- 作者下令(干预 trek):这一刻从这一族分出一支,往指定的州 / 推演挑的地方去 ----
  tm.order = (v, i, t, iv) => {
    const c = iv.resolveCulture(v.folk, cultures);
    if (c < 0) return; // 键指不到:新历史里没有这一族(或那一刻还没分化出来)
    const st = folkStats(t);
    const note = (b: number, region = -1, settlement = -1) => sim.record('intervene', { a: -1, b, region, settlement, war: i, n: c });
    if (cultures[c].ended !== undefined || st.n[c] <= 0) return note(-3);
    // 从哪一州出发:作者给的那一州那一刻还是这一族的就从它走,不然从本族离目的地最近的一州走
    const r0 = v.region !== undefined ? regionOfKey(v.region, iv.of) : -1;
    const start = r0 >= 0 && r0 < R && culture[r0] === c ? r0 : -1;
    let target = -1;
    let pull: Migration['pull'] = 'rich';
    if (v.to !== undefined) {
      const r1 = regionOfKey(v.to, iv.of);
      if (r1 >= 0 && r1 < R) {
        paths(c, start, Infinity);
        if (P.hops[r1] > 0) {
          target = r1;
          pull = weakness(owner[r1], t).why;
        }
      }
    } else if (v.dir !== undefined) {
      // 往某个方位(照大纲下的令):那一档没有这个方位上的地方,依次放宽到中、近、远里别的几档
      const first: TrekReach = v.reach ?? 'mid';
      for (const reach of [first, ...TREK_ORDER.filter((x) => x !== first)] as TrekReach[]) {
        const best = tm.pick!(c, t, reach, start, undefined, TREK_DIR_NAMES[v.dir]);
        if (best.target < 0) continue;
        target = best.target;
        pull = best.why;
        break;
      }
    } else {
      const best = tm.pick!(c, t, v.reach ?? 'mid', start);
      target = best.target;
      pull = best.why;
    }
    if (target < 0) return note(IV_NO_WAY, start);
    note(-1, target, pm.cityOf[target]);
    depart(c, target, pushOf(st, c).why, pull, st.n[c], t, i);
  };
  tm.pick = (c, t, reach, start, out, dir) => {
    const [lo, hi, floor] = REACH[reach];
    paths(c, start, hi);
    const best = bestTarget(c, t, lo, hi, floor, list.some((M) => M.big), out, dir);
    return { target: best.target, why: best.why, hops: best.target >= 0 ? P.hops[best.target] : -1 };
  };

  // ---- 队伍走到下一州 ----
  sim.on(Ev.TrekStep, (m, j, t) => {
    const M = list[m];
    if (!M || M.settled !== undefined) return;
    if (j < M.route.length - 1) raid(M, m, j, t);
    else arrive(M, m, t);
  });

  /** 路过第 j 州:可能洗劫那里的城 */
  const raid = (M: Migration, m: number, j: number, t: number) => {
    const r = M.route[j];
    if (r >= R) return;
    const sid = pm.cityOf[r];
    if (sid < 0 || culture[r] < 0 || culture[r] === M.culture) return;
    const s = pm.settlements[sid];
    if (s.ended !== undefined || !(t >= s.founded)) return;
    const o = owner[r];
    if (o >= 0 && pm.polities[o].culture === M.culture) return;
    const tag = trekTag(m);
    if (keyed4(tm.base, tag, reg.seat[r], j, U_RAID) >= RAID_P * (o < 0 ? RAID_TRIBAL : 1)) return;
    const loss = RAID_LOSS[0] + (RAID_LOSS[1] - RAID_LOSS[0]) * keyed4(tm.base, tag, reg.seat[r], j, U_LOSS);
    (s.sacks ??= []).push({ year: t, loss: Math.round(loss * 1000) / 1000 });
    sim.record('trek', { a: M.culture, b: o, region: r, settlement: sid, war: m, n: 1 });
  };

  /** 能占的州:有人住、不是本族的国的、那州的主人(y)或部落地带的、不是国都、不是永久划给别国的州、不是中立地 */
  const capitals = new Uint8Array(R);
  const open = (r: number, y: number, c: number, t: number): boolean => {
    if (r >= R || culture[r] < 0 || capitals[r] || wm.iv?.locked(r, t)) return false;
    const o = owner[r];
    if (o >= 0 ? o !== y || pm.polities[o].culture === c : pm.closed?.(r, -1, t)) return false;
    return true;
  };

  /** 落脚:占几州立国,和那里的国家开战 */
  const arrive = (M: Migration, m: number, t: number) => {
    const c = M.culture;
    const dest = M.route[M.route.length - 1];
    M.settled = t;
    const scatter = (lands: number[]) => {
      M.outcome = 'rout';
      M.outcomeYear = t;
      if (lands.length) M.lands = lands.slice().sort((a, b) => a - b);
      sim.record('trek', { a: c, b: -1, region: dest < R ? dest : -1, war: m, n: 4 });
    };
    if (cultures[c].ended !== undefined || dest >= R) return scatter([]);
    capitals.fill(0);
    for (const P of pm.polities) if (P.ended === undefined) capitals[pm.settlements[capitalAt(P, t)].region] = 1;
    const y = owner[dest];
    // 从落脚的那州往外长(陆路;有城的先,近的先)
    const tag = trekTag(m);
    const picked: number[] = [];
    const seen = new Set<number>([dest]);
    const front: [number, number][] = [];
    const add = (r: number, cost: number) => {
      front.push([r, cost + (pm.cityOf[r] < 0 ? 0.6 : 0) + 0.3 * keyed4(tm.base, tag, reg.seat[r], 0, U_GROW)]);
    };
    if (open(dest, y, c, t)) add(dest, 0);
    else {
      for (let e = reg.adjStart[dest]; e < reg.adjStart[dest + 1]; e++) {
        const j = reg.adj[e];
        if (!seen.has(j) && land(reg.adjKind[e]) && open(j, y, c, t)) {
          seen.add(j);
          add(j, 1);
        }
      }
    }
    while (front.length && picked.length < M.size) {
      let bi = 0;
      for (let i = 1; i < front.length; i++) if (front[i][1] < front[bi][1] || (front[i][1] === front[bi][1] && reg.seat[front[i][0]] < reg.seat[front[bi][0]])) bi = i;
      const [r, cost] = front.splice(bi, 1)[0];
      picked.push(r);
      for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
        const j = reg.adj[e];
        if (seen.has(j) || !land(reg.adjKind[e]) || !open(j, y, c, t)) continue;
        seen.add(j);
        add(j, Math.floor(cost) + 1);
      }
    }
    if (!picked.length) return scatter([]);
    // 都城:人口最多的城;落脚的几州改换成迁来的民族(刚改换过的、原民族的最后一州除外)
    const sid = pol.biggestCity?.(picked, t) ?? -1;
    const settledIn = picked.filter((r) => changeFolk(r, c, t));
    if (sid < 0) return scatter(settledIn);
    const capR = pm.settlements[sid].region;
    // 落脚那州的主人原来有几州(占走几州以前)
    const ySize = y >= 0 ? pm.size[y] : 0;
    const P = addPolity(pm, sid, c, t, { trek: m });
    sim.setOwner(Layer.Polity, capR, P.id, Ev.Split);
    for (const r of picked) if (r !== capR) sim.setOwner(Layer.Polity, r, P.id, Ev.Split);
    sim.record('trek', { a: c, b: P.id, region: dest, settlement: sid, war: m, n: 2 });
    sim.record('found', { a: P.id, region: capR, settlement: sid, cause: 'trek' });
    M.polity = P.id;
    M.outcome = 'found';
    M.outcomeYear = t;
    M.lands = settledIn.sort((a, b) => a - b);
    // 和那里的国家开战:落脚那州的主人;部落地带的,和接壤的、动身时冲着的那国,不接壤就挑接壤最长的那国
    let foe = y >= 0 && pm.polities[y].ended === undefined && polityBorders(pm, owner, P.id, y, t) ? y : -1;
    if (foe < 0) {
      const tg = M.target;
      if (tg >= 0 && pm.polities[tg].ended === undefined && pm.polities[tg].culture !== c && polityBorders(pm, owner, P.id, tg, t)) foe = tg;
      else {
        const border = new Map<number, number>();
        for (const r of pm.lands[P.id]) {
          for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
            const q = owner[reg.adj[e]];
            if (q < 0 || q === P.id || !land(reg.adjKind[e]) || pm.polities[q].culture === c) continue;
            border.set(q, (border.get(q) ?? 0) + reg.adjBorder[e]);
          }
        }
        let most = 0;
        for (const [q, b] of border) if (b > most || (b === most && foe >= 0 && pm.ptag[q] < pm.ptag[foe])) [foe, most] = [q, b];
      }
    }
    if (foe >= 0 && !wm.iv?.halted(P.id, t)) {
      M.foeSize = foe === y ? ySize : pm.size[foe];
      const w = wm.declare!(P.id, foe, t, -1, 'trek');
      M.war = w.id;
      tm.wars.set(w.id, m);
    }
  };

  // ---- 到了以后那一仗:士气、像讨伐民变那样打、打进国都 ----
  /** 战争 w 是不是迁来的一支到了以后开的那一仗(迁来的国是攻方 w.a) */
  const trekOf = (w: War): Migration | undefined => {
    const m = tm.wars.get(w.id);
    return m === undefined ? undefined : list[m];
  };
  const prevMorale = wm.morale;
  wm.morale = (w, x, t) => {
    const base = prevMorale ? prevMorale(w, x, t) : 1;
    if (!trekOf(w)) return base;
    if (x !== w.a) return base * COURT;
    let since = w.start;
    for (let i = w.takes.length - 1; i >= 0; i--) {
      if (w.takes[i].by === x) {
        since = w.takes[i].year;
        break;
      }
    }
    return base * (1 + (MORALE - 1) * fexp(-(t - since) / FADE));
  };
  const prevRevolt = wm.revolt;
  wm.revolt = (w) => !!trekOf(w) || (prevRevolt?.(w) ?? false);
  const prevOverthrow = wm.overthrow;
  wm.overthrow = (w, x, y, t) => {
    if (prevOverthrow?.(w, x, y, t)) return true;
    const M = trekOf(w);
    // 比它小的国家:亡国、余下的州一并归迁来的国(pm.size 已经不算刚丢的国都)
    return !!M && x === w.a && y === w.b && small(x, y);
  };
  /** 丢了国都的 y 比迁来的 x 小(不到 x 的 SMALL_K 倍,或者不到 SMALL_MIN 州) */
  const small = (x: number, y: number) => pm.size[y] + 1 <= Math.max(SMALL_MIN, SMALL_K * pm.size[x]);
  wm.storm = (w, x, y, r, t) => {
    const M = trekOf(w);
    if (!M || x !== w.a || y !== w.b || small(x, y)) return false;
    if (wm.iv?.holdsLock(y, t)) return false;
    // 丢国都以前还有 BIG 州的大国,本来就乱的多半当即大崩解(SHATTER_0 + SHATTER_U × 动荡 的机会)
    const Yu = pol.unrest?.(pm.polities[y], t) ?? 0;
    const shatter = pm.size[y] + 1 >= BIG && !wm.iv?.unites(y, t) && keyed(tm.base, pm.ptag[y], w.id, U_SHATTER) < SHATTER_0 + SHATTER_U * Math.max(0, Yu);
    const Y = pm.polities[y];
    const oldSid = pm.cityOf[r];
    // 迁来的一方占着国都一带:从国都往外(陆路),那国国土的 GRAB_FRAC
    const want = Math.max(GRAB_MIN, Math.min(GRAB_MAX, Math.round(GRAB_FRAC * (pm.size[y] + 1))));
    const got: number[] = [];
    const seen = new Set<number>([r]);
    let ring = [r];
    while (ring.length && got.length < want) {
      const next: number[] = [];
      for (const q of ring) {
        for (let e = reg.adjStart[q]; e < reg.adjStart[q + 1]; e++) {
          const j = reg.adj[e];
          if (seen.has(j) || !land(reg.adjKind[e]) || owner[j] !== y || wm.iv?.locked(j, t)) continue;
          seen.add(j);
          next.push(j);
        }
      }
      next.sort((a, b) => reg.seat[a] - reg.seat[b]);
      for (const j of next) {
        if (got.length >= want || pm.size[y] <= GRAB_MIN + 2) break;
        sim.setOwner(Layer.Polity, j, x, Ev.Conquer);
        got.push(j);
      }
      ring = next;
    }
    /** 占下国都一带的那几州记成这一仗的攻占(记在那国迁都后面:迁都紧跟着丢国都的那条攻占) */
    const note = () => {
      for (const j of got) {
        sim.record('conquer', { a: x, b: y, region: j, settlement: pm.cityOf[j], war: w.id });
        w.takes.push({ year: t, region: j, by: x });
      }
    };
    // 那国迁都(剩下的州里挑);一座城都没有 = 照常办(并掉残部)
    const sid = bestCapital(pm, owner, y, t, true);
    if (sid < 0) {
      note();
      return false;
    }
    moveCapital(pm, y, sid, t);
    sim.record('capital', { a: y, region: pm.settlements[sid].region, settlement: sid, war: w.id });
    note();
    sim.record('trek', { a: M.culture, b: y, region: r, settlement: oldSid, war: tm.wars.get(w.id)!, n: 3 });
    M.outcome = 'conquer';
    M.outcomeYear = t;
    M.stormed = y;
    if ((M.foeSize ?? 0) >= BIG) M.big = true;
    wm.makePeace!(w, t);
    if (shatter) pol.shatter?.(Y, SHATTER_K + w.id, t);
    return true;
  };
  const prevFall = wm.onFall;
  wm.onFall = (w, x, y, t) => {
    prevFall?.(w, x, y, t);
    const M = trekOf(w);
    if (!M) return;
    if (y === w.a) {
      // 迁来的国亡于这一仗:败散,落脚的几州留下一块异族
      M.outcome = 'rout';
      M.outcomeYear = t;
    } else if (y === w.b && x === w.a) {
      M.outcome = 'conquer';
      M.outcomeYear = t;
      M.stormed = y;
      if ((M.foeSize ?? 0) >= BIG) M.big = true;
    }
  };
}

/**
 * 由 Civ 重建大迁徙的推演状态(CivSim.fromCiv 调用,在 resumeTreaties 之后):
 * 每一次的经过从 Civ.migrations 复制一份;还在路上的补上没走完的几步(动身那一刻预约的);再算出下一次看大迁徙,补进引擎。
 */
export function resumeMigration(sim: CivSim, world: World, civ: Civ): void {
  const pm = polityModelOf(sim);
  const wm = warModelOf(sim);
  const pol = politicsModelOf(sim);
  if (!pm || !wm || !pol) return;
  const list = copyMigrations(civ.migrations ?? []);
  const tm = newModel(pm, wm, pol, world, list);
  list.forEach((M, m) => {
    if (M.war !== undefined) tm.wars.set(M.war, m);
  });
  hook(sim, tm);
  const now = sim.now;
  let k = 0;
  while (quantize(checkTime(tm, k)) <= now) k++;
  // 一口气推时上一次看大迁徙那一刻预约的(第一次是开头)
  sim.schedule(checkTime(tm, k), Ev.TrekCheck, k, 0, bookChain(k, (j) => checkTime(tm, j), BOOKED_AT_START));
  /** 动身那一刻是第几次看大迁徙 */
  const checkOf = (y: Year) => {
    let k = 0;
    while (quantize(checkTime(tm, k)) < y) k++;
    return k;
  };
  list.forEach((M, m) => {
    if (M.settled !== undefined) return;
    // 动身那一刻一起预约的(那一刻的看大迁徙又是上一次看的那一刻预约的;作者下令的:那一刻的干预事件是装各层时就预约的)
    const chain =
      M.iv !== undefined
        ? [quantize(M.year), BOOKED_AT_START]
        : [quantize(M.year), ...bookChain(checkOf(M.year), (j) => checkTime(tm, j), BOOKED_AT_START)].slice(0, 3);
    for (let j = 1; j < M.route.length; j++) if (M.years[j] > now) sim.schedule(M.years[j], Ev.TrekStep, m, j, chain);
  });
}

// ---------------------------------------------------------------------------
// 统计(调参、单测用)

export interface TrekStats {
  /** 大迁徙几次;还在路上的;立了国的;入主的(打进国都);其中打进大国国都(Migration.big)的;败散的 */
  treks: number;
  onRoad: number;
  founded: number;
  conquered: number;
  stormedBig: number;
  routed: number;
  /** 同时在路上最多几支 */
  maxLive: number;
  /** 路上洗劫了几座城;一次平均走几州、几年 */
  raids: number;
  meanHops: number;
  meanYears: number;
}

export function trekStats(civ: Civ): TrekStats {
  const L = civ.migrations ?? [];
  const out: TrekStats = { treks: L.length, onRoad: 0, founded: 0, conquered: 0, stormedBig: 0, routed: 0, maxLive: 0, raids: 0, meanHops: 0, meanYears: 0 };
  const edges: [number, number][] = [];
  for (const M of L) {
    if (M.settled === undefined) out.onRoad++;
    if (M.polity !== undefined) out.founded++;
    if (M.outcome === 'conquer') out.conquered++;
    if (M.outcome === 'rout') out.routed++;
    out.meanHops += M.route.length - 1;
    out.meanYears += M.years[M.years.length - 1] - M.year;
    edges.push([M.year, 1], [M.settled ?? Infinity, -1]);
  }
  if (L.length) {
    out.meanHops /= L.length;
    out.meanYears /= L.length;
  }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0;
  for (const [, d] of edges) out.maxLive = Math.max(out.maxLive, (live += d));
  for (const M of L) if (M.big) out.stormedBig++;
  for (const e of civ.annals) if (e.kind === 'trek' && e.n === 1) out.raids++;
  return out;
}

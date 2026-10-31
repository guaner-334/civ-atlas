/**
 * 邦交:称臣纳贡(藩属)、结盟、背盟。挂在同一个推演引擎(sim.ts)上;只记史事、改规则,不改归属
 * (宗主收藩属的国土走合并,原因 Ev.Merge,和 politics.ts 的合并一样)。
 *
 * 流程(index.ts 在 installCities 之后调用 installDiplomacy):
 *
 *   看邦交(Ev.DiplomacyCheck)每个国家立国 DIP_FIRST 年后,每 DIP_EVERY 年看一眼(每段里随机一个时刻),一次最多出一件事,依次看:
 *   ① 藩属:看要不要自立(不再称臣纳贡)。宗主虚弱(在打仗、刚丢了国都 / 迁都、刚改朝换代、刚分裂、接连丢州)、
 *        藩属的国力追上来了、两国已不接壤(鞭长莫及)、异族,自立的机会都更大。藩属不另外结盟、不收别国称臣。
 *        自立以后宗主多半发兵讨伐(PUNISH;史事 war 的 cause = punish)。
 *   ② 宗主:称臣久了的小藩属(接壤、两边都没在打仗;异族的机会小些),有机会纳土归附(记 merge,cause = vassal;编年史写"纳土归附")。
 *   ③ 盟约:共御的强邻已经亡了、或已不比盟国强,盟约渐废(unally,cause = lapse)。
 *   ④ 畏强邻(接壤、国力是自己 THREAT 倍以上的邻国;正在交兵的也算):
 *        小国、弱国先看要不要遣使称臣(国力差 SUBMIT_RATIO 倍以上,强邻越好战越可能;正和强邻的藩属交兵的不称臣);
 *        不称臣就找也受它威胁的国家结盟(和强邻接壤、没在和自己打、各自盟国不到 MAX_PACTS 个),正同在和它交兵的最容易结成。
 *        国家方针(policy.ts):不和仇国结盟(哪一方把对方当仇都不结),亲国的分数 × FRIEND_PACT(先找它)。
 *   ⑤ 称臣、结盟都没成(或者没有强邻):看要不要和邻国立约(treaties.ts 挂上的 onCheck;约国之间也算友好,见 friendly)。
 *
 *   战争里(wars.ts 调这里挂上的回调):
 *   - 宣战时(接口 war.onDeclare):守方的盟国(和攻方接壤、没在和攻方打、手上的仗没打满)有 PACT_JOIN 的机会援盟参战,
 *     不来就是坐视不救,盟约就此断了(unally,cause = abandon);守方的宗主(和攻方接壤)有 RESCUE 的机会发兵来救。
 *     盟国的方针把守方当亲国的,援盟的机会是 FRIEND_JOIN;当仇国的不救(盟约断了);把攻方当亲国的不出兵(policy.ts)。
 *     援盟、救藩参战的不再连锁。
 *   联姻(marriage.ts):看邦交时先看要不要结亲(不占"一次最多出一件事");结着亲的两国挑盟友时分数 × KIN_PACT、援盟的机会 × KIN_JOIN
 *     (都随结亲的年数淡回,见 marriages.ts 的 bond)。
 *   - 每一仗之后(接口 war.sue):守方打得很惨(丢了国都,或丢了 SUE_FRAC 以上国土)、攻方国力是它 SUE_RATIO 倍以上
 *     (守方在位的君主好战越低越肯称臣、越高越宁可打下去,rulers.ts),
 *     守方可能奉表称臣、攻方受降罢兵:当即议和(占了的州照旧归攻方),紧跟着记 submit(守方正和攻方的藩属交兵时不受降)。异族、攻方另有战事、离攻方国都远,攻方更肯受降。
 *   - 看邻国(wars.ts):不打盟国、自己的宗主 / 藩属、同一个宗主的藩属;结盟满 BETRAY_AGE 年、共御的强邻已不足为患的盟国,
 *     可以背盟去打(赔率 × BETRAY_ODDS;先记 unally,cause = betray,再记 war)。
 *
 * 关系怎么断(界面按史事推出某一年的关系,见 relationsAt;推演里同一套规则):
 *   盟约:unally(lapse / abandon / betray / vassal),或任一方亡国 / 被并。一国称臣时,它的盟约随之作废(unally,cause = vassal)。
 *   藩属:defect(自立),或宗主 / 藩属亡国、被并(藩属纳土归附也是被并)。
 *
 * 阶段 4 干预:作者下令的结盟(iv.allied)不在这里,不会背盟、不会渐废,下令结了盟的两国也不讨伐;不许扩张的国家不收别国称臣、不援盟、不讨伐;
 *   不许灭的国家照样可以称臣(称臣不灭国),但不会被纳土归附(和合并一样)。
 *   作者下令盟国、宗藩之间开战:宣战前盟约、宗藩之分就此断了(接口 diplomacy.sever;盟国记 unally,cause = betray;
 *   藩属打宗主记 defect,宗主打藩属记 defect,cause = betray;同一个宗主的两个藩属,攻方先自立,记 defect)。
 *
 * **不存内存状态**:结着的盟 = 史事 alliance 减去 unally;藩属 = submit 减去 defect;盟约断过的年份 = unally;
 *   看邦交的时刻由"国家 + 第几次"算出来(resumeDiplomacy)。
 *
 * 随机数:keyed(subSeed(seed, 'civ-diplomacy'), 国家…, 第几次, 用途);国家一律用位置锚(PolityModel.ptag)。纯计算,不碰 DOM。
 */
import type { World } from '../world';
import { YEAR_TICKS, resolveKey } from '../edits';
import { Layer, type Annal, type Civ, type Year } from './types';
import { fpow, keyed, keyed4, subSeed } from './engine/rand';
import { bookChain, quantize, type CivSim } from './engine/sim';
import { befriends, canCross, effOf, endPolity, hates, picks, policyAt, polityModelOf, powerScaleOf, type PolityModel } from './polities';
import { FRIEND_JOIN, FRIEND_PACT } from './policy';
import { KIN_JOIN, KIN_PACT } from './marriages';
import { polityBorders, warModelOf, type War, type WarModel } from './wars';
import { capitalAt, polityAlive, populationAt } from './growth';
import { politicsModelOf } from './politics';
import type { CivModule } from './modules';
import { Ev } from './events';
import { civApi, type DiplomacyApi } from './api';
import { defineKnobs } from './engine/knobs';

// ---- 调参(以截图和统计数为准,见 scripts/gen-stats.ts) ----
/** 这一段的旋钮(名字、默认值;推演照 values 里的数算) */
export const DIPLOMACY_KNOBS = defineKnobs('diplomacy', {
  /** 立国后多少年开始看邦交;之后每隔多少年看一次(每段里 20%–80% 处随机一个时刻) */
  DIP_FIRST: 50,
  DIP_EVERY: 40,
  /** 强邻:国力是自己的这么多倍以上(正在交兵的不论强弱都算) */
  THREAT: 1.5,
  /** 称臣:强邻国力是自己的这么多倍以上、自己不超过这么多州才考虑;赔率 × (倍数 ÷ SUBMIT_RATIO)^SUBMIT_EXP × 强邻的扩张性 */
  SUBMIT_RATIO: 4,
  SUBMIT_MAX: 30,
  SUBMIT_ODDS: 0.12,
  SUBMIT_EXP: 0.5,
  /** 自立以后这么多年内不再向同一个宗主主动称臣 */
  RESUBMIT_REST: 80,
  /** 结盟:一国最多同时结几个盟;盟国至少要有强邻的几成国力(不然帮不上);两国盟约断了以后多少年内不再结盟 */
  MAX_PACTS: 2,
  PACT_MIN_POWER: 0.25,
  PACT_REST: 100,
  /** 结盟的赔率;对方也受这个强邻威胁(强邻国力是它的 PACT_FEAR 倍以上)才肯结;正同在和强邻交兵 × PACT_COWAR */
  PACT_ODDS: 0.35,
  PACT_FEAR: 0.9,
  PACT_COWAR: 3,
  /** 盟约渐废:结盟满这么多年,共御的强邻已亡、或国力已不到两国中较强一方的 LAPSE_RATIO 倍;那时废掉的机会 */
  LAPSE_AGE: 60,
  LAPSE_RATIO: 1,
  LAPSE_P: 0.35,
  /**
   * 背盟:结盟满这么多年,而且共御的强邻已不足为患(亡了,或国力不如自己)、或者盟国已弱到自己的 1 / BETRAY_PREY 以下(有利可图),
   * 才可能去打盟国;宣战赔率 × BETRAY_ODDS
   */
  BETRAY_AGE: 30,
  BETRAY_PREY: 2.5,
  BETRAY_ODDS: 0.5,
  /** 援盟:盟国被宣战时来援的机会(不来 = 坐视不救,盟约断);宗主发兵救藩属的机会 */
  PACT_JOIN: 0.7,
  RESCUE: 0.75,
  /** 战败称臣:攻方国力是守方的这么多倍以上;守方丢了国都、或丢了这么多成国土(至少 SUE_MIN 州)算打得很惨 */
  SUE_RATIO: 2,
  SUE_FRAC: 0.3,
  SUE_MIN: 2,
  /**
   * 打得很惨时守方求和称臣的机会 × 攻方受降的机会(异族 × SUE_FOREIGN,同族 × SUE_KIN;攻方另有战事、守方国都离攻方国都远各 × 1.4;
   * 攻方国力是守方 SUE_CRUSH 倍以上的同族之战 × SUE_UNIFY:一心要并掉同族小国,多半不受降)
   */
  SUE_OFFER: 0.3,
  SUE_ACCEPT: 0.45,
  SUE_FOREIGN: 1.5,
  SUE_KIN: 0.7,
  SUE_CRUSH: 3,
  SUE_UNIFY: 0.35,
  /** 守方国都离攻方国都的路程(标准路程)超过这么多算"远" */
  SUE_FAR: 14,
  /** 守方只剩这么多州(含)以下的,攻方索性并掉,不受降 */
  SUE_LEFT: 4,
  /** 藩属自立:称臣满这么多年才会;赔率 = DEFECT_ODDS × 宗主的虚弱 × e^(DEFECT_K × (国力比 − DEFECT_R0)) × 不接壤 × 异族 */
  DEFECT_MIN: 30,
  DEFECT_ODDS: 0.04,
  DEFECT_K: 4,
  DEFECT_R0: 0.25,
  DEFECT_FAR: 2.5,
  DEFECT_FOREIGN: 1.3,
  /** 宗主的虚弱 = 1 + 在打仗 + 这么多年内丢了国都 / 迁都、改朝换代、分裂过 + 接连丢州(各 + 1) */
  WEAK_YEARS: 30,
  WEAK_LOSS: 2,
  /** 藩属自立后宗主发兵讨伐的机会 */
  PUNISH: 0.6,
  /** 纳土归附:称臣满这么多年、藩属不超过这么多州、宗主至少是它这么多倍大;赔率(异族 × ABSORB_FOREIGN) */
  ABSORB_AGE: 100,
  ABSORB_MAX: 14,
  ABSORB_RATIO: 2.5,
  ABSORB_ODDS: 0.25,
  ABSORB_FOREIGN: 0.4,
  /** 归附的州要这么多年没换过国家(和合并一样) */
  ABSORB_SETTLE: 30,
  /** 一国最多同时打几场仗(和 wars.ts 的 MAX_WARS 一样):手上的仗打满了的不来援盟,不算坐视不救 */
  MAX_WARS: 2,
});
const { DIP_FIRST, DIP_EVERY, THREAT, SUBMIT_RATIO, SUBMIT_MAX, SUBMIT_ODDS, SUBMIT_EXP, RESUBMIT_REST, MAX_PACTS, PACT_MIN_POWER, PACT_REST, PACT_ODDS, PACT_FEAR, PACT_COWAR, LAPSE_AGE, LAPSE_RATIO, LAPSE_P, BETRAY_AGE, BETRAY_PREY, BETRAY_ODDS, PACT_JOIN, RESCUE, SUE_RATIO, SUE_FRAC, SUE_MIN, SUE_OFFER, SUE_ACCEPT, SUE_FOREIGN, SUE_KIN, SUE_CRUSH, SUE_UNIFY, SUE_FAR, SUE_LEFT, DEFECT_MIN, DEFECT_ODDS, DEFECT_K, DEFECT_R0, DEFECT_FAR, DEFECT_FOREIGN, WEAK_YEARS, WEAK_LOSS, PUNISH, ABSORB_AGE, ABSORB_MAX, ABSORB_RATIO, ABSORB_ODDS, ABSORB_FOREIGN, ABSORB_SETTLE, MAX_WARS } = DIPLOMACY_KNOBS.values;










// 随机数用途编号
const U_CHECK_T = 1;
const U_DEFECT = 2;
const U_ABSORB = 3;
const U_LAPSE = 4;
const U_SUBMIT = 5;
const U_PACT = 6;
const U_JOIN = 7;
const U_RESCUE = 8;
const U_PUNISH = 9;
const U_SUE = 10;

// ---------------------------------------------------------------------------
// 模型

/** 一个盟约(自然结成的;作者下令的结盟在干预模型里) */
export interface Pact {
  a: number;
  b: number;
  /** 结盟的年份 */
  since: Year;
  /** 共御的强邻(−1 = 没有) */
  foe: number;
}

const pairKey = (a: number, b: number) => Math.min(a, b) * 32768 + Math.max(a, b);

export class DiplomacyModel {
  readonly pm: PolityModel;
  readonly base: number;
  /** 结着的盟 */
  pacts: Pact[] = [];
  /** 藩属 → 宗主 */
  readonly liege = new Map<number, number>();
  /** 藩属 → 称臣的年份 */
  readonly sworn = new Map<number, Year>();
  /** 国家 → 最近一次自立(不再称臣)时的宗主、年份 */
  readonly defected = new Map<number, { liege: number; year: Year }>();
  /** 两国最近一次盟约断了的年份(键见 pairKey) */
  readonly broken = new Map<number, Year>();
  /** 看邻国挑中盟国时,宣战赔率 × 这么多(wars.ts) */
  readonly betrayOdds = BETRAY_ODDS;

  /** 具名接口表的邦交那一组(friendly 要问立约那边的 bound);单独建模型时是空的 */
  readonly api: DiplomacyApi;

  constructor(pm: PolityModel, api: DiplomacyApi = {}) {
    this.pm = pm;
    this.api = api;
    this.base = subSeed(pm.seed, 'civ-diplomacy');
  }

  private alive(p: number): boolean {
    return p >= 0 && this.pm.polities[p]?.ended === undefined;
  }

  /** 国家 p 此刻的宗主(不是藩属、或宗主已亡 = −1) */
  liegeOf(p: number): number {
    const l = this.liege.get(p);
    return l !== undefined && this.alive(l) && this.alive(p) ? l : -1;
  }

  /** 国家 p 此刻的藩属(编号升序) */
  vassalsOf(p: number): number[] {
    const out: number[] = [];
    for (const [v, l] of this.liege) if (l === p && this.alive(v) && this.alive(l)) out.push(v);
    return out.sort((x, y) => x - y);
  }

  /** p、q 之间结着的盟(没有 = undefined) */
  pactOf(p: number, q: number): Pact | undefined {
    if (!this.alive(p) || !this.alive(q)) return undefined;
    return this.pacts.find((x) => (x.a === p && x.b === q) || (x.a === q && x.b === p));
  }

  /** 此刻和 p 结着盟的国家(编号升序) */
  alliesOf(p: number): number[] {
    if (!this.alive(p)) return [];
    const out: number[] = [];
    for (const x of this.pacts) {
      const o = x.a === p ? x.b : x.b === p ? x.a : -1;
      if (o >= 0 && this.alive(o)) out.push(o);
    }
    return out.sort((x, y) => x - y);
  }

  /** p 此刻结着的盟(对方还在) */
  pactsOf(p: number): Pact[] {
    return this.pacts.filter((x) => (x.a === p || x.b === p) && this.alive(x.a) && this.alive(x.b));
  }

  /** 两国此刻有宗藩之分(一方是另一方的藩属),或同是一国的藩属 */
  vassalTie(p: number, q: number): boolean {
    const lp = this.liegeOf(p);
    const lq = this.liegeOf(q);
    return lp === q || lq === p || (lp >= 0 && lp === lq);
  }

  /** 两国此刻不会互相宣战:结着盟、有宗藩之分、同是一国的藩属、在同一份约里(treaties.ts) */
  friendly(p: number, q: number): boolean {
    return !!this.pactOf(p, q) || this.vassalTie(p, q) || !!this.api.bound?.(p, q);
  }

  /**
   * p 此刻可以背弃盟约 x、向盟国开战:结盟满 BETRAY_AGE 年,共御的强邻已亡、或国力已不如 p,
   * 或者盟国已弱到 p 的 1 / BETRAY_PREY 以下(power = 现算某国国力)
   */
  betrayable(x: Pact, p: number, t: Year, power: (q: number) => number): boolean {
    if (t - x.since < BETRAY_AGE) return false;
    const q = x.a === p ? x.b : x.a;
    return !this.alive(x.foe) || power(x.foe) < power(p) || power(p) >= BETRAY_PREY * power(q);
  }

  /** 去掉一个盟约(断了的那一刻,记下年份:PACT_REST 年内两国不再结盟) */
  drop(x: Pact, t: Year): void {
    const i = this.pacts.indexOf(x);
    if (i >= 0) this.pacts.splice(i, 1);
    this.broken.set(pairKey(x.a, x.b), t);
  }

  /** 按一条史事更新(推演里记完史事就调;接着推时按史事重放) */
  apply(e: Annal): void {
    if (e.kind === 'alliance') this.pacts.push({ a: e.a, b: e.b, since: e.year, foe: e.foe ?? -1 });
    else if (e.kind === 'unally') {
      const x = this.pacts.find((v) => (v.a === e.a && v.b === e.b) || (v.a === e.b && v.b === e.a));
      if (x) this.drop(x, e.year);
      else this.broken.set(pairKey(e.a, e.b), e.year);
    } else if (e.kind === 'submit') {
      this.liege.set(e.a, e.b);
      this.sworn.set(e.a, e.year);
    } else if (e.kind === 'defect') {
      this.liege.delete(e.a);
      this.sworn.delete(e.a);
      this.defected.set(e.a, { liege: e.b, year: e.year });
    }
  }
  // 别的子系统挂过来的回调不在这里,在具名接口表 civ/api.ts 的 diplomacy 那一组
}

const models = new WeakMap<CivSim, DiplomacyModel>();

/** 推演引擎上挂着的邦交模型(测试、统计用) */
export function diplomacyModelOf(sim: CivSim): DiplomacyModel | undefined {
  return models.get(sim);
}

/** 国家 p 第 k 次看邦交的时刻 */
function checkTime(dm: DiplomacyModel, p: number, k: number): number {
  const P = dm.pm.polities[p];
  return P.founded + DIP_FIRST + DIP_EVERY * (k + 0.2 + 0.6 * keyed(dm.base, dm.pm.ptag[p], k, U_CHECK_T));
}

// ---------------------------------------------------------------------------
// 挂到推演引擎上

/** 登记邦交的事件处理,把规则挂到战争模型上(installCities 之后、installInterventions 之前调用) */
export function installDiplomacy(sim: CivSim, pm: PolityModel, dm: DiplomacyModel = new DiplomacyModel(pm, civApi(sim).diplomacy)): DiplomacyModel {
  const api = civApi(sim);
  const wm = warModelOf(sim);
  if (!wm) throw new Error('installDiplomacy:先 installWars');
  models.set(sim, dm);
  wm.dm = dm;
  const T = pm.terrain;
  const reg = T.regions;
  const owner = sim.owners[Layer.Polity];
  const pol = politicsModelOf(sim);

  // 新国家(立国、分裂、复国)拿到第一州时预约第一次看邦交
  sim.onChange(Layer.Polity, (_r, v, _prev, cause) => {
    if (v >= 0 && (cause === Ev.PolityFound || cause === Ev.Split) && pm.size[v] === 1) sim.schedule(checkTime(dm, v, 0), Ev.DiplomacyCheck, 0, v);
  });

  const record = (kind: Annal['kind'], f: Partial<Omit<Annal, 'year' | 'kind'>>) => {
    sim.record(kind, f);
    dm.apply({ year: sim.now, kind, a: f.a ?? -1, b: f.b ?? -1, region: -1, settlement: -1, war: f.war ?? -1, ...(f.foe !== undefined ? { foe: f.foe } : {}) });
  };
  api.diplomacy.note = record;

  // ---- 小工具 ----
  const alive = (p: number) => p >= 0 && pm.polities[p].ended === undefined;
  const warsOf = (p: number) => wm.active.filter((w) => w.a === p || w.b === p);
  const atWar = (p: number) => wm.active.some((w) => w.a === p || w.b === p);
  const fighting = (p: number, q: number) => wm.active.some((w) => (w.a === p && w.b === q) || (w.a === q && w.b === p));
  const borders = (x: number, y: number) => polityBorders(pm, owner, x, y, sim.now);
  const capRegion = (p: number, t: number) => pm.settlements[capitalAt(pm.polities[p], t)].region;
  const halted = (p: number, t: number) => !!wm.iv?.halted(p, t);
  /** 国力:城镇人口之和(千人;至少 1;按出兵的几成打折)× 军力系数,和 wars.ts 一样按州号顺序加。一次看邦交里记住算过的(这期间归属不变) */
  const powMemo = new Map<number, number>();
  const powerOf = (p: number, t: number): number => {
    const hit = powMemo.get(p);
    if (hit !== undefined) return hit;
    // 国力的数表(control.ts;这一年里才立的国家现算)
    const tab = api.war.power ? api.war.power(p) : -1;
    if (tab >= 0) {
      powMemo.set(p, tab);
      return tab;
    }
    let sum = 0;
    // 管不到的州出兵打折、割据的州不出兵(control.ts,和 wars.ts 一样)
    const lv = api.war.levy?.(p, t);
    for (const r of pm.lands[p]) {
      const c = pm.cityOf[r];
      if (c >= 0) sum += lv ? populationAt(pm.settlements[c], t) * lv(r) : populationAt(pm.settlements[c], t);
    }
    let v = Math.max(1, sum) * (pm.military?.[p] ?? 1);
    // 顺着引的国力加减(policy.ts,和 wars.ts 一样)
    const k = powerScaleOf(pm, p, t);
    if (k !== 1) v *= k;
    powMemo.set(p, v);
    return v;
  };
  /** 接壤的在世邻国(p 能走过去的边;编号升序) */
  const neighbors = (p: number): number[] => {
    const P = pm.polities[p];
    const out = new Set<number>();
    for (const r of pm.lands[p]) {
      for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
        const q = owner[reg.adj[e]];
        if (q >= 0 && q !== p && canCross(pm, P, reg.adjKind[e], sim.now) && alive(q)) out.add(q);
      }
    }
    return [...out].sort((x, y) => x - y);
  };
  api.diplomacy.neighborsOf = neighbors;
  /** 和作者下令的结盟一起算:两国此刻不会互相宣战 */
  const friendly = (p: number, q: number, t: number) => dm.friendly(p, q) || !!wm.iv?.allied(p, q, t);
  /** p 正在和 L 的某个藩属交兵(这时不向 L 称臣:称了臣就和那个藩属同是 L 的藩属,不该还在打) */
  const fightsBloc = (p: number, L: number) => dm.vassalsOf(L).some((z) => fighting(p, z));
  /** 手上的仗打满了(和看邻国时一样:帝国级的大国也最多同时打 MAX_WARS 场) */
  const busy = (p: number) => warsOf(p).length >= MAX_WARS;

  /** 宗主 L 此刻有多虚弱(1 起):在打仗、刚丢了国都 / 迁都、刚改朝换代、刚分裂、这些年接连丢州 */
  const weakness = (L: number, t: number): number => {
    const P = pm.polities[L];
    let w = 1;
    if (atWar(L)) w += 1;
    if (t - pm.capMoved[L] < WEAK_YEARS) w += 1;
    const d = P.dynasties;
    if (d && d.length > 1 && t - d[d.length - 1].year < WEAK_YEARS) w += 1;
    if (pol && t - (pol.lastSplit.get(L) ?? -Infinity) < WEAK_YEARS) w += 1;
    let lost = 0;
    for (let i = wm.wars.length - 1; i >= 0; i--) {
      const x = wm.wars[i];
      if (x.end !== undefined && t - x.end > WEAK_YEARS) continue;
      if (x.a !== L && x.b !== L) continue;
      for (const e of x.takes) if (e.by !== L && t - e.year < WEAK_YEARS) lost++;
    }
    if (lost >= WEAK_LOSS) w += 1;
    return w;
  };

  /** 一国称臣:记 submit;它结着的盟随之作废(各记一条 unally,cause = vassal) */
  const swear = (v: number, L: number, t: number, war = -1) => {
    const sid = capitalAt(pm.polities[v], t);
    record('submit', { a: v, b: L, region: pm.settlements[sid].region, settlement: sid, war });
    for (const x of dm.pactsOf(v)) record('unally', { a: v, b: x.a === v ? x.b : x.a, cause: 'vassal' });
  };

  // ---- ① 藩属自立 ----
  const tryDefect = (v: number, L: number, k: number, t: number): boolean => {
    if (t - (dm.sworn.get(v) ?? t) < DEFECT_MIN) return false;
    const ratio = powerOf(v, t) / powerOf(L, t);
    let odds = DEFECT_ODDS * weakness(L, t) * fpow(Math.E, DEFECT_K * (ratio - DEFECT_R0));
    if (!borders(v, L) && !borders(L, v)) odds *= DEFECT_FAR;
    if (pm.polities[v].culture !== pm.polities[L].culture) odds *= DEFECT_FOREIGN;
    if (keyed(dm.base, pm.ptag[v], k, U_DEFECT) >= odds / (1 + odds)) return false;
    record('defect', { a: v, b: L, region: capRegion(v, t), settlement: capitalAt(pm.polities[v], t) });
    // 宗主发兵讨伐:接壤、没在和它打、没被下令和它结盟、手上的仗没打满、没被下令不许扩张
    if (!halted(L, t) && !fighting(L, v) && !friendly(L, v, t) && !befriends(pm, L, v, t) && !busy(L) && borders(L, v) && keyed4(dm.base, pm.ptag[L], pm.ptag[v], k, U_PUNISH) < PUNISH) {
      api.war.declare!(L, v, t, -1, 'punish');
    }
    return true;
  };

  // ---- ② 纳土归附 ----
  const tryAbsorb = (L: number, v: number, k: number, t: number): boolean => {
    const V = pm.polities[v];
    const n = pm.size[v];
    if (t - (dm.sworn.get(v) ?? t) < ABSORB_AGE || n <= 0 || n > ABSORB_MAX || pm.size[L] < ABSORB_RATIO * n) return false;
    if (atWar(L) || atWar(v) || halted(L, t) || wm.iv?.protects(v, t) || wm.iv?.holdsLock(v, t)) return false;
    if (!borders(L, v)) return false;
    const mine = pm.lands[v].slice();
    for (const r of mine) if (t - wm.since[r] < ABSORB_SETTLE) return false;
    let odds = ABSORB_ODDS;
    if (V.culture !== pm.polities[L].culture) odds *= ABSORB_FOREIGN;
    if (keyed4(dm.base, pm.ptag[L], pm.ptag[v], k, U_ABSORB) >= odds / (1 + odds)) return false;
    for (const r of mine) sim.setOwner(Layer.Polity, r, L, Ev.Merge);
    endPolity(pm, v, t);
    pol?.merged.add(v);
    sim.record('merge', { a: L, b: v, cause: 'vassal' });
    return true;
  };

  // ---- ③ 盟约渐废 ----
  const tryLapse = (x: Pact, p: number, k: number, t: number): boolean => {
    if (t - x.since < LAPSE_AGE) return false;
    const f = x.foe;
    if (alive(f) && powerOf(f, t) >= LAPSE_RATIO * Math.max(powerOf(x.a, t), powerOf(x.b, t))) return false;
    const o = x.a === p ? x.b : x.a;
    if (keyed4(dm.base, pm.ptag[p], pm.ptag[o], k, U_LAPSE) >= LAPSE_P) return false;
    record('unally', { a: p, b: o, cause: 'lapse' });
    return true;
  };

  // ---- ④ 畏强邻:称臣 / 结盟 ----
  /** p 最怕的强邻:接壤、不友好,国力是 p 的 THREAT 倍以上(正在交兵的不论强弱;按倍数挑,交兵的 × 1.5)。没有 = −1 */
  const mainThreat = (p: number, t: number, pp: number): [number, number] => {
    let best = -1;
    let bestScore = 0;
    let bestRatio = 0;
    for (const q of neighbors(p)) {
      if (friendly(p, q, t) || dm.liegeOf(q) >= 0 || halted(q, t)) continue;
      const ratio = powerOf(q, t) / pp;
      const war = fighting(p, q);
      if (ratio < THREAT && !war) continue;
      const score = ratio * (war ? 1.5 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = q;
        bestRatio = ratio;
      }
    }
    return [best, bestRatio];
  };

  const trySubmit = (p: number, q: number, ratio: number, k: number, t: number): boolean => {
    if (ratio < SUBMIT_RATIO || pm.size[p] > SUBMIT_MAX || fighting(p, q) || dm.vassalsOf(p).length || fightsBloc(p, q)) return false;
    const d = dm.defected.get(p);
    if (d && d.liege === q && t - d.year < RESUBMIT_REST) return false;
    // 有限竞争之约(treaties.ts):不收约国的藩属
    if (d && api.diplomacy.limits?.(q, d.liege)) return false;
    // 有够分量的盟国撑腰就不称臣
    const pq = powerOf(q, t);
    for (const z of dm.alliesOf(p)) if (powerOf(z, t) >= 0.5 * pq) return false;
    const odds = SUBMIT_ODDS * fpow(ratio / SUBMIT_RATIO, SUBMIT_EXP) * pm.polities[q].expansionism;
    if (keyed(dm.base, pm.ptag[p], k, U_SUBMIT) >= odds / (1 + odds)) return false;
    swear(p, q, t);
    return true;
  };

  const tryPact = (p: number, f: number, ratio: number, k: number, t: number): boolean => {
    if (dm.alliesOf(p).length >= MAX_PACTS) return false;
    const pf = powerOf(f, t);
    // 国家方针(policy.ts):不和仇国结盟,亲国先找(没有方针 = null)
    const pol = pm.policies.size ? policyAt(pm, p, t) : null;
    let best = -1;
    let bestScore = 0;
    let cowar = false;
    for (const z of neighbors(f)) {
      if (z === p || dm.liegeOf(z) >= 0 || friendly(z, f, t) || friendly(z, p, t) || fighting(z, p)) continue;
      if (dm.alliesOf(z).length >= MAX_PACTS || t - (dm.broken.get(pairKey(p, z)) ?? -Infinity) < PACT_REST) continue;
      if (pm.policies.size && (picks(pm, pol?.foes, z) || hates(pm, z, p, t))) continue;
      const pz = powerOf(z, t);
      const war = fighting(z, f);
      if (pz < PACT_MIN_POWER * pf || (!war && pf < PACT_FEAR * pz)) continue;
      let score = Math.min(1, pz / pf) * (war ? PACT_COWAR : 1) * (borders(p, z) ? 1.5 : 1);
      if (pol && picks(pm, pol.friends, z)) score *= FRIEND_PACT;
      // 结着亲的先找(marriage.ts)
      if (api.diplomacy.bond) score *= 1 + (KIN_PACT - 1) * api.diplomacy.bond(p, z, t);
      if (score > bestScore) {
        bestScore = score;
        best = z;
        cowar = war && fighting(p, f);
      }
    }
    if (best < 0) return false;
    const odds = PACT_ODDS * Math.sqrt(Math.max(ratio, 1) / THREAT) * (cowar ? PACT_COWAR : 1);
    if (keyed4(dm.base, pm.ptag[p], pm.ptag[best], k, U_PACT) >= odds / (1 + odds)) return false;
    const sid = capitalAt(pm.polities[p], t);
    record('alliance', { a: p, b: best, region: pm.settlements[sid].region, settlement: sid, foe: f });
    return true;
  };

  sim.on(Ev.DiplomacyCheck, (k, p, t) => {
    powMemo.clear();
    const P = pm.polities[p];
    if (!P || P.ended !== undefined) return;
    sim.schedule(checkTime(dm, p, k + 1), Ev.DiplomacyCheck, k + 1, p);
    // 结亲(marriage.ts):不占"一次最多出一件事"
    api.diplomacy.marry?.(p, k, t);
    const L = dm.liegeOf(p);
    if (L >= 0) {
      tryDefect(p, L, k, t);
      return;
    }
    for (const v of dm.vassalsOf(p)) if (tryAbsorb(p, v, k, t)) return;
    for (const x of dm.pactsOf(p)) if (tryLapse(x, p, k, t)) return;
    const pp = powerOf(p, t);
    const [f, ratio] = mainThreat(p, t, pp);
    if (f >= 0 && (trySubmit(p, f, ratio, k, t) || tryPact(p, f, ratio, k, t))) return;
    // 立约(treaties.ts)
    api.diplomacy.onCheck?.(p, k, t, f);
  });

  // ---- 战争里 ----
  api.diplomacy.sever = (x: number, y: number, t: number, war: number) => {
    if (dm.pactOf(x, y)) record('unally', { a: x, b: y, war, cause: 'betray' });
    // 藩属打宗主 = 自立;宗主打藩属 = 宗藩反目(defect 的 cause = betray),藩属也不再称臣
    else if (dm.liegeOf(x) === y) record('defect', { a: x, b: y, region: capRegion(x, t), settlement: capitalAt(pm.polities[x], t) });
    else if (dm.liegeOf(y) === x) record('defect', { a: y, b: x, region: capRegion(y, t), settlement: capitalAt(pm.polities[y], t), cause: 'betray' });
    // 同一个宗主的两个藩属:攻方先自立(不再向宗主称臣),再打
    else if (dm.liegeOf(x) >= 0 && dm.liegeOf(x) === dm.liegeOf(y)) record('defect', { a: x, b: dm.liegeOf(x), region: capRegion(x, t), settlement: capitalAt(pm.polities[x], t) });
  };

  /** x 向 y 宣战(不是援盟)之后:y 的盟国援盟 / 坐视不救,y 的宗主发兵来救 */
  api.war.onDeclare = (w: War, x: number, y: number, t: number) => {
    for (const z of dm.alliesOf(y)) {
      // 国家方针(policy.ts):z 把攻方当亲国的不出兵(盟约不断);把守方当亲国的更肯出兵,当仇国的不救(盟约就此断了)
      if (z === x || !alive(z) || friendly(z, x, t) || befriends(pm, z, x, t) || fighting(z, x) || halted(z, t) || busy(z) || !borders(z, x)) continue;
      let join = hates(pm, z, y, t) ? 0 : befriends(pm, z, y, t) ? FRIEND_JOIN : PACT_JOIN;
      // 结着亲的更肯出兵(marriage.ts)
      if (join > 0 && api.diplomacy.bond) join *= 1 + (KIN_JOIN - 1) * api.diplomacy.bond(z, y, t);
      if (keyed4(dm.base, pm.ptag[z], pm.ptag[x], Math.round(t * 256), U_JOIN) < join) api.war.declare!(z, x, t, y, 'ally');
      else record('unally', { a: z, b: y, war: w.id, cause: 'abandon' });
    }
    const L = dm.liegeOf(y);
    if (L >= 0 && L !== x && !friendly(L, x, t) && !befriends(pm, L, x, t) && !fighting(L, x) && !halted(L, t) && !busy(L) && borders(L, x)) {
      if (keyed4(dm.base, pm.ptag[L], pm.ptag[x], Math.round(t * 256), U_RESCUE) < RESCUE) api.war.declare!(L, x, t, y, 'rescue');
    }
  };

  /** 第 i 仗之后:守方打得很惨时奉表称臣、攻方受降罢兵(当即议和,紧跟着记 submit)。成了 = true */
  api.war.sue = (w: War, i: number, t: number, pow: Float64Array, capitalFell: boolean): boolean => {
    const a = w.a;
    const b = w.b;
    // 讨伐民变不受降:义军要么被讨平、要么割据、要么攻破都城(unrest.ts)
    if (api.war.revolt?.(w) || !alive(a) || !alive(b) || pow[a] < SUE_RATIO * pow[b]) return false;
    if (dm.liegeOf(a) >= 0 || dm.liegeOf(b) >= 0 || dm.vassalsOf(b).length || halted(a, t) || fightsBloc(b, a)) return false;
    // 这场战争里攻方占下、此刻还在手里的州(同一州反复易手只算一次)
    const won = new Set<number>();
    for (const e of w.takes) if (e.by === a && owner[e.region] === a) won.add(e.region);
    const held = won.size;
    if (pm.size[b] <= SUE_LEFT || (!capitalFell && held < Math.max(SUE_MIN, SUE_FRAC * (pm.size[b] + held)))) return false;
    const B = pm.polities[b];
    const kin = B.culture === pm.polities[a].culture;
    let accept = SUE_ACCEPT * (kin ? SUE_KIN : SUE_FOREIGN);
    if (kin && pow[a] >= SUE_CRUSH * pow[b]) accept *= SUE_UNIFY;
    if (warsOf(a).length > 1) accept *= 1.4;
    if (pm.capDist[a][capRegion(b, t)] > SUE_FAR) accept *= 1.4;
    // 守方此刻在位的君主:好战越低越肯奉表称臣,越高越宁可打下去(rulers.ts;加上方针的胆量、和谈底线)
    const offer = SUE_OFFER * effOf(pm, b, t).sue;
    if (keyed4(dm.base, pm.ptag[a], pm.ptag[b], Math.round(w.start * 256) * 64 + (i & 63), U_SUE) >= offer * Math.min(0.9, accept)) return false;
    api.war.makePeace!(w, t);
    if (!alive(b)) return true;
    swear(b, a, t, w.id);
    return true;
  };

  return dm;
}

/**
 * 由 Civ 重建邦交的推演状态(resumeCiv 调用,在 resumeCities 之后):结着的盟、藩属、断盟 / 自立的年份都从史事里读,
 * 再按"国家 + 第几次"算出还没到的看邦交,补进引擎
 */
export function resumeDiplomacy(sim: CivSim, _world: World, civ: Civ): void {
  const pm = polityModelOf(sim);
  if (!pm || !warModelOf(sim)) return;
  const dm = new DiplomacyModel(pm, civApi(sim).diplomacy);
  for (const e of civ.annals) dm.apply(e);
  installDiplomacy(sim, pm, dm);
  const now = sim.now;
  for (const p of pm.polities) {
    if (p.ended !== undefined) continue;
    let k = 0;
    while (quantize(checkTime(dm, p.id, k)) <= now) k++;
    // 一口气推时上一次看邦交那一刻预约的(第一次是立国那一刻)
    sim.schedule(checkTime(dm, p.id, k), Ev.DiplomacyCheck, k, p.id, bookChain(k, (j) => checkTime(dm, p.id, j), p.founded), k > 0 ? 0 : p.id);
  }
}

// ---------------------------------------------------------------------------
// 某一年的邦交(界面、编年史用;按史事推,规则和推演里一样)

export interface Relations {
  /** 国家 → 宗主(此刻是谁的藩属)、称臣的年份 */
  liege: Map<number, { liege: number; since: Year }>;
  /** 结着的盟(自然结成的;作者下令的结盟见 Civ.interventions) */
  pacts: Pact[];
}

/** year 那一刻(含那一刻的史事)的藩属和盟约;亡了的国家不算 */
export function relationsAt(civ: Civ, year: Year): Relations {
  const liege = new Map<number, { liege: number; since: Year }>();
  let pacts: Pact[] = [];
  for (const e of civ.annals) {
    if (e.year > year) break;
    if (e.kind === 'alliance') pacts.push({ a: e.a, b: e.b, since: e.year, foe: e.foe ?? -1 });
    else if (e.kind === 'unally') pacts = pacts.filter((x) => !((x.a === e.a && x.b === e.b) || (x.a === e.b && x.b === e.a)));
    else if (e.kind === 'submit') liege.set(e.a, { liege: e.b, since: e.year });
    else if (e.kind === 'defect') liege.delete(e.a);
  }
  const alive = (p: number) => {
    const P = civ.polities[p];
    return !!P && polityAlive(P, year);
  };
  for (const [v, x] of liege) if (!alive(v) || !alive(x.liege)) liege.delete(v);
  return { liege, pacts: pacts.filter((x) => alive(x.a) && alive(x.b)) };
}

/** 一国某一年的邦交(国家面板用) */
export interface PolityTies {
  /** 宗主、称臣的年份(不是藩属 = undefined) */
  liege?: { liege: number; since: Year };
  /** 藩属、称臣的年份 */
  vassals: { id: number; since: Year }[];
  /** 盟国、结盟的年份、共御的强邻(−1 = 没有;作者下令的结盟没有) */
  allies: { id: number; since: Year; foe: number }[];
}

/** 国家 id 在 year 那一刻的邦交:relationsAt 那一套,盟国再加上作者下令的结盟(那一年在约期内、两国都在) */
export function polityTies(civ: Civ, id: number, year: Year): PolityTies {
  const r = relationsAt(civ, year);
  const vassals = [...r.liege].filter(([, x]) => x.liege === id).map(([v, x]) => ({ id: v, since: x.since }));
  const allies = r.pacts.filter((x) => x.a === id || x.b === id).map((x) => ({ id: x.a === id ? x.b : x.a, since: x.since, foe: x.foe }));
  const P = civ.polities[id];
  for (const v of civ.interventions ?? []) {
    // 结盟从下令那一刻起(年中下的带着第几格)
    const from = v.from + (v.fromTick ?? 0) / YEAR_TICKS;
    if (v.kind !== 'ally' || year < from || (v.until !== undefined && year >= v.until)) continue;
    const a = resolveKey(civ, v.a);
    const b = resolveKey(civ, v.b);
    if (a?.kind !== 'polity' || b?.kind !== 'polity' || (a.id !== id && b.id !== id)) continue;
    const o = a.id === id ? b.id : a.id;
    const O = civ.polities[o];
    if (o === id || !P || !O || !polityAlive(P, year) || !polityAlive(O, year) || allies.some((x) => x.id === o)) continue;
    allies.push({ id: o, since: Math.max(from, O.founded, P.founded), foe: -1 });
  }
  return { liege: r.liege.get(id), vassals, allies };
}

// ---------------------------------------------------------------------------
// 统计(scripts/gen-stats.ts、单测用)

export interface DiplomacyStats {
  /** 结盟、盟约断了(各种原因)、称臣(战败 / 主动)、自立、讨伐叛藩、援盟参战、救藩参战、纳土归附 */
  pacts: number;
  lapses: number;
  abandons: number;
  betrayals: number;
  submits: number;
  warSubmits: number;
  defects: number;
  punishments: number;
  allyJoins: number;
  rescues: number;
  absorbs: number;
  /** 结束时的藩属数、盟约数 */
  vassalsAtEnd: number;
  pactsAtEnd: number;
}

export function diplomacyStats(civ: Civ): DiplomacyStats {
  const A = civ.annals;
  const n = (f: (e: Annal) => boolean) => A.filter(f).length;
  const rel = relationsAt(civ, civ.endYear);
  return {
    pacts: n((e) => e.kind === 'alliance'),
    lapses: n((e) => e.kind === 'unally' && e.cause === 'lapse'),
    abandons: n((e) => e.kind === 'unally' && e.cause === 'abandon'),
    betrayals: n((e) => e.kind === 'unally' && e.cause === 'betray'),
    submits: n((e) => e.kind === 'submit'),
    warSubmits: n((e) => e.kind === 'submit' && e.war >= 0),
    defects: n((e) => e.kind === 'defect'),
    punishments: n((e) => e.kind === 'war' && e.cause === 'punish'),
    allyJoins: n((e) => e.kind === 'war' && e.cause === 'ally'),
    rescues: n((e) => e.kind === 'war' && e.cause === 'rescue'),
    absorbs: n((e) => e.kind === 'merge' && e.cause === 'vassal'),
    vassalsAtEnd: rel.liege.size,
    pactsAtEnd: rel.pacts.length,
  };
}

/** 模块:邦交:称臣纳贡、结盟、背盟、援盟、讨伐叛藩(清单和次序见 modules.ts) */
export const diplomacyModule: CivModule = {
  id: 'diplomacy',
  install: (c) => {
    if (c.pm) installDiplomacy(c.sim, c.pm);
  },
  resume: (c) => resumeDiplomacy(c.sim, c.world, c.civ),
};

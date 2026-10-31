/**
 * 立约与中立地:几国约定若干年互不侵犯(三国以上的是"有限竞争":再加各守今疆)、续约、背约、约满;
 * 几国共建一处中立地、两国议和时划一州做缓冲中立地;失势的宗室、被废的末代之君被徙到中立地,亡国之君出奔到那里。
 * 挂在同一个推演引擎(sim.ts)上,邦交(diplomacy.ts)、战争(wars.ts)、国家扩张(polities.ts)在决策点调这里挂上的回调。
 *
 * 流程(index.ts 在 installPlague 之后调用 installTreaties):
 *
 *   **立约**(看邦交时,称臣、结盟都没成之后;DiplomacyModel.onCheck):
 *     两国陆上接壤、国力差不到 TREATY_RATIO 倍、都没在打仗、都不是藩属、没结盟、两国上次约废 / 背约过了 TREATY_REST 年,
 *     还要有个由头:近 STALE_YEARS 年里两国打过一场谁也没占到便宜的仗(双方攻下的州数差不超过 STALE_NET),
 *     或者两国都怕同一个强邻(都接壤、国力是两国各自的 FEAR 倍以上)。
 *     赔率 = TREATY_ODDS × (有前一种由头 × REASON) × (有后一种 × REASON) × (方针是守成 / 和平发展的,每国 × CALM)。
 *     几个邻国都够格时先找有共同强邻的(那一项的分数再 × 1.5),再找国力相近的。
 *     说定以后,和两国都接壤(或者和其中一国接壤、也挨着那个共同的强邻)、国力和其中一国差不到 JOIN_RATIO 倍、
 *     没在和约国打仗的邻国各有 JOIN 的机会拉进来,最多 MAX_PARTIES 国。
 *     两国之约是"互不侵犯"(TERM_PAIR 年),三国以上是"有限竞争"(TERM_MULTI 年;再加各守今疆:不进约国旁边的无主之地、不收约国的藩属),
 *     三国以上的有 MULTI_ZONE 的机会同时设一处中立地。
 *   **议和顺带立约**(厌战、僵持罢兵之后;WarModel.onTruce):两国国力差不到 TREATY_RATIO 倍、陆上接壤、上次约废过了 TREATY_REST 年 → PEACE_TREATY 的机会
 *     立互不侵犯之约(TERM_PAIR 年),其中 PEACE_ZONE 的机会同时划一州做缓冲中立地。
 *   **居间**:和立约各国都没在打仗、至少和其中两国接壤的国家里国力最大的(没有就没有);编年史写它当时在朝的名臣(treatyInfo.ts)。
 *   **会盟地**:有中立地的会于中立地的城;没有就挑国界上(和别的约国接壤的州里)离几国国都路程之和最近的一座城。约名照这座城起("丹枫关之约")。
 *   **约的效果**:约期内立约几国互不宣战(DiplomacyModel.friendly 算上它:看邻国时跳过,不援盟来打约国,不把约国当强邻);
 *     有限竞争的还不进约国旁边的无主之地(PolityModel.closed)、不收约国的藩属(DiplomacyModel.limits)。不互相出兵相救(那是结盟)。
 *   **背约**(看邻国时;WarModel.treaty):立约(或续约)满 BREACH_AGE 年以后才可能,还要有由头 —— 自己国力已是对方 BREACH_PREY 倍以上、
 *     对方正乱(在和别国打仗、CHAOS_YEARS 年内迁过都 / 改朝换代)、或者共同的强邻已经亡了;宣战赔率 × BREACH_ODDS。
 *     国家方针(policy.ts)把对方当仇国的不和它立约;立了约以后才定的仇国,约拦不住,不等满年就可能背约。
 *     宣战那一刻(DiplomacyModel.sever)先记 breach:背约的一方退出这份约,约的中立地当即撤销、州还给原主,剩下两国以上的约照旧。
 *     作者下令约国之间开战也一样记背约。
 *   **到期**(Ev.TreatyEnd):还在约里的几国国力差不到 RENEW_RATIO 倍 → RENEW_P 的机会续约(共同的强邻还在 × RENEW_FOE,最多 RENEW_MAX;
 *     每续过一次再 × RENEW_DECAY),续 TERM_RENEW 年(记 treaty,cause = renew);不续就记 expire,约废,中立地撤销。
 *   **中途了结**:一国亡、被并、向别国称臣就退出(不另记);剩不到两国,约就废(记 expire,cause = lapse,中立地撤销)。
 *     看邦交、亡国、到期时查一遍(sweep)。
 *
 *   **中立地**:一州,归属记成无主(变化日志原因 Ev.Neutral),谁都不扩张进去、不在那里立国,打仗也打不到(只打敌国的州);城照旧有人住。
 *     立约时共建的放在哪(pickZone):一州在陆上碰到的约国越多越靠前;一样多时挨着约国交界的关隘(passes.ts)的在前;
 *     再一样时有城的在前、人少的在前。议和划缓冲的(pickBuffer):这场仗里易手次数最多、此刻在两国交界上的那一州。
 *     那州原属哪国由哪国让出;撤销时还给原来那国(那国还在、陆上还和它接壤),不然成了无主之地,周围的国家照常扩张进去。
 *   **放逐**(每处同时最多 ZONE_CAP 人:EXILE_STAY 年内徙来的算还住着):
 *     立约国新君即位(先君寿终、同一朝里交接、先君晚年新君没有引兵入朝,PolityModel.onReign;在 unrest.ts 的宗室争位之前看),先君还有成年在世的儿子:
 *       EXILE_P 的机会把最年长的那位徙到中立地(记 exile,cause = heir),这一回不再有宗室据地争位;
 *     改朝换代、旧朝末代之君被废(新朝的根据地就是原来的国都,和 people.ts 判"被废"同一个判据):EXILE_P 的机会徙去(cause = deposed);
 *     立约国亡于战争(WarModel.onFall):亡以前它还在约里、约里还有别国、约的中立地还在(没被谁占了、没住满、不是"不送人去"的),
 *     亡国之君先出奔中立地(cause = fled),再照常查一遍约 —— 两国之约剩一国就废、中立地跟着撤(他这一刻就离开中立地,人物照 Person.exile 的规矩写)。
 *     没有中立地可去的(不是约国也一样):末代之君的下场是出奔的,奔一个邻国(exile.ts;记 exile,cause = fled,war = −1,b = 那国)。
 *     人物(people.ts)照这几条史事填 Person.exile。
 *
 *   **作者下令**(干预「立约」「划中立地」,interventions.ts 在干预那一刻调 TreatyModel.decree):记史事 intervene,
 *     生效了紧跟着记 treaty / neutral(cause = decree;选项记在 Annal.opt、Annal.until,位见 treatyBook.ts 的 OPT_*):
 *     立约:约里的国家、期限(0 = 一直,不预约期满)、互不侵犯还是有限竞争、约期内不许背约(看邻国时不背约)、居间的国家照作者的;
 *     会盟的城照推演挑;同时划的中立地那州要有人住、不是国都、原属约里一国或无主,不然只立约。之后照常续约、约满。
 *     划中立地:几国已同在一份还没设过中立地的约里就依它设,不然同时立一个互不侵犯之约(TERM_DECREE 年);
 *     选了不送人去的不往那里放逐人,一直留着的约废了、背约也不撤,到某一年撤的那年撤(Ev.ZoneEnd)。
 *     演一国时下的(ask):别国照推演的规矩定肯不肯(willing:仇国、别国的藩属不肯,国力相近、都怕同一个强邻、近年打成僵持的更肯),
 *     不肯的不入约;都不肯、那州原属的国家不肯 = 不生效(intervene 的 b 列 IV_REFUSED)。两两之间正在交战的当即议和(记在约后面)。
 *
 * **不存内存状态**:约、中立地、背约退出的、两国约废的年份都由史事重建(resumeTreaties);到期的时刻 = 立约 / 续约的年份 + 期限。
 * 随机数:keyed / keyed4(subSeed(seed, 'civ-treaty'), 国家的位置锚…, 用途)。纯计算,不碰 DOM。
 */
import type { World } from '../world';
import { AdjKind, Layer, type Annal, type AnnalCause, type Civ, type Year } from './types';
import { keyed, keyed4, subSeed } from './rand';
import { Ev, quantize, type CivSim } from './sim';
import { REOPEN, hates, limitedEnd, polityModelOf, policyAt, powerScaleOf, type PolityModel } from './polities';
import { warModelOf, type War, type WarModel } from './wars';
import { diplomacyModelOf, type DiplomacyModel } from './diplomacy';
import { capitalAt, populationAt } from './growth';
import { regionPasses } from './passes';
import { claimants, murderedAt } from './royals';
import { refugeFinder } from './exile';
import type { Reign } from './rulers';
import { regionOfKey, type Intervention } from '../edits';
import type { InterventionModel } from './interventions';
import { IV_NOBODY, IV_NO_ZONE, IV_REFUSED, OPT_KEEP, OPT_LASTING, OPT_LIMITED, OPT_QUIET } from './treatyBook';
import { royalSeg } from './regime';

// ---- 调参(以 20 个种子的统计为准) ----
/** 立约的赔率底数;每有一种由头 × REASON;方针是守成 / 和平发展的,每国 × CALM */
const TREATY_ODDS = 0.2;
const REASON = 2;
const CALM = 1.5;
/** 几个邻国都够格时,有共同强邻的那一项分数再乘这么多(先找它) */
const FOE_FIRST = 1.5;
/** 两国国力差不到这么多倍才立约(议和顺带立约、拉进来的第三国也一样) */
const TREATY_RATIO = 2;
/** 由头一:近这么多年里两国打过一场谁也没占到便宜(双方攻下的州数差不超过 STALE_NET)的仗 */
const STALE_YEARS = 30;
const STALE_NET = 1;
/** 由头二:共同的强邻,国力是两国各自的这么多倍以上 */
const FEAR = 1.5;
/** 两国上次约废 / 背约以后,这么多年内不再立约(议和顺带立约也一样) */
const TREATY_REST = 80;
/** 拉进第三、第四国的机会;最多几国 */
const JOIN = 0.6;
/** 拉进来的国家和其中一国国力差不到这么多倍 */
const JOIN_RATIO = 2.5;
const MAX_PARTIES = 4;
/** 期限:两国之约(互不侵犯)、三国以上(有限竞争)、续约 */
const TERM_PAIR = 20;
const TERM_MULTI = 30;
const TERM_RENEW = 20;
/** 三国以上立约时同时设中立地的机会 */
const MULTI_ZONE = 0.5;
/** 议和顺带立约的机会;其中同时划缓冲中立地的机会 */
const PEACE_TREATY = 0.15;
const PEACE_ZONE = 0.5;
/** 背约:立约(续约)满这么多年;自己国力是对方这么多倍以上、对方这么多年内迁都 / 改朝换代算由头;宣战赔率 × BREACH_ODDS */
const BREACH_AGE = 10;
const BREACH_PREY = 2.5;
const CHAOS_YEARS = 30;
const BREACH_ODDS = 0.5;
/** 续约:几国国力差不到这么多倍;机会;共同的强邻还在 × RENEW_FOE;最多;已经续过几次的,每续过一次再 × RENEW_DECAY(不至于一续几百年) */
const RENEW_RATIO = 2.5;
const RENEW_P = 0.6;
const RENEW_FOE = 1.3;
const RENEW_MAX = 0.9;
const RENEW_DECAY = 0.5;
/** 放逐:机会;一处中立地同时最多几人;徙来这么多年内算还住着 */
const EXILE_P = 0.5;
const ZONE_CAP = 3;
const EXILE_STAY = 40;

/** 作者下令划中立地、几国还没有约时同时立的互不侵犯之约几年 */
const TERM_DECREE = 30;
/** 演一国时它提出立约,对方肯不肯的赔率底数(国力相近、都怕同一个强邻、近年打成僵持各 × REASON,方针守成和平的 × CALM;最多 ASK_MAX) */
const ASK_ODDS = 0.3;
const ASK_MAX = 0.95;


// 随机数用途
const U_TREATY = 1;
const U_JOIN = 2;
const U_ZONE = 3;
const U_PEACE = 4;
const U_BUFFER = 5;
const U_RENEW = 6;
const U_HEIR = 7;
const U_DEPOSE = 8;
const U_ASK = 9;

/** 陆上的邻接(不算海峡、航线) */
const land = (kind: number) => kind === AdjKind.Flat || kind === AdjKind.River || kind === AdjKind.Mountain;

const pairKey = (a: number, b: number) => Math.min(a, b) * 32768 + Math.max(a, b);

// ---------------------------------------------------------------------------
// 模型

/** 一份约(推演里的状态;界面用 treatyInfo.ts 按史事推出来的那一份) */
export interface Treaty {
  /** 约的编号(史事 treaty 的 war 列) */
  id: number;
  /** 约里的几国(立约时的;续约后 = 续约的几国) */
  parties: number[];
  /** 首次立约、最近一次立约 / 续约的年份;期限(年;0 = 作者下令立的一直有效的约,不预约期满) */
  start: Year;
  since: Year;
  term: number;
  /** 有限竞争(自己立的、议和顺带立的:三国以上就是;作者下令立的:照作者选的) */
  multi: boolean;
  /** 作者下令立的、选了"约期内不许背约":约里的国家不背约 */
  keep: boolean;
  /** 作者下令立的(约满、约废那条另记它是不是有限竞争:立约的国数说明不了,见 polities.ts 的 reopenedBy) */
  decree: boolean;
  /** 立约时几国 */
  size: number;
  /** 共同的强邻(−1 = 没有) */
  foe: number;
  /** 续过几次约 */
  renewals: number;
  /** 背约退出的 */
  out: number[];
  /** 中立地的编号(−1 = 没有) */
  zone: number;
  /** 约废的年份(约满不续、剩不到两国) */
  ended?: Year;
}

/** 一处中立地 */
export interface Zone {
  id: number;
  region: number;
  /** 依的那份约 */
  treaty: number;
  from: Year;
  /** 让出那州的国家(−1 = 原是无主之地) */
  owner: number;
  /** 撤销的年份 */
  ended?: Year;
  /** 徙来 / 出奔来的年份 */
  exiles: Year[];
  /** 作者下令划的:不送人去(不往这里放逐宗室)、一直留着(约废了、背约也不撤)、到哪年撤 */
  quiet: boolean;
  lasting: boolean;
  until?: Year;
}

export class TreatyModel {
  readonly pm: PolityModel;
  readonly dm: DiplomacyModel;
  readonly base: number;
  treaties: Treaty[] = [];
  zones: Zone[] = [];
  /** 还没废的约 */
  live: Treaty[] = [];
  /** 州 → 此刻是哪处中立地(−1 = 不是) */
  readonly zoneAt: Int32Array;
  /** 两国最近一次约废 / 背约的年份(键见 pairKey) */
  readonly rest = new Map<number, Year>();
  /**
   * 作者下令立约 / 划中立地(干预 treaty、neutral;interventions.ts 在干预那一刻调,a = 下令的国家此刻的编号):
   * 记史事 intervene(b 列见 IV_NOBODY 那几个),生效了接着记 treaty / neutral。installTreaties 时挂上
   */
  decree?: (v: Extract<Intervention, { kind: 'treaty' | 'neutral' }>, i: number, a: number, t: Year, iv: InterventionModel) => void;

  constructor(pm: PolityModel, dm: DiplomacyModel) {
    this.pm = pm;
    this.dm = dm;
    this.base = subSeed(pm.seed, 'civ-treaty');
    this.zoneAt = new Int32Array(pm.terrain.R).fill(-1);
  }

  private alive(p: number): boolean {
    return p >= 0 && this.pm.polities[p]?.ended === undefined;
  }

  /** p 此刻还在约 x 里:约没废、没背约、国还在、立约(续约)以后没向别国称臣过 */
  member(x: Treaty, p: number): boolean {
    return this.alive(p) && this.held(x, p);
  }

  /** 不看国还在不在的 member(亡国那一刻看它亡以前在不在约里) */
  held(x: Treaty, p: number): boolean {
    if (x.ended !== undefined || !x.parties.includes(p) || x.out.includes(p)) return false;
    const dm = this.dm;
    return !((dm.sworn.get(p) ?? -Infinity) >= x.since || (dm.defected.get(p)?.year ?? -Infinity) >= x.since);
  }

  /** 约 x 此刻还在约里的几国(按入约先后) */
  members(x: Treaty): number[] {
    return x.parties.filter((p) => this.member(x, p));
  }

  /** p、q 此刻同在的那份约(没有 = undefined) */
  bound(p: number, q: number): Treaty | undefined {
    if (p === q) return undefined;
    for (const x of this.live) if (this.member(x, p) && this.member(x, q)) return x;
    return undefined;
  }

  /** q 和 L 同在一份有限竞争之约里 */
  limits(q: number, L: number): boolean {
    // 两国可能同在几份约里(先立了两国之约,又一起入了三国之约):哪一份是有限竞争都算
    if (q === L) return false;
    for (const x of this.live) if (x.multi && this.member(x, q) && this.member(x, L)) return true;
    return false;
  }

  /** 中立地 z 此刻还住着几人(EXILE_STAY 年内徙来的) */
  residents(z: Zone, t: Year): number {
    let n = 0;
    for (const y of z.exiles) if (t - y < EXILE_STAY) n++;
    return n;
  }

  /** 按一条史事更新(推演里记完史事就调;接着推时按史事重放) */
  apply(e: Readonly<Annal>): void {
    switch (e.kind) {
      case 'treaty': {
        const ps = (e.ps ?? [e.a, e.b]).slice();
        if (e.cause === 'renew') {
          const x = this.treaties[e.war];
          if (!x) return;
          x.parties = ps;
          x.since = e.year;
          x.term = e.n ?? TERM_RENEW;
          x.renewals++;
          return;
        }
        const decree = e.cause === 'decree';
        const opt = e.opt ?? 0;
        const x: Treaty = {
          id: e.war,
          parties: ps,
          start: e.year,
          since: e.year,
          term: e.n ?? TERM_PAIR,
          multi: decree ? (opt & OPT_LIMITED) !== 0 : ps.length >= 3,
          keep: decree && (opt & OPT_KEEP) !== 0,
          decree,
          size: ps.length,
          foe: e.foe ?? -1,
          renewals: 0,
          out: [],
          zone: -1,
        };
        this.treaties[e.war] = x;
        this.live.push(x);
        return;
      }
      case 'breach': {
        const x = this.treaties[e.n ?? -1];
        if (!x) return;
        x.out.push(e.a);
        this.rest.set(pairKey(e.a, e.b), e.year);
        return;
      }
      case 'expire': {
        const x = this.treaties[e.war];
        if (!x || x.ended !== undefined) return;
        x.ended = e.year;
        const i = this.live.indexOf(x);
        if (i >= 0) this.live.splice(i, 1);
        const ps = e.ps ?? [];
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) this.rest.set(pairKey(ps[i], ps[j]), e.year);
        return;
      }
      case 'neutral': {
        if (e.cause === 'lapse') {
          const z = this.zones[e.war];
          if (!z || z.ended !== undefined) return;
          z.ended = e.year;
          if (this.zoneAt[z.region] === z.id) this.zoneAt[z.region] = -1;
          return;
        }
        const opt = e.cause === 'decree' ? (e.opt ?? 0) : 0;
        const z: Zone = { id: e.war, region: e.region, treaty: e.n ?? -1, from: e.year, owner: e.a, exiles: [], quiet: (opt & OPT_QUIET) !== 0, lasting: (opt & OPT_LASTING) !== 0 };
        if (e.cause === 'decree' && e.until !== undefined) z.until = e.until;
        this.zones[e.war] = z;
        if (e.region >= 0 && e.region < this.zoneAt.length) this.zoneAt[e.region] = z.id;
        const x = this.treaties[z.treaty];
        if (x) x.zone = z.id;
        return;
      }
      case 'exile': {
        this.zones[e.war]?.exiles.push(e.year);
        return;
      }
    }
  }
}

const models = new WeakMap<CivSim, TreatyModel>();

/** 推演引擎上挂着的立约模型(测试、统计用) */
export function treatyModelOf(sim: CivSim): TreatyModel | undefined {
  return models.get(sim);
}

// ---------------------------------------------------------------------------
// 挂到推演引擎上

/** 登记立约的事件处理,把规则挂到邦交、战争、国家扩张上(installDiplomacy、installUnrest 之后调用) */
export function installTreaties(sim: CivSim, pm: PolityModel, world: World, tm?: TreatyModel): TreatyModel {
  const wm = warModelOf(sim);
  const dm = diplomacyModelOf(sim);
  if (!wm || !dm) throw new Error('installTreaties:先 installWars、installDiplomacy');
  const m = tm ?? new TreatyModel(pm, dm);
  models.set(sim, m);
  const reg = pm.terrain.regions;
  const owner = sim.owners[Layer.Polity];
  const culture = sim.owners[Layer.Culture];
  /** 州与州之间的关隘(按州的邻接边;中立地挑挨着关隘的) */
  const gate = regionPasses(world, reg);
  const base = m.base;

  /** 记一条史事并更新模型 */
  const note = (kind: Annal['kind'], f: Partial<Omit<Annal, 'year' | 'kind'>>) => {
    sim.record(kind, f);
    m.apply(sim.annal(sim.annalCount - 1));
  };

  // ---- 小工具 ----
  const alive = (p: number) => p >= 0 && pm.polities[p]?.ended === undefined;
  const atWar = (p: number) => wm.active.some((w) => w.a === p || w.b === p);
  const fighting = (p: number, q: number) => wm.active.some((w) => (w.a === p && w.b === q) || (w.a === q && w.b === p));
  /** 国力:政局数表里的(control.ts);这一年里才立的国家现算(城的人口 × 军力系数 × 方针的倍数) */
  const powerOf = (p: number, t: Year): number => {
    const tab = wm.power ? wm.power(p) : -1;
    if (tab >= 0) return tab;
    let sum = 0;
    for (const r of pm.lands[p]) {
      const c = pm.cityOf[r];
      if (c >= 0) sum += populationAt(pm.settlements[c], t);
    }
    return Math.max(1, sum) * (pm.military?.[p] ?? 1) * powerScaleOf(pm, p, t);
  };
  /** 陆上接壤的在世邻国(编号升序) */
  const landNeighbors = (p: number): number[] => {
    const out = new Set<number>();
    for (const r of pm.lands[p]) {
      for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
        if (!land(reg.adjKind[e])) continue;
        const q = owner[reg.adj[e]];
        if (q >= 0 && q !== p && alive(q)) out.add(q);
      }
    }
    return [...out].sort((x, y) => x - y);
  };
  /** 州 r 在陆上挨着 p 的国土 */
  const touches = (p: number, r: number): boolean => {
    for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) if (land(reg.adjKind[e]) && owner[reg.adj[e]] === p) return true;
    return false;
  };
  /** 此刻是哪国的国都所在州 */
  const isCapital = (r: number): boolean => {
    const o = owner[r];
    return o >= 0 && pm.settlements[capitalAt(pm.polities[o], sim.now)].region === r;
  };
  /** 两国国力差不到 limit 倍 */
  const close = (a: number, b: number, t: Year, limit: number) => {
    const pa = powerOf(a, t);
    const pb = powerOf(b, t);
    return Math.max(pa, pb) < limit * Math.min(pa, pb);
  };
  const calm = (p: number, t: Year) => {
    if (!pm.policies.size) return false;
    const v = policyAt(pm, p, t);
    return v?.preset === 'hold' || v?.preset === 'peace';
  };
  const friendly = (p: number, q: number, t: Year) => dm.friendly(p, q) || !!wm.iv?.allied(p, q, t);
  /** 国家方针(policy.ts)里哪一方把对方当仇国:不和它立约 */
  const enemies = (p: number, q: number, t: Year) => hates(pm, p, q, t) || hates(pm, q, p, t);

  /** 近 STALE_YEARS 年里 p、q 打过一场谁也没占到便宜的仗 */
  const stalemate = (p: number, q: number, t: Year): boolean => {
    for (let i = wm.wars.length - 1; i >= 0; i--) {
      const w = wm.wars[i];
      if (w.start < t - STALE_YEARS - 200) break;
      if (w.end === undefined || t - w.end > STALE_YEARS) continue;
      if (!((w.a === p && w.b === q) || (w.a === q && w.b === p))) continue;
      let na = 0;
      let nb = 0;
      for (const e of w.takes) {
        if (e.by === w.a) na++;
        else nb++;
      }
      if (Math.abs(na - nb) <= STALE_NET) return true;
    }
    return false;
  };

  /** p、q 共同的强邻:两国都陆上接壤、不友好,国力是两国各自的 FEAR 倍以上;挑最强的。没有 = −1 */
  const commonFoe = (p: number, q: number, np: number[], nq: number[], t: Year): number => {
    const pp = powerOf(p, t);
    const pq = powerOf(q, t);
    let best = -1;
    let bestPow = 0;
    for (const f of np) {
      if (f === q || !nq.includes(f) || friendly(p, f, t) || friendly(q, f, t)) continue;
      const pf = powerOf(f, t);
      if (pf < FEAR * pp || pf < FEAR * pq) continue;
      if (pf > bestPow) {
        bestPow = pf;
        best = f;
      }
    }
    return best;
  };

  /** 居间的国家:和立约各国都没在打仗、至少和其中两国陆上接壤,国力最大的(没有 = −1) */
  const mediator = (parties: number[], t: Year): number => {
    const seen = new Map<number, number>();
    for (const x of parties) for (const z of landNeighbors(x)) if (!parties.includes(z)) seen.set(z, (seen.get(z) ?? 0) + 1);
    let best = -1;
    let bestPow = 0;
    for (const [z, n] of [...seen].sort((a, b) => a[0] - b[0])) {
      if (n < 2 || dm.liegeOf(z) >= 0 || parties.some((x) => fighting(z, x))) continue;
      const pz = powerOf(z, t);
      if (pz > bestPow) {
        bestPow = pz;
        best = z;
      }
    }
    return best;
  };

  /** 会盟的城:国界上(和别的约国陆上接壤的州里)离几国国都路程之和最近的那座城(没有 = −1) */
  const meetingCity = (parties: number[]): number => {
    let best = -1;
    let bestD = Infinity;
    for (const x of parties) {
      for (const r of pm.lands[x]) {
        const c = pm.cityOf[r];
        if (c < 0 || !parties.some((y) => y !== x && touches(y, r))) continue;
        let d = 0;
        for (const y of parties) d += pm.capDist[y][r];
        if (!(d < Infinity)) continue;
        if (d < bestD || (d === bestD && reg.seat[r] < reg.seat[pm.settlements[best].region])) {
          bestD = d;
          best = c;
        }
      }
    }
    return best;
  };

  /** 州 r 能不能做中立地:有人住、不是谁的国都、不是中立地、没被作者永久划给谁;原主(约国)划出去以后还剩不止一两州 */
  const zoneable = (r: number, parties: readonly number[], t: Year): boolean => {
    const o = owner[r];
    // 这一刻刚易手的州不划(攻下来的那一刻就成了中立地,说不通)
    if (culture[r] < 0 || m.zoneAt[r] >= 0 || wm.since[r] >= t || wm.iv?.locked(r, t)) return false;
    if (o >= 0 && (!parties.includes(o) || pm.size[o] <= 2 || isCapital(r))) return false;
    return true;
  };
  /** 州 r 挨着约国之间交界的关隘(r 的主人和对面的约国不是同一国) */
  const atPass = (r: number, parties: readonly number[]): boolean => {
    const o = owner[r];
    for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
      const q = owner[reg.adj[e]];
      if (gate[e] >= 0 && land(reg.adjKind[e]) && q >= 0 && q !== o && parties.includes(q)) return true;
    }
    return false;
  };
  /** 州 r 在陆上碰到的约国(连同它的主人) */
  const touching = (r: number, parties: readonly number[]): number => {
    const got = new Set<number>();
    if (parties.includes(owner[r])) got.add(owner[r]);
    for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
      const q = owner[reg.adj[e]];
      if (land(reg.adjKind[e]) && q >= 0 && parties.includes(q)) got.add(q);
    }
    return got.size;
  };
  const popOf = (r: number, t: Year) => (pm.cityOf[r] >= 0 ? populationAt(pm.settlements[pm.cityOf[r]], t) : 0);
  /** 几个候选按 [分数…] 从大到小挑(分数一样的取治所地块小的) */
  const pickBest = (cands: Iterable<number>, score: (r: number) => number[]): number => {
    let best = -1;
    let bs: number[] = [];
    for (const r of cands) {
      const s = score(r);
      let better = best < 0;
      if (!better) {
        let i = 0;
        while (i < s.length && s[i] === bs[i]) i++;
        better = i < s.length ? s[i] > bs[i] : reg.seat[r] < reg.seat[best];
      }
      if (better) {
        best = r;
        bs = s;
      }
    }
    return best;
  };

  /**
   * 几国共建的中立地放在哪(推演自己设、以后干预推荐的也用这一套):陆上碰到的约国越多越靠前(至少两国);
   * 一样多时挨着约国交界的关隘的在前;再一样时有城的在前、人少的在前
   */
  const pickZone = (parties: number[], t: Year): number => {
    const cands = new Set<number>();
    for (const x of parties) {
      for (const r of pm.lands[x]) {
        cands.add(r);
        for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) if (land(reg.adjKind[e]) && owner[reg.adj[e]] < 0) cands.add(reg.adj[e]);
      }
    }
    const ok = [...cands].filter((r) => zoneable(r, parties, t) && touching(r, parties) >= 2).sort((a, b) => a - b);
    return pickBest(ok, (r) => [touching(r, parties), atPass(r, parties) ? 1 : 0, pm.cityOf[r] >= 0 ? 1 : 0, -popOf(r, t)]);
  };

  /** 议和划的缓冲中立地:这场仗里易手次数最多、此刻在两国交界上(两国都陆上碰到)的那一州 */
  const pickBuffer = (w: War, t: Year): number => {
    const ps = [w.a, w.b];
    const n = new Map<number, number>();
    for (const e of w.takes) n.set(e.region, (n.get(e.region) ?? 0) + 1);
    const ok = [...n.keys()].filter((r) => zoneable(r, ps, t) && touching(r, ps) >= 2).sort((a, b) => a - b);
    return pickBest(ok, (r) => [n.get(r)!, atPass(r, ps) ? 1 : 0, pm.cityOf[r] >= 0 ? 1 : 0, -popOf(r, t)]);
  };

  // ---- 约、中立地的增减 ----
  /**
   * 设中立地:记 neutral,州归属记成无主。作者下令的(cause = decree)另记选项(opt:不送人去、一直留着)和到哪年撤(until,预约 ZoneEnd)
   */
  const makeZone = (x: Treaty, r: number, parties: number[], t: Year, cause?: AnnalCause, opt = 0, until?: Year) => {
    const o = owner[r];
    const id = m.zones.length;
    const decree = cause === 'decree' ? { opt, ...(until !== undefined ? { until } : {}) } : {};
    note('neutral', { a: o, region: r, settlement: pm.cityOf[r], war: id, n: x.id, ps: parties, ...(cause ? { cause } : {}), ...decree });
    if (o >= 0) sim.setOwner(Layer.Polity, r, -1, Ev.Neutral);
    if (cause === 'decree' && until !== undefined) sim.schedule(until, Ev.ZoneEnd, id, 0);
  };

  /** 撤中立地:还给原主(还在、陆上还和它接壤),不然成了无主之地 */
  const dropZone = (z: Zone, t: Year) => {
    if (z.ended !== undefined) return;
    const r = z.region;
    let back = owner[r];
    if (back < 0 && z.owner >= 0 && alive(z.owner) && touches(z.owner, r) && dm.liegeOf(z.owner) < 0) back = z.owner;
    const give = owner[r] < 0 && back >= 0;
    note('neutral', { a: back, region: r, settlement: pm.cityOf[r], war: z.id, n: z.treaty, cause: 'lapse' });
    if (give) sim.setOwner(Layer.Polity, r, back, Ev.Neutral);
    // 没还给谁、成了无主之地:下一刻四周的国家重新往这里扩张(中立的时候进这里的都丢掉了)
    else if (owner[r] < 0) sim.schedule(t + 1 / 256, Ev.Respread, REOPEN + sim.annalCount - 1, 0);
  };

  /** 约废:记 expire(cause = lapse:剩不到两国;没有 = 约满不续;n = 立约时几国),中立地撤销;有限竞争之约废了,下一刻约国旁边的无主之地解禁 */
  const endTreaty = (x: Treaty, t: Year, cause?: AnnalCause) => {
    const act = m.members(x);
    note('expire', { a: act[0] ?? -1, b: act[1] ?? -1, ps: act, war: x.id, n: x.size, ...(cause ? { cause } : {}), ...(x.decree ? { opt: x.multi ? OPT_LIMITED : 0 } : {}) });
    if (x.multi) sim.schedule(t + 1 / 256, Ev.Respread, REOPEN + sim.annalCount - 1, 0);
    if (x.zone >= 0 && !m.zones[x.zone].lasting) dropZone(m.zones[x.zone], t);
  };

  /** 作者下令立的约:期限(0 = 一直)、有限竞争、不许背约、居间的国家;同时设的中立地的选项(见 makeZone) */
  interface DecreeTerms {
    term: number;
    multi: boolean;
    keep: boolean;
    by: number;
    zoneOpt?: number;
    zoneUntil?: Year;
  }

  /**
   * 立约:记 treaty,预约期满;三国以上的、议和划缓冲的同时设中立地(zone = 那州,−1 = 不设)。
   * 作者下令立的(d):期限、种类、居间照作者的(期限 0 = 一直有效,不预约期满),记 cause = decree 和 opt
   */
  const create = (parties: number[], t: Year, foe: number, zone: number, cause?: AnnalCause, d?: DecreeTerms) => {
    const id = m.treaties.length;
    const term = d ? d.term : parties.length >= 3 ? TERM_MULTI : TERM_PAIR;
    const sid = zone >= 0 && pm.cityOf[zone] >= 0 ? pm.cityOf[zone] : meetingCity(parties);
    const by = d ? d.by : mediator(parties, t);
    const opt = d ? { opt: (d.multi ? OPT_LIMITED : 0) | (d.keep ? OPT_KEEP : 0) } : {};
    note('treaty', { a: parties[0], b: parties[1], ps: parties, region: sid >= 0 ? pm.settlements[sid].region : -1, settlement: sid, war: id, n: term, foe, by, ...(cause ? { cause } : {}), ...opt });
    if (term > 0) sim.schedule(t + term, Ev.TreatyEnd, id, 0);
    if (zone >= 0) makeZone(m.treaties[id], zone, parties, t, cause, d?.zoneOpt ?? 0, d?.zoneUntil);
  };

  /** 查一遍还没废的约:剩不到两国的约废;中立地那州被谁占了(作者划州、立国)的撤销 */
  const sweep = (t: Year) => {
    for (const x of m.live.slice()) {
      if (x.zone >= 0) {
        const z = m.zones[x.zone];
        if (z.ended === undefined && owner[z.region] >= 0) dropZone(z, t);
      }
      if (m.members(x).length < 2) endTreaty(x, t, 'lapse');
    }
    // 作者下令划的、一直留着的中立地:约废了也还在,那州被谁占了(作者划州、立国)照样撤
    for (const z of m.zones) {
      if (!z || !z.lasting || z.ended !== undefined || owner[z.region] < 0) continue;
      const x = m.treaties[z.treaty];
      if (!x || x.ended !== undefined) dropZone(z, t);
    }
  };

  /** p 和约里的 q 一起背约开战(宣战那一刻):记 breach,p 退出,约的中立地当即撤销;剩不到两国的约废 */
  const breakOff = (p: number, q: number, t: Year, war: number) => {
    for (const x of m.live.slice()) {
      if (!m.member(x, p) || !m.member(x, q)) continue;
      note('breach', { a: p, b: q, war, n: x.id });
      if (x.zone >= 0 && !m.zones[x.zone].lasting) dropZone(m.zones[x.zone], t);
      if (m.members(x).length < 2) endTreaty(x, t, 'lapse');
    }
  };

  // ---- 立约(看邦交时)----
  const tryTreaty = (p: number, k: number, t: Year): boolean => {
    if (atWar(p) || wm.iv?.halted(p, t)) return false;
    const np = landNeighbors(p);
    let q = -1;
    let stale = false;
    let foe = -1;
    let bestScore = 0;
    const nb = new Map<number, number[]>();
    for (const c of np) {
      if (dm.liegeOf(c) >= 0 || atWar(c) || friendly(p, c, t) || enemies(p, c, t) || t - (m.rest.get(pairKey(p, c)) ?? -Infinity) < TREATY_REST) continue;
      if (!close(p, c, t, TREATY_RATIO)) continue;
      const s = stalemate(p, c, t);
      const nc = landNeighbors(c);
      nb.set(c, nc);
      const f = commonFoe(p, c, np, nc, t);
      if (!s && f < 0) continue;
      const score = (s ? REASON : 1) * (f >= 0 ? REASON * FOE_FIRST : 1) * (Math.min(powerOf(p, t), powerOf(c, t)) / Math.max(powerOf(p, t), powerOf(c, t)));
      if (score > bestScore) {
        bestScore = score;
        q = c;
        stale = s;
        foe = f;
      }
    }
    if (q < 0) return false;
    let odds = TREATY_ODDS * (stale ? REASON : 1) * (foe >= 0 ? REASON : 1);
    if (calm(p, t)) odds *= CALM;
    if (calm(q, t)) odds *= CALM;
    if (keyed(base, pm.ptag[p], k, U_TREATY) >= odds) return false;
    // 拉进第三、第四国:和两国都陆上接壤(或者和其中一国接壤、也挨着那个共同的强邻 —— 一样怕它)、国力和其中一国差不多、
    // 没在和约国打仗的邻国,各有 JOIN 的机会
    const parties = [p, q];
    const nq = nb.get(q)!;
    const nf = foe >= 0 ? landNeighbors(foe) : [];
    for (const z of [...new Set([...np, ...nq])].sort((a, b) => a - b)) {
      if (parties.length >= MAX_PARTIES) break;
      if (parties.includes(z) || z === foe || dm.liegeOf(z) >= 0 || parties.some((x) => fighting(z, x) || enemies(z, x, t)) || wm.iv?.halted(z, t)) continue;
      if (!(np.includes(z) && nq.includes(z)) && !nf.includes(z)) continue;
      if ((!close(z, p, t, JOIN_RATIO) && !close(z, q, t, JOIN_RATIO)) || (foe >= 0 && friendly(z, foe, t))) continue;
      if (parties.some((x) => t - (m.rest.get(pairKey(x, z)) ?? -Infinity) < TREATY_REST)) continue;
      if (keyed4(base, pm.ptag[p], pm.ptag[z], k, U_JOIN) < JOIN) parties.push(z);
    }
    const zone = parties.length >= 3 && keyed(base, pm.ptag[p], k, U_ZONE) < MULTI_ZONE ? pickZone(parties, t) : -1;
    create(parties, t, foe, zone);
    return true;
  };

  dm.bound = (p, q) => !!m.bound(p, q);
  dm.limits = (q, L) => m.limits(q, L);
  dm.onCheck = (p, k, t) => {
    sweep(t);
    tryTreaty(p, k, t);
  };
  const sever = dm.sever;
  dm.sever = (x, y, t, war) => {
    sever?.(x, y, t, war);
    if (m.live.length) breakOff(x, y, t, war);
  };

  // ---- 背约(看邻国时)----
  wm.treaty = (p, q, t, pow) => {
    if (!m.live.length) return -1;
    const x = m.bound(p, q);
    if (!x) return -1;
    // 作者下令立的约选了"约期内不许背约":约里的两国不背约(作者下令开战照样记背约)
    if (m.live.some((y) => y.keep && m.member(y, p) && m.member(y, q))) return 0;
    // 国家方针(policy.ts)把对方当仇国:约拦不住,不等满年就可能背约
    const grudge = hates(pm, p, q, t);
    if (!grudge && t - x.since < BREACH_AGE) return 0;
    const Q = pm.polities[q];
    const d = Q.dynasties;
    const strong = pow[p] >= BREACH_PREY * pow[q];
    // 改制开的一段(共和、军政府、迎回旧王室)不算改朝换代之乱
    const dl = d && d.length > 1 ? d[d.length - 1] : undefined;
    const chaos =
      wm.active.some((w) => (w.a === q || w.b === q) && w.a !== p && w.b !== p) || t - pm.capMoved[q] < CHAOS_YEARS || (!!dl && !dl.regime && dl.house === undefined && t - dl.year < CHAOS_YEARS);
    const gone = x.foe >= 0 && !alive(x.foe);
    return grudge || strong || chaos || gone ? BREACH_ODDS : 0;
  };

  // ---- 议和顺带立约 ----
  wm.onTruce = (w, t) => {
    const a = w.a;
    const b = w.b;
    if (!alive(a) || !alive(b) || dm.liegeOf(a) >= 0 || dm.liegeOf(b) >= 0 || fighting(a, b) || friendly(a, b, t) || enemies(a, b, t)) return;
    if (!landNeighbors(a).includes(b) || !close(a, b, t, TREATY_RATIO) || t - (m.rest.get(pairKey(a, b)) ?? -Infinity) < TREATY_REST) return;
    const at = Math.round(t * 256);
    if (keyed4(base, pm.ptag[a], pm.ptag[b], at, U_PEACE) >= PEACE_TREATY) return;
    const zone = keyed4(base, pm.ptag[a], pm.ptag[b], at, U_BUFFER) < PEACE_ZONE ? pickBuffer(w, t) : -1;
    create([a, b], t, -1, zone, 'peace');
  };

  // ---- 约满 ----
  sim.on(Ev.TreatyEnd, (id, _b, t) => {
    const x = m.treaties[id];
    if (!x || x.ended !== undefined || quantize(x.since + x.term) !== t) return;
    const act = m.members(x);
    if (act.length < 2) {
      endTreaty(x, t, 'lapse');
      return;
    }
    let lo = Infinity;
    let hi = 0;
    for (const p of act) {
      const v = powerOf(p, t);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const odds = Math.min(RENEW_MAX, RENEW_P * (alive(x.foe) ? RENEW_FOE : 1)) * RENEW_DECAY ** x.renewals;
    if (hi < RENEW_RATIO * lo && !act.some((p) => act.some((q) => q !== p && fighting(p, q))) && keyed4(base, pm.ptag[act[0]], pm.ptag[act[1]], Math.round(t * 256), U_RENEW) < odds) {
      note('treaty', { a: act[0], b: act[1], ps: act, war: x.id, n: TERM_RENEW, foe: x.foe, cause: 'renew' });
      sim.schedule(t + TERM_RENEW, Ev.TreatyEnd, x.id, 0);
      return;
    }
    endTreaty(x, t);
  });

  // ---- 中立地:谁都不进;有限竞争之约:不进约国旁边的无主之地 ----
  pm.closed = (r, pid) => {
    if (m.zoneAt[r] >= 0) return true;
    if (pid < 0 || !m.live.length) return false;
    for (const x of m.live) {
      if (!x.multi || !m.member(x, pid)) continue;
      for (let e = reg.adjStart[r]; e < reg.adjStart[r + 1]; e++) {
        const q = owner[reg.adj[e]];
        if (q >= 0 && q !== pid && land(reg.adjKind[e]) && m.member(x, q)) return true;
      }
    }
    return false;
  };

  /**
   * p 此刻能往哪处中立地放人:p 在约里、约的中立地还在、没住满(按约的先后挑第一处;没有 = undefined)。
   * fell = p 这一刻刚亡(还没查过约):看它亡以前在不在约里,约里还要有别国(两国之约这时还没因为它亡了作废),
   * 中立地那州还没被谁占了(作者划州、立国;查约时会撤)
   */
  const zoneFor = (p: number, t: Year, fell = false): Zone | undefined => {
    for (const x of m.live) {
      if (x.zone < 0 || !(fell ? m.held(x, p) && m.members(x).length >= 1 : m.member(x, p))) continue;
      const z = m.zones[x.zone];
      if (fell && owner[z.region] >= 0) continue;
      // 作者下令划的、选了"不送人去"的不往这里放人
      if (z.ended === undefined && !z.quiet && m.residents(z, t) < ZONE_CAP) return z;
    }
    return undefined;
  };
  const exile = (p: number, z: Zone, cause: AnnalCause, n: number) =>
    note('exile', { a: p, region: z.region, settlement: pm.cityOf[z.region], war: z.id, n, cause });

  // ---- 亡国之君出奔:有中立地可去的先奔中立地,不然末代之君出奔的奔邻国(exile.ts);再查一遍约(两国之约剩一国就废、中立地跟着撤)----
  const refuge = refugeFinder(pm, wm, dm, owner, (y, q) => m.live.some((x) => m.held(x, y) && m.member(x, q)));
  wm.onFall = (_w, x, y, t) => {
    const z = m.live.length ? zoneFor(y, t, true) : undefined;
    if (z) exile(y, z, 'fled', -1);
    else {
      const f = refuge(x, y, t);
      if (f) note('exile', { a: y, b: f.host, region: f.region, settlement: f.settlement, war: -1, n: f.tie, cause: 'fled' });
    }
    if (m.live.length) sweep(t);
  };

  // ---- 新君即位:失势的宗室、被废的末代之君徙到中立地(在宗室据地争位之前看)----
  const reign = pm.onReign;
  pm.onReign = (pid, k, list, t) => {
    if (m.live.length && m.zones.length && banish(pid, k, list, t)) return;
    reign?.(pid, k, list, t);
  };
  /** 徙了一位宗室(这一回不再有宗室据地争位)= true */
  const banish = (pid: number, k: number, list: readonly Reign[], t: Year): boolean => {
    const P = pm.polities[pid];
    if (P.ended !== undefined || !royalSeg(P, list[k].dynasty)) return false;
    const z = zoneFor(pid, t);
    if (!z) return false;
    const R = list[k - 1];
    const X = list[k];
    if (R.crown || X.crown) return false;
    if (R.dynasty !== X.dynasty) {
      // 改朝换代:新朝的根据地就是原来的国都 = 旧朝末代之君被废(people.ts 同一个判据);被废的年份 = 改朝换代那一刻
      if (X.j !== 0 || R.cut !== undefined || R.death) return false;
      let e: Readonly<Annal> | null = null;
      for (let i = sim.annalCount - 1; i >= 0; i--) {
        const a = sim.annal(i);
        if (a.year < t - 1) break;
        if (a.kind === 'dynasty' && a.a === pid) {
          e = a;
          break;
        }
      }
      if (!e || pm.settlements[capitalAt(P, e.year - 1 / 512)].region !== e.region) return false;
      if (keyed4(base, pm.ptag[pid], k, 0, U_DEPOSE) < EXILE_P) exile(pid, z, 'deposed', e.year);
      return false;
    }
    // 同一朝里交接(和宗室据地争位同样的条件):先君寿终、不是遇弑、不是作者让他去世
    if (R.death || R.cut !== undefined || R.natural !== t || X.j === 0 || murderedAt(pm.rbase, pm.rtag[pid], R.k)) return false;
    // 先君晚年新君已引兵入朝、杀过一轮兄弟(regency.ts):和宗室据地争位一样不另看
    if (pm.regents.get(pid)?.some((g) => g.kind === 'march' && g.k === R.k)) return false;
    const sons = claimants(pm.rbase, pm.rtag[pid], R, P, t);
    if (!sons.length || keyed4(base, pm.ptag[pid], k, 0, U_HEIR) >= EXILE_P) return false;
    exile(pid, z, 'heir', sons[0]);
    return true;
  };

  // ---- 作者下令划的中立地到期 ----
  sim.on(Ev.ZoneEnd, (id, _b, t) => {
    const z = m.zones[id];
    if (!z || z.ended !== undefined || z.until === undefined || quantize(z.until) !== t) return;
    dropZone(z, t);
  });

  // ---- 作者下令:立约、划中立地(干预;interventions.ts 在干预那一刻调)----
  /** 演一国时它提出立约,q 肯不肯:仇国不肯、做了别国藩属的不肯;国力相近、都怕同一个强邻、近年打成僵持的更肯,方针守成和平的更肯,正和它打仗的减半 */
  const willing = (a: number, q: number, t: Year, i: number): boolean => {
    if (enemies(a, q, t)) return false;
    const L = dm.liegeOf(q);
    if (L >= 0 && L !== a) return false;
    let odds = ASK_ODDS;
    if (close(a, q, t, TREATY_RATIO)) odds *= REASON;
    if (commonFoe(a, q, landNeighbors(a), landNeighbors(q), t) >= 0) odds *= REASON;
    if (stalemate(a, q, t)) odds *= REASON;
    if (calm(q, t)) odds *= CALM;
    if (fighting(a, q)) odds *= 0.5;
    return keyed4(base, pm.ptag[a], pm.ptag[q], i, U_ASK) < Math.min(ASK_MAX, odds);
  };
  /** 几国两两之间正在打的仗当即议和 */
  const truce = (ps: readonly number[], t: Year) => {
    for (const w of wm.active.filter((x) => ps.includes(x.a) && ps.includes(x.b))) wm.makePeace!(w, t);
  };
  /** 几国前两国共同的强邻(没有 = −1) */
  const foeOf = (ps: readonly number[], t: Year) => (ps.length >= 2 ? commonFoe(ps[0], ps[1], landNeighbors(ps[0]), landNeighbors(ps[1]), t) : -1);
  /** 作者选的那一州能不能做这几国的中立地:有人住、还不是中立地、原属其中一国或无主、不是国都、没被作者永久划给谁 */
  const zoneOk = (r: number, ps: readonly number[], t: Year): boolean =>
    r >= 0 && r < culture.length && culture[r] >= 0 && m.zoneAt[r] < 0 && (owner[r] < 0 || ps.includes(owner[r])) && !isCapital(r) && !wm.iv?.locked(r, t);

  m.decree = (v, i, a, t, iv) => {
    const sid = alive(a) ? capitalAt(pm.polities[a], t) : -1;
    const at = { a, region: sid >= 0 ? pm.settlements[sid].region : -1, settlement: sid, war: i };
    if (!alive(a)) {
      sim.record('intervene', { ...at, b: -3 });
      return;
    }
    const others: number[] = [];
    for (const k of v.ps) {
      const q = iv.resolve(k);
      if (q >= 0 && q !== a && alive(q) && !others.includes(q)) others.push(q);
    }
    if (!others.length) {
      sim.record('intervene', { ...at, b: IV_NOBODY });
      return;
    }
    // 演一国时下的:对方照推演的规矩定肯不肯(不肯的不入约)
    const yes = v.ask ? others.filter((q) => willing(a, q, t, i)) : others;
    if (v.kind === 'treaty') {
      if (!yes.length) {
        sim.record('intervene', { ...at, b: IV_REFUSED });
        return;
      }
      const parties = [a, ...yes];
      const r = v.zone ? regionOfKey(v.zone, iv.of) : -1;
      const by = v.by ? iv.resolve(v.by) : -1;
      sim.record('intervene', { ...at, b: -1 });
      // 先记约(编年史把它并进干预那一条,要紧挨着),再让正在交战的议和
      create(parties, t, foeOf(parties, t), zoneOk(r, parties, t) ? r : -1, 'decree', {
        term: v.term ?? 0,
        multi: !!v.limited,
        keep: !!v.keep,
        by: by >= 0 && alive(by) && !parties.includes(by) ? by : -1,
      });
      truce(parties, t);
      return;
    }
    // 划中立地:那州原属的国家(下令的不算)不肯就划不成
    const r = regionOfKey(v.region, iv.of);
    const here = { ...at, region: r, settlement: r >= 0 && r < culture.length ? pm.cityOf[r] : -1 };
    if (r < 0 || r >= culture.length) {
      sim.record('intervene', { ...at, b: -2 });
      return;
    }
    const o = owner[r];
    if (!yes.length || (o >= 0 && o !== a && others.includes(o) && !yes.includes(o))) {
      sim.record('intervene', { ...here, b: IV_REFUSED });
      return;
    }
    const founders = [a, ...yes];
    if (!zoneOk(r, founders, t)) {
      sim.record('intervene', { ...here, b: IV_NO_ZONE });
      return;
    }
    sim.record('intervene', { ...here, b: -1 });
    const opt = (v.quiet ? OPT_QUIET : 0) | (v.lasting ? OPT_LASTING : 0);
    // 几国已同在一份约里、那份约还没有中立地:依那份约设;不然同时立一个互不侵犯之约(TERM_DECREE 年)
    const x = m.live.find((y) => y.zone < 0 && founders.every((p) => m.member(y, p)));
    if (x) {
      makeZone(x, r, founders, t, 'decree', opt, v.until);
      return;
    }
    create(founders, t, foeOf(founders, t), r, 'decree', { term: TERM_DECREE, multi: false, keep: false, by: -1, zoneOpt: opt, zoneUntil: v.until });
    truce(founders, t);
  };

  return m;
}

/**
 * 由 Civ 重建立约的推演状态(resumeCiv 调用,在 resumePlague 之后):约、中立地、背约退出的都从史事里读,
 * 还没到期的约补上期满(立约 / 续约那一刻预约的)
 */
export function resumeTreaties(sim: CivSim, world: World, civ: Civ): void {
  const pm = polityModelOf(sim);
  const dm = diplomacyModelOf(sim);
  if (!pm || !dm || !warModelOf(sim)) return;
  const tm = new TreatyModel(pm, dm);
  for (const e of civ.annals) tm.apply(e);
  installTreaties(sim, pm, world, tm);
  // 还没到期的约(期满)、作者下令划的还没到撤的那年的中立地(到期):按预约它们的那条史事的先后补上 ——
  // 同一刻预约、又撞在同一刻的,先后和一口气推完一样(那时是记完立约 / 续约 / 设中立地当下预约的)
  const booked = new Map<string, number>();
  civ.annals.forEach((e, i) => {
    if (e.kind === 'treaty') booked.set(`t${e.war}`, i);
    else if (e.kind === 'neutral' && e.cause === 'decree' && e.until !== undefined) booked.set(`z${e.war}`, i);
  });
  const due: { i: number; go: () => void }[] = [];
  for (const x of tm.live) {
    const at = x.since + x.term;
    if (x.term > 0 && quantize(at) > sim.now) due.push({ i: booked.get(`t${x.id}`) ?? -1, go: () => sim.schedule(at, Ev.TreatyEnd, x.id, 0, x.since) });
  }
  for (const z of tm.zones) {
    if (z && z.ended === undefined && z.until !== undefined && quantize(z.until) > sim.now) due.push({ i: booked.get(`z${z.id}`) ?? -1, go: () => sim.schedule(z.until!, Ev.ZoneEnd, z.id, 0, z.from) });
  }
  due.sort((a, b) => a.i - b.i);
  for (const d of due) d.go();
  // 解禁几州的下一刻还没到的(此刻正好撤了中立地、废了有限竞争之约):补上;已经过了的由 resumePolities 重放
  civ.annals.forEach((e, i) => {
    if (((e.kind === 'neutral' && e.cause === 'lapse' && e.a < 0) || limitedEnd(e)) && quantize(e.year + 1 / 256) > sim.now) {
      sim.schedule(e.year + 1 / 256, Ev.Respread, REOPEN + i, 0);
    }
  });
}

// ---------------------------------------------------------------------------
// 统计(scripts/gen-stats.ts、单测用)

export interface TreatyStats {
  /** 立约(自己立的、议和顺带立的)、三国以上的、续约、背约、约满不续、约废(剩不到两国) */
  treaties: number;
  peaceTreaties: number;
  multi: number;
  renewals: number;
  breaches: number;
  expiries: number;
  lapses: number;
  /** 每份约从立约到约废的年数(到结束还在的算到结束)之和 */
  years: number;
  /** 中立地几处、撑的年数之和、放逐(宗室、被废的君主)几人、出奔中立地几人;出奔邻国几人(exile.ts) */
  zones: number;
  zoneYears: number;
  exiles: number;
  fled: number;
  abroad: number;
}

export function treatyStats(civ: Civ): TreatyStats {
  const out: TreatyStats = { treaties: 0, peaceTreaties: 0, multi: 0, renewals: 0, breaches: 0, expiries: 0, lapses: 0, years: 0, zones: 0, zoneYears: 0, exiles: 0, fled: 0, abroad: 0 };
  const start = new Map<number, Year>();
  const end = new Map<number, Year>();
  const zFrom = new Map<number, Year>();
  const zEnd = new Map<number, Year>();
  for (const e of civ.annals) {
    if (e.kind === 'treaty') {
      if (e.cause === 'renew') out.renewals++;
      else {
        out.treaties++;
        if (e.cause === 'peace') out.peaceTreaties++;
        if ((e.ps?.length ?? 2) >= 3) out.multi++;
        start.set(e.war, e.year);
      }
    } else if (e.kind === 'breach') out.breaches++;
    else if (e.kind === 'expire') {
      if (e.cause === 'lapse') out.lapses++;
      else out.expiries++;
      end.set(e.war, e.year);
    } else if (e.kind === 'neutral') {
      if (e.cause === 'lapse') zEnd.set(e.war, e.year);
      else {
        out.zones++;
        zFrom.set(e.war, e.year);
      }
    } else if (e.kind === 'exile') {
      if (e.cause === 'fled' && e.war < 0) out.abroad++;
      else if (e.cause === 'fled') out.fled++;
      else out.exiles++;
    }
  }
  for (const [id, y] of start) out.years += (end.get(id) ?? civ.endYear) - y;
  for (const [id, y] of zFrom) out.zoneYears += (zEnd.get(id) ?? civ.endYear) - y;
  return out;
}

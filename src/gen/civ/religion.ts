/**
 * 信仰:推演里每 STEP 年算一步(挂在推演引擎上,和发展度一样随推演往后走),推完整理成 Civ.religion。
 * 眼下只是"算着":推演里别的规则(打仗、邦交、出奔、同化、动荡……)还不读它,国界、兴亡、战争、人物和不算信仰时一个都不变。
 * 纯计算,不碰 DOM。
 *
 *   - 民间信仰:每个民族自带一种(Faith.culture = 民族编号),州一有人住就是它;民族换了(同化、迁徙),民间信仰跟着换(按日志,换的那一刻就换)
 *   - 大教:2–5 个(按州数),在 FOUND_SPAN 里几个年份上(那年没有合适的城:不到两个大教就往后推,够两个就不创这一个),挑当时人口最多、离别的圣城够远、还信民间信仰的大城,
 *     由一位创教者创立;那座城是圣城
 *   - 传播:每 STEP 年向相邻的州传一次;同一国里快,奉它为国教的国里更快,跨国界、出海、翻山慢,已经信了别的大教的州很难改信
 *   - 国教:一国里某个大教占到 ADOPT 以上的州,或者国都改信了,国君皈依、立为国教;亡国时国教跟着结束
 *   - 教派:大教立教 SCHISM_AGE 年以后,另一片大陆(或离圣城很远)的大国奉它为国教 SCHISM_STATE_YEARS 年以上,
 *     有机会自立一派(国里信本教的州跟着改信);一个教最多分出两派
 *   - 圣城被国教不是这个教的国家夺了,记一件"圣城"的事(从部落地带手里拿到的不算)
 *
 * 第 y 年那一步在第 y 年那一刻的事件都办完以后算(CivSim.everyYears),只读那一刻(含)以前的历史:归属按日志,城的人口、国都、亡国按那时的;
 * 名字(民族、城推完才起名)和皈依的国君(人物推完才排)整理时补上。所以推演里逐步算的和推完照历史再算一遍(buildReligion)逐字节一样。
 * 接着推(CivSim.fromCiv)不存状态:照历史从第 0 年重放到接着推的那一刻(resumeReligion),之后接着逐步算。
 * 推演里的规则经 faithSimOf(sim) 问"这州眼下信什么(FaithSim.faith)、这国眼下的国教(FaithSim.stateFaith)"
 * —— 眼下 = 已经算过的最近一步:第 y 年那一刻的事件看到的是第 y − STEP 年那一步,y 以后的才看到第 y 年的。
 *
 * 结果是 Civ.religion:信仰列表、大事、各国国教,和一本"各州信仰"的变化日志(加每 100 年一份检查点),
 * 任意年份的各州信仰用 faithAt 查(和 ownersAt 一样:最近的检查点 + 补日志)。
 * 信仰的编号按出现的先后排:推演前就定了的民族的民间信仰最先(按民族编号),之后大教、教派、推演中分化出来的民族的民间信仰
 * 按创立 / 分化的先后接着排 —— 和每一样都只看它以前的历史一起,推到哪一年都一样:接着往后推,已经有的信仰、大事都不变。
 *
 * 随机数一律 keyed(subSeed(seed, 'trial-religion'), …)(用途名沿用最初试算时的叫法:改了它,同一个种子的信仰就全变了)。
 * 以后改这里的算法、让同一个种子的信仰变了,要把 edits.ts 的 GENERATOR_VERSION 加一。
 */
import type { ChangeLog, Civ, Culture, Faith, FaithEvent, FaithForm, Polity, Regions, Religion, Settlement, StateFaith, Year } from './types';
import type { World } from '../world';
import type { CivSim } from './sim';
import type { CultureModel } from './cultures';
import type { PolityModel } from './polities';
import { AdjKind, Layer } from './types';
import { ownersAt, type Owners } from './timeline';
import { capitalAt, populationAt } from './growth';
import { personNamers } from './naming';
import { keyed, subSeed } from '../util';

/** 每多少年算一步 */
const STEP = 5;
/** 创教的年份段 */
const FOUND_SPAN: [number, number] = [900, 2250];
/** 圣城彼此至少隔多少步(州图) */
const HOLY_GAP = 9;
/** 每一步、每条邻边传过去的机会,和各种情形的倍数 */
const SPREAD = 0.022;
const SAME_STATE = 2.2;
const STATE_FAITH = 5;
const CROSS_BORDER = 0.35;
const TRIBAL = 0.6;
const FROM_GREAT = 0.06;
const OTHER_STATE = 0.25;
const SEA = 0.55;
const MOUNTAIN = 0.5;
/** 一国里某大教占到这么多州就立为国教 */
const ADOPT = 0.3;
/** 教派:大教立教多少年后才可能分;一国里至少多少州;隔多远(州图步数,或不在一片大陆);每次看分的机会;奉为国教至少多少年 */
const SCHISM_AGE = 350;
const SCHISM_MIN = 14;
const SCHISM_FAR = 10;
const SCHISM_ODDS = 0.12;
const SCHISM_STATE_YEARS = 120;
/** 一个大教最多分出几派 */
const SCHISM_MAX = 2;
/** 每隔多少年看一次教派分立 */
const SCHISM_EVERY = 50;
/** 检查点间隔(年) */
const CHECKPOINT = 100;

/** 大教的颜色(按创立先后取):金、蓝、绿、紫、灰蓝 */
export const GREAT_COLORS: readonly [number, number, number][] = [
  [214, 152, 32],
  [52, 98, 186],
  [30, 150, 112],
  [156, 72, 150],
  [96, 112, 134],
];
/** 民间信仰的颜色(米灰) */
export const FOLK_COLOR: [number, number, number] = [214, 207, 192];

/** 东方语感的教名用字(避开现实里有的教名、宗派名) */
export const EAST_WORDS = ['玄晖', '澄元', '照冥', '衡一', '昭虚', '守素', '含光', '归穹'];
/** 民族的生计 → 创出的大教可能是哪几类 */
const FORM_BY_KIND: Record<string, FaithForm[]> = {
  river: ['一神', '二元'],
  lake: ['多神', '哲理'],
  farm: ['二元', '多神', '哲理'],
  sea: ['多神', '一神'],
  highland: ['修行', '哲理'],
  nomad: ['一神', '多神'],
  forest: ['多神', '修行'],
};

/** 颜色变浅(t > 0,往白里调)/ 变深(t < 0) */
export function shade([r, g, b]: readonly number[], t: number): [number, number, number] {
  const m = (c: number) => Math.round(t >= 0 ? c + (255 - c) * t : c * (1 + t));
  return [m(r), m(g), m(b)];
}

/** 教派相对圣城在哪个方向(东西南北;东西跨 180° 经线照算) */
function sectDir(world: World, holyCell: number, capCell: number): string {
  const { x, y } = world.mesh;
  const width = world.width;
  let dx = x[capCell] - x[holyCell];
  if (dx > width / 2) dx -= width;
  if (dx < -width / 2) dx += width;
  const dy = y[capCell] - y[holyCell];
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? '东' : '西') : dy > 0 ? '南' : '北';
}

/** 信仰推演读的历史:推演里是引擎上的(随推演往后长),推完再算是 Civ 里的。每一步现取(推演里日志会换数组、民族表会插进分化出来的民族) */
export interface FaithSource {
  /** 变化日志(按年份排好) */
  log(): Readonly<Pick<ChangeLog, 'size' | 'year' | 'region' | 'layer' | 'value'>>;
  settlements(): readonly Settlement[];
  polities(): readonly Polity[];
  cultures(): readonly Culture[];
}

/** 地形大事以前的一段:到 until 为止(不含)用这一段的州(编号各段一样,后面的段只多出新州) */
export interface FaithEra {
  until: Year;
  regions: Regions;
}

/** 名字、君主推完才有(民族、城的名字推完才起,人物推完才排):先记下起名要的,整理时(FaithSim.finish)按出现先后补上 */
type Naming = { kind: 'folk'; cu: Culture } | { kind: 'great'; cu: Culture; cell: number } | { kind: 'sect'; cap: number; holySeat: number; capSeat: number };

/**
 * 信仰推演(见文件头):每 STEP 年 step 一次(第 0、5、10…… 年),只读那一年(含)以前的历史;推完 finish 整理成 Civ.religion。
 * 推演里挂在引擎上(installReligion / resumeReligion,everyYears:那一年那一刻的事件都办完以后算),
 * 推演里的规则可以经 faithSimOf(sim) 问"这州眼下信什么(faith)、这国眼下的国教(stateFaith)",早先某一年的用 faithAt / stateFaithAt。
 * 推完再照历史算一遍(buildReligion)也是它,结果和推演里逐步算的逐字节一样
 */
export class FaithSim {
  /** 算到哪一年(最近一步的年份;还没算 = −Infinity) */
  year: Year = -Infinity;
  /** 州数(这一段推演的州;地形大事以前的段按编号是它的前一部分) */
  readonly R: number;
  /** 各州眼下的信仰(信仰编号;−1 = 没人住)。只读 */
  readonly faith: Int16Array;
  private readonly seed: number;
  private readonly src: FaithSource;
  private readonly eras: readonly FaithEra[];
  /** 最后一段(这次推演)的州 */
  private readonly last: Regions;
  private era = 0;
  private reg: Regions;
  /** 自然兴起的民族有几支:教派分立的随机数按"它们的个数 + 第几个大教 / 教派"取 —— 备没备干预立国的民族、后来分化出几支,之前的信仰都一样 */
  private readonly roots: number;
  private readonly faiths: Faith[] = [];
  private readonly naming: Naming[] = [];
  /** 民族 → 它的民间信仰的编号(还没有的不在里面:推演中分化出来的民族,分出来那一刻才有)。按民族本身认:还没兴起的干预立国民族编号会往后挪 */
  private readonly folkOf = new Map<Culture, number>();
  /** 大教、教派 → 第几个(按创立先后) */
  private readonly ordinal = new Map<number, number>();
  private readonly events: FaithEvent[] = [];
  private readonly states: StateFaith[] = [];
  private readonly book: FaithBook;
  private readonly checkpoints: Religion['checkpoints'] = [];
  private readonly lastCulture: Int16Array;
  /** 各国眼下的国教(−1 = 没有;国家多了跟着长) */
  private stateOf = new Int32Array(0);
  /** 各大教分出了几派 */
  private readonly sects = new Map<number, number>();
  /** 各大教是哪个民族创的(教派起名的语感跟着它) */
  private readonly foundedBy = new Map<number, Culture>();
  /** 各大教的圣城上一步属哪国(还没看过的不在里面) */
  private readonly holyOwner = new Map<number, number>();
  /** 已经传入过的(国家, 大教):记过"传入"就不再记 */
  private readonly entered = new Set<number>();
  /** 州 → 州里的城(按编号);cities = 已经放进来的城数 */
  private readonly cityIn: number[][];
  private cities = 0;
  /** 信仰 → 是不是民间信仰、所属的大教(查表:每步要查几十万次) */
  private isFolk: Uint8Array;
  private rootArr: Int16Array;
  /** 创教的年份;下一个是第几个 */
  private readonly foundYears: number[];
  private nextFound = 0;
  /** 各州的归属:按年份往后翻日志(和 ownersAt 同一个结果,只是一步步接着翻,不每步从检查点重来);li = 翻到日志第几条 */
  private readonly ownC: Int16Array;
  private readonly ownP: Int16Array;
  private li = 0;
  private readonly next: Int16Array;
  /** 各国有几个州;(国家, 大教) → 几个州信它(含教派);(国家, 信仰) → 几个州 */
  private total = new Int32Array(0);
  private inPolity = new Int32Array(0);
  private count = new Int32Array(0);
  /** 国教那一步:按第一次扫到的先后排的国家、各国按第一次扫到的先后排的信仰(同样多时取先扫到的) */
  private seenP = new Int32Array(0);
  private readonly order: number[] = [];
  private faithOrder: number[][] = [];
  /** 算了几步 */
  private steps = 0;

  /**
   * civSeed = 文明种子;regions = 这一段推演的州;eras = 地形大事以前的各段(没有 = 空)。
   * 推演前就有的民族(自然兴起的、备给干预立国的)的民间信仰这时就编好号
   */
  constructor(civSeed: number, src: FaithSource, regions: Regions, eras: readonly FaithEra[] = []) {
    this.seed = subSeed(civSeed, 'trial-religion');
    this.src = src;
    this.eras = eras;
    this.last = regions;
    this.reg = eras.length ? eras[0].regions : regions;
    const R = (this.R = regions.count);
    this.book = new FaithBook(R);
    this.faith = this.book.faith;
    this.lastCulture = new Int16Array(R).fill(-1);
    this.ownC = new Int16Array(R).fill(-1);
    this.ownP = new Int16Array(R).fill(-1);
    this.next = new Int16Array(R);
    this.cityIn = Array.from({ length: R }, () => []);
    const cultures = src.cultures();
    this.roots = cultures.filter((cu) => cu.pioneer === undefined && cu.parent === undefined).length;
    this.isFolk = new Uint8Array(cultures.length + 16);
    this.rootArr = new Int16Array(cultures.length + 16);
    for (const cu of cultures) if (cu.parent === undefined) this.folkFaith(cu);
    // 创教的年份:把年份段均分成 nGreat 段,每段里随机一年(大教几个按第一段的州数)
    const nGreat = Math.max(2, Math.min(5, Math.round(this.reg.count / 220)));
    this.foundYears = Array.from({ length: nGreat }, (_, i) => {
      const a = FOUND_SPAN[0] + ((FOUND_SPAN[1] - FOUND_SPAN[0]) * i) / nGreat;
      return Math.round(a + keyed(this.seed, 1, i) * ((FOUND_SPAN[1] - FOUND_SPAN[0]) / nGreat) * 0.8);
    });
  }

  /** 眼下有几种信仰(编号 0 … 它 − 1) */
  get faithCount(): number {
    return this.faiths.length;
  }

  /** 信仰 f 是不是民间信仰 */
  folk(f: number): boolean {
    return this.isFolk[f] === 1;
  }

  /** 信仰 f 所属的大教(教派 = 本教;大教、民间信仰 = 它自己) */
  rootOf(f: number): number {
    return this.rootArr[f];
  }

  /** 国家 p 眼下的国教(−1 = 没有) */
  stateFaith(p: number): number {
    return p >= 0 && p < this.stateOf.length ? this.stateOf[p] : -1;
  }

  /** 早先某一年(不晚于 year 的那一步;year 不能晚于算到的那一步)各州的信仰:检查点 + 补日志(同 faithAt)。out 可复用 */
  faithAt(year: Year, out?: Int16Array): Int16Array {
    if (!out || out.length !== this.R) out = new Int16Array(this.R);
    const cps = this.checkpoints;
    let k = cps.length;
    while (k > 0 && cps[k - 1].year > year) k--;
    const b = this.book;
    let i = 0;
    if (k > 0) {
      out.set(cps[k - 1].faith);
      const y0 = cps[k - 1].year;
      let lo = 0;
      let hi = b.year.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (b.year[mid] <= y0) lo = mid + 1;
        else hi = mid;
      }
      i = lo;
    } else out.fill(-1);
    for (; i < b.year.length && b.year[i] <= year; i++) out[b.region[i]] = b.value[i];
    return out;
  }

  /** 国家 p 早先某一年的国教(−1 = 没有;year 不能晚于算到的那一步) */
  stateFaithAt(p: number, year: Year): number {
    for (const s of this.states) if (s.polity === p && s.from <= year && (s.until === undefined || s.until > year)) return s.faith;
    return -1;
  }

  private addFaith(f: Faith, naming: Naming): void {
    if (f.id >= this.isFolk.length) {
      const a = new Uint8Array(this.isFolk.length * 2);
      const b = new Int16Array(this.isFolk.length * 2);
      a.set(this.isFolk);
      b.set(this.rootArr);
      this.isFolk = a;
      this.rootArr = b;
    }
    this.isFolk[f.id] = f.kind === 'folk' ? 1 : 0;
    this.rootArr[f.id] = f.kind === 'sect' ? f.parent! : f.id;
    if (f.kind !== 'folk') this.ordinal.set(f.id, this.ordinal.size);
    this.faiths.push(f);
    this.naming.push(naming);
  }

  /** 民族 cu 的民间信仰(没有就这一刻起一个,编号接在后面;名字整理时补) */
  private folkFaith(cu: Culture): number {
    const had = this.folkOf.get(cu);
    if (had !== undefined) return had;
    const id = this.faiths.length;
    this.folkOf.set(cu, id);
    this.addFaith({ id, kind: 'folk', name: '', culture: cu.id, color: FOLK_COLOR }, { kind: 'folk', cu });
    return id;
  }

  /** 各国的数组按国家数补长 */
  private grow(P: number): void {
    if (this.stateOf.length >= P) return;
    const n = Math.max(P, this.stateOf.length * 2, 16);
    const st = new Int32Array(n).fill(-1);
    st.set(this.stateOf);
    this.stateOf = st;
    const seen = new Int32Array(n);
    seen.set(this.seenP);
    this.seenP = seen;
    this.total = new Int32Array(n);
    while (this.faithOrder.length < n) this.faithOrder.push([]);
  }

  /** 从 from 出发按州图走,max 步以内的州的步数(更远的 = −1) */
  private hops(from: number, max: number): Int16Array {
    const { adjStart, adj } = this.reg;
    const d = new Int16Array(this.R).fill(-1);
    d[from] = 0;
    const q = [from];
    for (let h = 0; h < q.length; h++) {
      const r = q[h];
      if (d[r] >= max) continue;
      for (let k = adjStart[r]; k < adjStart[r + 1]; k++) {
        const n = adj[k];
        if (d[n] < 0) {
          d[n] = d[r] + 1;
          q.push(n);
        }
      }
    }
    return d;
  }

  /** 日志往后翻到 y(含):各州的归属;有人住了 / 民族换了,民间信仰在那一刻跟着民族(信大教的不变) */
  private follow(y: Year): void {
    const L = this.src.log();
    const cultures = this.src.cultures();
    const { ownC, ownP, lastCulture, book, faith } = this;
    let li = this.li;
    for (; li < L.size && L.year[li] <= y; li++) {
      const r = L.region[li];
      if (L.layer[li] !== Layer.Culture) {
        ownP[r] = L.value[li];
        continue;
      }
      const cu = L.value[li];
      ownC[r] = cu;
      if (cu === lastCulture[r]) continue;
      lastCulture[r] = cu;
      if (cu < 0) {
        book.set(L.year[li], r, -1);
        continue;
      }
      // 分化出来的民族:第一次出现在日志里(分出来那一刻)就有它的民间信仰,住的州信不信它都一样
      const own = this.folkFaith(cultures[cu]);
      if (faith[r] < 0 || this.isFolk[faith[r]] === 1) book.set(L.year[li], r, own);
    }
    this.li = li;
  }

  /** 亡国:国教跟着结束 */
  private endStates(y: Year): void {
    const pols = this.src.polities();
    for (const s of this.states) {
      const end = pols[s.polity].ended;
      if (s.until === undefined && end !== undefined && end <= y) {
        s.until = end;
        this.stateOf[s.polity] = -1;
      }
    }
  }

  private adoptState(y: Year, p: number, f: number): void {
    if (this.stateOf[p] === f) return;
    const open = this.states.find((s) => s.polity === p && s.until === undefined);
    if (open) open.until = y;
    this.stateOf[p] = f;
    this.states.push({ polity: p, faith: f, from: y });
    const cap = this.src.settlements()[capitalAt(this.src.polities()[p], y)];
    // 皈依的国君(ruler)整理时按人物补
    this.events.push({ year: y, kind: 'state', faith: f, polity: p, region: cap?.region ?? -1, settlement: cap?.id ?? -1, ruler: undefined });
  }

  /** 第 y 年这一步(y 是 STEP 的整数倍,一步比一步晚):这一年(含)以前的历史都有了 */
  step(y: Year): void {
    const { seed, faiths, faith, ownC, ownP, R } = this;
    const S = this.src.settlements();
    const pols = this.src.polities();
    const cultures = this.src.cultures();
    while (this.era < this.eras.length && y >= this.eras[this.era].until) this.reg = ++this.era < this.eras.length ? this.eras[this.era].regions : this.last;
    const reg = this.reg;
    const P = pols.length;
    this.grow(P);
    for (; this.cities < S.length; this.cities++) {
      const s = S[this.cities];
      if (s.region >= 0 && s.region < R) this.cityIn[s.region].push(s.id);
    }
    const stamp = ++this.steps;
    this.follow(y);
    this.endStates(y);
    const set = (r: number, f: number) => this.book.set(y, r, f);
    const folk = (f: number) => this.isFolk[f] === 1;

    // 创教
    if (this.nextFound < this.foundYears.length && y >= this.foundYears[this.nextFound]) {
      const far = faiths.filter((f) => f.kind === 'great').map((f) => this.hops(S[f.holy!].region, HOLY_GAP));
      let best = -1;
      let bestScore = 0;
      for (const s of S) {
        if (s.founded > y || (s.ended !== undefined && s.ended <= y)) continue;
        if (faith[s.region] < 0 || !folk(faith[s.region])) continue;
        if (far.some((d) => d[s.region] >= 0)) continue;
        const pol = ownP[s.region];
        const isCap = pol >= 0 && capitalAt(pols[pol], y) === s.id;
        const score = populationAt(s, y) * (isCap ? 1.4 : 1) * (0.6 + 0.8 * keyed(seed, 2, s.cell, this.nextFound));
        if (score > bestScore) {
          bestScore = score;
          best = s.id;
        }
      }
      if (best >= 0) {
        const s = S[best];
        // 创教的是城里现在住的民族(城被同化过的话,Settlement.culture 还是建城的那族)
        const cu = cultures[ownC[s.region]] ?? cultures[s.culture];
        const k = faiths.length;
        const forms = FORM_BY_KIND[cu.kind] ?? ['多神'];
        const form = forms[Math.floor(keyed(seed, 3, s.cell) * forms.length)];
        const age = 30 + Math.floor(keyed(seed, 5, s.cell) * 15);
        this.addFaith(
          {
            id: k,
            kind: 'great',
            name: '',
            form,
            founded: y,
            holy: best,
            founder: { name: '', born: y - age, died: y - age + 55 + Math.floor(keyed(seed, 6, s.cell) * 25) },
            color: GREAT_COLORS[faiths.filter((f) => f.kind === 'great').length % GREAT_COLORS.length],
          },
          { kind: 'great', cu, cell: s.cell },
        );
        set(s.region, k);
        this.events.push({ year: y, kind: 'found', faith: k, polity: ownP[s.region], region: s.region, settlement: best });
        this.foundedBy.set(k, cu);
        this.nextFound++;
      } else if (faiths.filter((f) => f.kind === 'great').length >= 2) this.nextFound++;
      // 这一年没有合适的城(都信了大教、离圣城太近):已经有两个大教就不创这一个,不到两个下一步再找
    }

    // 传播:大教 / 教派向相邻的州传
    const { next, stateOf, entered, cityIn } = this;
    spreadStep(seed, y, reg, faith, next, ownP, stateOf, this.isFolk, this.rootArr);
    // 改信:第一次传进一国(那国里还没有别的州信这一教)记一件"传入"
    const F = faiths.length;
    if (this.inPolity.length < P * F) {
      this.inPolity = new Int32Array(P * F);
      this.count = new Int32Array(P * F);
    } else this.inPolity.fill(0, 0, P * F);
    const { inPolity, count, total } = this;
    countRoots(R, F, ownP, faith, this.isFolk, this.rootArr, inPolity);
    for (let r = changed(next, faith, 0); r < R; r = changed(next, faith, r + 1)) {
      const f = next[r];
      const pn = ownP[r];
      if (pn >= 0) {
        const root = this.rootArr[f];
        const ek = pn * 65536 + root;
        if (!inPolity[pn * F + root] && !entered.has(ek)) {
          entered.add(ek);
          const city = cityIn[r].find((id) => S[id].founded <= y && (S[id].ended ?? 1e9) > y) ?? -1;
          this.events.push({ year: y, kind: 'enter', faith: f, polity: pn, region: r, settlement: city });
        }
        const g = faith[r];
        if (g >= 0 && !folk(g)) inPolity[pn * F + this.rootArr[g]]--;
        inPolity[pn * F + root]++;
      }
      set(r, f);
    }

    // 国教:国都改信了别的大教(而且信它的州更多),或者没有国教、某大教占到 ADOPT 以上
    const { order, faithOrder } = this;
    countFaiths(P, F, ownP, faith, this.isFolk, total, count, this.seenP, stamp, order, faithOrder);
    for (const p of order) {
      const cap = S[capitalAt(pols[p], y)];
      const capF = cap ? faith[cap.region] : -1;
      let best = -1;
      let bestN = 0;
      for (const f of faithOrder[p]) if (count[p * F + f] > bestN) [best, bestN] = [f, count[p * F + f]];
      const cur = stateOf[p];
      const n = (f: number) => (f >= 0 && f < F ? count[p * F + f] : 0);
      if (capF >= 0 && !folk(capF) && cur !== capF && (cur < 0 || n(capF) > n(cur))) this.adoptState(y, p, capF);
      else if (cur < 0 && bestN >= ADOPT * total[p]) {
        this.adoptState(y, p, best);
        if (cap) set(cap.region, best);
      }
    }

    // 圣城易手:被国教不是这个教(及其教派)的国家夺了
    for (const f of faiths) {
      if (f.kind !== 'great') continue;
      const hr = S[f.holy!].region;
      const p = ownP[hr];
      const prev = this.holyOwner.get(f.id) ?? -2;
      if (p === prev) continue;
      if (prev >= 0 && p >= 0) {
        const st = stateOf[p];
        if (st < 0 || this.rootArr[st] !== f.id) this.events.push({ year: y, kind: 'holy', faith: f.id, polity: p, region: hr, settlement: f.holy!, from: prev });
      }
      this.holyOwner.set(f.id, p);
    }

    // 教派分立
    if (y % SCHISM_EVERY === 0) {
      for (const f of faiths.slice()) {
        if (f.kind !== 'great' || y - f.founded! < SCHISM_AGE || (this.sects.get(f.id) ?? 0) >= SCHISM_MAX) continue;
        const hr = S[f.holy!].region;
        const d = this.hops(hr, 200);
        for (const s of this.states) {
          if (s.until !== undefined || s.faith !== f.id || y - s.from < SCHISM_STATE_YEARS) continue;
          const cap = S[capitalAt(pols[s.polity], y)];
          if (!cap || ownP[hr] === s.polity) continue;
          const farAway = reg.landmass[cap.region] !== reg.landmass[hr] || d[cap.region] < 0 || d[cap.region] >= SCHISM_FAR;
          let n = 0;
          for (let r = 0; r < R; r++) if (ownP[r] === s.polity && faith[r] === f.id) n++;
          if (!farAway || n < SCHISM_MIN) continue;
          if (keyed(seed, 20 + y, s.polity, this.roots + this.ordinal.get(f.id)!) >= SCHISM_ODDS) continue;
          const k = faiths.length;
          const nth = this.sects.get(f.id) ?? 0;
          this.addFaith(
            { id: k, kind: 'sect', name: '', form: f.form, parent: f.id, founded: y, polity: s.polity, seat: cap.id, color: shade(f.color, nth === 0 ? 0.32 : -0.28) },
            { kind: 'sect', cap: cap.id, holySeat: reg.seat[hr], capSeat: reg.seat[cap.region] },
          );
          this.sects.set(f.id, nth + 1);
          for (let r = 0; r < R; r++) if (ownP[r] === s.polity && faith[r] === f.id) set(r, k);
          s.until = y;
          this.states.push({ polity: s.polity, faith: k, from: y });
          stateOf[s.polity] = k;
          // 分立时的国君(ruler)整理时按人物补
          this.events.push({ year: y, kind: 'schism', faith: k, polity: s.polity, region: cap.region, settlement: cap.id, ruler: undefined });
          break;
        }
      }
    }
    if (y % CHECKPOINT === 0) this.checkpoints.push({ year: y, faith: Int16Array.from(faith) });
    this.year = y;
  }

  /**
   * 推完整理成 Civ.religion:推到的年份不在整步上的,只把归属、民间信仰、国教的结束跟到那一年
   * (和推得更远的历史在那一步以前一模一样);补上名字(民族、城的名字推完才起)、皈依 / 分立时的国君(人物推完才排)。
   * civ = 推完、起好名、排好人物的历史(各城、各国、各民族和推演里的是同一份);world = 最后一段的地形(只用到地块的位置)
   */
  finish(world: World, civ: Civ): Religion {
    this.follow(civ.endYear);
    this.endStates(civ.endYear);
    const namers = personNamers(civ.seed);
    const S = civ.settlements;
    const seed = this.seed;
    const out: Faith[] = [];
    const taken = (n: string) => out.some((f) => f.name === n);
    const eastern = (cu: Culture) => namers(cu.style).family === 'eastern';
    for (let k = 0; k < this.faiths.length; k++) {
      const f: Faith = { ...this.faiths[k] };
      const nm = this.naming[k];
      if (nm.kind === 'folk') {
        f.name = `${nm.cu.name}${folkSuffix(eastern(nm.cu))}`;
        f.culture = nm.cu.id;
      } else if (nm.kind === 'great') {
        const namer = namers(nm.cu.style);
        const given = namer.given(nm.cell, 77);
        if (namer.family === 'eastern') {
          const tail = f.form === '修行' ? '宗' : f.form === '哲理' ? '道' : '教';
          const w0 = Math.floor(keyed(seed, 4, nm.cell) * EAST_WORDS.length);
          let i = 0;
          while (i < EAST_WORDS.length - 1 && taken(`${EAST_WORDS[(w0 + i) % EAST_WORDS.length]}${tail}`)) i++;
          f.name = `${EAST_WORDS[(w0 + i) % EAST_WORDS.length]}${tail}`;
        } else {
          f.name = `${given.slice(0, Math.min(3, Math.max(2, given.length - 1)))}教`;
          if (taken(f.name)) f.name = `${given}教`;
        }
        f.founder = { ...f.founder!, name: namer.surname(nm.cell, 77) + given };
      } else {
        const parent = out[f.parent!];
        const by = this.foundedBy.get(f.parent!) ?? civ.cultures[S[parent.holy!].culture];
        f.name = sectName(out, parent.name, sectDir(world, nm.holySeat, nm.capSeat), S[nm.cap].name, eastern(by));
      }
      out.push(f);
    }
    // 一直没住进过哪个州的民族(推演中分化出来的不会这样):民间信仰排在最后
    for (const cu of this.src.cultures()) {
      if (this.folkOf.has(cu)) continue;
      out.push({ id: out.length, kind: 'folk', name: `${cu.name}${folkSuffix(eastern(cu))}`, culture: cu.id, color: FOLK_COLOR });
    }
    const rulerAt = (p: number, y: Year) =>
      civ.people?.find((x) => x.role === 'ruler' && x.polity === p && (x.from ?? 0) <= y && (x.until ?? 1e9) > y)?.id;
    const b = this.book;
    return {
      faiths: out,
      events: this.events.map((e) => (e.kind === 'state' || e.kind === 'schism' ? { ...e, ruler: rulerAt(e.polity, e.year) } : { ...e })),
      states: this.states.map((s) => ({ ...s })),
      log: { size: b.year.length, year: Float32Array.from(b.year), region: Int32Array.from(b.region), value: Int16Array.from(b.value) },
      checkpoints: this.checkpoints.slice(),
    };
  }
}

const sims = new WeakMap<CivSim, FaithSim>();

/** 推演引擎上挂着的信仰推演(推演里的规则问"这州眼下信什么、这国眼下的国教"用;没有文明 = undefined) */
export function faithSimOf(sim: CivSim): FaithSim | undefined {
  return sims.get(sim);
}

/** 引擎上的历史(随推演往后长) */
function simSource(sim: CivSim, cm: CultureModel, pm: PolityModel): FaithSource {
  return { log: () => sim.logView, settlements: () => pm.settlements, polities: () => pm.polities, cultures: () => cm.cultures };
}

function hook(sim: CivSim, fs: FaithSim, first: Year): void {
  sims.set(sim, fs);
  sim.everyYears(first, STEP, (y) => fs.step(y));
}

/** 登记信仰推演(generateCiv 里,各层 install 之后):第 0 年起每 STEP 年一步。regions = 推演的州 */
export function installReligion(sim: CivSim, civSeed: number, cm: CultureModel, pm: PolityModel, regions: Regions): void {
  hook(sim, new FaithSim(civSeed, simSource(sim, cm, pm), regions), 0);
}

/**
 * 接着推(CivSim.fromCiv 调用,在各层 resume 之后):不存状态,照引擎上的历史(和 civ 一样,外加补备的干预立国民族)
 * 从第 0 年重放到 civ.endYear,之后接着每 STEP 年一步。eras = 地形大事以前的各段(按那时的州)
 */
export function resumeReligion(sim: CivSim, civ: Civ, cm: CultureModel, pm: PolityModel, eras: readonly FaithEra[]): void {
  const fs = new FaithSim(civ.seed, simSource(sim, cm, pm), civ.regions, eras);
  let y = 0;
  for (; y <= civ.endYear; y += STEP) fs.step(y);
  hook(sim, fs, y);
}

/** 推完整理成 Civ.religion(finishCiv 调用;见 FaithSim.finish)。引擎上没挂信仰推演 = 推完照历史再算一遍 */
export function finishReligion(sim: CivSim, world: World, civ: Civ): Religion {
  return sims.get(sim)?.finish(world, civ) ?? buildReligion(world, civ);
}

/** 照一份推完的历史从头算信仰(和推演里逐步算的一样;测试用来核对)。没有民族 = 空的信仰列表 */
export function buildReligion(world: World, civ: Civ): Religion {
  const src: FaithSource = { log: () => civ.log, settlements: () => civ.settlements, polities: () => civ.polities, cultures: () => civ.cultures };
  const fs = new FaithSim(civ.seed, src, civ.regions, civ.eras ?? []);
  for (let y = 0; y <= civ.endYear; y += STEP) fs.step(y);
  return fs.finish(world, civ);
}

/** 各州现在的信仰 + 变化日志 */
class FaithBook {
  readonly faith: Int16Array;
  readonly year: number[] = [];
  readonly region: number[] = [];
  readonly value: number[] = [];
  constructor(R: number) {
    this.faith = new Int16Array(R).fill(-1);
  }
  set(y: Year, r: number, f: number) {
    if (this.faith[r] === f) return;
    this.faith[r] = f;
    this.year.push(y);
    this.region.push(r);
    this.value.push(f);
  }
}

/** 从 from 起第一个 a、b 不一样的下标;没有 = 长度 */
function changed(a: Int16Array, b: Int16Array, from: number): number {
  let r = from;
  while (r < a.length && a[r] === b[r]) r++;
  return r;
}

/**
 * 立国教那一步要的数(P = 国家数):各国的州数(total)、各国信各大教 / 教派的州数(count[国家 × F + 信仰]),
 * order = 按第一次扫到的先后排的国家,faithOrder[国家] = 这国按第一次扫到的先后排的信仰(同样多时取先扫到的)
 */
function countFaiths(
  P: number,
  F: number,
  ownP: Int16Array,
  faith: Int16Array,
  isFolk: Uint8Array,
  total: Int32Array,
  count: Int32Array,
  seenP: Int32Array,
  stamp: number,
  order: number[],
  faithOrder: number[][],
): void {
  total.fill(0, 0, P);
  count.fill(0, 0, P * F);
  order.length = 0;
  for (let r = 0; r < ownP.length; r++) {
    const p = ownP[r];
    if (p < 0) continue;
    total[p]++;
    const f = faith[r];
    if (f < 0 || isFolk[f] === 1) continue;
    if (seenP[p] !== stamp) {
      seenP[p] = stamp;
      order.push(p);
      faithOrder[p].length = 0;
    }
    if (count[p * F + f]++ === 0) faithOrder[p].push(f);
  }
}

/** 传播一步:信大教 / 教派的州向相邻的州传,结果写进 next(next 先要是 faith 的拷贝;一个州一步只改信一次) */
function spreadStep(
  seed: number,
  y: Year,
  regions: Civ['regions'],
  faith: Int16Array,
  next: Int16Array,
  ownP: Int16Array,
  stateOf: Int32Array,
  isFolk: Uint8Array,
  rootArr: Int16Array,
): void {
  const { adjStart, adj, adjKind } = regions;
  next.set(faith);
  for (let r = 0; r < regions.count; r++) {
    const f = faith[r];
    if (f < 0 || isFolk[f] === 1) continue;
    const pr = ownP[r];
    for (let k = adjStart[r]; k < adjStart[r + 1]; k++) {
      const n = adj[k];
      const g = faith[n];
      if (g < 0 || g === f || next[n] !== g) continue;
      const gFolk = isFolk[g] === 1;
      if (rootArr[g] === rootArr[f] && !gFolk) continue;
      const pn = ownP[n];
      let p = SPREAD;
      if (pn < 0) p *= TRIBAL;
      else if (pn === pr) p *= SAME_STATE;
      else p *= CROSS_BORDER;
      const st = pn >= 0 ? stateOf[pn] : -1;
      if (st === f) p *= STATE_FAITH;
      else if (st >= 0) p *= OTHER_STATE;
      if (!gFolk) p *= st === f ? 0.3 : FROM_GREAT;
      const kind = adjKind[k];
      if (kind === AdjKind.SeaRoute || kind === AdjKind.Strait) p *= SEA;
      else if (kind === AdjKind.Mountain) p *= MOUNTAIN;
      if (keyed(seed, 10 + y, r, n) < p) next[n] = f;
    }
  }
}

/** 各国信各大教(含教派)的州数:out[国家 × F + 大教] */
function countRoots(R: number, F: number, ownP: Int16Array, faith: Int16Array, isFolk: Uint8Array, rootArr: Int16Array, out: Int32Array): void {
  for (let r = 0; r < R; r++) {
    const p = ownP[r];
    const f = faith[r];
    if (p >= 0 && f >= 0 && isFolk[f] === 0) out[p * F + rootArr[f]]++;
  }
}

/** 民间信仰的名字:族名 + 祖灵(东方)/ 旧神(西幻) */
export function folkSuffix(eastern: boolean): string {
  return eastern ? '祖灵' : '旧神';
}

/** 教派的名字:教名去掉末字 + 方位 + 宗(东方)/ 派(西幻);重名时用那国国都名字的前两个字 */
function sectName(faiths: readonly Faith[], parent: string, dir: string, capital: string, eastern: boolean): string {
  const root = parent.slice(0, -1);
  const byDir = eastern ? `${root}${dir}宗` : `${root}${dir}派`;
  if (!faiths.some((x) => x.name === byDir)) return byDir;
  return eastern ? `${capital.slice(0, 2)}宗` : `${root}${capital.slice(0, 2)}派`;
}

// ---------------------------------------------------------------------------
// 查询

/** 大教 / 教派 / 民间信仰 → 它所属的大教(教派 = 本教;其余 = 它自己) */
export function faithRoot(rel: Religion, f: number): number {
  const x = rel.faiths[f];
  return x && x.kind === 'sect' && x.parent !== undefined ? x.parent : f;
}

/** 日志里第一条年份 > year 的下标 */
function faithLogAfter(log: Religion['log'], year: Year): number {
  let lo = 0;
  let hi = log.size;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (log.year[mid] <= year) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** 某一年各州的信仰(−1 = 没人住 / 还没算到);没有信仰 = 全 −1。out 可复用 */
export function faithAt(civ: Civ, year: Year, out?: Int16Array): Int16Array {
  const R = civ.regions.count;
  if (!out || out.length !== R) out = new Int16Array(R);
  const rel = civ.religion;
  if (!rel) return out.fill(-1);
  const cps = rel.checkpoints;
  let lo = 0;
  let hi = cps.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cps[mid].year <= year) lo = mid + 1;
    else hi = mid;
  }
  const cp = lo > 0 ? cps[lo - 1] : null;
  let i = 0;
  if (cp) {
    out.set(cp.faith.length > R ? cp.faith.subarray(0, R) : cp.faith); // 地形大事以前那一段州少(同 ownersAt)
    i = faithLogAfter(rel.log, cp.year);
  } else out.fill(-1);
  const { log } = rel;
  for (; i < log.size && log.year[i] <= year; i++) out[log.region[i]] = log.value[i];
  return out;
}

/** 从头翻日志(不用检查点)。测试用来核对 faithAt */
export function faithFromScratch(civ: Civ, year: Year): Int16Array {
  const out = new Int16Array(civ.regions.count).fill(-1);
  const log = civ.religion?.log;
  if (log) for (let i = 0; i < log.size && log.year[i] <= year; i++) out[log.region[i]] = log.value[i];
  return out;
}

/** 最近 span 年里 (year − span, year] 信仰变过的州:out[州] = 变化的年份,其余为 −Infinity(画信仰色块的渐入用) */
export function faithChanges(civ: Civ, year: Year, span: number, out: Float32Array): Float32Array {
  out.fill(-Infinity);
  const log = civ.religion?.log;
  if (!log) return out;
  const end = faithLogAfter(log, year);
  for (let i = faithLogAfter(log, year - span); i < end; i++) out[log.region[i]] = log.year[i];
  return out;
}

/** 某国某一年的国教;没有 = null */
export function stateFaithAt(rel: Religion | undefined, polity: number, year: Year): StateFaith | null {
  if (!rel) return null;
  for (const s of rel.states) if (s.polity === polity && s.from <= year && (s.until === undefined || s.until > year)) return s;
  return null;
}

/** 某一年奉这种信仰为国教的(按开始的年份) */
export function statesOfFaith(rel: Religion | undefined, faith: number, year: Year): StateFaith[] {
  if (!rel) return [];
  return rel.states.filter((s) => s.faith === faith && s.from <= year && (s.until === undefined || s.until > year)).sort((a, b) => a.from - b.from || a.polity - b.polity);
}

/** 这种信仰到某一年为止有没有出现过(大教、教派:创立了没有;民间信仰:那个民族诞生了没有) */
export function faithBorn(civ: Civ, f: Faith, year: Year): boolean {
  if (f.kind === 'folk') return (civ.cultures[f.culture ?? f.id]?.born ?? 0) <= year;
  return (f.founded ?? 0) <= year;
}

/**
 * 某一年各信仰有几个州(有人住的州):n[信仰编号],folk = 所有民间信仰加起来,total = 有人住的州。
 * own = 那一年的归属(ownersAt;给了就不再算)
 */
export function faithCounts(civ: Civ, year: Year, faiths?: Int16Array, own?: Owners): { n: Int32Array; folk: number; total: number } {
  const rel = civ.religion;
  const n = new Int32Array(rel?.faiths.length ?? 0);
  let folk = 0;
  let total = 0;
  if (!rel) return { n, folk, total };
  const fa = faiths ?? faithAt(civ, year);
  const o = own ?? ownersAt(civ, year);
  for (let r = 0; r < civ.regions.count; r++) {
    const f = fa[r];
    if (o.culture[r] < 0 || f < 0) continue;
    total++;
    n[f]++;
    if (rel.faiths[f].kind === 'folk') folk++;
  }
  return { n, folk, total };
}

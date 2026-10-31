/**
 * 文明推演引擎(民族扩张;战争、分裂、合并等也在这上面加事件):
 *
 * - **事件堆**:按时间排序(复用 util.ts 的 MinHeap)。每个事件是 {时间, 类型, 对象 a, 对象 b, 版本号}。
 *   时间精度 1/256 年;"时间 + 同一刻里的次序"拼成一个整数当优先级,保证确定性:同一时刻最先处理地形大事,
 *   再处理航海时代、发展度、政局的数表、看王朝、新君即位、迁都后重看边地(按国家号,见 earlyOrder),再处理别的事件(按预约先后),最后处理民族、国家的到达
 *   (按"民族先、国家后,再按州号、民族 / 国家号"排,见 arrivalOrder)。头尾这两类和预约先后无关 —— 接着推时它们是
 *   按日志重新预约 / 重放的,预约先后和一口气推完时不一样,同一刻撞上了也要按同样的次序处理。
 *   中间那一类(看邻国、看内政、下一仗、建城、立国……)接着推时由各层补上,补的时候说明一口气推时它是哪一刻预约的
 *   (schedule 的 booked),resumeCiv 按预约的时刻排好先后再放进事件堆:同一刻撞上的几件,先后和一口气推完一样。
 * - **州的版本号**:州的归属(任何一层)一变就 +1。事件预约时记下州 a 的版本号,弹出时对不上就是过期了,
 *   直接丢掉 —— 不用去堆里找、删事件。哪些类型要核对版本号,见 EVENT_INFO。
 * - **唯一改归属的入口** setOwner(层, 州, 新值, 原因):写变化日志、版本号 +1、通知这一层的监听者
 *   (民族层的监听者负责"预约邻州的到达",见 cultures.ts)。
 * - **变化日志**:只记"哪一年、哪个州、哪一层、新值、原因"。回放 = 翻日志(timeline.ts 的 ownersAt)。
 * - **史事**(阶段 3):record(种类, …) 记"发生了什么事"(立国、升格、宣战、攻占、灭亡……),编年史只读它。
 *   各字段的含义见 types.ts 的 AnnalKind。
 * - **检查点**:每 100 年存一份各州的归属,时间轴一下跳到很远时不用从头翻。
 * - **隔几年看一眼**(everyYears):在整几年那一刻的事件都办完、下一刻的还没办时调一次,和检查点同一个时机。
 *   信仰(religion.ts)每 5 年在这里算一步;它只读、只记自己的账,不预约事件、不改归属,事件的先后和不挂它时一样。
 * - **不保存事件堆**:resumeCiv(world, civ) 由 Civ 数据本身重建"接下来该发生什么",从 civ.endYear 接着推。
 *   进行中的战争、厌战、停战冷却也一样(由史事 + 日志 + 国家表重建,见 wars.ts 的 resumeWars);
 *   分裂、合并、复国、主动迁都的冷却同样(见 politics.ts 的 resumePolitics);王朝更替也一样(dynasty.ts 的 resumeDynasty);
 *   同化与迁徙同样(见 assimilation.ts 的 resumeAssimilation);大迁徙在路上的队伍按 Civ.migrations 接着走(migration.ts 的 resumeMigration);
 *   城市兴衰(毁城后的重建、旧都衰落)也一样(cities.ts 的 resumeCities)。
 *   发展度是例外:各州能力的全精度状态存在 Civ.development.state 里,接着推时从那里接上(development.ts 的 resumeDevelopment);
 *   思潮也一样(Civ.ideology.state,ideology.ts 的 resumeIdeology);
 *   政局的数表也存在那里(state.tables,control.ts 的 resumeControl);议事定下的规矩由史事重建(council.ts 的 resumeCouncil)。
 *   信仰不存状态:照历史从第 0 年重放到 civ.endYear(religion.ts 的 resumeReligion)。
 *   阶段 4 的干预不存进事件堆:resumeCiv(world, civ, 干预列表)按列表补上还没到的干预(interventions.ts 的 resumeInterventions)。
 *
 * 纯计算,不碰 DOM。
 */
import { MinHeap } from '../../util';
import { ANNAL_EXTRAS, Layer, type Annal, type AnnalKind, type ChangeLog, type Checkpoint, type Civ, type Year } from '../types';
import type { Calamity } from '../calamity';
import { OFFICIAL_KNOBS, knobSetOf, type KnobSet } from './knobs';

/** 检查点间隔(年) */
export const CHECKPOINT_EVERY = 100;

/** 事件时间精度:1/256 年(约一天半) */
const TICKS_PER_YEAR = 256;
/**
 * 优先级 = 时刻 × TICK_SPAN + 同一刻里的次序:登记了排在最前的几类 = earlyOrder(< EARLY_SPAN);
 * 别的事件 = EARLY_SPAN + 编号(预约先后,< SEQ_SPAN);到达 = SEQ_SPAN + arrivalOrder(排在最后)。见 EventOrder。
 * 都是整数,拼起来不超过 2^53 − 1,Float64 里精确
 */
const EARLY_SPAN = 2 ** 15;
const SEQ_SPAN = 2 ** 28;
const TICK_SPAN = 2 ** 29;
/** 能预约的最远时刻:65536 年(Float32 的变化日志在这个范围内也能精确存下 1/256 年) */
const MAX_TICK = 2 ** 24;

/** 同一刻里排在最前面那一段的长度(固定次序 early、末尾 earlyEnd、按国家 perPolity 都在这一段里) */
/** 按国家排的几类:从这个次序起,每国占 PER_POLITY_SLOTS 格(同一国依次是槽位 0、1、2……) */
const PER_POLITY_BASE = 4;
const PER_POLITY_SLOTS = 4;
/** 末尾那几类(earlyEnd)最多几类 */
const EARLY_END_MAX = 12;

/**
 * 一类事件在同一刻里排在哪(登记事件种类时给;不给 = 按预约先后):
 * - early:排在同一刻最前面,按给的次序(0 起,< PER_POLITY_BASE)
 * - perPolity:接着按国家号排(事件的 b = 国家),同一国依次按槽位(0 起,< PER_POLITY_SLOTS);国家号超出能编的范围 = 按预约先后
 * - earlyEnd:最前面那一段的末尾,倒数第 n 个(1 起,≤ EARLY_END_MAX;同一刻每类至多一件)
 * - arrival:排在同一刻最后(到达),先按组(0、1),再按州号(a)、编号(b);州号 / 编号超出能编的范围 = 按预约先后
 */
export type EventOrder = { early: number } | { perPolity: number } | { earlyEnd: number } | { arrival: 0 | 1 };

/** 一类事件(规则那一边登记给引擎:官方推演的在 civ/events.ts) */
export interface EventKind {
  /** 编号(0–255;变化日志的 cause 用同一套编号) */
  id: number;
  name: string;
  /** 弹出时是否核对州 a 的版本号(预约之后州 a 的归属变过 → 过期丢掉) */
  watch: boolean;
  order?: EventOrder;
}

const ORDER_NONE = 0;
const ORDER_EARLY = 1;
const ORDER_EARLY_END = 2;
const ORDER_PER_POLITY = 3;
const ORDER_ARRIVAL = 4;

/** 多看一眼(Ev.Look)用的"第几次"从这里往上数(看邻国、内政、王朝的寻常第几次到不了这么大) */
export const LOOK_K = 1 << 20;

/** schedule 的 booked:一口气推时在装各层的时候(第 0 年的事件处理之前)就预约了的事件 */
export const BOOKED_AT_START = -1;

/** 预约链最多记几层(见 bookChain) */
const BOOK_DEPTH = 3;

/**
 * 隔一阵子一次的事件(看邻国、看内政、看年景、下一仗……)第 k 次的预约链,给 schedule 的 booked:
 * 第 k 次是第 k − 1 次那一刻预约的,第 k − 1 次又是第 k − 2 次那一刻预约的……第 0 次是 first 那一刻(立国、宣战、开头……)预约的。
 * at(j) = 第 j 次的时刻。两件事预约的那一刻相同(上一次也撞在同一刻)时,按上一次是哪一刻预约的定先后,和一口气推完一样
 */
export function bookChain(k: number, at: (j: number) => number, first: number): number[] {
  const out: number[] = [];
  for (let j = k - 1; j >= -1 && out.length < BOOK_DEPTH; j--) out.push(j >= 0 ? quantize(at(j)) : first);
  return out;
}

/** 接着推时攒着的一件事件(见 CivSim.releaseHeld):tick = 时刻(1/256 年为单位),booked = 预约链(同样的单位),i = 补上的先后 */
interface HeldEvent {
  tick: number;
  kind: number;
  a: number;
  b: number;
  ver: number;
  booked: number[];
  sub: number;
  i: number;
}

/** 两条预约链比先后:一层层比,比到短的那条用完还一样 = 0 */
function compareChain(x: readonly number[], y: readonly number[]): number {
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** 把时间取整到引擎的精度(1/256 年)。引擎里所有事件时间、日志年份都是这样的值 */
export function quantize(t: number): number {
  return Math.round(t * TICKS_PER_YEAR) / TICKS_PER_YEAR;
}

export type EventHandler = (a: number, b: number, t: number) => void;
export type ChangeListener = (region: number, value: number, prev: number, cause: number) => void;

/** 可增长的变化日志(结构数组) */
class LogBuffer {
  size = 0;
  year: Float32Array;
  region: Int32Array;
  layer: Uint8Array;
  value: Int16Array;
  cause: Uint8Array;
  constructor(cap = 1024) {
    this.year = new Float32Array(cap);
    this.region = new Int32Array(cap);
    this.layer = new Uint8Array(cap);
    this.value = new Int16Array(cap);
    this.cause = new Uint8Array(cap);
  }
  static from(log: ChangeLog): LogBuffer {
    const b = new LogBuffer(Math.max(1024, log.size * 2));
    b.size = log.size;
    b.year.set(log.year.subarray(0, log.size));
    b.region.set(log.region.subarray(0, log.size));
    b.layer.set(log.layer.subarray(0, log.size));
    b.value.set(log.value.subarray(0, log.size));
    b.cause.set(log.cause.subarray(0, log.size));
    return b;
  }
  push(year: number, region: number, layer: number, value: number, cause: number) {
    if (this.size === this.year.length) {
      const cap = this.size * 2;
      const grow = <T extends Float32Array | Int32Array | Uint8Array | Int16Array>(a: T, make: (n: number) => T): T => {
        const b = make(cap);
        b.set(a);
        return b;
      };
      this.year = grow(this.year, (n) => new Float32Array(n));
      this.region = grow(this.region, (n) => new Int32Array(n));
      this.layer = grow(this.layer, (n) => new Uint8Array(n));
      this.value = grow(this.value, (n) => new Int16Array(n));
      this.cause = grow(this.cause, (n) => new Uint8Array(n));
    }
    const i = this.size++;
    this.year[i] = year;
    this.region[i] = region;
    this.layer[i] = layer;
    this.value[i] = value;
    this.cause[i] = cause;
  }
  /** 裁成正好 size 条的副本(发给主线程用) */
  toChangeLog(): ChangeLog {
    const n = this.size;
    return {
      size: n,
      year: this.year.slice(0, n),
      region: this.region.slice(0, n),
      layer: this.layer.slice(0, n),
      value: this.value.slice(0, n),
      cause: this.cause.slice(0, n),
    };
  }
}

/** 推演结果:写回 Civ 的那几项 */
export interface SimResult {
  endYear: Year;
  log: ChangeLog;
  checkpoints: Checkpoint[];
  /** endYear 时各州的民族 */
  culture: Int16Array;
  /** endYear 时各州的国家 */
  polity: Int16Array;
  /** 史事(按发生先后) */
  annals: Annal[];
}

export class CivSim {
  /** 州数 */
  readonly R: number;
  /** 当前时间(年) */
  now: Year = 0;
  /**
   * 预约的事件最早在这一刻(默认不限)。地形大事接着推时 = 大事那一刻:按新地形重算出来的、本该更早发生的事(新海路上的到达……)
   * 一律从大事那一刻起,排在大事后面(gen/civ/index.ts)
   */
  floor: Year = -Infinity;
  /** 「天灾」设定(calamity.ts;平常 = undefined):瘟疫、饥荒更多,会自己闹地震水旱、全球大疫。装各层之前定下 */
  calamity: Calamity | undefined = undefined;
  /**
   * 这次推演用的那套数(knobs.ts):各子系统装上、接着推时从这里取自己那张旋钮表。装各层之前定下(不给 = 官方);
   * 接着推时照 Civ.knobs
   */
  knobs: KnobSet = OFFICIAL_KNOBS;
  /** 各层的当前归属(按 Layer 下标);只读,改归属一律走 setOwner */
  readonly owners: [Int16Array, Int16Array];
  /** 各州的版本号:归属(任何一层)每变一次 +1 */
  readonly version: Int32Array;

  private log = new LogBuffer();
  private annals: Annal[] = [];
  private checkpoints: Checkpoint[] = [];
  private nextCheckpoint = CHECKPOINT_EVERY;

  // 事件:结构数组 + 空槽回收;堆里放槽号,优先级 = 时刻 × TICK_SPAN + 同一刻里的次序(见 SEQ_SPAN)
  private heap = new MinHeap(1024);
  private evT = new Float64Array(1024);
  private evKind = new Uint8Array(1024);
  private evA = new Int32Array(1024);
  private evB = new Int32Array(1024);
  private evVer = new Int32Array(1024);
  private evCount = 0;
  private free: number[] = [];
  private seq = 0;
  /** 接着推时各层补上的、同一刻里按预约先后排的事件(resumeCiv 补完以后按一口气推时的预约先后放进事件堆,见 releaseHeld);平常 = null */
  private held: HeldEvent[] | null = null;

  private handlers: (EventHandler | undefined)[] = [];
  private watch = new Uint8Array(256);
  /** 登记过的事件种类、同一刻里排在哪(见 EventOrder) */
  private kindSeen = new Uint8Array(256);
  private orderKind = new Uint8Array(256);
  private orderArg = new Int32Array(256);
  private listeners: ChangeListener[][] = [[], []];
  /** 隔几年看一眼的(everyYears):下一次的年份、间隔、回调 */
  private yearly: { next: Year; every: number; fn: (year: Year) => void }[] = [];
  /** yearly 里最早的下一次(没有 = Infinity) */
  private nextYearly = Infinity;

  /** 子系统之间的具名接口表:按名字分组,内容由规则那一边定(官方推演的见 civ/api.ts);每次推演一份 */
  readonly api: Record<string, object> = {};

  /** 推演过程中处理了多少个事件(含过期丢掉的),调参 / 测试用 */
  processed = 0;

  /**
   * kinds = 登记的事件种类(编号、名字、要不要核对版本号、同一刻里排在哪;官方推演的在 civ/events.ts 的 CIV_EVENTS)。
   * 没登记的种类:不核对版本号、按预约先后
   */
  constructor(regionCount: number, kinds: readonly EventKind[] = []) {
    this.R = regionCount;
    this.owners = [new Int16Array(regionCount).fill(-1), new Int16Array(regionCount).fill(-1)];
    this.version = new Int32Array(regionCount);
    for (const e of kinds) this.defineKind(e);
  }

  /** 登记一类事件(构造时逐个调) */
  private defineKind(e: EventKind): void {
    if (!(Number.isInteger(e.id) && e.id >= 0 && e.id < 256)) throw new Error(`CivSim:事件编号 ${e.id} 超出 0–255`);
    if (this.kindSeen[e.id]) throw new Error(`CivSim:事件编号 ${e.id} 登记了两次`);
    this.kindSeen[e.id] = 1;
    this.watch[e.id] = e.watch ? 1 : 0;
    const o = e.order;
    if (!o) return;
    const bad = (what: string) => new Error(`CivSim:事件 ${e.name} 的次序 ${what} 超出范围`);
    if ('early' in o) {
      if (!(Number.isInteger(o.early) && o.early >= 0 && o.early < PER_POLITY_BASE)) throw bad('early');
      this.orderKind[e.id] = ORDER_EARLY;
      this.orderArg[e.id] = o.early;
    } else if ('perPolity' in o) {
      if (!(Number.isInteger(o.perPolity) && o.perPolity >= 0 && o.perPolity < PER_POLITY_SLOTS)) throw bad('perPolity');
      this.orderKind[e.id] = ORDER_PER_POLITY;
      this.orderArg[e.id] = o.perPolity;
    } else if ('earlyEnd' in o) {
      if (!(Number.isInteger(o.earlyEnd) && o.earlyEnd >= 1 && o.earlyEnd <= EARLY_END_MAX)) throw bad('earlyEnd');
      this.orderKind[e.id] = ORDER_EARLY_END;
      this.orderArg[e.id] = o.earlyEnd;
    } else {
      if (o.arrival !== 0 && o.arrival !== 1) throw bad('arrival');
      this.orderKind[e.id] = ORDER_ARRIVAL;
      this.orderArg[e.id] = o.arrival;
    }
  }

  /**
   * 同一刻里排在最前面那一段的次序(0 起,< EARLY_SPAN);不是这几类、或国家号超出能编的范围 = −1(按预约先后)。
   * 段里依次是:early(0 起)、perPolity(PER_POLITY_BASE + 国家号 × PER_POLITY_SLOTS + 槽位)、earlyEnd(EARLY_SPAN − n)
   */
  private earlyOrder(kind: number, b: number): number {
    switch (this.orderKind[kind]) {
      case ORDER_EARLY:
        return this.orderArg[kind];
      case ORDER_EARLY_END:
        return EARLY_SPAN - this.orderArg[kind];
      case ORDER_PER_POLITY:
        if (!(b >= 0 && b < (EARLY_SPAN - EARLY_END_MAX) / PER_POLITY_SLOTS - 1)) return -1;
        return PER_POLITY_BASE + b * PER_POLITY_SLOTS + this.orderArg[kind];
      default:
        return -1;
    }
  }

  /**
   * 到达在同一刻里的次序(0 起,< SEQ_SPAN):先按组(组 1 从 2^27 起),再按州号、编号。
   * 不是到达、或州号 / 编号超出能编的范围(极大的世界),返回 −1(按预约先后)
   */
  private arrivalOrder(kind: number, a: number, b: number): number {
    if (this.orderKind[kind] !== ORDER_ARRIVAL) return -1;
    if (!(a >= 0 && a < 2 ** 15 && b >= 0 && b < 2 ** 12)) return -1;
    return (this.orderArg[kind] ? 2 ** 27 : 0) + a * 2 ** 12 + b;
  }

  /**
   * 由 Civ 数据重建引擎的状态(各层归属、版本号、日志、史事、检查点、推到的年份),不含各子系统:
   * 各子系统重建自己的状态和待发生的事件由规则那一边做(modules.ts 的 resumeCiv),然后就能从 civ.endYear 接着推。
   * 不需要保存事件堆,存档也只存 Civ。
   */
  static restore(civ: Civ, kinds: readonly EventKind[] = []): CivSim {
    const sim = new CivSim(civ.regions.count, kinds);
    sim.owners[Layer.Culture].set(civ.culture);
    sim.owners[Layer.Polity].set(civ.polity);
    sim.log = LogBuffer.from(civ.log);
    sim.annals = civ.annals.map((e) => ({ ...e }));
    for (let i = 0; i < civ.log.size; i++) sim.version[civ.log.region[i]]++;
    sim.checkpoints = civ.checkpoints.slice();
    sim.now = civ.endYear;
    sim.calamity = civ.calamity;
    sim.knobs = knobSetOf(civ.knobs);
    // 下一个检查点:最后一个检查点之后的那个整百年(推到整百年的前一刻切开时,那个整百年的检查点还没存,接着推时补上)
    const cps = civ.checkpoints;
    sim.nextCheckpoint = cps.length ? cps[cps.length - 1].year + CHECKPOINT_EVERY : CHECKPOINT_EVERY;
    return sim;
  }

  /**
   * 接着推、各子系统补事件之前调:之后预约的"按预约先后排"的事件先攒着,releaseHeld 时再按一口气推时预约的时刻排好放进事件堆(见 schedule 的 booked)
   */
  holdBookings(): void {
    this.held = [];
  }

  /**
   * 接着推时攒着的事件按一口气推时的预约先后放进事件堆:同一时刻的几件,先按预约链(预约的时刻;一样的再看预约它的那件事是哪一刻预约的……),
   * 还一样的按 sub(同一刻立的几国:按国家号,一国的几件挨在一起),最后按补上的先后(各层的先后和 generateCiv 里装各层的先后一样)
   */
  releaseHeld(): void {
    const held = this.held;
    this.held = null;
    if (!held) return;
    held.sort((x, y) => x.tick - y.tick || compareChain(x.booked, y.booked) || x.sub - y.sub || x.i - y.i);
    for (const e of held) this.push(e.tick, e.kind, e.a, e.b, e.ver);
  }

  /** 登记某类事件的处理函数。watch 不给就按构造时登记的事件种类 */
  on(kind: number, handler: EventHandler, opts: { watch?: boolean } = {}): void {
    this.handlers[kind] = handler;
    if (opts.watch !== undefined) this.watch[kind] = opts.watch ? 1 : 0;
  }

  /**
   * 从第 first 年起每 every 年看一眼:那一年那一刻(含)的事件都办完、下一刻的事件还没办时调 fn(年份)(推到的年份正好是它时,推完那一刻调)。
   * 和检查点同一个时机。fn 只读引擎和各层的状态、记自己的账:不预约事件、不改归属、不记史事(不然同一刻的先后就和不挂它时不一样了)
   */
  everyYears(first: Year, every: number, fn: (year: Year) => void): void {
    this.yearly.push({ next: first, every, fn });
    if (first < this.nextYearly) this.nextYearly = first;
  }

  /** 办 yearly 里年份早于 before(inclusive:不晚于)的,按年份先后 */
  private runYearly(before: Year, inclusive: boolean): void {
    for (;;) {
      let h: (typeof this.yearly)[number] | undefined;
      for (const x of this.yearly) if (!h || x.next < h.next) h = x;
      if (!h || !(inclusive ? h.next <= before : h.next < before)) {
        this.nextYearly = h ? h.next : Infinity;
        return;
      }
      const y = h.next;
      h.next += h.every;
      h.fn(y);
    }
  }

  /** 登记某一层归属变化的监听者(setOwner 之后同步调用) */
  onChange(layer: Layer, fn: ChangeListener): void {
    this.listeners[layer].push(fn);
  }

  /**
   * 预约一个事件。t 早于现在(或 floor)就按现在(floor)算;取整到 1/256 年;超出 65536 年或不是有限数就不预约。
   * 要核对版本号的类型,记下州 a 此刻的版本号。
   * booked、sub 只在接着推(resumeCiv 里各层补事件)时用:一口气推完时这件事是哪一刻预约的(装各层时就预约的 = BOOKED_AT_START;
   * 隔一阵子一次的事件给预约链,见 bookChain),同一刻预约的几件按 sub、再按补上的先后排(见 releaseHeld)。推演中途预约的不用给(就是现在)
   */
  schedule(t: number, kind: number, a: number, b: number, booked: number | readonly number[] = BOOKED_AT_START, sub = 0): void {
    if (!(t < Infinity)) return; // Infinity / NaN
    const tick = Math.round(Math.max(t, this.now, this.floor) * TICKS_PER_YEAR);
    if (tick >= MAX_TICK) return;
    const ver = this.watch[kind] && a >= 0 && a < this.R ? this.version[a] : -1;
    // 接着推时补的、同一刻里按预约先后排的事件:先攒着(见 releaseHeld)
    if (this.held && this.earlyOrder(kind, b) < 0 && this.arrivalOrder(kind, a, b) < 0) {
      const chain = typeof booked === 'number' ? [booked] : booked;
      this.held.push({ tick, kind, a, b, ver, booked: chain.map((y) => Math.round(y * TICKS_PER_YEAR)), sub, i: this.held.length });
      return;
    }
    this.push(tick, kind, a, b, ver);
  }

  /** 放进事件堆(tick = 取整好的时刻;ver = 州 a 此刻的版本号,不核对 = −1) */
  private push(tick: number, kind: number, a: number, b: number, ver: number): void {
    if (EARLY_SPAN + this.seq >= SEQ_SPAN) throw new Error('CivSim:事件太多(超过 2^28 个)');
    let id: number;
    if (this.free.length) id = this.free.pop()!;
    else {
      id = this.evCount++;
      if (id === this.evT.length) this.growEvents();
    }
    this.evT[id] = tick / TICKS_PER_YEAR;
    this.evKind[id] = kind;
    this.evA[id] = a;
    this.evB[id] = b;
    this.evVer[id] = ver;
    const early = this.earlyOrder(kind, b);
    const order = this.arrivalOrder(kind, a, b);
    this.heap.push(id, tick * TICK_SPAN + (early >= 0 ? early : order >= 0 ? SEQ_SPAN + order : EARLY_SPAN + this.seq++));
  }

  /** 变化日志(只读;推演中会增长、换数组,用完就丢,不要存下来):发展度按它找大崩解里散出去的州 */
  get logView(): Readonly<ChangeLog> {
    return this.log;
  }

  /** 已经记了几条史事 */
  get annalCount(): number {
    return this.annals.length;
  }

  /** 第 i 条史事(只读) */
  annal(i: number): Readonly<Annal> {
    return this.annals[i];
  }

  /** 到此刻为止的史事(只读;推演中会增长,用完就丢,不要存下来):作者的将领此刻手上是哪场仗按它推(appoint.ts) */
  get annalsView(): readonly Readonly<Annal>[] {
    return this.annals;
  }

  /** 待处理的事件数(含已过期、还没弹出的) */
  get pending(): number {
    return this.heap.size;
  }

  /** 唯一改归属的入口:写日志、版本号 +1、通知这一层的监听者。新值等于旧值时什么都不做 */
  setOwner(layer: Layer, region: number, value: number, cause: number): void {
    const own = this.owners[layer];
    const prev = own[region];
    if (prev === value) return;
    own[region] = value;
    this.version[region]++;
    this.log.push(this.now, region, layer, value, cause);
    for (const fn of this.listeners[layer]) fn(region, value, prev, cause);
  }

  /**
   * 记一条史事(年份 = 现在)。没给的字段记 −1;各种类用哪些字段见 types.ts 的 AnnalKind。
   * 只记,不改归属;改归属还是走 setOwner。
   */
  record(kind: AnnalKind, f: Partial<Omit<Annal, 'year' | 'kind'>> = {}): void {
    const e: Annal = {
      year: this.now,
      kind,
      a: f.a ?? -1,
      b: f.b ?? -1,
      region: f.region ?? -1,
      settlement: f.settlement ?? -1,
      war: f.war ?? -1,
    };
    // 可有可无的几列照 ANNAL_EXTRAS 的次序抄(数组抄一份)
    for (const k of ANNAL_EXTRAS) {
      const v = f[k];
      if (v !== undefined) (e as unknown as Record<string, unknown>)[k] = Array.isArray(v) ? v.slice() : v;
    }
    this.annals.push(e);
  }

  /** 推演到 untilYear(含这一年的事件);途中每过一个整百年存一个检查点,隔几年看一眼的(everyYears)到点就看 */
  run(untilYear: Year): void {
    const untilTick = Math.floor(untilYear * TICKS_PER_YEAR + 1e-9);
    const limit = (untilTick + 1) * TICK_SPAN;
    const heap = this.heap;
    while (heap.size && heap.pri[0] < limit) {
      const id = heap.pop();
      const t = this.evT[id];
      while (this.nextCheckpoint <= untilYear && t > this.nextCheckpoint) this.checkpoint();
      if (t > this.nextYearly) this.runYearly(t, false);
      if (t > this.now) this.now = t;
      const kind = this.evKind[id];
      const a = this.evA[id];
      const b = this.evB[id];
      const ver = this.evVer[id];
      this.free.push(id);
      this.processed++;
      if (ver >= 0 && this.version[a] !== ver) continue; // 过期
      this.handlers[kind]?.(a, b, t);
    }
    while (this.nextCheckpoint <= untilYear) this.checkpoint();
    if (this.nextYearly <= untilYear) this.runYearly(untilYear, true);
    if (untilYear > this.now) this.now = untilYear;
  }

  /** 推演结果(日志裁成正好的长度;归属数组是副本) */
  result(): SimResult {
    return {
      endYear: this.now,
      log: this.log.toChangeLog(),
      checkpoints: this.checkpoints.slice(),
      culture: this.owners[Layer.Culture].slice(),
      polity: this.owners[Layer.Polity].slice(),
      annals: this.annals.map((e) => ({ ...e })),
    };
  }

  private checkpoint() {
    this.checkpoints.push({
      year: this.nextCheckpoint,
      culture: this.owners[Layer.Culture].slice(),
      polity: this.owners[Layer.Polity].slice(),
    });
    this.nextCheckpoint += CHECKPOINT_EVERY;
  }

  private growEvents() {
    const n = this.evT.length * 2;
    const t = new Float64Array(n);
    t.set(this.evT);
    this.evT = t;
    const k = new Uint8Array(n);
    k.set(this.evKind);
    this.evKind = k;
    const a = new Int32Array(n);
    a.set(this.evA);
    this.evA = a;
    const b = new Int32Array(n);
    b.set(this.evB);
    this.evB = b;
    const v = new Int32Array(n);
    v.set(this.evVer);
    this.evVer = v;
  }
}

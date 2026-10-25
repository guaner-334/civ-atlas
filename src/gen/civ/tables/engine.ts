/**
 * 数表引擎:按登记卡(cards.ts)把一组表一步一步往前算。
 *
 * - **每张表只写自己,可以读任何表**;读到的都是"这一步开头"的值,先后顺序不影响结果。
 *   例外是卡上写了 after 的:同一年里排在那几张表(和它们的 after,一路往上)之后算,直接写它们的名字读到它们刚算完的新值;
 *   prev(表) 总是这一步开头的值。按 after 分层:每层算完一起换新,层与层之间事件层可以插一手(step 的 between)
 * - **频率**:第 y 年要算的是 y 是自己频率整数倍的那几张表(频率从 FREQUENCIES 里挑,对得齐)。
 *   第一步的 dt 是 0;之后 dt = 离自己上一次算过了几年。快表读慢表 = 慢表最近一次的值;慢表读快表可以用 avg / total
 * - **护栏**(每张表每算一步查一遍):
 *   · 不是数(NaN、无穷大):这条规则当即拦下,有备份规则的换成备份重算这一步,没有的关掉(等于 off),记一条 incident;
 *   · 超出上下限、一年变得比 maxRate 还多:压回来;一大半格子顶着上限好些步,记一条"越滚越大"的提醒;
 *   · 来回震荡(大批格子一步涨一步跌、而且不见收,连着好几步):和不是数一样拦下
 *   卡上写了 builtin(自带的规则)的只查不是数。拼成函数的规则在写回时就顺手压上下限、记下第一个不是数的格子,省掉再扫一遍
 * - **搬家(move)**:先按规则算出新值,再按"往每个邻格搬多少"搬:一格搬出去的总量不超过它有的,
 *   搬出的从这格减、加到邻格,总量不变;卡上写了 flowEvery 的,按州对州汇总成流向(地图上画箭头用)
 * - **全 0 跳过**(zeroStays):自己是 0、邻格也全是 0 的格子不算(结果和全算一样)
 * - **快照**:snapshot() 存下此刻所有表和引擎自己的状态,restore() 接上以后和一口气算下去逐位一样;
 *   别处存的状态(旧存档)用 set() 填回各表、resume() 接上"上一步算到哪一年"
 * - **事件层**:input(id) 拿到输入表、编号表的数组直接填;write(id, …) 把事件的结果写回表(打仗扣人口……)
 *
 * 只用加减乘除和舍入过的超越函数(rand.ts),随机数按"种子、表、位置、年份、栏"取,不同电脑、不同先后都逐位一致。
 * 纯计算,不碰 DOM,能在后台线程和 Node 里跑。
 */
import { subSeed } from '../../util';
import { cardProblems, colCount, FREQUENCIES, type TableCard, type Unit } from './cards';
import { buildKernels, compileCard, evalAllowed, RuleError, type Backend, type CardCode, type CardKernels, type Frame } from './compile';

/** 地块、州的结构(由世界和州表给) */
export interface EngineUnits {
  tile?: { count: number; adjStart: Int32Array; adj: Int32Array };
  region?: {
    count: number;
    adjStart: Int32Array;
    adj: Int32Array;
    /** 邻边属性(规则里的 edge.kind / len / border) */
    adjKind?: Uint8Array;
    adjLen?: Float32Array;
    adjBorder?: Float32Array;
    /** 州 → 治所地块(rand 的位置锚) */
    seat: Int32Array;
    /** 地块 → 州(−1 = 海);州里的地块(CSR) */
    of?: Int32Array;
    cellStart?: Int32Array;
    cells?: Int32Array;
  };
}

export interface EngineOptions {
  seed: number;
  cards: readonly TableCard[];
  units: EngineUnits;
  /** 所有规则都能用的常数 */
  consts?: Record<string, number | readonly number[]>;
  /** 州 → 国 的编号表(按州的 id 表);不写 = 没有国这一级 */
  owner?: string;
  /** 拼函数 / 闭包;auto = 能拼就拼 */
  backend?: Backend | 'auto';
}

/** 护栏拦下或提醒的一件事 */
export interface Incident {
  table: string;
  name: string;
  year: number;
  kind: 'nan' | 'oscillate' | 'runaway';
  /** 拦下以后:换成备份规则 / 关掉 / 只是提醒 */
  action: 'fallback' | 'off' | 'warn';
  /** 第一处出事的格子、栏、值 */
  index?: number;
  col?: number;
  value?: number;
  message: string;
}

/** 一段时间里州对州搬了多少(按 from 排好;同一对只一条) */
export interface FlowWindow {
  start: number;
  end: number;
  col: Uint16Array;
  from: Int32Array;
  to: Int32Array;
  amount: Float64Array;
}

/** 引擎此刻的全部状态(restore 接上后和一口气算下去逐位一样) */
export interface TableSnapshot {
  year: number;
  lastStep: number;
  polityCount: number;
  polityAnchor: Int32Array;
  tables: Record<string, TableStateSnap>;
  acc: { key: string; data: Float64Array; from: number; at: number }[];
}

interface TableStateSnap {
  cur: Float64Array;
  last: number;
  disabled: boolean;
  fallback: boolean;
  delta: Float64Array | null;
  oscStreak: number;
  runStreak: number;
  warned: boolean;
  flowStart: number;
  flowOpen: [number, number][];
  flowWindows: number;
}

/** 卡写错了、规则查不过、地块 / 州的结构对不上:problems 是给人看的中文,一条一句 */
export class TableSetupError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
    this.name = 'TableSetupError';
  }
}

/** 震荡:变了的格子里一步反向、幅度不比上一步小多少(≥ OSC_KEEP 倍)的占这么多以上,连着这么多步 → 拦下 */
const OSC_SHARE = 0.3;
const OSC_STEPS = 6;
const OSC_KEEP = 0.9;
/** 变化小于 (1 + |值|) 的这么多倍的不算变了(舍入误差) */
const OSC_EPS = 1e-12;
/** 越滚越大:这么多格子顶着上限,连着这么多步 → 提醒 */
const RUN_SHARE = 0.5;
const RUN_STEPS = 10;

interface Table {
  card: TableCard;
  /** 正在用的规则(拦下后换成备份) */
  code: CardCode;
  kernels: CardKernels;
  /** 卡上的规则、备份规则(拦下后换成备份;快照接回拦下以前时换回来) */
  primary: { code: CardCode; kernels: CardKernels };
  backup: { code: CardCode; kernels: CardKernels } | null;
  cols: number;
  cur: Float64Array;
  next: Float64Array;
  /** 上一次算是哪一年(NaN = 还没算过) */
  last: number;
  disabled: boolean;
  fallback: boolean;
  computed: boolean;
  /** 上一步各格变了多少(查震荡用) */
  delta: Float64Array | null;
  oscStreak: number;
  runStreak: number;
  warned: boolean;
  /** 搬家:每条邻边的量、反向边 */
  edgeBuf: Float64Array | null;
  /** 流向:正在攒的这一段从哪年起、州对州的量;攒好的各段;这一步刚搬的(护栏查过才并进去) */
  flowStart: number;
  flowOpen: Map<number, number>;
  flowStage: Map<number, number>;
  flows: FlowWindow[];
  /** 算这张表一共花了多少毫秒 */
  ms: number;
  /** 同一年里排第几层(after 里的表都在前面的层);after 一路往上的所有表 */
  depth: number;
  anc: Set<string>;
  /** 这一步已经算完换新了(读它的表要旧值时去 next 里读) */
  swapped: boolean;
}

interface Acc {
  key: string;
  reader: string;
  source: string;
  data: Float64Array;
  /** 从哪一刻攒起、攒到了哪一刻 */
  from: number;
  at: number;
}

export class TableEngine {
  readonly seed: number;
  private readonly tables = new Map<string, Table>();
  private readonly order: Table[] = [];
  private readonly accs: Acc[] = [];
  private readonly units: EngineUnits;
  private readonly owner?: string;
  private readonly rev: Partial<Record<Unit, Int32Array>> = {};
  private readonly regionOf: Int32Array;
  private polityOf: Int32Array;
  private polStart = new Int32Array(1);
  private polRegions = new Int32Array(0);
  private polityCount = 0;
  private polityAnchor = new Int32Array(0);
  private mask: Uint8Array | null = null;
  private lastStep = -Infinity;
  private started = false;
  readonly incidents: Incident[] = [];
  readonly backend: Backend;

  constructor(opts: EngineOptions) {
    this.seed = opts.seed;
    this.units = opts.units;
    this.owner = opts.owner;
    this.backend = opts.backend && opts.backend !== 'auto' ? opts.backend : evalAllowed() ? 'js' : 'closure';
    const problems: string[] = [];
    const byId = new Map<string, TableCard>();
    for (const c of opts.cards) {
      problems.push(...cardProblems(c));
      if (byId.has(c.id)) problems.push(`有两张表都叫 ${c.id}`);
      byId.set(c.id, c);
      if (c.unit === 'tile' && !opts.units.tile) problems.push(`「${c.name}」按地块记,但没给地块的结构`);
      if (c.unit === 'region' && !opts.units.region) problems.push(`「${c.name}」按州记,但没给州的结构`);
    }
    if (opts.owner) {
      const o = byId.get(opts.owner);
      if (!o || o.unit !== 'region' || o.kind !== 'id') problems.push(`州 → 国 的编号表 ${opts.owner} 要是一张按州记的编号表`);
    }
    if (problems.length) throw new TableSetupError(problems);
    const env = {
      cards: byId,
      consts: opts.consts,
      edgeAttrs: {
        region: (['kind', 'len', 'border'] as const).filter((a) => (a === 'kind' ? opts.units.region?.adjKind : a === 'len' ? opts.units.region?.adjLen : opts.units.region?.adjBorder)),
      },
    };
    const R = opts.units.region?.count ?? 0;
    this.regionOf = opts.units.region?.of ?? new Int32Array(0);
    this.polityOf = new Int32Array(R).fill(-1);
    for (const card of opts.cards) {
      let code: CardCode;
      let backup: Table['backup'] = null;
      try {
        code = compileCard(card, env);
        if (card.fallback) {
          const b = compileCard(card.fallback, env);
          backup = { code: b, kernels: buildKernels(b, this.backend) };
        }
      } catch (e) {
        if (e instanceof RuleError) {
          problems.push(e.message);
          continue;
        }
        throw e;
      }
      for (const need of [...code.needs, ...(backup?.code.needs ?? [])]) {
        const miss = this.missing(need);
        if (miss) problems.push(`「${card.name}」${miss}`);
      }
      const n = this.count(card.unit);
      const cols = colCount(card);
      // 卡上的规则或备份规则要搬家的,都要邻边的缓冲和反向边
      const moves = !!(card.move || card.fallback?.move);
      const adjN = moves ? (card.unit === 'tile' ? opts.units.tile!.adj.length : opts.units.region!.adj.length) : 0;
      const kernels = buildKernels(code, this.backend);
      const t: Table = {
        card,
        code,
        kernels,
        primary: { code, kernels },
        backup,
        cols,
        cur: new Float64Array(n * cols).fill(card.off),
        next: new Float64Array(n * cols).fill(card.off),
        last: NaN,
        disabled: false,
        fallback: false,
        computed: !card.input && card.kind !== 'id',
        delta: null,
        oscStreak: 0,
        runStreak: 0,
        warned: false,
        edgeBuf: moves ? new Float64Array(adjN) : null,
        flowStart: NaN,
        flowOpen: new Map(),
        flowStage: new Map(),
        flows: [],
        ms: 0,
        depth: 0,
        anc: new Set(),
        swapped: false,
      };
      if (moves && !this.rev[card.unit]) {
        const u = card.unit === 'tile' ? opts.units.tile! : opts.units.region!;
        const rev = reverseEdges(u.adjStart, u.adj);
        if (!rev) problems.push(`「${card.name}」要搬家,但${card.unit === 'tile' ? '地块' : '州'}的邻接不对称`);
        else this.rev[card.unit] = rev;
      }
      this.tables.set(card.id, t);
      this.order.push(t);
    }
    if (problems.length) throw new TableSetupError(problems);
    this.layer(problems);
    const reg = opts.units.region;
    if (reg && reg.adj.some((j) => j < 0 || j >= reg.count)) problems.push('州的邻接里有不存在的州');
    if (problems.length) throw new TableSetupError(problems);
    // avg / total 的累计:每张读者表 × 每张被读的表一份
    for (const t of this.order) {
      for (const code of [t.code, t.backup?.code]) {
        if (!code) continue;
        for (const s of code.slots) {
          if (s.via === 'cur' || s.via === 'prev') continue;
          const key = `${t.card.id}<${s.table}`;
          if (this.accs.some((a) => a.key === key)) continue;
          const src = this.tables.get(s.table)!;
          this.accs.push({ key, reader: t.card.id, source: s.table, data: new Float64Array(src.cur.length), from: NaN, at: NaN });
        }
      }
    }
  }

  /** 按 after 分层(有环、写了不存在或不用算的表算写错);各表 after 一路往上的表 */
  private layer(problems: string[]): void {
    const state = new Map<string, 1 | 2>();
    const visit = (t: Table, path: string[]): void => {
      const s = state.get(t.card.id);
      if (s === 2) return;
      if (s === 1) {
        problems.push(`after 绕成了圈:${[...path, t.card.id].map((id) => this.tables.get(id)!.card.name).join(' → ')}`);
        return;
      }
      state.set(t.card.id, 1);
      for (const id of t.card.after ?? []) {
        const u = this.tables.get(id);
        if (!u || !u.computed) {
          problems.push(`「${t.card.name}」的 after 里的 ${id} ${u ? '不是算出来的表' : '没有这张表'}`);
          continue;
        }
        visit(u, [...path, t.card.id]);
        t.depth = Math.max(t.depth, u.depth + 1);
        t.anc.add(id);
        for (const a of u.anc) t.anc.add(a);
      }
      state.set(t.card.id, 2);
    };
    for (const t of this.order) visit(t, []);
  }

  /** 规则要的结构缺了什么(没缺 = null) */
  private missing(need: string): string | null {
    const u = this.units;
    if (need === 'regionOf' || need.startsWith('members.region.tile') || need.startsWith('members.polity.tile')) {
      if (!u.region?.of || !u.region.cellStart || !u.region.cells) return '要知道地块在哪个州,但没给地块 → 州的对照';
    }
    if ((need === 'polityOf' || need.startsWith('members.polity')) && !this.owner) return '要读国这一级,但没给州 → 国的编号表';
    if (need.startsWith('members.world.')) {
      const to = need.slice('members.world.'.length) as Unit;
      if (to === 'tile' && !u.tile) return '要汇总地块,但没给地块的结构';
      if (to === 'region' && !u.region) return '要汇总州,但没给州的结构';
    }
    if (need === 'adj.tile' && !u.tile) return '要读邻格,但没给地块的结构';
    if (need === 'adj.region' && !u.region) return '要读邻格,但没给州的结构';
    return null;
  }

  private count(u: Unit): number {
    return u === 'tile' ? (this.units.tile?.count ?? 0) : u === 'region' ? (this.units.region?.count ?? 0) : u === 'polity' ? this.polityCount : 1;
  }

  /** 所有表的卡(按登记的先后) */
  get cards(): TableCard[] {
    return this.order.map((t) => t.card);
  }

  /** 某张表此刻的值(格 × 栏;只读,别改;事件要改用 write) */
  get(id: string): Float64Array {
    return this.table(id).cur;
  }

  /** 输入表、编号表的数组,事件层直接填(填完再 step) */
  input(id: string): Float64Array {
    const t = this.table(id);
    if (t.computed) throw new Error(`${id} 是算出来的表,事件要改它用 write`);
    return t.cur;
  }

  /** 一格某栏此刻的值 */
  value(id: string, index: number, col = 0): number {
    const t = this.table(id);
    return t.cur[index * t.cols + col];
  }

  /** 事件把结果写回表(压在上下限里);下一步的规则读到的就是它 */
  write(id: string, index: number, col: number, value: number): void {
    const t = this.table(id);
    t.cur[index * t.cols + col] = Math.min(t.card.max, Math.max(t.card.min, value));
  }

  /** 某张表攒好的流向(按时间先后) */
  flows(id: string): readonly FlowWindow[] {
    return this.table(id).flows;
  }

  /** 各张表一共算了多少毫秒 */
  timing(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const t of this.order) if (t.computed) out[t.card.id] = t.ms;
    return out;
  }

  /** 这张表此刻用的是不是备份规则、是不是关掉了 */
  status(id: string): 'rule' | 'fallback' | 'off' {
    const t = this.table(id);
    return t.disabled ? 'off' : t.fallback ? 'fallback' : 'rule';
  }

  private table(id: string): Table {
    const t = this.tables.get(id);
    if (!t) throw new Error(`没有表 ${id}`);
    return t;
  }

  /** 国的个数变了(立了新国):按国记的表补上新的几格(开头的值或 off);anchor = 各国的位置锚(rand 用) */
  setPolities(count: number, anchor?: ArrayLike<number>): void {
    if (count < this.polityCount) throw new Error('国的个数只增不减(亡了的国留着编号)');
    if (count > this.polityCount) {
      for (const t of this.order) {
        if (t.card.unit !== 'polity') continue;
        const fill = typeof t.card.init === 'number' ? t.card.init : t.card.off;
        t.cur = grow(t.cur, count * t.cols, fill);
        t.next = grow(t.next, count * t.cols, fill);
        if (t.delta) t.delta = grow(t.delta, count * t.cols, 0);
      }
      for (const a of this.accs) if (this.table(a.source).card.unit === 'polity') a.data = grow(a.data, this.table(a.source).cur.length, 0);
      const an = new Int32Array(count);
      an.set(this.polityAnchor);
      this.polityAnchor = an;
      this.polityCount = count;
    }
    if (anchor) for (let p = 0; p < count && p < anchor.length; p++) this.polityAnchor[p] = anchor[p];
  }

  /** 开头:各表填上开头的值(要先填好输入表) */
  start(year: number): void {
    this.started = true;
    this.lastStep = -Infinity;
    // 开头的值也可能读国这一级的输入表:先按编号表把州 → 国对上
    this.refreshPolities();
    for (const t of this.order) {
      if (!t.computed) continue;
      t.last = NaN;
      const init = t.card.init;
      if (typeof init === 'number') t.cur.fill(init);
      else if (init !== undefined && t.kernels.init) {
        const f = this.frame(t, t.code, 0, year);
        for (let c = 0; c < t.cols; c++) t.kernels.init(f, 0, this.count(t.card.unit), c, t.cur, t.cols, null);
        clampAll(t.cur, t.card.min, t.card.max);
      } else t.cur.fill(t.card.off);
    }
    for (const a of this.accs) {
      a.data.fill(0);
      a.from = a.at = year;
    }
  }

  /** 把别处存的值填回一张表(格 × 栏,长度要对;不压上下限、不查护栏) */
  set(id: string, values: ArrayLike<number>): void {
    const t = this.table(id);
    if (values.length !== t.cur.length) throw new Error(`${id} 要 ${t.cur.length} 个数,给了 ${values.length} 个`);
    t.cur.set(values);
  }

  /** 接着别处存的状态算:上一步算到第 last 年(start、set 之后调;下一步各表的 dt 从 last 算起) */
  resume(last: number): void {
    if (!this.started) throw new Error('先 start 再 resume');
    this.lastStep = last;
    for (const t of this.order) if (t.computed) t.last = last;
    for (const a of this.accs) {
      a.data.fill(0);
      a.from = a.at = last;
    }
  }

  /** 第 year 年要算哪几张表 */
  due(year: number): Table['card'][] {
    return this.order.filter((t) => t.computed && !t.disabled && isDue(t.card.every ?? 1, year)).map((t) => t.card);
  }

  /**
   * 算第 year 年(年份是半年的整数倍、比上一步晚);返回这一步算了几张表。
   * between:按 after 分的每一层算完换新以后调一次(这一层是哪几张表),事件层在这里 write 的,后面几层读到的就是写过的
   */
  step(year: number, between?: (done: readonly string[]) => void): number {
    if (!this.started) throw new Error('先 start 再 step');
    if (!(year > this.lastStep) || !Number.isInteger(year * 2)) throw new Error(`第 ${year} 年不能算:要比上一步(${this.lastStep})晚,是半年的整数倍`);
    const due = this.order.filter((t) => t.computed && !t.disabled && isDue(t.card.every ?? 1, year));
    this.lastStep = year;
    // avg / total:攒到这一刻(按各表这一步开头的值;没有表要算的年份也攒,输入表每步都可能变)
    for (const a of this.accs) {
      if (year > a.at) {
        const src = this.table(a.source).cur;
        const w = year - a.at;
        const d = a.data;
        for (let i = 0; i < d.length; i++) d[i] += src[i] * w;
        a.at = year;
      }
    }
    if (!due.length) return 0;
    this.refreshPolities();
    const depth = Math.max(...due.map((t) => t.depth));
    try {
      for (let d = 0; d <= depth; d++) {
        const layer = due.filter((t) => t.depth === d);
        if (!layer.length) continue;
        for (const t of layer) this.compute(t, year);
        for (const t of layer) {
          const x = t.cur;
          t.cur = t.next;
          t.next = x;
          t.last = year;
          t.swapped = true;
        }
        between?.(layer.map((t) => t.card.id));
      }
    } finally {
      for (const t of due) t.swapped = false;
    }
    // 读者表算过了:它的累计从这一刻重新攒
    const ran = new Set(due.map((t) => t.card.id));
    for (const a of this.accs) {
      if (!ran.has(a.reader)) continue;
      a.data.fill(0);
      a.from = year;
    }
    return due.length;
  }

  /** 州 → 国:按编号表刷新;国里的州(CSR)重建 */
  private refreshPolities(): void {
    if (!this.owner) return;
    const own = this.table(this.owner).cur;
    const R = this.polityOf.length;
    const P = this.polityCount;
    const cnt = new Int32Array(P + 1);
    for (let r = 0; r < R; r++) {
      const p = own[r];
      const q = p >= 0 && p < P ? p : -1;
      this.polityOf[r] = q;
      if (q >= 0) cnt[q + 1]++;
    }
    for (let p = 0; p < P; p++) cnt[p + 1] += cnt[p];
    const list = new Int32Array(cnt[P]);
    const at = cnt.slice(0, P);
    for (let r = 0; r < R; r++) {
      const q = this.polityOf[r];
      if (q >= 0) list[at[q]++] = r;
    }
    this.polStart = cnt;
    this.polRegions = list;
  }

  private frame(t: Table, code: CardCode, dt: number, year: number): Frame {
    const u = this.units;
    const B: Float64Array[] = [];
    const span = new Float64Array(code.slots.length);
    code.slots.forEach((s, i) => {
      const src = this.table(s.table);
      if (s.via === 'cur' || s.via === 'prev') {
        // 这一步已经换新的表:after 一路往上的读新值,别的(和 prev)读这一步开头的值(换新后在 next 里)
        B.push(src.swapped && (s.via === 'prev' || !t.anc.has(s.table)) ? src.next : src.cur);
        return;
      }
      const a = this.accs.find((x) => x.reader === t.card.id && x.source === s.table)!;
      const w = a.at - a.from;
      if (s.via === 'avg' && !(w > 0)) {
        // 还没攒(第一步、或同一年刚算过):平均就是此刻的值
        B.push(src.cur);
        span[i] = 1;
      } else {
        B.push(a.data);
        span[i] = w;
      }
    });
    return {
      B,
      span,
      dt,
      year,
      seed: subSeed(this.seed, `tables:${t.card.id}`),
      yearKey: Math.round(year * 2) | 0,
      regionOf: this.regionOf,
      polityOf: this.polityOf,
      adjStart: { tile: u.tile?.adjStart, region: u.region?.adjStart },
      adj: { tile: u.tile?.adj, region: u.region?.adj },
      edge: { kind: u.region?.adjKind, len: u.region?.adjLen, border: u.region?.adjBorder },
      cellStart: u.region?.cellStart ?? new Int32Array(1),
      cells: u.region?.cells ?? new Int32Array(0),
      polStart: this.polStart,
      polRegions: this.polRegions,
      anchor: { region: u.region?.seat, polity: this.polityAnchor },
      count: { tile: this.count('tile'), region: this.count('region'), polity: this.polityCount, world: 1 },
    };
  }

  /** 算一张表的这一步,写进 t.next(护栏查过) */
  private compute(t: Table, year: number): void {
    const t0 = performance.now();
    const dt = Number.isNaN(t.last) ? 0 : year - t.last;
    let bad = this.run(t, t.code, t.kernels, dt, year);
    if (bad && t.backup && !t.fallback) {
      this.report(t, year, bad, 'fallback');
      t.fallback = true;
      t.code = t.backup.code;
      t.kernels = t.backup.kernels;
      t.oscStreak = 0;
      t.flowStage.clear();
      bad = this.run(t, t.code, t.kernels, dt, year);
    }
    if (bad) {
      this.report(t, year, bad, 'off');
      t.disabled = true;
      t.next.fill(t.card.off);
      t.flowStage.clear();
    } else if (t.card.flowEvery) this.commitFlows(t, year);
    t.ms += performance.now() - t0;
  }

  /** 跑一遍规则、搬家、护栏;出了要拦下的事返回它 */
  private run(t: Table, code: CardCode, k: CardKernels, dt: number, year: number): Bad | null {
    const n = this.count(t.card.unit);
    const C = t.cols;
    const f = this.frame(t, code, dt, year);
    const next = t.next;
    next.set(t.cur);
    const sparse = !!t.card.zeroStays;
    // 拼函数的核写的时候已经压了上下限、记下了第一处不是数的(见 compile.ts);每栏都有规则、不搬家、不限每年变多少时护栏就不用再走一遍
    let bad = -1;
    const worst = (b: number) => {
      if (b >= 0 && (bad < 0 || b < bad)) bad = b;
    };
    if (k.group && !sparse) worst(k.group(f, 0, n, 0, next, C, null));
    else
      for (let c = 0; c < C; c++) {
        const kern = k.cell[c];
        if (!kern) continue;
        worst(kern(f, 0, n, c, next, C, sparse ? this.activeMask(t, c) : null));
      }
    const moved = !!k.move && dt > 0;
    if (moved) for (let c = 0; c < C; c++) this.move(t, f, k, c, dt, year, sparse ? this.activeMask(t, c) : null);
    const done = k.clamps && !moved && t.card.maxRate === undefined && code.rule.every((r, c) => r || code.rate[c]);
    return this.guard(t, dt, year, done ? bad : null);
  }

  /** 全 0 跳过:第 c 栏自己或邻格不是 0 的格子 */
  private activeMask(t: Table, c: number): Uint8Array {
    const u = t.card.unit === 'tile' ? this.units.tile! : this.units.region!;
    const n = u.count;
    if (!this.mask || this.mask.length < n) this.mask = new Uint8Array(n);
    const m = this.mask;
    const cur = t.cur;
    const C = t.cols;
    const { adjStart, adj } = u;
    for (let i = 0; i < n; i++) {
      let on = cur[i * C + c] !== 0 ? 1 : 0;
      for (let q = adjStart[i]; !on && q < adjStart[i + 1]; q++) if (cur[adj[q] * C + c] !== 0) on = 1;
      m[i] = on;
    }
    return m;
  }

  /** 第 c 栏搬家(见文件头) */
  private move(t: Table, f: Frame, k: CardKernels, c: number, dt: number, year: number, mask: Uint8Array | null): void {
    const u = t.card.unit === 'tile' ? this.units.tile! : this.units.region!;
    const n = u.count;
    const C = t.cols;
    const { adjStart, adj } = u;
    const rev = this.rev[t.card.unit]!;
    const e = t.edgeBuf!;
    e.fill(0);
    k.move!(f, 0, n, c, e, C, mask);
    const cur = t.cur;
    const next = t.next;
    // 每格搬出去的总量不超过它有的(这一步开头和按规则算完的取小的)
    for (let i = 0; i < n; i++) {
      const a = adjStart[i];
      const b = adjStart[i + 1];
      let out = 0;
      for (let q = a; q < b; q++) {
        const v = e[q] > 0 ? e[q] * dt : e[q] === e[q] ? 0 : e[q];
        e[q] = v;
        out += v;
      }
      if (!(out > 0)) continue;
      const have = Math.max(0, Math.min(cur[i * C + c], next[i * C + c]));
      if (out > have) {
        const s = have / out;
        for (let q = a; q < b; q++) e[q] *= s;
      }
    }
    for (let i = 0; i < n; i++) {
      let d = 0;
      for (let q = adjStart[i]; q < adjStart[i + 1]; q++) d += e[rev[q]] - e[q];
      if (d !== 0 || d !== d) next[i * C + c] += d;
    }
    if (t.card.flowEvery) this.recordFlows(t, c, e, adjStart, adj, n);
  }

  /** 流向:这一步搬的按州对州先记下(护栏查过再并进这一段,见 commitFlows) */
  private recordFlows(t: Table, c: number, e: Float64Array, adjStart: Int32Array, adj: Int32Array, n: number): void {
    const tile = t.card.unit === 'tile';
    const R = this.units.region?.count ?? n;
    const ro = this.regionOf;
    for (let i = 0; i < n; i++) {
      for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
        const v = e[q];
        if (!(v > 0)) continue;
        let a = i;
        let b = adj[q];
        if (tile) {
          a = ro[a];
          b = ro[b];
          if (a < 0 || b < 0 || a === b) continue;
        }
        const key = (c * R + a) * R + b;
        t.flowStage.set(key, (t.flowStage.get(key) ?? 0) + v);
      }
    }
  }

  /** 这一步过了护栏:刚搬的并进这一段;到了下一段就把上一段收好 */
  private commitFlows(t: Table, year: number): void {
    if (!t.flowStage.size) return;
    const every = t.card.flowEvery!;
    const start = Math.floor(year / every) * every;
    // year 正好是一段的结尾时算进这一段(这一步是 (year − dt, year])
    const winStart = year === start ? start - every : start;
    if (Number.isNaN(t.flowStart)) t.flowStart = winStart;
    if (winStart > t.flowStart) {
      this.closeFlows(t, t.flowStart + every);
      t.flowStart = winStart;
    }
    for (const [key, v] of t.flowStage) t.flowOpen.set(key, (t.flowOpen.get(key) ?? 0) + v);
    t.flowStage.clear();
  }

  private closeFlows(t: Table, end: number): void {
    const keys = [...t.flowOpen.keys()].sort((x, y) => x - y);
    const R = this.units.region?.count ?? this.count(t.card.unit);
    const w: FlowWindow = { start: t.flowStart, end, col: new Uint16Array(keys.length), from: new Int32Array(keys.length), to: new Int32Array(keys.length), amount: new Float64Array(keys.length) };
    keys.forEach((key, i) => {
      w.to[i] = key % R;
      const rest = (key - w.to[i]) / R;
      w.from[i] = rest % R;
      w.col[i] = (rest - w.from[i]) / R;
      w.amount[i] = t.flowOpen.get(key)!;
    });
    t.flows.push(w);
    t.flowOpen.clear();
  }

  /** 推演结束时:把正在攒的那一段流向也收好 */
  closeAllFlows(year: number): void {
    for (const t of this.order) if (t.card.flowEvery && t.flowOpen.size) this.closeFlows(t, year);
  }

  /**
   * 护栏(见文件头):压回上下限和每年变化的上限,查不是数、震荡、越滚越大。
   * kernelBad 不是 null = 核已经压过上下限、查过是不是数(第一处不是数的位置;没有 = −1)
   */
  private guard(t: Table, dt: number, year: number, kernelBad: number | null): Bad | null {
    const { min, max, maxRate } = t.card;
    const next = t.next;
    const cur = t.cur;
    const N = next.length;
    let high = 0;
    const nan = (i: number): Bad => ({ kind: 'nan', index: (i / t.cols) | 0, col: i % t.cols, value: next[i] });
    if (kernelBad !== null) {
      if (kernelBad >= 0) return nan(kernelBad);
    } else {
      const lim = maxRate !== undefined && dt > 0 ? maxRate * dt : Infinity;
      // 一遍里查不是数、压回上下限(和每年变化的上限);查到不是数的那一格就停(这一步整个不要了)
      for (let i = 0; i < N; i++) {
        let v = next[i];
        if (v - v !== 0) return nan(i);
        if (lim !== Infinity) {
          const o = cur[i];
          if (v > o + lim) v = o + lim;
          else if (v < o - lim) v = o - lim;
        }
        if (v > max) v = max;
        else if (v < min) v = min;
        next[i] = v;
      }
    }
    if (t.card.builtin || !(dt > 0)) return null;
    // 来回震荡:变了的格子里,这一步和上一步反向、幅度又不见收的占几成(一步步收拢的不算)
    const delta = (t.delta ??= new Float64Array(N));
    let changed = 0;
    let flips = 0;
    for (let i = 0; i < N; i++) {
      const v = next[i];
      if (v === max) high++;
      let d = v - cur[i];
      const o = cur[i];
      if (Math.abs(d) <= OSC_EPS * (1 + Math.abs(o))) d = 0;
      if (d !== 0) {
        changed++;
        const p = delta[i];
        if ((d > 0 ? p < 0 : p > 0) && Math.abs(d) >= OSC_KEEP * Math.abs(p)) flips++;
      }
      delta[i] = d;
    }
    t.oscStreak = changed > 0.01 * N && flips > OSC_SHARE * changed ? t.oscStreak + 1 : 0;
    if (t.oscStreak >= OSC_STEPS) return { kind: 'oscillate' };
    // 越滚越大:一大半格子顶着上限(上限不是 0 的表才看)
    t.runStreak = max !== min && high > RUN_SHARE * N && max > 0 && min < max ? t.runStreak + 1 : 0;
    if (t.runStreak >= RUN_STEPS && !t.warned) {
      t.warned = true;
      this.report(t, year, { kind: 'runaway' }, 'warn');
    }
    return null;
  }

  private report(t: Table, year: number, bad: Bad, action: Incident['action']): void {
    const name = t.card.name;
    const what =
      bad.kind === 'nan' ? `算出了不是数的值(第 ${bad.index} 格${t.cols > 1 ? `第 ${(bad.col ?? 0) + 1} 栏` : ''})`
      : bad.kind === 'oscillate' ? '来回震荡(大批格子一步涨一步跌)'
      : '越滚越大(一大半格子顶着上限)';
    const then = action === 'fallback' ? ',已换回自带的规则' : action === 'off' ? ',已关掉这张表(等于关掉时的值)' : '';
    this.incidents.push({ table: t.card.id, name, year, kind: bad.kind, action, index: bad.index, col: bad.col, value: bad.value, message: `规则「${name}」在第 ${year} 年${what}${then}` });
  }

  /** 此刻的全部状态 */
  snapshot(): TableSnapshot {
    const tables: Record<string, TableStateSnap> = {};
    for (const t of this.order) {
      tables[t.card.id] = {
        cur: t.cur.slice(),
        last: t.last,
        disabled: t.disabled,
        fallback: t.fallback,
        delta: t.delta ? t.delta.slice() : null,
        oscStreak: t.oscStreak,
        runStreak: t.runStreak,
        warned: t.warned,
        flowStart: t.flowStart,
        flowOpen: [...t.flowOpen.entries()],
        flowWindows: t.flows.length,
      };
    }
    return {
      year: this.lastStep,
      lastStep: this.lastStep,
      polityCount: this.polityCount,
      polityAnchor: this.polityAnchor.slice(),
      tables,
      acc: this.accs.map((a) => ({ key: a.key, data: a.data.slice(), from: a.from, at: a.at })),
    };
  }

  /** 接上一份快照(同一组卡);之后的流向、提醒丢掉 */
  restore(s: TableSnapshot): void {
    this.setPolities(Math.max(this.polityCount, s.polityCount));
    this.polityAnchor.set(s.polityAnchor.subarray(0, this.polityAnchor.length));
    for (const t of this.order) {
      const x = s.tables[t.card.id];
      if (!x) throw new Error(`快照里没有表 ${t.card.id}`);
      t.cur = grow(x.cur.slice(), t.cur.length, typeof t.card.init === 'number' ? t.card.init : t.card.off);
      t.next = new Float64Array(t.cur.length);
      t.last = x.last;
      t.disabled = x.disabled;
      if (x.fallback && !t.backup) throw new Error(`快照里 ${t.card.id} 用的是备份规则,这张卡没有备份`);
      const use = x.fallback ? t.backup! : t.primary;
      t.code = use.code;
      t.kernels = use.kernels;
      t.fallback = x.fallback;
      t.delta = x.delta ? x.delta.slice() : null;
      t.oscStreak = x.oscStreak;
      t.runStreak = x.runStreak;
      t.warned = x.warned;
      t.flowStart = x.flowStart;
      t.flowOpen = new Map(x.flowOpen);
      t.flowStage.clear();
      t.flows.length = Math.min(t.flows.length, x.flowWindows);
    }
    for (const a of this.accs) {
      const x = s.acc.find((y) => y.key === a.key);
      if (!x) throw new Error(`快照里没有累计 ${a.key}`);
      a.data = grow(x.data.slice(), a.data.length, 0);
      a.from = x.from;
      a.at = x.at;
    }
    this.lastStep = s.lastStep;
    this.started = true;
    const keep = this.incidents.filter((i) => i.year <= s.year);
    this.incidents.length = 0;
    this.incidents.push(...keep);
  }
}

interface Bad {
  kind: Incident['kind'];
  index?: number;
  col?: number;
  value?: number;
}

/** year 是不是 every 的整数倍(按半年一格算,避开小数) */
function isDue(every: number, year: number): boolean {
  const e = Math.round(every * 2);
  const y = Math.round(year * 2);
  return ((y % e) + e) % e === 0;
}

/** 邻接表里每条边 i → j 的反向边 j → i 的下标;不对称 = null */
function reverseEdges(adjStart: Int32Array, adj: Int32Array): Int32Array | null {
  const rev = new Int32Array(adj.length);
  const n = adjStart.length - 1;
  for (let i = 0; i < n; i++) {
    for (let q = adjStart[i]; q < adjStart[i + 1]; q++) {
      const j = adj[q];
      let found = -1;
      for (let w = adjStart[j]; w < adjStart[j + 1]; w++) {
        if (adj[w] === i) {
          found = w;
          break;
        }
      }
      if (found < 0) return null;
      rev[q] = found;
    }
  }
  return rev;
}

function clampAll(a: Float64Array, min: number, max: number): void {
  for (let i = 0; i < a.length; i++) a[i] = Math.min(max, Math.max(min, a[i]));
}

function grow(a: Float64Array, n: number, fill: number): Float64Array {
  if (a.length >= n) return a;
  const b = new Float64Array(n).fill(fill);
  b.set(a);
  return b;
}

export { FREQUENCIES };

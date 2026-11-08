/**
 * 推演插件那一段:某一刻官方的事件、检查点、每隔几年那几样都办完(CivSim.run 推到这一刻)以后才轮到插件,按给的先后各出手一次。
 * 插件不进官方的事件堆、不取官方的随机数、不改归属,所以怎么出手官方的历史都一样。
 * 出手是交一回合(PluginTurn)、收一份回话(PluginReply),叫插件的是驱动:插件同步跑还是在别处等回话,推演代码是同一份。
 */
import { Layer, type Annal, type AnnalKind } from '../types';
import { keyed, keyed4, subSeed } from './rand';
import type { CivSim } from './sim';
import { FREQUENCIES, TableEngine, colCount, type TableCard, type TableSnapshot } from './tables';

/** 引擎的时间精度(1/256 年)、能约的最远时刻:和 CivSim 一样 */
const TICKS = 256;
const MAX_TICK = 2 ** 24;

/** 插件编号的写法(和世界文件里记插件的一样) */
const PLUGIN_ID = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const PLUGIN_ID_MAX = 32;

/** 一个世界最多几个推演插件、每个插件最多几张表几栏、同时约着几件事、一件事带几个数、小本子多大多深、一次出手下几条命令 */
export const PLUGIN_LIMITS = { plugins: 4, tables: 16, cols: 64, pending: 4096, data: 16, note: 64 * 1024, depth: 8, listen: 64, commands: 64 } as const;

/** 插件按国记的表用这张表对上州 → 国(插件自己的表不能叫这个名字) */
const OWNER_TABLE = '国';
/** 表名最长几个字(存进世界的表名、累计名按这个核对) */
const TABLE_ID_MAX = 64;

/** 哪个插件出了什么错 */
export class PluginError extends Error {
  readonly plugin: string;
  constructor(plugin: string, message: string, options?: { cause?: unknown }) {
    super(`推演插件 ${plugin}:${message}`, options);
    this.name = 'PluginError';
    this.plugin = plugin;
  }
}

/** 插件用时的上限(毫秒):一个插件在一刻里(算表、出手、办回话)多久;一段推演(新建、接着推各算一段)里所有插件加起来多久 */
export const PLUGIN_TIME = { moment: 2000, total: 30_000 } as const;

const sec = (ms: number) => (ms / 1000).toFixed(1);

/**
 * 一段推演里插件的用时:这一段上所有插件那一段(地形大事前后、推到底的那一支)记在同一份上,超了上限停下。
 * 计时只决定停不停,不进历史;超了算谁的:一刻超了是那一刻的插件,加起来超了是用得最多的那个
 */
export class PluginClock {
  private readonly spent = new Map<string, number>();
  private sum = 0;

  /** now 不给 = performance.now(单测换成假的) */
  constructor(readonly now: () => number = () => performance.now()) {}

  /** 记上 id 在第 year 年这一刻从 t0 起用的时长 */
  charge(id: string, t0: number, year: number): void {
    const ms = this.now() - t0;
    this.spent.set(id, (this.spent.get(id) ?? 0) + ms);
    this.sum += ms;
    if (ms > PLUGIN_TIME.moment) throw new PluginError(id, `第 ${year} 年这一刻用了 ${sec(ms)} 秒,超过 ${sec(PLUGIN_TIME.moment)} 秒`);
    if (this.sum > PLUGIN_TIME.total) {
      let top = id;
      for (const [k, v] of this.spent) if (v > this.spent.get(top)!) top = k;
      throw new PluginError(top, `推到第 ${year} 年,所有推演插件一共用了 ${sec(this.sum)} 秒,超过 ${sec(PLUGIN_TIME.total)} 秒(它用得最多,${sec(this.spent.get(top)!)} 秒)`);
    }
  }
}

/** 插件自己约的一件事 */
export interface PluginEvent {
  year: number;
  kind: number;
  data: number[];
}

/** 小本子:只放数(数、数组、对象,一层层套) */
export type PluginNote = number | PluginNote[] | { [key: string]: PluginNote };

/** 交给插件的一回合 */
export interface PluginTurn<V> {
  /** 此刻(这一刻官方的都办完了) */
  readonly year: number;
  /** 照频率该出手的一刻(第 0 年那一次也算) */
  readonly tick: boolean;
  /** 这一刻到了的、自己约的事(按约的先后) */
  readonly events: readonly PluginEvent[];
  /** 上次出手以后官方记下的、listen 里那几种史事(按发生先后,第 0 年那一次是第 0 年的) */
  readonly heard: readonly Annal[];
  /** 小本子(复制的一份;要改就在回话里交回整本) */
  readonly note: PluginNote | undefined;
  /** 读口(规则包给的) */
  readonly read: V;
  /** 自己的表此刻的值(复制的一份,格 × 栏) */
  table(id: string): Float64Array;
  /** 自己的随机数:[0, 1),按键直接算,和先后无关(键当整数用) */
  rand(a: number, b?: number, c?: number, d?: number): number;
}

/** 插件的回话;什么都不交 = 什么都不改 */
export interface PluginReply {
  /** 换上的小本子 */
  note?: PluginNote;
  /** 约以后的事(时刻要比此刻晚) */
  at?: readonly { year: number; kind: number; data?: readonly number[] }[];
  /** 换掉自己几张表的值(格 × 栏,个数要对;压回上下限) */
  tables?: Readonly<Record<string, ArrayLike<number>>>;
  /** 下命令(规则包认的写法):此刻的下一格生效 */
  commands?: readonly unknown[];
}

/** 一个推演插件 */
export interface SimPlugin<V = unknown> {
  readonly id: string;
  /** 每隔几年出手一次(从 FREQUENCIES 里挑);不给 = 只在第 0 年和自己约的事件那一刻 */
  readonly every?: number;
  /** 自己的数表(不能按地块) */
  readonly tables?: readonly TableCard[];
  /** 自己的输入表接哪张官方表:表名 → 官方表的稳定名字(单位要一样,只能一栏) */
  readonly inputs?: Readonly<Record<string, string>>;
  /** 要听的史事种类 */
  readonly listen?: readonly AnnalKind[];
  act(turn: PluginTurn<V>): PluginReply | void;
}

/** 规则包给插件那一段的东西(这一段推演一份) */
export interface PluginBridge<V> {
  read: V;
  /** 州的结构(插件按州记的表用) */
  regions: { count: number; adjStart: Int32Array; adj: Int32Array; seat: Int32Array };
  /** 此刻有几国(亡了的也算)、各国的位置锚(数表里按国取随机数用) */
  polities(): { count: number; anchor: ArrayLike<number> };
  /** 官方表的单位;没有这个名字 = undefined */
  unit(name: string): 'region' | 'polity' | undefined;
  /** 官方表此刻的值(一州或一国一个数) */
  official(name: string): Float64Array;
  /** 收下一个插件这次下的几条命令,从 at 那一刻(年)起生效;有一条不合格抛错、说清是哪条,一条都不收。不给 = 这套规则不收命令 */
  commands?(plugin: string, list: readonly unknown[], at: number): void;
}

/** 交给驱动的一回合:叫哪个插件 */
export interface PluginAsk<V = unknown> {
  plugin: SimPlugin<V>;
  turn: PluginTurn<V>;
}

/**
 * 一个插件推到 year 那一刻的状态(这一刻的插件那一段办完了)。
 * events:约着的事,每件 [时刻(1/256 年为单位), 第几件约的, 种类, 几个数, 数…] 接在一起,按时刻、约的先后排
 */
export interface SimPluginState {
  id: string;
  /** 插件的设定(频率、表、接哪些官方表、听哪些史事)的指纹:设定改了,存下的状态不能接着用 */
  sig: number;
  year: number;
  /** 史事听到了第几条 */
  heard: number;
  /** 下一件约的事是第几件 */
  seq: number;
  events: Float64Array;
  note?: PluginNote;
  tables?: TableSnapshot;
}

/** 当场叫插件(插件在推演线程里同步跑);交回的是还没出来的结果 = 插件写错了 */
export function answerNow<V>(ask: PluginAsk<V>): PluginReply | undefined {
  let out: unknown;
  try {
    out = ask.plugin.act(ask.turn);
  } catch (e) {
    if (e instanceof PluginError) throw e;
    throw new PluginError(ask.plugin.id, e instanceof Error ? e.message : String(e), { cause: e });
  }
  if (out && typeof (out as { then?: unknown }).then === 'function') throw new PluginError(ask.plugin.id, '回话要当场交回');
  return (out ?? undefined) as PluginReply | undefined;
}

interface Booked {
  tick: number;
  seq: number;
  kind: number;
  data: number[];
}

const isBadKey = (k: string) => k === '__proto__' || k === 'constructor' || k === 'prototype';

/** 小本子查一遍、复制一份:只许数(有限的)、数组、普通对象,层数和大小有上限 */
function cleanNote(id: string, v: unknown): PluginNote {
  let size = 0;
  const bad = (what: string): never => {
    throw new PluginError(id, `小本子${what}`);
  };
  const walk = (x: unknown, depth: number): PluginNote => {
    if (depth > PLUGIN_LIMITS.depth) bad(`超过 ${PLUGIN_LIMITS.depth} 层`);
    size += 8;
    if (size > PLUGIN_LIMITS.note) bad(`超过 ${PLUGIN_LIMITS.note} 字节`);
    if (typeof x === 'number') return Number.isFinite(x) ? x : bad('里的数要是有限的');
    if (Array.isArray(x)) {
      const out: PluginNote[] = new Array(x.length);
      for (let i = 0; i < x.length; i++) out[i] = walk(x[i], depth + 1);
      return out;
    }
    if (x !== null && typeof x === 'object') {
      const proto = Object.getPrototypeOf(x);
      if (proto !== Object.prototype && proto !== null) bad('里只能放数、数组和普通对象');
      const out: Record<string, PluginNote> = {};
      for (const k of Object.keys(x)) {
        if (isBadKey(k)) bad(`里不能有叫 ${k} 的键`);
        size += k.length * 2;
        out[k] = walk((x as Record<string, unknown>)[k], depth + 1);
      }
      return out;
    }
    return bad('里只能放数、数组和普通对象');
  };
  return walk(v, 0);
}

const isInt = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

/** 一个插件在这一段推演里 */
class Host<V> {
  readonly id: string;
  /** 照频率出手、算表的间隔(1/256 年为单位;0 = 没有) */
  private readonly every: number;
  private readonly tableEvery: number;
  private readonly rand: number;
  private readonly sig: number;
  private readonly eng: TableEngine | null;
  private readonly cards = new Map<string, TableCard>();
  private readonly inputs: [string, string][] = [];
  private readonly ownsPolities: boolean;
  private readonly listen: ReadonlySet<string> | null;
  /** 办到哪一刻了(1/256 年为单位;还没开始 = −1) */
  at = -1;
  /** 下一次出手或算表的时刻 */
  next = 0;
  private heard = 0;
  private seq = 0;
  private events: Booked[] = [];
  private note: PluginNote | undefined;

  constructor(
    readonly plugin: SimPlugin<V>,
    private readonly sim: CivSim,
    private readonly bridge: PluginBridge<V>,
    seed: number,
    private readonly clock: PluginClock,
  ) {
    const id = plugin.id;
    this.id = id;
    const fail = (what: string): never => {
      throw new PluginError(id, what);
    };
    if (typeof plugin.act !== 'function') fail('没有 act');
    if (plugin.every !== undefined && !FREQUENCIES.includes(plugin.every)) fail(`出手的频率只能从 ${FREQUENCIES.join('、')} 年里挑`);
    this.every = plugin.every === undefined ? 0 : plugin.every * TICKS;
    const listen = plugin.listen ?? [];
    if (!Array.isArray(listen) || listen.length > PLUGIN_LIMITS.listen || listen.some((k) => typeof k !== 'string')) fail('listen 要是不超过 64 个史事种类');
    this.listen = listen.length ? new Set(listen) : null;
    this.rand = subSeed(seed, `plugin:${id}`);
    this.sig = subSeed(0, JSON.stringify([plugin.every ?? null, plugin.tables ?? [], plugin.inputs ?? {}, listen]));

    const cards = plugin.tables ?? [];
    if (!Array.isArray(cards) || cards.length > PLUGIN_LIMITS.tables) fail(`最多 ${PLUGIN_LIMITS.tables} 张表`);
    let cols = 0;
    for (const c of cards) {
      if (c.id === OWNER_TABLE) fail(`表不能叫 ${OWNER_TABLE}`);
      if (typeof c.id !== 'string' || c.id.length > TABLE_ID_MAX) fail(`表名最长 ${TABLE_ID_MAX} 个字`);
      if (c.unit === 'tile') fail(`表 ${c.id} 不能按地块记`);
      cols += colCount(c);
      this.cards.set(c.id, c);
    }
    if (cols > PLUGIN_LIMITS.cols) fail(`所有表加起来最多 ${PLUGIN_LIMITS.cols} 栏`);
    for (const [t, name] of Object.entries(plugin.inputs ?? {})) {
      const c = this.cards.get(t);
      if (!c || !c.input || colCount(c) !== 1) fail(`接官方表的 ${t} 要是自己的一栏的输入表`);
      const unit = bridge.unit(name);
      if (!unit) fail(`没有官方表 ${name}`);
      if (unit !== c!.unit) fail(`${t} 和官方表 ${name} 的单位不一样`);
      this.inputs.push([t, name]);
    }
    this.ownsPolities = cards.some((c) => c.unit === 'polity');
    let tableEvery = Infinity;
    for (const c of cards) if (!c.input && c.kind !== 'id') tableEvery = Math.min(tableEvery, (c.every ?? 1) * TICKS);
    this.tableEvery = tableEvery < Infinity ? tableEvery : 0;
    if (cards.length) {
      const r = bridge.regions;
      const all = this.ownsPolities ? [...cards, { id: OWNER_TABLE, name: OWNER_TABLE, unit: 'region', kind: 'id', min: -1, max: 2 ** 15, off: -1 } as TableCard] : cards;
      try {
        this.eng = new TableEngine({
          seed: subSeed(seed, `plugin-tables:${id}`),
          cards: all,
          units: { region: { count: r.count, adjStart: r.adjStart, adj: r.adj, seat: r.seat } },
          ...(this.ownsPolities ? { owner: OWNER_TABLE } : {}),
        });
      } catch (e) {
        throw new PluginError(id, e instanceof Error ? e.message : String(e), { cause: e });
      }
    } else this.eng = null;
  }

  /** 照存下的状态接上(year = 接着推的那一刻) */
  restore(s: SimPluginState, year: number): void {
    const fail = (what: string): never => {
      throw new PluginError(this.id, `存下的状态${what}`);
    };
    if (s.id !== this.id || s.year !== year) fail('和这段历史对不上');
    if (s.sig !== this.sig) fail('和插件现在的设定对不上');
    const at = Math.round(year * TICKS);
    if (!(at >= 0 && at < MAX_TICK && at === year * TICKS)) fail('的时刻不对');
    if (!isInt(s.heard, 0, this.sim.annalCount)) fail('的史事条数不对');
    if (!isInt(s.seq, 0, 2 ** 52)) fail('的事件编号不对');
    if (!(s.events instanceof Float64Array)) fail('的事件不对');
    const ev = s.events;
    const events: Booked[] = [];
    for (let i = 0; i < ev.length; ) {
      if (i + 4 > ev.length) fail('的事件不对');
      const [tick, seq, kind, n] = [ev[i], ev[i + 1], ev[i + 2], ev[i + 3]];
      const prev = events[events.length - 1];
      if (!isInt(tick, at + 1, MAX_TICK - 1) || !isInt(seq, 0, s.seq - 1) || !isInt(kind, 0, 0xffff) || !isInt(n, 0, PLUGIN_LIMITS.data) || i + 4 + n > ev.length) fail('的事件不对');
      if (prev && (tick < prev.tick || (tick === prev.tick && seq <= prev.seq))) fail('的事件没排好');
      events.push({ tick, seq, kind, data: Array.from(ev.subarray(i + 4, i + 4 + n)) });
      i += 4 + n;
    }
    if (events.length > PLUGIN_LIMITS.pending) fail('约的事太多');
    if ((s.tables !== undefined) !== !!this.eng) fail('和插件的表对不上');
    if (this.eng) {
      // 表、栏、格数都要和插件现在的卡对得上(插件改过表的,存下的状态不能接着用)
      const saved = s.tables!;
      const cards = this.eng.cards;
      const P = saved?.polityCount;
      if (!saved || typeof saved.tables !== 'object' || !isInt(P, 0, 2 ** 15)) fail('的表不对');
      if (Object.keys(saved.tables).length !== cards.length) fail('和插件的表对不上');
      for (const c of cards) {
        const cur = saved.tables[c.id]?.cur;
        const cols = colCount(c);
        const n = c.unit === 'world' ? cols : c.unit === 'polity' ? P * cols : -1;
        if (!(cur instanceof Float64Array) || (n >= 0 ? cur.length !== n : cur.length % cols !== 0 || cur.length > this.bridge.regions.count * cols)) fail(`的表 ${c.id} 和插件的表对不上`);
      }
      try {
        this.eng.restore(s.tables!);
      } catch (e) {
        throw new PluginError(this.id, `存下的表接不上:${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
    }
    this.note = s.note === undefined ? undefined : cleanNote(this.id, s.note);
    this.heard = s.heard;
    this.seq = s.seq;
    this.events = events;
    this.at = at;
    this.next = this.nextTick();
  }

  snapshot(year: number): SimPluginState {
    const flat: number[] = [];
    for (const e of this.events) flat.push(e.tick, e.seq, e.kind, e.data.length, ...e.data);
    return {
      id: this.id,
      sig: this.sig,
      year,
      heard: this.heard,
      seq: this.seq,
      events: Float64Array.from(flat),
      ...(this.note !== undefined ? { note: cleanNote(this.id, this.note) } : {}),
      ...(this.eng ? { tables: this.eng.snapshot() } : {}),
    };
  }

  /** at 以后最早要办的那一刻(没有 = Infinity) */
  private nextTick(): number {
    if (this.at < 0) return 0;
    let n = Infinity;
    if (this.every) n = (Math.floor(this.at / this.every) + 1) * this.every;
    if (this.tableEvery) n = Math.min(n, (Math.floor(this.at / this.tableEvery) + 1) * this.tableEvery);
    if (this.events.length) n = Math.min(n, this.events[0].tick);
    return n < MAX_TICK ? n : Infinity;
  }

  /** 这一刻(tick)要办的:算表;该出手的交出一回合、办回话 */
  *moment(tick: number): Generator<PluginAsk<V>, void, PluginReply | undefined> {
    const t0 = this.clock.now();
    const year = tick / TICKS;
    const first = this.at < 0;
    let k = 0;
    while (k < this.events.length && this.events[k].tick === tick) k++;
    const due = this.events.splice(0, k);
    this.at = tick;
    if (this.eng) {
      const seen = this.eng.incidents.length;
      try {
        // 接官方的输入表每一刻都填新的(插件出手时读到的也是这一刻的)
        this.fill();
        // 第一回从这一刻起算:先填开头的值再算一步(dt = 0),之后每一步的 dt 都是整段间隔
        if (first) this.eng.start(year);
        if (first || (this.tableEvery && tick % this.tableEvery === 0)) this.eng.step(year);
      } catch (e) {
        if (e instanceof PluginError) throw e;
        throw new PluginError(this.id, `第 ${year} 年算表出错:${e instanceof Error ? e.message : String(e)}`, { cause: e });
      }
      // 数表引擎遇到不是数、来回震荡,没有备份规则的会把表关掉接着算;插件的表不关,停下
      for (let i = seen; i < this.eng.incidents.length; i++) {
        const x = this.eng.incidents[i];
        if (x.action !== 'off') continue;
        const multi = colCount(this.cards.get(x.table)!) > 1;
        const what = x.kind === 'nan' ? `算出了不是数的值(第 ${x.index} 格${multi ? `第 ${(x.col ?? 0) + 1} 栏` : ''})` : '来回震荡(大批格子一步涨一步跌)';
        throw new PluginError(this.id, `第 ${year} 年表「${x.name}」${what}`);
      }
    }
    const isTick = first || (this.every > 0 && tick % this.every === 0);
    if (isTick || due.length) {
      const reply = yield { plugin: this.plugin, turn: this.turn(year, isTick, due) };
      this.apply(tick, reply);
      this.heard = this.sim.annalCount;
    }
    this.next = this.nextTick();
    this.clock.charge(this.id, t0, year);
  }

  /** 算表之前:州 → 国、接官方表的输入表填好 */
  private fill(): void {
    const eng = this.eng!;
    if (this.ownsPolities) {
      const { count, anchor } = this.bridge.polities();
      eng.setPolities(count, anchor);
      eng.input(OWNER_TABLE).set(this.sim.owners[Layer.Polity]);
    }
    for (const [t, name] of this.inputs) {
      const to = eng.input(t);
      const from = this.bridge.official(name);
      const n = Math.min(to.length, from.length);
      to.set(from.subarray(0, n));
      to.fill(this.cards.get(t)!.off, n);
    }
  }

  private turn(year: number, tick: boolean, due: readonly Booked[]): PluginTurn<V> {
    const heard: Annal[] = [];
    if (this.listen) {
      for (let i = this.heard; i < this.sim.annalCount; i++) {
        const e = this.sim.annal(i);
        if (!this.listen.has(e.kind)) continue;
        const c = { ...e } as Record<string, unknown>;
        for (const key of Object.keys(c)) if (Array.isArray(c[key])) c[key] = (c[key] as unknown[]).slice();
        heard.push(c as unknown as Annal);
      }
    }
    const base = this.rand;
    return {
      year,
      tick,
      events: due.map((e) => ({ year: e.tick / TICKS, kind: e.kind, data: e.data.slice() })),
      heard,
      note: this.note === undefined ? undefined : cleanNote(this.id, this.note),
      read: this.bridge.read,
      table: (t: string) => {
        if (!this.eng || !this.cards.has(t)) throw new PluginError(this.id, `没有表 ${t}`);
        return this.eng.get(t).slice();
      },
      rand: (a: number, b = 0, c = 0, d?: number) => (d === undefined ? keyed(base, a, b, c) : keyed4(base, a, b, c, d)),
    };
  }

  private apply(now: number, reply: PluginReply | undefined): void {
    if (reply === undefined || reply === null) return;
    const fail = (what: string): never => {
      throw new PluginError(this.id, what);
    };
    if (typeof reply !== 'object') fail('回话要是一个对象');
    for (const key of Object.keys(reply)) if (key !== 'note' && key !== 'at' && key !== 'tables' && key !== 'commands') fail(`回话里的 ${key} 认不出`);
    if (reply.tables !== undefined) {
      if (reply.tables === null || typeof reply.tables !== 'object') fail('回话里的 tables 要是一个对象');
      for (const [t, v] of Object.entries(reply.tables)) this.setTable(t, v);
    }
    if (reply.note !== undefined) this.note = cleanNote(this.id, reply.note);
    if (reply.at !== undefined) {
      if (!Array.isArray(reply.at)) fail('回话里的 at 要是一个数组');
      for (const b of reply.at) this.book(now, b);
    }
    if (reply.commands !== undefined) this.command(now, reply.commands);
  }

  /** 命令在下一格才生效:这一刻的检查点已经存了,同一刻后出手的插件看到的也该是官方办完时的样子 */
  private command(now: number, list: readonly unknown[]): void {
    const fail = (what: string): never => {
      throw new PluginError(this.id, what);
    };
    if (!Array.isArray(list)) fail('回话里的 commands 要是一个数组');
    if (!list.length) return;
    if (list.length > PLUGIN_LIMITS.commands) fail(`一次最多下 ${PLUGIN_LIMITS.commands} 条命令`);
    const take = this.bridge.commands;
    if (!take) fail('这套规则不收命令');
    if (now + 1 >= MAX_TICK) fail('太晚了,命令没有下一刻可以生效');
    try {
      take!.call(this.bridge, this.id, list, (now + 1) / TICKS);
    } catch (e) {
      if (e instanceof PluginError) throw e;
      throw new PluginError(this.id, `第 ${now / TICKS} 年下的命令:${e instanceof Error ? e.message : String(e)}`, { cause: e });
    }
  }

  private book(now: number, b: { year: number; kind: number; data?: readonly number[] }): void {
    const fail = (what: string): never => {
      throw new PluginError(this.id, what);
    };
    if (b === null || typeof b !== 'object' || typeof b.year !== 'number' || !Number.isFinite(b.year)) fail('约事要写清哪一年');
    const tick = Math.round(b.year * TICKS);
    if (tick <= now) fail(`约的时刻(${b.year})要比此刻(${now / TICKS})晚`);
    if (tick >= MAX_TICK) fail(`约的时刻(${b.year})太远`);
    if (!isInt(b.kind, 0, 0xffff)) fail('约的事的种类要是 0–65535 的整数');
    const data = b.data ?? [];
    if (!Array.isArray(data) || data.length > PLUGIN_LIMITS.data || data.some((x) => typeof x !== 'number' || !Number.isFinite(x))) fail(`约的事最多带 ${PLUGIN_LIMITS.data} 个有限的数`);
    if (this.events.length >= PLUGIN_LIMITS.pending) fail(`同时约着的事最多 ${PLUGIN_LIMITS.pending} 件`);
    const e: Booked = { tick, seq: this.seq++, kind: b.kind, data: data.slice() };
    // 同一刻的排在先约的后面
    let lo = 0;
    let hi = this.events.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].tick <= tick) lo = mid + 1;
      else hi = mid;
    }
    this.events.splice(lo, 0, e);
  }

  private setTable(t: string, v: ArrayLike<number>): void {
    const card = this.cards.get(t);
    if (!card || !this.eng) throw new PluginError(this.id, `没有表 ${t}`);
    if (this.inputs.some(([x]) => x === t)) throw new PluginError(this.id, `表 ${t} 接的是官方表,不能改`);
    const cur = this.eng.get(t);
    if (!v || typeof v.length !== 'number' || v.length !== cur.length) throw new PluginError(this.id, `表 ${t} 要交 ${cur.length} 个数`);
    const out = new Float64Array(cur.length);
    for (let i = 0; i < out.length; i++) {
      const x = v[i];
      if (typeof x !== 'number' || !Number.isFinite(x)) throw new PluginError(this.id, `表 ${t} 第 ${i} 个不是有限的数`);
      out[i] = Math.min(card.max, Math.max(card.min, x));
    }
    this.eng.set(t, out);
  }
}

/** 一段推演(一个引擎)上的所有推演插件,按给的先后出手 */
export class PluginLine<V> {
  private readonly hosts: Host<V>[];

  /** saved = 接着推时存下的状态(和 plugins 一一对上,year = 接着推的那一刻);从第 0 年起推 = null。clock = 这一段推演记用时的那一份 */
  constructor(
    sim: CivSim,
    bridge: PluginBridge<V>,
    plugins: readonly SimPlugin<V>[],
    seed: number,
    saved: { states: readonly SimPluginState[]; year: number } | null,
    clock: PluginClock = new PluginClock(),
  ) {
    if (plugins.length > PLUGIN_LIMITS.plugins) throw new Error(`一个世界最多 ${PLUGIN_LIMITS.plugins} 个推演插件`);
    const ids = new Set<string>();
    for (const p of plugins) {
      const id = typeof p?.id === 'string' ? p.id : '';
      if (!PLUGIN_ID.test(id) || id.length > PLUGIN_ID_MAX) throw new Error(`推演插件的编号 ${id} 不对`);
      if (ids.has(id)) throw new Error(`推演插件 ${id} 给了两次`);
      ids.add(id);
    }
    this.hosts = plugins.map((p) => new Host(p, sim, bridge, seed, clock));
    if (saved) {
      if (saved.states.length !== plugins.length) throw new Error('存下的推演插件和给的对不上');
      this.hosts.forEach((h, i) => h.restore(saved.states[i], saved.year));
    }
  }

  /** 下一处插件要办事的时刻(年;没有 = Infinity) */
  next(): number {
    let n = Infinity;
    for (const h of this.hosts) if (h.next < n) n = h.next;
    return n / TICKS;
  }

  /** 办 year 那一刻的插件那一段(year = next() 给的,这一刻官方的都办完了) */
  *moment(year: number): Generator<PluginAsk<V>, void, PluginReply | undefined> {
    const tick = Math.round(year * TICKS);
    for (const h of this.hosts) if (h.next === tick) yield* h.moment(tick);
  }

  /** 推到 year 那一刻的状态(按插件的先后) */
  snapshot(year: number): SimPluginState[] {
    return this.hosts.map((h) => h.snapshot(year));
  }
}

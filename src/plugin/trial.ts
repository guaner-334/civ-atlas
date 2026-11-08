/**
 * 审插件时的试跑:在示例世界上照固定的办法替插件点选(最大的城和同一块陆地上的另一座、最大的那一国),拦下它对你写的东西的修改,
 * 记下它拿了什么、替它点了什么、画了什么、发了多少话、日志和出的错。纯逻辑,不碰 DOM;沙箱、截图由叫的地方管。
 */
import { fullChronicle } from '../gen/civ/story/religionText';
import type { Civ } from '../gen/civ/types';
import { EMPTY_EDITS } from '../gen/edits';
import type { World } from '../gen/world';
import { PluginApiError, type CellLayer, type MarkLayer } from './check';
import type { PickAnswer, PickRequest, PluginSink, PluginSource } from './host';
import { historyAt, historyPolities, historySettlements } from './read';
import type { PanelNode, ViewInfo } from './types';

/** 一个种子最多跑多久(从开沙箱算起) */
export const TRIAL_MS = 20_000;
/** 这么久没交来东西、线程也空着,就算跑完了 */
export const TRIAL_QUIET_MS = 500;
/** 和后台收的上限一样 */
export const TRIAL_LINE_MAX = 300;
export const TRIAL_LOG_LINES = 50;

/** 交给后台的「它做了什么」,五项都是一句话 */
export interface TrialDid {
  got: string;
  picked: string;
  drew: string;
  wrote: string;
  said: string;
}

export interface TrialCity {
  cell: number;
  name: string;
}
export interface TrialBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cells: Int32Array;
  name: string;
}

/** 替插件点的:点一处先给最大的城,再给走陆路连得到的城里最大的(没有就给第二大的,sameLand = false);框一片给最大的那一国的外接框 */
export interface TrialPicks {
  cities: TrialCity[];
  sameLand: boolean;
  box: TrialBox | null;
}

/** 框住的地块(东西两头连着;和网站上框选交给插件的一样) */
export function cellsInTrialBox(world: World, x0: number, w: number, y0: number, y1: number): Int32Array {
  const W = world.width;
  const { x, y, n } = world.mesh;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    if (y[i] < y0 || y[i] > y1) continue;
    const dx = (((x[i] - x0) % W) + W) % W;
    if (dx <= w) out.push(i);
  }
  return Int32Array.from(out);
}

/** 东西相连时盖住这些 x 的最窄一段:从最大的空档后面开始 */
export function wrapSpan(xs: readonly number[], W: number): { x0: number; w: number } {
  const s = [...xs].sort((a, b) => a - b);
  let gap = s[0] + W - s[s.length - 1];
  let start = s[0];
  let end = s[s.length - 1];
  for (let i = 0; i + 1 < s.length; i++) {
    const g = s[i + 1] - s[i];
    if (g > gap) {
      gap = g;
      start = s[i + 1];
      end = s[i] + W;
    }
  }
  return { x0: ((start % W) + W) % W, w: end - start };
}

/** 从地块 c 走陆路(不是水的地块、相邻)连得到的地块;和插件拿到的 water、neighbors 算法一样 */
export function landFrom(world: World, c: number): Uint8Array {
  const { water } = world;
  const { n, adjStart, adj } = world.mesh;
  const on = new Uint8Array(n);
  if (water[c] !== 0) return on;
  const q = new Int32Array(n);
  let qh = 0;
  let qt = 0;
  q[qt++] = c;
  on[c] = 1;
  while (qh < qt) {
    const i = q[qh++];
    for (let k = adjStart[i]; k < adjStart[i + 1]; k++) {
      const j = adj[k];
      if (water[j] === 0 && !on[j]) {
        on[j] = 1;
        q[qt++] = j;
      }
    }
  }
  return on;
}

export function trialPicks(world: World, civ: Civ | null, year: number): TrialPicks {
  if (!civ) return { cities: [], sameLand: false, box: null };
  const towns = historySettlements(civ, { year })
    .filter((s) => (s.population ?? 0) > 0)
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0) || a.id - b.id);
  const land = towns.length > 1 ? landFrom(world, towns[0].cell) : null;
  const near = land ? towns.slice(1).find((s) => land[s.cell] === 1) : undefined;
  const second = near ?? towns[1];
  const cities = [towns[0], second].filter((s) => s !== undefined).map((s) => ({ cell: s.cell, name: s.name }));
  const sameLand = near !== undefined;
  const own = historyAt(world, civ, { year, fields: ['polity'] }, (a) => a).polity!;
  const count = new Map<number, number>();
  for (let i = 0; i < own.length; i++) if (own[i] >= 0) count.set(own[i], (count.get(own[i]) ?? 0) + 1);
  let best = -1;
  for (const [p, n] of count) if (best < 0 || n > count.get(best)! || (n === count.get(best)! && p < best)) best = p;
  if (best < 0) return { cities, sameLand, box: null };
  const { x, y } = world.mesh;
  const xs: number[] = [];
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < own.length; i++) {
    if (own[i] !== best) continue;
    xs.push(x[i]);
    y0 = Math.min(y0, y[i]);
    y1 = Math.max(y1, y[i]);
  }
  const span = wrapSpan(xs, world.width);
  const name = historyPolities(civ, { year }).find((p) => p.id === best)?.name ?? `第 ${best} 国`;
  return { cities, sameLand, box: { x0: span.x0, y0, x1: span.x0 + span.w, y1, cells: cellsInTrialBox(world, span.x0, span.w, y0, y1), name } };
}

/** 去掉换行这类控制字符,超长截断(按码位) */
export function trialLine(s: string, max = TRIAL_LINE_MAX): string {
  // eslint-disable-next-line no-control-regex
  const t = [...s.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()];
  return t.length > max ? `${t.slice(0, max - 1).join('')}…` : t.join('');
}

const GOT: [string, string][] = [
  ['world.', '地图'],
  ['history.', '历史'],
  ['author.', '你写的'],
  ['view.get', '看的状态'],
  ['store.', '它存的数据'],
];
/** 只拿东西的调用(改东西、画东西、点选、日志不算) */
const isRead = (call: string) => (call.startsWith('author.') ? call !== 'author.apply' : call === 'view.get' || /^(world|history)\./.test(call) || /^store\.(local|world)\.get$/.test(call));

const MARK_UNIT: Record<MarkLayer['items'][number]['kind'], [string, string]> = {
  line: ['条', '线'],
  point: ['个', '点'],
  label: ['处', '字'],
  area: ['片', '圈'],
};

const n = (v: number) => v.toLocaleString('en-US');

export interface TrialRecorderOptions {
  world: World;
  civ: Civ | null;
  year: number;
  /** 默认 performance.now */
  now?: () => number;
}

/** 试跑时给插件的世界、收插件交来的;记下它做的每一样 */
export class TrialRecorder {
  readonly world: World;
  readonly civ: Civ | null;
  readonly view: ViewInfo;
  readonly picks: TrialPicks;
  /** 最后一次有动静的时候 */
  last: number;
  panel: PanelNode[] | null = null;
  readonly layers = new Map<string, CellLayer | MarkLayer>();
  /** 第一个算插件的错(崩了、没接住的 Promise、没反应……) */
  error: string | null = null;
  private readonly now: () => number;
  private readonly calls = new Map<string, number>();
  private cellFields = 0;
  /** 每条话到的时候 */
  private readonly said: number[] = [];
  private readonly logs: string[] = [];
  private readonly answered: string[] = [];
  private boxed: string | null = null;
  private asks = 0;
  private cellsAsks = 0;
  private blocked = 0;
  private readonly blockedKeys = new Set<string>();
  private badEdits = 0;
  private cityAt = 0;
  private boxAt = 0;
  private frozen = false;
  private halted = false;

  constructor(o: TrialRecorderOptions) {
    this.world = o.world;
    this.civ = o.civ;
    this.now = o.now ?? (() => performance.now());
    this.last = this.now();
    this.view = { year: o.year, selected: null, visible: { x0: 0, y0: 0, x1: o.world.width, y1: o.world.height }, layer: null };
    this.picks = trialPicks(o.world, o.civ, o.year);
  }

  private touch() {
    this.last = this.now();
  }

  /** 插件线程一直忙到 t(在算,没交东西):也算动静 */
  busyUntil(t: number): void {
    this.last = Math.max(this.last, t);
  }

  /** 记下算插件的错(只记第一个) */
  fault(text: string): void {
    this.error ??= trialLine(text);
  }

  /** 要截图了:之后交来的面板、图层不再记 */
  freeze(): void {
    this.frozen = true;
  }

  /** 沙箱停下时网站先替插件拿掉面板和图层再说停了:拿掉的晚一步记,真停了就不记(截图要停下前那一刻的) */
  private later(f: () => void) {
    queueMicrotask(() => {
      if (!this.halted && !this.frozen) f();
    });
  }

  /** 试跑的世界:没有你写的东西;改你写的一律拦下 */
  source(): PluginSource {
    return {
      world: () => this.world,
      civ: () => this.civ,
      edits: () => EMPTY_EDITS,
      title: () => '示例世界',
      chronicle: () => (this.civ ? fullChronicle(this.civ) : null),
      notes: () => [],
      view: () => this.view,
      pick: (req) => this.pick(req),
      commit: (_next, keys) => {
        this.touch();
        this.blocked++;
        for (const k of keys) this.blockedKeys.add(k);
        return '试跑的时候不改你写的东西';
      },
    };
  }

  private pick(req: PickRequest): Promise<PickAnswer | null> {
    this.touch();
    if (req.kind === 'cells') {
      this.cellsAsks++;
      return Promise.reject(new PluginApiError('unavailable', '网站这一版还不能一次点好几块,先用 pick.cell 或 pick.box'));
    }
    this.asks++;
    if (req.kind === 'cell') {
      const c = this.cityAt < 2 ? this.picks.cities[this.cityAt++] : undefined;
      if (!c) return Promise.resolve(null);
      this.answered.push(c.name);
      return Promise.resolve({ cell: c.cell });
    }
    const b = this.boxAt++ === 0 ? this.picks.box : null;
    if (!b) return Promise.resolve(null);
    this.boxed = b.name;
    return Promise.resolve({ x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, cells: b.cells.slice() });
  }

  sink(): PluginSink {
    return {
      called: (call, args) => {
        this.touch();
        this.said.push(this.last);
        this.calls.set(call, (this.calls.get(call) ?? 0) + 1);
        if (call === 'world.cells' && args && typeof args === 'object' && Array.isArray((args as { fields?: unknown }).fields)) {
          this.cellFields = Math.max(this.cellFields, new Set((args as { fields: unknown[] }).fields).size);
        }
      },
      panel: (nodes) => {
        if (this.frozen) return;
        this.touch();
        if (nodes) this.panel = nodes;
        else this.later(() => (this.panel = null));
      },
      layer: (id, l) => {
        if (this.frozen) return;
        this.touch();
        if (l) {
          this.layers.delete(id);
          this.layers.set(id, l);
        } else this.later(() => this.layers.delete(id));
      },
      log: (text, level) => {
        this.touch();
        if (level === 'error') this.fault(text);
        this.addLog(level === 'error' ? `出错：${text}` : text);
      },
      failed: (call, code, text) => {
        if (code === 'cancelled' || (call === 'author.apply' && code === 'blocked')) return;
        this.addLog(`调用 ${call} 没成（${code}）：${text}`);
      },
      refused: () => {
        this.badEdits++;
      },
    };
  }

  /** 插件 civAtlas.post 来的一条话 */
  posted(): void {
    this.touch();
    this.said.push(this.last);
  }

  /** 沙箱停了:我们自己叫停的不算 */
  stopped(reason: string, detail: string): void {
    if (reason === 'stopped') return;
    this.halted = true;
    const d = detail.replace(/^Uncaught /, '').replace(/^Error: /, '');
    if (reason === 'crashed') this.fault(`它出错停下了：${d || '没说是什么错'}`);
    else if (reason === 'start-timeout' || reason === 'unresponsive') this.fault('它没有反应，网站把它停下了');
    else if (reason === 'flood') this.fault('它一秒里发给网站的话太多，网站把它停下了');
    else if (reason === 'oversize') this.fault('它一次发给网站的东西太大，网站把它停下了');
    else this.fault('它发了网站不认得的话，网站把它停下了');
  }

  private addLog(text: string) {
    if (this.logs.length < TRIAL_LOG_LINES) this.logs.push(trialLine(text));
  }

  logLines(): string[] {
    return this.logs.slice();
  }

  /** 开着的地块图层(网站上一次只铺一个:最后交的那个) */
  cellLayer(): CellLayer | null {
    let out: CellLayer | null = null;
    for (const l of this.layers.values()) if (l.kind === 'cells') out = l;
    return out;
  }

  markLayers(): MarkLayer[] {
    return [...this.layers.values()].filter((l): l is MarkLayer => l.kind === 'marks');
  }

  did(): TrialDid {
    return { got: trialLine(this.gotText()), picked: trialLine(this.pickedText()), drew: trialLine(this.drewText()), wrote: trialLine(this.wroteText()), said: trialLine(this.saidText()) };
  }

  private gotText(): string {
    const parts: string[] = [];
    for (const [prefix, label] of GOT) {
      const names: string[] = [];
      let times = 0;
      for (const [call, k] of this.calls) {
        if (!isRead(call) || !call.startsWith(prefix)) continue;
        times += k;
        const short = call.slice(call.indexOf('.') + 1);
        names.push(call === 'world.cells' && this.cellFields ? `${short} ${this.cellFields} 种数` : short);
      }
      if (times) parts.push(`${label} ${n(times)} 次（${names.join('、')}）`);
    }
    return parts.length ? parts.join('、') : '没拿';
  }

  private pickedText(): string {
    const parts: string[] = [];
    if (this.answered.length) {
      const why = this.answered.length < 2 ? '最大的城' : this.picks.sameLand ? '最大的城，和同一块陆地上最大的另一座' : '最大的两座城：最大的城那块陆地上没有别的城，第二座隔着水';
      parts.push(`${this.answered.join('、')}（${why}）`);
    }
    if (this.boxed) parts.push(`框了「${this.boxed}」那一片（最大的那一国）`);
    const extra = this.asks - this.answered.length - (this.boxed ? 1 : 0);
    if (extra > 0) parts.push(`${parts.length ? '之后又' : ''}请点 ${extra} 次，当作不点了`);
    if (this.cellsAsks) parts.push(`要一次点好几块 ${this.cellsAsks} 次，网站这一版还不会`);
    return parts.length ? parts.join('；') : '没请点';
  }

  private drewText(): string {
    const parts: string[] = [];
    for (const l of this.layers.values()) {
      if (l.kind === 'cells') {
        let k = 0;
        for (let i = 0; i < l.values.length; i++) if (!Number.isNaN(l.values[i])) k++;
        parts.push(`地块图层「${l.title}」涂了 ${n(k)} 块`);
        continue;
      }
      const by = new Map<string, number>();
      for (const it of l.items) by.set(it.kind, (by.get(it.kind) ?? 0) + 1);
      const items = [...by].map(([kind, k]) => `${n(k)} ${MARK_UNIT[kind as keyof typeof MARK_UNIT].join('')}`);
      parts.push(items.length ? items.join('、') : `标注图层「${l.title}」是空的`);
    }
    return parts.length ? parts.join('；') : '没画';
  }

  private wroteText(): string {
    const parts: string[] = [];
    if (this.blocked) {
      const keys = [...this.blockedKeys];
      parts.push(`想改 ${n(this.blocked)} 次，都拦下了${keys.length ? `（${keys.slice(0, 5).join('、')}${keys.length > 5 ? ' 等' : ''}）` : ''}`);
    }
    if (this.badEdits) parts.push(`交来的修改不对 ${n(this.badEdits)} 次`);
    return parts.length ? parts.join('；') : '没有';
  }

  private saidText(): string {
    const t = this.said;
    let peak = 0;
    for (let i = 0, j = 0; i < t.length; i++) {
      while (t[i] - t[j] >= 1000) j++;
      peak = Math.max(peak, i - j + 1);
    }
    return t.length ? `${n(t.length)} 条，一秒最多 ${n(peak)} 条` : '没发话';
  }
}

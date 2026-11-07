/**
 * 网站这边的插件接口:开沙箱、查能力、回插件的调用、把面板和图层交给画的那一边、转发事件。
 * 只在用到插件时 import(),首页不带它。世界从哪来、面板和图层怎么画,由调用的地方给(PluginSource、PluginSink)。
 */
import type { Civ } from '../gen/civ/types';
import type { ChronicleEntry } from '../gen/civ/story/chronicle';
import type { WorldEdits } from '../gen/edits';
import type { World } from '../gen/world';
import type { AuthorNote } from '../gen/worldFormat';
import { checkCaps, PLUGIN_EVENTS, PLUGIN_METHODS } from './caps';
import { PLUGIN_API } from './pluginFile';
import {
  argsOf,
  cellList,
  checkCellLayer,
  checkMarkLayer,
  checkPanel,
  id as checkId,
  int,
  LAYERS_MAX,
  num,
  optInt,
  optText,
  panelValue,
  PluginApiError,
  text,
  type CellLayer,
  type MarkLayer,
} from './check';
import { planChanges } from './edit';
import { approxBytes } from './protocol';
import * as read from './read';
import { startPluginSandbox, type PluginSandbox, type StopReason } from './sandbox';
import { checkStored, defaultLocalStore, defaultWorldStore, storedOut, STORE_LOCAL_MAX, STORE_WORLD_MAX, type PluginDataStore } from './store';
import type { CapRef, HostInfo, PanelNode, PluginErrorCode, ViewInfo } from './types';

export interface PickRequest {
  kind: 'cell' | 'cells' | 'box';
  /** 插件写给用的人看的一句话(工具模式顶条上) */
  hint: string;
  /** cells:最多几块 */
  max?: number;
}
export type PickAnswer = { cell: number } | { cells: ArrayLike<number> } | { x0: number; y0: number; x1: number; y1: number; cells: ArrayLike<number> };

/** 插件读的世界从哪来(打开世界的地方给;civ 是套上了改名的那份) */
export interface PluginSource {
  world(): World | null;
  civ(): Civ | null;
  edits(): WorldEdits;
  title?(): string;
  chronicle?(): readonly ChronicleEntry[] | null;
  notes?(): readonly AuthorNote[];
  view?(): ViewInfo;
  /** 看的年份、选中的东西变了就调 fn;返回取消的函数 */
  watchView?(fn: () => void): () => void;
  /** 请用的人在地图上点选;取消了 = null。signal 断了(插件停了)就收起 */
  pick?(req: PickRequest, signal: AbortSignal): Promise<PickAnswer | null>;
  /**
   * 照插件的要求把修改换成 next(整批记一步撤销;网站的修改现在就是 edits() 那一份)。keys = 这批碰到的稳定键。
   * 现在不让改 = 原因。网站这边的做法见 editsCommit.ts
   */
  commit?(next: WorldEdits, keys: string[]): string | null;
}

/** 插件交来的面板、图层、日志交给谁(null = 拿掉) */
export interface PluginSink {
  panel?(nodes: PanelNode[] | null): void;
  layer?(id: string, layer: CellLayer | MarkLayer | null): void;
  log?(text: string): void;
}

export interface PluginHostOptions {
  /** 清单里和能力有关的几项 */
  plugin: { id: string; requires?: unknown; optional?: unknown };
  code: string;
  source: PluginSource;
  sink?: PluginSink;
  /** 可选的能力里用的人给了哪些;不给 = 都给 */
  grant?: readonly CapRef[];
  /** 插件自己的数据存到哪;不给 = 先放在内存里 */
  stores?: { local?: PluginDataStore; world?: PluginDataStore };
  parent?: HTMLElement;
  startTimeoutMs?: number;
  /** 插件 civAtlas.post 发来的(工具模式里用) */
  onMessage?: (data: unknown) => void;
  onStop?: (reason: StopReason, detail: string) => void;
}

/** 清单要的能力不对,没开沙箱:broken = 写法不对,newer = 要新版网站 */
export class PluginRefused extends Error {
  constructor(
    readonly kind: 'broken' | 'newer',
    text: string,
  ) {
    super(text);
    this.name = 'PluginRefused';
  }
}

export interface PluginHost {
  readonly id: string;
  readonly caps: readonly CapRef[];
  readonly sandbox: PluginSandbox;
  /** 用的人动了插件面板上的控件(画面板的地方调;值不合那个控件就不转给插件) */
  panelAction(id: string, value?: unknown): void;
  stop(): void;
}

/** 每秒最多递给插件多少字节,多了回 busy:拷贝在网站这边做,太多会卡拖地图 */
export const OUT_BYTES_PER_SECOND = 64 * 1024 * 1024;
/** 同时最多几个还没回的调用(点选这种要等用的人的) */
export const INFLIGHT_MAX = 16;
/** 一秒最多提几次修改:每次都要量一遍改完的存档 */
export const APPLY_PER_SECOND = 10;
/** view.year、view.select 最快多久发一次 */
export const VIEW_EVENT_MS = 250;
export const LOG_MAX = 2000;
const HINT_MAX = 40;
export const APP_NAME = '文明与地图';

const unavailable = (t: string): never => {
  throw new PluginApiError('unavailable', t);
};

/** 太长的日志只记前 LOG_MAX 个字,末尾说截掉了多少(不拆开半个表情这类两格的字) */
function logText(raw: unknown): string {
  const s = text(raw, 'text', Infinity, true);
  if (s.length <= LOG_MAX) return s;
  const keep = /[\ud800-\udbff]/.test(s[LOG_MAX - 1]) ? LOG_MAX - 1 : LOG_MAX;
  return `${s.slice(0, keep)}…(截掉了后面 ${s.length - keep} 个字)`;
}

class Host implements PluginHost {
  sb: PluginSandbox | null = null;
  private early: [number, string, unknown][] = [];
  private inflight = 0;
  private spent = 0;
  private spentFrom = 0;
  private panel: PanelNode[] | null = null;
  private readonly layers = new Map<string, CellLayer | MarkLayer>();
  private picking: AbortController | null = null;
  private unwatch: (() => void) | null = null;
  private lastView: { year: number; select: string } | null = null;
  private readonly viewTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly viewSent = new Map<string, number>();
  private done = false;
  /** 最近 APPLY_PER_SECOND 次提修改是什么时候(环形) */
  private readonly applyTimes = new Float64Array(APPLY_PER_SECOND);
  private applied = 0;

  constructor(
    readonly id: string,
    readonly caps: readonly CapRef[],
    private readonly src: PluginSource,
    private readonly sink: PluginSink,
    private readonly stores: { local?: PluginDataStore; world?: PluginDataStore },
    private readonly onStop?: (reason: StopReason, detail: string) => void,
  ) {}

  get sandbox(): PluginSandbox {
    return this.sb!;
  }

  private has(c: CapRef) {
    return this.caps.includes(c);
  }

  attach(sb: PluginSandbox) {
    this.sb = sb;
    for (const [i, c, a] of this.early.splice(0)) this.request(i, c, a);
    if (this.has('view.read@1') && this.src.watchView && this.src.view) {
      this.lastView = this.viewKey();
      this.unwatch = this.src.watchView(() => this.viewChanged());
    }
  }

  readonly request = (rid: number, call: string, args: unknown) => {
    if (!this.sb) return void this.early.push([rid, call, args]);
    const need = Object.prototype.hasOwnProperty.call(PLUGIN_METHODS, call) ? PLUGIN_METHODS[call] : undefined;
    if (!need) return this.fail(rid, 'unknown-call', `没有 ${call} 这个调用`);
    if (need.length && !need.some((c) => this.has(c))) return this.fail(rid, 'no-permission', `清单里没要 ${need.join(' 或 ')}`);
    if (this.inflight >= INFLIGHT_MAX) return this.fail(rid, 'busy', `同时最多 ${INFLIGHT_MAX} 个调用没回`);
    const now = performance.now();
    if (now - this.spentFrom >= 1000) {
      this.spent = 0;
      this.spentFrom = now;
    }
    if (this.spent >= OUT_BYTES_PER_SECOND) return this.fail(rid, 'busy', '取数太快,过一会儿再取');
    const transfer: Transferable[] = [];
    const give: read.Give = (a) => {
      transfer.push(a.buffer);
      return a;
    };
    let out: unknown;
    try {
      out = this.handle(call, args, give);
    } catch (e) {
      return this.failWith(rid, e);
    }
    if (!(out instanceof Promise)) return this.ok(rid, out, transfer);
    this.inflight++;
    out.then(
      (v) => this.ok(rid, v, transfer),
      (e) => this.failWith(rid, e),
    ).finally(() => this.inflight--);
  };

  private ok(rid: number, data: unknown, transfer: Transferable[]) {
    this.spent += approxBytes(data, Infinity);
    this.sb?.respond(rid, { ok: true, data: data ?? null }, transfer);
  }

  private fail(rid: number, code: PluginErrorCode, t: string) {
    this.sb?.respond(rid, { ok: false, error: { code, text: t } });
  }

  private failWith(rid: number, e: unknown) {
    if (e instanceof PluginApiError) this.fail(rid, e.code, e.message);
    else this.fail(rid, 'failed', String((e as Error)?.message ?? e).slice(0, 200));
  }

  private world(): World {
    return this.src.world() ?? unavailable('还没有打开世界');
  }
  private civ(): Civ {
    return read.needCiv(this.src.civ());
  }

  private handle(call: string, args: unknown, give: read.Give): unknown {
    const src = this.src;
    switch (call) {
      case 'host.info':
        return { api: PLUGIN_API, app: APP_NAME, caps: this.caps.slice(), cells: src.world()?.mesh.n ?? 0 } satisfies HostInfo;
      case 'log':
        this.sink.log?.(logText(argsOf(args).text));
        return null;
      case 'world.info':
        return read.worldInfo(this.world(), src.title?.() ?? '');
      case 'world.cells':
        return read.worldCells(this.world(), args, give);
      case 'world.neighbors':
        return read.worldNeighbors(this.world(), give);
      case 'world.rivers':
        return read.worldRivers(this.world(), give);
      case 'world.legend':
        return read.worldLegend(args);
      case 'history.span':
        return read.historySpan(this.civ());
      case 'history.at':
        return read.historyAt(this.world(), this.civ(), args, give);
      case 'history.polities':
        return read.historyPolities(this.civ(), args);
      case 'history.settlements':
        return read.historySettlements(this.civ(), args);
      case 'history.routes':
        return read.historyRoutes(this.civ(), args, give);
      case 'history.places':
        return read.historyPlaces(this.civ());
      case 'history.cultures':
        return read.historyCultures(this.civ());
      case 'history.faiths':
        return read.historyFaiths(this.civ());
      case 'history.regions':
        return read.historyRegions(this.civ(), args);
      case 'history.people':
        return read.historyPeople(this.civ(), args);
      case 'history.events':
        return read.historyEvents(this.civ(), src.chronicle?.() ?? null, args);
      case 'author.marks':
        return read.authorMarks(src.edits());
      case 'author.names':
        return read.authorNames(src.edits());
      case 'author.characters':
        return read.authorCharacters(src.edits());
      case 'author.interventions':
        return read.authorInterventions(src.edits());
      case 'author.notes':
        return read.authorNotes(src.notes?.() ?? [], args);
      case 'author.apply': {
        const commit = src.commit ?? unavailable('网站这边还不能照插件的要求改');
        const now = performance.now();
        const slot = this.applied++ % APPLY_PER_SECOND;
        if (this.applied > APPLY_PER_SECOND && now - this.applyTimes[slot] < 1000) {
          this.applied--;
          throw new PluginApiError('busy', `一秒最多提 ${APPLY_PER_SECOND} 次修改`);
        }
        this.applyTimes[slot] = now;
        const plan = planChanges(src.edits(), src.civ(), args, this.world().params);
        if (plan.result.applied) {
          const why = commit(plan.next, plan.keys);
          if (why) throw new PluginApiError('blocked', why);
        }
        return plan.result;
      }
      case 'view.get':
        return structuredClone(src.view ? src.view() : unavailable('网站这边没给看的状态'));
      case 'pick.cell':
      case 'pick.cells':
      case 'pick.box':
        return this.pick(call.slice(5) as PickRequest['kind'], args, give);
      case 'panel.set':
        this.panel = checkPanel(argsOf(args).nodes);
        this.sink.panel?.(this.panel);
        return null;
      case 'panel.clear':
        this.panel = null;
        this.sink.panel?.(null);
        return null;
      case 'layer.cells': {
        const n = this.world().mesh.n;
        return this.putLayer(checkCellLayer(args, n));
      }
      case 'layer.marks': {
        const w = this.world();
        return this.putLayer(checkMarkLayer(args, { cells: w.mesh.n, width: w.width, height: w.height }));
      }
      case 'layer.remove': {
        const lid = checkId(argsOf(args).id, 'id');
        if (this.layers.delete(lid)) this.sink.layer?.(lid, null);
        return null;
      }
      case 'store.local.get':
        return this.storeGet(this.stores.local ?? defaultLocalStore());
      case 'store.local.set':
        return this.storeSet(this.stores.local ?? defaultLocalStore(), checkStored(args, STORE_LOCAL_MAX));
      case 'store.local.clear':
        return this.storeSet(this.stores.local ?? defaultLocalStore(), null);
      case 'store.world.get':
        return this.storeGet(this.worldStore());
      case 'store.world.set':
        return this.storeSet(this.worldStore(), checkStored(args, STORE_WORLD_MAX));
      case 'store.world.clear':
        return this.storeSet(this.worldStore(), null);
      default:
        return unavailable(`网站这一版还没开 ${call}`);
    }
  }

  private worldStore(): PluginDataStore {
    return this.stores.world ?? defaultWorldStore(this.world());
  }
  private storeGet(st: PluginDataStore): Promise<unknown> {
    return Promise.resolve(st.get(this.id)).then(storedOut);
  }
  private storeSet(st: PluginDataStore, d: ReturnType<typeof checkStored> | null): Promise<unknown> {
    return Promise.resolve(st.set(this.id, d)).then(() => null);
  }

  private putLayer(l: CellLayer | MarkLayer): null {
    const had = this.layers.get(l.id);
    if (had && had.kind !== l.kind) throw new PluginApiError('bad-args', `id ${l.id} 已经是别的图层`);
    if (!had && [...this.layers.values()].filter((x) => x.kind === l.kind).length >= LAYERS_MAX)
      throw new PluginApiError('limit', `一个插件最多 ${LAYERS_MAX} 个${l.kind === 'cells' ? '地块' : '标注'}图层`);
    this.layers.set(l.id, l);
    this.sink.layer?.(l.id, l);
    return null;
  }

  private pick(kind: PickRequest['kind'], args: unknown, give: read.Give): Promise<unknown> {
    const a = argsOf(args);
    const pick = this.src.pick;
    if (!pick) return unavailable('网站这边还不能点选');
    if (this.picking) throw new PluginApiError('busy', '上一次点选还没完');
    const n = this.world().mesh.n;
    const req: PickRequest = { kind, hint: optText(a.hint, 'hint', HINT_MAX) ?? '' };
    if (kind === 'cells') req.max = optInt(a.max, 'max', 1, n) ?? n;
    const ctl = new AbortController();
    this.picking = ctl;
    return pick(req, ctl.signal)
      .then((ans): unknown => {
        if (ctl.signal.aborted) throw new PluginApiError('cancelled', '插件停了');
        if (!ans) throw new PluginApiError('cancelled', '用的人取消了');
        const r = ans as Record<string, unknown>;
        if (kind === 'cell') return { cell: int(r.cell, 'cell', 0, n - 1) };
        const cells = give(cellList(r.cells, 'cells', n, req.max ?? n));
        if (kind === 'cells') return { cells };
        return { x0: num(r.x0, 'x0'), y0: num(r.y0, 'y0'), x1: num(r.x1, 'x1'), y1: num(r.y1, 'y1'), cells };
      })
      .finally(() => {
        if (this.picking === ctl) this.picking = null;
      });
  }

  private viewKey() {
    const v = this.src.view!();
    return { year: v.year, select: JSON.stringify(v.selected ?? null) };
  }

  private viewChanged() {
    if (this.done) return;
    const now = this.viewKey();
    const was = this.lastView;
    this.lastView = now;
    if (!was || now.year !== was.year) this.viewEvent('view.year');
    if (!was || now.select !== was.select) this.viewEvent('view.select');
  }

  /** 合并着发:离上一次不到 VIEW_EVENT_MS 就等到那时再发最新的 */
  private viewEvent(name: 'view.year' | 'view.select') {
    if (this.viewTimers.has(name)) return;
    const wait = Math.max(0, (this.viewSent.get(name) ?? -Infinity) + VIEW_EVENT_MS - performance.now());
    const fire = () => {
      this.viewTimers.delete(name);
      if (this.done || !this.src.view) return;
      this.viewSent.set(name, performance.now());
      const v = this.src.view();
      this.emit(name, name === 'view.year' ? { year: v.year } : structuredClone(v.selected ?? null));
    };
    if (wait <= 0) fire();
    else this.viewTimers.set(name, setTimeout(fire, wait));
  }

  private emit(name: string, data: unknown) {
    const need = PLUGIN_EVENTS[name];
    if (need && this.has(need)) this.sb?.emit(name, data);
  }

  panelAction(cid: string, value?: unknown) {
    if (this.done || !this.panel) return;
    const v = panelValue(this.panel, cid, value);
    if (v) this.emit('panel.action', v);
  }

  stop() {
    this.sb?.stop();
  }

  readonly stopped = (reason: StopReason, detail: string) => {
    if (this.done) return;
    this.done = true;
    this.picking?.abort();
    this.picking = null;
    this.unwatch?.();
    this.unwatch = null;
    for (const t of this.viewTimers.values()) clearTimeout(t);
    this.viewTimers.clear();
    if (this.panel) this.sink.panel?.(null);
    this.panel = null;
    for (const k of this.layers.keys()) this.sink.layer?.(k, null);
    this.layers.clear();
    this.onStop?.(reason, detail);
  };
}

/** 开一个插件:先查清单要的能力(不对就 PluginRefused,不开沙箱),再开沙箱;插件代码顶层跑完才 resolve */
export async function startPluginHost(o: PluginHostOptions): Promise<PluginHost> {
  const c = checkCaps(o.plugin.requires, o.plugin.optional);
  if (!c.ok) throw new PluginRefused(c.kind, c.text);
  const caps = [...c.requires, ...c.optional.filter((x) => !o.grant || o.grant.includes(x))];
  const host = new Host(o.plugin.id, caps, o.source, o.sink ?? {}, o.stores ?? {}, o.onStop);
  const sb = await startPluginSandbox(o.code, { parent: o.parent, startTimeoutMs: o.startTimeoutMs, onMessage: o.onMessage, onRequest: host.request, onStop: host.stopped });
  host.attach(sb);
  return host;
}

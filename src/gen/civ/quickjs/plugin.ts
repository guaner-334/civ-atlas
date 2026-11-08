/**
 * 推演插件关进 QuickJS 跑:插件代码(源码)在 QuickJS 里,推演照旧在推演线程里同步推;每到插件那一刻,
 * 把这一回合递进去、调插件的 act、把回话拿回来交给引擎(引擎照旧核对)。
 * 这个文件连同 QuickJS 只经 import() 取,世界没用推演插件就不下载。
 */
import { DefaultIntrinsics, newQuickJSWASMModuleFromVariant, newVariant, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { PLUGIN_TIME, PluginError, type PluginReply, type PluginTurn, type SimPlugin } from '../engine/plugin';
import { keyed, keyed4, subSeed } from '../engine/rand';
import type { SimRead } from '../simRead';
import { SHIM } from './shim';
import { fromWire, toWire, type Wire } from './wire';

/** 清单 sim 段给的设定(和 SimPlugin 一一对上) */
export type SimSetup = Pick<SimPlugin, 'every' | 'tables' | 'inputs' | 'listen' | 'layers' | 'influences'>;

export interface QuickJSPluginSpec {
  id: string;
  /** 插件代码(普通脚本,里面调 civAtlas.sim({ act }) 登记) */
  code: string;
  setup?: SimSetup;
  /** 滑条拨到几(插件里是只读的 civAtlas.params) */
  params?: Readonly<Record<string, number>>;
  /** 文明种子(和推演用的同一个:turn.rand 照它在 QuickJS 里算) */
  seed: number;
  limits?: Partial<QuickJSLimits>;
  /** 插件里 console.log 这几样交到这里(year = 那一回合的年份,装插件时 = null);不给 = 什么都不做。不影响推出来的历史 */
  log?: (method: string, text: string, year: number | null) => void;
}

export interface QuickJSLimits {
  /** 一个插件的 QuickJS 最多用多少内存(字节,含 QuickJS 自己的 16 MB 底子) */
  memory: number;
  /** 一次出手(装插件那次也算)跑多久叫停(毫秒) */
  moment: number;
  /** QuickJS 自己查的栈深(字节):要比浏览器后台线程真的栈先用完,各家才在同一层报错(Chromium 里设到 192 KB 就有写法先撞上真的栈) */
  stack: number;
}

export const QUICKJS_LIMITS: QuickJSLimits = { memory: 64 * 1024 * 1024, moment: PLUGIN_TIME.moment, stack: 64 * 1024 };

export interface QuickJSPlugin extends SimPlugin<SimRead> {
  /** 放掉 QuickJS(用完一段推演就放) */
  dispose(): void;
}

/** 一条日志最多几个字 */
const LOG_MAX = 500;
const logText = (v: unknown): string => {
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

/** wasm 一页 64 KB;QuickJS 这份要求起步 256 页 */
const PAGE = 65536;
const MIN_PAGES = 256;

const sec = (ms: number) => (ms / 1000).toFixed(1);
const MB = (b: number) => Math.round(b / 1024 / 1024);

/** 往 QuickJS 的数组里放一格:定义成自己的属性,不走插件在原型上装的 setter */
const own = (vm: QuickJSContext, o: QuickJSHandle, i: number, h: QuickJSHandle) => vm.defineProp(o, i, { value: h, enumerable: true, configurable: true });

/** 推演线程自己的栈用完了(浏览器各家报法不同):QuickJS 停在半路,这一份不能再用 */
const stackGone = (e: unknown) => (e instanceof RangeError && /stack/i.test(e.message)) || (e instanceof Error && e.name === 'InternalError');

/**
 * 装好一个插件。一个插件一份 QuickJS(各自的 wasm 内存,用到上限就报「内存用完」,出了事只坏它自己);
 * 往回推(这一回合的年份比上一回合早:地形大事以后那一段从头接着推)换一个新环境、重跑插件代码,插件的全局变量不带过去
 */
export async function quickjsPlugin(wasm: WebAssembly.Module, spec: QuickJSPluginSpec): Promise<QuickJSPlugin> {
  const limits = { ...QUICKJS_LIMITS, ...spec.limits };
  const pages = Math.floor(limits.memory / PAGE);
  if (pages < MIN_PAGES) throw new Error(`QuickJS 的内存上限至少 ${MB(MIN_PAGES * PAGE)} MB`);
  const qjs = await newQuickJSWASMModuleFromVariant(
    newVariant(variant, { wasmModule: wasm, wasmMemory: new WebAssembly.Memory({ initial: MIN_PAGES, maximum: pages }) }),
  );
  const box = new Box(spec, limits, qjs.newRuntime());
  try {
    box.open();
  } catch (e) {
    box.dispose();
    throw e;
  }
  const { id } = spec;
  return {
    id,
    ...spec.setup,
    act: (turn) => box.act(turn),
    dispose: () => box.dispose(),
  };
}

/** 一个插件的 QuickJS:运行时一直用这一个,环境(全局变量)按段换 */
class Box {
  private readonly id: string;
  private readonly base: number;
  private vm: QuickJSContext | null = null;
  private actFn: QuickJSHandle | null = null;
  /** 叫停的时刻(performance.now);到了 QuickJS 就停下 */
  private deadline = Infinity;
  private interrupted = false;
  /** 出了 QuickJS 自己收拾不了的事(推演线程的栈用完、wasm 出错):这一份不再用 */
  private dead: PluginError | null = null;
  private lastYear = -Infinity;
  private checked = false;
  /** 这一回合(只在 act 里有) */
  private cur: PluginTurn<SimRead> | null = null;
  /** 这一回合里读过的(同样的读口、同样的参数只算一次) */
  private readonly cache = new Map<string, Wire>();
  /** 这一回合里宿主那头抛的错(插件没接住就原样抛出去) */
  private readonly thrown: unknown[] = [];

  constructor(
    private readonly spec: QuickJSPluginSpec,
    private readonly limits: QuickJSLimits,
    private readonly rt: QuickJSRuntime,
  ) {
    this.id = spec.id;
    this.base = subSeed(spec.seed, `plugin:${spec.id}`);
    rt.setMaxStackSize(limits.stack);
    rt.setInterruptHandler(() => {
      if (performance.now() <= this.deadline) return false;
      this.interrupted = true;
      return true;
    });
  }

  private fail(what: string): PluginError {
    return new PluginError(this.id, what);
  }

  /** 碰 QuickJS 的一段;QuickJS 外头出的错(推演线程的栈用完、wasm 出错)记成坏了 */
  private guard<T>(run: () => T): T {
    try {
      return run();
    } catch (e) {
      if (e instanceof PluginError) throw e;
      this.dead = this.fail(stackGone(e) ? '调用套得太深,推演线程的栈用完了' : `QuickJS 出错停下了:${e instanceof Error ? e.message : String(e)}`);
      throw this.dead;
    }
  }

  /** 让 QuickJS 跑一段,限时 limits.moment */
  private timed<T>(run: () => T): T {
    this.deadline = performance.now() + this.limits.moment;
    this.interrupted = false;
    try {
      return run();
    } finally {
      this.deadline = Infinity;
    }
  }

  /** QuickJS 抛出来没接住的错(叫停、内存用完……)说成一句话;读 message 可能跑到插件写的 getter,照样限时 */
  private escaped(err: QuickJSHandle, where: string): PluginError {
    const vm = this.vm!;
    const interrupted = this.interrupted;
    let msg = '';
    try {
      msg = this.timed(() => {
        if (vm.typeof(err) !== 'object') return String(vm.dump(err));
        const m = vm.getProp(err, 'message');
        try {
          return vm.typeof(m) === 'string' ? vm.getString(m) : '';
        } finally {
          m.dispose();
        }
      });
    } catch {
      msg = '';
    } finally {
      err.dispose();
    }
    if (interrupted) return this.fail(`${where}跑了 ${sec(this.limits.moment)} 秒还没跑完,叫停了`);
    if (msg === 'out of memory') return this.fail(`${where}用的内存超过 ${MB(this.limits.memory)} MB`);
    return this.fail(`${where}出错:${msg || '说不清的错'}`);
  }

  /** 开一个新环境:我们那一层 → 插件代码 → 查登记了没有 */
  open(): void {
    this.close();
    const rt = this.rt;
    this.guard(() => {
      const vm = rt.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } });
      this.vm = vm;
      const host = vm.newFunction('host', (...args) => this.host(args));
      const base = vm.newNumber(this.base);
      const params = vm.newString(JSON.stringify(this.spec.params ?? {}));
      const shim = vm.unwrapResult(vm.evalCode(SHIM, 'civ-atlas-shim.js'));
      const made = vm.callFunction(shim, vm.undefined, host, base, params, this.spec.log ? vm.true : vm.false);
      [shim, host, base, params].forEach((h) => h.dispose());
      const pair = vm.unwrapResult(made);
      this.actFn = vm.getProp(pair, 0);
      const ready = vm.getProp(pair, 1);
      pair.dispose();
      try {
        const ran = this.timed(() => vm.evalCode(this.spec.code, 'main.js', { type: 'global' }));
        if (ran.error) throw this.escaped(ran.error, '插件代码');
        ran.value.dispose();
        const ok = this.timed(() => vm.callFunction(ready, vm.undefined));
        if (ok.error) throw this.escaped(ok.error, '插件代码');
        ok.value.dispose();
      } finally {
        ready.dispose();
      }
    });
  }

  private close(): void {
    if (this.dead) return;
    this.actFn?.dispose();
    this.vm?.dispose();
    this.actFn = null;
    this.vm = null;
  }

  dispose(): void {
    if (!this.dead) {
      try {
        this.close();
        this.rt.dispose();
      } catch {
        // QuickJS 已经坏了也不要紧:整份 wasm 跟着这个插件一起丢掉
      }
    }
    this.dead ??= this.fail('已经放掉了');
  }

  /** 插件在 QuickJS 里调读口、turn.table / turn.influence */
  private host(args: QuickJSHandle[]): QuickJSHandle {
    const vm = this.vm!;
    const kind = vm.getNumber(args[0]);
    const name = vm.getString(args[1]);
    const rest = args.slice(2).map((h) => vm.dump(h) as unknown);
    if (kind === 2) {
      this.spec.log?.(name, rest.map(logText).join(' ').slice(0, LOG_MAX), this.cur ? this.cur.year : null);
      return vm.undefined;
    }
    let w: Wire;
    try {
      const t = this.cur;
      if (!t) throw new Error('这时候没有回合');
      const self = (kind === 0 ? t.read : t) as unknown as Record<string, unknown>;
      const fn = Object.prototype.hasOwnProperty.call(self, name) ? self[name] : undefined;
      if (typeof fn !== 'function' || name === 'rand') throw new Error(`没有 ${name}`);
      // 参数照递数据的写法记:-0、±Infinity、NaN、undefined 各是各的
      const args = toWire(rest);
      const key = `${kind}:${name}:${args.text}:${args.patches}`;
      let hit = this.cache.get(key);
      if (!hit) this.cache.set(key, (hit = toWire(Reflect.apply(fn, self, rest))));
      w = hit;
    } catch (e) {
      // 推演线程的栈用完了:插件接住了也停下
      if (stackGone(e)) this.dead ??= this.fail('调用套得太深,推演线程的栈用完了');
      const n = this.thrown.push(e) - 1;
      const out = vm.newArray();
      const put = (i: number, h: QuickJSHandle) => (own(vm, out, i, h), h.dispose());
      put(0, vm.null);
      put(1, vm.newNumber(n));
      put(2, vm.newString(e instanceof Error ? e.name : 'Error'));
      put(3, vm.newString(e instanceof Error ? e.message : String(e)));
      return out;
    }
    return this.put(w);
  }

  /** 递进 QuickJS 的一份:[JSON, 补丁表, ...字节] */
  private put(w: Wire): QuickJSHandle {
    const vm = this.vm!;
    const out = vm.newArray();
    const put = (i: number, h: QuickJSHandle) => (own(vm, out, i, h), h.dispose());
    put(0, vm.newString(w.text));
    put(1, vm.newString(w.patches));
    w.bufs.forEach((b, i) => put(2 + i, vm.newArrayBuffer(b)));
    return out;
  }

  /** 这一回合递进去的:回合里的数据、方法名、读口的键;rand 在 QuickJS 里算 */
  private header(turn: PluginTurn<SimRead>): Wire {
    const t = turn as unknown as Record<string, unknown>;
    const read = turn.read as unknown as Record<string, unknown>;
    const split = (o: Record<string, unknown>, skip: readonly string[]) => {
      const d: Record<string, unknown> = {};
      const f: string[] = [];
      for (const k of Object.keys(o)) {
        if (skip.includes(k)) continue;
        const v = o[k];
        if (typeof v === 'function') f.push(k);
        else d[k] = v;
      }
      return { d, f };
    };
    const own = split(t, ['read', 'rand']);
    const r = split(read, []);
    return toWire({ k: Object.keys(t), d: own.d, f: own.f, rk: Object.keys(read), rd: r.d, rf: r.f });
  }

  act(turn: PluginTurn<SimRead>): PluginReply | undefined {
    if (this.dead) throw this.dead;
    if (turn.year < this.lastYear) this.open();
    this.lastYear = turn.year;
    if (!this.checked) {
      if (turn.rand(3, 5, 7) !== keyed(this.base, 3, 5, 7) || turn.rand(3, 5, 7, 11) !== keyed4(this.base, 3, 5, 7, 11)) throw this.fail('随机数的种子和推演的对不上');
      this.checked = true;
    }
    this.cur = turn;
    this.cache.clear();
    this.thrown.length = 0;
    try {
      const out = this.guard(() => this.call(turn));
      if ('rethrow' in out) throw out.rethrow;
      return out.reply;
    } finally {
      this.cur = null;
      this.thrown.length = 0;
    }
  }

  /** 插件出手一次:交回的回话,或者插件没接住的、宿主那头抛的错(原样抛出去) */
  private call(turn: PluginTurn<SimRead>): { reply: PluginReply | undefined } | { rethrow: unknown } {
    const vm = this.vm!;
    const w = this.header(turn);
    const args = [vm.newString(w.text), vm.newString(w.patches), ...w.bufs.map((b) => vm.newArrayBuffer(b))];
    let res;
    try {
      res = this.timed(() => vm.callFunction(this.actFn!, vm.undefined, ...args));
    } finally {
      args.forEach((h) => h.dispose());
    }
    if (this.dead) {
      (res.error ?? res.value).dispose();
      throw this.dead;
    }
    const where = `第 ${turn.year} 年这一刻`;
    if (res.error) throw this.escaped(res.error, where);
    const out = res.value;
    try {
      if (vm.typeof(out) === 'undefined') return { reply: undefined };
      // 读交回的数组也可能跑到插件装的 getter,照样限时
      return this.timed(() => this.reply(out, where));
    } catch (e) {
      if (this.interrupted) throw this.fail(`${where}跑了 ${sec(this.limits.moment)} 秒还没跑完,叫停了`);
      throw e;
    } finally {
      out.dispose();
    }
  }

  /** 读 act 交回的:[0, JSON, 补丁表, ...字节] 是回话,[1, 说明, 宿主错误的编号, 内存用完] 是插件出错 */
  private reply(out: QuickJSHandle, where: string): { reply: PluginReply | undefined } | { rethrow: unknown } {
    const vm = this.vm!;
    const bad = () => this.fail('QuickJS 递回来的数据坏了');
    const at = (i: number | 'length') => vm.getProp(out, i);
    const num = (i: number | 'length') => {
      const h = at(i);
      try {
        return vm.typeof(h) === 'number' ? vm.getNumber(h) : NaN;
      } finally {
        h.dispose();
      }
    };
    const str = (i: number) => {
      const h = at(i);
      try {
        if (vm.typeof(h) !== 'string') throw bad();
        return vm.getString(h);
      } finally {
        h.dispose();
      }
    };
    // 不用 vm.getLength:它读的那块内存视图在 wasm 内存长大以后就失效了
    const n = num('length');
    if (!(n >= 3)) throw bad();
    const kind = num(0);
    if (kind === 1) {
      const tag = num(2);
      if (Number.isInteger(tag) && tag >= 0 && tag < this.thrown.length) return { rethrow: this.thrown[tag] };
      const why = num(3);
      if (why === 1) throw this.fail(`${where}用的内存超过 ${MB(this.limits.memory)} MB`);
      if (why === 2) throw this.fail(`${where}调用套得太深,QuickJS 的栈用完了`);
      throw this.fail(str(1));
    }
    if (kind !== 0) throw bad();
    const bufs: ArrayBuffer[] = [];
    for (let i = 3; i < n; i++) {
      const h = at(i);
      try {
        const life = vm.getArrayBuffer(h);
        try {
          bufs.push(life.value.slice().buffer);
        } finally {
          life.dispose();
        }
      } catch {
        throw bad();
      } finally {
        h.dispose();
      }
    }
    try {
      return { reply: fromWire({ text: str(1), patches: str(2), bufs }) as PluginReply | undefined };
    } catch (e) {
      throw e instanceof PluginError ? e : bad();
    }
  }
}

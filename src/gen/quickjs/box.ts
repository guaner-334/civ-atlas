/**
 * 一个插件的 QuickJS(推演插件、地图插件共用):运行时、叫停、内存、栈、坏了不再用,往里递、往回读的那几步。
 * 环境(全局变量)什么时候开、关,递什么,由用的那头(sim.ts、map.ts)定。
 */
import { DefaultIntrinsics, newQuickJSWASMModuleFromVariant, newVariant, type QuickJSContext, type QuickJSHandle, type QuickJSRuntime } from 'quickjs-emscripten-core';
import variant from '@jitl/quickjs-wasmfile-release-sync';
import { fromWire, type Wire } from './wire';

export interface QuickJSLimits {
  /** 一个插件的 QuickJS 最多用多少内存(字节,含 QuickJS 自己的 16 MB 底子) */
  memory: number;
  /** 一次出手(装插件那次也算)跑多久叫停(毫秒) */
  moment: number;
  /** QuickJS 自己查的栈深(字节):要比浏览器后台线程真的栈先用完,各家才在同一层报错(Chromium 里设到 192 KB 就有写法先撞上真的栈) */
  stack: number;
}

/** 一条日志最多几个字 */
export const LOG_MAX = 500;
export const logText = (v: unknown): string => {
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

export const sec = (ms: number) => (ms / 1000).toFixed(1);
export const MB = (b: number) => Math.round(b / 1024 / 1024);

/** 往 QuickJS 的数组里放一格:定义成自己的属性,不走插件在原型上装的 setter */
export const own = (vm: QuickJSContext, o: QuickJSHandle, i: number, h: QuickJSHandle) => vm.defineProp(o, i, { value: h, enumerable: true, configurable: true });

/** 线程自己的栈用完了(浏览器各家报法不同):QuickJS 停在半路,这一份不能再用 */
export const stackGone = (e: unknown) => (e instanceof RangeError && /stack/i.test(e.message)) || (e instanceof Error && e.name === 'InternalError');

/** 一个插件一份 QuickJS:各自的 wasm 内存,用到上限就报「内存用完」,出了事只坏它自己 */
export async function newRuntime(wasm: WebAssembly.Module, limits: QuickJSLimits): Promise<QuickJSRuntime> {
  const pages = Math.floor(limits.memory / PAGE);
  if (pages < MIN_PAGES) throw new Error(`QuickJS 的内存上限至少 ${MB(MIN_PAGES * PAGE)} MB`);
  const qjs = await newQuickJSWASMModuleFromVariant(
    newVariant(variant, { wasmModule: wasm, wasmMemory: new WebAssembly.Memory({ initial: MIN_PAGES, maximum: pages }) }),
  );
  return qjs.newRuntime();
}

/** 插件出手一次读回来的:交回的东西,或者插件没接住的、宿主那头抛的错(原样抛出去) */
export type Outcome = { reply: unknown } | { rethrow: unknown };

/** 运行时一直用这一个,环境由子类开、关 */
export abstract class Box {
  protected vm: QuickJSContext | null = null;
  /** 叫停的时刻(performance.now);到了 QuickJS 就停下 */
  private deadline = Infinity;
  /** 给了 = 这段时间里每次限时都到这一刻为止(不再从每一步起算) */
  protected window: number | null = null;
  protected interrupted = false;
  /** 出了 QuickJS 自己收拾不了的事(线程的栈用完、wasm 出错):这一份不再用 */
  protected dead: Error | null = null;
  /** 这一次出手里宿主那头抛的错(插件没接住就原样抛出去) */
  protected readonly thrown: unknown[] = [];

  constructor(
    protected readonly limits: QuickJSLimits,
    protected readonly rt: QuickJSRuntime,
    /** 报错时说是哪个线程的栈 */
    private readonly thread: string,
  ) {
    rt.setMaxStackSize(limits.stack);
    rt.setInterruptHandler(() => {
      if (performance.now() <= this.deadline) return false;
      this.interrupted = true;
      return true;
    });
  }

  protected abstract fail(what: string): Error;
  /** fail 造出来的错(已经说清楚是哪个插件、哪一步的) */
  protected abstract ours(e: unknown): boolean;

  /** 碰 QuickJS 的一段;QuickJS 外头出的错(线程的栈用完、wasm 出错)记成坏了 */
  protected guard<T>(run: () => T): T {
    try {
      return run();
    } catch (e) {
      if (this.ours(e)) throw e;
      this.dead = this.fail(stackGone(e) ? `调用套得太深,${this.thread}的栈用完了` : `QuickJS 出错停下了:${e instanceof Error ? e.message : String(e)}`);
      throw this.dead;
    }
  }

  /** 让 QuickJS 跑一段,限时 limits.moment(有 window 时到 window 为止) */
  protected timed<T>(run: () => T): T {
    this.deadline = this.window ?? performance.now() + this.limits.moment;
    this.interrupted = false;
    try {
      return run();
    } finally {
      this.deadline = Infinity;
    }
  }

  /** QuickJS 抛出来没接住的错(叫停、内存用完……)说成一句话;读 message 可能跑到插件写的 getter,照样限时 */
  protected escaped(err: QuickJSHandle, where: string): Error {
    const vm = this.vm!;
    const interrupted = this.interrupted;
    const win = this.window;
    this.window = null;
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
      this.window = win;
      err.dispose();
    }
    if (interrupted) return this.fail(`${where}跑了 ${sec(this.limits.moment)} 秒还没跑完,叫停了`);
    if (msg === 'out of memory') return this.fail(`${where}用的内存超过 ${MB(this.limits.memory)} MB`);
    return this.fail(where ? `${where}出错:${msg || '说不清的错'}` : msg || '说不清的错');
  }

  /** 开一个新环境(没有 Date) */
  protected newContext(): QuickJSContext {
    this.vm = this.rt.newContext({ intrinsics: { ...DefaultIntrinsics, Date: false } });
    return this.vm;
  }

  protected close(): void {
    if (this.dead) return;
    this.vm?.dispose();
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

  /** 宿主那头抛的错递回 QuickJS:[null, 编号, 名字, 说明](插件没接住时按编号原样抛出去) */
  protected hostError(e: unknown): QuickJSHandle {
    const vm = this.vm!;
    // 线程的栈用完了:插件接住了也停下
    if (stackGone(e)) this.dead ??= this.fail(`调用套得太深,${this.thread}的栈用完了`);
    const n = this.thrown.push(e) - 1;
    const out = vm.newArray();
    const put = (i: number, h: QuickJSHandle) => (own(vm, out, i, h), h.dispose());
    put(0, vm.null);
    put(1, vm.newNumber(n));
    put(2, vm.newString(e instanceof Error ? e.name : 'Error'));
    put(3, vm.newString(e instanceof Error ? e.message : String(e)));
    return out;
  }

  /** 递进 QuickJS 的一份:[JSON, 补丁表, ...字节] */
  protected put(w: Wire): QuickJSHandle {
    const vm = this.vm!;
    const out = vm.newArray();
    const put = (i: number, h: QuickJSHandle) => (own(vm, out, i, h), h.dispose());
    put(0, vm.newString(w.text));
    put(1, vm.newString(w.patches));
    w.bufs.forEach((b, i) => put(2 + i, vm.newArrayBuffer(b)));
    return out;
  }

  /** QuickJS 里的一串字节拷出来 */
  protected bytes(h: QuickJSHandle): ArrayBuffer {
    const life = this.vm!.getArrayBuffer(h);
    try {
      return life.value.slice().buffer;
    } finally {
      life.dispose();
    }
  }

  /** 调 QuickJS 里的一个函数(限时),读它交回的;args 调完放掉 */
  protected invoke(fn: QuickJSHandle, args: QuickJSHandle[], where: string): Outcome {
    const vm = this.vm!;
    let res;
    try {
      res = this.timed(() => vm.callFunction(fn, vm.undefined, ...args));
    } finally {
      args.forEach((h) => h.dispose());
    }
    if (this.dead) {
      (res.error ?? res.value).dispose();
      throw this.dead;
    }
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

  /** 读交回的:[0, JSON, 补丁表, ...字节] 是交回的东西,[1, 说明, 宿主错误的编号, 内存用完] 是插件出错 */
  private reply(out: QuickJSHandle, where: string): Outcome {
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
        bufs.push(this.bytes(h));
      } catch {
        throw bad();
      } finally {
        h.dispose();
      }
    }
    try {
      return { reply: fromWire({ text: str(1), patches: str(2), bufs }) };
    } catch (e) {
      throw this.ours(e) ? e : bad();
    }
  }
}

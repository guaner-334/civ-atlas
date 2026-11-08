/**
 * 地图插件关进 QuickJS 跑。每一口:新开一个干净的环境 → 跑插件代码 → 递进来的数组整块递进去、调这一口的函数 →
 * 交回的整块拿回来(交给 mapHooks.ts 核对)→ 关掉环境。插件的全局变量带不到下一口,
 * 改一笔地形(前一半走缓存、那几口不重跑)和从头生成长出同一张图。
 * 帮手(d.noise 这些)在网站这头算,QuickJS 里调到时把参数递出来;d.rand、d.km 在 QuickJS 里算。
 * 这个文件连同 QuickJS 只经 import() 取。
 */
import type { QuickJSHandle, QuickJSRuntime } from 'quickjs-emscripten-core';
import { MAP_PLUGIN_TIME, MapPluginError, type ClimateReply, type HeightReply, type LayersReply, type MapPlugin, type MapStage } from '../mapHooks';
import { keyed, subSeed } from '../util';
import { Box, LOG_MAX, logText, newRuntime, type QuickJSLimits } from './box';
import { MAP_SHIM } from './shim';
import { fromWire, toWire, type Wire } from './wire';

export interface QuickJSMapSpec {
  id: string;
  /** 见 MapPlugin.key */
  key: string;
  /** 插件代码(普通脚本,里面调 civAtlas.map({ height, climate, layers }) 登记) */
  code: string;
  /** 清单 map 段给的:在哪几步出手、登记了哪几张图层 */
  setup: { stages: readonly MapStage[]; layerIds?: readonly string[] };
  /** 滑条拨到几(插件里是只读的 d.params,也是 civAtlas.params) */
  params?: Readonly<Record<string, number>>;
  limits?: Partial<QuickJSLimits>;
  /** 插件里 console.log 这几样交到这里(stage = 哪一口,装插件时 = null);不给 = 什么都不做。不影响长出来的地图 */
  log?: (method: string, text: string, stage: MapStage | null) => void;
}

/** 一口(连同开环境、跑插件代码)跑多久叫停:一次生成的合计另由 mapHooks.ts 的 MapClock 管 */
export const MAP_QUICKJS_LIMITS: QuickJSLimits = { memory: 64 * 1024 * 1024, moment: MAP_PLUGIN_TIME.stage, stack: 64 * 1024 };

export interface QuickJSMapPlugin extends MapPlugin {
  /** 放掉 QuickJS */
  dispose(): void;
}

/** 装不上:插件代码出错、没登记、清单写了的那一步没有函数 */
export class MapPluginLoadError extends Error {
  constructor(
    readonly plugin: string,
    readonly why: string,
  ) {
    super(`地图插件「${plugin}」装不上:${why}`);
    this.name = 'MapPluginLoadError';
  }
}

/** 装好一个插件:先在一个环境里跑一遍插件代码,查登记了清单写的那几步(装不上抛 MapPluginLoadError) */
export async function quickjsMapPlugin(wasm: WebAssembly.Module, spec: QuickJSMapSpec): Promise<QuickJSMapPlugin> {
  const limits = { ...MAP_QUICKJS_LIMITS, ...spec.limits };
  const box = new MapBox(spec, limits, await newRuntime(wasm, limits));
  try {
    box.check();
  } catch (e) {
    box.dispose();
    throw e;
  }
  const { stages, layerIds } = spec.setup;
  return {
    id: spec.id,
    key: spec.key,
    stages: [...stages],
    ...(layerIds ? { layerIds: [...layerIds] } : {}),
    ...(stages.includes('height') ? { height: (d) => box.run('height', d) as HeightReply | undefined } : {}),
    ...(stages.includes('climate') ? { climate: (d) => box.run('climate', d) as ClimateReply | undefined } : {}),
    ...(stages.includes('layers') ? { layers: (d) => box.run('layers', d) as LayersReply | undefined } : {}),
    dispose: () => box.dispose(),
  };
}

const whyOf = (e: Error) => (e instanceof MapPluginError || e instanceof MapPluginLoadError ? e.why : e.message);

/** 一个地图插件的 QuickJS:运行时一直用这一个,环境一口一换 */
class MapBox extends Box {
  private readonly id: string;
  /** 正在跑哪一口(装插件时 = null) */
  private stage: MapStage | null = null;
  private callFn: QuickJSHandle | null = null;
  /** 这一口递进来的(帮手是它上面的函数) */
  private cur: Record<string, unknown> | null = null;

  constructor(
    private readonly spec: QuickJSMapSpec,
    limits: QuickJSLimits,
    rt: QuickJSRuntime,
  ) {
    super(limits, rt, '生成线程');
    this.id = spec.id;
  }

  protected fail(what: string): Error {
    return this.stage ? new MapPluginError(this.id, this.stage, what) : new MapPluginLoadError(this.id, what);
  }

  protected ours(e: unknown): boolean {
    return e instanceof MapPluginError || e instanceof MapPluginLoadError;
  }

  /** 开一个新环境:我们那一层 → 插件代码 → 查登记了清单写的那几步 */
  private open(base: number): void {
    this.close();
    const vm = this.newContext();
    const host = vm.newFunction('host', (...args) => this.host(args));
    const b = vm.newNumber(base);
    const params = vm.newString(JSON.stringify(this.spec.params ?? {}));
    const shim = vm.unwrapResult(vm.evalCode(MAP_SHIM, 'civ-atlas-shim.js'));
    const made = vm.callFunction(shim, vm.undefined, host, b, params, this.spec.log ? vm.true : vm.false);
    [shim, host, b, params].forEach((h) => h.dispose());
    const pair = vm.unwrapResult(made);
    this.callFn = vm.getProp(pair, 0);
    const ready = vm.getProp(pair, 1);
    pair.dispose();
    try {
      const ran = this.timed(() => vm.evalCode(this.spec.code, 'main.js', { type: 'global' }));
      if (ran.error) throw this.escaped(ran.error, '插件代码');
      ran.value.dispose();
      const stages = vm.newString(JSON.stringify(this.spec.setup.stages));
      const ok = this.timed(() => vm.callFunction(ready, vm.undefined, stages));
      stages.dispose();
      if (ok.error) throw this.escaped(ok.error, '插件代码');
      ok.value.dispose();
    } finally {
      ready.dispose();
    }
  }

  protected close(): void {
    if (!this.dead) {
      this.callFn?.dispose();
      this.callFn = null;
    }
    super.close();
  }

  /** 关环境出了错(QuickJS 已经坏了):这一份不再用,不盖住原来的错 */
  private closeQuietly(): void {
    try {
      this.close();
    } catch (e) {
      this.dead ??= this.fail(`QuickJS 出错停下了:${e instanceof Error ? e.message : String(e)}`);
    }
  }

  check(): void {
    this.window = performance.now() + this.limits.moment;
    try {
      this.guard(() => this.open(0));
    } finally {
      this.window = null;
      this.closeQuietly();
    }
  }

  /** 插件在 QuickJS 里调帮手:参数整个打包递出来 */
  private host(args: QuickJSHandle[]): QuickJSHandle {
    const vm = this.vm!;
    const kind = vm.getNumber(args[0]);
    const name = vm.getString(args[1]);
    if (kind === 2) {
      const rest = args.slice(2).map((h) => vm.dump(h) as unknown);
      this.spec.log?.(name, rest.map(logText).join(' ').slice(0, LOG_MAX), this.stage);
      return vm.undefined;
    }
    let w: Wire;
    try {
      const d = this.cur;
      if (!d || kind !== 0) throw new Error('这时候没有在生成');
      const fn = Object.prototype.hasOwnProperty.call(d, name) ? d[name] : undefined;
      if (typeof fn !== 'function' || name === 'rand' || name === 'km') throw new Error(`没有 d.${name}`);
      if (args.length < 4 || vm.typeof(args[2]) !== 'string' || vm.typeof(args[3]) !== 'string') throw new Error('QuickJS 递出来的数据坏了');
      const got = fromWire({ text: vm.getString(args[2]), patches: vm.getString(args[3]), bufs: args.slice(4).map((h) => this.bytes(h)) });
      if (!Array.isArray(got)) throw new Error('QuickJS 递出来的数据坏了');
      w = toWire(Reflect.apply(fn, d, got));
    } catch (e) {
      return this.hostError(e);
    }
    return this.put(w);
  }

  /** 这一口递进去的:数据(数组、数、字)和帮手的名字 */
  private header(d: Record<string, unknown>): Wire {
    const data: Record<string, unknown> = {};
    const f: string[] = [];
    for (const k of Object.keys(d)) {
      const v = d[k];
      if (typeof v === 'function') f.push(k);
      else data[k] = v;
    }
    return toWire({ d: data, f });
  }

  run(stage: MapStage, d: object): unknown {
    this.stage = stage;
    try {
      if (this.dead) throw this.fail(whyOf(this.dead));
      const data = d as Record<string, unknown>;
      const base = subSeed(data.seed as number, `map:${this.id}`);
      if (typeof data.rand !== 'function' || data.rand(3, 5, 7) !== keyed(base, 3, 5, 7)) throw this.fail('随机数的种子和生成的对不上');
      this.cur = data;
      this.thrown.length = 0;
      this.window = performance.now() + this.limits.moment;
      const out = this.guard(() => {
        this.open(base);
        const vm = this.vm!;
        const w = this.header(data);
        return this.invoke(this.callFn!, [vm.newString(stage), vm.newString(w.text), vm.newString(w.patches), ...w.bufs.map((b) => vm.newArrayBuffer(b))], '');
      });
      if ('rethrow' in out) throw out.rethrow;
      return out.reply;
    } finally {
      this.window = null;
      this.cur = null;
      this.thrown.length = 0;
      this.closeQuietly();
      this.stage = null;
    }
  }
}

/**
 * 影响口:推演插件在插件那一刻交一栏数,规则包的决策点直接查合起来的那栏,乘上或加上(有上下限)。
 * 几个插件交到同一个口:按插件的先后,乘的乘在一起、加的加在一起,再压回上下限。
 * 没有插件接的口不建栏:决策点照原来的算法走(不是乘 1、加 0,加 0 会把 −0 变成 +0)。
 */
import { PluginError } from './plugin';

/** 规则包登记的一个影响口 */
export interface InfluencePoint {
  readonly id: string;
  readonly unit: 'region' | 'polity';
  /** 一格几栏(不给 = 1) */
  readonly cols?: number;
  readonly op: 'mul' | 'add';
  readonly min: number;
  readonly max: number;
}

/** 一个插件交给影响口的几栏:口名 → 格 × 栏 */
export type InfluenceCols = Record<string, Float64Array>;

/** 按国的口最多几国(和归属的编号一样是 Int16) */
const POLITY_MAX = 2 ** 15;

const colsOf = (p: InfluencePoint) => p.cols ?? 1;
const neutralOf = (p: InfluencePoint) => (p.op === 'mul' ? 1 : 0);
const clamp = (p: InfluencePoint, x: number) => Math.min(p.max, Math.max(p.min, x));

/** 一段推演(一个引擎)上各影响口的数;插件按先后各占一格位 */
export class Influences {
  private readonly points = new Map<string, InfluencePoint>();
  /** 各插件接了哪些口 */
  private readonly wants: ReadonlySet<string>[];
  /** 各插件交了的那栏(压过上下限) */
  private readonly feeds: Map<string, Float64Array>[];
  /** 有插件接的口 → 合起来的那栏 */
  private readonly merged = new Map<string, Float64Array>();

  constructor(
    points: readonly InfluencePoint[],
    wants: readonly (readonly string[])[],
    private readonly R: number,
  ) {
    for (const p of points) this.points.set(p.id, p);
    this.wants = wants.map((w) => new Set(w));
    this.feeds = wants.map(() => new Map());
    for (const w of this.wants) for (const id of w) if (!this.merged.has(id)) this.merged.set(id, this.blank(this.points.get(id)!, 0));
  }

  /** 有没有插件接这个口 */
  has(id: string): boolean {
    return this.merged.has(id);
  }

  /** 合起来的那栏(格 × 栏;按国的口,后立的国超出长度,按不影响算);没有插件接 = null。插件出手后会换成新的数组,用时现取 */
  get(id: string): Float64Array | null {
    return this.merged.get(id) ?? null;
  }

  /** 插件 slot 交给口 id 的那栏此刻的值(复制的一份,polities = 此刻几国;还没交 = 全是不影响的数) */
  view(slot: number, id: string, polities: number): Float64Array {
    const p = this.points.get(id);
    if (!p || !this.wants[slot]?.has(id)) throw new Error(`没有接影响口 ${id}`);
    const out = this.blank(p, polities);
    const own = this.feeds[slot].get(id);
    if (own) out.set(own.subarray(0, Math.min(own.length, out.length)));
    return out;
  }

  /** 插件 slot 回话里交的几栏:查过、压回上下限、换上(polities = 此刻几国) */
  take(slot: number, plugin: string, v: unknown, polities: number): void {
    const fail = (what: string): never => {
      throw new PluginError(plugin, what);
    };
    if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('回话里的 influences 要是一个对象');
    for (const [id, x] of Object.entries(v as Record<string, unknown>)) {
      const p = this.points.get(id);
      if (!p || !this.wants[slot]?.has(id)) fail(`没有登记交给影响口 ${id}`);
      const n = (p!.unit === 'region' ? this.R : polities) * colsOf(p!);
      const a = x as ArrayLike<unknown> | null;
      if (!a || typeof a !== 'object' || typeof a.length !== 'number' || a.length !== n) fail(`影响口 ${id} 要交 ${n} 个数`);
      const out = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const y = a![i];
        if (typeof y !== 'number' || !Number.isFinite(y)) fail(`影响口 ${id} 第 ${i} 个不是有限的数`);
        out[i] = clamp(p!, y as number);
      }
      this.feeds[slot].set(id, out);
      this.merge(p!);
    }
  }

  /** 插件 slot 交了的几栏(存进插件的状态;一栏都没交 = undefined) */
  snapshot(slot: number): InfluenceCols | undefined {
    const f = this.feeds[slot];
    if (!f.size) return undefined;
    const out: InfluenceCols = {};
    for (const id of [...f.keys()].sort()) out[id] = f.get(id)!.slice();
    return out;
  }

  /** 接上插件 slot 存下的几栏(和插件现在接的口对得上,格数不超过此刻的) */
  restore(slot: number, plugin: string, v: unknown): void {
    const fail = (what: string): never => {
      throw new PluginError(plugin, `存下的状态${what}`);
    };
    if (v === null || typeof v !== 'object' || Array.isArray(v)) fail('里交给影响口的数不对');
    for (const [id, x] of Object.entries(v as Record<string, unknown>)) {
      const p = this.points.get(id);
      if (!p || !this.wants[slot]?.has(id)) fail(`和插件接的影响口对不上(${id})`);
      const cols = colsOf(p!);
      const max = (p!.unit === 'region' ? this.R : POLITY_MAX) * cols;
      if (!(x instanceof Float64Array) || x.length % cols || x.length > max) fail(`里影响口 ${id} 的格数不对`);
      const a = x as Float64Array;
      for (let i = 0; i < a.length; i++) if (!(a[i] >= p!.min && a[i] <= p!.max)) fail(`里影响口 ${id} 的数超出上下限`);
      this.feeds[slot].set(id, a.slice());
      this.merge(p!);
    }
  }

  /** 一栏全是不影响的数(按州的口一州一格;按国的口 polities 国) */
  private blank(p: InfluencePoint, polities: number): Float64Array {
    const n = (p.unit === 'region' ? this.R : polities) * colsOf(p);
    const a = new Float64Array(n);
    if (p.op === 'mul') a.fill(1);
    return a;
  }

  private merge(p: InfluencePoint): void {
    let n = p.unit === 'region' ? this.R * colsOf(p) : 0;
    for (const f of this.feeds) {
      const x = f.get(p.id);
      if (x && x.length > n) n = x.length;
    }
    const out = new Float64Array(n).fill(neutralOf(p));
    for (const f of this.feeds) {
      const x = f.get(p.id);
      if (!x) continue;
      if (p.op === 'mul') for (let i = 0; i < x.length; i++) out[i] *= x[i];
      else for (let i = 0; i < x.length; i++) out[i] += x[i];
    }
    for (let i = 0; i < n; i++) out[i] = clamp(p, out[i]);
    this.merged.set(p.id, out);
  }
}

/**
 * 照几个插件接的口建好这段推演的影响口(装模块、接着推的模块以前建:决策点按有没有插件接来定算法);
 * 没有插件接任何口 = null。插件写的口名不对、重复的,抛 PluginError
 */
export function influencesFor(points: readonly InfluencePoint[], plugins: readonly { readonly id: string; readonly influences?: readonly string[] }[], R: number): Influences | null {
  const known = new Set(points.map((p) => p.id));
  let any = false;
  const wants = plugins.map((pl) => {
    const outs = pl.influences ?? [];
    if (!Array.isArray(outs) || outs.length > points.length) throw new PluginError(pl.id, `influences 要是不超过 ${points.length} 个影响口的名字`);
    const seen = new Set<string>();
    for (const id of outs) {
      if (typeof id !== 'string' || !known.has(id)) throw new PluginError(pl.id, `没有影响口 ${String(id)}`);
      if (seen.has(id)) throw new PluginError(pl.id, `影响口 ${id} 写了两次`);
      seen.add(id);
    }
    if (outs.length) any = true;
    return outs;
  });
  return any ? new Influences(points, wants, R) : null;
}

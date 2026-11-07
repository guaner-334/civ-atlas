/**
 * 总流程:照规则包推一段历史(从第 0 年起、接着一份历史),都能一步步推、停在哪一刻都和一口气推完一样。只走包里给的几步,不点名哪个子系统。
 * 地形大事:推到大事的前一刻,先照原样推到底的那一支定名字、这一段的地名和道路,再换上新地形从前一刻接着推。
 */
import type { Progress, World } from '../world';
import type { Civ, CivBase, CivEra, CivParams, Habitat, Regions, UpheavalFact, Year } from './types';
import { computeHabitat } from './habitat';
import { REGIONS_KNOBS, buildRegions, emptyRegions, reshapeRegions } from './regions';
import { quantize, type CivSim, type EngineState } from './engine/sim';
import { finishModules, installModules, packSim, partialModules, restorePackSim, resumeModules, type RulePack } from './engine/pack';
import type { KnobSet, KnobValue } from './engine/knobs';
import { knobSet, sameKnobs } from './knobs';
import { YEAR_TICKS, cleanInterventions, sameInterventions, type Intervention } from '../edits';
import type { UpheavalStep } from './upheaval';
import type { FinishCtx, InstallCtx, ResumeCtx } from './modules';

export const DEFAULT_CIV_PARAMS: CivParams = {
  endYear: 3000,
  cultures: 'auto',
  polities: 'auto',
  regionArea: 750,
  pace: 1,
};

/** 可居地块(宜居分 ≥ 这个值)的总面积占陆地不到这个比例时,认为这颗星球没有文明 */
const MIN_HABITABLE_SUIT = 1;
const MIN_HABITABLE_FRAC = 0.02;

/** 陆地有几块、能不能有文明(可居的地方够不够) */
export function viability(world: World, habitat: Habitat): { land: number; viable: boolean } {
  let land = 0;
  let habitable = 0;
  for (let i = 0; i < world.mesh.n; i++) {
    if (world.water[i] !== 0) continue;
    land++;
    if (habitat.suitability[i] >= MIN_HABITABLE_SUIT) habitable++;
  }
  return { land, viable: land > 0 && habitable >= land * MIN_HABITABLE_FRAC };
}

/** 一段推演:引擎和这一段的地形(地形大事以后换一段) */
export interface Segment {
  sim: CivSim;
  world: World;
  habitat: Habitat;
  regions: Regions;
}

/** 这一次推演:用的规则包、补上默认值的参数、文明种子、这个世界的那套数 */
export interface CivRun<S> {
  readonly pack: CivPack<S>;
  readonly p: CivParams;
  readonly seed: number;
  readonly knobs: KnobSet;
  /** 有没有能住人的地 */
  readonly viable: boolean;
  readonly progress: Progress;
}

/** 地形大事以前的一段用的州(到 until 为止,不含) */
export type EraRegions = Pick<CivEra, 'until' | 'regions'>;

/** 接着推的开头几步拿到的 */
export interface ResumeStart {
  sim: CivSim;
  world: World;
  civ: Civ;
  interventions: readonly Intervention[];
  eras: readonly EraRegions[];
}

/** 第 k 件地形大事前一刻:不套这件大事、照原样推到底的那一支(branch)推完了 */
export interface EraStep {
  k: number;
  /** 大事以前这一段 */
  seg: Segment;
  branch: CivSim;
  /** 这一段从哪年起(第一段 = −Infinity),到大事那年为止 */
  from: Year;
  to: Year;
  /** 前面几段 */
  eras: readonly CivEra[];
}

/** 套上第 k 件地形大事 */
export interface UpheaveStep {
  k: number;
  step: UpheavalStep;
  /** 大事以前这一段 */
  seg: Segment;
  /** 新地形的宜居度、州(州沿用编号) */
  habitat: Habitat;
  regions: Regions;
}

/** 换上新地形接着推要的:这件大事的经过;改推到一半的结果;接着推时最先预约的;接着推以后装上的 */
export interface Upheave {
  fact: UpheavalFact;
  reshape(half: Civ): void;
  first(sim: CivSim): void;
  install(sim: CivSim): void;
}

/**
 * 推出 Civ 的规则包。S = 规则包这次推演自己记着的(开头几步给,之后几步原样交回)。
 * 总流程先算宜居度、划州,建好引擎;之后照下面几步走
 */
export interface CivPack<S> extends RulePack<InstallCtx, ResumeCtx, FinishCtx> {
  /** 开头几步(装模块以前)。install = 装模块的上下文;没有能住人的地 = null(不装模块,也不演地形大事) */
  prelude(run: CivRun<S>, seg: Segment): { own: S; install: InstallCtx | null };
  /** 接着推的开头几步(各模块接着推以前) */
  resumePrelude(c: ResumeStart): ResumeCtx;
  /** 分段接着推、推完以后,照接着推的引擎取规则包自己记着的(interventions = 接着推带着的干预) */
  adopt(run: CivRun<S>, civ: Civ, interventions: readonly Intervention[], sim: CivSim): S;
  /** 推到一半拼成结果(州、宜居度按给的;还没起名,地名、道路、人物空着);各模块的 partial 接着往上补 */
  half(run: CivRun<S>, own: S, seg: Segment, habitat: Habitat, regions: Regions): Civ;
  /** 照原样推到底的那一支推完以后:钉名字,定这一段的地名和道路 */
  era(run: CivRun<S>, own: S, c: EraStep): CivEra;
  upheave(run: CivRun<S>, own: S, c: UpheaveStep): Upheave;
  /** 推完整理成结果(起名、道路、地名、人物……);各模块的 finish 接着往上补 */
  settle(run: CivRun<S>, own: S, fin: Segment, eras: CivEra[], facts: UpheavalFact[]): Civ;
}

/** 两张表的值一样(同一张旋钮表在两套数里取出来的) */
function sameTable(a: Readonly<Record<string, KnobValue>>, b: Readonly<Record<string, KnobValue>>): boolean {
  if (a === b) return true;
  for (const k of Object.keys(b)) {
    const x = a[k];
    const y = b[k];
    if (typeof x === 'number' || typeof y === 'number' ? x !== y : x.length !== y.length || x.some((v, i) => v !== y[i])) return false;
  }
  return true;
}

/** 复制一份(类型化数组、普通数组各复制一份,别的照搬):预先算好的底子不跟着推演改、不随 Civ 交出去 */
function copyArrays<T extends object>(o: T): T {
  const out = { ...o } as unknown as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (ArrayBuffer.isView(v)) out[k] = (v as Uint8Array).slice();
    else if (Array.isArray(v)) out[k] = v.slice();
  }
  return out as T;
}

/** 预先算好的宜居度和州(CivParams.base):同一个世界、同一个文明种子、同样的每州面积、划州的那张旋钮表一样才用 */
function reusableBase(p: CivParams, world: World, seed: number, knobs: KnobSet): CivBase | undefined {
  const b = p.base;
  return b && b.world === world && b.seed === seed && b.regionArea === p.regionArea && sameTable(b.regionKnobs, knobs.get(REGIONS_KNOBS)) ? b : undefined;
}

/** 主线:下一处要停的那一刻(驱动给的)、正在推的这一段的引擎(还没开始推 = null) */
interface Line {
  stop: Year;
  sim: CivSim | null;
}

/** 主线这一段推到 end:路上到了要停的那一刻就停下交还驱动,驱动改了 line.stop 再接着推 */
function* segment(line: Line, sim: CivSim, end: Year): Generator<void, void, void> {
  line.sim = sim;
  while (line.stop < end) {
    sim.run(line.stop);
    yield;
  }
  sim.run(end);
}

/** 驱动一步步走的总流程:第一次推时才开始走;中途抛了错就不能再推 */
class Drive<T> {
  private readonly line: Line;
  private g: Generator<void, T, void> | null = null;
  private out: { value: T } | null = null;
  private broken = false;

  constructor(
    private readonly flow: (line: Line) => Generator<void, T, void>,
    private readonly from: Year,
    readonly to: Year,
    sim: CivSim | null,
  ) {
    this.line = { stop: from, sim };
  }

  get year(): Year {
    return this.line.sim ? this.line.sim.now : this.from;
  }

  /** 推到 untilYear(超过 to 的按 to);不比已经推到的晚 = 不动(还没开始推的,正好是开头那一刻也推:第 0 年那一刻的事) */
  advance(untilYear: Year): void {
    const t = Math.min(untilYear, this.to);
    if (this.g ? t > this.year : t >= this.year) this.go(t);
  }

  /** 推到 to,交回总流程的结果 */
  end(): T {
    while (!this.out) this.go(this.to);
    return this.out.value;
  }

  private go(t: Year): void {
    if (this.broken) throw new Error('推演中途出了错,不能接着推');
    if (this.out) return;
    this.line.stop = t;
    try {
      const r = (this.g ??= this.flow(this.line)).next();
      if (r.done) this.out = { value: r.value };
    } catch (e) {
      this.broken = true;
      throw e;
    }
  }
}

/** 主线推到头、还没整理 */
interface Ran<S> {
  run: CivRun<S>;
  own: S;
  fin: Segment;
  eras: CivEra[];
  facts: UpheavalFact[];
}

/** 一步步推的一段历史(从第 0 年起,或者接着一份历史) */
export interface Stepper {
  /** 推到哪一刻为止(params.endYear) */
  readonly to: number;
  /** 已经推到哪一刻 */
  readonly year: number;
  /** 再推到 untilYear(超过 to 的按 to);分几段推和一口气推结果逐字节一样(推演只按事件的时刻走,不看在哪儿停过) */
  advance(untilYear: number): void;
  /** 推到 to(还没推到的接着推完),整理成 Civ(起名、配色、人物、道路、信仰);只调一次 */
  finish(): Civ;
}

/** 从第 0 年一口气推到 params.endYear */
export function runPack<S>(pack: CivPack<S>, world: World, params: Partial<CivParams> = {}, progress: Progress = () => {}): Civ {
  return startPack(pack, world, params, progress).finish();
}

/** 从第 0 年起一步步推到 params.endYear:第一次 advance / finish 时才开始算 */
export function startPack<S>(pack: CivPack<S>, world: World, params: Partial<CivParams> = {}, progress: Progress = () => {}): Stepper {
  const p: CivParams = { ...DEFAULT_CIV_PARAMS, ...params };
  const d = new Drive((line) => packFlow(pack, world, p, progress, line), 0, p.endYear, null);
  let done = false;
  return {
    to: p.endYear,
    get year() {
      return d.year;
    },
    advance(untilYear: number) {
      if (done) throw new Error('已经整理完了');
      d.advance(untilYear);
    },
    finish() {
      if (done) throw new Error('已经整理完了');
      const r = d.end();
      done = true;
      return settleOf(r.run, r.own, r.fin, r.eras, r.facts);
    },
  };
}

/** 从第 0 年推到 p.endYear 的总流程,主线照 line.stop 停;地形大事那一段(推到底的那一支、换地形)一次做完 */
function* packFlow<S>(pack: CivPack<S>, world: World, p: CivParams, progress: Progress, line: Line): Generator<void, Ran<S>, void> {
  const knobs = knobSet(p.knobs, pack.knobs);
  /** 文明种子:没给 = 地图种子 */
  const seed = p.civSeed ?? world.params.seed;
  const pre = reusableBase(p, world, seed, knobs);

  progress('宜居度', 0);
  const habitat = pre ? copyArrays(pre.habitat) : computeHabitat(world);
  const { land, viable } = viability(world, habitat);

  progress('划分州', 0.3);
  const regions = land > 0 ? (pre ? copyArrays(pre.regions) : buildRegions(world, habitat, { regionArea: p.regionArea, seed, knobs })) : emptyRegions(world.mesh.n);

  progress('文明', 0.8);
  const run: CivRun<S> = { pack, p, seed, knobs, viable, progress };
  const sim = packSim(pack, regions.count, knobs);
  let fin: Segment = { sim, world, habitat, regions };
  const { own, install } = pack.prelude(run, fin);
  if (install) installModules(pack, install);
  progress('民族推演', 0.85);
  const ups = install ? (p.upheavals ?? []).filter((u) => u.year > 0 && u.year < p.endYear) : [];
  yield* segment(line, sim, ups.length ? ups[0].year - 1 / 256 : p.endYear);
  const eras: CivEra[] = [];
  const facts: UpheavalFact[] = [];
  for (let k = 0; k < ups.length; k++) {
    const u = ups[k];
    const before = fin;
    // 早先几件大事的经过:分支里也认得出沉过海的城址
    const same = halfOf(run, own, before, before.habitat, before.regions);
    same.upheavals = facts.slice();
    // 接着推和一口气推完一样:这一支和"没有这件大事、照原样推到底"一模一样(信仰照历史重放:早先几段按那时的州)
    const branch = resumePack(pack, before.world, same, same.interventions ?? [], undefined, eras);
    branch.run(p.endYear);
    eras.push(pack.era(run, own, { k, seg: before, branch, from: k ? ups[k - 1].year : -Infinity, to: u.year, eras }));
    // 新地形:州沿用编号,只改变了的地方
    const h1 = computeHabitat(u.world);
    const r1 = reshapeRegions(u.world, h1, before.regions, { regionArea: p.regionArea, seed, knobs });
    const up = pack.upheave(run, own, { k, step: u, seg: before, habitat: h1, regions: r1 });
    facts.push(up.fact);
    const half = halfOf(run, own, before, h1, r1);
    up.reshape(half);
    half.upheavals = facts.slice(0, k);
    // 从前一刻接着推:大事那一刻的事件照常补上,排在大事后面;按新地形重算出来的、本该更早发生的事一律从大事那一刻起(CivSim.floor)
    const s1 = resumePack(
      pack,
      u.world,
      half,
      half.interventions ?? [],
      (s) => {
        s.floor = u.year;
        up.first(s);
      },
      eras,
    );
    up.install(s1);
    yield* segment(line, s1, k + 1 < ups.length ? ups[k + 1].year - 1 / 256 : p.endYear);
    fin = { sim: s1, world: u.world, habitat: h1, regions: r1 };
  }
  return { run, own, fin, eras, facts };
}

/** 推到一半拼成结果,各模块补上自己的那一份 */
function halfOf<S>(run: CivRun<S>, own: S, seg: Segment, habitat: Habitat, regions: Regions): Civ {
  const civ = run.pack.half(run, own, seg, habitat, regions);
  partialModules(run.pack, { sim: seg.sim, world: seg.world, endYear: civ.endYear, regions, civ });
  return civ;
}

/** 推完整理成结果,各模块补上自己的那一份 */
function settleOf<S>(run: CivRun<S>, own: S, fin: Segment, eras: CivEra[], facts: UpheavalFact[]): Civ {
  const civ = run.pack.settle(run, own, fin, eras, facts);
  if (civ.viable && civ.cultures.length) finishModules(run.pack, { sim: fin.sim, world: fin.world, endYear: run.p.endYear, regions: fin.regions, civ });
  return civ;
}

/** 引擎恢复要的那几样(Civ 里只取这些) */
function engineStateOf(civ: Civ): EngineState {
  return {
    regionCount: civ.regions.count,
    owners: [civ.culture, civ.polity],
    log: civ.log,
    annals: civ.annals,
    checkpoints: civ.checkpoints,
    endYear: civ.endYear,
    knobs: civ.knobs,
  };
}

/**
 * 由 Civ 重建推演状态,然后就能从 civ.endYear 接着推:sim.run(更晚的年份)。不需要保存事件堆。
 * interventions = 接着推时带着的干预(后面可以接上几条比 civ.endYear 晚的);first = 最先预约的事件(地形大事那一刻接着推时:大事本身);
 * eras = 地形大事以前各段的州
 */
export function resumePack<S>(
  pack: CivPack<S>,
  world: World,
  civ: Civ,
  interventions: readonly Intervention[] = civ.interventions ?? [],
  first?: (sim: CivSim) => void,
  eras: readonly EraRegions[] = civ.eras ?? [],
): CivSim {
  const sim = restorePackSim(pack, engineStateOf(civ));
  if (civ.viable && civ.cultures.length) {
    first?.(sim);
    resumeModules(pack, sim, pack.resumePrelude({ sim, world, civ, interventions, eras }));
  }
  return sim;
}

/** 分段接着推(startContinue):推到哪一刻了、再推一段、推完整理 */
export interface Continuation extends Stepper {
  /** 从哪一刻接着推(传进来的 civ.endYear) */
  readonly from: number;
  /**
   * 推到 to,不整理:只够查史事、归属和再接着推的一份历史(还没起名;地名、道路、人物、信仰是空的)。
   * 从它接着推(continueCiv / startContinue)和从整理过的同一刻接着推结果一样。和 finish 二选一,只调一次
   */
  partial(): Civ;
}

/** 干预列表 next 是 had 后面接上几条、接上的都在 endYear 以后才生效(年中的按那一格;接着推得出和从第 0 年重推一样的结果) */
function extends_(had: readonly Intervention[], next: readonly Intervention[], endYear: number): boolean {
  if (next.length < had.length || !sameInterventions(had, next.slice(0, had.length))) return false;
  return next.slice(had.length).every((v) => quantize(v.from + (v.fromTick ?? 0) / YEAR_TICKS) > endYear);
}

/** 从 civ 接着推、拆成几段推(规矩见 index.ts 的 startContinue);接不上 = null */
export function continuePack<S>(pack: CivPack<S>, world: World, civ: Civ, params: Partial<CivParams> = {}, progress: Progress = () => {}): Continuation | null {
  const p: CivParams = { ...DEFAULT_CIV_PARAMS, ...params };
  const had = civ.interventions ?? [];
  const list = params.interventions === undefined ? had : cleanInterventions(params.interventions);
  // 一套数:不给 = civ 带着的那一套;给了另一套就接不上(接着推照 civ 带着的那套算)
  const sameSet = params.knobs === undefined || sameKnobs(params.knobs, civ.knobs, pack.knobs);
  if (!sameSet || !civ.viable || !civ.cultures.length || !(civ.endYear >= 0) || civ.upheavals?.length || p.upheavals?.length || !(p.endYear > civ.endYear) || !extends_(had, list, civ.endYear))
    return null;
  const seed = p.civSeed ?? world.params.seed;
  progress('民族推演', 0.85);
  // 起名会写州名(regions.name):换一份州,不改传进来的 civ
  const regions = { ...civ.regions };
  const sim = resumePack(pack, world, { ...civ, regions }, list);
  const run: CivRun<S> = { pack, p, seed, knobs: sim.knobs, viable: true, progress };
  const fin: Segment = { sim, world, habitat: civ.habitat, regions };
  const to = p.endYear;
  const d = new Drive((line) => segment(line, sim, to), civ.endYear, to, sim);
  let done = false;
  const runTo = () => {
    if (done) throw new Error('startContinue:已经整理完了');
    d.end();
    done = true;
  };
  return {
    from: civ.endYear,
    to,
    get year() {
      return d.year;
    },
    advance(untilYear: number) {
      if (done) throw new Error('startContinue:已经整理完了');
      d.advance(untilYear);
    },
    finish() {
      runTo();
      return settleOf(run, pack.adopt(run, civ, list, sim), fin, [], []);
    },
    partial() {
      runTo();
      // 干预、地名风格补在最后:交出去的键序和以前一样
      const out = halfOf(run, pack.adopt(run, civ, [], sim), fin, civ.habitat, regions);
      if (civ.knobs) out.knobs = civ.knobs;
      if (list.length) out.interventions = list.slice();
      if (civ.names) out.names = civ.names;
      return out;
    },
  };
}

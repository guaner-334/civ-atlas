/**
 * 文明生成的入口:generateWorld() 之后在 worker 里调用。纯计算,不碰 DOM。
 * 推演照官方规则包(modules.ts 的 OFFICIAL_PACK)走,总流程在 run.ts:宜居度和州 → 开头几步(定民族、国家,预约干预)
 * → 各子系统照清单装上、推到 endYear(地形大事那段也在 run.ts)→ 推完整理(起名、道路、地名和关隘、人物,official.ts)→ 各子系统往结果上补。
 *
 * 随机数一律从 subSeed(seed, 'civ-…') 取(见 rand.ts),不用 Math.random。seed 是文明种子(params.civSeed):
 * 没给 = 地图种子(world.params.seed),和加这一项以前逐字节一样;给了 = 同一张地图上另一段历史(州、民族、国家、名字……都另起)。
 */
import type { Progress, World } from '../world';
import type { ChangeLog, Civ, CivBase, CivParams } from './types';
import { computeHabitat } from './habitat';
import { REGIONS_KNOBS, buildRegions, emptyRegions } from './regions';
import { knobSet } from './knobs';
import { DEFAULT_CIV_PARAMS, continuePack, runPack, startPack, viability, type Continuation, type Stepper } from './run';
import { OFFICIAL_PACK } from './modules';

export * from './types';

export { DEFAULT_CIV_PARAMS, type Continuation, type Stepper } from './run';
export { planetTempo } from './official';

/**
 * 推文明的底子:宜居度和州(generateCiv 的头两步,和它算的一模一样)。只跟地形、文明种子、每州面积有关:
 * 调用方(worker)按"这个世界 + 文明种子"留着一份,改了干预、拓荒、起源、地名风格、推演年数重推时经 CivParams.base 传回 generateCiv。
 * 划州按这个世界的那套数(CivParams.knobs)里的 REGIONS_KNOBS;那张表换了的,generateCiv 不用这一份
 */
export function civBase(world: World, params: Partial<CivParams> = {}): CivBase {
  const p: CivParams = { ...DEFAULT_CIV_PARAMS, ...params };
  const knobs = knobSet(p.knobs);
  const seed = p.civSeed ?? world.params.seed;
  const habitat = computeHabitat(world);
  const { land } = viability(world, habitat);
  const regions = land > 0 ? buildRegions(world, habitat, { regionArea: p.regionArea, seed, knobs }) : emptyRegions(world.mesh.n);
  return { world, seed, regionArea: p.regionArea, regionKnobs: knobs.get(REGIONS_KNOBS), habitat, regions };
}

/** 照官方规则包从第 0 年一口气推到 params.endYear */
export function generateCiv(world: World, params: Partial<CivParams> = {}, progress: Progress = () => {}): Civ {
  return runPack(OFFICIAL_PACK, world, params, progress);
}

/** generateCiv 拆成几段推:停在哪一刻、停几次,推完和 generateCiv 逐字节一样(地形大事的世界也一样) */
export function startCiv(world: World, params: Partial<CivParams> = {}, progress: Progress = () => {}): Stepper {
  return startPack(OFFICIAL_PACK, world, params, progress);
}

/**
 * 接着往后推:从一份推到 civ.endYear 的历史(可以是存档读回来的)接着推到 params.endYear,和一次推到 params.endYear 的结果完全一样
 * (归属、日志、史事、检查点,名字、配色、人物、道路、信仰……)。params 要和推出 civ 时的一样(endYear 除外)。
 * 推演完以后的整理(起名、配色、人物、道路、信仰)只看每样东西出现以前的历史,所以已经发生的不随后来推多远而变。
 * 有地形大事的世界、要推的年份不比 civ 晚的,照常从第 0 年整段重推(结果一样,只是不省时间)。
 * params.interventions(不给 = civ 推出来时带着的):可以是 civ 的干预后面接上几条比 civ.endYear 晚才生效的(逐年推演时下的新命令,play.ts),
 * 接着推的结果和带着它们一口气推完一样;不是这样接上的(改了、删了早先的干预)照常整段重推。
 * 推演插件下过命令的:给作者的干预就行(带不带插件的命令都行,命令不当输入);作者新加了干预照常整段重推(新加的要排在命令前面)。
 * 返回的是生成出来的名字:用户改过的名字(gen/edits.ts 的 applyNames)不在 Civ 里随推演走,照常在结果上再套一遍。
 * params.knobs(这个世界的一套数)不给 = civ 带着的那一套(接得上、从第 0 年重推都按它;见 continueParams)。
 * 传进来的 civ 不改(worker 留着它,下次再推还从它接着推)
 */
export function continueCiv(world: World, civ: Civ, params: Partial<CivParams> = {}, progress: Progress = () => {}): Civ {
  const q = continueParams(civ, params);
  const run = startContinue(world, civ, q, progress);
  return run ? run.finish() : generateCiv(world, q, progress);
}

/**
 * 接着 civ 往后推用的参数:没给一套数(knobs)的照 civ 带着的那一套 —— 接得上时按它接着推,接不上时从第 0 年重推也按它。
 * 明着给了另一套(比如 {} = 官方):接不上,照给的那套从第 0 年重推
 */
export function continueParams(civ: Pick<Civ, 'knobs'>, params: Partial<CivParams>): Partial<CivParams> {
  return params.knobs === undefined && civ.knobs ? { ...params, knobs: civ.knobs } : params;
}

/**
 * continueCiv 拆成几段推(worker 再推 N 年时用:每段之间报进度、看有没有新的请求要停下)。参数和规矩同 continueCiv;
 * 接不上(有地形大事、要推的年份不比 civ 晚、改了早先的干预、给的一套数和 civ 带着的不一样、civ 停在第 0 年以前:第 0 年那一刻的事还没发生,
 * 没有能接着用的……)= null,照常从第 0 年整段重推(generateCiv;参数照 continueParams)。params.knobs 不给 = civ 带着的那一套。
 * 推演那一步拆开推,推完以后的整理照旧一次做完;不改传进来的 civ
 */
export function startContinue(world: World, civ: Civ, params: Partial<CivParams> = {}, progress: Progress = () => {}): Continuation | null {
  return continuePack(OFFICIAL_PACK, world, civ, params, progress);
}

export function emptyLog(): ChangeLog {
  return {
    size: 0,
    year: new Float32Array(0),
    region: new Int32Array(0),
    layer: new Uint8Array(0),
    value: new Int16Array(0),
    cause: new Uint8Array(0),
  };
}

/** Civ 里所有类型化数组的底层缓冲区(去重),worker 发消息时用 transfer 传,省得复制 */
export function civTransferables(civ: Civ): ArrayBuffer[] {
  const out = new Set<ArrayBuffer>();
  const walk = (v: unknown, depth: number) => {
    if (!v || typeof v !== 'object' || depth > 4) return;
    if (ArrayBuffer.isView(v)) {
      if (v.buffer instanceof ArrayBuffer && v.buffer.byteLength > 0) out.add(v.buffer);
      return;
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, depth + 1);
  };
  walk(civ, 0);
  return [...out];
}

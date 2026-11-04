/**
 * 按一份配方推一个世界用到的几样,生成世界的后台线程(worker.ts)和转存旧世界的线程(worldConvert.ts)共用:
 * 同一份配方走同一段代码,转存时算出来的才和当初推出来的一模一样。
 *
 * 也放世界内容里给人看的两样怎么算:编年史、国旗。这两样存进世界(worldVault.ts),算法和用的人在界面上看到的一样。
 *
 * 纯计算,不碰 DOM。
 */
import type { Calamity } from './gen/civ/calamity';
import { civAtEra } from './gen/civ/eraCiv';
import type { Frontier, Origins } from './gen/civ/frontier';
import { playStop } from './gen/civ/play';
import type { ChronicleEntry } from './gen/civ/story/chronicle';
import { flagBook, type FlagBook } from './gen/civ/story/flags';
import { fullChronicle } from './gen/civ/story/religionText';
import type { WorldTuning } from './gen/civ/tuning';
import { worldPatch } from './gen/civ/tuningPatch';
import type { Civ } from './gen/civ/types';
import { applyNames, playInterventions, type Intervention, type PlayState, type TerrainOp } from './gen/edits';
import type { NameMix } from './gen/names';
import type { SketchEdit } from './gen/sketch';
import type { World, WorldParams } from './gen/world';

/** 世界在线程里的键(参数 + 草图 + 地形修改) */
export const keyOf = (p: WorldParams, terrain?: readonly TerrainOp[], sketch?: SketchEdit) =>
  JSON.stringify([Object.entries(p).sort(([a], [b]) => (a < b ? -1 : 1)), terrain ?? [], sketch ?? null]);

/** 推文明时带的地名风格(自动 = 不带) */
export const namesOpt = (names: NameMix | undefined) => (names ? { names } : {});

/** 推文明时带的推演年数(3000 = 不带) */
export const yearsOpt = (endYear: number | undefined) => (endYear ? { endYear } : {});

/**
 * 推文明时带的拓荒、起源、天灾、规则(默认 = 不带)。规则换成一套旋钮(CivParams.knobs):推演、接着推、逐年推演、照大纲推演都经这里,
 * 同一套规则的旋钮内容一样(gen/civ/knobs.ts 按内容认同一套)
 */
export const setupOpt = (m: { frontier?: Frontier; origins?: Origins; civSeed?: number; calamity?: Calamity; tuning?: WorldTuning }) => {
  const knobs = worldPatch(m.tuning);
  return {
    ...(m.frontier ? { frontier: m.frontier } : {}),
    ...(m.origins ? { origins: m.origins } : {}),
    ...(m.civSeed !== undefined ? { civSeed: m.civSeed } : {}),
    ...(m.calamity ? { calamity: m.calamity } : {}),
    ...(knobs ? { knobs } : {}),
  };
};

/** 推文明时带的逐年推演进度(没在逐年推演 = 不带):推到进度那一刻(年 + 第几格),命令接在干预后面(放在最后,盖过干预、推演年数) */
export const playOpt = (m: { play?: PlayState; interventions?: readonly Intervention[] }) =>
  m.play ? { interventions: [...playInterventions((m.interventions ?? []) as Intervention[], m.play)], endYear: playStop(m.play.year, m.play.tick) } : {};

/** 推文明时带的地形大事(没有 = 不带,和不加这一项逐字节一样) */
export const upOpt = <S>(steps: S[]) => (steps.length ? { upheavals: steps } : {});

/** 地图那一块存什么:形成过程的回放快照太大,不存 */
export function mapValue(world: World): World {
  const { history: _h, ...rest } = world;
  void _h;
  return { ...rest, history: [] };
}

/** 各段的世界:不带网格(和地图同一套)、回放快照。key = 这一段在线程里的键 */
export function eraWorlds(steps: readonly { key: string; world: World }[]): { key: string; world: World }[] | undefined {
  if (!steps.length) return undefined;
  return steps.map((s) => {
    const { mesh: _m, history: _h, ...rest } = s.world;
    void _m;
    void _h;
    return { key: s.key, world: { ...rest, history: [] } as unknown as World };
  });
}

/** 存进世界的编年史:整段历史套上改名以后的全部条目(和界面上看到的一样) */
export function worldChronicle(civ: Civ, names: Readonly<Record<string, string>>): ChronicleEntry[] {
  // 浅拷一层再算:编年史的缓存按这个对象记,算完就放掉
  return fullChronicle(applyNames({ ...civ }, names as Record<string, string>));
}

/**
 * 存进世界的国旗:自动配的那一套。作者改过的旗在配方里,不算在这一块,改旗不用重写这一块。
 * 有地形大事的按第一件以前的地形配(和界面上一样:拖时间轴跨过大事旗不跟着变)
 */
export function worldFlags(world: World, civ: Civ, names: Readonly<Record<string, string>>): FlagBook {
  return flagBook(world, applyNames(civAtEra(civ, 0), names as Record<string, string>));
}

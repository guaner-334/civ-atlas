/**
 * 并排试推右上角能换的地图(纯计算,不碰存储):
 *   1. 正看着一个世界时:「〈世界名〉的地图」(排第一、默认选它):它的地图,文明种子、拓荒、起源、天灾、地名风格也照它
 *   2. 种子 7 的地图(默认参数、种子 7,没改过地形)
 *   3. 「我的世界」地图页签里的各张地图(最近动过的在前):参数、地形照那张地图,文明种子 = 地图种子,别的照默认
 * 同一张地图(参数、地形修改、草图都一样)只列一次,先列的算。两边一律推 3000 年(推演年数不带)。
 */
import { DEFAULT_PARAMS, type WorldParams } from '../../gen/params';
import { cleanCivSeed, type WorldEdits } from '../../gen/edits';
import type { GrowMap, GrowSetup } from '../../growThread';
import type { StoredWorld } from '../saveStore';
import { mapGroups, mapName } from '../mapGroups';

/** 正看着的那个世界:名字、地图、几样设定(干预、地形大事、逐年推演、改名不带) */
export interface CompareHere {
  title: string;
  map: GrowMap;
  setup: GrowSetup;
}

/**
 * 正看着的那个世界(在世界里点开的调规则大卡;首页、我的世界、新建世界里 = null)。
 * world = 现在这个世界(saveStore 的 currentWorld:参数、名字),edits = 它的修改(editsStore 的 getEdits)
 */
export function worldHere(inWorld: boolean, world: { params: WorldParams; title?: string } | null, edits: WorldEdits): CompareHere | null {
  if (!inWorld || !world) return null;
  const civSeed = cleanCivSeed(edits.civSeed);
  return {
    title: world.title || '未命名世界',
    map: mapOf(world.params, edits.terrain, edits.sketch),
    setup: {
      ...(civSeed !== undefined ? { civSeed } : {}),
      ...(edits.frontier ? { frontier: edits.frontier } : {}),
      ...(edits.origins ? { origins: edits.origins } : {}),
      ...(edits.calamity ? { calamity: edits.calamity } : {}),
      ...(edits.nameMix ? { names: edits.nameMix } : {}),
    },
  };
}

export interface MapChoice {
  /** 这张地图(参数、地形修改、草图)的键 */
  key: string;
  /** 下拉里、标题下那句话里怎么叫:"种子 7 的地图" */
  label: string;
  map: GrowMap;
  setup: GrowSetup;
}

/** 默认那张:种子 7 */
export const DEFAULT_MAP_SEED = 7;

export function mapKey(m: GrowMap): string {
  return JSON.stringify([Object.entries(m.params).sort(([a], [b]) => (a < b ? -1 : 1)), m.terrain?.length ? m.terrain : [], m.sketch ?? null]);
}

/** 只带有的几样(没改过地形的不带 terrain,和推一个世界时一样) */
function mapOf(params: WorldParams, terrain: GrowMap['terrain'], sketch: GrowMap['sketch']): GrowMap {
  return { params, ...(terrain?.length ? { terrain } : {}), ...(sketch ? { sketch } : {}) };
}

/** 能换的几张地图(here = 正看着的那个世界;worlds = listWorlds 的结果) */
export function mapChoices(here: CompareHere | null, worlds: readonly StoredWorld[]): MapChoice[] {
  const out: MapChoice[] = [];
  const seen = new Set<string>();
  const add = (label: string, map: GrowMap, setup: GrowSetup) => {
    const key = mapKey(map);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, label, map, setup });
  };
  if (here) add(`「${here.title}」的地图`, mapOf(here.map.params, here.map.terrain, here.map.sketch), here.setup);
  add(`种子 ${DEFAULT_MAP_SEED} 的地图`, { params: { ...DEFAULT_PARAMS, seed: DEFAULT_MAP_SEED } }, {});
  for (const g of mapGroups(worlds)) {
    const s = g.head.save;
    add(`${mapName(g.head)}的地图`.replace(/(\d)的地图$/, '$1 的地图'), mapOf(s.params, s.edits.terrain, s.edits.sketch), {});
  }
  return out;
}

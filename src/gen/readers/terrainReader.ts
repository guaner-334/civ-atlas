/**
 * 按版本取地貌读取代码。后台线程直接 import 这个文件,不要经过 index.ts(不然查询的代码也跟进线程)。做法见 index.ts。
 */
import { noteOlderTerrain } from './older';
import { READER_VERSIONS, readerBook } from './versions';
import * as current from './terrainCode';

export type TerrainReader = typeof current;

/** 留下来的老版本(版本号 → 下载):每个都是单独的文件,打开那样的世界时才下载 */
const OLDER: Record<number, () => Promise<TerrainReader>> = {};

const book = readerBook<TerrainReader>('terrain', READER_VERSIONS.terrain, current, OLDER);

/** 老版本下载好了就记下(older.ts),画河这些同步调的地方要用 */
export const terrainReader = (version: unknown): Promise<TerrainReader> =>
  book(version).then((r) => {
    if (r !== current) noteOlderTerrain(version as number, r);
    return r;
  });

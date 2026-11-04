/**
 * 这一页已经下载好的老版本地貌读取代码。世界对象带着自己要第几版(World.readers);画河、拼地形大事以后的主图这些地方是同步调的,
 * 不能在那儿 await,就先由开世界、后台线程收世界时下载好(terrainReader),用的时候在这里按世界取。
 * 取不到(世界没记版本、记的就是当前版本)= null,调用方用手边当前版本的代码。
 *
 * 后台线程收到世界时用 olderTerrainOf:世界要老版本才下载读取清单,要当前版本的什么都不多下,接着用线程自己 import 的那几个函数。
 *
 * 这个文件不多带代码:画河的代码、各个后台线程 import 它不会多带铺像素的代码。
 */
import type { TerrainReader } from './terrainReader';
import { READER_VERSIONS, type ReaderVersions } from './versions';

const loaded = new Map<number, TerrainReader>();

/** 老版本下载好了 */
export function noteOlderTerrain(version: number, reader: TerrainReader): void {
  loaded.set(version, reader);
}

/** 这个世界要的老版本地貌读取代码(已经下载好了的);世界用的是当前版本 = null */
export function olderTerrain(world: { readers?: ReaderVersions }): TerrainReader | null {
  const v = world.readers?.terrain;
  return v === undefined ? null : (loaded.get(v) ?? null);
}

/** 这个世界要老版本就下载好给它;用的是当前版本 = null。版本不认识、下载不下来 reject */
export async function olderTerrainOf(world: { readers?: ReaderVersions }): Promise<TerrainReader | null> {
  const v = world.readers?.terrain;
  if (v === undefined || v === READER_VERSIONS.terrain) return null;
  const { terrainReader } = await import('./terrainReader');
  return terrainReader(v);
}

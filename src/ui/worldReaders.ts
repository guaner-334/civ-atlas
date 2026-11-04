/**
 * 世界换上之前,主线程按它记的版本取好读取代码(gen/readers/):查询换成那一版(gen/readers/openQuery.ts),老版本的地貌代码下载好(画河、拼主图同步要用)。
 * 这一版软件刚算的世界、记的就是当前版本的世界:什么都不用下载,当场换回当前版本。
 */
import { setQueryReader } from '../gen/readers/openQuery';
import { currentQuery, queryReader } from '../gen/readers/queryReader';
import { READER_VERSIONS, type ReaderVersions } from '../gen/readers/versions';

/** 换成这一版;当场换好 = null,要下载 = 下载完、换好才兑现的 Promise(下载不下来、版本不认识 reject) */
export function adoptReaders(v: ReaderVersions | undefined): Promise<void> | null {
  if (!v || (v.terrain === READER_VERSIONS.terrain && v.query === READER_VERSIONS.query)) {
    setQueryReader(currentQuery);
    return null;
  }
  return Promise.all([import('../gen/readers/terrainReader').then((m) => m.terrainReader(v.terrain)), queryReader(v.query)]).then(([, query]) => setQueryReader(query));
}

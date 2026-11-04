/**
 * 读世界的代码分版本。
 *
 * 存下的世界是胶片,读它的代码是放映机:胶片原样存着,放映机一改,老世界打开也会变样。所以读取代码也留版本:
 * 世界记下自己要第几版,打开时取那一版。第 1 版就是现在的代码。
 *   - terrain:铺全图像素(水陆、地貌、海拔、气温、降水、海冰、湿地、沟壑、细沟)、放大时的分块、河和小溪的线
 *   - query:某年的归属、信仰、人口、城市等级、国都、国号、君主、开发度这些查询
 * 不分版本、跟着软件变好的:画风渲染、界面、国界的抖动和平滑、地名避让、卡片上的解说文字。
 * 有没有读变样,由样本测试看着(tests/saved-world-stable.test.ts,比什么写在它的文件头)。
 *
 * 怎么接(世界从存下的内容读出来时带着 World.readers,跟着世界送到各个后台线程;这一版软件刚算的世界没有这一项,用当前版本):
 *
 *   地貌,后台线程:收到世界时取一次,存着,放大这种高频的路径上不要 await
 *     const read = (await olderTerrainOf(world)) ?? { rasterizeWindow, ... };   // ./older:世界要老版本才下载,当前版本用线程自己 import 的
 *     read.rasterizeWindow(src, S, x0, y0, w, h);                               // 每一块直接用
 *   地貌,同步调的地方(画河、拼主图):(olderTerrain(world)?.creeksOf ?? creeksOf)(world)。先由开世界时下载好(ui/worldReaders.ts)
 *   查询:一律从 ./openQuery import,开世界时换成那一版;界面、画风、AI 不用管版本
 *
 * 当前版本不用下载,await 在下一条消息到来之前就走完;老版本要下载,等的时候来的请求要排队。
 * 版本号不认识时抛 UnknownReaderError,needsUpdate = true 就是「这个世界要更新软件才能打开」。
 * 没记版本的老世界用 FIRST_READERS。
 *
 * 改了算法、样本测试红了,又确实要改时,旧代码留一份:
 *
 *   1. 留存底:npx tsx scripts/freeze-reader.ts terrain(查询就写 query)
 *      从 origin/main 上取现在这一版的代码(先 git fetch),连同它用到的所有文件,复制到 readers/terrain/v<版本号>/。第三方依赖不复制。
 *      存底只读,以后不改。
 *   2. 登记:在 terrainReader.ts 的 OLDER 里加一行(脚本会打印这一行),它是动态 import,所以旧代码单独打包、用到才下载;
 *      versions.ts 的 READER_VERSIONS 那一项加一。FIRST_READERS 不动。
 *   3. 再跑样本测试:样本记着旧版本,走的是存底,应该绿了。还红就是存底以外还有代码影响读取结果,要么改回去,要么把它搬进读取清单。
 *   4. 给新版本也加样本:scripts/saved-worlds.ts 的 SPECS 加一个世界,跑 samples 和 baseline(不加 --force 只补新的,已有的不动)。
 *   5. 看构建产物:pnpm build 以后 assets/ 里多一个旧代码的文件,pnpm size 列的首页下载量不变。
 */
import { queryReader } from './queryReader';
import { terrainReader } from './terrainReader';
import type { ReaderVersions } from './versions';

export { FIRST_READERS, READER_VERSIONS, UnknownReaderError, type ReaderKind, type ReaderVersions } from './versions';
export { terrainReader, type TerrainReader } from './terrainReader';
export { queryReader, type QueryReader } from './queryReader';

/** 一个世界要用的两份读取器 */
export async function readersFor(v: ReaderVersions) {
  const [terrain, query] = await Promise.all([terrainReader(v.terrain), queryReader(v.query)]);
  return { terrain, query };
}

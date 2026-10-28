/**
 * 成书(阶段 5 写史书):把推演出来的历史交给 AI 写成成段的中文史书。
 *
 * - 入口:右上"成书"(默认整个世界)、国家面板的"写国史"、编年史(openHistoryBook({ polity }) 默认那一国)
 * - 生成史书窗口(BookDialog.tsx):写什么 / 文体 / 篇幅 → 开始生成;窗口关上,写作在后台继续,右上显示进度;
 *   下面列着已写的史书,点一部阅读
 * - 阅读(BookReader.tsx):小字元信息、宋体大标题、分章正文;复制、导出、重写、删除;写的时候边写边显示,可以停止
 * - 状态在 bookStore.ts;写、存、比对历史指纹在 ai/history.ts
 *
 * 这个组件一直挂着(有历史时):把当前的历史交给 bookStore,换了世界就停下正在写的。
 */
import { useEffect, useMemo } from 'react';
import type { Civ } from '../gen/civ/types';
import type { Raster } from '../gen/raster';
import type { World } from '../gen/world';
import { currentWorld, useSavesVersion } from './saveStore';
import { getBook, resetBookForWorld, setBookContext } from './bookStore';
import { BookDialog } from './BookDialog';
import { BookReader } from './BookReader';
import { lifeSource } from './lifeSource';
import { useAiOn } from '../ai/client';

export { closeHistoryBook, openHistoryBook } from './bookStore';

/** land / raster:地形(写作者人物的列传时算地名、出生地归哪国;还没有 = null) */
export function HistoryBook({ civ, land, raster }: { civ: Civ; land: World | null; raster: Raster | null }) {
  useSavesVersion();
  const aiOn = useAiOn();
  const world = currentWorld()?.id ?? null;
  // 列传、家传的人物材料(人物卡按这份历史缓存)
  const src = useMemo(() => lifeSource(civ, land, raster), [civ, land, raster]);
  setBookContext(civ, world, src);
  // 换了世界:停下正在写的(写到的存不进别的世界),右上的进度收起
  useEffect(() => {
    const j = getBook().job;
    if (world && j && j.world !== world) resetBookForWorld();
  }, [world]);
  // 「使用 AI 功能」关着:写史书的窗口、阅读页都不显示(App 关开关时已经停下正在写的)
  if (!aiOn) return null;
  return (
    <>
      <BookDialog civ={civ} />
      <BookReader civ={civ} />
    </>
  );
}

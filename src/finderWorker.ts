/// <reference lib="webworker" />
/**
 * 照故事找世界的后台线程(gen/finder):一次推一个种子、量完,只把量出来的几十个数交回去(不留整个世界,内存和平时开一个世界差不多)。
 * 列表上会出现的那几种配法顺手画一张小图(finderThumbDraw.ts;画不了就只交色块,界面上自己画)。
 * 找世界那一页开几个这样的线程(ui/finderPool.ts),一个线程一次领一个种子;停下 = 直接关掉线程,推了一半的那个作废。
 * 并排试推也开这个线程(这里本来就只有生成地图、推历史的代码,不另打包一份):它的消息带 grow,交给 growThread.ts;找世界的活照旧。
 */
import { searchSeedWith } from './gen/finder/measure';
import type { FinderQuery, FinderSetup, SeedReport } from './gen/finder/query';
import { drawThumbs } from './finderThumbDraw';
import { growMessage, isGrowRequest, type GrowReply, type GrowRequest } from './growThread';

/** 派给线程的一个种子 */
export interface FinderJob {
  id: number;
  query: FinderQuery;
  setup: FinderSetup;
  seed: number;
}

/** 推完交回来的 */
export interface FinderDone {
  id: number;
  report: SeedReport;
}

self.onmessage = async (e: MessageEvent<FinderJob | GrowRequest>) => {
  // 边推边交的历史(并排试推)另有一套消息,见 growThread.ts
  if (isGrowRequest(e.data)) return void growMessage(e.data, (r: GrowReply) => self.postMessage(r));
  const { id, query, setup, seed } = e.data;
  const { report, world, civ } = searchSeedWith(query, setup, seed);
  let transfer: ArrayBuffer[] = [];
  if (world && civ) {
    try {
      transfer = await drawThumbs(world, civ, report);
    } catch {
      // 小图画坏了不要紧:界面上照色块画
    }
  }
  const out: FinderDone = { id, report };
  self.postMessage(out, { transfer });
};

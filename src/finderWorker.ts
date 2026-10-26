/// <reference lib="webworker" />
/**
 * 照故事找世界的后台线程(gen/finder):一次推一个种子、量完,只把量出来的几十个数交回去(不留整个世界,内存和平时开一个世界差不多)。
 * 找世界那一页开几个这样的线程(ui/finderPool.ts),一个线程一次领一个种子;停下 = 直接关掉线程,推了一半的那个作废。
 */
import { searchSeed } from './gen/finder/measure';
import type { FinderQuery, FinderSetup, SeedReport } from './gen/finder/query';

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

self.onmessage = (e: MessageEvent<FinderJob>) => {
  const { id, query, setup, seed } = e.data;
  const out: FinderDone = { id, report: searchSeed(query, setup, seed) };
  self.postMessage(out);
};

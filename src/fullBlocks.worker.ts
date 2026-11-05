/** 算世界文件的指纹(ui/fullBlocks.ts),在后台线程,大世界不卡界面。 */
import { hashBlocks, type BlockRange } from './ui/fullBlocks';

self.onmessage = (e: MessageEvent<{ file: Blob; ranges: BlockRange[] }>) => {
  hashBlocks(e.data.file, e.data.ranges).then(
    (plan) => postMessage({ plan }),
    (err: unknown) => postMessage({ error: err instanceof Error ? err.message : String(err) }),
  );
};

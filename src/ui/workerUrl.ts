/**
 * 生成世界的后台线程(src/worker.ts)打包以后的地址。App 用它开线程(new Worker);
 * 打开网站停在首页时,主程序在后台下好以后接着把它也下好(prefetchWorker,见 Boot.tsx),进世界时不用再等它。
 */
import url from '../worker.ts?worker&url';

export const WORKER_URL: string = url;

let fetched = false;
/** 在后台先把线程的代码下好(最低优先,不和正在用的抢;浏览器不支持就算了,开线程时照常下载) */
export function prefetchWorker(): void {
  if (fetched || typeof document === 'undefined') return;
  fetched = true;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = WORKER_URL;
  document.head.append(link);
}

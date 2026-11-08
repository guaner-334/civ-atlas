/** 装推演插件之前把表的公式也查一遍(在单独的线程里,查完关掉);只在装推演插件时 import() */
import { PluginFileError } from './pluginFile';

/** 只编译不算,电脑上几十毫秒;慢的手机也够 */
const TIMEOUT_MS = 15_000;

/** 表的公式写错了抛 PluginFileError(broken);线程开不起来、超时不算坏(推演线程装它时还会再查) */
export function checkSimFully(bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL('./simCheck.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return resolve();
    }
    const done = (why: string | null) => {
      clearTimeout(timer);
      w.terminate();
      if (why) reject(new PluginFileError('broken', why));
      else resolve();
    };
    const timer = setTimeout(() => done(null), TIMEOUT_MS);
    w.onmessage = (e: MessageEvent<string | null>) => done(e.data);
    w.onerror = () => done(null);
    w.postMessage(bytes);
  });
}

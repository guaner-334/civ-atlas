/** 插件和这个世界里存的数据有关、要先问一句的两张框(插件第一次往这个世界里存数据、去掉插件存的数据);框本身(WorldDataAsk.tsx)用到才下载 */
import { createStore } from '../createStore';

export type DataAsk =
  /** 插件要往这个世界里存它自己的数据(这个世界第一次) */
  | { kind: 'store'; plugin: string; pluginId: string; sum: string; kb: number; answer: (ok: boolean) => void }
  /** 去掉这个世界里插件存的数据 */
  | { kind: 'remove'; plugins: string[]; kb: number; answer: (ok: boolean) => void };

export const dataAsk = createStore<DataAsk | null>(null);

/** 问一句,等用的人回答(还有一张没答的先当「不」) */
export function askData(a: Omit<Extract<DataAsk, { kind: 'store' }>, 'answer'> | Omit<Extract<DataAsk, { kind: 'remove' }>, 'answer'>): Promise<boolean> {
  return new Promise((resolve) => {
    dataAsk.get()?.answer(false);
    const ask = {
      ...a,
      answer: (ok: boolean) => {
        if (dataAsk.get() === ask) dataAsk.set(null);
        resolve(ok);
      },
    } as DataAsk;
    dataAsk.set(ask);
  });
}

/** 大小写成「12 KB」(不到 1 KB 写 1 KB) */
export const kbText = (bytes: number): number => Math.max(1, Math.round(bytes / 1024));

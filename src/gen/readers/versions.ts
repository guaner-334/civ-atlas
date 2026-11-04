/**
 * 读取代码的版本号和按版本取代码的办法。整套做法见同目录的 index.ts。
 * 这个文件不引别的模块,哪里 import 都不会多带代码。
 */

/** 一个世界要用第几版读取代码 */
export interface ReaderVersions {
  /** 铺全图像素、放大时的分块 */
  terrain: number;
  /** 某年的归属、信仰、人口、城市等级这些查询 */
  query: number;
}

export type ReaderKind = keyof ReaderVersions;

/** 这个版本的软件现在用第几版。新存的世界记这一份 */
export const READER_VERSIONS: Readonly<ReaderVersions> = { terrain: 1, query: 1 };

/** 分版本以前存下的世界没记版本,用的都是第 1 版 */
export const FIRST_READERS: Readonly<ReaderVersions> = { terrain: 1, query: 1 };

const KIND_NAME: Record<ReaderKind, string> = { terrain: '地貌', query: '查询' };

/** 没有这一版读取代码 */
export class UnknownReaderError extends Error {
  readonly kind: ReaderKind;
  readonly version: unknown;
  /** true = 世界比软件新,更新软件就能打开;false = 这个版本号本身不对(世界文件坏了),更新也没用 */
  readonly needsUpdate: boolean;

  constructor(kind: ReaderKind, version: unknown, current: number) {
    // 版本号可能来自别人的文件:只显示数字和字符串(截短),别的只说是什么类型
    const shown = typeof version === 'number' || typeof version === 'string' ? String(version).slice(0, 32) : typeof version;
    const needsUpdate = typeof version === 'number' && Number.isInteger(version) && version > current;
    super(needsUpdate ? `这个世界的${KIND_NAME[kind]}要第 ${shown} 版读取代码,这个版本的软件只到第 ${current} 版,更新软件才能打开` : `认不出这个世界的${KIND_NAME[kind]}读取版本:${shown}`);
    this.name = 'UnknownReaderError';
    this.kind = kind;
    this.version = version;
    this.needsUpdate = needsUpdate;
  }
}

/**
 * 一种读取代码的各版本:当前版本就在手边,老版本用到时才下载,下载过的不再下载。
 * 版本号可能来自别人的文件,所以什么值都可能传进来:不是登记过的版本一律抛 UnknownReaderError。
 * 下载失败时抛下载的错(不是 UnknownReaderError),下次再要会重新下载。
 */
export function readerBook<R>(kind: ReaderKind, current: number, reader: R, older: Readonly<Record<number, () => Promise<R>>>): (version: unknown) => Promise<R> {
  const loading = new Map<number, Promise<R>>();
  return (version) => {
    if (version === current) return Promise.resolve(reader);
    const load = typeof version === 'number' ? older[version] : undefined;
    if (!load) return Promise.reject(new UnknownReaderError(kind, version, current));
    const v = version as number;
    let p = loading.get(v);
    if (!p) {
      p = load();
      loading.set(v, p);
      p.catch(() => loading.delete(v));
    }
    return p;
  };
}

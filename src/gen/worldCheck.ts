/**
 * 在单独的后台线程里把世界文件核对一遍,超时就杀掉:文件是别人给的,读包、校验的代码万一被什么长法卡住,杀的只是这个线程,页面照样能点。
 *
 * - checkWorldFile:核对本身(打开 + 解开 + 迁移 + 逐项校验),不管在哪个线程都能跑;Node(服务器)直接调它
 * - checkWorldFileInWorker:网页里用,开一个线程跑上面那个,时间到了杀掉。结果里只有核对的结论,世界的内容不带回来
 *
 * 超时(timeout)、线程崩了(crash)不等于文件坏了:可能只是手机太慢、内存不够,调用方不要说成「文件坏了」。
 */
import { asWorldFileError, type WorldFileErrorKind, type WorldManifest, type WorldReaders } from './worldFormat';
import { openWorldFile, readWorldContent, type OpenOptions } from './worldFile';

/** 默认的时限:量到的最大的世界在电脑上几秒内读完;低端手机慢 6 倍也来得及 */
export const WORLD_CHECK_TIMEOUT_MS = 20_000;

/** 没过:文件的问题,或者超时、线程崩了 */
export type WorldCheckFailure = { ok: false; kind: WorldFileErrorKind | 'timeout' | 'crash'; message: string };

/** 核对的结论 */
export type WorldCheckResult = { ok: true; manifest: WorldManifest; warnings: string[] } | WorldCheckFailure;

/** 核对一个文件:结论都在返回值里,不抛错 */
export async function checkWorldFile(file: Blob | Uint8Array, options: OpenOptions): Promise<WorldCheckResult> {
  try {
    const opened = await openWorldFile(file, options);
    const content = await readWorldContent(opened);
    return { ok: true, manifest: opened.manifest, warnings: content.warnings };
  } catch (err) {
    const e = asWorldFileError(err);
    return { ok: false, kind: e.kind, message: e.message };
  }
}

/** 交给后台线程的一件事 */
export interface WorldCheckRequest {
  file: Blob;
  readers: WorldReaders;
  maxBytes?: number;
}

/** 后台线程要有的样子(单测用假的;想多带回点东西的换一个线程,R 是它交回来的) */
export interface WorldCheckWorker<R = WorldCheckResult> {
  postMessage(message: WorldCheckRequest): void;
  terminate(): void;
  onmessage: ((e: { data: R }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
}

export interface WorldCheckOptions<R = WorldCheckResult> {
  readers: WorldReaders;
  maxBytes?: number;
  /** 时限(毫秒) */
  timeoutMs?: number;
  /** 不给 = 开真的线程 */
  makeWorker?: () => WorldCheckWorker<R>;
}

/** 开一个线程核对一个文件;拿到结论、超时、线程崩了都会把线程关掉。不抛错 */
export function checkWorldFileInWorker<R = WorldCheckResult>(file: Blob, options: WorldCheckOptions<R>): Promise<R | WorldCheckFailure> {
  const { readers, maxBytes, timeoutMs = WORLD_CHECK_TIMEOUT_MS, makeWorker } = options;
  return new Promise((resolve) => {
    let worker: WorldCheckWorker<R>;
    try {
      worker = makeWorker ? makeWorker() : (new Worker(new URL('./worldCheck.worker.ts', import.meta.url), { type: 'module' }) as unknown as WorldCheckWorker<R>);
    } catch (err) {
      resolve({ ok: false, kind: 'crash', message: err instanceof Error ? err.message : String(err) });
      return;
    }
    const finish = (result: R | WorldCheckFailure) => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, kind: 'timeout', message: '核对世界文件超时' }), timeoutMs);
    worker.onmessage = (e) => finish(e.data);
    worker.onerror = (e) => finish({ ok: false, kind: 'crash', message: e.message ?? '核对世界文件的线程崩了' });
    worker.postMessage({ file, readers, ...(maxBytes !== undefined ? { maxBytes } : {}) });
  });
}

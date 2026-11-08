/** 推演插件表的公式在这个线程里查(simCheck.ts):网页主线程不带数表引擎 */
import { PluginFileError } from './pluginFile';
import { openPluginFileFully } from './pluginSimTables';

const scope = self as unknown as { onmessage: ((e: { data: Uint8Array }) => void) | null; postMessage(m: string | null): void };

scope.onmessage = (e) => {
  openPluginFileFully(e.data).then(
    () => scope.postMessage(null),
    (err: unknown) => scope.postMessage(err instanceof PluginFileError && err.kind === 'broken' ? err.message : null),
  );
};

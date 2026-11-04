/** 核对世界文件的后台线程:只有这一件事,做完就等着被关掉(worldCheck.ts) */
import { checkWorldFile, type WorldCheckRequest, type WorldCheckResult } from './worldCheck';

const scope = self as unknown as { onmessage: ((e: { data: WorldCheckRequest }) => void) | null; postMessage(m: WorldCheckResult): void };

scope.onmessage = (e) => {
  const { file, readers, maxBytes } = e.data;
  void checkWorldFile(file, { readers, ...(maxBytes !== undefined ? { maxBytes } : {}) }).then((r) => scope.postMessage(r));
};

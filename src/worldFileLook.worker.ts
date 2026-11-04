/** 核对别人给的世界文件的后台线程:只有这一件事,做完就等着被关掉(worldFileLook.ts、ui/worldFiles.ts) */
import type { WorldCheckRequest } from './gen/worldCheck';
import { lookFile, type FileLook } from './worldFileLook';

const scope = self as unknown as { onmessage: ((e: { data: WorldCheckRequest }) => void) | null; postMessage(m: FileLook): void };

scope.onmessage = (e) => {
  const { file, readers, maxBytes } = e.data;
  void lookFile(file, { readers, ...(maxBytes !== undefined ? { maxBytes } : {}) }).then((r) => scope.postMessage(r));
};

/**
 * 插件的一批修改记进网站的修改:和用的人自己改一样走撤销记录(整批一步),照原样打开的旧世界改历史时照样先问要不要另存一份。
 */
import type { WorldEdits } from '../gen/edits';
import { commitEdits, editBlock } from '../ui/editsStore';

/** 记进去了 = null;现在不让改 = 原因 */
export function commitPluginEdits(next: WorldEdits, keys: string[]): string | null {
  const why = editBlock(keys);
  if (why) return why;
  return commitEdits(next) ? null : '这个世界照原样打开着,改历史要先另存一份';
}

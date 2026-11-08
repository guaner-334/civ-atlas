/**
 * 插件的一批修改记进网站的修改:和用的人自己改一样走撤销记录(整批一步),照原样打开的旧世界改历史时照样先问要不要另存一份。
 */
import type { WorldEdits } from '../gen/edits';
import { commitEdits, editBlock, getEdits, historyDiffers } from '../ui/editsStore';

const FROZEN = '这个世界照原样打开着,改历史要先另存一份';

/**
 * 记进去了 = null;现在不让改 = 原因。
 * asked:同一个插件这一次打开的记号 —— 改历史被拦下问过一次以后,它再提改历史的修改直接回原因,不再弹窗问
 */
export function commitPluginEdits(next: WorldEdits, keys: string[], asked?: { history: boolean }): string | null {
  const why = editBlock(keys);
  if (why) return why;
  const history = historyDiffers(getEdits(), next);
  if (history && asked?.history) return FROZEN;
  if (commitEdits(next)) return null;
  if (history && asked) asked.history = true;
  return FROZEN;
}

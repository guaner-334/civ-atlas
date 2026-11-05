/**
 * 从文件打开的世界,打开以后顶上说的那一句(worldFileFlow.ts 记下,useWorldLoad.ts 在世界画好时说)。
 * 大世界打开要好一会儿,文件核对完就说的话,世界还没出来提示条就自己收了。
 * 纯状态,不碰 DOM。
 */
import type { ToastAction } from './toastStore';

export interface OpenNote {
  kind: 'ok' | 'warn';
  text: string;
  more: string[];
  action?: ToastAction;
}

let held: { id: string; note: OpenNote } | null = null;

export function holdOpenNote(id: string, note: OpenNote): void {
  held = { id, note };
}

/** 文件里的内容存不进浏览器:世界只打开、不存(走文字那条路),这是打开时第二行说的话 */
let trouble: string | null = null;

export function holdFileTrouble(line: string): void {
  trouble = line;
}

export function takeFileTrouble(): string | null {
  const line = trouble;
  trouble = null;
  return line;
}

/** 这个世界等着说的那一句(取了就没了);别的世界的留着 */
export function takeOpenNote(id: string): OpenNote | null {
  if (held?.id !== id) return null;
  const { note } = held;
  held = null;
  return note;
}

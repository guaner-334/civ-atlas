/** 检查脚本(scripts/notes-vault-check.ts)从页面上调的几样,见 Boot.tsx。一样一样列:整个模块都带上,用不到的代码也会进首页 */
import { copyNotes, deleteNote, exportNotes, notesBehind, notesKnown, notesReady, putNote } from '../ai/library';
import { _notesSettled, moveNotes } from '../ai/libraryVault';
import { deleteWorld, duplicateWorld, persistent, restoreWorld } from './saveStore';

export const notes = { _notesSettled, copyNotes, deleteNote, exportNotes, moveNotes, notesBehind, notesKnown, notesReady, putNote };
export const saves = { deleteWorld, duplicateWorld, persistent, restoreWorld };

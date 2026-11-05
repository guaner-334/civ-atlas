/** 检查脚本(scripts/notes-vault-check.ts、world-files-check.ts)从页面上调的几样,见 Boot.tsx。一样一样列:整个模块都带上,用不到的代码也会进首页 */
import { copyNotes, deleteNote, exportNotes, notesBehind, notesKnown, notesReady, putNote } from '../ai/library';
import { _notesSettled, moveNotes } from '../ai/libraryVault';
import { setCivTime } from './civView';
import { getEdits, setEdits } from './editsStore';
import { currentSave, currentUnsaved, currentWorld, deleteWorld, duplicateWorld, loadWorld, persistent, restoreWorld, trashMarks } from './saveStore';
import { clearTrashNow, trashInfo, vaultCall, vaultIsFull } from './worldStore';

export const notes = { _notesSettled, copyNotes, deleteNote, exportNotes, moveNotes, notesBehind, notesKnown, notesReady, putNote };
export const saves = { currentSave, currentUnsaved, currentWorld, deleteWorld, duplicateWorld, getEdits, loadWorld, persistent, restoreWorld, setCivTime, setEdits, trashMarks };
export const store = { clearTrashNow, trashInfo, vaultCall, vaultIsFull };

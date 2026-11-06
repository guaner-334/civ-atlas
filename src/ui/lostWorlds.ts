/**
 * 首页上看一眼有没有丢了的世界(判断规则见 ../worldRoster.ts):有才下载世界仓库的代码去认,首页不该为此多下东西。
 * 只读,主线程开一下库就关;库还没有就不建。
 */
import { VAULT_DB, rosterStep, type RosterMarks } from '../worldRoster';
import { isStored, persistent, syncable, trashMarks } from './saveStore';

/** 打开页面过多久看(毫秒):不和首屏抢 */
const LOOK_DELAY = 1500;

type Row = RosterMarks & { id: string };

function readRoster(): Promise<{ ids: string[]; states: Row[] } | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let r: IDBOpenDBRequest;
    try {
      r = indexedDB.open(VAULT_DB);
    } catch {
      return resolve(null);
    }
    // 库不存在:别建出来
    r.onupgradeneeded = () => r.transaction?.abort();
    r.onerror = () => resolve(null);
    r.onblocked = () => resolve(null);
    r.onsuccess = () => {
      const d = r.result;
      try {
        if (!d.objectStoreNames.contains('manifests') || !d.objectStoreNames.contains('states')) {
          d.close();
          return resolve(null);
        }
        const t = d.transaction(['manifests', 'states'], 'readonly');
        const keys = t.objectStore('manifests').getAllKeys();
        const states = t.objectStore('states').getAll();
        t.oncomplete = () => {
          d.close();
          resolve({ ids: [...new Set((keys.result as [string, number][]).map((k) => k[0]))], states: states.result as Row[] });
        };
        t.onabort = t.onerror = () => {
          d.close();
          resolve(null);
        };
      } catch {
        d.close();
        resolve(null);
      }
    };
  });
}

/** 仓库里有名单上没有、值得去认一遍的世界 */
export async function lostWorldsHere(): Promise<boolean> {
  if (!persistent()) return false;
  const seen = await readRoster();
  if (!seen) return false;
  const marks = trashMarks();
  const by = new Map(seen.states.map((s) => [s.id, s]));
  return seen.ids.some((id) => {
    if (isStored(id) || !syncable(id)) return false;
    const step = rosterStep(by.get(id), marks[id]);
    return step === 'rescue' || step === 'remark';
  });
}

let looked = false;

/** 这次打开看一遍(主程序那边 startWorldStore 自己会认,这里管只开了首页的) */
export function lookForLostWorlds(): void {
  if (looked) return;
  looked = true;
  setTimeout(() => {
    void lostWorldsHere()
      .then((yes) => (yes ? import('./worldStore').then((m) => m.rescueLostWorlds()) : null))
      .catch(() => {});
  }, LOOK_DELAY);
}

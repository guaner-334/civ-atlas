/**
 * 从账号取回整个世界:账号窗里取回、打开传过的世界、别人打开带着整个世界的短链接。用到才下载,首页不带。
 * 账号里那份和配方对得上才取;对不上的按配方算,和没传过一样。地图留着的世界不能按配方算,地图只能从那份里取,取到后历史按配方重推。
 */
import { fetchOwnFile, fetchSharedFile } from '../account/fullWorlds';
import { ServerError } from '../account/server';
import { getSession } from '../account/session';
import { SESSION_CHANGED, stillSignedIn, wipeCount } from '../account/sync';
import { keptMapOf } from '../gen/edits';
import { recipeKey, recipeOfSave } from '../gen/snapshot';
import { fullOverview, markRecipe, pairText, sameAsAccount, setFullPull, type FullEntry, type FullOverview } from './fullWorldView';
import { holdOpenNote } from './openNote';
import { loadWorld, markTrash, newWorldId, putSyncedWorld, rawWorld, type StoredWorld } from './saveStore';
import { saveMark } from './spaceFacts';
import { showToast } from './toastStore';
import { adoptWorldFile } from './worldFiles';
import { holdWorld } from './worldHolds';
import { TRASH_KEEP_MS, keptMapHere, vaultCall } from './worldStore';
import type { SaveFile } from '../gen/savefile';

let current: AbortController | null = null;

const HOLD_UNTIL_OPEN_MS = 120_000;

/**
 * 账号里的存档比整个世界旧:再传一次时整个世界换成了新的,接着存存档那一步没成(断网、关了页面)。
 * 这里的存档就是账号里那份旧的(刚取回来,没改过)时,取整个世界,存档也换成它里面的那份;这里改过的不动
 */
function recipeBehind(o: FullOverview, entry: FullEntry, w: StoredWorld): boolean {
  const saved = Date.parse(o.account.find((x) => x.id === w.id)?.updatedAt ?? '');
  return Date.parse(entry.uploadedAt) > saved && sameAsAccount(o, w.id, w.save);
}

/** 这个世界要不要取:本机的内容已经是这一份(同一份配方、同一版算的)就不用 */
async function needsPull(w: StoredWorld): Promise<boolean> {
  const o = fullOverview();
  const entry = o?.worlds.find((x) => x.id === w.id);
  if (!o || !entry || w.draft || w.map) return false;
  if (keptMapOf(w.save.edits)) return !(await keptMapHere(w.id));
  if (markRecipe(entry.mark) !== saveMark(w.save)) return recipeBehind(o, entry, w);
  const head = await vaultCall('latestOf', [w.id]).catch(() => undefined);
  if (head === undefined) return false;
  return !head || head.recipeKey !== (await recipeKey(recipeOfSave(w.save))) || head.generator !== w.save.generator;
}

/** 下载、核对、放进这个世界名下。出错抛 */
async function pullInto(w: StoredWorld, onBytes: (done: number, total: number) => void, signal: AbortSignal): Promise<void> {
  const token = getSession()?.token;
  const at = wipeCount();
  const entry = fullOverview()?.worlds.find((x) => x.id === w.id);
  const file = await fetchOwnFile(w.id, { total: entry?.bytes, signal, onBytes });
  // 下载、核对的工夫退出了(选了从这台设备上删掉的,放进来就又留下了)、换了账号
  const gone = new ServerError(0, SESSION_CHANGED, '账号变了');
  if (!stillSignedIn(token, at)) throw gone;
  const r = await adoptWorldFile(w.id, file, () => (wipeCount() !== at ? 'wiped' : getSession()?.token !== token ? 'stop' : 'go'));
  if (!stillSignedIn(token, at)) throw gone;
  if (!r.ok) throw new ServerError(0, r.kind, r.message);
  // 取到的和这里的存档不是同一份配方(只有账号里的存档落后时才取这种,见 recipeBehind):存档换成整个世界里的
  const raw = keptMapOf(w.save.edits) ? null : rawWorld(w.id);
  if (raw && saveMark(r.save) !== saveMark(w.save)) putSyncedWorld(w.id, { ...raw, save: JSON.stringify(r.save) });
}

/** 账号窗里点了取回:存档已经回来了,接着取整个世界。出错抛,说在那一行里;世界打开时还会再试 */
export async function pullNow(id: string): Promise<void> {
  const w = loadWorld(id);
  if (!w || !(await needsPull(w))) return;
  const ac = new AbortController();
  current?.abort();
  current = ac;
  setFullPull({ id, done: 0, total: fullOverview()?.worlds.find((x) => x.id === id)?.bytes ?? 0 });
  try {
    await pullInto(w, (done, all) => current === ac && setFullPull({ id, done, total: all }), ac.signal);
  } finally {
    if (current === ac) {
      current = null;
      setFullPull(null);
    }
  }
}

/** 打开之前取。true = 接着打开;false = 打不开(已经说过了,不打开) */
export async function pullBeforeOpen(id: string, reopen: () => void): Promise<boolean> {
  const w = loadWorld(id);
  if (!w || !(await needsPull(w).catch(() => false))) return true;
  current?.abort();
  const ac = new AbortController();
  current = ac;
  const total = fullOverview()?.worlds.find((x) => x.id === id)?.bytes ?? 0;
  setFullPull({ id, done: 0, total });
  try {
    await pullInto(w, (done, all) => current === ac && setFullPull({ id, done, total: all }), ac.signal);
    return true;
  } catch (e) {
    if (current !== ac) return false;
    // 退出登录了:世界还在(选了留着)就照配方打开,不说连不上
    if (e instanceof ServerError && e.code === SESSION_CHANGED) return !!loadWorld(id);
    const name = w.save.title || '这个世界';
    const again = { label: '再试一次', act: 'full-pull-retry', onClick: reopen };
    // 地图留着的世界没有配方可按,不打开
    if (keptMapOf(w.save.edits)) {
      showToast({ id: 'open-trouble', kind: 'error', text: `打不开「${name}」`, more: ['它的地图在账号里，现在连不上服务器。联网后再打开'], action: again });
      return false;
    }
    // 先按配方打开,不把人挡在外面,明说可能不一样。再试一次要换掉已经打开的这一份,刷新最省事
    holdOpenNote(id, { kind: 'warn', text: `没能从账号取回「${name}」`, more: ['连不上服务器。现在看到的是按配方长的，可能不一样'], action: { ...again, onClick: () => void retryOpened(id) } });
    return true;
  } finally {
    if (current === ac) {
      current = null;
      setFullPull(null);
    }
  }
}

/** 世界已经按配方打开了,再试一次:取到就重新读 */
async function retryOpened(id: string): Promise<void> {
  const w = loadWorld(id);
  if (!w) return;
  const ac = new AbortController();
  const name = w.save.title || '这个世界';
  const trouble = (more: string) => showToast({ id: 'open-trouble', kind: 'warn', text: `没能从账号取回「${name}」`, more: [more], action: { label: '再试一次', act: 'full-pull-retry', onClick: () => void retryOpened(id) } });
  showToast({ id: 'open-trouble', kind: 'progress', text: `正在从账号取「${name}」` });
  try {
    await pullInto(w, () => {}, ac.signal);
    location.reload();
  } catch {
    trouble('连不上服务器。现在看到的是按配方长的，可能不一样');
  }
}

/** 地图留着的世界打开到一半发现没有地图(刷新回来的,没走卡片):提示条上写取了多少 */
export async function pullKept(id: string): Promise<boolean> {
  const w = loadWorld(id);
  if (!w || !fullOverview()?.worlds.some((x) => x.id === id)) return false;
  const name = w.save.title || '这个世界';
  const ac = new AbortController();
  showToast({ id: 'open-trouble', kind: 'progress', text: `正在打开「${name}」` });
  try {
    await pullInto(
      w,
      (done, total) => {
        showToast({ id: 'open-trouble', kind: 'progress', text: `正在打开「${name}」`, more: [`正在从账号取，${pairText(done, total)}`], ...(total ? { progress: done / total } : {}) });
      },
      ac.signal,
    );
    return true;
  } catch {
    return false;
  }
}

export interface SharedWorld {
  ok: true;
  id: string;
  save: SaveFile;
  warnings: string[];
}

/**
 * 别人打开短链接:取整个世界,放进世界仓库,用一个新编号打开(不进「我的世界」)。
 * 记成已经过期的删除记录:没存进「我的世界」的,下次清理时清掉;改了存进来的,内容接着用。
 */
export async function pullShared(code: string, total: number, onBytes: (done: number, total: number) => void): Promise<SharedWorld> {
  const file = await fetchSharedFile(code, { total, onBytes });
  const id = newWorldId();
  markTrash(id, Date.now() - TRASH_KEEP_MS);
  const free = holdWorld(id);
  const r = await adoptWorldFile(id, file);
  if (!r.ok) {
    free();
    throw new ServerError(0, r.kind, r.message);
  }
  // 打开以后世界仓库自己拿着正开着的世界;这一会儿够它接上,放早了内容可能被清掉
  setTimeout(free, HOLD_UNTIL_OPEN_MS);
  return { ok: true, id, save: r.save, warnings: r.warnings };
}

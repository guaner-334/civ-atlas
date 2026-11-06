/**
 * 账号里的世界:只有用的人点了才传,没有自动同步。
 *
 *   pushWorld(id)   把这个世界的存档、几项本地信息、缩略图、AI 写的东西存进账号(传到账号、开分享时)
 *   takeWorld(id)   把账号里的存档取回这台设备(账号窗里点「取回」)
 *   signOut(keep)   退出登录,问过要不要从这台设备上删掉
 *
 * 服务器只管版本号对上才存(cloud.ts)。这里先问现在的版本号再存,谁最后传,账号里就是谁那份。
 * 删掉这台设备上的世界不碰账号;账号里的要在账号窗里删。
 */
import { exportNotes, forgetNotes, notesKnown, notesReady, replaceNotes, type AiNote } from '../ai/library';
import { fullMark, noteSent } from '../ui/fullWorldView';
import { MAX_WORLDS, cleanSyncMeta, currentUnsaved, isStored, putSyncedWorld, rawWorld, removeAllWorlds, storedCount, syncable, type RawWorld } from '../ui/saveStore';
import { clearResults } from '../ui/resultStore';
import type { SaveFile } from '../gen/savefile';
import { getCloud, listCloud, putCloud, type PutBody } from './cloud';
import { getSession, logout } from './session';
import { ServerError } from './server';

/** AI 写的东西最多存多少字(服务器的上限) */
const NOTES_MAX = 1_000_000;
const thumbOf = (t: string | null) => (t && t.length <= 200_000 ? t : null);

/** 等的工夫别的标签页退出、换了账号:再往下的请求会带上新账号的令牌,世界就传到别人名下了 */
export const SESSION_CHANGED = 'session-changed';
const NOTES_UNREAD = 'notes-unread';

// 退出登录选了从这台设备上删掉,一开始就加一:令牌要到最后才清,删世界在那之前,正在取的不能等令牌变了才停
let wipes = 0;
export const wipeCount = (): number => wipes;

/** 从账号往这台设备上写之前问一句:开始取的那次登录还在吗(at = 开始时的 wipeCount()) */
export function stillSignedIn(token: string | undefined, at: number): boolean {
  return !!token && getSession()?.token === token && wipes === at;
}

/**
 * 存进账号。alsoFile:AI 写的东西整个世界文件里也有,太多存不进这一份时不算错;只有存档的世界放不下要说。
 * raw、notes:存这一刻的样子(和打包的文件同一刻);不给 = 现在的。token:替哪一次登录存,换了就停。
 * 版本号在问和存之间被别的设备改了:再问一次
 */
export async function pushWorld(id: string, o: { alsoFile?: boolean; raw?: RawWorld; notes?: AiNote[]; token?: string } = {}): Promise<{ rev: number }> {
  const token = o.token ?? getSession()?.token;
  const same = () => {
    if (!token || getSession()?.token !== token) throw new ServerError(0, SESSION_CHANGED, '账号变了');
  };
  await notesReady([id]);
  same();
  const raw = o.raw ?? rawWorld(id);
  if (!raw) throw new ServerError(0, 'missing', '这个世界可能已在别的页面里删掉了');
  if (!syncable(id)) throw new ServerError(0, 'legacy', '以前存的世界，浏览器存储满了，没能换成新的存法，存不进账号。删掉几个世界、刷新页面再试');
  // 手上的不全:拿它去换,账号里那些就没了
  if (!notesKnown(id)) throw new ServerError(0, NOTES_UNREAD, 'AI 写的东西这次没读出来。刷新页面再试');
  const notes = o.notes ?? exportNotes(id);
  const tooMany = notes.length > 0 && JSON.stringify(notes).length > NOTES_MAX;
  if (tooMany && !o.alsoFile) throw new ServerError(400, 'bad-request', 'AI 给这个世界写的东西太多了，存不进账号');
  const save = JSON.parse(raw.save) as SaveFile;
  const mark = fullMark(id, save, notes);
  const body = (rev: number, deleted: boolean): PutBody => ({
    baseRev: rev,
    save,
    meta: { ...raw.meta },
    thumb: thumbOf(raw.thumb),
    ...(tooMany ? {} : { notes: notes.length ? notes : null }),
    ...(deleted ? { revive: true } : {}),
  });
  for (let tries = 0; ; tries++) {
    same();
    const e = (await listCloud()).find((x) => x.id === id);
    same();
    try {
      const r = await putCloud(id, body(e?.rev ?? 0, !!e?.deleted));
      noteSent(id, mark, r.rev);
      return r;
    } catch (err) {
      if (!(err instanceof ServerError) || err.code !== 'conflict' || tries >= 2) throw err;
    }
  }
}

/** 从账号取回存档、AI 写的东西(整个世界另外取,见 ui/fullWorldPull.ts)。token:替哪一次登录取,换了就不往这台设备上写 */
export async function takeWorld(id: string, token = getSession()?.token): Promise<void> {
  if (!isStored(id) && storedCount() >= MAX_WORLDS) throw new ServerError(0, 'count', `「我的世界」最多存 ${MAX_WORLDS} 个世界，先删掉几个`);
  const at = wipes;
  const w = await getCloud(id);
  // 等的工夫退出了(选了从这台设备上删掉的,写进来就又留下了)、换了账号
  if (!stillSignedIn(token, at)) throw new ServerError(0, SESSION_CHANGED, '账号变了');
  const had = exportNotes(id);
  // 先写 AI 写的东西:它写不下而存档写进去了的话,刷新以后那些东西就没了
  if (!replaceNotes(id, w.notes) || !putSyncedWorld(id, { save: JSON.stringify(w.save), meta: cleanSyncMeta(w.meta), thumb: typeof w.thumb === 'string' && w.thumb ? w.thumb : null })) {
    replaceNotes(id, had);
    throw new ServerError(0, 'full', '浏览器存储满了，放不下这个世界。先删掉几个世界');
  }
  noteSent(id, fullMark(id, w.save as SaveFile), w.rev);
}

const UNSAVED_WHY = '正在看的这个世界最新的改动没能存进浏览器（存储满了）。先把它存成文件，或者选「留着」';

/** 退出登录。keep = 这台设备上的世界留着;否则从这台设备上删掉(没传到账号的就没了,窗口上说过) */
export async function signOut(keep: boolean): Promise<{ ok: true } | { ok: false; message: string }> {
  // 最新的改动只在这个页面里:删了就没了
  if (!keep && getSession() && currentUnsaved()) return { ok: false, message: UNSAVED_WHY };
  if (!keep) {
    wipes++;
    const gone = removeAllWorlds();
    if (!gone) return { ok: false, message: '浏览器没让删掉这台设备上的世界，没有退出。可以选「留着」再退出' };
    forgetNotes();
    // 浏览器里存的原件也删掉,删完才算退出(关掉页面也不会留下)。世界仓库的代码下不来(断网)就直接删库,也不挡着退出
    await Promise.all([clearResults(), import('../ui/worldStore').then((m) => m.clearWorldStore()).catch(() => void indexedDB.deleteDatabase('civ-atlas:worlds'))]);
  }
  await logout();
  return { ok: true };
}

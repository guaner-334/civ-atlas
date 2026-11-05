/**
 * 开分享之前:这个世界要在账号里。已经在的不动(之后改了要再传一次);不在的把存档存上去,用的人点了分享才走到这里。
 * 服务器没开「传到账号」时没有别的地方能更新,每次点分享都存一遍存档。
 */
import { listCloud } from '../account/cloud';
import { ServerError } from '../account/server';
import { getSession } from '../account/session';
import { SESSION_CHANGED, pushWorld } from '../account/sync';
import { fullOverview } from './fullWorldView';
import { currentUnsaved, currentWorld } from './saveStore';

/** 等的工夫别的标签页退出、换了账号 */
export class ShareAborted extends Error {}

const unsavedHere = (worldId: string) => currentWorld()?.id === worldId && currentUnsaved();
const UNSAVED_WHY = '这个世界最新的改动没能存进浏览器（存储满了），也就存不进账号。先删掉几个世界腾出地方，再分享';

export async function pushForShare(worldId: string, token: string | undefined): Promise<void> {
  const still = () => {
    if (!token || getSession()?.token !== token) throw new ShareAborted('账号变了');
  };
  still();
  if (unsavedHere(worldId)) throw new Error(UNSAVED_WHY);
  const had = (await listCloud()).find((w) => w.id === worldId && !w.deleted);
  still();
  if (had && fullOverview()) return;
  try {
    await pushWorld(worldId, { token });
  } catch (e) {
    if (e instanceof ServerError && e.code === SESSION_CHANGED) throw new ShareAborted('账号变了');
    if (e instanceof ServerError) throw e;
    throw new Error('没能存进账号，稍后再试');
  }
  still();
}

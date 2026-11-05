/**
 * 世界打不开、读不出时提示条上的话。要紧的是说清东西没丢,不要让人以为坏了就去删。别处报同样的问题(存成文件那边)也用这里的字。
 *
 *   世界比这个页面还新(newerNotice):
 *     这一页是旧的  刷新一下就好,给「刷新页面」
 *     刷新过还是新  这个网站还没更新到那一版(比如测试网站存的文件拿到正式网站开),按钮没用,不给
 *     在旧版网站上  刷新还是旧网站,给「到最新版打开」
 *   读不出的文件(fileTrouble):不说「坏了」,说可能的原因、说网站没有动它;选错文件、空文件照原来的说法
 */
import type { SaveFile } from '../gen/savefile';
import { OLD_SITE, latestUrl, openInLatest } from './oldSite';
import { getEdits } from './editsStore';
import { briefError, keptFrom, notify } from './saveStore';
import { showToast, type ToastAction } from './toastStore';
import { withFileFlow } from './worldFileLazy';

/** 我的世界里的世界读取出错,退路也走不通 */
export const READ_TROUBLE = '读的时候出错了。原来的内容还在，先别删';
/** 打开的文件读不出 */
export const FILE_TROUBLE = '这个文件可能没存完整，或者被改过。网站没有动它，先别删';
/** 存的内容读不出,先按现在的规则算了一遍 */
export const READ_BACK = '存的内容这次没读出来，先按新版算了一遍，可能和原来不同。原来的还留着';
/** 地图留着的世界打不开:链接只带配方,带不上地图 */
export const KEPT_LINK = '这个链接带不上它的地图。请对方存成文件发给你，再点「打开存档文件」选它';
/** 地图留着的世界打不开:同步到账号的只有配方,地图在存下它的那台设备上 */
export const KEPT_DEVICE = '它的地图还在另一台设备上，世界没有丢。到那台存成文件，再到这里打开';
/** 地图留着的世界打不开:.json 文件只有配方 */
export const KEPT_FILE = '这个文件只有配方，带不上它的地图。请对方重新存成文件发给你';

/** 原来那个世界还在才说到它上面加 */
export function keptTerrainBlocked() {
  const from = keptFrom(getEdits());
  showToast({ id: 'edit-block', kind: 'warn', text: '这个世界不能再改地形大事', more: [from?.title !== undefined ? '它的地图是旧世界留下的，一改就要重新长。要加大事，到原来那个世界上加' : '它的地图是旧世界留下的，一改就要重新长'], ttl: 7000 });
}

/** 提示条的第二行和按钮 */
export interface TroubleNote {
  more: string[];
  action?: ToastAction;
}

/** 点过「刷新页面」的时候(毫秒)。只记在这个标签页里:过一阵网站可能真的更新了,那时再劝刷新是对的 */
const REFRESHED_KEY = 'civ-atlas:newer-refreshed';
const REFRESHED_MS = 30 * 60_000;

function refreshedJustNow(): boolean {
  try {
    const at = Number(sessionStorage.getItem(REFRESHED_KEY));
    return at > 0 && Date.now() - at < REFRESHED_MS;
  } catch {
    return false;
  }
}

function refreshPage() {
  try {
    sessionStorage.setItem(REFRESHED_KEY, String(Date.now()));
  } catch {
    /* 记不下就是再劝一次刷新 */
  }
  location.reload();
}

/** 旧网站只认 .json,提示条上存的是 save 这份原文。site 不给 = 旧网站上到最新版打开 */
export function openFailed(site?: string, save?: SaveFile) {
  if (site) {
    notify({
      kind: 'error',
      text: '这个浏览器打不开',
      more: ['存下配方文件，到旧版网站点「打开存档文件」选它'],
      ...(save ? { action: { label: '存配方文件', act: 'save-old-file', onClick: () => withFileFlow('没能存成文件', (m) => m.saveForOldSite(save, site)) } } : {}),
    });
    return;
  }
  notify({
    kind: 'error',
    text: '这个浏览器打不开',
    more: ['请把世界存成文件，到最新版打开'],
    ...(save ? { action: { label: '存成文件', act: 'save-old-file', onClick: () => withFileFlow('没能存成文件', (m) => m.saveRecipeFile(save, '到最新版打开')) } } : {}),
  });
}

/**
 * 世界比这个页面还新。from:从文件打开的要再选一次文件,刷新一下不够。
 * save:这个世界存着的那一份(旧版网站上带着它到最新版打开);读不出来的文件没有这一份,只打开最新版的网站
 */
export function newerNotice(from: 'world' | 'file', save?: SaveFile | null, site = OLD_SITE): TroubleNote {
  if (site !== null) {
    return {
      more: ['它是新版存的，这里是旧版网站。到最新版打开，世界没有丢'],
      action: {
        label: '到最新版打开',
        act: 'open-latest',
        onClick: () => {
          if (save) void openInLatest(save).then((ok) => ok || openFailed(undefined, save));
          else window.open(latestUrl().href, '_blank', 'noopener');
        },
      },
    };
  }
  if (refreshedJustNow()) return { more: ['它比这个网站的版本还新，网站更新后就能打开。世界没有丢'] };
  return {
    more: [from === 'file' ? '它是新版存的，这个页面还是旧的。刷新后再打开一次这个文件，世界没有丢' : '它是新版存的，这个页面还是旧的。刷新一下，世界没有丢'],
    action: { label: '刷新页面', act: 'reload-page', onClick: refreshPage },
  };
}

/** 打开的文件读不出的说法(error:parseSave、parseBundle 的原话) */
export function fileTrouble(error: string): TroubleNote {
  if (error.includes('来自更新版本')) return newerNotice('file');
  if (error.includes('文件坏了')) return { more: [FILE_TROUBLE] };
  return { more: [briefError(error)] };
}

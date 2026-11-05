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
import { briefError, notify } from './saveStore';
import type { ToastAction } from './toastStore';
import { withFileFlow } from './worldFileLazy';

/** 我的世界里的世界读取出错,退路也走不通 */
export const READ_TROUBLE = '读的时候出错了。原来的内容还在，先别删';
/** 打开的文件读不出 */
export const FILE_TROUBLE = '这个文件可能没存完整，或者被改过。网站没有动它，先别删';
/** 存的内容读不出,先按现在的规则算了一遍 */
export const READ_BACK = '存的内容这次没读出来，先按新版算了一遍，可能和原来不同。原来的还留着';

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

/** 交不过去(浏览器太旧,压缩不了存档):说一声怎么自己打开。旧网站只认 .json,提示条上的「存成文件」存的就是这一份(save) */
export function openFailed(site?: string, save?: SaveFile) {
  const where = site ? `到 ${site} 打开` : '到最新版打开';
  notify({
    kind: 'error',
    text: '这个浏览器打不开',
    more: [`请把世界存成文件，${where}`],
    ...(save ? { action: { label: '存成文件', act: 'save-old-file', onClick: () => withFileFlow('没能存成文件', (m) => m.saveRecipeFile(save, where)) } } : {}),
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

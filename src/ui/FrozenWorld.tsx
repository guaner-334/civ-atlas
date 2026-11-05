/**
 * 照原样打开的旧世界(读的是建它那一版存下的原件,没有用现在的生成器重新生成,见 resultStore.ts / worker.ts 的 load):
 *
 *   要用现在的规则重新推演的修改(全部推演、推演年数……)先问一声 ——
 *     「另存并推演」原来的不动,另存一份「…（新版）」带着这次的修改,地图不变,历史按现在的规则从第 0 年重推,打开它
 *     「取消」      什么都不变(待推演的单子留着)
 *   电脑是居中的窗口、手机从下面升起(和退出登录的窗口一样,AccountDialogs.tsx 的 Dialog)。
 *   「存档」菜单里的「按新版另存一份」也走这里(saveAsNew,App 挂上做法)。
 *
 *   上次有改动没推完页面就关了、之后网站又更新了(提示条上点「接着推演」):同一个窗口,带着那些改动,多一个 ——
 *     「不要这些改动」存档换回现在看到的这一份,以后不再提示
 *     「取消」        什么都不变,下次打开再说
 */
import { useSyncExternalStore } from 'react';
import type { WorldEdits } from '../gen/edits';
import { Dialog } from './AccountDialogs';

/** 另存的那份叫什么(实际存时重名会再编号) */
export const newVersionTitle = (title: string) => `${title}（新版）`;

export type SaveAsk = Ask;
interface Ask {
  /** 改之后的修改(另存的那份带着它) */
  next: WorldEdits;
  /** 这个世界的名字 */
  title: string;
  /** 这次要推演几条(待推演的单子推过来的;别的修改 = 0) */
  count: number;
  /** 问的是上次没推完的改动(count = 几处):放弃它们怎么做 */
  drop?: () => void;
  /** 不选,关掉窗口以后 */
  back?: () => void;
  /** 地图留不住的原因;不给 = 地图不变 */
  map?: 'none' | 'terrain' | 'upheaval';
}

let ask: Ask | null = null;
const subs = new Set<() => void>();
const emit = () => {
  for (const f of subs) f();
};
function useAsk(): Ask | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => ask,
  );
}

/** 问一声要不要另存一份再推演 */
export function askSaveAsNew(a: Ask) {
  ask = a;
  emit();
}

/** 关掉(换世界时) */
export function closeSaveAsNew() {
  if (!ask) return;
  ask = null;
  emit();
}

/** App 挂上的「按新版另存一份」:edits 不给 = 现在的修改;from = 窗口上问的那一次 */
type Saver = (edits?: WorldEdits, from?: SaveAsk) => void;
let saver: Saver | null = null;
export function setSaveAsNew(f: Saver | null) {
  saver = f;
}
export function saveAsNew(edits?: WorldEdits, from?: SaveAsk) {
  saver?.(edits, from);
}

export function askText(a: Pick<Ask, 'map' | 'drop' | 'title' | 'count'>): string {
  if (a.map === 'none') return `「${a.title}」是旧版本建的，只存了配方，地图没存下来。推演的话，地图和整段历史都按新版重新长，和原来可能不同。`;
  if (a.map === 'terrain') return `「${a.title}」是旧版本建的，一直照原样存着。这次动了地形大事，地图要跟着重新长，地图和整段历史都会和原来不一样。`;
  if (a.map === 'upheaval') return `「${a.title}」是旧版本建的，一直照原样存着。地形大事要在新版长的地图上发生，所以地图和整段历史都会和原来不一样。`;
  if (a.drop) return `上次有 ${a.count} 处改动没推完页面就关了，之后网站更新了，规则也变了。接着推演的话，地图不变，历史按新规则从第 0 年重推，整段都会不一样。`;
  return `「${a.title}」是旧版本建的，一直照原样存着。新版的规则变了，推演的话地图不变，历史按新规则从第 0 年重推，整段都会不一样。`;
}

/** 推演前问的窗口 */
export function FrozenAsk({ phone }: { phone: boolean }) {
  const a = useAsk();
  if (!a) return null;
  const close = () => {
    closeSaveAsNew();
    a.back?.();
  };
  const go = () => {
    closeSaveAsNew();
    saveAsNew(a.next, a);
  };
  const drop = () => {
    closeSaveAsNew();
    a.drop?.();
  };
  const label = a.map === 'upheaval' ? '另存一份再加地形大事？' : a.drop ? '另存一份接着推演？' : '另存一份再推演？';
  const what = a.count ? (a.drop ? `这 ${a.count} 处改动` : `这 ${a.count} 条命令`) : '';
  const go1 = a.map ? '连地图重新长' : '另存并推演';
  return (
    <Dialog phone={phone} label={label} onClose={close} testId="frozen-ask" className="frozen-ask" head={phone ? <div className="acct-head"><h2>{label}</h2></div> : undefined}>
      <div className="acct-body">
        <p>{askText(a)}</p>
        <p className="acct-small">
          原来的「{a.title}」不动；另存一份「{newVersionTitle(a.title)}」，{a.map === 'upheaval' ? '到那一份上加' : `在那一份上推演${what}`}。
        </p>
      </div>
      <div className={`acct-foot${phone ? ' col' : ''}`}>
        {phone ? (
          <>
            <button className="acct-btn full blue" data-act="frozen-save" onClick={go}>
              {go1}
            </button>
            {a.drop && (
              <button className="acct-btn full" data-act="frozen-drop" onClick={drop}>
                不要这些改动
              </button>
            )}
            <button className="acct-btn full" onClick={close}>
              取消
            </button>
          </>
        ) : (
          <>
            {a.drop && (
              <button className="acct-btn" data-act="frozen-drop" onClick={drop}>
                不要这些改动
              </button>
            )}
            <span className="acct-sp" />
            <button className="acct-btn" onClick={close}>
              取消
            </button>
            <button className="acct-btn blue" data-act="frozen-save" onClick={go}>
              {go1}
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

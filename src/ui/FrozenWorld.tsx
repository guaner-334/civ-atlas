/**
 * 照原样打开的旧世界(读的是建它那一版存下的原件,没有用现在的生成器重新生成,见 resultStore.ts / worker.ts 的 load):
 *
 *   要用现在的规则重新推演的修改(全部推演、地形大事、推演年数……)先问一声 ——
 *     「另存并推演」原来的不动,另存一份「…（新版）」带着这次的修改,打开它按新版推演
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

/**
 * App 挂上的「按新版另存一份」:edits = 另存的那份带着的修改(不给 = 现在的);
 * moved = 带的是上次没推完的改动:它们跟着另存的那份走了,原来的世界不用再提示
 */
type Saver = (edits?: WorldEdits, moved?: boolean) => void;
let saver: Saver | null = null;
export function setSaveAsNew(f: Saver | null) {
  saver = f;
}
export function saveAsNew(edits?: WorldEdits, moved?: boolean) {
  saver?.(edits, moved);
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
    saveAsNew(a.next, !!a.drop);
  };
  const drop = () => {
    closeSaveAsNew();
    a.drop?.();
  };
  const label = a.drop ? '另存一份接着推演？' : '另存一份再推演？';
  const what = a.count ? (a.drop ? `这 ${a.count} 处改动` : `这 ${a.count} 条命令`) : '';
  return (
    <Dialog phone={phone} label={label} onClose={close} testId="frozen-ask" className="frozen-ask" head={phone ? <div className="acct-head"><h2>{label}</h2></div> : undefined}>
      <div className="acct-body">
        <p>{a.drop ? `上次有 ${a.count} 处改动没推完页面就关了，之后网站更新了，规则也变了。接着推演的话，整段历史都会不一样，地图也可能变。` : `「${a.title}」是旧版本建的，一直照原样存着。新版的规则变了，推演的话整段历史都会不一样，地图也可能变。`}</p>
        <p className="acct-small">
          原来的「{a.title}」不动；另存一份「{newVersionTitle(a.title)}」，在那一份上推演{what}。
        </p>
      </div>
      <div className={`acct-foot${phone ? ' col' : ''}`}>
        {phone ? (
          <>
            <button className="acct-btn full blue" data-act="frozen-save" onClick={go}>
              另存并推演
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
              另存并推演
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

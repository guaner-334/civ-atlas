/**
 * 首页(我的世界)先出来的那一份:打开网站时就停在我的世界(homeStart.ts 的 plainHome)时,主程序 App.tsx 还在后台下载,
 * 先由这里把这一页放出来。用的就是 App 在我的世界时放的那几样(同一个 MyWorlds、新建世界弹窗、账号窗、提示条……,
 * 外面同样一层 .app),看起来、点起来和 App 里的一样。
 *
 * 要离开这一页的事(打开一个世界、新建弹窗里点「开始」、打开存档文件、在一张地图上打造新文明)交给 App:
 * onLeave 把这一件交出去,Boot.tsx 等主程序下好、把 App 挂上,App 接着做(见 App 的 fromHome)。
 * 主程序还没下完时在点的地方说下了多少:「开始」变成转圈 +「准备中」、旁边一句;世界卡片上一个进度圈;
 * 打开存档文件、拖文件进来没有按钮可转圈,顶上一条提示(带「取消」)。下好了这一页就换成 App。
 * 按浏览器的后退 / 前进、地址栏里贴了分享链接(只有 # 不同,页面不刷新)也交给 App:它照这时的网址打开,和刷新一样
 * (这一页先记成我的世界那一步,贴的分享链接记成新的一步,和 App 记的一样,打开以后按后退回得到首页)。
 *
 * 和 App 一样在这里也做的:云同步、AI 接入(开了就一直开着,App 挂上以后接着用)、页面缩放的拦截、⌘S 不弹浏览器的"存储网页"。
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { MyWorlds } from './MyWorlds';
import { NewWorldDialog } from './NewWorldDialog';
import { AccountHost, setGoHome } from './AccountDialogs';
import { AiSettingsHost } from './AiSettings';
import { ToastBar, clearToast, showToast } from './Toast';
import { TipLayer } from './Tips';
import { useNarrow } from './device';
import { notify } from './saveStore';
import { setStage } from './stageStore';
import { setSideHold } from './sideStore';
import { getCivShow, setCivShow } from './civView';
import { baseDark, baseLook, baseOf, fillOf, fillShow, layerOf, mapViewFromUrl, type SatLook, type Style } from './mapLayers';
import { useShortcuts } from './useShortcuts';
import { createPinchGuard, setGesturePinch, wheelSample } from './wheel';
import { startSync } from '../account/sync';
import { setupAi } from '../ai/setup';
import { isShareHash } from '../gen/savefile';
import { randomSeedValue, type HomeStart } from './homeStart';
import { isNavState, navAdopt, navMark } from './nav';
import { useAppPercent } from './loadScreen';

/** 打开存档文件、等主程序下完时顶上那条提示 */
const WAIT_TOAST = 'home-wait';

/**
 * null = 不带要做的事(按后退 / 前进、贴了分享链接):App 照这时的网址打开;
 * undefined = 不走了(主程序还没下好、还停在首页时,新建弹窗里点了「开始」又点了「取消」)
 */
export type LeaveHome = (start: HomeStart | null | undefined) => void;

export function HomeShell({ onLeave }: { onLeave: LeaveHome }) {
  // 和 App 一开始一样:在我的世界这一步(云同步、账号窗按它决定做什么)、左边的卡片不算收起;
  // 底图和填色照网址(首页的网址里没有图层,就是默认的手绘 + 国家;App.tsx 的 readUrl 和一开始那段)
  const [view] = useState(() => {
    setStage('home');
    setSideHold(true);
    const mv = mapViewFromUrl(new URLSearchParams(location.search));
    const sat: SatLook = mv?.sat ?? 'detail';
    const b = mv ? baseLook(mv.base, sat) : null;
    const style: Style = b?.style ?? 'fantasy';
    const layer = b?.data ?? 'biomes';
    const surface = b?.look ?? sat;
    if (mv) setCivShow(mv.resources ? { ...fillShow(mv.fill), resources: true } : fillShow(mv.fill));
    return { style, layer, surface };
  });
  const narrow = useNarrow();
  const civShow = getCivShow();
  const mapBase = baseOf(view.style, view.layer, view.surface);
  const theme = baseDark(mapBase) ? 'dark' : 'light';
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const [newDlg, setNewDlg] = useState(false);
  const [dropping, setDropping] = useState(false);
  /** 已经点了要离开这一页的那一件、主程序还没下好(下好了这一页就换成 App) */
  const [waiting, setWaiting] = useState<HomeStart | null>(null);
  /** 主程序下了百分之几(null = 不知道;没在等的时候不跟着变) */
  const pct = useAppPercent(!!waiting);
  const leave = useCallback(
    (s: HomeStart) => {
      setWaiting(s);
      onLeave(s);
    },
    [onLeave],
  );
  /** 不走了(新建弹窗里点了「取消」、提示条上点了「取消」) */
  const stay = useCallback(() => {
    setWaiting(null);
    onLeave(undefined);
  }, [onLeave]);
  // 打开存档文件、拖文件进来:顶上一条提示,说下了多少、下好就打开,能取消
  const fileWait = waiting?.kind === 'text' ? waiting : null;
  useEffect(() => {
    if (!fileWait) return;
    showToast({
      id: WAIT_TOAST,
      kind: 'progress',
      text: '正在载入地图程序',
      more: [pct === null ? '网络有点慢' : `网络有点慢，已下载 ${pct}%`, `下好就自动打开${fileWait.fileName ? ` ${fileWait.fileName}` : '存档'}`],
      ...(pct === null ? {} : { progress: pct / 100 }),
      action: { label: '取消', act: 'home-wait-cancel', onClick: stay },
    });
  }, [fileWait, pct, stay]);
  useEffect(() => {
    if (!fileWait) return;
    return () => clearToast(WAIT_TOAST);
  }, [fileWait]);

  useEffect(() => {
    // AI 接入、云同步:开了就一直开着,App 挂上以后接着用这一份(App 里再开一次什么都不做),换过去时同步不断
    setupAi();
    startSync();
    // 账号窗里点「最近删除」等回到我的世界:已经在这一页
    setGoHome(() => {});
    // 浏览器的后退、前进:这一页先记成我的世界那一步(和 App 一样;App 挂上以后接着记)
    navMark({ page: 'home' });
    // 按后退 / 前进到了这个网站记的另一步:交给 App 照网址打开
    const onPop = () => onLeave(null);
    // 地址栏里自己加了 #:浏览器记了一步、这个网站没记过,也记成一步(和 App 一样);贴的是分享链接,交给 App 照网址打开
    const onHash = () => {
      if (!isNavState(history.state)) navAdopt({ page: 'home' });
      if (isShareHash(location.hash)) onLeave(null);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onHash);
    // 浏览器自己的页面缩放不抢捏合(和 App 一样):Safari 的 gesture 事件、Chrome / Firefox 触控板捏合(按着 Ctrl 的滚轮)
    const gStart = (e: Event) => {
      e.preventDefault();
      setGesturePinch(true);
    };
    const gChange = (e: Event) => e.preventDefault();
    const gEnd = () => setGesturePinch(false);
    const isPinch = createPinchGuard();
    const pageZoom = (e: WheelEvent) => {
      if (e.ctrlKey && isPinch(wheelSample(e))) e.preventDefault();
    };
    document.addEventListener('gesturestart', gStart, { passive: false });
    document.addEventListener('gesturechange', gChange, { passive: false });
    document.addEventListener('gestureend', gEnd);
    window.addEventListener('wheel', pageZoom, { passive: false, capture: true });
    return () => {
      setGoHome(null);
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onHash);
      document.removeEventListener('gesturestart', gStart);
      document.removeEventListener('gesturechange', gChange);
      document.removeEventListener('gestureend', gEnd);
      window.removeEventListener('wheel', pageZoom, { capture: true });
    };
  }, [onLeave]);
  // 快捷键在我的世界都不管(⌘S 照样拦下,见 useShortcuts.ts)
  useShortcuts(() => false);

  // 把 .json 拖进页面 = 从文件打开(和 App 一样;我的世界不收图片)
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropping) setDropping(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.relatedTarget || !(e.currentTarget as Node).contains(e.relatedTarget as Node)) setDropping(false);
  };
  const onDrop = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    setDropping(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    f.text().then(
      (text) => leave({ kind: 'text', text, fileName: f.name }),
      () => notify({ kind: 'error', text: `打不开 ${f.name}`, more: ['读不了这个文件'] }),
    );
  };

  return (
    <div
      className={`app${narrow ? ' phone' : ' has-side'} booting home`}
      data-theme={theme}
      data-layer={layerOf(view.style, view.layer, civShow)}
      data-base={mapBase}
      data-fill={fillOf(civShow)}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <MyWorlds
        phone={narrow}
        onOpen={(id) => leave({ kind: 'open', id })}
        onNew={() => setNewDlg(true)}
        onOpenText={(text, fileName) => leave({ kind: 'text', text, fileName })}
        onNewCiv={(id) => leave({ kind: 'newCiv', id })}
        opening={waiting && (waiting.kind === 'open' || waiting.kind === 'newCiv') ? { id: waiting.id, pct } : null}
      />
      <ToastBar />
      <AiSettingsHost />
      <AccountHost phone={narrow} />
      <TipLayer />
      {newDlg && (
        <NewWorldDialog
          phone={narrow}
          randomSeed={randomSeedValue}
          onCancel={() => {
            setNewDlg(false);
            stay();
          }}
          onStart={(start) => leave({ kind: 'dialog', start })}
          wait={waiting?.kind === 'dialog' ? { pct } : undefined}
        />
      )}
      {dropping && (
        <div className="drop-hint">
          <div>松手打开存档(.json)</div>
        </div>
      )}
    </div>
  );
}

/**
 * 打开网页:先下载、先放出来的只有这一小份,主程序(App.tsx 和它用到的地图、推演、编辑地形、助手、导出……)单独一个文件。
 *
 *   就停在我的世界(homeStart.ts 的 plainHome)  先放首页(HomeShell.tsx),同时接着下载主程序;主程序下好以后再顺带下好生成世界的线程。
 *                                               在首页点了要离开这一页的事,等主程序下好(多半早就下好了)把 App 挂上、接着做那一件
 *   别的(打开某个世界、分享链接、新建……)      主程序和这一小份同时开始下载(index.html 里最先跑的那一段,见 homeStart.ts 的 bootScript),
 *                                               下好就挂上 App,和以前一样按网址打开
 *
 * 主程序没下载成功(网断了、网站刚更新过旧文件不在了):要用到它的时候重新下载一次,还不行就刷新页面。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeShell } from './HomeShell';
import { plainHome, type HomeStart } from './homeStart';
import { warmNewWorldPictures } from './NewWorldDialog';
import { prefetchWorker } from './workerUrl';

type AppModule = typeof import('./App');

let loading: Promise<AppModule> | null = null;
/** 下载主程序(只下一次;失败了下次再叫时重来) */
function loadApp(): Promise<AppModule> {
  loading ??= import('./App').catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

const RELOAD_KEY = 'civ-atlas:boot-reload';
/** 主程序下载不下来:刷新页面重来(网站更新过、旧文件不在了,刷新拿到新的)。半分钟里只刷一次,网断着时不会一直刷 */
function reloadOnce() {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY));
    if (Number.isFinite(last) && Date.now() - last < 30_000) return;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    return;
  }
  location.reload();
}

/** 首页画出来以后再做(不和首页要的抢网速) */
function afterFirstPaint(f: () => void): () => void {
  let t = 0;
  const raf = requestAnimationFrame(() => {
    t = window.setTimeout(f, 0);
  });
  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(t);
  };
}

/** 打开网页时就停在我的世界(只看一次) */
const HOME = plainHome();
// 首页的代码一跑起来就接着下载主程序(首页这时已经能画出来;不是首页的,页面里最先跑的那一段已经让它和首页的代码一起在下了)
loadApp().catch(() => {});

export function Boot() {
  const home = HOME;
  const [app, setApp] = useState<AppModule | null>(null);
  /** 交给 App 的那一件(undefined = 还在首页,没要离开;null = 不带要做的事,照网址打开) */
  const [start, setStart] = useState<HomeStart | null | undefined>(home ? undefined : null);
  const leaving = start !== undefined;
  /** 首页上已经点了要离开的事(后台下好主程序时就不再顺带下生成线程) */
  const leftRef = useRef(false);

  // 首页:画出来以后再下新建弹窗的两张图;主程序下好以后再下生成线程。主程序没下成功不要紧,真要用时再下(见下面)
  useEffect(() => {
    if (!home) return;
    return afterFirstPaint(() => {
      warmNewWorldPictures();
      loadApp().then((m) => {
        setApp(m);
        // 进世界要用的生成线程也先下好(已经要离开首页的不用:App 挂上马上就开线程)
        if (!leftRef.current) prefetchWorker();
      }, () => {});
    });
  }, [home]);

  // 要用 App 了(不是首页的直接用;首页上要离开这一页了)、主程序还没有:下载(首页上每点一下都再试),不行就刷新页面
  useEffect(() => {
    if (start === undefined || app) return;
    let live = true;
    loadApp().then(
      (m) => live && setApp(m),
      () => live && reloadOnce(),
    );
    return () => {
      live = false;
    };
  }, [start, app]);

  // undefined = 不走了(主程序还没下好时,新建弹窗里点了「开始」又点「取消」)
  const onLeave = useCallback((s: HomeStart | null | undefined) => {
    if (s !== undefined) leftRef.current = true;
    setStart(s);
  }, []);

  if (app && leaving) return <app.App fromHome={start ?? undefined} />;
  return home ? <HomeShell onLeave={onLeave} /> : null;
}

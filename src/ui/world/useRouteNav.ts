/**
 * 网址跟着画面走(App 用;打开网页时读网址见 ./pageUrl.ts,记一步、按后退 / 前进见 ../nav.ts):
 *   useViewUrl   投影 / 中心 / 经纬网 / 等值线停下来约半秒写进网址,已经存着的世界跟着重存一次
 *   useRouteNav  浏览器的后退、前进:换到记着的那一步(App 登记给 nav.ts 的 route / describe / settled / apply,经 navRef 调);
 *                只是看看的世界、新建中的世界存下了:网址换成 w=编号
 * 两样在 App 里分开调,各放在原来那一段的位置(和前后别的 effect 的先后不变);这里的函数每次渲染新建(和原来写在 App 里一样)
 */
import { useEffect, useRef } from 'react';
import type { Civ } from '../../gen/civ/types';
import { sameInterventions } from '../../gen/edits';
import { worldKey, type ContourKind } from '../../gen/savefile';
import { sameUpheavals } from '../../gen/terrainEdits';
import type { GalleryItem } from '../../account/gallery';
import { closeBookReader, closeHistoryBook } from '../bookStore';
import { pausePlayback } from '../civView';
import { getEdits } from '../editsStore';
import { getNav, navUrl, type NavHooks, type NavState } from '../nav';
import { applyLayer as applyNavLayer } from '../navView';
import type { MapProjection } from '../projection';
import { currentUnsaved, currentWorld, deleteWorld, isStored, isWorldId, loadWorld, newWorldId, viewChanged } from '../saveStore';
import { getStage } from '../stageStore';
import { clearToast } from '../Toast';
import { cancelTimeout } from '../holdMark';
import { readUrl, visitTarget } from './pageUrl';
import type { useWorldLoad } from './useWorldLoad';
import type { useWorldPages } from './useWorldPages';
import type { CivRefs, GenRefs, Ref, ResimRefs, Setter } from './worldRefs';
import { draftTarget, goneToast, sameScreen, writeWorldUrl, yearsEdits, type Landing, type NewDlg, type Target, type WallView, type WorkFor } from './worldTarget';

/** 投影、中央经线、经纬网、等值线写进网址(停下来约半秒) */
export function useViewUrl(view: { projection: MapProjection; mapCenter: number; graticule: number; contourKind: ContourKind | null }): void {
  const { projection, mapCenter, graticule, contourKind } = view;
  // 投影 / 中心 / 经纬网停下来约半秒:写进网址(刷新、复制网址都还在),已经存着的世界跟着重存一次
  useEffect(() => {
    const t = setTimeout(() => {
      const q = new URLSearchParams(location.search);
      if (projection !== 'equirect') q.set('proj', projection);
      else q.delete('proj');
      q.delete('view'); // 旧的地球仪开关,换成 proj=globe
      if (graticule) q.set('grat', graticule === 30 ? '1' : String(graticule));
      else q.delete('grat');
      if (contourKind) q.set('iso', contourKind);
      else q.delete('iso');
      const lon = Math.round(mapCenter * 100) / 100;
      if (Math.abs(lon) >= 0.005) q.set('lon', String(lon));
      else q.delete('lon');
      const next = `?${q}`;
      if (next !== location.search) navUrl(next);
      viewChanged();
    }, 450);
    return cancelTimeout(t);
  }, [projection, mapCenter, graticule, contourKind]);
}

/** useRouteNav 要的 App 状态(按块) */
export interface RouteNavDeps {
  gen: Pick<GenRefs, 'targetRef' | 'fresh' | 'regenRef' | 'rawRef'>;
  civ: Pick<CivRefs, 'civEdits' | 'civUps'>;
  resim: Pick<ResimRefs, 'resimInfo'>;
  /** useWorldLoad 交回的:换画面、打开 */
  load: Pick<ReturnType<typeof useWorldLoad>, 'enterStage' | 'openTarget' | 'openStored' | 'openShortShare'>;
  /** useWorldPages 交回的:回我的世界、作品墙、新建中的世界;v = 存着的世界变了的记号 */
  pages: Pick<ReturnType<typeof useWorldPages>, 'showHome' | 'showGallery' | 'openWork' | 'derivedUntouched' | 'draftNow' | 'draftSeed' | 'v'>;
  /** 我的世界、分享说明、新建弹窗、作品墙、回放这些画面上的状态 */
  page: {
    home: boolean;
    setLanding: Setter<Landing>;
    setNewDlg: Setter<NewDlg | null>;
    setWall: Setter<WallView | null>;
    wallSeq: Ref<number>;
    workItems: Ref<Map<string, GalleryItem>>;
    setWorkFor: Setter<WorkFor | null>;
    setReplayOn: Setter<boolean>;
  };
  /** 地图上那一段的历史(打开这一步记着的卡片、概览、史书用) */
  shownRaw: Civ | null;
  /** nav.ts 经它调 route / describe / settled / apply:这里填 .current */
  navRef: Ref<NavHooks>;
}

export function useRouteNav(deps: RouteNavDeps): void {
  const { targetRef, fresh, regenRef, rawRef } = deps.gen;
  const { civEdits, civUps } = deps.civ;
  const { resimInfo } = deps.resim;
  const { enterStage, openTarget, openStored, openShortShare } = deps.load;
  const { showHome, showGallery, openWork, derivedUntouched, draftNow, draftSeed, v } = deps.pages;
  const { home, setLanding, setNewDlg, setWall, wallSeq, workItems, setWorkFor, setReplayOn } = deps.page;
  const { shownRaw, navRef } = deps;
  /** 离开时还没存着的世界(只是看看的、别人分享的):退回来时照原样打开(只记在这一页里,刷新就没了) */
  const navTargets = useRef(new Map<string, Target>());
  /** 要离开这个画面了:名字、存没存着;没存着的世界记下它 */
  const describeNav = () => {
    const t = targetRef.current;
    // 在我的世界:targetRef 还是上一个世界(可能已经删了),不算
    if (!t || getStage().stage === 'home') return {};
    const cw = currentWorld();
    const live = cw?.id === t.id;
    const title = (live ? cw.title : t.title) || undefined;
    const stored = isStored(t.id);
    // 没存着的、最近的修改没写进浏览器的(存储满了):记下现在的样子(修改、名字用手上的),回来时照这个打开;存好了的不用记。
    // 新建中的只记动过、没写进去的(还在生成就起了名的也算;没动过的按网址里的种子新建就是原样)
    const unsaved = live && currentUnsaved();
    const touched = live ? !cw.pristine : !t.pristine;
    if ((!stored && (t.kind !== 'draft' || touched)) || unsaved) navTargets.current.set(t.id, { ...t, ...(live ? { edits: getEdits(), title } : {}), ...(unsaved && t.kind === 'draft' ? { pristine: false } : {}), view: undefined, warnings: undefined });
    else navTargets.current.delete(t.id);
    return { title, stored };
  };
  /** 现在这个世界生成好、历史推完了(干预、地形大事都推进去了):它的编号;还没好 = null */
  const settledId = (): string | null => {
    const t = targetRef.current;
    const cw = currentWorld();
    if (getStage().stage !== 'world' || !t || !cw || cw.id !== t.id || !rawRef.current || fresh.current || regenRef.current) return null;
    if (!sameInterventions(getEdits().interventions, civEdits.current) || !sameUpheavals(getEdits().upheavals, civUps.current)) return null;
    const ri = resimInfo.current;
    return ri && ri.arrived === undefined ? null : t.id;
  };
  /**
   * 按后退 / 前进到了 to 这一步:
   *   我的世界  回我的世界
   *   新建      还是这次新建(同一个编号):种子、参数换回那一步的(那一步的网址里记着);存着、没建完的:打开它(同样换回;
   *             这一页里记着的、存储满了没写进去的,照这一页里的样子打开);
   *             已经建成了世界的:后退时跳过(前面没有这个网站的一步了就回我的世界),前进时打开那个世界;
   *             存过、没建完就删掉了的(以它为底稿新建、什么都没动就返回的那一份):后退时同样跳过;没存过的:按网址里的种子新建
   *             (照手绘图、还没照图长出星球的:图没留下,回我的世界、弹窗停在选图那一步)
   *   世界      这一页里看过、没存着的(或最近的修改没写进浏览器,存储满了):照这一页里的样子打开;存着的:打开它;
   *             存过、现在不在了:回我的世界,提示删掉了;
   *             别的(网址里带种子的、分享短链接):按网址打开
   * 从"以它为底稿新建"离开、什么都没动:那一份删掉(和左上的返回一样)
   */
  const routeNav = (to: NavState, from: NavState, dir: -1 | 1): void | 'skip' => {
    if (from.page === 'draft') {
      const left = derivedUntouched();
      if (left && !(to.page === 'draft' && to.id === left)) deleteWorld(left);
    }
    // 分享链接打不开的那一页、正在取的分享、「新建世界」弹窗、写史书的窗口(选的是那个世界的国家)、读着的史书:换了画面就不留
    // (到了世界、那一步记着史书的,世界好了再打开)
    setLanding(null);
    setNewDlg(null);
    clearToast('share');
    closeHistoryBook();
    closeBookReader();
    if (to.page === 'home') return showHome();
    // 作品墙那一页、一个作品(取的时候换了画面,取回来不再打开)
    if (to.page === 'gallery') return to.id ? openWork(to.id) : showGallery();
    wallSeq.current++;
    setWall(null);
    // 回到从作品墙打开的世界作品:左上那一条照旧
    const wi = to.page === 'world' && to.id ? workItems.current.get(to.id) : undefined;
    setWorkFor(wi && to.id ? { id: to.id, work: wi } : null);
    const back = dir < 0;
    const skip = (): void | 'skip' => (back && to.prev ? 'skip' : showHome());
    const url = readUrl();
    const q = new URLSearchParams(location.search);
    if (to.page === 'draft') {
      const seed = to.seed ?? url.params.seed;
      const want = { ...url.params, seed };
      const d = draftNow();
      if (d && d.id === to.id) {
        if (worldKey(want) !== worldKey(d.params) && !d.base) draftSeed(seed, want);
        return;
      }
      const w = to.id ? loadWorld(to.id) : null;
      if (w && !w.draft) return back ? skip() : openStored(w.id);
      const once = to.stored || (!!to.id && q.get('w') === to.id);
      const mem = to.id ? navTargets.current.get(to.id) : undefined;
      // 这一页里记着的(最近的修改没写进浏览器,存储满了)比存着的新;同样换回那一步的种子、参数
      if (mem?.kind === 'draft' && (w || !once)) {
        openTarget(mem);
        if (worldKey(want) !== worldKey(mem.params) && !mem.base) draftSeed(seed, want);
        return;
      }
      if (w) {
        openStored(w.id);
        if (worldKey(want) !== worldKey(w.save.params) && !w.base) draftSeed(seed, want);
        return;
      }
      // 存过(离开时记着,或那一步的网址里有 w=编号)、现在不在了:跳过
      if (once) return skip();
      // 照手绘图新建、还没照图长出星球(图不存,离开就没了):和刷新时一样,回我的世界,弹窗停在照手绘图选图那一步
      if (q.get('new') === 'image') {
        showHome();
        setNewDlg({ init: { mode: 'image', params: url.params, step: 2, endYear: url.years } });
        return;
      }
      return openTarget({ ...draftTarget({ ...url.params, seed }, null, yearsEdits(url.years)), id: to.id ?? newWorldId() });
    }
    const w = to.id ? loadWorld(to.id) : null;
    const once = to.stored || isWorldId(q.get('w'));
    const mem = to.id ? navTargets.current.get(to.id) : undefined;
    // 这一页里记着的(没存着的、最近的修改没写进浏览器的)比存着的新;存过、现在不在了的是删掉了
    if (mem && (w || !once)) return openTarget(mem);
    if (w) return openStored(w.id);
    if (once) {
      showHome();
      goneToast(to.title);
      return;
    }
    const code = q.get('s');
    if (code) {
      // 刷新过(手上没有这个世界):和打开分享短链接时一样,先到"正在打开"那一页,停了、打不开也显示在那一页
      pausePlayback();
      setReplayOn(false);
      enterStage('home');
      setLanding('loading');
      return openShortShare(code, () => sameScreen(getNav(), to));
    }
    // 从作品墙打开、还没存下的世界作品(刷新过,手上没有这个世界):和打开作品的网址一样再取一次
    const gid = q.get('gallery');
    if (gid) return openWork(gid);
    if (q.has('seed')) return openTarget({ ...visitTarget(url.params, url.gen), id: to.id ?? newWorldId() });
    return showHome();
  };
  navRef.current = { route: routeNav, describe: describeNav, settled: settledId, apply: (l) => (shownRaw ? applyNavLayer(shownRaw, l) : {}) };
  // 只是看看的世界改了第一笔、新建中的动了第一下,就存下了:网址换成 w=编号,刷新还回到它
  useEffect(() => {
    const t = targetRef.current;
    const cur = currentWorld();
    if (home || !t || !cur || cur.id !== t.id) return;
    if (isStored(t.id) && new URLSearchParams(location.search).get('w') !== t.id) writeWorldUrl(t);
  }, [v, home]);
}
